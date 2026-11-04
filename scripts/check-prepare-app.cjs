/* A fresh checkout can boot without destroying a developer's local TV data. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-tv-seed-'));
try {
  fs.mkdirSync(path.join(dir, 'app'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(path.join(__dirname, 'prepare-app.cjs'), path.join(dir, 'scripts/prepare-app.cjs'));
  for (const name of ['apps', 'user']) fs.copyFileSync(path.join(root, 'app', name + '.example.js'),
    path.join(dir, 'app', name + '.example.js'));
  function prepare() {
    const result = spawnSync(process.execPath, [path.join(dir, 'scripts/prepare-app.cjs')], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
  }
  prepare();
  for (const name of ['apps', 'user']) assert(fs.readFileSync(path.join(dir, 'app', name + '.js'))
    .equals(fs.readFileSync(path.join(dir, 'app', name + '.example.js'))));
  const personal = '// Local device settings must survive preparation.\n';
  fs.writeFileSync(path.join(dir, 'app/user.js'), personal);
  fs.unlinkSync(path.join(dir, 'app/apps.js'));
  prepare();
  assert.equal(fs.readFileSync(path.join(dir, 'app/user.js'), 'utf8'), personal);
  assert(fs.existsSync(path.join(dir, 'app/apps.js')));
  console.log('Fresh checkout preparation, partial recovery and local settings preservation passed.');
} finally { fs.rmSync(dir, {recursive: true, force: true}); }
