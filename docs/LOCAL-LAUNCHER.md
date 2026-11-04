> Historical local-build report. This describes the original development TV,
> not a verified release of the shareable edition. Apple fonts/symbols and
> private backup files mentioned below are not included. Use [setup](SETUP.md)
> for current instructions and [sharing notes](PUBLIC-SHARING.md) for differences.

# Local LG glass launcher

The current installed build is **1.2.51**, with [reference-matched Control Centre
proportions](CONTROL-PROPORTIONS.md), SF Pro and the fixes recorded in
[the review follow-up](REVIEW-FIXES.md). It is installed alongside Control Centre
**1.0.19**, with all 91 checked package assets matching and 30 runtime files plus
saved settings preserved. Both views share submenu styling and the Wi-Fi password
prompt. Known networks reuse their saved TV profile. The floating shade is darker,
and submenu lists retain their original compact height and the slim gray scrollbar.
The physical Home button was previously confirmed working following standby.
The validated native Home page reload was accepted and Home focus confirmed;
the Settings launch cache was refreshed without restarting the native adapter.
The records below describe earlier builds.

Home **1.2.51** is installed. It saves the accepted 3px
backdrop blur on unselected main Control Centre buttons while Home's panel is
open. The user confirmed that the temporary Home trial looked correct and felt
smooth; no new frame-rate benchmark was run. A separate 3px floating-panel trial
produced black button backgrounds and was reverted. The floating overlay keeps
its existing material without live blur. Installation succeeded after reconnecting
to the TV; verification found no temporary trial scripts. The deployment record
is `.local/releases/1.2.51/deployment-result.json`. See
[the trial results](PERFORMANCE.md#home-and-floating-button-blur-trials--3-november-2026).

The separate [Settings-button Control Centre overlay](SETTINGS-OVERLAY.md) opens
over the current app. It has its own package and reversible key139 mapping;
the Home package and native Home integration described below remain unchanged.

This checkout contains an LG webOS adaptation, not the Samsung Tizen runtime.
The installed package keeps ID `com.gathin.tvhome` to retain existing web storage
and shortcuts.
The earlier **1.2.39** installation included the following behavior. Long-press opens Move and Hide;
Control Centre has a permanent round Hidden apps shortcut and a disabled translucent
“No apps hidden” row when empty. Back returns through submenus before closing.
Picked-up tiles follow inputs immediately while neighbors slide aside. The drawer
opens/closes over 420 ms with softer easing. Its prepared wallpaper texture now
uses an opposite transform with identical timing, keeping it aligned throughout
the slide instead of jumping to the final crop. Normal pointer focus requires
actual movement, so passing tiles cannot reopen a closing drawer.

Version 1.2.39 fixes remote input remaining blocked after Screen Off. When the TV
wakes the display itself, its subsequent `turnOnScreen` response is `Active/-102`;
Home now treats that as already awake. Other wake errors/timeouts also release
input, and late callbacks cannot re-arm the screen-off state after resume. Held
wake buttons and missing key releases are covered by regression tests. A guarded
cycle on the actual Home page returned the same `Active/-102` response, followed
by successful navigation and Back. Seven relevant suites and source/package ES5
checks passed. The temporary inspector was removed; settings and startup helper
checksums were unchanged. Physical remote confirmation remains pending.

The user confirmed long-press and stepwise Back on 1.2.33 and reported that 1.2.36's
immediate tile movement looks better. They reported an upward flick on closing
1.2.37; they confirmed that 1.2.38 now closes smoothly on the TV. For 1.2.38, all 27
launcher suites plus preview drawer and production movement checks passed. Browser samples
verified aligned texture and monotonic closing, including an interrupted expansion;
deliberate pointer focus still works. Source and packaged JavaScript parse as ES5.
Installed bytes and native Home registration are checked separately from physical
rendering. No new frame-rate benchmark or full TV reboot test was run. Versioned
notes below retain historical results.

The accepted [system Home integration](SYSTEM-HOME.md) reuses this package's
optimized assets under the runtime identity `com.webos.app.home`, while keeping
`com.gathin.tvhome` installed as the fallback. The two identities have separate
browser storage; missing Home values were seeded with the saved app order and
six-column setting. Its page-originated service and YouTube-launch checks pass,
and the user confirmed that Home and app tiles work. Live rollback and persistent
startup after a full system reboot passed. Normal remote standby/wake was also
confirmed to appear promptly and work. A full reboot still shows HDMI 1 followed
by about 20 seconds before the launcher appears; this is separate from the
accepted normal wake behavior.

## Appearance and preferences

- Bundled coast photograph, compact SF Pro clock and controls, Apple TV-inspired colourful tiles and a translucent glass favourites shelf. Down expands the installed-app grid.
- Local brand SVG logos for Stremio, Netflix, Disney+, YouTube, Apple TV, Prime Video and Apple Music. Netflix and YouTube use red variants; app backgrounds retain their colours.
- Other installed apps retain their official colour icons. No streaming app is replaced.
- Existing `tvhome.columns` and `tvhome.order` storage is retained. The old order seeds the new `tvhome.appActions` preferences on first run; hidden apps keep their positions for restoration. Browser preview preferences use a separate key.
- Up from favourites or clicking the clock opens Control Centre with hidden apps/inputs/network/wallpaper/settings. Down from favourites expands the installed-app grid. Right stops at the last tile in a row. Hold OK for Move/Hide; Back cancels a move or returns one Control Centre level.
- A phone wallpaper page remains available after root integration. Its crop guides match this layout.
- Runtime JavaScript stays ES5. No build framework, CSS flex gap, optional chaining or external font/CDN dependency is introduced.
- The desktop preview scales the same 1920×1080 canvas used on the TV. Desktop launches show a preview message.

Preview only the app directory, so pairing credentials and recovery files cannot be served:

```sh
python3 scripts/preview.py
```

Open http://127.0.0.1:4795. It refreshes automatically when app assets change. Use arrows, Enter, Escape or the pointer.
The reload helper is injected only by the loopback development server and is not packaged on the TV.
The drawer uses static gradients, fine borders, shadows and a precomputed softened
wallpaper texture. Its texture tracks row scrolling; legacy custom photos without
a texture are sampled once while idle. Home 1.2.51 adds 3px CSS backdrop blur only
to unselected main Control Centre buttons while the panel is open. Selected
buttons, submenus and the floating overlay remain unfiltered. No JavaScript frame
loop, animated blur radius or extra compositing library is added; optional
profiling is described in [PERFORMANCE.md](PERFORMANCE.md).
The TV's saved layout is separate from the browser preview's local storage.

## Build and verification

Use the existing webOS CLI, rather than reinstalling global tooling:

```sh
ares-package app -o build/glass
node scripts/check-launcher.cjs
sh -n tv/integrate.sh
```

Run an ES5 parser on `app/*.js` and `tv/*.js` before device changes. Browser validation is useful,
but actual rendering and playback on Chromium 79 still require the TV check.

## Device stages

1. Back up local files and the installed TV app. Keep `.local/` private.
2. Install the local IPK through existing Developer Mode access. Check the UI and official Apple TV/YouTube playback.
3. Inspect a pinned SlopBro revision and its payloads; never run an unreviewed moving download in a shell.
4. Root with the explicit webOS major version, then remove the LG Developer Mode app **before rebooting**.
   Do not reinstall Developer Mode while rooted. Payload downloads alone do not establish successful root.
5. Full reboot with Quick Start+ off. Check Homebrew Root status and verify `id -u` returns `0` over root SSH.
6. Enable Homebrew SSH and Block system updates. Keep LG's automatic firmware updates off.
   Homebrew 0.7.3 blocks four firmware endpoints (`snu.lge.com`, `su-dev.lge.com`, `su.lge.com`, `su-ssl.lge.com`).
   Do not introduce broad LG-domain blocklists; verify official Store browsing and app updates separately.
7. Install LG Input Hook from Homebrew and open it once.
8. Upload the local `tv/` files to a staging directory on the TV. Execute the stages separately as root:

```sh
sh /tmp/lg-launcher-stage/integrate.sh prepare
sh /tmp/lg-launcher-stage/integrate.sh home
sh /tmp/lg-launcher-stage/integrate.sh startup
```

`prepare` seeds the bundled photo only for a new settings file and keeps an existing photo/settings file.
It syncs apps but does not enable startup or Home. `home` saves the original key 773 action and changes
only that key. `startup` registers `00-lg-tv-vibehack` in Homebrew's user-hook directory so the launcher watcher starts before Input Hook's blocking initialization.
Do not use the upstream one-line installer for this local variant: it fetches the upstream release and would replace this design.

9. Reboot and check startup, Home from both official apps, LG Store access and updates, and another full power cycle.
   Successful script execution is not a substitute for physical remote and playback checks.

## Recovery

From root SSH, disable this launcher's integration:

```sh
sh /home/root/lg-tv-vibehack/integrate.sh disable
```

Then reboot. This restores the saved Home action only if Home still points to this launcher, preserves
other Input Hook keys, removes/restores this launcher's boot hook, and stops its watcher and wallpaper server.
It retains the launcher, settings, photos, SSH and Homebrew. If another program changed Home, it leaves that action alone.
The original mapping and any previous startup hook are in `/home/root/lg-tv-vibehack/recovery/`.

Private local backups and the exact rooting source hashes are in `.local/`. Do not publish or serve
that directory. It may contain pairing credentials, device paths and recovery information.

## Optional local cleanup profile

The selected profile retains GeForce NOW, AirPlay/HomeKit, official streaming apps and the Store.
Alexa, Google Assistant, Sports Alert, Screen Share, Dashboard, Media Player and LG Input Hook tiles
are hidden from this launcher. LG marks the built-in apps as non-removable; they were not deleted
from the firmware. Input Hook's background service remains active for Home.

The Live TV menu entry is hidden; HDMI inputs and shared audio/video services remain available.
Unused `voiceinput`, `voiceconductor`, `miracast` and `contentminer` units are stopped. Runtime masks
are used where honored by this firmware. The voiceinput default unit has higher priority than its
runtime mask, so a reversible executable override also prevents it restarting. Alexa/Google adapters
and `sportsalarm` receive the same no-op bind mount. Original executable bytes remain on the read-only
firmware filesystem. No LG-domain advertising blocklist, DNS proxy or IPv6 change is installed.

The profile is reapplied in the background by our boot hook when
`/home/root/lg-tv-vibehack/debloat.enabled` exists. The early launcher uses a bounded shell launch
before waiting for the Node watcher; its log distinguishes a launch request from foreground success.

Restore the optional services and previous launcher entries over root SSH:

```sh
sh /home/root/lg-tv-vibehack/debloat.sh restore
node /home/root/lg-tv-vibehack/preferences-cleanup.js restore
node /home/root/lg-tv-vibehack/sync.js
```

Then reboot. Restore preserves unrelated settings such as wallpaper, weather and clock preferences.
Removing `debloat.enabled` and rebooting also clears the temporary masks and bind mounts. Backups and
ownership markers are in the launcher's `recovery/` and `debloat-state/` folders.

Voice suppression can slow Settings on some firmware. Settings, GFN, AirPlay and Store access were
physically checked after the initial service cleanup on this TV; recheck after any further change.
Life's Good Without Spying 0.11.1 was subsequently installed from the official GitHub release, with its checksum verified. It was opened, but protection remains off: no LGWS boot hook, domain sink or binary stubs were activated. Saved `domains.sdp=off` to preserve Store access and `voice.stop=off` to avoid overlapping voice suppression. Store blocking, ThinQ, LAN/UPnP blocking, DNS filtering and IPv6 disabling remain off. The existing launcher cleanup and Homebrew firmware-update block are unchanged. Before any future activation, review overlapping binary stubs with the existing cleanup rather than running both managers over the same targets. A private pre-install snapshot is in `.local/backups/before-lgws-install.tar`.

### Verified outcome on this TV

Local package 1.2.2, root persistence and Home were verified after multiple restarts.
The user observed automatic startup improve from about 30 to about 18 seconds after the HDMI/no-signal picture.
Settings opened instantly; GFN, AirPlay, Home and hidden tiles were confirmed after the final reboot.
Official Apple TV/YouTube playback and Store access passed. A real Store update download was not observed.
HomeKit services were retained, but a HomeKit automation was not separately tested.

LG's Alexa adapter can restart inside an existing native sandbox with its own cached executable.
The outer no-op bind mount does not fully suppress that sandboxed process on this firmware.
Alexa's tile remains hidden; the cleanup does not claim that every Alexa or shared IoT process is gone.
The tested configuration preserves shared networking for AirPlay/HomeKit.


### Glass appearance update (1.2.3)

Installed with the same app ID; TV inventory/preferences were restored by sync.js and the launcher
was confirmed foreground. The Home/startup integration was not modified. Before-update device
archive: `.local/backups/before-glass-tv-1.2.3.tar`; local appearance copy:
`.local/backups/before-glass-design-20261101-160113/`.
Browser checks passed: all icon assets loaded, favourites/grid navigation, Inputs placement,
4/6-column layouts, and cancelling an app rearrangement. App/TV JavaScript passes an ES5 parser.
Physical smoothness and Home-return verification for this appearance update are pending.

Version 1.2.4 hides favourites-row labels, including the focused tile; lower-grid focused labels remain visible. Installed and refreshed on the TV. The live preview confirms both behaviours.

Version 1.2.5 removes the sliding selection frame. Focus is indicated by the app card
enlarging and its shadow. Glass favourites shelf and lower-grid labels are retained.

Version 1.2.6 shortens the favourites shelf to thumbnail height plus 56px, leaving
28px padding above/below now that favourites labels are hidden.

Version 1.2.7 adds local SVG tiles for Browser, Apps and GeForce NOW, using the same
colour-gradient backgrounds as the favourites. Life’s Good Without Spying is hidden
from this launcher, remains installed and keeps its protection settings. Existing
TV preferences were backed up before adding its ID to settings.hiddenApps.

Version 1.2.8 hides the edit/pencil control and removes its remote focus stop. Hold OK
on an app to rearrange it; the existing saved column count and order are preserved.

### Measured reference and font updates (1.2.9–1.2.10)

The six-column reference layout uses 250x150 cards, 298.33px horizontal pitch,
30px card corners and a 1.22x focus scale. Shelf padding is 48px horizontally and
40px vertically, with a 58px radius. Its lower edge stays at y=1016; the next row
begins at y=1056. Saved column counts remain adaptive. Up from favourites reveals
inputs/network/wallpaper/settings; Down returns to apps. The clock has a decorative
generic avatar, not an account or profile-switching feature. The ad is omitted.

The glass texture is built once when the wallpaper loads, using a 32x18 sample
expanded to 384x216 and cached as a JPEG. It follows the wallpaper's cover crop;
focus changes only adjust its background position. Failure falls back to the
translucent gradient. The original device state is in
`.local/backups/before-reference-tv-1.2.9.tar`; prior local files are in
`.local/backups/before-reference-1.2.9/`. User reported the installed design looks great.

Inter is bundled locally under its OFL licence and is the primary font in 1.2.10.
Manrope/Lexend remain fallbacks. SF Pro is not bundled; user chose Inter after
reviewing Apple's download licence. System animation investigation is recorded in
[SYSTEM-ANIMATIONS.md](SYSTEM-ANIMATIONS.md).

### Abandoned native compositor experiment (1.2.11–1.2.12)

Launcher 1.2.11 briefly contained an off-by-default tile-origin transport for a
reversible TV compositor experiment. Version 1.2.12 removes that transport.
Earlier trials showed an overlapping splash animation; the revised test targets
only the actual app surface and reuses the original renderer. Physical tests remained inconsistent and the user requested abandoning this work.
All temporary compositor overrides were removed; LG's original animation is restored. No persistent animation startup hook has been added. See
[SYSTEM-ANIMATIONS.md](SYSTEM-ANIMATIONS.md) for activation, rollback, test evidence
and limitations. Inter, Home integration, saved preferences and the prior startup
scripts remain in place.

### Performance pass (1.2.13)

Returning Home restores focus immediately without replaying the staggered tile
entrance. Relaunch and visibility notifications within 500 ms are coalesced.
Hidden hero/frame updates were removed; disabled ambient glow exits before DOM
work. Shelf coordinates use existing layout geometry and are updated only when
the row offset changes. Tile shadows/rims stay static while focus scales.

Inventory checks run at most once concurrently, wait for 1.5 seconds without
input, and pause while hidden or rearranging/in a control panel. Rebuilding after
a change also waits for idle and retains the selected app by ID. Clock updates
skip hidden pages. Initial cold-page entrance remains.

Validation: ES5 parsing, preview arrows/grid/controls/long-press cancellation,
and `node scripts/check-idle-refresh.cjs` covering resume coalescing, deferred
refresh/rebuild, selection preservation and hidden-page suspension. Physical TV
smoothness is awaiting user comparison; no FPS improvement has been measured.
Private rollback: `.local/backups/before-performance-1.2.13.tar` and local source
copies under `.local/backups/before-performance-1.2.13/`.

### Home return (1.2.14)

User confirmed improved navigation in 1.2.13 but reported slow, piecemeal Home
rendering. Input Hook now sends explicit `{home:true,reload:false}` parameters.
The relaunch handler honors those before consulting retained parameters and
ignores a reload token already applied to the current page. Genuine new reload
requests remain supported. Initial tile stagger and fade were removed as well as
warm-return replay; Inter is preloaded.

`node scripts/check-home-resume.cjs` tests explicit Home, string event parameters,
stale install parameters, duplicate notifications and new reload requests. Idle
refresh regression tests still pass. Preview confirms only positional reorder
transitions on tile containers. Installed version and Home-script foreground
verified on TV; physical improvement remains pending. Backup:
`.local/backups/before-home-return-1.2.14.tar`.

### Clock reference (1.2.15)

Removed the decorative profile avatar. Clock uses a compact dark rounded pill,
subtle static rim and 36px gray Inter digits/AM-PM following the supplied reference.
The existing 12/24-hour preference remains supported.

Clock correction in 1.2.16: the full-screen reference establishes a smaller scale
(26px text, 58px pill interior) with a translucent 38%-opacity background instead
of the previous nearly opaque fill. Profile avatar remains removed.

1.2.17 lightens clock text to #dedede; 1.2.18 applies the same translucent
charcoal surface, rim and light icons to the hidden control strip. Focus retains
a subtle translucent highlight and scale; no animated blur or shadow added.

1.2.19 fixes the weather-enabled layout: the clock pill styles `#timeRow`,
not the enclosing `#leftBlock`. Weather is outside the pill as smaller,
right-aligned text with a bounded width. Always check both weather-enabled and
weather-disabled layouts; the TV preference can differ from the default preview.

### Quick Start+ wake integration

User enabled Quick Start+ and Home Auto Launch. `homewatch.js` now subscribes to
`luna://com.webos.service.tvpower/power/getPowerState` in addition to foreground
and inventory notifications. Only an observed Active Standby/Suspend/Power Off
followed by Active requests our launcher, with explicit home=true/reload=false.
Initial Active notifications, reconnects and screen-off/screensaver transitions
do not launch it. Failed requests retry at most twice and are cancelled by a new
standby transition. No periodic power polling, external Mac process or firmware
patch is involved. Existing cold-boot launch remains.

Validated with `node scripts/check-wake.cjs` and `node scripts/check-homewatch.cjs`.
TV subscription returned subscribed=true; restarted watcher logged power: Active.
Normal remote standby/wake timing and HDMI visibility await physical verification.
Backup: `.local/backups/before-wake-listener.tar`; restoring its homewatch.js and
restarting only the watcher removes this addition.

First physical remote cycle produced standby/suspend/Active notifications; launch
was requested 4 ms after Active and accepted ~2.1 s later. Foreground query then
confirmed the custom launcher. Visible startup delay/HDMI exposure still needs
the user's observation; API acceptance is not a frame-render measurement.

- Warm-wake physical check confirmed by user: custom launcher opens automatically about 6 seconds after picture appears, with LG Home briefly visible first. User reports much faster. Quick Start+ and Home Auto Launch remain enabled; wake listener remains active. Earlier ~18-second result was a cold boot and is not a controlled like-for-like benchmark.

1.2.20 response tuning: focused and unfocused card transforms use 140ms easing
without overshoot; stage movement is 220ms. Same-tile focus returns early unless
layout or focus needs restoring. Idle-refresh and Home-resume tests pass.
No additional TV services were disabled during this performance audit.

Control Centre 1.2.23 introduced app/tv-controls.js to issue fixed, validated root commands through Homebrew Channel. Volume uses com.webos.service.audio/master; sleep timer and sound output use settingsservice. Browser previews cannot write TV state. Standby and screen-off were explicit actions behind Cancel-first detail views. Bluetooth pairing uses LG Settings. The app tray stayed visible behind Control Centre with 15% dimming. Same-state mute/timer checks passed on this TV; physical checks of changed values, standby and screen-off were pending for that build.

The current source replaces the earlier read-only nearby Wi-Fi list with a
masked password prompt and explicit **Join** action. Known networks reuse a saved
TV profile; open networks need no password. Unsupported networks offer LG Wi-Fi
Settings. Connection requests use a direct service bridge, and the page clears
entered passwords without saving them to browser storage or sending them through
shell commands. Cancel/Back returns to the list; an already-submitted connection
may continue. See [Wi-Fi behavior and the narrow, reversible permission
policy](SETTINGS-OVERLAY.md#wi-fi-joining-in-the-current-source). This describes the
source update, not a new installation or completed physical connection test.

### Optimization pass (1.2.31)

Interrupted OK presses are cancelled safely, Control Centre interaction blocks
inventory refresh, and tile reordering uses transforms. The clock runs at minute
boundaries. Explicit transform caching keeps the stage and nearby cards ready for
animation; card caching stays bounded as the library grows. Wallpaper discovery
starts earlier, Inter uses complementary subsets,
and shelf textures are precomputed for bundled/newly uploaded photos. QR controls
load on demand with cancellation and retry handling.

Control Centre shows pending work, shares/caches reads, fetches sound information
in parallel and prevents duplicate changes. The watcher coalesces its launch
requests and cancels stale work; shared atomic publication avoids repeated icon
copies and separates settings from full inventory discovery. Phone changes to
wallpaper, dim and weather apply without reloading the launcher page.

`node scripts/check-launcher.cjs` runs the 19 active local regression suites.
Optional profiling is disabled by default. [PERFORMANCE.md](PERFORMANCE.md)
records the measured 1.2.30 baseline, test scope, asset regeneration requirements
and the distinction between browser timing and physical TV responsiveness.
The final installed TV repeat reduced the 95th-percentile animation callback
interval from 83.33 ms to 16.67 ms, with zero recorded long tasks versus 17 in
the controlled original-build run. The user also confirmed visibly smoother
animation. These are synthetic navigation measurements, not physical
input-to-photon or cold-boot timings; complete conditions are in the report.
