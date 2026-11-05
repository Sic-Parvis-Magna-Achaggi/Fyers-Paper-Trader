"""Live accounts: the paper engine's rules, sizing, guards, BE, trailing and targets, with real orders at Fyers.

The design (docs/Roadmap.md, agreed 31 Oct 2026):
- Entries go to Fyers; positions open only when Fyers reports the fill (order-update socket, with the order book
  checked as a fallback), at Fyers' traded price.
- A real stop sits at Fyers from the moment a trade opens: a stop-limit (SL-L) sell for a long, buy for a short,
  its limit a little past the trigger (rules: live_slack_pct / live_slack_ticks). Trailing, BE and BE-T move that
  same order (pos["sl"] / pos["floor"] -> one modify), never below BE and never backwards (the paper engine's rules).
- The server still watches with the bid / ask rule (a long's stop fires when the bid reaches it). When its rule
  fires first, or the target is reached (targets stay on the server), or square-off / expiry / ✕ / kill switch:
  NSE and BSE: the stop order itself is changed to a market order.
  MCX (Fyers doesn't allow changing an order's type there) or if the change is refused: the stop is cancelled,
  the cancel confirmed, and only then a market exit sent.
  There is never more than one exit order at Fyers for a position.
- A stop that triggered but didn't fill (price jumped past its limit) is caught by the same rule and turned to market.
- Server down: the Fyers stop protects the position at its last level. Back up: the order book is read first
  (a stop that filled is recorded), then trailing and targets resume; a target already passed closes at market.
- Overnight (Carry / NRML): Fyers orders last a day, so the next day a fresh stop is placed at the trailed level
  once the contract is trading and the Fyers login is done. Before placing a new stop the app checks Fyers still has
  the position (it may have been closed while the app was down).
- A refused or delayed stop change: the previous stop stays in force at Fyers, a warning shows and the app retries.
- Kill switch: cancel everything, close everything at Fyers (the app's trades and any others on this login), then
  new orders are refused until Resume. Delivery holdings from earlier days are not sold by it (v0.33.0).

v0.33.0 (roadmap 16): this is THE Live account, the admin's Fyers account itself (rt.LIVE_ID), no longer a paper account
switched to Live. Its balance, margin and free funds are Fyers' own (funds API, both ledgers); money moved in or out is
never a profit or a loss. Every trade on the Fyers account is shown and managed, placed here or straight in Fyers
(_outside: orders, fills, adds and part exits; _a_fysync: the position and holdings books as the fallback). A stop
placed in Fyers is adopted as the trade's stop (that same order is moved, keeping its own type); a trade without one
is flagged and gets a stop only when you tap for it.

All engine state changes happen on the event loop (like the paper engine). Fyers calls run in worker threads, one
action at a time per account (exits first)."""
from __future__ import annotations

import asyncio
import logging
import time

from . import charges, symbols
from .broker import (DONE_STATES, OPEN_STATES, ST_CANCELLED, ST_EXPIRED, ST_FILLED, ST_PENDING, ST_REJECTED, ST_TRANSIT,
                     STATUS_NAME, T_LIMIT, T_MARKET, T_STOP, T_STOPLIMIT, BrokerRefused, BrokerUnsure, FyersBroker, new_tag,
                     norm_order)
from .paper import Paper, Refused, ist, now

log = logging.getLogger("live")

P_EXIT, P_ENTRY, P_SYNC, P_POLL = 0, 1, 2, 3
FUNDS_SEC = 60                 # Fyers' funds, read this often (and a few seconds after every fill)
FYSYNC_SEC = 30                # the position book (trades made in Fyers that the order updates missed)
HOLD_SEC = 600                 # the holdings (delivery shares in the demat) - and after any delivery fill
IDLE_SEC = 300                 # all three, when nothing is open and no market is trading
FILL_LAG_SEC = 60              # after a fill, Fyers' position book may lag this long: no conclusions drawn from it


class Unconfirmed(Exception):
    """Fyers' order book couldn't be read, so whether an order went through is still unknown."""


class LiveEngine(Paper):
    mode = "live"

    def __init__(self, folder: str = "", link=None, name: str = "", broker=None, client_id=None):
        self.broker = broker or FyersBroker(link)
        self.client_id = client_id or None
        self._mm: dict = {}                      # (symbol, product) -> (Fyers qty, first seen): a mismatch read twice
        self._last_funds = self._last_fysync = self._last_hold = 0.0
        self._hold: list = []                    # the last holdings read
        self._hold_due = True
        self.L = {"oids": {}, "tags": {}, "halted": None}
        self.loop = None
        self.q = None
        self._n = 0
        self._queued: set = set()
        self._seen: dict = {}
        self._last_poll = 0.0
        self._tasks: list = []
        self.stream = None                       # the user's OrderStream (rt.py), for its status
        super().__init__(folder, link, name)

    # ------------------------------------------------------------ storage
    def _load_extra(self, s):
        L = s.get("live") or {}
        self.L = {"oids": L.get("oids") or {}, "tags": L.get("tags") or {}, "halted": L.get("halted"),
                  "filled": L.get("filled") or {},      # Fyers order id -> [qty booked, cost] (exits booked as they fill)
                  "dropped": L.get("dropped") or {},    # entries given up on, kept in case Fyers shows them later
                  "alerts": L.get("alerts") or [],      # things the owner must check in Fyers (shown until Resync)
                  "done": L.get("done") or {},          # Fyers ids of finished orders already handled (not replayed)
                  # v0.33.0
                  "funds": L.get("funds"),              # Fyers' funds, last read (both ledgers)
                  "xfilled": L.get("xfilled") or {},    # orders placed outside the app: Fyers id -> qty already booked
                  "base": L.get("base"),                # the first full read of Fyers done (what was there before is adopted, not replayed)
                  "skip": L.get("skip") or {}}          # contracts at Fyers the app's contract list doesn't have

    def _save_extra(self):
        for k, n in (("tags", 400), ("filled", 300), ("dropped", 50), ("done", 20000), ("xfilled", 20000), ("skip", 50)):
            if len(self.L[k]) > n:                        # recent ones are enough
                self.L[k] = dict(list(self.L[k].items())[-n:])
        return {"live": self.L}

    def _alert(self, msg):
        """Something only the owner can sort out in Fyers: a red warning that stays until Resync."""
        self.L["alerts"] = (self.L["alerts"] + [msg])[-10:]
        self.event(msg, "warn")

    # ------------------------------------------------------------ money: Fyers' own funds (v0.33.0)
    def _F(self):
        return self.L.get("funds") or None

    @staticmethod
    def _both(F, k) -> float:
        """A funds figure over both Fyers ledgers (capital + commodity)."""
        return round(float((F.get("eq") or {}).get(k) or 0) + float((F.get("co") or {}).get(k) or 0), 2)

    def _net_since(self, t0) -> float:
        tot = 0.0
        for h in reversed(self.history):                  # (the history is in closing order)
            if (h.get("closed") or 0) < t0:
                break
            tot += h.get("net") or 0
        return round(tot, 2)

    def balance(self) -> float:
        """Fyers' balance at the start of its day + money moved in / out today + the net (after every charge) of the
        trades closed since. Without a Fyers read yet: the account's own figures."""
        F = self._F()
        if not F:
            return super().balance()
        return round(self._both(F, "start") + self._both(F, "transfer") + self._net_since(F.get("t0") or 0), 2)

    def margin_used(self) -> float:
        F = self._F()
        return self._both(F, "used") if F else super().margin_used()

    def free_margin(self, row=None) -> float:
        """Fyers' available balance: the commodity ledger for MCX (unless Fyers keeps one ledger for both), else the
        capital ledger; both added up for the account's own figure."""
        F = self._F()
        if not F:
            return super().free_margin(row)
        if row is None:
            return self._both(F, "available")
        co = row.get("x") == "MCX" or row.get("g") == "COM"
        if co and ((F.get("co") or {}).get("total") or (F.get("co") or {}).get("available")):
            return round(float(F["co"].get("available") or 0), 2)
        return round(float((F.get("eq") or {}).get("available") or 0), 2)

    def _transfer_today(self) -> float:
        F = self._F()
        return self._both(F, "transfer") if F and self.day.get("fy") == F.get("date") else 0.0

    def floors(self) -> dict:
        """The paper engine's floors, on the account size from Fyers. Money moved in or out today moves the day's start
        (as LiveTrader 1.18's balance operations): it's never counted as a profit or a loss."""
        f = super().floors()
        if f["daily"] is not None:
            f["daily"] = round(f["daily"] + self._transfer_today(), 2)
        return f

    def _apply_funds(self, raw: dict):
        """A fresh Fyers funds read: the balance, the account size for the % rules, money in / out, the day's start."""
        d = ist()
        date = d.strftime("%Y-%m-%d")
        t0 = d.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        F = {"eq": dict(raw.get("eq") or {}), "co": dict(raw.get("co") or {}), "at": now(), "date": date, "t0": t0}
        self.L["funds"] = F
        A = self.acct
        tr = self._both(F, "transfer")
        trs = A.setdefault("transfers", {})
        if not A.get("live_v"):
            # the first read: the account size for the % rules is Fyers' balance at the start of today plus money moved
            # in today (LiveTrader's "size follows the starting deposit"); no typed capital on the Live account
            size = round(self._both(F, "start") + tr, 2)
            A.update(live_v=1, size=size, start=size, since=date, realized=0.0, peak=self.balance())
            trs[date] = tr
            self.event(f"Fyers funds: start of day ₹{self._both(F, 'start'):,.2f}, available ₹{self._both(F, 'available'):,.2f} - "
                       f"the % rules count from your real Fyers balance (account size ₹{size:,.2f})")
        else:
            delta = round(tr - float(trs.get(date, 0) or 0), 2)
            if abs(delta) >= 0.01:
                trs[date] = tr
                for k in ("size", "peak"):
                    A[k] = round(float(A.get(k) or 0) + delta, 2)
                A["start"] = A["size"]
                self.event(f"Money {'in' if delta > 0 else 'out'} at Fyers: ₹{abs(delta):,.2f} - not a profit or a loss "
                           f"(the account size, today's start and the highest balance move by it)")
        if len(trs) > 400:
            for k in sorted(trs)[:-400]:
                trs.pop(k)
        size = max(1.0, float(A.get("size") or 0))
        if self.rules.get("size") != size:
            self.rules["size"] = size
            from . import store
            store.save(self.dir + "paper_rules.json", self.rules)
        self.roll_day()
        if self.day.get("fy") != date and self.day.get("date") == date:
            # today's start as Fyers reports it (the daily loss counts from it; the estimate made at the day's reset goes)
            off = (self.day.get("start_eq") or 0) - (self.day.get("start_bal") or 0)
            self.day.update(start_bal=self._both(F, "start"), start_eq=round(self._both(F, "start") + off, 2), fy=date)
            self.event(f"Today's start from Fyers: ₹{self._both(F, 'start'):,.2f}")
        self.acct["peak"] = max(float(self.acct.get("peak") or 0), self.balance())

    def set_rules(self, new: dict):
        super().set_rules({k: v for k, v in new.items() if k != "size"})   # the size comes from Fyers

    def funds_view(self) -> dict | None:
        F = self._F()
        if not F:
            return None
        out = {k: self._both(F, k) for k in ("start", "transfer", "total", "used", "available", "realized", "collateral")}
        out.update(eq=F.get("eq"), co=F.get("co"), at=F.get("at"), date=F.get("date"),
                   net_today=self._net_since(F.get("t0") or 0), size=self.acct.get("size"),
                   day_start_from_fyers=self.day.get("fy") == F.get("date"))
        return out

    # ------------------------------------------------------------ running
    def start(self, loop):
        """Start this account's Fyers worker on the event loop (rt.py calls this once the loop runs)."""
        if self.loop:
            return
        self._tasks = [t for t in self._tasks if not t.done()]
        self.loop = loop
        self.q = asyncio.PriorityQueue()
        self._tasks.append(loop.create_task(self._worker()))
        self.enqueue(("poll",), P_POLL)                      # read Fyers first: what happened while we were away
        self.enqueue(("funds",), P_POLL, 0.5)
        self._hold_due = True
        self.enqueue(("fysync",), P_POLL, 2.0)               # then the position book and the holdings
        for p in self.positions:
            if p.get("exiting") and not p.get("exit_oid"):
                self.enqueue(("exit", p["id"]), P_EXIT, 1.0)
            elif p.get("exit_oid"):
                self.enqueue(("chase", p["id"]), P_EXIT, 1.0)
            else:
                self.enqueue(("sync", p["id"]), P_SYNC, 1.5)
        for o in self.orders:
            if not o.get("oid"):
                self.enqueue(("entry_check", o["id"]), P_ENTRY, 1.0)

    def stop(self):
        for t in self._tasks:              # kept referenced until the loop has processed the cancel
            t.cancel()
        self.loop = None

    def enqueue(self, act: tuple, prio: int, delay: float = 0.0):
        if not self.loop:
            return
        key = act
        if key in self._queued:
            return
        self._queued.add(key)

        def put():
            self._n += 1
            self.q.put_nowait((prio, self._n, act))
        if delay:
            self.loop.call_later(delay, put)
        else:
            put()

    async def _worker(self):
        while True:
            prio, _, act = await self.q.get()
            self._queued.discard(act)
            try:
                await getattr(self, "_a_" + act[0])(*act[1:])
            except PermissionError as e:
                if now() - getattr(self, "_perm_warned", 0) > 300:
                    self._perm_warned = now()
                    self.event(f"Fyers: {e}", "warn")
                    self._push()
            except Exception as e:
                log.exception("[%s] live action %s failed: %s", self.dir, act, e)
                self.event(f"Live: {act[0]} failed ({e})", "warn")
                self._push()

    async def _x(self, fn, *a):
        return await asyncio.get_running_loop().run_in_executor(None, fn, *a)

    def _push(self):
        self.save()
        if self.on_change:
            self.on_change(None)

    # ------------------------------------------------------------ helpers
    def _order(self, lid):
        return next((o for o in self.orders if o["id"] == lid), None)

    def _pos(self, pid):
        return next((p for p in self.positions if p["id"] == pid), None)

    def _ex(self, s) -> str:
        r = self.row(s)
        return r.get("x") or s.split(":", 1)[0]

    def _tick(self, s) -> float:
        return self.row(s).get("tick") or 0.05

    def _slack(self, px, s) -> float:
        R, t = self.rules, self._tick(s)
        return max(float(R.get("live_slack_ticks") or 0) * t, abs(px) * float(R.get("live_slack_pct") or 0) / 100, t)

    def _limit_past(self, px, order_side, s) -> float:
        """The limit for a stop-limit order: past the trigger in the order's direction (a sell below, a buy above)."""
        t = self._tick(s)
        v = charges.round_tick(px + order_side * self._slack(px, s), t, order_side)
        return max(t, v)

    def _marketable(self, pos):
        """A limit price that crosses the spread now (for re-pricing an exit that hasn't filled)."""
        p = self.px(pos["s"])
        if not self.fresh(pos["s"]):
            return None
        side = -pos["side"]
        ref = float((p.get("ask") if side > 0 else p.get("bid")) or p.get("ltp") or 0)
        if not ref:
            return None
        return self._limit_past(ref, side, pos["s"])

    def desired_stop(self, pos):
        """(trigger, limit) for the stop at Fyers, in the option's / contract's own price, or None (no stop)."""
        row = self.row(pos["s"], pos["product"])
        side, t = pos["side"], self._tick(pos["s"])
        c = []
        if pos.get("sl") is not None:
            if pos["basis"] == "underlying":       # Fyers can't trigger on the future: the delta estimate, own price
                c.append(self.est_exit_at(row, side, pos["avg"], pos["sl"], "underlying", pos.get("ref_entry"), pos.get("delta")))
            else:
                c.append(pos["sl"])
        if pos.get("floor") is not None:
            c.append(pos["floor"])
        if not c:
            return None
        trig = max(c) if side > 0 else min(c)
        trig = charges.round_tick(trig, t, -side)
        trig = max(trig, t)
        return trig, self._limit_past(trig, -side, pos["s"])

    def _today(self) -> str:
        return ist().strftime("%Y-%m-%d")

    def _map(self, oid, kind, ref, tag=None):
        self.L["oids"][str(oid)] = [kind, ref]
        if tag:
            self.L["tags"][tag] = [kind, ref]

    def _unmap(self, oid):
        self.L["oids"].pop(str(oid), None)

    async def _send_new(self, body: dict) -> str | None:
        """Place an order. Returns its id; None if Fyers confirmably has no such order (safe to try again);
        raises BrokerRefused (Fyers said no) or Unconfirmed (couldn't tell - don't send another).
        The caller has recorded the order's tag (and its 'sent' / pending mark); it's saved to disk before the call,
        so a crash in the middle can't lead to the order being sent twice after a restart."""
        self.save()
        try:
            return await self._x(self.broker.place, body)
        except BrokerUnsure as e:
            self.event(f"Fyers didn't confirm an order ({e}) - looking it up", "warn")
            return await self._resolve_tag(body["orderTag"])

    async def _resolve_tag(self, tag) -> str | None:
        clear = 0
        for i in range(6):
            await asyncio.sleep(0.8 + 0.5 * i)
            try:
                r = await self._x(self.broker.find_tag, tag)
            except (BrokerUnsure, BrokerRefused):
                continue
            if r:
                return str(r.get("id"))
            clear += 1
        if clear >= 4:
            return None
        raise Unconfirmed(f"couldn't read Fyers' order book to check order {tag}")

    # ------------------------------------------------------------ the paper engine's hooks
    def _check_order(self, o) -> bool:
        return False                                     # entries fill only when Fyers says so

    def _check_pos(self, pos) -> bool:
        if pos.get("exiting"):
            return False
        return super()._check_pos(pos)

    def close(self, pos, price, reason):
        """The paper engine closes here (stop, target, square-off, expiry, ✕): at Fyers, the position stays open until
        Fyers reports the exit fill."""
        self.request_exit(pos, reason)

    def request_exit(self, pos, reason):
        if pos.get("exiting"):
            return
        pos.update(exiting=reason, exit_req_at=now(), exit_fail=0)
        self.changed(f"{self.short(pos['s'])}: {reason} - closing at Fyers", "warn" if reason in ("sl", "kill") else "info")
        self.enqueue(("exit", pos["id"]), P_EXIT)

    def changed(self, msg=None, lvl="info"):
        super().changed(msg, lvl)
        for p in self.positions:                          # a stop moved (trail, BE, your edit) -> move the Fyers stop
            if not p.get("exiting") and self._stop_differs(p):
                self.enqueue(("sync", p["id"]), P_SYNC)

    def _stop_differs(self, p) -> bool:
        d = self.desired_stop(p)
        if d is None:
            return False
        return not p.get("stop_oid") or (d[0], p["qty"]) != (p.get("stop_px"), p.get("stop_qty"))

    def plan(self, req: dict, place=False) -> dict:
        out = super().plan(req, place)
        out["live"] = True
        if self.L.get("halted"):                         # the real reason nothing can be placed: shown first
            out["blocked"] = "Live trading is paused after the kill switch - press Resume on the Account page"
        elif not self._F():                              # (the rules' figures would come from a made-up balance)
            out["blocked"] = "reading your Fyers funds first (the % rules count from your real balance) - try again in a moment"
        if not out.get("blocked"):
            why = None
            other = self._other_client()
            if not (self.link and self.link.token()):
                why = "log in to Fyers first (the daily login)"
            elif other:
                why = other
            elif out.get("sl") is None:
                why = "a Live trade needs a stop loss (it's placed at Fyers as soon as the trade opens)"
            elif not self.fresh(out["s"]):
                why = "this contract isn't trading now (Fyers takes no after-market orders)"
            if why:
                out["blocked"] = why
        return out

    def place(self, req: dict) -> dict:
        p = self.plan(req, place=True)
        if p.get("blocked"):
            raise Refused(p["blocked"])
        side = p["side"]
        existing = next((x for x in self.positions if x["s"] == p["s"] and x["product"] == p["product"]), None)
        if existing and existing["side"] != side:
            raise Refused("you have an opposite position in this contract - close it first")
        if existing and existing.get("exiting"):
            raise Refused("that position is being closed at Fyers - wait for it")
        if any(o["s"] == p["s"] and o["side"] != side for o in self.orders):
            raise Refused("there's an opposite pending order on this contract - cancel it first")
        o = {k: p.get(k) for k in ("s", "side", "type", "product", "basis", "qty", "lots", "sl", "tp", "ref",
                                   "ref_price", "delta", "margin", "risk")}
        o.update(id=self._id("O"), price=p["entry"], created=now(), live=True, state="sending", filled=0,
                 fill_cost=0.0, tag=new_tag("E"))
        self.L["tags"][o["tag"]] = ["entry", o["id"]]
        self.orders.append(o)
        self._symbols_changed()
        self.changed(f"Sending {'BUY' if side > 0 else 'SELL'} {o['type'].upper()} {self.short(o['s'])} {o['lots']} lot"
                     + ("" if o["type"] == "market" else f" @ {o['price']}") + " to Fyers")
        self.enqueue(("entry", o["id"]), P_ENTRY)
        return p

    def cancel(self, oid, quiet=False):
        o = self._order(oid)
        if not o:
            raise Refused("that order is already gone")
        if o.get("cancel_req"):
            return
        o["cancel_req"] = True
        if not o.get("oid") and not o.get("sent"):        # never sent: just drop it
            self.orders = [x for x in self.orders if x["id"] != oid]
            self._symbols_changed()
            self.changed(None if quiet else f"Cancelled {o['type']} order {self.short(o['s'])}")
            return
        # sent (maybe unconfirmed): kept until Fyers shows it (then it's cancelled there) or confirms it doesn't exist
        self.changed(None if quiet else f"Cancelling {o['type']} order {self.short(o['s'])} at Fyers")
        if o.get("oid"):
            self.enqueue(("cancel", oid), P_ENTRY)

    def modify_order(self, oid, price="keep", sl="keep", tp="keep"):
        o = self._order(oid)
        old = o["price"] if o else None
        if o and price != "keep" and o.get("outside") and o.get("fy_type") == T_MARKET:
            raise Refused("that's a market order at Fyers: its price can't be moved (cancel it instead)")
        super().modify_order(oid, price, sl, tp)
        o = self._order(oid)
        if o and o["price"] != old and o.get("oid"):
            if o.get("outside") and o.get("fy_type") == T_STOPLIMIT and o.get("fy_limit"):
                o["fy_limit"] = charges.round_tick(o["fy_limit"] + (o["price"] - old), self._tick(o["s"]))
            self.enqueue(("entry_mod", oid), P_ENTRY)

    def close_all(self):
        kept = 0
        for p in list(self.positions):
            if p.get("holding"):                          # delivery shares from earlier days: sold only with their own ✕
                kept += 1
                continue
            if self.fresh(p["s"]):
                self.request_exit(p, "manual")
        if kept:
            self.event(f"Close all: your {kept} delivery holding(s) are kept (sell one with its own ✕)")
        for o in list(self.orders):
            self.cancel(o["id"], quiet=True)
        self.changed("Closing everything at Fyers")

    def reset(self, capital: float):
        raise Refused("the Live account can't be reset - it's your Fyers account and its trades are real")

    def housekeeping(self):
        super().housekeeping()
        if not self.loop or not (self.link and self.link.token()):
            return
        t = now()
        for p in self.positions:
            if p.get("exiting"):
                if not p.get("exit_oid") and t - p.get("exit_req_at", t) > 15:
                    self.enqueue(("exit", p["id"]), P_EXIT)      # an exit that never got going: try again
                elif p.get("exit_oid"):
                    self.enqueue(("chase", p["id"]), P_EXIT, 1.0)
                continue
            if not p.get("stop_oid") and self.fresh(p["s"]) and self.desired_stop(p):
                self.enqueue(("sync", p["id"]), P_SYNC)          # a position without a stop at Fyers (new day, refused)
        busy = any(p.get("exit_oid") or p.get("stop_status") == ST_TRANSIT for p in self.positions) or \
            any(o.get("oid") for o in self.orders)
        stream_up = bool(self.stream and self.stream.up)
        active = bool(self.positions or self.orders) or self._mkt_hours()
        gap = 5 if (busy and not stream_up) else (15 if busy else (60 if (self.positions or self.orders) else 120))
        if not active:
            gap = IDLE_SEC
        if t - self._last_poll > gap:
            self.enqueue(("poll",), P_POLL)
        if t - self._last_funds > (FUNDS_SEC if active else IDLE_SEC):
            self._last_funds = t
            self.enqueue(("funds",), P_POLL)
        if t - self._last_fysync > (FYSYNC_SEC if active else IDLE_SEC):
            self._last_fysync = t
            self.enqueue(("fysync",), P_POLL)

    # ------------------------------------------------------------ order updates (socket or order book)
    def on_update(self, u: dict):
        """One order's state from Fyers (norm_order). Runs on the event loop. An update counts as seen only once it
        has been handled, so a failure is retried the next time the order book is read."""
        oid = u["id"]
        sig = (u["status"], u["filled"], u["stop"], u["limit"], u["qty"], u["type"])
        if self._seen.get(oid) == sig or oid in self.L["done"]:
            return
        try:
            k = self.L["oids"].get(oid)
            if not k and u.get("tag") in self.L["tags"]:      # an order we placed but never heard the id of
                if not self._adopt(oid, self.L["tags"][u["tag"]], u):
                    self._stray(u, self.L["tags"][u["tag"]])
                    self._seen[oid] = sig
                    if u["status"] in DONE_STATES:
                        self.L["done"][oid] = 1
                    return
                k = self.L["oids"].get(oid)
            if not k:
                self._outside(u)                              # placed outside the app (v0.33.0): managed too
                self._seen[oid] = sig
                if u["status"] in DONE_STATES:
                    self.L["done"][oid] = 1
                return
            kind, ref = k
            getattr(self, "_u_" + kind)(ref, u)
            self._seen[oid] = sig
            if u["status"] in DONE_STATES:
                self.L["done"][oid] = 1
        except Exception as e:
            log.exception("[%s] order update %s: %s", self.dir, oid, e)

    # ------------------------------------------------------------ trades placed outside the app (v0.33.0)
    PRODUCTS = ("INTRADAY", "MARGIN", "CNC", "MTF", "CO", "BO")

    def _pos_key(self, s, prod):
        return next((x for x in self.positions if x["s"] == s and x["product"] == prod), None)

    def _known(self, s) -> bool:
        if symbols.get(s):
            return True
        if s not in self.L["skip"]:
            self.L["skip"][s] = now()
            self._alert(f"CHECK FYERS: {s} is at Fyers but not in the app's contract list - the app can't manage it.")
        return False

    @staticmethod
    def _otype(u) -> str:
        return {T_LIMIT: "limit", T_MARKET: "market", T_STOP: "stop", T_STOPLIMIT: "stop"}.get(u["type"], "limit")

    def _outside(self, u):
        """An order the app didn't place (the Fyers app or web, another platform). Its fills open / add to / close
        positions like the app's own; a stop against a position with none at Fyers becomes that position's stop;
        anything else still pending shows as an order here (move or cancel it from the chart)."""
        if not self.L.get("base"):                # the first full read of Fyers sets the baseline (_a_poll)
            return
        s, prod = u["symbol"], u["product"]
        if not s or prod not in self.PRODUCTS or not self._known(s):
            return
        oid = u["id"]
        booked = int(self.L["xfilled"].get(oid, 0))
        if u["filled"] > booked:
            self.L["xfilled"][oid] = u["filled"]
            self._outside_fill(u, u["filled"] - booked, u["traded"] or u["limit"] or u["stop"])
        if u["status"] in OPEN_STATES and u["qty"] > u["filled"]:
            pos = self._pos_key(s, prod)
            if pos and u["side"] == -pos["side"] and u["type"] in (T_STOP, T_STOPLIMIT) and not pos.get("exiting") \
                    and not pos.get("stop_oid") and not pos.get("stop_tag_pending"):
                self._adopt_stop(pos, u)
                return
            self._adopt_order(u)
        else:
            self._push()

    def _adopt_stop(self, pos, u):
        """A stop placed in Fyers becomes the trade's stop: that same order is moved by trailing / BE from now on (keeping
        its own type: SL-M stays SL-M), so there's never a second exit order at Fyers. With no stop before, it sets 1R."""
        oid = u["id"]
        self._map(oid, "stop", pos["id"])
        pos.update(stop_oid=oid, stop_px=u["stop"], stop_lim=u["limit"] if u["type"] == T_STOPLIMIT else None,
                   stop_qty=u["qty"], stop_day=self._today(), stop_status=u["status"], stop_state="live", stop_err=None,
                   stop_type=u["type"], stop_adopted=True)
        if pos.get("sl") is None and pos.get("floor") is None:
            pos["sl"] = u["stop"]
            pos["_pk"] = "edit"
            if pos.get("first_sl") is None:                    # its first stop: 1R
                pos["first_sl"] = u["stop"]
                pos["init_risk"] = round(self.pos_risk(pos), 2)
        self.changed(f"{self.short(pos['s'])}: the stop placed in Fyers @ {u['stop']} is now this trade's stop "
                     f"(trailing and BE move that same order)")

    def _adopt_order(self, u):
        """A pending order placed in Fyers: shown here (chart, Trades page, phone); move or cancel it from the app."""
        oid = u["id"]
        lid = (self.L["oids"].get(oid) or [None, None])[1]
        o = self._order(lid) if lid else None
        row = self.row(u["symbol"])
        lot = row.get("lot") or 1
        typ = self._otype(u)
        price = u["limit"] if u["type"] == T_LIMIT else (u["stop"] or u["limit"] or u["traded"])
        if not o:
            o = {"id": self._id("O"), "s": u["symbol"], "side": u["side"], "type": typ, "product": u["product"],
                 "basis": "self", "qty": u["qty"] - u["filled"], "lots": (u["qty"] - u["filled"]) // lot, "sl": None, "tp": None,
                 "ref": None, "ref_price": None, "delta": None, "margin": 0, "risk": 0, "price": price, "created": now(),
                 "live": True, "outside": True, "oid": oid, "state": "open", "filled": u["filled"], "fill_cost": 0.0,
                 "fy_type": u["type"], "fy_limit": u["limit"]}
            self.orders.append(o)
            self._map(oid, "xorder", o["id"])
            self._symbols_changed()
            if self.L.get("halted"):                       # the kill switch is on: nothing new stays working
                self.cancel(o["id"], quiet=True)
                self.changed(f"{self.short(u['symbol'])}: an order placed in Fyers during the kill switch - cancelling it", "warn")
                return
            pos = self._pos_key(u["symbol"], u["product"])
            two = pos and u["side"] == -pos["side"] and pos.get("stop_oid")
            self.changed(f"{self.short(u['symbol'])}: a {typ} order placed in Fyers shows here "
                         f"({'BUY' if u['side'] > 0 else 'SELL'} {o['lots']} lot @ {price})"
                         + (" - with the trade's stop also at Fyers, there are now two exit orders: if both fill you'd hold "
                            "an opposite position. Cancel one." if two else ""), "warn" if two else "info")
            return
        o.update(type=typ, price=price, qty=u["qty"] - u["filled"], lots=(u["qty"] - u["filled"]) // lot,
                 fy_type=u["type"], fy_limit=u["limit"], state="open")
        self._push()

    def _u_xorder(self, lid, u):
        """A later update of an order placed in Fyers that the app shows."""
        o = self._order(lid)
        booked = int(self.L["xfilled"].get(u["id"], 0))
        if u["filled"] > booked:
            self.L["xfilled"][u["id"]] = u["filled"]
            self._outside_fill(u, u["filled"] - booked, u["traded"] or u["limit"] or u["stop"], o)
        if u["status"] in DONE_STATES or u["qty"] <= u["filled"]:
            self._unmap(u["id"])
            if o:
                self.orders = [x for x in self.orders if x["id"] != lid]
                self._symbols_changed()
                if u["status"] == ST_CANCELLED:
                    self.changed(f"{self.short(o['s'])}: the {o['type']} order placed in Fyers was cancelled")
                elif u["status"] in (ST_REJECTED, ST_EXPIRED):
                    self.changed(f"{self.short(o['s'])}: Fyers {STATUS_NAME.get(u['status'])} the {o['type']} order placed in Fyers"
                                 + (f": {u['msg']}" if u["msg"] else ""), "warn")
                else:
                    self._push()
            return
        if o:
            self._adopt_order(u)

    def _outside_fill(self, u, dq, px, order=None):
        """dq more of an outside order filled at px (Fyers' average for the order so far is close enough for a part)."""
        s, prod, side = u["symbol"], u["product"], u["side"]
        px = charges.round_tick(float(px or 0) or float(self.px(s).get("ltp") or 0), self._tick(s))
        if not px:
            self._alert(f"CHECK FYERS: {self.short(s)} filled {dq} outside the app with no price - check the trade book.")
            return
        pos = self._pos_key(s, prod)
        if pos is None or pos["side"] == side:
            self._outside_open(s, prod, side, dq, px, "Fyers (placed in Fyers)", order)
            return
        # against the position: a part or all of it closed in Fyers
        if pos.get("exiting"):
            self.event(f"{self.short(s)}: {dq} closed in Fyers while the app was closing it - re-checking Fyers' quantity", "warn")
        if dq < pos["qty"]:
            part = self._split(pos, dq)
            Paper.close(self, part, px, "closed in Fyers")
            self.event(f"{self.short(s)}: {dq} closed in Fyers @ {px}; {pos['qty']} still open (its stop follows)")
            self.changed()
            return
        rest = dq - pos["qty"]
        pid = pos["id"]
        Paper.close(self, pos, px, "closed in Fyers")
        for oid, (kind, ref) in list(self.L["oids"].items()):    # nothing of that trade may stay working at Fyers
            if ref == pid and kind in ("stop", "exit"):
                self.enqueue(("cancel_oid", oid), P_EXIT)
        if rest > 0:                                             # more than the position: the rest is a new one
            self._outside_open(s, prod, side, rest, px, "Fyers (placed in Fyers, past flat)", None)

    def _outside_open(self, s, prod, side, qty, px, how, order=None, holding=False, opened=None):
        lot = self.row(s).get("lot") or 1
        sl = order.get("sl") if order else None
        tp = order.get("tp") if order else None
        new = self._pos_key(s, prod) is None
        plan = {"s": s, "side": side, "product": prod, "basis": "self", "qty": qty, "lots": qty // lot, "sl": sl, "tp": tp,
                "margin": 0}
        self.fill(plan, px, how)
        pos = self._pos_key(s, prod)
        if pos and new:
            pos["outside"] = True
            if holding:
                pos["holding"] = True
            if opened:
                pos["opened"] = opened
                for e in pos["entries"]:
                    e["t"] = opened
            self._claim_stops(pos)
            if pos.get("sl") is None:
                self.event(f"{self.short(s)}: NO STOP - this trade was placed in Fyers without one. Tap \"Place my stop\" "
                           f"to put your default stop at Fyers (nothing is placed until you do).", "warn")
            self._push()
        if self.L.get("halted") and pos and not pos.get("exiting") and not pos.get("holding"):
            self.request_exit(pos, "kill")

    def _claim_stops(self, pos):
        """A stop placed in Fyers that showed up as a pending order before its position was known: the trade's stop."""
        if pos.get("stop_oid") or pos.get("stop_tag_pending") or pos.get("exiting"):
            return
        for o in list(self.orders):
            if o.get("outside") and o["s"] == pos["s"] and o["product"] == pos["product"] and o["side"] == -pos["side"] \
                    and o.get("fy_type") in (T_STOP, T_STOPLIMIT):
                self.orders = [x for x in self.orders if x["id"] != o["id"]]
                self._unmap(o["oid"])
                self._adopt_stop(pos, {"id": o["oid"], "stop": o["price"], "limit": o.get("fy_limit") or 0, "qty": o["qty"],
                                       "status": ST_PENDING, "type": o["fy_type"]})
                self._symbols_changed()
                return

    def _jn(self, kind, obj):
        super()._jn(kind, obj)
        self.enqueue(("funds",), P_POLL, 3.0)                  # a fill or a close: Fyers' funds again

    def _mkt_hours(self) -> bool:
        t = ist()
        return t.weekday() < 5 and "09:00" <= t.strftime("%H:%M") <= "23:55"

    async def _a_funds(self):
        if not (self.link and self.link.token()):
            return
        try:
            raw = await self._x(self.broker.funds)
        except (BrokerUnsure, BrokerRefused) as e:
            log.info("[%s] funds: %s", self.dir, e)
            return
        self._last_funds = now()
        self._apply_funds(raw)
        self._push()

    async def _a_fysync(self):
        """Fyers' position book (and holdings): the fallback that catches trades made in Fyers whose order updates the
        app missed (and, the first time, everything already there). A difference must be seen twice, 3 s apart, with
        nothing of the app's in flight on that contract, before the app acts on it."""
        if not (self.link and self.link.token()):
            return
        # the order book first: what it explains is booked exactly (Fyers' prices); only what's left is estimated, and
        # nothing is booked twice (an outside order booked from the books here is never booked again from its update)
        await self._a_poll()
        hold_now = self._hold_due or now() - self._last_hold > HOLD_SEC or any(p["product"] == "CNC" for p in self.positions)
        try:
            rows = await self._x(self.broker.positions)
            if hold_now:
                self._hold = await self._x(self.broker.holdings)
                self._last_hold = now()
                self._hold_due = False
        except (BrokerUnsure, BrokerRefused) as e:
            log.info("[%s] positions: %s", self.dir, e)
            return
        self._last_fysync = now()
        if not self.L.get("base"):                          # the order book's baseline first (_a_poll couldn't read it)
            self.enqueue(("fysync",), P_POLL, 3.0)
            return
        fy = {}
        for r in rows or []:
            sym, prod = r.get("symbol") or "", r.get("productType") or ""
            q = int(r.get("netQty") or 0)
            if not sym or prod not in self.PRODUCTS or not q:
                continue
            d = fy.setdefault((sym, prod), {"q": 0, "avg": 0.0, "h": 0, "hc": 0.0})
            d["q"] += q
            d["avg"] = float(r.get("netAvg") or 0) or float((r.get("buyAvg") if q > 0 else r.get("sellAvg")) or 0)
        for r in self._hold or []:                          # delivery shares in the demat (bought on earlier days)
            sym = r.get("symbol") or ""
            q = int(r.get("quantity") if r.get("quantity") is not None else r.get("remainingQuantity") or 0)
            if not sym or q <= 0:
                continue
            d = fy.setdefault((sym, "CNC"), {"q": 0, "avg": 0.0, "h": 0, "hc": 0.0})
            d["h"] += q
            d["hc"] = float(r.get("costPrice") or 0)
        keys = set(fy) | {(p["s"], p["product"]) for p in self.positions}
        acted = False
        for key in keys:
            d = fy.get(key) or {"q": 0, "avg": 0.0, "h": 0, "hc": 0.0}
            fq = d["q"] + d["h"]
            pos = self._pos_key(*key)
            aq = pos["side"] * pos["qty"] if pos else 0
            if fq == aq:
                self._mm.pop(key, None)
                continue
            if not self._known(key[0]) or self._busy(key, pos):
                self._mm.pop(key, None)
                continue
            seen = self._mm.get(key)
            if not seen or seen[0] != fq:
                self._mm[key] = (fq, now())
                self.enqueue(("fysync",), P_POLL, 3.5)        # read it again before acting
                continue
            if now() - seen[1] < 2.9:
                continue
            self._mm.pop(key, None)
            self._reconcile(key, d, fq, pos, aq)
            acted = True
        if acted:
            self.changed()

    def _busy(self, key, pos) -> bool:
        """Something of the app's on this contract is in flight (a fill may not be in Fyers' position book yet)."""
        if now() - getattr(self, "_kill_sent", {}).get(key[0], 0) < 90 or \
                any(k == "kill" and ref == key[0] for k, ref in self.L["oids"].values()):
            return True                                    # the kill switch is closing it at Fyers
        if pos and (pos.get("exiting") or pos.get("stop_status") == ST_TRANSIT or pos.get("stop_tag_pending") or self._just_filled(pos)):
            return True
        if any(o["s"] == key[0] and o["product"] == key[1] and not o.get("outside") for o in self.orders):
            return True
        return any(h["s"] == key[0] and h["product"] == key[1] and now() - (h.get("closed") or 0) < FILL_LAG_SEC for h in self.history[-20:])

    def _reconcile(self, key, d, fq, pos, aq):
        sym, prod = key
        est = " (an estimate: its order update was missed - check the price in Fyers' trade book)"
        ltp = float(self.px(sym).get("ltp") or 0)
        if pos and (fq == 0 or fq * aq < 0):                 # gone at Fyers, or the other way round now
            price = self.exit_mark(pos) if self.fresh(sym) else (pos.get("stop_px") or pos.get("sl") or self.exit_mark(pos))
            pid = pos["id"]
            Paper.close(self, pos, price, "closed in Fyers")
            self.event(f"{self.short(sym)}: closed in Fyers - recorded at {price}{est}", "warn")
            for oid, (kind, ref) in list(self.L["oids"].items()):
                if ref == pid and kind in ("stop", "exit"):
                    self.enqueue(("cancel_oid", oid), P_EXIT)
            pos, aq = None, 0
            if fq == 0:
                return
        side = 1 if fq > 0 else -1
        if not pos:                                          # at Fyers, not in the app: adopt it
            hold = prod == "CNC" and d["h"] > 0
            px = d["hc"] if hold and not d["q"] else d["avg"]
            if hold and d["q"] > 0 and d["avg"]:
                px = (d["h"] * d["hc"] + d["q"] * d["avg"]) / (d["h"] + d["q"])
            px = charges.round_tick(px or ltp, self._tick(sym))
            if not px:
                return
            how = "Fyers (a delivery holding in your demat)" if hold else "Fyers (found in its positions)"
            self._outside_open(sym, prod, side, abs(fq), px, how, None, holding=hold)
            self.event(f"{self.short(sym)}: {abs(fq)} {'held in the demat' if hold else 'open at Fyers'} @ {px} - shown and "
                       f"managed from now on")
            return
        if abs(fq) > abs(aq):                                # more at Fyers: added there
            dq = abs(fq) - abs(aq)
            px = 0.0
            if d["avg"] and d["q"]:
                px = (d["avg"] * abs(d["q"]) - pos["avg"] * abs(aq)) / dq
            if not px or (ltp and abs(px - ltp) > 0.2 * ltp):
                px = ltp or pos["avg"]
            px = charges.round_tick(px, self._tick(sym))
            self._outside_open(sym, prod, side, dq, px, "Fyers (added in Fyers)" + est)
            return
        dq = abs(aq) - abs(fq)                               # less at Fyers: part closed there
        price = self.exit_mark(pos)
        part = self._split(pos, dq)
        Paper.close(self, part, price, "closed in Fyers")
        self.event(f"{self.short(sym)}: {dq} closed in Fyers @ {price}{est}; {pos['qty']} still open", "warn")

    def _adopt(self, oid, k, u) -> bool:
        """An order found by its tag (its id was never heard: an unconfirmed placement, or a restart). True if it's
        the one the position / order is waiting for; anything else is a stray (see _stray)."""
        kind, ref = k
        if kind == "entry":
            o = self._order(ref)
            if o and not o.get("oid"):
                o.update(oid=oid, state="open")
                self._map(oid, "entry", ref)
                if o.get("cancel_req") and u["status"] in OPEN_STATES:
                    self.enqueue(("cancel", ref), P_ENTRY)
                return True
            return False
        if kind == "kill":
            self._map(oid, "kill", ref)
            return True
        p = self._pos(ref)
        if not p or u["status"] not in OPEN_STATES + (ST_FILLED,):
            return False
        if kind == "stop" and p.get("stop_tag_pending") == u["tag"] and not p.get("stop_oid"):
            p.update(stop_oid=oid, stop_px=u["stop"], stop_lim=u["limit"], stop_qty=u["qty"], stop_day=self._today(),
                     stop_tag_pending=None, stop_status=u["status"])
            self._map(oid, "stop", ref)
            return True
        if kind == "exit" and p.get("exit_tag_pending") == u["tag"] and not p.get("exit_oid"):
            p.update(exit_oid=oid, exit_tag_pending=None, exit_at=now())
            self._map(oid, "exit", ref)
            return True
        return False

    def _stray(self, u, k):
        """An order with the app's tag that nothing is waiting for (it showed up late, or after a restart).
        Still open: cancel it, so there's never a second exit (or an entry nobody wants). Filled: account for it."""
        kind, ref = k
        what = {"entry": "entry", "stop": "stop", "exit": "exit"}.get(kind, "order")
        if u["status"] in OPEN_STATES:
            if kind == "stop" and (p := self._pos(ref)) and p.get("stop_oid") is None and not p.get("exiting") \
                    and not p.get("stop_tag_pending"):
                # the position has no stop and this one is working: keep it as its stop rather than cancel it
                p.update(stop_oid=u["id"], stop_px=u["stop"], stop_lim=u["limit"], stop_qty=u["qty"],
                         stop_day=self._today(), stop_status=u["status"], stop_state="live")
                self._map(u["id"], "stop", ref)
                self._push()
                return
            self.event(f"{self.short(u['symbol'])}: an extra {what} order from the app showed up at Fyers - cancelling it", "warn")
            self.enqueue(("cancel_oid", u["id"]), P_EXIT)
            return
        if u["status"] != ST_FILLED and not u["filled"]:
            return
        if kind == "entry":
            o = self.L["dropped"].pop(ref, None)
            if o:
                o.update(oid=u["id"], state="open", filled=0, fill_cost=0.0)
                self.orders.append(o)
                self._map(u["id"], "entry", ref)
                self.event(f"{self.short(u['symbol'])}: an order the app had given up on filled at Fyers - "
                           f"opening the position and placing its stop", "warn")
                self._u_entry(ref, u)
            else:
                self._alert(f"CHECK FYERS: an app order on {self.short(u['symbol'])} filled that the app no longer tracks.")
            return
        p = self._pos(ref)
        if p and kind in ("stop", "exit"):
            self._map(u["id"], kind, ref)
            self._book_fill(p, u, kind)
        else:
            self._alert(f"CHECK FYERS: an extra exit on {self.short(u['symbol'])} filled after the position was closed - "
                        f"you may hold an opposite position there.")

    def _u_entry(self, lid, u):
        o = self._order(lid)
        if not o:
            self._unmap(u["id"])
            return
        o["fy_status"] = u["status"]
        if u["status"] in OPEN_STATES:
            o["state"] = "open"
        if u["filled"] > o.get("filled", 0):
            dq = u["filled"] - o.get("filled", 0)
            avg = u["traded"] or o["price"]
            cost = avg * u["filled"]
            px = (cost - o.get("fill_cost", 0.0)) / dq if o.get("filled") else avg
            px = charges.round_tick(px, self._tick(o["s"])) if o.get("filled") else avg
            o["filled"], o["fill_cost"] = u["filled"], cost
            lot = self.row(o["s"]).get("lot") or 1
            plan = {**o, "qty": dq, "lots": dq // lot, "margin": round((o.get("margin") or 0) * dq / max(1, o["qty"]), 2)}
            self.fill(plan, px, f"Fyers {o['type']}")
            pos = next((x for x in self.positions if x["s"] == o["s"] and x["product"] == o["product"]), None)
            if pos and o.get("cancel_req"):
                self.event(f"{self.short(o['s'])}: the order filled at Fyers before the cancel - the position is kept, with its stop", "warn")
            if pos and self.L.get("halted") and not pos.get("exiting"):
                self.request_exit(pos, "kill")                # filled during the kill switch: close it too
        if u["status"] in DONE_STATES:
            self.orders = [x for x in self.orders if x["id"] != lid]
            self._unmap(u["id"])
            self._symbols_changed()
            if u["status"] == ST_FILLED:
                self.changed()
            elif o.get("cancel_req") and u["status"] == ST_CANCELLED:
                self.changed(f"Cancelled at Fyers: {self.short(o['s'])} {o['type']} order")
            else:
                self.changed(f"Fyers {STATUS_NAME.get(u['status'], u['status'])} the {self.short(o['s'])} {o['type']} order"
                             + (f": {u['msg']}" if u["msg"] else ""), "warn")
        else:
            self._push()

    def _u_stop(self, pid, u):
        p = self._pos(pid)
        if not p:
            self._unmap(u["id"])
            if u["status"] in OPEN_STATES:                # a stop left over for a closed position: never leave it working
                self.enqueue(("cancel_oid", u["id"]), P_EXIT)
            return
        if u["filled"] and not self._book_fill(p, u, "stop"):
            return                                        # that closed the position
        p = self._pos(pid)
        if u["id"] != p.get("stop_oid"):                  # an older stop of this position
            if u["status"] in OPEN_STATES:
                self.event(f"{self.short(p['s'])}: an old Fyers stop is still working - cancelling it", "warn")
                self.enqueue(("cancel_oid", u["id"]), P_EXIT)
            else:
                self._unmap(u["id"])
            return
        p["stop_status"] = u["status"]
        if u["status"] in OPEN_STATES:
            p.update(stop_px=u["stop"] or p.get("stop_px"), stop_lim=u["limit"] or p.get("stop_lim"),
                     stop_qty=u["qty"] or p.get("stop_qty"), stop_state="live", stop_err=None)
            if u["filled"]:
                p["stop_partial"] = u["filled"]
            self._push()
            return
        # finished: filled (only part of the position: the rest needs a stop / an exit), cancelled, rejected, expired
        self._unmap(u["id"])
        asked = p.get("stop_cancel_req")
        p.update(stop_oid=None, stop_px=None, stop_lim=None, stop_qty=None, stop_status=None, stop_partial=None,
                 stop_cancel_req=False)
        if u["status"] == ST_FILLED:
            p["stop_state"] = "filled part"
            if p.get("exiting"):
                self.enqueue(("exit", pid), P_EXIT)
            else:
                self.changed(f"{self.short(p['s'])}: {p['qty']} still open - placing its stop again", "warn")
            return
        if u["status"] == ST_CANCELLED and asked:
            p["stop_state"] = "cancelled"
            self._push()
            return
        if u["status"] == ST_EXPIRED:
            p["stop_state"] = "expired"
            self.changed(f"{self.short(p['s'])}: the Fyers stop expired (orders last a day) - a new one goes in when it trades", "warn")
            return
        p["stop_state"] = "failed"
        p["stop_err"] = u["msg"] or STATUS_NAME.get(u["status"], "")
        n = p["stop_fail"] = p.get("stop_fail", 0) + 1
        what = "cancelled outside the app" if u["status"] == ST_CANCELLED else f"rejected ({u['msg']})"
        self.changed(f"NO STOP AT FYERS for {self.short(p['s'])}: the stop was {what} - placing it again", "warn")
        self.enqueue(("sync", pid), P_SYNC, min(60, 3 * 2 ** min(n, 4)))

    def _u_exit(self, pid, u):
        p = self._pos(pid)
        if not p:
            self._unmap(u["id"])
            if u["status"] in OPEN_STATES:
                self.enqueue(("cancel_oid", u["id"]), P_EXIT)
            return
        if u["filled"] and not self._book_fill(p, u, "exit"):
            return
        p = self._pos(pid)
        if u["id"] != p.get("exit_oid"):
            if u["status"] in OPEN_STATES:
                self.event(f"{self.short(p['s'])}: an old exit order is still working at Fyers - cancelling it", "warn")
                self.enqueue(("cancel_oid", u["id"]), P_EXIT)
            else:
                self._unmap(u["id"])
            return
        p["exit_status"] = u["status"]
        if u["status"] in OPEN_STATES:
            self._push()
            return
        self._unmap(u["id"])
        if u["status"] == ST_FILLED:                      # filled, but only part of the position: close the rest
            p.update(exit_oid=None, exit_status=None)
            self.enqueue(("exit", pid), P_EXIT)
            return
        self._exit_failed(p, f"Fyers {STATUS_NAME.get(u['status'], u['status'])} the exit" + (f": {u['msg']}" if u["msg"] else ""))

    def _u_kill(self, ref, u):
        if u["status"] in DONE_STATES:
            self._unmap(u["id"])
            if u["status"] != ST_FILLED:
                self.event(f"Kill switch: Fyers {STATUS_NAME.get(u['status'])} the exit for {self.short(u['symbol'])}: {u['msg']}", "warn")
            else:
                self.event(f"Kill switch: closed {self.short(u['symbol'])} (not an app trade) @ {u['traded']}")
            self._push()

    def _exit_failed(self, p, msg):
        n = p["exit_fail"] = p.get("exit_fail", 0) + 1
        p.update(exit_oid=None, exit_status=None)
        if n < 4:
            self.changed(f"{self.short(p['s'])}: {msg} - trying again", "warn")
            self.enqueue(("exit", p["id"]), P_EXIT, 2.0 * n)
        else:
            p.update(exiting=None, exit_fail=0)
            self.changed(f"EXIT FAILED for {self.short(p['s'])}: {msg}. The position is still open at Fyers - "
                         f"putting the stop back. Close it in Fyers if you need to.", "warn")
            self.enqueue(("sync", p["id"]), P_SYNC)

    def _book_fill(self, p, u, how) -> bool:
        """Record what a stop or exit order has filled so far that isn't recorded yet (each Fyers order's fills are
        counted once, also across restarts). Part of the position: that part is recorded and the rest stays open.
        Returns False if the position is now closed (and any other app order for it is cancelled)."""
        done_q, done_c = self.L["filled"].get(u["id"], [0, 0.0])
        if u["filled"] <= done_q:
            return True
        dq = u["filled"] - done_q
        avg = u["traded"] or u["stop"] or self.exit_mark(p)
        cost = avg * u["filled"]
        px = avg if not done_q else charges.round_tick((cost - done_c) / dq, self._tick(p["s"]))
        if p.get("exiting"):
            reason = p["exiting"]
        else:
            at_be = p["be_done"] or (p["basis"] == "self" and p.get("sl") is not None and p["side"] * (p["sl"] - p["avg"]) >= 0)
            reason = "trail sl" if p["trail"] else ("be" if at_be else "sl")
        self.event(f"{self.short(p['s'])}: Fyers filled {dq} of the {'stop' if how == 'stop' else 'exit'} at {px}")
        if dq < p["qty"]:
            part = self._split(p, dq)
            Paper.close(self, part, px, reason)
            self.L["filled"][u["id"]] = [u["filled"], cost]
            self.event(f"{self.short(p['s'])}: {p['qty']} still open", "warn")
            return True
        if dq > p["qty"]:
            self._alert(f"CHECK FYERS: on {self.short(p['s'])} Fyers filled {dq} to close {p['qty']} - you may hold an "
                        f"opposite position of {dq - p['qty']}.")
        pid = p["id"]
        Paper.close(self, p, px, reason)
        self.L["filled"][u["id"]] = [u["filled"], cost]
        for oid, (kind, ref) in list(self.L["oids"].items()):   # nothing of this position may stay working at Fyers
            if ref == pid and oid != u["id"] and kind in ("stop", "exit"):
                self.enqueue(("cancel_oid", oid), P_EXIT)
        return False

    def _split(self, p, qty):
        f = qty / p["qty"]
        self._nsplit = getattr(self, "_nsplit", 0) + 1
        part = {**p, "id": f"{p['id']}p{self._nsplit}", "qty": qty, "max_qty": qty, "paid": round(p["paid"] * f, 2),
                "charges": {k: (round(v * f, 2) if isinstance(v, (int, float)) else v) for k, v in p["charges"].items()},
                "init_risk": round(p["init_risk"] * f, 2), "margin": round(p.get("margin", 0) * f, 2),
                "path": [list(x) for x in p.get("path") or []]}    # (its own copy of the stop's path)
        for k in ("paid", "init_risk", "margin"):
            p[k] = round(p.get(k, 0) - part[k], 2)
        p["charges"] = {k: (round(v - part["charges"][k], 2) if isinstance(v, (int, float)) else v) for k, v in p["charges"].items()}
        p["qty"] -= qty
        self.positions.append(part)
        return part

    # ------------------------------------------------------------ actions (the worker runs them one at a time)
    async def _a_entry(self, lid):
        o = self._order(lid)
        if not o or o.get("oid"):
            return
        if o.get("cancel_req"):
            self.orders = [x for x in self.orders if x["id"] != lid]
            self.changed(f"Cancelled {self.short(o['s'])} before it was sent")
            return
        body = {"symbol": o["s"], "qty": o["qty"], "side": o["side"], "productType": o["product"], "orderTag": o["tag"]}
        if o["type"] == "market":
            body["type"] = T_MARKET
        elif o["type"] == "limit":
            body.update(type=T_LIMIT, limitPrice=o["price"])
        else:                                             # stop entry: stop-limit (SL-M isn't taken on options / BSE)
            body.update(type=T_STOPLIMIT, stopPrice=o["price"], limitPrice=self._limit_past(o["price"], o["side"], o["s"]))
        o["sent"] = True                                  # from here on it may be at Fyers: never sent again
        try:
            oid = await self._send_new(body)
        except BrokerRefused as e:
            self.orders = [x for x in self.orders if x["id"] != lid]
            self._symbols_changed()
            self.changed(f"Fyers refused the {self.short(o['s'])} order: {e}", "warn")
            return
        except Unconfirmed as e:
            o["state"] = "unsure"
            self.changed(f"{self.short(o['s'])}: {e} - the app keeps checking (it won't send it twice)", "warn")
            self.enqueue(("poll",), P_POLL, 5)
            return
        o = self._order(lid)
        if not o:
            return
        if oid is None:
            self._drop(o, f"Fyers has no record of the {self.short(body['symbol'])} order - not placed")
            return
        o.update(oid=oid, state="open")
        self._map(oid, "entry", lid)
        self._push()
        if o.get("cancel_req"):
            self.enqueue(("cancel", lid), P_ENTRY)
        self.enqueue(("poll",), P_POLL, 1.5)              # in case the order socket is slow or down

    def _drop(self, o, msg):
        """Give up on an entry Fyers doesn't show. A copy is kept: if it turns up later it's handled (cancelled if
        still open, the position opened with its stop if it filled)."""
        self.orders = [x for x in self.orders if x["id"] != o["id"]]
        self.L["dropped"][o["id"]] = o
        self._symbols_changed()
        self.changed(msg, "warn")

    async def _a_entry_check(self, lid):
        """After a restart: an entry that had no Fyers order id. Never sent again: looked up by its tag."""
        o = self._order(lid)
        if not o or o.get("oid"):
            return
        if not o.get("sent"):
            self.orders = [x for x in self.orders if x["id"] != lid]
            self._symbols_changed()
            self.changed(f"{self.short(o['s'])}: an order wasn't sent before the server restarted - place it again if you still want it", "warn")
            return
        try:
            oid = await self._resolve_tag(o["tag"])
        except Unconfirmed:
            o["state"] = "unsure"
            self.enqueue(("entry_check", lid), P_ENTRY, 10)
            return
        o = self._order(lid)
        if not o or o.get("oid"):
            return
        if oid is None:
            self._drop(o, f"{self.short(o['s'])}: Fyers has no record of the order sent before the restart - not placed")
            return
        o.update(oid=oid, state="open")
        self._map(oid, "entry", lid)
        await self._read(oid)
        if (o := self._order(lid)) and o.get("cancel_req"):
            self.enqueue(("cancel", lid), P_ENTRY)

    async def _a_cancel_oid(self, oid):
        """Cancel one Fyers order by its id (a stray or left-over app order)."""
        try:
            await self._x(self.broker.cancel, oid)
        except (BrokerRefused, BrokerUnsure):
            pass
        await self._read(oid)

    async def _a_entry_mod(self, lid):
        o = self._order(lid)
        if not o or not o.get("oid"):
            return
        ft = o.get("fy_type") if o.get("outside") else None
        body = {"id": o["oid"], "type": ft or (T_LIMIT if o["type"] == "limit" else T_STOPLIMIT)}
        if body["type"] == T_LIMIT:
            body["limitPrice"] = o["price"]
        elif body["type"] == T_STOP:
            body["stopPrice"] = o["price"]
        elif ft == T_STOPLIMIT and o.get("fy_limit"):
            body.update(stopPrice=o["price"], limitPrice=o["fy_limit"])
        elif body["type"] == T_MARKET:
            return
        else:
            body.update(stopPrice=o["price"], limitPrice=self._limit_past(o["price"], o["side"], o["s"]))
        try:
            await self._x(self.broker.modify, body)
            self.changed(f"Moved the {self.short(o['s'])} order at Fyers to {o['price']}")
        except (BrokerRefused, BrokerUnsure) as e:
            self.changed(f"Fyers didn't move the {self.short(o['s'])} order ({e}) - it stays where it was", "warn")
            self.enqueue(("poll",), P_POLL)

    async def _a_cancel(self, lid):
        o = self._order(lid)
        if not o or not o.get("oid"):
            return
        try:
            await self._x(self.broker.cancel, o["oid"])
        except BrokerRefused as e:
            self.event(f"Fyers didn't cancel the {self.short(o['s'])} order: {e}", "warn")
            o["cancel_req"] = False
        except BrokerUnsure:
            pass
        self.enqueue(("poll",), P_POLL, 1.0)

    async def _a_poll(self):
        """Read Fyers' order book: catches up on anything the order socket missed, and on restart."""
        try:
            rows = await self._x(self.broker.orders)
        except (BrokerUnsure, BrokerRefused) as e:
            log.info("[%s] order book: %s", self.dir, e)
            return
        self._last_poll = now()
        seen = set()
        first = not self.L.get("base")
        for r in rows:
            u = norm_order(r)
            seen.add(u["id"])
            if u["id"] in self.L["oids"] or u["tag"] in self.L["tags"]:
                self.on_update(u)
            elif first:
                # the first read of Fyers for this account: what had already filled is in Fyers' positions (adopted from
                # there); finished orders are history; an order still pending is adopted below
                self.L["xfilled"][u["id"]] = u["filled"]
                if u["status"] in DONE_STATES:
                    self.L["done"][u["id"]] = 1
            else:
                self.on_update(u)                                  # anything placed outside the app since
        if rows and not first and now() - getattr(self, "_pruned", 0) > 3600:
            # orders from earlier days never come back (Fyers' order book is per day): forget them; everything still in
            # today's book is kept, so nothing in it can ever be booked twice (an empty answer prunes nothing)
            self._pruned = now()
            for k in ("done", "xfilled"):
                self.L[k] = {oid: v for oid, v in self.L[k].items() if oid in seen}
        if first:
            self.L["base"] = now()
            for r in rows:
                u = norm_order(r)
                if u["status"] in OPEN_STATES and u["id"] not in self.L["oids"] and u["tag"] not in self.L["tags"]:
                    self._seen.pop(u["id"], None)
                    self._outside(u)
            self._hold_due = True
            self.enqueue(("fysync",), P_POLL, 0.5)
        today = self._today()
        for oid, (kind, ref) in list(self.L["oids"].items()):     # ours, but not in today's book: from an earlier day
            if oid in seen:
                continue
            if kind == "stop":
                p = self._pos(ref)
                if p and p.get("stop_oid") == oid and p.get("stop_day") != today:
                    self._unmap(oid)
                    p.update(stop_oid=None, stop_px=None, stop_lim=None, stop_qty=None, stop_status=None, stop_state="expired")
                    self.event(f"{self.short(p['s'])}: yesterday's Fyers stop has expired - a new one goes in when it trades", "warn")
                elif not p:
                    self._unmap(oid)
            elif kind == "entry":
                o = self._order(ref)
                if o and o.get("oid") == oid and ist(o["created"]).strftime("%Y-%m-%d") != today:
                    self.orders = [x for x in self.orders if x["id"] != ref]
                    self._unmap(oid)
                    self.event(f"{self.short(o['s'])} {o['type']} order expired at Fyers (orders last a day)", "warn")
                elif not o:
                    self._unmap(oid)
            elif kind in ("exit", "kill") and not self._pos(ref):
                self._unmap(oid)
            elif kind == "xorder":                                  # a Fyers order from an earlier day: expired
                o = self._order(ref)
                if o:
                    self.orders = [x for x in self.orders if x["id"] != ref]
                    self.event(f"{self.short(o['s'])}: the order placed in Fyers expired (orders last a day)")
                self._unmap(oid)
        for o in list(self.orders):                       # "unsure" entries: kept until the day is over
            if not o.get("oid") and o.get("sent") and ist(o["created"]).strftime("%Y-%m-%d") != today:
                self.orders = [x for x in self.orders if x["id"] != o["id"]]
                self.event(f"{self.short(o['s'])}: Fyers never showed the order and the day is over - not placed. "
                           f"Check Fyers' order book.", "warn")
        for lid, o in list(self.L["dropped"].items()):
            if ist(o["created"]).strftime("%Y-%m-%d") != today:
                self.L["dropped"].pop(lid, None)
        self._push()

    async def _fyers_position(self, p):
        """Fyers' net quantity for this position's contract and product (+ long, - short), or None if unreadable."""
        try:
            rows = await self._x(self.broker.positions)
            hold = await self._x(self.broker.holdings) if p["product"] == "CNC" else []
        except (BrokerUnsure, BrokerRefused):
            return None
        q = 0
        for r in rows:
            if r.get("symbol") == p["s"] and (r.get("productType") or "") == p["product"]:
                q += int(r.get("netQty") or 0)
        for r in hold:                                    # delivery shares bought earlier sit in holdings: their quantity at
            if r.get("symbol") == p["s"]:                 # the day's start (today's sells are in the position book)
                q += int(r.get("quantity") if r.get("quantity") is not None else r.get("remainingQuantity") or 0)
        return q

    async def _a_sync(self, pid):
        """Put the stop at Fyers where the engine wants it: place it, or move it (price and quantity)."""
        p = self._pos(pid)
        if not p or p.get("exiting") or p.get("stop_partial"):
            return                                       # (a part-filled stop has triggered: the server's rule closes it)
        want = self.desired_stop(p)
        if want is None:
            return
        if not (self.link and self.link.token()):
            p["stop_state"] = p.get("stop_state") if p.get("stop_oid") else "no login"
            return
        if p.get("stop_tag_pending"):
            try:
                oid = await self._resolve_tag(p["stop_tag_pending"])
            except Unconfirmed:
                self.enqueue(("sync", pid), P_SYNC, 5)
                return
            p["stop_tag_pending"] = None
            if oid:
                p.update(stop_oid=oid, stop_day=self._today(), stop_status=ST_TRANSIT)
                self._map(oid, "stop", pid)
                self.enqueue(("poll",), P_POLL)
                return
        trig, lim = want
        side, s = p["side"], p["s"]
        ltp = float(self.px(s).get("ltp") or 0)
        # Fyers refuses a sell stop at or above the last price (a buy stop at or below): the server's own rule is
        # closing it anyway, so leave the stop where it is
        if ltp and side * (ltp - trig) <= self._tick(s) * 0.5:
            return
        if not p.get("stop_oid"):
            if not self.fresh(s):
                p["stop_state"] = "waiting for the market"
                return
            fq = await self._fyers_position(p)
            p = self._pos(pid)
            if not p or p.get("exiting") or p.get("stop_oid"):
                return
            if fq is None:
                self.enqueue(("sync", pid), P_SYNC, 5)
                return
            if fq * side <= 0:
                if self._flat_twice(p):
                    self._gone_at_fyers(p)
                else:                                     # Fyers' list may lag: read it again before deciding
                    self.enqueue(("sync", pid), P_SYNC, 3)
                return
            p.pop("flat_seen", None)
            if fq * side < p["qty"]:
                if p.get("stop_state") == "mismatch":
                    return
                p["stop_state"] = "mismatch"
                self.changed(f"{self.short(s)}: Fyers shows {abs(fq)} qty but the app has {p['qty']} - no stop placed. "
                             f"Check Fyers, then press Resync on the Account page.", "warn")
                return
            tag = new_tag("S")
            body = {"symbol": s, "qty": p["qty"], "side": -side, "productType": p["product"], "type": T_STOPLIMIT,
                    "stopPrice": trig, "limitPrice": lim, "orderTag": tag}
            self.L["tags"][tag] = ["stop", pid]
            p["stop_tag_pending"] = tag                   # saved before sending: settled (looked up) before any other
            try:
                oid = await self._send_new(body)
            except BrokerRefused as e:
                p["stop_tag_pending"] = None
                n = p["stop_fail"] = p.get("stop_fail", 0) + 1
                p.update(stop_state="failed", stop_err=str(e))
                self.changed(f"NO STOP AT FYERS for {self.short(s)}: Fyers refused it ({e}) - trying again", "warn")
                self.enqueue(("sync", pid), P_SYNC, min(60, 3 * 2 ** min(n, 4)))
                return
            except Unconfirmed:
                self.enqueue(("sync", pid), P_SYNC, 5)
                return
            p = self._pos(pid)
            if not p:
                return
            if p.get("stop_oid") == oid:                   # adopted already from its own update
                p["stop_tag_pending"] = None
            if oid is None:
                p["stop_tag_pending"] = None
                self.enqueue(("sync", pid), P_SYNC, 2)
                return
            p.update(stop_tag_pending=None, stop_oid=oid, stop_px=trig, stop_lim=lim, stop_qty=p["qty"], stop_day=self._today(),
                     stop_status=ST_TRANSIT, stop_state="live", stop_err=None, stop_fail=0, stop_mod_at=now(),
                     stop_cancel_req=False, stop_type=T_STOPLIMIT, stop_adopted=False)
            self._map(oid, "stop", pid)
            self.changed(f"{self.short(s)}: stop placed at Fyers @ {trig} (limit {lim})")
            return
        if (trig, p["qty"]) == (p.get("stop_px"), p.get("stop_qty")):
            return
        wait = 1.5 - (now() - p.get("stop_mod_at", 0))     # pace the changes (Fyers counts them as orders)
        if wait > 0:
            self.enqueue(("sync", pid), P_SYNC, wait)
            return
        old = p.get("stop_px")
        p["stop_mod_at"] = now()
        st = p.get("stop_type") or T_STOPLIMIT                # a stop adopted from Fyers keeps its own type (SL-M stays SL-M)
        if st == T_STOP:
            lim = None
        try:
            await self._x(self.broker.modify, {"id": p["stop_oid"], "type": st, "stopPrice": trig,
                                                "limitPrice": lim or 0, "qty": p["qty"]})
        except (BrokerRefused, BrokerUnsure) as e:
            p = self._pos(pid)
            if not p:
                return
            n = p["stop_fail"] = p.get("stop_fail", 0) + 1
            p["stop_err"] = str(e)
            self.changed(f"{self.short(s)}: Fyers didn't move the stop to {trig} ({e}) - the stop at {old} stays in force; "
                         f"trying again", "warn")
            self.enqueue(("sync", pid), P_SYNC, min(30, 2 * 2 ** min(n, 4)))
            if isinstance(e, BrokerUnsure):
                self.enqueue(("poll",), P_POLL)
            return
        p = self._pos(pid)
        if not p:
            return
        p.update(stop_px=trig, stop_lim=lim, stop_qty=p["qty"], stop_err=None, stop_fail=0)
        self.event(f"{self.short(s)}: Fyers stop moved {old} → {trig}")
        self._push()

    def _just_filled(self, p) -> bool:
        return now() - max(e["t"] for e in p["entries"]) < FILL_LAG_SEC

    def _flat_twice(self, p) -> bool:
        """Fyers shows no position: true only on a second such read at least 3 s after the first (and not within a
        minute of a fill), so one lagging or empty answer can't make the app forget a real position."""
        if self._just_filled(p):
            return False
        first = p.get("flat_seen")
        if not first:
            p["flat_seen"] = now()
            return False
        return now() - first >= 2.9
    def _gone_at_fyers(self, p):
        """Fyers has no position for this contract any more (closed while the app was down, or by hand in Fyers)."""
        price = p.get("stop_px") or p.get("sl") or self.exit_mark(p)
        self.event(f"{self.short(p['s'])}: Fyers has no position now - it was closed outside the app. Recorded at "
                   f"{price} (an estimate: check the real price in Fyers' trade book)", "warn")
        Paper.close(self, p, price, "closed at Fyers")

    async def _a_exit(self, pid):
        """Close one position at Fyers with only ever one exit order there."""
        p = self._pos(pid)
        if not p or not p.get("exiting") or p.get("exit_oid"):
            return
        if p.get("exit_tag_pending"):
            try:
                oid = await self._resolve_tag(p["exit_tag_pending"])
            except Unconfirmed:
                self.enqueue(("exit", pid), P_EXIT, 3)
                return
            p["exit_tag_pending"] = None
            if oid:
                p.update(exit_oid=oid, exit_at=now())
                self._map(oid, "exit", pid)
                self.enqueue(("chase", pid), P_EXIT, float(self.rules.get("live_chase_sec") or 3))
                return
        if p.get("stop_tag_pending"):                       # a stop we may have placed: settle that first
            try:
                oid = await self._resolve_tag(p["stop_tag_pending"])
            except Unconfirmed:
                self.enqueue(("exit", pid), P_EXIT, 3)
                return
            p["stop_tag_pending"] = None
            if oid:
                p.update(stop_oid=oid, stop_status=ST_TRANSIT)
                self._map(oid, "stop", pid)
        sid = p.get("stop_oid")
        if sid:
            if self._ex(p["s"]) != "MCX" and not p.get("stop_partial"):
                try:
                    await self._x(self.broker.modify, {"id": sid, "type": T_MARKET, "qty": p["qty"], "limitPrice": 0, "stopPrice": 0})
                    converted = True
                except BrokerRefused as e:
                    converted = False
                    self.event(f"{self.short(p['s'])}: Fyers wouldn't turn the stop into a market order ({e}) - "
                               f"cancelling it, then sending a market exit", "warn")
                except BrokerUnsure:
                    r = await self._read(sid)
                    p = self._pos(pid)
                    if not p:
                        return
                    converted = bool(r and (r["type"] == T_MARKET or r["status"] == ST_FILLED))
                p = self._pos(pid)
                if not p:
                    return
                if converted:
                    self._map(sid, "exit", pid)
                    p.update(exit_oid=sid, exit_at=now(), exit_how="stop → market", stop_oid=None, stop_px=None,
                             stop_lim=None, stop_qty=None, stop_status=None)
                    self.changed(f"{self.short(p['s'])}: the Fyers stop is now a market exit")
                    self.enqueue(("chase", pid), P_EXIT, float(self.rules.get("live_chase_sec") or 3))
                    self.enqueue(("poll",), P_POLL, 1.0)
                    return
            # cancel the stop and wait until Fyers confirms it's gone (or filled) - only then a market exit
            p["stop_cancel_req"] = True
            try:
                await self._x(self.broker.cancel, sid)
            except (BrokerRefused, BrokerUnsure):
                pass                                        # maybe filled or already gone: the order book says
            gone = False
            for i in range(8):
                r = await self._read(sid)
                p = self._pos(pid)
                if not p:
                    return                                  # it filled: recorded by on_update
                if r and r["status"] in DONE_STATES:
                    gone = True
                    break
                await asyncio.sleep(0.5)
            if not gone:
                self.changed(f"{self.short(p['s'])}: couldn't confirm the Fyers stop was cancelled - not sending a market "
                             f"exit yet (never two exits); trying again", "warn")
                self.enqueue(("exit", pid), P_EXIT, 2)
                return
        await self._place_exit(p, limit_only=bool(p.pop("exit_limit_next", False)))

    async def _read(self, oid):
        """One order from Fyers' order book, passed through on_update; None if it couldn't be read."""
        try:
            r = await self._x(self.broker.order, oid)
        except (BrokerUnsure, BrokerRefused):
            return None
        if not r:
            return None
        u = norm_order(r)
        self.on_update(u)
        return u

    async def _place_exit(self, p, limit_only=False):
        pid = p["id"]
        # how much Fyers holds now: never send more than that (a part already closed would otherwise flip the position)
        fq = await self._fyers_position(p)
        p = self._pos(pid)
        if not p or p.get("exit_oid") or not p.get("exiting"):
            return
        qty = p["qty"]
        if fq is not None:
            held = fq * p["side"]
            if held <= 0:
                if self._flat_twice(p):
                    self._gone_at_fyers(p)
                else:
                    self.enqueue(("exit", pid), P_EXIT, 3)
                return
            p.pop("flat_seen", None)
            if held < qty:
                self.event(f"{self.short(p['s'])}: Fyers holds {held}, the app {qty} - closing the {held} Fyers holds", "warn")
                qty = held
        tag = new_tag("X")
        body = {"symbol": p["s"], "qty": qty, "side": -p["side"], "productType": p["product"], "orderTag": tag}
        if limit_only:
            px = self._marketable(p)
            if px is None:
                self._exit_failed(p, "no live price to price the exit")
                return
            body.update(type=T_LIMIT, limitPrice=px)
        else:
            body["type"] = T_MARKET
        self.L["tags"][tag] = ["exit", pid]
        p["exit_tag_pending"] = tag                       # saved before sending: settled (looked up) before any other
        try:
            oid = await self._send_new(body)
        except BrokerRefused as e:
            p = self._pos(pid)
            if p:
                p["exit_tag_pending"] = None
            if p and not limit_only and self._marketable(p) is not None:
                self.event(f"{self.short(p['s'])}: Fyers refused a market exit ({e}) - sending a limit that crosses the spread", "warn")
                await self._place_exit(p, limit_only=True)
            elif p:
                self._exit_failed(p, f"Fyers refused the exit: {e}")
            return
        except Unconfirmed:
            if self._pos(pid):
                self.enqueue(("exit", pid), P_EXIT, 3)
            return
        p = self._pos(pid)
        if not p:
            return
        if oid is None:
            p["exit_tag_pending"] = None
            self._exit_failed(p, "Fyers has no record of the exit order")
            return
        if oid in self.L["filled"] and self.L["filled"][oid][0] >= qty:
            return
        p.update(exit_tag_pending=None, exit_oid=oid, exit_at=now(), exit_how="limit" if limit_only else "market", chase_n=0,
                 stop_oid=None, stop_px=None, stop_lim=None, stop_qty=None, stop_status=None)
        self._map(oid, "exit", pid, tag)
        self.changed(f"{self.short(p['s'])}: {'limit' if limit_only else 'market'} exit sent to Fyers")
        self.enqueue(("chase", pid), P_EXIT, float(self.rules.get("live_chase_sec") or 3))
        self.enqueue(("poll",), P_POLL, 1.0)

    async def _a_chase(self, pid):
        """An exit still open: re-price a limit to cross the spread; a market order stuck (price protection) is
        cancelled and replaced by such a limit."""
        p = self._pos(pid)
        if not p or not p.get("exit_oid"):
            return
        r = await self._read(p["exit_oid"])
        p = self._pos(pid)
        if not p or not p.get("exit_oid"):
            return
        sec = float(self.rules.get("live_chase_sec") or 3)
        if r is not None and r["status"] in DONE_STATES:
            self._u_exit(pid, r)                          # its update may have been lost: handle it now
            return
        if r is None:
            self.enqueue(("chase", pid), P_EXIT, sec)
            return
        n = p["chase_n"] = p.get("chase_n", 0) + 1
        if n == 3:
            self.event(f"{self.short(p['s'])}: the exit hasn't filled after {n * sec:g}s - re-pricing it", "warn")
        if r["type"] == T_LIMIT:
            px = self._marketable(p)
            if px is not None and px != r["limit"]:
                try:
                    await self._x(self.broker.modify, {"id": r["id"], "type": T_LIMIT, "limitPrice": px, "qty": r["qty"]})
                except (BrokerRefused, BrokerUnsure) as e:
                    self.event(f"{self.short(p['s'])}: couldn't re-price the exit ({e})", "warn")
        elif r["type"] == T_MARKET and n >= 3 and not r["filled"]:
            # a market order held back by price protection: cancel, confirm, then a crossing limit
            oid = r["id"]
            p["exit_limit_next"] = True
            try:
                await self._x(self.broker.cancel, oid)
            except (BrokerRefused, BrokerUnsure):
                pass
            for i in range(8):
                rr = await self._read(oid)
                p = self._pos(pid)
                if not p:
                    return
                if rr and rr["status"] in DONE_STATES:
                    break
                await asyncio.sleep(0.5)
            else:
                self.enqueue(("chase", pid), P_EXIT, sec)
                return
            p = self._pos(pid)
            if p and not p.get("exit_oid"):                # _u_exit cleared it (cancelled) and queued a retry
                p["exit_fail"] = max(0, p.get("exit_fail", 1) - 1)
            return
        if n == 40:
            self.event(f"{self.short(p['s'])}: the exit is still open at Fyers after {n * sec:g}s - check Fyers", "warn")
        self.enqueue(("chase", pid), P_EXIT, sec if n < 40 else 10)

    # ------------------------------------------------------------ kill switch, resync
    def kill(self):
        self.L["halted"] = now()
        self._kill_skip = {(p["s"], p["product"]) for p in self.positions} | {(o["s"], o["product"]) for o in self.orders}
        for o in list(self.orders):
            self.cancel(o["id"], quiet=True)
        kept = 0
        for p in list(self.positions):
            if p.get("holding"):                          # delivery shares from earlier days: not sold by the kill switch
                kept += 1
                continue
            p.pop("exiting", None)
            self.request_exit(p, "kill")
        self.changed("KILL SWITCH: cancelling every order and closing every position at Fyers"
                     + (f" (your {kept} delivery holding(s) are kept, with their stops)" if kept else ""), "warn")
        self.enqueue(("kill2",), P_EXIT, 4.0)

    async def _a_kill2(self):
        """After the app's own exits: cancel anything else pending at Fyers and close any other position there."""
        try:
            rows = [norm_order(r) for r in await self._x(self.broker.orders)]
        except (BrokerUnsure, BrokerRefused) as e:
            self.event(f"Kill switch: couldn't read Fyers' order book ({e}) - check Fyers", "warn")
            rows = []
        mine = set(self.L["oids"]) | {p.get("exit_oid") for p in self.positions} | {p.get("stop_oid") for p in self.positions}
        mine |= {o.get("oid") for o in self.orders}
        n_c = 0
        for u in rows:
            if u["status"] in OPEN_STATES and u["id"] not in mine and u["tag"] not in self.L["tags"]:
                try:
                    await self._x(self.broker.cancel, u["id"])
                    n_c += 1
                except (BrokerRefused, BrokerUnsure) as e:
                    self.event(f"Kill switch: couldn't cancel {self.short(u['symbol'])} order {u['id']}: {e}", "warn")
        # positions read twice, 1.5 s apart: only one that both reads agree on is closed (the positions list can lag)
        reads = []
        for i in range(2):
            await asyncio.sleep(1.5)
            try:
                reads.append({(r.get("symbol"), r.get("productType") or ""): int(r.get("netQty") or 0)
                              for r in await self._x(self.broker.positions)})
            except (BrokerUnsure, BrokerRefused) as e:
                self.event(f"Kill switch: couldn't read Fyers' positions ({e}) - check Fyers", "warn")
                reads = []
                break
        skip = getattr(self, "_kill_skip", set()) | {(p["s"], p["product"]) for p in self.positions} | \
            {(o["s"], o["product"]) for o in self.orders}
        n_x = 0
        for key, q in (reads[0].items() if len(reads) == 2 else []):
            if not q or key in skip or reads[1].get(key) != q:
                continue
            tag = new_tag("K")
            self.L["tags"][tag] = ["kill", key[0]]
            self._kill_sent = {**getattr(self, "_kill_sent", {}), key[0]: now()}
            try:
                oid = await self._send_new({"symbol": key[0], "qty": abs(q), "side": -1 if q > 0 else 1, "productType": key[1],
                                            "type": T_MARKET, "orderTag": tag})
                if oid:
                    self._map(oid, "kill", key[0])
                    n_x += 1
            except (BrokerRefused, Unconfirmed) as e:
                self.event(f"Kill switch: couldn't close {self.short(key[0])} at Fyers: {e}", "warn")
        self.changed(f"Kill switch: {n_c} other order(s) cancelled, {n_x} other position(s) sent to close at Fyers."
                     + (" New orders are paused until you press Resume." if self.L.get("halted") else ""), "warn")

    def resume(self):
        self.L["halted"] = None
        self.changed("Live trading resumed")

    def resync(self):
        """Read Fyers again and put every stop where it should be."""
        self.L["alerts"] = []                             # you've looked at Fyers: clear the "check Fyers" alerts
        for p in self.positions:
            if p.get("stop_state") == "mismatch":
                p["stop_state"] = None
            self.enqueue(("sync", p["id"]), P_SYNC, 1.0)
        self.enqueue(("poll",), P_POLL)
        self.changed("Re-reading Fyers")

    # ------------------------------------------------------------ for the page
    def _other_client(self):
        """Fyers is logged in as another client than this Live account's: nothing new is placed."""
        try:
            fy = ((getattr(self.link, "_profile", None) or {}).get("data") or {}).get("fy_id")
        except Exception:
            fy = None
        if fy and self.client_id and str(fy).upper() != str(self.client_id).upper():
            return f"Fyers is logged in as {fy}, but this Live account is {self.client_id} - log in to Fyers as {self.client_id}"
        return None

    def live_problems(self) -> list:
        """What the owner should know about this account now: (key, text, symbol or None). The page shows the texts
        (live_status); Telegram alerts (alerts.py) use the keys to send each one once, and "sorted" when it clears."""
        logged = bool(self.link and self.link.token())
        stream = bool(self.stream and self.stream.up)
        w = []
        if not logged:
            w.append(("login", "No Fyers login today: new orders are blocked; stops already at Fyers stay in force, but trailing "
                      "can't move them and targets / square-off can't close. Log in to Fyers.", None))
        elif (other := self._other_client()):
            w.append(("client", other + ".", None))
        elif not stream and (self.positions or self.orders):
            w.append(("stream", "Order updates from Fyers aren't connected: the app checks the order book every 5 s instead.", None))
        for p in self.positions:
            st = p.get("stop_state")
            if not p.get("stop_oid") and not p.get("exiting") and self.desired_stop(p):
                why = {"failed": f"Fyers refused it ({p.get('stop_err')})", "waiting for the market": "waiting for the market to open",
                       "expired": "yesterday's stop expired; a new one goes in when it trades", "no login": "log in to Fyers",
                       "mismatch": "Fyers' quantity differs - check Fyers, then Resync"}.get(st, "placing it")
                w.append((f"nostop:{p['id']}:{st or ''}", f"{self.short(p['s'])}: no stop at Fyers yet - {why}.", p["s"]))
            elif p.get("stop_err") and p.get("stop_oid"):
                w.append((f"refused:{p['id']}", f"{self.short(p['s'])}: the last stop change was refused ({p['stop_err']}); the stop at {p.get('stop_px')} is in force.", p["s"]))
            elif not p.get("exiting") and self.desired_stop(p) is None and not p.get("holding"):
                w.append((f"nosl:{p['id']}", f"{self.short(p['s'])}: NO STOP - placed in Fyers without one. Tap \"Place my stop\" "
                          f"on the trade to put your default stop at Fyers.", p["s"]))
        nh = sum(1 for p in self.positions if p.get("holding") and not p.get("exiting") and self.desired_stop(p) is None)
        if nh:
            w.append(("nosl_hold", f"{nh} delivery holding(s) have no stop at Fyers (each can get one with \"Place my stop\").", None))
        if self.L.get("halted"):
            w.append(("halted", "Kill switch used: new orders are paused until you press Resume (Account page).", None))
        w += [(f"alert:{a}", a, None) for a in (self.L.get("alerts") or [])]
        return w

    def live_status(self) -> dict:
        logged = bool(self.link and self.link.token())
        stream = bool(self.stream and self.stream.up)
        w = [t for _, t, _ in self.live_problems()]
        return {"on": True, "logged_in": logged, "stream": stream, "halted": bool(self.L.get("halted")), "warnings": w,
                "last_poll": self._last_poll or None, "client_id": self.client_id, "since": self.acct.get("since"),
                "read_at": self.L.get("base")}

    def pos_view(self, pos) -> dict:
        v = super().pos_view(pos)
        v["fy"] = {k: pos.get(k) for k in ("stop_oid", "stop_px", "stop_lim", "stop_qty", "stop_state", "stop_err", "exiting",
                                           "exit_oid", "exit_how", "exit_status", "stop_type", "stop_adopted")}
        d = self.desired_stop(pos)
        v["fy"]["want_px"] = d[0] if d else None
        v["outside"] = bool(pos.get("outside"))
        v["holding"] = bool(pos.get("holding"))
        v["nostop"] = d is None and not pos.get("exiting")
        return v

    def order_view(self, o) -> dict:
        v = super().order_view(o)
        v["fy"] = {"oid": o.get("oid"), "state": o.get("state"), "cancel_req": o.get("cancel_req"), "filled": o.get("filled"),
                   "type": o.get("fy_type")}
        v["outside"] = bool(o.get("outside"))
        return v

    def snapshot(self) -> dict:
        s = super().snapshot()
        s["live"] = self.live_status()
        s["fyfunds"] = self.funds_view()
        s["acct"]["size"] = self.acct.get("size")
        s["acct"]["kind"] = "live"
        s["acct"]["transfer_today"] = self._transfer_today()
        return s
