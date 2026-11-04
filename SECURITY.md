# Security

This project can run privileged helpers on a rooted TV. Treat the TV and the computer used for installation as trusted devices, and review the setup and recovery steps before enabling integrations.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting option if it is enabled for this repository. Otherwise contact the repository owner privately before sharing exploit details or sensitive logs. Do not include credentials, pairing files, network passwords, QR tokens or personal device backups in a public issue.

Include the affected commit, component, prerequisites, impact and minimal reproduction steps. This is a community project; there is no guaranteed response time or security-support window.

## Data and network boundaries

- `.lgtv-key.json` contains the desktop helper's TV pairing credential. Keep it private, along with `.tv-host`, `.sync-apps-icons.json` and `.local/`.
- Desktop preview binds to `127.0.0.1` and serves the app directory. Do not replace it with a server that exposes the entire checkout.
- The rooted wallpaper service listens on port 8090 and uses a token carried in its phone URL/QR code. Treat that URL as a credential. It is a local-network HTTP service; do not expose it through port forwarding or a public tunnel.
- TV pairing uses the device's self-signed TLS endpoint without certificate verification. Use the desktop helpers only on a trusted local network.
- Weather, when enabled, sends the configured location to Open-Meteo. Synced application inventory and icons are generated from the TV.
- Wi-Fi connection credentials are submitted to the TV service. Keep screenshots, service diagnostics and recovery files private.

Enable only the integrations you need. Preserve recovery snapshots, use the documented restore command for each integration, and review changes to privileged service permissions or shell commands carefully.
