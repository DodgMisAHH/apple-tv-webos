/* Shared file publication and bounded cross-process work queue. ES5 / Node 8. */
'use strict';
var fs = require('fs'), path = require('path');
var DATA = process.env.LG_LAUNCHER_DATA || '/home/root/lg-tv-vibehack';
var APP = process.env.LG_LAUNCHER_APP_DIR || '/media/developer/apps/usr/palm/applications/com.gathin.tvhome';
var sequence = 0;
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function exists(file) { try { return fs.statSync(file).isFile(); } catch (e) { return false; } }
function atomicWrite(file, data) {
  var buffer = Buffer.isBuffer(data) ? data : new Buffer(data, 'utf8');
  try { if (fs.readFileSync(file).equals(buffer)) return false; } catch (e) {}
  var tmp = file + '.part-' + process.pid + '-' + (++sequence);
  try { fs.writeFileSync(tmp, buffer); fs.renameSync(tmp, file); }
  finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  return true;
}
function copyChanged(src, dest) { return atomicWrite(dest, fs.readFileSync(src)); }
function settings() {
  var st = readJSON(path.join(DATA, 'settings.json'), {});
  var savedSettings = JSON.stringify(st);
  var photo = path.join(DATA, 'wallpaper.jpg'), frost = path.join(DATA, 'wallpaper-frost.jpg');
  var version = exists(photo) ? String(Math.floor(fs.statSync(photo).mtime.getTime())) : '';
  var name = version ? 'bg-' + version + '.jpg' : '';
  var frostName = version && exists(frost) && fs.statSync(frost).mtime.getTime() >= fs.statSync(photo).mtime.getTime() ?
    'bg-frost-' + version + '-' + Math.floor(fs.statSync(frost).mtime.getTime()) + '.jpg' : '';
  // Publish assets before the manifest, then remove obsolete assets. Millisecond versions
  // also distinguish consecutive phone changes made within the same second.
  if (name && !exists(path.join(APP, name))) copyChanged(photo, path.join(APP, name));
  if (frostName && !exists(path.join(APP, frostName))) copyChanged(frost, path.join(APP, frostName));
  st.wallpaper = name;
  st.wallpaperFrost = frostName;
  atomicWrite(path.join(APP, 'user.js'), '// Generated on the TV from settings.json\n' +
    '(function () { var u = ' + JSON.stringify(st) + '; for (var k in u) window.CONFIG[k] = u[k]; })();\n');
  atomicWrite(path.join(DATA, 'settings-published.json'), savedSettings);
  // Keep one previous generation of each asset for an old page or in-flight manifest.
  var files = fs.readdirSync(APP);
  ['photo', 'frost'].forEach(function (kind) {
    var pattern = kind === 'photo' ? /^bg(?:-\d+)?\.jpg$/ : /^bg-frost(?:-\d+)+\.jpg$/;
    var current = kind === 'photo' ? name : frostName;
    var old = files.filter(function (file) { return pattern.test(file) && file !== current; });
    old.sort(function (a, b) { return fs.statSync(path.join(APP, b)).mtime.getTime() - fs.statSync(path.join(APP, a)).mtime.getTime(); });
    old.slice(1).forEach(function (file) { try { fs.unlinkSync(path.join(APP, file)); } catch (e) {} });
  });
}
function mkdir(dir) { try { fs.mkdirSync(dir); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
function remove(file) { try { fs.unlinkSync(file); } catch (e) {} }
function processIdentity(pid) {
  // Linux start time plus boot ID distinguishes a reused PID after a crash/reboot.
  // On other hosts, retain the conservative PID-only liveness check.
  try {
    var stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    var start = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[19];
    var boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    return start && boot ? boot + ':' + start : '';
  } catch (e) { return ''; }
}
function ownerAlive(owner) {
  var pid = owner && typeof owner === 'object' ? owner.pid : Number(owner);
  if (typeof pid !== 'number' || !isFinite(pid) || pid < 1 || Math.floor(pid) !== pid) return true;
  try { process.kill(pid, 0); } catch (e) { return e.code !== 'ESRCH'; }
  var identity = owner && owner.identity, current = identity && processIdentity(pid);
  return !identity || !current || identity === current;
}
function regular(file) {
  try { return fs.lstatSync(file).isFile(); } catch (e) { return false; }
}
function tokenPid(token) {
  var match = /^[0-9]+-([1-9][0-9]*)-[1-9][0-9]*-[a-f0-9]+$/.exec(token);
  return match ? Number(match[1]) : null;
}

function removeAbandoned(queue) {
  fs.readdirSync(queue).forEach(function (name) {
    var match = /^(?:\.claim-|\.reaped-)(.+)$/.exec(name);
    var claim = match && name.indexOf('.claim-') === 0;
    if (!match) match = /^(.+)\.(?:request|done)$/.exec(name);
    var token = match && match[1], pid = token && tokenPid(token);
    if (!pid) return;
    var file = path.join(queue, name), marker = file;
    try {
      if (claim) {
        if (!fs.lstatSync(file).isDirectory()) return;
        var names = fs.readdirSync(file), expected = 'owner-' + pid + '-' + token;
        // Never recursively remove a directory: unrelated contents retain ownership.
        if (names.length !== 1 || names[0] !== expected) return;
        marker = path.join(file, expected);
      }
      if (!regular(marker)) return;
      var value = readJSON(marker, null), owner = value && value.owner || value;
      if (!claim && name.indexOf('.reaped-') !== 0) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return;
        if (/\.request$/.test(name) && value.mode !== 'full' && value.mode !== 'settings') return;
        if (/\.done$/.test(name) && !Object.prototype.hasOwnProperty.call(value, 'error')) return;
        owner = value.owner || { pid: pid };
      }
      var ownerPid = owner && typeof owner === 'object' ? owner.pid : Number(owner);
      if (name.indexOf('.reaped-') === 0) {
        if (ownerAlive({ pid: pid }) || ownerAlive(owner)) return;
      } else if (ownerPid !== pid || ownerAlive(owner)) return;
      remove(marker);
      if (claim) { try { fs.rmdirSync(file); } catch (e) {} }
    } catch (e) { /* Concurrent publication or foreign files stay untouched. */ }
  });
}

/** Every caller receives its own acknowledgement, only after its queued snapshot is published. */
function enqueue(mode, work, callback) {
  var queue = path.join(DATA, 'publication-queue'), lock = path.join(queue, '.lock');
  var token = Date.now() + '-' + process.pid + '-' + (++sequence) + '-' + (Math.random().toString(16).slice(2) || '0');
  var owner = { pid: process.pid, identity: processIdentity(process.pid) };
  var request = path.join(queue, token + '.request'), done = path.join(queue, token + '.done');
  var ownerName = 'owner-' + process.pid + '-' + token;
  var claim = path.join(queue, '.claim-' + token);
  var started = Date.now(), owned = false, finished = false;
  mkdir(queue);
  atomicWrite(request, JSON.stringify({ mode: mode, owner: owner }));
  function release() {
    if (!owned) return;
    owned = false;
    remove(path.join(lock, ownerName));
    try { fs.rmdirSync(lock); } catch (e) {}
  }
  function cleanup() {
    release();
    remove(request);
    remove(done);
    remove(path.join(claim, ownerName));
    try { fs.rmdirSync(claim); } catch (e) {}
  }
  function finish(error) {
    if (finished) return;
    finished = true;
    cleanup();
    process.removeListener('exit', cleanup);
    process.removeListener('SIGTERM', terminate);
    process.removeListener('SIGINT', interrupt);
    callback(error);
  }
  function terminate() { cleanup(); process.exit(143); }
  function interrupt() { cleanup(); process.exit(130); }
  process.on('exit', cleanup);
  process.on('SIGTERM', terminate);
  process.on('SIGINT', interrupt);
  function acquire() {
    // A lock is published already containing its unique owner marker. Rename may
    // replace an empty abandoned lock, but cannot replace another live/nonempty one.
    if (!exists(path.join(claim, ownerName))) {
      mkdir(claim);
      fs.writeFileSync(path.join(claim, ownerName), JSON.stringify(owner));
    }
    try {
      fs.renameSync(claim, lock);
      owned = true;
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST' && e.code !== 'ENOTEMPTY') throw e;
      var owners;
      try { owners = fs.readdirSync(lock).filter(function (file) { return /^owner(?:-|$)/.test(file); }); }
      catch (x) { return false; }
      if (!owners.length) return false;
      var marker = path.join(lock, owners[0]);
      if (!regular(marker)) return false;
      var previousOwner = readJSON(marker, null);
      if (previousOwner === null) return false;
      if (!ownerAlive(previousOwner)) {
        // Only the process that renames this exact observed marker may reap it.
        // A replacement owner has a different filename and is already nonempty,
        // so neither a stale inspector nor rmdir can delete its new lock.
        var reaped = path.join(queue, '.reaped-' + token);
        try { fs.renameSync(marker, reaped); } catch (x) { return false; }
        try { fs.rmdirSync(lock); } catch (x) {}
        remove(reaped);
      }
      return false;
    }
  }
  function drain() {
    removeAbandoned(queue);
    var jobs = fs.readdirSync(queue).filter(function (file) {
      if (!/\.request$/.test(file) || !tokenPid(file.replace(/\.request$/, '')) || !regular(path.join(queue, file))) return false;
      var job = readJSON(path.join(queue, file), null);
      return !!job && (job.mode === 'full' || job.mode === 'settings') &&
        (!job.owner || job.owner.pid === tokenPid(file.replace(/\.request$/, '')));
    });
    if (!jobs.length) { release(); return poll(); }
    var full = jobs.some(function (file) { return readJSON(path.join(queue, file), {}).mode === 'full'; });
    var error = null;
    try { work(full ? 'full' : 'settings'); } catch (e) { error = e.message || String(e); }
    jobs.forEach(function (file) {
      var job = readJSON(path.join(queue, file), null);
      // A caller may terminate while this synchronous batch is running.
      if (!job) return;
      if (!job.owner || ownerAlive(job.owner)) atomicWrite(path.join(queue, file.replace(/\.request$/, '.done')),
        JSON.stringify({ error: error, owner: job.owner || { pid: tokenPid(file.replace(/\.request$/, '')) } }));
      remove(path.join(queue, file));
    });
    // New requests received while publishing remain in the queue for the next batch.
    setTimeout(function () { try { drain(); } catch (e) { finish(e); } }, 0);
  }
  function poll() {
    try {
      if (exists(done)) {
        var receipt = readJSON(done, { error: 'Invalid publication acknowledgement' });
        remove(done);
        return finish(receipt.error ? new Error(receipt.error) : null);
      }
      if (Date.now() - started > 280000) { remove(request); return finish(new Error('Publication queue timed out')); }
      if (acquire()) return drain();
      setTimeout(poll, 100);
    } catch (e) { finish(e); }
  }
  poll();
}
module.exports = { data: DATA, app: APP, readJSON: readJSON, exists: exists,
  atomicWrite: atomicWrite, copyChanged: copyChanged, settings: settings, enqueue: enqueue };
