"""The broker layer for Live accounts: Fyers order calls (place, modify, cancel, order book, positions, funds) and
the order-update socket. Only the live engine (helper/live.py) uses it; paper accounts never reach Fyers' order API.

Every order the app sends carries an order tag ("FTM" + kind + random), so when Fyers' answer is unclear (a time-out,
a server error, or code 201 "request made but not acknowledged") the app looks the tag up in the order book before
doing anything else. It never sends a second order just because it didn't hear back about the first.

Limits (Standard plan): orders and modifications 10/s and 200/min per app; the helper queues at 4/s, 120/min
(FyersLink.order_budget, shared with margin look-ups). The order-update socket doesn't count against them."""
from __future__ import annotations

import json
import logging
import os
import secrets
import threading
import time

import httpx

from .fyers_link import API

log = logging.getLogger("broker")

# order book / socket codes
ST_CANCELLED, ST_FILLED, ST_TRANSIT, ST_REJECTED, ST_PENDING, ST_EXPIRED = 1, 2, 4, 5, 6, 7
OPEN_STATES = (ST_TRANSIT, ST_PENDING)
DONE_STATES = (ST_CANCELLED, ST_FILLED, ST_REJECTED, ST_EXPIRED)
T_LIMIT, T_MARKET, T_STOP, T_STOPLIMIT = 1, 2, 3, 4
STATUS_NAME = {1: "cancelled", 2: "filled", 4: "in transit", 5: "rejected", 6: "pending", 7: "expired"}


class BrokerRefused(Exception):
    """Fyers answered and said no (the message says why). Nothing was placed or changed."""


class BrokerUnsure(Exception):
    """No clear answer (time-out, server error, 'not acknowledged'): the request may or may not have gone through."""


def new_tag(kind: str) -> str:
    """Fyers order tags: letters and digits only, 1-30 characters."""
    return "FTM" + kind + secrets.token_hex(5).upper()


class FyersBroker:
    def __init__(self, link):
        self.link = link                  # the user's FyersLink (token, app id, request budgets)

    # ------------------------------------------------------------ plumbing
    def _call(self, method: str, path: str, body: dict | None = None, params: dict | None = None, wait: float = 30.0) -> dict:
        try:
            self.link.order_budget.take(max_wait=wait)
        except RuntimeError as e:                    # nothing was sent: the helper's own queue is full
            raise BrokerRefused(f"busy ({e})")
        try:
            r = httpx.request(method, API + path, json=body, params=params, headers=self.link._auth_header(), timeout=15)
        except httpx.TimeoutException as e:
            raise BrokerUnsure(f"Fyers didn't answer in time ({e.__class__.__name__})")
        except httpx.HTTPError as e:
            raise BrokerUnsure(f"couldn't reach Fyers ({e.__class__.__name__})")
        try:
            j = r.json()
        except Exception:
            raise BrokerUnsure(f"Fyers answered HTTP {r.status_code} without a message")
        if r.status_code == 401 or j.get("code") in (-15, -16, -17, -8):
            self.link.drop_token(j.get("message", "token rejected"))
            raise PermissionError("Fyers session expired - log in to Fyers again")
        if r.status_code == 429:
            raise BrokerUnsure("Fyers says too many requests - waiting")
        if r.status_code >= 500 or j.get("code") == 201:
            raise BrokerUnsure(j.get("message") or f"Fyers HTTP {r.status_code}")
        if j.get("s") != "ok":
            raise BrokerRefused(j.get("message") or str(j))
        return j

    # ------------------------------------------------------------ orders
    def place(self, body: dict) -> str:
        """Place one order; returns Fyers' order id. body: symbol, qty, side, type, productType, limitPrice, stopPrice,
        orderTag (always set by the caller)."""
        b = {"validity": "DAY", "disclosedQty": 0, "offlineOrder": False, "limitPrice": 0, "stopPrice": 0, **body}
        j = self._call("POST", "/orders/sync", b)
        oid = j.get("id") or (j.get("data") or {}).get("id")
        if not oid:
            raise BrokerUnsure(f"Fyers accepted the order but sent no order id ({j.get('message')})")
        return str(oid)

    def modify(self, body: dict) -> None:
        """body: id, type, and the fields to change (stopPrice, limitPrice, qty). Only pending orders can be changed."""
        self._call("PATCH", "/orders/sync", body)

    def cancel(self, oid: str) -> None:
        self._call("DELETE", "/orders/sync", {"id": oid})

    def orders(self) -> list:
        """Today's order book."""
        return self._call("GET", "/orders", wait=20).get("orderBook") or []

    def order(self, oid: str) -> dict | None:
        try:
            rows = self._call("GET", "/orders", params={"id": oid}, wait=20).get("orderBook") or []
        except BrokerRefused:
            return None
        return next((o for o in rows if str(o.get("id")) == str(oid)), None)

    def find_tag(self, tag: str) -> dict | None:
        return next((o for o in self.orders() if o.get("orderTag") == tag), None)

    def positions(self) -> list:
        """Net positions (today's and carried): symbol, productType, netQty (+ long / - short), netAvg..."""
        return self._call("GET", "/positions", wait=20).get("netPositions") or []

    def holdings(self) -> list:
        """Delivery shares held (CNC bought on earlier days): symbol, quantity, remainingQuantity..."""
        return self._call("GET", "/holdings", wait=20).get("holdings") or []

    def funds(self) -> dict:
        """Fyers' funds, both ledgers: {"eq": {...}, "co": {...}} with keys from FUND_KEYS (total, used, clear, realized,
        collateral, transfer, receivables, adhoc, start, available). Rows are matched by title, as Fyers' docs advise."""
        return parse_funds(self._call("GET", "/funds", wait=20).get("fund_limit") or [])


FUND_KEYS = {"total balance": "total", "utilized amount": "used", "clear balance": "clear",
             "realized profit and loss": "realized", "collaterals": "collateral", "fund transfer": "transfer",
             "receivables": "receivables", "adhoc limit": "adhoc", "limit at start of the day": "start",
             "available balance": "available"}


def parse_funds(rows: list) -> dict:
    out = {"eq": {}, "co": {}}
    for r in rows or []:
        k = FUND_KEYS.get((r.get("title") or "").strip().lower())
        if not k:
            continue
        for led, f in (("eq", "equityAmount"), ("co", "commodityAmount")):
            try:
                out[led][k] = round(float(r.get(f) or 0), 2)
            except (TypeError, ValueError):
                out[led][k] = 0.0
    if not out["eq"] and not out["co"]:
        raise BrokerUnsure("Fyers sent no funds figures")
    return out


def norm_order(o: dict) -> dict:
    """An order-book row or a socket message, with the fields the engine uses (numbers as numbers)."""
    g = lambda k, d=0: o.get(k) if o.get(k) is not None else d
    return {"id": str(g("id", "")), "status": int(g("status")), "type": int(g("type")), "side": int(g("side")),
            "symbol": g("symbol", ""), "product": g("productType", ""), "qty": int(g("qty")),
            "filled": int(g("filledQty")), "traded": float(g("tradedPrice") or 0), "limit": float(g("limitPrice") or 0),
            "stop": float(g("stopPrice") or 0), "msg": g("message", "") or "", "tag": g("orderTag", "") or "",
            "time": g("orderDateTime", "")}


class OrderStream:
    """Fyers' order-update socket (wss://socket.fyers.in/trade/v3) for one user, with reconnects. Every order update
    goes to on_order(row) (row from norm_order), called on this socket's own thread. The SDK's FyersOrderSocket is
    a single instance per process and gives up after a few reconnects, so this is a small client of our own."""
    URL = "wss://socket.fyers.in/trade/v3"

    def __init__(self, link, on_order, label=""):
        self.link, self.on_order, self.label = link, on_order, label
        self.up = False
        self.last_msg = 0.0
        self.tok = ""
        self.ws = None
        self.stopped = False
        self.on_connect = None
        self._mapper = None
        self._t = threading.Thread(target=self._run, name=f"orders-{label}", daemon=True)
        self._t.start()

    def _map(self) -> dict:
        if self._mapper is None:
            try:
                import fyers_apiv3.FyersWebsocket as fw
                with open(os.path.join(os.path.dirname(fw.__file__), "map.json"), encoding="utf-8") as f:
                    self._mapper = json.load(f)["order_mapper"]
            except Exception as e:
                log.warning("order socket field map not found (%s); using raw names", e)
                self._mapper = {}
        return self._mapper

    def _msg(self, text):
        self.last_msg = time.time()
        if text == "pong":
            return
        try:
            j = json.loads(text)
        except ValueError:
            return
        o = j.get("orders") if isinstance(j, dict) else None
        if not isinstance(o, dict):
            return
        m = self._map()
        row = {m.get(k, k): v for k, v in o.items()}
        try:
            self.on_order(norm_order(row))
        except Exception as e:
            log.exception("order update handling failed: %s", e)

    def _run(self):
        import websocket
        delay = 2
        while not self.stopped:
            try:
                tok = self.link.token()
                app_id = self.link.settings().get("app_id") if tok else None
            except Exception as e:                       # never let this end the thread
                log.warning("[%s] order socket: %s", self.label, e)
                tok = app_id = None
            if not tok or not app_id:
                self.up = False
                time.sleep(5)
                continue
            self.tok = tok

            def on_open(ws):
                nonlocal delay
                self.up = True
                delay = 2
                ws.send(json.dumps({"T": "SUB_ORD", "SLIST": ["orders"], "SUB_T": 1}))
                log.info("[%s] Order updates connected", self.label)
                if self.on_connect:
                    try:
                        self.on_connect()
                    except Exception as e:
                        log.warning("order socket on_connect: %s", e)

            def pinger(ws):
                self.last_msg = time.time()
                while self.ws is ws and self.up:
                    try:
                        ws.send("ping")
                    except Exception:
                        return
                    time.sleep(10)
                    try:
                        new_login = self.link.token() != self.tok   # a new Fyers login: reconnect with the new token
                    except Exception:
                        new_login = False
                    silent = time.time() - self.last_msg > 45       # Fyers answers each ping: silence = a dead link
                    if new_login or silent:
                        if silent:
                            log.warning("[%s] Order socket silent for 45 s - reconnecting", self.label)
                        self.up = False
                        ws.close()
                        return

            ws = websocket.WebSocketApp(self.URL, header={"authorization": f"{app_id}:{tok}"},
                                        on_open=lambda w: (on_open(w), threading.Thread(target=pinger, args=(w,), daemon=True).start()),
                                        on_message=lambda w, m: self._msg(m),
                                        on_error=lambda w, e: log.warning("[%s] Order socket error: %s", self.label, e))
            self.ws = ws
            try:
                ws.run_forever()
            except Exception as e:
                log.warning("[%s] Order socket stopped: %s", self.label, e)
            self.up = False
            self.ws = None
            if self.stopped:
                break
            log.warning("[%s] Order updates disconnected - reconnecting in %ss", self.label, delay)
            time.sleep(delay)
            delay = min(30, delay * 2)

    def stop(self):
        self.stopped = True
        self.up = False
        try:
            if self.ws:
                self.ws.close()
        except Exception:
            pass
