/* Seed generated runtime files without overwriting a developer's TV data. */
'use strict';
const fs = require('fs');
const path = require('path');
const app = path.resolve(__dirname, '../app');
for (const name of ['apps', 'user']) {
  const target = path.join(app, name + '.js');
  if (!fs.existsSync(target)) {
    fs.copyFileSync(path.join(app, name + '.example.js'), target, fs.constants.COPYFILE_EXCL);
    console.log('Created app/' + name + '.js from the public example.');
  }
}
