/* Discover the selected wallpaper before building the tiles. ES5 / Chromium 79. */
(function () {
  'use strict';
  var current = null, screen = document.getElementById('screen');
  function apply() {
    var c = window.CONFIG || {}, source = c.wallpaper || '';
    var dim = typeof c.wallpaperDim === 'number' ? Math.max(0, Math.min(0.8, c.wallpaperDim)) : 0.35;
    var value = source ? 'linear-gradient(rgba(0,0,0,' + dim + '),rgba(0,0,0,' + dim + ')),url(' +
      JSON.stringify(source) + ') center / cover no-repeat,#000' : '#000';
    if (value !== current) { screen.style.background = value; current = value; }
    document.body.classList.toggle('no-glow', c.ambientGlow === false);
  }
  window.LauncherBackground = { apply: apply };
  apply();
})();
