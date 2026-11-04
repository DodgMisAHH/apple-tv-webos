#!/usr/bin/env bash
# Run home-watch.py in the background on this Mac: starts at login, restarts if it stops.
#   TV_HOST=192.168.1.50 ./home-watch-mac.sh            # install / update
#   ./home-watch-mac.sh uninstall
# Log: ~/Library/Logs/tv-vibehack-home-watch.log
set -euo pipefail
cd "$(dirname "$0")"
LABEL=com.tvvibehack.homewatch
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/tv-vibehack-home-watch.log"

if [ "${1:-}" = uninstall ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed. Home opens LG's home again."
  exit 0
fi

: "${TV_HOST:?set TV_HOST to the TV IP address, e.g. TV_HOST=192.168.1.50 $0}"
[ -x venv/bin/python ] || python3 -m venv venv
venv/bin/python -c 'import websockets' >/dev/null 2>&1 || venv/bin/pip install -q websockets

mkdir -p "$(dirname "$PLIST")"
mkdir -p "$(dirname "$LOG")"
STAGED=$(mktemp "$PLIST.new.XXXXXX")
PREVIOUS=$(mktemp "$PLIST.previous.XXXXXX")
trap 'rm -f "$STAGED" "$PREVIOUS"' EXIT
HAD_PREVIOUS=0
if [ -f "$PLIST" ]; then cp -p "$PLIST" "$PREVIOUS"; HAD_PREVIOUS=1; fi
venv/bin/python - "$STAGED" "$LABEL" "$PWD" "$TV_HOST" "$LOG" <<'PY'
import plistlib
import sys
file, label, folder, host, log = sys.argv[1:]
with open(file, 'wb') as output:
    plistlib.dump({'Label': label,
                  'ProgramArguments': [folder + '/venv/bin/python', '-u', folder + '/home-watch.py', host],
                  'WorkingDirectory': folder, 'RunAtLoad': True, 'KeepAlive': True,
                  'StandardOutPath': log, 'StandardErrorPath': log}, output)
PY
# Only replace the working service after configuration and dependencies are ready.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
mv "$STAGED" "$PLIST"
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST"; then
  if [ "$HAD_PREVIOUS" = 1 ]; then
    mv "$PREVIOUS" "$PLIST"
    launchctl bootstrap "gui/$(id -u)" "$PLIST" || true
  else
    rm -f "$PLIST"
  fi
  echo 'Could not start the updated watcher; the previous configuration was restored.' >&2
  exit 1
fi
echo "Running. Press Home on the remote. Log: $LOG"
