"""Logging to the console (journald) and to a ring buffer the page's admin screen can read."""
import collections
import logging
import time

_buf = collections.deque(maxlen=500)


class _BufHandler(logging.Handler):
    def emit(self, record):
        try:
            _buf.append({"t": time.time(), "lvl": record.levelname, "src": record.name, "msg": self.format(record)})
        except Exception:
            pass


def setup() -> None:
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    fmt = logging.Formatter("%(message)s")
    h = _BufHandler()
    h.setFormatter(fmt)
    root.addHandler(h)
    s = logging.StreamHandler()
    s.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root.addHandler(s)
    for noisy in ("httpx", "urllib3", "websocket", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def recent(n: int = 200):
    return list(_buf)[-n:]
