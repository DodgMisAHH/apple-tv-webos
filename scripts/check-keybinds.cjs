// Regression checks for preserving existing remote bindings and restoring only Home.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-home-'));
const config = path.join(root,'keybinds.json'), backup=path.join(root,'before.json');
const script = path.resolve(__dirname,'../tv/keybinds.js'), command='/home/root/lg-tv-vibehack/golauncher.sh';
const original = {'773':{action:'replace',key:1},'42':{action:'disable'}};
function run(mode) { return spawnSync(process.execPath,[script,mode,config,backup,command],{encoding:'utf8'}); }
function read(file) { return JSON.parse(fs.readFileSync(file,'utf8')); }
try {
  fs.writeFileSync(config,JSON.stringify(original));
  assert.equal(run('install').status,0);
  assert.deepEqual(read(config)['42'],original['42']);
  const firstBackup=fs.readFileSync(backup,'utf8');
  assert.equal(run('install').status,0);
  assert.equal(fs.readFileSync(backup,'utf8'),firstBackup);
  const changed=read(config); changed['99']={action:'disable'};
  fs.writeFileSync(config,JSON.stringify(changed));
  assert.equal(run('restore').status,0);
  assert.deepEqual(read(config)['773'],original['773']);
  assert.deepEqual(read(config)['99'],changed['99']);
  assert(!fs.existsSync(backup),'a completed restoration consumes its snapshot');
  assert.equal(run('install').status,0,'Home can be enabled again after disable');
  assert.equal(run('restore').status,0);
  fs.writeFileSync(backup,firstBackup);
  assert.equal(run('install').status,0,'a legacy restored snapshot is reusable when its binding matches exactly');
  assert.equal(fs.readFileSync(backup,'utf8'),firstBackup,'legacy recovery bytes are retained during reinstall');
  const foreign=read(config);foreign['773']={action:'replace',key:55};
  fs.writeFileSync(config,JSON.stringify(foreign));
  assert.equal(run('restore').status,0);
  assert.deepEqual(read(config),foreign,'a newer foreign Home binding is retained');
  assert(fs.existsSync(backup),'foreign changes retain recovery information');
  assert.notEqual(run('install').status,0,'reinstall must not overwrite a foreign binding with a retained snapshot');
  const ours=read(config);ours['773']={action:'exec',command};fs.writeFileSync(config,JSON.stringify(ours));
  fs.writeFileSync(backup,'{"present":"yes"}');
  assert.notEqual(run('restore').status,0,'invalid snapshots cannot discard a binding');
  assert.deepEqual(read(config),ours);
  // Malformed config must be retained byte-for-byte, never silently replaced.
  fs.writeFileSync(config,'{bad');
  assert.notEqual(run('install').status,0);
  assert.equal(fs.readFileSync(config,'utf8'),'{bad');
  console.log('Home mapping, enable/disable/re-enable, foreign binding preservation and malformed recovery checks passed.');
} finally { fs.rmSync(root,{recursive:true,force:true}); }
