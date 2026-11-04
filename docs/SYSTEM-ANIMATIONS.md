> Historical local-build report. This describes the original development TV,
> not a verified release of the shareable edition. Apple fonts/symbols and
> private backup files mentioned below are not included. Use [setup](SETUP.md)
> for current instructions and [sharing notes](PUBLIC-SHARING.md) for differences.

# Native app-opening zoom prototype

Device investigated: rooted webOS 6.5.3, firmware 03.53.45. This experiment changes
system compositor QML for app opening; it is separate from launcher tile focus.
The experiment was abandoned at the user's request after physical testing remained
inconsistent. All temporary overrides were removed and LG's original files
restored. Launcher 1.2.12 removes the test transport. No persistent animation boot
hook exists. Source under `tv/system-zoom/` is retained only as an inactive record.

## Findings and historical tests

LG's triangular/elastic transition uses `Eos.Beziergon` in
`/usr/lib/qml/Eos/Items/Wiper.qml`. The splash image and actual app surface have
separate Wipers in `StarfishImageSplash.qml` and `StarfishFullscreenDelegate.qml`.
Their default opening duration is 500 ms. Their opening/opened signals also
control surface visibility, parenting and fullscreen handoff.

The experimental launcher 1.2.11 included an ES5 origin transport, inactive unless launched with
`params.systemZoomTest=true`. It sends the selected tile's logical 1920x1080
rectangle through the existing Homebrew root service before requesting the app.
The command validates app IDs, writes metadata atomically, and only writes when
`/tmp/lg-tv-system-zoom.enabled` exists. A 200 ms timeout prevents the transport
from blocking an app launch. Unrelated Home/startup behavior is unchanged.

The compositor accepts only matching target IDs, bounded numeric geometry and a
fresh request from our launcher. Requests expire after 30 seconds and can be
consumed once. Coordinates scale to the compositor's actual resolution.
Unmatched launches retain LG's original effect.

Initial trials either retained the stock effect or showed a zoom over the app
that was already visible. User feedback confirmed that overlap. The revised
trial addresses both launch paths:

- A pending launcher request skips the splash animation without consuming the
  request. The actual app surface owns the zoom.
- The original single Beziergon remains responsible for source visibility and
  lifecycle. Its four corners and eight control points form a rectangle expanded
  from the selected tile using the existing 500 ms opening interval.
- A one-time `ShaderEffectSource` capture of the outgoing launcher covers the
  background during the expansion; an opaque fallback prevents the new app
  showing behind its own transition. No live blur is added.
- LG's original fullscreen opened handler still reparents/reveals the app and
  completes the fullscreen swap. Home returning to the launcher uses stock LG
  behavior in this prototype.

The revised device smoke check accepted a YouTube request at age 448 ms, found the
outgoing launcher backdrop, and verified YouTube as foreground. This establishes
that the intended app-surface path runs; the user's follow-up reported either LG's original animation or no animation.
The zoom was not accepted. The user asked to stop this work, so stock behavior was
restored rather than persisting the experiment.

## Safe activation and recovery

The retained experimental `tv/system-zoom/build.py` verifies exact hashes of the private original firmware
QML before generating patches under `.local/system-zoom-stage/`. Original LG
proprietary sources and generated copies remain private; the repository contains
only patch logic, our additions, and the Apache-licensed Wiper-derived logic in
the private generated output.

On the TV, `/home/root/lg-tv-vibehack/system-zoom/control.sh` supports:

- `check`: verify unmodified firmware hashes and the real display daemon.
- `arm`: back up originals, start an independent five-minute rollback guard,
  temporarily bind-mount the three owned files, restart
  `surface-manager-daemon.service`, and reopen the launcher with the test flag.
- `status`: report owned mounts and display daemon health.
- `rollback`: disable metadata writes, unmount only our owned overrides, restart
  the display daemon and reopen the launcher without the test flag.
- `confirm`: cancel the timeout for this boot only. This is reserved for a
  successful physical check and does not install persistent startup integration.

A display restart briefly interrupts the TV interface. Reopening the launcher
retries while LG's app manager recovers. The independent guard survives SSH
termination; automatic five-minute restoration was observed during an earlier
trial. Reboot also clears these temporary bind mounts and `/tmp` flags.
Read-only firmware files are never edited or deleted.

Private recovery records include `.local/backups/before-native-zoom-prototype.tar`,
`.local/references/tv-webos-compositor.tar` and `.local/references/tv-Wiper.qml`.
Keep all existing root/SSH recovery files. Do not reinstall Developer Mode.

Local validation:

```sh
python3 tv/system-zoom/build.py
node scripts/check-system-zoom.cjs
sh -n tv/system-zoom/control.sh
```

Checks cover malformed/stale/replayed requests, non-consuming splash checks,
4K scaling, the single-renderer source contract, shell input boundaries and the
launcher timeout fallback. No QML compiler/linter is available on this TV; actual
component loading and behavior are checked on the guarded device test.

## Quick Start+ and font

Quick Start+ is separate. LG documents that it keeps the TV in standby to speed
power-on. Normal remote wake may improve; warm-wake automatic Home still needs a
physical measurement. It does not accelerate startup after unplugging. The
previously observed cold startup was approximately 18 seconds. Existing Home and
startup scripts were not changed by this animation experiment.

Inter is bundled under OFL after the user's choice. SF Pro is not bundled.

Sources:

- [LG Quick Start+ guide](https://www.lg.com/uk/support/product-support/troubleshoot/help-library/cs-CT00008386-20155512839520/)
- [LG startup settings by model year](https://solutions.lg.com/us/support/help-library/how-to-set-the-startup-screen-on-your-lg-tv-CT10000018-20155412183664)
- [Apple font download licence](https://developer.apple.com/fonts/)

## Final rollback

All three owned bind mounts were removed. The display daemon is active with the
original Wiper, splash and fullscreen delegate. The test activation and lease
files were removed; no animation watchdog remains. Launcher 1.2.12 opens apps
directly through its existing Luna call, with no origin transport script bundled.
The glass appearance and Inter font remain. Home/startup hooks and preferences
were not changed. Do not arm the retained prototype unless the user requests a
new animation experiment.
