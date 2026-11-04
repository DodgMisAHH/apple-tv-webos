.pragma library

// Shared by both launch paths. A request can animate only one surface, once.
var lastToken = '';
var diagnostic = '';

function trace(phase, message) {
    try {
        var output = new XMLHttpRequest();
        output.open('PUT', 'file:///tmp/lg-tv-zoom-' + phase + '.json', false);
        output.send(JSON.stringify({ time: Date.now(), message: message }));
    } catch (error) { /* diagnostics must never affect rendering */ }
}

function validate(record, appId, now, width, height, consume) {
    if (!record || record.sourceAppId !== 'com.gathin.tvhome' || record.appId !== appId ||
            typeof record.token !== 'string' || record.token === lastToken ||
            typeof record.created !== 'number' || now < record.created || now - record.created > 30000)
        return null;
    var r = record.rect;
    if (!r || typeof r.x !== 'number' || typeof r.y !== 'number' ||
            typeof r.width !== 'number' || typeof r.height !== 'number' ||
            !isFinite(r.x + r.y + r.width + r.height) || r.x < 0 || r.y < 0 ||
            r.width < 16 || r.height < 16 || r.x + r.width > 1921 || r.y + r.height > 1081)
        return null;
    if (!(width > 0 && height > 0)) return null;
    if (consume !== false) lastToken = record.token;
    return { x: r.x * width / 1920, y: r.y * height / 1080,
        width: r.width * width / 1920, height: r.height * height / 1080 };
}

function pending(appId, width, height) {
    return Boolean(read(appId, width, height, false));
}

function read(appId, width, height, consume) {
    diagnostic = 'request ' + appId + ' ' + width + 'x' + height;
    if (!appId) { diagnostic += ' missing app'; return null; }
    try {
        var request = new XMLHttpRequest();
        request.open('GET', 'file:///tmp/lg-tv-launch-origin.json', false);
        request.send();
        diagnostic += ' length=' + request.responseText.length + ' state=' + request.readyState;
        if (request.responseText.length > 2048) return null;
        var record = JSON.parse(request.responseText);
        var result = validate(record, appId, Date.now(), width, height, consume);
        diagnostic += ' age=' + (Date.now() - record.created) + ' recordApp=' + record.appId + ' accepted=' + Boolean(result);
        trace('origin', diagnostic);
        return result;
    } catch (error) {
        diagnostic += ' error=' + error;
        trace('origin', diagnostic);
        return null; // Missing/expired metadata retains LG's original animation.
    }
}
