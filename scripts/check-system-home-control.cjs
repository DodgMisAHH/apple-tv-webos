// Execute the real controller/state code against isolated files and inert TV commands.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const {spawnSync} = require('child_process');
const sourceDir = path.resolve(__dirname, '../tv/system-home');
const controlSource = fs.readFileSync(path.join(sourceDir, 'control.sh'), 'utf8');
const stateSource = fs.readFileSync(path.join(sourceDir, 'state.js'), 'utf8');
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const fixtures = [];
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-home-control-'));
  const f = {dir, base:dir + '/data/system-home', run:dir + '/run', active:dir + '/active',
    app:dir + '/app', key:dir + '/config/keybinds.json', target:dir + '/system/home',
    manifest:dir + '/system/appinfo.json', init:dir + '/init/home', bin:dir + '/bin',
    proc:dir + '/proc', trace:dir + '/trace', stock:dir + '/stock'};
  fixtures.push(f);
  for (const p of [f.base, f.run, f.app, path.dirname(f.key), path.dirname(f.target), path.dirname(f.init), f.bin, f.proc])
    fs.mkdirSync(p, {recursive:true});
  const stock = 'fixture stock home executable\n', manifest = '{"id":"com.webos.app.home","type":"native"}\n';
  fs.writeFileSync(f.stock, stock); fs.writeFileSync(f.target, stock); fs.writeFileSync(f.manifest, manifest);
  fs.writeFileSync(f.base + '/entrypoint.sh', '#!/bin/sh\nexit 0\n', {mode:0o755});
  fs.writeFileSync(f.base + '/home.js', '// fixture runtime\n');
  fs.writeFileSync(f.base + '/startup-guard.js', '// fixture startup guard\n');
  fs.writeFileSync(f.base + '/startup.sh', '#!/bin/sh\n# fixture owned startup\n');
  fs.writeFileSync(f.app + '/appinfo.json', JSON.stringify({id:'com.gathin.tvhome', type:'web', version:'1.2.31', main:'index.html'}));
  fs.writeFileSync(f.app + '/index.html', '<!doctype html>');
  f.ownKey = {action:'exec', command:dir + '/data/golauncher.sh'};
  f.originalKeys = {'773':f.ownKey, '404':{action:'key', key:9}};
  fs.writeFileSync(f.key, JSON.stringify(f.originalKeys));
  const replacements = [
    ['/usr/palm/applications/com.webos.app.home/appinfo.json', f.manifest],
    ['/media/developer/apps/usr/palm/applications/com.gathin.tvhome', f.app],
    ['/home/root/.config/lginputhook/keybinds.json', f.key],
    ['/var/lib/webosbrew/init.d/00-lg-tv-system-home', f.init],
    ['/home/root/lg-tv-vibehack', dir + '/data'],
    ['/tmp/lg-tv-system-home.active', f.active], ['/tmp/lg-tv-system-home', f.run],
    ['/usr/sbin/ls-monitor', f.bin + '/ls-monitor'],
    ['/usr/bin/com.webos.app.home', f.target], ['/proc/', f.proc + '/']
  ];
  function rewrite(text) {for (const [from, to] of replacements) text = text.split(from).join(to); return text;}
  // Controller signal delivery is recorded. The interruption case only signals its own fixture shell.
  const inertKill = `kill() {
  if [ "$1" = "-0" ]; then
    # The fixture shortens sleep to 100 ms. Model the deliberately failed guard
    # deterministically instead of racing Node startup or a child zombie's reap.
    if [ "\${FAIL_GUARD:-0}" = 1 ] && [ -f "$FIXTURE_RUN/guard.pid" ] &&
       [ "$2" = "$(cat "$FIXTURE_RUN/guard.pid")" ]; then return 1; fi
    case "$2" in 444444) return 0;; 555555|999999) return 1;; esac
    command kill "$@"
  else
    printf 'kill %s\\n' "$*" >> "$FIXTURE_TRACE"
  fi
}
`;
  let control = rewrite(controlSource).replace('export PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH', inertKill)
    .replace(/^HASH=.*$/m, 'HASH=' + digest(stock)).replace(/^MANIFEST_HASH=.*$/m, 'MANIFEST_HASH=' + digest(manifest));
  control = control.replace(/(trap '[^\n]+' HUP INT TERM)/, match =>
    match + '\n  if [ "${INTERRUPT_BEFORE_MOUNT:-0}" = 1 ]; then command kill -TERM "$$"; fi');
  fs.writeFileSync(f.base + '/control.sh', control);
  fs.writeFileSync(f.base + '/state.js', rewrite(stateSource));
  fs.writeFileSync(f.base + '/permissions.js', `const fs=require('fs'),env=process.env,mode=process.argv[2];
fs.appendFileSync(env.FIXTURE_TRACE,'permission '+mode+'\\n');
const installed=env.FIXTURE_RUN+'/permissions-installed';
if(mode==='install'){
  if(env.FAIL_PERMISSIONS_INSTALL==='1')process.exit(1);
  fs.writeFileSync(installed,'owned role');
}else if(mode==='remove'){
  if(env.FAIL_PERMISSIONS_REMOVE==='1')process.exit(1);
  fs.rmSync(installed,{force:true});
}else if(mode!=='status')throw Error('Unexpected permission operation');
`);
  function command(name, body) {fs.writeFileSync(f.bin + '/' + name, '#!' + process.execPath + '\n' + body, {mode:0o755});}
  const prelude = `const fs=require('fs');const args=process.argv.slice(2),env=process.env;
function trace(s){fs.appendFileSync(env.FIXTURE_TRACE,s+'\\n');}
`;
  command('id', "process.stdout.write('0\\n');");
  command('flock', prelude + "trace('lock');process.exit(env.FAIL_LOCK==='1'?1:0);");
  command('timeout', prelude + `
if(args.length!==4||args[0]!=='-t'||args[1]!=='5'||args[2]!==env.FIXTURE_MONITOR||args[3]!=='-l')
  throw Error('bus query must use verified BusyBox argv: -t 5 /usr/sbin/ls-monitor -l');
if(env.BUS_TIMEOUT==='1')process.exit(124);
const result=require('child_process').spawnSync(args[2],args.slice(3),{encoding:'utf8',env});
process.stdout.write(result.stdout||'');process.exit(result.status===null?1:result.status);
`);
  command('ls-monitor', prelude + `trace('bus');
const rows={
  native:'4330 com.webos.app.home /usr/bin/com.webos.app.home static native',
  legacy:'1991 com.gathin.tvhome-4447 /usr/bin/WebAppMgr unknown/client legacy',
  home:'1991 com.webos.app.home-4447 /usr/bin/WebAppMgr unknown/client home',
  suffix:'1991 com.webos.app.home-4447extra /usr/bin/WebAppMgr unknown/client bad',
  prefix:'1991 foreign.com.webos.app.home-4447 /usr/bin/WebAppMgr unknown/client bad',
  wrongexe:'1991 com.webos.app.home-4447 /usr/bin/OtherApp unknown/client bad'
};
if(env.BUS_DROP_ACTIVE==='1')fs.unlinkSync(env.FIXTURE_ACTIVE);
process.stdout.write('PID SERVICE NAME EXE TYPE UNIQUE NAME\\n'+rows.native+'\\n'+rows.legacy+'\\n'+(rows[env.BUS_MODE||'home']||'')+'\\n');
if(env.BUS_FAIL==='1')process.exit(1);
`);
  command('stat', prelude + "const s=fs.statSync(args.at(-1));process.stdout.write(s.dev+':'+s.ino+'\\n');");
  command('mount', prelude + `trace('mount');
if(env.FAIL_MOUNT==='1')process.exit(1);
if(!fs.readFileSync(env.FIXTURE_TRACE,'utf8').includes('guard\\n'))throw Error('mount before guard');
fs.unlinkSync(env.FIXTURE_TARGET);fs.linkSync(args.at(-2),env.FIXTURE_TARGET);
`);
  command('umount', prelude + `trace('umount');if(env.FAIL_UNMOUNT==='1')process.exit(1);
fs.unlinkSync(env.FIXTURE_TARGET);fs.copyFileSync(env.FIXTURE_STOCK,env.FIXTURE_TARGET);
`);
  command('luna-send', prelude + `trace('luna '+args.at(-2)+' '+args.at(-1));
const foreground=args.at(-2).includes('getForegroundAppInfo');
process.stdout.write(JSON.stringify(foreground?{returnValue:true,appId:env.FOREGROUND||'com.webos.app.home'}:{returnValue:env.FAIL_LAUNCH!=='1'})+'\\n');
`);
  command('setsid', prelude + `
if(args[2]!=='watch'){trace('background '+args[2]);process.exit(0);}
if(env.FAIL_GUARD==='1')process.exit(1);
trace('guard');
const token=args[3],lease=env.FIXTURE_RUN+'/lease';
const timer=setInterval(()=>{let current='';try{current=fs.readFileSync(lease,'utf8').trim();}catch(e){}
if(current!==token){clearInterval(timer);process.exit(0);}},20);
setTimeout(()=>process.exit(0),10000).unref();
`);
  command('readlink', prelude + `
const file=args.at(-1);if(file.endsWith('/111111/exe')||file.endsWith('/222222/exe'))process.stdout.write(env.FIXTURE_TARGET+'\\n');
else {try{process.stdout.write(fs.readlinkSync(file)+'\\n');}catch(e){process.exit(1);}}
`);
  fs.writeFileSync(f.bin + '/sha256sum', '#!/bin/sh\nexec /usr/bin/shasum -a 256 "$@"\n', {mode:0o755});
  fs.writeFileSync(f.bin + '/sleep', '#!/bin/sh\n/bin/sleep 0.1\n', {mode:0o755});
  command('systemctl', 'process.exit(0);');
  const env = {...process.env, PATH:f.bin + ':' + path.dirname(process.execPath) + ':' + process.env.PATH,
    FIXTURE_TRACE:f.trace, FIXTURE_TARGET:f.target, FIXTURE_STOCK:f.stock, FIXTURE_RUN:f.run,
    FIXTURE_ACTIVE:f.active, FIXTURE_MONITOR:f.bin + '/ls-monitor'};
  f.control = (mode, overrides = {}) => spawnSync('/bin/sh', [f.base + '/control.sh'].concat(mode), {encoding:'utf8', timeout:10000, env:{...env, ...overrides}});
  f.state = mode => spawnSync(process.execPath, [f.base + '/state.js', mode], {encoding:'utf8', timeout:5000});
  f.lines = () => fs.existsSync(f.trace) ? fs.readFileSync(f.trace, 'utf8').trim().split('\n') : [];
  f.keys = () => JSON.parse(fs.readFileSync(f.key, 'utf8'));
  f.writeKeys = keys => fs.writeFileSync(f.key, JSON.stringify(keys));
  f.snapshot = f.base + '/recovery/home-key.json';
  f.runtime = (pid = '444444', owned = true) => {
    fs.mkdirSync(f.proc + '/' + pid, {recursive:true});
    fs.writeFileSync(f.proc + '/' + pid + '/cmdline', 'node\0' + (owned ? f.base + '/home.js' : '/other/home.js') + '\0');
    fs.writeFileSync(f.run + '/runtime.pid', pid); fs.writeFileSync(f.run + '/shown', 'yes');
  };
  return f;
}
function pass(result, why) {assert.equal(result.status, 0, why + ': ' + result.stdout + result.stderr);}
function fail(result, why) {assert.notEqual(result.status, 0, why);}
function noMount(f, why) {assert(!f.lines().includes('mount'), why);}

try {
  // Both arm and the conditional startup function must fail closed on either hash.
  for (const mode of ['arm', 'startup']) for (const corrupt of ['target', 'manifest']) {
    const f = fixture(); fs.writeFileSync(f[corrupt], 'unsupported firmware');
    if (mode === 'startup') {
      pass(f.state('suspend-key'), 'previous boot saved Home key');
      fs.rmSync(f.run, {recursive:true}); fs.mkdirSync(f.run);
      fs.writeFileSync(f.base + '/enabled', '');
    }
    fail(f.control(mode), mode + ' rejects unsupported ' + corrupt); noMount(f, 'hash rejection precedes mounting');
    assert.deepEqual(f.keys(), f.originalKeys, 'hash rejection preserves key bindings');
    assert(!fs.existsSync(f.active));
    assert(!f.lines().includes('umount'), 'unsupported firmware must not be unmounted');
    if (mode === 'startup') assert(!fs.existsSync(f.base + '/enabled') && !fs.existsSync(f.snapshot));
  }
  for (const missing of ['index.html', 'home.js', 'startup-guard.js', 'permissions.js']) {
    const f = fixture(); pass(f.state('suspend-key'), 'previous boot key before missing-file rejection');
    fs.writeFileSync(f.base + '/enabled', '');
    fs.unlinkSync((missing === 'index.html' ? f.app : f.base) + '/' + missing);
    fail(f.control('startup'), 'startup rejects missing ' + missing);
    assert.deepEqual(f.keys(), f.originalKeys, 'failed startup restores saved Home despite missing runtime file');
    noMount(f, 'missing file prevents mount'); assert(!f.lines().includes('umount'));
  }
  {
    const f = fixture(); pass(f.state('suspend-key'), 'previous boot key before guard rejection');
    fs.writeFileSync(f.base + '/enabled', '');
    fail(f.control('startup', {FAIL_GUARD:'1'}), 'startup catches explicit arm exit');
    assert.deepEqual(f.keys(), f.originalKeys, 'explicit arm exit also restores durable key');
    assert(!fs.existsSync(f.base + '/enabled')); noMount(f, 'failed startup guard never mounts');
  }
  {
    const f = fixture(); pass(f.state('suspend-key'), 'previous boot key before foreign binding');
    fs.writeFileSync(f.base + '/enabled', ''); fs.writeFileSync(f.target, 'unsupported firmware');
    const updated = f.keys(); updated['773'] = {action:'exec', command:'/new/home'}; f.writeKeys(updated);
    fail(f.control('startup'), 'startup rejects unsupported firmware with a newer Home key');
    assert.deepEqual(f.keys(), updated, 'startup recovery preserves a newer unrelated Home binding');
  }
  let f = fixture(); fail(f.control('arm', {FAIL_GUARD:'1'}), 'dead guard prevents activation');
  noMount(f, 'a failed guard cannot mount'); assert.deepEqual(f.keys(), f.originalKeys);
  f = fixture(); fail(f.control('arm', {FAIL_LOCK:'1'}), 'held operation lock prevents activation');
  noMount(f, 'a held lock cannot mount'); assert.deepEqual(f.keys(), f.originalKeys);
  f = fixture(); fail(f.control('arm', {FAIL_PERMISSIONS_INSTALL:'1'}), 'permission failure prevents activation');
  noMount(f, 'permissions must be installed before mounting'); assert.deepEqual(f.keys(), f.originalKeys);
  assert(!fs.existsSync(f.active));
  f = fixture(); const interrupted = f.control('arm', {INTERRUPT_BEFORE_MOUNT:'1'}); fail(interrupted, 'interrupted activation exits');
  noMount(f, 'activation cannot continue mounting after its signal rollback');
  assert.deepEqual(f.keys(), f.originalKeys, JSON.stringify({interrupted, trace:f.lines(), log:fs.existsSync(f.run+'/control.log')?fs.readFileSync(f.run+'/control.log','utf8'):''}));
  assert(!fs.existsSync(f.active) && !fs.existsSync(f.run + '/lease'));

  f = fixture(); fs.writeFileSync(f.run + '/runtime.pid', '999999'); fs.writeFileSync(f.run + '/shown', 'old');
  pass(f.control('arm'), 'arm');
  assert(f.lines().indexOf('guard') < f.lines().indexOf('mount'), 'guard starts before mount');
  assert(f.lines().indexOf('guard') < f.lines().indexOf('permission install') &&
    f.lines().indexOf('permission install') < f.lines().indexOf('mount'), 'guard precedes permission install and mount');
  const currentLease = fs.readFileSync(f.run + '/lease', 'utf8');
  pass(f.control(['rollback', 'older-trial-token']), 'outdated guard exits without changing newer trial');
  assert.equal(fs.readFileSync(f.run + '/lease', 'utf8'), currentLease);
  assert(fs.existsSync(f.active)); assert(!f.lines().includes('umount'), 'stale guard cannot unmount current trial');
  assert(!fs.existsSync(f.run + '/runtime.pid') && !fs.existsSync(f.run + '/shown'), 'arm removes stale runtime acknowledgements');
  assert(!f.keys()['773']); assert.deepEqual(f.keys()['404'], f.originalKeys['404']);
  const description = JSON.parse(fs.readFileSync(f.base + '/wam-launch.json', 'utf8')).appDesc;
  assert.equal(description.id, 'com.webos.app.home'); assert.equal(description.folderPath, f.app);
  assert.equal(description.version, '1.2.31', 'system descriptor uses the optimized installed app');
  fail(f.control('enable'), 'persistence requires confirmation'); assert(!fs.existsSync(f.init));
  f.runtime('555555'); fail(f.control('confirm'), 'dead runtime cannot confirm');
  f.runtime('444444', false); fail(f.control('confirm'), 'foreign runtime cannot confirm');
  f.runtime(); fail(f.control('confirm', {FOREGROUND:'netflix'}), 'Home must be foreground');
  for (const mode of ['native', 'legacy', 'suffix', 'prefix', 'wrongexe'])
    fail(f.control('confirm', {BUS_MODE:mode}), 'bus connection must belong exactly to the Home web page: ' + mode);
  fail(f.control('confirm', {BUS_TIMEOUT:'1'}), 'bus timeout cannot confirm');
  fail(f.control('confirm', {BUS_FAIL:'1'}), 'failed bus query cannot confirm even with a matching output row');
  assert(fs.existsSync(f.run + '/lease'), 'failed registration checks retain rollback lease');
  pass(f.control('confirm'), 'confirm live shown foreground adapter');
  fs.writeFileSync(f.init, 'unrelated startup hook');
  fail(f.control('enable'), 'foreign startup hook is preserved'); assert.equal(fs.readFileSync(f.init, 'utf8'), 'unrelated startup hook');
  fs.unlinkSync(f.init); pass(f.control('enable'), 'enable after confirmation');
  const mountCount = f.lines().filter(s => s === 'mount').length;
  const installCount = f.lines().filter(s => s === 'permission install').length;
  pass(f.control('startup'), 'repeated startup retains an active owned replacement');
  assert(fs.existsSync(f.base + '/enabled') && fs.existsSync(f.run + '/confirmed') && fs.existsSync(f.active));
  assert.equal(f.lines().filter(s => s === 'mount').length, mountCount);
  assert.equal(f.lines().filter(s => s === 'permission install').length, installCount);
  assert(!f.keys()['773'], 'repeated startup does not restore a key while replacement is active');
  const changed = f.keys(); changed['405'] = {action:'key', key:10}; f.writeKeys(changed);
  pass(f.control('disable'), 'disable');
  assert.deepEqual(f.keys()['773'], f.ownKey); assert.deepEqual(f.keys()['405'], changed['405']);
  assert(!fs.existsSync(f.init) && !fs.existsSync(f.active) && !fs.existsSync(f.snapshot));
  assert.equal(fs.readFileSync(f.target, 'utf8'), fs.readFileSync(f.stock, 'utf8'));
  assert(f.lines().includes('kill -TERM 444444'), 'owned runtime alone is signalled');
  const removedAt = f.lines().lastIndexOf('permission remove');
  const killedAt = f.lines().findIndex(s => s.includes('/killApp'));
  const fallbackAt = f.lines().findIndex(s => s.includes('/launch') && s.includes('"id":"com.gathin.tvhome"'));
  assert(killedAt >= 0 && fallbackAt > killedAt && removedAt > fallbackAt, 'remove permissions after page shutdown and fallback launch');

  f = fixture(); pass(f.control('arm'), 'startup bus fixture arm'); f.runtime();
  fail(f.control('finish-startup', {BUS_MODE:'native', BUS_DROP_ACTIVE:'1'}), 'startup cannot confirm native-only bus identity');
  assert(!fs.existsSync(f.run + '/confirmed')); assert.deepEqual(f.keys(), f.originalKeys);
  f = fixture(); pass(f.control('arm'), 'registered startup fixture arm'); f.runtime();
  pass(f.control('finish-startup'), 'startup accepts shown live adapter with exact Home web bus identity');
  assert(fs.existsSync(f.run + '/confirmed') && !fs.existsSync(f.run + '/lease'));
  pass(f.control('rollback'), 'registered startup fixture cleanup');

  f = fixture(); fail(f.control('arm', {FAIL_MOUNT:'1'}), 'mount failure fails trial');
  assert.deepEqual(f.keys(), f.originalKeys, 'mount failure restores Home and unrelated keys');
  assert(!fs.existsSync(f.active) && !fs.existsSync(f.run + '/lease') && !fs.existsSync(f.snapshot));
  assert(!f.lines().includes('umount'), 'failed mount does not unmount an unowned target');

  f = fixture(); pass(f.control('arm'), 'unmount-failure fixture arm');
  fail(f.control('rollback', {FAIL_UNMOUNT:'1'}), 'unmount failure retains recovery');
  assert(fs.existsSync(f.active) && fs.existsSync(f.run + '/lease') && fs.existsSync(f.snapshot));
  assert(!f.lines().some(s => s.includes('/killApp')), 'failed unmount does not terminate active replacement');
  pass(f.control('rollback'), 'retry unmount');

  f = fixture(); pass(f.control('arm'), 'permission-removal fixture arm');
  fail(f.control('rollback', {FAIL_PERMISSIONS_REMOVE:'1'}), 'failed permission removal keeps recovery retryable');
  assert(fs.existsSync(f.run + '/lease') && fs.existsSync(f.run + '/permissions-installed'));
  assert.deepEqual(f.keys(), f.originalKeys, 'permission-removal failure still restores original keys');
  pass(f.control('rollback'), 'retry permission removal');
  assert(!fs.existsSync(f.run + '/lease') && !fs.existsSync(f.run + '/permissions-installed'));

  f = fixture(); pass(f.control('arm'), 'foreign binding fixture arm');
  const newKeys = f.keys(); newKeys['773'] = {action:'exec', command:'/another/home'}; f.writeKeys(newKeys);
  pass(f.control('rollback'), 'rollback with newer Home key'); assert.deepEqual(f.keys(), newKeys, 'new Home binding survives restoration');

  f = fixture(); fs.writeFileSync(f.target, 'foreign replacement'); fs.writeFileSync(f.run + '/armed', '');
  fs.writeFileSync(f.active, 'token'); fs.writeFileSync(f.run + '/lease', 'token');
  fail(f.control('rollback'), 'foreign replacement is not claimed');
  assert(!f.lines().includes('umount') && !f.lines().some(s => s.includes('/killApp')));
  assert.equal(fs.readFileSync(f.target, 'utf8'), 'foreign replacement');
  assert(fs.existsSync(f.active) && fs.existsSync(f.run + '/lease'));

  // Losing /tmp over reboot must not lose the original persistent Home binding.
  f = fixture(); pass(f.state('suspend-key'), 'suspend Home');
  const saved = fs.readFileSync(f.snapshot, 'utf8');
  fs.rmSync(f.run, {recursive:true}); fs.mkdirSync(f.run);
  pass(f.state('suspend-key'), 'suspend after reboot'); assert.equal(fs.readFileSync(f.snapshot, 'utf8'), saved);
  pass(f.state('restore-key'), 'restore after reboot'); assert.deepEqual(f.keys(), f.originalKeys);
  f.writeKeys({'773':{action:'exec', command:'/foreign/home'}, '404':f.originalKeys['404']});
  fail(f.state('suspend-key'), 'foreign Home binding cannot be suspended'); assert(!fs.existsSync(f.snapshot));

  f = fixture(); pass(f.state('suspend-key'), 'malformed snapshot fixture');
  fs.writeFileSync(f.snapshot, '{"present":true}');
  const keysBefore = fs.readFileSync(f.key, 'utf8');
  fail(f.state('restore-key'), 'invalid recovery data must not be consumed');
  assert(fs.existsSync(f.snapshot), 'invalid snapshot remains available for repair');
  assert.equal(fs.readFileSync(f.key, 'utf8'), keysBefore);
  f = fixture(); fs.writeFileSync(f.key, '[]');
  fail(f.state('suspend-key'), 'array key configuration must not be treated as a key map');
  assert.equal(fs.readFileSync(f.key, 'utf8'), '[]'); assert(!fs.existsSync(f.snapshot));

  assert(!/\b(?:pkill|killall)\b/.test(controlSource), 'controller must not use broad process-name kills');
  f = fixture();
  for (const [pid, content] of [['111111', fs.readFileSync(f.stock)], ['222222', Buffer.from('different executable')]]) {
    fs.mkdirSync(f.proc + '/' + pid); fs.writeFileSync(f.proc + '/' + pid + '/exe', content);
  }
  pass(f.control('arm'), 'stock-process fixture arm');
  assert(f.lines().includes('kill -TERM 111111'), 'matching stock executable is stopped');
  assert(!f.lines().includes('kill -TERM 222222'), 'same executable path with foreign bytes is not stopped');
  pass(f.control('rollback'), 'stock-process fixture cleanup');
  console.log('System Home hash gates, guarded mount/rollback, owned recovery, durable keys and confirmation checks passed.');
} finally {
  // Lease deletion lets each inert guard exit; no host process is signalled.
  for (const f of fixtures) fs.rmSync(f.dir, {recursive:true, force:true});
}
