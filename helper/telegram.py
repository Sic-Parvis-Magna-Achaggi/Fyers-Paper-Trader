"""Telegram: each user's own bot (token sealed at rest), the chat alerts go to, and sending messages.
Used by the helper (alerts.py) and by the watchdog (watchdog.py, its own process), so it needs nothing but the standard
library plus users.seal / unseal.

File: u/<user>/telegram.json = {token (sealed), bot, chat, chat_title, alerts: {...}, hc: {url, key (sealed)}, link}
Tests point TELEGRAM_API at a fake Telegram (tests/fake_telegram.py)."""
import datetime as dt
import html
import json
import logging
import os
import re
import time
import urllib.error
import urllib.request

from . import store, users

log = logging.getLogger("telegram")
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

DEFAULT_ALERTS = {
    "down": True,          # the server not answering (the watchdog)
    "down_sec": 30,        # ...for this long
    "repeat_min": 10,      # a reminder this often while it stays down (0 = once)
    "warn": True,          # a live warning (no stop at Fyers, refused change, no Fyers login, check-Fyers alerts)
    "warn_sec": 30,        # ...lasting this long
    "feed": True,          # no prices for an open live trade in its market hours
    "feed_sec": 60,
}
LIMITS = {"down_sec": (15, 600), "repeat_min": (0, 240), "warn_sec": (10, 600), "feed_sec": (20, 900)}


class TgError(Exception):
    pass


def api_base() -> str:
    return (os.environ.get("TELEGRAM_API") or "https://api.telegram.org").rstrip("/")


def _file(uid: str) -> str:
    return f"u/{uid}/telegram.json"


def load(uid: str) -> dict:
    s = store.load(_file(uid), {})
    s["alerts"] = {**DEFAULT_ALERTS, **(s.get("alerts") or {})}
    s.setdefault("hc", {})
    return s


def save(uid: str, s: dict) -> None:
    store.save(_file(uid), s)


def token(s: dict) -> str:
    try:
        return users.unseal(s.get("token") or "") or ""
    except Exception:
        return ""


def ready(s: dict) -> bool:
    return bool(s.get("token") and s.get("chat"))


def public(uid: str) -> dict:
    """What the page may see: never the token or the Healthchecks key."""
    s = load(uid)
    hc = s.get("hc") or {}
    url = hc.get("url") or ""
    return {"token_set": bool(s.get("token")), "bot": s.get("bot") or "", "chat": s.get("chat") or "",
            "chat_title": s.get("chat_title") or "", "alerts": s["alerts"], "ready": ready(s),
            "hc": {"url": _mask(url), "set": bool(url), "key_set": bool(hc.get("key"))},
            "sent": {w: store.load(_sent_file(uid, w), {}) for w in ("helper", "watchdog")}}


def _sent_file(uid: str, who: str) -> str:
    """When this process last sent, or its last error. One file per writer (helper / watchdog run as two processes,
    so neither ever rewrites the settings file the other might be saving)."""
    return f"u/{uid}/tg_{who}.json"


def _mask(url: str) -> str:
    return re.sub(r"([0-9a-f]{8})[0-9a-f-]{20,}", r"\1…", url) if url else ""


def clean_alerts(b: dict, old: dict) -> dict:
    out = dict(old)
    for k in ("down", "warn", "feed"):
        if k in b:
            out[k] = bool(b[k])
    for k, (lo, hi) in LIMITS.items():
        if k in b:
            try:
                v = int(float(b[k]))
            except (TypeError, ValueError):
                raise ValueError(f"{k}: enter a number")
            if not lo <= v <= hi:
                raise ValueError(f"{k}: between {lo} and {hi}")
            out[k] = v
    return out


# ---------------------------------------------------------------- Telegram's Bot API
def call(tok: str, method: str, params: dict | None = None, timeout: float = 10) -> dict:
    if not tok:
        raise TgError("no bot token")
    url = f"{api_base()}/bot{tok}/{method}"
    data = json.dumps(params or {}).encode()
    for attempt in range(2):
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                j = json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            try:
                j = json.loads(e.read().decode() or "{}")
            except Exception:
                raise TgError(f"Telegram HTTP {e.code}")
        except Exception as e:
            raise TgError(f"couldn't reach Telegram ({e.__class__.__name__})")
        if j.get("ok"):
            return j.get("result")
        if j.get("error_code") == 429 and attempt == 0:
            time.sleep(min(10, (j.get("parameters") or {}).get("retry_after") or 2) + 0.3)
            continue
        desc = j.get("description") or f"error {j.get('error_code')}"
        if j.get("error_code") == 401:
            desc = "Telegram doesn't know this bot token (Unauthorized): copy it again from @BotFather"
        raise TgError(desc)
    raise TgError("Telegram is busy (too many requests)")


def send(tok: str, chat: str, text: str, silent: bool = False) -> dict:
    return call(tok, "sendMessage", {"chat_id": chat, "text": text[:4000], "parse_mode": "HTML",
                                     "disable_web_page_preview": True, "disable_notification": bool(silent)})


def send_user(uid: str, text: str, silent: bool = False, who: str = "helper") -> bool:
    """Send to this user's chat; remember the time or the error (shown in Settings). True if it went."""
    s = load(uid)
    if not ready(s):
        return False
    st = store.load(_sent_file(uid, who), {})
    try:
        send(token(s), s["chat"], text, silent)
        st.update(t=time.time(), error=None, n=st.get("n", 0) + 1)
        store.save(_sent_file(uid, who), st)
        return True
    except TgError as e:
        log.warning("Telegram (%s): %s", uid, e)
        st["error"] = {"t": time.time(), "msg": str(e)}
        store.save(_sent_file(uid, who), st)
        return False


def chats_seen(tok: str) -> list:
    """The chats that have sent the bot something recently (Telegram keeps updates for 24 hours)."""
    res = call(tok, "getUpdates", {"limit": 100, "timeout": 0, "allowed_updates": ["message", "channel_post", "my_chat_member"]})
    out = {}
    for u in res or []:
        for k in ("message", "channel_post", "edited_message", "my_chat_member"):
            m = u.get(k)
            if m and m.get("chat"):
                c = m["chat"]
                title = c.get("title") or " ".join(x for x in (c.get("first_name"), c.get("last_name")) if x) or c.get("username") or str(c["id"])
                out[str(c["id"])] = {"id": str(c["id"]), "type": c.get("type", ""), "title": title,
                                     "username": c.get("username") or ""}
    return list(out.values())


CHAT_RE = re.compile(r"^(-?\d{3,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$")


# ---------------------------------------------------------------- message pieces (helper and watchdog)
def esc(s) -> str:
    return html.escape(str(s if s is not None else ""), quote=False)


def ist_hm(ts: float | None = None, sec: bool = True) -> str:
    return dt.datetime.fromtimestamp(ts or time.time(), IST).strftime("%H:%M:%S" if sec else "%H:%M")


def dur(sec: float) -> str:
    sec = int(max(0, sec))
    if sec < 60:
        return f"{sec} s"
    if sec < 3600:
        return f"{sec // 60} m {sec % 60:02d} s"
    return f"{sec // 3600} h {sec % 3600 // 60:02d} m"


def num(x) -> str:
    if x is None:
        return "–"
    x = float(x)
    return f"{x:,.2f}".rstrip("0").rstrip(".") if x != int(x) else f"{int(x):,}"


def trade_lines(accts: list) -> list:
    """One line per live position / waiting order, from the helper's heartbeat (watch.json)."""
    out = []
    for a in accts:
        for p in a.get("positions") or []:
            side = "BUY" if p.get("side", 1) > 0 else "SELL"
            lots = p.get("lots")
            line = f"• {esc(a.get('name'))} · <b>{esc(p.get('short') or p.get('s'))}</b> {side} {lots} lot{'' if lots == 1 else 's'} @ {num(p.get('avg'))}"
            if p.get("stop_at_fyers"):
                line += f" · stop at Fyers {num(p.get('stop_px'))}"
            else:
                line += " · ⚠️ <b>no stop at Fyers</b>: protect it in the Fyers app"
            if p.get("tp") is not None:
                line += f" · target {num(p['tp'])} (server)"
            out.append(line)
        n = a.get("orders_at_fyers") or 0
        if n:
            out.append(f"• {esc(a.get('name'))} · {n} entry order{'s' if n > 1 else ''} waiting at Fyers (if it fills now, the stop only goes in when the server is back)")
    return out


def market_open(sym: str, t: dt.datetime | None = None) -> bool:
    """Roughly: is this contract's market open now? (weekdays; no holiday list.) MCX 09:00-23:30 / 23:55 (US summer),
    NSE / BSE currency 09:00-17:00, the rest 09:15-15:30."""
    t = t or dt.datetime.now(IST)
    if t.weekday() >= 5:
        return False
    hm = t.strftime("%H:%M")
    ex = sym.split(":", 1)[0]
    if ex == "MCX":
        try:
            from .paper import us_dst
            end = "23:55" if us_dst(t.date()) else "23:30"
        except Exception:
            end = "23:55"
        return "09:00" <= hm < end
    if "INR" in sym.split(":", 1)[-1][:8] and sym.endswith(("FUT", "CE", "PE")):
        return "09:00" <= hm < "17:00"
    return "09:15" <= hm < "15:30"
