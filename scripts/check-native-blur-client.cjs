/* Local VM/DOM/XHR simulation only. Never contacts a service, browser or TV. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../app/native-blur.js'), 'utf8');
const TOKEN = 'a'.repeat(64), NEXT = 'b'.repeat(64);
const config = token => ({nativeBlur: {token, port: 48740}});

function fixture(options = {}) {
  let now = 0, nextTimer = 0;
  const timers = new Map(), calls = [], listeners = [], observers = [];
  function element(classes = []) {
    const value = {classes: new Set(classes), hidden: false, parentNode: null};
    value.classList = {contains: name => value.classes.has(name), add: name => value.classes.add(name), remove: name => value.classes.delete(name)};
    return value;
  }
  const body = element(options.closed ? [] : ['ccOpen']), tiles = element(), detail = element();
  const buttons = Array.from({length: 9}, (_, i) => element(i === 0 ? ['ccTile', 'selected'] : ['ccTile']));
  buttons.forEach(button => { button.parentNode = tiles; }); tiles.parentNode = detail.parentNode = body; detail.hidden = true;
  tiles.querySelectorAll = selector => { assert.equal(selector, '.ccTile'); return buttons; };
  function events(owner) { return {
    addEventListener(type, handler, capture) { listeners.push({owner, type, handler, capture}); },
    removeEventListener(type, handler, capture) {
      const index = listeners.findIndex(l => l.owner === owner && l.type === type && l.handler === handler && l.capture === capture);
      assert(index >= 0, 'Remove exactly the installed event listener'); listeners.splice(index, 1);
    }
  }; }
  function schedule(fn, delay, kind = 'client') { const id = ++nextTimer; timers.set(id, {fn, at: now + Math.max(0, delay), kind}); return id; }
  function clear(id) { timers.delete(id); }
  class Observer {
    constructor(callback) { this.callback = callback; this.active = true; this.targets = []; observers.push(this); }
    observe(target, settings) { this.targets.push({target, settings}); }
    disconnect() { this.active = false; }
  }
  class XHR {
    constructor() { if (options.throwAt === 'constructor') throw Error('XHR unavailable'); this.headers = {}; this.aborts = 0; this.done = false; }
    open(method, url, async) {
      if (options.throwAt === 'open') throw Error('XHR unavailable');
      assert.equal(method, 'POST'); assert.equal(url, 'http://127.0.0.1:48740/state'); assert.equal(async, true);
      this.method = method; this.url = url;
    }
    setRequestHeader(name, value) { this.headers[name] = value; }
    send(data) {
      if (options.throwAt === 'send') throw Error('XHR unavailable');
      this.payload = JSON.parse(data); this.saved = {load: this.onload, error: this.onerror, timeout: this.ontimeout, abort: this.onabort}; calls.push(this);
      assert.deepEqual(this.headers, {'Content-Type': 'text/plain'}); assert.equal(this.timeout, 1200);
      assert.deepEqual(Object.keys(this.payload).sort(), ['main', 'selected', 'sequence', 'token', 'visible']);
      this.io = schedule(() => this.fail('timeout'), this.timeout, 'xhr');
      if (options.synchronousError) this.fail('error');
    }
    abort() { this.aborts++; this.done = true; clear(this.io); if (this.onabort) this.onabort(); }
    reply(status = 200, late = false) {
      this.status = status;
      if (!late) { this.done = true; clear(this.io); }
      const callback = late ? this.saved.load : this.onload;
      if (callback) callback();
    }
    fail(kind = 'error', late = false) {
      if (!late) { this.done = true; clear(this.io); }
      const callback = late ? this.saved[kind] : this['on' + kind];
      if (callback) callback();
    }
  }
  const document = {body, hidden: !!options.hidden, ...events('document'),
    getElementById(id) { return ({ccTiles: tiles, ccDetail: detail})[id] || null; }};
  const context = {document, ...events('window'), XMLHttpRequest: XHR, Date: {now: () => now},
    setTimeout: schedule, clearTimeout: clear,
    console: {log() { throw Error('Client must not log session tokens'); }, error() { throw Error('Client must fail silently'); }}};
  context.window = context;
  if (!options.preview) context.PalmSystem = {launchParams: JSON.stringify(Object.hasOwn(options, 'params') ? options.params : config(TOKEN))};
  if (!options.noObserver) context.MutationObserver = Observer;
  vm.runInNewContext(source, context, {filename: 'native-blur.js'});
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const entry = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!entry) break;
      now = entry[1].at; timers.delete(entry[0]); entry[1].fn();
    }
    now = end;
  }
  function emit(owner, type, detail) { for (const event of [...listeners]) if (event.owner === owner && event.type === type) event.handler({type, detail}); }
  function mutation(target = body, attributeName = 'class') {
    for (const observer of observers) {
      if (!observer.active) continue;
      const watched = observer.targets.some(entry => {
        let node = target;
        while (node) { if (node === entry.target) return (target === node || entry.settings.subtree) && entry.settings.attributeFilter.includes(attributeName); node = node.parentNode; }
        return false;
      });
      if (watched) observer.callback([{type: 'attributes', target, attributeName}]);
    }
  }
  function select(index) { buttons.forEach((button, i) => { button.classes.delete('selected'); if (i === index) button.classes.add('selected'); }); mutation(tiles, 'class'); }
  function relaunch(params, string = false) { emit('document', 'webOSRelaunch', string ? JSON.stringify(params) : params); }
  function launchParams(params) { context.PalmSystem.launchParams = JSON.stringify(params); }
  function newest() { assert(calls.length); return calls[calls.length - 1]; }
  function noWork() { assert.equal(timers.size, 0); assert(calls.every(call => call.done || call.aborts > 0)); }
  function stop() { context.NativeBlurClient.stop(); assert.equal(listeners.length, 0); assert(observers.every(observer => !observer.active)); noWork(); }
  function established() {
    context.NativeBlurClient.start(); assert.equal(calls.length, 1); assert.equal(newest().payload.main, false);
    newest().reply(); advance(180); assert.equal(calls.length, 2); assert.equal(newest().payload.main, true); newest().reply();
  }
  return {api: context.NativeBlurClient, calls, timers, listeners, observers, body, tiles, detail, buttons, document,
    advance, emit, mutation, select, relaunch, launchParams, newest, noWork, stop, established};
}

// Ordinary launches and browser preview must perform no loopback work.
for (const options of [{preview: true}, {params: {}}, {params: {nativeBlurFallbackToken: TOKEN}},
  {params: {...config(TOKEN), nativeBlurCancelToken: TOKEN}}, {params: {nativeBlur: {token: TOKEN, port: 80}}},
  {params: {nativeBlur: {token: TOKEN, port: '48740'}}}, {params: {nativeBlur: {token: 'x'.repeat(64), port: 48740}}},
  {params: {nativeBlur: {token: TOKEN.slice(1), port: 48740}}}, {params: {nativeBlur: []}}]) {
  const f = fixture(options); assert.equal(f.calls.length, 0); f.api.start(); f.advance(5000); assert.equal(f.calls.length, 0); f.stop();
}
let f = fixture(); assert.equal(f.calls.length, 0, 'Explicit start required'); f.api.start(); f.api.start();
assert.deepEqual(f.newest().payload, {token: TOKEN, sequence: 1, visible: true, main: false, selected: 0});
f.advance(180); assert.equal(f.calls.length, 1, 'Settled main waits for the hide barrier acknowledgement');
f.newest().reply(); assert.equal(f.calls.length, 2); assert.equal(f.newest().payload.main, true); f.newest().reply();
f.advance(820); assert.equal(f.calls.length, 3); assert.equal(f.newest().payload.main, true); assert.equal(f.newest().payload.sequence, 3);
f.newest().reply(); f.mutation(); assert.equal(f.calls.length, 3, 'Unchanged mutations do not restart settle'); f.stop();

// Even a timer already queued before clearTimeout cannot settle a newer
// transition, including selection A->B->A returning to identical DOM state.
f = fixture(); f.api.start();
const oldSettle = [...f.timers.values()].find(timer => timer.kind === 'client' && timer.at === 180).fn;
const oldHeartbeat = [...f.timers.values()].find(timer => timer.kind === 'client' && timer.at === 1000).fn;
f.select(1); f.select(0); const changedCount = f.calls.length;
oldSettle(); assert.equal(f.calls.length, changedCount); f.newest().reply(); f.advance(179);
assert.equal(f.calls.length, changedCount, 'Old A timer cannot mark the new A transition settled early');
f.advance(1); assert.equal(f.newest().payload.main, true); f.newest().reply();
f.relaunch(config(NEXT)); const replacement = f.newest(), replacementCount = f.calls.length;
oldHeartbeat(); assert.equal(f.calls.length, replacementCount); assert.equal(replacement.aborts, 0);
replacement.reply(); f.advance(180); f.newest().reply();
const sequenceBeforeSameToken = f.newest().payload.sequence; f.relaunch(config(NEXT), true);
assert(f.newest().payload.sequence > sequenceBeforeSameToken, 'Same-token relaunch never resets its sequence'); f.stop();
f = fixture({params: {}}); f.api.start(); assert.equal(f.calls.length, 0); f.relaunch(config(TOKEN));
assert.equal(f.calls.length, 1, 'An ordinary retained page can accept its first explicit trial token'); f.stop();

// Initial hidden launch waits without killing the server session prematurely.
for (const options of [{hidden: true}, {closed: true}]) {
  f = fixture(options); f.api.start(); f.advance(5000); assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0);
  f.document.hidden = false; f.body.classList.add('ccOpen'); f.emit('document', 'visibilitychange'); f.mutation();
  assert.equal(f.calls.length, 1); assert.equal(f.newest().payload.visible, true); f.stop();
}

// Settled selection updates keep main visible immediately. Rapid updates retain
// one flight, overwrite only the queued state, and never abort for selection.
f = fixture(); f.established(); f.select(1); const selection = f.newest();
assert.equal(f.calls.length, 3); assert.equal(selection.payload.main, true); assert.equal(selection.payload.selected, 1);
f.select(2); f.select(3); f.select(2); f.advance(180);
assert.equal(f.calls.length, 3, 'Selections coalesce while the current request is outstanding'); assert.equal(selection.aborts, 0);
assert.equal(f.calls.filter(call => !call.done).length, 1);
selection.reply(); const newestSelection = f.newest();
assert.equal(f.calls.length, 4); assert.equal(newestSelection.payload.main, true); assert.equal(newestSelection.payload.selected, 2);
selection.reply(409, true); selection.fail('error', true); assert.equal(newestSelection.aborts, 0);
assert(f.calls.slice(2).every(call => call.payload.main), 'No global hide during settled main selection changes');
assert(f.calls.every((call, i) => i === 0 || call.payload.sequence > f.calls[i - 1].payload.sequence));
newestSelection.reply(); f.advance(640); assert.equal(f.newest().payload.main, true); assert.equal(f.newest().payload.selected, 2);
f.newest().reply(); f.stop();

// A heartbeat-detected selection change also uses the fast path and schedules
// its next heartbeat, even when no MutationObserver callback was delivered.
f = fixture(); f.established(); f.buttons[0].classList.remove('selected'); f.buttons[4].classList.add('selected');
f.advance(820); assert.equal(f.newest().payload.main, true); assert.equal(f.newest().payload.selected, 4);
f.newest().reply(); const heartbeatCount = f.calls.length; f.advance(1000);
assert.equal(f.calls.length, heartbeatCount + 1); assert.equal(f.newest().payload.main, true); f.stop();

// A submenu still interrupts an in-flight selection with an immediate hide
// barrier and discards its queued selection. Late callbacks cannot revive it.
f = fixture(); f.established(); f.select(1); const old = f.newest(); f.select(3);
f.tiles.hidden = true; f.detail.hidden = false; f.mutation(f.detail, 'hidden');
const barrier = f.newest(); assert.equal(old.aborts, 1); assert.equal(barrier.payload.main, false); assert.equal(barrier.payload.selected, 3);
const beforeLate = f.calls.length; old.reply(409, true); old.fail('error', true);
assert.equal(f.calls.length, beforeLate); assert.equal(barrier.aborts, 0); barrier.reply(); f.advance(180);
assert.equal(f.calls.length, beforeLate, 'Queued main selection is dropped on submenu entry');
f.tiles.hidden = false; f.detail.hidden = true; f.mutation(f.tiles, 'hidden');
assert.equal(f.newest().payload.main, false); f.newest().reply(); const beforeReturn = f.calls.length;
f.advance(179); assert.equal(f.calls.length, beforeReturn); f.advance(1);
assert.equal(f.newest().payload.main, true); assert.equal(f.newest().payload.selected, 3); f.stop();

// Forced geometry refresh still interrupts a selection, regardless of its
// settled main state, and retains the normal 180 ms return barrier.
f = fixture(); f.established(); f.select(1); const resizeSelection = f.newest(); f.emit('window', 'resize');
assert.equal(resizeSelection.aborts, 1); assert.equal(f.newest().payload.main, false);
f.newest().reply(); const resizeCount = f.calls.length; f.advance(179); assert.equal(f.calls.length, resizeCount);
f.advance(1); assert.equal(f.newest().payload.main, true); assert.equal(f.newest().payload.selected, 1); f.stop();

// Submenus and wallpaper keep the session alive without painting the main grid.
f = fixture(); f.established(); f.tiles.hidden = true; f.detail.hidden = false; f.mutation(f.detail, 'hidden');
assert.equal(f.newest().payload.main, false); assert.equal(f.newest().payload.visible, true); f.newest().reply();
f.advance(1000); assert.equal(f.newest().payload.main, false); f.newest().reply();
f.tiles.hidden = false; f.detail.hidden = true; f.mutation(f.tiles, 'hidden'); f.newest().reply(); f.advance(180);
assert.equal(f.newest().payload.main, true); f.newest().reply();
f.body.classList.remove('ccOpen'); f.body.classList.add('wallOpen'); f.mutation();
assert.equal(f.newest().payload.visible, true); assert.equal(f.newest().payload.main, false); f.newest().reply();
f.advance(1000); assert.equal(f.newest().payload.visible, true); assert.equal(f.newest().payload.main, false); f.newest().reply();
f.body.classList.remove('wallOpen'); f.body.classList.add('ccOpen'); f.mutation(); f.newest().reply(); f.advance(180);
assert.equal(f.newest().payload.main, true); f.newest().reply(); f.stop();

// Every active geometry change inserts a barrier; ambiguous tile state remains hidden.
f = fixture(); f.established(); f.emit('window', 'resize'); assert.equal(f.newest().payload.main, false);
f.newest().reply(); f.advance(180); assert.equal(f.newest().payload.main, true); f.newest().reply();
f.buttons[1].classList.add('selected'); f.mutation(f.buttons[1]); assert.equal(f.newest().payload.main, false); f.newest().reply();
f.advance(180); assert.equal(f.newest().payload.main, false); f.buttons[1].classList.remove('selected'); f.buttons.pop(); f.mutation(f.tiles);
f.advance(1000); assert.equal(f.newest().payload.main, false); f.stop();

// Hidden/pagehide/dormant/closed are terminal: one bounded final request, no work
// afterwards, and a retained-page relaunch needs a different valid token.
for (const cause of ['visibility', 'pagehide', 'dormant', 'closed']) {
  f = fixture(); f.established(); f.advance(820); const previous = f.newest();
  if (cause === 'visibility') { f.document.hidden = true; f.emit('document', 'visibilitychange'); }
  if (cause === 'pagehide') f.emit('window', 'pagehide');
  if (cause === 'dormant') { f.body.classList.add('overlayDormant'); f.mutation(); }
  if (cause === 'closed') { f.body.classList.remove('ccOpen'); f.mutation(); }
  assert.equal(previous.aborts, 1); assert.equal(f.newest().payload.visible, false); assert.equal(f.newest().payload.main, false);
  const count = f.calls.length; f.advance(5000); f.noWork();
  previous.reply(200, true); previous.fail('timeout', true);
  f.document.hidden = false; f.body.classList.remove('overlayDormant'); f.body.classList.add('ccOpen'); f.relaunch(config(TOKEN));
  f.emit('window', 'pageshow'); f.mutation(); f.advance(5000); assert.equal(f.calls.length, count); f.noWork(); f.stop();
}
f = fixture(); f.established(); f.document.hidden = true; f.emit('document', 'visibilitychange'); const hiddenPost = f.newest();
f.relaunch(config(NEXT), true); assert.equal(hiddenPost.aborts, 1); const countHidden = f.calls.length; f.advance(5000);
assert.equal(f.calls.length, countHidden); assert.equal(f.timers.size, 0);
f.document.hidden = false; f.emit('document', 'visibilitychange'); assert.equal(f.newest().payload.token, NEXT); assert.equal(f.newest().payload.sequence, 1);
hiddenPost.fail('error', true); f.newest().reply(); f.advance(180); assert.equal(f.newest().payload.main, true); f.stop();

// Any failed active transport retires only its token; missing/invalid relaunch
// config revokes the current token, while a fresh one resets its sequence.
for (const fault of ['error', 'timeout', 'abort', 409, 500]) {
  f = fixture(); f.api.start(); if (typeof fault === 'number') f.newest().reply(fault); else f.newest().fail(fault);
  f.advance(5000); f.noWork(); const count = f.calls.length;
  f.relaunch(config(TOKEN)); f.advance(1000); assert.equal(f.calls.length, count);
  f.relaunch(config(NEXT)); assert.equal(f.calls.length, count + 1); assert.equal(f.newest().payload.sequence, 1); f.stop();
}
f = fixture(); f.api.start(); const timedOut = f.newest(); f.advance(1200); f.noWork();
assert.equal(f.calls.length, 1, 'Actual XHR timeout drops queued settle/heartbeat state');
timedOut.reply(200, true); f.advance(5000); assert.equal(f.calls.length, 1); f.stop();
for (const options of [{throwAt: 'constructor'}, {throwAt: 'open'}, {throwAt: 'send'}, {synchronousError: true}, {noObserver: true}]) {
  f = fixture(options); f.api.start(); f.advance(5000); f.noWork(); f.stop();
}
// Empty relaunch details use WAM's updated launchParams on retained pages.
for (const detail of [undefined, null, {}, '{}', 'null']) {
  f = fixture(); f.established(); f.launchParams(config(NEXT)); f.relaunch(detail);
  assert.equal(f.newest().payload.token, NEXT); assert.equal(f.newest().payload.sequence, 1);
  assert.equal(f.newest().payload.visible, true); assert.equal(f.newest().payload.main, false);
  f.newest().reply(); f.advance(180); assert.equal(f.newest().payload.main, true); f.stop();
}
for (const params of [{controlCentre: true}, {nativeBlur: {token: TOKEN, port: 1}}, 'malformed JSON']) {
  f = fixture(); f.established(); f.relaunch(params); assert.equal(f.newest().payload.visible, false); f.newest().reply();
  f.advance(5000); f.noWork(); f.stop();
}
f = fixture(); f.established(); f.launchParams({}); f.relaunch({});
assert.equal(f.newest().payload.visible, false); f.newest().reply(); f.advance(5000); f.noWork(); f.stop();
f = fixture({params: config('A'.repeat(64))}); f.established(); assert.equal(f.newest().payload.token.toLowerCase(), TOKEN); f.stop();

// Cancellation is a separate command, never an ordinary relaunch with missing
// configuration. An old launch must not retire the newer retained-page session.
f = fixture(); f.established(); f.relaunch(config(NEXT)); f.newest().reply(); f.advance(180); f.newest().reply();
f.select(1); const cancelFlight = f.newest(); f.select(3); const cancelCount = f.calls.length;
for (const value of [TOKEN, null, '', 'malformed', {}, 1]) {
  f.relaunch({nativeBlurCancelToken:value, ...config(TOKEN)});
  assert.equal(f.calls.length, cancelCount); assert.equal(cancelFlight.aborts, 0);
}
cancelFlight.reply(); assert.equal(f.newest().payload.token, NEXT); assert.equal(f.newest().payload.selected, 3);
assert.equal(f.newest().payload.main, true); f.newest().reply(); f.advance(820);
assert.equal(f.newest().payload.main, true, 'Stale cancellation preserves the newer heartbeat');
const cancelled = f.newest(); f.relaunch({nativeBlurCancelToken:NEXT});
assert.equal(cancelled.aborts, 1); assert.equal(f.newest().payload.token, NEXT); assert.equal(f.newest().payload.visible, false);
const finalCancel = f.newest(), finalCount = f.calls.length;
f.relaunch({nativeBlurCancelToken:NEXT}); assert.equal(f.calls.length, finalCount); assert.equal(finalCancel.aborts, 0);
cancelled.reply(409, true); finalCancel.reply(); f.advance(5000); f.noWork();
f.relaunch(config(NEXT)); f.advance(5000); assert.equal(f.calls.length, finalCount, 'Cancelled token cannot resume');
f.relaunch(config(TOKEN)); assert.equal(f.newest().payload.token, TOKEN); assert.equal(f.newest().payload.sequence, 1); f.stop();

f = fixture(); f.established(); f.relaunch({controlCentre:true,nativeBlurFallbackToken:NEXT});
assert.equal(f.newest().payload.token, TOKEN); assert.equal(f.newest().payload.visible, false); f.newest().reply();
const fallbackCount = f.calls.length;
f.relaunch({nativeBlurCancelToken:NEXT}); f.advance(5000); assert.equal(f.calls.length, fallbackCount); f.noWork();
f.relaunch({controlCentre:true}); f.relaunch({nativeBlurCancelToken:TOKEN});
f.advance(5000); assert.equal(f.calls.length, fallbackCount, 'Fallback/plain ownership never starts native reporting'); f.stop();
console.log('Passed: native blur client inert ordinary/preview launch; immediate coalesced main-grid selections; acknowledged view/geometry barriers; stale callback isolation; submenu/wallpaper heartbeats; hidden startup and terminal cleanup; fresh-token reopen; geometry validation; transport/timeout/config failure cleanup. Simulated only.');
