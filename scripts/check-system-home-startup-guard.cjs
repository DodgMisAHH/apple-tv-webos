// A Home press may cancel a cold startup, but never becomes a foreground watchdog.
const assert = require('assert');
const { createGuard } = require('../tv/system-home/startup-guard.js');

function setup() {
  let time = 1000;
  const closes = [], logs = [];
  const guard = createGuard({ now: () => time, closeApp: id => closes.push(id), log: value => logs.push(value) });
  function event(appId, event, extra = {}) { guard.event(Object.assign({ appId, event }, extra)); }
  function cold(id) { event(id, 'splash'); event(id, 'launch'); }
  return { guard, closes, logs, event, cold, advance: ms => { time += ms; } };
}

let t = setup();
t.cold('youtube.leanback.v4'); t.guard.home();
assert.deepStrictEqual(t.closes, ['youtube.leanback.v4'], 'Home cancels a cold app that has not surfaced');
t.guard.home(); t.event('youtube.leanback.v4', 'foreground'); t.guard.home();
assert.equal(t.closes.length, 1, 'no repeated close or foreground-triggered intervention');

for (const terminal of ['foreground', 'background', 'pause', 'close', 'stop']) {
  t = setup(); t.cold('app.a'); t.event('app.a', terminal); t.guard.home();
  assert.equal(t.closes.length, 0, terminal + ' ends pending startup tracking');
}
t = setup(); t.event('warm.app', 'launch'); t.guard.home();
assert.equal(t.closes.length, 0, 'resuming an existing app is not a known cold startup');
t.event('app.a', 'splash'); t.guard.home(); t.event('app.a', 'launch'); t.guard.home();
assert.equal(t.closes.length, 0, 'a splash-only request is never closed later');

t = setup(); t.cold('app.a'); t.guard.home();
t.cold('app.a'); t.event('app.a', 'foreground');
assert.deepStrictEqual(t.closes, ['app.a'], 'new selection of the canceled app is allowed without another Home press');
t.guard.home(); assert.equal(t.closes.length, 1);
t.cold('app.a'); t.guard.home();
assert.equal(t.closes.length, 2, 'a later Home press can cancel a separate cold startup');

for (const preload of [{ event: 'preload' }, { reason: 'preload' }, { preload: 'full' }, { snapshot: true }]) {
  t = setup(); t.cold('app.a'); t.guard.event(Object.assign({ appId: 'app.a', event: 'launch' }, preload)); t.guard.home();
  assert.equal(t.closes.length, 0, 'preload must not become a cancellation candidate');
}
t = setup(); t.cold('com.webos.app.home'); t.guard.home();
assert.equal(t.closes.length, 0, 'Home cannot cancel itself');

t = setup(); t.cold('app.a'); t.advance(29999); t.guard.home();
assert.equal(t.closes.length, 1, 'recent startup remains eligible');
t = setup(); t.cold('app.a'); t.advance(30000); t.guard.home();
assert.equal(t.closes.length, 0, 'candidate expires at thirty seconds');
t = setup(); t.cold('app.a'); t.advance(20000); t.event('app.a', 'launch'); t.advance(10000); t.guard.home();
assert.equal(t.closes.length, 0, 'duplicate launch events do not renew the deadline');
t = setup(); t.cold('app.a'); t.advance(-1); t.guard.home();
assert.equal(t.closes.length, 0, 'backwards clock changes discard uncertain candidates');

t = setup();
for (let i = 0; i < 33; i++) { t.cold('app.' + i); t.advance(1); }
t.guard.home();
assert.equal(t.closes.length, 32, 'state and closes are bounded');
assert(!t.closes.includes('app.0'), 'oldest excess entry is evicted');

t = setup();
for (const message of [null, undefined, 'bad', [], {}, { appId: {}, event: 'splash' },
  { appId: 'bad id', event: 'splash' }, { appId: 'x'.repeat(257), event: 'splash' },
  { appId: 'bad', event: 'splash', returnValue: false }]) t.guard.event(message);
t.event('bad', 'launch'); t.guard.home(); assert.equal(t.closes.length, 0, 'malformed and failed events are inert');
t.cold('__proto__'); t.guard.home();
assert.deepStrictEqual(t.closes, ['__proto__'], 'app IDs cannot mutate object prototypes');

t = setup(); t.cold('app.a'); t.guard.reset(); t.guard.home();
assert.equal(t.closes.length, 0, 'subscription loss clears uncertain state');
t.cold('app.b'); t.guard.home(); assert.deepStrictEqual(t.closes, ['app.b'], 'reset permits new observations');
t.cold('app.c'); t.guard.stop(); t.guard.reset(); t.guard.home(); t.cold('app.d'); t.guard.home();
assert.deepStrictEqual(t.closes, ['app.b'], 'stop permanently disables processing');

let failures = 0;
const failing = createGuard({ now: () => 1, closeApp() { failures++; throw Error('failed'); } });
failing.event({ appId: 'app.a', event: 'splash' }); failing.event({ appId: 'app.a', event: 'launch' });
failing.home(); failing.home(); assert.equal(failures, 1, 'failed close is consumed without retries');

console.log('Cold startup cancellation, warm/foreground exclusions, preload, no deferred kills, expiry, bounds and cleanup passed.');
