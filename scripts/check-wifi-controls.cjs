/* Simulated LS2 only: never connects a TV or reads saved credentials. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../app/wifi-controls.js'), 'utf8');
const secret = "test '$;` password";

function fixture({ preview = false, synchronous, throws = false } = {}) {
  const calls = [], timers = new Map(); let sequence = 0, now = 0;
  const window = { LauncherControls: { luna(uri, payload, callback) {
    const call = { uri, sent: JSON.parse(JSON.stringify(payload)), retained: payload, callback, releases: 0 };
    calls.push(call);
    if (throws) throw new Error('transport echoed ' + secret);
    if (synchronous) callback(synchronous);
    return () => { call.releases++; };
  } } };
  const context = { window, setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, console: { log() { throw Error('Wi-Fi transport must not log'); } },
    localStorage: { getItem() { throw Error('No credential storage'); }, setItem() { throw Error('No credential storage'); } } };
  if (!preview) context.PalmServiceBridge = function () {};
  vm.runInNewContext(source, context);
  function advance(ms) {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
  }
  return { api: window.WifiControls, calls, timers, advance };
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function containsSecret(value) { return JSON.stringify(value).includes(secret); }

let f = fixture(), answers = [];
const options = { ssid: ' Exact network ', securityType: 'psk', password: secret };
const release = f.api.join(options, value => answers.push(value));
options.password = '';
assert(f.api.pending());
assert.equal(f.calls.length, 1);
assert.equal(f.calls[0].uri, 'luna://com.webos.service.wifi/connect');
assert.deepEqual(f.calls[0].sent, { ssid: ' Exact network ', security: { securityType: 'psk', simpleSecurity: { passKey: secret } } });
assert(!containsSecret(f.calls[0].retained), 'shared bridge parameter object loses its secret immediately after dispatch');
f.api.join({ ssid: 'Another network', securityType: 'none' }, value => answers.push(value));
assert.equal(f.calls.length, 1, 'duplicate pending joins never submit another connection');
assert.equal(answers[0].failureCode, 'pending');
f.calls[0].callback({ returnValue: true, password: secret, stdoutString: secret });
assert.deepEqual(plain(answers[1]), { returnValue: true }, 'success never forwards service payloads');
assert(!f.api.pending()); assert.equal(f.calls[0].releases, 1); assert.equal(f.timers.size, 0);
release(); f.calls[0].callback({ returnValue: false, errorText: secret });
assert.equal(answers.length, 2, 'late and repeated callbacks are ignored');
f.api.join({ ssid: 'Another network', securityType: 'none' }, () => {});
release();
assert(f.api.pending()); assert.equal(f.calls[1].releases, 0, 'an old release cannot cancel a newer owned request');
f.calls[1].callback({ returnValue: true });

for (const type of ['none', 'open']) {
  f = fixture(); f.api.join({ ssid: 'Open network', securityType: type }, () => {});
  assert.deepEqual(f.calls[0].sent, { ssid: 'Open network' });
}
for (const password of ['abcde', 'abcdefghijklm', '0123456789', '0123456789abcdef0123456789']) {
  f = fixture(); f.api.join({ ssid: 'Legacy network', securityType: 'wep', password }, () => {});
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].sent.security.simpleSecurity.passKey, password);
}
f = fixture(); f.api.join({ ssid: 'Saved enterprise', securityType: 'ieee8021x', profileId: 777 }, () => {});
assert.deepEqual(f.calls[0].sent, { profileId: 777 }, 'saved networks reuse the TV profile without any password');
f = fixture(); f.api.join({ ssid: 'Saved personal', securityType: 'psk', profileId: 777, password: secret }, () => {});
assert(!('profileId' in f.calls[0].sent), 'an explicit replacement password makes a fresh SSID request');
assert.equal(f.calls[0].sent.security.simpleSecurity.passKey, secret);
f = fixture(); f.api.join({ ssid: '🔒'.repeat(8), securityType: 'psk', password: 'a'.repeat(64) }, () => {});
assert.equal(f.calls.length, 1, 'SSID limits count UTF-8 bytes and accept 64-digit hex PSKs');

for (const options of [null, [], {}, { ssid: '' }, { ssid: '\ud800', securityType: 'none' },
  { ssid: '🔒'.repeat(9), securityType: 'none' }, { ssid: 'bad\nnetwork', securityType: 'none' },
  { ssid: 'network', securityType: 'psk', password: 'short' }, { ssid: 'network', securityType: 'psk', password: 'g'.repeat(64) },
  { ssid: 'network', securityType: 'psk', password: 'password\n' }, { ssid: 'network', securityType: 'wep', password: 'badlength' },
  { ssid: 'network', securityType: 'ieee8021x', password: secret }, { ssid: 'network', profileId: '777' },
  { ssid: 'network', profileId: -1 }, { ssid: 'network', profileId: Infinity }]) {
  f = fixture(); let response;
  f.api.join(options, value => { response = value; });
  assert.equal(f.calls.length, 0, 'invalid or unsupported input must not reach LS2');
  assert.equal(response.returnValue, false); assert(!containsSecret(response)); assert(!f.api.pending());
}

for (const serviceError of [{ returnValue: false, errorText: 'Denied method call ' + secret },
  { returnValue: false, errorText: 'Authentication failed ' + secret }, { returnValue: false, errorText: secret },
  null, { returnValue: 'true', errorText: secret }]) {
  f = fixture(); let response;
  f.api.join({ ssid: 'network', securityType: 'psk', password: secret }, value => { response = value; });
  f.calls[0].callback(serviceError);
  assert.equal(response.returnValue, false); assert(!containsSecret(response));
  assert.equal(f.calls[0].releases, 1); assert.equal(f.timers.size, 0); assert(!f.api.pending());
  if (serviceError && /^Denied/.test(serviceError.errorText)) assert.equal(response.failureCode, 'permission');
}
f = fixture({ throws: true }); let thrownResult;
f.api.join({ ssid: 'network', securityType: 'psk', password: secret }, value => { thrownResult = value; });
assert.equal(thrownResult.failureCode, 'unavailable'); assert(!containsSecret(thrownResult));
assert(!containsSecret(f.calls[0].retained)); assert(!f.api.pending()); assert.equal(f.timers.size, 0);
f = fixture({ synchronous: { returnValue: true } }); let synchronousResult;
f.api.join({ ssid: 'network', securityType: 'psk', password: secret }, value => { synchronousResult = value; });
assert(synchronousResult.returnValue); assert.equal(f.calls[0].releases, 1); assert(!containsSecret(f.calls[0].retained));

f = fixture(); answers = [];
f.api.join({ ssid: 'network', securityType: 'psk', password: secret }, value => answers.push(value));
f.advance(44999); assert(f.api.pending()); assert.equal(answers.length, 0);
f.advance(1); assert(!f.api.pending()); assert.equal(answers[0].failureCode, 'timeout'); assert.equal(f.calls[0].releases, 1);
f.calls[0].callback({ returnValue: true }); assert.equal(answers.length, 1);

f = fixture(); answers = [];
const cancel = f.api.join({ ssid: 'network', securityType: 'psk', password: secret }, value => answers.push(value));
cancel(); cancel(); f.api.cancel();
assert.equal(f.calls[0].releases, 1, 'explicit cancel releases only its owned bridge once');
assert(f.api.pending(), 'physical connection may continue after bridge release, so its bounded guard remains');
f.calls[0].callback({ returnValue: true }); assert.equal(answers.length, 0);
f.advance(45000); assert(!f.api.pending()); assert.equal(answers.length, 0); assert.equal(f.timers.size, 0);

f = fixture(); let profileResult;
const cancelProfiles = f.api.profiles(value => { profileResult = value; });
assert.equal(f.calls[0].uri, 'luna://com.webos.service.wifi/getprofilelist');
assert.deepEqual(f.calls[0].sent, {}); assert(!f.api.pending(), 'metadata reads do not take the connection guard');
f.calls[0].callback({ returnValue: true, password: secret, profileList: [
  { wifiProfile: { ssid: 'Saved network', profileId: 777, security: ['psk', 'psk', secret], password: secret } },
  { wifiProfile: { ssid: 'Enterprise', profileId: 9, security: { securityType: ['ieee8021x'], simpleSecurity: { passKey: secret } } } },
  { wifiProfile: { ssid: 'Unknown security', profileId: 10, security: { unexpected: secret } } },
  null, { wifiProfile: { ssid: {}, profileId: 2 } }, { wifiProfile: { ssid: 'Bad ID', profileId: secret } }
] });
assert.deepEqual(plain(profileResult), { returnValue: true, profiles: [
  { ssid: 'Saved network', profileId: 777, securityTypes: ['psk'] },
  { ssid: 'Enterprise', profileId: 9, securityTypes: ['ieee8021x'] },
  { ssid: 'Unknown security', profileId: 10, securityTypes: [] }
] });
assert(!containsSecret(profileResult)); assert.equal(f.calls[0].releases, 1); cancelProfiles(); assert.equal(f.timers.size, 0);
f = fixture(); let cancelledRead = false; f.api.profiles(() => { cancelledRead = true; })();
f.calls[0].callback({ returnValue: true, profileList: [] }); f.advance(9000);
assert(!cancelledRead); assert.equal(f.calls[0].releases, 1); assert.equal(f.timers.size, 0);
f = fixture(); let timedRead; f.api.profiles(value => { timedRead = value; }); f.advance(9000);
assert.equal(timedRead.failureCode, 'timeout'); assert.equal(f.calls[0].releases, 1);
f = fixture(); let malformedRead; f.api.profiles(value => { malformedRead = value; });
f.calls[0].callback({ returnValue: true, profileList: { password: secret } });
assert.equal(malformedRead.returnValue, false); assert(!containsSecret(malformedRead));
f = fixture({ preview: true }); answers = [];
f.api.join({ ssid: 'network', securityType: 'psk', password: secret }, value => answers.push(value));
f.api.profiles(value => answers.push(value));
assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0); assert(!f.api.pending());
assert(answers.every(value => value.preview && !value.returnValue && !containsSecret(value)));
assert(!/hbchannel|exec\b|localStorage|sessionStorage|console\./.test(source), 'transport contains no shell/storage/logging path');
console.log('Wi-Fi direct payloads, saved-profile reuse, secret scrubbing, generic errors, validation, cancellation, deadlines and preview isolation passed.');
