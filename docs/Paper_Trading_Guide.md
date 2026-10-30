# Paper trading: how it works (v0.5.1)

Paper trades run **on the server**. Stops, targets, trailing, intraday square-off and the expiry-day exit keep working with the page closed, as long as you've logged in to Fyers that day, so prices are flowing.

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
  - side, lots, live net P&L and R;
  - **✕** to close at market;
  - **BE** to move the stop to break-even + costs now;
  - **BE-T** with its R box: trail to BE once the trade reaches that R;
  - **TRAIL** with its R box: trail the stop that many R behind the best price.

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

- **Volume** is shown in a strip under the candles. Turn it off in Chart settings (⚙).
- **Book tab** (trade panel) shows the chart contract's order book:
  - the top 5 bid and ask levels, with quantity, number of orders and depth bars;
  - total buy vs sell quantity, with a ratio bar;
  - the day's open, high, low, previous close, average price, volume, last traded quantity and change.

  With BUY or SELL pressed, click a price in the book to put the entry there. The book streams only while the tab is open.

## Saved on the server

Your watchlist, pinned timeframes, last chart, theme, panel on/off, ticket defaults (risk mode and amount, product, R) and remembered stop distances are saved on the server. Your rules and trailing settings have been saved there since v0.2.0. Any device, after any login, opens the same set-up.

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

NSE futures and options rates are also in the app, for later. These rates come from Fyers' charges list (27 Oct 2026). Settings → **Charges used** shows the table the app is using.

- **Value** = price × quantity × multiplier. For example, CRUDEOILM is 10 barrels a lot, CRUDEOIL 100, and GOLDPETAL 1 gram.
- **Lot sizing** finds the most lots whose loss at the stop, including both orders' charges, fits your risk.
- **BE + costs** works like LiveTrader's: the exit price where closing nets ₹0 or more after the entry charges already paid and the charges the exit would pay, rounded to the profitable tick, plus the **BE buffer** in Rules (default 0 ticks). A stop at BE is labelled "BE +N ticks · covers ₹X".
- **R** = net P&L ÷ the net risk at the first stop.

## Fills

| Order | Fills |
| --- | --- |
| Market | Buy at the ask, sell at the bid |
| Limit | When the ask (buy) or bid (sell) reaches your price, at your price or better |
| Stop entry | When the last price crosses it, then at the ask / bid (market) |
| Stop loss | When the bid (long) or ask (short) reaches it, as at MT5, then at that bid / ask, so a jump through the stop fills worse (slippage). A stop on an underlying future triggers on the future's last price |
| Target | When the bid (long) or ask (short) reaches it: at the target, or better if price gapped through |

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
- intraday square-off time, the expiry-day exit time, and the stale-price limit.

An order is refused if, with every stop on the account hit, equity would fall below a floor plus the buffer. Widening a stop goes through the same check. Tightening, BE and trailing are never blocked.

**Margin** comes from Fyers' own margin calculator, cached for 10 minutes per contract. An option buy needs its premium. If Fyers doesn't return a figure, the ticket says "not checked".

## Trailing

- **Trail BE ON at X R:** once a trade has been X R in profit, its stop moves to BE + costs, once.
- **Trail SL ON at X R:** after X R, the stop follows the best price X R behind. It never goes below BE + costs and never moves backwards.

Moving a stop yourself makes it your stop again: it drops out of Trail SL until you toggle trailing.

## Records

- **History:** every closed trade, with the exit reason (tp, sl, be, trail sl, manual, square-off, expiry). Tap a trade for its full charge breakdown, first stop, risk, and best / worst price.
- **Download CSV:** one row per trade, with every charge in its own column.
- Trades are stored on the server in `/home/helper/data/paper_trades.json`. **Reset** archives them and starts a fresh account.

## Not yet

- The journal inside the app, and Telegram screenshots (next).
- Your Pine Script indicators on the chart, via PineTS (next).
- Partial closes.
- Agri MCX contracts use the non-agri rates.
