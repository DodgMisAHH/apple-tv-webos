/* Verify both entrypoints and the redistributable assets in the overlay package. */
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const {build} = require('./build-control-centre.cjs');
const app = path.resolve(__dirname, '../app');
function checkReferences(root, entry) {
  const visited = new Set();
  function visit(relative) {
    if (visited.has(relative)) return;
    visited.add(relative);
    const file = path.join(root, relative);
    assert(fs.existsSync(file), 'Missing packaged dependency: ' + relative);
    if (!/\.(css|html)$/.test(relative)) return;
    const text = fs.readFileSync(file, 'utf8');
    const expressions = relative.endsWith('.css') ? [/url\(['"]?([^)'"\s]+)['"]?\)/g] : [/(?:src|href)="([^"]+)"/g];
    for (const expression of expressions) for (const match of text.matchAll(expression)) {
      const target = match[1].split('?')[0];
      if (/^(?:[a-z]+:|#|\/)/i.test(target)) continue;
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(relative), target)));
    }
  }
  visit(entry);
  return visited;
}
const icons = ['controls', 'power', 'wifi', 'moon', 'sound', 'shield', 'gamepad', 'input', 'image', 'settings', 'timer'];
for (const icon of icons) {
  const svg = fs.readFileSync(path.join(app, 'ui-icons', icon + '.svg'), 'utf8');
  assert(svg.includes('<svg'), 'UI icon must be an SVG: ' + icon);
  assert(!/<(?:image|script|foreignObject)\b/i.test(svg), 'UI icons must be self-contained drawings');
}
assert(fs.existsSync(path.join(app, 'ui-icons/LICENSE.txt')));
for (const name of ['LICENSE.txt', 'NOTICE.txt']) assert(fs.statSync(path.join(app, name)).size > 0);
const homeReferences = checkReferences(app, 'index.html'), overlayReferences = checkReferences(app, 'overlay.html');
assert(![...homeReferences, ...overlayReferences].some(name => /^fonts\/|^icons\/sf\//.test(name)),
  'Shareable entrypoints must not require proprietary font or symbol assets');
assert(!homeReferences.has('native-blur.js'), 'Home keeps its independent same-page blur path');
assert(!overlayReferences.has('native-blur.js'), 'Floating entrypoint no longer loads the native-state reporter');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-assets-'));
try {
  const output = path.join(dir, 'overlay');
  fs.mkdirSync(output); fs.writeFileSync(path.join(output, 'obsolete-font.woff2'), 'old');
  fs.mkdirSync(path.join(output, 'fonts')); fs.writeFileSync(path.join(output, 'fonts/sf-pro.woff2'), 'old');
  fs.writeFileSync(path.join(output, 'native-blur.js'), 'old reporter');
  build(output);
  assert(!fs.existsSync(path.join(output, 'obsolete-font.woff2')), 'Rebuild cannot retain unused package assets');
  const packaged = checkReferences(output, 'overlay.html');
  assert(!fs.existsSync(path.join(output, 'fonts')), 'Rebuild drops old bundled fonts');
  assert(!fs.existsSync(path.join(output, 'icons/sf')), 'Rebuild cannot include proprietary symbols');
  for (const icon of icons) assert(fs.readFileSync(path.join(output, 'ui-icons', icon + '.svg'))
    .equals(fs.readFileSync(path.join(app, 'ui-icons', icon + '.svg'))));
  assert(fs.existsSync(path.join(output, 'ui-icons/LICENSE.txt')));
  for (const name of ['LICENSE.txt', 'NOTICE.txt']) assert(fs.readFileSync(path.join(output, name))
    .equals(fs.readFileSync(path.join(app, name))));
  assert(!packaged.has('native-blur.js'));
  assert(!fs.existsSync(path.join(output, 'native-blur.js')), 'Rebuild drops the old native-state reporter');
  assert(!fs.existsSync(path.join(output, 'style.css')), 'Home backdrop-filter must not leak into floating CSS');
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'appinfo.json'))).inspectable, false);
  console.log('Shareable UI icons, entrypoint assets, proprietary asset exclusion, Home effect isolation and clean rebuild passed.');
} finally { fs.rmSync(dir, {recursive: true, force: true}); }
