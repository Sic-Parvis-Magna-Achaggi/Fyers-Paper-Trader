"""Fyers trade manager helper: users with 2FA, each with their own Fyers login, price feed, Pine scripts and paper
accounts; charts, Pine Script, paper trading net of every charge.

Run: uvicorn helper.app:app --host 127.0.0.1 --port 8000   (Caddy serves it over HTTPS)
"""
import asyncio
import copy
import json
import os
import logging
import re
import subprocess
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response

from fastapi.staticfiles import StaticFiles

from . import alerts, charges, charges_watch, chartalerts, fyers_link, journal, jreplay, jshots, logbuf, mt5, mt5acct, news, rt, store, symbols, telegram, users, webpush
from .feedcheck import FC
from . import candles as candles_store
from .paper import Refused

logbuf.setup()
log = logging.getLogger("helper")
symbols.EXTRA = lambda t: mt5.row(None, t)          # MT5:... symbols come from the MT5 bridge (roadmap 8)
ROOT = Path(__file__).resolve().parent.parent
VERSION = (ROOT / "VERSION").read_text().strip() if (ROOT / "VERSION").exists() else "dev"
try:
    COMMIT = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"],
                            capture_output=True, text=True, timeout=5).stdout.strip()
except Exception:
    COMMIT = ""
STARTED = time.time()

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/vendor", StaticFiles(directory=ROOT / "web" / "vendor"), name="vendor")
app.mount("/static", StaticFiles(directory=ROOT / "web"), name="static")


_push: dict = {}               # (uid, account) -> {"pending": bool, "events": [...]}


def _engine_changed(urt, aid, event):
    """An account changed: send its pages a fresh snapshot (coalesced), plus the event line if there is one."""
    k = (urt.uid, aid)
    p = _push.setdefault(k, {"pending": False, "events": []})
    if event:
        p["events"].append(event)
    if p["pending"]:
        return
    p["pending"] = True
    asyncio.get_running_loop().call_later(0.15, _send_snapshot, urt, aid)


def _send_snapshot(urt, aid):
    p = _push.get((urt.uid, aid)) or {"events": []}
    p["pending"] = False
    ev, p["events"] = p["events"], []
    e = urt.engines.get(aid)
    if not e:
        return
    try:
        urt.feed.broadcast({"paper": e.snapshot(), "acct": aid, "events": ev}, acct=aid)
    except Exception as ex:
        log.exception("snapshot failed: %s", ex)


async def _engine_loop():
    n = 0
    while True:
        await asyncio.sleep(5)
        for urt in list(rt.RT.values()):
            urt.housekeeping()
        alerts.tick(VERSION, asyncio.get_running_loop())   # the watchdog's heartbeat, and Telegram alerts for live trades
        if any(any(getattr(e, "mode", "") == "mt5" for e in r.engines.values()) for r in rt.RT.values()):
            news.tick(asyncio.get_running_loop())             # ForexFactory's calendar for the MT5 news guard (hourly)
        n += 1
        if FC.buf:                                         # the order-flow check's snapshots, written every few seconds
            asyncio.get_running_loop().run_in_executor(None, FC.flush)
        if n % 120 == 1 and charges_watch.due():          # every 10 minutes: is the daily charges check due?
            asyncio.get_running_loop().run_in_executor(None, _charges_check)


def _charges_check():
    try:
        before = charges_watch.status().get("changed")
        st = charges_watch.check()
        if st.get("changed") and not before:
            for urt in list(rt.RT.values()):
                if urt.feed.loop:
                    urt.feed.loop.call_soon_threadsafe(urt.feed.broadcast, {"charges": st})
    except Exception as e:
        log.warning("charges check: %s", e)


_jpush: dict = {}              # uid -> a "journal changed" note is on its way


def _journal_changed(uid):
    """The journal of a user changed (a trade arrived or closed): tell their pages, at most every half second."""
    urt = rt.RT.get(uid)
    loop = urt and urt.feed.loop
    if not loop or _jpush.get(uid):
        return

    def send():
        _jpush[uid] = False
        try:
            urt.feed.broadcast({"journal": 1})
        except Exception as ex:
            log.warning("journal push: %s", ex)
    _jpush[uid] = True
    loop.call_soon_threadsafe(lambda: loop.call_later(0.5, send))


@app.on_event("shutdown")
def _shutdown():
    FC.flush()


@app.on_event("startup")
async def _startup():
    from concurrent.futures import ThreadPoolExecutor
    loop = asyncio.get_running_loop()
    loop.set_default_executor(ThreadPoolExecutor(max_workers=24))   # room for queued Fyers calls
    uid = users.migrate_legacy()                                    # the old single password -> user "admin"
    if uid:
        rt.migrate(uid)
    elif users.any_users() and store.path("paper.json").exists():   # files left at the top from an earlier version
        rt.migrate(next(u["uid"] for u in users.all_users() if u["role"] == "admin"))
    rt.on_engine_change = _engine_changed
    journal.on_change = _journal_changed
    rt.start(loop)
    jshots.startup([u["uid"] for u in users.all_users() if not u["disabled"]])   # Telegram copies left over
    loop.create_task(_engine_loop())
    if not users.any_users():
        code = users.setup_code()
        store.path("SETUP_CODE.txt").write_text(code + "\n")
        log.warning("First run: setup code is in %s", store.path("SETUP_CODE.txt"))
    loop.run_in_executor(None, symbols.refresh)
    log.info("Helper %s (%s) started, %d user(s)", VERSION, COMMIT or "no git", len(rt.RT))


# ------------------------------------------------------------------ helpers
PENDING = "fh_pending"


def _ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for") or request.client.host).split(",")[0].strip()


def _tok(request: Request) -> str:
    return request.cookies.get(users.COOKIE) or ""


def _user(request: Request) -> dict:
    u = users.check(_tok(request))
    if not u:
        raise HTTPException(401, "log in first")
    return u


def _need(request: Request) -> dict:
    return _user(request)


def _urt(request: Request):
    u = _user(request)
    return u, rt.get(u["uid"])


def _eng(request: Request, b: dict | None = None, write: bool = False):
    """The account this request is about: the X-Acct header (the page's account switcher, or the Live account on the Live
    side). Changing anything on the Live account needs this login on the Live side (the switch at the top left); reading
    it doesn't, and the kill switch never does."""
    u, r = _urt(request)
    aid = request.headers.get("x-acct") or (b or {}).get("acct") or request.query_params.get("acct")
    e = r.engine(aid)
    if write and getattr(e, "mode", "paper") == "live" and users.session_side(_tok(request)) != "live":
        raise HTTPException(403, "this page is on Paper - switch to Live (top left) to trade on your Fyers account")
    if write and getattr(e, "mode", "paper") == "mt5" and users.session_side(_tok(request)) != "mt5":
        raise HTTPException(403, "this page isn't on MT5 - switch to MT5 (top left) to manage your MT5 accounts")
    return e


def _admin(request: Request) -> dict:
    u = _user(request)
    if u["role"] != "admin":
        raise HTTPException(403, "admin only")
    return u


def _stepped(request: Request):
    """Sensitive actions need a fresh 2FA code (the page asks for it and retries)."""
    if not users.stepped_up(_tok(request)):
        raise HTTPException(428, "confirm with your 2FA code")


def _same_origin(request: Request):
    """Refuse state-changing calls that come from another site."""
    origin = request.headers.get("origin")
    if origin and origin.split("://", 1)[-1] != request.headers.get("host"):
        raise HTTPException(403, "wrong origin")


def _with_cookie(resp: JSONResponse, token: str) -> JSONResponse:
    resp.set_cookie(users.COOKIE, token, max_age=users.SESSION_DAYS * 86400, httponly=True,
                    secure=True, samesite="lax", path="/")
    resp.delete_cookie(PENDING, path="/")
    return resp


def _with_pending(resp: JSONResponse, token: str) -> JSONResponse:
    resp.set_cookie(PENDING, token, max_age=users.PENDING_SEC, httponly=True, secure=True, samesite="strict", path="/")
    return resp


def _redirect_uri(request: Request) -> str:
    return f"https://{request.headers.get('host')}/fyers/callback"


async def _body(request: Request) -> dict:
    try:
        return await request.json()
    except Exception:
        return {}


def _err(e, code: int = 400):
    return JSONResponse({"ok": False, "error": str(e)}, status_code=code)


# ------------------------------------------------------------------ page
@app.get("/", response_class=HTMLResponse)
def index():
    html = (ROOT / "web" / "index.html").read_text(encoding="utf-8").replace("__V__", f"{VERSION}-{COMMIT}")
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


@app.get("/api/state")
def state(request: Request):
    u = users.check(_tok(request))
    out = {"setup_done": users.any_users(), "session": bool(u), "version": VERSION, "commit": COMMIT,
           "uptime": int(time.time() - STARTED)}
    if u:
        r = rt.get(u["uid"])
        out["user"] = u
        out["fyers"] = r.link.status()
        out["fyers_settings"] = r.link.public_settings()
        out["redirect_uri"] = _redirect_uri(request)
        out["feed"] = r.feed.status()
        out["accounts"] = r.account_list()
        out["server"] = {"out_ip": _out_ip()}
        out["side"] = u.get("side", "paper")
        lr = r.live_row() if u.get("role") == "admin" else None
        out["live"] = {"id": rt.LIVE_ID, "name": lr.get("name"), "client_id": lr.get("client_id")} if lr else None
    return out


def _out_ip() -> str:
    """The IP Fyers sees this server's orders come from (FYERS_OUT_IP in /etc/fyers/server.conf, set by install.sh)."""
    ip = os.environ.get("FYERS_OUT_IP", "").strip()
    return ip if re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", ip) else ""


# ------------------------------------------------------------------ login: password, then a 2FA code
@app.post("/api/setup")
async def setup(request: Request):
    """First run: the setup code from the server's console, the admin's username and password. 2FA comes next."""
    _same_origin(request)
    b = await _body(request)
    try:
        ptok = users.create_first(b.get("code", ""), b.get("username", ""), b.get("password", ""), _ip(request))
    except ValueError as e:
        return _err(e)
    store.path("SETUP_CODE.txt").unlink(missing_ok=True)
    log.info("First user created - 2FA set-up next")
    return _with_pending(JSONResponse({"ok": True, "stage": "setup_2fa"}), ptok)


@app.post("/api/login")
async def login(request: Request):
    _same_origin(request)
    b = await _body(request)
    if "username" not in b:            # a page loaded before v0.13 (single password) is still open
        return _err("This page is out of date: reload it (Ctrl+Shift+R). Login now needs your username too.", 400)
    try:
        ptok, stage = users.login(b.get("username", ""), b.get("password", ""), _ip(request))
    except ValueError as e:
        log.warning("Login refused (%s): %s", _ip(request), e)
        return _err(e, 401)
    return _with_pending(JSONResponse({"ok": True, "stage": stage}), ptok)


@app.post("/api/login/code")
async def login_code(request: Request):
    _same_origin(request)
    b = await _body(request)
    try:
        tok = users.login_code(request.cookies.get(PENDING, ""), b.get("code", ""), _ip(request))
    except ValueError as e:
        return _err(e, 401)
    users.set_ua(tok, request.headers.get("user-agent", ""))
    return _with_cookie(JSONResponse({"ok": True}), tok)


@app.post("/api/login/password")
async def login_password(request: Request):
    """A temporary password from the admin must be replaced before anything else."""
    _same_origin(request)
    b = await _body(request)
    try:
        ptok, stage = users.change_password_pending(request.cookies.get(PENDING, ""), b.get("new", ""), _ip(request))
    except ValueError as e:
        return _err(e)
    return _with_pending(JSONResponse({"ok": True, "stage": stage}), ptok)


@app.post("/api/login/2fa/begin")
async def login_2fa_begin(request: Request):
    _same_origin(request)
    try:
        return {"ok": True, **users.setup_2fa_begin(request.cookies.get(PENDING, ""))}
    except ValueError as e:
        return _err(e, 401)


@app.post("/api/login/2fa/finish")
async def login_2fa_finish(request: Request):
    _same_origin(request)
    b = await _body(request)
    try:
        r = users.setup_2fa_finish(request.cookies.get(PENDING, ""), b.get("code", ""), _ip(request))
    except ValueError as e:
        return _err(e)
    users.set_ua(r["session"], request.headers.get("user-agent", ""))
    u = users.check(r["session"])
    if u:
        rt.get(u["uid"])
    return _with_cookie(JSONResponse({"ok": True, "recovery": r["recovery"]}), r["session"])


@app.post("/api/logout")
async def logout(request: Request):
    _same_origin(request)
    users.logout(_tok(request))
    r = JSONResponse({"ok": True})
    r.delete_cookie(users.COOKIE, path="/")
    return r


# ------------------------------------------------------------------ your security settings
@app.get("/api/security")
def security(request: Request):
    u = _user(request)
    return {"ok": True, "user": u, "sessions": users.sessions(u["uid"], _tok(request)), "audit": users.read_audit(u["uid"], 100)}


@app.post("/api/security/confirm")
async def security_confirm(request: Request):
    """Step-up: a fresh 2FA code allows sensitive actions for 5 minutes."""
    _same_origin(request)
    _user(request)
    b = await _body(request)
    try:
        users.step_up(_tok(request), b.get("code", ""), _ip(request))
    except ValueError as e:
        return _err(e, 401)
    return {"ok": True}


@app.post("/api/security/password")
async def security_password(request: Request):
    _same_origin(request)
    u = _user(request)
    b = await _body(request)
    try:
        users.change_password(u["uid"], b.get("old", ""), b.get("new", ""), _tok(request), _ip(request))
    except ValueError as e:
        return _err(e)
    return {"ok": True}


@app.post("/api/password")
async def password_old(request: Request):
    """The pre-0.13 address for changing your password (kept so nothing that used it breaks)."""
    return await security_password(request)


@app.post("/api/security/recovery")
async def security_recovery(request: Request):
    _same_origin(request)
    u = _user(request)
    _stepped(request)
    return {"ok": True, "recovery": users.new_recovery_codes(u["uid"], _ip(request))}


@app.post("/api/security/2fa/begin")
async def security_2fa_begin(request: Request):
    """Move 2FA to a new phone (needs a code from the current one first)."""
    _same_origin(request)
    _user(request)
    _stepped(request)
    return {"ok": True, **users.setup_2fa_begin(_tok(request), session=True)}


@app.post("/api/security/2fa/finish")
async def security_2fa_finish(request: Request):
    _same_origin(request)
    _user(request)
    _stepped(request)
    b = await _body(request)
    try:
        return {"ok": True, **users.setup_2fa_finish(_tok(request), b.get("code", ""), _ip(request), session=True)}
    except ValueError as e:
        return _err(e)


@app.post("/api/security/logout_all")
async def security_logout_all(request: Request):
    _same_origin(request)
    u = _user(request)
    n = users.logout_all(u["uid"], keep=_tok(request))
    users.audit(u["uid"], "logged out everywhere", f"{n} other session(s)", _ip(request))
    return {"ok": True, "ended": n}


@app.post("/api/security/end_session")
async def security_end_session(request: Request):
    _same_origin(request)
    u = _user(request)
    b = await _body(request)
    users.end_session(u["uid"], str(b.get("id") or "")[:12])
    users.audit(u["uid"], "session ended", str(b.get("id") or "")[:12], _ip(request))
    return {"ok": True}


@app.post("/api/security/name")
async def security_name(request: Request):
    _same_origin(request)
    u = _user(request)
    b = await _body(request)
    users.rename(u["uid"], b.get("name", ""))
    return {"ok": True}


# ------------------------------------------------------------------ admin: users
@app.get("/api/admin/users")
def admin_users(request: Request):
    _admin(request)
    return {"ok": True, "users": users.all_users(), "audit": users.read_audit(None, 300)}


@app.post("/api/admin/users/create")
async def admin_create(request: Request):
    _same_origin(request)
    u = _admin(request)
    _stepped(request)
    b = await _body(request)
    try:
        nu = users.create_user(b.get("username", ""), b.get("password", ""), b.get("name", ""), u["uid"], _ip(request))
    except ValueError as e:
        return _err(e)
    rt.get(nu["uid"])
    return {"ok": True, "user": nu}


@app.post("/api/admin/users/set")
async def admin_set(request: Request):
    _same_origin(request)
    u = _admin(request)
    _stepped(request)
    b = await _body(request)
    try:
        nu = users.admin_set(str(b.get("uid") or ""), u["uid"], _ip(request), disabled=b.get("disabled"),
                             reset_2fa=bool(b.get("reset_2fa")), temp_password=b.get("password") or None)
    except ValueError as e:
        return _err(e)
    if nu["disabled"]:
        rt.drop(nu["uid"])
    else:
        rt.get(nu["uid"])
    return {"ok": True, "user": nu}


# ------------------------------------------------------------------ paper accounts
@app.get("/api/accounts")
def accounts(request: Request):
    u, r = _urt(request)
    return {"ok": True, "accounts": r.account_list()}


@app.post("/api/accounts/create")
async def accounts_create(request: Request):
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    try:
        a = r.create_account(b.get("name", ""), float(b.get("capital") or 0), b.get("copy_from") or None)
    except Refused as e:
        return _err(e)
    except (TypeError, ValueError):
        return _err("enter the capital in rupees")
    return {"ok": True, "account": a, "accounts": r.account_list()}


@app.post("/api/accounts/update")
async def accounts_update(request: Request):
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    try:
        r.update_account(str(b.get("id") or ""), name=b.get("name"), archived=b.get("archived"))
    except Refused as e:
        return _err(e)
    return {"ok": True, "accounts": r.account_list()}


@app.post("/api/accounts/mode")
async def accounts_mode(request: Request):
    """Before v0.33.0: a paper account switched to Live. Paper accounts have no Live option any more (roadmap 16); the
    route stays so an old page gets a clear answer."""
    _same_origin(request)
    u, r = _urt(request)
    try:
        r.set_mode("", "live")
    except Refused as e:
        return _err(e)
    return _err("no change")


@app.post("/api/side")
async def side_switch(request: Request):
    """The Paper / Live switch at the top left (roadmap 16, v0.33.0). Live: the admin only, Fyers logged in today, the
    Fyers client ID typed to confirm, and a fresh 2FA code; the Live account (the Fyers account itself) is made the first
    time. Back to Paper: one click. Per login (each browser / phone confirms for itself). It only decides where this
    login's new orders go: the server manages Live trades whichever side the page is on."""
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    side = str(b.get("side") or "")
    if side not in ("paper", "live", "mt5"):
        return _err("side: paper, live or mt5")
    if side == "mt5":                                  # MT5 accounts (roadmap 8 b1): the admin, with a fresh 2FA code
        if u["role"] != "admin":
            return _err("MT5 accounts are for the admin only", 403)
        _stepped(request)
    if side == "live":
        if u["role"] != "admin":
            return _err("Live trading is for the admin only (SEBI / Fyers static-IP rules)", 403)
        st = await asyncio.get_running_loop().run_in_executor(None, r.link.status)
        if not st.get("logged_in") or not st.get("client_id"):
            return _err("log in to Fyers first (today's login), so the app can read your client ID")
        if str(b.get("confirm") or "").strip().upper() != str(st["client_id"]).upper():
            return _err(f"type your Fyers client ID ({st['client_id']}) exactly to confirm")
        _stepped(request)
        try:
            r.ensure_live(st["client_id"])
        except Refused as e:
            return _err(e)
        e = r.live_engine()
        if e is not None and not e._F():                   # its real balance before the page shows it
            try:
                raw = await asyncio.get_running_loop().run_in_executor(None, e.broker.funds)
                e._apply_funds(raw)
                e.save()
            except Exception as ex:
                log.warning("Fyers funds on switching to Live: %s", ex)
    try:
        users.set_side(_tok(request), side)
    except ValueError as e:
        return _err(e, 401)
    users.audit(u["uid"], f"page side: {side.upper()}", "", _ip(request))
    if side in ("live", "mt5"):
        log.warning("%s switched a page to %s", u["username"], side.upper())
    sess = (users.check(_tok(request)) or {}).get("session")
    for c in list(r.feed.clients):                     # this login's other pages (tabs, grid charts) follow
        if sess and getattr(c, "sess", None) == sess:
            r.feed._offer(c, {"side": side})
    lr = r.live_row()
    return {"ok": True, "side": side, "accounts": r.account_list(),
            "live": {"id": rt.LIVE_ID, "name": lr.get("name"), "client_id": lr.get("client_id")} if lr else None}


# ------------------------------------------------------------------ live accounts (real orders at Fyers)
def _live(request: Request, b: dict | None = None, write: bool = False):
    """The Live account (the admin's Fyers account), whichever account the page shows."""
    u, r = _urt(request)
    e = r.live_engine()
    if e is None:
        raise HTTPException(400, "there's no Live account (switch to Live at the top left first)")
    if write and users.session_side(_tok(request)) != "live":
        raise HTTPException(403, "this page is on Paper - switch to Live (top left) first")
    return e


@app.get("/api/live/status")
async def live_status(request: Request, funds: int = 0):
    e = _live(request)
    out = {"ok": True, "live": e.live_status()}
    if funds:                                          # read Fyers' funds now (they're also read every minute)
        try:
            raw = await asyncio.get_running_loop().run_in_executor(None, e.broker.funds)
            e._apply_funds(raw)
            e.save()
        except Exception as ex:
            out["funds_error"] = str(ex)
        out["funds"] = e.funds_view()
    return out


@app.post("/api/live/kill")
async def live_kill(request: Request):
    """Kill switch: cancel every order and close every position at Fyers (no 2FA: it must be quick)."""
    _same_origin(request)
    u = _user(request)
    b = await _body(request)
    e = _live(request, b)
    e.kill()
    users.audit(u["uid"], "KILL SWITCH", e.name, _ip(request))
    return _ok(e)


@app.post("/api/live/resume")
async def live_resume(request: Request):
    _same_origin(request)
    u = _user(request)
    b = await _body(request)
    e = _live(request, b, write=True)
    _stepped(request)                     # turning trading back on after the kill switch needs a fresh 2FA code
    e.resume()
    users.audit(u["uid"], "live trading resumed", e.name, _ip(request))
    return _ok(e)


@app.post("/api/live/resync")
async def live_resync(request: Request):
    _same_origin(request)
    b = await _body(request)
    e = _live(request, b)
    e.resync()
    return _ok(e)


# ------------------------------------------------------------------ MT5 accounts (roadmap 8 b1: managed through the EA)
def _mt5e(request: Request, b: dict | None = None):
    e = _eng(request, b, write=True)
    if getattr(e, "mode", "") != "mt5":
        raise HTTPException(400, "not an MT5 account")
    return e


@app.post("/api/mt5acct/confirm")
async def mt5acct_confirm(request: Request):
    """The first change on an MT5 account: its login typed once (the 2FA code was asked when the page went to MT5)."""
    _same_origin(request)
    u = _user(request)
    b = await _body(request)
    e = _mt5e(request, b)
    try:
        e.confirm(b.get("login"))
    except Refused as ex:
        return _err(ex)
    users.audit(u["uid"], "MT5 account confirmed", str(e.login), _ip(request))
    return _ok(e)


@app.post("/api/mt5acct/kill")
async def mt5acct_kill(request: Request):
    """The MT5 kill switch: close every position and cancel every order of this MT5 account at the broker, then pause new
    orders until Resume. No 2FA, no login typed, no news window: it must be quick."""
    _same_origin(request)
    u = _user(request)
    b = await _body(request)
    e = _mt5e(request, b)
    if e.none:
        return _err("no MT5 account yet")
    users.audit(u["uid"], "MT5 KILL SWITCH", str(e.login), _ip(request))
    try:
        e.kill()
    except Refused as ex:
        return JSONResponse({"ok": False, "error": str(ex), "paper": e.snapshot()}, status_code=400)
    return _ok(e)


@app.post("/api/mt5acct/resume")
async def mt5acct_resume(request: Request):
    _same_origin(request)
    u = _user(request)
    b = await _body(request)
    e = _mt5e(request, b)
    _stepped(request)                                  # (orders back on after the kill switch: a fresh 2FA code)
    e.resume()
    users.audit(u["uid"], "MT5 trading resumed", str(e.login), _ip(request))
    return _ok(e)


@app.post("/api/mt5acct/news")
async def mt5acct_news(request: Request):
    """Read ForexFactory's calendar now (it's read every hour)."""
    _same_origin(request)
    _user(request)
    st = await asyncio.get_running_loop().run_in_executor(None, news.refresh, True)
    return {"ok": not st.get("err"), "news": st, "error": st.get("err")}


@app.post("/api/mt5acct/resync")
async def mt5acct_resync(request: Request):
    """Ask the EA for MT5's deals again (90 days); anything already in the history is skipped."""
    _same_origin(request)
    b = await _body(request)
    e = _mt5e(request, b)
    if e.none:
        return _err("no MT5 account yet")
    e.resync()
    return _ok(e)


# ------------------------------------------------------------------ Fyers (each user's own app and daily login)
@app.post("/api/fyers/settings")
async def fyers_settings(request: Request):
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    try:
        r.link.save_settings(b.get("app_id", ""), b.get("secret", ""), _redirect_uri(request))
    except ValueError as e:
        return _err(e)
    users.audit(u["uid"], "fyers app saved", b.get("app_id", "")[:30], _ip(request))
    return {"ok": True}


@app.get("/api/fyers/login")
def fyers_login(request: Request):
    u, r = _urt(request)
    try:
        return {"ok": True, "url": r.link.login_url(_redirect_uri(request), fyers_link.new_state())}
    except ValueError as e:
        return _err(e)


@app.get("/fyers/callback")
def fyers_callback(request: Request):
    """Fyers sends the browser back here after its login: the session cookie says whose login it is."""
    q = request.query_params
    code = q.get("auth_code") or q.get("code") or ""
    try:
        u = users.check(_tok(request))
        if not u:
            raise ValueError("log in to this app first, then log in to Fyers")
        r = rt.get(u["uid"])
        if q.get("s") == "error" or not code:
            raise ValueError(q.get("message") or "Fyers didn't send a login code")
        r.link.handle_callback(code, q.get("state", ""))
        users.audit(u["uid"], "fyers login", "", _ip(request))
    except Exception as e:
        log.warning("Fyers login failed: %s", e)
        return RedirectResponse("/?fyers=error&msg=" + str(e)[:200].replace(" ", "+"), status_code=303)
    r.feed._resync()
    return RedirectResponse("/?fyers=ok", status_code=303)


# ------------------------------------------------------------------ market data
@app.get("/api/symbols")
def find_symbols(request: Request, q: str = "", kind: str = "", ex: str = ""):
    _need(request)
    if len(q.strip()) < 2:
        return {"ok": True, "rows": []}
    u = _user(request)
    mt = [] if kind and kind != "CFD" or ex and ex != "MT5" else mt5.search(u["uid"], q)
    if ex == "MT5" or kind == "CFD":
        return {"ok": True, "rows": mt}
    fy = symbols.search(q, kind, ex=ex)
    return {"ok": True, "rows": (mt[:10] + fy)[:50] if mt else fy}


@app.get("/api/symbol")
def one_symbol(request: Request, s: str):
    u = _need(request)
    r = mt5.row(u["uid"], s) if s.startswith(mt5.PREFIX) else symbols.get(s)
    return {"ok": bool(r), "row": r}


@app.get("/api/chain")
def option_chain(request: Request, u: str, exp: int = 0, ex: str = ""):
    """u: an underlying name (NIFTY, CRUDEOIL), or an index / stock / contract ticker (NSE:NIFTY50-INDEX)."""
    _need(request)
    name, x = symbols.resolve_underlying(u)
    ex = ex or x
    exps = symbols.expiries(name, ex)
    if not exp and exps:
        exp = exps[0]
    rows = symbols.chain(name, exp, ex)
    sp = symbols.spot(name, rows[0]["x"] if rows else ex)
    fut = symbols.underlying_future(rows[0]) if rows else None
    return {"ok": True, "u": name, "ex": rows[0]["x"] if rows else ex, "expiries": exps, "exp": exp, "rows": rows,
            "spot": sp["s"] if sp else None, "fut": fut["s"] if fut else None}


_hist_inflight: dict = {}


@app.get("/api/history")
async def history(request: Request, symbol: str, res: str = "5", days: int = 5, since: int = 0, until: int = 0):
    """Candles from the saved store (helper/candles.py): Fyers is asked only for what's new (at most every 45 s)
    or for older days not saved yet. since: only candles from that time (the page's own saved copy has the rest).
    until: only candles before that time (the chart loading older candles as you scroll left).
    Identical requests that arrive together share one call."""
    u, r = _urt(request)
    if res not in fyers_link.RES:
        return _err("bad resolution")
    if symbol.startswith(mt5.PREFIX):                  # from the MT5 bridge (roadmap 8)
        try:
            rows = await mt5.history(u["uid"], r.dir, symbol, res, days)
        except mt5.Offline as e:
            return _err(e, 409)
        except Exception as e:
            log.warning("MT5 history %s %s failed: %s", symbol, res, e)
            return _err(e, 502)
        rows = [x for x in rows if (not since or x[0] >= since) and (not until or x[0] < until)]
        return {"ok": True, "candles": rows}
    key = (u["uid"], symbol, res, days)
    fut = _hist_inflight.get(key)
    if fut is None:
        fut = asyncio.get_running_loop().run_in_executor(None, candles_store.get, r.link, symbol, res, days)
        _hist_inflight[key] = fut
    try:
        rows = await asyncio.shield(fut)
    except PermissionError as e:
        return _err(e, 409)
    except Exception as e:
        log.warning("History %s %s failed: %s", symbol, res, e)
        return _err(e, 502)
    finally:
        _hist_inflight.pop(key, None)
    if since:
        rows = [r for r in rows if r[0] >= since]
    if until:
        rows = [r for r in rows if r[0] < until]
    return {"ok": True, "candles": rows}


@app.get("/api/prefs")
async def get_prefs(request: Request):
    u, r = _urt(request)
    return {"ok": True, "prefs": store.load(r.dir + "prefs.json")}


@app.post("/api/prefs")
async def set_prefs(request: Request):
    """Page preferences (watchlist, timeframes, last chart, theme, chart colours, default stop distances...):
    merged, so every device and every login gets the same set-up."""
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    if not isinstance(b, dict) or len(json.dumps(b)) > 100_000:
        return _err("bad preferences")
    p = store.load(r.dir + "prefs.json")
    p.update(b)
    store.save(r.dir + "prefs.json", p)
    return {"ok": True}


# ------------------------------------------------------------------ Pine Script library
# Each user's scripts, saved on the server by name (u/<user>/scripts.json), so every device sees the same list.
SCRIPT_MAX = 200_000          # characters per script
SCRIPTS_MAX = 200


def _scripts(r) -> list:
    s = store.load(r.dir + "scripts.json", {"scripts": []})
    return s.get("scripts", []) if isinstance(s, dict) else []


@app.get("/api/scripts")
async def scripts_list(request: Request):
    u, r = _urt(request)
    return {"ok": True, "scripts": _scripts(r)}


@app.post("/api/scripts/save")
async def scripts_save(request: Request):
    """{id?, name, source}: a new script when id is missing (or unknown), otherwise an update."""
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    name = str(b.get("name") or "").strip()[:80]
    src = b.get("source")
    if not name or not isinstance(src, str):
        return _err("a script needs a name and some code")
    if len(src) > SCRIPT_MAX:
        return _err(f"script too long (over {SCRIPT_MAX:,} characters)")
    lst = _scripts(r)
    sid = str(b.get("id") or "")
    if any(x["name"].lower() == name.lower() and x["id"] != sid for x in lst):
        return _err(f'you already have a script called "{name}"')
    now = int(time.time())
    hit = next((x for x in lst if x["id"] == sid), None) if sid else None
    if hit:
        hit.update(name=name, source=src, updated=now)
    else:
        if len(lst) >= SCRIPTS_MAX:
            return _err(f"script library full ({SCRIPTS_MAX})")
        import secrets
        hit = {"id": secrets.token_hex(5), "name": name, "source": src, "created": now, "updated": now}
        lst.append(hit)
    store.save(r.dir + "scripts.json", {"scripts": lst})
    return {"ok": True, "script": hit, "scripts": lst}


@app.post("/api/scripts/delete")
async def scripts_delete(request: Request):
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    lst = [x for x in _scripts(r) if x["id"] != str(b.get("id") or "")]
    store.save(r.dir + "scripts.json", {"scripts": lst})
    return {"ok": True, "scripts": lst}


# ------------------------------------------------------------------ chart drawings (v0.22.0)
# Each user's drawings, one file per contract (u/<user>/drawings/<contract>.json), so every device and every chart
# type / timeframe shows the same ones. The page sends the whole list for a contract each time it changes.
DRAW_MAX = 500                # drawings per contract
DRAW_BYTES = 400_000          # JSON size per contract (a brush stroke keeps at most 600 points)


def _draw_file(r, s: str) -> str:
    return jreplay.draw_file(r.dir, s)          # (the replay keeps a copy of the same file at entry / exit)


@app.get("/api/drawings")
async def drawings_get(request: Request):
    u, r = _urt(request)
    s = str(request.query_params.get("s") or "")[:120]
    if not s:
        return _err("which contract?")
    d = store.load(_draw_file(r, s), {"s": s, "items": []})
    return {"ok": True, "s": s, "items": d.get("items", []) if isinstance(d, dict) else [], "updated": d.get("updated", 0)}


@app.post("/api/drawings")
async def drawings_save(request: Request):
    """{s, items}: the contract's whole list of drawings (replaces what was saved)."""
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    s = str(b.get("s") or "")[:120]
    items = b.get("items")
    if not s or not isinstance(items, list):
        return _err("bad drawings")
    if len(items) > DRAW_MAX:
        return _err(f"too many drawings on one contract (over {DRAW_MAX})")
    if any(not isinstance(x, dict) for x in items) or len(json.dumps(items)) > DRAW_BYTES:
        return _err("drawings too large")
    now = int(time.time())
    store.save(_draw_file(r, s), {"s": s, "items": items, "updated": now})
    chartalerts.book(r).drawings_changed(s)          # an alert on a drawing follows it (v0.38.0)
    return {"ok": True, "updated": now}


# ------------------------------------------------------------------ chart layouts (v0.23.0)
# Each user's saved layouts (u/<user>/layouts.json): {layouts: [{id, name, charts: [{...chart set-up}], grid, updated}],
# active}. Changed one layout at a time, so two devices editing different layouts don't overwrite each other.
LAYOUTS_MAX = 50
LAYOUT_BYTES = 200_000


def _layouts(r) -> dict:
    d = store.load(r.dir + "layouts.json", {"layouts": [], "active": ""})
    if not isinstance(d, dict) or not isinstance(d.get("layouts"), list):
        d = {"layouts": [], "active": ""}
    return d


@app.get("/api/layouts")
async def layouts_get(request: Request):
    u, r = _urt(request)
    d = _layouts(r)
    return {"ok": True, "layouts": d["layouts"], "active": d.get("active", "")}


@app.post("/api/layouts")
async def layouts_set(request: Request):
    """{op: "put", layout} adds or replaces one layout (by id); {op: "del", id}; {op: "active", id}."""
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    d = _layouts(r)
    lst, op = d["layouts"], b.get("op")
    if op == "put":
        lay = b.get("layout")
        if not isinstance(lay, dict) or not str(lay.get("id") or "") or not isinstance(lay.get("charts"), list):
            return _err("bad layout")
        name = str(lay.get("name") or "").strip()[:60]
        if not name:
            return _err("a layout needs a name")
        if len(json.dumps(lay)) > LAYOUT_BYTES:
            return _err("layout too large")
        lid = str(lay["id"])[:40]
        if any(x["name"].lower() == name.lower() and x["id"] != lid for x in lst):
            return _err(f'you already have a layout called "{name}"')
        lay = {**lay, "id": lid, "name": name, "updated": int(time.time())}
        i = next((k for k, x in enumerate(lst) if x["id"] == lid), None)
        if i is None:
            if len(lst) >= LAYOUTS_MAX:
                return _err(f"at most {LAYOUTS_MAX} layouts")
            lst.append(lay)
        else:
            lst[i] = lay
        if b.get("activate"):
            d["active"] = lid
    elif op == "del":
        lid = str(b.get("id") or "")
        if len(lst) <= 1:
            return _err("the last layout can't be deleted")
        d["layouts"] = lst = [x for x in lst if x["id"] != lid]
        if d.get("active") == lid:
            d["active"] = lst[0]["id"]
    elif op == "active":
        lid = str(b.get("id") or "")
        if not any(x["id"] == lid for x in lst):
            return _err("no such layout")
        d["active"] = lid
    else:
        return _err("bad request")
    store.save(r.dir + "layouts.json", d)
    return {"ok": True, "layouts": d["layouts"], "active": d.get("active", "")}


@app.post("/api/measure")
async def measure(request: Request):
    """Net ₹ for moves measured on the chart (the measure tool, the long / short position drawings), after every charge
    for the entry and the exit, with the same charges code as trades. {s, product, legs: [{side, qty, entry, exit}]};
    qty in Fyers units (lots x lot size). Nothing is placed."""
    u, r = _urt(request)
    b = await _body(request)
    row = symbols.get(str(b.get("s") or ""))
    if not row:
        return _err("unknown contract")
    if row.get("x") == "MT5":                           # net $ for MT5 symbols comes with trading them (roadmap 8b)
        return _err("MT5 symbols: points only for now (net $ comes with trading MT5 in the next step)")
    prod = b.get("product")
    if prod in ("INTRADAY", "MARGIN", "CNC"):
        row = {**row, "prod": prod}
    legs = b.get("legs")
    if not isinstance(legs, list) or not legs or len(legs) > 200:
        return _err("bad legs")
    out = []
    for g in legs:
        try:
            side = 1 if float(g["side"]) > 0 else -1
            qty, en, ex = float(g["qty"]), float(g["entry"]), float(g["exit"])
            if qty <= 0 or en <= 0 or ex <= 0 or qty > 1e7:
                raise ValueError
            out.append(charges.net_at(row, side, qty, en, ex))
        except (KeyError, TypeError, ValueError):
            out.append(None)
    return {"ok": True, "lot": row.get("lot") or 1, "legs": out}


@app.get("/api/logs")
def logs(request: Request):
    """The helper's own log: everything for the admin, a user's own lines for everyone else."""
    u = _user(request)
    lines = logbuf.recent(500)
    if u["role"] != "admin":
        tags = (f"[{u['username']}]", f"[u/{u['uid']}/")
        lines = [x for x in lines if any(t in x.get("msg", "") for t in tags)]
    return {"ok": True, "lines": lines[-300:]}


# ------------------------------------------------------------------ paper trading (the account in X-Acct)
def _ok(engine, extra=None):
    out = {"ok": True, "paper": engine.snapshot()}
    if extra:
        out.update(extra)
    return out


async def _paper(request: Request, fn):
    _same_origin(request)
    b = await _body(request)
    engine = _eng(request, b, write=True)
    try:
        res = fn(engine, b)
    except mt5acct.NeedLogin as e:                     # an MT5 account's first change: the page asks for its login
        return JSONResponse({"ok": False, "error": str(e), "need_login": e.login, "paper": engine.snapshot()}, status_code=400)
    except Refused as e:
        return _err(e)
    except (KeyError, TypeError, ValueError) as e:
        return _err(f"bad request: {e}")
    return _ok(engine, res if isinstance(res, dict) else None)


async def _prefetch_margin(engine, b):
    """Ask Fyers for margin (blocking HTTP) in a worker before the engine, which runs on the event loop, uses it."""
    try:
        row = symbols.get(b.get("s", ""))
        if row:
            side = 1 if int(b.get("side", 1)) > 0 else -1
            await asyncio.get_running_loop().run_in_executor(None, engine.fetch_margin, row, side, b.get("product") or "INTRADAY")
    except Exception:
        pass


@app.get("/api/paper")
async def paper_state(request: Request):
    return _ok(_eng(request))


@app.post("/api/paper/preview")
async def paper_preview(request: Request):
    b = await _body(request)
    engine = _eng(request, b)
    await _prefetch_margin(engine, b)
    try:
        return {"ok": True, "plan": engine.plan(b)}
    except Refused as e:
        return _err(e)
    except (KeyError, TypeError, ValueError) as e:
        return _err(f"bad request: {e}")


@app.post("/api/paper/place")
async def paper_place(request: Request):
    _same_origin(request)
    b = await _body(request)
    engine = _eng(request, b, write=True)
    await _prefetch_margin(engine, b)
    u, r = _urt(request)
    aid = next((k for k, v in r.engines.items() if v is engine), "")
    if b.get("setup") and getattr(engine, "mode", "") != "mt5":     # (MT5 accounts: no journal yet, roadmap 8 c)
        jreplay.note_order(u["uid"], aid, b)          # the chart it came from, for the trade replay (v0.29.0)
    try:
        plan = engine.place(b)
    except mt5acct.NeedLogin as e:                     # an MT5 account's first change: the page asks for its login
        jreplay.drop_pending(u["uid"], aid, b)
        return JSONResponse({"ok": False, "error": str(e), "need_login": e.login, "paper": engine.snapshot()}, status_code=400)
    except Refused as e:
        jreplay.drop_pending(u["uid"], aid, b)
        return _err(e)
    except (KeyError, TypeError, ValueError) as e:
        jreplay.drop_pending(u["uid"], aid, b)
        return _err(f"bad request: {e}")
    return _ok(engine, {"plan": plan})


@app.post("/api/paper/close")
async def paper_close(request: Request):
    return await _paper(request, lambda e, b: e.close_now(b["id"]))


@app.post("/api/paper/close_all")
async def paper_close_all(request: Request):
    return await _paper(request, lambda e, b: e.close_all())


@app.post("/api/paper/cancel")
async def paper_cancel(request: Request):
    return await _paper(request, lambda e, b: e.cancel(b["id"]))


@app.post("/api/paper/modify")
async def paper_modify(request: Request):
    def go(engine, b):
        args = {k: b[k] for k in ("sl", "tp", "price") if k in b}
        if str(b["id"]).startswith("O"):
            engine.modify_order(b["id"], **args)
        else:
            args.pop("price", None)
            engine.modify_pos(b["id"], **args)
    return await _paper(request, go)


@app.post("/api/paper/be")
async def paper_be(request: Request):
    return await _paper(request, lambda e, b: e.be_now(b["id"]))


@app.post("/api/paper/be_all")
async def paper_be_all(request: Request):
    def go(engine, b):
        done = []
        for p in list(engine.positions):
            try:
                engine.be_now(p["id"])
                done.append(p["s"])
            except mt5acct.NeedLogin:
                raise                                  # (asks for the MT5 login, then the same request again)
            except Refused:
                pass
        if not done:
            raise Refused("no position has reached break-even + costs yet")
    return await _paper(request, go)


@app.post("/api/paper/pos_trail")
async def paper_pos_trail(request: Request):
    return await _paper(request, lambda e, b: e.set_pos_trail(b["id"], {k: b[k] for k in ("be_on", "be_r", "sl_on", "sl_r") if k in b}))


@app.post("/api/paper/trail")
async def paper_trail(request: Request):
    return await _paper(request, lambda e, b: e.set_trail(b))


@app.post("/api/paper/rules")
async def paper_rules(request: Request):
    return await _paper(request, lambda e, b: e.set_rules(b))


@app.post("/api/paper/ticket")
async def paper_ticket(request: Request):
    return await _paper(request, lambda e, b: e.set_ticket(b))


@app.post("/api/paper/reset")
async def paper_reset(request: Request):
    def go(engine, b):
        if b.get("confirm") != "RESET":
            raise Refused("type RESET to confirm")
        engine.reset(float(b.get("capital") or engine.rules["size"]))
    return await _paper(request, go)


@app.get("/api/paper/history")
async def paper_history(request: Request, days: int = 0):
    engine = _eng(request)
    rows = engine.history
    if days:
        cut = time.time() - days * 86400
        rows = [h for h in rows if h["closed"] >= cut]
    return {"ok": True, "rows": rows[::-1]}


@app.get("/api/paper/events")
async def paper_events(request: Request):
    """The paper account's log: fills, stops moved, exits, refusals (the latest 500)."""
    return {"ok": True, "events": _eng(request).events[::-1]}


@app.get("/api/paper/history.csv")
async def paper_csv(request: Request):
    engine = _eng(request)
    import csv
    import io
    f = io.StringIO()
    w = csv.writer(f)
    fmt = lambda ts: time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts)) if ts else ""
    if engine.mode == "mt5":                           # an MT5 account: $ (its currency), commission and swap
        w.writerow(["ticket", "symbol", "side", "lots", "open_price", "close_price", "opened_ist", "closed_ist", "broker_day",
                    "reason", "first_sl", "sl", "tp", "profit", "commission", "swap", "costs_total", "net", "init_risk", "r",
                    "best", "worst", "balance_after", "currency", "placed_in", "from_mt5_history"])
        for h in engine.history:
            c = h.get("charges") or {}
            w.writerow([h.get("ticket"), h["s"].split(":", 1)[-1], "BUY" if h["side"] > 0 else "SELL", h.get("lots"), h["avg"],
                        h["exit"], fmt(h["opened"]), fmt(h["closed"]), h.get("day"), h["reason"], h.get("first_sl"), h.get("sl"),
                        h.get("tp"), h["gross"], c.get("commission", 0), -c.get("swap", 0), c.get("total", 0), h["net"],
                        h.get("init_risk"), h.get("r"), h.get("best"), h.get("worst"), h.get("balance_after"), h.get("ccy", ""),
                        "MT5" if h.get("src") == "mt5" else "app", "yes" if h.get("from_history") else ""])
        name = "".join(ch for ch in (engine.name or "mt5") if ch.isalnum() or ch in "-_") or "mt5"
        return Response(f.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="MT5_{name}_trades.csv"'})
    cols = ["id", "symbol", "side", "product", "lots", "qty", "avg_entry", "exit", "opened_ist", "closed_ist", "reason",
            "first_sl", "sl", "tp", "gross", "brokerage", "exchange", "clearing", "ctt_stt", "stamp", "sebi", "ipft",
            "gst", "dp", "charges_total", "net", "init_risk", "r", "best", "worst", "balance_after", "placed_in"]
    w.writerow(cols)
    for h in engine.history:
        c = h["charges"]
        w.writerow([h["id"], h["s"], "BUY" if h["side"] > 0 else "SELL", h["product"], h["lots"], h["qty"], h["avg"],
                    h["exit"], fmt(h["opened"]), fmt(h["closed"]), h["reason"], h["first_sl"], h["sl"], h["tp"],
                    h["gross"], c["brokerage"], c["exchange"], c["clearing"], c["tax"], c["stamp"], c["sebi"],
                    c["ipft"], c["gst"], c.get("dp", 0), c["total"], h["net"], h["init_risk"], h["r"], h["best"], h["worst"],
                    h["balance_after"], "Fyers" if h.get("src") == "fyers" else "app"])
    name = "".join(ch for ch in (engine.name or "paper") if ch.isalnum() or ch in "-_") or "paper"
    return Response(f.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}_trades.csv"'})


@app.get("/api/charges")
def charge_table(request: Request):
    _need(request)
    return {"ok": True, "as_of": charges.AS_OF, "rows": charges.table(), "edit": charges.editable(), "check": charges_watch.status()}


@app.post("/api/charges/save")
async def charge_save(request: Request):
    """Your own rate edits: {"rates": {"NSE|EQ_I": {"exchange": 0.0000307}}, "gst": 0.18} (fractions)."""
    _same_origin(request)
    u = _admin(request)
    _stepped(request)
    b = await _body(request)
    try:
        charges.save_overrides(b if isinstance(b, dict) else {})
    except (ValueError, TypeError) as e:
        return _err(e)
    log.info("Charge rates edited in the app")
    users.audit(u["uid"], "charge rates edited", "", _ip(request))
    for urt in list(rt.RT.values()):
        for aid in list(urt.engines):
            _engine_changed(urt, aid, None)
    return {"ok": True, "edit": charges.editable(), "rows": charges.table()}


@app.post("/api/charges/check")
async def charge_check(request: Request):
    """Check Fyers' charges page now (it's also checked about once a day)."""
    _same_origin(request)
    _admin(request)
    st = await asyncio.get_running_loop().run_in_executor(None, charges_watch.check)
    return {"ok": True, "check": st}


@app.get("/api/feedcheck")
def feedcheck_report(request: Request, day: str = ""):
    """The order-flow check (admin): how much of the feed's volume arrived as exact single trades."""
    _admin(request)
    return {"ok": True, **FC.report(day or None)}


@app.post("/api/feedcheck")
async def feedcheck_set(request: Request):
    _same_origin(request)
    _admin(request)
    b = await _body(request)
    try:
        c = FC.set_config(on=b.get("on"), syms=b.get("symbols"))
    except ValueError as e:
        return _err(e)
    for urt in list(rt.RT.values()):
        urt.feed._resync()
    return {"ok": True, "config": c}


@app.post("/api/charges/reviewed")
async def charge_reviewed(request: Request):
    _same_origin(request)
    u = _admin(request)
    users.audit(u["uid"], "charges page reviewed", "", _ip(request))
    return {"ok": True, "check": charges_watch.mark_reviewed()}


# ------------------------------------------------------------------ Telegram alerts (your own bot)
# ------------------------------------------------------------------ price and technical alerts (v0.38.0, roadmap 21)
def _book(request: Request):
    u, r = _urt(request)
    return u, chartalerts.book(r)


@app.get("/api/alerts")
async def alerts_list(request: Request):
    """The user's alerts with their state, the limits, the operators and built-in indicators, phone push and Telegram."""
    u, b = _book(request)
    out = b.summary()
    out["push"] = {"key": webpush.public_key(), "subs": webpush.public(u["uid"])}
    out["tg"] = telegram.ready(telegram.load(u["uid"])) if u["role"] == "admin" else None
    return {"ok": True, **out}


@app.post("/api/alerts/save")
async def alerts_save(request: Request):
    """{alert}: a new alert (no id) or a change to one (with its id); {level: {id, ci, role, v}}: a 🔔 line dragged."""
    _same_origin(request)
    u, b = _book(request)
    body = await _body(request)
    try:
        lv = body.get("level")
        a = b.set_level(lv.get("id"), lv.get("ci"), lv.get("role"), lv.get("v")) if isinstance(lv, dict) else b.upsert(body.get("alert") or {})
    except chartalerts.Bad as e:
        return _err(e)
    return {"ok": True, "alert": b.public(a), "counts": b.counts()}


@app.post("/api/alerts/action")
async def alerts_action(request: Request):
    """{id, do: pause | resume | restart | clone | delete} (ids: [...] for several)."""
    _same_origin(request)
    u, b = _book(request)
    body = await _body(request)
    ids = body.get("ids") if isinstance(body.get("ids"), list) else [body.get("id")]
    out = []
    try:
        for i in ids[:MAX_BULK]:
            a = b.action(str(i or ""), str(body.get("do") or ""))
            if a:
                out.append(b.public(a))
    except chartalerts.Bad as e:
        return _err(e)
    return {"ok": True, "alerts": out, "counts": b.counts()}


MAX_BULK = 500


@app.get("/api/alerts/log")
async def alerts_log(request: Request, n: int = 300):
    u, b = _book(request)
    return {"ok": True, "log": b.read_log(max(1, min(int(n), 2000)))}


@app.post("/api/alerts/log/clear")
async def alerts_log_clear(request: Request):
    _same_origin(request)
    u, b = _book(request)
    b.clear_log()
    return {"ok": True}


@app.post("/api/alerts/test")
async def alerts_test(request: Request):
    """{notify, name?}: a test message through the chosen ways (Telegram, phone, webhook); the page plays its own sound."""
    _same_origin(request)
    u, b = _book(request)
    body = await _body(request)
    try:
        nt = chartalerts.clean({"target": {"s": "NSE:TEST"}, "conds": [{"a": {"k": "price"}, "op": "gt", "b": {"k": "value", "v": 0}, "tf": "5m"}],
                                "notify": body.get("notify") or {}}, None)["notify"]
    except chartalerts.Bad as e:
        return _err(e)
    e = {"id": "test", "aid": "test", "name": str(body.get("name") or "Test alert")[:100], "s": "NSE:TEST",
         "msg": "This is a test message from your Fyers Trade Manager alerts.", "t": time.time(), "px": None, "tf": "5m"}
    res = await b.deliver({"id": "test", "notify": nt}, e, test=True)
    return {"ok": True, "res": res}


@app.post("/api/push/subscribe")
async def push_subscribe(request: Request):
    """{sub: PushSubscription.toJSON(), name}: this browser gets alerts as notifications (phone: the app on the home screen)."""
    _same_origin(request)
    u = _user(request)
    body = await _body(request)
    try:
        s = webpush.subscribe(u["uid"], body.get("sub") or {}, request.headers.get("user-agent", ""), str(body.get("name") or ""),
                              f"https://{request.headers.get('host')}")
    except ValueError as e:
        return _err(e)
    users.audit(u["uid"], "push notifications on", s.get("host", ""), _ip(request))
    return {"ok": True, "sub": s, "subs": webpush.public(u["uid"])}


@app.post("/api/push/unsubscribe")
async def push_unsubscribe(request: Request):
    _same_origin(request)
    u = _user(request)
    body = await _body(request)
    webpush.unsubscribe(u["uid"], str(body.get("endpoint") or ""), str(body.get("id") or ""))
    return {"ok": True, "subs": webpush.public(u["uid"])}


@app.post("/api/push/test")
async def push_test(request: Request):
    """{id?}: a test notification to one browser (or all of this user's)."""
    _same_origin(request)
    u = _user(request)
    body = await _body(request)
    res = await asyncio.get_running_loop().run_in_executor(None, webpush.send, u["uid"], {
        "title": "🔔 Test notification", "body": "Alerts will arrive like this, with the page closed.", "tag": "test", "url": "/#alerts",
        "t": time.time(), "test": True}, str(body.get("id") or ""))
    return {"ok": True, "res": res, "subs": webpush.public(u["uid"])}


@app.get("/sw.js")
def service_worker():
    """The service worker (phone / desktop notifications) at the site's root, so it covers every page."""
    return FileResponse(ROOT / "web" / "sw.js", media_type="text/javascript",
                        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})


@app.get("/manifest.webmanifest")
def manifest():
    """What a phone needs to install the page as an app (Add to Home Screen): iPhone push needs that."""
    return FileResponse(ROOT / "web" / "manifest.webmanifest", media_type="application/manifest+json",
                        headers={"Cache-Control": "no-cache"})


@app.get("/api/ping")
def ping():
    """For the watchdog (and any outside monitor): answers while the helper's event loop runs. Says nothing else."""
    return {"ok": True, "t": int(time.time())}


@app.get("/api/telegram")
def telegram_get(request: Request):
    u = _admin(request)
    w = alerts.watchdog_status()
    w["hc"] = (w.get("hc") or {}).get(u["uid"])          # only this user's outside heartbeat
    return {"ok": True, "tg": telegram.public(u["uid"]), "watchdog": w}


@app.post("/api/telegram/settings")
async def telegram_settings(request: Request):
    """{token} (checked with Telegram, then saved encrypted), {chat, chat_title}, {alerts: {...}}, {hc_url, hc_key},
    {remove: true}. The token, the chat and the outside check need a fresh 2FA code; the alert switches don't."""
    _same_origin(request)
    u = _admin(request)
    b = await _body(request)
    uid = u["uid"]
    s = telegram.load(uid)
    sensitive = any(k in b for k in ("token", "chat", "hc_url", "hc_key", "remove"))
    if sensitive:
        _stepped(request)
    loop = asyncio.get_running_loop()
    try:
        if b.get("remove"):
            telegram.save(uid, {"alerts": s["alerts"]})
            users.audit(uid, "telegram removed", "", _ip(request))
            return {"ok": True, "tg": telegram.public(uid)}
        if "token" in b:
            tok = str(b.get("token") or "").strip()
            if not re.fullmatch(r"\d{5,12}:[A-Za-z0-9_-]{30,60}", tok):
                raise ValueError("that doesn't look like a bot token (from @BotFather it looks like 123456789:AAH…)")
            me = await loop.run_in_executor(None, telegram.call, tok, "getMe")
            if tok != telegram.token(s):
                s.pop("chat", None)
                s.pop("chat_title", None)
            s.update(token=users.seal(tok), bot="@" + str(me.get("username") or ""))
            users.audit(uid, "telegram bot saved", s["bot"], _ip(request))
        if "chat" in b:
            chat = str(b.get("chat") or "").strip()
            if not telegram.CHAT_RE.match(chat):
                raise ValueError("chat: a number like 123456789 (or -100… for a channel / group), or @channelname")
            if not s.get("token"):
                raise ValueError("save the bot token first")
            s.update(chat=chat, chat_title=str(b.get("chat_title") or "")[:80])
            users.audit(uid, "telegram chat set", chat, _ip(request))
        if isinstance(b.get("alerts"), dict):
            s["alerts"] = telegram.clean_alerts(b["alerts"], s["alerts"])
        if "hc_url" in b:
            url = str(b.get("hc_url") or "").strip()
            if url and not re.match(r"^https?://[^\s/]+/\S+$", url):
                raise ValueError("the ping URL: like https://hc-ping.com/<your check's UUID>")
            s["hc"] = {**(s.get("hc") or {}), "url": url}
            if not url:
                s["hc"] = {}
            users.audit(uid, "outside heartbeat " + ("set" if url else "removed"), "", _ip(request))
        if "hc_key" in b and s.get("hc", {}).get("url"):
            key = str(b.get("hc_key") or "").strip()
            s["hc"]["key"] = users.seal(key) if key else ""
    except (ValueError, telegram.TgError) as e:
        return _err(e)
    s["link"] = f"https://{request.headers.get('host')}/"
    telegram.save(uid, s)
    return {"ok": True, "tg": telegram.public(uid)}


@app.post("/api/telegram/chats")
async def telegram_chats(request: Request):
    """The chats that messaged the bot (or channels it posted in) recently, to pick from."""
    _same_origin(request)
    u = _admin(request)
    s = telegram.load(u["uid"])
    if not s.get("token"):
        return _err("save the bot token first")
    try:
        chats = await asyncio.get_running_loop().run_in_executor(None, telegram.chats_seen, telegram.token(s))
    except telegram.TgError as e:
        return _err(e)
    return {"ok": True, "chats": chats}


@app.post("/api/telegram/test")
async def telegram_test(request: Request):
    _same_origin(request)
    u = _admin(request)
    s = telegram.load(u["uid"])
    if not telegram.ready(s):
        return _err("save the bot token and choose a chat first")
    try:
        await asyncio.get_running_loop().run_in_executor(None, telegram.send, telegram.token(s), s["chat"],
                                                         "✅ <b>Test from Trade Manager</b>: live-trade alerts will come to this chat.")
    except telegram.TgError as e:
        return _err(e)
    return {"ok": True}


# ------------------------------------------------------------------ the trade journal (Octagon)
def _jkey(b: dict) -> str:
    return str(b.get("id") or "")


@app.get("/api/journal")
async def journal_get(request: Request):
    u, r = _urt(request)
    j = journal.get(u["uid"])
    j.sync(r)
    return {"ok": True, "j": j.view(r)}


@app.post("/api/journal/trade")
async def journal_trade(request: Request):
    """The audit, tags, plan and review of one trade: {id, direction, wait, execution, zen, target, regime, bias, ke,
    p1Checks, execFaults, numberRunning, payoutPressure, setup, notes, review}. Answers with that session's trades."""
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    j = journal.get(u["uid"])
    try:
        t0 = j.d["trades"].get(_jkey(b)) or {}
        e = r.engines.get(t0.get("acct", ""))
        before = j.lock_reason(t0["acct"], e.trading_day()) if e else None
        t = j.annotate(_jkey(b), b)
    except (KeyError, ValueError) as e:
        return _err(str(e).strip("'\""))
    journal.check_lock(r, t["acct"], before)
    return {"ok": True, "j": j.view(r, {journal.session_key(t)})}


@app.get("/api/journal/replay")
async def journal_replay(request: Request, id: str = ""):
    """A trade for the replay (v0.29.0): its facts, the stop's path, BE, and the chart's set-up at entry and exit."""
    u, r = _urt(request)
    j = journal.get(u["uid"])
    if id not in j.d["trades"]:
        j.sync(r)                                        # (History opened before the journal had seen the trade)
    with j.lock:
        t = copy.deepcopy(j.d["trades"].get(id))
    if not t or t.get("status") == "removed":
        return _err("that trade isn't in the journal")
    return {"ok": True, **jreplay.view(r, t)}


@app.post("/api/journal/replay/net")
async def journal_replay_net(request: Request):
    """{id, pts: [[time, price], ...]} -> net ₹ after all charges at each (what was open then, at that price)."""
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    j = journal.get(u["uid"])
    with j.lock:
        t = copy.deepcopy(j.d["trades"].get(_jkey(b)))
    if not t:
        return _err("that trade isn't in the journal")
    pts = b.get("pts") if isinstance(b.get("pts"), list) else []
    if len(pts) > 5000:
        return _err("at most 5,000 prices at a time")
    net = jreplay.net_series(t, pts)
    risk = t.get("init_risk") or 0
    return {"ok": True, "net": net, "r": [round(n / risk, 2) if n is not None and risk else None for n in net]}


@app.post("/api/journal/audit")
async def journal_audit(request: Request):
    """What the 8 pillars of a trade would be with these edits (the form shows it as you click); nothing is saved."""
    u, r = _urt(request)
    b = await _body(request)
    try:
        return {"ok": True, **journal.get(u["uid"]).preview(_jkey(b), b)}
    except (KeyError, ValueError) as e:
        return _err(str(e).strip("'\""))


@app.post("/api/journal/claim")
async def journal_claim(request: Request):
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    j = journal.get(u["uid"])
    try:
        t = j.claim(_jkey(b))
    except (KeyError, ValueError) as e:
        return _err(str(e).strip("'\""))
    return {"ok": True, "j": j.view(r, {journal.session_key(t)})}


@app.post("/api/journal/hide")
async def journal_hide(request: Request):
    """Remove a trade from the journal (its stats, reps and sessions) or bring it back: {id, hidden}."""
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    j = journal.get(u["uid"])
    try:
        j.set_hidden(_jkey(b), bool(b.get("hidden", True)))
    except KeyError as e:
        return _err(str(e).strip("'\""))
    return {"ok": True, "j": j.view(r)}


@app.post("/api/journal/practice")
async def journal_practice(request: Request):
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    j = journal.get(u["uid"])
    try:
        j.set_practice(str(b.get("day") or ""), bool(b.get("on")))
    except ValueError as e:
        return _err(e)
    return {"ok": True, "practice": j.d["practice"]}


@app.post("/api/journal/settings")
async def journal_settings(request: Request):
    """{rules: {...}} (Octagon rules and the lockout switches), {pillars: {n: {title, short, rule} | null}},
    {p1: [[key, label], ...] | null}."""
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    j = journal.get(u["uid"])
    before = {aid: j.lock_reason(aid, e.trading_day()) for aid, e in r.engines.items()}
    try:
        j.set_settings(b)
    except (ValueError, TypeError, IndexError) as e:
        return _err(e)
    for aid in r.engines:                                  # a rule change can start or end a lockout
        journal.check_lock(r, aid, before.get(aid))
        _engine_changed(r, aid, None)
    return {"ok": True, "j": j.view(r)}


@app.post("/api/journal/end")
async def journal_end(request: Request):
    """End today's session for the account in X-Acct (Pillar 5: walk away at peak equity). With the switch on, new
    orders are refused until the next trading day."""
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    e = _eng(request, b)
    aid = next((k for k, v in r.engines.items() if v is e), "")
    j = journal.get(u["uid"])
    before = j.lock_reason(aid, e.trading_day())
    j.end_session(aid, e.trading_day())
    journal.check_lock(r, aid, before)
    _engine_changed(r, aid, "Journal: session ended for today")
    return {"ok": True, "j": j.view(r)}


# ------------------------------------------------------------------ journal: weekly review, export, backup (v0.28.0)
@app.post("/api/journal/review")
async def journal_review(request: Request):
    """The weekly review: {week (its Monday), well, broke, focus, focusKept}. With {post: true, summary} the summary also
    goes to the journal's Telegram chat (when the backup is on), posted once and edited in place after that."""
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    j = journal.get(u["uid"])
    week = str(b.get("week") or "")
    try:
        rv = j.set_review(week, b)
    except ValueError as e:
        return _err(e)
    tg = None
    if b.get("post") and str(b.get("summary") or "").strip():
        try:
            tg = await asyncio.get_running_loop().run_in_executor(None, jshots.tg_review, u["uid"], week, str(b["summary"]))
        except telegram.TgError as e:
            tg = "error: " + str(e)
    _journal_changed(u["uid"])
    return {"ok": True, "review": j.d["reviews"].get(week, rv), "reviews": j.d["reviews"], "tg": tg}


@app.get("/api/journal/export.csv")
async def journal_export_csv(request: Request):
    """Every trade in the journal with its 8 pillars, for a spreadsheet (UTF-8, Excel-friendly)."""
    u, r = _urt(request)
    j = journal.get(u["uid"])
    text = await asyncio.get_running_loop().run_in_executor(None, j.csv_text, r)
    day = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 19800))
    return Response(text.encode("utf-8"), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="journal_{day}.csv"', "Cache-Control": "no-store"})


@app.get("/api/journal/backup.zip")
async def journal_backup(request: Request):
    """The whole journal and its pictures in one zip (restore it with /api/journal/restore)."""
    import tempfile
    from starlette.background import BackgroundTask
    u, r = _urt(request)
    j = journal.get(u["uid"])
    fd, path = tempfile.mkstemp(suffix=".zip", dir=str(store.path("tmp/x").parent))
    os.close(fd)
    try:
        await asyncio.get_running_loop().run_in_executor(None, j.backup_zip, path)
    except Exception as e:
        os.remove(path)
        return _err(f"couldn't make the backup: {e}", 500)
    day = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 19800))
    return FileResponse(path, media_type="application/zip", filename=f"journal_backup_{day}.zip",
                        headers={"Cache-Control": "no-store"}, background=BackgroundTask(os.remove, path))


RESTORE_MAX = 500 * 1024 * 1024


@app.post("/api/journal/restore")
async def journal_restore(request: Request):
    """Add back from a backup: the body is the backup .zip (or its journal.json). Only what's missing is added: trades,
    reviews, practice days and pictures; nothing already in the journal changes."""
    import tempfile
    _same_origin(request)
    u, r = _urt(request)
    if int(request.headers.get("content-length") or 0) > RESTORE_MAX:
        return _err("a backup can be up to 500 MB", 413)
    fd, path = tempfile.mkstemp(suffix=".bak", dir=str(store.path("tmp/x").parent))
    n = 0
    try:
        with os.fdopen(fd, "wb") as f:
            async for chunk in request.stream():
                n += len(chunk)
                if n > RESTORE_MAX:
                    return _err("a backup can be up to 500 MB", 413)
                f.write(chunk)
        if not n:
            return _err("no file came with the request")
        j = journal.get(u["uid"])
        try:
            got = await asyncio.get_running_loop().run_in_executor(None, j.restore, path)
        except ValueError as e:
            return _err(e)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    j.sync(r)
    _journal_changed(u["uid"])
    users.audit(u["uid"], "journal restore", f"{got['trades']} trades, {got['pictures']} pictures added")
    return {"ok": True, "got": got, "j": j.view(r)}


# ------------------------------------------------------------------ journal pictures (helper/jshots.py, v0.27.0)
def _jshot(j, key: str, sid: str):
    t = j.d["trades"].get(key)
    sh = next((x for x in (t or {}).get("shots") or [] if x["id"] == sid), None)
    if not sh:
        raise HTTPException(404, "no such picture")
    return t, sh


@app.get("/api/journal/shot")
async def journal_shot(request: Request, id: str, shot: str, thumb: int = 0, dl: int = 0):
    """One picture of a journal trade (your own journal only). thumb=1: the small copy for the list."""
    u, r = _urt(request)
    j = journal.get(u["uid"])
    t, sh = _jshot(j, id, shot)
    path = None
    if thumb:
        path = await asyncio.get_running_loop().run_in_executor(None, jshots.thumb, u["uid"], id, sh)
    mime = "image/jpeg" if path else jshots.MIME.get(sh.get("ext") or "png", "image/png")
    path = path or jshots.file_of(u["uid"], id, sh)
    if not os.path.exists(path):
        raise HTTPException(404, "the picture's file is missing")
    hdr = {"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"}
    if dl:
        hdr["Content-Disposition"] = f'attachment; filename="{sh.get("name") or shot + "." + (sh.get("ext") or "png")}"'
    return FileResponse(path, media_type=mime, headers=hdr)


@app.post("/api/journal/shot/add")
async def journal_shot_add(request: Request, id: str, tf: str = "Context", kind: str = "upload", phase: str = "",
                           name: str = ""):
    """Add a picture to a trade: the body is the image itself (PNG / JPEG / WebP / GIF, up to 10 MB).
    kind "upload" (your own, labelled by tf) or "chart" (an open chart's picture at the trade's entry / exit: phase;
    one per timeframe - a second page sending the same one is told dup)."""
    _same_origin(request)
    u, r = _urt(request)
    if kind not in ("upload", "chart") or (kind == "chart" and phase not in ("entry", "exit")):
        return _err("kind: upload, or chart with phase entry / exit")
    if not jshots.tf_ok(tf):
        return _err("label: a timeframe like 5m, 1h, 1D, or Context")
    if int(request.headers.get("content-length") or 0) > jshots.MAX_BYTES:
        return _err("pictures can be up to 10 MB", 413)
    buf = bytearray()
    async for chunk in request.stream():                   # stop at the limit even without a Content-Length
        buf += chunk
        if len(buf) > jshots.MAX_BYTES:
            return _err("pictures can be up to 10 MB", 413)
    data = bytes(buf)
    ext = jshots.sniff(data)
    if not ext:
        return _err("that isn't a PNG, JPEG, WebP or GIF picture (HEIC photos: share them as JPEG)")
    try:
        w, h = await asyncio.get_running_loop().run_in_executor(None, jshots.image_size, data)
    except ValueError as e:
        return _err(e)
    j = journal.get(u["uid"])
    if id not in j.d["trades"]:
        return _err("no such trade in the journal")
    base = re.sub(r"[^A-Za-z0-9_.-]", "_", name.rsplit(".", 1)[0])[:40] if name else ""
    sh = {"id": jshots.new_id(), "kind": kind, "phase": phase or None, "tf": tf,
          "src": "browser" if kind == "chart" else "upload", "at": time.time(), "w": w, "h": h, "bytes": len(data), "ext": ext,
          "name": (f"{base}.{ext}" if base else f"{j.d['trades'][id]['s'].split(':')[-1]}_{tf}{'_' + phase if phase else ''}.{ext}")}
    try:
        j.add_shot(id, sh, unique=(kind, phase, tf) if kind == "chart" else None)
    except KeyError as e:
        if str(e).strip("'\"") == "dup":
            return {"ok": True, "dup": True}
        return _err(str(e).strip("'\""))
    jshots.write(u["uid"], id, sh, data)
    _journal_changed(u["uid"])
    jshots.after_add(u["uid"], id, sh)
    return {"ok": True, "shot": sh, "j": j.view(r, {journal.session_key(j.d["trades"][id])})}


@app.post("/api/journal/shot/edit")
async def journal_shot_edit(request: Request):
    """{id, shot, tf}: change a picture's label; {id, shot, delete: true}: delete it (and its Telegram copy)."""
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    j = journal.get(u["uid"])
    key, sid = str(b.get("id") or ""), str(b.get("shot") or "")
    try:
        if b.get("delete"):
            sh = j.del_shot(key, sid)
            jshots.forget(u["uid"], key, sh)
        else:
            j.set_shot(key, sid, str(b.get("tf") or ""))
    except (KeyError, ValueError) as e:
        return _err(str(e).strip("'\""))
    _journal_changed(u["uid"])
    return {"ok": True, "j": j.view(r, {journal.session_key(j.d["trades"][key])})}


@app.post("/api/journal/shot/draw")
async def journal_shot_draw(request: Request):
    """{id, phase}: draw (again) the server's picture of a trade at its entry or exit (also for trades from before)."""
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    j = journal.get(u["uid"])
    t = j.d["trades"].get(str(b.get("id") or ""))
    ph = str(b.get("phase") or "")
    if not t:
        return _err("no such trade in the journal")
    if ph not in ("entry", "exit") or (ph == "exit" and t["status"] != "closed"):
        return _err("phase: entry, or exit once the trade has closed")
    if not jshots.pillow():
        return _err("the server can't draw yet: Pillow isn't installed (it comes with the next update's install step)")
    jshots.draw_now(u["uid"], t["id"], ph)
    return {"ok": True}


@app.get("/api/journal/pictures")
async def journal_pictures(request: Request):
    """Journal › Settings › Pictures: the settings, the Telegram bot (from Settings › Telegram alerts), space used."""
    u, r = _urt(request)
    j = journal.get(u["uid"])
    use = await asyncio.get_running_loop().run_in_executor(None, jshots.usage, u["uid"])
    c = jshots.cfg(j.d["settings"])
    unsent = sum(1 for t in j.d["trades"].values() if jshots.chat_for(c, t) for s in t.get("shots") or []
                 if not (s.get("tg") or {}).get("msg"))
    return {"ok": True, "cfg": j.shots_cfg(), "tg": jshots.tg_state(u["uid"]), "usage": use, "unsent": unsent,
            "pillow": jshots.pillow(), "queued": jshots.pending(), "admin": u["role"] == "admin"}


@app.post("/api/journal/pictures/tg")
async def journal_pictures_tg(request: Request):
    """{action: "test", chat}: a test message to that chat with your bot; {action: "send"}: send every picture not
    sent yet."""
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    if b.get("action") == "test":
        chat = str(b.get("chat") or "").strip()
        if not jshots.CHAT_RE.match(chat):
            return _err("Telegram chat: a number like -1001234567890, or @channelname")
        try:
            await asyncio.get_running_loop().run_in_executor(None, jshots.tg_test, u["uid"], chat, bool(b.get("live")))
        except telegram.TgError as e:
            return _err(e)
        return {"ok": True}
    if b.get("action") == "send":
        return {"ok": True, "queued": jshots.tg_send_missing(u["uid"])}
    return _err("action: test or send")


# ------------------------------------------------------------------ live prices (each user's own feed)
# ------------------------------------------------------------------ MT5 bridge (roadmap 8): the EA on the owner's laptop
# The EA (mt5/FTM_Bridge.mq5) calls out to these three routes with WebRequest and its bridge key (X-FTM-Key); no cookie.
def _mt5_uid(request: Request):
    ip = _ip(request)
    if mt5.blocked(ip):
        return None, PlainTextResponse("ERR too many wrong keys from this address: wait 10 minutes\n", status_code=429)
    uid = mt5.uid_for(request.headers.get("x-ftm-key") or "", ip)
    u = users.get(uid) if uid else None
    if not u or u.get("disabled"):
        return None, PlainTextResponse("ERR bridge key not accepted: make a new one in Settings › MT5 bridge\n", status_code=401)
    return uid, None


def _too_big(request: Request, mb: int) -> bool:
    try:
        return int(request.headers.get("content-length") or 0) > mb * 1_000_000
    except ValueError:
        return True


@app.post("/api/mt5/sync")
async def mt5_sync(request: Request):
    """The EA, about 4 times a second: its account, clock and new ticks. Answers with text lines (commands)."""
    uid, bad = _mt5_uid(request)
    if bad:
        return bad
    if _too_big(request, 4):
        return PlainTextResponse("ERR too big\n", status_code=413)
    b = await _body(request)
    r = rt.get(uid)
    return PlainTextResponse(mt5.sync(uid, b, _ip(request), r.feed))


@app.post("/api/mt5/bars")
async def mt5_bars(request: Request):
    """The EA: candles for a HIST line (in parts)."""
    uid, bad = _mt5_uid(request)
    if bad:
        return bad
    if _too_big(request, 30):
        return _err("too big", 413)
    return mt5.take_bars(uid, await _body(request))


@app.post("/api/mt5/symbols")
async def mt5_symbols(request: Request):
    """The EA: the broker's symbol list with each symbol's settings (after a LIST line)."""
    uid, bad = _mt5_uid(request)
    if bad:
        return bad
    if _too_big(request, 20):
        return _err("too big", 413)
    return mt5.take_symbols(uid, await _body(request))


@app.get("/api/mt5")
def mt5_status(request: Request):
    """Settings › MT5 bridge: the key, the terminals that called, where prices come from."""
    u = _user(request)
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "https").split(",")[0].strip()
    host = request.headers.get("host") or ""
    return mt5.status(u["uid"], f"{proto}://{host}" if host else "")


@app.get("/api/mt5/ea")
def mt5_ea(request: Request):
    """The bridge EA's source (mt5/FTM_Bridge.mq5), to compile in your own MetaEditor."""
    _user(request)
    return FileResponse(ROOT / "mt5" / "FTM_Bridge.mq5", media_type="text/plain; charset=utf-8", filename="FTM_Bridge.mq5")


@app.post("/api/mt5/key")
async def mt5_key(request: Request):
    """A new bridge key (shown once; the old one stops working) or no key. Needs a fresh 2FA code."""
    _same_origin(request)
    u = _user(request)
    _stepped(request)
    b = await _body(request)
    if b.get("action") == "revoke":
        mt5.revoke(u["uid"])
        users.audit(u["uid"], "mt5_key_revoked", "", _ip(request))
        return {"ok": True}
    key = mt5.new_key(u["uid"])
    users.audit(u["uid"], "mt5_key_new", "", _ip(request))
    return {"ok": True, "key": key}


@app.post("/api/mt5/settings")
async def mt5_settings(request: Request):
    """Which terminal gives the prices, and the broker's clock rule."""
    _same_origin(request)
    u = _user(request)
    return mt5.settings(u["uid"], await _body(request))


@app.websocket("/ws")
async def ws(socket: WebSocket):
    origin = socket.headers.get("origin", "")
    u = users.check(socket.cookies.get(users.COOKIE))
    if not u or (origin and origin.split("://", 1)[-1] != socket.headers.get("host")):
        await socket.accept()
        await socket.close(code=4401)              # tells the page to show the login screen
        return
    await socket.accept()
    r = rt.get(u["uid"])
    feed = r.feed
    client = feed.add()
    client.sess = u.get("session")                 # (the Paper / Live switch is per login: its pages follow it)

    async def reader():
        while True:
            try:
                msg = json.loads(await socket.receive_text())
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            if "acct" in msg:
                e = r.engine(msg.get("acct"))
                client.acct = r.engine_id(e)
                feed._offer(client, {"paper": e.snapshot(), "acct": client.acct, "events": []})
            if isinstance(msg.get("want"), list):
                feed.want(client, msg["want"])
            if "depth" in msg:
                feed.set_depth(client, msg["depth"])

    async def writer():
        while True:
            try:
                msg = await asyncio.wait_for(client.queue.get(), timeout=20)
                await socket.send_text(json.dumps(msg))
            except asyncio.TimeoutError:
                if not users.check(socket.cookies.get(users.COOKIE)):     # logged out / disabled meanwhile
                    await socket.close(code=4401)
                    return
                await socket.send_text(json.dumps({"ping": int(time.time()), "feed": feed.status()}))

    tasks = [asyncio.create_task(reader()), asyncio.create_task(writer())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    finally:
        for t in tasks:
            t.cancel()
        feed.remove(client)
