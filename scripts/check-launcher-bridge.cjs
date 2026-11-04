const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('app/app.js','utf8');
let now=0,next=0,cancels=0,callbacks=0,throws=false;
const timers=new Map(),created=[];
function Bridge(){created.push(this);this.call=function(){if(throws)throw new Error('Service unavailable');};this.cancel=function(){cancels++;};}
const scope={PalmServiceBridge:Bridge,setTimeout(fn,ms){timers.set(++next,{fn,at:now+ms});return next;},clearTimeout(id){timers.delete(id);}};
vm.createContext(scope);vm.runInContext(source.slice(source.indexOf('  var bridges ='),source.indexOf('  function launch(id,')),scope);
scope.luna('launch',{},()=>callbacks++);const once=created.at(-1),late=once.onservicecallback;
scope.luna('network',{subscribe:true},()=>callbacks++);const subscription=created.at(-1);
once.onservicecallback('{"returnValue":true}');assert.equal(callbacks,1);assert.equal(scope.bridges.length,1);assert.equal(scope.bridges[0],subscription);
late('{"returnValue":true}');assert.equal(callbacks,1);assert.equal(scope.bridges.length,1,'Duplicate completion cannot remove another bridge');
scope.luna('throw-callback',{},()=>{throw new Error('Consumer failed');});
assert.throws(()=>created.at(-1).onservicecallback('{}'),/Consumer failed/);assert.equal(scope.bridges.length,1);
throws=true;scope.luna('failed-call',{},r=>{assert.equal(r.returnValue,false);callbacks++;});throws=false;assert.equal(scope.bridges.length,1);
scope.luna('stalled',{},()=>{throw new Error('Cleanup must not synthesize a response');});
now=10000;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}
assert.equal(scope.bridges.length,1);assert.equal(scope.bridges[0],subscription);assert.equal(timers.size,0);
let notices=0;const cancel=scope.luna('another-sub',{subscribe:true},()=>notices++);
created.at(-1).onservicecallback('{}');created.at(-1).onservicecallback('{}');assert.equal(notices,2);
cancel();cancel();assert.equal(scope.bridges.length,1);assert(cancels>=5);
let joined=0;
scope.luna('luna://com.webos.service.wifi/connect',{},()=>joined++);
const wifi=created.at(-1);
now=20000;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}
assert(scope.bridges.includes(wifi),'Wi-Fi can complete authentication after ordinary bridge expiry');
wifi.onservicecallback('{"returnValue":true}');assert.equal(joined,1);assert(!scope.bridges.includes(wifi));
scope.luna('luna://com.webos.service.wifi/connect',{},()=>{throw new Error('Expiry cannot invent Wi-Fi success');});
now=70000;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}
assert.equal(scope.bridges.length,1,'A stalled Wi-Fi bridge still has bounded retention');
console.log('Bridge cleanup, duplicate callbacks, subscriptions, cancellation and bounded Wi-Fi authentication lifetime passed.');
