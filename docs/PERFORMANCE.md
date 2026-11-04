> Historical local-build report. This describes the original development TV,
> not a verified release of the shareable edition. Apple fonts/symbols and
> private backup files mentioned below are not included. Use [setup](SETUP.md)
> for current instructions and [sharing notes](PUBLIC-SHARING.md) for differences.

# Launcher performance — 1.2.32

This document retains historical measurements. The review fixes are installed
in Home **1.2.51** and described in [the review follow-up](REVIEW-FIXES.md).
Home **1.2.51** is installed after an accepted 3px button
blur trial. Its visual feedback is recorded below; no new TV performance
benchmark is claimed. The SF Pro asset build is documented at the end.

Current rendering note: 1.2.38 puts the prepared frost image on one clipped
1920×1080 transform layer. Its translation cancels the stage translation using
the same CSS timing, including reversals. Navigation no longer jumps or repaints
background-position; same-row focus writes neither transform. There is no new
JavaScript frame loop, blur computation or image decode during drawer navigation.
Browser position samples verified continuous alignment; no new TV FPS benchmark
was run. Ordinary tile focus now requires real pointer movement.

Timing note: 1.2.37 changes the drawer/stage slide to 420 ms with
`cubic-bezier(.22,.61,.36,1)`. Focus scaling stays at 140 ms. Version 1.2.36
made held-tile positions immediate while neighbors retain their 320 ms slide.
These are CSS timing changes; no new FPS benchmark was run. The measurements
and 220 ms stage timing described below refer to the historical 1.2.32 baseline.

The historical 1.2.32 release saves the requested moving tray texture while
retaining the navigation, startup and input fixes introduced in 1.2.31. Tracking
was verified in the actual system Home page and again after a page reload. The app ID remains
`com.gathin.tvhome`; saved app order, column count and TV preferences are retained.
The visual design and the existing 140 ms focus / 220 ms grid transitions remain.

The historical 1.2.30-to-1.2.31 comparison on this TV improved from an 83.33 ms to
16.67 ms p95 rAF interval, with intervals over 34 ms falling from 61 to 2 and
recorded long tasks from 17 to 0. These are synthetic navigation measurements;
they do not establish physical remote latency, a cold-boot speedup or new 1.2.32
performance results.

## Home and floating button blur trials — 3 November 2026

A temporary 3px CSS backdrop filter on Home's open, unselected main Control
Centre buttons passed the user's visual check: it looked correct and felt
smooth. The actual Home page reported `blur(3px)`, an open panel and a present
wallpaper. Browser checks found eight filtered buttons and one unfiltered
selected button, correct focus changes and cleanup at expiry. These establish
the intended scope and the user's subjective experience, not measured FPS,
GPU cost or input-to-photon latency.

Home 1.2.51 is installed with that rule in `app/style.css`.
Only open, unselected main controls are filtered; selected buttons and submenus
are unchanged. The drawer still uses its prepared wallpaper texture. The CSS
change adds no JavaScript frame loop or animated blur radius, though backdrop
filtering itself still requires browser rendering work. Asset, Control Centre
and overlay checks passed. Installation succeeded after reconnecting to the TV;
all 91 checked package assets matched, 30 runtime files and saved settings were
preserved, and no temporary trial scripts remained. These are deployment checks,
not performance measurements. The record is
`.local/releases/1.2.51/deployment-result.json`.

A separate 3px trial on the floating overlay failed: the user saw black
backgrounds on every button except Settings, which the user confirmed was not
selected. Its entrypoint was restored, the
trial script removed and the overlay closed, with Netflix focus confirmed.
Overlay 1.0.19 keeps its existing unfiltered material. Home's wallpaper is in
the same document; the other app behind a floating overlay is a separate native
surface. The visual failure does not identify its precise compositor cause.
Neither trial collected a new frame-rate benchmark, and the historical grid
navigation measurements below do not establish performance with live blur.
Private trial records are in `.local/home-blur-trial/` and
`.local/floating-blur-trial/`.

### Floating diagnostic follow-up

A subsequent bounded diagnostic captured **10 of 11 planned phases** on this
TV. It tested Settings alone, Wallpaper alone, the pair in both DOM orders,
all unselected buttons, and a stripe pattern drawn inside the overlay's own
document. Explicit grid coordinates kept the compared buttons in the same
positions while their DOM order was reversed. Both Settings and Wallpaper
remained unselected and reported `blur(3px)` when targeted.

Over the separate Home surface, the normal pair made Wallpaper's interior
black while Settings retained its unblurred interior. Reversing DOM order
transferred the black interior to Settings, leaving Wallpaper unblurred.
Single-button phases did not change the sampled interiors. In these captures,
the last filtered sibling stayed visually unfiltered; Settings was therefore
not a working-blur exception.

The in-document stripe pattern showed that the earlier filtered sibling could
blur the overlay's own content despite its black result over the separate Home
surface. It smoothed the stripes, while the last filtered sibling kept them
sharp. Pixel-value standard deviation in the same 24×10px interior sample
changed as follows:

| Earlier filtered sibling | Pattern baseline | Filtered pattern |
| --- | ---: | ---: |
| Wallpaper, normal DOM order | 34.48 | 0.49 |
| Settings, reversed DOM order | 33.84 | 0.39 |

These are image-contrast measurements, not frame-rate or GPU-cost measurements.
They establish the observed dependency on sibling order and backdrop content
in this setup; they do not identify the engine-internal cause or establish that
all webOS backdrop filtering is unsupported.

The first diagnostic attempt captured only the baseline before the overlay hid;
the user confirmed no input. In the follow-up, a `visibility-hidden` event
occurred before the final `pattern-all` capture. The collector refused that
capture because the overlay no longer had focus. The reason for the unexpected
dismissal remains unresolved. Both attempts were rolled back, their temporary
scripts removed, and Home focus confirmed. No FPS benchmark was run. Evidence is
in `.local/floating-blur-diagnostic/analysis.json`, phase JSON/PNG files under
`.local/floating-blur-diagnostic/results/`, and the `first-attempt/` record.
The production floating overlay remains unfiltered.

### Frozen screenshot and native alternatives

A subsequent frozen-snapshot diagnostic completed all three native captures:
baseline, sharp snapshot and an ordinary `filter: blur(3px)` on the snapshot.
The source was the owned Home page at 1920×1080. A full-size image sat below
the floating shade, clipped to the eight unselected button interiors; text,
icons, rims and the selected control were unchanged. This ordinary image filter
worked without the black interiors seen in the live backdrop-filter trial.

Eight fixed patches away from text, glyphs and rims showed lower luminance
standard deviation in the blurred frame than in the sharp frame:

| Button | Sharp snapshot | Blurred snapshot |
| --- | ---: | ---: |
| Wi-Fi | 0.450 | 0.389 |
| Screen Off | 0.895 | 0.459 |
| Sound | 1.087 | 0.525 |
| VPN | 1.088 | 0.559 |
| Hidden apps | 1.864 | 0.527 |
| Inputs | 1.862 | 0.846 |
| Wallpaper | 1.707 | 0.832 |
| Settings | 1.640 | 0.294 |

These use 8-bit RGB luminance `0.2126R + 0.7152G + 0.0722B`, identical patch
coordinates across phases, and population standard deviation. Every sampled
patch remained nonblack. Outside the rounded clips plus a one-pixel antialias
allowance and the changing diagnostic label, all **1,930,659 pixels** were
byte-identical across phases, including the clock and selected Power control.
The exact clip boundary had small rasterization differences within that band.

The native source capture took **1,860 ms** and produced **2,612,440 bytes**;
the page's image load event arrived after **57 ms**. The latter does not isolate
decode time from loading. These are one-shot observations, not FPS, GPU-cost or
physical-input measurements. No moving or protected video was tested. The
corrected trial finished normally and restored the entrypoint and removed its
temporary assets. The first attempt produced no phase captures; a possible
Unicode-label serialization failure was reproduced locally and removed from
the retry. Evidence and exact sampling coordinates are in
`.local/floating-alternatives/frozen/analysis.json`, with PNG/JSON files under
`results/` and the source-capture timing under `first-attempt/snapshot-meta.json`.

A separate native-blur surface worked in isolation. Coexistence with the web
overlay and production integration remain unproven; this does not establish a
universal native-blur limitation. The chosen fallback for overlay **1.0.20** is
the authorized static **10% black layer over the existing 12% white material**
on unselected main buttons. It avoids the observed roughly 1.9-second screenshot
capture and freezing the background. Overlay 1.0.20 is installed with status 30;
all 91 checked package assets matched, and 30 runtime files and saved settings
were preserved. The installed native screenshot confirmed background-only sample
brightness at 89.79–90.04% of the old material across all eight unselected
buttons. The panel closed back to Home; the user-requested shutdown then reached
Active Standby. Package metadata is
`.local/floating-alternatives/deploy/package-metadata.json`. The earlier staged
package under `fallback/` is a comparison artifact. Home's accepted 3px rule is
unchanged, and no new performance improvement is claimed for the darkening.

## Changes

### Navigation and lifecycle

- Keyboard and pointer presses are cancelled on hide, blur, resume and panel
  entry. Delayed long presses stay bound to their original app. Losing an OK
  release event no longer causes an invisible edit or consumes the first OK
  press after returning Home.
- Control Centre records captured remote input through the launcher's shared
  interaction API. Both Control Centre and wallpaper panels block inventory
  loading/rebuilding, even when their capture handlers stop document key events.
- Tile positions use transforms, with writes only for changed coordinates.
  Ordinary focus changes update the old and new focused cards; they do not run
  tile layout. Reordering no longer animates `left` and `top`.
- Version 1.2.32 restores sampled shelf background tracking when the row offset
  changes; 1.2.31 kept it static. The browsing overlay switches between static
  gradients using opacity. The stage and cards in nearby viewport rows receive
  `will-change: transform` hints after a TV
  experiment showed much smoother frame scheduling. Card hints are bounded to
  nearby rows rather than retained for the entire installed-app inventory.
  These drawer changes add no continuous blur or JavaScript frame loop.
- The clock updates at minute boundaries, writes only changed text, and stops
  its timer while hidden. Resume refreshes the time immediately.
- Native service bridges release after a one-shot response, a thrown call or
  callback, explicit cancellation, or a silent 10-second retention limit.
  Subscriptions remain alive until cancelled. Request owners retain their own
  timeout/error handling; bridge cleanup does not invent a successful response.

### Startup and assets

- `background.js` discovers the selected wallpaper before tile construction.
  The bundled photo is cropped to the existing centred 16:9 cover view, and its
  shelf texture is supplied as a small precomputed image.
- Legacy custom wallpapers without a texture use the old canvas sampling only
  while visible and idle. New phone uploads generate the photo and texture on
  the phone; the TV validates their dimensions before publication.
- Inter is split into complementary font subsets. Latin, Vietnamese, combining
  marks and common UI symbols use the primary file; remaining original code
  points load through a second `unicode-range` face when required. Variable
  weights, tabular digits and standard shaping features are retained.
- Font preloading matches the CSS request's credentials mode for webOS `file:`
  pages; HTTP previews retain anonymous font preloading.
- QR code JavaScript loads when wallpaper controls are opened. The panel shows
  its loading state immediately and handles close-during-load, failures and
  retries without reopening after a stale callback.

| Asset | 1.2.30 bytes | 1.2.31 bytes |
| --- | ---: | ---: |
| Primary Inter font | 352,240 | 148,760 |
| Additional Inter coverage | Included above | 232,784, loaded when needed |
| Bundled wallpaper | 772,109 | 525,762 |
| Precomputed shelf texture | Generated at runtime | 5,142 |

These are file sizes, not measured startup savings. The two font files together
are larger than the original; the common initial font request is smaller while
the original character coverage remains available. Wallpaper dimensions changed
from 1920×1281 to 1920×1080, reducing its nominal decoded RGBA size from about
9.38 MiB to 7.91 MiB before browser/compositor overhead.

### Control Centre and TV processes

- Sound output, available outputs and input capability reads run in parallel.
  Short-lived cached data can populate the view while fresh reads complete.
  In-flight identical reads are shared; successful writes invalidate relevant
  caches and old responses cannot overwrite a newer view/state.
- Pending changes show feedback and reject duplicate writes. Action selection
  updates only changed buttons and scrolls only when necessary. Refreshing a
  menu preserves its selected action when possible.
- The watcher coordinates its Home, wake and delayed-startup launch requests.
  Requests have timeouts, overlapping attempts are coalesced, and a newer
  foreground app cancels stale delayed work. Owned subscriptions and timers are
  cleaned up on shutdown, with bounded reconnects on service failure.
- Boot checks existing daemon PIDs before starting another watcher or wallpaper
  server. The existing 30-second delay still defers inventory/server startup;
  it does not postpone the early launcher request.
- Inventory/settings publication uses a shared cross-process queue and atomic
  replacement. Unchanged files are not rewritten, and unchanged icons avoid
  another copy. Settings-only publication avoids full app discovery.
- Wallpaper, dim and weather changes refresh in place using a settings token.
  Versioned photo/texture filenames avoid stale browser images. One previous
  generation is retained for pages using an older manifest.

## Measurements and their limits

Keep these paths separate when comparing versions:

1. **Cold TV boot:** power-on or first picture to a fully visible, usable launcher.
2. **Warm wake:** standby/Quick Start+ wake to a usable launcher.
3. **Warm Home return:** Home in a streaming app to the retained launcher page.
4. **Page load/reload:** browser navigation timing, first contentful paint and
   time until the launcher can accept input.
5. **Interaction:** physical remote press to the first visible response, held
   arrow navigation, reordering, and Control Centre request-to-confirmed-state.

Use the same TV, firmware, picture mode, preferences, wallpaper, app inventory
and starting focus. Record Quick Start+ state and whether a page was retained or
recreated. Run multiple repetitions and report individual samples plus medians;
use p95 only when the sample count is meaningful. A/B runs should use the same
instrumentation and event sequence. Do not compare a cold boot with warm wake.

`requestAnimationFrame` measures callback cadence. A 16.7 ms interval is useful
evidence about main-thread scheduling, but does not prove that every frame was
presented, nor measure the TV compositor, remote transport or display scanout.
Synthetic keyboard events also bypass the physical remote. Measure physical
input-to-photon latency with a repeatable external timing/video method, and
report it separately from synthetic event-to-next-rAF timing. A service launch
being accepted is not proof that its first frame has reached the screen.

### Initial navigation sample: starting state unrecorded

The private raw record `.local/audit/baseline-1.2.30.json` contains an initial TV
DevTools run of 72 synthetic navigation events spaced 140 ms apart:

| Metric | Baseline |
| --- | ---: |
| Sample duration / rAF samples | 10,393.66 ms / 623 |
| rAF median / p95 / maximum | 16.666 / 16.666 / 16.666 ms |
| Intervals over 34 ms / recorded long tasks | 0 / 0 |
| Synthetic input → next rAF median / p95 / maximum | 9.225 / 15.570 / 16.805 ms |

The initial focused tile, row and Control Centre state were not recorded.
Consequently, this sample is **not a valid baseline for grid navigation**: the
same arrows can exercise different controls depending on the starting state.
Retain the raw measurements, but do not use their steady callback cadence to
claim that the old grid was smoother, or that ordinary navigation had no stalls.

### Controlled navigation: initial 1.2.31 candidate

The follow-up results are in `.local/audit/optimized-1.2.31.json`. Both versions
were tested on the same TV/runtime with 12 tiles, Netflix focused first, the
stage at `translateY(0px)`, Control Centre closed, and `no-glow` on the body.
The exact installed 1.2.30 backup ran from a temporary `audit-baseline` directory
within the same app. Each version retained its own assets as part of the
comparison. These are single runs per version, not a repeated distribution.

The event sequence was Right ×5, Left ×5, Down, Up, repeated six times at a
requested 140 ms interval. Events were dispatched to `document` as synthetic
keyboard events. Neither controlled run recorded an interruption.

| Metric | Controlled 1.2.30 | Initial 1.2.31 candidate |
| --- | ---: | ---: |
| Elapsed / rAF samples | 10,385.125 ms / 385 | 10,549.165 ms / 370 |
| rAF interval median / p95 | 16.666 / 83.330 ms | 16.666 / 83.330 ms |
| Maximum rAF interval | 183.326 ms | 349.986 ms |
| Intervals over 34 ms | 61 | 54 |
| Synthetic event → next rAF median / p95 | 10.865 / 72.430 ms | 11.700 / 105.700 ms |
| Maximum synthetic event → next rAF | 153.410 ms | 150.105 ms |
| Recorded long tasks / maximum duration | 17 / 81.655 ms | 15 / 352.910 ms |

**The initial candidate did not improve navigation cadence.** Both runs have an
83.33 ms p95 frame interval. The new run also has a higher event-to-rAF p95 and
a longer worst stall; the small sample does not establish how repeatable those
tail differences are. The input/lifecycle defects fixed by this version are
separate from these rendering measurements.

Live isolation tests removing the new outer tile transforms, then additionally
restoring the original background overlay, both still recorded an 83.33 ms p95
frame interval. Synchronous key dispatch took 0.455–1.835 ms in the recorded
sample. Those results do not identify the remaining rendering/scheduling cost;
they do not justify attributing it to either CSS change or to the key handler.

An earlier 1.2.31 probe was interrupted by a user-confirmed app launch followed
by launcher reload and a changed debug target. Its results remain under
`interruptedNavigationProbe` in the private record and are excluded from this
comparison.

### Transform caching: final installed result

A subsequent live test added `#stage, .card { will-change: transform; }` and
repeated the same sequence from the recorded Netflix/12-tile/closed-panel state.
The `transformCacheProbe` record contains:

| Metric | Initial 1.2.31 candidate | Transform-cache probe |
| --- | ---: | ---: |
| rAF samples | 370 | 617 |
| rAF interval p95 / maximum | 83.330 / 349.986 ms | 16.666 / 66.664 ms |
| Intervals over 34 ms / long tasks | 54 / 15 | 1 / 0 |
| Synthetic event → next rAF p95 | 105.700 ms | 14.455 ms |

The user independently reported, “that one looked really smooth on the tv.”
The final implementation applies the stage hint and limits card hints to nearby
viewport rows using `.item.render-cached .card`. After installing the final
package, a separate run repeated the controlled Netflix/12-tile/closed-panel
sequence. All 12 cards were cached, no temporary CSS override remained, and the
built-in profiler was disabled. Installed app script bytes matched the package.

| Metric | Controlled 1.2.30 | Final installed 1.2.31 |
| --- | ---: | ---: |
| Elapsed / rAF samples | 10,385.125 ms / 385 | 10,383.135 ms / 613 |
| rAF interval median / p95 | 16.666 / 83.330 ms | 16.666 / 16.666 ms |
| Maximum rAF interval | 183.326 ms | 49.998 ms |
| Intervals over 34 ms / recorded long tasks | 61 / 17 | 2 / 0 |
| Synthetic event → next rAF median / p95 | 10.865 / 72.430 ms | 7.470 / 14.925 ms |
| Maximum synthetic event → next rAF | 153.410 ms | 16.305 ms |

The installed result confirms the substantial sampled frame-cadence improvement
seen in the live experiment. It is one controlled run per version, supported by
the separate cache probe and the user's physical observation, not a physical
input-to-photon measurement or a guarantee for every app/layout. An earlier
installed run starting at Apple TV recorded 601 samples, a 16.666 ms p95,
a 266.656 ms maximum and two long tasks. It remains in the raw record as
`finalInstalledFirstProbe`; its different starting focus excludes it from the
primary comparison.

Available memory was about 301 MiB after the probe versus 328 MiB earlier. These
were separate system snapshots, not a controlled memory A/B test, so their
difference is not a measured allocation cost of the transform hints.

### Historical 1.2.31 trial: moving tray background

At the user's request, a temporary in-page trial restored the previous tray
wallpaper tracking while retaining the final bounded transform caching. A
MutationObserver watched stage-offset changes and applied the original
background-position formula; this tested the previous tracking behavior, without
adding continuous blur or a frame loop. The same 72-key sequence started at
Netflix with 12 tiles and Control Centre closed; no external input was recorded.

| Metric | Installed 1.2.31 static tray | Temporary 1.2.31 tracking trial |
| --- | ---: | ---: |
| rAF samples | 613 | 580 |
| rAF p95 | 16.666 ms | 16.666 ms |
| Maximum interval | 49.998 ms | 83.330 ms |
| Intervals over 34 ms | 2 | 11 |
| Long tasks | 0 | 0 |
| Synthetic input → next rAF p95 | 14.925 ms | 14.635 ms |
| Maximum synthetic input → next rAF | 16.305 ms | 37.385 ms |

Typical cadence stayed similar, with more occasional hitches in the tracking
trial. This is one run per configuration, not a precise universal cost. The
trial was left active for the user's visual comparison. It was absent from the
saved 1.2.31 source and package; reloading that version or calling
`TrayTrackingTrial.stop()` restored its static tray.

### Saved moving tray texture (1.2.32)

At the user's request, 1.2.32 puts the tracking behavior into the saved launcher
source. Row-offset changes update the prepared wallpaper texture's background
position using the same formula as the trial. Horizontal focus changes do not
rewrite it. The shelf origin includes the scroll offset, so applying a new frost
texture while scrolled preserves its alignment.

The existing tile transforms, bounded nearby-card caching, idle-only legacy
texture generation and other 1.2.31 optimizations remain. The saved behavior needs
no MutationObserver, continuous blur computation or JavaScript frame loop. Local
layout, resume, settings, idle-refresh, input and ES5 checks passed.

The 1.2.32 package was installed and the current settings, 19 apps and three inputs
were republished. Checks in the actual `com.webos.app.home` page confirmed the new
`app.js?v=glass1232`, with the native Home helpers unchanged and startup enabled.
At the saved six-column layout, the tray texture's Y position changed from
`-786px` to `-120px` on expansion, remained unchanged on horizontal focus, and
returned to `-786px` on collapse. Twelve cards retained their cache hints and the
saved app order remained present. The same checks passed again after reloading
the page. The installed `app.js` hash matched the package.

The private records are `.local/native-home/live-blur-installed.json` and
`.local/native-home/live-blur-after-reload.json`; the pre-install backup is
`.local/native-home/before-live-blur-1.2.32.tar`. No new frame-rate benchmark or
full TV reboot test was run for 1.2.32. The table above remains evidence from the
temporary 1.2.31 trial.

### Sound menu

The final installed Sound menu populated its two rows in 321.070 ms on first
opening and 24.665 ms on a cached reopening; all reads succeeded. These timings
measure DOM row insertion, not painted response. The earlier service-read
measurements used a different harness, so these samples do not establish an
uncached menu speedup against 1.2.30.

### Page reload samples

Three explicit page reloads per version recorded the following timings. The
1.2.31 samples predate the final bounded transform-caching change.

| Version / reload | DOMContentLoaded | Load | First contentful paint |
| --- | ---: | ---: | ---: |
| 1.2.30 / 1 | 1,279.740 ms | 2,290.905 ms | 454.970 ms |
| 1.2.30 / 2 | 843.140 ms | 1,485.490 ms | 204.785 ms |
| 1.2.30 / 3 | 765.875 ms | 1,502.155 ms | 154.150 ms |
| 1.2.31 / 1 | 1,076.365 ms | 1,348.015 ms | 205.055 ms |
| 1.2.31 / 2 | 1,184.795 ms | 1,396.400 ms | 169.905 ms |
| 1.2.31 / 3 | 884.450 ms | 1,183.385 ms | 178.350 ms |

| Median | 1.2.30 | 1.2.31 | Observed difference |
| --- | ---: | ---: | --- |
| DOMContentLoaded | 843.140 ms | 1,076.365 ms | 27.7% higher/slower |
| Load | 1,502.155 ms | 1,348.015 ms | 10.3% lower |
| First contentful paint | 204.785 ms | 178.350 ms | 12.9% lower |

The load median is about 10% lower and first contentful paint also occurred
earlier in these samples, while DOMContentLoaded was slower. Three reloads per
version are too few to establish a reliable startup speedup or tail latency.
Cache and runtime conditions can affect these measurements. They measure page
reloads, **not cold TV boot, warm wake, Home return or time to a usable frame**.

Two further reloads of the final packaged build with bounded transform caching
recorded `(DOMContentLoaded, load, first contentful paint)` of
`(1283.845, 1369.430, 201.200)` ms and `(993.000, 1150.900, 171.320)` ms.
These small samples are retained separately from the earlier three-run set;
they do not establish cold-boot or wake timing.

The separate existing-page startup entry (175.135 ms DOMContentLoaded,
904.255 ms load, 737.360 ms first contentful paint) is not a controlled cold-boot
sample. Individual sound-control reads ranged from 75 to 98 ms across three
sets of reads; those are service round trips, not complete menu latency.
The baseline recorded a `file:` font-preload credentials mismatch warning; the
1.2.31 verification did not. Device checks confirmed one watcher and one
wallpaper server, unchanged saved preferences, and an in-place settings refresh
retaining the same page and selected tile with 12 tiles and one generated user
script. The built-in opt-in profiler was disabled during that verification.

Physical remote response, playback, boot/wake and Home-return observations must
remain separate from synthetic probes. The transform-cache experiment and final
installed repeat provide device evidence for smoother navigation; smaller files
and passing local tests alone do not establish that result or a measured
boot-time improvement.

## Optional profiling

Normal launches do not install a performance observer or animation-frame loop.
Enable profiling before the page loads:

- Preview: open `http://127.0.0.1:4795/?profile=1` after starting
  `python3 scripts/preview.py`.
- TV: launch a new page instance with `profile: true` in its webOS launch
  parameters. Setting the flag only on a relaunch of an existing page does not
  rerun the profiler initializer. Use a deliberate cold-page launch for startup
  measurements, and record that choice.

In that page's DevTools console:

```js
LauncherPerf.sample('held-arrow-check', 10000);
```

Perform the interaction, then inspect or copy the report and stop automatic
sampling:

```js
JSON.stringify(LauncherPerf.report(), null, 2);
LauncherPerf.stop();
```

The profiler records script/build/load marks, frame-interval summaries, the
number of sampled intervals above 34 ms, and long-task duration summaries when
supported. Each list retains at most 600 entries. Load/resume samples last one
second; each keyboard event requests a 500 ms sample. Explicit samples are
capped at 12 seconds. A later sample call, including a key event, replaces the
current sampling deadline; this is not an uninterrupted trace recorder.

Hidden time is excluded by cancelling/resetting frame sampling on visibility
changes. `stop()` disconnects observation and removes automatic sampling hooks;
existing reports remain readable. Reload normally without the opt-in flag to
return to the uninstrumented launch path. Keep raw device records in private
`.local/audit/`; the preview server serves only `app/`.

## Validation

Run the active local regression suites from the repository root:

```sh
node scripts/check-launcher.cjs
```

The runner discovers `scripts/check-*.cjs`, runs each in a fresh development
Node.js process, and stops on failure. There are 19 active suites for 1.2.31.
It excludes itself and `check-system-zoom.cjs`, which belongs to the abandoned
native compositor experiment. Tests use mocks/temporary fixtures and do not
connect to the TV. The development runner uses modern Node syntax; it is not
intended to run under the TV's Node 8.

Coverage includes lost keyup and pointer holds, modal idle deferral, transform
placement, minute clock updates, asynchronous QR cancellation, native bridge
cleanup, settings/weather suspension, request/cache races, overlapping launch
events, atomic publication, upload validation and profiling cleanup.

Separately parse all browser and TV JavaScript with an ES5 parser such as Acorn
using `ecmaVersion: 5`, and check changed shell files with `sh -n`. The runtime
targets webOS 6 / Chromium 79 and Node 8 on this TV: keep plain ES5, compatible
service APIs and CSS, and avoid assumptions based on current desktop Chromium.
In particular, do not introduce optional chaining, CSS flex gap, `inset`-only
positioning. Keep the tested 3px Home button blur scoped to its open, unselected
main controls; the floating overlay remains unfiltered following its failed TV
trial. Preserve fallbacks for unsupported APIs.

Browser/TV visual checks should cover the dock, Down expansion, held arrows,
long-press rearrange/cancel, Control Centre, wallpaper close/retry, Home return,
and enabled/disabled weather. Confirm actual remote behavior and official app
playback separately from the automated checks.

## Regenerating assets

The current local build packages one **65,088-byte SF Pro WOFF2**. It is generated
from the installed upright SF Pro variable font, with width fixed at 100,
optical size fixed at 24, and weights limited to 400–700. Latin and Vietnamese
text, combining marks, literal app UI symbols, shaping, and tabular digits are
retained. Other scripts use system fallback. The original 16 MB font, italic
faces, width variants and old font families are not packaged.

Regenerate using `fonttools[woff]` and Brotli:

```sh
python3 scripts/subset-sf-pro.py --font-source /Library/Fonts/SF-Pro.ttf
```

The local tooling is also available through
`PYTHONPATH=.local/tools/fontbuild python3 scripts/subset-sf-pro.py`.
The script verifies coverage, the remaining weight axis, and tabular digits,
and records source/output hashes in `app/fonts/SF-Pro-SOURCE.json`.
It retains the source font's licence notice. Do not subset an already-generated
WOFF2 as the source.

Wallpaper generation remains separate, avoiding accidental recompression when
only a font changes. It requires Pillow and the original photograph:

```sh
python3 scripts/optimize-assets.py --wallpaper-source /absolute/path/to/misty.original.jpg
```

`--font-source` can optionally be supplied to that script to regenerate the
current SF Pro subset too. `--output` selects an app-shaped output directory.
The photograph is centred/cropped to 1920×1080 and saved as a progressive JPEG;
the frost texture is a 32×18 sample expanded to 384×216. Preserve original photos
and their provenance as described in [ASSET-CREDITS.md](ASSET-CREDITS.md).

`node scripts/check-assets.cjs` checks both entrypoints, the font hash/size, and
all packaged font references in a fresh Control Centre build. Re-run the full
launcher checks and inspect browser rendering after font or layout changes.
Actual Chromium 79 rendering on the TV remains a separate device check.
