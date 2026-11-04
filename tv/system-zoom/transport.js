/* One-boot native compositor test transport. Inactive during ordinary launches. ES5. */
(function () {
  'use strict';
  var active = false, sequence = 0, pending = [];
  try { active = !!JSON.parse(window.PalmSystem.launchParams || '{}').systemZoomTest; } catch (e) { /* off */ }
  window.LaunchZoom = {
    prepare: function (id, rect, done) {
      if (!active || !rect || !/^[A-Za-z0-9._-]+$/.test(id)) { done(); return; }
      var r = { x: Math.round(rect.left), y: Math.round(rect.top),
        width: Math.round(rect.width), height: Math.round(rect.height) };
      if (!isFinite(r.x + r.y + r.width + r.height) || r.x < 0 || r.y < 0 ||
          r.width < 16 || r.height < 16 || r.x + r.width > 1921 || r.y + r.height > 1081) { done(); return; }
      var now = Date.now(), record = { sourceAppId: 'com.gathin.tvhome', appId: id,
        token: String(now) + '-' + (++sequence), created: now, rect: r };
      // ID is allow-listed and all other values are numbers or our own literals.
      var command = "test -f /tmp/lg-tv-system-zoom.enabled && umask 077 && printf '%s' '" +
        JSON.stringify(record) + "' > /tmp/lg-tv-launch-origin.tmp && mv /tmp/lg-tv-launch-origin.tmp /tmp/lg-tv-launch-origin.json";
      var bridge, finished = false, timer;
      function finish() {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        var at = pending.indexOf(bridge);
        if (at >= 0) pending.splice(at, 1);
        done();
      }
      // A missing root service must never prevent an app from opening.
      timer = setTimeout(finish, 200);
      try {
        bridge = new PalmServiceBridge();
        pending.push(bridge);
        bridge.onservicecallback = finish;
        bridge.call('luna://org.webosbrew.hbchannel.service/exec', JSON.stringify({ command: command }));
      } catch (e) { finish(); }
    }
  };
})();
