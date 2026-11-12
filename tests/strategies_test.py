"""Strategies (v0.43.0, roadmap 23 a) without a browser: the strategy engine in-process with two real paper engines, the real
Pine runner (Node, helper/pine_node.mjs), made-up candles and ticks. Checks: the definition's checks (a strategy script,
contracts, Live / MT5 rules, 2FA when Live / MT5 are switched on), history not traded, a closed bar's strategy.entry
opening a trade on the switched-on account only (tagged, sized by risk, the script's stop, Target R, its own BE / trail),
the script's stop followed (only tighter), strategy.close, a reversal, Long only, the strategy's limits (trades a day,
open at once, daily loss, hours), the kill-switch flag, ATR / points / swing / a Pine line as the stop, an error switching
the strategy off, the tester (fills, R, net of charges) and the journal's set-up tag.

    python3 tests/strategies_test.py          (needs Node; ~40 s)"""
import asyncio
import datetime as dt
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
D = "/tmp/fyers_strategies_test"
shutil.rmtree(D, ignore_errors=True)
os.makedirs(D)
for f in os.listdir(HERE + "/fixtures"):
    shutil.copy(HERE + "/fixtures/" + f, D)
os.environ["FYERS_HELPER_DATA"] = D
sys.path.insert(0, os.path.dirname(HERE))

from helper import chartalerts as CA, charges, paper, strategies as SG, symbols  # noqa: E402
from helper import candles as candles_store  # noqa: E402
from helper.paper import Paper  # noqa: E402

symbols.refresh()
OK = FAIL = 0


def check(name, cond, info=""):
    global OK, FAIL
    if cond:
        OK += 1
        print("  ok  ", name)
    else:
        FAIL += 1
        print("  FAIL", name, info)


IST = 19800
F = "MCX:CRUDEOIL26NOVFUT"
TODAY = dt.datetime(2026, 11, 12, tzinfo=dt.timezone.utc)
T0 = int(TODAY.timestamp()) + 10 * 3600 - IST            # 10:00 IST (UTC seconds): MCX is open
CLOCK = [T0]
SG._now = lambda: CLOCK[0]
CA._now = lambda: CLOCK[0]
paper.now = lambda: CLOCK[0]
paper.ist = lambda ts=None: dt.datetime.fromtimestamp(ts if ts is not None else CLOCK[0], paper.IST)
SG.ist = paper.ist
ROWS = {}


def hist(n=80, base=5600.0):
    out, px = [], base
    for i in range(n):
        t = T0 - (n - i) * 300
        o, c = px, base + ((i % 4) - 1.5)                  # a flat, quiet market: no signals in the history
        out.append([t, o, max(o, c) + 1, min(o, c) - 1, c, 100])
        px = c
    ROWS[(F, "5")] = out
    return out


candles_store.get = lambda link, s, res, days, since=0: [list(r) for r in ROWS.get((s, res), [])]


class FakeFeed:
    def __init__(self):
        self.sent = []
        self.last = {}

    def broadcast(self, m, acct=None):
        self.sent.append(m)

    def _resync(self):
        pass


class FakeRT:
    def __init__(self):
        self.uid, self.dir, self.label, self.link, self.loop = "S", "u/S/", "S", None, None
        self.feed = FakeFeed()
        self.engines = {}
        for aid in ("pA", "pB"):
            e = Paper(f"u/S/a/{aid}/", None, aid)
            e.rules.update(size=1000000, max_margin_pct=0, risk_cap_pct=0, daily_pct=0, max_pct=0, max_open_risk_pct=0,
                           max_trades=0, squareoff_on=False)
            e.acct.update(start=1000000, peak=1000000)
            self.engines[aid] = e

    def accounts(self):
        return [{"id": "pA", "name": "Paper A", "mode": "paper"}, {"id": "pB", "name": "Paper B", "mode": "paper"}]


def price(urt, px, t):
    CLOCK[0] = t
    tk = {"s": F, "ltp": px, "bid": px - 1, "ask": px + 1, "t": t, "vol": None, "h": None, "l": None}
    for e in urt.engines.values():
        e.on_tick(tk)
    b = SG.BOOKS.get(urt.uid)
    if b:
        b.on_tick(tk)


async def settle(b, n=120):
    for i in range(n):
        await b._step()
        await asyncio.sleep(0.03)
        if not any(se.busy or not se.open for se in b.sess.values()) and not any(s.loading or not s.loaded for s in b.series.values()) and i > 3:
            await asyncio.sleep(0.05)
            if not any(se.busy for se in b.sess.values()):
                return True
    return False


CODE = '''//@version=6
strategy("Breakout test", overlay=true)
up = input.float(5610, "Buy above")
dn = input.float(5609, "Close below")
sh = input.float(5560, "Sell below")
if close > up
    strategy.entry("L", strategy.long)
if close < sh
    strategy.entry("S", strategy.short)
if close < dn and close > sh
    strategy.close("L")
strategy.exit("XL", from_entry="L", stop=close - 6)
strategy.exit("XS", from_entry="S", stop=close + 6)
plot(close - 8, "line stop")'''


def strat(**kw):
    s = {"name": "Breakout", "src": {"k": "pine", "name": "Breakout test", "code": CODE, "inputs": {}},
         "syms": [F], "tf": "5m", "side": "both", "accounts": [{"aid": "pA", "on": True}, {"aid": "pB", "on": False}],
         "size": {"mode": "pct", "v": 0.5}, "product": "MARGIN", "stop": {"k": "script", "follow": True},
         "target": {"k": "r", "r": 3}, "be": {"on": True, "r": 1.5}, "trail": {"on": False, "r": 2}, "lim": {}}
    s.update(kw)
    return s


async def main():
    loop = asyncio.get_running_loop()
    urt = FakeRT()
    urt.loop = loop
    b = SG.Book(urt)
    SG.BOOKS[urt.uid] = b
    b.loop = loop
    ids = {"pA", "pB", "live", "mt5-1"}

    # ---------------------------------------------------------------- the definition's checks
    try:
        SG.clean({**strat(), "src": {"code": "//@version=6\nindicator('x')\nplot(close)"}}, None, True, ids)
        check("an indicator script is refused", False)
    except CA.Bad as e:
        check("an indicator script is refused: " + str(e)[:60], "strategy" in str(e))
    for bad, what in ((strat(syms=[]), "no contracts"), (strat(syms=[F, "MT5:XAUUSD"]), "MT5 and Fyers mixed"),
                      (strat(accounts=[{"aid": "mt5-1", "on": True}]), "an MT5 account for a Fyers contract"),
                      (strat(accounts=[{"aid": "gone", "on": True}]), "an account that doesn't exist"),
                      (strat(stop={"k": "line"}), "Stop on a line without a plot")):
        try:
            SG.clean(bad, None, True, ids)
            check(f"refused: {what}", False)
        except CA.Bad as e:
            check(f"refused: {what} ({e})", True)
    try:
        SG.clean(strat(accounts=[{"aid": "live", "on": True}]), None, False, ids)
        check("a user who isn't the admin can't pick Live", False)
    except CA.Bad:
        check("a user who isn't the admin can't pick Live", True)
    s1 = SG.clean(strat(accounts=[{"aid": "live", "on": True}]), None, True, ids)
    check("switching Live on asks for a 2FA code", SG.needs_stepup(s1, None))
    s2 = SG.clean(strat(), None, True, ids)
    check("a strategy on paper accounts only doesn't", not SG.needs_stepup(s2, None))
    s3 = SG.clean({**strat(accounts=[{"aid": "live", "on": True}]), "id": s1["id"]}, s1, True, ids)
    check("saving it again, Live already on and the strategy off: no code needed", not SG.needs_stepup(s3, s1))

    # ---------------------------------------------------------------- live trading on bar closes (paper accounts)
    hist()
    price(urt, 5600, T0 + 5)
    s, old, step = b.upsert(strat(), True)
    b.commit(s, old)
    b.action(s["id"], "on", True)
    check("switched on", b.get(s["id"])["status"] == "on")
    check("its contract is watched for live prices", F in b.symbols())
    await settle(b)
    A, B_ = urt.engines["pA"], urt.engines["pB"]
    check("history isn't traded (nothing opened at the start)", not A.positions and not B_.positions)

    BAR = [T0]

    async def close_bar(px):
        """The current bar's last price is px; the next bar opens at px (its first tick closes this one)."""
        price(urt, px, BAR[0] + 60)
        BAR[0] += 300
        price(urt, px, BAR[0] + 3)
        await settle(b)

    def logs(n=4):
        return " | ".join(e["msg"] for e in b.read_log(n))

    def mine():
        return [p for p in A.positions if (p.get("strat") or {}).get("id") == s["id"]]

    # 10:00 closes at 5612 (> 5610): BUY at the next bar's open (the ask, 5613); the script's stop: close - 6 = 5606
    await close_bar(5612)
    pa = mine()
    check("the bar's close BUY opened a trade on the switched-on account", len(pa) == 1, logs())
    check("...and nothing on the account switched off", not B_.positions)
    if pa:
        p = pa[0]
        check(f"tagged with the strategy (eid {p['strat'].get('eid')})", p["strat"]["name"] == "Breakout" and p["strat"]["eid"] == "L")
        check(f"the script's stop: close - 6 = {p['sl']}", abs(p["sl"] - 5606) < 0.51)
        R = p["init_risk"]
        n = charges.net_at(A.row(F, "MARGIN"), 1, p["qty"], p["avg"], p["tp"])["net"]
        check(f"Target 3R net of charges: TP {p['tp']} pays {n:.0f} for {R:.0f} risk", 2.95 <= n / R <= 3.2)
        check(f"sized by 0.5% risk: risk ₹{R:,.0f} within ₹5,000", 0 < R <= 5000)
        check("its own BE at 1.5R (set on this trade), trail off", p["tr"]["be_on"] and p["tr"]["be_r"] == 1.5 and not p["tr"]["sl_on"]
              and p["tr"].get("own_be"))
    check("the log says what it did", any(e["kind"] == "open" and "BUY" in e["msg"] for e in b.read_log(10)))

    await close_bar(5619)                                  # the script's stop: 5613 -> followed up
    check(f"the script's stop followed, only tighter: {pa and pa[0]['sl']}", pa and abs(pa[0]["sl"] - 5613) < 0.51)
    await close_bar(5617)                                  # the script's would be 5611: not followed down
    check(f"a lower script stop isn't followed (still {pa and pa[0]['sl']})", pa and abs(pa[0]["sl"] - 5613) < 0.51)
    await close_bar(5616)                                  # still above 5610: another BUY entry - already long, nothing
    check("a BUY signal while long changes nothing (one trade per contract)", len(mine()) == 1, logs())
    for q in mine():
        A.close(q, A.exit_mark(q), "test")

    # strategy.close: a new long with the stop not followed, then a bar closing under 5609
    b.get(s["id"])["stop"]["follow"] = False
    s_ = b.get(s["id"])
    await close_bar(5612)
    check("a second BUY signal opened another trade", len(mine()) == 1, logs())
    await close_bar(5610)                                  # 5610: not above 5610, not under 5609: nothing
    check("a bar closing at 5610 is no signal (still open)", len(mine()) == 1, logs())
    await close_bar(5608)                                  # < 5609: strategy.close("L") (the stop 5606 isn't reached)
    check("strategy.close closed the trade", not mine(), logs())
    check(f"...with the strategy as the reason ({A.history[-1].get('reason') if A.history else ''})",
          A.history and "strategy" in (A.history[-1].get("reason") or ""))
    rec = A.history[-1] if A.history else {}
    check("History: the record has the strategy's tag", (rec.get("strat") or {}).get("id") == s["id"], str(rec.get("strat")))
    t_ = b.today(b.get(s["id"]))
    check(f"Today per account: {t_['pA']['trades']} trades, {t_['pA']['closed']} closed, net {t_['pA']['net']}",
          t_["pA"]["trades"] == 2 and t_["pA"]["closed"] == 2)

    # Long only: a SELL signal opens nothing; Both: a short; a BUY signal then reverses it
    s_["side"] = "long"
    await close_bar(5555)
    check("Long only: a SELL signal opens nothing", not mine(), logs())
    s_["side"] = "both"
    s_["stop"] = {"k": "points", "n": 100, "len": 14, "line": "", "buf": 0, "follow": False}   # (wide: the jump below mustn't hit it)
    s_["size"] = {"mode": "lots", "v": 1}
    await close_bar(5556)                                  # (5556 < 5560: SELL again)
    sh = [p for p in mine() if p["side"] < 0]
    check("Both: the SELL signal opened a short", len(sh) == 1, logs())
    await close_bar(5558)                                  # (the short's stop 5562 isn't reached; 5558 < 5560: SELL again, already short)
    await close_bar(5612)                                  # a jump: BUY - the short is closed first, then a long (its stop 5606 isn't hit at 5612)
    lg = mine()
    check("a BUY signal reverses the short: closed, then a long", len(lg) == 1 and lg[0]["side"] > 0
          and any("reversed" in e["msg"] for e in b.read_log(4)), logs())
    for q in mine():
        A.close(q, A.exit_mark(q), "test")
    s_["size"] = {"mode": "pct", "v": 0.5}

    # the strategy's limits
    s_["lim"]["max_day"] = b._count(s["id"], "pA", A.trading_day())
    await close_bar(5612)
    check(f"trades a day ({s_['lim']['max_day']} taken): refused", not mine() and "trades today reached" in logs(2), logs(2))
    s_["lim"]["max_day"] = 0
    s_["lim"]["from"], s_["lim"]["to"] = "14:00", "15:00"
    await close_bar(5613)
    check("outside its trading hours: refused", not mine() and "trading hours" in logs(2), logs(2))
    s_["lim"]["from"] = s_["lim"]["to"] = ""
    lost = sum(h["net"] for h in A.history if (h.get("strat") or {}).get("id") == s["id"])
    s_["lim"]["loss_day"], s_["lim"]["loss_unit"] = max(1, -lost - 1), "amt"
    await close_bar(5612)
    check(f"its daily loss limit (lost ₹{-lost:,.0f} today, limit ₹{s_['lim']['loss_day']:,.0f}): refused", not mine() and "daily loss" in logs(2), logs(2))
    s_["lim"]["loss_day"] = 0
    s_["lim"]["max_open"] = 1
    A.L = {"halted": True}
    await close_bar(5613)
    check("the kill switch: refused", not mine() and "kill switch" in logs(2), logs(2))
    del A.L

    # stop sources: points (with a 2-tick buffer)
    s_["stop"] = {"k": "points", "n": 10, "len": 14, "line": "", "buf": 2, "follow": False}
    await close_bar(5612)
    p = mine()[0] if mine() else None
    check(f"Stop: 10 points + 2 ticks from the fill ({p and p['avg']}): {p and p['sl']}", p and abs((p["avg"] - p["sl"]) - 12) < 1.01, logs(2))
    await close_bar(5614)
    check("max open at once (1, already open): a second contract's signal would be refused; this one is the same trade", len(mine()) == 1)
    for q in mine():
        A.close(q, A.exit_mark(q), "test")
    out = {"times": [1, 2], "bars": {"high": [10, 12, 11, 13, 12] * 4, "low": [8, 9, 7, 10, 9] * 4, "close": [9, 11, 10, 12, 11] * 4},
           "plots": {"line stop": [None] * 19 + [95.0]}}
    a = SG.atr(out["bars"]["high"], out["bars"]["low"], out["bars"]["close"], 14)
    sp, _ = SG.stop_for({"stop": {"k": "atr", "n": 2, "len": 14, "buf": 0}}, 1, 100.0, 19, out["bars"], {}, None, 0.05)
    check(f"Stop: ATR 14 × 2 ({a:.3f}) under 100: {sp}", sp is not None and abs(sp - (100 - 2 * a)) < 0.06)
    sp, _ = SG.stop_for({"stop": {"k": "swing", "n": 0, "len": 5, "buf": 0}}, 1, 100.0, 19, out["bars"], {}, None, 0.05)
    check(f"Stop: the last 5 bars' low: {sp}", sp == 7)
    sp, _ = SG.stop_for({"stop": {"k": "line", "line": "line stop", "buf": 0}}, 1, 100.0, 19, out["bars"], out["plots"], None, 0.05)
    check(f"Stop: a Pine line's value on the bar: {sp}", sp == 95)
    sp, why = SG.stop_for({"stop": {"k": "points", "n": 5, "buf": 0}}, -1, 100.0, 19, out["bars"], {}, None, 0.05)
    check(f"a short's points stop is above: {sp}", sp == 105)
    sp, why = SG.stop_for({"stop": {"k": "script", "buf": 0}}, 1, 100.0, 19, out["bars"], {}, {"stop": 101}, 0.05)
    check(f"a script stop on the wrong side is refused ({why})", sp is None and "wrong side" in why)

    # an error in the script switches the strategy off, with the reason
    s_bad, old, _ = b.upsert({**strat(name="Broken", accounts=[{"aid": "pA", "on": True}]),
                              "src": {"code": "//@version=6\nstrategy('b')\nx = nosuchfunction(close)\nplot(x)"}}, True)
    b.commit(s_bad, None)
    b.action(s_bad["id"], "on", True)
    await settle(b)
    sb = b.get(s_bad["id"])
    check(f"a script error switches it off and says why ({(sb['err'] or '')[:60]}…)", sb["status"] == "off" and "error" in (sb["err"] or ""))

    # ---------------------------------------------------------------- the tester
    import math
    rows = []
    for i in range(600):
        t = T0 - (600 - i) * 300
        c = 5600 + 30 * math.sin(i / 12)
        rows.append([t, c - 1, c + 2, c - 3, c, 100])
    ROWS[(F, "5")] = rows
    tcode = '''//@version=6
strategy("EMA cross", overlay=true)
f = ta.ema(close, 9)
s = ta.ema(close, 21)
if ta.crossover(f, s)
    strategy.entry("L", strategy.long)
if ta.crossunder(f, s)
    strategy.close("L")
strategy.exit("XL", from_entry="L", stop=low - 10)'''
    ts = strat(name="EMA", src={"k": "pine", "code": tcode, "inputs": {}}, side="long", stop={"k": "script"},
               target={"k": "none"}, be={"on": False}, trail={"on": False})
    res = await b.test(ts, True, F, 30, 1000000)
    st = res["st"]
    check(f"tester: {st['n']} trades on {res['bars']} bars, net ₹{st['net']:,.0f}, win {st['win_rate']}%", st["n"] >= 5)
    tr = res["trades"]
    check("each trade enters at the next bar's open after the signal bar", all(x["in_t"] > 0 for x in tr))
    check("closed by the script (strategy.close) or the stop", all(x["why"] in ("the script closed it", "sl", "still open (valued at the last close)") for x in tr),
          str({x["why"] for x in tr}))
    tot = round(sum(x["net"] for x in tr), 2)
    check(f"net = the trades' sum ({tot})", abs(tot - st["net"]) < 0.05)
    check(f"charges counted: ₹{st['charges']:,.0f}", st["charges"] > 0)
    x0 = tr[0]
    row = A.row(F, "MARGIN")
    n0 = charges.net_at(row, 1, x0["lots"] * (row.get("lot") or 1), x0["in"], x0["out"])["net"]
    check(f"a trade's net is the paper engine's own (net_at): {x0['net']} = {n0}", abs(x0["net"] - n0) < 0.02)
    check(f"R per trade from the net 1R (first {x0['r']})", x0["r"] is not None)
    check("the equity curve ends at the final balance", abs(res["curve"][-1][1] - st["end"]) < 0.05)
    check(f"months: {len(res['months'])}", len(res["months"]) >= 1)
    ts2 = {**ts, "target": {"k": "r", "r": 1}, "lim": {"max_day": 1}}
    res2 = await b.test(ts2, True, F, 30, 1000000)
    days = {}
    for x in res2["trades"]:
        k = dt.datetime.fromtimestamp(x["in_t"], dt.timezone.utc).date()
        days[k] = days.get(k, 0) + 1
    check(f"tester: Target 1R closes some at the target; 1 trade a day kept ({max(days.values()) if days else 0})",
          any(x["why"] == "tp" for x in res2["trades"]) and (max(days.values()) if days else 0) <= 1)
    try:
        await b.test({**ts, "src": {"code": "//@version=6\nstrategy('b')\nx = nosuch(close)"}}, True, F, 30, None)
        check("tester: a broken script says why", False)
    except CA.Bad as e:
        check(f"tester: a broken script says why ({str(e)[:50]}…)", "error" in str(e))

    # ---------------------------------------------------------------- the journal's set-up tag
    from helper import journal
    j = journal.Journal("S")
    j.upsert_open("pA", "Paper A", "paper", 1000000, {"id": "P1", "s": F, "side": 1, "qty": 100, "avg": 5600, "opened": CLOCK[0],
                                                     "entries": [], "strat": {"id": "x", "name": "Breakout"}}, "2026-11-12")
    t = next(iter(j.d["trades"].values()))
    check(f"journal: the strategy's name as a set-up tag ({t.get('setup')})", t.get("strategy") == "Breakout" and "Breakout" in t.get("setup"))

    b.stop()
    CA.RUNNER.stop()


asyncio.run(main())
print(f"\n{OK} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
