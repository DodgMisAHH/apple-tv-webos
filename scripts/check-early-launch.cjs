// Exercise the real retry loop with local command stubs; no TV connection.
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert');
const {spawnSync}=require('child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lg-early-'));
const source=fs.readFileSync(path.join(__dirname,'../tv/early-launch.sh'),'utf8')
 .replace('export PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH','');
try {
 fs.writeFileSync(path.join(dir,'run.sh'),source);
 fs.writeFileSync(path.join(dir,'luna-send'),`#!/bin/sh
n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
n=$((n + 1)); echo "$n" > "$COUNT_FILE"
if [ "$n" -ge "$SUCCESS_AFTER" ]; then echo '{"returnValue":true}'; else echo '{"returnValue":false}'; fi
`,{mode:0o755});
 fs.writeFileSync(path.join(dir,'sleep'),'#!/bin/sh\nexit 0\n',{mode:0o755});
 for(const [success,count,status] of [[1,1,0],[3,3,0],[99,6,1]]){
  const file=path.join(dir,'count');fs.rmSync(file,{force:true});
  const r=spawnSync('/bin/sh',[path.join(dir,'run.sh')],{env:{...process.env,PATH:dir+':'+process.env.PATH,COUNT_FILE:file,SUCCESS_AFTER:String(success)}});
  assert.equal(r.status,status);assert.equal(Number(fs.readFileSync(file)),count);
 }
 console.log('Early launch success, transient failure and bounded-retry checks passed.');
} finally {fs.rmSync(dir,{recursive:true,force:true})}
