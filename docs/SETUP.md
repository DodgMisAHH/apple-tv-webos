# Setup and recovery

Build this checkout to install the `apple-tv-webos` adaptation. The upstream project's one-line installer downloads its own release and would replace this appearance. This shareable source copy is maintained separately from the original working TV checkout. Its default typography and control icons are suitable for redistribution; private font files, device inventory and recovery data are not included. See [the shareable-edition notes](PUBLIC-SHARING.md) for these differences and release preparation.

## Choose an installation path

The launcher can be installed through LG Developer Mode without root. Home-button routing, startup and the phone wallpaper service use a rooted TV with Homebrew. Native Home replacement and the floating Settings overlay are separate optional integrations.

This guide assumes an already configured Developer Mode connection or already verified persistent root. It does not root a TV. Root availability and service behavior vary by model and firmware. Keep a working recovery connection and verify each stage on your own device.

## Preview and build on your computer

Use Node.js 22, Python 3 and LG's webOS CLI (`ares-*`) for packaging/device access. CI and the installer fallback use `@webos-tools/cli@3.2.6`. Run commands from the repository root:

```sh
node scripts/prepare-app.cjs
python3 scripts/preview.py
```

Open [localhost:4795](http://127.0.0.1:4795). Stop the server with Ctrl+C when done. The seed command creates ignored `app/apps.js` and `app/user.js` from generic tracked examples if they do not already exist; it preserves existing local runtime data. The browser preview cannot test TV permissions, video playback or physical remote behavior.

Install the locked development dependencies, then check and package Home:

```sh
npm ci --ignore-scripts
node scripts/prepare-app.cjs
node scripts/check-launcher.cjs
mkdir -p build/home
ares-package app -o build/home
```

The npm dependency is Acorn, used only for development-time ES5 syntax checks. The shipped app and TV helpers do not require npm packages.

The output is `build/home/com.gathin.tvhome_<version>_all.ipk`. The package ID is intentionally retained from upstream. Installing it over an existing app with that ID updates that app; keep a backup of any installation you want to restore.

## Developer Mode

On the TV, configure LG's Developer Mode app and enable its Key Server. On the computer, the included helper can configure a CLI device, pair with the TV, read its app list, package Home and install it:

```sh
./install-noroot.sh
```

It prompts for the TV address and pairing details. Accept the pairing prompt on the TV. The helper creates a local Python environment and installs the pinned dependencies from `requirements.txt`; it uses the installed webOS CLI or invokes the pinned CLI through `npx`. Packages are written to a new directory under `build/`, preserving earlier build artifacts.

Set `DEVICE` if your CLI device is not named `lgtv`. Set `TV_HOST` to supply the TV address without the address prompt. Keep `.tv-host`, `.lgtv-key.json` and downloaded inventory/icons private.

For manual packaging, create the Python environment first if you did not run the installer, then use your configured CLI device name:

```sh
python3 -m venv venv
venv/bin/pip install -r requirements.txt
node scripts/prepare-app.cjs
mkdir -p build/home
venv/bin/python sync-apps.py <TV-IP>
ares-package app -o build/home
ares-install -d <device-name> build/home/com.gathin.tvhome_<version>_all.ipk
ares-launch -d <device-name> com.gathin.tvhome
```

Replace the angle-bracket placeholders before running these commands. Re-run inventory sync and package/install after adding or removing TV apps. Developer Mode expiration can remove installed developer apps; maintain the session through the Developer Mode app.

Edit `app/config.js` before packaging for default language, clock, wallpaper, columns and weather. A saved TV preference can override the default. Long-press an app to change its position or visibility. For a quick-launch shortcut, use the TV's supported number-key shortcut feature while the launcher is open.

## Rooted TV: install the local package

Use the package built above and your existing rooted-TV installation method. One path is to copy the IPK to `/tmp/apple-tv-webos.ipk` on the TV and run this over root SSH:

```sh
luna-send -i luna://com.webos.appInstallService/dev/install \
  '{"id":"com.ares.defaultName","ipkUrl":"/tmp/apple-tv-webos.ipk","subscribe":true}'
```

Wait for the installation to report completion; the first reply may only acknowledge the request. Stop the subscription with Ctrl+C after completion. Open Home and verify navigation and app launching before adding startup or remote bindings.

## Rooted TV: Home button, startup and wallpaper

Requires Homebrew with working persistent root and, for Home remapping, an installed and opened LG Input Hook app. Copy the repository's `tv/` directory to `/tmp/lg-launcher-stage/` on the TV. Review `tv/integrate.sh`, then run each stage over root SSH:

```sh
sh /tmp/lg-launcher-stage/integrate.sh prepare
sh /tmp/lg-launcher-stage/integrate.sh home
sh /tmp/lg-launcher-stage/integrate.sh startup
```

`prepare` copies helpers to `/home/root/lg-tv-vibehack`, preserves existing settings/wallpaper and synchronizes apps. It requires the local Home package to be installed. `home` saves the existing Home-key action and changes that key. `startup` adds a Homebrew startup hook for the next boot.

Reboot when ready and check Home from another app, arrows/OK/Back, app playback, standby/wake and a full restart. The startup helper also starts the phone wallpaper service. Its QR URL contains a token; keep it within your trusted local network.

The optional service-cleanup profile is not needed to use Home. Do not enable it as part of a routine installation. Native Home and global Settings integration are also separate from these three stages.

### Restore this integration

Over root SSH:

```sh
sh /home/root/lg-tv-vibehack/integrate.sh disable
```

Then reboot. This stops the owned watcher/wallpaper processes, restores the saved Home action when it still belongs to this integration, and removes or restores the owned startup hook. It retains the app, photos, settings and recovery records. It does not disable the separate native Home or Settings integrations below.

## Optional floating Control Centre

Build its package on your computer:

```sh
node scripts/build-control-centre.cjs
ares-package build/control-centre/app -o build/control-centre
```

Install `com.gathin.tvcontrolcentre_<version>_all.ipk` using your configured TV installation method. Keep Home and the overlay built from the same checkout because they share controls and routing behavior.

Follow [the Settings integration guide](../tv/control-centre/README.md) to stage its helpers, check prerequisites and start a ten-minute trial. Verify continued playback, Settings toggling and Back/focus restoration before confirming persistence. Restore its binding with:

```sh
sh /home/root/lg-tv-vibehack/control-centre/control.sh restore
```

Wi-Fi joining needs the additional scoped permission setup described in [Settings overlay](SETTINGS-OVERLAY.md). Optional VPN controls require the separately configured helper described in [VPN presets](VPN-PRESETS.md).

## Advanced and experimental integrations

[Native Home](SYSTEM-HOME.md) runs this UI under the system Home identity. Its controller deliberately checks exact firmware hashes. Do not bypass a mismatch: that firmware has not passed this integration's preflight. It has its own temporary trial, confirmation and startup stages. To disable an installed native Home integration:

```sh
sh /home/root/lg-tv-vibehack/system-home/control.sh disable
```

The native-blur and compositor-zoom directories retain experimental work and are not enabled by the setup above. The normal floating overlay uses static materials. Historical notes describe tests on one development TV and may reference earlier package versions or private assets.

## Remove the app

Restore any enabled native Home, Settings and basic Home/startup integrations first, using their individual commands above. Then remove `com.gathin.tvcontrolcentre` and/or `com.gathin.tvhome` through your configured app-management tool. App removal can delete its browser storage; keep any preferences you need before doing so. Retain recovery files until you have verified the original TV behavior.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Empty app grid | Run desktop inventory sync and repackage, or `node /home/root/lg-tv-vibehack/sync.js` on a rooted installation. |
| Home opens LG's original screen | Check that LG Input Hook is running and the `home` stage succeeded; inspect the saved binding without overwriting unrelated keys. |
| Phone wallpaper page unavailable | Check the same local network, service startup and current QR token; do not publish the token in an issue. |
| Wi-Fi/other controls unavailable | Check the relevant service permissions and use the offered LG Settings fallback. |
| Native Home preflight fails | Keep the normal launcher and original Home behavior; do not remove its firmware checks. |

Report the commit/package version, TV model, firmware, exact steps and sanitized errors. Separate script success from what was visible on the TV.
