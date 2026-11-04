#!/usr/bin/env python3
"""Isolated browser concept: app assets are read-only; nothing is packaged for TV."""
import http.server
import json
import re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'app'
class Preview(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(APP),**kwargs)
    def do_GET(self):
        if self.path.split('?')[0] in ('/','/index.html'):
            html=(APP/'index.html').read_text().replace('<title>Home</title>','<title>Control Centre · Preview</title>')
            html=html.replace((ROOT/'preview/control-centre.html').read_text(),'')
            html=re.sub(r'<link rel="stylesheet" href="control-centre.css[^"]*">|<script src="control-centre.js[^"]*"></script>', '', html)
            html=html.replace('</head>','<style>'+(ROOT/'preview/control-centre.css').read_text()+'</style></head>')
            html=html.replace('  <!-- Dropdown under the Inputs pill. -->',(ROOT/'preview/control-centre.html').read_text()+'\n  <!-- Dropdown under the Inputs pill. -->')
            snapshot=ROOT/'.local/wifi-preview.json'
            wifi=json.dumps(json.loads(snapshot.read_text()) if snapshot.exists() else None).replace('<','\\u003c')
            html=html.replace('</body>','<script type="application/json" id="wifiSnapshot">'+wifi+'</script></body>')
            html=html.replace('</body>','<script>'+(ROOT/'preview/control-centre.js').read_text()+'</script></body>')
            data=html.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        else: super().do_GET()
    def end_headers(self):
        self.send_header('Cache-Control','no-store');super().end_headers()
    def log_message(self,*args): pass
if __name__=='__main__':
    print('Control Centre preview: http://127.0.0.1:4796/',flush=True)
    http.server.ThreadingHTTPServer(('127.0.0.1',4796),Preview).serve_forever()
