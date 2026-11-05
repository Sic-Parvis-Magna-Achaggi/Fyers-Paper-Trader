# Journal pictures test (no browser): helper/jshots.py with real paper engines and the journal, the fake Telegram.
#  - settings checks, labels, picture sniffing, captions
#  - the server's drawing (entry / exit, a stop on the underlying future, a scale-in) - PNGs of the right size
#  - a trade opening and closing: one server picture at entry, one at exit, a request to open charts for theirs;
#    an add to the position doesn't draw again; a failure is recorded and retried; "Draw again" replaces the picture
#  - one chart picture per timeframe (a second page is told dup); labels; delete
#  - the Telegram copy: sendDocument with the trade in its caption, silent; deleting the picture deletes the copy;
#    a refused chat is recorded and retried; "send the ones not sent"; start-up sends only those since the backup began
# Run: python3 tests/jshots_test.py
import datetime as dt
import json
import os
import shutil
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
D = "/tmp/fyers_jshots_test"
shutil.rmtree(D, ignore_errors=True)
os.makedirs(D)
for f in os.listdir(HERE + "/fixtures"):
    if not f.endswith(".js") and not f.endswith(".pine"):
        shutil.copy(HERE + "/fixtures/" + f, D)
os.environ["FYERS_HELPER_DATA"] = D
PORT = 8771
os.environ["TELEGRAM_API"] = f"http://127.0.0.1:{PORT}"
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from helper import journal, jshots, paper, rt, symbols, store, telegram, users  # noqa: E402
from helper.paper import Paper  # noqa: E402
import fake_telegram  # noqa: E402

symbols.refresh()
fake_telegram.start(PORT)
FAIL = []
N_OK = [0]


def ok(cond, what):
    if cond:
        N_OK[0] += 1
    else:
        FAIL.append(what)
        print("FAIL:", what)


def fake(path):
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}{path}", timeout=5) as r:
        return json.loads(r.read().decode())


def drain():
    with jshots._cv:
        jshots._q.clear()
        jshots._queued.clear()


# ================================================================ A. small pieces
ok(jshots.tf_ok("5m") and jshots.tf_ok("1h") and jshots.tf_ok("Context") and jshots.tf_ok("7m") and jshots.tf_ok("1D"), "labels: 5m, 1h, Context, a custom 7m, 1D")
ok(not jshots.tf_ok("5 min") and not jshots.tf_ok("") and not jshots.tf_ok("<b>"), "labels: nonsense refused")
ok(jshots.sniff(b"\x89PNG\r\n\x1a\nxxxx") == "png" and jshots.sniff(b"\xff\xd8\xff\xe0") == "jpg"
   and jshots.sniff(b"RIFF1234WEBPVP8 ") == "webp" and jshots.sniff(b"GIF89a..") == "gif", "picture types: PNG, JPEG, WebP, GIF")
ok(jshots.sniff(b"<html>") is None and jshots.sniff(b"ftypheic") is None, "picture types: HTML / HEIC refused")


def raises(fn, *a):
    try:
        fn(*a)
        return False
    except ValueError:
        return True


ok(raises(jshots.clean_cfg, {"res": "7"}, {}), "settings: a timeframe the server doesn't draw is refused")
ok(raises(jshots.clean_cfg, {"bars": 10}, {}) and raises(jshots.clean_cfg, {"bars": 900}, {}), "settings: candles 30-400")
ok(raises(jshots.clean_cfg, {"tg_chat": "my channel"}, {}), "settings: a chat must be a number or @name")
c1 = jshots.clean_cfg({"tg": True, "tg_chat": "-1009990001"}, {})
ok(c1["tg"] and c1["tg_chat"] == "-1009990001" and c1["tg_since"] > 0, "settings: turning the backup on stamps when it began")
c2 = jshots.clean_cfg({"bars": 150}, c1)
ok(c2["tg_since"] == c1["tg_since"] and c2["bars"] == 150, "settings: another change keeps that stamp")

# ================================================================ B. drawing


def candles(t_from, t_to, p=6200.0, sec=300):
    import random
    rnd = random.Random(int(t_from))
    out, t = [], int(t_from // sec * sec)
    while t <= t_to:
        o = p
        p += rnd.gauss(0, 4)
        out.append([t, o, max(o, p) + abs(rnd.gauss(0, 2)), min(o, p) - abs(rnd.gauss(0, 2)), p, 100])
        t += sec
    return out


from PIL import Image  # noqa: E402
import io  # noqa: E402

T0 = dt.datetime(2026, 11, 2, 10, 0, tzinfo=paper.IST).timestamp()
rows = candles(T0 - 2 * 86400, T0 + 3600)
tr = {"id": "A:P9", "s": "MCX:CRUDEOIL26NOVFUT", "side": -1, "lots": 1, "qty": 100, "product": "INTRADAY", "mode": "live",
      "acct_name": "Main", "opened": T0, "closed": T0 + 1800, "avg": 6200.0, "first_sl": 6220.0, "sl": 6195.0, "tp": 6150.0,
      "init_risk": 2100.0, "planned_r": 2.3, "exit": 6180.0, "net": 1950.0, "r": 0.93, "charges": 50.0, "status": "closed",
      "entries": [{"t": T0, "price": 6200.0}, {"t": T0 + 600, "price": 6205.0}], "closes": [{"t": T0 + 1800, "exit": 6180.0}],
      "basis": "self"}
for ph in ("entry", "exit"):
    png, w, h = jshots.render(tr, rows, "5", ph, 120)
    im = Image.open(io.BytesIO(png))
    ok(png[:8] == b"\x89PNG\r\n\x1a\n" and im.size == (1280, 720) and (w, h) == (1280, 720), f"drawing at {ph}: a 1280x720 PNG")
ok(len(jshots.render({**tr, "basis": "fut", "ref": "NSE:NIFTY26NOVFUT"}, rows, "5", "exit")[0]) > 5000,
   "drawing: a stop on the underlying future (no SL / TP lines on this chart) still draws")
ok(len(jshots.render(tr, [r for r in rows if r[0] < T0 - 3600], "5", "entry")[0]) > 5000,
   "drawing: the entry past the last candle Fyers sent (marker past the candles) still draws")
cap = jshots.caption(tr, {"kind": "server", "phase": "exit", "tf": "5m"})
ok("CRUDEOIL26NOVFUT" in cap and "SELL 1 lot" in cap and "LIVE" in cap and "net +₹1,950.00" in cap and "+0.93R" in cap and "🆔 A:P9" in cap,
   "the Telegram caption: contract, side, LIVE, net ₹ and R, the trade's id")

# ================================================================ C. trades on paper engines
T = [T0]
paper.now = lambda: T[0]
journal.now = lambda: T[0]
paper.ist = lambda ts=None: dt.datetime.fromtimestamp(ts if ts else T[0], paper.IST)
SENT_WS = []


class Loop:
    def is_running(self):
        return True

    def call_soon_threadsafe(self, fn, *a):
        fn(*a)


class Feed:
    loop = Loop()

    def broadcast(self, msg, acct=None):
        SENT_WS.append(msg)


class FakeURT:
    def __init__(self, uid):
        self.uid, self.label, self.engines, self._accts, self.feed = uid, uid, {}, [], Feed()

        class L:
            dir = f"u/{uid}/"
        self.link = L()

    def accounts(self):
        return self._accts

    def add(self, aid, name, size=25000.0):
        self._accts.append({"id": aid, "name": name, "mode": "paper", "capital": size})
        e = Paper(f"u/{self.uid}/a/{aid}/", None, name)
        e.rules.update(size=size, max_margin_pct=0, risk_cap_pct=0, daily_pct=0, max_pct=0, sl_required=False, squareoff_on=False)
        e.acct.update(start=size, peak=size)
        e.journal_hook = lambda kind, obj, aid=aid: journal.on_trade(self, aid, kind, obj)
        e.journal_guard = lambda aid=aid: journal.guard(self, aid)
        e.journal_lock = lambda aid=aid: journal.lock_state(self, aid)
        self.engines[aid] = e
        return e


CALLS = []
FAIL_DRAW = [False]


def fake_candles(urt, t, res, ph, bars):
    CALLS.append((t["id"], ph, res))
    if FAIL_DRAW[0]:
        raise RuntimeError("no candles from Fyers (not logged in)")
    return candles(T0 - 2 * 86400, (t.get("closed") or t["opened"]) + 600), ""


jshots.candles_for = fake_candles
jshots.DELAY = 0.05
U = FakeURT("u1")
rt.RT["u1"] = U
E = U.add("A1", "Main")
F = "MCX:CRUDEOIL26NOVFUT"
J = journal.get("u1")
J.sync(U, full=True)
J.set_settings({"rules": {"block_dd": False, "block_afk": False, "block_end": False}})   # lockouts aren't what's tested here
J.set_settings({"shots": {"auto": True, "chart": True}})        # automatic pictures are off by default since v0.29.0


def tick(p):
    E.on_tick({"s": F, "ltp": p, "bid": p - 1, "ask": p + 1, "t": int(T[0]), "rt": T[0]})


tick(6200)
E.place({"s": F, "side": 1, "type": "market", "sl": 6180, "tp": 6260, "mode": "lots", "lots": 1, "product": "INTRADAY"})
key = next(k for k in J.d["trades"])
ok(jshots.wait_idle(10), "the picture worker finishes")
t = J.d["trades"][key]
srv = [s for s in t.get("shots") or [] if s["kind"] == "server"]
ok(len(srv) == 1 and srv[0]["phase"] == "entry" and srv[0]["tf"] == "5m", "entry: one server picture, 5m, at entry")
ok(os.path.getsize(jshots.file_of("u1", key, srv[0])) == srv[0]["bytes"] > 5000, "entry: its PNG is on disk")
ok(any(m.get("jshot", {}).get("phase") == "entry" and m["jshot"]["s"] == F and m["jshot"]["id"] == key for m in SENT_WS),
   "entry: open charts of the contract are asked for their picture")
T[0] += 120
tick(6205)
E.place({"s": F, "side": 1, "type": "market", "mode": "lots", "lots": 1, "product": "INTRADAY"})   # an add
jshots.wait_idle(10)
ok(len([s for s in J.d["trades"][key]["shots"] if s["kind"] == "server"]) == 1 and len(CALLS) == 1,
   "an add to the position doesn't draw again")
# chart pictures: one per timeframe
sh_c = {"id": jshots.new_id(), "kind": "chart", "phase": "entry", "tf": "5m", "src": "browser", "at": time.time(), "ext": "png"}
PNG1 = jshots.render(tr, rows, "5", "entry", 60)[0]
J.add_shot(key, sh_c, unique=("chart", "entry", "5m"))
jshots.write("u1", key, sh_c, PNG1)
dup = False
try:
    J.add_shot(key, {**sh_c, "id": jshots.new_id()}, unique=("chart", "entry", "5m"))
except KeyError as ex:
    dup = str(ex).strip("'\"") == "dup"
ok(dup, "a second chart picture of the same timeframe at entry is refused as dup (another page sent it first)")
sh_h = {**sh_c, "id": jshots.new_id(), "tf": "1h"}
J.add_shot(key, sh_h, unique=("chart", "entry", "1h"))
jshots.write("u1", key, sh_h, PNG1)
ok(len([s for s in J.d["trades"][key]["shots"] if s["kind"] == "chart"]) == 2, "...but a 1h chart's picture is added too")
ok(raises(J.set_shot, key, sh_c["id"], "banana"), "a picture's label must be a timeframe")
J.set_shot(key, sh_c["id"], "15m")
ok(next(s for s in J.d["trades"][key]["shots"] if s["id"] == sh_c["id"])["tf"] == "15m", "a picture's label changes")
order = [(s.get("phase"), s["kind"]) for s in J.d["trades"][key]["shots"]]
ok(order[0] == ("entry", "server"), "pictures in order: the server's entry picture first")
# close: the exit picture
T[0] += 600
tick(6230)
E.close_now(E.positions[-1]["id"])
jshots.wait_idle(10)
t = J.d["trades"][key]
ok(t["status"] == "closed" and any(s["kind"] == "server" and s["phase"] == "exit" for s in t["shots"]), "exit: the server draws the exit picture")
ok(any(m.get("jshot", {}).get("phase") == "exit" for m in SENT_WS), "exit: open charts are asked for theirs")
# Draw again replaces
old = next(s for s in t["shots"] if s["kind"] == "server" and s["phase"] == "entry")
jshots.draw_now("u1", key, "entry")
jshots.wait_idle(10)
new = [s for s in J.d["trades"][key]["shots"] if s["kind"] == "server" and s["phase"] == "entry"]
ok(len(new) == 1 and new[0]["id"] != old["id"] and not os.path.exists(jshots.file_of("u1", key, old)),
   "Draw again: a new entry picture replaces the old one (its file deleted)")
th = jshots.thumb("u1", key, new[0])
ok(th and Image.open(th).size[0] <= 480, "the small copy for the list is made")
# a failure is recorded and retried
FAIL_DRAW[0] = True
T[0] += 300
tick(6230)
E.place({"s": F, "side": -1, "type": "market", "sl": 6260, "mode": "lots", "lots": 1, "product": "INTRADAY"})
time.sleep(0.4)
k2 = [k for k in J.d["trades"] if k != key][0]
ok((J.d["trades"][k2].get("shot_err") or {}).get("entry", {}).get("msg", "").startswith("no candles"), "a failed drawing is recorded on the trade")
ok(jshots.pending() >= 1, "...and tried again later")
drain()
FAIL_DRAW[0] = False
jshots.draw_now("u1", k2, "entry")
jshots.wait_idle(10)
ok(not (J.d["trades"][k2].get("shot_err") or {}).get("entry") and any(s["kind"] == "server" for s in J.d["trades"][k2]["shots"]),
   "drawn by hand later: the error goes away")
# settings off: no drawing, no chart request
J.set_settings({"shots": {"auto": False, "chart": False}})
n_calls, n_ws = len(CALLS), len(SENT_WS)
T[0] += 60
tick(6232)
E.close_now(E.positions[-1]["id"])
jshots.wait_idle(5)
ok(len(CALLS) == n_calls and len(SENT_WS) == n_ws, "pictures switched off: nothing drawn, no chart asked")
J.set_settings({"shots": {"auto": True, "chart": True}})

# ================================================================ D. the Telegram copy
telegram.save("u1", {"token": users.seal("1234567:abc"), "bot": "ftm_test_bot", "chat": "5550001"})
J.set_settings({"shots": {"tg": True, "tg_chat": "-1009990001"}})
since = jshots.cfg(J.d["settings"])["tg_since"]
ok(since > 0, "Telegram backup on")
T[0] += 60
tick(6240)
E.place({"s": F, "side": 1, "type": "market", "sl": 6220, "mode": "lots", "lots": 1, "product": "INTRADAY"})
time.sleep(0.2)
jshots.wait_idle(10)
k3 = [k for k in J.d["trades"] if k not in (key, k2)][0]
docs = fake("/_docs")
ok(len(docs) == 1 and docs[0]["chat"] == "-1009990001" and docs[0]["silent"] and docs[0]["head"].startswith("89504e47")
   and docs[0]["filename"].endswith(".png") and "CRUDEOIL26NOVFUT" in docs[0]["caption"] and f"🆔 {k3}" in docs[0]["caption"],
   "the new entry picture goes to the journal's chat: a silent PNG document with the trade in its caption")
s3 = J.d["trades"][k3]["shots"][0]
ok((s3.get("tg") or {}).get("msg") == 1001 and s3["tg"]["chat"] == "-1009990001", "the picture remembers its Telegram message")
# delete -> the copy goes too
gone = J.del_shot(k3, s3["id"])
jshots.forget("u1", k3, gone)
jshots.wait_idle(5)
ok(fake("/_deleted") == [{"chat": "-1009990001", "msg": 1001}] and not os.path.exists(jshots.file_of("u1", k3, s3)),
   "deleting a picture deletes its file and its Telegram copy")
# a refused chat: recorded, retried
J.set_settings({"shots": {"tg_chat": "400"}})
jshots.draw_now("u1", k3, "entry")
jshots.wait_idle(10)
time.sleep(0.3)
s3b = J.d["trades"][k3]["shots"][0]
ok("chat not found" in (s3b.get("tg") or {}).get("err", "") and jshots.pending() >= 1, "a refused chat: the error is kept and it's tried again later")
ok("chat not found" in (jshots.tg_state("u1")["last"].get("error") or {}).get("msg", ""), "Settings shows the last error")
drain()
J.set_settings({"shots": {"tg_chat": "-1009990001"}})
since2 = jshots.cfg(J.d["settings"])["tg_since"]
ok(since2 >= since, "a new chat restarts the backup's stamp")
# start-up: only pictures since the stamp; the button: all of them
fake_telegram.DOCS.clear()
jshots.startup(["u1"])
jshots.wait_idle(15)
ok(len(fake("/_docs")) == 0, "start-up: older pictures (from before the backup began) aren't sent on their own")
n = jshots.tg_send_missing("u1")
jshots.wait_idle(30)
unsent = [s for t in J.d["trades"].values() for s in t.get("shots") or [] if not (s.get("tg") or {}).get("msg")]
ok(n >= 5 and len(fake("/_docs")) == n and not unsent, f"'Send the ones not in Telegram yet' sends every picture ({n})")
jshots.tg_test("u1", "-1009990001")
ok(any("Journal backup" in m["text"] for m in fake("/_sent")), "Send a test: a message to that chat")

# v0.33.1: a separate Telegram channel for Live trades (owner, 5 Nov)
c = jshots.cfg(J.d["settings"])
ok(jshots.chat_for(c, {"mode": "live"}) == "-1009990001", "no Live channel set: Live trades' pictures go to the journal's chat")
ok(raises(jshots.clean_cfg, {"tg_chat_live": "my live channel"}, {}), "the Live channel must be a number or @name too")
J.set_settings({"shots": {"tg_chat_live": "-1009990002"}})
c = jshots.cfg(J.d["settings"])
ok(jshots.chat_for(c, {"mode": "live"}) == "-1009990002" and jshots.chat_for(c, {"mode": "paper"}) == "-1009990001"
   and c["tg_since"] >= since2, "Live channel set: Live trades there, paper trades in the journal's chat (and a new stamp)")
kl = next(k for k, t in J.d["trades"].items() if t.get("shots"))
kp = next(k for k, t in J.d["trades"].items() if t.get("shots") and k != kl)
with J.lock:
    J.d["trades"][kl]["mode"] = "live"
    for k in (kl, kp):
        for sh in J.d["trades"][k]["shots"]:
            sh["tg"] = {}
fake_telegram.DOCS.clear()
n = jshots.tg_send_missing("u1")
jshots.wait_idle(30)
docs = fake("/_docs")
nl, np_ = len(J.d["trades"][kl]["shots"]), len(J.d["trades"][kp]["shots"])
ok(n == nl + np_ and sum(d["chat"] == "-1009990002" for d in docs) == nl and sum(d["chat"] == "-1009990001" for d in docs) == np_
   and "LIVE" in next(d["caption"] for d in docs if d["chat"] == "-1009990002"),
   f"each picture to its own channel: {nl} Live trade picture(s) to the Live channel (captioned LIVE), {np_} paper to the journal's")
ok(all(sh["tg"]["chat"] == "-1009990002" for sh in J.d["trades"][kl]["shots"]), "…and each remembers which chat it's in (deleting removes it there)")
# Live only: the journal's chat emptied
J.set_settings({"shots": {"tg_chat": ""}})
c = jshots.cfg(J.d["settings"])
with J.lock:
    for sh in J.d["trades"][kp]["shots"]:
        sh["tg"] = {}
ok(jshots.tg_on(c) and jshots.chat_for(c, {"mode": "paper"}) == "" and jshots.tg_send_missing("u1") == 0,
   "Live channel only: paper pictures aren't sent (nor counted as waiting)")
ok(jshots.review_chat(c) == "-1009990002", "…and the weekly review's summary goes to the Live channel then")
J.set_settings({"shots": {"tg_chat": "-1009990001", "tg_chat_live": ""}})
ok(jshots.review_chat(jshots.cfg(J.d["settings"])) == "-1009990001", "the weekly review's summary: the journal's chat")
jshots.tg_test("u1", "-1009990002", live=True)
ok(any("Live" in m["text"] and m["chat"] == "-1009990002" for m in fake("/_sent")), "Send a test to the Live channel")
u = jshots.usage("u1")
ok(u["files"] >= 5 and u["mb"] >= 0, "space used is counted")

print(f"\n{N_OK[0]} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
