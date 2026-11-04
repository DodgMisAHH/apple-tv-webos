/* Opt-in, bounded diagnostics. Normal launches create no observer or frame loop. */
(function () {
  'use strict';
  var enabled = /(?:[?&])profile=1(?:&|$)/.test(location.search || '');
  try { enabled = enabled || JSON.parse((window.PalmSystem && PalmSystem.launchParams) || '{}').profile === true; } catch (e) {}
  if (!enabled || !window.performance || !window.requestAnimationFrame) return;
  var records = [], frames = [], longTasks = [], until = 0, previous = 0, frameId = null;
  function push(list, value) { if (list.length >= 600) list.shift(); list.push(value); }
  function mark(name) { push(records, { name: name, time: performance.now() }); }
  function frame(time) {
    if (previous) push(frames, time - previous);
    previous = time;
    if (!document.hidden && time < until) frameId = requestAnimationFrame(frame);
    else { frameId = null; previous = 0; }
  }
  function sample(reason, duration) {
    if (document.hidden) return;
    mark(reason);
    until = performance.now() + Math.min(duration || 1000, 12000);
    if (frameId === null) frameId = requestAnimationFrame(frame);
  }
  function summary(values) {
    var a = values.slice().sort(function (a, b) { return a - b; });
    return { count: a.length, median: a[Math.floor(a.length * 0.5)] || 0,
      p95: a[Math.floor(a.length * 0.95)] || 0, max: a[a.length - 1] || 0 };
  }
  var observer;
  if (window.PerformanceObserver) {
    try {
      observer = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) { push(longTasks, entry.duration); });
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch (e) { observer = null; }
  }
  function stop() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null; previous = 0;
    if (observer) observer.disconnect();
    window.removeEventListener('keydown', onInput, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('load', onLoad);
  }
  function onInput() { sample('input', 500); }
  function onVisibility() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null; previous = 0; until = 0;
    if (!document.hidden) sample('resume', 1000);
  }
  function onLoad() { mark('load'); sample('first-frames', 1000); }
  window.addEventListener('keydown', onInput, true);
  document.addEventListener('visibilitychange', onVisibility);
  window.LauncherPerf = {
    mark: mark, sample: sample, stop: stop,
    report: function () { return { marks: records.slice(), frames: summary(frames),
      over34ms: frames.filter(function (n) { return n > 34; }).length, longTasks: summary(longTasks) }; }
  };
  mark('scripts-start');
  window.addEventListener('load', onLoad);
})();
