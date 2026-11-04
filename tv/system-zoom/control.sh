#!/bin/sh
# One-boot, owned bind-mount prototype. This file never edits read-only firmware.
set -eu
export PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
BASE=/home/root/lg-tv-vibehack/system-zoom
LEASE=/tmp/lg-tv-system-zoom.lease
ARMED=/tmp/lg-tv-system-zoom.armed
ENABLED=/tmp/lg-tv-system-zoom.enabled
UNIT=surface-manager-daemon.service

target() {
    case "$1" in
      Wiper.qml) echo /usr/lib/qml/Eos/Items/Wiper.qml ;;
      StarfishImageSplash.qml) echo /usr/lib/qml/WebOSCompositor/views/StarfishImageSplash.qml ;;
      StarfishFullscreenDelegate.qml) echo /usr/lib/qml/WebOSCompositor/views/fullscreen/StarfishFullscreenDelegate.qml ;;
      *) return 1 ;;
    esac
}

owned() {
    [ "$(stat -c '%d:%i' "$1")" = "$(stat -c '%d:%i' "$2")" ]
}

reopen_home() {
    flag=${1:-false}
    tries=0
    while ! systemctl is-active --quiet "$UNIT" && [ "$tries" -lt 30 ]; do
        sleep 1
        tries=$((tries + 1))
    done
    tries=0
    while [ "$tries" -lt 8 ]; do
        sleep 3
        result=$(luna-send -n 1 luna://com.webos.applicationManager/launch \
            "{\"id\":\"com.gathin.tvhome\",\"params\":{\"reload\":true,\"systemZoomTest\":$flag}}" || true)
        printf '%s\n' "$result"
        if printf '%s' "$result" | grep -q '"returnValue"[[:space:]]*:[[:space:]]*true'; then return 0; fi
        tries=$((tries + 1))
    done
    return 1
}

rollback() {
    # Remove activation first, so new launches immediately fall back to stock behaviour.
    rm -f "$ENABLED" "$LEASE" /tmp/lg-tv-launch-origin.json /tmp/lg-tv-launch-origin.tmp
    for name in Wiper.qml StarfishImageSplash.qml StarfishFullscreenDelegate.qml; do
        dest=$(target "$name")
        if owned "$dest" "$BASE/patched/$name"; then
            umount "$dest"
            echo "Restored $name"
        fi
    done
    if [ -f "$ARMED" ]; then
        rm -f "$ARMED"
        systemctl restart "$UNIT"
        reopen_home false
    fi
}

case "${1:-status}" in
  check)
    [ "$(id -u)" = 0 ]
    [ "$(systemctl show "$UNIT" -p ActiveState)" = ActiveState=active ]
    [ -s "$BASE/qml/ZoomWiper.qml" ] && [ -s "$BASE/qml/LaunchOrigin.js" ]
    printf '%s\n' \
      '58738db0930367f620742da57cdb235e866476668da42ca7fe528189ae1d465c  /usr/lib/qml/Eos/Items/Wiper.qml' \
      'd1e051dd4ca71a1e3492499d0e212e646fb9849fcb66c79030b7b815603724b3  /usr/lib/qml/WebOSCompositor/views/StarfishImageSplash.qml' \
      'dec8bd389c364b6d1b6d04dc304f0079c69cacfb67cd58ad33c7a65f9134a7d7  /usr/lib/qml/WebOSCompositor/views/fullscreen/StarfishFullscreenDelegate.qml' | sha256sum -c -
    echo 'Original firmware hashes and running display service verified.'
    ;;
  arm)
    [ ! -e "$ARMED" ] && [ ! -e "$LEASE" ] || { echo 'A test is already active; use status or rollback.' >&2; exit 1; }
    sh "$BASE/control.sh" check
    backup="$BASE/recovery/$(date +%Y%m%d-%H%M%S)-$$"
    mkdir -p "$backup"
    for name in Wiper.qml StarfishImageSplash.qml StarfishFullscreenDelegate.qml; do cp -p "$(target "$name")" "$backup/$name"; done
    token="$(date +%s)-$$"
    printf '%s\n' "$token" > "$LEASE"
    # Independent guard must survive this SSH connection and the display-server restart.
    nohup sh "$BASE/control.sh" watch "$token" > "$BASE/guard.log" 2>&1 < /dev/null &
    guard_pid=$!
    echo "$guard_pid" > /tmp/lg-tv-system-zoom.guard-pid
    sleep 1
    kill -0 "$guard_pid" || { rm -f "$LEASE"; echo 'Rollback guard did not start.' >&2; exit 1; }
    trap 'sh "$BASE/control.sh" rollback' HUP INT TERM
    for name in Wiper.qml StarfishImageSplash.qml StarfishFullscreenDelegate.qml; do
        mount -o bind "$BASE/patched/$name" "$(target "$name")" || { rollback; exit 1; }
    done
    touch "$ENABLED" "$ARMED"
    (umask 077; : > /tmp/lg-tv-zoom-stock.json; : > /tmp/lg-tv-zoom-origin.json; : > /tmp/lg-tv-zoom-component.json)
    systemctl restart "$UNIT"
    reopen_home true || { rollback; exit 1; }
    echo 'Native zoom test active. Automatic stock restoration in 300 seconds unless confirmed. No boot hook installed.'
    ;;
  watch)
    token=${2:?Missing lease token}
    seconds=0
    while [ -f "$LEASE" ] && [ "$(cat "$LEASE")" = "$token" ]; do
        if [ "$seconds" -ge 300 ]; then
            echo 'Test lease expired; restoring the stock compositor.'
            rollback
            exit 0
        fi
        if [ "$seconds" -ge 30 ] && ! systemctl is-active --quiet "$UNIT"; then
            echo 'Display server failed its health check; restoring stock.'
            rollback
            exit 0
        fi
        sleep 1
        seconds=$((seconds + 1))
    done
    ;;
  confirm)
    [ -f "$ARMED" ] && [ -f "$ENABLED" ] || { echo 'No active test.' >&2; exit 1; }
    rm -f "$LEASE"
    echo 'Test confirmed for this boot only. Reboot or rollback restores stock; no persistent hook installed.'
    ;;
  rollback) rollback ;;
  status)
    [ ! -f "$ENABLED" ] || echo 'Native zoom enabled for this boot.'
    [ ! -f "$LEASE" ] || echo 'Automatic rollback timer active.'
    for name in Wiper.qml StarfishImageSplash.qml StarfishFullscreenDelegate.qml; do
        if owned "$(target "$name")" "$BASE/patched/$name"; then echo "Owned override: $name"; else echo "Stock file: $name"; fi
    done
    systemctl show "$UNIT" -p ActiveState -p MainPID
    ;;
  *) echo 'Use check, arm, status, confirm or rollback.' >&2; exit 2 ;;
esac
