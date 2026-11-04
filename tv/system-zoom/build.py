#!/usr/bin/env python3
"""Generate private device patches from verified original firmware QML copies."""
import hashlib
import json
from pathlib import Path
import shutil
import sys

BASE = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).resolve().parent
OUT = BASE / '.local/system-zoom-stage'
REF = BASE / '.local/references'
QML = REF / 'tv-compositor/WebOSCompositor'
FILES = {
    'Wiper.qml': (REF / 'tv-Wiper.qml', '58738db0930367f620742da57cdb235e866476668da42ca7fe528189ae1d465c'),
    'StarfishImageSplash.qml': (QML / 'views/StarfishImageSplash.qml', 'd1e051dd4ca71a1e3492499d0e212e646fb9849fcb66c79030b7b815603724b3'),
    'StarfishFullscreenDelegate.qml': (QML / 'views/fullscreen/StarfishFullscreenDelegate.qml', 'dec8bd389c364b6d1b6d04dc304f0079c69cacfb67cd58ad33c7a65f9134a7d7'),
}


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Expected exactly one patch site: ' + old[:80])
    return text.replace(old, new, 1)


def main():
    originals = {}
    for name, (path, digest) in FILES.items():
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != digest:
            sys.exit('Unrecognized firmware source: ' + name)
        originals[name] = data.decode()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'qml').mkdir(exist_ok=True)
    (OUT / 'patched').mkdir(exist_ok=True)
    for name in ('LaunchOrigin.js',):
        shutil.copy2(SOURCE / name, OUT / 'qml' / name)

    wiper = originals['Wiper.qml']
    wiper = replace_once(wiper, 'import QtQuick 2.4',
                         'import QtQuick 2.4\nimport "LaunchOrigin.js" as LaunchOrigin')
    wiper = replace_once(wiper, '    function open() { state = "open" }', (SOURCE / 'ZoomController.inc').read_text())
    wiper = replace_once(wiper, '    onSourceItemChanged: {', '''    onSourceItemChanged: {
        launcherZoomAnimation.stop();
        launcherZoomActive = false;''')
    # One renderer retains LG's source visibility/lifecycle ownership throughout.
    geometry = (SOURCE / 'ZoomGeometry.inc').read_text()
    wiper = replace_once(wiper, '        antialiasing: false', '        antialiasing: false\n' + geometry)
    # Stock edge states must not override the rectangle's geometry during zoom.
    wiper = wiper.replace('                script: {\n                    curtainEdgeLeft.state',
                          '                script: {\n                    if (root.launcherZoomActive) return;\n                    curtainEdgeLeft.state')
    (OUT / 'qml/ZoomWiper.qml').write_text(wiper)

    # Instrument the unchanged shared Wiper as well, to identify any other launch path.
    probe = replace_once(originals['Wiper.qml'], '    signal opening()', '''    function launcherZoomProbe() {
        try {
            var output = new XMLHttpRequest();
            output.open("PUT", "file:///tmp/lg-tv-zoom-stock.json", false);
            output.send(JSON.stringify({ time: Date.now(), parent: String(root.parent),
                source: String(root.sourceItem), appId: root.sourceItem && root.sourceItem.appId || "",
                location: String(Qt.resolvedUrl(".")) }));
        } catch (error) {}
    }
    onOpening: launcherZoomProbe()
    signal opening()''')
    (OUT / 'patched/Wiper.qml').write_text(probe)

    # Keep stock relative imports and all lifecycle handlers in their original paths.
    for name, app_id in [('StarfishImageSplash.qml', 'root.splashAppId'),
                         ('StarfishFullscreenDelegate.qml', 'root.surfaceItem ? root.surfaceItem.appId : ""')]:
        text = originals[name]
        text = replace_once(text, 'import QtQuick 2.4',
                            'import QtQuick 2.4\nimport "file:///home/root/lg-tv-vibehack/system-zoom/qml" as LauncherZoom')
        text = replace_once(text, '    Eos.Wiper {',
                            '    LauncherZoom.ZoomWiper {\n        transitionAppId: ' + app_id)
        if name == 'StarfishImageSplash.qml':
            # Never animate a splash on top of an already visible target surface.
            # Peek does not consume the token: only the actual app surface can do so.
            text = replace_once(text, '    function open(appId, img) {', '''    function open(appId, img) {
        if (LauncherZoom.LaunchOrigin.pending(appId, width, height)) {
            splashAppId = "";
            wiperAppId = "";
            return;
        }''')
            # QML JS namespaces are not exported through directory aliases.
            text = replace_once(text, 'import QtQuick 2.4',
                'import QtQuick 2.4\nimport "file:///home/root/lg-tv-vibehack/system-zoom/qml/LaunchOrigin.js" as LaunchOrigin')
            text = text.replace('LauncherZoom.LaunchOrigin.pending', 'LaunchOrigin.pending')
        else:
            text = replace_once(text, '        if (wipeOpen) {', '''        if (wipeOpen || wiper.hasLauncherOrigin()) {
            var outgoing = root.parent.currentItem;
            wiper.launcherBackdrop = outgoing && outgoing.appId === "com.gathin.tvhome" ? outgoing : null;''')
        (OUT / 'patched' / name).write_text(text)
    (OUT / 'original-hashes.json').write_text(json.dumps(
        {name: digest for name, (_, digest) in FILES.items()}, indent=2) + '\n')
    print('Generated guarded native-zoom prototype in ' + str(OUT))


if __name__ == '__main__':
    main()
