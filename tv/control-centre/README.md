# Global Settings button

This integration maps LG Input Hook's raw Settings/MENU key `139` to the installed
`com.gathin.tvcontrolcentre` transparent overlay outside Home. On native Home
or fallback Home, it toggles that page's built-in Control Centre instead. A focused
overlay still receives its dismissing toggle even with Home underneath.
Home (`773`) and every other key
stay as they are. It needs the dedicated overlay package and an already working
LG Input Hook installation on the rooted TV.

Stage these files at `/home/root/lg-tv-vibehack/control-centre`, make `toggle.sh`
executable, and run:

```sh
sh /home/root/lg-tv-vibehack/control-centre/control.sh check
sh /home/root/lg-tv-vibehack/control-centre/control.sh arm
```

Press Settings over a playing app. Verify that playback continues, a second
Settings press dismisses the overlay, and Back returns focus to the app. The
trial restores the original Settings binding after ten minutes. Repeating `arm`
does not renew the lease. Once the physical trial works, make it persistent:

```sh
sh /home/root/lg-tv-vibehack/control-centre/control.sh confirm
```

To inspect or undo it at any time:

```sh
sh /home/root/lg-tv-vibehack/control-centre/control.sh status
sh /home/root/lg-tv-vibehack/control-centre/control.sh restore
```

The original presence and value of key `139` are saved in
`/home/root/lg-tv-vibehack/control-centre/recovery/settings-key.json`. Restoration
changes only our exact binding. If another tool has changed Settings, its newer
binding and our recovery snapshot are both retained for inspection. Never copy
an entire old key map over the current map: that could erase unrelated changes.

The binding itself survives reboot, so confirmation needs no startup hook.
During a trial, reboot ends the running watchdog; the durable trial deadline is
still enforced on the next Settings press, which restores the original key and
opens LG Settings if the trial has expired. Until expiry, a trial also remains
usable after reboot. A rejected or timed-out overlay launch opens LG Settings.

Input Hook checks key-map modification times; writes are atomic and advance the
whole-second timestamp even for an immediate restore. Allow its next polling
cycle before testing the remote. Logs are under `/tmp/lg-tv-control-centre/`.

Normal presses avoid starting Node: a native SHA-256 check verifies the key map,
recovery snapshot, app manifest and overlay page against the last validated
authorization. Changes or missing cache trigger full validation; trial expiry
and bounded LG Settings fallback remain active. Install and confirmation warm
the cache, which can also be refreshed with `sh toggle.sh refresh-cache`.

Home routing requires the installed Home-only `home-settings.js` entrypoint and
manifest. Native Home also requires its active marker and validated WAM
descriptor. The one-second-bounded focused-window lookup defaults to the overlay
when focus is unknown. Home requests are built during cache refresh, carry a
unique toggle token, and are verified with the other inputs on each press.
Deploy Home assets first, refresh its page, then install these helpers and warm
the cache. Native Home's adapter and Home-key binding do not change.
