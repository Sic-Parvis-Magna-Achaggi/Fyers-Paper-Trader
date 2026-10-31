# Handoff: where the project stands (for a new chat)

Updated 1 Nov 2026, version **0.20.4**. Read this, `docs/Roadmap.md` (the task list: what's next, with the agreed
live-mode design, and what's done), `CHANGELOG.md` (what's done) and `docs/Paper_Trading_Guide.md` (how the app behaves).

## Getting the code

The repo is `Sic-Parvis-Magna-Achaggi/Fyers-Paper-Trader` (private). The owner uploads release zips by dragging the
folder's contents into GitHub; the server pulls every minute. Always start from the latest commit in the repo, not
an old zip. Every release: changelog text, a one-line commit message, the version number; VERSION and CHANGELOG.md
updated; `tests/routes_check.py` passes; the guide updated when behaviour changes; the project copies of the guide
and roadmap updated too.

## How the code is laid out (v0.20)

- `helper/app.py`: FastAPI routes. Login is username + password + TOTP code; sensitive routes need a fresh code
  (HTTP 428, the page asks and retries). `X-Acct` header picks the paper account.
- `helper/users.py`: users, 2FA (TOTP + recovery codes), sessions, lockout, AES-GCM seal / unseal of secrets
  (`data/secret.key`), the security log (`data/audit.jsonl`), and the console rescue
  (`python -m helper.users rescue admin`).
- `helper/rt.py`: per user, the Fyers link, the price feed and the accounts (one `Paper` engine each, or a
  `LiveEngine` for the admin's Live account, plus that user's Fyers order-update socket). `set_mode()` switches an
  account Paper <-> Live. Data: `data/u/<user>/` and `data/u/<user>/a/<account>/` (a Live account keeps its Fyers
  order ids under `"live"` in `paper.json`). `rt.make_broker` / `rt.make_stream` are what the tests swap for fakes.
- `helper/live.py`: `LiveEngine(Paper)`: the paper engine's rules, sizing, guards, BE, trailing and targets, with
  real orders. Entries fill from Fyers' reports; a stop-limit at Fyers from the start that `_a_sync` moves; exits via
  `close()` -> `request_exit()` -> `_a_exit` (NSE / BSE: stop -> market; MCX: cancel, confirm, one market exit);
  `on_update()` takes every order update (socket or order book); `_a_poll` reads the order book (restart, overnight,
  socket down); kill switch `kill()` + `_a_kill2`. One asyncio worker per account runs Fyers calls one at a time,
  exits first; all state changes happen on the event loop.
- `helper/broker.py`: `FyersBroker` (place / modify / cancel / order book / positions / funds, on the order budget;
  `BrokerRefused` = Fyers said no, `BrokerUnsure` = maybe placed: look it up by order tag) and `OrderStream` (our own
  client for Fyers' order-update socket, with reconnects).
- `helper/fyers_link.py` (Fyers REST, per user, with request budgets), `helper/feed.py` (live prices per user),
  `helper/paper.py` (paper engine: fills, stops, BE, trailing, guards, square-off), `helper/charges.py`,
  `helper/charges_watch.py`, `helper/symbols.py`, `helper/candles.py`.
- `helper/feedcheck.py`: the order-flow check (`FC`): records the admin's feed snapshots for chosen contracts
  (`data/feedcheck/`), counts exact / merged trades; hooked in `rt.py` (admin's on_tick, watch_symbols).
- `web/ctype.js`: chart types (Heikin-Ashi, Renko, range bars, line break, Point & Figure...) as pure functions, tested in Node.
  In `web/index.html` the chart keeps `RAW` (the real candles, from history and live ticks) and `DISP` (what's shown,
  `CT.transform(RAW)`); `dispSet()` draws all of it, `dispLive()` only what a tick changed. Everything that reads
  the chart's bars (Volume, indicators, Pine via `dispBars()`, the legend) uses `DISP`; prices and trade lines are
  real. `dispTimeAt(t)` maps a real time to the bar it falls in (Renko etc.).
- `web/vendor/lightweight-charts.standalone.production.js` is 5.2.1 with one patch (the histogram hover guard,
  noted at the top of the file): keep it if the library is ever updated, unless the new version fixes the bug.
- `web/index.html` (main page and chart), `web/paper.js` (ticket, chart tool, positions), `web/pages.js` (Trades,
  History, Book, Account, Log pages), `web/pine.js` + `web/pine_worker.js` (Pine Script, PineTS), `web/indset.js`
  (every indicator's settings dialog: Inputs / Style / Visibility; `indVisOn()` decides visibility by timeframe),
  `web/pine_libs/` (Pine libraries built into the app: `TradingView_ta.pine`), `web/security.js`
  (login gates, 2FA set-up, step-up, Security and Users settings, account switcher), `web/live.js` (LIVE badge, KILL,
  live warnings, the Fyers stop on each position, the Live card, the Paper <-> Live dialog; it wraps paperUpdate,
  renderPlan, pgPositions and pgAccount).
- `web/mobile.js` + `web/mobile.css`: the phone layout (body class `mob`, chosen by `mWant()`: width <= 760 or a
  touch screen under 500 px, or the `ftm.layout` override in localStorage). Loaded after the page's inline script; it
  wraps onTick, openSymbol, feedPill, setFull, pgShow, openDrawer, refreshState, paperUpdate, renderTicket and
  renderPlan. It adds its own shell (`#mob`: top bar, SELL / BUY bar, chips, tabs, screens, one bottom sheet), moves
  the `<aside>` into the Quotes tab, and hides the desktop header / panel. The order sheet never keeps its own
  ticket state: it sets the desktop ticket's inputs and fires their change events, or clicks its buttons, so
  `paper.js` stays the only ticket logic. CSS for it lives only under `body.mob` / `#mob`.
  v0.20.3: the ticket sheet can shrink to a bubble (`M.min`, `mMin()`, `mBubFill()`; body class `tkmin` hides `#mBar`
  and shows `#mBub` in its slot, so the chart's size never changes). A pointerdown on `#chart` while the sheet is up
  shrinks it; pref `mobTicket` ("full" / "bubble") is what SELL / BUY open.
- `tests/`: the test kit (fake Fyers feed and order API, route check, engine tests incl. `live_test.py`, browser
  tests incl. `live_flow.js` and `mobile_flow.js`). See `tests/README.md`.

Test-kit quirk (1 Nov): `navigation_flow.js`'s "Go to a date on 1D" check failed once at 01:49 IST (landed a day
late) on both v0.20.2 and v0.20.3 code, then passed at 02:10 IST. Cause not found: an intermittent test-kit issue
(the mock stamps day candles at 00:00 UTC; real Fyers at IST midnight). Re-run it if it fails.

## Users on the server

- **admin** = the owner (live trading is the owner's only). Other users are paper-only, each with their own
  Fyers app for prices (SEBI / Fyers static-IP rules; see the roadmap).
- Still open with Fyers support: whether a second user's app may fetch market data from this server's IP.

## Project instructions

`docs/Project_Instructions.md` is the text of this project's instructions in claude.ai (the owner pastes it there).

## Where live mode stands (v0.14.0)

Built to the agreed design and tested against the fake Fyers order API (`tests/live_test.py`, 61 checks;
`tests/live_flow.js` in a browser). **Not yet run against real Fyers.** Things only a real trade can confirm:
- the order-update socket's messages (field names per Fyers' docs and the SDK's map; the order book poll is the
  fallback either way);
- that Fyers accepts SL-L -> market modification on NSE / BSE (its support page says yes) and refuses type changes
  on MCX (the app cancels and re-sends there anyway);
- the exact refusal texts and how market-price protection shows in the order book;
- whether the positions API reports `netQty` for carried (NRML) positions the way the overnight check expects.
- the holdings API's field names (`quantity` / `remainingQuantity`) for overnight delivery (CNC) stops.

Known limit: one Fyers worker per account runs actions one at a time (exits first). A Fyers call that hangs (up to
15 s, plus up to 30 s queued on the order budget) holds up the rest of that account's actions meanwhile.

Safety principles in `live.py` (keep them when changing it): an order's tag and its "sent" / pending mark are saved
before it's sent; an order Fyers didn't confirm is looked up by tag, never re-sent; every fill of a stop or exit is
booked once per Fyers order id (`L["filled"]`); any open app order that nothing is waiting for is cancelled
(`_stray`); an exit is never larger than what Fyers holds; MCX exits wait for the stop's cancel to be confirmed.

## Order flow (v0.16.0)

The owner wants a real footprint only, never an estimate. Fyers' API documents no trade feed (the tick-by-tick
socket is depth-only, NSE / NFO, 1 symbol on Standard). Monday 2 Nov: read the Log page's order-flow check (after the
owner's Fyers login) for CRUDEOIL and NIFTY futures. If exact volume is close to 100% the footprint can be built from
the normal feed; if not, the owner asks Fyers for a trade feed. Snapshot files grow by roughly tens of MB a day per
busy contract (gzip): turn recording off on the Log page once the question is settled.

## Indicators, Pine libraries and chart history (v0.20.0)

- **Settings per indicator** live on its entry in prefs `indicators`: `inputs`, `style` (Pine: `{plots|hlines|fills|bg|
  barcolor|shapes: {name: {off, colors: {"#RRGGBBAA": "#RRGGBBAA"}, width, type, ls, pl, lv}}, prec, lbl, sv, inl}`;
  Volume: `{up, down, maWidth, maLs}`), `vis` (`{m|h|D|W|M: [on, from, to]}`), `tf` / `gaps` (Pine's indicator
  timeframe). `pineApply()` lays `style` over the script's own look and fills `P.raw` (what the Style tab lists, the
  script's own colours as `#RRGGBBAA` keys). An indicator not shown on the chart's timeframe gets `r.offTf` (built
  hidden; `indVisCheck()` on a timeframe change rebuilds only when that changes).
- **Indicator timeframe:** the worker reads `indicator(timeframe =)` (PineTS keeps it in `ind._sourcePropArgs` /
  `ind.prop`, but doesn't act on it), runs the script on that timeframe's candles (asked of the page like
  request.security) and maps values onto the chart bars in `mapToChart()`. Such sessions re-run in full on ticks.
- **v0.20.1:** the Timeframe field is offered for every Pine script (the worker applies `props.timeframe` whether or
  not the script declares it). Bars of history "Auto" (`pineBarsFor()`): 1,500 bars, then `P.reach` = all loaded when
  the view's left edge passes the script's first bar (`pineViewCheck()` on every visible-range change, 500 ms
  debounce). Keep the full re-run on each new bar: PineTS updateTail alone drifts on `var` / stateful values across
  bars that arrived tick by tick (checked: up to 12 points on a running total, 0 within a bar).
- **v0.20.4:** `PfPrim` never draws P&F columns as lines: square X / O while a glyph is >= 5 px; zoomed out ("flat"),
  each X / O is as wide as the column and as tall as the box; under 1.8 px a box ("block"), X columns are solid bars
  and O columns hollow ones. `PF_PRIM.mode` / `.bh` / `.sp` say which (tests/navigation_flow.js checks all three).
- **v0.20.2:** chart navigation in index.html (`goToOpen()` / `goTo(t)` / `goToNow()` / `navWatch()`; buttons `#goBtn`,
  `#nowBtn`; Alt+G). `goTo` loads older candles in a loop through `histPrepend()` (shared with the scroll-back) and
  centres the view with setVisibleLogicalRange (not scrollToRealTime, which stopped short after a manual zoom). P&F:
  `pfZoom()` picks the opening bar spacing; `pfFixed()` gives the fixed box per contract and timeframe
  (`pfBox["CRUDEOIL@1D"]`), the old per-contract key only where ATR / box <= 8.
- **Imports:** the page resolves them (`pineLibs()` in pine.js: a saved script named like the import path, then a
  saved `library("Name")`, then `PINE_BUILTIN_LIBS`) and sends `{path: source}` with each run; the worker gives
  PineTS a resolver over that. `TradingView_ta.pine` is our own implementation (standard formulas; ta.supertrend's
  port checked equal to Pine's built-in). PineTS quirk found writing it: a history reference with a parameter index
  inside a ternary branch (`c ? x[length] : y`) evaluated wrong in a library function: compute it into a variable first.
- **Chart history:** `HX[symbol|res].days` is how far back a chart reaches after you scroll left (`histMore()`:
  `/api/history?...&until=<oldest>`; only user scrolling triggers it, `histUserAt`); `HROWS` are the raw rows on
  the chart. `fyers_link._check()` treats Fyers' `{"s": "no_data"}` as an empty answer (it used to fail whole
  chunked requests reaching back before a contract's listing).
- **Not confirmed against real Fyers:** that Fyers really answers `no_data` (per its community examples) for ranges
  before listing and how far back its intraday candles go; the owner's real Pivot Points / Chandelier scripts on
  real candles.

## Rule: every indicator on every chart type (owner, 31 Oct 2026)

Volume, every Pine script and every future indicator / Pine feature must work on every chart type, P&F included.
How it holds: indicators only ever read `DISP` (the shown bars); Pine gets them through `pineBar()` in pine.js (closeTime
= next bar's open for non-time types; P&F `close` = middle or last box). Before every release run
`tests/pine_compat_flow.js`; when a Pine feature is added, add a script using it to `tests/pine_compat.js`.
The P&F toolkit is `CT.pfTools` (ctype.js: lines, signals, anchors, counts, hcounts, patterns) drawn by `PfToolsPrim`
(index.html, built-in indicator "pftools"; labels go through a priority queue so they never overlap).

## Chart types (v0.15.0, Point & Figure v0.16.0)

Done and tested (`tests/ctype_test.js`, `tests/charttypes_flow.js`). Indicators run on the displayed bars, as on
TradingView. If the owner wants indicators on the real candles under a Heikin-Ashi / Renko chart, that's a per-
indicator option to add (not built).

## Next job

1. The owner's first real trade (Monday at the earliest): whitelist 134.209.159.171 (order permission), turn on
   Live, 1 lot on MCX. Fix whatever that shows.
2. Compare the app's charges with what Fyers deducted (roadmap item 1, last part).
3. Monday: read the order-flow check with the owner; the footprint only if it's exact. Then Telegram alerts, the
   journal, saved layouts, multi-charts, the measurement tool and the drawing tools (roadmap items 3-7 and 9, in
   that order; item 8, CFD prices, is on hold).
4. The owner tries the phone layout (v0.19.0) and the order bubble (v0.20.3) on his phone; fix what he reports.
5. The owner checks v0.20.0 on real Fyers: Pivot Points and the Chandelier exit on GOLDPETAL 2m, scrolling back,
   and the Style / Visibility tabs on his own scripts.
