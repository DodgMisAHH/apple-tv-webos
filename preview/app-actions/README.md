# App actions preview

Run `python3 scripts/preview-app-actions.py` from the project root and open
http://127.0.0.1:4797/.

This browser variant uses the same runtime and preference model as `app/`, with a
preview-only storage namespace initialized here. Packaging the TV app does not
include the preview configuration. The server serves existing app assets and two
explicitly allowlisted preview override files. The TV is not contacted or modified.

- Hold Enter/OK or hold the pointer on a tile for 600 ms to open Move and Hide.
  Right-click also opens the menu in the browser.
- Move uses the existing arrows/pointer rearrangement. Enter places; Escape/Back
  cancels and restores the previous order.
- Hide removes the tile. Open Control Centre using Up from the favourites row
  or the clock, then choose the round Hidden apps shortcut and Show again. The
  shortcut stays visible; an empty list shows a translucent “No apps hidden” button.
- Back/Escape returns from each Control Centre submenu (including Wallpaper) to
  the controls, keeping the selected tile. Press it again to return to the launcher.
- Hidden choices and ordering are stored only in this browser preview under
  `tvhome.preview.appActions`. Hidden IDs retain slots in the full order while
  visible apps are rearranged. Baseline system exclusions are kept separate.
- If all apps are hidden, the empty screen offers Hidden apps; Enter opens it
  and Up still opens Control Centre.

The context menu reuses Control Centre's `.ccAction` pill styling. Source edits
reload this preview automatically. The accepted feature set was separately promoted
to the TV in 1.2.33/1.2.34, with D-pad ownership added in 1.2.35 and immediate held-tile movement in 1.2.36; using this preview does not change TV preferences.

Validation: `node scripts/check-preview-app-actions.cjs` and
`node scripts/check-preview-move.cjs`. Pointer moves use fixed grid slots so
animating tiles cannot trigger extra reorders. Arrow keys retain control through
small pointer jitter; deliberate mouse movement resumes pointer control in this
browser preview. On TV, webOS cursor visibility controls the mode handover. Browser checks cover
long-press release, Hide, persistence through reload, restoring the original
position, and Move/Cancel. Add `--production` to the model/move checks to validate
the production storage namespace (movement sources are shared); device records are in docs/LOCAL-LAUNCHER.md.

The held tile has no position transition, so rapid taps immediately set its slot;
neighboring tiles still glide aside. Browser DOM checks verified each rendered
position during four rapid presses, plus cancellation back to the original order.

Version 1.2.37 uses a slower 420 ms drawer slide with softer easing, shared by
this preview and the TV package. Focused tile navigation remains immediate.

Version 1.2.38 keeps the prepared frost image aligned throughout the drawer slide
using matching opposite transforms. Normal tile focus also requires actual pointer
motion, so animated hit-testing cannot reopen a closing drawer. Validate with
`node scripts/check-drawer-focus.cjs --preview`; the default checks production.
