> Historical local-build report. This describes the original development TV,
> not a verified release of the shareable edition. Apple fonts/symbols and
> private backup files mentioned below are not included. Use [setup](SETUP.md)
> for current instructions and [sharing notes](PUBLIC-SHARING.md) for differences.

# Global Settings Control Centre

The current installed build is **1.0.20**, alongside Home **1.2.51**. It includes
[reference-matched icon/text proportions](CONTROL-PROPORTIONS.md), SF Pro, neutral
translucent surfaces with a 10% black layer on unselected main buttons and opaque
white primary text/icons. The floating shade is
darker and broader, the lists use their original compact height with a slim gray
scrollbar, and both views share submenu styling and Wi-Fi connection prompts.
All 91 checked packaged assets matched; 30 runtime files and saved TV settings
were preserved. See [the review follow-up](REVIEW-FIXES.md) for earlier fixes.

The rooted TV can run Control Centre as a separate transparent overlay, with
Settings key **139** opening it through LG Input Hook. Home key 773 is unchanged.
The overlay package is `com.gathin.tvcontrolcentre`; the existing Home package and
system Home adapter remain installed and are not replaced by this feature.

## Behavior

- On Home, Settings toggles Home's built-in Control Centre without launching the
  separate overlay. Elsewhere it toggles the floating panel over the current app.
  A focused floating panel is dismissed first even if Home is behind it.
- Back returns from a submenu to the main controls, then closes the overlay.
- The underlying app is not relaunched when the overlay closes.
- The gear still opens LG Settings. Inputs switch only when explicitly selected.
- The wallpaper shortcut uses Home's existing phone page. Hidden apps offers
  **Go to Home to manage hidden apps**, keeping Home's saved preferences in Home.
- Home or a new fullscreen app dismisses the overlay. The panel never reopens
  itself after these transitions.
- Floating main controls use neutral 12% white translucent surfaces with a 10%
  black layer on unselected buttons, opaque white
  primary labels and icons, fine rims and a sharp inset highlight. Selected
  controls use a flat white surface with dark text. Home and the floating panel
  share the same submenu surfaces and selection treatment. The material is
  static; it does not sample or blur the playing video's pixels.
- Installed Home 1.2.51 adds 3px backdrop blur only to unselected main controls
  while its built-in panel is open. This rule lives in Home's `style.css`, which
  the floating overlay neither loads nor packages. Selected controls and shared
  submenus remain unfiltered.
- The floating panel has a black radial shade centered on the top-right corner,
  with a 1100 by 1050px footprint. Its opacity is 80% at the corner, 60% at the
  50% stop and 28% at the 78% stop, fading to transparent at the outer edge.
  The shade is drawn once with no filters or screen-wide dimming; outside the
  corner shade and controls, the overlay remains transparent.
- Wi-Fi and the other shared submenu lists retain their compact 665px maximum
  height. Longer lists scroll with a slim, flat gray scrollbar and keep the
  selected row visible during remote navigation.

Overlay 1.0.8 reduces passive work: it signals readiness before the network,
audio and VPN startup reads, which are deferred by 250ms and cancelled if the
panel is dismissed first. Stable VPN status is refreshed 30 seconds after the
last response on the main panel and every 10 seconds in its submenu. Opening
VPN refreshes immediately; changes retain a one-second follow-up and a tunnel
waiting for a handshake retains five-second checks. Returning to the main panel
reuses the recent in-memory status instead of launching another helper. Home
keeps its existing polling policy. Buttons use a single sharp inset highlight,
removing their blurred inner and outer shadows while retaining frost, selection
contrast and the corner gradient. Animation timing is unchanged.

Overlay 1.0.9 retains its page between openings using `PalmSystem.keepAlive(true)`
and `deactivate()`, with `keepAlive:true` in the floating launch request. Back and
Settings release native focus; the next explicit request uses `activate()` when
needed and reopens the existing controls. Clock/network subscriptions, scans and
passive polling stop while hidden. Already-issued one-shot actions can finish so
their pending locks clear normally, without restarting background polling.
Ordinary close remains the fallback when native retention is unavailable or a
requested hide does not change visibility within one second. The TV can still
evict the app under memory pressure, so a later opening may require a cold start.

On this firmware, native visibility can arrive before `webOSRelaunch` despite
`handlesRelaunch:true`. A dormant surface remains visually empty and allows 250ms
for that request; an unrequested reveal is deactivated again. Repeated tokens
cannot toggle twice. No new boot hook, polling daemon or memory-policy change is
used to keep the app resident.

The manifest uses `defaultWindowType: overlay`, `transparent: true`, no splash,
and no `playVideo` flag. On this firmware, marking an overlay as playing video
would minimize the underlying app. The overlay takes remote focus while the
original app stays fullscreen. Special system windows or apps that explicitly
block overlays are outside the guarantee; this does not bypass that policy.

Home 1.2.42 and overlay 1.0.8 use the same 44px top and right inset for the
header. The menu begins at 126px, keeping a 22px gap below the 60px header;
submenus and the wallpaper panel retain that alignment.

The controls share `app/control-centre.js`, CSS, icons and the TV/VPN services with
Home. `overlay.js` supplies a small standalone host without Home's wallpaper,
tray or local-storage preferences. It keeps outgoing launch requests alive until
acknowledgment, cancels pending work on dismissal, and retains VPN request bridges
longer than their 45-second operation timeout.

<a id="wi-fi-joining-in-the-current-source"></a>

## Wi-Fi joining

The shared Wi-Fi prompt and scoped permission policy were deployed with
Home **1.2.49** and overlay **1.0.18**.

Home and the floating panel share a Wi-Fi connection prompt. Selecting a nearby
network opens the prompt; only **Join** submits a connection. A matching saved
profile reuses the TV's stored connection without reading its password into the
page. New WPA/WPA2 personal (`psk`) and WEP networks show a masked password field;
open networks show a confirmation without a password. Unsupported security types,
hidden networks without an SSID, and unavailable permissions offer **Open LG Wi-Fi
Settings** instead. The connected network remains marked in the list.

Cancel or Back returns to the network list and clears the password field. A
submitted connection can still finish after leaving the prompt; a bounded pending
guard prevents another submission for up to 45 seconds. Saved-profile reads time
out after nine seconds. Leaving the panel releases the page's pending callbacks,
and late replies cannot reopen it. Browser previews cannot connect to a network.

`app/wifi-controls.js` sends connection requests directly through
`PalmServiceBridge`. Passwords are not passed through Homebrew shell commands,
command arguments, logs or browser storage. Temporary request fields are cleared
after serialization, and service errors are replaced with generic UI messages.
Saved-profile results retain only the SSID, profile ID and security types.

### Exact Wi-Fi policy and upgrades

The connection prompt needs two additional LS2 methods:
`com.webos.service.wifi/connect` and
`com.webos.service.wifi/getprofilelist`. The shared System Home permission manager
defines the private custom group
`io.github.lgtv.vibehack.systemhome.web.wifi.connect` for exactly these methods.
It grants that group only to the web-client names `com.webos.app.home-*`,
`com.gathin.tvhome-*` and `com.gathin.tvcontrolcentre-*`. It does not grant the
general `networking`, `private` or `all` groups.

Native Home keeps the existing separate `appId`-bound web role and its `public`
permission. The installed fallback Home and overlay retain their existing
`appId`-bound roles and public permissions; the new client entries add only the
custom group. LG's stock native executable role and the WebAppMgr container role
are unchanged. No other app identity receives the new group.

Deploy the current `tv/system-home/permissions.js` to its existing runtime path,
then explicitly install or upgrade the policy before opening the new prompt:

```sh
node /home/root/lg-tv-vibehack/system-home/permissions.js install
node /home/root/lg-tv-vibehack/system-home/permissions.js status
```

The policy files and ownership record remain under
`/tmp/lg-tv-system-home/ls2`. The existing System Home startup/arm path recreates
them after reboot; its rollback path removes them. An already-active Home
startup is a no-op, so deployment uses the explicit `install` command above.
The new manager recognizes the exact public-only revision and unloads its cached
manifest before publishing the new one. Manifest revision `1.1.0` includes the
exact-method API file; ownership format 2 records interrupted upgrades so either
installation or removal can resume. Foreign or modified files are refused, and
failed bus removal retains the owned files for recovery.

Freshly launch the affected pages after installation so their registered clients
receive the new permissions. A read-only check can query the bus's `isCallAllowed`
method using their actual registered sender names: the two methods above must be
allowed, while `wifi/deleteprofile` and `wifi/setstate` remain denied. These four
checks passed for fresh native Home and floating-panel clients after deployment.
For an unrelated registered app, query `queryServicePermissions` and check that
the custom group is absent; an app with a pre-existing `private` grant may already
have access to the same methods. The checks do not call Wi-Fi connection methods
or expose saved profiles. A physical network connection was not attempted as
part of this deployment validation.

## Build and check

```sh
node scripts/check-overlay.cjs
node scripts/check-control-centre.cjs
node scripts/check-wifi-controls.cjs
node scripts/check-system-home-permissions.cjs
node scripts/check-system-home-control.cjs
node scripts/check-settings-binding.cjs
node scripts/check-home-settings.cjs
node scripts/build-control-centre.cjs
ares-package build/control-centre/app -o build/control-centre
```

The build script copies an explicit set of app assets and writes a separate
manifest. Production builds disable inspection. `--inspectable` is for a bounded
device trial only. Do not package `.local/` or the workspace itself.

Install the IPK through the existing root package-install path; Developer Mode
must not be reinstalled on the rooted TV. Copy `tv/control-centre/` to
`/home/root/lg-tv-vibehack/control-centre/`, make its shell scripts executable,
and use its controller:

```sh
sh /home/root/lg-tv-vibehack/control-centre/control.sh check
sh /home/root/lg-tv-vibehack/control-centre/control.sh arm
sh /home/root/lg-tv-vibehack/control-centre/control.sh status
sh /home/root/lg-tv-vibehack/control-centre/control.sh confirm
```

`arm` saves the original key139 action and starts a ten-minute recovery guard.
The wrapper also enforces the trial deadline after a reboot. `confirm` keeps
the mapping through Input Hook's existing startup mechanism; there is no new
boot hook. A rejected or timed-out overlay launch falls back to LG Settings.
Normal presses use a SHA-256 validation cache covering the key map, recovery
snapshot, overlay manifest/entrypoint and optional Home routing files. A bounded
focused-window query selects Home only when its exact app ID owns focus. Native
Home receives a validated WAM request directly, so the native adapter needs no
restart or parameter changes; fallback Home uses the normal application launch
API. Unique request tokens prevent duplicate relaunch events from toggling twice.
Home request templates are generated during validation and checked by hash on
warm presses; those presses do not start Node. Changed or missing data triggers full
validation; expiry still restores the trial binding. Cache write failure does not
reject an otherwise fully validated launch. No cache text is executed as shell.

## Recovery

```sh
sh /home/root/lg-tv-vibehack/control-centre/control.sh restore
```

Restoration changes only the owned Settings binding, preserves all other keys,
and will not overwrite a newer binding installed elsewhere. Original state is
saved under the helper's `recovery/` directory. A private pre-change archive is
in `.local/control-centre/before-settings-overlay.tar.gz`.

The Settings-binding restore does not remove the shared System Home permission
policy. Full System Home rollback uses its deployed permission manager to unload
the policy after restoring the fallback launcher. When reverting to the older
public-only `permissions.js`, first run **the new manager's** `remove` command:

```sh
node /home/root/lg-tv-vibehack/system-home/permissions.js remove
```

Wait for confirmed removal before restoring the older module from the verified
backup, then run that module's `install` command to restore Home's public-only
web role and freshly launch the affected pages. Replacing the module first would
leave older code unable to recognize the new policy files. If removal fails,
retain the new manager and its ownership files and retry; do not delete files
while the bus may still hold the manifest.

## Device evidence — 2 November 2026

The first installed trial rendered with all icons and a transparent background.
The user confirmed it appeared over Netflix and that video continued playing.
Window-manager queries showed Netflix's original card process alongside
`com.gathin.tvcontrolcentre` as `_WEBOS_WINDOW_TYPE_OVERLAY`.

Read requests issued inside the actual overlay succeeded for network status,
sound output and VPN status. Sound submenu navigation and Back to the main panel
passed. Back from the main panel removed the overlay and returned focus to the
same Netflix process, without relaunching Netflix.

The user confirmed the physical Settings button opens the panel and reported a
delay of a few seconds. On-device timing isolated **2.50 seconds** in the original
per-press Node validation. Native validation of the same four files took about
**10 ms**; the optimized wrapper's complete launch request took **0.16 seconds**.
Two subsequent system logs measured about **1.72 and 1.83 seconds** from the app
manager's launch event to the compositor's visible event. These are device-event
timings, not a guaranteed remote-to-first-frame time.

The mapping is confirmed persistently and the final frosted package has
inspection disabled. Installed CSS/JavaScript hashes match the IPK. Existing
Home app code, system Home adapter and saved settings retained their pre-change
hashes. There is no extra compositor patch or keep-alive experiment.

The user confirmed the speed improvement and improved readability of the frost.
At their request, a temporary 6px CSS `backdrop-filter` was tried on unselected
buttons with a 90-second automatic removal timer. Chromium accepted the property,
but captured button pixels were identical, and the user reported a **black
background** behind Control Centre. The experiment failed the transparency check.
The overlay was closed and the known working, non-inspectable frosted package
reinstalled, then its fast validation cache refreshed. No blur rule was saved to
the floating source or production package.

On 3 November 2026, the user accepted a temporary **3px Home-only** trial as
looking correct and feeling smooth. Home renders its wallpaper within the same
page. Home 1.2.51 was subsequently installed after reconnecting to the TV; its blur
affects only open, unselected main controls, with no opacity or layout change.

A separate **3px floating-panel** trial was then rejected: the user reported
black backgrounds on all buttons except Settings, and clarified that Settings
was not selected. The original overlay
entrypoint was restored, the temporary script removed and the panel closed;
Netflix focus was confirmed. Overlay 1.0.19 remains without live blur. The trial
does not establish whether the failure came from backdrop sampling or native
surface composition, and reducing the radius did not resolve the visual defect.
Neither trial produced an FPS, GPU or physical input-latency benchmark. Private
records are in `.local/home-blur-trial/` and `.local/floating-blur-trial/`.

A follow-up diagnostic captured 10 of 11 planned phases with the buttons held
at fixed grid coordinates. Reversing Wallpaper and Settings in DOM order moved
the black interior from Wallpaper to Settings. The last filtered sibling kept
its unblurred interior, and single-button phases did not blur their sampled
interiors. Settings was not a working-blur exception. With stripes drawn inside
the overlay itself, the earlier filtered sibling did blur: interior pixel-value
standard deviation fell from 34.48 to 0.49 for Wallpaper, and from 33.84 to 0.39
for Settings after reversal. The last filtered sibling retained sharp stripes.
The earlier sibling instead became black over the separate Home surface.

These observations identify an order-dependent rendering failure in this setup,
not its engine-internal cause or a universal webOS limitation. The first
diagnostic attempt stopped after its baseline when the overlay hid, despite the
user reporting no input. The follow-up hid before `pattern-all`; the collector
refused the final capture because the overlay lacked focus. Both attempts were
rolled back, temporary scripts removed and Home focus confirmed. No FPS
benchmark was run. See [the diagnostic detail](PERFORMANCE.md#floating-diagnostic-follow-up)
and `.local/floating-blur-diagnostic/analysis.json` with its phase JSON/PNG files
under `results/`. Production overlay 1.0.19 still has no live blur.

A later frozen-snapshot diagnostic completed all three phases and restored its
temporary files. Ordinary `filter: blur(3px)` on a captured Home image worked
inside all eight sampled button interiors without black patches. Outside the
clips, their one-pixel antialias boundary and the changing diagnostic label,
all 1,930,659 compared pixels were identical; text, icons and the selected
control retained their normal rendering. The source screenshot took **1,860 ms**
and produced **2,612,440 bytes**; the page's image load event arrived after
**57 ms**, which does not isolate decoding from loading. The image would freeze
the background, and the trial did not test moving or protected video or measure
FPS. See [the measurements](PERFORMANCE.md#frozen-screenshot-and-native-alternatives)
and `.local/floating-alternatives/frozen/analysis.json`.

A separate native-blur surface worked alone, but coexistence with the web
overlay and production integration remain unproven. This is not a universal
webOS limitation. The selected fallback is the user-authorized **10% black
layer over the existing 12% white material on unselected main controls**.
Selected controls, labels, icons, rims and other UI retain their existing
treatment. Overlay **1.0.20** is installed with that static material: installation
returned status 30, all 91 checked package assets matched, and 30 runtime files
and saved settings were preserved. A native screenshot confirmed approximately
10% darker background-only samples on all eight unselected controls. The panel
closed back to Home, and the requested shutdown reached Active Standby. The final
deployment package is recorded in
`.local/floating-alternatives/deploy/package-metadata.json`; the earlier
`fallback/` staging package is retained only for comparison. Home 1.2.51 and
its accepted 3px same-page blur are unchanged.

Home 1.2.51 installation returned success status 30. Verification matched all
91 checked package assets, including unchanged overlay 1.0.19, preserved 30
runtime files and saved settings, and found no temporary trial scripts. The
deployment record is `.local/releases/1.2.51/deployment-result.json`.

Local tests cover toggle tokens, Back hierarchy, acknowledged external launches,
failed launches, wallpaper return, hidden/preload lifecycle, delayed VPN replies,
selective key recovery, foreign changes, durable trial expiry and launch fallback.
Other streaming apps, HDMI, full reboot and protected system screens require
their own physical checks; Netflix's result does not establish all-app coverage.

References: [webOS Homebrew overlay manifest documentation](https://www.webosbrew.org/pages/appinfojson)
and [LG Input Hook button IDs](https://github.com/Simon34545/lginputhook/blob/main/Button%20IDs.md).

Home-aware routing was installed with Home 1.2.42. A real Settings-helper request
was accepted by native Home in about 0.15 seconds; surface state showed only
Home, without a floating overlay. Browser tests verified Home open/close, duplicate
requests, expanded-drawer header visibility, submenu dismissal and Back without
reloading the page. The physical remote result for this Home-specific change
has not yet been confirmed by the user.

After 1.0.8, the user reported smoother interaction but roughly five seconds to
open. Two physical Settings events reached the app manager in 0.273 and 0.276
seconds, followed by 7.008 and 6.098 seconds to the compositor's visible event.
A bounded instrumented trial measured 3.035 seconds from the app-manager launch
to page navigation start, then 1.135 seconds to finish the page's startup and
readiness signal. Its first animation callback ran at 1.191 seconds and its
second at 1.550 seconds after navigation; launch-to-visible was 4.765 seconds.
The TV was heavily loaded and using swap while Netflix played. These are
individual observations under load, not a steady-state benchmark or proof of
one specific bottleneck. They show that most of the measured opening delay
precedes page startup; further button styling changes cannot address that part.

The temporary instrumentation was removed by reinstalling production 1.0.8.
Inspection is disabled, installed CSS/JavaScript hashes match that IPK, and the
Settings validation cache was refreshed. No additional startup speedup or
keep-alive behavior was introduced in this diagnostic pass. The private timing
record is `.local/control-centre/startup-measurement.json`.

The user subsequently authorized retention. An initial diagnostic page left
native focus with the overlay after its controls closed; it was closed through
the app manager and Netflix focus was verified before proceeding. The final
lifecycle implementation includes both the visibility/relaunch ordering fix and
the bounded hide fallback described above. Three guarded device cycles reused
the exact same page time origin, returned focus to Netflix after every hide,
and kept the same Netflix process. Measured wall times including SSH, inspector
and focus-query overhead were 5.644s for the cold opening and 1.845/1.497s for
the two retained openings; these are not physical-remote latency benchmarks.
The production 1.0.9 package disables inspection and its installed CSS/JS/helper
hashes match the release. Private results are in
`.local/control-centre/retention-live-result.json` and
`.local/control-centre/retention-installed-result.json`. The rollback package is
`build/control-centre/com.gathin.tvcontrolcentre_1.0.8_all.ipk`, with the previous
installed helper in `.local/control-centre/before-retention-toggle.sh`.

The 1.0.8 production package was installed and its CSS/JavaScript hashes matched
the built IPK. Regression tests verify startup cancellation, passive polling
intervals and immediate explicit actions. Browser checks verify transparency,
navigation and absence of page errors. Netflix retained process7396 across
installation. No TV frame-rate improvement is claimed until the user tries it.

Final Home 1.2.50/overlay 1.0.19 verification passed all nine live permission
checks, preserved saved settings and returned focus to Netflix. The private
result is in `.local/releases/1.2.50/wifi-policy-result.json`. A physical network
connection was not attempted. The [webOS Wi-Fi API reference](https://www.webosose.org/docs/reference/ls2-api/com-webos-service-wifi/#connect)
describes saved-profile connections; this implementation uses the profile ID
without retrieving its password.
