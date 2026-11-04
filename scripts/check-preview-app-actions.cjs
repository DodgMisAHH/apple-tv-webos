/* App visibility/order behavior. --production checks the installed-app model. */
const assert = require('assert');
const production = process.argv.includes('--production');
const model = require('../app/app-preferences.js');
const KEY = production ? 'tvhome.appActions' : 'tvhome.preview.appActions';
const create = storage => model.create(storage, KEY);

function memoryStorage(initial = {}) {
  const values = { ...initial }, writes = [];
  return { values, writes,
    getItem(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
    setItem(key, value) { values[key] = value; writes.push(key); }
  };
}

// Hiding several apps and rearranging the remaining tiles preserves each hidden
// app's slot. The order in which apps are restored must not change the result.
const inventory = ['stremio', 'netflix', 'disney', 'youtube', 'apple', 'prime'];
let storage = memoryStorage({ 'tvhome.order': 'installed-layout', 'tvhome.columns': '6' });
let prefs = create(storage);
assert.deepStrictEqual(prefs.visible(inventory), inventory);
assert(prefs.hide('netflix')); assert(prefs.hide('apple'));
assert(!prefs.hide('netflix')); assert(!prefs.hide('unknown'));
assert.deepStrictEqual(prefs.visible(inventory), ['stremio', 'disney', 'youtube', 'prime']);
prefs.reorder(['prime', 'youtube', 'stremio', 'disney']);
assert.deepStrictEqual(prefs.visible(inventory), ['prime', 'youtube', 'stremio', 'disney']);
assert.deepStrictEqual(prefs.hidden(inventory), ['netflix', 'apple']);
prefs = create(storage); // simulate a page reload
assert.deepStrictEqual(prefs.visible(inventory), ['prime', 'youtube', 'stremio', 'disney']);
assert(prefs.restore('apple')); assert(prefs.restore('netflix'));
assert(!prefs.restore('netflix'));
assert.deepStrictEqual(prefs.visible(inventory), ['prime', 'netflix', 'youtube', 'stremio', 'apple', 'disney']);
assert.strictEqual(storage.values['tvhome.order'], 'installed-layout');
assert.strictEqual(storage.values['tvhome.columns'], '6');
assert(storage.writes.every(key => key === KEY), 'feature writes only its own preference key');

// A transient empty inventory, uninstall, or inventory ordering change must not
// silently unhide apps or discard their positions. Newly installed apps appear.
prefs.hide('netflix');
assert.deepStrictEqual(prefs.visible([]), []);
assert.deepStrictEqual(prefs.hidden([]), []);
const withoutNetflix = inventory.filter(id => id !== 'netflix');
assert.deepStrictEqual(prefs.visible(withoutNetflix), ['prime', 'youtube', 'stremio', 'apple', 'disney']);
prefs = create(storage);
assert.deepStrictEqual(prefs.hidden(inventory.slice().reverse()), ['netflix']);
assert.deepStrictEqual(prefs.visible(inventory.concat('new-app')), ['prime', 'youtube', 'stremio', 'apple', 'disney', 'new-app']);
prefs.restore('netflix');
assert.deepStrictEqual(prefs.visible(inventory.concat('new-app')), ['prime', 'netflix', 'youtube', 'stremio', 'apple', 'disney', 'new-app']);

// Every tile can be hidden, persisted and restored. Restoring a later tile first
// must not permanently pull it ahead of apps which were originally before it.
storage = memoryStorage(); prefs = create(storage);
prefs.visible(['a', 'b', 'c']);
['a', 'b', 'c'].forEach(id => assert(prefs.hide(id)));
prefs = create(storage);
assert.deepStrictEqual(prefs.visible(['a', 'b', 'c']), []);
assert.deepStrictEqual(prefs.hidden(['a', 'b', 'c']), ['a', 'b', 'c']);
prefs.restore('c'); assert.deepStrictEqual(prefs.visible(['a', 'b', 'c']), ['c']);
prefs.restore('a'); prefs.restore('b');
assert.deepStrictEqual(prefs.visible(['a', 'b', 'c']), ['a', 'b', 'c']);

// Bad saved data cannot duplicate tiles, and storage failures retain usable
// in-memory behavior without touching other launcher settings.
storage = memoryStorage({ [KEY]: JSON.stringify({ version: 1,
  order: ['a', 'a', null, '', 3, 'b'], hidden: ['b', 'b', false, ''] }) });
prefs = create(storage);
assert.deepStrictEqual(prefs.visible(['a', 'b', 'c']), ['a', 'c']);
assert.deepStrictEqual(prefs.hidden(['a', 'b', 'c']), ['b']);
prefs = create(memoryStorage({ [KEY]: 'broken json' }));
assert.deepStrictEqual(prefs.visible(['a', 'b']), ['a', 'b']);
prefs = create({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } });
assert.deepStrictEqual(prefs.visible(['a', 'b']), ['a', 'b']);
prefs.hide('a'); assert.deepStrictEqual(prefs.visible(['a', 'b']), ['b']);
prefs.restore('a'); assert.deepStrictEqual(prefs.visible(['a', 'b']), ['a', 'b']);

// Reads and identical placements do not synchronously persist unchanged state.
storage=memoryStorage();prefs=create(storage);prefs.visible(['a','b']);
const seededWrites=storage.writes.length;
for(let i=0;i<10;i++){prefs.visible(['a','b']);prefs.hidden(['a','b']);}
prefs.reorder(['a','b']);
assert.equal(storage.writes.length,seededWrites,'Unchanged reads/reorders cannot write preferences');
prefs.hide('a');assert.equal(storage.writes.length,seededWrites+1);
prefs.restore('a');assert.equal(storage.writes.length,seededWrites+2);
prefs.visible(['a','b','c']);assert.equal(storage.writes.length,seededWrites+3,'A new app persists its position once');

// The browser variant executes the shared model with a separate key. Existing
// preview preferences and production migrations remain independent on one origin.
const fs=require('fs'),vm=require('vm'),preview={};
vm.runInNewContext(fs.readFileSync('preview/app-actions/preferences.js','utf8'),{window:preview});
assert.equal(preview.LAUNCHER_PREFERENCES_KEY,'tvhome.preview.appActions');
storage=memoryStorage();
const installed=model.create(storage),isolated=model.create(storage,preview.LAUNCHER_PREFERENCES_KEY);
installed.visible(['a','b']);isolated.visible(['a','b']);
installed.hide('a');isolated.hide('b');
assert.deepEqual(installed.visible(['a','b']),['b']);
assert.deepEqual(isolated.visible(['a','b']),['a']);
assert.deepEqual(model.create(storage).visible(['a','b']),['b']);
assert.deepEqual(model.create(storage,preview.LAUNCHER_PREFERENCES_KEY).visible(['a','b']),['a']);

console.log((production ? 'Production' : 'Preview') + ' hide/restore ordering, visible rearranging, reload, inventory changes, hide-all recovery, changed-only persistence and shared preview storage isolation passed.');
