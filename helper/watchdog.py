"""The watchdog: a process of its own (fyers-watchdog.service), so it still works when the helper has crashed or hung.

Every 5 s it asks the helper (GET /api/ping) and reads the helper's heartbeat (watch.json, written every 5 s with the
open live trades). If the helper hasn't answered for `down_sec` (30 s) and the last heartbeat had a Live position or
an order at Fyers, it sends each such user a Telegram message (their own bot and chat, telegram.json), a reminder every
`repeat_min` minutes while it stays down, and "back" when it answers again. Outside market hours the messages are
silent (no sound).

The outside heartbeat (optional, Healthchecks.io or anything with a ping URL): pinged every minute while a live trade is
open; when flat it pauses the check (with the API key) so the service only alarms during live trades. Without the key
it pings all the time. If the whole server is down nothing here can send: the outside service sends its own alert.

Run:  python -m helper.watchdog            (env: FYERS_HELPER_DATA; WATCHDOG_URL, WATCHDOG_EVERY for tests)"""
import datetime
import json
import logging
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request

from . import store, telegram, users

log = logging.getLogger("watchdog")
URL = os.environ.get("WATCHDOG_URL", "http://127.0.0.1:8000/api/ping")
EVERY = float(os.environ.get("WATCHDOG_EVERY", "5"))
HB_STALE = float(os.environ.get("WATCHDOG_HB_STALE", "30"))       # seconds without a heartbeat = its loop has stopped
HC_EVERY = float(os.environ.get("WATCHDOG_HC_EVERY", "60"))
HB, WD = "watch.json", "watchdog.json"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def probe(url: str = URL, timeout: float = 5) -> tuple:
    """(answering, why not)."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            j = json.loads(r.read().decode() or "{}")
            return (True, "") if j.get("ok") else (False, "it answered, but not as expected")
    except urllib.error.HTTPError as e:
        return False, f"it answered with an error (HTTP {e.code})"
    except urllib.error.URLError as e:
        if isinstance(e.reason, ConnectionRefusedError):
            return False, "the helper isn't running (crashed, or restarting)"
        if isinstance(e.reason, (socket.timeout, TimeoutError)):
            return False, "the helper doesn't answer (stuck or overloaded)"
        return False, f"no answer ({e.reason})"
    except (socket.timeout, TimeoutError):
        return False, "the helper doesn't answer (stuck or overloaded)"
    except Exception as e:
        return False, f"no answer ({e.__class__.__name__})"


def hc_api(url: str) -> tuple:
    """(API base, check UUID) for pausing, from a ping URL like https://hc-ping.com/<uuid> or https://host/ping/<uuid>."""
    m = UUID.search(url or "")
    if not m:
        return None, None
    u = urllib.parse.urlparse(url)
    base = os.environ.get("HC_API") or ("https://healthchecks.io" if u.netloc.endswith("hc-ping.com") else
                                         f"{u.scheme}://{u.netloc}{u.path.split('/ping/')[0] if '/ping/' in u.path else ''}")
    return base.rstrip("/"), m.group(0)


def _http(url: str, method: str = "GET", headers: dict | None = None, timeout: float = 10) -> int:
    req = urllib.request.Request(url, data=b"" if method == "POST" else None, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status


class Watchdog:
    def __init__(self, now=time.time, prober=probe, http=_http):
        self.now, self.prober, self.http = now, prober, http
        self.down_since = None
        self.why = ""
        self.sent_at: dict = {}            # uid -> when the last "down" message went
        self.hc: dict = {}                 # uid -> {"last", "paused", "ok", "err"}

    def step(self) -> dict:
        asked = self.now()
        ok, why = self.prober()
        now = self.now()                   # after the answer (a hung helper takes the whole 5 s timeout)
        hb = store.load(HB, {})
        age = now - float(hb.get("t") or 0)
        if ok and hb and age > HB_STALE:
            ok, why = False, f"it answers, but its background work has stopped (no heartbeat for {telegram.dur(age)})"
        live = hb.get("users") or {}
        if ok:
            if self.down_since is not None:
                gone = now - self.down_since
                log.warning("Helper answering again after %s", telegram.dur(gone))
                for uid in list(self.sent_at):
                    self._send(uid, self._back_text(gone, (live.get(uid) or {}).get("live") or [], now), live.get(uid))
            self.down_since, self.why, self.sent_at = None, "", {}
        else:
            if self.down_since is None:
                self.down_since = asked
                log.warning("Helper not answering: %s", why)
            self.why = why
            for uid, u in live.items():
                s = telegram.load(uid)
                A = s["alerts"]
                if not telegram.ready(s) or not A.get("down") or now - self.down_since < A["down_sec"]:
                    continue
                last = self.sent_at.get(uid)
                rep = A["repeat_min"] * 60
                if last is None or (rep and now - last >= rep):
                    if self._send(uid, self._down_text(u, hb, now, s), u):
                        self.sent_at[uid] = now
        for u in users.all_users():
            try:
                self._hc(u["uid"], uid_live=bool(live.get(u["uid"])), now=now)
            except Exception as e:
                log.warning("outside heartbeat (%s): %s", u["uid"], e)
        st = {"t": now, "pid": os.getpid(), "up": ok, "why": self.why, "down_since": self.down_since,
              "hb_age": round(age, 1) if hb else None, "hc": self.hc}
        store.save(WD, st)
        return st

    # ------------------------------------------------------------ messages
    def _silent(self, u: dict | None) -> bool:
        syms = [p["s"] for a in (u or {}).get("live") or [] for p in a.get("positions") or []]
        t = datetime.datetime.fromtimestamp(self.now(), telegram.IST)
        return not any(telegram.market_open(s, t) for s in syms) if syms else True

    def _send(self, uid: str, text: str, u: dict | None) -> bool:
        return telegram.send_user(uid, text, silent=self._silent(u), who="watchdog")

    def _down_text(self, u: dict, hb: dict, now: float, s: dict) -> str:
        lines = telegram.trade_lines(u.get("live") or [])
        t = [f"🔴 <b>Trade Manager isn't responding</b> ({telegram.dur(now - self.down_since)}, since "
             f"{telegram.ist_hm(self.down_since)} IST): {telegram.esc(self.why)}.",
             f"Live trades, as last seen at {telegram.ist_hm(hb.get('t'))} IST:"] + lines + [
             "Stops already at Fyers stay in force. Trailing, BE, targets, square-off and the server's own stop check are "
             "paused until it's back: watch these in the Fyers app."]
        if s.get("link"):
            t.append(telegram.esc(s["link"]))
        rep = s["alerts"]["repeat_min"]
        if rep:
            t.append(f"<i>Next reminder in {rep} min if it's still down.</i>")
        return "\n".join(t)

    def _back_text(self, gone: float, accts: list, now: float) -> str:
        t = [f"🟢 <b>Trade Manager is answering again</b> (down {telegram.dur(gone)}, back at {telegram.ist_hm(now)} IST). "
             "It reads Fyers' order book first (anything that filled meanwhile is booked), then trailing, BE and targets carry on."]
        lines = telegram.trade_lines(accts)
        t += (["Live trades now:"] + lines) if lines else ["No live trades open now."]
        return "\n".join(t)

    # ------------------------------------------------------------ the outside heartbeat
    def _hc(self, uid: str, uid_live: bool, now: float):
        s = telegram.load(uid)
        hc = s.get("hc") or {}
        url = hc.get("url")
        if not url:
            self.hc.pop(uid, None)
            return
        try:
            key = users.unseal(hc.get("key") or "") or ""
        except Exception:
            key = ""
        base, uuid = hc_api(url)
        can_pause = bool(key and uuid)
        st = self.hc.setdefault(uid, {"last": 0, "paused": None, "ok": None, "err": None})
        st["mode"] = "live trades only" if can_pause else "always"
        if uid_live or not can_pause:
            if now - st["last"] >= HC_EVERY:
                st["last"] = now
                try:
                    self.http(url)
                    st.update(ok=now, err=None, paused=False)
                except Exception as e:
                    st["err"] = f"ping failed: {e}"
        elif st["paused"] is not True:
            try:
                self.http(f"{base}/api/v3/checks/{uuid}/pause", "POST", {"X-Api-Key": key})
                st.update(paused=True, err=None, paused_at=now)
            except Exception as e:
                st["err"] = f"pause failed: {e}"


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    log.info("Watchdog started: asking %s every %ss", URL, EVERY)
    w = Watchdog()
    while True:
        up = True
        try:
            up = w.step()["up"]
        except Exception as e:
            log.exception("watchdog step: %s", e)
        time.sleep(EVERY if up else min(EVERY, 5))         # closer checks while it's down


if __name__ == "__main__":
    main()
