# apple-tv-webos

An Apple TV–inspired home screen and Control Centre for LG webOS TVs. It combines a glass favourites shelf, an expandable app grid, remote-friendly navigation and a configurable wallpaper in a plain HTML, CSS and JavaScript app.

This is an independent adaptation of [LG TV Vibehack](https://github.com/hoangvya19/lg-tv-webos-vibehack). It is not an Apple TV operating system, streaming service or official Apple/LG product. The webOS app ID remains `com.gathin.tvhome` so existing installations can retain their settings.

[Setup and recovery](docs/SETUP.md) · [Shareable edition](docs/PUBLIC-SHARING.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Asset credits](docs/ASSET-CREDITS.md) · [Tiếng Việt](README.vi.md)

## What it includes

- A favourites row and expandable installed-app grid, with Move, Hide and restore actions.
- Pointer and directional-remote navigation, long-press menus and stepwise Back navigation.
- A clock, English/Vietnamese interface and configurable weather from Open-Meteo.
- A local wallpaper, glass-style surfaces and controls for inputs and TV settings.
- Rooted-TV helpers for Home-button routing, startup, app inventory sync and a phone wallpaper page.
- A separate Control Centre overlay for rooted TVs, with Settings-button routing and reversible installation.

Available controls depend on the TV's services and permissions. Wi-Fi joining and optional VPN controls need additional TV-side configuration; see [Settings integration](docs/SETTINGS-OVERLAY.md) and [VPN presets](docs/VPN-PRESETS.md).

## Try the browser preview

Requires Node.js 22 and Python 3. From this checkout:

```sh
node scripts/prepare-app.cjs
python3 scripts/preview.py
```

Open [localhost:4795](http://127.0.0.1:4795). The preview serves only the app directory on the local loopback interface and reloads when assets change. It does not control a TV. The seed command creates ignored runtime files from generic examples without overwriting existing files.

| Input | Action |
| --- | --- |
| Arrows or pointer | Move between apps and controls |
| Enter / remote OK | Open the selected item |
| Hold OK on an app | Move or hide the app |
| Down from favourites | Expand the app grid |
| Up from favourites / select the clock | Open Control Centre |
| Escape / remote Back | Cancel, return to the previous menu or close the panel |

## Install on a TV

Start with [the setup guide](docs/SETUP.md), which covers prerequisites, local packaging, device installation and recovery.

| Installation | What to expect |
| --- | --- |
| Developer Mode | Launcher app and manual inventory sync. Developer Mode must remain valid. No system Home replacement or boot integration. |
| Rooted TV with Homebrew | Optional Home-button and startup integration, wallpaper service and TV-side inventory sync. |
| Native Home / global overlay | Additional integrations with separate checks and recovery. Native Home is tied to the tested firmware's executable and manifest hashes. |

Build this repository's source. The original project's installer and releases contain a different launcher design. There is no assumption that a release package exists for this repository yet.

The source targets older webOS browser and TV Node runtimes, but the current adaptation does **not** have a complete model/firmware compatibility matrix. Historical single-device observations in [the development notes](docs/LOCAL-LAUNCHER.md) are evidence for those versions and that setup, not a guarantee for another TV. Browser checks cannot establish playback, physical remote, standby or reboot behavior.

## Build and check

Desktop development uses Node.js 22 and Python 3. Install the LG webOS CLI for packaging and device access, then run:

```sh
npm ci --ignore-scripts
node scripts/prepare-app.cjs
node scripts/check-launcher.cjs
mkdir -p build/home
ares-package app -o build/home
```

To build the separate Control Centre package:

```sh
node scripts/build-control-centre.cjs
ares-package build/control-centre/app -o build/control-centre
```

The checks run locally without contacting a TV. The pinned Acorn development dependency checks ES5 syntax; the shipped app and TV helpers have no npm runtime dependencies. See [Contributing](CONTRIBUTING.md) for the full verification workflow and runtime compatibility rules. Build outputs, device credentials and private recovery files belong outside Git.

## Project layout

| Path | Purpose |
| --- | --- |
| `app/` | Launcher and shared Control Centre UI |
| `tv/` | Rooted-TV sync, wallpaper, Home and startup helpers |
| `tv/control-centre/` | Reversible Settings-button routing |
| `tv/system-home/` | Firmware-specific native Home integration |
| `tv/native-blur/`, `tv/system-zoom/` | Retained experiments; not part of the normal setup |
| `scripts/` | Desktop preview, packaging and regression checks |
| `docs/` | Setup, architecture, asset provenance and historical device notes |

The normal floating Control Centre uses static translucent surfaces. The retained native-blur experiment does not establish support for blurring video playback. Historical documents may describe private assets or earlier builds that are not included in the shared source.

## Credits and license

This adaptation retains the [MIT license](LICENSE) and upstream copyright notices for Gathin, OmkarK97 and hoangvya19. The launcher lineage includes [Gathin23/tv-vibehack](https://github.com/Gathin23/tv-vibehack) and [hoangvya19/lg-tv-webos-vibehack](https://github.com/hoangvya19/lg-tv-webos-vibehack).

The appearance also draws on [CleanFrame](https://github.com/nthnclrk/CleanFrame). Wallpaper, brand marks and other assets have their own provenance and terms in [Asset credits](docs/ASSET-CREDITS.md). App names and trademarks belong to their respective owners; their inclusion identifies apps and does not imply endorsement.

Thanks to the [webOS Homebrew Project](https://www.webosbrew.org), [LG Input Hook](https://github.com/Simon34545/lginputhook) and [Open-Meteo](https://open-meteo.com).
