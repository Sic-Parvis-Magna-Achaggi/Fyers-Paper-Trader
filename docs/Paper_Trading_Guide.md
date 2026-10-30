# Paper trading: how it works (v0.13.1)

Paper trades run **on the server**. Stops, targets, trailing, intraday square-off and the expiry-day exit keep working with the page closed, as long as you've logged in to Fyers that day, so prices are flowing.

## Logging in, users and security

- **Login** is your username and password, then a 6-digit code from your authenticator app (Google Authenticator, Microsoft Authenticator, Authy or similar). Lost your phone? Type one of your recovery codes instead of the app code; each works once.
- **First login** (and the first login after this update, as user **admin** with your old page password): you scan a QR code into the app, type the code it shows, and save the 10 recovery codes shown once.
- **Settings → Security:** change your name or password, get new recovery codes, move 2FA to a new phone, see every device you're logged in on (log any out, or everywhere else), and recent activity.
- **A fresh code is asked again** (valid 5 minutes) for sensitive actions: adding or changing users, new recovery codes, moving 2FA, editing charge rates.
- **Lockout:** 5 wrong passwords or codes lock that user for 15 minutes. Sessions end after 48 hours without use and after 7 days at most.
- **Users (admin only, Settings → Users):** add a user with a temporary password. They choose their own password and set up 2FA at first login, then enter their own Fyers app in their Settings for prices. You can disable / enable a user, reset their 2FA (lost phone) or give them a new temporary password. Other users are paper-only; live trading will be the admin's only.
- **Everything is per user:** Fyers app and login, watchlist, chart set-up, Pine scripts, paper accounts. Charge rates are shared; only the admin edits them.
- **Lost phone and recovery codes (admin):** on the server console, in `/home/helper/app`, run `sudo -u helper /home/helper/venv/bin/python -m helper.users rescue admin`. It prints a temporary password; log in with it and set up 2FA again.

## Paper accounts

- **The switcher** at the top shows the account you're looking at and its balance. Pick another to switch; the whole app (chart lines, ticket, Trades, History, Account, Log) follows it.
- **+ New account…** (in the switcher, or the Account page): a name, starting capital, and default rules or a copy of another account's rules and trailing.
- Each account has its own balance, rules, trailing defaults, positions, orders and history. All of them keep running on the server (stops, targets, trailing, square-off), whichever one you're looking at.
- **Rename, archive, restore** on the Account page. Archiving needs the account flat (no positions or orders) and keeps its trades. You always keep at least one account.
- **Reset** (Account page) starts the account you're looking at again; its old trades are archived on the server.

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
- **⛶ or F** maximises the chart inside the browser window, so your tabs stay one click away. **Shift+F** gives real full screen. When maximised, **P** (or Panel) slides the trade panel in, its **✕** hides it, and **Esc** goes back to the normal view.

## Candle timer

The time left in the current candle shows on the price scale, just under the bid / ask / last labels, and in the chart's top bar.
- The day's last candle counts down to the session close.
- On 1D, 1W and 1M it shows the time to today's close.
- Outside trading hours it says "market closed".

Turn it on or off in Chart settings (⚙).

## Volume and the order book

- **Volume under the candles:** the volume strip at the bottom of the candle pane, on/off in Chart settings (⚙).
- **Volume indicator:** in the Indicators menu (ƒx). It puts volume bars in their own pane, with an optional moving average. Drag the divider to resize the pane; the height is remembered.
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
  - **⚙** opens its inputs (or double-click the name);
  - **{ }** opens the code;
  - **✕** removes it.

  Errors show in red there.
- **Collapse:** the **▴** under the indicators on the candles folds them into "▸ N indicators". In a lower pane, **▾ / ▸** shows or hides that pane's values. Hidden and collapsed states are saved.
- **Tooltips:** point at a label that has a tooltip to read it.
- Scripts with their own pane can still draw on the candles (`force_overlay = true`), as on TradingView.
- `overlay=true` scripts draw on the candles; others get their own pane.
- **Supported:** plots (lines, step, circles, histogram, columns, area), hline, fill, bgcolor, barcolor, plotshape / plotchar / plotarrow, plotcandle, labels, lines, boxes, linefills, polylines, tables, inputs and request.security() for other timeframes.
- Times are Indian time.
- **Bars of history** (⚙, per indicator): how many of the latest candles the script runs on, 500 to 50,000 (default 1,500). The chart loads the extra days it needs.
- **Live updates** work like TradingView's. The full history runs once, then each price re-runs only the live bar. A new candle triggers one full re-run in the background, so drawings stay exact.
- **Update** (⚙): *with every price* (the default) or *on candle close*. On candle close means one run per candle, which suits heavy scripts on long histories. The settings box shows the full-run and live-update times.
- A script stuck in an endless loop is stopped with an error; the page keeps working.
- Scripts run on PineTS, which covers most of Pine v5 / v6 but not every function. If one of your scripts errors, or draws differently from TradingView, send it over.

## Saved candles

Candles are saved on the server and in your browser.
- A chart opens at once from your browser's copy, and only newer candles come from the server.
- The server asks Fyers only for what's new, at most every 45 seconds per chart.
- Older days are fetched once, the first time a chart or indicator needs them. So history keeps growing past what one Fyers request returns.
- If you're logged out of Fyers, the saved chart still shows.

## Saved on the server

Everything here is per user. Your Pine scripts and the indicators on your chart (with their inputs), your watchlist, pinned timeframes, last chart, theme, panel on/off, ticket defaults (risk mode and amount, product, R) and remembered stop distances are saved on the server. Rules and trailing settings are saved per paper account. Any device, after any login, opens the same set-up.

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

- **History:** every closed trade, with the exit reason (tp, sl, be, trail sl, manual, square-off, expiry). Tap a trade for its full charge breakdown, first stop, risk, and best / worst price.
- **Download CSV:** one row per trade, with every charge in its own column.
- Trades are stored on the server in `/home/helper/data/u/<user>/a/<account>/paper_trades.json`. **Reset** archives them and starts that account again.

## Not yet

- The journal inside the app, and Telegram screenshots (next).
- Partial closes.
- Agri MCX contracts use the non-agri rates.
