# Test kit (runs on a test machine, never on the server)

Fyers is faked: candles, quotes, margin, a 1-second price stream, and the order API for Live accounts. Everything else is the real helper.
Needs Python with requirements.txt installed, Node with Playwright, and Chromium.

```
python3 tests/routes_check.py                         # every API route still exists
python3 tests/squareoff_test.py                       # square-off engine test (no browser)
python3 tests/live_test.py                            # live engine against the fake Fyers order API (no browser, ~2 min)
python3 tests/live_account_test.py                    # v0.33.0: the Live account is the Fyers account: Fyers' funds (size, daily floor, money in / out), trades placed in Fyers (opened, added, part closed, a Fyers stop adopted, pending orders moved / cancelled, the books' fallback, no double booking), holdings, rt.py (old Live accounts back to Paper) (~2 min)
node tests/ctype_test.js                              # chart types (Heikin-Ashi, Renko, range, line break, P&F) with worked numbers
python3 tests/feedcheck_test.py                       # the order-flow check's counting (exact / merged trades)
python3 tests/feed_test.py                            # the price feed: 40 a page, at most 95 with trades first, polls of 50
python3 tests/alerts_test.py                          # Telegram alerts: the helper's checks, the watchdog (fake clock, then as its own process), the outside heartbeat
node tests/github_upload_flow.js                      # tools/github_upload.html against a fake GitHub API (fake_github.py on :8768); no helper needed
python3 tests/journal_test.py                         # the journal: the server's Octagon port vs Octagon's own JS (fixtures/octagon_core.js), then on paper engines: lockouts, switches, audit
python3 tests/jshots_test.py                          # journal pictures: the server's drawing, entry / exit on paper engines, labels, the Telegram copy (fake Telegram on :8771)
python3 tests/jreview_test.py                         # journal v0.28.0: weekly review + its Telegram summary, CSV, backup and restore (fake Telegram on :8772)
python3 tests/chartalerts_test.py                     # v0.38.0: alerts without a browser: every operator, the four triggers, multi-condition, watchlists, Pine (real Node), drawings, Renko, expiry, placeholders, webhook, phone push (decrypted), Telegram
python3 tests/candles_test.py                         # saved candles: exact contract (cont_flag=0 on every request), clean-out, a day fetched again replaces it
bash tests/server_conf_test.sh                        # each server's own settings (address, outgoing IP, branch): fake DigitalOcean metadata + "what's my IP"; safe anywhere
FYERS_TEST_CONTAINER=1 bash tests/server_flow.sh      # a new server's first install + updates (startup.sh's scripts, update.sh) on a local "GitHub"; ONLY in a throwaway container, as root
python3 tests/trail_rr_test.py                        # LiveTrader 1.24: per-trade trailing (typed R switches on, the panel takes trades back) and the RR lock's stop (net of charges, rules, too-close target)
python3 tests/replay_test.py                          # trade replay: the stop's path, entry / exit set-ups (order's chart, layouts), code + drawings as then, old trades from the log, net ₹
python3 tests/mt5_test.py                             # v0.34.0: the MT5 bridge without a browser: key, the EA's sync (account, clock, ticks), candles through HIST, symbols, offline, the broker's clock, paper refusing MT5
python3 tests/mt5acct_test.py                         # v0.36.0: MT5 accounts without a browser (fake_mt5's account in-process): the account per login, MT5's history, a trade from MT5 adopted ($ net, 1R, BE), the login once, MOD / CLOSE / CANCEL / OMOD, BE / trail moving MT5's stop (paced), refusals, lost results, offline, a part / a vanished position, commission learned, FundingPips' floors, a second terminal, restart

python3 tests/make_old_data.py /tmp/fyers_test        # fresh v0.12-style data, admin password OldPass12345
FYERS_HELPER_DATA=/tmp/fyers_test python3 tests/mock_server.py &   # the app on http://localhost:8766
FYERS_HELPER_DATA=/tmp/fyers_test node tests/security_flow.js      # upgrade login, 2FA, step-up, users, accounts
FYERS_HELPER_DATA=/tmp/fyers_test node tests/rr_lock_flow.js      # RR box + padlock under BUY / SELL, locked drags (target <-> stop), the rules' message, tool gap, the entry line's R boxes, the phone's padlock (a fresh account each run, archived after)
python3 tests/strategies_test.py                      # v0.43.0: strategies without a browser (Node + two paper engines): signals on bar close -> trades, the script's stop, limits, reversal, the tester
FYERS_HELPER_DATA=/tmp/fyers_test node tests/strategies_flow.js    # v0.43.0 (~4 min): the Strategies page, the rules panel, the tester, a real trade from the mock's prices on a fresh paper account, Live's 2FA, the phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/pnl_units_flow.js    # v0.42.0: P&L / SL / TP as amount, % of account or R (main + second): the position bar, labels, zones, the tool, an order, the panel, the Trades page, Chart settings, U, clicks, saved, the phone (a fresh account each run, archived after)
FYERS_HELPER_DATA=/tmp/fyers_test node tests/live_flow.js          # the PAPER / LIVE switch (client ID + 2FA, per login, 403 from a Paper page), the Live card's Fyers funds, a trade, a trade placed in Fyers (NO STOP, Place my stop), a Fyers limit cancelled here, the phone, kill switch, back to Paper; with FYERS_OUT_IP=203.0.113.7 on both mock_server.py and the test: the dialog names that IP
FYERS_HELPER_DATA=/tmp/fyers_test node tests/charttypes_flow.js    # every chart type with Volume + 2 Pine scripts lined up, live ticks
FYERS_HELPER_DATA=/tmp/fyers_test node tests/chartsizes_flow.js    # v0.44.0 (~2 min): Renko / range / P&F size buttons (presets, pins, typed sizes), no chart rebuild on a size, Fixed keeping the size (the hang), the 20,000-bar cap, live ticks re-feeding only the live candle (bars = a full build), the menus under their buttons, the cramped bar, the phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/pine_compat_flow.js   # the Pine battery (tests/pine_compat.js) on every chart type; v0.37.4: lines with breaks drawn as breaks on the chart; the P&F toolkit
FYERS_HELPER_DATA=/tmp/fyers_test node tests/legend_flow.js            # indicator read-outs with many values: inside the chart, wrapped, buttons after the name and clickable (desktop, narrow, phone)
FYERS_HELPER_DATA=/tmp/fyers_test node tests/indicator_settings_flow.js  # indicator settings (Inputs / Style / Visibility, own timeframe), Pine imports, chart scroll-back, Pivot Points on daily candles
FYERS_HELPER_DATA=/tmp/fyers_test node tests/navigation_flow.js         # Go to a date (Alt+G), », P&F zoom and box, no-trade candles, the browser's candle copy, the data check
FYERS_HELPER_DATA=/tmp/fyers_test node tests/watchlists_flow.js    # several watchlists: new / rename / move / delete, + in Find, streaming, saved, phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/chain_lists_flow.js   # option chain header fixed while strikes scroll, opens at the nearest strike only on open, ＋ / ★ on CE / PE, a row's lists (⋯, right-click, phone swipe: Move / Remove)
FYERS_HELPER_DATA=/tmp/fyers_test node tests/drawings_flow.js       # drawing tools and the measure: toolbar, drawing, editing, undo, saved per contract, every chart type, net ₹ / R, position drawings, phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/layouts_flow.js       # saved layouts: Layout 1, new / copy / rename / delete, switching brings each back, auto-save and by hand (Ctrl+S), page closed mid-switch, second device, phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/multichart_flow.js    # multi-charts: grids, each chart its own, the active chart (watchlist, BUY, Pine), crosshair sync, drawings per contract, ⛶, reload, phone buttons
FYERS_HELPER_DATA=/tmp/fyers_test node tests/telegram_flow.js     # Settings › Telegram alerts, the Live card, then the real watchdog with the helper frozen (SIGSTOP) -> the message; ~1.5 min
FYERS_HELPER_DATA=/tmp/fyers_test node tests/journal_flow.js       # the Journal page: trades arriving, the audit form, claim, filters, lockouts (on a fresh account each run, archived after), phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/jshots_flow.js        # journal pictures: server + chart pictures of a trade, card, viewer, add / paste / drop, 📷, Settings › Pictures, Telegram copy, phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/jinsights_flow.js     # journal v0.28.0: Insights, the weekly review, walk-through, calendar, Copy for Gemini, export / backup / restore, phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/mobile_flow.js        # the phone layout on an emulated Pixel 7: order sheet and its bubble, positions, tabs, full screen (resets the admin's paper account)
FYERS_HELPER_DATA=/tmp/fyers_test node tests/replay_flow.js        # trade replay: ▶ On chart (recorded chart + Pine code, nothing saved), ▶ Play, every chart type, History, the phone; ~5 min (resets the admin's paper account)
FYERS_HELPER_DATA=/tmp/fyers_test node tests/settings_search_flow.js  # v0.35.0: the ƒx search (filter, marks, ↑ / ↓ / Enter / Esc, "/") and Settings as a page (sections list, jumps, #settings, Esc / ← Back), the phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/mt5acct_flow.js       # v0.36.0 / v0.37.0 (~2 min): placing from the chart tool (MT5 PLACE), hedging refused, the news guard (a ForexFactory file), KILL / Resume; PAPER | LIVE | MT5 (2FA), the MT5 account from fake_mt5 (--ctl 8769 --history): switcher, $, floors, a trade from MT5 on the panel / chart, the login dialog, SL / BE / TRAIL / ✕ from the entry line's bar reaching MT5, a pending order moved / cancelled, 403 from Paper, History, Account page, rules, the phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/chartalerts_flow.js    # v0.38.0 (~3 min): the alert dialog (Alt+A, 🔔, right-click, drawings, ƒx), a price alert firing (pop-up, line, triggered), dragging its line, Pine / multi-condition / webhook alerts, the Alerts page, a watchlist alert, the service worker, the phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/mt5journal_flow.js    # v0.39.0 / v0.39.1 (~4 min): MT5 trades in the Journal (fake_mt5 --history --ctl 8769): a trade from MT5 arriving, $ only with the MT5 badge, ₹ Fyers | $ MT5, Today, Insights / Review / Gemini, Settings › MT5 accounts (session day, the lockouts' switch with 2FA: refused only when on), CSV, the replay's data, v0.39.1: the trade's candles kept and its replay with MT5 off (also Fyers logged out), ▶ Play, the phone
FYERS_HELPER_DATA=/tmp/fyers_test node tests/mt5dayend_flow.js     # v0.40.0 / v0.41.0 (~1 min): the MT5 day-end close's rules (and each symbol's own close time from EA 1.23's sessions), the footer, the ticket's At the day end and the tool's DAY END / HOLD, a trade from MT5 taking the default, ⏱ per trade, "all trades", the phone (the close itself: mt5acct_test.py)
FYERS_HELPER_DATA=/tmp/fyers_test node tests/mt5_flow.js           # v0.34.0: Settings › MT5 bridge (key with 2FA), a fake MT5 terminal connecting (fake_mt5.py), Find, an MT5 chart with every chart type + Volume + Pine, the broker's day, trading refused, MT5 off, the phone
```

`mock_server.py` sends the same response headers as the server's Caddy (read from `server/Caddyfile`), so browser
tests see the real rules (v0.28.1: Caddy's frame header broke multi-chart grids on the server only).

`POST /_mock/allday?on=1` (mock_server.py) makes the fake Fyers' candles run round the clock instead of 09:00-23:30 IST:
`replay_flow.js` turns it on (its test trade can be at night) and off again at the end.

`fake_telegram.py` is a fake Telegram Bot API and Healthchecks.io (`mock_server.py` starts it on :8767; `/_sent` lists the
messages, `/_docs` the documents sent (journal pictures), `/_deleted` the deleted messages). Tokens starting `1234567:` are good.

`fake_broker.py` is a fake Fyers order API (place / modify / cancel / order book / positions / holdings / funds and order
updates; v0.33.0: `fund`, `hold`, `edis`, `outside()` for an order placed in the Fyers app). It
follows the Fyers rules live mode relies on (stops trigger on the last price; no type change on MCX; no SL-M on
options or BSE; a sell stop can't be at or above the last price) and records any moment two exit orders are open
for one position. `mock_server.py` uses it, so the Live account works in the browser tests without Fyers
(`POST /_mock/outside` places an order "in the Fyers app", `GET /_mock/book` shows the fake order book). The mock's contracts were
"listed" 200 days ago (FAKE_LISTED_DAYS): before that its history answers Fyers' `no_data`, as a real contract does.

After `security_flow.js` the admin has 2FA. Other browser tests log in with `require("./login.js")(page)`, which
types the password and a fresh code read from the test data (a code can't be used twice, so it may wait up to 30 s).
Screenshots go to `<data folder>/shots/`. `fixtures/` holds a small symbol list (MCX, NSE, BSE, currency).

**Layouts (v0.23.0):** the open layout is what a page opens with. A test that sets chart prefs straight through `/api/prefs`
must also delete `u/<user>/layouts.json` (with no page open), or the saved layout will put its own chart back.

**Rule:** every indicator works on every chart type, P&F included. When the app gains a Pine feature, add a script
that uses it to `tests/pine_compat.js`; `pine_compat_flow.js` then checks it on every chart type.

`fake_mt5.py` is a fake MT5 terminal running the bridge EA's protocol (`mt5/FTM_Bridge.mq5`): `python3 tests/fake_mt5.py
http://localhost:8766 <bridge key>` (a key from Settings › MT5 bridge). Its broker clock is GMT+2 / GMT+3 with US summer
time, it has no weekend candles, and its prices are the same every run. `mt5_flow.js` starts it by itself.
The mock's fake Fyers stream sends only what Fyers would (`feed.fy_wanted()`): never MT5 symbols.
v0.36.0: `fake_mt5.py` plays EA 1.10 (an MT5 Hedge account: positions, pending orders, deals with commission and swap, SL / TP
on bid / ask, the app's MOD / CLOSE / CANCEL / OMOD with retcodes); `--old` plays 1.00, `--history` adds two closed trades
10 days back, `--ctl PORT` serves a control API (see its docstring). Its tickets are unique per run, as MT5's.
v0.41.0: it plays EA 1.23 by default (each symbol's trading sessions in the symbol list). v0.37.0: it plays EA 1.20 (OPEN, margin per symbol, TRAIL and the offline trailing; `--ver 1.10` plays the older one; control
`/offline` cuts the link). `mock_server.py` sets `FTM_NEWS_URL` to `file://<data folder>/ff_test.json`, so the news guard
reads a file the test writes, never the real ForexFactory.

**Alerts (v0.38.0):** `POST /_mock/price?s=<symbol>&p=<price>` makes a price jump now (the random walk carries on from it);
`POST /_mock/hook` receives alerts' webhooks and `GET /_mock/hooks` lists them (`FTM_WEBHOOK_PRIVATE=1`, set by
`mock_server.py`, lets webhooks reach localhost on any port; on the server only public addresses on ports 80 / 443).
Technical alerts need Node on the test machine (the `node` on PATH, or `FTM_NODE`).
