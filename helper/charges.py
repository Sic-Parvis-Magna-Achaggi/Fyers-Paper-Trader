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
"""
from __future__ import annotations

AS_OF = "Fyers charges list, 27 Oct 2026"
CRORE = 1e7

# (exchange, kind) -> rates as fractions of order value
RATES = {
    ("MCX", "FUT"): {"brk_pct": 0.0003, "brk_cap": 20.0, "exchange": 0.000021, "clearing": 0.000018,
                     "tax_sell": 0.0001, "tax_name": "CTT", "stamp_buy": 0.00002, "sebi": 10 / CRORE, "ipft": 0.0},
    ("MCX", "OPT"): {"brk_flat": 20.0, "exchange": 0.000418, "clearing": 0.0005,
                     "tax_sell": 0.0005, "tax_name": "CTT", "stamp_buy": 0.00003, "sebi": 10 / CRORE, "ipft": 0.0},
    ("NSE", "FUT"): {"brk_pct": 0.0003, "brk_cap": 20.0, "exchange": 0.000018299, "clearing": 0.000005,
                     "tax_sell": 0.0005, "tax_name": "STT", "stamp_buy": 0.00002, "sebi": 10 / CRORE, "ipft": 10 / CRORE},
    ("NSE", "OPT"): {"brk_flat": 20.0, "exchange": 0.000355299, "clearing": 0.00009,
                     "tax_sell": 0.0015, "tax_name": "STT", "stamp_buy": 0.00003, "sebi": 10 / CRORE, "ipft": 50 / CRORE},
}
GST = 0.18
FIELDS = ("brokerage", "exchange", "clearing", "tax", "stamp", "sebi", "ipft", "gst")


def rates_for(row: dict) -> dict:
    ex = row["s"].split(":", 1)[0]
    kind = "OPT" if row.get("f") == "OPT" else "FUT"
    return RATES.get((ex, kind)) or RATES[("MCX", kind)]


def value(row: dict, qty: float, price: float) -> float:
    """Order value in rupees. qty is in Fyers units (MCX: lots; NSE: shares)."""
    return abs(price) * qty * (row.get("mult") or 1)


def order(row: dict, side: int, qty: float, price: float) -> dict:
    """Charges for one executed order. side: 1 buy, -1 sell. Returns the breakdown and its total."""
    r = rates_for(row)
    v = value(row, qty, price)
    if qty <= 0:
        return {k: 0.0 for k in FIELDS} | {"total": 0.0, "value": 0.0}
    brk = r["brk_flat"] if "brk_flat" in r else min(r["brk_cap"], v * r["brk_pct"])
    c = {
        "brokerage": brk,
        "exchange": v * r["exchange"],
        "clearing": v * r["clearing"],
        "tax": v * r["tax_sell"] if side < 0 else 0.0,
        "stamp": v * r["stamp_buy"] if side > 0 else 0.0,
        "sebi": v * r["sebi"],
        "ipft": v * r["ipft"],
    }
    c["gst"] = GST * (c["brokerage"] + c["exchange"] + c["clearing"] + c["sebi"] + c["ipft"])
    c = {k: round(x, 4) for k, x in c.items()}
    c["total"] = round(sum(c[k] for k in FIELDS), 2)
    c["value"] = round(v, 2)
    c["tax_name"] = r["tax_name"]
    return c


def add(a: dict, b: dict) -> dict:
    out = {k: round(a.get(k, 0) + b.get(k, 0), 4) for k in FIELDS}
    out["total"] = round(a.get("total", 0) + b.get("total", 0), 2)
    out["tax_name"] = a.get("tax_name") or b.get("tax_name")
    return out


def gross(row: dict, side: int, qty: float, entry: float, exit_: float) -> float:
    return side * (exit_ - entry) * qty * (row.get("mult") or 1)


def net_at(row: dict, side: int, qty: float, entry: float, exit_: float, paid: float | None = None) -> dict:
    """Net P&L if a position (side, qty, average entry) exits at exit_.
    paid: entry charges already paid (a position with adds); otherwise one entry order at `entry` is assumed."""
    ent = paid if paid is not None else order(row, side, qty, entry)["total"]
    ex = order(row, -side, qty, exit_)["total"]
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
    while net_at(row, side, qty, entry, px, paid)["net"] < 0:
        px = round(px + side * tick, 6)
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
    """Rates for the Settings screen."""
    out = []
    for (ex, kind), r in RATES.items():
        out.append({
            "segment": f"{ex} {'options' if kind == 'OPT' else 'futures'}",
            "brokerage": f"Rs {r['brk_flat']:.0f} per order" if "brk_flat" in r else f"Rs {r['brk_cap']:.0f} or {r['brk_pct']*100:.2f}%, lower",
            "exchange": f"{r['exchange']*100:.5g}%",
            "clearing": f"{r['clearing']*100:.4g}%",
            "tax": f"{r['tax_name']} {r['tax_sell']*100:.3g}% on sell",
            "stamp": f"{r['stamp_buy']*100:.3g}% on buy",
            "sebi": "Rs 10 per crore",
            "ipft": f"Rs {r['ipft']*CRORE:.0f} per crore" if r["ipft"] else "-",
            "gst": "18% of brokerage + exchange + clearing + SEBI" + (" + IPFT" if r["ipft"] else ""),
            "on": "premium" if kind == "OPT" else "contract value",
        })
    return out
