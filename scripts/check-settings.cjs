const fs=require('fs'),vm=require('vm'),assert=require('assert');
function setup(config){
 let now=100000,next=0,canvas=0,requests=[],images=[],scripts=[],handlers={},timers=new Map(),isIdle=true;
 const frostWrites=[],bandClasses=new Set();
 const frostStyle=new Proxy({left:'-40px',top:'-786px',transform:'translateY(666px)'},{set(o,k,v){
  assert(!['left','top','transform','backgroundPosition'].includes(k),'Settings must not change the composited wallpaper alignment');
  frostWrites.push(k);o[k]=v;return true;
 }});
 const bandStyle=new Proxy({}, {set(o,k,v){assert(!/^background/.test(k),'Texture must be applied to the dedicated frost layer');o[k]=v;return true;}});
 const els={screen:{style:{}},dockBand:{style:bandStyle,classList:{toggle(k,on){on?bandClasses.add(k):bandClasses.delete(k);},contains:k=>bandClasses.has(k)}},
  dockFrost:{style:frostStyle},weather:{textContent:'',className:''}};
 const classes=new Set();
 const scope={window:null,CONFIG:config,Date:{now:()=>now},console,JSON,Math,encodeURIComponent,
  document:{hidden:false,body:{classList:{toggle(k,on){on?classes.add(k):classes.delete(k);}}},getElementById:id=>els[id],
   head:{appendChild(sc){scripts.push(sc);sc.parentNode={removeChild(){sc.parentNode=null;}};}},
   createElement(type){if(type==='canvas'){canvas++;return {getContext(){return {drawImage(){}};},toDataURL(){return 'data:test';}};}return {};},
   addEventListener(n,fn){handlers[n]=fn;}},
  setTimeout(fn,ms){timers.set(++next,{fn,at:now+ms});return next;},clearTimeout(id){timers.delete(id);},
  Image:function(){images.push(this);this.naturalWidth=1920;this.naturalHeight=1080;},
  XMLHttpRequest:function(){requests.push(this);this.open=()=>{};this.send=()=>{};this.abort=()=>{this.aborted=true;};},
  LauncherControls:{isIdle:()=>isIdle,shelfOrigin:()=>({left:40,top:786}),toast(){}}};
 scope.window=scope;vm.createContext(scope);
 vm.runInContext(fs.readFileSync('app/background.js','utf8'),scope);
 vm.runInContext(fs.readFileSync('app/extras.js','utf8'),scope);
 function advance(ms){const end=now+ms;for(;;){const t=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!t)break;now=t[1].at;timers.delete(t[0]);t[1].fn();}now=end;}
 return {scope,els,images,requests,scripts,advance,timers,frostWrites,canvas:()=>canvas,idle(v){isIdle=v;},visible(v){scope.document.hidden=!v;handlers.visibilitychange();}};
}
let s=setup({wallpaper:'wallpapers/misty.jpg',wallpaperDim:.25,weather:{enabled:false}});
assert(s.els.dockFrost.style.backgroundImage.includes('misty-frost.jpg'));
assert(!s.els.dockFrost.style.backgroundImage.includes('linear-gradient'),'Tint does not move with the wallpaper texture');
assert.equal(s.els.dockFrost.style.backgroundSize,'1920px 1080px');
assert.equal(s.els.dockFrost.style.backgroundRepeat,'no-repeat');assert(s.els.dockBand.classList.contains('frosted'));
assert.equal(s.els.dockFrost.style.transform,'translateY(666px)','A settings refresh preserves the expanded drawer position');
s.advance(5000);assert.equal(s.canvas(),0);assert.equal(s.images.length,0);
s.scope.LauncherSettings.refresh('a');s.scope.LauncherSettings.refresh('a');s.scope.LauncherSettings.refresh('b');assert.equal(s.scripts.length,1);
s.scope.CONFIG.wallpaperDim=.4;s.scripts[0].onload();assert.equal(s.scripts.length,2);assert(s.els.screen.style.background.includes('0.4'));
s.scripts[1].onload();s.scope.LauncherSettings.refresh('b');assert.equal(s.scripts.length,2);
s.scope.LauncherSettings.refresh('bad');s.scripts[2].onerror();s.scope.LauncherSettings.refresh('bad');assert.equal(s.scripts.length,4);s.scripts[3].onload();
const priorWrites=s.frostWrites.length;s.scope.LauncherSettings.apply();
assert.equal(s.frostWrites.length,priorWrites,'Unchanged wallpaper settings must not repaint the texture');
s.scope.CONFIG.wallpaper='new-photo.jpg';s.scope.CONFIG.wallpaperFrost='new-photo-frost.jpg';s.scope.LauncherSettings.apply();
assert(s.els.dockFrost.style.backgroundImage.includes('new-photo-frost.jpg'));assert(s.els.dockBand.classList.contains('frosted'));
assert.equal(s.els.dockFrost.style.backgroundSize,'1920px 1080px');assert.equal(s.els.dockFrost.style.transform,'translateY(666px)');
s.scope.CONFIG.wallpaper='';s.scope.LauncherSettings.apply();
assert.equal(s.els.dockFrost.style.backgroundImage,'');assert.equal(s.els.dockFrost.style.backgroundSize,'1920px 1080px');
assert(!s.els.dockBand.classList.contains('frosted'),'Removing the photo also removes the dedicated tint overlay');
assert.equal(s.els.dockFrost.style.transform,'translateY(666px)');
s=setup({wallpaper:'legacy.jpg',weather:{enabled:false}});s.visible(false);s.advance(5000);assert.equal(s.images.length,0);assert.equal(s.timers.size,0);
s.visible(true);s.idle(false);s.advance(3000);assert.equal(s.images.length,0);
s.idle(true);s.advance(1500);assert.equal(s.images.length,1);s.idle(false);s.images[0].onload();assert.equal(s.canvas(),0);
s.visible(false);s.advance(5000);assert.equal(s.timers.size,0);s.visible(true);s.idle(true);s.advance(1500);assert.equal(s.canvas(),2);
assert(s.els.dockFrost.style.backgroundImage.includes('data:test'));assert(s.els.dockBand.classList.contains('frosted'),'Legacy generated textures also use the composited layer');
// Changing wallpaper during an outstanding legacy decode must not let its old
// callback overwrite the newer texture or re-enable tint after clearing it.
s=setup({wallpaper:'legacy.jpg',weather:{enabled:false}});s.advance(1500);
const staleLoad=s.images[0].onload;
s.scope.CONFIG.wallpaper='current.jpg';s.scope.CONFIG.wallpaperFrost='current-frost.jpg';s.scope.LauncherSettings.apply();
staleLoad();assert(s.els.dockFrost.style.backgroundImage.includes('current-frost.jpg'));assert.equal(s.canvas(),0);
s.scope.CONFIG.wallpaper='';s.scope.LauncherSettings.apply();staleLoad();
assert.equal(s.els.dockFrost.style.backgroundImage,'');assert(!s.els.dockBand.classList.contains('frosted'));
s=setup({wallpaper:'',weather:{enabled:true,latitude:0,longitude:0,place:'Equator'}});s.advance(1500);assert.equal(s.requests.length,1);
s.visible(false);assert(s.requests[0].aborted);s.advance(100000);assert.equal(s.requests.length,1);
s.visible(true);s.advance(1500);assert.equal(s.requests.length,2);
s.scope.CONFIG.weather.enabled=false;s.scope.LauncherSettings.apply();assert(s.requests[1].aborted);assert.equal(s.els.weather.textContent,'');
console.log('Hot settings/retry, dedicated frost updates/clear without geometry writes, stale legacy decode isolation and weather suspension passed.');
