const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('app/app.js','utf8');
const lifecycle=source.slice(source.indexOf('  var lastResume ='),source.indexOf('  function launchParameters('));
let now=100000,next=0,timers=new Map(),loads=[],builds=0,focusCalls=0;
const bodyClasses=new Set();
const cl={add(name){bodyClasses.add(name);},remove(name){bodyClasses.delete(name);},contains(name){return bodyClasses.has(name);}};
const scope={Date:{now:()=>now},setTimeout(fn,ms){timers.set(++next,{fn,at:now+ms});return next;},clearTimeout(id){timers.delete(id);},
 document:{hidden:false,addEventListener(){},body:{classList:cl,appendChild(sc){loads.push(sc);}},createElement(){return {};}},
 $:()=>null,window:{},TV_APPS:{apps:[{id:'a'},{id:'b'}]},items:[],focused:1,editing:null,arranging:false,zone:'grid',
 panel:{classList:cl},wallPanel:{classList:cl},colsPanel:{classList:cl},pen:{classList:cl},pills:[],updateClock(){},scheduleClock(){},cancelPress(){},activePanels:{},wallOpening:false,
 build(){builds++;scope.items=scope.TV_APPS.apps.map(app=>({app,el:{classList:cl}}));},focusTile(i){focusCalls++;scope.focused=i;scope.zone='grid';},finishEdit(){scope.editing=null;}};
scope.window.TV_APPS=scope.TV_APPS;scope.build();builds=0;
vm.createContext(scope);vm.runInContext(lifecycle,scope);
function advance(ms){let end=now+ms;for(;;){let pair=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!pair)break;now=pair[1].at;timers.delete(pair[0]);pair[1].fn();}now=end;}
scope.resume();scope.resume();assert.equal(focusCalls,1);assert.equal(loads.length,0); // immediate focus, duplicate event coalesced
scope.scheduleRefresh(1);scope.noteInteraction();advance(1);assert.equal(loads.length,0);advance(1500);assert.equal(loads.length,1);
scope.refreshApps();assert.equal(loads.length,1); // one in-flight load
scope.TV_APPS.apps=[{id:'c'},{id:'b'},{id:'a'}];scope.editing={};loads[0].onload();advance(1500);assert.equal(builds,0);
scope.editing=null;scope.noteInteraction();advance(1500);assert.equal(builds,1);assert.equal(scope.items[scope.focused].app.id,'b');
scope.document.hidden=true;advance(20000);assert.equal(loads.length,1);assert.equal(timers.size,0);
scope.document.hidden=false;scope.resume();advance(1500);assert.equal(loads.length,2);
loads[1].onload();assert.equal(builds,1); // unchanged inventory does not rebuild
// Window-captured Control Centre keys never reach document interaction tracking.
// The panel's own state must block both loading and applying an inventory.
bodyClasses.add('ccOpen');scope.scheduleRefresh(1);advance(22000);assert.equal(loads.length,2);
bodyClasses.delete('ccOpen');scope.activePanels.controlCentre=true;advance(1500);assert.equal(loads.length,2);
delete scope.activePanels.controlCentre;bodyClasses.add('wallOpen');advance(1500);assert.equal(loads.length,2);
bodyClasses.delete('wallOpen');scope.noteInteraction();advance(3000);assert.equal(loads.length,3);
scope.TV_APPS.apps=[{id:'b'},{id:'d'}];loads[2].onload();bodyClasses.add('ccOpen');advance(22000);assert.equal(builds,1);
bodyClasses.delete('ccOpen');scope.noteInteraction();advance(3000);assert.equal(builds,2);
// Updates keep their application IDs. Name, icon content revision, and colour
// changes must still refresh tiles after interaction ends and preserve selection.
const selectedId=scope.items[scope.focused].app.id;
scope.refreshApps();
scope.TV_APPS.apps=scope.TV_APPS.apps.map(app=>({id:app.id,title:'Renamed '+app.id,icon:'icons/'+app.id+'.png?v=2',iconColor:'#123456'}));
scope.editing={};loads[3].onload();advance(1500);assert.equal(builds,2,'Metadata refresh waits for an active move');
scope.editing=null;advance(1500);assert.equal(builds,3);
assert.equal(scope.items[scope.focused].app.id,selectedId);
assert.equal(scope.items[scope.focused].app.title,'Renamed '+selectedId);
for(const [field,value] of [['title','New name'],['icon','icons/rebranded.png?v=3'],['iconColor','#abcdef']]){
  scope.TV_APPS.apps=scope.TV_APPS.apps.map(app=>({...app,[field]:value}));
  const previous=builds;scope.applyInventory();assert.equal(builds,previous+1,field+' changes rebuild tiles');
  assert.equal(scope.items[scope.focused].app.id,selectedId);
  assert.equal(scope.items[scope.focused].app[field],value);
}
const unchanged=builds;
scope.TV_APPS.apps=scope.TV_APPS.apps.slice().reverse().map(app=>({...app}));scope.applyInventory();
assert.equal(builds,unchanged,'Equivalent metadata in another publication order does not rebuild');
console.log('Resume, idle/edit/panel deferral, ID/metadata refresh, focus preservation, hidden pause and single refresh passed.');
