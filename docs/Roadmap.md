# Roadmap: the task list

Updated 5 Nov 2026 (v0.32.0). This is the one task list for the project.
- New tasks are added here as soon as they're agreed, in the order agreed.
- When a task ships, it's ticked [x] with its version and moved to **Done** (details in CHANGELOG.md).
- Half-done tasks stay in **Next** with the finished parts ticked.

## Next, in this order

**Order change (owner, 2 Nov 2026):** the footprint (item 2) is parked after the order-flow check ("Let's park it for now").

**Order change (owner, 2 Nov 2026, 10:50):** item 13 (the option chain's header and lists from the row) is built now, ahead
of item 10.

**Order change (owner, 1 Nov 2026, late):** 4c (trade replay on the chart, below under item 4) was built first
(v0.29.0); item 10 is next.

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
2. [ ] **Candle types and order flow** (moved up 31 Oct 2026). Candle types done in **v0.15.0**, Point & Figure in **v0.16.0**; the footprint is **parked** (owner, 2 Nov 2026) after the order-flow check showed Fyers' feed merges trades.
   - [x] Heikin-Ashi, Renko, range bars, line break, plus hollow candles, bars, line and area. Indicators (Volume, built-ins, your Pine scripts) work on every type, on the bars the chart shows, as on TradingView (asked 31 Oct 2026). *(v0.15.0)*
   - [x] **Point & Figure** chart type (asked 31 Oct 2026): X / O columns, box size (ATR or fixed) and reversal (3 boxes), from closes or highs and lows, with indicators like the other types. *(v0.16.0)*
   - [ ] **Point & Figure toolkit, Definedge-style** (asked 31 Oct 2026). Drawn on P&F charts from the ƒx menu, with signals marked on the chart.
     - **Rule (owner, 31 Oct 2026): every indicator works on P&F charts, not just a few: Volume, every Pine script, and any indicator or Pine feature added in future.** P&F columns are ordinary bars to indicators; a Pine compatibility test (many Pine features, on every chart type) runs before every release, and nothing ships that fails it on P&F.
     - [x] Every indicator on P&F: Pine gets ordinary bars on every chart type (a column closes when the next opens; `close` = the column middle by default, or the last box); the Pine compatibility test (9 scripts, every chart type) runs before every release. MA, BB, RSI and anything else are Pine scripts and work there. *(v0.17.0)*
     - [x] First set: the P&F toolkit (ƒx): 45° trendlines with breaks and the next line after each break; DTB / DBS / TTB / TBS at their trigger box (fresh or continuation); anchor columns (15+ boxes) and their levels; open vertical counts. *(v0.17.0)*
     - [x] Fix (reported 1 Nov): 45° trend lines no longer run on through price after it crossed them. *(v0.27.0)*
     - [x] Second set: horizontal counts; patterns: bull / bear traps, catapults, high / low poles, triangles (symmetrical, ascending, descending), turtle breakouts, anchor follow-through; labels placed without overlaps; a switch per pattern family. *(v0.18.0)*
     - [ ] Mini tops / bottoms: Definedge doesn't publish the rule (the owner can paste it from Definedge's library).
     - [ ] Definedge's own indicators (PMOX, XO Zone %, Noiseless RSI, Smart Don, Oops patterns): their exact rules are in Definedge's logged-in library; built only from their published definitions (the owner can paste them), never guessed.
   - [ ] **Footprint: real trades only, never an estimate** (agreed 31 Oct 2026). **Parked (owner, 2 Nov 2026).** Fyers' API documents no trade-by-trade feed (the tick-by-tick socket is 50-level depth only, NSE / NFO, 1 symbol on Standard); its normal feed sends snapshots with the last trade's price and size and the day's volume.
     - [x] The recorder: the server records every feed snapshot for chosen contracts (default CRUDEOIL and NIFTY futures) and reports how much of the volume arrives as single, exact trades (Log page, admin). *(v0.16.0)*
     - [x] **Measured 2 Nov 2026** (from the open to 10:43 IST; GOLDPETAL added at 10:07). Exact volume (each trade's price and size known): NIFTY 26 NOV FUT **6.6%** (one snapshot held 16,640 qty of trades), CRUDEOIL 26 NOV FUT **25.1%**, GOLDPETAL 26 NOV FUT **18.0%**. The feed sends about one snapshot a second; the rest of the volume arrives merged, its prices and sides unknown. Not enough for a real footprint. Recording switched off 2 Nov 10:42 (the day's file stays in `data/feedcheck/`).
     - [x] Checked 2 Nov: Fyers' own Order Flow (Smart Charts, since Aug 2026) is built from per-trade data (price, quantity, time), buy / sell inferred from the order book at the trade; a Fyers reply (31 Aug, Fyers Community) says order flow is not part of the API and points to the TBT socket instead.
     - [ ] If resumed: (a) ask Fyers whether a trade-by-trade (time & sales) feed exists through the API for NFO and MCX, on any plan; (b) test the TBT socket on NIFTY futures (1 symbol on Standard): its message format has a quote block (`ltp`, `ltq`, `ltt`, `vtt`, `vtt_diff`) that Fyers' docs say can be ignored; if it's filled on every trade, NIFTY's footprint could be exact. TBT doesn't cover MCX (CRUDEOIL, GOLDPETAL).
     - [ ] Then build the footprint (buy x sell volume at each price per bar, delta, cumulative delta, imbalances) only where the trades are exact. Buyer / seller is classified by the bid / ask at the trade, as Fyers' own order flow does.
3. [x] **Telegram alerts:** shipped in **v0.25.0**, see Done. Set up on the real server 1 Nov (owner): the test message arrived and Settings shows "Watchdog: running". A real outage during a live trade is still untried (optional, with the first live trade).
   Asked: a message if the server stops responding while a live trade is open (with the journal's Telegram set-up).
   Design (1 Nov 2026, Claude's proposal on the owner's "let's finish the Telegram alert"; he can change any of it):
   - Your own Telegram bot (the journal's bot can be reused): its token typed only in Settings › Telegram alerts (saved
     encrypted, 2FA code to change); "Find my chat" lists the chats that messaged the bot; a test message button.
   - **A separate watchdog on the server** (its own service, so it still works when the helper has crashed or hung) asks the
     helper every 10 s; no answer for 30 s (settable) while a Live account has a position or an order at Fyers: a message
     with each trade, its stop at Fyers (or "no stop at Fyers: protect it in the Fyers app"), what is paused; a reminder every
     10 minutes (settable) while it stays down; "back" when it answers again. Silent (no sound) outside market hours.
   - **While the helper runs, it reports what stops it looking after a live trade** (each a tick box): a live warning lasting
     30 s (no stop at Fyers, a refused stop change, no Fyers login, a "check Fyers" alert), and no prices for an open live
     trade for 60 s in its market hours (or the price socket down); "sorted" when it clears.
   - **The whole server down** (droplet off, network): nothing on it can send, so an optional outside heartbeat
     (Healthchecks.io, free): the watchdog pings it every minute while a live trade is open and pauses it when flat (with its
     API key; without the key it pings all the time); Healthchecks.io sends its own Telegram message when the pings stop.
4. [x] **Journal: full Octagon port** (three releases done: v0.26.0, v0.27.0, v0.28.0; 4c, the trade replay, done in v0.29.0; 4b waits for the owner's yes) (from `octagon_journal.html`; started 1 Nov 2026, owner: "Let's start the journal").
   It stays on the server (per user); the Cloudflare relay isn't needed (Telegram is only a backup copy, prices come from
   the app's own Fyers candles). The Telegram bot is the one saved in Settings › Telegram alerts.
   Agreed 1 Nov 2026 (owner's answers):
   - **Lockouts block orders, each switchable:** the 2% trailing drawdown from the session peak, the 99 Club break (20 min
     after 3 wins in a row or 3 wins of 2R+) and "numbers running" / session ended refuse new orders like the risk guards,
     each with its own switch in the journal's settings. The 2% line counts closed trades only, net of charges (as Octagon;
     the owner can ask for open P&L to count too).
   - **The 8 pillars word for word**, each pillar's text and the Pillar 1 checks editable in the journal's settings.
   - **Screenshots: server + browser:** the server draws the chart itself at every entry and exit (works with no page
     open); when a chart of that contract is open, its own picture (indicators, drawings) is added too.
   - Money: R and ₹ are the app's net figures (net ₹ after all charges / risk at the first stop), so "2R+ wins" and the
     stretched-target check are after charges. A session = one IST trading day per account; time-of-day buckets are
     Indian (Octagon's Asia / London / NY don't apply).
   In three releases:
   - [x] **v0.26.0:** the Journal page; paper and live trades arrive automatically, per user and account (open trades too;
     past trades taken from each account's history and its archives); the trade list with the octagon seal; the 8-pillar
     audit (Direction + regime + Pillar 1 checks, Wait state, Execution + faults, numbers running, payout pressure, Zen,
     Target), bias / KE, setup tags, plan, review; the session engine and lockouts (blocking, switchable); Today card;
     Reps with hold-to-claim and milestones; stats strip and equity curve (balance / P&L); filters (period, account,
     symbol, side, octagon, regime, tag, search); Octagon rules and pillar text in settings; ground-state practice. *(v0.26.0)*
   - [x] **v0.27.0:** pictures on the server (automatic at entry and exit, server-drawn + the open chart's picture, 📷 on the
     chart bar; your own uploads / paste / drop, labelled by timeframe), the viewer, Telegram backup copy to the journal's
     channel (the bot from Settings › Telegram alerts). *(v0.27.0)*
   - [x] **v0.28.0:** Insights (performance, by symbol / time of day / regime / tag / pillar / weekday, lockout stats,
     rep blocks, the equity chart with drawdown), the weekly Review and calendar with the walk-through and weekly focus
     (summary to Telegram), Copy for Gemini, CSV export, backup / restore. *(v0.28.0)*
   - [x] **4c. Trade replay on the chart instead of pictures** *(v0.29.0)* (asked 1 Nov, owner: "capture which indicators
     were present with what settings and then show the trade on the chart for each completed trade ... we won't need the
     pictures"; design agreed 1 Nov; built before item 10, and built to work with item 10). Replaces the earlier 4c
     proposal (a hidden browser on the server taking the full layout's picture), which is dropped.
     - **Recorded by the server at every entry and exit** (no page needed): contract, timeframe, chart type, Chart
       settings; every indicator on that chart with its inputs, style, visibility and own timeframe; a copy of each Pine
       script's code as it was then (later edits don't change old trades); the contract's drawings as they were then.
       Entry: the chart the order was placed from (a grid's chart, the phone); with nothing open (a stop hit, a limit
       that fills later): the saved layout's chart for that contract.
     - **Every SL / TP move is recorded per position** from this release, so a replay shows the stop stepping. Older
       trades (asked 1 Nov: "why can't we capture this too?"): their path is rebuilt from the account's own log, which
       already notes every stop move with its time (BE, each trail step, SL / TP edits; the last 500 entries per
       account); past that, first and last stop only, marked. Never rebuilt by re-running the trail on candles (an estimate).
     - **▶ Play: the trade as it played out** (asked 1 Nov: "show it like a real trade as it played out"), like
       TradingView's bar replay: candles appear one by one from before the entry (play / pause / step / speed, jump to
       entry / exit); a forming candle builds from the 1-minute candles; indicators and Pine are worked out as each
       candle closes, from what was known then (repainting scripts look as they did live); entry, adds, exit at their
       real prices and times; stop, target and BE move when they moved; running net ₹ and R. Inside a minute: not finer
       than Fyers' 1-minute candles until item 10 / 12's recording exists (the replay will use it then).
     - **▶ On chart** on every finished trade (Journal and History): the chart opens as recorded, with entry / add and exit
       markers, the first stop, the stop's path, the target and BE, scrolled to the trade with candles around it; a bar
       "Viewing trade ..." with ← Back to my chart; switch entry / exit set-up and "my current Pine code"; your layout
       isn't touched; works on the phone. Trades from before: your current set-up, marked "set-up not recorded".
     - **Item 10:** the replay asks for its candles through the chart's normal history path, so once live candles exist,
       a day where Fyers' history is wrong or missing shows the recorded live candles (marked) in the replay too.
     - **Pictures:** automatic pictures (server drawing and the open chart's picture) off by default, one switch brings
       them back; 📷, uploads, paste and drop stay; nothing deleted (owner, 1 Nov).
   - [ ] **4b. Prop-firm journals in the same journal** (Claude's suggestion 1 Nov; waiting for the owner's yes): prop
     accounts as their own accounts (own currency $ and broker clock, never mixed with ₹), the Octagon backup imported
     once, MT5 history import, manual entry with Gemini ticket reading, phases / payouts / account chains. Reps, pillars
     and the review count across all accounts.
**Order change (owner, 1 Nov 2026, after v0.22.0):** item 5 (saved layouts, done in v0.23.0), then 6 (multi-charts, done in
v0.24.0 / v0.24.1); Telegram (3, done in v0.25.0) and the journal (4) next.

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

10. [ ] **Keep the candles the app saw live** (asked 1 Nov 2026; design agreed 1 Nov). Asked because GOLDPETAL NOV's
    30 Oct looked rewritten by Fyers; it wasn't (2 Nov: the app was getting Fyers' continuous series, fixed in v0.30.1).
    Still wanted for: recording every watchlist (item 11), seconds charts (item 12), replays finer than 1 minute, and a
    backup if Fyers' history ever has a gap or a wrong day. Next in the roadmap's order (the owner was asked on 2 Nov
    whether it still comes next, given the reason above).
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
12. [ ] **Seconds and tick charts** (asked 1 Nov 2026). The 2 Nov order-flow check showed the feed sends about one
    snapshot a second and merges trades, so seconds charts can be built from it but exact tick charts (bars of N trades)
    can't.
    - Fyers' own seconds candles (5s-45s) need **Prime** and reach back 30 trading days only. On Standard: the live
      recording (item 10) also keeps one-second detail (kept 30 days, settable; about 1.5-2 MB a day per busy contract),
      giving 5s / 15s / 30s charts and tick charts (a bar every N feed updates) for recorded contracts.
    - Caveats: snapshots (merged trades' volume lands on the last trade's price); a tick chart counts feed updates, not
      exact trades (2 Nov check: updates are not one per trade); nothing before recording starts.

13. [x] **Option chain and watchlist handling** (asked 2 Nov 2026, with a screenshot of the Options tab): shipped in **v0.30.0**.
    - [x] **The chain's header: slim and fixed at the top**, on the desktop and the phone: underlying and expiry on one row
      that never scrolls away (picking another expiry no longer means scrolling back up from the strikes near the price);
      the chain scrolls inside it. It still opens at the strike nearest the price, but only when an underlying or expiry is
      opened, never on its own afterwards; an ATM button goes back there. *(v0.30.0)*
    - [x] **Add to a watchlist from the chain:** a small ＋ beside every CE and PE (★ once it's in a list) opens the list
      picker: every list with a tick if the contract is in it; tapping a list adds or removes it there. Right-click on
      a CE / PE still adds to the list on screen. *(v0.30.0)*
    - [x] **Change a contract's list from the contract itself** (owner: "like a swipe menu in watch list?"): ⋯ on each
      watchlist row (and right-click) on the desktop, swipe left on the phone (Lists · Remove), opening the same picker
      with **Move** to another list in one tap, ticks to keep it in several lists, and Remove. On the phone the row shows ⋯
      (× moved into the swipe and the picker). *(v0.30.0)*

14. [x] **A second server for a friend** (asked 5 Nov 2026: "Option B" - his own server, so he can trade live from his
    own static IP; "This has to work for any linux server. Whether it is digital ocean or otherwise"): shipped in
    **v0.31.0**. Steps: `docs/New_Server_Guide.md`.
    - [x] One script does everything, on any Linux server with systemd (apt or dnf systems), at any provider: pasted into
      the provider's start-up box (one line to change: the repo) or run over SSH. It installs the server, makes its
      read-only deploy key, shows it (`sudo fyers-status`) with where to add it on GitHub, waits for access, then clones
      and installs by itself, and then shows the address and setup code. *(v0.31.0)*
    - [x] Any repo: the owner's (a second deploy key on it), the friend's fork, or his own copy. An optional branch to
      follow (e.g. `stable`), so the owner can choose which releases reach that server. *(v0.31.0)*
    - [x] Each server keeps its own address, outgoing IP and branch in `/etc/fyers/server.conf` (not in Git), so an
      update never points one server at the other's address. *(v0.31.0)*
    - [x] The Live dialog names the server's own outgoing IP, not the owner's 134.209.159.171. *(v0.31.0)*
    - [ ] The friend's first real boot (untested on a real droplet until he does it).

15. [x] **LiveTrader 1.24's changes** (owner, 5 Nov 2026: "I introduced some new changes to the livetrader. Can you check
    and update the fyers paper trader?"; the EA went from 1.21 to 1.24): shipped in **v0.32.0**.
    - [x] **RR box and lock** under BUY / SELL: typing an RR moves the tool's target; locked, moving the stop moves the
      target and moving the target moves the stop. Net of all charges at the sized lots (worked out on the server). Also
      beside the ticket's R and on the phone. *(v0.32.0)*
    - [x] **Per-trade trailing** on the entry line (already in the app): typing an R switches it on; the panel's Trail BE /
      Trail SL takes every trade back (switch and R); own / as-the-panel shown; BE-T "done". *(v0.32.0)*
    - [x] **Tool gap** (Chart settings, 30 px after the live candle's right edge). *(v0.32.0)*
    - [ ] Owner's choice: unlocked, should the target stay where it is when the stop moves (LiveTrader), or keep following
      the R until it's dragged (the app today)?

## Rules that shape live trading and other users (checked 30 Oct 2026)

Sources: SEBI circular of 4 Feb 2025, NSE's API operating procedures, and Fyers' rules in force from 1 Apr 2026.

- **API orders come only from the static IP whitelisted on that client's own Fyers app.** Each user needs a unique static IP.
  - Sharing is allowed only within family (spouse, dependent parents, dependent children), after Fyers' KYC declaration.
  - A friend is not eligible.
- **Third-party platforms may route orders only if empanelled** and hosted inside the broker's own systems.
  - So on this server: other users get paper trading with prices from their own Fyers app. Live trading is for the owner only.
  - A friend who wants live trading runs their own copy of the app on their own server and static IP (v0.31.0:
    `docs/New_Server_Guide.md`, any Linux server).
- **Whitelist the droplet's own IP, 134.209.159.171.** Outgoing traffic from a DigitalOcean droplet uses that IP, not the reserved 68.183.245.178.
- **Live mode limits:**
  - at most 10 orders per second per client, modifications included (so trailing must be paced);
  - market orders become market-price-protection orders;
  - no after-market orders;
  - a Fyers 2FA login every day.
- **Still to confirm with Fyers in writing:** whether a second user's app may fetch market data from this server's IP. (Drafted support request, 30 Oct.)

## Small follow-ups

- [x] The owner checks the phone layout and the order bubble on his own phone (owner, 1 Nov: "working").
- [x] Switch the order-flow recorder off after the measurement (Log page): done 2 Nov 10:42 (the contract list is kept,
  with GOLDPETAL26NOVFUT added; recording is off).
- [ ] Partial closes.
- [ ] **Copy for Gemini after midnight** (found in testing 2 Nov, v0.28.0's feature): "today" and "this week" pick trades by
  the calendar date, but a trade between midnight and the account's day reset (an MCX night) belongs to the previous
  trading day, so at 01:00 "today" is empty. Proposal: use the trading day, as the journal's sessions do. Waiting for the
  owner's word (it changes which trades a copy includes).
- [x] **Telegram alerts on the real server (owner, 1 Nov):** bot set up, test message received, "Watchdog: running".
- [ ] Optional, with the first live trade: `systemctl stop fyers-helper` for under a minute -> the "isn't responding" message,
  then start it -> "answering again". Optional: the Healthchecks.io check.
- [x] **Fyers support (owner, 1 Nov):** GOLDPETAL26NOVFUT's history for 29-30 Oct. Fyers replied 2 Nov: their data is
  right; their chart's Continuous Futures setting (on by default) showed the OCT contract. Checked on the server the same
  evening: the app's requests got the continuous series too (Fyers sends it unless cont_flag=0). Fixed in **v0.30.1**.
- [ ] Agri MCX contracts use the non-agri rates (low priority: Fyers doesn't offer agri commodities at present).
- [ ] Ask Fyers in writing whether a second user's app may fetch market data from this server's IP (support request drafted 30 Oct).

## Done

- [x] **v0.32.0** (5 Nov): LiveTrader 1.24's changes (item 15): the RR box and lock under BUY / SELL (also the ticket and the phone; the stop for a moved target worked out net of all charges at the sized lots, with a message when the rules or the charges stop it); per-trade trailing like 1.24 (a typed R switches it on, the panel takes the trades back, own / as-the-panel, BE-T done); the tool gap.
- [x] **v0.31.0** (5 Nov): a second server for a friend, on any Linux server (item 14): `server/startup.sh` sets it all up and finishes the install once its deploy key is on GitHub; `sudo fyers-status`; any repo (owner's, fork, own copy) and an optional `stable` branch; each server's own address / outgoing IP / branch in `/etc/fyers/server.conf`; the Live dialog names the server's own IP; `docs/New_Server_Guide.md`.
- [x] **v0.30.3** (3 Nov): an indicator's buttons (👁 ⚙ { } ✕) come right after its name and its values wrap within the chart, so a script with many values (MultiPivot) never pushes them off the screen (asked 3 Nov).
- [x] **v0.30.2** (3 Nov): before the open, no false "candles don't match" warning (Fyers' live figures are already today's pre-open ones; the check now works out their day from Fyers' previous close; a day missing from the candles is flagged as **Latest day**) and no extra pre-open candle on intraday charts (reported 3 Nov, NIFTY 50 at 09:14).
- [x] **v0.30.1** (2 Nov): futures and options charts show the contract itself: every history request asks Fyers for continuous data off (cont_flag=0; Fyers' API gives the continuous series otherwise, so GOLDPETAL NOV's 30 Oct was the expiring OCT contract); saved futures / options candles reloaded once; v0.20.7's "Fyers rewrote the day" corrected.
- [x] **v0.30.0** (2 Nov): the option chain's header stays at the top (underlying, expiry, ATM on one row; only the strikes scroll; opens at the nearest strike only on open); ＋ / ★ beside every CE / PE to put it in any list; a watchlist row's ⋯ / right-click / phone swipe to move it to another list or remove it (item 13). Also recorded: the 2 Nov order-flow check and the footprint parked.
- [x] **v0.29.0** (2 Nov): the trade replay (item 4c): each trade's chart set-up recorded at entry and exit (indicators with their settings, Pine code, drawings), ▶ On chart in the Journal and History with the trade and the stop's path drawn, ▶ Play to watch it as it played out; every stop / target move recorded (older trades from the account's log); automatic pictures off.

- [x] **v0.28.1** (1 Nov): multi-chart grids work on the server (Caddy refused frames: `X-Frame-Options DENY` → SAMEORIGIN; reported 1 Nov).
- [x] **v0.28.0** (1 Nov): the journal's last step (item 4): Insights, the weekly review with the outcome × process grid, walk-through and calendar, the summary to Telegram, Copy for Gemini, CSV, backup and restore.
- [x] **v0.27.0** (1 Nov): journal pictures (item 4, second step): the server draws each trade at entry and exit, the open chart adds its own picture, 📷 on the chart bar, your own uploads / paste / drop labelled by timeframe, the viewer, the Telegram backup copy; P&F trend lines no longer run on after price crossed them (reported 1 Nov).
- [x] **v0.26.3** (1 Nov): Release to GitHub puts this version's whole changelog entry into the commit message.
- [x] **v0.26.2** (1 Nov): release instructions for the organization's token (README, the tool's hints, project instructions).
- [x] **v0.26.1** (1 Nov): Release to GitHub (`tools/github_upload.html`): a zip goes in as one commit through GitHub's API, only changed files, no 100-file limit (asked 1 Nov, after the 120-file v0.26.0 zip was refused by github.com's uploader).
- [x] **v0.26.0** (1 Nov): the journal, first step (item 4): the Journal page; trades arrive on their own; the 8-pillar audit; the session engine with lockouts that refuse orders (switchable); Today, Reps, stats and curve, filters, settings.
- [x] **v0.25.0** (1 Nov): Telegram alerts for live trades (item 3): the server not answering (a watchdog service of its own), a live warning lasting 30 s, no prices for 60 s; your own bot, Find my chat, test message; optional outside heartbeat (Healthchecks.io) for the whole server being down.
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
- [x] **v0.20.7** (1 Nov): a day Fyers corrects later reaches the saved candles (the week before is re-checked); v0.20.6's explanation corrected (Fyers rewrote GOLDPETAL's 30 Oct; its own chart shows the same). *(That correction was itself wrong: see v0.30.1.)*
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
