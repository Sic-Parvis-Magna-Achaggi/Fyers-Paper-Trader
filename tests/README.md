# Test kit (runs on a test machine, never on the server)

Fyers is faked: candles, quotes, margin, a 1-second price stream, and the order API for Live accounts. Everything else is the real helper.
Needs Python with requirements.txt installed, Node with Playwright, and Chromium.

```
python3 tests/routes_check.py                         # every API route still exists
python3 tests/squareoff_test.py                       # square-off engine test (no browser)
python3 tests/live_test.py                            # live engine against the fake Fyers order API (no browser, ~2 min)
node tests/ctype_test.js                              # chart types (Heikin-Ashi, Renko, range, line break, P&F) with worked numbers
python3 tests/feedcheck_test.py                       # the order-flow check's counting (exact / merged trades)
python3 tests/feed_test.py                            # the price feed: 40 a page, at most 95 with trades first, polls of 50
python3 tests/alerts_test.py                          # Telegram alerts: the helper's checks, the watchdog (fake clock, then as its own process), the outside heartbeat
node tests/github_upload_flow.js                      # tools/github_upload.html against a fake GitHub API (fake_github.py on :8768); no helper needed
python3 tests/journal_test.py                         # the journal: the server's Octagon port vs Octagon's own JS (fixtures/octagon_core.js), then on paper engines: lockouts, switches, audit
python3 tests/jshots_test.py                          # journal pictures: the server's drawing, entry / exit on paper engines, labels, the Telegram copy (fake Telegram on :8771)
python3 tests/jreview_test.py                         # journal v0.28.0: weekly review + its Telegram summary, CSV, backup and restore (fake Telegram on :8772)
python3 tests/candles_test.py                         # saved candles: exact contract (no cont_flag), clean-out, a day fetched again replaces it

python3 tests/make_old_data.py /tmp/fyers_test        # fresh v0.12-style data, admin password OldPass12345
FYERS_HELPER_DATA=/tmp/fyers_test python3 tests/mock_server.py &   # the app on http://localhost:8766
FYERS_HELPER_DATA=/tmp/fyers_test node tests/security_flow.js      # upgrade login, 2FA, step-up, users, accounts
FYERS_HELPER_DATA=/tmp/fyers_test node tests/live_flow.js          # Live on (client ID + 2FA), a trade, its Fyers stop, kill switch, back to Paper
FYERS_HELPER_DATA=/tmp/fyers_test node tests/charttypes_flow.js    # every chart type with Volume + 2 Pine scripts lined up, live ticks
FYERS_HELPER_DATA=/tmp/fyers_test node tests/pine_compat_flow.js   # the Pine battery (tests/pine_compat.js) on every chart type; the P&F toolkit
FYERS_HELPER_DATA=/tmp/fyers_test node tests/indicator_settings_flow.js  # indicator settings (Inputs / Style / Visibility, own timeframe), Pine imports, chart scroll-back, Pivot Points on daily candles
FYERS_HELPER_DATA=/tmp/fyers_test node tests/navigation_flow.js         # Go to a date (Alt+G), », P&F zoom and box, no-trade candles, the browser's candle copy, the data check
FYERS_HELPER_DATA=/tmp/fyers_test node tests/watchlists_flow.js    # several watchlists: new / rename / move / delete, + in Find, streaming, saved, phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/drawings_flow.js       # drawing tools and the measure: toolbar, drawing, editing, undo, saved per contract, every chart type, net ₹ / R, position drawings, phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/layouts_flow.js       # saved layouts: Layout 1, new / copy / rename / delete, switching brings each back, auto-save and by hand (Ctrl+S), page closed mid-switch, second device, phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/multichart_flow.js    # multi-charts: grids, each chart its own, the active chart (watchlist, BUY, Pine), crosshair sync, drawings per contract, ⛶, reload, phone buttons
FYERS_HELPER_DATA=/tmp/fyers_test node tests/telegram_flow.js     # Settings › Telegram alerts, the Live card, then the real watchdog with the helper frozen (SIGSTOP) -> the message; ~1.5 min
FYERS_HELPER_DATA=/tmp/fyers_test node tests/journal_flow.js       # the Journal page: trades arriving, the audit form, claim, filters, lockouts (on a fresh account each run, archived after), phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/jshots_flow.js        # journal pictures: server + chart pictures of a trade, card, viewer, add / paste / drop, 📷, Settings › Pictures, Telegram copy, phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/jinsights_flow.js     # journal v0.28.0: Insights, the weekly review, walk-through, calendar, Copy for Gemini, export / backup / restore, phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/mobile_flow.js        # the phone layout on an emulated Pixel 7: order sheet and its bubble, positions, tabs, full screen (resets the admin's paper account)
```

`fake_telegram.py` is a fake Telegram Bot API and Healthchecks.io (`mock_server.py` starts it on :8767; `/_sent` lists the
messages, `/_docs` the documents sent (journal pictures), `/_deleted` the deleted messages). Tokens starting `1234567:` are good.

`fake_broker.py` is a fake Fyers order API (place / modify / cancel / order book / positions and order updates). It
follows the Fyers rules live mode relies on (stops trigger on the last price; no type change on MCX; no SL-M on
options or BSE; a sell stop can't be at or above the last price) and records any moment two exit orders are open
for one position. `mock_server.py` uses it, so Live accounts work in the browser tests without Fyers. The mock's contracts were
"listed" 200 days ago (FAKE_LISTED_DAYS): before that its history answers Fyers' `no_data`, as a real contract does.

After `security_flow.js` the admin has 2FA. Other browser tests log in with `require("./login.js")(page)`, which
types the password and a fresh code read from the test data (a code can't be used twice, so it may wait up to 30 s).
Screenshots go to `<data folder>/shots/`. `fixtures/` holds a small symbol list (MCX, NSE, BSE, currency).

**Layouts (v0.23.0):** the open layout is what a page opens with. A test that sets chart prefs straight through `/api/prefs`
must also delete `u/<user>/layouts.json` (with no page open), or the saved layout will put its own chart back.

**Rule:** every indicator works on every chart type, P&F included. When the app gains a Pine feature, add a script
that uses it to `tests/pine_compat.js`; `pine_compat_flow.js` then checks it on every chart type.
