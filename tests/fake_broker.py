"""A fake Fyers order API for testing Live accounts (never talks to Fyers).

It follows the Fyers rules the live design depends on:
- stops trigger on the LAST traded price; a triggered stop-limit fills only within its limit;
- MCX doesn't allow changing an order's type (cancel and place a new one instead); NSE / BSE allow SL-L -> market;
- SL-M (type 3) is refused on options and on BSE;
- a sell stop at or above the last price (a buy stop at or below it) is refused;
- only pending orders can be modified or cancelled.

It also checks the design's promise: never two exit orders open at once for one position (an exit order is any open
order on the opposite side of the net position). Any moment that happens is recorded in `violations`.

Switches for tests: refuse_next (place), fail_modify (modify), unsure_next (place goes through but the answer is lost),
down (every call times out), refuse_market (market orders refused, like MCX options), mpp_hold (market orders sit
pending, like Fyers' price protection holding them back)."""
import itertools
import threading
import time

from helper.broker import BrokerRefused, BrokerUnsure

OPEN = (4, 6)


class FakeBroker:
    def __init__(self):
        self.book = {}                  # id -> Fyers-style row
        self.net = {}                     # (symbol, product) -> net qty
        self.px = {}                      # symbol -> (ltp, bid, ask)
        self.ids = itertools.count(26110100000001)
        self.lock = threading.RLock()
        self.emit = None                  # callback(row) - the order-update socket
        self.calls = []                   # (time, method, order id)
        self.violations = []
        self.refuse_next = None
        self.fail_modify = None
        self.unsure_next = False
        self.down = False
        self.refuse_market = False
        self.mpp_hold = False
        self.socket = True                # False: updates are not pushed (the app must read the order book)

    # ------------------------------------------------------------ helpers
    def _emit(self, o):
        if self.emit and self.socket:
            self.emit(dict(o))

    def _check(self, sym, prod):
        q = self.net.get((sym, prod), 0)
        if q == 0:
            return
        exits = [o for o in self.book.values() if o["symbol"] == sym and o["productType"] == prod and o["status"] in OPEN
                 and o["side"] == (-1 if q > 0 else 1)]
        if len(exits) > 1:
            self.violations.append((time.time(), sym, [o["id"] for o in exits]))

    def _fill(self, o, price):
        """Fill what's left of the order (tradedPrice = the average of all its fills, as Fyers reports it)."""
        left = o["qty"] - o["filledQty"]
        avg = (o["tradedPrice"] * o["filledQty"] + price * left) / o["qty"] if o["filledQty"] else price
        o.update(status=2, filledQty=o["qty"], remainingQuantity=0, tradedPrice=round(avg, 4))
        k = (o["symbol"], o["productType"])
        self.net[k] = self.net.get(k, 0) + o["side"] * left
        self._emit(o)

    def _try(self, o):
        """Fill an open order if the market allows it now."""
        p = self.px.get(o["symbol"])
        if not p or o["status"] not in OPEN:
            return
        ltp, bid, ask = p
        side = o["side"]
        if o["type"] == 2:
            if self.mpp_hold:
                return
            self._fill(o, ask if side > 0 else bid)
        elif o["type"] == 1:
            if side > 0 and ask <= o["limitPrice"]:
                self._fill(o, ask)
            elif side < 0 and bid >= o["limitPrice"]:
                self._fill(o, bid)
        elif o["type"] in (3, 4):
            if not o.get("triggered") and side * (ltp - o["stopPrice"]) >= 0:
                o["triggered"] = True
            if o.get("triggered"):
                if o["type"] == 3:
                    self._fill(o, ask if side > 0 else bid)
                elif side > 0 and ask <= o["limitPrice"]:
                    self._fill(o, ask)
                elif side < 0 and bid >= o["limitPrice"]:
                    self._fill(o, bid)

    def _gate(self, what, oid=""):
        self.calls.append((time.time(), what, oid))
        if self.down:
            raise BrokerUnsure("Fyers didn't answer in time (fake)")

    # ------------------------------------------------------------ market
    def set_price(self, sym, ltp, bid=None, ask=None):
        with self.lock:
            self.px[sym] = (ltp, bid if bid is not None else ltp, ask if ask is not None else ltp)
            for o in list(self.book.values()):
                if o["symbol"] == sym:
                    self._try(o)

    def new_day(self, close_positions=()):
        """Overnight: today's orders expire and the order book starts empty (Fyers' order book is per day)."""
        with self.lock:
            for o in self.book.values():
                if o["status"] in OPEN:
                    o["status"] = 7
            self.book = {}
            for k in close_positions:
                self.net[k] = 0

    # ------------------------------------------------------------ the FyersBroker interface
    def place(self, body):
        with self.lock:
            self._gate("place")
            if self.refuse_next:
                msg, self.refuse_next = self.refuse_next, None
                raise BrokerRefused(msg)
            sym, typ, side = body["symbol"], int(body["type"]), int(body["side"])
            opt = sym.endswith(("CE", "PE"))
            if typ == 3 and (opt or sym.startswith("BSE:")):
                raise BrokerRefused("SL-M orders are not allowed for this instrument")
            if typ == 2 and self.refuse_market:
                raise BrokerRefused("Market orders are not allowed for this contract")
            ltp = (self.px.get(sym) or (0, 0, 0))[0]
            if typ in (3, 4) and ltp and side * (body["stopPrice"] - ltp) <= 0:
                raise BrokerRefused("Trigger price should be " + ("above" if side > 0 else "below") + " LTP")
            if typ == 4 and side * (body["limitPrice"] - body["stopPrice"]) < 0:
                raise BrokerRefused("limit price on the wrong side of the trigger")
            oid = str(next(self.ids))
            o = {"id": oid, "symbol": sym, "qty": int(body["qty"]), "side": side, "type": typ, "productType": body["productType"],
                 "limitPrice": float(body.get("limitPrice") or 0), "stopPrice": float(body.get("stopPrice") or 0),
                 "status": 6, "filledQty": 0, "remainingQuantity": int(body["qty"]), "tradedPrice": 0, "message": "",
                 "orderTag": body.get("orderTag", ""), "orderDateTime": time.strftime("%d-%b-%Y %H:%M:%S")}
            self.book[oid] = o
            self._emit(o)
            self._try(o)
            self._check(sym, o["productType"])
            if self.unsure_next:
                self.unsure_next = False
                raise BrokerUnsure("request made but not acknowledged (fake code 201)")
            return oid

    def modify(self, body):
        with self.lock:
            self._gate("modify", body.get("id"))
            o = self.book.get(str(body["id"]))
            if not o or o["status"] not in OPEN:
                raise BrokerRefused("only pending orders can be modified")
            if self.fail_modify:
                msg, self.fail_modify = self.fail_modify, None
                raise BrokerRefused(msg)
            typ = int(body.get("type", o["type"]))
            if typ != o["type"] and o["symbol"].startswith("MCX:"):
                raise BrokerRefused("Order type modification is not allowed for MCX")
            if typ == 3 and (o["symbol"].endswith(("CE", "PE")) or o["symbol"].startswith("BSE:")):
                raise BrokerRefused("SL-M orders are not allowed for this instrument")
            ltp = (self.px.get(o["symbol"]) or (0, 0, 0))[0]
            if typ in (3, 4) and not o.get("triggered") and ltp and o["side"] * (float(body["stopPrice"]) - ltp) <= 0:
                raise BrokerRefused("Trigger price should be " + ("above" if o["side"] > 0 else "below") + " LTP")
            if typ == 2 and self.refuse_market:
                raise BrokerRefused("Market orders are not allowed for this contract")
            o["type"] = typ
            if "qty" in body:
                o["qty"] = int(body["qty"])
                o["remainingQuantity"] = o["qty"] - o["filledQty"]
            for k in ("limitPrice", "stopPrice"):
                if k in body:
                    o[k] = float(body[k] or 0)
            if typ in (1, 2):
                o.pop("triggered", None)
            self._emit(o)
            self._try(o)
            self._check(o["symbol"], o["productType"])

    def cancel(self, oid):
        with self.lock:
            self._gate("cancel", oid)
            o = self.book.get(str(oid))
            if not o or o["status"] not in OPEN:
                raise BrokerRefused("order is not pending")
            o["status"] = 1
            self._emit(o)

    def orders(self):
        with self.lock:
            self._gate("orders")
            return [dict(o) for o in self.book.values()]

    def order(self, oid):
        with self.lock:
            self._gate("order", oid)
            o = self.book.get(str(oid))
            return dict(o) if o else None

    def find_tag(self, tag):
        with self.lock:
            self._gate("find_tag")
            return next((dict(o) for o in self.book.values() if o.get("orderTag") == tag), None)

    def positions(self):
        with self.lock:
            self._gate("positions")
            return [{"symbol": s, "productType": p, "netQty": q} for (s, p), q in self.net.items() if q]

    def holdings(self):
        with self.lock:
            self._gate("holdings")
            return []

    def funds(self):
        return {"available": 100000.0, "total": 100000.0, "used": 0.0}

    # ------------------------------------------------------------ for tests
    def open_orders(self, sym=None):
        return [o for o in self.book.values() if o["status"] in OPEN and (sym is None or o["symbol"] == sym)]

    def max_rate(self, window=60.0):
        ts = sorted(t for t, w, _ in self.calls if w in ("place", "modify", "cancel"))
        best = 0
        j = 0
        for i, t in enumerate(ts):
            while ts[j] < t - window:
                j += 1
            best = max(best, i - j + 1)
        return best
