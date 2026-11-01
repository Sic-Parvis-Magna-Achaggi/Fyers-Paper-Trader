"""A fake GitHub REST API (git data endpoints only) for tests/github_upload_flow.js: repos, refs, commits, trees, blobs,
with CORS like api.github.com, so tools/github_upload.html can be tested from a file:// page.
Test controls: POST /_seed {files: {path: [mode, base64]}}, GET /_state, POST /_bump (someone else commits),
POST /_limit {n} (the next n blob POSTs answer GitHub's secondary rate limit). Token: "good-token".
Run: python3 tests/fake_github.py [port]   (default 8768)"""
import base64, hashlib, json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OBJ = {"blob": {}, "tree": {}, "commit": {}}
REF = {"main": None}
LIM = {"n": 0}
CALLS = []


def blob_sha(data: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def put_tree(files: dict) -> str:          # files: path -> (mode, blob sha); stored flat (enough for the tool)
    sha = hashlib.sha1(json.dumps(sorted(files.items())).encode()).hexdigest()
    OBJ["tree"][sha] = dict(files)
    return sha


def put_commit(tree, parents, msg) -> str:
    sha = hashlib.sha1(json.dumps([tree, parents, msg, len(OBJ["commit"])]).encode()).hexdigest()
    OBJ["commit"][sha] = {"tree": tree, "parents": parents, "message": msg}
    return sha


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body=None, extra=None):
        b = json.dumps(body if body is not None else {}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Expose-Headers", "ETag, Link, Location, Retry-After, X-RateLimit-Reset")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, X-GitHub-Api-Version")
        self.end_headers()

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def _auth(self):
        if self.headers.get("Authorization") != "Bearer good-token":
            self._send(401, {"message": "Bad credentials"})
            return False
        return True

    def route(self, method):
        path = self.path.split("?")[0]
        CALLS.append(f"{method} {path}")
        if path == "/_state":
            head = REF["main"]
            files = OBJ["tree"][OBJ["commit"][head]["tree"]] if head else {}
            return self._send(200, {"head": head, "message": head and OBJ["commit"][head]["message"],
                                    "parents": head and OBJ["commit"][head]["parents"], "commits": len(OBJ["commit"]),
                                    "files": {p: [m, s] for p, (m, s) in files.items()}, "calls": CALLS[-200:]})
        if path == "/_seed":
            b = self._body()
            files = {}
            for p, (mode, b64) in b["files"].items():
                data = base64.b64decode(b64)
                s = blob_sha(data)
                OBJ["blob"][s] = data
                files[p] = (mode, s)
            REF["main"] = put_commit(put_tree(files), [], "seed")
            CALLS.clear()
            return self._send(200, {"head": REF["main"]})
        if path == "/_bump":
            head = REF["main"]
            REF["main"] = put_commit(OBJ["commit"][head]["tree"], [head], "someone else")
            return self._send(200, {"head": REF["main"]})
        if path == "/_limit":
            LIM["n"] = int(self._body().get("n", 0))
            return self._send(200, {})
        if not self._auth():
            return
        parts = path.strip("/").split("/")          # repos/<o>/<r>/...
        if parts[0] != "repos" or len(parts) < 3:
            return self._send(404, {"message": "Not Found"})
        rest = parts[3:]
        if not rest and method == "GET":
            return self._send(200, {"default_branch": "main", "full_name": parts[1] + "/" + parts[2]})
        if rest[:3] == ["git", "ref", "heads"] and method == "GET":
            br = "/".join(rest[3:])
            if br not in REF or not REF[br]:
                return self._send(404, {"message": "Not Found"})
            return self._send(200, {"ref": "refs/heads/" + br, "object": {"sha": REF[br], "type": "commit"}})
        if rest[:2] == ["git", "commits"]:
            if method == "GET":
                c = OBJ["commit"].get(rest[2])
                if not c:
                    return self._send(404, {"message": "Not Found"})
                return self._send(200, {"sha": rest[2], "tree": {"sha": c["tree"]}, "message": c["message"],
                                        "parents": [{"sha": p} for p in c["parents"]]})
            b = self._body()
            if b["tree"] not in OBJ["tree"] or any(p not in OBJ["commit"] for p in b.get("parents", [])):
                return self._send(422, {"message": "Invalid tree or parent"})
            return self._send(201, {"sha": put_commit(b["tree"], b["parents"], b["message"])})
        if rest[:2] == ["git", "trees"]:
            if method == "GET":
                t = OBJ["tree"].get(rest[2])
                if t is None:
                    return self._send(404, {"message": "Not Found"})
                return self._send(200, {"sha": rest[2], "truncated": False,
                                        "tree": [{"path": p, "mode": m, "type": "blob", "sha": s} for p, (m, s) in sorted(t.items())]})
            b = self._body()
            files = dict(OBJ["tree"][b["base_tree"]]) if b.get("base_tree") else {}
            for e in b["tree"]:
                if e.get("sha") is None:
                    if e["path"] not in files:
                        return self._send(422, {"message": "path not in base tree: " + e["path"]})
                    files.pop(e["path"])
                else:
                    if e["sha"] not in OBJ["blob"]:
                        return self._send(422, {"message": "unknown blob"})
                    files[e["path"]] = (e["mode"], e["sha"])
            return self._send(201, {"sha": put_tree(files)})
        if rest[:2] == ["git", "blobs"]:
            if method == "GET":
                d = OBJ["blob"].get(rest[2])
                if d is None:
                    return self._send(404, {"message": "Not Found"})
                return self._send(200, {"sha": rest[2], "content": base64.b64encode(d).decode(), "encoding": "base64"})
            if LIM["n"] > 0:
                LIM["n"] -= 1
                return self._send(403, {"message": "You have exceeded a secondary rate limit. Please wait a few minutes before you try again."},
                                  {"Retry-After": "1"})
            b = self._body()
            data = base64.b64decode(b["content"]) if b.get("encoding") == "base64" else b["content"].encode()
            s = blob_sha(data)
            OBJ["blob"][s] = data
            return self._send(201, {"sha": s})
        if rest[:3] == ["git", "refs", "heads"] and method == "PATCH":
            br = "/".join(rest[3:])
            b = self._body()
            c = OBJ["commit"].get(b["sha"])
            if not c:
                return self._send(422, {"message": "Object does not exist"})
            if not b.get("force") and REF[br] not in c["parents"]:
                return self._send(422, {"message": "Update is not a fast forward"})
            REF[br] = b["sha"]
            return self._send(200, {"ref": "refs/heads/" + br, "object": {"sha": b["sha"]}})
        return self._send(404, {"message": "Not Found"})

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_PATCH(self):
        self.route("PATCH")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8768
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
