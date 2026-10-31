"""Saved candles (helper/candles.py) and the history request (helper/fyers_link.py), no browser.
Run: python3 tests/candles_test.py

Owner's report, 1 Nov 2026: GOLDPETAL NOV's 30 Oct showed the expiring OCT contract (319 lots, trading till 16:58,
then 14,201 to the close) because history was asked for with cont_flag=1 (Fyers' continuous series). Checks:
- the request to Fyers never carries cont_flag;
- the one-time clean-out drops saved futures / options candles (stocks and indices stay);
- a day fetched again replaces what was saved for it (nothing left behind); an empty answer changes nothing."""
import datetime as dt
import os
import shutil
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
D = "/tmp/fyers_candles_test"
shutil.rmtree(D, ignore_errors=True)
os.makedirs(D + "/u/t")
os.environ["FYERS_HELPER_DATA"] = D
sys.path.insert(0, os.path.dirname(HERE))
from helper import candles, fyers_link  # noqa: E402

fails = []


def ok(c, m, d=""):
    print(("PASS " if c else "FAIL ") + m + ("" if c else f"  <- {d}"))
    if not c:
        fails.append(m)


IST = candles.IST
today = dt.datetime.now(IST).date()
day = lambda d, hh, mm=0: int(dt.datetime(d.year, d.month, d.day, hh, mm, tzinfo=IST).timestamp())
NOV, STK = "MCX:GOLDPETAL26NOVFUT", "NSE:SBIN-EQ"

# ---- the request: no cont_flag
link = fyers_link.FyersLink("u/t/", "test")
seen = []
link._get = lambda url, params: (seen.append(dict(params)), {"s": "ok", "candles": []})[1]
link.history_range(NOV, "15", today - dt.timedelta(days=3), today)
ok(seen and all("cont_flag" not in p for p in seen), "history asks Fyers for the contract itself (no cont_flag)", seen[:1])

# ---- an old candles.db (before v0.20.6): futures candles from the continuous series, and a stock's
db = sqlite3.connect(D + "/u/t/candles.db")
db.execute("CREATE TABLE bars (sym TEXT, res TEXT, t INTEGER, o REAL, h REAL, l REAL, c REAL, v REAL, PRIMARY KEY (sym, res, t)) WITHOUT ROWID")
db.execute("CREATE TABLE cover (sym TEXT, res TEXT, first_day TEXT, fetched REAL, PRIMARY KEY (sym, res))")
d1 = today - dt.timedelta(days=1)
for sym in (NOV, "NFO:NIFTY26NOV24000CE", "NFO:NIFTY26NOV23000PE", STK):
    db.executemany("INSERT INTO bars VALUES (?,?,?,?,?,?,?,?)", [(sym, "15", day(d1, 9, 15 * i), 1, 1, 1, 1, 5) for i in range(4)])
    db.execute("INSERT INTO cover VALUES (?,?,?,?)", (sym, "15", d1.isoformat(), 0))
db.commit(); db.close()
c = candles._conn("u/t/")
left = dict(c.execute("SELECT sym, COUNT(*) FROM bars GROUP BY sym").fetchall())
ok(left == {STK: 4}, "the clean-out drops saved futures and options candles; the stock's stay", left)
ok(c.execute("SELECT COUNT(*) FROM cover WHERE sym=?", (NOV,)).fetchone()[0] == 0, "so the futures chart fetches again from Fyers")
candles._dbs.clear()
c = candles._conn("u/t/")
c.execute("INSERT INTO bars VALUES (?,?,?,?,?,?,?,?)", (NOV, "15", day(d1, 9), 2, 2, 2, 2, 9)); c.commit()
ok(c.execute("SELECT COUNT(*) FROM bars WHERE sym=?", (NOV,)).fetchone()[0] == 1, "it runs once (candles saved after it stay)")
c.execute("DELETE FROM bars WHERE sym=?", (NOV,)); c.commit()


# ---- a day fetched again replaces the saved day
class FakeLink:
    dir = "u/t/"

    def __init__(self):
        self.answer = {}

    def history_range(self, symbol, res, a, b):
        return [r for r in self.answer.get(symbol, []) if day(a, 0) <= r[0] < day(b + dt.timedelta(days=1), 0)]


fl = FakeLink()
# first fetch: the spliced day (a few real candles, then the settlement price with no volume till the close)
spliced = [[day(d1, 9) + 900 * i, 14160, 14170, 14150, 14165, 5] for i in range(4)] + [[day(d1, 17) + 900 * i, 14201, 14201, 14201, 14201, 0] for i in range(26)]
fl.answer[NOV] = spliced
rows = candles.get(fl, NOV, "15", 3)
ok(len(rows) == 30, "first fetch saves Fyers' answer", len(rows))
# later: the exact contract, 09:00-23:15 every 15 min with volume (no candle at 23:30-23:45, which the splice had)
exact = [[day(d1, 9) + 900 * i, 14300 - i, 14305 - i, 14290 - i, 14298 - i, 3000] for i in range(58)]
fl.answer[NOV] = exact
c.execute("UPDATE cover SET fetched=0 WHERE sym=?", (NOV,)); c.commit()
rows = candles.get(fl, NOV, "15", 3)
ghost = [r for r in rows if r[4] == 14201]
ok(len(rows) == 58 and not ghost, f"fetched again: the day is exactly Fyers' new answer ({len(rows)} candles, {len(ghost)} left over)", (len(rows), len(ghost)))
fl.answer[NOV] = []
c.execute("UPDATE cover SET fetched=0 WHERE sym=?", (NOV,)); c.commit()
rows = candles.get(fl, NOV, "15", 3)
ok(len(rows) == 58, "an empty answer (Fyers busy / no data) leaves the saved candles alone", len(rows))


# ---- Fyers corrects a day a few days later (after newer days are saved): the correction reaches the saved candles
d3 = today - dt.timedelta(days=3)
fl.answer[NOV] = [[day(d3, 9) + 900 * i, 14201, 14201, 14201, 14201, 0] for i in range(10)] + exact
c.execute("UPDATE cover SET fetched=0, first_day=? WHERE sym=?", ((today - dt.timedelta(days=5)).isoformat(), NOV)); c.commit()
candles.get(fl, NOV, "15", 5)
fixed = [[day(d3, 9) + 900 * i, 14300, 14310, 14290, 14305, 2500] for i in range(10)] + exact
fl.answer[NOV] = fixed
c.execute("UPDATE cover SET fetched=0 WHERE sym=?", (NOV,)); c.commit()
rows = candles.get(fl, NOV, "15", 5)
d3rows = [r for r in rows if day(d3, 0) <= r[0] < day(d3 + dt.timedelta(days=1), 0)]
ok(len(d3rows) == 10 and all(r[4] == 14305 and r[5] == 2500 for r in d3rows),
   "a day Fyers corrects 3 days later is replaced on the next fetch (the week before is re-checked)", d3rows[:2])

print("ALL PASSED" if not fails else f"{len(fails)} FAILED")
sys.exit(1 if fails else 0)
