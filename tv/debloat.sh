#!/bin/sh
# Optional, reversible cleanup for this TV. No firmware files or DNS rules are changed.
set -eu
export PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
DATA=/home/root/lg-tv-vibehack
STATE=$DATA/debloat-state
UNITS='voiceinput.service voiceconductor.service miracast.service contentminer.service'
BINARIES='amazon-alexa-adapter google-assistant-adapter sportsalarm voiceinput'
[ "$(id -u)" = 0 ] || { echo 'Root required' >&2; exit 1; }
case "${1:-status}" in
  apply)
    [ -f "$DATA/debloat.enabled" ] || exit 0
    mkdir -p "$STATE"
    # The stub is bind-mounted in memory; original firmware bytes are untouched.
    if [ ! -f "$STATE/noop" ]; then printf '#!/bin/sh\nexit 0\n' > "$STATE/noop"; chmod 755 "$STATE/noop"; fi
    for name in $BINARIES; do
      target=/usr/sbin/$name
      [ -f "$target" ] || continue
      if mountpoint -q "$target"; then
        if [ ! -f "$STATE/$name.bound" ] || ! cmp -s "$STATE/noop" "$target"; then
          echo "Existing external override retained: $target"
          continue
        fi
      else
        mount --bind "$STATE/noop" "$target"
        mount -o remount,bind,ro "$target"
        touch "$STATE/$name.bound"
      fi
      pkill -f "^$target([[:space:]]|$)" 2>/dev/null || true
      echo "Disabled unused backend: $name"
    done
    for unit in $UNITS; do
      [ "$(systemctl show -p LoadState --value "$unit")" != not-found ] || continue
      # Do not take ownership of a mask made by another tool.
      prior=$(systemctl is-enabled "$unit" 2>/dev/null || true)
      if [ "$prior" = masked ] || [ "$prior" = masked-runtime ]; then
        [ -f "$STATE/$unit.owned" ] || continue
      fi
      if [ ! -f "$STATE/$unit.original" ]; then
        systemctl is-active "$unit" > "$STATE/$unit.original" || true
      fi
      systemctl mask --runtime "$unit"
      touch "$STATE/$unit.owned"
      systemctl stop "$unit"
      echo "Disabled unused service: $unit"
    done
    ;;
  restore)
    rm -f "$DATA/debloat.enabled"
    for name in $BINARIES; do
      target=/usr/sbin/$name
      [ -f "$STATE/$name.bound" ] || continue
      if mountpoint -q "$target" && cmp -s "$STATE/noop" "$target"; then umount "$target"; fi
      rm "$STATE/$name.bound"
    done
    for unit in $UNITS; do
      [ -f "$STATE/$unit.owned" ] || continue
      systemctl unmask --runtime "$unit"
      if grep -qx active "$STATE/$unit.original"; then systemctl start "$unit"; fi
      rm "$STATE/$unit.owned" "$STATE/$unit.original"
    done
    echo 'Original executables and optional units restored. Reboot to finish normal native-service startup.'
    ;;
  status)
    for name in $BINARIES; do
      target=/usr/sbin/$name
      if mountpoint -q "$target" && cmp -s "$STATE/noop" "$target"; then echo "$name: overridden by local no-op"; else echo "$name: original executable"; fi
    done
    for unit in $UNITS; do
      echo "$unit: $(systemctl is-active "$unit" 2>/dev/null || true) / $(systemctl is-enabled "$unit" 2>/dev/null || true)"
    done
    ;;
  *) echo 'Use apply, restore or status' >&2; exit 1;;
esac
