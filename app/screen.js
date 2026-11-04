/* Desktop preview fits the TV canvas; webOS keeps its native 1920x1080 viewport. */
(function () {
  'use strict';
  function fit() {
    var scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    if (window.PalmSystem) scale = 1;
    window.LAUNCHER_SCALE = scale;
    document.getElementById('screen').style.transform = 'scale(' + scale + ')';
  }
  window.addEventListener('resize', fit);
  fit();
})();
