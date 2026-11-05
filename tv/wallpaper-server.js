#!/usr/bin/env node
/*
 * LG TV Vibehack - runs ON the rooted TV.
 * A small web page for changing the wallpaper from a phone: the launcher's Wallpaper button shows a
 * QR code, the phone opens this page, picks a photo (from the phone or from a USB stick in the TV),
 * and the photo becomes the wallpaper. The phone crops and shrinks the photo to 1920x1080 first.
 * The same page sets the weather city (looked up on Open-Meteo, no API key).
 *
 * Every page and action needs the key in the QR code (kept in DATA/.wallpaper-key), so other people
 * on the same Wi-Fi cannot change it. The launcher cannot make HTTP calls to the TV itself on webOS 6,
 * so the address goes into a file it loads (wall.js), and after a change the server relaunches it
 * with {reload: true}.
 * Plain ES5: the TV runs Node 8.
 */
'use strict';
var http = require('http');
var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var parseUrl = require('url').parse;
var execFile = require('child_process').execFile;
var publication = require('./publication');

var PORT = 8090;
var DATA = publication.data;
var APP_DIR = publication.app;
var WALLPAPER = path.join(DATA, 'wallpaper.jpg');
var FROST = path.join(DATA, 'wallpaper-frost.jpg');
var SETTINGS = path.join(DATA, 'settings.json');
var USB_ROOT = '/tmp/usb';
var MAX_UPLOAD = 10 * 1024 * 1024;
var IMAGE_RE = /\.(jpe?g|png|webp)$/i;
var addressTimer = null;

function log(msg) { console.log(new Date().toISOString() + ' wallpaper: ' + msg); }

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function loadKey() {
  var f = path.join(DATA, '.wallpaper-key');
  try {
    var k = fs.readFileSync(f, 'utf8').trim();
    if (/^[0-9a-f]{12}$/.test(k)) return k;
  } catch (e) { /* first run */ }
  k = crypto.randomBytes(6).toString('hex');
  fs.writeFileSync(f, k, { mode: 384 });
  return k;
}
var KEY = loadKey();

function tvAddress() {
  var nets = os.networkInterfaces(), names = ['eth0', 'wlan0'].concat(Object.keys(nets));
  for (var i = 0; i < names.length; i++) {
    var list = nets[names[i]] || [];
    for (var j = 0; j < list.length; j++) {
      if (list[j].family === 'IPv4' && !list[j].internal) return list[j].address;
    }
  }
  return '';
}

/** Tells the launcher where this page is (for the QR code). */
function writeWallJs() {
  try {
    var ip = tvAddress();
    var url = ip ? 'http://' + ip + ':' + PORT + '/?k=' + KEY : '';
    publication.atomicWrite(path.join(APP_DIR, 'wall.js'), '// Written by wallpaper-server.js\nwindow.WALL_URL = ' + JSON.stringify(url) + ';\n');
  } catch (e) { log('cannot write wall.js: ' + e.message); }
}
function refreshAddress() {
  writeWallJs();
  // Networking may come up after this daemon or change after DHCP renewal.
  // atomicWrite preserves the file when the published address is unchanged.
  addressTimer = setTimeout(refreshAddress, 15000);
}

/** Batch phone edits; publish settings without discovering apps or copying their icons. */
var syncCallbacks = [], syncTimer = null, syncing = false, settingsSequence = 0;
var settingsDirty = false;
var lastPublishedSettings = '';
try { lastPublishedSettings = fs.readFileSync(path.join(DATA, 'settings-published.json'), 'utf8'); } catch (e) {}
function runSettingsSync() {
  syncTimer = null;
  if (syncing || !syncCallbacks.length) return;
  var callbacks = syncCallbacks;
  syncCallbacks = [];
  syncing = true;
  execFile('/usr/bin/node', [path.join(DATA, 'sync.js'), '--settings'], { timeout: 300000 }, function (err, out, errOut) {
    syncing = false;
    if (err) log('sync failed: ' + (errOut || err.message));
    settingsDirty = !!err || syncCallbacks.length > 0;
    if (!settingsDirty) lastPublishedSettings = JSON.stringify(readJSON(SETTINGS, {}));
    writeWallJs();
    callbacks.forEach(function (cb) { cb(err); });
    if (syncCallbacks.length) syncTimer = setTimeout(runSettingsSync, 80);
    else if (!err) {
      var token = Date.now() + '-' + (++settingsSequence);
      execFile('luna-send', ['-w', '2500', '-n', '1', 'luna://com.webos.applicationManager/launch',
        JSON.stringify({ id: fs.existsSync('/tmp/lg-tv-system-home.active') ? 'com.webos.app.home' : 'com.gathin.tvhome', params: { settingsChanged: true,
          settingsToken: token, reload: true, reloadToken: token } })], { timeout: 3500 });
    }
  });
}
function sync(cb) {
  settingsDirty = true;
  syncCallbacks.push(cb);
  if (!syncing && !syncTimer) syncTimer = setTimeout(runSettingsSync, 80);
}

function saveSettings(change, res) {
  var st = readJSON(SETTINGS, {});
  change(st);
  if (!publication.atomicWrite(SETTINGS, JSON.stringify(st, null, 1)) && !settingsDirty && lastPublishedSettings === JSON.stringify(st))
    return json(res, 200, { ok: true });
  sync(function (err) { json(res, err ? 500 : 200, { ok: !err }); });
}

/** City search on Open-Meteo. curl, because Node 8's certificates are too old for some sites. */
function findCity(q, cb) {
  var url = 'https://geocoding-api.open-meteo.com/v1/search?count=6&format=json&language=en' +
    '&name=' + encodeURIComponent(q);
  execFile('curl', ['-fsSL', '--max-time', '15', url], { timeout: 20000 }, function (err, out) {
    if (err) return cb(err);
    var list;
    try { list = JSON.parse(out).results || []; } catch (e) { return cb(e); }
    cb(null, list.map(function (r) {
      // Open-Meteo spells some Vietnamese names with the Icelandic Ð.
      var fix = function (t) { return String(t || '').replace(/Ð/g, 'Đ').replace(/ð/g, 'đ'); };
      return { name: fix(r.name), region: fix(r.admin1), country: fix(r.country), latitude: r.latitude, longitude: r.longitude };
    }));
  });
}

function send(res, code, type, body, extra) {
  var h = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  for (var k in extra || {}) h[k] = extra[k];
  res.writeHead(code, h);
  res.end(body);
}
function json(res, code, obj, extra) { send(res, code, 'application/json', JSON.stringify(obj), extra); }

/** Images on USB sticks (webOS mounts them under /tmp/usb/sdX/sdX1). */
function usbImages() {
  var found = [];
  function walk(dir, depth) {
    if (depth > 5 || found.length >= 300) return;
    var names;
    try { names = fs.readdirSync(dir); } catch (e) { return; }
    names.sort().forEach(function (n) {
      if (n.charAt(0) === '.' || found.length >= 300) return;
      var p = path.join(dir, n), st;
      try { st = fs.statSync(p); } catch (e) { return; }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (IMAGE_RE.test(n) && st.size > 0) found.push(p);
    });
  }
  walk(USB_ROOT, 0);
  return found;
}

function insideUsb(p) {
  try {
    var real = fs.realpathSync(p);
    return real.indexOf(USB_ROOT + '/') === 0 && IMAGE_RE.test(real) ? real : '';
  } catch (e) { return ''; }
}

function streamUsbImage(real, res) {
  var stream = fs.createReadStream(real), stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    stream.destroy();
  }
  res.on('close', stop);
  stream.on('close', function () { res.removeListener('close', stop); });
  stream.on('error', function (err) {
    if (stopped) return;
    stop();
    // A USB stick can disappear between path validation, open and later reads.
    if (res.headersSent) res.destroy();
    else send(res, err.code === 'ENOENT' || err.code === 'ENOTDIR' ? 404 : 500, 'text/plain', 'Image unavailable');
  });
  stream.on('open', function () {
    if (stopped) return;
    var ext = path.extname(real).toLowerCase();
    res.writeHead(200, { 'Content-Type': ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg' });
    stream.pipe(res);
  });
}

function jpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 255 || buf[1] !== 216) return null;
  var at = 2;
  while (at + 4 <= buf.length) {
    if (buf[at++] !== 255) return null;
    while (buf[at] === 255) at++;
    var marker = buf[at++];
    if (marker === 217 || marker === 218) return null;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    var length = buf.readUInt16BE(at);
    if (length < 2 || at + length > buf.length) return null;
    if (marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204) {
      if (length < 7) return null;
      return { height: buf.readUInt16BE(at + 3), width: buf.readUInt16BE(at + 5) };
    }
    at += length;
  }
  return null;
}
/** Two bounded JPEG parts from the phone; raw JPEG remains compatible with older pages. */
function uploadParts(buf, type) {
  if (/^image\/jpeg(?:;|$)/i.test(type || '') || (buf[0] === 255 && buf[1] === 216)) return { wallpaper: buf };
  var match = /^multipart\/form-data;\s*boundary=(?:"([^"\r\n]+)"|([^;\s]+))/i.exec(type || '');
  var boundary = match && (match[1] || match[2]);
  if (!boundary || boundary.length > 70) throw new Error('Unsupported upload');
  var first = '--' + boundary + '\r\n', next = new Buffer('\r\n--' + boundary), at = first.length, parts = {};
  if (buf.slice(0, at).toString() !== first) throw new Error('Invalid multipart upload');
  for (var count = 0; count < 2; count++) {
    var headerEnd = buf.indexOf('\r\n\r\n', at);
    if (headerEnd < at || headerEnd - at > 2048) throw new Error('Invalid upload headers');
    var name = /name="(wallpaper|frost)"/.exec(buf.slice(at, headerEnd).toString());
    var end = buf.indexOf(next, headerEnd + 4);
    if (!name || parts[name[1]] || end < 0) throw new Error('Invalid upload part');
    parts[name[1]] = buf.slice(headerEnd + 4, end);
    at = end + next.length;
    if (buf.slice(at, at + 2).toString() === '--') return parts;
    if (buf.slice(at, at + 2).toString() !== '\r\n') throw new Error('Invalid upload boundary');
    at += 2;
  }
  throw new Error('Too many upload parts');
}

function handle(req, res) {
  var u = parseUrl(req.url, true), q = u.query, route = req.method + ' ' + u.pathname;
  if (q.k !== KEY) {
    return send(res, 403, 'text/html; charset=utf-8', page403());
  }

  if (route === 'GET /') {
    return fs.readFile(path.join(DATA, 'wallpaper.html'), function (err, buf) {
      if (err) return send(res, 500, 'text/plain', 'wallpaper.html missing, run the installer again');
      send(res, 200, 'text/html; charset=utf-8', buf);
    });
  }

  if (route === 'GET /api/state') {
    var s = readJSON(SETTINGS, {}), w = s.weather || {};
    return json(res, 200, {
      language: 'en', // Older cached phone pages still read this field.
      hasWallpaper: fs.existsSync(WALLPAPER),
      dim: typeof s.wallpaperDim === 'number' ? s.wallpaperDim : 0.35,
      weather: { enabled: !!(w.enabled && w.latitude), place: w.place || '' }
    });
  }

  if (route === 'GET /api/city') {
    var name = String(q.q || '').trim().slice(0, 80);
    if (!name) return json(res, 400, { error: 'empty' });
    return findCity(name, function (err, list) {
      if (err) return json(res, 502, { error: 'lookup failed' });
      json(res, 200, { results: list });
    });
  }

  if (route === 'POST /api/weather') {
    if (q.off) {
      log('weather off');
      return saveSettings(function (st) { if (st.weather) st.weather.enabled = false; }, res);
    }
    var lat = parseFloat(q.lat), lon = parseFloat(q.lon), place = String(q.place || '').slice(0, 80);
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return json(res, 400, { error: 'bad place' });
    log('weather city: ' + place);
    return saveSettings(function (st) {
      var unit = st.weather && st.weather.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
      st.weather = { enabled: true, latitude: lat, longitude: lon, place: place, unit: unit };
    }, res);
  }

  if (route === 'GET /current.jpg') {
    return fs.readFile(WALLPAPER, function (err, buf) {
      if (err) return send(res, 404, 'text/plain', 'none');
      send(res, 200, 'image/jpeg', buf);
    });
  }

  if (route === 'POST /api/upload') {
    var chunks = [], size = 0, tooBig = false;
    req.on('data', function (d) {
      if (tooBig) return;
      size += d.length;
      if (size > MAX_UPLOAD) { tooBig = true; chunks = []; json(res, 413, { error: 'too big' }); return; }
      chunks.push(d);
    });
    req.on('end', function () {
      if (tooBig) return;
      var buf = Buffer.concat(chunks);
      chunks = [];
      try {
        var parts = uploadParts(buf, req.headers['content-type']);
        var size = jpegSize(parts.wallpaper), frostSize = parts.frost && jpegSize(parts.frost);
        if (!size || !size.width || !size.height || size.width > 1920 || size.height > 1080 ||
            (parts.frost && (!frostSize || frostSize.width !== 384 || frostSize.height !== 216)))
          return json(res, 400, { error: 'Use a JPEG up to 1920x1080 and a 384x216 frost texture' });
        publication.atomicWrite(WALLPAPER, parts.wallpaper);
        if (parts.frost) {
          publication.atomicWrite(FROST, parts.frost);
          // An identical small texture is still valid for the newly supplied photo.
          var stamp = new Date(Math.ceil(Math.max(Date.now(), fs.statSync(WALLPAPER).mtime.getTime())) + 1);
          fs.utimesSync(FROST, stamp, stamp);
        }
        else try { fs.unlinkSync(FROST); } catch (e) {}
        log('new wallpaper, ' + Math.round(parts.wallpaper.length / 1024) + ' KB');
        sync(function (err) { json(res, err ? 500 : 200, { ok: !err }); });
      } catch (e) { json(res, 400, { error: e.message }); }
    });
    return;
  }

  if (route === 'POST /api/dim') {
    var v = parseFloat(q.v);
    if (!(v >= 0 && v <= 0.8)) return json(res, 400, { error: 'bad value' });
    return saveSettings(function (st) { st.wallpaperDim = Math.round(v * 100) / 100; }, res);
  }

  if (route === 'POST /api/clear') {
    try { fs.unlinkSync(WALLPAPER); } catch (e) { /* already gone */ }
    try { fs.unlinkSync(FROST); } catch (e) {}
    log('wallpaper removed');
    return sync(function (err) { json(res, err ? 500 : 200, { ok: !err }); });
  }

  if (route === 'GET /api/usb') {
    return json(res, 200, { images: usbImages().map(function (p) { return p.slice(USB_ROOT.length + 1); }) });
  }

  if (route === 'GET /api/usb/img') {
    var real = insideUsb(path.join(USB_ROOT, String(q.p || '')));
    if (!real) return send(res, 404, 'text/plain', 'not found');
    return streamUsbImage(real, res);
  }

  send(res, 404, 'text/plain', 'not found');
}

function page403() {
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<body style="font:18px system-ui,sans-serif;background:#111;color:#eee;padding:24px">' +
    '<p>Open this page by scanning the QR code on the TV (Wallpaper button).</p>';
}


http.createServer(function (req, res) {
  try { handle(req, res); } catch (e) { log('error: ' + e.message); try { json(res, 500, { error: 'server error' }); } catch (x) { /* sent */ } }
}).on('error', function (e) {
  log('cannot start: ' + e.message);
  process.exit(1);
}).on('close', function () {
  clearTimeout(addressTimer); addressTimer = null;
}).listen(PORT, function () { refreshAddress(); log('listening on port ' + PORT); });
