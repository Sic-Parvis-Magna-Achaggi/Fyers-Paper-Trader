"""Candles kept for each MT5 trade's replay (v0.39.1, roadmap 8 c1b; owner, 11 Nov 2026: "yes").

MT5 keeps only so much history (its "Max bars in chart", about 100,000 bars by default: 2-3 months of 1-minute candles),
and the MT5 candles saved with the charts can be cleared (a change of the broker's clock setting). So when an MT5 trade
closes, the server asks MT5 for the candles around it and keeps them with the journal, as long as the trade is there:

- the 1-, 5- and 15-minute candles from a day before the entry to an hour after the exit (what ▶ Play builds its forming
  candles from: 1m up to 1h charts, 5m for 2h-4h, 15m for daily);
- the candles of the chart the trade was placed from (its recorded set-up; else 5 minutes), from 1,500 of them before
  the entry (the indicators' warm-up) to 30 after the exit; daily: 400 days.

About 3,000-6,000 candles a trade, ~50-100 KB on disk. MT5's own history of the account (trades closed before the app
saw them) is fetched the same way in the background, newest first, for trades closed in the last BACKFILL_DAYS. Nothing
is fetched while MT5 is off: it waits, and tries again when MT5 is back.

`mt5.history` (charts, the replay) uses these candles wherever the saved ones lack them (mt5.KEPT = rows): the replay of
an MT5 trade works with MT5 off and after MT5's own history has moved past it.

Files: u/<uid>/jcandles/index.json {key: {s, at, res: {res: [from, to, n]}, err, tries, next}} and
u/<uid>/jcandles/<key>.json.gz {res: [[t, o, h, l, c, v], ...]}."""
import asyncio
import gzip
import json
import logging
import os
import re
import threading
import time

from . import mt5, store

log = logging.getLogger("jcandles")
BEFORE_SMALL = 86400        # 1m / 5m / 15m: this long before the entry
AFTER_SMALL = 3600          # ... and this long after the exit
WARM_BARS = 1500            # the chart's timeframe: this many candles before the entry (indicators' warm-up)
AFTER_BARS = 30
WARM_MAX = 30 * 86400       # never more than this far back on intraday charts
DAILY_DAYS = 400
BACKFILL_DAYS = 120         # MT5's history: trades closed in the last N days are fetched in the background
GAP = 1.0                   # seconds between two fetches (one at a time per user)
RETRY_OFFLINE = 15          # MT5 off: look again this often (a local check, no network)
RETRY_ERR = 600             # a failed fetch: try again after this long, at most MAX_TRIES times
MAX_TRIES = 5

_lock = threading.RLock()
_IDX: dict = {}             # uid -> index
_CACHE: dict = {}           # (uid, key) -> (mtime, data)
_Q: dict = {}               # uid -> list of keys waiting
_RUN: dict = {}             # uid -> the worker task
_URT: dict = {}             # uid -> its UserRT (for the worker)
_EV: dict = {}              # uid -> an asyncio.Event: wakes a waiting worker (a trade just closed)
loop = None                 # the helper's event loop (rt.start sets it)


def _d(uid: str) -> str:
    return f"u/{uid}/jcandles/"


def _fname(key: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", key)[:120] + ".json.gz"


def index(uid: str) -> dict:
    with _lock:
        if uid not in _IDX:
            _IDX[uid] = store.load(_d(uid) + "index.json", {})
        return _IDX[uid]


def _save_index(uid: str):
    with _lock:
        store.save(_d(uid) + "index.json", _IDX.get(uid, {}))


def _path(uid: str, key: str) -> str:
    return str(store.path(_d(uid) + _fname(key)))


def load(uid: str, key: str) -> dict:
    p = _path(uid, key)
    try:
        mt = os.path.getmtime(p)
    except OSError:
        return {}
    c = _CACHE.get((uid, key))
    if c and c[0] == mt:
        return c[1]
    try:
        with gzip.open(p, "rt") as f:
            d = json.load(f)
    except Exception as e:
        log.warning("kept candles %s unreadable: %s", key, e)
        return {}
    _CACHE[(uid, key)] = (mt, d)
    return d


def _write(uid: str, key: str, d: dict):
    p = _path(uid, key)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with gzip.open(tmp, "wt") as f:
        json.dump(d, f, separators=(",", ":"))
    os.replace(tmp, p)


# ---------------------------------------------------------------- what a trade keeps
def chart_res(tf) -> str:
    """The MT5 timeframe a chart's timeframe ("5m", "2h", "45m", "1D"...) is built from (as the page's tfPlan)."""
    m = re.fullmatch(r"(\d+)\s*([mhDWM])", str(tf or "5m").strip())
    if not m:
        return "5"
    n, u = int(m.group(1)), m.group(2)
    if u in "DWM":
        return "D"
    mins = n * 60 if u == "h" else n
    native = sorted(int(k) for k in mt5.RES_MIN if k != "D")
    if mins in native:
        return str(mins)
    return str(max([b for b in native if mins % b == 0] or [1]))


def windows(t: dict, tf: str | None, now: float | None = None) -> dict:
    """{res: [from, to]} for a trade (UTC seconds)."""
    now = now or time.time()
    o = float(t.get("opened") or 0)
    c = float(t.get("closed") or o)
    out = {}
    for r in ("1", "5", "15"):
        out[r] = [o - BEFORE_SMALL, min(now, c + AFTER_SMALL)]
    cr = chart_res(tf)
    if cr == "D":
        out["D"] = [o - DAILY_DAYS * 86400, min(now, c + 5 * 86400)]
    else:
        sec = int(cr) * 60
        a, b = out.get(cr, [o, c])
        out[cr] = [min(a, o - min(WARM_BARS * sec, WARM_MAX)), min(now, max(b, c + AFTER_BARS * sec))]
    return out


def _trade_tf(uid: str, key: str) -> str | None:
    try:
        from . import jreplay
        rec = jreplay.load(uid, key)
        for ph in ("entry", "exit"):
            st = rec.get(ph) or {}
            tf = (st.get("chart") or {}).get("tf2") if isinstance(st, dict) else None
            if tf:
                return tf
    except Exception:
        pass
    return None


# ---------------------------------------------------------------- the candles a chart / the replay can use
def rows(uid: str, symbol: str, res: str, since: float) -> list:
    """Every kept candle of this symbol and timeframe from `since` on (mt5.KEPT)."""
    idx = index(uid)
    out = {}
    for key, e in list(idx.items()):
        if e.get("s") != symbol:
            continue
        w = (e.get("res") or {}).get(res)
        if not w or not w[2] or w[1] < since:
            continue
        for r in (load(uid, key).get(res) or []):
            if r[0] >= since:
                out[int(r[0])] = r
    return [out[k] for k in sorted(out)]


def status(uid: str, key: str) -> dict | None:
    """For the journal's page: what's kept for a trade (or why not yet)."""
    e = index(uid).get(key)
    if not e:
        return None
    return {"res": {r: w[2] for r, w in (e.get("res") or {}).items()}, "at": e.get("at"), "err": e.get("err"),
            "waiting": key in _Q.get(uid, [])}


# ---------------------------------------------------------------- fetching (one at a time per user, never while MT5 is off)
def want(urt, key: str, front: bool = False):
    """Queue a trade (an MT5 trade that closed, or one from MT5's history)."""
    uid = urt.uid
    _URT[uid] = urt
    q = _Q.setdefault(uid, [])
    if key in q:
        if front:
            q.remove(key)
            q.insert(0, key)
    else:
        q.insert(0, key) if front else q.append(key)
    _kick(uid)


def _kick(uid: str):
    lp = loop or getattr(_URT.get(uid), "loop", None)
    if not lp or not lp.is_running():
        return

    def go():
        t = _RUN.get(uid)
        if t is None or t.done():
            _RUN[uid] = asyncio.ensure_future(_worker(uid))
        else:
            _EV.setdefault(uid, asyncio.Event()).set()  # (asleep after a failure or with MT5 off: look again now)
    try:
        asyncio.get_running_loop()
        go()
    except RuntimeError:
        lp.call_soon_threadsafe(go)


async def _nap(uid: str, sec: float):
    ev = _EV.setdefault(uid, asyncio.Event())
    try:
        await asyncio.wait_for(ev.wait(), sec)
    except asyncio.TimeoutError:
        pass
    ev.clear()


async def _worker(uid: str):
    while _Q.get(uid):
        q = _Q[uid]
        key = q[0]
        e = index(uid).get(key) or {}
        if e.get("next") and e["next"] > time.time():
            nxt = min((index(uid).get(k) or {}).get("next") or 0 for k in q)
            await _nap(uid, max(1.0, min(RETRY_ERR, nxt - time.time())))
            q.sort(key=lambda k: (index(uid).get(k) or {}).get("next") or 0)
            continue
        try:
            done = await capture(uid, key)
        except mt5.Offline:
            await _nap(uid, RETRY_OFFLINE)              # MT5 off: wait for it (the trade stays first)
            continue
        except Exception as ex:
            log.warning("[%s] kept candles %s: %s", uid, key, ex)
            done = True
        if done and q and q[0] == key:
            q.pop(0)
        await asyncio.sleep(GAP)


async def capture(uid: str, key: str) -> bool:
    """Fetch and keep one trade's candles. True when finished (kept, or given up)."""
    from . import journal
    urt = _URT.get(uid)
    j = journal.get(uid)
    with j.lock:
        t = dict(j.d["trades"].get(key) or {})
    if not t or not str(t.get("s", "")).startswith(mt5.PREFIX) or t.get("status") != "closed" or not urt:
        return True
    idx = index(uid)
    e = idx.setdefault(key, {"s": t["s"], "res": {}, "tries": 0})
    tf = _trade_tf(uid, key)
    wins = windows(t, tf)
    data = dict(load(uid, key))
    got = {}
    try:
        for r, (a, b) in wins.items():
            old = (e.get("res") or {}).get(r)
            if old and old[0] <= a + 1 and old[1] >= b - 1 and old[2]:
                continue                                  # (already kept)
            rr = await mt5.fetch_range(uid, urt.dir, t["s"], r, a, b)
            data[r] = rr
            got[r] = [a, b, len(rr)]
    except mt5.Offline:
        if got:
            _store(uid, key, e, data, got)
        raise
    except Exception as ex:
        e["tries"] = int(e.get("tries") or 0) + 1
        e["err"] = str(ex)[:200]
        e["next"] = time.time() + RETRY_ERR if e["tries"] < MAX_TRIES else None
        if got:
            _store(uid, key, e, data, got)
        else:
            _save_index(uid)
        return e["tries"] >= MAX_TRIES
    _store(uid, key, e, data, got)
    return True


def _store(uid: str, key: str, e: dict, data: dict, got: dict):
    with _lock:
        if got:
            _write(uid, key, data)
            e.setdefault("res", {}).update(got)
        e["at"] = time.time()
        e.pop("next", None)
        if all((e.get("res") or {}).get(r, [0, 0, 0])[2] for r in ("1",)):
            e.pop("err", None)
        elif not (e.get("res") or {}).get("1", [0, 0, 0])[2]:
            e["err"] = "MT5 had no 1-minute candles that far back (its Max bars in chart)"
        index(uid)[key] = e
        _save_index(uid)
    log.info("[%s] kept candles for %s: %s", uid, key, {r: w[2] for r, w in got.items()})


def backfill(urt, trades: list):
    """MT5 trades (closed, in the journal) with nothing kept yet: queued newest first (MT5's 1-minute history reaches
    back only so far)."""
    idx = index(urt.uid)
    cut = time.time() - BACKFILL_DAYS * 86400
    todo = sorted([t for t in trades if t.get("status") == "closed" and str(t.get("s", "")).startswith(mt5.PREFIX)
                   and (t.get("closed") or 0) >= cut and t["id"] not in idx and t["id"] not in _Q.get(urt.uid, [])],
                  key=lambda t: -(t.get("closed") or 0))
    for t in todo:
        want(urt, t["id"])


def files(uid: str) -> list:
    """(key, path) of every kept file (the journal's backup)."""
    return [(k, _path(uid, k)) for k in index(uid) if os.path.exists(_path(uid, k))]


def restore_file(uid: str, key: str, raw: bytes, entry: dict | None) -> bool:
    """From a journal backup: a trade's kept candles, if not here yet."""
    if key in index(uid) and os.path.exists(_path(uid, key)):
        return False
    p = _path(uid, key)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as f:
        f.write(raw)
    with _lock:
        index(uid)[key] = entry or {"res": {}}
        _save_index(uid)
    return True


mt5.KEPT = rows
