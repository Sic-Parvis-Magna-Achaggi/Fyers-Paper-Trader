"""Fyers API v3: app settings, the daily login (redirect), and REST data calls (history, quotes, profile)."""
import datetime as dt
import hashlib
import logging
import secrets
import threading
import time
import urllib.parse

import httpx

from . import store

log = logging.getLogger("fyers")
API = "https://api-t1.fyers.in/api/v3"
DATA = "https://api-t1.fyers.in/data"
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))


# ---------------------------------------------------------------- settings
def settings() -> dict:
    return store.load("fyers.json")


def save_settings(app_id: str, secret: str, redirect: str) -> None:
    s = settings()
    app_id = app_id.strip()
    if not app_id or "-" not in app_id:
        raise ValueError("App ID looks wrong (it looks like XXXXXXXXXX-100)")
    s["app_id"] = app_id
    if secret.strip():
        s["secret"] = secret.strip()
    if not s.get("secret"):
        raise ValueError("enter the App Secret")
    s["redirect"] = redirect
    s.pop("token", None)                      # a new app needs a new login
    store.save("fyers.json", s)
    log.info("Fyers app settings saved (App ID %s)", app_id)


def public_settings() -> dict:
    s = settings()
    return {"app_id": s.get("app_id", ""), "has_secret": bool(s.get("secret")), "redirect": s.get("redirect", "")}


# ---------------------------------------------------------------- login
def login_url(redirect: str) -> str:
    s = settings()
    if not s.get("app_id"):
        raise ValueError("enter the Fyers App ID and Secret first")
    state = secrets.token_urlsafe(16)
    s["state"] = state
    s["state_at"] = time.time()
    s["redirect"] = redirect
    store.save("fyers.json", s)
    q = urllib.parse.urlencode({"client_id": s["app_id"], "redirect_uri": redirect,
                                "response_type": "code", "state": state})
    return f"{API}/generate-authcode?{q}"


def handle_callback(code: str, state: str) -> None:
    s = settings()
    if not state or state != s.get("state") or time.time() - s.get("state_at", 0) > 900:
        raise ValueError("login link expired - press Log in to Fyers again")
    app_hash = hashlib.sha256(f"{s['app_id']}:{s['secret']}".encode()).hexdigest()
    r = httpx.post(f"{API}/validate-authcode", timeout=20,
                   json={"grant_type": "authorization_code", "appIdHash": app_hash, "code": code})
    j = r.json()
    if j.get("s") != "ok" or not j.get("access_token"):
        raise ValueError(f"Fyers refused the login: {j.get('message') or j}")
    s.pop("state", None)
    s["token"] = j["access_token"]
    s["token_at"] = time.time()
    store.save("fyers.json", s)
    log.info("Logged in to Fyers")


def token() -> str:
    s = settings()
    if not s.get("token"):
        return ""
    # Fyers tokens last until the next morning: treat one from before today's 06:00 IST as expired
    got = dt.datetime.fromtimestamp(s.get("token_at", 0), IST)
    now = dt.datetime.now(IST)
    cutoff = now.replace(hour=6, minute=0, second=0, microsecond=0)
    if now < cutoff:
        cutoff -= dt.timedelta(days=1)
    if got < cutoff:
        return ""
    return s["token"]


def drop_token(reason: str) -> None:
    s = settings()
    if s.pop("token", None):
        store.save("fyers.json", s)
        log.warning("Fyers session ended: %s", reason)


def _auth_header() -> dict:
    t = token()
    if not t:
        raise PermissionError("not logged in to Fyers today")
    return {"Authorization": f"{settings()['app_id']}:{t}", "version": "3"}


class Budget:
    """Stay well inside Fyers' Standard limits (data: 5/s, 50/min, 5,000/day).
    Going over the per-minute limit 3+ times in a day blocks the account for the day, so requests queue here
    (a short wait) rather than ever going over. Only a long queue is refused."""
    def __init__(self, per_sec=3, per_min=35, per_day=4000, max_wait=12.0):
        self.lim = (per_sec, per_min, per_day)
        self.max_wait = max_wait
        self.calls: list = []
        self.day = ""
        self.today = 0
        self.lock = threading.Lock()

    def take(self) -> None:
        """Blocking (call from a worker thread): waits for a free slot."""
        give_up = time.time() + self.max_wait
        while True:
            with self.lock:
                now = time.time()
                d = time.strftime("%Y-%m-%d")
                if d != self.day:
                    self.day, self.today = d, 0
                self.calls = [t for t in self.calls if now - t < 60]
                if self.today >= self.lim[2]:
                    raise RuntimeError("daily data budget used up - charts will refresh tomorrow")
                last_sec = [t for t in self.calls if now - t < 1]
                if len(self.calls) < self.lim[1] and len(last_sec) < self.lim[0]:
                    self.calls.append(now)
                    self.today += 1
                    return
                wait = (min(last_sec) + 1 - now) if len(last_sec) >= self.lim[0] else (min(self.calls) + 60 - now)
            if now + wait > give_up:
                raise RuntimeError("busy - too many data requests, try again in a moment")
            time.sleep(max(0.05, wait))

    def status(self) -> dict:
        now = time.time()
        return {"last_min": sum(1 for t in self.calls if now - t < 60), "today": self.today,
                "limits": {"per_sec": self.lim[0], "per_min": self.lim[1], "per_day": self.lim[2]}}


data_budget = Budget()
order_budget = Budget(per_sec=4, per_min=120, per_day=60000)   # transaction + user-info APIs (10/s, 200/min)


def _get(url: str, params: dict) -> dict:
    (data_budget if url.startswith(DATA) else order_budget).take()
    r = httpx.get(url, params=params, headers=_auth_header(), timeout=20)
    return _check(r)


def _post(url: str, body: dict) -> dict:
    order_budget.take()
    r = httpx.post(url, json=body, headers=_auth_header(), timeout=20)
    return _check(r)


def _check(r) -> dict:
    try:
        j = r.json()
    except Exception:
        raise RuntimeError(f"Fyers HTTP {r.status_code}")
    if r.status_code == 401 or j.get("code") in (-15, -16, -17, -8):
        drop_token(j.get("message", "token rejected"))
        raise PermissionError("Fyers session expired - log in again")
    if j.get("s") != "ok":
        raise RuntimeError(j.get("message") or str(j))
    return j


_profile = {"tok": "", "at": 0.0, "data": None}


def status() -> dict:
    s = settings()
    out = {"configured": bool(s.get("app_id") and s.get("secret")), "logged_in": False,
           "since": s.get("token_at") if token() else None, "name": None, "client_id": None}
    if token():
        try:
            if _profile["tok"] != token() or time.time() - _profile["at"] > 600:
                _profile.update(tok=token(), at=time.time(), data=_get(f"{API}/profile", {}).get("data", {}))
            p = _profile["data"] or {}
            out.update(logged_in=True, name=p.get("name"), client_id=p.get("fy_id"))
        except PermissionError:
            pass
        except Exception as e:
            out.update(logged_in=True, error=str(e))
    return out


# ---------------------------------------------------------------- data
RES = {"1": 60, "2": 120, "3": 180, "5": 300, "10": 600, "15": 900, "20": 1200, "30": 1800, "45": 2700,
       "60": 3600, "120": 7200, "180": 10800, "240": 14400, "D": 86400}
CHUNK = {"D": 365}                       # days per request (Fyers: 100 for intraday, 366 for daily)
MAX_TOTAL = {"1": 30, "2": 45, "3": 60, "D": 1100}   # most days we fetch in one go (others: 198 = 2 requests)


def history(symbol: str, res: str, days: int) -> list:
    """Candles [[epoch_sec, o, h, l, c, v], ...], oldest first. Long ranges are fetched in chunks."""
    if res not in RES:
        raise ValueError("bad resolution")
    days = max(1, min(int(days), MAX_TOTAL.get(res, 198)))
    end = dt.datetime.now(IST).date()
    return history_range(symbol, res, end - dt.timedelta(days=days), end)


def history_range(symbol: str, res: str, start, end) -> list:
    """Candles between two dates (inclusive, IST), in chunks Fyers accepts."""
    if res not in RES:
        raise ValueError("bad resolution")
    chunk = CHUNK.get(res, 99)
    out, a = [], start
    while a <= end:
        b = min(end, a + dt.timedelta(days=chunk))
        j = _get(f"{DATA}/history", {"symbol": symbol, "resolution": res, "date_format": "1",
                                     "range_from": a.isoformat(), "range_to": b.isoformat(), "cont_flag": "1"})
        out += j.get("candles", [])
        a = b + dt.timedelta(days=1)
    seen, uniq = set(), []
    for c in sorted(out, key=lambda c: c[0]):
        if c[0] not in seen:
            seen.add(c[0])
            uniq.append(c)
    return uniq


def margin(symbol: str, qty: int, side: int, product: str, price: float = 0.0) -> float:
    """Fyers' own margin estimate for one order (rupees)."""
    j = _post(f"{API}/multiorder/margin", {"data": [{
        "symbol": symbol, "qty": int(qty), "side": int(side), "type": 2 if not price else 1, "productType": product,
        "limitPrice": float(price or 0), "stopPrice": 0.0, "stopLoss": 0.0, "takeProfit": 0.0}]})
    d = j.get("data") or {}
    return float(d.get("margin_total") or d.get("margin_new_order") or 0)


def depth(symbol: str):
    """Order book (5 levels) by REST - only used when the socket isn't delivering depth."""
    j = _get(f"{DATA}/depth", {"symbol": symbol, "ohlcv_flag": "1"})
    d = (j.get("d") or {}).get(symbol) or {}
    if not d:
        return None
    lv = lambda rows: [[r.get("price"), r.get("volume"), r.get("ord")] for r in (rows or [])[:5]]
    return {"s": symbol, "bids": lv(d.get("bids")), "asks": lv(d.get("ask")), "t": int(time.time()), "src": "poll",
            "tbq": d.get("totalbuyqty"), "tsq": d.get("totalsellqty")}


def quotes(symbols: list) -> dict:
    """One request for up to 50 symbols -> {symbol: values}."""
    j = _get(f"{DATA}/quotes", {"symbols": ",".join(symbols[:50])})
    return {d.get("n"): d.get("v", {}) for d in j.get("d") or [] if d.get("s") == "ok"}
