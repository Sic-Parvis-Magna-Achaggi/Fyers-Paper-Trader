"""Order-flow check: does Fyers' normal price feed deliver every trade? (roadmap item 2, measured from 2 Nov 2026)

A real footprint needs each trade's price and size. Fyers' data socket sends snapshots carrying the last trade's price
(ltp) and size (ltq) and the day's volume so far (vol). Between two snapshots the volume grows by `dv`:
- dv == ltq: one trade, known exactly (price and size);
- dv  > ltq: several trades merged into one snapshot: only the last one's price is known;
- dv == 0  : a quote change, no trade.
This records every snapshot of the chosen contracts (the admin's own feed) to data/feedcheck/<day>.jsonl.gz and
counts how much of the volume arrived as exact single trades, per contract and per hour (IST). Nothing here changes
how the app trades.

Defaults: the nearest CRUDEOIL and NIFTY futures. The admin can change the list (Log page)."""
from __future__ import annotations

import datetime as dt
import gzip
import json
import logging
import threading
import time

from . import store, symbols

log = logging.getLogger("feedcheck")
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
CFG = "feedcheck/config.json"


def nearest_future(name: str, ex: str):
    rows = [r for r in symbols.search(name, "FUT", 40, ex) if r.get("u") == name and r.get("f") == "FUT"]
    rows = [r for r in rows if (r.get("exp") or 0) > time.time()]
    return min(rows, key=lambda r: r["exp"])["s"] if rows else None


class FeedCheck:
    def __init__(self):
        self.lock = threading.Lock()
        self.prev: dict = {}          # symbol -> (vol, ltq, ltt, t)
        self.buf: list = []
        self.day = ""
        self.stats: dict = {}         # day -> symbol -> counters (and "hours" -> hour -> counters)
        self.last_flush = 0.0
        self._cfg = None              # cached: symbols() runs on every tick
        self._load_day(self._today())

    # ------------------------------------------------------------ config
    def config(self) -> dict:
        if self._cfg is not None:
            return self._cfg
        c = store.load(CFG)
        if not c:
            if not symbols._rows:                 # the contract list isn't loaded yet: try again later
                return {"on": True, "symbols": []}
            c = {"on": True, "symbols": [s for s in (nearest_future("CRUDEOIL", "MCX"), nearest_future("NIFTY", "NSE")) if s]}
            if not c["symbols"]:
                return c
            store.save(CFG, c)
        self._cfg = c
        return c

    def set_config(self, on: bool | None = None, syms: list | None = None) -> dict:
        c = self.config()
        if on is not None:
            c["on"] = bool(on)
        if syms is not None:
            ok = [s for s in syms if isinstance(s, str) and symbols.get(s)][:6]
            if not ok:
                raise ValueError("pick at least one contract (up to 6)")
            c["symbols"] = ok
        store.save(CFG, c)
        self._cfg = c
        return c

    def symbols(self) -> list:
        c = self.config()
        return list(c.get("symbols") or []) if c.get("on") else []

    # ------------------------------------------------------------ recording
    @staticmethod
    def _today() -> str:
        return dt.datetime.now(IST).strftime("%Y-%m-%d")

    def _load_day(self, day):
        self.day = day
        self.stats.setdefault(day, store.load(f"feedcheck/{day}.json") or {})

    @staticmethod
    def _blank():
        return {"updates": 0, "trade_updates": 0, "exact_updates": 0, "merged_updates": 0, "odd_updates": 0,
                "vol": 0, "exact_vol": 0, "merged_vol": 0, "merged_last_vol": 0, "gaps": 0, "max_merge": 0,
                "first": None, "last": None}

    def record(self, t: dict):
        """A tick from the admin's data socket (feed.py). Only socket ticks count (not the quote poll)."""
        s = t.get("s")
        if t.get("src") != "ws" or s not in self.symbols():
            return
        now = time.time()
        vol, ltq = t.get("vol"), t.get("ltq")
        line = {"r": round(now, 3), "s": s, "ltp": t.get("ltp"), "ltq": ltq, "vol": vol, "ltt": t.get("ltt"),
                "ft": t.get("t"), "bid": t.get("bid"), "ask": t.get("ask"), "bsz": t.get("bsz"), "asz": t.get("asz")}
        with self.lock:
            day = self._today()
            if day != self.day:
                self._flush_locked()
                self._load_day(day)
                self.prev = {}
            st = self.stats[day].setdefault(s, self._blank())
            hr = st.setdefault("hours", {}).setdefault(dt.datetime.fromtimestamp(now, IST).strftime("%H"), self._blank())
            for c in (st, hr):
                c["updates"] += 1
                c["first"] = c["first"] or now
                c["last"] = now
            p = self.prev.get(s)
            self.prev[s] = (vol, ltq, t.get("ltt"), now)
            if p is not None and vol is not None and p[0] is not None:
                dv = vol - p[0]
                gap = now - p[3] > 5
                kind = None
                if dv < 0:
                    kind = "odd"
                elif dv > 0:
                    kind = "exact" if ltq == dv else ("merged" if ltq is not None and ltq < dv else "odd")
                line["dv"] = dv
                line["k"] = kind
                for c in (st, hr):
                    if gap:
                        c["gaps"] += 1
                    if kind:
                        c[kind + "_updates"] += 1
                    if dv > 0:
                        c["trade_updates"] += 1
                        c["vol"] += dv
                        if kind == "exact":
                            c["exact_vol"] += dv
                        elif kind == "merged":
                            c["merged_vol"] += dv
                            c["merged_last_vol"] += ltq or 0
                            c["max_merge"] = max(c["max_merge"], dv)
            self.buf.append(line)
            if now - self.last_flush > 5 or len(self.buf) > 5000:
                self._flush_locked()

    def _flush_locked(self):
        self.last_flush = time.time()
        if self.buf:
            try:
                with gzip.open(store.path(f"feedcheck/{self.day}.jsonl.gz"), "at", encoding="utf-8") as f:
                    for x in self.buf:
                        f.write(json.dumps(x, separators=(",", ":")) + "\n")
            except Exception as e:
                log.warning("feed check: couldn't write the snapshots: %s", e)
            self.buf = []
        store.save(f"feedcheck/{self.day}.json", self.stats.get(self.day, {}))

    def flush(self):
        with self.lock:
            self._flush_locked()

    # ------------------------------------------------------------ the report
    @staticmethod
    def _sum(c: dict) -> dict:
        v = c.get("vol") or 0
        tu = c.get("trade_updates") or 0
        out = {k: c.get(k) for k in ("updates", "trade_updates", "exact_updates", "merged_updates", "odd_updates", "vol",
                                     "exact_vol", "merged_vol", "gaps", "max_merge", "first", "last")}
        out["exact_vol_pct"] = round(100 * (c.get("exact_vol") or 0) / v, 2) if v else None
        out["exact_upd_pct"] = round(100 * (c.get("exact_updates") or 0) / tu, 2) if tu else None
        # the last trade of each merged snapshot is known too: the share of volume whose price is known
        out["known_vol_pct"] = round(100 * ((c.get("exact_vol") or 0) + (c.get("merged_last_vol") or 0)) / v, 2) if v else None
        span = (c.get("last") or 0) - (c.get("first") or 0)
        out["per_sec"] = round((c.get("updates") or 0) / span, 2) if span > 0 else None
        return out

    def report(self, day: str | None = None) -> dict:
        with self.lock:
            self._flush_locked()
            day = day or self.day
            raw = self.stats.get(day) or store.load(f"feedcheck/{day}.json") or {}
            days = sorted(p.stem for p in store.path("feedcheck/x").parent.glob("20*.json"))
        rows = {s: {**self._sum(c), "hours": {h: self._sum(x) for h, x in sorted((c.get("hours") or {}).items())}}
                for s, c in raw.items()}
        return {"day": day, "days": days, "config": self.config(), "symbols": rows}


FC = FeedCheck()
