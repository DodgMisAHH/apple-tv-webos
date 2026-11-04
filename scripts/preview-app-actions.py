#!/usr/bin/env python3
"""Isolated long-press prototype. Only app assets and explicit preview files are served."""
import hashlib
import http.server
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'app'
PREVIEW = ROOT / 'preview' / 'app-actions'
FILES = {name: PREVIEW / name for name in (
    'control-centre.js', 'preferences.js')}
RELOAD = '''<script>(function(){var stamp;setInterval(function(){
fetch('/__preview_version').then(function(r){return r.text();}).then(function(next){
if(stamp&&stamp!==next)location.reload();stamp=next;}).catch(function(){});
},1200);})();</script>'''


class Preview(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP), **kwargs)

    def do_GET(self):
        route = self.path.split('?', 1)[0]
        if route in ('/', '/index.html'):
            html = (APP / 'index.html').read_text()
            html = html.replace('<title>Home</title>', '<title>Home · App actions preview</title>')
            html = re.sub(r'<script src="app.js[^"]*"></script>',
                          lambda match: '<script src="/__app_actions/preferences.js"></script>' + match.group(0), html)
            html = re.sub(r'<script src="control-centre.js[^"]*"></script>',
                          '<script src="/__app_actions/control-centre.js"></script>', html)
            self.send_bytes(html.replace('</body>', RELOAD + '</body>').encode(), 'text/html; charset=utf-8')
        elif route == '/__preview_version':
            files = sorted(p for folder in (APP, PREVIEW) for p in folder.rglob('*') if p.is_file())
            stamp = ''.join(str(p.relative_to(ROOT)) + str(p.stat().st_mtime_ns) for p in files)
            self.send_bytes(hashlib.sha256(stamp.encode()).hexdigest().encode(), 'text/plain')
        elif route.startswith('/__app_actions/'):
            name = route.removeprefix('/__app_actions/')
            if name not in FILES:
                self.send_error(404)
                return
            content_type = 'application/javascript' if name.endswith('.js') else 'text/css'
            self.send_bytes(FILES[name].read_bytes(), content_type + '; charset=utf-8')
        else:
            # SimpleHTTPRequestHandler safely normalizes paths under app/, not the workspace.
            super().do_GET()

    def send_bytes(self, value, content_type):
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(value)))
        self.end_headers()
        self.wfile.write(value)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    print('App actions preview: http://127.0.0.1:4797/', flush=True)
    http.server.ThreadingHTTPServer(('127.0.0.1', 4797), Preview).serve_forever()
