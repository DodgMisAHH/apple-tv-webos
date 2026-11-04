#!/usr/bin/env node
/*
 * LG TV Vibehack - runs ON the rooted TV.
 * Reads the installed apps and HDMI inputs straight from webOS (no computer needed), copies their
 * icons into the launcher, and applies your personal settings and wallpaper.
 * Runs at every boot and after every install, so new or removed apps show up automatically.
 *
 *   node /home/root/lg-tv-vibehack/sync.js          # sync now
 *   node /home/root/lg-tv-vibehack/sync.js --list   # print app ids and titles
 */
'use strict';
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var execFileSync = require('child_process').execFileSync;
var publication = require('./publication');

var APP_DIR = publication.app;
var DATA = publication.data;

function luna(uri, payload) {
  var out = execFileSync('luna-send', ['-n', '1', uri, JSON.stringify(payload || {})],
    { encoding: 'utf8', timeout: 15000, maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(out.trim().split('\n').pop());
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function safeName(id) { return id.replace(/[^A-Za-z0-9._-]/g, '_') + '.png'; }
function text(value, fallback) { return typeof value === 'string' && value ? value : (fallback || ''); }
function launchPoint(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof value.id === 'string' && value.id.length > 0;
}

function isFile(p) { try { return typeof p === 'string' && !!p && fs.statSync(p).isFile(); } catch (e) { return false; } }

// fs.copyFileSync only exists from Node 8.5. webOS 4 TVs run Node 0.12, where calling it threw and
// every app was skipped, so the launcher ended up empty. Keep every TV script ES5 and Node 0.12 safe.
function copyFile(src, dest) { return publication.copyChanged(src, dest); }
function iconSignature(stat) { return stat.size + ':' + stat.mtime.getTime() + ':' + stat.ino; }
function iconHash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function managedIcon(cached) {
  return cached && (cached.managed === true || (typeof cached.managed === 'undefined' &&
    typeof cached.source === 'string' && typeof cached.destination === 'string'));
}

// Where webOS keeps installed apps. Read when listLaunchPoints gives nothing (seen on webOS 4.4).
var APP_DIRS = [
  '/usr/palm/applications',
  '/media/cryptofs/apps/usr/palm/applications',
  '/media/developer/apps/usr/palm/applications',
  '/mnt/otycabi/usr/palm/applications',
  '/mnt/otncabi/usr/palm/applications'
];

function sleep(sec) { try { execFileSync('sleep', [String(sec)]); } catch (e) { /* no sleep binary */ } }

// For a minute or two after boot, webOS answers with an empty app list (seen on webOS 4.4), so ask
// again until it has one. Without this, every boot overwrote apps.js with nothing.
function fromLuna() {
  var tries = parseInt(process.env.SYNC_TRIES || '', 10) || 12;
  for (var i = 0; i < tries; i++) {
    var res = null;
    try {
      res = luna('luna://com.webos.applicationManager/listLaunchPoints');
    } catch (e) {
      console.error('listLaunchPoints failed: ' + e.message);
    }
    if (res && res.returnValue !== false && Array.isArray(res.launchPoints) &&
        res.launchPoints.length && res.launchPoints.every(launchPoint)) {
      if (i) console.error('App list ready after ' + (i * 5) + 's.');
      return res.launchPoints;
    }
    if (!i) console.error('App list not ready yet: ' + JSON.stringify(res).slice(0, 200));
    if (i < tries - 1) sleep(5);
  }
  console.error('listLaunchPoints still empty after ' + (tries * 5) + 's.');
  return [];
}

/** Builds launch points by reading every appinfo.json on disk. */
function fromDisk() {
  var seen = Object.create(null), out = [];
  APP_DIRS.forEach(function (dir) {
    var names;
    try { names = fs.readdirSync(dir); } catch (e) { return; }
    names.forEach(function (n) {
      var base = path.join(dir, n);
      var info = readJSON(path.join(base, 'appinfo.json'), null);
      if (!launchPoint(info) || seen[info.id] || info.visible === false) return;
      seen[info.id] = true;
      out.push({
        id: info.id,
        title: text(info.title, info.id),
        icon: text(info.icon) ? path.join(base, info.icon) : '',
        largeIcon: text(info.largeIcon) ? path.join(base, info.largeIcon) : '',
        iconColor: text(info.iconColor, text(info.bgColor))
      });
    });
  });
  return out;
}

/** webOS first; on firmware where that stays empty, the app folders on disk. */
function listPoints() {
  var points = fromLuna();
  if (points.length) return { points: points, source: 'webOS' };
  console.error('Falling back to reading the app folders on disk.');
  return { points: fromDisk(), source: 'disk' };
}

function inventory() {
  var found = listPoints(), points = found.points;

  if (process.argv.indexOf('--list') !== -1) {
    points.forEach(function (p) { console.log((p.id + '                                             ').slice(0, 45) + ' ' + text(p.title, p.id)); });
    return;
  }

  if (!fs.existsSync(APP_DIR)) {
    throw new Error('Launcher is not installed (' + APP_DIR + ' missing).');
  }

  // Inputs: ask webOS, fall back to the four standard HDMI ports.
  var inputs = [];
  try {
    var response = luna('luna://com.webos.service.eim/getAllInputStatus');
    var devs = response && response.returnValue !== false && Array.isArray(response.devices) ? response.devices : [];
    devs.forEach(function (d) {
      if (d && typeof d === 'object' && !Array.isArray(d) && text(d.appId)) {
        inputs.push({ appId: d.appId, label: text(d.label, text(d.id, d.appId)) });
      }
    });
  } catch (e) { /* older/newer firmware: use the fallback */ }
  if (!inputs.length) {
    [1, 2, 3, 4].forEach(function (n) { inputs.push({ appId: 'com.webos.app.hdmi' + n, label: 'HDMI ' + n }); });
  }

  // Apps and icons. Your own icons in DATA/icons/<app id>.png win over the TV's.
  var iconDir = path.join(APP_DIR, 'icons');
  if (!fs.existsSync(iconDir)) fs.mkdirSync(iconDir);
  var apps = [];
  var iconCacheFile = path.join(DATA, 'icon-cache.json');
  var oldIcons = readJSON(iconCacheFile, {}), nextIcons = {}, neededIcons = {};
  if (!oldIcons || typeof oldIcons !== 'object' || Array.isArray(oldIcons)) oldIcons = {};
  points.forEach(function (p) {
    if (!launchPoint(p) || p.hidden) return;
    var name = safeName(p.id);
    neededIcons[name] = true;
    var custom = path.join(DATA, 'icons', name);
    var src = isFile(custom) ? custom : (isFile(p.largeIcon) ? p.largeIcon : p.icon);
    var dest = path.join(iconDir, name), cached = oldIcons[name] || {};
    var signature = '', copied = false, icon = 'marks/apps.svg';
    // A missing or unreadable icon must never remove a launchable app. Retain a
    // last-known local icon when available, otherwise use the bundled app mark.
    try {
      if (isFile(src)) {
        var stat = fs.statSync(src);
        signature = src + ':' + stat.size + ':' + stat.mtime.getTime();
        var before = isFile(dest) ? iconSignature(fs.statSync(dest)) : '';
        if (cached.source !== signature || cached.destination !== before) copied = copyFile(src, dest);
      }
    } catch (e) { signature = ''; }
    try {
      var destination = iconSignature(fs.statSync(dest));
      var hash = cached.destination === destination && /^[a-f0-9]{64}$/.test(cached.hash || '') ? cached.hash : iconHash(dest);
      nextIcons[name] = { source: signature, destination: destination, hash: hash,
        managed: copied || (managedIcon(cached) && cached.destination === destination) };
      icon = 'icons/' + name + '?v=' + hash;
    } catch (e) { if (managedIcon(cached)) nextIcons[name] = cached; }
    apps.push({ id: p.id, title: text(p.title, p.id), icon: icon, iconColor: text(p.iconColor, text(p.bgColor)) });
  });
  // An empty list would leave an empty launcher on screen, so keep whatever is already there.
  if (!apps.length) {
    console.error('No apps found (node ' + process.version + ', ' + points.length + ' launch points).');
    console.error('Tried listLaunchPoints and ' + APP_DIRS.join(', ') + '.');
    console.error('The app list was left unchanged. Please report this with your TV model and');
    console.error('webOS version: https://github.com/hoangvya19/lg-tv-webos-vibehack/issues');
    throw new Error('No usable launch points; inventory was left unchanged');
  }

  publication.atomicWrite(path.join(APP_DIR, 'apps.js'),
    '// Generated on the TV by sync.js\nwindow.TV_APPS = ' + JSON.stringify({ apps: apps, inputs: inputs }, null, 1) + ';\n');
  // Delete only cache-owned obsolete icons whose bytes/metadata remain ours.
  // Bundled, manually replaced and custom source icons remain untouched.
  Object.keys(oldIcons).forEach(function (name) {
    var cached = oldIcons[name], file = path.join(iconDir, name);
    if (neededIcons[name] || !/^[A-Za-z0-9._-]+\.png$/.test(name) || !managedIcon(cached)) return;
    try {
      if (!fs.lstatSync(file).isFile() || iconSignature(fs.statSync(file)) !== cached.destination) return;
      if (cached.hash && iconHash(file) !== cached.hash) return;
      fs.unlinkSync(file);
    } catch (e) { if (e.code !== 'ENOENT') nextIcons[name] = cached; }
  });
  publication.atomicWrite(iconCacheFile, JSON.stringify(nextIcons));

  console.log('Synced ' + apps.length + ' apps (from ' + found.source + ') and ' + inputs.length + ' inputs.');
}

if (process.argv.indexOf('--list') !== -1) inventory();
else publication.enqueue(process.argv.indexOf('--settings') !== -1 ? 'settings' : 'full', function (mode) {
  if (mode === 'full') inventory();
  publication.settings();
}, function (error) {
  if (error) { console.error(error.message); process.exitCode = 1; }
});
