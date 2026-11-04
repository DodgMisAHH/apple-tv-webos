#!/bin/sh
# Mounted over LG's Home executable; never invoke that path from this wrapper.
exec /usr/bin/node /home/root/lg-tv-vibehack/system-home/home.js "$@"
