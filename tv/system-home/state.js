/* JSON operations for the reversible system Home integration. Node 8 / ES5. */
'use strict';
var fs = require('fs');
var base = '/home/root/lg-tv-vibehack/system-home';
var app = '/media/developer/apps/usr/palm/applications/com.gathin.tvhome';
var keyfile = '/home/root/.config/lginputhook/keybinds.json';
var snapshot = base + '/recovery/home-key.json';
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
}
function ownKey(value) {
  return value && value.action === 'exec' && value.command === '/home/root/lg-tv-vibehack/golauncher.sh';
}
function keyConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid Home key config');
  return value;
}
function keySnapshot(value) {
  if (!value || typeof value.present !== 'boolean' || (value.present && !ownKey(value.value))) throw Error('Invalid saved Home key');
  return value;
}
function main(mode) {
  if (mode === 'description') {
    var description = read(app + '/appinfo.json');
    if (description.id !== 'com.gathin.tvhome' || description.type !== 'web') throw Error('Unexpected installed launcher');
    description.id = 'com.webos.app.home';
    description.folderPath = app;
    description.type = 'web';
    description.defaultWindowType = 'card';
    description.transparent = false;
    description.visible = false;
    description.noSplashOnLaunch = true;
    write(base + '/wam-launch.json', { appDesc: description, parameters: { home: true, reload: false },
      launchingAppId: '', launchingProcId: '', instanceId: 'lg-tv-vibehack-system-home' });
  } else if (mode === 'suspend-key') {
    var keys = keyConfig(fs.existsSync(keyfile) ? read(keyfile) : {});
    var present = Object.prototype.hasOwnProperty.call(keys, '773');
    if (present && !ownKey(keys['773'])) throw Error('Home key is owned by another integration');
    if (fs.existsSync(snapshot)) {
      keySnapshot(read(snapshot));
    } else {
      if (!fs.existsSync(base + '/recovery')) fs.mkdirSync(base + '/recovery', 448);
      write(snapshot, { present: present, value: present ? keys['773'] : null });
    }
    if (present) { delete keys['773']; write(keyfile, keys); }
  } else if (mode === 'restore-key') {
    if (!fs.existsSync(snapshot)) return;
    var old = keySnapshot(read(snapshot)), current = keyConfig(fs.existsSync(keyfile) ? read(keyfile) : {});
    if (!Object.prototype.hasOwnProperty.call(current, '773')) {
      if (old.present) { current['773'] = old.value; write(keyfile, current); }
    } else if (!ownKey(current['773'])) console.log('New Home key binding preserved.');
    fs.unlinkSync(snapshot);
  } else throw Error('Expected description, suspend-key or restore-key');
}
if (require.main === module) main(process.argv[2]);
module.exports = { ownKey: ownKey };
