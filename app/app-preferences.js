/* Saved launcher order and hidden apps. Existing tvhome.order seeds the first run. */
(function (root) {
  'use strict';
  function create(storage, storageKey) {
    var key = storageKey || 'tvhome.appActions', state = { order: [], hidden: [] }, savedText = null;
    function ids(value) {
      var seen = Object.create(null);
      return Array.isArray(value) ? value.filter(function (id) {
        if (typeof id !== 'string' || !id || seen[id]) return false;
        seen[id] = true; return true;
      }) : [];
    }
    try {
      savedText = storage.getItem(key);
      var saved = JSON.parse(savedText);
      if (saved && saved.version === 1) state = { order: ids(saved.order), hidden: ids(saved.hidden) };
    } catch (e) {}
    function save() {
      var value = JSON.stringify({ version: 1, order: state.order, hidden: state.hidden });
      if (value === savedText) return;
      try { storage.setItem(key, value); savedText = value; }
      catch (e) { /* Preferences still work for the lifetime of this page. */ }
    }
    function reconcile(defaultIds) {
      var length = state.order.length;
      ids(defaultIds).forEach(function (id) { if (state.order.indexOf(id) < 0) state.order.push(id); });
      if (state.order.length !== length) save();
    }
    function visible(defaultIds) {
      reconcile(defaultIds);
      return state.order.filter(function (id) { return defaultIds.indexOf(id) >= 0 && state.hidden.indexOf(id) < 0; });
    }
    function reorder(visibleIds) {
      var next = ids(visibleIds), index = 0;
      state.order = state.order.map(function (id) { return next.indexOf(id) >= 0 ? next[index++] : id; });
      while (index < next.length) state.order.push(next[index++]);
      save();
    }
    function hide(id) {
      if (state.order.indexOf(id) < 0 || state.hidden.indexOf(id) >= 0) return false;
      state.hidden.push(id); save(); return true;
    }
    function restore(id) {
      var index = state.hidden.indexOf(id);
      if (index < 0) return false;
      state.hidden.splice(index, 1); save(); return true;
    }
    function hidden(defaultIds) {
      reconcile(defaultIds);
      return state.order.filter(function (id) { return defaultIds.indexOf(id) >= 0 && state.hidden.indexOf(id) >= 0; });
    }
    return { visible: visible, reorder: reorder, hide: hide, restore: restore, hidden: hidden };
  }
  if (typeof module === 'object' && module.exports) module.exports = { create: create };
  else root.AppPreferences = { create: create };
})(this);
