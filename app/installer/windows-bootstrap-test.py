"""Synthetic transport/model tests, usable on Windows PS5.1 or portable PowerShell.
Usage: python windows-bootstrap-test.py /path/to/pwsh (or powershell.exe).
No production downloads, installed application, registry or personal data are used.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import sys
import threading
import time

DATA = b"fixture-content-" * 10000
requests = []
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_GET(self):
        header = self.headers.get('Range')
        requests.append((self.path, header))
        offset = int(header.split('=')[1].split('-')[0]) if header else 0
        if self.path == '/range-416' and header:
            self.send_response(416)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        body = b'wrong' if self.path == '/corrupt' else DATA
        ranged = header and self.path != '/ignore-range'
        self.send_response(206 if ranged else 200)
        if ranged:
            start = offset + 1 if self.path == '/bad-range' else offset
            self.send_header('Content-Range', f'bytes {start}-{len(body)-1}/{len(body)}')
            body = body[offset:]
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.path == '/disconnect' and sum(p == self.path for p, _ in requests) == 1:
            self.wfile.write(body[:1000])
            self.close_connection = True
        else:
            try:
                if self.path == '/file':
                    for start in range(0, len(body), 16000):
                        self.wfile.write(body[start:start+16000])
                        self.wfile.flush()
                        time.sleep(0.04)
                else:
                    self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

if __name__ == '__main__':
    root = Path(__file__).resolve().parent
    shell = sys.argv[1] if len(sys.argv) > 1 else 'powershell.exe'
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        subprocess.run([shell, '-NoProfile', '-File', str(root / 'windows-bootstrap-progress-selftest.ps1'),
                        '-BaseUrl', f'http://127.0.0.1:{server.server_port}'], check=True)
        assert ('/range', 'bytes=1234-') in requests
        assert sum(p == '/file' for p, _ in requests) == 1
        assert sum(p == '/bad-range' for p, _ in requests) == 2
        print('TRANSPORT_ASSERTIONS_PASS')
    finally:
        server.shutdown()
        server.server_close()
