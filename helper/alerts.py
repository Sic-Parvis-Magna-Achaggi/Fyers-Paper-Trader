"""Telegram alerts from inside the helper, and the heartbeat the watchdog reads.

Every 5 s (app.py's engine loop):
- heartbeat(): writes watch.json = {t, pid, v, users: {uid: {name, live: [account with its positions / orders]}}}. Only
  Live accounts with a position or an order are listed. The watchdog (watchdog.py, a separate process) reads it: a
  stale file or no answer from /api/ping = the helper is down, and the last file says which live trades are open.
- check(): per user with Telegram set up, what stops the server looking after a live trade:
    "warn": a live warning (LiveEngine.live_problems(): no stop at Fyers, a refused stop change, no Fyers login, a
            check-Fyers alert) lasting warn_sec, while that contract's market is open;
    "feed": no prices for an open live position for feed_sec in its market hours (it had prices earlier today).
  Each sent once; "sorted" when it clears. The order-socket fallback warning and the kill switch (you pressed it)
  aren't sent."""
import datetime as dt
import logging
import os
import time

from . import rt, store, symbols, telegram

log = logging.getLogger("alerts")
HB = "watch.json"
WD = "watchdog.json"
SKIP = ("stream", "halted", "nosl_hold")      # (delivery holdings without a stop: shown on the page, no Telegram message)
_state: dict = {}                  # (uid, account id, key) -> {"since", "sent", "text", "kind"}
_now = time.time                   # tests swap these
_ist = lambda ts=None: dt.datetime.fromtimestamp(ts if ts is not None else _now(), telegram.IST)


# ---------------------------------------------------------------- the heartbeat
def watched(e) -> list:
    """The positions the watchdog looks after: every live trade, except delivery holdings with no stop (shares simply held
    in the demat, v0.33.0) - they'd make every restart look like an outage, and the outside heartbeat never pause."""
    return [p for p in e.positions if not (p.get("holding") and p.get("sl") is None and p.get("floor") is None)]


def acct_view(e) -> dict:
    pos = []
    for p in watched(e):
        lot = (symbols.get(p["s"]) or {}).get("lot") or 1
        pos.append({"s": p["s"], "short": e.short(p["s"]), "side": p["side"], "lots": p["qty"] // lot, "qty": p["qty"],
                    "avg": p.get("avg"), "sl": p.get("sl"), "tp": p.get("tp"), "stop_px": p.get("stop_px"),
                    "stop_at_fyers": bool(p.get("stop_oid") and p.get("stop_px") is not None), "exiting": bool(p.get("exiting"))})
    return {"name": e.name, "positions": pos, "orders": len(e.orders),
            "orders_at_fyers": len([o for o in e.orders if o.get("oid")])}


def live_now() -> dict:
    out = {}
    for urt in list(rt.RT.values()):
        accts = [acct_view(e) for e in urt.live_engines() if watched(e) or e.orders]
        if accts:
            out[urt.uid] = {"name": urt.label, "live": accts}
    return out


def heartbeat(version: str = "") -> None:
    store.save(HB, {"t": _now(), "pid": os.getpid(), "v": version, "users": live_now()})


def watchdog_status() -> dict:
    w = store.load(WD, {})
    age = _now() - w["t"] if w.get("t") else None
    return {"running": age is not None and age < 60, "age": round(age) if age is not None else None,
            "helper_up": w.get("up"), "hc": w.get("hc") or {}, "down_since": w.get("down_since")}


# ---------------------------------------------------------------- the checks
def problems(urt, e) -> list:
    """(key, text, kind) for one Live account, only for contracts whose market is open now."""
    t = _ist()
    out = []
    in_mkt = [x["s"] for x in list(e.positions) + list(e.orders) if telegram.market_open(x["s"], t)]
    for key, text, sym in e.live_problems():
        if key.split(":", 1)[0] in SKIP:
            continue
        if (sym and not telegram.market_open(sym, t)) or (not sym and not in_mkt):
            continue                                   # outside market hours nothing can be done (and it's normal)
        if key.startswith("nostop:") and key.endswith(("waiting for the market", "expired", "no login")):
            continue                                   # goes in by itself when it trades (no login: the login alert says it)
        out.append((key, text, "warn"))
    A = telegram.load(urt.uid)["alerts"]
    for p in watched(e):
        s = p["s"]
        last = urt.feed.last_at.get(s)
        if not last or not telegram.market_open(s, t) or _ist(last).date() != t.date():
            continue                                   # no prices yet today (a holiday, before the open): not an outage
        age = _now() - last
        if age >= A["feed_sec"]:
            where = f" The stop at Fyers ({telegram.num(p.get('stop_px'))}) is still in force." if p.get("stop_oid") else \
                " ⚠️ There's no stop at Fyers for it."
            out.append((f"feed:{s}", f"No prices for {e.short(s)} for {telegram.dur(age)} (last at {telegram.ist_hm(last)} IST): "
                        "the server can't trail, take the target or run its own stop check." + where, "feed"))
    return out


def check(loop=None) -> None:
    now = _now()
    seen = set()
    for urt in list(rt.RT.values()):
        s = telegram.load(urt.uid)
        if not telegram.ready(s):
            continue
        A = s["alerts"]
        for aid, e in list(urt.engines.items()):
            if getattr(e, "mode", "paper") != "live" or not (watched(e) or e.orders):
                continue
            for key, text, kind in problems(urt, e):
                if not A.get(kind):
                    continue
                k = (urt.uid, aid, key)
                seen.add(k)
                st = _state.setdefault(k, {"since": now, "sent": False, "text": text, "kind": kind, "acct": e.name})
                st["text"] = text if not st["sent"] else st["text"]
                wait = A["warn_sec"] if kind == "warn" else 0
                if not st["sent"] and now - st["since"] >= wait:
                    st["sent"] = True
                    _send(loop, urt.uid, f"⚠️ <b>Live account {telegram.esc(e.name)}</b>: {telegram.esc(text)}\n"
                                         f"<i>{telegram.ist_hm(now)} IST</i>{_link(s)}")
    for k in list(_state):
        if k not in seen:
            st = _state.pop(k)
            if st["sent"]:
                _send(loop, k[0], f"✅ Sorted (live account {telegram.esc(st['acct'])}): {telegram.esc(st['text'])}\n"
                                  f"<i>{telegram.ist_hm(now)} IST</i>")


def _link(s: dict) -> str:
    return f"\n{telegram.esc(s['link'])}" if s.get("link") else ""


def _send(loop, uid: str, text: str):
    if loop:
        loop.run_in_executor(None, telegram.send_user, uid, text)
    else:
        telegram.send_user(uid, text)


def tick(version: str, loop=None) -> None:
    try:
        heartbeat(version)
    except Exception as e:
        log.warning("heartbeat: %s", e)
    try:
        check(loop)
    except Exception as e:
        log.exception("alerts: %s", e)
