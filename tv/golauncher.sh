#!/bin/sh
# Called by LG Input Hook when the Home button is pressed.
APP_ID=com.gathin.tvhome
[ ! -f /tmp/lg-tv-system-home.active ] || APP_ID=com.webos.app.home
/usr/bin/luna-send -n 1 luna://com.webos.applicationManager/launch "{\"id\":\"$APP_ID\",\"params\":{\"home\":true,\"reload\":false}}" >/dev/null 2>&1
