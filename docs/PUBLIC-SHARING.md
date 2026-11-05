# Shareable source and private development

This repository is the shareable `apple-tv-webos` edition. It was prepared as an
independent copy of the local launcher project. Changes here do not modify the
original working directory or an installed TV. Keep developing either copy;
port individual source changes after reviewing them. Avoid copying the original
folder wholesale over this repository.

This repository contains the shareable source edition. Personal development files
remain in the separate local copy. No release or device deployment is required
to review this source.

## What is intentionally different

- The current interface is English-only; language selection is not included.
- System fonts and original MIT SVG controls replace the local Apple font/symbol
  assets. Appearance therefore differs slightly from historical screenshots.
- A generic app inventory is provided in `app/apps.example.js`; no personal TV
  inventory, wallpaper settings, network addresses or pairing keys are included.
- `node scripts/prepare-app.cjs` creates ignored `app/apps.js` and `app/user.js`
  only when absent, preserving an existing developer's local state.
- Private backups, `.local/`, generated packages, device icons, fonts and virtual
  environments are ignored. The original upstream downloader is disabled.
- Source builds and validation run in CI. Release packaging creates drafts for
  review. A clean checkout is the appropriate starting point for shared packages.

## Before changing repository visibility or making a release

1. Run the validation commands in [CONTRIBUTING](../CONTRIBUTING.md) from a fresh
   checkout; package both entrypoints as described in [setup](SETUP.md).
2. Review `git ls-files` and the Git history for personal data. `.gitignore` does
   not remove files that have already been committed.
3. Keep private TV changes in ignored runtime files. Check any new screenshots,
   logs and recordings for pairing QR codes, network details and private content.
4. Record physical TV testing separately from offline checks. This edition's
   changed fonts/icons require a device visual check before claiming identical
   rendering to the historical local build.
5. Verify credits for new assets and review the final package contents. Do not
   package from a directory containing copied private data or restricted assets.

The other technical reports under `docs/` preserve historical implementation
notes. Their deployed versions, private backup paths and physical test results
refer to the earlier local build, not a release of this shareable edition.
