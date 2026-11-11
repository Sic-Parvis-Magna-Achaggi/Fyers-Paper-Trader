"""MT5 accounts (roadmap 8, stage b: slice b1 v0.36.0, b2 / b3 v0.37.0): each MT5 login whose terminal runs the FTM Bridge EA (1.10 or later) is an
account of its own in this app, on the MT5 side of the switch at the top left (PAPER | LIVE | MT5), kept apart from Fyers.

What b1 does: everything about the account comes from MT5 itself, through the EA's sync call (helper/mt5.py):
  - positions, pending orders and the balance / equity / margin, every call (about 4 times a second);
  - MT5's deals (its own history): closed trades are booked from them, exactly as MT5 booked them (price, profit,
    commission, swap); the commission per lot of each symbol is learned from them;
  - trades placed in MT5 itself show and are managed like any other (b1 places nothing: that is slice b2).
Managing from the app moves the REAL stop at the broker: SL / TP drags, BE, BE-T, TRAIL change the position's SL / TP in
MT5 (a MOD command), the close button closes it at market in MT5 (CLOSE), and pending orders can be moved (OMOD) or
cancelled (CANCEL). Commands ride on the answer to the EA's own call (the EA only ever calls out), each with a tag; the
EA reports each result once, and never runs a tag twice. A command whose result never comes is not sent again blindly:
MT5's own state (the next report) shows what happened, and a stop that still differs is simply asked for again.

Money is the account's currency ($), net of the broker's commission (learned from MT5's real deals per symbol, a typed
default until then, a warning if a later deal differs) and the position's swap. The spread is paid through the bid / ask,
as in MT5. FundingPips' loss limits are shown: daily from the balance at the broker's midnight (worked out from MT5's
deals since then), max from the starting size typed for the account.

b2 (EA 1.20): orders placed from the app (the ticket, the chart tool's PLACE): sized like paper (risk %, $ amount or lots in
0.01 steps), margin from MT5's own OrderCalcMargin, the guards (FundingPips' floors, risk cap, ...), and no hedging: nothing
opposite an open trade / pending order on the same symbol in this or the user's other MT5 accounts. An OPEN command carries
the tag the EA puts in the order's comment ("FTM <tag>"): that ties the position / order back to the app's plan (its stop as
1R, its trailing). An OPEN is never sent twice; one not delivered within 10 s is dropped.
b3: the kill switch (close everything, cancel everything, pause new orders until Resume with 2FA); the news guard
(helper/news.py: ForexFactory's high-impact events on the symbol's currencies; Master phase: no opening / closing from the
app ±5 min, evaluation: a warning); TRAIL lines so the EA trails by itself (the same rules) while it can't reach the app,
its moves reported back ("trailed") and taken as the trail, never as a stop moved by hand.

The engine reuses the paper engine's sizing, BE (+ costs) and trailing logic: an MT5 row passed to charges.py has
x == "MT5" and the engine's qty is a whole number of volume steps (0.01 lot), so R, BE and the trail work unchanged."""
from __future__ import annotations

import datetime as dt
import logging
import time

from . import charges, mt5, news, store
from .paper import DEFAULT_RULES, Paper, Refused

log = logging.getLogger("mt5acct")

PREFIX = "mt5-"              # account ids: mt5-<login>
NONE_ID = "mt5-none"         # what the MT5 side shows before any MT5 terminal has called
EA_MIN = "1.10"              # the first EA that reports positions and carries out the app's commands
EA_TRADE = "1.20"            # the first EA that places orders the app sends (OPEN) and trails by itself when the link drops
OPEN_EXPIRE = 10             # an order not yet delivered (MT5 offline) after this long is dropped: never placed late
TRAIL_EVERY = 30             # the EA's offline-trailing table is sent again this often (and at once on a change)
CMD_WAIT = 20                # a sent command with no result after this long is treated as lost (MT5's state decides)
CLOSE_EXPIRE = 20            # a close / cancel not yet delivered (MT5 offline) after this long is dropped: never late
MOD_EXPIRE = 300             # an SL / TP change not yet delivered after this long is dropped (asked again if needed)
MOD_GAP = 2.0                # seconds between two changes of one position or order (FundingPips: no server spamming)
RATE_MIN = 30                # commands a minute per account, at most
GONE_SEC = 15                # a position MT5 no longer reports, with no closing deal seen: booked at its last price
DEALS_DAYS = 90              # a new account's history: MT5's deals from this many days back
DEALS_KEEP = 400             # days of deals kept on the server
BATCH = 200                  # the EA sends at most this many deals a call ("dmore" says there are more)

# The broker's codes (MQL5 enums) the EA sends as numbers
POS_BUY = 0
ORD_TYPES = {2: (1, "limit"), 3: (-1, "limit"), 4: (1, "stop"), 5: (-1, "stop"), 6: (1, "stoplimit"), 7: (-1, "stoplimit")}
DEAL_BUY, DEAL_SELL, DEAL_BALANCE = 0, 1, 2
ENTRY_IN, ENTRY_OUT, ENTRY_INOUT, ENTRY_OUT_BY = 0, 1, 2, 3
REASONS = {0: "closed in MT5", 1: "closed in MT5 (phone)", 2: "closed in MT5 (web)", 3: "closed by an EA", 4: "sl", 5: "tp",
           6: "stop out", 7: "rollover", 8: "variation margin", 9: "split"}
OK_CODES = (10008, 10009, 10010, 10025)      # placed, done, done partly, no changes

# An MT5 account's rules: FundingPips' 2-Step by default (daily 5%, max 10% static); every one is settable.
MT5_RULES = {
    "size": 5000.0,            # the starting size you bought (FundingPips: max loss is counted from it)
    "daily_pct": 5.0, "max_pct": 10.0, "max_mode": "static", "day_from": "balance", "buffer_pct": 0.0,
    "risk_cap_pct": 1.0, "max_margin_pct": 0.0, "max_open_risk_pct": 0.0, "max_trades": 0, "sl_required": True,
    "squareoff_on": False, "stale_sec": 120, "be_buffer_ticks": 0,
    "daily_of": "day",         # the daily % is of: "day" the day's starting balance (FundingPips) or "size" the starting size
    "phase": "evaluation",     # evaluation | master (the news guard, slice b3, depends on it)
    "comm_default": 0.0,       # $ per lot on each deal (opening and closing) until MT5's own deals teach the real figure
    "news_on": True,           # the news guard (ForexFactory's high-impact events on the symbol's currencies)
    "news_min": 5,             # Master: no opening / closing this many minutes either side of the event (FundingPips: 5)
    "news_warn_min": 15,       # a warning this many minutes before one (evaluation: a warning only)
}
MT5_ONLY = ("daily_of", "phase", "comm_default", "news_on", "news_min", "news_warn_min")
MT5_KEYS = ("size", "daily_pct", "max_pct", "max_mode", "day_from", "buffer_pct", "risk_cap_pct", "max_margin_pct",
            "max_open_risk_pct", "max_trades", "sl_required", "be_buffer_ticks") + MT5_ONLY      # what an MT5 account can set
FIXED = {"squareoff_on": False, "stale_sec": 120}      # (Fyers' square-off and expiry rules never apply to MT5)


class NeedLogin(Refused):
    """The first change on an MT5 account: its login must be typed once to confirm (the page asks and retries)."""
    def __init__(self, login: int):
        super().__init__(f"first change on MT5 account {login}: type its login to confirm it's the right account")
        self.login = login


def _f(v, d=0.0):
    try:
        x = float(v)
        return x if x == x and abs(x) < 1e15 else d
    except (TypeError, ValueError):
        return d


def _i(v, d=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return d


def ver_ok(v: str, need: str = EA_MIN) -> bool:
    try:
        return tuple(int(x) for x in str(v).split(".")[:2]) >= tuple(int(x) for x in need.split("."))
    except ValueError:
        return False


class Mt5Engine(Paper):
    mode = "mt5"

    def __init__(self, folder: str, uid: str, login: int, name: str = "", none: bool = False):
        self.uid, self.login, self.none = uid, int(login), none
        self.seen = 0.0                  # when this login's EA last reported
        self.ea = ""
        self.trade = {}                  # the EA's trading switch and the terminal's / MT5's own
        self.acct_mode = ""              # hedge / netting
        self._report_push = 0.0
        super().__init__(folder, None, name or str(login))

    # ------------------------------------------------------------ storage
    def load(self):
        super().load()
        saved = store.load(self.dir + "paper_rules.json") if not self.none else {}
        self.rules = {**DEFAULT_RULES, **MT5_RULES,
                      **{k: v for k, v in saved.items() if k in MT5_KEYS}, **FIXED}
        s = store.load(self.dir + "paper.json") if not self.none else {}
        if not s.get("acct"):
            size = float(self.rules["size"])
            self.acct = {"start": size, "realized": 0.0, "peak": size, "created": time.time(), "cycle": 1}
        if not s.get("ticket"):
            self.ticket.update(mode="pct", risk_pct=0.5, lots=0.01, product="MT5")   # (lots: MT5's volume, 0.01 steps)
        self.ticket["product"] = "MT5"
        d = store.load(self.dir + "mt5_deals.json", {}) if not self.none else {}
        self.deals = {int(k): v for k, v in (d.get("deals") or {}).items()}
        self.booked = set(d.get("booked") or [])
        for h in self.history:
            for t in h.get("deals") or []:
                self.booked.add(t)

    def _load_extra(self, s: dict):
        m = s.get("mt5") or {}
        self.M = {"comm": m.get("comm") or {}, "cmd": m.get("cmd") or {}, "confirmed": True,                # (v0.37.1, owner 11 Nov: no login prompt; the bridge key + 2FA to MT5 suffice)
                  "base": bool(m.get("base")), "sym": m.get("sym") or {}, "seq": int(m.get("seq") or 0),
                  "info": m.get("info") or {}, "caught": bool(m.get("caught")), "size_set": bool(m.get("size_set")),
                  "dreset": bool(m.get("dreset")), "first_seen": m.get("first_seen") or 0, "ea": m.get("ea") or "",
                  "opening": m.get("opening") or {}, "placed": m.get("placed") or {}, "halted": bool(m.get("halted")),
                  "trail_sent": m.get("trail_sent") or {}, "trail_at": 0, "etrail": m.get("etrail") or {},
                  "ppl": m.get("ppl") or {}}      # v0.37.2: $ per 1.00 of price per 1 lot, learned from MT5's own position profit
        self.ea = self.M["ea"]

    def _save_extra(self) -> dict:
        self.M["ea"] = self.ea
        return {"mt5": self.M}

    def save(self):
        if self.none:
            return
        super().save()

    def save_history(self):
        if not self.none:
            super().save_history()

    def save_deals(self):
        if self.none:
            return
        cut = time.time() - DEALS_KEEP * 86400
        self.deals = {k: v for k, v in self.deals.items() if (v.get("tu") or 0) >= cut}
        store.save(self.dir + "mt5_deals.json", {"deals": {str(k): v for k, v in self.deals.items()},
                                                  "booked": sorted(self.booked)[-20000:]})

    # ------------------------------------------------------------ the account
    @property
    def info(self) -> dict:
        return self.M["info"]

    def online(self) -> bool:
        return time.time() - self.seen < mt5.ONLINE_SEC

    def ccy(self) -> str:
        return (self.info.get("currency") or "USD").upper()

    def _clock(self) -> mt5.Clock:
        u = mt5.user(self.uid)
        return u.clock(u.bridges.get(self.login))

    def to_utc(self, srv: float) -> float:
        return float(self._clock().to_utc(srv)) + (srv - int(srv))

    def balance(self) -> float:
        return round(float(self.info["balance"]), 2) if self.info.get("balance") is not None else float(self.rules["size"])

    def equity(self) -> float:
        return round(float(self.info["equity"]), 2) if self.info.get("equity") is not None else self.balance()

    def margin_used(self) -> float:
        return round(float(self.info.get("margin") or 0), 2)

    def free_margin(self, row=None) -> float:
        return round(float(self.info["free"]), 2) if self.info.get("free") is not None else self.equity()

    def trading_day(self, ts=None) -> str:
        """The broker's date (FundingPips: its midnight is New York's 17:00, 03:30 / 02:30 IST)."""
        srv = self._clock().to_srv(ts or time.time())
        return dt.datetime.fromtimestamp(srv, dt.timezone.utc).strftime("%Y-%m-%d")

    def _midnight_srv(self) -> int:
        srv = self._clock().to_srv(time.time())
        return int(srv // 86400 * 86400)

    def _midnight_balance(self):
        """The balance at the broker's midnight: today's balance minus everything MT5 booked since (closed trades'
        profit, commission and swap, and any balance operation)."""
        m = self._midnight_srv()
        moved = sum(_f(d.get("pr")) + _f(d.get("c")) + _f(d.get("sw")) + _f(d.get("fee"))
                    for d in self.deals.values() if _f(d.get("ts")) >= m)
        return round(self.balance() - moved, 2)

    def roll_day(self):
        today = self.trading_day()
        if self.day.get("date") != today:
            fresh = self.online() and time.time() - self._clock().to_utc(self._midnight_srv()) < 900
            self.day = {"date": today, "start_bal": self._midnight_balance(),
                        "start_eq": self.equity() if fresh else None, "trades": 0}
            if not self.none and self.info:
                self.event(f"New trading day {today} (the broker's midnight): balance {self.balance():,.2f} {self.ccy()}")
                self.save()

    def floors(self) -> dict:
        """FundingPips' limits: the daily floor from the balance at the broker's midnight (or the higher of balance and
        equity then, if chosen), minus the daily % of that balance (or of the starting size); the max floor from the
        starting size typed (static), or from the highest balance (trailing)."""
        R, size = self.rules, float(self.rules["size"])
        d = self.day
        sb = d.get("start_bal") if d.get("start_bal") is not None else self.balance()
        se = d.get("start_eq") if d.get("start_eq") is not None else sb
        base = {"balance": sb, "equity": se, "higher": max(sb, se)}.get(R["day_from"], sb)
        daily = base - (base if R.get("daily_of", "day") == "day" else size) * R["daily_pct"] / 100 if R["daily_pct"] else None
        if R["max_pct"]:
            mx = (self.acct["peak"] - size * R["max_pct"] / 100) if R["max_mode"] == "trailing" else size * (1 - R["max_pct"] / 100)
        else:
            mx = None
        return {"daily": daily, "max": mx, "buffer": size * R["buffer_pct"] / 100, "day_base": base}

    # ------------------------------------------------------------ symbols: MT5's own figures
    def row(self, sym, product=None):
        if not isinstance(sym, str) or not sym.startswith(mt5.PREFIX):
            raise Refused("an MT5 account trades MT5 symbols only - Fyers contracts are on PAPER / LIVE (top left)")
        name = sym[len(mt5.PREFIX):]
        si = self.M["sym"].get(name) or {}
        r = mt5.row(self.uid, sym)
        if not r:
            if not si:
                raise Refused(f"{name}: MT5 hasn't sent this symbol's details yet")
            r = {"s": sym, "d": name, "u": name, "lot": 1, "mult": si.get("cs") or 1, "tick": si.get("ts") or 0.01, "exp": 0,
                 "k": None, "o": "", "f": "CFD", "x": "MT5", "g": "MT5", "on": True, "sess": "", "frz": "", "it": None,
                 "mt5": {"digits": si.get("dg"), "tick_value": si.get("tv"), "vstep": si.get("vs"), "contract": si.get("cs")}}
        m = r.get("mt5") or {}
        tick = si.get("ts") or r.get("tick") or 0.01
        tv, src, rep = self.tick_value(name, tick, m)
        out = {**r, "lot": 1, "prod": "MT5", "tick": tick, "tv": tv, "tv_src": src, "tv_mt5": rep,
               "vstep": si.get("vs") or m.get("vstep") or 0.01,
               "comm": self.comm_for(name), "digits": si.get("dg") if si.get("dg") is not None else m.get("digits")}
        return out

    def tick_value(self, name: str, tick: float, m: dict | None = None) -> tuple:
        """What one tick is worth on 1 lot, in the account's currency: (value, where from, what MT5 reported).
        v0.37.2 (owner, 11 Nov: the app showed -$3.78 at the stop, MT5 -$217.94): MT5's SYMBOL_TRADE_TICK_VALUE isn't
        trusted alone. In order: (1) learned from MT5's own profit on an open position of the symbol (what MT5 really
        pays); (1b) EA 1.21's OrderCalcProfit for 1 lot over a 1.00 move; (2) tick size x contract size, when the symbol's profit currency is the account's (XAUUSD on a $ account:
        0.01 x 100 = $1); (3) MT5's reported tick value. A reported figure off by more than 2% is flagged."""
        si = self.M["sym"].get(name) or {}
        m = m if m is not None else ((mt5.row(self.uid, mt5.PREFIX + name) or {}).get("mt5") or {})
        rep = float(si.get("tv") or m.get("tick_value") or 0.0)
        cs = float(si.get("cs") or m.get("contract") or 0.0)
        cp = str(m.get("cprofit") or "").upper()
        learned = float((self.M.get("ppl") or {}).get(name) or 0.0)
        pp = float(si.get("pp") or 0.0)
        if learned > 0:
            tv, src = learned * tick, "learned from MT5's profit on your position"
        elif pp > 0:
            tv, src = pp * tick, "MT5's own profit sum (OrderCalcProfit)"
        elif cs > 0 and cp and cp == self.ccy():
            tv, src = tick * cs, f"tick size x contract size ({cs:g})"
        elif rep > 0:
            tv, src = rep, "MT5's tick value"
        else:
            tv, src = 0.0, ""
        if rep > 0 and tv > 0 and src != "MT5's tick value" and abs(rep - tv) / tv > 0.02:
            self._warn_once(f"tv:{name}", f"{name}: MT5 reported a tick value of {rep:g} {self.ccy()} per lot, but {src} gives "
                                          f"{tv:g} - the app uses {tv:g}")
        return round(tv, 10), src, rep

    def _learn_value(self, name: str, side: int, vol: float, open_px: float, cur: float, profit: float) -> None:
        """$ per 1.00 of price per lot from MT5's own figure for an open position (profit before commission and swap)."""
        si = self.M["sym"].get(name) or {}
        ts = float(si.get("ts") or 0.01)
        d = side * (cur - open_px)
        if vol <= 0 or not profit or abs(d) < 20 * ts or profit * d <= 0:
            return
        ppl = profit / (d * vol)
        L = self.M.setdefault("ppl", {})
        old = float(L.get(name) or 0)
        if old and abs(ppl - old) / old < 0.005:
            return
        if not old or abs(ppl - old) / old > 0.05:
            self.event(f"{name}: MT5's profit on your position shows {ppl:g} {self.ccy()} per 1.00 move per lot"
                       + (f" (was {old:g})" if old else "") + " - used for every figure from now on", "info")
        L[name] = round(ppl, 6)

    def comm_for(self, name: str) -> dict:
        L = self.M["comm"].get(name) or {}
        d = float(self.rules.get("comm_default") or 0)
        return {"in": L["in"] if L.get("in") is not None else d, "out": L["out"] if L.get("out") is not None else d}

    def vol(self, pos_or_row, qty) -> float:
        row = pos_or_row if "vstep" in pos_or_row else self.row(pos_or_row["s"])
        return round(qty * float(row["vstep"]), 8)

    def steps(self, row, volume: float) -> int:
        return max(0, int(round(float(volume) / float(row["vstep"] or 0.01))))

    def _rnd(self, row, px):
        """A price as MT5 has it (to the symbol's digits); 0 / None = no stop."""
        if px in (None, "", 0) or _f(px) <= 0:
            return None
        dg = row.get("digits")
        return round(float(px), int(dg)) if dg is not None else round(float(px), 6)

    def _same(self, row, a, b) -> bool:
        if a is None or b is None:
            return a is None and b is None
        return abs(float(a) - float(b)) < float(row.get("tick") or 0.01) / 2

    # ------------------------------------------------------------ the EA's report (helper/mt5.py's sync, on the loop)
    def on_report(self, body: dict, bridge) -> list:
        """One sync call from this login's EA: results of the app's commands, MT5's deals, positions and pending orders,
        the account's figures. Returns the lines to send back (DEALS, and the commands waiting)."""
        t = time.time()
        self.seen = t
        self.ea = str(body.get("ea") or "")[:12]
        info = dict(bridge.info or {})
        info["at"] = t
        old_bal = self.info.get("balance")
        self.M["info"] = info
        self.acct_mode = info.get("mode") or ""
        tr = body.get("trade") or {}
        self.trade = {"on": bool(tr.get("on")), "term": bool(tr.get("term", True)), "mql": bool(tr.get("mql", True))}
        if not self.M["first_seen"]:
            self.M["first_seen"] = t
        changed = False
        for name, v in (body.get("sym") or {}).items():
            if isinstance(v, list) and len(v) >= 5 and mt5.NAME_RE.match(str(name)):
                si = {"tv": _f(v[0]), "ts": _f(v[1]), "vs": _f(v[2]) or 0.01, "cs": _f(v[3]), "dg": _i(v[4])}
                if len(v) >= 10:                   # EA 1.20: margin for 1 lot (buy, sell), volume min / max, stops level
                    si.update(mb=_f(v[5]), ms=_f(v[6]), vmin=_f(v[7]), vmax=_f(v[8]), sl=_i(v[9]))
                if len(v) >= 11 and _f(v[10]) > 0:  # EA 1.21: MT5's OrderCalcProfit for 1 lot over a 1.00 rise
                    si["pp"] = _f(v[10])
                self.M["sym"][name] = si
        for r in body.get("res") or []:
            changed |= self._result(r)
        for r in body.get("trailed") or []:         # stops the EA moved itself while the link was down (1.20)
            if isinstance(r, list) and len(r) >= 2 and _i(r[0]) > 0:
                self.M["etrail"].setdefault(str(_i(r[0])), []).append([_f(r[1]), time.time()])
        nd = self._take_deals(body.get("deals") or [])
        if nd:
            changed = True
        if "dmore" in body and _i(body.get("dcur")) and not self.M["dreset"]:
            self.M["caught"] = not body.get("dmore")      # (only once the EA's deal cursor runs: DEALS was answered)
        changed |= self._take_positions(body.get("pos") or [])
        changed |= self._take_orders(body.get("ord") or [])
        if not self.M["base"]:
            self.M["base"] = True
            changed = True
        if not self.M["size_set"]:
            first = self._first_deposit()
            sz = first or (self.balance() if self.info.get("balance") else None)
            if sz and abs(sz - float(self.rules["size"])) > 0.005:
                self.rules["size"] = round(sz, 2)
                self.acct.update(start=self.rules["size"])
                store.save(self.dir + "paper_rules.json", self.rules)
        self.roll_day()
        if self.M["caught"] or nd:
            self.day["start_bal"] = self._midnight_balance()
        bal = self.balance()
        if bal > self.acct.get("peak", 0):
            self.acct["peak"] = bal
        self.acct["realized"] = round(bal - float(self.acct.get("start") or bal), 2)
        lines = []
        dcur = _i(body.get("dcur"))
        if dcur == 0 or self.M["dreset"]:
            lines.append(f"DEALS {self._deals_from()}")
            self.M["dreset"] = False
            self.M["caught"] = False
        self._lost()
        self._push_all()
        lines += self._out()
        lines += self._trail_lines(force=dcur == 0)
        if changed:
            self.changed(None)
        elif self.on_change and (old_bal != self.info.get("balance") or t - self._report_push > 1.0):
            self._report_push = t
            self.on_change(None)                  # balance, equity, MT5's figures: the page every second at most
        return lines

    def _first_deposit(self):
        bals = sorted((d for d in self.deals.values() if d.get("ty") == DEAL_BALANCE and _f(d.get("pr")) > 0),
                      key=lambda d: (d.get("ts"), d.get("t")))
        return round(_f(bals[0]["pr"]), 2) if bals else None

    def _deals_from(self) -> int:
        """Where the EA's deal cursor starts (server time): a little before the newest deal known, or DEALS_DAYS back."""
        srv_now = self._clock().to_srv(time.time())
        if self.deals and not self.M.get("refetch"):
            return int(max(_f(d.get("ts")) for d in self.deals.values()) - 3600)
        self.M.pop("refetch", None)
        return int(srv_now - DEALS_DAYS * 86400)

    def resync(self):
        """Ask the EA for MT5's deals again from DEALS_DAYS back (anything already booked is skipped)."""
        self.M["dreset"] = True
        self.M["refetch"] = True
        self.M["caught"] = False
        self.changed("Asked MT5 for its deals again (the last %d days)" % DEALS_DAYS)

    # ------------------------------------------------------------ deals: history, commission, the day's start
    def _take_deals(self, rows: list) -> int:
        n = 0
        rows = [r for r in rows if isinstance(r, list) and len(r) >= 16]
        rows.sort(key=lambda r: (_f(r[12]), _i(r[0])))
        for r in rows:
            tk = _i(r[0])
            if tk <= 0 or tk in self.deals:
                continue
            d = {"t": tk, "o": _i(r[1]), "pid": _i(r[2]), "s": str(r[3])[:40], "ty": _i(r[4]), "en": _i(r[5]), "v": _f(r[6]),
                 "p": _f(r[7]), "c": _f(r[8]), "sw": _f(r[9]), "pr": _f(r[10]), "fee": _f(r[11]), "ts": _f(r[12]) / 1000.0,
                 "mg": _i(r[13]), "cm": str(r[14])[:40], "rs": _i(r[15])}
            d["tu"] = round(self.to_utc(d["ts"]), 3)
            self.deals[tk] = d
            n += 1
            live = bool(self.M["first_seen"]) and d["tu"] >= float(self.M["first_seen"]) - 5   # (not MT5's older history)
            if d["ty"] in (DEAL_BUY, DEAL_SELL) and d["v"] > 0:
                self._learn(d, live)
                if d["en"] == ENTRY_IN:
                    self._in_deal(d)
                elif d["en"] in (ENTRY_OUT, ENTRY_OUT_BY):
                    self._book_out(d)
                elif d["en"] == ENTRY_INOUT:
                    self.event(f"{d['s']}: a reversing deal (netting account) - not tracked here; check MT5", "warn")
        if n:
            self.save_deals()
            self.save_history()
        return n

    def _learn(self, d: dict, live: bool):
        """The broker's commission per lot for this symbol, from a real deal ("in" opening, "out" closing)."""
        leg = "in" if d["en"] == ENTRY_IN else "out"
        rate = round(-(d["c"] + d["fee"]) / d["v"], 4)
        L = self.M["comm"].setdefault(d["s"], {})
        old = L.get(leg)
        tol = max(0.01, 0.02 * abs(old or 0), 0.0051 / d["v"])     # (MT5 rounds each deal's commission to the cent)
        if old is not None and abs(old - rate) <= tol:
            if d["v"] < float(L.get(leg + "_v") or 0):           # the same rate: a bigger deal's figure is the more exact
                L[leg + "_n"] = int(L.get(leg + "_n") or 0) + 1
                return
        elif old is not None and live:
            self.event(f"{d['s']}: MT5 charged {rate:g} {self.ccy()} a lot on this {'opening' if leg == 'in' else 'closing'} deal; "
                       f"the app had learned {old:g} - it uses the new figure from now on", "warn")
            L["diff"] = {"leg": leg, "was": old, "now": rate, "at": d["tu"], "deal": d["t"]}
        elif old is None and live:
            dflt = float(self.rules.get("comm_default") or 0)
            if abs(dflt - rate) > max(0.01, 0.02 * abs(dflt)):
                self.event(f"{d['s']}: learned the commission from MT5's deal: {rate:g} {self.ccy()} a lot "
                           f"({'opening' if leg == 'in' else 'closing'}); your typed default was {dflt:g}")
        L[leg] = rate
        L[leg + "_v"] = d["v"]
        L[leg + "_n"] = int(L.get(leg + "_n") or 0) + 1
        L["at"] = d["tu"]

    def _in_deal(self, d: dict):
        """An opening deal of a position the app already shows: its real entry commission."""
        pos = next((p for p in self.positions if p.get("pid_mt") == d["pid"]), None)
        if pos and pos.get("comm_est"):
            pos["comm_in"] = round(-(d["c"] + d["fee"]), 2)
            pos["comm_est"] = False
            pos["paid"] = round(pos["comm_in"] - _f(pos.get("swap")), 2)

    def _book_out(self, d: dict):
        """A closing deal: books the part (or all) of the position it closed, with MT5's own price, profit, commission
        and swap. A deal older than when the app first saw the position, or of a position never seen (its history),
        is booked from its opening deal."""
        if d["t"] in self.booked:
            return
        pos = next((p for p in self.positions if p.get("pid_mt") == d["pid"]), None)
        est = next((h for h in self.history if h.get("est") and h.get("pid_mt") == d["pid"]), None)
        if est is not None:                        # booked from its last price when it vanished: replace with the deal
            self.history = [h for h in self.history if h is not est]
        if pos and d["ts"] >= _f(pos.get("seen_srv")) - 1:
            row = self.row(pos["s"])
            n = min(pos["qty"], max(1, self.steps(row, d["v"])))
            rec = self._record(pos, [d], n, est)
            self.history.append(rec)
            self.booked.add(d["t"])
            if n >= pos["qty"]:
                self.positions = [p for p in self.positions if p["id"] != pos["id"]]
                self._symbols_changed()
            else:
                k = n / pos["qty"]
                pos["qty"] -= n
                pos["init_risk"] = round(pos["init_risk"] * (1 - k), 2)
                pos["comm_in"] = round(pos["comm_in"] * (1 - k), 2)
                pos["paid"] = round(pos["comm_in"] - _f(pos.get("swap")), 2)
                pos["parts"] = int(pos.get("parts") or 0) + 1
            self._note_close(rec)
            return
        ins = [x for x in self.deals.values() if x["pid"] == d["pid"] and x["en"] == ENTRY_IN]
        self.booked.add(d["t"])
        if not ins:
            return                                 # opened before the deals MT5 sent: in the balance, not the history
        rec = self._record_hist(ins, d)
        self.history.append(rec)
        if self.M["first_seen"] and d["tu"] >= float(self.M["first_seen"]) - 5 and not est:
            self._note_close(rec)                  # (closed in MT5 while the app watched, before it saw the position)

    def _note_close(self, rec: dict):
        self.event(f"Closed {rec['sym']} {rec['lots']:g} lot @ {rec['exit']:g} ({rec['reason']}): net {rec['net']:,.2f} {self.ccy()} "
                   f"(profit {rec['gross']:,.2f}, commission {rec['charges']['commission']:,.2f}, swap {-rec['charges']['swap']:,.2f})"
                   + (f", {rec['r']:+.2f}R" if rec.get("r") is not None else ""), "warn" if rec["net"] < 0 else "info")

    def _reason(self, pos: dict | None, d: dict) -> str:
        rs = d.get("rs")
        ex = (pos or {}).get("exiting") or {}
        if ex.get("why") and rs in (3, None):      # closed by the app's CLOSE (MT5: "by an expert")
            return ex["why"]
        if rs == 4 and pos:
            at_be = pos.get("be_done") or (pos.get("sl") is not None and pos["side"] * (pos["sl"] - pos["avg"]) >= 0)
            return "trail sl" if pos.get("trail") else ("be" if at_be else "sl")
        return REASONS.get(rs, "closed in MT5")

    def _charges(self, comm_in: float, comm_out: float, swap: float) -> dict:
        c = {k: 0.0 for k in charges.FIELDS}
        c["commission"] = round(comm_in + comm_out, 4)
        c["swap"] = round(-swap, 4)                # a cost is positive (a swap credit is a negative cost)
        c["total"] = round(c["commission"] + c["swap"], 2)
        c["tax_name"] = ""
        return c

    def _record(self, pos: dict, ds: list, n: int, est=None) -> dict:
        row = self.row(pos["s"])
        v = sum(x["v"] for x in ds) or 1e-9
        exit_px = round(sum(x["p"] * x["v"] for x in ds) / v, 8)
        gross = round(sum(x["pr"] for x in ds), 2)
        comm_out = -sum(x["c"] + x["fee"] for x in ds)
        swap = sum(x["sw"] for x in ds)
        k = n / pos["qty"] if pos["qty"] else 1
        comm_in = float(pos.get("comm_in") or 0) * k
        ch = self._charges(comm_in, comm_out, swap)
        net = round(gross - ch["total"], 2)
        risk = round(float(pos.get("init_risk") or 0) * k, 2)
        closed = max(x["tu"] for x in ds)
        part = n < pos["qty"] or pos.get("parts")
        pid = pos["id"] + (f"p{int(pos.get('parts') or 0) + 1}" if n < pos["qty"] or pos.get("parts") else "")
        path = (pos.get("path") or [[pos["opened"], pos.get("first_sl"), pos.get("tp"), "open"]])
        return {"id": pid, "s": pos["s"], "sym": pos["s"][len(mt5.PREFIX):], "side": pos["side"], "product": "MT5",
                "lots": round(n * row["vstep"], 8), "qty": n, "lot": 1, "mult": row.get("mult") or 1,
                "entries": [{"t": pos["opened"], "qty": n, "price": pos["avg"]}], "avg": pos["avg"], "exit": exit_px,
                "opened": pos["opened"], "closed": closed, "reason": self._reason(pos, ds[-1]),
                "first_sl": pos.get("first_sl"), "sl": pos.get("sl"), "tp": pos.get("tp"), "basis": "self", "ref": None,
                "best": pos.get("best"), "worst": pos.get("worst"), "gross": gross, "charges": ch, "net": net,
                "init_risk": risk, "r": round(net / risk, 2) if risk else None, "balance_after": self.balance(),
                "day": self.trading_day(closed), "src": "mt5" if pos.get("outside") else "app", "ticket": pos.get("ticket"),
                "pid_mt": pos.get("pid_mt"), "deals": [x["t"] for x in ds], "ccy": self.ccy(), "part": bool(part),
                "comm_est": bool(pos.get("comm_est")), "path": path + ([[closed, pos.get("sl"), pos.get("tp"), "edit"]]
                                                                        if path and (pos.get("sl"), pos.get("tp")) != tuple(path[-1][1:3]) else [])}

    def _record_hist(self, ins: list, d: dict) -> dict:
        """A trade from MT5's history (closed before the app saw it, or while it wasn't watching)."""
        side = 1 if ins[0]["ty"] == DEAL_BUY else -1
        vin = sum(x["v"] for x in ins) or 1e-9
        avg = round(sum(x["p"] * x["v"] for x in ins) / vin, 8)
        k = min(1.0, d["v"] / vin)
        comm_in = -sum(x["c"] + x["fee"] for x in ins) * k
        ch = self._charges(comm_in, -(d["c"] + d["fee"]), d["sw"])
        s = mt5.PREFIX + d["s"]
        try:
            row = self.row(s)
            vstep, mult = row["vstep"], row.get("mult") or 1
        except Refused:
            vstep, mult = 0.01, 1
        opened = min(x["tu"] for x in ins)
        net = round(d["pr"] - ch["total"], 2)
        return {"id": f"P{d['pid']}" + ("" if abs(d["v"] - vin) < 1e-9 else f"d{d['t']}"), "s": s, "sym": d["s"], "side": side,
                "product": "MT5", "lots": round(d["v"], 8), "qty": int(round(d["v"] / vstep)), "lot": 1, "mult": mult,
                "entries": [{"t": x["tu"], "qty": int(round(x["v"] / vstep)), "price": x["p"]} for x in ins], "avg": avg,
                "exit": d["p"], "opened": opened, "closed": d["tu"], "reason": self._reason(None, d), "first_sl": None,
                "sl": None, "tp": None, "basis": "self", "ref": None, "best": None, "worst": None, "gross": round(d["pr"], 2),
                "charges": ch, "net": net, "init_risk": 0.0, "r": None, "balance_after": None,
                "day": self.trading_day(d["tu"]), "src": "mt5", "ticket": d["pid"], "pid_mt": d["pid"], "deals": [d["t"]],
                "ccy": self.ccy(), "from_history": True,
                "path": [[opened, None, None, "open"]]}

    # ------------------------------------------------------------ positions
    def _take_positions(self, rows: list) -> bool:
        changed = False
        seen = set()
        t = time.time()
        srv_now = self._clock().to_srv(t)
        first = not self.M["base"]
        for r in rows:
            if not isinstance(r, list) or len(r) < 14:
                continue
            tk, name = _i(r[0]), str(r[1])
            if tk <= 0 or not mt5.NAME_RE.match(name):
                continue
            seen.add(tk)
            side = 1 if _i(r[2]) == POS_BUY else -1
            vol, po, sl, tp, pc, sw, pr = _f(r[3]), _f(r[4]), _f(r[5]), _f(r[6]), _f(r[7]), _f(r[8]), _f(r[9])
            tmsc, magic, cm, ident = _f(r[10]), _i(r[11]), str(r[12])[:40], _i(r[13]) or tk
            s = mt5.PREFIX + name
            try:
                row = self.row(s)
            except Refused as e:
                self._warn_once(f"row:{name}", f"{name}: {e}")
                continue
            sl, tp = self._rnd(row, sl), self._rnd(row, tp)
            pos = next((p for p in self.positions if p.get("ticket") == tk), None)
            mt = {"sl": sl, "tp": tp, "pc": pc, "profit": round(pr, 2), "swap": round(sw, 2), "vol": vol, "at": t}
            self._learn_value(name, side, vol, po, pc, pr)
            if pos is None:
                pos = self._adopt(row, tk, ident, side, vol, po, sl, tp, sw, tmsc, magic, cm, srv_now, first)
                pos["mt"] = mt
                changed = True
                continue
            pos["mt"] = mt
            pos.pop("gone", None)
            pos["swap"] = round(sw, 2)
            pos["paid"] = round(float(pos.get("comm_in") or 0) - sw, 2)
            n = self.steps(row, vol)
            if n != pos["qty"]:
                since = pos.setdefault("qty_diff", t)
                if n > pos["qty"] or t - since > 10:    # (a smaller volume: its closing deal books the part, normally)
                    self.event(f"{name} #{tk}: MT5 shows {vol:g} lot, the app had {self.vol(row, pos['qty']):g} - taking MT5's", "warn")
                    if n > pos["qty"]:
                        pos["avg"] = po
                    pos["qty"], pos["max_qty"] = n, max(pos.get("max_qty", n), n)
                    pos.pop("qty_diff", None)
                    changed = True
            else:
                pos.pop("qty_diff", None)
            pend = self._cmd_for(tk, "MOD")
            et0 = self.M["etrail"].get(str(tk)) or []
            if pend and not pend["sent"] and sl is not None and any(self._same(row, sl, v[0]) for v in et0) \
                    and (pos.get("sl") is None or pos["side"] * (sl - pos["sl"]) > 0):
                self.M["cmd"].pop(pend["tag"], None)       # (an older trail step queued when the link dropped: the EA's
                pend = None                                 # tighter stop wins, never loosened back)
            if not self._same(row, sl, pos.get("b_sl")) or not self._same(row, tp, pos.get("b_tp")):
                if not pend:
                    # moved at MT5, not by the app: by the EA's own trailing while the link was down (1.20), else by hand
                    # in MT5 or another EA - MT5's stop is the stop now
                    if not self._same(row, sl, pos.get("sl")) or not self._same(row, tp, pos.get("tp")):
                        et = self.M["etrail"].pop(str(tk), None) or []
                        if sl is not None and self._same(row, tp, pos.get("tp")) and any(self._same(row, sl, v[0]) for v in et):
                            self._ea_trailed(pos, row, sl)
                        else:
                            self._adopt_stops(pos, row, sl, tp)
                        changed = True
                pos["b_sl"], pos["b_tp"] = sl, tp
        for pos in list(self.positions):
            if pos.get("ticket") in seen:
                continue
            if not pos.get("gone"):
                pos["gone"] = t
            elif t - pos["gone"] > GONE_SEC:
                self._book_gone(pos)
                changed = True
        return changed

    def _adopt(self, row, tk, ident, side, vol, po, sl, tp, sw, tmsc, magic, cm, srv_now, first) -> dict:
        n = self.steps(row, vol)
        ins = [x for x in self.deals.values() if x["pid"] == ident and x["en"] == ENTRY_IN]
        if ins:
            comm_in, est = round(-sum(x["c"] + x["fee"] for x in ins), 2), False
        else:
            comm_in, est = round(float(row["comm"]["in"]) * vol, 2), True
        opened = self.to_utc(tmsc / 1000.0) if tmsc else time.time()
        outside = not cm.startswith("FTM")
        meta = self._placed_meta(cm)
        pos = {"id": f"P{tk}", "ticket": tk, "pid_mt": ident, "s": row["s"], "side": side, "product": "MT5", "qty": n,
               "max_qty": n, "avg": po, "paid": round(comm_in - sw, 2), "comm_in": comm_in, "comm_est": est, "swap": round(sw, 2),
               "charges": charges.mt5_comm(row, n, "in"), "entries": [{"t": opened, "qty": n, "price": po, "charges": {}, "how": "MT5"}],
               "basis": "self", "ref": None, "ref_entry": None, "delta": None, "sl": sl, "first_sl": sl, "tp": tp, "floor": None,
               "init_risk": 0.0, "opened": opened, "best": po, "worst": po, "basis_entry": po, "basis_best": po,
               "be_done": False, "trail": False, "own_stop": False, "margin": 0, "tr": dict(self.trail),
               "outside": outside, "magic": magic, "comment": cm, "b_sl": sl, "b_tp": tp, "seen_srv": srv_now,
               "found": bool(first)}
        if meta:                                   # placed from the app: its planned stops and trailing
            pos["sl"] = pos["first_sl"] = meta.get("sl") if meta.get("sl") is not None else sl
            pos["tp"] = meta.get("tp") if meta.get("tp") is not None else tp
            pos["tr"] = dict(meta.get("tr") or self.trail)
        self.positions.append(pos)
        if pos["sl"] is not None:
            pos["init_risk"] = round(self.pos_risk(pos), 2)
        if tmsc and tmsc / 1000.0 >= self._midnight_srv():
            self.day["trades"] = self.day.get("trades", 0) + 1
        self._symbols_changed()
        what = "Already open in MT5" if first else ("Opened in MT5" if outside else "Opened (from the app)")
        self.event(f"{what}: {'LONG' if side > 0 else 'SHORT'} {row['u']} {vol:g} lot @ {po:g} (#{tk})"
                   + (f", SL {sl:g}" if sl else ", no SL") + (f", TP {tp:g}" if tp else ""), "info" if sl else "warn")
        return pos

    def _ea_trailed(self, pos, row, sl):
        """The EA moved the stop itself while the link to the app was down (Trail BE / Trail SL, as set here)."""
        be = self._be_price(pos)
        pos["sl"] = sl
        pos["_pk"] = "trail"
        if pos["side"] * (sl - be) >= -float(row.get("tick") or 0.01) / 2:
            pos["be_done"] = True
        if not self._same(row, sl, be) and (pos.get("tr") or self.trail).get("sl_on"):
            pos["trail"] = True
        pos.pop("mt_err", None)
        self.event(f"{row['u']} #{pos['ticket']}: the EA trailed the stop to {sl:g} while the link was down")

    def _placed_meta(self, cm: str):
        """An MT5 position / order whose comment is "FTM <tag>" came from the app's OPEN with that tag."""
        cm = str(cm or "")
        if not cm.startswith("FTM "):
            return None
        tag = cm[4:].strip().split(" ")[0]
        self.M["opening"].pop(tag, None)
        return self.M["placed"].get(tag)

    def _tag_seen(self, tag: str) -> bool:
        c = "FTM " + tag
        return any(p.get("comment") == c for p in self.positions) or any(o.get("comment") == c for o in self.orders) \
            or any(d.get("cm") == c for d in self.deals.values())

    def _op_text(self, op) -> str:
        if not op:
            return "the order"
        return (f"{'BUY' if op['side'] > 0 else 'SELL'} {op['type'].upper()} {op['s'][len(mt5.PREFIX):]} {op['vol']:g} lot"
                + (f" @ {op['price']:g}" if op.get("price") else ""))

    def _adopt_stops(self, pos, row, sl, tp):
        """SL / TP changed in MT5 itself: MT5's are the trade's stops now (the app stops trailing a stop moved by hand)."""
        name, msgs = row["u"], []
        if not self._same(row, sl, pos.get("sl")):
            if sl is None:
                pos["sl"] = None
                msgs.append("SL removed in MT5")
            elif pos.get("first_sl") is None:
                pos["sl"] = pos["first_sl"] = sl
                pos["init_risk"] = round(self.pos_risk(pos), 2)
                msgs.append(f"first SL {sl:g} set in MT5 (1R)")
            else:
                pos["sl"] = sl
                pos["own_stop"] = True
                pos["trail"] = False
                msgs.append(f"SL moved in MT5 to {sl:g}")
        if not self._same(row, tp, pos.get("tp")):
            pos["tp"] = tp
            msgs.append(f"TP {'removed' if tp is None else 'moved'} in MT5" + (f" to {tp:g}" if tp else ""))
        pos["_pk"] = "edit"
        pos.pop("mt_err", None)
        if msgs:
            self.event(f"{name} #{pos['ticket']}: " + ", ".join(msgs), "warn" if sl is None else "info")

    def _book_gone(self, pos):
        """MT5 stopped reporting a position and no closing deal came: booked at its last price, marked as an estimate
        (replaced by MT5's deal if it arrives later)."""
        row = self.row(pos["s"])
        mt = pos.get("mt") or {}
        px = self.exit_mark(pos)
        fake = {"t": 0, "v": self.vol(row, pos["qty"]), "p": px, "pr": float(mt.get("profit") or 0), "c": 0.0, "fee": 0.0,
                "sw": float(pos.get("swap") or 0), "tu": time.time(), "rs": None, "cm": ""}
        fake["c"] = -float(row["comm"]["out"]) * fake["v"]
        rec = self._record(pos, [fake], pos["qty"])
        rec.update(est=True, deals=[], reason="closed in MT5 (no deal seen yet)")
        self.history.append(rec)
        self.positions = [p for p in self.positions if p["id"] != pos["id"]]
        self.save_history()
        self._symbols_changed()
        self.event(f"{row['u']} #{pos['ticket']}: gone from MT5 without a closing deal - booked at {px:g} as an estimate "
                   "(MT5's deal replaces it when it arrives)", "warn")

    # ------------------------------------------------------------ pending orders
    def _take_orders(self, rows: list) -> bool:
        changed = False
        seen = set()
        for r in rows:
            if not isinstance(r, list) or len(r) < 12:
                continue
            tk, name, typ = _i(r[0]), str(r[1]), _i(r[2])
            if tk <= 0 or typ not in ORD_TYPES or not mt5.NAME_RE.match(name):
                continue
            seen.add(tk)
            side, kind = ORD_TYPES[typ]
            s = mt5.PREFIX + name
            try:
                row = self.row(s)
            except Refused as e:
                self._warn_once(f"row:{name}", f"{name}: {e}")
                continue
            vcur, price, sl, tp = _f(r[4]), _f(r[5]), self._rnd(row, _f(r[6])), self._rnd(row, _f(r[7]))
            price = self._rnd(row, price)
            o = next((x for x in self.orders if x.get("ticket") == tk), None)
            if o is None:
                self._placed_meta(str(r[10]))         # (an order from the app: no longer "on its way")
                n = self.steps(row, vcur)
                o = {"id": f"O{tk}", "ticket": tk, "s": s, "side": side, "type": kind, "product": "MT5", "basis": "self",
                     "qty": n, "lots": round(vcur, 8), "price": price, "sl": sl, "tp": tp, "ref": None, "ref_price": None,
                     "delta": None, "margin": 0, "created": self.to_utc(_f(r[8]) / 1000.0) if _f(r[8]) else time.time(),
                     "outside": not str(r[10]).startswith("FTM"), "b_price": price, "b_sl": sl, "b_tp": tp,
                     "stoplimit": _f(r[11]) or None, "mt_type": typ, "comment": str(r[10])[:40]}
                o["risk"] = round(self.order_risk(o), 2)
                self.orders.append(o)
                self._symbols_changed()
                self.event(f"{'Pending order found' if not self.M['base'] else 'Pending order placed'} in MT5: "
                           f"{'BUY' if side > 0 else 'SELL'} {kind.upper()} {name} {vcur:g} lot @ {price:g} (#{tk})")
                changed = True
                continue
            o["qty"], o["lots"] = self.steps(row, vcur), round(vcur, 8)
            pend = self._cmd_for(tk, "OMOD")
            moved = not self._same(row, price, o.get("b_price")) or not self._same(row, sl, o.get("b_sl")) \
                or not self._same(row, tp, o.get("b_tp"))
            if moved:
                if not pend and (not self._same(row, price, o["price"]) or not self._same(row, sl, o.get("sl"))
                                 or not self._same(row, tp, o.get("tp"))):
                    o["price"], o["sl"], o["tp"] = price, sl, tp
                    self.event(f"{name} order #{tk} changed in MT5: @ {price:g}, SL {sl}, TP {tp}")
                    changed = True
                o["b_price"], o["b_sl"], o["b_tp"] = price, sl, tp
        for o in list(self.orders):
            if o.get("ticket") in seen:
                continue
            self.orders = [x for x in self.orders if x["id"] != o["id"]]
            self._symbols_changed()
            filled = any(p.get("pid_mt") == o["ticket"] or p.get("ticket") == o["ticket"] for p in self.positions)
            self.event(f"{self.short(o['s'])} order #{o['ticket']} " + ("filled" if filled else
                       "cancelled" + (" from the app" if o.get("cancel_req") else " (in MT5, or expired)")))
            changed = True
        return changed

    # ------------------------------------------------------------ commands to the EA
    def _tag(self) -> str:
        self.M["seq"] = (self.M["seq"] + 1) % 100000
        return f"F{int(time.time()) % 10**7:07d}{self.M['seq']:05d}"

    def _cmd_for(self, ticket, kind=None):
        return next((c for c in self.M["cmd"].values() if c["ticket"] == ticket and (kind is None or c["k"] == kind)), None)

    def _cmd(self, k: str, ticket: int, args: str, why: str = "") -> dict:
        tag = self._tag()
        c = {"k": k, "tag": tag, "ticket": ticket, "args": args, "made": time.time(), "sent": None, "why": why}
        self.M["cmd"][tag] = c
        return c

    def _push_all(self):
        """Every position's / order's SL, TP (and price) as the app wants them vs what MT5 has: a change goes to MT5."""
        if not self.M["confirmed"] or self.none:
            return
        for p in self.positions:
            if p.get("gone") or p.get("exiting") or not p.get("ticket"):
                continue
            row = self.row(p["s"])
            if self._same(row, p.get("sl"), p.get("b_sl")) and self._same(row, p.get("tp"), p.get("b_tp")):
                continue
            args = f"{p['ticket']} {self._fmt(row, p.get('sl'))} {self._fmt(row, p.get('tp'))}"
            c = self._cmd_for(p["ticket"], "MOD")
            if c and not c["sent"]:
                c["args"] = args                  # not sent yet: the newest stop replaces it
            elif not c and time.time() >= float(p.get("retry_at") or 0):
                self._cmd("MOD", p["ticket"], args, "stop")
        for o in self.orders:
            if o.get("cancel_req") or not o.get("ticket"):
                continue
            row = self.row(o["s"])
            if self._same(row, o["price"], o.get("b_price")) and self._same(row, o.get("sl"), o.get("b_sl")) \
                    and self._same(row, o.get("tp"), o.get("b_tp")):
                continue
            args = f"{o['ticket']} {self._fmt(row, o['price'])} {self._fmt(row, o.get('sl'))} {self._fmt(row, o.get('tp'))}"
            c = self._cmd_for(o["ticket"], "OMOD")
            if c and not c["sent"]:
                c["args"] = args
            elif not c and time.time() >= float(o.get("retry_at") or 0):
                self._cmd("OMOD", o["ticket"], args, "order")

    @staticmethod
    def _fmt(row, px) -> str:
        if px is None:
            return "0"
        dg = row.get("digits")
        return f"{float(px):.{int(dg)}f}" if dg is not None else repr(float(px))

    def _out(self) -> list:
        """The commands to send now (this answer is the only way they reach MT5). Each is marked sent and saved before
        it goes, so a restart never sends it again."""
        if not self.online():
            return []
        t = time.time()
        out = []
        recent = [c for c in self.M.get("sent_log") or [] if t - c < 60]
        last_by = self.M.setdefault("last_by", {})
        for tag, c in sorted(self.M["cmd"].items(), key=lambda kv: kv[1]["made"]):
            if c["sent"]:
                continue
            exp = OPEN_EXPIRE if c["k"] == "OPEN" else CLOSE_EXPIRE if c["k"] in ("CLOSE", "CANCEL") else MOD_EXPIRE
            if t - c["made"] > exp:
                self.M["cmd"].pop(tag, None)
                self._expired(c)
                continue
            if len(recent) >= RATE_MIN:
                break
            if c["k"] in ("MOD", "OMOD") and t - float(last_by.get(str(c["ticket"])) or 0) < MOD_GAP:
                continue
            c["sent"] = t
            recent.append(t)
            last_by[str(c["ticket"])] = t
            out.append(f"{c['k']} {c['tag']} {c['args']}")
        self.M["sent_log"] = recent
        if out:
            self.save()
        return out

    def _expired(self, c):
        if c["k"] == "OPEN":
            op = self.M["opening"].pop(c["tag"], None)
            self.event(f"{self._op_text(op) if op else 'An order'}: MT5 wasn't connected for {OPEN_EXPIRE} s - NOT placed", "warn")
            return
        if c["k"] == "CLOSE":
            p = next((x for x in self.positions if x.get("ticket") == c["ticket"]), None)
            if p:
                p["exiting"] = None
                p["mt_err"] = "MT5 wasn't connected: not closed"
            self.event(f"#{c['ticket']}: MT5 wasn't connected for {CLOSE_EXPIRE} s - the close was dropped, NOT sent", "warn")
        elif c["k"] == "CANCEL":
            o = next((x for x in self.orders if x.get("ticket") == c["ticket"]), None)
            if o:
                o.pop("cancel_req", None)
            self.event(f"order #{c['ticket']}: MT5 wasn't connected - the cancel was dropped, NOT sent", "warn")

    def _lost(self):
        """Sent, but no result after CMD_WAIT: never sent again as it was. MT5's reports show what happened: a stop that
        still differs is asked for again by _push_all; a close of a position still open is sent once more (closing a
        ticket twice can't close anything else)."""
        t = time.time()
        for tag, c in list(self.M["cmd"].items()):
            if not c["sent"] or t - c["sent"] < CMD_WAIT:
                continue
            self.M["cmd"].pop(tag, None)
            if c["k"] == "OPEN":                   # never sent again: MT5's own reports (its comment "FTM <tag>") show it
                op = self.M["opening"].get(tag)
                if op and not self._tag_seen(tag):
                    op["unsure"] = time.time()
                    self.event(f"MT5 didn't confirm {self._op_text(op)}; nothing with its tag is in MT5 yet - the app won't send "
                               "it again: check MT5 before placing it again", "warn")
                continue
            if c["k"] == "CLOSE":
                p = next((x for x in self.positions if x.get("ticket") == c["ticket"]), None)
                if p and p.get("exiting"):
                    tries = int(p["exiting"].get("tries") or 1)
                    if tries < 2:
                        n = self._cmd("CLOSE", c["ticket"], c["args"], c["why"])
                        p["exiting"].update(tag=n["tag"], tries=tries + 1)
                        self.event(f"#{c['ticket']}: MT5 didn't confirm the close - asking once more", "warn")
                    else:
                        p["exiting"] = None
                        p["mt_err"] = "MT5 didn't confirm the close"
                        self.event(f"#{c['ticket']}: MT5 didn't confirm the close twice - close it in MT5", "warn")
            else:
                self.event(f"#{c['ticket']}: MT5 didn't answer the {c['k']} change - checking its state", "warn")

    def _result(self, r) -> bool:
        if not isinstance(r, list) or len(r) < 4:
            return False
        tag, ok, ret, msg = str(r[0]), bool(_i(r[1])), _i(r[2]), str(r[3])[:200]
        c = self.M["cmd"].pop(tag, None)
        if not c:
            return False
        ok = ok or ret in OK_CODES
        if c["k"] == "OPEN":
            op = self.M["opening"].get(tag)
            if ok:
                if op:
                    op.update(ticket=_i(r[4]) if len(r) > 4 else 0, done=time.time())
                self.event(f"MT5 placed {self._op_text(op) if op else 'the order'} (#{_i(r[4]) if len(r) > 4 else '?'})")
            else:
                self.M["opening"].pop(tag, None)
                self.event(f"MT5 refused {self._op_text(op) if op else 'the order'}: {msg} ({ret})", "warn")
            return True
        tk = c["ticket"]
        p = next((x for x in self.positions if x.get("ticket") == tk), None)
        o = next((x for x in self.orders if x.get("ticket") == tk), None)
        if ok:
            for x in (p, o):
                if x is not None:
                    x.pop("mt_err", None)
                    x.pop("retry_at", None)
                    x.pop("backoff", None)
            if c["k"] == "CLOSE" and p and p.get("exiting"):
                p["exiting"]["done"] = time.time()
            return True
        why = f"MT5 refused {'closing' if c['k'] == 'CLOSE' else 'cancelling' if c['k'] == 'CANCEL' else 'the change'} "\
              f"on #{tk}: {msg} ({ret})"
        x = p or o
        if x is not None:
            x["mt_err"] = f"{msg} ({ret})"
            if c["k"] in ("MOD", "OMOD"):
                b = min(60.0, float(x.get("backoff") or 2.5) * 2)
                x["backoff"], x["retry_at"] = b, time.time() + b
            if c["k"] == "CLOSE" and p:
                p["exiting"] = None
            if c["k"] == "CANCEL" and o:
                o.pop("cancel_req", None)
        self.event(why, "warn")
        return True

    # ------------------------------------------------------------ what the page can do
    siblings = None                                # set by rt.py: () -> the user's other MT5 accounts (the no-hedging check)

    def _block(self, need: str = EA_MIN):
        """Why nothing can be changed at the broker right now (None: it can)."""
        if self.none:
            return "no MT5 account yet: start MT5 on your laptop with the FTM Bridge EA (Settings › MT5 bridge)"
        if not ver_ok(self.ea, need):
            return (f"the EA on this terminal is {self.ea or 'old'}: install FTM Bridge {need} (Settings › MT5 bridge)"
                    + (" to place orders from the app" if need == EA_TRADE else " so the app can manage this account's trades"))
        if not self.online():
            return "MT5 isn't connected (start MT5 with the FTM Bridge EA): nothing can be changed at the broker now"
        if self.trade and not self.trade.get("on"):
            return "trading from the app is off in the EA's inputs (AllowTrading = false)"
        if self.trade and not (self.trade.get("term") and self.trade.get("mql")):
            return "MT5's Algo Trading is off (the button at the top of MT5, or the EA's 'Allow Algo Trading' box)"
        return None

    def _writable(self, need: str = EA_MIN, confirm: bool = True):
        why = self._block(need)
        if why:
            raise Refused(why)
        if confirm and not self.M["confirmed"]:
            raise NeedLogin(self.login)

    def confirm(self, typed) -> None:
        if str(typed or "").strip() != str(self.login):
            raise Refused(f"that isn't this account's login ({self.login})")
        self.M["confirmed"] = True
        self.changed(f"MT5 account {self.login} confirmed: the app can now place, move and close its trades")

    # ---- placing (b2)
    def margin_per_lot(self, row, side, product, price) -> tuple:
        """Margin for one volume step, from MT5's own OrderCalcMargin (EA 1.20 sends it per symbol for 1 lot)."""
        si = self.M["sym"].get(row["s"][len(mt5.PREFIX):]) or {}
        m = si.get("mb" if side > 0 else "ms")
        if m:
            return float(m) * float(row["vstep"]), "mt5"
        return None, "unknown"

    def fetch_margin(self, row, side, product):
        return None                                # (MT5 sends it: no Fyers call)

    def plan(self, req: dict, place=False) -> dict:
        if self.none:
            raise Refused(self._block())
        row = self.row(req.get("s"))               # (a Fyers contract: refused here)
        s = row["s"]
        if s not in self.temp_watch:               # this terminal streams the symbol from now on (its own prices)
            self.temp_watch[s] = time.time() + 300
            self._symbols_changed()
        self.temp_watch[s] = time.time() + 300
        req = dict(req)
        if not req.get("_steps"):
            req["_steps"] = True
            req["product"], req["basis"] = "MT5", "self"
            if req.get("mode") == "lots":          # the page's lots are MT5's volume (0.05 lot); the engine counts steps
                req["lots"] = int(round(float(req.get("lots") or 0) / float(row["vstep"])))
        if not (self.px(s).get("bid") or self.px(s).get("ltp")):
            raise Refused(f"waiting for {row['u']}'s price from MT5 {self.login} (its terminal streams it from now)")
        if not row.get("tv"):
            raise Refused(f"{row['u']}: the value of a price move isn't known yet (MT5 hasn't sent the symbol's details)")
        out = super().plan(req, place)
        si = self.M["sym"].get(row["u"]) or {}
        steps = int(out.get("lots") or 0)
        vmin = int(round(float(si.get("vmin") or row["vstep"]) / float(row["vstep"])))
        vmax = int(round(float(si.get("vmax") or 0) / float(row["vstep"]))) if si.get("vmax") else 0
        if steps and steps < vmin and not out.get("blocked"):
            out["blocked"] = f"Blocked: {steps * row['vstep']:g} lot is under MT5's minimum volume ({vmin * row['vstep']:g})"
        if vmax and steps > vmax:
            out["notes"].append(f"cut to MT5's maximum volume ({vmax * row['vstep']:g} lot)")
            steps = vmax
        out.update(steps=steps, lots=round(steps * float(row["vstep"]), 8), vol=round(steps * float(row["vstep"]), 8),
                   ccy=self.ccy(), product="MT5",
                   per_move=round(float(row["tv"]) / float(row["tick"]), 6), tv_src=row.get("tv_src"))   # (v0.37.2: shown on the ticket)
        if out.get("risk_1lot") is not None:
            out["risk_1step"] = out["risk_1lot"]
        w = self._news_note(row)
        if w:
            out["notes"].append(w)
        hb = self._hedge_block(out)
        if hb:                                     # (no hedging is the reason that matters, whatever else is said)
            out["blocked"] = hb
        sym = "$" if self.ccy() == "USD" else self.ccy() + " "
        one = f"{float(row['vstep']):g} lot"       # (the paper engine's words: ₹ and "1 lot" = one step here)
        fix = lambda t: t.replace("₹", sym).replace("1 lot ", one + " ") if isinstance(t, str) else t
        out["blocked"] = fix(out.get("blocked"))
        out["notes"] = [fix(n) for n in out["notes"]]
        return out

    def guard_new(self, o) -> str | None:
        return (self._block(EA_TRADE) or ("Blocked: new orders are paused by the MT5 kill switch (Resume on the Account page)"
                                          if self.M["halted"] else None)
                or self._hedge_block(o) or self._news_block(o.get("s"), "opening") or super().guard_new(o))

    def _hedge_block(self, o) -> str | None:
        """FundingPips (10 Nov 2026): no hedging, even in Hedge mode - no opposite trade on the same symbol in this account,
        and (to be safe) not across your MT5 accounts either. The same side, or another symbol, is fine."""
        s, side = o.get("s"), o.get("side")
        name = str(s)[len(mt5.PREFIX):]
        for e in [self] + list(self.siblings() if self.siblings else []):
            where = "in this account" if e is self else f"in MT5 account {e.login}"
            for p in e.positions:
                if p["s"] == s and p["side"] != side and not p.get("gone"):
                    return (f"Blocked: no hedging (FundingPips) - you have a {'LONG' if p['side'] > 0 else 'SHORT'} {name} open "
                            f"{where}; close it first")
            for x in e.orders:
                if x["s"] == s and x["side"] != side and not x.get("cancel_req"):
                    return f"Blocked: no hedging (FundingPips) - there's an opposite pending {name} order {where}; cancel it first"
            for x in e.M["opening"].values():
                if x["s"] == s and x["side"] != side:
                    return f"Blocked: no hedging (FundingPips) - an opposite {name} order is on its way to MT5 {where}"
        return None

    def place(self, req: dict) -> dict:
        self._writable(EA_TRADE)
        p = self.plan(req, place=True)
        if p.get("blocked"):
            raise Refused(p["blocked"])
        if p["type"] not in ("market", "limit", "stop"):
            raise Refused("market, limit or stop")
        row = self.row(p["s"])
        vol = round(p["steps"] * float(row["vstep"]), 8)
        if vol <= 0:
            raise Refused("0 lots")
        price = p["entry"] if p["type"] != "market" else None
        args = (f"{row['u']} {p['side']} {p['type']} {vol:.8g} {self._fmt(row, price)} {self._fmt(row, p.get('sl'))} "
                f"{self._fmt(row, p.get('tp'))}")
        c = self._cmd("OPEN", 0, args, "open")
        op = {"tag": c["tag"], "s": p["s"], "side": p["side"], "type": p["type"], "vol": vol, "steps": p["steps"],
              "price": price, "sl": p.get("sl"), "tp": p.get("tp"), "risk": p.get("risk"), "made": time.time(), "ticket": None}
        self.M["opening"][c["tag"]] = op
        self.M["placed"][c["tag"]] = {"s": p["s"], "side": p["side"], "sl": p.get("sl"), "tp": p.get("tp"),
                                      "tr": dict(self.trail), "at": time.time()}
        self.changed(f"{self._op_text(op)} sent to MT5" + (f", SL {p['sl']:g}" if p.get("sl") is not None else "")
                     + (f", TP {p['tp']:g}" if p.get("tp") is not None else "") + (f", risk {p['risk']:,.2f} {self.ccy()} net"
                                                                                  if p.get("risk") is not None else ""))
        return p

    def reset(self, capital: float):
        raise Refused("an MT5 account's balance is MT5's own: it can't be reset here")

    # ---- the news guard (b3): ForexFactory's high-impact events (helper/news.py)
    def _curs(self, row) -> set:
        m = row.get("mt5") or {}
        return {str(c).upper() for c in (m.get("cbase"), m.get("cprofit"), m.get("cmargin")) if c}

    def _news_block(self, s, what: str) -> str | None:
        """Master phase: no opening or closing from N minutes before to N minutes after a high-impact release on the
        symbol's currencies (FundingPips, 10 Nov 2026). Evaluation: no block (a warning instead)."""
        R = self.rules
        if not R.get("news_on") or R.get("phase") != "master" or not s:
            return None
        try:
            row = self.row(s)
        except Refused:
            return None
        ev = news.inside(self._curs(row), float(R.get("news_min") or 5))
        if ev:
            return (f"Blocked: FundingPips Master - no {what} {R.get('news_min'):g} min either side of high-impact news: "
                    f"{ev['cur']} {ev['title']} at {news.ist(ev['t'])} IST")
        return None

    def _news_note(self, row) -> str | None:
        R = self.rules
        if not R.get("news_on"):
            return None
        ev = news.next_event(self._curs(row), float(R.get("news_warn_min") or 15), float(R.get("news_min") or 5))
        if not ev:
            return None
        t = f"high-impact {ev['cur']} news: {ev['title']} at {news.ist(ev['t'])} IST"
        return (t + " - purposely trading news is prohibited in the evaluation (FundingPips)") if R.get("phase") != "master" else t

    # ---- the kill switch (b3)
    def kill(self) -> None:
        """Close every position and cancel every order of this account at MT5 (and orders on their way), then refuse new
        orders until Resume. No login, no news window: it must be quick."""
        why = self._block()
        self.M["halted"] = True
        for tag, c in list(self.M["cmd"].items()):
            if c["k"] == "OPEN" and not c["sent"]:
                self.M["cmd"].pop(tag, None)
                self.M["opening"].pop(tag, None)
        if why:
            self.changed(f"KILL SWITCH: new orders paused - but {why}: close the trades in MT5 itself", "warn")
            raise Refused(f"new orders are paused, but {why}: close the trades in MT5 itself")
        for p in self.positions:
            if not p.get("exiting"):
                self._close(p, "kill")
        for o in self.orders:
            if not o.get("cancel_req"):
                self._cmd("CANCEL", o["ticket"], str(o["ticket"]), "kill")
                o["cancel_req"] = time.time()
        self.changed("KILL SWITCH: closing everything in MT5 and cancelling its orders; new orders paused until Resume", "warn")

    def resume(self) -> None:
        self.M["halted"] = False
        self.changed("Trading resumed (MT5 kill switch off)")

    # ---- the EA's own trailing while the link is down (b3)
    def _trail_spec(self, p):
        """What the EA needs to go on trailing this trade by itself (the same rules as here): Trail BE's trigger and BE +
        costs price, Trail SL's start, distance and floor (BE + costs), the smallest step."""
        if p.get("gone") or p.get("exiting") or p.get("first_sl") is None or not p.get("ticket"):
            return None
        R = abs(p["basis_entry"] - p["first_sl"])
        tr = p.get("tr") or self.trail
        if R <= 0 or not (tr.get("be_on") and not p.get("be_done")) and not (tr.get("sl_on") and not p.get("own_stop")):
            return None
        row = self.row(p["s"])
        be = self._be_price(p)
        side = p["side"]
        be_t = be_p = sl_s = sl_d = 0.0
        if tr.get("be_on") and not p.get("be_done"):
            be_t, be_p = p["basis_entry"] + side * tr["be_r"] * R, be
        if tr.get("sl_on") and not p.get("own_stop"):
            sl_s, sl_d = p["basis_entry"] + side * tr["sl_r"] * R, tr["sl_r"] * R
        f = lambda v: self._fmt(row, v) if v else "0"
        return f"{side} {f(be_t)} {f(be_p)} {f(sl_s)} {sl_d:.8g} {f(be)} {0.05 * R:.8g}"

    def _trail_lines(self, force=False) -> list:
        """TRAIL <ticket> <side> <best> <BE trigger> <BE price> <SL start> <SL distance> <floor> <min step> for each trade
        with trailing on (TRAIL <ticket> 0: off). Sent on a change, and all of them every TRAIL_EVERY s (and after an EA
        restart). The EA uses them only when it hasn't reached the app for a while."""
        if not ver_ok(self.ea, EA_TRADE) or not self.M["confirmed"]:
            return []
        t = time.time()
        every = force or t - float(self.M.get("trail_at") or 0) > TRAIL_EVERY
        sent = self.M["trail_sent"]
        out, now_keys = [], set()
        for p in self.positions:
            spec = self._trail_spec(p)
            k = str(p.get("ticket"))
            if spec is None:
                if k in sent:
                    out.append(f"TRAIL {k} 0")
                    sent.pop(k, None)
                continue
            now_keys.add(k)
            if every or sent.get(k) != spec:
                row = self.row(p["s"])
                side = p["side"]
                parts = spec.split(" ")
                out.append(f"TRAIL {k} {parts[0]} {self._fmt(row, p.get('basis_best'))} " + " ".join(parts[1:]))
                sent[k] = spec
        for k in [k for k in sent if k not in now_keys and not any(str(p.get("ticket")) == k for p in self.positions)]:
            sent.pop(k, None)
        if every:
            self.M["trail_at"] = t
        return out

    def changed(self, msg=None, lvl="info"):
        try:
            self._push_all()
        except Exception as e:                     # (never let a stop push stop the save)
            log.exception("[%s] push: %s", self.login, e)
        super().changed(msg, lvl)

    def modify_pos(self, pid, sl="keep", tp="keep"):
        self._writable()
        pos = self.find_pos(pid)
        if pos.get("exiting"):
            raise Refused("it's being closed in MT5")
        super().modify_pos(pid, sl=sl, tp=tp)
        row = self.row(pos["s"])
        pos["sl"], pos["tp"] = self._rnd(row, pos.get("sl")), self._rnd(row, pos.get("tp"))
        pos.pop("retry_at", None)
        pos.pop("backoff", None)
        self.changed()

    def be_now(self, pid):
        self._writable()
        super().be_now(pid)

    def set_pos_trail(self, pid, new: dict):
        self._writable()
        super().set_pos_trail(pid, new)

    def set_trail(self, new: dict):
        if self.positions:
            self._writable()                       # (the panel's trailing also changes every open trade)
        super().set_trail(new)

    def close_now(self, pid, reason="manual"):
        self._writable()
        pos = self.find_pos(pid)
        nb = self._news_block(pos["s"], "closing")
        if nb:
            raise Refused(nb + " (MT5's own SL / TP still work)")
        if pos.get("exiting"):
            raise Refused("already closing in MT5")
        self._close(pos, reason)
        self.changed(f"{self.short(pos['s'])} #{pos['ticket']}: close sent to MT5")

    def _close(self, pos, why):
        c = self._cmd("CLOSE", pos["ticket"], f"{pos['ticket']} 0", why)
        pos["exiting"] = {"at": time.time(), "why": why, "tag": c["tag"], "tries": 1}
        mod = self._cmd_for(pos["ticket"], "MOD")
        if mod and not mod["sent"]:
            self.M["cmd"].pop(mod["tag"], None)

    def close_all(self):
        self._writable()
        for p in self.positions:
            nb = self._news_block(p["s"], "closing")
            if nb:
                raise Refused(nb + " - use the kill switch if you must")
        for p in self.positions:
            if not p.get("exiting"):
                self._close(p, "manual")
        for o in self.orders:
            if not o.get("cancel_req"):
                self._cmd("CANCEL", o["ticket"], str(o["ticket"]), "manual")
                o["cancel_req"] = time.time()
        self.changed("Close all: sent to MT5")

    def cancel(self, oid, quiet=False):
        self._writable()
        o = next((x for x in self.orders if x["id"] == oid), None)
        if not o:
            raise Refused("that order is already gone")
        if o.get("cancel_req"):
            raise Refused("already cancelling in MT5")
        self._cmd("CANCEL", o["ticket"], str(o["ticket"]), "manual")
        o["cancel_req"] = time.time()
        self.changed(f"{self.short(o['s'])} order #{o['ticket']}: cancel sent to MT5")

    def modify_order(self, oid, price="keep", sl="keep", tp="keep"):
        self._writable()
        o = next((x for x in self.orders if x["id"] == oid), None)
        if not o:
            raise Refused("that order is already gone")
        if o.get("type") == "stoplimit" and price != "keep":
            raise Refused("a stop-limit order's price is moved in MT5 itself")
        super().modify_order(oid, price=price, sl=sl, tp=tp)
        row = self.row(o["s"])
        o["price"], o["sl"], o["tp"] = self._rnd(row, o["price"]), self._rnd(row, o.get("sl")), self._rnd(row, o.get("tp"))
        o.pop("retry_at", None)
        self.changed()

    def set_rules(self, new: dict):
        new = dict(new)
        extra = {k: new.pop(k) for k in list(new) if k in MT5_ONLY}
        for k in [k for k in new if k not in MT5_KEYS]:
            new.pop(k)                             # (the Indian-only rules don't apply here)
        if "daily_of" in extra and extra["daily_of"] not in ("day", "size"):
            raise Refused("daily % of: day (the day's starting balance) or size (the starting size)")
        if "phase" in extra and extra["phase"] not in ("evaluation", "master"):
            raise Refused("phase: evaluation or master")
        if "comm_default" in extra:
            try:
                extra["comm_default"] = float(extra["comm_default"])
            except (TypeError, ValueError):
                raise Refused("commission: a number (per lot, each deal)")
            if extra["comm_default"] < 0:
                raise Refused("commission can't be negative")
        if "size" in new and float(new["size"] or 0) != float(self.rules["size"]):
            self.M["size_set"] = True
        self.rules.update(extra)
        super().set_rules(new)
        self.acct["start"] = float(self.rules["size"])

    # ------------------------------------------------------------ prices: this login's own terminal only
    def on_tick(self, t: dict):
        s = str(t.get("s") or "")
        if not s.startswith(mt5.PREFIX):
            return
        lg = t.get("lg")
        if lg is not None and _i(lg) != self.login:
            return
        super().on_tick(t)

    def exit_mark(self, pos) -> float:
        """The price it would close at now: the bid (long) / ask (short) from this terminal's ticks, else MT5's own current
        price for the position (before the first tick arrives)."""
        p = self.px(pos["s"])
        if p.get("bid") or p.get("ltp"):
            return super().exit_mark(pos)
        return float((pos.get("mt") or {}).get("pc") or pos["avg"])

    def _check_order(self, o) -> bool:
        return False                               # MT5 fills its own orders

    def _check_pos(self, pos) -> bool:
        """MT5's own SL / TP close the trade. The app only trails (moving MT5's stop) - and if its own stop or target is
        passed before MT5 has taken the change (refused, or still on its way), it closes the trade at the market."""
        own = self.px(pos["s"])
        if not own.get("ltp") or pos.get("gone"):
            return False
        try:
            row = self.row(pos["s"])
        except Refused:
            return False
        side = pos["side"]
        mark = self.exit_mark(pos)
        ltp = float(own["ltp"])
        pos["best"] = max(pos["best"], ltp) if side > 0 else min(pos["best"], ltp)
        pos["worst"] = min(pos["worst"], ltp) if side > 0 else max(pos["worst"], ltp)
        pos["basis_best"] = max(pos["basis_best"], ltp) if side > 0 else min(pos["basis_best"], ltp)
        if pos.get("exiting") or not self.M["confirmed"]:
            return False
        sl, bsl = pos.get("sl"), pos.get("b_sl")
        if sl is not None and side * (mark - sl) <= 0 and not (bsl is not None and side * (bsl - sl) >= -row["tick"] / 2):
            if self.online():
                self._close(pos, "sl (the app's stop: MT5 hadn't taken it yet)")
                self.changed(f"{row['u']} #{pos['ticket']}: price passed the app's stop {sl:g} before MT5 had it - closing at market", "warn")
                return True
        tp, btp = pos.get("tp"), pos.get("b_tp")
        if tp is not None and side * (mark - tp) >= 0 and not (btp is not None and side * (btp - tp) <= row["tick"] / 2):
            if self.online():
                self._close(pos, "tp (the app's target: MT5 hadn't taken it yet)")
                self.changed(f"{row['u']} #{pos['ticket']}: price reached the app's target {tp:g} before MT5 had it - closing at market")
                return True
        return self._trail_pos(pos, row, ltp, side)

    def housekeeping(self):
        if self.none:
            return
        self.roll_day()
        n = len(self.M["cmd"])
        self._lost()
        t = time.time()
        for tag, c in list(self.M["cmd"].items()):
            if not c["sent"] and t - c["made"] > (OPEN_EXPIRE if c["k"] == "OPEN" else CLOSE_EXPIRE if c["k"] in ("CLOSE", "CANCEL")
                                                  else MOD_EXPIRE):
                self.M["cmd"].pop(tag, None)
                self._expired(c)
        for tag, op in list(self.M["opening"].items()):   # placed, but no position / order appeared: stop showing it
            if (op.get("done") and t - op["done"] > 60) or (op.get("unsure") and t - op["unsure"] > 300):
                self.M["opening"].pop(tag, None)
                n = -1
        for tag, m in list(self.M["placed"].items()):
            if t - float(m.get("at") or 0) > 30 * 86400:
                self.M["placed"].pop(tag, None)
        for k, v in list(self.M["etrail"].items()):
            if all(t - x[1] > 3600 for x in v):
                self.M["etrail"].pop(k, None)
        if len(self.M["cmd"]) != n:
            self.changed()
        elif self._dirty_at and t - self._dirty_at > 10:
            self.save()

    def _warn_once(self, key, msg):
        w = self.M.setdefault("warned", {})
        if time.time() - float(w.get(key) or 0) > 3600:
            w[key] = time.time()
            self.event(msg, "warn")

    # ------------------------------------------------------------ for the page
    def watch_symbols(self) -> list:
        t = time.time()
        self.temp_watch = {s: u for s, u in self.temp_watch.items() if u > t}
        return sorted({p["s"] for p in self.positions} | {o["s"] for o in self.orders}
                      | {x["s"] for x in self.M["opening"].values()} | set(self.temp_watch))

    def pos_view(self, pos) -> dict:
        v = super().pos_view(pos)
        row = self.row(pos["s"])
        vol = self.vol(row, pos["qty"])
        c = self._cmd_for(pos.get("ticket"), "MOD")
        v.update(lots=vol, vol=vol, ticket=pos.get("ticket"), outside=bool(pos.get("outside")), mt=pos.get("mt"),
                 swap=pos.get("swap"), comm_in=pos.get("comm_in"), comm_est=bool(pos.get("comm_est")),
                 exiting=pos.get("exiting"), mt_err=pos.get("mt_err"), b_sl=pos.get("b_sl"), b_tp=pos.get("b_tp"),
                 pend=("sent" if c["sent"] else "queued") if c else None, gone=bool(pos.get("gone")),
                 comm_out=round(float(row["comm"]["out"]) * vol, 2), found=bool(pos.get("found")))
        if v.get("at_be"):
            v["be_covers"] = round(float(pos["paid"]) + float(row["comm"]["out"]) * vol, 2)
        return v

    def order_view(self, o) -> dict:
        v = super().order_view(o)
        c = self._cmd_for(o.get("ticket"))
        v.update(pend=(c["k"], "sent" if c["sent"] else "queued") if c else None, vol=o.get("lots"))
        return v

    def snapshot(self) -> dict:
        s = super().snapshot()
        f = self.floors()
        eq = self.equity()
        R = self.rules
        info = {k: self.info.get(k) for k in ("login", "server", "company", "name", "currency", "balance", "equity", "margin",
                                               "free", "leverage", "mode", "demo", "trade_allowed", "ea_allowed")}
        comm = {n: {**self.comm_for(n), **{k: v for k, v in L.items() if k in ("in_n", "out_n", "at", "diff")}}
                for n, L in self.M["comm"].items()}
        breach = []
        if f["daily"] is not None and eq < f["daily"]:
            breach.append(f"equity {eq:,.2f} is under the daily floor {f['daily']:,.2f}")
        if f["max"] is not None and eq < f["max"]:
            breach.append(f"equity {eq:,.2f} is under the max-loss floor {f['max']:,.2f}")
        warnings = []
        if not self.none:
            if not self.online():
                warnings.append("MT5 isn't connected: figures as last heard" + (
                    f" ({int(time.time() - self.seen)} s ago)" if self.seen else ""))
            elif not ver_ok(self.ea):
                warnings.append(f"the EA on this terminal is {self.ea or 'old'}: install FTM Bridge {EA_MIN} to see and manage trades")
            elif self.trade and not self.trade.get("on"):
                warnings.append("trading from the app is off in the EA's inputs (AllowTrading): the app shows the account but "
                                "can't move stops or close")
            elif self.trade and not (self.trade.get("term") and self.trade.get("mql")):
                warnings.append("MT5's Algo Trading is off: the app can't move stops or close until it's on")
            if self.acct_mode and self.acct_mode != "hedge":
                warnings.append(f"this account is in {self.acct_mode} mode: the app is built for Hedge accounts")
            if not self.M["caught"] and self.M["base"]:
                warnings.append("MT5's history is still arriving: today's start and the history may change")
            if self.M["halted"]:
                warnings.append("KILL SWITCH: new orders are paused on this account (Resume on the Account page)")
            if ver_ok(self.ea) and not ver_ok(self.ea, EA_TRADE):
                warnings.append(f"EA {self.ea}: install FTM Bridge {EA_TRADE} to place orders from the app (managing works)")
            if R.get("news_on"):
                for p in self.positions:
                    try:
                        row = self.row(p["s"])
                    except Refused:
                        continue
                    ev = news.next_event(self._curs(row), float(R.get("news_warn_min") or 15), float(R.get("news_min") or 5))
                    if ev:
                        warnings.append(f"{row['u']}: high-impact {ev['cur']} news ({ev['title']}) at {news.ist(ev['t'])} IST"
                                        + (" - Master: no opening or closing from the app around it; MT5's own SL / TP can "
                                           "still fire inside the window" if R.get("phase") == "master" else ""))
                        break
        vals = []                                  # v0.37.2: what a 1.00 move is worth on 1 lot, per symbol, and where from
        for name in sorted(set(self.M["sym"]) | set(self.M.get("ppl") or {})):
            try:
                rw = self.row(mt5.PREFIX + name)
            except Refused:
                continue
            if rw.get("tv") and rw.get("tick"):
                vals.append({"s": name, "per": round(rw["tv"] / rw["tick"], 6), "src": rw.get("tv_src"),
                             "mt5": round(rw["tv_mt5"] / rw["tick"], 6) if rw.get("tv_mt5") else None})
        s.update(ccy=self.ccy(), mt5={
            "values": vals,
            "login": self.login, "none": self.none, "online": self.online(), "seen": int(self.seen) or None,
            "ea": self.ea, "ea_ok": ver_ok(self.ea), "ea_min": EA_MIN, "trade": self.trade, "confirmed": self.M["confirmed"],
            "info": info, "comm": comm, "comm_default": R.get("comm_default"), "phase": R.get("phase"),
            "daily_of": R.get("daily_of"), "size_set": self.M["size_set"], "first_deposit": self._first_deposit(),
            "day_start": self.day.get("start_bal"), "day_start_eq": self.day.get("start_eq"), "day_base": f.get("day_base"),
            "breach": breach, "warnings": warnings, "caught": self.M["caught"], "deals": len(self.deals),
            "cmds": len(self.M["cmd"]), "midnight_ist": self._midnight_ist(), "halted": self.M["halted"],
            "ea_trade": ver_ok(self.ea, EA_TRADE), "ea_trade_min": EA_TRADE, "news": self._news_list(),
            "news_src": news.status(),
            "opening": [{"tag": k, "text": self._op_text(v), "s": v["s"], "side": v["side"], "sent": bool(
                (self.M["cmd"].get(k) or {}).get("sent")), "ticket": v.get("ticket"), "unsure": bool(v.get("unsure"))}
                for k, v in self.M["opening"].items()]})
        return s

    def _news_list(self) -> list:
        """The next 24 h of high-impact events on the currencies of this account's symbols (open, pending, on the ticket)."""
        curs = set()
        for s in {p["s"] for p in self.positions} | {o["s"] for o in self.orders} | set(self.temp_watch):
            try:
                curs |= self._curs(self.row(s))
            except Refused:
                pass
        return [{**e, "ist": news.ist(e["t"])} for e in news.upcoming(curs or {"USD"}, 24 * 3600)][:20]

    def _midnight_ist(self) -> str:
        m = self._clock().day_ist()
        return f"{m // 60:02d}:{m % 60:02d}"


def empty(uid: str) -> Mt5Engine:
    """The MT5 side before any terminal has called: an empty account (nothing saved)."""
    return Mt5Engine(f"u/{uid}/a/{NONE_ID}/", uid, 0, "MT5", none=True)
