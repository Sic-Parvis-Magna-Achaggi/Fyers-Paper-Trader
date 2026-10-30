# Paper trading: how it works (v0.2.0)

Paper trades run **on the server**. Stops, targets, trailing, intraday square-off and the expiry-day exit keep working with the page closed, as long as you've logged in to Fyers that day, so prices are flowing.

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
- **BE + costs** is the exit price where the net P&L is zero after every charge both ways, rounded to the profitable side of the tick.
- **R** = net P&L ÷ the net risk at the first stop.

## Fills

| Order | Fills |
| --- | --- |
| Market | Buy at the ask, sell at the bid |
| Limit | When the ask (buy) or bid (sell) reaches your price, at your price or better |
| Stop entry | When the last price crosses it, then at the ask / bid (market) |
| Stop loss | When the stop's price is crossed: at the bid (long) or ask (short) at that moment, so slippage is included |
| Target | At the target, or better if price gapped through |

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
