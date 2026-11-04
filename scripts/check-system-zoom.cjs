// Validate the cross-process trust boundary and fail-open behaviour of the native prototype.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('tv/system-zoom/LaunchOrigin.js','utf8').replace(/^\.pragma library\s*/, '');
function reader(){const scope={};vm.createContext(scope);vm.runInContext(src,scope);return scope;}
const request={sourceAppId:'com.gathin.tvhome',appId:'youtube.leanback.v4',token:'new',created:10000,
  rect:{x:600,y:820,width:305,height:183}};
let q=reader(),r=q.validate(request,request.appId,10100,3840,2160);
assert.equal(r.x,1200);assert.equal(r.width,610); // TV physical output can be 4K.
assert.equal(q.validate(request,request.appId,10200,3840,2160),null); // Replay rejected across both paths.
for(const mutate of [v=>v.appId='other',v=>v.created=-30000,v=>v.created=20000,v=>v.rect.x=-1,
  v=>v.rect.width=5000,v=>v.rect.y='820',v=>v.sourceAppId='other']) {
  const bad=JSON.parse(JSON.stringify(request));mutate(bad);
  assert.equal(reader().validate(bad,request.appId,10100,1920,1080),null);
}
q=reader();
assert(q.validate(request,request.appId,25000,1920,1080,false)); // Cold app may need time.
assert(q.validate(request,request.appId,25001,1920,1080,false)); // Splash peek cannot steal the token.
assert(q.validate(request,request.appId,25002,1920,1080));
assert.equal(q.validate(request,request.appId,25003,1920,1080),null);
assert.equal(reader().validate(request,request.appId,40001,1920,1080),null);
const generated=fs.readFileSync('.local/system-zoom-stage/qml/ZoomWiper.qml','utf8');
assert.equal((generated.match(/Eos\.Beziergon \{/g)||[]).length,1);
assert(generated.includes('sourceItem: (transitioning || forceBeziergon) ? (root.sourceItem || null) : null'));
assert(generated.includes('if (root.launcherZoomActive) return;'));
assert(generated.includes('live: false'));
const splash=fs.readFileSync('.local/system-zoom-stage/patched/StarfishImageSplash.qml','utf8');
assert(splash.includes('if (LaunchOrigin.pending(appId, width, height))'));
function transport(params,reply) {
  let calls=[],timers=[],opens=0;
  const scope={window:{PalmSystem:{launchParams:JSON.stringify(params)}},
    PalmServiceBridge:function(){this.call=(uri,data)=>{calls.push({uri,data:JSON.parse(data)});if(reply)this.onservicecallback('{}');};},
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{}};
  vm.createContext(scope);vm.runInContext(fs.readFileSync('tv/system-zoom/transport.js','utf8'),scope);
  return {run(id){scope.window.LaunchZoom.prepare(id,{left:80,top:820,width:305,height:183},()=>opens++);},
    calls,timers,get opens(){return opens;}};
}
let t=transport({},true);t.run('youtube.leanback.v4');assert.equal(t.calls.length,0);assert.equal(t.opens,1);
t=transport({systemZoomTest:true},true);t.run("bad'$(whoami)");assert.equal(t.calls.length,0);assert.equal(t.opens,1);
t=transport({systemZoomTest:true},false);t.run('youtube.leanback.v4');assert.equal(t.calls.length,1);assert.equal(t.opens,0);
t.timers[0]();assert.equal(t.opens,1); // Root-service silence cannot block app launch.
t=transport({systemZoomTest:true},true);t.run('youtube.leanback.v4');t.timers[0]();assert.equal(t.opens,1);
assert(t.calls[0].data.command.includes('test -f /tmp/lg-tv-system-zoom.enabled'));
console.log('Native zoom origin validation, replay protection, 4K scaling, shell boundary and timeout fallback passed.');
