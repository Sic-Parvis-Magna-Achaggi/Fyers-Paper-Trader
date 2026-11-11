"""Alerts like TradingView's (v0.38.0, roadmap 21): price, technical, drawing, multi-condition and watchlist alerts, run on
the server for each user whether a page is open or not.

An alert: {id, name, target: {s} | {wl, wl_name}, conds: [cond x 1-5], join: "all" | "any", freq, exp, msg, notify, ctype,
           status: active | paused | triggered | expired, created, updated, fired, last}
A cond:   {a: SRC, op, b: SRC (cross / gt / lt), lo / hi: SRC (channels), amt, bars (moving), tf: "5m"}
A SRC:    {k: "price", f: last | bid | ask}            the real price (each tick; the day's high / low between snapshots)
          {k: "bar", f: open | high | low | close | hl2 | hlc3 | ohlc4 | volume}   bars as the chart type shows them
          {k: "pine", name, code, inputs, props, libs, missing, plot: title | ac: title | any: true}   a script on the chart
                                                    (a copy, as TradingView keeps: editing the script later changes nothing)
          {k: "ind", t: rsi | ema | ..., p: {...}, out: title}   a built-in quick indicator (Pine code made here)
          {k: "draw", id, edge: v | upper | lower | mid, name}  a drawing on that contract (followed when it moves)
          {k: "pf", sig: buy | sell | DTB | TTB | DBS | TBS}    the P&F toolkit's signals (P&F charts)
          {k: "value", v}                                      a number (comparands only)

How values are worked out
- "Tick" conditions (the price against a number or a drawing, not moving %): on every tick, against the previous tick,
  so "crossing" is the moment it happens; the day's high / low catch a trade through the level between snapshots
  (the same rule as paper fills).
- Everything else, as TradingView's technical alerts: series values on the condition's timeframe and the alert's chart
  type, the live bar against the bar before (crossing = was below, now at / above). Bars come from the saved candles
  (helper/candles.py, the user's own Fyers login, or the MT5 bridge) plus each tick, built as the chart builds them
  (web/index.html tfPlan / bucket / aggBars / liveBar, ported below). Pine (scripts and the built-ins) runs in Node with
  the page's own Pine worker (helper/pine_node.mjs).

Trigger (TradingView's): once (then "triggered"), once per bar (of the first condition's timeframe), once per bar close
(evaluated when that bar closes: on the next bar's first tick, or 2 s after its time is up), once per minute.

Files: u/<user>/alerts.json {alerts: [...]}, u/<user>/alerts_log.jsonl (what fired; the last LOG_KEEP kept)."""
import asyncio
import collections
import datetime as dt
import hashlib
import ipaddress
import json
import logging
import math
import os
import re
import secrets
import shutil
import socket
import time
import urllib.parse
from pathlib import Path

from . import candles as candles_store
from . import fyers_link, mt5, store, symbols, telegram, webpush

log = logging.getLogger("chartalerts")
IST = 19800
ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"

MAX_ALERTS = 400            # per user (TradingView Premium: 400 price + 400 technical)
MAX_TECH = 100              # per user: alerts that need bars / Pine (each symbol of a watchlist alert counts)
MAX_CONDS = 5               # TradingView: up to 5 in a multi-condition alert
MAX_WL = 15                 # watchlist alerts per user (TradingView Ultimate: 15)
MAX_SYMS = 60               # symbols all alerts may keep on Fyers' price socket (100 on Standard, shared with charts)
LOG_KEEP = 2000
TAIL = 3                    # values kept per series (the live bar, the one before, and one more for bar close)
REFRESH_SEC = 600           # the saved candles are checked again this often per series (fixes from Fyers reach alerts)
CODE_MAX = 200_000
_now = time.time            # tests swap it

FREQS = ("once", "bar", "close", "minute")
OPS = {"cross": "Crossing", "cross_up": "Crossing up", "cross_dn": "Crossing down", "gt": "Greater than", "lt": "Less than",
       "enter": "Entering channel", "exit": "Exiting channel", "inside": "Inside channel", "outside": "Outside channel",
       "up": "Moving up", "down": "Moving down", "up_pct": "Moving up %", "down_pct": "Moving down %", "true": "Is true"}
TWO = ("cross", "cross_up", "cross_dn", "gt", "lt")
CHAN = ("enter", "exit", "inside", "outside")
MOVE = ("up", "down", "up_pct", "down_pct")
BAR_F = ("open", "high", "low", "close", "hl2", "hlc3", "ohlc4", "volume")
PF_SIGS = ("buy", "sell", "DTB", "TTB", "DBS", "TBS")
DRAW_TYPES = ("hline", "hray", "trend", "ray", "extl", "channel", "rect")

# Built-in quick indicators: Pine made here, run like any script. (name, params [(key, label, default, lo, hi)], outputs, code)
SRCS = ("close", "open", "high", "low", "hl2", "hlc3", "ohlc4")
IND = {
    "sma": ("Moving average (SMA)", [("src", "Source", "close"), ("len", "Length", 20, 1, 2000)], ["MA"],
            'plot(ta.sma({src}, {len}), "MA")'),
    "ema": ("Moving average (EMA)", [("src", "Source", "close"), ("len", "Length", 20, 1, 2000)], ["EMA"],
            'plot(ta.ema({src}, {len}), "EMA")'),
    "wma": ("Moving average (WMA)", [("src", "Source", "close"), ("len", "Length", 20, 1, 2000)], ["WMA"],
            'plot(ta.wma({src}, {len}), "WMA")'),
    "vwap": ("VWAP (daily)", [], ["VWAP"], 'plot(ta.vwap(hlc3), "VWAP")'),
    "rsi": ("RSI", [("src", "Source", "close"), ("len", "Length", 14, 1, 500)], ["RSI"], 'plot(ta.rsi({src}, {len}), "RSI")'),
    "macd": ("MACD", [("src", "Source", "close"), ("fast", "Fast", 12, 1, 500), ("slow", "Slow", 26, 1, 500), ("sig", "Signal", 9, 1, 500)],
             ["MACD", "Signal", "Histogram"],
             '[m, s, h] = ta.macd({src}, {fast}, {slow}, {sig})\nplot(m, "MACD")\nplot(s, "Signal")\nplot(h, "Histogram")'),
    "bb": ("Bollinger Bands", [("src", "Source", "close"), ("len", "Length", 20, 1, 500), ("mult", "StdDev", 2.0, 0.1, 10)],
           ["Basis", "Upper", "Lower"],
           'b = ta.sma({src}, {len})\nd = {mult} * ta.stdev({src}, {len})\nplot(b, "Basis")\nplot(b + d, "Upper")\nplot(b - d, "Lower")'),
    "st": ("Supertrend", [("factor", "Factor", 3.0, 0.1, 50), ("atr", "ATR length", 10, 1, 500)], ["Supertrend", "Direction"],
           '[st, dir] = ta.supertrend({factor}, {atr})\nplot(st, "Supertrend")\nplot(dir, "Direction")'),
    "atr": ("ATR", [("len", "Length", 14, 1, 500)], ["ATR"], 'plot(ta.atr({len}), "ATR")'),
    "stoch": ("Stochastic", [("k", "%K length", 14, 1, 500), ("ks", "%K smoothing", 3, 1, 100), ("d", "%D smoothing", 3, 1, 100)],
              ["%K", "%D"], 'k = ta.sma(ta.stoch(close, high, low, {k}), {ks})\nplot(k, "%K")\nplot(ta.sma(k, {d}), "%D")'),
    "cci": ("CCI", [("len", "Length", 20, 1, 500)], ["CCI"], 'plot(ta.cci(hlc3, {len}), "CCI")'),
    "adx": ("ADX / DMI", [("di", "DI length", 14, 1, 500), ("len", "ADX smoothing", 14, 1, 500)], ["ADX", "+DI", "-DI"],
            '[p, m, a] = ta.dmi({di}, {len})\nplot(a, "ADX")\nplot(p, "+DI")\nplot(m, "-DI")'),
    "mfi": ("Money Flow Index", [("len", "Length", 14, 1, 500)], ["MFI"], 'plot(ta.mfi(hlc3, {len}), "MFI")'),
    "obv": ("On Balance Volume", [], ["OBV"], 'plot(ta.obv, "OBV")'),
    "don": ("Donchian channel", [("len", "Length", 20, 1, 500)], ["Upper", "Lower", "Basis"],
            'u = ta.highest({len})\nl = ta.lowest({len})\nplot(u, "Upper")\nplot(l, "Lower")\nplot((u + l) / 2, "Basis")'),
    "vma": ("Volume average", [("len", "Length", 20, 1, 500)], ["Volume MA"], 'plot(ta.sma(volume, {len}), "Volume MA")'),
}


class Bad(ValueError):
    pass


# ================================================================ timeframes (web/index.html parseTf / tfPlan / bucket)
NATIVE = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 120, 180, 240]


def parse_tf(x):
    m = re.match(r"^\s*(\d+)\s*(m|min|h|H|d|D|w|W|M|mo)\s*$", str(x or ""))
    if not m:
        return None
    n, u = int(m.group(1)), m.group(2)
    u = {"min": "m", "H": "h", "d": "D", "w": "W", "mo": "M"}.get(u, u)
    if n < 1 or n > 1000:
        return None
    mn = n if u == "m" else n * 60 if u == "h" else None
    if mn and mn > 24 * 60:
        return None
    key = f"{n * 60}m" if u == "h" and n * 60 < 60 else f"{n}{u}"
    return {"n": n, "u": u, "min": mn, "key": key}


def tf_plan(key):
    t = parse_tf(key) or parse_tf("5m")
    if t["min"]:
        base = t["min"] if t["min"] in NATIVE else max(b for b in NATIVE if t["min"] % b == 0)
        days = min(30 if base == 1 else 198, max(2, math.ceil(1000 * t["min"] / 870) + 3))
        return {"t": t, "res": str(base), "agg": base != t["min"], "sec": t["min"] * 60, "days": days}
    return {"t": t, "res": "D", "agg": t["u"] != "D" or t["n"] > 1, "sec": 86400 * (t["n"] if t["u"] == "D" else 1),
            "days": 1095 if t["u"] == "M" else 730}


def tf_norm(key) -> str:
    t = parse_tf(key)
    return t["key"] if t else ""


def pine_tf(key) -> str:
    t = parse_tf(key) or parse_tf("5m")
    if t["min"]:
        return str(t["min"])
    return (str(t["n"]) if t["n"] > 1 else "") + t["u"]


def pine_tf_key(p):
    m = re.match(r"^(\d*)([SDWM]?)$", str(p or "").strip(), re.I)
    if not m:
        return None
    n, u = int(m.group(1) or 1), (m.group(2) or "").upper()
    if not u:
        return f"{n // 60}h" if n % 60 == 0 and n >= 60 else f"{n}m"
    if u == "S":
        return None
    return f"{n}{u}"


def is_mt5(s) -> bool:
    return str(s or "").startswith("MT5:")


def _sess(row) -> tuple:
    """(start, end) of the symbol's trading day in minutes after midnight (its own clock for MT5): 09:00 by default."""
    s = str((row or {}).get("sess") or "")
    a = re.match(r"^(\d\d)(\d\d)", s)
    st = int(a.group(1)) * 60 + int(a.group(2)) if a else 540
    ends = re.findall(r"-(\d\d)(\d\d)", s)
    en = int(ends[-1][0]) * 60 + int(ends[-1][1]) if ends else None
    return st, en


def chart_day(ts: int, mt5flag: bool, sst: int) -> int:
    if not mt5flag:
        return ts // 86400 * 86400
    sh = sst * 60
    return (ts - sh) // 86400 * 86400


def bucket(ts: int, plan: dict, mt5flag: bool, sst: int) -> int:
    t, day = plan["t"], chart_day(ts, mt5flag, sst)
    if t["min"]:
        a = day + sst * 60
        return a + (ts - a) // plan["sec"] * plan["sec"]
    if t["u"] == "D":
        return day if t["n"] == 1 else day // plan["sec"] * plan["sec"]
    if t["u"] == "W":
        dow = dt.datetime.fromtimestamp(day, dt.timezone.utc).weekday()        # Monday 0, as (getUTCDay() + 6) % 7
        return day - dow * 86400
    d = dt.datetime.fromtimestamp(day, dt.timezone.utc)
    return int(dt.datetime(d.year, d.month, 1, tzinfo=dt.timezone.utc).timestamp())


def no_trade_drop(rows: list, on: bool = True) -> list:
    if on is False or not rows or not any((r[5] or 0) > 0 for r in rows):
        return rows
    out, lc = [], None
    for r in rows:
        if not ((r[5] or 0) > 0) and lc is not None and (r[1] != lc or r[2] != lc or r[3] != lc or r[4] != lc):
            continue
        out.append(r)
        lc = r[4]
    return out


def agg_rows(rows: list, plan: dict, mt5flag: bool, sst: int, drop: bool = True) -> list:
    """Fyers' / MT5's candles [[t (UTC s), o, h, l, c, v]] -> the chart's bars [[t (IST-shifted s), o, h, l, c, v]]."""
    bars = [[int(r[0]) + IST, r[1], r[2], r[3], r[4], r[5] or 0] for r in no_trade_drop(rows, drop)]
    if not plan["agg"]:
        return bars
    out = []
    for b in bars:
        k = bucket(b[0], plan, mt5flag, sst)
        if not out or out[-1][0] != k:
            out.append([k, b[1], b[2], b[3], b[4], b[5]])
        else:
            o = out[-1]
            o[2], o[3], o[4], o[5] = max(o[2], b[2]), min(o[3], b[3]), b[4], o[5] + b[5]
    return out


# ================================================================ a symbol's bars on one timeframe
class Series:
    def __init__(self, sym: str, tfk: str):
        self.sym, self.tfk = sym, tfk
        self.plan = tf_plan(tfk)
        self.mt5 = is_mt5(sym)
        row = symbols.get(sym) or {}
        self.sst, self.sen = _sess(row)
        self.tick = row.get("tick") or 0.05
        self.rows: list = []
        self.loaded = False
        self.loading = False
        self.err = ""
        self.at = 0.0               # when the saved candles were last read
        self.vol_cum = None
        self.ver = 0                # bumped by each change
        self.drop = True            # Chart settings › hide candles with no trades

    def apply_tick(self, t: dict) -> bool:
        """web/index.html liveBar: the live bar from a price."""
        px = t.get("ltp")
        if not px or not self.loaded:
            return False
        tt = t.get("t") or _now()
        try:
            tt = int(float(tt))
        except (TypeError, ValueError):
            tt = int(_now())
        ts = tt + IST
        p = self.plan
        if p["t"]["min"] and not self.mt5 and ts - ts // 86400 * 86400 < self.sst * 60:
            return False                                    # NSE's pre-open: no intraday candle of its own
        b = bucket(ts, p, self.mt5, self.sst)
        last = self.rows[-1] if self.rows else None
        if not p["agg"] and p["t"]["min"] and last and last[0] // 86400 == ts // 86400 and ts >= last[0]:
            b = last[0] + (ts - last[0]) // p["sec"] * p["sec"]
        if last and b < last[0]:
            return False
        dv = 0
        v = t.get("vol")
        if v is not None:
            if self.vol_cum is not None and v >= self.vol_cum:
                dv = v - self.vol_cum
            self.vol_cum = v
        if not last or b > last[0]:
            self.rows.append([b, px, px, px, px, dv])
            if len(self.rows) > 8000:
                del self.rows[:len(self.rows) - 6000]
        else:
            last[2], last[3], last[4], last[5] = max(last[2], px), min(last[3], px), px, (last[5] or 0) + dv
        self.ver += 1
        return True

    def bar_end(self, bt: int) -> int:
        """When the bar starting at bt closes (IST-shifted s): its length, or the session's end if that comes first."""
        p = self.plan
        end = bt + p["sec"]
        if p["t"]["u"] == "W":
            end = bt + 7 * 86400
        if p["t"]["u"] == "M":
            d = dt.datetime.fromtimestamp(bt, dt.timezone.utc)
            end = int(dt.datetime(d.year + (d.month == 12), d.month % 12 + 1, 1, tzinfo=dt.timezone.utc).timestamp())
        if self.sen is not None and not self.mt5 and p["t"]["u"] in ("m", "h", "D"):
            day = chart_day(bt, False, self.sst)
            se = day + self.sen * 60
            if bt < se < end:
                end = se
        return end


# ================================================================ Node: the page's Pine worker on the server
def node_path() -> str:
    for p in (os.environ.get("FTM_NODE") or "", "/opt/ftm-node/bin/node"):
        if p and os.path.exists(p):
            return p
    return shutil.which("node") or ""


class Runner:
    """One Node process for every user (helper/pine_node.mjs). Requests run one at a time there, in order."""

    def __init__(self):
        self.proc = None
        self.reader = None
        self.pending: dict = {}         # rid -> (future, uid)
        self.order = collections.deque()
        self.rid = 0
        self.err = ""
        self.started = 0.0
        self.version = ""
        self.need_fn = None             # async (uid, ticker, tf) -> candles (set by the book)
        self.restarts = 0
        self._lock = None

    def ok(self) -> bool:
        return bool(self.proc and self.proc.returncode is None and self.version)

    async def start(self):
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            if self.ok():
                return True
            node = node_path()
            if not node:
                self.err = "Node.js isn't installed on the server (the next update installs it): technical alerts wait"
                return False
            if self.started and _now() - self.started < 5:
                await asyncio.sleep(5)
            self.started = _now()
            try:
                self.proc = await asyncio.create_subprocess_exec(
                    node, "--max-old-space-size=768", str(ROOT / "helper" / "pine_node.mjs"), str(WEB),
                    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                    limit=32 * 1024 * 1024)
            except Exception as e:
                self.err = f"Node didn't start: {e}"
                return False
            line = await asyncio.wait_for(self.proc.stdout.readline(), 30)
            try:
                hello = json.loads(line)
            except Exception:
                hello = {}
            if not hello.get("ready"):
                self.err = "the Pine runner didn't start: " + (line.decode(errors="replace")[:200] if line else "no answer")
                return False
            self.version, self.err = hello.get("node", "?"), ""
            self.reader = asyncio.get_running_loop().create_task(self._read())
            asyncio.get_running_loop().create_task(self._stderr())
            log.info("Pine runner for alerts started (Node %s)", self.version)
            return True

    async def _stderr(self):
        p = self.proc
        while p and p.returncode is None:
            line = await p.stderr.readline()
            if not line:
                break
            log.warning("Pine runner: %s", line.decode(errors="replace").rstrip()[:400])

    async def _read(self):
        p = self.proc
        while True:
            line = await p.stdout.readline()
            if not line:
                break
            try:
                m = json.loads(line)
            except Exception:
                continue
            if "need" in m:
                asyncio.get_running_loop().create_task(self._need(m["need"]))
                continue
            rid = m.get("rid")
            if rid in self.pending:
                fut, _ = self.pending.pop(rid)
                try:
                    self.order.remove(rid)
                except ValueError:
                    pass
                if not fut.done():
                    fut.set_result(m)
        self.version = ""
        self.restarts += 1
        log.warning("Pine runner stopped (it restarts with the next alert that needs it)")
        for rid, (fut, _) in list(self.pending.items()):
            if not fut.done():
                fut.set_result({"ok": False, "error": "the Pine runner stopped", "gone": True})
        self.pending.clear()
        self.order.clear()
        for cb in list(_restart_cbs):
            try:
                cb()
            except Exception:
                pass

    async def _need(self, need: dict):
        """request.security(): the run that asked is the oldest unanswered request (Node runs them in order)."""
        uid = self.pending[self.order[0]][1] if self.order and self.order[0] in self.pending else None
        out = {"op": "data", "id": need.get("id")}
        try:
            out["candles"] = await self.need_fn(uid, need.get("ticker"), need.get("tf")) if self.need_fn and uid else []
        except Exception as e:
            out["candles"], out["error"] = [], str(e)[:200]
        self._write(out)

    def _write(self, m: dict):
        if self.proc and self.proc.returncode is None:
            try:
                self.proc.stdin.write((json.dumps(m, separators=(",", ":")) + "\n").encode())
            except Exception as e:
                log.warning("Pine runner write: %s", e)

    async def call(self, uid: str, m: dict, timeout: float = 150) -> dict:
        if not self.ok() and not await self.start():
            return {"ok": False, "error": self.err}
        self.rid += 1
        rid = m["rid"] = self.rid
        fut = asyncio.get_running_loop().create_future()
        self.pending[rid] = (fut, uid)
        self.order.append(rid)
        self._write(m)
        try:
            await self.proc.stdin.drain()
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            self.pending.pop(rid, None)
            try:
                self.order.remove(rid)
            except ValueError:
                pass
            return {"ok": False, "error": "the Pine runner took too long"}

    def close(self, key: str):
        self._write({"op": "close", "key": key})

    def stop(self):
        if self.proc and self.proc.returncode is None:
            try:
                self.proc.kill()
            except Exception:
                pass


RUNNER = Runner()
_restart_cbs: list = []


# ================================================================ cleaning what the page sends
def _num(x, lo=-1e15, hi=1e15):
    try:
        v = float(x)
    except (TypeError, ValueError):
        raise Bad("a number is missing")
    if not math.isfinite(v) or v < lo or v > hi:
        raise Bad("a number is out of range")
    return v


def _jsize(x, n, what):
    if len(json.dumps(x)) > n:
        raise Bad(f"{what} too large")
    return x


def ind_code(t: str, p: dict) -> tuple:
    """A built-in indicator -> (Pine code, its plot titles)."""
    if t not in IND:
        raise Bad("unknown indicator")
    name, params, outs, tpl = IND[t]
    vals, lbl = {}, []
    for spec in params:
        k, default = spec[0], spec[2]
        v = (p or {}).get(k, default)
        if k == "src":
            v = v if v in SRCS else "close"
        elif isinstance(default, float):
            v = round(_num(v, spec[3], spec[4]), 4)
        else:
            v = int(_num(v, spec[3], spec[4]))
        vals[k] = v
        lbl.append(str(v))
    code = f'//@version=5\nindicator("{name}{(" " + " ".join(lbl)) if lbl else ""}")\n' + tpl.format(**vals) + "\n"
    return code, outs, vals


def clean_src(s, role: str = "a") -> dict:
    if not isinstance(s, dict):
        raise Bad("a condition is missing its source")
    k = s.get("k")
    if k == "value":
        if role == "a":
            raise Bad("a condition starts with a price or an indicator, not a number")
        return {"k": "value", "v": _num(s.get("v"))}
    if k == "price":
        return {"k": "price", "f": s.get("f") if s.get("f") in ("last", "bid", "ask") else "last"}
    if k == "bar":
        f = s.get("f")
        if f not in BAR_F:
            raise Bad("unknown bar value")
        return {"k": "bar", "f": f}
    if k == "pine":
        code = s.get("code")
        if not isinstance(code, str) or not code.strip() or len(code) > CODE_MAX:
            raise Bad("the script's code is missing")
        out = {"k": "pine", "name": str(s.get("name") or "Pine script")[:80], "code": code,
               "inputs": _jsize(s.get("inputs") if isinstance(s.get("inputs"), dict) else {}, 30_000, "inputs"),
               "props": _jsize(s.get("props") if isinstance(s.get("props"), dict) else {}, 2_000, "props"),
               "libs": _jsize({str(a)[:200]: str(b)[:CODE_MAX] for a, b in (s.get("libs") or {}).items()} if isinstance(s.get("libs"), dict) else {}, 600_000, "libraries"),
               "missing": [str(x)[:200] for x in (s.get("missing") or [])][:10] if isinstance(s.get("missing"), list) else [],
               "sid": str(s.get("sid") or "")[:20]}
        if s.get("any"):
            out["any"] = True
        elif s.get("ac"):
            out["ac"] = str(s["ac"])[:120]
        elif s.get("plot"):
            out["plot"] = str(s["plot"])[:120]
        else:
            raise Bad("which of the script's values?")
        return out
    if k == "ind":
        code, outs, vals = ind_code(s.get("t"), s.get("p") or {})
        o = s.get("out") if s.get("out") in outs else outs[0]
        return {"k": "ind", "t": s["t"], "p": vals, "out": o}
    if k == "draw":
        if not s.get("id"):
            raise Bad("which drawing?")
        edge = s.get("edge") if s.get("edge") in ("v", "upper", "lower", "mid") else "v"
        return {"k": "draw", "id": str(s["id"])[:40], "edge": edge, "name": str(s.get("name") or "Drawing")[:60]}
    if k == "pf":
        if s.get("sig") not in PF_SIGS:
            raise Bad("unknown P&F signal")
        return {"k": "pf", "sig": s["sig"]}
    raise Bad("unknown source")


def clean_cond(c, ctype: dict) -> dict:
    if not isinstance(c, dict):
        raise Bad("bad condition")
    op = c.get("op")
    if op not in OPS:
        raise Bad("unknown operator")
    tfk = tf_norm(c.get("tf") or "5m")
    if not tfk:
        raise Bad("unknown timeframe")
    out = {"a": clean_src(c.get("a")), "op": op, "tf": tfk}
    a = out["a"]
    if op == "true":
        if not (a["k"] == "pine" and ("ac" in a or a.get("any"))) and a["k"] != "pf":
            raise Bad('"Is true" is for a script\'s alert conditions, alert() calls and P&F signals')
    elif a["k"] == "pine" and ("ac" in a or a.get("any")):
        raise Bad("an alert condition or alert() call can only be \"is true\"")
    elif a["k"] == "pf":
        raise Bad("a P&F signal can only be \"is true\"")
    if op in TWO:
        out["b"] = clean_src(c.get("b"), "b")
    elif op in CHAN:
        out["lo"], out["hi"] = clean_src(c.get("lo"), "b"), clean_src(c.get("hi"), "b")
    elif op in MOVE:
        out["amt"] = _num(c.get("amt"), 0, 1e12)
        if out["amt"] <= 0:
            raise Bad("the amount to move must be above 0")
        out["bars"] = int(_num(c.get("bars", 1), 1, 300))
    if a["k"] == "pf" and (ctype or {}).get("type") != "pf":
        raise Bad("P&F signals need the alert to run on a Point & Figure chart")
    return out


def _keep_libs(b: dict, old: dict):
    """An edit from the page: its copy of a script has no libraries (the page isn't sent them); the stored copy's stay."""
    have = {}
    for c in old.get("conds") or []:
        for r in ("a", "b", "lo", "hi"):
            x = c.get(r) or {}
            if x.get("k") == "pine":
                have[x.get("code")] = (x.get("libs") or {}, x.get("missing") or [])
    for c in b.get("conds") or [] if isinstance(b.get("conds"), list) else []:
        for r in ("a", "b", "lo", "hi"):
            x = c.get(r) if isinstance(c, dict) else None
            if isinstance(x, dict) and x.get("k") == "pine" and "libs" not in x and x.get("code") in have:
                x["libs"], x["missing"] = have[x["code"]]


def tick_mode(c: dict, freq: str) -> bool:
    """The price against numbers / drawings: worked out on every tick (not for "once per bar close": that's the close)."""
    if freq == "close" or c["a"]["k"] != "price" or c["op"] in MOVE or c["op"] == "true":
        return False
    others = [c.get("b"), c.get("lo"), c.get("hi")]
    return all(x is None or x["k"] in ("value", "draw") for x in others)


def is_tech(a: dict) -> bool:
    return any(not tick_mode(c, a["freq"]) or any((c.get(k) or {}).get("k") == "draw" for k in ("b", "lo", "hi"))
               for c in a["conds"])


def clean_ctype(ct) -> dict:
    ct = ct if isinstance(ct, dict) else {}
    t = ct.get("type") if ct.get("type") in ("candles", "hollow", "bars", "line", "area", "ha", "renko", "range", "lb", "pf") else "candles"
    o = ct.get("opts") if isinstance(ct.get("opts"), dict) else {}
    keep = {}
    for k in ("renkoMode", "renkoAtr", "renkoSrc", "renkoWicks", "rangeMode", "rangeAtr", "lbLines", "pfMode", "pfAtr", "pfRev", "pfSrc",
              "renkoBox", "rangeSize", "pfBox"):
        if k in o:
            keep[k] = o[k]
    _jsize(keep, 20_000, "chart type")
    return {"type": t, "opts": keep, "pfInd": "last" if ct.get("pfInd") == "last" else "mid",
            "hideNoTrade": ct.get("hideNoTrade") is not False}


def clean_url(u: str) -> str:
    u = str(u or "").strip()
    if not u:
        return ""
    p = urllib.parse.urlsplit(u)
    if p.scheme not in ("http", "https") or not p.hostname or len(u) > 500:
        raise Bad("the webhook must be an http(s) address")
    if (p.port or (443 if p.scheme == "https" else 80)) not in (80, 443) and os.environ.get("FTM_WEBHOOK_PRIVATE") != "1":
        raise Bad("webhooks go to ports 80 and 443 only (as TradingView's)")
    return u


def clean(b: dict, old: dict | None = None) -> dict:
    """What the page sends -> a stored alert (raises Bad with a sentence for the page)."""
    if not isinstance(b, dict):
        raise Bad("bad alert")
    tg = b.get("target") if isinstance(b.get("target"), dict) else {}
    if tg.get("wl"):
        target = {"wl": str(tg["wl"])[:40], "wl_name": str(tg.get("wl_name") or "Watchlist")[:60]}
    else:
        s = str(tg.get("s") or "")[:120]
        if ":" not in s:
            raise Bad("which symbol?")
        target = {"s": s}
    ctype = clean_ctype(b.get("ctype"))
    conds = b.get("conds")
    if not isinstance(conds, list) or not conds:
        raise Bad("an alert needs a condition")
    if len(conds) > MAX_CONDS:
        raise Bad(f"at most {MAX_CONDS} conditions in one alert")
    conds = [clean_cond(c, ctype) for c in conds]
    if len(conds) > 1 and any(c["a"].get("any") for c in conds):
        raise Bad('"any alert() call" can\'t be combined with other conditions (as on TradingView)')
    if target.get("wl") and any(c["a"]["k"] == "draw" or any((c.get(k) or {}).get("k") == "draw" for k in ("b", "lo", "hi")) for c in conds):
        raise Bad("drawings belong to one contract: a watchlist alert can't use them")
    freq = b.get("freq") if b.get("freq") in FREQS else "once"
    if any(c["a"].get("any") for c in conds):
        freq = "bar"                                    # the script's own alert.freq_* decides
    exp = b.get("exp") or 0
    try:
        exp = int(exp)
    except (TypeError, ValueError):
        exp = 0
    nt = b.get("notify") if isinstance(b.get("notify"), dict) else {}
    notify = {"popup": nt.get("popup") is not False, "sound": str(nt.get("sound") or "chime")[:20],
              "tg": bool(nt.get("tg")), "push": nt.get("push") is not False, "webhook": clean_url(nt.get("webhook"))}
    now = int(_now())
    a = dict(old or {})
    a.update({"id": (old or {}).get("id") or secrets.token_hex(5), "name": str(b.get("name") or "").strip()[:100],
              "target": target, "conds": conds, "join": "any" if b.get("join") == "any" else "all", "freq": freq,
              "exp": exp if exp > now else 0, "msg": str(b.get("msg") or "")[:2000], "notify": notify, "ctype": ctype,
              "updated": now})
    a.setdefault("created", now)
    a.setdefault("fired", 0)
    a.setdefault("last", 0)
    a.pop("done_syms", None)
    if not old or b.get("restart"):
        a["status"] = "active"
    elif a.get("status") in ("triggered", "expired"):
        a["status"] = "active"                          # saving an edit starts a finished alert again, as on TradingView
    return a


# ================================================================ words
def src_label(s: dict) -> str:
    if not s:
        return ""
    k = s["k"]
    if k == "value":
        return _fmt(s["v"])
    if k == "price":
        return {"last": "Price", "bid": "Bid", "ask": "Ask"}[s["f"]]
    if k == "bar":
        return {"volume": "Volume"}.get(s["f"], s["f"].capitalize())
    if k == "pine":
        what = s.get("plot") or s.get("ac") or ("any alert() call" if s.get("any") else "")
        return f"{s['name']}: {what}"
    if k == "ind":
        name = IND[s["t"]][0]
        args = ", ".join(str(v) for v in s.get("p", {}).values())
        return f"{name}{f' ({args})' if args else ''}{'' if len(IND[s['t']][2]) == 1 else ': ' + s['out']}"
    if k == "draw":
        return s.get("name") or "Drawing" + ("" if s["edge"] == "v" else f" ({s['edge']})")
    if k == "pf":
        return {"buy": "P&F buy signal", "sell": "P&F sell signal"}.get(s["sig"], f"P&F {s['sig']}")
    return "?"


def cond_text(c: dict) -> str:
    op, a = c["op"], src_label(c["a"])
    if op == "true":
        return f"{a}"
    if op in TWO:
        return f"{a} {OPS[op].lower()} {src_label(c['b'])}"
    if op in CHAN:
        return f"{a} {OPS[op].lower()} {src_label(c['lo'])} – {src_label(c['hi'])}"
    unit = "%" if op.endswith("pct") else ""
    return f"{a} {OPS[op].lower().replace(' %', '')} {_fmt(c['amt'])}{unit} in {c['bars']} bar{'s' if c['bars'] > 1 else ''}"


def describe(a: dict) -> str:
    tgt = a["target"].get("s", "").split(":")[-1] if a["target"].get("s") else a["target"].get("wl_name", "Watchlist")
    j = " and " if a.get("join") != "any" else " or "
    return f"{tgt}: " + j.join(cond_text(c) for c in a["conds"])


def _fmt(v) -> str:
    if v is None:
        return "–"
    try:
        v = float(v)
    except (TypeError, ValueError):
        return str(v)
    if abs(v) >= 1000:
        return f"{v:,.2f}".rstrip("0").rstrip(".")
    return f"{v:.6g}" if abs(v) < 1 else f"{v:.4f}".rstrip("0").rstrip(".")


def _plain(v) -> str:
    """A number in a message: no thousands separators, so a webhook's JSON stays valid (as TradingView's {{close}})."""
    if v is None:
        return ""
    try:
        v = float(v)
    except (TypeError, ValueError):
        return str(v)
    if not math.isfinite(v):
        return ""
    return ("%.8f" % v).rstrip("0").rstrip(".") if v != int(v) else str(int(v))


def _iso(ts) -> str:
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ist(ts, sec=True) -> str:
    return dt.datetime.fromtimestamp(ts + IST, dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S" if sec else "%Y-%m-%d %H:%M")


# ================================================================ webhooks: public addresses only
def _public_host(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        return False
    for i in infos:
        ip = ipaddress.ip_address(i[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
            return False
    return True


ALLOW_PRIVATE = os.environ.get("FTM_WEBHOOK_PRIVATE") == "1"      # the test kit's own receiver (localhost)


def webhook(url: str, text: str) -> str:
    """POST the message (JSON when it is JSON, else plain text), as TradingView does. Returns "" or what went wrong."""
    import httpx
    p = urllib.parse.urlsplit(url)
    if not ALLOW_PRIVATE and not _public_host(p.hostname or ""):
        return "refused: the address is private or unknown"
    ctype = "text/plain; charset=utf-8"
    try:
        json.loads(text)
        ctype = "application/json"
    except Exception:
        pass
    try:
        r = httpx.post(url, content=text.encode(), headers={"Content-Type": ctype, "User-Agent": "FyersTradeManager-alerts"},
                       timeout=8, follow_redirects=False)
        return "" if r.status_code < 400 else f"HTTP {r.status_code}"
    except Exception as e:
        return str(e)[:160]


# ================================================================ the user's alerts
class Sess:
    """A Pine runner session: one symbol + timeframe + chart type (+ a script with its inputs)."""

    def __init__(self, key, sym, tfk, spec, series, code=False):
        self.key, self.sym, self.tfk, self.spec, self.series, self.code = key, sym, tfk, spec, series, code
        self.tail = TAIL
        self.out = None
        self.err = ""
        self.open = False
        self.opening = False
        self.busy = False
        self.dirty = False
        self.ver = -1
        self.sent_t = 0
        self.last = 0.0
        self.took = 0
        self.refs: set = set()          # (alert id, symbol)
        self.full_due = 0               # bar time a full run was asked for (bar close)


class Book:
    def __init__(self, urt):
        self.urt = urt
        self.uid = urt.uid
        self.dir = urt.dir
        d = store.load(self.dir + "alerts.json", {"alerts": []})
        self.alerts: list = [a for a in (d.get("alerts") or []) if isinstance(a, dict) and a.get("id")]
        self.st: dict = {}              # (alert id, symbol) -> runtime state
        self.series: dict = {}          # (symbol, tf) -> Series
        self.sess: dict = {}            # key -> Sess
        self.want: dict = {}            # (alert id, symbol) -> {"keys": {cond i: {src role: key}}, "bars": {tf: key}}
        self.hl: dict = {}              # symbol -> (day high, day low) at the previous tick
        self.loop = None
        self.task = None
        self.notes: dict = {}           # alert id -> a note for the page ("waiting for ...")
        self.dirty_save = False
        self.unwatched: list = []
        self._wl_cache = (0.0, {})

    # ------------------------------------------------------------ storage
    def save(self):
        store.save(self.dir + "alerts.json", {"alerts": self.alerts})

    def log_add(self, e: dict):
        p = store.path(self.dir + "alerts_log.jsonl")
        with open(p, "a", encoding="utf-8") as f:
            f.write(json.dumps(e, separators=(",", ":")) + "\n")
        try:
            if p.stat().st_size > 2_000_000:
                lines = p.read_text(encoding="utf-8").splitlines()[-LOG_KEEP:]
                p.write_text("\n".join(lines) + "\n", encoding="utf-8")
        except Exception:
            pass

    def read_log(self, n: int = 300) -> list:
        p = store.path(self.dir + "alerts_log.jsonl")
        if not p.exists():
            return []
        out = []
        for line in p.read_text(encoding="utf-8").splitlines()[-n:]:
            try:
                out.append(json.loads(line))
            except Exception:
                pass
        return out[::-1]

    def clear_log(self):
        p = store.path(self.dir + "alerts_log.jsonl")
        if p.exists():
            p.unlink()

    def get(self, aid):
        return next((a for a in self.alerts if a["id"] == aid), None)

    # ------------------------------------------------------------ what the page sees
    def public(self, a: dict) -> dict:
        x = {k: v for k, v in a.items() if k != "conds"}
        conds = []
        for c in a["conds"]:
            cc = json.loads(json.dumps(c))
            for k in ("a", "b", "lo", "hi"):
                if cc.get(k, {}).get("k") == "pine":
                    cc[k].pop("libs", None)                 # (big; the page keeps its own copy of the code)
            conds.append(cc)
        x["conds"] = conds
        x["text"] = describe(a)
        x["conds_text"] = [cond_text(c) for c in a["conds"]]
        x["tech"] = is_tech(a)
        x["note"] = self.notes.get(a["id"], "")
        x["syms"] = self.symbols_of(a)[:200]
        return x

    def summary(self) -> dict:
        try:
            on = set(self.urt.feed.wanted())
            self.unwatched = [s for s in self.symbols() if s not in on]
        except Exception:
            pass
        return {"alerts": [self.public(a) for a in self.alerts], "limits": {"alerts": MAX_ALERTS, "tech": MAX_TECH, "conds": MAX_CONDS,
                "wl": MAX_WL, "syms": MAX_SYMS}, "counts": self.counts(), "runner": {"ok": RUNNER.ok(), "err": RUNNER.err,
                "node": RUNNER.version or "", "sessions": len(self.sess)}, "unwatched": self.unwatched,
                "ind": {k: {"name": v[0], "params": [list(p) for p in v[1]], "outs": v[2]} for k, v in IND.items()},
                "ops": OPS, "freqs": FREQS}

    def counts(self) -> dict:
        live = [a for a in self.alerts if a.get("status") == "active"]
        return {"all": len(self.alerts), "active": len(live), "tech": sum(len(self.symbols_of(a)) for a in live if is_tech(a)),
                "wl": sum(1 for a in self.alerts if a["target"].get("wl"))}

    # ------------------------------------------------------------ symbols
    def watchlists(self) -> dict:
        t, d = self._wl_cache
        if _now() - t < 5:
            return d
        p = store.load(self.dir + "prefs.json", {})
        out = {}
        for wl in p.get("wlists") or []:
            if isinstance(wl, dict) and wl.get("id"):
                out[wl["id"]] = {"name": wl.get("name") or "", "syms": [i.get("s") for i in wl.get("items") or [] if isinstance(i, dict) and i.get("s")]}
        if not out and isinstance(p.get("watch"), list):
            out["w1"] = {"name": "Watchlist", "syms": [i.get("s") for i in p["watch"] if isinstance(i, dict) and i.get("s")]}
        self._wl_cache = (_now(), out)
        return out

    def symbols_of(self, a: dict) -> list:
        if a["target"].get("s"):
            return [a["target"]["s"]]
        wl = self.watchlists().get(a["target"].get("wl"))
        return list(dict.fromkeys(wl["syms"]))[:MAX_SYMS] if wl else []

    def symbols(self) -> list:
        """What the alerts need on the price socket (helper/feed.py adds these after the open pages' own)."""
        out = []
        for a in self.alerts:
            if a.get("status") == "active":
                for s in self.symbols_of(a):
                    if s not in out:
                        out.append(s)
        return out[:MAX_SYMS]

    # ------------------------------------------------------------ changes from the page
    def upsert(self, b: dict) -> dict:
        old = self.get(b.get("id")) if b.get("id") else None
        if old:
            _keep_libs(b, old)
        a = clean(b, old)
        others = [x for x in self.alerts if x["id"] != a["id"]]
        if len(others) >= MAX_ALERTS:
            raise Bad(f"at most {MAX_ALERTS} alerts: delete some first")
        if a["target"].get("wl") and sum(1 for x in others if x["target"].get("wl")) >= MAX_WL:
            raise Bad(f"at most {MAX_WL} watchlist alerts")
        if a["status"] == "active" and is_tech(a):
            used = sum(len(self.symbols_of(x)) for x in others if x.get("status") == "active" and is_tech(x))
            if used + len(self.symbols_of(a)) > MAX_TECH:
                raise Bad(f"at most {MAX_TECH} technical alerts running at once (each symbol of a watchlist alert counts): pause some first")
        if a["target"].get("wl") and not self.symbols_of(a):
            raise Bad("that watchlist is empty")
        self._disarm(a["id"])
        if old:
            self.alerts[self.alerts.index(old)] = a
        else:
            self.alerts.append(a)
        self.notes.pop(a["id"], None)
        self.save()
        self._arm(a)
        self._feed_changed()
        return a

    def set_level(self, aid: str, ci, role: str, v) -> dict:
        """A 🔔 line dragged on the chart: one number of one condition changes (the rest as stored)."""
        a = self.get(aid)
        if not a:
            raise Bad("no such alert")
        try:
            c = a["conds"][int(ci)]
        except (TypeError, ValueError, IndexError):
            raise Bad("no such condition")
        if role not in ("b", "lo", "hi") or (c.get(role) or {}).get("k") != "value":
            raise Bad("that level isn't a number")
        b = json.loads(json.dumps(a))
        b["conds"][int(ci)][role] = {"k": "value", "v": _num(v)}
        return self.upsert(b)

    def action(self, aid: str, do: str) -> dict | None:
        a = self.get(aid)
        if not a:
            raise Bad("no such alert")
        if do == "delete":
            self._disarm(aid)
            self.alerts.remove(a)
            self.save()
            self._feed_changed()
            return None
        if do == "clone":
            b = json.loads(json.dumps(a))
            b.pop("id", None)
            b["name"] = (a["name"] + " (copy)")[:100]
            return self.upsert(b)
        if do == "pause":
            a["status"] = "paused"
            self._disarm(aid)
        elif do in ("resume", "restart"):
            if is_tech(a):
                used = sum(len(self.symbols_of(x)) for x in self.alerts if x is not a and x.get("status") == "active" and is_tech(x))
                if used + len(self.symbols_of(a)) > MAX_TECH:
                    raise Bad(f"at most {MAX_TECH} technical alerts running at once: pause some first")
            if a.get("exp") and a["exp"] <= _now():
                a["exp"] = 0
            a["status"] = "active"
            a.pop("done_syms", None)
            self._disarm(aid)
            self._arm(a)
        else:
            raise Bad("unknown action")
        a["updated"] = int(_now())
        self.save()
        self._feed_changed()
        return a

    def _feed_changed(self):
        try:
            self.urt.feed._resync()
        except Exception:
            pass

    # ------------------------------------------------------------ sessions
    def _bars_key(self, sym, tfk, ct):
        return "B|" + hashlib.sha1(json.dumps([self.uid, sym, tfk, ct], sort_keys=True).encode()).hexdigest()[:20]

    def _code_key(self, sym, tfk, ct, src):
        code, inputs, props = self._code_of(src)
        return "P|" + hashlib.sha1(json.dumps([self.uid, sym, tfk, ct, code, inputs, props], sort_keys=True).encode()).hexdigest()[:20]

    @staticmethod
    def _code_of(src):
        if src["k"] == "ind":
            return ind_code(src["t"], src["p"])[0], {}, {}
        return src["code"], src.get("inputs") or {}, src.get("props") or {}

    def _ctype_for(self, a, sym, tfk) -> dict:
        """The alert's chart type for one symbol: boxes typed for that contract (fixed sizes), else ATR, as the chart."""
        ct = a.get("ctype") or {"type": "candles", "opts": {}}
        o = dict(ct.get("opts") or {})
        row = symbols.get(sym) or {}
        root = row.get("u") or sym
        res = {"type": ct.get("type", "candles"), "pfInd": ct.get("pfInd", "mid"), "tick": row.get("tick") or 0.05, "opts": {}}
        for k in ("renkoAtr", "renkoSrc", "renkoWicks", "rangeAtr", "lbLines", "pfAtr", "pfRev", "pfSrc"):
            if k in o:
                res["opts"][k] = o[k]
        rb = (o.get("renkoBox") or {}).get(root) if isinstance(o.get("renkoBox"), dict) else None
        res["opts"]["renkoMode"] = "fixed" if o.get("renkoMode") == "fixed" and rb else "atr"
        res["opts"]["renkoBox"] = rb
        rs = (o.get("rangeSize") or {}).get(root) if isinstance(o.get("rangeSize"), dict) else None
        res["opts"]["rangeMode"] = "fixed" if o.get("rangeMode") == "fixed" and rs else "atr"
        res["opts"]["rangeSize"] = rs
        pb = None
        if o.get("pfMode") == "fixed" and isinstance(o.get("pfBox"), dict):
            pb = o["pfBox"].get(f"{root}@{tfk}") or o["pfBox"].get(root)
        res["opts"]["pfBox"] = pb
        res["hideNoTrade"] = ct.get("hideNoTrade", True)
        return res

    def _info(self, sym) -> dict:
        r = symbols.get(sym) or {}
        tk = sym.split(":")[-1]
        tick = r.get("tick") or 0.05
        return {"ticker": tk, "tickerid": sym, "prefix": sym.split(":")[0], "root": r.get("u") or tk, "description": r.get("d") or tk,
                "type": "option" if r.get("f") == "OPT" else "futures" if r.get("f") == "FUT" else "stock", "timezone": "Asia/Kolkata",
                "mintick": tick, "minmove": 1, "pricescale": round(1 / tick) if tick else 100, "pointvalue": r.get("mult") or 1,
                "currency": "USD" if is_mt5(sym) else "INR", "country": "IN", "session": r.get("sess") or "", "current_contract": sym,
                "main_tickerid": sym, "isin": "", "basecurrency": "", "mincontract": r.get("lot") or 1, "volumetype": "base"}

    def _series(self, sym, tfk) -> Series:
        k = (sym, tfk)
        s = self.series.get(k)
        if s is None:
            s = self.series[k] = Series(sym, tfk)
        return s

    def _sess_for(self, key, sym, tfk, ct, src=None) -> Sess:
        se = self.sess.get(key)
        if se:
            return se
        ser = self._series(sym, tfk)
        ser.drop = ct.get("hideNoTrade", True)
        spec = {"ctype": {"type": ct["type"], "opts": ct["opts"], "tick": ct["tick"], "pfInd": ct["pfInd"]},
                "barSec": ser.plan["sec"], "drawSec": self._draw_sec(ser.plan), "ticker": sym, "tf": pine_tf(tfk), "info": self._info(sym)}
        if src is not None:
            code, inputs, props = self._code_of(src)
            spec.update(code=code, inputs=inputs, props=props or None, libs=src.get("libs") or {}, missing=src.get("missing") or [])
        else:
            spec.update(pf=ct["type"] == "pf", draws=[])
        se = self.sess[key] = Sess(key, sym, tfk, spec, ser, code=src is not None)
        return se

    @staticmethod
    def _draw_sec(plan):
        t = plan["t"]
        return 604800 * t["n"] if t["u"] == "W" else 2629800 * t["n"] if t["u"] == "M" else plan["sec"]

    def _arm(self, a: dict):
        if a.get("status") != "active":
            return
        for sym in self.symbols_of(a):
            self._arm_sym(a, sym)
        self._kick()

    def _arm_sym(self, a, sym):
        w = {"keys": {}, "bars": {}}
        for i, c in enumerate(a["conds"]):
            tfk = c["tf"]
            ct = self._ctype_for(a, sym, tfk)
            tm = tick_mode(c, a["freq"])
            needs_bars = not tm or any((c.get(k) or {}).get("k") == "draw" for k in ("b", "lo", "hi"))
            if needs_bars:                                  # (a price against numbers needs nothing but ticks)
                bk = self._bars_key(sym, tfk, ct)
                se = self._sess_for(bk, sym, tfk, ct)
                se.refs.add((a["id"], sym))
                w["bars"][tfk] = bk
            w["keys"][i] = {}
            for role in ("a", "b", "lo", "hi"):
                s = c.get(role)
                if not s:
                    continue
                if s["k"] in ("pine", "ind"):
                    k = self._code_key(sym, tfk, ct, s)
                    se = self._sess_for(k, sym, tfk, ct, s)
                    se.refs.add((a["id"], sym))
                    if c["op"] in MOVE:
                        se.tail = max(se.tail, c["bars"] + 3)
                    w["keys"][i][role] = k
                elif s["k"] in ("bar", "draw", "pf", "price"):
                    w["keys"][i][role] = w["bars"].get(tfk)
                    if c["op"] in MOVE and w["bars"].get(tfk):
                        self.sess[w["bars"][tfk]].tail = max(self.sess[w["bars"][tfk]].tail, c["bars"] + 3)
        self.want[(a["id"], sym)] = w
        st = self.st.setdefault((a["id"], sym), {"prev": {}, "bar": None, "at": 0.0, "done": False, "closed": None, "calls": set()})
        t = (getattr(self.urt.feed, "last", None) or {}).get(sym)
        if t:                                       # tick conditions start from the price when the alert is set (TradingView's way)
            for i, c in enumerate(a["conds"]):
                if tick_mode(c, a["freq"]) and i not in st["prev"]:
                    f = c["a"].get("f", "last")
                    v = t.get("ltp") if f == "last" else (t.get(f) or t.get("ltp"))
                    if v is not None:
                        st["prev"][i] = v
        if any((c.get(r) or {}).get("k") == "draw" for c in a["conds"] for r in ("a", "b", "lo", "hi")):
            self._draws_sync(sym)

    def _disarm(self, aid: str):
        for k in [k for k in self.want if k[0] == aid]:
            self.want.pop(k, None)
            self.st.pop(k, None)
        for key, se in list(self.sess.items()):
            se.refs = {r for r in se.refs if r[0] != aid}
            if not se.refs:
                self.sess.pop(key, None)
                if se.open:
                    RUNNER.close(key)
        used = {(se.sym, se.tfk) for se in self.sess.values()}
        for k in list(self.series):
            if k not in used:
                self.series.pop(k, None)

    def arm_all(self):
        for a in self.alerts:
            self._arm(a)

    # ------------------------------------------------------------ drawings
    def _draws_sync(self, sym: str):
        """The drawings alerts on this contract use -> its bars sessions (the alert follows a drawing that moves)."""
        from . import jreplay
        d = store.load(jreplay.draw_file(self.dir, sym), {"items": []})
        items = {x.get("id"): x for x in (d.get("items") or []) if isinstance(x, dict)}
        used = set()
        for (aid, s), w in self.want.items():
            if s != sym:
                continue
            a = self.get(aid)
            for c in a["conds"] if a else []:
                for role in ("a", "b", "lo", "hi"):
                    x = c.get(role)
                    if x and x["k"] == "draw":
                        used.add(x["id"])
                        if x["id"] not in items:
                            self.notes[aid] = f'the drawing "{x.get("name")}" was deleted: edit or delete this alert'
        draws = [{"id": i, "type": items[i].get("type"), "pts": items[i].get("pts") or [], "st": items[i].get("st") or {}}
                 for i in used if i in items and items[i].get("type") in DRAW_TYPES]
        for se in self.sess.values():
            if se.sym == sym and not se.code:
                if se.spec.get("draws") != draws:
                    se.spec["draws"] = draws
                    if se.open:
                        asyncio.get_running_loop().create_task(self._send_draws(se))

    async def _send_draws(self, se: Sess):
        r = await RUNNER.call(self.uid, {"op": "draws", "key": se.key, "draws": se.spec.get("draws") or []})
        if r.get("ok"):
            self._took(se, r["out"])

    def drawings_changed(self, sym: str):
        if any(s == sym for (_, s) in self.want):
            try:
                self._draws_sync(sym)
            except Exception as e:
                log.warning("[%s] alert drawings: %s", self.urt.label, e)

    # ------------------------------------------------------------ ticks
    def on_tick(self, t: dict):
        s = t.get("s")
        if not s:
            return
        for (sym, _), ser in self.series.items():
            if sym == s and ser.apply_tick(t):
                for se in self.sess.values():
                    if se.series is ser:
                        se.dirty = True
        hl = self.hl.get(s)
        h, low = t.get("h"), t.get("l")
        sweep = None
        if hl and h is not None and low is not None:
            sweep = (hl[0], h, hl[1], low)
        if h is not None and low is not None:
            self.hl[s] = (h, low)
        for (aid, sym), w in list(self.want.items()):
            if sym != s:
                continue
            a = self.get(aid)
            if not a or a.get("status") != "active" or a["freq"] == "close":
                continue
            if not any(tick_mode(c, a["freq"]) for c in a["conds"]):
                continue
            try:
                self._eval(a, sym, w, tick=t, sweep=sweep)
            except Exception as e:
                log.exception("[%s] alert %s: %s", self.urt.label, aid, e)

    # ------------------------------------------------------------ values
    def _val(self, src: dict, key, o: int, tick=None):
        """A source's value o bars back (0 = the latest bar) from its session's latest numbers."""
        k = src["k"]
        if k == "value":
            return src["v"]
        if k == "price" and o == 0 and tick is not None:
            f = src.get("f", "last")
            v = tick.get("ltp") if f == "last" else tick.get(f)
            return v if v else tick.get("ltp")
        se = self.sess.get(key) if key else None
        out = se.out if se else None
        if not out:
            return None
        arr = None
        if k in ("price", "bar"):
            f = "close" if k == "price" else src["f"]
            b = out.get("bars") or {}
            if f in ("hl2", "hlc3", "ohlc4"):
                n = len(b.get("close") or [])
                if n <= o:
                    return None
                i = n - 1 - o
                hi, lo, cl, op = b["high"][i], b["low"][i], b["close"][i], b["open"][i]
                return (hi + lo) / 2 if f == "hl2" else (hi + lo + cl) / 3 if f == "hlc3" else (op + hi + lo + cl) / 4
            arr = b.get(f)
        elif k == "pine":
            arr = (out.get("acs") or {}).get(src["ac"]) if "ac" in src else (out.get("plots") or {}).get(src.get("plot"))
        elif k == "ind":
            arr = (out.get("plots") or {}).get(src["out"])
        elif k == "draw":
            arr = ((out.get("draws") or {}).get(src["id"]) or {}).get(src["edge"])
        elif k == "pf":
            arr = (out.get("pf") or {}).get(src["sig"])
        if not arr or len(arr) <= o:
            return None
        v = arr[len(arr) - 1 - o]
        return v if isinstance(v, (int, float)) and math.isfinite(v) else None

    def _truth(self, a, c, i, w, o: int, tick=None, sweep=None, prev=None):
        """True / False, or None while a value isn't known yet."""
        keys = w["keys"].get(i, {})
        g = lambda role, off: self._val(c[role], keys.get(role), off, tick)
        op = c["op"]
        tm = tick is not None and tick_mode(c, a["freq"])
        if op == "true":
            v = g("a", o)
            return None if v is None else v != 0
        if op in MOVE:
            a0, an = g("a", o), g("a", o + c["bars"])
            if a0 is None or an is None:
                return None
            d = a0 - an if op in ("up", "up_pct") else an - a0
            if op.endswith("pct"):
                return an != 0 and d / abs(an) * 100 >= c["amt"]
            return d >= c["amt"]
        a0 = g("a", o)
        if a0 is None:
            return None
        if tm:
            a1 = prev                                       # the previous tick
            hi_s = lo_s = None
            if sweep and c["a"].get("f", "last") == "last":
                if sweep[1] > sweep[0]:
                    hi_s = sweep[1]                         # a trade above the old day high since the last snapshot
                if sweep[3] < sweep[2]:
                    lo_s = sweep[3]
        else:
            a1 = g("a", o + 1)
            hi_s = lo_s = None
        if op in TWO:
            b0 = g("b", o)
            b1 = b0 if tm else g("b", o + 1)
            if b0 is None:
                return None
            if op == "gt":
                return a0 > b0 or (hi_s is not None and hi_s > b0)
            if op == "lt":
                return a0 < b0 or (lo_s is not None and lo_s < b0)
            if a1 is None or b1 is None:
                return False
            up = (a1 < b1 and a0 >= b0) or (hi_s is not None and a1 < b1 and hi_s >= b0)
            dn = (a1 > b1 and a0 <= b0) or (lo_s is not None and a1 > b1 and lo_s <= b0)
            return up if op == "cross_up" else dn if op == "cross_dn" else (up or dn)
        if op in CHAN:
            L0, H0 = g("lo", o), g("hi", o)
            if L0 is None or H0 is None:
                return None
            if L0 > H0:
                L0, H0 = H0, L0
            if op == "inside":
                return L0 < a0 < H0
            if op == "outside":
                return a0 > H0 or a0 < L0 or (hi_s is not None and hi_s > H0) or (lo_s is not None and lo_s < L0)
            L1, H1 = (L0, H0) if tm else (g("lo", o + 1), g("hi", o + 1))
            if a1 is None or L1 is None or H1 is None:
                return False
            if L1 > H1:
                L1, H1 = H1, L1
            was_in = L1 <= a1 <= H1
            now_in = L0 <= a0 <= H0
            if op == "enter":
                swept = (a1 > H1 and lo_s is not None and lo_s <= H0) or (a1 < L1 and hi_s is not None and hi_s >= L0)
                return (not was_in and now_in) or (not was_in and swept)
            swept = was_in and ((hi_s is not None and hi_s > H0) or (lo_s is not None and lo_s < L0))
            return (was_in and not now_in) or swept
        return None

    def _eval(self, a, sym, w, tick=None, sweep=None, closed_o=None, out_key=None):
        """Work out the alert for one symbol now; fire it if its trigger allows."""
        st = self.st.setdefault((a["id"], sym), {"prev": {}, "bar": None, "at": 0.0, "done": False, "closed": None, "calls": set()})
        if st["done"]:
            return
        if tick is None:
            tick = (self.urt.feed.last or {}).get(sym)
            live_tick = False
        else:
            live_tick = True
        res = []
        for i, c in enumerate(a["conds"]):
            tm = tick_mode(c, a["freq"])
            if tm and not live_tick:
                # a tick condition between ticks: a crossing happens at a tick; "greater than" / "inside" hold now
                if c["op"] in ("gt", "lt", "inside", "outside") and tick:
                    res.append(self._truth(a, c, i, w, 0, tick=tick))
                else:
                    res.append(False)
                continue
            if tm:
                f = c["a"].get("f", "last")
                now = tick.get("ltp") if f == "last" else (tick.get(f) or tick.get("ltp"))
                prev = st["prev"].get(i)
                if prev is not None:
                    r = self._truth(a, c, i, w, 0, tick=tick, sweep=sweep, prev=prev)
                elif now is None:
                    r = None
                elif c["op"] in ("gt", "lt", "inside", "outside"):
                    r = self._truth(a, c, i, w, 0, tick=tick)      # a state: true already counts
                else:
                    r = False                                       # the first tick: a crossing needs a move from here
                if now is not None:
                    st["prev"][i] = now
                res.append(r)
                continue
            o = 0
            if closed_o is not None and c["tf"] == a["conds"][0]["tf"]:
                o = closed_o
            res.append(self._truth(a, c, i, w, o, tick=None if closed_o is not None else tick))
        if any(r is None for r in res) and a["join"] == "all":
            self._note_waiting(a, sym, w)
            return
        ok = all(bool(r) for r in res) if a["join"] == "all" else any(bool(r) for r in res)
        if self.notes.get(a["id"], "").startswith("waiting"):
            self.notes.pop(a["id"], None)
        if not ok:
            return
        now = _now()
        main = w["bars"].get(a["conds"][0]["tf"])
        bar_t = self._bar_time(main, sym, a["conds"][0]["tf"], tick, closed_o)
        f = a["freq"]
        if f == "bar" and st["bar"] == bar_t:
            return
        if f == "minute" and now - st["at"] < 60:
            return
        if f == "close" and closed_o is None:
            return
        st["bar"], st["at"] = bar_t, now
        self._fire(a, sym, w, tick, bar_t, closed_o)

    def _bar_time(self, key, sym, tfk, tick, closed_o):
        se = self.sess.get(key) if key else None
        if se and se.out and se.out.get("times"):
            ts = se.out["times"]
            i = len(ts) - 1 - (closed_o or 0)
            if i >= 0:
                return ts[i]
        try:
            ts = int(float((tick or {}).get("t") or _now())) + IST
        except (TypeError, ValueError):
            ts = int(_now()) + IST
        return bucket(ts, tf_plan(tfk), is_mt5(sym), _sess(symbols.get(sym) or {})[0])

    def _note_waiting(self, a, sym, w):
        why = ""
        for key in [k for d in w["keys"].values() for k in d.values() if k] + list(w["bars"].values()):
            se = self.sess.get(key)
            if not se:
                continue
            if se.err:
                why = se.err
                break
            if se.series.err:
                why = se.series.err
                break
            if not se.out:
                why = "loading its candles"
        if not why and RUNNER.err:
            why = RUNNER.err
        self.notes[a["id"]] = "waiting: " + (why or "for prices")

    # ------------------------------------------------------------ firing
    def _ctx(self, a, sym, w, tick, bar_t, closed_o):
        main = self.sess.get(w["bars"].get(a["conds"][0]["tf"]) or "")
        out = (main.out if main else None) or {}
        b = out.get("bars") or {}
        o = closed_o or 0
        i = len(b.get("close") or []) - 1 - o
        bar = {k: (b[k][i] if i >= 0 and b.get(k) else None) for k in ("open", "high", "low", "close", "volume")}
        if not out and tick:
            bar["close"] = tick.get("ltp")
        plots, titles = {}, []
        for c in a["conds"]:
            if c["a"]["k"] in ("pine", "ind"):
                k = w["keys"].get(a["conds"].index(c), {}).get("a")
                se = self.sess.get(k or "")
                if se and se.out:
                    titles = se.out.get("titles") or list((se.out.get("plots") or {}).keys())
                    for t_ in titles:
                        arr = (se.out.get("plots") or {}).get(t_) or []
                        plots[t_] = arr[len(arr) - 1 - o] if len(arr) > o else None
                break
        row = symbols.get(sym) or {}
        return {"sym": sym, "row": row, "bar": bar, "tick": tick or {}, "bar_t": bar_t, "plots": plots, "titles": titles,
                "tf": a["conds"][0]["tf"]}

    def render(self, tpl: str, a: dict, ctx: dict) -> str:
        sym, row, bar, tick = ctx["sym"], ctx["row"], ctx["bar"], ctx["tick"]
        now = _now()
        bt = (ctx.get("bar_t") or (now + IST)) - IST
        fixed = {"ticker": sym.split(":")[-1], "exchange": sym.split(":")[0], "symbol": sym, "description": row.get("d") or sym.split(":")[-1],
                 "interval": pine_tf(ctx["tf"]), "open": _plain(bar.get("open")), "high": _plain(bar.get("high")), "low": _plain(bar.get("low")),
                 "close": _plain(bar.get("close") if bar.get("close") is not None else tick.get("ltp")), "volume": _plain(bar.get("volume")),
                 "bid": _plain(tick.get("bid")), "ask": _plain(tick.get("ask")), "last": _plain(tick.get("ltp")),
                 "time": _iso(bt), "timenow": _iso(now), "time_ist": _ist(bt), "timenow_ist": _ist(now), "name": a.get("name", ""),
                 "condition": describe(a)}

        def rep(m):
            k = m.group(1).strip()
            if k in fixed:
                return fixed[k]
            mm = re.match(r"^plot_(\d+)$", k)
            if mm:
                i = int(mm.group(1))
                return _plain(ctx["plots"].get(ctx["titles"][i])) if i < len(ctx["titles"]) else ""
            mm = re.match(r'^plot\(\s*["\'](.+?)["\']\s*\)$', k)
            if mm:
                return _plain(ctx["plots"].get(mm.group(1)))
            return m.group(0)
        return re.sub(r"\{\{\s*([^{}]+?)\s*\}\}", rep, tpl or "")

    def _fire(self, a, sym, w, tick, bar_t, closed_o, call_msg: str | None = None):
        ctx = self._ctx(a, sym, w, tick, bar_t, closed_o)
        tpl = a.get("msg") or ""
        if call_msg is not None and not tpl.strip():
            tpl = call_msg
        if not tpl.strip():
            c0 = a["conds"][0]
            if c0["a"]["k"] == "pine" and "ac" in c0["a"]:
                se = self.sess.get(w["keys"].get(0, {}).get("a") or "")
                tpl = ((se.out or {}).get("acMsg") or {}).get(c0["a"]["ac"], "") if se else ""
        if not tpl.strip():                             # no message typed: the condition and the price, as people read them
            px0 = ctx["bar"].get("close") if closed_o is not None or not tick else tick.get("ltp")
            text = f"{sym.split(':')[-1]}: " + (" or " if a.get("join") == "any" else " and ").join(cond_text(c) for c in a["conds"]) + \
                (f" · {_fmt(px0)}" if px0 is not None else "")
        else:
            text = self.render(tpl, a, ctx)
        if call_msg is not None and a.get("msg"):
            text = text.replace("{{message}}", call_msg)
        now = _now()
        px = ctx["bar"].get("close") if closed_o is not None or not tick else tick.get("ltp")
        e = {"id": secrets.token_hex(5), "aid": a["id"], "name": a.get("name") or describe(a), "s": sym, "msg": text, "t": round(now, 1),
             "px": px, "tf": a["conds"][0]["tf"], "freq": a["freq"], "sound": a["notify"].get("sound", "chime"),
             "popup": a["notify"].get("popup", True), "wl": a["target"].get("wl_name") or ""}
        a["fired"] = int(a.get("fired", 0)) + 1
        a["last"] = int(now)
        if a["freq"] == "once":
            if a["target"].get("wl"):
                self.st[(a["id"], sym)]["done"] = True     # each symbol of a watchlist once; the alert stays on
                a.setdefault("done_syms", [])
                if sym not in a["done_syms"]:
                    a["done_syms"].append(sym)
                if all(s in a["done_syms"] for s in self.symbols_of(a)):
                    a["status"] = "triggered"
            else:
                a["status"] = "triggered"
                self._disarm(a["id"])
                self._feed_changed()
        self.save()
        self.log_add(e)
        log.info("[%s] Alert %r fired on %s: %s", self.urt.label, e["name"], sym, text[:200])
        try:
            self.urt.feed.broadcast({"calert": e, "calerts": self.counts()})
        except Exception:
            pass
        self.deliver(a, e)

    def deliver(self, a: dict, e: dict, test: bool = False):
        """Telegram, phone push and the webhook, off the event loop."""
        nt = a.get("notify") or {}
        loop = asyncio.get_running_loop()

        def go():
            res = {}
            short = e["s"].split(":")[-1]
            if nt.get("tg"):
                txt = (f"🔔 <b>{telegram.esc(e['name'])}</b>{' (test)' if test else ''}\n{telegram.esc(e['msg'])}\n"
                       f"<i>{telegram.esc(short)} · {telegram.esc(e['tf'])} · {telegram.esc(_fmt(e.get('px')))} · {_ist(e['t'])[11:]} IST</i>")
                res["tg"] = telegram.send_user(self.uid, txt, who="alerts")
            if nt.get("push"):
                try:
                    res["push"] = webpush.send(self.uid, {"title": f"🔔 {e['name']}"[:120], "body": e["msg"][:600],
                                                          "tag": "a-" + a["id"], "url": "/#alerts", "t": e["t"], "s": e["s"], "test": test})
                except Exception as ex:
                    res["push"] = {"error": str(ex)[:160]}
            if nt.get("webhook"):
                res["webhook"] = webhook(nt["webhook"], e["msg"]) or "ok"
                if res["webhook"] != "ok":
                    log.warning("[%s] alert webhook: %s", self.urt.label, res["webhook"])
            return res
        fut = loop.run_in_executor(None, go)
        return fut

    # ------------------------------------------------------------ the loop: bars to Node, bar closes, expiry
    def start(self, loop):
        self.loop = loop
        if self.task is None:
            self.task = loop.create_task(self._pump())
        if self._runner_restarted not in _restart_cbs:
            _restart_cbs.append(self._runner_restarted)
        self.arm_all()

    def stop(self):
        if self.task:
            self.task.cancel()
            self.task = None
        for key in list(self.sess):
            RUNNER.close(key)
        self.sess.clear()
        self.series.clear()
        try:
            _restart_cbs.remove(self._runner_restarted)
        except ValueError:
            pass

    def _runner_restarted(self):
        for se in self.sess.values():
            se.open = False
            se.busy = False

    def _kick(self):
        pass                                                # (the loop below picks new sessions up within 0.25 s)

    async def _pump(self):
        n = 0
        while True:
            try:
                await asyncio.sleep(0.25)
                n += 1
                await self._step(n)
            except asyncio.CancelledError:
                return
            except Exception as e:
                log.exception("[%s] alerts: %s", self.urt.label, e)
                await asyncio.sleep(2)

    async def _step(self, n: int):
        now = _now()
        # history for new series (one at a time per user: Fyers' data budget is shared with the charts)
        for ser in list(self.series.values()):
            if not ser.loaded and not ser.loading and now - ser.at > (20 if ser.err else 0):
                ser.loading = True
                asyncio.get_running_loop().create_task(self._load(ser))
                break
        # sessions: open, then send the live bar as it changes (each at most every max(1 s, 3 x its last time))
        for se in list(self.sess.values()):
            if se.busy or not se.series.loaded:
                continue
            if not se.open:
                se.busy = True
                asyncio.get_running_loop().create_task(self._open(se))
                continue
            if se.series.ver != se.ver and time.monotonic() - se.last >= max(1.0, 3 * se.took / 1000):
                se.busy = True
                asyncio.get_running_loop().create_task(self._update(se))
        if n % 4 == 0:
            self._timers(now)
        if n % 240 == 0:
            for ser in list(self.series.values()):
                if ser.loaded and now - ser.at > REFRESH_SEC and not ser.loading:
                    ser.loading = True
                    asyncio.get_running_loop().create_task(self._load(ser, refresh=True))
                    break

    async def _load(self, ser: Series, refresh: bool = False):
        try:
            if ser.mt5:
                rows = await mt5.history(self.uid, self.dir, ser.sym, ser.plan["res"], ser.plan["days"])
            else:
                rows = await asyncio.get_running_loop().run_in_executor(None, candles_store.get, self.urt.link, ser.sym, ser.plan["res"], ser.plan["days"])
            bars = agg_rows(rows, ser.plan, ser.mt5, ser.sst, ser.drop)
            ser.err = ""
            if refresh and ser.rows:
                live = ser.rows[-1]
                if bars and live[0] > bars[-1][0]:
                    bars.append(live)                       # a bar the ticks started that the saved candles haven't got
                elif bars and live[0] == bars[-1][0]:
                    bars[-1] = live
                closed_old = [r[:5] for r in ser.rows[-30:-1]]
                closed_new = [r[:5] for r in bars[-30:-1]]
                if closed_old == closed_new:
                    return                                  # nothing changed in the closed bars
                log.info("[%s] alerts: %s %s candles changed at Fyers - recalculated", self.urt.label, ser.sym, ser.tfk)
            ser.rows = bars[-6000:]
            ser.vol_cum = None
            ser.loaded = True
            ser.ver += 1
            for se in self.sess.values():
                if se.series is ser:
                    se.open = False                         # (re)opened with these bars
        except PermissionError as e:
            ser.err = str(e) or "log in to Fyers"
        except Exception as e:
            ser.err = f"candles didn't load ({str(e)[:120]})"
            if not refresh:
                log.warning("[%s] alerts: %s %s candles: %s", self.urt.label, ser.sym, ser.tfk, e)
        finally:
            ser.at = _now()
            ser.loading = False

    async def _open(self, se: Sess):
        try:
            se.ver = se.series.ver
            raw = se.series.rows
            se.sent_t = raw[-1][0] if raw else 0
            r = await RUNNER.call(self.uid, {"op": "open", "key": se.key, "spec": se.spec, "raw": raw, "tail": se.tail})
            if not r.get("ok"):
                se.err = r.get("error") or "the Pine runner failed"
                await asyncio.sleep(10)
                return
            se.open = True
            self._took(se, r["out"])
        finally:
            se.busy = False

    async def _update(self, se: Sess, full: bool = False):
        try:
            ser = se.series
            se.ver = ser.ver
            rows = [r for r in ser.rows if r[0] >= se.sent_t] or ser.rows[-1:]
            se.sent_t = rows[-1][0] if rows else se.sent_t
            r = await RUNNER.call(self.uid, {"op": "full" if full else "bars", "key": se.key, "raw": rows})
            if not r.get("ok"):
                if r.get("gone"):
                    se.open = False
                else:
                    se.err = r.get("error") or ""
                return
            self._took(se, r["out"])
        finally:
            se.busy = False
            se.last = time.monotonic()

    def _took(self, se: Sess, out: dict):
        se.out = out
        se.took = out.get("took") or 0
        se.err = out.get("err") or ""
        se.dirty = False
        self._after(se, out)

    def _after(self, se: Sess, out: dict):
        """New numbers from one session: work out every alert that uses it."""
        for (aid, sym) in list(se.refs):
            a = self.get(aid)
            w = self.want.get((aid, sym))
            if not a or not w or a.get("status") != "active":
                continue
            try:
                c0 = a["conds"][0]
                if c0["a"].get("any"):
                    self._calls(a, sym, w, se, out)
                    continue
                main = w["bars"].get(c0["tf"])
                st = self.st.get((aid, sym)) or {}
                if a["freq"] == "close":
                    self._close_check(a, sym, w, st)
                    continue
                self._eval(a, sym, w)
            except Exception as e:
                log.exception("[%s] alert %s: %s", self.urt.label, aid, e)

    def _close_check(self, a, sym, w, st):
        """Once per bar close: the first condition's bar has closed when its session shows a newer live bar; every
        session of that timeframe must have caught up before the closed bar is worked out. The first numbers after
        the alert is set only mark where it starts (a bar that closed before the alert existed never fires it)."""
        c0 = a["conds"][0]
        main = self.sess.get(w["bars"].get(c0["tf"]) or "")
        times = (main.out or {}).get("times") if main else None
        if not times or len(times) < 2:
            return
        live, closed_t = times[-1], times[-2]
        if st.get("closed") is None:
            st["closed"] = closed_t
            return
        if st["closed"] >= closed_t:
            return
        for i, c in enumerate(a["conds"]):
            if c["tf"] != c0["tf"]:
                continue
            for k in w["keys"].get(i, {}).values():
                se = self.sess.get(k or "")
                if se and (not se.out or not se.out.get("times") or se.out["times"][-1] < live):
                    return                                  # this one hasn't seen the new bar yet
        st["closed"] = closed_t
        self._eval(a, sym, w, closed_o=1)

    def _calls(self, a, sym, w, se, out):
        """"Any alert() call": each call as the script's own alert.freq_* says."""
        if w["keys"].get(0, {}).get("a") != se.key:
            return
        st = self.st[(a["id"], sym)]
        times = out.get("times") or []
        live = times[-1] if times else None
        for c in out.get("calls") or []:
            fq, t_ = c.get("freq"), c.get("t")
            key = (t_, c.get("message"), fq)
            if fq == "all":
                if out.get("full") and t_ != live:
                    continue                                # seen live already
            elif fq == "once_per_bar_close":
                if t_ == live or key in st["calls"]:
                    continue
            else:
                if (t_, "bar") in st["calls"]:
                    continue
                key = (t_, "bar")
            st["calls"].add(key)
            if len(st["calls"]) > 500:
                st["calls"] = set(list(st["calls"])[-200:])
            self._fire(a, sym, w, None, t_, 0 if t_ == live else 1, call_msg=c.get("message", ""))

    def _timers(self, now: float):
        """Expiry, and "once per bar close" when a bar's time is up and no tick has started the next one."""
        changed = False
        for a in self.alerts:
            if a.get("status") == "active" and a.get("exp") and a["exp"] <= now:
                a["status"] = "expired"
                self._disarm(a["id"])
                self.log_add({"id": secrets.token_hex(5), "aid": a["id"], "name": a.get("name"), "s": a["target"].get("s") or a["target"].get("wl_name"),
                              "msg": "Expired", "t": round(now, 1), "kind": "expired"})
                changed = True
        if changed:
            self.save()
            self._feed_changed()
            try:
                self.urt.feed.broadcast({"calerts": self.counts(), "calerts_changed": 1})
            except Exception:
                pass
        for (aid, sym), w in list(self.want.items()):
            a = self.get(aid)
            if not a or a.get("status") != "active" or a["freq"] != "close" or a["conds"][0]["a"].get("any"):
                continue
            c0 = a["conds"][0]
            if (a.get("ctype") or {}).get("type") in ("renko", "range", "lb", "pf"):
                continue                                    # those bars close when the next one opens
            se = self.sess.get(w["bars"].get(c0["tf"]) or "")
            if not se or not se.out or not se.out.get("times"):
                continue
            bt = se.out["times"][-1]
            st = self.st.get((aid, sym))
            if st is None or st.get("closed") is None or st["closed"] >= bt or st.get("timer") == bt:
                continue
            if now + IST >= se.series.bar_end(bt) + 2:
                st["timer"] = bt
                asyncio.get_running_loop().create_task(self._close_timer(a, sym, w, bt))

    async def _close_timer(self, a, sym, w, bt):
        """The bar's time is up and no tick has started the next one: every session of the alert first takes the bar's
        last ticks (Pine sessions run in full: exact closed values), then the alert is worked out on that bar. If those
        ticks turn out to start a new bar, the new-bar path (_close_check) has already done it."""
        keys = {k for d in w["keys"].values() for k in d.values() if k} | set(w["bars"].values())
        for k in keys:
            se = self.sess.get(k)
            if se and se.open and (se.code or se.series.ver != se.ver):
                while se.busy:
                    await asyncio.sleep(0.05)
                se.busy = True
                await self._update(se, full=se.code)
        st = self.st.get((a["id"], sym))
        main = self.sess.get(w["bars"].get(a["conds"][0]["tf"]) or "")
        times = (main.out or {}).get("times") if main else None
        if a.get("status") != "active" or not st or not times or st["closed"] >= bt or times[-1] != bt:
            return
        st["closed"] = bt
        self._eval(a, sym, w, closed_o=0)


# ================================================================ the helper's hooks
BOOKS: dict = {}                # uid -> Book


def book(urt) -> Book:
    b = BOOKS.get(urt.uid)
    if b is None:
        b = BOOKS[urt.uid] = Book(urt)
        if urt.loop:
            b.start(urt.loop)
    return b


def start(urt, loop):
    b = book(urt)
    if b.task is None:
        b.start(loop)


def drop(uid: str):
    b = BOOKS.pop(uid, None)
    if b:
        b.stop()


async def need_candles(uid, ticker, tf):
    """request.security() inside an alert's script: other timeframes / symbols, built as the chart builds them."""
    from . import rt
    urt = rt.RT.get(uid)
    key = pine_tf_key(tf)
    if not urt or not key:
        raise Bad(f'timeframe "{tf}" isn\'t supported here')
    plan = tf_plan(key)
    s = str(ticker or "")
    if ":" not in s:
        s = "NSE:" + s
    row = symbols.get(s) or {}
    sst, _ = _sess(row)
    if is_mt5(s):
        rows = await mt5.history(uid, urt.dir, s, plan["res"], plan["days"])
    else:
        rows = await asyncio.get_running_loop().run_in_executor(None, candles_store.get, urt.link, s, plan["res"], plan["days"])
    bars = agg_rows(rows, plan, is_mt5(s), sst)
    return [{"open": b[1], "high": b[2], "low": b[3], "close": b[4], "volume": b[5], "openTime": (b[0] - IST) * 1000,
             "closeTime": (b[0] - IST + plan["sec"]) * 1000 - 1} for b in bars]


RUNNER.need_fn = need_candles
