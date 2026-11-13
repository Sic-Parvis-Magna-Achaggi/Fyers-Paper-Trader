# Roadmap: the task list

Updated 13 Nov 2026 (v0.43.5: 👁 / H hides the trades' bars and zones; v0.43.4: with the unit button on, only its unit is shown; v0.43.3: ✕ alone at the left of the position bar; v0.43.2: the unit button on the phone; v0.43.1: a unit button on the position bar, item 22; v0.43.0: strategies, item 23 stage a). This is the one task list for the project.
- New tasks are added here as soon as they're agreed, in the order agreed.
- When a task ships, it's ticked [x] with its version and moved to **Done** (details in CHANGELOG.md).
- Half-done tasks stay in **Next** with the finished parts ticked.

## Next, in this order

**Order change (owner, 12 Nov 2026):** items 23-29 added ("All your ideas are great. Add it to the roadmap"); **item 23
(strategies that trade by themselves) is built next** ("We should first do strategy for Live, Paper and MT5"). The order
of 24-29 is Claude's suggestion (the owner can change it). Item 10 stays, after 23-29 (owner: "Keep it, later").

**Order change (owner, 5 Nov 2026):** item 16 (the Live account is the Fyers account) is built next, before item 1's
first real trade. Built in **v0.33.0**: item 1's first real trade is now made on the new Live account.

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
   - [ ] **First real trade (the owner):** whitelist the droplet's own IP **134.209.159.171** in the Fyers API app with order permission, switch the page to LIVE (top left, v0.33.0), and test with 1 lot on MCX: entry, the stop at Fyers, a trail move, BE, a close with ✕, and the kill switch. Then one trade placed in the Fyers app (its NO STOP flag, Place my stop) and one with a stop placed in Fyers (adopted). Report anything odd with a screenshot.
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

**Order change (owner, 10 Nov 2026, 23:34, after v0.36.0: "the 1.10 compiled fine and is connected to the app. Finish
everything"):** the rest of item 8 (b) - b2 and b3 - built at once, as one release (**v0.37.0**, EA 1.20). (c) waits for the
owner's yes to 4b; (d) is "a later stage" (owner, 10 Nov).

**Order change (owner, 10 Nov 2026: "Let's build this. If they come back saying no, we can have the local setup as
fallback"):** item 8 is built now, stage by stage. Stage a shipped in **v0.34.0**.

8. [ ] **MT5 (FundingPips): prices, charts, trading and the journal from this app** (asked 31 Oct 2026 for analysis
   only; widened 5 Nov 2026 to trading: "It will be interesting to be able to trade from this platform on MT5? Like I have
   so many things like PnF charts which are not possible on MT5"). **Not started. Its place in the order is the owner's
   to choose** (the analysis part was put on hold on 31 Oct). *(Started 10 Nov: see the order change above.)*
   - **FundingPips' answers (support email thread, 6-9 Nov 2026):**
     - 6 Nov (Deekshitha): the EA "will be allowed as it is self-coded by you"; "make sure that you are not using any VPS
       or VPN, even in the future"; the team may ask for source code files later.
     - 8 Nov (owner's description of the set-up): the EA on his laptop only, the charting app on DigitalOcean; the EA
       passes prices to the app by WebRequest; the app's trade requests go back to the EA, which executes them.
     - 9 Nov (Tobi): if the EA is your own and uses no forbidden strategy, proof of ownership when requested; the
       Responsible Trading Team makes the final decision. 9 Nov (Emem): full automation is permitted with proof. Proof
       that may be accepted: the uncompiled .mq5 source; version-control history showing it developed step by step;
       development-environment evidence (screenshots, compile logs, file paths under your user folder); explaining the
       EA's logic on a live call. A compiled file alone is not proof.
     - 6 Nov 3:08 PM (Deekshitha, to the owner's "a separate server on Digital Ocean that I have with an IP address"):
       "Unfortunately, the EA can't be hosted at a different IP address. It should be on local host only." The owner's
       8 Nov description (EA on the laptop, app on DigitalOcean) was answered only in general terms (9 Nov), so **an
       explicit yes to this exact set-up is still needed before a paid challenge or Master account** (asked 10 Nov).
     - 10 Nov 7:29 PM (Alice, FundingPips' AI support assistant, to the owner's 5 Nov email): your own EA is permitted
       without approval beforehand, full automation included, on challenge and Master accounts, with proof of ownership if
       asked; the VPN / VPS rule is about the account connection: MT5 on the home connection without VPN / VPS and a
       charting server that never logs in to the account is what the rules address; "server execution" isn't defined.
       Keep the source and its history, keep the IP region the same, copy nothing in. "An explanation of the rules, not a
       ruling on your setup." Hedging inside one account and the news window: asked again 10 Nov (owner's reply email).
     - 10 Nov 8:12 PM (Alice, to that reply): **hedging is not allowed, even in MT5 Hedge mode**: no buy and sell on the
       same pair at the same time, no exceptions ("including for supply and demand zone trading and for opposite trades
       on different instruments"); the team checks at the end of the evaluation and before any reward, even without an
       alert at the time. An opposite position opened by mistake and closed at once is reviewed case by case; repeated:
       a violation. The published rule is about one pair; positions split across accounts: no separate ruling; copy or
       coordinated trading across accounts of different people is forbidden. **News:** login 21182752 is **Phase 1 of
       the 2-Step evaluation**: no restriction on holding through news, but purposely trading news is prohibited. **On a
       Master account:** no opening or closing from 5 minutes before to 5 minutes after a high-impact release on the
       affected currencies (profits from trades opened or closed in it are deducted); holding through it is allowed. The
       official source: the Economic Calendar on the FundingPips dashboard (high-impact in red).
   - **Plan B if FundingPips says no to the server:** the app itself runs on the owner's laptop for MT5 accounts (the same
     code, Windows), with the EA talking to it on localhost only; nothing leaves the laptop except MT5's own connection.
   - **Answered by FundingPips** (10 Nov, above): the set-up (an explanation of the rules), hedging, the news window.
     **Owner, 10 Nov 2026:** opposite trades on different instruments (long EURUSD with short GBPUSD) are allowed: "it is not
     same instrument hedging". **News calendar (owner, 10 Nov): ForexFactory.**
   - **Build it as described to FundingPips on 8 Nov:** the EA on the laptop calls out to the server with WebRequest (for
     prices up and for the orders waiting for it); nothing calls in to the laptop. A change to that (e.g. MT5 sockets)
     is told to FundingPips first.
   - **Design (5 Nov 2026, Claude's proposal; the owner's corrections marked):**
     - **A bridge EA of the owner's own** in the FundingPips MT5 terminal, connecting out to the server (MT5's
       allowed-URL list). It sends bid / ask ticks and back-history up and carries out the app's orders (open with SL /
       TP, BE, trail, close). The MT5 password never leaves the terminal.
     - **Proof of ownership built in:** the EA's source lives in the repo (`mt5/`) from its first version, so GitHub's
       history shows it developed step by step; no compiled .ex5 in the repo: the owner compiles it in his own MetaEditor
       (compile log, his user folder); a plain-language walk-through of its logic for the live call.
     - **MT5 runs on the owner's own PC at home, not a VPS** (FundingPips: no VPN / VPS while trading, same IP region). The
       server never logs in to FundingPips. PC off: the app refuses new MT5 orders ("MT5 link down"); open trades keep
       their real SL / TP at FundingPips.
     - **Prices only from FundingPips' own MT5** for trading (stops fire on its bid / ask; the firm measures drawdown on
       its prices). Every chart type, indicator, Pine script and the P&F toolkit work on them. Footprint / order flow and
       the Order Book are off for MT5 symbols (a CFD has no real trades, only tick volume).
     - **Stops at the broker:** every position has a real SL (and TP) in MT5 from the moment it opens, moved by the app
       (like item 1's live design). If the link drops, the EA can keep trailing by itself (LiveTrader's logic).
     - **Hedge mode:** each entry is its own MT5 position with its own ticket, SL and TP (as LiveTrader's multiple entries).
     - **Hedging (FundingPips, 10 Nov: not allowed in one account, even in Hedge mode; this replaces the owner's 5 Nov
       reading and the per-account switch):** the app refuses an order opposite an open position or pending order on the
       same symbol in the same FundingPips account, and (to be safe, no ruling from FundingPips) one opposite a position
       in the owner's other FundingPips accounts. Adding to a position on the same side stays allowed. Different
       instruments are allowed (owner, 10 Nov): the check is per symbol only.
     - **News guard (FundingPips, 10 Nov):** each MT5 account has its phase (evaluation / Master). Master: no opening and
       no manual closing from 5 minutes before to 5 minutes after a high-impact release on the symbol's currencies (the
       broker's own SL / TP can still fire inside it: a warning beforehand). Evaluation: no block, a warning ahead of
       high-impact news (purposely trading news is prohibited). The calendar: **ForexFactory** (owner, 10 Nov), its
       high-impact events for the symbol's currencies (FundingPips' dashboard calendar stays the official one).
     - **No copying in:** every MT5 order comes from the owner's own click; nothing from Fyers or anywhere else is mirrored in.
     - **Money (owner's answer, 10 Nov 2026: "$, net of FundingPips costs"):** MT5 trades in the account's currency ($):
       SL, TP, risk, P&L, R and BE net of commission (typed per symbol, checked against MT5's real deals) and swap; the
       spread is paid through the bid / ask fills, as in MT5 and LiveTrader. Not Indian charges.
     - **Guards:** daily / overall drawdown from the owner's FundingPips dashboard for the challenge type; a news guard (no
       new orders N minutes either side of high-impact news).
   - In three steps, each tested on the FundingPips demo (SIM1, Hedge) first:
     - [x] (a) MT5 prices and charts only (no trading): the bridge EA `mt5/FTM_Bridge.mq5` 1.00 (calls out only, places no
       orders; walk-through for FundingPips in `mt5/README.md`), Settings › MT5 bridge (key with 2FA, terminals, price
       source, the broker's clock), MT5 in the Prices pill, Find (MT5 button), every chart type / Volume / Pine on MT5 candles, the
       broker's day for candles, the phone. *(v0.34.0)* **The owner compiled the EA and it streams XAUUSD from the
       FundingPips demo into the app (10 Nov 2026, 21:45: "It compiled and I'm seeing the gold chart on the app").**
     - [ ] (b) Trading through the bridge. **Design agreed 10 Nov 2026** (the owner's answers marked), built in slices:
       - **Several MT5 accounts, apart from Fyers** (owner: "it need not be limited to 1 mt5 account. We need a way to
         switch between accounts. And I don't want to confuse this with the fyers side"): a third side on the top-left
         switch, **PAPER | LIVE | MT5** (MT5 in its own colour). On the MT5 side the account switcher lists only the MT5
         accounts, one per login whose terminal has called (each MT5 terminal on the laptop runs the EA): "● 21182752 ·
         FundingPips-SIM1 · DEMO · $5,012.50". Fyers never appears there and MT5 accounts never on the Live side. Going
         to MT5: a fresh 2FA code (the login typed once per account was dropped in v0.37.1, owner 11 Nov: "I'm the only one
         trading. We don't need so much security"). The admin only.
       - **Each MT5 account is its own account:** its own rules, history, journal account, kill switch (that account
         only). Prices for charts still come from the price terminal (Settings › MT5 bridge).
       - **Money: $, net** (owner, 10 Nov): gross from MT5's tick value; **commission learned from MT5's real deals**
         per symbol (owner's answer), a typed default until the first trade, a warning if a later deal differs; swap from
         the position. Spread paid through bid / ask fills.
       - **Loss limits like FundingPips** (owner's answer): daily loss from the balance at the broker's midnight; max loss
         from the account's starting size, typed once (e.g. $5,000); the percentages per account; the phase (evaluation /
         Master) per account.
       - **Orders at the broker:** market, limit, stop, each with its real SL and TP in MT5 from the start; BE, BE-T and
         TRAIL move the broker's SL (never below BE + costs, never backwards); a close is a market close at MT5. Volume in
         the symbol's steps (0.01 lot). **No opposite trade on the same symbol** in an account or across the MT5 accounts
         (FundingPips, 10 Nov); different symbols are fine (owner, 10 Nov).
       - **Trades placed in MT5 itself** show and are managed like the app's (as with Fyers).
       - Slices: **b1** the MT5 side and accounts; positions, orders, balance and history read from MT5; manage them
         from the app (SL / TP, close, BE, BE-T, TRAIL); net $; the FundingPips limits shown. **b2** placing orders from
         the app (ticket, chart tool, PLACE) with sizing, the guards and the no-hedging check. **b3** the EA keeps
         trailing if the link drops; the news guard (**ForexFactory**, owner 10 Nov: Master blocks opening / closing
         ±5 min of high-impact news on the symbol's currencies, evaluation warns); the MT5 kill switch.
       - [x] **b1** *(v0.36.0)*: PAPER | LIVE | MT5 (purple; a fresh 2FA code); one account per MT5 login whose terminal
         runs FTM Bridge **1.10** (made when it first calls; the switcher lists only them on the MT5 side); positions,
         pending orders, balance / equity / margin and history straight from MT5 (MT5's last 90 days the first time, then
         every close booked from MT5's own deal); trades placed in MT5 shown and managed; SL / TP drags, BE, BE-T, TRAIL,
         ✕ and pending orders moved / cancelled change the real trade through the EA (MOD / CLOSE / CANCEL / OMOD, each tag
         run once; paced 2 s per trade, 30 a minute: FundingPips' no server spamming); a stop moved in MT5 adopted; the app's
         stop passed before MT5 took it -> a market close; the login typed once per account; $ net of commission (learned
         per symbol and side from MT5's deals; typed default; a change flagged) and swap; FundingPips' daily floor (the
         broker's-midnight balance, from MT5's deals) and max floor (typed starting size) shown. EA 1.10 calls out only and
         **opens no new trades** (input AllowTrading). The journal leaves MT5 accounts out until (c). **Not run on a real
         MT5 yet** (the owner compiles 1.10 and tries it on the demo: see Handoff).
         **EA 1.10 compiled and connected by the owner (10 Nov, 23:34).**
       - [x] **b2** *(v0.37.0)*: placing from the ticket / chart tool / MT5 PLACE (market, limit, stop, each with its real SL /
         TP in the same request; EA 1.20's OPEN, tied back by the comment "FTM <tag>": the trade is the app's, its planned stop
         1R, its trailing); sizing by risk % / $ / lots in 0.01 steps within MT5's min / max; margin from MT5's OrderCalcMargin;
         the guards (FundingPips' floors, risk cap, open risk, margin, max trades, SL required); **no hedging** on the same
         symbol in the account or across the MT5 accounts; never sent twice, dropped if not delivered in 10 s.
       - [x] **b3** *(v0.37.0)*: the MT5 kill switch (close all, cancel all, pause until Resume with 2FA); the news guard
         (ForexFactory's calendar read hourly on the server; high-impact events on the symbol's currencies; Master: no opening /
         closing from the app ±5 min, evaluation: a warning; the kill switch never blocked); the EA trailing by itself
         (TRAIL lines, OfflineTrailSec 20 s, the same rules, never looser) when it can't reach the app, its moves taken as the
         trail when the link is back. **Not run on a real MT5 yet** (the owner compiles 1.20 and tries it on the demo).
     - [ ] (c) The journal for prop accounts (joins 4b) and FundingPips' rules. Split on 11 Nov 2026 (owner asked why MT5
       trades weren't in the journal: they were left out by design until (c)):
       - [x] **c1. MT5 trades in the Octagon journal** *(v0.39.0)* (owner, 11 Nov 2026, 22:35). **Not seen on a real MT5 yet.** Every MT5 account's trades
         arrive like paper / live ones (placed from the app or in MT5 itself; MT5's history filled in), with the 8 pillars,
         reps, tags, review, Insights, CSV and the replay. The owner's answers:
         - **Money in $, kept apart from ₹** ("yes"): each trade in its account's currency; the journal shows one currency
           at a time (₹ | $), never added together. R stays net (commission and swap).
         - **Session day: both** ("can be both"): a choice per MT5 account in Journal › Settings: the broker's day
           (FundingPips' daily reset, the default) or the Indian day (IST, from 06:00 like the Fyers accounts).
         - **Lockouts on MT5: an option with 2FA** ("Keep it as an option with 2FA"): a switch per MT5 account, off until
           you turn it on; changing it either way asks for a fresh 2FA code. With it on, the 2% line, the 99 Club break
           and session over refuse new MT5 orders (each still with its own switch); closing, BE, trailing and stops never.
         - **The 2% line is of FundingPips' day-start balance** ("day's starting balance from Fundingpips"): the balance at
           the broker's midnight (from MT5's own deals), for the session's broker day.
       - [x] **c1b. Keep each MT5 trade's candles for its replay** *(v0.39.1)* (owner, 11 Nov 2026, 23:52: "yes"; asked "What happens to
         replay charts on history? Will we store data or request data from MT5 if it is not available and store it? What
         amount of period should we store?"). MT5 keeps only so much history (about 100,000 bars by default: 2-3 months of
         1-minute candles) and MT5 may be off when a replay is opened, so when an MT5 trade closes the server asks MT5 for
         the candles around it and keeps them with the journal, as long as the trade is in the journal: 1m / 5m / 15m from a
         day before the entry to an hour after the exit (▶ Play's forming candles), and the chart's own timeframe from
         1,500 candles before the entry (indicators' warm-up). About 50-100 KB a trade. Trades from MT5's history (closed
         in the last 120 days) fetched the same way in the background, newest first; nothing fetched while MT5 is off (it
         waits). Charts and the replay use them wherever the saved candles lack them. In the journal's backup too. Normal
         chart candles stay as they are (kept, never deleted).
       - [ ] c2. The prop-firm parts of 4b (phases, payouts, account chains, the Octagon backup import): still waiting for
         the owner's yes.
     - [x] (b4) **Day-end close for MT5 accounts** *(v0.40.0)* (owner, 12 Nov 2026, 00:26: "I wanted to know if the fyers version already
       has an automatic close 5 minutes before the end of the day ... can I set for MT5". The Fyers side already has it:
       intraday square-off 5 min (settable) before Fyers' times. Owner's answers, 00:28): **X minutes before the broker's
       day ends** (its midnight); **every day or only before the weekend**, an option; **all trades, or only the trades I
       choose**, an option. Design: Account › rules of each MT5 account (off at first; minutes 1-240, default 5); at that
       time the trades it covers are closed at market in MT5 and their pending orders cancelled, and new orders it would
       cover are refused until the broker's new day; "only marked trades": the ticket's **At the day end: Close it / Hold**
       (the chart tool's DAY END / HOLD) marks new orders and stays the default (trades placed in MT5 itself take it too);
       ⏱ on each trade (panel, Trades page, the phone's sheets) changes its own. MT5 off at that time: a warning, it closes
       when MT5 is back before the broker's midnight. Not blocked by the news guard (like the kill switch; a warning if inside
       the window).
       - [x] **By each symbol's own trading hours** *(v0.41.0, EA 1.23)* (owner, 12 Nov 01:04: "Can't you get it from the MT5
         symbols?" - "ok"): the EA sends each symbol's sessions (SymbolInfoSessionTrade); the close is X min before that
         symbol stops trading that day (Friday's early closes included); the broker's midnight when MT5 lists none or the EA
         is older. Holidays only if the broker updates the sessions.
     - [ ] (d) **Copy trades between MT5 accounts, later** (owner, 10 Nov: "in the roadmap, we can also have copy trades for
       a later stage"). FundingPips allows copying between your own FundingPips accounts (and out to an external
       account), not into one from outside; and no hedging across accounts, so copies only ever go the same way. Design
       when we get there (lead / followers, lot scaling by balance or equity).
   - Backup prices when MT5 is off (analysis only, labelled as not the firm's prices): a free API (Twelve Data: 800
     requests / day, 8 stream symbols "trial"; or AllTick's free stream) for a few forex / gold symbols.

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

10. [ ] **Keep the candles the app saw live** (asked 1 Nov 2026; design agreed 1 Nov). **Kept, after items 23-29** (owner,
    12 Nov, after asking whether it was the recorder that ruled out the footprint: no, that was item 2's order-flow check;
    this item records 1-minute candles and was never built). Asked because GOLDPETAL NOV's
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

16. [x] **The Live account is the Fyers account, not a paper account switched to Live** (owner, 5 Nov 2026: "since Live
    trading is directly on the broker, why should we have Live options for paper accounts. Paper accounts are
    different"): shipped in **v0.33.0**. Design agreed 5 Nov 2026 (the owner's answers are marked). **Order (owner, 5 Nov
    2026):** next, before item 1's first real trade, so that trade is made on the new Live account.
    - [x] **Two kinds of account:** *(v0.33.0)*
      - **Paper accounts:** simulations, as many as you like, each with its own made-up capital. They never touch
        Fyers and have **no Live option at all** (the Account page's "Turn on LIVE" goes).
      - **One Live account:** the admin's Fyers account itself (named by the Fyers client ID). It isn't converted from
        a paper account and is never switched "back to Paper". Live stays the admin's only.
    - [x] **Paper / Live toggle at the top left, next to "Trade Manager"** (owner's answer 3): **Paper = green**, **Live =
      red**. Admin only; other users see no toggle. *(v0.33.0)*
      - **It's the safety switch.** Turning Live on asks for the Fyers client ID typed and a fresh 2FA code (as turning
        an account Live does today). Back to Paper is one click. (Built per login: each browser / phone confirms for
        itself; the server refuses Live changes from a page on Paper, the kill switch excepted.)
      - **What it switches:** which side the page trades on. On Paper, the account switcher lists the paper accounts and
        BUY / SELL / PLACE are paper. On Live, the page shows the Live account and every order is real (the red LIVE
        switch, LIVE on PLACE, the kill switch, as now).
      - **It never stops the server managing Live trades** (owner's answer): with the toggle on Paper, the server still
        watches the real positions (stops, trailing, BE, targets, square-off, alerts). The toggle only decides where the
        page's new orders go. It also shows in the phone's top bar.
    - [x] **Balance: the real Fyers balance** (owner's answer 1). The Live account's balance, equity, margin and free funds
      come from Fyers' funds (both ledgers). *(v0.33.0)*
      - **% rules** (daily loss, max loss, risk %, risk cap, margin use, open risk) count from those real figures: the
        daily loss from the day's starting balance as Fyers reports it.
      - **No typed "capital for the rules"** on the Live account (the size: the Fyers balance on the day Live was first
        switched on, plus money moved since).
      - **Money in and out:** a deposit or withdrawal isn't a loss or a profit (as LiveTrader 1.18's balance
        operations; here the size moves by it too, as it's your own account, not a prop account).
    - [x] **Every trade on the Fyers account is shown and managed** (owner's answer 2): placed from this app or straight in
      Fyers (the Fyers app, web, another platform). *(v0.33.0)*
      - **Read from Fyers** (its order updates, which don't count against the API limits, plus the order and position
        books as a fallback): positions, pending orders, fills, adds and partial exits made outside the app. Each one is
        tagged "from Fyers" when it didn't come from the app.
      - **Managed like the app's own:** SL / TP lines, BE, BE-T, TRAIL, ✕ close, the kill switch, the guards, intraday
        square-off, Telegram alerts, net ₹ / R after all charges, the journal.
      - **A stop placed in Fyers is adopted** as the trade's stop: that same order is moved by trailing / BE (its type
        kept), so there's never a second exit order at Fyers (the rule from item 1). Its first stop sets 1R.
      - **A pending order placed in Fyers** shows on the chart; you can move or cancel it here.
    - [x] **Records:** History, the journal (an account named by the client ID, as the brief says) and CSV hold every Live
      trade, the outside ones too, marked as such. *(v0.33.0)*
    - [x] **Today's Live accounts:** an account switched Live under the old design goes back to Paper on the upgrade, its live
      trades archived. Any real position it has is picked up by the new Live account from Fyers anyway. *(v0.33.0)*
    - [x] **A trade placed in Fyers without a stop** (owner's answer): flagged red ("no stop at Fyers"), with a one-tap button
      that places your default stop (the stop distance remembered for that contract, else the tool's default) at Fyers.
      Nothing is placed without the tap. BE / BE-T / TRAIL start once it has a stop (its first stop sets 1R). *(v0.33.0)*
    - [x] **Delivery holdings** (owner's answer: **shown and managed**): each holding is a Live trade like the others: P&L
      after all charges, SL / TP, BE, BE-T, TRAIL, ✕ to sell, the no-stop flag and its one-tap stop. *(v0.33.0)*
      - **Never squared off:** they're delivery. (Built: Close all and the kill switch keep them too; ✕ sells one.)
      - **Selling shares through the API needs your Fyers account's authorisation** for selling from the demat (CDSL
        DDPI or the daily eDIS / TPIN). Without it, Fyers refuses the stop or sell order, and the app shows Fyers' reason
        on the holding.
    - [ ] **To confirm on the real Fyers account** (with item 1's first real trade): the funds titles and both ledgers'
      figures; "Fund Transfer" for a deposit / withdrawal; the holdings' `quantity` (start of day) next to today's CNC
      position; outside orders arriving on the order socket; an SL-M placed in Fyers moved by the app; a real eDIS refusal.
    - [ ] **Owner's choice (judgement calls made in v0.33.0, each one switch away):** Close all and the kill switch keep
      delivery holdings; money moved in or out moves the account size too (LiveTrader keeps a prop account's size).

17. [x] **A separate Telegram channel for Live trades' pictures** (owner, 5 Nov 2026, asked whether the journal's
    screenshots had separate Telegram settings for Live: "A separate telegram channel for live"): shipped in **v0.33.1**.
    - [x] Journal › Settings › Pictures: an optional **Live trades' channel**. Set: Live trades' pictures go there, paper
      ones to the journal's chat; empty: all to the journal's chat (as before); the journal's chat empty: Live only. Each
      copy remembers its chat (deletes go to the right one). The weekly review's summary stays in the journal's chat.
      The same bot. *(v0.33.1)*

18. [x] **Search in the indicators menu (ƒx), like TradingView** — shipped in **v0.35.0** (asked 10 Nov 2026: "Can you give me a search within
    indicators like tradingview?"). Design (Claude's, 10 Nov; the owner can change it): a search box at the top of ƒx,
    ready to type as the menu opens; typing filters every part (on this chart, built in, my scripts) by name (built-ins
    by their description too), the matching letters marked; ↑ / ↓ move, Enter adds the highlighted one (or opens a
    library's code), Esc clears then closes; "/" opens ƒx with the search, as on TradingView; the phone too.

19. [x] **Settings as a page of its own, not the side drawer** — shipped in **v0.35.0** (asked 10 Nov 2026: "the settings can be a separate page
    instead of a tab. It looks too cramped"). Design (Claude's, 10 Nov; the owner can change it): Settings fills the
    window with a list of its sections on the left (Fyers app, MT5 bridge, Telegram alerts, rules, charges, reset, security,
    users, display, layout, helper log) and each section in its own card on the right, wider than the drawer; a click on
    the list jumps there and the list follows as you scroll; ← Back (or Esc) returns to where you were; the address
    remembers it (#settings). Phone: full screen, the sections as chips along the top.

20. [x] **The version at the top, easy to see** — shipped in **v0.35.0** (asked 10 Nov 2026: "bring the version somewhere at the top so, it's
    easily visible. It can be in the settings page. But, another one at the top can really help"). Design: under "Trade
    Manager" in the header (its commit and the server's up-time in its tip), at the top of the Settings page, and at the
    top of the phone's More tab.

21. [x] **Alerts like TradingView: price, technical, multi-condition, watchlist** — shipped in **v0.38.0** (asked 11 Nov 2026: "We need to build
    alerts like tradingview along with addition of multiple conditions. Both price and technical alerts ... Let's build the
    entire thing so I don't need to buy Tradingview. I also want to know how we can get alerts in mobile"). Design
    (Claude's, 11 Nov, from TradingView's help pages and pricing page; the owner can change any of it):
    - **Runs on the server**, page open or not (as TradingView's do). Every user has their own; no plan limits beyond what
      the server and Fyers allow (v0.38.0 had 400 per user, of which 100 technical; v0.38.1: no count limit, only the server's calculations).
    - **What an alert watches:** the price (last, bid or ask: the real price, ticks between snapshots included through the
      day's high / low, like paper fills); Volume and its average; any plot of a Pine script on the chart (a copy of the
      code and inputs is kept, as TradingView does: editing the indicator later doesn't change the alert); a script's
      `alertcondition()`s and "any `alert()` call"; built-in quick indicators without adding them to the chart (MA / EMA,
      RSI, MACD, Bollinger, Supertrend, VWAP, ATR, Stochastic, CCI, ADX, MFI, OBV, Donchian); drawings (horizontal line /
      ray, trend line, ray, extended line, parallel channel, rectangle: the alert follows the drawing when you move it);
      P&F signals (DTB / TTB / DBS / TBS) on P&F charts. Every chart type: an alert set on a Heikin-Ashi / Renko / P&F
      chart works on those bars, with the same Pine engine as the chart (the page's own Pine runner, run by Node on the server).
    - **TradingView's 13 operators:** crossing, crossing up, crossing down, greater than, less than, entering / exiting /
      inside / outside channel, moving up / down (amount within N bars), moving up % / down %. Against a value, another
      plot / price, or a drawing; each condition has its own timeframe.
    - **Multi-condition:** up to 5 conditions on one symbol, All (like TradingView) or Any (extra).
    - **Trigger:** only once, once per bar, once per bar close, once per minute; expiry date or open-ended (the default).
    - **Watchlist alerts:** one alert over a watchlist, each symbol on its own. Bounded by Fyers' 100-symbol price socket
      (shared with charts and open trades): alerts may use up to 60 symbols, the rest reported as "not watched".
    - **Message** with TradingView's placeholders ({{ticker}}, {{exchange}}, {{close}}, {{open}}, {{high}}, {{low}},
      {{volume}}, {{time}}, {{timenow}}, {{interval}}, {{plot_0}}…, {{plot("Name")}}) plus {{bid}}, {{ask}}, IST times.
    - **Where it reaches you:** a pop-up with sound on every open page; **phone notifications** (the app installed on the
      phone's home screen: Android Chrome, or iPhone Safari › Share › Add to Home Screen, iOS 16.4+; Web Push, no app
      store, works with the phone locked); Telegram (the bot in Settings › Telegram alerts); a webhook (POST, like
      TradingView's, for ntfy / Pushover / Discord / bots; private addresses refused). Email and SMS: not now (SMS in
      India needs DLT registration and costs per message; say if you want email).
    - **Where you set them:** 🔔 on the chart / Alt+A, right-click on the chart ("Add alert at …"), a drawing's menu, an
      indicator's row in ƒx; the Alerts page (manager: pause, edit, clone, delete, search; the log of what fired;
      notification set-up); 🔔 lines on the chart for price levels (drag to move). The phone: the same, in More › Alerts.
    - [x] Built as designed *(v0.38.0)*. The top-bar item is a 🔔 icon with the count (the bar had no room for a word at 1500 px).
    - [x] **No limit on the number of alerts; a limit on calculations instead** (owner, 11 Nov: "Why can't we have
      unlimited?" ... "Let's build 1 and 2"): the 400 / 100 / 15 caps removed; alerts sharing a calculation share it; one
      server-wide limit on calculations, automatic from the server's memory or typed by the admin; Server load on the Alerts
      page (calculations, memory, CPU). *(v0.38.1)* (Option 3, watchlist alerts past the 100-symbol socket by slower quote
      polling: not asked for.)
    - [x] **🔔+ on the price scale like TradingView** (owner, 11 Nov: "click on the extreme right on a chart to set an alert
      like Tradingview"): hover (tap on the phone) shows 🔔+ at that price; one click makes a crossing alert, or opens the
      dialog. *(v0.38.1)*
    - [x] **Alerts on drawings, easy to reach** (owner, 11 Nov): 🔔 on the selected drawing's bar, gold with the number of its
      alerts, click to edit them or add one; the right-click menu lists them. *(v0.38.1)*
    - [ ] **The owner's checks:** after the update, the Alerts page shows no "Node.js isn't installed" warning (install.sh
      downloads Node 22 from nodejs.org into /opt/ftm-node); turn on notifications on the phone (Android: install the app;
      iPhone: Add to Home Screen first) and press Send a test; one real price alert and one RSI alert during market hours.
    - [ ] Email notifications (not built: needs an email account's SMTP login typed in Settings; say if wanted). SMS: not
      planned (India's DLT registration and a cost per message).
22. [x] **P&L, SL and TP as an amount, a % of the account or an R multiple** — shipped in **v0.42.0** (asked 12 Nov 2026,
    with a screenshot of an MT5 gold short: "options to show this as: 1. Amount 2. Percentage of account 3. R multiple").
    Agreed 12 Nov (the owner's answers):
    - **% of the account size** (FundingPips' own % rules count from it, and so do the app's).
    - **A main unit and a second one** next to it (e.g. "SL −1.00R · −$24.02"; the second can be None).
    - **Switching:** Chart settings › P&L shown as (saved on the server), **U** on the chart, and a click on a figure.
    - **Where:** the position bar, the SL / TP lines' labels and zone labels, the new-trade tool, the trades panel and the
      Trades page (Open P&L too), the phone.
    - [x] **A unit button on the position bar** *(v0.43.1)* (asked 12 Nov: "an option to set the position display button
      on the trade preview as on or off. If I turn on, I need a button on the preview to toggle showing in amount, % of
      account or R multiple"): Chart settings › P&L shown as › Unit button on the position bar (off by default); the button
      after each trade's P&L shows the main unit and a click switches it. v0.43.2: on the phone it leads the trade chips
      above SELL / BUY (the phone has no position bars). v0.43.3 (owner: "too close to the close trade button"): ✕ moved
      to the far left of the bar, the unit button and BE / BE-T / TRAIL on the right; on the phone the unit button at the
      right end of the chips. v0.43.4 (owner, 13 Nov: amounts "play on the mind"; "It should only show when I toggle the
      button to amount"): with the button on, only its unit is shown everywhere (no second unit); the saved Second
      returns when the button is off.
    - [x] **Hide the trade's bar and zones on the chart** *(v0.43.5)* (owner, 13 Nov: "an option to hide the trade preview -
      somewhere on the chart. Sometimes, it is difficult to see the candles"): 👁 on the chart's top bar, H, or Chart settings
      hides each trade's and order's bar and the shaded SL / TP zones with their labels; the lines and their price tags stay,
      the new-trade tool always shows; saved with the chart; the phone too.
    - Claude's calls (the owner can change them): default Amount · R (what the position bar already showed); 1R = the net
      risk at the first stop, so a trailed stop shows the R it locks in ("SL +0.50R"); a pending order's 1R = what its stop
      would lose; the open total in R = the sum of each trade's R (as the journal adds R); a trade with no stop shows the
      amount; one-line places (the tool's PLACE box, the phone's order bubble) show the main unit only.

23. [ ] **Strategies that trade by themselves, on Paper, Live and MT5, with a strategy tester** (asked 12 Nov 2026: "We
    should first do strategy for Live, Paper and MT5. The strategy should be able to automatically take trades. We can
    have a more user friendly interface for giving risk and other rules for a strategy. The one in Tradingview is very
    confusing"). Owner's answers (12 Nov): signals from **both** a no-code builder and Pine `strategy()` scripts; exits by
    **the app and the script**; **all three account types in one release** ("Why not all three at once?": the order path is
    already shared, so yes). Proposed design (Claude, 12 Nov; the owner can change any of it):
    - **Signals:** (a) **no-code builder**: long entry, short entry and exit conditions picked from menus, reusing the alert
      conditions (TradingView's 13 operators, the built-in indicators, any Pine plot, P&F signals, up to 5 conditions, All /
      Any); (b) **Pine `strategy()` scripts** from the Pine Editor: `strategy.entry`, `strategy.close`, `strategy.exit(stop=,
      limit=)` read as signals. TradingView's Properties tab (capital, order size, pyramiding, commission, slippage, margin,
      recalculate, fill options) is **not used**: the app's panel replaces it.
    - **Runs on the server** (the alerts engine's Pine runner, every chart type), page open or not. Acts **on bar close** by
      default; "as it happens, once per bar" per strategy.
    - **The rules panel**, one screen in plain words:
      - **Trades:** contract(s) or a watchlist, timeframe, chart type; long, short or both.
      - **Accounts:** Paper / Live / MT5, each switched on per strategy; Live and MT5 need a fresh 2FA code.
      - **Size:** risk % of the account, ₹ / $ amount, or lots (as the ticket).
      - **Stop (always):** the script's stop, ATR × n, points, a Pine line, or the last swing low / high. No stop = no trade.
      - **Target:** R multiple, the script's target, or none (exit by signal / trail only).
      - **Manage:** BE at x R, trail from x R (the app's own BE / trailing, net of charges); the script may also close early.
      - **Limits:** max trades a day, max open at once, the strategy's own daily loss (₹ / $ or R) after which it stops for
        the day, trading hours, no new entries X min before the square-off / MT5 day-end, skip expiry days; one position per
        contract (no pyramiding at first).
    - **Same path as a click:** every order goes through the account's rules and guards, the journal's lockouts, the kill
      switch, the square-off and day-end, MT5's news guard and no-hedging rule, and the Fyers / MT5 rate budgets. Each trade
      is tagged with the strategy (journal set-up, History filter); Telegram on each entry and exit; Pause / Stop per
      strategy, "Stop all strategies" on the top bar, and the kill switch stops them too. A strategy that errors pauses
      itself and says why.
    - **Strategy tester:** the same engine and panel run over the saved candles: fills by the paper rules (bid / ask,
      stops on bid / ask, gaps), results net of all charges in ₹ / $ and R: trades on the chart, equity curve and drawdown,
      win rate, expectancy, by month; compare two settings side by side. History is what Fyers Standard gives (more needs
      Fyers Prime) or what MT5 holds.
    - **Rules checked (12 Nov):** SEBI: a self-built algo on your own account under 10 orders a second is allowed (every
      Fyers API order is already tagged as algo). Fyers needs the daily login: Live strategies wait for it each morning.
      FundingPips' forbidden-strategies page allows third-party EAs only as trade / risk managers, says nothing about your
      own, and bans HFT, tick scalping, hedging, server spamming, latency arbitrage and copy trading: the app enforces a
      minimum gap between a strategy's orders and no hedging. **The owner asks FundingPips in writing** that the app's own
      strategies through his own FTM Bridge EA are fine before switching one on for MT5.
    - **Suggested (not required):** make item 1's first real manual Live trade before switching a strategy on for Live, so
      the live order path has been seen working once with a person watching.
    - Build in stages, each with all three account types:
      - [x] (a) the engine, the rules panel and Pine strategies, with the tester *(v0.43.0)*. As built: signals on bar close
        only, market entries only; the script's inputs are its defaults; a strategy keeps its own copy of the script.
      - [ ] (b) the no-code builder (the alert conditions as long entry / short entry / exit).
      - [ ] (c) side-by-side comparison of two settings; the tester's trades drawn on the chart; a History filter by
        strategy; limit / stop entries; "as it happens" (once per bar, not waiting for the close); editing the script's
        inputs in the rules panel.
    - [ ] **The owner's checks:** a strategy on a paper account for a day on real prices; then (after item 1's first manual
      Live trade, and FundingPips' written OK for MT5) one on Live or MT5 with a small size.
24. [ ] **Server backup** (12 Nov 2026). Nothing backs up the whole server today (only the journal's own backup, by hand).
    Nightly, encrypted: accounts, journal (pictures, kept candles), Pine scripts, layouts, drawings, alerts, settings, users
    (secrets stay sealed). Off the droplet: DigitalOcean Spaces, Google Drive or the Telegram bot (to agree). Keep 14 days;
    `python -m helper.backup restore` on a new droplet; Telegram if a night's backup fails. Fyers candles are left out
    (fetched again).
25. [ ] **Practice replay on any date** (12 Nov 2026). Pick a past day; the chart plays it candle by candle (play / pause /
    step / speed); trade it on a practice account with the real tool, BE, trail and charges; trades go to the journal
    marked practice. (Today's replay only shows your own past trades.)
26. [ ] **Screener** (12 Nov 2026). A table of a watchlist with a column per condition (built-ins, Pine plots, P&F signals),
    kept up to date on the server by the alerts engine; a click opens the chart; sort and filter.
27. [ ] **Option Greeks, IV and a payoff chart** (12 Nov 2026). IV, delta, gamma, theta, vega in the option chain
    (worked out on the server; MCX options on the future); a payoff chart at expiry and today for the open legs, net of
    charges.
28. [ ] **Tax report for Live trades** (12 Nov 2026). Per financial year: turnover (sum of absolute profits per trade),
    net P&L, charges split into deductible and STT, flags for the tax-audit limits; CSV and PDF for the CA. Live only. Not
    tax advice: the CA confirms.
29. [ ] **Indian event calendar on the chart** (12 Nov 2026). RBI policy, CPI, expiry days, MCX crude's EIA inventory day,
    holidays as chart markers; an optional guard refusing new orders on a contract from X minutes before its event (like
    the MT5 news guard).

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

## Rules that shape trading on FundingPips (MT5, item 8; checked 5-10 Nov 2026)

Sources: FundingPips' help pages, their support email of 9 Nov 2026, and third-party summaries (marked). Confirm anything
marked before relying on it.

- **EAs:** your own EA is allowed (support, 6 and 9 Nov 2026, with the set-up described), even fully automated, with proof of ownership (source, version history, development
  evidence, a live call); a compiled file alone is not proof. A third-party EA only as a trade / risk manager.
- **No VPN / VPS while trading, "even in the future"** (FundingPips support, 6 Nov 2026); the IP region stays the same
  from purchase to Master account (third-party summaries, Oct 2026). So MT5 runs on the owner's own laptop at home.
- **Banned:** hedging, **inside one account too, even in MT5 Hedge mode** (support, 10 Nov), opposite account trading, copy
  trading into a FundingPips account from outside, HFT, tick scalping, latency / reverse / long-short arbitrage, gap
  trading, server spamming, "server execution" (undefined; asked).
- **News (support, 10 Nov):** evaluation (the owner's 21182752 is Phase 1 of the 2-Step): holding through news allowed,
  purposely trading news prohibited. Master: no opening or closing from 5 min before to 5 min after a high-impact release
  on the affected currencies (profits inside are deducted); holding through allowed. Source: the dashboard's Economic
  Calendar (red).
- **Platforms:** MT5 is offered again (FundingPips' copier lists MT5, cTrader and Match-Trader, Sep 2026). The owner's demo
  shows "FundingPips-SIM1 ... Hedge".

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
- [x] **FundingPips (owner):** answered 10 Nov 8:12 PM: no hedging in one account; news window ±5 min on Master only (item 8).
- [x] **The owner (10 Nov):** opposite trades on different instruments are allowed (only the same symbol is hedging); the
  news calendar is ForexFactory (item 8).

## Done

- [x] **v0.43.5** (13 Nov): 👁 on the chart's top bar (or H, or Chart settings) hides the trades' bars and shaded zones so the
  candles show; the SL / TP / entry lines stay.
- [x] **v0.43.4** (13 Nov): with the unit button on, only the button's unit is shown (no second unit, so no amount unless the
  button says ₹ / $); a click changes only the main unit.
- [x] **v0.43.3** (12 Nov): ✕ on the position bar moved to the far left, away from R / BE / BE-T / TRAIL (a click meant for R
  closed the trade); the phone's unit button at the right end of the chips.
- [x] **v0.43.2** (12 Nov): the unit button on the phone (it leads the trade chips; the phone has no position bars).
- [x] **v0.43.1** (12 Nov): a unit button on the position bar (amount / % / R), switched on in Chart settings (item 22).
- [x] **v0.43.0** (12 Nov): strategies that trade by themselves (item 23 stage a): a Pine strategy() script's signals on
  bar close, the rules panel (size, a stop always, target, BE / trail, limits), Paper / Live / MT5 through the accounts' own
  rules, ⚡ tags, the log, Stop all, the tester (net of charges, R).
- [x] **v0.42.1** (12 Nov): roadmap only: items 23-29 added (strategies that trade by themselves first), item 10 kept for later.
- [x] **v0.42.0** (12 Nov): P&L, SL and TP shown as an amount, a % of the account size or an R multiple, a main unit and a
  second one (item 22): the position bar, SL / TP labels, the new-trade tool, the trades panel, the Trades page, the phone;
  Chart settings › P&L shown as, U, or a click on a figure.
- [x] **v0.41.0** (12 Nov): the MT5 day-end close by each symbol's own trading hours (EA 1.23 sends MT5's sessions; item 8 b4);
  each trade's ⏱ shows its own time.
- [x] **v0.40.0** (12 Nov): the MT5 day-end close (item 8 b4): X minutes before the broker's day ends (default 5), every day or
  only before the weekend, all trades or only marked ones (the ticket's At the day end / the tool's DAY END / HOLD, ⏱ per trade);
  off at first.
- [x] **v0.39.1** (12 Nov): each MT5 trade's candles kept on the server for its replay (item 8 c1b): 1m / 5m / 15m around
  the trade and the chart's timeframe with its warm-up, fetched from MT5 at the close (MT5's history in the background); charts
  and the replay use them when MT5 is off or its history has moved on; in the journal's backup. Fixed: an MT5 trade's replay
  asking for a Fyers login.
- [x] **v0.39.0** (11 Nov): MT5 trades in the journal (item 8 c1): every MT5 trade (from the app, from MT5, MT5's history) in
  $, never added to ₹ (₹ Fyers | $ MT5 in the filters, Review, Copy for Gemini); the session day per MT5 account (the broker's or
  the Indian day); the 2% line of FundingPips' day-start balance; the lockouts on MT5 a switch per account (2FA, off at first);
  the CSV's Currency column; the replay of MT5 trades.
- [x] **v0.38.1** (11 Nov): alerts: no limit on how many (the limit is on calculations, server-wide, automatic from the server's memory or set by the admin; alerts sharing one calculation share it; Server load on the Alerts page); 🔔+ on the price scale like TradingView (one click = a crossing alert); 🔔 on a selected drawing's bar with its alerts.
- [x] **v0.38.0** (11 Nov): alerts like TradingView's (item 21): price, candle, Pine plot / alertcondition() / alert(), built-in indicator, drawing and P&F-signal alerts on the server; TradingView's 13 conditions against a value or another series, each condition on its own timeframe; up to 5 conditions (all / any); once / once per bar / once per bar close / once per minute; expiry; watchlist alerts; every chart type; placeholders; pop-up + sound, phone / desktop push (installable app), Telegram, webhook; the Alerts page (manager, log, notifications); 🔔 lines on the chart that drag; Alt+A, right-click, drawings' and ƒx's 🔔; the phone. Node.js installed on the server for Pine.
- [x] **v0.37.4** (11 Nov): Pine `plot.style_linebr` / `steplinebr` / `areabr` and a colour of na break the line instead of joining it with a diagonal (owner: Chandelier Exit on XAUUSD differed from TradingView); no price label while a plot's latest value is na.
- [x] **v0.37.3** (11 Nov): MT5 commission known before a symbol's first trade (EA 1.22 reads MT5's commission rules; else a traded symbol of the same group; else the typed default; else refused, never $0); profit in another currency converted with the broker's own FX price and checked against MT5's profit sum; a symbol with only MT5's tick value can't be placed.
- [x] **v0.37.2** (11 Nov): MT5 money fixed (owner: −$3.78 shown at a stop that was −$217.94 in MT5, XAUUSD 0.33 lots): a 1.00 move's value is cross-checked (MT5's profit on your position, OrderCalcProfit in EA 1.21, contract size) instead of MT5's tick value alone; shown on the ticket and the Account page.
- [x] **v0.37.1** (11 Nov): MT5 accounts: no login to type before the first change or order (owner: "We don't need so much security"); the 2FA code to switch to MT5 stays. Fixed: PLACE as an account's first change showed "type its login" as a red line instead of asking.
- [x] **v0.37.0** (11 Nov): MT5 stage b complete (item 8 b2 / b3): orders placed from the app on MT5 accounts (MT5 PLACE, real SL / TP, sizing in 0.01 lots net of commission, margin from MT5, FundingPips' floors and the other guards, no hedging across your MT5 accounts); the MT5 kill switch; the ForexFactory news guard (Master blocks ±5 min, evaluation warns); the EA trailing by itself when the link drops. EA 1.20.
- [x] **v0.36.0** (10 Nov): MT5 accounts (item 8 b1): PAPER | LIVE | MT5 at the top left; each MT5 login with FTM Bridge 1.10 an account of its own (positions, orders, balance, history from MT5; trades placed in MT5 too); SL / TP, BE, BE-T, TRAIL, ✕ and pending orders managed at the broker through the EA (the login typed once); $ net of commission learned from MT5's deals and swap; FundingPips' daily (broker's midnight) and max (typed size) floors shown. EA 1.10 opens no new trades.
- [x] **v0.35.0** (10 Nov): the ƒx search, like TradingView (item 18: filter as you type, marks, ↑ / ↓ / Enter, Esc, "/") and Settings as a page of its own (item 19: sections listed on the left, cards, ← Back / Esc, #settings; chips on the phone); the version at the top (item 20).
- [x] **v0.34.0** (10 Nov): MT5 prices and charts through the owner's own bridge EA (item 8, stage a): `mt5/FTM_Bridge.mq5` (calls out only, no orders), Settings › MT5 bridge, MT5 in the Prices pill, MT5 symbols in Find, every chart type and Pine on the broker's own candles, the broker's day; paper trading refuses MT5 symbols until stage b.
- [x] **v0.33.1** (5 Nov): a separate Telegram channel for Live trades' pictures (item 17): Journal › Settings › Pictures › Live trades' channel (optional; paper pictures stay in the journal's chat; Live only if that's empty).
- [x] **v0.33.0** (5 Nov): the Live account is your Fyers account (item 16): the PAPER / LIVE switch at the top left (green / red, client ID + 2FA, per login, the server refusing Live changes from a Paper page); Fyers' own funds for the balance and every % rule (money in / out never a profit or a loss); every trade on the Fyers account shown and managed (placed here or in Fyers; a Fyers stop adopted; no stop: the red flag and Place my stop); delivery holdings (never squared off); old Live accounts back to Paper.
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
