#!/bin/sh
# Input Hook exec actions are key-down only; its releases/repeats are suppressed.
set -eu
export PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
BASE=/home/root/lg-tv-vibehack/control-centre
RUN=/tmp/lg-tv-control-centre
APP=/media/developer/apps/usr/palm/applications/com.gathin.tvcontrolcentre
HOME_APP=/media/developer/apps/usr/palm/applications/com.gathin.tvhome
HOME_DESCRIPTION=/home/root/lg-tv-vibehack/system-home/wam-launch.json
HOME_ACTIVE=/tmp/lg-tv-system-home.active
KEY=/home/root/.config/lginputhook/keybinds.json
CACHE="$BASE/recovery/launch-cache"
NATIVE=/home/root/lg-tv-vibehack/native-blur
NATIVE_RUN=/tmp/lg-tv-native-blur
[ -d "$RUN" ] || { mkdir -p "$RUN"; chmod 700 "$RUN"; }
exec 8>"$RUN/toggle.lock"
flock -n 8 || exit 0
# BusyBox timeout's watchdog can outlive luna-send. Only this wrapper owns the
# toggle lock; a lingering watchdog must not suppress the next Settings press.
luna() { timeout -t 7 luna-send -w 5000 -n 1 "${2:-luna://com.webos.applicationManager/launch}" "$1" 8>&-; }
ok() { grep -q '"returnValue"[[:space:]]*:[[:space:]]*true'; }
fallback() { luna '{"id":"com.palm.app.settings"}' >> "$RUN/toggle.log" 2>&1 || true; }
optional_fingerprint() {
  for file in "$@"; do
    if [ -f "$file" ]; then sha256sum "$file" || return 1; else printf 'missing %s\n' "$file"; fi
  done
}
input_fingerprint() {
  sha256sum "$KEY" "$BASE/recovery/settings-key.json" "$APP/appinfo.json" "$APP/overlay.html" || return 1
  optional_fingerprint "$HOME_APP/appinfo.json" "$HOME_APP/index.html" "$HOME_APP/home-settings.js" "$HOME_DESCRIPTION" "$HOME_ACTIVE"
  optional_fingerprint "$APP/native-blur.js" "$NATIVE/runtime.sh" "$NATIVE/worker.sh" "$NATIVE/runtime.js" "$NATIVE/bridge.js" "$NATIVE/Host.qml" "$NATIVE/Backdrop.qml" "$NATIVE/qml-release" "$NATIVE/disabled"
}
output_fingerprint() { optional_fingerprint "$BASE/recovery/home-sam-request.json" "$BASE/recovery/home-wam-request.json"; }
fingerprint() { input_fingerprint && output_fingerprint; }
refresh_cache() {
  # Compare both sides of validation so an edit during Node startup cannot be
  # accidentally authorized. This slow path runs only at setup or after a change.
  before=$(input_fingerprint 2>/dev/null) || return 1
  expiry=$(node "$BASE/state.js" authorization 2>> "$RUN/toggle.log") || return 1
  after=$(input_fingerprint 2>/dev/null) || return 1
  [ "$before" = "$after" ] || return 1
  outputs=$(output_fingerprint 2>/dev/null) || return 1
  case "$expiry" in ''|*[!0-9]*) return 1;; esac
  umask 077
  if ! { printf 'control-centre-cache-v2\n%s\n%s\n%s\n' "$expiry" "$after" "$outputs" > "$CACHE.tmp.$$" && mv "$CACHE.tmp.$$" "$CACHE"; }; then
    rm -f "$CACHE.tmp.$$"
    echo 'Launch cache could not be saved; authorization was checked fully.' >> "$RUN/toggle.log"
  fi
  return 0
}
cached_allowed() {
  [ -f "$CACHE" ] || return 1
  { IFS= read -r version && IFS= read -r expiry && expected=$(cat); } < "$CACHE" || return 1
  [ "$version" = control-centre-cache-v2 ] || return 1
  case "$expiry" in ''|*[!0-9]*) return 1;; esac
  actual=$(fingerprint 2>/dev/null) || return 1
  [ "$actual" = "$expected" ] || return 1
  # Code 2 means a validated lease expired; no slow Node call is needed.
  [ "$expiry" = 0 ] || [ "$now" -lt "$expiry" ] || return 2
}
case "${1:-toggle}" in
  refresh-cache) refresh_cache; exit $?;;
  toggle) ;;
  *) echo 'Use toggle or refresh-cache.' >&2; exit 1;;
esac
now=$(date +%s)
authorized=false
if cached_allowed; then
  authorized=true
else
  cache_status=$?
  if [ "$cache_status" != 2 ] && refresh_cache; then authorized=true; fi
fi
if [ "$authorized" != true ]; then
  # Restores an expired trial after a reboot too, without needing a boot hook.
  sh "$BASE/control.sh" restore >> "$RUN/toggle.log" 2>&1 || true
  fallback
  exit 0
fi
# Suppress accidental duplicate key-downs without blocking deliberate toggling.
uptime_ms=$(awk '{ printf "%.0f\n", $1 * 1000 }' /proc/uptime)
last=$(cat "$RUN/last-press" 2>/dev/null || true)
case "$last" in ''|*[!0-9]*) last=0;; esac
delta=$((uptime_ms - last))
[ "$delta" -lt 0 ] || [ "$delta" -ge 250 ] || exit 0
printf '%s\n' "$uptime_ms" > "$RUN/last-press"
request="$now-$$"
payload="{\"id\":\"com.gathin.tvcontrolcentre\",\"keepAlive\":true,\"params\":{\"controlCentre\":true,\"toggle\":true,\"overlayRequestId\":\"$request\"}}"
endpoint=luna://com.webos.applicationManager/launch
focused_id=''
home_routed=false
# Focus identifies an already open overlay above Home, so the next Settings
# press dismisses that overlay instead of opening a second Control Centre.
if focused=$(timeout -t 1 luna-send -w 500 -n 1 luna://com.webos.surfacemanager/getFocusedWindowInfo '{}' 8>&- 2>/dev/null) && printf '%s\n' "$focused" | ok; then
  focused_id=$(printf '%s\n' "$focused" | grep -o '"appId"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*:[[:space:]]*"\([^"]*\)"$/\1/' || true)
  template=''
  # Multiple focused IDs, unknown IDs and query failures all retain the overlay.
  case "$focused_id" in
    com.gathin.tvhome) template="$BASE/recovery/home-sam-request.json";;
    com.webos.app.home)
      [ ! -f "$HOME_ACTIVE" ] || template="$BASE/recovery/home-wam-request.json"
      ;;
  esac
  if [ -n "$template" ] && [ -s "$template" ]; then
    if routed=$(sed "s/__CC_REQUEST__/$request/g" "$template" 2>> "$RUN/toggle.log"); then
      payload=$routed
      home_routed=true
      [ "$focused_id" != com.webos.app.home ] || endpoint=luna://com.palm.webappmanager/launchApp
    fi
  fi
fi
# Native blur is a per-open helper. It cannot hold this wrapper's flock: the
# coordinator spawns a detached worker with all caller descriptors closed.
if [ -f "$NATIVE/runtime.sh" ] && [ ! -f "$NATIVE/disabled" ]; then
  if [ "$home_routed" = true ] || [ "$focused_id" = com.gathin.tvcontrolcentre ]; then
    [ ! -f "$NATIVE_RUN/current.json" ] || sh "$NATIVE/runtime.sh" close >> "$RUN/toggle.log" 2>&1 || true
  else
    case "$focused_id" in
      com.webos.app.home|com.gathin.tvhome|youtube.leanback.v4|com.apple.applemusic|netflix)
        if sh "$NATIVE/runtime.sh" request "$focused_id" >> "$RUN/toggle.log" 2>&1; then exit 0; fi
        ;;
      *) [ ! -f "$NATIVE_RUN/current.json" ] || sh "$NATIVE/runtime.sh" close >> "$RUN/toggle.log" 2>&1 || true;;
    esac
  fi
fi
if result=$(luna "$payload" "$endpoint" 2>&1); then
  launched=true
else
  launched=false
fi
printf '%s\n' "$result" >> "$RUN/toggle.log"
if [ "$launched" != true ] || ! printf '%s\n' "$result" | ok; then fallback; fi
