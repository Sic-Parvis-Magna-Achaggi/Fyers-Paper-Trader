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
  new orders are refused until Resume.

All engine state changes happen on the event loop (like the paper engine). Fyers calls run in worker threads, one
action at a time per account (exits first)."""
from __future__ import annotations

import asyncio
import logging
import time

from . import charges
from .broker import (DONE_STATES, OPEN_STATES, ST_CANCELLED, ST_EXPIRED, ST_FILLED, ST_PENDING, ST_REJECTED, ST_TRANSIT,
                     STATUS_NAME, T_LIMIT, T_MARKET, T_STOPLIMIT, BrokerRefused, BrokerUnsure, FyersBroker, new_tag,
                     norm_order)
from .paper import Paper, Refused, ist, now

log = logging.getLogger("live")

P_EXIT, P_ENTRY, P_SYNC, P_POLL = 0, 1, 2, 3


class Unconfirmed(Exception):
    """Fyers' order book couldn't be read, so whether an order went through is still unknown."""


class LiveEngine(Paper):
    mode = "live"

    def __init__(self, folder: str = "", link=None, name: str = "", broker=None):
        self.broker = broker or FyersBroker(link)
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
                  "done": L.get("done") or {}}          # Fyers ids of finished orders already handled (not replayed)

    def _save_extra(self):
        for k, n in (("tags", 400), ("filled", 300), ("dropped", 50), ("done", 600)):
            if len(self.L[k]) > n:                        # recent ones are enough
                self.L[k] = dict(list(self.L[k].items())[-n:])
        return {"live": self.L}

    def _alert(self, msg):
        """Something only the owner can sort out in Fyers: a red warning that stays until Resync."""
        self.L["alerts"] = (self.L["alerts"] + [msg])[-10:]
        self.event(msg, "warn")

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
        if not out.get("blocked"):
            why = None
            if not (self.link and self.link.token()):
                why = "log in to Fyers first (the daily login)"
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
        super().modify_order(oid, price, sl, tp)
        o = self._order(oid)
        if o and o["price"] != old and o.get("oid"):
            self.enqueue(("entry_mod", oid), P_ENTRY)

    def close_all(self):
        for p in list(self.positions):
            if self.fresh(p["s"]):
                self.request_exit(p, "manual")
        for o in list(self.orders):
            self.cancel(o["id"], quiet=True)
        self.changed("Closing everything at Fyers")

    def reset(self, capital: float):
        raise Refused("a Live account can't be reset - its trades are real (switch it to Paper first)")

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
        gap = 5 if (busy and not stream_up) else (15 if busy else 60)
        if (self.positions or self.orders) and t - self._last_poll > gap:
            self.enqueue(("poll",), P_POLL)

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
                return
            kind, ref = k
            getattr(self, "_u_" + kind)(ref, u)
            self._seen[oid] = sig
            if u["status"] in DONE_STATES:
                self.L["done"][oid] = 1
        except Exception as e:
            log.exception("[%s] order update %s: %s", self.dir, oid, e)

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
        body = {"id": o["oid"], "type": T_LIMIT if o["type"] == "limit" else T_STOPLIMIT}
        if o["type"] == "limit":
            body["limitPrice"] = o["price"]
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
        for r in rows:
            u = norm_order(r)
            seen.add(u["id"])
            if u["id"] in self.L["oids"] or u["tag"] in self.L["tags"]:
                self.on_update(u)
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
        for r in hold:                                    # delivery shares bought earlier sit in holdings
            if r.get("symbol") == p["s"]:
                q += int(r.get("remainingQuantity") if r.get("remainingQuantity") is not None else r.get("quantity") or 0)
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
                     stop_cancel_req=False)
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
        try:
            await self._x(self.broker.modify, {"id": p["stop_oid"], "type": T_STOPLIMIT, "stopPrice": trig,
                                                "limitPrice": lim, "qty": p["qty"]})
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
        return now() - max(e["t"] for e in p["entries"]) < 60

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
        for p in list(self.positions):
            p.pop("exiting", None)
            self.request_exit(p, "kill")
        self.changed("KILL SWITCH: cancelling every order and closing every position at Fyers", "warn")
        self.enqueue(("kill2",), P_EXIT, 4.0)

    async def _a_kill2(self):
        """After the app's own exits: cancel anything else pending at Fyers and close any other position there."""
        try:
            rows = [norm_order(r) for r in await self._x(self.broker.orders)]
        except (BrokerUnsure, BrokerRefused) as e:
            self.event(f"Kill switch: couldn't read Fyers' order book ({e}) - check Fyers", "warn")
            rows = []
        mine = set(self.L["oids"]) | {p.get("exit_oid") for p in self.positions} | {p.get("stop_oid") for p in self.positions}
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
    def live_problems(self) -> list:
        """What the owner should know about this account now: (key, text, symbol or None). The page shows the texts
        (live_status); Telegram alerts (alerts.py) use the keys to send each one once, and "sorted" when it clears."""
        logged = bool(self.link and self.link.token())
        stream = bool(self.stream and self.stream.up)
        w = []
        if not logged:
            w.append(("login", "No Fyers login today: new orders are blocked; stops already at Fyers stay in force, but trailing "
                      "can't move them and targets / square-off can't close. Log in to Fyers.", None))
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
        if self.L.get("halted"):
            w.append(("halted", "Kill switch used: new orders are paused until you press Resume (Account page).", None))
        w += [(f"alert:{a}", a, None) for a in (self.L.get("alerts") or [])]
        return w

    def live_status(self) -> dict:
        logged = bool(self.link and self.link.token())
        stream = bool(self.stream and self.stream.up)
        w = [t for _, t, _ in self.live_problems()]
        return {"on": True, "logged_in": logged, "stream": stream, "halted": bool(self.L.get("halted")), "warnings": w,
                "last_poll": self._last_poll or None}

    def pos_view(self, pos) -> dict:
        v = super().pos_view(pos)
        v["fy"] = {k: pos.get(k) for k in ("stop_oid", "stop_px", "stop_lim", "stop_qty", "stop_state", "stop_err", "exiting",
                                           "exit_oid", "exit_how", "exit_status")}
        d = self.desired_stop(pos)
        v["fy"]["want_px"] = d[0] if d else None
        return v

    def order_view(self, o) -> dict:
        v = super().order_view(o)
        v["fy"] = {"oid": o.get("oid"), "state": o.get("state"), "cancel_req": o.get("cancel_req"), "filled": o.get("filled")}
        return v

    def snapshot(self) -> dict:
        s = super().snapshot()
        s["live"] = self.live_status()
        return s
