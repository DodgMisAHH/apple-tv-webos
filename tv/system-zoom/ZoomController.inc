    property string transitionAppId: ""
    property Item launcherBackdrop: null
    property bool launcherZoomActive: false
    property rect launcherZoomRect: Qt.rect(0, 0, 0, 0)
    property real launcherZoomProgress: 0
    readonly property real zoomLeft: launcherZoomRect.x * (1 - launcherZoomProgress)
    readonly property real zoomTop: launcherZoomRect.y * (1 - launcherZoomProgress)
    readonly property real zoomRight: (launcherZoomRect.x + launcherZoomRect.width) * (1 - launcherZoomProgress) + width * launcherZoomProgress
    readonly property real zoomBottom: (launcherZoomRect.y + launcherZoomRect.height) * (1 - launcherZoomProgress) + height * launcherZoomProgress

    function hasLauncherOrigin() {
        return LaunchOrigin.pending(transitionAppId, width, height);
    }

    function open() {
        var origin = LaunchOrigin.read(transitionAppId, width, height);
        LaunchOrigin.trace("component", LaunchOrigin.diagnostic + " backdrop=" + Boolean(launcherBackdrop));
        launcherZoomAnimation.stop();
        launcherZoomActive = false;
        curtainEdgeLeft.state = "";
        curtainEdgeRight.state = "";
        if (origin) {
            launcherZoomRect = Qt.rect(origin.x, origin.y, origin.width, origin.height);
            launcherZoomProgress = 0;
            launcherZoomActive = true;
            launcherSnapshot.scheduleUpdate();
        } else {
            curtainEdgeLeft.state = state === "closed-left" ? "left" : "right";
            curtainEdgeRight.state = curtainEdgeLeft.state;
        }
        state = "open";
        if (origin) launcherZoomAnimation.restart();
    }

    // Opaque outgoing-home backdrop prevents a fast app showing behind its zoom.
    // Captured once per opening; no continuous blur or additional animated surface.
    Rectangle {
        anchors.fill: parent
        z: -1
        color: "black"
        visible: root.launcherZoomActive && root.transitioning
        ShaderEffectSource {
            id: launcherSnapshot
            anchors.fill: parent
            sourceItem: root.launcherZoomActive ? root.launcherBackdrop : null
            live: false
            hideSource: false
            recursive: false
        }
    }

    NumberAnimation {
        id: launcherZoomAnimation
        target: root
        property: "launcherZoomProgress"
        from: 0
        to: 1
        duration: root.openTime
        easing.type: Easing.OutCubic
    }
