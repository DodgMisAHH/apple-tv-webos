// Run the complete controllers with delayed TV callbacks and a small DOM/event fixture.
// This verifies interaction/lifecycle behavior; it does not measure rendering performance.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.parentNode = null; this.style = {};
    this.className = ''; this.attributes = {}; this.listeners = {}; this._text = '';
    this.scrollHeight = 300; this.clientHeight = 300; this.scrollTop = 0;
    this.offsetTop = 0; this.offsetHeight = 70;
    this.classWrites = 0;
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: name => {this.classWrites++; if (!this.classList.contains(name)) this.className += ' ' + name;},
      remove: name => {this.classWrites++; this.className = this.className.split(/\s+/).filter(x => x !== name).join(' ');},
      toggle: (name, enabled) => enabled ? this.classList.add(name) : this.classList.remove(name)
    };
  }
  set textContent(value) {this._text = String(value); this.children.forEach(c => {c.parentNode = null;}); this.children = [];}
  get textContent() {return this._text + this.children.map(c => c.textContent).join('');}
  set innerHTML(value) {this.textContent = '';}
  get firstChild() {return this.children[0] || null;}
  appendChild(child) {child.parentNode = this; child.ownerDocument = this.ownerDocument; this.children.push(child); return child;}
  insertBefore(child, before) {if (!before) return this.appendChild(child); child.parentNode = this; child.ownerDocument = this.ownerDocument; this.children.splice(this.children.indexOf(before), 0, child); return child;}
  removeChild(child) {this.children.splice(this.children.indexOf(child), 1); child.parentNode = null;}
  setAttribute(name, value) {this.attributes[name] = String(value);}
  removeAttribute(name) {delete this.attributes[name];}
  addEventListener(name, fn) {(this.listeners[name] || (this.listeners[name] = [])).push(fn);}
  focus() {if (!this.ownerDocument || this.disabled) return; const previous=this.ownerDocument.activeElement;if(previous&&previous!==this)previous.blur();this.ownerDocument.activeElement=this;for(const fn of this.listeners.focus||[])fn({target:this});}
  blur() {if(this.ownerDocument&&this.ownerDocument.activeElement===this)this.ownerDocument.activeElement=null;for(const fn of this.listeners.blur||[])fn({target:this});}
  click() {for (const fn of this.listeners.click || []) fn({stopPropagation() {}});}
  querySelector(selector) {return find(this, e => selector[0] === '.' ? selector.slice(1).split('.').every(c => e.classList.contains(c)) : e.tagName === selector);}
}
function find(root, predicate) {for (const c of root.children) {if (predicate(c)) return c; const result = find(c, predicate); if (result) return result;} return null;}
function setup(initialHidden = [], initiallyHidden = false, wifiOptions = {}) {
  let now = 100000, next = 0, interactions = 0, pressesCancelled = 0;
  let hiddenApps = initialHidden.slice(), wallpaperReturn = null;
  const body = new Element('body'), windowListeners = {}, documentListeners = {}, requests = [], timers = new Map(), panelState = {}, toasts = [];
  function add(tag, id, parent = body) {const el = new Element(tag); el.id = id; parent.appendChild(el); return el;}
  const clock = add('div', 'timeRow'), centre = add('section', 'controlCentre');
  add('span', 'clock', clock).textContent = '12:00';
  add('span', 'ampm', clock).textContent = 'PM';
  add('button', 'ccClose', centre); add('div', 'ccTiles', centre);
  const detail = add('div', 'ccDetail', centre); add('h2', '', detail); add('p', '', detail); add('button', 'ccDetailBack', detail);
  add('div', 'ccShade'); add('span', 'wifiLabel').textContent = 'Connected';
  const tile = add('div', 'focusedApp'); tile.className = 'item focused dock';
  const document = {body, hidden: initiallyHidden, createElement: tag => {const el=new Element(tag);el.ownerDocument=document;return el;},
    getElementById: id => find(body, e => e.id === id), querySelector: selector => body.querySelector(selector),
    addEventListener(name, fn) {(documentListeners[name] || (documentListeners[name] = [])).push(fn);}};
  function own(el){el.ownerDocument=document;el.children.forEach(own);}own(body);
  const wifiJoins=[],wifiProfiles=[];
  const window = {addEventListener(name, fn) {(windowListeners[name] || (windowListeners[name] = [])).push(fn);},
    WifiControls:{pending(){return wifiJoins.some(request=>!request.done);},
      join(params,cb){const request={params:JSON.parse(JSON.stringify(params)),cb,done:false,cancelled:false};wifiJoins.push(request);return function(){request.done=true;request.cancelled=true;};},
      profiles(cb){const request={cb,done:false,cancelled:false};wifiProfiles.push(request);if(!wifiOptions.deferProfiles){request.done=true;cb(wifiOptions.profileResult||{returnValue:true,profiles:[]});}return function(){request.done=true;request.cancelled=true;};}},
    LauncherControls: {canOpen: () => true, noteInteraction() {interactions++;}, cancelPress() {pressesCancelled++;},
      setPanelActive(name, value) {panelState[name] = value; interactions++; if (value) pressesCancelled++;},
      toast(value) {toasts.push(value);}, launch(id,title,params) {requests.push({uri:'launch:'+id,title,params,done:true});},
      hiddenApps() {return hiddenApps.slice();},
      restoreApp(id) {const count = hiddenApps.length; hiddenApps = hiddenApps.filter(app => app.id !== id); return count !== hiddenApps.length;},
      wallpaper(onClose) {wallpaperReturn = onClose; panelState.wallpaper = true;},
      luna(uri, params, cb) {
        const match = params.command.match(/luna:\/\/[^' ]+/);
        const vpn=params.command.match(/profiles\.js' '(status|select|connect|disconnect)'/);
        const request={uri: match ? match[0] : vpn ? 'vpn:'+vpn[1] : '', transport:uri, params, cb, done:false, cancelled:false};
        requests.push(request);
        return function(){request.cancelled=true;request.done=true;};
      }}};
  const scope = {window, document, PalmServiceBridge() {}, Date: {now: () => now}, atob: value => Buffer.from(value,'base64').toString('binary'),
    setTimeout(fn, ms) {timers.set(++next, {fn, at: now + ms}); return next;}, clearTimeout(id) {timers.delete(id);}};
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync('app/tv-controls.js', 'utf8'), scope);
  vm.runInContext(fs.readFileSync('app/vpn-controls.js', 'utf8'), scope);
  vm.runInContext(fs.readFileSync('app/control-centre.js', 'utf8'), scope);
  function keyEvent(name, keyCode, repeat = false) {
    let stopped = false,defaultPrevented=false;
    const event = {keyCode, repeat,target:document.activeElement, preventDefault() {defaultPrevented=true;}, stopImmediatePropagation() {stopped = true;}};
    for (const fn of windowListeners[name] || []) {fn(event); if (stopped) break;}
    if (!stopped) for (const fn of documentListeners[name] || []) fn(event);
    return {stopped,defaultPrevented};
  }
  function key(keyCode, repeat = false) {return keyEvent('keydown', keyCode, repeat);}
  function respond(request, data) {assert(request, 'expected outstanding request'); request.done = true; request.cb({stdoutString: JSON.stringify(data)});}
  return {window, document, body, detail, requests, panelState, toasts, key, respond,wifiJoins,wifiProfiles,
    wifiReply(request,result){request.done=true;request.cb(result);},
    keyboard(visibility){for(const fn of documentListeners.keyboardStateChange||[])fn({detail:{visibility}});},
    submitWifi(){let prevented=false;for(const fn of document.getElementById('ccWifiForm').listeners.submit||[])fn({preventDefault(){prevented=true;}});return prevented;},
    emit(request,data){assert(request,'expected stream request');if((data.event||data.type)==='close')request.done=true;request.cb(data);},
    keyup(keyCode) {return keyEvent('keyup', keyCode);},
    lifecycle(name, hidden) {if (hidden !== undefined) document.hidden = hidden; for (const fn of (['focus','pagehide','pageshow'].includes(name) ? windowListeners : documentListeners)[name] || []) fn({});},
    returnFromWallpaper() {assert.equal(typeof wallpaperReturn, 'function'); const cb = wallpaperReturn; wallpaperReturn = null; panelState.wallpaper = false; cb();},
    get interactions() {return interactions;}, get pressesCancelled() {return pressesCancelled;},
    pending(suffix) {return requests.filter(r => !r.done && r.uri.endsWith(suffix));},
    reply(suffix, data) {respond(this.pending(suffix)[0], data);},
    advance(ms) {const end = now + ms; for (;;) {const pair = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!pair) break; now = pair[1].at; timers.delete(pair[0]); pair[1].fn();} now = end;},
    actions() {const box = document.getElementById('ccActions'); return box ? box.children : [];},
    tiles() {return document.getElementById('ccTiles').children;},
    openSound() {key(38); key(40); key(13);}
  };
}
const output = value => ({returnValue: true, soundOutput: value});
const choices = {returnValue: true, values: {arrayExt: ['tv_speaker', 'external_optical', 'external_arc'].map(value => ({value, active: true, visible: true}))}};
const inputs = {returnValue: true, arcDevice: false, devices: [{id: 'HDMI 1', label: 'HDMI 1', appId: 'hdmi1'}]};

let t = setup(); t.openSound();
assert(t.panelState.controlCentre); assert(t.pressesCancelled > 0);
assert.equal(t.pending('/getSoundOutput').length, 1, 'header and Sound share current-output read');
assert.equal(t.pending('/getSystemSettingValues').length, 1);
assert.equal(t.pending('/getAllInputStatus').length, 1, 'all three Sound reads start before any reply');
assert.equal(t.detail.querySelector('p').textContent, '', 'Loading does not add a submenu subtitle');
t.reply('/getAllInputStatus', inputs); t.reply('/getSystemSettingValues', choices);
assert.equal(t.actions().length, 0, 'wait until snapshot is complete');
t.reply('/getSoundOutput', output('tv_speaker'));
assert.deepEqual(t.actions().map(b => b.textContent), ['TV speakers✓', 'Optical']);
let old = t.actions()[0], writes = old.classWrites, interactions = t.interactions;
t.key(38); assert.equal(old.classWrites, writes, 'same list selection performs no class mutation'); assert(t.interactions > interactions);
t.key(40); t.key(13); t.key(13);
assert.equal(t.pending('/setSystemSettings').length, 1, 'repeated OK cannot duplicate output write');
assert(t.actions()[1].classList.contains('isPending'));
t.key(27); assert(t.panelState.controlCentre); assert(t.detail.hidden, 'Back returns to the main controls');
assert(t.tiles()[3].classList.contains('selected'), 'Back remembers the original Sound control');
t.key(27); assert(!t.panelState.controlCentre);
t.reply('/setSystemSettings', {returnValue: false, errorText: 'Rejected'});
assert(!t.body.classList.contains('ccOpen'), 'departed-panel failure does not reopen controls');

t = setup(); t.openSound(); const stale = t.pending('/getSoundOutput')[0]; t.key(27);
t.respond(stale, output('external_optical')); t.reply('/getSystemSettingValues', choices); t.reply('/getAllInputStatus', inputs);
assert.equal(t.actions().length, 0, 'departed-panel callbacks cannot create a list');
t.key(13); // remembered main selection is Sound
assert.equal(t.actions().length, 2, 'cached choices appear immediately on return');
assert.equal(t.pending('/getSoundOutput').length, 1, 'cached view refreshes in background');

const oldOutputRead = t.pending('/getSoundOutput')[0];
t.key(38); t.key(13); // cached TV speakers: switch away from cached Optical
assert.equal(t.pending('/setSystemSettings').length, 1);
t.reply('/setSystemSettings', {returnValue: true});
const newOutputRead = t.pending('/getSoundOutput').find(r => r !== oldOutputRead);
t.respond(newOutputRead, output('tv_speaker'));
t.reply('/getSystemSettingValues', choices); t.reply('/getAllInputStatus', inputs);
assert(t.actions()[0].textContent.endsWith('✓'));
t.respond(oldOutputRead, output('external_optical'));
assert(t.actions()[0].textContent.endsWith('✓'), 'older refresh cannot undo newer confirmed output');

t = setup(); t.key(38); t.key(13); t.key(13);
assert.equal(t.pending('/powerOff').length, 1, 'power remains one immediate action with duplicate protection');
t.key(39); t.reply('/powerOff', {returnValue: false, errorText: 'Rejected'});
assert.equal(t.detail.hidden, true, 'power error cannot replace a newer main selection');

// LG can wake the picture itself before Home's wake request, then reject that
// request because the power state is already Active. This must release input.
const alreadyAwake = {returnValue: false, state: 'Active', errorCode: -102, errorText: "The current state must be 'Screen Off'."};
t = setup(); t.key(38); t.tiles()[2].click();
t.reply('/turnOffScreen', {returnValue: true});
assert(t.key(13).stopped, 'First wake OK is consumed');
t.key(13, true); t.key(40);
assert.equal(t.pending('/turnOnScreen').length, 1, 'Wake repeats and pending navigation cannot duplicate the request');
assert(t.tiles()[2].classList.contains('selected'), 'Navigation waits for the wake attempt');
t.reply('/turnOnScreen', alreadyAwake);
assert.equal(t.toasts.length, 0, 'Already-awake firmware response is not a user-facing failure');
assert(t.key(13, true).stopped, 'Held wake OK stays consumed after wake completes');
assert.equal(t.pending('/turnOffScreen').length, 0, 'Held wake OK cannot turn the picture off again');
assert(t.keyup(13).stopped, 'Wake OK release cannot launch a Home item');
t.key(40); assert(t.tiles()[4].classList.contains('selected'), 'Navigation recovers after the already-active response');
t.key(461); assert(!t.panelState.controlCentre);
assert(!t.key(39).stopped, 'Home receives keys after closing the controls');

t = setup(); t.key(38); t.tiles()[2].click(); t.reply('/turnOffScreen', {returnValue: true});
t.key(40); t.reply('/turnOnScreen', alreadyAwake);
t.key(40, true); assert(t.tiles()[2].classList.contains('selected'), 'Held wake direction cannot navigate');
t.key(40); assert(t.tiles()[4].classList.contains('selected'), 'Fresh press recovers even if firmware consumed the wake keyup');

// Generic failures and lost replies also release input after one bounded wake
// attempt, so an error cannot turn the capture listener into a permanent lock.
for (const response of [{returnValue: true}, {returnValue: false, errorText: 'Wake failed'}, null]) {
  t = setup(); t.key(38); t.tiles()[2].click(); t.reply('/turnOffScreen', {returnValue: true});
  t.key(13); t.keyup(13);
  const wakeRequest = t.pending('/turnOnScreen')[0];
  if (response) t.respond(wakeRequest, response); else t.advance(6500);
  t.key(40); assert(t.tiles()[4].classList.contains('selected'), 'Wake completion/timeout releases navigation');
  assert.equal(t.requests.filter(r => r.uri.endsWith('/turnOnScreen')).length, 1, 'Later keys do not retry a completed wake');
  assert.equal(t.toasts.length, response && response.returnValue ? 0 : 1);
  if (!response) {
    t.respond(wakeRequest, alreadyAwake); t.key(37);
    assert(t.tiles()[3].classList.contains('selected'), 'Late timeout reply cannot steal restored navigation');
  }
}

// A wake can arrive while Screen Off is still awaiting its callback. Queue one
// wake behind it, and never re-arm input capture from a reply after resume.
t = setup(); t.key(38); t.tiles()[2].click(); t.key(13); t.keyup(13);
assert.equal(t.pending('/turnOnScreen').length, 0, 'Wake waits for the pending Screen Off write');
t.reply('/turnOffScreen', {returnValue: true});
assert.equal(t.pending('/turnOnScreen').length, 1, 'Deferred wake runs once Screen Off completes');
t.reply('/turnOnScreen', {returnValue: true}); t.key(40);
assert(t.tiles()[4].classList.contains('selected'));

for (const event of ['focus', 'webOSRelaunch', 'visibilitychange']) {
  t = setup(); t.key(38); t.tiles()[2].click();
  if (event === 'visibilitychange') t.lifecycle(event, true);
  t.lifecycle(event, false); t.reply('/turnOffScreen', {returnValue: true});
  assert.equal(t.pending('/turnOnScreen').length, 0, 'Late Screen Off reply cannot re-arm after ' + event);
  if (event === 'visibilitychange') {
    assert(!t.panelState.controlCentre); assert(!t.key(39).stopped, 'Visible Home receives navigation');
  } else {
    t.key(40); assert(t.tiles()[4].classList.contains('selected'), event + ' releases stale capture');
  }
}

t = setup(); t.key(38); t.tiles()[2].click(); t.reply('/turnOffScreen', {returnValue: true});
t.key(13); t.lifecycle('focus');
t.reply('/turnOnScreen', {returnValue: false, errorText: 'Late failure'});
assert.equal(t.toasts.length, 0, 'Stale wake failure cannot appear after firmware resume');
t.key(13, true); assert.equal(t.pending('/turnOffScreen').length, 0);
t.keyup(13); t.key(40); assert(t.tiles()[4].classList.contains('selected'));

t = setup(); t.key(38); t.key(39); t.key(40);
t.reply('/getSoundOutput', output('external_optical'));
assert.equal(t.tiles()[3].querySelector('small').textContent, 'Optical', 'main-panel navigation does not discard its output-label read');

// Every supported Back key steps out of details before closing; holding it
// cannot skip the main controls. The next OK reopens the original submenu.
for (const backKey of [461, 27, 8]) {
  t = setup(); t.openSound(); t.key(backKey);
  assert(t.panelState.controlCentre); assert(t.detail.hidden);
  assert(t.tiles()[3].classList.contains('selected'));
  t.key(backKey, true); assert(t.panelState.controlCentre, 'Held Back cannot skip a level');
  t.key(13); assert(!t.detail.hidden, 'OK returns to the original submenu');
  t.key(backKey); t.key(backKey); assert(!t.panelState.controlCentre);
}

// A cancelled Wi-Fi scan must not rebuild a departed detail view or surface
// its timeout while the main Control Centre remains open.
t = setup(); t.key(38); t.key(39); t.key(13);
const departedWifi=t.pending('/findnetworks')[0];t.key(461);
assert(departedWifi.cancelled,'Leaving Wi-Fi releases the streaming bridge');
t.respond(departedWifi, {returnValue: true, foundNetworks: [{networkInfo: {ssid: 'Home', connectState: 'ipConfigured'}}]});
t.advance(7000); assert(t.detail.hidden); assert(!t.detail.classList.contains('hasError'));
assert.equal(t.actions().length, 0); assert(t.panelState.controlCentre);

// The first findnetworks response is cached. Keep the bounded subscription and
// replace that list when the completed scan adds nearby access points.
const wifiData=networks=>({returnValue:true,subscribed:true,foundNetworks:networks.map(networkInfo=>({networkInfo}))});
const wifiHome={ssid:'Home',displayName:'Home',connectState:'ipConfigured',available:true};
const wifiNearby={ssid:'Nearby',displayName:'Nearby',available:true};
function wifiChunk(data){return {event:'stdoutData',stdoutString:JSON.stringify(data)+'\n'};}
t=setup();t.key(38);t.tiles()[1].click();
let wifiRequest=t.pending('/findnetworks')[0];
assert(wifiRequest.transport.endsWith('/spawn'));
assert.equal(wifiRequest.params.subscribe,true);
assert(wifiRequest.params.command.includes('-i -w 8000'));
assert(wifiRequest.params.command.includes('"subscribe":true'));
assert(!t.requests.some(r=>r.uri.endsWith('/scan')),'Never combine manual scan with findnetworks');
t.emit(wifiRequest,wifiChunk(wifiData([wifiHome])));
assert.deepEqual(t.actions().map(b=>b.textContent),['Home✓','Open LG Wi-Fi Settings']);
assert(!wifiRequest.cancelled,'Cached reply cannot stop fresh scan updates');
t.emit(wifiRequest,wifiChunk(wifiData([wifiNearby,wifiHome,wifiNearby,{ssid:'Out of range',available:false}])));
assert.deepEqual(t.actions().map(b=>b.textContent),['Home✓','Nearby','Open LG Wi-Fi Settings']);
t.key(40);assert(t.actions()[1].classList.contains('selected'));
const selectedNetwork=t.actions()[1];
t.emit(wifiRequest,wifiChunk(wifiData([wifiHome,wifiNearby])));
assert.strictEqual(t.actions()[1],selectedNetwork,'Identical updates do not rebuild the list');
t.emit(wifiRequest,{event:'close',closeCode:0});assert(wifiRequest.cancelled);
assert(!t.detail.classList.contains('hasError'));

// Pipe chunks can split JSON and even a UTF-8 SSID byte sequence. Decode only
// complete lines, and support the documented legacy "type" event field too.
t=setup();t.key(38);t.tiles()[1].click();wifiRequest=t.pending('/findnetworks')[0];
const unicodeBytes=Buffer.from(JSON.stringify(wifiData([wifiHome,{ssid:'raw-name',displayName:'Café',available:true}]))+'\n');
const splitAt=unicodeBytes.indexOf(Buffer.from('é'))+1;
t.emit(wifiRequest,{type:'stdoutData',stdoutBytes:unicodeBytes.subarray(0,splitAt).toString('base64')});
assert.equal(t.actions().length,0,'Partial responses cannot replace the list');
t.emit(wifiRequest,{type:'stdoutData',stdoutBytes:unicodeBytes.subarray(splitAt).toString('base64')});
assert.deepEqual(t.actions().map(b=>b.textContent),['Home✓','Café','Open LG Wi-Fi Settings']);
t.emit(wifiRequest,{event:'exit',exitCode:0});assert(!wifiRequest.cancelled,'Drain final stdout before close');
t.emit(wifiRequest,{type:'close',closeCode:0});assert(wifiRequest.cancelled);

// The UI bound is absolute, and Back, hiding Home or pagehide release the
// request. Late callbacks cannot rebuild or relabel a departed submenu.
for(const end of ['timeout','visibilitychange','pagehide','close']){
  t=setup();t.key(38);t.tiles()[1].click();wifiRequest=t.pending('/findnetworks')[0];
  t.emit(wifiRequest,wifiChunk(wifiData([wifiHome])));
  if(end==='timeout')t.advance(9000);
  else if(end==='close')t.document.getElementById('ccClose').click();
  else t.lifecycle(end,true);
  assert(wifiRequest.cancelled,end+' cancels Wi-Fi bridge');
  t.emit(wifiRequest,wifiChunk(wifiData([wifiNearby])));
  assert(!t.actions().some(b=>b.textContent==='Nearby'),'Late callback ignored after '+end);
  assert.equal(t.requests.filter(r=>r.uri.endsWith('/findnetworks')).length,1,'No automatic rescan after '+end);
}
t=setup();t.key(38);t.tiles()[1].click();wifiRequest=t.pending('/findnetworks')[0];
t.advance(9000);assert(wifiRequest.cancelled);assert(t.detail.classList.contains('hasError'));
assert.deepEqual(t.actions().map(b=>b.textContent),['Open LG Wi-Fi Settings']);
t=setup();t.key(38);t.tiles()[1].click();wifiRequest=t.pending('/findnetworks')[0];
t.emit(wifiRequest,{event:'stdoutData',stdoutString:'invalid JSON\n'});
assert(wifiRequest.cancelled);assert(t.detail.classList.contains('hasError'));

// A network row opens an owned prompt for the exact SSID. Merely selecting it,
// finishing keyboard input, or receiving a late scan cannot start a connection.
const securedWifi={ssid:'Café "actual" $SSID',displayName:'Friendly name',available:true,availableSecurityTypes:['psk','wps']};
function openWifiRow(test,network){
  test.key(38);test.tiles()[1].click();const request=test.pending('/findnetworks')[0];
  test.emit(request,wifiChunk(wifiData([wifiHome,network])));test.actions()[1].click();return request;
}
t=setup();const promptScan=openWifiRow(t,securedWifi);
assert(promptScan.cancelled,'Opening a password prompt releases the scan');
assert(t.document.getElementById('ccActions').hidden);
assert.equal(t.document.getElementById('ccWifiNetwork').textContent,'Friendly name');
let password=t.document.getElementById('ccWifiPassword');
assert.equal(password.type,'password');assert.strictEqual(t.document.activeElement,password);
assert.equal(t.wifiJoins.length,0);
t.emit(promptScan,wifiChunk(wifiData([{ssid:'Unrelated',availableSecurityTypes:['none']}])));
assert.equal(t.document.getElementById('ccWifiNetwork').textContent,'Friendly name','Departed scan cannot replace the prompt');
password.value='a "secret" $value';t.keyboard(true);
for(const code of [8,13,37,38,39,40,65])assert(!t.key(code).defaultPrevented,'Input editing key '+code+' retains its browser default');
assert(!t.keyup(13).defaultPrevented);assert.equal(password.value,'a "secret" $value');assert.equal(t.wifiJoins.length,0);
t.keyboard(false);assert.strictEqual(t.document.activeElement,password,'Hiding the keyboard alone must not interrupt voice input');
t.key(40);assert.strictEqual(t.document.activeElement,t.document.getElementById('ccWifiJoin'),'Down can leave input after the native keyboard hides');
password.focus();assert(t.submitWifi());assert.equal(t.wifiJoins.length,0,'Keyboard Done/form submit only focuses Join');
t.key(13);t.key(13,true);t.document.getElementById('ccWifiJoin').click();
assert.equal(t.wifiJoins.length,1,'Join is explicit and cannot duplicate while pending');
assert.deepEqual(t.wifiJoins[0].params,{ssid:securedWifi.ssid,securityType:'psk',password:'a "secret" $value'});
assert.equal(password.value,'','The password leaves the input as soon as Join starts');
assert(password.disabled);
assert.equal(t.document.getElementById('ccWifiCancel').textContent,'Back','Leaving an already submitted connection must not promise cancellation');
t.wifiReply(t.wifiJoins[0],{returnValue:false,errorText:'Password not accepted.'});
assert.equal(password.value,'');assert(!password.disabled);assert.equal(t.document.getElementById('ccWifiStatus').textContent,'Password not accepted.');
assert.equal(t.document.getElementById('ccWifiCancel').textContent,'Cancel');
password.value='second attempt';t.document.getElementById('ccWifiJoin').click();
t.wifiReply(t.wifiJoins[1],{returnValue:true});
assert(!t.document.getElementById('ccWifiPrompt'));assert.equal(password.value,'');
assert(t.actions().some(button=>button.textContent==='Friendly name✓'));
assert.equal(t.toasts.at(-1),'Connected to Friendly name');
assert(!t.requests.some(request=>request.uri==='launch:com.palm.app.settings'));

// Saved credentials stay on the TV. Resolve missing scan IDs through profile
// metadata and request a password only after a saved personal connection fails.
t=setup([],false,{deferProfiles:true});openWifiRow(t,securedWifi);
assert(!t.document.getElementById('ccWifiPassword'));assert(t.document.getElementById('ccWifiJoin').disabled);
t.document.getElementById('ccWifiJoin').click();assert.equal(t.wifiJoins.length,0);
t.wifiReply(t.wifiProfiles[0],{returnValue:true,profiles:[
  {ssid:'Other',profileId:10,securityTypes:['psk']},
  {ssid:securedWifi.ssid,profileId:11,securityTypes:['wep']},
  {ssid:securedWifi.ssid,profileId:12,securityTypes:['psk']}
]});
assert(!t.document.getElementById('ccWifiPassword'));
t.document.getElementById('ccWifiJoin').click();
assert.deepEqual(t.wifiJoins[0].params,{ssid:securedWifi.ssid,securityType:'psk',profileId:12});
t.wifiReply(t.wifiJoins[0],{returnValue:false,failureCode:'connection',errorText:'Saved connection failed.'});
password=t.document.getElementById('ccWifiPassword');assert(password);assert.equal(password.value,'');
password.value='replacement';t.document.getElementById('ccWifiJoin').click();
assert.deepEqual(t.wifiJoins[1].params,{ssid:securedWifi.ssid,securityType:'psk',password:'replacement'});
t.key(461);assert(!t.document.getElementById('ccWifiPrompt'));assert(t.panelState.controlCentre);assert(!t.detail.hidden);
assert(t.wifiJoins[1].cancelled);assert.equal(password.value,'');
t.wifiReply(t.wifiJoins[1],{returnValue:true});assert(!t.document.getElementById('ccWifiPrompt'));assert.equal(t.toasts.length,0,'A cancelled join callback cannot announce or reopen the UI');

t=setup();openWifiRow(t,{...securedWifi,profileId:42});
assert.equal(t.wifiProfiles.length,0,'A scan-provided profile does not need another lookup');
assert(!t.document.getElementById('ccWifiPassword'));assert.equal(t.wifiJoins.length,0);
t.document.getElementById('ccWifiCancel').click();assert.equal(t.wifiJoins.length,0);assert(!t.document.getElementById('ccActions').hidden);
for(const profileId of ['42',1.5,-1,2147483648]){
  t=setup();openWifiRow(t,{...securedWifi,profileId});
  assert.equal(t.wifiProfiles.length,1,'Invalid scan profile '+profileId+' requires a real profile lookup');
  assert(t.document.getElementById('ccWifiPassword'),'Malformed profile cannot be presented as saved credentials');
}
for(const profileId of [0,2147483647]){
  t=setup();openWifiRow(t,{...securedWifi,profileId});
  assert.equal(t.wifiProfiles.length,0);t.document.getElementById('ccWifiJoin').click();
  assert.equal(t.wifiJoins[0].params.profileId,profileId,'Boundary integer profile IDs remain usable');
}
t=setup([],false,{profileResult:{returnValue:true,profiles:[
  {ssid:securedWifi.ssid,profileId:'7',securityTypes:['psk']},
  {ssid:securedWifi.ssid,profileId:2.5,securityTypes:['psk']}
]}});openWifiRow(t,securedWifi);
assert(t.document.getElementById('ccWifiPassword'),'Malformed lookup profiles cannot become credential reuse');
for(const code of ['permission','pending','timeout','unavailable','invalid']){
  t=setup();openWifiRow(t,{...securedWifi,profileId:42});t.document.getElementById('ccWifiJoin').click();
  t.wifiReply(t.wifiJoins[0],{returnValue:false,failureCode:code,errorText:'Safe '+code+' message.'});
  assert(!t.document.getElementById('ccWifiPassword'),code+' must not ask for a replacement saved password');
  assert.equal(t.document.getElementById('ccWifiStatus').textContent,'Safe '+code+' message.');
  assert.equal(t.document.getElementById('ccWifiSettings').hidden,code!=='permission');
  t.document.getElementById('ccWifiJoin').click();assert.equal(t.wifiJoins[1].params.profileId,42,code+' keeps the saved profile for retry');
}
t=setup();openWifiRow(t,{...securedWifi,profileId:42});t.document.getElementById('ccWifiJoin').click();
t.wifiReply(t.wifiJoins[0],{returnValue:false,failureCode:'authentication',errorText:'Password not accepted.'});
assert(t.document.getElementById('ccWifiPassword'),'Authentication failure allows a fresh personal password');

// Legacy snapshots do not supply scan keys. Joining one must update only the
// matching fallback identity rather than marking every keyless row connected.
t=setup();const legacySnapshot=t.document.createElement('script');legacySnapshot.id='wifiSnapshot';
legacySnapshot.textContent=JSON.stringify({networks:[
  {name:'Legacy one',ssid:'legacy-one',securityType:'none',connected:true},
  {name:'Legacy two',ssid:'legacy-two',securityType:'none',connected:false}
]});t.body.appendChild(legacySnapshot);t.key(38);t.tiles()[1].click();t.actions()[1].click();
t.document.getElementById('ccWifiJoin').click();t.wifiReply(t.wifiJoins[0],{returnValue:true});
assert.deepEqual(t.actions().map(button=>button.textContent),['Legacy two✓','Legacy one','Open LG Wi-Fi Settings']);

t=setup();openWifiRow(t,{ssid:'Open network',availableSecurityTypes:['none']});
assert(!t.document.getElementById('ccWifiPassword'));assert.equal(t.wifiJoins.length,0,'Open networks also require confirmation');
t.document.getElementById('ccWifiJoin').click();assert.deepEqual(t.wifiJoins[0].params,{ssid:'Open network',securityType:'none'});

// Unsupported and hidden networks use LG's precise Wi-Fi-list route rather
// than guessing security types or submitting an invented hidden-network SSID.
for(const network of [{ssid:'Enterprise',availableSecurityTypes:['ieee8021x']},{displayName:'Hidden network',availableSecurityTypes:['psk']},{ssid:'Unknown security'}]){
  t=setup();openWifiRow(t,network);assert(!t.document.getElementById('ccWifiPassword'));assert(t.document.getElementById('ccWifiJoin').disabled);
  assert.equal(t.wifiJoins.length,0);t.document.getElementById('ccWifiSettings').click();
  assert.deepEqual(t.requests.find(request=>request.uri==='launch:com.palm.app.settings').params,{target:'WifiConnection'});
}
t=setup();t.key(38);t.tiles()[1].click();wifiRequest=t.pending('/findnetworks')[0];t.emit(wifiRequest,wifiChunk(wifiData([wifiHome])));t.actions()[0].click();
assert(!t.document.getElementById('ccWifiPrompt'));assert.equal(t.wifiProfiles.length,0);assert.equal(t.wifiJoins.length,0,'Connected row is inert');

// Missing profile information does not pretend a known network is new. Closing
// at either lookup or connection stage drops owned work and all entered text.
t=setup([],false,{profileResult:{returnValue:false}});openWifiRow(t,securedWifi);
assert(!t.document.getElementById('ccWifiPassword'));assert(t.document.getElementById('ccWifiJoin').disabled);assert(!t.document.getElementById('ccWifiSettings').hidden);
t=setup([],false,{deferProfiles:true});openWifiRow(t,securedWifi);t.key(27);
assert(t.wifiProfiles[0].cancelled);t.wifiReply(t.wifiProfiles[0],{returnValue:true,profiles:[]});assert(!t.document.getElementById('ccWifiPrompt'));
for(const pendingJoin of [false,true])for(const end of ['back','cancel','close','visibilitychange','pagehide','suspend']){
  t=setup();openWifiRow(t,securedWifi);password=t.document.getElementById('ccWifiPassword');password.value='clear me';
  if(pendingJoin)t.document.getElementById('ccWifiJoin').click();const join=t.wifiJoins[0];
  if(end==='back')t.key(461);else if(end==='cancel')t.document.getElementById('ccWifiCancel').click();else if(end==='close')t.window.closeControlCentre();
  else if(end==='suspend')t.window.suspendControlCentre();else t.lifecycle(end,true);
  if(join)assert(join.cancelled,end+' cancels the owned join');assert.equal(password.value,'',end+' clears input');assert(!t.document.getElementById('ccWifiPrompt'));
  if(join)t.wifiReply(join,{returnValue:false,errorText:'Late failure'});assert(!t.document.getElementById('ccWifiPrompt'));assert.equal(t.toasts.length,0);
}

// Wallpaper is its own overlay but returns to the same Control Centre level.
t = setup(); t.key(38); t.tiles()[7].click();
assert(!t.panelState.controlCentre); assert(t.panelState.wallpaper);
t.returnFromWallpaper(); assert(t.panelState.controlCentre); assert(t.detail.hidden);
assert(t.tiles()[7].classList.contains('selected')); t.key(461); assert(!t.panelState.controlCentre);

// Hidden apps keeps its existing position in the nine-control grid,
// and remains reachable even before the first app has been hidden.
t = setup(); t.key(38);
assert.equal(t.tiles().length, 9, 'VPN replaces Sleep Timer without adding a row');
assert.equal(t.tiles()[4].querySelector('strong').textContent, 'VPN');
assert(!t.tiles().some(tile => /Sleep Timer/.test(tile.attributes['aria-label'])));
assert.equal(t.tiles()[5].attributes['aria-label'], 'Hidden apps');
assert(t.tiles()[5].classList.contains('round')); assert(!t.tiles()[5].hidden);
assert(!t.tiles().some(tile => /GeForce/.test(tile.attributes['aria-label'])));
assert(!t.document.getElementById('ccTiles').classList.contains('hasHiddenApps'));
t.key(40); t.key(40);
assert(t.tiles()[5].classList.contains('selected'), 'Hidden apps remains directly below Sound');
t.key(40);assert(t.tiles()[5].classList.contains('selected'), 'Down stops on the bottom round shortcut');

// From each visual grid position, all four directions remain within the
// original layout, with VPN in the former Sleep Timer slot.
const destinations = {
  37: [0, 0, 0, 3, 3, 5, 5, 6, 7],
  39: [1, 1, 2, 4, 4, 6, 7, 8, 8],
  38: [0, 1, 1, 0, 2, 3, 3, 4, 4],
  40: [3, 2, 4, 5, 7, 5, 6, 7, 8]
};
for (const [key, targets] of Object.entries(destinations)) {
  t.tiles().forEach((tile, index) => {
    tile.listeners.mouseenter.forEach(fn => fn());
    t.key(Number(key));
    assert(t.tiles()[targets[index]].classList.contains('selected'), 'Grid direction ' + key + ' from ' + index);
    assert.equal(t.tiles().filter(button => button.classList.contains('selected')).length, 1);
  });
}

function assertEmptyHiddenMenu(view) {
  assert(view.panelState.controlCentre); assert(!view.detail.hidden);
  assert(view.detail.classList.contains('ccHiddenApps'));
  assert.equal(view.actions().length, 1);
  const empty = view.actions()[0];
  assert.equal(empty.textContent, 'No apps hidden');
  assert(empty.disabled || empty.attributes['aria-disabled'] === 'true', 'Empty state is disabled for pointer and remote input');
  const toasts = view.toasts.length, requestCount = view.requests.length;
  view.key(13); view.key(13, true); empty.click();
  assert(!view.detail.hidden, 'Empty state activation cannot leave the submenu');
  assert.equal(view.actions()[0], empty, 'Empty state activation is a no-op');
  assert.equal(view.toasts.length, toasts); assert.equal(view.requests.length, requestCount);
}
t.window.openHiddenApps(); assertEmptyHiddenMenu(t);
t.key(461); assert(t.detail.hidden); assert(t.tiles()[5].classList.contains('selected'));
t.key(461); assert(!t.panelState.controlCentre);

const hidden = [{id: 'netflix', title: 'Netflix', icon: 'netflix.png'}, {id: 'apple', title: 'Apple TV', icon: 'apple.png'}];
t = setup(hidden); t.window.openHiddenApps();
assert(!t.tiles()[5].hidden); assert.equal(t.tiles().length, 9);
assert(t.detail.classList.contains('ccHiddenApps')); assert.equal(t.actions().length, 2);
t.key(461); assert(t.detail.hidden); assert(t.tiles()[5].classList.contains('selected'));
t.key(13); t.key(13); // return to hidden apps, then restore the first app
assert.equal(t.actions().length, 1); assert(t.actions()[0].textContent.includes('Apple TV'));
t.key(13); // restoring the last app leaves the user in the now-empty submenu
assertEmptyHiddenMenu(t); assert(!t.tiles()[5].hidden);
assert.equal(t.toasts.length, 2, 'Each restoration has one confirmation');
t.key(461); assert(t.detail.hidden); assert(t.panelState.controlCentre);
assert(t.tiles()[5].classList.contains('selected'), 'Back returns to the Hidden apps shortcut');
t.key(461); assert(!t.panelState.controlCentre);

// No tile exists after hiding everything, but Up must still open Control Centre.
t = setup(hidden); const focusedTile = t.document.getElementById('focusedApp'); focusedTile.parentNode.removeChild(focusedTile);
t.key(38); assert(t.panelState.controlCentre); assert(!t.tiles()[5].hidden);
// VPN status is read only. Empty presets cannot connect; the compact submenu
// contains only Off and three presets that connect directly.
const vpnStatus=(extra={})=>Object.assign({ok:true,selected:'lisbon',active:null,tunnel:false,connected:false,autostart:false,profiles:[{id:'lisbon',name:'Portugal',configured:false},{id:'uk',name:'United Kingdom',configured:false},{id:'us',name:'United States',configured:false}]},extra);
const configured=[{id:'lisbon',name:'Portugal',configured:true},{id:'uk',name:'United Kingdom',configured:true},{id:'us',name:'United States',configured:true}];
t=setup();assert.equal(t.requests.length,1,'Visible Home reads VPN status for the clock badge');
assert.equal(t.requests[0].uri,'vpn:status','Initial status never changes networking');
assert(t.document.getElementById('ccVpnBadge').hidden);
t.key(38);assert.equal(t.pending('vpn:status').length,1);
t.reply('vpn:status',vpnStatus());t.tiles()[4].click();
assert.equal(t.tiles()[4].querySelector('small').textContent,'Off');
assert(t.tiles()[4].querySelector('.ccVpnGlyph').classList.contains('sfSymbol'));
assert.equal(t.tiles()[4].querySelector('.ccVpnGlyph').style.webkitMaskImage,'url(ui-icons/shield.svg)');
assert.deepEqual(t.actions().map(b=>b.textContent),['Off✓','Portugal','United Kingdom','United States']);
assert(t.actions().slice(1).every(b=>b.disabled));
t.key(13);t.key(13,true);assert.equal(t.pending('vpn:connect').length,0);
assert.equal(t.pending('vpn:disconnect').length,0,'Off is a no-op when the VPN is already off');
assert.equal(t.requests.filter(r=>r.uri.startsWith('launch:')).length,0);

// Choosing a configured preset connects it directly. Switching while
// connected and turning off each require one explicit action.
t=setup();t.key(38);t.reply('vpn:status',vpnStatus({profiles:configured}));t.tiles()[4].click();
t.key(40);t.key(40);t.key(13);t.key(13);
assert.equal(t.pending('vpn:select').length,0);assert.equal(t.pending('vpn:connect').length,1);
assert(t.actions().every(b=>b.disabled),'All VPN controls are disabled during a change');
assert.equal(t.pending('vpn:connect').length,1);assert(t.pending('vpn:connect')[0].params.command.endsWith("'uk'"));
t.reply('vpn:connect',vpnStatus({selected:'uk',active:'uk',tunnel:true,profiles:configured}));
assert.equal(t.tiles()[4].querySelector('small').textContent,'United Kingdom','The subtitle is only the active location');
assert(t.document.getElementById('ccVpnBadge').hidden,'Tunnel creation alone cannot show a connected badge');
t.advance(1000);t.reply('vpn:status',vpnStatus({selected:'uk',active:'uk',tunnel:true,connected:true,profiles:configured}));
assert.equal(t.tiles()[4].querySelector('small').textContent,'United Kingdom');
assert.equal(t.tiles()[4].attributes['aria-label'],'VPN, Connected · United Kingdom');
assert(t.tiles()[4].classList.contains('vpnConnected'));
assert(!t.document.getElementById('ccVpnBadge').hidden);
t.key(38);t.key(13);assert(t.pending('vpn:connect')[0].params.command.endsWith("'lisbon'"),'Active preset change reconnects only after selection');
t.reply('vpn:connect',vpnStatus({selected:'lisbon',active:'lisbon',tunnel:true,connected:true,profiles:configured}));
t.key(38);t.key(13);assert.equal(t.pending('vpn:disconnect').length,1);
t.reply('vpn:disconnect',vpnStatus({profiles:configured}));assert.equal(t.tiles()[4].querySelector('small').textContent,'Off');
assert(t.document.getElementById('ccVpnBadge').hidden);

// The clock badge uses read-only, non-overlapping polling on visible Home,
// including with Control Centre closed. A stale handshake or error hides it.
t=setup();t.reply('vpn:status',vpnStatus({active:'lisbon',tunnel:true,connected:true,profiles:configured}));
const badge=t.document.getElementById('ccVpnBadge'),clock=t.document.getElementById('timeRow');
assert(!badge.hidden);assert.equal(badge.textContent,'VPN');
assert.equal(clock.children[clock.children.indexOf(badge)+1].id,'clock','Badge sits immediately before the clock');
let reads=t.requests.length;t.advance(14999);assert.equal(t.requests.length,reads);t.advance(1);assert.equal(t.pending('vpn:status').length,1);
t.reply('vpn:status',vpnStatus({active:'lisbon',tunnel:true,connected:false,profiles:configured}));
assert(badge.hidden,'Expired handshake hides badge even while panel is closed');
assert.equal(t.tiles()[4].querySelector('small').textContent,'Portugal');
t.advance(15000);t.reply('vpn:status',vpnStatus({active:'lisbon',tunnel:true,connected:true,profiles:configured}));assert(!badge.hidden);
t.advance(15000);t.reply('vpn:status',{ok:false});assert(badge.hidden,'Status error cannot preserve a connected badge');
assert(!t.panelState.controlCentre);assert(t.requests.every(r=>r.uri==='vpn:status'));

// Late reads cannot update the hidden page or overwrite fresh state after
// returning. Closing the panel preserves Home polling; hiding Home stops it.
t=setup();t.key(38);const oldVpnRead=t.pending('vpn:status')[0];t.key(461);
t.lifecycle('visibilitychange',true);const hiddenReadCount=t.requests.length;t.advance(30000);assert.equal(t.requests.length,hiddenReadCount);
t.lifecycle('visibilitychange',false);const freshVpnRead=t.pending('vpn:status').find(r=>r!==oldVpnRead);
t.respond(freshVpnRead,vpnStatus({profiles:configured}));
t.respond(oldVpnRead,vpnStatus({active:'us',tunnel:true,connected:true,profiles:configured}));
assert.equal(t.tiles()[4].querySelector('small').textContent,'Off');
assert(t.document.getElementById('ccVpnBadge').hidden);
t.key(38);t.reply('vpn:status',vpnStatus({profiles:configured}));t.tiles()[4].click();t.key(40);t.key(13);const connecting=t.pending('vpn:connect')[0];t.lifecycle('visibilitychange',true);
const hiddenCount=t.requests.length;t.respond(connecting,vpnStatus({active:'lisbon',tunnel:true,connected:true,profiles:configured}));t.advance(60000);
assert.equal(t.requests.length,hiddenCount);assert(!t.panelState.controlCentre);assert(!t.body.classList.contains('ccOpen'));
t.lifecycle('visibilitychange',false);assert.equal(t.requests.length,hiddenCount+1,'Returning Home reads status for the clock badge');
t.key(38);assert.equal(t.pending('vpn:status').length,1);
t.lifecycle('pagehide');t.reply('vpn:status',vpnStatus());const pagehideCount=t.requests.length;t.advance(10000);assert.equal(t.requests.length,pagehideCount);
t.lifecycle('pageshow');assert.equal(t.pending('vpn:status').length,1,'A cached page resumes status monitoring on pageshow');
t=setup([],true);assert.equal(t.requests.length,0,'A hidden preloaded Home does not poll');t.advance(60000);assert.equal(t.requests.length,0);
t.lifecycle('visibilitychange',false);assert.equal(t.pending('vpn:status').length,1);

// A user change may finish after the panel closes: only its visible Home badge
// updates; a departed detail view and panel stay closed.
t=setup();t.reply('vpn:status',vpnStatus({profiles:configured}));t.key(38);t.tiles()[4].click();t.key(40);t.key(13);
const closedChange=t.pending('vpn:connect')[0];t.key(461);t.key(461);
t.respond(closedChange,vpnStatus({active:'lisbon',tunnel:true,connected:true,profiles:configured}));
assert(!t.document.getElementById('ccVpnBadge').hidden);assert(!t.panelState.controlCentre);assert(t.detail.hidden);

// Missing helper, transport errors and timeouts stay unavailable; stale read
// results arriving during a user change cannot replace the pending view.
t=setup();t.key(38);t.reply('vpn:status',{ok:false});t.tiles()[4].click();
assert.equal(t.tiles()[4].querySelector('small').textContent,'Unavailable');assert(t.detail.querySelector('p').textContent.includes('WireGuard'));
assert(t.actions().slice(0,3).every(b=>b.disabled));
t.advance(5000);const overlapping=t.pending('vpn:status')[0];
t.respond(overlapping,vpnStatus({profiles:configured}));t.advance(5000);const olderRead=t.pending('vpn:status')[0];
t.key(40);t.key(13);const explicitConnect=t.pending('vpn:connect')[0];assert(explicitConnect);
t.respond(olderRead,vpnStatus({profiles:configured}));assert.equal(t.tiles()[4].querySelector('small').textContent,'Off');assert.equal(t.tiles()[4].attributes['aria-label'],'VPN, Updating…');
t.respond(explicitConnect,{ok:false});assert(t.detail.classList.contains('hasError'));assert.equal(t.tiles()[4].querySelector('small').textContent,'Unavailable');
console.log('Control Centre interaction, Screen Off recovery, navigation, hidden apps and VPN status/presets, lifecycle, read/write races and explicit actions passed.');
