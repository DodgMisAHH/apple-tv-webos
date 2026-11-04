// Exercise marker transitions without a TV or writing the real runtime marker.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const {EventEmitter} = require('events'), {spawnSync} = require('child_process');
const root = path.resolve(__dirname, '..'), marker = '/tmp/lg-tv-system-home.active';
const read = name => fs.readFileSync(path.join(root, 'tv', name), 'utf8');

function watcher(active = false, boot = false) {
  const calls = [], children = [], timers = [], state = {active};
  const processStub = new EventEmitter();
  processStub.env = boot ? {LG_LAUNCHER_BOOT:'1'} : {};
  processStub.exit = () => {};
  function child() {
    const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = {resume(){}};
    p.kill = () => {}; children.push(p); return p;
  }
  const cp = {
    spawn(cmd, args) {const p = child(); p.uri = args[1]; return p;},
    execFile(cmd, args, options, callback) {const p = child(); calls.push({cmd, args, options, callback}); return p;}
  };
  const context = {Date, process:processStub, console:{log(){}},
    require(name) {
      if (name === 'child_process') return cp;
      if (name === 'fs') return {existsSync(file) {assert.equal(file, marker); return state.active;}};
      throw new Error('Unexpected dependency: ' + name);
    },
    setTimeout(fn, ms) {const t = {fn, ms}; timers.push(t); return t;},
    clearTimeout(t) {if (t) t.cancelled = true;}
  };
  vm.createContext(context); vm.runInContext(read('homewatch.js'), context);
  function report(endpoint, payload) {
    children.find(p => p.uri && p.uri.includes(endpoint)).stdout.emit('data', JSON.stringify(payload) + '\n');
  }
  return {state, calls, context,
    foreground(appId) {report('getForegroundAppInfo', {appId});},
    power(value) {report('getPowerState', {state:value});},
    appAdded() {report('listLaunchPoints', {change:'added', id:'test.app'});},
    launches() {return calls.filter(c => c.cmd === 'luna-send');},
    fire(ms) {timers.filter(t => !t.fired && !t.cancelled && t.ms === ms).forEach(t => {t.fired = true; t.fn();});}
  };
}

let w = watcher(true, true);
w.foreground('netflix'); w.fire(1500); w.foreground('com.webos.app.home'); w.fire(0);
w.power('Suspend'); w.power('Active'); w.foreground('com.webos.app.home'); w.fire(0);
assert.equal(w.launches().length, 0, 'system Home suppresses startup, foreground and wake redirects');
w.appAdded();
assert.equal(w.calls.length, 1, 'app inventory still updates during system Home mode');
assert.equal(w.calls[0].args[0], '/home/root/lg-tv-vibehack/sync.js');
w.calls[0].callback(null, 'synced', '');
w.state.active = false; w.foreground('com.webos.app.home'); w.fire(0);
assert.equal(w.launches().length, 1, 'rollback restores redirection even if the foreground ID is unchanged');
assert.equal(JSON.parse(w.launches()[0].args.at(-1)).id, 'com.gathin.tvhome');

w = watcher(); w.foreground('com.webos.app.home'); w.state.active = true; w.fire(0);
assert.equal(w.launches().length, 0, 'activation cancels an already queued Home redirect');
w.state.active = false; w.foreground('com.webos.app.home'); w.fire(0);
assert.equal(w.launches().length, 1, 'an observed activation leaves fallback available after rollback');

w = watcher(false, true); w.foreground('netflix'); w.state.active = true; w.fire(1500);
assert.equal(w.launches().length, 0, 'activation cancels an already queued delayed startup');
w = watcher(); w.power('Suspend'); w.power('Active');
assert.equal(w.launches().length, 1, 'legacy wake still launches');
w.launches()[0].callback(new Error('not ready'), ''); w.state.active = true; w.fire(750);
assert.equal(w.launches().length, 1, 'activation suppresses an already queued wake retry');
w.state.active = false; w.power('Suspend'); w.power('Active');
assert.equal(w.launches().length, 2, 'legacy wake works after rollback');
w = watcher(false, true); w.foreground('netflix'); w.fire(1500);
assert.equal(w.launches().length, 1, 'legacy delayed startup remains available');

// Run the settings-completion path with an injected filesystem and inert server.
const notifications = [], state = {active:false};
const fakeFs = {
  existsSync(file) {assert.equal(file, marker); return state.active;},
  readFileSync(file) {
    if (file.endsWith('/.wallpaper-key')) return '0123456789ab';
    if (file.endsWith('/settings.json')) return '{}';
    if (file.endsWith('/settings-published.json')) return '{}';
    throw new Error('Unexpected file read: ' + file);
  }
};
const server = {on(){return this;}, listen(){return this;}};
const wall = {Buffer, console:{log(){}}, process:{exit(){}}, setTimeout(){},
  require(name) {
    if (name === 'fs') return fakeFs;
    if (name === 'http') return {createServer(){return server;}};
    if (name === 'os') return {networkInterfaces(){return {};}};
    if (name === './publication') return {data:'/fixture/data', app:'/fixture/original-app', atomicWrite(){}};
    if (name === 'child_process') return {execFile(cmd, args, options, callback) {
      if (cmd === '/usr/bin/node') callback(null, '', '');
      else notifications.push({cmd, args});
    }};
    return require(name);
  }
};
vm.createContext(wall); vm.runInContext(read('wallpaper-server.js'), wall);
for (const [active, expected] of [[false, 'com.gathin.tvhome'], [true, 'com.webos.app.home'], [false, 'com.gathin.tvhome']]) {
  state.active = active; wall.syncCallbacks.push(() => {}); wall.runSettingsSync();
  const payload = JSON.parse(notifications.at(-1).args.at(-1));
  assert.equal(payload.id, expected, 'settings notification follows the current runtime mode');
  assert(payload.params.settingsChanged && payload.params.reload);
  assert.equal(payload.params.settingsToken, payload.params.reloadToken);
  assert.equal(wall.APP_DIR, '/fixture/original-app', 'both identities use one publication destination');
}

// Substitute only the marker path and command locations in isolated shell copies.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-system-home-'));
try {
  const testMarker = path.join(dir, 'active'), callFile = path.join(dir, 'calls');
  const shellMarker = "'" + testMarker.replace(/'/g, "'\\''") + "'";
  fs.writeFileSync(path.join(dir, 'early.sh'), read('early-launch.sh')
    .replace('export PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH', '').replaceAll(marker, shellMarker));
  fs.writeFileSync(path.join(dir, 'home.sh'), read('golauncher.sh')
    .replace('/usr/bin/luna-send', 'luna-send').replaceAll(marker, shellMarker));
  fs.writeFileSync(path.join(dir, 'luna-send'), `#!/bin/sh
for arg do payload=$arg; done
printf '%s\n' "$payload" >> "$CALL_FILE"
if [ "$ACTIVATE_AFTER_FAILURE" = 1 ]; then
  : > "$TEST_MARKER"
  echo '{"returnValue":false}'
else
  echo '{"returnValue":true}'
fi
`, {mode:0o755});
  fs.writeFileSync(path.join(dir, 'sleep'), '#!/bin/sh\nexit 0\n', {mode:0o755});
  function run(script, active, fail) {
    fs.rmSync(callFile, {force:true}); fs.rmSync(testMarker, {force:true});
    if (active) fs.writeFileSync(testMarker, '');
    const result = spawnSync('/bin/sh', [path.join(dir, script)], {encoding:'utf8', env:{...process.env,
      PATH:dir + ':' + process.env.PATH, CALL_FILE:callFile, TEST_MARKER:testMarker, ACTIVATE_AFTER_FAILURE:fail ? '1' : '0'}});
    assert.equal(result.status, 0, result.stderr);
    return fs.existsSync(callFile) ? fs.readFileSync(callFile, 'utf8').trim().split('\n').map(JSON.parse) : [];
  }
  assert.equal(run('early.sh', true).length, 0, 'early launch exits successfully while system Home is active');
  assert.equal(run('early.sh', false)[0].id, 'com.gathin.tvhome', 'early launch preserves its legacy target');
  assert.equal(run('early.sh', false, true).length, 1, 'early launch stops before retrying after activation');
  for (const [active, expected] of [[false, 'com.gathin.tvhome'], [true, 'com.webos.app.home'], [false, 'com.gathin.tvhome']]) {
    const payload = run('home.sh', active)[0];
    assert.equal(payload.id, expected);
    assert.deepEqual(payload.params, {home:true, reload:false});
  }
} finally {fs.rmSync(dir, {recursive:true, force:true});}
console.log('System Home marker activation/rollback, inventory continuity, settings targeting and shell fallbacks passed.');
