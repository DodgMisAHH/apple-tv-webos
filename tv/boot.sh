#!/bin/sh
# Started by the Homebrew Channel at every boot (via /var/lib/webosbrew/init.d/00-lg-tv-vibehack).
# Starts the Home watcher right away (it waits for webOS itself), then refreshes the app list once
# webOS has settled and starts the wallpaper page.
export PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
DIR=/home/root/lg-tv-vibehack
LOG=/tmp/lg-tv-vibehack.log
RUN=/tmp/lg-tv-vibehack-run
mkdir -p "$RUN"
# The short setup lock prevents two hook invocations racing their PID checks.
if ! mkdir "$RUN/start.lock" 2>/dev/null; then
  owner=$(cat "$RUN/start.lock/pid" 2>/dev/null || true)
  case "$owner" in ''|*[!0-9]*) exit 0;; esac
  kill -0 "$owner" 2>/dev/null && exit 0
  rm -f "$RUN/start.lock/pid"
  rmdir "$RUN/start.lock" 2>/dev/null || exit 0
  mkdir "$RUN/start.lock" 2>/dev/null || exit 0
fi
echo $$ > "$RUN/start.lock/pid"
trap 'rm -f "$RUN/start.lock/pid"; rmdir "$RUN/start.lock" 2>/dev/null || true' EXIT HUP INT TERM
running() {
  pid=$(cat "$RUN/$1.pid" 2>/dev/null || true)
  case "$pid" in ''|*[!0-9]*) return 1;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  tr '\000' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -Fq "$2"
}
echo "$(date) boot" >> "$LOG"
if ! running homewatch "$DIR/homewatch.js"; then
  if [ -f "$DIR/debloat.enabled" ]; then
    nohup setsid sh "$DIR/debloat.sh" apply >> "$LOG" 2>&1 < /dev/null &
  fi
  nohup setsid sh "$DIR/early-launch.sh" >> "$LOG" 2>&1 < /dev/null &
  LG_LAUNCHER_BOOT=1 nohup setsid /usr/bin/node "$DIR/homewatch.js" >> "$LOG" 2>&1 < /dev/null &
  echo $! > "$RUN/homewatch.pid"
fi
if ! running wallpaper "$DIR/wallpaper-server.js"; then
  nohup setsid sh -c "sleep 30; /usr/bin/node '$DIR/sync.js'; exec /usr/bin/node '$DIR/wallpaper-server.js'" >> "$LOG" 2>&1 < /dev/null &
  echo $! > "$RUN/wallpaper.pid"
fi
