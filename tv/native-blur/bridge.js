'use strict';
// One bounded native-blur session. No boot hook, persistent daemon, or shell API.
var fs = require('fs'), path = require('path'), http = require('http');
var crypto = require('crypto'), cp = require('child_process'), url = require('url');
var PORT = 48740, WEB = 'com.gathin.tvcontrolcentre', NATIVE = 'com.gathin.nativeblurdiagnostic';
var SOURCES = ['com.webos.app.home', 'com.gathin.tvhome', 'youtube.leanback.v4', 'com.apple.applemusic', 'netflix'];
var WEB_ORIGIN = 'file://com.gathin.tvcontrolcentre-webos';
var LEASE = 3500, HARD_LIMIT = 600000, BODY_LIMIT = 2048;

function luna(service, payload) {
  return new Promise(function (resolve, reject) {
    cp.execFile('/usr/bin/luna-send', ['-w', '4500', '-n', '1', 'luna://' + service, JSON.stringify(payload || {})],
      {timeout: 5500, maxBuffer: 131072, encoding: 'utf8'}, function (error, stdout) {
        if (error) { reject(Error('Luna request failed: ' + service)); return; }
        try {
          var result = JSON.parse(stdout);
          if (!result || result.returnValue !== true) throw Error('Luna rejected: ' + service);
          resolve(result);
        } catch (e) { reject(e); }
      });
  });
}
function pause(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
function snapshot() {
  return Promise.all([
    luna('com.webos.surfacemanager/getForegroundAppState', {}),
    luna('com.webos.surfacemanager/getForegroundAppInfo', {}),
    luna('com.webos.surfacemanager/getFocusedWindowInfo', {}),
    luna('com.webos.service.systemUIManager/getForegroundAppInfo', {})
  ]).then(function (all) {
    function ids(reply, key) {
      if (!Array.isArray(reply[key])) throw Error('Invalid ' + key);
      return reply[key].map(function (entry) {
        if (!entry || typeof entry.appId !== 'string') throw Error('Invalid app identity');
        return entry.appId;
      });
    }
    return {at: Date.now(), fullscreen: all[0].appId, surfaces: ids(all[1], 'foregroundAppInfo'),
      focus: ids(all[2], 'focusedWindowInfo'), native: ids(all[3], 'foregroundAppInfo')};
  });
}
function checkSource(view, opening, expected) {
  if (SOURCES.indexOf(view.fullscreen) < 0 || (expected && view.fullscreen !== expected) || !view.focus.length ||
      view.surfaces.indexOf(view.fullscreen) < 0) throw Error('Expected source is not current');
  var allowed = function (id) { return id === view.fullscreen || (!opening && id === WEB); };
  if (!view.surfaces.every(allowed) || !view.focus.every(allowed) ||
      view.native.some(function (id) { return !(!opening && id === NATIVE); })) throw Error('Another overlay is present');
  return view;
}
function validState(body) {
  return body && typeof body === 'object' && !Array.isArray(body) &&
    typeof body.sequence === 'number' && isFinite(body.sequence) && body.sequence === Math.floor(body.sequence) &&
    body.sequence > 0 && body.sequence <= 9007199254740991 &&
    typeof body.visible === 'boolean' && typeof body.main === 'boolean' &&
    (!body.main || body.visible) && typeof body.selected === 'number' && body.selected === Math.floor(body.selected) &&
    body.selected >= 0 && body.selected <= 8;
}
function makeSession(config) {
  var now = config.now || Date.now, token = config.token, deadline = config.deadline;
  if (!/^[0-9a-f]{64}$/.test(token) || deadline <= now() || deadline > now() + HARD_LIMIT) throw Error('Invalid session');
  var value = {revision: 1, alive: true, visible: false, main: false, selected: 0, expiresAt: Math.min(deadline, now() + 8000)};
  var sequence = 0, stopped = false, reason = '';
  function publish() { if (config.changed) config.changed(copy()); }
  function copy() {
    return {revision: value.revision, alive: value.alive, visible: value.visible,
      main: value.main, selected: value.selected, expiresAt: value.expiresAt};
  }
  function stop(why) {
    if (stopped) return false;
    stopped = true; reason = why; value.alive = false; value.visible = false; value.main = false;
    value.expiresAt = now(); value.revision++; publish();
    if (config.stopped) config.stopped(why);
    return true;
  }
  return {
    get: copy,
    stop: stop,
    reason: function () { return reason; },
    arm: function () {
      if (stopped || sequence || now() >= deadline) return false;
      value.expiresAt = Math.min(deadline, now() + 8000); value.revision++; publish(); return true;
    },
    expire: function () { if (!stopped && (now() >= deadline || now() >= value.expiresAt)) stop('lease-expired'); },
    launched: function () {
      if (stopped) return false;
      if (now() >= deadline || now() >= value.expiresAt) { stop('lease-expired'); return false; }
      if (sequence > 0) return true;
      value.expiresAt = Math.min(deadline, now() + LEASE); value.revision++; publish(); return true;
    },
    accept: function (body) {
      if (stopped) return {status: 410, error: 'ended'};
      if (!validState(body)) return {status: 400, error: 'invalid-state'};
      if (body.sequence <= sequence) return {status: 409, error: 'stale-sequence'};
      if (now() >= deadline || now() >= value.expiresAt) { stop('lease-expired'); return {status: 410, error: 'expired'}; }
      sequence = body.sequence;
      if (!body.visible) { stop('web-hidden'); return {status: 200}; }
      value.visible = true; value.main = body.main; value.selected = body.selected;
      value.expiresAt = Math.min(deadline, now() + LEASE); value.revision++; publish();
      return {status: 200};
    }
  };
}
function run(config) {
  var base = path.resolve(config.base), token = crypto.randomBytes(32).toString('hex');
  var runtime = path.resolve(config.runtime || base);
  var deadline = Date.now() + Math.min(config.duration || HARD_LIMIT, HARD_LIMIT);
  var server, held = null, heldTimer = null, sockets = [], finished = false, closing = false;
  var launchedNative = false, webLaunched = false, nativeLoaded = false, nativeObserved = false, nativeDestroyed = false;
  var timer = null, events = [], resolveRun, rejectRun, initial, stage = 'checking';
  var startupExpiresAt = 0;
  var pendingLaunch = Promise.resolve(), cancelled = false, cancelPendingWeb = false, webAttempted = false;
  var result = {startedAt: Date.now(), status: 'starting', deadline: deadline, events: events};
  var resultFile = path.join(base, 'session-result.json');
  function save() {
    fs.writeFileSync(resultFile + '.tmp', JSON.stringify(result, null, 2) + '\n', {mode: 384});
    fs.renameSync(resultFile + '.tmp', resultFile);
  }
  function note(event, detail) {
    var entry = {event: event, at: Date.now(), detail: detail || ''};
    if (events.length < 2000) events.push(entry);
    if (config.log) config.log(entry); else console.log(JSON.stringify(entry));
  }
  function changeStage(next) { stage = next; if (config.stage) config.stage(next); }
  function cancel(reason) {
    if (cancelled || finished) return;
    cancelled = true; cancelPendingWeb = stage !== 'active';
    session.stop(reason || 'cancelled');
  }
  function checkCancel() {
    if (config.cancelled && config.cancelled()) cancel('cancelled');
    return cancelled;
  }
  function running() {
    checkCancel();
    if (finished || closing || !session.get().alive) throw Error('Session ended before launch');
  }
  function launchWeb(plain) {
    running(); webAttempted = true;
    var params = {controlCentre: true, overlayRequestId: 'native-' + token};
    if (plain) params.nativeBlurFallbackToken = token;
    else params.nativeBlur = {token: token, port: PORT};
    pendingLaunch = luna('com.webos.applicationManager/launch', {id: WEB, keepAlive: true, params: params});
    return pendingLaunch.then(function () { webLaunched = true; });
  }
  function cancelOwnedWeb() {
    if (!cancelled || !cancelPendingWeb || !webAttempted) return Promise.resolve();
    return luna('com.webos.applicationManager/launch', {id: WEB, keepAlive: true,
      params: {nativeBlurCancelToken: token, overlayRequestId: 'native-cancel-' + token}}).catch(function () {});
  }
  function send(res, status, data) {
    if (!res || res.finished || res.destroyed) return;
    res.writeHead(status, {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': res.nativeBlurOrigin || 'null',
      'Cache-Control': 'no-store', 'Connection': 'close'});
    res.end(JSON.stringify(data));
  }
  function releaseHeld(state) {
    clearTimeout(heldTimer); heldTimer = null;
    var response = held; held = null;
    if (response) send(response, 200, state);
  }
  var session = makeSession({token: token, deadline: deadline, changed: releaseHeld, stopped: function (reason) {
    note('stopping', reason);
    if (stage !== 'checking') cleanup(reason);
  }});
  function finish(error) {
    if (finished) return;
    finished = true; clearInterval(timer); timer = null; releaseHeld(session.get());
    result.finishedAt = Date.now(); result.reason = session.reason(); result.nativeDestroyed = nativeDestroyed;
    result.status = error ? 'failed' : 'closed'; if (error) result.error = error.message;
    if (server && server.listening) server.close();
    sockets.slice().forEach(function (socket) { socket.destroy(); });
    process.removeListener('SIGTERM', onTerm); process.removeListener('SIGINT', onInt);
    try { save(); if (config.completed) config.completed(result); } catch (saveError) { error = error || saveError; }
    if (error) rejectRun(error); else resolveRun(result);
  }
  function onTerm() { cancel('sigterm'); }
  function onInt() { cancel('sigint'); }
  function cleanup(reason) {
    if (closing) return;
    closing = true; changeStage('closing');
    if (session.get().alive) session.stop(reason);
    // A timed-out/cancelled launch may still be delivered. Wait for its bounded
    // command before closing native or sending the token-owned web cancellation.
    pendingLaunch.catch(function () {}).then(function () {
      return launchedNative ? luna('com.webos.service.systemUIManager/closeByAppId', {appId: NATIVE}).catch(function () {}) : null;
    }).then(cancelOwnedWeb).then(function () {
      // HTTP stays alive for the native stop response. Its own lease provides
      // an independent exit even if a repeated native close event is ignored.
      return pause(4500);
    }).then(function () { return snapshot(); }).then(function (view) {
      result.final = view;
      if (view.native.indexOf(NATIVE) >= 0) throw Error('Native host remains foreground');
      if (nativeObserved && !nativeDestroyed) throw Error('Native destruction was not observed');
      result.cleanupVerified = true;
      checkCancel();
      if (!cancelled && !webLaunched && launchedNative && (result.startError || reason === 'lease-expired') &&
          ['sigterm','sigint'].indexOf(reason) < 0) {
        // Native has finished before fallback; never reopen above another app.
        checkSource(view, true, initial.fullscreen);
        webAttempted = true;
        pendingLaunch = luna('com.webos.applicationManager/launch', {id: WEB, keepAlive: true,
          params: {controlCentre: true, overlayRequestId: 'native-fallback-' + token, nativeBlurFallbackToken: token}});
        return pendingLaunch.then(function () { result.fallbackLaunched = true; webLaunched = true; }, function () {})
          .then(function () { checkCancel(); return cancelOwnedWeb(); }).then(function () { finish(); });
      }
      finish();
    }).catch(finish);
  }
  function authorize(req, bodyToken) {
    var origin = req.headers.origin;
    return req.socket.remoteAddress === '127.0.0.1' && (!origin || origin === 'null' || origin === WEB_ORIGIN) && bodyToken === token;
  }
  function request(req, res) {
    res.nativeBlurOrigin = req.headers.origin === WEB_ORIGIN ? WEB_ORIGIN : 'null';
    req.setTimeout(3000, function () { req.destroy(); });
    var address;
    try { address = url.parse(req.url, true); } catch (e) { send(res, 400, {error: 'url'}); req.resume(); return; }
    if (req.method === 'GET' && address.pathname === '/native') {
      if (!authorize(req, address.query.token)) { send(res, 403, {error: 'unauthorized'}); return; }
      var after = Number(address.query.after), current = session.get();
      if (!/^\d{1,16}$/.test(address.query.after || '') || !isFinite(after) || after > 9007199254740991) {
        send(res, 400, {error: 'revision'}); return;
      }
      if (!current.alive || after !== current.revision) { send(res, 200, current); return; }
      releaseHeld(current); held = res;
      heldTimer = setTimeout(function () { releaseHeld(session.get()); }, 900);
      res.on('close', function () { if (held === res) { clearTimeout(heldTimer); held = null; heldTimer = null; } });
      return;
    }
    if (req.method !== 'POST' || ['/state', '/event'].indexOf(address.pathname) < 0) {
      send(res, 404, {error: 'route'}); req.resume(); return;
    }
    var chunks = [], length = 0, rejected = false;
    req.on('data', function (part) {
      length += part.length;
      if (length > BODY_LIMIT) { rejected = true; send(res, 413, {error: 'size'}); req.destroy(); return; }
      chunks.push(part);
    });
    req.on('error', function () {});
    req.on('end', function () {
      if (rejected) return;
      var body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { send(res, 400, {error: 'json'}); return; }
      if (!body || !authorize(req, body.token)) { send(res, 403, {error: 'unauthorized'}); return; }
      if (address.pathname === '/state') {
        var before = session.get(), accepted = session.accept(body), after = session.get();
        if (accepted.status === 200 && (before.visible !== after.visible || before.main !== after.main || before.selected !== after.selected))
          note('web-state', {visible: after.visible, main: after.main, selected: after.selected, sequence: body.sequence});
        send(res, accepted.status, {ok: accepted.status === 200, error: accepted.error});
      } else {
        if (['loaded', 'takeover', 'render', 'finish', 'destroyed', 'error'].indexOf(body.event) < 0) {
          send(res, 400, {error: 'event'}); return;
        }
        nativeObserved = true;
        if (body.event === 'loaded') nativeLoaded = true;
        if (body.event === 'destroyed') nativeDestroyed = true;
        note('native-' + body.event, String(body.detail || '').slice(0, 200));
        send(res, 200, {ok: true});
        if (['finish','destroyed','error'].indexOf(body.event) >= 0 && !closing) session.stop('native-' + body.event);
      }
    });
  }
  function waitUntil(label, ms, check) {
    var end = Date.now() + ms;
    function checkWaiting() {
      if (closing || !session.get().alive) throw Error('Session ended while ' + label);
      if (Date.now() >= end) throw Error('Timed out: ' + label);
    }
    function next() {
      checkWaiting();
      return Promise.resolve().then(check).then(function (answer) {
        checkWaiting();
        if (answer) return answer;
        return pause(150).then(next);
      });
    }
    return Promise.resolve().then(next);
  }
  return new Promise(function (resolve, reject) {
    resolveRun = resolve; rejectRun = reject;
    if (!fs.statSync(path.join(runtime, 'Host.qml')).isFile() || !fs.statSync(path.join(runtime, 'Backdrop.qml')).isFile()) throw Error('Native files missing');
    if (fs.existsSync(resultFile)) throw Error('Use a fresh session directory');
    snapshot().then(function (view) {
      running();
      initial = checkSource(view, true, config.sourceAppId); result.initial = initial;
      return new Promise(function (resolveListen, rejectListen) {
        server = http.createServer(request); server.maxConnections = 12;
        server.on('connection', function (socket) {
          sockets.push(socket); socket.on('close', function () { var i = sockets.indexOf(socket); if (i >= 0) sockets.splice(i, 1); });
        });
        server.once('error', rejectListen); server.listen(PORT, '127.0.0.1', resolveListen);
      });
    }).then(function () {
      running(); changeStage('native');
      if (!session.arm()) throw Error('Session expired before native launch');
      startupExpiresAt = session.get().expiresAt;
      timer = setInterval(function () { checkCancel(); session.expire(); }, 250);
      process.once('SIGTERM', onTerm); process.once('SIGINT', onInt);
      note('native-launch'); launchedNative = true;
      pendingLaunch = luna('com.webos.service.systemUIManager/launch', {appId: NATIVE, main: 'file://' + runtime + '/Host.qml',
        defaultWindowType: 'overlay', windowType: '_WEBOS_SYSTEM_UI_TYPE_OVERLAY',
        blurToken: token, blurPort: PORT, blurSessionDeadline: deadline});
      return pendingLaunch;
    }).then(function () {
      return waitUntil('native readiness', 7000, function () {
        if (!nativeLoaded) return false;
        return snapshot().then(function (view) { checkSource(view, false, initial.fullscreen); return view.native.indexOf(NATIVE) >= 0; });
      });
    }).then(function () {
      running(); changeStage('web'); note('web-launch');
      return launchWeb(false);
    }).then(function () {
      webLaunched = true;
      // A cold web page can take longer than five seconds after SAM accepts it.
      // Share the native startup lease; web heartbeats cannot extend this ceiling.
      return waitUntil('web focus', Math.max(0, startupExpiresAt - Date.now()), function () {
        return snapshot().then(function (view) { checkSource(view, false, initial.fullscreen); return view.focus.indexOf(WEB) >= 0; });
      });
    }).then(function () {
      if (closing || !session.get().alive || !session.launched()) throw Error('Session ended before active');
      changeStage('active'); result.status = 'active'; note('active'); save();
    }).catch(function (error) {
      result.startError = error.message; note('start-failed', error.message);
      if (stage === 'checking') {
        // No native launch was attempted. Production may use a plain panel only
        // after a fresh source check; a cancelled opening never falls back.
        if (config.fallback && initial && !checkCancel()) {
          changeStage('fallback');
          timer = setInterval(checkCancel, 100);
          snapshot().then(function (view) { checkSource(view, true, initial.fullscreen); return launchWeb(true); })
            .then(function () { result.fallbackLaunched = true; result.cleanupVerified = true; checkCancel(); return cancelOwnedWeb(); })
            .then(function () { if (!closing) finish(); }, function (failure) { if (!closing) finish(failure); });
        } else finish(error);
        return;
      }
      session.stop('startup-failed');
    });
  });
}
module.exports = {makeSession: makeSession, validState: validState, checkSource: checkSource, run: run, sources: SOURCES.slice()};
if (require.main === module) {
  var baseArg = process.argv[2];
  if (!baseArg || path.resolve(baseArg).indexOf('/home/root/lg-tv-vibehack/trials/native-blur-integrated-') !== 0)
    throw Error('Use an owned native-blur-integrated trial directory');
  run({base: baseArg}).then(function (result) { console.log(JSON.stringify({status: result.status, cleanupVerified: result.cleanupVerified})); },
    function (error) { console.error(error.message); process.exitCode = 1; });
}
