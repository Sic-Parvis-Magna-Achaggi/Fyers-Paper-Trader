"""Paper trading engine. Runs on the server, so stops, targets, trailing and guards work with the page closed.

Money figures are net: every rupee figure for a stop, a target, risk, P&L and break-even includes the entry
and exit charges (brokerage, exchange, clearing, CTT/STT, stamp duty, SEBI fee, GST) - see charges.py.

Model (like Fyers): one netted position per symbol + product. Adds on the same side average in; one trade
runs flat to flat. Opposite-side orders while a position is open are refused (close it first).

Stops on options can follow the option's own price ("self") or the underlying future ("underlying").
Everything to do with a stop is kept in its basis price: SL, TP, first SL, best price, R.
"""
from __future__ import annotations

import datetime as dt
import logging
import math
import time

from . import charges, store, symbols

log = logging.getLogger("paper")
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

DEFAULT_RULES = {
    "size": 25000.0,          # account size: base for % limits and the paper account's starting balance
    "daily_pct": 3.0,         # daily loss limit, % of size (0 = off)
    "max_pct": 10.0,          # max loss limit, % of size (0 = off)
    "max_mode": "static",     # static | trailing
    "day_from": "balance",    # balance | equity | higher
    "reset_hour": 6,          # IST hour the trading day starts
    "buffer_pct": 0.5,        # kept from each floor, % of size
    "risk_cap_pct": 2.0,      # max net risk per trade, % of balance (0 = off)
    "max_margin_pct": 90.0,   # margin in use incl. pending orders, % of min(balance, equity) (0 = off)
    "max_open_risk_pct": 0.0, # total net risk of everything open, % of balance (0 = off)
    "profit_target_pct": 0.0,
    "max_trades": 0,          # new trades per day (0 = no limit)
    "sl_required": True,
    "stale_sec": 90,          # refuse market orders when the last price is older (market closed)
    "be_buffer_ticks": 0,     # extra ticks beyond break-even + costs when moving a stop to BE (LiveTrader: BE buffer)
    # intraday square-off: the app closes Intraday positions (and cancels Intraday orders) this many minutes before
    # Fyers' own square-off, so Fyers' ₹50 + GST per order charge is never paid. Fyers' times below (support page, Oct 2026).
    "squareoff_on": True,
    "sq_before_min": 5,
    "fy_sq_fo": "15:25",        # NSE / BSE index and stock F&O
    "fy_sq_eq_fo": "15:05",     # stocks that have F&O
    "fy_sq_eq": "15:20",        # other stocks
    "fy_sq_mcx_summer": "23:20",  # MCX while the US is on daylight saving time (mid-March to early November)
    "fy_sq_mcx_winter": "23:45",  # MCX the rest of the year
    "squareoff_cd": "16:45",    # currency (Fyers doesn't offer currency intraday at present): the app's own time
    "expiry_exit": "22:45",     # MCX: positions in contracts expiring today are closed at this IST time ("" = off)
    "expiry_exit_eq": "15:00",
    "expiry_exit_cd": "12:00",
    # Live accounts only (helper/live.py). The stop at Fyers is a stop-limit (SL-L): Fyers doesn't take SL-M on
    # options or on BSE. Its limit sits this far past the trigger, so it fills even if price jumps.
    "live_slack_pct": 0.5,      # % of the stop price
    "live_slack_ticks": 5,      # at least this many ticks
    "live_chase_sec": 3.0,      # an exit still unfilled after this long is re-priced to cross the spread
}
TIME_KEYS = ("expiry_exit", "expiry_exit_eq", "expiry_exit_cd", "squareoff_cd", "fy_sq_fo", "fy_sq_eq_fo", "fy_sq_eq",
             "fy_sq_mcx_summer", "fy_sq_mcx_winter")


TIME_LABELS = {"expiry_exit": "MCX expiry-day exit", "expiry_exit_eq": "NSE / BSE expiry-day exit",
               "expiry_exit_cd": "Currency expiry-day exit", "squareoff_cd": "Currency square-off",
               "fy_sq_fo": "Fyers' F&O square-off", "fy_sq_eq_fo": "Fyers' square-off for stocks with F&O",
               "fy_sq_eq": "Fyers' square-off for other stocks", "fy_sq_mcx_summer": "Fyers' MCX square-off (summer)",
               "fy_sq_mcx_winter": "Fyers' MCX square-off (winter)"}


def us_dst(d: dt.date) -> bool:
    """US daylight saving time: second Sunday of March to first Sunday of November. MCX's evening hours (and Fyers'
    commodity square-off) follow it from the next trading day."""
    def nth_sunday(month, n):
        first = dt.date(d.year, month, 1)
        return first + dt.timedelta(days=(6 - first.weekday()) % 7 + 7 * (n - 1))
    return nth_sunday(3, 2) < d <= nth_sunday(11, 1)


def hm_minus(hm: str, minutes: float) -> str:
    h, m = int(hm[:2]), int(hm[3:])
    t = max(0, h * 60 + m - int(minutes))
    return f"{t // 60:02d}:{t % 60:02d}"
DEFAULT_TICKET = {"mode": "pct", "risk_pct": 1.0, "risk_amt": 250.0, "lots": 1, "product": "INTRADAY", "tp_r": 2.0,
                  "rr_lock": False}   # rr_lock: the tool keeps its net RR (tp_r) when the SL or the TP is moved (LiveTrader 1.24)
DEFAULT_TRAIL = {"be_on": False, "be_r": 1.0, "sl_on": False, "sl_r": 1.0}


def now() -> float:
    return time.time()


def ist(ts: float | None = None) -> dt.datetime:
    return dt.datetime.fromtimestamp(ts or now(), IST)


# ---------------------------------------------------------------- Black-76 (option risk on an underlying stop)
def _ncdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def b76(F, K, T, vol, call):
    if T <= 0 or vol <= 0:
        return max(0.0, (F - K) if call else (K - F)), (1.0 if F > K else 0.0) if call else (-1.0 if F < K else 0.0)
    d1 = (math.log(F / K) + 0.5 * vol * vol * T) / (vol * math.sqrt(T))
    d2 = d1 - vol * math.sqrt(T)
    if call:
        return F * _ncdf(d1) - K * _ncdf(d2), _ncdf(d1)
    return K * _ncdf(-d2) - F * _ncdf(-d1), _ncdf(d1) - 1


def option_delta(row, opt_px, fut_px) -> float:
    """Delta of an option from its price (implied vol by bisection). 0.5 if it can't be worked out."""
    try:
        K = float(row["k"])
        T = max((row["exp"] - now()) / (365 * 86400), 1 / (365 * 24))
        call = row["o"] == "CE"
        lo, hi = 0.01, 4.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if b76(fut_px, K, T, mid, call)[0] < opt_px:
                lo = mid
            else:
                hi = mid
        d = b76(fut_px, K, T, (lo + hi) / 2, call)[1]
        return d if 0.02 <= abs(d) <= 1 else (0.5 if call else -0.5)
    except Exception:
        return 0.5 if row.get("o") == "CE" else -0.5


class Refused(Exception):
    pass


class Paper:
    mode = "paper"
    journal_hook = None      # callback(kind, obj): "open" (filled / added to) or "close" (a history record) - the journal
    journal_guard = None     # callback() -> refusal text while a journal lockout blocks new orders, else None
    journal_lock = None      # callback() -> the journal's lock for today (shown on the ticket), else None

    def __init__(self, folder: str = "", link=None, name: str = ""):
        self.dir = folder                # "u/<user>/a/<account>/" - every file of this account lives there
        self.link = link                 # the user's Fyers connection (margin look-ups)
        self.name = name
        self.prices: dict = {}           # symbol -> last tick {ltp, bid, ask, t}
        self.margin_cache: dict = {}     # (symbol, side, product) -> (ts, margin per lot)
        self.on_change = None            # callback(event_text | None) set by the app
        self.on_symbols = None           # callback() when the set of symbols to watch changes
        self._dirty_at = 0.0
        self._last_push = 0.0
        self.temp_watch: dict = {}       # symbol -> until (futures a ticket needs for an underlying stop)
        self.load()

    # ------------------------------------------------------------ storage
    def load(self):
        s = store.load(self.dir + "paper.json")
        saved = store.load(self.dir + "paper_rules.json")
        if "squareoff" in saved and "squareoff_on" not in saved:      # before v0.13.1: fixed clock times, "" = off
            saved["squareoff_on"] = bool(saved.get("squareoff") or saved.get("squareoff_eq"))
        self.rules = {**DEFAULT_RULES, **{k: v for k, v in saved.items() if k in DEFAULT_RULES}}
        self.acct = s.get("acct") or {"start": self.rules["size"], "realized": 0.0, "peak": self.rules["size"],
                                      "created": now(), "cycle": 1}
        self.day = s.get("day") or {}
        self.positions = s.get("positions") or []
        self.orders = s.get("orders") or []
        self.seq = s.get("seq") or 0
        self.trail = {**DEFAULT_TRAIL, **(s.get("trail") or {})}
        self.ticket = {**DEFAULT_TICKET, **(s.get("ticket") or {})}
        self.events = s.get("events") or []
        self.history = store.load(self.dir + "paper_trades.json", [])
        self._load_extra(s)

    def _load_extra(self, s: dict):
        """Live accounts keep their Fyers order ids here."""

    def _save_extra(self) -> dict:
        return {}

    PATH_MAX = 2000

    def _path_scan(self):
        """Every stop / target move of each open position, with its time (v0.29.0: the trade replay draws the stop's
        path). [t, sl, tp, kind]: kind open / be / trail / edit / add. Called on every save, so nothing is missed."""
        t = now()
        for p in self.positions:
            path = p.get("path")
            if not path:
                path = p["path"] = [[p.get("opened") or t, p.get("first_sl"), p.get("tp"), "open"]]
            kind = p.pop("_pk", None)
            last = path[-1]
            if (p.get("sl"), p.get("tp")) != (last[1], last[2]):
                path.append([t, p.get("sl"), p.get("tp"), kind or "edit"])
                if len(path) > self.PATH_MAX:
                    del path[1]                           # (the first point is the opening stop: always kept)

    def save(self):
        self._path_scan()
        store.save(self.dir + "paper.json", {"acct": self.acct, "day": self.day, "positions": self.positions,
                                  "orders": self.orders, "seq": self.seq, "trail": self.trail, "ticket": self.ticket,
                                  "events": self.events[-500:], **self._save_extra()})
        self._dirty_at = 0.0

    def save_history(self):
        store.save(self.dir + "paper_trades.json", self.history)

    def _id(self, prefix):
        self.seq += 1
        return f"{prefix}{int(now()) % 10**7:07d}{self.seq % 1000:03d}"

    def event(self, msg, lvl="info"):
        self.events.append({"t": now(), "msg": msg, "lvl": lvl})
        self.events = self.events[-500:]
        (log.warning if lvl == "warn" else log.info)("%s%s", f"[{self.dir.strip('/')}] " if self.dir else "", msg)

    def changed(self, msg=None, lvl="info"):
        if msg:
            self.event(msg, lvl)
        self.save()
        if self.on_change:
            self.on_change(msg)

    # ------------------------------------------------------------ account figures
    def balance(self) -> float:
        return round(self.acct["start"] + self.acct["realized"], 2)

    def row(self, sym, product=None):
        """The contract's master row; with a product, a copy that carries it (stock charges differ for
        intraday and delivery)."""
        r = symbols.get(sym)
        if not r:
            raise Refused(f"unknown contract {sym}")
        if r.get("x") == "MT5":                     # roadmap 8: charts first (stage a); trading on MT5 is stage b
            raise Refused("paper accounts trade Fyers contracts: MT5 symbols trade on your MT5 accounts (MT5 at the top left)")
        return {**r, "prod": product} if product else r

    def px(self, sym):
        return self.prices.get(sym) or {}

    def fresh(self, sym) -> bool:
        p = self.px(sym)
        return bool(p.get("ltp")) and now() - p.get("rt", 0) < self.rules["stale_sec"]

    def fill_price(self, sym, side) -> float:
        """Market fill: buy at the ask, sell at the bid (last price if there's no depth)."""
        p = self.px(sym)
        v = p.get("ask") if side > 0 else p.get("bid")
        return float(v) if v else float(p.get("ltp") or 0)

    def exit_mark(self, pos) -> float:
        """Price a position would close at now (sell at bid / buy at ask)."""
        return self.fill_price(pos["s"], -pos["side"]) or pos["avg"]

    def pos_net(self, pos, exit_px) -> dict:
        r = self.row(pos["s"], pos["product"])
        return charges.net_at(r, pos["side"], pos["qty"], pos["avg"], exit_px, paid=pos["paid"])

    def open_net(self) -> float:
        return round(sum(self.pos_net(p, self.exit_mark(p))["net"] for p in self.positions), 2)

    def equity(self) -> float:
        return round(self.balance() + self.open_net(), 2)

    def trading_day(self, ts=None) -> str:
        d = ist(ts) - dt.timedelta(hours=int(self.rules["reset_hour"]))
        return d.strftime("%Y-%m-%d")

    def roll_day(self):
        today = self.trading_day()
        if self.day.get("date") != today:
            self.day = {"date": today, "start_bal": self.balance(), "start_eq": self.equity(), "trades": 0}
            self.event(f"New trading day {today}: balance {self.balance():,.2f}")
            self.save()

    def floors(self) -> dict:
        R, size = self.rules, float(self.rules["size"])
        d = self.day
        base = {"balance": d.get("start_bal"), "equity": d.get("start_eq"),
                "higher": max(d.get("start_bal", 0), d.get("start_eq", 0))}[R["day_from"]] or self.balance()
        daily = base - size * R["daily_pct"] / 100 if R["daily_pct"] else None
        if R["max_pct"]:
            mx = (self.acct["peak"] - size * R["max_pct"] / 100) if R["max_mode"] == "trailing" else size * (1 - R["max_pct"] / 100)
        else:
            mx = None
        return {"daily": daily, "max": mx, "buffer": size * R["buffer_pct"] / 100}

    # ------------------------------------------------------------ risk of things already open
    def basis_px(self, pos_or_order):
        """Current price of the stop's basis (the option itself or its underlying future)."""
        s = pos_or_order.get("ref") or pos_or_order["s"]
        return float(self.px(s).get("ltp") or 0)

    def est_exit_at(self, row, side, entry, stop, basis, ref_entry=None, delta=None):
        """Own-price exit if the stop is hit. For an underlying stop, estimated with the option's delta."""
        if basis != "underlying":
            return stop
        move = abs(stop - ref_entry) * abs(delta or 0.5)
        return max(row.get("tick") or 0.05, entry - side * move) if side > 0 else entry + move

    def pos_risk(self, pos) -> float:
        """Net loss (positive) if this position's stop is hit now; at its current loss if it has no stop."""
        r = self.row(pos["s"], pos["product"])
        if pos.get("sl") is None and pos.get("floor") is None:
            return max(0.0, -self.pos_net(pos, self.exit_mark(pos))["net"])
        candidates = []
        if pos.get("sl") is not None:
            ex = self.est_exit_at(r, pos["side"], pos["avg"], pos["sl"], pos["basis"], pos.get("ref_entry"), pos.get("delta"))
            candidates.append(ex)
        if pos.get("floor") is not None:
            candidates.append(pos["floor"])
        # the stop that gives the better exit is the one that would actually be hit first
        ex = max(candidates) if pos["side"] > 0 else min(candidates)
        return max(0.0, -charges.net_at(r, pos["side"], pos["qty"], pos["avg"], ex, paid=pos["paid"])["net"])

    def order_risk(self, o) -> float:
        r = self.row(o["s"], o["product"])
        if o.get("sl") is None:
            return 0.0
        ex = self.est_exit_at(r, o["side"], o["price"], o["sl"], o["basis"], o.get("ref_price"), o.get("delta"))
        return max(0.0, -charges.net_at(r, o["side"], o["qty"], o["price"], ex)["net"])

    def open_risk(self) -> float:
        return round(sum(self.pos_risk(p) for p in self.positions) + sum(self.order_risk(o) for o in self.orders), 2)

    def margin_used(self) -> float:
        return round(sum(p.get("margin", 0) for p in self.positions) + sum(o.get("margin", 0) for o in self.orders), 2)

    def free_margin(self, row=None) -> float:
        """Money free for a new order's margin (the Live account: Fyers' available balance for that ledger)."""
        return round(self.equity() - self.margin_used(), 2)

    # ------------------------------------------------------------ margin
    def margin_per_lot(self, row, side, product, price) -> tuple:
        """(rupees per lot, source). Option buys need the premium; the rest asks Fyers (cached 10 min)."""
        if row["f"] == "OPT" and side > 0:
            return price * (row.get("lot") or 1) * (row.get("mult") or 1), "premium"
        key = (row["s"], side, product)
        hit = self.margin_cache.get(key)
        if hit and now() - hit[0] < 600:
            return hit[1], "fyers"
        return None, "unknown"

    def fetch_margin(self, row, side, product):
        """Blocking: ask Fyers for one lot's margin. Called from a worker thread before placing."""
        if row["f"] == "OPT" and side > 0:
            return
        key = (row["s"], side, product)
        hit = self.margin_cache.get(key)
        if hit and now() - hit[0] < 600:
            return
        if not self.link:
            return
        try:
            m = self.link.margin(row["s"], row.get("lot") or 1, side, product)
            if m > 0:
                self.margin_cache[key] = (now(), m)
        except Exception as e:
            log.info("margin lookup for %s failed: %s", row["s"], e)

    # ------------------------------------------------------------ preview / sizing (used by the ticket)
    def plan(self, req: dict, place=False) -> dict:
        """Work out an order from the ticket: lots, net risk, net reward, charges, margin, and the guards' verdict.
        req: s, side (1/-1), type (market/limit/stop), price, sl, tp, tp_r, basis (self/underlying),
             mode (pct/amt/lots), risk_pct, risk_amt, lots, product
             lock_tp: the RR lock (LiveTrader 1.24): the target was moved to this price, so the stop is worked out
             (with tp_r) to keep that net RR at the lots it sizes to; the plan then has that sl and lock_tp as its tp
             (its tp from tp_r when the rules or the charges stop the stop short: lock_note)"""
        lock_note = None
        if req.get("lock_tp") not in (None, "", 0) and not req.get("_inner"):
            sl_l, lock_note = self._lock_sl(req)
            # v0.44.2: the target stays exactly where it was put (the stop was found for it); when the rules or the charges
            # stopped the stop short (lock_note), the target goes back to tp_r from that stop
            req = {**req, "sl": sl_l, "lock_tp": None, "tp": None if lock_note else float(req["lock_tp"])}
        self.roll_day()
        R = self.rules
        row0 = self.row(req["s"])
        side = 1 if int(req.get("side", 1)) > 0 else -1
        typ = req.get("type", "market")
        product = req.get("product") or "INTRADAY"
        if row0["f"] == "IDX":
            raise Refused("an index can't be traded - pick its futures or options")
        # stocks: Intraday or Delivery (CNC); derivatives: Intraday or Carry (NRML)
        if row0["f"] in ("EQ", "OTHER"):
            product = "CNC" if product in ("CNC", "MARGIN") else "INTRADAY"
            held = next((x for x in self.positions if x["s"] == row0["s"] and x["product"] == "CNC"), None)
            if product == "CNC" and side < 0 and not (held and held["side"] > 0):
                raise Refused("a delivery (CNC) sell needs shares you hold - use Intraday to short")
        elif product == "CNC":
            product = "MARGIN"
        row = {**row0, "prod": product}
        if product == "INTRADAY" and (sq := self.intraday_closed(row0, row0["s"])):
            alt = "Delivery (CNC)" if row0["f"] in ("EQ", "OTHER") else "Carry (NRML)"
            raise Refused(f"Intraday is closed for today in this market (the app squares off at {sq}, {self.rules.get('sq_before_min', 5):g} min "
                          f"before Fyers) - use {alt}")
        lot = row.get("lot") or 1
        basis = req.get("basis") if row["f"] == "OPT" and req.get("basis") == "underlying" else "self"
        out = {"s": row["s"], "side": side, "type": typ, "product": product, "basis": basis, "notes": [],
               "lot": lot, "mult": row.get("mult") or 1, "tick": row.get("tick")}

        # entry price
        if typ == "market":
            if not self.fresh(row["s"]):
                out["blocked"] = "no live price for this contract (market closed?)"
            entry = self.fill_price(row["s"], side)
        else:
            entry = float(req.get("price") or 0)
            if entry <= 0:
                raise Refused("enter the order price")
            ltp = float(self.px(row["s"]).get("ltp") or 0)
            if ltp:
                if typ == "limit" and side * (entry - ltp) > 0:
                    out["notes"].append("limit is through the market: it will fill straight away")
                if typ == "stop" and side * (entry - ltp) <= 0:
                    raise Refused("a stop entry must be beyond the market (above for a buy, below for a sell)")
        if not entry:
            raise Refused("no price yet for this contract")
        entry = charges.round_tick(entry, row.get("tick"))
        out["entry"] = entry

        # stop basis
        ref = ref_row = None
        ref_px = delta = None
        if basis == "underlying":
            ref_row = symbols.underlying_future(row)
            if not ref_row:
                raise Refused("couldn't find this option's underlying future")
            ref = ref_row["s"]
            ref_px = float(self.px(ref).get("ltp") or 0)
            if ref not in self.temp_watch:
                self.temp_watch[ref] = now() + 120
                self._symbols_changed()
            self.temp_watch[ref] = now() + 120
            if not ref_px:
                raise Refused(f"waiting for {self.short(ref)}'s price…")
            delta = option_delta(row, entry, ref_px)
            out.update(ref=ref, ref_price=ref_px, delta=round(delta, 3), ref_tick=ref_row.get("tick"))
        udir = side * (1 if (basis == "self" or row["o"] == "CE") else -1)   # direction in basis terms
        basis_entry = ref_px if basis == "underlying" else entry
        btick = (ref_row or row).get("tick")

        sl = req.get("sl")
        sl = charges.round_tick(float(sl), btick) if sl not in (None, "", 0) else None
        if sl is not None and udir * (basis_entry - sl) <= 0:
            raise Refused("the stop loss is on the wrong side of the entry")
        if sl is None and R["sl_required"]:
            out["blocked"] = out.get("blocked") or "a stop loss is required (Rules)"
        out["sl"] = sl

        # lots
        est_exit = self.est_exit_at(row, side, entry, sl, basis, ref_px, delta) if sl is not None else None
        bal = self.balance()
        mode = req.get("mode", "pct")
        if mode == "lots":
            lots = max(0, int(req.get("lots") or 0))
            target_risk = None
        else:
            target_risk = bal * float(req.get("risk_pct") or 0) / 100 if mode == "pct" else float(req.get("risk_amt") or 0)
            if sl is None:
                out["blocked"] = out.get("blocked") or "set a stop loss to size by risk (or switch to fixed lots)"
                lots = 0
            else:
                lots = charges.size_for_risk(row, side, entry, est_exit, target_risk)["lots"]
            if lots == 0 and sl is not None:
                out["blocked"] = out.get("blocked") or "1 lot risks more than your risk amount - widen the risk or tighten the stop"
        cuts = []

        def risk_of(n):
            if sl is None or n <= 0:
                return 0.0
            return max(0.0, -charges.net_at(row, side, n * lot, entry, est_exit)["net"])

        if R["risk_cap_pct"] and sl is not None:
            cap = bal * R["risk_cap_pct"] / 100
            if lots and risk_of(lots) > cap:
                one = risk_of(1)
                while lots > 0 and risk_of(lots) > cap:
                    lots -= 1
                cuts.append(f"cut to your {R['risk_cap_pct']:g}% risk cap (₹{cap:,.0f})" if lots else
                            f"1 lot risks ₹{one:,.2f} net, over your {R['risk_cap_pct']:g}% risk cap (₹{cap:,.0f})")
        mpl, msrc = self.margin_per_lot(row, side, product, entry)
        out["margin_source"] = msrc
        if mpl:
            eq = self.equity()
            used = self.margin_used()
            free = self.free_margin(row)
            if R["max_margin_pct"]:
                room = min(bal, eq) * R["max_margin_pct"] / 100 - used
                if lots * mpl > room:
                    lots = max(0, min(lots, int(room // mpl)))
                    cuts.append(f"cut to fit your {R['max_margin_pct']:g}% margin use limit")
            if lots * mpl > free:
                lots = max(0, int(free // mpl))
                cuts.append("cut to your free margin")
        else:
            out["notes"].append("margin not checked (Fyers didn't give a figure)")
        if R["max_open_risk_pct"] and sl is not None:
            room = bal * R["max_open_risk_pct"] / 100 - self.open_risk()
            if lots and risk_of(lots) > room:
                while lots > 0 and risk_of(lots) > room:
                    lots -= 1
                cuts.append(f"cut to fit your {R['max_open_risk_pct']:g}% open risk limit")
        out["notes"] += cuts
        qty = lots * lot
        out.update(lots=lots, qty=qty, margin=round((mpl or 0) * lots, 2), margin_per_lot=mpl)
        if lots <= 0 and not out.get("blocked"):
            out["blocked"] = "Blocked: " + (cuts[-1] if cuts else "0 lots")

        # money
        if qty:
            ent_c = charges.order(row, side, qty, entry)
            out["entry_charges"] = ent_c
            if sl is not None:
                n = charges.net_at(row, side, qty, entry, est_exit)
                out["risk"] = round(-n["net"], 2)
                out["risk_detail"] = n
                out["sl_exit_est"] = round(est_exit, 4)
                out["risk_estimated"] = basis == "underlying"
            out["be"] = charges.breakeven(row, side, qty, entry)

            # target: a price, or R (net reward = R x net risk)
            tp = req.get("tp")
            tp = charges.round_tick(float(tp), btick) if tp not in (None, "", 0) else None
            if tp is None and req.get("tp_r") and sl is not None and basis == "self":
                want = float(req["tp_r"]) * out["risk"]
                lo, hi = entry, entry + side * max(entry, 1) * 2
                for _ in range(80):
                    mid = (lo + hi) / 2
                    if charges.net_at(row, side, qty, entry, mid)["net"] < want:
                        lo = mid
                    else:
                        hi = mid
                tp = charges.round_tick(hi, row.get("tick"), side)
            if tp is not None and udir * (tp - basis_entry) <= 0:
                raise Refused("the target is on the wrong side of the entry")
            out["tp"] = tp
            if tp is not None:
                tp_exit = tp if basis == "self" else entry + side * abs(tp - ref_px) * abs(delta)
                n = charges.net_at(row, side, qty, entry, tp_exit)
                out["reward"] = round(n["net"], 2)
                out["reward_detail"] = n
                if out.get("risk"):
                    out["rr"] = round(out["reward"] / out["risk"], 2)
        else:
            out["tp"] = req.get("tp")
            if sl is not None:                             # show what one lot would risk, so the block makes sense
                out["risk_1lot"] = round(-charges.net_at(row, side, lot, entry, est_exit)["net"], 2)

        # guards
        if not out.get("blocked"):
            out["blocked"] = self.guard_new(out)
        if lock_note:
            out["lock_note"] = lock_note
            out["notes"].append(lock_note)
        # a strategy's order (v0.43.0): its tag and the trade's own BE / trail, carried to the order and the position
        if isinstance(req.get("strat"), dict) and req["strat"].get("id"):
            out["strat"] = {"id": str(req["strat"]["id"])[:20], "name": str(req["strat"].get("name") or "")[:60],
                            "eid": str(req["strat"].get("eid") or "")[:60]}
        if isinstance(req.get("tr"), dict):
            tr = dict(self.trail)
            self._apply_trail(tr, {k: v for k, v in req["tr"].items() if k in ("be_on", "be_r", "sl_on", "sl_r")})
            tr["own_be"] = tr["own_sl"] = True
            out["tr"] = tr
        return out

    def _lock_sl(self, req: dict) -> tuple:
        """The stop that gives net reward : net risk = tp_r with the target at lock_tp (LiveTrader's LockSL, but with every
        Indian charge and this app's sizing). Moving the stop changes the lots, so it's searched: the net RR falls as the
        stop widens (more risk, fewer lots over the same flat charges). Returns (stop, note): the note says when your rules
        (risk %, risk cap, margin) stop the stop going wider, so the target can't stay where it was put."""
        rr = float(req.get("tp_r") or 0)
        if rr <= 0:
            raise Refused("set the RR first (Target R)")
        tp = float(req["lock_tp"])
        base = {k: v for k, v in req.items() if k not in ("lock_tp", "tp_r", "sl", "tp")}
        base.update(_inner=True, tp=tp)
        p0 = self.plan({**base, "sl": None})
        if p0["basis"] != "self":
            raise Refused("the RR lock works on the contract's own price, not the underlying's")
        entry, side, tick = p0["entry"], p0["side"], p0.get("tick") or 0.05
        span = side * (tp - entry)
        if span <= 0:
            raise Refused("the target is on the wrong side of the entry")

        def rr_at(d):
            try:
                p = self.plan({**base, "sl": entry - side * d})
            except Refused:
                return None
            return p["reward"] / p["risk"] if p.get("risk") and p.get("reward") is not None else None

        lo, hi = tick, span / rr * 4 + tick
        r0 = rr_at(lo)
        if r0 is None:                             # nothing to size (e.g. no margin figure): a plain price ratio
            return charges.round_tick(entry - side * span / rr, tick), None
        if r0 < rr:                                # even the closest stop can't give that RR: the charges are too big
            return (charges.round_tick(entry - side * lo, tick),
                    f"RR lock: the target is too close for {rr:g}R after charges, even with a 1-tick stop - "
                    f"it stays at {rr:g}R from the closest stop")
        for _ in range(40):                        # the widest stop that still gives at least that RR
            mid = (lo + hi) / 2
            r = rr_at(mid)
            if r is not None and r >= rr:
                lo = mid
            else:
                hi = mid
        sl = charges.round_tick(entry - side * lo, tick, side)        # rounded towards the entry: the RR stays at least rr
        note = None
        if rr_at(lo + tick) is None and (rr_at(lo) or 0) > rr * 1.05:   # wider would size to 0 lots: the rules stop it here
            note = (f"RR lock: the stop can't go wider than {sl:g} - 1 lot would then risk more than your rules allow, "
                    f"so the target stays at {rr:g}R from this stop")
        return sl, note

    def _jn(self, kind, obj):
        if self.journal_hook:
            try:
                self.journal_hook(kind, obj)
            except Exception as ex:
                log.exception("journal hook: %s", ex)

    def guard_new(self, o) -> str | None:
        R = self.rules
        if self.journal_guard:
            j = self.journal_guard()
            if j:
                return j
        if R["max_trades"]:
            n = self.day.get("trades", 0) + len(self.orders)
            adding = any(p["s"] == o["s"] and p["product"] == o["product"] for p in self.positions)
            if n >= R["max_trades"] and not adding:
                return f"Blocked: {R['max_trades']} trades a day reached (pending orders count)"
        f = self.floors()
        # equity if every stop on the account is hit: balance minus each open thing's net loss at its stop
        worst = self.balance() - self.open_risk() - (o.get("risk") or 0)
        for name in ("daily", "max"):
            if f[name] is not None and worst < f[name] + f["buffer"]:
                return (f"Blocked: {name} loss limit - if every stop is hit, equity would be {worst:,.2f}, "
                        f"under the floor {f[name]:,.2f} + buffer {f['buffer']:,.2f}")
        return None

    # ------------------------------------------------------------ place / fill
    def place(self, req: dict) -> dict:
        p = self.plan(req, place=True)
        if p.get("blocked"):
            raise Refused(p["blocked"])
        side, row = p["side"], self.row(p["s"], p["product"])
        existing = next((x for x in self.positions if x["s"] == p["s"] and x["product"] == p["product"]), None)
        if existing and existing["side"] != side:
            raise Refused("you have an opposite position in this contract - close it first")
        if any(o["s"] == p["s"] and o["side"] != side for o in self.orders):
            raise Refused("there's an opposite pending order on this contract - cancel it first")
        if p["type"] == "market":
            self.fill(p, p["entry"], "market")
            return p
        o = {k: p.get(k) for k in ("s", "side", "type", "product", "basis", "qty", "lots", "sl", "tp", "ref",
                                   "ref_price", "delta", "margin", "risk", "strat", "tr")}
        o.update(id=self._id("O"), price=p["entry"], created=now())
        self.orders.append(o)
        self._symbols_changed()
        self.changed(f"Placed {'BUY' if side > 0 else 'SELL'} {o['type'].upper()} {self.short(o['s'])} "
                     f"{o['lots']} lot @ {o['price']}")
        return p

    @staticmethod
    def short(s):
        return s.split(":", 1)[-1]

    def fill(self, plan: dict, price: float, how: str):
        """Open a position, or add to one, at `price` (own price)."""
        self.roll_day()
        row = self.row(plan["s"], plan["product"])
        side, qty = plan["side"], plan["qty"]
        c = charges.order(row, side, qty, price)
        pos = next((x for x in self.positions if x["s"] == plan["s"] and x["product"] == plan["product"]), None)
        ref_px = float(self.px(plan["ref"]).get("ltp") or plan.get("ref_price") or 0) if plan.get("ref") else None
        risk_add = 0.0
        if plan.get("sl") is not None:
            ex = self.est_exit_at(row, side, price, plan["sl"], plan["basis"], ref_px, plan.get("delta"))
            risk_add = max(0.0, -charges.net_at(row, side, qty, price, ex)["net"])
        entry = {"t": now(), "qty": qty, "price": price, "charges": c, "how": how}
        if pos is None:
            pos = {"id": self._id("P"), "s": plan["s"], "side": side, "product": plan["product"], "qty": qty,
                   "max_qty": qty, "avg": price, "paid": c["total"], "charges": c, "entries": [entry],
                   "basis": plan["basis"], "ref": plan.get("ref"), "ref_entry": ref_px, "delta": plan.get("delta"),
                   "sl": plan.get("sl"), "first_sl": plan.get("sl"), "tp": plan.get("tp"), "floor": None,
                   "init_risk": round(risk_add, 2), "opened": now(), "best": price, "worst": price,
                   "basis_entry": ref_px if plan["basis"] == "underlying" else price,
                   "basis_best": ref_px if plan["basis"] == "underlying" else price,
                   "be_done": False, "trail": False, "own_stop": False, "margin": plan.get("margin", 0),
                   "tr": dict(plan.get("tr") or self.trail)}   # this trade's own trailing settings (start from the defaults)
            if plan.get("strat"):
                pos["strat"] = dict(plan["strat"])      # placed by a strategy (v0.43.0)
            self.positions.append(pos)
            self.day["trades"] = self.day.get("trades", 0) + 1
            verb = "Opened"
        else:
            tot = pos["qty"] + qty
            pos["avg"] = round((pos["avg"] * pos["qty"] + price * qty) / tot, 6)
            pos["qty"] = tot
            pos["max_qty"] = max(pos["max_qty"], tot)
            pos["paid"] = round(pos["paid"] + c["total"], 2)
            pos["charges"] = charges.add(pos["charges"], c)
            pos["entries"].append(entry)
            pos["init_risk"] = round(pos["init_risk"] + risk_add, 2)
            pos["margin"] = round(pos.get("margin", 0) + plan.get("margin", 0), 2)
            if plan.get("sl") is not None:
                pos["sl"] = plan["sl"]
            if plan.get("tp") is not None:
                pos["tp"] = plan["tp"]
            pos["_pk"] = "add"
            verb = "Added to"
        self._symbols_changed()
        self.changed(f"{verb} {'LONG' if side > 0 else 'SHORT'} {self.short(plan['s'])}: {qty // (row.get('lot') or 1)} lot "
                     f"@ {price} ({how}), charges ₹{c['total']:.2f}")
        self._jn("open", pos)

    def close(self, pos, price: float, reason: str):
        row = self.row(pos["s"], pos["product"])
        c = charges.order(row, -pos["side"], pos["qty"], price)
        allc = charges.add(pos["charges"], c)
        g = charges.gross(row, pos["side"], pos["qty"], pos["avg"], price)
        net = round(g - allc["total"], 2)
        self.acct["realized"] = round(self.acct["realized"] + net, 2)
        bal = self.balance()
        self.acct["peak"] = max(self.acct.get("peak", bal), bal)
        lot = row.get("lot") or 1
        rec = {
            "id": pos["id"], "s": pos["s"], "side": pos["side"], "product": pos["product"],
            "lots": pos["max_qty"] // lot, "qty": pos["qty"], "lot": lot, "mult": row.get("mult") or 1,
            "entries": [{"t": e["t"], "qty": e["qty"], "price": e["price"]} for e in pos["entries"]],
            "avg": pos["avg"], "exit": price, "opened": pos["opened"], "closed": now(), "reason": reason,
            "first_sl": pos.get("first_sl"), "sl": pos.get("sl"), "tp": pos.get("tp"), "basis": pos["basis"],
            "ref": pos.get("ref"), "best": pos["best"], "worst": pos["worst"],
            "gross": round(g, 2), "charges": allc, "net": net, "init_risk": pos["init_risk"],
            "r": round(net / pos["init_risk"], 2) if pos["init_risk"] else None,
            "balance_after": bal, "day": self.trading_day(pos["opened"]),
            **({"src": "fyers"} if pos.get("outside") else {}), **({"holding": True} if pos.get("holding") else {}),
            **({"strat": pos["strat"]} if pos.get("strat") else {}),
            "path": (pos.get("path") or [[pos["opened"], pos.get("first_sl"), pos.get("tp"), "open"]]) + (
                [[now(), pos.get("sl"), pos.get("tp"), pos.pop("_pk", None) or "edit"]]
                if pos.get("path") and (pos.get("sl"), pos.get("tp")) != tuple(pos["path"][-1][1:3]) else []),
        }
        self.history.append(rec)
        self.positions = [p for p in self.positions if p["id"] != pos["id"]]
        self.save_history()
        self._symbols_changed()
        self.changed(f"Closed {self.short(pos['s'])} @ {price} ({reason}): net ₹{net:,.2f} "
                     f"(gross {g:,.2f}, charges {allc['total']:,.2f})" + (f", {rec['r']:+.2f}R" if rec["r"] is not None else ""),
                     "warn" if net < 0 else "info")
        self._jn("close", rec)

    # ------------------------------------------------------------ user actions on open things
    def find_pos(self, pid):
        p = next((x for x in self.positions if x["id"] == pid), None)
        if not p:
            raise Refused("that position is already closed")
        return p

    def close_now(self, pid, reason="manual"):
        pos = self.find_pos(pid)
        if not self.fresh(pos["s"]):
            raise Refused("no live price - the market may be closed")
        self.close(pos, self.exit_mark(pos), reason)

    def close_all(self):
        for p in list(self.positions):
            if self.fresh(p["s"]):
                self.close(p, self.exit_mark(p), "manual")
        for o in list(self.orders):
            self.cancel(o["id"], quiet=True)
        self.changed("Closed everything")

    def cancel(self, oid, quiet=False):
        o = next((x for x in self.orders if x["id"] == oid), None)
        if not o:
            raise Refused("that order is already gone")
        self.orders = [x for x in self.orders if x["id"] != oid]
        self._symbols_changed()
        if not quiet:
            self.changed(f"Cancelled {o['type']} order {self.short(o['s'])} @ {o['price']}")

    def modify_pos(self, pid, sl="keep", tp="keep"):
        pos = self.find_pos(pid)
        row = self.row(pos["s"], pos["product"])
        btick = self.row(pos["ref"]).get("tick") if pos["basis"] == "underlying" else row.get("tick")
        udir = self._udir(pos, row)
        bpx = self.basis_px(pos) or pos["basis_entry"]
        msgs = []
        if sl != "keep":
            if sl is None:
                if self.rules["sl_required"]:
                    raise Refused("a stop loss is required (Rules) - it can be moved but not removed")
                pos["sl"] = None
            else:
                sl = charges.round_tick(float(sl), btick)
                if udir * (bpx - sl) <= 0:
                    raise Refused("that stop is already through the market - use X to close instead")
                first = pos.get("sl") is None and pos.get("floor") is None and pos.get("first_sl") is None
                old_risk = self.pos_risk(pos)
                old = pos["sl"]
                pos["sl"] = sl
                new_risk = self.pos_risk(pos)
                if first:
                    # a trade with no stop yet (placed in Fyers without one, v0.33.0): its first stop sets 1R. A stop
                    # only ever lowers the risk of a trade that had none, so the widening guards don't apply.
                    pos["first_sl"] = sl
                    pos["init_risk"] = round(new_risk, 2)
                    pos["_pk"] = "edit"
                    msgs.append(f"first stop {sl} (1R)")
                elif new_risk > old_risk + 0.01:            # widening: check the guards like a new trade
                    f = self.floors()
                    worst = self.balance() - self.open_risk()
                    cap = self.balance() * self.rules["risk_cap_pct"] / 100 if self.rules["risk_cap_pct"] else None
                    why = None
                    if cap and new_risk > cap:
                        why = f"Blocked: risk ₹{new_risk:,.2f} is over your {self.rules['risk_cap_pct']:g}% cap"
                    for name in ("daily", "max"):
                        if not why and f[name] is not None and worst < f[name] + f["buffer"]:
                            why = f"Blocked: the wider stop could break your {name} loss limit"
                    if why:
                        pos["sl"] = old
                        raise Refused(why)
                if not first:
                    pos["own_stop"] = True
                    pos["trail"] = False
                    msgs.append(f"SL {sl}")
        if tp != "keep":
            if tp is None:
                pos["tp"] = None
            else:
                tp = charges.round_tick(float(tp), btick)
                if udir * (tp - bpx) <= 0:
                    raise Refused("that target is already through the market - use X to close instead")
                pos["tp"] = tp
            msgs.append(f"TP {pos['tp']}")
        self.changed(f"{self.short(pos['s'])}: " + ", ".join(msgs))

    def modify_order(self, oid, price="keep", sl="keep", tp="keep"):
        o = next((x for x in self.orders if x["id"] == oid), None)
        if not o:
            raise Refused("that order is already gone")
        row = self.row(o["s"], o["product"])
        if price != "keep":
            price = charges.round_tick(float(price), row.get("tick"))
            ltp = float(self.px(o["s"]).get("ltp") or 0)
            if ltp and o["type"] == "limit" and o["side"] * (price - ltp) > 0:
                raise Refused("a limit can't cross the market - cancel it and place a new order")
            if ltp and o["type"] == "stop" and o["side"] * (price - ltp) <= 0:
                raise Refused("a stop can't cross the market - cancel it and place a new order")
            if o["basis"] == "self":
                shift = price - o["price"]                 # SL and TP move with the entry
                if o.get("sl") is not None and sl == "keep":
                    o["sl"] = charges.round_tick(o["sl"] + shift, row.get("tick"))
                if o.get("tp") is not None and tp == "keep":
                    o["tp"] = charges.round_tick(o["tp"] + shift, row.get("tick"))
            o["price"] = price
        if sl != "keep":
            o["sl"] = None if sl is None else float(sl)
        if tp != "keep":
            o["tp"] = None if tp is None else float(tp)
        self.changed(f"Moved {o['type']} order {self.short(o['s'])}: @ {o['price']} SL {o.get('sl')} TP {o.get('tp')}")

    def be_now(self, pid):
        pos = self.find_pos(pid)
        self._set_be(pos, "BE + costs")
        self.changed()

    def _be_price(self, pos):
        """Like LiveTrader's BreakEvenPrice: the exit price where closing nets >= 0 after every charge already
        paid on the entries and every charge the exit would pay, plus the BE buffer, on the profitable tick."""
        row = self.row(pos["s"], pos["product"])
        return charges.breakeven(row, pos["side"], pos["qty"], pos["avg"], paid=pos["paid"],
                                 buffer_ticks=int(self.rules.get("be_buffer_ticks") or 0))

    def _set_be(self, pos, why):
        """Move the stop to where closing pays back every charge. Underlying stops get an own-price floor."""
        row = self.row(pos["s"], pos["product"])
        be = self._be_price(pos)
        mark = self.exit_mark(pos)
        if pos["side"] * (mark - be) <= 0:
            raise Refused(f"price hasn't reached break-even + costs ({be}) yet")
        if pos["basis"] == "underlying":
            pos["floor"] = be if pos.get("floor") is None else (max(pos["floor"], be) if pos["side"] > 0 else min(pos["floor"], be))
        else:
            if pos.get("sl") is None or pos["side"] * (be - pos["sl"]) > 0:
                pos["sl"] = be
                pos["_pk"] = "be"
        pos["be_done"] = True
        self.event(f"{self.short(pos['s'])}: stop to break-even + costs {be} ({why})")

    # ------------------------------------------------------------ the tick loop
    @staticmethod
    def _udir(pos, row):
        return pos["side"] * (1 if pos["basis"] == "self" or row.get("o") == "CE" else -1)

    def on_tick(self, t: dict):
        s = t["s"]
        prev = self.prices.get(s) or {}
        # the day's low / high moving tells us a trade printed there, even if that trade's own tick never reached us
        # (the socket sends snapshots, so a one-trade spike can fall between two of them)
        dl, dh = t.get("l"), t.get("h")
        lo = dl if dl and prev.get("dl") and dl < prev["dl"] else None
        hi = dh if dh and prev.get("dh") and dh > prev["dh"] else None
        self.prices[s] = {"ltp": t.get("ltp"), "bid": t.get("bid"), "ask": t.get("ask"), "t": t.get("t"), "rt": now(),
                          "dl": dl or prev.get("dl"), "dh": dh or prev.get("dh"), "lo": lo, "hi": hi}
        touched = False
        for o in list(self.orders):
            if o["s"] == s:
                touched |= self._check_order(o)
        for pos in list(self.positions):
            if pos["s"] == s or pos.get("ref") == s:
                touched |= self._check_pos(pos)
        if touched:
            self._dirty_at = self._dirty_at or now()
        if self.positions and self.on_change and now() - self._last_push > 1.0:
            self._last_push = now()
            self.on_change(None)                          # refresh live P&L on the page (at most once a second)

    @staticmethod
    def _through(p: dict, side: int) -> float:
        """The furthest trade seen on this tick in the direction that fills a resting order: the lowest for a buy
        limit / a short's target (side > 0), the highest for a sell limit / a long's target."""
        ltp = float(p.get("ltp") or 0)
        if side > 0:
            return min(ltp, p["lo"]) if p.get("lo") else ltp
        return max(ltp, p["hi"]) if p.get("hi") else ltp

    def _check_order(self, o) -> bool:
        p = self.px(o["s"])
        ltp, bid, ask = p.get("ltp"), p.get("bid") or p.get("ltp"), p.get("ask") or p.get("ltp")
        if not ltp:
            return False
        side = o["side"]
        hit, price = False, None
        if o["type"] == "limit":
            mkt = ask if side > 0 else bid
            if side * (o["price"] - mkt) >= 0:
                hit, price = True, (min(o["price"], mkt) if side > 0 else max(o["price"], mkt))
            elif side * (o["price"] - self._through(p, side)) > 0:
                # a trade went through the limit price: a real resting limit there would have been filled first
                # (price priority), even if the quote we saw never touched it - fill at the limit
                hit, price = True, o["price"]
        else:                                              # stop entry: triggers on the last price, fills at market
            if side * (ltp - o["price"]) >= 0:
                hit, price = True, (ask if side > 0 else bid)
        if not hit:
            return False
        self.orders = [x for x in self.orders if x["id"] != o["id"]]
        plan = dict(o)
        try:
            self.fill(plan, price, f"{o['type']} @ {o['price']}")
        except Exception as e:
            self.changed(f"Order {self.short(o['s'])} couldn't fill: {e}", "warn")
        return True

    def _check_pos(self, pos) -> bool:
        row = self.row(pos["s"], pos["product"])
        own = self.px(pos["s"])
        if not own.get("ltp"):
            return False
        side = pos["side"]
        mark = self.exit_mark(pos)
        ltp = float(own["ltp"])
        pos["best"] = max(pos["best"], ltp) if side > 0 else min(pos["best"], ltp)
        pos["worst"] = min(pos["worst"], ltp) if side > 0 else max(pos["worst"], ltp)
        udir = self._udir(pos, row)
        b = self.basis_px(pos)
        if not b:
            return False
        pos["basis_best"] = max(pos["basis_best"], b) if udir > 0 else min(pos["basis_best"], b)

        # stops and targets. An own-price stop or target triggers on the price it would exit at (a long sells
        # at the bid, a short buys at the ask), as at MT5 - so a stop at BE + costs exits at BE + costs.
        # A stop on the underlying future triggers on the future's last price.
        trig = b if pos["basis"] == "underlying" else mark
        if pos.get("floor") is not None and side * (mark - pos["floor"]) <= 0:
            self.close(pos, mark, "be" if pos["be_done"] else "sl")
            return True
        if pos.get("sl") is not None and udir * (trig - pos["sl"]) <= 0:
            fill = mark                                    # stop = market order: the bid/ask now (slippage included)
            at_be = pos["be_done"] or (pos["basis"] == "self" and side * (pos["sl"] - pos["avg"]) >= 0)
            self.close(pos, fill, "trail sl" if pos["trail"] else ("be" if at_be else "sl"))
            return True
        if pos.get("tp") is not None and udir * (trig - pos["tp"]) >= 0:
            fill = mark if pos["basis"] == "underlying" else (max(pos["tp"], mark) if side > 0 else min(pos["tp"], mark))
            self.close(pos, fill, "tp")
            return True
        # the target is a resting limit order: a trade beyond it (a spike through a thin book) fills it at the
        # target even when the bid / ask we saw never reached it
        if pos.get("tp") is not None and pos["basis"] == "self" and side * (self._through(own, -side) - pos["tp"]) > 0:
            self.close(pos, pos["tp"], "tp")
            return True
        return self._trail_pos(pos, row, b, udir)

    def _trail_pos(self, pos, row, b, udir) -> bool:
        """Trail BE and Trail SL (R in the stop's basis, from the first stop). The MT5 engine uses this on its own: its
        stops and targets are the broker's."""
        side = pos["side"]
        if pos.get("first_sl") is None:
            return False
        R = abs(pos["basis_entry"] - pos["first_sl"])
        if R <= 0:
            return False
        reached = udir * (pos["basis_best"] - pos["basis_entry"]) / R
        moved = False
        tr = pos.get("tr") or self.trail
        if tr["be_on"] and not pos["be_done"] and reached >= tr["be_r"]:
            try:
                self._set_be(pos, f"trail BE at {tr['be_r']:g}R")
                moved = True
            except Refused:
                pass
        if tr["sl_on"] and not pos.get("own_stop") and reached >= tr["sl_r"]:
            btick = self.row(pos["ref"]).get("tick") if pos["basis"] == "underlying" else row.get("tick")
            cand = charges.round_tick(pos["basis_best"] - udir * tr["sl_r"] * R, btick, -udir)
            if pos["basis"] == "self":
                be = self._be_price(pos)
                cand = max(cand, be) if side > 0 else min(cand, be)
            elif not pos["be_done"]:
                try:
                    self._set_be(pos, "trail SL floor")
                except Refused:
                    pass
            cur = pos.get("sl")
            if cur is None or udir * (cand - cur) >= 0.05 * R:
                if udir * (b - cand) > 0:
                    pos["sl"] = cand
                    pos["_pk"] = "trail"
                    pos["trail"] = True
                    moved = True
        if moved:
            self.changed(f"{self.short(pos['s'])}: stop now {pos.get('sl')}" + (f", floor {pos['floor']}" if pos.get("floor") else ""))
        return moved

    def fyers_squareoff(self, row: dict, s: str, day: dt.date | None = None):
        """Fyers' own intraday square-off time for this contract (IST HH:MM), or None."""
        R, ex = self.rules, row.get("x") or s.split(":", 1)[0]
        if ex == "MCX" or row.get("g") == "COM":
            return R["fy_sq_mcx_summer"] if us_dst(day or ist().date()) else R["fy_sq_mcx_winter"]
        if row.get("g") == "CD":
            return None
        if row.get("f") in ("EQ", "OTHER"):
            return R["fy_sq_eq_fo"] if symbols.has_fo(row) else R["fy_sq_eq"]
        return R["fy_sq_fo"]

    def _times(self, row: dict, s: str) -> tuple:
        """(the app's intraday square-off, expiry-day exit) for this contract's market."""
        R, ex = self.rules, row.get("x") or s.split(":", 1)[0]
        sq = None
        if R.get("squareoff_on"):
            if row.get("g") == "CD":
                sq = R.get("squareoff_cd") or None
            else:
                fy = self.fyers_squareoff(row, s)
                sq = hm_minus(fy, R.get("sq_before_min", 5)) if fy else None
        if ex == "MCX" or row.get("g") == "COM":
            return sq, R["expiry_exit"]
        if row.get("g") == "CD":
            return sq, R.get("expiry_exit_cd")
        return sq, R.get("expiry_exit_eq")

    def squareoff_today(self) -> dict:
        """When the app closes Intraday today, per market (for the Rules screen)."""
        R = self.rules
        if not R.get("squareoff_on"):
            return {}
        b = R.get("sq_before_min", 5)
        mcx = R["fy_sq_mcx_summer"] if us_dst(ist().date()) else R["fy_sq_mcx_winter"]
        return {"F&O": hm_minus(R["fy_sq_fo"], b), "stocks with F&O": hm_minus(R["fy_sq_eq_fo"], b),
                "other stocks": hm_minus(R["fy_sq_eq"], b), "MCX": hm_minus(mcx, b)}

    def intraday_closed(self, row: dict, s: str):
        """The app's square-off time if it has passed today (no new Intraday orders until the next day), else None."""
        sq = self._times(row, s)[0]
        t = ist()
        return sq if sq and t.hour >= 9 and t.strftime("%H:%M") >= sq else None

    def housekeeping(self):
        """Every few seconds: new day, intraday square-off, expiry-day exit, and saving best/worst prices."""
        self.roll_day()
        t = ist()
        hm = t.strftime("%H:%M")
        today = t.date()
        for pos in list(self.positions):
            row = symbols.get(pos["s"]) or {}
            why = None
            if pos.get("warned") and self.fresh(pos["s"]):
                pos.pop("warned", None)
            sq, ex_t = self._times(row, pos["s"])
            if sq and pos["product"] == "INTRADAY" and hm >= sq and t.hour >= 9:
                why = "square-off"
            if ex_t and row.get("exp") and ist(row["exp"]).date() == today and hm >= ex_t:
                why = "expiry"
            if why:
                if self.fresh(pos["s"]):
                    self.close(pos, self.exit_mark(pos), why)
                elif not pos.get("warned"):
                    pos["warned"] = True
                    self.changed(f"{self.short(pos['s'])}: due for {why} but there's no live price", "warn")
        for o in list(self.orders):
            row = symbols.get(o["s"]) or {}
            sq, ex_t = self._times(row, o["s"])
            if row.get("exp") and ist(row["exp"]).date() == today and ex_t and hm >= ex_t:
                self.cancel(o["id"], quiet=True)
                self.changed(f"Cancelled {self.short(o['s'])} order: contract expires today")
            elif sq and o["product"] == "INTRADAY" and hm >= sq and t.hour >= 9:
                self.cancel(o["id"], quiet=True)
                self.changed(f"Cancelled {self.short(o['s'])} Intraday order: intraday square-off at {sq}")
        if self._dirty_at and now() - self._dirty_at > 10:
            self.save()

    # ------------------------------------------------------------ for the feed and the page
    def watch_symbols(self) -> list:
        out = set()
        for p in self.positions:
            out.add(p["s"])
            if p.get("ref"):
                out.add(p["ref"])
        for o in self.orders:
            out.add(o["s"])
            if o.get("ref"):
                out.add(o["ref"])
        t = now()
        self.temp_watch = {s: u for s, u in self.temp_watch.items() if u > t}
        out |= set(self.temp_watch)
        return sorted(out)

    def _symbols_changed(self):
        if self.on_symbols:
            self.on_symbols()

    def pos_view(self, pos) -> dict:
        row = self.row(pos["s"], pos["product"])
        mark = self.exit_mark(pos)
        n = self.pos_net(pos, mark)
        v = {k: pos.get(k) for k in ("id", "s", "side", "product", "qty", "avg", "sl", "tp", "floor", "basis", "ref",
                                      "first_sl", "be_done", "trail", "opened", "init_risk", "best", "worst", "paid", "strat")}
        v.update(lots=pos["qty"] // (row.get("lot") or 1), ltp=self.px(pos["s"]).get("ltp"), mark=mark,
                 gross=n["gross"], net=n["net"], charges_so_far=pos["paid"], exit_charges=n["exit_charges"],
                 be=self._be_price(pos), risk=round(self.pos_risk(pos), 2), stale=not self.fresh(pos["s"]),
                 tick=row.get("tick"), lot=row.get("lot"), mult=row.get("mult"),
                 ref_ltp=self.px(pos["ref"]).get("ltp") if pos.get("ref") else None)
        sl_ex = self.est_exit_at(row, pos["side"], pos["avg"], pos["sl"], pos["basis"], pos.get("ref_entry"), pos.get("delta")) if pos.get("sl") is not None else None
        v["at_sl"] = charges.net_at(row, pos["side"], pos["qty"], pos["avg"], sl_ex, paid=pos["paid"])["net"] if sl_ex is not None else None
        if pos.get("tp") is not None:
            tp_ex = pos["tp"] if pos["basis"] == "self" else pos["avg"] + pos["side"] * abs(pos["tp"] - pos["ref_entry"]) * abs(pos.get("delta") or 0.5)
            v["at_tp"] = charges.net_at(row, pos["side"], pos["qty"], pos["avg"], tp_ex, paid=pos["paid"])["net"]
        v["r_now"] = round(n["net"] / pos["init_risk"], 2) if pos["init_risk"] else None
        v["est"] = pos["basis"] == "underlying"
        v["basis_entry"] = pos.get("basis_entry")
        # at break-even: the stop (or the floor) is at or past BE + costs - label it like LiveTrader ("BE +N ticks")
        stop_px = pos.get("floor") if pos.get("floor") is not None else (pos.get("sl") if pos["basis"] == "self" else None)
        if stop_px is not None and pos["side"] * (stop_px - v["be"]) >= -1e-9:
            tick = row.get("tick") or 0.05
            ex = charges.order(row, -pos["side"], pos["qty"], stop_px)["total"]
            v.update(at_be=True, be_ticks=round(abs(stop_px - pos["avg"]) / tick), be_covers=round(pos["paid"] + ex, 2))
        v["tr"] = pos.get("tr") or dict(self.trail)
        # where Trail SL will next move the stop: price must pass this (shown on the position's bar)
        tr = v["tr"]
        if tr.get("sl_on") and pos.get("first_sl") is not None and not pos.get("own_stop"):
            ud = self._udir(pos, row)
            R = abs(pos["basis_entry"] - pos["first_sl"])
            if R > 0:
                start = pos["basis_entry"] + ud * tr["sl_r"] * R            # reached the trail's R
                cur_sl = pos.get("sl")
                if cur_sl is not None:                                       # and beats the current stop
                    beat = cur_sl + ud * (tr["sl_r"] * R + 0.05 * R)
                    start = max(start, beat) if ud > 0 else min(start, beat)
                btick = (self.row(pos["ref"]) if pos["basis"] == "underlying" else row).get("tick") or 0.05
                v["trail_at"] = charges.round_tick(start, btick, ud)
                v["r_pts"] = round(R, 4)            # figures at an underlying stop use the option's delta
        return v

    def order_view(self, o) -> dict:
        row = self.row(o["s"], o["product"])
        v = dict(o)
        v["ltp"] = self.px(o["s"]).get("ltp")
        v["risk"] = round(self.order_risk(o), 2)
        if o.get("tp") is not None and o["basis"] == "self":
            v["at_tp"] = charges.net_at(row, o["side"], o["qty"], o["price"], o["tp"])["net"]
        v["at_sl"] = -v["risk"] if o.get("sl") is not None else None
        return v

    def snapshot(self) -> dict:
        self.roll_day()
        bal, eq = self.balance(), self.equity()
        f = self.floors()
        today = [h for h in self.history if h.get("day") == self.day.get("date")]
        wins = [h for h in self.history if h["net"] > 0]
        losses = [h for h in self.history if h["net"] < 0]
        acct = {
            "start": self.acct["start"], "balance": bal, "equity": eq, "open_net": round(eq - bal, 2),
            "realized_today": round(sum(h["net"] for h in today), 2),
            "charges_today": round(sum(h["charges"]["total"] for h in today), 2),
            "trades_today": self.day.get("trades", 0),
            "margin_used": self.margin_used(), "free": self.free_margin(),
            "open_risk": self.open_risk(),
            "day_room": round(min(bal, eq) - (f["daily"] + f["buffer"]), 2) if f["daily"] is not None else None,
            "max_room": round(min(bal, eq) - (f["max"] + f["buffer"]), 2) if f["max"] is not None else None,
            "daily_floor": f["daily"], "max_floor": f["max"], "peak": self.acct.get("peak"),
            "trades": len(self.history), "net_total": round(sum(h["net"] for h in self.history), 2),
            "charges_total": round(sum(h["charges"]["total"] for h in self.history), 2),
            "win_rate": round(100 * len(wins) / len(self.history), 1) if self.history else None,
            "pf": round(sum(h["net"] for h in wins) / -sum(h["net"] for h in losses), 2) if losses else None,
        }
        return {"acct": acct, "positions": [self.pos_view(p) for p in self.positions],
                "orders": [self.order_view(o) for o in self.orders], "trail": self.trail, "ticket": self.ticket,
                "rules": self.rules, "events": self.events[-20:], "day": self.day, "squareoff_today": self.squareoff_today(),
                "mode": self.mode, "jlock": self._jlock()}

    def _jlock(self):
        try:
            return self.journal_lock() if self.journal_lock else None
        except Exception:
            return None

    def set_rules(self, new: dict):
        r = dict(self.rules)
        for k, v in new.items():
            if k not in DEFAULT_RULES:
                continue
            d = DEFAULT_RULES[k]
            if isinstance(d, bool):
                v = bool(v)
            elif isinstance(d, (int, float)) and not isinstance(d, bool):
                v = float(v)
                if v < 0:
                    raise Refused(f"{k} can't be negative")
                if isinstance(d, int):
                    v = int(v)
            elif k in TIME_KEYS:
                v = str(v or "").strip()
                if len(v) == 4 and v[1] == ":":
                    v = "0" + v
                if v and not (len(v) == 5 and v[2] == ":" and v[:2].isdigit() and v[3:].isdigit() and int(v[:2]) < 24 and int(v[3:]) < 60):
                    raise Refused(f"{TIME_LABELS.get(k, k)}: use HH:MM in 24-hour time, e.g. 15:25")
                if not v and k.startswith("fy_sq"):
                    raise Refused("Fyers' square-off times can't be empty (turn the app's square-off off instead)")
            elif k == "max_mode" and v not in ("static", "trailing"):
                raise Refused("max loss: static or trailing")
            elif k == "day_from" and v not in ("balance", "equity", "higher"):
                raise Refused("day from: balance, equity or higher")
            r[k] = v
        if r["size"] <= 0:
            raise Refused("size must be above 0")
        if r["sq_before_min"] > 60:
            raise Refused("square-off: at most 60 minutes before Fyers'")
        size_changed = r["size"] != self.rules["size"]
        self.rules = r
        store.save(self.dir + "paper_rules.json", r)
        if size_changed and not self.positions and not self.orders and not self.history:
            self.acct.update(start=r["size"], peak=r["size"])
            self.day = {}
        self.changed("Rules saved")

    @staticmethod
    def _apply_trail(tr: dict, new: dict):
        for k in ("be_on", "sl_on"):
            if k in new:
                tr[k] = bool(new[k])
        for k in ("be_r", "sl_r"):
            if k in new:
                v = float(new[k])
                if v <= 0:
                    raise Refused("R must be above 0")
                tr[k] = v

    def _rearm(self, p, new: dict):
        tr = p.get("tr") or self.trail
        if "be_on" in new or "be_r" in new:
            at_be = p.get("floor") is not None or (p["basis"] == "self" and p.get("sl") is not None
                                                  and p["side"] * (p["sl"] - p["avg"]) >= 0)
            if tr["be_on"] and not at_be:
                p["be_done"] = False
        if "sl_on" in new or "sl_r" in new:
            p["own_stop"] = False

    def set_pos_trail(self, pid, new: dict):
        """Trailing for one trade (the controls on its entry line), as in LiveTrader 1.24: typing a trade's R switches that
        trail on; from then on the trade has its own setting (own_be / own_sl) until the panel's is changed."""
        p = self.find_pos(pid)
        new = dict(new)
        if "be_r" in new and "be_on" not in new:
            new["be_on"] = True
        if "sl_r" in new and "sl_on" not in new:
            new["sl_on"] = True
        tr = dict(p.get("tr") or self.trail)
        self._apply_trail(tr, new)
        if "be_on" in new or "be_r" in new:
            tr["own_be"] = True
        if "sl_on" in new or "sl_r" in new:
            tr["own_sl"] = True
        p["tr"] = tr
        self._rearm(p, new)
        self.changed(f"{self.short(p['s'])}: Trail BE {'ON' if tr['be_on'] else 'off'} {tr['be_r']:g}R, "
                     f"Trail SL {'ON' if tr['sl_on'] else 'off'} {tr['sl_r']:g}R")

    def set_trail(self, new: dict):
        """Defaults for new trades. As in LiveTrader 1.24, changing the panel's Trail BE (switch or R) makes every open trade
        follow the panel's Trail BE again (switch and R, dropping what was set on its own line); the same for Trail SL."""
        self._apply_trail(self.trail, new)
        grp = {"be": "be_on" in new or "be_r" in new, "sl": "sl_on" in new or "sl_r" in new}
        for p in self.positions:
            tr = dict(p.get("tr") or self.trail)
            for g in ("be", "sl"):
                if grp[g]:
                    tr[g + "_on"], tr[g + "_r"], tr["own_" + g] = self.trail[g + "_on"], self.trail[g + "_r"], False
            p["tr"] = tr
            self._rearm(p, new)
        self.changed(f"Trail BE {'ON' if self.trail['be_on'] else 'off'} {self.trail['be_r']:g}R, "
                     f"Trail SL {'ON' if self.trail['sl_on'] else 'off'} {self.trail['sl_r']:g}R")

    def set_ticket(self, new: dict):
        for k in DEFAULT_TICKET:
            if k in new:
                self.ticket[k] = new[k]
        self.save()

    def reset(self, capital: float):
        if capital <= 0:
            raise Refused("capital must be above 0")
        self.positions, self.orders = [], []
        self.acct = {"start": capital, "realized": 0.0, "peak": capital, "created": now(),
                     "cycle": self.acct.get("cycle", 1) + 1}
        self.day = {}
        self.rules["size"] = capital
        store.save(self.dir + "paper_rules.json", self.rules)
        self.history_archive()
        self._symbols_changed()
        self.changed(f"Paper account reset to ₹{capital:,.0f}")

    def history_archive(self):
        if self.history:
            store.save(self.dir + f"paper_trades_until_{time.strftime('%Y%m%d_%H%M%S')}.json", self.history)
        self.history = []
        self.save_history()


