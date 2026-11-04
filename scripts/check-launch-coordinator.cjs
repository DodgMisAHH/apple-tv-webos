// No TV connection: exercise overlapping subscription events and pending launches.
const assert = require('assert'), fs = require('fs'), vm = require('vm'), {EventEmitter} = require('events');
const source = fs.readFileSync(require('path').join(__dirname, '../tv/homewatch.js'), 'utf8');
function setup(boot = false) {
  const calls = [], timers = [], children = [];
  const processStub = new EventEmitter(); processStub.env = boot ? {LG_LAUNCHER_BOOT:'1'} : {}; processStub.exit = () => {};
  function child() { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = {resume(){}};
    p.kill = () => {p.killed = true; p.emit('exit');}; children.push(p); return p; }
  const cp = {spawn(cmd,args){const p=child();p.uri=args[1];return p;},
    execFile(cmd,args,opts,callback){const p=child();calls.push({cmd,args,opts,callback,p});return p;}};
  const ctx = {require:()=>cp,Date,process:processStub,console:{log(){}},
    setTimeout(fn,ms){const t={fn,ms};timers.push(t);return t;},clearTimeout(t){if(t)t.cancelled=true;}};
  vm.createContext(ctx); vm.runInContext(source,ctx);
  function fire(ms) { const selected=timers.filter(t=>!t.cancelled&&!t.fired&&t.ms===ms);
    selected.forEach(t=>{t.fired=true;t.fn();}); }
  function foreground(id){children.find(p=>p.uri&&p.uri.includes('getForegroundAppInfo')).stdout.emit('data',JSON.stringify({appId:id})+'\n');}
  return {ctx,calls,timers,children,processStub,fire,foreground};
}
let t=setup(); for(let i=0;i<5;i++)t.foreground('com.webos.app.home'); t.fire(0);
assert.equal(t.calls.length,1,'duplicate Home snapshots share one launch');
assert.equal(t.calls[0].opts.timeout,3500,'launch is bounded');
t=setup();t.ctx.handlePower({state:'Suspend'});t.ctx.handlePower({state:'Active'});
t.foreground('com.webos.app.home');t.fire(0);assert.equal(t.calls.length,1,'wake and foreground requests cannot overlap');
t.calls[0].callback(null,'{"returnValue":true}');t.foreground('com.webos.app.livetv');t.foreground('com.webos.app.home');t.fire(0);
assert.equal(t.calls.length,1,'accepted wake is not immediately repeated by stock Home');
t=setup(true);t.foreground('netflix');t.foreground('com.gathin.tvhome');t.fire(1500);
assert.equal(t.calls.length,0,'early success cancels delayed boot request');
t=setup(true);t.foreground('netflix');t.foreground('youtube.leanback.v4');t.fire(1500);
assert.equal(t.calls.length,0,'user app change cancels stale boot request');
t=setup();t.foreground('com.webos.app.home');t.fire(0);t.calls[0].callback(new Error('busy'),'');
t.foreground('netflix');t.fire(400);assert.equal(t.calls.length,1,'retry must not interrupt a newer app');
t=setup();const before=t.children.length;t.processStub.emit('SIGTERM');
assert(t.children.every(p=>p.killed),'shutdown terminates owned subscriptions');t.fire(2000);t.fire(5000);
assert.equal(t.children.length,before,'shutdown cannot reconnect');
t=setup();const fg=t.children.find(p=>p.uri&&p.uri.includes('getForegroundAppInfo'));
fg.emit('error',new Error('spawn failed'));fg.emit('exit');t.fire(1000);
assert.equal(t.children.filter(p=>p.uri&&p.uri.includes('getForegroundAppInfo')).length,2,'error/exit reconnect once');
console.log('Launch coalescing, bounded requests, stale timer cancellation, shutdown and reconnect checks passed.');
