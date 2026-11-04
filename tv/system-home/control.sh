#!/bin/sh
# Firmware-specific executable overlay; stock bytes remain on the read-only image.
set -eu
export PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
BASE=/home/root/lg-tv-vibehack/system-home
RUN=/tmp/lg-tv-system-home
ACTIVE=/tmp/lg-tv-system-home.active
TARGET=/usr/bin/com.webos.app.home
INIT=/var/lib/webosbrew/init.d/00-lg-tv-system-home
HASH=ab970eea3cec09666a0c5e297412571f0622c061894c0243c5ca153ad7b02356
MANIFEST_HASH=6a98f9edc86aa06664f8aa5f6d9b5e60ed7caee1d1fbe4722459ac72f30b72db
APP=/media/developer/apps/usr/palm/applications/com.gathin.tvhome
mkdir -p "$RUN"
chmod 700 "$RUN"
fail() { echo "$*" >&2; exit 1; }
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$RUN/control.log"; }
owned() { [ -f "$BASE/entrypoint.sh" ] && [ "$(stat -c '%d:%i' "$TARGET")" = "$(stat -c '%d:%i' "$BASE/entrypoint.sh")" ]; }
runtime_alive() {
  runtime_pid=$(cat "$RUN/runtime.pid" 2>/dev/null || true)
  case "$runtime_pid" in ''|*[!0-9]*) return 1;; esac
  kill -0 "$runtime_pid" 2>/dev/null || return 1
  tr '\000' '\n' < "/proc/$runtime_pid/cmdline" 2>/dev/null | grep -Fxq "$BASE/home.js"
}
bus_ready() {
  # Native Home's bus row cannot prove the replacement web page registered.
  listing=$(timeout -t 5 /usr/sbin/ls-monitor -l 2>/dev/null) || return 1
  printf '%s\n' "$listing" | awk '$2 ~ /^com[.]webos[.]app[.]home-[0-9]+$/ && $3 == "/usr/bin/WebAppMgr" { ready = 1 } END { exit !ready }'
}
lock() {
  # flock is present on the verified firmware and releases automatically on process death.
  exec 9>"$RUN/control.lock"
  flock -w 20 9 || fail 'Another Home integration operation is running.'
}
luna() { luna-send -w 5000 -n 1 "$1" "$2"; }
ok() { grep -q '"returnValue"[[:space:]]*:[[:space:]]*true'; }
check() {
  [ "$(id -u)" = 0 ] || { echo 'Root required.' >&2; return 1; }
  [ -f "$APP/appinfo.json" ] && [ -s "$APP/index.html" ] || { echo 'Optimized launcher missing.' >&2; return 1; }
  [ -x "$BASE/entrypoint.sh" ] && [ -s "$BASE/home.js" ] && [ -s "$BASE/startup-guard.js" ] && [ -s "$BASE/permissions.js" ] || { echo 'Runtime missing.' >&2; return 1; }
  printf '%s  %s\n' "$MANIFEST_HASH" /usr/palm/applications/com.webos.app.home/appinfo.json | sha256sum -c - || return 1
  if ! owned; then printf '%s  %s\n' "$HASH" "$TARGET" | sha256sum -c - || return 1; fi
  return 0
}
stop_stock() {
  # Only the original ELF executable, never other apps or a shell with a matching argument.
  for file in /proc/[0-9]*/exe; do
    [ "$(readlink "$file" 2>/dev/null || true)" = "$TARGET" ] || continue
    [ "$(sha256sum "$file" 2>/dev/null | cut -d' ' -f1)" = "$HASH" ] || continue
    pid=${file#/proc/}; pid=${pid%/exe}
    kill -TERM "$pid" 2>/dev/null || true
    log "Stopped stock Home pid $pid"
  done
}
stop_runtime() {
  pid=$(cat "$RUN/runtime.pid" 2>/dev/null || true)
  case "$pid" in ''|*[!0-9]*) return;; esac
  if tr '\000' '\n' < "/proc/$pid/cmdline" 2>/dev/null | grep -Fxq "$BASE/home.js"; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
}
rollback() {
  # Keep the runtime and rollback guard armed until the original executable is restored.
  had_replacement=false
  if owned; then
    had_replacement=true
    umount "$TARGET" || { log 'Unmount failed; active replacement and guard retained.'; return 1; }
  elif [ -f "$RUN/armed" ]; then
    printf '%s  %s\n' "$HASH" "$TARGET" | sha256sum -c - || fail 'Foreign replacement detected; refusing to change it.'
    had_replacement=true
  fi
  rm -f "$BASE/enabled" "$RUN/confirmed" "$ACTIVE"
  if [ "$had_replacement" = true ]; then
    stop_runtime
    luna luna://com.palm.webappmanager/killApp '{"appId":"com.webos.app.home"}' >> "$RUN/control.log" 2>&1 || true
  fi
  node "$BASE/state.js" restore-key || return 1
  printf '%s  %s\n' "$HASH" "$TARGET" | sha256sum -c - || return 1
  luna luna://com.webos.applicationManager/launch '{"id":"com.gathin.tvhome","params":{"home":true,"reload":false}}' >> "$RUN/control.log" 2>&1 || true
  # Restore the usable launcher even if policy cleanup needs a later guard retry.
  node "$BASE/permissions.js" remove >> "$RUN/control.log" 2>&1 || return 1
  rm -f "$RUN/runtime.pid" "$RUN/armed" "$RUN/shown" "$RUN/lease"
  log 'Restored stock executable and legacy launcher integration.'
}
arm() {
  [ ! -e "$RUN/armed" ] && [ ! -e "$ACTIVE" ] || fail 'System Home is already active; inspect status first.'
  check || return 1
  runtime_alive && fail 'An earlier native Home adapter is still running.'
  rm -f "$RUN/shown" "$RUN/runtime.pid" "$RUN/confirmed" || return 1
  node "$BASE/state.js" description || return 1
  token="$(date +%s)-$$"
  printf '%s\n' "$token" > "$RUN/lease" || return 1
  nohup setsid sh "$BASE/control.sh" watch "$token" >> "$RUN/guard.log" 2>&1 < /dev/null 9>&- &
  guard=$!
  echo "$guard" > "$RUN/guard.pid"
  sleep 1
  kill -0 "$guard" || { rm -f "$RUN/lease"; fail 'Rollback guard did not start.'; }
  trap 'rollback; exit 1' HUP INT TERM
  node "$BASE/permissions.js" install >> "$RUN/control.log" 2>&1 || { rollback; return 1; }
  node "$BASE/state.js" suspend-key || { rollback; return 1; }
  touch "$RUN/armed" || { rollback; return 1; }
  printf '%s\n' "$token" > "$ACTIVE" || { rollback; return 1; }
  mount -o bind "$BASE/entrypoint.sh" "$TARGET" || { rollback; exit 1; }
  stop_stock
  log 'System Home executable mounted; 600-second rollback lease active.'
}
activate() {
  attempt=0
  while [ "$attempt" -lt 8 ] && [ -f "$ACTIVE" ]; do
    attempt=$((attempt + 1))
    result=$(luna luna://com.webos.applicationManager/launch '{"id":"com.webos.app.home","params":{"home":true,"reload":false}}' 2>&1 || true)
    printf '%s\n' "$result" >> "$RUN/control.log"
    if printf '%s' "$result" | ok; then return 0; fi
    sleep 2
  done
  return 1
}
case "${1:-status}" in arm|confirm|enable|disable|rollback|startup|finish-startup) lock;; esac
case "${1:-status}" in
  check) check ;;
  arm) arm; activate || { rollback; fail 'Home launch rejected; rolled back.'; }; echo 'Temporary system Home active; rollback in 600 seconds unless confirmed.' ;;
  watch)
    token=${2:?Missing guard token}; elapsed=0
    while [ -f "$RUN/lease" ] && [ "$(cat "$RUN/lease")" = "$token" ]; do
      if [ "$elapsed" -ge 600 ]; then log 'Lease expired.'; if sh "$BASE/control.sh" rollback "$token"; then exit; fi; fi
      if [ "$elapsed" -gt 30 ] && { ! systemctl is-active --quiet surface-manager-daemon.service || ! systemctl is-active --quiet sam.service; }; then
        log 'Core UI service failed health check.'; if sh "$BASE/control.sh" rollback "$token"; then exit; fi
      fi
      sleep 2; elapsed=$((elapsed + 2))
    done
    ;;
  confirm)
    owned && [ -f "$ACTIVE" ] || fail 'No active owned replacement.'
    result=$(luna luna://com.webos.applicationManager/getForegroundAppInfo '{}')
    printf '%s' "$result" | grep -q '"appId"[[:space:]]*:[[:space:]]*"com.webos.app.home"' || fail 'System Home must be foreground before confirmation.'
    runtime_alive && [ -f "$RUN/shown" ] || fail 'Native lifecycle adapter has not shown Home.'
    bus_ready || fail 'Home web page has not registered with the Luna bus.'
    touch "$RUN/confirmed"; rm -f "$RUN/lease"
    echo 'Confirmed for this boot; persistence is not enabled.'
    ;;
  enable)
    owned && [ -f "$RUN/confirmed" ] || fail 'Confirm the physical trial before enabling startup.'
    check
    [ ! -e "$INIT" ] || cmp -s "$INIT" "$BASE/startup.sh" || fail 'Startup hook path belongs to another file.'
    cp "$BASE/startup.sh" "$INIT"; chmod 755 "$INIT"
    touch "$BASE/enabled"
    echo 'System Home startup enabled. Use control.sh disable to restore.'
    ;;
  startup)
    [ -f "$BASE/enabled" ] || exit 0
    if [ -f "$ACTIVE" ] && owned; then
      log 'Startup already active; existing trial and configuration retained.'; exit 0
    fi
    # Catch arm's explicit exits as well as returned failures. After a reboot,
    # an early preflight rejection must still restore the durable Home key.
    ( arm ) || {
      rm -f "$BASE/enabled"
      if [ ! -e "$ACTIVE" ] && [ ! -e "$RUN/armed" ] && ! owned; then
        if node "$BASE/state.js" restore-key >> "$RUN/control.log" 2>&1; then
          log 'Startup failed before activation; previous Home key restored.'
        else
          log 'Startup failed; Home key snapshot retained for recovery.'
        fi
      fi
      exit 1
    }
    nohup setsid sh "$BASE/control.sh" finish-startup >> "$RUN/startup.log" 2>&1 < /dev/null 9>&- &
    ;;
  finish-startup)
    if ! activate; then rollback; exit 1; fi
    n=0
    while [ "$n" -lt 30 ] && [ -f "$ACTIVE" ]; do
      if [ -f "$RUN/shown" ] && runtime_alive && bus_ready; then
        # Bus registration adds a transport check; physical behavior is validated before enable.
        touch "$RUN/confirmed"; rm -f "$RUN/lease"; log 'Startup adapter reported Home shown and web bus registered.'; exit 0
      fi
      sleep 2; n=$((n + 1))
    done
    rollback; exit 1
    ;;
  rollback)
    if [ -n "${2:-}" ] && { [ ! -f "$RUN/lease" ] || [ "$(cat "$RUN/lease")" != "$2" ]; }; then
      log 'Expired guard ignored; lease no longer belongs to that trial.'; exit 0
    fi
    rollback ;;
  disable)
    rollback
    if [ -f "$INIT" ] && cmp -s "$INIT" "$BASE/startup.sh"; then rm "$INIT"; fi
    echo 'System Home disabled; original Home and previous launcher hooks restored.'
    ;;
  status)
    if owned; then echo 'Executable: owned system Home adapter'; else echo 'Executable: stock or foreign (check hashes)'; fi
    for file in "$ACTIVE" "$BASE/enabled" "$RUN/lease" "$RUN/confirmed" "$RUN/shown"; do [ ! -f "$file" ] || echo "Present: $file"; done
    cat "$RUN/runtime.pid" 2>/dev/null || true
    luna luna://com.webos.applicationManager/getForegroundAppInfo '{}'
    ;;
  *) fail 'Use check, arm, status, confirm, enable, disable or rollback.' ;;
esac
