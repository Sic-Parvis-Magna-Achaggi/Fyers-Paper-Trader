"""Fyers trade manager helper - milestone 1: login, Fyers connection, MCX symbols, charts with live prices.

Run: uvicorn helper.app:app --host 127.0.0.1 --port 8000   (Caddy serves it over HTTPS)
"""
import asyncio
import json
import logging
import subprocess
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import auth, fyers_link, logbuf, store, symbols
from .feed import feed

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


@app.on_event("startup")
async def _startup():
    feed.start(asyncio.get_running_loop())
    if not auth.is_set_up():
        code = auth.setup_code()
        store.path("SETUP_CODE.txt").write_text(code + "\n")
        log.warning("First run: setup code is in %s", store.path("SETUP_CODE.txt"))
    asyncio.get_running_loop().run_in_executor(None, symbols.refresh)
    log.info("Helper %s (%s) started", VERSION, COMMIT or "no git")


# ------------------------------------------------------------------ helpers
def _session(request: Request) -> bool:
    return auth.check(request.cookies.get(auth.COOKIE))


def _need(request: Request):
    if not _session(request):
        raise HTTPException(401, "log in first")


def _same_origin(request: Request):
    """Refuse state-changing calls that come from another site."""
    origin = request.headers.get("origin")
    if origin and origin.split("://", 1)[-1] != request.headers.get("host"):
        raise HTTPException(403, "wrong origin")


def _with_cookie(resp: JSONResponse, token: str) -> JSONResponse:
    resp.set_cookie(auth.COOKIE, token, max_age=auth.SESSION_DAYS * 86400, httponly=True,
                    secure=True, samesite="lax", path="/")
    return resp


def _redirect_uri(request: Request) -> str:
    return f"https://{request.headers.get('host')}/fyers/callback"


async def _body(request: Request) -> dict:
    try:
        return await request.json()
    except Exception:
        return {}


def _err(e: Exception, code: int = 400):
    return JSONResponse({"ok": False, "error": str(e)}, status_code=code)


# ------------------------------------------------------------------ page
@app.get("/", response_class=HTMLResponse)
def index():
    return FileResponse(ROOT / "web" / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/api/state")
def state(request: Request):
    out = {"setup_done": auth.is_set_up(), "session": _session(request), "version": VERSION, "commit": COMMIT,
           "uptime": int(time.time() - STARTED)}
    if out["session"]:
        out["fyers"] = fyers_link.status()
        out["fyers_settings"] = fyers_link.public_settings()
        out["redirect_uri"] = _redirect_uri(request)
        out["feed"] = feed.status()
    return out


@app.post("/api/setup")
async def setup(request: Request):
    _same_origin(request)
    b = await _body(request)
    try:
        tok = auth.complete_setup(b.get("code", ""), b.get("password", ""))
    except ValueError as e:
        return _err(e)
    store.path("SETUP_CODE.txt").unlink(missing_ok=True)
    log.info("Password set - setup complete")
    return _with_cookie(JSONResponse({"ok": True}), tok)


@app.post("/api/login")
async def login(request: Request):
    _same_origin(request)
    b = await _body(request)
    try:
        tok = auth.login(b.get("password", ""), (request.headers.get("x-forwarded-for") or request.client.host).split(",")[0].strip())
    except ValueError as e:
        log.warning("Page login refused: %s", e)
        return _err(e, 401)
    return _with_cookie(JSONResponse({"ok": True}), tok)


@app.post("/api/logout")
async def logout(request: Request):
    _same_origin(request)
    auth.logout(request.cookies.get(auth.COOKIE))
    r = JSONResponse({"ok": True})
    r.delete_cookie(auth.COOKIE, path="/")
    return r


@app.post("/api/password")
async def password(request: Request):
    _same_origin(request)
    _need(request)
    b = await _body(request)
    try:
        auth.change_password(b.get("old", ""), b.get("new", ""))
    except ValueError as e:
        return _err(e)
    return _with_cookie(JSONResponse({"ok": True}), auth.new_session())


# ------------------------------------------------------------------ Fyers
@app.post("/api/fyers/settings")
async def fyers_settings(request: Request):
    _same_origin(request)
    _need(request)
    b = await _body(request)
    try:
        fyers_link.save_settings(b.get("app_id", ""), b.get("secret", ""), _redirect_uri(request))
    except ValueError as e:
        return _err(e)
    return {"ok": True}


@app.get("/api/fyers/login")
def fyers_login(request: Request):
    _need(request)
    try:
        return {"ok": True, "url": fyers_link.login_url(_redirect_uri(request))}
    except ValueError as e:
        return _err(e)


@app.get("/fyers/callback")
def fyers_callback(request: Request):
    q = request.query_params
    code = q.get("auth_code") or q.get("code") or ""
    try:
        if q.get("s") == "error" or not code:
            raise ValueError(q.get("message") or "Fyers didn't send a login code")
        fyers_link.handle_callback(code, q.get("state", ""))
    except Exception as e:
        log.warning("Fyers login failed: %s", e)
        return RedirectResponse("/?fyers=error&msg=" + str(e)[:200].replace(" ", "+"), status_code=303)
    feed._resync()
    return RedirectResponse("/?fyers=ok", status_code=303)


# ------------------------------------------------------------------ market data
@app.get("/api/symbols")
def find_symbols(request: Request, q: str = "", kind: str = ""):
    _need(request)
    if len(q.strip()) < 2:
        return {"ok": True, "rows": []}
    return {"ok": True, "rows": symbols.search(q, kind)}


@app.get("/api/symbol")
def one_symbol(request: Request, s: str):
    _need(request)
    r = symbols.get(s)
    return {"ok": bool(r), "row": r}


@app.get("/api/chain")
def option_chain(request: Request, u: str, exp: int = 0):
    _need(request)
    exps = symbols.expiries(u)
    if not exp and exps:
        exp = exps[0]
    return {"ok": True, "expiries": exps, "exp": exp, "rows": symbols.chain(u, exp)}


_hist_cache: dict = {}


@app.get("/api/history")
async def history(request: Request, symbol: str, res: str = "5", days: int = 5):
    _need(request)
    key = (symbol, res, days)
    hit = _hist_cache.get(key)
    if hit and time.time() - hit[0] < 45:          # switching back and forth costs no data requests
        return {"ok": True, "candles": hit[1], "cached": True}
    try:
        candles = await asyncio.get_running_loop().run_in_executor(None, fyers_link.history, symbol, res, days)
    except PermissionError as e:
        return _err(e, 409)
    except Exception as e:
        log.warning("History %s %s failed: %s", symbol, res, e)
        return _err(e, 502)
    if len(_hist_cache) > 60:
        _hist_cache.clear()
    _hist_cache[key] = (time.time(), candles)
    return {"ok": True, "candles": candles}


@app.get("/api/logs")
def logs(request: Request):
    _need(request)
    return {"ok": True, "lines": logbuf.recent(300)}


# ------------------------------------------------------------------ live prices
@app.websocket("/ws")
async def ws(socket: WebSocket):
    origin = socket.headers.get("origin", "")
    if not auth.check(socket.cookies.get(auth.COOKIE)) or (origin and origin.split("://", 1)[-1] != socket.headers.get("host")):
        await socket.accept()
        await socket.close(code=4401)              # tells the page to show the login screen
        return
    await socket.accept()
    client = feed.add()

    async def reader():
        while True:
            try:
                msg = json.loads(await socket.receive_text())
            except ValueError:
                continue
            if isinstance(msg, dict) and isinstance(msg.get("want"), list):
                feed.want(client, msg["want"])

    async def writer():
        while True:
            try:
                tick = await asyncio.wait_for(client.queue.get(), timeout=20)
                await socket.send_text(json.dumps({"tick": tick}))
            except asyncio.TimeoutError:
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
