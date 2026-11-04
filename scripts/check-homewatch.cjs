// Playback must not be interrupted by reconnects or by starting the watcher manually.
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const {EventEmitter}=require('events');
const source=fs.readFileSync(require('path').join(__dirname,'../tv/homewatch.js'),'utf8');
function scenario(boot,first){
 const processes=[],timers=[],calls=[];
 const child={spawn(cmd,args){const p=new EventEmitter();p.stdout=new EventEmitter();p.kill=()=>{};p.uri=args[1];processes.push(p);return p},
  execFile(cmd,args){calls.push({cmd,args})}};
 vm.runInNewContext(source,{require:()=>child,Date,process:{env:boot?{LG_LAUNCHER_BOOT:'1'}:{}},console:{log(){}},
  setTimeout(fn,ms){const t={fn,ms};timers.push(t);return t},clearTimeout(t){if(t)t.cancelled=true}});
 const foreground=processes.find(p=>p.uri.includes('getForegroundAppInfo'));
 function report(appId){foreground.stdout.emit('data',JSON.stringify({appId})+'\n')}
 function drainLaunches(){for(const t of timers.splice(0))if(!t.cancelled&&(t.ms===0||t.ms===1500))t.fn()}
 report(first);drainLaunches();const initial=calls.length;
 report('youtube.leanback.v4');report('com.apple.appletv');drainLaunches();
 assert.equal(calls.length,initial,'ordinary foreground changes must not steal playback');
 foreground.emit('exit');
 assert.equal(calls.length,initial,'subscription reconnect must not launch again');
 return initial;
}
assert.equal(scenario(true,'netflix'),1,'startup must cover a restored streaming app');
assert.equal(scenario(true,'com.webos.app.home'),1,'startup from Home must launch only once');
assert.equal(scenario(true,'com.gathin.tvhome'),0,'already-open launcher needs no new launch');
assert.equal(scenario(false,'netflix'),0,'manual watcher start must preserve playback');
{
 const timers=new Map(),processes=[],calls=[];let sequence=0;
 const cp={spawn(cmd,args){const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr={resume(){}};p.kill=()=>{};p.uri=args[1];processes.push(p);return p;},
  execFile(cmd,args){calls.push({cmd,args});return new EventEmitter();}};
 const context={require:name=>name==='child_process'?cp:{existsSync:()=>false},Date,process:{env:{},on(){}},console:{log(){}},
  setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
 vm.createContext(context);vm.runInContext(source,context);
 processes.find(p=>p.uri.includes('listLaunchPoints')).stdout.emit('data','{"change":"updated","id":"existing.app"}\n');
 assert(calls.some(call=>call.args[0].endsWith('/sync.js')),'app updates must refresh titles and icon bytes');
 // Failed spawns emit error + close, but no exit. Every retry remains bounded.
 for(let i=0;i<50;i++) {
  for(const p of processes.splice(0)) {p.emit('error',Object.assign(new Error('spawn EAGAIN'),{code:'EAGAIN'}));p.emit('close',-11);}
  for(const [id,t] of [...timers])if([1000,2000,5000].includes(t.ms)){timers.delete(id);t.fn();}
  assert(context.children.length<=4,'failed subscription processes must not accumulate');
 }
}
console.log('Startup, ordinary playback, updated inventory and failed-spawn reconnect cleanup checks passed.');
