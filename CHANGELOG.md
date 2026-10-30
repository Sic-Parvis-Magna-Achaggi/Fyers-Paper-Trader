# Changelog

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
