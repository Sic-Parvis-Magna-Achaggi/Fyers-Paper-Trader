# Fyers Trade Manager

A trade manager for Fyers that works like the MT5 LiveTrader EA: risk-based sizing, draggable entry/SL/TP, trailing, daily loss guards and a journal. The order is paper trading first, then live. Instruments come in this order: MCX, then NIFTY/BANKNIFTY, then stocks.

It runs on our own server and serves its own page, so there is nothing to install on any laptop or phone. Open the bookmark, type the password, done.

**Address:** https://68-183-245-178.sslip.io

## Version 0.1.0: plumbing

- Page password: set once with a setup code from the server, then a login on each new device (it stays logged in for 30 days).
- Fyers connection: enter the App ID and Secret once in Settings, then **Log in to Fyers** each morning.
- MCX contract search (futures and options), option chain by expiry, and a watchlist.
- Candlestick charts (1m / 5m / 15m / 1h / 1D) with live prices from the Fyers data socket. If the socket drops, it falls back to a slow quote poll.
- Helper log, version and data-request usage in Settings.

Next: paper trading, then the journal in the app.

## Repo layout

| Folder | What |
| --- | --- |
| `helper/` | The Python server (FastAPI). `app.py` has the routes; `fyers_link.py` handles Fyers login and data; `feed.py` handles live prices; `symbols.py` handles the contract list; `auth.py` handles the page password |
| `web/` | The page (`index.html`) and the bundled chart library |
| `server/` | Install and auto-update scripts, the service files and the Caddy config |
| `docs/` | Project brief, server details, setup guide |

## Updating

Upload the new files to this repo. The server picks them up within a minute. See `docs/Server_Setup_Guide.md`.

## Security

- No secrets are kept in this repo.
- The Fyers App ID and Secret, the daily Fyers token and the page password hash stay on the server in `/home/helper/data`, readable only by the `helper` user.
- The server's GitHub key is read-only.
