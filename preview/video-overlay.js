/* Browser-only video host. No TV bridge or native service is emulated. */
(function () {
  'use strict';
  var video = document.getElementById('video'), screen = document.getElementById('screen');
  var stage = document.getElementById('demo-stage');
  var toggle = document.getElementById('toggle'), play = document.getElementById('play');
  var seek = document.getElementById('seek'), time = document.getElementById('time');
  var status = document.getElementById('status'), credit = document.getElementById('credit');
  var shown = true, requestId = 0, localUrl = null;
  screen.setAttribute('tabindex', '-1');
  function fitOverlay() {
    var scale = Math.min(stage.clientWidth / 1920, stage.clientHeight / 1080);
    window.LAUNCHER_SCALE = scale;
    screen.style.transform = 'scale(' + scale + ')';
  }
  window.addEventListener('resize', fitOverlay);
  fitOverlay();
  function display() {
    var wasShown = shown;
    shown = !document.body.classList.contains('overlayDormant') &&
      (document.body.classList.contains('ccOpen') || document.body.classList.contains('wallOpen'));
    stage.setAttribute('data-controls-open', String(shown));
    toggle.textContent = shown ? 'Hide Control Centre' : 'Show Control Centre';
    toggle.setAttribute('aria-expanded', String(shown));
    if (!shown && wasShown && screen.contains(document.activeElement)) toggle.focus({preventScroll:true});
  }
  // Keep the real lifecycle callbacks; only mirror their state into demo controls.
  ['controlCentreShown', 'controlCentreHidden'].forEach(function (name) {
    var original = window.LauncherControls[name];
    window.LauncherControls[name] = function () {
      if (original) original.apply(this, arguments);
      setTimeout(display, 0);
    };
  });
  toggle.disabled = false;
  display();
  toggle.addEventListener('click', function () {
    document.dispatchEvent(new CustomEvent('webOSRelaunch', {
      detail:{overlayRequestId:'browser-demo-' + (++requestId), toggle:shown}
    }));
    setTimeout(function () { display(); if (shown) screen.focus({preventScroll:true}); }, 0);
  });
  function tryPlay() {
    var result = video.play();
    if (result && result.catch) result.catch(function () {
      status.textContent = 'Press Play to start the muted video, or choose a local video if the sample is unavailable.';
    });
  }
  play.addEventListener('click', function () { if (video.paused) tryPlay(); else video.pause(); });
  video.addEventListener('play', function () { play.textContent = 'Pause'; });
  video.addEventListener('pause', function () { play.textContent = 'Play'; });
  video.addEventListener('playing', function () {
    status.textContent = 'Muted playback. Select the panel to use arrows, Enter and Escape. No TV is connected.';
  });
  video.addEventListener('error', function () {
    status.textContent = 'The sample could not load. Choose a local video; it stays in this browser and is not uploaded.';
  });
  function stamp(seconds) {
    seconds = Math.floor(Math.max(0, seconds || 0));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }
  function updateTime() {
    var duration = Number.isFinite(video.duration) ? video.duration : 0;
    seek.disabled = !duration; seek.max = duration || 1; seek.value = video.currentTime;
    time.textContent = stamp(video.currentTime) + ' / ' + stamp(duration);
  }
  video.addEventListener('loadedmetadata', updateTime);
  video.addEventListener('durationchange', updateTime);
  video.addEventListener('timeupdate', updateTime);
  seek.addEventListener('input', function () { video.currentTime = Number(seek.value); updateTime(); });
  document.getElementById('local-video').addEventListener('change', function (event) {
    var file = event.target.files[0];
    if (!file) return;
    video.pause();
    if (localUrl) URL.revokeObjectURL(localUrl);
    localUrl = URL.createObjectURL(file); video.src = localUrl;
    video.setAttribute('aria-label', 'Local video');
    credit.textContent = 'Local video · supplied by you · stays in your browser; never uploaded.';
    status.textContent = 'Loading your local video…';
    video.load(); tryPlay();
  });
  window.addEventListener('beforeunload', function () { if (localUrl) URL.revokeObjectURL(localUrl); });
  video.muted = true;
  tryPlay();
})();
