"""Fyers symbol masters (public, refreshed daily): MCX, NSE and BSE - stocks, indices, F&O, currency, commodities.

The server has 1 GB of RAM and NSE F&O alone has ~90,000 contracts, so rows are kept as tuples and turned into
dicts only when asked for. The big masters come as CSV (no multiplier column, but NSE / BSE quantities are in
shares so the multiplier is 1); MCX, NSE currency and NSE commodities come as JSON, which has the multiplier.
"""
import csv
import io
import json
import logging
import sys
import threading
import time

import httpx

from . import store

log = logging.getLogger("symbols")
BASE = "https://public.fyers.in/sym_details/"
# name, file, format, segment
SOURCES = [
    ("MCX_COM", "MCX_COM_sym_master.json", "json", "COM"),
    ("NSE_CM", "NSE_CM.csv", "csv", "CM"),
    ("BSE_CM", "BSE_CM.csv", "csv", "CM"),
    ("NSE_FO", "NSE_FO.csv", "csv", "FO"),
    ("BSE_FO", "BSE_FO.csv", "csv", "FO"),
    ("NSE_CD", "NSE_CD_sym_master.json", "json", "CD"),
    ("NSE_COM", "NSE_COM_sym_master.json", "json", "COM"),
]
SEGMENTS = {"MCX": BASE + "MCX_COM_sym_master.json"}     # (kept for anything that still reads it)

# Fyers exchange instrument types -> our kinds
KIND = {"CM": {0: "EQ", 9: "EQ", 10: "IDX"},
        "FO": {11: "FUT", 12: "FUT", 13: "FUT", 14: "OPT", 15: "OPT"},
        "CD": {16: "FUT", 17: "FUT", 18: "FUT", 25: "FUT", 19: "OPT", 20: "IDX", 21: "IDX", 22: "IDX", 23: "IDX", 24: "IDX"},
        "COM": {11: "FUT", 30: "FUT", 33: "FUT", 34: "FUT", 35: "FUT", 31: "OPT", 32: "OPT", 36: "OPT", 37: "OPT"}}
F = ("s", "d", "u", "lot", "mult", "tick", "exp", "k", "o", "f", "frz", "on", "sess", "x", "g", "it")
_parts: dict = {}          # source name -> list of tuples
_rows: list = []           # every tuple
_hay: list = []            # search text per row (upper case)
_by_ticker: dict = {}      # ticker -> index in _rows
_dcache: dict = {}         # ticker -> dict (rows the engine asks for again and again)
_loaded_day = ""
_lock = threading.Lock()
_bg = {"running": False}
_si = sys.intern


def _kind(seg: str, it, ticker: str, opt: str) -> str:
    k = KIND.get(seg, {}).get(it) if it is not None else None
    if k:
        return k
    if opt:
        return "OPT"
    if ticker.endswith("FUT"):
        return "FUT"
    if ticker.endswith("-INDEX"):
        return "IDX"
    return "EQ" if seg == "CM" else "OTHER"


def _whole(v):
    return int(v) if isinstance(v, float) and v.is_integer() else v


def _num(v, cast=float, d=0):
    try:
        return cast(v) if v not in (None, "", "None") else d
    except (TypeError, ValueError):
        return d


def _from_json(t: str, v: dict, seg: str) -> tuple:
    opt = v.get("optType") if v.get("optType") in ("CE", "PE") else ""
    it = _num(v.get("exInstType"), int, None)
    k = _kind(seg, it, t, opt)
    x = t.split(":", 1)[0]
    return (t, v.get("symbolDesc") or v.get("symDetails") or t, _si(v.get("underSym") or v.get("exSymbol") or ""),
            _whole(_num(v.get("minLotSize"), float, 1) or 1), _whole(_num(v.get("qtyMultiplier"), float, 1) or 1), _num(v.get("tickSize"), float, 0.05) or 0.05,
            _num(v.get("expiryDate"), int, 0), v.get("strikePrice") if opt else None, opt, k, v.get("qtyFreeze") or "",
            v.get("tradeStatus", 1) == 1, _si(v.get("tradingSession") or ""), _si(x), seg, it)


def _from_csv(c: list, seg: str):
    """Fyers CSV columns: fytoken, description, instrument type, lot, tick, ISIN, session, last update, expiry,
    ticker, exchange, segment, scrip code, underlying, underlying scrip, strike, option type, underlying fytoken, ..."""
    if len(c) < 17 or not c[9] or ":" not in c[9]:
        return None
    t = c[9].strip()
    opt = c[16].strip() if c[16].strip() in ("CE", "PE") else ""
    it = _num(c[2], int, None)
    k = _kind(seg, it, t, opt)
    return (t, c[1].strip() or t, _si(c[13].strip()), _whole(_num(c[3], float, 1) or 1), 1, _num(c[4], float, 0.05) or 0.05,
            _num(c[8], int, 0), _num(c[15], float, 0) if opt else None, opt, k, "", True, _si(c[6].strip()), _si(t.split(":", 1)[0]), seg, it)


def _parse(name: str, fmt: str, seg: str, text: str) -> list:
    out = []
    if fmt == "json":
        for t, v in json.loads(text).items():
            if isinstance(v, dict):
                out.append(_from_json(t, v, seg))
    else:
        for c in csv.reader(io.StringIO(text)):
            r = _from_csv(c, seg)
            if r:
                out.append(r)
    now = time.time()
    return [r for r in out if not r[6] or r[6] > now - 3 * 86400]        # drop contracts that expired days ago


def _rebuild():
    global _rows, _hay, _by_ticker
    rows = [r for name, *_ in SOURCES for r in _parts.get(name, [])]
    _rows = rows
    _hay = [(r[0] + " " + r[1] + " " + r[2]).upper() for r in rows]
    _by_ticker = {r[0]: i for i, r in enumerate(rows)}
    _dcache.clear()


def _dict(r: tuple) -> dict:
    return dict(zip(F, r))


def _load_from(text: str) -> None:
    """Load the MCX JSON master from text (tests, and the old single-segment cache)."""
    _parts["MCX_COM"] = _parse("MCX_COM", "json", "COM", text)
    _rebuild()


def refresh(force: bool = False) -> None:
    """Download today's masters (once a day), or fall back to the copies on disk.
    Once a list is loaded, the daily refresh runs in the background so nothing waits for it."""
    today = time.strftime("%Y-%m-%d")
    if _rows and _loaded_day != today and not force:
        if not _bg["running"]:
            _bg["running"] = True
            threading.Thread(target=_refresh_bg, daemon=True).start()
        return
    _refresh(force)


def _refresh_bg():
    try:
        _refresh(True)
    finally:
        _bg["running"] = False


def _cache_name(name, fmt):
    return "symbols_MCX.json" if name == "MCX_COM" else f"symbols_{name}.{fmt}"


def _refresh(force: bool = False) -> None:
    global _loaded_day
    today = time.strftime("%Y-%m-%d")
    with _lock:
        if _rows and _loaded_day == today and not force:
            return
        if not _rows:                                     # start quickly from yesterday's copies
            for name, file, fmt, seg in SOURCES:
                p = store.path(_cache_name(name, fmt))
                if p.exists():
                    try:
                        _parts[name] = _parse(name, fmt, seg, p.read_text(encoding="utf-8"))
                    except Exception as e:
                        log.warning("Saved %s master unreadable: %s", name, e)
            if _parts:
                _rebuild()
        got = []
        for name, file, fmt, seg in SOURCES:
            try:
                r = httpx.get(BASE + file, timeout=120)
                r.raise_for_status()
                text = r.text
                rows = _parse(name, fmt, seg, text)
                if not rows:
                    raise ValueError("empty list")
                store.path(_cache_name(name, fmt)).write_text(text, encoding="utf-8")
                _parts[name] = rows
                got.append(f"{name} {len(rows):,}")
                del text, r
            except Exception as e:
                log.warning("Symbol master %s download failed (%s) - using the saved copy", name, e)
        _rebuild()
        _loaded_day = today                                # don't retry on every call; tomorrow tries again
        log.info("Symbol masters: %s (%s rows in all)", ", ".join(got) or "saved copies", f"{len(_rows):,}")


def get(ticker: str):
    refresh()
    d = _dcache.get(ticker)
    if d is None:
        i = _by_ticker.get(ticker)
        if i is None:
            return None
        d = _dcache[ticker] = _dict(_rows[i])
        if len(_dcache) > 3000:
            _dcache.clear()
    return d


KIND_ORDER = {"IDX": 0, "EQ": 1, "FUT": 2, "OPT": 3, "OTHER": 4}
EX_ORDER = {"NSE": 0, "BSE": 1, "MCX": 2}


def search(q: str, kind: str = "", limit: int = 40, ex: str = "") -> list:
    """All words must match the ticker, name or underlying. An exact underlying / name match comes first, then
    indices, stocks, futures, options; NSE before BSE; nearest expiry first."""
    refresh()
    words = [w for w in q.upper().replace(":", " ").split() if w]
    if not words:
        return []
    q0 = " ".join(words)
    now = time.time()
    hits = []
    for i, hay in enumerate(_hay):
        if all(w in hay for w in words):
            r = _rows[i]
            if not r[11] or (r[6] and r[6] < now - 86400):
                continue
            if kind and r[9] != kind:
                continue
            if ex and r[13] != ex:
                continue
            hits.append(r)
    name = lambda r: r[0].split(":", 1)[1].split("-")[0]
    exact = lambda r: r[2] == q0 or name(r) == q0 or IDX2U.get(r[0].split(":", 1)[1]) == q0
    hits.sort(key=lambda r: (0 if exact(r) else 1, KIND_ORDER.get(r[9], 5), EX_ORDER.get(r[13], 3),
                             r[6] or 9e12, r[7] or 0, r[8]))
    return [_dict(r) for r in hits[:limit]]


def chain(underlying: str, expiry: int, ex: str = "") -> list:
    """Option contracts of one underlying and expiry, by strike (for the option-chain picker)."""
    refresh()
    ex = ex or _default_ex(underlying)
    rows = [r for r in _rows if r[2] == underlying and r[9] == "OPT" and r[6] == expiry and (not ex or r[13] == ex)]
    return [_dict(r) for r in sorted(rows, key=lambda r: (r[7], r[8]))]


def _default_ex(underlying: str) -> str:
    """An underlying with options on several exchanges: NSE first, then BSE, then MCX."""
    seen = {r[13] for r in _rows if r[2] == underlying and r[9] == "OPT"}
    for x in ("NSE", "BSE", "MCX"):
        if x in seen:
            return x
    return ""


def expiries(underlying: str, ex: str = "") -> list:
    refresh()
    ex = ex or _default_ex(underlying)
    now = time.time()
    return sorted({r[6] for r in _rows if r[2] == underlying and r[9] == "OPT" and r[6] > now - 86400 and (not ex or r[13] == ex)})


IDX2U = {"NIFTY50-INDEX": "NIFTY", "NIFTYBANK-INDEX": "BANKNIFTY", "FINNIFTY-INDEX": "FINNIFTY", "MIDCPNIFTY-INDEX": "MIDCPNIFTY",
         "NIFTYNXT50-INDEX": "NIFTYNXT50", "SENSEX-INDEX": "SENSEX", "BANKEX-INDEX": "BANKEX", "SENSEX50-INDEX": "SENSEX50"}


def resolve_underlying(u: str):
    """An index or stock ticker (NSE:NIFTY50-INDEX, NSE:RELIANCE-EQ) or a contract -> (F&O underlying, exchange)."""
    if ":" not in u:
        return u.upper(), ""
    x, name = u.split(":", 1)
    if name in IDX2U:
        return IDX2U[name], x
    r = get(u)
    if r and r.get("f") in ("FUT", "OPT"):
        return r["u"], x
    return name.split("-")[0], x


def spot(underlying: str, ex: str = ""):
    """The index or stock an F&O underlying refers to, for the option chain's at-the-money strike."""
    refresh()
    names = {"NIFTY": "NIFTY50-INDEX", "BANKNIFTY": "NIFTYBANK-INDEX", "FINNIFTY": "FINNIFTY-INDEX",
             "MIDCPNIFTY": "MIDCPNIFTY-INDEX", "NIFTYNXT50": "NIFTYNXT50-INDEX", "SENSEX": "SENSEX-INDEX",
             "BANKEX": "BANKEX-INDEX", "SENSEX50": "SENSEX50-INDEX"}
    x = ex or _default_ex(underlying) or "NSE"
    for t in (f"{x}:{names.get(underlying, '')}", f"{x}:{underlying}-EQ", f"{x}:{underlying}-INDEX"):
        if t in _by_ticker:
            return get(t)
    return None


def underlying_future(row: dict):
    """The futures contract an option settles into: same underlying and exchange, nearest expiry on or after the option's."""
    refresh()
    if not row or row.get("f") != "OPT":
        return None
    x = row.get("x") or row["s"].split(":", 1)[0]
    futs = [r for r in _rows if r[2] == row["u"] and r[9] == "FUT" and r[13] == x and r[6] >= row["exp"] - 86400]
    return _dict(min(futs, key=lambda r: r[6])) if futs else None
