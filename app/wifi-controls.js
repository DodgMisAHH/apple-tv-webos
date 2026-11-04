/* Direct, bounded Wi-Fi requests. Credentials never enter a shell, cache or log. ES5. */
(function () {
  'use strict';
  var SERVICE = 'luna://com.webos.service.wifi/';
  var JOIN_TIMEOUT = 45000, READ_TIMEOUT = 9000;
  var joining = null;
  var SECURITY = ['none', 'open', 'psk', 'wep', 'ieee8021x', 'sae'];

  function noop() {}
  function result(code, message) { return { returnValue: false, failureCode: code, errorText: message }; }
  function respond(callback, value) { if (typeof callback === 'function') callback(value); }
  function ssidValid(value) {
    if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f]/.test(value)) return false;
    try { return encodeURIComponent(value).replace(/%[0-9A-F]{2}|./g, 'x').length <= 32; }
    catch (error) { return false; }
  }
  function profileValid(value) {
    return typeof value === 'number' && isFinite(value) && value >= 0 && value <= 2147483647 && Math.floor(value) === value;
  }
  function passValid(type, value) {
    if (typeof value !== 'string') return false;
    if (type === 'psk') return /^[\x20-\x7e]{8,63}$/.test(value) || /^[0-9a-fA-F]{64}$/.test(value);
    if (type === 'wep') return /^[\x20-\x7e]{5}$/.test(value) || /^[\x20-\x7e]{13}$/.test(value) ||
      /^[0-9a-fA-F]{10}$/.test(value) || /^[0-9a-fA-F]{26}$/.test(value);
    return false;
  }
  function clearSecret(payload) {
    if (payload && payload.security && payload.security.simpleSecurity) {
      delete payload.security.simpleSecurity.passKey;
    }
  }
  function failure(value) {
    // Service errors may contain supplied arguments: never forward them to UI/logs.
    var message = value && typeof value.errorText === 'string' ? value.errorText : '';
    if (/permission|not permitted|not allowed|access denied|denied method|not authorized|ACG/i.test(message)) {
      return result('permission', 'Wi-Fi connection access is unavailable. Open LG network settings to connect.');
    }
    if (/passphrase|password|authentication|auth[- ]failed|invalid[- ]key|invalid passkey/i.test(message)) {
      return result('authentication', 'Could not authenticate. Check the Wi-Fi password and try again.');
    }
    return result('connection', 'Could not connect. Check the network and try again.');
  }
  function available() {
    return typeof PalmServiceBridge !== 'undefined' && window.LauncherControls &&
      typeof window.LauncherControls.luna === 'function';
  }
  function request(method, payload, callback, write) {
    var released = null, completed = false, cancelled = false, timer = null;
    var entry = { cancel: cancel };
    if (write) joining = entry;
    function releaseBridge() {
      if (!released) return;
      var release = released; released = null;
      try { release(); } catch (error) {}
    }
    function finish(value) {
      if (completed) return;
      completed = true;
      clearTimeout(timer); timer = null;
      releaseBridge(); clearSecret(payload); payload = null;
      if (joining === entry) joining = null;
      var notify = callback; callback = null;
      if (!cancelled) respond(notify, value);
    }
    function cancel() {
      if (completed || cancelled) return;
      cancelled = true; callback = null;
      releaseBridge(); clearSecret(payload); payload = null;
      // Releasing a bridge cannot undo a submitted connection. Keep its bounded
      // guard until the original deadline so reopening cannot submit a duplicate.
      if (!write) finish(null);
    }
    timer = setTimeout(function () {
      finish(result('timeout', write ? 'The connection request timed out. Check network status before trying again.' :
        'Saved networks did not respond. Try again or open LG network settings.'));
    }, write ? JOIN_TIMEOUT : READ_TIMEOUT);
    try {
      var release = window.LauncherControls.luna(SERVICE + method, payload, function (value) {
        if (completed || cancelled) return;
        if (value && value.returnValue === true) finish(write ? { returnValue: true } : profilesResult(value));
        else finish(failure(value));
      });
      released = typeof release === 'function' ? release : null;
      if (completed || cancelled) releaseBridge();
    } catch (error) {
      if (completed) throw error;
      finish(result('unavailable', 'Wi-Fi controls are unavailable. Open LG network settings to connect.'));
    } finally {
      // PalmServiceBridge.call serializes synchronously. Its request parameter
      // object may remain captured by the shared bridge until completion.
      clearSecret(payload); payload = null;
    }
    return cancel;
  }
  function join(options, callback) {
    if (joining) {
      respond(callback, result('pending', 'A connection request is still in progress. Check network status before trying again.'));
      return noop;
    }
    if (!options || typeof options !== 'object' || Array.isArray(options) || !ssidValid(options.ssid)) {
      respond(callback, result('invalid', 'Choose a valid Wi-Fi network.')); return noop;
    }
    var payload, type = options.securityType;
    if (typeof options.password === 'undefined' && profileValid(options.profileId)) {
      payload = { profileId: options.profileId };
    } else if (type === 'none' || type === 'open') {
      payload = { ssid: options.ssid };
    } else if (type === 'psk' || type === 'wep') {
      if (!passValid(type, options.password)) {
        respond(callback, result('invalid', type === 'psk' ?
          'Use 8–63 printable characters or a 64-digit hexadecimal Wi-Fi key.' :
          'Use a 5- or 13-character WEP key, or 10 or 26 hexadecimal digits.'));
        return noop;
      }
      payload = { ssid: options.ssid, security: { securityType: type, simpleSecurity: { passKey: options.password } } };
    } else {
      respond(callback, result('unsupported', 'This network needs LG network settings to connect.')); return noop;
    }
    options = null;
    if (!available()) {
      clearSecret(payload); payload = null;
      var preview = result('preview', 'Preview only. Wi-Fi connections are available on the TV.'); preview.preview = true;
      respond(callback, preview); return noop;
    }
    return request('connect', payload, callback, true);
  }
  function securityTypes(value) {
    var candidates = Array.isArray(value) ? value : [value], out = [];
    candidates.forEach(function (item) {
      if (item && typeof item === 'object') item = item.securityType;
      (Array.isArray(item) ? item : [item]).forEach(function (type) {
        if (SECURITY.indexOf(type) >= 0 && out.indexOf(type) < 0) out.push(type);
      });
    });
    return out;
  }
  function profilesResult(value) {
    if (!Array.isArray(value.profileList)) return result('unavailable', 'Saved networks are unavailable. Try again.');
    var profiles = [];
    value.profileList.forEach(function (item) {
      var profile = item && item.wifiProfile;
      if (!profile || !ssidValid(profile.ssid) || !profileValid(profile.profileId)) return;
      profiles.push({ ssid: profile.ssid, profileId: profile.profileId, securityTypes: securityTypes(profile.security) });
    });
    return { returnValue: true, profiles: profiles };
  }
  function profiles(callback) {
    if (!available()) {
      var preview = result('preview', 'Saved Wi-Fi networks are available on the TV.'); preview.preview = true;
      respond(callback, preview); return noop;
    }
    return request('getprofilelist', {}, callback, false);
  }
  window.WifiControls = { join: join, profiles: profiles, pending: function () { return !!joining; },
    cancel: function () { if (joining) joining.cancel(); } };
})();
