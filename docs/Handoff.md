# Handoff: where the project stands (for a new chat)

Updated 12 Nov 2026, version **0.43.0** (strategies that trade by themselves, roadmap 23 a; 0.42.1: roadmap items 23-29; 0.42.0: P&L, SL and TP as an amount, % of the account or R, roadmap 22; 0.41.0: the MT5 day-end close by each symbol's sessions, EA 1.23; 0.40.0: the MT5 day-end close, 8 b4; 0.39.1: each MT5 trade's candles kept for its replay, 8 c1b; 0.39.0: MT5 trades in the journal, 8 c1). Read this, `docs/Roadmap.md` (the task list: what's next, with the agreed
live-mode design, and what's done), `CHANGELOG.md` (what's done) and `docs/Paper_Trading_Guide.md` (how the app behaves).

## Getting the code

The repo is `Sic-Parvis-Magna-Achaggi/Fyers-Paper-Trader` (meant to be private; on 10 Nov 2026 it could be cloned
without a login, i.e. it was public: the owner was told how to make it private). GitHub still had `helper/auth.py` (the
pre-v0.13 single-password login, unused): v0.34.0's release deletes it (tick the delete box). The owner uploads release zips by dragging the
folder's contents into GitHub; the server pulls every minute. Always start from the latest commit in the repo, not
an old zip. The owner releases with `tools/github_upload.html` (Release to GitHub, v0.26.1): a single page opened from disk; with his
fine-grained token (resource owner the Sic-Parvis-Magna-Achaggi organization, this repo, Contents: Read and write; the
organization must allow fine-grained tokens; an owner's own tokens need no approval; steps in README) it reads the zip in the browser, compares git blob ids with the
branch's tree, sends only changed files as blobs and makes ONE commit (fast-forward only; deletes only if ticked; warns on
an older VERSION). GitHub's web upload takes at most 100 files (the repo has 110), so dragging is only the fallback (two
drags: `tests/`, `docs/`, `server/`, `tools/` + top files; then `helper/`, `web/`). Every release is the full repo zip. A new
chat starts from GitHub's Code › Download ZIP of the latest commit. Every release: changelog text, a one-line commit message, the version number; VERSION and CHANGELOG.md
updated; `tests/routes_check.py` passes; the guide updated when behaviour changes; the project copies of the guide
and roadmap updated too.

## How the code is laid out (v0.20; drawings: see "Drawing tools and the measure" below)

- `helper/app.py`: FastAPI routes. Login is username + password + TOTP code; sensitive routes need a fresh code
  (HTTP 428, the page asks and retries). `X-Acct` header picks the paper account.
- `helper/users.py`: users, 2FA (TOTP + recovery codes), sessions, lockout, AES-GCM seal / unseal of secrets
  (`data/secret.key`), the security log (`data/audit.jsonl`), and the console rescue
  (`python -m helper.users rescue admin`).
- `helper/rt.py`: per user, the Fyers link, the price feed and the accounts (one `Paper` engine each, plus for the
  admin the one `LiveEngine`, `rt.LIVE_ID` = "live", the Fyers account itself, and that user's Fyers order-update
  socket). v0.33.0: `ensure_live()` makes it; `set_mode()` only refuses (paper accounts have no Live option). Data: `data/u/<user>/` and `data/u/<user>/a/<account>/` (a Live account keeps its Fyers
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
  (login gates, 2FA set-up, step-up, Security and Users settings, account switcher), `web/live.js` (the PAPER / LIVE switch,
  KILL, live warnings, the Fyers stop on each position, NO STOP + Place my stop, the Live card with Fyers' funds; it
  wraps paperUpdate, renderPlan, pgPositions, pgAccount, posBars and renderRules).
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
- `helper/mt5.py` (the MT5 bridge, v0.34.0) and `helper/mt5acct.py` + `web/mt5acct.js` (MT5 accounts, v0.36.0): sections below.
- `helper/jshots.py` + `web/jshots.js`: the journal's pictures and their Telegram copy (v0.27.0, section below).
- `web/jinsights.js`: the journal's Insights, weekly review, walk-through, calendar, Copy for Gemini, export (v0.28.0).
- `tests/`: the test kit (fake Fyers feed and order API, route check, engine tests incl. `live_test.py`, browser
  tests incl. `live_flow.js` and `mobile_flow.js`). See `tests/README.md`.

Test kit (v0.28.1): `mock_server.py` adds the response headers in `server/Caddyfile`'s `header` block (as Caddy does),
so a header that breaks something (the grid's frames under `X-Frame-Options DENY`) fails the browser tests too. When
changing the Caddyfile, re-run `multichart_flow.js`.

Test data (1 Nov): many runs on one data folder in one day pile up losing paper trades in today's journal session, and
the journal's 2% lockout then refuses the tests' orders (journal_flow, live_flow, then everything after live_flow leaves
the account Live). Start from fresh data (make_old_data.py + security_flow.js) when that happens.
`drawings_flow.js`'s "a drag on the new trade's SL line moves the SL" failed once in 4 runs (1 Nov, v0.28.1). Same advice.

Test-kit quirk (1 Nov): `navigation_flow.js`'s "Go to a date on 1D" check fails some runs (landed a day late; 2 of 5
runs on 1 Nov, on v0.20.2 code too). Cause not found; it's a test-kit issue so far (the mock stamps day candles at
00:00 UTC, real Fyers at IST midnight). Re-run it if it fails; worth a proper look when touching Go to.
`live_flow.js`'s "history: the trade, closed by the kill switch" failed once in 4 runs on 1 Nov (passed on re-run):
probably the history read before the kill switch's close was booked. Same advice.
`chain_lists_flow.js`'s "expiries offered" and the next check fail since early Nov (5 Nov: on v0.32.0 too): the test
contract list in `tests/fixtures/` was saved 30 Oct and most of its option expiries have passed. Refresh the fixtures (a new
symbol master) to fix it.
The Live account is one account for every run (v0.33.0): `live_flow.js` and `telegram_flow.js` turn its daily / max loss off
while they trade (and put them back), or earlier runs' losses today block their orders. The fake Fyers' order ids are unique
per run (the app remembers handled ids, as for real Fyers).
`jinsights_flow.js`'s three Copy for Gemini checks (today / this week) fail when run between midnight and the account's
reset hour (2 Nov, 01:00 IST: trades belong to the previous trading day, Gemini's "today" is the calendar day). Run it in
the daytime. (Roadmap follow-up.)
`mt5_flow.js`'s "no stray extra candles from the ticks" fails on most first runs on fresh data (10 Nov: v0.35.0 too, 1747 -> 2004;
passes on re-runs): the chart's second 5m history answer lands inside the check's 3 s window. A test-timing issue; re-run.
`replay_flow.js` failed once (10 Nov, v0.36.0 full run; passed alone, 48/48): its tightened paper stop was hit by the mock's
random walk before the second move. `multichart_flow.js`'s crosshair check failed once in the full run (passed alone).
`replay_flow.js` turns the mock's round-the-clock candles on (`/_mock/allday`) and off at the end; it sets the journal's
automatic pictures off itself (other suites turn them on).
`indicator_settings_flow.js`'s "at the start of a contract's history it stops asking" failed once in 2 runs on 1 Nov
(v0.22.0; passed on re-run, 37/37). Same advice. 11 Nov (v0.37.4): 2 fails in 4 runs (200 daily candles loaded, the
"No older candles" note not yet up in its 4.5 s window); passed on v0.37.3's code too. Worth widening that window.

## Strategies (v0.43.0, roadmap 23 a)

- **`helper/strategies.py`** (one `Book` per user, `BOOKS`; `rt.UserRT.attach` starts it, `on_tick` feeds it, `stop` drops
  it; `rt.watch_symbols` adds running strategies' contracts so the engines get their prices). `clean()` (the rules; `Bad`
  for the page), `needs_stepup()` (Live / MT5 switched on). Files `u/<uid>/strategies.json` {strategies, state: {count:
  {"sid|aid": {day: n}}}}, `strategies_log.jsonl` (also broadcast as `strat_log`; `strats_changed`).
  - Sessions: one `CA.Sess` per strategy + contract (key "Q|", spec `strategy: True`, tail 60), own `CA.Series` (ticks from
    `on_tick`), run only when a bar closes: timed charts on the first tick of the next bar (op "bars" -> Node's newBar ->
    full run) or `bar_end + 2 s` (op "full", `closed_last`); Renko / range / LB / P&F when the series changes (3 s). Only a
    full run's `orders` count. `done[(sid, sym)]` = the last closed bar acted on; set to the bar before the live one at
    open (history isn't traded).
  - `on_bar()`: `read_orders()` (the bar's last market entry, closes, brackets per entry id, other entries) -> per switched-on
    account: closes (close / close_all / an entry the other way), then `_open_trade()` (`_guard()`: kill switch (`L` / `M`
    halted), hours, trades a day (state count), open at once, the day's loss from the engine's History (`strat.id`, `day`),
    expiry, the cut-off before `_times()`'s square-off / MT5 `dayend_for`), `stop_for()` (script / ATR / points / line /
    swing + buf ticks, the right side), `fetch_margin` in a thread, `e.place(req)` with `strat` {id, name, eid} and `tr`;
    then the script's stop followed with `modify_pos` (tighter only). `held()` = positions / orders with `strat.id`.
  - `test()` -> Node op "test" (all bars, `orders`, a plot's values) -> `simulate()` (pure: fills, BE / trail like
    `Paper._trail_pos` but from the next bar, limits, `charges.size_for_risk` / `net_at` / `breakeven` with the cost
    account's `row`) -> `stats()`.
- **`helper/pine_node.mjs`:** `REC` (only during a strategy's run): `_initializeContext` wrapped: `pyramiding` 1e6 in
  `_propOverrides` (every entry counts) and the context's `strategy.pending_orders` pushes recorded into `ctx.__orders`
  ({bar, cat, id, dir, from, stop, limit, type}); `ordersOf(s, fromI)` maps them to the shown bars' times (`s.off`).
  `fullRun` pins a strategy's first bar (`s.anchorT`, moved on only after 2 × bars) so `bar_index` doesn't shift each bar.
  Op "test" (a throwaway session "T|rid").
- **Engines:** `Paper.plan` puts `strat` / `tr` (validated, own_be / own_sl) in the plan; `fill` -> `pos["tr"]`,
  `pos["strat"]`; pending orders and `LiveEngine.place`'s order carry them (`fill(plan)` from `{**o}`); MT5 `place` ->
  `M.placed[tag]` {tr, strat} -> `_adopt`; `Paper.close` / MT5 `_record` copy `strat`; `pos_view` has it. Journal
  `upsert_open`: `t.strategy` + set-up tag.
- **app.py:** `/api/strategies` (summary, the accounts a strategy can trade, log), `/save` (step-up when `needs_stepup`;
  audit), `/action` (on needs step-up with Live / MT5 on), `/stop_all`, `/test`, `/log`.
- **Page:** `web/strategies.js` + `.css` (after calerts.js): `PAGES` gets "strategies" before "alerts"; ⚡ `.canav.sgnav` in
  `#nav` (count `#nbStrats`, after login via `refreshState`); `sgRender` (cards, log), `sgEdit` (the rules panel; script
  libraries via `pineLibs`; contract search `/api/symbols`; `stepUp` for 428), `sgTest` / `sgResult` / `sgCurve` (SVG);
  ws `strat_log` / `strats_changed`; the phone's More row. `.sgtag` ⚡ on `#posList` (paper.js), `#pgPos` (pages.js), the
  phone's Trade tab (mobile.js). The top bar has 12 px spare at 1500 px with the MT5 pill (nav padding 6 px).
- **Tests:** `tests/strategies_test.py` (57), `tests/strategies_flow.js` (26); `mt5acct_test.py` / `live_test.py` check the tag.

## P&L units (v0.42.0, roadmap 22)

All in the page, no server change. `web/paper.js` (top): `pnlUnits()` reads `pnlMain` / `pnlSecond` from the chart prefs
(`CHART_DEFAULTS` in index.html: amt / r; saved on the server with the other chart prefs); `pnlTxt(v, oneR, est, amtFmt)`
writes "main · second", `pnlPart(0|1, …)` one part (table columns, the phone), `openTotalTxt()` the Open P&L (R = sum of
the trades' R), `ordR(o)` a pending order's 1R (−at_sl), `acctSize()` = `P.snap.rules.size`. `pnlCycle()` (U, clicks)
and `pnlRefresh()` redraw everything (lines, panel, Trades page via `PG` keys, `mPnlRefresh()` in mobile.js,
`mtAcctRefresh()` in mt5acct.js). The zones' labels record hit boxes (`P.zoneHits`) checked in the chart's click handler
(not while a drawing tool is active or a drawing selected). Test: `tests/pnl_units_flow.js`.

## Alerts (v0.38.0, roadmap 21)

Asked 11 Nov ("build alerts like tradingview ... multiple conditions ... both price and technical ... so I don't need to buy
Tradingview ... how we can get alerts in mobile"). Design in the roadmap (item 21); user's guide: Paper_Trading_Guide › Alerts.
- **`helper/chartalerts.py`** (one `Book` per user, `BOOKS`; `rt.UserRT.attach` starts it, `on_tick` feeds it, `stop` drops
  it): `clean()` validates the page's alert (Bad = a sentence for the page); `_keep_libs` keeps a script's libraries on an edit
  (the page's copy has none: `public()` strips them); `set_level` = a dragged 🔔 line. Files `u/<uid>/alerts.json`,
  `alerts_log.jsonl`. **v0.38.1: no limit on the number of alerts** (owner); the limit is on calculations, server-wide:
  `calcs_in_use(exclude)` = every Book's "P|" sessions with refs; `Book.keys_for(a)` / `_check_room(a)` (upsert, resume /
  restart) refuse only the NEW keys past `max_calcs()` (`alerts_cfg.json` `max_calcs`, else `auto_calcs()` = 35% of
  /proc/meminfo's MemTotal at CALC_MB 5, min 20); route `/api/alerts/limits` (admin). `load()` for the page's Server load
  (`RUNNER.busy` = Node's `took` per request over 60 s -> CPU %; `RUNNER.ping()` every 20 s -> `mem`); Node's heap =
  `node_heap_mb()` (half the RAM, 512-4096). Measured 11 Nov: ~4 MB per session (3,000 bars, RSI + MACD + Supertrend + EMA),
  a live update of 200 sessions ~1 s of one core. Other limits: 5 conditions, 60 symbols on the feed (`feed.alert_syms`,
  added AFTER the pages' symbols in `Feed.wanted()`; the rest listed as `unwatched`).
  - **Tick conditions** (`tick_mode`: the real price vs numbers / drawings, not "close", not moving): `on_tick` -> `_eval(tick=)`,
    previous tick in `st["prev"]` (seeded from `feed.last` when armed), day high / low sweep (`hl`). Need no candles when
    the comparands are numbers.
  - **Series conditions:** `Series` (port of the page's tfPlan / bucket / aggBars / noTradeDrop / liveBar) per (symbol, tf),
    loaded by `candles.get` / `mt5.history`, refreshed every REFRESH_SEC (recalculates only if closed bars changed).
    `Sess` = one Node session: "B|" bars (+ drawings, P&F signals) or "P|" a script / built-in (`IND` -> `ind_code`) with
    its inputs; shared by alerts with the same key. `_pump` every 0.25 s: load, `_open`, `_update` (paced max(1 s, 3 x took),
    `time.monotonic`). `_after` -> `_eval` (live bar vs the one before) or `_close_check` (once per bar close: all sessions of
    that tf must show the new bar; the first output is only a baseline) / `_calls` (any alert() call, the script's freq).
    `_timers`: expiry; a bar whose time is up + 2 s -> `_close_timer` (brings every session up to date, Pine in full via op
    "full"; if that brings a new bar, `_close_check` already did it).
  - `_fire` -> log, `feed.broadcast({"calert"})`, `deliver` (thread: Telegram `send_user(who="alerts")`, `webpush.send`,
    `webhook` (public IPs, ports 80 / 443; `FTM_WEBHOOK_PRIVATE=1` in tests)). Placeholders: `render` (`_plain` numbers).
- **`helper/pine_node.mjs`**: Node runs `web/pine_worker.js` UNCHANGED (its text + `export {run, tick, sessions}`, imported
  as a data: URL), `self.postMessage` captured; PineTS's `run` patched to `setAlertMode('all')` (alertcondition / alert() on
  every bar). Chart types by `web/ctype.js` (`CT.transform`, box from `CT.size` once per open), drawings by a port of
  draw.js `t2L` (bar index, snapped), P&F signals by `CT.pfTools`. Ops open / bars / full / draws / close / data (the answer
  to a `need`: request.security, fetched by `chartalerts.need_candles` for the user of the oldest pending request).
  `chartalerts.RUNNER` starts it (`node_path()`: `FTM_NODE`, `/opt/ftm-node/bin/node`, PATH), restarts on exit.
- **Node on the server:** `server/install.sh` `node_install` (pinned `NODE_VER` v22.12.0, nodejs.org tarball + SHASUMS256,
  `/opt/ftm-node`); a failure only prints a warning (technical alerts wait; the Alerts page shows `RUNNER.err`).
  **Not yet run on the real droplet** (no internet to nodejs.org from the build machine; tested with a file:// mirror).
- **`helper/webpush.py`**: VAPID key (sealed, `webpush.json`), RFC 8291 encryption (checked against the RFC's worked
  example), `u/<uid>/push.json`. Routes `/api/push/subscribe|unsubscribe|test`; `/sw.js` (Service-Worker-Allowed: /) and
  `/manifest.webmanifest` from `web/`; icons in `web/icons/`. **Not tested against Google's / Apple's push services** (no
  internet here): the browser test drives the service worker through Chrome's DevTools push.
- **`web/calerts.js` + `calerts.css`** (after replay.js, before mobile.js): wraps `connectWS` (the socket's "calert"),
  `pgShow` (page `alerts`, inserted before Log), `drawLines` (`caLines`: 🔔 price lines -> `P.alertDrags`, paper.js's drag
  code moves them; `P.drags` includes them), `drMenu` (🔔 Add alert…), `renderIndPick` (🔔 per script), `mMore`,
  `refreshState` (loads after login). Alt+A; right-click on the chart (not a drawing: draw.js handles those first) ->
  `#caCtx`. Dialog keys: price:, bar:, pine:<ind id>:plot|ac|any, draw:<id>:<edge>, ind:<t>:<out>, pf:, saved:<n>.
  v0.38.1: `caPlusWire` (`#caPlus`, appended to section.chartwrap: shown while the pointer is over the price scale of pane
  0 only, `inScale`; the phone: a tap on the scale, 4 s; click -> `caCtxMenu`: "now" = `caInstant` (cross, once, the usual
  notify) / "at" = the dialog); `caDselBell` (wraps `drUiSel`: `[data-cab]` on `#dsel`, gold + count from `caDrawAlerts(id)`,
  click -> `caDrawMenu`); `drMenu` lists ✎ each alert (`[data-cae]`); `caLoadHtml` / `caLoadWire` (Server load, refreshed
  every 15 s on the page).
  In a multi-chart cell (`FTM_CELL`) no pop-up / sound / service worker (the page around it has them). The nav item is a
  bell icon with an overlaid count; calerts.css tightens `#nav button` to 7 px padding, so the top bar has 88 px spare at
  1500 px (52 before; the flow, live_flow and mt5_flow check it stays on one line).
- **Tests:** `tests/chartalerts_test.py` (74), `tests/chartalerts_flow.js` (53); mock: `/_mock/price`, `/_mock/hook(s)`.

## Pine plots: breaks (v0.37.4)

The chart library (Lightweight Charts 5.2.1) joins a line or area across whitespace points, so `plot.style_linebr` /
`steplinebr` / `areabr` and a per-bar colour of na were drawn bridged (owner, 11 Nov: everget's Chandelier Exit on XAUUSD
showed diagonals between its stops; PineTS's values were right). `pineApply` (web/pine.js) now makes the bridging segment
transparent (`PCLEAR`): a segment takes the colour of the point it starts from, so on a line / area the last point before a
break gets `PCLEAR`; on a step line, transparent points inside the break carry the step (the first holds the old value, the
last the new one, so no riser shows). `plot.style_line` still bridges (TradingView does). A plot whose latest value is na
gets no price label (`lastValueVisible` / `priceLineVisible` false). `pine_compat_flow.js` reads `api.data()` back and
fails on any visible segment across an na bar, on every chart type. If the library is updated, re-check this: a version
that breaks lines at whitespace by itself would make the trick unnecessary, not wrong.

## MT5 accounts (v0.36.0 b1; v0.37.0 b2 / b3: stage b complete)

**v0.37.3 (11 Nov, owner: "yes" to both):** EA **1.22** (`#define FTM_COMMISSIONS`; `CommRules()` =
SymbolInfoCommissions as JSON with enum names, `CommDue()` once a minute per symbol) -> `sym` arrays' 12th element `cr`
(kept between minutes in `M.sym`). `Mt5Engine.comm_for(name)` -> {in, out, in_fix, out_fix, src}: learned (`M.comm`) >
`_rules_comm()` (instant rules; INOUT / IN / OUT; the 1-lot tier by volume; MONEY_DEPOSIT or the account's currency per lot
/ per deal; PERCENT of value; others -> None) > `_similar_comm()` (same first path segment) > `comm_default` (None = not
typed; `comm_typed`; a saved 0 without it is read as None) > "none" (MT5 lists no rule) > None -> `plan()` refuses.
`charges.mt5_comm_amt(row, volume, leg)` = rate × volume + per-deal fix (used everywhere a commission is worked out).
`tick_value()`: learned > OrderCalcProfit checked against `_conv()` (contract × the profit currency's rate from the broker's
FX symbol, prefix / suffix kept, streamed via `temp_watch`; the bigger one if > 2% apart) > contract × rate > the tick value
"(unchecked)" -> `plan()` refuses. `plan()` returns `comm`. Page: `mtCommCell` / `mtCommSrc` (Account page's commission
table, a From column, untraded symbols too), `mtPerMove` adds the commission; the rules form's default is empty = not
typed. Fake: GBPUSD, EURGBP (profit GBP), `CRULES`, `--ver 1.22`. **Not seen on a real MT5:** 1.22 compiling (the owner's
MT5 build must be July 2026 or later) and what FundingPips' rules really return (MQL5's forum has a report of the function
returning no rules on MetaQuotes-Demo, so "no rules" comes last: 0 only when nothing else is known, labelled "MT5 lists no
commission" on the ticket; the first deal corrects it).

**v0.37.2 (serious bug, 11 Nov):** the owner's first real order from the app: SELL 0.33 XAUUSD at 4,057.76, SL 4,064.22,
0.25% risk; the app showed −$3.78 at the stop, MT5 −$217.94 (= 6.41 × 100 oz × 0.33 + commission). The app's gross was
move × 0.33, i.e. tick value / tick size = 1 instead of 100: his terminal's SYMBOL_TRADE_TICK_VALUE (or what reached the app)
was 100× too small (the fake sent the right 1.0, so no test caught it). Fix: `Mt5Engine.tick_value(name, tick)` picks
(1) `M.ppl[name]` learned in `_learn_value` from each open position's MT5 profit (POSITION_PROFIT / (move × volume), moves of
20+ ticks, saved), (1b) `si.pp` = EA 1.21's OrderCalcProfit(BUY, 1 lot, bid -> bid + 1.00), (2) tick size × contract when
`cprofit` (the symbol list) = the account's currency, (3) MT5's tick value; a reported one off by > 2% -> `_warn_once`.
`row()` carries `tv`, `tv_src`, `tv_mt5`; `plan()` refuses with no value and returns `per_move` / `tv_src`; snapshot
`mt5.values` (the Account page's table). Page: `mtPerMove()` (a line in `#tkPv`). **Confirmed by the owner (11 Nov, 11:19,
the Account page's table):** FundingPips-SIM1's XAUUSD reports a tick value worth $1.00 per 1.00 move per lot (0.01 per
0.01 tick: 100x too small for its 100 oz contract); the app uses $100.00, learned from MT5's profit on his position. SPX500:
$50.00 from OrderCalcProfit, its tick value agrees (so EA 1.21 is installed). The owner set Max margin use % to 100 on his
MT5 account (11 Nov).
Noticed in testing (not changed): the chart tool's SL / TP come from the chart's prices (the price terminal), the entry from
the account's own terminal; two terminals at the same broker agree, but an account at another broker whose price differs by
more than the stop distance gets "the stop loss is on the wrong side". Worth a look if the owner adds a second broker.

**v0.37.1:** no login to type on MT5 accounts (owner, 11 Nov: "I'm the only one trading. We don't need so much security"):
`M.confirmed` is always True on load, so `NeedLogin` is never raised; the route `/api/mt5acct/confirm`, the dialog and
`papi`'s `need_login` handling stay (unused). Also fixed: `/api/paper/place` and `be_all` now pass `NeedLogin` on as
`need_login` (they swallowed it as a plain refusal: the owner saw "first change ... type its login" in red under PLACE).
On the MT5 side the page re-reads `/api/accounts` every 15 s (end of `web/mt5acct.js`), so a terminal that connects later
joins the switcher. Asked 11 Nov about leverage: the ticket's margin is MT5's OrderCalcMargin ($13,462 a lot of XAUUSD on
his demo = gold's own leverage, not the account's 1:100); MT5 accounts' Max margin use % defaults to 0 (off): told the
owner, his call whether to set a default.

**v0.37.0 (b2 / b3, EA 1.20)** - on top of the b1 notes below:
- **EA 1.20:** `OPEN <tag> <sym> <side> <market|limit|stop> <vol> <price> <sl> <tp>` (`DoOpen`: CTrade Buy / Sell /
  BuyLimit / ... with SL / TP and comment "FTM <tag>"; result ticket = `ResultOrder()`); `sym` arrays grow to [tv, ts, vstep,
  contract, digits, margin buy 1 lot, margin sell 1 lot, vmin, vmax, stops level] and include the SUB symbols; `TRAIL
  <ticket> <side> <best> <BE trigger> <BE price> <SL start> <SL dist> <floor> <min step>` (10 fields; `TRAIL <ticket> 0` =
  forget) -> `g_t*` arrays; `TrailBest()` every timer tick (best bid), `Offline()` = no answered call for OfflineTrailSec
  -> `OfflineTrail()` (PositionModify, only tighter, 2 s apart) -> `g_trailed` -> body `"trailed": [[ticket, sl, msc]]`
  (dropped after a 200, like results).
- **Server:** `Mt5Engine.plan()` (temp_watch the symbol for this terminal; "waiting for its price" before the first tick;
  lots typed = volume -> steps, `_steps` marks the converted request; min / max volume; `_hedge_block` wins over other
  reasons; ₹ / "1 lot" in the paper engine's words turned into $ / 0.01 lot), `margin_per_lot` from `M.sym` mb / ms,
  `guard_new` = `_block(EA_TRADE)` / kill switch / hedge / news / the paper guards; `place()` -> `_cmd("OPEN")` +
  `M.opening[tag]` (shown) + `M.placed[tag]` (the plan's sl / tp / trailing, 30 days) -> `_placed_meta(comment)` in `_adopt`
  and `_take_orders` links it. OPEN: OPEN_EXPIRE 10 s undelivered; `_lost` never re-sends (`_tag_seen` looks for the tag).
  `kill()` / `resume()` (`M.halted`); routes `/api/mt5acct/kill`, `/resume` (step-up), `/news` (read now). `_news_block(s,
  what)` (Master) / `_news_note(row)`; rules `news_on`, `news_min` 5, `news_warn_min` 15. `_trail_spec` / `_trail_lines`
  (on change, every TRAIL_EVERY 30 s, all after `dcur == 0`); `M.etrail` (the EA's reported moves) -> `_ea_trailed` instead of
  `_adopt_stops`, and an unsent older MOD is dropped so the EA's tighter stop is never loosened. `siblings` (rt.py) = the
  user's other MT5 engines. `charges.size_for_risk` reaches MT5's vmax.
- **`helper/news.py`:** ForexFactory's export `https://nfs.faireconomy.media/ff_calendar_thisweek.json` (env `FTM_NEWS_URL`;
  `file://` works), read hourly from app.py's 5 s loop while any MT5 account exists (`news.tick`), merged with what's kept
  8 days in `data/news/ff.json`; `parse`, `inside`, `next_event`, `upcoming`, `status`, `set_events` (tests). **The real
  feed hasn't been read from here** (no internet in the build environment): its format is as documented / widely used;
  check Account › High-impact news after the update.
- **Page:** `lotsIn` / `lotsStep` / `isMtAcct` (paper.js; mobile.js uses them), `CUR()` in the risk labels, `mtPlace` (MT5
  PLACE), `mtOpening` (`#mtOpening` on the panel), `mtKillBtn` / `mtKill` (`#bKillMt5`; the phone's `#mKill`), the Account
  page's kill / resume / news card, the rules form's news rows (`data-t="b"` booleans). CSS: the product switch and Fyers'
  `#pBudget` hidden on MT5 (the top bar had no room for KILL at 1500 px); the switcher's label is "● login · $balance".


- **What:** each MT5 login whose terminal runs FTM Bridge **1.10** is an account of its own (`mt5-<login>`, the admin's only),
  on a third side of the top-left switch (PAPER | LIVE | MT5). b1 = see and manage; **placing from the app is b2** (`plan()` /
  `place()` refuse with `Mt5Engine.B2`).
- **EA 1.10** (`mt5/FTM_Bridge.mq5`, `mt5/README.md`): still calls out only. The sync body (`v` 2) adds `trade` {on: input
  AllowTrading, term: TERMINAL_TRADE_ALLOWED, mql: MQL_TRADE_ALLOWED}, `pos` [[ticket, sym, type 0/1, volume, open, sl, tp,
  current, swap, profit, time_msc, magic, comment, identifier]], `ord` [[ticket, sym, type 2-7, vol0, vol, price, sl, tp,
  setup_msc, magic, comment, stoplimit]], `sym` {name: [tick_value, tick_size, vstep, contract, digits]}, `deals` [[ticket,
  order, position_id, sym, type, entry, volume, price, commission, swap, profit, fee, time_msc, magic, comment, reason]] (at
  most 200 after its cursor; `dmore`), `dcur` (cursor msc; 0 = not set), `res` [[tag, ok, retcode, msg, ticket]]. Answer
  lines: `DEALS <from srv sec>` (sets the cursor), `MOD <tag> <ticket> <sl> <tp>`, `CLOSE <tag> <ticket> <vol, 0 = all>`,
  `CANCEL <tag> <ticket>`, `OMOD <tag> <ticket> <price> <sl> <tp>` (0 = none). Ticks, deals and results count as delivered
  only after a 200 (`DropResults`, the cursor commit, before `Handle`). The EA remembers the last 200 tags (`Remember`): a tag
  seen again re-sends its result, never runs twice. CTrade with magic 20261110, `SetTypeFillingBySymbol` before a close.
  **Never compiled here**: the owner compiles it. Things only MT5 can confirm are listed in "Next job".
- **Server, `helper/mt5acct.py`:** `Mt5Engine(Paper)`. `mt5.py`'s sync calls the hooks rt.py sets: `REPORT` ->
  `rt._mt5_report` -> `UserRT.ensure_mt5(login, info)` (makes the accounts.json row {id, mode "mt5", kind, login, server,
  demo, currency}) -> `on_report(body, bridge)` -> answer lines; `WATCH` (the account's symbols: a non-price terminal's `SUB`)
  and `TICK` (a non-price terminal's ticks go only to its own account). Ticks carry `lg` (the login); `Mt5Engine.on_tick`
  takes only its own login's. EA 1.00 (no `pos`): the account shows with a warning, changes refused.
  - **on_report order:** results -> `sym` -> deals (`_take_deals`: stored in `mt5_deals.json`, `_learn` commission, `_in_deal`
    real entry commission, `_book_out` closes) -> positions (`_take_positions`: `_adopt`, MT5's SL / TP vs `b_sl` / `b_tp`,
    `_adopt_stops` when changed in MT5 with no MOD in flight, volume checks, `gone` -> `_book_gone` estimate after GONE_SEC)
    -> orders -> size from the first deposit (until typed) -> day start -> `DEALS` if `dcur == 0` or a resync -> `_lost()` ->
    `_push_all()` (desired sl / tp vs MT5's: MOD / OMOD; an unsent one takes the newest values) -> `_out()` (rate 30/min,
    MOD_GAP 2 s per ticket, CLOSE / CANCEL expire after 20 s undelivered, MOD after 300 s; marks `sent` and saves first).
  - **Positions:** id `P<ticket>`, `pid_mt` = position identifier (deals match on it), qty = volume steps (`row.vstep`),
    `comm_in` (from the opening deal, else estimated: `comm_est`), `paid` = comm_in − swap, `b_sl` / `b_tp` (MT5's), `mt`
    (MT5's sl / tp / price / profit / swap), `exiting` {why, tag, tries}, `mt_err`, `retry_at` / `backoff` (2.5 s doubling to
    60 s), `outside`, `found`. History records: MT5's exact profit, `charges` {commission, swap (cost +), total, FIELDS 0},
    `ticket`, `deals`, `ccy`, `part`, `from_history`, `est`.
  - **Reasons:** the deal's reason (4 sl -> sl / be / trail sl, 5 tp, 6 stop out, 0-2 closed in MT5, 3 by an EA), or the
    app's `exiting.why` for its own CLOSE.
  - **`_check_pos`:** no paper exits; best / worst; if the desired SL / TP is passed and MT5's isn't at least as tight ->
    `_close` (market) "sl (the app's stop: MT5 hadn't taken it yet)"; then `Paper._trail_pos` (split out of `_check_pos` this
    release). `_check_order` never fills. `exit_mark` falls back to MT5's current price before the first tick.
  - **Money:** `charges.py`'s MT5 branch (`is_mt5`, `mt5_comm(row, qty, leg)`, `mt5_gross`): rows from `Mt5Engine.row()` carry
    `tick`, `tv` (tick value), `vstep`, `comm` {in, out} (learned per symbol and leg: `M.comm`, tolerance for MT5's cent
    rounding 0.0051 / volume; the bigger deal's figure wins; a real change -> `diff` + a warning; else `comm_default`).
    `breakeven()`'s loop is bounded now (a tick value of 0).
  - **Account figures:** MT5's balance / equity / margin / free. `trading_day()` = the broker's date; `_midnight_balance()` =
    balance − every deal's profit + commission + swap + fee since the broker's midnight. `floors()`: daily = base − daily% ×
    (base or size: `daily_of`), base by `day_from`; max = size × (1 − max%) static or peak − size × max% trailing. Rules:
    `MT5_RULES` defaults (5000, 5%, 10%), settable keys `MT5_KEYS` (+ `daily_of`, `phase`, `comm_default`); `FIXED` keeps
    Fyers' square-off off. `size_set` once typed.
  - **Writes** (`_writable`): no account / EA < 1.10 / offline / AllowTrading off / Algo Trading off -> refused;
    unconfirmed -> `NeedLogin` (app.py's `_paper` answers `need_login`; the page's dialog posts `/api/mt5acct/confirm`).
    `set_trail` needs it only with positions open. `M.confirmed` per account.
- **rt.py:** `paper_ids()` excludes MT5; `mt5_ids()`; `engine(aid)`: an unknown `mt5-...` id -> `mt5_none()` (an empty
  `Mt5Engine`, `none`, never saved), never a paper account; `engine_id(e)`; `account_list()` mode "mt5" + online, currency,
  ea, server, demo; MT5 rows can't be renamed / archived and don't count against the 20 paper accounts. Journal hooks since
  v0.39.0 (below).
- **app.py:** `/api/side` takes `mt5` (admin + step-up); `_eng(write)` refuses an MT5 account unless the session is on MT5
  (403); `/api/mt5acct/confirm`, `/api/mt5acct/resync`; MT5 CSV columns; `/ws` uses `engine_id`. **users.py:** sessions'
  `side` may be `mt5` (admin). **journal.py:** MT5 accounts included since v0.39.0 (section below).
- **Page:** `web/mt5acct.js` (after mt5.js): `mtState` / `mtLine` (each trade at MT5: panel `#posList`, Trades page),
  `mtBanner` (`#mtWarn` in the header: no account, MT5 off, old EA, AllowTrading / Algo Trading off, limits breached), `mtPanel`,
  `mtFoot` (`#mtFoot`: the floors), `mtTicketHint`, `mtConfirm` (`#mtConfDlg`), `mtAccountPage` (wraps `pgAccount`), the
  rules form (`MT5_RULES`, `mtRulesHTML`; wraps `renderRules`; `saveRules` takes `data-t="s"` as a word now), `papi` wrapped
  (need_login -> the dialog -> the same request again). `security.js`: `sideMT5()`, `mt5List()`, `mtCash()`, `mt5Label()` /
  `mt5Title()`, `acctSetup` / `acctSwitch` on the MT5 side (localStorage `ftm.acct.mt5`; `mt5-none` before any account).
  `live.js`: `sideNow()`, three buttons in `#sideSw`, `sideMenu()` (`#mSideMenu`, the phone), `mtSideDialog()` (step-up).
  `paper.js`: `CUR()` / `CURLOC()`: `rs` / `rsS` in the snapshot's `ccy`; `breakdown` names commission / swap; `short()`
  strips `MT5:`. `mobile.js`: `mAcctSheet` on MT5. CSS: `--mt5` (#8b5cf6), `body.is-mt5`, `.sidesw.mt5`, `.mtline`, `.mtwarn`.
  The switcher's label is short (the server in its tip): the top bar has no room at 1500 px otherwise.
- **Tests:** `tests/mt5acct_test.py` (85, in-process), `tests/mt5acct_flow.js` (37, browser; fake_mt5 `--ctl 8769
  --history`). `tests/fake_mt5.py`: an MT5 Hedge account + the 1.10 protocol + `--ctl` (open / pending / modify / close /
  shift / swap / refuse / trade / comm / jitter, GET /state); tickets unique per run. On re-runs over one data folder the
  login is already confirmed (the flow then skips the dialog) and earlier runs' fake trades vanish (booked "est.").

## MT5 trades in the journal (v0.39.0, roadmap 8 c1)

Asked 11 Nov 2026 (the owner noticed MT5 trades weren't in the journal: left out by design until 8 c). Owner's answers:
money in $, apart from ₹; session day "can be both" (a setting per MT5 account); lockouts on MT5 "an option with 2FA"; the 2%
line of "FundingPips' day's starting balance".
- **rt.py:** MT5 engines get `journal_hook` / `journal_guard` / `journal_lock` like paper / live ones.
- **mt5acct.py:** `Mt5Engine._jn` (adds `ccy`, `lots` = MT5 volume, `vstep` to an open position) called from `_adopt` (a
  position seen: from the app, from MT5, already open), a volume that grew, `_book_out` (the app's position; a history close
  seen live; a deal replacing an estimate) and `_book_gone` (the estimate). `day_start_balance(day)` = the balance at that
  broker day's midnight (today: `self.day["start_bal"]`; else balance − every deal's pr + c + sw + fee since that midnight, srv
  time). `balance_at(ts)` = balance after a moment (history trades' `balance_after`, for the balance curve).
- **journal.py:** `is_mt5(aid)` ("mt5-"), `pkey(aid, obj)`: an MT5 trade's key is `P<pid_mt>` (MT5's position id), so a
  part ("P..p1"), an estimate and the late deal that replaces it (`_record_hist` books it as "P<pid>d<deal>") are one
  trade; in `ingest_close`, an MT5 record that isn't `est` replaces the trade's `est` close (keeps its init_risk). Trades have
  `cur` (the account's currency) and `src` "mt5"; `rec.src == "mt5"` = placed in MT5 (`outside`). `keep()`: a record without
  stops (MT5's history) keeps the trade's. Settings `mt5: {aid: {day: broker|ist, block}}` (`mt5_cfg`, `set_mt5`;
  default broker, block False). `day_of(e, aid, ts)` (IST from the reset hour for "ist", else the engine's day) is used
  everywhere a session day was `e.trading_day()` (`day_now(urt, aid)` for app.py). `mt5_base(e, aid, day)` = FundingPips'
  day-start balance (of the broker day an IST session starts in), else the size. `sync` covers MT5 engines (not `none`),
  registers `Journal.rows[aid] = e.row` (MT5 rows for `_planned`, jreplay's `_row`), and `_mt5_redate` puts every MT5 trade
  on its day and base (and `balance_after` from `balance_at`) each time. `today_state`: an MT5 account with block off has its
  lockouts `on: False`, `mt5_off: True`. `money(x, cur)`. View: MT5 accounts with `cur`, `mt5` cfg, `server`, `dd_base`,
  `broker_day`. CSV: a Currency column, money headers without ₹, "MT5" in Placed in.
- **app.py:** `/api/journal/mt5` {acct, day} / {acct, block} (block needs `_stepped`, either way; security log "Journal
  lockouts on MT5 on/off"); journal routes use `journal.day_now`; `jreplay.note_order` for MT5 too.
- **jreplay.py:** `_row(t)` takes the MT5 engine's row first; `view` returns `cur`. **jshots.py:** `_money(x, signed, cur)`,
  "MT5's candles" in the footer.
- **Page:** journal.js: `jCur()` (the view's currency: `JN.cur`, else the side: MT5 -> the MT5 account's currency, else INR;
  reset when the side changes), `jCurList()`, `jSym`, `jMoney(n, signed, cur)` (default `jCur()`; every `t.<money>` passes
  `t.cur`), `jModeTag` / `jModeWord` (MT5 badge `.jt-mt5`). `jFiltered` keeps only the view's currency; the filters' Money
  switch `#jfCur` (only with 2+ currencies); account / contract lists of that currency; Today card in the account's currency
  (`M`), its base `acc.dd_base` (MT5) / `s.base`; Settings card `#jnMt5Set` (`[data-mtday]`, `[data-mtblock]` via `stepUp`).
  The header pill `#pJLock` is shorter ("· off" + its tip) so the MT5 top bar stays on one line at 1500 px. jinsights.js:
  `jiCurSeg` (Review `#jiRvCur`, Gemini `#jiAiCur`), `jiCurAccts`, `jiShortMoney(v, cur)`, Gemini's header per currency.
  replay.js: `rsx` in `RP.d.cur`; `rpKeyOf` uses `pid_mt` on MT5 accounts.
- **Tests:** `tests/mt5acct_test.py` (162: the journal part replaces "the journal leaves MT5 out"), `tests/mt5journal_flow.js`
  (35, browser). On re-runs over one data folder, fake_mt5's "history" trades get new tickets each run, so the journal piles
  up copies (the curve's start moves): a fresh folder for a clean read. **Not seen on a real MT5 / FundingPips yet.**
- **v0.39.1, kept candles (8 c1b):** `helper/jcandles.py`. `windows(t, tf)`: 1 / 5 / 15 from opened − 1 day to closed + 1 h; the
  chart's res (`chart_res(tf2)` from jreplay's recorded `chart.tf2`, else 5m) from 1,500 bars before (≤ 30 days; D: 400
  days) to 30 after. Per user a queue + one asyncio worker (`want(urt, key, front)` -> `_kick`; `_nap` waits on an Event so a
  new trade wakes it), `capture()` -> `mt5.fetch_range()` (new in mt5.py: HIST for [from, to), saved into candles.db
  without touching `cover`, **no chart lock**: a chart never waits behind it) -> `u/<uid>/jcandles/<key>.json.gz` +
  `index.json` {s, at, res: {res: [from, to, n]}, err, tries, next}. Offline -> waits RETRY_OFFLINE 15 s; error -> retry
  after 600 s, 5 tries. `backfill()` from `Journal.sync` (MT5 trades closed in the last 120 days, newest first);
  `journal.on_trade` queues a trade at its close (front). `mt5.KEPT = jcandles.rows`: `mt5.history` merges kept candles
  into what it serves and doesn't raise Offline when kept ones exist. View: `kept` per MT5 trade (`status`); page
  `jKept(t)` ("Replay candles"). Backup: `candles/` in the zip; restore adds missing ones. replay.js: the Fyers-login
  check skips MT5 symbols. `Mt5Engine.balance_at` uses deals' `tu` (UTC); `_mt5_redate` recomputes `balance_after` only
  once `M.caught`. Fake terminal: its balance is a few cents off its deals (tests allow 5 cents).
- **v0.40.0, the MT5 day-end close (8 b4):** rules `dayend_on` / `dayend_min` / `dayend_when` (day | weekend) / `dayend_scope`
  (all | marked) in `MT5_RULES` / `MT5_ONLY` (validated in `set_rules`). `Mt5Engine.dayend(t)` -> {at, until, at_ist, today,
  active, min, when, scope, weekday} from the broker clock (next srv midnight − min; weekend = srv Friday); snapshot
  `mt5.dayend`. `dayend_marked(obj)`: scope all, else obj["dayend"] (else the ticket's). Marks: `ticket.dayend` (set_ticket),
  `M.placed[tag].dayend` from `place(req.dayend)`, `pos.dayend` in `_adopt`, `o.dayend` in `_take_orders`; `set_dayend(id, on)`
  (route `/api/mt5acct/dayend`); `pos_view` / `order_view` carry `dayend`. `_dayend_run()` from `housekeeping`: closes
  (`_close(p, "day end")`, retry 20 s x3 via `dayend_try`), CANCELs orders once a day, warns once if `_writable` fails; not
  blocked by `_news_block` (warning). `plan()`: refused in the window when the request is marked; a note before it. Page
  (mt5acct.js): `MT5_RULES` rows, `mtLimitsText` line, `mtDeNow` / `mtDeSet` (ticket save), `mtDeTicket` (`#mtDeBox` in the
  ticket's Entry/Product row), `mtDeChip` (`#tDayEnd` before `#tPlace`, via the toolOverlay wrap), `mtDeBtn` (`.mtde` on
  `#posList` / `#ordList` / `#pgPos`), `ticketBody` wrap (sends `dayend`), the phone: `mTicketBuild` / `mPosSheet` /
  `mOrdSheet` wraps (`.mtde-row`). journal.js: the not-blocking pill is short ("2% · off").
- **v0.41.0, sessions (EA 1.23):** `Sessions(s)` in the EA -> each symbol's `ts` in the LIST body (7 lists, Sunday first,
  [from, to] s from the server's midnight; `to` may be 86400). `mt5._clean_spec` keeps `ts`; `row_from` puts it in `row.mt5`;
  `sync` asks LIST again when a >= 1.23 bridge's specs have no `ts` (`_vt`). `Mt5Engine._sessions(sym)` (the user's specs),
  `dayend_for(sym, t)`: the day's last session end − min (src "session"), to-midnight -> the broker's midnight, no session
  that weekday -> today False, no `ts` -> "midnight"; `_dayend_run` / `plan` use it per symbol; views carry `dayend_at`
  (IST or "not today"); snapshot `dayend.sessions`. Page: footer per-symbol wording; `mtDeBtn` shows `dayend_at`, a
  non-clickable `span.mtde.fixed` with scope "all". Fake: `SESS` / `FX_SESS`, default `--ver 1.23`.
- **Known, not from this release:** on the Live side with an MT5 bridge connected, the feed pill ("Live MT5") plus the data
  budget pill can push the clock onto a second line at 1500 px; `live_flow.js`'s header check then fails when the journal's
  lockout pill isn't showing (it passes when it is). Seen in v0.39.0's runs on data shared with the MT5 tests.
- **Judgement calls made (owner can change):** the lockouts' switch on MT5 starts **off**; the Indian day starts at 06:00 IST
  (the Fyers accounts' reset hour); with the Indian day the 2% base is the day-start balance of the broker day the session
  starts in; Reps count across ₹ and $ accounts (not money).

## ƒx search and the Settings page (v0.35.0, roadmap 18 and 19)

- **ƒx search** (index.html, next to `renderIndPick`): `#indQ` above `#indBody` (outside it, so re-renders keep it).
  `renderIndPick` gives every row `data-q` (name; built-ins name + description) and marks names with `indHl(text, words)`
  (`<mark>`); `indFilter(W)` hides rows / empty sections, adds `.indnone`, picks row 0. `indRows()` = shown rows with
  `[data-add]`, `[data-padd]` or `[data-pedit]`; `indSel(n)` (`IND_SEL`, `.sel`); Enter clicks `[data-add],[data-padd]`
  first, else `[data-pedit]` (libraries). `indOpen(focus)` (ƒx and the "/" key in the page's keydown handler; focuses the
  box except on the phone unless asked).
- **Settings page** (`web/settings.js`, after mt5.js; CSS in index.html under `#drawer` and in mobile.css): still
  `#drawer` / `.open` / `openDrawer()` / `#bClose`, so nothing that opens or tests it changed. `setBuild()` turns `.db`'s
  children into `#setNav` + `#setBody > .scard` sections (an `<h3>` starts one; a `<div>` whose first child is an `<h3>`,
  i.e. `#tgSec`, `#mt5Sec`, `#usersSec`, is one, so its `hide` hides its list entry: `setNav()` rebuilds on class changes).
  `setGo(id)` jumps (instantly; `.db` is `position: relative` so `offsetTop` is inside it), `setSpy()` marks on scroll.
  A MutationObserver on `#drawer`'s class runs `setOpened` (hash `#settings`, remembers the previous hash) / `setClosed`
  (`#bSettings`'s onclick holds the original `openDrawer`, so wrapping it wasn't enough). Esc closes unless typing in a
  filled field of the page or a dialog is up. `pagesStart` is wrapped: a load on `#settings` opens it.
  `#setBody::after` (55vh) lets the last sections reach the top. Desktop: `#drawer` starts under the app's header
  (`--sethdr`, `setTop()` on open / resize), and a `pgShow(name)` without `fromHash` (a click in `#nav`) closes it; the
  page's keydown handler ignores keys while it's open; `showGate` and `#bLogout` close it.
- **The version** (roadmap 20): `refreshState()` fills `#verTop` (a `<small>` in `.brand`), `#verSet` (Settings' header) and
  `#mVer` (top of the phone's More, also set when More renders).

## MT5 bridge: MT5 prices and charts (v0.34.0, roadmap 8 stage a)

- **The EA:** `mt5/FTM_Bridge.mq5` 1.00, walk-through in `mt5/README.md` (the owner's proof of ownership for FundingPips:
  keep every version in Git; he compiles it himself). **Never compiled here** (no MetaEditor in the build environment):
  the owner compiles and reports errors. Places no orders. Calls out only, with WebRequest (as described to FundingPips
  on 8 Nov; their AI support's reply of 10 Nov: own EA allowed, the rule is the account connection: MT5 on the home
  connection, no VPN / VPS, the server never logs in). **Keep it that way**: anything that connects in to the laptop, or
  the server logging in to the broker, must be put to the owner (and FundingPips) first.
- **Protocol** (EA -> server, header `X-FTM-Key`, no cookie):
  - `POST /api/mt5/sync` every `POLL_MS` (250): `{v, ea, build, srv: TimeTradeServer, gmt: TimeGMT, acct: {login, server,
    company, name, currency, balance, equity, margin, free, leverage, mode: hedge|netting|exchange, trade_allowed,
    ea_allowed, demo}, ticks: [[name, time_msc (server time), bid, ask, last, today's D1 tick volume], ...]}`.
    Answer: text lines `OK <ms>`, `SUB a,b,c` (the full list each time; the EA keeps per-symbol last msc), `HIST <id>
    <name> <tf: minutes|D> <from> <to>` (server time), `LIST`, `ERR <msg>`.
  - `POST /api/mt5/bars` `{id, sym, bars: [[t_srv, o, h, l, c, tick_vol]], done, err}` (parts of 20,000).
  - `POST /api/mt5/symbols` `{part, parts, symbols: [{name, desc, path, digits, point, tick_size, tick_value, contract,
    vmin, vstep, vmax, cprofit, cmargin, cbase, trade_mode, calc_mode, swap_mode, swap_long, swap_short, stops_level,
    freeze_level, spread, visible}]}` (parts of 300; the last part replaces the list).
- **Server, `helper/mt5.py`:**
  - **Key:** `new_key` (`ftm-` + 24 random bytes) / `revoke`; `u/<uid>/mt5.json` keeps `key` (sha256), `key_made`,
    `price_login`, `clock` (us|fixed), `offset`, `bridges` (last account info per login, saved at most every 60 s).
    `_index` sha -> uid (rebuilt on change). `uid_for` counts wrong keys per IP (30 in 10 min: `blocked`).
  - **Per user `UserMT5`:** `bridges` {login: Bridge (info, seen, ip, ea, offset, q of command lines, hist futures)},
    `specs` (the symbol list, `u/<uid>/mt5_symbols.json`). `price_bridge()` = the ticked login while online (`ONLINE_SEC`
    8), else the most recently seen online one. Only the price bridge gets `SUB` / `HIST` / `LIST`; others get `SUB` empty.
  - **Ticks:** `sync()` publishes `{s: "MT5:<name>", ltp: bid, bid, ask, t: msc/1000 - offset (UTC), vol, src: "mt5"}` to
    the user's `Feed`. `SUB` = MT5 symbols in `feed.wanted()`.
  - **Clock:** offset = round((srv - gmt) / 1800) * 1800. `Clock.to_utc / to_srv`: mode "us" (offset moves with US DST:
    winter offset = now's offset minus 1 h in US summer) or "fixed". `day_ist()` = the broker's midnight in IST minutes;
    rows carry `sess` "HHMM-HHMM" from it. Changing the mode deletes MT5 candles (`_clear_candles`).
  - **Candles:** `history(uid, folder, symbol, res, days)`: the user's `candles.db` (same tables as Fyers' candles; `cover`
    `first_day` holds an epoch string for MT5). No cover: fetch [want, now]; want earlier than first: fetch [want, first];
    older than `FRESH_SEC` (15): fetch [last - 3 bars, now]. `_fetch` queues a HIST line and awaits the EA's bars
    (`HIST_TIMEOUT` 45 s). Offline: saved candles serve; none saved -> `Offline` (HTTP 409). **Daily candles are stamped
    00:00 IST of the broker's date** (`t_srv // 86400 * 86400 - 19800`), so US summer time never moves them; intraday
    candles are real UTC times. "45" = `agg45` of "15" from the broker's midnight. `STORE_V` ("1") in `meta.mt5_v`: a
    change drops MT5 candles once (`_store_check`).
  - **Symbols:** `row_from(spec)`: Fyers' row shape (`f` "CFD", `x` / `g` "MT5", lot 1, `mult` contract size, `tick` tick
    size, `mt5` {digits, point, tick_value, vmin, vstep, vmax, currencies, calc_mode, swaps, path, spread}). `row(uid,
    ticker)`; `row(None, ticker)` (any user: `symbols.EXTRA`, set in app.py, so `symbols.get("MT5:...")` works).
    `search(uid, q)`: name / desc / path; exact, then Market Watch (`visible`) first.
  - `status(uid, url)` (Settings), `brief(uid)` (the pill: `feed.status()["mt5"]` via `feed.mt5`), `settings()`.
- **Routes (app.py):** EA: `/api/mt5/sync` (PlainText), `/api/mt5/bars`, `/api/mt5/symbols` (`_mt5_uid`: key -> uid,
  disabled users refused; size limits 4 / 30 / 20 MB). Page: `GET /api/mt5`, `GET /api/mt5/ea` (the .mq5), `POST
  /api/mt5/key` (step-up; audit `mt5_key_new` / `mt5_key_revoked`), `POST /api/mt5/settings`. `/api/history` sends MT5
  symbols to `mt5.history`; `/api/symbols` puts up to 10 MT5 hits first (filter `ex=MT5` or `kind=CFD`: only MT5);
  `/api/symbol` uses `mt5.row(uid, s)`; `/api/measure` refuses MT5 ("points only").
- **Kept from Fyers:** `Feed.fy_wanted()` (everything but `MT5:`) is what Fyers' socket and quote polls get;
  `set_depth` drops MT5; `publish` doesn't count MT5 ticks for `last_tick_at` (Fyers' silence check). `Paper.row()` refuses
  MT5 symbols (stage a), so preview / place / the ticket refuse them.
- **Page:**
  - `index.html`: `isMT5(s)`, `curMT5()`, `chartFeedOk()` (charts load without a Fyers login on MT5), `chartDay(ts)` (the
    broker's date on MT5: `floor((ts - sessStart*60) / 86400)`). `bucket()` uses it (intraday from the broker's midnight;
    D / W / M by the broker's date, stamped 00:00 IST); `sessRange()` = [start, start + 1440] and `sessMinutes()` 1380 on
    MT5; `mktClosedNow()` / the candle timer use `chartDay`; `liveBar` skips the pre-open rule; `dataCheck` off; `onTick`
    leaves `#pFeed` alone for `src: "mt5"`; `symLabel` strips `MT5:`; Find rows say "MT5 · <desc>"; the `MT5` button in
    `#exf`; `#pMt5` (a `<b>` inside `#pFeed`, after `.txt`; `setDot` now writes `.txt` when there is one); `#mt5Sec` /
    `#mt5Box` in the drawer. The header has no room for another pill at 1500 px (it already wraps below ~1440 px).
  - `web/mt5.js` (after tgalerts.js): `mtRender()` (Settings › MT5 bridge, wraps `secRender`), `mtKeyShow`, `mtPill(fd)`
    (shown only while the chart or the watchlist has an MT5 symbol; wraps `feedPill` and `openSymbol` on DOMContentLoaded,
    as `renderBook`: "No order book for MT5 symbols", and `paperOnSymbol`: the ticket's hint), `mtPhoneWarn()` (used by
    mobile.js's `mWarnings`).
  - **The EA's delivery rules:** ticks are committed (`g_lastMsc`) only after a 200; the server drops ticks at or below the
    previous call's last msc per symbol (`Bridge.last_msc`); after `CATCHUP_MS` (60 s) without an answered call, each
    symbol restarts from `SymbolInfoTick`; HIST waits `HIST_WAIT_MS` (37 s) for history, ERR_HISTORY_NOT_FOUND on a synced
    series = an empty finished answer; a failed older-range fetch leaves the saved candles serving.
- **Known limits:** custom (built) timeframes and 45m candles from before the last US clock change are aligned an hour off
  the current broker midnight (MT5's own native candles are right); weekends show as gaps like Fyers' nights.
- **Tests:** `tests/fake_mt5.py` (the EA's protocol; GMT+2/+3; `bars()` = CopyRates with open times in [from, to]),
  `tests/mt5_test.py` (in-process, 52), `tests/mt5_flow.js` (browser, 44; makes a key through the page, starts
  fake_mt5.py). `mock_server.py`'s Fyers stream uses `fy_wanted()`.
- **Stage b:** slice b1 shipped in v0.36.0 (next section); the agreed design for b2 / b3 is in the roadmap's item 8 (b).
  FundingPips (10 Nov): no hedging even in Hedge mode; his 21182752 is Phase 1 of the 2-Step; news: ForexFactory (owner).

## Next job

**v0.43.0 (12 Nov), strategies (roadmap 23 a):** the owner writes a `strategy()` script in the Pine Editor, makes a strategy
on the ⚡ page, runs the tester, then switches it on for a paper account for a day on real prices. Live / MT5 only after
item 1's first manual Live trade and FundingPips' written OK. **Next build: 23 (b), the no-code builder** (the alert
conditions as long entry / short entry / exit), then (c).

**v0.42.0 (12 Nov):** the owner picks his units (Chart settings › P&L shown as, or U / a click on a figure) and checks one
MT5 trade's SL / TP labels against its $ figures (e.g. SL −1.00R · −0.48% on a $5,000 account with 1R = $24.02).

**v0.41.0 (12 Nov):** the owner compiles FTM Bridge 1.23 and restarts it; within ~2 minutes each MT5 trade's ⏱ shows its
symbol's own close time; check one against the symbol's Specification › Sessions in MT5.

**v0.40.0 (12 Nov):** the owner sets the day-end close on his MT5 account (Account › rules) and watches the first one at
03:25 IST (or 02:25 in US summer time): the trades it covers close with reason "day end"; the Log says so.

**v0.39.1 (12 Nov):** after the update, an MT5 trade's card should say "Replay candles: kept on the server" within a minute
or two of the server seeing MT5 (older ones fill in the background); ▶ On chart works with MT5 closed. Tell me what the
card says for a trade from 2-3 months ago (how far FundingPips' MT5 goes back in 1-minute candles).

**v0.39.0 (11 Nov), MT5 trades in the journal (8 c1):** the owner updates the server and opens the Journal on the MT5 side:
his FundingPips demo's trades (the last 90 days of MT5's history, and anything open) should be there in $, with the MT5
badge, and ₹ Fyers | $ MT5 in the filters. Then Journal › Settings › MT5 accounts: pick the session day, and turn the
lockouts on if he wants them to refuse MT5 orders (2FA). Check the Today card's 2% room against FundingPips' dashboard
(its base is the day-start balance). Next for the journal: 8 c2 / 4b, only with the owner's yes.

**v0.38.0 (11 Nov), alerts:** the owner updates the server, then: (1) the Alerts page shows no "Node.js isn't installed"
warning (if it does: `journalctl -u fyers-update -n 50` shows why install.sh's Node step failed; `/opt/ftm-node/bin/node
--version` should say v22.12.0); (2) Alerts › Notifications › Turn on for this device on his phone (Android: install the
app first; iPhone: Add to Home Screen first) and Send a test; (3) one price alert and one RSI alert in market hours.
Not built: email (asked in roadmap 21). v0.38.1: the Alerts page's Server load shows memory / CPU; the owner may set the
calculations limit there (automatic = 35% of the droplet's memory).

**v0.37.4 (11 Nov):** the owner checks his Chandelier Exit on XAUUSD against TradingView after the update: no diagonals
between the stops, only the current direction's stop on the price scale.

**Roadmap 8 stage b is complete in v0.37.0** (b1 v0.36.0: the owner compiled 1.10 and it connected, 10 Nov 23:34). Next,
the owner:
1. **Updates the server**, downloads FTM_Bridge.mq5 **1.20** (Settings › MT5 bridge), compiles it over 1.10 and checks the
   chart's corner (version 1.20, "Places the orders you place in the app").
2. On the MT5 side (FundingPips demo): Account page - the floors vs the dashboard, the commission learned, **High-impact news**
   listed (if it says "Not read yet" / an error, ForexFactory's feed couldn't be reached from the server: send the error).
3. Places a small XAUUSD order from the chart tool (MT5 PLACE): it should be in MT5 with its SL / TP and show as the app's
   trade; then a SELL XAUUSD is refused (no hedging); a limit order; BE / TRAIL; KILL and Resume.
4. Optional: with a trade trailing, pull the laptop's network for a minute and watch the EA's corner ("CAN'T REACH THE APP:
   trailing") and the stop move in MT5; plug it back: the app says "the EA trailed the stop".
**Not seen on a real MT5 yet:** 1.20 compiling; FundingPips-SIM1 accepting SL / TP in a market request (if not, the app
sends them right after with MOD - the position shows "→ moving to"); OrderCalcMargin's figures; the filling mode of pending
orders; ForexFactory's real feed from the server; the offline trailing on a real disconnect. Then: (c) the prop journal
(needs the owner's yes to 4b), (d) copy trades (later).

**Seen again in v0.37.0's test run (00:35 IST):** the journal's "Copy for Gemini › today" after midnight: the roadmap's
Small follow-ups already has it ("Copy for Gemini after midnight"), waiting for the owner's word.

**Roadmap 8 stage a shipped in v0.34.0**: the owner compiled 1.00 and saw XAUUSD on the app (10 Nov, 21:45).

**Roadmap 16 shipped in v0.33.0** (the Live account is the Fyers account). Next, the owner:
- **Updates the server** and switches a page to LIVE (top left): the Account page's Live card should show his real Fyers
  funds (start of the day, available, each ledger), and every position, order and holding already in his Fyers account
  should appear, marked From Fyers / Holding, with NO STOP where there's none.
- **Answers roadmap 16's two judgement calls** (holdings kept by Close all / the kill switch; money moved in or out moving
  the account size).
- **Makes item 1's first real trade on it** (below).

0a. Roadmap 15 (v0.32.0): the owner tries the RR lock and the entry line's R boxes on real Fyers, and answers the
   unlocked-target question in the roadmap.
0. Roadmap 14 (v0.31.0): the friend's first real server set-up with `docs/New_Server_Guide.md`. Fix whatever it shows.
   On the owner's server, after the update: `cat /etc/fyers/server.conf` should show his address and 134.209.159.171.
1. The owner's first real trade (Monday at the earliest): whitelist 134.209.159.171 (order permission), switch to
   LIVE (top left), 1 lot on MCX; then a trade placed in the Fyers app (NO STOP, Place my stop) and one with its own
   stop placed in Fyers (adopted). Fix whatever that shows (roadmap 16's "to confirm" list).
2. Compare the app's charges with what Fyers deducted (roadmap item 1, last part).
3. v0.30.1 (2 Nov): history asks Fyers for continuous data off (cont_flag=0); the owner checks GOLDPETAL NOV's 30 Oct
   on 15m in the app after the update (should match Fyers' chart with Continuous Futures off: low ~13,700, close ~13,960).
   Order flow: measured and parked (2 Nov, see "Order flow" above). v0.30.0 (2 Nov): roadmap 13, the option chain's
   fixed header and a contract's lists from its row, waiting for the owner's try on real Fyers. Next build: the journal (4) (the owner's order, 1 Nov; item 8, CFD
   prices, is on hold): v0.26.0, v0.27.0 (pictures + Telegram backup) and v0.28.0 (Insights, review, export) shipped: the
   journal is complete. v0.29.0: the trade replay (4c as agreed 1 Nov). Next in the roadmap's order: item 10 (live
   candles), 4b only if the owner says yes. Shipped and waiting for the owner's try: measurement and drawing tools (v0.22.0), layouts
   (v0.23.0), angles (v0.23.1), multi-charts with sync (v0.24.0 / v0.24.1), Telegram alerts (v0.25.0: set up and tested
   by the owner 1 Nov), the journal (v0.26.0), journal pictures + Telegram backup (v0.27.0: the owner turns on the backup
   in Journal › Settings › Pictures with a new private channel).
4. The owner tries the trade replay (v0.29.0) on real trades: ▶ On chart on a Journal trade, ▶ Play; trades from
   before v0.29.0 show his current chart and the stop's path from the account's log. (The phone layout and the order
   bubble: tried by the owner 1 Nov, working.)
5. The owner checks v0.20.0 on real Fyers: Pivot Points and the Chandelier exit on GOLDPETAL 2m, scrolling back,
   and the Style / Visibility tabs on his own scripts.
