"""MT5 bridge (roadmap 8, stage a): prices and charts from the owner's own MT5 terminal (FundingPips) in this app.

How it connects (as described to FundingPips on 8 Nov 2026): an EA of the owner's own (mt5/FTM_Bridge.mq5) runs in MT5 on
his laptop and only ever calls OUT to this server with WebRequest. Nothing calls in to the laptop, and this server never
logs in to the broker.
  - POST /api/mt5/sync     about 4 times a second: the account, the broker's clock and the new ticks of the symbols this
                           server asked for. The answer is a few text lines (easy to read in MQL5): what to stream, which
                           candles to send, whether to send the symbol list.
  - POST /api/mt5/bars     candles asked for with a HIST line (in parts for long ranges).
  - POST /api/mt5/symbols  the broker's symbol list with each symbol's settings (after a LIST line).
The EA proves who it is with a bridge key (X-FTM-Key), made in Settings › MT5 bridge (2FA) and pasted into the EA's inputs.
Only a hash of the key is kept.

Stage (a) is prices and charts. Stage (b), slice b1 (EA 1.10): each MT5 login is an account of its own (helper/mt5acct.py):
the sync call also carries its positions, pending orders, deals and the results of the app's commands, and the answer
carries the commands (MOD / CLOSE / CANCEL / OMOD, each with a tag) and where MT5's deal history should start (DEALS).
rt.py wires REPORT / WATCH / TICK below to the user's MT5 accounts. Paper accounts still refuse MT5 symbols.

Symbols are "MT5:<the broker's name>" (MT5:XAUUSD). Prices: ltp = the bid (MT5 draws its candles from the bid), bid / ask
as MT5 has them. Candles come from MT5 itself (CopyRates), saved in the user's candles.db like Fyers' candles. Times here
are UTC seconds as in the rest of the app; MT5 works in the broker's server time, converted by Clock."""
from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import logging
import re
import secrets
import time
from collections import deque

from . import candles, store

log = logging.getLogger("mt5")

PREFIX = "MT5:"
ONLINE_SEC = 8            # a bridge heard from within this many seconds is connected
FRESH_SEC = 15            # ask MT5 for new candles at most this often per chart
HIST_TIMEOUT = 45         # seconds to wait for MT5's candles
POLL_MS = 250             # how often the EA calls (told in every answer)
LIST_EVERY = 12 * 3600    # the symbol list is asked for again after this long
MAX_TICKS = 3000          # per call
MAX_BARS = 200_000        # per request
RES_MIN = {"1": 1, "2": 2, "3": 3, "5": 5, "10": 10, "15": 15, "20": 20, "30": 30, "60": 60, "120": 120, "180": 180,
           "240": 240, "D": "D"}          # MT5's own timeframes; "45" is built here from M15
NAME_RE = re.compile(r"^[A-Za-z0-9._#&+\-!$%@^~]{1,40}$")
EA_LATEST = "1.23"


def _vt(v) -> tuple:
    try:
        return tuple(int(x) for x in str(v or "0").split(".")[:2])
    except ValueError:
        return (0,)
STORE_V = "1"             # how MT5 candles are stored (times, daily stamps): a change drops them once, they load again
_checked: set = set()     # candle folders whose MT5 candles have been checked against STORE_V

_index: dict | None = None    # sha256(key) -> uid
_fails: dict = {}             # ip -> [count, first]
_U: dict = {}                 # uid -> UserMT5
_ALL: dict = {}               # "MT5:NAME" -> row, the latest seen for any user (symbols.get falls back to it)
_hid = [0]

# Set by rt.py (the MT5 accounts, roadmap 8 b1). None in tests of the bridge alone.
REPORT = None   # (uid, bridge, body) -> list of answer lines (DEALS, commands) for this login's account
WATCH = None    # (uid, login) -> MT5 symbol names this login's account needs prices for (its positions and orders)
TICK = None     # (uid, login, tick) -> a tick from a terminal that isn't the price source, for its own account


class Offline(Exception):
    """No MT5 bridge is connected for this user."""


KEPT = None                # callable(uid, symbol, res, since) -> candles kept for journal trades' replays (helper/jcandles.py)


def _kept(uid, symbol, res, since) -> list:
    try:
        return KEPT(uid, symbol, res, since) if KEPT else []
    except Exception as e:
        log.warning("kept candles %s %s: %s", symbol, res, e)
        return []


# ---------------------------------------------------------------- the bridge key
def _sha(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def _cfg_name(uid: str) -> str:
    return f"u/{uid}/mt5.json"


def cfg(uid: str) -> dict:
    return store.load(_cfg_name(uid), {})


def _save_cfg(uid: str, c: dict):
    store.save(_cfg_name(uid), c)


def _build_index():
    global _index
    _index = {}
    root = store.path("u/x").parent
    if root.exists():
        for d in root.iterdir():
            k = store.load(f"u/{d.name}/mt5.json", {}).get("key")
            if k:
                _index[k] = d.name


def new_key(uid: str) -> str:
    """A new bridge key for this user (the old one stops working). Shown once; only its hash is kept."""
    key = "ftm-" + secrets.token_urlsafe(24)
    c = cfg(uid)
    c["key"], c["key_made"] = _sha(key), int(time.time())
    _save_cfg(uid, c)
    _build_index()
    return key


def revoke(uid: str):
    c = cfg(uid)
    c.pop("key", None)
    c["key_made"] = None
    _save_cfg(uid, c)
    _build_index()


def uid_for(key: str, ip: str = "") -> str | None:
    """The user a bridge key belongs to. Too many wrong keys from one address: refused for 10 minutes."""
    now = time.time()
    f = _fails.get(ip)
    if f and now - f[1] > 600:
        _fails.pop(ip, None)
        f = None
    if f and f[0] >= 30:
        return None
    if _index is None:
        _build_index()
    uid = _index.get(_sha(key)) if isinstance(key, str) and 20 <= len(key) <= 100 else None
    if not uid:
        g = _fails.setdefault(ip, [0, now])
        g[0] += 1
    return uid


def blocked(ip: str) -> bool:
    f = _fails.get(ip)
    return bool(f and f[0] >= 30 and time.time() - f[1] <= 600)


# ---------------------------------------------------------------- the broker's clock
def _nth_sunday(y: int, m: int, n: int) -> dt.date:
    d = dt.date(y, m, 1)
    d += dt.timedelta(days=(6 - d.weekday()) % 7)
    return d + dt.timedelta(weeks=n - 1)


def us_dst(utc: float) -> bool:
    """US daylight saving (2nd Sunday of March 07:00 UTC to 1st Sunday of November 06:00 UTC). Most MT5 brokers move
    their server clock with it (GMT+2 in winter, GMT+3 in summer), so New York's 17:00 close is always their midnight."""
    y = dt.datetime.fromtimestamp(utc, dt.timezone.utc).year
    a = dt.datetime.combine(_nth_sunday(y, 3, 2), dt.time(7), dt.timezone.utc).timestamp()
    b = dt.datetime.combine(_nth_sunday(y, 11, 1), dt.time(6), dt.timezone.utc).timestamp()
    return a <= utc < b


class Clock:
    """offset: the broker's server time minus UTC now, in seconds (from the EA, to the half hour).
    mode "us": the broker changes its clock with US daylight saving (most do); "fixed": it never changes.
    Ticks use the offset as it is now (exact). Candles from before a clock change use the rule."""
    def __init__(self, offset: int = 7200, mode: str = "us"):
        self.offset, self.mode = int(offset), mode if mode in ("us", "fixed") else "us"

    def winter(self) -> int:
        return self.offset - (3600 if self.mode == "us" and us_dst(time.time()) else 0)

    def to_utc(self, srv: float) -> int:
        if self.mode == "fixed":
            return int(srv - self.offset)
        w = self.winter()
        guess = srv - w - 3600
        return int(guess if us_dst(guess) else srv - w)

    def to_srv(self, utc: float) -> int:
        if self.mode == "fixed":
            return int(utc + self.offset)
        return int(utc + self.winter() + (3600 if us_dst(utc) else 0))

    def day_ist(self) -> int:
        """The broker's midnight, in minutes after IST midnight (GMT+2: 03:30 IST = 210)."""
        return int(((-self.offset + 19800) % 86400) // 60)


# ---------------------------------------------------------------- per user
class Bridge:
    def __init__(self, login: int):
        self.login = login
        self.info: dict = {}
        self.seen = 0.0
        self.first = time.time()
        self.ip = ""
        self.ea = ""
        self.offset = 7200
        self.q: deque = deque()
        self.hist: dict = {}
        self.ticks = 0
        self.list_asked = 0.0
        self.last_msc: dict = {}

    def online(self) -> bool:
        return time.time() - self.seen < ONLINE_SEC


class UserMT5:
    def __init__(self, uid: str):
        self.uid = uid
        self.bridges: dict = {}
        self.specs: dict = store.load(f"u/{uid}/mt5_symbols.json", {}).get("symbols", {})
        self.locks: dict = {}
        self.saved_at = 0.0
        self.list_at = float(store.load(f"u/{uid}/mt5_symbols.json", {}).get("at") or 0)
        self.feed = None
        for n in self.specs:
            _ALL[PREFIX + n] = None

    def price_bridge(self) -> Bridge | None:
        """The bridge prices and candles come from: the one chosen in Settings while it's connected, else the one heard
        from most recently."""
        on = [b for b in self.bridges.values() if b.online()]
        if not on:
            return None
        want = cfg(self.uid).get("price_login") or 0
        for b in on:
            if b.login == want:
                return b
        return max(on, key=lambda b: b.seen)

    def clock(self, b: Bridge | None = None) -> Clock:
        c = cfg(self.uid)
        b = b or self.price_bridge()
        off = b.offset if b else int(c.get("offset") or 7200)
        return Clock(off, c.get("clock") or "us")


def user(uid: str) -> UserMT5:
    u = _U.get(uid)
    if u is None:
        u = _U[uid] = UserMT5(uid)
    return u


# ---------------------------------------------------------------- symbols
def _f(v, d=0.0):
    try:
        x = float(v)
        return x if x == x and abs(x) < 1e15 else d
    except (TypeError, ValueError):
        return d


def _clean_spec(s: dict) -> dict | None:
    n = str(s.get("name") or "")
    if not NAME_RE.match(n):
        return None
    out = {"name": n, "desc": str(s.get("desc") or "")[:120], "path": str(s.get("path") or "")[:120]}
    for k in ("digits", "trade_mode", "calc_mode", "swap_mode", "stops_level", "freeze_level", "spread"):
        out[k] = int(_f(s.get(k)))
    for k in ("point", "tick_size", "tick_value", "contract", "vmin", "vstep", "vmax", "swap_long", "swap_short"):
        out[k] = _f(s.get(k))
    for k in ("cprofit", "cmargin", "cbase"):
        out[k] = str(s.get(k) or "")[:8]
    out["visible"] = bool(s.get("visible"))
    ts = s.get("ts")                                  # EA 1.23: trading sessions, Sunday..Saturday, [[from, to] s from midnight]
    if isinstance(ts, list) and len(ts) == 7:
        clean = []
        for day in ts:
            d = []
            for x in (day if isinstance(day, list) else [])[:10]:
                if isinstance(x, list) and len(x) == 2:
                    a, b = int(_f(x[0])), int(_f(x[1]))
                    if 0 <= a < b <= 86400:
                        d.append([a, b])
            clean.append(d)
        out["ts"] = clean
    return out


def row_from(spec: dict, clock: Clock | None = None) -> dict:
    """A symbol in the shape of Fyers' master rows (symbols.py), so the chart, the watchlist and Find treat it alike.
    lot 1 and the contract size as the multiplier; the session is the broker's whole day (00:00 server time)."""
    m = (clock or Clock()).day_ist()
    hhmm = f"{m // 60:02d}{m % 60:02d}"
    tick = spec.get("tick_size") or spec.get("point") or 0.01
    return {"s": PREFIX + spec["name"], "d": spec.get("desc") or spec["name"], "u": spec["name"], "lot": 1,
            "mult": spec.get("contract") or 1, "tick": tick, "exp": 0, "k": None, "o": "", "f": "CFD", "frz": "",
            "on": spec.get("trade_mode", 4) != 0, "sess": f"{hhmm}-{hhmm}", "x": "MT5", "g": "MT5", "it": None,
            "mt5": {k: spec.get(k) for k in ("digits", "point", "tick_value", "contract", "vmin", "vstep", "vmax", "cprofit",
                                             "cmargin", "cbase", "calc_mode", "swap_long", "swap_short", "path", "spread", "ts")}}


def row(uid: str | None, ticker: str) -> dict | None:
    if not isinstance(ticker, str) or not ticker.startswith(PREFIX):
        return None
    name = ticker[len(PREFIX):]
    if uid:
        u = user(uid)
        sp = u.specs.get(name)
        return row_from(sp, u.clock()) if sp else None
    r = _ALL.get(ticker)
    if r is None:
        for u in _U.values():
            if name in u.specs:
                r = _ALL[ticker] = row_from(u.specs[name], u.clock())
                break
    return r


def search(uid: str, q: str, limit: int = 40) -> list:
    """All words must match the name, description or MT5's folder. Exact names first, then symbols in Market Watch."""
    words = [w for w in q.upper().replace(":", " ").split() if w]
    if not words:
        return []
    u = user(uid)
    if words[0] == "MT5":
        words = words[1:]
    hits = []
    for n, s in u.specs.items():
        hay = (n + " " + s.get("desc", "") + " " + s.get("path", "")).upper()
        if all(w in hay for w in words):
            hits.append(s)
    q0 = " ".join(words)
    hits.sort(key=lambda s: (0 if s["name"].upper() == q0 else 1 if s["name"].upper().startswith(q0) else 2,
                             0 if s.get("visible") else 1, s["name"]))
    c = u.clock()
    return [row_from(s, c) for s in hits[:limit]]


def take_symbols(uid: str, body: dict) -> dict:
    """POST /api/mt5/symbols from the EA: the broker's symbol list, in parts. The last part replaces the saved list."""
    u = user(uid)
    part, parts = int(_f(body.get("part"))), max(1, int(_f(body.get("parts"), 1)))
    got = [x for x in (_clean_spec(s) for s in (body.get("symbols") or [])[:5000] if isinstance(s, dict)) if x]
    if part == 0:
        u._incoming = {}
    inc = getattr(u, "_incoming", None)
    if inc is None:
        inc = u._incoming = {}
    for s in got:
        inc[s["name"]] = s
    if part >= parts - 1:
        if inc:
            u.specs, u.list_at = inc, time.time()
            for n in inc:
                _ALL[PREFIX + n] = None              # rebuilt on the next look-up
            store.save(f"u/{uid}/mt5_symbols.json", {"at": int(time.time()), "symbols": inc})
            log.info("[%s] MT5 symbol list: %d symbols", uid, len(inc))
        u._incoming = None
    return {"ok": True, "n": len(got)}


# ---------------------------------------------------------------- the EA's call
def _account(a: dict) -> dict:
    out = {"login": int(_f(a.get("login"))), "server": str(a.get("server") or "")[:64],
           "company": str(a.get("company") or "")[:64], "name": str(a.get("name") or "")[:64],
           "currency": str(a.get("currency") or "")[:8], "mode": str(a.get("mode") or "")[:12],
           "trade_allowed": bool(a.get("trade_allowed")), "ea_allowed": bool(a.get("ea_allowed")),
           "demo": bool(a.get("demo")), "leverage": int(_f(a.get("leverage")))}
    for k in ("balance", "equity", "margin", "free"):
        out[k] = round(_f(a.get(k)), 2)
    return out


def sync(uid: str, body: dict, ip: str, feed) -> str:
    """One call from the EA: remember the account and its clock, pass the ticks on, answer with the commands."""
    u = user(uid)
    u.feed = feed
    a = _account(body.get("acct") or {})
    if a["login"] <= 0:
        return "ERR no account (log in to your MT5 account)\n"
    b = u.bridges.get(a["login"])
    if b is None:
        b = u.bridges[a["login"]] = Bridge(a["login"])
        log.info("[%s] MT5 bridge connected: %s on %s (%s), from %s", uid, a["login"], a["server"], a["company"], ip)
    was_on = b.online()
    b.info, b.seen, b.ip, b.ea = a, time.time(), ip, str(body.get("ea") or "")[:12]
    srv, gmt = _f(body.get("srv")), _f(body.get("gmt"))
    if srv and gmt:
        b.offset = int(round((srv - gmt) / 1800.0)) * 1800
    c = cfg(uid)
    if time.time() - u.saved_at > 60 or not was_on:          # what the Settings card shows after a restart
        u.saved_at = time.time()
        br = c.setdefault("bridges", {})
        br[str(a["login"])] = {**a, "seen": int(b.seen), "ip": ip, "ea": b.ea, "offset": b.offset}
        c["offset"] = b.offset
        _save_cfg(uid, c)
    pb = u.price_bridge()
    lines = [f"OK {POLL_MS}"]
    rep = []
    if REPORT:
        try:
            rep = REPORT(uid, b, body) or []
        except Exception as e:                                # (the prices must keep flowing whatever happens)
            log.exception("[%s] MT5 account %s: %s", uid, a["login"], e)
    own = []
    if WATCH:
        try:
            own = [n for n in (WATCH(uid, a["login"]) or []) if NAME_RE.match(n)]
        except Exception as e:
            log.exception("[%s] MT5 account %s symbols: %s", uid, a["login"], e)
    clock = u.clock(b)
    prev = dict(b.last_msc)                                   # (several ticks in one call can share a millisecond)
    for t in (body.get("ticks") or [])[:MAX_TICKS]:
        try:
            name, msc, bid, ask = str(t[0]), _f(t[1]), _f(t[2]), _f(t[3])
        except (IndexError, TypeError):
            continue
        if not NAME_RE.match(name) or bid <= 0 or ask <= 0 or msc <= 0:
            continue
        if msc <= prev.get(name, 0):                          # sent again: the EA's last call failed
            continue
        if msc > b.last_msc.get(name, 0):
            b.last_msc[name] = msc
        last = _f(t[4]) if len(t) > 4 else 0
        vol = _f(t[5]) if len(t) > 5 else None
        tick = {"s": PREFIX + name, "ltp": bid, "bid": bid, "ask": ask, "t": round(msc / 1000.0 - clock.offset, 3),
                "vol": vol, "src": "mt5", "lg": a["login"]}
        if last:
            tick["last"] = last
        b.ticks += 1
        if pb is b:
            if feed:
                feed.publish(tick)                            # charts, watchlists, and every account (each keeps its own login's)
        elif TICK:
            TICK(uid, a["login"], tick)                       # another terminal: only its own account's trades
    if pb is b:
        names = {s[len(PREFIX):] for s in (feed.wanted() if feed else []) if s.startswith(PREFIX)} | set(own)
        lines.append("SUB " + ",".join(sorted(n for n in names if NAME_RE.match(n))))
        stale = not u.specs or time.time() - u.list_at > LIST_EVERY or (
            _vt(b.ea) >= (1, 23) and not any("ts" in x for x in u.specs.values()))   # (a new 1.23: its sessions now)
        if stale and time.time() - b.list_asked > 120:
            b.list_asked = time.time()
            lines.append("LIST")
        while b.q:
            lines.append(b.q.popleft())
    else:
        lines.append("SUB " + ",".join(sorted(own)) if own else "SUB")   # another terminal gives the chart prices
        while b.q:                                            # (a history request for a bridge that stopped being it)
            x = b.q.popleft()
            hid = x.split()[1] if x.startswith("HIST ") else None
            h = b.hist.pop(hid, None) if hid else None
            if h and not h["fut"].done():
                h["fut"].set_exception(Offline("the price source changed; try again"))
    lines += rep
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- candles
def _tf(res: str) -> str:
    return str(RES_MIN[res])


def take_bars(uid: str, body: dict) -> dict:
    """POST /api/mt5/bars from the EA: candles for a HIST request, [[server time, o, h, l, c, tick volume], ...]."""
    u = user(uid)
    hid = str(body.get("id") or "")
    for b in u.bridges.values():
        h = b.hist.get(hid)
        if h is None:
            continue
        clock = u.clock(b)
        for r in (body.get("bars") or [])[:MAX_BARS]:
            try:
                t, o, hi, lo, c = _f(r[0]), _f(r[1]), _f(r[2]), _f(r[3]), _f(r[4])
                v = _f(r[5]) if len(r) > 5 else 0
            except (IndexError, TypeError):
                continue
            if t > 0 and lo > 0 and hi >= lo:
                # a daily candle: stamped 00:00 IST of the broker's date (the page's day candles), whatever its clock did
                ut = int(t // 86400 * 86400 - 19800) if h["res"] == "D" else clock.to_utc(t)
                h["rows"].append([ut, o, hi, lo, c, v])
            if len(h["rows"]) > MAX_BARS:
                break
        err = str(body.get("err") or "")[:200]
        if body.get("done") or err:
            b.hist.pop(hid, None)
            if not h["fut"].done():
                if err and not h["rows"]:
                    h["fut"].set_exception(RuntimeError("MT5: " + err))
                else:
                    h["fut"].set_result(h["rows"])
        return {"ok": True}
    return {"ok": False, "error": "no such request (it may have timed out)"}


async def _fetch(u: UserMT5, b: Bridge, name: str, res: str, frm: float, to: float) -> list:
    clock = u.clock(b)
    _hid[0] += 1
    hid = f"{int(time.time()) % 100000}{_hid[0]}"
    fut = asyncio.get_running_loop().create_future()
    b.hist[hid] = {"fut": fut, "rows": [], "res": res}
    b.q.append(f"HIST {hid} {name} {_tf(res)} {clock.to_srv(frm)} {clock.to_srv(to)}")
    try:
        rows = await asyncio.wait_for(fut, HIST_TIMEOUT)
    except asyncio.TimeoutError:
        raise Offline("MT5 didn't send the candles in time (is the terminal busy downloading history? try again)")
    finally:
        b.hist.pop(hid, None)
    rows.sort(key=lambda r: r[0])
    return rows


def _sec(res: str) -> int:
    return 86400 if res == "D" else int(res) * 60


async def history(uid: str, folder: str, symbol: str, res: str, days: int) -> list:
    """Candles [[t, o, h, l, c, tick volume], ...] for the last `days` days from the saved store, asking MT5 (through the
    bridge) for what isn't saved yet and, at most every FRESH_SEC, for the newest. "45" is built from M15."""
    u = user(uid)
    name = symbol[len(PREFIX):]
    if not NAME_RE.match(name):
        raise ValueError("bad symbol")
    if res == "45":
        rows = await history(uid, folder, symbol, "15", days)
        return agg45(rows, u.clock())
    if res not in RES_MIN:
        raise ValueError("bad resolution")
    key = (symbol, res)
    lock = u.locks.setdefault(key, asyncio.Lock())
    loop = asyncio.get_running_loop()
    if folder not in _checked:
        await loop.run_in_executor(None, _store_check, folder)
    async with lock:
        now = time.time()
        want = now - max(1, int(days)) * 86400

        def cover():
            with candles._lock:
                c = candles._conn(folder)
                r = c.execute("SELECT first_day, fetched FROM cover WHERE sym=? AND res=?", (symbol, res)).fetchone()
                last = c.execute("SELECT MAX(t) FROM bars WHERE sym=? AND res=?", (symbol, res)).fetchone()[0]
            return r, last
        cv, last = await loop.run_in_executor(None, cover)
        first = float(cv[0]) if cv and cv[0] and str(cv[0]).replace(".", "").isdigit() else None
        fetched = cv[1] if cv else 0
        b = u.price_bridge()
        jobs = []
        if first is None:
            jobs.append((want, now + 86400))
        else:
            if want < first - 60:
                jobs.append((want, first))
            if now - fetched > FRESH_SEC:
                jobs.append((max(first, (last or first) - 3 * _sec(res)), now + 86400))
        kept = await loop.run_in_executor(None, _kept, uid, symbol, res, want)
        if jobs and not b:
            if last or kept:
                jobs = []                                       # the saved candles (and trades' kept ones) still serve
            else:
                raise Offline("MT5 isn't connected: start MT5 on your laptop with the FTM Bridge EA on a chart "
                              "(Settings › MT5 bridge)")
        for n, (frm, to) in enumerate(jobs):
            older = first is not None and n == 0 and want < first - 60
            try:
                rows = await _fetch(u, b, name, res, frm, to)
            except Exception as e:
                if older or last or kept:                    # older days or new candles failed: the saved ones still serve
                    log.warning("[%s] MT5 candles %s %s not fetched: %s", uid, symbol, res, e)
                    continue
                raise

            def save(frm=frm, to=to, rows=rows):
                with candles._lock:
                    c = candles._conn(folder)
                    if rows:
                        c.execute("DELETE FROM bars WHERE sym=? AND res=? AND t>=? AND t<?",
                                  (symbol, res, int(rows[0][0]), int(to)))
                    c.executemany("INSERT OR REPLACE INTO bars VALUES (?,?,?,?,?,?,?,?)",
                                  [(symbol, res, int(r[0]), r[1], r[2], r[3], r[4], r[5]) for r in rows])
                    old = c.execute("SELECT first_day FROM cover WHERE sym=? AND res=?", (symbol, res)).fetchone()
                    f0 = float(old[0]) if old and old[0] and str(old[0]).replace(".", "").isdigit() else None
                    nf = min(frm, f0) if f0 is not None else frm
                    c.execute("INSERT OR REPLACE INTO cover VALUES (?,?,?,?)", (symbol, res, str(int(nf)), time.time()))
                    c.commit()
            await loop.run_in_executor(None, save)

        def read():
            with candles._lock:
                return [list(r) for r in candles._conn(folder).execute(
                    "SELECT t, o, h, l, c, v FROM bars WHERE sym=? AND res=? AND t>=? ORDER BY t",
                    (symbol, res, int(want))).fetchall()]
        rows = await loop.run_in_executor(None, read)
        if kept:                                         # (v0.39.1: candles kept for a journal trade fill any gap)
            have = {int(r[0]) for r in rows}
            extra = [list(r) for r in kept if int(r[0]) not in have and r[0] >= want]
            if extra:
                rows = sorted(rows + extra, key=lambda r: r[0])
        return rows


async def fetch_range(uid: str, folder: str, symbol: str, res: str, frm: float, to: float) -> list:
    """MT5's candles for [frm, to) (v0.39.1, for a journal trade's replay): asked from the price terminal and saved with
    the other candles (the store's cover, i.e. "everything since", isn't changed). Raises Offline with no terminal."""
    u = user(uid)
    name = symbol[len(PREFIX):]
    if not NAME_RE.match(name) or res not in RES_MIN:
        raise ValueError("bad symbol or resolution")
    b = u.price_bridge()
    if not b:
        raise Offline("MT5 isn't connected")
    loop = asyncio.get_running_loop()
    if folder not in _checked:
        await loop.run_in_executor(None, _store_check, folder)
    # (no chart lock while MT5 answers: a chart or a replay never waits behind a background fetch, e.g. MT5 just went off)
    rows = await _fetch(u, b, name, res, frm, to)
    rows = [r for r in rows if frm <= r[0] < to]

    def save():
        with candles._lock:
            c = candles._conn(folder)
            c.executemany("INSERT OR REPLACE INTO bars VALUES (?,?,?,?,?,?,?,?)",
                          [(symbol, res, int(r[0]), r[1], r[2], r[3], r[4], r[5]) for r in rows])
            c.commit()
    if rows:
        await loop.run_in_executor(None, save)
    return [list(r) for r in rows]


def _store_check(folder: str):
    with candles._lock:
        c = candles._conn(folder)
        v = c.execute("SELECT v FROM meta WHERE k='mt5_v'").fetchone()
        if not v or v[0] != STORE_V:
            c.execute("DELETE FROM bars WHERE sym LIKE 'MT5:%'")
            c.execute("DELETE FROM cover WHERE sym LIKE 'MT5:%'")
            c.execute("INSERT OR REPLACE INTO meta VALUES ('mt5_v', ?)", (STORE_V,))
            c.commit()
    _checked.add(folder)


def agg45(rows: list, clock: Clock) -> list:
    """45-minute candles from 15-minute ones, counted from the broker's midnight (as MT5 would)."""
    out = []
    for t, o, h, l, c, v in rows:
        s = clock.to_srv(t)
        day = s - s % 86400
        k = clock.to_utc(day + (s - day) // 2700 * 2700)
        if out and out[-1][0] == k:
            x = out[-1]
            x[2], x[3], x[4], x[5] = max(x[2], h), min(x[3], l), c, x[5] + v
        else:
            out.append([k, o, h, l, c, v])
    return out


# ---------------------------------------------------------------- for the page
def status(uid: str, host: str = "") -> dict:
    """Settings › MT5 bridge: the key, each terminal that has called (connected now or not), where prices come from."""
    u = user(uid)
    c = cfg(uid)
    saved = c.get("bridges") or {}
    out = []
    logins = {int(k) for k in saved} | set(u.bridges)
    pb = u.price_bridge()
    for lg in sorted(logins):
        b = u.bridges.get(lg)
        info = dict(b.info) if b and b.info else dict(saved.get(str(lg)) or {})
        seen = b.seen if b else (info.get("seen") or 0)
        out.append({**{k: v for k, v in info.items() if k != "seen"}, "login": lg, "online": bool(b and b.online()),
                    "seen": int(seen) if seen else None, "ip": b.ip if b else info.get("ip", ""),
                    "ea": b.ea if b else info.get("ea", ""), "offset": b.offset if b else info.get("offset"),
                    "prices": bool(pb and pb.login == lg)})
    clock = u.clock()
    m = clock.day_ist()
    return {"ok": True, "key_set": bool(c.get("key")), "key_made": c.get("key_made"), "url": host,
            "bridges": out, "price_login": c.get("price_login") or 0, "price_from": pb.login if pb else None,
            "clock": c.get("clock") or "us", "offset": clock.offset, "day_ist": f"{m // 60:02d}:{m % 60:02d}",
            "symbols": len(u.specs), "ea_latest": EA_LATEST}


def brief(uid: str) -> dict | None:
    """For the price pill: is a terminal giving prices?"""
    u = _U.get(uid)
    if not u or not (u.bridges or u.specs):
        return None
    pb = u.price_bridge()
    if pb:
        return {"on": True, "login": pb.login, "server": pb.info.get("server", ""), "age": round(time.time() - pb.seen, 1)}
    last = max((b.seen for b in u.bridges.values()), default=0)
    return {"on": False, "age": round(time.time() - last, 1) if last else None}


def settings(uid: str, b: dict) -> dict:
    c = cfg(uid)
    if "price_login" in b:
        c["price_login"] = int(_f(b.get("price_login")))
    if b.get("clock") in ("us", "fixed"):
        if c.get("clock", "us") != b["clock"]:
            c["clock"] = b["clock"]
            _clear_candles(uid)                         # candles were converted with the other rule
    _save_cfg(uid, c)
    for k in list(_ALL):
        _ALL[k] = None
    return status(uid)


def _clear_candles(uid: str):
    with candles._lock:
        c = candles._conn(f"u/{uid}/")
        c.execute("DELETE FROM bars WHERE sym LIKE 'MT5:%'")
        c.execute("DELETE FROM cover WHERE sym LIKE 'MT5:%'")
        c.commit()
