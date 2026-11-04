'use strict';
// Per-open coordinator/worker. Nothing is running between panel sessions.
var fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
var bridge = require('./bridge.js');
var ROOT = '/home/root/lg-tv-vibehack/native-blur', RUN = '/tmp/lg-tv-native-blur';
var APP = '/media/developer/apps/usr/palm/applications/com.gathin.tvcontrolcentre';
var QUARANTINE = 20000, LOG_LIMIT = 65536, KEEP = 4;

function startTime(text) {
  var end = text.lastIndexOf(')'), fields = text.slice(end + 2).trim().split(/\s+/);
  return end > 0 && /^\d+$/.test(fields[19] || '') ? fields[19] : null;
}
function validCurrent(value) {
  return value && /^[0-9a-f]{32}$/.test(value.id) && bridge.sources.indexOf(value.source) >= 0 &&
    typeof value.pid === 'number' && value.pid > 1 && value.pid === Math.floor(value.pid) &&
    /^\d+$/.test(value.start || '') && typeof value.at === 'number' && isFinite(value.at);
}
function create(options) {
  options = options || {};
  var disk = options.fs || fs, childProcess = options.cp || cp, now = options.now || Date.now;
  var base = options.base || ROOT, run = options.run || RUN, app = options.app || APP, proc = options.proc || '/proc';
  var sessions = path.join(run, 'sessions'), currentFile = path.join(run, 'current.json');
  function read(file) { try { return JSON.parse(disk.readFileSync(file, 'utf8')); } catch (error) { return null; } }
  function write(file, value) {
    var temporary = file + '.tmp.' + process.pid;
    disk.writeFileSync(temporary, JSON.stringify(value) + '\n', {mode: 384}); disk.renameSync(temporary, file);
  }
  function mkdir(dir) {
    try { disk.mkdirSync(dir, 448); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    var stat = disk.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (typeof stat.uid === 'number' && stat.uid !== process.getuid()))
      throw Error('Unsafe runtime directory');
    disk.chmodSync(dir, 448);
  }
  function setup() { mkdir(run); mkdir(sessions); }
  function directory(id) { return path.join(sessions, id); }
  function state(record) {
    var value = read(path.join(directory(record.id), 'worker.json'));
    return value && value.id === record.id && value.pid === record.pid && value.start === record.start ? value : null;
  }
  function identity(record) {
    if (!validCurrent(record)) return false;
    try {
      if (startTime(disk.readFileSync(path.join(proc, String(record.pid), 'stat'), 'utf8')) !== record.start) return false;
      var args = disk.readFileSync(path.join(proc, String(record.pid), 'cmdline'), 'utf8').split('\0').filter(Boolean);
      return (args[1] === path.join(base, 'runtime.js') && args[2] === 'worker' && args[3] === record.id && args[4] === record.source) ||
        (args[1] === path.join(base, 'worker.sh') && args[2] === record.id && args[3] === record.source);
    } catch (error) { return false; }
  }
  function log(entry) {
    var file = path.join(run, 'runtime.log');
    try {
      if (disk.existsSync(file) && disk.statSync(file).size >= LOG_LIMIT) disk.renameSync(file, file + '.1');
      disk.appendFileSync(file, JSON.stringify(entry).slice(0, 2048) + '\n', {mode: 384});
    } catch (error) { /* Logging never prevents the native lease from ending. */ }
  }
  function cancelled(record) {
    var current = read(currentFile);
    return !current || current.id !== record.id || current.pid !== record.pid || current.start !== record.start ||
      disk.existsSync(path.join(base, 'disabled')) || disk.existsSync(path.join(directory(record.id), 'cancel.json'));
  }
  function cancel(record, reason) {
    // A pathname alone never authorizes signalling a PID. Cancellation is a
    // nonce-scoped file consumed only by the matching worker; no global kills.
    if (identity(record)) write(path.join(directory(record.id), 'cancel.json'), {id: record.id, at: now(), reason: reason});
  }
  function available() {
    if (disk.existsSync(path.join(base, 'disabled'))) return false;
    try {
      var qml = qmlDirectory();
      return ['runtime.js','runtime.sh','worker.sh','bridge.js'].every(function (name) {
        return disk.statSync(path.join(base, name)).isFile();
      }) && ['Host.qml','Backdrop.qml'].every(function (name) { return disk.statSync(path.join(qml, name)).isFile(); }) &&
        disk.statSync(path.join(app, 'native-blur.js')).isFile() &&
        /src=["']native-blur\.js["']/.test(disk.readFileSync(path.join(app, 'overlay.html'), 'utf8'));
    } catch (error) { return false; }
  }
  function qmlDirectory() {
    var marker = path.join(base, 'qml-release');
    if (!disk.existsSync(marker)) return base;
    var version = disk.readFileSync(marker, 'utf8').trim();
    if (!/^\d+\.\d+\.\d+(?:-[a-z0-9-]+)?$/.test(version)) throw Error('Invalid QML release');
    return path.join(base, 'releases', version);
  }
  function prune(except) {
    var names = disk.readdirSync(sessions).filter(function (id) { return /^[0-9a-f]{32}$/.test(id) && id !== except; });
    names.sort(function (a, b) { return disk.statSync(directory(b)).mtime.getTime() - disk.statSync(directory(a)).mtime.getTime(); });
    names.slice(KEEP - 1).forEach(function (id) {
      var dir = directory(id), stat = disk.lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return;
      // Remove only our fixed file set; unknown contents keep the directory.
      ['worker.json','cancel.json','dead.json','session-result.json'].forEach(function (name) {
        try { disk.unlinkSync(path.join(dir, name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      });
      try { disk.rmdirSync(dir); } catch (error) { if (error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') throw error; }
    });
  }
  function request(source) {
    setup();
    var current = read(currentFile), previous = null;
    if (current && !validCurrent(current)) return Promise.resolve(10);
    if (current) {
      var status = state(current);
      if (identity(current)) {
        cancel(current, 'toggle');
        if (!status || status.phase === 'opening') return Promise.resolve(0);
        // Do not race a new plain launch against an old SAM launch that may
        // still settle. A fresh worker waits on the lifecycle lock instead.
        if (status.phase === 'closing' && bridge.sources.indexOf(source) >= 0 && available()) previous = current;
        else return Promise.resolve(10);
      }
      if (!previous && (!status || status.phase !== 'closed' || status.cleanupVerified !== true)) {
        var deadFile = path.join(directory(current.id), 'dead.json'), dead = read(deadFile);
        if (!dead || dead.id !== current.id || typeof dead.at !== 'number' || dead.at > now()) {
          write(deadFile, {id: current.id, at: now()}); return Promise.resolve(10);
        }
        // Foreground inventory excludes closing QML windows. After a lost
        // worker allow outstanding launch + startup/heartbeat leases to expire.
        if (now() - dead.at < QUARANTINE) return Promise.resolve(10);
      }
    }
    if (bridge.sources.indexOf(source) < 0 || !available()) return Promise.resolve(10);
    var id = crypto.randomBytes(16).toString('hex'), dir = directory(id);
    mkdir(dir); prune(id);
    var worker;
    try { worker = childProcess.spawn('/bin/sh', [path.join(base, 'worker.sh'), id, source], {detached: true, stdio: 'ignore'}); }
    catch (error) { log({event: 'spawn-failed'}); return Promise.resolve(10); }
    var spawnError = null;
    worker.on('error', function (error) { spawnError = error; });
    worker.unref();
    var record = {id: id, source: source, pid: worker.pid, start: '', at: now()};
    if (previous) record.previous = {id: previous.id, source: previous.source, pid: previous.pid, start: previous.start, at: previous.at};
    try { record.start = startTime(disk.readFileSync(path.join(proc, String(worker.pid), 'stat'), 'utf8')); }
    catch (error) { spawnError = error; }
    if (spawnError || !validCurrent(record)) return Promise.resolve(10);
    write(currentFile, record);
    // Publishing the exact PID/start/nonce is the handoff. Node startup on the
    // TV can take several seconds; waiting for its JS acknowledgement under the
    // Settings lock both delayed the next press and cancelled healthy workers.
    // A press while worker.json is absent still cancels this owned opening.
    return Promise.resolve(0);
  }
  function close(reason) {
    setup(); var current = read(currentFile);
    if (validCurrent(current)) cancel(current, reason || 'close');
    return 0;
  }
  function worker(id, source) {
    if (!/^[0-9a-f]{32}$/.test(id) || bridge.sources.indexOf(source) < 0) return Promise.reject(Error('Invalid worker request'));
    setup();
    return new Promise(function (resolve, reject) {
      var until = now() + 1500;
      function begin() {
        var record = read(currentFile);
        if (!validCurrent(record) || record.id !== id || record.source !== source || record.pid !== process.pid || !identity(record)) {
          if (now() < until) { setTimeout(begin, 20); return; }
          reject(Error('Worker ownership was not established')); return;
        }
        var value = {id: id, source: source, pid: record.pid, start: record.start, phase: 'opening', at: now()};
        function save() { value.at = now(); write(path.join(directory(id), 'worker.json'), value); }
        save();
        if (record.previous) {
          var prior = validCurrent(record.previous) ? state(record.previous) : null;
          if (!prior || prior.phase !== 'closed' || prior.cleanupVerified !== true) {
            value.phase = 'closed'; value.cleanupVerified = false; save(); reject(Error('Previous cleanup was not verified')); return;
          }
        }
        if (cancelled(record)) { value.phase = 'closed'; value.cleanupVerified = true; save(); resolve(); return; }
        bridge.run({base: directory(id), runtime: qmlDirectory(), sourceAppId: source, fallback: true,
          cancelled: function () { return cancelled(record); }, log: log,
          stage: function (stage) { value.phase = stage === 'active' ? 'active' : stage === 'closing' ? 'closing' : 'opening'; value.stage = stage; save(); },
          completed: function (result) { value.phase = 'closed'; value.cleanupVerified = result.cleanupVerified === true; value.reason = result.reason; save(); }
        }).then(resolve, function (error) { log({event: 'worker-ended', error: error.message}); reject(error); });
      }
      begin();
    });
  }
  function command(mode, source) {
    if (mode === 'request') return request(source);
    if (mode === 'worker') return worker(source, arguments[2]).then(function () { return 0; });
    if (mode === 'close') return Promise.resolve(close('close'));
    if (mode === 'disable') { disk.writeFileSync(path.join(base, 'disabled'), 'disabled\n', {mode: 384}); return Promise.resolve(close('disable')); }
    if (mode === 'enable') { try { disk.unlinkSync(path.join(base, 'disabled')); } catch (error) { if (error.code !== 'ENOENT') throw error; } return Promise.resolve(0); }
    if (mode === 'status') {
      var current = read(currentFile);
      return Promise.resolve({enabled: available(), live: identity(current), session: validCurrent(current) ? state(current) : null});
    }
    return Promise.resolve(10);
  }
  return {command: command, request: request, close: close, identity: identity, available: available, state: state, cancelled: cancelled, log: log};
}
module.exports = {create: create, startTime: startTime, validCurrent: validCurrent, quarantine: QUARANTINE};
if (require.main === module) {
  create().command(process.argv[2] || 'status', process.argv[3], process.argv[4]).then(function (result) {
    if (typeof result === 'number') process.exitCode = result;
    else console.log(JSON.stringify(result));
  }, function (error) { console.error('Native blur runtime: ' + error.message); process.exitCode = 10; });
}
