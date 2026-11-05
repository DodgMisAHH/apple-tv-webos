#!/usr/bin/env python3
"""Loopback-only video demo using the real shared overlay and public app assets."""
import http.server
import mimetypes
import re
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'app'
PREVIEW = ROOT / 'preview'
PORT = 4798
ASSETS = {
    'config.js', 'overlay.js', 'overlay.css', 'control-centre.js',
    'control-centre.css', 'hidden-apps.css', 'tv-controls.js', 'wifi-controls.js',
    'vpn-controls.js', 'qrcode.js',
}
def render_demo():
    """Compose the actual overlay markup/assets without copying its UI source."""
    overlay = (APP / 'overlay.html').read_text()
    body = re.search(r'<body[^>]*>(.*?)</body>', overlay, re.S).group(1)
    scripts = re.findall(r'<script\b[^>]*>.*?</script>', body, re.S)
    scripts = [script for script in scripts if 'file:///' not in script and 'src="screen.js"' not in script]
    markup = re.sub(r'<script\b[^>]*>.*?</script>', '', body, flags=re.S)
    styles = re.findall(r'<link\b[^>]*rel="stylesheet"[^>]*>', overlay)
    html = (PREVIEW / 'video-overlay.html').read_text()
    return (html.replace('<!-- OVERLAY_STYLES -->', '\n'.join(styles))
            .replace('<!-- OVERLAY_DOM -->', markup)
            .replace('<!-- OVERLAY_SCRIPTS -->', '\n'.join(scripts)))


class Preview(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        route = urlsplit(self.path).path
        if route in ('/', '/index.html'):
            return self.send_bytes(render_demo().encode(), 'text/html; charset=utf-8')
        if route in ('/__demo/video-overlay.js', '/__demo/video-overlay.css'):
            return self.send_file(PREVIEW / route.rsplit('/', 1)[1], PREVIEW)
        if route == '/user.js':
            return self.send_bytes(b'// Browser demo: no personal settings.\n', 'application/javascript')
        if route == '/__demo/wall.js':
            return self.send_bytes(b'window.WALL_URL = "";\n', 'application/javascript')
        if route.lstrip('/') in ASSETS or re.fullmatch(r'/ui-icons/[a-z0-9-]+\.svg', route):
            return self.send_file(APP / route.lstrip('/'), APP)
        self.send_error(404, 'Only public overlay assets are served by this preview.')

    def send_file(self, source, allowed_root):
        source = source.resolve()
        if not source.is_relative_to(allowed_root.resolve()) or not source.is_file():
            return self.send_error(404)
        self.send_bytes(source.read_bytes(), mimetypes.guess_type(source.name)[0] or 'application/octet-stream')

    def send_bytes(self, value, content_type):
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(value)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy',
                         "default-src 'self'; script-src 'self' 'unsafe-inline'; "
                         "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
                         "media-src https://media.w3.org blob:; connect-src 'self'; "
                         "frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(value)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    print('Video overlay preview: http://127.0.0.1:' + str(PORT) + '/', flush=True)
    print('Browser demonstration only. No TV connection. Ctrl+C stops the preview.', flush=True)
    try:
        http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Preview).serve_forever()
    except KeyboardInterrupt:
        pass
