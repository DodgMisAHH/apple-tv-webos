// Exercise the actual Settings key editor, controller and launch wrapper against isolated TV fixtures.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const {spawnSync} = require('child_process');
const source = path.resolve(__dirname, '../tv/control-centre');
const fixtures = [];
function fixture(keys = {'139':{action:'replace', key:101}, '773':{action:'exec', command:'/existing/home'}, '42':{action:'disable'}}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-settings-'));
  const f = {dir, base:dir+'/data/control-centre', app:dir+'/overlay', run:dir+'/run',
    hookApp:dir+'/inputhook', key:dir+'/config/keybinds.json', bin:dir+'/bin',
    uptime:dir+'/uptime', trace:dir+'/trace', home:dir+'/home', homeDescription:dir+'/wam-launch.json', homeActive:dir+'/home.active',
    native:dir+'/data/native-blur', nativeRun:dir+'/native-run'};
  fixtures.push(f);
  for (const folder of [f.base, f.app, f.run, f.hookApp, path.dirname(f.key), f.bin, f.home, f.native, f.nativeRun]) fs.mkdirSync(folder, {recursive:true});
  f.snapshot = f.base+'/recovery/settings-key.json';
  f.manifest = {id:'com.gathin.tvcontrolcentre', type:'web', main:'overlay.html', defaultWindowType:'overlay',
    transparent:true, visible:false, handlesRelaunch:true, disableBackHistoryAPI:true};
  fs.writeFileSync(f.app+'/appinfo.json', JSON.stringify(f.manifest));
  fs.writeFileSync(f.app+'/overlay.html', '<!doctype html>');
  fs.writeFileSync(f.home+'/appinfo.json', JSON.stringify({id:'com.gathin.tvhome',type:'web',main:'index.html',version:'1.2.42'}));
  fs.writeFileSync(f.home+'/index.html', '<!doctype html><script src="home-settings.js?v=1"></script>');
  fs.writeFileSync(f.home+'/home-settings.js', '// Home-only Control Centre event handler\n');
  fs.writeFileSync(f.homeActive, 'fixture-active-adapter');
  f.descriptor={appDesc:{id:'com.webos.app.home',type:'web',main:'index.html',folderPath:f.home,version:'1.2.42'},
    instanceId:'lg-tv-vibehack-system-home',launchingAppId:'',launchingProcId:'',parameters:{home:true,reload:false}};
  fs.writeFileSync(f.homeDescription, JSON.stringify(f.descriptor));
  fs.writeFileSync(f.key, JSON.stringify(keys));
  fs.writeFileSync(f.uptime, '100.00 200.00\n');
  f.original = keys;
  const replacements = [
    ['/home/root/lg-tv-vibehack/control-centre', f.base],
    ['/home/root/lg-tv-vibehack/native-blur', f.native], ['/tmp/lg-tv-native-blur', f.nativeRun],
    ['/media/developer/apps/usr/palm/applications/com.gathin.tvcontrolcentre', f.app],
    ['/media/developer/apps/usr/palm/applications/com.gathin.tvhome', f.home],
    ['/home/root/lg-tv-vibehack/system-home/wam-launch.json', f.homeDescription],
    ['/tmp/lg-tv-system-home.active', f.homeActive],
    ['/media/developer/apps/usr/palm/applications/org.webosbrew.inputhook', f.hookApp],
    ['/home/root/.config/lginputhook/keybinds.json', f.key],
    ['/tmp/lg-tv-control-centre', f.run], ['/proc/uptime', f.uptime]
  ];
  for (const name of ['state.js', 'control.sh', 'toggle.sh']) {
    let text = fs.readFileSync(source+'/'+name, 'utf8');
    for (const [from,to] of replacements) text = text.split(from).join(to);
    text = text.replace('export PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH', ': # Fixture PATH contains inert TV commands.');
    fs.writeFileSync(f.base+'/'+name, text, {mode:0o755});
  }
  function stub(name, body) { fs.writeFileSync(f.bin+'/'+name, '#!'+process.execPath+'\n'+body, {mode:0o755}); }
  const prelude = `const fs=require('fs'),args=process.argv.slice(2),env=process.env;
function trace(s){fs.appendFileSync(env.FIXTURE_TRACE,s+'\\n');}
function ownsToggleLock(){try{const fd=fs.fstatSync(8),lock=fs.statSync(env.FIXTURE_RUN+'/toggle.lock');return fd.dev===lock.dev&&fd.ino===lock.ino;}catch(error){return false;}}
`;
  stub('id', "console.log('0');");
  stub('node', prelude+`
trace('node '+args[1]);
const result=require('child_process').spawnSync(process.execPath,args,{encoding:'utf8',env});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status===null?1:result.status);
`);
  fs.writeFileSync(f.bin+'/sha256sum', '#!/bin/sh\nexec /usr/bin/shasum -a 256 "$@"\n', {mode:0o755});
  stub('flock', prelude+"trace('lock '+args.join(' '));if(env.CHECK_WATCHDOG_LOCK==='1'&&args.join(' ')==='-n 8'){if(!ownsToggleLock())throw Error('Wrapper lost its toggle lock');trace('parent-toggle-lock');}process.exit(env.FAIL_LOCK==='1'?1:0);");
  stub('setsid', prelude+`
if(args[2]!=='watch')throw Error('Unexpected background operation');
if(env.FAIL_GUARD==='1')process.exit(1);
trace('guard');
const lease=env.FIXTURE_RUN+'/lease',token=args[3];
const timer=setInterval(()=>{let current='';try{current=fs.readFileSync(lease,'utf8').trim();}catch(e){}
if(current!==token){clearInterval(timer);process.exit(0);}},20);
setTimeout(()=>process.exit(0),10000).unref();
`);
  stub('timeout', prelude+`
if(args[0]!=='-t'||!['1','7'].includes(args[1])||args[2]!=='luna-send')throw Error('Expected bounded BusyBox timeout');
const query=args[1]==='1';trace(query?'query-timeout':'timeout');
if(env.CHECK_WATCHDOG_LOCK==='1'){
  // Model the descriptor inherited by a forked BusyBox watchdog. Node may reuse
  // fd8 internally, so compare the inode rather than merely checking EBADF.
  const stdio=['ignore','pipe','pipe','ignore','ignore','ignore','ignore','ignore',ownsToggleLock()?8:'ignore'];
  const watchdog=require('child_process').spawnSync(process.execPath,['-e',
    "const fs=require('fs');let held=false;try{const a=fs.fstatSync(8),b=fs.statSync(process.env.FIXTURE_RUN+'/toggle.lock');held=a.dev===b.dev&&a.ino===b.ino;}catch(error){}process.stdout.write(held?'held':'free');"
  ],{encoding:'utf8',env,stdio,timeout:2000});
  if(watchdog.status!==0)throw Error('Watchdog descriptor probe failed');
  trace((query?'query':'launch')+'-watchdog-lock '+watchdog.stdout);
}
if((!query&&env.FAIL_TIMEOUT==='1')||(query&&env.FAIL_FOCUS_TIMEOUT==='1'))process.exit(124);
const result=require('child_process').spawnSync(args[2],args.slice(3),{encoding:'utf8',env});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status===null?1:result.status);
`);
  stub('luna-send', prelude+`
const focused=args[4]==='luna://com.webos.surfacemanager/getFocusedWindowInfo';
if(args[0]!=='-w'||args[1]!==(focused?'500':'5000')||args[2]!=='-n'||args[3]!=='1'||
!['luna://com.webos.applicationManager/launch','luna://com.palm.webappmanager/launchApp','luna://com.webos.surfacemanager/getFocusedWindowInfo'].includes(args[4]))throw Error('Unexpected Luna argv');
if(focused){
  trace('focus-query');
  if(env.BAD_FOCUS_RESPONSE==='1'){console.log('{bad');process.exit(0);}
  const ids=env.MULTIPLE_FOCUS==='1'?['com.gathin.tvcontrolcentre','com.webos.app.home']:[env.FOCUSED||'netflix'];
  console.log(JSON.stringify({returnValue:env.FAIL_FOCUS!=='1',focusedWindowInfo:ids.map(appId=>({appId}))}));
  if(env.FAIL_FOCUS_TRANSPORT==='1')process.exit(1);
  process.exit(0);
}
const request=JSON.parse(args[5]);trace('launch '+JSON.stringify(request));
const overlay=request.id==='com.gathin.tvcontrolcentre';
if(overlay&&request.keepAlive!==true)throw Error('Overlay launch must allow native retention');
const home=request.id==='com.gathin.tvhome'||(request.appDesc&&request.appDesc.id==='com.webos.app.home');
if(request.appDesc){if(args[4]!=='luna://com.palm.webappmanager/launchApp')throw Error('Native Home must bypass SAM sanitizer');trace('native-home');}
console.log(JSON.stringify({returnValue:!((overlay&&env.FAIL_OVERLAY==='1')||(home&&env.FAIL_HOME==='1'))}));
if((overlay&&env.FAIL_OVERLAY_TRANSPORT==='1')||(home&&env.FAIL_HOME_TRANSPORT==='1'))process.exit(1);
`);
  fs.writeFileSync(f.bin+'/sleep', '#!/bin/sh\n/bin/sleep 0.15\n', {mode:0o755});
  const env = {...process.env, PATH:f.bin+':'+path.dirname(process.execPath)+':'+process.env.PATH,
    FIXTURE_RUN:f.run, FIXTURE_TRACE:f.trace};
  f.state = (...args) => spawnSync(process.execPath, [f.base+'/state.js', ...args], {encoding:'utf8', timeout:5000, env});
  f.control = (mode, overrides={}) => spawnSync('/bin/sh', [f.base+'/control.sh'].concat(mode), {encoding:'utf8', timeout:10000, env:{...env,...overrides}});
  f.toggle = (overrides={}) => spawnSync('/bin/sh', [f.base+'/toggle.sh'], {encoding:'utf8', timeout:10000, env:{...env,...overrides}});
  f.readKeys = () => JSON.parse(fs.readFileSync(f.key, 'utf8'));
  f.writeKeys = keys => fs.writeFileSync(f.key, JSON.stringify(keys));
  f.old = () => JSON.parse(fs.readFileSync(f.snapshot, 'utf8'));
  f.lines = () => fs.existsSync(f.trace) ? fs.readFileSync(f.trace, 'utf8').trim().split('\n') : [];
  f.launches = () => f.lines().filter(line=>line.startsWith('launch ')).map(line=>JSON.parse(line.slice(7)));
  f.install = () => f.state('install', '123456-123', String(Date.now()+600000));
  f.expire = () => {const old=f.old();old.deadline=Date.now()-1000;fs.writeFileSync(f.snapshot, JSON.stringify(old));};
  f.nativeHelper = () => {
    fs.writeFileSync(f.native+'/runtime.sh', '#!/bin/sh\nprintf "native %s %s\\n" "$1" "${2:-}" >> "$FIXTURE_TRACE"\n[ "$1" != request ] || exit "${NATIVE_RESULT:-0}"\n', {mode:0o755});
  };
  return f;
}
function pass(result, why) { assert.equal(result.status, 0, why+': '+result.stdout+result.stderr); }
function fail(result, why) { assert.notEqual(result.status, 0, why); }
function noLaunch(f, why) { assert.equal(f.launches().length, 0, why); }
try {
  let f = fixture();
  pass(f.state('check'), 'installed overlay manifest passes');
  const beforeMtime = Math.floor(fs.statSync(f.key).mtimeMs/1000);
  pass(f.install(), 'install');
  assert.deepEqual(f.readKeys()['773'], f.original['773'], 'Home is never modified');
  assert.deepEqual(f.readKeys()['42'], f.original['42']);
  assert.deepEqual(f.readKeys()['139'], {action:'exec',command:f.base+'/toggle.sh'});
  const installedMtime=Math.floor(fs.statSync(f.key).mtimeMs/1000);
  assert.notEqual(installedMtime, beforeMtime, 'whole-second mtime changes for Input Hook polling');
  const firstSnapshot=fs.readFileSync(f.snapshot,'utf8');
  pass(f.install(), 'repeated install');
  assert.equal(fs.readFileSync(f.snapshot,'utf8'), firstSnapshot, 'repeat install preserves original snapshot and deadline');
  let changed=f.readKeys();changed['99']={action:'disable'};f.writeKeys(changed);
  pass(f.state('restore','older-token'), 'stale lease cannot restore');
  assert.equal(f.readKeys()['139'].command, f.base+'/toggle.sh');
  pass(f.state('restore'), 'restore');
  assert.deepEqual(f.readKeys()['139'],f.original['139']);
  assert.deepEqual(f.readKeys()['99'],changed['99']);
  assert(!fs.existsSync(f.snapshot));
  pass(f.state('restore'),'repeated restore is harmless');
  pass(f.install(),'new trial after successful restore');
  pass(f.state('confirm'),'confirm');
  pass(f.state('restore','123456-123'),'expired guard cannot revert confirmed key');
  assert.equal(f.readKeys()['139'].command, f.base+'/toggle.sh');
  pass(f.state('allowed'),'confirmed launch allowed');
  pass(f.state('restore'),'explicit restore undoes confirmed mapping');

  for (const original of [{'773':{action:'disable'}},{'139':null},{'139':false}]) {
    f=fixture(original);pass(f.install(),'save original key including absence and null');
    const mappedMtime=Math.floor(fs.statSync(f.key).mtimeMs/1000);
    pass(f.state('restore'),'restore exact original value');assert.deepEqual(f.readKeys(),original);
    assert.notEqual(Math.floor(fs.statSync(f.key).mtimeMs/1000),mappedMtime,'immediate restore advances timestamp');
  }
  f=fixture();pass(f.install(),'foreign fixture');changed=f.readKeys();
  changed['139']={action:'exec',command:'/someone/else'};f.writeKeys(changed);
  pass(f.state('restore'),'foreign binding retained');assert.deepEqual(f.readKeys(),changed);assert(fs.existsSync(f.snapshot));
  fail(f.install(),'new install cannot overwrite foreign recovery');
  f=fixture();pass(f.install(),'modified ownership fixture');changed=f.readKeys();changed['139'].extra=true;f.writeKeys(changed);
  pass(f.state('restore'),'extra fields mark newer binding');assert.deepEqual(f.readKeys(),changed);assert(fs.existsSync(f.snapshot));

  for (const text of ['{broken','[]','null']) {
    f=fixture();fs.writeFileSync(f.key,text);fail(f.install(),'malformed key map rejected');
    assert.equal(fs.readFileSync(f.key,'utf8'),text);assert(!fs.existsSync(f.snapshot));
  }
  f=fixture();pass(f.install(),'missing snapshot fixture');fs.unlinkSync(f.snapshot);
  fail(f.install(),'owned binding without recovery cannot be reinstalled');fail(f.state('restore'),'owned binding without recovery cannot be discarded');
  f=fixture();pass(f.install(),'invalid snapshot fixture');fs.writeFileSync(f.snapshot,'{"present":true}');
  const bytes=fs.readFileSync(f.key,'utf8');fail(f.state('restore'),'malformed recovery rejected');assert.equal(fs.readFileSync(f.key,'utf8'),bytes);
  for (const [field,value] of [['id','com.gathin.tvhome'],['type','native'],['main','index.html'],['defaultWindowType','card'],
    ['transparent',false],['visible',true],['handlesRelaunch',false],['disableBackHistoryAPI',false]]) {
    f=fixture();f.manifest[field]=value;fs.writeFileSync(f.app+'/appinfo.json',JSON.stringify(f.manifest));
    fail(f.install(),'manifest gate: '+field);assert.deepEqual(f.readKeys(),f.original);assert(!fs.existsSync(f.snapshot));
  }
  f=fixture();fs.unlinkSync(f.app+'/overlay.html');fail(f.install(),'missing overlay page');
  f=fixture();pass(f.install(),'expiry fixture');f.expire();fail(f.state('allowed'),'expired trial cannot launch');
  fail(f.state('confirm'),'expired trial cannot be confirmed');fail(f.install(),'repeat install cannot extend expired trial');

  for (const overrides of [{FAIL_GUARD:'1'},{FAIL_LOCK:'1'}]) {
    f=fixture();fail(f.control('arm',overrides),'failed guard or operation lock prevents binding');
    assert.deepEqual(f.readKeys(),f.original);assert(!fs.existsSync(f.snapshot));
  }
  f=fixture();fs.rmSync(f.hookApp,{recursive:true});fail(f.control('arm'),'Input Hook installation required');assert.deepEqual(f.readKeys(),f.original);
  f=fixture();pass(f.control('arm'),'controller trial');assert(f.lines().includes('guard'));
  const lease=fs.readFileSync(f.run+'/lease','utf8'),saved=fs.readFileSync(f.snapshot,'utf8');
  pass(f.control('arm'),'repeated trial retains deadline');assert.equal(fs.readFileSync(f.snapshot,'utf8'),saved);
  pass(f.control(['rollback','old-token']),'outdated watchdog cannot restore');assert.equal(fs.readFileSync(f.run+'/lease','utf8'),lease);
  pass(f.control('confirm'),'controller confirmation');assert(!fs.existsSync(f.run+'/lease'));assert(f.old().confirmed);
  pass(f.control('arm'),'confirmed controller install is idempotent');assert(f.old().confirmed);assert(!fs.existsSync(f.run+'/lease'));
  pass(f.control('restore'),'controller restore');assert.deepEqual(f.readKeys(),f.original);
  f=fixture();pass(f.control('arm'),'watchdog expiry fixture');f.expire();
  const token=fs.readFileSync(f.run+'/lease','utf8').trim();
  pass(f.control(['watch',token]),'watchdog restores expired durable lease');assert.deepEqual(f.readKeys(),f.original);assert(!fs.existsSync(f.snapshot));

  f=fixture();pass(f.install(),'toggle fixture');pass(f.toggle(),'launch overlay');
  assert.equal(f.launches().length,1);assert.equal(f.launches()[0].id,'com.gathin.tvcontrolcentre');
  assert.deepEqual(Object.keys(f.launches()[0].params).sort(),['controlCentre','overlayRequestId','toggle']);
  assert.equal(f.launches()[0].params.controlCentre,true);assert.equal(f.launches()[0].params.toggle,true);
  assert.match(f.launches()[0].params.overlayRequestId,/^[0-9]+-[0-9]+$/);
  assert.equal(f.lines().filter(l=>l==='node authorization').length,1,'cold press validates and builds cache');
  pass(f.toggle(),'duplicate press is harmless');assert.equal(f.launches().length,1,'duplicate within 250ms is suppressed');
  fs.writeFileSync(f.uptime,'100.30 200.30\n');pass(f.toggle(),'deliberate second press');
  assert.equal(f.launches().length,2);assert.notEqual(f.launches()[1].params.overlayRequestId,f.launches()[0].params.overlayRequestId);
  assert.equal(f.lines().filter(l=>l==='node authorization').length,1,'unchanged inputs skip Node on every warm press');
  assert.equal(f.lines().filter(l=>l==='focus-query').length,2,'duplicate key-down is filtered before querying focus');
  assert(!f.launches().some(l=>l.id==='com.gathin.tvhome'||l.id==='com.webos.app.home'),'wrapper never brings Home forward');
  for (const focused of ['com.webos.app.home','com.gathin.tvhome']) {
    f=fixture();pass(f.install(),'Home routing fixture');
    pass(f.toggle({FOCUSED:focused}),'Settings routes to focused '+focused);
    const first=f.launches()[0], native=focused==='com.webos.app.home';
    assert.equal(native?first.appDesc.id:first.id,focused);
    const parameters=native?first.parameters:first.params;
    assert.deepEqual(Object.keys(parameters).sort(),['controlCentre','controlCentreRequestId']);
    assert.equal(parameters.controlCentre,true);assert.match(parameters.controlCentreRequestId,/^[0-9]+-[0-9]+$/);
    if(native){
      assert.deepEqual(first.appDesc,f.descriptor.appDesc);
      assert.equal(first.instanceId,'lg-tv-vibehack-system-home');
      assert.equal(first.launchingAppId,'');assert.equal(first.launchingProcId,'');
      assert(f.lines().includes('native-home'));
    }
    const originals=fs.readFileSync(f.snapshot,'utf8');
    pass(f.toggle({FOCUSED:focused}),'Home duplicate press suppressed');assert.equal(f.launches().length,1);
    fs.writeFileSync(f.uptime,'100.30 200.30\n');pass(f.toggle({FOCUSED:focused}),'second Home toggle');
    const second=native?f.launches()[1].parameters:f.launches()[1].params;
    assert.notEqual(second.controlCentreRequestId,parameters.controlCentreRequestId,'deliberate Home toggle gets a unique token');
    assert.equal(f.lines().filter(l=>l==='node authorization').length,1,'warm Home routing never starts Node');
    assert.equal(fs.readFileSync(f.snapshot,'utf8'),originals,'routing cannot alter original Settings recovery');
  }
  for (const overrides of [{FOCUSED:'com.gathin.tvcontrolcentre'},{FOCUSED:'youtube.leanback.v4'},
    {FOCUSED:'com.webos.app.home.extra'},{FOCUSED:'com.webos.app.home',FAIL_FOCUS:'1'},
    {FOCUSED:'com.webos.app.home',FAIL_FOCUS_TRANSPORT:'1'},{FAIL_FOCUS_TIMEOUT:'1'},
    {BAD_FOCUS_RESPONSE:'1'},{MULTIPLE_FOCUS:'1'}]) {
    f=fixture();pass(f.install(),'overlay routing fixture');pass(f.toggle(overrides),'unsafe or non-Home focus uses overlay');
    assert.equal(f.launches()[0].id,'com.gathin.tvcontrolcentre');assert.equal(f.launches()[0].params.toggle,true);
    assert(!f.lines().includes('native-home'),'focused overlay over Home must dismiss itself before Home can open');
  }
  for (const missing of ['active','frontend','frontend-reference','manifest']) {
    f=fixture();pass(f.install(),'missing optional Home prerequisite');
    if(missing==='active')fs.unlinkSync(f.homeActive);
    if(missing==='frontend')fs.unlinkSync(f.home+'/home-settings.js');
    if(missing==='frontend-reference')fs.writeFileSync(f.home+'/index.html','<!doctype html>');
    if(missing==='manifest')fs.writeFileSync(f.home+'/appinfo.json','{"id":"foreign","type":"web","main":"index.html"}');
    pass(f.toggle({FOCUSED:'com.webos.app.home'}),'native route gated by '+missing);
    assert.equal(f.launches()[0].id,'com.gathin.tvcontrolcentre');assert(fs.existsSync(f.snapshot));
  }
  for (const [field,value] of [['id','com.foreign.home'],['type','native'],['folderPath','/foreign/home'],['main','foreign.html']]) {
    f=fixture();f.descriptor.appDesc[field]=value;fs.writeFileSync(f.homeDescription,JSON.stringify(f.descriptor));
    pass(f.install(),'invalid native descriptor fixture');pass(f.toggle({FOCUSED:'com.webos.app.home'}),'reject descriptor '+field);
    assert.equal(f.launches()[0].id,'com.gathin.tvcontrolcentre');assert(fs.existsSync(f.snapshot));
  }
  f=fixture();pass(f.install(),'template tampering fixture');pass(f.toggle({FOCUSED:'com.webos.app.home'}),'generate native template');
  fs.writeFileSync(f.base+'/recovery/home-wam-request.json','{"appDesc":{"id":"foreign"}}');
  fs.writeFileSync(f.uptime,'100.30 200.30\n');pass(f.toggle({FOCUSED:'com.webos.app.home'}),'tampered template is revalidated and rebuilt');
  assert.equal(f.launches()[1].appDesc.id,'com.webos.app.home');
  assert.equal(f.lines().filter(l=>l==='node authorization').length,2,'generated template digest is part of warm cache');
  fs.unlinkSync(f.homeActive);fs.writeFileSync(f.uptime,'100.60 200.60\n');
  pass(f.toggle({FOCUSED:'com.webos.app.home'}),'deactivated native adapter invalidates cached route');
  assert.equal(f.launches()[2].id,'com.gathin.tvcontrolcentre');assert(!fs.existsSync(f.base+'/recovery/home-wam-request.json'));
  for (const focused of ['com.webos.app.home','com.gathin.tvhome']) for (const failure of ['FAIL_HOME','FAIL_HOME_TRANSPORT']) {
    f=fixture();pass(f.install(),'Home failure fixture');pass(f.toggle({FOCUSED:focused,[failure]:'1'}),'failed Home route falls back to LG Settings');
    assert.equal(f.launches().length,2);assert.equal(f.launches()[1].id,'com.palm.app.settings');
  }
  // Every authorization input participates in the native digest. Changes force
  // full validation, even when byte length and timestamps are unchanged.
  for (const target of ['key','snapshot','manifest','html']) {
    f=fixture();pass(f.install(),'cache invalidation fixture');pass(f.toggle(),'warm initial cache');
    if(target==='key'){const keys=f.readKeys();keys['42']={action:'replace'};f.writeKeys(keys);}
    if(target==='snapshot'){const old=f.old();old.confirmed=true;fs.writeFileSync(f.snapshot,JSON.stringify(old));}
    if(target==='manifest'){f.manifest.version='1.2.3';fs.writeFileSync(f.app+'/appinfo.json',JSON.stringify(f.manifest));}
    if(target==='html')fs.writeFileSync(f.app+'/overlay.html','<!doctype HTML>');
    fs.writeFileSync(f.uptime,'100.30 200.30\n');pass(f.toggle(),'revalidate changed '+target);
    assert.equal(f.lines().filter(l=>l==='node authorization').length,2,target+' change invalidates cached authorization');
    assert.equal(f.launches().length,2);
  }
  f=fixture();pass(f.install(),'foreign cache fixture');pass(f.toggle(),'warm cache before foreign key');
  changed=f.readKeys();changed['139']={action:'exec',command:'/foreign/settings'};f.writeKeys(changed);
  fs.writeFileSync(f.uptime,'100.30 200.30\n');pass(f.toggle(),'foreign key invalidates authorization');
  assert.deepEqual(f.readKeys(),changed);assert.equal(f.launches().at(-1).id,'com.palm.app.settings');
  f=fixture();pass(f.install(),'expired cache fixture');pass(f.toggle(),'warm cache before expiry');f.expire();
  pass(f.toggle(),'snapshot expiry invalidates cache and restores');assert.deepEqual(f.readKeys(),f.original);
  f=fixture();pass(f.install(),'native expiry fixture');pass(f.toggle(),'warm native expiry cache');
  const cache=f.base+'/recovery/launch-cache',cached=fs.readFileSync(cache,'utf8').split('\n');
  cached[1]='1';fs.writeFileSync(cache,cached.join('\n'));
  pass(f.toggle(),'expired cached authorization restores without Node validation');assert.deepEqual(f.readKeys(),f.original);
  assert.equal(f.lines().filter(l=>l==='node authorization').length,1,'native deadline gate avoids a slow validation call');
  assert.equal(f.launches().at(-1).id,'com.palm.app.settings');
  for (const overrides of [{FAIL_OVERLAY:'1'},{FAIL_OVERLAY_TRANSPORT:'1'}]) {
    f=fixture();pass(f.install(),'fallback fixture');pass(f.toggle(overrides),'failed overlay falls back');
    assert.deepEqual(f.launches().map(l=>l.id),['com.gathin.tvcontrolcentre','com.palm.app.settings']);
  }
  f=fixture();pass(f.install(),'timeout fixture');pass(f.toggle({FAIL_TIMEOUT:'1'}),'timeout is handled');
  assert.equal(f.lines().filter(l=>l==='timeout').length,2,'overlay timeout makes a bounded Settings fallback attempt');
  f=fixture();pass(f.install(),'expired reboot fixture');f.expire();fs.rmSync(f.run,{recursive:true});
  pass(f.toggle(),'durable expiry checked after loss of temporary files');assert.deepEqual(f.readKeys(),f.original);
  assert.deepEqual(f.launches().map(l=>l.id),['com.palm.app.settings']);assert(!fs.existsSync(f.snapshot));
  f=fixture();pass(f.install(),'uninstalled overlay fixture');fs.unlinkSync(f.app+'/overlay.html');
  pass(f.toggle(),'missing app restores key and opens Settings');assert.deepEqual(f.readKeys(),f.original);
  assert.deepEqual(f.launches().map(l=>l.id),['com.palm.app.settings']);
  f=fixture();pass(f.install(),'busy toggle fixture');pass(f.toggle({FAIL_LOCK:'1'}),'busy toggle is ignored');noLaunch(f,'busy toggle cannot launch twice');
  f=fixture();pass(f.install(),'watchdog lock fixture');
  pass(f.toggle({CHECK_WATCHDOG_LOCK:'1'}),'close-like toggle keeps lock only in parent');
  fs.writeFileSync(f.uptime,'100.60 200.60\n');
  pass(f.toggle({CHECK_WATCHDOG_LOCK:'1'}),'next intentional toggle is not retained by a timeout watchdog');
  assert.equal(f.launches().length,2);
  assert.equal(f.lines().filter(line=>line==='parent-toggle-lock').length,2,'both wrappers retain their own serialization fd');
  assert.deepEqual(f.lines().filter(line=>line.includes('-watchdog-lock ')),[
    'query-watchdog-lock free','launch-watchdog-lock free','query-watchdog-lock free','launch-watchdog-lock free'
  ],'neither bounded focus query nor launch can pass the toggle lock to its watchdog');
  for (const focused of ['youtube.leanback.v4','com.apple.applemusic','netflix']) {
    f=fixture();f.nativeHelper();pass(f.install(),'native eligible fixture');
    pass(f.toggle({FOCUSED:focused}),'eligible source delegates to short coordinator');
    noLaunch(f,'coordinator owns native-before-web launch');assert(f.lines().includes('native request '+focused));
    fs.writeFileSync(f.uptime,'100.30 200.30\n');pass(f.toggle({FOCUSED:focused,NATIVE_RESULT:'10'}),'busy/disabled native falls back plain');
    assert.equal(f.launches()[0].id,'com.gathin.tvcontrolcentre');
  }
  f=fixture();f.nativeHelper();fs.writeFileSync(f.nativeRun+'/current.json','{}');
  fs.writeFileSync(f.native+'/disabled','disabled');pass(f.install(),'disabled native fixture');
  pass(f.toggle({FOCUSED:'netflix'}),'disabled native opens the ordinary overlay directly');
  fs.writeFileSync(f.uptime,'100.30 200.30\n');
  pass(f.toggle({FOCUSED:'com.gathin.tvcontrolcentre'}),'disabled native preserves ordinary overlay close routing');
  assert(!f.lines().some(line=>line.startsWith('native ')),'disabled runtime invokes neither request nor close helper');
  assert.equal(f.launches().length,2);
  for(const request of f.launches()){
    assert.equal(request.id,'com.gathin.tvcontrolcentre');assert.equal(request.params.toggle,true);
    assert.equal(request.params.nativeBlur,undefined);
  }
  for (const focused of ['com.webos.app.home','com.gathin.tvhome','com.gathin.tvcontrolcentre','netflix.clone']) {
    f=fixture();f.nativeHelper();fs.writeFileSync(f.nativeRun+'/current.json','{}');pass(f.install(),'native close routing');
    pass(f.toggle({FOCUSED:focused}),'existing Home and plain close behavior preserved');
    assert(f.lines().includes('native close '));assert(!f.lines().some(line=>line.startsWith('native request ')));
    const request=f.launches()[0];
    assert.equal(request.appDesc?request.appDesc.id:request.id,focused==='netflix.clone'?'com.gathin.tvcontrolcentre':focused);
  }
  f=fixture();f.nativeHelper();fs.writeFileSync(f.nativeRun+'/current.json','{}');pass(f.install(),'native restore fixture');
  pass(f.control('restore'),'restoring Settings cancels owned native session');assert(f.lines().includes('native close '));assert.deepEqual(f.readKeys(),f.original);
  console.log('Settings recovery, trial expiry, cached authorization, focused Home/overlay routing, debounce and bounded launch fallback checks passed.');
} finally {
  // Removing leases lets fixture guards exit; no host UI or TV state is touched.
  for (const f of fixtures) fs.rmSync(f.dir,{recursive:true,force:true});
}
