#!/usr/bin/env python3
"""Run the local prototype with automatic reload after source changes."""
import functools
import http.server
import json
import pathlib
import socketserver
import argparse
ROOT = pathlib.Path(__file__).resolve().parent
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def do_GET(self):
        if self.path.split('?')[0] == '/__revision':
            version = max(p.stat().st_mtime_ns for p in ROOT.iterdir() if p.suffix in {'.html', '.css', '.js', '.mjs'})
            body = json.dumps({'version':str(version)}).encode()
            self.send_response(200)
            self.send_header('Content-Type','application/json')
            self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()
    def end_headers(self):
        self.send_header('Cache-Control','no-cache')
        super().end_headers()
    def log_message(self, fmt, *args):
        if '/__revision' not in str(args): super().log_message(fmt,*args)
if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=5173)
    args = parser.parse_args()
    class Server(socketserver.ThreadingMixIn,http.server.HTTPServer):
        daemon_threads = True
        allow_reuse_address = True
    with Server(('127.0.0.1',args.port),Handler) as server:
        print('Local: http://127.0.0.1:%s' % args.port, flush=True)
        server.serve_forever()
