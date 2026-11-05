# README screenshots

These screenshots show the shareable build in the local browser preview, using
`app/apps.example.js`, empty `app/user.example.js`, the bundled Misty coast photo,
system fonts and the project's original SVG controls. They are illustrative
browser captures, not photographs or compatibility tests on a physical TV.

| Image | View |
| --- | --- |
| `home.jpg` | Home with the favourites shelf |
| `app-grid.jpg` | Expanded app grid after pressing Down |
| `control-centre.jpg` | Home's Control Centre after pressing Up from favourites |

Captured on 5 November 2026 at 1280 × 720, displaying the same scaled 1920 × 1080
canvas used by the launcher. JPEG files are unedited browser screenshots. The
Control Centre's unavailable services reflect browser preview mode; no TV was
connected or controlled.

To reproduce, use a fresh browser origin/profile and the generic runtime data:

```sh
node scripts/prepare-app.cjs
python3 scripts/preview.py
```

The seed script preserves existing runtime files. If you have synced a real TV,
use a fresh checkout for public screenshots so personal inventory, wallpapers,
network details and pairing QR codes do not appear. See
[asset credits](../ASSET-CREDITS.md) for the photo and app-mark provenance.
