"""Alerts (v0.38.0) without a browser: the server's alert engine in-process, with the real Pine runner (Node,
helper/pine_node.mjs), made-up candles and ticks. Checks every operator, the four triggers, multi-condition, watchlist
alerts, technical alerts (built-in indicators, a Pine script's plot, alertcondition(), alert() calls), drawings, chart
types, expiry, the message's placeholders, the webhook and phone push (encrypted, then decrypted as a browser would).

    python3 tests/chartalerts_test.py          (needs Node; ~30 s)"""
import asyncio
import datetime as dt
import http.server
import json
import os
import shutil
import sys
import tempfile
import threading

D = tempfile.mkdtemp(prefix="calerts_")
os.environ["FYERS_HELPER_DATA"] = D
os.environ["FTM_WEBHOOK_PRIVATE"] = "1"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from helper import chartalerts as CA, store, symbols, webpush  # noqa: E402
from helper import candles as candles_store  # noqa: E402

OK = FAIL = 0


def check(name, cond, info=""):
    global OK, FAIL
    if cond:
        OK += 1
        print("  ok  ", name)
    else:
        FAIL += 1
        print("  FAIL", name, info)


IST = 19800
DAY = int(dt.datetime(2026, 11, 11, tzinfo=dt.timezone.utc).timestamp())       # 00:00 UTC; the session is IST
OPEN = DAY + 9 * 3600 + 15 * 60 - IST                                           # 09:15 IST in UTC seconds
CLOCK = [OPEN + 3600]
CA._now = lambda: CLOCK[0]

ROWS = {}                      # (symbol, res) -> [[t, o, h, l, c, v]]


def make(sym, base=100.0, n=60, step=0.0, res="5"):
    sec = int(res) * 60
    out, px = [], base
    for i in range(n):
        o = px
        px = base + step * (i + 1)
        out.append([OPEN - (n - 1 - i) * sec, o, max(o, px) + 0.1, min(o, px) - 0.1, px, 100])
    ROWS[(sym, res)] = out
    return out


def fake_get(link, symbol, res, days, since=0):
    return [list(r) for r in ROWS.get((symbol, res), [])]


candles_store.get = fake_get
symbols.get = lambda s: {"s": s, "tick": 0.05, "sess": "0915-1530", "u": s.split(":")[-1][:4], "d": s.split(":")[-1], "lot": 1, "f": "FUT"} if ":" in s else None


class FakeFeed:
    def __init__(self):
        self.last = {}
        self.sent = []

    def broadcast(self, m, acct=None):
        self.sent.append(m)

    def wanted(self):
        return []

    def _resync(self):
        pass


class FakeRT:
    def __init__(self, uid="T"):
        self.uid, self.dir, self.label, self.feed, self.link, self.loop = uid, f"u/{uid}/", uid, FakeFeed(), None, None


def fired(urt):
    return [m["calert"] for m in urt.feed.sent if "calert" in m]


def tick(b, s, px, t=None, **kw):
    if t is not None:
        CLOCK[0] = t                                    # the clock follows the ticks' own times
    t = {"s": s, "ltp": px, "bid": px - 0.05, "ask": px + 0.05, "t": t if t is not None else CLOCK[0], "vol": kw.pop("vol", None), **kw}
    b.urt.feed.last[s] = t
    b.on_tick(t)


async def settle(b, n=80):
    """Run the engine's loop by hand until every session is open and has the latest bars."""
    for i in range(n):
        await b._step(i + 1)
        await asyncio.sleep(0.03)
        busy = any(se.busy or not se.open or se.series.ver != se.ver for se in b.sess.values())
        loading = any(s.loading or not s.loaded for s in b.series.values())
        if not busy and not loading and i > 2:
            return True
    return False


def new_book(uid):
    urt = FakeRT(uid)
    b = CA.Book(urt)
    CA.BOOKS[uid] = b                          # (as chartalerts.book() does: the server-wide count sees it)
    return urt, b


def alert(**kw):
    a = {"target": {"s": "NSE:AAA"}, "conds": [], "freq": "once", "notify": {"popup": True, "push": False}}
    a.update(kw)
    return a


def P(f="last"):
    return {"k": "price", "f": f}


def V(v):
    return {"k": "value", "v": v}


async def main():
    print("Price alerts (each tick)")
    make("NSE:AAA", 99.0)
    urt, b = new_book("p1")
    a = b.upsert(alert(conds=[{"a": P(), "op": "cross_up", "b": V(100), "tf": "5m"}]))
    check("a price-only alert needs no candles (no session)", not b.sess and not b.series)
    tick(b, "NSE:AAA", 101.0)
    check("crossing up: not on the first tick (already above; it must come from below)", not fired(urt))
    tick(b, "NSE:AAA", 99.5)
    tick(b, "NSE:AAA", 100.0)
    f = fired(urt)
    check("crossing up fires when the price reaches the level from below", len(f) == 1, f)
    check("only once: the alert is then 'triggered'", b.get(a["id"])["status"] == "triggered")
    tick(b, "NSE:AAA", 99)
    tick(b, "NSE:AAA", 101)
    check("...and doesn't fire again", len(fired(urt)) == 1)
    check("the default message names the symbol and the condition", "AAA" in f[0]["msg"] and "crossing up" in f[0]["msg"].lower(), f[0]["msg"])
    log_ = b.read_log()
    check("the log has it", log_ and log_[0]["aid"] == a["id"])

    urt, b = new_book("p1b")
    urt.feed.last["NSE:AAA"] = {"s": "NSE:AAA", "ltp": 99.0}
    b.upsert(alert(conds=[{"a": P(), "op": "cross_up", "b": V(100), "tf": "5m"}]))
    tick(b, "NSE:AAA", 100.5)
    check("the price when the alert is set is where it starts: the very first tick can cross", len(fired(urt)) == 1)

    urt, b = new_book("p2")
    b.upsert(alert(conds=[{"a": P(), "op": "cross_up", "b": V(100), "tf": "5m"}]))
    tick(b, "NSE:AAA", 99.0, h=99.5, l=98.0)
    tick(b, "NSE:AAA", 99.2, h=100.5, l=98.0)
    check("a trade through the level between snapshots (the day's high) counts as crossing", len(fired(urt)) == 1)

    urt, b = new_book("p3")
    b.upsert(alert(conds=[{"a": P(), "op": "cross_dn", "b": V(100), "tf": "5m"}], freq="bar"))
    tick(b, "NSE:AAA", 101)
    tick(b, "NSE:AAA", 100)
    tick(b, "NSE:AAA", 101)
    tick(b, "NSE:AAA", 99.9)
    check("once per bar: a second crossing down in the same bar doesn't fire", len(fired(urt)) == 1)
    tick(b, "NSE:AAA", 101, t=CLOCK[0] + 300)
    tick(b, "NSE:AAA", 99.0, t=CLOCK[0] + 301)
    check("...the next bar fires again", len(fired(urt)) == 2)

    urt, b = new_book("p4")
    b.upsert(alert(conds=[{"a": P(), "op": "gt", "b": V(100), "tf": "5m"}], freq="minute"))
    tick(b, "NSE:AAA", 100.5)
    check("greater than: already true counts at once", len(fired(urt)) == 1)
    CLOCK[0] += 30
    tick(b, "NSE:AAA", 100.6)
    check("once per minute: not again within the minute", len(fired(urt)) == 1)
    CLOCK[0] += 31
    tick(b, "NSE:AAA", 100.7)
    check("...again after a minute", len(fired(urt)) == 2)

    urt, b = new_book("p5")
    ch = lambda op: b.upsert(alert(name=op, conds=[{"a": P(), "op": op, "lo": V(100), "hi": V(105), "tf": "5m"}], freq="bar"))
    for op in ("enter", "exit", "inside", "outside"):
        ch(op)
    tick(b, "NSE:AAA", 99)
    names = lambda: [x["name"] for x in fired(urt)]
    check("outside channel fires below the channel", names() == ["outside"], names())
    tick(b, "NSE:AAA", 101, t=CLOCK[0] + 300)
    check("entering channel and inside channel fire on the way in", sorted(names()) == ["enter", "inside", "outside"], names())
    tick(b, "NSE:AAA", 106, t=CLOCK[0] + 600)
    check("exiting channel fires on the way out (and outside again)", sorted(names()) == ["enter", "exit", "inside", "outside", "outside"], names())

    urt, b = new_book("p6")
    b.upsert(alert(conds=[{"a": P("bid"), "op": "lt", "b": V(100), "tf": "5m"}]))
    tick(b, "NSE:AAA", 100.02)
    check("the bid (0.05 under the last price here) can be chosen", len(fired(urt)) == 1)

    print("Technical alerts (bars + Pine in Node)")
    if not CA.node_path():
        check("Node is installed", False)
        return
    make("NSE:BBB", 100.0, n=80, step=-0.3)                   # falling: RSI low
    urt, b = new_book("t1")
    rsi = {"k": "ind", "t": "rsi", "p": {"len": 14}, "out": "RSI"}
    a = b.upsert(alert(target={"s": "NSE:BBB"}, conds=[{"a": rsi, "op": "cross_up", "b": V(50), "tf": "5m"}], freq="bar"))
    check("a built-in indicator alert is technical", CA.is_tech(a))
    check("its sessions: the bars and the RSI", len(b.sess) == 2, list(b.sess))
    ok = await settle(b)
    check("the Pine runner opened them", ok, {k: (s.open, s.err) for k, s in b.sess.items()})
    se = next(s for s in b.sess.values() if s.code)
    check("RSI is low after the fall", se.out["plots"]["RSI"][-1] is not None and se.out["plots"]["RSI"][-1] < 30, se.out["plots"])
    last = ROWS[("NSE:BBB", "5")][-1][4]
    tick(b, "NSE:BBB", last, t=OPEN + 10, vol=1000)
    await settle(b)
    check("not yet", not fired(urt))
    tick(b, "NSE:BBB", last + 12, t=OPEN + 60, vol=1100)
    await settle(b)
    f = fired(urt)
    check("RSI crossing up 50 on the live bar fires", len(f) == 1, (se.out["plots"]["RSI"], f))
    tick(b, "NSE:BBB", last + 13, t=OPEN + 90)
    await settle(b)
    check("once per bar: not twice in the bar", len(fired(urt)) == 1)

    print("Multi-condition")
    make("NSE:CCC", 100.0, n=80, step=0.2)                    # rising: RSI high
    urt, b = new_book("m1")
    c_rsi = {"a": {"k": "ind", "t": "rsi", "p": {"len": 14}, "out": "RSI"}, "op": "gt", "b": V(60), "tf": "5m"}
    c_px = {"a": P(), "op": "cross_up", "b": V(120), "tf": "5m"}
    b.upsert(alert(name="all", target={"s": "NSE:CCC"}, conds=[c_px, c_rsi], freq="bar"))
    b.upsert(alert(name="any", target={"s": "NSE:CCC"}, conds=[c_px, {**c_rsi, "op": "lt", "b": V(10)}], join="any", freq="bar"))
    await settle(b)
    last = ROWS[("NSE:CCC", "5")][-1][4]
    tick(b, "NSE:CCC", last, t=OPEN + 5)
    await settle(b)
    check("all: nothing while the price is under 120", not fired(urt))
    tick(b, "NSE:CCC", 120.5, t=OPEN + 20)
    await settle(b)
    names = [x["name"] for x in fired(urt)]
    check("all: the price crossing 120 with RSI above 60 fires", "all" in names, names)
    check("any: the crossing alone fires it", "any" in names, names)

    urt, b = new_book("m2")
    b.upsert(alert(name="both", target={"s": "NSE:CCC"}, conds=[c_px, {**c_rsi, "op": "lt", "b": V(10)}], freq="bar"))
    await settle(b)
    tick(b, "NSE:CCC", 119, t=OPEN + 5)
    tick(b, "NSE:CCC", 121, t=OPEN + 20)
    await settle(b)
    check("all: one condition false -> no alert", not fired(urt))

    print("Moving up %, once per bar close")
    make("NSE:DDD", 100.0, n=40, step=0.0)
    urt, b = new_book("c1")
    b.upsert(alert(name="mv", target={"s": "NSE:DDD"}, conds=[{"a": P(), "op": "up_pct", "amt": 2, "bars": 3, "tf": "5m"}], freq="bar"))
    b.upsert(alert(name="cl", target={"s": "NSE:DDD"}, conds=[{"a": P(), "op": "cross_up", "b": V(101), "tf": "5m"}], freq="close"))
    await settle(b)
    tick(b, "NSE:DDD", 101.5, t=OPEN + 10)
    await settle(b)
    check("moving up 2% in 3 bars: not at +1.5%", not [x for x in fired(urt) if x["name"] == "mv"])
    tick(b, "NSE:DDD", 102.2, t=OPEN + 20)
    await settle(b)
    check("...fires at +2.2%", [x["name"] for x in fired(urt)].count("mv") == 1)
    check("once per bar close: nothing while the bar is open", not [x for x in fired(urt) if x["name"] == "cl"])
    tick(b, "NSE:DDD", 100.5, t=OPEN + 200)                    # back under 101 before the bar closes
    tick(b, "NSE:DDD", 100.6, t=OPEN + 305)                    # next bar: the closed bar ended under 101
    await settle(b)
    check("a crossing that didn't hold to the close doesn't fire", not [x for x in fired(urt) if x["name"] == "cl"], [(x["name"], x["px"], x["t"] - OPEN, x["msg"]) for x in fired(urt)])
    tick(b, "NSE:DDD", 101.4, t=OPEN + 400)
    tick(b, "NSE:DDD", 101.3, t=OPEN + 605)                    # the next bar starts: the bar closed at 101.4
    await settle(b)
    check("the bar closing above fires on the next bar's first tick", [x["name"] for x in fired(urt)].count("cl") == 1, [x["name"] for x in fired(urt)])

    urt, b = new_book("c2")
    b.upsert(alert(name="timer", target={"s": "NSE:DDD"}, conds=[{"a": {"k": "ind", "t": "sma", "p": {"len": 3}, "out": "MA"}, "op": "gt", "b": V(103), "tf": "5m"}], freq="close"))
    await settle(b)
    tick(b, "NSE:DDD", 110, t=OPEN + 900 + 10)
    await settle(b)
    check("no tick after the bar's time is up: nothing yet", not fired(urt))
    CLOCK[0] = OPEN + IST * 0 + 900 + 300 + 5                   # (CLOCK is UTC; bars are IST-shifted)
    b._timers(CLOCK[0])
    for _ in range(40):
        await asyncio.sleep(0.05)
        if fired(urt):
            break
    check("its time up (+2 s), the bar is worked out in full and fires", [x["name"] for x in fired(urt)] == ["timer"], fired(urt))

    print("A Pine script: plot, alertcondition(), alert() calls")
    code = '''//@version=5
indicator("My osc")
r = ta.rsi(close, 5)
plot(r, "Fast RSI")
plot(ta.sma(close, 3), "SMA3")
alertcondition(r > 70, "Hot", "{{ticker}} is hot at {{close}}")
if ta.crossover(r, 50)
    alert("cross " + str.tostring(math.round(r)), alert.freq_once_per_bar)
'''
    make("NSE:EEE", 100.0, n=60, step=-0.2)
    urt, b = new_book("s1")
    src = {"k": "pine", "name": "My osc", "code": code, "inputs": {}}
    b.upsert(alert(name="plot", target={"s": "NSE:EEE"}, conds=[{"a": {**src, "plot": "Fast RSI"}, "op": "cross_up", "b": V(50), "tf": "5m"}], freq="bar",
                   msg="{{ticker}} fast RSI {{plot_0}} / {{plot(\"SMA3\")}} at {{close}} ({{interval}})"))
    b.upsert(alert(name="ac", target={"s": "NSE:EEE"}, conds=[{"a": {**src, "ac": "Hot"}, "op": "true", "tf": "5m"}], freq="bar"))
    b.upsert(alert(name="any", target={"s": "NSE:EEE"}, conds=[{"a": {**src, "any": True}, "op": "true", "tf": "5m"}]))
    check("three alerts on one script with the same inputs share one Pine session", sum(1 for s in b.sess.values() if s.code) == 1)
    await settle(b)
    last = ROWS[("NSE:EEE", "5")][-1][4]
    tick(b, "NSE:EEE", last, t=OPEN + 5)
    await settle(b)
    tick(b, "NSE:EEE", last + 8, t=OPEN + 30)
    await settle(b)
    f = {x["name"]: x for x in fired(urt)}
    check("a script's plot crossing fires", "plot" in f, list(f))
    check("its message fills {{plot_0}}, {{plot(\"SMA3\")}}, {{close}}, {{interval}}",
          "plot" in f and "EEE fast RSI" in f["plot"]["msg"] and "(5)" in f["plot"]["msg"] and "{{" not in f["plot"]["msg"], f.get("plot", {}).get("msg"))
    check("alertcondition() fires with the script's own message", "ac" in f and f["ac"]["msg"].startswith("EEE is hot at"), f.get("ac"))
    check("any alert() call fires with the call's message", "any" in f and f["any"]["msg"].startswith("cross "), f.get("any"))

    print("Drawings, chart types")
    make("NSE:FFF", 100.0, n=60, step=0.0)
    from helper import jreplay
    DF = jreplay.draw_file("u/d1/", "NSE:FFF")
    t0 = ROWS[("NSE:FFF", "5")][0][0] + IST
    store.save(DF, {"s": "NSE:FFF", "items": [
        {"id": "tl1", "type": "trend", "pts": [{"t": t0, "p": 104.0}, {"t": t0 + 59 * 300, "p": 102.0}], "st": {"er": True}},
        {"id": "ch1", "type": "channel", "pts": [{"t": t0, "p": 99}, {"t": t0 + 50 * 300, "p": 99}, {"t": t0, "p": 101}], "st": {"er": True}}]})
    urt, b = new_book("d1")
    b.upsert(alert(name="tl", target={"s": "NSE:FFF"}, conds=[{"a": P(), "op": "cross_up", "b": {"k": "draw", "id": "tl1", "edge": "v", "name": "Trend line"}, "tf": "5m"}], freq="bar"))
    b.upsert(alert(name="exit", target={"s": "NSE:FFF"}, conds=[{"a": P(), "op": "exit", "lo": {"k": "draw", "id": "ch1", "edge": "lower"}, "hi": {"k": "draw", "id": "ch1", "edge": "upper"}, "tf": "5m"}], freq="bar"))
    await settle(b)
    bs = next(s for s in b.sess.values() if not s.code)
    lv = bs.out["draws"]["tl1"]["v"]
    check("the trend line's value on the latest bars (falling 2 over 59 bars)", lv[-1] is not None and 101.9 < lv[-1] < 102.1, lv)
    tick(b, "NSE:FFF", 100.0, t=OPEN + 5)
    await settle(b)
    tick(b, "NSE:FFF", 102.5, t=OPEN + 20)
    names = [x["name"] for x in fired(urt)]
    check("the price crossing the trend line fires", "tl" in names, (names, bs.out["draws"]))
    check("leaving the parallel channel fires", "exit" in names, names)
    items = store.load(DF)["items"]
    items[0]["pts"] = [{"t": t0, "p": 110.0}, {"t": t0 + 59 * 300, "p": 110.0}]
    store.save(DF, {"s": "NSE:FFF", "items": items})
    b.drawings_changed("NSE:FFF")
    await asyncio.sleep(0.5)
    check("a moved drawing: the alert follows it", (bs.out["draws"]["tl1"]["v"][-1] or 0) > 109, bs.out["draws"]["tl1"])

    urt, b = new_book("r1")
    a = b.upsert(alert(name="renko", target={"s": "NSE:FFF"}, ctype={"type": "renko", "opts": {"renkoMode": "fixed", "renkoBox": {"NSE:FFF"[4:8]: 1.0}}},
                       conds=[{"a": {"k": "bar", "f": "close"}, "op": "gt", "b": V(103), "tf": "5m"}], freq="bar"))
    await settle(b)
    bs = next(iter(b.sess.values()))
    check("a Renko alert runs on bricks (1.00 box: closes on the box grid)", bs.out and all(abs(c - round(c)) < 1e-6 for c in bs.out["bars"]["close"]), bs.out and bs.out["bars"])
    tick(b, "NSE:FFF", 104.2, t=OPEN + 900)
    await settle(b)
    check("...and fires when a brick closes above 103", [x["name"] for x in fired(urt)] == ["renko"], (bs.out["bars"], fired(urt)))

    print("Watchlist alerts")
    for s_ in ("NSE:W1", "NSE:W2", "NSE:W3"):
        make(s_, 100.0)
    store.save("u/w1/prefs.json", {"wlists": [{"id": "wA", "name": "Mine", "items": [{"s": "NSE:W1"}, {"s": "NSE:W2"}, {"s": "NSE:W3"}]}]})
    urt, b = new_book("w1")
    a = b.upsert(alert(name="wl", target={"wl": "wA", "wl_name": "Mine"}, conds=[{"a": P(), "op": "gt", "b": V(101), "tf": "5m"}], freq="once"))
    check("a watchlist alert watches each symbol", b.symbols() == ["NSE:W1", "NSE:W2", "NSE:W3"], b.symbols())
    tick(b, "NSE:W2", 102)
    tick(b, "NSE:W2", 103)
    tick(b, "NSE:W3", 100)
    check("each symbol on its own: W2 fires once", [x["s"] for x in fired(urt)] == ["NSE:W2"], fired(urt))
    check("...and the alert stays on for the others", b.get(a["id"])["status"] == "active")
    tick(b, "NSE:W1", 105)
    tick(b, "NSE:W3", 105)
    check("all three fired: the alert is triggered", b.get(a["id"])["status"] == "triggered" and len(fired(urt)) == 3)
    try:
        b.upsert(alert(target={"wl": "wA"}, conds=[{"a": P(), "op": "gt", "b": {"k": "draw", "id": "x"}, "tf": "5m"}]))
        check("drawings refused on a watchlist alert", False)
    except CA.Bad:
        check("drawings refused on a watchlist alert", True)

    print("Expiry, limits, checks")
    os.environ["FTM_WEBHOOK_PRIVATE"] = "0"                       # (as on the server: webhooks on ports 80 / 443 only)
    urt, b = new_book("e1")
    a = b.upsert(alert(conds=[{"a": P(), "op": "gt", "b": V(1000), "tf": "5m"}], exp=int(CLOCK[0]) + 60))
    CLOCK[0] += 61
    b._timers(CLOCK[0])
    check("an alert past its expiry is 'expired'", b.get(a["id"])["status"] == "expired")
    check("...and noted in the log", b.read_log()[0].get("kind") == "expired")
    for bad, why in ((alert(conds=[]), "no condition"), (alert(conds=[{"a": V(1), "op": "gt", "b": V(2), "tf": "5m"}]), "a number first"),
                     (alert(conds=[{"a": P(), "op": "nope", "tf": "5m"}]), "operator"),
                     (alert(conds=[{"a": P(), "op": "gt", "b": V(1), "tf": "5m"}] * 6), "six conditions"),
                     (alert(conds=[{"a": {"k": "pf", "sig": "buy"}, "op": "true", "tf": "5m"}]), "P&F on candles"),
                     (alert(conds=[{"a": P(), "op": "gt", "b": V(1), "tf": "5m"}], notify={"webhook": "http://example.com:8080/x"}), "webhook port")):
        try:
            b.upsert(bad)
            check(f"refused: {why}", False)
        except CA.Bad:
            check(f"refused: {why}", True)

    os.environ["FTM_WEBHOOK_PRIVATE"] = "1"
    print("No limit on the number of alerts; a limit on calculations (v0.38.1)")
    for bk in list(CA.BOOKS.values()):                # (earlier sections' calculations stop: this one counts from 0)
        bk.stop()
    CA.BOOKS.clear()
    urt, b = new_book("L1")
    for i in range(450):
        b.upsert(alert(name=f"n{i}", conds=[{"a": P(), "op": "gt", "b": V(10000 + i), "tf": "5m"}]))
    check("450 price alerts: no limit (they need no calculation)", len(b.alerts) == 450 and CA.load()["calcs"] == 0)
    CA.set_max_calcs(2)
    rsi = lambda n: {"k": "ind", "t": "rsi", "p": {"len": n}, "out": "RSI"}
    b.upsert(alert(name="r1", target={"s": "NSE:BBB"}, conds=[{"a": rsi(14), "op": "gt", "b": V(50), "tf": "5m"}], freq="bar"))
    b.upsert(alert(name="r1 again", target={"s": "NSE:BBB"}, conds=[{"a": rsi(14), "op": "lt", "b": V(30), "tf": "5m"}], freq="bar"))
    check("two alerts on the same RSI share one calculation", CA.load()["calcs"] == 1, CA.load())
    b.upsert(alert(name="r2", target={"s": "NSE:BBB"}, conds=[{"a": rsi(7), "op": "gt", "b": V(50), "tf": "5m"}], freq="bar"))
    try:
        b.upsert(alert(name="r3", target={"s": "NSE:BBB"}, conds=[{"a": rsi(21), "op": "gt", "b": V(50), "tf": "5m"}], freq="bar"))
        check("a third calculation is refused at a limit of 2", False)
    except CA.Bad as e:
        check("a third calculation is refused at a limit of 2 (saying how to make room)", "Server load" in str(e), str(e))
    r2 = next(a for a in b.alerts if a["name"] == "r2")
    b.action(r2["id"], "pause")
    b.upsert(alert(name="r3", target={"s": "NSE:BBB"}, conds=[{"a": rsi(21), "op": "gt", "b": V(50), "tf": "5m"}], freq="bar"))
    check("pausing one makes room for another", CA.load()["calcs"] == 2)
    try:
        b.action(r2["id"], "resume")
        check("resuming past the limit is refused", False)
    except CA.Bad:
        check("resuming past the limit is refused", True)
    r3 = next(a for a in b.alerts if a["name"] == "r3")
    b.upsert({**r3, "conds": [{"a": rsi(28), "op": "gt", "b": V(50), "tf": "5m"}]})
    check("editing an alert's own calculation doesn't count it twice", CA.load()["calcs"] == 2)
    CA.set_max_calcs(None)
    L = CA.load()
    check("automatic limit: from the machine's memory", L["auto"] and L["max"] == CA.auto_calcs() >= 20, L)
    for a in list(b.alerts):
        b.action(a["id"], "delete")

    print("Webhook, phone push, Telegram")
    got = []

    class H(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            got.append((self.headers.get("Content-Type"), self.rfile.read(int(self.headers["Content-Length"])).decode()))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *a):
            pass
    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_port}/hook"
    CA.clean_url = lambda u: u                                    # (the test's receiver is on a high port)
    from cryptography.hazmat.primitives.asymmetric import ec
    ua = ec.generate_private_key(ec.SECP256R1())
    auth = webpush.b64u(os.urandom(16))
    webpush.subscribe("h1", {"endpoint": "https://push.example/abc", "keys": {"p256dh": webpush.b64u(webpush._pub_bytes(ua)), "auth": auth}}, "test UA")
    pushed = []
    webpush._post = lambda u, h, body: (pushed.append((u, h, json.loads(webpush.decrypt(body, ua, auth)))), type("R", (), {"status_code": 201, "text": ""})())[1]
    urt, b = new_book("h1")
    b.upsert(alert(name="J", conds=[{"a": P(), "op": "gt", "b": V(100), "tf": "5m"}], msg='{"sym": "{{ticker}}", "px": {{close}}}',
                   notify={"push": True, "webhook": url, "tg": False}))
    tick(b, "NSE:AAA", 101)
    for _ in range(50):
        await asyncio.sleep(0.05)
        if got and pushed:
            break
    check("the webhook got the message as JSON", got and got[0][0] == "application/json" and json.loads(got[0][1]) == {"sym": "AAA", "px": 101}, got)
    check("phone push: encrypted for the browser, which reads it back", pushed and pushed[0][2]["title"] == "🔔 J" and '"sym"' in pushed[0][2]["body"], pushed)
    h = pushed[0][1] if pushed else {}
    check("...with a VAPID signature and aes128gcm", h.get("Content-Encoding") == "aes128gcm" and h.get("Authorization", "").startswith("vapid t="), h)
    CA.ALLOW_PRIVATE = False
    check("a webhook to a private address is refused", CA.webhook("http://127.0.0.1/x", "hi").startswith("refused"))
    srv.shutdown()
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import fake_telegram
    from helper import telegram, users
    fake_telegram.start(8779)
    os.environ["TELEGRAM_API"] = "http://127.0.0.1:8779"
    telegram.save("h2", {"token": users.seal("1234567:" + "A" * 35), "chat": "555"})
    urt, b = new_book("h2")
    b.upsert(alert(name="TG <test>", conds=[{"a": P(), "op": "gt", "b": V(100), "tf": "5m"}], notify={"tg": True, "push": False}))
    tick(b, "NSE:AAA", 101)
    sent = []
    for _ in range(60):
        await asyncio.sleep(0.05)
        sent = [m for m in fake_telegram.SENT if m.get("chat") == "555"]
        if sent:
            break
    check("Telegram: the alert reaches the bot's chat (HTML-escaped name)", sent and "TG &lt;test&gt;" in sent[0].get("text", ""), (sent, fake_telegram.SENT[-2:]))

    print("Placeholders")
    urt, b = new_book("x1")
    a = CA.clean(alert(name="N", conds=[{"a": P(), "op": "gt", "b": V(1), "tf": "1h"}]))
    ctx = {"sym": "MCX:GOLD", "row": {"d": "Gold"}, "bar": {"open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 10}, "tick": {"bid": 1.4, "ask": 1.6, "ltp": 1.5},
           "bar_t": DAY + IST, "plots": {"A": 3.5}, "titles": ["A"], "tf": "1h"}
    txt = b.render("{{exchange}}:{{ticker}} {{interval}} o{{open}} h{{high}} c{{close}} v{{volume}} {{bid}}/{{ask}} {{plot_0}} {{plot(\"A\")}} {{time}} {{unknown}}", a, ctx)
    check("TradingView's placeholders", txt == "MCX:GOLD 60 o1 h2 c1.5 v10 1.4/1.6 3.5 3.5 2026-11-11T00:00:00Z {{unknown}}", txt)
    ctx["bar"]["close"] = 24123.5
    check("numbers without thousands separators (a webhook's JSON stays valid)", b.render('{"px": {{close}}}', a, ctx) == '{"px": 24123.5}')

    for bk in list(CA.BOOKS.values()):
        bk.stop()
    CA.RUNNER.stop()


asyncio.run(main())
shutil.rmtree(D, ignore_errors=True)
print(f"\n{OK} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
