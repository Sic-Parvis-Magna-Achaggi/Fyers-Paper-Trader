# Engine test (v0.32.0, LiveTrader 1.24): per-trade trailing from the entry line, the panel taking every trade back, and
# the RR lock (the stop worked out from a dragged target, net of every charge, at the lots it sizes to). No browser.
#   python3 tests/trail_rr_test.py
import os, sys, time, shutil, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
D = "/tmp/fyers_trail_rr_test"; shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
for f in os.listdir(HERE + "/fixtures"): shutil.copy(HERE + "/fixtures/" + f, D)
os.environ["FYERS_HELPER_DATA"] = D
sys.path.insert(0, os.path.dirname(HERE))
from helper import symbols, paper
from helper.paper import Paper, Refused
symbols.refresh()
paper.ist = lambda ts=None: dt.datetime.fromtimestamp(ts, paper.IST) if ts else dt.datetime(2026, 11, 2, 11, 0, tzinfo=paper.IST)

PASS = FAIL = 0
def ok(c, m):
    global PASS, FAIL
    PASS += bool(c); FAIL += not c
    print(("PASS " if c else "FAIL ") + m)

E = Paper("t/", None, "t")
E.rules.update(size=500000, max_margin_pct=0, risk_cap_pct=0, daily_pct=0, max_pct=0, max_open_risk_pct=0, sl_required=False)
E.acct.update(start=500000, peak=500000)
def tick(s, p): E.on_tick({"s": s, "ltp": p, "bid": p - 1, "ask": p + 1, "t": int(time.time())})
F, N = "MCX:CRUDEOIL26NOVFUT", "NSE:NIFTY26NOVFUT"
tick(F, 5600); tick(N, 24000)

# ---------------------------------------------------------------- per-trade trailing
E.place({"s": N, "side": 1, "type": "market", "sl": 23900, "mode": "lots", "lots": 1, "product": "INTRADAY"})
E.place({"s": F, "side": 1, "type": "market", "sl": 5590, "mode": "lots", "lots": 1, "product": "INTRADAY"})
pN = next(p for p in E.positions if p["s"] == N); pF = next(p for p in E.positions if p["s"] == F)
tr = lambda p: p["tr"]
ok(not tr(pN)["be_on"] and not tr(pN).get("own_be"), "a new trade follows the panel (Trail BE off)")

E.set_pos_trail(pN["id"], {"be_r": 0.5})
ok(tr(pN)["be_on"] and tr(pN)["be_r"] == 0.5 and tr(pN)["own_be"], "typing a trade's BE R switches its Trail BE on, its own setting")
ok(not tr(pF)["be_on"], "the other trade is untouched")
E.set_pos_trail(pN["id"], {"sl_r": 2})
ok(tr(pN)["sl_on"] and tr(pN)["sl_r"] == 2 and tr(pN)["own_sl"], "typing a trade's Trail SL R switches it on")
E.set_pos_trail(pN["id"], {"sl_on": False, "sl_r": 2})
ok(not tr(pN)["sl_on"] and tr(pN)["sl_r"] == 2, "the switch on the line turns it off again (R kept)")

E.set_trail({"sl_on": True, "sl_r": 1.5})
ok(all(tr(p)["sl_on"] and tr(p)["sl_r"] == 1.5 and not tr(p)["own_sl"] for p in (pN, pF)),
   "the panel's Trail SL takes every open trade back (switch and R)")
ok(tr(pN)["be_on"] and tr(pN)["be_r"] == 0.5 and tr(pN)["own_be"], "...and leaves each trade's own Trail BE alone")
E.set_trail({"be_r": 1.2})
ok(not tr(pN)["be_on"] and tr(pN)["be_r"] == 1.2 and not tr(pN)["own_be"],
   "changing the panel's Trail BE R makes the trade follow the panel's Trail BE (off, 1.2R), as LiveTrader 1.24")
E.set_trail({"sl_on": False})

# Trail BE fires per trade: N at its own 0.5R, F (panel: off) doesn't move
E.set_pos_trail(pN["id"], {"be_r": 0.5})
sl0F = pF["sl"]
tick(N, 24070); tick(F, 5606)                    # N about 0.7R up (R = 101 points), F 0.6R up
ok(pN["be_done"] and pN["sl"] > 24001, f"N's own Trail BE at 0.5R moved its stop to break-even + costs ({pN['sl']})")
ok(pF["sl"] == sl0F and not pF["be_done"], "F (Trail BE off) kept its stop")
v = E.pos_view(pN) if hasattr(E, "pos_view") else None
if v is not None:
    ok(v["tr"].get("own_be") is True and v.get("be_done"), "the trade's view carries its own-setting flag and BE done")
E.set_pos_trail(pN["id"], {"be_on": False, "be_r": 0.5}); E.set_pos_trail(pN["id"], {"be_on": True, "be_r": 0.5})
ok(pN["be_done"], "switching Trail BE off and on again with the stop already at BE doesn't re-arm it")
for p in list(E.positions): E.close(p, E.exit_mark(p), "test")

# ---------------------------------------------------------------- the RR lock
def lock(req):
    return E.plan({**req, "tp": None})
def rr_exact(p):
    return p["reward"] / p["risk"]
base = {"s": N, "side": 1, "type": "market", "mode": "pct", "risk_pct": 1, "product": "INTRADAY", "tp_r": 2}
p = lock({**base, "lock_tp": 24200})
e = p["entry"]
ok(p["sl"] is not None and p["sl"] < e, f"long, target dragged to 24200: stop worked out at {p['sl']} (entry {e})")
ok(2.0 <= rr_exact(p) < 2.1, f"net RR at that stop: {rr_exact(p):.3f} (wanted 2, after all charges)")
ok(abs(p["tp"] - 24200) <= 1.0, f"its target from the RR is back at the dragged price: {p['tp']}")
wider = E.plan({**base, "tp_r": None, "sl": p["sl"] - 0.1, "tp": 24200})
ok(rr_exact(wider) < 2.0, f"one tick wider would be under 2R ({rr_exact(wider):.3f}): the widest stop that keeps the RR")
same = E.plan({**base, "tp_r": None, "sl": p["sl"], "tp": 24200})
ok(rr_exact(same) >= 2.0, f"and at the stop itself with the target exactly 24200: {rr_exact(same):.3f}")

p3 = lock({**base, "tp_r": 3, "lock_tp": 24200})
ok(p3["sl"] > p["sl"] and 3.0 <= rr_exact(p3) < 3.15, f"RR 3: a tighter stop {p3['sl']}, net RR {rr_exact(p3):.3f}")
pl = lock({**base, "mode": "lots", "lots": 2, "lock_tp": 24150})
ok(pl["lots"] == 2 and 2.0 <= rr_exact(pl) < 2.1, f"fixed 2 lots: stop {pl['sl']}, net RR {rr_exact(pl):.3f}")

sb = {"s": F, "side": -1, "type": "market", "mode": "pct", "risk_pct": 1, "product": "INTRADAY", "tp_r": 2}
ps = lock({**sb, "lock_tp": 5560})
ok(ps["sl"] > ps["entry"] and 2.0 <= rr_exact(ps) < 2.15, f"short CRUDEOIL, target 5560: stop {ps['sl']} above entry {ps['entry']}, net RR {rr_exact(ps):.3f}")
pk = lock({**sb, "type": "limit", "price": 5610, "lock_tp": 5580})
ok(pk["entry"] == 5610 and pk["sl"] > 5610 and 2.0 <= rr_exact(pk) < 2.15, f"short limit at 5610, target 5580: stop {pk['sl']}, net RR {rr_exact(pk):.3f}")

# the rules stop the stop going wider (risk cap): the widest stop that still trades, and a note saying so
E.rules.update(risk_cap_pct=0.5)                 # ₹2,500 on ₹5,00,000: 1 NIFTY lot can risk only a few dozen points
pc = lock({**base, "mode": "lots", "lots": 1, "lock_tp": 24400})
ok(pc.get("lock_note") and pc["lots"] == 1 and 2.0 <= rr_exact(pc) < 2.1 and pc["tp"] < 24400,
   f"risk cap: stop held at {pc['sl']}, target back at 2R ({pc['tp']}), note: {pc.get('lock_note')}")
E.rules.update(risk_cap_pct=0)
ok(not lock({**base, "lock_tp": 24200}).get("lock_note"), "no note when the rules allow it")
pz = lock({**base, "mode": "lots", "lots": 1, "lock_tp": pc["entry"] + 1})
ok(pz.get("lock_note") and "too close" in pz["lock_note"] and pz["sl"] == round(pz["entry"] - 0.1, 1) and 2.0 <= rr_exact(pz) < 2.1,
   f"a target 1 point away can't be 2R after charges: the closest stop ({pz['sl']}), target back at 2R ({pz['tp']}), note: {pz.get('lock_note')}")

for bad, why in (({**base, "lock_tp": 23900}, "target on the wrong side"), ({**base, "tp_r": 0, "lock_tp": 24200}, "no RR")):
    try:
        lock(bad); ok(False, f"{why}: refused")
    except Refused as ex:
        ok(True, f"{why}: refused ({ex})")

E.set_ticket({"rr_lock": True, "tp_r": 2.5})
ok(Paper("t/", None, "t").ticket["rr_lock"] is True, "the lock is saved with the ticket defaults (survives a restart)")

print(f"trail_rr_test: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
