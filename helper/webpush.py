"""Phone (and desktop) notifications through Web Push (v0.38.0): the app installed on a phone's home screen, or any
browser that allowed notifications, gets the alerts with the page closed and the phone locked. No app store, no
third-party service: the browser's own push service (Google's for Chrome / Android, Apple's for Safari / iPhone,
Mozilla's for Firefox) carries an encrypted message that only that browser can read.

- The server's key pair (VAPID, RFC 8292): made once, the private half sealed at rest (users.seal), in webpush.json.
- Each browser that subscribes: u/<user>/push.json = {"subs": [{endpoint, p256dh, auth, ua, name, added, ok, fails}]}.
- Messages are encrypted as RFC 8291 says (aes128gcm, RFC 8188), using only the `cryptography` package.
Tests point the subscriptions at a fake push service (tests/fake_push.py) that decrypts what it receives."""
import base64
import hashlib
import hmac
import json
import logging
import os
import struct
import time
import urllib.parse

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from . import store, users

log = logging.getLogger("webpush")
KEYS = "webpush.json"
MAX_SUBS = 12                       # browsers per user
TTL = 6 * 3600                      # a push service keeps an undelivered message this long (phone off / no signal)


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    s = str(s or "").strip()
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _pub_bytes(key) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


# ---------------------------------------------------------------- the server's VAPID key
_key_cache = None


def _vapid():
    global _key_cache
    if _key_cache is not None:
        return _key_cache
    d = store.load(KEYS, {})
    priv = None
    if d.get("priv"):
        try:
            priv = serialization.load_pem_private_key(users.unseal(d["priv"]).encode(), None)
        except Exception as e:
            log.warning("Push key unreadable (%s): making a new one; browsers subscribe again", e)
    if priv is None:
        priv = ec.generate_private_key(ec.SECP256R1())
        pem = priv.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
        store.save(KEYS, {"priv": users.seal(pem), "pub": b64u(_pub_bytes(priv)), "made": int(time.time())})
    _key_cache = priv
    return priv


def public_key() -> str:
    """The key browsers subscribe with (applicationServerKey)."""
    return b64u(_pub_bytes(_vapid()))


def _jwt(aud: str, sub: str) -> str:
    head = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    body = b64u(json.dumps({"aud": aud, "exp": int(time.time()) + 12 * 3600, "sub": sub}, separators=(",", ":")).encode())
    der = _vapid().sign(f"{head}.{body}".encode(), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    return f"{head}.{body}.{b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"


# ---------------------------------------------------------------- RFC 8291 encryption
def _hmac(key: bytes, data: bytes) -> bytes:
    return hmac.new(key, data, hashlib.sha256).digest()


def encrypt(payload: bytes, p256dh: str, auth: str, _as_key=None, _salt: bytes | None = None) -> bytes:
    """The body of a push message: salt | record size | key id length | the server's one-time public key | ciphertext.
    (_as_key / _salt: only the tests pass them, to check against RFC 8291's worked example.)"""
    ua_pub = unb64u(p256dh)
    secret = unb64u(auth)
    as_key = _as_key or ec.generate_private_key(ec.SECP256R1())
    as_pub = _pub_bytes(as_key)
    peer = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub)
    shared = as_key.exchange(ec.ECDH(), peer)
    prk_key = _hmac(secret, shared)
    ikm = _hmac(prk_key, b"WebPush: info\x00" + ua_pub + as_pub + b"\x01")
    salt = _salt or os.urandom(16)
    prk = _hmac(salt, ikm)
    cek = _hmac(prk, b"Content-Encoding: aes128gcm\x00\x01")[:16]
    nonce = _hmac(prk, b"Content-Encoding: nonce\x00\x01")[:12]
    ct = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    return salt + struct.pack("!IB", 4096, len(as_pub)) + as_pub + ct


def decrypt(body: bytes, ua_key, auth: str) -> bytes:
    """The browser's side (tests and tests/fake_push.py only)."""
    salt, rs, idlen = body[:16], struct.unpack("!I", body[16:20])[0], body[20]
    as_pub = body[21:21 + idlen]
    ct = body[21 + idlen:]
    ua_pub = _pub_bytes(ua_key)
    shared = ua_key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_pub))
    prk_key = _hmac(unb64u(auth), shared)
    ikm = _hmac(prk_key, b"WebPush: info\x00" + ua_pub + as_pub + b"\x01")
    prk = _hmac(salt, ikm)
    cek = _hmac(prk, b"Content-Encoding: aes128gcm\x00\x01")[:16]
    nonce = _hmac(prk, b"Content-Encoding: nonce\x00\x01")[:12]
    pt = AESGCM(cek).decrypt(nonce, ct, None)
    return pt.rstrip(b"\x00")[:-1]


# ---------------------------------------------------------------- each user's browsers
def _file(uid: str) -> str:
    return f"u/{uid}/push.json"


def subs(uid: str) -> list:
    d = store.load(_file(uid), {"subs": []})
    return d.get("subs", []) if isinstance(d, dict) else []


def _save(uid: str, lst: list) -> None:
    store.save(_file(uid), {"subs": lst})


def public(uid: str) -> list:
    """The browsers, for the page (no keys)."""
    return [{"id": hashlib.sha1(s["endpoint"].encode()).hexdigest()[:10], "name": s.get("name") or "", "ua": s.get("ua", ""),
             "added": s.get("added", 0), "ok": s.get("ok", 0), "fails": s.get("fails", 0), "err": s.get("err", ""),
             "host": urllib.parse.urlsplit(s["endpoint"]).hostname or ""} for s in subs(uid)]


def subscribe(uid: str, sub: dict, ua: str = "", name: str = "", site: str = "") -> dict:
    ep = str((sub or {}).get("endpoint") or "")
    keys = (sub or {}).get("keys") or {}
    u = urllib.parse.urlsplit(ep)
    if u.scheme != "https" or not u.hostname or len(ep) > 1000:
        raise ValueError("not a push subscription")
    try:
        if len(unb64u(keys.get("p256dh"))) != 65 or len(unb64u(keys.get("auth"))) < 16:
            raise ValueError
    except Exception:
        raise ValueError("the browser's keys are missing")
    lst = [s for s in subs(uid) if s["endpoint"] != ep]
    if len(lst) >= MAX_SUBS:
        lst = sorted(lst, key=lambda s: s.get("added", 0))[1:]          # the oldest one makes room
    lst.append({"endpoint": ep, "p256dh": keys["p256dh"], "auth": keys["auth"], "ua": str(ua)[:160], "name": str(name)[:40],
                "added": int(time.time()), "ok": 0, "fails": 0, "site": str(site)[:200]})
    _save(uid, lst)
    return public(uid)[-1]


def unsubscribe(uid: str, endpoint: str = "", sid: str = "") -> None:
    keep = [s for s in subs(uid) if s["endpoint"] != endpoint and hashlib.sha1(s["endpoint"].encode()).hexdigest()[:10] != sid]
    _save(uid, keep)


def _post(url: str, headers: dict, body: bytes):
    import httpx
    return httpx.post(url, headers=headers, content=body, timeout=10)


def send(uid: str, msg: dict, only: str = "") -> dict:
    """Send {title, body, tag, url, ...} to each of this user's browsers (or one: only = its id). Returns {sent, failed,
    gone}. A browser the push service says no longer exists (404 / 410) is forgotten. Call from a worker thread."""
    lst = subs(uid)
    if not lst:
        return {"sent": 0, "failed": 0, "gone": 0}
    data = json.dumps(msg, separators=(",", ":")).encode()[:3800]
    res = {"sent": 0, "failed": 0, "gone": 0}
    keep, changed = [], False
    for s in lst:
        if only and hashlib.sha1(s["endpoint"].encode()).hexdigest()[:10] != only:
            keep.append(s)
            continue
        u = urllib.parse.urlsplit(s["endpoint"])
        aud = f"{u.scheme}://{u.netloc}"
        try:
            body = encrypt(data, s["p256dh"], s["auth"])
            r = _post(s["endpoint"], {"TTL": str(TTL), "Urgency": "high", "Content-Encoding": "aes128gcm",
                                      "Content-Type": "application/octet-stream",
                                      "Authorization": f"vapid t={_jwt(aud, s.get('site') or 'mailto:alerts@localhost')}, k={public_key()}"}, body)
            code = r.status_code
        except Exception as e:
            code, r = 0, None
            s["err"] = str(e)[:200]
        changed = True
        if code in (404, 410):
            res["gone"] += 1
            log.info("Push: %s's browser at %s is gone - forgotten", uid, u.hostname)
            continue
        if 200 <= code < 300:
            s["ok"] = int(time.time())
            s["fails"] = 0
            s["err"] = ""
            res["sent"] += 1
        else:
            s["fails"] = s.get("fails", 0) + 1
            if code:
                s["err"] = f"{code} {(r.text or '')[:160]}"
            res["failed"] += 1
            log.warning("Push to %s's browser at %s failed: %s", uid, u.hostname, s.get("err"))
        keep.append(s)
    if changed:
        _save(uid, keep)
    return res
