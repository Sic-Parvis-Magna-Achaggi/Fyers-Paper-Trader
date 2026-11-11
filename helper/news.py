"""High-impact economic news for the MT5 accounts' news guard (roadmap 8 b3): ForexFactory's weekly calendar (owner's
choice, 10 Nov 2026), read by the server about once an hour and kept in data/news/ff.json (so a restart, or ForexFactory
being unreachable for a while, keeps the week's events).

The feed is ForexFactory's own export of this week's calendar (Fair Economy, Inc.): a JSON list of events with title,
country (the currency: USD, EUR, ... or ALL), date (ISO, with its offset), impact (High / Medium / Low / Holiday), forecast
and previous. Only High impact counts for FundingPips' rule. FundingPips' own dashboard calendar stays the official one.

FTM_NEWS_URL overrides the address (tests use a local file or a fake server)."""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import threading
import time
import urllib.request

from . import store

log = logging.getLogger("news")
URL = os.environ.get("FTM_NEWS_URL") or "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
EVERY = 3600          # read the feed this often
RETRY = 900           # after a failure, try again after this long
KEEP = 8 * 86400      # events kept (last week's stay, so a Monday-morning window isn't lost when the feed turns over)
FILE = "news/ff.json"
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
_lock = threading.Lock()
_S: dict = {"events": None, "at": 0, "err": None, "tried": 0, "busy": False}


def _load():
    if _S["events"] is None:
        d = store.load(FILE, {})
        _S["events"] = d.get("events") or []
        _S["at"] = d.get("at") or 0
        _S["err"] = d.get("err")


def parse(raw) -> list:
    """ForexFactory's JSON -> [{t: UTC seconds, cur, title, impact}]. Unparseable rows are skipped."""
    out = []
    for e in raw if isinstance(raw, list) else []:
        try:
            t = dt.datetime.fromisoformat(str(e.get("date")).replace("Z", "+00:00"))
            if t.tzinfo is None:
                t = t.replace(tzinfo=dt.timezone(dt.timedelta(hours=-5)))   # (the feed gives an offset; just in case)
            out.append({"t": int(t.timestamp()), "cur": str(e.get("country") or "").upper()[:6],
                        "title": str(e.get("title") or "")[:120], "impact": str(e.get("impact") or "").capitalize()[:10],
                        "forecast": str(e.get("forecast") or "")[:20], "previous": str(e.get("previous") or "")[:20]})
        except (TypeError, ValueError, AttributeError):
            continue
    return out


def refresh(force: bool = False) -> dict:
    """Blocking: read the feed (call from a worker thread). Merges with what's kept (old weeks drop after KEEP)."""
    with _lock:
        _load()
        now = time.time()
        if not force and (now - _S["at"] < EVERY or now - _S["tried"] < RETRY):
            return status()
        _S["tried"] = now
        try:
            if URL.startswith("file://"):
                raw = json.loads(open(URL[7:], encoding="utf-8").read())
            else:
                req = urllib.request.Request(URL, headers={"User-Agent": "FyersTradeManager/1 (news guard)"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    raw = json.loads(r.read().decode("utf-8", "replace"))
            got = parse(raw)
            if not got:
                raise ValueError("no events in the answer")
            keep = {(e["t"], e["cur"], e["title"]): e for e in _S["events"] if e["t"] > now - KEEP}
            for e in got:
                keep[(e["t"], e["cur"], e["title"])] = e
            _S["events"] = sorted(keep.values(), key=lambda e: e["t"])
            _S["at"], _S["err"] = now, None
            log.info("ForexFactory calendar: %d events (%d high impact)", len(got), len([e for e in got if e["impact"] == "High"]))
        except Exception as e:                       # noqa: BLE001 - keep the events we have
            _S["err"] = f"{type(e).__name__}: {e}"[:200]
            log.warning("ForexFactory calendar not read: %s", _S["err"])
        store.save(FILE, {"at": _S["at"], "err": _S["err"], "events": _S["events"]})
        return status()


def tick(loop) -> None:
    """From the helper's 5-second loop: read the feed when it's due (in a worker thread)."""
    _load()
    now = time.time()
    if _S["busy"] or (now - _S["at"] < EVERY) or now - _S["tried"] < RETRY:
        return
    _S["busy"] = True

    def go():
        try:
            refresh()
        finally:
            _S["busy"] = False
    loop.run_in_executor(None, go)


def status() -> dict:
    _load()
    return {"src": "ForexFactory", "at": int(_S["at"]) or None, "err": _S["err"], "n": len(_S["events"] or [])}


def high(curs: set):
    _load()
    curs = {c.upper() for c in curs}
    for e in _S["events"] or []:
        if e.get("impact") == "High" and (e["cur"] in curs or e["cur"] == "ALL"):
            yield e


def inside(curs: set, minutes: float, t: float | None = None):
    """A high-impact event on these currencies within ±minutes of now (FundingPips' Master window), or None."""
    t = t or time.time()
    w = minutes * 60
    return next((e for e in high(curs) if e["t"] - w <= t <= e["t"] + w), None)


def next_event(curs: set, warn_min: float, win_min: float, t: float | None = None):
    """The next high-impact event within warn_min minutes ahead, or one whose ±win_min window is on now."""
    t = t or time.time()
    return next((e for e in high(curs) if e["t"] - warn_min * 60 <= t <= e["t"] + win_min * 60), None)


def upcoming(curs: set, within: float, t: float | None = None) -> list:
    t = t or time.time()
    return [e for e in high(curs) if t - 600 <= e["t"] <= t + within]


def ist(ts: float) -> str:
    d = dt.datetime.fromtimestamp(ts, IST)
    return d.strftime("%a %H:%M") if abs(ts - time.time()) > 20 * 3600 else d.strftime("%H:%M")


def set_events(evs: list) -> None:
    """Tests: put events in directly."""
    with _lock:
        _load()
        _S["events"] = sorted(evs, key=lambda e: e["t"])
        _S["at"] = time.time()
