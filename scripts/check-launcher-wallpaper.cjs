const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('app/app.js','utf8');
let now=0,next=0,focusCalls=0;
const timers=new Map(),scripts=[],messages=[],panels={},elements={};
function classes(){const values=new Set();return {add:v=>values.add(v),remove:v=>values.delete(v),contains:v=>values.has(v)};}
const body={classList:classes(),appendChild(sc){sc.parentNode=this;scripts.push(sc);},removeChild(sc){sc.parentNode=null;}};
for(const id of ['wallQr','wallTitle','wallScan','wallUrl'])elements[id]={textContent:'',innerHTML:''};
const scope={window:{},CONFIG:{language:'en'},document:{hidden:false,body,createElement(){return {};}},
 setTimeout(fn,ms){timers.set(++next,{fn,at:now+ms});return next;},clearTimeout(id){timers.delete(id);},
 $:id=>id==='wallJs'?scripts.filter(s=>s.id===id&&s.parentNode).slice(-1)[0]:elements[id],
 zone:'grid',focused:0,pillFocus:0,pills:[{classList:classes()}],wallPanel:{classList:classes()},
 L:{wallTitle:'Wallpaper',wallScan:'Scan',wallOff:'Unavailable'},
 setPanelActive(name,active){panels[name]=active;},setZone(z){scope.zone=z;},
 focusTile(){focusCalls++;scope.zone='grid';},toast(msg){messages.push(msg);}};
vm.createContext(scope);
vm.runInContext(source.slice(source.indexOf('  function loadWallUrl(cb)'),source.indexOf('  // ---- inputs dropdown')),scope);
function advance(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}}
function qrLibrary(){return {addData(){},make(){},createDataURL(){return 'data:image/gif;base64,test';}};}
// Closing while URL loading must invalidate all future callbacks.
scope.showWall();let url=scripts.at(-1);scope.hideWall();url.onload();
assert.equal(scripts.filter(s=>s.src==='qrcode.js').length,0);assert(!body.classList.contains('wallOpen'));
// QR library is lazy and a close during its load cannot reopen the panel.
scope.showWall();scripts.at(-1).onload();const qr=scripts.at(-1);assert.equal(qr.src,'qrcode.js');
scope.hideWall();scope.window.qrcode=qrLibrary;qr.onload();assert(!body.classList.contains('wallOpen'));
// Reopening reuses the library without another download; closing releases idle gate.
scope.showWall();scripts.at(-1).onload();assert(body.classList.contains('wallOpen'));
assert(elements.wallQr.innerHTML.includes('data:image/gif'));assert.equal(scripts.filter(s=>s.src==='qrcode.js').length,1);
scope.hideWall();assert.equal(panels.wallpaper,false);assert.equal(scope.zone,'grid');
// A failed library load reports an error, releases the panel, and can be retried.
delete scope.window.qrcode;scope.showWall();scripts.at(-1).onload();scripts.at(-1).onerror();
assert.equal(panels.wallpaper,false);assert(messages.at(-1).includes('Try again'));
scope.showWall();scripts.at(-1).onload();const retry=scripts.at(-1);scope.window.qrcode=qrLibrary;retry.onload();assert(body.classList.contains('wallOpen'));
scope.hideWall();
// A stalled wall URL cannot keep interaction locked indefinitely on TV.
scope.PalmServiceBridge=function(){};scope.showWall();advance(5000);
assert.equal(panels.wallpaper,false);assert.equal(scope.zone,'grid');assert.equal(messages.at(-1),'Unavailable');
assert(focusCalls>=5);
// Control Centre supplies a return callback. Normal Back invokes it once,
// whereas lifecycle cleanup (hideWall(false) or visibility loss) must not
// reopen the parent overlay after the launcher leaves the foreground.
let parentReturns=0;
scope.showWall(()=>parentReturns++);scope.hideWall();assert.equal(parentReturns,1);
scope.hideWall();assert.equal(parentReturns,1,'Closing twice cannot reopen the parent twice');
scope.showWall(()=>parentReturns++);scope.hideWall(false);assert.equal(parentReturns,1);
scope.showWall(()=>parentReturns++);scope.document.hidden=true;scope.hideWall();assert.equal(parentReturns,1);
scope.document.hidden=false;scope.showWall();scope.hideWall();assert.equal(parentReturns,1,'Standalone wallpaper has no inherited return callback');
scope.showWall(()=>parentReturns++);advance(5000);assert.equal(parentReturns,2,'A loading failure returns to the parent controls');
assert.equal(panels.wallpaper,false);
console.log('Lazy QR reuse, stale callbacks, retry, URL timeout and one-shot hierarchical wallpaper return passed.');
