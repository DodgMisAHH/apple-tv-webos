const assert=require('assert'),fs=require('fs'),vm=require('vm'),{EventEmitter}=require('events');
const source=fs.readFileSync('tv/homewatch.js','utf8');
function setup(){
 const timers=[],calls=[],processes=[];let fail=false;
 const child={spawn(cmd,args){let p=new EventEmitter();p.stdout=new EventEmitter();p.kill=()=>{};p.uri=args[1];processes.push(p);return p;},execFile(cmd,args,opts,cb){calls.push({cmd,args});if(cb)cb(null,JSON.stringify({returnValue:!fail}));}};
 const ctx={require:()=>child,Date,process:{env:{}},console:{log(){}},setTimeout(fn,ms){const t={fn,ms};timers.push(t);return t;},clearTimeout(t){if(t)t.cancelled=true;}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 function send(state,extra){ctx.handlePower(Object.assign({state,returnValue:true},extra));}
 return {ctx,calls,timers,processes,send,setFail(v){fail=v;},retry(){const i=timers.findIndex(t=>t.ms===750&&!t.cancelled);if(i>=0)timers.splice(i,1)[0].fn();}};
}
let t=setup();t.send('Active');t.send('Active');assert.equal(t.calls.length,0);
t.send('Screen Off');t.send('Active');t.send('Screen Saver');t.send('Active');assert.equal(t.calls.length,0);
t.send('Active Standby');t.send('Active',{processing:'Request Active'});assert.equal(t.calls.length,0);t.send('Active');assert.equal(t.calls.length,1);t.send('Active');assert.equal(t.calls.length,1);
assert.deepEqual(JSON.parse(t.calls[0].args.at(-1)).params,{home:true,reload:false});
t=setup();t.setFail(true);t.send('Suspend');t.send('Active');t.retry();t.retry();t.retry();assert.equal(t.calls.length,3);
t=setup();t.setFail(true);t.send('Active Standby');t.send('Active');t.send('Power Off');t.retry();assert.equal(t.calls.length,1);
t=setup();let p=t.processes.find(p=>p.uri.includes('getPowerState'));p.stdout.emit('data','{\n "returnValue":true, "state":"Active Stand');p.stdout.emit('data','by"\n}\n{ "returnValue":true, "state":"Active" }\n');assert.equal(t.calls.length,1);
p.emit('exit');let reconnect=t.timers.find(t=>t.ms===2000);reconnect.fn();p=t.processes.at(-1);p.stdout.emit('data','{"returnValue":true,"state":"Active"}\n');assert.equal(t.calls.length,1);
console.log('Wake detection, initial/reconnect suppression, screen-off exclusion, bounded retry/cancellation and chunked JSON passed.');
