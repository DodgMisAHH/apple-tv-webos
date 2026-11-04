#!/usr/bin/env node
/* Native Home lifecycle bridge to the existing web UI. ES5 / Node 8. */
'use strict';

var HOME_ID = 'com.webos.app.home';
var RUNTIME = '/home/root/lg-tv-vibehack/system-home/home.js';
var MAX_MESSAGE = 128 * 1024;
var createStartupGuard = require('./startup-guard').createGuard;

function object(value) {
  var count = 0;
  while (typeof value === 'string' && count++ < 4) {
    try { value = JSON.parse(value); } catch (e) { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function isPreload(value, depth) {
  var message = object(value);
  depth = depth || 0;
  if (!message || depth > 4) return false;
  if (message.reason === 'preload' || message.preload === 'full' || message.snapshot === true) return true;
  return isPreload(message.parameters, depth + 1) || isPreload(message.params, depth + 1);
}

function settingsNotification(value, depth) {
  var message = object(value), found;
  depth = depth || 0;
  if (!message || depth > 4) return null;
  found = settingsNotification(message.parameters, depth + 1) || settingsNotification(message.params, depth + 1);
  if (found) return found;
  if (message.settingsChanged === true && typeof message.settingsToken === 'string' &&
      message.settingsToken.length > 0 && message.settingsToken.length <= 128 &&
      !/[\u0000-\u001f\u007f]/.test(message.settingsToken)) {
    return { settingsChanged: true, settingsToken: message.settingsToken };
  }
  return null;
}

function isSettingsRefresh(value, depth) {
  var message = object(value);
  depth = depth || 0;
  return !!message && depth <= 4 && (message.settingsChanged === true ||
    isSettingsRefresh(message.parameters, depth + 1) || isSettingsRefresh(message.params, depth + 1));
}

function launchParameters(value) {
  // SAM arguments are lifecycle metadata, not permission to forward arbitrary parameters.
  var params = { home: true, reload: false }, settings = settingsNotification(value);
  if (settings) { params.settingsChanged = true; params.settingsToken = settings.settingsToken; }
  return params;
}

function readPid(value) {
  var text = String(value || '').trim();
  return /^[1-9][0-9]*$/.test(text) && Number(text) <= 2147483647 ? Number(text) : null;
}

function ownsCommand(cmdline, runtimePath) {
  var args = String(cmdline || '').split('\u0000');
  return /(^|\/)node$/.test(args[0] || '') && args[1] === runtimePath;
}

function createRuntime(options) {
  options = options || {};
  var fs = options.fs || require('fs');
  var cp = options.cp || require('child_process');
  var proc = options.process || process;
  var schedule = options.setTimeout || setTimeout;
  var unschedule = options.clearTimeout || clearTimeout;
  var now = options.now || function () { return new Date().toISOString(); };
  var paths = options.paths || {};
  var runtimePath = paths.runtime || RUNTIME;
  var stateDir = paths.state || '/tmp/lg-tv-system-home';
  var pidPath = paths.pid || stateDir + '/runtime.pid';
  var logPath = paths.log || stateDir + '/runtime.log';
  var shownPath = paths.shown || stateDir + '/shown';
  var pendingPath = paths.pending || stateDir + '/pending-params.json';
  var activePath = paths.active || '/tmp/lg-tv-system-home.active';
  var requestPath = paths.request || '/home/root/lg-tv-vibehack/system-home/wam-launch.json';
  var procPath = paths.proc || '/proc';
  var onExit = options.onExit || function (code) { proc.exit(code); };
  var stopped = false, claimed = false, running = false;
  var timers = [], children = [], listeners = [];
  var request = null, launching = false, registration = null, registrationMethod = 0;
  var pendingSettings = null;
  var appEventsFailures = 0;
  var methods = ['registerApp', 'registerNativeApp'];
  var startupGuard = createStartupGuard({ closeApp: closeStartingApp, log: log });

  function log(message) {
    try { fs.appendFileSync(logPath, now() + ' [' + proc.pid + '] ' + message + '\n'); } catch (e) {}
  }
  function active() { return !stopped && fs.existsSync(activePath); }
  function later(fn, ms) {
    var timer = schedule(function () {
      var at = timers.indexOf(timer);
      if (at >= 0) timers.splice(at, 1);
      if (!stopped) fn();
    }, ms);
    timers.push(timer);
    return timer;
  }
  function cancel(timer) {
    if (!timer) return;
    unschedule(timer);
    var at = timers.indexOf(timer);
    if (at >= 0) timers.splice(at, 1);
  }
  function forget(child) {
    var at = children.indexOf(child);
    if (at >= 0) children.splice(at, 1);
  }
  function track(child) {
    children.push(child);
    child.on('exit', function () { forget(child); });
    return child;
  }
  function kill(child) {
    if (!child || children.indexOf(child) < 0) return;
    try { child.kill('SIGTERM'); } catch (e) {}
  }
  function listen(event, handler) {
    proc.on(event, handler);
    listeners.push({ event: event, handler: handler });
  }
  function stop(code, reason) {
    if (stopped) return;
    stopped = true;
    startupGuard.stop();
    log(reason || 'stopped');
    timers.splice(0).forEach(unschedule);
    children.slice().forEach(kill);
    listeners.splice(0).forEach(function (listener) { proc.removeListener(listener.event, listener.handler); });
    if (claimed) {
      try {
        if (fs.readFileSync(pidPath, 'utf8').trim() === String(proc.pid)) fs.unlinkSync(pidPath);
      } catch (e) {}
    }
    onExit(code || 0);
  }
  function processAlive(pid) {
    try { proc.kill(pid, 0); return true; }
    catch (e) { return e.code !== 'ESRCH'; }
  }
  function publishPending(pid, params) {
    if (!params.settingsChanged) return false;
    var temporary = pendingPath + '.' + proc.pid;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ pid: pid, at: new Date().getTime(), parameters: params }), { mode: 384 });
      fs.renameSync(temporary, pendingPath);
      return true;
    } catch (e) { log('could not forward settings to existing runtime: ' + e.message); return false; }
    finally { try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (ignore) {} }
  }
  function takePending() {
    var saved, text, age;
    try {
      if (fs.statSync(pendingPath).size > 2048) return null;
      text = fs.readFileSync(pendingPath, 'utf8');
      saved = object(text);
      if (fs.readFileSync(pendingPath, 'utf8') === text) fs.unlinkSync(pendingPath);
      age = saved && new Date().getTime() - saved.at;
      if (saved && saved.pid === proc.pid && typeof saved.at === 'number' && age >= 0 && age <= 10000) {
        return settingsNotification(saved.parameters);
      }
    } catch (e) {}
    return null;
  }
  function claim(preload, params, settingsRefresh) {
    var attempt, fd, previous, pid, cmdline;
    for (attempt = 0; attempt < 3; attempt++) {
      try {
        fd = fs.openSync(pidPath, 'wx', 384);
        fs.writeSync(fd, String(proc.pid) + '\n');
        fs.closeSync(fd);
        claimed = true;
        return true;
      } catch (e) {
        if (fd !== undefined) { try { fs.closeSync(fd); } catch (ignore) {} }
        fd = undefined;
        if (e.code !== 'EEXIST') { log('cannot claim runtime PID: ' + e.message); return false; }
      }
      try { previous = fs.readFileSync(pidPath, 'utf8'); } catch (e) { continue; }
      pid = readPid(previous);
      if (!pid) { log('invalid existing PID file; refusing to replace it'); return false; }
      if (processAlive(pid)) {
        try { cmdline = fs.readFileSync(procPath + '/' + pid + '/cmdline', 'utf8'); } catch (e) { cmdline = ''; }
        if (pid !== proc.pid && ownsCommand(cmdline, runtimePath)) {
          if (!preload) {
            var signal = settingsRefresh ? (publishPending(pid, params) ? 'SIGWINCH' : null) : 'SIGUSR2';
            try { if (signal) proc.kill(pid, signal); } catch (e) { log('existing runtime notification failed: ' + e.message); }
          }
          log('existing owned runtime ' + pid + (preload ? ' retains preload' : ' notified'));
        } else log('PID ' + pid + ' is not a verified runtime; left untouched');
        return false;
      }
      // Do not remove a file another process replaced during the liveness check.
      try { if (fs.readFileSync(pidPath, 'utf8') === previous) fs.unlinkSync(pidPath); } catch (e) {}
    }
    log('runtime PID contention; exiting');
    return false;
  }
  function loadRequest() {
    var loaded = object(fs.readFileSync(requestPath, 'utf8'));
    var desc = loaded && object(loaded.appDesc);
    if (!desc || desc.id !== HOME_ID || desc.type !== 'web' || typeof desc.folderPath !== 'string' ||
        desc.folderPath.charAt(0) !== '/' || desc.main !== 'index.html') throw new Error('Invalid Home web app descriptor');
    return {
      appDesc: desc,
      parameters: launchParameters(),
      launchingAppId: '',
      launchingProcId: '',
      instanceId: typeof loaded.instanceId === 'string' ? loaded.instanceId : 'lg-tv-system-home'
    };
  }
  function responseValue(stdout) {
    var text = String(stdout || '').trim(), parsed = object(text);
    if (parsed) return parsed;
    var lines = text.split('\n'), i;
    for (i = lines.length - 1; i >= 0; i--) {
      parsed = object(lines[i]);
      if (parsed) return parsed;
    }
    return null;
  }
  function show(reason, values) {
    if (!active()) { stop(0, 'activation removed'); return; }
    var params = launchParameters(values);
    if (launching) {
      if (params.settingsChanged) pendingSettings = params;
      log('coalesced Home request: ' + reason);
      return;
    }
    launching = true;
    attemptLaunch(0, false, reason, params);
  }
  function finishLaunch() {
    launching = false;
    if (pendingSettings) {
      var next = pendingSettings;
      pendingSettings = null;
      show('pending settings', next);
    }
  }
  function attemptLaunch(round, stringDescriptor, reason, params) {
    if (!active()) { stop(0, 'activation removed'); return; }
    var payload = {
      appDesc: stringDescriptor ? JSON.stringify(request.appDesc) : request.appDesc,
      parameters: launchParameters(params),
      launchingAppId: request.launchingAppId,
      launchingProcId: request.launchingProcId,
      instanceId: request.instanceId
    };
    var completed = false, child;
    function done(error, stdout) {
      if (completed || stopped) return;
      completed = true;
      if (child) forget(child);
      if (!active()) { stop(0, 'activation removed'); return; }
      var answer = responseValue(stdout);
      if (!error && answer && answer.returnValue === true) {
        try { fs.writeFileSync(shownPath, String(new Date().getTime()) + '\n'); }
        catch (e) { log('could not write Home launch acknowledgement: ' + e.message); }
        log('Home launch accepted: ' + reason + (stringDescriptor ? ' (string descriptor)' : ''));
        finishLaunch();
        return;
      }
      log('Home launch refused: round ' + (round + 1) + (stringDescriptor ? ', string' : ', object') +
        (answer && answer.errorText ? ', ' + String(answer.errorText).slice(0, 160) : ''));
      if (!stringDescriptor) return attemptLaunch(round, true, reason, params);
      if (round < 2) later(function () { attemptLaunch(round + 1, false, reason, params); }, 750);
      else { log('Home launch retries exhausted; awaiting a new Home request'); finishLaunch(); }
    }
    try {
      child = track(cp.execFile('/usr/bin/luna-send', ['-w', '5000', '-n', '1',
        'luna://com.palm.webappmanager/launchApp', JSON.stringify(payload)],
      { timeout: 6500, maxBuffer: MAX_MESSAGE }, done));
      child.on('error', function (error) { done(error, ''); });
    } catch (e) { done(e, ''); }
  }
  function lifecycle(message) {
    if (!active()) { stop(0, 'activation removed'); return; }
    message = object(message);
    if (!message) return;
    if (message.event === 'close') { stop(0, 'SAM closed Home'); return; }
    if (message.event === 'relaunch') {
      if (isPreload(message)) log('preload relaunch retained in background');
      else {
        if (!isSettingsRefresh(message)) startupGuard.home();
        show('SAM relaunch', message);
      }
    }
  }
  function closeStartingApp(id) {
    if (!active()) return;
    var child, completed = false;
    function done(error, stdout) {
      if (completed || stopped) return;
      completed = true;
      if (child) forget(child);
      var answer = responseValue(stdout);
      log('Interrupted startup ' + id + ': ' + (!error && answer && answer.returnValue === true ?
        'close accepted' : 'close not confirmed'));
      // No delayed close or Home retry: a subsequent app choice must remain free to open.
    }
    try {
      child = track(cp.execFile('/usr/bin/luna-send', ['-w', '3000', '-n', '1',
        'luna://com.webos.applicationManager/closeByAppId', JSON.stringify({ id: id })],
      { timeout: 4500, maxBuffer: MAX_MESSAGE }, done));
      child.on('error', function (error) { done(error, ''); });
    } catch (e) { done(e, ''); }
  }
  function watchAppEvents() {
    if (!active() || appEventsFailures >= 3) return;
    var child, buffer = '', ended = false, connected = false, timer;
    function failed(reason) {
      if (ended || stopped) return;
      ended = true;
      cancel(timer);
      startupGuard.reset();
      kill(child);
      appEventsFailures++;
      log('App lifecycle observation ended: ' + reason);
      later(watchAppEvents, 1000 * appEventsFailures);
    }
    try {
      child = track(cp.spawn('/usr/bin/luna-send', ['-i',
        'luna://com.webos.applicationManager/getAppLifeEvents', '{"subscribe":true}'],
      { stdio: ['ignore', 'pipe', 'pipe'] }));
      timer = later(function () { failed('subscription timeout'); }, 8000);
      child.stdout.on('data', function (data) {
        if (ended || stopped) return;
        buffer += data.toString();
        if (buffer.length > MAX_MESSAGE) { failed('oversized app event'); return; }
        var lines = buffer.split('\n');
        buffer = lines.pop();
        lines.forEach(function (text) {
          if (ended || stopped) return;
          var message = object(text);
          if (!message) return;
          if (message.returnValue === false) { failed('subscription refused'); return; }
          if (message.subscribed === true && message.returnValue === true) {
            connected = true;
            cancel(timer);
            log('observing app startup lifecycle');
          }
          if (connected) startupGuard.event(isPreload(message) ?
            { appId: message.appId, event: 'preload' } : message);
        });
      });
      if (child.stderr) child.stderr.resume();
      child.on('error', function (error) { failed(error.message); });
      child.on('exit', function () { failed('subscription exited'); });
    } catch (e) { failed(e.message); }
  }
  function register() {
    if (!active()) { stop(0, 'activation removed'); return; }
    if (registrationMethod >= methods.length) { log('registration attempts exhausted; SAM may start a new wrapper on Home'); return; }
    var method = methods[registrationMethod++], buffer = '', ended = false, connected = false;
    var child, timer;
    function failed(reason) {
      if (ended || stopped) return;
      ended = true;
      cancel(timer);
      kill(child);
      if (registration === child) registration = null;
      log(method + ' ended: ' + reason);
      later(register, 250);
    }
    function line(text) {
      var message = object(text);
      if (!message) return;
      if (message.returnValue === false) { failed(String(message.errorText || 'refused').slice(0, 160)); return; }
      if (message.returnValue === true || message.event === 'registered') {
        if (!connected) log('registered with SAM via ' + method);
        connected = true;
        cancel(timer);
      }
      lifecycle(message);
    }
    try {
      child = track(cp.spawn('/usr/bin/luna-send', ['-i', '-a', HOME_ID,
        'luna://com.webos.applicationManager/' + method, '{}'], { stdio: ['ignore', 'pipe', 'pipe'] }));
      registration = child;
      timer = later(function () { failed('registration timeout'); }, 8000);
      child.stdout.on('data', function (data) {
        if (ended || stopped) return;
        buffer += data.toString();
        if (buffer.length > MAX_MESSAGE) { failed('oversized lifecycle message'); return; }
        var lines = buffer.split('\n');
        buffer = lines.pop();
        lines.forEach(function (text) { if (!ended && !stopped) line(text); });
      });
      if (child.stderr) child.stderr.resume();
      child.on('error', function (error) { failed(error.message); });
      child.on('exit', function () { failed('subscription exited'); });
    } catch (e) { failed(e.message); }
  }
  function watchActivation() {
    if (!active()) { stop(0, 'activation removed'); return; }
    later(watchActivation, 1000);
  }
  function start(args) {
    if (running || stopped) return;
    running = true;
    if (!fs.existsSync(activePath)) { stop(0, 'not active; wrapper exits without recursion'); return; }
    try { if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, 448); }
    catch (e) { stop(1, 'cannot create runtime state directory'); return; }
    var preload = (args || []).some(function (arg) { return isPreload(arg); });
    var initialParams = launchParameters();
    (args || []).forEach(function (arg) {
      var params = launchParameters(arg);
      if (params.settingsChanged) initialParams = params;
    });
    // Install before publishing our PID: a duplicate must never send an unhandled signal.
    listen('SIGWINCH', function () {
      var params = takePending();
      if (params) show('duplicate settings notification', params);
    });
    listen('SIGUSR2', function () {
      startupGuard.home();
      show('duplicate Home activation');
    });
    if (!claim(preload, initialParams, (args || []).some(function (arg) { return isSettingsRefresh(arg); }))) {
      stop(0, 'duplicate or unclaimed runtime exits'); return;
    }
    // A prior runtime's acknowledgement cannot confirm this instance's startup.
    try { if (fs.existsSync(shownPath)) fs.unlinkSync(shownPath); }
    catch (e) { stop(1, 'cannot remove stale launch acknowledgement'); return; }
    try { request = loadRequest(); }
    catch (e) { stop(1, e.message); return; }
    listen('SIGTERM', function () { stop(0, 'SIGTERM'); });
    listen('SIGINT', function () { stop(0, 'SIGINT'); });
    listen('SIGHUP', function () { stop(0, 'SIGHUP'); });
    log('runtime started' + (preload ? ' for preload' : ' for Home'));
    register();
    watchAppEvents();
    if (preload) log('preload registered without showing Home');
    else show('start', initialParams);
    watchActivation();
  }
  return { start: start, stop: stop, show: show, lifecycle: lifecycle };
}

module.exports = { createRuntime: createRuntime, object: object, isPreload: isPreload,
  launchParameters: launchParameters, readPid: readPid, ownsCommand: ownsCommand };
if (require.main === module) createRuntime().start(process.argv.slice(2));
