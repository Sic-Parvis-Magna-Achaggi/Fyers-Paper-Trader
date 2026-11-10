"""Users and security: passwords, two-factor codes (TOTP, any authenticator app), one-time recovery codes,
sessions, lockout after wrong attempts, the audit log, and encryption of stored secrets.

Login is two steps: username + password, then a 6-digit code from the user's authenticator app (or a recovery
code). A user without 2FA yet must set it up before a session is issued - nobody gets in on a password alone.
Sensitive actions (2FA changes, users, rates, live mode) also need a fresh code ("step-up", valid 5 minutes)."""
import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import struct
import threading
import time
import urllib.parse

from . import store

log = logging.getLogger("users")
FILE = "users.json"
COOKIE = "fh_session"
SESSION_DAYS = 7              # a session lasts at most this long...
IDLE_HOURS = 48               # ...and ends sooner if unused this long
PENDING_SEC = 600             # between password and code
STEP_UP_SEC = 300             # a fresh code allows sensitive actions for this long
LOCK_AFTER = 5                # wrong passwords or codes for one user...
LOCK_MIN = 15                 # ...lock it for this long
IP_LIMIT = 20                 # wrong attempts from one address in 15 minutes
ISSUER = "Trade Manager"
_lock = threading.RLock()
_pending: dict = {}           # token hash -> {uid, exp, stage, totp_new}
_ip_fails: dict = {}          # ip -> [count, first]


# ---------------------------------------------------------------- encryption of secrets at rest (AES-256-GCM)
def _key() -> bytes:
    p = store.path("secret.key")
    if not p.exists():
        p.write_bytes(os.urandom(32))
        os.chmod(p, 0o600)
    return p.read_bytes()


def seal(text: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if text is None or str(text).startswith("enc1:"):
        return text
    n = os.urandom(12)
    return "enc1:" + base64.b64encode(n + AESGCM(_key()).encrypt(n, str(text).encode(), None)).decode()


def unseal(text: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if not isinstance(text, str) or not text.startswith("enc1:"):
        return text                                   # an old plain value (sealed on the next save)
    raw = base64.b64decode(text[5:])
    return AESGCM(_key()).decrypt(raw[:12], raw[12:], None).decode()


# ---------------------------------------------------------------- storage
def _load() -> dict:
    d = store.load(FILE, {})
    d.setdefault("users", {})
    d.setdefault("sessions", {})
    return d


def _save(d: dict) -> None:
    store.save(FILE, d)


def _h(tok: str) -> str:
    return hashlib.sha256(tok.encode()).hexdigest()


def _pw_hash(password: str, salt: bytes) -> str:
    return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32).hex()


def _check_pw(u: dict, password: str) -> bool:
    return hmac.compare_digest(_pw_hash(password, bytes.fromhex(u["salt"])), u["pw_hash"])


def _strong(pw: str) -> None:
    if len(pw) < 10:
        raise ValueError("use at least 10 characters")
    if pw.lower() == pw or pw.upper() == pw or not any(c.isdigit() for c in pw):
        raise ValueError("mix upper and lower case letters and a number")


def _norm(username: str) -> str:
    u = (username or "").strip().lower()
    if not (3 <= len(u) <= 32) or not all(c.isalnum() or c in "._-" for c in u):
        raise ValueError("usernames are 3-32 letters, numbers, dots, dashes or underscores")
    return u


def public(u: dict, uid: str) -> dict:
    return {"uid": uid, "username": u["username"], "name": u.get("name") or u["username"], "role": u.get("role", "user"),
            "totp": bool(u.get("totp_on")), "disabled": bool(u.get("disabled")), "created": u.get("created"),
            "last_login": u.get("last_login"), "recovery_left": len(u.get("recovery") or [])}


# ---------------------------------------------------------------- audit log
def audit(uid: str, event: str, detail: str = "", ip: str = "") -> None:
    with _lock:
        with open(store.path("audit.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps({"t": time.time(), "uid": uid, "event": event, "detail": detail, "ip": ip}) + "\n")


def read_audit(uid: str | None = None, n: int = 500) -> list:
    p = store.path("audit.jsonl")
    if not p.exists():
        return []
    rows = []
    for ln in p.read_text(encoding="utf-8").splitlines()[-20000:]:
        try:
            r = json.loads(ln)
        except ValueError:
            continue
        if uid is None or r.get("uid") == uid:
            rows.append(r)
    return rows[-n:][::-1]


# ---------------------------------------------------------------- TOTP (RFC 6238: 30 s, 6 digits, SHA-1)
def _totp_at(secret_b32: str, step: int) -> str:
    key = base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8))
    h = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    return f"{(struct.unpack('>I', h[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


def _totp_ok(secret_b32: str, code: str, last_step: int = 0):
    """Returns the time step the code belongs to (one step either side allowed for clock drift), or None.
    A code already used can't be used again."""
    code = "".join(c for c in str(code or "") if c.isdigit())
    if len(code) != 6:
        return None
    now = int(time.time() // 30)
    for st in (now, now - 1, now + 1):
        if st > (last_step or 0) and hmac.compare_digest(_totp_at(secret_b32, st), code):
            return st
    return None


def _otpauth(username: str, secret: str) -> str:
    label = urllib.parse.quote(f"{ISSUER}:{username}")
    return f"otpauth://totp/{label}?secret={secret}&issuer={urllib.parse.quote(ISSUER)}&algorithm=SHA1&digits=6&period=30"


def _recovery_codes() -> list:
    return [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}-{secrets.token_hex(2)}" for _ in range(10)]


# ---------------------------------------------------------------- set-up and migration
def any_users() -> bool:
    return bool(_load()["users"])


def setup_code() -> str:
    """One-time code that proves the person creating the first (admin) user can see the server's console."""
    d = _load()
    if not d.get("setup_code"):
        d["setup_code"] = secrets.token_hex(4).upper()
        _save(d)
    return d["setup_code"]


def migrate_legacy() -> str | None:
    """Before users existed there was one page password (auth.json). Keep it: it becomes the admin user
    "admin", who sets up 2FA at the next login. Returns the new uid, or None if there was nothing to move."""
    if any_users():
        return None
    old = store.load("auth.json")
    if not old.get("pw_hash"):
        return None
    d = _load()
    uid = "u1"
    d["users"][uid] = {"username": "admin", "name": "Admin", "role": "admin", "pw_hash": old["pw_hash"], "salt": old["salt"],
                       "created": time.time(), "totp_on": False}
    _save(d)
    store.path("auth.json").rename(store.path("auth.json.migrated"))
    audit(uid, "migrated", "the old page password became user 'admin'")
    log.warning("Users: the page password now belongs to user 'admin' - log in as admin and set up 2FA")
    return uid


def create_first(code: str, username: str, password: str, ip: str) -> str:
    """First run: the setup code from the server, then the admin's username and password. Returns a pending
    token (2FA set-up comes next)."""
    with _lock:
        d = _load()
        if d["users"]:
            raise ValueError("already set up")
        if not code or not hmac.compare_digest(code.strip().upper(), d.get("setup_code", "")):
            raise ValueError("wrong setup code")
        un = _norm(username)
        _strong(password)
        salt = secrets.token_bytes(16)
        d["users"]["u1"] = {"username": un, "name": username.strip(), "role": "admin", "pw_hash": _pw_hash(password, salt),
                            "salt": salt.hex(), "created": time.time(), "totp_on": False}
        d.pop("setup_code", None)
        _save(d)
    audit("u1", "created", "first user (admin)", ip)
    return _new_pending("u1", "setup_2fa")


# ---------------------------------------------------------------- login
def _new_pending(uid: str, stage: str) -> str:
    tok = secrets.token_urlsafe(32)
    now = time.time()
    for k in [k for k, v in _pending.items() if v["exp"] < now]:
        _pending.pop(k, None)
    _pending[_h(tok)] = {"uid": uid, "exp": now + PENDING_SEC, "stage": stage}
    return tok


def pending(tok: str):
    p = _pending.get(_h(tok or ""))
    if not p or p["exp"] < time.time():
        return None
    return p


def _ip_blocked(ip: str) -> bool:
    c = _ip_fails.get(ip)
    if not c:
        return False
    if time.time() - c[1] > 900:
        _ip_fails.pop(ip, None)
        return False
    return c[0] >= IP_LIMIT


def _fail(d: dict, uid: str | None, ip: str, what: str) -> str:
    c = _ip_fails.setdefault(ip, [0, time.time()])
    c[0] += 1
    if uid:
        u = d["users"][uid]
        u["fails"] = u.get("fails", 0) + 1
        if u["fails"] >= LOCK_AFTER:
            u["locked_until"] = time.time() + LOCK_MIN * 60
            u["fails"] = 0
            audit(uid, "locked", f"{LOCK_AFTER} wrong {what}s", ip)
        _save(d)
        audit(uid, "login failed", f"wrong {what}", ip)
    return f"wrong {what}"


def _stage_for(u: dict) -> str:
    if u.get("must_change_pw"):
        return "change_pw"
    if not u.get("totp_on"):
        return "setup_2fa"
    return "totp"


def login(username: str, password: str, ip: str) -> tuple:
    """Step 1. Returns (pending token, next stage: "totp" | "setup_2fa" | "change_pw")."""
    if _ip_blocked(ip):
        raise ValueError("too many attempts from here - wait 15 minutes")
    with _lock:
        d = _load()
        try:
            un = _norm(username)
        except ValueError:
            raise ValueError(_fail(d, None, ip, "username or password"))
        uid = next((k for k, u in d["users"].items() if u["username"] == un), None)
        u = d["users"].get(uid) if uid else None
        if u and u.get("locked_until", 0) > time.time():
            raise ValueError(f"locked after too many wrong attempts - try again in {int((u['locked_until'] - time.time()) // 60) + 1} min")
        if not u:
            _pw_hash(password or "x", b"0" * 16)                         # take the same time either way
            raise ValueError(_fail(d, None, ip, "username or password"))
        if not _check_pw(u, password):
            raise ValueError(_fail(d, uid, ip, "username or password"))
        if u.get("disabled"):
            audit(uid, "login refused", "user is disabled", ip)
            raise ValueError("this user is disabled - ask the admin")
        return _new_pending(uid, _stage_for(u)), _stage_for(u)


def login_code(ptok: str, code: str, ip: str) -> str:
    """Step 2: the authenticator code (or a recovery code). Returns a session token."""
    p = pending(ptok)
    if not p or p["stage"] != "totp":
        raise ValueError("start again: the login step expired")
    if _ip_blocked(ip):
        raise ValueError("too many attempts from here - wait 15 minutes")
    with _lock:
        d = _load()
        uid = p["uid"]
        u = d["users"][uid]
        if u.get("locked_until", 0) > time.time():
            raise ValueError("locked after too many wrong attempts - try again later")
        code = (code or "").strip()
        st = _totp_ok(unseal(u["totp"]), code, u.get("totp_step", 0)) if u.get("totp") else None
        how = "authenticator code"
        rc = "".join(ch for ch in code.lower() if ch in "0123456789abcdef")
        if st is None and len(rc) == 12:                 # a recovery code, typed with or without the dashes
            hc = _h(f"{rc[:4]}-{rc[4:8]}-{rc[8:]}")
            if hc in (u.get("recovery") or []):
                u["recovery"].remove(hc)
                how = "recovery code"
                st = -1
        if st is None:
            raise ValueError(_fail(d, uid, ip, "code"))
        if st > 0:
            u["totp_step"] = st
        u["fails"] = 0
        _save(d)
    _pending.pop(_h(ptok), None)
    audit(uid, "login", f"with {how}" + (f" ({len(u.get('recovery') or [])} recovery codes left)" if how == "recovery code" else ""), ip)
    return _new_session(uid, ip)


def setup_2fa_begin(tok: str, session: bool = False) -> dict:
    """A new authenticator secret (shown as a QR code). From a pending login, or from a session (re-setup)."""
    ent = _pending.get(_h(tok or "")) if not session else None
    uid = ent["uid"] if ent and ent["exp"] > time.time() and ent["stage"] == "setup_2fa" else (check(tok)["uid"] if session and check(tok) else None)
    if not uid:
        raise ValueError("start again: the login step expired")
    sec = base64.b32encode(os.urandom(20)).decode().rstrip("=")
    with _lock:
        d = _load()
        d["users"][uid]["totp_new"] = seal(sec)
        _save(d)
    return {"secret": sec, "uri": _otpauth(d["users"][uid]["username"], sec)}


def setup_2fa_finish(tok: str, code: str, ip: str, session: bool = False) -> dict:
    """Confirm the first code from the app: 2FA is on, recovery codes are shown once. From a pending login the
    result also carries a session token."""
    ent = _pending.get(_h(tok or "")) if not session else None
    uid = ent["uid"] if ent and ent["exp"] > time.time() and ent["stage"] == "setup_2fa" else (check(tok)["uid"] if session and check(tok) else None)
    if not uid:
        raise ValueError("start again: the login step expired")
    with _lock:
        d = _load()
        u = d["users"][uid]
        if not u.get("totp_new"):
            raise ValueError("scan the QR code first")
        st = _totp_ok(unseal(u["totp_new"]), code)
        if st is None:
            raise ValueError(_fail(d, uid, ip, "code"))
        codes = _recovery_codes()
        u.update(totp=u.pop("totp_new"), totp_on=True, totp_step=st, recovery=[_h(c) for c in codes], fails=0)
        _save(d)
    audit(uid, "2fa on", "authenticator app set up", ip)
    out = {"recovery": codes}
    if not session:
        _pending.pop(_h(tok), None)
        out["session"] = _new_session(uid, ip)
    return out


def change_password_pending(ptok: str, new: str, ip: str) -> str:
    """A forced change (a temporary password from the admin). Returns the next stage's pending token."""
    p = pending(ptok)
    if not p or p["stage"] != "change_pw":
        raise ValueError("start again: the login step expired")
    _strong(new)
    with _lock:
        d = _load()
        u = d["users"][p["uid"]]
        if _check_pw(u, new):
            raise ValueError("choose a password different from the temporary one")
        salt = secrets.token_bytes(16)
        u.update(pw_hash=_pw_hash(new, salt), salt=salt.hex(), must_change_pw=False)
        _save(d)
        stage = _stage_for(u)
    _pending.pop(_h(ptok), None)
    audit(p["uid"], "password changed", "replaced the temporary password", ip)
    return _new_pending(p["uid"], stage), stage


# ---------------------------------------------------------------- sessions
def _new_session(uid: str, ip: str, ua: str = "") -> str:
    tok = secrets.token_urlsafe(32)
    now = time.time()
    with _lock:
        d = _load()
        d["sessions"] = {k: v for k, v in d["sessions"].items() if v["exp"] > now and now - v.get("last", now) < IDLE_HOURS * 3600}
        d["sessions"][_h(tok)] = {"uid": uid, "exp": now + SESSION_DAYS * 86400, "created": now, "last": now, "ip": ip, "ua": ua[:160]}
        d["users"][uid]["last_login"] = now
        _save(d)
    return tok


_touch: dict = {}


def check(tok: str):
    """The session's user (dict with uid, username, role...), or None."""
    if not tok:
        return None
    h = _h(tok)
    d = _load()
    s = d["sessions"].get(h)
    now = time.time()
    if not s or s["exp"] < now or now - s.get("last", now) > IDLE_HOURS * 3600:
        return None
    u = d["users"].get(s["uid"])
    if not u or u.get("disabled") or not u.get("totp_on"):
        return None
    if now - _touch.get(h, 0) > 300:                   # note activity at most every 5 minutes
        _touch[h] = now
        with _lock:
            d = _load()
            if h in d["sessions"]:
                d["sessions"][h]["last"] = now
                _save(d)
    out = public(u, s["uid"])
    out["step_up"] = s.get("step_up", 0) > now
    out["session"] = h[:12]
    out["side"] = s.get("side") if s.get("side") in ("live", "mt5") and u.get("role") == "admin" else "paper"
    return out


def set_side(tok: str, side: str) -> None:
    """The PAPER / LIVE / MT5 switch at the top left (v0.33.0; MT5 v0.36.0): which side this login's pages trade on. Kept per session
    (each browser / phone confirms Live for itself); the app checks the client ID and a fresh 2FA code first."""
    with _lock:
        d = _load()
        s = d["sessions"].get(_h(tok or ""))
        if not s:
            raise ValueError("log in again")
        s["side"] = side if side in ("live", "mt5") else "paper"
        _save(d)


def session_side(tok: str) -> str:
    s = _load()["sessions"].get(_h(tok or ""))
    return s["side"] if s and s.get("side") in ("live", "mt5") else "paper"


def set_ua(tok: str, ua: str):
    with _lock:
        d = _load()
        s = d["sessions"].get(_h(tok or ""))
        if s and not s.get("ua"):
            s["ua"] = (ua or "")[:160]
            _save(d)


def logout(tok: str) -> None:
    with _lock:
        d = _load()
        s = d["sessions"].pop(_h(tok or ""), None)
        _save(d)
    if s:
        audit(s["uid"], "logout", "")


def logout_all(uid: str, keep: str | None = None) -> int:
    with _lock:
        d = _load()
        keep_h = _h(keep) if keep else None
        gone = [k for k, v in d["sessions"].items() if v["uid"] == uid and k != keep_h]
        for k in gone:
            d["sessions"].pop(k)
        _save(d)
    return len(gone)


def sessions(uid: str, current: str) -> list:
    d = _load()
    ch = _h(current or "")
    now = time.time()
    return [{"id": k[:12], "current": k == ch, "created": v["created"], "last": v.get("last"), "ip": v.get("ip"), "ua": v.get("ua", "")}
            for k, v in d["sessions"].items() if v["uid"] == uid and v["exp"] > now]


def end_session(uid: str, sid: str) -> None:
    with _lock:
        d = _load()
        for k in [k for k, v in d["sessions"].items() if v["uid"] == uid and k.startswith(sid)]:
            d["sessions"].pop(k)
        _save(d)


def step_up(tok: str, code: str, ip: str) -> None:
    """A fresh authenticator code: allows sensitive actions for STEP_UP_SEC."""
    with _lock:
        d = _load()
        s = d["sessions"].get(_h(tok or ""))
        if not s:
            raise ValueError("log in again")
        u = d["users"][s["uid"]]
        st = _totp_ok(unseal(u["totp"]), code, u.get("totp_step", 0)) if u.get("totp") else None
        if st is None:
            raise ValueError(_fail(d, s["uid"], ip, "code"))
        u["totp_step"] = st
        s["step_up"] = time.time() + STEP_UP_SEC
        _save(d)
    audit(s["uid"], "confirmed with code", "", ip)


def stepped_up(tok: str) -> bool:
    s = _load()["sessions"].get(_h(tok or ""))
    return bool(s and s.get("step_up", 0) > time.time())


# ---------------------------------------------------------------- the user's own settings
def change_password(uid: str, old: str, new: str, keep_tok: str, ip: str) -> None:
    _strong(new)
    with _lock:
        d = _load()
        u = d["users"][uid]
        if not _check_pw(u, old):
            raise ValueError(_fail(d, uid, ip, "current password"))
        salt = secrets.token_bytes(16)
        u.update(pw_hash=_pw_hash(new, salt), salt=salt.hex())
        _save(d)
    n = logout_all(uid, keep=keep_tok)
    audit(uid, "password changed", f"other sessions ended: {n}", ip)


def new_recovery_codes(uid: str, ip: str) -> list:
    codes = _recovery_codes()
    with _lock:
        d = _load()
        d["users"][uid]["recovery"] = [_h(c) for c in codes]
        _save(d)
    audit(uid, "recovery codes replaced", "", ip)
    return codes


def rename(uid: str, name: str) -> None:
    with _lock:
        d = _load()
        d["users"][uid]["name"] = (name or "").strip()[:60] or d["users"][uid]["username"]
        _save(d)


def get(uid: str):
    u = _load()["users"].get(uid)
    return public(u, uid) if u else None


# ---------------------------------------------------------------- admin
def all_users() -> list:
    return [public(u, k) for k, u in _load()["users"].items()]


def create_user(username: str, temp_password: str, name: str, by: str, ip: str) -> dict:
    """A new (non-admin) user with a temporary password: changed, and 2FA set up, at their first login."""
    un = _norm(username)
    _strong(temp_password)
    with _lock:
        d = _load()
        if any(u["username"] == un for u in d["users"].values()):
            raise ValueError(f"there's already a user {un}")
        n = 1 + max([int(k[1:]) for k in d["users"] if k[1:].isdigit()] or [0])
        uid = f"u{n}"
        salt = secrets.token_bytes(16)
        d["users"][uid] = {"username": un, "name": (name or un).strip()[:60], "role": "user", "pw_hash": _pw_hash(temp_password, salt),
                           "salt": salt.hex(), "created": time.time(), "totp_on": False, "must_change_pw": True}
        _save(d)
    audit(by, "user created", un, ip)
    audit(uid, "created", f"by {by}", ip)
    return public(d["users"][uid], uid)


def admin_set(uid: str, by: str, ip: str, disabled=None, reset_2fa=False, temp_password=None) -> dict:
    with _lock:
        d = _load()
        u = d["users"].get(uid)
        if not u:
            raise ValueError("no such user")
        if u.get("role") == "admin" and (disabled or reset_2fa):
            raise ValueError("the admin can't be disabled or have 2FA reset here")
        notes = []
        if disabled is not None:
            u["disabled"] = bool(disabled)
            notes.append("disabled" if disabled else "enabled")
        if reset_2fa:
            for k in ("totp", "totp_new", "totp_step", "recovery"):
                u.pop(k, None)
            u["totp_on"] = False
            notes.append("2FA reset")
        if temp_password:
            _strong(temp_password)
            salt = secrets.token_bytes(16)
            u.update(pw_hash=_pw_hash(temp_password, salt), salt=salt.hex(), must_change_pw=True, locked_until=0, fails=0)
            notes.append("temporary password set")
        _save(d)
    if disabled or reset_2fa or temp_password:
        logout_all(uid)
    audit(by, "user changed", f"{u['username']}: {', '.join(notes)}", ip)
    audit(uid, "changed by admin", ", ".join(notes), ip)
    return public(u, uid)


# ---------------------------------------------------------------- console rescue (lost phone and recovery codes)
def rescue(username: str) -> str:
    """Run on the server's console only: a temporary password and no 2FA for this user, who sets both again at the
    next login. All their sessions end. Returns the temporary password."""
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(14))
        if any(c.islower() for c in pw) and any(c.isupper() for c in pw) and any(c.isdigit() for c in pw):
            break
    with _lock:
        d = _load()
        uid = next((k for k, u in d["users"].items() if u["username"] == username.strip().lower()), None)
        if not uid:
            raise SystemExit(f"no user called {username!r}. Users: {', '.join(u['username'] for u in d['users'].values())}")
        u = d["users"][uid]
        for k in ("totp", "totp_new", "totp_step", "recovery"):
            u.pop(k, None)
        salt = secrets.token_bytes(16)
        u.update(totp_on=False, disabled=False, pw_hash=_pw_hash(pw, salt), salt=salt.hex(), must_change_pw=True,
                 locked_until=0, fails=0)
        _save(d)
    logout_all(uid)
    audit(uid, "reset from the server console", "temporary password, 2FA to set up again")
    return pw


if __name__ == "__main__":
    import sys
    if len(sys.argv) == 3 and sys.argv[1] == "rescue":
        print(f"Temporary password for {sys.argv[2]}: {rescue(sys.argv[2])}")
        print("Log in with it now: you choose a new password and set up 2FA again. No restart needed.")
    else:
        print("usage: python -m helper.users rescue <username>")
