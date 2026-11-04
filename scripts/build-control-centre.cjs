/* Package the shared controls as a separate transparent webOS overlay. */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'app');
function build(output = path.join(root, 'build/control-centre/app'), inspectable = false) {
const files = ['overlay.html', 'overlay.js', 'overlay.css', 'screen.js',
  'control-centre.js', 'control-centre.css', 'hidden-apps.css',
  'tv-controls.js', 'wifi-controls.js', 'vpn-controls.js', 'config.js', 'user.js', 'qrcode.js', 'icon.png',
  'ui-icons/LICENSE.txt', 'LICENSE.txt', 'NOTICE.txt'];
// This directory is generated entirely by this builder. Drop obsolete packaged
// assets, including font subsets no longer referenced by the current CSS.
fs.rmSync(output, {recursive: true, force: true});
function copy(relative) {
  const target = path.join(output, relative);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.copyFileSync(path.join(source, relative), target);
}
files.forEach(copy);
fs.readdirSync(path.join(source, 'ui-icons')).filter(name => name.endsWith('.svg'))
  .forEach(name => copy('ui-icons/' + name));
fs.writeFileSync(path.join(output, 'appinfo.json'), JSON.stringify({
  id: 'com.gathin.tvcontrolcentre', version: '1.0.21', vendor: 'apple-tv-webos contributors',
  type: 'web', main: 'overlay.html', title: 'Control Centre', icon: 'icon.png',
  resolution: '1920x1080', defaultWindowType: 'overlay', transparent: true,
  visible: false, handlesRelaunch: true, disableBackHistoryAPI: true,
  noSplashOnLaunch: true, spinnerOnLaunch: false, inspectable,
  requiredACG: ['application.launcher', 'network.query']
}, null, 2) + '\n');
return output;
}
module.exports = {build};
if (require.main === module) console.log(build(undefined, process.argv.includes('--inspectable')));
