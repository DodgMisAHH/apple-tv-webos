#!/bin/sh
# Only this lock survives exec. Node's spawn closes caller fd7/fd8 first.
set -eu
BASE=/home/root/lg-tv-vibehack/native-blur
RUN=/tmp/lg-tv-native-blur
umask 077
exec 6>"$RUN/session.lock"
# A queued reopen waits behind the previous worker's complete cleanup. The
# coordinator returns immediately; another press can cancel this waiting nonce.
flock -w 35 6 || exit 0
exec /usr/bin/node "$BASE/runtime.js" worker "${1:?Missing session}" "${2:?Missing source}"
