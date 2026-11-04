// Exercise real move handlers without a TV or browser. --production checks app/.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const production = process.argv.includes('--production');
const source = fs.readFileSync('app/app.js', 'utf8');
function take(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert(first >= 0 && last > first, 'Missing source boundary: ' + start);
  return source.slice(first, last);
}
function classes() {
  const values = new Set();
  return { add: value => values.add(value), remove: value => values.delete(value),
    contains: value => values.has(value) };
}
function setup({ scale = 1, scroll = 0, count = 8, native = false } = {}) {
  let layouts = 0, saves = 0;
  const elements = Array.from({ length: count }, (_, i) => ({
    app: { id: String.fromCharCode(65 + i) }, el: { classList: classes() }
  }));
  const documentHandlers = {};
  const scope = {
    items: elements.slice(), focused: 0, zone: 'grid', editing: null,
    movePointerX: null, movePointerY: null, activePanels: {},
    COLUMNS: 6, GRID_SIDE: 65, CELL_W: (1920 - 130) / 6, TILE_W: 250, TILE_H: 150,
    DOCK_TOP: 826, ROW_PITCH: 230, DOCK_GAP: 0, offset: scroll,
    window: { LAUNCHER_SCALE: scale },
    document: { hidden: false, body: { classList: classes() },
      addEventListener(name, fn, capture) {
        (documentHandlers[name] || (documentHandlers[name] = [])).push({ fn, capture: !!capture });
      } },
    stage: { getBoundingClientRect() {
      return { left: 40 * scale, top: (30 - scroll) * scale,
        right: 1960 * scale, bottom: (1110 - scroll) * scale,
        width: 1920 * scale, height: 1080 * scale };
    } },
    KEY: { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27 },
    L: { moveHint: '' }, toast() {}, noteInteraction() {},
    layout() { layouts++; }, saveOrder() { saves++; },
    focusTile(index) { scope.focused = index; scope.zone = 'grid'; }
  };
  if (native) scope.window.PalmSystem = {};
  vm.createContext(scope);
  vm.runInContext(take('  function logicalRect(el)', '  var KEY ='), scope);
  vm.runInContext(take('  function rowOf(i)', '  function build()'), scope);
  vm.runInContext(take('  // ---- rearranging ', '  // ---- tile actions'), scope);
  assert.equal(typeof scope.moveWithPointer, 'function', 'Move handler must exist');
  assert(documentHandlers.mousemove.some(handler => handler.fn === scope.moveWithPointer),
    'Pointer movement must use the guarded handler');
  assert(documentHandlers.keydown.some(handler => handler.capture && handler.fn === scope.useMoveKeys),
    'D-pad ownership must be established in capture phase');
  const keyBody = take('    } else if (editing) {', "    } else if (zone === 'inputs') {")
    .replace('    } else if (editing) {', 'function moveKey(k, e) {');
  vm.runInContext(keyBody + '\n}', scope);
  scope.document.addEventListener('keydown', event => {
    if (scope.editing) scope.moveKey(event.keyCode, event);
  });
  assert(!take('  function build()', '  /** Places every tile').includes("addEventListener('mouseover'"),
    'Animated tile hover cannot move or focus apps; genuine pointer motion owns both');
  function point(index, dx = 0, dy = 0) {
    return { clientX: (40 + scope.tileLeft(index) + scope.TILE_W / 2 + dx) * scale,
      clientY: (30 - scroll + scope.tileTop(index) + scope.TILE_H / 2 + dy) * scale };
  }
  function dispatch(name, event) {
    // The ownership capture listener must run before the real editing branch.
    const handlers = documentHandlers[name] || [];
    handlers.filter(handler => handler.capture).forEach(handler => handler.fn(event));
    handlers.filter(handler => !handler.capture).forEach(handler => handler.fn(event));
  }
  return { scope, point,
    order: () => Array.from(scope.items, item => item.app.id).join(''),
    pointer: event => dispatch('mousemove', event),
    key: (code, repeat = false) => dispatch('keydown', { keyCode: code, repeat, preventDefault() {} }),
    cursor: visibility => dispatch('cursorStateChange', { detail: { visibility } }),
    cursorEvent: event => dispatch('cursorStateChange', event),
    get layouts() { return layouts; }, get saves() { return saves; }
  };
}

// Re-hitting the same animated tile (including a child logo) must never become
// a second move. The original handler changed AB to BA and then straight back.
let t = setup();
t.pointer(t.point(0)); t.scope.startEdit();
assert.equal(t.order(), 'ABCDEFGH'); assert.equal(t.layouts, 0);
t.pointer(t.point(1));
assert.equal(t.order(), 'BACDEFGH'); assert.equal(t.layouts, 1);
t.pointer(t.point(1));
assert.equal(t.order(), 'BACDEFGH'); assert.equal(t.layouts, 1);
t.pointer(t.point(1, 1));
assert.equal(t.layouts, 1, 'Moving within one stable slot cannot reorder twice');
t.pointer(t.point(2));
assert.equal(t.order(), 'BCADEFGH'); assert.equal(t.layouts, 2);

// A keyboard move remains authoritative while the pointer is stationary,
// even if animation causes hover events or a duplicate-coordinate mousemove.
t.key(39);
assert.equal(t.order(), 'BCDAEFGH');
const afterKey = t.layouts;
t.pointer(t.point(2));
assert.equal(t.order(), 'BCDAEFGH'); assert.equal(t.layouts, afterKey);
t.pointer(t.point(2, 2));
assert.equal(t.order(), 'BCDAEFGH', 'Small pointer jitter cannot reclaim keyboard control');
t.pointer(t.point(2, 17));
assert.equal(t.order(), 'BCADEFGH', 'Deliberate desktop pointer motion can resume control');
t.key(27);
assert.equal(t.order(), 'ABCDEFGH'); assert.equal(t.scope.focused, 0);
assert.equal(t.scope.editing, null); assert.equal(t.saves, 0, 'Cancel never saves');
assert(!t.scope.document.body.classList.contains('editing'));

// Native D-pad mode is authoritative until webOS makes the pointer visible.
// Both tiny gyro jitter and a whole-screen cursor recenter must be ignored.
t = setup({ native: true });
t.pointer(t.point(5)); t.key(39); // Arrow navigation before entering Move also counts.
t.scope.startEdit();
assert.equal(t.scope.moveInput, 'keys');
for (const event of [t.point(5, 1), t.point(3), t.point(0), t.point(7)]) t.pointer(event);
assert.equal(t.order(), 'ABCDEFGH'); assert.equal(t.layouts, 0);
t.key(39);
assert.equal(t.order(), 'BACDEFGH'); assert.equal(t.layouts, 1, 'A single tap moves exactly one slot');
for (const event of [t.point(4), t.point(1, 2), t.point(7), t.point(2)]) t.pointer(event);
assert.equal(t.order(), 'BACDEFGH'); assert.equal(t.layouts, 1);
for (let destination = 2; destination <= 4; destination++) {
  t.key(39, true);
  assert.equal(t.scope.focused, destination, 'Each held-key repeat advances exactly one slot');
  assert.equal(t.layouts, destination);
  t.pointer(t.point(0, destination));
  assert.equal(t.scope.focused, destination, 'Interleaved remote motion cannot reverse a held move');
}
t.cursor(false); t.pointer(t.point(6));
assert.equal(t.order(), 'BCDEAFGH');
t.cursorEvent({}); t.cursorEvent({ detail: { visibility: 'true' } });
t.pointer(t.point(7));
assert.equal(t.order(), 'BCDEAFGH', 'Malformed visibility events cannot release D-pad ownership');
t.cursor(true); t.pointer(t.point(2));
assert.equal(t.order(), 'BCADEFGH', 'Visible native pointer can deliberately resume placement');
t.key(39); // Disable pointer immediately, before a later hidden-cursor event.
t.pointer(t.point(0));
assert.equal(t.order(), 'BCDAEFGH');
t.cursor(false); t.pointer(t.point(5));
assert.equal(t.order(), 'BCDAEFGH');
t.key(27);
assert.equal(t.order(), 'ABCDEFGH'); assert.equal(t.saves, 0);

// Preview takeover uses logical pixels and one anchored displacement, rather
// than accumulating tiny alternating jitter or interpreting an unknown origin.
for (const scale of [1, 0.425]) {
  t = setup({ scale });
  t.pointer(t.point(2)); t.scope.startEdit(); t.key(39);
  for (const dx of [1, -2, 3, -4, 8, -8, 15]) t.pointer(t.point(2, dx));
  assert.equal(t.order(), 'BACDEFGH');
  t.pointer(t.point(2, 17)); assert.equal(t.order(), 'BCADEFGH');
  t.key(13); assert.equal(t.saves, 1);

  t = setup({ scale });
  t.key(39); t.scope.startEdit();
  t.pointer(t.point(3)); assert.equal(t.order(), 'ABCDEFGH', 'First unknown position only establishes an anchor');
  t.pointer(t.point(3, 8)); assert.equal(t.order(), 'ABCDEFGH');
  t.pointer(t.point(3, 17)); assert.equal(t.order(), 'BCDAEFGH');
}

// A hidden cursor also blocks a pointer-originated edit, before any arrow key.
t = setup({ native: true }); t.pointer(t.point(0)); t.scope.startEdit();
t.cursor(false); t.pointer(t.point(2)); assert.equal(t.order(), 'ABCDEFGH');
t.cursor(true); t.pointer(t.point(2, 1)); assert.equal(t.order(), 'BCADEFGH');
t.key(13); assert.equal(t.saves, 1);

// Map viewport coordinates into the scaled, scrolled stage. Animated element
// identity is irrelevant; the partially filled last row still has fixed slots.
for (const scale of [1, 0.425]) {
  t = setup({ scale, scroll: 666 });
  t.pointer(t.point(0)); t.scope.startEdit(); t.pointer(t.point(7));
  assert.equal(t.order(), 'BCDEFGHA'); assert.equal(t.scope.focused, 7);
  const atLast = t.layouts;
  t.pointer(t.point(8));
  assert.equal(t.layouts, atLast, 'An empty last-row slot cannot move a tile');
  t.pointer(t.point(6, t.scope.TILE_W / 2 + 10));
  t.pointer(t.point(6, 0, t.scope.TILE_H / 2 + 10));
  assert.equal(t.layouts, atLast, 'Horizontal and vertical gaps are not destinations');
  t.pointer({ clientX: -20, clientY: -20 });
  assert.equal(t.layouts, atLast, 'Outside the grid is not a destination');
  t.pointer(t.point(6));
  assert.equal(t.order(), 'BCDEFGAH');
  t.key(13);
  assert.equal(t.saves, 1); assert.equal(t.scope.editing, null);
  t.pointer(t.point(0));
  assert.equal(t.order(), 'BCDEFGAH', 'Ordinary pointer movement cannot rearrange');
}

// Ignored movements still update the pointer position, so closing an overlay
// or regaining visibility cannot turn stale coordinates into a new action.
for (const reason of ['hidden', 'panel', 'zone']) {
  t = setup(); t.pointer(t.point(0)); t.scope.startEdit();
  if (reason === 'hidden') t.scope.document.hidden = true;
  if (reason === 'panel') t.scope.activePanels.controlCentre = true;
  if (reason === 'zone') t.scope.zone = 'tileMenu';
  t.pointer(t.point(2)); assert.equal(t.order(), 'ABCDEFGH');
  t.scope.document.hidden = false; t.scope.activePanels = {}; t.scope.zone = 'grid';
  t.pointer(t.point(2)); assert.equal(t.order(), 'ABCDEFGH');
  t.pointer(t.point(2, 1)); assert.equal(t.order(), 'BCADEFGH');
}
console.log((production ? 'Production' : 'Preview') + ' move: native D-pad/cursor ownership, tap/hold isolation, desktop motion threshold, stable slots, scaled scrolling, bounds, save/cancel and overlay guards passed.');
