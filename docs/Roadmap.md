# Roadmap: the task list

Updated 31 Oct 2026 (v0.18.0). This is the one task list for the project.
- New tasks are added here as soon as they're agreed, in the order agreed.
- When a task ships, it's ticked [x] with its version and moved to **Done** (details in CHANGELOG.md).
- Half-done tasks stay in **Next** with the finished parts ticked.

## Next, in this order

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
5. [ ] **Saved chart layouts, per user** (asked 31 Oct 2026)
   - Save the chart as a named layout: contract, timeframe, indicators (built-in and your Pine scripts) with their settings, and the chart settings.
   - Pick a layout to open the chart exactly like that. Saved on the server, so every device has them.
6. [ ] **Multi-charts in a layout** (asked 31 Oct 2026)
   - Several charts side by side and stacked (vertical and horizontal splits) inside one layout, each with its own contract, timeframe and indicators. Saved with the layout.
7. [ ] **A proper mobile version** (asked 31 Oct 2026: "the mobile version is pathetic; I can't open the charts in full screen")
   - Use the MT5 mobile app as the reference: a full-screen chart, simple bottom navigation (Quotes, Chart, Trade, History), one-tap trading and the position controls reachable with a thumb.

8. [ ] **Measurement tool, a mix of MT5 and TradingView** (asked 31 Oct 2026)
   - MT5's crosshair ruler (click-drag from a point: price change, % and bars / time, shown at the cursor) and TradingView's measure box (shaded box, green up / red down, change in points, %, ticks, bars, time and volume).
   - Plus what fits this app: the net ₹ for your lot size after all charges, and R against the current SL. Works on every chart type (P&F in boxes).

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

- [ ] Partial closes.
- [ ] Agri MCX contracts use the non-agri rates (low priority: Fyers doesn't offer agri commodities at present).
- [ ] Ask Fyers in writing whether a second user's app may fetch market data from this server's IP (support request drafted 30 Oct).

## Done

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
