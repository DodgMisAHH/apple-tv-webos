const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('app/app.js','utf8');
const take=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function classes(){const values=new Set();return {add:v=>values.add(v),remove:v=>values.delete(v),contains:v=>values.has(v),toggle(v,on){if(v==='render-cached')cacheWrites++;on?values.add(v):values.delete(v);}};}
let writes=0,cacheWrites=0,passes=0;
const motionWrites=[];
function tile(i){return {app:{id:String(i)},el:{classList:classes(),style:new Proxy({}, {set(o,k,v){if(k==='left'||k==='top')throw new Error('Tile position must not animate layout');if(k==='transform')writes++;o[k]=v;return true;}})}};}
const items=Array.from({length:12},(_,i)=>tile(i));
items.forEach=function(fn){passes++;return Array.prototype.forEach.call(this,fn);};
const elements={shelfHint:{style:{}},hero:{style:{}}};
function movingStyle(name){return new Proxy({}, {set(o,k,v){
 if(/^background/.test(k))throw new Error('Navigation must not repaint the wallpaper texture');
 if(k==='transform')motionWrites.push({name,value:v});o[k]=v;return true;
}});}
const bandStyle=movingStyle('band'),frostStyle=movingStyle('frost');
const scope={items,COLUMNS:6,GRID_SIDE:65,CELL_W:(1920-130)/6,TILE_W:250,TILE_H:150,DOCK_TOP:826,ROW_PITCH:230,DOCK_GAP:0,
 VIEW_TOP:80,VIEW_BOTTOM:1060,band:{style:bandStyle},frost:{style:frostStyle},stage:{style:movingStyle('stage')},pen:{style:{}},renderedOffset:null,cacheOffset:null,
 offset:0,zone:'grid',focused:0,document:{body:{classList:classes()}},$:id=>elements[id],
 setZone(z){scope.zone=z;},setAmbient(){},cancelPress(){}};
vm.createContext(scope);
vm.runInContext(take('  function rowOf(i)','  function build()'),scope);
vm.runInContext(take('  function layout()','  /**\n   * Store icons'),scope);
vm.runInContext(take('  function focusTile(i)','  /** Crossfades the glow'),scope);
function translation(style){const m=/^translateY\((-?[\d.]+)px\)$/.exec(style.transform);assert(m,'Expected a composited vertical translation');return Number(m[1]);}
function aligned(label){
 assert.equal(parseFloat(bandStyle.left)+parseFloat(frostStyle.left),0,label+': wallpaper starts at screen x=0');
 assert.equal(parseFloat(bandStyle.top)+parseFloat(frostStyle.top),0,label+': local wallpaper origin cancels the shelf position');
 assert.equal(translation(scope.stage.style)+translation(frostStyle),0,label+': opposite translations keep the wallpaper fixed on screen');
}
scope.layout();assert.equal(writes,12);assert.equal(items[0].el.style.transform,'translate(89.16666666666666px,826px)');
assert(items.every(it=>it.el.classList.contains('render-cached')),'Both rows in the measured 12-app inventory must start cached');
assert.equal(cacheWrites,12);
scope.layout();assert.equal(writes,12,'Unchanged layout must not write positions');assert.equal(cacheWrites,12,'Unchanged cache membership must not rewrite classes');
[items[0],items[1]]=[items[1],items[0]];scope.layout();assert.equal(writes,14,'Only moved tiles should change transforms');
const horizontalPasses=passes,horizontalCacheWrites=cacheWrites;
scope.focusTile(0);scope.focusTile(1);assert.equal(writes,14,'Ordinary arrows must not reposition tiles');
assert.equal(motionWrites.length,2,'Same-row arrows must not rewrite either moving layer');aligned('Collapsed drawer');
assert.equal(passes,horizontalPasses,'Same-row arrows must not scan the inventory');assert.equal(cacheWrites,horizontalCacheWrites);
scope.focusTile(6);assert.equal(scope.stage.style.transform,'translateY(-666px)');
assert.equal(frostStyle.transform,'translateY(666px)');aligned('Expanded drawer');
assert(items.every(it=>it.renderCached),'Both rows remain cached in the expanded grid');
scope.focusTile(11);scope.focusTile(0);assert.equal(scope.stage.style.transform,'translateY(0px)');
assert.equal(motionWrites.length,6,'Expand/collapse moves each layer once without same-row writes');aligned('Collapsed after expansion');
// A large inventory must not become a permanent layer cache. Scroll far away,
// then return: old rows release their hints and incoming visible rows acquire them.
while(items.length<500)items.push(tile(items.length));
scope.layout();scope.focusTile(300);
assert(scope.offset>1080,'Exercise wallpaper alignment after scrolling beyond one screen');aligned('Deep scroll');
assert(items[300].renderCached);assert(!items[0].renderCached);assert(!items[499].renderCached);
assert(items.filter(it=>it.renderCached).length<=48,'Six columns need at most eight cached rows');
scope.focusTile(0);assert(items[0].renderCached);assert(!items[300].renderCached);aligned('Return from deep scroll');
// The bound holds across supported saved column counts, including the densest grid.
for(let columns=3;columns<=10;columns++){
 scope.COLUMNS=columns;scope.CELL_W=(1920-130)/columns;
 scope.TILE_W=Math.min(380,Math.round(scope.CELL_W*.838));scope.TILE_H=Math.round(scope.TILE_W*.6);
 scope.ROW_PITCH=scope.TILE_H+80;scope.DOCK_TOP=976-scope.TILE_H;
 scope.offset=0;scope.renderedOffset=null;scope.cacheOffset=null;scope.focused=0;
 scope.layout();scope.focusTile(250);
 aligned(columns+' columns, deep scroll');
 assert(items.filter(it=>it.renderCached).length<=90,'Cache size must remain independent of 500-app inventory');
 for(let i=0;i<items.length;i++){
  const y=scope.tileTop(i)-scope.offset;
  if(y+scope.TILE_H>=0&&y<=1080)assert(items[i].renderCached,'Every visible card must retain its texture');
 }
 const beforePasses=passes,beforeWrites=cacheWrites,beforeMotion=motionWrites.length;
 scope.focusTile(scope.focused%columns<columns-1?scope.focused+1:scope.focused-1);
 assert.equal(passes,beforePasses);assert.equal(cacheWrites,beforeWrites);assert.equal(motionWrites.length,beforeMotion,'Horizontal navigation must not rewrite the frost transform');
}
// Both layers receive opposite targets in the same synchronous operation.
// Matching transition curves also cancel throughout expand/collapse, rather
// than jumping to a new wallpaper crop before the drawer animation finishes.
assert.equal(motionWrites.length%2,0);
let previousStage=0,previousFrost=0;
for(let i=0;i<motionWrites.length;i+=2){
 const stage=motionWrites[i],frost=motionWrites[i+1];
 assert.equal(stage.name,'stage');assert.equal(frost.name,'frost');
 const nextStage=translation({transform:stage.value}),nextFrost=translation({transform:frost.value});
 for(const progress of [0,.1,.25,.5,.75,.9,1]){
  const screenOffset=previousStage+(nextStage-previousStage)*progress+previousFrost+(nextFrost-previousFrost)*progress;
  assert(Math.abs(screenOffset)<1e-9,'Wallpaper must stay aligned during the transition, including collapse');
 }
 previousStage=nextStage;previousFrost=nextFrost;
}
const css=fs.readFileSync('app/style.css','utf8');
function styleFor(selector){return Array.from(css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g))
 .filter(match=>match[1].split(',').map(s=>s.trim()).includes(selector)).map(match=>match[2]).join('\n');}
const stageRule=styleFor('#stage'),frostRule=styleFor('#dockFrost');
function transition(rule){return rule.match(/transition:\s*([^;]+);/)[1].replace(/\s+/g,' ').trim();}
assert.equal(transition(frostRule),transition(stageRule),'Texture and drawer must animate with identical timing');
assert(/transform 420ms/.test(transition(frostRule)));
assert(/will-change:\s*transform/.test(frostRule));
assert(/width:\s*1920px/.test(frostRule)&&/height:\s*1080px/.test(frostRule),'Texture layer covers the whole wallpaper plane');
assert(/#dockBand\.frosted::after\s*\{/.test(css),'Frost tint is a separate overlay, not repainted into the moving image');
const html=fs.readFileSync('app/index.html','utf8');
assert(/<div\b[^>]*id="dockBand"[^>]*>\s*<div\b[^>]*id="dockFrost"/.test(html),'Texture stays clipped within the shelf');
assert(!/transition:\s*left/.test(css));assert(/body\.browsing #screen::after\s*\{\s*opacity: 1;/.test(css));
assert(/#stage\s*\{[^}]*will-change:\s*transform/.test(css));
assert(/\.item\.render-cached \.card\s*\{\s*will-change:\s*transform;/.test(css));
console.log('Transform placement, bounded caching, zero horizontal layer writes and composited wallpaper alignment through expand/collapse/deep scroll passed.');
