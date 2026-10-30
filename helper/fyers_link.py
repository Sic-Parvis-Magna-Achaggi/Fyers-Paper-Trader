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
    """Stay well inside Fyers' Standard data limits (5/s, 50/min, 5,000/day).
    Going over the per-minute limit 3+ times in a day blocks the account for the day, so we refuse first."""
    def __init__(self, per_sec=3, per_min=35, per_day=4000):
        self.lim = (per_sec, per_min, per_day)
        self.calls: list = []
        self.day = ""
        self.today = 0
        self.lock = threading.Lock()

    def take(self) -> None:
        with self.lock:
            now = time.time()
            d = time.strftime("%Y-%m-%d")
            if d != self.day:
                self.day, self.today = d, 0
            self.calls = [t for t in self.calls if now - t < 60]
            if self.today >= self.lim[2]:
                raise RuntimeError("daily data budget used up - charts will refresh tomorrow")
            if len(self.calls) >= self.lim[1] or sum(1 for t in self.calls if now - t < 1) >= self.lim[0]:
                raise RuntimeError("busy - too many data requests, try again in a moment")
            self.calls.append(now)
            self.today += 1

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
RES = {"1": 60, "3": 180, "5": 300, "15": 900, "30": 1800, "60": 3600, "D": 86400}
MAX_DAYS = {"1": 30, "3": 60, "5": 90, "15": 90, "30": 90, "60": 90, "D": 365}


def history(symbol: str, res: str, days: int) -> list:
    """Candles [[epoch_sec, o, h, l, c, v], ...], oldest first."""
    if res not in RES:
        raise ValueError("bad resolution")
    days = max(1, min(days, MAX_DAYS[res]))
    end = dt.datetime.now(IST).date()
    start = end - dt.timedelta(days=days)
    j = _get(f"{DATA}/history", {"symbol": symbol, "resolution": res, "date_format": "1",
                                 "range_from": start.isoformat(), "range_to": end.isoformat(), "cont_flag": "1"})
    return j.get("candles", [])


def margin(symbol: str, qty: int, side: int, product: str, price: float = 0.0) -> float:
    """Fyers' own margin estimate for one order (rupees)."""
    j = _post(f"{API}/multiorder/margin", {"data": [{
        "symbol": symbol, "qty": int(qty), "side": int(side), "type": 2 if not price else 1, "productType": product,
        "limitPrice": float(price or 0), "stopPrice": 0.0, "stopLoss": 0.0, "takeProfit": 0.0}]})
    d = j.get("data") or {}
    return float(d.get("margin_total") or d.get("margin_new_order") or 0)


def quotes(symbols: list) -> dict:
    """One request for up to 50 symbols -> {symbol: values}."""
    j = _get(f"{DATA}/quotes", {"symbols": ",".join(symbols[:50])})
    return {d.get("n"): d.get("v", {}) for d in j.get("d") or [] if d.get("s") == "ok"}
