// Exercise real filesystem streaming with local response fixtures; no network or TV calls.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const {EventEmitter} = require('events'), {Writable, PassThrough} = require('stream');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-wallpaper-resources-'));
const app = path.join(directory, 'app'), usb = path.join(directory, 'usb');
fs.mkdirSync(app); fs.mkdirSync(usb);
fs.writeFileSync(path.join(directory, '.wallpaper-key'), '0123456789ab');
process.env.LG_LAUNCHER_DATA = directory; process.env.LG_LAUNCHER_APP_DIR = app;
const publication = require('../tv/publication.js');
const server = new EventEmitter(), timers = new Map();
let interfaces = {}, timerId = 0, nextStream = null, removeBeforeOpen = false, lastStream;
const fixtureFs = Object.create(fs);
fixtureFs.createReadStream = function (file) {
  if (removeBeforeOpen) { removeBeforeOpen = false; fs.unlinkSync(file); }
  lastStream = nextStream || fs.createReadStream(file); nextStream = null;
  return lastStream;
};
server.listen = function (port, callback) { callback(); return server; };
const scope = {
  Buffer, console:{log() {}}, process:{exit() {throw Error('Unexpected exit');}},
  setTimeout(fn, ms) {timers.set(++timerId, {fn, ms}); return timerId;},
  clearTimeout(id) {timers.delete(id);},
  require(name) {
    if (name === './publication') return publication;
    if (name === 'fs') return fixtureFs;
    if (name === 'os') return {networkInterfaces() {return interfaces;}};
    if (name === 'http') return {createServer() {return server;}};
    if (name === 'child_process') return {execFile() {throw Error('Unexpected external command');}};
    return require(name);
  }
};
vm.createContext(scope);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../tv/wallpaper-server.js'), 'utf8'), scope);
scope.USB_ROOT = fs.realpathSync(usb);
class Response extends Writable {
  constructor() {super(); this.parts = []; this.headersSent = false; this.headers = {};}
  _write(chunk, encoding, done) {this.parts.push(Buffer.from(chunk)); done();}
  writeHead(code, headers) {this.code = code; this.headers = headers; this.headersSent = true;}
}
function imageRequest(name) {
  const response = new Response();
  scope.handle({method:'GET',url:'/api/usb/img?k=0123456789ab&p='+encodeURIComponent(name)}, response);
  return response;
}
function event(object, name) {return new Promise(resolve => object.once(name, resolve));}
function refreshAddress() {
  assert.equal(timers.size, 1, 'Only one address poll is scheduled');
  const [id, timer] = timers.entries().next().value;
  assert.equal(timer.ms, 15000, 'Address checks have a bounded cadence');
  timers.delete(id); timer.fn();
}
function publishedAddress() {
  const result = {window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(app, 'wall.js'), 'utf8'), result);
  return result.window.WALL_URL;
}
function fileIdentity() {const stat = fs.statSync(path.join(app, 'wall.js')); return [stat.ino,stat.mtimeMs];}

(async function () {
  assert.equal(publishedAddress(), '', 'An offline boot publishes no unreachable QR URL');
  let identity = fileIdentity(); refreshAddress(); assert.deepEqual(fileIdentity(), identity, 'An unchanged offline address does not rewrite wall.js');
  interfaces = {eth0:[{family:'IPv4',internal:false,address:'192.0.2.10'}]}; refreshAddress();
  assert.equal(publishedAddress(), 'http://192.0.2.10:8090/?k=0123456789ab', 'A network appearing after startup refreshes the QR URL');
  identity = fileIdentity(); refreshAddress(); assert.deepEqual(fileIdentity(), identity, 'An unchanged live address preserves inode and mtime');
  interfaces.eth0[0].address = '192.0.2.11'; refreshAddress(); assert(publishedAddress().includes('192.0.2.11'));
  interfaces = {}; refreshAddress(); assert.equal(publishedAddress(), '', 'Disconnecting clears the stale QR address');
  server.emit('close'); assert.equal(timers.size, 0, 'Closing the server releases its poll timer');

  const photo = path.join(usb, 'photo.jpg'); fs.writeFileSync(photo, 'fixture photo');
  let response = imageRequest('photo.jpg'); const successfulStream = lastStream;
  await Promise.all([event(response,'finish'), event(successfulStream,'close')]);
  assert.equal(response.code, 200); assert.equal(Buffer.concat(response.parts).toString(), 'fixture photo');
  assert.equal(response.listenerCount('close'), 0, 'A completed file drops its response-close listener');

  removeBeforeOpen = true; response = imageRequest('photo.jpg');
  await event(response, 'finish');
  assert.equal(response.code, 404, 'Removal between realpath and open returns a response instead of crashing');
  assert.equal(response.headers['Content-Type'], 'text/plain');

  fs.writeFileSync(photo, 'fixture photo'); nextStream = new PassThrough();
  response = imageRequest('photo.jpg'); let stream = lastStream;
  stream.emit('open', 1); stream.write('partial');
  const closedResponse = event(response,'close');
  stream.emit('error', Object.assign(new Error('USB read failed'), {code:'EIO'}));
  await closedResponse;
  assert(stream.destroyed && response.destroyed, 'A mid-transfer failure closes both sides without another HTTP status');
  assert.equal(response.code, 200);

  nextStream = new PassThrough(); response = imageRequest('photo.jpg'); stream = lastStream;
  stream.emit('open', 1); const closedStream = event(stream,'close');
  response.destroy(); await closedStream;
  assert(stream.destroyed, 'A disconnected client closes its USB reader');
  assert.equal(response.listenerCount('close'), 0);
  nextStream = new PassThrough(); response = imageRequest('photo.jpg'); stream = lastStream;
  response.emit('close'); stream.emit('open', 1);
  assert(stream.destroyed && !response.headersSent, 'An abandoned response cannot start a late file transfer');
  console.log('Wallpaper USB open/read failures, client disconnect cleanup, delayed/changed network addresses and unchanged-file publication passed.');
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => {
  server.emit('close'); fs.rmSync(directory, {recursive:true,force:true});
});
