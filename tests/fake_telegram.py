"""A fake Telegram Bot API (and a fake Healthchecks.io) for the tests. Nothing leaves the machine.

Bot API:  POST /bot<token>/<method>   getMe, sendMessage, getUpdates, sendDocument (multipart), deleteMessage
          tokens starting "1234567:" are good, anything else is Unauthorized; chat "400" answers "chat not found"
Pings:    GET /ping/<uuid>, POST /api/v3/checks/<uuid>/pause (needs X-Api-Key)
For tests: GET /_sent (messages), GET /_docs (documents: chat, caption, file name / size / first bytes), GET /_deleted,
          GET /_hc (pings / pauses), POST /_reset
Run alone: python3 tests/fake_telegram.py 8767"""
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SENT, HC, DOCS, DELETED = [], [], [], []


def _multipart(raw: bytes, ctype: str) -> dict:
    """Just enough of multipart/form-data: {name: str | {filename, size, head}}."""
    b = ctype.split("boundary=", 1)[1].strip().encode()
    out = {}
    for part in raw.split(b"--" + b)[1:]:
        if part.startswith(b"--"):
            break
        head, _, body = part.lstrip(b"\r\n").partition(b"\r\n\r\n")
        body = body[:-2] if body.endswith(b"\r\n") else body
        h = head.decode(errors="replace")
        name = h.split('name="', 1)[1].split('"', 1)[0]
        if 'filename="' in h:
            out[name] = {"filename": h.split('filename="', 1)[1].split('"', 1)[0], "size": len(body), "head": body[:8].hex()}
        else:
            out[name] = body.decode(errors="replace")
    return out


UPDATES = [
    {"update_id": 1, "message": {"message_id": 1, "chat": {"id": 5550001, "type": "private", "first_name": "Venkat"}, "text": "hi"}},
    {"update_id": 2, "channel_post": {"message_id": 7, "chat": {"id": -1009990001, "type": "channel", "title": "Trade alerts"}, "text": "x"}},
]


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _out(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/_sent":
            return self._out(200, SENT)
        if self.path == "/_hc":
            return self._out(200, HC)
        if self.path == "/_docs":
            return self._out(200, DOCS)
        if self.path == "/_deleted":
            return self._out(200, DELETED)
        if self.path.startswith("/ping/"):
            HC.append({"t": time.time(), "what": "ping", "id": self.path[6:]})
            return self._out(200, {"ok": True})
        self._out(404, {"ok": False})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        if self.path == "/_reset":
            SENT.clear(); HC.clear(); DOCS.clear(); DELETED.clear()
            return self._out(200, {"ok": True})
        if self.path.startswith("/api/v3/checks/") and self.path.endswith("/pause"):
            if not self.headers.get("X-Api-Key"):
                return self._out(401, {"error": "missing api key"})
            HC.append({"t": time.time(), "what": "pause", "id": self.path.split("/")[4], "key": self.headers.get("X-Api-Key")})
            return self._out(200, {"status": "paused"})
        if not self.path.startswith("/bot"):
            return self._out(404, {"ok": False})
        tok, method = self.path[4:].split("/", 1)
        if not tok.startswith("1234567:"):
            return self._out(401, {"ok": False, "error_code": 401, "description": "Unauthorized"})
        ctype = self.headers.get("Content-Type") or ""
        if ctype.startswith("multipart/form-data"):
            p = _multipart(raw, ctype)
        else:
            try:
                p = json.loads(raw.decode() or "{}")
            except ValueError:
                p = {}
        if method == "getMe":
            return self._out(200, {"ok": True, "result": {"id": 1234567, "is_bot": True, "username": "ftm_test_bot"}})
        if method == "getUpdates":
            return self._out(200, {"ok": True, "result": UPDATES})
        if method == "sendMessage":
            if str(p.get("chat_id")) == "400":
                return self._out(400, {"ok": False, "error_code": 400, "description": "Bad Request: chat not found"})
            SENT.append({"t": time.time(), "chat": str(p.get("chat_id")), "text": p.get("text", ""),
                         "silent": bool(p.get("disable_notification")), "mode": p.get("parse_mode")})
            return self._out(200, {"ok": True, "result": {"message_id": len(SENT)}})
        if method == "sendDocument":
            if str(p.get("chat_id")) == "400":
                return self._out(400, {"ok": False, "error_code": 400, "description": "Bad Request: chat not found"})
            doc = p.get("document") or {}
            DOCS.append({"t": time.time(), "chat": str(p.get("chat_id")), "caption": p.get("caption", ""),
                         "silent": p.get("disable_notification") == "true", "mode": p.get("parse_mode"),
                         "filename": doc.get("filename"), "size": doc.get("size"), "head": doc.get("head")})
            mid = 1000 + len(DOCS)
            return self._out(200, {"ok": True, "result": {"message_id": mid, "document": {"file_id": f"F{mid}", "file_size": doc.get("size")}}})
        if method == "deleteMessage":
            DELETED.append({"chat": str(p.get("chat_id")), "msg": p.get("message_id")})
            return self._out(200, {"ok": True, "result": True})
        self._out(404, {"ok": False, "error_code": 404, "description": "Not Found"})


def start(port: int = 8767) -> ThreadingHTTPServer:
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


if __name__ == "__main__":
    start(int(sys.argv[1]) if len(sys.argv) > 1 else 8767)
    print("fake Telegram on", sys.argv[1:] or 8767, flush=True)
    while True:
        time.sleep(3600)
