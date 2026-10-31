# Test kit (runs on a test machine, never on the server)

Fyers is faked: candles, quotes, margin, a 1-second price stream, and the order API for Live accounts. Everything else is the real helper.
Needs Python with requirements.txt installed, Node with Playwright, and Chromium.

```
python3 tests/routes_check.py                         # every API route still exists
python3 tests/squareoff_test.py                       # square-off engine test (no browser)
python3 tests/live_test.py                            # live engine against the fake Fyers order API (no browser, ~2 min)
node tests/ctype_test.js                              # chart types (Heikin-Ashi, Renko, range, line break, P&F) with worked numbers
python3 tests/feedcheck_test.py                       # the order-flow check's counting (exact / merged trades)

python3 tests/make_old_data.py /tmp/fyers_test        # fresh v0.12-style data, admin password OldPass12345
FYERS_HELPER_DATA=/tmp/fyers_test python3 tests/mock_server.py &   # the app on http://localhost:8766
FYERS_HELPER_DATA=/tmp/fyers_test node tests/security_flow.js      # upgrade login, 2FA, step-up, users, accounts
FYERS_HELPER_DATA=/tmp/fyers_test node tests/live_flow.js          # Live on (client ID + 2FA), a trade, its Fyers stop, kill switch, back to Paper
FYERS_HELPER_DATA=/tmp/fyers_test node tests/charttypes_flow.js    # every chart type with Volume + 2 Pine scripts lined up, live ticks
FYERS_HELPER_DATA=/tmp/fyers_test node tests/pine_compat_flow.js   # the Pine battery (tests/pine_compat.js) on every chart type; the P&F toolkit
FYERS_HELPER_DATA=/tmp/fyers_test node tests/indicator_settings_flow.js  # indicator settings (Inputs / Style / Visibility, own timeframe), Pine imports, chart scroll-back, Pivot Points on daily candles
FYERS_HELPER_DATA=/tmp/fyers_test node tests/navigation_flow.js         # Go to a date (Alt+G), », P&F default zoom and per-timeframe box
FYERS_HELPER_DATA=/tmp/fyers_test node tests/mobile_flow.js        # the phone layout on an emulated Pixel 7: order sheet, positions, tabs, full screen (resets the admin's paper account)
```

`fake_broker.py` is a fake Fyers order API (place / modify / cancel / order book / positions and order updates). It
follows the Fyers rules live mode relies on (stops trigger on the last price; no type change on MCX; no SL-M on
options or BSE; a sell stop can't be at or above the last price) and records any moment two exit orders are open
for one position. `mock_server.py` uses it, so Live accounts work in the browser tests without Fyers. The mock's contracts were
"listed" 200 days ago (FAKE_LISTED_DAYS): before that its history answers Fyers' `no_data`, as a real contract does.

After `security_flow.js` the admin has 2FA. Other browser tests log in with `require("./login.js")(page)`, which
types the password and a fresh code read from the test data (a code can't be used twice, so it may wait up to 30 s).
Screenshots go to `<data folder>/shots/`. `fixtures/` holds a small symbol list (MCX, NSE, BSE, currency).

**Rule:** every indicator works on every chart type, P&F included. When the app gains a Pine feature, add a script
that uses it to `tests/pine_compat.js`; `pine_compat_flow.js` then checks it on every chart type.
