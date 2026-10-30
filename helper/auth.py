"""Page login: one password, chosen on first run (guarded by a one-time setup code), and session cookies."""
import hashlib
import hmac
import secrets
import time

from . import store

COOKIE = "fh_session"
SESSION_DAYS = 30
_fails: dict = {}          # ip -> [count, first_ts]


def _hash(password: str, salt: bytes) -> str:
    return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32).hex()


def is_set_up() -> bool:
    return bool(store.load("auth.json").get("pw_hash"))


def setup_code() -> str:
    """One-time code that proves the person setting the password can see the server's console."""
    a = store.load("auth.json")
    if not a.get("setup_code"):
        a["setup_code"] = secrets.token_hex(4).upper()
        store.save("auth.json", a)
    return a["setup_code"]


def complete_setup(code: str, password: str) -> str:
    a = store.load("auth.json")
    if a.get("pw_hash"):
        raise ValueError("already set up")
    if not code or not hmac.compare_digest(code.strip().upper(), a.get("setup_code", "")):
        raise ValueError("wrong setup code")
    if len(password) < 10:
        raise ValueError("use at least 10 characters")
    salt = secrets.token_bytes(16)
    a = {"pw_hash": _hash(password, salt), "salt": salt.hex(), "sessions": {}}
    store.save("auth.json", a)
    return new_session()


def _throttled(ip: str) -> bool:
    c = _fails.get(ip)
    if not c:
        return False
    if time.time() - c[1] > 900:
        _fails.pop(ip, None)
        return False
    return c[0] >= 8


def login(password: str, ip: str) -> str:
    if _throttled(ip):
        raise ValueError("too many attempts - wait 15 minutes")
    a = store.load("auth.json")
    if not a.get("pw_hash"):
        raise ValueError("not set up yet")
    ok = hmac.compare_digest(_hash(password, bytes.fromhex(a["salt"])), a["pw_hash"])
    if not ok:
        c = _fails.setdefault(ip, [0, time.time()])
        c[0] += 1
        raise ValueError("wrong password")
    _fails.pop(ip, None)
    return new_session()


def new_session() -> str:
    a = store.load("auth.json")
    tok = secrets.token_urlsafe(32)
    sessions = {k: v for k, v in a.get("sessions", {}).items() if v > time.time()}
    sessions[hashlib.sha256(tok.encode()).hexdigest()] = time.time() + SESSION_DAYS * 86400
    a["sessions"] = sessions
    store.save("auth.json", a)
    return tok


def check(token) -> bool:
    if not token:
        return False
    exp = store.load("auth.json").get("sessions", {}).get(hashlib.sha256(token.encode()).hexdigest())
    return bool(exp and exp > time.time())


def logout(token) -> None:
    if not token:
        return
    a = store.load("auth.json")
    a.get("sessions", {}).pop(hashlib.sha256(token.encode()).hexdigest(), None)
    store.save("auth.json", a)


def change_password(old: str, new: str) -> None:
    a = store.load("auth.json")
    if not hmac.compare_digest(_hash(old, bytes.fromhex(a["salt"])), a["pw_hash"]):
        raise ValueError("current password is wrong")
    if len(new) < 10:
        raise ValueError("use at least 10 characters")
    salt = secrets.token_bytes(16)
    a.update({"pw_hash": _hash(new, salt), "salt": salt.hex(), "sessions": {}})
    store.save("auth.json", a)
