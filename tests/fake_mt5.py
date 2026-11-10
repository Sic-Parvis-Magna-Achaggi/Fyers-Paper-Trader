"""A fake MT5 terminal running the FTM Bridge EA (mt5/FTM_Bridge.mq5): it speaks the same protocol to the app, with made-up
prices for a few symbols and a made-up account, so the MT5 bridge and the MT5 accounts can be tested without MT5.

  python3 tests/fake_mt5.py http://localhost:8766 <bridge key> [--login 21182752] [--server FundingPips-SIM1] [--offset auto]
                            [--ctl 8769] [--history] [--old] [--balance 5000]

Like the EA: calls POST /api/mt5/sync every POLL ms with the account, the broker's clock (srv / gmt) and new ticks of the
symbols the app asked for (SUB); answers HIST with candles in broker server time (CopyRates: bars whose open time is in
[from, to]) in parts of 20,000; answers LIST with the symbol list in parts of 300. The broker's clock is GMT+2 in winter
and GMT+3 in US summer time (as FundingPips and most brokers), weekends have no candles, the bid is the price.

EA 1.10 (roadmap 8 b1; --old plays EA 1.00): every call also carries the account's positions, pending orders, its deals
(from the cursor the app sets with DEALS, at most 200 a call, "dmore" when there are more) and the results of the app's
commands (MOD / CLOSE / CANCEL / OMOD <tag> ...), each tag carried out once. The account behaves like an MT5 Hedge
account: SL / TP trigger on the bid (long) / ask (short) and close at that price, pending orders fill on the ask (buy) /
bid (sell), invalid stops are refused (10016), commission is charged per lot on the opening and closing deals, swap is
added on request, the balance and equity move like MT5's.

--ctl PORT: a small control API for the browser tests (JSON): POST /open {sym, side, vol, sl, tp, comment}, /pending
{sym, kind: limit|stop, side, price, vol, sl, tp}, /modify {ticket, sl, tp} (by hand in MT5), /close {ticket, vol}
(by hand), /shift {sym, by} (moves that symbol's prices), /swap {ticket, amount}, /refuse {k, code, n}, /trade {on},
/comm {sym, in, out}; GET /state.

The prices are a smooth function of time (the same every run, every request), so candles asked for twice match."""
import argparse
import datetime as dt
import json
import math
import random
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx

SYMS = {   # name: (desc, path, digits, base, amplitude, spread in points, contract)
    "XAUUSD": ("Gold vs US Dollar", "Metals\\XAUUSD", 2, 2650.0, 40.0, 25, 100),
    "EURUSD": ("Euro vs US Dollar", "Forex\\EURUSD", 5, 1.0800, 0.015, 8, 100000),
    "US30.cash": ("Dow Jones Industrial Average", "Indices\\US30.cash", 2, 43000.0, 600.0, 200, 1),
}
COMM = {"XAUUSD": (3.0, 3.0), "EURUSD": (3.5, 3.5), "US30.cash": (0.0, 0.0)}    # $ per lot: opening deal, closing deal
OK_DONE, OK_PLACED, NO_CHANGES, INVALID_STOPS, NO_POS, AUTO_OFF = 10009, 10008, 10025, 10016, 10036, 10027


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


def spec(n):
    d, p, dg, _, _, sp, c = SYMS[n]
    return {"name": n, "desc": d, "path": p, "digits": dg, "point": 10 ** -dg, "tick_size": 10 ** -dg,
            "tick_value": round(10 ** -dg * c, 10), "contract": c, "vmin": 0.01, "vstep": 0.01, "vmax": 100, "cprofit": "USD",
            "cmargin": "USD", "cbase": n[:3], "trade_mode": 4, "calc_mode": 0, "swap_mode": 1, "swap_long": -5.1,
            "swap_short": 1.2, "stops_level": 0, "freeze_level": 0, "spread": sp, "visible": n != "US30.cash"}


class FakeEA:
    def __init__(self, url, key, login=21182752, server="FundingPips-SIM1", poll=0.25, fixed_offset=None, log=print,
                 old=False, balance=5000.0, history=False):
        self.url, self.key, self.login, self.server = url.rstrip("/"), key, login, server
        self.poll, self.fixed, self.log, self.old = poll, fixed_offset, log, old
        self.subs, self.last = [], {}
        self.stop_ev = threading.Event()
        self.http = httpx.Client(timeout=30)
        self.calls = self.ticks_sent = 0
        self.last_code = None
        self.hist_asked = []
        self.th = None
        self.lock = threading.RLock()
        # the account (EA 1.10)
        self.balance = float(balance)
        self.positions, self.orders, self.deals = {}, {}, []
        run = (int(time.time() * 10) % 10_000_000) * 100      # tickets unique per run, as MT5's never repeat
        self.next_ticket = 100_000_000_000 + run
        self.next_deal = 900_000_000_000 + run
        self.shift = {}
        self.jitter = True
        self.trade_on = True
        self.algo = True
        self.res = []                 # results waiting to be delivered
        self.res_sent = 0
        self.done_tags = {}           # tag -> result (a tag is carried out once)
        self.cmds = []                # every command line received (for the tests)
        self.refuse = []              # [{k, code, n}]
        self.drop_results = 0         # the next N results are "lost" (never reported)
        self.dcur = (0, 0)            # deal cursor (time msc, ticket)
        self.dpend = None             # what the cursor becomes once the app has answered
        self.dmax = 200
        self.deals_asked = []
        self.comm = dict(COMM)
        dep_t = self.srv_now() - (40 if history else 1) * 86400
        self._deal(0, 0, "", 2, 0, 0, 0, 0, 0, self.balance, dep_t, reason=0, comment="Deposit", balance=False)
        if history:
            self._seed_history()

    # ------------------------------------------------------------ the account
    def srv_now(self):
        return time.time() + offset_at(time.time(), self.fixed)

    def quote(self, s):
        dg = SYMS[s][2]
        bid = price(s, self.srv_now()) + self.shift.get(s, 0.0)
        if self.jitter:
            bid += random.uniform(-1, 1) * 10 ** -dg * 3
        bid = round(bid, dg)
        return bid, round(bid + SYMS[s][5] * 10 ** -dg, dg)

    def _deal(self, order, pid, sym, typ, entry, vol, px, comm, swap, profit, t_srv, reason=0, comment="", balance=True, magic=0):
        tk = self.next_deal
        self.next_deal += 1
        self.deals.append([tk, order, pid, sym, typ, entry, round(vol, 2), px, round(comm, 2), round(swap, 2), round(profit, 2), 0.0,
                           int(t_srv * 1000), magic, comment, reason])
        if balance:
            self.balance = round(self.balance + comm + swap + profit, 2)
        return tk

    def _seed_history(self):
        """Two trades closed days ago (MT5's history): one win, one loss."""
        t0 = self.srv_now() - 10 * 86400
        for i, (side, op, cp, vol) in enumerate([(1, 2600.00, 2610.00, 0.10), (-1, 2620.00, 2625.50, 0.05)]):
            tk = self.next_ticket
            self.next_ticket += 1
            ci, co = self.comm["XAUUSD"]
            self._deal(tk, tk, "XAUUSD", 0 if side > 0 else 1, 0, vol, op, -ci * vol, 0, 0, t0 + i * 7200, reason=0)
            pr = (cp - op) * side * 100 * vol
            self._deal(tk + 100000, tk, "XAUUSD", 1 if side > 0 else 0, 1, vol, cp, -co * vol, -1.2, pr, t0 + i * 7200 + 3000,
                       reason=4 if pr < 0 else 5)

    def open(self, sym, side, vol, sl=0.0, tp=0.0, comment="", magic=0, at=None):
        with self.lock:
            bid, ask = self.quote(sym)
            px = at if at is not None else (ask if side > 0 else bid)
            tk = self.next_ticket
            self.next_ticket += 1
            t = self.srv_now()
            ci = self.comm[sym][0]
            self.positions[tk] = {"ticket": tk, "sym": sym, "side": side, "vol": round(vol, 2), "open": px, "sl": sl or 0.0,
                                  "tp": tp or 0.0, "swap": 0.0, "time": t, "magic": magic, "comment": comment, "id": tk}
            self._deal(tk, tk, sym, 0 if side > 0 else 1, 0, vol, px, -ci * vol, 0, 0, t, reason=0, comment=comment, magic=magic)
            return tk

    def pending(self, sym, kind, side, price_, vol, sl=0.0, tp=0.0, comment=""):
        with self.lock:
            typ = {("limit", 1): 2, ("limit", -1): 3, ("stop", 1): 4, ("stop", -1): 5}[(kind, side)]
            tk = self.next_ticket
            self.next_ticket += 1
            self.orders[tk] = {"ticket": tk, "sym": sym, "type": typ, "side": side, "kind": kind, "vol": round(vol, 2),
                               "price": price_, "sl": sl or 0.0, "tp": tp or 0.0, "time": self.srv_now(), "comment": comment}
            return tk

    def _profit(self, p, px, vol=None):
        return (px - p["open"]) * p["side"] * SYMS[p["sym"]][6] * (vol if vol is not None else p["vol"])

    def close_pos(self, tk, vol=None, reason=0, px=None, comment="", magic=0):
        with self.lock:
            p = self.positions.get(tk)
            if not p:
                return False
            bid, ask = self.quote(p["sym"])
            px = px if px is not None else (bid if p["side"] > 0 else ask)
            v = round(min(vol or p["vol"], p["vol"]), 2)
            share = v / p["vol"]
            sw = round(p["swap"] * share, 2)
            co = self.comm[p["sym"]][1]
            self._deal(tk + 200000 + len(self.deals), tk, p["sym"], 1 if p["side"] > 0 else 0, 1, v, px, -co * v, sw,
                       self._profit(p, px, v), self.srv_now(), reason=reason, comment=comment, magic=magic)
            p["swap"] = round(p["swap"] - sw, 2)
            p["vol"] = round(p["vol"] - v, 2)
            if p["vol"] <= 1e-9:
                self.positions.pop(tk, None)
            return True

    def step(self):
        """Prices move: SL / TP trigger on the bid (long) / ask (short), pending orders fill (as MT5)."""
        with self.lock:
            for tk, p in list(self.positions.items()):
                bid, ask = self.quote(p["sym"])
                if p["side"] > 0:
                    if p["sl"] and bid <= p["sl"]:
                        self.close_pos(tk, reason=4, px=bid)
                    elif p["tp"] and bid >= p["tp"]:
                        self.close_pos(tk, reason=5, px=bid)
                else:
                    if p["sl"] and ask >= p["sl"]:
                        self.close_pos(tk, reason=4, px=ask)
                    elif p["tp"] and ask <= p["tp"]:
                        self.close_pos(tk, reason=5, px=ask)
            for tk, o in list(self.orders.items()):
                bid, ask = self.quote(o["sym"])
                t = o["type"]
                hit = (t == 2 and ask <= o["price"]) or (t == 3 and bid >= o["price"]) or (t == 4 and ask >= o["price"]) \
                    or (t == 5 and bid <= o["price"])
                if hit:
                    self.orders.pop(tk)
                    px = ask if o["side"] > 0 else bid
                    ci = self.comm[o["sym"]][0]
                    self.positions[tk] = {"ticket": tk, "sym": o["sym"], "side": o["side"], "vol": o["vol"], "open": px,
                                          "sl": o["sl"], "tp": o["tp"], "swap": 0.0, "time": self.srv_now(), "magic": 0,
                                          "comment": o["comment"], "id": tk}
                    self._deal(tk, tk, o["sym"], 0 if o["side"] > 0 else 1, 0, o["vol"], px, -ci * o["vol"], 0, 0, self.srv_now())

    def equity(self):
        e = self.balance
        for p in self.positions.values():
            bid, ask = self.quote(p["sym"])
            e += self._profit(p, bid if p["side"] > 0 else ask) + p["swap"]
        return round(e, 2)

    # ------------------------------------------------------------ the app's commands
    def _stops_ok(self, sym, side, sl, tp, ref=None):
        bid, ask = self.quote(sym)
        if ref is not None:                    # a pending order: stops around its price
            bid = ask = ref
        if side > 0:
            return (not sl or sl < bid) and (not tp or tp > bid)
        return (not sl or sl > ask) and (not tp or tp < ask)

    def command(self, ln):
        parts = ln.split()
        k, tag = parts[0], parts[1]
        self.cmds.append(ln)
        if tag in self.done_tags:              # carried out once: its result again
            self.res.append(self.done_tags[tag])
            return
        r = self._run(k, tag, parts[2:])
        self.done_tags[tag] = r
        if self.drop_results > 0:
            self.drop_results -= 1
            return
        self.res.append(r)

    def _run(self, k, tag, a):
        if not self.trade_on:
            return [tag, 0, 0, "trading from the app is off in the EA's inputs (AllowTrading)", 0]
        if not self.algo:
            return [tag, 0, AUTO_OFF, "AutoTrading disabled by client", 0]
        for rf in self.refuse:
            if rf.get("k") == k and rf.get("n", 1) > 0:
                rf["n"] = rf.get("n", 1) - 1
                return [tag, 0, rf.get("code", INVALID_STOPS), rf.get("msg", "Invalid stops"), 0]
        with self.lock:
            if k == "MOD":
                tk, sl, tp = int(a[0]), float(a[1]), float(a[2])
                p = self.positions.get(tk)
                if not p:
                    return [tag, 0, NO_POS, "Position doesn't exist", tk]
                if abs(p["sl"] - sl) < 1e-9 and abs(p["tp"] - tp) < 1e-9:
                    return [tag, 1, NO_CHANGES, "No changes", tk]
                if not self._stops_ok(p["sym"], p["side"], sl, tp):
                    return [tag, 0, INVALID_STOPS, "Invalid stops", tk]
                p["sl"], p["tp"] = sl, tp
                return [tag, 1, OK_DONE, "Request completed", tk]
            if k == "CLOSE":
                tk, vol = int(a[0]), float(a[1])
                if tk not in self.positions:
                    return [tag, 0, NO_POS, "Position doesn't exist", tk]
                self.close_pos(tk, vol or None, reason=3, comment="FTM " + tag, magic=20261110)
                return [tag, 1, OK_DONE, "Request completed", tk]
            if k == "CANCEL":
                tk = int(a[0])
                if tk not in self.orders:
                    return [tag, 0, 10013, "Invalid request (order not found)", tk]
                self.orders.pop(tk)
                return [tag, 1, OK_DONE, "Request completed", tk]
            if k == "OMOD":
                tk, px, sl, tp = int(a[0]), float(a[1]), float(a[2]), float(a[3])
                o = self.orders.get(tk)
                if not o:
                    return [tag, 0, 10013, "Invalid request (order not found)", tk]
                if not self._stops_ok(o["sym"], o["side"], sl, tp, ref=px):
                    return [tag, 0, INVALID_STOPS, "Invalid stops", tk]
                o["price"], o["sl"], o["tp"] = px, sl, tp
                return [tag, 1, OK_PLACED, "Request completed", tk]
        return [tag, 0, 10013, "unknown command " + k, 0]

    # ------------------------------------------------------------ the sync call
    def post(self, path, body):
        r = self.http.post(self.url + path, content=json.dumps(body), headers={"Content-Type": "application/json", "X-FTM-Key": self.key})
        return r.status_code, r.text

    def sync_body(self):
        now = time.time()
        off = offset_at(now, self.fixed)
        ticks = []
        for s in self.subs:
            t_srv = now + off
            bid, ask = self.quote(s)
            ticks.append([s, int(t_srv * 1000), bid, ask, 0, 12345])
        self.ticks_sent += len(ticks)
        b = {"v": 1, "ea": "1.00", "build": 4755, "srv": int(now + off), "gmt": int(now),
             "acct": {"login": self.login, "server": self.server, "company": "FundingPips Corp", "name": "Test Trader",
                      "currency": "USD", "balance": self.balance, "equity": self.equity() if not self.old else 5012.5,
                      "margin": self.margin(), "free": round(self.equity() - self.margin(), 2), "leverage": 100,
                      "mode": "hedge", "trade_allowed": True, "ea_allowed": self.algo, "demo": True},
             "ticks": ticks}
        if self.old:
            return b
        with self.lock:
            self.step()
            b["v"], b["ea"] = 2, "1.10"
            b["acct"]["balance"], b["acct"]["equity"] = self.balance, self.equity()
            b["trade"] = {"on": self.trade_on, "term": self.algo, "mql": True}
            pos, syms = [], set()
            for p in self.positions.values():
                bid, ask = self.quote(p["sym"])
                pc = bid if p["side"] > 0 else ask
                pos.append([p["ticket"], p["sym"], 0 if p["side"] > 0 else 1, p["vol"], p["open"], p["sl"], p["tp"], pc, p["swap"],
                            round(self._profit(p, pc), 2), int(p["time"] * 1000), p["magic"], p["comment"], p["id"]])
                syms.add(p["sym"])
            ords = []
            for o in self.orders.values():
                ords.append([o["ticket"], o["sym"], o["type"], o["vol"], o["vol"], o["price"], o["sl"], o["tp"], int(o["time"] * 1000),
                             0, o["comment"], 0])
                syms.add(o["sym"])
            b["pos"], b["ord"] = pos, ords
            b["sym"] = {s: [spec(s)["tick_value"], spec(s)["tick_size"], 0.01, SYMS[s][6], SYMS[s][2]] for s in syms}
            if self.dcur == (0, 0):
                b["deals"], b["dmore"], self.dpend = [], False, None
            else:
                newer = sorted((d for d in self.deals if (d[12], d[0]) > self.dcur), key=lambda d: (d[12], d[0]))
                b["deals"], b["dmore"] = newer[:self.dmax], len(newer) > self.dmax
                self.dpend = (newer[self.dmax - 1][12], newer[self.dmax - 1][0]) if len(newer) > self.dmax else \
                    ((newer[-1][12], newer[-1][0]) if newer else None)
            b["dcur"] = self.dcur[0]
            self.res_sent = len(self.res)
            b["res"] = list(self.res)
        return b

    def margin(self):
        m = 0.0
        for p in self.positions.values():
            m += p["vol"] * SYMS[p["sym"]][6] * p["open"] / 100.0
        return round(m, 2)

    def once(self):
        body = self.sync_body()
        code, text = self.post("/api/mt5/sync", body)
        self.calls += 1
        self.last_code = code
        if code != 200:
            return code
        with self.lock:
            if not self.old:
                del self.res[:self.res_sent]          # delivered
                if self.dpend:
                    self.dcur = self.dpend
                    self.dpend = None
        for ln in text.splitlines():
            ln = ln.strip()
            if ln == "SUB" or ln.startswith("SUB "):
                self.subs = [s for s in ln[4:].split(",") if s in SYMS]
            elif ln.startswith("DEALS ") and not self.old:
                frm = int(ln.split()[1])
                self.deals_asked.append(frm)
                with self.lock:
                    self.dcur, self.dpend = (frm * 1000, 0), None
            elif ln.split(" ", 1)[0] in ("MOD", "CLOSE", "CANCEL", "OMOD") and not self.old:
                self.command(ln)
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
                self.post("/api/mt5/symbols", {"part": 0, "parts": 1, "symbols": [spec(n) for n in SYMS]})
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

    # ------------------------------------------------------------ the control API (browser tests)
    def state(self):
        with self.lock:
            q = {s: self.quote(s) for s in SYMS}
            return {"balance": self.balance, "equity": self.equity(), "positions": list(self.positions.values()),
                    "orders": list(self.orders.values()), "deals": len(self.deals), "cmds": self.cmds[-50:], "quotes": q,
                    "subs": self.subs, "dcur": self.dcur, "deals_asked": self.deals_asked}

    def control(self, path, b):
        if path == "/open":
            return {"ticket": self.open(b["sym"], int(b.get("side", 1)), float(b.get("vol", 0.01)), float(b.get("sl") or 0),
                                        float(b.get("tp") or 0), b.get("comment", ""))}
        if path == "/pending":
            return {"ticket": self.pending(b["sym"], b.get("kind", "limit"), int(b.get("side", 1)), float(b["price"]),
                                           float(b.get("vol", 0.01)), float(b.get("sl") or 0), float(b.get("tp") or 0))}
        if path == "/modify":
            with self.lock:
                p = self.positions[int(b["ticket"])]
                p["sl"], p["tp"] = float(b.get("sl", p["sl"]) or 0), float(b.get("tp", p["tp"]) or 0)
            return {"ok": True}
        if path == "/close":
            return {"ok": self.close_pos(int(b["ticket"]), float(b.get("vol") or 0) or None)}
        if path == "/shift":
            with self.lock:
                self.shift[b["sym"]] = self.shift.get(b["sym"], 0.0) + float(b["by"])
            return {"ok": True, "quote": self.quote(b["sym"])}
        if path == "/swap":
            with self.lock:
                self.positions[int(b["ticket"])]["swap"] += float(b["amount"])
            return {"ok": True}
        if path == "/refuse":
            self.refuse.append({"k": b["k"], "code": int(b.get("code", INVALID_STOPS)), "n": int(b.get("n", 1)),
                                "msg": b.get("msg", "Invalid stops")})
            return {"ok": True}
        if path == "/trade":
            self.trade_on = bool(b.get("on"))
            return {"ok": True}
        if path == "/comm":
            self.comm[b["sym"]] = (float(b["in"]), float(b["out"]))
            return {"ok": True}
        if path == "/jitter":
            self.jitter = bool(b.get("on"))
            return {"ok": True}
        return {"error": "no such control " + path}


def serve_control(ea, port):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, obj, code=200):
            data = json.dumps(obj, default=str).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self._send(ea.state() if self.path.startswith("/state") else {"error": "GET /state"})

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            try:
                b = json.loads(self.rfile.read(n) or b"{}")
                self._send(ea.control(self.path, b))
            except Exception as e:
                self._send({"error": repr(e)}, 400)
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("key")
    ap.add_argument("--login", type=int, default=21182752)
    ap.add_argument("--server", default="FundingPips-SIM1")
    ap.add_argument("--offset", default="auto", help="auto (GMT+2 / +3 with US summer time) or a fixed number of seconds")
    ap.add_argument("--ctl", type=int, default=0, help="a control API on this port (tests)")
    ap.add_argument("--history", action="store_true", help="two closed trades 10 days ago in MT5's history")
    ap.add_argument("--old", action="store_true", help="play EA 1.00 (prices only)")
    ap.add_argument("--balance", type=float, default=5000.0)
    a = ap.parse_args()
    ea = FakeEA(a.url, a.key, a.login, a.server, fixed_offset=None if a.offset == "auto" else int(a.offset), old=a.old,
                balance=a.balance, history=a.history)
    if a.ctl:
        serve_control(ea, a.ctl)
    print(f"fake MT5 {a.login} on {a.server} -> {a.url}" + (f" (control on :{a.ctl})" if a.ctl else ""), flush=True)
    try:
        ea.run()
    except KeyboardInterrupt:
        sys.exit(0)
