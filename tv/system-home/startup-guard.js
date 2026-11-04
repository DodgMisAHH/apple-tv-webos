/* Cancel an observed cold launch superseded by Home. ES5 / Node 8. */
'use strict';

var HOME_ID = 'com.webos.app.home';
var MAX_AGE = 30000;
var MAX_PENDING = 32;

function createGuard(options) {
  options = options || {};
  var now = options.now || function () { return Date.now(); };
  var closeApp = options.closeApp || function () {};
  var log = options.log || function () {};
  var pending = Object.create(null), stopped = false;

  function validId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 256 &&
      !/[\u0000-\u0020\u007f]/.test(value) && value !== HOME_ID;
  }
  function prune(at) {
    Object.keys(pending).forEach(function (id) {
      var age = at - pending[id].at;
      // A wall-clock correction must not make a candidate live indefinitely.
      if (age < 0 || age >= MAX_AGE) delete pending[id];
    });
  }
  function reset() { pending = Object.create(null); }
  function event(message) {
    if (stopped || !message || typeof message !== 'object' || Array.isArray(message) ||
        message.returnValue === false || !validId(message.appId)) return;
    var id = message.appId, at = now(), kind = message.event;
    if (typeof at !== 'number' || !isFinite(at)) { reset(); return; }
    prune(at);
    if (kind === 'preload' || message.reason === 'preload' ||
        (typeof message.preload === 'string' && message.preload !== '') || message.snapshot === true) {
      delete pending[id];
      return;
    }
    if (kind === 'foreground' || kind === 'background' || kind === 'pause' ||
        kind === 'close' || kind === 'stop') {
      delete pending[id];
      return;
    }
    if (kind === 'splash') {
      // SAM emits splash for fresh launches; a launch alone can be an existing
      // background app being resumed. Never close that warm app on this evidence.
      var ids = Object.keys(pending);
      if (!pending[id] && ids.length >= MAX_PENDING) {
        var oldest = ids[0];
        ids.forEach(function (key) { if (pending[key].at < pending[oldest].at) oldest = key; });
        delete pending[oldest];
      }
      pending[id] = { at: at, launched: false };
    } else if (kind === 'launch' && pending[id]) {
      // The process exists by this stage. Keep the original splash deadline;
      // repeated launch events cannot extend a stale candidate's lifetime.
      pending[id].launched = true;
    }
  }
  function home() {
    if (stopped) return;
    var at = now();
    if (typeof at !== 'number' || !isFinite(at)) { reset(); return; }
    prune(at);
    var previous = pending;
    // Consume before dispatch: repeated Home presses and close failures cannot
    // retry a close, and a later selection of the same app starts independently.
    reset();
    Object.keys(previous).forEach(function (id) {
      if (!previous[id].launched) return;
      try {
        log('Home superseded pending startup: ' + id);
        closeApp(id);
      } catch (error) {
        try { log('Pending startup close failed: ' + id + ', ' + String(error.message || error).slice(0, 160)); }
        catch (ignore) {}
      }
    });
    // Splash-only entries are intentionally forgotten. A delayed launch is not
    // enough to distinguish the old request from a new user choice of that app.
  }
  function stop() { stopped = true; reset(); }
  return { event: event, home: home, reset: reset, stop: stop };
}

module.exports = { createGuard: createGuard };
