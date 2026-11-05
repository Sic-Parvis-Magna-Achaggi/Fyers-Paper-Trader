"""Telegram alerts: the helper's checks and heartbeat, the watchdog (in-process with a fake clock, then as its own
process), the outside heartbeat. Telegram and Healthchecks.io are faked (tests/fake_telegram.py). No browser, no Fyers.
Run: python3 tests/alerts_test.py      (about 30 s; PASS / FAIL per check, exits 1 on any failure)"""
import asyncio
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
D = "/tmp/fyers_alerts_test"
shutil.rmtree(D, ignore_errors=True)
os.makedirs(D)
for f in os.listdir(HERE + "/fixtures"):
    shutil.copy(HERE + "/fixtures/" + f, D)
TG_PORT, PING_PORT = 8781, 8782
os.environ.update(FYERS_HELPER_DATA=D, TELEGRAM_API=f"http://127.0.0.1:{TG_PORT}", HC_API=f"http://127.0.0.1:{TG_PORT}")
sys.path.insert(0, ROOT)
sys.path.insert(0, HERE)
import logging  # noqa: E402
logging.basicConfig(level=logging.ERROR, format="%(message)s")
import fake_telegram  # noqa: E402
from helper import alerts, live, paper, rt, store, symbols, telegram, users, watchdog  # noqa: E402
from helper.broker import norm_order  # noqa: E402
from helper.live import LiveEngine  # noqa: E402
from helper.paper import IST, Paper  # noqa: E402
from fake_broker import FakeBroker  # noqa: E402

fake_telegram.start(TG_PORT)
symbols.refresh()
FAILS = []
CRUDE = "MCX:CRUDEOIL26NOVFUT"
MON11 = dt.datetime(2026, 11, 2, 11, 0, tzinfo=IST).timestamp()        # a Monday, 11:00 IST (MCX and NSE open)
MON8 = dt.datetime(2026, 11, 2, 8, 0, tzinfo=IST).timestamp()          # before any market opens
T = [MON11]
alerts._now = lambda: T[0]
UID = "uadmin"
TOKEN = "1234567:" + "A" * 35


def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  <- {detail}"))
    if not ok:
        FAILS.append(name)


def sent():
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{TG_PORT}/_sent").read())


def hc_calls():
    return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{TG_PORT}/_hc").read())


def reset():
    urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{TG_PORT}/_reset", data=b"", method="POST"))


def tg_set(**k):
    s = {"token": users.seal(TOKEN), "bot": "@ftm_test_bot", "chat": "5550001", "link": "https://example.test/"}
    s.update(k)
    telegram.save(UID, s)


class Link:
    def __init__(self):
        self.tok = "tok"

    def token(self):
        return self.tok

    def margin(self, *a, **k):
        return 0.0


class Stream:
    up = True


class Feed:
    def __init__(self):
        self.last_at = {}


class URT:
    def __init__(self, uid, engines):
        self.uid, self.label, self.engines, self.feed = uid, "admin", engines, Feed()

    def live_engines(self):
        return [e for e in self.engines.values() if isinstance(e, LiveEngine)]


async def helper_side():
    fb = FakeBroker()
    e = LiveEngine("u/uadmin/a/a1/", Link(), "Live", broker=fb)
    e.stream = Stream()
    e.rules.update(size=1000000, risk_cap_pct=0, max_margin_pct=0, daily_pct=0, max_pct=0, max_open_risk_pct=0)
    e.acct.update(start=1000000, peak=1000000)
    fb.fund["eq"]["start"] = 1000000.0                   # v0.33.0: the Live account's balance is Fyers' own funds
    e._apply_funds(fb.funds())
    loop = asyncio.get_running_loop()
    fb.emit = lambda row: loop.call_soon_threadsafe(e.on_update, norm_order(row))
    e.start(loop)
    pe = Paper("u/uadmin/a/a2/", Link(), "Paper 1")
    urt = URT(UID, {"a1": e, "a2": pe})
    rt.RT.clear()
    rt.RT[UID] = urt
    fb.set_price(CRUDE, 5600, 5599, 5601)
    e.on_tick({"s": CRUDE, "ltp": 5600, "bid": 5599, "ask": 5601, "t": int(time.time())})
    e.place({"s": CRUDE, "side": 1, "type": "market", "sl": 5580, "tp": 5650, "mode": "lots", "lots": 1, "product": "MARGIN"})
    await asyncio.sleep(1.5)
    p = e.positions[0] if e.positions else {}
    check("set-up: a live position with its stop at Fyers", p.get("stop_oid") and p.get("stop_px") == 5580, p)
    urt.feed.last_at[CRUDE] = T[0] - 2

    alerts.heartbeat("test")
    hb = store.load("watch.json")
    a = (hb.get("users", {}).get(UID, {}).get("live") or [{}])[0]
    hp = (a.get("positions") or [{}])[0]
    check("heartbeat: the live account and its trade (lots, entry, stop at Fyers, target)",
          a.get("name") == "Live" and hp.get("s") == CRUDE and hp.get("lots") == 1 and hp.get("avg") == 5601
          and hp.get("stop_at_fyers") and hp.get("stop_px") == 5580 and hp.get("tp") == 5650, hb)
    check("heartbeat: the paper account isn't listed", len(hb["users"][UID]["live"]) == 1, hb)
    check("heartbeat: time and pid", abs(hb.get("t", 0) - T[0]) < 1 and hb.get("pid") == os.getpid(), hb)

    tg_set()
    reset()
    alerts.check()
    check("all well: nothing sent", sent() == [], sent())

    # a refused stop change: sent after 30 s, once
    p["stop_err"] = "RMS: test refusal"
    alerts.check()
    T[0] += 20
    alerts.check()
    check("a live warning isn't sent before 30 s", sent() == [], sent())
    T[0] += 11
    alerts.check()
    T[0] += 15
    alerts.check()
    m = sent()
    check("a live warning lasting 30 s is sent once", len(m) == 1 and "refused" in m[0]["text"] and "RMS: test refusal" in m[0]["text"]
          and "Live account Live" in m[0]["text"] and m[0]["chat"] == "5550001" and m[0]["mode"] == "HTML", m)
    check("the warning has the app's address", m and "https://example.test/" in m[0]["text"], m)
    p.pop("stop_err")
    alerts.check()
    m = sent()
    check("cleared: a 'sorted' message", len(m) == 2 and m[1]["text"].startswith("✅ Sorted") and "refused" in m[1]["text"], m)

    # no prices for 60 s in market hours
    reset()
    urt.feed.last_at[CRUDE] = T[0] - 50
    alerts.check()
    check("prices 50 s old: nothing", sent() == [], sent())
    T[0] += 15
    alerts.check()
    m = sent()
    check("no prices for 60 s: sent, with the stop at Fyers", len(m) == 1 and "No prices for CRUDEOIL26NOVFUT" in m[0]["text"]
          and "5,580" in m[0]["text"], m)
    urt.feed.last_at[CRUDE] = T[0]
    alerts.check()
    m = sent()
    check("prices back: 'sorted'", len(m) == 2 and "Sorted" in m[1]["text"] and "No prices" in m[1]["text"], m)

    # no Fyers login (live warning, not position-specific)
    reset()
    e.link.tok = None
    alerts.check()
    T[0] += 31
    urt.feed.last_at[CRUDE] = T[0]
    alerts.check()
    m = sent()
    check("no Fyers login: one message (not a second one for the stop)", len(m) == 1 and "No Fyers login" in m[0]["text"], m)
    e.link.tok = "tok"
    alerts.check()
    check("login back: sorted", len(sent()) == 2, sent())

    # switched off
    reset()
    tg_set(alerts={"warn": False})
    p["stop_err"] = "RMS: x"
    alerts.check()
    T[0] += 60
    urt.feed.last_at[CRUDE] = T[0]
    alerts.check()
    check("warnings switched off: nothing", sent() == [], sent())
    tg_set()
    alerts.check()                      # on again: a fresh 30 s starts
    check("switched on again: waits its 30 s", sent() == [], sent())
    p.pop("stop_err")
    alerts.check()

    # outside market hours
    reset()
    T[0] = MON8
    urt.feed.last_at[CRUDE] = MON8 - 600
    p["stop_err"] = "RMS: y"
    alerts.check()
    T[0] += 120
    alerts.check()
    check("before the market opens: no warning and no 'no prices'", sent() == [], sent())
    p.pop("stop_err")
    alerts.check()
    T[0] = MON11 + 3600
    urt.feed.last_at[CRUDE] = MON8 - 86400 * 3            # last prices on Friday: none yet today
    alerts.check()
    T[0] += 120
    alerts.check()
    check("no prices yet today (holiday / not started): not an outage", sent() == [], sent())

    # Telegram not ready / a failing chat
    telegram.save(UID, {"token": users.seal(TOKEN)})
    p["stop_err"] = "RMS: z"
    urt.feed.last_at[CRUDE] = T[0]
    alerts.check()
    T[0] += 40
    urt.feed.last_at[CRUDE] = T[0]
    alerts.check()
    check("no chat chosen: nothing sent", sent() == [], sent())
    tg_set(chat="400")
    alerts.check()
    T[0] += 40
    urt.feed.last_at[CRUDE] = T[0]
    alerts.check()
    st = store.load(f"u/{UID}/tg_helper.json")
    check("a refused message is recorded for Settings", "chat not found" in str(st.get("error")), st)
    check("public() never shows the token", TOKEN not in json.dumps(telegram.public(UID)) and telegram.public(UID)["token_set"], telegram.public(UID))
    p.pop("stop_err")
    tg_set()
    alerts.check()

    # flat: nothing listed
    e.positions.clear()
    e.orders.clear()
    alerts.heartbeat("test")
    check("flat: the heartbeat lists no live trades", store.load("watch.json").get("users") == {}, store.load("watch.json"))
    e.stop()


def watchdog_side():
    W = [MON11]
    probe = {"v": (True, "")}
    calls = []
    hb_live = {UID: {"name": "admin", "live": [{"name": "Live", "orders": 1, "orders_at_fyers": 1, "positions": [
        {"s": CRUDE, "short": "CRUDEOIL26NOVFUT", "side": 1, "lots": 1, "qty": 100, "avg": 5601, "sl": 5580, "tp": 5650,
         "stop_px": 5580, "stop_at_fyers": True}]}]}}

    def hb(t=None, live=hb_live):
        store.save("watch.json", {"t": W[0] if t is None else t, "pid": 1, "v": "t", "users": live})

    def http(url, method="GET", headers=None, timeout=10):
        calls.append((W[0], method, url, (headers or {}).get("X-Api-Key")))
        return 200

    w = watchdog.Watchdog(now=lambda: W[0], prober=lambda: probe["v"], http=http)
    tg_set()
    reset()
    hb()
    st = w.step()
    check("watchdog: helper up, nothing sent", st["up"] and sent() == [], (st, sent()))
    check("watchdog: writes its own status file", store.load("watchdog.json").get("up") is True)
    probe["v"] = (False, "the helper isn't running (crashed, or restarting)")
    for dt_ in (0, 10, 20):
        W[0] = MON11 + dt_
        w.step()
    check("down 20 s: nothing yet", sent() == [], sent())
    W[0] = MON11 + 30
    w.step()
    m = sent()
    check("down 30 s with a live trade: a message", len(m) == 1 and "isn't responding" in m[0]["text"], m)
    txt = m[0]["text"] if m else ""
    check("it names the trade and its stop at Fyers", "CRUDEOIL26NOVFUT" in txt and "BUY 1 lot @ 5,601" in txt and "stop at Fyers 5,580" in txt
          and "target 5,650" in txt, txt)
    check("it says why, and the waiting entry order", "isn't running" in txt and "1 entry order waiting at Fyers" in txt, txt)
    check("in market hours it rings (not silent)", m and m[0]["silent"] is False, m)
    for dt_ in (40, 300, 620):
        W[0] = MON11 + dt_
        w.step()
    check("no repeat before 10 min", len(sent()) == 1, len(sent()))
    W[0] = MON11 + 631
    w.step()
    check("a reminder after 10 min", len(sent()) == 2 and "Next reminder in 10 min" in sent()[1]["text"], sent()[-1:])
    probe["v"] = (True, "")
    W[0] += 10
    hb()
    w.step()
    m = sent()
    check("back: 'answering again' with the trades now", len(m) == 3 and "answering again" in m[2]["text"] and "down 10 m" in m[2]["text"]
          and "CRUDEOIL26NOVFUT" in m[2]["text"], m[-1:])
    w.step()
    check("only one 'back' message", len(sent()) == 3)

    # hung: answers the ping (say) but the heartbeat stopped
    reset()
    hb(t=W[0] - 31)
    st = w.step()
    check("heartbeat 31 s old: counted as down", st["up"] is False and "background work has stopped" in st["why"], st)
    W[0] += 30
    w.step()
    check("...and alerted after 30 s", len(sent()) == 1 and "background work has stopped" in sent()[0]["text"], sent())
    W[0] += 5
    hb()
    w.step()
    reset()

    # no live trade: down, but nothing sent
    hb(live={})
    probe["v"] = (False, "x")
    for _ in range(5):
        W[0] += 20
        w.step()
    check("down with no live trade: nothing sent", sent() == [], sent())
    probe["v"] = (True, "")
    hb(live={})
    w.step()
    check("...and no 'back' message either", sent() == [], sent())

    # no stop at Fyers; outside market hours (silent); repeat 0 = once; down alerts off
    live2 = json.loads(json.dumps(hb_live))
    live2[UID]["live"][0]["positions"][0].update(stop_at_fyers=False, stop_px=None)
    live2[UID]["live"][0]["orders_at_fyers"] = 0
    tg_set(alerts={"repeat_min": 0})
    W[0] = MON8
    hb(live=live2)
    probe["v"] = (False, "the helper doesn't answer (stuck or overloaded)")
    for _ in range(80):
        W[0] += 10
        w.step()
    m = sent()
    check("no stop at Fyers: the message says to protect it", len(m) == 1 and "no stop at Fyers" in m[0]["text"] and "protect it" in m[0]["text"], m)
    check("before the market opens: silent", m and m[0]["silent"] is True, m)
    check("repeat 0: once only (13 min down)", len(m) == 1, len(m))
    probe["v"] = (True, "")
    hb(live=live2)
    w.step()
    reset()
    tg_set(alerts={"down": False})
    probe["v"] = (False, "x")
    for _ in range(10):
        W[0] += 10
        w.step()
    check("server-down alerts off: nothing", sent() == [], sent())
    probe["v"] = (True, "")
    hb()
    w.step()

    # the outside heartbeat
    uuid = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b"
    check("hc_api: hc-ping.com -> healthchecks.io's API", watchdog.hc_api("https://hc-ping.com/" + uuid) == (os.environ["HC_API"], uuid))
    os.environ.pop("HC_API")
    check("hc_api: hc-ping.com (real)", watchdog.hc_api("https://hc-ping.com/" + uuid) == ("https://healthchecks.io", uuid))
    check("hc_api: self-hosted /ping/<uuid>", watchdog.hc_api("https://hc.example.org/ping/" + uuid) == ("https://hc.example.org", uuid))
    check("hc_api: a slug URL can't be paused", watchdog.hc_api("https://hc-ping.com/abcKEY/my-check") == (None, None))
    os.environ["HC_API"] = f"http://127.0.0.1:{TG_PORT}"
    users.create_first(users.setup_code(), "admin", "OldPass12345!x", "127.0.0.1") if not users.any_users() else None
    uid = users.all_users()[0]["uid"]
    s = {"token": users.seal(TOKEN), "chat": "5550001", "hc": {"url": "https://hc-ping.com/" + uuid, "key": users.seal("KEY123")}}
    telegram.save(uid, s)
    live_admin = {uid: hb_live[UID]}
    calls.clear()
    t0 = W[0]
    for i in range(7):                       # 3 minutes, live trade open
        W[0] = t0 + i * 30
        hb(live=live_admin)
        w.step()
    pings = [c for c in calls if c[1] == "GET"]
    check("live trade open: pinged every minute", len(pings) == 4 and all(c[2] == "https://hc-ping.com/" + uuid for c in pings), calls)
    calls.clear()
    for i in range(4):                       # flat
        W[0] += 30
        hb(live={})
        w.step()
    pause = [c for c in calls if c[1] == "POST"]
    check("flat with the API key: paused once, no pings", len(pause) == 1 and not [c for c in calls if c[1] == "GET"]
          and pause[0][2] == f"http://127.0.0.1:{TG_PORT}/api/v3/checks/{uuid}/pause" and pause[0][3] == "KEY123", calls)
    calls.clear()
    W[0] += 30
    hb(live=live_admin)
    w.step()
    check("a live trade again: pinging resumes at once (a ping un-pauses the check)", [c[1] for c in calls] == ["GET"], calls)
    s["hc"]["key"] = ""
    telegram.save(uid, s)
    calls.clear()
    for i in range(5):
        W[0] += 30
        hb(live={})
        w.step()
    check("no API key: pings even when flat", len([c for c in calls if c[1] == "GET"]) >= 2 and not [c for c in calls if c[1] == "POST"], calls)
    wd = store.load("watchdog.json")
    check("its status is saved for Settings", wd.get("hc", {}).get(uid, {}).get("mode") == "always", wd.get("hc"))
    telegram.save(uid, {})


class Ping(BaseHTTPRequestHandler):
    ok = True

    def log_message(self, *a):
        pass

    def do_GET(self):
        b = b'{"ok": true}' if Ping.ok else b'{"ok": false}'
        self.send_response(200 if Ping.ok else 500)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)


def watchdog_process():
    srv = ThreadingHTTPServer(("127.0.0.1", PING_PORT), Ping)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    s = {"token": users.seal(TOKEN), "bot": "@ftm_test_bot", "chat": "5550001", "alerts": {"down_sec": 2, "repeat_min": 0}}
    telegram.save(UID, s)
    live1 = {UID: {"name": "admin", "live": [{"name": "Live", "orders": 0, "orders_at_fyers": 0, "positions": [
        {"s": CRUDE, "short": "CRUDEOIL26NOVFUT", "side": -1, "lots": 2, "qty": 200, "avg": 5601, "stop_px": 5620, "stop_at_fyers": True}]}]}}
    stop = threading.Event()

    def beat():
        while not stop.is_set():
            store.save("watch.json", {"t": time.time(), "pid": 1, "users": live1})
            time.sleep(0.5)
    threading.Thread(target=beat, daemon=True).start()
    reset()
    env = dict(os.environ, WATCHDOG_URL=f"http://127.0.0.1:{PING_PORT}/api/ping", WATCHDOG_EVERY="0.5")
    proc = subprocess.Popen([sys.executable, "-m", "helper.watchdog"], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        time.sleep(2.5)
        wd = store.load("watchdog.json")
        check("process: the watchdog runs and writes its status", wd.get("pid") == proc.pid and wd.get("up") is True, wd)
        check("process: nothing sent while the helper answers", sent() == [], sent())
        Ping.ok = False
        time.sleep(4.5)
        m = sent()
        check("process: helper failing -> a Telegram message within seconds", len(m) == 1 and "isn't responding" in m[0]["text"]
              and "SELL 2 lots @ 5,601" in m[0]["text"] and "HTTP 500" in m[0]["text"], m)
        Ping.ok = True
        time.sleep(2.0)
        m = sent()
        check("process: helper back -> 'answering again'", len(m) == 2 and "answering again" in m[1]["text"], m)
        srv.shutdown()
        srv.server_close()
        reset()
        time.sleep(4.5)
        m = sent()
        check("process: helper gone (connection refused) -> 'isn't running'", len(m) == 1 and "isn't running" in m[0]["text"], m)
    finally:
        stop.set()
        proc.terminate()
        out = proc.communicate(timeout=5)[0].decode()
        if FAILS:
            print(out[-2000:])


def ping_route():
    from fastapi.testclient import TestClient
    from helper.app import app
    c = TestClient(app)
    r = c.get("/api/ping")
    check("/api/ping answers without a login, and says nothing else", r.status_code == 200 and r.json().get("ok") is True and set(r.json()) == {"ok", "t"}, r.text)
    check("/api/telegram needs a login", c.get("/api/telegram").status_code == 401)


asyncio.run(helper_side())
watchdog_side()
watchdog_process()
ping_route()
print(f"\n{'ALL PASS' if not FAILS else str(len(FAILS)) + ' FAILED: ' + ', '.join(FAILS)}")
sys.exit(1 if FAILS else 0)
