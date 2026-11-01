# Roadmap: the task list

Updated 1 Nov 2026 (v0.24.1). This is the one task list for the project.
- New tasks are added here as soon as they're agreed, in the order agreed.
- When a task ships, it's ticked [x] with its version and moved to **Done** (details in CHANGELOG.md).
- Half-done tasks stay in **Next** with the finished parts ticked.

## Next, in this order

**Order change (owner, 1 Nov 2026):** items 7 (measurement tool) and 9 (drawing tools) were built first (v0.22.0),
ahead of 3-6.

1. [ ] **Live mode** (the admin only). Design agreed 31 Oct 2026; built and tested on the fake Fyers in **v0.14.0**. Still to do: the first real trade, then the charges check.
   - [x] Each account is Paper or Live, behind a broker layer, so switching is a flip of a setting (flat first; the old trades are archived and a fresh ledger starts). Live sends orders to Fyers on the owner's own login and reads fills back from Fyers' order-update socket (it doesn't count against the API limits), with the order book as a fallback. *(v0.14.0)*
   - [x] **Stops:** a real stop-loss order sits at Fyers from the moment the trade opens: a stop-limit (SL-L), because Fyers takes no SL-M on options or BSE; its limit 0.5% (at least 5 ticks) past the trigger, settable. Trailing, BE and BE-T move that order (never below BE, never backwards), paced 1.5 s apart. Only ever one exit order at Fyers per position. *(v0.14.0)*
   - [x] **The server still watches** with the bid / ask rule (like MT5). If its rule fires first, NSE / BSE: it changes that same Fyers order to a market exit. MCX (Fyers doesn't allow changing an order's type there): it cancels the stop, waits for Fyers to confirm, then sends one market exit. A triggered stop that didn't fill is turned to market the same way. A market exit Fyers holds back is re-priced as a limit that crosses the spread after 3 s. *(v0.14.0)*
   - [x] **Targets stay on the server** (no target order at Fyers, so two exits can't both fill). *(v0.14.0)*
   - [x] **Server down:** the Fyers stop protects the position at its last trailed level; trailing and the target pause. **Back up:** it first reads Fyers' order book: records a stop that filled; resumes trailing; if price is already past the target, closes at market straight away. *(v0.14.0)*
   - [x] **Lag / refused change:** the previous stop stays in force; the app retries and shows a warning. An unconfirmed order is looked up by its tag, never sent twice. *(v0.14.0)*
   - [x] **Overnight (Carry / NRML) positions:** after the daily Fyers login, once the contract trades, a fresh stop at the trailed level, after checking Fyers still has the position (if not: recorded as "closed at Fyers" with a warning). Until then a warning shows. *(v0.14.0)*
   - [x] Fyers rules: under 10 orders a second and 200 a minute, modifications included (the helper queues at 4/s, 120/min); market orders become market-price-protection orders; no after-market orders; daily Fyers login. Fyers triggers stops on the last traded price, so live exits can differ by a tick from paper's bid / ask rule. *(v0.14.0)*
   - [x] Safeguards: a typed confirmation of the Fyers client ID plus a fresh 2FA code to turn Live on; a red LIVE badge everywhere; a kill switch (cancel everything, close everything at Fyers, then pause until Resume); all of it in the security log. *(v0.14.0)*
   - [ ] **First real trade (the owner):** whitelist the droplet's own IP **134.209.159.171** in the Fyers API app with order permission, turn on Live, and test with 1 lot on MCX: entry, the stop at Fyers, a trail move, BE, a close with ✕, and the kill switch. Report anything odd with a screenshot.
   - [ ] Then: compare the app's charges with the charges Fyers actually deducted, and flag any gap.
2. [ ] **Candle types and order flow** (moved up 31 Oct 2026). Candle types done in **v0.15.0**, Point & Figure in **v0.16.0**; the footprint waits for Monday's measurement.
   - [x] Heikin-Ashi, Renko, range bars, line break, plus hollow candles, bars, line and area. Indicators (Volume, built-ins, your Pine scripts) work on every type, on the bars the chart shows, as on TradingView (asked 31 Oct 2026). *(v0.15.0)*
   - [x] **Point & Figure** chart type (asked 31 Oct 2026): X / O columns, box size (ATR or fixed) and reversal (3 boxes), from closes or highs and lows, with indicators like the other types. *(v0.16.0)*
   - [ ] **Point & Figure toolkit, Definedge-style** (asked 31 Oct 2026). Drawn on P&F charts from the ƒx menu, with signals marked on the chart.
     - **Rule (owner, 31 Oct 2026): every indicator works on P&F charts, not just a few: Volume, every Pine script, and any indicator or Pine feature added in future.** P&F columns are ordinary bars to indicators; a Pine compatibility test (many Pine features, on every chart type) runs before every release, and nothing ships that fails it on P&F.
     - [x] Every indicator on P&F: Pine gets ordinary bars on every chart type (a column closes when the next opens; `close` = the column middle by default, or the last box); the Pine compatibility test (9 scripts, every chart type) runs before every release. MA, BB, RSI and anything else are Pine scripts and work there. *(v0.17.0)*
     - [x] First set: the P&F toolkit (ƒx): 45° trendlines with breaks and the next line after each break; DTB / DBS / TTB / TBS at their trigger box (fresh or continuation); anchor columns (15+ boxes) and their levels; open vertical counts. *(v0.17.0)*
     - [x] Second set: horizontal counts; patterns: bull / bear traps, catapults, high / low poles, triangles (symmetrical, ascending, descending), turtle breakouts, anchor follow-through; labels placed without overlaps; a switch per pattern family. *(v0.18.0)*
     - [ ] Mini tops / bottoms: Definedge doesn't publish the rule (the owner can paste it from Definedge's library).
     - [ ] Definedge's own indicators (PMOX, XO Zone %, Noiseless RSI, Smart Don, Oops patterns): their exact rules are in Definedge's logged-in library; built only from their published definitions (the owner can paste them), never guessed.
   - [ ] **Footprint: real trades only, never an estimate** (agreed 31 Oct 2026). Fyers' API documents no trade-by-trade feed (the tick-by-tick socket is 50-level depth only, NSE / NFO, 1 symbol on Standard); its normal feed sends snapshots with the last trade's price and size and the day's volume.
     - [x] The recorder: the server records every feed snapshot for chosen contracts (default CRUDEOIL and NIFTY futures) and reports how much of the volume arrives as single, exact trades (Log page, admin). *(v0.16.0)*
     - [ ] Measure on Monday 2 Nov (needs the owner's Fyers login that morning), then read the report together.
     - [ ] Then decide with the owner: build the footprint (buy x sell volume at each price per bar, delta, cumulative delta, imbalances) only where the trades are exact; otherwise ask Fyers for a trade feed. Buyer / seller is classified by the bid / ask at the trade, as Fyers' own order flow does.
3. [ ] **Telegram alerts:** a message if the server stops responding while a live trade is open (with the journal's Telegram set-up).
4. [ ] **Journal: full Octagon port** (from `octagon_journal.html`)
   - Paper and live trades arrive automatically, per user and account.
   - 8 pillars audit; notes, tags, plan; insights; review calendar; filters and stats.
   - Screenshots on the server, with the chart captured automatically at entry and exit. Telegram as a backup copy.
**Order change (owner, 1 Nov 2026, after v0.22.0):** item 5 (saved layouts, done in v0.23.0), then 6 (multi-charts, done in
v0.24.0 / v0.24.1); Telegram (3) and the journal (4) next.

5. [x] **Saved chart layouts, per user** (asked 31 Oct 2026): shipped in **v0.23.0**, see Done.
6. [x] **Multi-charts in a layout** (asked 31 Oct 2026): shipped in **v0.24.0** and **v0.24.1** (sync), see Done.
   - Several charts side by side and stacked (vertical and horizontal splits) inside one layout, each with its own contract, timeframe and indicators. Saved with the layout.
   - **Agreed 1 Nov 2026 (owner: "Ok"), in two steps.** v0.24.0: grids 1 / 2 side by side / 2 stacked / 3 (one big + two) /
     2×2, each chart fully its own (contract, timeframe, type, indicators, Pine, its contract's drawings), saved in the
     layout; the active chart (last clicked, highlighted) is what the watchlist, Find, BUY / SELL and the Pine Editor act on;
     trades show on every chart of their contract; crosshair sync (on by default); the phone shows one chart at a time
     with buttons to switch. v0.24.1: contract, timeframe and date-range sync.
   - [x] v0.24.0: grids, each chart its own, the active chart, saved in the layout, crosshair sync, the phone. *(v0.24.0)*
   - [x] v0.24.1: contract, timeframe and date-range sync, each a tick box in the Grid menu (saved
     with the layout). Ticking one lines every chart up with the active chart at once. Date range is matched by time
     (works across timeframes). Phone: contract and timeframe sync apply to all the layout's charts. *(v0.24.1)*
   - Earlier suggestion, 1 Nov 2026: grids 1, 2 side by side, 2 stacked, 3 (one big + two),
     2×2; sync options per layout like TradingView (crosshair, contract, timeframe, date range); the trade panel and the
     BUY / SELL tool act on the chart last clicked (highlighted); the phone shows one chart at a time and swipes between
     them. Each chart's history comes out of the same Fyers data budget (queued), so switching all four timeframes at
     once can take a few seconds.
7. [x] **Measurement tool** (MT5 + TradingView, with net ₹ and R): shipped in **v0.22.0**, see Done.

8. [ ] **CFD prices for prop-firm analysis** (asked 31 Oct 2026: analysis only, for prop-firm trades, not broker trades). **On hold** (owner, 31 Oct 2026).
   - Main source, free: the prop firm's own MT5. A small EA on that terminal sends every bid / ask tick (and back-history) for chosen symbols to the app, so charts use exactly the prices the prop firm fills at (they differ between CFD providers). Works while that MT5 runs (PC or VPS).
   - In the app: every chart type, every indicator / Pine script, the P&F toolkit and paper trading on those symbols.
   - Backup when MT5 is off: a free API (Twelve Data: 800 requests / day, 8 stream symbols "trial"; or AllTick's free stream) for a few forex / gold symbols, labelled as not the prop firm's prices. Global index CFDs have no good free source besides MT5.

9. [ ] **Drawing tools, TradingView's full set** (asked 31 Oct 2026). Built in **v0.22.0**; a few extras left.
   - [x] Lines (trend line, ray, extended, horizontal / vertical line and ray, cross line, parallel channel, regression),
     Fibonacci (retracement, extension, fan, time zones), pitchforks (Andrews, Schiff, modified Schiff), Gann (fan, box),
     shapes (rectangle, ellipse, triangle, path, brush), text / notes / callouts / price label, arrows, price and date
     ranges. *(v0.22.0)*
   - [x] **Magnet** (weak / strong; Ctrl flips it); lock, hide, clone, colours and styles (your last style is the tool's
     default); undo / redo; copy / paste (also to another contract); the drawings list; drawings saved per contract on
     the server. *(v0.22.0)*
   - [x] **Long / short position tools** for looking back: entry, stop and target on past bars, risk, reward, R (net ₹),
     and whether the stop or the target was hit first, and when (on the real candles). *(v0.22.0)*
   - [x] Every chart type (P&F included) and the phone layout. *(v0.22.0)*
   - [x] **The drawing toolbar can be hidden or shown** (asked 1 Nov 2026): ✎ on the chart's top bar, Chart settings, the
     D key; saved on the server. Hiding it never hides the drawings. *(v0.22.0)*
   - [x] **Accurate coordinates in each drawing's settings** (asked 1 Nov 2026): a Coordinates tab like TradingView's, with
     every point's price (on the tick) and date / time (IST) editable, and the bar each time lands on shown. *(v0.22.0)*
   - [x] **Angles** (asked 1 Nov 2026) *(v0.23.1)*: a **Show angle** option on trend line, ray, extended line, arrow, parallel
     channel and regression trend, and a separate **Trend angle** tool. Shows the angle as on screen (degrees, like
     TradingView; it changes as you zoom) and the slope in points per bar (doesn't change with zoom); on P&F the angle in
     boxes and columns (1 box per column = 45°).
   - [ ] Still to add, if wanted: Inside pitchfork, Gann square / fixed square, Fib circles / spiral / arcs, Elliott and
     XABCD patterns, show-on-timeframes per drawing (TradingView's Visibility tab), and drawings shared across a future's
     expiries (today: per contract; copy with Ctrl+C / Ctrl+V).

10. [ ] **Keep the candles the app saw live** (asked 1 Nov 2026; design agreed 1 Nov). Fyers rewrote GOLDPETAL NOV's
    30 Oct after the close (its history and its own chart show a thin day ending at 14,201; the real Friday fell to 13,960
    on heavy volume, as Fyers' live prices still say).
    - **Recording:** the server builds 1-minute candles from Fyers' live feed (open / high / low / close from the price
      snapshots, volume from the growth of the day's volume), per user, in a store of its own beside Fyers' history.
      Other timeframes are built from them.
    - **What's recorded, all session, browser open or not:** the watchlist (every list, once item 11 exists), open
      positions and orders, and any chart while it's open. Inside Fyers' Standard limit of **100 contracts** on the price
      socket, with room left for open charts. A contract added starts recording then (no past); removed: stops, and
      what's recorded is kept until it expires; expired contracts stop on their own.
    - **Use:** Fyers' history stays the source. When the data check (v0.20.8) fails for a day and the server recorded that
      whole session without gaps, the chart uses the live candles for that day, marked on the chart; indicators, Pine and
      P&F use the same candles. A gap (restart, feed down): the warning, as now.
    - **Keep:** settable on the Account page, default **1 year** (about 150 MB for 10 contracts on the 25 GB disk); older
      ones are deleted on their own; the Account page shows the space used.
    - Caveat: built from snapshots, so a spike between two snapshots can be missing from a live candle's high / low.
11. [ ] **Multiple watchlists** (asked 1 Nov 2026; built ahead of item 10 on the owner's word, 1 Nov). The lists are done; recording them waits for item 10.
    - [x] Named lists (e.g. MCX, Index F&O, Stocks), up to 10 of 30: new, rename, delete (two taps, never the last),
      move up / down; a switcher on the Watchlist tab and the phone's Quotes tab; saved on the server. *(v0.21.0)*
    - [ ] The server records the contracts of **all** lists (not just the one on screen) - built with item 10. Deleting a
      list stops recording its contracts unless they're in another list or a trade; what's recorded is kept until it
      expires. A new list records from when its contracts are added.
    - [x] 40 prices per page (was 20); the socket stays inside the 100-contract limit with open trades and orders always
      first; polled quotes in requests of 50. *(v0.21.0)*
12. [ ] **Seconds and tick charts** (asked 1 Nov 2026; **decide after Monday's order-flow check**)
    - Fyers' own seconds candles (5s-45s) need **Prime** and reach back 30 trading days only. On Standard: the live
      recording (item 10) also keeps one-second detail (kept 30 days, settable; about 1.5-2 MB a day per busy contract),
      giving 5s / 15s / 30s charts and tick charts (a bar every N feed updates) for recorded contracts.
    - Caveats: snapshots (merged trades' volume lands on the last trade's price); a tick chart counts feed updates, not
      exact trades, unless Monday's check shows updates are close to one per trade; nothing before recording starts.

## Rules that shape live trading and other users (checked 30 Oct 2026)

Sources: SEBI circular of 4 Feb 2025, NSE's API operating procedures, and Fyers' rules in force from 1 Apr 2026.

- **API orders come only from the static IP whitelisted on that client's own Fyers app.** Each user needs a unique static IP.
  - Sharing is allowed only within family (spouse, dependent parents, dependent children), after Fyers' KYC declaration.
  - A friend is not eligible.
- **Third-party platforms may route orders only if empanelled** and hosted inside the broker's own systems.
  - So on this server: other users get paper trading with prices from their own Fyers app. Live trading is for the owner only.
  - A friend who wants live trading runs their own copy of the app on their own server and static IP.
- **Whitelist the droplet's own IP, 134.209.159.171.** Outgoing traffic from a DigitalOcean droplet uses that IP, not the reserved 68.183.245.178.
- **Live mode limits:**
  - at most 10 orders per second per client, modifications included (so trailing must be paced);
  - market orders become market-price-protection orders;
  - no after-market orders;
  - a Fyers 2FA login every day.
- **Still to confirm with Fyers in writing:** whether a second user's app may fetch market data from this server's IP. (Drafted support request, 30 Oct.)

## Small follow-ups

- [ ] The owner checks the phone layout on his own phone (tested on emulated Android and iPhone screens in Chromium, not on a real iPhone / Safari).
- [ ] Switch the order-flow recorder off after Monday's measurement (Log page): it writes tens of MB a day per busy
  contract on the 25 GB disk.
- [ ] Partial closes.
- [ ] **Fyers support (owner, 1 Nov):** GOLDPETAL26NOVFUT's history for 29-30 Oct doesn't match Fyers' own live prices
  (emailed by the owner 1 Nov; waiting for Fyers). When Fyers fixes it, the app takes the corrected days on its own
  within a week (v0.20.7).
- [ ] Agri MCX contracts use the non-agri rates (low priority: Fyers doesn't offer agri commodities at present).
- [ ] Ask Fyers in writing whether a second user's app may fetch market data from this server's IP (support request drafted 30 Oct).

## Done

- [x] **v0.24.1** (1 Nov): multi-charts, second step (item 6 complete): contract, timeframe and date-range sync.
- [x] **v0.24.0** (1 Nov): multi-charts, first step (item 6): 1 / 2 / 2 / 3 / 2×2 grids, each chart its own, the active chart for the watchlist, BUY / SELL and Pine, crosshair sync, the phone's chart buttons.
- [x] **v0.23.1** (1 Nov): angles on drawings (Show angle on lines, channels, regression; the Trend angle tool; degrees on screen + slope per bar; P&F in boxes).
- [x] **v0.23.0** (1 Nov): saved chart layouts (item 5, asked 31 Oct). Design (1 Nov; Claude's suggestions taken where the
  owner didn't choose, he can change them): a layout holds the contract, timeframe, chart type, indicators and Pine scripts
  with their settings, chart settings, toolbar on / off; **drawings stay per contract**; **auto-save** like TradingView, or by
  hand (●, Save / Ctrl+S, "save first?"); saved on the server per user; a layout holds a list of charts, ready for item 6.
- [x] **v0.22.0** (1 Nov): drawing tools (item 9, extras left there) with a toolbar you can hide / show and exact coordinates in each drawing's settings; long / short position drawings for looking back.
  - [x] **Measurement tool, a mix of MT5 and TradingView** (item 7, asked 31 Oct): MT5's ruler (middle-button drag, figures at
    the cursor) and TradingView's measure box (Shift+click / Shift+drag, the ruler button; green up / red down; points, %,
    ticks, bars, time, volume); the net ₹ for your lots after all charges and R against your trade's current SL; every
    chart type (P&F in boxes).
- [x] **v0.21.0** (1 Nov): multiple watchlists (item 11, the lists; recording them comes with item 10).
- [x] **v0.20.8** (1 Nov): data check on every chart: a warning when the candles disagree with Fyers' live figures for the same day (open, high, low, volume, last price after the close) (asked 1 Nov).
- [x] **v0.20.7** (1 Nov): a day Fyers corrects later reaches the saved candles (the week before is re-checked); v0.20.6's explanation corrected (Fyers rewrote GOLDPETAL's 30 Oct; its own chart shows the same).
- [x] **v0.20.6** (1 Nov): charts show the contract you opened: history no longer asks for Fyers' continuous series (GOLDPETAL NOV's 30 Oct came back as the expiring OCT contract); saved futures / options candles reloaded once; the browser re-takes the last 3 days from the server (reported 1 Nov).
- [x] **v0.20.5** (1 Nov): empty candles at the closing price after MCX closes (no volume, away from the last trade) left off the chart, P&F, indicators and Pine; Chart settings switch (reported 1 Nov).
- [x] **v0.20.4** (1 Nov): P&F zoomed out shows X's and O's (flattened to the column's width, then solid / hollow columns), never thin lines (reported 1 Nov).
- [x] **v0.20.3** (1 Nov): phone: the order sheet shrinks to a bubble in the SELL / BUY bar's place (net ₹ at SL / TP, R, PLACE, ✕), so the whole chart stays in view while you drag the lines; touching the chart shrinks it; SELL / BUY can open straight to the bubble (asked 1 Nov).
- [x] **v0.20.2** (1 Nov): Go to a date (Alt+G) and » back to now (asked 1 Nov); P&F readable at the default zoom; P&F box per timeframe (day charts drew lines).
- [x] **v0.20.1** (1 Nov): any Pine script can calculate on a higher timeframe (e.g. a 15m MA on a 2m chart); Bars of history "Auto": a script extends over all loaded candles when you scroll back.
- [x] **v0.20.0** (1 Nov): bugs reported 1 Nov fixed: indicator settings like TradingView (Inputs / Style / Visibility, the indicator's own timeframe with "wait for timeframe closes"); Pine `import` (TradingView/ta built in, your own saved libraries); older candles load when you scroll left; Fyers' `no_data` no longer fails a history request (Pivot Points' "Not enough data" error).
- [x] **v0.19.0** (1 Nov): the phone layout, like MT5's app (asked 31 Oct): bottom tabs (Quotes · Chart · Trade · History · More), full-height chart with one-tap SELL / BUY, order sheet, position and order sheets (SL / TP steppers, BE, trailing, close), full screen and landscape, LIVE badge and KILL.
- [x] **v0.18.0** (31 Oct): P&F toolkit second set (horizontal counts, traps, catapults, poles, triangles, turtle, anchor follow-through).
- [x] **v0.17.0** (31 Oct): every indicator on every chart type, P&F included (Pine compatibility test); the P&F toolkit (trend lines and breaks, signals, anchors, vertical counts).
- [x] **v0.16.0** (31 Oct): Point & Figure chart type; the order-flow check (records the feed to measure whether it carries every trade).
- [x] **v0.15.0** (31 Oct): chart types (Heikin-Ashi, Renko, range bars, line break, hollow, bars, line, area) with indicators on every type (item 2's first part).
- [x] **v0.14.0** (31 Oct): live mode built (see item 1 above: its first real trade and the charges check are still open).
- [x] **v0.13.3** (31 Oct): roadmap kept as a ticked task list; project instructions updated.
- [x] **v0.13.2** (31 Oct): test kit in `tests/`, handoff notes, live-mode design written down.
- [x] **v0.13.1** (31 Oct): Intraday square-off 5 minutes before Fyers' times (US summer / winter for MCX), Intraday orders cancelled then and refused after; product switch on the chart's PLACE box.
- [x] **v0.13.0** (30 Oct): security and users: two-factor login for everyone with recovery codes, lockout, sessions, encrypted Fyers secrets, security log, step-up codes; admin adds users (paper-only, own Fyers app); several paper accounts per user with a switcher.
- [x] **v0.12.0** (30 Oct): charge rates editable in the app; daily check of Fyers' charges page.
- [x] **v0.11.0** (30 Oct): speed: candles saved on the server and in the browser; Pine scripts update only the live bar.
- [x] **v0.10.0** (30 Oct): full pages (Trades, History, Book, Account, Log); NSE and BSE stocks, indices, F&O, currency.
- [x] **v0.9.0** (30 Oct): hide / collapse indicators; Pine drawings on the candles (force_overlay).
- [x] **v0.8.0–0.8.1** (30 Oct): Pine Editor and your own Pine Script indicators; BE label readable.
- [x] **v0.6.0–0.7.1** (30 Oct): Volume pane, indicators menu (ƒx), BUY / SELL button position.
- [x] **v0.5.0–0.5.3** (30 Oct): volume and order book, candle timer, trailing made visible.
- [x] **v0.4.0–0.4.3** (30 Oct): chart controls, break-even matched to LiveTrader, Last line and chart settings.
- [x] **v0.3.0** (30 Oct): trade from the chart (long / short tool with PLACE).
- [x] **v0.2.0** (30 Oct): paper trading engine net of all charges, rules and guards like LiveTrader.
- [x] **v0.1.0** (30 Oct): plumbing: server, Fyers login, live prices, MCX charts.
