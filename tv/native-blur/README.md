# Native button blur

**Disabled in the normal floating panel as of 2026-11-03.** The user requested the fast panel and original darker gradient. The floating entrypoint and package builder no longer load this client, and Settings bypasses a disabled runtime. Home keeps its separate CSS 8px blur. The implementation and evidence below describe the retained experimental path.

The floating Control Centre uses one native Qt `FastBlur` at radius 30 beneath
all nine fixed rounded button interiors. The user accepted this setting over
Apple Music. Home uses its own CSS `blur(8px)`; these are visually calibrated
settings, not equivalent filter units. Home 12px felt slightly laggier, and the
accepted 8px still had a minor frame drop according to the user.

The normal Settings toggle is now wired to a per-open coordinator. No boot hook
or persistent daemon is added. `app/native-blur.js` is packaged with the floating
overlay and remains inert without valid native-blur launch parameters. The native
runtime is staged separately under `/home/root/lg-tv-vibehack/native-blur`.

**Hardware status (2026-11-03):** cold startup and the installed Settings-key
coordinator's open/close/queued-reopen lifecycle are verified. The final manual
Netflix playback test remained open during arrow navigation, but the user
reported **“Stays open but no blur.”** Native rendering stayed reported across
selections, with no startup failure. Playback blur therefore remains unresolved;
Netflix menu-only visual behavior was not tested.

The TV reported a separate fullscreen 1920×1080 video window. Our sampler reads
the app's QML surface, so the strongest inference is that Netflix's playback
pixels are outside that sampled surface. Official [webOS compositor-capture
documentation](https://www.webosose.org/docs/reference/ls2-api/com-webos-surfacemanager/#capturecompositoroutput) also describes possible omission of video areas; it supports this limitation,
but does not prove this TV's complete internal composition path. No universal
webOS or Netflix menu-blur claim follows.

The startup fix retains the original absolute eight-second ceiling and removes
a separate five-second web-focus cutoff. All 101 installed assets passed the
post-fix check. The final manual session ended with `web-hidden`, verified native
cleanup and worker exit; Netflix remained focused with PID 15425 unchanged and
the TV stayed on. An earlier corrected cold test closed about eight seconds
after becoming visible; LG inactivity timing is consistent with the evidence,
but its close cause was not established by the bounded lifecycle observer.

## Opening and ownership

- `runtime.sh` serializes short requests. `runtime.js` starts a detached worker
  with caller descriptors closed, so it cannot retain the Settings toggle's
  `flock` on descriptor 8. `worker.sh` separately owns the session lock.
- A session records its random nonce, exact source ID, worker PID and process
  start time. Cancellation writes a file consumed by that exact worker; it does
  not signal a PID based on a stale PID file.
- `bridge.js` launches `Host.qml` before the web overlay, waits for readiness,
  and gives the page a fresh 64-hex-character token. The bounded HTTP service
  binds only `127.0.0.1:48740`.
- Another press cancels a pending opening. A reopen during cleanup waits behind
  the prior worker's lifecycle lock and requires verified prior cleanup. The
  fixed port and native app ID are never intentionally used by two workers at
  once. A lost worker with unverified cleanup triggers a 20-second quarantine.
- Cleanup waits for any pending launch to settle before cancelling it. A late
  web cancellation carries the old token; both the page controller and reporter
  ignore it when a different token or plain opening owns the page.
- A configured QML instance rejects relaunch. Each opening needs a fresh object.
  The optional `qml-release` marker selects an immutable `releases/<version>`
  directory containing `Host.qml` and `Backdrop.qml`. Stage a new release while
  no native host is active; do not overwrite QML behind an active URL.

The existing Settings authorization and Home routing remain in use. Unsupported
sources use the plain floating panel. Initial source/focus changes fail closed
instead of opening over a different app. A native startup failure can fall back
to the plain panel only after a fresh source check and, if native launch was
attempted, verified cleanup. A delegated opening acknowledgement does not itself
confirm that a panel became visible.

## Rendering and lifetime

The exact source allowlist is:

| App ID | Hardware evidence |
| --- | --- |
| `com.webos.app.home` | Native/web coexistence and detail/return cleanup exercised. |
| `com.gathin.tvhome` | Allowed fallback Home identity; no separate hardware result claimed. |
| `youtube.leanback.v4` | Account-picker UI exercised; video playback untested. |
| `com.apple.applemusic` | User accepted the fixed-mask radius-30 effect over its UI. |
| `netflix` | Corrected cold startup, active rendering and queued reopen/cleanup verified. User observed no playback blur during manual navigation; menu-only visual test not performed. |

An ID match is insufficient. The original fullscreen object must stay current,
have positive dimensions, belong to the same QQuickWindow, and not be an ancestor
or descendant of the effect. An app switch ends the native session. These checks
do not establish access to protected or separate video planes.

One 512×512 source texture and one explicit mask texture cover all nine button
interiors. The selected web button's opaque fill covers its blur. Main-grid
selection does not clear the other buttons; submenus and wallpaper hide the
effect while keeping the bounded session alive. The white mask geometry is
captured with `hideSource: true` and is not intended to paint directly.

The controller grants an eight-second startup lease; the web-focus wait shares
that absolute deadline rather than imposing a separate five-second cutoff. The
3.5-second heartbeat lease is unchanged. The host independently caps
post-takeover leases at four seconds and all
sessions at ten minutes. Hiding the web page retires its token. Teardown clears
source references, timers, requests and native close-delay/retention settings.
Foreground inventory omits QML containers in `closing`, so absence there alone
does not prove cleanup; normal observed hosts require a `destroyed` event.

## Operation and checks

These TV-side commands affect only the optional native helper and preserve the
Settings binding. `close` stops the current owned session; `disable` also prevents
future native openings. `enable` permits future openings without opening a panel.

```sh
sh /home/root/lg-tv-vibehack/native-blur/runtime.sh status
sh /home/root/lg-tv-vibehack/native-blur/runtime.sh close
sh /home/root/lg-tv-vibehack/native-blur/runtime.sh disable
sh /home/root/lg-tv-vibehack/native-blur/runtime.sh enable
```

Runtime metadata lives under `/tmp/lg-tv-native-blur`. Normal pruning retains
four recent session directories and uses a bounded rotating log; unknown files
are left untouched. No persistent worker is needed between sessions. Disabling
or restoring the Settings integration also requests closure of the owned helper.

Local checks do not contact a TV:

```sh
node scripts/check-native-blur-bridge.cjs
node scripts/check-native-blur-client.cjs
node scripts/check-native-blur-runtime.cjs
node .local/native-blur-next/check-native-host.cjs
```

They exercise protocol and QML-method state, not actual Qt compilation or GPU
performance. Controlled trials included independent destruction evidence after
an abruptly killed controller. Earlier captures also contained tiny intermittent
corruption lines; the final fixed-mask variant looked clean to the user, but
these observations do not prove artifact-free rendering, frame rate, playback
behavior, or complete GPU-memory reclamation. See
[the lifecycle notes](../../docs/NATIVE-BLUR-LIFECYCLE.md) for bounds and evidence.
