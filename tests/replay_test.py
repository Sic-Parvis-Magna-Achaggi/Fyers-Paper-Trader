# Trade replay test (no browser): helper/jreplay.py and the engine's stop path, with real paper engines and the journal.
#  - the engine records every stop / target move with its time and kind (open, be, trail, edit, add); the history record
#    and the journal trade carry it; a live part keeps its own copy
#  - entry snapshot from the chart the order came from (PLACE's set-up), also for a limit that fills later; exit snapshot
#    from the same layout chart; the Pine code and the drawings as they were at each moment (later edits don't change
#    them); content stored once; no set-up sent: the saved layout's chart for that contract, else your chart on it
#  - an older trade's stop path rebuilt from the account's log (never from candles); the "ends" fallback
#  - the net ₹ at a time and price, with an add and a partial close, matches charges.net_at
#  - automatic pictures off by default and after an upgrade; turning them on again sticks
# Run: python3 tests/replay_test.py
import datetime as dt
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
D = "/tmp/fyers_replay_test"
shutil.rmtree(D, ignore_errors=True)
os.makedirs(D)
for f in os.listdir(HERE + "/fixtures"):
    if not f.endswith(".js") and not f.endswith(".pine"):
        shutil.copy(HERE + "/fixtures/" + f, D)
os.environ["FYERS_HELPER_DATA"] = D
sys.path.insert(0, os.path.dirname(HERE))
from helper import charges, journal, jreplay, jshots, paper, rt, store, symbols  # noqa: E402
from helper.paper import Paper  # noqa: E402

symbols.refresh()
FAIL, N_OK = [], [0]


def ok(cond, what):
    if cond:
        N_OK[0] += 1
    else:
        FAIL.append(what)
        print("FAIL:", what)


T0 = dt.datetime(2026, 11, 2, 10, 0, tzinfo=paper.IST).timestamp()
T = [T0]
paper.now = lambda: T[0]
journal.now = lambda: T[0]
jreplay.now = lambda: T[0]
paper.ist = lambda ts=None: dt.datetime.fromtimestamp(ts if ts else T[0], paper.IST)
jshots.queue = lambda job, delay=0: None        # (pictures aren't what's tested here)


class Feed:
    loop = None

    def broadcast(self, msg, acct=None):
        pass


class FakeURT:
    def __init__(self, uid):
        self.uid, self.label, self.engines, self._accts, self.feed = uid, uid, {}, [], Feed()

    def accounts(self):
        return self._accts

    def add(self, aid, name, size=500000.0):
        self._accts.append({"id": aid, "name": name, "mode": "paper", "capital": size})
        e = Paper(f"u/{self.uid}/a/{aid}/", None, name)
        e.rules.update(size=size, max_margin_pct=0, risk_cap_pct=0, daily_pct=0, max_pct=0, sl_required=False, squareoff_on=False,
                       max_trades=0)
        e.acct.update(start=size, peak=size)
        e.journal_hook = lambda kind, obj, aid=aid: journal.on_trade(self, aid, kind, obj)
        e.journal_guard = lambda aid=aid: journal.guard(self, aid)
        e.journal_lock = lambda aid=aid: journal.lock_state(self, aid)
        self.engines[aid] = e
        return e


U = FakeURT("u1")
rt.RT["u1"] = U
E = U.add("A1", "Main")
F = "MCX:CRUDEOIL26NOVFUT"
J = journal.get("u1")
J.sync(U, full=True)
J.set_settings({"rules": {"block_dd": False, "block_afk": False, "block_end": False}})


def tick(p):
    E.on_tick({"s": F, "ltp": p, "bid": p - 1, "ask": p + 1, "t": int(T[0]), "rt": T[0]})


# ---- the user's saved chart things: a layout with two charts, prefs, two Pine scripts, drawings on the contract
IND = [{"type": "vol", "id": "v1"}, {"type": "pine", "id": "p1", "scriptId": "s1", "inputs": {"len": 21}, "style": {"plots": {"EMA": {"width": 3}}}}]
LAY = {"layouts": [{"id": "L1", "name": "MCX desk", "grid": "2v", "updated": 5, "charts": [
    {"cur": {"s": "MCX:GOLDPETAL26NOVFUT", "d": "GOLDPETAL"}, "tf2": "1h", "ctype": {"type": "candles"}, "indicators": []},
    {"cur": {"s": F, "d": "CRUDEOIL"}, "tf2": "15m", "ctype": {"type": "heikin"}, "indicators": IND, "chart": {"up": "#00ff00"}}]}],
    "active": "L1"}
store.save("u/u1/layouts.json", LAY)
store.save("u/u1/prefs.json", {"cur": {"s": "NSE:SBIN-EQ"}, "tf2": "5m", "indicators": [{"type": "vol", "id": "vv"}]})
SRC1 = '//@version=5\nindicator("My EMA", overlay=true)\nplot(ta.ema(close, input.int(21, "len")), "EMA")\n'
LIB = '//@version=5\nlibrary("MyLib")\nexport f(x) => x * 2\n'
store.save("u/u1/scripts.json", {"scripts": [{"id": "s1", "name": "My EMA", "source": SRC1}, {"id": "s2", "name": "MyLib", "source": LIB}]})
DRW1 = [{"id": "d1", "type": "hline", "pts": [{"t": T0 + 19800, "p": 6250}], "st": {}}]
store.save(jreplay.draw_file("u/u1/", F), {"s": F, "items": DRW1, "updated": 1})

# ================================================================ A. a trade from the chart (cell 1 of the layout)
SETUP = {"cur": {"s": F, "d": "CRUDEOIL"}, "tf2": "5m", "ctype": {"type": "renko"}, "indicators": IND, "chart": {"up": "#123456"}, "lgdMin0": True,
         "junk": "dropped"}
order = {"s": F, "side": 1, "type": "market", "sl": 6180, "tp": 6280, "mode": "lots", "lots": 2, "product": "INTRADAY",
         "setup": SETUP, "from": {"lay": "L1", "cell": 1}}
tick(6200)
jreplay.note_order("u1", "A1", order)
E.trail.update(be_on=True, be_r=1.0, sl_on=True, sl_r=1.0)
E.place(order)
pos = E.positions[0]
key = f"A1:{pos['id']}"
ok(pos["path"][0][1] == 6180 and pos["path"][0][2] == 6280 and pos["path"][0][3] == "open", "path: starts with the first stop and target")
rec = jreplay.load("u1", key)
ok(rec.get("entry", {}).get("src") == "order", "entry snapshot: from the order's chart")
ch = rec["entry"]["chart"]
ok(ch["tf2"] == "5m" and ch["ctype"]["type"] == "renko" and ch["indicators"][1]["inputs"]["len"] == 21 and ch["lgdMin0"] is True and "junk" not in ch,
   "entry snapshot: the chart's own timeframe, type, indicators with settings (nothing else)")
ok(rec["entry"]["where"]["lay"] == "L1" and rec["entry"]["where"]["cell"] == 1 and rec["entry"]["where"]["name"] == "MCX desk", "entry snapshot: which layout chart")
ok(jreplay.recorded("u1") == {key}, "the index lists the recorded trade")
# the trade runs: a 1R move -> BE, trail steps; an add; a hand edit of the target
T[0] += 60; tick(6222)
T[0] += 60; tick(6245)
T[0] += 60; tick(6262)
E.modify_pos(pos["id"], tp=6300)
T[0] += 60; tick(6270)
T[0] += 60
E.place({"s": F, "side": 1, "type": "market", "mode": "lots", "lots": 1, "product": "INTRADAY", "sl": None})
kinds = [p[3] for p in E.positions[0]["path"]]
ok("be" in kinds or "trail" in kinds, f"path: BE / trail steps recorded ({kinds})")
ok("edit" in kinds and E.positions[0]["path"][kinds.index("edit")][2] == 6300, "path: the hand edit of the target, with the new target")
ok(all(E.positions[0]["path"][i][0] <= E.positions[0]["path"][i + 1][0] for i in range(len(kinds) - 1)), "path: in time order")
sl_seq = [p[1] for p in E.positions[0]["path"]]
ok(all(sl_seq[i] <= sl_seq[i + 1] for i in range(len(sl_seq) - 1)), "path: a long's stop never goes back")
# later changes to the scripts and drawings: the entry's copy keeps the old ones
SRC2 = SRC1.replace("ta.ema", "ta.sma")
store.save("u/u1/scripts.json", {"scripts": [{"id": "s1", "name": "My EMA", "source": SRC2}, {"id": "s2", "name": "MyLib", "source": LIB}]})
DRW2 = DRW1 + [{"id": "d2", "type": "trend", "pts": [{"t": T0 + 19800, "p": 6200}, {"t": T0 + 19800 + 600, "p": 6260}], "st": {}}]
store.save(jreplay.draw_file("u/u1/", F), {"s": F, "items": DRW2, "updated": 2})
T[0] += 300; tick(6290)
E.close_now(E.positions[0]["id"])
h = E.history[-1]
ok(h.get("path") and h["path"][0][3] == "open" and len(h["path"]) == len(kinds) or len(h["path"]) >= len(kinds), "history: the record carries the path")
t = J.d["trades"][key]
ok(t["status"] == "closed" and t.get("path") and t["path"] == h["path"], "journal: the trade keeps the path")
rec = jreplay.load("u1", key)
ok(rec.get("exit", {}).get("src") == "layout" and rec["exit"]["where"]["cell"] == 1, "exit snapshot: the same layout chart as the entry")
ok(rec["exit"]["chart"]["tf2"] == "15m" and rec["exit"]["chart"]["ctype"]["type"] == "heikin", "exit snapshot: that chart as saved in the layout then")
fe, fx = jreplay.full("u1", rec["entry"]), jreplay.full("u1", rec["exit"])
ok(next(s for s in fe["scripts"] if s["id"] == "s1")["source"] == SRC1 and next(s for s in fx["scripts"] if s["id"] == "s1")["source"] == SRC2,
   "Pine code: the entry keeps the code as it was then, the exit the code then")
ok(any(s["name"] == "MyLib" and s["source"] == LIB for s in fe["scripts"]), "Pine code: libraries kept too (imports resolve the same way)")
ok(len(fe["drawings"]) == 1 and len(fx["drawings"]) == 2, "drawings: as they were at the entry, and at the exit")
ok(len(os.listdir(D + "/u/u1/replay/code")) == 3, "code stored once per version (2 versions of My EMA + the library)")
v = jreplay.view(U, J.d["trades"][key])
ok(v["path_src"] == "recorded" and v["trade"]["s"] == F and v["setup"]["entry"]["chart"]["tf2"] == "5m" and v["be"] and v["row"]["s"] == F,
   "view: facts, recorded path, set-ups, BE, the contract")
avg_ = J.d["trades"][key]["avg"]
ok(isinstance(v["be"], float) and avg_ < v["be"] < avg_ + 10, f"view: BE + costs just above the average entry after the add ({v['be']} vs {avg_})")
vj = J.view(U)
row = next(x for x in vj["trades"] if x["id"] == key)
ok("path" not in row and row["replay"] is True, "the journal list doesn't carry the path; it marks the trade as recorded")

# ================================================================ B. a limit that fills later (the page long closed)
T[0] += 600; tick(6300)
lim = {"s": F, "side": -1, "type": "limit", "price": 6320, "sl": 6340, "tp": 6280, "mode": "lots", "lots": 1, "product": "INTRADAY",
       "setup": {**SETUP, "tf2": "3m"}, "from": {"lay": "L1", "cell": 1}}
jreplay.note_order("u1", "A1", lim)
E.place(lim)
ok(not E.positions and E.orders, "limit: waiting")
journal.J.clear()                                            # (a server restart in between)
J = journal.get("u1")
T[0] += 3600; tick(6322)
ok(E.positions and E.positions[0]["side"] == -1, "limit: filled")
k2 = f"A1:{E.positions[0]['id']}"
r2 = jreplay.load("u1", k2)
ok(r2.get("entry", {}).get("src") == "order" and r2["entry"]["chart"]["tf2"] == "3m", "limit filled later: the entry has the chart it was placed from")
ok(store.load("u/u1/replay/pending.json", {}) == {}, "the set-up is used once")
T[0] += 60; tick(6310)
E.close_now(E.positions[0]["id"])

# ================================================================ C. no set-up sent
T[0] += 60; tick(6300)
E.place({"s": F, "side": 1, "type": "market", "sl": 6280, "mode": "lots", "lots": 1, "product": "INTRADAY"})
k3 = f"A1:{E.positions[0]['id']}"
ok(jreplay.load("u1", k3)["entry"]["src"] == "layout" and jreplay.load("u1", k3)["entry"]["chart"]["tf2"] == "15m",
   "no set-up with the order: the saved layout's chart for that contract")
T[0] += 60; tick(6305)
E.close_now(E.positions[0]["id"])
store.save("u/u1/layouts.json", {"layouts": [], "active": ""})
T[0] += 60; tick(6300)
E.place({"s": F, "side": 1, "type": "market", "sl": 6280, "mode": "lots", "lots": 1, "product": "INTRADAY"})
k4 = f"A1:{E.positions[0]['id']}"
e4 = jreplay.load("u1", k4)["entry"]
ok(e4["src"] == "other" and e4["chart"]["cur"]["s"] == F and e4["chart"]["tf2"] == "5m" and e4["chart"]["indicators"][0]["id"] == "vv",
   "no chart of the contract anywhere: your chart's set-up on this contract")
T[0] += 60; tick(6305)
E.close_now(E.positions[0]["id"])
ok(jreplay.load("u1", k4)["exit"]["src"] == "entry", "...and the exit takes the entry's set-up")
# a refused order's set-up isn't kept
jreplay.note_order("u1", "A1", {**order, "s": F})
jreplay.drop_pending("u1", "A1", order)
ok(store.load("u/u1/replay/pending.json", {}) == {}, "a refused order's set-up is dropped")
ok(jreplay.clean_setup({"cur": {"s": F}, "indicators": [{"x": "y" * 400000}]}) is None, "a set-up too big is refused")
ok(jreplay.clean_setup({"tf2": "5m"}) is None, "a set-up without a contract is refused")

# ================================================================ D. an older trade: the path from the account's log
old = {"id": "A1:Pold", "acct": "A1", "s": F, "side": 1, "opened": T0 - 7200, "closed": T0 - 3600, "first_sl": 6100.0, "sl": 6150.0, "tp": 6250.0}
E.events = [{"t": T0 - 9000, "msg": "Placed something"},
            {"t": T0 - 7200, "msg": "Opened LONG CRUDEOIL26NOVFUT: 1 lot @ 6120 (market), charges ₹40.00"},
            {"t": T0 - 6000, "msg": "CRUDEOIL26NOVFUT: stop to break-even + costs 6124.0 (trail BE at 1R)"},
            {"t": T0 - 6000, "msg": "CRUDEOIL26NOVFUT: stop now 6124.0"},
            {"t": T0 - 5000, "msg": "GOLDPETAL26NOVFUT: stop now 9999"},
            {"t": T0 - 4800, "msg": "CRUDEOIL26NOVFUT: Trail BE ON 1R, Trail SL ON 2R"},
            {"t": T0 - 4500, "msg": "CRUDEOIL26NOVFUT: SL 6140, TP 6250"},
            {"t": T0 - 4000, "msg": "CRUDEOIL26NOVFUT: stop now 6150.0"},
            {"t": T0 - 100, "msg": "CRUDEOIL26NOVFUT: stop now 7000"}]
p, src = jreplay.trade_path(U, old)
ok(src == "log", f"older trade: rebuilt from the log, which reaches back to the opening ({src})")
ok([x[1] for x in p] == [6100.0, 6124.0, 6124.0, 6140.0, 6150.0] and [x[3] for x in p] == ["open", "be", "trail", "edit", "trail"],
   f"older trade: each stop change with its kind, other contracts and later entries ignored ({[x[1] for x in p]})")
ok(p[0][2] is None and p[3][2] == 6250.0, "older trade: the target before its first change isn't known (None), after it is")
E.events = E.events[3:]
ok(jreplay.trade_path(U, old)[1] == "log-part", "older trade: a log that starts after the opening is marked partial")
E.events = []
p, src = jreplay.trade_path(U, old)
ok(src == "ends" and len(p) == 2 and p[0][1] == 6100.0 and p[1][1] == 6150.0 and p[1][0] == old["closed"], "no log: only the first and last stop")

# ================================================================ E. the net ₹ during the replay
t1 = J.d["trades"][key]
row = {**symbols.get(F), "prod": "INTRADAY"}
e0, e1 = t1["entries"][0], t1["entries"][1]
n = jreplay.net_series(t1, [[e0["t"] - 10, 6200], [e0["t"] + 5, 6230], [e1["t"] + 5, 6280], [t1["closed"] + 5, 6000]])
want1 = charges.net_at(row, 1, e0["qty"], e0["price"], 6230, paid=charges.order(row, 1, e0["qty"], e0["price"])["total"])["net"]
q2 = e0["qty"] + e1["qty"]
avg2 = (e0["qty"] * e0["price"] + e1["qty"] * e1["price"]) / q2
paid2 = charges.order(row, 1, e0["qty"], e0["price"])["total"] + charges.order(row, 1, e1["qty"], e1["price"])["total"]
want2 = charges.net_at(row, 1, q2, avg2, 6280, paid=paid2)["net"]
ok(n[0] is None and abs(n[1] - want1) < 0.01 and abs(n[2] - want2) < 0.01, f"net ₹: before the entry none; one lot, then after the add ({n[:3]} vs {want1}, {want2})")
ok(abs(n[3] - t1["net"]) < 0.01, "net ₹: after the close, the trade's own net")
part = {**t1, "closes": [{"t": e1["t"] + 10, "qty": e0["qty"], "net": 500.0}]}
n2 = jreplay.net_series(part, [[e1["t"] + 20, 6280]])
want3 = 500.0 + charges.net_at(row, 1, e1["qty"], avg2, 6280, paid=paid2 * e1["qty"] / q2)["net"]
ok(abs(n2[0] - want3) < 0.01, "net ₹: a part closed by then counts its own net, the rest at the price")

# ================================================================ F. pictures: off by default, off after the upgrade, on when asked
ok(jshots.cfg({})["auto"] is False and jshots.cfg({})["chart"] is False, "pictures: automatic ones off by default")
ok(jshots.cfg({"shots": {"auto": True, "chart": True, "tg": True}})["auto"] is False, "pictures: settings saved before v0.29.0 -> off once")
c = jshots.clean_cfg({"tg": True}, {"auto": True, "chart": True})
ok(c["auto"] is False and c["chart"] is False and c["v29"] and c["tg"], "pictures: saving another setting keeps them off")
c = jshots.clean_cfg({"auto": True, "chart": True}, c)
ok(jshots.cfg({"shots": c})["auto"] is True and jshots.cfg({"shots": c})["chart"] is True, "pictures: turned on again, they stay on")

print(f"\n{N_OK[0]} checks passed" + (f", {len(FAIL)} FAILED" if FAIL else ""))
sys.exit(1 if FAIL else 0)
