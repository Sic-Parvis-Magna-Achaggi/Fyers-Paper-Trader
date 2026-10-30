# Changelog

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
