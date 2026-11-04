// Real drawer focus/layout/input handlers, without a browser or TV.
// Default: production app; pass --preview for the isolated preview controller.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const preview = process.argv.includes('--preview');
const source = fs.readFileSync('app/app.js', 'utf8');
function take(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, 'Missing source boundary: ' + start);
  return source.slice(from, to);
}
function classes(initial = []) {
  const names = new Set(initial);
  return { add: name => names.add(name), remove: name => names.delete(name),
    contains: name => names.has(name), toggle(name, on) { on ? names.add(name) : names.delete(name); } };
}
function setup({ native = false, scale = 1 } = {}) {
  const handlers = {}, positions = [], body = { classList: classes() };
  const stage = { parentNode: body, style: new Proxy({}, {
    set(target, name, value) { if (name === 'transform') positions.push(value); target[name] = value; return true; }
  }) };
  const tilesEl = { parentNode: stage };
  const items = Array.from({ length: 12 }, (_, index) => {
    const listeners = {};
    const el = { classList: classes(['item']), style: {}, parentNode: tilesEl,
      appendChild(child) { child.parentNode = this; },
      addEventListener(name, fn) { (listeners[name] || (listeners[name] = [])).push(fn); } };
    const card = { parentNode: el }, logo = { parentNode: card };
    const item = { app: { id: String(index) }, el, card, logo, listeners };
    el.launcherItem = item;
    return item;
  });
  const scope = { items, tilesEl, stage, COLUMNS: 6, GRID_SIDE: 65, CELL_W: 1790 / 6,
    TILE_W: 250, TILE_H: 150, DOCK_TOP: 826, ROW_PITCH: 230, DOCK_GAP: 0,
    VIEW_TOP: 80, VIEW_BOTTOM: 1060, offset: 0, renderedOffset: null, cacheOffset: null,
    zone: 'grid', focused: 0, editing: null, activePanels: {},
    band: { style: { backgroundImage: 'url(frost.jpg)' } }, frost: { style: {} },
    document: { body, hidden: false, addEventListener(name, fn, capture) {
      (handlers[name] || (handlers[name] = [])).push({ fn, capture: !!capture });
    } }, window: { LAUNCHER_SCALE: scale },
    KEY: { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27 },
    $() { return { style: {} }; }, cancelPress() {}, setAmbient() {}, noteInteraction() {},
    setZone(zone) { scope.zone = zone; }, focusPill() {}, pillAbove() { return 0; },
    L: { moveHint: '' }, toast() {}, saveOrder() {}
  };
  if (native) scope.window.PalmSystem = {};
  stage.getBoundingClientRect = () => ({ left: 0, right: 1920 * scale, top: -scope.offset * scale,
    bottom: (1080 - scope.offset) * scale, width: 1920 * scale, height: 1080 * scale });
  vm.createContext(scope);
  vm.runInContext(take('  function logicalRect(el)', '  var KEY ='), scope);
  vm.runInContext(take('  function rowOf(i)', '  function build()'), scope);
  vm.runInContext(take('  function layout()', '  /**\n   * Store icons'), scope);
  vm.runInContext(take('  function focusTile(i)', '  /** Crossfades the glow'), scope);
  vm.runInContext(take('  // ---- rearranging ', '  // ---- tile actions'), scope);
  const gridKeys = take('      var col = focused % COLUMNS, last = items.length - 1;', '      } else if (k === KEY.OK) {');
  vm.runInContext('function gridKey(k, e) {\n' + gridKeys + '\n}\n}', scope);
  scope.document.addEventListener('keydown', event => {
    if (scope.zone === 'grid') scope.gridKey(event.keyCode, event);
  });
  // Execute the real place where tile hover handlers used to be registered.
  // The old code reproduces an upward reversal here after a collapse.
  items.forEach(item => {
    scope.item = item; scope.el = item.el; scope.name = {};
    vm.runInContext('(function(item, el, name) {\n' +
      take('      el.appendChild(name);', '      // With the Magic Remote pointer') +
      '\n})(item, el, name);', scope);
  });
  function dispatch(name, event) {
    const list = handlers[name] || [];
    list.filter(handler => handler.capture).forEach(handler => handler.fn(event));
    list.filter(handler => !handler.capture).forEach(handler => handler.fn(event));
  }
  scope.layout(); scope.focusTile(0); positions.length = 0;
  return { scope, items, positions,
    key(code) { dispatch('keydown', { keyCode: code, preventDefault() {} }); },
    cursor(visibility) { dispatch('cursorStateChange', { detail: { visibility } }); },
    pointer(index, x = 100, y = 100, target) {
      dispatch('mousemove', { clientX: x * scale, clientY: y * scale,
        target: target === undefined ? items[index].logo : target });
    },
    hover(index) { (items[index].listeners.mouseover || []).forEach(fn => fn({ target: items[index].logo })); }
  };
}

// Collapse via the actual grid Up-key branch. Animated hit testing and unchanged
// pointer coordinates must not focus the passing lower row and reopen the grid.
let t = setup({ native: true });
t.scope.focusTile(6); t.pointer(6); assert.equal(t.scope.focused, 6);
assert.equal(t.scope.stage.style.transform, 'translateY(-666px)');
t.key(38); assert.equal(t.scope.focused, 0);
assert.equal(t.scope.stage.style.transform, 'translateY(0px)');
const afterCollapse = t.positions.length;
t.hover(6); t.hover(7); t.pointer(6);
assert.equal(t.scope.focused, 0); assert.equal(t.positions.length, afterCollapse);
assert(t.items.every(item => !item.listeners.mouseover), 'Tiles must not focus from animation-generated hover');

// Even changing/warped native coordinates cannot override D-pad ownership.
t.cursor(false); t.pointer(6, 103, 110); t.pointer(9, 1800, 900);
assert.equal(t.scope.focused, 0); assert.equal(t.positions.length, afterCollapse);
t.cursor(true); t.pointer(6, 1801, 900);
assert.equal(t.scope.focused, 6, 'Visible pointer with actual movement focuses the hit tile');
assert.equal(t.scope.stage.style.transform, 'translateY(-666px)');

// In pointer mode, a stationary cursor cannot transfer focus as different tiles
// move underneath it. Descendant targets still identify their parent app.
t = setup(); t.pointer(6, 200, 200); t.pointer(0, 201, 200);
assert.equal(t.scope.focused, 0);
const pointerCollapse = t.positions.length;
t.hover(6); t.pointer(6, 201, 200);
assert.equal(t.scope.focused, 0); assert.equal(t.positions.length, pointerCollapse);
t.pointer(7, 202, 200);
assert.equal(t.scope.focused, 7, 'Real motion into a logo focuses its app, independent of stale layout geometry');

// Desktop input can deliberately return from keyboard to mouse without editing.
for (const scale of [1, 0.425]) {
  t = setup({ scale }); t.pointer(6, 200, 200); t.key(38);
  for (const delta of [1, -2, 4, -8, 15]) t.pointer(6, 200 + delta, 200);
  assert.equal(t.scope.focused, 0, 'Small mouse jitter cannot interrupt a keyboard collapse');
  t.pointer(6, 217, 200); assert.equal(t.scope.focused, 6);
  assert.equal(t.scope.editing, null, 'Normal pointer takeover works outside Move');
}

// Overlay/lifecycle guards block ordinary focus and consume coordinates, so
// closing a panel cannot reinterpret the last pointer event as new movement.
for (const reason of ['panel', 'hidden', 'tileMenu', 'inputs', 'wall']) {
  t = setup(); t.pointer(0);
  if (reason === 'panel') t.scope.activePanels.controlCentre = true;
  else if (reason === 'hidden') t.scope.document.hidden = true;
  else t.scope.zone = reason;
  t.pointer(6, 120, 100); assert.equal(t.scope.focused, 0, reason);
  t.scope.activePanels = {}; t.scope.document.hidden = false; t.scope.zone = 'grid';
  t.pointer(6, 120, 100); assert.equal(t.scope.focused, 0);
  t.pointer(6, 121, 100); assert.equal(t.scope.focused, 6);
}
for (const zone of ['top']) {
  t = setup(); t.scope.zone = zone; t.pointer(6);
  assert.equal(t.scope.focused, 6); assert.equal(t.scope.zone, 'grid');
}
t = setup(); t.pointer(6, 100, 100, { parentNode: t.scope.tilesEl });
assert.equal(t.scope.focused, 0, 'Blank grid background is not an app');
console.log((preview ? 'Preview' : 'Production') + ' drawer: collapse cannot reopen from hover/stationary cursor; native and desktop focus ownership, descendant hit targets, modal and visibility guards passed.');
