/* Reversible Settings binding and durable trial lease. Keep compatible with Node 0.12 / ES5. */
'use strict';
var fs = require('fs');
var base = '/home/root/lg-tv-vibehack/control-centre';
var app = '/media/developer/apps/usr/palm/applications/com.gathin.tvcontrolcentre';
var homeApp = '/media/developer/apps/usr/palm/applications/com.gathin.tvhome';
var homeDescription = '/home/root/lg-tv-vibehack/system-home/wam-launch.json';
var homeActive = '/tmp/lg-tv-system-home.active';
var keyfile = '/home/root/.config/lginputhook/keybinds.json';
var recovery = base + '/recovery';
var snapshot = recovery + '/settings-key.json';
var command = base + '/toggle.sh';
var key = '139'; // Input Hook's raw MENU code. Home (773) is never changed.
var own = { action: 'exec', command: command };
function has(object, name) { return Object.prototype.hasOwnProperty.call(object, name); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function ownKey(value) {
  return object(value) && Object.keys(value).length === 2 && value.action === own.action && value.command === own.command;
}
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value, expected) {
  var temp = file + '.control-centre-tmp', before = fs.existsSync(file) ? fs.statSync(file) : null;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: before ? before.mode & 511 : 384 });
  try {
    if (typeof expected !== 'undefined') {
      var actual = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (actual !== expected) throw Error('Configuration changed during update; refusing to overwrite it.');
    }
    // Older Input Hook releases poll whole-second mtimes. Every atomic replacement
    // must have a different mtime even during an immediate install/restore pair.
    if (before && Math.floor(before.mtime.getTime() / 1000) >= Math.floor(Date.now() / 1000)) {
      var next = new Date(before.mtime.getTime() + 1000);
      fs.utimesSync(temp, next, next);
    }
    fs.renameSync(temp, file);
  } catch (error) {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    throw error;
  }
}
function config() {
  var raw = fs.existsSync(keyfile) ? fs.readFileSync(keyfile, 'utf8') : null;
  var keys = raw === null ? {} : JSON.parse(raw);
  if (!object(keys)) throw Error('Invalid Input Hook configuration; existing bytes retained.');
  return { keys: keys, raw: raw };
}
function saved() {
  var value = read(snapshot);
  if (!object(value) || value.schema !== 1 || value.key !== key || value.command !== command ||
      typeof value.present !== 'boolean' || !has(value, 'value') || (!value.present && value.value !== null) || ownKey(value.value) ||
      typeof value.confirmed !== 'boolean' || typeof value.token !== 'string' || !/^[0-9]+-[0-9]+$/.test(value.token) ||
      typeof value.deadline !== 'number' || !isFinite(value.deadline) || value.deadline <= 0) {
    throw Error('Invalid Settings recovery snapshot; retained for manual recovery.');
  }
  return value;
}
function original(keys, old) { return has(keys, key) === old.present && (!old.present || equal(keys[key], old.value)); }
function manifest() {
  var value = read(app + '/appinfo.json');
  if (!object(value) || value.id !== 'com.gathin.tvcontrolcentre' || value.type !== 'web' ||
      value.main !== 'overlay.html' || value.defaultWindowType !== 'overlay' || value.transparent !== true ||
      value.visible !== false || value.handlesRelaunch !== true || value.disableBackHistoryAPI !== true ||
      !fs.existsSync(app + '/overlay.html') || fs.statSync(app + '/overlay.html').size === 0) {
    throw Error('Install the dedicated transparent Control Centre overlay before mapping Settings.');
  }
}
function requestTemplate(name, value) {
  var file = recovery + '/' + name;
  if (!value) { if (fs.existsSync(file)) fs.unlinkSync(file); return; }
  var text = JSON.stringify(value) + '\n';
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return;
  fs.writeFileSync(file + '.tmp', text, { mode: 384 });
  fs.renameSync(file + '.tmp', file);
}
function homeRequests() {
  var sam = null, wam = null;
  try {
    var info = read(homeApp + '/appinfo.json');
    var html = fs.readFileSync(homeApp + '/index.html', 'utf8');
    if (!object(info) || info.id !== 'com.gathin.tvhome' || info.type !== 'web' || info.main !== 'index.html' ||
        !fs.statSync(homeApp + '/home-settings.js').isFile() || fs.statSync(homeApp + '/home-settings.js').size === 0 ||
        !/<script\b[^>]*\bsrc\s*=\s*["']home-settings\.js(?:\?[^"']*)?["']/.test(html)) throw Error('Home Control Centre handler unavailable');
    var parameters = { controlCentre: true, controlCentreRequestId: '__CC_REQUEST__' };
    sam = { id: 'com.gathin.tvhome', params: parameters };
    if (fs.existsSync(homeActive) && fs.statSync(homeActive).isFile()) {
      var request = read(homeDescription), desc = request && request.appDesc;
      if (!object(desc) || desc.id !== 'com.webos.app.home' || desc.type !== 'web' ||
          desc.folderPath !== homeApp || desc.main !== 'index.html' ||
          typeof request.instanceId !== 'string' || !/^[a-zA-Z0-9_.-]{1,128}$/.test(request.instanceId) ||
          JSON.stringify(desc).indexOf('__CC_REQUEST__') !== -1) throw Error('Unsupported native Home descriptor');
      wam = { appDesc: desc, parameters: parameters, launchingAppId: '', launchingProcId: '', instanceId: request.instanceId };
    }
  } catch (error) {
    // Home routing is optional. Unsupported or missing Home files never disable
    // the separately validated overlay or change the existing Settings binding.
  }
  requestTemplate('home-sam-request.json', sam);
  requestTemplate('home-wam-request.json', wam);
}
function status() {
  var current = config();
  if (!fs.existsSync(snapshot)) {
    if (ownKey(current.keys[key])) throw Error('Our Settings binding has no recovery snapshot.');
    return 'unbound';
  }
  var old = saved();
  if (!ownKey(current.keys[key])) return original(current.keys, old) ? 'restored' : 'foreign';
  return old.confirmed ? 'confirmed' : (Date.now() >= old.deadline ? 'expired' : 'trial');
}
function main(mode) {
  var current, old, token, deadline, state;
  if (mode === 'check') { manifest(); return; }
  if (mode === 'status') { console.log(status()); return; }
  if (mode === 'allowed' || mode === 'authorization') {
    state = status();
    if (state !== 'confirmed' && state !== 'trial') process.exit(2);
    manifest();
    if (mode === 'authorization') {
      homeRequests();
      old = saved();
      console.log(old.confirmed ? '0' : String(Math.floor(old.deadline / 1000)));
    }
    return;
  }
  if (mode === 'install') {
    manifest();
    current = config();
    if (fs.existsSync(snapshot)) {
      old = saved();
      if (ownKey(current.keys[key])) {
        if (!old.confirmed && Date.now() >= old.deadline) throw Error('Previous trial expired; restore before trying again.');
        console.log('Settings already mapped; original snapshot and lease retained.');
        return;
      }
      throw Error('Previous Settings snapshot exists; restore or inspect it before starting a new trial.');
    }
    if (ownKey(current.keys[key])) throw Error('Settings snapshot missing; refusing to replace recovery information.');
    token = process.argv[3]; deadline = Number(process.argv[4]);
    if (!/^[0-9]+-[0-9]+$/.test(token || '') || !isFinite(deadline) || deadline <= Date.now() || deadline > Date.now() + 601000) {
      throw Error('Expected a unique trial token and a deadline within ten minutes.');
    }
    if (!fs.existsSync(recovery)) fs.mkdirSync(recovery, 448);
    old = { schema: 1, key: key, command: command, present: has(current.keys, key),
      value: has(current.keys, key) ? current.keys[key] : null, confirmed: false, token: token, deadline: deadline };
    write(snapshot, old);
    current.keys[key] = own;
    write(keyfile, current.keys, current.raw);
    console.log('Settings mapped temporarily; original key saved.');
    return;
  }
  if (mode === 'confirm') {
    manifest(); current = config(); old = saved();
    if (!ownKey(current.keys[key])) throw Error('Settings binding changed elsewhere; cannot confirm.');
    if (!old.confirmed && Date.now() >= old.deadline) throw Error('Trial has expired; restore and start a new trial.');
    old.confirmed = true; write(snapshot, old);
    console.log('Settings binding confirmed persistently.');
    return;
  }
  if (mode === 'restore') {
    current = config();
    if (!fs.existsSync(snapshot)) {
      if (ownKey(current.keys[key])) throw Error('Settings snapshot missing; refusing to discard the binding.');
      console.log('No Settings binding to restore.'); return;
    }
    old = saved(); token = process.argv[3];
    if (token && (token !== old.token || old.confirmed)) {
      console.log('Stale or confirmed trial ignored.'); return;
    }
    if (ownKey(current.keys[key])) {
      if (old.present) current.keys[key] = old.value;
      else delete current.keys[key];
      write(keyfile, current.keys, current.raw);
    } else if (!original(current.keys, old)) {
      console.log('Settings changed elsewhere; newer binding and original recovery snapshot retained.');
      return;
    }
    fs.unlinkSync(snapshot);
    console.log('Original Settings key restored; all other bindings retained.');
    return;
  }
  throw Error('Use check, status, allowed, authorization, install, confirm or restore.');
}
if (require.main === module) {
  try { main(process.argv[2]); }
  catch (error) { console.error(error.message); process.exit(1); }
}
module.exports = { ownKey: ownKey };
