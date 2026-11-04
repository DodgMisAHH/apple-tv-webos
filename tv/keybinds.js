/* Preserve unrelated LG Input Hook bindings and a recoverable original Home action. ES5. */
'use strict';
var fs = require('fs'), path = require('path');
var mode = process.argv[2], file = process.argv[3], backup = process.argv[4], command = process.argv[5];
if ((mode !== 'install' && mode !== 'restore') || !file || !backup || !command) {
  throw new Error('Expected install|restore, config path, backup path and launcher command');
}
function read(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  var j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('Invalid config: ' + file);
  return j;
}
function write(file, j) {
  fs.writeFileSync(file + '.launcher-tmp', JSON.stringify(j, null, 2) + '\n');
  fs.renameSync(file + '.launcher-tmp', file);
}
function snapshot() {
  var old = read(backup, null);
  if (!old) throw new Error('Home recovery snapshot missing; refusing to discard the binding.');
  if (typeof old.present !== 'boolean' || (old.present && !Object.prototype.hasOwnProperty.call(old, 'value'))) {
    throw new Error('Invalid Home recovery snapshot; original binding retained.');
  }
  return old;
}
var j = read(file, {}), current = j['773'];
var ours = current && current.action === 'exec' && current.command === command;
if (mode === 'install') {
  if (ours) { console.log('Home already points to this launcher.'); process.exit(0); }
  if (!fs.existsSync(path.dirname(file))) fs.mkdirSync(path.dirname(file));
  // Older releases left snapshots after restore. Reuse one only if the current
  // binding still exactly matches it; a newer foreign binding remains protected.
  if (fs.existsSync(backup)) {
    var previous = snapshot(), present = Object.prototype.hasOwnProperty.call(j, '773');
    if (previous.present !== present || (present && JSON.stringify(previous.value) !== JSON.stringify(current))) {
      throw new Error('Previous Home backup exists; inspect it before replacing a changed binding.');
    }
  } else write(backup, { present: Object.prototype.hasOwnProperty.call(j, '773'),
    value: Object.prototype.hasOwnProperty.call(j, '773') ? current : null });
  j['773'] = { action: 'exec', command: command };
  write(file, j);
  console.log('Home mapped; original binding saved.');
} else if (ours) {
  var old = snapshot();
  if (old.present) j['773'] = old.value;
  else delete j['773'];
  write(file, j);
  // Once restoration succeeds, a later install must take a fresh snapshot.
  fs.unlinkSync(backup);
  console.log('Previous Home binding restored; other bindings retained.');
} else console.log('Home binding changed elsewhere; left untouched.');
