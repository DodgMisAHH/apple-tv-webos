// Exercise Home's Settings request boundary, including duplicate native events.
const assert=require('assert'),fs=require('fs'),vm=require('vm');
function setup(initial={},hidden=false){
  const classes=new Set(), listeners={};let opens=0,closes=0,cancels=0,wallCloses=0,allowed=true;
  const document={hidden,body:{classList:{contains:n=>classes.has(n)}},addEventListener(n,fn){listeners[n]=fn;}};
  const window={PalmSystem:{launchParams:JSON.stringify(initial)},
    LauncherControls:{cancelPress(){cancels++;},canOpen(){return allowed;},closeWallpaper(back){assert.equal(back,false);wallCloses++;classes.delete('wallOpen');}},
    openControlCentre(){opens++;classes.add('ccOpen');},closeControlCentre(){closes++;classes.delete('ccOpen');}};
  vm.runInNewContext(fs.readFileSync('app/home-settings.js','utf8'),{window,document});
  return {window,document,classes,emit(detail){listeners.webOSRelaunch({detail});},get opens(){return opens;},get closes(){return closes;},get wallCloses(){return wallCloses;},block(){allowed=false;}};
}
const request=n=>({controlCentre:true,controlCentreRequestId:'100-'+n});
let t=setup();t.emit(request(1));assert.equal(t.opens,1);
t.emit(JSON.stringify(request(1)));assert.equal(t.closes,0,'duplicate events cannot toggle twice');
t.emit(request(2));assert.equal(t.closes,1,'next Settings press closes Home controls');
t.emit({home:true,reload:false});assert.equal(t.opens,1,'normal Home request cannot reopen controls');
for(const invalid of [null,'{bad',{}, {controlCentre:true}, {...request(3),controlCentre:false}, {...request(3),controlCentreRequestId:'unsafe'}, {...request(3),controlCentreRequestId:123}])t.emit(invalid);
assert.equal(t.opens,1,'malformed or unrelated requests are ignored');
t=setup(request(4));assert.equal(t.opens,1,'cold page handles request after controllers load');t.emit({});assert.equal(t.closes,0,'retained Palm parameters are idempotent');
t=setup({},true);t.emit(request(5));assert.equal(t.opens,0,'hidden page does not open controls');t.document.hidden=false;t.emit(request(5));assert.equal(t.opens,0,'stale hidden request cannot reopen on return');t.emit(request(6));assert.equal(t.opens,1);
for(const flags of [{reason:'preload'},{preload:'full'},{snapshot:true}]){t=setup({...request(7),...flags});assert.equal(t.opens,0);}
t=setup();t.classes.add('wallOpen');t.emit(request(8));assert.equal(t.wallCloses,1);assert.equal(t.opens,0,'wallpaper can dismiss without reopening its parent');
t=setup();t.block();t.emit(request(9));assert.equal(t.opens,0,'an active edit that Home has not resumed is not overlaid');
assert(!fs.readFileSync('app/overlay.html','utf8').includes('home-settings.js'),'Home request handler is not loaded by the floating overlay');
assert(fs.readFileSync('app/index.html','utf8').indexOf('home-settings.js')>fs.readFileSync('app/index.html','utf8').indexOf('control-centre.js'),'Home handler loads after controls');
console.log('Home Settings requests, initial launch, duplicate tokens, toggle, hidden/preload guards and unrelated Home events passed.');
