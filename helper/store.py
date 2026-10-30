"""Small JSON files in the data folder (outside the git checkout, so updates never touch them)."""
import json
import os
import threading
from pathlib import Path

DATA_DIR = Path(os.environ.get("FYERS_HELPER_DATA", "/home/helper/data"))
_lock = threading.Lock()


def path(name: str) -> Path:
    """A file in the data folder; names may have sub-folders (u/<user>/a/<account>/paper.json)."""
    p = DATA_DIR / name
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def load(name: str, default=None):
    p = path(name)
    if not p.exists():
        return {} if default is None else default
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {} if default is None else default


def save(name: str, data) -> None:
    """Write atomically, readable by the helper user only."""
    p = path(name)
    tmp = p.with_suffix(p.suffix + ".tmp")
    with _lock:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1)
        os.chmod(tmp, 0o600)
        os.replace(tmp, p)
