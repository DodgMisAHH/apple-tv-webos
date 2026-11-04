// Owned compositor child. It neither launches nor reparents a window.
import QtQuick 2.4
import QtQuick.Window 2.12
import QtGraphicalEffects 1.0

Item {
    id: backdrop
    anchors.fill: parent

    // The host also verifies that this exact allowed app item remains fullscreen.
    property Item homeSource: null
    property bool homeIsCurrent: false
    property bool active: false
    property bool mainGridVisible: false
    property int selectedIndex: 0
    property real blurRadius: 30 // Native effect units; not a CSS blur equivalence.
    property double deadline: 0
    readonly property rect crop: Qt.rect(1408, 96, 512, 512)
    readonly property bool sourceSafe: safeSource(homeSource)
    // Retain the safe pinned effect chain while navigating; stop()
    // still releases all sources. The exact fullscreen identity stays required.
    readonly property bool sourceReady: active && homeIsCurrent && sourceSafe
    readonly property bool rendering: sourceReady && visible && mainGridVisible
    signal stopped(string reason)

    // Logical 1920x1080 outer boxes from production CSS and native DOM records.
    readonly property var tiles: [
        {name:"power", x:1446, y:126, width:207, height:207, radius:53},
        {name:"wifi", x:1669, y:126, width:207, height:95.5, radius:52},
        {name:"screen", x:1669, y:237.5, width:207, height:95.5, radius:52},
        {name:"sound", x:1446, y:349, width:207, height:95.5, radius:52},
        {name:"vpn", x:1669, y:349, width:207, height:95.5, radius:52},
        {name:"hiddenApps", x:1446, y:460.5, width:95.5, height:95.5, radius:47.75},
        {name:"inputs", x:1557.5, y:460.5, width:95.5, height:95.5, radius:47.75},
        {name:"wallpaper", x:1669, y:460.5, width:95.5, height:95.5, radius:47.75},
        {name:"settings", x:1780.5, y:460.5, width:95.5, height:95.5, radius:47.75}
    ]

    function safeSource(item) {
        if (!item || (item.appId !== "com.webos.app.home" && item.appId !== "com.gathin.tvhome" &&
                item.appId !== "youtube.leanback.v4" && item.appId !== "com.apple.applemusic" && item.appId !== "netflix") ||
                !(item.width > 0 && item.height > 0)) return false;
        // Window.window is a QtQuick.Window attached property since Qt 5.7.
        try {
            if (!backdrop.Window.window || item.Window.window !== backdrop.Window.window) return false;
        } catch (error) { return false; }
        // Reject either ancestry direction, including a compositor-root source.
        // The sampled surface must never contain this component or its effects.
        var node = backdrop;
        while (node) { if (node === item) return false; node = node.parent; }
        node = item;
        while (node) { if (node === backdrop) return false; node = node.parent; }
        return true;
    }

    function begin(item, until) {
        var now = Date.now();
        if (active || !visible || !homeIsCurrent || !safeSource(item) ||
                typeof until !== "number" || !isFinite(until) || until <= now || until > now + 600000) return false;
        homeSource = item;
        deadline = until;
        selectedIndex = 0;
        mainGridVisible = false;
        active = true;
        expiry.interval = Math.max(1, until - now);
        expiry.start();
        return true;
    }

    // Opening and geometry changes settle before showing. Moving focus within
    // the same main grid keeps the fixed mask and blur visible.
    // A submenu, wallpaper, or hidden page still sends false immediately.
    function setMainState(shown, selection) {
        if (!active || Date.now() >= deadline) { stop("expired-state"); return false; }
        if (typeof shown !== "boolean" || typeof selection !== "number" ||
                selection !== Math.floor(selection) || selection < 0 || selection > 8) {
            stop("invalid-state");
            return false;
        }
        if (shown === mainGridVisible && selection === selectedIndex) return true;
        if (!shown) mainGridVisible = false;
        selectedIndex = selection;
        mainGridVisible = shown === true;
        return true;
    }

    function stop(reason) {
        var wasActive = active;
        active = false;
        mainGridVisible = false;
        homeSource = null;
        expiry.stop();
        if (wasActive) stopped(reason);
    }

    onHomeIsCurrentChanged: if (active && !homeIsCurrent) stop("home-no-longer-current")
    onSourceSafeChanged: if (active && !sourceSafe) stop("invalid-source")
    onVisibleChanged: if (active && !visible) stop("host-hidden")

    Timer { id: expiry; repeat: false; onTriggered: backdrop.stop("deadline") }

    Item {
        id: logicalStage
        width: 1920
        height: 1080
        transform: Scale { xScale: backdrop.width / 1920; yScale: backdrop.height / 1080 }

        Item {
            id: cropStage
            x: backdrop.crop.x
            y: backdrop.crop.y
            width: backdrop.crop.width
            height: backdrop.crop.height

            // One allowed fullscreen app capture feeds one blur chain and mask.
            ShaderEffectSource {
                id: sharedSource
                anchors.fill: parent
                textureSize: Qt.size(512, 512)
                sourceItem: backdrop.sourceReady ? backdrop.homeSource : null
                sourceRect: backdrop.homeSource ? Qt.rect(
                    backdrop.crop.x * backdrop.homeSource.width / 1920,
                    backdrop.crop.y * backdrop.homeSource.height / 1080,
                    backdrop.crop.width * backdrop.homeSource.width / 1920,
                    backdrop.crop.height * backdrop.homeSource.height / 1080) : Qt.rect(0, 0, 0, 0)
                live: backdrop.rendering
                hideSource: false
                recursive: false
                smooth: true
                visible: false
            }

            FastBlur {
                id: sharedBlur
                anchors.fill: parent
                source: backdrop.sourceReady ? sharedSource : null
                radius: Math.max(0, Math.min(30, backdrop.blurRadius))
                cached: false
                transparentBorder: false
                visible: false
            }

            Item {
                id: roundedMask
                anchors.fill: parent
                // Retain blur behind all buttons. The opaque selected web
                // fill covers it, avoiding a cross-surface cutout race.
                visible: backdrop.sourceReady
                Repeater {
                    model: backdrop.tiles
                    Rectangle {
                        x: modelData.x - backdrop.crop.x + 2
                        y: modelData.y - backdrop.crop.y + 2
                        width: modelData.width - 4
                        height: modelData.height - 4
                        radius: Math.min(modelData.radius, modelData.width / 2, modelData.height / 2) - 2
                        color: "white"
                        antialiasing: true
                        visible: true
                    }
                }
            }

            ShaderEffectSource {
                id: maskTexture
                anchors.fill: parent
                textureSize: Qt.size(512, 512)
                sourceItem: backdrop.sourceReady ? roundedMask : null
                hideSource: true
                live: backdrop.sourceReady
                recursive: false
                visible: false
            }

            OpacityMask {
                anchors.fill: parent
                source: backdrop.sourceReady ? sharedBlur : null
                maskSource: backdrop.sourceReady ? maskTexture : null
                cached: false
                visible: backdrop.rendering
            }
        }
    }
}
