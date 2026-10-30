"""Order-flow check (helper/feedcheck.py) with hand-made snapshots. Run: python3 tests/feedcheck_test.py"""
import gzip, json, os, shutil, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
D = "/tmp/fyers_feedcheck_test"
shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
for f in os.listdir(HERE + "/fixtures"):
    shutil.copy(HERE + "/fixtures/" + f, D)
os.environ["FYERS_HELPER_DATA"] = D
sys.path.insert(0, os.path.dirname(HERE))
from helper import symbols  # noqa: E402
from helper.feedcheck import FeedCheck  # noqa: E402
symbols.refresh()
fails = []


def ok(c, m, d=""):
    print(("PASS " if c else "FAIL ") + m + ("" if c else f"  <- {d}"))
    if not c:
        fails.append(m)


fc = FeedCheck()
cfg = fc.config()
ok(cfg["symbols"] == ["MCX:CRUDEOIL26NOVFUT", "NSE:NIFTY26NOVFUT"], "defaults: the nearest CRUDEOIL and NIFTY futures", cfg)
S = "MCX:CRUDEOIL26NOVFUT"
seq = [  # (vol, ltq, ltp)  -> what it should count as
    (1000, 2, 5600),   # first: the baseline only
    (1002, 2, 5601),   # +2, last trade 2: exact
    (1002, 2, 5601),   # +0: a quote change
    (1007, 5, 5600),   # +5, last 5: exact
    (1017, 3, 5602),   # +10, last 3: merged (at least 2 trades; 3 of the 10 at a known price)
    (1018, 1, 5602),   # +1, last 1: exact
]
for vol, ltq, ltp in seq:
    fc.record({"s": S, "src": "ws", "vol": vol, "ltq": ltq, "ltp": ltp, "bid": ltp - 1, "ask": ltp + 1, "t": int(time.time())})
fc.record({"s": S, "src": "poll", "vol": 99999, "ltq": 1, "ltp": 1})            # polled quotes don't count
fc.record({"s": "NSE:RELIANCE-EQ", "src": "ws", "vol": 5, "ltq": 5, "ltp": 1})  # not on the list
r = fc.report()
c = r["symbols"][S]
ok(c["updates"] == 6, "6 socket snapshots counted (the poll and other contracts aren't)", c["updates"])
ok(c["trade_updates"] == 4 and c["exact_updates"] == 3 and c["merged_updates"] == 1, "4 with trades: 3 exact, 1 merged", c)
ok(c["vol"] == 18 and c["exact_vol"] == 8 and c["merged_vol"] == 10, "volume 18: 8 exact, 10 merged", c)
ok(c["exact_vol_pct"] == 44.44 and c["known_vol_pct"] == 61.11, "44.44% of volume exact; 61.11% at a known price (8 + 3 of 18)", c)
ok(c["max_merge"] == 10 and "NSE:RELIANCE-EQ" not in r["symbols"], "largest merged snapshot 10; others not recorded", r["symbols"].keys())
fc.flush()
lines = [json.loads(x) for x in gzip.open(f"{D}/feedcheck/{r['day']}.jsonl.gz", "rt")]
ok(len(lines) == 6 and lines[4]["k"] == "merged" and lines[4]["dv"] == 10, "every snapshot written to the day's file, with its kind", lines[4])
fc2 = FeedCheck()                                                                 # a restart keeps the day's counts
ok(fc2.report()["symbols"][S]["vol"] == 18, "counts survive a restart")
try:
    fc.set_config(syms=["MCX:NOPE"])
    ok(False, "unknown contracts refused")
except ValueError:
    ok(True, "unknown contracts refused")
print("ALL PASSED" if not fails else f"{len(fails)} FAILED")
sys.exit(1 if fails else 0)
