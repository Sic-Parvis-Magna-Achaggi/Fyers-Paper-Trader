# Changelog

## v0.43.2 — 12 Nov 2026 — The unit button on the phone

Fixed
- **The unit button on the phone** (owner: "Will this work on mobile too?"). v0.43.1 put it on the chart's position bars,
  which the phone layout doesn't show (it shows each trade as a chip above SELL / BUY), so on the phone it was there but
  hidden. Now, with Chart settings › Unit button on the position bar on, the phone's trade chips start with the same
  button (₹ / $, % or R); a tap switches amount → % of account → R, and the chips, the SL / TP labels and the sheets
  follow. It shows only while a trade is open. v0.43.1's test only checked that the button existed, not that it was visible.

Tests
- `tests/pnl_units_flow.js` (56): the phone's button is visible, a tap switches the unit (the button's label and the chip
  follow), three taps come back to the start. Re-run: `mobile_flow` (61).

## v0.43.1 — 12 Nov 2026 — A unit button on the position bar

Added
- **Chart settings › P&L shown as › Unit button on the position bar** (owner, with a screenshot of an MT5 gold short: "give
  me an option to set the position display button on the trade preview as on or off. If I turn on, I need a button on the
  preview to toggle showing in amount, % of account or R multiple"). Off by default. When on, each trade's bar on the
  chart has a small button after its P&L showing the main unit (₹ / $, %, R); a click switches it: amount → % of account
  → R, the same as U or a click on the P&L (the SL / TP labels, the panel and the Trades page follow). Saved on the server
  (every device, the phone too).

Tests
- `tests/pnl_units_flow.js` (54, was 46): off by default, on in Chart settings, its label, three clicks through the units,
  saved on the server, off again, the phone shows it. Re-run: `rr_lock_flow` (36), `mobile_flow` (61), `mt5acct_flow` (52),
  `routes_check.py`.

## v0.43.0 — 12 Nov 2026 — Strategies that trade by themselves, with a tester (roadmap 23, stage a)

Added
- **Strategies** (roadmap 23 a; owner: "first do strategy for Live, Paper and MT5. The strategy should be able to
  automatically take trades ... a more user friendly interface for giving risk and other rules"). A new page, **⚡** in the
  top bar (the phone: More › Strategies). A strategy = a Pine `strategy()` script from the Pine Editor + your rules:
  - **Signals:** when a bar closes, the script's `strategy.entry` opens a trade, `strategy.close` / `strategy.close_all`
    closes it, an entry the other way reverses it, and `strategy.exit(stop =, limit =)` can give the stop and the target.
    The script runs on the server (the alerts' Pine runner), page open or not, on any chart type.
  - **The rules panel, one screen in plain words** (TradingView's Properties tab isn't used): contracts (up to 10), timeframe,
    chart type, long / short / both; the accounts it trades (Paper, Live, each MT5 account; Live and MT5 ask for a fresh
    2FA code when switched on); size by risk %, an amount or lots; **a stop always** (ATR × n, points, the last swing, a
    line of the script, or the script's own stop, optionally followed as the script moves it, only ever tighter; + ticks);
    target as a net R multiple, the script's, or none; BE at x R and trail from x R (each trade's own settings); limits:
    trades a day, open at once, stop for the day after losing X (₹ / $ or R), trading hours (IST), no new trades X min
    before the square-off / MT5 day-end, skip expiry days; Telegram on each trade.
  - **The same path as a click:** every order goes through the account's own plan() / place(): its rules and guards, the
    journal's lockouts, the kill switch, the square-off, MT5's news guard and no-hedging rule, Fyers' / MT5's rate limits.
    A strategy only touches the trades it opened; switched off or deleted, its open trades stay, with their stops.
  - Trades are tagged **⚡ <strategy>** on the trades panel, the Trades page and the phone; History records carry it; the
    journal gets the strategy's name as a set-up tag. Each card shows today's trades and net per account.
  - **The log:** every signal and what each account did with it (opened, closed, refused and why), live on the page, with
    a pop-up for each trade.
  - **Stop all strategies** on the page. A script error switches the strategy off and says why (and on Telegram).
  - **The tester:** the same script and rules over the saved candles (7 days to a year), fills by the paper rules (market
    at the next bar's open; stops and targets when the bar's range reaches them, a gap at the open, the stop first if
    both in one bar), sized and counted net of every charge with the account's own rates: trades, win rate, net (₹ / $
    and %), expectancy and total R, profit factor, max drawdown, charges, losing streak, the equity curve, by month, the
    trade list, and the signals not taken (and why). From the rules panel (before saving) or each card.
- Routes: `GET /api/strategies`, `GET /api/strategies/log`, `POST /api/strategies/save`, `/action`, `/stop_all`, `/test`.

Changed
- The engines carry a strategy's tag and the trade's own BE / trail from the order to the position and its History record
  (Paper, Live: the order at Fyers, MT5: the OPEN's metadata) (`plan()` takes `strat` and `tr`).
- The Pine runner (helper/pine_node.mjs) records a strategy script's orders bar by bar (not PineTS's fills); every
  `strategy.entry` counts (pyramiding lifted, so a signal after the app's stop closed a trade isn't hidden), and a
  strategy runs from a fixed first bar, so `bar_index` and its state don't shift by one each time a bar closes.
- The top bar: 1 px less padding per item to fit the ⚡ at 1500 px with the MT5 price pill (12 px spare now).

Judgement calls (the owner can change them)
- Bar close only (TradingView's default): the trade goes at market on the first price after the close. Market entries
  only: limit / stop entries (`strategy.entry(limit =)`) are logged, not traded, in this stage.
- Switched on: the history isn't traded; it starts with the next bar that closes.
- The script's inputs are its defaults (change them in the Pine Editor); a strategy keeps its own copy of the script
  ("take the new version" when the Pine Editor's has changed).
- A new strategy starts with: ATR 14 × 2 stop, target 2R, BE at 1R, 3 trades a day, 1 open at once, stop for the day
  after −2R, no new trades 10 min before the close, skip expiry days, 0.5% risk, Telegram on.

Tests
- New `tests/strategies_test.py` (57, Node + two real paper engines): the definition's checks, 2FA for Live / MT5, history
  not traded, a closed bar's entry opening a trade on the switched-on account only (tag, script stop, 3R net, 0.5% risk,
  its own BE), the script's stop followed only tighter, strategy.close, Long only, a reversal, every limit, the kill
  switch, the stop sources, a script error switching it off, the tester (fills, net = sum, charges = the engine's own,
  1R target, 1 trade a day, a broken script), the journal's tag.
- New `tests/strategies_flow.js` (26, browser): the ⚡ (header on one line), the rules panel from a saved script, the
  tester's results, Save and switch on, a real trade from the mock's live prices on a fresh paper account (⚡ on the panel,
  the log, closed by strategy.close on the next bar, History's tag), Live asking for the 2FA code (cancelled: not saved),
  Switch off, the phone.
- `mt5acct_test.py` (205): a strategy's OPEN carries its tag and BE / trail to the MT5 position. `live_test.py`: the same
  for an order at the fake Fyers.
- Re-run: `chartalerts_test` (74), `rr_lock_flow` (36), `mobile_flow` (61), `live_flow` (60), `journal_flow` (43),
  `mt5acct_flow` (52), `mt5_flow` (44), `chartalerts_flow` (53), `pine_compat_flow` (271), `routes_check.py`.
- **Not tested on real Fyers / MT5:** a strategy trading the Live account or an MT5 account for real (the order paths are
  the ones already used by a click, checked against the fakes), and a full trading day of a strategy on real prices.

## v0.42.1 — 12 Nov 2026 — Roadmap: strategies that trade by themselves, and six more

Changed
- **Roadmap only, no code changed.** Items 23-29 added (owner: "All your ideas are great. Add it to the roadmap"):
  23 strategies that trade by themselves on Paper, Live and MT5, with a strategy tester (next: "We should first do
  strategy for Live, Paper and MT5"), 24 server backup, 25 practice replay on any date, 26 screener, 27 option Greeks /
  IV / payoff chart, 28 tax report for Live trades, 29 Indian event calendar on the chart. Item 23's proposed design (the
  owner's answers: signals from a no-code builder and Pine strategy() scripts; exits by the app and the script; all three
  account types at once) is in the roadmap.
- Item 10 (candles recorded from the live feed) kept for after 23-29.

## v0.42.0 — 12 Nov 2026 — P&L, SL and TP as an amount, a % of the account or R

Added
- **Money shown as an amount, a % of the account size or an R multiple** (roadmap 22; owner: "options to show this as:
  1. Amount 2. Percentage of account 3. R multiple", with a screenshot of an MT5 gold short). A **main** unit and a
  **second** one next to it, e.g. on that short (1R = $24.02 net): **SL −1.00R · −$24.02**, **TP +3.81R · +$91.42**,
  the position bar **+0.38R +$9.06**. Every figure is still net of all charges; only how it's written changes.
  - **% of account** = of the account size (the paper account's size, the Live account's size from Fyers, the MT5 account's
    starting size: FundingPips' % rules count from it).
  - **R** = of the trade's net risk at its first stop (as the R already shown). A stop trailed past break-even shows the R it
    locks in ("SL +0.50R"). A pending order's 1R is what its own stop would lose (its SL shows −1.00R).
  - **Where:** the position bar on the entry line, the SL / TP lines' labels on the price scale and the zones' labels, the
    new-trade tool's zones (SL −1.00R, TP at the tool's net RR) and its PLACE box (the main unit only, one line), the
    trades panel (each trade, its SL / TP, the Open P&L), pending orders, the Trades page (its P&L columns follow the two
    units; the Open P&L card), the MT5 Account page's Open P&L, and the phone (position chips, the position sheet, the
    order sheet, the Trade tab, the order bubble: main unit only).
  - **Switching:** Chart settings › **P&L shown as** (Main, Second: Amount / % of account / R multiple / None), saved on the
    server per user (any device); **U** on the chart or the Trades page; a **click** on a P&L figure (the position bar, the
    zones' labels, the panel, the Open P&L, the Trades page's headers; a tap on the phone's position sheet) cycles the main
    unit Amount → % → R. A toast says what's shown.
  - The open total in R is the sum of each trade's R (as the journal adds R); if a trade has no stop (no 1R), the total shows
    the amount. A unit that can't be worked out (no stop for R) falls back to the amount.

Changed
- Default: Amount · R, so the position bar reads as before (the amount, then the R dimmed); the SL / TP labels now carry the
  R after the amount ("SL −₹1,267 · −1.00R"). Set Second to None for the old labels.
- The trades panel's R moved from the grey line under the P&L to the P&L itself ("−₹367.04 · −0.29R").

Tests
- New `tests/pnl_units_flow.js` (46, browser): the default; a CRUDEOIL trade's bar, SL / TP labels, zones, panel and Open
  P&L in each unit with worked numbers (% of ₹10,00,000, R of the net 1R); U twice; a click on the bar and on a zone's
  label; Chart settings (None, the same unit twice shown once); the tool's −1.00R / net RR; a pending order's −1.00R; the
  Trades page and U there; saved on the server (a reload); the phone (chip, sheet, a tap cycles, the Trade tab).
- Re-run: `rr_lock_flow` (36), `mobile_flow` (61), `mt5acct_flow` (52; its PLACE check failed once on timing, the tool's
  market entry moving between the read and the click, then passed), `mt5dayend_flow` (19), `drawings_flow` (78),
  `live_flow` (60), `pine_compat_flow` (271), `routes_check.py`.
- **Not tested on the real MT5 / Fyers feed:** the figures come from the same net values as before, so only the
  writing changed; check one MT5 trade's labels against its $ figures after the update.

## v0.41.0 — 12 Nov 2026 — MT5 day-end close by each symbol's own trading hours (EA 1.23)

Changed
- **The day-end close times each trade by its own symbol's trading hours** (owner: "Can't you get it from the MT5 symbols?"
  — "ok"). FTM Bridge **1.23** sends each symbol's trading sessions with the symbol list (MT5's SymbolInfoSessionTrade: the
  "Sessions" in its Specification window). The close is then X minutes before that symbol stops trading that day: gold
  that stops at 23:57 broker time closes at 23:52 (5 min), an index with a break that stops at 23:55 at 23:50, Friday's
  early closes from the Friday sessions, and a symbol that trades to the broker's midnight at the broker's midnight. A day a
  symbol doesn't trade: nothing to close. New orders on it are refused from its close until the broker's new day.
- Until EA 1.23 is installed (or for a symbol MT5 lists no sessions for), the broker's midnight, as in v0.40.0.
- When a 1.23 terminal connects, the app asks for the symbol list again at once (not after 12 hours), so the sessions arrive.
- Each trade's ⏱ shows its own close time ("⏱ closes at 03:22 IST"), also with "all trades" (then just shown, nothing to
  choose); the panel's footer says "5 min before each symbol's trading ends (its sessions in MT5; 03:25 IST at the latest)".
- The Log says which end it used: "… 5 min before its trading ends at 03:27 IST".

**EA 1.23 must be compiled:** Settings › MT5 bridge › download FTM_Bridge.mq5, open it in MetaEditor, Compile (F7), and
restart it on the chart (the corner says 1.23). It only adds the sessions to the symbol list; nothing else changes.

Limit: holidays and one-off early closes count only if FundingPips changes the symbol's sessions in MT5 for them (brokers
often don't); on such a day the usual schedule is used.

Tests
- `tests/mt5acct_test.py` (204): EA 1.23's list carries the sessions; on a Wednesday gold (to 23:57) closes at 23:52, the
  index (last session to 23:55) at 23:50, forex (to midnight) at 23:55; at 23:53 gold's close has run and forex's not; Friday's
  early close (23:45 -> 23:40); a day the symbol doesn't trade (nothing); no sessions (an older EA): the broker's midnight.
- `tests/fake_mt5.py` plays EA 1.23 by default (sessions: gold Mon-Fri 01:01-23:57 / Fri 23:45, the index 01:05-23:15 and
  23:30-23:55, forex to midnight / Fri 23:50).
- `tests/mt5dayend_flow.js` (19): the footer with sessions known; a gold trade's ⏱ at gold's own close (23:57 − 7 min);
  "all trades" showing each trade's time. `mt5_flow` (44, twice), `mt5acct_flow` (52), `mt5_test` (52), `routes_check.py`.
- **Not tested on a real MT5:** EA 1.23 compiling, and what FundingPips' sessions really are (compare a trade's ⏱ with the
  symbol's Specification window).

## v0.40.0 — 12 Nov 2026 — MT5: the day-end close

Added
- **The day-end close for MT5 accounts** (roadmap 8 b4; owner: "X minutes before the broker's day ends", "Everyday / Only
  before the weekend", "choose trades or set everything to close as intraday"). Account › rules of each MT5 account:
  - **Day-end close** on / off (off at first);
  - **Minutes before the broker's day ends** (1-240, default 5): the broker's midnight, FundingPips 03:30 IST in winter and
    02:30 in US summer time, so 5 minutes = 03:25 / 02:25 IST;
  - **When:** every day, or only before the weekend (the broker's Friday);
  - **Which trades:** all of them, or only the trades marked to close.
  At that time the trades it covers are closed at market in MT5 (reason "day end" in History and the journal), their
  pending orders cancelled, and new orders it would cover are refused until the broker's new day.
- **Marking trades** (with "only trades marked to close"): the ticket's **At the day end: Close it / Hold** and the chart
  tool's **DAY END / HOLD** next to PLACE mark the order; the choice stays the default for later orders, and trades placed in
  MT5 itself take it too. **⏱** on each trade and pending order (the panel, the Trades page) changes its own: "closes at
  03:25 IST" / "held over the day end". On the phone: the order sheet's and each trade's / order's sheet's **At the day end**.
- The panel's footer says when it runs ("Day-end close 03:25 IST (5 min before the broker's day ends; all trades)"), and
  "done for today" after it ran. The ticket's preview notes "closed at the day end, 03:25 IST".
- MT5 not connected at that time: a warning in the Log; the trades keep their SL / TP at MT5 and are closed when MT5 is back
  before the broker's midnight. A close MT5 refuses is asked again (20 s apart, 3 times).
- Route `POST /api/mt5acct/dayend` ({id, on}).

Changed
- The header's journal lockout pill, when it isn't blocking, is shorter ("2% · off"; the reason in its tip): with an MT5
  account's lockout showing, the MT5 top bar went onto two lines at 1500 px.

Judgement calls (the owner can change them)
- Off at first; trades are **Hold** by default (the ticket's switch), so nothing closes until you set it.
- The day-end close is **not stopped by the news guard** (like the kill switch): on a Master account inside a news window it
  still closes, with a warning in the Log (FundingPips deducts profits of trades closed inside the window).
- It runs at the broker's midnight minus the minutes, for every symbol: a symbol whose own session ends earlier (some
  indices, Friday's early closes) needs more minutes.

The Fyers side is unchanged: its intraday square-off (5 minutes, settable, before Fyers' own times) was already there.

Tests
- `tests/mt5acct_test.py` (195): refusals of bad settings; the time (5 min before the broker's midnight, in IST); only on the
  broker's Friday with "only before the weekend"; at the time: the trade closed in MT5 (reason day end), the pending order
  cancelled, new orders refused; marked trades only: a Hold order allowed, a day-end one refused, a Hold trade kept, then
  marked and closed; the ticket's mark taken by a trade placed in MT5; MT5 off at the time (a warning, nothing sent) and
  back (closed then); off again.
- New `tests/mt5dayend_flow.js` (19, browser, fake MT5): the four rules on the Account page; the footer; the ticket's switch
  and the tool's DAY END / HOLD (saved, in the preview); a trade from MT5 taking the default; ⏱ on its line and the Trades
  page; "all trades" (fixed on Close, no ⏱); the phone's trade sheet; off again.
- On fresh test data: `security_flow` (29), `live_flow` (60), `mt5acct_flow` (52), `mt5journal_flow` (39), `mt5dayend_flow`
  (19); also `journal_flow` (43), `mobile_flow` (61), `mt5_test` (52), `journal_test` (58), `squareoff_test`,
  `routes_check.py`.
- **Not tested on a real MT5 / FundingPips:** the close at the real broker midnight (the timing is checked with a controlled
  clock against the fake terminal's GMT+2 / GMT+3 broker clock).

## v0.39.1 — 12 Nov 2026 — Each MT5 trade's candles kept for its replay

Added
- **Each MT5 trade's candles are kept on the server for its replay** (roadmap 8 c1b; owner: "yes", after asking what the
  replay of MT5 trades uses and how long to keep it). MT5 keeps only so much history (about 100,000 bars by default: 2-3
  months of 1-minute candles) and may be off when you open a replay. So when an MT5 trade closes, the server asks MT5 for
  the candles around it and keeps them with the journal, for as long as the trade is in the journal:
  - 1-, 5- and 15-minute candles from a day before the entry to an hour after the exit (what ▶ Play builds its forming
    candles from);
  - the chart the trade was placed from (its recorded timeframe, else 5 minutes): 1,500 candles before the entry for the
    indicators' warm-up (at most 30 days back; daily charts 400 days), to 30 after the exit.
  About 50-100 KB a trade. Trades from MT5's own history (closed in the last 120 days) are fetched the same way in the
  background, newest first, one at a time. Nothing is fetched while MT5 is off: it waits and carries on when MT5 is back.
- **Charts and the replay use the kept candles** wherever the saved ones lack them: the replay of an MT5 trade works with
  MT5 off, after MT5's own history has moved past it, and after the MT5 candles were cleared (a change of the broker's
  clock setting).
- Each MT5 trade's card says **Replay candles: kept on the server** (1m / 5m / 15m / the chart's timeframe, how many),
  or that it's waiting for MT5.
- The journal's **backup** holds the kept candles; **restore** puts back any that are missing.

Fixed
- **The replay of an MT5 trade said "Log in to Fyers to load the replay's candles"** when Fyers wasn't logged in: an MT5
  trade's candles come from MT5 or the server, not Fyers.
- The $ balance curve: the balance after a trade from MT5's history is worked out only once all of MT5's deals have
  arrived (it could be worked out from part of them and then stay wrong), and from the deals' own times (UTC).

Normal chart candles are unchanged: kept on the server, never deleted.

Tests
- `tests/mt5acct_test.py` (173): a closed trade's 1m / 5m / 15m and chart candles fetched and kept (windows, warm-up);
  the page told what's kept; MT5's history trades kept in the background; MT5 off with the saved MT5 candles cleared: the
  replay's 1-minute candles still served from what was kept (a symbol with nothing kept still says MT5 isn't connected);
  a trade closing while the fetcher waits to retry others is kept at once; backup and restore of the kept candles.
- `tests/mt5journal_flow.js` (39): the card's kept candles; ▶ On chart of an MT5 trade with MT5 off loads its candles,
  also with Fyers logged out; ▶ Play runs from the kept 1-minute candles. Passed on consecutive runs.
- Re-run: `journal_test` (58), `jreview_test` (25), `replay_test` (42), `jshots_test` (52), `mt5_test` (52),
  `replay_flow` (48), `journal_flow` (43), `mt5_flow` (44), `routes_check.py`.
- **Not tested on a real MT5:** how far back FundingPips' MT5 gives 1-minute candles (its Max bars in chart); trades
  further back than that keep only what MT5 still had (the card says so).

## v0.39.0 — 11 Nov 2026 — MT5 trades in the journal

Added
- **MT5 trades in the Journal** (roadmap 8 c1; owner: "the journal is not recording mt5 trades" — they were left out by design
  until this step). Every trade of every MT5 account arrives on its own, like paper and live ones: placed from the app or in MT5
  itself (marked "placed in MT5"), and MT5's own history (the last 90 days) taken in once. One MT5 position is one journal
  trade, however many parts it closed in (a part, a position booked as an estimate and the late MT5 deal that replaces it).
  The 8 pillars, reps, tags, plan, review, Insights, the weekly Review, Copy for Gemini, CSV and ▶ On chart all work for them.
- **Money in $, never added to ₹** (owner: "yes"): MT5 trades are in the account's currency, net of commission and swap. The
  filters have a **Money** switch, **₹ Fyers | $ MT5** (shown once there are MT5 trades): the list, stats, balance curve,
  Insights, Review and Copy for Gemini show one currency at a time; the MT5 side opens the journal in $. The MT5 badge on
  each MT5 trade. A history trade's balance after it is worked out from MT5's deals, so the $ balance curve starts at the
  real balance.
- **The session day per MT5 account** (owner: "can be both"): Journal › Settings › MT5 accounts: the broker's day (FundingPips'
  daily reset; the default) or the Indian day (IST, from 06:00 like the Fyers accounts). Changing it moves the trades to their
  new sessions.
- **The 2% line of FundingPips' day-start balance** (owner: "day's starting balance from Fundingpips"): the balance at the
  broker's midnight, from MT5's own deals (with the Indian day: of the broker day the session starts in). The Today card
  shows the room before it in $.
- **The lockouts on an MT5 account are a switch** (owner: "Keep it as an option with 2FA"): Journal › Settings › MT5 accounts
  › Lockouts refuse new orders on this account, **off at first**; turning it on or off asks for a fresh 2FA code and goes in
  the security log. On: the 2% line, the 99 Club break and session over refuse new MT5 orders (each with its own switch);
  closing, BE, trailing and stops never. Off: shown on the Today card and in the audit only.
- Route `POST /api/journal/mt5` ({acct, day} / {acct, block}).

Changed
- The journal's CSV: a **Currency** column (INR / USD); the money columns are named Gross, Charges, Net, Risk at first stop
  (net), without ₹; Placed in says MT5 for trades placed there.
- The top bar's journal lockout pill is shorter: "2% lockout · off" when it isn't blocking (the reason in its tip), so the MT5
  top bar stays on one line at 1500 px.
- Server pictures and the replay show an MT5 trade's money in $ (the replay's running net, the picture's net / charges).

Tests
- `tests/mt5acct_test.py` (162): "the journal leaves MT5 out" replaced by the journal's MT5 checks: every history trade in
  the journal in USD, nets equal to MT5's, an estimate replaced by MT5's late deal (one trade, not two), open positions with
  MT5's volume, the broker's day and the day-start balance as the base, the Indian day (and back), the lockouts' switch (off:
  shown only; on: refused through the engine's guard, the ticket's lock; the other MT5 account not blocked), a trade from MT5
  arriving open and then closed with MT5's net and R, the balance after each history trade.
- New `tests/mt5journal_flow.js` (35, browser, fake MT5): a trade placed and closed in MT5 reaching the Journal; $ only with
  the MT5 badge; ₹ Fyers | $ MT5; Today; Insights, Review, Copy for Gemini; the session day; the lockouts' switch (2FA; the
  server refuses it without a fresh code from another login; a new MT5 order refused only with it on; the header pill; the
  security log); CSV; the replay's data for an MT5 trade; the phone. Passed on consecutive runs.
- `tests/journal_flow.js` counts the ₹ trades the page shows (MT5 trades in the same test data are in the $ view) and checks
  the shorter "· off" pill; `tests/jreview_test.py` checks the new CSV headers. `routes_check.py` has the new route.
- Re-run: `journal_test` (58), `jreview_test` (25), `replay_test` (42), `jshots_test` (52), `mt5_test` (52), `trail_rr_test`
  (27), `squareoff_test`, `live_account_test`, `routes_check.py`, and the browser flows listed in the release notes.
- **Not tested on a real MT5 / FundingPips** (the fake terminal plays the EA): the owner's real history in the journal and
  the day-start balance against FundingPips' dashboard.

## v0.38.1 — 11 Nov 2026 — Alerts: no limit on how many; 🔔+ on the price scale; 🔔 on drawings

Changed
- **No limit on the number of alerts** (owner: "Why can't we have unlimited?"). The 400 alerts, 100 technical and 15
  watchlist alerts per user are gone. A price alert against a number costs one comparison per price update, so there's
  no reason to cap it.
- **The one limit left is on calculations**, for the whole server: each distinct symbol + timeframe + chart type + script
  (or built-in indicator) with its settings runs once in Node, and every alert that uses it shares it (50 alerts on RSI 14
  of NIFTY 5m = 1 calculation). Measured: about 4 MB and a little CPU each (200 = 820 MB, and one CPU core to keep them
  all live). The limit is automatic, 35% of the server's memory at 5 MB each (1 GB: 71, 2 GB: 143, 4 GB: 286), or what
  the admin types. A new alert or a resume that would pass it is refused, saying how many it needs and how to make room.
- Node's memory ceiling follows the server's memory (half of it, 512 MB to 4 GB) instead of a fixed 768 MB.

Added
- **Server load** on the Alerts page: calculations of the limit (with a bar), Node's memory, the CPU the alerts' Pine used
  in the last minute, the server's free memory; refreshed every 15 s. **Limit…** (the admin): type a number or go back to
  automatic (saved on the server; in the security log).
- **🔔+ on the price scale**, like TradingView's plus: hover over the price scale (tap it on the phone) and a 🔔+ appears at
  that price; its menu has **Alert: price crossing <price>** (created at once: crossing, only once, your usual
  notifications, its 🔔 line on the chart to drag) and **Alert at <price>…** (the dialog). It shows only over the scale
  itself, never over the position bars next to it.
- **The right-click menu on the chart** offers the same two.
- **🔔 on a selected drawing's bar** (lines, rays, channels, rectangles): adds an alert on it; with alerts already on it,
  it's gold with their number, and a click lists them to edit (or add another). The drawing's right-click menu lists them
  too (✎ Alert: …).

Tests
- `tests/chartalerts_test.py` (74): 450 price alerts with no limit; two alerts sharing one calculation; a third refused at
  a limit of 2 (pausing one makes room; a resume past it refused; an edit doesn't count itself twice); the automatic limit.
- `tests/chartalerts_flow.js` (53): the 🔔+ on hovering the price scale (not inside the chart beside it), its one-click
  alert and line, the phone's tap on the scale; a drawing's bar 🔔 with its count, editing its alert from there and from the
  right-click menu; the Server load strip and the admin's limit (a number, then automatic).
- Re-run: `drawings_flow` (78), `rr_lock_flow` (36), `mobile_flow` (61), `multichart_flow` (43), `live_flow` (60),
  `mt5_flow` (44), `legend_flow` (12), `layouts_flow` (31), `settings_search_flow` (34), `pine_compat_flow` (271),
  `routes_check.py`: pass. (`pine_compat_flow` first failed 13 P&F checks after several runs of the alerts flow: its test
  price jumps had left the fake CRUDEOIL price far from the fake candles; the alerts flow now puts the price back when it
  ends, and the two pass back to back.)

## v0.38.0 — 11 Nov 2026 — Alerts like TradingView's: price, technical, multi-condition, watchlist, on your phone

Added
- **Alerts that run on the server** (roadmap 21), page open or not, for every user: up to 400 each (100 technical at once),
  no plan to buy. 🔔 on the chart's top bar or **Alt+A**, **right-click** on the chart (*Add alert at* that price), a
  drawing's menu (**🔔 Add alert…**), the 🔔 on a script's row in ƒx, or **+ Create alert** on the new **Alerts** page
  (🔔 in the top bar, with the number active).
- **What an alert watches:** the price (last, bid or ask; every tick, a trade through the level between updates counted
  through the day's high / low, as paper fills are); candles (open / high / low / close / hl2 / hlc3 / ohlc4 / volume);
  any plot of your Pine scripts on the chart, their `alertcondition()`s (with their own message) and "any alert() call"
  (the script's `alert.freq_*`); built-in indicators without adding them to the chart (SMA, EMA, WMA, VWAP, RSI, MACD,
  Bollinger, Supertrend, ATR, Stochastic, CCI, ADX / DMI, MFI, OBV, Donchian, Volume average); drawings (horizontal line /
  ray, trend line, ray, extended line, parallel channel, rectangle: move the drawing and the alert follows); P&F buy / sell
  signals on P&F charts. Works on every chart type (Heikin-Ashi, Renko, P&F... bars), with the chart's own Pine engine.
- **TradingView's 13 conditions** (crossing, crossing up / down, greater / less than, entering / exiting / inside /
  outside channel, moving up / down by an amount or %, within N bars) against a value or any other series; **each
  condition on its own timeframe**; **up to 5 conditions**, all (TradingView's) or any.
- **Triggers:** only once, once per bar, once per bar close, once per minute; **expiry** or open-ended.
- **Watchlist alerts:** one alert over a watchlist, each symbol on its own (up to 60 symbols on Fyers' price socket,
  after your charts' and trades'; any that don't fit are listed as not watched).
- **Messages** with TradingView's placeholders (`{{ticker}}`, `{{close}}`, `{{interval}}`, `{{time}}`, `{{plot_0}}`,
  `{{plot("Name")}}`...) plus `{{bid}}`, `{{ask}}`, `{{timenow_ist}}`; plain numbers, so JSON stays valid.
- **Notifications:** a pop-up and a sound (5 sounds) on every open page; **phone and desktop notifications** with the app
  closed (Web Push, encrypted end to end; the app can be installed on the home screen: Android, and iPhone with iOS 16.4+);
  **Telegram** (the bot in Settings › Telegram alerts); a **webhook** (POST, JSON when the message is JSON; public addresses,
  ports 80 / 443 only).
- **The Alerts page:** the list (search, filter, pause / resume / restart, edit, clone, open its chart, delete), the Log of
  what fired, and Notifications (turn on this device, test, devices, how-to for Android / iPhone / desktop).
- **🔔 lines on the chart** at an alert's price levels; drag one to move the alert.
- **The phone:** More › Alerts; the dialog full screen; pop-ups at the top.
- **Server:** `server/install.sh` installs Node.js 22 (pinned, checked against nodejs.org's SHA-256 list) into
  `/opt/ftm-node` for the alerts' Pine runner; if it can't, price alerts still work and the Alerts page says technical
  ones are waiting.

Changed
- `helper/feed.py`: the price socket's list = open trades / orders, then the open pages' symbols, then the alerts'.
- `web/paper.js`: draggable lines include the alerts' (`P.alertDrags`).
- The top bar's page buttons are a little tighter (7 px each side instead of 10), so the 🔔 fits with room to spare.

New files
- `helper/chartalerts.py`, `helper/pine_node.mjs`, `helper/webpush.py`, `web/calerts.js`, `web/calerts.css`, `web/sw.js`,
  `web/manifest.webmanifest`, `web/icons/` (5 icons), `tests/chartalerts_test.py`, `tests/chartalerts_flow.js`.
  Nothing deleted or renamed.

Tests
- `tests/chartalerts_test.py` (67, real Node): every operator, the four triggers (including a crossing that didn't hold to
  the bar's close, and a bar closed by its time with no tick), multi-condition all / any, moving %, built-in RSI, a Pine
  plot, `alertcondition()` and `alert()`, a trend line and a parallel channel (and a moved drawing), Renko bricks,
  watchlists, expiry, refusals, placeholders, a webhook (JSON), phone push (encrypted, then decrypted as a browser does;
  the encryption matches RFC 8291's worked example byte for byte), Telegram (fake bot).
- `tests/chartalerts_flow.js` (40, Chromium on the mock): the dialog from each way in, a price alert firing (pop-up, line,
  triggered), dragging its line, Pine / multi-condition / webhook alerts, once per bar, the Alerts page actions, a
  watchlist alert, the service worker showing a pushed message (Chrome's DevTools push), the manifest, the phone; the top
  bar still on one line at 1500 px. Passed on consecutive runs.
- Every other suite re-run on this code: `settings_search_flow` (34), `drawings_flow` (78), `legend_flow` (12),
  `pine_compat_flow` (271), `multichart_flow` (43), `mobile_flow` (61), `navigation_flow` (41), `indicator_settings_flow`
  (37), `watchlists_flow` (16), `layouts_flow` (31), `rr_lock_flow` (36), `charttypes_flow` (92), `journal_flow` (43),
  `live_flow` (60) and `mt5_flow` (44) (both check the top bar stays on one line: they failed until the page buttons were
  tightened a little; now 88 px spare at 1500 px, 52 before), `jshots_flow` (50), `jinsights_flow` (41), `replay_flow`
  (48, on 2 of 3 runs: the known random-walk timing checks), `github_upload_flow` (25), `routes_check.py`, `ctype_test.js`
  and every Python suite: pass. `telegram_flow` (its watchdog check: no watchdog service on the test machine),
  `mt5acct_flow` (MT5's own history check) and `chain_lists_flow` (the option fixtures' expiries have passed) fail the
  same way on v0.37.4's code. `mt5acct_test` 133 (one check flaky on v0.37.4 too).
- `server/install.sh`'s Node step tested with a local copy of nodejs.org's files (install, a bad checksum refused, a failed
  download skipped); **not run on the droplet**. Phone push **not tested with Google's or Apple's real push services**
  (no internet from the test machine): check it on your phone (Alerts › Notifications › Send a test).

## v0.37.4 — 11 Nov 2026 — Pine: lines with breaks drawn with breaks (Chandelier Exit)

Fixed
- **`plot.style_linebr`, `style_steplinebr` and `style_areabr` now break where the value is na, as on TradingView.** The
  chart joined the last value before an na stretch to the first one after it with a straight line (owner, XAUUSD on MT5:
  everget's Chandelier Exit drew red and green diagonals between its Sell and Buy points). The script's values were always
  right; only the drawing joined them. Fixed for every Pine script and every chart type.
- **A plot coloured `na` on a bar** (e.g. `color = up ? color.orange : na`) now leaves that stretch out instead of joining
  across it.
- **No price label for a plot whose latest value is na** (TradingView's way): the Chandelier's Short Stop no longer showed
  its old level on the price scale while the trade direction is long.

Unchanged
- `plot.style_line` (the default) still joins over na bars, as TradingView does.

Tests
- `tests/pine_compat.js`: the owner's Chandelier Exit script, and a script with line / step / area breaks, a colour of na
  and a plain line. `pine_compat_flow.js` puts both on the chart on every chart type and reads back the series the chart
  was given: no visible segment may cross an na bar (v0.37.3 failed this: 47-48 bridged gaps per stop line), `style_line`
  must still join, no price label while the latest value is na. 271 checks pass; `charttypes_flow.js` (92),
  `legend_flow.js` (12), `mt5_flow.js` (44), `indicator_settings_flow.js` (37; its known "start of history" timing check
  failed 2 of 4 runs, also seen before this change), `ctype_test.js`, `routes_check.py`: pass.

## v0.37.3 — 11 Nov 2026 — MT5: commission from MT5 before the first trade; profit in other currencies checked

Added
- **EA 1.22:** sends each symbol's commission rules from MT5 (SymbolInfoCommissions, new in MT5's July 2026 update: the
  symbol's Specification window, e.g. FundingPips' XAUUSD "5 USD per lot", opening deals), once a minute. Delete the line
  `#define FTM_COMMISSIONS` if MetaEditor doesn't know the function (an older MT5).
- **Commission, in order:** learned from MT5's deals on the symbol; MT5's rules (instant charges; per lot, per deal or a
  percent of the value; the 1-lot tier; a rule for one direction counted for both); as a symbol of the same group that has
  traded (Metals, Forex…); your typed default (empty = not typed, 0 = none). Shown on the ticket and the Account page with
  where it comes from (symbols not traded yet listed too).
- **Profit in another currency:** contract size × the broker's own price of e.g. GBPUSD / USDJPY (as LiveTrader's
  ConvRate), streamed by the account's terminal: checked against MT5's profit sum (the bigger one used if they disagree by
  more than 2%), or used without it.

Changed
- **No more $0 commission or unchecked tick values:** a symbol whose commission isn't known, or whose only figure for a
  price move is MT5's tick value, can't be placed (the ticket says why and what to do). The typed default commission is now
  empty until typed (a 0 saved by the form before isn't taken as typed).

Tests
- `tests/mt5acct_test.py` (133), `mt5acct_flow.js` (52), `mt5_flow.js` (44), `mobile_flow.js` (61), `mt5_test.py` (52), `routes_check.py`: pass. EURGBP never traded: commission from MT5's rules ($7 in, $0 out), a 1.00 move = 100,000 ×
  GBPUSD, checked against MT5's sum; the loss at the stop by hand; without the sum: contract × GBPUSD; only the tick value:
  refused; commission unknown: refused, typed 0 allowed, as GBPUSD when it has traded.
- `tests/fake_mt5.py`: EA 1.22 (commission rules), GBPUSD and EURGBP (profit in pounds). `mt5_test.py` / `mt5_flow.js`: 5
  symbols, EA source 1.22.

## v0.37.2 — 11 Nov 2026 — MT5: dollar figures 100× too small on XAUUSD (fixed)

Fixed
- **MT5 money was 100× too small on the owner's XAUUSD** (reported 11 Nov: a 0.25% risk SELL 0.33 lots at 4,057.76, stop
  4,064.22: the app showed −$3.78 at the stop, MT5 −$217.94). The app valued a price move from MT5's tick value alone, and
  his terminal reported it 100× too small; the size was worked out from the same figure, so the trade was 100× too big for
  its risk. Now the value of a 1.00 move on 1 lot comes, in order, from MT5's own profit on an open position of the symbol
  (learned, saved), EA 1.21's OrderCalcProfit, tick size × contract size (profit currency = the account's), and only then
  MT5's tick value; a tick value that disagrees is flagged in the Log. A symbol with no figure at all can't be placed.
  Sizing, the loss / gain at SL / TP, BE + commission, trailing, R and the guards all follow.

Added
- The ticket's preview on MT5: "1 lot: $100 per 1.00 move · <where from>". The Account page: a table of that figure per
  symbol beside what MT5's tick value says (a mismatch in amber).
- EA **1.21** (optional): sends OrderCalcProfit for 1 lot over a 1.00 move per symbol.

Tests
- `tests/mt5acct_test.py` (123): the preview's risk equals move × 100 oz × lots + commission; with MT5's tick value 100×
  too small: still right from the learned figure, then OrderCalcProfit, then contract size, and the mismatch flagged.
- `tests/mt5acct_flow.js` (52): the preview's risk on 0.03 lot equals MT5's sum and shows "$100 per 1.00 move".
  `tests/fake_mt5.py` reports 1.21 (sends OrderCalcProfit); `mt5_flow.js` checks the EA's source is 1.21.

## v0.37.1 — 11 Nov 2026 — MT5: no login to type; PLACE's first-change prompt fixed

Changed
- MT5 accounts: no login to type before the first change or order on an account (owner, 11 Nov: "I'm the only one trading.
  We don't need so much security"). Every MT5 account can trade as soon as its terminal connects; switching a page to MT5
  still asks for a 2FA code, and the bridge key still has to match.

Fixed
- PLACE as the first change on an MT5 account showed "first change on MT5 account …: type its login" as a red line under the
  button instead of asking (the place route and BE all didn't pass the request on to the page). Moot now the prompt is gone,
  but fixed in case it's ever brought back.
- A terminal that connects after the page loaded now joins the MT5 account switcher within 15 s (before: only after a
  reload); its ● / ○ stays current too.
- Old hints that said placing MT5 orders "comes in the next step" (the paper ticket on an MT5 symbol, the MT5 Account page's
  limits and buffer).

Tests
- `tests/mt5acct_test.py` (116): an MT5 account is ready from the start, the second one too.
- `tests/mt5acct_flow.js` (now 51): no login dialog on the first SL move; a second fake terminal with a new login each run:
  it joins the switcher and PLACE as its very first change goes straight to MT5. `mt5_flow.js` 44, `mobile_flow.js` 61,
  `mt5_test.py` 52, `routes_check.py`: pass.

## v0.37.0 — 11 Nov 2026 — MT5: placing orders from the app, the kill switch, the news guard, the EA trailing when the link drops (FundingPips, stage b complete)

Added
- **Placing orders on MT5 accounts** (roadmap 8 b2; owner, 10 Nov 23:34: "Finish everything"). On the MT5 side the ticket,
  the chart's BUY / SELL tool and PLACE work as on Fyers: market, limit or stop, each sent to MT5 **with its real SL and TP
  from the start**. PLACE says **MT5 PLACE** (purple).
  - **Sizing** as on paper: risk %, risk $ or lots - lots are MT5's volume in 0.01 steps (typed 0.05; ± moves 0.01), within
    the symbol's minimum and maximum volume. Every $ figure (risk, reward, BE) is net of the commission learned from MT5.
    A new MT5 account's ticket starts at 0.5% risk.
  - **Margin from MT5 itself** (its OrderCalcMargin, sent by EA 1.20 for the symbols you trade or chart); free margin is
    MT5's.
  - **The guards** refuse an order with the reason, as on paper: FundingPips' daily and max floors (if every stop were hit),
    the risk cap (lots cut to fit), max open risk, max margin use, max trades a day, SL required.
  - **No hedging** (FundingPips, 10 Nov): an order opposite an open trade, a pending order or an order on its way on the
    same symbol is refused - in this account and in your other MT5 accounts. The same side, or another symbol, is fine.
  - **The order is tied to the app by its tag** (MT5's comment "FTM <tag>"): the trade shows as yours (not "Placed in
    MT5"), with its planned stop as 1R and the trailing it was placed with. On its way it shows on the panel ("Sending to
    MT5…", "MT5 placed #…"). An order is never sent twice; one that couldn't reach MT5 within 10 s is dropped, never placed
    late; MT5's refusal shows with its reason.
  - The first order on an account asks for its login (once), as managing does.
- **The MT5 kill switch** (b3): **KILL** in the top bar on the MT5 side (and on the phone; the Account page too) closes every
  position and cancels every order of that MT5 account at the broker, drops orders still on their way, and pauses new
  orders until **Resume** (a fresh 2FA code). No login, no news window: it's meant to be quick. With MT5 not connected it
  says so (close in MT5 itself) and still pauses new orders.
- **The news guard** (b3; the calendar: **ForexFactory**, owner 10 Nov): the server reads ForexFactory's calendar every hour
  (kept on the server, last week's too). High-impact events on the symbol's currencies (XAUUSD: USD; EURUSD: EUR and USD):
  - **Master phase:** no opening and no closing from the app from 5 minutes before to 5 minutes after (the minutes are
    settable); MT5's own SL / TP still fire inside it (a warning beforehand). The kill switch is never blocked.
  - **Evaluation phase** (your 21182752): no block; a note on the ticket and a warning on open trades in the 15 minutes
    before (purposely trading news is prohibited).
  - The Account page lists the next 24 hours' high-impact events for the account's symbols, with **Read ForexFactory now**.
    The guard has its own switch. FundingPips' dashboard calendar stays the official one.
- **The EA trails by itself if it can't reach the app** (b3): the app sends each trade's Trail BE / Trail SL to the EA
  (TRAIL lines: trigger, BE + costs, start, distance, floor, step); if the EA can't reach the server for 20 s (input
  OfflineTrailSec), it moves MT5's stops itself by the same rules - never looser, never below BE + costs, never backwards,
  2 s apart at most - and reports each move. When the link is back the app takes them as the trail (not as a stop moved by
  hand) and carries on.
- **FTM Bridge 1.20** (`mt5/FTM_Bridge.mq5`, walk-through in `mt5/README.md`): OPEN (Buy / Sell / BuyLimit / SellLimit /
  BuyStop / SellStop with SL / TP and the comment "FTM <tag>"), each symbol's margin for 1 lot (OrderCalcMargin), volume min
  / max and stops level, the TRAIL table and the offline trailing. Still calls out only; it opens nothing on its own. New
  input OfflineTrailSec (20; 0 = never).

Changed
- Settings › MT5 bridge and the MT5 side's dialog say what 1.20 does. An EA 1.10 still manages trades; placing asks for 1.20.
- On the MT5 side the top bar leaves out Fyers' data-budget pill (no room next to KILL; it's still on PAPER / LIVE), and the
  account switcher shows "● 21182752 · $5,069" (server, DEMO and cents in its tip). Fyers' product switch is hidden there.
- The paper engine's sizer goes up to MT5's maximum volume for MT5 symbols (it stopped at 500 steps).

Tests
- `tests/mt5acct_test.py` (now 118): placing (sizing in steps, margin from MT5, minimum volume, hedging in the account and
  across accounts, the OPEN tied back by its tag with its planned 1R, a pending order from the app, MT5's refusal, a lost
  OPEN never re-sent, offline, an order dropped after 10 s, EA 1.10), the kill switch and Resume, the news guard
  (evaluation note / Master block, closing blocked, 30 min away, ForexFactory's JSON parsed), the EA's offline trailing and
  its moves taken as the trail, the table sent again after an EA restart.
- `tests/mt5acct_flow.js` (now 49): the chart tool on MT5 (0.03 lot, MT5 PLACE), the order in MT5 with its SL / TP, the app's
  trade, hedging refused, the news guard on the Account page and in the ticket (Master), KILL and Resume.
- `tests/fake_mt5.py` plays EA 1.20 (OPEN, margin, TRAIL, offline trailing; `--ver`, control `/offline`).
  `tests/mock_server.py` points the news guard at a local file (`FTM_NEWS_URL`), never the real ForexFactory.
- Every suite run on fresh data: all pass except the known ones (`chain_lists_flow`'s old expiry fixtures, `mt5_flow`'s
  stray-candles check on a first run, as in v0.35.0) and `jinsights_flow`'s "today" check when run between midnight and
  06:00 IST (the journal's "today" is the calendar date, the paper day starts at 06:00: older than this release).

## v0.36.0 — 10 Nov 2026 — MT5 accounts: your MT5 logins on a side of their own, managed from the app (FundingPips, stage b1)

Added
- **MT5 accounts** (roadmap 8 b, slice b1; owner, 10 Nov: "it need not be limited to 1 mt5 account. We need a way to switch
  between accounts. And I don't want to confuse this with the fyers side").
  - **PAPER | LIVE | MT5** at the top left (MT5 in purple; the phone's button opens the three). Going to MT5 asks for a
    fresh 2FA code. The admin only. Each browser or phone switches for itself; the server refuses changes to an MT5 account
    from a page that isn't on MT5 (403).
  - **One account per MT5 login** whose terminal runs FTM Bridge 1.10, made the first time it calls. On the MT5 side the
    account switcher lists only them ("● 21182752 · DEMO · $5,012.50", the server in its tip); Fyers never appears there
    and MT5 accounts never on PAPER or LIVE. Before any terminal has called, the MT5 side says how to set one up.
  - **Straight from MT5:** positions, pending orders, balance, equity, margin and history, about 4 times a second. Trades
    placed in MT5 itself show at once ("Placed in MT5", "Already open in MT5"). The History page has MT5's own closed trades
    (the last 90 days the first time, marked MT5) and every trade closed since, booked from MT5's closing deal: its price,
    profit, commission and swap, exactly.
  - **Managed from the app, at the broker:** dragging SL / TP, BE, BE-T, TRAIL and ✕ (the entry line's bar, the panel, the
    Trades page, the phone) change the real trade in MT5 through the EA; pending orders placed in MT5 can be moved (their
    SL / TP with them) or cancelled. Each trade's line says what MT5 has ("MT5 SL … ✓", "→ moving to …", "MT5 refused: …",
    "closing in MT5…"). A stop moved by hand in MT5 becomes the trade's stop (the trail leaves it alone, as a stop you set
    yourself). **The first change on each account asks for its login**, once.
  - **Money in the account's currency ($), net** of the broker's commission and the trade's swap: SL, TP, risk, P&L, R, BE
    (BE + commission both ways). The commission per lot is **learned from MT5's real deals**, per symbol and per side
    (opening / closing); a typed default until a symbol has traded; a later deal that charged differently is flagged in the
    Log and used from then on (a small deal's rounding to the cent isn't taken for a change).
  - **FundingPips' loss limits shown** under the account figures and on the Account page: the daily floor from the balance
    at the broker's midnight (worked out from MT5's deals since), minus the daily % (5% by default) of that balance or of
    the starting size; the max floor from the **starting size you type** (the first deposit in MT5's history until then),
    minus the max % (10%, static or trailing); equity under a floor shows in red. The phase (evaluation / Master) is kept for
    the news guard.
  - **The Account page of an MT5 account:** MT5's figures, the EA and whether the app may change trades, the limits and
    their form, the commission learned per symbol, trailing defaults, Read MT5's history again. Settings' rules form shows
    the MT5 account's own limits. CSV: MT5 columns (profit, commission, swap, ticket).
- **FTM Bridge 1.10** (`mt5/FTM_Bridge.mq5`; walk-through updated in `mt5/README.md`). Still calls out only (WebRequest), as
  described to FundingPips. Each call now also carries the account's positions, pending orders, its deals (from where the
  app asks, `DEALS`, at most 200 a call) and the results of the app's requests. New answer lines: `MOD`, `CLOSE`, `CANCEL`,
  `OMOD` (each with a tag; a tag is carried out once, the EA remembers the last 200), with MT5's standard `CTrade`.
  **It opens no new trades.** New inputs: **AllowTrading** (false: show the account, change nothing) and **SlippagePoints**
  (closing at market). The chart's corner says how many positions / orders the account has and the last request.

Changed
- **Safety (helper/mt5acct.py), as the Live design:** each request's tag and its "sent" mark are saved before it goes; a
  request with no result after 20 s is never sent again as it was - MT5's own reports show what happened (a stop that still
  differs is asked for again; a close of a still-open position once more: closing a ticket twice can't close anything else).
  A close or cancel that couldn't reach MT5 within 20 s is dropped, never sent late. If the app's stop or target is passed
  before MT5 has taken it, the app closes the trade at market. Pacing (FundingPips: no server spamming): one change per trade
  every 2 s at most, 30 requests a minute per account.
- Prices: each MT5 account takes its prices from its own terminal (a second terminal streams its own trades' symbols to its
  own account); the charts still use the price terminal.
- `charges.py`: an MT5 branch ($ from MT5's tick value, commission per lot on opening / closing deals). Paper accounts still
  refuse MT5 symbols ("MT5 symbols trade on your MT5 accounts"). Settings › MT5 bridge explains 1.10 and flags an older EA.
- The journal leaves MT5 accounts out until roadmap 8 (c) (the prop-firm journal).
- Money on the page follows the account's currency (₹ on paper and Fyers, $ on MT5). `short()` strips "MT5:" too.

Tests
- `tests/mt5acct_test.py` (new, 85 checks, no browser): the account made per login (admin only; EA 1.00 shows it with a
  warning; a second terminal its own account and its own prices), MT5's history (exact net), a trade placed in MT5 adopted
  (1R, $ at SL / TP, BE + commission), the login once, MOD / CLOSE / CANCEL / OMOD reaching the fake MT5, a stop moved in MT5
  adopted, BE / Trail BE / Trail SL moving MT5's stop and the 2 s pacing, MT5's own SL hit, a refused change and its retry, a
  lost result (no tag run twice), offline (a close never sent late), the app's stop passed first, a part closed in MT5, a
  position gone without a deal (estimate, then replaced), commission learned and a change flagged, the floors, restart.
- `tests/mt5acct_flow.js` (new, browser): the three-way switch with 2FA, the switcher, $, the limits, a trade from MT5 on
  the panel and the chart, the login dialog, SL / BE / TRAIL / ✕ from the entry line's bar reaching MT5, a pending order
  moved and cancelled, 403 from a Paper page, History, the Account page, Settings' rules, back to PAPER, the phone.
- `tests/fake_mt5.py`: an MT5 Hedge account (positions, orders, deals, commission, swap, SL / TP on bid / ask, pending fills,
  invalid stops), the 1.10 protocol, `--old` (1.00), `--history`, and a control API (`--ctl`) for the browser test.
- `tests/mt5_flow.js` and `tests/mt5_test.py`: their stage-a wording checks updated (1.10 manages trades; paper refuses MT5).

## v0.35.0 — 10 Nov 2026 — Search in the indicators menu; Settings as a page of its own; the version at the top

Added
- **Search in ƒx, like TradingView** (roadmap 18; owner, 10 Nov: "Can you give me a search within indicators like
  tradingview?").
  - A search box at the top of the indicators menu, ready to type as it opens (on the phone, tap it).
  - Typing filters everything in the menu: what's on this chart, the built-in indicators (found by their description
    too: "column" finds the P&F toolkit) and your own scripts. Every word must match, and the matching letters are marked.
    Sections with nothing left are hidden; with no match it says so.
  - **↑ / ↓** pick a result, **Enter** adds it to the chart (a library opens its code); the menu and the search stay
    open for the next one. **Esc** clears the search, a second Esc closes the menu.
  - **/** (outside a text box, on the chart) opens ƒx with the search, as on TradingView.
- **Settings as a page of its own** (roadmap 19; owner, 10 Nov: "the settings can be a separate page instead of a tab.
  It looks too cramped").
  - Settings fills the window instead of the 440 px side drawer: the list of sections on the left (Fyers app, Telegram
    alerts, MT5 bridge, paper trading rules, charges, reset, security, users, display, helper log), each section in its own
    card, up to 820 px wide.
  - A click in the list jumps to that section; the list marks the section you're in as you scroll.
  - **← Back** (top left) or **Esc** returns to where you were. The address says **#settings** while it's open, so a
    reload opens it again.
  - The app's own top bar stays above it: picking Chart, Trades, History... there closes Settings and opens that page.
  - The phone: full screen, with the sections as a row of chips along the top.
- **The version at the top** (roadmap 20; owner, 10 Nov: "bring the version somewhere at the top so, it's easily
  visible"): under "Trade Manager" in the top bar (its commit and the server's up-time when you point at it), at the top
  of the Settings page, and at the top of the phone's More tab.

Changed
- Every setting is where it was, with the same buttons; only the layout around them changed.
- **Settings is a ⚙ at the top right** (it was the word "Settings"): the top bar has no room for anything more at
  1500 px on the Live side with MT5 in use (it moved to a second line).
- Logging out closes Settings, so the next login starts on the app. The chart's keys (F, P, /) don't reach through it.

Tests
- `tests/settings_search_flow.js` (new, 34 checks): the version (top bar, Settings, the phone's More); the ƒx search (filtering, words, descriptions, marks, nothing
  found, ↑ / ↓ / Enter / Esc, "/"), the Settings page (full window, the section list, jumps, the list following the
  scroll, #settings and reload, Esc and ← Back), the phone (chips, a jump, the Layout switch, the search).
- Every browser suite run again on fresh test data (security_flow first). `live_flow.js` (its "the header stays on one
  line" check found the crowded top bar) passes with the ⚙.

## v0.34.0 — 10 Nov 2026 — MT5 prices and charts through your own bridge EA (FundingPips, stage a)

Added
- **MT5 bridge** (roadmap 8, stage a; owner, 5 Nov: "It will be interesting to be able to trade from this platform on MT5?
  Like I have so many things like PnF charts which are not possible on MT5"; 10 Nov: "Let's build this"). Your FundingPips
  MT5 terminal's prices and candles in this app: every chart type (P&F, Renko, range, line break, Heikin-Ashi...), Volume,
  every indicator and Pine script, drawings, the measure in points, watchlists, grids, the phone.
  - **Your own EA, `mt5/FTM_Bridge.mq5`** (version 1.00), with a plain-words walk-through in `mt5/README.md` (proof of
    ownership for FundingPips: the source and its history are in this repo; you compile it in your own MetaEditor).
    It runs in MT5 on your laptop and **only calls out** to the server with WebRequest, as described to FundingPips on
    8 Nov; nothing connects in to your laptop; the server never logs in to your broker account. **It places no orders.**
  - **How it talks:** `POST /api/mt5/sync` about 4 times a second (the account, the broker's clock, new ticks); the answer
    is a few text lines (`OK`, `SUB` the symbols to stream, `HIST` candles to send, `LIST` the symbol list, `ERR`).
    Candles come from MT5 itself (`CopyRates`) and are saved on the server like Fyers' candles; the symbol list (with
    each symbol's digits, tick size, contract size, volume steps, swap...) is asked for once and every 12 hours.
  - **Settings › MT5 bridge** (every user, for their own MT5): the setup in 5 steps, **Download FTM_Bridge.mq5**, the
    address to allow in MT5, a **bridge key** (made with your 2FA code, shown once, only its fingerprint kept; a new key
    stops the old one; Remove the key), each terminal that has called (login, server, DEMO, Hedge / Netting, balance,
    equity, connected or when last heard, the address it calls from, the EA's version), which one gives the prices, and
    the broker's clock. A reminder: MT5 and the EA only on your own laptop, no VPS, no VPN.
  - **MT5 in the Prices pill** while the page shows an MT5 symbol (the chart or the watchlist): green while a terminal gives
    prices, red when MT5 is off (its tip says which terminal or why; click: the settings). The phone: a warning line
    "MT5 isn't connected" on an MT5 chart.
  - **Find:** MT5 symbols by name or description ("gold" finds XAUUSD), shown as "XAUUSD · MT5 · Gold vs US Dollar";
    an **MT5** button shows only them. Symbols are `MT5:<the broker's name>`.
  - **Prices like MT5's:** the price (ltp) is the bid, as MT5 draws its candles; bid and ask lines as on Fyers charts.
    Volume is MT5's tick volume.
  - **The broker's day:** an MT5 symbol's day starts at the broker's midnight (FundingPips GMT+2: 03:30 IST; 02:30 IST in
    US summer time), so its intraday candles count from there like MT5's, and its daily candles are the broker's days
    (stamped 00:00 IST of the broker's date). No "market closed" on weekdays; the candle timer counts to the broker's
    day end. **The broker's clock** setting: moves with US summer time (most brokers, FundingPips) or never changes; the
    candles from before a clock change are placed by it.
  - **45-minute candles** (MT5 has none) are built from MT5's 15-minute ones, from the broker's midnight.
  - **Several terminals** (several FundingPips accounts) can connect with the same key; prices come from the ticked one
    while it's connected, else the one heard from last.
  - **The EA is careful with the connection:** ticks count as delivered only once the app answers (a failed call sends
    them again; the server drops repeats); after a gap of over a minute it starts from the latest price instead of
    replaying it; history MT5 is still downloading is retried for up to 37 s, then reported; a symbol the broker doesn't
    have is logged once.
- **Safety on the server:** 30 wrong keys from one address in 10 minutes block it for 10 minutes; bodies are size
  limited; making or removing a key is in the security log.

Changed
- **Charges and trading stay Indian-only for now:** paper trading refuses MT5 symbols ("charts only for now"), and the
  measure tool / position drawings show points (not net ₹) on them. Trading through the bridge, in $ net of FundingPips'
  commission and swap (owner, 10 Nov), is stage b.
- **Fyers' feed is never asked for MT5 symbols** (price socket, quote polls, order books), and MT5's ticks don't count as
  Fyers' feed being alive.
- On MT5 charts: no Fyers data check, no order book (the Book tab says so), and charts load without a Fyers login.

Tests
- `tests/fake_mt5.py`: a fake MT5 terminal running the EA's protocol (GMT+2 / +3, weekends without candles, the same
  prices every run), usable from the command line or in-process.
- `tests/mt5_test.py` (new, 52 checks): the key (hash only, a new one stops the old one, wrong keys blocked), the EA's
  first call, the symbol list and search, ticks to the feed and pages (UTC times, ltp = bid, repeats dropped, two ticks in
  one millisecond both kept), Fyers never asked for MT5,
  candles (saved, fresh, older days, daily, 45m, an unknown symbol), offline, the broker's clock rule, paper refusing MT5.
- `tests/mt5_flow.js` (new, 44 checks): Settings › MT5 bridge (key with 2FA, the EA download, a terminal connecting),
  MT5 in the Prices pill (the header stays on one line at 1500 px), Find and its MT5 button, an MT5 chart (candles, live ticks, the broker's day), **every chart type with Volume
  and two Pine scripts on MT5 candles**, 1D and 45m, the Book tab, trading refused, MT5 going away, the phone (and its "MT5 isn't connected" line).
- `tests/mock_server.py`: its fake Fyers stream sends only what Fyers would (never MT5 symbols).
- `tests/routes_check.py`: the 7 new routes.
- **Not tested: the EA in a real MT5.** MetaEditor can't run here, so `FTM_Bridge.mq5` hasn't been compiled (an
  independent desk check of every MQL5 call found no compile errors, and its runtime findings are fixed): compile it
  (F7) and send any errors. Also untested: FundingPips' real server, history downloads, and the real WebRequest set-up.

## v0.33.1 — 5 Nov 2026 — A separate Telegram channel for Live trades' pictures

Added
- **Live trades' channel** in Journal › Settings › Pictures (roadmap 17; owner, 5 Nov: "A separate telegram channel for
  live"), below the journal's chat, with its own Save and Send a test. The admin only.
  - **Set:** every picture of the Live account's trades goes there; paper trades' pictures stay in the journal's chat.
  - **Empty:** everything goes to the journal's chat, as before.
  - **Only the Live channel set** (the journal's chat empty): only Live trades are copied; paper pictures aren't sent or
    counted as waiting.
  - **Each copy remembers its chat,** so deleting a picture deletes its copy from the right channel. Changing the Live
    channel restarts the backup's stamp, as changing the journal's chat does.
  - **The weekly review's summary** stays in the journal's chat (the Live channel if that's the only one): it covers every
    account.
- The same bot as before (Settings › Telegram alerts); captions already start with LIVE or Paper and the account.

Tests
- `tests/jshots_test.py`: 9 new checks (52 in all): which chat each trade's pictures go to, a bad Live channel refused, a
  Live and a paper trade's pictures each to their own channel, Live only, the weekly review's chat, Send a test.
- `tests/jshots_flow.js`: 5 new checks (50 in all): the field, a bad channel refused, saved, Send a test, emptied again.
- Run again: `journal_test.py`, `jreview_test.py`, `jinsights_flow.js`, `journal_flow.js`, `routes_check.py`.

## v0.33.0 — 5 Nov 2026 — The Live account is your Fyers account

Added
- **One Live account: your Fyers account itself** (roadmap 16; owner, 5 Nov: "since Live trading is directly on the broker, why
  should we have Live options for paper accounts. Paper accounts are different").
  - **Named by the Fyers client ID**, the admin's only; made the first time you switch to Live, then it runs all the time.
  - **Paper accounts have no Live option any more** ("Turn on LIVE" / "Back to Paper" are gone).
- **PAPER / LIVE switch at the top left**, next to "Trade Manager" (phone: the first button in the top bar). Paper green, Live red.
  - **To Live:** the Fyers client ID typed and a fresh 2FA code (as before). **Back to Paper:** one click.
  - **Per login:** each browser or phone switches for itself; a login's other pages (tabs, grid charts) follow it.
  - **On the server:** a page on Paper can't change anything on the Live account (HTTP 403); the kill switch always works.
  - **It only decides where the page's new orders go:** the server manages Live trades whichever side any page is on.
- **The real Fyers balance** (owner's answer 1).
  - **Balance, margin in use and free funds come from Fyers' funds** (both ledgers), read every minute and after every fill.
    Balance = Fyers' start of the day + money moved today + today's closed trades net of every charge.
  - **The % rules count from them;** the daily loss from today's start as Fyers reports it. No typed capital: the size is the
    Fyers balance on the day you first switched to Live.
  - **Money in / out isn't a profit or a loss:** the size, today's start and the highest balance move by it.
  - **New live orders wait until Fyers' funds have been read once** (nothing sized from a made-up balance).
  - **Account page:** Fyers' funds (start, money moved, today's net, balance, equity, margin, available, size, each ledger) and
    *Read funds now*. The size in the rules is shown, not typed.
- **Every trade on the Fyers account is shown and managed** (owner's answer 2), placed here or straight in Fyers.
  - **Opened, added to, part closed, closed or reversed in Fyers:** followed from the order updates at Fyers' prices.
    Fallback: the order book, then the position book (a difference read twice, 3 s apart, nothing of the app's in flight).
  - **Marked:** "From Fyers" (positions), "Placed in Fyers" (orders), "Fyers" (History, CSV `placed_in`, journal CSV
    `Placed in`).
  - **The first read of the account** adopts what's already there (positions, pending orders, their stops); earlier fills
    and finished orders are never replayed. Nothing is booked twice, also after a restart.
  - **A stop placed in Fyers is adopted as the trade's stop:** trailing and BE move that same order, keeping its type (SL-M
    stays SL-M). Never two exit orders. Its first stop sets 1R.
  - **A pending order placed in Fyers** shows on the chart and in Orders: move it (its type kept) or cancel it here.
  - **No stop** (owner's answer): a red NO STOP AT FYERS flag (position, Trades page, the entry line's bar, the phone's
    sheet, the warnings) and **Place my stop**: your remembered stop distance for that contract, else the tool's default,
    placed at Fyers only when you tap. Its first stop sets 1R.
  - **Delivery holdings** (owner's answer: shown and managed): Live trades at their cost price, never squared off. Close all
    and the kill switch keep them; ✕ sells one. A sell refused for want of DDPI / eDIS shows Fyers' reason on the holding.
  - **Fyers logged in as another client** than the Live account's: nothing new is placed, with a warning.
- **Telegram alerts:** a delivery holding without a stop isn't a live trade to watch (no outage messages, the outside heartbeat
  still pauses); one with a stop is.

Changed
- **An account switched Live under the old design goes back to Paper on the upgrade:** its live trades archived
  (`paper_trades_until_<date>_live.json`), a fresh paper ledger at its capital, its live order ids dropped. Any real position
  is read from Fyers by the new Live account (the real server had no live trade yet).
- `/api/accounts/mode` stays, answering that paper accounts have no Live option. New route: `POST /api/side`.
- **The kill switch also cancels an order placed in Fyers during it,** and never sends a second exit for a position it's
  closing.
- **The account switcher on Live:** "● XT0001 · ₹balance", locked; the separate LIVE badge isn't shown beside the switch.
- **A trade with no stop:** its first stop (typed, Place my stop) sets 1R, and as it only lowers the risk, the widening checks
  don't apply.
- **Delivery quantity at Fyers:** the holding's start-of-day quantity plus today's position (today's sells were counted
  twice before).

Tests
- `tests/live_account_test.py` (new, 71 checks, no browser):
  - **Fyers' funds:** the size, the daily floor, both ledgers, money in and out, the next day; no orders before the first read.
  - **Trades made in Fyers:** opened, added, part and fully closed, past flat; an adopted SL-M trailed as SL-M and closed
    through; pending orders moved, filled, cancelled.
  - **The books:** the first read with a stop already at Fyers, the position-book fallback, a restart.
  - **Holdings** (no eDIS, then a stop; the watchdog ignores one without a stop), and `rt.py` (old Live accounts, the one
    Live account, not the admin).
- `tests/live_flow.js` rewritten (60 checks; also run twice more on used data with `FYERS_OUT_IP` set): the switch (colours, 2FA, per login, the server's 403), the Live card's funds,
  a trade from the app, one placed in Fyers (NO STOP, Place my stop), a Fyers limit cancelled here, the phone, the kill
  switch, back to Paper while the server keeps booking.
- `live_test.py` (61, ALL PASSED: its kill-switch checks caught two races, fixed above), `alerts_test.py` (57),
  `telegram_flow.js` (33: the switch; the Live account's loss limits off while it trades), `routes_check.py` (`/api/side`).
- The fake Fyers' order ids are unique across runs, as Fyers' are (a restarted mock reused ids the app had seen).
- The rest of the kit on fresh data, all passing except `chain_lists_flow.js`'s expiry checks (2): they fail the same way
  on v0.32.0 today, as the test contract list (saved 30 Oct) has few expiries left.

## v0.32.0 — 5 Nov 2026 — LiveTrader 1.24: RR lock, per-trade trailing, tool gap

Added
- **RR box and padlock under the chart's BUY / SELL** (LiveTrader 1.24's RR box and lock; owner, 5 Nov: "I introduced
  some new changes to the livetrader").
  - **RR box:** the tool's net reward : risk. Typing one (0.1 to 50) moves the tool's target to it. It's the same figure
    as the ticket's R box (and the phone's).
  - **Padlock (the RR lock):** locked, moving the stop moves the target, and moving the target (dragged, or typed in the
    ticket or on the phone) moves the stop.
    - **The stop is worked out on the server** (`plan(lock_tp=...)`): the widest stop that still gives at least that net
      RR, after every Indian charge, at the lots it then sizes to. LiveTrader's own lock uses its round-trip commission
      only.
    - **On screen:** while dragging, the other line follows from the last exact figure; on release the server's answer
      replaces it.
  - **Limits, each with a message:**
    - **The rules stop the stop going wider** (risk %, risk cap, margin): the stop stays at the widest that still trades,
      and the target goes back to the RR from it.
    - **A target too close for the RR after charges:** the closest stop.
  - **Where:** under BUY / SELL, beside the ticket's R, and in the phone's order sheet.
  - **Saved** with the ticket defaults (`rr_lock`).
  - Not for an option whose stops follow its future.
- **Tool gap** (Chart settings): the new-trade tool starts this many px after the live candle's right edge (30 by
  default, LiveTrader's `InpToolGap`). It was 6 px after the candle's middle.

Changed
- **Per-trade trailing as in LiveTrader 1.24** (the BE-T / TRAIL controls on each trade's entry line, the Trades page and
  the phone's position sheet, which this app already had):
  - **Typing a trade's R switches that trail on** (it only changed the R).
  - **Changing the panel's Trail BE (its switch or its R) makes every open trade follow the panel's Trail BE again**,
    switch and R together; the same for Trail SL. Before, only the value changed was copied to each trade.
  - **Each trade knows** whether its trail is its own or the panel's (`tr.own_be` / `tr.own_sl`), and its BE-T / TRAIL
    say so when pointed at.
  - **BE-T shows "done"** (blue-grey) once Trail BE has put the stop at break-even.
- Unlocked, the tool's target keeps behaving as before: it stays at your R while the stop moves, until you drag the target
  yourself. LiveTrader 1.24 unlocked leaves the target where it is from the start. Not changed; one switch away if wanted.

Tests
- `tests/trail_rr_test.py` (new, 27 checks, no browser):
  - **Per-trade trailing:** a typed R switches it on; the panel takes trades back per trail; each trade's Trail BE fires
    at its own R; no re-arm at BE.
  - **The RR lock** (exactly 2.000R on NIFTY; one tick wider is 1.997R):
    - long and short, market and limit, risk % and fixed lots, RR 2 and 3;
    - the risk cap and a too-close target, each with its message;
    - wrong side and no RR refused; saved with the ticket.
- `tests/rr_lock_flow.js` (new, 36 checks, browser on the fake Fyers, a fresh account each run):
  - **RR box and padlock:** where they sit; typing an RR; a bad RR refused; locking.
  - **Dragging with a real mouse while locked:** the target (the stop follows, the target stays where dropped); the stop
    (the target follows); typing the target; past the risk cap (the message).
  - **The rest:** saved over a reload; unlocked drags; the tool gap at 30 and 80 px; the entry line's R boxes switching
    trails on; the panel taking the trade back; the Trades page's wording; the phone's padlock.
- Run again on fresh test data:
  - security 29 checks, Live 24, phone 61, multi-charts 43, drawings 78;
  - `live_test.py` (ALL PASSED), `routes_check.py`.

## v0.31.0 — 5 Nov 2026 — A second server for a friend, on any Linux server

Added
- **One script sets up a new server** (asked 5 Nov, "Option B"), on any Linux server with systemd: Ubuntu / Debian (apt)
  or Rocky / Alma / RHEL / Fedora / Oracle Linux / Amazon Linux (dnf), at any provider or at home.
  `server/startup.sh` goes into the provider's start-up box (DigitalOcean's Initialization scripts, AWS user data,
  Hetzner cloud config, ...) or runs over SSH (`sudo bash startup.sh owner/name [branch] [domain]`).
  - **Installs:** packages, Python 3.10+ (a newer one added where the system's is older), Caddy (its own repo, the
    distribution's, or the official download), the firewall (ufw, firewalld, or Oracle Cloud's iptables rules; the SSH
    port in use stays open), swap on small servers, IST.
  - **Waits for GitHub:** makes the read-only deploy key, checks every 30 s whether GitHub accepts it, then clones and
    runs `install.sh` by itself.
  - **`sudo fyers-status`** (shown when root logs in; `--wait` to watch) says where it is: the key to add with the link
    to the repo's Deploy keys page, then the address and setup code, and the IP to whitelist at Fyers.
- **Any repo:** the owner's (a second deploy key on it), a fork, or the friend's own copy, and an optional branch to follow
  (e.g. `stable`, so the owner chooses which releases reach that server). Steps for each: `docs/New_Server_Guide.md`.
- **Each server's own settings** in `/etc/fyers/server.conf` (not in Git): address, outgoing IP, branch, repo, Python.
  - **Missing values are worked out:** the address is kept from the Caddyfile in use (the owner's server keeps
    `68-183-245-178.sslip.io`), else a DigitalOcean reserved IP, else the public IP as the internet sees it, as
    `<ip>.sslip.io`. The outgoing IP is the public IP as the internet sees it.
  - **The file is read, never run:** only known keys and safe values.

Changed
- **`install.sh` no longer falls back to the owner's address.** Before, every update on another server would have pointed
  its HTTPS at `68-183-245-178.sslip.io`.
- **The Turn on LIVE dialog names this server's own IP to whitelist** (from `FYERS_OUT_IP`), no longer the owner's
  134.209.159.171 on every server. If the IP isn't known, it says how to find it.
- **`update.sh` follows `FYERS_BRANCH` when set.** A branch missing on GitHub is reported and nothing is taken (before, a
  wrong branch name would still have run `install.sh`).
- **`install.sh` on RHEL-family systems:** picks a Python 3.10+ for the venv, labels the venv's programs for SELinux, and
  starts Caddy if it isn't running.

Fixed
- Found in testing this release: on a fresh server the Caddy package's default Caddyfile (no address in it) would have
  stopped `install.sh` silently under `set -euo pipefail`.

Tests
- `tests/server_conf_test.sh` (new, 16 checks, safe anywhere): each server's settings against a fake DigitalOcean metadata
  service and a fake "what's my IP":
  - the owner's server keeps its address;
  - a DigitalOcean reserved IP; any other provider; bad and private lookups skipped;
  - own domain; what the first-boot script writes is filled in;
  - commands in the file never run; a bad branch refused; Windows line endings;
  - all under `set -euo pipefail`, as `install.sh` runs.
- `tests/server_flow.sh` (new, 25 checks, a throwaway container only): the scripts `startup.sh` writes and `update.sh`,
  against a local repo standing in for GitHub:
  - waiting for the key (the key and the link shown), cloning as `helper`, install, the setup code and IP shown;
  - updates on main; following `stable` and its move; a missing branch takes nothing; a new server cloning `stable`;
  - a failed install shown and retried.
- `tests/live_flow.js`: the dialog names the server's IP (`FYERS_OUT_IP` set) or gives the general wording (not set),
  never another server's IP. 24 checks, run both ways.
- By hand in an Ubuntu 24.04 container: the real `startup.sh`, with only systemd, the firewall and the Caddy download
  stood in, then the real `install.sh` (settings written, Caddyfile with the address, services, venv with
  requirements.txt).

## v0.30.3 — 3 Nov 2026 — Indicator buttons always in reach

Fixed
- **An indicator with many values pushed its buttons off the screen** (owner, 3 Nov, MultiPivot "Classic + CPR 6 20" on
  NIFTY 26 NOV 23500 CE: 15 values, the 👁 ⚙ { } ✕ only just inside the chart). The buttons came after the values on a
  line that never wrapped. Now, like TradingView:
  - the buttons come **right after the indicator's name**, before its values (pointing at the read-out shows them; on the
    phone they're always shown), with their space kept so nothing shifts when they appear;
  - a read-out is never wider than the chart minus the price scale: long values **wrap onto the next line** (every value
    stays readable), and the read-outs on the candles stack under each other without overlapping;
  - it follows the chart's width (a narrower window, a grid's chart, the phone).

Tests
- `tests/legend_flow.js` (new, 12 checks): two scripts with 24 values each (on the candles and in their own pane) and a
  short one, on a 1000 px window, a 760 px one and a phone: no read-out past the price scale, long values wrapped, the eye
  and ✕ inside the chart, the buttons right after the name, no overlap; the eye hides and shows each by a real click,
  and by a tap on the phone.

## v0.30.2 — 3 Nov 2026 — No false data warning or extra candle before the open

Fixed
- **A false "Candles don't match Fyers' live figures" warning before the open** (owner, 3 Nov, NIFTY 50 at 09:14:
  candles' day open 23,222.30 / high 23,440.80 / low 23,207.05 / last 23,440.80 against Fyers live 23,582.25 for all
  four). The candles were Monday's, which were right; the live figures were already Tuesday's, from NSE's pre-open
  (09:00-09:15). With the market closed, the check assumed Fyers' live figures belong to the candles' last day. Now it
  uses Fyers' previous close to work out which day they belong to (it's the close of the day before theirs):
  - live figures for a later day, during the 30 minutes before the open: nothing to compare until today's candles arrive;
  - live figures for a later day at any other time (that day traded but the candles don't have it): a new
    **Latest day** warning, saying the history is missing a day (before, that showed as a confusing open / high / low list);
  - live figures for the candles' own day (an evening, a weekend, the morning before the pre-open): compared as before.
  Without a previous close from Fyers, the 30 minutes before the open are skipped and other times compared as before.
- **The pre-open price drew a candle of its own** on intraday charts (the tall 09:00 candle at 23,582.25 on NIFTY 15m,
  which Fyers' history doesn't have and which went away on reload). A price before the session opens no longer makes
  an intraday candle; the bid / ask / last lines still show it, the session's first candle starts at the open, and a daily
  candle still takes it as today's.

Changed
- The warning's text no longer cites GOLDPETAL's 30 Oct (that was the continuous series, fixed in v0.30.1).

Tests
- `tests/navigation_flow.js` (41 checks): pre-open figures with and without a previous close give no warning; a later day
  missing from the candles is flagged; the day after (weekend) still compares the candles' own day and flags a bad one;
  no previous close outside the pre-open compares as before; a price before the session opens makes no candle and the
  first one after the open does.

## v0.30.1 — 2 Nov 2026 — Futures and options charts show the contract itself (continuous data off)

Fixed
- **Futures and options charts could show another contract's candles around an expiry** (owner, 2 Nov, after Fyers'
  reply to his report about GOLDPETAL NOV's 30 Oct). Fyers' API gives its continuous series (on each date, whichever
  contract was the near month then) unless a request says continuous **off**. v0.20.6 stopped asking for it but didn't
  turn it off, so the app kept getting it. Checked on the server, 2 Nov, GOLDPETAL NOV, 30 Oct, 15m:
  - continuous not mentioned (what the app sent) and continuous on: both 319 lots, last trade 16:45, close 14,201 (the
    expiring OCT contract's last day);
  - continuous off: 314,649 lots, low 13,699, close 13,960, trading until 23:15 - the real day, as Fyers' own chart
    shows with its Continuous Futures setting off.
  Now every history request says continuous off. Trades were never affected (fills, stops and P&L use live prices);
  the chart's history was (candles, Volume, indicators, Pine, P&F, the journal's server pictures, replays).
- Once, on the first start of this version: the futures / options candles saved on the server are dropped (stocks and
  indices stay) and the browsers' saved copies are deleted, so each futures / options chart loads again from Fyers
  when opened (one or two requests per chart, inside the request budget).

Corrected
- v0.20.7 said Fyers rewrote GOLDPETAL NOV's 30 Oct after the close and that Fyers' own chart showed the same. Wrong:
  Fyers' chart had Continuous Futures on (its default since July 2025), and the app was getting the continuous series.
  Fyers' data for the contract was right all along (Fyers' reply, 2 Nov). The weekly re-check of past days (v0.20.7)
  and "Hide no-trade candles" (v0.20.5) stay as safeguards.

Docs
- Guide: charts always ask for the contract itself; how to turn off Continuous Futures on Fyers' own chart to compare.
  Roadmap: the Fyers follow-up closed; item 10's reason restated (no rewrite happened). Handoff updated.

Tests
- `tests/candles_test.py` (9 checks): continuous off on every request, several chunks included; the clean-out runs
  again on a v0.20.6-v0.30.0 database (futures / options dropped, stocks kept).
- The fake Fyers (`mock_server.py`) now treats a history request without continuous off as asking for the continuous
  series (marker price, "CONT_FLAG ASKED" in its log), as real Fyers does; none in this release's runs.
- `tests/navigation_flow.js` (36 checks): the old browser stores (`fyers-candles`, `fyers-candles-2`) are deleted,
  `fyers-candles-3` in use.

## v0.30.0 — 2 Nov 2026 — Option chain header that stays put; changing a contract's lists

Added
- **＋ beside every CE and PE in the option chain** (asked 2 Nov): opens a list picker with every watchlist, ticked where
  the contract already is; a tap adds it to that list or takes it out. The ＋ turns into ★ once the contract is in a list
  (its tooltip names the lists). Right-click on a CE / PE still adds it straight to the list on screen.
- **Changing a contract's lists from its row** (asked 2 Nov: "if I add it to a list by mistake, I need an option to change
  the list from the instrument itself"): ⋯ on each watchlist row, or right-click the row, opens the same picker with
  **Move** (into that list and out of this one, one tap), ticks to keep it in several lists, and **Remove from …**. On the
  phone the picker is a sheet at the bottom, and a row swiped left shows **Lists · Remove** (owner: "like a swipe menu");
  a tap on a swiped-open row closes it instead of opening the chart.
- **ATM** button in the chain's header: back to the strike nearest the price.

Changed
- **The option chain's header is one slim row that stays at the top** (asked 2 Nov, with a screenshot): underlying,
  expiry and ATM side by side (was two labelled fields, about 120 px); only the strikes scroll, under it, on the desktop
  and the phone, so another expiry is always one tap away.
- **The chain opens at the strike nearest the price only when an underlying or expiry is opened**, by scrolling the
  strikes alone (before, `scrollIntoView` also scrolled the Options pane, carrying the header out of sight). Nothing
  moves it afterwards; if the price arrives after the chain is drawn, it goes there once unless you've already scrolled.
  The nearest strike's highlight follows the price. While the Options tab is open the underlying's price is streamed
  (it counts toward the page's 40 streamed contracts).
- Phone: watchlist rows show ⋯ instead of ×; removing is in the swipe and the picker.

Docs
- Roadmap: item 13 (this release); the 2 Nov order-flow check read (exact volume NIFTY 6.6%, CRUDEOIL 25.1%, GOLDPETAL
  18.0%) and the footprint parked on the owner's word, with the two ways to resume it; item 12 notes that tick charts
  can't be exact from this feed; the recorder switched off on the server (2 Nov 10:42).

Tests
- `tests/chain_lists_flow.js` (new, 36 checks): the header's size and place while the strikes scroll (short windows, so
  the fake 12-strike chain really scrolls), opening at the nearest strike, no pull-back while prices tick, the highlight
  following the price, another expiry, ATM; ＋ and the picker, ★, right-click; ⋯ / right-click on a row, Move, keep in
  two lists, Remove, saved after a reload; the phone: header, bottom sheet, ⋯, swipe left (Lists · Remove), a tap
  closing a swiped row, a swipe right or a small move doing nothing.

## v0.29.0 — 2 Nov 2026 — Trade replay: every trade on its recorded chart, and ▶ Play

Added
- **▶ On chart for every finished trade** (asked 1 Nov: "capture which indicators were present with what settings and then
  show the trade on the chart"; roadmap 4c, replacing the hidden-browser picture idea). Journal cards, History's row
  details and the phone's History tab open the trade over the page; ← Back / Esc returns to the page untouched.
- **The chart's set-up recorded at every entry and exit, on the server** (no page needed): contract, timeframe, chart
  type, Chart settings, every indicator with its inputs / style / visibility / own timeframe, a copy of each Pine script's
  code as it was then (library imports resolve the same way), the contract's drawings as they were. The entry uses the chart
  the order was placed from (PLACE now sends its set-up; kept until a limit order fills); otherwise the saved layout's chart
  for that contract. The exit: the same layout chart as it is then. Entry / Exit set-up switch; Pine as recorded / My
  current Pine. Code and drawings are stored once per version (`u/<user>/replay/`).
- **The trade drawn on its chart:** entries and adds, exits with net ₹ and R, the stop's path step by step (BE marked),
  the target, break-even + costs, the trade's zones; the price scale takes in the trade's prices; every chart type.
- **Every stop / target move is recorded** per position with its time and kind (open, BE, trail step, edit, add); history
  records and journal trades keep it. Trades from before this release: the path is rebuilt from the account's own log
  (each BE / trail step / SL-TP edit it noted, last 500 entries), marked as such; past the log, first and last stop only.
  Never estimated from candles (asked 1 Nov: "why can't we capture this too?").
- **▶ Play: the trade as it played out** (asked 1 Nov: "show it like a real trade as it played out"), like TradingView's
  bar replay: from 30 candles before the entry, one candle at a time; a forming candle builds from the 1-minute candles
  (5m on 2h-4h charts, 15m on daily); indicators and Pine work out each candle as it closes through the chart's own live
  path, from what was known then; request.security / other timeframes stop at the replay's time; the stop, target and BE
  move when they moved; the open trade's net ₹ and R after all charges at each step (from the server's charges). ⏮, ▶ / ⏸
  (Space), +1 (→), ⏭ next candle (Shift+→), speed 1-32 candles a second, Entry / Exit jumps, ■ Stop.
- Routes: `GET /api/journal/replay?id=` (the trade, its path, BE, both set-ups), `POST /api/journal/replay/net`
  (net ₹ and R at given times and prices).

Changed
- **Automatic journal pictures are off** (owner, 1 Nov: the replay replaces them): the server's drawing at entry / exit
  and the open chart's picture. Accounts that had them on are switched off once by this update; Journal › Settings ›
  Pictures turns them back on (and they stay on). 📷, uploads, paste and drop are unchanged; nothing was deleted.
- Replays read candles through `/api/history`, the chart's own route, so roadmap item 10's recorded live candles will
  reach them the same way.

Tests
- New `tests/replay_test.py` (42 checks, no browser): the engine's path (kinds, order, a long's stop never back), the
  history record and journal trade carry it; entry snapshot from the order's chart, a limit filled after a restart, the
  layout fallbacks; Pine code and drawings as at entry vs exit; stored once; a refused order's set-up dropped; the old-trade
  path from the log (other contracts ignored, partial log marked, no log = ends); net ₹ with an add and a partial close vs
  `charges.net_at`; pictures off by default / after upgrade / on again.
- New `tests/replay_flow.js` (48 checks, browser): a trade from a 1m chart with Volume + a Pine script; the script and chart
  changed afterwards; ▶ On chart shows the recorded timeframe and code, the trade drawn, nothing saved; Play, Pine up to the
  replay's time, request.security cut at it, +1, ⏭, Entry / Exit with net ₹ and R, a 5m candle built from its minutes,
  every chart type, Stop, My current Pine, Exit set-up, Esc, History's button, the phone (bar size, ⋯, Play).
- `tests/mock_server.py`: `POST /_mock/allday?on=1` gives the fake Fyers candles round the clock (a test trade at night
  needs candles under it); off by default.
- `tests/jshots_test.py`, `tests/jreview_test.py`: turn the automatic pictures on first (now off by default).
  `tests/jinsights_flow.js`: the walk-through checks its picture only when that trade has one (trades made by other suites
  no longer get automatic pictures); it prints the copied text when a Copy for Gemini check fails.
- The whole kit run on fresh data (2 Nov, 00:10-01:30 IST): every engine test passes (routes, square-off, feed, order-flow
  check, journal 58, pictures 43, review 25, candles, replay 42, live engine, alerts, chart types); browser suites: security
  29, live 22, chart types 92, Pine on every chart type 121, indicator settings 37, navigation 36, watchlists 16, drawings
  78, layouts 31, multi-chart 43, Telegram 33, journal 43, pictures 45, phone 61, replay 48 - all pass; insights 38 of 41:
  its three Copy for Gemini "today" / "this week" checks fail between midnight and the day's reset hour (a trade at 01:00
  IST belongs to the previous trading day; unrelated to this release, noted in the roadmap's follow-ups).
- `tests/routes_check.py`: the two new routes.

## v0.28.1 — 1 Nov 2026 — Multi-chart grids work on the server

Fixed
- **Grids showed "68-183-245-178.sslip.io refused to connect" in every chart** (reported 1 Nov with a screenshot). Each
  chart in a grid is the app itself in a frame, and the server's Caddy sent `X-Frame-Options: DENY`, which forbids frames
  even from the same site. Now `X-Frame-Options: SAMEORIGIN` with `Content-Security-Policy: frame-ancestors 'self'`: the app
  can frame itself, other websites still can't frame it. `server/Caddyfile`; the update's install step copies it and
  reloads Caddy on its own. Broken since v0.24.0 on the real server only.

Tests
- `tests/mock_server.py` now adds the response headers from `server/Caddyfile` (as Caddy does on the server), so the
  browser tests run under the same rules. Checked: with the old `DENY` line `multichart_flow.js` fails; with the fix it
  passes (43 checks). Every browser suite re-run under the new headers on fresh test data: all pass (live 22, journal
  43, jshots 45, jinsights 40, multichart 43, charttypes 92, pine_compat 121, indicator_settings 37, navigation 36,
  watchlists 16, drawings 78, layouts 31, telegram 33, mobile 61).
- `tests/drawings_flow.js`: its test trade uses Carry, so it also runs after the evening Intraday square-off (23:15 IST).

## v0.28.0 — 1 Nov 2026 — Journal: Insights, the weekly review, Copy for Gemini, export and backup

Added
- **Insights** (Journal › Insights; roadmap item 4, the last of its three releases), following the journal's filters (all
  but the Octagon one, so held and broken trades can be compared): KPIs (net, win rate, expectancy, average and total R,
  clean octagon); the **equity curve with its drawdown** (balance or P&L); **performance** (expectancy in ₹ and R, payoff,
  profit factor, SQN, Kelly, Sharpe, Sortino, Calmar, recovery, return, maximum / current / longest drawdown, worst day,
  green days, runs, largest win / loss, average hold of winners vs losers, charges as a share of gross profit); **rep
  blocks** and reps by account; **Octagon discipline** (clean vs each broken pillar); **lockouts** (2% hits, 99 Club breaks,
  number-running stops, how many were ignored, trades after a lockout, practice days); wait state; time of day (Indian
  buckets); weekday; market regime; bias / KE; contract; side; setup tags; exit reason; account. All net of charges.
- **The weekly Review** (Journal › Review), Monday to Sunday by close time (IST), per account or all: the week at a glance
  against last week, the **Octagon scorecard** with the biggest leak, day by day, the **outcome × process grid** (earned
  win, lucky win, good loss, earned loss) with winners / losers / broke a pillar / all, and the reflection (what went well,
  what broke the octagon, one focus for next week; last week's focus marked held / partly / missed). Saving posts a summary
  to the journal's Telegram chat when the backup is on, and edits that same message after. **Copy summary.**
- **The walk-through:** one trade at a time with its server picture (and the others) beside the facts, pillars, plan and
  the reflection (what I did right / wrong, lesson); ← / → move on and save; Open on the chart; Edit audit.
- **The calendar:** net per day (tinted), trades and W–L, pillars broken, practice days; each week's net and whether it's
  reviewed; a day opens its trades, a week its review. On the phone: the 7 days only.
- **Copy for Gemini** (the Journal's top bar, each trade, the review): today, yesterday, this week, last week, a review's
  week, or one trade; per account; optionally starting with your Octagon rules. Each session's equity, 2% line, 99 Club
  breaks, number-running stop, practice and the week's focus, then every trade with all 8 pillars and why each held or
  broke, the plan and reflections. IST, net of charges.
- **Today card:** this week's focus (set in last week's review).
- **Settings › Export and backup:** Download CSV (every trade with its 8 pillars, net ₹, R, reflections; Excel-friendly);
  Download backup (.zip: the whole journal and every picture); Restore from a backup (adds only what's missing: trades,
  reviews, practice days, pictures; nothing already there changes; logged in the security log).
- Routes: `POST /api/journal/review`, `GET /api/journal/export.csv`, `GET /api/journal/backup.zip`, `POST /api/journal/restore`.

Changed
- A reflection (did right / wrong / lesson) on a trade stamps `reviewedAt`.
- The Journal's tabs: Trades · Insights · Review · Settings.

Tests
- `tests/jreview_test.py` (25 checks, new): review rules, the Telegram summary posted then edited (and re-posted when the
  message is gone), reflections, the CSV, backup and restore (into an empty journal; again into the same one: nothing
  twice, nothing changed), a bare journal.json.
- `tests/jinsights_flow.js` (40 checks, new): Insights and its filters, the review saved and posted / edited in Telegram,
  the walk-through, the calendar, Copy for Gemini (day, rules, week, one trade, clipboard), the Today focus, CSV, the backup
  zip and restoring it, the phone.
- `tests/fake_telegram.py`: editMessageText.
- Run on this version: routes, ctype 47, journal 58, jshots 43, jreview 25; browser: journal 43, jshots 45, jinsights 40
  (twice), mobile 61, live 22. The other suites passed on v0.27.0 an hour earlier; this release changes only the Journal
  page, its routes and one script tag in index.html.

## v0.27.0 — 1 Nov 2026 — Journal pictures and the Telegram backup; P&F trend lines fixed

Added
- **Journal pictures** (roadmap item 4, second of three releases), on every trade's card and in the audit form:
  - **Drawn on the server at entry and exit** from your own Fyers candles (new `helper/jshots.py`, Pillow): the entry and any
    adds, first stop, last stop, target, exit, the trade shaded by its result, net ₹ / R / charges; 1280×720 PNG; works with no
    page open. Timeframe (5m) and candles (120) in Journal › Settings › Pictures. A failure (Fyers not answering) is shown on
    the card and tried twice more; **Draw at entry / Draw at exit / Draw again** by hand (also for older trades).
  - **The open chart's own picture** (LWC `takeScreenshot`, with indicators and drawings, a header with contract, timeframe
    and time) when a chart of that contract is on screen as the trade opens or closes; one per timeframe (a second page
    sending the same one is ignored). **📷 on the chart bar** adds this chart's picture to the trade on this contract.
  - **Your own pictures:** ＋ Add pictures, paste (Ctrl+V) and drag-and-drop; PNG / JPEG / WebP / GIF up to 10 MB; each
    labelled by timeframe (1m … 1M, custom like 7m, or Context).
  - **The viewer:** chips, ← / → and swipe, label, Full size, Download, Draw again, Delete (two taps); full screen on the phone.
  - Small copies (JPEG) for the list; 📷 n on each trade's row; space used in Settings.
- **Telegram backup copy** (Journal › Settings › Pictures): every new picture to the journal's chat / channel as a silent file
  with the trade in its caption, using the bot in Settings › Telegram alerts; deleting a picture deletes its copy; failures
  shown (✈!) and retried (1, 5, 15, 60 min); **Send the pictures not in Telegram yet**; **Send a test**. At start-up, copies
  that didn't go before a restart are sent (only pictures from after the backup was turned on).
- Routes: `GET /api/journal/shot`, `POST /api/journal/shot/add` (the body is the picture), `/shot/edit`, `/shot/draw`,
  `GET /api/journal/pictures`, `POST /api/journal/pictures/tg`. Socket message `{"jshot": {id, phase, s}}` asks open charts.
- `helper/fonts/` (DejaVu Sans Mono, with its licence) so the server's pictures have ₹ and the same look on any server.
- `requirements.txt`: **Pillow** (the update's install step adds it on the server).

Fixed
- **P&F 45° trend lines ran on after price crossed them** (reported 1 Nov with a screenshot): after a break, the next line
  started at the plain highest top / lowest bottom since the broken line began, which columns before the break could already
  have crossed, and the check only looked at columns after the break. So a line was drawn through price, and in a sideways
  stretch a pair of lines was re-made from the same column every column (the "▲ break" / "▼ break" labels marching off in a
  "<", as in the screenshot). Now the new line starts at the top (X column) / bottom (O column) whose 45° line no later column
  has crossed (the most of high + column / least of low − column), so no line is ever drawn through a column before its break.

Changed
- `journal.json` trades carry `shots` (and `shot_err` while a server picture fails); journal settings carry `shots`.
- The journal's saves take its lock (the pictures' worker thread changes trades too).

Tests
- `tests/jshots_test.py` (43 checks, new): settings, labels, picture types, captions, drawing at entry / exit (a stop on the
  future, an entry past the last candle), trades on paper engines (one picture at entry and exit, an add doesn't draw again,
  open charts asked, failure recorded and retried, Draw again replaces), one chart picture per timeframe, the Telegram copy
  (silent PNG document with the caption, delete deletes it, a refused chat retried, start-up only since the backup began,
  sending the rest).
- `tests/jshots_flow.js` (45 checks, new): the four pictures of a trade with its chart on screen, served full size and small,
  the card and viewer, Draw again, ＋ Add / paste / drop, refusals (not a picture, over 10 MB), delete, the audit form, chart
  hidden = server only, 📷, Settings › Pictures, the Telegram copy end to end, the phone (strip, viewer, swipe, 📷).
- Every suite in tests/README.md passed on this version (Python: routes, ctype 47, squareoff, feedcheck, feed, candles,
  journal 58, jshots 43, alerts 57, live 61; browser: github_upload 25, jshots 45, journal 43, live 22, charttypes 92,
  pine_compat 121, indicator_settings 37, navigation 36, watchlists 16, drawings 78, layouts 31, multichart 43, telegram 33,
  mobile 61; security_flow run first).
- `tests/ctype_test.js`: P&F lines on random walks (none crossed before its break, each broken where marked, none made twice);
  the hand-worked line case corrected (column 2's line was crossed by column 4's equal top).
- `tests/fake_telegram.py`: sendDocument (multipart) and deleteMessage; `/_docs`, `/_deleted`.
- `tests/routes_check.py`: the new routes.

## v0.26.3 — 1 Nov 2026 — Full changelog in the release commit

Changed
- Release to GitHub (`tools/github_upload.html`): the commit message is now the title line ("v0.26.3: …") **plus this
  version's whole CHANGELOG.md entry** as the commit's description, so GitHub's history carries the full notes (asked 1 Nov:
  "the message is not detailed like the ones you gave me before"). It's the entry for the zip's VERSION (else the top one),
  filled in as soon as the zip is read; the box is bigger and still editable.

## v0.26.2 — 1 Nov 2026 — Release instructions for the organization's token

Changed
- README › Releasing a new version: the token is made with **Resource owner = Sic-Parvis-Magna-Achaggi** (the repo is the
  organization's); how to allow fine-grained tokens in the organization's settings, approval ("Pending"), what "not found"
  and "can't do this" usually mean, and renewing an expired token.
- Release to GitHub (`tools/github_upload.html`): the same hint under the token box; its "not found" / "can't do this"
  messages name the usual causes (token made for your username, not approved yet, no Contents: Read and write).
- `docs/Project_Instructions.md` (paste into the claude.ai project): whole-repo zips only, released with the tool; new chats
  start from GitHub's Download ZIP; the GitHub token never goes into chat; Journal in the page list.

## v0.26.1 — 1 Nov 2026 — Release to GitHub without the 100-file limit

Added
- `tools/github_upload.html` (**Release to GitHub**): one page, opened from disk, that puts a release zip into the repo as
  **one commit** through GitHub's API, so the 100-file limit of dragging into github.com doesn't apply (the repo has 110
  files now). It reads the zip in the browser (no library), compares each file's git id with the branch, and sends only what
  changed; shows changed / new / only-on-GitHub before you commit; deletes nothing unless ticked; keeps file modes; refuses
  to overwrite a commit made meanwhile (fast-forward only); asks before uploading a zip older than GitHub's VERSION; waits
  out GitHub's rate limit. The token (fine-grained, this repo, Contents: Read and write) stays in the page, or on your
  device if you tick Remember. How to make the token: README › Releasing a new version.

Tests
- `tests/github_upload_flow.js` (25 checks, new) with `tests/fake_github.py` (a fake GitHub git-data API with CORS): the page
  opened from file://, a Download-ZIP style folder, the right files found and sent (blob ids equal `git hash-object`),
  one commit on top, modes kept, delete only when ticked, nothing to upload afterwards, older zip, branch moved meanwhile,
  bad token, rate limit, the token not kept unless asked.

## v0.26.0 — 1 Nov 2026 — The journal (Octagon), first step

Added
- **Journal page** (roadmap item 4, first of three releases): the Octagon trade journal inside the app, saved on the server
  per user (`u/<user>/journal.json`), on every device. New tab **Journal** (phone: More › Journal).
  - **Trades arrive on their own** from every paper and live account: when they open, and completed when they close (a live
    position closed in parts is one trade). Past trades (each account's history and the archives of resets and Paper ↔ Live
    switches) were taken in once; they count as claimed reps.
  - **The 8 pillars, word for word**, in an audit form with the live octagon: Direction & regime with the Pillar 1 checks,
    market regime, bias and KE; Wait state; Execution and its faults; numbers running; payout pressure; Zen Temple (a breach
    makes Execution wrong); Target. Setup tags with suggestions, plan, review.
  - **The session engine** ported from Octagon (one IST trading day per account): the 2% trailing drawdown from the session
    peak, the 99 Club break (3 wins in a row or 3 wins of 2R+ → 20 minutes), numbers running; Pillars 4, 5 and 8 worked out.
  - **Lockouts refuse new orders**, each with its own switch (Journal › Settings): after the 2% lockout and after the session
    ends (numbers running, or **Hold to end today's session**) until the next trading day; during the 99 Club break. A
    lockout that starts cancels waiting entry orders (switch). The ticket's preview says why; a pill in the top bar shows it.
    Closing, BE, trailing and stops are never blocked.
  - **Today card** (the session's octagon, P&L, room before the 2% line, 99 Club count, ground-state practice and its
    streak), **Reps** (every closed trade, hold to claim, milestones), the **5% execution block**, stats strip (net, win
    rate, profit factor, average R, expectancy, charges, drawdown) and the balance / P&L curve.
  - **Filters** (period by close time IST, account, contract, side, octagon, regime, setup tags any / all, search), saved in
    your settings. **Remove from journal** / bring back.
  - **Settings:** Octagon's numbers (2%, 20 min, 3 wins, 2R, 2.5R, 5%, rep milestone, reps before), the lockout switches,
    each pillar's text and the Pillar 1 checks (Original puts your text back).
- Money and R in the journal are the app's net figures: net ₹ after every charge, R = net ÷ the net risk at the first stop
  (Octagon used points before charges).
- Routes: `GET /api/journal`, `POST /api/journal/trade`, `/audit`, `/claim`, `/hide`, `/practice`, `/settings`, `/end`.

Changed
- `Paper` engine: a journal hook on every fill and close, a journal check in `guard_new()` (so the preview and PLACE show a
  lockout like any other guard), `jlock` in the snapshot.

Tests
- `tests/journal_test.py` (58 checks, new): the server's port against **Octagon's own code** (`tests/fixtures/octagon_core.js`,
  extracted word for word from octagon_journal.html): 60 random sessions, every pillar state and every session figure equal
  (seeds 1-7 checked); then the journal on real paper engines: trades arriving, past trades and archives, live parts merged,
  each lockout refusing orders and its switch, waiting orders cancelled, audit rules, preview, claim, hide, settings.
- `tests/journal_flow.js` (43 checks, new): the Journal page in a browser, the audit form, claiming, filters, lockouts on a
  fresh account (2% line, ending the session cancels a waiting order), the header pill, pillar text, reload, the phone.

## v0.25.0 — 1 Nov 2026 — Telegram alerts for live trades

Added
- **Telegram alerts** (roadmap item 3): a message on your phone when the server stops looking after a live trade. Only
  while a Live account has a position or an order at Fyers. Settings › Telegram alerts (admin):
  - **Your own bot** (from @BotFather; the journal's bot works too): the token is checked with Telegram, saved encrypted
    and never shown again (2FA code to change it). **Find my chat** lists the chats that messaged the bot (or a channel /
    group it's in); **Send a test message**.
  - **The server isn't responding** for 30 s (settable): a **watchdog service of its own** (`fyers-watchdog`) asks the
    helper every 5 s, so it works when the helper has crashed or hung. The message lists each live trade with its stop at
    Fyers (or "no stop at Fyers: protect it in the Fyers app"), any entry order waiting at Fyers, and what's paused; a
    reminder every 10 min (settable, 0 = once); "answering again" when it's back. Silent outside market hours.
  - **A live warning lasting 30 s:** no stop at Fyers, a refused stop change, no Fyers login, a "check Fyers" alert; "Sorted"
    when it clears. Only in that contract's market hours.
  - **No prices for an open live trade for 60 s** in its market hours (after it had prices that day).
  - **If the whole server goes down** (optional): a free Healthchecks.io check. The watchdog pings it every minute while a
    live trade is open and pauses it when you're flat (with its API key), so its own Telegram alarm only fires during live
    trades.
  - The watchdog's state (running / not) in Settings, and **Telegram alerts: on / not set up** on the Account page's Live card.
- `GET /api/ping` (no login; says only that the helper answers), `/api/telegram`, `/api/telegram/settings`,
  `/api/telegram/chats`, `/api/telegram/test`.
- Server: `server/systemd/fyers-watchdog.service`; `install.sh` installs, enables and restarts it with the helper (the
  automatic update does this on its own).

Changed
- `LiveEngine.live_problems()` gives each live warning a key (the page's warnings are word for word the same).

Tests
- `tests/alerts_test.py` (57 checks, new): the helper's checks and heartbeat on a real Live engine against the fake Fyers;
  the watchdog on a fake clock (30 s, reminders, back, a hung loop, no live trade, no stop at Fyers, silent hours,
  switched off); the outside heartbeat (pings, pause, resume); the watchdog as its own process (a failing, then a closed,
  helper); `/api/ping`.
- `tests/telegram_flow.js` (33 checks, new): Settings › Telegram alerts end to end in a browser, the Live card, the phone,
  and the real watchdog with the real helper frozen (SIGSTOP) during a live trade: the message came 21 s after the freeze
  with 15 s set.
- `tests/fake_telegram.py` (new): a fake Telegram Bot API and Healthchecks.io; `mock_server.py` starts it on :8767.
- Timing with the defaults (30 s): the message came 33 s after a crash and 38 s after a hang.

## v0.24.1 — 1 Nov 2026 — Sync in multi-chart layouts

Added
- **Sync the charts of a grid** (roadmap item 6, second step), each a tick box in the Grid menu, saved with the layout:
  - **Contract:** a contract opened from the watchlist / Find opens on every chart (each keeps its timeframe and type).
  - **Timeframe:** a timeframe picked on any chart goes to all of them.
  - **Date range:** scroll or zoom one chart and the others show the same stretch of time (matched by time, so it works
    across timeframes).
  - **Crosshair** (from v0.24.0).
  Ticking contract, timeframe or date range lines every chart up with the active one at once.
- Phone: contract and timeframe sync apply to all the layout's charts (the one shown and the others, for when you switch).

Fixed
- A click in a chart of the grid now closes the menus of the page around it (Grid, Layouts...); before, the click never
  reached them.
- **A layout change could be lost** (since v0.23.0): a change made while the layout's previous save was on its way to the
  server (e.g. a chart reporting its new timeframe, a sync option) was dropped when the server's answer came back. The
  open layout now keeps the page's own copy. Found by the full test run (3 multi-chart checks); a new check holds each
  save for a second to make it happen every time (it fails on the old code).

Tests
- `tests/layouts_flow.js` (31 checks, was 30): a change made while a save is on its way reaches the saved layout.
- `tests/mobile_flow.js`: the SL-drag check waits up to 3 s for the order sheet to catch up with the last tick (it failed once
  in the full run when the fake feed moved 4 points between the sheet's redraw and the read; 61/61 on re-runs).
- `tests/multichart_flow.js` (43 checks, was 33): the sync options; contract sync (ticking it, then the watchlist); timeframe
  sync (ticking it, then a timeframe picked on another chart); date-range sync (zoom and drag one chart, the others follow);
  sync off; a chart click closing the Grid menu; timeframe sync on the phone.

## v0.24.0 — 1 Nov 2026 — Multi-charts in a layout

Added
- **Several charts in a layout** (owner, 31 Oct; roadmap item 6, design agreed 1 Nov). The Grid button on the chart bar
  (next to ▦): 1 chart, 2 side by side, 2 stacked, 3 (one big on the left, two on the right), 2×2.
- **Each chart is fully its own**: contract, timeframe, chart type, indicators and Pine scripts, its own bar (timeframes,
  chart type, ƒx, ⚙, ✎ for its drawing toolbar, ⛶), its contract's drawings, the on-chart BUY / SELL tool and your
  positions' lines. Saved in the layout, chart by chart; your single-chart settings are left alone.
- **The active chart** (click it; blue border, its number highlighted) is what the watchlist, Find, the option chain,
  the trade panel's BUY / SELL and the Pine Editor's Add to chart act on. The trade panel shows its contract.
- **Crosshair sync** (on by default, Grid menu): moving over one chart moves the crosshair on the others to the same
  time (on the same contract with the price too; past the last bar, by the bar count).
- A drawing made on one chart shows on every chart of that contract.
- **⛶ (or F) in a chart** shows it big in the grid; again to go back.
- A new chart starts as a copy of the active one (its drawing toolbar closed). Charts left out of a smaller grid stay in
  the layout and come back when you widen it again. Back to 1 chart: chart 1, on the page's own chart.
- **Phone:** one chart at a time; buttons 1-4 above the chart pick which, and changes save into that chart.
- Contract, timeframe and date-range sync come next (v0.24.1).

Changed
- The page waits for all its scripts before it starts (layouts and the grid hook into the start-up).

Tests
- `tests/multichart_flow.js` (33 checks, new): the Grid menu; 2×2 with four charts loading; the active chart taking the
  watchlist, BUY and the Pine Editor; timeframe / chart type / indicators per chart, saved per chart; single-chart
  settings untouched; crosshair sync on and off; a drawing on two charts of a contract; ⛶; a reload; 3 and 2 stacked;
  charts kept in a smaller grid; back to 1 chart; the phone's chart buttons.

## v0.23.1 — 1 Nov 2026 — Angles on drawings

Added
- **Angles** (owner, 1 Nov). **Show angle** on trend line, ray, extended line, arrow, parallel channel and regression trend
  (∠ on the selected line's bar, or its settings): an arc from the horizontal at the first point, with the angle and the
  slope beside it, e.g. "29.2° · +0.73 / bar". A new **Trend angle** tool (Lines) always shows it.
- The degrees are the angle as you see it on screen, like TradingView, so zooming or stretching the price scale changes
  them; the slope in points per bar (per column on P&F, per brick on Renko) doesn't change with zoom. On P&F the angle
  is in boxes and columns, the P&F convention: a line rising 1 box per column reads 45°.

Tests
- `tests/drawings_flow.js` (78 checks, was 71): the Trend angle tool, its angle against the line on screen and its slope,
  zooming changes the degrees but not the slope, ∠ on a trend line and its settings, 45° on P&F.
  The "SL line wins over a drawing" check now waits for the new trade's SL line to be on the chart (it failed once on
  fresh test data, when the preview took longer than 0.9 s; 3 runs after: 78/78).

## v0.23.0 — 1 Nov 2026 — Saved chart layouts

Added
- **Saved chart layouts, per user** (owner, 31 Oct; roadmap item 5). The **▦** button on the chart's top bar shows the
  open layout; its menu opens, makes (＋ New layout: a blank chart on the same contract), copies (⧉: the chart as it is
  now), renames and deletes layouts (✕ twice; the last one stays). Your chart as it was becomes "Layout 1".
- A layout holds the contract, timeframe, chart type (with its Renko / range / P&F sizes), indicators and Pine scripts
  with all their settings and pane heights, chart settings (colours, lines, Volume, timer...), the drawing toolbar on /
  off and the indicator read-outs collapsed or not. **Drawings stay with the contract**: every layout on GOLDPETAL shows
  GOLDPETAL's drawings.
- **Saves itself as you change the chart**, like TradingView. Or untick "Save changes automatically" in the menu to save
  by hand: ● on the button means not saved; Save (or **Ctrl+S**); leaving a layout with changes asks Save / Don't save /
  Cancel.
- Saved on the server: every device opens the same layouts and the same one open. On the phone the ▦ button is on the
  chart bar.
- Safe against a page closed mid-change: a layout switch reaches the server at once (not after the usual 0.6 s), what's
  still waiting is sent as the page closes, and on opening the saved layout is what counts (a chart that disagrees
  with it, e.g. after a switch on another device, opens the layout as saved; never the other way round). That check
  happens while the page starts, before the chart is drawn, so nothing you do in the first seconds is undone.

Changed
- The chart bar's buttons sit closer (6 px apart, was 12) to make room for ▦; on a narrow chart ▦ shrinks to its icon
  before any timeframe button drops out (the name is in its tooltip and menu).

Server
- `GET / POST /api/layouts` (per user, `u/<user>/layouts.json`; one layout changed at a time, so two devices editing
  different layouts don't overwrite each other; 50 layouts, 200 KB each). In `tests/routes_check.py`.

Tests
- `tests/layouts_flow.js` (30 checks, new): "Layout 1" from your chart, auto-save, a new blank layout, each layout's own
  contract / timeframe / chart type / indicators coming back on a switch, rename (a taken name refused), copy, drawings
  per contract, delete (twice, never the last), saving by hand (●, the question, Don't save, Save, Ctrl+S), a reload, a
  page closed mid-switch, a second device, the phone.

## v0.22.0 — 1 Nov 2026 — Drawing tools and the measure tool

Added
- **Drawing tools, like TradingView's** (owner, 31 Oct; roadmap item 9). A toolbar down the left of the chart:
  - Lines: trend line, ray, extended, horizontal line and ray, vertical, cross line, parallel channel, regression trend,
    pitchforks (Andrews, Schiff, modified Schiff).
  - Fibonacci and Gann: retracement, trend-based extension, fan, time zones, Gann fan, Gann box (levels, colours and
    fills editable).
  - Shapes: rectangle, ellipse, triangle, path, brush. Text, note, callout, price label, arrows and arrow marks.
  - Price, date, and date & price ranges.
  - Magnet (weak / strong; Ctrl flips it while drawing), stay in drawing mode, lock all, hide all, a list of the drawings
    on the contract, remove all (click twice).
  - Editing: select, handles, move (Ctrl+drag copies), a bar for colour / fill / width / style / text / lock / clone /
    delete, a settings dialog (double-click), a right-click menu, Del, Ctrl+Z / Ctrl+Y, Ctrl+C / Ctrl+V (also to another
    contract), and TradingView's Alt+T / H / J / V / C / F and Alt+Shift+R. The style you pick becomes the tool's
    default.
  - Saved per contract on the server, shown on every timeframe and every chart type (P&F, Renko too: a point sits on the
    bar, brick or column its time falls in). The trade manager's own lines still win over a drawing on them.
- **Show / hide the drawing toolbar** (owner, 1 Nov): ✎ on the chart's top bar, the D key, or Chart settings › Drawing
  toolbar; saved on the server. Hiding the toolbar doesn't hide the drawings.
- **Measure tool, MT5 + TradingView** (owner, 31 Oct; roadmap item 7). Shift+click / Shift+drag, a middle-button drag,
  or the ruler button. A green / red box with the change in points, %, ticks (boxes on P&F, bricks on Renko), bars, time
  and volume, plus the **net ₹ for your lots** after every charge (from the server, the same charges code as trades;
  Chart settings › Lots for the measure) and **R against your trade's current stop** on that contract.
- **Long / short position drawings** for looking back: entry, stop and target with net ₹ and R:R, and which was hit
  first and when, checked on the timeframe's real candles (a candle that opens past a level exits at its open; a candle
  that reaches both is marked and counted as the stop).
- **Accurate coordinates in each drawing's settings** (owner, 1 Nov): the settings dialog has tabs (Style · Text ·
  Levels · Coordinates). Coordinates lists every point: its price (shown and saved on the tick) and its date and time
  (Indian time), all editable, with the bar each time lands on in this chart shown as you type ("on the bar of 31 Oct 26
  23:10 (5m bar holding it)"). A position drawing lists entry, target, stop and its right edge. Wrong values are refused
  with a message and nothing changes (a long's stop above its entry, a date that isn't one). Right-click › Coordinates…
  opens it directly; Ctrl+Z undoes it.
- Phone: ✎ opens the tools as a strip above the chart; draw with a finger, tap a drawing to select it.

Server
- `GET / POST /api/drawings` (a contract's drawings, per user: `u/<user>/drawings/`; 500 a contract) and
  `POST /api/measure` (net ₹ of moves, nothing placed). Both in `tests/routes_check.py`.

Tests
- `tests/drawings_flow.js` (71 checks, new): toolbar show / hide (saved), drawing by drag and by clicks, magnet, select,
  handles, move, undo / redo, delete, colour and width as the default, settings, coordinates (shown, typed, refused,
  undone; a position's), lock, hide all, text, path, brush,
  right-click menu, clone, the list, saved on the server and after a reload, per contract, copy to another contract,
  timeframes, every chart type, the measure (Shift-drag, middle button, ruler; net ₹ checked against gross − charges; R
  with a long open), the position drawing's outcome against the candles, the SL line winning over a drawing, and the
  phone (✎ strip, finger drawing, tap to select).

## v0.21.0 — 1 Nov 2026 — Multiple watchlists

Added
- **Several named watchlists** (owner, 1 Nov). A switcher at the top of the Watchlist tab (on the phone: Quotes ›
  Watchlist): pick a list; **＋** makes a new one; **⋯** renames it, moves it up or down, or deletes it (tap twice; the
  last list stays). Up to 10 lists of 30 contracts (a list held 15 before). **+** in Find (and right-click in the option
  chain) adds to the list on screen. Saved on the server: every device opens the same lists, on the list you last had.
  Your watchlist from before is the first list, "Watchlist".
- Only the list on screen is streamed (with the chart and your trades). A page now streams up to 40 contracts (was 20);
  the server stays inside Fyers' Standard limit of 100 on the price socket, and the contracts of open trades and orders
  always come first (before, the cut was alphabetical).
- When Fyers' socket is down, quotes are polled 50 symbols a request (Fyers' maximum), so more than 50 contracts poll
  too.

Tests
- `tests/watchlists_flow.js` (16 checks, new): the old watchlist becomes "Watchlist"; new, rename, a taken name,
  move, delete (two taps, not the last); + in Find adds to the list on screen; only that list is streamed; 30 a list;
  a reload brings the lists back; the phone's Quotes tab.
- `tests/feed_test.py` (6 checks, new): 40 a page, at most 95 on the socket with trades first, polls of 50.

## v0.20.9 — 1 Nov 2026 — Roadmap: live candles, multiple watchlists, seconds / tick charts (docs only)

Docs
- Roadmap item 10 (keep the candles the app saw live): design agreed. 1-minute candles from the live feed for every
  watchlist, positions / orders and open charts, used for a day only when the data check fails and the recording has
  no gaps; kept 1 year by default (settable on the Account page).
- Item 11, multiple watchlists (right after item 10): the server records all lists.
- Item 12, seconds and tick charts from the live recording (Fyers' own seconds candles need Prime): decided after
  Monday's order-flow check.
- Fyers Standard allows 100 contracts on the price socket (5,000 on Prime), noted in the handoff. No code changes.

## v0.20.8 — 1 Nov 2026 — Data check: a warning when the candles disagree with Fyers' live figures

Added
- **Data check on every chart** (owner, 1 Nov: "how can I trust this data?"). The chart's candles (Fyers' history) are
  compared with Fyers' live figures for the same session: the day's open, high, low and volume, and once the market is
  closed (weekends too) the last price. When a price is off by more than 0.5% (at least 10 ticks), or the volume by
  more than 5x, an amber note shows at the bottom of the chart; tap it for candles vs Fyers live side by side and
  **Load again**. A volume gap equal to the contract's lot / multiplier is a unit difference and isn't flagged.
  Friday's GOLDPETAL would have shown: open 14,163 vs ~14,319, low 14,057 vs ~13,700, last price 14,201 vs 13,960,
  and 319 lots vs the real day's volume. Trading isn't affected (fills, stops and P&L use the live prices).
  Chart settings › **Check candles against live prices** (on by default).
- Polled quotes (when Fyers' socket isn't streaming, e.g. weekends) now carry the day's open, high, low and previous
  close as the socket does, so the check and the Book tab have them then too.

Tests
- `tests/navigation_flow.js` (36 checks): matching figures (and small differences) give no warning; a Friday-like
  day flags open, low, last price and volume; a 100x volume on a ×100 contract isn't flagged; nothing is compared while
  the market is open before today's candles arrive, without day figures, or for volume on an index; the note, its
  box, the setting, and the note clearing. The mock no longer sends a fixed day open / high / low.

## v0.20.7 — 1 Nov 2026 — A day Fyers corrects later reaches your charts; v0.20.6's explanation corrected

> **Correction (v0.30.1):** the "Corrected" note below is itself wrong. Fyers didn't rewrite the day: requests
> without cont_flag still get Fyers' continuous series (only cont_flag=0 turns it off), and Fyers' own chart had its
> Continuous Futures setting on. v0.30.1 sends cont_flag=0.

Changed
- **Each fetch of new candles also takes the week before again** (still one Fyers request), and the browser takes the
  last 7 days from the server each time a chart opens (was 3). Fyers sometimes rewrites a finished day: if it corrects
  one later, the correction now replaces the saved candles on the server and in every browser. Before, only the
  latest saved day was ever fetched again.

Corrected (what v0.20.6 said)
- v0.20.6 blamed `cont_flag=1` (Fyers' continuous series) for GOLDPETAL NOV's 30 Oct. That was wrong. Fetched
  without it, Fyers still sends the thin day (a few lots, trading until about 17:00, then 14,201 to the close), and
  **Fyers' own chart shows the same** - while Fyers' live prices for the contract are 13,951 / 13,958 and the real
  Friday fell to 13,960 on heavy volume (which Fyers' history also sent during Friday). Fyers rewrote the day after
  the close; it's Fyers' data, reported to Fyers. Dropping cont_flag still stands: with it, 29 Oct showed ~165,000 lots
  that Fyers' own chart doesn't have; without it the app's candles match Fyers' charts.

Tests
- `tests/candles_test.py` (8 checks): a day Fyers corrects 3 days later is replaced on the next fetch (fails with the
  re-check off).

## v0.20.6 — 1 Nov 2026 — Charts show the contract you opened (not Fyers' continuous series)

> **Correction (v0.20.7):** the cause given below for 30 Oct is wrong. Fyers rewrote that day after the close; its own
> chart shows the same thin day. Dropping cont_flag still makes the app's candles match Fyers' charts (see v0.20.7).

Fixed
- **A futures chart could show another contract's candles** (owner, 1 Nov: GOLDPETAL NOV on 30 Oct looked different on
  2m and 15m, and in a private window). Every history request carried `cont_flag=1`, Fyers' "continuous data of futures
  and options", which fills a date with whichever contract Fyers maps there. Fetched again after Friday's close,
  GOLDPETAL NOV's 30 Oct came back as the expiring OCT contract: 319 lots all day on 15m (vs 165,000-180,000 on the
  days before), last trade at 16:58 (expiry-day trading ends at 17:00), then its settlement price 14,201 with no
  volume to the close. The browser still had Friday's real NOV candles, so the private window (the server's copy)
  and your usual window disagreed. Now:
  - history is asked for the exact contract (no cont_flag);
  - a day fetched again from Fyers replaces that whole day on the server (a candle Fyers no longer sends leaves
    nothing behind; an empty answer changes nothing);
  - once, on the first start of this version: the futures / options candles saved on the server are dropped (stocks
    and indices stay), and this browser's saved copies are deleted, so each chart loads again from Fyers when opened
    (one or two requests per chart, inside the request budget);
  - each time a chart opens, the browser takes the last 3 days from the server (the server's own copy, no Fyers
    request), so a day the server corrects reaches every device.

Tests
- `tests/candles_test.py` (7 checks, new): no cont_flag; the clean-out (futures / options dropped once, stocks kept);
  a day fetched again replaces the saved day; an empty answer keeps it.
- `tests/navigation_flow.js` (27 checks): a wrong candle 2 days back in the browser's copy is corrected from the
  server; the old browser store is deleted. The mock answers a request with cont_flag with a marker price and logs it
  ("CONT_FLAG ASKED"); none in a full run.

## v0.20.5 — 1 Nov 2026 — Empty after-close candles left off the chart

Fixed
- **Empty candles at the closing price after MCX closes** (owner's screenshot, GOLDPETAL 2m, 30 Oct). After 23:30
  Fyers' history had candles at 14,201 with no volume until 23:55, while the last trade was 13,960 (most likely
  the exchange's closing price, not a trade). They stretched the price scale (candles squashed to the bottom), made the
  48-box P&F column at the end of the day, and fed indicators and Pine scripts a price no one traded at. A candle with
  no volume whose prices differ from the last trade's is now left out: on the chart, P&F and every chart type,
  indicators, and Pine (request.security too). Quiet candles at the last price and indices (no volume at all) stay.
  Chart settings › **Hide no-trade candles** (on by default) shows Fyers' candles exactly as sent when unticked.
  The saved candles on the server are not changed.

Tests
- `tests/navigation_flow.js` (25 checks): the mock's CRUDEOIL26DECFUT gets empty candles at 6,250 after 23:30 each
  day; they're hidden, the scale isn't stretched, the setting shows / hides them, P&F and request.security() agree.

## v0.20.4 — 1 Nov 2026 — P&F readable when zoomed out

Fixed
- **P&F turned into thin lines when zoomed out** (reported 1 Nov, GOLDPETAL 2m, 5 x 3). Zooming out puts more columns
  on screen, so the price range grows and each box gets shorter; under 4 px a box, the chart drew each column as a 1-2 px
  line. Now every zoom shows X's and O's: square while there's room; zoomed out, each X / O keeps the column's full
  width and gets flatter (a column still reads as a stack of X's or O's); when a box is under 1.8 px, X columns are
  solid bars and O columns hollow ones, in the up / down colours.
- The order bubble (v0.20.3) on a 360 px phone: "2.04R" could be cut off; the bubble is a little tighter there.

Tests
- `tests/navigation_flow.js` (19 checks): the three looks, at a 2.8 px box, a 0.8 px box and back to normal.

## v0.20.3 — 1 Nov 2026 — Phone: the order shrinks to a bubble

Added
- **The order as a bubble (phone layout)** (owner: "minimise it to a bubble so I can see the full chart"). After
  SELL / BUY, the order sheet shrinks to a bubble in the SELL / BUY bar's place, so nothing covers the chart. It
  shows the side, lots, order type and product, the net ₹ at the stop and the target with R (net of all charges, whole
  rupees like the chart's zone labels; the sheet keeps the paise), or why the order can't go. **PLACE** in the bubble
  places it; **✕** cancels; tapping the bubble brings the full sheet back. Nothing about the trade changes either way.
- It shrinks when you touch the chart (so you can drag the SL / TP lines with the whole chart in view), tap ⌄ in the
  sheet's header, tap the grip, or swipe the header down. The bubble updates live as you drag.
- **SELL / BUY opens:** the order sheet (as before) or straight to a bubble. Set in the size sheet (the middle of the
  SELL / BUY bar), saved on the server.
- Turning the phone sideways with the bubble up goes full screen as usual; the bubble stays at the bottom.

Changed
- The grip used to fold the sheet to its header and PLACE (still half the screen); it now shrinks it to the bubble.

Tests
- `tests/mobile_flow.js` (61 checks, was 44): the bubble, the chart left uncovered, dragging the SL line updates the
  bubble's ₹, back to the sheet, chart touch / swipe, PLACE and ✕ in the bubble, "opens as a bubble" saved on the
  server, landscape and a 360 px phone, LIVE on the bubble. The test now clears the remembered stop distances first
  (each run widened them until the 2% risk cap blocked the test trade).

## v0.20.2 — 1 Nov 2026 — Go to a date; readable P&F

Added
- **Go to** (calendar button at the chart's bottom left, or Alt+G): a date, and a time on intraday charts. Older
  candles load first if needed (as far back as Fyers has them); the chart centres on that candle and the crosshair
  marks it. Before a contract's first candle: the oldest one, with a note.
- **»** at the bottom right whenever the latest candle is off screen: back to now, keeping your zoom.

Fixed
- **P&F looked tiny at the default zoom.** It opened with 6 px columns; it now picks a column width (12-40 px) that
  makes the X's and O's as big as they can be (up to 14 px) for the prices on screen, with a 4-column right margin.
- **P&F on a day chart drew thin lines instead of X's and O's.** The fixed box was saved per contract, so the
  5-point box set on 2m also applied to 1D, making columns of 100+ boxes too small to draw (under 4 px a box, the
  chart draws each column as a line). The box is now saved per timeframe; a per-contract box saved earlier still
  applies except where a typical bar spans more than 8 boxes, where the ATR box is used until you set one, and the
  menu says so. A fixed mode with no size now uses the ATR box (it used to fall to one tick).
- Daily / weekly / monthly charts show dates only on the time axis (the crosshair said "05:30").

Tests
- `tests/navigation_flow.js` (16 checks): P&F zoom and right margin, the 1D box, per-timeframe boxes, Alt+G, Go to an
  intraday time 20 days back (older candles loaded), », a date before the listing, a date on 1D.

## v0.20.1 — 1 Nov 2026 — Any script on another timeframe; scripts follow your scrolling

Added
- **Timeframe for every Pine script** (owner: "the MA of a 15M chart on a 2M chart"). Settings › Inputs › Calculation
  has Timeframe and Wait for timeframe closes for all scripts, not only those whose indicator() has timeframe =. The
  list has the usual timeframes plus your own (pinned / custom, e.g. 87m); ones lower than the chart's are greyed out.
- **Bars of history: Auto** (the new default). A script starts on the latest 1,500 bars; scroll back past where its
  line starts and, once you stop, it calculates again over everything the chart has loaded - the same way the chart
  loads older candles. A number still fixes it at that many bars.

Changed
- A new bar still re-runs each script in full in the background (it keeps `var` state and drawings exact; the live
  update alone was shown to drift on stateful scripts); a script slower than 1.5 s per run is re-run at most every
  5 x its run time.

Tests
- `tests/indicator_settings_flow.js` now 37 checks: a plain SMA set to 15 minutes on a 2-minute chart equals the SMA
  worked out from the 15-minute candles (203 values, 0 differ); Auto extends a script from 1,500 to all loaded bars
  when you scroll back; a fixed number still applies.

## v0.20.0 — 1 Nov 2026 — Indicator settings, Pine libraries, older candles

Fixed (reported 1 Nov)
- **Indicator settings were only inputs.** Every indicator now has TradingView's three tabs (⚙ on the read-out, or
  double-click its name): **Inputs** (grouped like the script, `inline` inputs on one row), **Style** (each plot's
  colours with opacity, on / off, plot type, width, line style, price line; levels, fills, backgrounds, shapes and
  bar colours; precision, labels on the price scale, values and inputs in the status line) and **Visibility** (which
  minutes / hours / days / weeks / months it shows on). Volume has its own colours and MA style. Saved on the server;
  Cancel puts things back; Defaults resets a tab.
- **The indicator's own timeframe.** A script whose `indicator()` has `timeframe =` gets **Timeframe** and **Wait for
  timeframe closes** in Inputs and calculates on that timeframe: values on the bar where each higher-timeframe bar
  closes (or filling the bars between, with Wait off), the live bar on the latest. The read-out shows the timeframe.
- **`import` failed ("no import resolver is configured").** Libraries now resolve: `TradingView/ta` is built in (the
  app's own implementation of its functions from the standard formulas, checked against Pine's own ta.supertrend
  etc.; not TradingView's code; `ht()` and `wpo()` not included), and any library you paste into the Pine Editor and
  save answers `import anyone/<its name>/<version>`. A library you don't have gives a message saying what to do. ƒx
  marks saved libraries and doesn't offer to add them to the chart.
- **Older candles were missing.** The chart opened with ~6 days of 2-minute candles and nothing loaded behind them.
  Scroll (or zoom out) to the left edge and older candles now load a step at a time, as on TradingView, keeping your
  view, as far back as Fyers has them (it says when a contract's history starts).
- **Pivot Points: "Not enough data available".** Fyers answers `no_data` for days before a contract was listed; the
  app treated that as an error, so the 2-year daily request Pivot Points makes through request.security failed
  completely. `no_data` is now an empty answer. Other-timeframe candles also get 90 s (was 15 s) to arrive; if they
  don't, the read-out or the error says why and the script retries in 30 s (up to 3 times).

Added
- `/api/history` takes `until` (only candles before that time: the chart's scroll-back).
- `web/indset.js` (the settings dialog), `web/pine_libs/TradingView_ta.pine` (the built-in library).
- Tests: `tests/indicator_settings_flow.js` (31 checks: history scroll-back and its end, daily candles across a
  listing date, Pivot Points Standard on 2m, imports, your own library, the indicator timeframe with and without
  gaps, Style, Volume style, Visibility, saved after reload); two scripts added to the Pine battery (an import, an
  indicator timeframe), passing on every chart type; the mock server now "lists" contracts 200 days back and answers
  `no_data` before that, as Fyers does.

## v0.19.0 — 1 Nov 2026 — The phone layout

Added
- **A separate phone layout, modelled on MT5's mobile app.** Phones get it automatically; a desktop browser never
  does. Five tabs at the bottom: Quotes · Chart · Trade · History · More.
- **Chart tab:** the chart fills the screen between a slim top bar (account and equity, contract and price, a feed
  dot) and a one-tap bar: **SELL (bid) · size · BUY (ask)**. Open positions show as chips above the bar with their
  net P&L.
- **Order sheet** (slides up from BUY / SELL): side, Market / Limit / Stop, price, stop loss and target with − / +
  tick buttons (hold to repeat), target as R, size (Risk % / Risk ₹ / Lots), product, option stops on the option or
  the future, the server's preview (lots, net ₹ at stop and target, BE + costs, charges, margin) and a big PLACE.
  The reason an order can't go (a rule, the margin, the intraday cut-off) shows right above PLACE. The SL / TP lines
  stay draggable on the chart; tap the sheet's grip to fold it away while you drag. It drives the desktop ticket
  itself, so the sizing, rules and charges are identical.
- **Position sheet** (tap a chip or a trade): net P&L, R, LTP, BE + costs, charges paid; SL and target steppers with
  Save / Undo; BE-T and TRAIL for that trade with their R; BE now; open its chart; Close at market (two taps). On a
  Live account it shows the stop at Fyers.
- **Order sheet for pending orders:** move the price, SL and target; cancel.
- **Trade tab:** account figures (balance, equity, open and today's P&L, day / max room, margin, open risk, trades
  and charges today), position and order cards, BE all, Close all (two taps), Cancel all, trailing defaults.
- **History tab:** Today / 7 days / 30 days / All with net P&L, win rate, profit factor, average R and charges; tap
  a trade for every charge. The full History page is a tap away.
- **More tab:** account, rules and charges; switch account; trades table; order book; log; settings; theme;
  desktop layout; log out.
- **Full screen** (⛶): just the chart and the SELL / BUY bar. Turning the phone sideways on the Chart tab does the
  same, as in MT5.
- **Live accounts on the phone:** red LIVE badge and KILL in the top bar, live warnings under it, LIVE on PLACE.
- **Layout switch:** More → Desktop layout, and Settings → Layout (Automatic / Phone / Desktop) to come back.
- **Tests:** `tests/mobile_flow.js` (47 checks on an emulated Pixel 7).

Changed
- Nothing on the desktop page (the phone layout is its own file, `web/mobile.js` + `web/mobile.css`).

## v0.18.0 — 31 Oct 2026 — P&F toolkit, second set

Added
- **Horizontal counts** on the P&F toolkit: at each breakout out of a congestion (at least 5 columns, settable),
  width x box x reversal from the congestion's low / high; shown until reached (HC).
- **Patterns** (each family has its own switch): bull and bear traps, bullish and bearish catapults, high and low
  poles, symmetrical / ascending / descending triangles, turtle breakouts (beyond the last 20 columns, settable),
  anchor follow-through (AFT) with its stop. StockCharts / Dorsey rules; turtle and AFT from Definedge's published
  descriptions.
- Labels are placed by importance and never overlap; the read-out also shows the latest pattern.
- **Tests:** every pattern and both counts, bullish and bearish, on hand-made columns (`tests/ctype_test.js`); on a
  real chart in `tests/pine_compat_flow.js`.

Fixed
- Live: after the kill switch the order ticket always says trading is paused (before, another rule's message could
  show first).

Not included
- Mini tops / bottoms: Definedge doesn't publish the rule.

## v0.17.0 — 31 Oct 2026 — Every indicator on P&F, and the P&F toolkit

Added
- **Every indicator works on every chart type, Point & Figure included** (owner's rule, now permanent): Pine scripts
  get ordinary bars on every type. Bars that don't follow the clock (Renko, range, line break, P&F) close when the
  next one opens, so `request.security`, time and session functions line up with them.
- **P&F: what indicators read** (chart type menu): `close` = the column's middle (default, du Plessis' convention)
  or its last box; open / high / low are the column's own.
- **P&F toolkit** (ƒx → Built in): 45° bullish support and bearish resistance lines, each break marked and the next
  line drawn from the extreme of the move; Double / Triple Top Buy and Bottom Sell at the trigger box, fresh or
  continuation; anchor columns (15+ boxes) with their levels; open vertical counts (boxes × box × reversal, shown
  once active, gone when reached). Each part can be turned off; the read-out shows the trend and the last signal.
- **Tests:** `tests/pine_compat.js` (9 scripts using most of Pine: plots, fills, hlines, shapes, bgcolor / barcolor,
  the ta.* library, drawings by bar index and by time, tables, arrays, maps, functions, var / varip,
  request.security, time / session) and `tests/pine_compat_flow.js` (each on all 10 chart types; the P&F close
  option; a drawing script and the toolkit on a P&F chart). The toolkit's rules in `tests/ctype_test.js`.
- `docs/Project_Instructions.md`: the rule that every indicator works on every chart type, and that the footprint
  is built only from real trades.

Fixed
- An account just switched to Live (or created / restored) starts with the prices of the last few seconds, so an
  order placed straight away isn't refused with "no price yet".

Roadmap
- Added (item 8): a measurement tool, a mix of MT5's ruler and TradingView's measure box, with net ₹ and R.

## v0.16.0 — 31 Oct 2026 — Point & Figure, and the order-flow check

Added
- **Point & Figure** chart type: X (rising) and O (falling) columns, one mark per box; reversal of 3 boxes
  (settable), new column one box back; box by ATR or fixed points per underlying; from closes or highs and lows.
  Volume, indicators and Pine scripts run on the columns (one value per column) like every other type; the chart
  fits the columns to the width; the button shows box × reversal.
- **Order-flow check** (admin, Log page): the server records every price snapshot of chosen contracts (default the
  nearest CRUDEOIL and NIFTY futures, up to 6) to `data/feedcheck/<day>.jsonl.gz` and reports, per contract and per
  hour, how much of the volume arrived one trade per snapshot (exact), how much was merged, the largest merge and
  gaps. It decides whether a real footprint can be built from Fyers' feed (measured from Monday 2 Nov). Routes:
  `GET` / `POST /api/feedcheck`.
- The price feed passes Fyers' last-trade time along with each tick.
- **Tests:** `tests/feedcheck_test.py`; Point & Figure in `tests/ctype_test.js` (hand-worked columns) and in
  `tests/charttypes_flow.js` (with Volume and two Pine scripts, whole boxes, alternating columns; the Log page card).

Roadmap
- Footprint: real trades only, never an estimate (agreed); the recorder is built, the measurement is on Monday.

## v0.15.0 — 31 Oct 2026 — Chart types, with indicators on every type

Added
- **Chart types** (the button after the timeframes, saved on the server): Candles, Hollow candles, Bars (OHLC), Line,
  Area, Heikin-Ashi, Renko, Range bars and Line break.
  - Renko: box by ATR (default 14) or fixed points per underlying; built from closes or from highs and lows;
    optional wicks; a reversal needs two boxes (traditional).
  - Range bars: range by ATR or fixed points. Line break: 3 lines (settable).
  - Renko, range bars and line break are built from the timeframe's candles (1m for the finest) and get the time of
    the candle each bar formed in; the candle timer is off for them.
- **Indicators on every chart type.** Volume, built-in indicators and Pine scripts run on the bars the chart shows,
  as on TradingView (an RSI on Heikin-Ashi uses Heikin-Ashi closes; on Renko, one value per brick), line up bar for
  bar on the candles and in their own panes, and follow live prices (several new bricks in one tick included).
- Bid, ask, last, trade lines and every ₹ figure stay real prices on every type; the long / short tool, zones and
  position bars work on every type.
- Chart settings: a colour for the line / area chart.
- **Tests:** `tests/ctype_test.js` (the transforms, with hand-worked numbers) and `tests/charttypes_flow.js`
  (browser: every type with Volume and two Pine scripts, alignment, the SMA checked against the chart's own closes,
  live ticks, the trade tool on Renko).

Changed
- Switching chart type or theme redraws at once from the candles already loaded (no reload, no empty chart).
- `web/vendor/lightweight-charts.standalone.production.js` (5.2.1, the latest): one guard added so the volume
  histogram's hover check returns "no hit" instead of throwing "Value is null" when it has no first visible value
  (a library bug; it showed as an occasional console error with the mouse over the chart). Noted in the file.

Roadmap
- Candle types moved up to item 2 and ticked; footprint / delta (order flow) stays open.

## v0.14.0 — 31 Oct 2026 — Live mode (the admin only): real orders at Fyers with the stop at Fyers

Added
- **Live accounts.** Any account can be Paper or Live (Account page → Your accounts → Turn on LIVE / Back to
  Paper). Live is for the admin only, one Live account per Fyers login, and needs the account flat, Fyers logged in
  today, the Fyers client ID typed to confirm and a fresh 2FA code. The account's earlier trades are archived and a
  fresh ledger starts at the capital typed, so paper results and real money never mix. In the security log.
- **Real orders, same engine.** A Live account uses the paper engine's ticket, chart tool, rules and guards, BE,
  BE-T, trailing, targets, square-off and expiry exit; orders go to Fyers on the owner's login. A position opens when
  Fyers reports the fill, at Fyers' price, and every ₹ figure stays net of all charges. Every live trade needs a stop;
  no orders when the contract isn't trading (Fyers takes no after-market orders) or without today's Fyers login.
- **The stop at Fyers.** As soon as a trade opens, a stop-limit (SL-L) sits at Fyers at the stop, its limit 0.5% (at
  least 5 ticks) past the trigger so it fills if price jumps (new rules: LIVE stop-limit slack % and ticks).
  Trailing, BE, BE-T and your own SL edits move that same order, paced 1.5 s apart, never below BE, never backwards.
- **Exits, never two at Fyers.** The server's bid / ask rule (and targets, square-off, expiry, ✕, Close all, the kill
  switch) closes at Fyers: on NSE / BSE the stop order itself becomes a market order; on MCX (no type change allowed)
  the stop is cancelled, the cancel confirmed, then one market exit. Market refused → a limit that crosses the spread;
  an exit still open after 3 s is re-priced (new rule: LIVE re-price after, seconds). Targets stay on the server.
- **When things go wrong.** Server restart: Fyers' order book is read first (a stop that filled is recorded), then
  trailing resumes. A refused stop change keeps the old stop and retries with a warning. An unconfirmed order is
  looked up by its tag, never sent twice. Overnight (Carry) positions get a fresh stop at the trailed level the next
  day once the contract trades, after checking Fyers still holds the position.
- **Kill switch** (KILL in the top bar and on the Account page): cancels every order and closes every position at
  Fyers on the login (the app's and any others), then pauses new orders until Resume.
- **On the page:** red LIVE badge, KILL button and a red line under the top bar; "● LIVE" in the switcher; LIVE on
  the PLACE button; live warnings under the top bar (no stop at Fyers, no Fyers login, order updates down); each
  position shows its Fyers stop (and on the Trades page under SL); the Account page's Live card (Fyers login, order
  updates, Fyers funds, Resync with Fyers, Resume, kill switch).
- **Fyers order updates** through Fyers' order socket (not counted against API limits), with the order book read as
  a fallback (every 5 s if the socket is down).
- **Routes:** `POST /api/accounts/mode`, `GET /api/live/status`, `POST /api/live/kill`, `/api/live/resume`,
  `/api/live/resync`. The paper routes work for Live accounts too.
- **Tests:** `tests/fake_broker.py` (a fake Fyers order API with Fyers' rules, which records any moment two exit
  orders are open), `tests/live_test.py` (61 checks of the live engine), `tests/live_flow.js` (browser). The mock
  server fakes the order API too.

Roadmap
- Added, in this order: saved chart layouts per user (indicators and their settings); multi-charts (vertical and
  horizontal) in a layout; a proper mobile version (full-screen chart, like the MT5 mobile app).

Changed
- The account manager is headed "Your accounts" and shows each account's mode.
- `tests/security_flow.js`: the "no page errors" check ignores HTTP answers the test provokes on purpose (401, 428)
  and fonts the test machine can't reach; script errors still fail it.

Safety fixes before release (an independent review of the live engine found these; each is now a test)
- A stop or exit that part-fills at Fyers: each part is recorded as it fills and an exit is never larger than what
  Fyers still holds (before: a part-filled stop then a full-size exit could open an opposite position).
- An order whose answer from Fyers was lost: its tag and "sent" mark are saved before sending, and after a restart
  it's looked up, never sent again.
- Kill switch: its second phase never touches a contract the app was handling, and acts only on positions Fyers
  shows twice, 1.5 s apart (before: an app exit filling meanwhile could be "closed" a second time).
- Cancelling an order Fyers hadn't confirmed: it's kept until Fyers shows it (then cancelled there) or confirms it
  doesn't exist; if it filled, the position opens with its stop. Nothing is left at Fyers without the app knowing.
- An extra app order that turns up late at Fyers is cancelled (or, if filled, recorded), and when a position closes
  every other app order for it is cancelled. Anything only you can sort out shows as a "CHECK FYERS" warning until
  Resync.
- The kill switch pauses new entries only; stops keep being placed and moved. An entry that fills during it is closed.
- Delivery (CNC) shares held overnight are found in Fyers' holdings.
- Order updates that fail are retried from the order book; a silent order socket is reopened after 45 s.
- **Resume** after the kill switch asks for a fresh 2FA code.
- After a restart, the day's finished orders aren't replayed (no false "CHECK FYERS" warnings); the kill switch's
  own close of an outside position is never mistaken for a stray; the app records a position as "closed at Fyers"
  only when two reads of Fyers' positions, 3 s apart, both show it gone; a fill whose recording fails is retried;
  "not placed" is decided only after 6 looks at the order book (about 12 s).

Not tested (needs the real Fyers): see "Where live mode stands" in `docs/Handoff.md`.

## v0.13.3 — 31 Oct 2026 — Roadmap as a ticked task list, project instructions (no change to the app)

Added
- `docs/Project_Instructions.md`: the project instructions for claude.ai, brought up to date (users and 2FA,
  live mode for the owner only, the test kit, square-off, order limits) and with a ROADMAP section: new tasks go
  into the roadmap as soon as they're agreed, and finished ones are ticked with their version.

Changed
- `docs/Roadmap.md` is now the one task list: open tasks marked [ ] in the agreed order, small follow-ups, and a
  Done section listing every version from v0.1.0, each ticked.
- `docs/Handoff.md` points to the project instructions.

## v0.13.2 — 31 Oct 2026 — Test kit and handoff notes (no change to the app)

Added
- `tests/`: the test kit used before every release. It runs the real helper with Fyers faked (candles, quotes,
  margin, a live price stream) and includes the route check, the square-off engine test and the browser test of
  login, 2FA, users and accounts. See `tests/README.md`. Nothing in it runs on the server.
- `docs/Handoff.md`: where the project stands, how the code is laid out, and the next job, so a new chat can
  pick up from the repo.
- `docs/Roadmap.md`: the agreed live-mode design (a real stop at Fyers that the trail moves, the server watching
  with the bid / ask rule, targets held by the server, what happens if the server or Fyers lags or goes down,
  overnight stops).

## v0.13.1 — 31 Oct 2026 — Intraday square-off 5 minutes before Fyers, product switch on the chart

Added
- **Product on the chart:** the PLACE box has an **INTRADAY / NRML / CNC** button. Click to switch between
  Intraday and Carry (Delivery for stocks). The choice stays the default for later trades in that account,
  the same as the Product box in the panel.

Changed
- **Intraday square-off now runs 5 minutes before Fyers' own square-off** (Fyers charges ₹50 + GST per
  order it closes). Fyers' times: index and stock F&O 15:25, stocks with F&O 15:05, other stocks 15:20,
  MCX 23:20 (US summer time) / 23:45 (US winter time, from Mon 2 Nov). So the app closes at 15:20, 15:00,
  15:15 and 23:15 / 23:40. The MCX time switches by itself when US clocks change.
- At that moment the app also **cancels pending Intraday orders**, and **refuses new Intraday orders** for
  the rest of the day (pick Carry / Delivery instead). Carry and Delivery are never touched.
- Rules: "Intraday square-off" on / off, "Minutes before Fyers' square-off" (5; it shows today's times),
  and Fyers' own times per market, in case Fyers changes them. These replace the three fixed square-off
  times. If you had turned square-off off (empty times), it stays off.
- An open page from before v0.13.0 that tries to log in now says "reload it" instead of "wrong username or
  password".

## v0.13.0 — 30 Oct 2026 — Users with two-factor login, and several paper accounts

**After this update:** open the page and log in with username **admin** and your existing page password.
You'll be asked to set up two-factor login (scan a QR code with Google Authenticator, Microsoft
Authenticator, Authy or similar), then shown 10 recovery codes once: save them somewhere safe. Your
trades, rules, scripts, chart set-up and Fyers app are all kept (moved into your user and a paper account
called "Main").

Added
- **Users.** Settings → Users (admin only): add a user with a temporary password; disable / enable, reset
  their 2FA (lost phone) or give a new temporary password. A new user chooses their own password and sets
  up 2FA at first login. Each user has their own Fyers app (for prices), chart set-up, Pine scripts and
  paper accounts. Other users are paper-only; live trading will be the admin's only.
- **Two-factor login for everyone**, the admin included: password, then a 6-digit code from an
  authenticator app. 10 one-time recovery codes for a lost phone (typed with or without the dashes).
- **Security** in Settings: your name, change password, new recovery codes, move 2FA to a new phone,
  every device you're logged in on (log out any of them, or everywhere else), and recent activity.
- **Sensitive actions ask for a fresh 2FA code** (valid 5 minutes): adding or changing users, new
  recovery codes, moving 2FA, editing charge rates.
- **Login protection:** 5 wrong attempts lock the user for 15 minutes; 20 failures from one address in
  15 minutes block that address for 15 minutes. Sessions end after 48 hours idle and 7 days at most.
- **Encrypted secrets:** each user's Fyers App Secret and daily token are stored encrypted on the server.
- **Security log:** logins, failures, lockouts, password and 2FA changes, users and accounts changed,
  charge edits. Yours in Settings and on Log → Security; the admin sees everyone's in Settings → Users.
- **Several paper accounts.** A switcher in the top bar (name and balance). **+ New account**: name,
  starting capital, and default rules or a copy of another account's rules and trailing. Each account has
  its own balance, rules, trailing defaults, positions, orders and history, and keeps running on the
  server whichever one you're looking at. Rename and archive / restore on the Account page.
- Server console rescue if the admin loses both phone and recovery codes:
  `sudo -u helper /home/helper/venv/bin/python -m helper.users rescue admin` (run in /home/helper/app).

Changed
- Login is now username + password + code (was a single page password).
- Charges: only the admin can edit rates or mark Fyers' page as reviewed.
- Data on the server moved into `data/u/<user>/` and `data/u/<user>/a/<account>/` (done automatically,
  once). The old `auth.json` is renamed `auth.json.migrated`.
- Requirements: adds `cryptography` (installed by the update service automatically).

Fixed
- On a phone, with the trade panel closed, the chart and watchlist used only two-thirds of the width.

## v0.12.0 — 30 Oct 2026 — Charges you can edit, and a daily check of Fyers' charges page

Added
- Account → Charges used → **Edit rates**: every rate of every segment can be changed in the app (in %,
  or ₹ for flat ones), plus GST. Saved on the server; every figure uses the new rates at once (charges
  already paid on open positions stay as they were). Edited segments are marked; **Back to built-in
  rates** undoes all edits.
- The server reads Fyers' charges page about once a day (and on **Check Fyers' page**). If its rate
  lines change, a "Charges changed: review" pill appears in the top bar and the Account page shows the
  old and new lines. Nothing changes by itself: you edit the rates if needed and click **Mark as
  reviewed**. The first check just records the page as it is.

## v0.11.0 — 30 Oct 2026 — Speed: saved candles, Pine scripts update only the live bar

Added
- Saved candles, on the server and in your browser:
  - The server keeps every candle it fetches (data/candles.db). Fyers is asked only for what's new since
    last time (at most every 45 s per chart), or for older days not saved yet. Asking for a longer
    history fetches the older part once, and the history keeps growing past what one Fyers request gives.
  - Your browser keeps its own copy (IndexedDB, last 60 charts). A chart opens at once from it, then only
    the newer candles come from the server. If Fyers is logged out, the saved chart still shows.
  - New candles are drawn without re-running indicators from scratch.
- Pine scripts run like TradingView's:
  - The full history runs once. After that each price re-runs only the live bar: about 1 ms for simple
    scripts, and about 0.3 s for the Regime script on 1,500 bars (it was a full 2.4 s re-run).
  - A new candle triggers one full re-run in the background, so labels and lines drawn on the old last
    candle are rebuilt exactly.
  - "Bars of history" per indicator (⚙): 500 to 50,000. The chart loads the extra days it needs.
  - "Update" per indicator (⚙): with every price, or on candle close (for heavy scripts on long
    histories: one run per candle, nothing in between).
  - The settings box shows how many bars the script ran on and how long a full run and a live update take.
  - While the first run is working, the read-out says "calculating…".

Measured (Regime script, this test machine; your PC may differ):
- 1,500 bars: full run 2.4 s, live update 0.3 s.
- 5,000 bars: full 5.3 s, live 0.7–1.0 s.
- 20,000 bars: full 18.7 s, live 2.6–3.0 s. Its big analysis runs on the last bar, so each live update
  repeats it. "On candle close" suits it there.

## v0.10.0 — 30 Oct 2026 — Full pages; NSE and BSE: stocks, indices, F&O, currency

Added
- Pages next to the chart (top bar: Chart · Trades · History · Book · Account · Log). The chart keeps
  running underneath, so switching back is instant; the address remembers the page (#trades ...).
  - Trades: every open position in one table (entry, LTP, SL / TP with their net ₹, BE + costs, net P&L,
    R, charges paid, time open), per-trade Trail BE / Trail SL with R boxes, BE and close buttons; click
    any price to change it. Pending orders with their price, distance from the market, SL / TP and risk.
    BE all, Cancel all orders, Close all. The account figures sit on top.
  - History: filters (period, contract, side, wins / losses, exit, product), stats (net, win rate,
    profit factor, average R, expectancy, average win / loss, charges, best / worst, max drawdown,
    streaks, average hold), an equity curve and a daily P&L chart, results by contract and by exit,
    and every closed trade with its full charge breakdown. Download the filtered list as CSV.
  - Book: up to 4 order books side by side (the chart's contract plus any from your watchlist or open
    positions), with spread, buy / sell totals and the day's figures.
  - Account: the paper account's figures, rules, trailing defaults, reset, and the charges in use.
  - Log: the paper account's events (now the last 500) and the helper's own log, with filters and search.
  - ⤢ on the trade panel's tabs opens the Trades page.
- NSE and BSE as well as MCX:
  - Stocks (NSE and BSE), indices (NIFTY 50, BANK NIFTY, SENSEX, INDIA VIX ...), index and stock F&O
    (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX ...), NSE currency, NSE commodities.
  - Find has exchange (NSE / BSE / MCX) and type (Stocks / Index / Fut / Opt) filters. Searching
    "nifty" puts the index first, then its futures and options.
  - Option chains from an index or stock row (Opt), with the at-the-money strike from the index.
  - Indices are chart-only: BUY / SELL explains that an index can't be traded.
  - Stocks trade as Intraday or Delivery (CNC); F&O as Intraday or Carry (NRML). A delivery sell needs
    shares you hold, as at the broker.
- Charges for every new segment, net in every ₹ figure as before: stock intraday (STT 0.025% on sell)
  and delivery (STT 0.1% both ways, stamp 0.015%, brokerage ₹20 or 0.3%, DP ₹12.5 + GST per sell), NSE
  and BSE exchange rates, BSE Sensex / Bankex options, BSE futures, currency futures and options, NSE
  commodities.
- Square-off and expiry-day exits per market: MCX (23:15 / 22:45), NSE / BSE (15:15 / 15:00) and
  currency (16:45 / 12:00), all in Rules.

Changed
- MCX contracts still show without "MCX:"; NSE and BSE ones keep their exchange (NSE:RELIANCE-EQ vs
  BSE:RELIANCE-A).
- The symbol lists are kept compactly in memory (the server has 1 GB), about 2 seconds to load.

## v0.9.0 — 30 Oct 2026 — Hide / collapse indicators; your Liquidity Levels script draws on the candles

Added
- Indicator read-outs work like TradingView's:
  - 👁 on each indicator hides it (plots, drawings, tables) and shows it again; the name stays, greyed.
    A hidden Pine script stops running until you show it again.
  - The arrow under the indicators on the candles (▴) collapses them all into "▸ N indicators";
    click it to expand.
  - Each lower pane's read-out has ▾ / ▸ to show or hide its values.
  - The buttons (👁 ⚙ { } ✕) appear when you point at a read-out, so they don't crowd the chart.
    Double-click an indicator's name for its settings.
  - Hidden and collapsed states are saved, so they survive a reload and work on any device.
- Label tooltips: point at a Pine label that has a tooltip (your Liquidity Levels labels do) to read it.

Fixed
- Pine scripts with their own pane that draw on the candles (force_overlay = true) now draw there. This
  is why Regime Matrix + Liquidity Levels showed its pane but none of the liquidity levels; its levels,
  labels, zones and the stats table now appear on the candles.
- Corner-style labels (label_lower_left, upper_left and so on) sit on the correct side of their point.
- Plots marked display = pane (like the script's invisible scale plots) no longer clutter the read-out.
- Tables at the top-left sit under the read-outs instead of on top of them.

Changed
- Heavy scripts re-run less often on live prices (every 2 s, or four times their run time if longer)
  so the page stays smooth; every new bar still re-runs them straight away.

## v0.8.1 — 30 Oct 2026 — BE label always readable

Fixed
- When the stop sits a few ticks from the entry (for example at BE), its label was hidden under the
  position bar. The bar now slides just above or below the stop line, so the "BE · exit here nets …"
  label stays readable. The Entry tag on the price scale still marks the exact entry.

## v0.8.0 — 30 Oct 2026 — Pine Editor and your own Pine Script indicators

Added
- Pine Editor (Pine button above the chart): a code editor docked under the chart, like TradingView's.
  Syntax colouring, line numbers, bracket matching, Ctrl+/ to comment, Ctrl+F to find.
  - Checks your code as you type: errors show with their line number (click to jump there), and the
    line is marked red.
  - New, Open, Save (Ctrl+S), Save as, rename (edit the name and Save), Delete.
  - Add to chart (Ctrl+Enter). Once a script is on the chart the button reads "Update on chart", and
    saving a script updates it on the chart straight away.
  - log.info() output shows under the editor. Drag the editor's top edge to resize it.
- Your scripts are saved on the server, so every device has the same library. ƒx → "My scripts"
  lists them: + Add puts one on the chart, { } opens it in the editor.
- Pine scripts on the chart:
  - overlay=true scripts draw on the candles; the others get their own pane.
  - plot (line, step line, line break, circles, cross, histogram, columns, area), hline, fill,
    bgcolor, barcolor, plotshape, plotchar, plotarrow and plotcandle.
  - Drawings: label, line, box, linefill, polyline; tables over the chart.
  - request.security() for other timeframes, built from Fyers candles the same way as the chart.
  - Times (hour, minute, sessions) are in Indian time, like TradingView with an MCX/NSE chart.
  - Each script's read-out shows its values for the bar under the cursor, with ⚙ inputs, { } source
    and ✕ remove. Errors show in red in the read-out.
  - ⚙ opens the script's inputs (numbers, true/false, lists, sources, colours, timeframes, text),
    grouped as in the script. Changes apply at once and are saved per chart indicator.
  - Scripts see the latest 1,500 bars and update with live prices (on each new bar, otherwise at most
    every 2 seconds).
  - A script stuck in an endless loop is stopped with an error, without freezing the page.

Fixed
- Paper targets and limit orders now fill when a trade goes through their price, even if the bid / ask
  never touched it. A real resting limit order would have been filled first. A trade exactly at your
  price still doesn't fill it, as orders may be ahead of you in the queue. Fills are at your price.
- Spikes between two live snapshots: when the day's low (or high) moves past a target or limit
  between snapshots, that trade happened, so the order fills.
- Indicator panes are sized together, so adding a pane no longer squeezes the one above it to a sliver.

Changed
- BE line label now leads with what you get there: "BE · exit here nets +₹0 · 13 ticks below entry
  pay the ₹51.60 charges".
- Position bar shows the entry price ("SHORT 4 @ 13,993"), and the entry line is labelled Entry.

Notes
- Pine Script runs on PineTS 0.13.1 (AGPL-3.0) and the editor on CodeMirror 5.65.18 (MIT). Both are
  bundled in web/vendor with their licences. PineTS covers most of Pine v5/v6 but not all of it; if one
  of your scripts errors or draws differently from TradingView, send it to me.

## v0.7.1 — 30 Oct 2026 — Indicator panes easier to read

Changed
- Indicator panes have a shaded background and a brighter divider, so they no longer look like part of
  the candle chart (the divider turns blue when you hover it to resize)

Added
- Read-outs at the top-left of each pane: the candle pane shows open, high, low, close, change and
  volume; the Volume pane shows the volume and its moving average. Point at any bar to see that bar's
  values; move off the chart and they show the latest bar
- Volumes in read-outs use K / L / Cr for thousands, lakhs and crores

## v0.7.0 — 30 Oct 2026 — Indicators menu, Volume indicator

Added
- Indicators menu (ƒx above the chart): add, set up and remove indicators. Each indicator gets its own
  pane below the candles; drag the divider to resize it (the height is remembered). Your indicators
  are saved with your preferences, so every device shows the same set
- Volume indicator: volume bars in their own pane with an optional moving average (on / off, length,
  colour). This replaces the volume pane that v0.6.0 put in Chart settings
- This is the menu your Pine Script indicators will plug into next

Changed
- Chart settings → "Volume under candles" is back: the volume strip at the bottom of the candle pane,
  on / off with the tick box (as in v0.5.x)
- The bid / ask text in the top bar gives way first when space is short, so more timeframe buttons stay visible

Fixed
- Clicking inside a menu above the chart could close it while you were still using it

## v0.6.1 — 30 Oct 2026 — BUY / SELL button position

Added
- Chart settings (⚙) → BUY / SELL buttons: put them in any corner of the candle pane (top left,
  top right, bottom left, bottom right) with an X and Y offset in pixels. Right-hand corners stay
  clear of the price scale; bottom corners sit on the candle pane, above the volume pane. Saved with
  your preferences

Fixed
- In a crowded top bar the symbol could scroll out of view and the ⚙ / Panel / ⛶ buttons could be
  pushed under the panel. They now always stay visible; timeframe buttons that don't fit are hidden
  (all of them are under ▾)
- On 1D / 1W / 1M the countdown tag on the price scale wrapped onto two lines

## v0.6.0 — 30 Oct 2026 — Volume pane (chart library upgrade)

Changed
- Chart library upgraded from Lightweight Charts 4.2 to 5.2.1, which has real panes - the foundation
  for indicators in their own panes later
- Volume now has its own pane under the candles, with its own scale and the latest bar's value on it.
  Drag the divider to make it taller or shorter; the height is remembered. On / off in Chart settings (⚙)
- Candles use the full height of the top pane again (the volume strip no longer shares it)

## v0.5.3 — 30 Oct 2026 — Candle timer easier to see

Changed
- The countdown now sits right next to the price in the chart's top bar ("⏱ 1:42") so it's never cut
  off when the bar is crowded
- The countdown on the price scale is a bold blue tag instead of a small grey one

Fixed
- For the first second after opening a chart, the price-scale countdown could be placed off the edge

## v0.5.2 — 30 Oct 2026 — Trailing made visible

Added
- Each position's bar now shows where Trail SL will move the stop: "moves past 14,050" before it
  starts, "next 14,046" while it's trailing. Hover for the working: 1R in points (first entry to first
  stop), the trail distance, and the price to pass

Notes
- Trailing wasn't broken: with BE-T already at break-even, a Trail SL 2R behind the best price is
  further away than the BE stop, so the stop correctly stays at BE until price makes a new best beyond
  the "moves past" price; then it follows. Switching TRAIL on after BE-T has fired works the same way

## v0.5.1 — 30 Oct 2026 — Candle timer

Added
- Candle timer: the time left in the current candle, on the price scale just under the bid / ask /
  last labels, and in the chart's top bar ("candle closes in 1:40"). Works on every timeframe,
  including custom ones; the day's last candle counts down to the session close; on 1D / 1W / 1M it
  shows the time to today's close; outside trading hours it says "market closed".
  On / off in Chart settings (⚙). Session hours come from Fyers' contract list

## v0.5.0 — 30 Oct 2026 — Volume and order book

Added
- Volume strip under the candles (green / red with the candle), built from Fyers' history and kept live
  from the day's running volume; on / off in Chart settings (⚙)
- Book tab in the trade panel: the chart contract's top 5 bid / ask levels with quantities, order counts
  and depth bars, total buy vs sell quantity with a ratio bar, and the day's open, high, low, previous
  close, average price, volume, last traded quantity and change
- With BUY or SELL pressed, click a price in the book to put the tool's entry there (limit or stop, as
  when dragging)
- The order book streams from Fyers only while the Book tab is open (it doesn't count against the
  data-request limits); if the stream is quiet, a slow backup check (every 6 s) fills in

Changed
- Picking a panel tab scrolls it into view

## v0.4.3 — 30 Oct 2026 — Last line and chart settings

Added
- "Last" line at the last traded price (the live candle's close), labelled "Last" when it differs
  from both bid and ask - shows why the candle can sit away from the bid / ask in thin contracts
- Chart settings (⚙ above the chart): colour and style (solid, dashed, dotted, long dash) for the
  bid, ask, last, position entry, stop loss, target, break-even / floor, pending order and new-trade
  entry lines; show / hide bid, ask and last; candle up / down colours; loss and profit zone colours
  and strength; background colour; grid on / off; Reset to defaults. Saved with your preferences

Fixed
- Preferences (watchlist, timeframes, last chart, theme, ticket defaults, stop distances) weren't being
  saved to the server in v0.4.1 and v0.4.2 - a change in v0.4.1 removed that part of the helper by
  mistake, so they only lived in the browser. Restored; a check of every helper route now runs
  before each release

## v0.4.2 — 30 Oct 2026 — Break-even matched to LiveTrader

Changed
- Stops and targets on a contract's own price now trigger on the price they exit at, as in MT5:
  a long's SL / TP on the bid, a short's on the ask (they used to trigger on the last price). A stop at
  BE + costs therefore closes at BE + costs, not a spread worse. Stops on an underlying future still
  trigger on the future's last price
- A stop at break-even is labelled like LiveTrader: "BE +N ticks · covers ₹X" (the entry charges already
  paid plus the exit charges), "TRAIL …" once Trail SL has taken it over

Added
- Rules → BE buffer (ticks): extra ticks beyond break-even + costs for BE, BE all and Trail BE
  (LiveTrader's "Break-even buffer (points)"; default 0)

## v0.4.1 — 30 Oct 2026 — Chart loading fix

Fixed
- "busy - too many data requests" on the chart when switching timeframes quickly (1D, 1W, 1M and
  4h are fetched in several pieces, and the helper refused the extra ones instead of waiting)

Changed
- Data requests now queue for a moment instead of being refused, still staying well inside
  Fyers' free-plan limits (helper caps: 3 a second, 35 a minute)
- Fewer pieces per chart: 1D and 1W load 2 years (2 requests), 1M 3 years, 2h–4h up to 198 days (2 requests)
- History already loaded for a longer range is reused for shorter ones; identical requests share one call
- The chart retries by itself if Fyers is busy

## v0.4.0 — 30 Oct 2026 — Chart controls and view fixes

Added
- Control bar on each position's entry line (right side of the chart): side, lots, live net P&L and R,
  ✕ close, BE, BE-T (trail to BE) with its R box, TRAIL (trail SL) with its R box
- Trailing per trade: each position keeps its own BE-T / TRAIL settings; the panel's row sets
  the defaults for new trades (and still applies to all open trades when changed there)
- Pending orders get a bar with their type and lots, and ✕ to cancel
- Solid MT5-style bid (grey) and ask (red) lines with their prices on the scale
- ✕ button on the trade panel to hide it

Changed
- ⛶ / F now maximises the chart inside the browser window, so browser tabs stay one click away;
  Shift+F still gives real full screen
- When maximised, the panel (P) slides in below the chart's top bar, so Panel / ✕ stay reachable
- The dotted last-price line is replaced by the bid / ask lines

Fixed
- The red ✕ covered the position's entry-line label ("SHORT 4 · +₹0" unreadable)
- No way to close the panel once it was opened over a maximised chart

## v0.3.0 — 30 Oct 2026 — Trade from the chart

Added
- Long/short tool on the chart (MT5-style): red/green risk and reward zones with net ₹ (after all
  charges) and R, and a PLACE box on the entry line
- Entry follows the market; drag it and it becomes a limit or stop automatically
  (buy below market = limit, above = stop; reversed for sells). MKT snaps back
- SL/TP move with the price at a fixed distance; stop distance remembered per instrument
- BUY / SELL buttons at the chart's top-left corner; trade without opening the panel
- Open positions: zones from the entry candle, draggable SL/TP, one-click ✕ to close
- Pending orders: draggable entry/SL/TP, one-click ✕ to cancel
- Custom timeframes: any minutes or hours, plus D, W and M (e.g. 7m, 90m, 2h, 3D); pin favourites
- More Fyers resolutions (2m, 10m, 20m, 45m, 2h, 3h, 4h); longer history loaded in chunks
- Settings saved on the server: watchlist, pinned timeframes, last chart, theme, panel on/off,
  ticket defaults (risk mode/amount, product, R) and stop distances

Fixed
- Chart couldn't shrink or grow with the window (panel overlapped the chart)
- Full screen didn't fill the screen
- SL/TP lines could sit off-screen; the chart now keeps them in view so they can be dragged
- Live candles now follow Fyers' own candle alignment
- Phone layout: trade panel was squeezed; PLACE box now fits small screens

## v0.2.0 — 30 Oct 2026 — Paper trading
- Server-side paper engine: market, limit and stop orders, adds, BE, Trail BE / Trail SL, Close all
- Every ₹ figure net of brokerage, exchange, clearing, CTT/STT, stamp duty, SEBI fee and GST
- Option stops on the option itself or its underlying future
- LiveTrader-style rules: daily/max loss, buffer, risk cap, margin (Fyers' calculator), open risk,
  trades a day, SL required, intraday square-off, expiry-day exit
- History with per-trade charge breakdown and CSV download
- Full-screen chart and panel toggle

## v0.1.0 — 30 Oct 2026 — Plumbing
- Page password, daily Fyers login, MCX contract search, option chain, watchlist
- Live candlestick charts from the Fyers data socket, with a slow quote poll as backup
- Auto-update from GitHub every minute
