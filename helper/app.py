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

from . import auth, charges, fyers_link, logbuf, store, symbols
from .feed import feed
from .paper import Refused, engine

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


_push = {"pending": False, "events": []}


def _engine_changed(event):
    """Engine changed: send the page a fresh snapshot (coalesced), plus the event line if there is one."""
    if event:
        _push["events"].append(event)
    if _push["pending"]:
        return
    _push["pending"] = True
    asyncio.get_running_loop().call_later(0.15, _send_snapshot)


def _send_snapshot():
    _push["pending"] = False
    ev, _push["events"] = _push["events"], []
    try:
        feed.broadcast({"paper": engine.snapshot(), "events": ev})
    except Exception as e:
        log.exception("snapshot failed: %s", e)


async def _engine_loop():
    while True:
        await asyncio.sleep(5)
        try:
            engine.housekeeping()
        except Exception as e:
            log.exception("paper housekeeping: %s", e)


@app.on_event("startup")
async def _startup():
    engine.on_change = _engine_changed
    engine.on_symbols = lambda: feed._resync()
    feed.extra = engine.watch_symbols
    feed.on_tick = engine.on_tick
    feed.start(asyncio.get_running_loop())
    asyncio.get_running_loop().create_task(_engine_loop())
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
    html = (ROOT / "web" / "index.html").read_text(encoding="utf-8").replace("__V__", f"{VERSION}-{COMMIT}")
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


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


@app.get("/api/prefs")
async def get_prefs(request: Request):
    _need(request)
    return {"ok": True, "prefs": store.load("prefs.json")}


@app.post("/api/prefs")
async def set_prefs(request: Request):
    """Page preferences (watchlist, timeframes, last chart, theme, default stop distances...): merged, so
    every device and every login gets the same set-up."""
    _same_origin(request)
    _need(request)
    b = await _body(request)
    if not isinstance(b, dict) or len(json.dumps(b)) > 100_000:
        return _err("bad preferences")
    p = store.load("prefs.json")
    p.update(b)
    store.save("prefs.json", p)
    return {"ok": True}


@app.get("/api/logs")
def logs(request: Request):
    _need(request)
    return {"ok": True, "lines": logbuf.recent(300)}


# ------------------------------------------------------------------ paper trading
def _ok(extra=None):
    out = {"ok": True, "paper": engine.snapshot()}
    if extra:
        out.update(extra)
    return out


async def _paper(request: Request, fn):
    _same_origin(request)
    _need(request)
    b = await _body(request)
    try:
        res = fn(b)
    except Refused as e:
        return _err(e)
    except (KeyError, TypeError, ValueError) as e:
        return _err(f"bad request: {e}")
    return _ok(res if isinstance(res, dict) else None)


async def _prefetch_margin(b):
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
    _need(request)
    return _ok()


@app.post("/api/paper/preview")
async def paper_preview(request: Request):
    _need(request)
    b = await _body(request)
    await _prefetch_margin(b)
    try:
        return {"ok": True, "plan": engine.plan(b)}
    except Refused as e:
        return _err(e)
    except (KeyError, TypeError, ValueError) as e:
        return _err(f"bad request: {e}")


@app.post("/api/paper/place")
async def paper_place(request: Request):
    _same_origin(request)
    _need(request)
    b = await _body(request)
    await _prefetch_margin(b)
    try:
        plan = engine.place(b)
    except Refused as e:
        return _err(e)
    except (KeyError, TypeError, ValueError) as e:
        return _err(f"bad request: {e}")
    return _ok({"plan": plan})


@app.post("/api/paper/close")
async def paper_close(request: Request):
    return await _paper(request, lambda b: engine.close_now(b["id"]))


@app.post("/api/paper/close_all")
async def paper_close_all(request: Request):
    return await _paper(request, lambda b: engine.close_all())


@app.post("/api/paper/cancel")
async def paper_cancel(request: Request):
    return await _paper(request, lambda b: engine.cancel(b["id"]))


@app.post("/api/paper/modify")
async def paper_modify(request: Request):
    def go(b):
        args = {k: b[k] for k in ("sl", "tp", "price") if k in b}
        if str(b["id"]).startswith("O"):
            engine.modify_order(b["id"], **args)
        else:
            args.pop("price", None)
            engine.modify_pos(b["id"], **args)
    return await _paper(request, go)


@app.post("/api/paper/be")
async def paper_be(request: Request):
    return await _paper(request, lambda b: engine.be_now(b["id"]))


@app.post("/api/paper/be_all")
async def paper_be_all(request: Request):
    def go(b):
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
    return await _paper(request, lambda b: engine.set_pos_trail(b["id"], {k: b[k] for k in ("be_on", "be_r", "sl_on", "sl_r") if k in b}))


@app.post("/api/paper/trail")
async def paper_trail(request: Request):
    return await _paper(request, lambda b: engine.set_trail(b))


@app.post("/api/paper/rules")
async def paper_rules(request: Request):
    return await _paper(request, lambda b: engine.set_rules(b))


@app.post("/api/paper/ticket")
async def paper_ticket(request: Request):
    return await _paper(request, lambda b: engine.set_ticket(b))


@app.post("/api/paper/reset")
async def paper_reset(request: Request):
    def go(b):
        if b.get("confirm") != "RESET":
            raise Refused("type RESET to confirm")
        engine.reset(float(b.get("capital") or engine.rules["size"]))
    return await _paper(request, go)


@app.get("/api/paper/history")
async def paper_history(request: Request, days: int = 0):
    _need(request)
    rows = engine.history
    if days:
        cut = time.time() - days * 86400
        rows = [h for h in rows if h["closed"] >= cut]
    return {"ok": True, "rows": rows[::-1]}


@app.get("/api/paper/history.csv")
async def paper_csv(request: Request):
    _need(request)
    import csv
    import io
    f = io.StringIO()
    w = csv.writer(f)
    cols = ["id", "symbol", "side", "product", "lots", "qty", "avg_entry", "exit", "opened_ist", "closed_ist", "reason",
            "first_sl", "sl", "tp", "gross", "brokerage", "exchange", "clearing", "ctt_stt", "stamp", "sebi", "ipft",
            "gst", "charges_total", "net", "init_risk", "r", "best", "worst", "balance_after"]
    w.writerow(cols)
    fmt = lambda ts: time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts))
    for h in engine.history:
        c = h["charges"]
        w.writerow([h["id"], h["s"], "BUY" if h["side"] > 0 else "SELL", h["product"], h["lots"], h["qty"], h["avg"],
                    h["exit"], fmt(h["opened"]), fmt(h["closed"]), h["reason"], h["first_sl"], h["sl"], h["tp"],
                    h["gross"], c["brokerage"], c["exchange"], c["clearing"], c["tax"], c["stamp"], c["sebi"],
                    c["ipft"], c["gst"], c["total"], h["net"], h["init_risk"], h["r"], h["best"], h["worst"],
                    h["balance_after"]])
    from fastapi.responses import Response
    return Response(f.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="paper_trades.csv"'})


@app.get("/api/charges")
def charge_table(request: Request):
    _need(request)
    return {"ok": True, "as_of": charges.AS_OF, "rows": charges.table()}


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
                msg = await asyncio.wait_for(client.queue.get(), timeout=20)
                await socket.send_text(json.dumps(msg))
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
