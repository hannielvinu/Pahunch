#!/data/data/com.termux/files/usr/bin/python
"""Serves the Pahunch app on http://localhost:8080 with caching switched off.

python -m http.server sends no cache headers, so Chrome may keep an old copy of a file after `git pull` and mix it
with new ones (an old script importing a file that no longer exists stops the whole app at the splash screen).
Here every app file is sent with Cache-Control: no-store; the service worker still keeps an offline copy.
Usage: python tools/serve.py [port]
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript",
                      ".webmanifest": "application/manifest+json", ".wasm": "application/wasm"}

    def end_headers(self):
        if "/models/" not in self.path and "/lib/" not in self.path:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"Pahunch app on http://localhost:{port}")
    ThreadingHTTPServer(("", port), partial(Handler, directory=ROOT)).serve_forever()
