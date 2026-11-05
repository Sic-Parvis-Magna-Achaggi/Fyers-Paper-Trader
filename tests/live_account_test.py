"""The Live account is the Fyers account (roadmap 16, v0.33.0), against the fake Fyers order API. No browser, no Fyers.
Run: python3 tests/live_account_test.py      (about 2 minutes; PASS / FAIL per check, exit 1 on any failure)

Covers: the balance, margin and free funds from Fyers' funds (both ledgers); money in / out never a profit or a loss
(the account size, today's start and the peak move by it); the daily loss from Fyers' start of the day; trades placed
straight in Fyers (opened, added to, part closed, closed, past flat) from the order updates; a pending order placed in
Fyers shown, moved and cancelled from the app, and its fill; a stop placed in Fyers adopted as the trade's stop (its own
type kept: SL-M stays SL-M; trailing moves that same order; never two exit orders); no stop: the flag, then the first
stop (1R) placed at Fyers only on request; the position book as the fallback (and the first read of an account that
already has trades, orders and a stop at Fyers, nothing replayed twice); delivery holdings (adopted, never squared off,
kept by Close all and the kill switch, a refused sell from the demat shown); rt.py: the Live account made once, named by
the client ID, the old "paper switched to Live" accounts back to Paper with their trades archived."""
import asyncio
import datetime as dt
import json
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
D = "/tmp/fyers_live_acct_test"
shutil.rmtree(D, ignore_errors=True)
os.makedirs(D)
for f in os.listdir(HERE + "/fixtures"):
    shutil.copy(HERE + "/fixtures/" + f, D)
os.environ["FYERS_HELPER_DATA"] = D
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import logging  # noqa: E402
logging.basicConfig(level=logging.WARNING, format="%(message)s")
from helper import alerts, live, paper, rt, store, symbols, users  # noqa: E402
from helper.broker import norm_order  # noqa: E402
from helper.live import LiveEngine  # noqa: E402
from helper.paper import IST, Refused  # noqa: E402
from fake_broker import FakeBroker  # noqa: E402

symbols.refresh()
T = [dt.datetime(2026, 11, 2, 11, 0, tzinfo=IST)]            # a Monday, 11:00 IST
fake_ist = lambda ts=None: dt.datetime.fromtimestamp(ts, IST) if ts else T[0]
paper.ist = fake_ist
live.ist = fake_ist
live.FYSYNC_SEC = 2                                           # (the position book every 2 s here, not 30)
live.FILL_LAG_SEC = 2                                         # (and its lag after a fill: 2 s here, not 60)

CRUDE, NIFTY, OPT, STK = "MCX:CRUDEOIL26NOVFUT", "NSE:NIFTY26NOVFUT", "MCX:CRUDEOIL26NOV5600CE", "NSE:RELIANCE-EQ"
TICK = {CRUDE: 1.0, NIFTY: 0.1, OPT: 0.1, STK: 0.1}
FAILS = []
ENGINES = []


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  <- {detail}"))
    if not ok:
        FAILS.append(name)


class Link:
    def __init__(self):
        self.tok = "tok"
        self._profile = {"data": {"fy_id": "XT0001"}}

    def token(self):
        return self.tok

    def margin(self, *a, **k):
        return 0.0


class Stream:
    up = True


def make(folder, fb, start=True):
    e = LiveEngine(folder, Link(), "XT0001", broker=fb, client_id="XT0001")
    e.stream = Stream()
    e.rules.update(risk_cap_pct=0, max_margin_pct=0, daily_pct=0, max_pct=0, max_open_risk_pct=0, live_chase_sec=0.4,
                   sl_required=True)
    loop = asyncio.get_running_loop()
    fb.emit = lambda row: loop.call_soon_threadsafe(e.on_update, norm_order(row))
    e._apply_funds(fb.funds())                           # (as switching to Live does before the page shows it)
    if start:
        e.start(loop)
    ENGINES.append(e)
    return e


def tick(e, fb, s, ltp, bid=None, ask=None):
    t = TICK[s]
    bid = round(ltp - t, 2) if bid is None else bid
    ask = round(ltp + t, 2) if ask is None else ask
    fb.set_price(s, ltp, bid, ask)
    e.on_tick({"s": s, "ltp": ltp, "bid": bid, "ask": ask, "t": int(time.time())})


async def wait(sec=0.8):
    await asyncio.sleep(sec)


async def settle(e, sec=4.0):
    """Let the worker read the position book a few times (housekeeping schedules it)."""
    end = time.time() + sec
    while time.time() < end:
        e.housekeeping()
        await asyncio.sleep(0.5)


def pos_of(e, s, prod=None):
    return next((p for p in e.positions if p["s"] == s and (prod is None or p["product"] == prod)), None)


def exits_at_fyers(fb, s):
    q = sum(v for (sym, _), v in fb.net.items() if sym == s)
    return [o for o in fb.open_orders(s) if q and o["side"] == (-1 if q > 0 else 1)]


async def main():
    # ------------------------------------------------------------------ 1. money from Fyers' funds
    fb = FakeBroker()
    fb.fund["eq"].update(start=200000.0, used=0.0)
    fb.fund["co"].update(start=50000.0)
    e = make("m1/", fb)
    e.rules.update(daily_pct=3.0, max_pct=10.0, buffer_pct=0.5)
    await wait(1.5)
    check("balance = Fyers' start of the day over both ledgers", e.balance() == 250000.0, e.balance())
    check("the account size for the % rules comes from Fyers (no typed capital)", e.acct.get("size") == 250000.0 and e.rules["size"] == 250000.0,
          (e.acct.get("size"), e.rules["size"]))
    check("today's start (the daily loss's base) is Fyers' own", e.day.get("start_bal") == 250000.0 and e.day.get("fy") == "2026-11-02", e.day)
    f0 = e.floors()
    check("daily floor = start - 3% of the size", abs(f0["daily"] - (250000 - 7500)) < 0.01, f0)
    tick(e, fb, CRUDE, 5600)
    tick(e, fb, NIFTY, 24000)
    fb.fund["co"]["used"] = 52000.0
    fb.fund["eq"]["used"] = 10000.0
    await e._a_funds()
    check("margin in use = Fyers' utilized amount", e.margin_used() == 62000.0, e.margin_used())
    check("free margin for MCX = the commodity ledger's available", e.free_margin(symbols.get(CRUDE)) == round(50000 - 52000, 2),
          e.free_margin(symbols.get(CRUDE)))
    check("free margin for NSE = the capital ledger's available", e.free_margin(symbols.get(NIFTY)) == 190000.0, e.free_margin(symbols.get(NIFTY)))
    fb.fund["co"].update(start=0.0, used=0.0)
    await e._a_funds()
    check("one ledger for both (commodity empty): MCX uses the capital ledger", e.free_margin(symbols.get(CRUDE)) == 190000.0 - 0,
          e.free_margin(symbols.get(CRUDE)))
    fb.fund["co"]["start"] = 50000.0
    await e._a_funds()
    # a deposit: never a profit
    peak0, size0 = e.acct["peak"], e.acct["size"]
    fb.fund["eq"]["transfer"] = 20000.0
    await e._a_funds()
    f1 = e.floors()
    check("money in: the balance goes up by it", e.balance() == 270000.0, e.balance())
    check("money in: the account size and the peak move by it (not a profit)", e.acct["size"] == size0 + 20000 and e.acct["peak"] == peak0 + 20000,
          (e.acct["size"], e.acct["peak"]))
    check("money in: today's start moves by it, so the daily loss room is unchanged by the deposit",
          abs((e.balance() - f1["daily"]) - (250000 - f0["daily"]) - 20000 * 0.03) < 0.01, (e.balance() - f1["daily"], 250000 - f0["daily"]))
    snap = e.snapshot()
    check("no P&L from the deposit (realized today 0, net today 0)", snap["acct"]["realized_today"] == 0 and snap["fyfunds"]["net_today"] == 0,
          (snap["acct"]["realized_today"], snap["fyfunds"]))
    fb.fund["eq"]["transfer"] = 5000.0                                 # 15,000 taken out again
    await e._a_funds()
    check("money out: size and peak move down by it, no loss counted", e.acct["size"] == size0 + 5000 and e.acct["peak"] == peak0 + 5000,
          (e.acct["size"], e.acct["peak"]))
    check("the snapshot carries Fyers' funds and the size", snap["fyfunds"]["start"] == 250000.0 and snap["acct"]["kind"] == "live", snap["fyfunds"])
    try:
        e.set_rules({"size": 1, "daily_pct": 2.0})
        ok = e.rules["size"] == e.acct["size"] and e.rules["daily_pct"] == 2.0
    except Refused as x:
        ok = str(x)
    check("rules can't set the Live account's size (it's Fyers')", ok is True, ok)
    try:
        e.reset(25000)
        ok = False
    except Refused:
        ok = True
    check("the Live account can't be reset", ok)
    # the next day: Fyers' start of day includes yesterday's money moved; nothing counted twice
    T[0] = dt.datetime(2026, 11, 3, 10, 0, tzinfo=IST)
    fb.fund["eq"].update(start=205000.0, transfer=0.0)
    await e._a_funds()
    check("next day: today's start from Fyers, size unchanged by the reset of Fund Transfer",
          e.day.get("start_bal") == 255000.0 and e.acct["size"] == size0 + 5000, (e.day, e.acct["size"]))
    T[0] = dt.datetime(2026, 11, 2, 11, 0, tzinfo=IST)

    e0 = LiveEngine("m1b/", Link(), "XT0001", broker=FakeBroker(), client_id="XT0001")
    e0.stream = Stream()
    e0.on_tick({"s": CRUDE, "ltp": 5600, "bid": 5599, "ask": 5601, "t": int(time.time())})
    pl = e0.plan({"s": CRUDE, "side": 1, "type": "market", "sl": 5580, "mode": "lots", "lots": 1, "product": "MARGIN"})
    check("no Fyers funds read yet: new orders wait (no made-up balance)", "Fyers funds" in (pl.get("blocked") or ""), pl.get("blocked"))

    # ------------------------------------------------------------------ 2. a market order placed in Fyers, no stop
    fb = FakeBroker()
    e = make("m2/", fb)
    tick(e, fb, NIFTY, 24000)
    await wait(1.5)
    fb.outside(NIFTY, 75, 1, product="INTRADAY")
    await wait(1.0)
    p = pos_of(e, NIFTY)
    check("a trade placed in Fyers is a position here at Fyers' price", p is not None and p["avg"] == 24000.1 and p["qty"] == 75, p)
    check("…marked as placed in Fyers, with no stop", p and p.get("outside") and p.get("sl") is None and not fb.open_orders(NIFTY), p)
    v = e.pos_view(p) if p else {}
    check("…flagged on the page (nostop) and in the live warnings", v.get("nostop") and any(k.startswith("nosl:") for k, _, _ in e.live_problems()),
          (v.get("nostop"), e.live_problems()))
    check("nothing is placed at Fyers without the tap", len(fb.book) == 1, list(fb.book.values()))
    # Place my stop: the first stop sets 1R and goes to Fyers
    e.modify_pos(p["id"], sl=23950.0)
    await wait(1.5)
    so = fb.open_orders(NIFTY)
    check("Place my stop: first_sl + 1R set, the stop-limit at Fyers", p["first_sl"] == 23950.0 and p["init_risk"] > 0 and len(so) == 1
          and so[0]["type"] == 4 and so[0]["stopPrice"] == 23950.0, (p["first_sl"], p["init_risk"], so))
    check("…the first stop doesn't count as your own stop (trailing can still move it)", not p.get("own_stop"), p.get("own_stop"))
    e.set_pos_trail(p["id"], {"sl_on": True, "sl_r": 1.0})
    sid = p["stop_oid"]
    for px in (24030, 24060, 24100):
        tick(e, fb, NIFTY, px)
        await wait(0.4)
    await wait(2.0)
    so = fb.open_orders(NIFTY)
    check("trailing moves that same Fyers order", len(so) == 1 and so[0]["id"] == sid and so[0]["stopPrice"] == p["sl"] and p["sl"] > 23950,
          (so, p["sl"]))
    # adds and part exits made in Fyers
    fb.outside(NIFTY, 75, 1, product="INTRADAY")
    await wait(2.5)
    so = fb.open_orders(NIFTY)
    check("added in Fyers: the position grows, its Fyers stop's quantity follows", p["qty"] == 150 and so and so[0]["qty"] == 150, (p["qty"], so))
    check("…entries: the add at Fyers' price", len(p["entries"]) == 2 and "Fyers" in p["entries"][1]["how"], p["entries"])
    fb.outside(NIFTY, 75, -1, product="INTRADAY")
    await wait(2.5)
    so = fb.open_orders(NIFTY)
    h = e.history[-1] if e.history else {}
    check("part closed in Fyers: recorded as its own part, the rest stays with its stop", p["qty"] == 75 and h.get("reason") == "closed in Fyers"
          and h.get("qty") == 75 and h.get("src") == "fyers" and so and so[0]["qty"] == 75, (p["qty"], h, so))
    check("never two exit orders at Fyers", not fb.violations, fb.violations)
    fb.outside(NIFTY, 75, -1, product="INTRADAY")
    await wait(2.5)
    check("closed in Fyers: the position is gone and its app stop is cancelled", pos_of(e, NIFTY) is None and not fb.open_orders(NIFTY),
          (e.positions, fb.open_orders(NIFTY)))
    # past flat: a sell larger than the position
    fb.outside(NIFTY, 75, 1, product="INTRADAY")
    await wait(1.0)
    fb.outside(NIFTY, 150, -1, product="INTRADAY")
    await wait(1.5)
    p = pos_of(e, NIFTY)
    check("sold past flat in Fyers: closed, then a short of the rest", p and p["side"] == -1 and p["qty"] == 75, p)

    # ------------------------------------------------------------------ 3. a stop placed in Fyers is adopted (SL-M stays SL-M)
    fb = FakeBroker()
    e = make("m3/", fb)
    tick(e, fb, NIFTY, 24000)
    await wait(1.5)
    fb.outside(NIFTY, 75, 1, product="MARGIN")
    await wait(1.0)
    stop_id = fb.outside(NIFTY, 75, -1, typ=3, product="MARGIN", stop=23940.0)
    await wait(1.5)
    p = pos_of(e, NIFTY)
    check("a stop placed in Fyers becomes the trade's stop (1R from it)", p and p.get("stop_oid") == stop_id and p["sl"] == 23940.0
          and p["first_sl"] == 23940.0 and p["init_risk"] > 0 and p.get("stop_type") == 3, p)
    check("…it isn't shown as a separate order, and no app stop is added", not e.orders and len(fb.open_orders(NIFTY)) == 1, (e.orders, fb.open_orders(NIFTY)))
    e.set_pos_trail(p["id"], {"sl_on": True, "sl_r": 1.0})
    for px in (24070, 24130):
        tick(e, fb, NIFTY, px)
        await wait(0.5)
    await wait(2.5)
    so = fb.open_orders(NIFTY)
    check("trailing moves the adopted order itself, keeping its type (SL-M)", len(so) == 1 and so[0]["id"] == stop_id and so[0]["type"] == 3
          and so[0]["stopPrice"] == p["sl"] and p["sl"] > 23940, (so, p["sl"]))
    # the server's bid / ask rule: NSE turns that stop into the market exit (one exit order)
    tick(e, fb, NIFTY, p["sl"] + 0.2, bid=p["sl"], ask=p["sl"] + 0.3)
    await wait(2.5)
    check("the server's rule closes it through the adopted stop (never two exits)", pos_of(e, NIFTY) is None and not fb.violations
          and not any(fb.net.values()), (e.positions, fb.violations, fb.net))
    # a stop that showed up as an order before its position (the position book first read)
    fb.net[(CRUDE, "MARGIN")] = 0

    # ------------------------------------------------------------------ 4. a pending order placed in Fyers
    fb = FakeBroker()
    e = make("m4/", fb)
    tick(e, fb, CRUDE, 5600)
    await wait(1.5)
    lid_f = fb.outside(CRUDE, 1, 1, typ=1, product="MARGIN", limit=5550.0)
    await wait(1.0)
    o = next((x for x in e.orders if x.get("oid") == lid_f), None)
    check("a limit placed in Fyers shows as an order here, marked", o and o.get("outside") and o["type"] == "limit" and o["price"] == 5550.0
          and o["lots"] == 1, e.orders)
    e.modify_order(o["id"], price=5560.0, sl=5530.0)
    await wait(1.5)
    check("moved from the app: the Fyers order moves", fb.book[lid_f]["limitPrice"] == 5560.0 and fb.book[lid_f]["type"] == 1, fb.book[lid_f])
    tick(e, fb, CRUDE, 5560, bid=5559, ask=5560)
    await wait(2.5)
    p = pos_of(e, CRUDE)
    check("it fills: the position opens with the stop you gave it, placed at Fyers", p and p["avg"] == 5560 and p["sl"] == 5530.0
          and p.get("stop_oid") and not e.orders, (p, e.orders))
    lid2 = fb.outside(CRUDE, 1, 1, typ=4, product="MARGIN", stop=5620.0, limit=5625.0)
    await wait(1.0)
    o2 = next((x for x in e.orders if x.get("oid") == lid2), None)
    check("a stop entry placed in Fyers shows as an order", o2 and o2["type"] == "stop" and o2["price"] == 5620.0, e.orders)
    e.modify_order(o2["id"], price=5630.0)
    await wait(1.5)
    check("…moved: trigger and its own limit gap kept (MCX, same type)", fb.book[lid2]["stopPrice"] == 5630.0 and fb.book[lid2]["limitPrice"] == 5635.0
          and fb.book[lid2]["type"] == 4, fb.book[lid2])
    e.cancel(o2["id"])
    await wait(1.5)
    check("cancelled from the app: cancelled at Fyers and gone here", fb.book[lid2]["status"] == 1 and not any(x["id"] == o2["id"] for x in e.orders),
          (fb.book[lid2]["status"], e.orders))

    # ------------------------------------------------------------------ 5. the position book: fallback, and an account that already has trades
    fb = FakeBroker()
    fb.socket = False                                                 # nothing pushed: only the books
    fb.set_price(CRUDE, 5600, 5599, 5601)
    fb.set_price(NIFTY, 24000, 23999.9, 24000.1)
    fb.outside(CRUDE, 2, 1, product="MARGIN")                         # filled before the Live account existed
    st0 = fb.outside(CRUDE, 2, -1, typ=4, product="MARGIN", stop=5570.0, limit=5560.0)     # its stop, placed in Fyers
    done0 = fb.outside(NIFTY, 75, 1, product="INTRADAY")
    fb.outside(NIFTY, 75, -1, product="INTRADAY")                     # a round trip earlier today: history, not replayed
    e = make("m5/", fb)
    tick(e, fb, CRUDE, 5600)
    tick(e, fb, NIFTY, 24000)
    await settle(e, 9.0)
    p = pos_of(e, CRUDE)
    check("first read: the position at Fyers is adopted at Fyers' average", p and p["qty"] == 2 and p["avg"] == 5601 and p.get("outside"), e.positions)
    check("…and its stop placed in Fyers is that trade's stop", p and p.get("stop_oid") == st0 and p["sl"] == 5570.0 and not e.orders, (p, e.orders))
    check("…the earlier round trip isn't replayed (no NIFTY position, no extra history)", pos_of(e, NIFTY) is None and not e.history
          and done0 in e.L["done"], (e.positions, e.history))
    # outside trades the order updates missed: seen in the position book twice, then booked
    fb.net[(CRUDE, "MARGIN")] += 1                                    # added in Fyers: only the position book shows it
    fb.avg[(CRUDE, "MARGIN")] = (5601 * 2 + 5610) / 3
    await settle(e, 9.0)
    check("an add seen only in the position book: booked (after two reads) at the price it implies, stop quantity follows",
          p["qty"] == 3 and fb.book[st0]["qty"] == 3 and p["entries"][-1]["price"] == 5610, (p["qty"], p["entries"][-1:], fb.book[st0]))
    fb.outside(CRUDE, 1, 1, product="MARGIN")                         # an add with an order: booked from the order book, exactly
    await settle(e, 9.0)
    check("an add placed in Fyers, its update missed: booked once, from the order book (Fyers' price)",
          p["qty"] == 4 and p["entries"][-1]["price"] == 5601 and fb.book[st0]["qty"] == 4, (p["qty"], p["entries"][-1:]))
    fb.outside(CRUDE, 4, -1, product="MARGIN")
    await settle(e, 9.0)
    check("closed in Fyers, seen only in the books: recorded (an estimate) and the stop cancelled",
          pos_of(e, CRUDE) is None and e.history and e.history[-1]["reason"] == "closed in Fyers" and not fb.open_orders(CRUDE),
          (e.positions, e.history[-1:], fb.open_orders(CRUDE)))
    n_hist = len(e.history)
    e2 = make("m5/", fb)                                              # a restart: nothing booked twice
    ENGINES.remove(e)
    e.stop()
    await settle(e2, 6.0)
    check("after a restart nothing is booked twice", len(e2.history) == n_hist and not e2.positions, (len(e2.history), e2.positions))

    # ------------------------------------------------------------------ 6. delivery holdings
    fb = FakeBroker()
    fb.hold = [{"symbol": STK, "quantity": 10, "remainingQuantity": 10, "costPrice": 2800.0, "holdingType": "HLD", "qty_t1": 0}]
    fb.set_price(STK, 2900, 2899.9, 2900.1)
    fb.edis = False
    e = make("m6/", fb)
    tick(e, fb, STK, 2900)
    tick(e, fb, NIFTY, 24000)
    await settle(e, 7.0)
    p = pos_of(e, STK, "CNC")
    check("a holding in the demat is a Live trade at its cost price", p and p["qty"] == 10 and p["avg"] == 2800.0 and p.get("holding")
          and p["product"] == "CNC", e.positions)
    v = e.pos_view(p) if p else {}
    check("…its P&L is net of all charges (delivery sell charges incl. the DP charge)", v and v["net"] < (2899.9 - 2800) * 10 and v["exit_charges"] > 0, v)
    probs = [k for k, _, _ in e.live_problems()]
    check("holdings with no stop: one combined note (not one alert each)", "nosl_hold" in probs and not any(k.startswith("nosl:") for k in probs), probs)
    check("…and the watchdog doesn't count a holding without a stop as a live trade to watch", not alerts.watched(e) and not alerts.live_now(),
          alerts.watched(e))
    T[0] = T[0].replace(hour=15, minute=20)
    e.housekeeping()
    await wait(1.0)
    check("never squared off (delivery)", pos_of(e, STK, "CNC") is not None and not p.get("exiting"), p)
    T[0] = T[0].replace(hour=11, minute=0)
    fb.outside(NIFTY, 75, 1, product="INTRADAY")
    await wait(1.5)
    e.close_all()
    await wait(2.5)
    check("Close all: the holding is kept, the rest closed", pos_of(e, STK, "CNC") and not p.get("exiting") and pos_of(e, NIFTY) is None,
          (e.positions,))
    e.modify_pos(p["id"], sl=2850.0)
    await wait(2.0)
    check("Place my stop on a holding without DDPI / eDIS: Fyers' reason shows on it", p.get("stop_state") == "failed"
          and "eDIS" in (p.get("stop_err") or ""), (p.get("stop_state"), p.get("stop_err")))
    fb.edis = True
    e.enqueue(("sync", p["id"]), 2)
    await wait(2.0)
    so = fb.open_orders(STK)
    check("…with authorisation: its stop is at Fyers (a CNC sell stop)", so and so[0]["productType"] == "CNC" and so[0]["side"] == -1, so)
    check("…a holding with a stop is watched like any live trade", [x["id"] for x in alerts.watched(e)] == [p["id"]], alerts.watched(e))
    fb.outside(NIFTY, 75, 1, product="INTRADAY")
    await wait(1.5)
    e.kill()
    await wait(8.0)
    check("kill switch: everything else closed, the holding kept with its stop", pos_of(e, STK, "CNC") and fb.open_orders(STK)
          and pos_of(e, NIFTY) is None and not fb.net.get((NIFTY, "INTRADAY")), (e.positions, fb.open_orders(STK), fb.net))
    e.resume()

    # ------------------------------------------------------------------ 7. rt.py: the Live account, old Live accounts
    users.get = lambda uid: {"username": "admin", "role": "admin"} if uid == "adm" else {"username": uid, "role": "user"}
    users.audit = lambda *a, **k: None
    fb7 = FakeBroker()
    rt.make_broker = lambda link: fb7

    class FS:
        up = True
        on_connect = None

        def __init__(self, *a):
            pass

        def stop(self):
            pass
    rt.make_stream = lambda link, on_order, label: FS()
    # an account switched Live under the old design, with a live trade in its history and a stale position
    store.save("u/adm/accounts.json", {"accounts": [{"id": "a1111", "name": "Main", "mode": "paper", "capital": 25000, "created": 1},
                                                   {"id": "a2222", "name": "Real", "mode": "live", "capital": 100000, "created": 1}]})
    store.save("u/adm/a/a2222/paper.json", {"acct": {"start": 100000, "realized": -500, "peak": 100000}, "positions": [{"id": "P1", "s": CRUDE}],
                                           "orders": [], "live": {"oids": {"1": ["stop", "P1"]}}})
    store.save("u/adm/a/a2222/paper_trades.json", [{"id": "P0", "s": CRUDE, "net": -500, "closed": 1}])
    r = rt.UserRT("adm")
    accts = {a["id"]: a for a in r.accounts()}
    check("old Live account: back to Paper on the upgrade", accts["a2222"]["mode"] == "paper" and not isinstance(r.engines["a2222"], LiveEngine), accts)
    e_old = r.engines["a2222"]
    arch = [f for f in os.listdir(D + "/u/adm/a/a2222") if f.startswith("paper_trades_until_")]
    check("…its live trades archived, a fresh ledger, no live order ids left", arch and not e_old.history and not e_old.positions
          and e_old.balance() == 100000 and "live" not in json.load(open(D + "/u/adm/a/a2222/paper.json")), (arch, e_old.positions))
    check("no Live account until the admin switches to Live", r.live_engine() is None and rt.LIVE_ID not in r.engines)
    try:
        r.set_mode("a1111", "live")
        ok = False
    except Refused as x:
        ok = "switch" in str(x)
    check("paper accounts have no Live option", ok)
    a = r.ensure_live("xt0001")
    check("the Live account: made once, named by the client ID", a["id"] == rt.LIVE_ID and a["name"] == "XT0001"
          and isinstance(r.live_engine(), LiveEngine) and r.live_engine().client_id == "XT0001", a)
    a2 = r.ensure_live("XT0001")
    check("…switching to Live again doesn't make another", a2["id"] == rt.LIVE_ID and len([x for x in r.accounts() if x["id"] == rt.LIVE_ID]) == 1)
    try:
        r.ensure_live("XZ9999")
        ok = False
    except Refused:
        ok = True
    check("another Fyers client than the Live account's: refused", ok)
    for args in ({"name": "x"}, {"archived": True}):
        try:
            r.update_account(rt.LIVE_ID, **args)
            ok = False
        except Refused:
            ok = True
        check(f"the Live account can't be {'renamed' if 'name' in args else 'archived'}", ok)
    check("an unknown account id means the first paper account, never the Live one", r.engine("nope") is r.engines["a1111"])
    lst = r.account_list()
    check("the account list marks the Live account", any(x["id"] == rt.LIVE_ID and x["mode"] == "live" for x in lst)
          and all(x["mode"] == "paper" for x in lst if x["id"] != rt.LIVE_ID), lst)
    r.stop()
    # a user who isn't the admin never gets a Live engine, even with a live row in the file
    store.save("u/bob/accounts.json", {"accounts": [{"id": "a3333", "name": "P", "mode": "paper", "capital": 25000, "created": 1},
                                                   {"id": "live", "name": "X", "mode": "live", "kind": "live", "created": 1}]})
    rb = rt.UserRT("bob")
    check("not the admin: no Live engine", rb.live_engine() is None and "live" not in rb.engines)
    try:
        rb.ensure_live("XT0001")
        ok = False
    except Refused:
        ok = True
    check("not the admin: can't make one", ok)
    rb.stop()

    for x in ENGINES:
        x.stop()
    print()
    print("ALL PASSED" if not FAILS else f"{len(FAILS)} FAILED: " + "; ".join(FAILS))


asyncio.run(main())
sys.exit(1 if FAILS else 0)
