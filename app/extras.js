/* Wallpaper/settings and weather updates, outside the launch interaction path. ES5. */
(function () {
  'use strict';
  var frostGeneration = 0, frostKey = null, frostTimer = null, frostImage = null, pendingFrost = null;
  function deferFrost(fn) {
    pendingFrost = fn; clearTimeout(frostTimer);
    if (!document.hidden) frostTimer = setTimeout(fn, 1500);
  }
  function idle() {
    return !document.hidden && (!window.LauncherControls || !LauncherControls.isIdle || LauncherControls.isIdle());
  }
  function applyFrost(source) {
    var band = document.getElementById('dockBand'), frost = document.getElementById('dockFrost');
    frost.style.backgroundImage = source ? 'url(' + JSON.stringify(source) + ')' : '';
    frost.style.backgroundSize = '1920px 1080px';
    frost.style.backgroundRepeat = 'no-repeat';
    band.classList.toggle('frosted', !!source);
  }
  function configureFrost() {
    var c = window.CONFIG || {}, photo = c.wallpaper || '';
    var texture = photo ? (c.wallpaperFrost || (photo === 'wallpapers/misty.jpg' ? 'wallpapers/misty-frost.jpg' : '')) : '';
    var key = photo + '|' + texture;
    if (key === frostKey) return;
    frostKey = key;
    var generation = ++frostGeneration;
    clearTimeout(frostTimer); pendingFrost = null;
    if (frostImage) { frostImage.onload = null; frostImage.onerror = null; frostImage = null; }
    applyFrost(texture);
    if (!photo || texture) return;
    // Compatibility with wallpapers uploaded before precomputed textures were supported.
    // Never perform canvas readback/encoding while the user is navigating or a panel is open.
    function generate() {
      if (generation !== frostGeneration) return;
      if (!idle()) { deferFrost(generate); return; }
      pendingFrost = null;
      var picture = new Image(); frostImage = picture;
      picture.onload = function () {
        if (generation !== frostGeneration) return;
        function finish() {
          if (generation !== frostGeneration) return;
          if (!idle()) { deferFrost(finish); return; }
          pendingFrost = null;
          try {
            var small = document.createElement('canvas'), soft = document.createElement('canvas');
            small.width = 32; small.height = 18; soft.width = 384; soft.height = 216;
            var cover = Math.max(1920 / picture.naturalWidth, 1080 / picture.naturalHeight);
            var width = 1920 / cover, height = 1080 / cover;
            small.getContext('2d').drawImage(picture, (picture.naturalWidth - width) / 2,
              (picture.naturalHeight - height) / 2, width, height, 0, 0, 32, 18);
            soft.getContext('2d').drawImage(small, 0, 0, 384, 216);
            applyFrost(soft.toDataURL('image/jpeg', 0.8));
          } catch (e) { /* Keep the static translucent gradient. */ }
          picture.onload = null; picture.onerror = null; frostImage = null;
        }
        finish();
      };
      picture.onerror = function () { picture.onload = null; picture.onerror = null; frostImage = null; };
      picture.src = photo;
    }
    deferFrost(generate);
  }

  var weatherKey = null, weatherTimer = null, weatherRequest = null, weatherGeneration = 0;
  var weatherDue = 0, weatherConfig = null;
  var el = document.getElementById('weather');
  var weatherNames = {
    0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
    95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail'
  };
  function scheduleWeather(delay) {
    clearTimeout(weatherTimer);
    if (weatherConfig && !document.hidden) weatherTimer = setTimeout(loadWeather, delay);
  }
  function loadWeather() {
    if (!weatherConfig || document.hidden || weatherRequest) return;
    if (!idle()) { scheduleWeather(1500); return; }
    var w = weatherConfig, generation = weatherGeneration;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + w.latitude + '&longitude=' + w.longitude +
      '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&timezone=auto&forecast_days=1' + (w.unit === 'fahrenheit' ? '&temperature_unit=fahrenheit' : '');
    var request = new XMLHttpRequest(); weatherRequest = request;
    request.open('GET', url); request.timeout = 10000;
    function done() {
      if (generation !== weatherGeneration || weatherRequest !== request) return;
      weatherRequest = null;
      weatherDue = Date.now() + 30 * 60 * 1000;
      scheduleWeather(30 * 60 * 1000);
    }
    request.onload = function () {
      if (generation !== weatherGeneration) return;
      try {
        var d = JSON.parse(request.responseText), c = d.current, day = d.daily;
        var text = Math.round(c.temperature_2m) + (w.unit === 'fahrenheit' ? '°F' : '°C');
        if (weatherNames[c.weather_code]) text += ' · ' + weatherNames[c.weather_code];
        if (w.place) text += ' · ' + w.place;
        text += '   ↑' + Math.round(day.temperature_2m_max[0]) + '° ↓' + Math.round(day.temperature_2m_min[0]) + '°';
        var rain = day.precipitation_probability_max[0];
        if (rain !== null && rain !== undefined) text += '  ☂ ' + rain + '%';
        if (el.textContent !== text) el.textContent = text;
        el.className = 'shown';
      } catch (e) { /* Keep last-known weather. */ }
      done();
    };
    request.onerror = done; request.ontimeout = done;
    request.send();
  }
  function configureWeather() {
    var c = window.CONFIG || {}, w = c.weather || {};
    var enabled = w.enabled && typeof w.latitude === 'number' && typeof w.longitude === 'number';
    var key = JSON.stringify([enabled, w.latitude, w.longitude, w.unit, w.place]);
    if (key === weatherKey) return;
    weatherKey = key; weatherGeneration++; clearTimeout(weatherTimer);
    if (weatherRequest) { weatherRequest.abort(); weatherRequest = null; }
    weatherConfig = enabled ? w : null; weatherDue = 0;
    if (el) { el.textContent = ''; el.className = ''; }
    if (!el || !enabled) return;
    scheduleWeather(1500);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearTimeout(frostTimer);
      clearTimeout(weatherTimer);
      if (weatherRequest) { weatherGeneration++; weatherRequest.abort(); weatherRequest = null; }
    } else {
      if (pendingFrost) deferFrost(pendingFrost);
      if (weatherConfig) scheduleWeather(Math.max(1500, weatherDue - Date.now()));
    }
  });

  function apply() {
    if (window.LauncherBackground) LauncherBackground.apply();
    configureFrost(); configureWeather();
  }
  var requested = null, applied = null, loading = false, sequence = 0;
  function refresh(token) {
    token = String(token || 'settings');
    if (token === applied && !loading) return;
    requested = token;
    if (loading) return;
    loadSettings();
  }
  function loadSettings() {
    var token = requested, script = document.createElement('script'), finished = false;
    loading = true;
    script.src = 'user.js?settings=' + encodeURIComponent(token) + '&sequence=' + (++sequence);
    function finish(ok) {
      if (finished) return;
      finished = true; clearTimeout(timeout); loading = false;
      if (script.parentNode) script.parentNode.removeChild(script);
      if (ok) { applied = token; apply(); }
      else if (window.LauncherControls) LauncherControls.toast('Could not refresh settings. Try again.');
      if (requested !== token) loadSettings();
    }
    var timeout = setTimeout(function () { finish(false); }, 5000);
    script.onload = function () { finish(true); };
    script.onerror = function () { finish(false); };
    document.head.appendChild(script);
  }
  window.LauncherSettings = { refresh: refresh, apply: apply };
  apply();
})();
