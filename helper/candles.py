"""Saved candles. Every candle fetched from Fyers is kept on the server (SQLite, data/candles.db), so a chart or a
Pine script only asks Fyers for what's new since the last time - usually one small request - and the history
grows past what one request can return (opening a chart further back fetches the older part once).

Fyers' own limits per request still apply (helper/fyers_link.py: chunking and the request budget)."""
import datetime as dt
import logging
import sqlite3
import threading
import time

from . import fyers_link, store   # noqa: F401 (MAX_TOTAL)

log = logging.getLogger("candles")
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
_dbs: dict = {}            # one database per user (u/<user>/candles.db): each user's candles come from their own login
_lock = threading.Lock()
FRESH_SEC = 45            # ask Fyers for new candles at most this often per chart
RECHECK_DAYS = 7          # each fetch of new candles also takes the week before again (still one request), so a day
                          # Fyers corrects later reaches the saved candles too. (v0.20.7 thought Fyers had rewritten
                          # GOLDPETAL NOV's 30 Oct; it was the continuous series, see FETCH_V "3". Kept as a safeguard.)


def _conn(folder: str = ""):
    _db = _dbs.get(folder)
    if _db is None:
        _db = _dbs[folder] = sqlite3.connect(str(store.path(folder + "candles.db")), check_same_thread=False)
        _db.execute("PRAGMA journal_mode=WAL")
        _db.execute("PRAGMA synchronous=NORMAL")
        _db.execute("CREATE TABLE IF NOT EXISTS bars (sym TEXT, res TEXT, t INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL,"
                    " PRIMARY KEY (sym, res, t)) WITHOUT ROWID")
        _db.execute("CREATE TABLE IF NOT EXISTS cover (sym TEXT, res TEXT, first_day TEXT, fetched REAL, PRIMARY KEY (sym, res))")
        _db.execute("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)")
        _db.commit()
        _migrate(_db, folder)
    return _db


# Futures and options candles fetched as Fyers' continuous series may hold another contract's candles around an expiry
# (GOLDPETAL NOV's 30 Oct was the expiring OCT contract). Each FETCH_V change drops them once; they're fetched again,
# exactly, the next time a chart asks. Stocks and indices have no other contract: they stay.
# "2" (v0.20.6): requests stopped sending cont_flag=1. "3" (v0.30.1): Fyers sends the continuous series when cont_flag
# is left out too, so everything fetched up to v0.30.0 was still continuous; requests now send cont_flag=0.
FETCH_V = "3"
DERIV = ("%FUT", "%CE", "%PE")


def _migrate(db, folder):
    row = db.execute("SELECT v FROM meta WHERE k='fetch_v'").fetchone()
    if row and row[0] == FETCH_V:
        return
    n = 0
    for pat in DERIV:
        n += db.execute("DELETE FROM bars WHERE sym LIKE ?", (pat,)).rowcount
        db.execute("DELETE FROM cover WHERE sym LIKE ?", (pat,))
    db.execute("INSERT OR REPLACE INTO meta VALUES ('fetch_v', ?)", (FETCH_V,))
    db.commit()
    if n:
        log.info("Saved candles %s: %d futures / options candles dropped (fetched as Fyers' continuous series); "
                 "they load again from Fyers as charts open", folder or "(shared)", n)


def _replace(folder, symbol, res, start: dt.date, end: dt.date, rows):
    """Fyers' answer for whole days start..end replaces what was saved for those days, so a candle Fyers no longer has
    (or a corrected day) leaves nothing behind. An empty answer changes nothing."""
    if not rows:
        return
    c = _conn(folder)
    c.execute("DELETE FROM bars WHERE sym=? AND res=? AND t>=? AND t<?",
              (symbol, res, _day_start(start), _day_start(end + dt.timedelta(days=1))))
    _save(folder, symbol, res, rows)


def _save(folder, symbol, res, rows):
    if not rows:
        return
    c = _conn(folder)
    c.executemany("INSERT OR REPLACE INTO bars VALUES (?,?,?,?,?,?,?,?)",
                  [(symbol, res, int(r[0]), r[1], r[2], r[3], r[4], r[5] if len(r) > 5 else 0) for r in rows])
    c.commit()


def _day_start(d: dt.date) -> int:
    return int(dt.datetime(d.year, d.month, d.day, tzinfo=IST).timestamp())


def get(link, symbol: str, res: str, days: int, since: int = 0) -> list:
    """Candles [[t, o, h, l, c, v], ...] for the last `days` days, oldest first (only t >= since when given).
    Fetches the older part once if it isn't saved yet, and the newer part at most every FRESH_SEC seconds.
    link: the user's FyersLink (their own login and request budget; their own saved candles)."""
    F = link.dir
    today = dt.datetime.now(IST).date()
    days = max(1, int(days))
    want = today - dt.timedelta(days=days)
    cap = fyers_link.MAX_TOTAL.get(res, 198)           # most days fetched in one go, as before
    with _lock:
        row = _conn(F).execute("SELECT first_day, fetched FROM cover WHERE sym=? AND res=?", (symbol, res)).fetchone()
    first = dt.date.fromisoformat(row[0]) if row else None
    fetched = row[1] if row else 0.0
    if first is None:
        start = max(want, today - dt.timedelta(days=cap))
        rows = link.history_range(symbol, res, start, today)
        with _lock:
            _save(F, symbol, res, rows)
            _conn(F).execute("INSERT OR REPLACE INTO cover VALUES (?,?,?,?)", (symbol, res, start.isoformat(), time.time()))
            _conn(F).commit()
        first, fetched = start, time.time()
    else:
        if want < first:                                # older days asked for: fetch them once
            start = max(want, first - dt.timedelta(days=cap))
            try:
                rows = link.history_range(symbol, res, start, first)
                with _lock:
                    _replace(F, symbol, res, start, first, rows)
                    _conn(F).execute("UPDATE cover SET first_day=? WHERE sym=? AND res=?", (start.isoformat(), symbol, res))
                    _conn(F).commit()
                first = start
            except PermissionError:
                raise
            except Exception as e:
                log.warning("Older candles %s %s not fetched: %s", symbol, res, e)
        if time.time() - fetched > FRESH_SEC:            # newer: from the last saved candle's day to today
            with _lock:
                last = _conn(F).execute("SELECT MAX(t) FROM bars WHERE sym=? AND res=?", (symbol, res)).fetchone()[0]
            frm = dt.datetime.fromtimestamp(last, IST).date() if last else first
            try:
                a = max(frm - dt.timedelta(days=RECHECK_DAYS), first, today - dt.timedelta(days=cap))
                rows = link.history_range(symbol, res, a, today)
                with _lock:
                    _replace(F, symbol, res, a, today, rows)
                    _conn(F).execute("UPDATE cover SET fetched=? WHERE sym=? AND res=?", (time.time(), symbol, res))
                    _conn(F).commit()
            except Exception as e:                       # Fyers busy / logged out: the saved candles still serve
                if not last:
                    raise
                log.warning("New candles %s %s not fetched (%s) - showing the saved ones", symbol, res, e)
    lo = max(_day_start(want), int(since or 0))
    with _lock:
        out = _conn(F).execute("SELECT t, o, h, l, c, v FROM bars WHERE sym=? AND res=? AND t>=? ORDER BY t",
                              (symbol, res, lo)).fetchall()
    return [list(r) for r in out]


def saved(folder: str, symbol: str, res: str, since: int = 0) -> list:
    """The saved candles only (no Fyers request): the journal's server pictures fall back to these."""
    with _lock:
        out = _conn(folder).execute("SELECT t, o, h, l, c, v FROM bars WHERE sym=? AND res=? AND t>=? ORDER BY t",
                                    (symbol, res, int(since or 0))).fetchall()
    return [list(r) for r in out]


def stats(folder: str = "") -> dict:
    with _lock:
        n = _conn(folder).execute("SELECT COUNT(*), COUNT(DISTINCT sym || res) FROM bars").fetchone()
    p = store.path(folder + "candles.db")
    return {"candles": n[0], "series": n[1], "mb": round(p.stat().st_size / 1e6, 1) if p.exists() else 0}
