/*
 * Glass home for webOS: photo wallpaper, favourites shelf and an expanding app grid.
 *
 * webOS does not let third-party apps list installed apps, so sync-apps.py writes them into apps.js.
 */
(function () {
  'use strict';

  // Preserve saved tile density; otherwise use the configured column count.
  var COLS_KEY = 'tvhome.columns';
  var COLUMNS = (function () {
    var n = 0;
    try { n = parseInt(localStorage.getItem(COLS_KEY), 10); } catch (e) { /* storage unavailable */ }
    return n >= 3 && n <= 10 ? n : Math.max(1, CONFIG.columns || 4);
  })();
  // Reference measured inside the TV bezel, mapped to our 1920x1080 canvas.
  // Six columns: 250x150 cards on a 298px pitch; keep other saved column counts usable.
  var GRID_SIDE = 65, CELL_W = (1920 - 2 * GRID_SIDE) / COLUMNS;
  var TILE_W = Math.min(380, Math.round(CELL_W * 0.838));
  var TILE_H = Math.round(TILE_W * 0.6);
  (function () {
    var r = Math.round(TILE_W * 0.12), st = document.documentElement.style;
    st.setProperty('--tile-w', TILE_W + 'px');
    st.setProperty('--tile-h', TILE_H + 'px');
    st.setProperty('--tile-r', r + 'px');
    st.setProperty('--focus-scale', '1.22');
  })();
  var ROW_PITCH = TILE_H + 80;
  var DOCK_TOP = 976 - TILE_H;  // shelf ends at 1016; next row always peeks in at 1056
  var DOCK_GAP = 0;
  var VIEW_TOP = 80, VIEW_BOTTOM = 1060;    // area grid rows scroll into (the header hides below the dock)

  var MARKS = { 'netflix': 'netflix', 'amazon': 'primevideo', 'youtube.leanback.v4': 'youtube',
    'com.apple.appletv': 'appletv', 'com.disney.disneyplus-prod': 'disneyplus',
    'io.strem.tv': 'stremio', 'com.apple.applemusic': 'applemusic',
    'com.webos.app.browser': 'browser', 'com.webos.app.discovery': 'apps',
    'com.geforcenow.play': 'nvidia' };
  var BRANDS = { 'netflix': 'netflix', 'amazon': 'prime', 'youtube.leanback.v4': 'youtube',
    'com.apple.appletv': 'apple', 'com.disney.disneyplus-prod': 'disney',
    'io.strem.tv': 'stremio', 'com.apple.applemusic': 'music',
    'com.webos.app.browser': 'browser', 'com.webos.app.discovery': 'apps',
    'com.geforcenow.play': 'gfn' };

  // The desktop preview scales the same 1920x1080 canvas used on the TV.
  function logicalRect(el) {
    var r = el.getBoundingClientRect(), scale = window.LAUNCHER_SCALE || 1;
    return { left: r.left / scale, right: r.right / scale, top: r.top / scale,
      bottom: r.bottom / scale, width: r.width / scale, height: r.height / scale };
  }

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27 };

  var LANG = {
    en: {
      inputs: 'Inputs', settings: 'Settings', wired: 'Ethernet', offline: 'Offline', liveTv: 'Live TV',
      noInputs: 'No inputs found', cantOpen: "Can't open ", ampm: ['am', 'pm'],
      moveHint: 'Arrows or pointer to move  ·  OK to place  ·  Back to cancel',
      wallTitle: 'Change wallpaper',
      wallScan: 'Scan this code with your phone camera, then pick a photo.',
      wallOff: 'The wallpaper page is not running. Reboot the TV and try again.'
    },
    vi: {
      inputs: 'Nguồn vào', settings: 'Cài đặt', wired: 'Wi-Fi', offline: 'Mất mạng', liveTv: 'Truyền hình',
      noInputs: 'Không tìm thấy nguồn vào', cantOpen: 'Không mở được ', ampm: ['SA', 'CH'],
      moveHint: 'Mũi tên hoặc con trỏ để di chuyển  ·  OK để đặt  ·  Back để huỷ',
      wallTitle: 'Đổi hình nền',
      wallScan: 'Quét mã này bằng camera điện thoại rồi chọn ảnh.',
      wallOff: 'Trang đổi hình nền chưa chạy. Khởi động lại TV rồi thử lại.'
    }
  };
  var L = LANG[CONFIG.language] || LANG.en;

  var ICON_INPUT = 'M18,7V4c0,-1.1 -0.9,-2 -2,-2H8C6.9,2 6,2.9 6,4v3H5v6l3,6v3h8v-3l3,-6V7H18zM8,4h8v3h-2V5h-1v2h-2V5h-1v2H8V4z';
  var ICON_LIVETV = 'M21,6h-7.59l3.29,-3.29L16,2l-4,4l-4,-4l-0.71,0.71L10.59,6H3c-1.1,0 -2,0.89 -2,2v12c0,1.1 0.9,2 2,2h18c1.1,0 2,-0.89 2,-2V8C23,6.89 22.1,6 21,6zM21,20H3V8h18V20zM9,10v8l7,-4L9,10z';

  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), tilesEl = $('tiles'), band = $('dockBand'), frost = $('dockFrost');
  var ambients = [$('ambientA'), $('ambientB')], ambientFront = 0, ambientColor = null;
  var pills = [$('btnInputs'), $('btnWifi'), $('btnWall'), $('btnSettings')];
  var panel = $('inputsPanel'), wallPanel = $('wallPanel');

  var items = [];               // {app, el, color}
  var zone = 'grid';            // 'grid' | 'top' | 'inputs' | 'wall' | 'tileMenu'
  var focused = 0, pillFocus = 0, inputFocus = 0, inputRows = [];
  var offset = 0, renderedOffset = null, cacheOffset = null;
  var editing = null;           // {item, snapshot} while a tile is being moved
  var pressTimer = null;        // long press with the pointer
  var pressGeneration = 0, okItem = null, activePanels = {};
  var tileMenu = null, tileMenuShade = null, tileMenuButtons = [], tileMenuIndex = 0;
  var tileMenuTarget = null, consumePointerRelease = false;

  function cancelPress() {
    pressGeneration++;
    clearTimeout(pressTimer); clearTimeout(okTimer);
    pressTimer = null; okTimer = null; okItem = null;
    okDown = false;
  }

  function setPanelActive(name, active) {
    if (active) { activePanels[name] = true; cancelPress(); }
    else delete activePanels[name];
    noteInteraction();
  }

  // ---- luna bus ------------------------------------------------------------------------------

  var bridges = [];   // keep a reference: a collected bridge drops its callback

  function luna(uri, params, cb) {
    var b, expiry = null, released = false, callbackStarted = false;
    function release() {
      if (released) return;
      released = true; clearTimeout(expiry);
      var index = bridges.indexOf(b);
      if (index >= 0) bridges.splice(index, 1);
      if (b) {
        b.onservicecallback = null;
        try { if (typeof b.cancel === 'function') b.cancel(); } catch (e) { /* already closed */ }
      }
    }
    try {
      b = new PalmServiceBridge();
      b.onservicecallback = function (msg) {
        if (released) return;
        var res;
        try { res = JSON.parse(msg); } catch (e) { res = { returnValue: false }; }
        callbackStarted = true;
        try { if (cb) cb(res); }
        finally { if (!params || !params.subscribe) release(); }
      };
      bridges.push(b);
      // Request owners report their own timeout. This only bounds native bridge retention.
      // Wi-Fi authentication/DHCP has its own 45-second deadline in WifiControls.
      if (!params || !params.subscribe) expiry = setTimeout(release,
        uri === 'luna://com.webos.service.wifi/connect' ? 50000 : 10000);
      b.call(uri, JSON.stringify(params || {}));
    } catch (e) {
      release();
      if (callbackStarted) throw e;
      if (cb) cb({ returnValue: false, errorText: String(e) });   // not on a TV (desktop preview)
    }
    return release;
  }

  function launch(id, title, params) {
    luna('luna://com.webos.applicationManager/launch', { id: id, params: params || {} }, function (res) {
      if (res.returnValue === false) toast(typeof PalmServiceBridge === 'undefined' ?
        'Preview · ' + (title || id) + ' opens on the TV' : L.cantOpen + (title || id));
    });
  }

  var toastTimer;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.classList.add('shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('shown'); }, 2200);
  }

  // ---- apps ----------------------------------------------------------------------------------

  function defaultApps() {
    var all = (window.TV_APPS && TV_APPS.apps) || [];
    var byId = {};
    all.forEach(function (a) { byId[a.id] = a; });
    var hidden = {};
    (CONFIG.hiddenApps || []).forEach(function (id) { hidden[id] = true; });
    var byTitle = function (a, b) { return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1; };

    // An order arranged on the TV wins, until dockApps in config.js changes.
    var saved = loadOrder();
    if (saved) {
      var placed = [];
      saved.forEach(function (id) {
        if (byId[id] && !hidden[id]) { placed.push(byId[id]); hidden[id] = true; }
      });
      return placed.concat(all.filter(function (a) { return !hidden[a.id]; }).sort(byTitle));
    }

    var dock = [];
    (CONFIG.dockApps || []).forEach(function (id) {
      if (byId[id] && !hidden[id] && dock.length < COLUMNS) { dock.push(byId[id]); hidden[id] = true; }
    });
    var rest = all.filter(function (a) { return !hidden[a.id]; });
    rest.sort(byTitle);
    return dock.concat(rest);
  }

  var ORDER_KEY = 'tvhome.order';
  var appPreferences = window.AppPreferences.create(window.localStorage, window.LAUNCHER_PREFERENCES_KEY);

  function loadOrder() {
    try {
      var s = JSON.parse(localStorage.getItem(ORDER_KEY));
      return s && Array.isArray(s.ids) && (s.dock === (CONFIG.dockApps || []).join(',') ||
        s.dock === (CONFIG.previousDockApps || []).join(',')) ? s.ids : null;
    } catch (e) {
      return null;
    }
  }

  function orderedApps() {
    var all = defaultApps(), byId = Object.create(null);
    all.forEach(function (app) { byId[app.id] = app; });
    return appPreferences.visible(all.map(function (app) { return app.id; })).map(function (id) { return byId[id]; });
  }

  function saveOrder() { appPreferences.reorder(items.map(function (it) { return it.app.id; })); }

  function rowOf(i) { return Math.floor(i / COLUMNS); }
  function tileLeft(i) { return GRID_SIDE + (i % COLUMNS) * CELL_W + (CELL_W - TILE_W) / 2; }
  function tileTop(i) { var r = rowOf(i); return DOCK_TOP + r * ROW_PITCH + (r > 0 ? DOCK_GAP : 0); }

  function build() {
    tilesEl.innerHTML = '';
    items = orderedApps().map(function (app) {
      var el = document.createElement('div');
      el.className = 'item';
      var card = document.createElement('div');
      card.className = 'card';
      var img = document.createElement('img'), iconSource = app.icon;
      var item = { app: app, el: el, card: card, color: parseColor(app.iconColor) };
      img.alt = '';
      if (MARKS[app.id]) {
        card.classList.add('brand');
        card.classList.add('brand-' + BRANDS[app.id]);
        iconSource = 'marks/' + MARKS[app.id] + (app.id === 'netflix' || app.id === 'youtube.leanback.v4' ? '-color' : '') + '.svg';
      } else {
        card.classList.add('fallback');
        img.onload = function () { paintTile(item, img); };
      }
      img.onerror = function () {
        img.style.display = 'none';
        card.classList.add('missing');
        card.textContent = app.title.charAt(0);
      };
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', app.title);
      if (iconSource) { card.appendChild(img); img.src = iconSource; }
      else img.onerror();
      el.appendChild(card);
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = app.title;
      el.appendChild(name);
      el.launcherItem = item;
      // With the Magic Remote pointer, holding OK sends mousedown ... mouseup + click (no OK key),
      // so a long press is timed here too, and the click that ends it is ignored.
      el.addEventListener('mousedown', function () {
        if (Object.keys(activePanels).length || editing || zone === 'inputs' || zone === 'wall') return;
        cancelPress();
        focusTile(items.indexOf(item));
        var generation = pressGeneration;
        pressTimer = setTimeout(function () {
          pressTimer = null;
          if (generation !== pressGeneration || document.hidden || zone !== 'grid' ||
              editing || items[focused] !== item) return;
          showTileMenu();
          consumePointerRelease = true;
        }, LONG_PRESS_MS);
      });
      el.addEventListener('mouseup', function () { clearTimeout(pressTimer); pressTimer = null; });
      el.addEventListener('mouseleave', function () { clearTimeout(pressTimer); pressTimer = null; });
      el.addEventListener('click', function () {
        if (consumePointerRelease) { consumePointerRelease = false; return; }
        if (Object.keys(activePanels).length) return;
        if (editing) finishEdit(true);
        else launch(app.id, app.title);
      });
      el.addEventListener('contextmenu', function (event) {
        event.preventDefault();
        if (Object.keys(activePanels).length || editing) return;
        focusTile(items.indexOf(item)); showTileMenu();
      });
      tilesEl.appendChild(el);
      return item;
    });
    // apps.js could not be filled in: say so instead of showing an empty screen.
    if (!items.length) {
      var msg = document.createElement('div');
      msg.id = 'noApps';
      var heading = document.createElement('strong');
      heading.textContent = 'Your launcher, your apps';
      var description = document.createElement('span');
      description.textContent = defaultApps().length ? 'All your apps are hidden. You can bring them back at any time.' : 'No apps are available yet.';
      var manage = document.createElement('button');
      manage.textContent = 'Hidden apps';
      manage.addEventListener('click', function () { if (window.openHiddenApps) window.openHiddenApps(); });
      msg.appendChild(heading); msg.appendChild(description); msg.appendChild(manage);
      tilesEl.appendChild(msg);
    }
    layout();
  }

  /** Places every tile by its position in items; tiles glide when the order changes. */
  function layout() {
    items.forEach(function (it, i) {
      var x = tileLeft(i), y = tileTop(i);
      if (it.layoutX !== x || it.layoutY !== y) {
        it.el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
        it.layoutX = x; it.layoutY = y;
      }
      it.el.classList.toggle('dock', rowOf(i) === 0);   // the dock has no labels: the top shelf names it
    });

    var n = Math.min(COLUMNS, items.length);
    band.style.display = n ? 'block' : 'none';
    renderedOffset = null;
    band.style.left = (tileLeft(0) - 48) + 'px';
    band.style.top = (DOCK_TOP - 40) + 'px';
    band.style.width = ((n - 1) * CELL_W + TILE_W + 96) + 'px';
    band.style.height = (TILE_H + 80) + 'px';
    frost.style.left = (48 - tileLeft(0)) + 'px';
    frost.style.top = (40 - DOCK_TOP) + 'px';
    $('shelfHint').style.top = (DOCK_TOP - 84) + 'px';
    $('shelfHint').style.display = items.length > COLUMNS ? 'block' : 'none';

    cacheTiles(true);
  }

  // Chromium 79 needs an explicit hint to retain card textures during focus scaling.
  // Only cache the viewport plus one row above/below; never promote the entire inventory.
  function cacheTiles(force) {
    if (!force && cacheOffset === offset) return;
    cacheOffset = offset;
    var first = offset - ROW_PITCH, last = offset + 1080 + ROW_PITCH;
    items.forEach(function (it, i) {
      var top = tileTop(i), cached = top + TILE_H >= first && top <= last;
      if (!!it.renderCached !== cached) {
        it.renderCached = cached;
        it.el.classList.toggle('render-cached', cached);
      }
    });
  }

  /**
   * Store icons are square logos on a solid colour: fill the wide tile with that colour so the logo
   * reads as a banner. LG's system icons are glyphs on transparent: use the app's own colour.
   */
  function paintTile(item, img) {
    var px = null, edge = null;
    try {
      var c = document.createElement('canvas');
      c.width = 12; c.height = 12;
      var g = c.getContext('2d');
      g.drawImage(img, 0, 0, 12, 12);
      px = g.getImageData(0, 0, 12, 12).data;
      edge = edgeColor(img);
    } catch (e) { /* tainted canvas: fall back to the app's colour */ }

    var glyphColor = null;
    if (edge && edge[3] > 200) {
      item.card.style.background = 'rgb(' + edge[0] + ',' + edge[1] + ',' + edge[2] + ')';
    } else {
      item.card.classList.add('glyph');
      item.card.style.background = glyphBackground(item.app.iconColor);
      glyphColor = glyphBackground(item.app.iconColor) === '#2c2c2e' ? null : parseColor(item.app.iconColor);
    }
    // A white glyph says nothing about the app: glow in the tile's colour instead.
    item.color = glyphColor || (px ? vividColor(px) : parseColor(item.app.iconColor));
    if (items[focused] === item) setAmbient(item.color);
  }

  /**
   * The icon's background at full size: a corner pixel, or the middle of the left edge for rounded
   * icons whose corners are transparent. A downscaled sample would blend in the logo.
   */
  function edgeColor(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    var corner = g.getImageData(2, 2, 1, 1).data;
    return corner[3] > 200 ? corner : g.getImageData(2, Math.floor(h / 2), 1, 1).data;
  }

  function glyphBackground(hex) {
    var c = parseColor(hex);
    if (!c) return '#2c2c2e';
    var hsv = rgbToHsv(c);
    if (hsv[1] < 0.15 && (hsv[2] > 0.85 || hsv[2] < 0.1)) return '#2c2c2e';   // white or black glyph colour
    return 'rgb(' + c.join(',') + ')';
  }

  /** A vivid colour from the icon: the most saturated, not too dark pixel, or the lifted average. */
  function vividColor(px) {
    var best = null, bestScore = -1, sum = [0, 0, 0], n = 0;
    for (var i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      var p = [px[i], px[i + 1], px[i + 2]];
      sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; n++;
      var hsv = rgbToHsv(p);
      var score = hsv[1] * Math.min(1, hsv[2] * 1.4);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (!n) return [68, 68, 68];
    if (bestScore < 0.25) {   // nearly monochrome icon (e.g. white): its average, lifted
      var avg = rgbToHsv([sum[0] / n, sum[1] / n, sum[2] / n]);
      avg[2] = Math.max(avg[2], 0.55);
      return hsvToRgb(avg);
    }
    var h = rgbToHsv(best);
    h[1] = Math.min(1, h[1] * 1.1);
    h[2] = Math.max(0.5, h[2]);
    return hsvToRgb(h);
  }

  function parseColor(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var v = parseInt(m[1], 16);
    return [v >> 16 & 255, v >> 8 & 255, v & 255];
  }

  function rgbToHsv(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, max ? d / max : 0, max];
  }

  function hsvToRgb(hsv) {
    var h = hsv[0], s = hsv[1], v = hsv[2];
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return rgb.map(function (k) { return Math.round((k + m) * 255); });
  }

  // ---- focus & ambient -------------------------------------------------------------------------

  function focusTile(i) {
    if (!items.length) {
      zone = 'grid'; focused = 0; offset = 0; renderedOffset = 0;
      stage.style.transform = 'translateY(0px)';
      frost.style.transform = 'translateY(0px)';
      document.body.classList.remove('scrolled'); document.body.classList.remove('browsing');
      return;
    }
    i = Math.max(0, Math.min(i, items.length - 1));
    if (zone === 'grid' && focused === i && renderedOffset !== null &&
        items[i].el.classList.contains('focused')) return;
    if (zone !== 'grid' || focused !== i) cancelPress();
    setZone('grid');
    if (focused !== i && items[focused]) items[focused].el.classList.remove('focused');
    focused = i;
    items[i].el.classList.add('focused');

    var top = tileTop(i), row = rowOf(i);
    if (row === 0) {
      offset = 0;
    } else {
      // Expand the app grid as one surface, like the reference's full-screen app view.
      // Keep the favourites shelf in view until more rows need to scroll.
      offset = Math.max(offset, DOCK_TOP - 160);
      if (top - offset + TILE_H + 70 > VIEW_BOTTOM) offset = top + TILE_H + 70 - VIEW_BOTTOM;
      if (top - offset - 24 < VIEW_TOP) offset = top - 24 - VIEW_TOP;
    }
    if (renderedOffset !== offset) {
      cacheTiles(false);
      stage.style.transform = 'translateY(' + (-offset) + 'px)';
      // Equal and opposite transforms keep the prepared texture aligned throughout
      // the slide, including interrupted transitions; no per-frame repaint or JS.
      frost.style.transform = 'translateY(' + offset + 'px)';
      renderedOffset = offset;
    }
    document.body.classList.toggle('scrolled', row > 0);
    document.body.classList.toggle('browsing', row > 0);
    setAmbient(items[i].color);
  }

  /** Crossfades the glow to a new colour by swapping between two layers. */
  function setAmbient(color) {
    if (CONFIG.ambientGlow === false || !color) return;
    var key = color.join(',');
    if (key === ambientColor) return;
    ambientColor = key;
    var back = ambients[1 - ambientFront];
    back.style.background = 'radial-gradient(circle 1190px at 32% 42%, rgba(' + key + ',0.36) 0%, rgba(' +
      key + ',0.15) 50%, rgba(' + key + ',0) 100%)';
    back.style.opacity = '1';
    ambients[ambientFront].style.opacity = '0';
    ambientFront = 1 - ambientFront;
  }

  function focusPill(i) {
    if(window.openControlCentre){focusTile(focused);window.openControlCentre();return;}
    setZone('top');
    document.body.classList.remove('scrolled');
    pills[pillFocus].classList.remove('focused');
    pillFocus = Math.max(0, Math.min(i, pills.length - 1));
    pills[pillFocus].classList.add('focused');
  }

  function setZone(z) {
    if (zone === z) return;
    if (z !== 'grid') cancelPress();
    if (zone === 'top') pills[pillFocus].classList.remove('focused');
    if (zone === 'grid') {
      if (items[focused]) items[focused].el.classList.remove('focused');
    }
    zone = z;
    document.body.classList.toggle('controls-open', z === 'top' || z === 'inputs' || z === 'wall');
  }

  /** The pill straight above a dock tile, by horizontal distance. */
  function pillAbove(i) {
    var cx = tileLeft(i) + TILE_W / 2, best = 0, bestD = Infinity;
    pills.forEach(function (p, k) {
      var r = logicalRect(p);
      var d = Math.abs(r.left + r.width / 2 - cx);
      if (d < bestD) { bestD = d; best = k; }
    });
    return best;
  }

  // ---- top bar -------------------------------------------------------------------------------

  var clockTimer = null;
  function clockText(id, text) {
    var el = $(id);
    if (el.textContent !== text) el.textContent = text;
  }
  function updateClock() {
    var now = new Date(), h = now.getHours();
    var m = now.getMinutes();
    if (CONFIG.clock24) {
      clockText('clock', (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m);
      clockText('ampm', '');
    } else {
      clockText('clock', ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m);
      clockText('ampm', h < 12 ? L.ampm[0] : L.ampm[1]);
    }
  }
  function scheduleClock() {
    clearTimeout(clockTimer);
    clockTimer = null;
    if (document.hidden) return;
    clockTimer = setTimeout(function () { updateClock(); scheduleClock(); }, 60000 - Date.now() % 60000 + 20);
  }

  /** Shows the Wi-Fi network name when the TV reports it, otherwise the connection type. */
  function watchNetwork() {
    luna('luna://com.palm.connectionmanager/getStatus', { subscribe: true }, function (res) {
      if (res.returnValue === false && !res.wifi && !res.wired) return;
      var text = 'Wi-Fi';
      if (res.wired && res.wired.state === 'connected') text = L.wired;
      else if (res.wifi && res.wifi.state === 'connected') text = res.wifi.ssid || 'Wi-Fi';
      else if (res.isInternetConnectionAvailable === false) text = L.offline;
      $('wifiLabel').textContent = text;
    });
  }

  window.LauncherControls = { luna:luna, launch:launch, wallpaper:showWall, closeWallpaper:hideWall, toast:toast,
    hiddenApps:hiddenApps, restoreApp:restoreApp,
    cancelPress:cancelPress, noteInteraction:noteInteraction, setPanelActive:setPanelActive,
    isIdle:idleForRefresh, refreshClock:function(){updateClock();scheduleClock();},
    canOpen:function(){return zone==='grid' && !editing;}
  };
  function activatePill(i) {
    if (i === 0) showInputs();
    else if (i === 1) launch('com.palm.app.settings', 'Settings', { target: 'network' });
    else if (i === 2) showWall();
    else launch('com.palm.app.settings', 'Settings');
  }

  // ---- wallpaper QR panel --------------------------------------------------------------------

  // tv/wallpaper-server.js (rooted TVs) serves a phone page for picking the wallpaper and writes
  // its address into wall.js. Web apps on webOS 6 cannot call HTTP on the TV itself, so the file is
  // (re)loaded here. Phone changes publish a settings token that refreshes the current page in place.
  function loadWallUrl(cb) {
    var old = $('wallJs');
    if (old) old.parentNode.removeChild(old);
    window.WALL_URL = '';
    var sc = document.createElement('script');
    sc.id = 'wallJs';
    sc.src = 'wall.js';
    var done = false;
    function finish(url) {
      if (done) return;
      done = true; clearTimeout(timeout);
      sc.onload = null; sc.onerror = null;
      cb(url);
    }
    var timeout = setTimeout(function () { finish(''); }, 5000);
    sc.onload = function () { finish(window.WALL_URL || ''); };
    sc.onerror = function () { finish(''); };
    document.body.appendChild(sc);
  }

  var qrLoading = false, qrWaiters = [], wallGeneration = 0, wallOpening = false, wallReturn = null;
  function ensureQr(cb) {
    if (typeof window.qrcode === 'function') { cb(null); return; }
    qrWaiters.push(cb);
    if (qrLoading) return;
    qrLoading = true;
    var sc = document.createElement('script'), finished = false;
    sc.src = 'qrcode.js';
    function finish(error) {
      if (finished) return;
      finished = true; clearTimeout(timeout); qrLoading = false;
      sc.onload = null; sc.onerror = null;
      if (sc.parentNode) sc.parentNode.removeChild(sc);
      var waiting = qrWaiters; qrWaiters = [];
      waiting.forEach(function (done) { done(error); });
    }
    var timeout = setTimeout(function () { finish('Wallpaper controls could not load. Try again.'); }, 6000);
    sc.onload = function () { finish(typeof window.qrcode === 'function' ? null : 'Wallpaper controls could not load. Try again.'); };
    sc.onerror = function () { finish('Wallpaper controls could not load. Try again.'); };
    document.body.appendChild(sc);
  }

  function showWall(onClose) {
    if (wallOpening || zone === 'wall') return;
    wallReturn = typeof onClose === 'function' ? onClose : null;
    var generation = ++wallGeneration;
    wallOpening = true;
    setPanelActive('wallpaper', true);
    zone = 'wall';
    $('wallQr').innerHTML = '';
    $('wallTitle').textContent = L.wallTitle;
    $('wallScan').textContent = CONFIG.language === 'vi' ? 'Đang tải…' : 'Loading wallpaper controls…';
    document.body.classList.add('wallOpen');
    wallPanel.classList.remove('hidden');
    loadWallUrl(function (url) {
      if (generation !== wallGeneration || document.hidden) return;
      if (!url && typeof PalmServiceBridge === 'undefined') url='https://example.com/wallpaper-preview';
      if (!url) { hideWall(); toast(L.wallOff); return; }
      ensureQr(function (error) {
        if (generation !== wallGeneration || document.hidden) return;
        if (error) { hideWall(); toast(error); return; }
        try {
          var qr = window.qrcode(0, 'M');
          qr.addData(url); qr.make();
          $('wallQr').innerHTML = '<img src="' + qr.createDataURL(8, 0) + '">';
        } catch (e) { hideWall(); toast('Wallpaper code could not be created. Try again.'); return; }
        $('wallTitle').textContent = L.wallTitle;
        $('wallScan').textContent = typeof PalmServiceBridge === 'undefined' ? 'Preview · scan the code on your TV to choose a photo.' : L.wallScan;
        $('wallUrl').textContent = url.split('?')[0];
        wallOpening = false;
        document.body.classList.add('wallOpen');
        wallPanel.classList.remove('hidden');
        pills[pillFocus].classList.remove('focused');
      });
    });
  }

  function hideWall(returnToParent) {
    var onClose = wallReturn; wallReturn = null;
    wallGeneration++; wallOpening = false;
    setPanelActive('wallpaper', false);
    document.body.classList.remove('wallOpen');
    wallPanel.classList.add('hidden');
    zone = 'none';
    if (!document.hidden) focusTile(focused);
    if (returnToParent !== false && !document.hidden && onClose) onClose();
  }

  // ---- inputs dropdown -----------------------------------------------------------------------

  function showInputs() {
    panel.innerHTML = '';
    inputRows = [];
    var inputs = (window.TV_APPS && TV_APPS.inputs) || [];
    inputs.forEach(function (inp) { addInputRow(ICON_INPUT, inp.label, inp.appId); });
    if (CONFIG.liveTvApp) {
      if (inputRows.length) panel.appendChild(Object.assign(document.createElement('div'), { className: 'separator' }));
      addInputRow(ICON_LIVETV, L.liveTv, CONFIG.liveTvApp);
    }
    if (!inputRows.length) { toast(L.noInputs); return; }

    // Hang right below the Inputs pill, at least as wide as it.
    var r = logicalRect(pills[0]);
    panel.style.left = Math.round(r.left) + 'px';
    panel.style.right = 'auto';
    panel.style.top = (r.bottom + 20) + 'px';
    panel.style.minWidth = Math.max(r.width, 300) + 'px';
    panel.classList.remove('hidden');
    pills[pillFocus].classList.remove('focused');
    zone = 'inputs';
    focusInput(0);
  }

  function addInputRow(icon, label, appId) {
    var row = document.createElement('div');
    row.className = 'inputRow';
    row.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + icon + '"/></svg>';
    row.appendChild(document.createTextNode(label));
    var idx = inputRows.length;
    row.addEventListener('mouseover', function () { focusInput(idx); });
    row.addEventListener('click', function () { hideInputs(); launch(appId, label); });
    row.appId = appId;
    row.label = label;
    inputRows.push(row);
    panel.appendChild(row);
  }

  function focusInput(i) {
    if (inputRows[inputFocus]) inputRows[inputFocus].classList.remove('focused');
    inputFocus = Math.max(0, Math.min(i, inputRows.length - 1));
    inputRows[inputFocus].classList.add('focused');
  }

  function hideInputs() {
    panel.classList.add('hidden');
    zone = 'none';
    focusPill(0);
  }

  // ---- rearranging ---------------------------------------------------------------------------

  var movePointerX = null, movePointerY = null;
  var moveInput = 'pointer', moveCursorVisible = null;
  var moveAnchorX = null, moveAnchorY = null;

  function useMoveKeys(e) {
    if ([KEY.LEFT, KEY.UP, KEY.RIGHT, KEY.DOWN].indexOf(e.keyCode) < 0) return;
    moveInput = 'keys';
    moveAnchorX = movePointerX; moveAnchorY = movePointerY;
  }
  // Take ownership before a D-pad event can hide/reposition the Magic Remote cursor.
  // This also covers using the arrows to reach the Move action before picking up a tile.
  document.addEventListener('keydown', useMoveKeys, true);
  document.addEventListener('cursorStateChange', function (e) {
    if (!e.detail || typeof e.detail.visibility !== 'boolean') return;
    moveCursorVisible = e.detail.visibility;
    moveInput = moveCursorVisible ? 'pointer' : 'keys';
    moveAnchorX = movePointerX; moveAnchorY = movePointerY;
  });

  // Sliding cards can cross a stationary pointer and emit mouseover events.
  // Only actual pointer motion changes focus or chooses a move destination.
  function moveWithPointer(e) {
    if (e.clientX === movePointerX && e.clientY === movePointerY) return;
    movePointerX = e.clientX; movePointerY = e.clientY;
    if (document.hidden || Object.keys(activePanels).length ||
        (zone !== 'grid' && zone !== 'top')) return;
    // On TV only webOS returning to visible pointer mode releases D-pad ownership.
    // Stray motion, including a cursor recenter, must not undo an arrow-key move.
    if (moveCursorVisible === false || (moveInput === 'keys' && window.PalmSystem)) return;
    var scale = window.LAUNCHER_SCALE || 1;
    if (moveInput === 'keys') {
      // Desktop preview has no cursorStateChange: require deliberate mouse motion.
      if (moveAnchorX === null || moveAnchorY === null) {
        moveAnchorX = e.clientX; moveAnchorY = e.clientY;
        return;
      }
      var dx = (e.clientX - moveAnchorX) / scale, dy = (e.clientY - moveAnchorY) / scale;
      if (dx * dx + dy * dy < 16 * 16) return;
      moveInput = 'pointer';
    }
    if (!editing) {
      var target = e.target;
      while (target && target !== tilesEl) {
        if (target.launcherItem) {
          var index = items.indexOf(target.launcherItem);
          if (index >= 0) focusTile(index);
          return;
        }
        target = target.parentNode;
      }
      return;
    }
    if (zone !== 'grid') return;
    var rect = logicalRect(stage);
    var x = e.clientX / scale - rect.left, y = e.clientY / scale - rect.top;
    var col = Math.floor((x - GRID_SIDE) / CELL_W);
    var row = Math.floor((y - DOCK_TOP) / ROW_PITCH);
    if (row > 0) row = Math.floor((y - DOCK_TOP - DOCK_GAP) / ROW_PITCH);
    if (col < 0 || col >= COLUMNS || row < 0) return;
    var to = row * COLUMNS + col;
    if (to >= items.length || x < tileLeft(to) || x > tileLeft(to) + TILE_W ||
        y < tileTop(to) || y > tileTop(to) + TILE_H) return;
    moveTo(to);
  }
  document.addEventListener('mousemove', moveWithPointer);

  /** Hold OK on a tile: it wiggles, the arrows move it, OK places it, Back puts everything back. */
  function startEdit() {
    var it = items[focused];
    if (!it) return;
    editing = { item: it, snapshot: items.slice() };
    it.el.classList.add('moving');
    document.body.classList.add('editing');
    toast(L.moveHint);
  }

  function moveTo(to) {
    if (to < 0 || to >= items.length || to === focused) return;
    items.splice(to, 0, items.splice(focused, 1)[0]);
    focused = to;
    layout();
    focusTile(to);
  }

  function finishEdit(keep) {
    var it = editing.item;
    if (!keep) {
      items = editing.snapshot;
      layout();
    }
    editing = null;
    it.el.classList.remove('moving');
    document.body.classList.remove('editing');
    if (keep) saveOrder();
    focused = items.indexOf(it);
    focusTile(focused);
  }

  // ---- tile actions -------------------------------------------------------------

  function hiddenApps() {
    var all = defaultApps(), byId = Object.create(null);
    all.forEach(function (app) { byId[app.id] = app; });
    return appPreferences.hidden(all.map(function (app) { return app.id; })).map(function (id) {
      var app = byId[id];
      return { id: id, title: app.title, icon: app.icon, brand: BRANDS[id] || '',
        mark: MARKS[id] ? 'marks/' + MARKS[id] + (id === 'netflix' || id === 'youtube.leanback.v4' ? '-color' : '') + '.svg' : '' };
    });
  }
  function rebuildApps(preferredId, fallback) {
    cancelPress(); build();
    var next = -1;
    items.forEach(function (it, i) { if (it.app.id === preferredId) next = i; });
    zone = 'none';
    focusTile(next >= 0 ? next : Math.max(0, Math.min(fallback || 0, items.length - 1)));
  }
  function restoreApp(id) {
    var app = hiddenApps().filter(function (entry) { return entry.id === id; })[0];
    if (!app || !appPreferences.restore(id)) return false;
    var selected = items[focused] && items[focused].app.id;
    rebuildApps(selected || id, focused);
    return true;
  }
  function createTileMenu() {
    tileMenuShade = document.createElement('div'); tileMenuShade.id = 'tileActionShade';
    tileMenuShade.addEventListener('click', function () {
      if (consumePointerRelease) { consumePointerRelease = false; return; }
      hideTileMenu();
    });
    tileMenu = document.createElement('section'); tileMenu.id = 'tileActionMenu';
    tileMenu.setAttribute('role', 'dialog'); tileMenu.setAttribute('aria-modal', 'true');
    tileMenu.setAttribute('aria-label', 'App actions'); tileMenu.setAttribute('aria-hidden', 'true');
    var group = document.createElement('div'); group.setAttribute('role', 'menu'); group.setAttribute('aria-label', 'App actions');
    var icons = [
      '<path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
      '<path d="m3 3 18 18M10.5 5.2A10.2 10.2 0 0 1 21 12a14 14 0 0 1-3.1 4.3M6.2 6.2A15 15 0 0 0 3 12c2 4.5 5 7 9 7a10 10 0 0 0 4.2-.9M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'
    ];
    tileMenuButtons = ['Move', 'Hide'].map(function (label, index) {
      var button = document.createElement('button'); button.className = 'ccAction tileAction';
      button.setAttribute('role', 'menuitem'); button.tabIndex = -1;
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[index] + '</svg>';
      button.appendChild(document.createTextNode(label));
      button.addEventListener('mouseenter', function () { focusTileAction(index); });
      button.addEventListener('click', function () { focusTileAction(index); activateTileAction(); });
      group.appendChild(button); return button;
    });
    tileMenu.appendChild(group);
    $('screen').appendChild(tileMenuShade); $('screen').appendChild(tileMenu);
  }
  function focusTileAction(index) {
    tileMenuIndex = index;
    tileMenuButtons.forEach(function (button, i) { button.classList.toggle('selected', i === index); });
    noteInteraction();
  }
  function showTileMenu() {
    var item = items[focused];
    if (!item || editing || Object.keys(activePanels).length) return;
    if (!tileMenu) createTileMenu();
    tileMenuTarget = item;
    setPanelActive('tileActions', true);
    zone = 'tileMenu';
    tileMenu.setAttribute('aria-hidden', 'false');
    var rect = logicalRect(item.card), height = 170, width = 344;
    var top = rect.top - height - 24;
    if (top < 40) top = rect.bottom + 24;
    tileMenu.style.left = Math.max(40, Math.min(1920 - width - 40, rect.left + rect.width / 2 - width / 2)) + 'px';
    tileMenu.style.top = Math.max(40, Math.min(1080 - height - 40, top)) + 'px';
    document.body.classList.add('tileMenuOpen');
    item.el.setAttribute('aria-expanded', 'true');
    focusTileAction(0);
  }
  function hideTileMenu() {
    if (!tileMenuTarget) return;
    var target = tileMenuTarget; tileMenuTarget = null;
    target.el.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('tileMenuOpen');
    tileMenu.setAttribute('aria-hidden', 'true');
    setPanelActive('tileActions', false);
    zone = 'none'; focusTile(items.indexOf(target));
  }
  function activateTileAction() {
    if (!tileMenuTarget) return;
    var target = tileMenuTarget, index = items.indexOf(target), action = tileMenuIndex;
    hideTileMenu();
    if (action === 0) startEdit();
    else if (appPreferences.hide(target.app.id)) {
      rebuildApps(null, index);
      toast(target.app.title + ' hidden');
    }
  }
  document.addEventListener('mousedown', function () { consumePointerRelease = false; }, true);

  // ---- keys ----------------------------------------------------------------------------------

  var LONG_PRESS_MS = 600;
  var okDown = false, okTimer = null;

  // On tiles OK acts on release, so a held OK can start rearranging instead of opening the app.
  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== KEY.OK) return;
    var pending = okTimer, it = okItem;
    cancelPress();
    if (pending && !document.hidden && zone === 'grid' && it && items[focused] === it && !editing)
      launch(it.app.id, it.app.title);
  });

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (k !== KEY.OK && [KEY.LEFT, KEY.UP, KEY.RIGHT, KEY.DOWN, KEY.BACK, KEY.ESC].indexOf(k) >= 0) cancelPress();
    if (k === KEY.OK && (okDown || e.repeat)) { e.preventDefault(); return; }   // key repeat while held
    if (k === KEY.OK) okDown = true;
    if (zone === 'tileMenu') {
      if (k === KEY.UP) focusTileAction(0);
      else if (k === KEY.DOWN) focusTileAction(1);
      else if (k === KEY.OK) activateTileAction();
      else if (k === KEY.BACK || k === KEY.ESC || k === 8) hideTileMenu();
      else return;
    } else if (!items.length && zone === 'grid') {
      if (k === KEY.OK && window.openHiddenApps) window.openHiddenApps();
      else if (k === KEY.UP && window.openControlCentre) window.openControlCentre();
      else return;
    } else if (editing) {
      if (k === KEY.LEFT) moveTo(focused - 1);
      else if (k === KEY.RIGHT) moveTo(focused + 1);
      else if (k === KEY.UP) moveTo(focused - COLUMNS);
      else if (k === KEY.DOWN) moveTo(Math.min(focused + COLUMNS, items.length - 1));
      else if (k === KEY.OK) finishEdit(true);
      else if (k === KEY.BACK || k === KEY.ESC) finishEdit(false);
      else return;
    } else if (zone === 'inputs') {
      if (k === KEY.UP) focusInput(inputFocus - 1);
      else if (k === KEY.DOWN) focusInput(inputFocus + 1);
      else if (k === KEY.OK) { var row = inputRows[inputFocus]; hideInputs(); launch(row.appId, row.label); }
      else if (k === KEY.BACK || k === KEY.ESC || k === KEY.LEFT || k === KEY.RIGHT) hideInputs();
      else return;
    } else if (zone === 'wall') {
      if (k === KEY.BACK || k === KEY.ESC || k === 8 || k === KEY.OK || k === KEY.LEFT || k === KEY.RIGHT ||
          k === KEY.UP || k === KEY.DOWN) hideWall();
      else return;
    } else if (zone === 'top') {
      if (k === KEY.LEFT) focusPill(pillFocus - 1);
      else if (k === KEY.RIGHT) focusPill(pillFocus + 1);
      else if (k === KEY.DOWN) focusTile(rowOf(focused) === 0 ? focused : 0);
      else if (k === KEY.OK) activatePill(pillFocus);
      else if (k === KEY.BACK) { /* home screen: Back goes nowhere */ }
      else return;
    } else {
      var col = focused % COLUMNS, last = items.length - 1;
      if (k === KEY.LEFT) { if (col > 0) focusTile(focused - 1); }
      else if (k === KEY.RIGHT) {
        if (col < COLUMNS - 1 && focused < last) focusTile(focused + 1);
      }
      else if (k === KEY.UP) {
        if (rowOf(focused) === 0) focusPill(pillAbove(focused));
        else focusTile(focused - COLUMNS);
      } else if (k === KEY.DOWN) {
        if (rowOf(focused) < rowOf(last)) focusTile(Math.min(focused + COLUMNS, last));
      } else if (k === KEY.OK) {
        okItem = items[focused];
        var generation = pressGeneration, origin = okItem;
        okTimer = setTimeout(function () {
          okTimer = null;
          if (generation !== pressGeneration || document.hidden || zone !== 'grid' ||
              !origin || items[focused] !== origin || editing) return;
          showTileMenu();
        }, LONG_PRESS_MS);
      } else if (k === KEY.BACK) { /* home screen: Back goes nowhere */ }
      else return;
    }
    e.preventDefault();
  });

  pills.forEach(function (p, i) {
    p.addEventListener('mouseover', function () { if (zone !== 'inputs' && zone !== 'wall') focusPill(i); });
    p.addEventListener('click', function () { activatePill(i); });
  });

  // ---- lifecycle -----------------------------------------------------------------------------

  var lastResume = 0, lastInteraction = 0, refreshTimer = null, refreshBusy = false;
  var lastRefresh = Date.now(), inventoryPending = false;
  function noteInteraction() { lastInteraction = Date.now(); }
  ['keydown', 'mousedown', 'mousemove', 'touchstart'].forEach(function (event) {
    document.addEventListener(event, noteInteraction, true);
  });
  function idleForRefresh() {
    return !document.hidden && !editing && zone === 'grid' &&
      !Object.keys(activePanels).length && !document.body.classList.contains('ccOpen') &&
      !document.body.classList.contains('wallOpen') &&
      Date.now() - lastInteraction >= 1500;
  }
  function scheduleRefresh(delay) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      if (document.hidden) return; // visibilitychange schedules the next check on return
      if (!idleForRefresh() || refreshBusy) { scheduleRefresh(1500); return; }
      if (inventoryPending) {
        inventoryPending = false;
        applyInventory();
        scheduleRefresh(20000);
      } else refreshApps();
    }, delay);
  }

  /** Restore focus immediately; coalesce webOS relaunch and visibility events. */
  function resume() {
    if (zone === 'tileMenu') hideTileMenu();
    cancelPress();
    var now = Date.now();
    if (now - lastResume < 500) return;
    lastResume = now;
    if (editing) finishEdit(false);
    updateClock();
    scheduleClock();
    if (zone === 'inputs') panel.classList.add('hidden');
    if (zone === 'wall' || wallOpening) hideWall(false);
    pills.forEach(function (p) { p.classList.remove('focused'); });
    zone = 'none';
    focusTile(focused);
    scheduleRefresh(inventoryPending ? 1500 : Math.max(1500, 20000 - (now - lastRefresh)));
  }

  /**
   * Re-reads apps.js, which sync.js rewrites whenever an app is installed or removed. A page on
   * webOS 6 cannot fetch a local file with XHR, so the script is simply added again.
   */
  function appsFingerprint() {
    var all = (window.TV_APPS && TV_APPS.apps) || [];
    return JSON.stringify(all.map(function (a) {
      return [a.id, a.title, a.icon, a.iconColor];
    }).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; }));
  }
  var appsSeen = appsFingerprint();

  function applyInventory() {
    var now = appsFingerprint();
    if (now === appsSeen) return;
    var selected = items[focused] && items[focused].app.id;
    appsSeen = now;
    build();
    var found = -1;
    items.forEach(function (it, i) { if (it.app.id === selected) found = i; });
    focused = found >= 0 ? found : Math.max(0, Math.min(focused, items.length - 1));
    focusTile(focused);
  }

  function refreshApps() {
    if (refreshBusy) return;
    refreshBusy = true;
    var old = $('appsJs');
    if (old) old.parentNode.removeChild(old);
    var sc = document.createElement('script'), completed = false;
    sc.id = 'appsJs';
    sc.src = 'apps.js?t=' + Date.now();
    function finish() {
      if (completed) return;
      completed = true;
      clearTimeout(loadTimeout);
      refreshBusy = false;
      lastRefresh = Date.now();
      inventoryPending = appsFingerprint() !== appsSeen;
      scheduleRefresh(inventoryPending ? 1500 : 20000);
    }
    var loadTimeout = setTimeout(finish, 5000);
    sc.onload = finish;
    sc.onerror = finish;
    document.body.appendChild(sc);
  }

  function launchParameters(event) {
    var detail = event && event.detail;
    try {
      if (typeof detail === 'string') detail = JSON.parse(detail);
      if (detail && typeof detail === 'object' && Object.keys(detail).length) return detail;
      return window.PalmSystem ? JSON.parse(PalmSystem.launchParams || '{}') : {};
    } catch (error) { return {}; }
  }
  // Remember parameters already applied to this page. A retained reload flag must
  // not cause another reload merely because webOS announces the app again.
  var initialLaunch = launchParameters(null);
  var lastReloadToken = initialLaunch.reload ? (initialLaunch.reloadToken || 'legacy') : null;
  document.addEventListener('webOSRelaunch', function (e) {
    var p = launchParameters(e);
    if (p.settingsChanged) {
      if (window.LauncherSettings) window.LauncherSettings.refresh(p.settingsToken);
      return;
    }
    if (p.home || p.reload === false) {
      lastReloadToken = null;
      resume();
      return;
    }
    var token = p.reloadToken || 'legacy';
    if (p.reload && token !== lastReloadToken) {
      lastReloadToken = token;
      location.reload();
      return;
    }
    resume();
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) resume();
    else {
      if (zone === 'tileMenu') hideTileMenu();
      consumePointerRelease = false;
      lastResume = 0; cancelPress(); clearTimeout(clockTimer); clockTimer = null;
      if (zone === 'wall' || wallOpening) hideWall(false);
    }
  });
  window.addEventListener('blur', function () {
    cancelPress(); consumePointerRelease = false;
    if (zone === 'tileMenu') hideTileMenu();
  });

  if (window.LauncherPerf) window.LauncherPerf.mark('build-start');
  build();
  if (window.LauncherPerf) window.LauncherPerf.mark('build-end');
  updateClock();
  scheduleClock();
  // Some firmware never fires webOSRelaunch or visibilitychange for this app, so returning to the
  // launcher is not a reliable moment to look for new apps. Checking apps.js on a timer is.
  scheduleRefresh(20000);
  document.documentElement.lang = CONFIG.language === 'vi' ? 'vi' : 'en';
  pills[0].querySelector('span').textContent = L.inputs;
  pills[3].querySelector('span').textContent = L.settings;
  pills.forEach(function (p) {
    p.setAttribute('role', 'button');
    var label = p.querySelector('span');
    if (label) p.setAttribute('aria-label', label.textContent);
  });
  pills[2].setAttribute('aria-label', L.wallTitle);
  watchNetwork();
  zone = 'none';
  focusTile(0);
})();
