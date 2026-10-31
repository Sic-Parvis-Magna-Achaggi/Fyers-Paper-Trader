# Fyers Trade Manager

A trade manager for Fyers that works like the MT5 LiveTrader EA: risk-based sizing, draggable entry/SL/TP, trailing, daily loss guards and a journal. The order is paper trading first, then live. Instruments come in this order: MCX, then NIFTY/BANKNIFTY, then stocks.

It runs on our own server and serves its own page, so there is nothing to install on any laptop or phone. Open the bookmark, log in with your username, password and a 2FA code, done.

**Address:** https://68-183-245-178.sslip.io

## Version 0.19.0: the phone layout

- **A proper phone version, like MT5's app:** tabs at the bottom (Quotes · Chart · Trade · History · More), a full-height chart with one-tap SELL / BUY, an order sheet with big − / + buttons, and a sheet for each position: move SL / target, BE, trailing, close.
- **Full screen** with ⛶ or by turning the phone sideways. Phones get it automatically; More → Desktop layout switches.

## Version 0.18.0: P&F toolkit, second set

- **Horizontal counts and patterns** on P&F: traps, catapults, poles, triangles, turtle breakouts, anchor follow-through.

## Version 0.17.0: every indicator on P&F, and the P&F toolkit

- **Every indicator and Pine script works on every chart type,** Point & Figure included, checked before every release.
- **P&F toolkit** (ƒx): 45° trend lines with breaks, DTB / DBS / triple top and bottom signals, anchor columns and vertical counts.

## Version 0.16.0: Point & Figure, order-flow check

- **Point & Figure** chart type, with indicators like the others.
- **Order-flow check** (Log page): measures whether Fyers' feed delivers every trade, before any footprint is built.

## Version 0.15.0: chart types

- **Heikin-Ashi, Renko, range bars, line break,** plus hollow candles, bars, line and area (the button after the timeframes).
- **Indicators work on every type:** Volume and your Pine scripts run on the bars the chart shows, as on TradingView. Prices and trade lines stay real.

## Version 0.14.0: live trading (the admin only)

- **Turn an account Live** (Account page): orders go to Fyers on your login, from the server's IP 134.209.159.171 (whitelist it in your Fyers API app first).
- **A real stop at Fyers from the moment a trade opens;** trailing and BE move that same order. Targets stay on the server, and there's never more than one exit order at Fyers.
- **Red LIVE badge, KILL switch,** and the Fyers stop shown on every position. Test with 1 lot on MCX first.

## Version 0.10.0: pages, NSE and BSE

- **Full pages** for Trades, History (stats, equity curve, filters), Book (up to 4 order books), Account and Log, next to the chart.
- **NSE and BSE:** stocks, indices, F&O and currency, alongside MCX, with their charges.

## Version 0.8.0: Pine Editor

- **Write, save and run your own Pine Script indicators.** Pine (above the chart) opens the editor; scripts are saved on the server and listed in ƒx → My scripts.
- **TradingView-style output:** plots, fills, shapes, background and bar colours, labels, lines, boxes, tables, inputs and request.security().
- **Paper fills:** targets and limit orders fill when a trade goes through their price.

## Version 0.4.0: chart controls

- **A control bar on each position's entry line:** close, BE, BE-trail and trail, each trail with its own R box.
- **Solid bid and ask lines,** as in MT5.
- **⛶ / F maximises the chart in the browser window,** so your tabs stay one click away. Shift+F gives real full screen.
- **The panel has its own ✕.**

See `CHANGELOG.md` for every version.

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

- Users with two-factor login (authenticator app + recovery codes), several paper accounts per user, the daily Fyers login, MCX search and option chain, watchlist, and live candlestick charts.
- Auto-update from GitHub.

Next: the journal in the app, with Telegram screenshots.

## Repo layout

| Folder | What |
| --- | --- |
| `tests/` | The test kit (fake Fyers feed, route check, engine and browser tests); not used on the server. See `tests/README.md` |
| `helper/` | The Python server (FastAPI). `app.py` has the routes; `fyers_link.py` handles Fyers login and data; `feed.py` handles live prices; `symbols.py` handles the contract list; `users.py` handles users, 2FA, sessions, encryption and the security log; `rt.py` runs each user's Fyers link, price feed and paper accounts; `paper.py` is the paper engine; `charges.py` holds every charge |
| `web/` | The page (`index.html`), the trade panel (`paper.js`), the phone layout (`mobile.js`, `mobile.css`), Pine Script (`pine.js`, `pine_worker.js`) and bundled libraries in `vendor/`: Lightweight Charts (Apache-2.0), PineTS (AGPL-3.0), CodeMirror 5 (MIT) |
| `server/` | Install and auto-update scripts, the service files and the Caddy config |
| `docs/` | Project brief, server details, setup guide |

## Updating

Upload the new files to this repo. The server picks them up within a minute. See `docs/Server_Setup_Guide.md`.

## Security

- No secrets are kept in this repo.
- Each user's Fyers App ID and Secret and daily Fyers token, and the password hashes and 2FA secrets, stay on the server in `/home/helper/data`, readable only by the `helper` user. Secrets and tokens are encrypted with a key kept in the same folder (`secret.key`).
- The server's GitHub key is read-only.
