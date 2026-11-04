#!/bin/sh
# Start the app without waiting for a Node runtime during a busy cold boot.
export PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
attempt=0
while [ "$attempt" -lt 6 ]; do
  [ ! -f /tmp/lg-tv-system-home.active ] || exit 0
  attempt=$((attempt + 1))
  result=$(luna-send -w 3000 -n 1 luna://com.webos.applicationManager/launch '{"id":"com.gathin.tvhome"}' 2>&1)
  echo "$(date) early launch $attempt: $result"
  if printf '%s' "$result" | grep -Eq '"returnValue"[[:space:]]*:[[:space:]]*true'; then exit 0; fi
  sleep 2
done
exit 1
