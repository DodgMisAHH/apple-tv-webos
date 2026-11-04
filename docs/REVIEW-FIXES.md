> Historical local-build report. This describes the original development TV,
> not a verified release of the shareable edition. Apple fonts/symbols and
> private backup files mentioned below are not included. Use [setup](SETUP.md)
> for current instructions and [sharing notes](PUBLIC-SHARING.md) for differences.

# Review follow-up — 2026-11-02

Home build **1.2.43** and Control Centre **1.0.11** introduced the review fixes
and a small SF Pro font subset. Their app changes are now installed in Home
**1.2.51** and Control Centre **1.0.19**. The separate System Home permission
manager was also updated for the scoped Wi-Fi prompt. Other TV/Mac helper source
changes below still require their own deployment and were not included in these
app-package updates.

## What changed, in plain language

- **Failed work gets cleaned up.** Failed pairing closes its connection. Failed
  background-process launches no longer leave objects in memory. Upload previews
  release temporary photos when replaced, cancelled, or closed.
- **A missing USB photo no longer stops the wallpaper service.** Read errors and
  clients disconnecting mid-download are handled and their file streams closed.
- **A failed app refresh keeps the last good app list.** Both sync paths retain
  apps whose icons cannot be loaded, using a cached icon or a placeholder.
  Changed names and icons refresh even when the installed app IDs stay the same.
- **The shared update queue recovers after workers die.** Dead workers' own
  temporary requests and receipts are removed, while live workers and unrelated
  files are preserved. Process identity includes boot/start information on Linux
  so a reused process number does not look like the original worker.
- **Home-button restoration can be followed by another installation.** The
  original mapping stays recoverable, and unrelated mappings are preserved.
- **Network changes recover.** The wallpaper QR address refreshes when the TV's
  address changes. Failed Control Centre network subscriptions reconnect with
  bounded delays while the panel is visible.
- **Mac helper updates are staged first.** Missing configuration or dependencies
  leave the old job running; a failed start restores its previous configuration.
- **Less unnecessary work and clutter.** Unchanged preferences are not rewritten.
  Unused pencil/column controls, obsolete layout code and unused icons were
  removed. The app-actions preview shares the real app's runtime, preference
  model and CSS. Obsolete synced icon files are removed only when their recorded
  ownership and contents still match.

## SF Pro

The app and separate Control Centre bundle **one 65,088-byte WOFF2 file** from
the locally installed SF Pro. It keeps upright weights 400–700, Latin and
Vietnamese characters, combining marks, required UI symbols and fixed-width
clock digits. Other writing systems use the TV's system font fallback.

Unused italic/width variants, extreme weights and the previous Inter, Lexend and
Manrope binaries are omitted. Total bundled font data falls from 581,876 to
65,088 bytes (about 89% smaller). This is an asset-size reduction, not a measured
TV startup or frame-rate improvement.

The font builder, source/output hashes and retained font notice are in
`scripts/subset-sf-pro.py` and `app/fonts/`. The overlay builder copies all font
files referenced by its CSS and removes obsolete files from its generated app
directory.

## Verification and local artifacts

Run the complete active regression suite with:

```sh
node scripts/check-launcher.cjs
```

It covers failure cleanup, queue recovery, sync preservation, icon fallbacks,
Home mapping restore/reinstall, preference migration, Move/Hide, overlay
reconnection, wallpaper handling, package references and desktop helper rollback.
The desktop tests use fake sockets, HTTP responses and launchctl commands; they
do not pair with the TV or change the Mac's installed login job.

Original review result: **36 active suites passed**, including **24 desktop-helper tests**.
All 40 source/generated runtime JavaScript files parse as ES5; all 23 checked
Python and shell files pass syntax validation. Both IPKs contain the matching
SF Pro bytes and resolve their local HTML/CSS asset references. Their 23 packaged
JavaScript files also parse as ES5 after the webOS CLI's minification.

The local browser preview has been checked for SF Pro loading, Control Centre,
drawer navigation and the Move/Hide menu. Runtime JavaScript is checked against
ES5 syntax. Python and shell syntax are checked separately. Physical remote
input, Chromium 79 rendering and long-running memory use still need validation
on the TV; local tests do not establish a measured memory or speed improvement.

Local packages are
`build/review-fixes/com.gathin.tvhome_1.2.43_all.ipk` (865,124 bytes) and
`build/review-fixes/com.gathin.tvcontrolcentre_1.0.11_all.ipk` (160,196 bytes).
The browser screenshot is `build/review-fixes/sf-pro-preview.png`.
Rooted-TV helper changes are in
`tv/` and require their existing deployment workflow separately from installing
the app packages. Mac helper changes take effect when its updater is run.

The pre-change source/assets backup is
`.local/backups/before-review-fixes-20261102-224701.tar.gz`.

## Current Control Centre follow-up

The integrated Wi-Fi flow, shared submenu styling and scoped permission manager
passed **37 active suites**. All 37 active source/generated runtime files and
25 extracted package JavaScript files parsed as ES5. The subsequent CSS-only
revision restoring the 665px list height and darkening the shade passed the
Control Centre, overlay and asset checks and a browser visual check.
Installed Home 1.2.50 and overlay 1.0.19 matched all 91 checked package assets;
30 runtime files and saved settings were preserved. Actual app sender permissions
were checked without connecting to a network. A real Wi-Fi join remains untested.

Home **1.2.51** is installed after the user accepted a
temporary 3px blur on Home's unselected main Control Centre buttons. It uses a
Home-only CSS rule while the panel is open; selected controls, submenus, opacity
and layout are unchanged. The drawer keeps its prepared texture, and no
JavaScript loop or animated blur radius is added. Asset, Control Centre and
overlay checks passed. Installation returned success status 30 after reconnecting
to the TV. All 91 checked package assets matched, including unchanged overlay
1.0.19; 30 runtime files and saved settings were preserved, with no temporary
trial scripts remaining. The validated native Home page reload was accepted,
Home focus confirmed and the Settings cache refreshed without restarting the
native adapter. The record is
`.local/releases/1.2.51/deployment-result.json`. The private pre-install backup is
`.local/releases/1.2.51/before-tv-update.tar.gz` (2,312,406 bytes, mode `0600`).

The separate 3px floating trial was rejected after the user saw black backgrounds
on all buttons except Settings; the user clarified that Settings was not selected.
Its entrypoint was restored, trial removed and
panel closed, with Netflix focus confirmed. Overlay **1.0.19** remains unfiltered.
The Home feedback establishes accepted appearance and subjective responsiveness;
neither trial supplies new FPS, GPU or physical latency measurements. See
[the trial record](PERFORMANCE.md#home-and-floating-button-blur-trials--3-november-2026).
