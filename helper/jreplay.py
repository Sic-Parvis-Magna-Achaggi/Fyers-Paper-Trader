"""Trade replay (v0.29.0, roadmap 4c): what the chart looked like at a trade's entry and exit, and the trade on it.

At every entry and exit the server records the chart's set-up: contract, timeframe, chart type, Chart settings, every
indicator with its settings (prefs keys of one chart, as layouts keep them), a copy of each saved Pine script's code
and the contract's drawings as they were then. Nothing needs a page open.

Which chart:
- entry: the chart the order was placed from (the page sends its set-up with PLACE; kept in pending.json until the
  order fills, so a limit that fills at 2 a.m. still has it). Without one: the saved layout's chart for that contract.
- exit: the same layout chart as the entry when it still shows the contract, else the layout's chart for the
  contract, else the entry's set-up.

Storage (u/<user>/replay/): t/<trade>.json {entry, exit}; code/<sha1>.json (Pine code, shared by every snapshot that
has the same code); draw/<sha1>.json (a contract's drawings, shared the same way); pending.json.

The stop's path: the engine records every SL / TP move per position (Paper._path_scan, `path` on the position and its
history record; the journal keeps it on the trade). Trades from before that: rebuilt from the account's own log
(paper.json events: BE, each trail step, SL / TP edits, with their times), never estimated from candles."""
import copy
import hashlib
import json
import logging
import re
import time

from . import charges, store, symbols

log = logging.getLogger("helper.jreplay")

KEYS = ("cur", "tf2", "ctype", "chart", "indicators", "lgdMin0")
SETUP_BYTES = 300_000
PENDING_DAYS = 10


def now() -> float:
    return time.time()


def _d(uid: str) -> str:
    return f"u/{uid}/replay/"


def _fname(key: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", key)[:80]
    return safe + "-" + hashlib.sha1(key.encode()).hexdigest()[:8] + ".json"


def draw_file(udir: str, s: str) -> str:
    """The contract's drawings file (the same names as /api/drawings uses)."""
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", s)[:80]
    return udir + "drawings/" + safe + "-" + hashlib.sha1(s.encode()).hexdigest()[:8] + ".json"


def _put_blob(uid: str, kind: str, obj) -> str:
    """Content-addressed copy (code / drawings): the same content is stored once."""
    raw = json.dumps(obj, sort_keys=True, ensure_ascii=False)
    h = hashlib.sha1(raw.encode()).hexdigest()
    name = f"{_d(uid)}{kind}/{h}.json"
    if not store.path(name).exists():
        store.save(name, obj)
    return h


def _get_blob(uid: str, kind: str, h: str):
    if not h or not re.fullmatch(r"[0-9a-f]{40}", str(h)):
        return None
    return store.load(f"{_d(uid)}{kind}/{h}.json", None)


# ---------------------------------------------------------------- a chart's set-up
def clean_setup(x) -> dict | None:
    """One chart's set-up as the page / a layout holds it: only the chart keys, within a size limit."""
    if not isinstance(x, dict):
        return None
    out = {k: copy.deepcopy(x[k]) for k in KEYS if k in x and x[k] is not None}
    c = out.get("cur")
    if not isinstance(c, dict) or not c.get("s"):
        return None
    if not isinstance(out.get("indicators", []), list):
        out["indicators"] = []
    try:
        if len(json.dumps(out)) > SETUP_BYTES:
            return None
    except (TypeError, ValueError):
        return None
    return out


def _cur_for(s: str) -> dict:
    row = symbols.get(s) or {}
    return {"s": s, "d": row.get("d") or s, "tick": row.get("tick"), "lot": row.get("lot"), "mult": row.get("mult"),
            "sess": row.get("sess")}


def _layouts(uid: str) -> dict:
    d = store.load(f"u/{uid}/layouts.json", {"layouts": [], "active": ""})
    return d if isinstance(d, dict) and isinstance(d.get("layouts"), list) else {"layouts": [], "active": ""}


def _from_layouts(uid: str, s: str, want: dict | None = None) -> tuple:
    """(set-up, source, where) for contract s from the saved layouts / prefs; want = {lay, cell} tried first."""
    L = _layouts(uid)
    lays = L["layouts"]
    act = next((x for x in lays if x.get("id") == L.get("active")), None)
    if want:
        lay = next((x for x in lays if x.get("id") == want.get("lay")), None)
        try:
            c = (lay or {}).get("charts", [])[int(want.get("cell") or 0)]
        except (IndexError, TypeError, ValueError):
            c = None
        if c and (c.get("cur") or {}).get("s") == s:
            return clean_setup(c), "layout", {"lay": lay.get("id"), "cell": int(want.get("cell") or 0), "name": lay.get("name", "")}
    order = ([act] if act else []) + sorted([x for x in lays if x is not act], key=lambda x: -(x.get("updated") or 0))
    for lay in order:
        for i, c in enumerate(lay.get("charts") or []):
            if isinstance(c, dict) and (c.get("cur") or {}).get("s") == s:
                return clean_setup(c), "layout", {"lay": lay.get("id"), "cell": i, "name": lay.get("name", "")}
    prefs = store.load(f"u/{uid}/prefs.json", {})
    if (prefs.get("cur") or {}).get("s") == s:
        st = clean_setup(prefs)
        if st:
            return st, "prefs", None
    # no chart of this contract: the active chart's set-up on this contract
    base = None
    if act and act.get("charts"):
        base = act["charts"][0]
    base = dict(base or prefs or {})
    base["cur"] = _cur_for(s)
    st = clean_setup(base)
    return st, "other", ({"lay": act.get("id"), "cell": 0, "name": act.get("name", "")} if act else None)


def note_order(uid: str, aid: str, b: dict) -> None:
    """PLACE from a page: its chart's set-up, used when the order fills (the entry snapshot)."""
    try:
        st = clean_setup(b.get("setup"))
        s = str(b.get("s") or "")
        if not st or st["cur"]["s"] != s:
            return
        f = b.get("from") if isinstance(b.get("from"), dict) else None
        name = _d(uid) + "pending.json"
        p = store.load(name, {})
        t = now()
        p = {k: v for k, v in p.items() if isinstance(v, dict) and t - v.get("at", 0) < PENDING_DAYS * 86400}
        p[f"{aid}|{s}|{b.get('product') or ''}"] = {"setup": st, "at": t,
                                                  "from": {"lay": str(f.get("lay") or ""), "cell": int(f.get("cell") or 0)} if f else None}
        store.save(name, p)
    except Exception as ex:
        log.warning("replay: order set-up not kept: %s", ex)


def drop_pending(uid: str, aid: str, b: dict) -> None:
    """The order was refused: forget its set-up."""
    try:
        name = _d(uid) + "pending.json"
        p = store.load(name, {})
        if p.pop(f"{aid}|{b.get('s') or ''}|{b.get('product') or ''}", None) is not None:
            store.save(name, p)
    except Exception:
        pass


def _take_pending(uid: str, aid: str, s: str, product: str):
    name = _d(uid) + "pending.json"
    p = store.load(name, {})
    k = f"{aid}|{s}|{product or ''}"
    v = p.pop(k, None)
    if v is None:
        k2 = next((x for x in p if x.startswith(f"{aid}|{s}|")), None)      # (product changed on the way)
        v = p.pop(k2, None) if k2 else None
    if v is not None:
        store.save(name, p)
    return v


def _scripts(uid: str) -> list:
    d = store.load(f"u/{uid}/scripts.json", {"scripts": []})
    return d.get("scripts", []) if isinstance(d, dict) else []


def snapshot(uid: str, s: str, setup: dict, src: str, where) -> dict:
    """The set-up plus a copy of every saved Pine script's code (imports resolve the same way later) and the
    contract's drawings."""
    sc = []
    for x in _scripts(uid):
        if isinstance(x, dict) and isinstance(x.get("source"), str):
            sc.append({"id": x.get("id"), "name": x.get("name", ""),
                       "h": _put_blob(uid, "code", {"name": x.get("name", ""), "source": x["source"]})})
    dr = store.load(draw_file(f"u/{uid}/", s), {"items": []})
    items = dr.get("items", []) if isinstance(dr, dict) else []
    return {"at": now(), "src": src, "where": where, "chart": setup, "scripts": sc,
            "draw": _put_blob(uid, "draw", items) if items else None, "n_draw": len(items)}


def capture(urt, key: str, ph: str, t: dict) -> None:
    """A trade opened (ph "entry") or closed ("exit"): record the chart's set-up."""
    try:
        uid, s = urt.uid, t["s"]
        name = _d(uid) + "t/" + _fname(key)
        rec = store.load(name, {})
        if ph in rec:
            return
        if ph == "entry":
            pend = _take_pending(uid, t.get("acct", ""), s, t.get("product", ""))
            if pend and pend.get("setup"):
                where = pend.get("from")
                if where:
                    lay = next((x for x in _layouts(uid)["layouts"] if x.get("id") == where.get("lay")), None)
                    where = {**where, "name": (lay or {}).get("name", "")}
                st, src = pend["setup"], "order"
            else:
                st, src, where = _from_layouts(uid, s)
        else:
            ent = rec.get("entry") or {}
            st, src, where = _from_layouts(uid, s, ent.get("where") if ent.get("src") in ("order", "layout") else None)
            if src == "other" and ent.get("chart"):
                st, src, where = ent["chart"], "entry", ent.get("where")
        if not st:
            return
        rec[ph] = snapshot(uid, s, st, src, where)
        store.save(name, rec)
        idx = store.load(_d(uid) + "index.json", {})
        idx.setdefault(key, {})[ph] = rec[ph]["at"]
        store.save(_d(uid) + "index.json", idx)
        _IDX.pop(uid, None)
    except Exception as ex:
        log.exception("replay: %s snapshot of %s: %s", ph, key, ex)


_IDX = {}


def recorded(uid: str) -> set:
    """The trades with a recorded set-up (the journal marks them)."""
    if uid not in _IDX:
        _IDX[uid] = set(store.load(_d(uid) + "index.json", {}).keys())
    return _IDX[uid]


def load(uid: str, key: str) -> dict:
    return store.load(_d(uid) + "t/" + _fname(key), {})


def full(uid: str, snap: dict | None) -> dict | None:
    """A snapshot with its code and drawings put back in."""
    if not snap:
        return None
    out = {k: v for k, v in snap.items() if k not in ("scripts", "draw")}
    out["scripts"] = []
    for x in snap.get("scripts") or []:
        b = _get_blob(uid, "code", x.get("h"))
        if b:
            out["scripts"].append({"id": x.get("id"), "name": b.get("name") or x.get("name", ""), "source": b.get("source", "")})
    out["drawings"] = (_get_blob(uid, "draw", snap.get("draw")) or []) if snap.get("draw") else []
    return out


# ---------------------------------------------------------------- the stop's path
_NUM = r"-?\d+(?:\.\d+)?"


def log_path(urt, t: dict) -> tuple:
    """(path or None, complete) rebuilt from the account's log for a trade from before the path was recorded: each
    stop / target change the engine wrote down, with its time. complete = the log reaches back to the trade's opening.
    The log doesn't say what the target was before its first change: None there (shown as not known)."""
    e = urt.engines.get(t.get("acct", ""))
    ev = (e.events if e else []) or []
    o, c = t.get("opened") or 0, (t.get("closed") or now()) + 2
    pre = str(t["s"]).split(":", 1)[-1] + ": "
    steps = []
    for x in ev:
        tt, msg = x.get("t") or 0, str(x.get("msg") or "")
        if tt < o - 1 or tt > c or not msg.startswith(pre):
            continue
        body = msg[len(pre):]
        m = re.match(r"stop to break-even \+ costs (" + _NUM + ")", body)
        if m:
            steps.append([tt, "be", float(m.group(1)), "keep"]); continue
        m = re.match(r"stop now (" + _NUM + ")", body)
        if m:
            steps.append([tt, "trail", float(m.group(1)), "keep"]); continue
        ms = re.search(r"(?:^|, )SL (None|" + _NUM + ")(?=,|$)", body)
        mt = re.search(r"(?:^|, )TP (None|" + _NUM + ")(?=,|$)", body)
        if ms or mt:
            val = lambda g: None if g == "None" else float(g)
            steps.append([tt, "edit", val(ms.group(1)) if ms else "keep", val(mt.group(1)) if mt else "keep"])
    if not steps:
        return None, False
    tp_edited = any(x[3] != "keep" for x in steps)
    sl, tp = t.get("first_sl"), (None if tp_edited else t.get("tp"))
    path = [[o, sl, tp, "open"]]
    for tt, kind, nsl, ntp in steps:
        sl = sl if nsl == "keep" else nsl
        tp = tp if ntp == "keep" else ntp
        path.append([tt, sl, tp, kind])
    complete = (ev[0].get("t") or 0) <= o
    return path, complete


def trade_path(urt, t: dict) -> tuple:
    """(path, source): "recorded" (the engine's own record), "log" / "log-part" (rebuilt from the account's log; part:
    the log doesn't reach back to the opening), or "ends" (only the first and last stop are known)."""
    p = t.get("path")
    if p:
        return [list(x) for x in p], "recorded"
    path, complete = log_path(urt, t)
    if path:
        return path, "log" if complete else "log-part"
    o = t.get("opened") or 0
    path = [[o, t.get("first_sl"), t.get("tp"), "open"]]
    if t.get("sl") != t.get("first_sl") and t.get("closed"):
        path.append([t["closed"], t.get("sl"), t.get("tp"), "edit"])     # (when it moved isn't known: drawn at the exit)
    return path, "ends"


# ---------------------------------------------------------------- money during the replay
def _row(t: dict) -> dict:
    return {**(symbols.get(t["s"]) or {}), "prod": t.get("product")}


def be_price(urt, t: dict) -> float | None:
    try:
        e = urt.engines.get(t.get("acct", ""))
        buf = int((e.rules.get("be_buffer_ticks") if e else 0) or 0)
        row = _row(t)
        qty = sum(x.get("qty") or 0 for x in t.get("entries") or []) or t.get("qty")
        paid = sum(charges.order(row, t["side"], x["qty"], x["price"])["total"] for x in t.get("entries") or [])
        avg = t.get("avg")
        if not qty or not avg or not row.get("tick"):
            return None
        return charges.breakeven(row, t["side"], qty, avg, paid=paid, buffer_ticks=buf)
    except Exception:
        return None


def net_series(t: dict, pts: list) -> list:
    """Net ₹ after all charges at each [time, price]: what was open then (entries up to that time, less the parts
    closed by then) valued at the price, plus what the closed parts had made. None before the entry."""
    row = _row(t)
    side = t["side"]
    ents = sorted(t.get("entries") or [], key=lambda x: x.get("t") or 0)
    cls = sorted(t.get("closes") or [], key=lambda x: x.get("t") or 0)
    out = []
    for tt, p in pts[:5000]:
        try:
            tt, p = float(tt), float(p)
        except (TypeError, ValueError):
            out.append(None)
            continue
        es = [x for x in ents if (x.get("t") or 0) <= tt]
        if not es:
            out.append(None)
            continue
        qty = sum(x["qty"] for x in es)
        cost = sum(x["qty"] * x["price"] for x in es)
        paid = sum(charges.order(row, side, x["qty"], x["price"])["total"] for x in es)
        done = [c for c in cls if (c.get("t") or 0) <= tt]
        cq = sum(c.get("qty") or 0 for c in done)
        realized = sum(c.get("net") or 0 for c in done)
        oq = qty - cq
        if oq <= 0:
            out.append(round(realized, 2))
            continue
        f = oq / qty
        out.append(round(realized + charges.net_at(row, side, oq, cost / qty, p, paid=paid * f)["net"], 2))
    return out


FACTS = ("id", "acct", "acct_name", "mode", "s", "side", "product", "lot", "lots", "qty", "entries", "avg", "exit",
         "opened", "closed", "reason", "first_sl", "sl", "tp", "basis", "ref", "gross", "charges", "net", "init_risk",
         "r", "planned_r", "status", "day", "best", "worst")


def view(urt, t: dict) -> dict:
    uid = urt.uid
    rec = load(uid, t["id"])
    path, psrc = trade_path(urt, t)
    closes = [{k: c.get(k) for k in ("t", "qty", "exit", "net", "reason", "lots")} for c in t.get("closes") or []]
    return {"trade": {**{k: t.get(k) for k in FACTS}, "closes": closes}, "path": path, "path_src": psrc,
            "be": be_price(urt, t), "row": symbols.get(t["s"]) or None,
            "setup": {"entry": full(uid, rec.get("entry")), "exit": full(uid, rec.get("exit"))}}
