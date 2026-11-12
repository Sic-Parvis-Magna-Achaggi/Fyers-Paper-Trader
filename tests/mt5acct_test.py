"""MT5 accounts (roadmap 8 b, slice b1), no browser: the EA 1.10's reports through helper/mt5.py's sync call into the
admin's MT5 accounts (rt.py + helper/mt5acct.py), played by tests/fake_mt5.py's account model, in-process.

Checks: the account made the first time a login calls (admin only; EA 1.00 shows it with a warning); MT5's history from its
deals (exact net = profit + commission + swap); a trade placed in MT5 adopted (1R, net $ at SL / TP / now, BE + commission);
the login typed once; SL / TP moves reaching MT5 (MOD), never bounced back; a stop moved by hand in MT5 adopted; BE, Trail BE,
Trail SL moving MT5's real stop (paced); a close from the app (CLOSE) booked from MT5's deal; MT5's own SL hit booked with its
reason; a refused change (backoff, the warning), a lost result (no tag run twice), offline (a close never sent late); the
app's stop passed before MT5 took it -> a market close; pending orders moved and cancelled; a part closed in MT5; a position
gone without a deal (estimate, then replaced); commission learned and its change flagged; FundingPips' floors from the
broker's midnight balance and the typed size; a second terminal (its own ticks, its own account); restart (nothing booked
twice); placing refused (b2); paper accounts still refuse MT5 symbols; v0.39.0: MT5 trades in the journal ($, the broker's or
the Indian day, the 2% line from FundingPips' day-start balance, the lockouts' switch per account).

  python3 tests/mt5acct_test.py"""
import asyncio
import datetime as dt
import os
import shutil
import sys
import tempfile
import time

D = tempfile.mkdtemp(prefix="mt5acct_")
os.environ["FYERS_HELPER_DATA"] = D
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import logging  # noqa: E402
logging.basicConfig(level=logging.WARNING)

from helper import candles, journal, mt5, mt5acct, rt, store, symbols, users  # noqa: E402
from helper.paper import Paper, Refused  # noqa: E402
from helper.mt5acct import _f  # noqa: E402
import fake_mt5  # noqa: E402

OK = FAIL = 0


def ok(name, cond, detail=""):
    global OK, FAIL
    if cond:
        OK += 1
        print("  ok  ", name)
    else:
        FAIL += 1
        print("  FAIL", name, detail)


users.get = lambda uid: {"username": "admin", "role": "admin"} if uid == "adm" else {"username": uid, "role": "user"}
users.audit = lambda *a, **k: None
symbols.EXTRA = lambda t: mt5.row(None, t)


def terminal(uid, r, **kw):
    ea = fake_mt5.FakeEA("http://x", "k", **kw)
    ea.jitter = False

    def post(path, body):
        if path == "/api/mt5/sync":
            return 200, mt5.sync(uid, body, "203.0.113.9", r.feed)
        if path == "/api/mt5/bars":
            return 200, str(mt5.take_bars(uid, body))
        return 200, str(mt5.take_symbols(uid, body))
    ea.post = post
    return ea


async def calls(ea, n=1):
    for _ in range(n):
        ea.once()
        await asyncio.sleep(0.06)


async def main():
    loop = asyncio.get_running_loop()
    r = rt.UserRT("adm")
    rt.RT["adm"] = r
    r.loop = loop
    r.feed.loop = loop
    journal.jcandles.loop = loop
    journal.jcandles.GAP = 0.05
    journal.jcandles.RETRY_OFFLINE = 0.3
    logging.getLogger('jcandles').setLevel(logging.INFO)
    mt5acct.MOD_GAP = 0.05                     # (faster pacing for the test; the real one is 2 s - checked below)

    print("the account appears the first time its terminal calls")
    ea = terminal("adm", r, history=True)
    await calls(ea, 1)
    e = r.engines.get("mt5-21182752")
    ok("an MT5 account for the login, kept apart from paper accounts", e is not None and isinstance(e, mt5acct.Mt5Engine)
       and "mt5-21182752" not in r.paper_ids() and r.mt5_ids() == ["mt5-21182752"])
    lst = {a["id"]: a for a in r.account_list()}
    a = lst.get("mt5-21182752") or {}
    ok("listed as mode mt5 with its server, DEMO, currency, connected", a.get("mode") == "mt5" and a.get("server") == "FundingPips-SIM1"
       and a.get("demo") and a.get("currency") == "USD" and a.get("online"), a)
    ok("the EA is told where MT5's deals should start (90 days back)", bool(ea.deals_asked) and
       abs(ea.deals_asked[0] - (ea.srv_now() - 90 * 86400)) < 120, ea.deals_asked)
    await calls(ea, 3)
    ok("MT5's deals arrive (deposit + 2 trades)", len(e.deals) == 5 and e.M["caught"], (len(e.deals), e.M["caught"]))
    ok("the starting size defaults to the first deposit ($5,000)", e.rules["size"] == 5000.0, e.rules["size"])
    h = sorted(e.history, key=lambda x: x["closed"])
    ok("MT5's history: 2 closed trades", len(h) == 2, h)
    if len(h) == 2:
        w, l_ = h
        ok("the win: profit 100, commission 0.30 + 0.30, swap -1.20 -> net 98.20, reason tp", w["gross"] == 100.0 and
           abs(w["charges"]["commission"] - 0.6) < 1e-6 and abs(w["charges"]["swap"] - 1.2) < 1e-6 and w["net"] == 98.2
           and w["reason"] == "tp" and w["lots"] == 0.1, w)
        ok("the loss: net -29.00 (= MT5's -27.50 - 0.15 - 0.15 - 1.20), reason sl, short", l_["net"] == -29.0 and l_["reason"] == "sl"
           and l_["side"] == -1, l_)
        ok("history trades: no stop known, so no R; marked from MT5's history", w["r"] is None and w.get("from_history") and w["src"] == "mt5")
    ok("no 'Closed' events for old history", not any(ev["msg"].startswith("Closed") for ev in e.events), [x["msg"] for x in e.events])
    ok("commission learned per symbol from the deals", e.M["comm"].get("XAUUSD", {}).get("in") == 3.0 and e.M["comm"]["XAUUSD"].get("out") == 3.0,
       e.M["comm"])
    s = e.snapshot()
    ok("snapshot: mode mt5, currency USD, balance = MT5's", s["mode"] == "mt5" and s["ccy"] == "USD" and s["acct"]["balance"] == ea.balance)

    print("a trade placed in MT5")
    bid, ask = ea.quote("XAUUSD")
    tk = ea.open("XAUUSD", 1, 0.10, sl=round(bid - 5, 2), tp=round(bid + 10, 2))
    await calls(ea, 1)
    p = next((x for x in e.positions if x.get("ticket") == tk), None)
    ok("adopted: its own ticket, volume 0.10 = 10 steps, placed in MT5", p and p["qty"] == 10 and p["outside"] and p["id"] == f"P{tk}", p)
    v = e.pos_view(p) if p else {}
    ok("lots shown as volume 0.1", v.get("lots") == 0.1 and v.get("vol") == 0.1, v.get("lots"))
    ok("entry commission from its opening deal (0.30), not estimated", p and p["comm_in"] == 0.3 and not p["comm_est"], p and p["comm_in"])
    risk = round((ask - (bid - 5)) * 100 * 0.1 + 0.3 + 0.3, 2)
    ok("1R = the loss at its SL, net of commission both ways", p and abs(p["init_risk"] - risk) < 0.02, (p and p["init_risk"], risk))
    ok("at SL / at TP in $, net", abs(v.get("at_sl", 0) + risk) < 0.02 and abs(v.get("at_tp", 0) - round((bid + 10 - ask) * 10 - 0.6, 2)) < 0.02,
       (v.get("at_sl"), v.get("at_tp")))
    be = v.get("be")
    ok("BE = the price where closing pays back the commission both ways", be and ask + 0.06 - 0.011 <= be <= ask + 0.06 + 0.011, (be, ask))
    ok("open net now ≈ MT5's profit minus commission", abs(v["net"] - (p["mt"]["profit"] - 0.6)) < 0.02, (v["net"], p["mt"]))
    ok("the account's figures: MT5's balance and equity", e.balance() == ea.balance and abs(e.equity() - ea.equity()) < 0.02)

    print("managing it: no login prompt (v0.37.1, owner 11 Nov)")
    ok("an MT5 account can be changed from the start (no login to type)", e.M["confirmed"])

    print("SL / TP from the app reach MT5")
    e.modify_pos(p["id"], sl=round(bid - 4, 2), tp=round(bid + 40, 2))
    cmd = list(e.M["cmd"].values())
    ok("a MOD command waits, with a tag", len(cmd) == 1 and cmd[0]["k"] == "MOD" and cmd[0]["tag"].startswith("F"), cmd)
    await calls(ea, 2)
    mp = ea.positions[tk]
    ok("MT5's SL / TP moved", abs(mp["sl"] - round(bid - 4, 2)) < 1e-9 and abs(mp["tp"] - round(bid + 40, 2)) < 1e-9, mp)
    ok("the app sees it at MT5, nothing waiting, no 'moved in MT5' bounce", p["b_sl"] == round(bid - 4, 2) and not e.M["cmd"]
       and not any("moved in MT5" in ev["msg"] for ev in e.events))
    ok("the tag was carried out once", len([c for c in ea.cmds if c.startswith("MOD")]) == 1, ea.cmds)

    print("a stop moved by hand in MT5")
    ea.control("/modify", {"ticket": tk, "sl": round(bid - 3, 2)})
    await calls(ea, 1)
    ok("adopted as the trade's stop; the trail leaves it alone", p["sl"] == round(bid - 3, 2) and p["own_stop"]
       and any("SL moved in MT5" in ev["msg"] for ev in e.events), (p["sl"], p.get("own_stop")))
    await calls(ea, 1)
    ok("... and nothing is sent back to MT5", not e.M["cmd"] and len([c for c in ea.cmds if c.startswith("MOD")]) == 1)

    print("BE, Trail BE, Trail SL move MT5's real stop")
    ea.control("/shift", {"sym": "XAUUSD", "by": 4.0})
    await calls(ea, 2)
    e.be_now(p["id"])
    bep = e._be_price(p)
    await calls(ea, 2)
    ok("BE: MT5's SL at break-even + commission", abs(ea.positions[tk]["sl"] - bep) < 1e-9 and p["be_done"], (ea.positions[tk]["sl"], bep))
    net_at_be = (bep - p["avg"]) * 100 * 0.1 - 0.6
    ok("closing at that stop nets >= 0 after commission", -0.011 < net_at_be < 0.2, net_at_be)
    e.set_pos_trail(p["id"], {"sl_r": 1.0})
    ok("Trail SL on for this trade (its own setting), own stop cleared", p["tr"]["sl_on"] and not p.get("own_stop"))
    R = abs(p["basis_entry"] - p["first_sl"])
    ea.control("/shift", {"sym": "XAUUSD", "by": round(R * 1.6, 2)})
    for _ in range(6):
        await calls(ea, 1)
        await asyncio.sleep(0.12)
    ok("the trail moved MT5's SL (never below BE)", ea.positions[tk]["sl"] > bep and p["trail"], (ea.positions[tk]["sl"], bep))
    mods = [c for c in ea.cmds if c.startswith("MOD")]
    ok("each trail step went to MT5 as its own MOD", len(mods) >= 3, mods)
    mt5acct.MOD_GAP = 2.0                      # the real pacing: a second change within 2 s waits (FundingPips: no server spamming)
    sl_now = p["sl"]
    p["own_stop"] = True
    e.modify_pos(p["id"], sl=round(sl_now + 0.1, 2))
    await calls(ea, 1)
    e.modify_pos(p["id"], sl=round(sl_now + 0.2, 2))
    n0 = len([c for c in ea.cmds if c.startswith("MOD")])
    await calls(ea, 3)
    n1 = len([c for c in ea.cmds if c.startswith("MOD")])
    ok("paced: a second change to the same trade within 2 s waits", n1 == n0 and e.M["cmd"], (n0, n1))
    await asyncio.sleep(2.0)
    await calls(ea, 2)
    ok("... and goes after the gap (the newest stop)", abs(ea.positions[tk]["sl"] - round(sl_now + 0.2, 2)) < 1e-9 and not e.M["cmd"])
    mt5acct.MOD_GAP = 0.05
    p["own_stop"] = False
    before = ea.positions[tk]["sl"]
    ea.control("/shift", {"sym": "XAUUSD", "by": -R * 0.3})
    await calls(ea, 3)
    ok("the trail never moves the stop back", ea.positions[tk]["sl"] == before)

    print("closing from the app")
    bal0 = ea.balance
    e.close_now(p["id"])
    ok("a CLOSE command; the position shows 'exiting'", any(c["k"] == "CLOSE" for c in e.M["cmd"].values()) and p.get("exiting"))
    try:
        e.close_now(p["id"])
        ok("clicking close twice is refused", False)
    except Refused:
        ok("clicking close twice is refused", True)
    await calls(ea, 2)
    rec = e.history[-1]
    ok("closed in MT5 and booked from its deal (reason manual)", tk not in ea.positions and not e.positions and rec["ticket"] == tk
       and rec["reason"] == "manual", rec.get("reason"))
    ok("net = MT5's profit - commission in and out, exactly", abs(rec["net"] - (rec["gross"] - 0.6)) < 1e-6
       and abs(rec["net"] - (ea.balance - bal0 - 0.3)) < 0.011, (rec["net"], ea.balance - bal0))
    ok("R from the first stop", rec["r"] is not None and abs(rec["r"] - rec["net"] / rec["init_risk"]) < 0.01, rec["r"])
    ok("the stop's path is on the record", len(rec["path"]) >= 3, rec["path"])

    print("MT5's own stop fires")
    bid, ask = ea.quote("XAUUSD")
    tk2 = ea.open("XAUUSD", -1, 0.05, sl=round(ask + 2, 2), tp=round(ask - 20, 2))
    await calls(ea, 1)
    ea.control("/shift", {"sym": "XAUUSD", "by": 2.5})
    await calls(ea, 2)
    rec = e.history[-1]
    ok("booked from MT5's deal with reason sl, short", rec["ticket"] == tk2 and rec["reason"] == "sl" and rec["side"] == -1 and not e.positions,
       rec.get("reason"))

    print("a refused change, a lost result")
    bid, ask = ea.quote("XAUUSD")
    tk3 = ea.open("XAUUSD", 1, 0.02, sl=round(bid - 6, 2))
    await calls(ea, 1)
    p3 = next(x for x in e.positions if x["ticket"] == tk3)
    ea.control("/refuse", {"k": "MOD", "code": 10016, "n": 1})
    e.modify_pos(p3["id"], sl=round(bid - 5, 2))
    await calls(ea, 2)
    ok("MT5's refusal shown on the trade, retried later", p3.get("mt_err", "").startswith("Invalid stops") and p3.get("retry_at"),
       p3.get("mt_err"))
    ok("... and in the log", any("MT5 refused" in ev["msg"] for ev in e.events))
    p3["retry_at"] = 0
    await calls(ea, 3)
    ok("the retry: MT5 has it, the warning gone", ea.positions[tk3]["sl"] == round(bid - 5, 2) and not p3.get("mt_err"))
    ea.drop_results = 1
    e.modify_pos(p3["id"], sl=round(bid - 4.5, 2))
    await calls(ea, 2)
    ok("a lost result: MT5 moved it anyway, the command still waits", ea.positions[tk3]["sl"] == round(bid - 4.5, 2) and e.M["cmd"])
    for c in e.M["cmd"].values():
        c["sent"] -= mt5acct.CMD_WAIT + 1
    await calls(ea, 2)
    ok("after the wait: dropped, MT5's state agrees, nothing sent twice", not e.M["cmd"] and
       len([c for c in ea.cmds if c.split()[1] == ea.cmds[-1].split()[1]]) == 1, ea.cmds[-3:])

    print("MT5 not connected")
    e.seen = time.time() - 60
    try:
        e.close_now(p3["id"])
        ok("a close while MT5 is off is refused at once", False)
    except Refused as x:
        ok("a close while MT5 is off is refused at once", "isn't connected" in str(x), x)
    e.seen = time.time()
    e.close_now(p3["id"])
    e.seen = time.time() - 60
    for c in e.M["cmd"].values():
        c["made"] -= mt5acct.CLOSE_EXPIRE + 1
    e.housekeeping()
    ok("a close that couldn't be delivered in time is dropped, never sent late", not e.M["cmd"] and not p3.get("exiting"))
    await calls(ea, 2)
    ok("... MT5 back: the trade is still open", tk3 in ea.positions and any(x["ticket"] == tk3 for x in e.positions))

    print("the app's stop passed before MT5 had it")
    ea.control("/refuse", {"k": "MOD", "code": 10016, "n": 50})
    bid, ask = ea.quote("XAUUSD")
    e.modify_pos(p3["id"], sl=round(bid - 0.5, 2))
    await calls(ea, 2)
    ea.control("/shift", {"sym": "XAUUSD", "by": -1.0})
    await calls(ea, 3)
    ok("closed at market by the app (MT5 still had the old stop)", tk3 not in ea.positions and e.history[-1]["ticket"] == tk3
       and e.history[-1]["reason"].startswith("sl (the app's stop"), e.history[-1]["reason"])
    ea.refuse.clear()

    print("pending orders")
    bid, ask = ea.quote("XAUUSD")
    ot = ea.pending("XAUUSD", "limit", 1, round(bid - 10, 2), 0.03, sl=round(bid - 15, 2), tp=round(bid + 5, 2))
    await calls(ea, 1)
    o = next((x for x in e.orders if x.get("ticket") == ot), None)
    ok("a pending order placed in MT5 shows (buy limit, 0.03)", o and o["type"] == "limit" and o["side"] == 1 and o["lots"] == 0.03, o)
    e.modify_order(o["id"], price=round(bid - 8, 2))
    await calls(ea, 2)
    mo = ea.orders[ot]
    ok("moved from the app: price, and its SL / TP with it (OMOD)", abs(mo["price"] - round(bid - 8, 2)) < 1e-9 and
       abs(mo["sl"] - round(bid - 13, 2)) < 1e-9, mo)
    e.cancel(o["id"])
    await calls(ea, 2)
    ok("cancelled from the app (CANCEL)", ot not in ea.orders and not e.orders and any("cancelled from the app" in ev["msg"] for ev in e.events))

    print("a part closed in MT5, a position gone without a deal")
    tk4 = ea.open("XAUUSD", 1, 0.10, sl=round(bid - 8, 2))
    await calls(ea, 1)
    ea.control("/close", {"ticket": tk4, "vol": 0.04})
    await calls(ea, 1)
    p4 = next(x for x in e.positions if x["ticket"] == tk4)
    ok("a part booked (0.04), 0.06 still open", p4["qty"] == 6 and e.history[-1]["lots"] == 0.04 and e.history[-1]["part"]
       and e.history[-1]["reason"] == "closed in MT5", (p4["qty"], e.history[-1]))
    deals_before = len(ea.deals)
    with ea.lock:
        ea.close_pos(tk4)
        hidden = ea.deals.pop()                       # MT5's deal "late"
    mt5acct.GONE_SEC = 0.05
    await calls(ea, 1)
    await asyncio.sleep(0.1)
    await calls(ea, 1)
    ok("gone without a deal: booked at its last price as an estimate", e.history[-1].get("est") and e.history[-1]["ticket"] == tk4)
    with ea.lock:
        ea.deals.append(hidden)
    await calls(ea, 1)
    ok("MT5's deal arrives: the estimate replaced by the real figures", not any(x.get("est") for x in e.history)
       and e.history[-1]["ticket"] == tk4 and len(ea.deals) == deals_before + 1, e.history[-1])
    mt5acct.GONE_SEC = 15

    print("commission learned, a change flagged")
    bid, ask = ea.quote("XAUUSD")
    ea.open("XAUUSD", 1, 0.01, sl=round(bid - 8, 2))
    await calls(ea, 1)
    ok("a 0.01 lot deal (MT5 rounds its commission to the cent) isn't taken for a change", e.M["comm"]["XAUUSD"]["in"] == 3.0
       and not e.M["comm"]["XAUUSD"].get("diff"), e.M["comm"]["XAUUSD"])
    ea.control("/comm", {"sym": "XAUUSD", "in": 3.5, "out": 3.5})
    ea.open("XAUUSD", 1, 0.10, sl=round(bid - 8, 2))
    await calls(ea, 1)
    ok("MT5 charged more than learned: warned, the new figure used", e.M["comm"]["XAUUSD"]["in"] == 3.5 and
       any("charged 3.5" in ev["msg"] for ev in e.events) and e.M["comm"]["XAUUSD"].get("diff"))

    print("FundingPips' floors")
    s = e.snapshot()
    a = s["acct"]
    mid = e._midnight_balance()
    ok("today's start = the balance at the broker's midnight (from MT5's deals since)", abs(s["mt5"]["day_start"] - mid) < 0.01
       and abs(mid - (ea.balance - sum(d[8] + d[9] + d[10] for d in ea.deals if d[12] / 1000 >= e._midnight_srv()))) < 0.02, (mid, ea.balance))
    ok("daily floor = start - 5% of the start", abs(a["daily_floor"] - mid * 0.95) < 0.02, (a["daily_floor"], mid))
    ok("max floor = 5,000 - 10% (static)", a["max_floor"] == 4500.0)
    e.set_rules({"size": 10000, "daily_of": "size", "phase": "master", "comm_default": 4, "squareoff_on": True})
    a = e.snapshot()["acct"]
    ok("typed size and 'daily % of the size': floors follow", a["max_floor"] == 9000.0 and abs(a["daily_floor"] - (mid - 500)) < 0.02
       and e.M["size_set"] and e.rules["phase"] == "master" and e.rules["comm_default"] == 4.0, a)
    ok("Indian-only rules don't apply to MT5 accounts", e.rules["squareoff_on"] is False)
    try:
        e.set_rules({"daily_of": "week"})
        ok("a bad value refused", False)
    except Refused:
        ok("a bad value refused", True)
    ok("equity under a floor: shown as a breach", any("max-loss floor" in b for b in e.snapshot()["mt5"]["breach"]),
       e.snapshot()["mt5"]["breach"])
    e.set_rules({"size": 5000, "daily_of": "day"})
    ok("back to 5,000: no breach", not e.snapshot()["mt5"]["breach"])

    print("b2: placing from the app")
    await calls(ea, 2)                                  # (the ticket's symbol is streamed by this terminal now)
    bid, ask = ea.quote("XAUUSD")
    req = {"s": "MT5:XAUUSD", "side": 1, "type": "market", "sl": round(bid - 6, 2), "tp_r": 2, "mode": "pct", "risk_pct": 0.5}
    try:
        e.plan(dict(req))
    except Refused as x:
        ok("(the first preview, before this terminal streams it: waiting for its price)", "waiting for" in str(x), x)
    await calls(ea, 2)
    p1 = e.plan(dict(req))
    ok("a plan: volume in 0.01 steps, risk within 0.5% of the balance, net of commission", p1.get("steps") and
       abs(p1["lots"] - p1["steps"] * 0.01) < 1e-9 and 0 < p1["risk"] <= e.balance() * 0.005 + 0.01 and not p1.get("blocked"), p1)
    ok("its margin from MT5's own figure (OrderCalcMargin)", p1.get("margin_source") == "mt5" and p1.get("margin") > 0, p1.get("margin"))
    ok("money in $, product MT5", p1.get("ccy") == "USD" and p1.get("product") == "MT5")
    print("v0.37.2: the value of a price move (owner 11 Nov: the app showed -$3.78 at the stop, MT5 -$217.94)")
    print("    plan keys:", sorted(k for k in p1 if not isinstance(p1[k], (dict, list))))
    def by_hand(p):                                     # what MT5 itself would show: move x 100 oz x lots, + commission 3 + 3 a lot
        return (p["entry"] - req["sl"]) * 100 * p["lots"] + 6.0 * p["lots"]
    ok("the loss at the stop is MT5's: move x 100 oz x lots + commission", abs(p1["risk"] - by_hand(p1)) < 0.05,
       (p1["risk"], round(by_hand(p1), 2), p1["lots"]))
    ok("the ticket says what 1 lot's 1.00 move is worth: $100", abs(p1.get("per_move", 0) - 100) < 1e-6, p1.get("per_move"))
    good_tv = e.M["sym"]["XAUUSD"]["tv"]
    learned = dict(e.M.get("ppl") or {})
    ok("learned from MT5's profit on the open XAUUSD position: $100 per 1.00 per lot", abs(learned.get("XAUUSD", 0) - 100) < 0.5, learned)
    e.M["sym"]["XAUUSD"]["tv"] = good_tv / 100          # MT5 reporting a tick value 100x too small (as on the owner's terminal)
    pbad = e.plan(dict(req))
    ok("MT5's tick value 100x too small: the learned value still gives MT5's own figures", abs(pbad["risk"] - by_hand(pbad)) < 0.05
       and pbad["lots"] == p1["lots"], (pbad["risk"], round(by_hand(pbad), 2), pbad["lots"]))
    e.M["ppl"].pop("XAUUSD", None)
    pcp = e.plan(dict(req))
    ok("... with nothing learned: EA 1.21's OrderCalcProfit ($100 for 1 lot over 1.00)", abs(pcp["risk"] - by_hand(pcp)) < 0.05
       and "OrderCalcProfit" in str(pcp.get("tv_src")), (pcp["risk"], pcp.get("tv_src")))
    good_pp = e.M["sym"]["XAUUSD"].pop("pp", None)
    pbad2 = e.plan(dict(req))
    ok("... and an EA without it (1.20): tick size x contract size (USD profit on a USD account)", abs(pbad2["risk"] - by_hand(pbad2)) < 0.05
       and pbad2["lots"] == p1["lots"] and "contract" in str(pbad2.get("tv_src")), (pbad2["risk"], pbad2.get("tv_src")))
    ok("... and the wrong tick value is flagged", any("tick value" in ev.get("msg", ev.get("m", "")) for ev in e.snapshot().get("events", [])[-5:])
       or any("tick value" in str(x) for x in (e.snapshot().get("log") or [])[-5:]), [str(x)[:90] for x in (e.snapshot().get("events") or [])[-3:]])
    e.M["sym"]["XAUUSD"]["tv"] = good_tv
    e.M["sym"]["XAUUSD"]["pp"] = good_pp
    e.M["ppl"] = learned

    print("v0.37.3: a symbol never traded here (EURGBP: profit in pounds; commission from MT5's rules, EA 1.22)")
    gq = {"s": "MT5:EURGBP", "side": 1, "type": "market", "mode": "lots", "lots": 0.10}
    for _ in range(3):
        try:
            e.plan({**gq, "sl": round(ea.quote("EURGBP")[0] - 0.002, 5)})
        except Refused:
            pass
        await calls(ea, 3)
    eg = e.plan({**gq, "sl": round(ea.quote("EURGBP")[0] - 0.002, 5)})
    gbp = ea.quote("GBPUSD")[0]
    ok("the commission before its first trade: MT5's rules ($7 a lot opening, $0 closing)",
       eg["comm"]["in"] == 7.0 and eg["comm"]["out"] == 0.0 and eg["comm"]["src"]["in"] == "MT5's commission rules", eg.get("comm"))
    ok("a 1.00 move on 1 lot = 100,000 x the GBPUSD price, MT5's profit sum checked against it",
       abs(eg["per_move"] - 100000 * gbp) / (100000 * gbp) < 0.005 and "checked against the contract size 100000 x the GBPUSD price"
       in str(eg.get("tv_src")), (eg["per_move"], 100000 * gbp, eg.get("tv_src")))
    ok("the loss at the stop: move x 100,000 x GBPUSD x 0.10 lot + $0.70 commission",
       abs(eg["risk"] - ((eg["entry"] - eg["sl"]) * eg["per_move"] * 0.10 + 0.70)) < 0.05, (eg["risk"], eg["entry"], eg["sl"]))
    gs = e.M["sym"]["EURGBP"]
    keep = {k: gs.get(k) for k in ("pp", "cr")}
    gs.pop("pp", None)
    eg2 = e.plan({**gq, "sl": eg["sl"]})
    ok("an EA without MT5's profit sum: contract size x the GBPUSD price", str(eg2.get("tv_src")).startswith("contract size 100000 x the GBPUSD")
       and abs(eg2["per_move"] - eg["per_move"]) / eg["per_move"] < 0.005, eg2.get("tv_src"))
    gbp_spec = mt5.user(e.uid).specs.pop("GBPUSD")
    try:
        e.plan({**gq, "sl": eg["sl"]})
        ok("only MT5's tick value left: refused (it can't be checked)", False)
    except Refused as x:
        ok("only MT5's tick value left: refused (it can't be checked)", "can't be checked" in str(x), x)
    mt5.user(e.uid).specs["GBPUSD"] = gbp_spec
    gs.pop("cr", None)
    dflt0 = e.rules.get("comm_default")
    e.set_rules({"comm_default": ""})
    try:
        e.plan({**gq, "sl": eg["sl"]})
        ok("commission unknown (no rules, never traded, nothing similar, no default): refused", False, e.comm_for("EURGBP"))
    except Refused as x:
        ok("commission unknown (no rules, never traded, nothing similar, no default): refused", "commission isn't known" in str(x), x)
    e.set_rules({"comm_default": 0})
    ok("typed 0 (no commission): allowed, from your default", e.plan({**gq, "sl": eg["sl"]})["comm"]["src"]["in"] == "your default")
    e.set_rules({"comm_default": ""})
    ok("cleared: not typed again", e.rules.get("comm_default") is None and not e.rules.get("comm_typed"))
    e.M["comm"]["GBPUSD"] = {"in": 3.5, "out": 3.5, "in_n": 1, "out_n": 1, "at": time.time()}
    es = e.plan({**gq, "sl": eg["sl"]})
    ok("... or as a symbol of the same group that has traded (Forex: GBPUSD)", es["comm"]["in"] == 3.5 and
       es["comm"]["src"]["in"] == "as GBPUSD (learned)", es.get("comm"))
    e.M["comm"].pop("GBPUSD")
    gs.update(keep)
    e.set_rules({"comm_default": "" if dflt0 is None else dflt0})
    sn = e.snapshot()["mt5"]["comm"]
    ok("the Account page lists symbols not traded yet, with where each figure comes from",
       sn.get("EURGBP", {}).get("src", {}).get("in") == "MT5's commission rules" and "US30.cash" in sn or "EURGBP" in sn, list(sn)[:6])
    p2 = e.plan({**req, "mode": "lots", "lots": 0.05})
    ok("fixed lots: 0.05 lot = 5 steps", p2["steps"] == 5 and p2["lots"] == 0.05, (p2["steps"], p2["lots"]))
    p3 = e.plan({**req, "mode": "lots", "lots": 0.004})
    ok("under MT5's minimum volume: blocked", p3.get("blocked"), p3.get("blocked"))
    ph = e.plan({**req, "side": -1, "sl": round(ask + 6, 2)})
    ok("no hedging: a SELL XAUUSD with a long open in this account is blocked", "no hedging" in str(ph.get("blocked")), ph.get("blocked"))
    try:
        e.plan({"s": "MT5:EURUSD", "side": -1, "type": "market", "sl": 2, "mode": "lots", "lots": 0.01})
    except Refused:
        pass
    await calls(ea, 2)
    pe2 = e.plan({"s": "MT5:EURUSD", "side": -1, "type": "market", "sl": round(ea.quote("EURUSD")[1] + 0.002, 5), "tp_r": 2,
                  "mode": "lots", "lots": 0.01})
    ok("another symbol the other way is fine (owner, 10 Nov)", not pe2.get("blocked"), pe2.get("blocked"))
    n_pos = len(e.positions)
    pl = e.place({**req, "strat": {"id": "st1", "name": "Gold breakout", "eid": "L"},     # (v0.43.0: as a strategy places it)
                  "tr": {"be_on": False, "be_r": 1.5, "sl_on": False, "sl_r": 2}})
    oc = [c for c in e.M["cmd"].values() if c["k"] == "OPEN"]
    ok("PLACE: an OPEN command with the plan's volume, SL and TP", len(oc) == 1 and f" {pl['lots']:.8g} " in " " + oc[0]["args"] + " "
       and e.snapshot()["mt5"]["opening"], oc)
    await calls(ea, 2)
    newp = [x for x in e.positions if x.get("comment", "").startswith("FTM ")] if False else \
        [x for x in e.positions if not x.get("outside")]
    ok("MT5 opened it: the app's trade (not 'placed in MT5'), its planned stop as 1R", len(e.positions) == n_pos + 1 and newp and
       newp[-1]["first_sl"] == req["sl"] and abs(newp[-1]["init_risk"] - pl["risk"]) < 1.0 and not e.M["opening"],
       (len(e.positions), newp and newp[-1].get("first_sl"), pl.get("risk")))
    ok("v0.43.0: a strategy's order: the position carries its tag and its own BE / trail", newp and newp[-1].get("strat") ==
       {"id": "st1", "name": "Gold breakout", "eid": "L"} and newp[-1]["tr"].get("own_be") and newp[-1]["tr"]["be_r"] == 1.5
       and newp[-1]["tr"]["sl_r"] == 2, newp and (newp[-1].get("strat"), newp[-1].get("tr")))
    ok("... with MT5's real SL and TP from the start", newp and ea.positions[newp[-1]["ticket"]]["sl"] == req["sl"]
       and ea.positions[newp[-1]["ticket"]]["tp"] == pl["tp"], newp and ea.positions[newp[-1]["ticket"]])
    lp = {**req, "type": "limit", "price": round(bid - 3, 2), "sl": round(bid - 9, 2), "mode": "lots", "lots": 0.02}
    e.place(dict(lp))
    await calls(ea, 2)
    lo = [o for o in e.orders if not o.get("outside")]
    ok("a limit from the app: a pending order at MT5, linked to the app", len(lo) == 1 and lo[0]["price"] == lp["price"]
       and lo[0]["lots"] == 0.02 and not e.M["opening"], lo)
    e.cancel(lo[0]["id"])
    await calls(ea, 2)
    ea.control("/refuse", {"k": "OPEN", "code": 10016, "n": 1})
    e.place({**req, "mode": "lots", "lots": 0.01})
    await calls(ea, 2)
    ok("MT5 refuses an order: shown, nothing waiting", any("MT5 refused BUY MARKET XAUUSD" in ev["msg"] for ev in e.events)
       and not e.M["opening"], [ev["msg"] for ev in e.events[-2:]])
    n_pos = len(e.positions)
    ea.drop_results = 1
    e.place({**req, "mode": "lots", "lots": 0.01})
    await calls(ea, 2)
    for c in e.M["cmd"].values():
        c["sent"] -= mt5acct.CMD_WAIT + 1
    await calls(ea, 2)
    ok("a lost OPEN result: never sent again; the position, found by its tag, is the app's", len(e.positions) == n_pos + 1 and
       len([c for c in ea.cmds if c.startswith("OPEN")]) == 4 and not e.M["cmd"], (len(e.positions), n_pos, ea.cmds[-2:]))
    e.seen = time.time() - 60
    pb = e.plan(dict(req))
    ok("MT5 not connected: the plan says so", "isn't connected" in str(pb.get("blocked")), pb.get("blocked"))
    try:
        e.place(dict(req))
        ok("... and PLACE is refused", False)
    except Refused:
        ok("... and PLACE is refused", True)
    e.seen = time.time()
    e.place({**req, "mode": "lots", "lots": 0.01})
    e.seen = time.time() - 60
    for c in e.M["cmd"].values():
        c["made"] -= mt5acct.OPEN_EXPIRE + 1
    e.housekeeping()
    ok("an order that couldn't reach MT5 in 10 s is dropped, never placed late", not e.M["cmd"] and not e.M["opening"]
       and any("NOT placed" in ev["msg"] for ev in e.events))
    await calls(ea, 1)
    ea.ver = "1.10"
    await calls(ea, 1)
    pv = e.plan(dict(req))
    ok("EA 1.10: placing blocked (install 1.20); managing still works", "1.20" in str(pv.get("blocked")), pv.get("blocked"))
    ea.ver = "1.20"
    await calls(ea, 1)

    print("b3: the kill switch")
    lp2 = {**req, "type": "limit", "price": round(ea.quote("XAUUSD")[0] - 4, 2), "sl": round(ea.quote("XAUUSD")[0] - 10, 2),
           "mode": "lots", "lots": 0.01}
    e.place(lp2)
    await calls(ea, 2)
    ok("(a position and an order open)", ea.positions and ea.orders)
    e.kill()
    await calls(ea, 3)
    ok("KILL: every position closed and every order cancelled in MT5", not ea.positions and not ea.orders and not e.positions
       and not e.orders, (list(ea.positions), list(ea.orders)))
    ok("... reason kill in the history", e.history[-1]["reason"] == "kill")
    pk = e.plan(dict(req))
    ok("... new orders paused", "kill switch" in str(pk.get("blocked")), pk.get("blocked"))
    e.resume()
    ok("Resume: orders allowed again", not e.plan(dict(req)).get("blocked"))

    print("b3: the news guard (ForexFactory)")
    from helper import news
    e.set_rules({"phase": "evaluation"})
    news.set_events([{"t": int(time.time()) + 120, "cur": "USD", "title": "Non-Farm Employment Change", "impact": "High"},
                     {"t": int(time.time()) + 60, "cur": "JPY", "title": "BOJ Policy Rate", "impact": "High"},
                     {"t": int(time.time()) + 90, "cur": "USD", "title": "Unemployment Claims", "impact": "Medium"}])
    e.place({**req, "mode": "lots", "lots": 0.01})
    await calls(ea, 2)
    pn = e.plan(dict(req))
    ok("evaluation: not blocked, a note about purposely trading news", not pn.get("blocked") and
       any("Non-Farm" in n and "purposely" in n for n in pn["notes"]), pn["notes"])
    ok("... and a warning on the open trade", any("Non-Farm" in w for w in e.snapshot()["mt5"]["warnings"]))
    ok("the next 24 h of high-impact news for the account (medium-impact left out)", [x["title"] for x in e.snapshot()["mt5"]["news"]]
       == ["Non-Farm Employment Change"], e.snapshot()["mt5"]["news"])
    e.set_rules({"phase": "master"})
    pn = e.plan(dict(req))
    ok("Master: no opening within 5 min of it", "FundingPips Master" in str(pn.get("blocked")) and "Non-Farm" in pn["blocked"], pn.get("blocked"))
    try:
        e.close_now(e.positions[-1]["id"])
        ok("Master: no closing from the app within 5 min of it", False)
    except Refused as x:
        ok("Master: no closing from the app within 5 min of it", "closing" in str(x), x)
    ok("another currency's news doesn't block EURUSD... (USD is EURUSD's too)", "Non-Farm" in str(e.plan(pe2 | {"_steps": False, "s": "MT5:EURUSD",
       "side": -1, "type": "market", "mode": "lots", "lots": 0.01}).get("blocked") or ""))
    news.set_events([{"t": int(time.time()) + 1800, "cur": "USD", "title": "FOMC Statement", "impact": "High"}])
    ok("30 min away: no block", not e.plan(dict(req)).get("blocked"))
    news.set_events([])
    e.set_rules({"phase": "evaluation"})
    ok("news parsed from ForexFactory's JSON (time with its offset)", news.parse([{"title": "CPI m/m", "country": "USD",
       "date": "2026-11-12T08:30:00-05:00", "impact": "High"}])[0]["t"] == 1794490200)

    print("b3: the EA trails by itself while the link is down")
    tp_ = e.positions[-1]
    e.set_pos_trail(tp_["id"], {"sl_r": 1.0, "be_r": 0.5})
    await calls(ea, 2)
    ok("the EA has the trade's trailing table (TRAIL)", tp_["ticket"] in ea.trail and ea.trail[tp_["ticket"]]["sl_d"] > 0, ea.trail)
    R = abs(tp_["basis_entry"] - tp_["first_sl"])
    ea.offline = True
    ea.control("/shift", {"sym": "XAUUSD", "by": round(R * 1.6, 2)})      # (its target is at 2R)
    sl0 = ea.positions[tp_["ticket"]]["sl"]
    for _ in range(3):
        await calls(ea, 1)
    ok("link down: the EA moved MT5's stop by itself (Trail SL, never below BE)", ea.positions[tp_["ticket"]]["sl"] > sl0
       and ea.positions[tp_["ticket"]]["sl"] >= e._be_price(tp_) and ea.trailed, (sl0, ea.positions[tp_["ticket"]]["sl"]))
    moved = ea.positions[tp_["ticket"]]["sl"]
    ea.offline = False
    await calls(ea, 1)
    await calls(ea, 1)
    ok("link back: the app takes it as the trail (not 'moved by hand'), and keeps trailing", abs(tp_["sl"] - moved) < 1e-9
       and not tp_.get("own_stop") and tp_.get("trail") and any("EA trailed" in ev["msg"] for ev in e.events), (tp_["sl"], moved))
    ea.trail.clear()
    ea.dcur = (0, 0)
    await calls(ea, 2)
    ok("an EA restart gets the table again", tp_["ticket"] in ea.trail)
    try:
        e.plan({"s": "MCX:CRUDEOIL26NOVFUT", "side": 1})
        ok("a Fyers contract on an MT5 account: refused", False)
    except Refused as x:
        ok("a Fyers contract on an MT5 account: refused", "MT5 symbols only" in str(x), x)
    pe = r.engine(r.paper_ids()[0])
    try:
        pe.row("MT5:XAUUSD")
        ok("a paper account refuses MT5 symbols", False)
    except Refused:
        ok("a paper account refuses MT5 symbols", True)
    ok("an unknown MT5 id gives the empty MT5 account, never a paper one", r.engine("mt5-999").none and r.engine("mt5-999").mode == "mt5")

    print("ticks: each account keeps its own terminal's prices")
    ea2 = terminal("adm", r, login=21182753, server="FundingPips-SIM2")
    ea2.control("/shift", {"sym": "XAUUSD", "by": 50})
    await calls(ea2, 2)
    e2 = r.engines.get("mt5-21182753")
    ok("a second terminal: a second account", e2 is not None and set(r.mt5_ids()) == {"mt5-21182752", "mt5-21182753"})
    tk5 = ea2.open("XAUUSD", 1, 0.01, sl=2000)
    await calls(ea2, 2)
    await calls(ea, 1)
    ok("its SUB asks for its own position's symbol (not the price terminal)", "XAUUSD" in ea2.subs, ea2.subs)
    await calls(ea2, 1)
    await asyncio.sleep(0.05)
    px2 = e2.px("MT5:XAUUSD").get("bid")
    ok("its prices are its own terminal's (shifted +50), not the price terminal's", px2 and abs(px2 - ea2.quote("XAUUSD")[0]) < 0.05, (px2, ea2.quote("XAUUSD")))
    px1 = e.px("MT5:XAUUSD").get("bid")
    ok("... and the first account's are still its own", px1 and abs(px1 - ea.quote("XAUUSD")[0]) < 1, (px1, ea.quote("XAUUSD")))
    ok("the second account needs no login typed either", e2.M["confirmed"])
    ea.open("US30.cash", 1, 0.1, sl=round(ea.quote("US30.cash")[0] - 300, 2))
    await calls(ea, 1)
    q30 = {"s": "MT5:US30.cash", "side": -1, "type": "market", "sl": round(ea2.quote("US30.cash")[1] + 300, 2), "tp_r": 2,
           "mode": "lots", "lots": 0.1}
    try:
        e2.plan(dict(q30))
    except Refused:
        pass
    await calls(ea2, 2)
    ph2 = e2.plan(dict(q30))
    ok("no hedging across your MT5 accounts: a SELL US30 here while 21182752 is long US30", "21182752" in str(ph2.get("blocked"))
       and "no hedging" in ph2["blocked"], ph2.get("blocked"))

    print("EA 1.00, a non-admin user")
    ea3 = terminal("adm", r, login=21182754, old=True)
    await calls(ea3, 1)
    e3 = r.engines.get("mt5-21182754")
    ok("EA 1.00: the account shows, with a warning, changes refused", e3 is not None and
       any("1.10" in w for w in e3.snapshot()["mt5"]["warnings"]))
    try:
        e3.close_all()
        ok("EA 1.00: changes refused", False)
    except Refused as x:
        ok("EA 1.00: changes refused", "1.10" in str(x), x)
    rb = rt.UserRT("bob")
    rt.RT["bob"] = rb
    rb.loop, rb.feed.loop = loop, loop
    eb = terminal("bob", rb, login=31000001)
    await calls(eb, 1)
    ok("a non-admin's terminal: prices only, no account", not rb.mt5_ids() and not any(a.get("mode") == "mt5" for a in rb.accounts()))

    print("v0.39.0: MT5 trades in the journal (roadmap 8 c1)")
    j = journal.get("adm")
    j.sync(r, full=True)
    aid = "mt5-21182752"
    jt = {k: t for k, t in j.d["trades"].items() if t["acct"] == aid and t["status"] != "removed"}
    hist_ids = {journal.pkey(aid, h) for h in e.history}
    ok("every MT5 trade in its history is in the journal", hist_ids and all(f"{aid}:{x}" in j.d["trades"] for x in hist_ids),
       sorted(hist_ids - {k.split(":", 1)[1] for k in jt}))
    ok("... in $ (USD), marked MT5", jt and all(t["cur"] == "USD" and t["src"] == "mt5" and t["mode"] == "mt5" for t in jt.values()),
       {t["cur"] for t in jt.values()})
    bad = []
    for k, t in jt.items():
        if t["status"] != "closed":
            continue
        hs = [h for h in e.history if f"{aid}:{journal.pkey(aid, h)}" == k]
        if abs(sum(h["net"] for h in hs) - t["net"]) > 0.005:
            bad.append((k, t["net"], [h["net"] for h in hs]))
    ok("each closed trade's net = MT5's own (profit, commission, swap), parts added up (one trade per MT5 position)", not bad, bad)
    split = [k for k in jt if "d" in k.split(":", 1)[1]]
    ok("a part closed in MT5 + the late deal of the rest: one journal trade, not two", not split, split)
    est_left = [(k, c["id"]) for k, t in jt.items() for c in t["closes"] if c.get("est")
                and not any(h["id"] == c["id"] and h.get("est") for h in e.history)]
    ok("an estimate (position gone without a deal) is replaced by MT5's deal in the journal too", not est_left, est_left)
    opens = [t for t in jt.values() if t["status"] == "open"]
    ok("open MT5 positions are open journal trades, lots = MT5's volume (0.1, not 10 steps)",
       len(opens) == len(e.positions) and all(t["lots"] is not None and t["lots"] < 50 and abs(t["lots"] - round(t["lots"], 2)) < 1e-9
                                              for t in opens), [(t["s"], t["lots"]) for t in opens])
    ok("a trade placed in MT5 itself is marked as such", any(t.get("outside") for t in jt.values()))
    nob = [k for k, t in jt.items() if t["status"] == "closed" and t.get("balance_after") is None]
    ok("every closed MT5 trade has the balance after it (MT5's history: from MT5's deals), for the balance curve", not nob, nob[:3])
    w = next((t for t in jt.values() if t.get("closed") and t["closed"] == min(x["closed"] for x in jt.values() if x.get("closed"))), None)
    ok("... the first one: the first deposit + its net (the fake's balance rounds a few cents off its deals)", w and abs(w["balance_after"] - (5000 + w["net"])) < 0.05, w and (w["balance_after"], w["net"]))
    wrong_day = [(k, t["day"]) for k, t in jt.items() if t["status"] == "closed" and t["day"] != e.trading_day(t["closed"])]
    ok("the session day: the broker's by default (a closed trade on its close's broker day)", not wrong_day, wrong_day[:3])
    wrong_base = [(k, t["base"], e.day_start_balance(t["day"])) for k, t in jt.items()
                  if abs(t["base"] - (e.day_start_balance(t["day"]) or e.rules["size"])) > 0.005]
    ok("the 2% line's base: FundingPips' day-start balance of that broker day", not wrong_base, wrong_base[:3])
    ok("... today's = the balance at the broker's midnight", abs(e.day_start_balance(e.trading_day()) - e.day["start_bal"]) < 0.005)
    old_days = sorted({t["day"] for t in jt.values()})
    if len(old_days) > 1:
        d0 = old_days[0]
        later = sum(_f(x.get("pr")) + _f(x.get("c")) + _f(x.get("sw")) + _f(x.get("fee")) for x in e.deals.values()
                    if _f(x.get("ts")) >= dt.datetime.strptime(d0, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc).timestamp())
        ok("an older day's base = today's balance minus everything MT5 booked since that day's midnight",
           abs(e.day_start_balance(d0) - round(e.balance() - later, 2)) < 0.005, (d0, e.day_start_balance(d0)))
    v = j.view(r)
    va = next((a for a in v["accounts"] if a["id"] == aid), None)
    ok("the page gets the MT5 account: $, its settings (broker day, lockouts not blocking), today's base",
       va and va["cur"] == "USD" and va["mode"] == "mt5" and va["mt5"] == {"day": "broker", "block": False}
       and abs(va["dd_base"] - e.day["start_bal"]) < 0.005 and aid in v["today"], va)
    ok("... and the empty MT5 placeholder never", not any(a["id"] == "mt5-none" for a in v["accounts"]))
    csv = j.csv_text(r)
    ok("CSV: a Currency column (USD for MT5) and 'MT5' for trades placed there", "Currency" in csv.splitlines()[0]
       and ",USD," in csv and ",MT5\r\n" in csv, csv.splitlines()[0][:200])

    print("v0.39.0: the Indian day instead of the broker's")
    j.set_mt5(aid, {"day": "ist"})
    j.sync(r)
    jt = {k: t for k, t in j.d["trades"].items() if t["acct"] == aid and t["status"] != "removed"}
    ist_day = lambda ts: (dt.datetime.fromtimestamp(ts, journal.IST) - dt.timedelta(hours=6)).strftime("%Y-%m-%d")
    wrong = [(k, t["day"]) for k, t in jt.items() if t["day"] != ist_day(t["closed"] if t["status"] == "closed" else t["opened"])]
    ok("every MT5 trade moves to its IST day (from 06:00, like the Fyers accounts)", not wrong, wrong[:3])
    ok("today's session day follows the setting", j.day_of(e, aid) == ist_day(journal.now()))
    wrong_base = [(k, t["base"]) for k, t in jt.items()
                  if abs(t["base"] - j.mt5_base(e, aid, t["day"])) > 0.005]
    ok("... the base stays FundingPips' day-start balance (of the broker day the IST session starts in)", not wrong_base, wrong_base[:3])
    j.set_mt5(aid, {"day": "broker"})
    j.sync(r)
    ok("back to the broker's day", all(t["day"] == e.trading_day(t["closed"] if t["status"] == "closed" else t["opened"])
                                      for t in j.d["trades"].values() if t["acct"] == aid and t["status"] != "removed"))

    print("v0.39.0: the lockouts on an MT5 account (a switch, off by default)")
    j.set_settings({"rules": {"dd_pct": 0.001}})          # (today's kill-switch closes were losses: the 2% line is passed)
    st = j.today_state(aid, j.day_of(e, aid))
    ok("today's MT5 session: the trailing-drawdown lockout is worked out ($ text)", st["lock"] and st["lock"]["kind"] == "dd"
       and "$" in st["lock"]["text"] and "₹" not in st["lock"]["text"], st["lock"])
    ok("... with the account's switch off it doesn't block (shown only)", st["lock"]["mt5_off"] and not st["lock"]["on"]
       and journal.guard(r, aid) is None and e.journal_guard() is None)
    j.set_mt5(aid, {"block": True})
    g = journal.guard(r, aid)
    ok("switch on: new MT5 orders are refused by the journal (Pillar 4)", g and "Blocked by your journal (Pillar 4)" in g, g)
    ok("... through the engine's own guard too", "Blocked by your journal" in str(Paper.guard_new(e, {"s": "MT5:XAUUSD", "side": 1,
                                                                                                         "product": "MT5"})))
    ok("... and the ticket sees the lock", (e.snapshot().get("jlock") or {}).get("kind") == "dd")
    ok("the other MT5 account isn't blocked by this one's session", journal.guard(r, "mt5-21182753") is None)
    j.set_mt5(aid, {"block": False})
    j.set_settings({"rules": {"dd_pct": 2.0}})
    ok("switch off again: not blocked", journal.guard(r, aid) is None)
    try:
        j.set_mt5(r.paper_ids()[0], {"day": "ist"})
        ok("MT5 settings refused for a paper account", False)
    except ValueError:
        ok("MT5 settings refused for a paper account", True)

    print("v0.39.0: a trade from MT5 arrives in the journal as it happens")
    n0 = len([t for t in j.d["trades"].values() if t["acct"] == aid])
    bid, ask = ea.quote("XAUUSD")
    tk9 = ea.open("XAUUSD", 1, 0.02, sl=round(bid - 6, 2), tp=round(bid + 12, 2))
    await calls(ea, 2)
    t9 = j.d["trades"].get(f"{aid}:P{tk9}")
    ok("opened in MT5 -> an open journal trade at once (0.02 lot, its 1R risk, $)", t9 and t9["status"] == "open" and t9["lots"] == 0.02
       and t9["init_risk"] > 0 and t9["cur"] == "USD" and len([t for t in j.d["trades"].values() if t["acct"] == aid]) == n0 + 1, t9)
    ea.close_pos(tk9)
    await calls(ea, 2)
    t9 = j.d["trades"].get(f"{aid}:P{tk9}")
    h9 = next((h for h in e.history if h.get("ticket") == tk9), None)
    ok("closed in MT5 -> closed in the journal with MT5's net and R", t9 and h9 and t9["status"] == "closed"
       and abs(t9["net"] - h9["net"]) < 0.005 and t9["r"] is not None and abs(t9["r"] - round(h9["net"] / t9["init_risk"], 2)) < 0.011,
       (t9 and t9["net"], h9 and h9["net"]))

    print("v0.39.1: each MT5 trade's candles kept for its replay")
    from helper import jcandles
    ok("chart timeframe -> MT5's: 5m 5, 45m 15, 2h 120, 7m 1, 1D D", [jcandles.chart_res(x) for x in ("5m", "45m", "2h", "7m", "1D")]
       == ["5", "15", "120", "1", "D"])
    k9 = f"{aid}:P{tk9}"

    async def pump(cond, n=120):
        for _ in range(n):
            if cond():
                return True
            await calls(ea, 1)
        return cond()
    await pump(lambda: (jcandles.index("adm").get(k9) or {}).get("res", {}).get("1"), 800)
    e9k = jcandles.index("adm").get(k9) or {}
    w = jcandles.windows(j.d["trades"][k9], jcandles._trade_tf("adm", k9))
    ok("closed in MT5 -> its candles fetched from MT5 and kept: 1m / 5m / 15m and the chart's timeframe",
       all((e9k.get("res") or {}).get(r, [0, 0, 0])[2] > 0 for r in ("1", "5", "15")), {r: v[2] for r, v in (e9k.get("res") or {}).items()})
    kd = jcandles.load("adm", k9) or {"1": [[0]]}
    t9o = j.d["trades"][k9]["opened"]
    ok("... 1m from a day before the entry to after the exit, on the minute", kd.get("1") and kd["1"][0][0] <= t9o - 86000
       and kd["1"][-1][0] >= j.d["trades"][k9]["closed"] - 60 and all(r[0] % 60 == 0 for r in kd["1"]), (kd.get("1") or [[0]])[0][0])
    ok("... the chart's timeframe from 1,500 candles before the entry (warm-up)", w["5"][0] <= t9o - 1500 * 300 + 1)
    v9 = next((x for x in j.view(r)["trades"] if x["id"] == k9), {})
    ok("the journal tells the page what's kept", (v9.get("kept") or {}).get("res", {}).get("1", 0) > 0, v9.get("kept"))
    hist_keys = [k for k, t in j.d["trades"].items() if t["acct"] == aid and t["status"] == "closed" and k != k9]
    await pump(lambda: all(k in jcandles.index("adm") for k in hist_keys), 400)
    ok("MT5's history and the other closed trades: kept in the background too", all((jcandles.index("adm").get(k) or {}).get("at")
                                                                                     for k in hist_keys),
       [k for k in hist_keys if k not in jcandles.index("adm")][:3])
    n1 = len(kd["1"])
    with candles._lock:                                   # the saved MT5 candles cleared (e.g. the broker's clock setting)
        candles._conn(r.dir).execute("DELETE FROM bars WHERE sym LIKE 'MT5:%'")
        candles._conn(r.dir).execute("DELETE FROM cover WHERE sym LIKE 'MT5:%'")
        candles._conn(r.dir).commit()
    u5 = mt5.user("adm")
    pb = u5.price_bridge
    u5.price_bridge = lambda: None                        # ... and MT5 off
    try:
        days = int((time.time() - t9o) / 86400) + 2
        rows1 = await mt5.history("adm", r.dir, "MT5:XAUUSD", "1", days)
        ok(f"MT5 off, nothing saved: the replay's 1m candles still come, from what was kept ({len(rows1)})", len(rows1) >= n1
           and any(x[0] == kd["1"][0][0] for x in rows1))
        try:
            await mt5.history("adm", r.dir, "MT5:EURUSD", "1", 2)
            ok("a symbol with nothing kept: still 'MT5 isn't connected'", False)
        except mt5.Offline:
            ok("a symbol with nothing kept: still 'MT5 isn't connected'", True)
    finally:
        u5.price_bridge = pb
    # a worker asleep after failures (every queued trade waiting to retry) wakes for a trade that just closed
    for k in hist_keys[:2]:
        jcandles.index("adm").setdefault(k, {"s": "MT5:XAUUSD", "res": {}})["next"] = time.time() + 600
        jcandles._Q.setdefault("adm", []).append(k)
    jcandles._kick("adm")
    await asyncio.sleep(0.3)
    bid, ask = ea.quote("XAUUSD")
    tkw = ea.open("XAUUSD", 1, 0.01, sl=round(bid - 6, 2))
    await calls(ea, 2)
    ea.close_pos(tkw)
    kw = f"{aid}:P{tkw}"
    await pump(lambda: (jcandles.index("adm").get(kw) or {}).get("res", {}).get("1"), 300)
    ok("a trade that closes while the fetcher waits to retry others is kept at once", (jcandles.index("adm").get(kw) or {}).get("res", {}).get("1"))
    for k in hist_keys[:2]:
        jcandles.index("adm")[k].pop("next", None)
    zp = os.path.join(D, "jb.zip")
    info = j.backup_zip(zp)
    ok("the journal's backup holds the kept candles", info.get("candles", 0) >= 1, info)
    os.remove(jcandles._path("adm", k9))
    jcandles.index("adm").pop(k9, None)
    got = j.restore(zp)
    ok("restore puts a missing trade's candles back", got.get("candles") == 1 and jcandles.load("adm", k9).get("1"), got)

    print("v0.40.0: the day-end close")
    ok("off unless switched on", e.dayend() is None)
    for bad in ({"dayend_min": 0}, {"dayend_min": 300}, {"dayend_when": "night"}, {"dayend_scope": "some"}):
        try:
            e.set_rules(bad)
            ok(f"refused: {bad}", False)
        except Refused:
            ok(f"refused: {bad}", True)
    e.set_rules({"dayend_on": True, "dayend_min": 5, "dayend_when": "day", "dayend_scope": "all"})
    clk = e._clock()
    mid = (int(clk.to_srv(time.time())) // 86400 + 1) * 86400
    d1 = e.dayend(clk.to_utc(mid - 600))
    d2 = e.dayend(clk.to_utc(mid - 180))
    ok("5 min before the broker's midnight: not yet at -10 min, active at -3 min", d1 and not d1["active"] and d2["active"]
       and abs(d1["at"] - clk.to_utc(mid - 300)) < 1 and abs(d1["until"] - clk.to_utc(mid)) < 1, (d1, d2))
    ok("the time in IST for the page (FundingPips' midnight is 02:30 / 03:30 IST: 02:25 / 03:25)", d1["at_ist"] in ("02:25", "03:25"), d1["at_ist"])
    e.set_rules({"dayend_when": "weekend"})
    days = {}
    for k in range(7):
        x = e.dayend(clk.to_utc(mid + k * 86400 - 600))
        days[x["weekday"]] = x["today"]
    ok("only before the weekend: on the broker's Friday only", days.get("Fri") is True and not any(v for d, v in days.items() if d != "Fri"), days)
    e.set_rules({"dayend_when": "day"})
    print("v0.40.1: each symbol's own end of trading (MT5's sessions, EA 1.23)")
    sp = mt5.user("adm").specs
    ok("EA 1.23's symbol list carries each symbol's sessions", (sp.get("XAUUSD") or {}).get("ts") and len(sp["XAUUSD"]["ts"]) == 7,
       (sp.get("XAUUSD") or {}).get("ts"))
    wed = None
    for k in range(7):                                    # a Wednesday (broker's date) 10 minutes before its midnight
        tt = clk.to_utc(mid + k * 86400 - 600)
        if dt.datetime.fromtimestamp(clk.to_srv(tt), dt.timezone.utc).weekday() == 2:
            wed = tt
    d0 = int(clk.to_srv(wed)) // 86400 * 86400
    gx, ix, fx = e.dayend_for("MT5:XAUUSD", wed), e.dayend_for("MT5:US30.cash", wed), e.dayend_for("MT5:EURUSD", wed)
    ok("gold (trades to 23:57): closed 5 min before, 23:52 broker time", gx["src"] == "session" and abs(gx["at"] - clk.to_utc(d0 + 86220 - 300)) < 1, gx)
    ok("the index (a break, last session to 23:55): 23:50", abs(ix["at"] - clk.to_utc(d0 + 86100 - 300)) < 1, ix)
    ok("forex (to midnight): the broker's midnight − 5 min", abs(fx["at"] - clk.to_utc(d0 + 86400 - 300)) < 1, fx)
    t2353 = clk.to_utc(d0 + 86000)
    ok("at 23:53 broker time: gold's close has run (active), forex's not yet", e.dayend_for("MT5:XAUUSD", t2353)["active"]
       and not e.dayend_for("MT5:EURUSD", t2353)["active"] and not gx["active"])
    fri, sat = wed + 2 * 86400, wed + 3 * 86400
    gf = e.dayend_for("MT5:XAUUSD", fri)
    ok("Friday: gold's early close (23:45) -> 23:40", abs(gf["at"] - clk.to_utc(d0 + 2 * 86400 + 85500 - 300)) < 1, gf)
    gs = e.dayend_for("MT5:XAUUSD", sat)
    ok("a day the symbol doesn't trade: nothing to close", gs["today"] is False and not gs["active"], gs)
    sp_x = sp["XAUUSD"].pop("ts")
    ok("no sessions from MT5 (an older EA): the broker's midnight", e.dayend_for("MT5:XAUUSD", wed)["src"] == "midnight"
       and abs(e.dayend_for("MT5:XAUUSD", wed)["at"] - clk.to_utc(d0 + 86400 - 300)) < 1)
    sp["XAUUSD"]["ts"] = sp_x
    ok("the snapshot says sessions are known", e.snapshot()["mt5"]["dayend"]["sessions"] is True)
    real_de = e.dayend
    active = lambda t=None: {**real_de(clk.to_utc(mid - 120)), "active": True, "today": True}
    real_def = e.dayend_for
    active_for = lambda sym, t=None: {**active(), "src": "test"}
    bid, ask = ea.quote("XAUUSD")
    tkA = ea.open("XAUUSD", 1, 0.01, sl=round(bid - 6, 2))
    otA = ea.pending("XAUUSD", "limit", 1, round(bid - 30, 2), 0.01, sl=round(bid - 35, 2))
    await calls(ea, 2)
    pA = next((p for p in e.positions if p.get("ticket") == tkA), None)
    ok("a new trade from MT5 takes the ticket's mark (Hold by default)", pA and pA.get("dayend") is False and e.pos_view(pA)["dayend"] is True,
       pA and (pA.get("dayend"), e.pos_view(pA)["dayend"]))
    e.dayend = active
    e.dayend_for = active_for
    try:
        e.housekeeping()
        await calls(ea, 3)
        h = next((x for x in e.history if x.get("ticket") == tkA), None)
        ok("all trades: at the day-end time the trade is closed in MT5, reason 'day end'", tkA not in ea.positions and h and h["reason"] == "day end",
           h and h["reason"])
        ok("... and the pending order is cancelled in MT5", otA not in ea.orders and not any(o.get("ticket") == otA for o in e.orders))
        ok("... in the log", any("Day-end close" in ev["msg"] for ev in e.events))
        bid, ask = ea.quote("XAUUSD")
        pl = e.plan({"s": "MT5:XAUUSD", "side": 1, "type": "market", "mode": "lots", "lots": 0.01, "sl": round(bid - 3, 2)})
        ok("after it: a new order is refused until the broker's new day", "day-end close" in str(pl.get("blocked")), pl.get("blocked"))
        e.set_rules({"dayend_scope": "marked"})
        e.set_ticket({"dayend": False})
        pl = e.plan({"s": "MT5:XAUUSD", "side": 1, "type": "market", "mode": "lots", "lots": 0.01, "sl": round(bid - 3, 2), "dayend": False})
        ok("marked trades only: a Hold order can still be placed", "day-end" not in str(pl.get("blocked")), pl.get("blocked"))
        pl = e.plan({"s": "MT5:XAUUSD", "side": 1, "type": "market", "mode": "lots", "lots": 0.01, "sl": round(bid - 3, 2), "dayend": True})
        ok("... a day-end one can't", "day-end close" in str(pl.get("blocked")), pl.get("blocked"))
        tkB = ea.open("XAUUSD", 1, 0.01, sl=round(bid - 6, 2))
        await calls(ea, 2)
        e.housekeeping()
        await calls(ea, 2)
        ok("marked trades only: a trade set to Hold stays open", tkB in ea.positions)
        pB = next(p for p in e.positions if p.get("ticket") == tkB)
        e.set_dayend(pB["id"], True)
        ok("... marking it 'close at day end' shows on it", e.pos_view(pB)["dayend"] is True)
        e.housekeeping()
        await calls(ea, 3)
        ok("... and the next check closes it", tkB not in ea.positions)
        e.set_ticket({"dayend": True})
        tkC = ea.open("XAUUSD", -1, 0.01, sl=round(ask + 6, 2))
        await calls(ea, 2)
        pC = next((p for p in e.positions if p.get("ticket") == tkC), None)
        ok("the ticket set to 'close at day end': a trade placed in MT5 takes it", pC and pC.get("dayend") is True)
        ea.offline = True
        await calls(ea, 1)
        e.seen = 0
        e.housekeeping()
        ok("MT5 not connected at the day-end time: a warning, nothing sent", tkC in ea.positions and any("Day-end close due" in ev["msg"] for ev in e.events))
        ea.offline = False
        await calls(ea, 2)
        e.housekeeping()
        await calls(ea, 3)
        ok("MT5 back before the broker's midnight: closed then", tkC not in ea.positions)
    finally:
        e.dayend = real_de
        e.dayend_for = real_def
        e.set_rules({"dayend_on": False, "dayend_scope": "all"})
        e.set_ticket({"dayend": False})
    ok("switched off again: nothing", e.dayend() is None and e.snapshot()["mt5"]["dayend"] is None)

    print("restart")
    n_hist = len(e.history)
    e.save()
    r2 = rt.UserRT("adm")
    rt.RT["adm"] = r2
    r2.loop, r2.feed.loop = loop, loop
    e9 = r2.engines.get("mt5-21182752")
    ok("the MT5 account reopens with its trades, history, learned commission, confirmation", e9 and len(e9.history) == n_hist
       and e9.M["confirmed"] and e9.M["comm"]["XAUUSD"]["in"] == 3.5 and len(e9.positions) == len(e.positions))
    ea.dcur = (0, 0)                                      # the EA restarted: it asks where to start again
    ea.deals_asked.clear()
    ea.once = ea.once
    ea.post = terminal("adm", r2).post
    await calls(ea, 3)
    ok("deals sent again from just before the newest: nothing booked twice", len(e9.history) == n_hist and ea.deals_asked
       and ea.deals_asked[0] > ea.srv_now() - 86400 * 2, (len(e9.history), n_hist, ea.deals_asked))


try:
    asyncio.run(main())
finally:
    shutil.rmtree(D, ignore_errors=True)
print(f"\n{OK} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
