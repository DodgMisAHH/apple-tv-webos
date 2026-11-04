// The system Home bridge must preserve playback, bound retries and own its cleanup.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const bridge = require('../tv/system-home/home.js');

assert(bridge.isPreload('{"reason":"preload"}'));
assert(bridge.isPreload({ parameters: '{"preload":"full"}' }));
assert(bridge.isPreload({ params: { snapshot: true } }));
assert(!bridge.isPreload({ parameters: { snapshot: false, reason: 'hotKey' } }));
assert(!bridge.isPreload('not JSON'));
assert.deepStrictEqual(bridge.launchParameters({ reload: true, command: 'arbitrary' }), { home: true, reload: false });
assert.deepStrictEqual(bridge.launchParameters({ parameters: JSON.stringify({ params: {
  settingsChanged: true, settingsToken: '1793545891000-2', reload: true, reloadToken: 'unsafe', systemZoomTest: true
} }) }), { home: true, reload: false, settingsChanged: true, settingsToken: '1793545891000-2' });
for (const settingsToken of ['', 'x'.repeat(129), 'bad\ntoken', 1, {}]) {
  assert.deepStrictEqual(bridge.launchParameters({ settingsChanged: true, settingsToken }), { home: true, reload: false });
}
assert.equal(bridge.readPid('0'), null);
assert.equal(bridge.readPid('42\n'), 42);
assert(!bridge.ownsCommand('/usr/bin/node\0/tmp/something.js\0', '/tmp/home.js'));
assert(!bridge.ownsCommand('/usr/bin/python\0/tmp/home.js\0', '/tmp/home.js'));
assert(bridge.ownsCommand('/usr/bin/node\0/tmp/home.js\0{}\0', '/tmp/home.js'));

const cleanups = [];
function setup({ active = true, existingPid, owner = true, alive = true, preload = false, shown = false, args } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-system-home-'));
  const paths = { state: root, active: path.join(root, 'active'), request: path.join(root, 'request.json'),
    runtime: '/home/root/lg-tv-vibehack/system-home/home.js', proc: path.join(root, 'proc') };
  if (active) fs.writeFileSync(paths.active, 'test');
  if (shown) fs.writeFileSync(path.join(root, 'shown'), 'old-runtime\n');
  fs.writeFileSync(paths.request, JSON.stringify({ appDesc: { id: 'com.webos.app.home', type: 'web', main: 'index.html',
    folderPath: '/media/developer/apps/usr/palm/applications/com.gathin.tvhome' }, instanceId: 'test-home' }));
  const proc = new EventEmitter();
  proc.pid = 12345;
  const signals = [], exits = [], timers = [], children = [], launches = [], subscriptions = [], appEvents = [], closes = [];
  proc.kill = (pid, signal) => {
    signals.push({ pid, signal });
    if (!alive && signal === 0) { const error = new Error('gone'); error.code = 'ESRCH'; throw error; }
  };
  if (existingPid) {
    fs.writeFileSync(path.join(root, 'runtime.pid'), String(existingPid) + '\n');
    fs.mkdirSync(path.join(paths.proc, String(existingPid)), { recursive: true });
    fs.writeFileSync(path.join(paths.proc, String(existingPid), 'cmdline'),
      '/usr/bin/node\0' + (owner ? paths.runtime : '/unrelated/service.js') + '\0');
  }
  function makeChild() {
    const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = { resume() {} };
    p.kill = signal => { p.killed = signal; p.emit('exit'); };
    children.push(p);
    return p;
  }
  const cp = {
    spawn(cmd, args, options) { const p = makeChild();
      (args.some(a => a.endsWith('/getAppLifeEvents')) ? appEvents : subscriptions).push({ cmd, args, options, p }); return p; },
    execFile(cmd, args, options, callback) { const p = makeChild();
      (args.some(a => a.endsWith('/closeByAppId')) ? closes : launches).push({ cmd, args, options, callback, p }); return p; }
  };
  const runtime = bridge.createRuntime({ fs, cp, process: proc, paths, now: () => 'test-time',
    setTimeout(fn, ms) { const timer = { fn, ms }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.cancelled = true; }, onExit(code) { exits.push(code); } });
  function fire(ms) {
    const ready = timers.filter(t => !t.cancelled && !t.fired && t.ms === ms);
    ready.forEach(t => { t.fired = true; t.fn(); });
  }
  function answer(index, value, error = null) {
    const call = launches[index]; call.callback(error, JSON.stringify(value)); call.p.emit('exit');
  }
  function event(index, value) { subscriptions[index].p.stdout.emit('data', JSON.stringify(value) + '\n'); }
  function appEvent(value, index = 0) { appEvents[index].p.stdout.emit('data', JSON.stringify(value) + '\n'); }
  runtime.start(args || (preload ? ['{"parameters":"{\\"snapshot\\":true}"}'] : []));
  if (appEvents.length) appEvent({ subscribed: true, returnValue: true });
  cleanups.push(() => { runtime.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  return { runtime, root, paths, proc, signals, exits, timers, children, launches, subscriptions, appEvents, closes,
    fire, answer, event, appEvent };
}

try {
  let t = setup({ active: false });
  assert.equal(t.children.length, 0, 'inactive entrypoint never launches or recursively calls stock Home');
  assert.deepStrictEqual(t.exits, [0]);

  t = setup({ preload: true, shown: true });
  assert(!fs.existsSync(path.join(t.root, 'shown')), 'a new runtime clears a previous launch acknowledgement');
  assert.equal(t.subscriptions.length, 1, 'preloaded Home registers for a later Home press');
  assert.equal(t.launches.length, 0, 'preload must not cover the current app or input');
  t.event(0, { returnValue: true, event: 'registered' });
  t.event(0, { event: 'relaunch', parameters: '{"preload":"full"}' });
  assert.equal(t.launches.length, 0, 'serialized preload relaunch stays in the background');
  t.event(0, { event: 'relaunch', parameters: '{"reason":"hotKey"}' });
  assert.equal(t.launches.length, 1, 'SAM Home relaunch opens the web UI');
  const first = JSON.parse(t.launches[0].args.at(-1));
  assert.equal(first.appDesc.id, 'com.webos.app.home');
  assert.equal(first.appDesc.folderPath, '/media/developer/apps/usr/palm/applications/com.gathin.tvhome');
  assert.deepStrictEqual(first.parameters, { home: true, reload: false });
  assert.equal(t.launches[0].options.timeout, 6500, 'Luna call cannot hang the wrapper indefinitely');
  t.runtime.lifecycle(JSON.stringify(JSON.stringify({ event: 'relaunch' })));
  assert.equal(t.launches.length, 1, 'overlapping relaunches coalesce');
  t.answer(0, { returnValue: false, errorText: 'appDesc must be a string' });
  assert.equal(t.launches.length, 2);
  assert(!fs.existsSync(path.join(t.root, 'shown')), 'rejected WAM launch cannot confirm startup');
  assert.equal(typeof JSON.parse(t.launches[1].args.at(-1)).appDesc, 'string');
  t.answer(1, { returnValue: true });
  assert(/^[0-9]+\n$/.test(fs.readFileSync(path.join(t.root, 'shown'), 'utf8')),
    'only successful WAM launch writes a timestamp for startup confirmation');
  t.runtime.lifecycle({ event: 'relaunch' });
  assert.equal(t.launches.length, 3, 'later Home press can activate an existing page');

  t = setup({ args: [JSON.stringify({ params: { settingsChanged: true, settingsToken: 'start', reload: true } })] });
  assert.deepStrictEqual(JSON.parse(t.launches[0].args.at(-1)).parameters,
    { home: true, reload: false, settingsChanged: true, settingsToken: 'start' }, 'initial launch preserves only allowed settings metadata');
  t.event(0, { event: 'relaunch', parameters: '{"settingsChanged":true,"settingsToken":"second","reload":true}' });
  t.event(0, { event: 'relaunch', params: { parameters: { settingsChanged: true, settingsToken: 'latest', systemZoomTest: true } } });
  t.event(0, { event: 'relaunch' });
  assert.equal(t.launches.length, 1, 'settings notifications wait behind the active request');
  t.answer(0, { returnValue: true });
  assert.equal(t.launches.length, 2, 'one follow-up delivers the latest pending settings');
  assert.deepStrictEqual(JSON.parse(t.launches[1].args.at(-1)).parameters,
    { home: true, reload: false, settingsChanged: true, settingsToken: 'latest' }, 'ordinary Home presses cannot discard pending settings');
  t.answer(1, { returnValue: false });
  assert.deepStrictEqual(JSON.parse(t.launches[2].args.at(-1)).parameters,
    { home: true, reload: false, settingsChanged: true, settingsToken: 'latest' }, 'descriptor fallback preserves settings notification');
  t.answer(2, { returnValue: true });
  assert.equal(t.launches.length, 3, 'superseded settings do not produce extra launches');

  t = setup({ preload: true });
  const pending = path.join(t.root, 'pending-params.json');
  fs.writeFileSync(pending, JSON.stringify({ pid: 12345, at: Date.now(), parameters: {
    settingsChanged: true, settingsToken: 'duplicate', reload: true, systemZoomTest: true
  } }));
  t.proc.emit('SIGWINCH');
  assert.deepStrictEqual(JSON.parse(t.launches[0].args.at(-1)).parameters,
    { home: true, reload: false, settingsChanged: true, settingsToken: 'duplicate' }, 'duplicate signal carries sanitized settings');
  assert(!fs.existsSync(pending), 'consumed duplicate settings file is removed');
  t.answer(0, { returnValue: true });
  fs.writeFileSync(pending, JSON.stringify({ pid: 99999, at: Date.now(), parameters: { settingsChanged: true, settingsToken: 'foreign' } }));
  t.proc.emit('SIGWINCH');
  assert.equal(t.launches.length, 1, 'foreign PID settings metadata cannot be mistaken for a Home press');
  fs.writeFileSync(pending, JSON.stringify({ pid: 12345, at: Date.now() - 11000, parameters: { settingsChanged: true, settingsToken: 'stale' } }));
  t.proc.emit('SIGWINCH');
  assert.equal(t.launches.length, 1, 'expired duplicate settings cannot be mistaken for a Home press');
  t.proc.emit('SIGWINCH');
  assert.equal(t.launches.length, 1, 'missing duplicate settings cannot be mistaken for a Home press');

  t = setup({ preload: true });
  t.event(0, { returnValue: false, errorText: 'Unknown method' });
  assert(t.subscriptions[0].p.killed, 'failed registration subprocess is cleaned up');
  t.fire(250);
  assert(t.subscriptions[1].args.some(a => a.endsWith('/registerNativeApp')));
  t.fire(8000); t.fire(250); t.fire(8000); t.fire(250);
  assert.equal(t.subscriptions.length, 2, 'registration fallback is bounded');
  assert.equal(t.launches.length, 0, 'registration retries cannot steal foreground');

  t = setup();
  t.launches[0].callback(null, JSON.stringify({ appId: 'com.webos.app.home', procId: '1234', returnValue: true }, null, 2));
  assert.equal(t.launches.length, 1, 'pretty-printed WAM success must not trigger a redundant launch');
  assert(fs.existsSync(path.join(t.root, 'shown')), 'pretty-printed WAM success acknowledges startup');
  t.runtime.lifecycle({ event: 'relaunch' });
  t.launches[1].callback(null, JSON.stringify({ returnValue: false, errorText: 'appDesc must be a string' }, null, 2));
  assert.equal(t.launches.length, 3, 'pretty-printed WAM error takes the descriptor fallback');
  assert(fs.readFileSync(path.join(t.root, 'runtime.log'), 'utf8').includes('appDesc must be a string'));
  t.launches[2].callback(null, 'diagnostic before response\n' + JSON.stringify({ returnValue: true }));
  assert.equal(t.launches.length, 3, 'single-line response after diagnostics remains supported');

  t = setup();
  for (let round = 0; round < 3; round++) {
    t.answer(round * 2, { returnValue: false });
    t.answer(round * 2 + 1, { returnValue: false });
    t.fire(750);
  }
  assert.equal(t.launches.length, 6, 'only three bounded object/string request pairs');
  t.fire(750);
  assert.equal(t.launches.length, 6);

  t = setup();
  t.answer(0, { returnValue: true });
  t.appEvent({ event: 'splash', appId: 'youtube.leanback.v4', showSplash: true, returnValue: true });
  t.appEvent({ event: 'launch', appId: 'youtube.leanback.v4', reason: 'undefined', returnValue: true });
  t.proc.emit('SIGWINCH');
  assert.equal(t.closes.length, 0, 'missing settings metadata never turns into Home cancellation');
  t.event(0, { event: 'relaunch', parameters: '{"settingsChanged":true,"settingsToken":""}' });
  assert.equal(t.closes.length, 0, 'malformed settings notification is still not Home intent');
  t.answer(1, { returnValue: true });
  t.event(0, { event: 'relaunch', parameters: '{"settingsChanged":true,"settingsToken":"settings"}' });
  assert.equal(t.closes.length, 0, 'settings publication cannot cancel an app startup');
  t.answer(2, { returnValue: true });
  t.event(0, { event: 'relaunch', parameters: '{"preload":"full"}' });
  assert.equal(t.closes.length, 0, 'Home preload cannot cancel an app startup');
  t.event(0, { event: 'relaunch', parameters: '{"reason":"hotKey"}' });
  assert.equal(t.closes.length, 1, 'explicit Home cancels the observed pending app exactly once');
  assert.deepStrictEqual(JSON.parse(t.closes[0].args.at(-1)), { id: 'youtube.leanback.v4' });
  assert.equal(t.closes[0].options.timeout, 4500);
  t.closes[0].callback(null, '{"returnValue":false}');
  t.proc.emit('SIGUSR2'); t.fire(1000); t.fire(750);
  assert.equal(t.closes.length, 1, 'close errors, duplicate Home and timers cannot schedule a later kill');
  t.answer(3, { returnValue: true });
  t.appEvent({ event: 'splash', appId: 'youtube.leanback.v4', showSplash: true });
  t.appEvent({ event: 'launch', appId: 'youtube.leanback.v4' });
  t.appEvent({ event: 'foreground', appId: 'youtube.leanback.v4' });
  t.event(0, { event: 'relaunch' });
  assert.equal(t.closes.length, 1, 'Home leaves a successfully opened app running');

  t = setup();
  t.answer(0, { returnValue: true });
  t.appEvent({ event: 'splash', appId: 'youtube.leanback.v4', showSplash: true });
  t.appEvent({ event: 'launch', appId: 'youtube.leanback.v4' });
  t.appEvents[0].p.emit('exit');
  t.event(0, { event: 'relaunch' });
  assert.equal(t.closes.length, 0, 'lost observation discards stale cancellation candidates');
  t.fire(1000);
  assert.equal(t.appEvents.length, 2, 'event observation reconnects without relaunching other apps');
  t.appEvent({ returnValue: false }, 1); t.fire(2000);
  t.appEvent({ returnValue: false }, 2); t.fire(3000);
  assert.equal(t.appEvents.length, 3, 'failed lifecycle observation retries are bounded');

  t = setup();
  const owned = t.children.slice();
  t.event(0, { event: 'close' });
  assert.deepStrictEqual(t.exits, [0]);
  assert(owned.every(p => p.killed === 'SIGTERM'), 'close kills only children spawned by this runtime');
  assert(!fs.existsSync(path.join(t.root, 'runtime.pid')), 'owned PID claim is removed');
  const count = t.children.length; t.fire(750); t.fire(250); t.fire(1000);
  assert.equal(t.children.length, count, 'cleanup cancels launch and registration retries');
  assert.equal(t.signals.length, 0, 'cleanup does not issue process-wide kill commands');

  t = setup();
  fs.unlinkSync(t.paths.active); t.fire(1000);
  assert.deepStrictEqual(t.exits, [0], 'removing activation ends runtime even with no further lifecycle event');

  t = setup({ existingPid: 22222, shown: true });
  assert.deepStrictEqual(t.signals, [{ pid: 22222, signal: 0 }, { pid: 22222, signal: 'SIGUSR2' }]);
  assert.equal(t.children.length, 0, 'duplicate delegates to verified existing runtime');
  assert.equal(fs.readFileSync(path.join(t.root, 'runtime.pid'), 'utf8').trim(), '22222');
  assert.equal(fs.readFileSync(path.join(t.root, 'shown'), 'utf8'), 'old-runtime\n', 'duplicate preserves live runtime acknowledgement');
  t = setup({ existingPid: 22222, args: [JSON.stringify({ parameters: {
    settingsChanged: true, settingsToken: 'duplicate-start', reload: true
  } })] });
  const forwarded = JSON.parse(fs.readFileSync(path.join(t.root, 'pending-params.json'), 'utf8'));
  assert.equal(t.signals.at(-1).signal, 'SIGWINCH', 'settings duplicate uses a distinct signal from Home intent');
  assert.equal(forwarded.pid, 22222);
  assert.deepStrictEqual(forwarded.parameters,
    { home: true, reload: false, settingsChanged: true, settingsToken: 'duplicate-start' }, 'duplicate start forwards settings to verified owner');
  t = setup({ existingPid: 22222, preload: true });
  assert.deepStrictEqual(t.signals, [{ pid: 22222, signal: 0 }], 'duplicate preload must not activate existing Home');
  t = setup({ existingPid: 22222, owner: false });
  assert.deepStrictEqual(t.signals, [{ pid: 22222, signal: 0 }], 'reused PID belonging to another program is never signalled');
  t = setup({ existingPid: 22222, alive: false });
  assert.equal(fs.readFileSync(path.join(t.root, 'runtime.pid'), 'utf8').trim(), '12345', 'stale dead PID can be reclaimed');
  fs.writeFileSync(path.join(t.root, 'runtime.pid'), '33333\n');
  t.runtime.stop();
  assert.equal(fs.readFileSync(path.join(t.root, 'runtime.pid'), 'utf8').trim(), '33333', 'cleanup preserves a replaced PID claim');
  console.log('System Home preload, lifecycle, WAM fallback, bounded retries and PID ownership checks passed.');
} finally {
  cleanups.forEach(fn => fn());
}
