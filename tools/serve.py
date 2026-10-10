#!/data/data/com.termux/files/usr/bin/python
"""Serves the Pahunch app on http://localhost:8080 with caching switched off, plus the small order store the demo
shop (instakart.html) and the rider app share.

python -m http.server sends no cache headers, so Chrome may keep an old copy of a file after `git pull` and mix it
with new ones. Here every app file is sent with Cache-Control: no-store; the service worker still keeps an offline copy.

Order store (demo; files in orders/, on this phone):
  POST /api/orders                  {customer, address, items, total, lang, note, audio: data-URL}  -> {id}
  GET  /api/orders                  newest first, without the audio (audio is at orders/<id>.<ext>)
  POST /api/orders/<id>/status      {status}         placed -> accepted -> arrived -> delivered
  POST /api/orders/<id>/messages    {from, ...}      rider question / customer answer
Usage: python tools/serve.py [port]
"""
import base64
import json
import os
import re
import sys
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORDERS = os.path.join(ROOT, "orders")
AUDIO_EXT = {"audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav"}


def load(oid):
    with open(os.path.join(ORDERS, f"{oid}.json"), encoding="utf-8") as f:
        return json.load(f)


def save(order):
    with open(os.path.join(ORDERS, f"{order['id']}.json"), "w", encoding="utf-8") as f:
        json.dump(order, f, ensure_ascii=False)


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript",
                      ".webmanifest": "application/manifest+json", ".wasm": "application/wasm", ".webm": "audio/webm"}

    def end_headers(self):
        if "/models/" not in self.path and "/lib/" not in self.path:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass

    def reply(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if 0 < n < 25_000_000 else {}

    def do_GET(self):
        if self.path.split("?")[0] == "/api/orders":
            os.makedirs(ORDERS, exist_ok=True)
            items = []
            for name in os.listdir(ORDERS):
                if name.endswith(".json"):
                    try:
                        items.append(load(name[:-5]))
                    except Exception:
                        pass
            items.sort(key=lambda o: o.get("at", 0), reverse=True)
            return self.reply(200, items[:20])
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        try:
            if path == "/api/orders":
                os.makedirs(ORDERS, exist_ok=True)
                d = self.body()
                oid = "IK" + str(int(time.time()))[-5:]
                order = {k: d.get(k) for k in ("customer", "phone", "address", "items", "total", "lang", "note")}
                order.update(id=oid, at=int(time.time() * 1000), status="placed", messages=[], audio=None)
                m = re.match(r"data:([^;,]+)(?:;[^,]*)?,(.*)", d.get("audio") or "", re.S)
                if m:
                    ext = AUDIO_EXT.get(m.group(1).split(";")[0], "webm")
                    with open(os.path.join(ORDERS, f"{oid}.{ext}"), "wb") as f:
                        f.write(base64.b64decode(m.group(2)))
                    order["audio"] = f"orders/{oid}.{ext}"
                save(order)
                return self.reply(200, {"id": oid})
            m = re.match(r"/api/orders/(IK\d+)/(status|messages)$", path)
            if m:
                order, d = load(m.group(1)), self.body()
                if m.group(2) == "status":
                    order["status"] = d.get("status", order["status"])
                else:
                    order.setdefault("messages", []).append({**d, "at": int(time.time() * 1000)})
                save(order)
                return self.reply(200, order)
        except FileNotFoundError:
            return self.reply(404, {"error": "no such order"})
        except Exception as e:  # keep the demo server alive whatever arrives
            return self.reply(400, {"error": str(e)})
        return self.reply(404, {"error": "not found"})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"Pahunch app on http://localhost:{port}  ·  Instakart demo shop: /instakart.html")
    ThreadingHTTPServer(("", port), partial(Handler, directory=ROOT)).serve_forever()
