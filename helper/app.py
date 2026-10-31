"""Fyers trade manager helper: users with 2FA, each with their own Fyers login, price feed, Pine scripts and paper
accounts; charts, Pine Script, paper trading net of every charge.

Run: uvicorn helper.app:app --host 127.0.0.1 --port 8000   (Caddy serves it over HTTPS)
"""
import asyncio
import json
import logging
import subprocess
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from fastapi.staticfiles import StaticFiles

from . import charges, charges_watch, fyers_link, logbuf, rt, store, symbols, users
from .feedcheck import FC
from . import candles as candles_store
from .paper import Refused

logbuf.setup()
log = logging.getLogger("helper")
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
    rt.start(loop)
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


def _eng(request: Request, b: dict | None = None):
    """The paper account this request is about: the X-Acct header (the page's account switcher)."""
    u, r = _urt(request)
    aid = request.headers.get("x-acct") or (b or {}).get("acct") or request.query_params.get("acct")
    return r.engine(aid)


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
    return out


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
    """Paper <-> Live. Live: the admin only, Fyers logged in today, the Fyers client ID typed to confirm, and a fresh
    2FA code. The account must be flat; its trades so far are archived and it starts a fresh ledger."""
    _same_origin(request)
    u, r = _urt(request)
    b = await _body(request)
    mode = str(b.get("mode") or "")
    if mode == "live":
        if u["role"] != "admin":
            return _err("Live trading is for the admin only (SEBI / Fyers static-IP rules)", 403)
        st = await asyncio.get_running_loop().run_in_executor(None, r.link.status)
        if not st.get("logged_in") or not st.get("client_id"):
            return _err("log in to Fyers first (today's login), so the app can read your client ID")
        if str(b.get("confirm") or "").strip().upper() != str(st["client_id"]).upper():
            return _err(f"type your Fyers client ID ({st['client_id']}) exactly to confirm")
        _stepped(request)
    try:
        cap = float(b.get("capital") or 0) or None
        a = r.set_mode(str(b.get("id") or ""), mode, cap)
    except Refused as e:
        return _err(e)
    except (TypeError, ValueError):
        return _err("enter the capital in rupees")
    users.audit(u["uid"], f"LIVE {'ON' if mode == 'live' else 'off'}", a["name"], _ip(request))
    log.warning("Account %s (%s) is now %s", a["name"], u["username"], mode.upper())
    return {"ok": True, "account": a, "accounts": r.account_list()}


# ------------------------------------------------------------------ live accounts (real orders at Fyers)
def _live(request: Request, b: dict | None = None):
    e = _eng(request, b)
    if getattr(e, "mode", "paper") != "live":
        raise HTTPException(400, "this is a paper account")
    return e


@app.get("/api/live/status")
async def live_status(request: Request, funds: int = 0):
    e = _live(request)
    out = {"ok": True, "live": e.live_status()}
    if funds:
        try:
            out["funds"] = await asyncio.get_running_loop().run_in_executor(None, e.broker.funds)
        except Exception as ex:
            out["funds_error"] = str(ex)
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
    e = _live(request, b)
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
    return {"ok": True, "rows": symbols.search(q, kind, ex=ex)}


@app.get("/api/symbol")
def one_symbol(request: Request, s: str):
    _need(request)
    r = symbols.get(s)
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
    engine = _eng(request, b)
    try:
        res = fn(engine, b)
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
    engine = _eng(request, b)
    await _prefetch_margin(engine, b)
    try:
        plan = engine.place(b)
    except Refused as e:
        return _err(e)
    except (KeyError, TypeError, ValueError) as e:
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
    cols = ["id", "symbol", "side", "product", "lots", "qty", "avg_entry", "exit", "opened_ist", "closed_ist", "reason",
            "first_sl", "sl", "tp", "gross", "brokerage", "exchange", "clearing", "ctt_stt", "stamp", "sebi", "ipft",
            "gst", "dp", "charges_total", "net", "init_risk", "r", "best", "worst", "balance_after"]
    w.writerow(cols)
    fmt = lambda ts: time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts))
    for h in engine.history:
        c = h["charges"]
        w.writerow([h["id"], h["s"], "BUY" if h["side"] > 0 else "SELL", h["product"], h["lots"], h["qty"], h["avg"],
                    h["exit"], fmt(h["opened"]), fmt(h["closed"]), h["reason"], h["first_sl"], h["sl"], h["tp"],
                    h["gross"], c["brokerage"], c["exchange"], c["clearing"], c["tax"], c["stamp"], c["sebi"],
                    c["ipft"], c["gst"], c.get("dp", 0), c["total"], h["net"], h["init_risk"], h["r"], h["best"], h["worst"],
                    h["balance_after"]])
    from fastapi.responses import Response
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


# ------------------------------------------------------------------ live prices (each user's own feed)
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

    async def reader():
        while True:
            try:
                msg = json.loads(await socket.receive_text())
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            if "acct" in msg:
                client.acct = r.engine(msg.get("acct")).dir.rstrip("/").split("/")[-1]
                feed._offer(client, {"paper": r.engines[client.acct].snapshot(), "acct": client.acct, "events": []})
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
