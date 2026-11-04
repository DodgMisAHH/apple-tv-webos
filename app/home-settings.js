/* Settings-key requests for the already loaded Home page, never the overlay. */
(function () {
  'use strict';
  var lastRequest = null;
  function parameters(event) {
    var value = event && event.detail;
    try {
      if (typeof value === 'string') value = JSON.parse(value);
      if (value && typeof value === 'object' && Object.keys(value).length) return value;
      return window.PalmSystem ? JSON.parse(window.PalmSystem.launchParams || '{}') : {};
    } catch (error) { return {}; }
  }
  function receive(event) {
    var value = parameters(event), token = value.controlCentreRequestId;
    if (value.controlCentre !== true || typeof token !== 'string' ||
        !/^[0-9]+-[0-9]+$/.test(token) || token.length > 128 || token === lastRequest) return;
    lastRequest = token;
    if (document.hidden || value.reason === 'preload' || value.preload || value.snapshot) return;
    var api = window.LauncherControls;
    if (api && api.cancelPress) api.cancelPress();
    if (document.body.classList.contains('wallOpen') && api && api.closeWallpaper) {
      api.closeWallpaper(false);
    } else if (document.body.classList.contains('ccOpen')) {
      window.closeControlCentre();
    } else if (!api || !api.canOpen || api.canOpen()) {
      window.openControlCentre();
    }
  }
  // Home's earlier relaunch listener restores its normal input state first.
  document.addEventListener('webOSRelaunch', receive);
  receive(null);
})();
