// Exercise the standalone window with the real shared controls and delayed Luna replies.
const assert = require('assert'), fs = require('fs'), vm = require('vm');

class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.parentNode = null; this.style = {};
    this.className = ''; this.attributes = {}; this.listeners = {}; this._text = '';
    this.scrollHeight = 300; this.clientHeight = 300; this.scrollTop = 0; this.offsetTop = 0; this.offsetHeight = 70;
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: name => { if (!this.classList.contains(name)) this.className += ' ' + name; },
      remove: name => { this.className = this.className.split(/\s+/).filter(item => item !== name).join(' '); },
      toggle: (name, on) => on ? this.classList.add(name) : this.classList.remove(name)
    };
  }
  set textContent(value) { this._text = String(value); this.children.forEach(child => { child.parentNode = null; }); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(value) { this.textContent = ''; this.html = value; }
  get firstChild() { return this.children[0] || null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  insertBefore(child, before) { if (!before) return this.appendChild(child); child.parentNode = this; this.children.splice(this.children.indexOf(before), 0, child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { (this.listeners[name] || (this.listeners[name] = [])).push(callback); }
  click() { for (const callback of this.listeners.click || []) callback({ stopPropagation() {} }); }
  querySelector(selector) { return find(this, node => selector[0] === '.' ? selector.slice(1).split('.').every(name => node.classList.contains(name)) : node.tagName === selector); }
}
function find(root, predicate) {
  for (const child of root.children) { if (predicate(child)) return child; const result = find(child, predicate); if (result) return result; }
  return null;
}
function setup({ hidden = false, preview = false, retained = false, networkFailsImmediately = false,
  launchParams = {toggle:true,overlayRequestId:'initial'} } = {}) {
  let now = new Date(2026, 10, 2, 13, 7, 15).getTime(), nextTimer = 0, closeCount = 0, readyCount = 0, deactivateCount = 0, activateCount = 0;
  const body = new Element('body'), documentEvents = {}, windowEvents = {}, requests = [], timers = new Map();
  function add(tag, id, parent = body) { const node = new Element(tag); node.id = id; parent.appendChild(node); return node; }
  const time = add('div', 'timeRow'); add('span', 'clock', time); add('span', 'ampm', time);
  const centre = add('section', 'controlCentre'); add('div', 'ccTiles', centre); add('button', 'ccClose', centre);
  const detail = add('div', 'ccDetail', centre); add('h2', '', detail); add('p', '', detail); add('button', 'ccDetailBack', detail);
  add('div', 'ccShade'); add('span', 'wifiLabel').textContent = 'Wi-Fi';
  const wall = add('section', 'wallPanel'); wall.className = 'hidden';
  for (const id of ['wallQr', 'wallTitle', 'wallScan', 'wallUrl', 'wallBack']) add('div', id, wall);
  add('div', 'toast');
  const document = { body, documentElement: {}, hidden,
    createElement: tag => new Element(tag), getElementById: id => find(body, node => node.id === id),
    querySelector: selector => body.querySelector(selector),
    addEventListener(name, callback) { (documentEvents[name] || (documentEvents[name] = [])).push(callback); } };
  const window = { close() { closeCount++; },
    addEventListener(name, callback) { (windowEvents[name] || (windowEvents[name] = [])).push(callback); } };
  if (!preview) window.PalmSystem = { launchParams: JSON.stringify(launchParams), stageReady() { readyCount++; } };
  if (retained) Object.assign(window.PalmSystem, {
    keepAlive(value) { assert.equal(typeof value, 'boolean'); },
    deactivate() { deactivateCount++; }, activate() { activateCount++; }
  });
  function Bridge() {
    this.cancel = () => { this.cancelled = true; };
    this.call = (uri, params) => {
      this.uri = uri; this.params = JSON.parse(params); this.at = now;
      this.readyWhenCalled = readyCount; this.panelOpenWhenCalled = body.classList.contains('ccOpen'); requests.push(this);
      if (networkFailsImmediately && uri.endsWith('/getStatus')) this.onservicecallback('{"returnValue":false}');
    };
  }
  function FakeDate() { return new Date(now); } FakeDate.now = () => now;
  const scope = { window, document, CONFIG: { clock24: false, language: 'vi' }, Date: FakeDate,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    setTimeout(callback, ms) { timers.set(++nextTimer, { callback, at: now + ms }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); } };
  // Any attempt to fork Home preferences immediately fails the test.
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('Overlay cannot own Home preferences'); } });
  if (!preview) scope.PalmServiceBridge = Bridge;
  vm.createContext(scope);
  for (const name of ['overlay', 'tv-controls', 'vpn-controls', 'control-centre']) vm.runInContext(fs.readFileSync('app/' + name + '.js', 'utf8'), scope);
  let nativeRequests = 0;
  scope.XMLHttpRequest = function () { nativeRequests++; throw new Error('Unexpected native request on ordinary launch'); };
  for (const match of fs.readFileSync('app/overlay.html', 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(match[1], scope);
  assert.equal(nativeRequests, 0, 'Production startup makes no native blur requests');
  assert.equal(window.NativeBlurClient, undefined, 'Floating controls do not require the removed native blur client');
  function emit(name, detail) {
    const listeners = ['pagehide', 'pageshow'].includes(name) ? windowEvents : documentEvents;
    for (const callback of listeners[name] || []) callback({ detail });
  }
  return { body, document, window, requests,
    get closes() { return closeCount; }, get ready() { return readyCount; },
    get deactivations() { return deactivateCount; }, get activations() { return activateCount; },
    get open() { return body.classList.contains('ccOpen'); },
    tiles() { return document.getElementById('ccTiles').children; },
    actions() { const box = document.getElementById('ccActions'); return box ? box.children : []; },
    query(suffix) { return requests.filter(request => request.uri.endsWith(suffix)); },
    vpnReads() { return requests.filter(request => (request.params.command || '').includes("profiles.js' 'status'")); },
    controlReads(fragment) { return requests.filter(request => (request.params.command || '').includes(fragment)); },
    reply(request, response) { assert(request && request.onservicecallback, 'Expected live request'); request.onservicecallback(JSON.stringify(response)); },
    controlReply(suffix, data) {
      const request = requests.find(item => !item.cancelled && (item.params.command || '').includes(suffix));
      assert(request, 'Expected ' + suffix); this.reply(request, { returnValue: true, stdoutString: JSON.stringify(data) });
    },
    key(keyCode, repeat = false) {
      let stopped = false;
      const event = { keyCode, repeat, preventDefault() {}, stopImmediatePropagation() { stopped = true; } };
      for (const callback of windowEvents.keydown || []) { callback(event); if (stopped) break; }
      return stopped;
    },
    relaunch(params) { emit('webOSRelaunch', params); },
    visibility(value) { document.hidden = value; emit('visibilitychange'); },
    lifecycle: emit,
    script(fragment) { return body.children.find(node => node.tagName === 'script' && node.src.includes(fragment)); },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const item = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!item) break;
        now = item[1].at; timers.delete(item[0]); item[1].callback();
      }
      now = until;
    }
  };
}

let test = setup();
assert(test.open); assert.equal(test.ready, 1); assert.equal(test.closes, 0);
assert.equal(test.document.documentElement.lang, 'en', 'Legacy language preferences cannot change the overlay language');
assert.equal(test.document.getElementById('clock').textContent, '1:07');
assert.equal(test.document.getElementById('ampm').textContent, 'pm');
assert.equal(test.query('/launch').length, 0, 'Opening controls cannot launch Home or disturb playback');
assert.equal(test.requests.length, 0, 'The panel and native stage are ready before any background status requests');
assert.equal(test.window.LauncherControls.statusPolicy.initialDelay, 250);
assert.equal(test.window.LauncherControls.statusPolicy.vpnPollInterval, 30000);
assert.equal(test.window.LauncherControls.statusPolicy.vpnDetailPollInterval, 10000);
test.relaunch({ toggle: true, overlayRequestId: 'initial' }); test.advance(0);
assert(test.open); assert.equal(test.closes, 0, 'Duplicate first-launch event cannot instantly close');
test.advance(249); assert.equal(test.requests.length, 0, 'Initial status work waits for the complete opening delay');
test.advance(1);
assert.equal(test.query('/getStatus').length, 1, 'One network subscription starts after opening');
assert.equal(test.vpnReads().length, 1, 'One initial VPN status read starts after opening');
assert.equal(test.controlReads('/getSoundOutput').length, 1, 'One initial sound-output read starts after opening');
assert(test.requests.every(request => request.readyWhenCalled === 1 && request.panelOpenWhenCalled), 'All initial reads begin after stageReady and panel visibility');
test.relaunch({ toggle: true, overlayRequestId: 'second' }); test.advance(0);
assert(!test.open); assert.equal(test.closes, 1, 'Second Settings press dismisses the native surface');
test.relaunch({ toggle: true, overlayRequestId: 'second' }); test.advance(0);
assert.equal(test.closes, 1, 'Duplicate relaunch tokens cannot reopen a dismissed surface');
test.relaunch({ toggle: true, overlayRequestId: 'third' }); assert(test.open);

for (const reason of ['back', 'toggle', 'visibilitychange', 'pagehide']) {
  test = setup(); test.advance(100);
  if (reason === 'back') test.key(461);
  else if (reason === 'toggle') test.relaunch({ toggle:true, overlayRequestId:'close-before-status' });
  else if (reason === 'visibilitychange') test.visibility(true);
  else test.lifecycle('pagehide');
  test.advance(60000);
  assert.equal(test.closes, 1, reason + ' dismisses an early popup');
  assert.equal(test.requests.length, 0, reason + ' cancels all delayed startup and background status work: ' + test.requests.map(request => request.params.command || request.uri).join(', '));
}

// Explicit controls remain responsive during the quiet opening interval.
test = setup(); test.advance(100); test.tiles()[3].click();
for (const endpoint of ['/getSoundOutput', '/getSystemSettingValues', '/getAllInputStatus'])
  assert.equal(test.controlReads(endpoint).length, 1, 'Early Sound selection immediately requests ' + endpoint);
assert.equal(test.vpnReads().length, 0); assert.equal(test.query('/getStatus').length, 0);
test.advance(150);
assert.equal(test.controlReads('/getSoundOutput').length, 1, 'Delayed startup cannot duplicate an in-flight explicit Sound read');

test = setup(); test.tiles()[4].click();
assert.equal(test.vpnReads().length, 1, 'Entering VPN before the delay immediately reads its state');
test.tiles()[4].click(); test.advance(250);
assert.equal(test.vpnReads().length, 1, 'Repeated VPN entry and delayed startup share the in-flight read');

for (const back of [8, 27, 461]) {
  test = setup(); test.tiles()[3].click(); assert(!test.document.getElementById('ccDetail').hidden);
  test.key(back); test.advance(0); assert(test.open); assert.equal(test.closes, 0, 'Back from a submenu keeps current app covered');
  test.key(back, true); test.advance(0); assert.equal(test.closes, 0, 'Held Back cannot skip a level');
  test.key(back); test.advance(0); assert(!test.open); assert.equal(test.closes, 1);
  assert.equal(test.query('/launch').length, 0, 'Dismissal must not launch Home');
}

// The shared controller closes its panel before calling launch. Native teardown
// must wait for the applicationManager reply, otherwise the launch can be lost.
for (const outcome of ['success', 'failure', 'timeout']) {
  test = setup(); test.tiles()[8].click();
  const request = test.query('/launch')[0]; assert(request); assert.equal(request.params.id, 'com.palm.app.settings');
  assert.equal(test.vpnReads().length, 0); assert.equal(test.query('/getStatus').length, 0, 'An immediate external action is not held behind status loading');
  test.advance(0); assert.equal(test.closes, 0, 'Launch must be sent before native dismissal');
  test.advance(2000); assert.equal(test.closes, 0, 'Keep the bridge alive until acknowledgment');
  if (outcome === 'timeout') test.advance(4500);
  else test.reply(request, { returnValue: outcome === 'success' });
  assert.equal(test.closes, outcome === 'success' ? 1 : 0);
  assert.equal(test.open, outcome !== 'success', 'Rejected/timed-out launches restore controls');
}

test = setup(); test.tiles()[6].click();
test.controlReply('/getAllInputStatus', { returnValue: true, devices: [{ id: 'HDMI_1', label: 'HDMI 1', appId: 'com.webos.app.hdmi1' }] });
test.actions()[0].click(); test.advance(0); assert.equal(test.closes, 0);
assert.equal(test.query('/launch')[0].params.id, 'com.webos.app.hdmi1');
test.reply(test.query('/launch')[0], { returnValue: true }); assert.equal(test.closes, 1);

// VPN changes can legitimately outlast normal TV reads. The bridge must not
// discard their callback before VPNControls' own 45-second write deadline.
test = setup(); test.advance(250);
const vpnState = { ok: true, tunnel: false, connected: false, profiles: [{ id: 'lisbon', configured: true }] };
test.controlReply("profiles.js' 'status'", vpnState);
test.tiles()[4].click(); test.actions()[1].click();
const vpnWrite = test.requests.find(request => (request.params.command || '').includes("profiles.js' 'connect' 'lisbon'"));
assert(vpnWrite); assert(test.window.VPNControls.pending());
test.advance(20000);
assert(!vpnWrite.cancelled, 'VPN callback must survive a 20-second connection attempt');
test.reply(vpnWrite, { returnValue: true, stdoutString: JSON.stringify({ ...vpnState, active: 'lisbon', tunnel: true, connected: true }) });
assert(!test.window.VPNControls.pending(), 'Delayed success completes the VPN write');
assert.equal(test.tiles()[4].querySelector('small').textContent, 'Portugal');
assert(!test.document.getElementById('ccVpnBadge').hidden, 'Delayed confirmed connection updates the visible state');
assert(vpnWrite.cancelled, 'Completed VPN write releases its retained bridge');
const readsBeforeConfirmation = test.vpnReads().length;
test.advance(999); assert.equal(test.vpnReads().length, readsBeforeConfirmation, 'A successful VPN write waits one second before its fresh confirmation');
test.advance(1); assert.equal(test.vpnReads().length, readsBeforeConfirmation + 1, 'Explicit VPN changes retain prompt fresh confirmation');

// Passive polling is measured from the response, so a slow helper cannot make
// reads overlap or shorten the promised quiet interval.
test = setup(); test.advance(250); test.advance(2000);
test.controlReply("profiles.js' 'status'", vpnState);
test.advance(29999); assert.equal(test.vpnReads().length, 1, 'Main panel waits 30 seconds after the previous response');
test.advance(1); assert.equal(test.vpnReads().length, 2, 'Main panel performs one status read at 30 seconds');
test.advance(1000); assert.equal(test.vpnReads().length, 2, 'An in-flight passive read never overlaps another read');

test = setup(); test.advance(250); test.controlReply("profiles.js' 'status'", vpnState);
test.tiles()[4].click(); assert.equal(test.vpnReads().length, 2, 'Explicit VPN entry refreshes immediately even after a recent response');
test.tiles()[4].click(); assert.equal(test.vpnReads().length, 2, 'An explicit refresh is still deduplicated while in flight');
test.advance(2000); test.controlReply("profiles.js' 'status'", vpnState);
test.advance(9999); assert.equal(test.vpnReads().length, 2, 'VPN detail waits ten seconds after its response');
test.advance(1); assert.equal(test.vpnReads().length, 3, 'VPN detail polls at ten seconds');
test.controlReply("profiles.js' 'status'", vpnState);
test.key(461); assert(test.open); assert.equal(test.vpnReads().length, 3, 'Back to root cannot immediately repeat a fresh status read');
test.advance(29999); assert.equal(test.vpnReads().length, 3, 'Returning to root cancels the faster detail cadence');
test.advance(1); assert.equal(test.vpnReads().length, 4, 'Root resumes the 30-second cadence from the last response');

test = setup(); test.advance(250);
test.controlReply("profiles.js' 'status'", { ...vpnState, active:'lisbon', tunnel:true, connected:false });
test.advance(4999); assert.equal(test.vpnReads().length, 1);
test.advance(1); assert.equal(test.vpnReads().length, 2, 'A connecting tunnel retains the five-second progress check');

test = setup(); test.tiles()[5].click();
assert.equal(test.actions()[0].textContent, 'Go to Home to manage hidden apps');
assert.equal(test.query('/launch').length, 0, 'Viewing the hidden-app explanation cannot switch Home');
assert(!test.requests.some(request => (request.params.command || '').includes('golauncher')));
test.actions()[0].click(); test.advance(0); assert.equal(test.closes, 0);
const home = test.requests.find(request => request.params.command === '/home/root/lg-tv-vibehack/golauncher.sh');
assert(home, 'Explicit Home action uses the installed Home identity selector');
test.reply(home, { returnValue: true, exitCode: 0 }); assert.equal(test.closes, 1);

test = setup(); test.tiles()[7].click(); test.advance(0);
assert(test.body.classList.contains('wallOpen')); assert.equal(test.closes, 0);
const wallScript = test.script('wall.js'); assert(wallScript.src.startsWith('file:///media/developer/apps/usr/palm/applications/com.gathin.tvhome/'));
test.window.WALL_URL = 'http://192.0.2.1:3000/';
test.window.qrcode = () => ({ addData() {}, make() {}, createDataURL() { return 'data:image/gif;base64,dGVzdA=='; } });
wallScript.onload(); assert(test.document.getElementById('wallQr').html.includes('data:image/gif'));
test.key(461); test.advance(0); assert(test.open); assert.equal(test.closes, 0);
test.tiles()[7].click(); test.document.getElementById('timeRow').click(); test.advance(0);
assert(test.open); assert(!test.body.classList.contains('wallOpen'), 'Clock returns to controls without leaving wallpaper above them');

for (const lifecycle of ['visibilitychange', 'pagehide']) {
  test = setup(); test.advance(250);
  const network = test.query('/getStatus')[0], stale = network.onservicecallback;
  if (lifecycle === 'visibilitychange') test.visibility(true); else test.lifecycle('pagehide');
  assert.equal(test.closes, 1); assert(network.cancelled, 'Leaving releases the network subscription');
  stale('{"returnValue":true,"wifi":{"state":"connected","ssid":"Stale"}}');
  assert.equal(test.document.getElementById('wifiLabel').textContent, 'Wi-Fi');
  test.visibility(false); test.lifecycle('pageshow'); test.advance(0);
  assert(!test.open); assert.equal(test.closes, 1, 'A later visibility/pageshow event must not resurrect a closed popup');
}

test = setup({ hidden: true }); assert(!test.open); assert.equal(test.closes, 0); assert.equal(test.ready, 1);
assert.equal(test.requests.length, 0, 'Initial hidden preload does not start polling');
test.advance(60000); assert.equal(test.requests.length, 0, 'A hidden preload remains quiet indefinitely');
test.visibility(false); assert(test.open); assert.equal(test.closes, 0);
test.advance(249); assert.equal(test.requests.length, 0, 'A revealed preload also waits for its opening frame');
test.advance(1); assert.equal(test.vpnReads().length, 1); assert.equal(test.query('/getStatus').length, 1);

test = setup({ preview: true }); assert(test.open); test.tiles()[8].click(); test.advance(0);
assert(test.open); assert.equal(test.requests.length, 0); assert.equal(test.closes, 0, 'Desktop preview cannot navigate or close a native app');

for (const reason of ['back', 'toggle', 'visibilitychange', 'pagehide']) {
  test = setup({retained:true}); test.advance(250);
  const oldNetwork = test.query('/getStatus')[0];
  if (reason === 'back') test.key(461);
  else if (reason === 'toggle') test.relaunch({toggle:true,overlayRequestId:'park'});
  else if (reason === 'visibilitychange') test.visibility(true);
  else test.lifecycle('pagehide');
  test.advance(0);
  assert(!test.open); assert.equal(test.closes,0,'Retained dismissal does not destroy the page');
  assert.equal(test.deactivations,reason === 'visibilitychange'?0:1,'A visible surface releases native focus once');
  assert(oldNetwork.cancelled,'Retained dismissal releases its network subscription');
  const count = test.requests.length;
  test.advance(500); assert.equal(test.requests.length,count,'No polls start while waiting for native hiding');
  test.visibility(true); test.advance(300000);
  assert.equal(test.requests.length,count,'Hidden overlay starts no passive requests');
  assert(!test.key(38),'Hidden overlay cannot reopen from a stray Up key');
  test.relaunch({toggle:true,overlayRequestId:'reopen'});
  assert.equal(test.activations,1,'Hidden Settings requests native activation');
  assert(!test.open,'Controls wait for native visibility');
  test.visibility(false); assert(test.open); assert.equal(test.ready,1,'Reopening reuses the existing page');
  test.relaunch({toggle:true,overlayRequestId:'reopen'}); test.advance(0); assert(test.open,'Duplicate reopen token is ignored');
  test.advance(250);
  assert.equal(test.query('/getStatus').length,2,'Reopening creates exactly one network subscription');
  assert.equal(test.vpnReads().length,2,'Reopening refreshes stale VPN state');
  test.key(461);test.advance(0);test.visibility(true);
  const beforeSpuriousVisible = test.deactivations;
  test.visibility(false);test.lifecycle('pageshow');test.advance(250);
  assert(!test.open,'Visibility or pageshow alone cannot reopen a dismissed panel');
  assert.equal(test.deactivations,beforeSpuriousVisible+1,'Unrequested foregrounding releases focus again');
}

test = setup({retained:true});test.key(461);test.advance(0);test.visibility(true);
test.visibility(false);test.advance(50);
assert(!test.open,'Early visibility does not expose dormant controls');
test.relaunch({toggle:true,overlayRequestId:'visibility-before-relaunch'});test.advance(300);
assert(test.open);assert.equal(test.deactivations,1,'Relaunch following native visibility cancels re-hiding');
assert(!test.body.classList.contains('overlayDormant'));

test = setup({retained:true});test.advance(250);test.controlReply("profiles.js' 'status'",vpnState);
test.tiles()[4].click();test.actions()[1].click();
const retainedWrite = test.requests.find(request => (request.params.command || '').includes("profiles.js' 'connect' 'lisbon'"));
test.relaunch({toggle:true,overlayRequestId:'hide-during-write'});test.advance(0);test.visibility(true);
assert(test.window.VPNControls.pending());assert(!retainedWrite.cancelled,'An explicit in-flight VPN action can finish while hidden');
const beforeWriteReply = test.requests.length;
test.reply(retainedWrite,{returnValue:true,stdoutString:JSON.stringify({...vpnState,active:'lisbon',tunnel:true,connected:true})});
assert(!test.window.VPNControls.pending(),'Hidden completion releases the pending-action lock');
test.advance(60000);assert.equal(test.requests.length,beforeWriteReply,'Hidden action completion cannot restart polling');
test.relaunch({toggle:true,overlayRequestId:'after-write'});test.visibility(false);test.advance(250);
assert.equal(test.vpnReads().length,3,'Reopening verifies the completed operation with a fresh read');

test = setup({retained:true});
test.window.PalmSystem.deactivate=function(){throw Error('Native deactivation unavailable');};
test.key(461);test.advance(0);assert.equal(test.closes,1,'Native lifecycle errors fall back to ordinary close');

test = setup({retained:true});test.key(461);test.advance(999);assert.equal(test.closes,0);
test.advance(1);assert.equal(test.closes,1,'A failed native hide cannot retain invisible remote focus');

// A failed subscription is released and retries remain bounded to visible time.
test = setup({retained:true}); test.advance(250);
for (const delay of [1000,2000,4000,8000,16000,30000,30000]) {
  const requests = test.query('/getStatus'), request = requests[requests.length - 1];
  const stale = request.onservicecallback;
  test.reply(request,{returnValue:false,errorText:'Service unavailable'});
  assert(request.cancelled && request.onservicecallback === null,'Failed subscription releases its bridge');
  assert.equal(test.document.getElementById('wifiLabel').textContent,'Unavailable');
  stale(JSON.stringify({returnValue:true,wifi:{state:'connected',ssid:'Stale network'}}));
  assert.equal(test.document.getElementById('wifiLabel').textContent,'Unavailable','A departed subscription cannot overwrite the new state');
  test.advance(delay - 1); assert.equal(test.query('/getStatus').length,requests.length);
  test.advance(1); assert.equal(test.query('/getStatus').length,requests.length + 1,'Network retries use capped exponential backoff');
}
let networkRequests = test.query('/getStatus');
let network = networkRequests[networkRequests.length - 1];
test.reply(network,{returnValue:true,wifi:{state:'connected',ssid:'Recovered network'}});
assert.equal(test.document.getElementById('wifiLabel').textContent,'Recovered network');
test.reply(network,{returnValue:false}); test.advance(1000);
assert.equal(test.query('/getStatus').length,networkRequests.length + 1,'A successful update resets the retry delay');
networkRequests = test.query('/getStatus'); network = networkRequests[networkRequests.length - 1];
test.reply(network,{returnValue:false}); test.visibility(true); test.advance(60000);
assert.equal(test.query('/getStatus').length,networkRequests.length,'Hiding cancels pending network recovery');
test = setup({networkFailsImmediately:true}); test.advance(250);
network = test.query('/getStatus')[0]; assert(network.cancelled,'A synchronous transport failure also releases its handle');
test.advance(1000); assert.equal(test.query('/getStatus').length,2);
test.key(461); test.advance(60000); assert.equal(test.query('/getStatus').length,2,'Dismissal cancels synchronous-failure retries');

// A cancelled asynchronous native launch owns only the accepted page token.
// Cancellation cannot reopen dormant pages or dismiss a newer/plain launch.
const ownedToken = 'a'.repeat(64), newerToken = 'b'.repeat(64);
const nativeLaunch = token => ({controlCentre:true,nativeBlur:{token,port:48740}});
for (const params of [nativeLaunch(ownedToken), {controlCentre:true,nativeBlurFallbackToken:ownedToken},
  {controlCentre:true,nativeBlur:{token:newerToken,port:80},nativeBlurFallbackToken:ownedToken}]) {
  test = setup({retained:true,launchParams:{...params,overlayRequestId:'owned'}});
  assert(test.open);
  for (const token of [newerToken, null, '', 'malformed', {}, 1]) {
    test.relaunch({nativeBlurCancelToken:token,toggle:true,overlayRequestId:'owned'});
    assert(test.open); assert.equal(test.deactivations,0,'Mismatched cancellation cannot toggle the owned page');
  }
  test.relaunch({nativeBlurCancelToken:ownedToken,overlayRequestId:'owned'});
  assert(!test.open); assert.equal(test.deactivations,1,'Matching cancellation bypasses ordinary request deduplication');
  test.relaunch({nativeBlurCancelToken:ownedToken}); test.relaunch({nativeBlurCancelToken:newerToken});
  assert(!test.open); assert.equal(test.deactivations,1,'Repeated/stale cancellation cannot reopen a dormant page');
}
test = setup({retained:true,launchParams:{...nativeLaunch(ownedToken),nativeBlurFallbackToken:newerToken}});
test.relaunch({nativeBlurCancelToken:newerToken}); assert(test.open,'Valid native ownership takes precedence over fallback metadata');
test.relaunch({...nativeLaunch(newerToken),overlayRequestId:'newer'});
test.relaunch({nativeBlurCancelToken:ownedToken}); assert(test.open); assert.equal(test.deactivations,0);
test.relaunch({controlCentre:true,overlayRequestId:'plain'});
test.relaunch({nativeBlurCancelToken:newerToken}); assert(test.open); assert.equal(test.deactivations,0,'Ordinary launch clears previous native ownership');
test.relaunch({controlCentre:true,nativeBlurFallbackToken:ownedToken,overlayRequestId:'fallback'});
test.relaunch({nativeBlurCancelToken:ownedToken}); assert(!test.open); assert.equal(test.deactivations,1);
for (const retained of [true,false]) {
  test = setup({retained,launchParams:{nativeBlurCancelToken:ownedToken}});
  assert(!test.open); assert.equal(test.requests.length,0);
  assert.equal(retained ? test.deactivations : test.closes,1,'Cancellation-only cold start parks its new empty surface');
  assert.equal(test.ready,1);
}

const html = fs.readFileSync('app/overlay.html', 'utf8'), css = fs.readFileSync('app/overlay.css', 'utf8');
assert(!html.includes('src="app.js') && !html.includes('background.js') && !html.includes('app-preferences.js'));
assert(css.includes('background:transparent'), 'Native overlay has no Home background');
assert(!html.includes('id="tiles"') && !html.includes('id="stage"'), 'No Home tray is rendered');
console.log('Overlay native retention/reopen, hidden polling suspension, network recovery/backoff, startup cancellation, VPN cadence, immediate actions, lifecycle, toggle tokens, acknowledged launches, wallpaper and preference boundary passed.');
