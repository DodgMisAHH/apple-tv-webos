#!/usr/bin/env node
/* Temporary, reversible LS2 web-client policy. Never changes LG's native role. ES5. */
'use strict';

var fs = require('fs');
var path = require('path');
var ID = 'io.github.lgtv.vibehack.systemhome.web';
var HOME = 'com.webos.app.home';
var WIFI_GROUP = ID + '.wifi.connect';
var WIFI_CLIENTS = [HOME + '-*', 'com.gathin.tvhome-*', 'com.gathin.tvcontrolcentre-*'];
var WIFI_METHODS = ['com.webos.service.wifi/connect', 'com.webos.service.wifi/getprofilelist'];

function defaultPaths() {
  var base = '/tmp/lg-tv-system-home/ls2';
  return { base: base, role: base + '/' + ID + '.role.json', permission: base + '/' + ID + '.perm.json',
    api: base + '/' + ID + '.api.json', manifest: base + '/' + ID + '.manifest.json', owner: base + '/ownership.json' };
}
function json(value) { return JSON.stringify(value, null, 2) + '\n'; }
function expectedFiles(paths, revision) {
  var permission = {}, api = {}, result;
  permission[HOME + '-*'] = ['public'];
  result = {
    role: json({ appId: HOME, type: 'regular', trustLevel: '', allowedNames: [HOME + '-*'],
      permissions: [{ service: HOME + '-*', outbound: ['*'] }] }),
    permission: json(permission),
    manifest: json({ id: ID, roleFiles: [paths.role], clientPermissionFiles: [paths.permission], version: '1.0.0' })
  };
  // Recognize only the exact former policy when upgrading or rolling it back.
  if (revision === 1) return result;
  WIFI_CLIENTS.forEach(function (client) {
    if (!permission[client]) permission[client] = [];
    permission[client].push(WIFI_GROUP);
  });
  api[WIFI_GROUP] = WIFI_METHODS;
  result.permission = json(permission);
  result.api = json(api);
  result.manifest = json({ id: ID, roleFiles: [paths.role], clientPermissionFiles: [paths.permission],
    apiPermissionFiles: [paths.api], version: '1.1.0' });
  // The two installed com.gathin apps already have appId-bound roles. Add only
  // this group to their client names; do not replace their roles/public groups,
  // assign networking/private, or grant anything to the WebAppMgr executable.
  return result;
}

// The bus owns these methods internally, so it need not appear as a registered service.
// Explicit removal unloads the cached external manifest; rescanning is not equivalent.
function changePolicy(action, manifest, callback, options) {
  options = options || {};
  var cp = options.cp || require('child_process');
  if (action !== 'add' && action !== 'remove') { callback(new Error('Invalid LS2 policy action')); return; }
  var method = action === 'add' ? 'addOneManifest' : 'removeOneManifest';
  try {
    cp.execFile('/usr/bin/luna-send', ['-w', '5000', '-n', '1', 'luna://com.webos.service.bus/' + method,
      JSON.stringify({ prefix: '', path: manifest })], { timeout: 6500, maxBuffer: 16384 }, function (error, stdout, stderr) {
      var output = String(stdout || '').trim(), answer = null;
      try { answer = JSON.parse(output); } catch (e) {}
      if (!answer) output.split('\n').forEach(function (line) { try { answer = JSON.parse(line); } catch (e) {} });
      var duplicate = action === 'add' && answer && answer.returnValue === false && answer.errorCode === -1 &&
        answer.errorText === 'Skipping already loaded manifest <' + manifest + '>';
      if (!error && answer && (answer.returnValue === true || duplicate)) {
        callback(null, output.slice(-16384));
      } else {
        // Some firmware emits invalid JSON when errorText contains an unescaped quote.
        callback(new Error('LS2 ' + method + ' failed: ' +
          (error ? error.message : output || String(stderr || 'No response')).slice(0, 1000)), output.slice(-16384));
      }
    });
  } catch (e) { callback(e); }
}

function createManager(options) {
  options = options || {};
  var files = options.fs || fs, paths = options.paths || defaultPaths();
  var change = options.change || changePolicy, expected = expectedFiles(paths), legacy = expectedFiles(paths, 1);
  var keys = ['role', 'permission', 'api', 'manifest'], sequence = 0;
  function exists(file) { try { files.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
  function regular(file) { return files.lstatSync(file).isFile() && !files.lstatSync(file).isSymbolicLink(); }
  function directory(file, create) {
    if (!exists(file)) {
      if (!create) throw new Error('Missing LS2 directory: ' + file);
      files.mkdirSync(file, 448);
    }
    var stat = files.lstatSync(file);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe LS2 directory: ' + file);
  }
  function state() {
    if (!exists(paths.owner)) return null;
    if (!regular(paths.owner)) throw new Error('Foreign LS2 ownership marker');
    var saved = JSON.parse(files.readFileSync(paths.owner, 'utf8'));
    if (saved.id !== ID || [1, 2].indexOf(saved.version) < 0 || ['install', 'remove'].indexOf(saved.intent) < 0 ||
        ['pending', 'complete'].indexOf(saved.policy) < 0 ||
        (saved.version === 2 && [1, 2].indexOf(saved.revision) < 0) ||
        (saved.upgrading !== undefined && saved.upgrading !== true) ||
        (saved.upgrading && (saved.version !== 2 || saved.revision !== 2 || saved.policy !== 'pending'))) {
      throw new Error('Foreign LS2 ownership marker');
    }
    return saved;
  }
  function revision(saved) { return saved.version === 1 ? 1 : saved.revision; }
  function atomicWrite(file, value, mode) {
    // A killed writer can leave an unreferenced temporary file, but never a
    // partially rewritten policy or a fixed-name temp that blocks recovery.
    var temporary = file + '.tmp-' + process.pid + '-' + (++sequence), created = false;
    try {
      files.writeFileSync(temporary, value, { flag: 'wx', mode: mode });
      created = true;
      files.renameSync(temporary, file);
    } finally {
      try { if (created && exists(temporary)) files.unlinkSync(temporary); } catch (e) {}
    }
  }
  function saveState(intent, policy, fileRevision, upgrading) {
    var value = { id: ID, version: 2, revision: fileRevision, intent: intent, policy: policy };
    if (upgrading) value.upgrading = true;
    atomicWrite(paths.owner, json(value), 384);
  }
  function verifyOwned(requireOwner) {
    var saved = state();
    keys.forEach(function (key) {
      if (!exists(paths[key])) return;
      var value = regular(paths[key]) ? files.readFileSync(paths[key], 'utf8') : null;
      var owned = saved && (value === (revision(saved) === 1 ? legacy[key] : expected[key]) ||
        (saved.upgrading && value === legacy[key]));
      if (!owned) {
        throw new Error('Refusing to change foreign LS2 file: ' + paths[key]);
      }
    });
    if (requireOwner && !saved) throw new Error('Missing LS2 ownership marker');
    return saved;
  }
  function status() {
    var saved = verifyOwned(false), present = {};
    keys.forEach(function (key) { present[key] = exists(paths[key]); });
    return { owned: !!saved, intent: saved ? saved.intent : null, policy: saved ? saved.policy : null,
      revision: saved ? revision(saved) : null, upgrading: !!(saved && saved.upgrading),
      files: present, manifestPath: paths.manifest };
  }
  function finish(callback, error, output) {
    var current;
    try { current = status(); } catch (e) { if (!error) error = e; }
    callback(error, current, output);
  }
  function publish(callback) {
    try {
      verifyOwned(true);
      // Publish the manifest last, after its complete role and permissions exist.
      keys.forEach(function (key) {
        if (!exists(paths[key]) || files.readFileSync(paths[key], 'utf8') !== expected[key]) {
          atomicWrite(paths[key], expected[key], 420);
        }
      });
      saveState('install', 'pending', 2);
      verifyOwned(true);
    } catch (e) { finish(callback, e); return; }
    change('add', paths.manifest, function (error, output) {
      if (error) { finish(callback, error, output); return; }
      try { verifyOwned(true); saveState('install', 'complete', 2); }
      catch (e) { finish(callback, e, output); return; }
      finish(callback, null, output);
    });
  }
  function install(callback) {
    var saved, unload;
    try {
      directory(path.dirname(paths.base), true); directory(paths.base, true);
      directory(path.dirname(paths.manifest), false);
      saved = verifyOwned(false);
      unload = saved && (revision(saved) === 1 || saved.intent === 'remove');
      saveState('install', 'pending', saved ? revision(saved) : 2, saved && saved.upgrading);
    } catch (e) { callback(e); return; }
    if (!unload) { publish(callback); return; }
    // addOneManifest skips an already cached path. Explicitly unload revision 1
    // before any rewrite; a failed unload leaves its exact files available.
    change('remove', paths.manifest, function (error, output) {
      if (error) { finish(callback, error, output); return; }
      try { verifyOwned(true); saveState('install', 'pending', 2, true); }
      catch (e) { finish(callback, e, output); return; }
      publish(callback);
    });
  }
  function remove(callback) {
    try {
      var saved = verifyOwned(false);
      if (!saved) { callback(null, status()); return; }
      saveState('remove', 'pending', revision(saved), saved.upgrading);
      // Keep all owned files until the bus confirms it unloaded its cached manifest.
    } catch (e) { callback(e); return; }
    change('remove', paths.manifest, function (error, output) {
      if (error) { finish(callback, error, output); return; }
      try {
        verifyOwned(true);
        keys.forEach(function (key) { if (exists(paths[key])) files.unlinkSync(paths[key]); });
        files.unlinkSync(paths.owner);
        callback(null, status(), output);
      } catch (e) { callback(e); }
    });
  }
  return { install: install, remove: remove, status: status };
}

module.exports = { createManager: createManager, expectedFiles: expectedFiles, defaultPaths: defaultPaths,
  changePolicy: changePolicy, manifestId: ID, wifiGroup: WIFI_GROUP };
if (require.main === module) {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) throw new Error('Root required for LS2 policy changes');
  var manager = createManager(), command = process.argv[2];
  if (command === 'status') console.log(JSON.stringify(manager.status()));
  else if (command === 'install' || command === 'remove') manager[command](function (error, current, output) {
    if (current) console.log(JSON.stringify(current));
    if (output && output.trim()) console.log(output.trim());
    if (error) { console.error(error.message); process.exitCode = 1; }
  });
  else throw new Error('Use install, remove or status');
}
