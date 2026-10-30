# Engine test: intraday square-off times, order cancels, late-order refusals, rules migration.
import os, sys, time, shutil, datetime as dt, json
HERE = os.path.dirname(os.path.abspath(__file__))
D = "/tmp/fyers_sq_test"; shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
for f in os.listdir(HERE + "/fixtures"): shutil.copy(HERE + "/fixtures/" + f, D)
os.environ["FYERS_HELPER_DATA"] = D
sys.path.insert(0, os.path.dirname(HERE))
from helper import symbols, paper
from helper.paper import Paper, Refused
symbols.refresh()
# old-style saved rules: square-off was "" (off) -> stays off; otherwise on
os.makedirs(D + "/a1"); json.dump({"squareoff": "", "squareoff_eq": "", "size": 25000}, open(D + "/a1/paper_rules.json", "w"))
print("old off ->", Paper("a1/", None, "x").rules["squareoff_on"])
os.makedirs(D + "/a2"); json.dump({"squareoff": "23:15", "squareoff_eq": "15:15", "size": 25000}, open(D + "/a2/paper_rules.json", "w"))
r2 = Paper("a2/", None, "x").rules; print("old on ->", r2["squareoff_on"], "old keys dropped:", "squareoff" not in r2)
E = Paper("t/", None, "t"); E.rules.update(size=500000, max_margin_pct=0, risk_cap_pct=0, daily_pct=0, max_pct=0, max_open_risk_pct=0); E.acct.update(start=500000, peak=500000)
T = [dt.datetime(2026, 11, 2, 10, 0, tzinfo=paper.IST)]
paper.ist = lambda ts=None: dt.datetime.fromtimestamp(ts, paper.IST) if ts else T[0]
def tick(s, p): E.on_tick({"s": s, "ltp": p, "bid": p - 1, "ask": p + 1, "t": int(time.time())})
F, N, R, X = "MCX:CRUDEOIL26NOVFUT", "NSE:NIFTY26NOVFUT", "NSE:RELIANCE-EQ", "BSE:SENSEX26NOVFUT"
for s, p in ((F, 5600), (N, 24000), (R, 1400), (X, 80000)): tick(s, p)
print("today", E.squareoff_today())
E.place({"s": N, "side": 1, "type": "market", "sl": 23900, "mode": "lots", "lots": 1, "product": "INTRADAY"})
E.place({"s": N, "side": -1, "type": "market", "sl": 24100, "mode": "lots", "lots": 1, "product": "MARGIN"})
E.place({"s": N, "side": 1, "type": "limit", "price": 23800, "sl": 23700, "mode": "lots", "lots": 1, "product": "INTRADAY"})
E.place({"s": X, "side": 1, "type": "limit", "price": 79000, "sl": 78900, "mode": "lots", "lots": 1, "product": "MARGIN"})
E.place({"s": R, "side": 1, "type": "market", "sl": 1390, "mode": "lots", "lots": 1, "product": "INTRADAY"})
E.place({"s": F, "side": 1, "type": "market", "sl": 5590, "mode": "lots", "lots": 1, "product": "INTRADAY"})
show = lambda w: print(w, "pos", sorted((p["s"].split(":")[1], p["product"]) for p in E.positions), "ord", sorted((o["s"].split(":")[1], o["product"]) for o in E.orders))
show("10:00")
for hm in ("14:59", "15:00", "15:19", "15:20", "23:39", "23:40"):
    T[0] = T[0].replace(hour=int(hm[:2]), minute=int(hm[3:])); 
    for s, p in ((F, 5600), (N, 24000), (R, 1400), (X, 80000)): tick(s, p)
    E.housekeeping(); show(hm)
print("reasons", [h["reason"] for h in E.history])
T[0] = T[0].replace(hour=15, minute=21)
for prod in ("INTRADAY", "MARGIN"):
    try: E.plan({"s": N, "side": 1, "type": "market", "sl": 23900, "mode": "lots", "lots": 1, "product": prod}); print(prod, "allowed after 15:20")
    except Refused as e: print(prod, "refused:", e)
T[0] = T[0].replace(hour=15, minute=10)
try: E.plan({"s": R, "side": 1, "type": "market", "sl": 1390, "mode": "lots", "lots": 1, "product": "INTRADAY"}); print("RELIANCE intraday 15:10 allowed?!")
except Refused as e: print("RELIANCE intraday 15:10 refused:", e)
# summer date: MCX at 23:15
T[0] = dt.datetime(2026, 10, 30, 12, 0, tzinfo=paper.IST); print("30 Oct", E.squareoff_today())
# rules validation
for bad in ({"fy_sq_fo": "3:25pm"}, {"fy_sq_fo": ""}, {"sq_before_min": 90}):
    try: E.set_rules(bad); print("accepted?!", bad)
    except Refused as e: print("refused", bad, "->", e)
E.set_rules({"fy_sq_fo": "15:30", "sq_before_min": 10, "squareoff_on": False}); print("saved", E.rules["fy_sq_fo"], E.rules["sq_before_min"], E.squareoff_today())
