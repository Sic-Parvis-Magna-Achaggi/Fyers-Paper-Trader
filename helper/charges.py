"""Every rupee a trade costs at Fyers, worked out per executed order.

Rates: Fyers charges list (fyers.in/charges-list, generated 27 Oct 2026) and Fyers' statutory charges page
(updated 1 Apr 2026, after the Budget 2026 STT rise). Percentages are of the order's value: price x qty x
multiplier (for options, the premium).

Each order pays:
  brokerage   futures: Rs 20 or 0.03% of the order value, whichever is lower; options: Rs 20 flat
  exchange    exchange transaction charge
  clearing    clearing charge (Fyers' clearing member)
  ctt / stt   commodity / securities transaction tax - sell side only
  stamp       stamp duty - buy side only
  sebi        SEBI turnover fee, Rs 10 per crore
  ipft        NSE investor protection fund (NSE only)
  gst         18% of brokerage + exchange + clearing + SEBI fee (+ IPFT)
  dp          stocks sold from delivery: Rs 12.5 + GST per sell (depository charge)

Stocks: intraday pays STT 0.025% on the sell; delivery pays STT 0.1% on both sides, stamp 0.015% and brokerage
Rs 20 or 0.3% (lower). Indices can't be traded, so they have no charges.
"""
from __future__ import annotations

AS_OF = "Fyers charges list, 27 Oct 2026 (exchange rates cross-checked with the NSE / BSE schedules)"
CRORE = 1e7
DP_SELL = 12.5 * 1.18     # delivery sell: Rs 12.5 + GST per scrip (CDSL Rs 3.5 + Fyers Rs 9), charged on the sell

_FUT = {"brk_pct": 0.0003, "brk_cap": 20.0}
_OPT = {"brk_flat": 20.0}
_EQI = {"brk_pct": 0.0003, "brk_cap": 20.0, "clearing": 0.0, "tax_sell": 0.00025, "tax_name": "STT", "stamp_buy": 0.00003}
_EQD = {"brk_pct": 0.003, "brk_cap": 20.0, "clearing": 0.0, "tax_sell": 0.001, "tax_buy": 0.001, "tax_name": "STT",
        "stamp_buy": 0.00015, "dp_sell": DP_SELL}
_S = {"sebi": 10 / CRORE}

# (exchange, kind) -> rates as fractions of order value. Kinds: EQ_I / EQ_D (stocks intraday / delivery), FUT, OPT,
# OPT_IDX (BSE Sensex / Bankex options), CURFUT, CUROPT.
RATES = {
    ("MCX", "FUT"): {**_FUT, **_S, "exchange": 0.000021, "clearing": 0.000018, "tax_sell": 0.0001, "tax_name": "CTT", "stamp_buy": 0.00002, "ipft": 0.0},
    ("MCX", "OPT"): {**_OPT, **_S, "exchange": 0.000418, "clearing": 0.0005, "tax_sell": 0.0005, "tax_name": "CTT", "stamp_buy": 0.00003, "ipft": 0.0},
    ("NSE", "EQ_I"): {**_EQI, **_S, "exchange": 0.000030699, "ipft": 10 / CRORE},
    ("NSE", "EQ_D"): {**_EQD, **_S, "exchange": 0.000030699, "ipft": 10 / CRORE},
    ("BSE", "EQ_I"): {**_EQI, **_S, "exchange": 0.0000375, "ipft": 0.0},
    ("BSE", "EQ_D"): {**_EQD, **_S, "exchange": 0.0000375, "ipft": 0.0},
    ("NSE", "FUT"): {**_FUT, **_S, "exchange": 0.000018299, "clearing": 0.000005, "tax_sell": 0.0005, "tax_name": "STT", "stamp_buy": 0.00002, "ipft": 10 / CRORE},
    ("NSE", "OPT"): {**_OPT, **_S, "exchange": 0.000355299, "clearing": 0.00009, "tax_sell": 0.0015, "tax_name": "STT", "stamp_buy": 0.00003, "ipft": 50 / CRORE},
    ("BSE", "FUT"): {**_FUT, **_S, "exchange": 0.0, "clearing": 0.000005, "tax_sell": 0.0005, "tax_name": "STT", "stamp_buy": 0.00002, "ipft": 0.0},
    ("BSE", "OPT"): {**_OPT, **_S, "exchange": 0.00005, "clearing": 0.00009, "tax_sell": 0.0015, "tax_name": "STT", "stamp_buy": 0.00003, "ipft": 0.0},
    ("BSE", "OPT_IDX"): {**_OPT, **_S, "exchange": 0.000325, "clearing": 0.00009, "tax_sell": 0.0015, "tax_name": "STT", "stamp_buy": 0.00003, "ipft": 0.0},
    ("NSE", "CURFUT"): {**_FUT, **_S, "exchange": 0.0000035, "clearing": 0.000005, "tax_sell": 0.0, "tax_name": "STT", "stamp_buy": 0.000001, "ipft": 5 / CRORE},
    ("NSE", "CUROPT"): {**_OPT, **_S, "exchange": 0.000311, "clearing": 0.00009, "tax_sell": 0.0, "tax_name": "STT", "stamp_buy": 0.000001, "ipft": 200 / CRORE},
    ("BSE", "CURFUT"): {**_FUT, **_S, "exchange": 0.0000045, "clearing": 0.000005, "tax_sell": 0.0, "tax_name": "STT", "stamp_buy": 0.000001, "ipft": 0.0},
    ("BSE", "CUROPT"): {**_OPT, **_S, "exchange": 0.00001, "clearing": 0.000005, "tax_sell": 0.0, "tax_name": "STT", "stamp_buy": 0.000001, "ipft": 0.0},
    ("NSE", "COMFUT"): {**_FUT, **_S, "exchange": 0.000001, "clearing": 0.000018, "tax_sell": 0.0001, "tax_name": "CTT", "stamp_buy": 0.00002, "ipft": 0.0},
    ("NSE", "COMOPT"): {**_OPT, **_S, "exchange": 0.00001, "clearing": 0.0005, "tax_sell": 0.0005, "tax_name": "CTT", "stamp_buy": 0.00003, "ipft": 0.0},
}
LABEL = {"EQ_I": "stocks, intraday", "EQ_D": "stocks, delivery (CNC)", "FUT": "futures", "OPT": "options", "OPT_IDX": "Sensex / Bankex options",
         "CURFUT": "currency futures", "CUROPT": "currency options", "COMFUT": "commodity futures", "COMOPT": "commodity options"}
GST = 0.18
FIELDS = ("brokerage", "exchange", "clearing", "tax", "stamp", "sebi", "ipft", "gst", "dp")

# ---------------------------------------------------------------- your own edits (Account -> Charges)
# Rates can be changed in the app (saved in data/charges_override.json) when Fyers, an exchange or SEBI changes
# one, without waiting for a new version. Edits apply to every calculation straight away; charges already paid
# on open positions stay as they were.
import copy  # noqa: E402
import json  # noqa: E402

DEFAULT_RATES = copy.deepcopy(RATES)
EDITABLE = {  # field -> (label, unit): "pct" values are shown and typed in %, "rs" in rupees, "cr" in rupees per crore
    "brk_pct": ("Brokerage", "pct"), "brk_cap": ("Brokerage cap", "rs"), "brk_flat": ("Brokerage per order", "rs"),
    "exchange": ("Exchange txn", "pct"), "clearing": ("Clearing", "pct"), "tax_sell": ("STT / CTT on sell", "pct"),
    "tax_buy": ("STT on buy", "pct"), "stamp_buy": ("Stamp duty on buy", "pct"), "sebi": ("SEBI fee", "cr"),
    "ipft": ("IPFT", "cr"), "dp_sell": ("DP charge per sell (incl. GST)", "rs"),
}
OVERRIDE_FILE = "charges_override.json"


def _key(ex, kind):
    return f"{ex}|{kind}"


def apply_overrides(o: dict | None = None) -> None:
    """Rebuild RATES from the defaults plus the saved edits."""
    global GST
    if o is None:
        from . import store
        o = store.load(OVERRIDE_FILE, {})
    for k, r in DEFAULT_RATES.items():
        RATES[k] = dict(r)
    for key, vals in (o.get("rates") or {}).items():
        ex, _, kind = key.partition("|")
        if (ex, kind) in RATES and isinstance(vals, dict):
            for f, v in vals.items():
                if f in EDITABLE and isinstance(v, (int, float)) and v >= 0:
                    RATES[(ex, kind)][f] = float(v)
    g = o.get("gst")
    GST = float(g) if isinstance(g, (int, float)) and 0 <= g < 1 else 0.18


def save_overrides(edits: dict) -> dict:
    """edits: {"NSE|EQ_I": {"exchange": 0.0000307, ...}, ...} as fractions (the page converts from %), plus
    optional "gst". Only values that differ from the built-in ones are kept."""
    from . import store
    out = {"rates": {}, "updated": __import__("time").time()}
    for key, vals in (edits.get("rates") or {}).items():
        ex, _, kind = key.partition("|")
        if (ex, kind) not in DEFAULT_RATES or not isinstance(vals, dict):
            raise ValueError(f"unknown segment {key}")
        for f, v in vals.items():
            if f not in EDITABLE:
                raise ValueError(f"unknown charge {f}")
            v = float(v)
            if v < 0 or (EDITABLE[f][1] == "pct" and v > 0.05):
                raise ValueError(f"{key} {EDITABLE[f][0]}: {v} looks wrong")
            if abs(v - DEFAULT_RATES[(ex, kind)].get(f, 0.0)) > 1e-12:
                out["rates"].setdefault(key, {})[f] = v
    if "gst" in edits and edits["gst"] is not None:
        g = float(edits["gst"])
        if not 0 <= g < 1:
            raise ValueError("GST must be a fraction, e.g. 0.18")
        if abs(g - 0.18) > 1e-12:
            out["gst"] = g
    store.save(OVERRIDE_FILE, out)
    apply_overrides(out)
    return out


def editable() -> dict:
    """Everything the Charges editor shows: each segment's current value, the built-in value, and units."""
    from . import store
    o = store.load(OVERRIDE_FILE, {})
    segs = []
    for (ex, kind), r in RATES.items():
        d = DEFAULT_RATES[(ex, kind)]
        segs.append({"key": _key(ex, kind), "label": f"{ex} {LABEL.get(kind, kind)}",
                     "fields": [{"f": f, "label": EDITABLE[f][0], "unit": EDITABLE[f][1], "value": r.get(f), "default": d.get(f)}
                                for f in EDITABLE if f in d or f in r]})
    return {"segments": segs, "gst": GST, "updated": o.get("updated"), "edited": bool(o.get("rates") or "gst" in o)}


def kind_of(row: dict) -> tuple:
    ex = row.get("x") or row["s"].split(":", 1)[0]
    f, g = row.get("f"), row.get("g")
    if g == "CM" or f in ("EQ", "OTHER", "IDX"):
        return ex, "EQ_D" if row.get("prod") == "CNC" else "EQ_I"
    if g == "CD":
        return ex, "CUROPT" if f == "OPT" else "CURFUT"
    if g == "COM" and ex == "NSE":
        return ex, "COMOPT" if f == "OPT" else "COMFUT"
    if ex == "BSE" and f == "OPT" and row.get("u") in ("SENSEX", "BANKEX"):
        return ex, "OPT_IDX"
    return ex, "OPT" if f == "OPT" else "FUT"


def rates_for(row: dict) -> dict:
    ex, k = kind_of(row)
    return RATES.get((ex, k)) or RATES[("MCX", "OPT" if k.endswith("OPT") else "FUT")]


def value(row: dict, qty: float, price: float) -> float:
    """Order value in rupees. qty is in Fyers units (MCX: lots; NSE: shares)."""
    return abs(price) * qty * (row.get("mult") or 1)


# ---------------------------------------------------------------- MT5 accounts (roadmap 8 b): $, net of commission and swap
# An MT5 account's engine (helper/mt5acct.py) passes rows with x == "MT5" and these keys:
#   tick, tv     MT5's tick size and the value of one tick for 1 lot, in the account's currency (SYMBOL_TRADE_TICK_VALUE)
#   vstep        the volume step (0.01 lot): the engine's qty is a whole number of steps, so lots stay exact
#   comm         {"in": $ per lot on an opening deal, "out": $ per lot on a closing deal}, learned from MT5's own deals
# No Indian charge applies: an MT5 trade pays the broker's commission (and swap, kept on the position by the engine);
# the spread is paid through the bid / ask fills, as in MT5.
def is_mt5(row: dict) -> bool:
    return row.get("x") == "MT5"


def mt5_vol(row: dict, qty: float) -> float:
    return qty * float(row.get("vstep") or (row.get("mt5") or {}).get("vstep") or 0.01)


def mt5_comm(row: dict, qty: float, leg: str = "in") -> dict:
    """The broker's commission for `qty` volume steps on an opening ("in") or closing ("out") deal, as a charges dict."""
    rate = float((row.get("comm") or {}).get(leg) or 0.0)
    c = {k: 0.0 for k in FIELDS}
    c["commission"] = round(rate * mt5_vol(row, qty), 4)
    c["swap"] = 0.0
    c["total"] = round(c["commission"], 2)
    c["value"] = 0.0
    c["tax_name"] = ""
    return c


def mt5_gross(row: dict, side: int, qty: float, entry: float, exit_: float) -> float:
    """Profit in the account's currency, like MT5: price move / tick size x tick value x lots."""
    tick = float(row.get("tick") or 0.01)
    tv = float(row.get("tv") or (row.get("mt5") or {}).get("tick_value") or 0.0)
    return side * (exit_ - entry) / tick * tv * mt5_vol(row, qty)


def order(row: dict, side: int, qty: float, price: float) -> dict:
    """Charges for one executed order. side: 1 buy, -1 sell. Returns the breakdown and its total.
    (MT5: the commission of an opening deal.)"""
    if is_mt5(row):
        return mt5_comm(row, qty, "in")
    r = rates_for(row)
    v = value(row, qty, price)
    if qty <= 0:
        return {k: 0.0 for k in FIELDS} | {"total": 0.0, "value": 0.0}
    brk = r["brk_flat"] if "brk_flat" in r else min(r["brk_cap"], v * r["brk_pct"])
    c = {
        "brokerage": brk,
        "exchange": v * r["exchange"],
        "clearing": v * r["clearing"],
        "tax": v * (r["tax_sell"] if side < 0 else r.get("tax_buy", 0.0)),
        "stamp": v * r["stamp_buy"] if side > 0 else 0.0,
        "sebi": v * r["sebi"],
        "ipft": v * r["ipft"],
        "dp": r.get("dp_sell", 0.0) if side < 0 else 0.0,      # flat, GST included
    }
    c["gst"] = GST * (c["brokerage"] + c["exchange"] + c["clearing"] + c["sebi"] + c["ipft"])
    c = {k: round(x, 4) for k, x in c.items()}
    c["total"] = round(sum(c[k] for k in FIELDS), 2)
    c["value"] = round(v, 2)
    c["tax_name"] = r["tax_name"]
    return c


def add(a: dict, b: dict) -> dict:
    out = {k: round(a.get(k, 0) + b.get(k, 0), 4) for k in FIELDS}
    for k in ("commission", "swap"):
        if k in a or k in b:
            out[k] = round(a.get(k, 0) + b.get(k, 0), 4)
    out["total"] = round(a.get("total", 0) + b.get("total", 0), 2)
    out["tax_name"] = a.get("tax_name") or b.get("tax_name")
    return out


def gross(row: dict, side: int, qty: float, entry: float, exit_: float) -> float:
    if is_mt5(row):
        return mt5_gross(row, side, qty, entry, exit_)
    return side * (exit_ - entry) * qty * (row.get("mult") or 1)


def net_at(row: dict, side: int, qty: float, entry: float, exit_: float, paid: float | None = None) -> dict:
    """Net P&L if a position (side, qty, average entry) exits at exit_.
    paid: entry charges already paid (a position with adds); otherwise one entry order at `entry` is assumed."""
    ent = paid if paid is not None else order(row, side, qty, entry)["total"]
    ex = mt5_comm(row, qty, "out")["total"] if is_mt5(row) else order(row, -side, qty, exit_)["total"]
    g = gross(row, side, qty, entry, exit_)
    return {"gross": round(g, 2), "charges": round(ent + ex, 2), "net": round(g - ent - ex, 2),
            "entry_charges": round(ent, 2), "exit_charges": round(ex, 2)}


def round_tick(price: float, tick: float, side_away: int = 0) -> float:
    """Round to the tick. side_away=+1 rounds up, -1 down, 0 nearest."""
    tick = tick or 0.05
    n = price / tick
    if side_away > 0:
        n = -(-n // 1) if abs(n - round(n)) > 1e-9 else round(n)
    elif side_away < 0:
        n = n // 1 if abs(n - round(n)) > 1e-9 else round(n)
    else:
        n = round(n)
    return round(n * tick, 6)


def breakeven(row: dict, side: int, qty: float, entry: float, paid: float | None = None, buffer_ticks: int = 0) -> float:
    """The exit price where the net P&L (after every charge both ways) is zero, on the tick, on the profit side."""
    tick = row.get("tick") or 0.05
    lo, hi = entry, entry + side * max(entry * 0.2, tick * 50)
    for _ in range(80):                                    # bisection on net P&L = 0
        mid = (lo + hi) / 2
        if net_at(row, side, qty, entry, mid, paid)["net"] < 0:
            lo = mid
        else:
            hi = mid
    px = round_tick(hi, tick, side)                        # never on the losing side
    for _ in range(10000):                                 # (bounded: an MT5 symbol whose tick value isn't known yet)
        if net_at(row, side, qty, entry, px, paid)["net"] >= 0:
            break
        px = round(px + side * tick, 8)
    return round(px + side * tick * buffer_ticks, 6)


def size_for_risk(row: dict, side: int, entry: float, sl: float, risk: float, max_lots: int = 500) -> dict:
    """Most lots whose net loss at the SL (gross loss + entry charges + exit charges) is within `risk` rupees."""
    lot = row.get("lot") or 1
    best = 0
    lo, hi = 0, max_lots
    while lo <= hi:                                        # net loss grows with lots, so binary search works
        mid = (lo + hi) // 2
        if mid == 0:
            lo = 1
            continue
        loss = -net_at(row, side, mid * lot, entry, sl)["net"]
        if loss <= risk:
            best, lo = mid, mid + 1
        else:
            hi = mid - 1
    return {"lots": best, "qty": best * lot}


def table() -> list:
    """Rates for the Settings / Account screen."""
    out = []
    for (ex, kind), r in RATES.items():
        tax = f"{r['tax_name']} {r['tax_sell']*100:.3g}% on sell" + (f" and {r['tax_buy']*100:.3g}% on buy" if r.get("tax_buy") else "") if r["tax_sell"] else "none"
        out.append({
            "segment": f"{ex} {LABEL.get(kind, kind)}",
            "brokerage": f"Rs {r['brk_flat']:.0f} per order" if "brk_flat" in r else f"Rs {r['brk_cap']:.0f} or {r['brk_pct']*100:.2f}%, lower",
            "exchange": f"{r['exchange']*100:.5g}%" if r["exchange"] else "none",
            "clearing": f"{r['clearing']*100:.4g}%" if r["clearing"] else "none",
            "tax": tax,
            "stamp": f"{r['stamp_buy']*100:.3g}% on buy",
            "sebi": "Rs 10 per crore",
            "ipft": f"Rs {r['ipft']*CRORE:.0f} per crore" if r["ipft"] else "-",
            "gst": "18% of brokerage + exchange + clearing + SEBI" + (" + IPFT" if r["ipft"] else ""),
            "dp": f"Rs {r['dp_sell']:.2f} per sell (incl. GST)" if r.get("dp_sell") else "-",
            "on": "premium" if kind.endswith("OPT") or kind == "OPT_IDX" else "order value",
        })
    return out


try:
    apply_overrides()
except Exception:  # noqa: BLE001 - the built-in rates still work
    pass
