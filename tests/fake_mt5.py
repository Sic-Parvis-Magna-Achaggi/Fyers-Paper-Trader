"""A fake MT5 terminal running the FTM Bridge EA (mt5/FTM_Bridge.mq5): it speaks the same protocol to the app, with made-up
prices for a few symbols, so the MT5 bridge can be tested without MT5.

  python3 tests/fake_mt5.py http://localhost:8766 <bridge key> [--login 21182752] [--server FundingPips-SIM1] [--offset auto]

Like the EA: calls POST /api/mt5/sync every POLL ms with the account, the broker's clock (srv / gmt) and new ticks of the
symbols the app asked for (SUB); answers HIST with candles in broker server time (CopyRates: bars whose open time is in
[from, to]) in parts of 20,000; answers LIST with the symbol list in parts of 300. The broker's clock is GMT+2 in winter
and GMT+3 in US summer time (as FundingPips and most brokers), weekends have no candles, the bid is the price.

The prices are a smooth function of time (the same every run, every request), so candles asked for twice match."""
import argparse
import datetime as dt
import json
import math
import random
import sys
import threading
import time

import httpx

SYMS = {   # name: (desc, path, digits, base, amplitude, spread in points, contract)
    "XAUUSD": ("Gold vs US Dollar", "Metals\\XAUUSD", 2, 2650.0, 40.0, 25, 100),
    "EURUSD": ("Euro vs US Dollar", "Forex\\EURUSD", 5, 1.0800, 0.015, 8, 100000),
    "US30.cash": ("Dow Jones Industrial Average", "Indices\\US30.cash", 2, 43000.0, 600.0, 200, 1),
}


def us_dst(utc):
    y = dt.datetime.fromtimestamp(utc, dt.timezone.utc).year

    def sun(m, n):
        d = dt.date(y, m, 1)
        d += dt.timedelta(days=(6 - d.weekday()) % 7)
        return d + dt.timedelta(weeks=n - 1)
    a = dt.datetime.combine(sun(3, 2), dt.time(7), dt.timezone.utc).timestamp()
    b = dt.datetime.combine(sun(11, 1), dt.time(6), dt.timezone.utc).timestamp()
    return a <= utc < b


def offset_at(utc, fixed=None):
    return fixed if fixed is not None else 7200 + (3600 if us_dst(utc) else 0)


def price(name, t):
    """The bid at server time t (seconds)."""
    _, _, dg, base, amp, _, _ = SYMS[name]
    m = t / 60.0
    p = base + amp * (0.6 * math.sin(m / 911.0) + 0.25 * math.sin(m / 97.0 + 1) + 0.1 * math.sin(m / 13.7 + 2)
                      + 0.05 * math.sin(m / 2.3 + 3))
    return round(p, dg)


def weekend(t_srv):
    return dt.datetime.fromtimestamp(t_srv, dt.timezone.utc).weekday() >= 5


def bars(name, tf, frm, to):
    """CopyRates(name, tf, from, to): bars whose open time (server time) is in [from, to]."""
    sec = 86400 if tf == "D" else int(tf) * 60
    dg = SYMS[name][2]
    now_srv = time.time() + offset_at(time.time())
    to = min(to, now_srv)
    out = []
    t = int(frm) // sec * sec
    if t < frm:
        t += sec
    while t <= to:
        if not weekend(t):
            n = 12
            end = min(t + sec, now_srv)
            pts = [price(name, t + (end - t) * i / n) for i in range(n + 1)]
            out.append([t, pts[0], round(max(pts), dg), round(min(pts), dg), pts[-1], 30 + int(sec / 60) * 7])
        t += sec
    return out


class FakeEA:
    def __init__(self, url, key, login=21182752, server="FundingPips-SIM1", poll=0.25, fixed_offset=None, log=print):
        self.url, self.key, self.login, self.server = url.rstrip("/"), key, login, server
        self.poll, self.fixed, self.log = poll, fixed_offset, log
        self.subs, self.last = [], {}
        self.stop_ev = threading.Event()
        self.http = httpx.Client(timeout=30)
        self.calls = self.ticks_sent = 0
        self.last_code = None
        self.hist_asked = []
        self.th = None

    def post(self, path, body):
        r = self.http.post(self.url + path, content=json.dumps(body), headers={"Content-Type": "application/json", "X-FTM-Key": self.key})
        return r.status_code, r.text

    def sync_body(self):
        now = time.time()
        off = offset_at(now, self.fixed)
        ticks = []
        for s in self.subs:
            t_srv = now + off
            bid = price(s, t_srv) + round(random.uniform(-1, 1) * 10 ** -SYMS[s][2] * 3, SYMS[s][2])
            ask = round(bid + SYMS[s][5] * 10 ** -SYMS[s][2], SYMS[s][2])
            ticks.append([s, int(t_srv * 1000), round(bid, SYMS[s][2]), ask, 0, 12345])
        self.ticks_sent += len(ticks)
        return {"v": 1, "ea": "1.00", "build": 4755, "srv": int(now + off), "gmt": int(now),
                "acct": {"login": self.login, "server": self.server, "company": "FundingPips Corp", "name": "Test Trader",
                         "currency": "USD", "balance": 5000.0, "equity": 5012.5, "margin": 0, "free": 5012.5, "leverage": 100,
                         "mode": "hedge", "trade_allowed": True, "ea_allowed": False, "demo": True},
                "ticks": ticks}

    def once(self):
        code, text = self.post("/api/mt5/sync", self.sync_body())
        self.calls += 1
        self.last_code = code
        if code != 200:
            return code
        for ln in text.splitlines():
            ln = ln.strip()
            if ln == "SUB" or ln.startswith("SUB "):
                self.subs = [s for s in ln[4:].split(",") if s in SYMS]
            elif ln.startswith("HIST "):
                _, hid, sym, tf, a, b = ln.split()
                self.hist_asked.append((sym, tf, int(a), int(b)))
                if sym not in SYMS:
                    self.post("/api/mt5/bars", {"id": hid, "bars": [], "done": True, "err": f"{sym} isn't a symbol on this broker"})
                    continue
                rows = bars(sym, tf, int(a), int(b))
                if not rows:
                    self.post("/api/mt5/bars", {"id": hid, "bars": [], "done": True})
                for i in range(0, len(rows), 20000):
                    part = rows[i:i + 20000]
                    self.post("/api/mt5/bars", {"id": hid, "sym": sym, "bars": part, "done": i + 20000 >= len(rows)})
            elif ln == "LIST":
                specs = [{"name": n, "desc": d, "path": p, "digits": dg, "point": 10 ** -dg, "tick_size": 10 ** -dg,
                          "tick_value": 1.0, "contract": c, "vmin": 0.01, "vstep": 0.01, "vmax": 100, "cprofit": "USD",
                          "cmargin": "USD", "cbase": n[:3], "trade_mode": 4, "calc_mode": 0, "swap_mode": 1, "swap_long": -5.1,
                          "swap_short": 1.2, "stops_level": 0, "freeze_level": 0, "spread": sp, "visible": n != "US30.cash"}
                         for n, (d, p, dg, _, _, sp, c) in SYMS.items()]
                self.post("/api/mt5/symbols", {"part": 0, "parts": 1, "symbols": specs})
        return code

    def run(self):
        while not self.stop_ev.is_set():
            try:
                self.once()
            except Exception as e:
                self.log("fake MT5:", e)
                time.sleep(1)
            self.stop_ev.wait(self.poll)

    def start(self):
        self.th = threading.Thread(target=self.run, daemon=True)
        self.th.start()
        return self

    def stop(self):
        self.stop_ev.set()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("key")
    ap.add_argument("--login", type=int, default=21182752)
    ap.add_argument("--server", default="FundingPips-SIM1")
    ap.add_argument("--offset", default="auto", help="auto (GMT+2 / +3 with US summer time) or a fixed number of seconds")
    a = ap.parse_args()
    ea = FakeEA(a.url, a.key, a.login, a.server, fixed_offset=None if a.offset == "auto" else int(a.offset))
    print(f"fake MT5 {a.login} on {a.server} -> {a.url}", flush=True)
    try:
        ea.run()
    except KeyboardInterrupt:
        sys.exit(0)
