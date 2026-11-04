> Historical local-build report. This describes the original development TV,
> not a verified release of the shareable edition. Apple fonts/symbols and
> private backup files mentioned below are not included. Use [setup](SETUP.md)
> for current instructions and [sharing notes](PUBLIC-SHARING.md) for differences.

# VPN presets on the rooted TV

Control Centre has four VPN choices: Off, Portugal, United Kingdom and United
States. Off disconnects; choosing a configured country connects it directly.
Missing configurations are disabled. The subtitle shows the country or Off.
The blue icon and small VPN badge require a live tunnel with a handshake within
the last 180 seconds. Hidden Home stops polling; visible Home checks every 15 seconds,
or every 5 seconds while Control Centre is open.

The WireGuard app manages configurations separately. Select a country, choose
Add configuration, then use its local upload address and temporary code to send
that country's Windscribe WireGuard `.conf`. Selecting a card in the setup app
does not connect; its explicit Connect button does. Configuration upload never
switches the running tunnel. The upload closes after one success or ten minutes.

Private files live under `/var/lib/webosbrew/wireguard/profiles/{lisbon,uk,us}`;
display names do not change those IDs. The controller validates before stopping
an existing tunnel and serializes mutations. Only fixed commands and preset IDs
are accepted by the launcher bridge. Keys are redacted from config views and are
never added to launcher assets, screenshots or deployment manifests.

The imported Portugal configuration preserves the TV's original shared files.
UK and US still need their own files. Existing autostart was preserved. Upstream
DNS handling is unchanged: an imported DNS directive is retained in the original
upload, but the client does not apply it. Actual tunnel/DNS behavior and boot
connection still need a separate test when playback may be interrupted.

The local preview at `http://127.0.0.1:4798/` uses simulated VPN state and cannot
contact the TV. Its connected display does not mean the real TV VPN is active.

The Wi-Fi submenu keeps a bounded `findnetworks` subscription to receive fresh
scan results after the initial cached list. Leaving the submenu stops callbacks;
the underlying request exits within 8 seconds. It does not change Wi-Fi connections.
