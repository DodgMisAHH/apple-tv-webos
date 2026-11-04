/* Optional, session-owned native background. Ordinary launches do no reporting. */
(function () {
  'use strict';
  var started = false, session = null, observer = null, activeHooks = false;
  var settleTimer = null, heartbeatTimer = null, flight = null, queued = null;
  var pageHidden = false;

  function parameters(event) {
    try {
      var detail = event && event.detail;
      if (typeof detail === 'string') detail = JSON.parse(detail);
      if (detail && typeof detail === 'object' && Object.keys(detail).length) return detail;
      // WAM can update launchParams while dispatching an empty relaunch event.
      // Match the overlay controller's fallback so retained pages use that token.
      var value = window.PalmSystem ? window.PalmSystem.launchParams : null;
      return typeof value === 'string' ? JSON.parse(value || '{}') : (value || {});
    } catch (error) { return {}; }
  }
  function configuration(params) {
    var value = params && params.nativeBlur;
    return value && typeof value.token === 'string' && /^[a-fA-F0-9]{64}$/.test(value.token) && value.port === 48740 ?
      {token:value.token} : null;
  }
  function state() {
    var body = document.body, tiles = document.getElementById('ccTiles'), detail = document.getElementById('ccDetail');
    var selected = 0, count = 0, list = tiles ? tiles.querySelectorAll('.ccTile') : [], i;
    for (i = 0; i < list.length; i++) {
      if (list[i].classList.contains('selected')) { selected = i; count++; }
    }
    var open = !!body && body.classList.contains('ccOpen');
    var wall = !!body && body.classList.contains('wallOpen');
    var visible = !pageHidden && !document.hidden && !!body && !body.classList.contains('overlayDormant') && (open || wall);
    return {visible:visible, main:visible && open && !wall && !!tiles && !tiles.hidden && !!detail && detail.hidden === true && list.length === 9 && count === 1,
      selected:list.length === 9 && count === 1 ? selected : 0};
  }
  function same(a, b) { return a && b && a.visible === b.visible && a.main === b.main && a.selected === b.selected; }
  function clearTimers() {
    clearTimeout(settleTimer); settleTimer = null;
    clearTimeout(heartbeatTimer); heartbeatTimer = null;
  }
  function releaseFlight(abort) {
    var old = flight;
    flight = null;
    if (!old) return;
    old.xhr.onload = old.xhr.onerror = old.xhr.ontimeout = old.xhr.onabort = null;
    if (abort) { try { old.xhr.abort(); } catch (error) {} }
  }
  function removeActiveHooks() {
    if (observer) observer.disconnect();
    observer = null;
    if (!activeHooks) return;
    activeHooks = false;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('resize', onResize);
  }
  function fail(current) {
    if (session !== current || current.failed) return;
    current.failed = true; current.terminal = true;
    clearTimers(); queued = null; releaseFlight(true); removeActiveHooks();
  }
  function flush() {
    if (flight || !queued || !session || session.failed) return;
    var current = session, next = queued;
    queued = null;
    if (current.terminal && next.visible) return;
    var xhr, request;
    try {
      xhr = new XMLHttpRequest();
      request = {xhr:xhr, session:current};
      flight = request;
      xhr.open('POST', 'http://127.0.0.1:48740/state', true);
      xhr.setRequestHeader('Content-Type', 'text/plain');
      xhr.timeout = 1200;
      xhr.onload = function () {
        if (flight !== request || session !== current) return;
        var ok = xhr.status >= 200 && xhr.status < 300;
        releaseFlight(false);
        if (!ok) { fail(current); return; }
        flush();
      };
      xhr.onerror = xhr.ontimeout = xhr.onabort = function () {
        if (flight === request && session === current) fail(current);
      };
      // Sequence numbers are never reused within a token, including aborted work.
      // The server rejects stale arrivals; callbacks also fence the active request.
      xhr.send(JSON.stringify({token:current.token, sequence:++current.sequence,
        visible:next.visible, main:next.main, selected:next.selected}));
    } catch (error) { fail(current); }
  }
  function send(next, barrier) {
    if (!session || session.failed) return;
    queued = {visible:next.visible, main:next.main, selected:next.selected};
    if (barrier) releaseFlight(true);
    flush();
  }
  function retire() {
    if (!session || session.terminal) return;
    var current = session, last = current.last || {selected:0};
    current.terminal = true; current.settled = false;
    clearTimers(); queued = null; releaseFlight(true); removeActiveHooks();
    // One final bounded POST is the only request allowed after hiding. A new
    // token cancels it too; the native receipt lease handles a lost final POST.
    if (current.everVisible) send({visible:false, main:false, selected:last.selected}, true);
  }
  function armHeartbeat(current) {
    var timer = setTimeout(function () {
      if (heartbeatTimer !== timer || session !== current || current.terminal) return;
      heartbeatTimer = null;
      heartbeat(current);
    }, 1000);
    heartbeatTimer = timer;
  }
  function heartbeat(current) {
    if (session !== current || current.terminal) return;
    var now = state();
    if (!same(now, session.last)) { refresh(false); return; }
    if (!now.visible) return;
    send({visible:true, main:now.main && session.settled, selected:now.selected}, false);
    if (session === current && !current.terminal) armHeartbeat(current);
  }
  function refresh(force) {
    if (!session || session.terminal) return;
    var current = session, next = state();
    if (!next.visible) {
      if (current.everVisible) retire();
      // A new-token relaunch can arrive before PalmSystem.activate finishes.
      // Wait without posting terminal hidden state or starting any timers.
      return;
    }
    current.everVisible = true;
    if (!force && same(next, current.last)) return;
    if (!force && current.settled && current.last && current.last.main && next.main) {
      // A settled main-grid selection keeps the fixed native masks in place.
      // Keep the backdrop visible and coalesce behind any active request; unlike
      // a view/geometry barrier, this must not abort an older selection update.
      current.last = next;
      send(next, false);
      // refresh can also be reached from the heartbeat that consumed its timer.
      if (session === current && !current.terminal && heartbeatTimer === null) armHeartbeat(current);
      return;
    }
    current.last = next; current.settled = false;
    clearTimers();
    // A hide barrier must reach the server before any newly settled state.
    // Abort an older flight so it cannot delay this safety transition.
    send({visible:true, main:false, selected:next.selected}, true);
    if (session !== current || current.terminal) return;
    if (next.main) {
      var timer = setTimeout(function () {
        if (settleTimer !== timer || session !== current || current.terminal) return;
        settleTimer = null;
        var latest = state();
        if (!same(latest, next)) { refresh(true); return; }
        current.settled = true;
        send(latest, false);
      }, 180);
      settleTimer = timer;
    }
    armHeartbeat(current);
  }
  function onMutation() { refresh(false); }
  function onVisibility() { pageHidden = !!document.hidden; refresh(false); }
  function onPageHide() { pageHidden = true; retire(); }
  function onPageShow() { pageHidden = false; refresh(true); }
  function onResize() { refresh(true); }
  function addActiveHooks() {
    var body = document.body, tiles = document.getElementById('ccTiles'), detail = document.getElementById('ccDetail');
    if (!body || !tiles || !detail || typeof MutationObserver === 'undefined') { fail(session); return; }
    try {
      observer = new MutationObserver(onMutation);
      observer.observe(body, {attributes:true, attributeFilter:['class']});
      observer.observe(tiles, {attributes:true, attributeFilter:['hidden','class'], subtree:true});
      observer.observe(detail, {attributes:true, attributeFilter:['hidden']});
      activeHooks = true;
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', onPageHide);
      window.addEventListener('pageshow', onPageShow);
      window.addEventListener('resize', onResize);
    } catch (error) { fail(session); }
  }
  function configure(config) {
    if (!config) { retire(); return; }
    if (session && session.token === config.token) {
      // Neither failure nor actual hiding can revive the same native session.
      if (!session.terminal) refresh(true);
      return;
    }
    clearTimers(); queued = null; releaseFlight(true); removeActiveHooks();
    session = {token:config.token, sequence:0, terminal:false, failed:false, everVisible:false, settled:false, last:null};
    pageHidden = !!document.hidden;
    addActiveHooks();
    refresh(true);
  }
  function isCancel(params) { return Object.prototype.hasOwnProperty.call(params, 'nativeBlurCancelToken'); }
  function onRelaunch(event) {
    var params = parameters(event);
    if (isCancel(params)) {
      if (session && params.nativeBlurCancelToken === session.token) retire();
      return;
    }
    configure(configuration(params));
  }
  function start() {
    if (started || !window.PalmSystem) return;
    started = true;
    // This single passive hook allows a retained ordinary page to accept a
    // later explicitly authorized native token without creating a new page.
    document.addEventListener('webOSRelaunch', onRelaunch);
    var params = parameters();
    if (!isCancel(params)) configure(configuration(params));
  }
  function stop() {
    clearTimers(); queued = null; releaseFlight(true); removeActiveHooks();
    if (session) session.terminal = true;
    if (started) document.removeEventListener('webOSRelaunch', onRelaunch);
    started = false;
  }
  window.NativeBlurClient = {start:start, stop:stop};
})();
