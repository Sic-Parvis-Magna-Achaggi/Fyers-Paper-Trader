"""What runs for each user: their Fyers connection, their price feed, and their paper accounts (each a Paper
engine that keeps working - stops, targets, trailing, square-off - with the page closed).

Files:  u/<user>/fyers.json, prefs.json, scripts.json, candles.db, accounts.json
        u/<user>/a/<account>/paper.json, paper_rules.json, paper_trades.json (+ archives)"""
import logging
import secrets
import shutil
import time

from . import store, users
from .feed import Feed
from .fyers_link import FyersLink
from .paper import DEFAULT_RULES, Paper, Refused

log = logging.getLogger("rt")
RT: dict = {}                  # uid -> UserRT
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
        self.feed.extra = self.watch_symbols
        self.feed.on_tick = self.on_tick
        for a in self.accounts():
            if not a.get("archived"):
                self._open(a)
        if not self.engines:                       # a new user starts with one paper account
            self.create_account("Paper", DEFAULT_RULES["size"])

    # ------------------------------------------------------------ accounts
    def accounts(self) -> list:
        return store.load(self.dir + "accounts.json", {"accounts": []}).get("accounts", [])

    def _save_accounts(self, lst):
        store.save(self.dir + "accounts.json", {"accounts": lst})

    def _open(self, a: dict) -> Paper:
        e = Paper(f"{self.dir}a/{a['id']}/", self.link, a.get("name", ""))
        e.on_change = lambda ev, aid=a["id"]: on_engine_change and on_engine_change(self, aid, ev)
        e.on_symbols = lambda: self.feed._resync()
        self.engines[a["id"]] = e
        return e

    def engine(self, aid: str | None) -> Paper:
        if aid and aid in self.engines:
            return self.engines[aid]
        live = [a for a in self.accounts() if not a.get("archived")]
        if not live:
            self.create_account("Paper", DEFAULT_RULES["size"])
            live = [a for a in self.accounts() if not a.get("archived")]
        return self.engines[live[0]["id"]]

    def account_list(self) -> list:
        out = []
        for a in self.accounts():
            e = self.engines.get(a["id"])
            row = dict(a)
            if e:
                row.update(balance=e.balance(), equity=e.equity(), open=len(e.positions), orders=len(e.orders))
            out.append(row)
        return out

    def create_account(self, name: str, capital: float, copy_from: str | None = None) -> dict:
        name = (name or "").strip()[:40]
        if not name:
            raise Refused("give the account a name")
        if capital <= 0:
            raise Refused("capital must be above 0")
        lst = self.accounts()
        if len([a for a in lst if not a.get("archived")]) >= 20:
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
                if len([x for x in lst if not x.get("archived")]) <= 1:
                    raise Refused("keep at least one account")
                a["archived"] = time.time()
                self.engines.pop(aid, None)
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
        return sorted(out)

    def on_tick(self, t: dict):
        for e in list(self.engines.values()):
            try:
                e.on_tick(t)
            except Exception as ex:
                log.exception("[%s] tick: %s", self.label, ex)

    def housekeeping(self):
        for e in list(self.engines.values()):
            try:
                e.housekeeping()
            except Exception as ex:
                log.exception("[%s] housekeeping: %s", self.label, ex)

    def stop(self):
        self.feed.stop()
        for e in self.engines.values():
            e.save()


def start(loop):
    global _loop
    _loop = loop
    for u in users.all_users():
        if not u["disabled"]:
            get(u["uid"])


def get(uid: str) -> UserRT:
    r = RT.get(uid)
    if r is None:
        r = RT[uid] = UserRT(uid)
        if _loop:
            r.feed.start(_loop)
    return r


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
