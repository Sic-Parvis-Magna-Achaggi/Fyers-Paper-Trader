# Handoff: where the project stands (for a new chat)

Updated 31 Oct 2026, version **0.14.0**. Read this, `docs/Roadmap.md` (the task list: what's next, with the agreed
live-mode design, and what's done), `CHANGELOG.md` (what's done) and `docs/Paper_Trading_Guide.md` (how the app behaves).

## Getting the code

The repo is `Sic-Parvis-Magna-Achaggi/Fyers-Paper-Trader` (private). The owner uploads release zips by dragging the
folder's contents into GitHub; the server pulls every minute. Always start from the latest commit in the repo, not
an old zip. Every release: changelog text, a one-line commit message, the version number; VERSION and CHANGELOG.md
updated; `tests/routes_check.py` passes; the guide updated when behaviour changes; the project copies of the guide
and roadmap updated too.

## How the code is laid out (v0.14)

- `helper/app.py`: FastAPI routes. Login is username + password + TOTP code; sensitive routes need a fresh code
  (HTTP 428, the page asks and retries). `X-Acct` header picks the paper account.
- `helper/users.py`: users, 2FA (TOTP + recovery codes), sessions, lockout, AES-GCM seal / unseal of secrets
  (`data/secret.key`), the security log (`data/audit.jsonl`), and the console rescue
  (`python -m helper.users rescue admin`).
- `helper/rt.py`: per user, the Fyers link, the price feed and the accounts (one `Paper` engine each, or a
  `LiveEngine` for the admin's Live account, plus that user's Fyers order-update socket). `set_mode()` switches an
  account Paper <-> Live. Data: `data/u/<user>/` and `data/u/<user>/a/<account>/` (a Live account keeps its Fyers
  order ids under `"live"` in `paper.json`). `rt.make_broker` / `rt.make_stream` are what the tests swap for fakes.
- `helper/live.py`: `LiveEngine(Paper)`: the paper engine's rules, sizing, guards, BE, trailing and targets, with
  real orders. Entries fill from Fyers' reports; a stop-limit at Fyers from the start that `_a_sync` moves; exits via
  `close()` -> `request_exit()` -> `_a_exit` (NSE / BSE: stop -> market; MCX: cancel, confirm, one market exit);
  `on_update()` takes every order update (socket or order book); `_a_poll` reads the order book (restart, overnight,
  socket down); kill switch `kill()` + `_a_kill2`. One asyncio worker per account runs Fyers calls one at a time,
  exits first; all state changes happen on the event loop.
- `helper/broker.py`: `FyersBroker` (place / modify / cancel / order book / positions / funds, on the order budget;
  `BrokerRefused` = Fyers said no, `BrokerUnsure` = maybe placed: look it up by order tag) and `OrderStream` (our own
  client for Fyers' order-update socket, with reconnects).
- `helper/fyers_link.py` (Fyers REST, per user, with request budgets), `helper/feed.py` (live prices per user),
  `helper/paper.py` (paper engine: fills, stops, BE, trailing, guards, square-off), `helper/charges.py`,
  `helper/charges_watch.py`, `helper/symbols.py`, `helper/candles.py`.
- `web/index.html` (main page and chart), `web/paper.js` (ticket, chart tool, positions), `web/pages.js` (Trades,
  History, Book, Account, Log pages), `web/pine.js` + `web/pine_worker.js` (Pine Script, PineTS), `web/security.js`
  (login gates, 2FA set-up, step-up, Security and Users settings, account switcher), `web/live.js` (LIVE badge, KILL,
  live warnings, the Fyers stop on each position, the Live card, the Paper <-> Live dialog; it wraps paperUpdate,
  renderPlan, pgPositions and pgAccount).
- `tests/`: the test kit (fake Fyers feed and order API, route check, engine tests incl. `live_test.py`, browser
  tests incl. `live_flow.js`). See `tests/README.md`.

## Users on the server

- **admin** = the owner (live trading is the owner's only). Other users are paper-only, each with their own
  Fyers app for prices (SEBI / Fyers static-IP rules; see the roadmap).
- Still open with Fyers support: whether a second user's app may fetch market data from this server's IP.

## Project instructions

`docs/Project_Instructions.md` is the text of this project's instructions in claude.ai (the owner pastes it there).

## Where live mode stands (v0.14.0)

Built to the agreed design and tested against the fake Fyers order API (`tests/live_test.py`, 61 checks;
`tests/live_flow.js` in a browser). **Not yet run against real Fyers.** Things only a real trade can confirm:
- the order-update socket's messages (field names per Fyers' docs and the SDK's map; the order book poll is the
  fallback either way);
- that Fyers accepts SL-L -> market modification on NSE / BSE (its support page says yes) and refuses type changes
  on MCX (the app cancels and re-sends there anyway);
- the exact refusal texts and how market-price protection shows in the order book;
- whether the positions API reports `netQty` for carried (NRML) positions the way the overnight check expects.
- the holdings API's field names (`quantity` / `remainingQuantity`) for overnight delivery (CNC) stops.

Known limit: one Fyers worker per account runs actions one at a time (exits first). A Fyers call that hangs (up to
15 s, plus up to 30 s queued on the order budget) holds up the rest of that account's actions meanwhile.

Safety principles in `live.py` (keep them when changing it): an order's tag and its "sent" / pending mark are saved
before it's sent; an order Fyers didn't confirm is looked up by tag, never re-sent; every fill of a stop or exit is
booked once per Fyers order id (`L["filled"]`); any open app order that nothing is waiting for is cancelled
(`_stray`); an exit is never larger than what Fyers holds; MCX exits wait for the stop's cancel to be confirmed.

## Next job

1. The owner's first real trade: whitelist 134.209.159.171 (order permission), turn on Live, 1 lot on MCX.
   Fix whatever that shows.
2. Compare the app's charges with what Fyers deducted (roadmap item 1, last part).
3. Telegram alerts (roadmap item 2), then the journal, candle types, saved layouts, multi-charts and the mobile
   version (roadmap items 3-7, in that order).
