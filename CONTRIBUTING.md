# Contributing

Small, focused changes with reproducible steps are welcome. Explain the behavior before and after the change, the webOS model/firmware involved when relevant, and what was actually tested.

## Local development

Use Node.js 22 and Python 3 on your computer. Preview the app with:

```sh
node scripts/prepare-app.cjs
python3 scripts/preview.py
```

Install the locked development dependencies, seed the runtime examples and run the local regression suites before submitting a change:

```sh
npm ci --ignore-scripts
node scripts/prepare-app.cjs
npm test
```

The seed command creates ignored `app/apps.js` and `app/user.js` from tracked examples only when they are missing. Never commit the generated files after syncing a real TV.

The pinned Acorn development dependency parses app/TV JavaScript and inline HTML scripts as ES5. It is not a runtime dependency. `npm test` runs `node scripts/check-launcher.cjs`.

These checks use mocks and local fixtures; they do not connect to a TV. The abandoned system-zoom experiment is excluded from the normal launcher runner. Follow the CI workflow for the complete syntax and compatibility checks.

Use `ares-package app -o build/home` to package Home. For the floating overlay, run `node scripts/build-control-centre.cjs` followed by `ares-package build/control-centre/app -o build/control-centre`. See [Setup](docs/SETUP.md) for installation and recovery.

## Runtime constraints

- Keep shipped `app/` and TV-side JavaScript compatible with ES5. Older webOS TVs use Node 0.12; desktop build/check scripts can use modern Node.
- Do not introduce unsupported TV APIs such as `fs.copyFileSync`, `Buffer.from` or `Object.assign` into TV-side code.
- Preserve saved settings, app IDs and unrelated remote-key mappings during upgrades and recovery.
- Keep network/service requests bounded, and stop passive work while the UI is hidden.
- For UI changes, check arrows, pointer, long-press, Back, app switching and both Home/overlay entrypoints where affected.
- Describe browser validation separately from physical-TV validation. Report tested firmware and any remaining device checks; do not infer playback or reboot behavior from mocks.

## Changes to TV integrations

Keep recovery instructions current. Native Home uses firmware-specific checks; do not remove or loosen them merely to make a different TV pass. Experimental compositor and blur code is outside the normal installation path. New device integrations need an explicit trial, a rollback path and evidence from the intended hardware.

## Files to keep private

This is a separate shareable source copy; see [the public-sharing notes](docs/PUBLIC-SHARING.md) before porting changes or preparing a release.

Do not commit pairing keys, TV addresses, network credentials, personal wallpapers, generated TV inventory, logs, device backups, `.local/`, Python environments or packages from `build/`. Review the staged diff and file list before pushing. Issue attachments and screenshots can also expose QR tokens, Wi-Fi names and addresses.

Retain upstream copyright notices and document the source and license of added assets in [Asset credits](docs/ASSET-CREDITS.md). Do not include font or icon files merely because they are installed on your computer.
