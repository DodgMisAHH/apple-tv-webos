/* Standalone native Control Centre. Home continues to own launcher preferences. */
(function () {
  'use strict';
  var HOME_BASE = 'file:///media/developer/apps/usr/palm/applications/com.gathin.tvhome/';
  var bridges = [], closeTimer = null, parkTimer = null, revealTimer = null, clockTimer = null, toastTimer = null, networkRelease = null, networkTimer = null;
  var started = false, shown = false, active = false, dismissed = false, suspended = false, retained = false, external = null;
  var wallReturn = null, wallGeneration = 0, lastRequestId = null, nativeOwnerToken = null;
  var networkGeneration = 0, networkRetry = 1000;
  var $ = function (id) { return document.getElementById(id); };

  function luna(uri, params, callback) {
    var bridge, expiry = null, released = false, callbackStarted = false;
    function release() {
      if (released) return;
      released = true; clearTimeout(expiry);
      var index = bridges.indexOf(release);
      if (index >= 0) bridges.splice(index, 1);
      if (bridge) {
        bridge.onservicecallback = null;
        try { if (typeof bridge.cancel === 'function') bridge.cancel(); } catch (error) {}
      }
    }
    try {
      bridge = new PalmServiceBridge();
      bridge.onservicecallback = function (message) {
        if (released) return;
        var result;
        try { result = JSON.parse(message); } catch (error) { result = { returnValue:false }; }
        callbackStarted = true;
        try { if (callback) callback(result); }
        finally { if (!params || !params.subscribe) release(); }
      };
      bridges.push(release);
      // VPN writes own a 45-second timeout. Retain their callback until that
      // deadline; this longer bound only cleans up abandoned native bridges.
      if (!params || !params.subscribe) expiry = setTimeout(release, 50000);
      bridge.call(uri, JSON.stringify(params || {}));
    } catch (error) {
      release();
      if (callbackStarted) throw error;
      if (callback) callback({ returnValue:false, errorText:String(error) });
    }
    return release;
  }
  function toast(text) {
    $('toast').textContent = text; $('toast').classList.add('shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').classList.remove('shown'); }, 2600);
  }
  function cancelClose() { clearTimeout(closeTimer); closeTimer = null; }
  function stopLocalWork() {
    cancelClose(); clearTimeout(clockTimer); clockTimer = null;
    clearTimeout(parkTimer); parkTimer = null;
    clearTimeout(revealTimer); revealTimer = null;
    clearTimeout(toastTimer); toastTimer = null; $('toast').classList.remove('shown');
    clearTimeout(networkTimer); networkTimer = null;
    networkGeneration++; networkRetry = 1000;
    if (networkRelease) networkRelease(); networkRelease = null;
  }
  function closeNative() {
    retained = false;
    try { if (window.PalmSystem && typeof window.PalmSystem.keepAlive === 'function') window.PalmSystem.keepAlive(false); } catch (error) {}
    if (typeof window.close === 'function') window.close();
  }
  function parkNative() {
    if (!window.PalmSystem) return;
    if (retained) {
      // hide() is ineffective on the target firmware. deactivate() releases
      // the native overlay surface and focus without destroying its page.
      if (document.hidden) return;
      try {
        window.PalmSystem.deactivate();
        clearTimeout(parkTimer);
        parkTimer = setTimeout(function () {
          parkTimer = null;
          // Never leave an invisible native window holding remote focus if
          // this firmware fails to acknowledge the background transition.
          if (dismissed && !document.hidden) closeNative();
        }, 1000);
        return;
      } catch (error) { retained = false; }
    }
    closeNative();
  }
  function dismiss() {
    if (dismissed) return;
    dismissed = true; active = false; suspended = true; stopLocalWork(); hideWallpaper(false);
    document.body.classList.add('overlayDormant');
    if (window.suspendControlCentre) window.suspendControlCentre();
    if (external) { clearTimeout(external.timer); external = null; }
    // Already-issued one-shot actions may finish while retained, so their
    // pending locks clear normally. Suspended controls cannot start new polls.
    // Subscriptions and scans are released by stopLocalWork/suspendControlCentre.
    if (!retained) bridges.slice().forEach(function (release) { release(); });
    parkNative();
  }
  function requestDismiss() {
    cancelClose();
    // Shared controls call close() before launch()/wallpaper(). Deferring one
    // task lets those explicit actions retain the surface until they complete.
    closeTimer = setTimeout(function () { closeTimer = null; if (!external && !document.body.classList.contains('wallOpen')) dismiss(); }, 0);
  }
  function externalAction(uri, params, title) {
    if (external) return;
    cancelClose();
    var request = { timer:null, release:null }; external = request;
    function finish(result) {
      if (external !== request) return;
      external = null; clearTimeout(request.timer);
      if (result.returnValue === true && (!result.exitCode || result.exitCode === 0)) { dismiss(); return; }
      if (dismissed || document.hidden) return;
      show(); toast(typeof PalmServiceBridge === 'undefined' ? 'Preview · ' + title + ' opens on the TV' : 'Could not open ' + title + '. Try again.');
    }
    request.timer = setTimeout(function () {
      if (request.release) request.release();
      finish({ returnValue:false });
    }, 6500);
    request.release = luna(uri, params, finish);
  }
  function launch(id, title, params) {
    externalAction('luna://com.webos.applicationManager/launch', { id:id, params:params || {} }, title || id);
  }
  function manageHiddenApps() {
    externalAction('luna://org.webosbrew.hbchannel.service/exec', { command:'/home/root/lg-tv-vibehack/golauncher.sh' }, 'Home');
  }
  function updateClock() {
    var now = new Date(), hour = now.getHours(), minute = now.getMinutes();
    var time = (CONFIG.clock24 ? (hour < 10 ? '0' : '') + hour : (hour % 12 || 12)) + ':' + (minute < 10 ? '0' : '') + minute;
    var suffix = CONFIG.clock24 ? '' : (CONFIG.language === 'vi' ? (hour < 12 ? 'SA' : 'CH') : (hour < 12 ? 'am' : 'pm'));
    if ($('clock').textContent !== time) $('clock').textContent = time;
    if ($('ampm').textContent !== suffix) $('ampm').textContent = suffix;
    clearTimeout(clockTimer); clockTimer = null;
    if (!document.hidden && !dismissed && !suspended) clockTimer = setTimeout(updateClock, 60000 - Date.now() % 60000 + 20);
  }
  function watchNetwork() {
    if (networkRelease || dismissed || suspended || document.hidden || typeof PalmServiceBridge === 'undefined') return;
    var generation = ++networkGeneration, failed = false;
    var release = luna('luna://com.palm.connectionmanager/getStatus', { subscribe:true }, function (result) {
      if (generation !== networkGeneration || dismissed || suspended || document.hidden) return;
      if (result.returnValue === false) {
        failed = true; networkGeneration++;
        if (networkRelease) networkRelease(); networkRelease = null;
        $('wifiLabel').textContent = 'Unavailable';
        var delay = networkRetry; networkRetry = Math.min(networkRetry * 2, 30000);
        networkTimer = setTimeout(function () { networkTimer = null; watchNetwork(); }, delay);
        return;
      }
      networkRetry = 1000;
      var label = 'Wi-Fi';
      if (result.wired && result.wired.state === 'connected') label = 'Ethernet';
      else if (result.wifi && result.wifi.state === 'connected') label = result.wifi.ssid || 'Wi-Fi';
      else if (result.isInternetConnectionAvailable === false) label = 'Offline';
      if ($('wifiLabel').textContent !== label) $('wifiLabel').textContent = label;
    });
    // A bridge can fail synchronously before luna() returns its release handle.
    if (failed || generation !== networkGeneration) release();
    else networkRelease = release;
  }
  function loadScript(src, done) {
    var script = document.createElement('script'), completed = false;
    var timer = setTimeout(function () { finish(false); }, 5000);
    function finish(ok) {
      if (completed) return;
      completed = true; clearTimeout(timer); script.onload = null; script.onerror = null;
      if (script.parentNode) script.parentNode.removeChild(script);
      done(ok);
    }
    script.src = src; script.onload = function () { finish(true); }; script.onerror = function () { finish(false); };
    document.body.appendChild(script);
  }
  function wallpaper(onClose) {
    cancelClose(); wallReturn = onClose;
    var generation = ++wallGeneration;
    document.body.classList.add('wallOpen'); $('wallPanel').classList.remove('hidden');
    $('wallQr').innerHTML = ''; $('wallTitle').textContent = CONFIG.language === 'vi' ? 'Đổi hình nền' : 'Change Home wallpaper';
    $('wallScan').textContent = 'Loading wallpaper controls…'; window.WALL_URL = '';
    function current() { return generation === wallGeneration && !dismissed && !document.hidden; }
    function fail(message) { if (!current()) return; hideWallpaper(); toast(message); }
    loadScript((window.OVERLAY_HOME_BASE || HOME_BASE) + 'wall.js?t=' + Date.now(), function (ok) {
      if (!current()) return;
      var url = window.WALL_URL;
      if (!ok || !url) { fail('The wallpaper page is not running. Reboot the TV and try again.'); return; }
      function render(loaded) {
        if (!current()) return;
        if (!loaded || typeof window.qrcode !== 'function') { fail('Wallpaper controls could not load. Try again.'); return; }
        try {
          var qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
          $('wallQr').innerHTML = '<img alt="Scan to change Home wallpaper" src="' + qr.createDataURL(8, 0) + '">';
          $('wallScan').textContent = CONFIG.language === 'vi' ? 'Quét mã này bằng camera điện thoại rồi chọn ảnh.' : 'Scan this code with your phone camera, then pick a photo.';
        } catch (error) { fail('Wallpaper code could not be created. Try again.'); }
      }
      if (typeof window.qrcode === 'function') render(true); else loadScript('qrcode.js', render);
    });
  }
  function hideWallpaper(returnToParent) {
    var callback = wallReturn; wallReturn = null; wallGeneration++;
    document.body.classList.remove('wallOpen'); $('wallPanel').classList.add('hidden');
    if (returnToParent !== false && !dismissed && !document.hidden && callback) callback();
  }
  function show() {
    if (!started || document.hidden) return;
    clearTimeout(parkTimer); parkTimer = null;
    clearTimeout(revealTimer); revealTimer = null;
    document.body.classList.remove('overlayDormant');
    cancelClose(); dismissed = false; suspended = false; shown = true; hideWallpaper(false);
    if (window.resumeControlCentre) window.resumeControlCentre();
    updateClock(); window.openControlCentre();
    // Let the window become ready before starting passive service work.
    if (!networkRelease && networkTimer === null) networkTimer = setTimeout(function () {
      networkTimer = null;
      if (!dismissed && !suspended && !document.hidden) watchNetwork();
    }, 250);
  }
  function parameters(event) {
    try {
      var detail = event && event.detail;
      if (typeof detail === 'string') detail = JSON.parse(detail);
      if (detail && typeof detail === 'object' && Object.keys(detail).length) return detail;
      return window.PalmSystem ? JSON.parse(window.PalmSystem.launchParams || '{}') : {};
    } catch (error) { return {}; }
  }
  function validNativeToken(value) { return typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value); }
  function nativeOwner(params) {
    var config = params.nativeBlur;
    if (config && config.port === 48740 && validNativeToken(config.token)) return config.token;
    return validNativeToken(params.nativeBlurFallbackToken) ? params.nativeBlurFallbackToken : null;
  }
  function isNativeCancel(params) { return Object.prototype.hasOwnProperty.call(params, 'nativeBlurCancelToken'); }
  function start() {
    if (started) return;
    started = true;
    var system = window.PalmSystem;
    if (system && typeof system.keepAlive === 'function' && typeof system.deactivate === 'function' && typeof system.activate === 'function') {
      try { system.keepAlive(true); retained = true; } catch (error) {}
    }
    var params = parameters();
    lastRequestId = params.overlayRequestId || null;
    nativeOwnerToken = nativeOwner(params);
    document.documentElement.lang = CONFIG.language === 'vi' ? 'vi' : 'en';
    var cancel = isNativeCancel(params);
    if (!cancel) show();
    if (window.PalmSystem && typeof window.PalmSystem.stageReady === 'function') window.PalmSystem.stageReady();
    // A cancel may cold-launch an already departed page. Do not expose controls
    // or leave that newly staged empty surface holding remote focus.
    if (cancel) { nativeOwnerToken = null; dismiss(); }
  }
  window.LauncherControls = {
    statusPolicy:{initialDelay:250,vpnPollInterval:30000,vpnDetailPollInterval:10000},
    luna:luna, launch:launch, toast:toast, wallpaper:wallpaper, closeWallpaper:hideWallpaper,
    manageHiddenApps:manageHiddenApps, canOpen:function () { return !dismissed && !suspended && !document.hidden && !external; },
    controlCentreShown:function () { active = true; cancelClose(); if (document.body.classList.contains('wallOpen')) hideWallpaper(false); },
    controlCentreHidden:function (reason) { active = false; if (reason !== 'suspend') requestDismiss(); }
  };
  window.ControlCentreOverlay = { start:start };
  document.addEventListener('webOSRelaunch', function (event) {
    var params = parameters(event), id = params.overlayRequestId;
    // Cancellation belongs to exactly the accepted native/fallback launch.
    // Stale or malformed commands cannot toggle, reopen, or claim a newer page.
    if (isNativeCancel(params)) {
      if (validNativeToken(params.nativeBlurCancelToken) && params.nativeBlurCancelToken === nativeOwnerToken) {
        nativeOwnerToken = null; dismiss();
      }
      return;
    }
    if (id && id === lastRequestId) return;
    if (id) lastRequestId = id;
    if (external) return;
    nativeOwnerToken = nativeOwner(params);
    if (params.toggle === true && !document.hidden && !dismissed && (active || document.body.classList.contains('wallOpen'))) {
      hideWallpaper(false); window.closeControlCentre(); requestDismiss();
    } else {
      dismissed = false;
      if (retained && document.hidden) window.PalmSystem.activate();
      show();
    }
  });
  // Registered before the shared controller: wallpaper owns Back while visible.
  window.addEventListener('keydown', function (event) {
    if (!document.body.classList.contains('wallOpen')) return;
    if ([8,13,27,461].indexOf(event.keyCode) < 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) hideWallpaper();
  }, true);
  $('wallBack').addEventListener('click', function () { hideWallpaper(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { suspended = true; active = false; stopLocalWork(); hideWallpaper(false); if (shown) dismiss(); }
    else if (!dismissed) { if (!active) show(); }
    else if (retained) {
      // This firmware reports visibility just before webOSRelaunch, even with
      // handlesRelaunch. Allow that request to arrive without re-hiding it.
      clearTimeout(revealTimer);
      revealTimer = setTimeout(function () { revealTimer = null; if (dismissed) parkNative(); }, 250);
    }
  });
  window.addEventListener('pagehide', function () { suspended = true; active = false; stopLocalWork(); hideWallpaper(false); if (shown) dismiss(); });
  window.addEventListener('pageshow', function () { if (started && suspended && !dismissed) show(); });
})();
