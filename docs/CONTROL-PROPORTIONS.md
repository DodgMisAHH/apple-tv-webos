> Historical local-build report. This describes the original development TV,
> not a verified release of the shareable edition. Apple fonts/symbols and
> private backup files mentioned below are not included. Use [setup](SETUP.md)
> for current instructions and [sharing notes](PUBLIC-SHARING.md) for differences.

# Control Centre reference proportions

Home **1.2.51** and overlay **1.0.19** are installed. All 91 checked package
assets matched; 30 runtime files and saved settings were preserved. The user
previously confirmed the physical Home button after its scoped recovery.

Home **1.2.51** retains the same proportions and adds
3px backdrop blur on unselected main controls while Home's panel is open. The
user accepted the temporary Home trial's appearance and responsiveness; this is
subjective feedback, not an FPS measurement. Selected buttons remain unfiltered,
and text/icon opacity, surface tint and rims are unchanged. The separate 3px
floating trial was rejected after the user saw black backgrounds on all buttons
except Settings, which the user confirmed was not selected. Its entrypoint was
restored and the trial removed. Overlay
1.0.19 therefore retains its existing material without live blur. Home installation
succeeded after reconnecting; no temporary trial scripts remain. The deployment
record is `.local/releases/1.2.51/deployment-result.json`.

Submenu rows now share the same styles in Home and the floating panel. Their
original 665px maximum list height is restored, with a flat gray 6px scrollbar.
The floating shade covers a 1100×1050px corner area, with black opacity stops of
80%, 60% at 50%, 28% at 78%, and transparent at the edge. Browser inspection
confirmed the shared typography/material and compact list geometry. The Wi-Fi
password prompt reuses the TV's saved profiles for known personal networks;
real network switching remains a user-driven device check.

The supplied screenshot is 566×674 pixels. Its button cluster is approximately
515×515 pixels, so measurements are normalized by 430/515 to the app's existing
430px cluster. Its grid was already close; most of the visible mismatch came
from transparent margins inside the symbol PNGs and compressed text tracking.

| Element | Updated app, logical pixels |
| --- | --- |
| Power square / wide pill width | 207 |
| Round buttons / pill height | 95.5 |
| Grid gap | 16 |
| Power symbol box | 114, with about 95×98 visible artwork at Medium weight |
| Power symbol visible top inset | About 40 |
| Power label | 23px SF Pro, natural tracking, 28px line height, 20px bottom inset |
| Standard symbol box | 49, giving about 42px visible artwork |
| Round symbol box | 51, compensating for PNG margins |
| Pill text left edge | 87 |
| Status labels | 23px / 28px line height, same as main labels, 72% white, truncated when necessary |
| Header button / symbol box | 58 / 34 |

The VPN symbol has a slightly larger mask inside its unchanged layout slot to
account for its extra transparent padding. Screen Off uses a smaller moon inside
a 42px circle, matching the reference's treatment. The crescent uses a 1px right and 1px down optical offset within its circle. The Power mask uses the native Medium weight
for a stroke closer to the reference. Screen Off wraps onto two
lines; its pending message has a separate bottom position to avoid overlap.

The app retains its existing actions, live status text and focus highlight.
Shared Home/overlay geometry and the older standalone concept preview were
updated. A follow-up removes the broad top-left sheen and blue surface tint:
normal buttons use a uniform 12% white layer so the background supplies their
color. The newer colored-background reference replaces the earlier gray foreground:
primary labels and icons are opaque white (`#fff`), with the existing solid network
accent. Secondary status labels use the same font size at 72% white. Symbol masks
have opaque interiors; surface alpha never fades their content.
The rim is now 2px (doubled from 1px), with a brighter top (16% white) than bottom
(3.5%), plus the existing one-pixel inset edge. Padding and positioned content
compensate for the extra border pixel, preserving button sizes and content positions. Selected controls keep
their existing white fill; app tray layout is unchanged.

Four existing focused suites passed: Control Centre, overlay, Home Settings and
asset packaging. The production Home preview was checked for label fit and icon
dimensions. A second browser view displays the supplied reference beside the
actual overlay page at the same button scale; its screenshot and both IPKs are
in `build/control-proportions/`.

Pre-change sources are in
`.local/backups/before-control-proportions-20261102.tar.gz`.
