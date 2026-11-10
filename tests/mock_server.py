"""Run the helper with Fyers faked out: history, quotes, margin, and a 1-second price stream, on http://localhost:8766.
Usage: FYERS_HELPER_DATA=/some/test/folder python3 tests/mock_server.py   (see tests/README.md)"""
import math
import random
import sys
import threading
import time

import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Telegram (and Healthchecks.io) are faked too, on :8767 (tests/fake_telegram.py): /_sent lists what the app sent
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_telegram  # noqa: E402
TG_PORT = int(os.environ.get("FAKE_TELEGRAM_PORT", "8767"))
os.environ["TELEGRAM_API"] = f"http://127.0.0.1:{TG_PORT}"
os.environ.setdefault("HC_API", f"http://127.0.0.1:{TG_PORT}")
fake_telegram.start(TG_PORT)
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
        if str(params.get("cont_flag")) != "0":
            # Fyers' continuous series is another contract's candles on some days, and real Fyers sends it when
            # cont_flag is left out as well as with "1" (checked 2 Nov 2026): the app must always send cont_flag=0
            print("CONT_FLAG ASKED", params["symbol"], params.get("cont_flag", "(left out)"), flush=True)
            return {"s": "ok", "candles": [[int(time.time()) // 60 * 60 - 60, 9999, 9999, 9999, 9999, 1]]}
        import datetime as dt, math
        sec = 86400 if params["resolution"] == "D" else int(params["resolution"]) * 60
        IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
        a = int(dt.datetime.fromisoformat(params["range_from"]).replace(tzinfo=IST).timestamp())
        b = min(int(time.time()), int(dt.datetime.fromisoformat(params["range_to"]).replace(tzinfo=IST).timestamp()) + 86400)
        # contracts here were "listed" LISTED_DAYS ago: before that Fyers answers no_data (as it does for a real contract)
        listed = int(time.time()) - LISTED_DAYS * 86400
        if b < listed:
            return {"candles": [], "message": "", "s": "no_data"}
        a = max(a, listed)
        out = []
        t = (a // sec + 1) * sec
        while t <= b and len(out) < 20000:
            if sec >= 86400 or ALLDAY[0] or 3.5 * 3600 <= (t % 86400) <= 18 * 3600:        # 09:00-23:30 IST (all day: /_mock/allday)
                base = 5600 + 60 * math.sin(t / 20000) + 15 * math.sin(t / 1300)
                o = base + (hash((params["symbol"], t)) % 7 - 3); c = base + (hash((params["symbol"], t + 1)) % 7 - 3)
                out.append([t, round(o), round(max(o, c) + 2), round(min(o, c) - 2), round(c), 100])
            elif "26DECFUT" in params["symbol"] and 18 * 3600 < t % 86400 <= 18 * 3600 + 25 * 60:
                # like GOLDPETAL on 30 Oct: after 23:30 Fyers' history carries the exchange's closing price on empty
                # candles (no volume), far from the last trade
                k = 6000 + 250
                out.append([t, k, k, k, k, 0])
            t += sec
        return {"s": "ok", "candles": out}
    return _real_get(self, url, params)


FL._get = fake_get
ALLDAY = [os.environ.get("FAKE_ALLDAY") == "1"]     # candles round the clock (replay_flow.js: a trade at night needs candles)
LISTED_DAYS = int(os.environ.get("FAKE_LISTED_DAYS", "200"))

# Live accounts: Fyers' order API and order-update socket are faked too (tests/fake_broker.py)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_broker import FakeBroker  # noqa: E402
from helper import rt as rtmod  # noqa: E402
from helper.broker import norm_order  # noqa: E402
FB = FakeBroker()


class FakeStream:
    up = True
    on_connect = None

    def __init__(self, link, on_order, label):
        FB.emit = lambda row: on_order(norm_order(row))

    def stop(self):
        pass


rtmod.make_broker = lambda link: FB
rtmod.make_stream = lambda link, on_order, label: FakeStream(link, on_order, label)
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
        for s in feed.fy_wanted():          # (what Fyers streams: never MT5 symbols, which come from the MT5 bridge)
            base = 150.0 if s.endswith(("CE", "PE")) else 5600.0
            t = 0.1 if base < 1000 else 1.0
            p = PX.get(s, base) + random.choice([-2, -1, 0, 1, 2]) * t
            PX[s] = p
            p = round(round(p / t) * t, 2)
            feed.sock_up = True
            VOL[s] = VOL.get(s, 10000) + random.randint(0, 40)
            FB.set_price(s, p, round(p - t, 2), round(p + t, 2))
            feed.publish({"s": s, "ltp": p, "bid": round(p - t, 2), "ask": round(p + t, 2), "t": int(time.time()), "vol": VOL[s], "src": "ws",
                          "tbq": 5200 + random.randint(0, 900), "tsq": 4800 + random.randint(0, 900), "pc": 5580, "atp": 5602.4, "ltq": 3})
            # (no day open / high / low: the mock's prices are a random walk that doesn't follow its own candles, so the
            # chart's data check would always fire; tests/navigation_flow.js gives it figures of its own)
        for s in feed.wanted_depth():
            p = PX.get(s, 5600.0); t = 1.0
            feed.publish_depth({"s": s, "bids": [[p - t * (i + 1), random.randint(1, 60), random.randint(1, 9)] for i in range(5)],
                                "asks": [[p + t * (i + 1), random.randint(1, 60), random.randint(1, 9)] for i in range(5)], "t": int(time.time()), "src": "ws"})


threading.Thread(target=ticker, daemon=True).start()
import uvicorn  # noqa: E402
from helper.app import app  # noqa: E402
from fastapi import Request  # noqa: E402


def caddy_headers() -> dict:
    """The response headers the real server's Caddy adds (server/Caddyfile), so the browser tests see the same rules -
    v0.28.1: Caddy's "X-Frame-Options DENY" broke multi-chart grids on the server, and the tests (no Caddy) never saw it."""
    import re
    import shlex
    txt = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "server", "Caddyfile")).read()
    block = re.search(r"header\s*\{([^}]*)\}", txt).group(1)
    out = {}
    for line in block.splitlines():
        line = line.strip()
        if not line or line.startswith(("-", "#")):
            continue
        name, *val = shlex.split(line)
        if name.lower() != "strict-transport-security":      # the test server is plain http
            out[name] = " ".join(val)
    return out


CADDY = caddy_headers()


@app.middleware("http")
async def _caddy(request, call_next):
    resp = await call_next(request)
    for k, v in CADDY.items():
        resp.headers.setdefault(k, v)
    return resp


@app.post("/_mock/allday")
async def _mock_allday(on: int = 0):
    ALLDAY[0] = bool(on)
    return {"ok": True, "allday": ALLDAY[0]}


@app.post("/_mock/outside")
async def _mock_outside(request: Request):
    """An order placed straight in Fyers (its app, web, another platform), as the fake Fyers sees it (live_flow.js)."""
    b = await request.json()
    try:
        oid = FB.outside(b["s"], int(b["qty"]), int(b["side"]), int(b.get("type", 2)), b.get("product", "INTRADAY"),
                         float(b.get("limit") or 0), float(b.get("stop") or 0))
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "id": oid}


@app.get("/_mock/book")
async def _mock_book():
    """The fake Fyers' order book, net positions and funds."""
    return {"book": list(FB.book.values()), "net": [[s, p, q] for (s, p), q in FB.net.items()], "violations": FB.violations}


uvicorn.run(app, host="127.0.0.1", port=8766, log_level="warning")
