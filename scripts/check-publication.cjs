// Real temporary files/processes; all Luna calls are a local fixture executable.
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process'),vm=require('vm');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'lg-publication-'));
const data=path.join(dir,'data'),app=path.join(dir,'app'),bin=path.join(dir,'bin');
[data,app,bin].forEach(p=>fs.mkdirSync(p));
const env={...process.env,LG_LAUNCHER_DATA:data,LG_LAUNCHER_APP_DIR:app,PATH:bin+':'+process.env.PATH};
const quote=s=>"'"+s.replace(/'/g,"'\\''")+"'";
function run(args=[]){const r=cp.spawnSync(process.execPath,[path.join(root,'tv/sync.js'),...args],{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
function stat(file){const s=fs.statSync(file);return {ino:s.ino,mtime:s.mtimeMs};}
function inventoryData(){const scope={window:{}};vm.runInNewContext(fs.readFileSync(path.join(app,'apps.js'),'utf8'),scope);return scope.window.TV_APPS;}
function inventory(){return inventoryData().apps;}
function child(script,args=[]){return new Promise((resolve,reject)=>{const p=cp.spawn(process.execPath,[script,...args],{env});let out='';p.stderr.on('data',b=>out+=b);p.on('error',reject);p.on('exit',code=>code?reject(new Error(out||'worker exit '+code)):resolve());});}
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('fixture timed out');}
(async()=>{
  const icon=path.join(dir,'source.png');fs.writeFileSync(icon,'icon-v1');
  const points=path.join(dir,'points.json'),inputs=path.join(dir,'inputs.json'),calls=path.join(dir,'luna-calls');
  fs.writeFileSync(points,JSON.stringify({launchPoints:[{id:'example.app',title:'Example',icon}]}));
  fs.writeFileSync(inputs,JSON.stringify({devices:[{appId:'com.webos.app.hdmi1',label:'HDMI 1'}]}));
  fs.writeFileSync(path.join(bin,'luna-send'),'#!/bin/sh\necho call >> '+quote(calls)+'\ncase "$3" in *listLaunchPoints) cat '+quote(points)+';; *) cat '+quote(inputs)+';; esac\n',{mode:0o755});
  fs.writeFileSync(path.join(data,'settings.json'),'{"wallpaperDim":0.12}');
  run();const files=['apps.js','user.js','icons/example.app.png'].map(f=>path.join(app,f));const first=files.map(stat);
  const firstIcon=inventory()[0].icon;
  assert(/^icons\/example\.app\.png\?v=[a-f0-9]{64}$/.test(firstIcon),'published icon URLs include a content version');
  run();assert.deepEqual(files.map(stat),first,'unchanged inventory/settings/icons retain inodes and mtimes');
  fs.writeFileSync(icon,'icon-v2');fs.utimesSync(icon,new Date(),new Date(Date.now()+1000));run();
  assert.equal(fs.readFileSync(files[2],'utf8'),'icon-v2');assert.notEqual(inventory()[0].icon,firstIcon,'changed bytes change the published icon URL');
  const updatedInventory=stat(files[0]);run();assert.deepEqual(stat(files[0]),updatedInventory,'unchanged content does not churn its version');
  fs.writeFileSync(files[2],'package-icon');run();
  assert.equal(fs.readFileSync(files[2],'utf8'),'icon-v2','package overwriting destination must not bypass custom icon restoration');
  const cachedIcon=inventory()[0].icon;
  fs.writeFileSync(points,JSON.stringify({launchPoints:[{id:'example.app',title:'Renamed',icon:path.join(dir,'missing.png')},
    {id:'missing.icon.app',title:'No icon',icon:path.join(dir,'missing.png')},{id:'blocked.icon.app',title:'Cannot copy',icon}]}));
  fs.mkdirSync(path.join(app,'icons/blocked.icon.app.png'));run();
  assert.equal(inventory().length,3,'missing and failed icon copies never remove launchable apps');
  assert.equal(inventory().find(a=>a.id==='example.app').icon,cachedIcon,'missing source retains cached icon');
  assert.equal(inventory().find(a=>a.id==='missing.icon.app').icon,'marks/apps.svg');
  assert.equal(inventory().find(a=>a.id==='blocked.icon.app').icon,'marks/apps.svg');
  fs.rmdirSync(path.join(app,'icons/blocked.icon.app.png'));
  const shim=path.join(dir,'unreadable-icon.cjs');fs.writeFileSync(shim,`const fs=require('fs'),read=fs.readFileSync;
    fs.readFileSync=function(file,...args){if(file===process.env.FAIL_ICON_READ_PATH){const error=new Error('fixture EACCES');error.code='EACCES';throw error;}return read.call(fs,file,...args)};`);
  fs.writeFileSync(points,JSON.stringify({launchPoints:[{id:'example.app',title:'Renamed',icon},{id:'unreadable.app',title:'Unreadable',icon}]}));
  const failedCopy=cp.spawnSync(process.execPath,['-r',shim,path.join(root,'tv/sync.js')],{env:{...env,FAIL_ICON_READ_PATH:icon},encoding:'utf8'});
  assert.equal(failedCopy.status,0,failedCopy.stderr);
  assert.equal(inventory().find(a=>a.id==='example.app').icon,cachedIcon,'unreadable source retains cached icon');
  assert.equal(inventory().find(a=>a.id==='unreadable.app').icon,'marks/apps.svg');
  fs.writeFileSync(points,JSON.stringify({launchPoints:['example.app','removed.app','replaced.app'].map(id=>({id,title:id,icon}))}));run();
  fs.writeFileSync(path.join(app,'icons/unmanaged.png'),'bundled icon');
  fs.writeFileSync(path.join(app,'icons/replaced.app.png'),'manually replaced');
  fs.writeFileSync(points,JSON.stringify({launchPoints:[{id:'example.app',title:'Renamed',icon}]}));run();
  assert(!fs.existsSync(path.join(app,'icons/removed.app.png')),'removed app managed icon is pruned');
  assert.equal(fs.readFileSync(path.join(app,'icons/unmanaged.png'),'utf8'),'bundled icon');
  assert.equal(fs.readFileSync(path.join(app,'icons/replaced.app.png'),'utf8'),'manually replaced','foreign replacements are retained');
  fs.writeFileSync(points,JSON.stringify({launchPoints:[{id:'example.app',title:{bad:true},icon,iconColor:42,bgColor:'#123456'},
    {id:'metadata.app',title:9,icon:{bad:true},largeIcon:12,iconColor:['bad'],bgColor:{bad:true}}]}));
  fs.writeFileSync(inputs,JSON.stringify({devices:[null,[],{appId:42},{appId:'com.webos.app.hdmi1',label:42,id:'HDMI 1'},
    {appId:'com.webos.app.hdmi2',label:{bad:true},id:9}]}));run();
  assert.equal(inventory()[0].title,'example.app','non-string titles fall back to the app ID');
  assert.equal(inventory()[0].iconColor,'#123456','malformed primary color uses a valid background color');
  assert.equal(inventory()[1].title,'metadata.app');assert.equal(inventory()[1].iconColor,'');
  assert.equal(inventory()[1].icon,'marks/apps.svg');
  assert.deepEqual(Array.from(inventoryData().inputs,i=>[i.appId,i.label]),[
    ['com.webos.app.hdmi1','HDMI 1'],['com.webos.app.hdmi2','com.webos.app.hdmi2']]);
  for(const badInputs of [{returnValue:false,devices:[{appId:'untrusted'}]},{devices:{length:1}},null]) {
    fs.writeFileSync(inputs,JSON.stringify(badInputs));run();
    assert.equal(inventoryData().inputs.length,4,'failed or malformed inputs use standard HDMI defaults');
  }
  const diskShim=path.join(dir,'app-folders.cjs');
  fs.writeFileSync(diskShim,`const fs=require('fs'),path=require('path'),read=fs.readFileSync,list=fs.readdirSync;
    const folders=['/usr/palm/applications','/media/cryptofs/apps/usr/palm/applications','/media/developer/apps/usr/palm/applications','/mnt/otycabi/usr/palm/applications','/mnt/otncabi/usr/palm/applications'];
    fs.readdirSync=function(file,...args){if(folders.includes(file))return file===folders[0]&&process.env.SYNC_DISK_FIXTURE?list.call(fs,process.env.SYNC_DISK_FIXTURE,...args):[];return list.call(fs,file,...args)};
    fs.readFileSync=function(file,...args){if(typeof file==='string'&&file.startsWith(folders[0]+'/')&&process.env.SYNC_DISK_FIXTURE)file=path.join(process.env.SYNC_DISK_FIXTURE,file.slice(folders[0].length+1));return read.call(fs,file,...args)};`);
  const safeInventory=fs.readFileSync(files[0],'utf8'),safeCache=fs.readFileSync(path.join(data,'icon-cache.json'),'utf8');
  for(const badPoints of [{launchPoints:{length:1}},{returnValue:false,launchPoints:[{id:'untrusted'}]},
    {launchPoints:[{id:'good'},null]},{launchPoints:[{id:42}]},{launchPoints:[{id:''}]}]) {
    fs.writeFileSync(points,JSON.stringify(badPoints));
    const failed=cp.spawnSync(process.execPath,['-r',diskShim,path.join(root,'tv/sync.js')],{env:{...env,SYNC_TRIES:'1'},encoding:'utf8'});
    assert.notEqual(failed.status,0,'malformed or failed inventory cannot replace the published list');
    assert.equal(fs.readFileSync(files[0],'utf8'),safeInventory);assert.equal(fs.readFileSync(path.join(data,'icon-cache.json'),'utf8'),safeCache);
  }
  const disk=path.join(dir,'disk-apps');fs.mkdirSync(disk);for(const id of ['good','bad'])fs.mkdirSync(path.join(disk,id));
  fs.writeFileSync(path.join(disk,'good/appinfo.json'),JSON.stringify({id:'disk.app',title:{bad:true},icon:{bad:true},largeIcon:12,iconColor:{bad:true}}));
  fs.writeFileSync(path.join(disk,'bad/appinfo.json'),JSON.stringify({id:42,title:'Invalid app ID'}));
  const fromDisk=cp.spawnSync(process.execPath,['-r',diskShim,path.join(root,'tv/sync.js')],{env:{...env,SYNC_TRIES:'1',SYNC_DISK_FIXTURE:disk},encoding:'utf8'});
  assert.equal(fromDisk.status,0,fromDisk.stderr);assert.equal(inventory().length,1);
  assert.equal(inventory()[0].id,'disk.app');assert.equal(inventory()[0].title,'disk.app');assert.equal(inventory()[0].icon,'marks/apps.svg');
  fs.writeFileSync(points,JSON.stringify({launchPoints:[{id:'example.app',title:'Renamed',icon}]}));
  fs.writeFileSync(inputs,JSON.stringify({devices:[{appId:'com.webos.app.hdmi1',label:'HDMI 1'}]}));
  const oldCalls=fs.readFileSync(calls,'utf8');fs.writeFileSync(path.join(data,'settings.json'),'{"wallpaperDim":0.4}');run(['--settings']);
  assert.equal(fs.readFileSync(calls,'utf8'),oldCalls,'settings publication never calls Luna');
  assert(fs.readFileSync(files[1],'utf8').includes('"wallpaperDim":0.4'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(data,'settings-published.json'),'utf8')).wallpaperDim,0.4,'successful settings snapshot is persisted');
  fs.writeFileSync(path.join(data,'wallpaper.jpg'),'photo');fs.writeFileSync(path.join(data,'wallpaper-frost.jpg'),'frost');run(['--settings']);
  assert(/bg-frost-/.test(fs.readFileSync(files[1],'utf8')),'precomputed frost published');
  const assets=fs.readdirSync(app).filter(f=>/^bg/.test(f));run(['--settings']);assert.deepEqual(fs.readdirSync(app).filter(f=>/^bg/.test(f)),assets);
  const worker=path.join(dir,'worker.cjs'),log=path.join(dir,'work.log'),hold=path.join(dir,'hold');
  fs.writeFileSync(worker,`const p=require(${JSON.stringify(path.join(root,'tv/publication.js'))}),fs=require('fs'),cp=require('child_process');
    p.enqueue(process.argv[2]||'settings',mode=>{const fd=fs.openSync(${JSON.stringify(path.join(dir,'active'))},'wx');
      fs.appendFileSync(${JSON.stringify(log)},'start '+mode+'\\n');
      while(fs.existsSync(${JSON.stringify(hold)}))cp.execFileSync('/bin/sleep',['0.02']);
      fs.appendFileSync(${JSON.stringify(log)},'end '+mode+'\\n');fs.closeSync(fd);fs.unlinkSync(${JSON.stringify(path.join(dir,'active'))});
    },err=>{if(err)throw err;fs.appendFileSync(${JSON.stringify(log)},'done\\n');});`);
  const queue=path.join(data,'publication-queue'),lock=path.join(queue,'.lock');fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner'),String(process.pid));
  function releaseFixtureLock(){const held=path.join(dir,'held-lock');fs.renameSync(lock,held);fs.unlinkSync(path.join(held,'owner'));fs.rmdirSync(held);}
  const workers=Array.from({length:6},(_,i)=>child(worker,[i===0?'full':'settings']));
  await until(()=>fs.readdirSync(queue).filter(f=>f.endsWith('.request')).length===6);
  releaseFixtureLock();await Promise.all(workers);
  let rows=fs.readFileSync(log,'utf8').trim().split('\n');assert.equal(rows.filter(r=>r.startsWith('start')).length,1,'pending cross-process jobs coalesce');
  assert.equal(rows[0],'start full');assert.equal(rows[1],'end full');assert.equal(rows.filter(r=>r==='done').length,6,'all callers receive completion');
  fs.writeFileSync(log,'');fs.writeFileSync(hold,'');const firstWorker=child(worker);
  await until(()=>fs.existsSync(path.join(dir,'active')));const secondWorker=child(worker);
  await until(()=>fs.readdirSync(queue).filter(f=>f.endsWith('.request')).length===2);fs.unlinkSync(hold);
  await Promise.all([firstWorker,secondWorker]);rows=fs.readFileSync(log,'utf8').trim().split('\n');
  assert.equal(rows.filter(r=>r.startsWith('start')).length,2,'change arriving during publication gets a subsequent batch');
  fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner'),'2147483647');
  await Promise.all(Array.from({length:12},()=>child(worker)));
  assert(!fs.existsSync(lock),'dead worker lock recovered');
  assert(!fs.readdirSync(queue).some(f=>f.startsWith('.claim-')),'all unused claim directories cleaned');
  async function stopWaiter(signal) {
    fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner'),String(process.pid));
    const p=cp.spawn(process.execPath,[worker],{env,stdio:'ignore'});
    await until(()=>fs.readdirSync(queue).some(f=>f.endsWith('.request'))&&fs.readdirSync(queue).some(f=>f.startsWith('.claim-')));
    const stopped=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',resolve);});p.kill(signal);await stopped;
    if(signal==='SIGTERM')assert(!fs.readdirSync(queue).some(f=>/\.request$|^\.claim-/.test(f)),'SIGTERM cleans the owned request and claim');
    releaseFixtureLock();await child(worker);
    assert.deepEqual(fs.readdirSync(queue),[],signal+' artifacts are removed after the next successful publication');
  }
  await stopWaiter('SIGTERM');await stopWaiter('SIGKILL');
  // Exercise Linux PID-reuse recovery even when this local test runs on macOS.
  const identityShim=path.join(dir,'proc-identity.cjs');
  const statFields=Array(20).fill('0');statFields[0]='S';statFields[19]='987';
  fs.writeFileSync(identityShim,`const fs=require('fs'),read=fs.readFileSync;
    fs.readFileSync=function(file,...args){if(/^\\/proc\\/[0-9]+\\/stat$/.test(file))return ${JSON.stringify('123 (node) '+statFields.join(' '))};
      if(file==='/proc/sys/kernel/random/boot_id')return 'current-boot';return read.call(fs,file,...args)};`);
  fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner'),JSON.stringify({pid:process.pid,identity:'previous-boot:987'}));
  const reusedPid=cp.spawnSync(process.execPath,['-r',identityShim,worker],{env,encoding:'utf8',timeout:5000});
  assert.equal(reusedPid.status,0,reusedPid.stderr||'PID reused by a different boot must not block the queue');
  assert(!fs.existsSync(lock),'lock from an earlier process identity is recovered without signaling the new process');
  const deadToken=Date.now()+'-2147483647-1-dead',liveToken=Date.now()+'-'+process.pid+'-1-abcd';
  fs.writeFileSync(path.join(queue,deadToken+'.done'),JSON.stringify({error:null,owner:{pid:2147483647,identity:''}}));
  fs.writeFileSync(path.join(queue,liveToken+'.done'),JSON.stringify({error:null,owner:{pid:process.pid,identity:''}}));
  const foreignClaim=path.join(queue,'.claim-'+Date.now()+'-2147483647-2-beef');fs.mkdirSync(foreignClaim);fs.writeFileSync(path.join(foreignClaim,'unrelated'),'keep');
  const foreignRequest=path.join(queue,'foreign.request');fs.writeFileSync(foreignRequest,'keep');
  const malformedRequest=path.join(queue,Date.now()+'-2147483647-3-abcd.request');fs.writeFileSync(malformedRequest,'keep');
  await child(worker);
  assert(!fs.existsSync(path.join(queue,deadToken+'.done')),'dead caller receipts are collected');
  assert(fs.existsSync(path.join(queue,liveToken+'.done')),'live caller receipts survive collection');
  assert.equal(fs.readFileSync(path.join(foreignClaim,'unrelated'),'utf8'),'keep','foreign claim contents survive collection');
  assert.equal(fs.readFileSync(foreignRequest,'utf8'),'keep','foreign requests are not consumed');
  assert.equal(fs.readFileSync(malformedRequest,'utf8'),'keep','a matching filename alone does not prove queue ownership');
  console.log('Atomic writes, malformed metadata, versioned/fallback icons, owned icon pruning, settings-only publication, queue coalescing, signal/crash cleanup and foreign ownership checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
