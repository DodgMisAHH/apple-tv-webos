#!/usr/bin/env python3
"""Loopback-only app preview with reload on local asset changes. Never serves the workspace."""
import hashlib
import http.server
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / 'app'
RELOAD = b'''<script>(function(){var stamp;setInterval(function(){
var x=new XMLHttpRequest();x.open('GET','/__preview_version');x.onload=function(){
if(stamp&&stamp!==x.responseText)location.reload();stamp=x.responseText;};x.send();
},1200);})();</script>'''


class Preview(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP), **kwargs)

    def do_GET(self):
        route = self.path.split('?', 1)[0]
        if route == '/__preview_version':
            files = sorted(p for p in APP.rglob('*') if p.is_file())
            value = hashlib.sha256(''.join(
                str(p.relative_to(APP)) + str(p.stat().st_mtime_ns)
                for p in files).encode()).hexdigest().encode()
            self.send_bytes(value, 'text/plain')
        elif route in ('/', '/index.html'):
            self.send_bytes((APP / 'index.html').read_bytes().replace(
                b'</body>', RELOAD + b'</body>'), 'text/html; charset=utf-8')
        else:
            super().do_GET()

    def send_bytes(self, value, content_type):
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(value)))
        self.end_headers()
        self.wfile.write(value)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    print('Live preview: http://127.0.0.1:4795/', flush=True)
    http.server.ThreadingHTTPServer(('127.0.0.1', 4795), Preview).serve_forever()
