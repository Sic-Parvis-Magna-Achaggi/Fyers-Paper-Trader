"""The trade journal: a port of the Octagon trade journal (octagon_journal.html) onto the server.

Every paper and live trade of a user arrives here on its own (opened, added to, closed; past trades from each
account's history and its archives), one journal trade per position. The user adds the audit: the 8 pillars of the
Octagon, setup tags, plan and review. The session engine (one IST trading day per account) works out the 2% trailing
lockout and the 99 Club break; with their switches on they refuse new orders like the risk guards
(`Paper.guard_new` asks `lock_reason`).

Money and R are the app's net figures: net ₹ after every charge, R = net / the net risk at the first stop
(Octagon worked R out from points before charges).

File: u/<user>/journal.json = {v, trades: {key: trade}, settings: {rules, pillars, p1}, practice, reviews, ended,
hidden, synced}. key = "<account>:<position id>" (a live position closed in parts is one trade)."""
import copy
import datetime as dt
import glob
import logging
import os
import re
import threading
import time

from . import jshots, charges, store, symbols

log = logging.getLogger("journal")
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

# ---------------------------------------------------------------- the Octagon, word for word (editable in settings)
PILLARS = [
    {"n": 1, "title": "Direction & Market Regime", "short": "Direction", "rule": "15M break of structure with candle close, 9/34 daylight, TradingView regime confirms. TradingView for context, MT5 for routing only. No regime alignment = zero trades."},
    {"n": 2, "title": "Wait State", "short": "Wait", "rule": "Only Patient may click. Restless (amber) or Rushed (red) = strict lockout."},
    {"n": 3, "title": "Execution & Trade Completion", "short": "Execution", "rule": "Enter strictly on a confirmed candle close, single bracket, zero mid-trade tinkering. Finish the rep: bank realistic targets, trail defense cleanly."},
    {"n": 4, "title": "2% Trailing Drawdown", "short": "2% DD", "rule": "Equity pulls back 2% of base from any session peak → immediate terminal lockout, zero debate."},
    {"n": 5, "title": "3 Wins — The 99 Club", "short": "99 Club", "rule": "3 consecutive wins or 3 multi-R wins → 20-minute AFK. Mind running numbers or chasing a milestone → end the session at peak equity. Walk away with the 99 coins."},
    {"n": 6, "title": "5% Execution Blocks", "short": "5% Blocks", "rule": "Personal Account Mode: ignore payout dates, work in mechanical 5% equity blocks, focus entirely on clean reps."},
    {"n": 7, "title": "The Zen Temple", "short": "Zen", "rule": "Trade only in an isolated sanctuary. Family and workplace spaces are blackouts. A compromised trade is Execution: Wrong (Zen Temple Breach)."},
    {"n": 8, "title": "Sic Parvis Magna", "short": "Sic Parvis", "rule": "Take structural targets (+1.5R to +2R) and trail as the move delivers. Never stretch targets into hope or withhold the trail to “give room”."},
]
P1_CHECKS = [["bos15", "15M BOS, candle closed"], ["ema934", "9/34 daylight"], ["tvRegime", "TradingView regime confirms"]]
EXEC_FAULTS = [["frontran", "Front-ran a wick / mid-candle entry"], ["tinkered", "Tinkered mid-trade"],
               ["bracket", "Not a single bracket"], ["overheld", "Held past the structural target"], ["zen", "Zen Temple breach"]]
OCT = {
    "direction": ["Correct", "Wrong"],
    "wait": ["Patient", "Restless", "Rushed"],
    "execution": ["Correct", "Wrong"],
    "zen": ["Sanctuary", "Compromised"],
    "target": ["Realistic", "Stretched"],
    "regime": ["Thin and Jumpy", "Active Expansion", "Dormant", "Absorption"],   # recorded, not judged
}
MANTRA = "I am the one who needs nothing — the one without identities."
DEFAULT_RULES = {
    "dd_pct": 2.0,         # Pillar 4: trailing drawdown from the session peak, % of the account size
    "afk_min": 20.0,       # Pillar 5: the break after the 99 Club
    "win_streak": 3.0,     # wins in a row (or wins of multi_r and more) before the break
    "multi_r": 2.0,        # a "multi-R" win (net R)
    "stretch_r": 2.5,      # Pillar 8: a target beyond this many R (net) is flagged
    "block_pct": 5.0,      # Pillar 6: execution blocks
    "rep_block": 50.0,     # a rep milestone every this many reps
    "reps_before": 0.0,    # reps done before this journal
    # lockouts refuse new orders (owner, 1 Nov 2026: "Block, each switchable")
    "block_dd": True,      # after the trailing-drawdown lockout, for the rest of the trading day
    "block_afk": True,     # during the 99 Club break
    "block_end": True,     # after "numbers running" / the session ended by hand, for the rest of the trading day
    "cancel_pending": True,  # when a lockout starts, cancel the account's waiting entry orders
}
BOOL_RULES = ("block_dd", "block_afk", "block_end", "cancel_pending")
TEXT_MAX = 8000

J: dict = {}               # uid -> Journal
_loop = None               # the helper's event loop (set by rt.start): order cancels run there
on_change = None           # app callback(uid) after the journal changed (the page reloads it)


def now() -> float:
    return time.time()


def ist(ts: float) -> dt.datetime:
    return dt.datetime.fromtimestamp(ts, IST)


def hm(ts) -> str:
    return "—" if ts is None else ist(ts).strftime("%H:%M")


def iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def base_id(pid: str) -> str:
    """A live position closed in parts books 'P...p1', 'P...p2': one journal trade."""
    return re.sub(r"p\d+$", "", str(pid))


def time_bucket(ts) -> str:
    """Time of day in India (Octagon's Asia / London / New York don't apply)."""
    if ts is None:
        return ""
    t = ist(ts)
    h = t.hour + t.minute / 60
    if h < 9.25:
        return "Before 09:15"
    if h < 10:
        return "Opening hour"
    if h < 12:
        return "Morning"
    if h < 13.5:
        return "Midday"
    if h < 15.5:
        return "Afternoon"
    if h < 17:
        return "After NSE close"
    if h < 19:
        return "Evening"
    return "Night (US hours)"


def parse_num2(v):
    """Bias / KE: any signed number, 2 decimals; anything else is 'not recorded'."""
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        n = float(v)
    else:
        s = re.sub(r"\s+", "", str(v).strip().replace("−", "-").replace("–", "-").replace("—", "-")).replace(",", ".")
        if not re.fullmatch(r"[+-]?(\d+\.?\d*|\.\d+)", s):
            return None
        n = float(s)
    if n != n or n in (float("inf"), float("-inf")):
        return None
    return round(n, 2) + 0.0


def split_tags(v) -> list:
    items = v if isinstance(v, list) else str(v or "").split(",")
    seen, out = set(), []
    for x in items:
        x = str(x).strip()[:40]
        if x and x.lower() not in seen:
            seen.add(x.lower())
            out.append(x)
    return out[:20]


ANN_DEFAULTS = {
    "direction": "", "wait": "", "execution": "", "zen": "", "target": "", "regime": "",
    "bias": None, "ke": None, "p1Checks": [], "execFaults": [], "numberRunning": False, "payoutPressure": False,
    "setup": [], "notes": "", "review": "", "rvRight": "", "rvWrong": "", "reviewedAt": None,
}


# ---------------------------------------------------------------- what a trade works out to (Octagon's metrics())
def metrics(t: dict) -> dict:
    closed = t.get("status") == "closed"
    net = t.get("net") if closed else None
    o = t.get("opened")
    c = t.get("closed") if closed else None
    r = t.get("r") if closed else None
    return {"closed": closed, "net": net, "open": o, "close": c,
            "dur": max(0, round(c - o)) if (o is not None and c is not None and not t.get("timeless")) else None,
            "r": r, "planned": t.get("planned_r"), "risk": t.get("init_risk") or None,
            "slLocked": bool(t.get("init_risk") is not None and t.get("init_risk") <= 0 and t.get("first_sl") is not None),
            "session": "" if t.get("timeless") else time_bucket(o),
            "sort": o if o is not None else 0, "day_ts": c if c is not None else o}


def target_needed(m) -> bool:
    """Sic Parvis Magna is about banking a winner: required on a closed trade that didn't lose, optional otherwise."""
    return m["closed"] and m["net"] is not None and m["net"] >= 0


def session_engine(lst: list, R: dict) -> dict:
    """Walks a session's closed trades in order and records when each lockout began (Octagon's sessionEngine)."""
    base = float(lst[0].get("base") or 0)
    limit = base * float(R["dd_pct"]) / 100
    afk = float(R["afk_min"]) * 60
    streak_n = max(1, int(round(float(R["win_streak"]))))
    items = [(t, metrics(t)) for t in lst]
    closes = sorted([x for x in items if x[1]["closed"] and x[1]["net"] is not None and x[1]["close"] is not None],
                    key=lambda x: x[1]["close"])
    cum = peak = max_dd = 0.0
    streak = multi = 0
    dd_lock = None
    lockouts, win_times = [], []
    for t, m in closes:
        cum = round(cum + m["net"], 2)
        peak = max(peak, cum)
        max_dd = max(max_dd, peak - cum)
        if dd_lock is None and limit > 0 and peak - cum >= limit - 0.005:
            dd_lock = m["close"]
        if m["net"] > 0:
            win_times.append(m["close"])
            streak += 1
            if m["r"] is not None and m["r"] >= float(R["multi_r"]):
                multi += 1
        else:
            streak = 0
        if streak >= streak_n:
            lockouts.append({"from": m["close"], "to": m["close"] + afk, "why": f"{streak_n} consecutive wins"})
            streak = 0
        if multi >= streak_n:
            lockouts.append({"from": m["close"], "to": m["close"] + afk,
                             "why": f"{streak_n} multi-R wins (≥{float(R['multi_r']):g}R)"})
            multi = 0
    nr = [m["open"] for t, m in items if t.get("numberRunning") and m["open"] is not None]
    return {"acct": lst[0].get("acct", ""), "day": lst[0].get("day", ""), "base": base, "limit": round(limit, 2),
            "cum": round(cum, 2), "peak": round(peak, 2), "dd": round(peak - cum, 2), "maxDd": round(max_dd, 2),
            "ddLockAt": dd_lock, "lockouts": lockouts, "winTimes": win_times, "termAt": min(nr) if nr else None,
            "streak": streak, "multi": multi, "count": len(lst), "closed": len(closes), "cur": lst[0].get("cur", "INR")}


def audit_trade(t: dict, s: dict | None, R: dict, faults: list) -> dict:
    """The 8 pillars of one trade (Octagon's auditTrade)."""
    m = metrics(t)
    P, breaches, warns = {}, [], []

    def put(k, state, note=""):
        P[k] = {"state": state, "note": note}
        if state == "fail":
            breaches.append({"p": k, "note": note})
        if state == "warn":
            warns.append({"p": k, "note": note})

    d, w, ex, zen, tg = (t.get(k) or "" for k in ("direction", "wait", "execution", "zen", "target"))
    put("p1", "na" if not d else "pass" if d == "Correct" else "fail",
        "Direction / regime not aligned — no regime alignment = zero trades")
    put("p2", "na" if not w else "pass" if w == "Patient" else "fail", f"Clicked while {w} — only Patient may click")
    zen_breach = zen == "Compromised"
    names = [next((f[1] for f in faults if f[0] == k), k) for k in t.get("execFaults") or []]
    if zen_breach and "zen" not in (t.get("execFaults") or []):
        names.append("Zen Temple breach")
    put("p3", "na" if (not ex and not zen_breach) else "fail" if (ex == "Wrong" or zen_breach) else "pass",
        "Execution wrong" + (": " + ", ".join(names) if names else ""))
    op = m["open"]
    if not s or op is None:
        put("p4", "na")
        put("p5", "fail" if t.get("numberRunning") else "na", "Mind was running numbers — the session should have ended")
    else:
        if s["ddLockAt"] is not None and op > s["ddLockAt"]:
            put("p4", "fail", f"Opened after the {float(R['dd_pct']):g}% trailing-drawdown lockout (hit {hm(s['ddLockAt'])} IST)")
        else:
            put("p4", "pass")
        notes = []
        lo = None if t.get("timeless") else next((l for l in s["lockouts"] if l["from"] <= op < l["to"]), None)
        if lo:
            notes.append(f"Opened inside the {float(R['afk_min']):g}-min AFK after {lo['why']} (until {hm(lo['to'])})")
        if t.get("numberRunning"):
            notes.append("Mind was running numbers — the session should have ended at peak equity")
        elif s["termAt"] is not None and op > s["termAt"]:
            notes.append(f"Session should have ended at {hm(s['termAt'])} — numbers were running")
        wins_before = len([x for x in s["winTimes"] if x <= op and not (t.get("timeless") and x == m["close"])])
        if notes:
            put("p5", "fail", "; ".join(notes))
        elif not wins_before:
            put("p5", "off", "No wins yet this session — the 99 Club doesn't apply")
        else:
            put("p5", "pass")
    put("p6", "fail" if t.get("payoutPressure") else ("pass" if (t.get("octVer") or 1) >= 2 else "na"),
        "Traded the payout date / balance instead of the chart")
    put("p7", "na" if not zen else "fail" if zen_breach else "pass", "Traded outside the sanctuary (Zen Temple breach)")
    stretched = m["planned"] is not None and m["planned"] > float(R["stretch_r"])
    plan_note = f"T/P at {m['planned']:.1f}R — beyond the structural +1.5R to +2R" if stretched else ""
    need = target_needed(m)
    if tg == "Stretched":
        put("p8", "fail", "Stretched the target / withheld the trail" + (f" ({plan_note})" if plan_note else ""))
    elif stretched:
        put("p8", "warn", plan_note)
    elif tg:
        put("p8", "pass")
    else:
        put("p8", "na" if need else "off",
            "A losing trade — Sic Parvis Magna is optional" if m["closed"] else "Still open — recorded once it closes")
    recorded = bool(d and w and ex and zen and (tg or not need))
    return {"P": P, "breaches": breaches, "warns": warns, "recorded": recorded, "clean": recorded and not breaches}


def session_key(t: dict) -> str:
    return f"{t.get('acct', '')}|{t.get('day', '')}"


def compute_audit(trades: list, R: dict, faults: list) -> tuple:
    groups: dict = {}
    for t in trades:
        if t.get("opened") is None:
            continue
        groups.setdefault(session_key(t), []).append(t)
    by_id, sessions = {}, {}
    for k, lst in groups.items():
        s = session_engine(lst, R)
        sessions[k] = s
        for t in lst:
            by_id[t["id"]] = audit_trade(t, s, R, faults)
    for t in trades:
        if t["id"] not in by_id:
            by_id[t["id"]] = audit_trade(t, None, R, faults)
    return by_id, sessions


def rep_quality(a: dict) -> str:
    return "broken" if a["breaches"] else "held" if a["P"]["p3"]["state"] == "pass" else "unaudited"


# ---------------------------------------------------------------- one user's journal
class Journal:
    def __init__(self, uid: str):
        self.uid = uid
        self.file = f"u/{uid}/journal.json"
        self.lock = threading.RLock()
        d = store.load(self.file)
        self.d = {"v": 1, "trades": d.get("trades") or {}, "settings": d.get("settings") or {},
                  "practice": d.get("practice") or {}, "reviews": d.get("reviews") or {}, "ended": d.get("ended") or {},
                  "hidden": d.get("hidden") or [], "synced": bool(d.get("synced"))}
        self._cache = None              # (stamp, by_id, sessions)
        self.stamp = 0

    # -------------------------------------------------------- settings
    def rules(self) -> dict:
        r = dict(DEFAULT_RULES)
        for k, v in (self.d["settings"].get("rules") or {}).items():
            if k in BOOL_RULES:
                r[k] = bool(v)
            elif k in DEFAULT_RULES:
                try:
                    if float(v) >= 0:
                        r[k] = float(v)
                except (TypeError, ValueError):
                    pass
        return r

    def pillars(self) -> list:
        over = self.d["settings"].get("pillars") or {}
        out = []
        for p in PILLARS:
            o = over.get(str(p["n"])) or {}
            out.append({**p, "title": o.get("title") or p["title"], "short": o.get("short") or p["short"],
                        "rule": o.get("rule") if o.get("rule") is not None else p["rule"],
                        "edited": bool(o)})
        return out

    def p1(self) -> list:
        v = self.d["settings"].get("p1")
        return v if isinstance(v, list) and v else [list(x) for x in P1_CHECKS]

    def set_settings(self, b: dict) -> None:
        with self.lock:
            st = self.d["settings"]
            if isinstance(b.get("rules"), dict):
                cur = dict(st.get("rules") or {})
                for k, v in b["rules"].items():
                    if k in BOOL_RULES:
                        cur[k] = bool(v)
                    elif k in DEFAULT_RULES:
                        try:
                            f = float(v)
                        except (TypeError, ValueError):
                            raise ValueError(f"{k}: a number")
                        if f < 0 or (k in ("dd_pct", "win_streak", "rep_block") and f <= 0):
                            raise ValueError(f"{k}: must be above 0")
                        cur[k] = f
                st["rules"] = cur
            if isinstance(b.get("pillars"), dict):
                cur = dict(st.get("pillars") or {})
                for n, o in b["pillars"].items():
                    if str(n) not in {str(p["n"]) for p in PILLARS}:
                        continue
                    if o is None:                                  # back to your original text
                        cur.pop(str(n), None)
                        continue
                    base = next(p for p in PILLARS if str(p["n"]) == str(n))
                    e = {k: str(o.get(k))[: (2000 if k == "rule" else 80)] for k in ("title", "short", "rule")
                         if o.get(k) is not None and str(o.get(k)).strip() and str(o.get(k)) != base[k]}
                    if e:
                        cur[str(n)] = e
                    else:
                        cur.pop(str(n), None)
                st["pillars"] = cur
            if isinstance(b.get("shots"), dict):
                st["shots"] = jshots.clean_cfg(b["shots"], st.get("shots") or {})
            if "p1" in b:
                v = b["p1"]
                if v is None:
                    st.pop("p1", None)
                else:
                    out, seen = [], set()
                    for x in v[:8]:
                        k, lbl = str(x[0])[:20], str(x[1]).strip()[:80]
                        if not lbl:
                            continue
                        if not re.fullmatch(r"[A-Za-z0-9_]+", k) or k in seen:
                            k = "c" + str(len(out) + 1) + "_" + str(int(now()) % 100000)
                        seen.add(k)
                        out.append([k, lbl])
                    if not out:
                        raise ValueError("keep at least one Pillar 1 check")
                    st["p1"] = out
            self._changed()

    # -------------------------------------------------------- storage
    def _changed(self):
        with self.lock:                  # the pictures' worker thread changes trades too (helper/jshots.py)
            self.stamp += 1
            self._cache = None
            store.save(self.file, self.d)

    def save(self):
        self._changed()

    # -------------------------------------------------------- trades from the engines
    def _new(self, key, aid, acct_name, mode, e_base, src) -> dict:
        t = {"id": key, "acct": aid, "acct_name": acct_name, "mode": mode, "cur": "INR", "src": "fyers",
             "pid": base_id(src["id"]), "s": src["s"], "side": src["side"], "product": src.get("product", ""),
             "lot": src.get("lot") or 1, "lots": None, "qty": None, "entries": [], "avg": None, "exit": None,
             "opened": src.get("opened"), "closed": None, "reason": "", "first_sl": src.get("first_sl"),
             "sl": src.get("sl"), "tp": src.get("tp"), "basis": src.get("basis", "self"), "ref": src.get("ref"),
             "gross": None, "charges": None, "net": None, "init_risk": src.get("init_risk"), "r": None,
             "planned_r": None, "balance_after": None, "best": src.get("best"), "worst": src.get("worst"),
             "day": src.get("day") or "", "base": e_base, "status": "open", "parts": [], "closes": [],
             "octVer": 2, "claimedAt": None, "created": iso(), "updated": iso()}
        t.update(copy.deepcopy(ANN_DEFAULTS))
        return t

    @staticmethod
    def _planned(t):
        """The target in net R: net ₹ at the take-profit (all charges) / net risk at the first stop."""
        try:
            if t.get("tp") is None or not t.get("init_risk") or t.get("basis") not in (None, "self"):
                return None
            row = symbols.get(t["s"])
            if not row:
                return None
            qty = t.get("qty") or 0
            if not qty:
                return None
            net = charges.net_at({**row, "prod": t.get("product")}, t["side"], qty, t["avg"], t["tp"])["net"]
            return round(net / t["init_risk"], 2)
        except Exception:
            return None

    def ingest_close(self, aid, acct_name, mode, e_base, rec: dict, still_open: bool = False, backfill=False) -> bool:
        """A closed position (or a part of one) from the engine's history. Returns True if it was new."""
        key = f"{aid}:{base_id(rec['id'])}"
        with self.lock:
            t = self.d["trades"].get(key)
            if t and rec["id"] in t["parts"]:
                return False
            if not t:
                t = self._new(key, aid, acct_name, mode, e_base, rec)
                if backfill:
                    t["claimedAt"] = t["created"]       # trades from before the journal count as claimed (Octagon)
                self.d["trades"][key] = t
            t["parts"].append(rec["id"])
            t["closes"].append({"id": rec["id"], "t": rec.get("closed"), "qty": rec.get("qty"), "exit": rec.get("exit"),
                                "net": rec.get("net"), "gross": rec.get("gross"),
                                "charges": (rec.get("charges") or {}).get("total"), "init_risk": rec.get("init_risk"),
                                "reason": rec.get("reason", ""), "bal": rec.get("balance_after"), "lots": rec.get("lots")})
            cl = sorted(t["closes"], key=lambda c: c.get("t") or 0)
            q = sum(c.get("qty") or 0 for c in cl)
            t.update(
                qty=q, lots=sum(c.get("lots") or 0 for c in cl), lot=rec.get("lot") or t.get("lot") or 1,
                entries=rec.get("entries") or t["entries"], avg=rec.get("avg"), opened=rec.get("opened") or t["opened"],
                exit=round(sum((c.get("exit") or 0) * (c.get("qty") or 0) for c in cl) / q, 6) if q else rec.get("exit"),
                closed=cl[-1].get("t"), reason=cl[-1].get("reason", ""),
                first_sl=rec.get("first_sl", t.get("first_sl")), sl=rec.get("sl"), tp=rec.get("tp"),
                basis=rec.get("basis", t.get("basis")), ref=rec.get("ref"),
                gross=round(sum(c.get("gross") or 0 for c in cl), 2),
                charges=round(sum(c.get("charges") or 0 for c in cl), 2),
                net=round(sum(c.get("net") or 0 for c in cl), 2),
                init_risk=round(sum(c.get("init_risk") or 0 for c in cl), 2),
                balance_after=cl[-1].get("bal"), day=rec.get("day") or t["day"],
                status="open" if still_open else "closed", updated=iso())
            t["r"] = round(t["net"] / t["init_risk"], 2) if t["init_risk"] else None
            for k, f in (("best", max if rec["side"] > 0 else min), ("worst", min if rec["side"] > 0 else max)):
                vals = [x for x in (t.get(k), rec.get(k)) if x is not None]
                t[k] = f(vals) if vals else None
            t["planned_r"] = self._planned(t)
            return True

    def upsert_open(self, aid, acct_name, mode, e_base, pos: dict, day: str) -> None:
        """An open position (just filled, added to, or still running)."""
        key = f"{aid}:{base_id(pos['id'])}"
        with self.lock:
            t = self.d["trades"].get(key)
            if not t:
                t = self._new(key, aid, acct_name, mode, e_base, {**pos, "day": day})
                self.d["trades"][key] = t
            if t["closes"]:                              # partly closed already: the closes carry the money
                t["status"] = "open"
                t["open_qty"] = pos.get("qty")
                return
            lot = t.get("lot") or 1
            t.update(entries=[{"t": e["t"], "qty": e["qty"], "price": e["price"]} for e in pos.get("entries") or []],
                     avg=pos.get("avg"), qty=pos.get("max_qty") or pos.get("qty"), opened=pos.get("opened"),
                     lots=(pos.get("max_qty") or pos.get("qty") or 0) // lot if lot else None,
                     first_sl=pos.get("first_sl"), sl=pos.get("sl"), tp=pos.get("tp"), init_risk=pos.get("init_risk"),
                     best=pos.get("best"), worst=pos.get("worst"), status="open", open_qty=pos.get("qty"),
                     day=t.get("day") or day)
            t["planned_r"] = self._planned(t)

    def sync(self, urt, full: bool = False) -> bool:
        """Bring every account's trades in: the engines' history and open positions; with `full` (the first time,
        and on start-up) also the archived accounts and the archives of earlier ledgers (resets, Paper <-> Live)."""
        changed = False
        backfill = not self.d["synced"]
        with self.lock:
            accts = {a["id"]: a for a in urt.accounts()}
            for aid, a in accts.items():
                e = urt.engines.get(aid)
                name, mode = a.get("name", ""), a.get("mode", "paper")
                size = float((e.rules["size"] if e else a.get("capital")) or 0)
                recs = []
                if full or not self.d["synced"]:
                    folder = str(store.path(f"u/{urt.uid}/a/{aid}/x").parent)
                    for f in sorted(glob.glob(os.path.join(folder, "paper_trades_until_*.json"))):
                        recs += [(r, "paper") for r in store.load(os.path.relpath(f, str(store.DATA_DIR)), [])]
                    if not e:
                        recs += [(r, mode) for r in store.load(f"u/{urt.uid}/a/{aid}/paper_trades.json", [])]
                if e:
                    recs += [(r, e.mode) for r in e.history]
                open_ids = {base_id(p["id"]) for p in (e.positions if e else [])}
                for r, md in recs:
                    if not isinstance(r, dict) or "id" not in r or "s" not in r:
                        continue
                    if self.ingest_close(aid, name, md, size, r, base_id(r["id"]) in open_ids, backfill):
                        changed = True
                if e:
                    for p in e.positions:
                        self.upsert_open(aid, name, e.mode, size, p, e.trading_day(p.get("opened")))
                    # an open journal trade whose position is gone without a close (e.g. an account reset)
                    for t in self.d["trades"].values():
                        if t["acct"] == aid and t["status"] == "open" and t["pid"] not in open_ids:
                            t["status"] = "closed" if t["closes"] else "removed"
                            changed = True
            if not self.d["synced"]:
                self.d["synced"] = True
                changed = True
            if changed:
                self._changed()
            else:
                self._cache = None
        return changed

    # -------------------------------------------------------- the audit, sessions and reps
    def visible(self) -> list:
        hid = set(self.d["hidden"])
        return [t for t in self.d["trades"].values() if t["id"] not in hid and t["status"] != "removed"]

    def computed(self):
        with self.lock:
            if self._cache and self._cache[0] == self.stamp:
                return self._cache[1], self._cache[2]
            by_id, sessions = compute_audit(self.visible(), self.rules(), EXEC_FAULTS)
            self._cache = (self.stamp, by_id, sessions)
            return by_id, sessions

    def reps(self, by_id) -> dict:
        R = self.rules()
        lst = sorted([t for t in self.visible() if t["status"] == "closed"],
                     key=lambda t: (t.get("opened") or 0, t["id"]))
        before = max(0, int(round(R["reps_before"])))
        num = {t["id"]: before + i + 1 for i, t in enumerate(lst)}
        return {"num": num, "before": before, "block": max(1, int(round(R["rep_block"]))), "total": before + len(lst)}

    def today_state(self, aid: str, day: str) -> dict:
        """Today's session of one account and what it locks."""
        by_id, sessions = self.computed()
        R = self.rules()
        s = sessions.get(f"{aid}|{day}")
        t_now = now()
        lock = None
        ended = self.d["ended"].get(f"{aid}|{day}")
        if s and s["termAt"] is not None:
            lock = {"kind": "end", "on": R["block_end"], "until": None,
                    "text": f"Session over: your mind was running numbers from {hm(s['termAt'])}. Walk away with the 99 coins."}
        elif ended:
            lock = {"kind": "end", "on": R["block_end"], "until": None,
                    "text": f"Session ended at {hm(ended)}. Walk away with the 99 coins."}
        elif s and s["ddLockAt"] is not None:
            lock = {"kind": "dd", "on": R["block_dd"], "until": None,
                    "text": f"Locked out at {hm(s['ddLockAt'])}: equity fell ₹{s['limit']:,.2f} from the session peak. Platform off, zero debate."}
        elif s:
            lo = [l for l in s["lockouts"] if t_now < l["to"]]
            if lo:
                lo = lo[-1]
                lock = {"kind": "afk", "on": R["block_afk"], "until": lo["to"],
                        "text": f"Step away until {hm(lo['to'])} — {int((lo['to'] - t_now) // 60) + 1} min left after {lo['why']}."}
        return {"acct": aid, "day": day, "session": s, "lock": lock, "ended": ended}

    def lock_reason(self, aid: str, day: str) -> str | None:
        st = self.today_state(aid, day)
        lk = st["lock"]
        if lk and lk["on"]:
            pre = {"dd": "Pillar 4", "afk": "Pillar 5 · 99 Club", "end": "Pillar 5"}[lk["kind"]]
            return f"Blocked by your journal ({pre}): {lk['text']} (switch: Journal › Settings)"
        return None

    # -------------------------------------------------------- the page's edits
    def annotate(self, key: str, b: dict) -> dict:
        with self.lock:
            t = self.d["trades"].get(key)
            if not t:
                raise KeyError("no such trade in the journal")
            self._apply(t, b)
            t["updated"] = iso()
            self._changed()
            return t

    def _apply(self, t: dict, b: dict) -> None:
        for k, vals in OCT.items():
            if k in b:
                v = b[k] or ""
                if v and v not in vals:
                    raise ValueError(f"{k}: one of {', '.join(vals)}")
                t[k] = v
        for k in ("bias", "ke"):
            if k in b:
                t[k] = parse_num2(b[k])
        if "p1Checks" in b:
            keys = {x[0] for x in self.p1()}
            t["p1Checks"] = [k for k in (b["p1Checks"] or []) if k in keys]
        if "execFaults" in b:
            keys = {x[0] for x in EXEC_FAULTS}
            t["execFaults"] = [k for k in (b["execFaults"] or []) if k in keys]
        for k in ("numberRunning", "payoutPressure"):
            if k in b:
                t[k] = bool(b[k])
        if "setup" in b:
            t["setup"] = split_tags(b["setup"])
        rv_before = (t.get("review"), t.get("rvRight"), t.get("rvWrong"))
        for k in ("notes", "review", "rvRight", "rvWrong"):
            if k in b:
                t[k] = str(b[k] or "")[:TEXT_MAX]
        if (t.get("review"), t.get("rvRight"), t.get("rvWrong")) != rv_before:
            t["reviewedAt"] = iso()                       # a reflection (the walk-through, the review)
        # a Zen Temple breach makes Execution wrong (Octagon's form rule, kept on the server too)
        if t.get("zen") == "Compromised":
            t["execution"] = "Wrong"
            if "zen" not in t["execFaults"]:
                t["execFaults"] = t["execFaults"] + ["zen"]
        else:
            t["execFaults"] = [f for f in t["execFaults"] if f != "zen"]
        if t.get("execution") != "Wrong":
            t["execFaults"] = []

    def preview(self, key: str, b: dict) -> dict:
        """The audit of a trade as it would be with these edits (nothing saved)."""
        with self.lock:
            t0 = self.d["trades"].get(key)
            if not t0:
                raise KeyError("no such trade in the journal")
            t = copy.deepcopy(t0)
            self._apply(t, b)
            lst = [x for x in self.visible() if x["id"] != key] + [t]
            by_id, sessions = compute_audit(lst, self.rules(), EXEC_FAULTS)
            return {"audit": by_id[key], "session": sessions.get(session_key(t))}

    def claim(self, key: str) -> dict:
        with self.lock:
            t = self.d["trades"].get(key)
            if not t:
                raise KeyError("no such trade in the journal")
            if t["status"] != "closed":
                raise ValueError("a rep is claimed once the trade has closed")
            if not t.get("claimedAt"):
                t["claimedAt"] = iso()
                t["updated"] = iso()
                self._changed()
            return t

    def set_practice(self, day: str, on: bool) -> None:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day or ""):
            raise ValueError("day: YYYY-MM-DD")
        with self.lock:
            self.d["practice"][day] = iso() if on else False
            self._changed()

    def set_hidden(self, key: str, hidden: bool) -> None:
        with self.lock:
            if key not in self.d["trades"]:
                raise KeyError("no such trade in the journal")
            h = [x for x in self.d["hidden"] if x != key]
            if hidden:
                h.append(key)
            self.d["hidden"] = h
            self._changed()

    def end_session(self, aid: str, day: str) -> None:
        with self.lock:
            k = f"{aid}|{day}"
            if not self.d["ended"].get(k):
                self.d["ended"][k] = now()
                self._changed()

    # -------------------------------------------------------- the weekly review (v0.28.0)
    def set_review(self, week: str, b: dict) -> dict:
        """{well, broke, focus, focusKept} for the week starting Monday `week` (YYYY-MM-DD, IST)."""
        try:
            d = dt.date.fromisoformat(week or "")
        except ValueError:
            raise ValueError("week: the Monday it starts, YYYY-MM-DD")
        if d.weekday() != 0:
            raise ValueError("week: must be a Monday")
        with self.lock:
            rv = dict(self.d["reviews"].get(week) or {})
            for k, n in (("well", TEXT_MAX), ("broke", TEXT_MAX), ("focus", 300)):
                if k in b:
                    rv[k] = str(b[k] or "").strip()[:n]
            if "focusKept" in b:
                v = b["focusKept"] or ""
                if v not in ("", "held", "partly", "missed"):
                    raise ValueError("focusKept: held, partly or missed")
                rv["focusKept"] = v
            rv["updatedAt"] = iso()
            self.d["reviews"][week] = rv
            self._changed()
            return rv

    def set_review_msg(self, week: str, msg) -> None:
        with self.lock:
            rv = self.d["reviews"].get(week)
            if rv is not None:
                rv["msg"] = msg
                self._changed()

    # -------------------------------------------------------- export and backup (v0.28.0)
    def csv_text(self, urt) -> str:
        """Every trade in the journal (removed ones flagged), with its audit: for a spreadsheet."""
        import csv
        import io
        by_id, _ = self.computed()
        reps = self.reps(by_id)
        names = {a["id"]: a.get("name", "") for a in urt.accounts()}
        pil = self.pillars()
        p1 = dict((k, l) for k, l in self.p1())
        faults = dict(EXEC_FAULTS)
        word = {"pass": "Held", "fail": "Broken", "warn": "Check", "na": "", "off": "n/a"}

        def when(ts):
            return ist(ts).strftime("%Y-%m-%d %H:%M:%S") if ts else ""
        head = ["Rep", "Account", "Mode", "Contract", "Side", "Lots", "Qty", "Product", "Opened (IST)", "Closed (IST)",
                "Entry (avg)", "Exit (avg)", "First stop", "Last stop", "Target", "Gross ₹", "Charges ₹", "Net ₹",
                "Risk at first stop ₹ (net)", "R (net)", "Planned R", "Held (s)", "Time of day", "Exit reason", "Status",
                "Removed from journal"] + [f"P{p['n']} {p['title']}" for p in pil] + [
                "Clean octagon", "Breaches", "Direction", "Pillar 1 checks", "Wait state", "Execution", "Execution faults",
                "Zen Temple", "Target", "Mind running numbers", "Payout pressure", "Market regime", "Bias", "KE", "Setup",
                "Plan", "Review / lesson", "Did right", "Did wrong", "Claimed", "Pictures", "Trade id"]
        out = io.StringIO()
        w = csv.writer(out, lineterminator="\r\n")
        w.writerow(head)
        hid = set(self.d["hidden"])
        with self.lock:
            rows = sorted((t for t in self.d["trades"].values() if t["status"] != "removed"), key=lambda t: (t.get("opened") or 0, t["id"]))
            for t in rows:
                a = by_id.get(t["id"]) or audit_trade(t, None, self.rules(), EXEC_FAULTS)
                closed = t["status"] == "closed"
                w.writerow([
                    reps["num"].get(t["id"], ""), names.get(t["acct"]) or t.get("acct_name", ""), t.get("mode", ""),
                    t["s"], "BUY" if t["side"] > 0 else "SELL", t.get("lots") or "", t.get("qty") or "", t.get("product", ""),
                    when(t.get("opened")), when(t.get("closed")) if closed else "", t.get("avg") or "", t.get("exit") if closed else "",
                    t.get("first_sl") if t.get("first_sl") is not None else "", t.get("sl") if t.get("sl") is not None else "",
                    t.get("tp") if t.get("tp") is not None else "", t.get("gross") if closed else "",
                    t.get("charges") if closed else "", t.get("net") if closed else "", t.get("init_risk") or "",
                    t.get("r") if closed and t.get("r") is not None else "", t.get("planned_r") if t.get("planned_r") is not None else "",
                    int(t["closed"] - t["opened"]) if closed and t.get("closed") and t.get("opened") else "",
                    metrics(t)["session"], t.get("reason", ""), t["status"], "Yes" if t["id"] in hid else ""
                ] + [word.get(a["P"][f"p{p['n']}"]["state"], "") for p in pil] + [
                    "Yes" if a["clean"] else "No", " | ".join(f"P{x['p'][1:]}: {x['note']}" for x in a["breaches"]),
                    t.get("direction", ""), ", ".join(p1.get(k, k) for k in t.get("p1Checks") or []), t.get("wait", ""),
                    t.get("execution", ""), ", ".join(faults.get(k, k) for k in t.get("execFaults") or []), t.get("zen", ""),
                    t.get("target", ""), "Yes" if t.get("numberRunning") else "", "Yes" if t.get("payoutPressure") else "",
                    t.get("regime", ""), "" if t.get("bias") is None else t["bias"], "" if t.get("ke") is None else t["ke"],
                    ", ".join(t.get("setup") or []), t.get("notes", ""), t.get("review", ""), t.get("rvRight", ""),
                    t.get("rvWrong", ""), "Yes" if t.get("claimedAt") else "", len(t.get("shots") or []), t["id"]])
        return "\ufeff" + out.getvalue()

    def backup_zip(self, path: str) -> dict:
        """The whole journal (journal.json) and its pictures, in one zip file at `path`."""
        import json as _json
        import zipfile
        with self.lock:
            data = _json.dumps({"app": "Fyers Trade Manager journal", "v": 1, "uid": self.uid, "at": now(),
                                "journal": self.d}, indent=1)
            shots = [(k, dict(s)) for k, t in self.d["trades"].items() for s in t.get("shots") or []]
        n = 0
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("journal.json", data)
            for k, sh in shots:
                f = jshots.file_of(self.uid, k, sh)
                if os.path.exists(f):
                    z.write(f, f"pictures/{jshots._safe(k)}/{os.path.basename(f)}", compress_type=zipfile.ZIP_STORED)
                    n += 1
        return {"trades": len(self.d["trades"]), "pictures": n}

    def restore(self, path: str) -> dict:
        """Add back from a backup (a .zip from backup_zip, or its journal.json): trades, reviews, practice days and
        session ends the journal doesn't have, and the pictures of those trades (or any picture whose file is missing).
        Nothing already here is changed or removed."""
        import json as _json
        import zipfile
        pics = {}
        if zipfile.is_zipfile(path):
            z = zipfile.ZipFile(path)
            try:
                raw = z.read("journal.json")
            except KeyError:
                raise ValueError("that zip isn't a journal backup (no journal.json in it)")
            for n in z.namelist():
                if n.startswith("pictures/") and not n.endswith("/"):
                    pics[n] = z
        else:
            z = None
            with open(path, "rb") as f:
                raw = f.read()
        try:
            d = _json.loads(raw.decode("utf-8-sig"))
        except Exception:
            raise ValueError("that file isn't a journal backup (not JSON)")
        d = d.get("journal") if isinstance(d, dict) and "journal" in d else d
        if not isinstance(d, dict) or not isinstance(d.get("trades"), dict):
            raise ValueError("that file isn't a journal backup (no trades in it)")
        got = {"trades": 0, "reviews": 0, "practice": 0, "pictures": 0, "skipped": 0}
        added = set()
        with self.lock:
            for k, t in d["trades"].items():
                if not isinstance(t, dict) or "s" not in t or "side" not in t:
                    continue
                mine = self.d["trades"].get(k)
                if mine is None:
                    t = dict(t)
                    t["shots"] = []                  # added back below, each one only with its picture file
                    self.d["trades"][k] = t
                    got["trades"] += 1
                    added.add(k)
                    mine = t
                else:
                    got["skipped"] += 1
                have = {s["id"] for s in mine.get("shots") or []}
                for sh in (d["trades"][k].get("shots") or []):
                    if not re.fullmatch(r"p[0-9a-f]{12}", str(sh.get("id", ""))) or sh.get("ext") not in jshots.MIME:
                        continue
                    name = f"pictures/{jshots._safe(k)}/{sh['id']}.{sh['ext']}"
                    dest = jshots.file_of(self.uid, k, sh)
                    if name in pics and not os.path.exists(dest):
                        data = pics[name].read(name)
                        if jshots.sniff(data) == sh["ext"]:
                            jshots.write(self.uid, k, sh, data)
                            got["pictures"] += 1
                    if sh["id"] not in have and os.path.exists(dest):
                        mine.setdefault("shots", []).append(sh)
                if mine.get("shots"):
                    mine["shots"] = sorted(mine["shots"], key=jshots.order_key)
            for key in ("reviews", "practice", "ended"):
                for k, v in (d.get(key) or {}).items():
                    if k not in self.d[key]:
                        self.d[key][k] = v
                        if key != "ended":
                            got[key] += 1
            for x in d.get("hidden") or []:
                if x in added and x not in self.d["hidden"]:
                    self.d["hidden"].append(x)
            self._changed()
        if z:
            z.close()
        return got

    # -------------------------------------------------------- pictures (helper/jshots.py)
    def shots_cfg(self) -> dict:
        return jshots.cfg(self.d["settings"])

    def _trade(self, key: str) -> dict:
        t = self.d["trades"].get(key)
        if not t:
            raise KeyError("no such trade in the journal")
        return t

    def add_shot(self, key: str, sh: dict, replace: tuple | None = None, unique: tuple | None = None) -> list:
        """Add a picture. replace = (kind, phase): earlier pictures of that kind and phase are dropped (returned, so their
        files go too). unique = (kind, phase, tf): refused (KeyError "dup") if one like it is there already."""
        with self.lock:
            t = self._trade(key)
            shots = list(t.get("shots") or [])
            if unique and any(x["kind"] == unique[0] and x.get("phase") == unique[1] and x.get("tf") == unique[2] for x in shots):
                raise KeyError("dup")
            old = [x for x in shots if replace and x["kind"] == replace[0] and x.get("phase") == replace[1]]
            shots = [x for x in shots if x not in old] + [sh]
            t["shots"] = sorted(shots, key=jshots.order_key)
            if sh.get("phase") and (t.get("shot_err") or {}).get(sh["phase"]) and sh["kind"] == "server":
                t["shot_err"] = {k: v for k, v in t["shot_err"].items() if k != sh["phase"]}
            self._changed()
            return old

    def set_shot(self, key: str, sid: str, tf: str) -> dict:
        if not jshots.tf_ok(tf):
            raise ValueError("label: a timeframe like 5m, 1h, 1D, or Context")
        with self.lock:
            t = self._trade(key)
            sh = next((x for x in t.get("shots") or [] if x["id"] == sid), None)
            if not sh:
                raise KeyError("no such picture")
            sh["tf"] = tf
            t["shots"] = sorted(t["shots"], key=jshots.order_key)
            self._changed()
            return sh

    def del_shot(self, key: str, sid: str) -> dict:
        with self.lock:
            t = self._trade(key)
            sh = next((x for x in t.get("shots") or [] if x["id"] == sid), None)
            if not sh:
                raise KeyError("no such picture")
            t["shots"] = [x for x in t["shots"] if x["id"] != sid]
            self._changed()
            return sh

    def set_shot_tg(self, key: str, sid: str, tg: dict) -> None:
        with self.lock:
            t = self.d["trades"].get(key)
            sh = next((x for x in (t or {}).get("shots") or [] if x["id"] == sid), None)
            if sh is not None:
                sh["tg"] = tg
                self._changed()

    def shot_error(self, key: str, ph: str, msg: str) -> None:
        with self.lock:
            t = self.d["trades"].get(key)
            if t is not None:
                t["shot_err"] = {**(t.get("shot_err") or {}), ph: {"msg": msg[:300], "at": now()}}
                self._changed()

    # -------------------------------------------------------- what the page gets
    def view(self, urt, only: set | None = None) -> dict:
        """Everything the Journal page shows; with `only` (session keys) just those sessions' trades (after an edit:
        a pillar on one trade can change the others of its session)."""
        by_id, sessions = self.computed()
        reps = self.reps(by_id)
        names = {a["id"]: a for a in urt.accounts()}
        trades = []
        hid = set(self.d["hidden"])
        with self.lock:
            for t in self.d["trades"].values():
                if t["status"] == "removed":
                    continue
                if only is not None and session_key(t) not in only:
                    continue
                a = by_id.get(t["id"]) or audit_trade(t, None, self.rules(), EXEC_FAULTS)   # a removed trade: no session
                row = {k: v for k, v in t.items() if k not in ("closes",)}
                row["parts_n"] = len(t["closes"])
                row["acct_name"] = (names.get(t["acct"]) or {}).get("name") or t.get("acct_name") or "deleted account"
                row["hidden"] = t["id"] in hid
                row["audit"] = a
                row["rep"] = reps["num"].get(t["id"])
                row["q"] = rep_quality(a) if a else "unaudited"
                row["skey"] = session_key(t)
                row["tod"] = metrics(t)["session"]
                trades.append(row)
        accts = []
        today = {}
        for aid, a in names.items():
            e = urt.engines.get(aid)
            day = e.trading_day() if e else ""
            accts.append({"id": aid, "name": a.get("name", ""), "mode": a.get("mode", "paper"),
                          "archived": bool(a.get("archived")), "size": float((e.rules["size"] if e else a.get("capital")) or 0),
                          "balance": e.balance() if e else None, "day": day})
            if e:
                today[aid] = self.today_state(aid, day)
        if only is not None:
            sessions = {k: v for k, v in sessions.items() if k in only}
        return {"partial": only is not None, "trades": trades, "sessions": sessions, "rules": self.rules(), "pillars": self.pillars(),
                "p1": self.p1(), "faults": EXEC_FAULTS, "oct": OCT, "mantra": MANTRA,
                "shots_cfg": self.shots_cfg(), "tfs": jshots.TFS, "draw_res": [[r, jshots.RES_LABEL[r]] for r in jshots.DRAW_RES],
                "practice": self.d["practice"], "reviews": self.d["reviews"], "accounts": accts, "today": today,
                "reps": {"before": reps["before"], "block": reps["block"], "total": reps["total"]},
                "hidden_n": len([x for x in self.d["hidden"] if x in self.d["trades"]]), "now": now()}


# ---------------------------------------------------------------- module API (rt / app call these)
def get(uid: str) -> Journal:
    j = J.get(uid)
    if j is None:
        j = J[uid] = Journal(uid)
    return j


def _cancel_pending(urt, aid: str):
    """A lockout started: cancel the account's waiting entry orders (setting `cancel_pending`), on the event loop."""
    e = urt.engines.get(aid)
    if not e or not e.orders:
        return

    def go():
        for o in list(e.orders):
            try:
                e.cancel(o["id"])
            except Exception as ex:
                log.warning("[%s] journal lockout: cancel %s: %s", urt.label, o.get("id"), ex)
        e.event("Journal lockout: waiting entry orders cancelled", "warn")
    if _loop and _loop.is_running():
        try:
            import asyncio
            asyncio.get_running_loop()
            _loop.call_soon(go)
        except RuntimeError:
            _loop.call_soon_threadsafe(go)
    else:
        go()


def check_lock(urt, aid: str, before: str | None):
    """After something that can start a lockout: if one started (and it blocks), cancel waiting orders."""
    e = urt.engines.get(aid)
    if not e:
        return
    j = get(urt.uid)
    now_r = j.lock_reason(aid, e.trading_day())
    if now_r and not before and j.rules()["cancel_pending"]:
        _cancel_pending(urt, aid)


def on_trade(urt, aid: str, kind: str, obj: dict):
    """The engine's hook: a position opened / added to ("open") or closed ("close")."""
    try:
        j = get(urt.uid)
        if not j.d["synced"]:
            j.sync(urt, full=True)
        e = urt.engines.get(aid)
        if not e:
            return
        a = next((x for x in urt.accounts() if x["id"] == aid), {})
        day = e.trading_day()
        before = j.lock_reason(aid, day)
        size = float(e.rules["size"] or 0)
        key = f"{aid}:{base_id(obj['id'])}"
        was = j.d["trades"].get(key)
        was_status = was["status"] if was else None
        if kind == "close":
            still = any(base_id(p["id"]) == base_id(obj["id"]) and p["id"] != obj["id"] for p in e.positions)
            j.ingest_close(aid, a.get("name", ""), e.mode, size, obj, still)
        else:
            j.upsert_open(aid, a.get("name", ""), e.mode, size, obj, e.trading_day(obj.get("opened")))
        j.save()
        t = j.d["trades"].get(key)
        ph = None
        if t and kind == "open" and was is None:
            ph = "entry"
        elif t and kind == "close" and t["status"] == "closed" and was_status != "closed":
            ph = "exit" if was is not None else None       # closed before the journal saw it open: no pictures
        if ph:
            try:
                jshots.phase(urt, key, ph)
            except Exception as ex:
                log.warning("[%s] journal picture: %s", getattr(urt, "label", "?"), ex)
        if kind == "close":
            check_lock(urt, aid, before)
        if on_change:
            on_change(urt.uid)
    except Exception as ex:
        log.exception("[%s] journal: %s", getattr(urt, "label", "?"), ex)


def guard(urt, aid: str) -> str | None:
    """Paper.guard_new asks this before any new order."""
    try:
        e = urt.engines.get(aid)
        if not e:
            return None
        return get(urt.uid).lock_reason(aid, e.trading_day())
    except Exception as ex:
        log.exception("journal guard: %s", ex)
        return None


def lock_state(urt, aid: str) -> dict | None:
    """For the engine's snapshot (the ticket shows it)."""
    try:
        e = urt.engines.get(aid)
        if not e:
            return None
        lk = get(urt.uid).today_state(aid, e.trading_day())["lock"]
        return lk
    except Exception:
        return None
