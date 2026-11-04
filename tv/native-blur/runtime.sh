#!/bin/sh
# Short-lived request lock; the worker must never inherit this or toggle fd8.
set -eu
export PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
BASE=/home/root/lg-tv-vibehack/native-blur
RUN=/tmp/lg-tv-native-blur
case "${1:-status}" in request|close|enable|disable|status) ;; *) exit 10;; esac
umask 077
[ ! -L "$RUN" ] || exit 10
mkdir -p "$RUN"
chmod 700 "$RUN"
exec 7>"$RUN/request.lock"
flock -w 2 7 || exit 10
exec /usr/bin/node "$BASE/runtime.js" "$@"
