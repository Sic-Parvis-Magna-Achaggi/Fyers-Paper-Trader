# Journal v0.28.0 test (no browser): the weekly review (rules, the Telegram summary posted once and then edited in
# place), reflections stamping reviewedAt, the CSV export, the backup zip and restoring it (into a fresh journal, and
# again into the same one: nothing added twice, nothing changed).
# Run: python3 tests/jreview_test.py
import csv
import datetime as dt
import io
import json
import os
import shutil
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
D = "/tmp/fyers_jreview_test"
shutil.rmtree(D, ignore_errors=True)
os.makedirs(D)
for f in os.listdir(HERE + "/fixtures"):
    if not f.endswith(".js") and not f.endswith(".pine"):
        shutil.copy(HERE + "/fixtures/" + f, D)
os.environ["FYERS_HELPER_DATA"] = D
PORT = 8772
os.environ["TELEGRAM_API"] = f"http://127.0.0.1:{PORT}"
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from helper import journal, jshots, paper, rt, symbols, telegram, users  # noqa: E402
from helper.paper import Paper  # noqa: E402
import fake_telegram  # noqa: E402

symbols.refresh()
fake_telegram.start(PORT)
FAIL, N_OK = [], [0]


def ok(cond, what):
    if cond:
        N_OK[0] += 1
    else:
        FAIL.append(what)
        print("FAIL:", what)


def raises(fn, *a):
    try:
        fn(*a)
        return False
    except ValueError:
        return True


def fake(path):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=5) as r:
        return json.loads(r.read().decode())


T = [dt.datetime(2026, 11, 2, 10, 0, tzinfo=paper.IST).timestamp()]
paper.now = lambda: T[0]
journal.now = lambda: T[0]
paper.ist = lambda ts=None: dt.datetime.fromtimestamp(ts if ts else T[0], paper.IST)


class Feed:
    loop = None

    def broadcast(self, msg, acct=None):
        pass


class FakeURT:
    def __init__(self, uid):
        self.uid, self.label, self.engines, self._accts, self.feed = uid, uid, {}, [], Feed()

    def accounts(self):
        return self._accts

    def add(self, aid, name, size=1000000.0):
        self._accts.append({"id": aid, "name": name, "mode": "paper", "capital": size})
        e = Paper(f"u/{self.uid}/a/{aid}/", None, name)
        e.rules.update(size=size, max_margin_pct=0, risk_cap_pct=0, daily_pct=0, max_pct=0, sl_required=False, squareoff_on=False)
        e.acct.update(start=size, peak=size)
        e.journal_hook = lambda kind, obj, aid=aid: journal.on_trade(self, aid, kind, obj)
        e.journal_guard = lambda aid=aid: journal.guard(self, aid)
        e.journal_lock = lambda aid=aid: journal.lock_state(self, aid)
        self.engines[aid] = e
        return e


jshots.candles_for = lambda urt, t, res, ph, bars: ([[int(t["opened"]) - 300 * i, 6200, 6205, 6195, 6201, 1] for i in range(60, -1, -1)], "")
jshots.DELAY = 0.05
U = FakeURT("u1")
rt.RT["u1"] = U
E = U.add("A1", "Main")
J = journal.get("u1")
J.sync(U, full=True)
J.set_settings({"rules": {"block_dd": False, "block_afk": False, "block_end": False}})
J.set_settings({"shots": {"auto": True}})                        # automatic pictures are off by default since v0.29.0
F = "MCX:CRUDEOIL26NOVFUT"


def trade(entry, exit_, side=1):
    E.on_tick({"s": F, "ltp": entry, "bid": entry - 1, "ask": entry + 1, "t": int(T[0]), "rt": T[0]})
    pr = E.place({"s": F, "side": side, "type": "market", "sl": entry - side * 20, "tp": entry + side * 40, "mode": "lots", "lots": 1, "product": "INTRADAY"})
    T[0] += 300
    E.on_tick({"s": F, "ltp": exit_, "bid": exit_ - 1, "ask": exit_ + 1, "t": int(T[0]), "rt": T[0]})
    E.close_now(E.positions[-1]["id"])
    T[0] += 300


trade(6200, 6230)
trade(6230, 6215, -1)
trade(6215, 6200)
jshots.wait_idle(10)
keys = sorted(J.d["trades"], key=lambda k: J.d["trades"][k]["opened"])
ok(len(keys) == 3 and all(len(J.d["trades"][k]["shots"]) == 2 for k in keys), "three trades, each with its two server pictures")

# ---- reflections
J.annotate(keys[0], {"rvRight": "Waited for the close", "rvWrong": "", "review": "Same again"})
ok(J.d["trades"][keys[0]]["reviewedAt"], "a reflection stamps reviewedAt")
J.annotate(keys[1], {"notes": "plan only"})
ok(not J.d["trades"][keys[1]].get("reviewedAt"), "a plan alone doesn't count as a reflection")

# ---- the weekly review
ok(raises(J.set_review, "2026-11-03", {"well": "x"}), "a review's week must start on a Monday")
ok(raises(J.set_review, "nope", {}), "a review's week must be a date")
ok(raises(J.set_review, "2026-11-02", {"focusKept": "maybe"}), "focus kept: held, partly or missed")
rv = J.set_review("2026-11-02", {"well": "Patient clicks", "broke": "", "focus": "Only from the Zen Temple", "focusKept": "partly"})
ok(rv["well"] == "Patient clicks" and rv["focus"] == "Only from the Zen Temple" and rv["focusKept"] == "partly" and rv["updatedAt"],
   "the review is saved (well, focus, focus kept)")
ok(jshots.tg_review("u1", "2026-11-02", "summary") == "off", "Telegram summary: off while the backup is off")
telegram.save("u1", {"token": users.seal("1234567:abc"), "bot": "ftm_test_bot", "chat": "5550001"})
J.set_settings({"shots": {"tg": True, "tg_chat": "-1009990001"}})
ok(jshots.tg_review("u1", "2026-11-02", "🗓 Weekly review · v1") == "posted", "Telegram summary: posted the first time")
mid = J.d["reviews"]["2026-11-02"]["msg"]["id"]
ok(jshots.tg_review("u1", "2026-11-02", "🗓 Weekly review · v2") == "edited", "...then edited in place")
sent = [m for m in fake("/_sent") if m.get("id") == mid]
ok(len([m for m in fake("/_sent") if "Weekly review" in m["text"]]) == 1 and sent and sent[0]["text"].endswith("v2") and sent[0].get("edited") == 1,
   "one message in the chat, now reading v2")
ok(jshots.tg_review("u1", "2026-11-02", "🗓 Weekly review · v2") == "edited", "the same text again is fine (Telegram: not modified)")
fake_telegram.SENT.clear()                                  # the message is gone (deleted in Telegram)
ok(jshots.tg_review("u1", "2026-11-02", "🗓 Weekly review · v3") == "posted" and any(m["text"].endswith("v3") for m in fake("/_sent")),
   "a message that's gone: a fresh one is posted")
J.set_settings({"shots": {"tg": False}})
jshots.wait_idle(10)

# ---- CSV
text = J.csv_text(U)
rows = list(csv.reader(io.StringIO(text.lstrip("﻿"))))
head = rows[0]
ok(text.startswith("﻿") and len(rows) == 4, f"CSV: a header and the 3 trades ({len(rows) - 1})")
need = ["Rep", "Contract", "Currency", "Net", "R (net)", "P1 " + journal.PILLARS[0]["title"], "Clean octagon", "Did right", "Pictures", "Trade id"]
ok(all(h in head for h in need), "CSV: rep, contract, net ₹, R, each pillar, clean octagon, reflections, pictures, the id")
r0 = dict(zip(head, rows[1]))
ok(r0["Trade id"] == keys[0] and r0["Did right"] == "Waited for the close" and r0["Pictures"] == "2" and r0["Side"] == "BUY"
   and abs(float(r0["Net"]) - J.d["trades"][keys[0]]["net"]) < 0.005, "CSV: the first trade's figures and reflection")
J.set_hidden(keys[2], True)
r2 = dict(zip(head, list(csv.reader(io.StringIO(J.csv_text(U).lstrip("﻿"))))[3]))
ok(r2["Removed from journal"] == "Yes", "CSV: a trade removed from the journal is still listed, flagged")

# ---- backup and restore
J.set_practice("2026-11-02", True)
zp = D + "/b.zip"
got = J.backup_zip(zp)
import zipfile  # noqa: E402
names = zipfile.ZipFile(zp).namelist()
ok(got["pictures"] == 6 and "journal.json" in names and len([n for n in names if n.startswith("pictures/")]) == 6, "backup: journal.json and the 6 pictures")
J2 = journal.get("u2")
res = J2.restore(zp)
ok(res["trades"] == 3 and res["pictures"] == 6 and res["reviews"] == 1 and res["practice"] == 1, f"restore into an empty journal: 3 trades, 6 pictures, the review, the practice day ({res})")
ok(all(os.path.exists(jshots.file_of("u2", k, s)) for k in keys for s in J2.d["trades"][k]["shots"]) and len(J2.d["trades"][keys[0]]["shots"]) == 2,
   "restore: every picture's file is back")
ok(J2.d["trades"][keys[0]]["rvRight"] == "Waited for the close" and keys[2] in J2.d["hidden"], "restore: annotations and 'removed' come back")
res2 = J2.restore(zp)
ok(res2["trades"] == 0 and res2["pictures"] == 0 and res2["skipped"] == 3 and len(J2.d["trades"][keys[0]]["shots"]) == 2,
   "restoring again adds nothing twice")
J2.annotate(keys[1], {"review": "changed after the backup"})
J2.restore(zp)
ok(J2.d["trades"][keys[1]]["review"] == "changed after the backup", "restore never changes what's already in the journal")
open(D + "/bad.json", "w").write('{"hello": 1}')
ok(raises(J2.restore, D + "/bad.json"), "a file that isn't a backup is refused")
J3 = journal.get("u3")
open(D + "/j.json", "w").write(json.dumps({"journal": J.d}))
ok(J3.restore(D + "/j.json")["trades"] == 3 and not J3.d["trades"][keys[0]].get("shots"), "a bare journal.json restores the trades (no pictures without their files)")

print(f"\n{N_OK[0]} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
