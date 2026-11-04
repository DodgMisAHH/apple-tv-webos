// Owned bounded compositor host. Loaded dynamically; never replaces LG files.
import QtQuick 2.4
import QtQuick.Window 2.12
import WebOSCompositorBase 1.0

Item {
    id: host
    anchors.fill: parent
    property Item homeSource: null
    property bool configured: false
    property bool shown: false
    property bool ready: false
    property bool takeoverStarted: false
    property bool ending: false
    property bool haveState: false
    property bool stateVisible: false
    property bool stateMain: false
    property int stateSelected: 0
    property double revision: 0
    property double createdAt: Date.now()
    property double sessionDeadline: 0
    property double leaseExpiresAt: 0
    property string token: ""
    property var pollRequest: null
    property int pollGeneration: 0
    property var eventRequests: []
    property string renderSignature: ""

    function allowedHome(item) {
        return item && (item.appId === "com.webos.app.home" || item.appId === "com.gathin.tvhome" ||
            item.appId === "youtube.leanback.v4" || item.appId === "com.apple.applemusic" || item.appId === "netflix") &&
            item.width > 0 && item.height > 0;
    }

    function homeStillCurrent() {
        return !ending && typeof compositor !== "undefined" && homeSource &&
            compositor.fullscreen === homeSource && allowedHome(homeSource) && backdrop.safeSource(homeSource);
    }

    function webIsCurrent() {
        var node = parent;
        for (var i = 0; node && i < 8; i++, node = node.parent) {
            if (node.viewName === "overlayView" && typeof node.currentView !== "undefined")
                return node.currentView && node.currentView.appId === "com.gathin.tvcontrolcentre";
        }
        return false;
    }

    function postEvent(event, detail) {
        if (!/^[0-9a-f]{64}$/.test(token) || eventRequests.length >= 4) return;
        var request = null, entry = null;
        try {
            request = new XMLHttpRequest();
            entry = {request: request, at: Date.now()};
            eventRequests.push(entry);
            request.onreadystatechange = function () {
                if (request.readyState === XMLHttpRequest.DONE) {
                    var index = host.eventRequests.indexOf(entry);
                    if (index >= 0) host.eventRequests.splice(index, 1);
                }
            };
            request.open("POST", "http://127.0.0.1:48740/event", true);
            request.setRequestHeader("Content-Type", "text/plain");
            request.send(JSON.stringify({token: token, event: event, at: Date.now(), detail: String(detail || "").slice(0, 250)}));
        } catch (error) {
            if (entry) {
                var index = eventRequests.indexOf(entry);
                if (index >= 0) eventRequests.splice(index, 1);
            }
            if (request) { try { request.onreadystatechange = null; request.abort(); } catch (ignore) {} }
        }
    }

    function abortPoll() {
        pollGeneration++;
        pollTimeout.stop();
        var request = pollRequest;
        pollRequest = null;
        if (request) { try { request.onreadystatechange = null; request.abort(); } catch (ignore) {} }
    }

    function cleanup(reason) {
        startupLimit.stop(); readyCheck.stop(); boundaryCheck.stop(); hardLimit.stop(); pollAgain.stop();
        abortPoll();
        backdrop.stop(reason);
        homeSource = null;
        stateVisible = false;
        stateMain = false;
        var pending = eventRequests.slice();
        eventRequests = [];
        for (var i = 0; i < pending.length; i++) {
            try { pending[i].request.onreadystatechange = null; pending[i].request.abort(); } catch (ignore) {}
        }
    }

    function finish(reason) {
        if (ending) return;
        ending = true;
        cleanup(reason);
        postEvent("finish", reason);
        if (parent && typeof parent.windowExit === "function" && parent.state !== "close" && parent.state !== "released") {
            // In foreground this arms immediate close; while closing,
            // windowExit directly shuts down LG's close timer and releases us.
            if (typeof parent.windowSetProperty === "function") {
                parent.windowSetProperty("keepWindowOnAppSwitch", false);
                parent.windowSetProperty("delayCloseWindowTimeout", 0);
            }
            parent.windowExit({reason: reason});
        }
    }

    function launch(payload) {
        if (ending) return;
        // The controller must create a new instance after the previous one is
        // destroyed. A reusable immutable QML URL does not make state reusable.
        if (configured) { finish("unexpected-relaunch"); return; }
        var now = Date.now();
        if (!payload || typeof payload.blurToken !== "string" || !/^[0-9a-f]{64}$/.test(payload.blurToken) ||
                payload.blurPort !== 48740 || typeof payload.blurSessionDeadline !== "number" ||
                !isFinite(payload.blurSessionDeadline) || payload.blurSessionDeadline <= now ||
                payload.blurSessionDeadline > now + 600000) { finish("invalid-launch"); return; }
        token = payload.blurToken;
        sessionDeadline = Math.min(payload.blurSessionDeadline, createdAt + 600000);
        if (sessionDeadline <= now) { finish("expired-launch"); return; }
        if (!parent || typeof parent.windowSetProperty !== "function" || typeof parent.windowShow !== "function" ||
                typeof compositor === "undefined" || !allowedHome(compositor.fullscreen)) { finish("invalid-home-host"); return; }
        configured = true;
        homeSource = compositor.fullscreen;
        leaseExpiresAt = Math.min(now + 8000, sessionDeadline);
        parent.windowSetProperty("needFocus", false);
        parent.windowSetProperty("keepWindowOnAppSwitch", true);
        parent.windowSetProperty("delayCloseWindowTimeout", 0);
        shown = true;
        parent.windowShow({});
        hardLimit.interval = Math.max(1, sessionDeadline - now);
        hardLimit.start();
        readyCheck.start();
        boundaryCheck.start();
    }

    function completeReady() {
        if (ending || ready) { readyCheck.stop(); return; }
        if (!allowedHome(homeSource) || typeof compositor === "undefined" || compositor.fullscreen !== homeSource) {
            finish("home-changed-before-ready"); return;
        }
        // Allow the asynchronous Loader to attach the owned host to its window.
        if (!visible || !parent.visible || parent.state !== "foreground") return;
        if (!homeStillCurrent()) { finish("unsafe-source-window"); return; }
        if (!backdrop.begin(homeSource, sessionDeadline) || !backdrop.setMainState(false, 0)) {
            finish("backdrop-not-ready"); return;
        }
        ready = true;
        readyCheck.stop();
        postEvent("loaded", "Allowed fullscreen source verified; waiting for web takeover and state");
        pollAgain.start();
    }

    function renderState() {
        if (ending || !ready) return;
        if (!homeStillCurrent() || !visible || !parent.visible || (takeoverStarted && !webIsCurrent())) {
            finish("render-boundary-changed"); return;
        }
        var render = takeoverStarted && haveState && stateVisible && stateMain && Date.now() < leaseExpiresAt;
        if (!backdrop.setMainState(render, stateSelected)) { finish("backdrop-state-refused"); return; }
        var signature = String(render) + ":" + stateSelected;
        if (signature !== renderSignature) {
            renderSignature = signature;
            postEvent("render", JSON.stringify({revision: revision, rendering: render, selected: stateSelected}));
        }
    }

    function acceptState(value) {
        if (ending) return false;
        if (value && value.alive === false) { finish("controller-ended-session"); return false; }
        var now = Date.now();
        if (!value || typeof value !== "object" || Array.isArray(value) || value.alive !== true ||
                typeof value.visible !== "boolean" || typeof value.main !== "boolean" ||
                typeof value.selected !== "number" || value.selected !== Math.floor(value.selected) || value.selected < 0 || value.selected > 8 ||
                typeof value.revision !== "number" || !isFinite(value.revision) || value.revision !== Math.floor(value.revision) ||
                value.revision < revision || value.revision > 9007199254740991 ||
                typeof value.expiresAt !== "number" || !isFinite(value.expiresAt) || value.expiresAt <= now ||
                value.expiresAt > now + 8000 || value.expiresAt > sessionDeadline) { finish("invalid-controller-state"); return false; }
        // A repeated revision never extends its previous lease or changes state.
        if (haveState && value.revision === revision) return true;
        revision = value.revision;
        haveState = true;
        stateVisible = value.visible;
        stateMain = value.main;
        stateSelected = value.selected;
        // An initial eight-second startup response may cross the takeover. Its
        // applied lease is still capped at four seconds once web owns the view.
        leaseExpiresAt = Math.min(value.expiresAt, now + (takeoverStarted ? 4000 : 8000), sessionDeadline);
        renderState();
        return !ending;
    }

    function poll() {
        if (ending || !ready || pollRequest) return;
        if (Date.now() >= leaseExpiresAt || Date.now() >= sessionDeadline) { finish("lease-expired"); return; }
        var request = null;
        var generation = ++pollGeneration;
        try {
            request = new XMLHttpRequest();
            pollRequest = request;
            request.onreadystatechange = function () {
                if (request.readyState !== XMLHttpRequest.DONE || host.ending ||
                        host.pollGeneration !== generation || host.pollRequest !== request) return;
                host.pollTimeoutStop();
                host.pollRequest = null;
                request.onreadystatechange = null;
                if (request.status !== 200 || request.responseText.length > 4096) { host.finish("poll-failed"); return; }
                var value;
                try { value = JSON.parse(request.responseText); } catch (error) { host.finish("invalid-state-json"); return; }
                if (host.acceptState(value)) pollAgain.start();
            };
            request.open("GET", "http://127.0.0.1:48740/native?token=" + token + "&after=" + revision, true);
            pollTimeout.start();
            request.send();
        } catch (error) {
            abortPoll();
            finish("poll-request-failed");
        }
    }

    // Keep the callback independent of QML id lookup through the host object.
    function pollTimeoutStop() { pollTimeout.stop(); }

    function takeOver(payload) {
        if (ending) return;
        if (takeoverStarted || !ready || !homeStillCurrent() || !webIsCurrent() || (payload && payload.reason)) {
            finish("non-takeover-close"); return;
        }
        takeoverStarted = true;
        startupLimit.stop();
        leaseExpiresAt = Math.min(leaseExpiresAt, Date.now() + 4000, sessionDeadline);
        postEvent("takeover", "web owns overlay; retaining bounded native backdrop");
        renderState();
    }

    function checkBoundaries() {
        if (ending) return;
        var now = Date.now();
        if (now >= sessionDeadline || now >= leaseExpiresAt) { finish("lease-expired"); return; }
        if (ready && (!homeStillCurrent() || !visible || !parent.visible)) { finish("home-or-host-changed"); return; }
        if (takeoverStarted && (!webIsCurrent() || parent.state !== "closing")) { finish("web-overlay-gone"); return; }
        for (var i = eventRequests.length - 1; i >= 0; i--) {
            var entry = eventRequests[i];
            if (now - entry.at >= 2500) {
                eventRequests.splice(i, 1);
                try { entry.request.onreadystatechange = null; entry.request.abort(); } catch (ignore) {}
            }
        }
    }

    Backdrop {
        id: backdrop
        homeIsCurrent: host.homeStillCurrent()
        onStopped: if (!host.ending) host.finish("backdrop-" + reason)
    }

    Connections {
        target: host.parent
        ignoreUnknownSignals: true
        onLifeCycleStatusChanged: {
            if (!lifecycle || host.ending) return;
            if (lifecycle.event === "launch") host.launch(lifecycle);
            else if (lifecycle.event === "close") host.takeOver(lifecycle);
        }
        onStateChanged: {
            if (host.shown && (host.parent.state === "close" || host.parent.state === "released" || host.parent.state === "background"))
                host.finish("host-" + host.parent.state);
        }
        onVisibleChanged: if (host.ready && !host.parent.visible) host.finish("host-hidden")
    }
    Component.onCompleted: startupLimit.start()
    Component.onDestruction: {
        ending = true;
        cleanup("destroyed");
        postEvent("destroyed", "native host destroyed");
    }
    onVisibleChanged: if (ready && !visible) finish("host-hidden")

    Timer { id: startupLimit; interval: 8000; repeat: false; onTriggered: host.finish("web-startup-timeout") }
    Timer { id: readyCheck; interval: 50; repeat: true; onTriggered: host.completeReady() }
    Timer { id: boundaryCheck; interval: 250; repeat: true; onTriggered: host.checkBoundaries() }
    Timer { id: hardLimit; repeat: false; onTriggered: host.finish("hard-session-deadline") }
    Timer { id: pollAgain; interval: 25; repeat: false; onTriggered: host.poll() }
    Timer { id: pollTimeout; interval: 2500; repeat: false; onTriggered: { host.abortPoll(); host.finish("poll-timeout"); } }
}
