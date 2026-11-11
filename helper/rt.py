"""What runs for each user: their Fyers connection, their price feed, and their accounts (each a Paper engine, or
for the admin a LiveEngine with real orders at Fyers, that keeps working - stops, targets, trailing, square-off -
with the page closed). A user with a Live account also has one Fyers order-update socket.

Files:  u/<user>/fyers.json, prefs.json, scripts.json, candles.db, accounts.json
        u/<user>/a/<account>/paper.json, paper_rules.json, paper_trades.json (+ archives)
        u/<admin>/a/mt5-<login>/ (+ mt5_deals.json): an MT5 account (roadmap 8 b1), one per MT5 login whose terminal
        runs the FTM Bridge EA; made the first time that terminal calls, the admin's only"""
import logging
import secrets
import shutil
import time

from . import chartalerts, journal, mt5, mt5acct, store, users
from .feedcheck import FC
from .feed import Feed
from .fyers_link import FyersLink
from .live import LiveEngine
from .mt5acct import Mt5Engine
from .paper import DEFAULT_RULES, Paper, Refused

log = logging.getLogger("rt")
RT: dict = {}                  # uid -> UserRT
LIVE_ID = "live"               # the Live account: the admin's Fyers account itself (v0.33.0), u/<admin>/a/live/
_loop = None
on_engine_change = None        # app callback(user_rt, account_id, event)


class UserRT:
    def __init__(self, uid: str):
        self.uid = uid
        u = users.get(uid) or {}
        self.label = u.get("username", uid)
        self.dir = f"u/{uid}/"
        self.link = FyersLink(self.dir, self.label)
        self.feed = Feed(self.link, self.label)
        self.engines: dict = {}
        self.role = u.get("role", "user")
        self.ostream = None                        # Fyers order updates (only with a Live account)
        self.loop = None
        self.feed.extra = self.watch_symbols
        self.feed.on_tick = self.on_tick
        self.feed.mt5 = lambda: mt5.brief(uid)     # the MT5 bridge's state for the price pill
        self.feed.alert_syms = lambda: chartalerts.book(self).symbols()   # the alerts' symbols (v0.38.0), after the pages'
        self._mt5_none = None                      # the MT5 side's empty account (before any terminal has called)
        self._migrate_live()
        for a in self.accounts():
            if not a.get("archived"):
                self._open(a)
        if not self.paper_ids():                   # a new user starts with one paper account
            self.create_account("Paper", DEFAULT_RULES["size"])

    # ------------------------------------------------------------ accounts
    def accounts(self) -> list:
        return store.load(self.dir + "accounts.json", {"accounts": []}).get("accounts", [])

    def _save_accounts(self, lst):
        store.save(self.dir + "accounts.json", {"accounts": lst})

    def paper_ids(self) -> list:
        return [a["id"] for a in self.accounts() if not a.get("archived") and a["id"] != LIVE_ID and a.get("mode") != "mt5"
                and a["id"] in self.engines]

    def mt5_ids(self) -> list:
        return [a["id"] for a in self.accounts() if a.get("mode") == "mt5" and a["id"] in self.engines]

    def _migrate_live(self):
        """v0.33.0: Live is no longer a paper account switched to Live. An account switched Live under the old design
        goes back to Paper: its live trades are archived on the server and it starts a fresh paper ledger. Any real
        position it had is picked up by the new Live account from Fyers (the real server had no live trade yet)."""
        lst = self.accounts()
        changed = False
        for a in lst:
            if a.get("mode") == "live" and a["id"] != LIVE_ID:
                folder = f"{self.dir}a/{a['id']}/"
                e = Paper(folder, self.link, a.get("name", ""))
                n_pos, n_ord = len(e.positions), len(e.orders)
                if e.history:
                    store.save(folder + f"paper_trades_until_{time.strftime('%Y%m%d_%H%M%S')}_live.json", e.history)
                e.history = []
                e.save_history()
                cap = float(a.get("capital") or e.rules.get("size") or DEFAULT_RULES["size"])
                e.positions, e.orders, e.day = [], [], {}
                e.acct = {"start": cap, "realized": 0.0, "peak": cap, "created": time.time(), "cycle": e.acct.get("cycle", 1) + 1}
                e.rules["size"] = cap
                store.save(folder + "paper_rules.json", e.rules)
                e.event("v0.33.0: this account is Paper again (Live is now your Fyers account itself, switched at the top "
                        "left). Its live trades are archived on the server" + (f"; {n_pos} position(s) and {n_ord} order(s) "
                        "were dropped here - the Live account reads them from Fyers" if n_pos or n_ord else "") + ".", "warn")
                e.save()                                   # (paper.json is rewritten without the old "live" part)
                a["mode"] = "paper"
                a["capital"] = cap
                changed = True
                users.audit(self.uid, "account back to Paper (v0.33.0)", a.get("name", ""))
                log.warning("[%s] %s: switched Live under the old design - now Paper again", self.label, a.get("name"))
        if changed:
            self._save_accounts(lst)

    def _open(self, a: dict) -> Paper:
        folder = f"{self.dir}a/{a['id']}/"
        if a.get("mode") == "mt5":                 # an MT5 account (roadmap 8 b1): the admin's only, no journal yet (8 c)
            if self.role != "admin":
                return None
            e = Mt5Engine(folder, self.uid, a.get("login") or 0, a.get("name", ""))
            e.siblings = lambda me=e: [x for x in self.engines.values() if isinstance(x, Mt5Engine) and x is not me]
            e.on_change = lambda ev, aid=a["id"]: on_engine_change and on_engine_change(self, aid, ev)
            e.on_symbols = lambda: self.feed._resync()
            self.engines[a["id"]] = e
            return e
        if a["id"] == LIVE_ID:
            if self.role != "admin":
                return None
            e = LiveEngine(folder, self.link, a.get("name", ""), broker=make_broker(self.link), client_id=a.get("client_id"))
        else:
            e = Paper(folder, self.link, a.get("name", ""))
        e.on_change = lambda ev, aid=a["id"]: on_engine_change and on_engine_change(self, aid, ev)
        e.on_symbols = lambda: self.feed._resync()
        e.journal_hook = lambda kind, obj, aid=a["id"]: journal.on_trade(self, aid, kind, obj)
        e.journal_guard = lambda aid=a["id"]: journal.guard(self, aid)
        e.journal_lock = lambda aid=a["id"]: journal.lock_state(self, aid)
        now = time.time()                          # a new engine (an account just made, switched or restored) starts
        for s, t in list(self.feed.last.items()):  # with the prices of the last few seconds, not empty
            if now - self.feed.last_at.get(s, 0) < 10:
                try:
                    e.on_tick(t)
                except Exception:
                    pass
        self.engines[a["id"]] = e
        if isinstance(e, LiveEngine):
            self._ensure_stream()
            e.stream = self.ostream
            if self.loop:
                e.start(self.loop)
        return e

    # ------------------------------------------------------------ live: the order-update socket
    def live_engines(self) -> list:
        return [e for e in self.engines.values() if isinstance(e, LiveEngine)]

    def _ensure_stream(self):
        if self.ostream is None:
            self.ostream = make_stream(self.link, self._order_from_socket, self.label)
            self.ostream.on_connect = self._stream_connected

    def _order_from_socket(self, u: dict):
        """Called on the socket's thread: hand the update to the event loop."""
        if self.loop:
            self.loop.call_soon_threadsafe(self._order_update, u)

    def _order_update(self, u: dict):
        for e in self.live_engines():
            try:
                e.on_update(u)
            except Exception as ex:
                log.exception("[%s] order update: %s", self.label, ex)

    def _stream_connected(self):
        """(Re)connected: read the order book once, in case something happened while it was down."""
        if self.loop:
            for e in self.live_engines():
                self.loop.call_soon_threadsafe(e.enqueue, ("poll",), 3)

    def attach(self, loop):
        self.loop = loop
        self.feed.start(loop)
        for e in self.live_engines():
            e.start(loop)
        try:
            chartalerts.start(self, loop)           # price and technical alerts (v0.38.0), page open or not
        except Exception as ex:
            log.exception("[%s] alerts didn't start: %s", self.label, ex)

    def set_mode(self, aid: str, mode: str, capital: float | None = None) -> dict:
        """Before v0.33.0 a paper account could be switched to Live. Live is now the Fyers account itself (ensure_live),
        switched with the Paper / Live toggle at the top left; paper accounts have no Live option at all."""
        raise Refused("paper accounts have no Live option any more: Live is your Fyers account itself - use the Paper / "
                      "Live switch at the top left")

    # ------------------------------------------------------------ the Live account (the admin's Fyers account)
    def live_engine(self):
        e = self.engines.get(LIVE_ID)
        return e if isinstance(e, LiveEngine) else None

    def live_row(self):
        return next((a for a in self.accounts() if a["id"] == LIVE_ID), None)

    def ensure_live(self, client_id: str) -> dict:
        """The Live account, made the first time the admin switches to Live (the app has checked the typed client ID and
        a fresh 2FA code). From then on it runs all the time, whichever side the page is on."""
        if self.role != "admin":
            raise Refused("Live trading is for the admin only (SEBI / Fyers static-IP rules)")
        client_id = str(client_id or "").strip().upper()
        lst = self.accounts()
        a = next((x for x in lst if x["id"] == LIVE_ID), None)
        if a and a.get("client_id") and client_id and a["client_id"] != client_id:
            raise Refused(f"the Live account is Fyers client {a['client_id']}, but you're logged in to Fyers as {client_id} "
                          f"- log in to Fyers as {a['client_id']}")
        if not a:
            a = {"id": LIVE_ID, "name": client_id or "Live", "mode": "live", "kind": "live", "client_id": client_id,
                 "created": time.time()}
            lst.append(a)
            self._save_accounts(lst)
            users.audit(self.uid, "Live account created", client_id)
        if LIVE_ID not in self.engines:
            self._open(a)
            self.feed._resync()
        return a

    # ------------------------------------------------------------ MT5 accounts (roadmap 8 b1)
    def ensure_mt5(self, login: int, info: dict | None = None):
        """The account of an MT5 login, made the first time its terminal calls with the EA (the admin's only)."""
        if self.role != "admin":
            return None
        login = int(login)
        aid = f"{mt5acct.PREFIX}{login}"
        info = info or {}
        lst = self.accounts()
        a = next((x for x in lst if x["id"] == aid), None)
        keep = {k: info.get(k) for k in ("server", "company", "demo", "currency") if info.get(k) is not None}
        if not a:
            a = {"id": aid, "name": str(login), "mode": "mt5", "kind": "mt5", "login": login, "created": time.time(), **keep}
            lst.append(a)
            self._save_accounts(lst)
            users.audit(self.uid, "MT5 account added", f"{login} {info.get('server', '')}")
            log.warning("[%s] MT5 account %s (%s) added", self.label, login, info.get("server", ""))
        elif any(a.get(k) != v for k, v in keep.items()):
            a.update(keep)
            self._save_accounts(lst)
        e = self.engines.get(aid)
        if e is None:
            e = self._open(a)
            self.feed._resync()
        return e

    def mt5_none(self):
        if self._mt5_none is None:
            self._mt5_none = mt5acct.empty(self.uid)
        return self._mt5_none

    def engine_id(self, e) -> str:
        return next((k for k, v in self.engines.items() if v is e), mt5acct.NONE_ID if isinstance(e, Mt5Engine) else "")

    def engine(self, aid: str | None) -> Paper:
        if aid and aid in self.engines:
            return self.engines[aid]
        if aid and str(aid).startswith(mt5acct.PREFIX):  # an MT5 account that isn't there (yet): the empty one, never paper
            return self.mt5_none()
        ids = self.paper_ids()                       # an unknown account: the first paper account (never the Live one)
        if not ids:
            self.create_account("Paper", DEFAULT_RULES["size"])
            ids = self.paper_ids()
        return self.engines[ids[0]]

    def account_list(self) -> list:
        out = []
        for a in self.accounts():
            e = self.engines.get(a["id"])
            row = dict(a)
            row["mode"] = "live" if a["id"] == LIVE_ID else "mt5" if a.get("mode") == "mt5" else "paper"
            if (a["id"] == LIVE_ID or row["mode"] == "mt5") and not e:
                continue
            if e:
                row.update(balance=e.balance(), equity=e.equity(), open=len(e.positions), orders=len(e.orders))
                if isinstance(e, LiveEngine) and not e._F():       # (no Fyers funds read yet: no made-up balance)
                    row.update(balance=None, equity=None)
                if isinstance(e, Mt5Engine):
                    row.update(online=e.online(), currency=e.ccy(), ea=e.ea, server=e.info.get("server") or a.get("server"),
                               demo=e.info.get("demo", a.get("demo")))
                    if not e.info:
                        row.update(balance=None, equity=None)
            out.append(row)
        return out

    def create_account(self, name: str, capital: float, copy_from: str | None = None) -> dict:
        name = (name or "").strip()[:40]
        if not name:
            raise Refused("give the account a name")
        if capital <= 0:
            raise Refused("capital must be above 0")
        lst = self.accounts()
        if len([a for a in lst if not a.get("archived") and a["id"] != LIVE_ID and a.get("mode") != "mt5"]) >= 20:
            raise Refused("20 accounts at most - archive one first")
        if any(a["name"].lower() == name.lower() and not a.get("archived") for a in lst):
            raise Refused(f'you already have an account called "{name}"')
        a = {"id": "a" + secrets.token_hex(4), "name": name, "mode": "paper", "capital": capital, "created": time.time()}
        if copy_from and copy_from in self.engines:              # copy rules and trailing from another account
            src = self.engines[copy_from]
            store.save(f"{self.dir}a/{a['id']}/paper_rules.json", {**src.rules, "size": capital})
            store.save(f"{self.dir}a/{a['id']}/paper.json", {"trail": src.trail, "ticket": src.ticket})
        else:
            store.save(f"{self.dir}a/{a['id']}/paper_rules.json", {"size": capital})
        lst.append(a)
        self._save_accounts(lst)
        e = self._open(a)
        e.acct.update(start=capital, peak=capital)
        e.save()
        self.feed._resync()
        users.audit(self.uid, "account created", f"{name} (₹{capital:,.0f})")
        return a

    def update_account(self, aid: str, name=None, archived=None) -> dict:
        lst = self.accounts()
        a = next((x for x in lst if x["id"] == aid), None)
        if not a:
            raise Refused("no such account")
        if aid == LIVE_ID:
            raise Refused("the Live account is your Fyers account itself (named by its client ID): it can't be renamed or archived")
        if a.get("mode") == "mt5":
            raise Refused("an MT5 account is your MT5 login itself (it appears when its terminal runs the EA): it can't be renamed or archived")
        if name is not None:
            name = name.strip()[:40]
            if not name:
                raise Refused("give the account a name")
            if any(x["name"].lower() == name.lower() and x["id"] != aid and not x.get("archived") for x in lst):
                raise Refused(f'you already have an account called "{name}"')
            a["name"] = name
            if aid in self.engines:
                self.engines[aid].name = name
        if archived is not None:
            if archived:
                e = self.engines.get(aid)
                if e and (e.positions or e.orders):
                    raise Refused("close its positions and cancel its orders first")
                if len([x for x in lst if not x.get("archived") and x["id"] != LIVE_ID and x.get("mode") != "mt5"]) <= 1:
                    raise Refused("keep at least one paper account")
                a["archived"] = time.time()
                old = self.engines.pop(aid, None)
                if isinstance(old, LiveEngine):
                    old.stop()
            else:
                a.pop("archived", None)
                self._open(a)
            users.audit(self.uid, "account " + ("archived" if archived else "restored"), a["name"])
        self._save_accounts(lst)
        self.feed._resync()
        return a

    # ------------------------------------------------------------ prices for every account of this user
    def watch_symbols(self) -> list:
        out = set()
        for e in self.engines.values():
            out |= set(e.watch_symbols())
        if self.role == "admin":                   # the order-flow check records the admin's feed (feedcheck.py)
            out |= set(FC.symbols())
        return sorted(out)

    def on_tick(self, t: dict):
        if self.role == "admin":
            try:
                FC.record(t)
            except Exception as ex:
                log.warning("feed check: %s", ex)
        for e in list(self.engines.values()):
            try:
                e.on_tick(t)
            except Exception as ex:
                log.exception("[%s] tick: %s", self.label, ex)
        b = chartalerts.BOOKS.get(self.uid)
        if b:
            try:
                b.on_tick(t)
            except Exception as ex:
                log.exception("[%s] alerts tick: %s", self.label, ex)

    def housekeeping(self):
        for e in list(self.engines.values()):
            try:
                e.housekeeping()
            except Exception as ex:
                log.exception("[%s] housekeeping: %s", self.label, ex)

    def stop(self):
        chartalerts.drop(self.uid)
        self.feed.stop()
        if self.ostream:
            self.ostream.stop()
        for e in self.engines.values():
            if isinstance(e, LiveEngine):
                e.stop()
            e.save()


def start(loop):
    global _loop
    _loop = loop
    journal._loop = loop
    for u in users.all_users():
        if not u["disabled"]:
            r = get(u["uid"])
            try:                                   # the journal takes in any trade it hasn't seen (also archives)
                journal.get(u["uid"]).sync(r, full=True)
            except Exception as ex:
                log.exception("[%s] journal sync: %s", r.label, ex)


def get(uid: str) -> UserRT:
    r = RT.get(uid)
    if r is None:
        r = RT[uid] = UserRT(uid)
        if _loop:
            r.attach(_loop)
    return r


# ---------------------------------------------------------------- the MT5 bridge's hooks (helper/mt5.py's sync call)
def _mt5_report(uid, bridge, body):
    r = get(uid)
    if r.role != "admin":
        return []
    e = r.ensure_mt5(bridge.login, bridge.info)
    if e is None:
        return []
    if "pos" not in body:                          # EA 1.00: prices only - the account shows, its trades need 1.10
        e.seen, e.ea = time.time(), str(body.get("ea") or "")[:12]
        e.M["info"] = {**(bridge.info or {}), "at": time.time()}
        return []
    return e.on_report(body, bridge)


def _mt5_watch(uid, login):
    r = RT.get(uid)
    e = r and r.engines.get(f"{mt5acct.PREFIX}{int(login)}")
    return [s[len(mt5.PREFIX):] for s in e.watch_symbols()] if e else []


def _mt5_tick(uid, login, tick):
    r = RT.get(uid)
    e = r and r.engines.get(f"{mt5acct.PREFIX}{int(login)}")
    if e:
        try:
            e.on_tick(tick)
        except Exception as ex:
            log.exception("[%s] MT5 tick: %s", r.label, ex)


mt5.REPORT, mt5.WATCH, mt5.TICK = _mt5_report, _mt5_watch, _mt5_tick


def make_broker(link):
    """Fyers' order API (tests swap in a fake)."""
    from .broker import FyersBroker
    return FyersBroker(link)


def make_stream(link, on_order, label):
    from .broker import OrderStream
    return OrderStream(link, on_order, label)


def drop(uid: str):
    r = RT.pop(uid, None)
    if r:
        r.stop()


# ---------------------------------------------------------------- moving the single-user files into the first user
LEGACY = ["fyers.json", "prefs.json", "scripts.json", "candles.db", "candles.db-wal", "candles.db-shm"]
LEGACY_ACCT = ["paper.json", "paper_rules.json", "paper_trades.json"]


def migrate(uid: str) -> None:
    """Version 0.12 and earlier kept one user's files at the top of the data folder. Move them into u/<uid>/
    and the paper account into u/<uid>/a/<main>/, once."""
    root = store.path("x").parent
    udir = root / "u" / uid
    if (udir / "accounts.json").exists():
        return
    moved = []
    udir.mkdir(parents=True, exist_ok=True)
    for f in LEGACY:
        if (root / f).exists() and not (udir / f).exists():
            shutil.move(str(root / f), str(udir / f))
            moved.append(f)
    aid = "a" + secrets.token_hex(4)
    adir = udir / "a" / aid
    adir.mkdir(parents=True, exist_ok=True)
    for f in LEGACY_ACCT + [p.name for p in root.glob("paper_trades_until_*.json")]:
        if (root / f).exists():
            shutil.move(str(root / f), str(adir / f))
            moved.append(f)
    rules = store.load(f"u/{uid}/a/{aid}/paper_rules.json")
    store.save(f"u/{uid}/accounts.json", {"accounts": [{"id": aid, "name": "Main", "mode": "paper",
                                                         "capital": rules.get("size", DEFAULT_RULES["size"]), "created": time.time()}]})
    # the Fyers secret and token are encrypted from now on
    f = FyersLink(f"u/{uid}/")
    s = f.settings()
    if s:
        f._save(s)
    log.warning("Moved the existing set-up into user %s: %s", uid, ", ".join(moved) or "nothing to move")
