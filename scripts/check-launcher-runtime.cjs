// Execute the complete launcher against its real HTML IDs, with no browser/TV I/O.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
function setup(preview = false) {
  const ids = new Map(), imageRequests = [], listeners = {}, timers = new Map(), values = new Map();
  let nextTimer = 0;
  class Element {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {};
      this.style = { setProperty(name, value) { this[name] = value; } };
      const classes = new Set();
      this.classList = { add: name => classes.add(name), remove: name => classes.delete(name),
        contains: name => classes.has(name), toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } };
    }
    set id(value) { this._id = value; ids.set(value, this); }
    get id() { return this._id; }
    set src(value) { imageRequests.push(value); this._src = value; }
    get src() { return this._src; }
    set innerHTML(value) { this.children = []; this._html = value; }
    get innerHTML() { return this._html || ''; }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    addEventListener(name, fn) { (this.listeners[name] || (this.listeners[name] = [])).push(fn); }
    querySelector(selector) { return this.children.find(child => child.tagName === selector) || null; }
    getBoundingClientRect() { return { left: 0, top: 0, right: 250, bottom: 150, width: 250, height: 150 }; }
  }
  const body = new Element('body');
  for (const match of fs.readFileSync('app/index.html', 'utf8').matchAll(/\bid="([^"]+)"/g)) {
    const element = new Element('div'); element.id = match[1]; body.appendChild(element);
  }
  for (const id of ['btnInputs', 'btnWifi', 'btnSettings']) ids.get(id).appendChild(new Element('span'));
  const scope = { document: { body, hidden: false, documentElement: new Element('html'),
      getElementById: id => ids.get(id), createElement: tag => new Element(tag),
      createTextNode: text => ({ textContent: text }),
      addEventListener(name, fn) { (listeners[name] || (listeners[name] = [])).push(fn); } },
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id), addEventListener() {}, location: { reload() {} }, console };
  scope.window = scope; vm.createContext(scope);
  vm.runInContext(fs.readFileSync('app/config.js', 'utf8'), scope);
  scope.CONFIG.hiddenApps = []; scope.CONFIG.dockApps = [];
  values.set('tvhome.order', JSON.stringify({ dock: '', ids: ['no.icon', 'has.icon'] }));
  scope.TV_APPS = { apps: [
    { id: 'has.icon', title: 'Available icon', icon: 'icons/available.png?v=1', iconColor: '#123456' },
    { id: 'no.icon', title: 'Missing icon', icon: '', iconColor: '#123456' }
  ] };
  if (preview) vm.runInContext(fs.readFileSync('preview/app-actions/preferences.js', 'utf8'), scope);
  vm.runInContext(fs.readFileSync('app/app-preferences.js', 'utf8'), scope);
  vm.runInContext(fs.readFileSync('app/app.js', 'utf8'), scope);
  return { scope, ids, values, imageRequests,
    tiles: () => ids.get('tiles').children,
    click: el => el.listeners.click.forEach(fn => fn({ preventDefault() {} })) };
}
for (const preview of [false, true]) {
  const test = setup(preview), tiles = test.tiles();
  assert.deepEqual(tiles.map(tile => tile.getAttribute('aria-label')), ['Missing icon', 'Available icon'],
    'Legacy order seeds the shared runtime without losing apps lacking icons');
  assert(tiles[0].children[0].classList.contains('missing'));
  assert.equal(tiles[0].children[0].textContent, 'M');
  assert.deepEqual(test.imageRequests, ['icons/available.png?v=1'], 'Missing icons cannot request the document URL');
  const key = preview ? 'tvhome.preview.appActions' : 'tvhome.appActions';
  assert(test.values.has(key)); assert(!test.values.has(preview ? 'tvhome.appActions' : 'tvhome.preview.appActions'));
  tiles[0].listeners.contextmenu[0]({ preventDefault() {} });
  test.click(test.ids.get('tileActionMenu').children[0].children[1]);
  assert.deepEqual(test.tiles().map(tile => tile.getAttribute('aria-label')), ['Available icon']);
  assert.equal(test.scope.LauncherControls.hiddenApps()[0].id, 'no.icon');
  assert(test.scope.LauncherControls.restoreApp('no.icon'));
  assert.deepEqual(test.tiles().map(tile => tile.getAttribute('aria-label')), ['Missing icon', 'Available icon']);
}
console.log('Complete production/preview startup, legacy migration, missing-icon fallback, Move/Hide menu and restoration passed.');
