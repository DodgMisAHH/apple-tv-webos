/* Catch accidental publication of local runtime files and common credential formats. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const root = path.resolve(__dirname, '..');
const forbidden = /(?:^|\/)(?:\.local|venv|\.venv|node_modules|__pycache__|build)(?:\/|$)|(?:^|\/)(?:\.lgtv-key\.json|\.tv-host|\.sync-apps-icons\.json|\.DS_Store)$|(?:^|\/)\.env(?:\..+)?$|\.(?:key|pem|p12|pfx|ipk|pyc|log)$|^app\/(?:fonts\/|icons\/|(?:apps|user|wall)\.js$|bg(?:-[^/]*)?\.jpg$|wallpaper\.jpg$)/;
const repo = spawnSync('git', ['rev-parse', '--show-toplevel'], {cwd: root, encoding: 'utf8'});
let files;
if (repo.status === 0 && path.resolve(repo.stdout.trim()) === root) {
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  files = [...new Set(result.stdout.split('\0').filter(Boolean))];
} else {
  // Source archives have no index. Check their distributable files, while allowing
  // ignored device data generated after unpacking. Git checkouts also audit the index.
  files = [];
  function visit(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), {withFileTypes: true})) {
      const name = path.posix.join(relative, entry.name);
      if (name === '.git' || forbidden.test(name) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(name);
      else files.push(name);
    }
  }
  visit('');
}
const credentials = /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
for (const file of files) {
  assert(!forbidden.test(file) || file === '.env.example', 'Private/generated file is publishable: ' + file);
  const full = path.join(root, file);
  if (!fs.existsSync(full) || !fs.lstatSync(full).isFile()) continue;
  const bytes = fs.readFileSync(full);
  if (bytes.includes(0)) continue;
  const text = bytes.toString('utf8');
  assert(!credentials.test(text), 'Possible credential in: ' + file);
  assert(!/\/Users\/[A-Za-z0-9._-]+\//.test(text), 'Personal workstation path in: ' + file);
}
console.log('Shareable source inventory and common credential-pattern checks passed (' + files.length + ' files).');
