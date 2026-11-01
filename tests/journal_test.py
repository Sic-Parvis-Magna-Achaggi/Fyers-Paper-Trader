# Journal test (no browser): the server's Octagon port against Octagon's own code, then the journal on real paper engines.
#  A. Parity: random sessions audited by helper/journal.py and by Octagon's JavaScript (tests/fixtures/octagon_core.js,
#     extracted word for word from octagon_journal.html): every pillar state, recorded / clean, and every session figure.
#  B. Trades arrive from paper engines (open, add, close), past trades and archives are taken in, live parts merge,
#     the lockouts (2% line, 99 Club break, numbers running, session ended) refuse orders and cancel waiting ones,
#     each switch works, the audit edits and their rules (Zen -> Execution wrong), preview, claim, hide, settings.
import datetime as dt
import json
import os
import random
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
D = "/tmp/fyers_journal_test"
shutil.rmtree(D, ignore_errors=True)
os.makedirs(D)
for f in os.listdir(HERE + "/fixtures"):
    if not f.endswith(".js") and not f.endswith(".pine"):
        shutil.copy(HERE + "/fixtures/" + f, D)
os.environ["FYERS_HELPER_DATA"] = D
sys.path.insert(0, os.path.dirname(HERE))
from helper import journal, paper, symbols, store  # noqa: E402
from helper.paper import Paper, Refused  # noqa: E402

symbols.refresh()
FAIL = []
N_OK = [0]


def ok(cond, what):
    if cond:
        N_OK[0] += 1
    else:
        FAIL.append(what)
        print("FAIL:", what)


# ================================================================ A. parity with Octagon's own code
R = dict(journal.DEFAULT_RULES)
rnd = random.Random(int(os.environ.get("JSEED", "7")))
OCTV = journal.OCT


def rv(x):
    r = round(x, 2)
    return r + 0.01 if abs(r - 2.0) < 1e-9 or abs(r - 2.5) < 1e-9 else r   # nothing exactly on a threshold (floats)


def make_case(n_sessions=60):
    o_trades, p_trades = [], []
    tid = 0
    for si in range(n_sessions):
        acct = rnd.choice(["A", "B"])
        day = dt.date(2026, 10, 1) + dt.timedelta(days=si)
        t0 = dt.datetime(day.year, day.month, day.day, 3, 30, tzinfo=dt.timezone.utc).timestamp()
        tcur = t0
        for k in range(rnd.randint(1, 9)):
            tid += 1
            side = rnd.choice([1, -1])
            r = rv(rnd.choice([rnd.uniform(-1.2, -0.1), rnd.uniform(0.1, 3.5), rnd.uniform(-1, 1)]))
            net = round(r * 400, 2)
            op = tcur + rnd.randint(60, 1800)
            cl = op + rnd.randint(30, 3600)
            tcur = cl if rnd.random() < 0.8 else op + 30          # sometimes overlapping trades
            closed = not (k > 0 and rnd.random() < 0.08)
            planned = rv(rnd.uniform(0.5, 4)) if rnd.random() < 0.7 else None
            ann = {
                "direction": rnd.choice(OCTV["direction"] + [""]), "wait": rnd.choice(OCTV["wait"] + [""]),
                "execution": rnd.choice(OCTV["execution"] + [""]), "zen": rnd.choice(OCTV["zen"] + ["", "Sanctuary"]),
                "target": rnd.choice(OCTV["target"] + ["", ""]), "regime": "",
                "execFaults": rnd.sample(["frontran", "tinkered", "bracket", "overheld", "zen"], rnd.randint(0, 2)),
                "p1Checks": [], "numberRunning": rnd.random() < 0.05, "payoutPressure": rnd.random() < 0.1,
            }
            fmt = lambda ts: dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            oid = f"t{tid}"
            o_trades.append({**ann, "id": oid, "accountId": acct, "symbol": "X", "action": "buy" if side > 0 else "sell",
                             "openPrice": 100, "closePrice": (100 + side * r) if closed else None,
                             "openTime": fmt(op), "closeTime": fmt(cl) if closed else "",
                             "sl": 100 - side, "tp": (100 + side * planned) if planned is not None else None,
                             "initialSl": None, "grossPnl": net if closed else None, "swap": 0, "commission": 0,
                             "timeless": False, "octVer": 2})
            p_trades.append({**ann, "id": oid, "acct": acct, "day": fmt(op)[:10], "opened": op,
                             "closed": cl if closed else None, "status": "closed" if closed else "open",
                             "net": net if closed else None, "r": r if closed else None, "planned_r": planned,
                             "init_risk": 400.0, "first_sl": 99, "base": 25000.0, "octVer": 2})
    return o_trades, p_trades


o_trades, p_trades = make_case()
# Octagon's rules use its own key names
o_rules = {"baseEquity": 25000, "ddPct": R["dd_pct"], "afkMin": R["afk_min"], "winStreak": R["win_streak"],
           "multiR": R["multi_r"], "stretchR": R["stretch_r"], "blockPct": R["block_pct"], "repBlock": 50, "repsBefore": 0}
js = """const o = require(%s); const inp = JSON.parse(require('fs').readFileSync(0, 'utf8'));
o.setRules(inp.rules, 25000); const A = o.computeAudit(inp.trades);
const out = {byId: {}, sessions: {}}; A.byId.forEach((v, k) => out.byId[k] = v); A.sessions.forEach((v, k) => out.sessions[k] = v);
process.stdout.write(JSON.stringify(out));""" % json.dumps(os.path.join(HERE, "fixtures", "octagon_core.js"))
res = subprocess.run(["node", "-e", js], input=json.dumps({"rules": o_rules, "trades": o_trades}), capture_output=True,
                     text=True, timeout=60)
ok(res.returncode == 0, "Octagon's code ran: " + res.stderr[-300:])
O = json.loads(res.stdout or "{}")
by_id, sessions = journal.compute_audit(p_trades, R, journal.EXEC_FAULTS)
diff = 0
for t in p_trades:
    a, b = by_id[t["id"]], O["byId"][t["id"]]
    for k in ("p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"):
        if a["P"][k]["state"] != b["P"][k]["state"]:
            diff += 1
            print("  pillar differs", t["id"], k, a["P"][k], b["P"][k])
    if a["recorded"] != b["recorded"] or a["clean"] != b["clean"]:
        diff += 1
        print("  recorded/clean differs", t["id"])
ok(diff == 0, f"every pillar state, recorded and clean match Octagon ({len(p_trades)} trades)")
sdiff = 0
for k, s in sessions.items():
    o = O["sessions"][k]
    for f in ("cum", "peak", "dd", "maxDd", "streak", "multi", "count", "closed"):
        if abs((s[f] or 0) - (o[f] or 0)) > 1e-6:
            sdiff += 1
            print("  session differs", k, f, s[f], o[f])
    for f in ("ddLockAt", "termAt"):
        a1, b1 = s[f], (o[f] / 1000 if o[f] is not None else None)
        if (a1 is None) != (b1 is None) or (a1 is not None and abs(a1 - b1) > 1e-6):
            sdiff += 1
            print("  session differs", k, f, a1, b1)
    if [(round(x["from"]), round(x["to"]), x["why"]) for x in s["lockouts"]] != \
            [(round(x["from"] / 1000), round(x["to"] / 1000), x["why"]) for x in o["lockouts"]]:
        sdiff += 1
        print("  lockouts differ", k, s["lockouts"], o["lockouts"])
ok(sdiff == 0, f"every session figure and lockout matches Octagon ({len(sessions)} sessions)")
states = [by_id[t["id"]]["P"][k]["state"] for t in p_trades for k in ("p4", "p5", "p8")]
ok(all(x in states for x in ("pass", "fail", "warn", "off", "na")), "the random cases reach every pillar state")
ok(any(s["ddLockAt"] for s in sessions.values()) and any(s["lockouts"] for s in sessions.values())
   and any(s["termAt"] for s in sessions.values()), "the cases include 2% lockouts, 99 Club breaks and numbers running")

# ================================================================ B. the journal on real paper engines
T = [dt.datetime(2026, 11, 2, 10, 0, tzinfo=paper.IST).timestamp()]
paper.now = lambda: T[0]
journal.now = lambda: T[0]
paper.ist = lambda ts=None: dt.datetime.fromtimestamp(ts if ts else T[0], paper.IST)


class FakeURT:
    def __init__(self, uid):
        self.uid, self.label, self.engines, self._accts = uid, uid, {}, []

    def accounts(self):
        return self._accts

    def add(self, aid, name, size=25000.0):
        self._accts.append({"id": aid, "name": name, "mode": "paper", "capital": size})
        e = Paper(f"u/{self.uid}/a/{aid}/", None, name)
        e.rules.update(size=size, max_margin_pct=0, risk_cap_pct=0, daily_pct=0, max_pct=0, sl_required=False,
                       squareoff_on=False)
        e.acct.update(start=size, peak=size)
        e.journal_hook = lambda kind, obj, aid=aid: journal.on_trade(self, aid, kind, obj)
        e.journal_guard = lambda aid=aid: journal.guard(self, aid)
        e.journal_lock = lambda aid=aid: journal.lock_state(self, aid)
        self.engines[aid] = e
        return e


F = "MCX:CRUDEOIL26NOVFUT"


def tick(e, p):
    e.on_tick({"s": F, "ltp": p, "bid": p - 1, "ask": p + 1, "t": int(T[0]), "rt": T[0]})


def trade(e, entry, exit_, side=1, sl=None):
    """A market trade on CRUDEOIL: in at `entry`, out at `exit_` (bid / ask round them by 1)."""
    tick(e, entry)
    p = e.place({"s": F, "side": side, "type": "market", "sl": sl if sl is not None else entry - side * 20, "mode": "lots",
                 "lots": 1, "product": "INTRADAY"})
    T[0] += 60
    tick(e, exit_)
    pos = e.positions[-1]
    e.close_now(pos["id"])
    T[0] += 60
    return p


# --- past trades: an archive and a current history already on disk before the journal existed
uid = "u1"
os.makedirs(f"{D}/u/{uid}/a/a1", exist_ok=True)
old = {"id": "P0000001001", "s": F, "side": 1, "product": "INTRADAY", "lots": 1, "qty": 100, "lot": 100, "mult": 1,
       "entries": [{"t": T[0] - 86400 * 3, "qty": 100, "price": 5000}], "avg": 5000, "exit": 5010,
       "opened": T[0] - 86400 * 3, "closed": T[0] - 86400 * 3 + 600, "reason": "tp", "first_sl": 4990, "sl": 4990,
       "tp": 5010, "basis": "self", "ref": None, "best": 5011, "worst": 4998, "gross": 1000, "charges": {"total": 80},
       "net": 920, "init_risk": 1080, "r": 0.85, "balance_after": 25920, "day": "2026-10-30"}
store.save(f"u/{uid}/a/a1/paper_trades_until_20261031_120000.json", [old])
store.save(f"u/{uid}/a/a1/paper_trades.json", [{**old, "id": "P0000002001", "opened": T[0] - 86400, "closed": T[0] - 86400 + 300,
                                                "day": "2026-11-01", "net": -500, "r": -0.46}])
U = FakeURT(uid)
E = U.add("a1", "Main")
J = journal.get(uid)
J.sync(U, full=True)
v = J.view(U)
ok(len(v["trades"]) == 2, f"past trades taken in from the history and its archive ({len(v['trades'])})")
ok(all(t["claimedAt"] for t in v["trades"]), "trades from before the journal count as claimed (Octagon)")
ok(v["reps"]["total"] == 2, "reps count them")
J.sync(U, full=True)
ok(len(J.view(U)["trades"]) == 2, "a second sync adds nothing twice")

# --- a trade arrives on its own: open, then closed
tick(E, 5600)
E.place({"s": F, "side": 1, "type": "market", "sl": 5580, "tp": 5660, "mode": "lots", "lots": 1, "product": "INTRADAY"})
pid = E.positions[0]["id"]
t = J.d["trades"].get(f"a1:{pid}")
ok(t and t["status"] == "open" and t["avg"] == 5601 and t["first_sl"] == 5580, "an opened position is in the journal at once (open)")
ok(t and t["planned_r"] and t["planned_r"] > 2, f"its target in net R is worked out ({t and t['planned_r']})")
T[0] += 120
tick(E, 5640)
E.close_now(pid)
t = J.d["trades"][f"a1:{pid}"]
h = E.history[-1]
ok(t["status"] == "closed" and t["net"] == h["net"] and t["r"] == h["r"] and t["charges"] == h["charges"]["total"],
   "closed: net, R and charges are the engine's own (net of all charges)")
ok(not t["claimedAt"], "a new rep waits to be claimed")
v = J.view(U)
row = next(x for x in v["trades"] if x["id"] == t["id"])
ok(row["rep"] == 3 and row["q"] == "unaudited", "it's rep 3, not audited yet")
ok(row["audit"]["P"]["p5"]["state"] == "off", "Pillar 5 doesn't apply before the session's first win")

# --- audit edits
J.annotate(t["id"], {"direction": "Correct", "wait": "Patient", "execution": "Correct", "zen": "Compromised",
                     "target": "Realistic", "setup": "breakout, BOS, breakout", "bias": "−1,256", "notes": "plan"})
t = J.d["trades"][t["id"]]
ok(t["execution"] == "Wrong" and "zen" in t["execFaults"], "Zen Temple breach makes Execution wrong")
ok(t["setup"] == ["breakout", "BOS"] and t["bias"] == -1.26, f"tags de-duplicated, bias parsed ({t['setup']}, {t['bias']})")
try:
    J.annotate(t["id"], {"wait": "Sleepy"})
    ok(False, "a value outside the choices is refused")
except ValueError:
    ok(True, "")
pv = J.preview(t["id"], {"zen": "Sanctuary", "execution": "Correct"})
ok(pv["audit"]["clean"] and not J.computed()[0][t["id"]]["clean"], "the preview shows the change without saving it")
J.annotate(t["id"], {"zen": "Sanctuary", "execution": "Correct"})
ok(J.computed()[0][t["id"]]["clean"], "saved: clean octagon")
J.claim(t["id"])
ok(J.d["trades"][t["id"]]["claimedAt"], "claimed")

# --- the 99 Club: 3 wins in a row -> a 20-minute break that refuses orders
for i in range(2):
    trade(E, 5600, 5640)
ok(J.lock_reason("a1", E.trading_day()) and "99 Club" in J.lock_reason("a1", E.trading_day()), "3 wins in a row: the 99 Club break")
try:
    tick(E, 5600)
    E.place({"s": F, "side": 1, "type": "market", "sl": 5580, "mode": "lots", "lots": 1, "product": "INTRADAY"})
    ok(False, "an order during the break is refused")
except Refused as ex:
    ok("journal" in str(ex), f"an order during the break is refused ({ex})")
pl = E.plan({"s": F, "side": 1, "type": "market", "sl": 5580, "mode": "lots", "lots": 1, "product": "INTRADAY"})
ok(pl.get("blocked") and "99 Club" in pl["blocked"], "the ticket's preview shows why")
ok(E.snapshot()["jlock"]["kind"] == "afk", "the snapshot carries the lock for the ticket")
J.set_settings({"rules": {"block_afk": False}})
ok(not E.plan({"s": F, "side": 1, "type": "market", "sl": 5580, "mode": "lots", "lots": 1, "product": "INTRADAY"}).get("blocked"),
   "switched off: allowed (still shown)")
ok(E.snapshot()["jlock"] and not E.snapshot()["jlock"]["on"], "the lock still shows, marked off")
J.set_settings({"rules": {"block_afk": True}})
T[0] += 21 * 60
ok(not J.lock_reason("a1", E.trading_day()), "20 minutes later: the break is over")
vv = J.view(U)["trades"]
inside = [x for x in vv if x["status"] == "closed" and x["day"] == E.trading_day()]
ok(all(x["audit"]["P"]["p5"]["state"] in ("pass", "off") for x in inside), "trades before the break hold Pillar 5")

# --- a pending order is cancelled when a lockout starts
tick(E, 5600)
E.place({"s": F, "side": 1, "type": "limit", "price": 5500, "sl": 5480, "mode": "lots", "lots": 1, "product": "INTRADAY"})
ok(len(E.orders) == 1, "a limit order waits")
# --- the 2% line: 25,000 x 2% = 500 below the session's peak (closed trades, net)
peak_before = J.computed()[1][f"a1|{E.trading_day()}"]["peak"]
while not J.lock_reason("a1", E.trading_day()):
    trade(E, 5600, 5598, sl=5550)
    if len(E.history) > 40:
        break
s = J.computed()[1][f"a1|{E.trading_day()}"]
ok(s["ddLockAt"] and s["peak"] - s["cum"] >= 499.99, f"locked out at the 2% line (peak {s['peak']}, now {s['cum']}, peak before {peak_before})")
ok("Pillar 4" in J.lock_reason("a1", E.trading_day()), "the refusal names Pillar 4")
ok(len(E.orders) == 0, "the waiting entry order was cancelled when the lockout started")
J.set_settings({"rules": {"block_dd": False}})
ok(not J.lock_reason("a1", E.trading_day()), "switch off: no block")
J.set_settings({"rules": {"block_dd": True}})
T[0] += 3600
ok(J.lock_reason("a1", E.trading_day()), "the 2% lockout lasts the rest of the day")
T[0] = dt.datetime(2026, 11, 3, 10, 0, tzinfo=paper.IST).timestamp()
ok(not J.lock_reason("a1", E.trading_day()), "next trading day: fresh session")

# --- numbers running, and ending the session by hand
trade(E, 5600, 5610)
last = J.d["trades"][f"a1:{E.history[-1]['id']}"]
J.annotate(last["id"], {"numberRunning": True})
ok(J.lock_reason("a1", E.trading_day()) and "numbers" in J.lock_reason("a1", E.trading_day()), "numbers running ends the session")
J.annotate(last["id"], {"numberRunning": False})
ok(not J.lock_reason("a1", E.trading_day()), "unticked: not locked")
J.end_session("a1", E.trading_day())
ok(J.lock_reason("a1", E.trading_day()) and "Session ended" in J.lock_reason("a1", E.trading_day()), "session ended by hand: locked")
J.set_settings({"rules": {"block_end": False}})
ok(not J.lock_reason("a1", E.trading_day()), "its switch off: allowed")
J.set_settings({"rules": {"block_end": True}})

# --- a second account has its own sessions
E2 = U.add("a2", "Second", 100000.0)
ok(not J.lock_reason("a2", E2.trading_day()), "another account isn't locked by the first one's session")
trade(E2, 5600, 5590)
ok(any(x["acct"] == "a2" for x in J.visible()), "the second account's trades arrive")

# --- live: a position closed in parts is one trade
part = {**old, "id": "P0000009001p1", "qty": 100, "lots": 1, "net": 300, "gross": 350, "charges": {"total": 50},
        "init_risk": 500, "closed": T[0] + 10, "exit": 5020, "day": E2.trading_day(), "opened": T[0]}
rest = {**part, "id": "P0000009001", "net": 100, "gross": 150, "exit": 5010, "closed": T[0] + 20}
J.ingest_close("a2", "Second", "live", 100000, part, still_open=True)
ok(J.d["trades"]["a2:P0000009001"]["status"] == "open", "first part closed: the trade is still open")
J.ingest_close("a2", "Second", "live", 100000, rest)
lt = J.d["trades"]["a2:P0000009001"]
ok(lt["status"] == "closed" and lt["net"] == 400 and lt["qty"] == 200 and lt["exit"] == 5015 and lt["r"] == 0.4,
   f"both parts: one trade, net and R added up ({lt['net']}, {lt['r']}, exit {lt['exit']})")
ok(not J.ingest_close("a2", "Second", "live", 100000, rest), "a part is never counted twice")

# --- an account reset with a position open: the position is gone without a close
tick(E2, 5600)
E2.place({"s": F, "side": 1, "type": "market", "sl": 5580, "mode": "lots", "lots": 1, "product": "INTRADAY"})
gone = f"a2:{E2.positions[0]['id']}"
E2.reset(100000)
J.sync(U)
ok(J.d["trades"][gone]["status"] == "removed", "a position dropped by a reset leaves the journal")
ok(any(x["acct"] == "a2" and x["status"] == "closed" for x in J.visible()), "the account's closed trades stay after the reset (archived)")
J2 = journal.Journal(uid)                                 # from the file, as after a restart
ok(len(J2.visible()) == len(J.visible()), "everything is saved on the server")

# --- hide / restore
n0 = J.reps(J.computed()[0])["total"]
J.set_hidden(last["id"], True)
ok(J.reps(J.computed()[0])["total"] == n0 - 1, "a removed trade leaves the reps and stats")
J.set_hidden(last["id"], False)
ok(J.reps(J.computed()[0])["total"] == n0, "restored")

# --- settings: pillars word for word, editable, back to the original
ok(J.pillars()[0]["rule"] == journal.PILLARS[0]["rule"], "the pillars start word for word")
J.set_settings({"pillars": {"1": {"rule": "My own rule"}}, "p1": [["bos15", "15M BOS"], ["new", "VWAP side"]]})
ok(J.pillars()[0]["rule"] == "My own rule" and J.pillars()[0]["edited"], "a pillar's text can be edited")
ok([x[1] for x in J.p1()] == ["15M BOS", "VWAP side"], "Pillar 1 checks editable")
J.set_settings({"pillars": {"1": None}, "p1": None})
ok(J.pillars()[0]["rule"] == journal.PILLARS[0]["rule"] and J.p1() == journal.P1_CHECKS, "back to the original text")
for bad in ({"rules": {"dd_pct": 0}}, {"rules": {"afk_min": "x"}}, {"p1": []}):
    try:
        J.set_settings(bad)
        ok(False, f"refused: {bad}")
    except ValueError:
        ok(True, "")
J.set_practice("2026-11-03", True)
ok(J.d["practice"]["2026-11-03"], "practice ticked")

print(f"\n{N_OK[0]} checks passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
