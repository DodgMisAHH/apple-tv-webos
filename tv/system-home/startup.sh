#!/bin/sh
# Runs before the legacy launcher hook; bounded initialization continues in the background.
sh /home/root/lg-tv-vibehack/system-home/control.sh startup >> /tmp/lg-tv-system-home-boot.log 2>&1
