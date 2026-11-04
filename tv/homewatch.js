#!/usr/bin/env node
/*
 * LG TV Vibehack - runs ON the rooted TV.
 * Backup for the Home button: whenever LG's home screen comes to the front (at boot, or if the
 * button remap is not installed), bring the launcher back. Gives up after 5 tries in 10 s so it can
 * never fight the TV in a loop.
 *
 * Right after boot the TV usually opens Live TV (or the last input) instead of LG's home, so for
 * BOOT_GRACE_MS after webOS is ready Live TV is treated like LG's home too.
 * Plain ES5: the TV runs Node 8.
 */
'use strict';
var spawn = require('child_process').spawn;
var execFile = require('child_process').execFile;
var fs = require('fs');

var LAUNCHER = 'com.gathin.tvhome';
var SYSTEM_HOME_MARKER = '/tmp/lg-tv-system-home.active';
var systemHomeMode = false;
var HOME_IDS = ['com.webos.app.home'];
var BOOT_IDS = ['com.webos.app.livetv'];
var BOOT_GRACE_MS = 90000;
var READY_TIMEOUT_MS = 8000;    // no foreground app reported yet: subscribe again
var hits = [];
var readyAt = 0;
var foreground = null, foregroundGeneration = 0, launchTimer = null, launchInFlight = false;
var pendingWake = null, stopped = false, children = [], timers = [];
var acceptedUntil = 0;

function log(msg) { console.log(new Date().toISOString() + ' ' + msg); }
function systemHomeActive() {
  try { return fs.existsSync(SYSTEM_HOME_MARKER); } catch (e) { return false; }
}

function later(fn, ms) {
  if (stopped) return null;
  var timer = setTimeout(function () {
    var at = timers.indexOf(timer);
    if (at >= 0) timers.splice(at, 1);
    if (!stopped) fn();
  }, ms);
  timers.push(timer);
  return timer;
}
function track(child) {
  if (!child || !child.on) return child;
  children.push(child);
  function forget() { var at = children.indexOf(child); if (at >= 0) children.splice(at, 1); }
  // A failed spawn emits error/close without exit; retries must not retain it.
  child.on('exit', forget);
  child.on('close', forget);
  child.on('error', forget);
  return child;
}
function cancelTimer(timer) {
  if (!timer) return;
  clearTimeout(timer);
  var at = timers.indexOf(timer);
  if (at >= 0) timers.splice(at, 1);
}
function cancelLaunch() { cancelTimer(launchTimer); launchTimer = null; }
function launch(reason, generation, attempt, expectedForeground) {
  // Read on each attempt: a guarded system-Home test can activate or roll back
  // without restarting this inventory watcher or leaving an old retry armed.
  if (systemHomeActive()) {
    systemHomeMode = true;
    cancelLaunch(); pendingWake = null; acceptedUntil = 0; hits = [];
    return;
  }
  if (stopped || foreground === LAUNCHER || (expectedForeground !== foregroundGeneration &&
      !(reason === 'wake' && isHome(foreground)))) return;
  if (reason === 'wake' && (generation !== wakeGeneration || powerState !== 'Active')) return;
  if (launchInFlight) {
    if (reason === 'wake') pendingWake = { generation: generation, attempt: attempt, foreground: expectedForeground };
    return;
  }
  var now = Date.now();
  if (now < acceptedUntil) return;
  hits = hits.filter(function (time) { return now - time < 10000; });
  if (hits.length >= 5) { log('LG home keeps coming back, giving up for now'); return; }
  hits.push(now);
  launchInFlight = true;
  track(execFile('luna-send', ['-w', '2500', '-n', '1', 'luna://com.webos.applicationManager/launch',
    JSON.stringify({ id: LAUNCHER, params: { home: true, reload: false } })], { timeout: 3500 }, function (err, stdout) {
    launchInFlight = false;
    var ok = false;
    try { ok = !err && JSON.parse(stdout).returnValue === true; } catch (e) {}
    if (ok) acceptedUntil = Date.now() + 2500;
    log(reason + ' launch ' + attempt + ': ' + (ok ? 'accepted' : 'not ready'));
    var wake = pendingWake;
    pendingWake = null;
    if (!ok && wake) scheduleLaunch('wake', wake.generation, wake.attempt, 0, wake.foreground);
    else if (!ok && attempt < 3) scheduleLaunch(reason, generation, attempt + 1, reason === 'wake' ? 750 : 400, expectedForeground);
  }));
}
function scheduleLaunch(reason, generation, attempt, delay, expectedForeground) {
  cancelLaunch();
  launchTimer = later(function () {
    launchTimer = null;
    launch(reason, generation, attempt, expectedForeground);
  }, delay);
}

function isHome(id) {
  if (HOME_IDS.indexOf(id) !== -1) return true;
  return BOOT_IDS.indexOf(id) !== -1 && Date.now() - readyAt < BOOT_GRACE_MS;
}

function handle(id) {
  var systemHome = systemHomeActive();
  if (id === foreground && systemHome === systemHomeMode) return;
  systemHomeMode = systemHome;
  foreground = id;
  foregroundGeneration++;
  cancelLaunch();
  if (systemHome) { pendingWake = null; acceptedUntil = 0; hits = []; return; }
  if (id === LAUNCHER) pendingWake = null;
  if (!isHome(id)) { if (id !== LAUNCHER) acceptedUntil = 0; return; }
  log(id + ' -> launcher');
  scheduleLaunch('home', 0, 1, 0, foregroundGeneration);
}

// Subscribing before webOS is ready gives a subscription that never reports anything, so until the
// first real app id arrives the subscription is renewed every READY_TIMEOUT_MS.
function start() {
  var p = track(spawn('luna-send', ['-i', 'luna://com.webos.applicationManager/getForegroundAppInfo', '{"subscribe":true}']));
  var buf = '';
  var retry = readyAt ? null : later(function () { p.kill(); }, READY_TIMEOUT_MS);
  p.stdout.on('data', function (d) {
    buf += d;
    var lines = buf.split('\n');
    buf = lines.pop();
    lines.forEach(function (l) {
      var j;
      try { j = JSON.parse(l); } catch (e) { return; }
      if (!j.appId) return;
      var bootLaunch = false;
      if (!readyAt) {
        readyAt = Date.now();
        cancelTimer(retry);
        log('webOS ready, foreground: ' + j.appId);
        // A full boot can restore a streaming app or HDMI, rather than Home/Live TV.
        // Only the boot hook sets this flag; reconnects never interrupt playback.
        if (!systemHomeActive() && process.env.LG_LAUNCHER_BOOT === '1' && j.appId !== LAUNCHER && !isHome(j.appId)) {
          log('startup -> launcher');
          bootLaunch = true;
        }
      }
      handle(j.appId);
      if (bootLaunch) scheduleLaunch('startup', 0, 1, 1500, foregroundGeneration);
    });
  });
  if (p.stderr) p.stderr.resume();
  var restarting = false;
  function reconnect() {
    if (restarting) return;
    restarting = true;
    cancelTimer(retry);
    later(start, readyAt ? 2000 : 1000);
  }
  p.on('exit', reconnect);
  p.on('error', reconnect);
}

// ---- power wake ------------------------------------------------------------------------------
// Only an observed standby/off -> Active transition can interrupt the restored app.
// Initial Active snapshots, reconnects, screen-off and screensavers are not wake events.
var powerState = null, wasStandby = false, wakeGeneration = 0;
function launchOnWake(generation, attempt) {
  if (generation !== wakeGeneration || powerState !== 'Active') return;
  cancelLaunch();
  launch('wake', generation, attempt, foregroundGeneration);
}
function handlePower(message) {
  if (message.returnValue === false || typeof message.state !== 'string') return;
  var state = message.state;
  if (state !== powerState) log('power: ' + state);
  powerState = state;
  if (state === 'Active Standby' || state === 'Suspend' || state === 'Power Off') {
    wasStandby = true;
    wakeGeneration++;
    foreground = null;
    foregroundGeneration++;
    pendingWake = null;
    acceptedUntil = 0;
    cancelLaunch();
  } else if (state === 'Active' && !message.processing && wasStandby) {
    wasStandby = false;
    hits = []; // A real wake starts a new bounded Home-redirection window.
    wakeGeneration++;
    if (!systemHomeActive()) {
      log('standby -> Active: opening Home');
      launchOnWake(wakeGeneration, 1);
    }
  }
}
function watchPower() {
  var p = track(spawn('luna-send', ['-i', 'luna://com.webos.service.tvpower/power/getPowerState', '{"subscribe":true}']));
  var buffer = '', pending = '', restarted = false;
  var ready = later(function () { p.kill(); }, READY_TIMEOUT_MS);
  p.stdout.on('data', function (data) {
    buffer += data;
    var lines = buffer.split('\n');
    buffer = lines.pop();
    lines.forEach(function (line) {
      pending += line;
      var message;
      try { message = JSON.parse(pending); } catch (e) {
        if (pending.length > 16384) pending = '';
        return;
      }
      pending = '';
      if (message.state) cancelTimer(ready);
      handlePower(message);
    });
  });
  if (p.stderr) p.stderr.resume();
  function reconnect() {
    if (restarted) return;
    restarted = true;
    cancelTimer(ready);
    later(watchPower, 2000);
  }
  p.on('exit', reconnect);
  p.on('error', reconnect);
}

// ---- app list ---------------------------------------------------------------------------------
// webOS reports every install and removal on this subscription, so the launcher no longer has to
// wait for the next boot to notice a new app. Each change re-runs sync.js, which rewrites apps.js;
// the launcher picks that up when it is opened again.
var SYNC = '/home/root/lg-tv-vibehack/sync.js';
var syncing = false, syncAgain = false;

function runSync() {
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  track(execFile('/usr/bin/node', [SYNC], { timeout: 300000 }, function (err, out, errOut) {
    syncing = false;
    log('app list changed, synced' + (err ? ' with errors: ' + String(errOut).trim() : ': ' + String(out).trim()));
    if (syncAgain && !stopped) { syncAgain = false; runSync(); }
  }));
}

function watchApps() {
  var p = track(spawn('luna-send', ['-i', 'luna://com.webos.applicationManager/listLaunchPoints', '{"subscribe":true}']));
  var buf = '';
  p.stdout.on('data', function (d) {
    buf += d;
    var lines = buf.split('\n');
    buf = lines.pop();
    lines.forEach(function (l) {
      var j;
      try { j = JSON.parse(l); } catch (e) { return; }
      // The first reply carries the whole list; after that webOS sends one launch point per
      // change, tagged "added", "removed" or "updated".
      if (j.launchPoints) return;
      if (j.change !== 'added' && j.change !== 'removed' && j.change !== 'updated') return;
      log('app ' + j.change + ': ' + j.id);
      runSync();
    });
  });
  if (p.stderr) p.stderr.resume();
  var restarting = false;
  function reconnect() { if (!restarting) { restarting = true; later(watchApps, 5000); } }
  p.on('exit', reconnect);
  p.on('error', reconnect);
}

function shutdown() {
  stopped = true;
  timers.forEach(clearTimeout);
  timers = [];
  children.slice().forEach(function (child) { try { child.kill(); } catch (e) {} });
  children = [];
}
if (process.on) {
  process.on('exit', shutdown);
  process.on('SIGTERM', function () { shutdown(); process.exit(0); });
  process.on('SIGINT', function () { shutdown(); process.exit(0); });
}
log('homewatch started');
start();
watchApps();
watchPower();
