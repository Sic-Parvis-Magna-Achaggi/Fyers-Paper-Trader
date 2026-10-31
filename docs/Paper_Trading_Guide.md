# Paper and live trading: how it works (v0.20.2)

Paper trades run **on the server**. Stops, targets, trailing, intraday square-off and the expiry-day exit keep working with the page closed, as long as you've logged in to Fyers that day, so prices are flowing.

## Logging in, users and security

- **Login** is your username and password, then a 6-digit code from your authenticator app (Google Authenticator, Microsoft Authenticator, Authy or similar). Lost your phone? Type one of your recovery codes instead of the app code; each works once.
- **First login** (and the first login after this update, as user **admin** with your old page password): you scan a QR code into the app, type the code it shows, and save the 10 recovery codes shown once.
- **Settings → Security:** change your name or password, get new recovery codes, move 2FA to a new phone, see every device you're logged in on (log any out, or everywhere else), and recent activity.
- **A fresh code is asked again** (valid 5 minutes) for sensitive actions: adding or changing users, new recovery codes, moving 2FA, editing charge rates, turning an account Live, Resume after the kill switch.
- **Lockout:** 5 wrong passwords or codes lock that user for 15 minutes. Sessions end after 48 hours without use and after 7 days at most.
- **Users (admin only, Settings → Users):** add a user with a temporary password. They choose their own password and set up 2FA at first login, then enter their own Fyers app in their Settings for prices. You can disable / enable a user, reset their 2FA (lost phone) or give them a new temporary password. Other users are paper-only; live trading is the admin's only.
- **Everything is per user:** Fyers app and login, watchlist, chart set-up, Pine scripts, paper accounts. Charge rates are shared; only the admin edits them.
- **Lost phone and recovery codes (admin):** on the server console, in `/home/helper/app`, run `sudo -u helper /home/helper/venv/bin/python -m helper.users rescue admin`. It prints a temporary password; log in with it and set up 2FA again.

## Paper accounts

- **The switcher** at the top shows the account you're looking at and its balance. Pick another to switch; the whole app (chart lines, ticket, Trades, History, Account, Log) follows it.
- **+ New account…** (in the switcher, or the Account page): a name, starting capital, and default rules or a copy of another account's rules and trailing.
- Each account has its own balance, rules, trailing defaults, positions, orders and history. All of them keep running on the server (stops, targets, trailing, square-off), whichever one you're looking at.
- **Rename, archive, restore** on the Account page. Archiving needs the account flat (no positions or orders) and keeps its trades. You always keep at least one account.
- **Reset** (Account page) starts the account you're looking at again; its old trades are archived on the server.

## Live trading (the admin only)

An account can be **Paper** or **Live**. A Live account uses the same ticket, chart tool, rules, guards, BE, trailing and targets as paper, but its orders go to Fyers on your own login, from the server's own IP **134.209.159.171**.

**Before the first live trade:** whitelist **134.209.159.171** in your Fyers API app (not 68.183.245.178) and give the app order permission. Then test with **1 lot on MCX**.

**Turning it on:** Account page → *Your accounts* → **Turn on LIVE** on an account with no positions or orders. Type your Fyers client ID (shown in the dialog) and a fresh 2FA code. Its paper trades are archived on the server and it starts a fresh ledger at the capital you type (that's what the % rules use), so paper results and real money never mix. One Live account per Fyers login. **Back to Paper** works the same way (flat first). Both are in the security log.

**You'll see:** a red **LIVE** badge and a **KILL** button in the top bar, a red line under the top bar, **LIVE** on the PLACE button, "● LIVE" in the account switcher, and under every position where its stop is at Fyers.

**How a live trade runs**

- **Entry:** the order goes to Fyers. The position opens only when Fyers reports the fill, at Fyers' price. Market orders become Fyers' market-price-protection orders. No after-market orders: a contract that isn't trading is refused. Every live trade needs a stop.
- **The stop at Fyers:** as soon as the trade opens, a **stop-limit (SL-L)** order goes to Fyers at your stop. Its limit sits a little past the trigger (Rules: *LIVE: stop-limit slack*, 0.5% of the price or at least 5 ticks), so it fills even if price jumps. Example from the test: a CRUDEOIL long with the stop at 5,585 → Fyers stop 5,585, limit 5,557. Fyers doesn't take stop-market (SL-M) orders on options or BSE, so the app uses stop-limits everywhere.
- **Trailing, BE and BE-T** move that same Fyers order (never below BE + costs, never backwards). Changes are paced at least 1.5 seconds apart per trade. Moving the SL yourself moves it too.
- **The server still watches** with the bid / ask rule, like MT5 and paper: a long's stop fires when the bid reaches it. Fyers triggers its stop on the last traded price, so the server usually acts first, and live exits can differ from paper by a tick.
- **Closing** (the server's stop rule, the target, intraday square-off, the expiry-day exit, ✕, Close all, the kill switch):
  - **NSE / BSE:** the stop order itself is changed into a market order.
  - **MCX:** Fyers doesn't allow changing an order's type there, so the app cancels the stop, waits until Fyers confirms it's gone, then sends one market exit.
  - Either way there is **never more than one exit order** at Fyers for a position. If Fyers refuses a market order (some MCX options), a limit that crosses the spread is sent instead. An exit still open after 3 seconds (*LIVE: re-price…*) is re-priced to cross the spread.
- **Targets stay on the server** (no target order at Fyers), so a stop and a target can never both fill.
- **A stop that triggered but didn't fill** (price jumped past its limit): the server's rule catches it and turns it into a market exit.
- **The trade is recorded** at Fyers' fill price, with every charge, net, as in paper.

**When things go wrong**

- **The server is down:** the stop at Fyers protects the position at its last level. Trailing and the target pause. When the server is back it reads Fyers' order book first: a stop that filled is recorded; then trailing resumes; a target already passed closes at market on the first price.
- **Fyers refuses or is slow with a stop change:** the previous stop stays in force at Fyers, a warning shows, and the app retries.
- **Fyers doesn't confirm an order** (a time-out): the app looks the order up by its tag and never sends it twice.
- **No stop at Fyers** (refused, or waiting for the market): a red warning shows under the top bar and on the position until it's in.
- **Overnight (Carry / NRML):** Fyers orders last one day. The next day, after your Fyers login and once the contract trades, the app places a fresh stop at the trailed level. Until then a warning shows. Before placing it, the app checks Fyers still has the position. If it was closed while the app was away, the trade is recorded as "closed at Fyers" at the last stop price, with a warning to check the real price in Fyers' trade book.
- **No Fyers login today:** new orders are blocked; stops already at Fyers stay in force, but trailing can't move them and targets / square-off can't close.
- **Part fills:** if Fyers fills only part of a stop or an exit, that part is recorded at once and the rest stays open (with its stop, or still closing). An exit is never larger than what Fyers still holds.
- **"CHECK FYERS" warnings** appear when only you can sort something out in Fyers (for example an app order that filled after the app had stopped tracking it). They stay until you press **Resync with Fyers**.
- **Delivery (CNC) shares:** a stop that sells delivery shares needs your Fyers authorisation to sell from your demat (TPIN / DDPI), as for any sell of shares you hold.

**Kill switch** (KILL in the top bar, or the Account page): cancels every order and closes every position at Fyers on your login, the app's trades **and any others**, then pauses new entries until you press **Resume** on the Account page (Resume asks for a fresh 2FA code). Stops keep working meanwhile, and an entry that fills during it is closed too. KILL asks once to confirm (no 2FA code, so it's quick).

**Account page (Live):** whether you're logged in to Fyers, whether order updates are connected (if not, the app reads the order book every 5 seconds), your Fyers funds, **Resync with Fyers** (re-reads Fyers and puts every stop where it should be), Resume and the kill switch.

**Limits:** live orders, changes and cancels share Fyers' 10 a second / 200 a minute (the helper queues at 4 a second, 120 a minute). Fyers' order-update socket doesn't count against them. The Standard plan is enough; nothing here needs Fyers Prime.

## Markets

- **MCX** commodities, **NSE and BSE** stocks, indices, F&O, and NSE currency. Find has exchange and type filters; **Opt** on an index, stock or future opens its option chain.
- **Indices** are for charts only: BUY / SELL tells you an index can't be traded. Trade its futures or options.
- **Stocks:** Intraday or Delivery (CNC). A delivery sell needs shares you hold, as at the broker; to short a stock, use Intraday.
- **F&O, currency, commodities:** Intraday or Carry (NRML).
- **Product (Intraday or Carry / Delivery)** is chosen in the trade panel or with the **INTRADAY / NRML / CNC** button on the chart's PLACE box. Whatever you pick stays the default for later trades in that account (saved on the server) until you change it. Margin comes from Fyers for that product.
- **Intraday square-off: 5 minutes before Fyers'.** Fyers squares off Intraday positions itself and charges ₹50 + GST per order for it. Its times: index and stock F&O **15:25**, stocks that have F&O **15:05**, other stocks **15:20**, MCX **23:20** while the US is on summer time and **23:45** the rest of the year. At 5 minutes before each one, the app:
  - closes every Intraday position in that market;
  - cancels pending Intraday orders;
  - refuses new Intraday orders for the rest of the day (pick Carry / Delivery instead).
- The app switches the MCX time by itself when US clocks change (second Sunday of March, first Sunday of November). The minutes, Fyers' times and on / off are all in Rules. Carry (NRML) and Delivery (CNC) positions are never squared off.
- **Expiry-day exits:** MCX 22:45, NSE and BSE 15:00, currency 12:00 (Rules). Currency intraday closes at 16:45 (Fyers doesn't offer currency intraday at present).

## Pages

The top bar has **Chart · Trades · History · Book · Account · Log**. The chart keeps running while you're on another page, and the address remembers the page.

- **Trades:** all open positions and pending orders in tables. Click any price to change it; set Trail BE / Trail SL per trade; BE, close, cancel. BE all, Cancel all orders and Close all at the top.
- **History:** filters, stats (net, win rate, profit factor, average R, expectancy, drawdown, streaks...), an equity curve, daily P&L, results by contract and by exit, and each trade's charges. Download the filtered list as CSV.
- **Book:** up to 4 order books side by side.
- **Account:** the account's figures, your paper accounts (new, rename, archive), rules, trailing defaults, reset and the charges in use.
- **Log:** everything the paper account did, the helper's own log, and **Security** (your logins, 2FA and password changes).

## On a phone

Phones get their own layout, like MT5's app (a desktop browser never does). **More → Desktop layout** switches to the desktop page on that phone; **Settings → Layout** switches back (Automatic / Phone / Desktop).

- **Tabs at the bottom:** Quotes (watchlist, Find, Options) · Chart · Trade · History · More. A number on Trade counts your open trades and orders.
- **Top bar:** the account and its equity (tap to switch account), the contract and its price (tap for Quotes), and a dot for the price feed (green live, amber polling). A Fyers login reminder shows under it when needed.
- **Chart tab:** the chart takes the whole screen. At the bottom: **SELL** (the bid) · your default size · **BUY** (the ask). Tap the middle to change the default size (Risk %, Risk ₹ or Lots) and product. Open positions show as chips above the bar with their net P&L; tap one to manage it.
- **Placing a trade:** tap SELL or BUY. The order sheet slides up and the long / short tool appears on the chart. Choose Market, Limit or Stop; set the stop loss and target with − / + (one tick each, hold to repeat) or type them; the box after the target is R. Pick the size and product. The preview shows the lots, net ₹ at the stop and the target, BE + costs, charges in and out and the margin; if the order can't go (a rule, the margin, the intraday cut-off) the reason is right above PLACE. ✕ cancels.
- **The bubble:** to see the whole chart while you set the trade up, touch the chart (or tap ⌄ in the sheet's header, tap the grip, or swipe the header down). The sheet shrinks to a bubble in the SELL / BUY bar's place, so nothing covers the chart. It shows the side, lots, order type and product, and the net ₹ at the stop and the target with R (whole rupees, after all charges), or why the order can't go. Drag the SL and TP lines and the bubble follows. **PLACE** in the bubble places the trade, **✕** cancels it, and tapping the bubble brings the full sheet back. To have SELL / BUY go straight to the bubble, tap the middle of the bar → **SELL / BUY opens: A bubble** (saved on the server).
- **A position** (tap its chip or its card on Trade): net P&L after all charges, R, LTP, BE + costs, charges paid. Move the SL and target with − / + and press **Save** (Undo puts them back). **BE-T** and **TRAIL** for that trade with their R, **BE now**, **Chart**, and **Close at market** (tap twice).
- **A pending order** (Trade tab): move its price, SL and target, Save; or Cancel order.
- **Trade tab:** the account figures, every position and order, BE all, Close all (tap twice), Cancel all, and the trailing defaults for new trades.
- **History tab:** Today, 7 days, 30 days or All, with net P&L, win rate, profit factor, average R and charges. Tap a trade for every charge. The full History page (equity curve, filters) is linked at the bottom.
- **More tab:** Account, rules and charges; switch account; trades table; order book; log; settings (Fyers app, security, users, reset); theme; desktop layout; log out.
- **Full screen:** ⛶ in the chart's toolbar, or turn the phone sideways on the Chart tab. Only the chart and the SELL / BUY bar stay. ✕ (or turning it back upright) returns.
- **Live account:** a red LIVE badge and **KILL** in the top bar, live warnings under it, LIVE on the PLACE button (and on the bubble's), and the stop at Fyers on each position.

## The long / short tool on the chart (like the MT5 EA)

- Press **BUY** or **SELL** at the chart's top-left corner. The tool appears on the chart:
  - a red zone down to the stop and a green zone up to the target, each with its **net ₹**;
  - the R multiple;
  - a **PLACE** box on the entry line.
- **The entry follows the live price** (a market order) until you drag it:
  - drag a buy's entry **below** the market and it becomes a **limit**; drag it **above** and it becomes a **stop** (the other way round for a sell);
  - **MKT** on the PLACE box snaps it back to market.
- **SL and TP keep their distance** from the entry, so the whole tool moves with the price.
  - Drag either line to change its distance.
  - The stop distance you set is remembered per instrument and used next time.
  - The target defaults to your R (Settings: the ticket's R box), net of charges.
- **PLACE** sends it; **✕** closes the tool. The side panel shows the same trade with more detail (charges, margin, BE + costs). You don't need it open to trade.
- **Open positions** show their zones from the entry candle and SL / TP lines you can drag. A control bar sits on the entry line, just left of the price scale. It shows:
  - side, lots, entry price, live net P&L and R;
  - **✕** to close at market;
  - **BE** to move the stop to break-even + costs now;
  - **BE-T** with its R box: trail to BE once the trade reaches that R;
  - **TRAIL** with its R box: trail the stop that many R behind the best price.

  When the stop or target is only a few ticks from the entry (a BE stop, say), the bar slides just off that line so its label stays readable; the **Entry** tag on the price scale marks the exact entry.

  These trailing settings belong to that trade. The panel's Trail row sets the defaults for new trades, and changing it there also changes every open trade.
- **Pending orders** have a bar with their type and lots, and **✕** to cancel.
- **Bid and ask** are solid lines, as in MT5: grey for bid, red for ask, with their prices on the scale. A dashed **Last** line marks the last traded price, which is where the live candle closes. Candles are built from trades, so in a thin contract the candle can sit away from bid / ask until the next trade. Stops, targets and fills always use bid / ask.
- **Chart settings (⚙):**
  - colour and style for every line: bid, ask, last, entry, SL, TP, BE, order and new-trade entry;
  - show or hide bid, ask and last;
  - candle colours, zone colours and strength, background and grid.

  They're saved with your preferences.

## Timeframes and full screen

- The bar above the chart shows your pinned timeframes. **▾** lists them all: 1m–45m, 1h–4h, 1D, 1W, 1M.
  - Type any other, such as `7m`, `90m`, `2h` or `3D`, and press Use.
  - Right-click one (or long-press on a phone) to pin or unpin it.
- Timeframes Fyers doesn't serve directly are built from smaller candles, starting at the session open (09:00 for MCX).
- **Go to a date: the calendar button** at the chart's bottom left (or **Alt+G**, as on TradingView). Pick a date (and a time, on intraday charts; Indian time) and press Go to or Enter: older candles load first if the chart doesn't reach that far back, and the chart centres on that candle (or the one just before, if the market was shut), marked by the crosshair. A date before Fyers' first candle for the contract goes to the oldest one and says so. **Latest** in the same box, or **»** (bottom right, shown whenever the latest candle is off screen), brings you back to now, keeping your zoom.
- Daily, weekly and monthly charts show dates only on the time axis.
- **⛶ or F** maximises the chart inside the browser window, so your tabs stay one click away. **Shift+F** gives real full screen. When maximised, **P** (or Panel) slides the trade panel in, its **✕** hides it, and **Esc** goes back to the normal view.

## Chart types

The button after the timeframes (it shows the current type, e.g. **Candles**, **Renko 11**) picks how the chart draws the candles. Your choice is saved on the server, so every device opens the same way.

| Type | What it shows |
| --- | --- |
| Candles, Hollow candles, Bars (OHLC), Line, Area | The real candles, drawn differently. Hollow: a candle that closed up is hollow, coloured by its close against the previous close. Line / area colour: Chart settings (⚙). |
| Heikin-Ashi | Smoothed candles at the same times: close = (open + high + low + close) / 4, open = the middle of the previous Heikin-Ashi candle. |
| Renko | Bricks of one size. A new brick when price moves a box past the last one; a reversal needs two boxes. Box: ATR (default 14, worked out from the candles loaded, then fixed until you reload) or fixed points, saved per underlying (one for CRUDEOIL, another for NIFTY). Built from the closes, or from each candle's high and low; wicks optional. |
| Range bars | Each bar spans the same range (high − low); a new bar starts when price goes beyond it. Range: ATR or fixed points. |
| Line break | A new line when the close passes the highs (or lows) of the last 3 lines (settable). |
| Point & Figure | Columns of X (rising) and O (falling), one mark per box. A new column needs a reversal of 3 boxes (settable) from the column's extreme and starts one box back from it. Box: ATR or fixed points, **per underlying and timeframe** (5 for GOLDPETAL on 2m doesn't follow you to 1D); built from the closes, or from highs and lows. The button shows box × reversal, e.g. **P&F 11 × 3**. Zoomed out, the X's and O's get flatter to fit; zoomed far out, X columns are solid bars and O columns hollow ones. |

- **Renko, range bars, line break and Point & Figure** are built from the timeframe's candles: pick **1m** for the finest bricks. They don't follow the clock, so the candle timer is off and the time axis shows when each brick formed.
- **Point & Figure opens readable:** columns get wider (12 to 40 px) until the X's and O's are as big as they can be (up to 14 px) for the price range on screen, with little empty space on the right. Zoom as usual from there.
- **P&F box per timeframe.** A fixed box you type is saved for that timeframe. A box saved before v0.20.2 (one per contract) still applies, except on a timeframe where it's too small to draw: when a typical bar would span more than 8 boxes (a 5-point box on a GOLDPETAL day), that timeframe uses the ATR box until you set one there, and the chart type menu says so. (Before, a 1D P&F chart with a 5-point box drew its columns as thin lines: 100+ boxes a column can't show as X's and O's.)
- **Every indicator works on every type, Point & Figure included.** Volume, the built-in indicators and every Pine script (plots, fills, shapes, drawings, tables, request.security, arrays...) run on the bars the chart shows, as on TradingView: on Heikin-Ashi an RSI uses the Heikin-Ashi closes; on Renko there's one value per brick; on Point & Figure one per column. They line up bar for bar, on the candles and in their own panes, and follow live prices. A test of many Pine features on every chart type runs before every release, so this keeps holding for scripts you write later.
- **On Point & Figure, Pine's `close` is the column's middle** by default (the usual convention for indicators on P&F, from du Plessis); choose **Last box** under *Indicators read* in the chart type menu. `open`, `high` and `low` are the column's own; a column closes when the next one starts.
- **Prices stay real.** Bid, ask, last, your entry / SL / TP lines and every ₹ figure use real prices, whatever the chart type. (A Heikin-Ashi close isn't a price you can trade at.)
- The long / short tool and the position bars work on every type.

## P&F toolkit (ƒx → Built in → P&F toolkit)

Drawn on Point & Figure charts (on other chart types its read-out says so and it draws nothing). Each part can be turned off in its settings (⚙).

- **45° trend lines.** A bullish support line starts one box below a column's low and rises one box per column; it's broken when an O column reaches it. A bearish resistance line starts one box above a column's high and falls one box per column; it's broken when an X column reaches it. After each break the opposite line starts from the extreme of the move (the highest X or lowest O since the broken line began). The running line is solid; broken ones are faded, with **▲ break** / **▼ break** where they broke.
- **Signals** at the box that triggers them: **DTB** (Double Top Buy: an X column one box above the previous X column's top), **DBS** (Double Bottom Sell), **TTB / TBS** (triple top / bottom: the two previous tops, or bottoms, were equal). Filled = fresh (the first signal after one the other way), outlined = continuation. Zoomed far out, only fresh signals show.
- **Anchor columns:** columns of 15+ boxes (settable), shaded, with their high and low as dashed levels to the right (the latest 3, settable).
- **Vertical counts:** from finished columns of 5+ boxes (settable): target = boxes × box size × reversal, up from an X column's low or down from an O column's high. A count shows once a later column breaks the count column's high (low), and disappears when the target is reached: **VC ↑ 5,654** (the latest 2 per side, settable).
- **Horizontal counts:** at each breakout out of a congestion, the columns from the breakout back to the wall (the first column that had reached the breakout level), at least 5 wide (settable): target = width × box size × reversal, from the congestion's low (up) or high (down), the conservative count. Shown until reached: **HC ↑ 5,682**.
- **Patterns**, marked under the column (bullish) or over it (bearish), each family with its own switch:
  - **Bull trap:** a triple top buy only one box above the tops, then an O column giving a double bottom sell (bearish). **Bear trap:** the mirror (bullish).
  - **Catapult:** a triple top buy, a pullback that neither gives a sell signal nor breaks the pattern's low, then a double top buy (and the bearish mirror).
  - **High pole:** an X column 3+ boxes above the previous X top, then an O column retracing more than half of it (a bearish warning). **Low pole:** the mirror (bullish).
  - **Triangle:** lower tops and higher bottoms over 4 columns, then a double top buy (bottom sell). **Ascending / descending triangle:** equal tops with rising bottoms (equal bottoms with falling tops), then the breakout.
  - **Turtle:** a column beyond the highest high (lowest low) of the previous 20 columns (settable).
  - **AFT (anchor follow-through):** after an anchor column, the next column on its side goes beyond it; its stop (the pullback's extreme) is drawn as a short dashed line.
  - Rules from StockCharts / Dorsey; turtle and AFT from Definedge's published one-line descriptions (their full rules aren't public, so details may differ).
- **Labels never overlap:** they're placed by importance (breaks, fresh signals, traps / catapults / triangles, anchors / turtle / AFT, poles, continuation signals) and one that would cover another is left out. Zoom in to see more.
- The read-out shows which line price is on and the last signal.
- Not included: **mini tops / bottoms** and Definedge's own indicators and patterns (PMOX, XO Zone %, Noiseless RSI, Oops...): their rules are in Definedge's logged-in library and aren't published. Paste one in and it can be built exactly.

## Order-flow check (admin, Log page)

A real footprint (buy × sell volume at each price) needs every trade's price and size. Fyers' API documents no trade-by-trade feed, so the app measures what its normal price feed delivers:

- The server records every price snapshot for the contracts listed (by default the nearest CRUDEOIL and NIFTY futures; up to 6) while you're logged in to Fyers, with or without the page open. Files: `data/feedcheck/` on the server, one per day.
- **Exact volume** is the share of the volume that arrived one trade per snapshot (the day's volume grew by exactly the last trade's size), so each trade's price and size is known. **Price known** adds the last trade of each merged snapshot. **Merged** snapshots carried several trades, whose prices are lost. Shown per contract and per hour (IST).
- The footprint will be built only if this shows the trades arrive exactly. It stays a check: nothing here changes how the app trades.

## Candle timer

The time left in the current candle shows on the price scale, just under the bid / ask / last labels, and in the chart's top bar.
- The day's last candle counts down to the session close.
- On 1D, 1W and 1M it shows the time to today's close.
- Outside trading hours it says "market closed".

Turn it on or off in Chart settings (⚙).

## Volume and the order book

- **Volume under the candles:** the volume strip at the bottom of the candle pane, on/off in Chart settings (⚙).
- **Volume indicator:** in the Indicators menu (ƒx). It puts volume bars in their own pane, with an optional moving average. Drag the divider to resize the pane; the height is remembered. Its ⚙ has the MA length (Inputs), the rising / falling bar colours and the MA's colour, width and style (Style), and the timeframes it shows on (Visibility).
- **Book tab** (trade panel) shows the chart contract's order book:
  - the top 5 bid and ask levels, with quantity, number of orders and depth bars;
  - total buy vs sell quantity, with a ratio bar;
  - the day's open, high, low, previous close, average price, volume, last traded quantity and change.

  With BUY or SELL pressed, click a price in the book to put the entry there. The book streams only while the tab is open.

## Pine Script indicators

- **Pine** (above the chart) opens the Pine Editor under the chart. Drag its top edge to resize it.
- Write or paste a script. It's checked as you type: an error shows its line (click it to jump there) and the line turns red.
- **Save** (Ctrl+S) puts it in your library on the server; edit the name and Save to rename. **Save as** makes a copy. **Delete** removes it (and takes it off the chart).
- **Add to chart** (Ctrl+Enter). When the script is already on the chart, the button says **Update on chart**. Saving also updates the chart.
- **ƒx → My scripts** lists your library: **+ Add** puts a script on the chart, **{ }** opens it in the editor. You can add the same script twice with different inputs.
- On the chart, each script's read-out shows its values for the bar under the cursor. Point at a read-out for its buttons:
  - **👁** hides the indicator, or shows it again (a hidden script stops running);
  - **⚙** opens its settings (or double-click the name): see *Indicator settings* below;
  - **{ }** opens the code;
  - **✕** removes it.

  Errors show in red there.
- **Collapse:** the **▴** under the indicators on the candles folds them into "▸ N indicators". In a lower pane, **▾ / ▸** shows or hides that pane's values. Hidden and collapsed states are saved.
- **Tooltips:** point at a label that has a tooltip to read it.
- Scripts with their own pane can still draw on the candles (`force_overlay = true`), as on TradingView.
- `overlay=true` scripts draw on the candles; others get their own pane.
- **Supported:** plots (lines, step, circles, histogram, columns, area), hline, fill, bgcolor, barcolor, plotshape / plotchar / plotarrow, plotcandle, labels, lines, boxes, linefills, polylines, tables, inputs and request.security() for other timeframes.
- Times are Indian time.
- **Bars of history** (⚙ › Inputs, per indicator): **Auto** (the default) starts on the latest 1,500 bars; when you scroll back past where the script's line starts, it calculates again (once you stop scrolling) over everything the chart has loaded, the same way the chart loads older candles. Or pick a fixed number, 500 to 50,000, and it always uses that many of the latest bars. Each new bar re-runs the script in full in the background so its values and drawings stay exact; on a very long history (a run over 1.5 s) that happens at most every 5 x its run time.
- **Libraries (`import`).** `import TradingView/ta/<version> as ta` works out of the box: the app has its own implementation of that library's functions (Chandelier Exit, Supertrend, Volatility Stop, DEMA / TEMA / T3 / KAMA / FRAMA, Aroon, Stoch RSI, Ichimoku, KVO, Vortex, TRIX, PPO, PMO, Ulcer Index, volume delta and more), written from the standard formulas, not TradingView's code (`ht()` and `wpo()` aren't included). For any other library, open it on TradingView, copy its source (it starts with `library("Name")`), paste it into a new script in the Pine Editor and **Save**: `import anyone/Name/<version>` then finds it. If you save a library under the import's full name (for example *TradingView/ta*), that copy is used first, before the app's own. A library isn't drawn on the chart (ƒx marks it *library*, with no + Add). A script that imports a library you don't have says so, and what to do.
- **Live updates** work like TradingView's. The full history runs once, then each price re-runs only the live bar. A new candle triggers one full re-run in the background, so drawings stay exact.
- **Update** (⚙): *with every price* (the default) or *on candle close*. On candle close means one run per candle, which suits heavy scripts on long histories. The settings box shows the full-run and live-update times.
- A script stuck in an endless loop is stopped with an error; the page keeps working.
- Scripts run on PineTS, which covers most of Pine v5 / v6 but not every function. If one of your scripts errors, or draws differently from TradingView, send it over.

## Indicator settings (⚙ on the read-out, or double-click its name)

Like TradingView's, for every indicator on the chart (your Pine scripts, Volume, the P&F toolkit). Changes show at once and are saved on the server with the chart's indicators; **Cancel** puts back what was there when you opened it, **Defaults** resets the tab you're on.
- **Inputs:** the script's inputs, grouped as the script groups them (inputs written with the same `inline` share a row). Plus the app's own *Bars of history* and *Update*.
  - **Calculation › Timeframe** and **Wait for timeframe closes**, for every Pine script (TradingView offers them only on scripts whose `indicator()` has `timeframe =`; here any script has them). Pick a higher timeframe, for example 15 minutes for a moving average on a 2-minute chart, and the script calculates on those candles. The list has the usual timeframes and your own (pinned / custom); ones lower than the chart's are greyed out. With *Wait for timeframe closes* on, each value appears on the chart bar where its higher-timeframe bar closes (no repainting); off, it fills every bar until the next close. The live higher-timeframe bar shows on the latest bar. A timeframe lower than the chart's is refused. The read-out shows the timeframe in use.
- **Style:** each plot with its colours (a plot coloured by a condition lists each colour it uses; change any of them, with opacity), on / off, plot type (line, line with breaks, step line, histogram, columns, area, circles, cross), width and line style, and a price line at its latest value. The script's levels (`hline`: on / off, colour, width, style), fills, backgrounds, shapes and bar colours (on / off, colours). Then **Precision**, **Labels on the price scale**, **Values in the status line** and **Inputs in the status line**. Lines, labels and boxes a script draws take their colours and widths from its own inputs (Inputs tab), as on TradingView.
- **Visibility:** which timeframes it shows on: minutes, hours, days, weeks and months, each on / off with a range (for example minutes 1 to 15 only). On other timeframes the read-out says *hidden on this timeframe* and a Pine script doesn't run.

## Chart history: scroll back for older candles

- A chart opens with recent candles (about 1,000 bars, more if a Pine script asks for more). **Scroll or zoom out to the left edge and older candles load**, a step at a time, as on TradingView; the chart stays on the candles you were looking at. A pill at the bottom left says what's happening.
- It goes back as far as Fyers has candles for that contract. A futures contract starts on its listing day: when there's nothing older, the pill says *No older candles at Fyers for this contract* and it stops asking.
- Only your own scrolling loads more (not the chart fitting itself), and one step at a time, so it stays well inside Fyers' data limits.
- The older candles you load stay on that chart (same contract and timeframe) until you reload the page.
- **Other timeframes for Pine** (`request.security`, an indicator's own timeframe): the app waits up to 90 seconds for those candles (a Fyers request can queue behind others). If they don't arrive, the read-out says so in amber (or, if the script couldn't calculate without them, its error says why) and it tries again in 30 seconds, up to 3 times. Before 1 Nov 2026, Fyers' "no data" answer for the days before a contract was listed made the whole daily request fail, which is why Pivot Points said *Not enough data available*.

## Saved candles

Candles are saved on the server and in your browser.
- A chart opens at once from your browser's copy, and only newer candles come from the server.
- The server asks Fyers only for what's new, at most every 45 seconds per chart.
- Older days are fetched once, the first time a chart or indicator needs them. So history keeps growing past what one Fyers request returns.
- If you're logged out of Fyers, the saved chart still shows.

## Saved on the server

Everything here is per user. Your Pine scripts and libraries, the indicators on your chart (with their inputs, style, timeframe and visibility), your watchlist, pinned timeframes, last chart, theme, panel on/off, ticket defaults (risk mode and amount, product, R) and remembered stop distances are saved on the server. Rules and trailing settings are saved per paper account. Any device, after any login, opens the same set-up.

## Every ₹ figure is net

Wherever the app shows money for a stop, a target, risk, P&L, R or break-even, it is after **all** charges for the entry and the exit:

| Charge | MCX futures | MCX options | Charged on |
| --- | --- | --- | --- |
| Brokerage | ₹20 or 0.03%, whichever is lower | ₹20 flat | each executed order |
| Exchange transaction | 0.0021% | 0.0418% | value / premium |
| Clearing | 0.0018% | 0.05% | value / premium |
| CTT | 0.01% | 0.05% | sell side only |
| Stamp duty | 0.002% | 0.003% | buy side only |
| SEBI fee | ₹10 per crore | ₹10 per crore | value / premium |
| GST | 18% of brokerage + exchange + clearing + SEBI fee | same | |

**Stocks:** intraday pays STT 0.025% on the sell and stamp 0.003% on the buy, with brokerage ₹20 or 0.03% (lower). Delivery (CNC) pays STT 0.1% on both buy and sell, stamp 0.015% on the buy, brokerage ₹20 or 0.3% (lower), and a DP charge of ₹12.5 + GST on the sell. Exchange charges are NSE 0.0030699% and BSE 0.00375%.

NSE and BSE F&O, BSE Sensex / Bankex options, and currency futures and options all have their own rates.

**When a rate changes:**
- Account → Charges used → **Edit rates** lets you change any rate (and GST). Every figure uses the new rate at once.
- The server reads Fyers' charges page about once a day. If it changes, a **Charges changed: review** pill appears in the top bar, and the Account page shows the old and new lines.
- The app never switches a rate by itself. You edit the rate if needed, then click **Mark as reviewed**. These rates come from Fyers' charges list (27 Oct 2026), with the exchange rates cross-checked against the NSE and BSE schedules. **Account → Charges used** shows every table the app is using.

- **Value** = price × quantity × multiplier. For example, CRUDEOILM is 10 barrels a lot, CRUDEOIL 100, and GOLDPETAL 1 gram.
- **Lot sizing** finds the most lots whose loss at the stop, including both orders' charges, fits your risk.
- **BE + costs** works like LiveTrader's: the exit price where closing nets ₹0 or more after the entry charges already paid and the charges the exit would pay, rounded to the profitable tick, plus the **BE buffer** in Rules (default 0 ticks). A stop at BE is labelled, for example, "BE · exit here nets +₹0 · 13 ticks below entry pay the ₹51.60 charges". The ₹ after "nets" is what you keep if the stop is hit. The ₹ at the end is the charges those ticks pay for, not profit. To lock in profit at BE, set a BE buffer in ticks.
- **R** = net P&L ÷ the net risk at the first stop.

## Fills

| Order | Fills |
| --- | --- |
| Market | Buy at the ask, sell at the bid |
| Limit | When the ask (buy) or bid (sell) reaches your price, at your price or better. Also when a trade goes **through** your price (a buy limit: a trade below it), at your price |
| Stop entry | When the last price crosses it, then at the ask / bid (market) |
| Stop loss | When the bid (long) or ask (short) reaches it, as at MT5, then at that bid / ask, so a jump through the stop fills worse (slippage). A stop on an underlying future triggers on the future's last price |
| Target | When the bid (long) or ask (short) reaches it: at the target, or better if price gapped through. Also when a trade goes **through** it, at the target |

**Trade-through.** Targets and limit orders are resting limit orders on a real exchange. A trade beyond your price means your order, being a better price, would have been filled first. So it fills at your price, even if the bid / ask we saw never touched it. A trade exactly *at* your price doesn't fill it, as orders may be ahead of you. Fyers' live feed sends snapshots, so a one-trade spike can fall between two of them. When the day's low (or high) moves past your price between snapshots, that counts as a trade there. A spike inside the day's range that never reaches us live can't be seen.

Positions are netted per contract and product (Intraday / Carry), like Fyers. Adds average in, and one trade runs flat to flat. An opposite order on a contract you hold is refused: close it first.

## Option stops: the option, or the future

On an option you can choose what the stop and target follow:

- **This option:** SL / TP are option prices, drawn on the option's chart.
- **The future:** SL / TP are prices of the underlying future, drawn on the future's chart. The option is sold at its own bid when the future hits them. Money at the stop and target is an estimate (≈), worked out from the option's delta. **BE** then adds a *floor* in the option's own price at break-even + costs, so a trade that reached BE can't turn into a loss.

## Rules (Settings → Paper trading rules)

These are checked before every new order, as in LiveTrader:

- daily loss %, max loss % (static or trailing), the buffer, and when the day starts;
- risk cap per trade, max margin use and max open risk (lots are cut to fit);
- max trades a day, and whether an SL is required;
- intraday square-off (on / off, minutes before Fyers', and Fyers' own times per market), the expiry-day exit times, and the stale-price limit.

An order is refused if, with every stop on the account hit, equity would fall below a floor plus the buffer. Widening a stop goes through the same check. Tightening, BE and trailing are never blocked.

**Margin** comes from Fyers' own margin calculator, cached for 10 minutes per contract. An option buy needs its premium. If Fyers doesn't return a figure, the ticket says "not checked".

## Trailing

- **Trail BE ON at X R:** once a trade has been X R in profit, its stop moves to BE + costs, once.
- **Trail SL ON at X R:** after X R, the stop follows the best price X R behind. It never goes below BE + costs and never moves backwards.

Moving a stop yourself makes it your stop again: it drops out of Trail SL until you toggle trailing.

1R is the distance from the **first** entry to the **first** stop, in points, as in LiveTrader. Adds don't change it.

When BE-T has already moved the stop to break-even, a Trail SL of N R behind the best price may still be further away than that BE stop. Trailing never moves a stop backwards, so the stop stays at BE until price makes a new best far enough to beat it. The position's bar shows that price as **"moves past …"**, and then **"next …"** once the trail is running.

## Records

- **History:** every closed trade, with the exit reason (tp, sl, be, trail sl, manual, square-off, expiry; live also kill, and "closed at Fyers" for a position closed outside the app). Tap a trade for its full charge breakdown, first stop, risk, and best / worst price.
- **Download CSV:** one row per trade, with every charge in its own column.
- Trades are stored on the server in `/home/helper/data/u/<user>/a/<account>/paper_trades.json`. **Reset** archives them and starts that account again.

## Not yet

- Footprint / delta (order flow): waiting for the order-flow check (Monday 2 Nov).
- Comparing the charges the app counts with what Fyers actually deducted (live).
- Telegram alerts if the server stops responding during a live trade (next).
- The journal inside the app, and Telegram screenshots.
- Partial closes.
- Agri MCX contracts use the non-agri rates.
