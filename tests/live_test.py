"""Live engine test against the fake Fyers order API (tests/fake_broker.py). No browser, no Fyers.
Run: python3 tests/live_test.py      (about a minute; prints PASS / FAIL per check and exits 1 on any failure)

Covers the agreed live design: entry fills from Fyers, a stop-limit at Fyers from the start, trailing / BE moving
that same order, the server's bid / ask rule turning the stop into a market exit (NSE) or cancel-then-market (MCX),
targets on the server, Fyers filling the stop by itself, restart recovery, overnight re-placement (and a position
closed while the app was down), refused changes, an unconfirmed placement, a stuck exit, a gap past the stop's limit,
square-off, kill switch, and never two exit orders at Fyers."""
import asyncio
import datetime as dt
import os
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
D = "/tmp/fyers_live_test"
shutil.rmtree(D, ignore_errors=True)
os.makedirs(D)
for f in os.listdir(HERE + "/fixtures"):
    shutil.copy(HERE + "/fixtures/" + f, D)
os.environ["FYERS_HELPER_DATA"] = D
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import logging  # noqa: E402
logging.basicConfig(level=logging.WARNING, format="%(message)s")
from helper import live, paper, symbols  # noqa: E402
from helper.broker import norm_order  # noqa: E402
from helper.live import LiveEngine  # noqa: E402
from helper.paper import IST, Refused  # noqa: E402
from fake_broker import FakeBroker  # noqa: E402

symbols.refresh()
T = [dt.datetime(2026, 11, 2, 11, 0, tzinfo=IST)]            # a Monday, 11:00 IST
fake_ist = lambda ts=None: dt.datetime.fromtimestamp(ts, IST) if ts else T[0]
paper.ist = fake_ist
live.ist = fake_ist

CRUDE, NIFTY, OPT = "MCX:CRUDEOIL26NOVFUT", "NSE:NIFTY26NOVFUT", "MCX:CRUDEOIL26NOV5600CE"
TICK = {CRUDE: 1.0, NIFTY: 0.1, OPT: 0.1}
FAILS = []
ENGINES = []                       # kept referenced, as the app does (rt.engines)


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  <- {detail}"))
    if not ok:
        FAILS.append(name)


class Link:
    def __init__(self):
        self.tok = "tok"

    def token(self):
        return self.tok

    def margin(self, *a, **k):
        return 0.0


class Stream:
    up = True


def make(folder, fb, link=None):
    e = LiveEngine(folder, link or Link(), "test", broker=fb)
    e.stream = Stream()
    e.rules.update(size=1000000, risk_cap_pct=0, max_margin_pct=0, daily_pct=0, max_pct=0, max_open_risk_pct=0,
                   live_chase_sec=0.4, sq_before_min=5)
    e.acct.update(start=1000000, peak=1000000)
    loop = asyncio.get_running_loop()
    fb.emit = lambda row: loop.call_soon_threadsafe(e.on_update, norm_order(row))
    e.start(loop)
    ENGINES.append(e)
    return e


def tick(e, fb, s, ltp, bid=None, ask=None, engine=True):
    t = TICK[s]
    bid = round(ltp - t, 2) if bid is None else bid
    ask = round(ltp + t, 2) if ask is None else ask
    fb.set_price(s, ltp, bid, ask)
    if engine:
        e.on_tick({"s": s, "ltp": ltp, "bid": bid, "ask": ask, "t": int(time.time())})


async def wait(sec=0.8):
    await asyncio.sleep(sec)


def pos_of(e, s):
    return next((p for p in e.positions if p["s"] == s), None)


def no_doubles(fb, name):
    check(name + ": never two exit orders at Fyers", not fb.violations, fb.violations)


async def buy(e, s, sl, tp=None, side=1, product="MARGIN", typ="market", price=None):
    e.place({"s": s, "side": side, "type": typ, "price": price, "sl": sl, "tp": tp, "mode": "lots", "lots": 1, "product": product})
    await wait(1.0)


async def main():
    # ------------------------------------------------------------------ 1. MCX long: entry, stop, trail, BE, server exit
    fb = FakeBroker()
    e = make("t1/", fb)
    tick(e, fb, CRUDE, 5600)
    await buy(e, CRUDE, sl=5580)
    p = pos_of(e, CRUDE)
    check("entry fills from Fyers at the ask", p is not None and p["avg"] == 5601, p and p["avg"])
    so = fb.open_orders(CRUDE)
    check("a stop-limit sell sits at Fyers from the start", len(so) == 1 and so[0]["type"] == 4 and so[0]["side"] == -1
          and so[0]["stopPrice"] == 5580 and so[0]["limitPrice"] < 5580, so)
    check("the stop's limit is past the trigger by the slack (0.5% = 28 ticks)", so and so[0]["limitPrice"] == 5552, so and so[0]["limitPrice"])
    sid = p["stop_oid"]
    e.set_pos_trail(p["id"], {"sl_on": True, "sl_r": 1.0})
    for px in (5610, 5625, 5640):
        tick(e, fb, CRUDE, px)
        await wait(0.3)
    await wait(2.0)
    so = fb.open_orders(CRUDE)
    check("trailing moved the SAME Fyers order (no new order)", len(so) == 1 and so[0]["id"] == sid and p["stop_oid"] == sid, so)
    check("the Fyers stop follows the trail (never below BE)", so and so[0]["stopPrice"] == p["sl"] and p["sl"] >= e._be_price(p), (so and so[0]["stopPrice"], p["sl"]))
    mods = [t for t, w, i in fb.calls if w == "modify" and i == sid]
    gaps = [b - a for a, b in zip(mods, mods[1:])]
    check("stop changes are paced (>= 1.5 s apart)", all(g >= 1.45 for g in gaps), gaps)
    old_sl = p["sl"]
    tick(e, fb, CRUDE, 5630)
    await wait(2.0)
    check("trailing never moves the stop backwards", p["sl"] == old_sl and fb.open_orders(CRUDE)[0]["stopPrice"] == old_sl, p["sl"])
    # the server's rule: the bid reaches the stop while the last price hasn't (Fyers hasn't triggered)
    sl = p["sl"]
    tick(e, fb, CRUDE, sl + 1, bid=sl, ask=sl + 2)
    await wait(2.5)
    check("MCX: server rule fires -> stop cancelled, then one market exit; position closed", pos_of(e, CRUDE) is None,
          [(x.get("exiting"), x.get("exit_oid"), x.get("stop_oid")) for x in e.positions])
    h = e.history[-1] if e.history else {}
    check("recorded at Fyers' fill price (the bid) with reason trail sl", h.get("exit") == sl and h.get("reason") == "trail sl", (h.get("exit"), h.get("reason")))
    st = {o["id"]: o["status"] for o in fb.book.values()}
    check("the stop was cancelled at Fyers (not converted: MCX can't change type)", st.get(sid) == 1, st)
    check("Fyers is flat", fb.net.get((CRUDE, "MARGIN"), 0) == 0, fb.net)
    no_doubles(fb, "MCX exit")

    # ------------------------------------------------------------------ 2. NSE: the stop itself becomes the market exit
    fb = FakeBroker()
    e = make("t2/", fb)
    tick(e, fb, NIFTY, 24000)
    await buy(e, NIFTY, sl=23950)
    p = pos_of(e, NIFTY)
    sid = p["stop_oid"]
    e.be_now_ok = None
    tick(e, fb, NIFTY, 24080)
    await wait(0.3)
    e.be_now(p["id"])
    await wait(2.0)
    so = fb.open_orders(NIFTY)
    check("BE moves the Fyers stop to break-even + costs", so and so[0]["stopPrice"] == p["sl"] == e._be_price(p), (so and so[0]["stopPrice"], p["sl"], e._be_price(p)))
    tick(e, fb, NIFTY, p["sl"] + 0.1, bid=p["sl"], ask=p["sl"] + 0.2)
    await wait(2.0)
    check("NSE: the same stop order was turned into a market order and filled",
          fb.book[sid]["status"] == 2 and fb.book[sid]["type"] == 2 and pos_of(e, NIFTY) is None, fb.book[sid])
    check("reason be", e.history and e.history[-1]["reason"] == "be", e.history and e.history[-1]["reason"])
    no_doubles(fb, "NSE exit")

    # ------------------------------------------------------------------ 3. target on the server; 4. Fyers fills the stop itself
    fb = FakeBroker()
    e = make("t3/", fb)
    tick(e, fb, CRUDE, 5600)
    await buy(e, CRUDE, sl=5580, tp=5650)
    check("no target order at Fyers (targets stay on the server)", len(fb.open_orders(CRUDE)) == 1)
    tick(e, fb, CRUDE, 5651)
    await wait(2.5)
    check("target reached -> closed at Fyers, reason tp", pos_of(e, CRUDE) is None and e.history[-1]["reason"] == "tp", e.history[-1:] and e.history[-1]["reason"])
    no_doubles(fb, "target exit")
    tick(e, fb, CRUDE, 5600)
    await buy(e, CRUDE, sl=5580)
    tick(e, fb, CRUDE, 5579, bid=5578, ask=5580, engine=False)          # the app missed the tick; Fyers didn't
    await wait(1.0)
    check("Fyers filled its own stop -> recorded as sl at Fyers' price", pos_of(e, CRUDE) is None and e.history[-1]["reason"] == "sl"
          and e.history[-1]["exit"] == 5578, e.history[-1:] and (e.history[-1]["reason"], e.history[-1]["exit"]))

    # ------------------------------------------------------------------ 5. restart: the stop filled while the server was down
    fb = FakeBroker()
    e = make("t5/", fb)
    tick(e, fb, CRUDE, 5600)
    await buy(e, CRUDE, sl=5580)
    e.save()
    e.stop()
    fb.emit = None
    tick(e, fb, CRUDE, 5575, bid=5574, ask=5576, engine=False)          # server down: Fyers' stop protects
    check("while down, Fyers' stop filled", fb.net.get((CRUDE, "MARGIN")) == 0)
    e2 = make("t5/", fb)
    await wait(1.5)
    check("back up: the order book is read first and the stop's fill recorded", not e2.positions and e2.history and e2.history[-1]["exit"] == 5574,
          (len(e2.positions), e2.history[-1:]))

    # ------------------------------------------------------------------ 6. restart: target passed while down -> market exit at once
    fb = FakeBroker()
    e = make("t6/", fb)
    tick(e, fb, CRUDE, 5600)
    await buy(e, CRUDE, sl=5580, tp=5640)
    e.save(); e.stop(); fb.emit = None
    tick(e, fb, CRUDE, 5660, engine=False)
    e2 = make("t6/", fb)
    await wait(1.0)
    check("back up: position still open, stop still at Fyers", len(e2.positions) == 1 and len(fb.open_orders(CRUDE)) == 1)
    tick(e2, fb, CRUDE, 5660)
    await wait(2.5)
    check("first tick past the target closes at market", not e2.positions and e2.history[-1]["reason"] == "tp", e2.history[-1:])
    no_doubles(fb, "restart target")

    # ------------------------------------------------------------------ 7. overnight: a fresh stop next day; 8. closed while away
    fb = FakeBroker()
    e = make("t7/", fb)
    tick(e, fb, CRUDE, 5600)
    await buy(e, CRUDE, sl=5580)
    p = pos_of(e, CRUDE)
    e.set_pos_trail(p["id"], {"sl_on": True, "sl_r": 1.0})
    tick(e, fb, CRUDE, 5650)
    await wait(2.5)
    trailed = p["sl"]
    fb.new_day()
    T[0] = dt.datetime(2026, 11, 3, 9, 5, tzinfo=IST)
    e.prices.clear()                                                    # market not open yet: no fresh price
    e.enqueue(("poll",), 3)
    await wait(1.0)
    check("next day: yesterday's stop recognised as expired", p.get("stop_oid") is None and p.get("stop_state") == "expired", (p.get("stop_oid"), p.get("stop_state")))
    check("a warning shows until the new stop is in", any("no stop at Fyers" in w for w in e.live_status()["warnings"]), e.live_status()["warnings"])
    tick(e, fb, CRUDE, 5655)
    e.housekeeping()
    await wait(1.5)
    so = fb.open_orders(CRUDE)
    check("when it trades, a fresh stop goes in at the trailed level", len(so) == 1 and so[0]["stopPrice"] == p["sl"] >= trailed, (so, p["sl"], trailed))
    fb2 = FakeBroker()
    e3 = make("t8/", fb2)
    tick(e3, fb2, CRUDE, 5600)
    await buy(e3, CRUDE, sl=5580)
    for x in e3.positions:                                              # it was opened yesterday
        x["entries"][-1]["t"] -= 86400
    fb2.new_day(close_positions=[(CRUDE, "MARGIN")])                   # closed overnight while the app was away
    T[0] = dt.datetime(2026, 11, 4, 9, 5, tzinfo=IST)
    e3.enqueue(("poll",), 3)
    await wait(0.8)
    tick(e3, fb2, CRUDE, 5590)
    e3.housekeeping()
    await wait(5.0)                                                     # two reads of Fyers' positions, 3 s apart
    check("a position Fyers no longer has gets no new stop and is recorded as closed at Fyers",
          not e3.positions and not fb2.open_orders() and e3.history[-1]["reason"] == "closed at Fyers", (e3.positions, fb2.open_orders()))
    T[0] = dt.datetime(2026, 11, 2, 11, 0, tzinfo=IST)

    # ------------------------------------------------------------------ 9. refused change keeps the old stop; 10. rejected entry
    fb = FakeBroker()
    e = make("t9/", fb)
    tick(e, fb, NIFTY, 24000)
    await buy(e, NIFTY, sl=23950)
    p = pos_of(e, NIFTY)
    fb.fail_modify = "price outside the allowed range"
    e.modify_pos(p["id"], sl=23960)
    await wait(1.0)
    check("a refused change: the previous stop stays in force, with a warning", fb.open_orders(NIFTY)[0]["stopPrice"] == 23950
          and any("stays in force" in x["msg"] for x in e.events[-5:]), fb.open_orders(NIFTY))
    await wait(3.5)
    check("…and the app retries until Fyers takes it", fb.open_orders(NIFTY)[0]["stopPrice"] == 23960, fb.open_orders(NIFTY)[0]["stopPrice"])
    fb.refuse_next = "Insufficient funds"
    n = len(e.orders)
    tick(e, fb, CRUDE, 5600)
    await buy(e, CRUDE, sl=5580)
    check("a rejected entry is removed with Fyers' reason", len(e.orders) == n and pos_of(e, CRUDE) is None
          and any("Insufficient funds" in x["msg"] for x in e.events[-4:]), e.events[-3:])

    # ------------------------------------------------------------------ 11. unconfirmed placement: looked up by tag, never sent twice
    fb = FakeBroker()
    e = make("t11/", fb)
    tick(e, fb, CRUDE, 5600)
    fb.unsure_next = True
    await buy(e, CRUDE, sl=5580)
    await wait(2.5)
    entries = [o for o in fb.book.values() if o["side"] == 1]
    check("unconfirmed entry: found by its tag, not placed twice", len(entries) == 1 and pos_of(e, CRUDE) is not None, entries)

    # ------------------------------------------------------------------ 12. stuck market exit (price protection) -> limit
    p = pos_of(e, CRUDE)
    fb.mpp_hold = True
    e.close_now(p["id"])
    await wait(3.0)
    fb.mpp_hold = False
    tick(e, fb, CRUDE, 5600)
    await wait(1.5)
    check("a market exit held back is replaced by a crossing limit and fills", pos_of(e, CRUDE) is None, [(x.get("exit_oid"), x.get("exit_how")) for x in e.positions])
    no_doubles(fb, "stuck exit")

    # ------------------------------------------------------------------ 13. gap past the stop's limit -> server turns it to market
    fb = FakeBroker()
    e = make("t13/", fb)
    tick(e, fb, NIFTY, 24000)
    await buy(e, NIFTY, sl=23950)
    tick(e, fb, NIFTY, 23800, bid=23799.9, ask=23800.1, engine=False)   # Fyers triggers; limit (23830) can't fill
    st = fb.open_orders(NIFTY)
    check("Fyers' stop triggered but unfilled (price jumped past its limit)", len(st) == 1 and st[0].get("triggered"), st)
    tick(e, fb, NIFTY, 23800, bid=23799.9, ask=23800.1)
    await wait(2.0)
    check("…the server turns that order to market: filled", pos_of(e, NIFTY) is None and e.history[-1]["exit"] == 23799.9, e.history[-1:])
    no_doubles(fb, "gap")

    # ------------------------------------------------------------------ 14. option where Fyers refuses market orders
    fb = FakeBroker()
    e = make("t14/", fb)
    tick(e, fb, OPT, 150)
    await buy(e, OPT, sl=140, typ="limit", price=150.1)
    check("option: limit entry filled, stop-limit at Fyers", pos_of(e, OPT) is not None and fb.open_orders(OPT)[0]["type"] == 4, fb.open_orders(OPT))
    fb.refuse_market = True
    e.close_now(pos_of(e, OPT)["id"])
    await wait(3.0)
    check("market refused -> a crossing limit exit instead; closed", pos_of(e, OPT) is None, [(x.get("exiting"), x.get("exit_oid")) for x in e.positions])
    no_doubles(fb, "option exit")

    # ------------------------------------------------------------------ 15. intraday square-off and the kill switch
    fb = FakeBroker()
    e = make("t15/", fb)
    tick(e, fb, NIFTY, 24000)
    await buy(e, NIFTY, sl=23950, product="INTRADAY")
    T[0] = T[0].replace(hour=15, minute=20)
    e.housekeeping()
    await wait(2.0)
    check("intraday square-off closes at Fyers", pos_of(e, NIFTY) is None and e.history[-1]["reason"] == "square-off", e.history[-1:])
    T[0] = T[0].replace(hour=11, minute=0)
    tick(e, fb, CRUDE, 5600)
    await buy(e, CRUDE, sl=5580)
    await buy(e, NIFTY, sl=23950)
    e.place({"s": CRUDE, "side": 1, "type": "limit", "price": 5500, "sl": 5480, "mode": "lots", "lots": 1, "product": "MARGIN"})
    await wait(1.0)
    fb.net[("MCX:CRUDEOIL26NOV5600CE", "MARGIN")] = 2                   # a position opened outside the app
    fb.book["999"] = {"id": "999", "symbol": NIFTY, "qty": 75, "side": 1, "type": 1, "productType": "INTRADAY", "limitPrice": 23000,
                      "stopPrice": 0, "status": 6, "filledQty": 0, "tradedPrice": 0, "message": "", "orderTag": ""}
    tick(e, fb, OPT, 150)
    e.kill()
    await wait(10.0)                                                    # phase 2 reads Fyers' positions twice, 1.5 s apart
    check("kill switch: every app position closed, every order cancelled", not e.positions and not e.orders, (e.positions, e.orders))
    check("kill switch: other orders and positions at Fyers too", not fb.open_orders() and not any(fb.net.values()), (fb.open_orders(), fb.net))
    pl = e.plan({"s": CRUDE, "side": 1, "type": "market", "sl": 5580, "mode": "lots", "lots": 1, "product": "MARGIN"})
    check("after the kill switch new orders are refused until Resume", "Resume" in (pl.get("blocked") or ""), pl.get("blocked"))
    e.resume()
    pl = e.plan({"s": CRUDE, "side": 1, "type": "market", "sl": 5580, "mode": "lots", "lots": 1, "product": "MARGIN"})
    check("Resume allows orders again", not pl.get("blocked"), pl.get("blocked"))
    no_doubles(fb, "kill switch")

    # ------------------------------------------------------------------ 16. guards specific to live
    pl = e.plan({"s": CRUDE, "side": 1, "type": "market", "sl": None, "mode": "lots", "lots": 1, "product": "MARGIN"})
    check("a live trade needs a stop", "stop loss" in (pl.get("blocked") or ""), pl.get("blocked"))
    e.link.tok = ""
    pl = e.plan({"s": CRUDE, "side": 1, "type": "market", "sl": 5580, "mode": "lots", "lots": 1, "product": "MARGIN"})
    check("no Fyers login: orders blocked", "log in to Fyers" in (pl.get("blocked") or ""), pl.get("blocked"))
    e.link.tok = "tok"
    try:
        e.reset(25000)
        check("a live account can't be reset", False)
    except Refused:
        check("a live account can't be reset", True)
    rate = fb.max_rate()

    # ------------------------------------------------------------------ 17-20: an independent review's findings (regressions)
    from helper.broker import BrokerUnsure
    # 17. a stop part-fills at Fyers, then the server's rule fires: the exit must be only what's left
    fb = FakeBroker()
    e = make("t17/", fb)
    tick(e, fb, NIFTY, 24000)
    e.place({"s": NIFTY, "side": 1, "type": "market", "sl": 23950, "mode": "lots", "lots": 2, "product": "MARGIN"})
    await wait(1.0)
    p = pos_of(e, NIFTY)
    with fb.lock:                                                       # a thin book: Fyers fills 75 of the 150
        o = fb.book[p["stop_oid"]]
        o.update(filledQty=75, tradedPrice=23949.9, triggered=True)
        fb.net[(NIFTY, "MARGIN")] -= 75
        fb._emit(o)
    await wait(0.4)
    tick(e, fb, NIFTY, 23950.1, bid=23950, ask=23950.2)
    await wait(3.0)
    check("part-filled stop: the part is recorded, only the rest is closed; Fyers ends flat",
          fb.net.get((NIFTY, "MARGIN")) == 0 and not e.positions and sum(h["qty"] for h in e.history) == 150,
          (fb.net, [x["qty"] for x in e.positions], [h["qty"] for h in e.history]))
    no_doubles(fb, "part-filled stop")

    # 18. kill switch phase 2 while an app exit fills: it must not 'close' the app's position a second time
    fb = FakeBroker()
    e = make("t18/", fb)
    e.rules["live_chase_sec"] = 30
    tick(e, fb, NIFTY, 24000)
    await buy(e, NIFTY, sl=23950)
    fb.mpp_hold = True
    orig = fb.positions

    def late_positions():
        snap = orig()
        with fb.lock:                                                   # the exit fills just after Fyers' snapshot
            fb.mpp_hold = False
            for o in list(fb.book.values()):
                fb._try(o)
        return snap
    fb.positions = late_positions
    e.kill()
    await wait(10.0)
    check("kill switch vs an exit filling meanwhile: no second close, Fyers flat", fb.net.get((NIFTY, "MARGIN")) == 0
          and not e.positions, (fb.net, [(o["side"], o["type"], o["status"], o["orderTag"][:4]) for o in fb.book.values()]))

    # 19. an unconfirmed entry, then a restart whose first order-book read fails: never sent twice
    fb = FakeBroker()
    e = make("t19/", fb)
    tick(e, fb, NIFTY, 24000)
    fb.unsure_next = True
    fb.socket = False                                                   # no order updates either
    real_find = fb.find_tag
    fb.find_tag = lambda tag: (_ for _ in ()).throw(BrokerUnsure("timeout"))
    real_book = fb.orders
    fb.orders = lambda: (_ for _ in ()).throw(BrokerUnsure("timeout"))
    await buy(e, NIFTY, sl=23950)
    await wait(13.0)                                                    # the tag is looked up 6 times (~12 s)
    fb.orders = real_book
    fb.socket = True
    check("an unconfirmed entry is marked unsure (not re-sent)", [o.get("state") for o in e.orders] == ["unsure"], [o.get("state") for o in e.orders])
    fb.find_tag = real_find
    e.save(); e.stop(); fb.emit = None
    real_orders, n = fb.orders, [0]

    def flaky_orders():
        n[0] += 1
        if n[0] == 1:
            raise BrokerUnsure("timeout")
        return real_orders()
    fb.orders = flaky_orders
    e2 = make("t19/", fb)
    tick(e2, fb, NIFTY, 24000)                                          # the stop goes in once there's a live price
    await wait(4.0)
    buys = [o for o in fb.book.values() if o["side"] == 1]
    check("after a restart it's looked up, never re-sent: one BUY at Fyers, the app has it with its stop",
          len(buys) == 1 and len(e2.positions) == 1 and e2.positions[0].get("stop_oid"), (len(buys), e2.positions and e2.positions[0].get("stop_oid")))

    # 20. cancelling an unconfirmed limit entry that then fills: the app opens it with its stop (no orphan at Fyers)
    fb = FakeBroker()
    e = make("t20/", fb)
    tick(e, fb, NIFTY, 24000)
    fb.unsure_next = True
    fb.socket = False
    real_book = fb.orders
    fb.orders = lambda: (_ for _ in ()).throw(BrokerUnsure("timeout"))
    real_find = fb.find_tag
    fb.find_tag = lambda tag: (_ for _ in ()).throw(BrokerUnsure("timeout"))
    await buy(e, NIFTY, sl=23900, typ="limit", price=23990)
    await wait(4.0)
    fb.find_tag = real_find
    fb.orders = real_book
    e.cancel(e.orders[0]["id"])
    check("cancelling an unconfirmed entry keeps it until Fyers settles it", len(e.orders) == 1, e.orders)
    tick(e, fb, NIFTY, 23980)                                          # it fills at Fyers before the app finds it
    await wait(1.0)
    e.housekeeping()
    await wait(3.0)
    net = fb.net.get((NIFTY, "MARGIN"), 0)
    check("…it filled: the app has the position and its stop at Fyers (nothing orphaned)",
          net == 75 and len(e.positions) == 1 and e.positions[0].get("stop_oid") and not e.orders, (net, e.positions, e.orders))

    # 21. the kill switch's own close for an outside position: its update arrives first and price protection holds it
    fb = FakeBroker()
    e = make("t21/", fb)
    tick(e, fb, OPT, 150)
    fb.net[(OPT, "MARGIN")] = 100                                       # opened outside the app
    fb.mpp_hold = True
    e.kill()
    await wait(8.0)
    fb.mpp_hold = False
    tick(e, fb, OPT, 150)
    await wait(1.0)
    check("kill switch: its close of an outside position isn't cancelled as a stray; Fyers flat",
          fb.net.get((OPT, "MARGIN")) == 0 and not e.L["alerts"], (fb.net, e.L["alerts"], [(o["status"], o["orderTag"][:4]) for o in fb.book.values()]))

    # 22. a restart after a normal day raises no "CHECK FYERS" alerts
    fb = FakeBroker()
    e = make("t22/", fb)
    tick(e, fb, CRUDE, 5600)
    await buy(e, CRUDE, sl=5580)
    e.close_now(pos_of(e, CRUDE)["id"])
    await wait(2.0)
    await buy(e, CRUDE, sl=5580)
    e.save(); e.stop()
    e2 = make("t22/", fb)
    tick(e2, fb, CRUDE, 5600)
    await wait(2.0)
    check("restart: the day's finished orders aren't replayed (no false alerts), the open trade keeps its stop",
          not e2.L["alerts"] and len(e2.positions) == 1 and e2.positions[0].get("stop_oid"), (e2.L["alerts"], e2.positions))

    # 23. one empty answer from Fyers' positions list doesn't make the app forget a real position
    for x in e2.positions:
        x["entries"][-1]["t"] -= 3600
    real_pos = fb.positions
    calls = [0]

    def once_empty():
        calls[0] += 1
        return [] if calls[0] == 1 else real_pos()
    fb.positions = once_empty
    sid = e2.positions[0]["stop_oid"]
    with fb.lock:                                                       # the stop is cancelled at Fyers: a new one is needed
        fb.book[sid]["status"] = 1
        fb._emit(fb.book[sid])
    await wait(1.0)
    e2.housekeeping()
    await wait(5.0)
    check("one empty positions answer: position kept, a new stop placed", len(e2.positions) == 1 and e2.positions[0].get("stop_oid")
          and len(fb.open_orders(CRUDE)) == 1, (e2.positions, fb.open_orders(CRUDE)))
    no_doubles(fb, "restart + empty answer")

    print(f"most order calls in any minute: {rate} (helper limit 120, Fyers 200)")
    print("\n" + ("ALL PASSED" if not FAILS else f"{len(FAILS)} FAILED: " + "; ".join(FAILS)))


asyncio.run(main())
sys.exit(1 if FAILS else 0)
