"""Daily check of Fyers' charges page. If the page's rates text changes, the app shows what changed and waits
for you to review it (Account -> Charges). It never changes a rate by itself: a misread web page would
otherwise put wrong numbers into every P&L. The first check just records the page as it is."""
import difflib
import hashlib
import logging
import re
import time

import httpx

from . import store

log = logging.getLogger("charges")
URLS = ["https://fyers.in/charges-list.md", "https://fyers.in/charges-list"]
FILE = "charges_check.json"
EVERY = 20 * 3600         # check about once a day


def _rate_lines(text: str) -> list:
    """The lines that carry rates (%, Rs / ₹, per crore / lakh), tidied so layout changes don't count."""
    text = re.sub(r"<[^>]+>", "\n", text)                      # in case the HTML page is what we got
    out = []
    for ln in text.splitlines():
        ln = re.sub(r"\s+", " ", ln).strip(" |*-#\t")
        if not ln or re.search(r"generated|updated on|last updated|\b20\d\d-\d\d-\d\d\b", ln, re.I):
            continue
        if re.search(r"%|₹|\bRs\.?\b|per crore|per lakh|\bINR\b", ln, re.I):
            out.append(ln)
    return out


def status() -> dict:
    s = store.load(FILE, {})
    return {"checked": s.get("checked"), "changed": bool(s.get("changed")), "changed_at": s.get("changed_at"),
            "diff": s.get("diff") or [], "error": s.get("error"), "url": s.get("url"), "reviewed": s.get("reviewed")}


def due() -> bool:
    return time.time() - (store.load(FILE, {}).get("checked") or 0) > EVERY


def check() -> dict:
    """Fetch the page, compare its rate lines with the ones you last reviewed. Blocking (run in a thread)."""
    s = store.load(FILE, {})
    text, url, err = None, None, None
    for u in URLS:
        try:
            r = httpx.get(u, timeout=30, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (trade manager charges check)"})
            r.raise_for_status()
            if len(_rate_lines(r.text)) >= 5:
                text, url = r.text, u
                break
            err = f"{u}: no rates found on the page"
        except Exception as e:  # noqa: BLE001
            err = f"{u}: {e}"
    s["checked"] = time.time()
    if text is None:
        s["error"] = err
        store.save(FILE, s)
        log.warning("Charges check failed: %s", err)
        return status()
    lines = _rate_lines(text)
    h = hashlib.sha256("\n".join(lines).encode()).hexdigest()
    s.update(error=None, url=url, last_hash=h, last_lines=lines)
    if not s.get("reviewed_hash"):                              # first check: this is the baseline
        s.update(reviewed_hash=h, reviewed_lines=lines, reviewed=time.time(), changed=False, diff=[])
        log.info("Charges check: recorded Fyers' charges page (%d rate lines)", len(lines))
    elif h != s["reviewed_hash"]:
        if not s.get("changed"):
            s["changed_at"] = time.time()
            log.warning("Fyers' charges page has changed since it was last reviewed - see Account -> Charges")
        s["changed"] = True
        s["diff"] = [d for d in difflib.unified_diff(s.get("reviewed_lines") or [], lines, "reviewed", "now", n=0, lineterm="")
                     if not d.startswith(("---", "+++", "@@"))][:80]
    else:
        s.update(changed=False, diff=[])
    store.save(FILE, s)
    return status()


def mark_reviewed() -> dict:
    """You've looked at the changes (and edited the rates if needed): the current page becomes the reference."""
    s = store.load(FILE, {})
    if s.get("last_hash"):
        s.update(reviewed_hash=s["last_hash"], reviewed_lines=s.get("last_lines") or [], reviewed=time.time(), changed=False, diff=[])
        store.save(FILE, s)
    return status()
