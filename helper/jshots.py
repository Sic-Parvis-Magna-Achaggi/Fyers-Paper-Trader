"""Journal pictures (v0.27.0, roadmap item 4).

Each journal trade keeps a list of pictures, `t["shots"]` in journal.json:
  {id, kind, phase, tf, src, at, w, h, bytes, ext, name, tg}
  kind  "server" = drawn here with Pillow from the user's own Fyers candles, at entry and at exit (no page needed)
        "chart"  = the open chart's own picture (indicators, drawings), sent by a page that had this contract on screen
        "upload" = your own picture (file, drag or paste), labelled by timeframe
  phase "entry" / "exit" (server and chart pictures), None for uploads
  tg    the Telegram backup copy: {msg, chat, at} once sent, {err, at, n} while it fails
Files: u/<user>/jshots/<trade key>/<id>.<ext> (+ <id>_t.jpg, a small copy for the list).

One worker thread does the slow parts one at a time (drawing: a Fyers history request on the user's own budget, which
queues; Telegram: one upload at a time). Journal settings `shots` = DEFAULTS (Journal › Settings › Pictures)."""
import copy
import datetime as dt
import heapq
import io
import itertools
import logging
import math
import os
import re
import secrets
import shutil
import threading
import time
import urllib.error
import urllib.request
import json

from . import store

log = logging.getLogger("jshots")
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

TFS = ["1m", "2m", "3m", "5m", "10m", "15m", "20m", "30m", "45m", "1h", "2h", "3h", "4h", "1D", "1W", "1M", "Context"]
RES_LABEL = {"1": "1m", "2": "2m", "3": "3m", "5": "5m", "10": "10m", "15": "15m", "20": "20m", "30": "30m", "45": "45m",
             "60": "1h", "120": "2h", "180": "3h", "240": "4h", "D": "1D", "1D": "1D"}
TF_RE = re.compile(r"^\d{1,4}(m|h|D|W|M)$")


def tf_ok(tf: str) -> bool:
    return tf in TFS or bool(TF_RE.match(tf or ""))


DRAW_RES = ["1", "2", "3", "5", "10", "15", "30", "60", "120", "240", "D"]
DEFAULTS = {"auto": False,       # draw a picture on the server at every entry and exit (off since v0.29.0: the
                                 # trade replay shows each trade on its recorded chart instead; owner, 1 Nov)
            "res": "5",          # ...on this timeframe (Fyers resolution)
            "bars": 120,         # ...this many candles
            "chart": False,      # ask an open chart of the contract for its own picture at entry and exit
            "tg": False,         # send a backup copy of every picture to Telegram
            "tg_chat": "",       # ...to this chat / channel (the bot is the one in Settings › Telegram alerts)
            "tg_chat_live": "",  # Live trades' pictures to this one instead (v0.33.1, owner 5 Nov); empty = the chat above
            "tg_since": 0}       # when the backup was turned on (or a chat changed): older pictures go only when asked
MAX_BYTES = 10 * 1024 * 1024
DELAY = 3.0                      # seconds after the fill / close before drawing (Fyers' candle for that minute)
TG_BACKOFF = [60, 300, 900, 3600]
CHAT_RE = re.compile(r"^(-?\d{3,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$")


# ---------------------------------------------------------------- settings
def chat_for(c: dict, t: dict) -> str:
    """The Telegram chat for this trade's pictures: Live trades to the Live channel when one is set (v0.33.1), everything
    else to the journal's chat. "" = this trade's pictures aren't copied (backup off, or no chat for its kind)."""
    if not c.get("tg"):
        return ""
    if (t or {}).get("mode") == "live" and c.get("tg_chat_live"):
        return c["tg_chat_live"]
    return c.get("tg_chat") or ""


def tg_on(c: dict) -> bool:
    return bool(c.get("tg") and (c.get("tg_chat") or c.get("tg_chat_live")))


def review_chat(c: dict) -> str:
    """The weekly review covers every account: the journal's chat (the Live channel if that's the only one)."""
    return (c.get("tg_chat") or c.get("tg_chat_live") or "") if c.get("tg") else ""


def cfg(settings: dict) -> dict:
    out = dict(DEFAULTS)
    sh = (settings or {}).get("shots") or {}
    for k, v in sh.items():
        if k in DEFAULTS:
            out[k] = v
    if not sh.get("v29"):                 # settings saved before v0.29.0: automatic pictures off once (owner, 1 Nov);
        out["auto"] = out["chart"] = False    # turning them back on in Settings saves the v29 mark
    return out


def clean_cfg(b: dict, old: dict) -> dict:
    out = {k: v for k, v in (old or {}).items() if k in DEFAULTS}
    if not (old or {}).get("v29"):            # (the one-time switch-off above, made permanent)
        out["auto"] = out["chart"] = False
    out["v29"] = True
    for k in ("auto", "chart", "tg"):
        if k in b:
            out[k] = bool(b[k])
    if "res" in b:
        if str(b["res"]) not in DRAW_RES:
            raise ValueError("picture timeframe: one of " + ", ".join(RES_LABEL[r] for r in DRAW_RES))
        out["res"] = str(b["res"])
    if "bars" in b:
        try:
            n = int(float(b["bars"]))
        except (TypeError, ValueError):
            raise ValueError("candles: a number")
        if not 30 <= n <= 400:
            raise ValueError("candles: between 30 and 400")
        out["bars"] = n
    for k in ("tg_chat", "tg_chat_live"):
        if k in b:
            c = str(b[k] or "").strip()
            if c and not CHAT_RE.match(c):
                raise ValueError(("Live trades' channel" if k == "tg_chat_live" else "Telegram chat")
                                 + ": a number like -1001234567890, or @channelname")
            out[k] = c
    if out.get("tg") and (not (old or {}).get("tg") or out.get("tg_chat") != (old or {}).get("tg_chat")
                          or out.get("tg_chat_live", "") != (old or {}).get("tg_chat_live", "")):
        out["tg_since"] = time.time()
    return out


# ---------------------------------------------------------------- files
def _safe(key: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", key)[:120]


def folder(uid: str, key: str) -> str:
    return f"u/{uid}/jshots/{_safe(key)}"


def file_of(uid: str, key: str, sh: dict, thumb: bool = False) -> str:
    name = f"{sh['id']}_t.jpg" if thumb else f"{sh['id']}.{sh.get('ext') or 'png'}"
    return str(store.path(f"{folder(uid, key)}/{name}"))


def new_id() -> str:
    return "p" + secrets.token_hex(6)


MIME = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp", "gif": "image/gif"}


def sniff(data: bytes) -> str | None:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    return None


def image_size(data: bytes):
    try:
        from PIL import Image
        with Image.open(io.BytesIO(data)) as im:
            im.verify()
        with Image.open(io.BytesIO(data)) as im:
            return im.size
    except ImportError:
        return (None, None)
    except Exception:
        raise ValueError("that file isn't a picture this app can read")


def write(uid: str, key: str, sh: dict, data: bytes) -> None:
    p = file_of(uid, key, sh)
    tmp = p + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.chmod(tmp, 0o600)
    os.replace(tmp, p)


def thumb(uid: str, key: str, sh: dict) -> str | None:
    """A small JPEG copy for the trade list (made the first time it's asked for). None without Pillow."""
    t = file_of(uid, key, sh, True)
    if os.path.exists(t):
        return t
    try:
        from PIL import Image
        with Image.open(file_of(uid, key, sh)) as im:
            im.seek(0)
            im = im.convert("RGB")
            im.thumbnail((480, 300))
            im.save(t, "JPEG", quality=80)
        os.chmod(t, 0o600)
        return t
    except Exception as e:
        log.info("thumbnail %s: %s", sh.get("id"), e)
        return None


def remove_files(uid: str, key: str, sh: dict) -> None:
    for th in (False, True):
        try:
            os.remove(file_of(uid, key, sh, th))
        except OSError:
            pass


def usage(uid: str) -> dict:
    root = store.path(f"u/{uid}/jshots/x").parent
    n = size = 0
    for dp, _, fs in os.walk(root):
        for f in fs:
            if not f.endswith(("_t.jpg", ".tmp")):
                n += 1
            try:
                size += os.path.getsize(os.path.join(dp, f))
            except OSError:
                pass
    return {"files": n, "mb": round(size / 1e6, 1)}


def label(sh: dict) -> str:
    if sh["kind"] == "upload":
        return sh.get("tf") or "Context"
    pre = "Chart " if sh["kind"] == "chart" else ""
    return f"{pre}{sh.get('tf') or ''} · {'entry' if sh.get('phase') == 'entry' else 'exit'}".strip(" ·")


def order_key(sh: dict):
    ph = {"entry": 0, "exit": 2}.get(sh.get("phase"), 1)
    kind = {"server": 0, "chart": 1, "upload": 2}.get(sh["kind"], 3)
    tf = TFS.index(sh["tf"]) if sh.get("tf") in TFS else 99
    return (ph, kind, tf, sh.get("at") or 0)


# ---------------------------------------------------------------- the worker (drawing and Telegram, one at a time)
_q: list = []                    # heap of (due, seq, job)
_cv = threading.Condition()
_seq = itertools.count()
_thread = None
_queued: set = set()             # jobs waiting (so a job isn't queued twice)


def _start():
    global _thread
    if _thread and _thread.is_alive():
        return
    _thread = threading.Thread(target=_run, name="jshots", daemon=True)
    _thread.start()


def queue(job: tuple, delay: float = 0.0) -> bool:
    with _cv:
        if job in _queued:
            return False
        _queued.add(job)
        heapq.heappush(_q, (time.time() + delay, next(_seq), job))
        _cv.notify()
    _start()
    return True


def pending() -> int:
    with _cv:
        return len(_q)


def wait_idle(timeout: float = 30) -> bool:
    """Tests: wait until nothing is queued or running."""
    end = time.time() + timeout
    while time.time() < end:
        with _cv:
            if not _q and not _busy[0]:
                return True
        time.sleep(0.1)
    return False


_busy = [False]


def _run():
    while True:
        with _cv:
            while not _q or _q[0][0] > time.time():
                _cv.wait(timeout=None if not _q else max(0.05, _q[0][0] - time.time()))
            _, _, job = heapq.heappop(_q)
            _queued.discard(job)
            _busy[0] = True
        try:
            if job[0] == "draw":
                _job_draw(*job[1:])
            elif job[0] == "tg":
                _job_tg(*job[1:])
            elif job[0] == "tgdel":
                _job_tgdel(*job[1:])
        except Exception as e:
            log.exception("journal picture job %s: %s", job[:3], e)
        finally:
            _busy[0] = False


def _journal(uid):
    from . import journal
    return journal.get(uid)


def _notify(uid):
    from . import journal
    if journal.on_change:
        try:
            journal.on_change(uid)
        except Exception:
            pass


# ---------------------------------------------------------------- entry / exit (journal.on_trade calls this)
def phase(urt, key: str, ph: str) -> None:
    """A trade just opened (ph "entry") or closed (ph "exit"): draw the server picture and ask open charts for theirs."""
    j = _journal(urt.uid)
    c = cfg(j.d["settings"])
    t = j.d["trades"].get(key)
    if not t:
        return
    if c["auto"]:
        queue(("draw", urt.uid, key, ph, 0), DELAY)
    if c["chart"]:
        msg = {"jshot": {"id": key, "phase": ph, "s": t["s"], "acct": t["acct"]}}
        loop = getattr(urt.feed, "loop", None)
        try:
            if loop and loop.is_running():
                loop.call_soon_threadsafe(urt.feed.broadcast, msg)
        except Exception as e:
            log.warning("picture request: %s", e)


def has(t: dict, kind: str, ph: str | None = None, tf: str | None = None) -> bool:
    return any(s["kind"] == kind and (ph is None or s.get("phase") == ph) and (tf is None or s.get("tf") == tf)
               for s in t.get("shots") or [])


def draw_now(uid: str, key: str, ph: str) -> None:
    """Draw (again) by hand: the trade card's button. Replaces that phase's earlier server picture."""
    queue(("draw", uid, key, ph, 1), 0)


def _job_draw(uid, key, ph, manual, tries=0):
    from . import rt
    urt = rt.RT.get(uid)
    j = _journal(uid)
    with j.lock:
        t = copy.deepcopy(j.d["trades"].get(key))
    if not t or urt is None:
        return
    if ph == "exit" and t["status"] != "closed":
        return
    c = cfg(j.d["settings"])
    if not manual and has(t, "server", ph):
        return
    res = c["res"]
    try:
        rows, note = candles_for(urt, t, res, ph, c["bars"])
        png, w, h = render(t, rows, res, ph, c["bars"], note)
    except Exception as e:
        msg = str(e) or e.__class__.__name__
        log.warning("[%s] journal picture %s %s: %s", getattr(urt, "label", uid), key, ph, msg)
        j.shot_error(key, ph, msg)
        if not manual and tries < 2:                    # Fyers busy / not logged in yet: try again in a few minutes
            queue(("draw", uid, key, ph, 0, tries + 1), 120 * (tries + 1))
        _notify(uid)
        return
    sh = {"id": new_id(), "kind": "server", "phase": ph, "tf": RES_LABEL.get(res, res), "src": "server", "at": time.time(),
          "w": w, "h": h, "bytes": len(png), "ext": "png", "name": f"{_safe(t['s'].split(':')[-1])}_{ph}_{RES_LABEL.get(res, res)}.png"}
    write(uid, key, sh, png)
    old = j.add_shot(key, sh, replace=("server", ph))
    for o in old:
        forget(uid, key, o)
    _notify(uid)
    after_add(uid, key, sh)


def after_add(uid: str, key: str, sh: dict) -> None:
    """A picture was added: the Telegram backup copy, if it's on."""
    j = _journal(uid)
    c = cfg(j.d["settings"])
    if chat_for(c, j.d["trades"].get(key) or {}):
        queue(("tg", uid, key, sh["id"], 0), 0.5)


def forget(uid: str, key: str, sh: dict) -> None:
    """A picture was deleted or replaced: its files, and its Telegram copy."""
    remove_files(uid, key, sh)
    tg = sh.get("tg") or {}
    if tg.get("msg"):
        queue(("tgdel", uid, tg.get("chat"), tg["msg"]), 0.5)


# ---------------------------------------------------------------- candles for a server picture
def candles_for(urt, t: dict, res: str, ph: str, bars: int):
    """The user's own Fyers candles around the trade: [[t, o, h, l, c, v], ...] and a note (or "")."""
    from . import candles as cs, fyers_link
    sec = fyers_link.RES.get(res, 300)
    t0 = t.get("opened") or time.time()
    t1 = (t.get("closed") or time.time()) if ph == "exit" else t0
    span_days = (time.time() - t0) / 86400 + 1
    per_day = max(1, 22500 // sec) if sec < 86400 else 1         # ~6h15 of NSE trading a day (MCX has more)
    days = int(math.ceil(span_days + bars / per_day * 1.6 + 3)) if sec < 86400 else int(bars * 1.5 + span_days + 5)
    days = max(3, min(days, 400))
    note = ""
    try:
        rows = cs.get(urt.link, t["s"], res, days)
    except Exception as e:
        rows = cs.saved(urt.link.dir, t["s"], res, int(time.time() - days * 86400))
        if not rows:
            raise RuntimeError(f"no candles from Fyers ({e})")
        note = "saved candles (Fyers didn't answer)"
    rows = [r for r in rows if r[0] <= t1 + sec * 6]
    if not rows:
        raise RuntimeError("Fyers has no candles for this contract around the trade")
    return rows, note


# ---------------------------------------------------------------- drawing (Pillow)
_FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
_fonts: dict = {}


def font(size: int, bold: bool = False):
    from PIL import ImageFont
    k = (size, bold)
    if k not in _fonts:
        f = None
        for n in (("DejaVuSansMono-Bold.ttf",) if bold else ()) + ("DejaVuSansMono.ttf",):
            try:
                f = ImageFont.truetype(os.path.join(_FONT_DIR, n), size)
                break
            except Exception:
                continue
        if f is None:
            try:
                f = ImageFont.load_default(size)
            except TypeError:
                f = ImageFont.load_default()
        _fonts[k] = f
    return _fonts[k]


C = {"bg": (15, 18, 22), "panel": (22, 26, 32), "grid": (34, 39, 47), "line": (38, 44, 53), "text": (230, 233, 238),
     "muted": (139, 148, 163), "up": (34, 160, 107), "down": (226, 72, 61), "accent": (79, 140, 255),
     "warn": (217, 154, 30), "exit": (240, 240, 240)}


def _num(x, tick=None) -> str:
    if x is None:
        return "–"
    dp = 2
    if tick:
        s = f"{tick:.10f}".rstrip("0")
        dp = max(0, len(s.split(".")[1])) if "." in s else 0
        dp = max(dp, 2) if tick < 1 else dp
    v = f"{abs(x):,.{dp}f}"
    return ("-" if x < 0 else "") + v


def _money(x, signed=True) -> str:
    if x is None:
        return "–"
    s = f"₹{abs(x):,.2f}"
    return (("+" if x > 0 else "−" if x < 0 else "") if signed else ("−" if x < 0 else "")) + s


def _hm(ts) -> str:
    return dt.datetime.fromtimestamp(ts, IST).strftime("%H:%M")


def _when(ts) -> str:
    return dt.datetime.fromtimestamp(ts, IST).strftime("%-d %b %Y %H:%M:%S IST")


def _nice(span: float, n: int = 6) -> float:
    if span <= 0:
        return 1.0
    raw = span / n
    p = 10 ** math.floor(math.log10(raw))
    for m in (1, 2, 2.5, 5, 10):
        if raw <= m * p:
            return m * p
    return 10 * p


def _dash(d, xy0, xy1, fill, width=1, on=6, off=4):
    (x0, y0), (x1, y1) = xy0, xy1
    L = math.hypot(x1 - x0, y1 - y0)
    if L < 1:
        return
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    p = 0.0
    while p < L:
        q = min(L, p + on)
        d.line([(x0 + ux * p, y0 + uy * p), (x0 + ux * q, y0 + uy * q)], fill=fill, width=width)
        p = q + off


def render(t: dict, rows: list, res: str, ph: str, bars: int = 120, note: str = ""):
    """The server picture of one trade: PNG bytes, width, height."""
    from PIL import Image, ImageDraw
    from . import fyers_link, symbols
    sec = fyers_link.RES.get(res, 300)
    W, H = 1280, 720
    side = 1 if (t.get("side") or 1) > 0 else -1
    row = symbols.get(t["s"]) or {}
    tick = row.get("tick")
    t_open = t.get("opened") or rows[-1][0]
    t_close = t.get("closed") if ph == "exit" else None
    # which candles: entry = the last `bars` up to the entry candle; exit = from before the entry to the exit
    ts = [r[0] for r in rows]

    def idx_at(T):
        i = None
        for k, x in enumerate(ts):
            if x <= T:
                i = k
            else:
                break
        return i
    ie = idx_at(t_open)
    if ph == "exit":
        ix = idx_at(t_close) if t_close else len(rows) - 1
        ix = len(rows) - 1 if ix is None else ix
        lo_i = max(0, min((ie if ie is not None else ix) - 25, ix - bars + 6))
        hi_i = min(len(rows) - 1, ix + 4)
    else:
        end = ie if ie is not None else len(rows) - 1
        lo_i, hi_i = max(0, end - bars + 1), end
    view = rows[lo_i:hi_i + 1]
    if not view:
        raise RuntimeError("no candles in the trade's window")
    n = len(view)
    right_pad = 8
    PL, PR, PT, PB = 14, 100, 70, 84            # plot margins (price axis right, header top, time axis + footer bottom)
    pw, phh = W - PL - PR, H - PT - PB
    slot = pw / (max(n, 40) + right_pad)
    x0 = PL

    def X(i):
        return x0 + (i + 0.5) * slot

    def X_time(T):
        """x of a moment: the candle it falls in, or past the last candle at the candle spacing."""
        if T is None:
            return None
        if T < view[0][0]:
            return None
        k = None
        for i, r in enumerate(view):
            if r[0] <= T:
                k = i
            else:
                break
        if k == n - 1 and T >= view[-1][0] + sec:
            k = min(n - 1 + right_pad - 1, n - 1 + int((T - view[-1][0]) // sec))
        return X(k)
    entries = t.get("entries") or ([{"t": t_open, "price": t.get("avg"), "qty": t.get("qty")}] if t.get("avg") else [])
    if ph == "entry":                            # at entry only the first fill had happened
        entries = [e for e in entries if (e.get("t") or t_open) <= t_open + 2] or entries[:1]
    closes = sorted(t.get("closes") or [], key=lambda c: c.get("t") or 0) if ph == "exit" else []
    if ph == "exit" and not closes and t.get("exit") is not None:
        closes = [{"t": t_close, "exit": t.get("exit")}]
    own_sl = (t.get("basis") in (None, "self"))
    lines = []                                   # (price, colour, label, style)
    if t.get("avg") is not None:
        lines.append((t["avg"], C["accent"], "Entry", "solid"))
    if own_sl:
        fs, sl, tp = t.get("first_sl"), t.get("sl"), t.get("tp")
        if fs is not None and (sl is None or abs(fs - sl) > 1e-9):
            lines.append((fs, C["down"], "1st SL", "dot"))
        if sl is not None:
            lines.append((sl, C["down"], "SL" if ph == "entry" else "Last SL", "dash"))
        if tp is not None:
            lines.append((tp, C["up"], "TP", "dash"))
    if ph == "exit" and t.get("exit") is not None:
        lines.append((t["exit"], C["exit"], "Exit", "solid"))
    pr = [r[2] for r in view] + [r[3] for r in view] + [p for p, *_ in lines] + [e.get("price") for e in entries if e.get("price") is not None]
    lo, hi = min(pr), max(pr)
    if hi - lo < 1e-9:
        hi, lo = hi + 1, lo - 1
    pad = (hi - lo) * 0.07
    lo, hi = lo - pad, hi + pad

    def Y(p):
        return PT + (hi - p) / (hi - lo) * phh

    img = Image.new("RGB", (W, H), C["bg"])
    d = ImageDraw.Draw(img, "RGBA")
    f12, f13, f14, f11 = font(12), font(13), font(14), font(11)
    fb16, fb12 = font(18, True), font(12, True)
    # grid and price axis
    step = _nice(hi - lo, 7)
    p = math.ceil(lo / step) * step
    while p <= hi:
        y = Y(p)
        d.line([(PL, y), (W - PR, y)], fill=C["grid"], width=1)
        d.text((W - PR + 8, y - 7), _num(p, tick if step < 1 else None), font=f11, fill=C["muted"])
        p += step
    d.line([(W - PR, PT), (W - PR, PT + phh)], fill=C["line"], width=1)
    # time axis: about one label every 120 px; a new day shows its date
    every = max(1, int(round(120 / slot)))
    last_day = None
    day_x = [X(i) for i, r in enumerate(view) if i > 0 and sec < 86400 and
             dt.datetime.fromtimestamp(r[0], IST).date() != dt.datetime.fromtimestamp(view[i - 1][0], IST).date()]
    for i, r in enumerate(view):
        day = dt.datetime.fromtimestamp(r[0], IST).date()
        new_day = day != last_day
        if i % every == 0 or (new_day and sec < 86400 and i > 0):
            x = X(i)
            if not new_day and any(abs(x - dx) < 70 for dx in day_x):
                last_day = day
                continue
            if sec >= 86400:
                txt = dt.datetime.fromtimestamp(r[0], IST).strftime("%-d %b")
            else:
                txt = dt.datetime.fromtimestamp(r[0], IST).strftime("%-d %b" if new_day else "%H:%M")
            d.line([(x, PT), (x, PT + phh)], fill=C["grid"] + (110,), width=1)
            d.text((x - len(txt) * 3.4, PT + phh + 6), txt, font=f11, fill=C["text"] if new_day else C["muted"])
        last_day = day
    # the trade's zone (exit): entry to exit, shaded by the result
    if ph == "exit" and t.get("avg") is not None and t.get("exit") is not None:
        xa, xb = X_time(t_open), X_time(t_close)
        xa = PL if xa is None else xa
        xb = W - PR if xb is None else xb
        win = (t.get("net") or 0) >= 0
        col = (C["up"] if win else C["down"]) + (42,)
        ya, yb = Y(t["avg"]), Y(t["exit"])
        d.rectangle([xa, min(ya, yb), max(xa + 2, xb), max(ya, yb)], fill=col)
    # candles
    bw = max(1.0, slot * 0.68)
    for i, r in enumerate(view):
        _, o, h, l, c = r[:5]
        col = C["up"] if c >= o else C["down"]
        x = X(i)
        d.line([(x, Y(h)), (x, Y(l))], fill=col, width=1)
        yo, yc = Y(o), Y(c)
        top, bot = min(yo, yc), max(yo, yc)
        if bot - top < 1:
            bot = top + 1
        d.rectangle([x - bw / 2, top, x + bw / 2, bot], fill=col)
    # trade lines with labels on the price axis
    xs = X_time(t_open)
    xs = PL if xs is None else xs
    xe = (X_time(t_close) if ph == "exit" else None) or (W - PR)
    used, used_nm = [], []
    for price, col, name, style in lines:
        y = Y(price)
        if ph == "entry":                        # the plan: lines across the chart, as on the trading screen
            a, b = PL, W - PR
        elif name == "Exit":
            a, b = (xe if xe else xs), W - PR
        else:
            a, b = xs, xe
        if style == "solid":
            d.line([(a, y), (b, y)], fill=col, width=2)
        else:
            _dash(d, (a, y), (b, y), col, 2 if style == "dash" else 1, *((7, 5) if style == "dash" else (2, 4)))
        txt = _num(price, tick)
        yy = y - 9
        while any(abs(yy - u) < 18 for u in used):
            yy += 18 if price < (hi + lo) / 2 else -18
        used.append(yy)
        d.rectangle([W - PR + 2, yy, W - 4, yy + 18], fill=col)
        d.text((W - PR + 6, yy + 2), txt, font=f12, fill=(10, 12, 16) if col in (C["exit"], C["warn"]) else (255, 255, 255))
        tw = d.textlength(name, font=f11)
        nx = (a + 4) if name != "Exit" else (W - PR - tw - 8)
        ny = y - 16
        while any(abs(ny - u[1]) < 14 and abs(nx - u[0]) < 90 for u in used_nm):
            ny += 15 if price < (hi + lo) / 2 else -15
        used_nm.append((nx, ny))
        d.rectangle([nx - 2, ny, nx + tw + 2, ny + 14], fill=C["bg"] + (200,))
        d.text((nx, ny), name, font=f11, fill=col)
    # markers: each entry (and add), each exit
    for e in entries:
        if e.get("price") is None:
            continue
        x = X_time(e.get("t") or t_open)
        if x is None:
            continue
        y = Y(e["price"])
        col = C["up"] if side > 0 else C["down"]
        if side > 0:
            d.polygon([(x, y + 3), (x - 7, y + 15), (x + 7, y + 15)], fill=col, outline=(255, 255, 255))
        else:
            d.polygon([(x, y - 3), (x - 7, y - 15), (x + 7, y - 15)], fill=col, outline=(255, 255, 255))
        d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(255, 255, 255))
    for cl in closes:
        if cl.get("exit") is None:
            continue
        x = X_time(cl.get("t") or t_close)
        if x is None:
            continue
        y = Y(cl["exit"])
        d.polygon([(x, y - 7), (x + 7, y), (x, y + 7), (x - 7, y)], fill=C["exit"], outline=(20, 20, 20))
    # header
    d.rectangle([0, 0, W, 58], fill=C["panel"])
    d.line([(0, 58), (W, 58)], fill=C["line"])
    name = t["s"].split(":")[-1]
    lots = t.get("lots")
    prod = {"INTRADAY": "Intraday", "MARGIN": "Carry", "CNC": "Delivery"}.get(t.get("product") or "", t.get("product") or "")
    d.text((PL, 9), name, font=fb16, fill=C["text"])
    xo = PL + d.textlength(name, font=fb16) + 14
    sd = "BUY" if side > 0 else "SELL"
    tag = f" {sd} {lots if lots is not None else ''} lot{'' if lots == 1 else 's'} "
    tw = d.textlength(tag, font=fb12)
    d.rectangle([xo, 11, xo + tw, 31], fill=C["up"] if side > 0 else C["down"])
    d.text((xo, 14), tag, font=fb12, fill=(255, 255, 255))
    xo += tw + 10
    d.text((xo, 14), prod, font=f13, fill=C["muted"])
    mode = "LIVE" if t.get("mode") == "live" else "Paper"
    when = _when(t_close if ph == "exit" and t_close else t_open)
    d.text((PL, 37), f"{mode} · {t.get('acct_name') or ''} · {'Closed' if ph == 'exit' else 'Opened'} {when}", font=f12,
           fill=C["down"] if mode == "LIVE" else C["muted"])
    badge = f" {'EXIT' if ph == 'exit' else 'ENTRY'} · {RES_LABEL.get(res, res)} "
    bw2 = d.textlength(badge, font=fb12)
    d.rectangle([W - 14 - bw2, 11, W - 14, 31], outline=C["accent"], width=1)
    d.text((W - 14 - bw2, 14), badge, font=fb12, fill=C["accent"])
    # footer: the money, net of every charge
    fy = H - PB + 30
    d.line([(0, fy - 8), (W, fy - 8)], fill=C["line"])
    parts = [f"Entry {_num(t.get('avg'), tick)}"]
    if own_sl:
        if t.get("first_sl") is not None:
            parts.append(f"1st SL {_num(t['first_sl'], tick)}" + (f" (risk {_money(t['init_risk'], False)} net)" if t.get("init_risk") else ""))
        if t.get("tp") is not None:
            parts.append(f"TP {_num(t['tp'], tick)}" + (f" ({t['planned_r']:+.2f}R planned)" if t.get("planned_r") is not None else ""))
    else:
        parts.append(f"SL / TP on {(t.get('ref') or 'the future').split(':')[-1]} (not this chart)")
    d.text((PL, fy), "  ·  ".join(parts), font=f13, fill=C["text"])
    if ph == "exit":
        net, r = t.get("net"), t.get("r")
        held = (t_close - t_open) if t_close and t_open else None
        hs = "" if held is None else (f"{int(held // 3600)} h {int(held % 3600 // 60)} m" if held >= 3600 else f"{int(held // 60)} m {int(held % 60)} s")
        line2 = [f"Exit {_num(t.get('exit'), tick)}", f"net {_money(net)}" + (f"  {r:+.2f}R" if r is not None else ""),
                 f"charges {_money(t.get('charges'), False)}", f"held {hs}" if hs else ""]
        d.text((PL, fy + 22), "  ·  ".join(x for x in line2 if x), font=f14,
               fill=C["up"] if (net or 0) > 0 else C["down"] if (net or 0) < 0 else C["text"])
    else:
        d.text((PL, fy + 22), "₹ figures are net of every charge (entry and exit).", font=f12, fill=C["muted"])
    foot = "Fyers Trade Manager · drawn on the server from your Fyers candles" + (f" · {note}" if note else "")
    d.text((W - 14 - d.textlength(foot, font=f11), H - 18), foot, font=f11, fill=C["muted"])
    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    return out.getvalue(), W, H


# ---------------------------------------------------------------- Telegram backup copy
def caption(t: dict, sh: dict) -> str:
    from . import telegram as tgm
    e = tgm.esc
    side = "BUY" if (t.get("side") or 1) > 0 else "SELL"
    lots = t.get("lots")
    lines = [f"📈 <b>{e(t['s'].split(':')[-1])}</b> [{e(label(sh))}] · {side} {lots if lots is not None else ''} lot{'' if lots == 1 else 's'}",
             f"{'LIVE' if t.get('mode') == 'live' else 'Paper'} · {e(t.get('acct_name') or '')} · opened {e(_when(t['opened'])) if t.get('opened') else '–'}"]
    own = t.get("basis") in (None, "self")
    px = f"Entry {_num(t.get('avg'))}"
    if own and t.get("first_sl") is not None:
        px += f" · SL {_num(t.get('first_sl'))}"
    if own and t.get("tp") is not None:
        px += f" · TP {_num(t.get('tp'))}"
    lines.append(px)
    if t.get("status") == "closed":
        lines.append(f"Exit {_num(t.get('exit'))} · net {_money(t.get('net'))}" + (f" · {t['r']:+.2f}R" if t.get("r") is not None else ""))
    if sh["kind"] == "upload":
        lines.append("Your picture")
    elif sh["kind"] == "chart":
        lines.append("The chart as you had it open")
    lines.append(f"🆔 {e(t['id'])}")
    return "\n".join(lines)[:1000]


def _multipart(fields: dict, fname: str, data: bytes, mime: str, field="document"):
    b = "----ftm" + secrets.token_hex(12)
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    out.write(f"--{b}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{fname}\"\r\nContent-Type: {mime}\r\n\r\n".encode())
    out.write(data)
    out.write(f"\r\n--{b}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={b}"


def send_file(tok: str, chat: str, data: bytes, fname: str, mime: str, cap: str, silent: bool = True) -> dict:
    """sendDocument (the picture as sent, full quality). Returns Telegram's message."""
    from . import telegram as tgm
    if not tok:
        raise tgm.TgError("no bot token")
    body, ctype = _multipart({"chat_id": chat, "caption": cap, "parse_mode": "HTML",
                              "disable_notification": "true" if silent else "false"}, fname, data, mime)
    url = f"{tgm.api_base()}/bot{tok}/sendDocument"
    for attempt in range(2):
        req = urllib.request.Request(url, data=body, headers={"Content-Type": ctype}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                j = json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            try:
                j = json.loads(e.read().decode() or "{}")
            except Exception:
                raise tgm.TgError(f"Telegram HTTP {e.code}")
        except Exception as e:
            raise tgm.TgError(f"couldn't reach Telegram ({e.__class__.__name__})")
        if j.get("ok"):
            return j.get("result") or {}
        if j.get("error_code") == 429 and attempt == 0:
            time.sleep(min(15, (j.get("parameters") or {}).get("retry_after") or 3) + 0.3)
            continue
        if j.get("error_code") == 401:
            raise tgm.TgError("Telegram doesn't know the bot token (Settings › Telegram alerts)")
        raise tgm.TgError(j.get("description") or f"error {j.get('error_code')}")
    raise tgm.TgError("Telegram is busy (too many requests)")


def tg_state(uid: str) -> dict:
    """For Journal › Settings: is a bot set up (Settings › Telegram alerts), and the last send / error."""
    from . import telegram as tgm
    s = tgm.load(uid)
    return {"bot_set": bool(s.get("token")), "bot": s.get("bot") or "", "alerts_chat": s.get("chat") or "",
            "alerts_title": s.get("chat_title") or "", "last": store.load(f"u/{uid}/tg_journal.json", {})}


def _tg_note(uid, **kw):
    st = store.load(f"u/{uid}/tg_journal.json", {})
    st.update(kw)
    store.save(f"u/{uid}/tg_journal.json", st)


def _job_tg(uid, key, sid, tries=0):
    from . import telegram as tgm
    j = _journal(uid)
    c = cfg(j.d["settings"])
    with j.lock:
        t = copy.deepcopy(j.d["trades"].get(key))
    chat = chat_for(c, t)
    if not chat:
        return
    sh = next((s for s in (t or {}).get("shots") or [] if s["id"] == sid), None)
    if not t or not sh or (sh.get("tg") or {}).get("msg"):
        return
    tok = tgm.token(tgm.load(uid))
    try:
        with open(file_of(uid, key, sh), "rb") as f:
            data = f.read()
        res = send_file(tok, chat, data, sh.get("name") or f"{sid}.{sh.get('ext', 'png')}",
                        MIME.get(sh.get("ext") or "png", "image/png"), caption(t, sh))
        j.set_shot_tg(key, sid, {"msg": res.get("message_id"), "chat": chat, "at": time.time()})
        _tg_note(uid, t=time.time(), error=None, n=store.load(f"u/{uid}/tg_journal.json", {}).get("n", 0) + 1)
    except OSError:
        j.set_shot_tg(key, sid, {"err": "the picture's file is missing on the server", "at": time.time(), "n": tries + 1})
        _notify(uid)
        return
    except tgm.TgError as e:
        msg = str(e)
        j.set_shot_tg(key, sid, {"err": msg, "at": time.time(), "n": tries + 1})
        _tg_note(uid, error={"t": time.time(), "msg": msg})
        if tries < len(TG_BACKOFF) and tok and "doesn't know" not in msg:
            queue(("tg", uid, key, sid, tries + 1), TG_BACKOFF[tries])
    _notify(uid)


def _job_tgdel(uid, chat, msg):
    from . import telegram as tgm
    try:
        tgm.call(tgm.token(tgm.load(uid)), "deleteMessage", {"chat_id": chat, "message_id": msg})
    except Exception as e:
        log.info("Telegram copy %s not deleted: %s", msg, e)


def tg_send_missing(uid: str, since: float | None = None) -> int:
    """Queue a Telegram copy of every picture that hasn't been sent: all of them (Journal › Settings button), or at
    start-up only those added since the backup was turned on (`since`)."""
    j = _journal(uid)
    c = cfg(j.d["settings"])
    if not tg_on(c):
        return 0
    n = 0
    with j.lock:
        items = [(k, s["id"]) for k, t in j.d["trades"].items() if chat_for(c, t) for s in t.get("shots") or []
                 if not (s.get("tg") or {}).get("msg") and (since is None or (s.get("at") or 0) >= since)]
    for i, (k, sid) in enumerate(items):
        if queue(("tg", uid, k, sid, 0), 0.5 + i * 1.2):     # Telegram: about one upload a second
            n += 1
    return n


def tg_test(uid: str, chat: str, live: bool = False) -> None:
    from . import telegram as tgm
    tok = tgm.token(tgm.load(uid))
    tgm.send(tok, chat, "✅ <b>Journal backup</b>: copies of your " + ("<b>Live</b> trades' " if live else "journal ")
             + "pictures will come to this chat.", silent=True)


def startup(uids) -> None:
    """At start-up: Telegram copies that didn't go before a restart (pictures added since the backup was turned on)."""
    for uid in uids:
        try:
            c = cfg(_journal(uid).d["settings"])
            if tg_on(c):
                tg_send_missing(uid, c.get("tg_since") or 0)
        except Exception as e:
            log.warning("journal pictures start-up %s: %s", uid, e)


def pillow() -> bool:
    try:
        import PIL  # noqa: F401
        return True
    except ImportError:
        return False


def tg_review(uid: str, week: str, text: str) -> str:
    """The weekly review's summary in the journal's Telegram chat: posted once, edited in place after that.
    Returns "posted" / "edited" / "off" (backup off or no chat); raises TgError."""
    from . import telegram as tgm
    j = _journal(uid)
    c = cfg(j.d["settings"])
    chat = review_chat(c)
    if not chat:
        return "off"
    tok = tgm.token(tgm.load(uid))
    rv = j.d["reviews"].get(week) or {}
    msg = rv.get("msg") or {}
    text = text[:4000]
    if msg.get("id") and msg.get("chat") == chat:
        try:
            tgm.call(tok, "editMessageText", {"chat_id": chat, "message_id": msg["id"], "text": text,
                                              "disable_web_page_preview": True})
            return "edited"
        except tgm.TgError as e:
            if "not modified" in str(e).lower():
                return "edited"
            if not re.search(r"not found|can't be edited|MESSAGE_ID_INVALID", str(e), re.I):
                raise
    res = tgm.call(tok, "sendMessage", {"chat_id": chat, "text": text, "disable_web_page_preview": True,
                                        "disable_notification": True})
    j.set_review_msg(week, {"id": (res or {}).get("message_id"), "chat": chat})
    return "posted"
