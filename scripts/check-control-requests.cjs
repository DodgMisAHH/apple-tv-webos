// Delayed transport exercises overlap, cache freshness and write/read races without a TV.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const source = fs.readFileSync('app/tv-controls.js', 'utf8');
function setup() {
  let now = 1000, next = 0;
  const calls = [], timers = new Map();
  const scope = {Date: {now: () => now}, PalmServiceBridge() {},
    setTimeout(fn, ms) {timers.set(++next, {fn, at: now + ms}); return next;},
    clearTimeout(id) {timers.delete(id);},
    window: {LauncherControls: {luna(uri, params, cb) {calls.push({uri, params, cb});}}}};
  vm.runInNewContext(source, scope);
  return {api: scope.window.TVControls, calls,
    reply(i, data) {calls[i].cb({stdoutString: JSON.stringify(data)});},
    advance(ms) {now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) {timers.delete(id); timer.fn();}}};
}
let t = setup(), results = [];
t.api.call('soundOutput', null, r => results.push(r));
t.api.call('soundOutput', null, r => results.push(r), {fresh: true});
t.api.call('outputs', null, r => results.push(r));
t.api.call('inputs', null, r => results.push(r));
assert.equal(t.calls.length, 3, 'independent reads start together; matching reads share transport');
t.reply(0, {returnValue: true, soundOutput: 'tv_speaker'});
assert.equal(results.length, 2);
t.api.call('soundOutput', null, r => results.push(r));
assert.equal(t.calls.length, 3, 'fresh cached values avoid another process');
t.advance(1501);
t.api.call('soundOutput', null, r => results.push(r));
assert.equal(t.calls.length, 4, 'cache expires');

t = setup(); let oldRead, write, duplicate, newRead;
t.api.call('soundOutput', null, r => {oldRead = r;});
t.api.call('output', 'external_optical', r => {write = r;});
assert(t.api.pending('output'));
t.api.call('output', 'external_arc', r => {duplicate = r;});
assert(duplicate.pending); assert.equal(t.calls.length, 2);
t.reply(1, {returnValue: true});
assert(write.returnValue); assert(!t.api.pending('output'));
t.api.call('soundOutput', null, r => {newRead = r;});
t.reply(2, {returnValue: true, soundOutput: 'external_optical'});
t.reply(0, {returnValue: true, soundOutput: 'tv_speaker'});
assert(oldRead.stale, 'read started before write cannot overwrite confirmed newer state');
assert.equal(newRead.soundOutput, 'external_optical');
assert.equal(t.api.peek('soundOutput').soundOutput, 'external_optical');

t = setup(); let timedOut, retry, completions = 0;
t.api.call('setTimer', '30', r => {timedOut = r; completions++;});
t.advance(6500);
assert.equal(timedOut.returnValue, false); assert(!t.api.pending('setTimer'));
t.api.call('setTimer', '60', r => {retry = r;});
t.reply(0, {returnValue: true});
assert.equal(completions, 1, 'late completion is ignored after timeout');
assert(t.api.pending('setTimer'), 'late old callback cannot clear a newer pending write');
t.reply(1, {returnValue: true});
assert(retry.returnValue); assert(!t.api.pending('setTimer'));
console.log('Parallel reads, in-flight dedupe, TTL cache, stale read rejection, pending writes, timeout and retry passed.');
