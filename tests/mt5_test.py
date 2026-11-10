"""MT5 bridge (roadmap 8, stage a), no browser: the bridge key, the EA's sync call (account, clock, ticks to the feed, the
commands it gets back), candles through HIST (saved, fresh, older, 45-minute, offline), the symbol list and search, the
broker's clock rule, paper trading refusing MT5 symbols, and Fyers' feed never asked for MT5 symbols.
The EA is played by tests/fake_mt5.py's price model, called in-process.

  python3 tests/mt5_test.py"""
import asyncio
import os
import shutil
import sys
import tempfile
import time

D = tempfile.mkdtemp(prefix="mt5test_")
os.environ["FYERS_HELPER_DATA"] = D
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from helper import mt5, symbols, store  # noqa: E402
from helper.feed import Feed  # noqa: E402
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


class FakeLink:
    dir = "u/t1/"
    def token(self): return ""


class FakeEAInProc:
    """fake_mt5's EA, talking straight to helper/mt5.py (no HTTP)."""
    def __init__(self, uid, feed, login=21182752, fixed=None):
        self.ea = fake_mt5.FakeEA("http://x", "k", login=login, fixed_offset=fixed)
        self.uid, self.feed = uid, feed
        self.ea.post = self.post
        self.replies = []

    def post(self, path, body):
        if path == "/api/mt5/sync":
            txt = mt5.sync(self.uid, body, "203.0.113.9", self.feed)
            self.replies.append(txt)
            return 200, txt
        if path == "/api/mt5/bars":
            return 200, str(mt5.take_bars(self.uid, body))
        if path == "/api/mt5/symbols":
            return 200, str(mt5.take_symbols(self.uid, body))
        return 404, ""


async def ea_loop(ea, stop):
    while not stop.is_set():
        ea.ea.once()
        await asyncio.sleep(0.05)


async def main():
    uid = "t1"
    store.save(f"u/{uid}/x.json", {})
    feed = Feed(FakeLink(), "t1")
    feed.loop = asyncio.get_running_loop()
    got = []
    feed.on_tick = got.append
    client = feed.add()

    print("bridge key")
    key = mt5.new_key(uid)
    ok("a key looks like ftm-...", key.startswith("ftm-") and len(key) > 30)
    ok("the key finds its user", mt5.uid_for(key, "1.1.1.1") == uid)
    ok("only a hash is kept", key not in open(store.path(f"u/{uid}/mt5.json")).read())
    ok("a wrong key finds no one", mt5.uid_for("ftm-" + "x" * 32, "1.1.1.2") is None)
    for _ in range(31):
        mt5.uid_for("ftm-" + "y" * 32, "1.1.1.3")
    ok("30 wrong keys from one address: blocked", mt5.blocked("1.1.1.3") and mt5.uid_for(key, "1.1.1.3") is None)
    key2 = mt5.new_key(uid)
    ok("a new key stops the old one", mt5.uid_for(key, "1.1.1.4") is None and mt5.uid_for(key2, "1.1.1.4") == uid)

    print("the EA's first call")
    ea = FakeEAInProc(uid, feed)
    code = ea.ea.once()
    first = ea.replies[-1].splitlines()
    ok("answers OK with the poll interval", first[0] == "OK 250", first)
    ok("asks for the symbol list (none known yet)", "LIST" in first, first)
    ok("streams nothing yet (no page wants MT5)", "SUB " in first or "SUB" in first)
    ok("the symbol list arrived", len(mt5.user(uid).specs) == 3, list(mt5.user(uid).specs))
    st = mt5.status(uid, "example.test")
    b = st["bridges"][0] if st["bridges"] else {}
    ok("status: the terminal, connected, its server and account", b.get("login") == 21182752 and b.get("online") and
       b.get("server") == "FundingPips-SIM1" and b.get("mode") == "hedge" and b.get("demo") and b.get("ip") == "203.0.113.9", b)
    off = 7200 + (3600 if mt5.us_dst(time.time()) else 0)
    ok("the broker's clock: offset from srv - gmt", st["offset"] == off, st["offset"])
    ok("its day starts at the right IST time", st["day_ist"] == ("03:30" if off == 7200 else "02:30"), st["day_ist"])
    ok("the price pill: on, with the login", (mt5.brief(uid) or {}).get("on") and mt5.brief(uid)["login"] == 21182752)

    print("symbols")
    r = mt5.row(uid, "MT5:XAUUSD")
    ok("MT5:XAUUSD row: tick 0.01, contract 100, kind CFD, exchange MT5", r and r["tick"] == 0.01 and r["mult"] == 100 and
       r["f"] == "CFD" and r["x"] == "MT5", r)
    ok("the row's session starts at the broker's midnight", r and r["sess"] == ("0330-0330" if off == 7200 else "0230-0230"), r and r["sess"])
    ok("symbols.get finds MT5 symbols through the hook", (symbols.EXTRA is None and (setattr(symbols, "EXTRA", lambda t: mt5.row(None, t)) or True))
       and (symbols.get("MT5:EURUSD") or {}).get("tick") == 0.00001)
    hits = [x["s"] for x in mt5.search(uid, "gold")]
    ok("search 'gold' finds XAUUSD by its description", hits == ["MT5:XAUUSD"], hits)
    hits = [x["s"] for x in mt5.search(uid, "us")]
    ok("search 'us': exact / Market Watch first", hits[:1] == ["MT5:EURUSD"] or "MT5:XAUUSD" in hits, hits)
    ok("search 'mt5 eur' (the prefix typed)", [x["s"] for x in mt5.search(uid, "mt5 eur")] == ["MT5:EURUSD"])

    print("ticks")
    feed.want(client, ["MT5:XAUUSD", "MCX:CRUDEOIL26NOVFUT"])
    await asyncio.sleep(0.05)
    ea.ea.once()
    sub = [x for x in ea.replies[-1].splitlines() if x.startswith("SUB")][0]
    ok("SUB asks the EA for exactly the MT5 symbols pages want", sub == "SUB XAUUSD", sub)
    ok("Fyers is never asked for MT5 symbols", feed.fy_wanted() == ["MCX:CRUDEOIL26NOVFUT"], feed.fy_wanted())
    ea.ea.once()
    await asyncio.sleep(0.05)
    tk = [t for t in got if t["s"] == "MT5:XAUUSD"]
    ok("ticks reach the feed as MT5:XAUUSD", len(tk) >= 1, len(tk))
    if tk:
        t = tk[-1]
        ok("ltp = bid, ask above, src mt5", t["ltp"] == t["bid"] and t["ask"] > t["bid"] and t["src"] == "mt5", t)
        ok("tick time is UTC (server time - offset)", abs(t["t"] - time.time()) < 3, t["t"] - time.time())
    ok("the page gets the tick", any("tick" in m and m["tick"]["s"] == "MT5:XAUUSD" for m in list(client.queue._queue)))
    ok("MT5 ticks don't make Fyers' feed look alive", feed.last_tick_at == 0)
    body = ea.ea.sync_body()
    n0 = len(got)
    mt5.sync(uid, body, "203.0.113.9", feed)
    mt5.sync(uid, body, "203.0.113.9", feed)                 # the EA sends the same ticks again (its last call failed)
    await asyncio.sleep(0.05)
    ok("ticks sent twice reach the feed once", len(got) - n0 == 1, len(got) - n0)
    msc = body["ticks"][0][1] + 5000
    two = {**body, "ticks": [["XAUUSD", msc, 2650.10, 2650.35, 0, 1], ["XAUUSD", msc, 2650.20, 2650.45, 0, 1]]}
    n1 = len(got)
    mt5.sync(uid, two, "203.0.113.9", feed)
    await asyncio.sleep(0.05)
    ok("two ticks in the same millisecond in one call: both pass, the last is the price", len(got) - n1 == 2 and got[-1]["bid"] == 2650.20,
       got[-2:])
    feed.set_depth(client, ["MT5:XAUUSD"])
    ok("no order book asked of Fyers for MT5", feed.wanted_depth() == [])

    print("candles")
    stop = asyncio.Event()
    task = asyncio.create_task(ea_loop(ea, stop))
    rows = await mt5.history(uid, f"u/{uid}/", "MT5:XAUUSD", "5", 3)
    ok("5m candles for 3 days arrive", len(rows) > 300, len(rows))
    clock = mt5.user(uid).clock()
    ok("candle times are UTC on 5-minute boundaries of the broker's day", all((clock.to_srv(x[0]) % 300) == 0 for x in rows), rows[:2])
    ok("no weekend candles (broker time)", all(not fake_mt5.weekend(clock.to_srv(x[0])) for x in rows))
    ok("prices match the EA's own (CopyRates)", rows and abs(rows[-2][1] - fake_mt5.price("XAUUSD", clock.to_srv(rows[-2][0]))) < 0.02, rows[-2:])
    n_before = len(ea.ea.hist_asked)
    rows2 = await mt5.history(uid, f"u/{uid}/", "MT5:XAUUSD", "5", 3)
    ok("asked again at once: from the saved copy, no new request", len(ea.ea.hist_asked) == n_before and len(rows2) == len(rows),
       (len(ea.ea.hist_asked), n_before))
    rows3 = await mt5.history(uid, f"u/{uid}/", "MT5:XAUUSD", "5", 10)
    asked = ea.ea.hist_asked[n_before:]
    ok("more days: only the older part is asked for", len(asked) == 1 and asked[0][3] <= clock.to_srv(rows[0][0]) + 86400, asked)
    ok("... and the chart gets 10 days", len(rows3) > len(rows) * 2.5, (len(rows3), len(rows)))
    d = await mt5.history(uid, f"u/{uid}/", "MT5:XAUUSD", "D", 60)
    ok("daily candles: stamped 00:00 IST of the broker's date (summer time can't move them)", d and all((x[0] + 19800) % 86400 == 0 for x in d), d[:2])
    ok("... with the broker's day's prices", d and abs(d[-3][1] - fake_mt5.price("XAUUSD", d[-3][0] + 19800)) < 0.02, d[-3:])
    h45 = await mt5.history(uid, f"u/{uid}/", "MT5:XAUUSD", "45", 3)
    ok("45m built from 15m, from the broker's midnight", h45 and all((clock.to_srv(x[0]) % 86400) % 2700 == 0 for x in h45), h45[:2])
    try:
        await mt5.history(uid, f"u/{uid}/", "MT5:NOSUCH", "5", 2)
        ok("an unknown symbol: MT5's error", False)
    except Exception as e:
        ok("an unknown symbol: MT5's error", "isn't a symbol" in str(e), e)
    stop.set()
    await task

    print("offline")
    for bb in mt5.user(uid).bridges.values():
        bb.seen = time.time() - 60
    ok("the pill says off", (mt5.brief(uid) or {}).get("on") is False)
    rows4 = await mt5.history(uid, f"u/{uid}/", "MT5:XAUUSD", "5", 3)
    ok("offline: the saved candles still serve", len(rows4) >= len(rows) - 2, len(rows4))
    try:
        await mt5.history(uid, f"u/{uid}/", "MT5:EURUSD", "5", 3)
        ok("offline, nothing saved: a clear message", False)
    except mt5.Offline as e:
        ok("offline, nothing saved: a clear message", "isn't connected" in str(e), e)
    ea.ea.once()
    ok("calling again: connected again", (mt5.brief(uid) or {}).get("on") is True)

    print("the broker's clock")
    c = mt5.Clock(7200, "us")
    summer = dt_ts(2026, 7, 1, 12)
    winter = dt_ts(2026, 12, 1, 12)
    ok("summer candle: server 15:00 = 12:00 UTC (GMT+3)", c.to_utc(summer + 3 * 3600) == summer)
    ok("winter candle: server 14:00 = 12:00 UTC (GMT+2)", c.to_utc(winter + 2 * 3600) == winter)
    ok("to_srv is the inverse", c.to_srv(summer) == summer + 3 * 3600 and c.to_srv(winter) == winter + 7200)
    f = mt5.Clock(10800, "fixed")
    ok("fixed clock: always the same offset", f.to_utc(summer + 10800) == summer and f.to_utc(winter + 10800) == winter)
    st = mt5.settings(uid, {"clock": "fixed"})
    ok("changing the rule is saved and clears MT5 candles", st["clock"] == "fixed" and not await_rows(uid))
    mt5.settings(uid, {"clock": "us"})

    print("paper trading refuses MT5 (stage a)")
    from helper.paper import Paper, Refused
    p = Paper.__new__(Paper)
    try:
        Paper.row(p, "MT5:XAUUSD")
        ok("Paper.row refuses MT5 symbols", False)
    except Refused as e:
        ok("Paper.row refuses MT5 symbols", "charts only" in str(e), e)

    print("revoked key")
    mt5.revoke(uid)
    ok("after removing the key, the EA is refused", mt5.uid_for(key2, "1.1.1.5") is None)


def await_rows(uid):
    from helper import candles
    with candles._lock:
        return candles._conn(f"u/{uid}/").execute("SELECT COUNT(*) FROM bars WHERE sym LIKE 'MT5:%'").fetchone()[0]


def dt_ts(y, m, d, h):
    import datetime as dt
    return int(dt.datetime(y, m, d, h, tzinfo=dt.timezone.utc).timestamp())


try:
    asyncio.run(main())
finally:
    shutil.rmtree(D, ignore_errors=True)
print(f"\n{OK} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
