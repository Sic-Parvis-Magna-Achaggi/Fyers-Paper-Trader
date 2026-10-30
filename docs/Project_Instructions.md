PROJECT: Fyers Trade Manager (India), an MT5 "LiveTrader EA"-style trade manager for Fyers

WHAT IT IS
- A web app served by a Python helper (FastAPI) on my DigitalOcean droplet (Bangalore), at https://68-183-245-178.sslip.io behind Caddy. systemd services: fyers-helper, plus fyers-update.timer, which pulls the repo every minute.
- Code lives in my private GitHub repo Sic-Parvis-Magna-Achaggi/Fyers-Paper-Trader. Always work from the latest commit there.
- Users: I am "admin". Everyone logs in with username + password + a 2FA code. Other users I add are paper-only, with their own Fyers app for prices. Live trading is for me only (SEBI / Fyers static-IP rules).
- Each user can have several paper accounts (switcher in the top bar).
- Reference docs in this project: LiveTraderEA.mq5 (the MT5 EA the app should behave like), Fyers_Trade_Manager_Brief.md, claude/Fyers_Paper_Trading_Guide.md, claude/Roadmap.md, claude/Handoff.md and octagon_journal.html (the journal to port).

ROADMAP (THE TASK LIST)
- docs/Roadmap.md in the repo, with a copy at claude/Roadmap.md in this project, is the one task list. Read it, and claude/Handoff.md, at the start of every new chat.
- When I ask for something new, add it to the roadmap straight away, in the order I say, with any design we agree.
- When a task ships, tick it [x] with its version and move it to Done. Half-done tasks stay in Next with their finished parts ticked.
- Update both copies (repo and project) with every zip, and whenever I change the order or add a task.
- Keep docs/Handoff.md current too (where things stand, how the code is laid out, what's next).

HOW TO DELIVER CODE
- Give me a zip of the changed repo, with the top folder "Fyers-Paper-Trader/". I upload it by dragging the folder's CONTENTS into the GitHub repo, not the folder itself.
- EVERY zip comes with: (1) changelog text I can paste, (2) a one-line commit message, (3) the new version number. Keep VERSION and CHANGELOG.md updated in the repo.
- Test everything before giving me a zip with the test kit in tests/ (tests/README.md): run the helper against the fake Fyers feed and click through the page in a real browser. Tell me plainly what was and wasn't tested, especially anything that needs the live Fyers feed.
- Never remove existing features or routes by accident. Run tests/routes_check.py before each release, and add new routes to it.
- Update docs/Paper_Trading_Guide.md (and the project copy) whenever behaviour changes.

TRADING RULES THE APP MUST FOLLOW
- Every ₹ figure (SL, target, risk, P&L, R, break-even) is NET of ALL charges for both entry and exit: brokerage, exchange transaction fee, clearing, STT/CTT, stamp duty, SEBI fee, GST (and the DP charge on delivery sells). Use Fyers' current charges list, like the LiveTrader EA does. Rates are editable in the app; the server checks Fyers' charges page daily and asks me to review changes.
- BE = break-even + costs, like the EA's BreakEvenPrice, plus a BE buffer in ticks.
- 1R = first entry to first stop. Trailing never goes below BE and never moves backwards.
- Paper fills: market buys at the ask and sells at the bid. Stops trigger on bid (long) / ask (short), like MT5. Targets and limit orders also fill when a trade goes through their price, including a new day low/high between snapshots.
- Risk guards like the EA: daily loss %, max loss % (static or trailing), buffer, risk cap per trade, max margin, max open risk, max trades, SL required, intraday square-off and the expiry-day exit. Every rule, risk and default must be settable in the app and saved on the server, so it survives logout and works on any device.
- Intraday square-off runs 5 minutes (settable) before Fyers' own square-off for each market, cancels pending Intraday orders and refuses new ones after it. The product (Intraday / Carry / Delivery) stays the default until I change it.
- Starting paper capital: ₹25,000.
- On options, the SL can follow the option itself or the underlying future, chosen per trade.
- Live mode (agreed design, see the roadmap): a real stop at Fyers that the trail moves; the server watches with the bid/ask rule and converts that same order to market if needed; targets held by the server; never two exit orders at Fyers.

CHART / UI EXPECTATIONS (MT5-like)
- On-chart long/short tool with SL/TP zones and net ₹. It picks market/limit/stop automatically and has PLACE and the product switch on the preview. BUY/SELL buttons on the chart, positionable in any corner with an X/Y offset.
- Solid bid/ask lines and a Last line. Every chart line's colour and style is set in Chart settings.
- Position bar on the entry line: ✕, BE, BE-T [R], TRAIL [R].
- Maximise inside the browser (F); real full screen is optional (Shift+F). The trade panel can be closed.
- Custom timeframes, candle timer, Order Book tab, Volume pane (via ƒx).
- Indicators come from the ƒx menu, with show/hide and collapse like TradingView. My own Pine Script indicators are written in the in-app Pine Editor (TradingView-like), saved on the server and added from ƒx.
- Pages: Chart, Trades, History, Book, Account, Log.

LIMITS
- Fyers API v3 on the Standard plan. Data: 5/s, 50/min, 5,000/day; the helper keeps under 3/s, 35/min, 4,000/day and queues instead of failing. Orders and account calls: 10/s, 200/min, 1,00,000/day; the helper queues at 4/s, 120/min. Going over a per-minute limit more than 3 times in a day blocks the account for the day. Tell me if anything really needs Fyers Prime.
- Live orders go only from the droplet's own IP, 134.209.159.171, whitelisted in my Fyers app (not the reserved 68.183.245.178).

SECURITY
- Never ask me to paste passwords, 2FA codes, recovery codes, API secrets, tokens or private keys into chat. The Fyers App ID/Secret is entered only in the helper's own Settings screen.
- I create accounts, enter card details and passwords myself.
- The server's GitHub deploy key stays read-only.
- 2FA is mandatory for every user; sensitive actions ask for a fresh code. Locked out: python -m helper.users rescue admin on the server console.

HOW TO WORK WITH ME
- Explain things in plain language, with numbers from my actual trade when I report a problem.
- When I report a bug with a screenshot, first work out whether it's a real bug or the display misleading me. Say which, then fix it.
- If something is a judgement call (it changes how trades fill or how money is counted), tell me before changing it.
