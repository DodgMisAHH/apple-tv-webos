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
| `video-overlay.jpg` | Floating Control Centre over the Sintel trailer in the browser video demo |

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

For the video composition, run:

```sh
python3 scripts/preview-video-overlay.py
```

Open `http://127.0.0.1:4798`, play the sample and use Show/Hide Control Centre.
This preview serves the actual floating panel with a browser-only lifecycle
bridge and empty personal settings. The video runs independently beneath it;
the screenshot does not establish overlay compatibility with TV streaming apps.

The sample and its frame in `video-overlay.jpg` are from **Sintel**, © copyright
Blender Foundation | [durian.blender.org](https://durian.blender.org/), licensed
under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The complete
[trailer](https://media.w3.org/2010/05/sintel/trailer.mp4) streams from W3C's media
host. The screenshot adds the project's interface over the frame; the film is
not bundled with this repository. See the film's
[sharing terms](https://durian.blender.org/sharing/).
