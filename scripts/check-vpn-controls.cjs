const fs=require('fs'),vm=require('vm'),assert=require('assert');
function setup(){
  const requests=[],timers=new Map();let next=0;
  const scope={window:{LauncherControls:{luna(uri,params,cb){requests.push({uri,params,cb});}}},PalmServiceBridge(){},
    setTimeout(fn,ms){timers.set(++next,{fn,ms});return next;},clearTimeout(id){timers.delete(id);}};
  vm.runInNewContext(fs.readFileSync('app/vpn-controls.js','utf8'),scope);
  return {scope,api:scope.window.VPNControls,requests,reply(i,data){requests[i].cb({stdoutString:JSON.stringify(data)});},timeout(){const [id,t]=timers.entries().next().value;timers.delete(id);t.fn();}};
}
const status={ok:true,selected:'lisbon',active:null,tunnel:false,connected:false,profiles:[]};
let t=setup();
for(const id of ['lisbon','uk','us'])assert(t.api.command('connect',id).endsWith("'"+id+"'"));
for(const [action,id] of [['connect',"uk'; reboot #"],['connect',''],['select','fr'],['status','uk'],['disconnect','us'],['arbitrary',null]])assert.throws(()=>t.api.command(action,id));
let oldRead,change,duplicate;
t.api.call('status',null,r=>oldRead=r);t.api.call('connect','uk',r=>change=r);t.api.call('disconnect',null,r=>duplicate=r);
assert(t.api.pending());assert(duplicate.pending);assert.equal(t.requests.length,2);
t.reply(1,status);t.reply(0,status);assert(change.ok);assert(oldRead.stale);assert(!t.api.pending());
let result,completions=0;
t.api.call('connect','uk',r=>{result=r;completions++;});t.timeout();assert(result.timeout);assert(!t.api.pending());
t.api.call('connect','us',r=>result=r);t.reply(2,status);assert.equal(completions,1);assert(t.api.pending(),'Late reply cannot clear a newer change');
t.reply(3,status);assert(!t.api.pending());
t.api.call('status',null,r=>result=r);t.reply(4,Object.assign({},status,{connected:true}));assert.equal(result.connected,false,'No live tunnel means no connected indicator');
t.api.call('status',null,r=>result=r);t.requests[5].cb({stdoutString:'not json'});assert(!result.ok);
t.api.call('status',null,r=>result=r);t.reply(6,{ok:true});assert(!result.ok,'Malformed success cannot show a VPN state');
delete t.scope.PalmServiceBridge;const before=t.requests.length;t.api.call('connect','uk',r=>result=r);assert(result.preview);assert.equal(t.requests.length,before,'Browser preview cannot change networking');
console.log('VPN allowlist, preview isolation, mutation dedupe, stale reads, timeout recovery and truthful status normalization passed.');
