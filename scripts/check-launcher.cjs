/* One command for the active launcher checks; the abandoned compositor experiment is excluded. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const checks = fs.readdirSync(__dirname).filter(name => /^check-.*\.cjs$/.test(name) &&
  name !== 'check-launcher.cjs' && name !== 'check-system-zoom.cjs').sort();
for (const check of checks) {
  const result = spawnSync(process.execPath, [path.join(__dirname, check)], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`${checks.length} active launcher checks passed.`);
