#!/data/data/com.termux/files/usr/bin/python
"""Android speech recognition for the web app, offline-capable.

Chrome on Android sends web speech recognition to an online service, so it stops in airplane mode.
Android's own SpeechRecognizer (the engine Gboard voice typing uses) works offline when the language's
offline pack is installed. Termux:API exposes it as `termux-speech-to-text`; this bridge streams its output
to the app over Server-Sent Events on localhost.

  GET /health  -> {"ok": true}
  GET /listen  -> text/event-stream: "data: <partial or final text>" lines, then "event: done"
  GET /stop    -> stops the current recognition

Needs: the Termux:API app (same store as Termux) + `pkg install termux-api`, microphone permission for Termux:API.
Recognition language: Google app -> Settings -> Voice -> Languages (several can be selected; it auto-detects).
"""
import json
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8084
current = {"proc": None}
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def _head(self, code=200, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def log_message(self, *args):  # keep Termux quiet
        pass

    def do_GET(self):
        if self.path.startswith("/health"):
            self._head()
            self.wfile.write(json.dumps({"ok": bool(shutil.which("termux-speech-to-text"))}).encode())
            return
        if self.path.startswith("/stop"):
            with lock:
                p = current["proc"]
                if p and p.poll() is None:
                    p.terminate()
            self._head()
            self.wfile.write(b'{"stopped": true}')
            return
        if self.path.startswith("/listen"):
            self._head(ctype="text/event-stream")
            with lock:
                old = current["proc"]
                if old and old.poll() is None:
                    old.terminate()
                proc = subprocess.Popen(["termux-speech-to-text"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
                current["proc"] = proc
            try:
                for line in proc.stdout:
                    line = line.strip()
                    if line.startswith("ERROR"):  # e.g. "ERROR: ERROR_NO_MATCH": not speech
                        code = line.split(":", 1)[-1].strip() or "ERROR"
                        self.wfile.write(f"event: stterror\ndata: {json.dumps(code)}\n\n".encode())
                        self.wfile.flush()
                    elif line:
                        self.wfile.write(f"data: {json.dumps(line)}\n\n".encode())
                        self.wfile.flush()
                self.wfile.write(b"event: done\ndata: \"\"\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                proc.terminate()
            return
        self._head(404)
        self.wfile.write(b'{"error": "not found"}')


if __name__ == "__main__":
    print(f"speech bridge on http://127.0.0.1:{PORT} (termux-speech-to-text: {'found' if shutil.which('termux-speech-to-text') else 'MISSING'})")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
