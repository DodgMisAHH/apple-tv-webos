> Historical local-build report. This describes the original development TV,
> not a verified release of the shareable edition. Apple fonts/symbols and
> private backup files mentioned below are not included. Use [setup](SETUP.md)
> for current instructions and [sharing notes](PUBLIC-SHARING.md) for differences.

# System Home integration

Status: **accepted on the verified TV, with persistent startup enabled.** The
user confirmed working Home and app tiles, then confirmed that normal remote
standby/wake returns promptly and works. Page-originated service checks, live
rollback and persistent startup after a full system reboot passed. A full reboot
still shows HDMI 1 before the launcher appears about 20 seconds later; this is
a known limitation of that restart path, separate from normal Quick Start+ wake.

This work targets the rooted webOS 6.5.3 / firmware 03.53.45 TV previously
investigated in this repository. It is firmware specific. The controller checks
the exact stock executable and app manifest before mounting a replacement; it
must reject other firmware instead of assuming compatibility.

## Architecture

`tv/system-home/` contains a native lifecycle adapter for the existing web UI:

1. `control.sh` temporarily bind-mounts `entrypoint.sh` over
   `/usr/bin/com.webos.app.home`. The original executable remains on the
   read-only filesystem. No firmware image is flashed and no stock executable
   bytes are overwritten.
2. webOS's application manager still sees LG's original native Home app
   registration. Starting that executable invokes the Node adapter `home.js`.
3. The adapter attempts a native lifecycle subscription with the application
   manager and launches the UI through `com.palm.webappmanager/launchApp`.
   `state.js` creates a web app descriptor with ID `com.webos.app.home` and
   `folderPath` pointing to the existing optimized `com.gathin.tvhome` app.
   The web window currently uses `defaultWindowType: card`.
4. Home relaunches are handled by the adapter. Preload requests register the
   adapter without displaying Home. Duplicate starts notify an existing owned
   runtime rather than creating another launcher instance. Requests and retries
   are bounded, and removing the activation marker stops the adapter.
5. `startup-guard.js` observes the application manager's lifecycle events. If
   Home interrupts a cold app launch after its splash and process launch but
   before it reaches the foreground, the adapter sends one `closeByAppId` for
   that app. This prevents its late window from replacing Home. Apps already in
   the foreground, warm resumes, preloads, settings notifications and adapter
   startup do not trigger cancellation. There is no repeated close or Home
   enforcement loop; a subsequent app selection remains allowed.

This makes the existing web interface the target of the system Home executable;
it does not rewrite the UI in native rendering code. The original application
package remains installed as a fallback.

The startup guard keeps at most 32 candidates, expiring after 30 seconds, and
discards them if its event subscription is lost. Observation reconnects at most
three times. A splash without a process-launch event is deliberately discarded
when Home is pressed: SAM does not expose a public request identifier or a
reliable cancellation API for that earlier stage, so closing the app later could
abort a new selection of the same app. That very early interval is outside this
guard's coverage.

Duplicate Home activation uses `SIGUSR2`. Duplicate settings publication uses
`SIGWINCH` plus the validated settings file; missing or expired settings never
become a Home action. `SIGUSR1` is avoided because Node reserves it for debugging.

The runtime marker `/tmp/lg-tv-system-home.active` coordinates the legacy
integration. While it exists, `homewatch.js` suppresses old Home, startup and wake
redirects, including already queued retries. It continues watching app inventory.
`early-launch.sh` exits without launching the old identity. `golauncher.sh` and
wallpaper notifications address `com.webos.app.home` while active and return to
`com.gathin.tvhome` after rollback. All inventory, icons, wallpaper and settings
are still published into the original app directory; there is only one
publication destination.

The adapter design was informed by CleanYourTV. Attribution and the upstream
license link are recorded in [`tv/system-home/NOTICE`](../tv/system-home/NOTICE).

## Validation and resolved permissions issue

The first physical trial produced a normally rendered launcher. Inspection
confirmed the page's `com.webos.app.home` identity and the presence of
`PalmServiceBridge`. However, browser-originated Luna calls remained silent and
application tiles did not open apps.

The investigation identified a permission mismatch: stock Home is registered as
a native executable, whereas its replacement page needs authorization as a web
application. Having the native role or a `PalmServiceBridge` object does not
establish that the new web identity can call services. After the permission
correction and automated checks below, the user confirmed that the physical Home
button and app tiles both work.

After installing the permission correction, CDP checks executed in the actual
`com.webos.app.home` page established:

- The network service returned successfully.
- `TVControls` read sound output `tv_speaker`, volume `15` and unmuted state
  through the existing Homebrew `exec` service path. These were reads, not tests
  of changed volume or output settings.
- An application launch issued from the Home page returned success for YouTube;
  a separate root foreground query then verified `youtube.leanback.v4`.

A direct foreground query from the page was denied by the public permission
policy, as expected. That query is not part of the launcher's app-opening path;
the successful root query above was independent verification. The automated
checks establish working page service calls and an actual app transition. The
subsequent user confirmation supplies the physical Home-button and tile-selection
check. Reboot and normal wake were verified separately, as recorded below;
extended HDMI and remaining Control Centre behavior are outside these checks.

`permissions.js` creates a separate web-client role, client permissions, manifest
and ownership record under `/tmp/lg-tv-system-home/ls2`. The role is associated
with app ID `com.webos.app.home` and names `com.webos.app.home-*`; client
permissions assign the `public` group. LG's original native executable role is
left intact. The controller installs this role after the rollback guard starts
and before suspending the Home key or mounting the entrypoint.

The module registers its manifest with the bus's `addOneManifest` method and
unloads it with `removeOneManifest`. Each request has a bounded `luna-send` wait
and child-process timeout. It does not write a manifest into the persistent
`/var` service directories or rescan all system services. Cleanup verifies exact
owned contents and retains its files/ownership record if the bus does not
acknowledge removal. Rollback restores the previous launcher before attempting
permission cleanup, and retains the lease if cleanup needs a retry.

The test must exercise calls originating in the replacement page. Root SSH
`luna-send` calls do not test that page's caller identity. Required checks include
application launch, network status and the Homebrew service path used by Control
Centre. Permission changes must be tracked and reversible, with unrelated roles
and bindings preserved.

`home.js` writes `shown` when WebAppMgr accepts its launch request. That file is
an acknowledgement of the launch transport, not proof of working app controls,
visible pixels, or successful physical rendering. Confirmation and startup now
also require a live owned adapter and a Luna bus connection named exactly
`com.webos.app.home-<digits>` whose executable is `/usr/bin/WebAppMgr`. The query
uses the TV's BusyBox syntax, `timeout -t 5 /usr/sbin/ls-monitor -l`; stock native Home and the old launcher
do not satisfy it. This establishes that the replacement web page registered on
the bus. It does not prove authorization for every service endpoint. Manual
behavior is checked separately; remaining coverage is listed below.

## Preserving the optimized launcher

The accepted integration was initially validated with the installed 1.2.31
assets. The current installed launcher is 1.2.39, retaining Move/Hide, restoration,
stepwise Back and a permanent round Hidden apps control. The user confirmed the
menu and Back behavior on 1.2.33. Pointer isolation in 1.2.35 did not resolve their
quick-tap movement report. Version 1.2.36 removes the held tile's position transition
while neighboring tiles still animate; the user reported an improvement.
Version 1.2.38 retains the 420 ms drawer slide, aligns the prepared texture during
the transition and prevents hover from passing tiles from reversing a collapse.
The user confirmed smooth closing on the TV. The 1.2.38 files match the package and native Home
foreground/web-bus registration passed after refresh. The 1.2.32 moving tray
texture is retained using synchronized transforms in 1.2.38. Its earlier tracking
passed checks in the actual `com.webos.app.home` page and
again after a page reload; the saved six-column layout and app order were retained.
The native Home helpers remain unchanged and startup remains enabled. No new
full TV reboot or frame-rate test was run for 1.2.32. Both identities continue to
use the same app directory. The update retains transform caching, bounded card layers,
clock scheduling, input handling, fonts, prepared wallpaper textures and normal
profiling behavior described in [`PERFORMANCE.md`](PERFORMANCE.md). Tracking the
texture adds no continuous blur computation or JavaScript frame loop.

Version 1.2.39 releases Home input after Screen Off when the firmware has already
woken the screen (`Active/-102`), and also handles failed/timed-out wake requests
and late callbacks. A guarded real screen-off/wake cycle in the native Home page
verified that navigation and Back still work after that response. Normal
non-inspectable configuration was restored; the native adapter, settings and
startup files retained their pre-update checksums. Physical remote confirmation
of this fix remains pending.

Shared files under `/home/root/lg-tv-vibehack` retain the wallpaper and TV
preferences. The new Home identity has separate browser storage. The saved
`tvhome.columns` value of `6` and `tvhome.order` were copied from the original
identity only where the new identity had no value, then the Home page was
reloaded. Existing values in the new identity were not overwritten. Keep the
original package and its storage during the experiment, and verify the visible
layout during the physical check.

There is no controlled startup or wake speedup comparison for this integration
yet. The full-reboot observation below records a known delay. The
1.2.31 frame measurements belong to the previous launcher performance work and
must not be presented as system Home results.

## Full reboot and normal wake

Persistent startup was verified after a full system reboot. Uptime reset from
18,194 seconds to 45 seconds, and fresh boot-hook logs showed automatic role
installation and replacement activation. The boot ID remained unchanged on this
TV and was not used as evidence of a restart.

The recorded sequence on 1 November 2026 (Europe/Lisbon) was:

| Time | Observation |
| --- | --- |
| 20:45:29 | Controller stopped the verified original Home executable |
| 20:45:32 | Controller reported the replacement executable mounted |
| 20:45:36 | WebAppMgr accepted the adapter's Home launch |
| 20:45:40 | Startup confirmed the Home web bus connection |

A root foreground query then identified `com.webos.app.home`. The user observed
HDMI 1 first and approximately 20 seconds until the launcher appeared. This is
a known limitation of the current full-reboot path, not a measured warm-wake
result or evidence that Quick Start+ is ineffective.

The subsequent normal physical remote power-off, approximately ten-second
standby, and remote power-on check **passed**. The user reported: “Yes, it appears
promptly and works.” The power log recorded Active Standby at 20:47:11.951,
Suspend at 20:47:17.480, and Active at 20:47:25.620. The existing owned runtime
(`1996`) was notified, and WebAppMgr accepted Home at 20:47:27.906. A foreground
query identified `com.webos.app.home`, with persistent startup still enabled and
confirmed.

The interval from Active to WebAppMgr acceptance was about **2.286 seconds**.
That is service-request acceptance timing, not a measurement of the first visible
frame. The user's prompt-and-working observation supplies the physical result.
No additional cold-start optimization was made as part of this accepted setup.

## Controller and recovery

The deployed controller is:

```sh
sh /home/root/lg-tv-vibehack/system-home/control.sh status
sh /home/root/lg-tv-vibehack/system-home/control.sh check
```

`check` requires root, the installed launcher, the adapter files, and matching
stock firmware hashes. The expected SHA-256 values are stored in `control.sh`:

| File | Expected SHA-256 |
| --- | --- |
| `/usr/bin/com.webos.app.home` | `ab970eea3cec09666a0c5e297412571f0622c061894c0243c5ca153ad7b02356` |
| `/usr/palm/applications/com.webos.app.home/appinfo.json` | `6a98f9edc86aa06664f8aa5f6d9b5e60ed7caee1d1fbe4722459ac72f30b72db` |

`arm` starts a separate rollback guard before changing the Home binding or
mounting the executable. The temporary trial has a 600-second lease. The guard
also checks the display and application-manager services after its initial grace
period. Operations use `flock`; stale guards recheck their lease token under the
lock before rolling anything back.

The existing Home Input Hook binding is saved persistently at
`/home/root/lg-tv-vibehack/system-home/recovery/home-key.json`, then removed only
if it belongs to this launcher's `golauncher.sh`. Other bindings are preserved.
The snapshot survives reboot and repeated startup. Restoration preserves a new
Home binding installed by another integration instead of overwriting it.
If a later boot rejects the firmware hashes or finds missing launcher files,
startup restores that saved binding and disables itself without unmounting an
unsupported executable. Running startup again while the owned replacement is
active leaves its current configuration and trial lease intact.

To end a trial and restore the old launcher integration:

```sh
sh /home/root/lg-tv-vibehack/system-home/control.sh rollback
```

To also remove this integration's owned startup hook:

```sh
sh /home/root/lg-tv-vibehack/system-home/control.sh disable
```

Rollback unmounts only a replacement whose inode/device identity matches the
owned entrypoint. It verifies restored stock bytes, stops the owned runtime,
restores the saved Home binding and reopens `com.gathin.tvhome`. A foreign mount
is not removed. Failed unmounting retains the activation and rollback lease for
recovery; failed key restoration retains its snapshot. Process termination is
limited to the verified runtime or the stock Home executable with the expected
hash; there are no broad process-name kills.

An ordinary reboot clears temporary mounts and `/tmp` activation state. It does
not by itself restore the persistent Input Hook key file. Keep the recovery
snapshot and use `rollback` or `disable` to complete restoration. With persistent
startup enabled, the boot hook attempts activation again. If startup rejects
unsupported firmware or missing files before activation, it disables future
startup and restores the saved Home key without unmounting the unsupported
target. Repeated startup on an already owned active replacement preserves that
trial and configuration.

Live rollback was exercised successfully before enabling persistence. Both stock
executable and manifest hashes matched; key `773` was restored; the original
`com.gathin.tvhome` launcher became foreground. The bus accepted explicit manifest
removal, and `permissions.js status` reported `owned: false` with all managed
files absent. The replacement was then armed again, verified as Home foreground
with its web bus connection, confirmed, and enabled for startup.

`confirm` cancels the lease for the current boot after checking the Home
foreground identity, a live owned runtime, a `shown` acknowledgement and the
replacement page's WebAppMgr bus connection.
`enable` additionally requires that confirmation and writes the startup hook
`/var/lib/webosbrew/init.d/00-lg-tv-system-home`. **Home-button and tile interaction,
normal standby/wake, live rollback, and persistent startup after a full reboot
passed.** The startup hook is intended to run
before the existing `00-lg-tv-vibehack` integration.

Runtime logs, guard logs and acknowledgements are under
`/tmp/lg-tv-system-home/`. The startup wrapper logs to
`/tmp/lg-tv-system-home-boot.log`. Keep private firmware snapshots and existing
root/SSH recovery files; do not reinstall Developer Mode as a recovery step.

## Validation matrix

| Check | Required result | Current evidence |
| --- | --- | --- |
| Replacement display and identity | Existing launcher renders under `com.webos.app.home` | Observed in the first trial |
| Tile activation | Physical tile selection opens apps | User confirmed working after the permission correction; page-originated YouTube launch independently verified |
| Page-originated Luna access | App launch and network calls receive valid responses | Passed automated checks in the Home page after the permission correction |
| Home button | Home opens the replacement launcher | User confirmed working after the permission correction |
| Home during cold startup | An interrupted app does not subsequently replace Home | User confirmed pressing Home during the app logo stays on the launcher. Installed guard also tested with YouTube and Apple TV; Apple TV stopped before foreground, and YouTube ended on Home after a brief boundary transition. Reopening Apple TV then returning Home preserved its running process. Splash-only prelaunch interval excluded as described above |
| Extended Home behavior | Repeated Home and return from HDMI remain usable | Pending separate checks |
| Control Centre | Reads and selected volume/mute/output actions work through the existing service path | Sound-output, volume and mute-state reads passed; physical changes pending |
| LG settings and overlays | Settings, inputs, notifications and Back remain usable | Pending |
| Existing preferences | App order, columns, wallpaper and weather remain correct | Missing Home storage seeded with saved order and six columns; visible layout check pending |
| Phone settings and installed apps | Wallpaper changes apply once; inventory updates continue | Local integration tests pass; physical check pending |
| Foreground isolation | Preload, reconnects and background work do not steal playback | Local runtime tests pass; physical check pending |
| Full system reboot | Boot hook restores the replacement and its web permissions automatically | Passed: uptime reset, fresh startup logs and Home foreground; user observed HDMI 1 followed by about 20 seconds before launcher |
| Normal standby/wake | Quick Start+ wake returns to the launcher; timing recorded separately | User confirmed it appears promptly and works; existing runtime reused, Home foreground verified; approximately 2.286 seconds from Active to service acceptance, not visible-frame timing |
| Manual recovery | Rollback restores stock executable, prior Home binding and old launcher; temporary permissions unload | Passed live: both hashes matched, key restored, old launcher foreground, manifest removal accepted and all owned permission files absent |
| Automatic recovery | Lease expiry restores the previous integration | Local controller tests pass; live expiry check not recorded |
| Performance | Navigation retains the accepted 1.2.31 responsiveness | No replacement-specific measurement yet |

## Local validation

```sh
node scripts/check-system-home-runtime.cjs
node scripts/check-system-home-startup-guard.cjs
node scripts/check-system-home-integration.cjs
node scripts/check-system-home-control.cjs
node scripts/check-system-home-permissions.cjs
sh -n tv/system-home/control.sh tv/system-home/entrypoint.sh tv/system-home/startup.sh
node scripts/check-launcher.cjs
```

The runtime tests use injected service/process dependencies. Integration tests
cover marker transitions and original-directory publication. Controller tests
run rewritten copies against isolated files and fake TV commands, covering hash
gates, guard order, interrupted activation, mount failures, stale leases, durable
key recovery, permission installation/removal failures and web bus readiness.
The controller fixture stubs
`flock`; it does not demonstrate real device locking or TV rendering. Local
checks complement the physical matrix and do not replace it.

Startup-cancellation tests cover cold versus warm launches, foreground and
preload exclusions, repeated Home, a new selection of the same app, expiry,
subscription loss, bounded reconnects and cleanup. Settings use a separate
signal and never cancel startup, even if their metadata is missing or malformed.
The 2026-11-01 adapter update leaves the 1.2.32 UI package and moving drawer blur
unchanged. It was verified after an adapter/page reload; no additional full TV
reboot or standby/wake test was performed for this update.
