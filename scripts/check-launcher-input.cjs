const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('app/app.js','utf8');
const take=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
let now=100000,next=0,launches=0,edits=0,menus=0;
const timers=new Map(),handlers={},windowHandlers={};
function classes(){const values=new Set();return {add:v=>values.add(v),remove:v=>values.delete(v),contains:v=>values.has(v),toggle(v,on){on?values.add(v):values.delete(v);}};}
const cl=classes();
const hidden=[];
function tile(id){return {app:{id,title:id.toUpperCase()},card:{},el:{classList:classes(),setAttribute(){}}};}
const scope={KEY:{LEFT:37,UP:38,RIGHT:39,DOWN:40,OK:13,BACK:461,ESC:27},Date:{now:()=>now},
 setTimeout(fn,ms){timers.set(++next,{fn,at:now+ms});return next;},clearTimeout(id){timers.delete(id);},
 document:{hidden:false,body:{classList:cl},addEventListener(n,fn){const old=handlers[n];handlers[n]=old?function(e){old(e);fn(e);}:fn;}},
 window:{addEventListener(n,fn){windowHandlers[n]=fn;}},
 items:[tile('a'),tile('b')],
 focused:0,zone:'grid',editing:null,COLUMNS:6,rowOf:i=>Math.floor(i/6),
 pressTimer:null,pressGeneration:0,okItem:null,activePanels:{},clockTimer:null,wallOpening:false,
 tileMenu:{style:{},setAttribute(name,value){if(name==='aria-hidden'&&value==='false')menus++;}},
 tileMenuTarget:null,tileMenuIndex:0,tileMenuButtons:[{classList:classes()},{classList:classes()}],consumePointerRelease:false,
 logicalRect(){return {left:65,top:826,width:250,bottom:976};},
 appPreferences:{hide(id){hidden.push(id);return true;}},rebuildApps(){},toast(){},
 focusTile(i){scope.focused=i;scope.zone='grid';},launch(){launches++;},
 startEdit(){edits++;scope.editing={};},finishEdit(){scope.editing=null;},updateClock(){},scheduleClock(){},
 panel:{classList:cl},wallPanel:{classList:cl},colsPanel:{classList:cl},pen:{classList:cl},pills:[],
 TV_APPS:{apps:[]},$:()=>null};
scope.window.TV_APPS=scope.TV_APPS;
vm.createContext(scope);
vm.runInContext(take('  function cancelPress()','  // ---- luna bus'),scope);
vm.runInContext(take('  function focusTileAction(index)', '  // ---- keys'),scope);
vm.runInContext(take('  var LONG_PRESS_MS =','  pills.forEach(function (p, i) {'),scope);
vm.runInContext(take('  var lastResume =','  function launchParameters('),scope);
vm.runInContext(take("  document.addEventListener('visibilitychange'",'  if (window.LauncherPerf)'),scope);
function event(k){return {keyCode:k,preventDefault(){}};}
function down(k=13){handlers.keydown(event(k));}
function up(){handlers.keyup(event(13));}
function advance(ms){const end=now+ms;for(;;){const pair=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!pair)break;now=pair[1].at;timers.delete(pair[0]);pair[1].fn();}now=end;}
// A lost keyup on hide must not start an invisible edit or swallow the first OK on return.
down();scope.document.hidden=true;handlers.visibilitychange();advance(700);assert.equal(menus,0);
scope.document.hidden=false;handlers.visibilitychange();down();up();assert.equal(launches,1);
// Blur and capture-phase modal entry cancel pending presses even without document keyup.
down();windowHandlers.blur();advance(700);assert.equal(menus,0);down();up();assert.equal(launches,2);
down();scope.setPanelActive('controlCentre',true);advance(700);assert.equal(menus,0);
scope.setPanelActive('wallpaper',true);scope.setPanelActive('controlCentre',false);
assert.equal(scope.idleForRefresh(),false);assert.equal(scope.activePanels.wallpaper,true);
scope.setPanelActive('wallpaper',false);down();up();assert.equal(launches,3);
// Navigating while holding OK cancels the gesture; release cannot launch another tile.
down();down(39);handlers.keydown({keyCode:13,repeat:true,preventDefault(){}});up();assert.equal(launches,3);advance(700);assert.equal(menus,0);
// Even an external focus mutation cannot redirect the delayed long-press action.
scope.focused=0;down();scope.focused=1;advance(600);up();assert.equal(menus,0);
// Long press opens actions; release and repeated OK cannot activate Move.
down();up();assert.equal(launches,4);down();advance(600);assert.equal(menus,1);
assert.equal(scope.zone,'tileMenu');assert.equal(scope.activePanels.tileActions,true);assert.equal(edits,0);
handlers.keydown({keyCode:13,repeat:true,preventDefault(){}});up();assert.equal(edits,0);assert.equal(launches,4);
down();assert.equal(edits,1);assert.equal(scope.zone,'grid');assert(!scope.activePanels.tileActions);up();
scope.editing=null;
// Hide is a separate deliberate selection, and Back returns to the same tile.
down();advance(600);up();down(40);down();up();
assert.deepEqual(hidden,['b']);assert.equal(launches,4);assert.equal(scope.zone,'grid');
down();advance(600);up();down(461);assert.equal(scope.focused,1);assert.equal(scope.zone,'grid');
// Pointer long-press callbacks use the same visibility/generation cancellation.
const pointerHandlers={};scope.el={addEventListener(n,fn){pointerHandlers[n]=fn;}};
scope.item=scope.items[scope.focused];scope.app=scope.item.app;
vm.runInContext(take("      el.addEventListener('mousedown'",'      tilesEl.appendChild(el);'),scope);
const beforePointer=menus;
pointerHandlers.mousedown();scope.document.hidden=true;handlers.visibilitychange();advance(700);assert.equal(menus,beforePointer);
scope.document.hidden=false;pointerHandlers.mousedown();advance(600);assert.equal(menus,beforePointer+1);
pointerHandlers.mouseup();pointerHandlers.click();assert.equal(launches,4);
assert.equal(scope.zone,'tileMenu','Pointer release leaves actions open');
windowHandlers.blur();assert.equal(scope.zone,'grid');assert(!scope.activePanels.tileActions);
console.log('Lost-keyup recovery, cancellation, origin binding, Move/Hide/Back and pointer/remote long-press release passed.');
