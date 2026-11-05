# Asset credits

This shareable edition uses system fonts and original generic control icons. It
contains no Apple SF Pro font files or SF Symbols exports. The original local
TV build remains separate and is not the source of release assets.

- `app/ui-icons/*.svg`: original geometric control drawings for this project,
  MIT; see `app/ui-icons/LICENSE.txt`.
- `app/wallpapers/misty.jpg` and `misty-frost.jpg`: **Misty coast**, Ganapathy Kumar,
  [Unsplash photo](https://unsplash.com/photos/n4VMQZIkgDg), under the
  [Unsplash License](https://unsplash.com/license). The second file is a softened
  texture derived from the same photograph.
- Stremio, Netflix, YouTube, Apple TV, Apple Music and Prime Video marks:
  Simple Icons, CC0. Exact sources and transformations are recorded in
  `app/marks/SOURCES.json`. The red Netflix/YouTube variants change fill colour.
- NVIDIA mark: Simple Icons, CC0, revision
  `4d29a35c954699b389a834aacc97dd6e7e74143c`; recoloured white. See
  `app/marks/ADDITIONAL-SOURCES.json`.
- Disney+ mark: Custom Brand Icons, MIT, revision
  `a53cabf49bf439023a8f33585af30d783bffe51b`.
- Browser compass and Apps grid: original SVG drawings for this launcher.
- `app/qrcode.js`: qrcode-generator, Kazuhiko Arase, MIT; notice retained in source.
- The film frame in `docs/media/video-overlay.jpg` and the streamed trailer in
  the video preview: **Sintel**, © copyright Blender Foundation |
  [durian.blender.org](https://durian.blender.org/),
  [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
  [Sharing terms](https://durian.blender.org/sharing/). The screenshot adds the
  project's Control Centre over a film frame. The full trailer streams from
  [W3C's media host](https://media.w3.org/2010/05/sintel/trailer.mp4); no video file
  is bundled in this repository.

The wallpaper and initial brand assets were adapted from
[CleanFrame](https://github.com/nthnclrk/CleanFrame), pinned at
`58ac92a7b8f80047ca26e5b7097f5e1616762db0`. Its MIT notice and the icon license
texts are retained in `app/marks/`. The provenance registers may also list
upstream assets that are not included here.

Icons downloaded from a user's TV are generated local files under `app/icons/`
and are excluded from Git. Brand names and marks identify third-party apps;
this project does not claim affiliation or endorsement by their owners.

See [LICENSE](../LICENSE) for the application code's MIT terms and preserved
upstream copyright notices, and `tv/system-home/NOTICE` for native Home design
attribution.
