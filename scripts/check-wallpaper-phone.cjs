// Crop resource ownership is independent of image download or TV availability.
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const html = fs.readFileSync('tv/wallpaper.html','utf8');
const source = html.slice(html.indexOf("  var img = $('photo')"),html.indexOf('  // One finger drags'));
const elements = {}, released = [], lifecycle = {}, statuses = [];
for (const id of ['photo','crop','zoom','cropMode','viewMode','usbSection','weatherSection']) elements[id] = {style:{}};
Object.assign(elements.photo, {naturalWidth:1920,naturalHeight:1080,removeAttribute(name) {delete this[name];}});
Object.assign(elements.crop, {clientWidth:320,clientHeight:180,scrollIntoView() {}});
elements.cropMode.hidden = true;
const scope = {$:id=>elements[id], URL:{revokeObjectURL(url) {released.push(url);}},
  window:{addEventListener(name, callback) {lifecycle[name] = callback;}},
  L:{loading:'loading',fail:'failure'},status(value, error) {statuses.push({value,error});}};
vm.createContext(scope); vm.runInContext(source, scope);
scope.openCrop('blob:failed'); elements.photo.onerror();
assert.deepEqual(released,['blob:failed']); assert.equal(scope.st.src,'');
assert.equal(statuses[statuses.length-1].value,'failure');
assert(elements.cropMode.hidden && !elements.viewMode.hidden);

scope.openCrop('blob:first'); const staleLoad = elements.photo.onload, staleError = elements.photo.onerror;
scope.openCrop('blob:second'); assert.deepEqual(released,['blob:failed','blob:first']);
staleLoad(); staleError(); assert.equal(scope.st.src,'blob:second'); assert(elements.cropMode.hidden);
elements.photo.onload(); assert(!elements.cropMode.hidden); assert.equal(elements.photo.onload,null);
scope.closeCrop(); scope.closeCrop(); assert.deepEqual(released,['blob:failed','blob:first','blob:second']);

scope.openCrop('blob:cancelled'); const cancelledLoad = elements.photo.onload;
scope.closeCrop(); cancelledLoad(); assert(elements.cropMode.hidden);
assert.equal(released[released.length-1],'blob:cancelled');
scope.openCrop('blob:departed'); lifecycle.pagehide();
assert.equal(released[released.length-1],'blob:departed'); assert.equal(elements.photo.src,undefined);
const releaseCount = released.length;
scope.openCrop('api/usb/img?p=photo.jpg'); elements.photo.onload(); scope.closeCrop();
assert.equal(released.length,releaseCount,'Remote USB URLs are never passed to revokeObjectURL');
console.log('Phone crop object URL cleanup on failure, replacement, cancel and page departure; stale image callbacks passed.');
