"""Fyers symbol master (public, daily). MCX for now; NSE F&O is one line away (SEGMENTS)."""
import json
import logging
import threading
import time

import httpx

from . import store

log = logging.getLogger("symbols")
SEGMENTS = {"MCX": "https://public.fyers.in/sym_details/MCX_COM_sym_master.json"}
_rows: list = []
_by_ticker: dict = {}
_loaded_day = ""
_lock = threading.Lock()


def _compact(t: str, v: dict) -> dict:
    opt = v.get("optType") if v.get("optType") in ("CE", "PE") else ""
    try:
        exp = int(v.get("expiryDate") or 0)
    except ValueError:
        exp = 0
    return {
        "s": t,                                            # MCX:CRUDEOIL26NOVFUT
        "d": v.get("symbolDesc") or v.get("symDetails") or t,
        "u": v.get("underSym") or v.get("exSymbol") or "",
        "lot": v.get("minLotSize") or 1,                   # order quantity step
        "mult": v.get("qtyMultiplier") or 1,               # P&L per 1.00 move per lot
        "tick": v.get("tickSize") or 0.05,
        "exp": exp,
        "k": v.get("strikePrice") if opt else None,
        "o": opt,                                          # CE / PE / "" (future)
        "f": "FUT" if t.endswith("FUT") else ("OPT" if opt else "OTHER"),
        "frz": v.get("qtyFreeze") or "",
        "on": v.get("tradeStatus", 1) == 1,
        "sess": v.get("tradingSession", ""),
    }


def _load_from(text: str) -> None:
    global _rows, _by_ticker
    data = json.loads(text)
    rows = [_compact(t, v) for t, v in data.items() if isinstance(v, dict)]
    _rows = rows
    _by_ticker = {r["s"]: r for r in rows}


_bg = {"running": False}


def refresh(force: bool = False) -> None:
    """Download today's master (once a day), or fall back to the copy on disk.
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


def _refresh(force: bool = False) -> None:
    global _loaded_day
    today = time.strftime("%Y-%m-%d")
    with _lock:
        if _rows and _loaded_day == today and not force:
            return
        cache = store.path("symbols_MCX.json")
        try:
            r = httpx.get(SEGMENTS["MCX"], timeout=60)
            r.raise_for_status()
            cache.write_text(r.text, encoding="utf-8")
            _load_from(r.text)
            _loaded_day = today
            log.info("Symbol master loaded: %d MCX contracts", len(_rows))
        except Exception as e:
            log.warning("Symbol master download failed (%s) - using the saved copy", e)
            if cache.exists() and not _rows:
                _load_from(cache.read_text(encoding="utf-8"))
            _loaded_day = today                            # don't retry on every call; tomorrow tries again


def get(ticker: str):
    refresh()
    return _by_ticker.get(ticker)


def search(q: str, kind: str = "", limit: int = 40) -> list:
    """All words must match the ticker or description. Futures first, then nearest expiry."""
    refresh()
    words = [w for w in q.upper().replace(":", " ").split() if w]
    now = time.time()
    out = []
    for r in _rows:
        if not r["on"] or (r["exp"] and r["exp"] < now - 86400):
            continue
        if kind and r["f"] != kind:
            continue
        hay = (r["s"] + " " + r["d"]).upper()
        if all(w in hay for w in words):
            out.append(r)
    out.sort(key=lambda r: ({"FUT": 0, "OPT": 1}.get(r["f"], 2), r["exp"] or 9e12, r["k"] or 0, r["o"]))
    return out[:limit]


def chain(underlying: str, expiry: int) -> list:
    """Option contracts of one underlying and expiry, by strike (for the option-chain picker)."""
    refresh()
    rows = [r for r in _rows if r["u"] == underlying and r["f"] == "OPT" and r["exp"] == expiry]
    return sorted(rows, key=lambda r: (r["k"], r["o"]))


def expiries(underlying: str) -> list:
    refresh()
    now = time.time()
    return sorted({r["exp"] for r in _rows if r["u"] == underlying and r["f"] == "OPT" and r["exp"] > now - 86400})


def underlying_future(row: dict):
    """The futures contract an option settles into: same underlying, nearest expiry on or after the option's."""
    refresh()
    if not row or row.get("f") != "OPT":
        return None
    futs = [r for r in _rows if r["u"] == row["u"] and r["f"] == "FUT" and r["exp"] >= row["exp"] - 86400]
    return min(futs, key=lambda r: r["exp"]) if futs else None
