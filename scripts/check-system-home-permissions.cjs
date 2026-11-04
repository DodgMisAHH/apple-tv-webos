// Exercise reversible LS2 ownership without contacting a TV or reloading the host bus.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const permission = require('../tv/system-home/permissions.js');
const roots = [];
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-home-role-')); roots.push(root);
  const base = path.join(root, 'run', 'ls2'), manifests = path.join(root, 'manifests');
  fs.mkdirSync(manifests);
  const native = path.join(root, 'stock-home.role.json'); fs.writeFileSync(native, 'original native role');
  const paths = { base, role: path.join(base, 'home.role.json'), permission: path.join(base, 'home.perm.json'), api: path.join(base, 'wifi.api.json'),
    manifest: path.join(manifests, permission.manifestId + '.json'), owner: path.join(base, 'ownership.json') };
  let scans = 0, scanError = null;
  const changes = [], fileSystem = Object.create(fs);
  let hook = () => {};
  function create() { return permission.createManager({ paths, fs: fileSystem, change(action, manifest, cb) {
    scans++; changes.push({ action, manifest }); hook(action); cb(scanError, 'policy complete');
  } }); }
  let manager = create();
  function run(action) {
    let result;
    manager[action]((error, current) => { result = { error, current }; });
    return result;
  }
  return { root, paths, native, manager, run, changes, fileSystem, scans: () => scans, failScan(value) { scanError = value; },
    beforeChange(value) { hook = value; }, restart() { manager = create(); this.manager = manager; } };
}
try {
  for (const key of ['base', 'role', 'permission', 'api', 'manifest', 'owner']) {
    assert(permission.defaultPaths()[key].startsWith('/tmp/lg-tv-system-home/'), 'every live policy file is cleared by reboot');
  }
  let t = setup();
  assert(!t.manager.status().owned);
  let result = t.run('install'); assert.ifError(result.error);
  const manifest = JSON.parse(fs.readFileSync(t.paths.manifest, 'utf8'));
  assert.equal(manifest.id, permission.manifestId);
  assert.notEqual(manifest.id, 'com.webos.app.home', 'manifest ID cannot replace LG native manifest');
  assert.deepStrictEqual(manifest.roleFiles, [t.paths.role]);
  assert.deepStrictEqual(manifest.apiPermissionFiles, [t.paths.api]);
  const role = JSON.parse(fs.readFileSync(t.paths.role, 'utf8'));
  assert.deepStrictEqual(role, { appId: 'com.webos.app.home', type: 'regular', trustLevel: '',
    allowedNames: ['com.webos.app.home-*'], permissions: [{ service: 'com.webos.app.home-*', outbound: ['*'] }] });
  const clients = JSON.parse(fs.readFileSync(t.paths.permission, 'utf8'));
  assert.deepStrictEqual(clients, { 'com.webos.app.home-*': ['public', permission.wifiGroup],
    'com.gathin.tvhome-*': [permission.wifiGroup], 'com.gathin.tvcontrolcentre-*': [permission.wifiGroup] });
  const api = JSON.parse(fs.readFileSync(t.paths.api, 'utf8'));
  assert.deepStrictEqual(api, { [permission.wifiGroup]: ['com.webos.service.wifi/connect', 'com.webos.service.wifi/getprofilelist'] });
  assert(!JSON.stringify(clients).includes('private') && !JSON.stringify(clients).includes('networking'), 'no broad networking/private group');
  function granted(name, uri) {
    return Object.entries(clients).some(([pattern, groups]) => name.startsWith(pattern.slice(0, -1)) &&
      groups.some(group => api[group] && api[group].includes(uri)));
  }
  for (const client of ['com.webos.app.home-1', 'com.gathin.tvhome-2', 'com.gathin.tvcontrolcentre-3']) {
    for (const method of api[permission.wifiGroup]) assert(granted(client, method));
    for (const method of ['deleteprofile', 'setstate', 'getprofile', 'scan', 'p2p/connect']) {
      assert(!granted(client, 'com.webos.service.wifi/' + method), 'custom group grants only the two requested methods');
    }
  }
  for (const other of ['com.webos.app.browser-1', 'com.gathin.other-1', 'com.webos.app.homeevil-1', 'com.gathin.tvhomeevil-1',
    'com.gathin.tvcontrolcentreevil-1', 'com.webos.app.home', '/usr/bin/WebAppMgr']) {
    assert(!granted(other, 'com.webos.service.wifi/connect'), 'no grant to unrelated/nonsuffixed names: ' + other);
  }
  assert.equal(result.current.policy, 'complete');
  assert.deepStrictEqual(t.changes[0], { action: 'add', manifest: t.paths.manifest });
  assert.equal(fs.readFileSync(t.native, 'utf8'), 'original native role');
  assert.ifError(t.run('install').error, 'installation is repeatable for exact owned files');
  result = t.run('remove'); assert.ifError(result.error);
  assert(!result.current.owned);
  for (const key of ['role', 'permission', 'api', 'manifest', 'owner']) assert(!fs.existsSync(t.paths[key]));
  assert.equal(fs.readFileSync(t.native, 'utf8'), 'original native role');
  const scans = t.scans(); assert.ifError(t.run('remove').error);
  assert.equal(t.scans(), scans, 'already-removed policy does not trigger unnecessary bus call');

  t = setup(); assert.ifError(t.run('install').error);
  t.failScan(new Error('scan timeout'));
  result = t.run('remove'); assert(result.error);
  assert(fs.existsSync(t.paths.manifest), 'manifest remains until explicit removal is acknowledged');
  assert(fs.existsSync(t.paths.role) && fs.existsSync(t.paths.permission), 'referenced files retained for recovery until removal succeeds');
  assert.equal(result.current.intent, 'remove'); assert.equal(result.current.policy, 'pending');
  t.failScan(null); result = t.run('remove'); assert.ifError(result.error);
  assert(!result.current.owned, 'removal retry explicitly asks the bus to unload the owned manifest');
  assert.equal(t.changes.at(-1).action, 'remove');

  t = setup(); t.failScan(new Error('scan timeout'));
  result = t.run('install'); assert(result.error);
  assert.equal(result.current.intent, 'install'); assert.equal(result.current.policy, 'pending');
  assert(fs.existsSync(t.paths.manifest), 'failed installation scan retains owned files for explicit rollback');
  t.failScan(null); assert.ifError(t.run('remove').error);

  t = setup(); assert.ifError(t.run('install').error);
  fs.writeFileSync(t.paths.role, 'changed by someone else');
  const before = t.scans(); result = t.run('remove'); assert(result.error);
  assert(fs.existsSync(t.paths.manifest), 'foreign role modification aborts removal before changing manifest');
  assert.equal(fs.readFileSync(t.paths.role, 'utf8'), 'changed by someone else');
  assert.equal(t.scans(), before);

  t = setup(); fs.mkdirSync(t.paths.base, { recursive: true });
  fs.writeFileSync(t.paths.manifest, permission.expectedFiles(t.paths).manifest);
  result = t.run('install'); assert(result.error, 'matching files without our ownership marker are not adopted');
  assert.equal(t.scans(), 0);
  t = setup(); fs.mkdirSync(path.dirname(t.paths.base), { recursive: true });
  fs.symlinkSync(path.dirname(t.paths.base), t.paths.base);
  result = t.run('install'); assert(result.error, 'symlinked state directory is refused');

  function seedLegacy(fixture, names = ['role', 'permission', 'manifest'], intent = 'install', policy = 'complete') {
    fs.mkdirSync(fixture.paths.base, { recursive: true });
    const old = permission.expectedFiles(fixture.paths, 1);
    for (const name of names) fs.writeFileSync(fixture.paths[name], old[name]);
    fs.writeFileSync(fixture.paths.owner, JSON.stringify({ id: permission.manifestId, version: 1, intent, policy }, null, 2) + '\n');
    return old;
  }
  t = setup();
  let old = seedLegacy(t);
  assert.equal(t.manager.status().revision, 1, 'legacy public-only ownership is recognized without adopting foreign files');
  t.beforeChange(action => {
    if (action === 'remove') {
      for (const key of Object.keys(old)) assert.equal(fs.readFileSync(t.paths[key], 'utf8'), old[key], 'unload old cached policy before rewriting');
      assert(!fs.existsSync(t.paths.api));
    } else {
      const expected = permission.expectedFiles(t.paths);
      for (const key of Object.keys(expected)) assert.equal(fs.readFileSync(t.paths[key], 'utf8'), expected[key]);
    }
  });
  result = t.run('install'); assert.ifError(result.error);
  assert.deepEqual(t.changes.map(change => change.action), ['remove', 'add']);
  assert.equal(result.current.revision, 2); assert.equal(result.current.policy, 'complete');
  assert.equal(fs.readFileSync(t.native, 'utf8'), 'original native role');
  assert.equal(fs.readFileSync(t.paths.role, 'utf8'), old.role, 'upgrade leaves the appId-bound Home role unchanged');
  t.beforeChange(() => {}); assert.ifError(t.run('remove').error);

  t = setup(); old = seedLegacy(t); t.failScan(new Error('unload timeout'));
  result = t.run('install'); assert(result.error); assert.equal(result.current.revision, 1);
  for (const key of Object.keys(old)) assert.equal(fs.readFileSync(t.paths[key], 'utf8'), old[key]);
  assert(!fs.existsSync(t.paths.api)); assert.deepEqual(t.changes.map(change => change.action), ['remove']);
  t.failScan(null); t.restart(); assert.ifError(t.run('install').error);
  assert.deepEqual(t.changes.map(change => change.action), ['remove', 'remove', 'add'], 'startup retries an unacknowledged old-policy removal');

  t = setup(); seedLegacy(t, ['role'], 'install', 'pending');
  assert.ifError(t.run('install').error, 'an interrupted public-only initial install upgrades safely');
  assert.equal(t.manager.status().revision, 2);
  t = setup(); seedLegacy(t, ['role', 'permission', 'manifest'], 'remove', 'pending');
  result = t.run('remove'); assert.ifError(result.error); assert(!result.current.owned, 'legacy rollback remains supported without upgrading');

  // Interrupt each atomic policy replacement after rename. The old manifest was
  // unloaded already, and ownership records exactly which two revisions are safe.
  for (const target of ['permission', 'api', 'manifest']) for (const recovery of ['install', 'remove']) {
    t = setup(); seedLegacy(t);
    let interrupted = false;
    t.fileSystem.renameSync = (source, destination) => {
      fs.renameSync(source, destination);
      if (!interrupted && destination === t.paths[target]) { interrupted = true; throw new Error('simulated restart after ' + target); }
    };
    result = t.run('install'); assert(result.error); assert(result.current.upgrading);
    assert.deepEqual(t.changes.map(change => change.action), ['remove'], 'never add a half-published policy');
    delete t.fileSystem.renameSync; t.restart();
    result = t.run(recovery); assert.ifError(result.error, target + ' interrupted upgrade can ' + recovery);
    if (recovery === 'install') {
      assert.equal(result.current.revision, 2); assert.equal(result.current.policy, 'complete'); assert(!result.current.upgrading);
      assert.deepEqual(t.changes.map(change => change.action), ['remove', 'add']);
    } else {
      assert(!result.current.owned);
      for (const key of ['role', 'permission', 'api', 'manifest', 'owner']) assert(!fs.existsSync(t.paths[key]));
    }
  }

  t = setup(); seedLegacy(t);
  t.beforeChange(action => { if (action === 'add') t.failScan(new Error('add timeout')); });
  result = t.run('install'); assert(result.error); assert.equal(result.current.revision, 2); assert(!result.current.upgrading);
  for (const key of ['role', 'permission', 'api', 'manifest']) assert(fs.existsSync(t.paths[key]), 'new policy files remain available for retry/rollback');
  t.beforeChange(() => {}); t.failScan(null); t.restart(); assert.ifError(t.run('install').error);
  assert.deepEqual(t.changes.map(change => change.action), ['remove', 'add', 'add'], 'uncertain add retries only the fully published new revision');

  t = setup(); seedLegacy(t); fs.writeFileSync(t.paths.api, 'foreign API policy');
  result = t.run('install'); assert(result.error); assert.equal(t.scans(), 0);
  assert.equal(fs.readFileSync(t.paths.api, 'utf8'), 'foreign API policy', 'legacy marker cannot claim a preexisting API file');
  t = setup(); assert.ifError(t.run('install').error); fs.writeFileSync(t.paths.api, '{"foreign":["*"]}');
  const callsBefore = t.scans(); result = t.run('remove'); assert(result.error); assert.equal(t.scans(), callsBefore);
  assert.equal(fs.readFileSync(t.paths.api, 'utf8'), '{"foreign":["*"]}', 'foreign modifications never get removed or loaded');
  t = setup(); fs.mkdirSync(t.paths.base, { recursive: true });
  const foreignTemporary = t.paths.owner + '.tmp-' + process.pid + '-1'; fs.writeFileSync(foreignTemporary, 'foreign temporary file');
  result = t.run('install'); assert(result.error); assert.equal(fs.readFileSync(foreignTemporary, 'utf8'), 'foreign temporary file');

  function callPolicy(action, answer, error = null) {
    const calls = [], results = [], manifest = '/tmp/lg-tv-system-home/ls2/test.manifest.json';
    permission.changePolicy(action, manifest, (error, output) => results.push({ error, output }), {
      cp: { execFile(cmd, args, options, callback) { calls.push({ cmd, args, options }); callback(error, answer, ''); } }
    });
    return { calls, results, manifest };
  }
  let s = callPolicy('add', JSON.stringify({ returnValue: true }, null, 2));
  assert.ifError(s.results[0].error);
  assert(s.calls[0].args.includes('luna://com.webos.service.bus/addOneManifest'));
  assert.deepStrictEqual(JSON.parse(s.calls[0].args.at(-1)), { prefix: '', path: s.manifest });
  assert.equal(s.calls[0].options.timeout, 6500, 'policy change cannot hang rollback');
  assert.equal(s.calls[0].options.maxBuffer, 16384);
  s = callPolicy('remove', '{"returnValue":true}'); assert.ifError(s.results[0].error);
  assert(s.calls[0].args.includes('luna://com.webos.service.bus/removeOneManifest'));
  s = callPolicy('add', JSON.stringify({ returnValue: false, errorCode: -1,
    errorText: 'Skipping already loaded manifest </tmp/lg-tv-system-home/ls2/test.manifest.json>' }));
  assert.ifError(s.results[0].error, 'only exact owned-path already-loaded response makes add idempotent');
  s = callPolicy('add', JSON.stringify({ returnValue: false, errorCode: -1, errorText: 'Skipping already loaded manifest </foreign.json>' }));
  assert(s.results[0].error);
  s = callPolicy('add', '{"returnValue":false,"errorText":"Cannot open "/bad.json""}');
  assert(s.results[0].error, 'malformed firmware error JSON cannot become success');
  s = callPolicy('remove', '', new Error('timeout')); assert(s.results[0].error);
  console.log('System Home LS2 exact Wi-Fi scope, native-role isolation, legacy upgrades, interrupted publication/rollback and bounded API checks passed.');
} finally {
  roots.forEach(root => fs.rmSync(root, { recursive: true, force: true }));
}
