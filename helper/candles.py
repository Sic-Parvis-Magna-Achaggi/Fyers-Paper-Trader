"""Saved candles. Every candle fetched from Fyers is kept on the server (SQLite, data/candles.db), so a chart or a
Pine script only asks Fyers for what's new since the last time - usually one small request - and the history
grows past what one request can return (opening a chart further back fetches the older part once).

Fyers' own limits per request still apply (helper/fyers_link.py: chunking and the request budget)."""
import datetime as dt
import logging
import sqlite3
import threading
import time

from . import fyers_link, store

log = logging.getLogger("candles")
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
_db = None
_lock = threading.Lock()
FRESH_SEC = 45            # ask Fyers for new candles at most this often per chart


def _conn():
    global _db
    if _db is None:
        _db = sqlite3.connect(str(store.path("candles.db")), check_same_thread=False)
        _db.execute("PRAGMA journal_mode=WAL")
        _db.execute("PRAGMA synchronous=NORMAL")
        _db.execute("CREATE TABLE IF NOT EXISTS bars (sym TEXT, res TEXT, t INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL,"
                    " PRIMARY KEY (sym, res, t)) WITHOUT ROWID")
        _db.execute("CREATE TABLE IF NOT EXISTS cover (sym TEXT, res TEXT, first_day TEXT, fetched REAL, PRIMARY KEY (sym, res))")
        _db.commit()
    return _db


def _save(symbol, res, rows):
    if not rows:
        return
    c = _conn()
    c.executemany("INSERT OR REPLACE INTO bars VALUES (?,?,?,?,?,?,?,?)",
                  [(symbol, res, int(r[0]), r[1], r[2], r[3], r[4], r[5] if len(r) > 5 else 0) for r in rows])
    c.commit()


def _day_start(d: dt.date) -> int:
    return int(dt.datetime(d.year, d.month, d.day, tzinfo=IST).timestamp())


def get(symbol: str, res: str, days: int, since: int = 0) -> list:
    """Candles [[t, o, h, l, c, v], ...] for the last `days` days, oldest first (only t >= since when given).
    Fetches the older part once if it isn't saved yet, and the newer part at most every FRESH_SEC seconds."""
    today = dt.datetime.now(IST).date()
    days = max(1, int(days))
    want = today - dt.timedelta(days=days)
    cap = fyers_link.MAX_TOTAL.get(res, 198)           # most days fetched in one go, as before
    with _lock:
        row = _conn().execute("SELECT first_day, fetched FROM cover WHERE sym=? AND res=?", (symbol, res)).fetchone()
    first = dt.date.fromisoformat(row[0]) if row else None
    fetched = row[1] if row else 0.0
    if first is None:
        start = max(want, today - dt.timedelta(days=cap))
        rows = fyers_link.history_range(symbol, res, start, today)
        with _lock:
            _save(symbol, res, rows)
            _conn().execute("INSERT OR REPLACE INTO cover VALUES (?,?,?,?)", (symbol, res, start.isoformat(), time.time()))
            _conn().commit()
        first, fetched = start, time.time()
    else:
        if want < first:                                # older days asked for: fetch them once
            start = max(want, first - dt.timedelta(days=cap))
            try:
                rows = fyers_link.history_range(symbol, res, start, first)
                with _lock:
                    _save(symbol, res, rows)
                    _conn().execute("UPDATE cover SET first_day=? WHERE sym=? AND res=?", (start.isoformat(), symbol, res))
                    _conn().commit()
                first = start
            except PermissionError:
                raise
            except Exception as e:
                log.warning("Older candles %s %s not fetched: %s", symbol, res, e)
        if time.time() - fetched > FRESH_SEC:            # newer: from the last saved candle's day to today
            with _lock:
                last = _conn().execute("SELECT MAX(t) FROM bars WHERE sym=? AND res=?", (symbol, res)).fetchone()[0]
            frm = dt.datetime.fromtimestamp(last, IST).date() if last else first
            try:
                rows = fyers_link.history_range(symbol, res, max(frm, today - dt.timedelta(days=cap)), today)
                with _lock:
                    _save(symbol, res, rows)
                    _conn().execute("UPDATE cover SET fetched=? WHERE sym=? AND res=?", (time.time(), symbol, res))
                    _conn().commit()
            except Exception as e:                       # Fyers busy / logged out: the saved candles still serve
                if not last:
                    raise
                log.warning("New candles %s %s not fetched (%s) - showing the saved ones", symbol, res, e)
    lo = max(_day_start(want), int(since or 0))
    with _lock:
        out = _conn().execute("SELECT t, o, h, l, c, v FROM bars WHERE sym=? AND res=? AND t>=? ORDER BY t",
                              (symbol, res, lo)).fetchall()
    return [list(r) for r in out]


def stats() -> dict:
    with _lock:
        n = _conn().execute("SELECT COUNT(*), COUNT(DISTINCT sym || res) FROM bars").fetchone()
    p = store.path("candles.db")
    return {"candles": n[0], "series": n[1], "mb": round(p.stat().st_size / 1e6, 1) if p.exists() else 0}
