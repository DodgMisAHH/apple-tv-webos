'use strict';
// All process inventory, Luna, HTTP and clocks below are isolated fixtures.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const vm = require('vm'), EventEmitter = require('events');
const runtime = require('../tv/native-blur/runtime.js');
const root = path.resolve(__dirname, '..'), folders = [];
const SOURCE = 'com.apple.applemusic', WEB = 'com.gathin.tvcontrolcentre', NATIVE = 'com.gathin.nativeblurdiagnostic';
function temporary() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-runtime-')); folders.push(dir); return dir; }
function json(file, value) { fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(value)); }
function procStat(start) { return '41 (worker with ) spaces) S ' + Array(18).fill('0').join(' ') + ' ' + start + ' 0\n'; }
function fixture() {
  const dir = temporary(), base = dir+'/base', run = dir+'/run', proc = dir+'/proc', app = dir+'/app';
  for (const p of [base, run+'/sessions', proc, app]) fs.mkdirSync(p, {recursive:true});
  for (const name of ['runtime.sh','worker.sh','runtime.js','bridge.js','Host.qml','Backdrop.qml']) fs.writeFileSync(base+'/'+name, '// fixture');
  fs.writeFileSync(app+'/native-blur.js', '// client'); fs.writeFileSync(app+'/overlay.html', '<script src="native-blur.js"></script>');
  let time = 100000, pid = 5000, spawn = [], acknowledge = true;
  const writeProcess = (record, args) => {
    fs.mkdirSync(proc+'/'+record.pid, {recursive:true}); fs.writeFileSync(proc+'/'+record.pid+'/stat', procStat(record.start));
    fs.writeFileSync(proc+'/'+record.pid+'/cmdline', (args || ['/usr/bin/node',base+'/runtime.js','worker',record.id,record.source]).join('\0')+'\0');
  };
  const f = {dir,base,run,proc,app,spawn,writeProcess,now:()=>time,tick:ms=>{time+=ms;},ack:value=>{acknowledge=value;}};
  f.current = () => JSON.parse(fs.readFileSync(run+'/current.json','utf8'));
  f.state = (record, phase, extra={}) => json(run+'/sessions/'+record.id+'/worker.json',{...record,phase,at:time,...extra});
  f.api = runtime.create({base,run,proc,app,now:()=>time,cp:{spawn(command,args,options) {
    assert.equal(command,'/bin/sh'); assert.equal(args[0],base+'/worker.sh');
    assert.deepEqual(options,{detached:true,stdio:'ignore'},'worker does not inherit toggle fd8 or request fd7');
    const child = new EventEmitter(); child.pid = ++pid; child.unref = ()=>{};
    const record = {id:args[1],source:args[2],pid:child.pid,start:String(pid*10),at:time};
    writeProcess(record,['/bin/sh',base+'/worker.sh',record.id,record.source]); spawn.push(record);
    if (acknowledge) {writeProcess(record);f.state(record,'opening');}
    return child;
  }}});
  return f;
}
async function coordinatorChecks() {
  assert.equal(runtime.startTime(procStat('12345')),'12345');
  assert.equal(runtime.startTime('broken'),null);
  // The TV needed 2.585s to load Node. Delegate without holding the Settings
  // lock for an acknowledgement or creating a premature startup-timeout cancel.
  let slow=fixture(); slow.ack(false); let returned=false;
  const handoff=slow.api.request(SOURCE).then(code=>{assert.equal(code,0);returned=true;});
  await Promise.resolve();await Promise.resolve();assert(returned,'handoff does not wait for worker JS startup');await handoff;
  let pending=slow.current();assert(slow.api.identity(pending));assert.equal(slow.api.state(pending),null);
  slow.tick(2585);slow.writeProcess(pending);slow.state(pending,'opening');
  assert(!slow.api.cancelled(pending),'healthy slow worker reaches startup without a deadline cancellation');
  slow=fixture();slow.ack(false);await slow.api.request(SOURCE);pending=slow.current();
  assert.equal(await slow.api.request(SOURCE),0,'second press consumes/cancels an unacknowledged opening');
  assert(slow.api.cancelled(pending));assert.equal(slow.spawn.length,1,'pending cancellation never spawns a replacement');
  let f = fixture();
  assert.equal(await f.api.request('netflix.clone'),10); assert.equal(f.spawn.length,0);
  fs.writeFileSync(f.base+'/disabled','disabled'); assert.equal(await f.api.request(SOURCE),10); fs.unlinkSync(f.base+'/disabled');
  fs.writeFileSync(f.app+'/overlay.html','plain'); assert.equal(await f.api.request(SOURCE),10);
  fs.writeFileSync(f.app+'/overlay.html','<script src="native-blur.js"></script>');
  fs.writeFileSync(f.base+'/qml-release','../foreign'); assert.equal(f.api.available(),false);
  fs.writeFileSync(f.base+'/qml-release','1.0.21'); assert.equal(f.api.available(),false);
  fs.mkdirSync(f.base+'/releases/1.0.21',{recursive:true});
  for(const name of ['Host.qml','Backdrop.qml'])fs.writeFileSync(f.base+'/releases/1.0.21/'+name,'// immutable');
  assert.equal(f.api.available(),true);
  assert.equal(await f.api.request(SOURCE),0); let current=f.current(); assert(f.api.identity(current));
  assert.equal(await f.api.request(SOURCE),0,'second press cancels opening'); assert.equal(f.spawn.length,1);
  assert(fs.existsSync(f.run+'/sessions/'+current.id+'/cancel.json'));
  f.state(current,'closing'); f.ack(false);
  assert.equal(await f.api.request(SOURCE),0,'closing queues rather than races an old SAM launch');
  let queued=f.current(); assert.equal(queued.previous.id,current.id); assert.equal(f.spawn.length,2);
  assert.equal(await f.api.request(SOURCE),0,'another press cancels queued opening');
  assert(fs.existsSync(f.run+'/sessions/'+queued.id+'/cancel.json'));
  assert(f.api.cancelled(current),'replaced generation cannot fall back later');

  f=fixture(); await f.api.request(SOURCE); current=f.current(); f.state(current,'active');
  assert.equal(await f.api.request(SOURCE),10,'a settled old session can give way to the ordinary overlay');
  fs.unlinkSync(f.run+'/sessions/'+current.id+'/cancel.json');
  await f.api.command('disable'); assert(fs.existsSync(f.base+'/disabled'));
  assert(fs.existsSync(f.run+'/sessions/'+current.id+'/cancel.json'),'disable still cancels current owned worker');
  await f.api.command('enable'); assert(!fs.existsSync(f.base+'/disabled'));
  fs.unlinkSync(f.run+'/sessions/'+current.id+'/cancel.json');
  f.writeProcess({...current,start:'999999'}); f.api.close();
  assert(!fs.existsSync(f.run+'/sessions/'+current.id+'/cancel.json'),'reused PID is never cancelled');
  assert.equal(await f.api.request(SOURCE),10); assert.equal(f.spawn.length,1);
  f.tick(runtime.quarantine-1); assert.equal(await f.api.request(SOURCE),10);
  f.tick(1); assert.equal(await f.api.request(SOURCE),0); assert.equal(f.spawn.length,2);

  f=fixture(); await f.api.request(SOURCE); current=f.current();
  f.writeProcess(current,['/usr/bin/node','/foreign/worker.js','worker',current.id,current.source]);
  f.api.close(); assert(!fs.existsSync(f.run+'/sessions/'+current.id+'/cancel.json'),'same start time but foreign argv is not owned');

  // A cancelled queued worker cannot turn an unverified predecessor death into
  // a verified close and let the following session bypass the native lease.
  for (const verified of [false,true]) {
    f=fixture();
    const prior={id:'a'.repeat(32),source:SOURCE,pid:43210,start:'123',at:f.now()};
    const record={id:'b'.repeat(32),source:SOURCE,pid:process.pid,start:'456',at:f.now(),previous:prior};
    f.writeProcess(record); json(f.run+'/current.json',record); f.state(prior,'closed',{cleanupVerified:verified});
    json(f.run+'/sessions/'+record.id+'/cancel.json',{id:record.id});
    if(verified) await f.api.command('worker',record.id,SOURCE);
    else await assert.rejects(f.api.command('worker',record.id,SOURCE),/Previous cleanup/);
    assert.equal(f.api.state(record).cleanupVerified,verified);
  }
  f=fixture();
  assert.equal(await f.api.request('netflix'),0); assert.equal(f.current().source,'netflix');
  f=fixture();
  for(let i=0;i<8;i++) {
    const id=i.toString(16).padStart(32,'0'); json(f.run+'/sessions/'+id+'/session-result.json',{});
    fs.utimesSync(f.run+'/sessions/'+id,new Date(i*1000),new Date(i*1000));
  }
  await f.api.request(SOURCE); assert.equal(fs.readdirSync(f.run+'/sessions').length,4,'known history is bounded');
  for(let i=0;i<100;i++)f.api.log({message:'x'.repeat(2000)});
  assert(fs.statSync(f.run+'/runtime.log').size<68000); assert(fs.statSync(f.run+'/runtime.log.1').size<68000);
}

function clock() {
  let now=10000,id=0;const tasks=new Map();
  const add=(fn,ms,repeat)=>{const key=++id;tasks.set(key,{fn,at:now+ms,repeat});return key;};
  async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
  async function advance(ms){const end=now+ms;await flush();for(;;){
    const next=[...tasks.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!next)break;now=next[1].at;tasks.delete(next[0]);if(next[1].repeat)tasks.set(next[0],{...next[1],at:now+next[1].repeat});
    next[1].fn();await flush();
  }now=end;await flush();}
  return {now:()=>now,advance,tasks,setTimeout:(fn,ms)=>add(fn,ms,0),setInterval:(fn,ms)=>add(fn,ms,ms),clear:id=>tasks.delete(id)};
}
function bridgeFixture(options={}) {
  const time=clock(), dir=temporary(), qml=dir+'/release-1.0.21', stateDir=dir+'/state';
  fs.mkdirSync(qml);fs.mkdirSync(stateDir);for(const name of ['Host.qml','Backdrop.qml'])fs.writeFileSync(qml+'/'+name,'// QML');
  const calls=[],stages=[],events=[],processStub=new EventEmitter();
  let requestHandler,server,native=false,web=false,webFocusAt=Infinity,owner=null,token=null,cancelled=false,finished=false,result,error;
  function post(route,body) {
    const req=new EventEmitter(),res=new EventEmitter();req.headers={origin:'null'};req.socket={remoteAddress:'127.0.0.1'};
    req.method='POST';req.url=route;req.setTimeout=()=>{};req.resume=()=>{};req.destroy=()=>{};
    res.writeHead=status=>{res.status=status;};res.end=()=>{res.finished=true;};
    requestHandler(req,res);req.emit('data',Buffer.from(JSON.stringify(body)));req.emit('end');return res.status;
  }
  function view(service) {
    const source=options.source||SOURCE;
    if(service.endsWith('getForegroundAppState'))return {returnValue:true,appId:source};
    if(service.includes('systemUIManager'))return {returnValue:true,foregroundAppInfo:native?[{appId:NATIVE}]:[]};
    if(service.endsWith('getFocusedWindowInfo'))return {returnValue:true,focusedWindowInfo:[{appId:web&&!options.neverWebFocus&&time.now()>=webFocusAt?WEB:source}]};
    return {returnValue:true,foregroundAppInfo:[{appId:source}].concat(web?[{appId:WEB}]:[])};
  }
  const child={execFile(command,args,limits,callback){
    assert.equal(command,'/usr/bin/luna-send');assert.equal(limits.timeout,5500);
    const service=args[4],payload=JSON.parse(args[5]);calls.push({service,payload,at:time.now()});
    let delay=1;
    if(service==='luna://com.webos.service.systemUIManager/launch')delay=options.nativeDelay||1;
    if(service==='luna://com.webos.applicationManager/launch'&&!payload.params.nativeBlurCancelToken)delay=options.webDelay||1;
    time.setTimeout(()=>{
      if(service==='luna://com.webos.service.systemUIManager/launch') {
        if(options.failNative){callback(null,'{"returnValue":false}');return;}
        assert.equal(payload.main,'file://'+qml+'/Host.qml','QML URL is release-stable, not session-local');
        native=true;token=payload.blurToken;events.push('native-delivered');post('/event',{token,event:'loaded'});
      } else if(service==='luna://com.webos.service.systemUIManager/closeByAppId') {
        assert.equal(payload.appId,NATIVE);events.push('native-close');
        if(native){native=false;post('/event',{token,event:'destroyed'});}
      } else if(service==='luna://com.webos.applicationManager/launch') {
        assert.equal(payload.id,WEB);
        if(payload.params.nativeBlurCancelToken) {
          events.push('owned-cancel');if(owner===payload.params.nativeBlurCancelToken){web=false;owner=null;}
        } else {
          events.push('web-delivered');web=true;owner=payload.params.nativeBlur?payload.params.nativeBlur.token:payload.params.nativeBlurFallbackToken;
          webFocusAt=time.now()+(options.webFocusDelay||0);
          if(payload.params.nativeBlur&&!options.noWebState)post('/state',{token:owner,sequence:1,visible:true,main:true,selected:0});
          if(options.replaceOnWebDelivery)owner=null;
        }
      }
      callback(null,JSON.stringify(service.includes('/launch')||service.includes('/closeByAppId')?{returnValue:true}:view(service)));
    },delay);
  }};
  const http={createServer(handler){requestHandler=handler;server=new EventEmitter();server.listening=false;
    server.listen=(port,host,ready)=>{assert.equal(port,48740);assert.equal(host,'127.0.0.1');time.setTimeout(()=>{
      if(options.bindFail)server.emit('error',Error('busy'));else{server.listening=true;ready();}
    },1);};server.close=()=>{server.listening=false;};return server;}};
  class DateStub extends Date { static now(){return time.now();} }
  const context={module:{exports:{}},require:name=>name==='child_process'?child:name==='http'?http:require(name),
    process:processStub,console,Buffer,Date:DateStub,Promise,
    setTimeout:time.setTimeout,setInterval:time.setInterval,clearTimeout:time.clear,clearInterval:time.clear};
  vm.runInNewContext(fs.readFileSync(root+'/tv/native-blur/bridge.js','utf8'),context,{filename:'bridge.js'});
  context.module.exports.run({base:stateDir,runtime:qml,sourceAppId:options.expectedSource||SOURCE,fallback:true,
    cancelled:()=>cancelled,stage:value=>stages.push(value),log:()=>{}}).then(value=>{result=value;finished=true;},e=>{error=e;finished=true;});
  return {time,calls,stages,events,processStub,cancel:()=>{cancelled=true;},post,token:()=>token,finished:()=>finished,
    result:()=>result,error:()=>error,native:()=>native,web:()=>web,server:()=>server,
    hide:()=>{web=false;owner=null;post('/state',{token,sequence:2,visible:false,main:false,selected:0});}};
}
async function until(f,test,limit=15000){for(let elapsed=0;!test()&&elapsed<limit;elapsed+=20)await f.time.advance(20);assert(test(),'bounded fixture completion');}
async function bridgeChecks() {
  let f=bridgeFixture();await until(f,()=>f.stages.includes('active'));f.hide();await until(f,f.finished);
  assert(f.result().cleanupVerified);assert(!f.native());assert(!f.server().listening);assert.equal(f.time.tasks.size,0);
  assert.equal(f.processStub.listenerCount('SIGTERM'),0);

  // SAM accepts immediately, but a cold page reports state/focus only after the
  // old five-second focus timeout. Native startup still has its original 8s lease.
  f=bridgeFixture({webFocusDelay:5800,noWebState:true});await until(f,()=>f.events.includes('web-delivered'));
  await f.time.advance(5200);
  assert(!f.stages.includes('closing'),'cold page remains within the native startup lease');
  assert.equal(f.post('/state',{token:f.token(),sequence:1,visible:true,main:true,selected:0}),200);
  await until(f,()=>f.stages.includes('active'));
  const coldLaunch=f.calls.find(c=>c.service==='luna://com.webos.applicationManager/launch');
  assert(f.time.now()-coldLaunch.at>5000,'focus really arrives after the previous timeout');
  f.hide();await until(f,f.finished);assert(f.result().cleanupVerified);assert.equal(f.time.tasks.size,0);

  f=bridgeFixture({neverWebFocus:true,noWebState:true});await until(f,f.finished);
  assert(!f.stages.includes('active'));assert.equal(f.result().reason,'lease-expired');
  assert(f.result().cleanupVerified);assert(!f.native());assert.equal(f.time.tasks.size,0);

  f=bridgeFixture({neverWebFocus:true});await until(f,()=>f.events.includes('web-delivered'));
  for(let sequence=2;sequence<=8;sequence++){
    await f.time.advance(1000);
    assert.equal(f.post('/state',{token:f.token(),sequence,visible:true,main:true,selected:0}),200);
  }
  await until(f,f.finished);
  assert(!f.stages.includes('active'),'heartbeats cannot extend missing-focus startup indefinitely');
  assert.equal(f.result().startError,'Timed out: web focus');assert(f.result().cleanupVerified);
  assert.equal(f.time.tasks.size,0);

  f=bridgeFixture({webFocusDelay:5800,noWebState:true});await until(f,()=>f.events.includes('web-delivered'));
  await f.time.advance(5100);f.cancel();await until(f,f.finished);
  assert(!f.stages.includes('active'));assert(f.events.includes('owned-cancel'));
  assert(!f.web());assert(!f.native());assert(f.result().cleanupVerified);assert.equal(f.time.tasks.size,0);

  f=bridgeFixture();f.cancel();await until(f,f.finished);
  assert(f.error());assert(!f.calls.some(c=>c.service.endsWith('/launch')),'cancel before initial view never launches');

  f=bridgeFixture({nativeDelay:1000});await until(f,()=>f.calls.some(c=>c.service==='luna://com.webos.service.systemUIManager/launch'));
  f.cancel();await until(f,f.finished);assert(f.result().cleanupVerified);
  assert(f.events.indexOf('native-close')>f.events.indexOf('native-delivered'),'native launch settles before close');
  assert(!f.events.includes('web-delivered'));assert(!f.native());

  for(const replaceOnWebDelivery of [false,true]) {
    f=bridgeFixture({webDelay:1000,replaceOnWebDelivery});await until(f,()=>f.stages.includes('web'));
    f.cancel();await until(f,f.finished);
    assert(f.events.indexOf('owned-cancel')>f.events.indexOf('web-delivered'),'late SAM is cancelled after completion');
    assert.equal(f.web(),replaceOnWebDelivery,'token cancellation preserves a newer ordinary panel');
    assert(!f.native());assert(!f.calls.some(c=>c.service==='luna://com.webos.applicationManager/close'));
  }
  f=bridgeFixture({bindFail:true,webDelay:1000});await until(f,()=>f.stages.includes('fallback'));
  await until(f,()=>f.calls.some(c=>c.payload.params&&c.payload.params.nativeBlurFallbackToken));f.cancel();await until(f,f.finished);
  assert(f.events.includes('owned-cancel'));assert(!f.web());assert(!f.events.includes('native-delivered'));

  f=bridgeFixture({failNative:true});await until(f,f.finished);
  assert(f.result().fallbackLaunched);assert(f.web());assert(!f.native());
  const plain=f.calls.find(c=>c.payload.params&&c.payload.params.nativeBlurFallbackToken);assert(plain);assert(!plain.payload.params.nativeBlur);

  f=bridgeFixture({source:'netflix',expectedSource:'netflix'});await until(f,()=>f.stages.includes('active'));
  f.hide();await until(f,f.finished);assert(f.result().cleanupVerified);assert(!f.native());
  f=bridgeFixture({source:'netflix.clone'});await until(f,f.finished);assert(f.error());
  assert(!f.calls.some(c=>c.service.endsWith('/launch')),'a changed/unsupported source never gets an unexpected overlay');
}
(async()=>{
  try {await coordinatorChecks();await bridgeChecks();console.log('PASS: native runtime ownership, queued reopen, quarantine, disable, bounded storage, immutable QML paths, late native/SAM cancellation and plain fallback (simulated only)');}
  finally {for(const dir of folders)fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
