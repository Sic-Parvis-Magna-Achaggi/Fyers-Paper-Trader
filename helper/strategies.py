"""Strategies that trade by themselves (v0.43.0, roadmap 23 stage a): a Pine strategy() script gives the signals, the
app's own rules panel decides the size, the stop, the target, BE / trailing and the limits, and the orders go through the
same path as a click on Paper, Live (the Fyers account) and MT5 accounts. Runs on the server, page open or not.

A strategy: {id, name, status: on | off, err, src: {k: "pine", sid, name, code, inputs, libs, missing},
             syms: [contract...], tf: "5m", ctype, side: both | long | short, accounts: [{aid, on}],
             size: {mode: pct | amt | lots, v}, product,
             stop: {k: script | atr | points | line | swing, n, len, line, buf, follow},
             target: {k: r | script | none, r}, be: {on, r}, trail: {on, r},
             lim: {max_day, max_open, loss_day, loss_unit: amt | r, from, to, cutoff, skip_expiry},
             tg: bool (Telegram on each trade), created, updated}

Signals (on bar close, like TradingView's default): the script runs in Node with the page's own Pine worker
(helper/pine_node.mjs, shared with the alerts) and the orders it places are recorded bar by bar (PineTS's own fills are not
used). When a bar closes, its orders are read:
- strategy.entry (market): open in that direction (an entry the other way reverses: the trade is closed first); an entry
  in a direction the strategy doesn't trade (Long only / Short only) closes the trade, as TradingView's allow_entry_in;
- strategy.close / strategy.close_all: close the strategy's trade;
- strategy.exit(stop =, limit =): the script's stop and target ("Stop: from the script", "Target: from the script"),
  and with "follow" the stop moves with the script's (only ever tighter).
Limit / stop entries (strategy.entry(limit =) ...) aren't traded yet (logged).

Every order goes through the account's own plan() / place(): its rules and guards, the journal's lockouts, the kill
switch, the square-off, MT5's news guard and no-hedging rule. Positions carry {strat: {id, name, eid}} (the History, the
journal's set-up tag). A strategy only touches trades it opened.

The tester: the same script and rules over the saved candles, fills by the paper rules (market at the next bar's open,
stops / targets when the bar's range reaches them, a gap fills at the open, stop first if both in one bar), sized and
counted net of every charge with the account's own rates.

Files: u/<user>/strategies.json {strategies: [...], state: {...}}, u/<user>/strategies_log.jsonl."""
from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import json
import logging
import math
import re
import secrets
import time

from . import candles as candles_store
from . import chartalerts as CA
from . import charges, mt5, store, symbols, telegram
from .paper import Refused, hm_minus, ist

log = logging.getLogger("strategies")

MAX_STRATS = 30
MAX_SYMS = 10
LOG_KEEP = 2000
TAIL = 60                       # bars of numbers kept per session (ATR, swings, a Pine line)
SIDES = ("both", "long", "short")
STOP_K = ("script", "atr", "points", "line", "swing")
TGT_K = ("r", "script", "none")
SIZE_M = ("pct", "amt", "lots")
PRODUCTS = ("INTRADAY", "MARGIN", "CNC")
PERIODS = (7, 30, 60, 90, 180, 365)


def _now() -> float:
    return time.time()


def timed(ctype_type) -> bool:
    """Bars that close on the clock (candles, bars, line, Heikin-Ashi); Renko / range / line break / P&F close when the next opens."""
    return ctype_type not in ("renko", "range", "lb", "pf")


def short(sym: str) -> str:
    return str(sym or "").split(":", 1)[-1]


def _utc(t) -> dt.datetime:
    return dt.datetime.fromtimestamp(t, dt.timezone.utc)


def _num(x, lo, hi, default=None, what="value"):
    if x in (None, ""):
        return default
    try:
        v = float(x)
    except (TypeError, ValueError):
        raise CA.Bad(f"{what}: a number")
    if not math.isfinite(v) or v < lo or v > hi:
        raise CA.Bad(f"{what}: from {lo:g} to {hi:g}")
    return v


def _hm(x, default):
    x = str(x or "").strip()
    if not x:
        return default
    if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", x):
        raise CA.Bad("times as HH:MM (IST)")
    return x


def is_strategy(code: str) -> bool:
    return bool(re.search(r"^\s*strategy\s*\(", code or "", re.M))


def clean(b: dict, old: dict | None, is_admin: bool, account_ids: set) -> dict:
    """A strategy from the page, checked. Raises CA.Bad with a sentence for the page."""
    if not isinstance(b, dict):
        raise CA.Bad("bad strategy")
    old = old or {}
    s = {"id": old.get("id") or secrets.token_hex(5), "created": old.get("created") or round(_now(), 1), "updated": round(_now(), 1)}
    s["name"] = str(b.get("name") or "").strip()[:60] or "Strategy"
    src = b.get("src") if isinstance(b.get("src"), dict) else {}
    code = str(src.get("code") or "")
    if not code.strip():
        raise CA.Bad("pick a Pine strategy script")
    if len(code) > CA.CODE_MAX:
        raise CA.Bad("the script is too long")
    if not is_strategy(code):
        raise CA.Bad("that script isn't a strategy: it needs strategy(...) at the top, with strategy.entry / strategy.close / strategy.exit")
    libs = src.get("libs") if isinstance(src.get("libs"), dict) else {}
    CA._jsize(libs, 2_000_000, "the script's libraries")
    inputs = src.get("inputs") if isinstance(src.get("inputs"), dict) else {}
    CA._jsize(inputs, 50_000, "the script's inputs")
    s["src"] = {"k": "pine", "sid": str(src.get("sid") or "")[:40], "name": str(src.get("name") or "")[:80], "code": code,
                "inputs": inputs, "libs": libs, "missing": [str(x)[:120] for x in (src.get("missing") or [])][:20]}
    syms = []
    for x in b.get("syms") or []:
        x = str(x or "").strip()
        if x and x not in syms:
            if not symbols.get(x) and not CA.is_mt5(x):
                raise CA.Bad(f"{x}: not a contract the app knows")
            syms.append(x)
    if not syms:
        raise CA.Bad("add at least one contract")
    if len(syms) > MAX_SYMS:
        raise CA.Bad(f"at most {MAX_SYMS} contracts per strategy")
    if any(CA.is_mt5(x) for x in syms) and not all(CA.is_mt5(x) for x in syms):
        raise CA.Bad("MT5 symbols and Fyers contracts can't be mixed in one strategy")
    s["syms"] = syms
    tf = CA.tf_norm(b.get("tf") or "5m")
    if not tf:
        raise CA.Bad("timeframe: e.g. 1m, 5m, 15m, 1h, 1D")
    s["tf"] = tf
    s["ctype"] = CA.clean_ctype(b.get("ctype"))
    s["side"] = b.get("side") if b.get("side") in SIDES else "both"
    mt = CA.is_mt5(syms[0])
    accs, seen = [], set()
    for a in b.get("accounts") or []:
        aid = str((a or {}).get("aid") or "")
        if not aid or aid in seen:
            continue
        if aid not in account_ids:
            raise CA.Bad("an account in the list doesn't exist any more")
        if (aid == "live" or aid.startswith("mt5-")) and not is_admin:
            raise CA.Bad("only the admin can trade Live or MT5 accounts")
        if aid.startswith("mt5-") != mt:
            raise CA.Bad("MT5 symbols trade on MT5 accounts, Fyers contracts on Paper / Live accounts")
        seen.add(aid)
        accs.append({"aid": aid, "on": bool(a.get("on"))})
    s["accounts"] = accs
    sz = b.get("size") if isinstance(b.get("size"), dict) else {}
    mode = sz.get("mode") if sz.get("mode") in SIZE_M else "pct"
    s["size"] = {"mode": mode, "v": _num(sz.get("v"), 0.0001, 1e9 if mode == "amt" else (100 if mode == "pct" else 10000),
                                         1 if mode != "amt" else 1000, "size")}
    s["product"] = b.get("product") if b.get("product") in PRODUCTS else "INTRADAY"
    st = b.get("stop") if isinstance(b.get("stop"), dict) else {}
    k = st.get("k") if st.get("k") in STOP_K else "atr"
    s["stop"] = {"k": k, "n": _num(st.get("n"), 0.0001, 1e9, 2 if k == "atr" else 10, "stop distance"),
                 "len": int(_num(st.get("len"), 1, 50, 14 if k == "atr" else 5, "length")),
                 "line": str(st.get("line") or "")[:80], "buf": int(_num(st.get("buf"), 0, 1000, 0, "buffer ticks")),
                 "follow": bool(st.get("follow"))}
    if k == "line" and not s["stop"]["line"]:
        raise CA.Bad("Stop on a Pine line: pick the plot")
    tg = b.get("target") if isinstance(b.get("target"), dict) else {}
    s["target"] = {"k": tg.get("k") if tg.get("k") in TGT_K else "r", "r": _num(tg.get("r"), 0.1, 50, 2, "target R")}
    for key in ("be", "trail"):
        x = b.get(key) if isinstance(b.get(key), dict) else {}
        s[key] = {"on": bool(x.get("on")), "r": _num(x.get("r"), 0.05, 50, 1, "R")}
    lm = b.get("lim") if isinstance(b.get("lim"), dict) else {}
    s["lim"] = {"max_day": int(_num(lm.get("max_day"), 0, 1000, 0, "trades a day")),
                "max_open": int(_num(lm.get("max_open"), 0, 100, 0, "open at once")),
                "loss_day": _num(lm.get("loss_day"), 0, 1e9, 0, "daily loss"),
                "loss_unit": "r" if lm.get("loss_unit") == "r" else "amt",
                "from": _hm(lm.get("from"), ""), "to": _hm(lm.get("to"), ""),
                "cutoff": int(_num(lm.get("cutoff"), 0, 600, 0, "minutes before the close")),
                "skip_expiry": bool(lm.get("skip_expiry"))}
    s["tg"] = b.get("tg") is not False
    s["status"] = old.get("status") or "off"
    s["err"] = ""
    return s


def needs_stepup(new: dict, old: dict | None) -> bool:
    """Switching a strategy on for Live or MT5 (or a change to one that already trades there) asks for a fresh 2FA code."""
    def live_on(x):
        return {a["aid"] for a in (x or {}).get("accounts") or [] if a.get("on") and (a["aid"] == "live" or a["aid"].startswith("mt5-"))}
    return bool(live_on(new) - live_on(old)) or (bool(live_on(new)) and (new or {}).get("status") == "on"
                                                 and (old or {}).get("status") != "on")


# ================================================================ bars and numbers
def atr(highs, lows, closes, n):
    """Wilder's ATR (RMA of the true range) over the given bars; None if too few."""
    if len(closes) < n + 1:
        return None
    trs = [max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])) for i in range(1, len(closes))]
    a = sum(trs[:n]) / n
    for x in trs[n:]:
        a = (a * (n - 1) + x) / n
    return a


def read_orders(orders: list, t: int) -> dict:
    """The orders a script placed on the bar at t: its last market entry, closes, the stop / target per entry, others."""
    out = {"entry": None, "close": set(), "close_all": False, "bracket": {}, "other": []}
    for o in orders or []:
        if o.get("t") != t:
            continue
        if o.get("cat") == "entry":
            if o.get("type") == "market":
                out["entry"] = {"id": o.get("id") or "", "dir": 1 if (o.get("dir") or 0) > 0 else -1}
            else:
                out["other"].append(o)
        elif o.get("cat") == "exit":
            oid = str(o.get("id") or "")
            if oid.startswith("Close position order"):
                out["close_all"] = True
            elif oid.startswith("Close entry(s) order"):
                out["close"].add(o.get("from") or oid[len("Close entry(s) order"):].strip())
            if o.get("stop") is not None or o.get("limit") is not None:
                out["bracket"][o.get("from") or ""] = {"stop": o.get("stop"), "limit": o.get("limit")}
    return out


def stop_for(s: dict, d: int, entry: float, i: int, bars: dict, plots: dict, bracket: dict, tick: float):
    """The stop for an entry at `entry` in direction d, decided on bar i of the session's bars. (price, why-not)."""
    st = s["stop"]
    k = st["k"]
    px = None
    if k == "script":
        px = (bracket or {}).get("stop")
        if px is None:
            return None, "the script gave no stop for this entry (strategy.exit(stop = ...))"
    elif k == "points":
        px = entry - d * st["n"]
    elif k == "atr":
        hi, lo, cl = bars["high"][:i + 1], bars["low"][:i + 1], bars["close"][:i + 1]
        a = atr(hi, lo, cl, st["len"])
        if a is None:
            return None, f"not enough bars for ATR {st['len']}"
        px = entry - d * a * st["n"]
    elif k == "line":
        arr = (plots or {}).get(st["line"])
        if not arr or i >= len(arr) or arr[i] is None:
            return None, f'the script\'s line "{st["line"]}" has no value on this bar'
        px = arr[i]
    elif k == "swing":
        n = st["len"]
        lo, hi = bars["low"][max(0, i - n + 1):i + 1], bars["high"][max(0, i - n + 1):i + 1]
        if not lo:
            return None, "no bars for the swing"
        px = min(lo) if d > 0 else max(hi)
    px = px - d * st["buf"] * tick
    px = charges.round_tick(px, tick, -d)
    if d * (entry - px) <= 0:
        return None, f"the stop ({px:g}) is on the wrong side of the price ({entry:g})"
    return px, None


# ================================================================ one user's strategies
class Book:
    def __init__(self, urt):
        self.urt = urt
        self.uid = urt.uid
        self.dir = urt.dir
        d = store.load(self.dir + "strategies.json", {"strategies": []})
        self.strats: list = [x for x in (d.get("strategies") or []) if isinstance(x, dict) and x.get("id")]
        self.state: dict = d.get("state") if isinstance(d.get("state"), dict) else {}   # counters per strategy / account / day
        self.series: dict = {}          # (sym, tf) -> CA.Series
        self.sess: dict = {}            # key -> CA.Sess
        self.want: dict = {}            # (strategy id, sym) -> session key
        self.done: dict = {}            # (strategy id, sym) -> the last closed bar acted on (IST-shifted s)
        self.notes: dict = {}           # strategy id -> a note for the page ("waiting for candles", ...)
        self.loop = None
        self.task = None
        self.tests: dict = {}           # strategy id -> the last tester result (kept in memory)

    # ------------------------------------------------------------ storage and the page
    def save(self):
        store.save(self.dir + "strategies.json", {"strategies": self.strats, "state": self.state})

    def get(self, sid):
        return next((x for x in self.strats if x["id"] == sid), None)

    def log_add(self, s: dict | None, kind: str, msg: str, sym: str = "", aid: str = "", **extra):
        e = {"t": round(_now(), 1), "sid": s["id"] if s else "", "name": s["name"] if s else "", "s": sym, "aid": aid,
             "kind": kind, "msg": msg, **extra}
        path = store.path(self.dir + "strategies_log.jsonl")
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "a", encoding="utf-8") as f:
                f.write(json.dumps(e) + "\n")
            if path.stat().st_size > 2_000_000:
                lines = path.read_text(encoding="utf-8").splitlines()[-LOG_KEEP:]
                path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        except Exception as ex:
            log.warning("[%s] strategy log: %s", self.urt.label, ex)
        try:
            self.urt.feed.broadcast({"strat_log": e})
        except Exception:
            pass
        return e

    def read_log(self, n: int = 300, sid: str = "") -> list:
        path = store.path(self.dir + "strategies_log.jsonl")
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except Exception:
            return []
        out = []
        for ln in reversed(lines):
            try:
                e = json.loads(ln)
            except Exception:
                continue
            if sid and e.get("sid") != sid:
                continue
            out.append(e)
            if len(out) >= n:
                break
        return out

    def public(self, s: dict) -> dict:
        x = {k: v for k, v in s.items() if k != "src"}
        x["src"] = {k: v for k, v in s["src"].items() if k not in ("libs",)}
        x["note"] = self.notes.get(s["id"], "")
        x["today"] = self.today(s)
        x["open"] = self.open_trades(s)
        return x

    def summary(self) -> dict:
        return {"strategies": [self.public(s) for s in self.strats], "runner": {"ok": CA.RUNNER.ok(), "err": CA.RUNNER.err},
                "running": sum(1 for s in self.strats if s.get("status") == "on")}

    def symbols(self) -> list:
        out = []
        for s in self.strats:
            if s.get("status") == "on":
                out += [x for x in s["syms"] if x not in out]
        return out

    def _engine(self, aid):
        e = self.urt.engines.get(aid)
        return e if e is not None and not getattr(e, "none", False) else None

    def held(self, s: dict, e, sym: str | None = None) -> list:
        """The trades and pending orders this strategy opened on an account (a symbol's, or all)."""
        out = [p for p in e.positions if (p.get("strat") or {}).get("id") == s["id"] and (sym is None or p["s"] == sym)]
        out += [o for o in e.orders if (o.get("strat") or {}).get("id") == s["id"] and (sym is None or o["s"] == sym)]
        return out

    def open_trades(self, s: dict) -> list:
        out = []
        for a in s.get("accounts") or []:
            e = self._engine(a["aid"])
            if not e:
                continue
            for p in e.positions:
                if (p.get("strat") or {}).get("id") == s["id"]:
                    out.append({"aid": a["aid"], "id": p["id"], "s": p["s"], "side": p["side"], "avg": p.get("avg")})
        return out

    def today(self, s: dict) -> dict:
        """Per account: today's trades by this strategy, their net and R (closed), from each account's own history."""
        out = {}
        for a in s.get("accounts") or []:
            e = self._engine(a["aid"])
            if not e:
                continue
            day = e.trading_day()
            recs = [h for h in e.history if (h.get("strat") or {}).get("id") == s["id"] and h.get("day") == day]
            out[a["aid"]] = {"trades": self._count(s["id"], a["aid"], day), "closed": len(recs),
                             "net": round(sum(h.get("net") or 0 for h in recs), 2),
                             "r": round(sum(h.get("r") or 0 for h in recs), 2),
                             "ccy": e.ccy() if callable(getattr(e, "ccy", None)) else "INR"}
        return out

    def _count(self, sid, aid, day) -> int:
        return int(((self.state.get("count") or {}).get(f"{sid}|{aid}") or {}).get(day) or 0)

    def _bump(self, sid, aid, day):
        c = self.state.setdefault("count", {}).setdefault(f"{sid}|{aid}", {})
        c[day] = int(c.get(day) or 0) + 1
        for k in sorted(c)[:-10]:
            c.pop(k, None)

    # ------------------------------------------------------------ changes from the page
    def upsert(self, b: dict, is_admin: bool) -> tuple:
        old = self.get(b.get("id")) if b.get("id") else None
        if not old and len(self.strats) >= MAX_STRATS:
            raise CA.Bad(f"at most {MAX_STRATS} strategies")
        ids = {a["id"] for a in self.urt.accounts() if not a.get("archived")} | {"live"} | set(self.urt.engines)
        s = clean(b, old, is_admin, ids)
        step = needs_stepup(s, old)
        return s, old, step

    def commit(self, s: dict, old: dict | None):
        if old:
            self.strats = [s if x["id"] == s["id"] else x for x in self.strats]
            self._disarm(s["id"])
        else:
            self.strats.append(s)
        self.save()
        self.log_add(s, "info", "Saved" if old else "Created")
        if s["status"] == "on":
            self._arm(s)
        self._feed_changed()
        return s

    def action(self, sid: str, do: str, is_admin: bool) -> dict | None:
        s = self.get(sid)
        if not s:
            raise CA.Bad("that strategy is gone")
        if do == "delete":
            self._disarm(sid)
            self.strats = [x for x in self.strats if x["id"] != sid]
            self.save()
            self.log_add(s, "info", "Deleted (its open trades stay, with their stops)")
            self._feed_changed()
            return None
        if do == "on":
            if not any(a.get("on") for a in s["accounts"]):
                raise CA.Bad("switch on at least one account first")
            s["status"], s["err"] = "on", ""
            self.done = {k: v for k, v in self.done.items() if k[0] != sid}
            self._arm(s)
            self.log_add(s, "info", "Switched on: trades from the next bar that closes")
        elif do == "off":
            s["status"] = "off"
            self._disarm(sid)
            self.log_add(s, "info", "Switched off (its open trades stay, with their stops)")
        else:
            raise CA.Bad("unknown action")
        self.save()
        self._feed_changed()
        return s

    def stop_all(self, why: str = "Stop all strategies") -> int:
        n = 0
        for s in self.strats:
            if s.get("status") == "on":
                s["status"] = "off"
                self._disarm(s["id"])
                self.log_add(s, "info", f"Switched off: {why}")
                n += 1
        if n:
            self.save()
            self._feed_changed()
        return n

    def _feed_changed(self):
        try:
            self.urt.feed._resync()
        except Exception:
            pass
        try:
            self.urt.feed.broadcast({"strats_changed": 1})
        except Exception:
            pass

    # ------------------------------------------------------------ sessions (one per strategy + contract)
    def _key(self, s, sym):
        src = s["src"]
        return "Q|" + hashlib.sha1(json.dumps([self.uid, s["id"], sym, s["tf"], s["ctype"], src["code"], src["inputs"]],
                                              sort_keys=True).encode()).hexdigest()[:20]

    def _series(self, sym, tfk):
        k = (sym, tfk)
        if k not in self.series:
            self.series[k] = CA.Series(sym, tfk)
        return self.series[k]

    def _arm(self, s: dict):
        for sym in s["syms"]:
            key = self._key(s, sym)
            if key not in self.sess:
                ct = CA.Book._ctype_for(None, {"ctype": s["ctype"]}, sym, s["tf"])
                ser = self._series(sym, s["tf"])
                ser.drop = ct.get("hideNoTrade", True)
                spec = {"ctype": {"type": ct["type"], "opts": ct["opts"], "tick": ct["tick"], "pfInd": ct["pfInd"]},
                        "barSec": ser.plan["sec"], "drawSec": ser.plan["sec"], "ticker": sym, "tf": CA.pine_tf(s["tf"]),
                        "info": CA.Book._info(None, sym), "code": s["src"]["code"], "inputs": s["src"]["inputs"], "props": None,
                        "libs": s["src"]["libs"], "missing": s["src"]["missing"], "strategy": True}
                se = CA.Sess(key, sym, s["tf"], spec, ser, code=True)
                se.tail = TAIL
                self.sess[key] = se
            self.sess[key].refs.add((s["id"], sym))
            self.want[(s["id"], sym)] = key

    def _disarm(self, sid: str):
        for k in [k for k in self.want if k[0] == sid]:
            self.want.pop(k, None)
            self.done.pop(k, None)
        for key, se in list(self.sess.items()):
            se.refs = {r for r in se.refs if r[0] != sid}
            if not se.refs:
                self.sess.pop(key, None)
                if se.open:
                    CA.RUNNER.close(key)
        used = {(se.sym, se.tfk) for se in self.sess.values()}
        for k in list(self.series):
            if k not in used:
                self.series.pop(k, None)
        self.notes.pop(sid, None)

    def on_tick(self, t: dict):
        s = t.get("s")
        for (sym, _), ser in self.series.items():
            if sym == s:
                ser.apply_tick(t)

    def start(self, loop):
        self.loop = loop
        if self.task is None:
            self.task = loop.create_task(self._pump())
        if self._runner_restarted not in CA._restart_cbs:
            CA._restart_cbs.append(self._runner_restarted)
        for s in self.strats:
            if s.get("status") == "on":
                self._arm(s)

    def stop(self):
        if self.task:
            self.task.cancel()
            self.task = None
        for key in list(self.sess):
            CA.RUNNER.close(key)
        self.sess.clear()
        self.series.clear()
        try:
            CA._restart_cbs.remove(self._runner_restarted)
        except ValueError:
            pass

    def _runner_restarted(self):
        for se in self.sess.values():
            se.open = False
            se.busy = False

    async def _pump(self):
        while True:
            try:
                await asyncio.sleep(0.5)
                await self._step()
            except asyncio.CancelledError:
                return
            except Exception as e:
                log.exception("[%s] strategies: %s", self.urt.label, e)
                await asyncio.sleep(2)

    async def _step(self):
        now = _now()
        for ser in list(self.series.values()):
            if not ser.loaded and not ser.loading and now - ser.at > (20 if ser.err else 0):
                ser.loading = True
                asyncio.get_running_loop().create_task(self._load(ser))
                break
        for se in list(self.sess.values()):
            if se.busy or not se.series.loaded:
                if se.series.err:
                    for sid, _ in se.refs:
                        self.notes[sid] = f"{se.sym}: {se.series.err}"
                continue
            if not se.open:
                se.busy = True
                asyncio.get_running_loop().create_task(self._open(se))
                continue
            times = (se.out or {}).get("times") or []
            if not times:
                continue
            ser = se.series
            is_timed = timed((se.spec.get("ctype") or {}).get("type"))
            last_raw = ser.rows[-1][0] if ser.rows else 0
            if is_timed:
                if last_raw > times[-1]:                    # the ticks started a new bar: the one before has closed
                    se.busy = True
                    asyncio.get_running_loop().create_task(self._run(se, "bars"))
                elif now + CA.IST >= ser.bar_end(times[-1]) + 2 and any(self.done.get(r, 0) < times[-1] for r in se.refs) \
                        and se.full_due != times[-1]:
                    se.full_due = times[-1]                 # its time is up, no tick has started the next one yet
                    se.busy = True
                    asyncio.get_running_loop().create_task(self._run(se, "full", closed_last=True))
            elif ser.ver != se.ver and time.monotonic() - se.last >= 3:
                se.busy = True                              # Renko / range / line break / P&F: a bar closes when the next opens
                asyncio.get_running_loop().create_task(self._run(se, "bars"))

    async def _load(self, ser):
        try:
            if ser.mt5:
                rows = await mt5.history(self.uid, self.dir, ser.sym, ser.plan["res"], ser.plan["days"])
            else:
                rows = await asyncio.get_running_loop().run_in_executor(None, candles_store.get, self.urt.link, ser.sym,
                                                                        ser.plan["res"], ser.plan["days"])
            bars = CA.agg_rows(rows, ser.plan, ser.mt5, ser.sst, ser.drop)
            if ser.rows and bars and ser.rows[-1][0] > bars[-1][0]:
                bars.append(ser.rows[-1])
            ser.rows = bars[-6000:]
            ser.vol_cum = None
            ser.loaded, ser.err = True, ""
            ser.ver += 1
        except PermissionError as e:
            ser.err = str(e) or "log in to Fyers"
        except Exception as e:
            ser.err = f"candles didn't load ({str(e)[:120]})"
            log.warning("[%s] strategies: %s %s candles: %s", self.urt.label, ser.sym, ser.tfk, e)
        finally:
            ser.at = _now()
            ser.loading = False

    async def _open(self, se):
        try:
            se.ver = se.series.ver
            raw = se.series.rows
            se.sent_t = raw[-1][0] if raw else 0
            r = await CA.RUNNER.call(self.uid, {"op": "open", "key": se.key, "spec": se.spec, "raw": raw, "tail": se.tail})
            if not r.get("ok"):
                self._script_error(se, r.get("error") or "the Pine runner failed")
                await asyncio.sleep(10)
                return
            out = r["out"]
            if out.get("err"):
                self._script_error(se, out["err"])
                return
            se.out, se.open = out, True
            times = out.get("times") or []
            for ref in se.refs:                              # history isn't traded: start from the bar that closes next
                if ref not in self.done and len(times) >= 2:
                    self.done[ref] = times[-2]
                self.notes.pop(ref[0], None)
        finally:
            se.busy = False

    def _script_error(self, se, err: str):
        for sid, sym in list(se.refs):
            s = self.get(sid)
            if s and s.get("status") == "on":
                s["status"], s["err"] = "off", f"{sym}: the script stopped with an error: {err[:300]}"
                self._disarm(sid)
                self.save()
                self.log_add(s, "error", s["err"] + " - switched off", sym)
                self._telegram(s, f"⚠ Strategy {s['name']} switched itself off: {s['err']}")
                self._feed_changed()

    async def _run(self, se, op: str, closed_last: bool = False):
        try:
            ser = se.series
            se.ver = ser.ver
            rows = [r for r in ser.rows if r[0] >= se.sent_t] or ser.rows[-1:]
            se.sent_t = rows[-1][0] if rows else se.sent_t
            r = await CA.RUNNER.call(self.uid, {"op": op, "key": se.key, "raw": rows})
            if not r.get("ok"):
                if r.get("gone"):
                    se.open = False
                else:
                    self._script_error(se, r.get("error") or "the Pine runner failed")
                return
            out = r["out"]
            if out.get("err"):
                self._script_error(se, out["err"])
                return
            se.out = out
            if not out.get("full"):
                return
            times = out.get("times") or []
            last_closed = times[-1] if closed_last else (times[-2] if len(times) >= 2 else None)
            for ref in list(se.refs):
                s = self.get(ref[0])
                if not s or s.get("status") != "on" or last_closed is None:
                    continue
                done = self.done.get(ref, 0)
                for i, t in enumerate(times):
                    if done < t <= last_closed:
                        self.done[ref] = t
                        try:
                            await self.on_bar(s, ref[1], out, i)
                        except Exception as e:
                            log.exception("[%s] strategy %s: %s", self.urt.label, s["id"], e)
                            self.log_add(s, "error", f"{e}", ref[1])
        finally:
            se.busy = False
            se.last = time.monotonic()

    # ------------------------------------------------------------ a closed bar's signals -> the accounts
    async def on_bar(self, s: dict, sym: str, out: dict, i: int):
        t = out["times"][i]
        sig = read_orders(out.get("orders"), t)
        when = dt.datetime.fromtimestamp(t - CA.IST, dt.timezone(dt.timedelta(seconds=CA.IST))).strftime("%d %b %H:%M")
        if sig["other"]:
            self.log_add(s, "info", f"bar {when}: a limit / stop entry ({sig['other'][-1].get('id')}) - not traded yet "
                                    "(market entries only in this version)", sym)
        ent = sig["entry"]
        for a in s["accounts"]:
            if not a.get("on"):
                continue
            e = self._engine(a["aid"])
            if not e:
                self.log_add(s, "refused", "the account isn't there (no MT5 terminal connected?)", sym, a["aid"])
                continue
            mine = self.held(s, e, sym)
            pos = [x for x in mine if "avg" in x]
            # closes first: strategy.close / close_all, an entry the other way, an entry the strategy doesn't trade
            for p in pos:
                eid = (p.get("strat") or {}).get("eid") or ""
                why = None
                if sig["close_all"] or eid in sig["close"] or "" in sig["close"]:
                    why = "the script closed it"
                elif ent and ent["dir"] != p["side"]:
                    why = "the script reversed" if self._allowed(s, ent["dir"]) else "the script's entry the other way"
                if why:
                    await self._close(s, e, a["aid"], p, why, when)
            if ent and self._allowed(s, ent["dir"]):
                still = [x for x in self.held(s, e, sym) if x.get("side") == ent["dir"]]
                if not still:
                    await self._open_trade(s, e, a["aid"], sym, ent, sig, out, i, when)
            elif ent and not self._allowed(s, ent["dir"]) and not pos:
                pass                                        # (Long only: a short entry with nothing open does nothing)
            # the script's stop, followed (only ever tighter)
            if s["stop"]["k"] == "script" and s["stop"]["follow"]:
                for p in [x for x in self.held(s, e, sym) if "avg" in x]:
                    eid = (p.get("strat") or {}).get("eid") or ""
                    br = sig["bracket"].get(eid) or sig["bracket"].get("")
                    if not br or br.get("stop") is None or p.get("exiting"):
                        continue
                    row = e.row(p["s"]) if getattr(e, "mode", "") == "mt5" else e.row(p["s"], p["product"])
                    new = charges.round_tick(br["stop"], row.get("tick"), -p["side"])
                    cur = p.get("sl")
                    if cur is not None and p["side"] * (new - cur) <= 0:
                        continue
                    try:
                        e.modify_pos(p["id"], sl=new)
                        self.log_add(s, "stop", f"stop moved with the script: {cur} → {new}", sym, a["aid"])
                    except Refused as ex:
                        self.log_add(s, "refused", f"couldn't move the stop to {new}: {ex}", sym, a["aid"])

    @staticmethod
    def _allowed(s, d) -> bool:
        return s["side"] == "both" or (s["side"] == "long" and d > 0) or (s["side"] == "short" and d < 0)

    def _acct_name(self, aid):
        if aid == "live":
            return "Live"
        if aid.startswith("mt5-"):
            return "MT5 " + aid[4:]
        a = next((x for x in self.urt.accounts() if x["id"] == aid), None)
        return (a or {}).get("name") or aid

    async def _close(self, s, e, aid, p, why, when):
        try:
            e.close_now(p["id"], reason=f"strategy: {s['name']}")
            msg = f"bar {when}: closed {'LONG' if p['side'] > 0 else 'SHORT'} ({why})"
            self.log_add(s, "close", msg, p["s"], aid)
            self._telegram(s, f"⚡ {s['name']} · {self._acct_name(aid)}: {msg} · {short(p['s'])}")
        except Refused as ex:
            self.log_add(s, "refused", f"bar {when}: couldn't close ({why}): {ex}", p["s"], aid)

    def _guard(self, s, e, aid, sym, row) -> str | None:
        """The strategy's own limits (the account's rules and guards come after, in plan())."""
        L = s["lim"]
        for st_ in (getattr(e, "L", None), getattr(e, "M", None)):
            if isinstance(st_, dict) and st_.get("halted"):
                return "the kill switch is on"
        now_ist = ist()
        hm = now_ist.strftime("%H:%M")
        if L["from"] and L["to"]:
            inside = L["from"] <= hm < L["to"] if L["from"] < L["to"] else (hm >= L["from"] or hm < L["to"])
            if not inside:
                return f"outside its trading hours ({L['from']}-{L['to']} IST)"
        day = e.trading_day()
        if L["max_day"] and self._count(s["id"], aid, day) >= L["max_day"]:
            return f"{L['max_day']} trades today reached (the strategy's limit)"
        if L["max_open"] and len([x for x in e.positions if (x.get("strat") or {}).get("id") == s["id"]]) >= L["max_open"]:
            return f"{L['max_open']} open at once reached (the strategy's limit)"
        if L["loss_day"]:
            recs = [h for h in e.history if (h.get("strat") or {}).get("id") == s["id"] and h.get("day") == day]
            got = sum((h.get("r") or 0) if L["loss_unit"] == "r" else (h.get("net") or 0) for h in recs)
            if got <= -L["loss_day"]:
                return (f"its daily loss limit ({L['loss_day']:g}{'R' if L['loss_unit'] == 'r' else ''}) is reached: "
                        "no more trades today")
        if L["skip_expiry"] and row.get("exp"):
            try:
                if ist(float(row["exp"])).date() == now_ist.date():
                    return "it's this contract's expiry day (skipped)"
            except Exception:
                pass
        if L["cutoff"]:
            if getattr(e, "mode", "") == "mt5" and hasattr(e, "dayend_for"):
                try:
                    d = e.dayend_for(sym)
                    if d and d.get("active") and d.get("at") and _now() >= d["at"] - L["cutoff"] * 60:
                        return f"less than {L['cutoff']} min to the day-end close"
                except Exception:
                    pass
            elif s["product"] == "INTRADAY" and hasattr(e, "_times"):
                sq = e._times(row, sym)[0]
                if sq and hm >= hm_minus(sq, L["cutoff"]):
                    return f"less than {L['cutoff']} min to the square-off ({sq})"
        return None

    async def _open_trade(self, s, e, aid, sym, ent, sig, out, i, when):
        d = ent["dir"]
        mt = getattr(e, "mode", "") == "mt5"
        try:
            row = e.row(sym) if mt else e.row(sym, s["product"])
        except Refused as ex:
            self.log_add(s, "refused", f"bar {when}: {ex}", sym, aid)
            return
        why = self._guard(s, e, aid, sym, row)
        if why:
            self.log_add(s, "refused", f"bar {when}: {'BUY' if d > 0 else 'SELL'} signal not taken: {why}", sym, aid)
            return
        if not e.fresh(sym):
            self.log_add(s, "refused", f"bar {when}: no live price for {sym} (market closed?)", sym, aid)
            return
        price = e.fill_price(sym, d)
        bars = out.get("bars") or {}
        br = sig["bracket"].get(ent["id"]) or sig["bracket"].get("")
        sl, why = stop_for(s, d, price, i, bars, out.get("plots") or {}, br, row.get("tick") or 0.05)
        if sl is None:
            self.log_add(s, "refused", f"bar {when}: {'BUY' if d > 0 else 'SELL'} signal not taken: {why}", sym, aid)
            return
        req = {"s": sym, "side": d, "type": "market", "sl": sl, "product": s["product"], "basis": "self",
               "mode": s["size"]["mode"], "risk_pct": s["size"]["v"], "risk_amt": s["size"]["v"], "lots": s["size"]["v"],
               "strat": {"id": s["id"], "name": s["name"], "eid": ent["id"]},
               "tr": {"be_on": s["be"]["on"], "be_r": s["be"]["r"], "sl_on": s["trail"]["on"], "sl_r": s["trail"]["r"]}}
        tg = s["target"]
        if tg["k"] == "r":
            req["tp_r"] = tg["r"]
        elif tg["k"] == "script" and br and br.get("limit") is not None and d * (br["limit"] - price) > 0:
            req["tp"] = br["limit"]
        if mt:
            req["dayend"] = None
        try:
            if not mt and hasattr(e, "fetch_margin"):
                await asyncio.get_running_loop().run_in_executor(None, e.fetch_margin, row, d, s["product"])
            plan = e.place(req)
        except Refused as ex:
            self.log_add(s, "refused", f"bar {when}: {'BUY' if d > 0 else 'SELL'} not placed: {ex}", sym, aid)
            self._telegram(s, f"⚡ {s['name']} · {self._acct_name(aid)}: {'BUY' if d > 0 else 'SELL'} {sym} not placed: {ex}")
            return
        except Exception as ex:
            self.log_add(s, "error", f"bar {when}: {ex}", sym, aid)
            return
        self._bump(s["id"], aid, e.trading_day())
        self.save()
        lots = plan.get("lots")
        risk = plan.get("risk")
        ccy = "₹" if not mt else ""
        msg = (f"bar {when}: {'BUY' if d > 0 else 'SELL'} {lots:g} lot{'s' if lots != 1 else ''} at market (≈{price:g}), "
               f"SL {plan.get('sl'):g}" + (f", TP {plan['tp']:g}" if plan.get("tp") is not None else "")
               + (f", risk {ccy}{risk:,.2f} net" if risk is not None else ""))
        self.log_add(s, "open", msg, sym, aid)
        self._telegram(s, f"⚡ {s['name']} · {self._acct_name(aid)}: {msg} · {sym}")

    def _telegram(self, s, text):
        if not s.get("tg") or not self.loop:
            return
        try:
            self.loop.run_in_executor(None, lambda: telegram.send_user(self.uid, text, who="strategies"))
        except Exception:
            pass

    # ------------------------------------------------------------ the tester
    def _cost_engine(self, s: dict):
        mt = CA.is_mt5(s["syms"][0])
        for a in s.get("accounts") or []:
            e = self._engine(a["aid"])
            if e and (getattr(e, "mode", "") == "mt5") == mt:
                return a["aid"], e
        for aid, e in self.urt.engines.items():
            if getattr(e, "none", False):
                continue
            if (getattr(e, "mode", "") == "mt5") == mt and (mt or getattr(e, "mode", "") != "live"):
                return aid, e
        return None, None

    async def test(self, b: dict, is_admin: bool, sym: str | None, days: int, capital: float | None) -> dict:
        ids = {a["id"] for a in self.urt.accounts() if not a.get("archived")} | {"live"} | set(self.urt.engines)
        s = clean(b, self.get(b.get("id")) if b.get("id") else None, is_admin, ids)
        sym = sym if sym in s["syms"] else s["syms"][0]
        aid, e = self._cost_engine(s)
        if not e:
            raise CA.Bad("no account to take the charges from (an MT5 symbol needs an MT5 account)")
        mt = getattr(e, "mode", "") == "mt5"
        row = e.row(sym) if mt else e.row(sym, s["product"])
        plan = CA.tf_plan(s["tf"])
        days = int(days if days in PERIODS else 60)
        cal = days * 7 // 5 + 3 if plan["t"]["min"] else days
        if mt:
            rows = await mt5.history(self.uid, self.dir, sym, plan["res"], cal)
        else:
            rows = await asyncio.get_running_loop().run_in_executor(None, candles_store.get, self.urt.link, sym, plan["res"], cal)
        sst = CA._sess(symbols.get(sym) or {})[0]
        raw = CA.agg_rows(rows, plan, CA.is_mt5(sym), sst, s["ctype"].get("hideNoTrade", True))
        if len(raw) < 30:
            raise CA.Bad(f"only {len(raw)} bars of history for {sym} - pick a longer period or a lower timeframe")
        ct = CA.Book._ctype_for(None, {"ctype": s["ctype"]}, sym, s["tf"])
        spec = {"ctype": {"type": ct["type"], "opts": ct["opts"], "tick": ct["tick"], "pfInd": ct["pfInd"]},
                "barSec": plan["sec"], "drawSec": plan["sec"], "ticker": sym, "tf": CA.pine_tf(s["tf"]),
                "info": CA.Book._info(None, sym), "code": s["src"]["code"], "inputs": s["src"]["inputs"], "props": None,
                "libs": s["src"]["libs"], "missing": s["src"]["missing"], "bars": 20000}
        r = await CA.RUNNER.call(self.uid, {"op": "test", "spec": spec, "raw": raw,
                                            "plot": s["stop"]["line"] if s["stop"]["k"] == "line" else None}, 300)
        if not r.get("ok"):
            raise CA.Bad(r.get("error") or "the Pine runner failed")
        out = r["out"]
        if out.get("err"):
            raise CA.Bad("the script stopped with an error: " + str(out["err"])[:400])
        size = float(capital or e.rules.get("size") or 0) or 100000.0
        res = simulate(s, row, out, size, int(e.rules.get("be_buffer_ticks") or 0))
        res.update(sym=sym, days=days, tf=s["tf"], acct=self._acct_name(aid), ccy="USD" if mt else "INR", capital=size,
                   bars=out["n"], titles=out.get("titles") or [],
                   first=out["bars"][0][0] if out["bars"] else None, last=out["bars"][-1][0] if out["bars"] else None)
        if s.get("id"):
            self.tests[s["id"]] = res
        return res


# ================================================================ the tester's fills
def simulate(s: dict, row: dict, out: dict, capital: float, be_buf: int = 0) -> dict:
    """The strategy over the history: signals on each bar's close, fills by the paper rules, every figure net of charges."""
    B = out["bars"]                          # [[t, o, h, l, c, v]] as the chart type shows them
    n = len(B)
    bars = {"open": [b[1] for b in B], "high": [b[2] for b in B], "low": [b[3] for b in B], "close": [b[4] for b in B]}
    plots = {s["stop"]["line"]: out.get("plot")} if s["stop"]["k"] == "line" else {}
    by_t: dict = {}
    for o in out.get("orders") or []:
        by_t.setdefault(o["t"], []).append(o)
    tick = row.get("tick") or 0.05
    lot = row.get("lot") or 1
    bal, peak, max_dd, max_dd_pct = capital, capital, 0.0, 0.0
    trades, curve = [], [[B[0][0], round(bal, 2)]] if n else []
    pos = None                               # {side, qty, lots, entry, sl, first_sl, tp, eid, t, i, best, be_done, trail}
    pending = None                           # an action decided on bar i, done at bar i+1's open
    day_count: dict = {}
    day_loss: dict = {}
    L = s["lim"]
    skipped = {}

    def day_of(t):
        return _utc(t).strftime("%Y-%m-%d")

    def close_pos(i, px, why):
        nonlocal pos, bal, peak, max_dd, max_dd_pct
        r_ = charges.net_at(row, pos["side"], pos["qty"], pos["entry"], px)
        net = round(r_["net"], 2)
        risk = pos["risk"]
        bal += net
        peak = max(peak, bal)
        dd = peak - bal
        max_dd = max(max_dd, dd)
        max_dd_pct = max(max_dd_pct, dd / peak * 100 if peak else 0)
        tr = {"side": pos["side"], "lots": pos["lots"], "in_t": pos["t"], "in": pos["entry"], "out_t": B[i][0], "out": px,
              "sl": pos["first_sl"], "tp": pos["tp"], "net": net, "r": round(net / risk, 2) if risk else None,
              "charges": round(r_["charges"], 2),
              "why": why, "bars": i - pos["i"]}
        trades.append(tr)
        d = day_of(B[i][0])
        day_loss[d] = day_loss.get(d, 0) + ((tr["r"] or 0) if L["loss_unit"] == "r" else net)
        curve.append([B[i][0], round(bal, 2)])
        pos = None

    def open_pos(i, d, eid, sl_px, tp_px):
        nonlocal pos
        px = bars["open"][i]
        if d * (px - sl_px) <= 0:
            skipped["stop passed at the open"] = skipped.get("stop passed at the open", 0) + 1
            return
        mode, v = s["size"]["mode"], s["size"]["v"]
        if mode == "lots":                   # MT5: the volume typed (0.01 steps); Fyers: whole lots
            lots = int(round(v / float(row.get("vstep") or 0.01))) if charges.is_mt5(row) else int(v)
        else:
            want = bal * v / 100 if mode == "pct" else v
            lots = charges.size_for_risk(row, d, px, sl_px, want)["lots"]
        if not lots:
            skipped["1 lot risks more than the size allows"] = skipped.get("1 lot risks more than the size allows", 0) + 1
            return
        qty = lots if charges.is_mt5(row) else lots * lot
        risk = max(0.0, -charges.net_at(row, d, qty, px, sl_px)["net"])
        tp = tp_px
        if s["target"]["k"] == "r" and risk:
            want = s["target"]["r"] * risk
            lo, hi = px, px + d * max(px, 1) * 2
            for _ in range(60):
                mid = (lo + hi) / 2
                if charges.net_at(row, d, qty, px, mid)["net"] < want:
                    lo = mid
                else:
                    hi = mid
            tp = charges.round_tick(hi, tick, d)
        pos = {"side": d, "qty": qty, "lots": lots, "entry": px, "sl": sl_px, "first_sl": sl_px, "tp": tp, "eid": eid,
               "t": B[i][0], "i": i, "best": px, "be_done": False, "risk": risk}
        dd_ = day_of(B[i][0])
        day_count[dd_] = day_count.get(dd_, 0) + 1

    for i in range(n):
        t, o, h, lo_, c = B[i][0], B[i][1], B[i][2], B[i][3], B[i][4]
        # 1) what the last bar's close decided, at this bar's open
        if pending:
            act = pending
            pending = None
            if pos and act.get("close"):
                close_pos(i, o, act["close"])
            if act.get("open") and not pos:
                open_pos(i, *act["open"])
        # 2) the stop and target inside this bar (a gap through: the open; both: the stop first)
        if pos:
            d = pos["side"]
            if pos["sl"] is not None and (lo_ <= pos["sl"] if d > 0 else h >= pos["sl"]):
                px = min(o, pos["sl"]) if d > 0 else max(o, pos["sl"])
                close_pos(i, px, "trail" if pos.get("trail") else ("be" if pos["be_done"] else "sl"))
            elif pos["tp"] is not None and (h >= pos["tp"] if d > 0 else lo_ <= pos["tp"]):
                px = max(o, pos["tp"]) if d > 0 else min(o, pos["tp"])
                close_pos(i, px, "tp")
        # 3) BE / trail from this bar's best price (they act from the next bar on, as a conservative read)
        if pos:
            d = pos["side"]
            pos["best"] = max(pos["best"], h) if d > 0 else min(pos["best"], lo_)
            R = abs(pos["entry"] - pos["first_sl"])
            if R > 0:
                reached = d * (pos["best"] - pos["entry"]) / R
                be = charges.breakeven(row, d, pos["qty"], pos["entry"], buffer_ticks=be_buf)
                if s["be"]["on"] and not pos["be_done"] and reached >= s["be"]["r"] and d * (c - be) > 0:
                    if d * (be - pos["sl"]) > 0:
                        pos["sl"] = be
                    pos["be_done"] = True
                if s["trail"]["on"] and reached >= s["trail"]["r"]:
                    cand = charges.round_tick(pos["best"] - d * s["trail"]["r"] * R, tick, -d)
                    cand = max(cand, be) if d > 0 else min(cand, be)
                    if d * (cand - pos["sl"]) >= 0.05 * R and d * (c - cand) > 0:
                        pos["sl"] = cand
                        pos["trail"] = True
        # 4) this bar's close: the script's orders
        if i == n - 1:
            break
        sig = read_orders(by_t.get(t), t)
        ent = sig["entry"]
        act = {}
        if pos:
            if sig["close_all"] or pos["eid"] in sig["close"] or "" in sig["close"]:
                act["close"] = "the script closed it"
            elif ent and ent["dir"] != pos["side"]:
                act["close"] = "the script reversed" if Book._allowed(s, ent["dir"]) else "the script's entry the other way"
            elif s["stop"]["k"] == "script" and s["stop"]["follow"]:
                br = sig["bracket"].get(pos["eid"]) or sig["bracket"].get("")
                if br and br.get("stop") is not None:
                    new = charges.round_tick(br["stop"], tick, -pos["side"])
                    if pos["side"] * (new - pos["sl"]) > 0 and pos["side"] * (c - new) > 0:
                        pos["sl"] = new
        if ent and Book._allowed(s, ent["dir"]) and (not pos or act.get("close")):
            d = ent["dir"]
            dkey = day_of(t)
            hm = _utc(t).strftime("%H:%M")
            why = None
            if L["max_day"] and day_count.get(dkey, 0) >= L["max_day"]:
                why = "trades a day"
            elif L["loss_day"] and day_loss.get(dkey, 0) <= -L["loss_day"]:
                why = "daily loss limit"
            elif L["from"] and L["to"] and not (L["from"] <= hm < L["to"] if L["from"] < L["to"] else (hm >= L["from"] or hm < L["to"])):
                why = "trading hours"
            if bal <= 0:
                why = "the balance ran out"
            if why:
                skipped[why] = skipped.get(why, 0) + 1
            else:
                br = sig["bracket"].get(ent["id"]) or sig["bracket"].get("")
                sl_px, err = stop_for(s, d, c, i, bars, plots, br, tick)
                if sl_px is None:
                    skipped["no stop"] = skipped.get("no stop", 0) + 1
                else:
                    tp_px = br.get("limit") if (s["target"]["k"] == "script" and br) else None
                    act["open"] = (d, ent["id"], sl_px, tp_px)
        if act:
            pending = act
    if pos:                                          # still open at the end: valued at the last close, marked open
        close_pos(n - 1, B[-1][4], "still open (valued at the last close)")
    return stats(trades, capital, bal, max_dd, max_dd_pct, curve, skipped)


def stats(trades, capital, bal, max_dd, max_dd_pct, curve, skipped) -> dict:
    n = len(trades)
    wins = [x for x in trades if x["net"] > 0]
    losses = [x for x in trades if x["net"] <= 0]
    rs = [x["r"] for x in trades if x["r"] is not None]
    gw, gl = sum(x["net"] for x in wins), -sum(x["net"] for x in losses)
    months: dict = {}
    for x in trades:
        m = _utc(x["out_t"]).strftime("%Y-%m")
        mm = months.setdefault(m, {"m": m, "n": 0, "net": 0.0, "r": 0.0, "wins": 0})
        mm["n"] += 1
        mm["net"] = round(mm["net"] + x["net"], 2)
        mm["r"] = round(mm["r"] + (x["r"] or 0), 2)
        mm["wins"] += x["net"] > 0
    streak = cur = 0
    for x in trades:
        cur = cur + 1 if x["net"] <= 0 else 0
        streak = max(streak, cur)
    return {"trades": trades, "curve": curve, "months": list(months.values()), "skipped": skipped,
            "st": {"n": n, "wins": len(wins), "losses": len(losses), "win_rate": round(100 * len(wins) / n, 1) if n else None,
                   "net": round(bal - capital, 2), "net_pct": round((bal - capital) / capital * 100, 2) if capital else None,
                   "charges": round(sum(x["charges"] for x in trades), 2),
                   "pf": round(gw / gl, 2) if gl > 0 else None, "avg_win": round(gw / len(wins), 2) if wins else None,
                   "avg_loss": round(-gl / len(losses), 2) if losses else None,
                   "exp_r": round(sum(rs) / len(rs), 2) if rs else None, "sum_r": round(sum(rs), 2) if rs else None,
                   "max_dd": round(max_dd, 2), "max_dd_pct": round(max_dd_pct, 2), "end": round(bal, 2),
                   "best": max((x["net"] for x in trades), default=None), "worst": min((x["net"] for x in trades), default=None),
                   "loss_streak": streak}}


# ================================================================ the helper's hooks
BOOKS: dict = {}


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
