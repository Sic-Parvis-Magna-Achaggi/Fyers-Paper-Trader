# Fyers Trade Manager

A trade manager for Fyers that works like the MT5 LiveTrader EA: risk-based sizing, draggable entry/SL/TP, trailing, daily loss guards and a journal. The order is paper trading first, then live. Instruments come in this order: MCX, then NIFTY/BANKNIFTY, then stocks.

It runs on our own server and serves its own page, so there is nothing to install on any laptop or phone. Open the bookmark, type the password, done.

**Address:** https://68-183-245-178.sslip.io

## Version 0.3.0: trade from the chart

- **An MT5-style long/short tool on the chart:**
  - red and green zones with net ₹ and R;
  - a PLACE box on the entry line;
  - the entry follows the market, or you drag it and it becomes a limit or stop automatically;
  - SL and TP move with it.
- **On-chart controls:** BUY / SELL at the chart's corner; one-click ✕ to close a position or cancel an order; zones on open positions.
- **Custom timeframes:** any minutes or hours, plus D, W and M. Pin your favourites.
- **Real full screen,** with the panel sliding over it (P).
- **Settings saved on the server:** watchlist, timeframes, last chart, theme, ticket defaults and stop distances.

## Version 0.2.0: paper trading

- **Paper trading on the server.** Market, limit and stop orders; draggable entry, SL and TP lines; BE, Trail BE and Trail SL; adds; Close all. It keeps running with the page closed.
- **Every ₹ figure is net of all charges:** brokerage, exchange, clearing, CTT/STT, stamp duty, SEBI fee and GST. Sizing, BE + costs and R all use the net figures.
- **Option stops** can follow the option itself or its underlying future.
- **Rules,** as in LiveTrader: daily and max loss floors, buffer, risk cap, margin use (from Fyers' margin calculator), open risk, trades a day, SL required, intraday square-off and expiry-day exit.
- **History** with the charge breakdown for each trade, plus a CSV download.
- **Full-screen chart:** the ⛶ button or the F key. P hides the trade panel.

See `docs/Paper_Trading_Guide.md`.

## Version 0.1.0: plumbing

- Page password, the daily Fyers login, MCX search and option chain, watchlist, and live candlestick charts.
- Auto-update from GitHub.

Next: Pine Script indicators on the chart (PineTS), then the journal in the app with Telegram screenshots.

## Repo layout

| Folder | What |
| --- | --- |
| `helper/` | The Python server (FastAPI). `app.py` has the routes; `fyers_link.py` handles Fyers login and data; `feed.py` handles live prices; `symbols.py` handles the contract list; `auth.py` handles the page password; `paper.py` is the paper engine; `charges.py` holds every charge |
| `web/` | The page (`index.html`), the trade panel (`paper.js`) and the bundled chart library |
| `server/` | Install and auto-update scripts, the service files and the Caddy config |
| `docs/` | Project brief, server details, setup guide |

## Updating

Upload the new files to this repo. The server picks them up within a minute. See `docs/Server_Setup_Guide.md`.

## Security

- No secrets are kept in this repo.
- The Fyers App ID and Secret, the daily Fyers token and the page password hash stay on the server in `/home/helper/data`, readable only by the `helper` user.
- The server's GitHub key is read-only.
