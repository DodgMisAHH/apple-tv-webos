/* Offline Python/socket and launch-agent regression fixtures; no pip or TV access. */
const path = require('path');
const {spawnSync} = require('child_process');
const root = path.resolve(__dirname, '..');
const result = spawnSync('python3', ['-B', path.join(__dirname, 'check-desktop-helpers.py'), '-q'], {
  cwd: root, stdio: 'inherit', env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log('Desktop pairing/RPC cleanup, safe app/icon publication and Mac watcher update/rollback passed.');
