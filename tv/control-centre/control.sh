#!/bin/sh
# Only Settings key 139 is changed. No system file mounts or startup hooks.
set -eu
export PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
BASE=/home/root/lg-tv-vibehack/control-centre
RUN=/tmp/lg-tv-control-centre
HOOK_APP=/media/developer/apps/usr/palm/applications/org.webosbrew.inputhook
mkdir -p "$RUN"
chmod 700 "$RUN"
fail() { echo "$*" >&2; exit 1; }
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$RUN/control.log"; }
state() { node "$BASE/state.js" "$@"; }
lock() { exec 9>"$RUN/control.lock"; flock -w 20 9 || fail 'Another Settings integration operation is running.'; }
check() {
  [ "$(id -u)" = 0 ] || fail 'Root required.'
  [ -d "$HOOK_APP" ] || fail 'Install and open LG Input Hook first.'
  [ -x "$BASE/toggle.sh" ] && [ -s "$BASE/state.js" ] || fail 'Control Centre runtime missing.'
  state check
}
restore() {
  # Stop only this optional helper's owned session, even if recovery discovers
  # a newer foreign Settings binding and leaves that binding untouched.
  if [ -f /home/root/lg-tv-vibehack/native-blur/runtime.sh ] && [ -f /tmp/lg-tv-native-blur/current.json ]; then
    sh /home/root/lg-tv-vibehack/native-blur/runtime.sh close >> "$RUN/control.log" 2>&1 || true
  fi
  state restore "${1:-}" || return 1
  rm -f "$RUN/lease" "$RUN/guard.pid" "$BASE/recovery/launch-cache"
  log 'Settings recovery completed; any newer foreign binding was retained.'
}
arm() {
  check
  current=$(state status) || return 1
  case "$current" in
    confirmed) echo 'Settings already points to Control Centre persistently.'; return;;
    trial) echo 'Settings trial already active; its original expiry is unchanged.'; return;;
    expired|restored) restore || return 1;;
    foreign) fail 'Settings changed elsewhere; inspect the retained recovery snapshot before another trial.';;
  esac
  token="$(date +%s)-$$"
  deadline=$(( ($(date +%s) + 600) * 1000 ))
  printf '%s\n' "$token" > "$RUN/lease"
  # Start recovery before changing the durable Input Hook key map.
  nohup setsid sh "$BASE/control.sh" watch "$token" >> "$RUN/guard.log" 2>&1 < /dev/null 9>&- &
  guard=$!
  echo "$guard" > "$RUN/guard.pid"
  sleep 1
  kill -0 "$guard" 2>/dev/null || { rm -f "$RUN/lease" "$RUN/guard.pid"; fail 'Rollback guard did not start.'; }
  trap 'restore; exit 1' HUP INT TERM
  if ! state install "$token" "$deadline"; then restore; return 1; fi
  sh "$BASE/toggle.sh" refresh-cache >> "$RUN/control.log" 2>&1 || log 'Launch cache unavailable; next press will validate fully.'
  trap - HUP INT TERM
  log 'Settings key 139 trial started; automatic restore in 600 seconds.'
  echo 'Settings now opens Control Centre for a ten-minute trial. Run confirm after testing playback and Back.'
}
case "${1:-status}" in arm|install|confirm|restore|disable|rollback) lock;; esac
case "${1:-status}" in
  check) check;;
  arm|install) arm;;
  confirm)
    check
    state confirm
    sh "$BASE/toggle.sh" refresh-cache >> "$RUN/control.log" 2>&1 || log 'Launch cache unavailable; next press will validate fully.'
    rm -f "$RUN/lease" "$RUN/guard.pid"
    echo 'Settings mapping saved. Restore with: sh /home/root/lg-tv-vibehack/control-centre/control.sh restore'
    ;;
  restore|disable) restore;;
  rollback)
    token=${2:?Missing trial token}
    [ -f "$RUN/lease" ] && [ "$(cat "$RUN/lease")" = "$token" ] || exit 0
    restore "$token"
    ;;
  watch)
    token=${2:?Missing trial token}; elapsed=0
    while [ -f "$RUN/lease" ] && [ "$(cat "$RUN/lease")" = "$token" ]; do
      # A durable expiry is also enforced by toggle.sh after any reboot.
      if [ "$elapsed" -ge 600 ] || { [ "$elapsed" -ge 2 ] && [ "$(state status 2>/dev/null || true)" = expired ]; }; then
        log 'Settings trial lease expired.'
        if sh "$BASE/control.sh" rollback "$token"; then exit 0; fi
      fi
      sleep 2; elapsed=$((elapsed + 2))
    done
    ;;
  status)
    state status
    [ ! -f "$RUN/lease" ] || echo "Trial guard token: $(cat "$RUN/lease")"
    ;;
  *) fail 'Use check, arm (or install), status, confirm, restore (or disable).';;
esac
