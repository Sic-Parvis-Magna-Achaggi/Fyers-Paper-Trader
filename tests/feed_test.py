"""The price feed's subscriptions (helper/feed.py), no browser. Run: python3 tests/feed_test.py
- a page streams up to 40 contracts (its chart + the watchlist on screen, 30 a list);
- the socket never asks Fyers for more than 95 (Standard: 100), and open trades / orders always come first;
- polled quotes go 50 symbols a request."""
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
D = "/tmp/fyers_feed_test"
shutil.rmtree(D, ignore_errors=True); os.makedirs(D)
os.environ["FYERS_HELPER_DATA"] = D
sys.path.insert(0, os.path.dirname(HERE))
from helper.feed import Feed, Client  # noqa: E402

fails = []


def ok(c, m, d=""):
    print(("PASS " if c else "FAIL ") + m + ("" if c else f"  <- {d}"))
    if not c:
        fails.append(m)


f = Feed(None, "test")
f._resync = lambda: None
a, b = Client(), Client()
f.clients |= {a, b}
f.want(a, [f"NSE:S{i:03d}-EQ" for i in range(60)])
ok(len(a.symbols) == 40, "a page streams up to 40 contracts", len(a.symbols))
f.want(b, [f"NSE:T{i:03d}-EQ" for i in range(40)])
c3 = Client(); f.clients.add(c3)
f.want(c3, [f"NSE:U{i:03d}-EQ" for i in range(40)])            # three pages of 40: 120 + 2 trades
trades = ["MCX:ZZTRADE26NOVFUT", "NSE:ZZORDER-EQ"]          # sort last alphabetically: they must not be cut
f.extra = lambda: trades
w = f.wanted()
ok(len(w) == 95, "the socket asks Fyers for at most 95 contracts (Standard plan: 100)", len(w))
ok(w[:2] == sorted(trades), "open trades and orders come first, never cut", w[:3])
ok(len(set(w)) == len(w), "no contract twice")

calls = []


class Link:
    def quotes(self, symbols):
        calls.append(len(symbols))
        return {s: {"lp": 100.0, "volume": 5, "open_price": 99.0, "high_price": 101.0, "low_price": 98.0, "prev_close_price": 97.0} for s in symbols}


f.link = Link()
out = f._poll([f"NSE:S{i:03d}-EQ" for i in range(95)])
ok(calls == [50, 45] and len(out) == 95, f"95 contracts polled in requests of 50 ({calls})", calls)
ok(out[0]["o"] == 99.0 and out[0]["h"] == 101.0 and out[0]["l"] == 98.0 and out[0]["pc"] == 97.0, "polled quotes carry the day's open / high / low / previous close", out[0])

print("ALL PASSED" if not fails else f"{len(fails)} FAILED")
sys.exit(1 if fails else 0)
