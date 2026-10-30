# Fyers Trade Manager — Project Brief (v3)

*v1 written 30 Oct 2026 in the LiveTrader (MT5) chat. v2, 30 Oct 2026: Fyers API checked against the current docs, user decisions added, architecture changed to "server from day one".*

Repo: `Sic-Parvis-Magna-Achaggi/Fyers-Paper-Trader`

## 1. Goal

A trade manager for **Indian markets through Fyers** that works like **LiveTrader**, the MT5 EA built for XAUUSD prop trading:

- risk-based sizing, draggable entry / SL / TP, trailing to break-even and trailing stops;
- daily and max loss guards;
- automatic journaling to Telegram.

It is for one person trading their own Fyers account.

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Broker | Fyers API v3, free Standard plan |
| Portability | **Carry only an HTML file (or a bookmark).** Nothing is installed or configured on any laptop or phone |
| Architecture | The page talks only to a **helper on a DigitalOcean server in Bangalore, from day one** (paper mode too). The helper also serves the page itself. The helper holds every secret and runs trailing, guards and journal uploads with the page closed |
| Order of work | Paper mode first (data-only Fyers app, simulated fills), then live (trading app, server IP whitelisted) |
| Instruments, in order | **1. MCX futures and options** → 2. NIFTY / BANKNIFTY futures and options → 3. stocks |
| Adding to a position | **Allowed.** Adds average into one position per symbol + product; one journal trade runs flat to flat |
| Journal | **Built into the hosted app** (decided 30 Oct 2026): trades are saved on the server when they close, in ₹ and IST, and viewable from any device. Telegram carries chart screenshots at entry and exit. Screens and stats ported from the octagon journal. Paper first, live later |
| Code and docs | GitHub repo above. The server deploys from it |
| Hosting | DigitalOcean droplet, BLR1, $6/month (Oracle sign-up failed repeatedly). Details in `docs/Server_Details.md` |

## 3. Fyers API — what the current docs say (checked 30 Oct 2026)

| Topic | Finding | Effect on the design |
| --- | --- | --- |
| Bracket / cover orders | **Deprecated.** API v3 accepts only CNC, INTRADAY, MARGIN and MTF; productType "BO" / "CO" is rejected | No BO/CO path |
| SL / TP on a pending order | Optional `stopLoss` / `takeProfit` on a normal order, as offsets from the entry (`legType` 1 = points, 2 = percent) | Entry order carries the first SL/TP |
| SL / TP on an open position | `PATCH /api/v3/positions` with `positionId` (e.g. `MCX:CRUDEOIL25NOVFUT-INTRADAY`) sets, modifies or cancels them; `qty` optional, max the position quantity. Modify-order on a filled order fails with "Not a pending order" | **The stop sits with Fyers**, like MT5: the position stays protected if the helper is down. Trailing = modifying the position's stop |
| Open questions on the above | Whether `stopLoss` is a price or an offset in practice, and what order Fyers sends to the exchange when it triggers | Test with 1 lot in live mode (paper can't test it: data-only apps can't place orders) |
| Positions | **Netted per symbol + product.** A second buy averages in | Trade = flat to flat; adds recorded inside it |
| Index options | SL-M is refused ("stop loss market orders not allowed" for NFO OPTIDX); SL-L required | Stops on options are stop-limit **plus a backstop**: if price is through the stop and the position is still open after a few seconds, exit at market. Applies to MCX options too until checked |
| MCX options | Options on futures; in-the-money at expiry **devolve into a futures position** | Expiry guard: warn ahead of expiry, offer to close |
| Rate limits (Standard) | Transaction APIs: 10/s, 200/min, 1,00,000/day. **Data APIs (history, quotes): 5/s, 50/min, 5,000/day.** Data socket: 100 symbols. **Exceeding the per-minute limit more than 3 times in a day blocks the user for the rest of the day** | One shared request budget (~5/s, ~120/min) with headroom reserved for exits; trailing only on meaningful steps, at most once every few seconds per position; no polling; back-off on refusals; "safe mode" after any rate-limit reply, with a strike counter on the panel |
| Live updates | Order websocket `wss://socket.fyers.in/trade/v3` pushes orders, trades and positions | No polling of order book / positions |
| Market data | Data websocket (binary protocol, handled by the official Python SDK) | Helper uses the official `fyers-apiv3` SDK (3.2.0, 16 Oct 2026) |
| Symbol master | Daily per-segment files incl. `MCX_COM`; JSON version has `minLotSize`, `tickSize`, `qtyFreeze`, `tradeStatus`, `expiryDate`, strike, option type, underlying | Lot rounding, freeze-qty slicing, option-chain picker built from it |
| Margin | Multi-order margin calculator (up to 50 orders) returns required and available margin | Pre-send margin check |
| Prime plan | Paid. Data APIs 10/s, 500/min, 5,00,000/day; 5,000 socket symbols; 5+ years intraday and expired F&O history | Not needed now. Live prices come from the socket (not counted); history is cached; the backup quote poll is one batched request at most every 10 s. The helper refuses data calls past 3/s, 35/min, 4,000/day. Revisit only for backtesting history |
| Static IP / daily login | Unchanged from v1: trading app bound to a whitelisted static IP; 2FA login once every trading day | Server IP is whitelisted at go-live; daily login button on the page |

Market orders are still converted to MPP orders; the panel shows what was sent and what filled.

## 4. Architecture

```
 Portable page (a bookmark)                          Helper on DigitalOcean (Bangalore)
 any laptop or phone                    HTTPS + WS   Python + FastAPI, official fyers-apiv3 SDK
 chart, panel, drag lines, rules  ◄───────────────►  Fyers session, sockets, orders, trailing,
 password login, "Log in to Fyers"                   guards, paper engine, journal uploads
                                                              │
                                     Fyers API v3 ◄───────────┤
                                     Telegram (screenshots)   ◄┘
```

**The page** holds only the helper's address. You open it, type your password, and it works. It never talks to Fyers directly and holds no secrets.

**The helper:**

- holds the Fyers App ID / Secret, the daily token, the Telegram bot token and the rules, entered once through a **first-run setup screen** in the page (never in chat or the repo);
- receives the daily Fyers login directly: the app's redirect URL is the helper's own address;
- keeps the journal (paper now, live later) and sends chart screenshots to Telegram.

**Hosting and security:**

- DigitalOcean droplet, Ubuntu 24.04, Bangalore, with a reserved IP.
- Address `https://68-183-245-178.sslip.io` (sslip.io, no domain needed) with automatic HTTPS (Caddy + Let's Encrypt). Ports 22, 80 and 443 only; the helper listens on 127.0.0.1.
- **Deploys from GitHub:** the server pulls the repo every minute with a read-only deploy key and restarts the helper when it changes. Claude delivers a zip, the user uploads it to GitHub, and the server picks it up within a minute; no one logs in to the server to deploy.
- Logs and status are shown on an admin screen in the page.

## 5. Features (mapped from LiveTrader)

Unchanged from v1 §5, with these changes:

- **Order types:** market (MPP), limit, SL-L; SL-M only where the exchange allows it. No bracket orders.
- **SL / TP:** set on the entry order, then kept on the Fyers position and moved by trailing or a drag.
- **Option-chain picker** from the start (MCX options), built from the symbol master; lot size and freeze quantity shown.
- **Sizing for bought options:** premium distance to the stop × lot size. The margin calculator for sold options and futures.
- **Adds:** the risk tool sizes an add so the whole position, at the new shared stop, stays inside the risk cap and the loss room.
- **Expiry guard** for MCX options (devolvement).
- **Rate-limit budget** and safe mode (§3).

## 6. Journal integration

> **Superseded (30 Oct 2026):** the journal will be built into the hosted app instead of uploading to the Telegram journal. The field rules below (one trade flat to flat, adds averaged, entry order id as ticket, ₹ and IST) still apply to the built-in journal; the Telegram channel is used for screenshots only.

The helper uploads trades the way LiveTrader does (download the pinned `trade_journal_db.json`, add the trade, bump `rev`, replace the file). The journal merges by id and `updatedAt`.

| Topic | Decision |
| --- | --- |
| Where | Paper journal on a **separate Telegram channel**, settings INR and UTC +5.5, no DST |
| Two journals in one browser | The journal stores its bot / channel in browser storage per site, so a second channel needs either a copy of `paper_journal.html` with its own storage keys or a journal switcher. **User to choose** |
| `ticket` | The journal keeps digits only, so the entry order id is used (a position id would become empty) |
| `volume` | Lots for MCX and F&O, shares for stocks; quantity in units goes into notes |
| Adds | One trade flat to flat: average entry, largest size held, total risk at the stop as initial risk, each add listed in notes. R is unaffected (the journal works it out from prices and P&L) |
| Charges | Brokerage, STT, exchange, GST and stamp go into `commission` |
| Account balance fields | Reuse `mt5Start`, `mt5Balance`, cycles and payout records; the "(MT5)" label is cosmetic |
| Journal account | `acc_<fyers client id>`, firm "Fyers", phase "Personal" |

**Journal changes for later** (none block milestone 1):

1. The trade chart's feeds (Dukascopy, Binance, Twelve Data) don't carry MCX or NSE. Short term: let the symbol overrides accept a colon (`MCX:CRUDEOIL25NOVFUT = tradingview:MCX:CRUDEOIL1!`) so the TradingView view works. Longer term: the helper serves its own candles to the journal's chart.
2. The session table uses London / New York hours; relabel for IST.

## 7. Phases

1. **Server and plumbing** (v0.1.0 built 30 Oct 2026): DigitalOcean droplet, sslip.io + HTTPS, deploy-from-GitHub, first-run setup screen, password login, daily Fyers login (data-only app), symbol master, live MCX prices on the page's chart.
2. **Paper trading** (v0.2.0, 30 Oct 2026): server-side paper engine; all charges in every ₹ figure; bid/ask fills; panel, draggable lines, sizing, adds, trailing, guards, Fyers margin, option stops on the option or the future, history, CSV, full-screen chart. Paper capital ₹25,000; every rule editable in the app.
2b. **Pine Script indicators** via PineTS (paste your script), with hand ports where PineTS can't draw.
3. **Live:** whitelist the server IP, activate the trading app, 1-lot tests of the position SL/TP behaviour, then switch to Live.
4. **Journal in the app** (paper, then live), Telegram screenshots.
5. **Indicators and context** in the app (v1 §7), then extras.

## 8. Open questions

1. MCX first: futures, options, or both from the start.
2. ~~Two journals in one browser~~ — settled: the journal lives in the hosted app.
3. Rules: risk per trade, daily / max loss, max trades per day, SL required.
4. Capital base for % limits.
5. Indicators to rebuild first.

## Sources

- [How to set SL/TP on algo entries now that CO & BO are deprecated? (FYERS Community)](https://fyers.in/community/t/how-to-set-sl-tp-on-algo-entries-now-that-co-bo-are-deprecated/24799)
- [SL and TP (FYERS Community)](https://fyers.in/community/t/sl-and-tp/24325)
- [Set Stop Loss & Target (FYERS API docs)](https://fyers.in/api-docs/v3/api/trading/positions/set-stop-loss-and-target/)
- [fyers-apiv3 3.2.0 (PyPI)](https://pypi.org/project/fyers-apiv3/3.2.0/)
- [Plans & Limits (FYERS API docs)](https://fyers.in/api-docs/v3/getting-started/plans-and-limits/)
- [General WebSocket overview (FYERS API docs)](https://fyers.in/api-docs/v3/api/websockets/general-socket/overview/)
- [Symbol Master JSON (FYERS API docs)](https://fyers.in/api-docs/v3/api/market-information/symbol-master/symbol-master-json/)
- [Multi-order Margin Calculator (FYERS API docs)](https://fyers.in/api-docs/v3/api/calculators/multi-order-margin-calculator/)
- v1 sources (SEBI framework, Fyers app activation, app activation) still apply.
