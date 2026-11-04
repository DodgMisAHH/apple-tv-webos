#!/bin/sh
# Run ON the TV after root has been verified following a full reboot.
# The locally built app must already be installed. No downloads or app replacement.
set -eu
export PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
APP=/media/developer/apps/usr/palm/applications/com.gathin.tvhome
DATA=/home/root/lg-tv-vibehack
INIT=/var/lib/webosbrew/init.d/00-lg-tv-vibehack
LEGACY_INIT=/var/lib/webosbrew/init.d/lg-tv-vibehack
HOOK=/home/root/.config/lginputhook/keybinds.json
SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MODE=${1:-prepare}
fail() { echo "$*" >&2; exit 1; }
case "$MODE" in prepare|startup|home|disable) ;; *) fail 'Use prepare, startup, home or disable';; esac
[ "$(id -u)" = 0 ] || fail 'Root SSH is required.'
[ -d /var/lib/webosbrew ] || fail 'Homebrew startup directory missing; verify persistent root first.'
[ "$MODE" = disable ] || [ -f "$APP/appinfo.json" ] || fail 'Install the local launcher package first.'
mkdir -p "$DATA/recovery"
case "$MODE" in
  prepare)
    # Refuse to write until Homebrew itself confirms root.
    CHECK=$(luna-send -n 1 luna://org.webosbrew.hbchannel.service/getConfiguration '{}')
    printf '%s' "$CHECK" | node -e 'var s="";process.stdin.on("data",function(d){s+=d});process.stdin.on("end",function(){var j=JSON.parse(s);if(!j.root)process.exit(1)});' || fail 'Homebrew did not confirm root.'
    for f in boot.sh early-launch.sh debloat.sh golauncher.sh homewatch.js sync.js publication.js wallpaper-server.js wallpaper.html keybinds.js preferences-cleanup.js; do
      [ -f "$SOURCE/$f" ] || fail "Missing staged file: $f"
    done
    SNAP="$DATA/recovery/files-$(date +%Y%m%d-%H%M%S)"
    mkdir "$SNAP"
    for f in boot.sh early-launch.sh debloat.sh golauncher.sh homewatch.js sync.js publication.js wallpaper-server.js wallpaper.html settings.json; do
      [ ! -f "$DATA/$f" ] || cp -p "$DATA/$f" "$SNAP/$f"
    done
    # Seed the supplied photograph only on a new setup; retain existing wallpaper/settings.
    if [ ! -f "$DATA/settings.json" ]; then
      echo '{"wallpaperDim":0.12,"ambientGlow":false}' > "$DATA/settings.json"
      [ -f "$DATA/wallpaper.jpg" ] || cp "$APP/wallpapers/misty.jpg" "$DATA/wallpaper.jpg"
    fi
    if [ "$SOURCE" != "$DATA" ]; then
      for f in boot.sh early-launch.sh debloat.sh golauncher.sh homewatch.js sync.js publication.js wallpaper-server.js wallpaper.html keybinds.js preferences-cleanup.js integrate.sh; do cp "$SOURCE/$f" "$DATA/$f"; done
    fi
    chmod 755 "$DATA/boot.sh" "$DATA/golauncher.sh"
    mkdir -p "$DATA/icons"
    node "$DATA/sync.js"
    echo 'Prepared local integration; Home and startup are not enabled yet.'
    ;;
  startup)
    [ -f "$DATA/boot.sh" ] || fail 'Run prepare first.'
    mkdir -p /var/lib/webosbrew/init.d
    if [ -f "$INIT" ] && ! cmp -s "$INIT" "$DATA/boot.sh"; then
      [ -f "$DATA/recovery/startup-before" ] || cp -p "$INIT" "$DATA/recovery/startup-before"
    fi
    cp "$DATA/boot.sh" "$INIT"
    chmod 755 "$INIT"
    # run-parts is sequential: start our background watcher before Input Hook's blocking init.
    if [ -f "$LEGACY_INIT" ] && grep -q '/home/root/lg-tv-vibehack' "$LEGACY_INIT"; then
      cp -p "$LEGACY_INIT" "$DATA/recovery/startup-old-name"
      rm "$LEGACY_INIT"
    fi
    echo 'Startup enabled for the next boot.'
    ;;
  home)
    [ -f "$DATA/golauncher.sh" ] || fail 'Run prepare first.'
    [ -d /media/developer/apps/usr/palm/applications/org.webosbrew.inputhook ] || fail 'Install and open LG Input Hook first.'
    node "$SOURCE/keybinds.js" install "$HOOK" "$DATA/recovery/home-before.json" "$DATA/golauncher.sh"
    ;;
  disable)
    if [ -f "$INIT" ] && grep -q '/home/root/lg-tv-vibehack' "$INIT"; then
      if [ -f "$DATA/recovery/startup-before" ]; then cp -p "$DATA/recovery/startup-before" "$INIT"; else rm "$INIT"; fi
    fi
    if [ -f "$LEGACY_INIT" ] && grep -q '/home/root/lg-tv-vibehack' "$LEGACY_INIT"; then rm "$LEGACY_INIT"; fi
    node "$SOURCE/keybinds.js" restore "$HOOK" "$DATA/recovery/home-before.json" "$DATA/golauncher.sh"
    pkill -f "$DATA/homewatch.js" 2>/dev/null || true
    pkill -f "$DATA/wallpaper-server.js" 2>/dev/null || true
    echo 'Launcher integration disabled; app, photos and preferences retained. Reboot to finish.'
    ;;
esac
