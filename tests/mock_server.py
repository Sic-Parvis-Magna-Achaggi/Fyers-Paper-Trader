"""Run the helper with Fyers faked out: history, quotes, margin, and a 1-second price stream, on http://localhost:8766.
Usage: FYERS_HELPER_DATA=/some/test/folder python3 tests/mock_server.py   (see tests/README.md)"""
import math
import random
import sys
import threading
import time

import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from helper import fyers_link, feed as feedmod  # noqa: E402

FL = fyers_link.FyersLink
FL.token = lambda self: "tok"
FL.status = lambda self: {"configured": True, "logged_in": True, "name": "Test " + (self.label or "user"), "client_id": "XT0001", "since": time.time()}


def fake_history(symbol, res, days):
    sec = fyers_link.RES[res]
    now = int(time.time()) // sec * sec
    out, p = [], 5600.0
    for i in range(300, 0, -1):
        o = p; c = o + random.uniform(-8, 8); h = max(o, c) + random.uniform(0, 4); l = min(o, c) - random.uniform(0, 4)
        out.append([now - i * sec, round(o), round(h), round(l), round(c), 100]); p = c
    return out


def fake_quotes(self, symbols):
    return {s: {"lp": 5600, "bid": 5599, "ask": 5601, "tt": int(time.time())} for s in symbols}


_real_get = FL._get


def fake_get(self, url, params):
    """Real chunking and the real request budget; only Fyers' answer is invented (the same candles every time)."""
    if url.endswith("/history"):
        self.data_budget.take()
        CALLS.append(1); print("HISTORY", params["symbol"], params["resolution"], params["range_from"], params["range_to"], flush=True)
        import datetime as dt, math
        sec = 86400 if params["resolution"] == "D" else int(params["resolution"]) * 60
        IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
        a = int(dt.datetime.fromisoformat(params["range_from"]).replace(tzinfo=IST).timestamp())
        b = min(int(time.time()), int(dt.datetime.fromisoformat(params["range_to"]).replace(tzinfo=IST).timestamp()) + 86400)
        out = []
        t = (a // sec + 1) * sec
        while t <= b and len(out) < 20000:
            if sec >= 86400 or 3.5 * 3600 <= (t % 86400) <= 18 * 3600:        # 09:00-23:30 IST
                base = 5600 + 60 * math.sin(t / 20000) + 15 * math.sin(t / 1300)
                o = base + (hash((params["symbol"], t)) % 7 - 3); c = base + (hash((params["symbol"], t + 1)) % 7 - 3)
                out.append([t, round(o), round(max(o, c) + 2), round(min(o, c) - 2), round(c), 100])
            t += sec
        return {"s": "ok", "candles": out}
    return _real_get(self, url, params)


FL._get = fake_get
FL.quotes = fake_quotes
FL.margin = lambda self, s, q, side, prod, price=0: {"MCX:CRUDEOIL26NOVFUT": 52000.0}.get(s, 20000.0) * q
feedmod.Feed._ensure_socket = lambda self: None
PX = {}
CALLS = []
VOL = {}


def ticker():
    from helper import rt
    while True:
        time.sleep(1)
        for urt in list(rt.RT.values()):
            tick_feed(urt.feed)


def tick_feed(feed):
    if True:
        for s in feed.wanted():
            base = 150.0 if s.endswith(("CE", "PE")) else 5600.0
            t = 0.1 if base < 1000 else 1.0
            p = PX.get(s, base) + random.choice([-2, -1, 0, 1, 2]) * t
            PX[s] = p
            p = round(round(p / t) * t, 2)
            feed.sock_up = True
            VOL[s] = VOL.get(s, 10000) + random.randint(0, 40)
            feed.publish({"s": s, "ltp": p, "bid": round(p - t, 2), "ask": round(p + t, 2), "t": int(time.time()), "vol": VOL[s], "src": "ws",
                          "tbq": 5200 + random.randint(0, 900), "tsq": 4800 + random.randint(0, 900), "o": 5590, "h": 5650, "l": 5560, "pc": 5580, "atp": 5602.4, "ltq": 3})
        for s in feed.wanted_depth():
            p = PX.get(s, 5600.0); t = 1.0
            feed.publish_depth({"s": s, "bids": [[p - t * (i + 1), random.randint(1, 60), random.randint(1, 9)] for i in range(5)],
                                "asks": [[p + t * (i + 1), random.randint(1, 60), random.randint(1, 9)] for i in range(5)], "t": int(time.time()), "src": "ws"})


threading.Thread(target=ticker, daemon=True).start()
import uvicorn  # noqa: E402
uvicorn.run("helper.app:app", host="127.0.0.1", port=8766, log_level="warning")
