# Paper and live trading: how it works (v0.30.1)

Paper trades run **on the server**. Stops, targets, trailing, intraday square-off and the expiry-day exit keep working with the page closed, as long as you've logged in to Fyers that day, so prices are flowing.

## Logging in, users and security

- **Login** is your username and password, then a 6-digit code from your authenticator app (Google Authenticator, Microsoft Authenticator, Authy or similar). Lost your phone? Type one of your recovery codes instead of the app code; each works once.
- **First login** (and the first login after this update, as user **admin** with your old page password): you scan a QR code into the app, type the code it shows, and save the 10 recovery codes shown once.
- **Settings → Security:** change your name or password, get new recovery codes, move 2FA to a new phone, see every device you're logged in on (log any out, or everywhere else), and recent activity.
- **A fresh code is asked again** (valid 5 minutes) for sensitive actions: adding or changing users, new recovery codes, moving 2FA, editing charge rates, turning an account Live, Resume after the kill switch.
- **Lockout:** 5 wrong passwords or codes lock that user for 15 minutes. Sessions end after 48 hours without use and after 7 days at most.
- **Users (admin only, Settings → Users):** add a user with a temporary password. They choose their own password and set up 2FA at first login, then enter their own Fyers app in their Settings for prices. You can disable / enable a user, reset their 2FA (lost phone) or give them a new temporary password. Other users are paper-only; live trading is the admin's only.
- **Watchlists:** several named lists. At the top of the Watchlist tab (phone: Quotes › Watchlist) pick a list; **＋** makes a new one; **⋯** renames, moves up / down or deletes it (tap Delete twice; the last list can't be deleted). Up to 10 lists of 30 contracts. **+** in Find adds to the list on screen. **Changing a contract's lists:** ⋯ on its row (or right-click the row; on a phone, swipe the row left for **Lists · Remove**) opens a picker with every list: a tick shows each list it's in, and tapping a list adds it there or takes it out (so it can sit in several lists); **Move** puts it in that list and takes it out of this one in one tap; **Remove from …** takes it off the list on screen. On a phone a tap on a swiped-open row just closes it. Only the list on screen streams prices (with your chart and your trades). Saved on the server, so every device has the same lists.
- **Everything is per user:** Fyers app and login, watchlists, chart set-up, Pine scripts, paper accounts. Charge rates are shared; only the admin edits them.
- **Lost phone and recovery codes (admin):** on the server console, in `/home/helper/app`, run `sudo -u helper /home/helper/venv/bin/python -m helper.users rescue admin`. It prints a temporary password; log in with it and set up 2FA again.

## Paper accounts

- **The switcher** at the top shows the account you're looking at and its balance. Pick another to switch; the whole app (chart lines, ticket, Trades, History, Account, Log) follows it.
- **+ New account…** (in the switcher, or the Account page): a name, starting capital, and default rules or a copy of another account's rules and trailing.
- Each account has its own balance, rules, trailing defaults, positions, orders and history. All of them keep running on the server (stops, targets, trailing, square-off), whichever one you're looking at.
- **Rename, archive, restore** on the Account page. Archiving needs the account flat (no positions or orders) and keeps its trades. You always keep at least one account.
- **Reset** (Account page) starts the account you're looking at again; its old trades are archived on the server.

## Live trading (the admin only)

An account can be **Paper** or **Live**. A Live account uses the same ticket, chart tool, rules, guards, BE, trailing and targets as paper, but its orders go to Fyers on your own login, from the server's own IP **134.209.159.171**.

**Before the first live trade:** whitelist **134.209.159.171** in your Fyers API app (not 68.183.245.178) and give the app order permission. Then test with **1 lot on MCX**.

**Turning it on:** Account page → *Your accounts* → **Turn on LIVE** on an account with no positions or orders. Type your Fyers client ID (shown in the dialog) and a fresh 2FA code. Its paper trades are archived on the server and it starts a fresh ledger at the capital you type (that's what the % rules use), so paper results and real money never mix. One Live account per Fyers login. **Back to Paper** works the same way (flat first). Both are in the security log.

**You'll see:** a red **LIVE** badge and a **KILL** button in the top bar, a red line under the top bar, **LIVE** on the PLACE button, "● LIVE" in the account switcher, and under every position where its stop is at Fyers.

**How a live trade runs**

- **Entry:** the order goes to Fyers. The position opens only when Fyers reports the fill, at Fyers' price. Market orders become Fyers' market-price-protection orders. No after-market orders: a contract that isn't trading is refused. Every live trade needs a stop.
- **The stop at Fyers:** as soon as the trade opens, a **stop-limit (SL-L)** order goes to Fyers at your stop. Its limit sits a little past the trigger (Rules: *LIVE: stop-limit slack*, 0.5% of the price or at least 5 ticks), so it fills even if price jumps. Example from the test: a CRUDEOIL long with the stop at 5,585 → Fyers stop 5,585, limit 5,557. Fyers doesn't take stop-market (SL-M) orders on options or BSE, so the app uses stop-limits everywhere.
- **Trailing, BE and BE-T** move that same Fyers order (never below BE + costs, never backwards). Changes are paced at least 1.5 seconds apart per trade. Moving the SL yourself moves it too.
- **The server still watches** with the bid / ask rule, like MT5 and paper: a long's stop fires when the bid reaches it. Fyers triggers its stop on the last traded price, so the server usually acts first, and live exits can differ from paper by a tick.
- **Closing** (the server's stop rule, the target, intraday square-off, the expiry-day exit, ✕, Close all, the kill switch):
  - **NSE / BSE:** the stop order itself is changed into a market order.
  - **MCX:** Fyers doesn't allow changing an order's type there, so the app cancels the stop, waits until Fyers confirms it's gone, then sends one market exit.
  - Either way there is **never more than one exit order** at Fyers for a position. If Fyers refuses a market order (some MCX options), a limit that crosses the spread is sent instead. An exit still open after 3 seconds (*LIVE: re-price…*) is re-priced to cross the spread.
- **Targets stay on the server** (no target order at Fyers), so a stop and a target can never both fill.
- **A stop that triggered but didn't fill** (price jumped past its limit): the server's rule catches it and turns it into a market exit.
- **The trade is recorded** at Fyers' fill price, with every charge, net, as in paper.

**When things go wrong**

- **The server is down:** the stop at Fyers protects the position at its last level. Trailing and the target pause. When the server is back it reads Fyers' order book first: a stop that filled is recorded; then trailing resumes; a target already passed closes at market on the first price.
- **Fyers refuses or is slow with a stop change:** the previous stop stays in force at Fyers, a warning shows, and the app retries.
- **Fyers doesn't confirm an order** (a time-out): the app looks the order up by its tag and never sends it twice.
- **No stop at Fyers** (refused, or waiting for the market): a red warning shows under the top bar and on the position until it's in.
- **Overnight (Carry / NRML):** Fyers orders last one day. The next day, after your Fyers login and once the contract trades, the app places a fresh stop at the trailed level. Until then a warning shows. Before placing it, the app checks Fyers still has the position. If it was closed while the app was away, the trade is recorded as "closed at Fyers" at the last stop price, with a warning to check the real price in Fyers' trade book.
- **No Fyers login today:** new orders are blocked; stops already at Fyers stay in force, but trailing can't move them and targets / square-off can't close.
- **Part fills:** if Fyers fills only part of a stop or an exit, that part is recorded at once and the rest stays open (with its stop, or still closing). An exit is never larger than what Fyers still holds.
- **"CHECK FYERS" warnings** appear when only you can sort something out in Fyers (for example an app order that filled after the app had stopped tracking it). They stay until you press **Resync with Fyers**.
- **Delivery (CNC) shares:** a stop that sells delivery shares needs your Fyers authorisation to sell from your demat (TPIN / DDPI), as for any sell of shares you hold.

**Kill switch** (KILL in the top bar, or the Account page): cancels every order and closes every position at Fyers on your login, the app's trades **and any others**, then pauses new entries until you press **Resume** on the Account page (Resume asks for a fresh 2FA code). Stops keep working meanwhile, and an entry that fills during it is closed too. KILL asks once to confirm (no 2FA code, so it's quick).

**Account page (Live):** whether you're logged in to Fyers, whether order updates are connected (if not, the app reads the order book every 5 seconds), your Fyers funds, **Resync with Fyers** (re-reads Fyers and puts every stop where it should be), Resume and the kill switch.

**Telegram alerts** (Settings › Telegram alerts, the admin): a message on your phone when the server stops looking after a live trade. Only while a Live account has a position or an order at Fyers.

- **Set-up, once:** in Telegram, open **@BotFather**, send `/newbot` and copy the token (the journal's bot works too). Paste it in Settings › Telegram alerts → Save (asks for a 2FA code; saved encrypted, never shown again). Send your bot any message (*hi*), press **Find my chat** and tap your name (or a channel / group the bot is in). **Send a test message** to check.
- **The server isn't responding** (default 30 s): a separate watchdog on the server asks the helper every 5 seconds, so it still works when the helper has crashed or hung. The message lists each live trade and its stop at Fyers (or "no stop at Fyers: protect it in the Fyers app"), says what's paused (trailing, BE, targets, square-off, the server's own stop check) and comes again every 10 minutes while it stays down (settable, 0 = once). "Answering again" when it's back. Measured: about 33 s after a crash, 38 s after a hang, with the default 30 s. Outside market hours it arrives silently.
- **A live warning lasting 30 s** (settable): no stop at Fyers, a refused stop change, no Fyers login, a "check Fyers" alert. Then "Sorted" when it clears. Only in that contract's market hours (a carried position's stop waiting for the open isn't sent).
- **No prices for an open live trade for 60 s** (settable) in its market hours, after it had prices that day (so a holiday isn't an outage). "Sorted" when prices are back.
- **If the whole server goes down** (droplet off, network cut), nothing on it can send. Optional: a free check at **healthchecks.io** (Period 1 minute, Grace 2 minutes, its Telegram integration). Paste its Ping URL in the same section: the watchdog pings it every minute while a live trade is open. With its API key (not read-only) the check is paused while you're flat, so it only alarms during live trades; without the key it's pinged all the time.
- The Account page's Live card shows **Telegram alerts: on / not set up / watchdog not running**.

**Limits:** live orders, changes and cancels share Fyers' 10 a second / 200 a minute (the helper queues at 4 a second, 120 a minute). Fyers' order-update socket doesn't count against them. The Standard plan is enough; nothing here needs Fyers Prime.

## Markets

- **MCX** commodities, **NSE and BSE** stocks, indices, F&O, and NSE currency. Find has exchange and type filters; **Opt** on an index, stock or future opens its option chain.
- **The option chain (Options tab):** one slim row at the top holds the underlying (type it, Enter), the expiry and **ATM**; it stays there while the strikes scroll under it, on the desktop and the phone. The chain opens at the strike nearest the price (the index or stock, else the future) when you open an underlying or an expiry, and never moves by itself after that; the nearest strike's highlight follows the price; **ATM** scrolls back to it. Click **CE** / **PE** to open its chart. **＋** beside each CE and PE opens the list picker (tick the lists it should be in); it shows **★** once the contract is in a list. Right-click a CE / PE still adds it straight to the list on screen.
- **Indices** are for charts only: BUY / SELL tells you an index can't be traded. Trade its futures or options.
- **Stocks:** Intraday or Delivery (CNC). A delivery sell needs shares you hold, as at the broker; to short a stock, use Intraday.
- **F&O, currency, commodities:** Intraday or Carry (NRML).
- **Product (Intraday or Carry / Delivery)** is chosen in the trade panel or with the **INTRADAY / NRML / CNC** button on the chart's PLACE box. Whatever you pick stays the default for later trades in that account (saved on the server) until you change it. Margin comes from Fyers for that product.
- **Intraday square-off: 5 minutes before Fyers'.** Fyers squares off Intraday positions itself and charges ₹50 + GST per order for it. Its times: index and stock F&O **15:25**, stocks that have F&O **15:05**, other stocks **15:20**, MCX **23:20** while the US is on summer time and **23:45** the rest of the year. At 5 minutes before each one, the app:
  - closes every Intraday position in that market;
  - cancels pending Intraday orders;
  - refuses new Intraday orders for the rest of the day (pick Carry / Delivery instead).
- The app switches the MCX time by itself when US clocks change (second Sunday of March, first Sunday of November). The minutes, Fyers' times and on / off are all in Rules. Carry (NRML) and Delivery (CNC) positions are never squared off.
- **Expiry-day exits:** MCX 22:45, NSE and BSE 15:00, currency 12:00 (Rules). Currency intraday closes at 16:45 (Fyers doesn't offer currency intraday at present).

## Pages

The top bar has **Chart · Trades · History · Journal · Book · Account · Log**. The chart keeps running while you're on another page, and the address remembers the page.

- **Trades:** all open positions and pending orders in tables. Click any price to change it; set Trail BE / Trail SL per trade; BE, close, cancel. BE all, Cancel all orders and Close all at the top.
- **History:** filters, stats (net, win rate, profit factor, average R, expectancy, drawdown, streaks...), an equity curve, daily P&L, results by contract and by exit, and each trade's charges. Download the filtered list as CSV.
- **Journal:** your trade journal, the Octagon (see below).
- **Book:** up to 4 order books side by side.
- **Account:** the account's figures, your paper accounts (new, rename, archive), rules, trailing defaults, reset and the charges in use.
- **Log:** everything the paper account did, the helper's own log, and **Security** (your logins, 2FA and password changes).

## Journal (the Octagon)

The Octagon trade journal, inside the app and saved on the server (per user, every device).

- **Trades arrive on their own.** Every paper and live trade of every account: it appears when it opens and is completed when
  it closes (a live position closed in parts is one trade). Trades from before the journal (each account's history and the
  archives of resets and Paper ↔ Live switches) were taken in once, and count as claimed reps.
- **Money and R are net.** ₹ is after every charge, R = net ₹ ÷ the net risk at the first stop, exactly as History shows them.
  So a "2R win" for the 99 Club is 2R after charges, and the target in R (Pillar 8) is the net ₹ at your take-profit ÷ that
  risk. (Octagon worked R out from points before charges.)
- **A session** is one trading day of one account (IST; the day starts at the reset hour in that account's rules, 06:00 by
  default). Times of day are Indian buckets (opening hour, morning, midday, afternoon, after NSE close, evening, night).
- **The audit:** open a trade, **Audit this trade**: the 8 pillars, word for word (Direction & regime with the Pillar 1 checks,
  market regime, bias and KE; Wait state; Execution and what went wrong; numbers running; payout pressure; Zen Temple;
  Target), setup tags, plan and review. The octagon at the top follows every click. A Zen Temple breach makes Execution wrong.
  Pillars 4 and 5 are worked out from the session; Pillar 8 is optional on a losing or open trade.
- **Reps:** every closed trade is one rep, across all your accounts in the order you took them. **Hold to claim** each new rep.
  Milestones every 50 (settable); "Reps done before this journal" carries an older count on.
- **Today:** the session's octagon, P&L (closed trades, net), the room before the 2% line, the 99 Club count, the daily
  ground-state practice tick with its streak, and **Hold to end today's session**. Pick the account with its chip (or the Account filter).
- **The 5% execution block** (Pillar 6) of that account, on top of the list.
- **Filters:** period (by close time, IST), account, contract, side, octagon (clean, any pillar broken, each pillar, not
  fully audited, still open, removed), regime, setup tags (any of / all of), search. They're saved with your settings.
- **Remove from journal** takes a trade out of the stats, reps and sessions (it stays in History); Octagon › Removed brings it back.

**Lockouts refuse new orders** (Journal › Settings, a switch each, all on at first):
- **2% trailing drawdown** (Pillar 4): the day's closed trades (net) fall 2% of the account size below the session's peak →
  no new orders until the next trading day. Open P&L doesn't count (as in Octagon).
- **The 99 Club break** (Pillar 5): 3 wins in a row, or 3 wins of 2R or more → no new orders for 20 minutes.
- **Session over** (Pillar 5): a trade marked "my mind was running numbers", or Hold to end today's session → no new orders
  until the next trading day.
- **Cancel waiting entry orders when a lockout starts** (Live: at Fyers too).
While locked, the ticket's preview says why, PLACE is off, and a red pill in the top bar names the lockout (amber "not
blocking" when its switch is off). Closing, BE, trailing and the stops of open trades are never blocked. The numbers (2%,
20 minutes, 3 wins, 2R, the 2.5R stretched-target flag, the 5% block, the rep milestone) are in Journal › Settings, with the
text of each pillar and the Pillar 1 checks (Original puts your text back).

**▶ On chart: each finished trade on its own chart** (v0.29.0; each trade's card in the Journal, a History row's
details, the phone's History tab). It opens over the page; **← Back** or Esc returns you to your page as it was.
- **What's recorded** at every entry and exit, by the server (no page needs to be open): the contract, timeframe, chart type,
  Chart settings, every indicator with its settings (inputs, style, visibility, its own timeframe), a copy of each Pine
  script's code as it was then, and the contract's drawings as they were then. Editing a script or a drawing later doesn't
  change an old trade.
- **Which chart:** at the entry, the chart you placed the order from (in a grid, that chart; on the phone, the one on
  screen), also for a limit order that fills hours later. With nothing to go by (a trade from before v0.29.0's set-up was
  recorded, or no chart sent), your saved layout's chart for that contract, else your chart's set-up on that contract.
  At the exit, the same layout chart as it was then. **Entry set-up / Exit set-up** switch between the two;
  **Pine as recorded / My current Pine** shows the code as it was then or as it is now.
- **The trade on the chart:** the entry and each add, and each exit, at their real prices and times (net ₹ and R after all
  charges on the exit); the stop's path as it moved (a dot at each move, **BE** where it went to break-even), the target,
  the break-even + costs line, the trade's stretch shaded. The price scale always takes in the trade's own prices. On
  every chart type and timeframe. A stop on the underlying future isn't drawn on the option's chart (the bar says so).
- **The stop's path:** every stop / target move is recorded with its time from v0.29.0. For older trades it's rebuilt from
  the account's own log, which already noted each move (BE, each trail step, your edits); the log keeps the last 500
  entries of an account, so trades past that show only the first and last stop. The bar says which. It's never rebuilt
  by re-running the trail on candles.
- **▶ Play** shows the trade as it played out, like TradingView's bar replay: the chart starts 30 candles before the entry
  and the candles come one at a time. A candle that's still forming builds up from the 1-minute candles (5-minute ones on
  2h-4h charts, 15-minute on daily). Indicators and Pine scripts are worked out as each candle closes, from what was known
  then, as they would have been live (a script that repaints looks as it did at the time; other timeframes stop at the
  replay's time). The stop, target and BE move when they moved, and the bar shows the time, the price and the open trade's
  net ₹ and R after all charges. **⏮** to the start, **▶ / ⏸** (Space), **+1** one minute (→), **⏭** to the next candle
  on this chart (Shift+→), the speed (candles a second), **Entry / Exit** to jump there, **■ Stop** for the whole chart.
- Inside a minute the replay can't be finer than Fyers' 1-minute candles. Candles come from Fyers' history (the
  contract itself, never the continuous series); once the app keeps its own live candles (roadmap item 10) the replay
  will use those too.
- You can change the timeframe, chart type or indicators inside the replay to look around: nothing there is saved, and
  your own chart, layout and drawings aren't touched. Trading is off in the replay.
- On the phone the replay fills the screen; **⋯** shows the set-up and Pine switches and the notes.

**Pictures** (each trade's card, and the audit form). **Since v0.29.0 the automatic pictures are off** (the replay shows
each trade on its recorded chart instead): Journal › Settings › Pictures turns them back on. 📷, your own pictures,
paste and drop work as before.
- **Drawn on the server at entry and exit** (when switched on), from your own Fyers candles (5m and 120 candles unless you change it): the
  entry (and any adds), the first stop, the stop at the end, the target, the exit, the trade shaded green / red, and the net ₹,
  R and charges. No page needs to be open. It's one Fyers history request each, on the usual request budget. If Fyers doesn't
  answer (not logged in yet), the card says so and it tries twice more a few minutes apart; **Draw at entry / Draw at exit**
  does it by hand (also for trades from before v0.27.0). When the stop follows the underlying future, the option's picture
  leaves the stop and target lines out (they're on the future's prices) and says so.
- **The open chart's own picture** (when switched on), with your indicators and drawings, when a chart of that contract is on screen (any of your
  devices) as the trade opens or closes: labelled **Chart 5m · entry** etc., one per timeframe (with two charts of different
  timeframes you get both). Charts in a grid each add theirs. A chart that isn't on screen (another page open) adds nothing.
- **📷 on the chart bar** adds this chart's picture whenever you like, to the open trade on this contract (this account first),
  else the one that closed most recently in the last 24 hours.
- **Your own pictures:** **＋ Add pictures**, paste (Ctrl+V / ⌘+V) with the trade open, or drop them on the card. PNG,
  JPEG, WebP or GIF up to 10 MB (iPhone HEIC photos: share as JPEG). The viewer opens on it: pick its timeframe (1m … 1M,
  or Context).
- **The viewer:** a chip per picture, ← / → (swipe on the phone), change a label, **Full size**, **Download**, **Draw
  again** (server pictures), **Delete** (tap twice; its Telegram copy goes too).
- **Telegram backup copy** (Journal › Settings › Pictures): every new picture goes to the chat or channel you enter, silently,
  as a file (full quality) with the trade in its caption (contract, side, account, entry / stop / target, net ₹ and R, the trade's
  id). It uses the bot in Settings › Telegram alerts (admin only for now). Best: a new private channel just for the journal,
  with the bot as an admin that can post and delete. ✈ on a picture = in Telegram (✈! = failed: the viewer says why; it
  retries 4 times over an hour). **Send the pictures not in Telegram yet** sends the older ones. **Send a test** checks the
  chat. Pictures stay on the server either way; Telegram is only a copy.
- Settings › Pictures also shows how many pictures there are and the space they take.

**Insights** (Journal › Insights) use the same filters as the trade list (except Octagon, so held and broken trades can be
compared): KPIs; the equity curve with its drawdown underneath (Balance / P&L); performance (expectancy in ₹ and R, payoff,
profit factor, SQN, Kelly, Sharpe / Sortino / Calmar on daily returns over the account size, drawdowns, green days, runs,
how long winners and losers are held, charges as a share of gross profit); rep blocks and reps by account; Octagon
discipline (clean vs each broken pillar); lockouts (hit and ignored); wait state; time of day; weekday; regime; bias / KE;
contract; side; setup; exit reason; account. Everything net of charges. Sharpe and the like mean little before a few weeks.

**The weekly Review** (Journal › Review): Monday to Sunday by close time (IST), one account or all.
- The week against last week, the Octagon scorecard and the biggest leak, day by day (a day opens its trades).
- The outcome × process grid: **earned win** (held, paid), **lucky win** (a pillar broke, it paid: the dangerous one),
  **good loss** (held, didn't work: nothing to fix), **earned loss** (broke and lost: fix these).
- **Walk through** a group one trade at a time: its pictures beside the facts, pillars and plan, and three boxes (what I did
  right, what I did wrong, lesson). ← / → move on and save.
- The reflection: what went well, what broke the octagon and why, one focus for next week. Next week the Today card shows
  that focus, and the review asks whether you held it. **Save review** keeps it on the server and, with the Telegram backup
  on, posts a summary to the journal's chat (saving again updates the same message). **Copy summary**.
- **Calendar:** net per day, practice ticks, each week's net and whether it's reviewed.

**Copy for Gemini** (top of the Journal, on each trade, and in the review): the trades of today / yesterday / this week /
last week / a review's week / one trade, as text for your Gemini notebook: each session's equity and lockouts, then every
trade with all 8 pillars and why each held or broke, your plan and reflections; optionally starting with your Octagon rules.

**Settings › Export and backup:** **Download CSV** (every trade with its pillars, for a spreadsheet); **Download backup**
(a zip with the whole journal and all its pictures); **Restore from a backup** adds whatever the journal doesn't have and
never changes or removes anything already there.

## On a phone

Phones get their own layout, like MT5's app (a desktop browser never does). **More → Desktop layout** switches to the desktop page on that phone; **Settings → Layout** switches back (Automatic / Phone / Desktop).

- **Tabs at the bottom:** Quotes (watchlist, Find, Options) · Chart · Trade · History · More. A number on Trade counts your open trades and orders.
- **Top bar:** the account and its equity (tap to switch account), the contract and its price (tap for Quotes), and a dot for the price feed (green live, amber polling). A Fyers login reminder shows under it when needed.
- **Chart tab:** the chart takes the whole screen. At the bottom: **SELL** (the bid) · your default size · **BUY** (the ask). Tap the middle to change the default size (Risk %, Risk ₹ or Lots) and product. Open positions show as chips above the bar with their net P&L; tap one to manage it.
- **Placing a trade:** tap SELL or BUY. The order sheet slides up and the long / short tool appears on the chart. Choose Market, Limit or Stop; set the stop loss and target with − / + (one tick each, hold to repeat) or type them; the box after the target is R. Pick the size and product. The preview shows the lots, net ₹ at the stop and the target, BE + costs, charges in and out and the margin; if the order can't go (a rule, the margin, the intraday cut-off) the reason is right above PLACE. ✕ cancels.
- **The bubble:** to see the whole chart while you set the trade up, touch the chart (or tap ⌄ in the sheet's header, tap the grip, or swipe the header down). The sheet shrinks to a bubble in the SELL / BUY bar's place, so nothing covers the chart. It shows the side, lots, order type and product, and the net ₹ at the stop and the target with R (whole rupees, after all charges), or why the order can't go. Drag the SL and TP lines and the bubble follows. **PLACE** in the bubble places the trade, **✕** cancels it, and tapping the bubble brings the full sheet back. To have SELL / BUY go straight to the bubble, tap the middle of the bar → **SELL / BUY opens: A bubble** (saved on the server).
- **A position** (tap its chip or its card on Trade): net P&L after all charges, R, LTP, BE + costs, charges paid. Move the SL and target with − / + and press **Save** (Undo puts them back). **BE-T** and **TRAIL** for that trade with their R, **BE now**, **Chart**, and **Close at market** (tap twice).
- **A pending order** (Trade tab): move its price, SL and target, Save; or Cancel order.
- **Trade tab:** the account figures, every position and order, BE all, Close all (tap twice), Cancel all, and the trailing defaults for new trades.
- **History tab:** Today, 7 days, 30 days or All, with net P&L, win rate, profit factor, average R and charges. Tap a trade for every charge. The full History page (equity curve, filters) is linked at the bottom.
- **More tab:** Journal; Account, rules and charges; switch account; trades table; order book; log; settings (Fyers app, security, users, reset); theme; desktop layout; log out.
- **Full screen:** ⛶ in the chart's toolbar, or turn the phone sideways on the Chart tab. Only the chart and the SELL / BUY bar stay. ✕ (or turning it back upright) returns.
- **Live account:** a red LIVE badge and **KILL** in the top bar, live warnings under it, LIVE on the PLACE button (and on the bubble's), and the stop at Fyers on each position.

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
  - side, lots, entry price, live net P&L and R;
  - **✕** to close at market;
  - **BE** to move the stop to break-even + costs now;
  - **BE-T** with its R box: trail to BE once the trade reaches that R;
  - **TRAIL** with its R box: trail the stop that many R behind the best price.

  When the stop or target is only a few ticks from the entry (a BE stop, say), the bar slides just off that line so its label stays readable; the **Entry** tag on the price scale marks the exact entry.

  These trailing settings belong to that trade. The panel's Trail row sets the defaults for new trades, and changing it there also changes every open trade.
- **Pending orders** have a bar with their type and lots, and **✕** to cancel.
- **Bid and ask** are solid lines, as in MT5: grey for bid, red for ask, with their prices on the scale. A dashed **Last** line marks the last traded price, which is where the live candle closes. Candles are built from trades, so in a thin contract the candle can sit away from bid / ask until the next trade. Stops, targets and fills always use bid / ask.
- **Chart settings (⚙):**
  - colour and style for every line: bid, ask, last, entry, SL, TP, BE, order and new-trade entry;
  - show or hide bid, ask and last;
  - candle colours, zone colours and strength, background and grid;
  - **Check candles against live prices** (on by default): the chart's candles are Fyers' history; the app compares them with Fyers' live figures for the same day - the day's open, high, low and volume, and after the close the last price. If a price differs by more than 0.5% (at least 10 ticks), or the volume by more than 5x, an amber note shows at the bottom of the chart: tap it to see candles vs Fyers live and **Load again**. Your trades aren't affected (fills, stops and P&L use the live prices), but indicators and Pine scripts read the candles, so treat them with care until it clears.
  - Charts always show the contract you opened, never Fyers' "continuous" series (which shows, on each date, whichever contract was the near month then, so around an expiry you'd see the expiring contract under the new one's name). The app asks Fyers for continuous data **off** on every request (v0.30.1: Fyers' API, like Fyers' own charts, gives the continuous series unless it's turned off; up to v0.30.0 the app didn't say, so GOLDPETAL NOV's 30 Oct showed the expiring OCT contract's last day: 319 lots, then 14,201). To compare with Fyers' own chart, turn off **Continuous Futures** there (Fyers Web: profile › Settings › Charts; it's on by default). If Fyers corrects a day later, the app picks the correction up within a week of that day.
  - **Hide no-trade candles** (on by default): Fyers' history can carry a closing price on empty candles where no one traded (seen on GOLDPETAL's 30 Oct: candles at 14,201 with no volume until 23:55; that day was the continuous series, fixed in v0.30.1, so the option is now a safeguard). No one traded at that price, so these candles are left off the chart, P&F, indicators and Pine scripts. Only candles with **no volume at a price away from the last trade** are hidden; quiet candles at the last price and indices (which have no volume) stay. Untick it to see Fyers' candles exactly as sent.

  They're saved with your preferences.

## Timeframes and full screen

- The bar above the chart shows your pinned timeframes. **▾** lists them all: 1m–45m, 1h–4h, 1D, 1W, 1M.
  - Type any other, such as `7m`, `90m`, `2h` or `3D`, and press Use.
  - Right-click one (or long-press on a phone) to pin or unpin it.
- Timeframes Fyers doesn't serve directly are built from smaller candles, starting at the session open (09:00 for MCX).
- **Go to a date: the calendar button** at the chart's bottom left (or **Alt+G**, as on TradingView). Pick a date (and a time, on intraday charts; Indian time) and press Go to or Enter: older candles load first if the chart doesn't reach that far back, and the chart centres on that candle (or the one just before, if the market was shut), marked by the crosshair. A date before Fyers' first candle for the contract goes to the oldest one and says so. **Latest** in the same box, or **»** (bottom right, shown whenever the latest candle is off screen), brings you back to now, keeping your zoom.
- Daily, weekly and monthly charts show dates only on the time axis.
- **⛶ or F** maximises the chart inside the browser window, so your tabs stay one click away. **Shift+F** gives real full screen. When maximised, **P** (or Panel) slides the trade panel in, its **✕** hides it, and **Esc** goes back to the normal view.

## Several charts (the Grid button, next to ▦)

A layout can hold several charts: **1**, **2 side by side**, **2 stacked**, **3** (one big on the left, two on the right) or **2×2**.
- **Each chart is fully its own:** contract, timeframe, chart type, indicators and Pine scripts, and its own bar (timeframes, chart type, ƒx, ⚙, ✎ for its drawing toolbar, ⛶). It shows its contract's drawings, the BUY / SELL buttons and your positions' lines. Everything is saved in the layout, chart by chart.
- **The active chart** has a blue border and its number highlighted at the bottom right; click a chart to make it active. The watchlist, Find, the option chain, the trade panel's BUY / SELL and the Pine Editor's **Add to chart** all work on it, and the trade panel shows its contract. With a grid, the trade is set up on the chart itself: drag its lines and press PLACE there.
- **Sync** (Grid menu, saved with the layout):
  - **Contract:** a contract opened from the watchlist / Find opens on every chart; each keeps its own timeframe and chart type.
  - **Timeframe:** a timeframe picked on any chart goes to all of them.
  - **Date range:** scroll or zoom one chart and the others show the same stretch of time. It's matched by time, so a 5m chart and a 1h chart line up. A chart only shows the history it has loaded: scroll that chart back itself to load older candles.
  - **Crosshair** (on by default): moving over one chart moves the crosshair on the others to the same time. On a chart of the same contract it shows the price too.
  - Ticking contract, timeframe or date range lines every chart up with the active one at once. On the phone, contract and timeframe sync apply to all the layout's charts.
- A drawing made on one chart shows on every chart of that contract.
- **⛶ (or F) in a chart** shows it big; press it again to go back to the grid.
- A new chart starts as a copy of the active one. A smaller grid keeps the charts it doesn't show, so widening it again brings them back. Back to **1 chart** shows chart 1.
- **On the phone** one chart shows at a time: the numbers above the chart pick which, and changes save into that chart.
- Each chart loads its own history, out of the same Fyers data budget (queued). Opening a 2×2 the first time takes a moment; after that the browser's saved candles make it quick.

## Layouts (▦ on the chart's top bar)

A layout is a named chart set-up: the contract, timeframe, chart type (with its Renko / range / P&F sizes), indicators and Pine scripts with all their settings and pane heights, the chart settings (colours, lines, Volume, timer...), the drawing toolbar on / off and the indicator read-outs collapsed or not. Your chart as it was before layouts existed is **Layout 1**.
- **▦** shows the open layout's name (on a narrow chart just ▦; the name is in its tooltip). Its menu lists your layouts with what each holds; click one to open it exactly as saved.
- **＋ New layout:** a blank chart (candles, no indicators) on the same contract; type its name. **⧉ Copy this one:** a new layout from the chart as it is now. ✎ renames (names are unique), ✕ deletes (click twice; the last layout stays).
- **Saving:** the open layout saves itself as you change the chart, like TradingView. Untick **Save changes automatically** to save by hand: ● on the button means changes not saved, **Save** (or **Ctrl+S**) keeps them, and leaving the layout asks Save / Don't save / Cancel. Don't save: the layout opens next time as it was last saved.
- **Drawings belong to the contract, not the layout**: every layout on GOLDPETAL shows GOLDPETAL's drawings.
- Saved on the server: every device has the same layouts and opens the same one. The saved layout is what counts. If you switched layouts on another device, this one opens that layout as saved the next time it loads.

## Drawing tools (the toolbar left of the chart)

**Show or hide the toolbar:** the **✎** button on the chart's top bar, the **D** key, or Chart settings › Drawing toolbar. The choice is saved on the server. Hiding the toolbar never hides your drawings; that's the 👁 button on the toolbar ("Hide all drawings"). On a phone, ✎ opens the tools as a strip above the chart (it starts closed).

**The tools** (each group button shows the tool you used last; **›** lists the whole group):
- **Lines:** trend line (Alt+T), trend angle, ray, extended line, horizontal line (Alt+H), horizontal ray (Alt+J), vertical line (Alt+V), cross line (Alt+C), parallel channel, regression trend (±2σ, settable), pitchfork, Schiff and modified Schiff pitchforks.
- **Fibonacci and Gann:** Fib retracement (Alt+F; 1 at the first point, 0 at the second, as on TradingView), trend-based Fib extension, Fib fan, Fib time zones, Gann fan, Gann box. Levels, their colours and the fills are editable in each drawing's settings.
- **Shapes:** rectangle (Alt+Shift+R), ellipse, triangle, path (click points, double-click or Enter to finish), brush.
- **Text and arrows:** text, note, callout, price label, arrow, arrow marks up / down.
- **Positions and ranges:** long and short position (see below), price range, date range, date & price range.

**Angles:** **∠** on a selected line's bar (or **Show angle** in its settings) on a trend line, ray, extended line, arrow, parallel channel or regression trend, and the **Trend angle** tool (Lines), which always shows it. An arc from the horizontal at the first point, with e.g. "29.2° · +0.73 / bar":
- the **degrees** are the angle as you see it on screen, like TradingView, so they change when you zoom or stretch the price scale;
- the **slope** (points per bar; per column on P&F, per brick on Renko) doesn't change with zoom, so it's the figure to compare lines with;
- on **P&F** the angle is measured in boxes and columns (the P&F convention): a line rising 1 box per column is 45°, at any zoom.

**Drawing:** pick a tool, then drag on the chart, or click, move, click (three clicks for channels, pitchforks, the Fib extension and the triangle). Points sit on bars and on the tick. The tool goes back to the cursor after each drawing unless **Stay in drawing mode** (pencil with a lock) is on. **Esc** cancels.

**Magnet** (the horseshoe; › for the mode): *weak* snaps to the bar's open / high / low / close when you're close to one, *strong* always snaps to the nearest. Holding **Ctrl** while you draw flips it on or off.

**Editing:** click a drawing to select it. Drag its handles to reshape it, or drag the line to move it (**Ctrl+drag** moves a copy). The bar at the top of the chart sets colour, fill, width, style and text, and has settings ⚙, lock, clone and delete. A colour or style you pick becomes that tool's default for new drawings. **Double-click** opens the settings (text tools: the text). **Right-click** gives settings, clone, copy, lock, hide, bring to front / send to back and remove. **Del** removes, **Ctrl+Z / Ctrl+Y** undo and redo, **Ctrl+C / Ctrl+V** copy a drawing, also to another contract. A locked drawing can be selected but not moved (dragging scrolls the chart). The trade manager's SL / TP / entry lines always win over a drawing lying on them.

**Settings and exact coordinates:** double-click a drawing (or ⚙ on its bar, or right-click › Settings / Coordinates). Tabs: **Style**, **Text** (text tools), **Levels** (Fibonacci and Gann), **Coordinates**. Coordinates lists every point with its **price** (on the tick) and its **date and time** (Indian time), all editable; under each time it says which bar that lands on in this chart ("on the bar of 31 Oct 26 23:10", or "(5m bar holding it)" for a time inside a bar). A horizontal line has only a price, a vertical line only a time; a long / short drawing has entry, target, stop and its right edge. A wrong value is refused with a message and nothing changes; Ctrl+Z undoes a change.

**The toolbar's other buttons:** lock all, hide all, the drawings list (every drawing on this contract, with show / hide, lock and remove; a click selects it and brings it into view), and 🗑 remove all (click twice; Ctrl+Z brings them back).

**Saved per contract on the server:** every device, every timeframe and every chart type shows the same drawings. A point belongs to the bar its time falls in: a line drawn on 5m starts on the 15m or daily bar holding that 5m bar, and on Renko / P&F on the brick or column formed then. Drawings on GOLDPETAL NOV don't appear on GOLDPETAL DEC (copy them across with Ctrl+C / Ctrl+V).

## Measure (ruler)

**Shift+click** or **Shift+drag** on the chart (as on TradingView), a **middle-button drag** (as MT5's crosshair), or the ruler button then click, move, click. The box is green for a rise and red for a fall, with the figures beside the cursor:
- the change in points and %, and in ticks (in **boxes** on P&F, **bricks** on Renko);
- bars (columns on P&F), the time between the two points, and the volume of the bars in between;
- **the net ₹ for your lots**: what that many lots would make bought at the start and sold at the end (sold first and bought back if it fell), after every charge on both sides. It comes from the server, using the same charges code as your trades. Lots: Chart settings › Lots for the measure (default 1). For stocks a "lot" is 1 share. The product (Intraday / Delivery) is your ticket's.
- **R for your trade:** with an open position on this contract whose stop is on its own price (or the BUY / SELL tool set up), how many R a move this size is worth to it: the net ₹ of such a move ÷ the net loss at its current stop. With the stop at or past break-even there's no risk left, so no R.

A click clears the measure; Esc too.

## Long / short position drawings (looking back)

Separate from the trade manager: no orders, just a drawing. Click on a bar: the entry is there, the stop 1.5 ATR away, the target 2R away and the box 20 bars wide. Drag the handles on the left to move the entry, target and stop (the stop never goes past the entry), and the right-hand one to change how far it checks. Set lots on its bar or in its settings (the measure's lots are the default).
- Target and stop, in points, %, and **net ₹** for those lots; R:R net of charges.
- **The outcome**, checked on this timeframe's **real candles** (never Heikin-Ashi or P&F values) from the candle after the entry to the box's right edge: the first candle that reaches the stop or the target closes it, at that price, or at the candle's open if it opened past it. It shows when, after how many bars, and the net ₹ and R. A candle that reaches both can't show which came first: it's marked, and counted as the stop. With neither hit, it shows the result at the last candle.

## Chart types

The button after the timeframes (it shows the current type, e.g. **Candles**, **Renko 11**) picks how the chart draws the candles. Your choice is saved on the server, so every device opens the same way.

| Type | What it shows |
| --- | --- |
| Candles, Hollow candles, Bars (OHLC), Line, Area | The real candles, drawn differently. Hollow: a candle that closed up is hollow, coloured by its close against the previous close. Line / area colour: Chart settings (⚙). |
| Heikin-Ashi | Smoothed candles at the same times: close = (open + high + low + close) / 4, open = the middle of the previous Heikin-Ashi candle. |
| Renko | Bricks of one size. A new brick when price moves a box past the last one; a reversal needs two boxes. Box: ATR (default 14, worked out from the candles loaded, then fixed until you reload) or fixed points, saved per underlying (one for CRUDEOIL, another for NIFTY). Built from the closes, or from each candle's high and low; wicks optional. |
| Range bars | Each bar spans the same range (high − low); a new bar starts when price goes beyond it. Range: ATR or fixed points. |
| Line break | A new line when the close passes the highs (or lows) of the last 3 lines (settable). |
| Point & Figure | Columns of X (rising) and O (falling), one mark per box. A new column needs a reversal of 3 boxes (settable) from the column's extreme and starts one box back from it. Box: ATR or fixed points, **per underlying and timeframe** (5 for GOLDPETAL on 2m doesn't follow you to 1D); built from the closes, or from highs and lows. The button shows box × reversal, e.g. **P&F 11 × 3**. Zoomed out, the X's and O's get flatter to fit; zoomed far out, X columns are solid bars and O columns hollow ones. |

- **Renko, range bars, line break and Point & Figure** are built from the timeframe's candles: pick **1m** for the finest bricks. They don't follow the clock, so the candle timer is off and the time axis shows when each brick formed.
- **Point & Figure opens readable:** columns get wider (12 to 40 px) until the X's and O's are as big as they can be (up to 14 px) for the price range on screen, with little empty space on the right. Zoom as usual from there.
- **P&F box per timeframe.** A fixed box you type is saved for that timeframe. A box saved before v0.20.2 (one per contract) still applies, except on a timeframe where it's too small to draw: when a typical bar would span more than 8 boxes (a 5-point box on a GOLDPETAL day), that timeframe uses the ATR box until you set one there, and the chart type menu says so. (Before, a 1D P&F chart with a 5-point box drew its columns as thin lines: 100+ boxes a column can't show as X's and O's.)
- **Every indicator works on every type, Point & Figure included.** Volume, the built-in indicators and every Pine script (plots, fills, shapes, drawings, tables, request.security, arrays...) run on the bars the chart shows, as on TradingView: on Heikin-Ashi an RSI uses the Heikin-Ashi closes; on Renko there's one value per brick; on Point & Figure one per column. They line up bar for bar, on the candles and in their own panes, and follow live prices. A test of many Pine features on every chart type runs before every release, so this keeps holding for scripts you write later.
- **On Point & Figure, Pine's `close` is the column's middle** by default (the usual convention for indicators on P&F, from du Plessis); choose **Last box** under *Indicators read* in the chart type menu. `open`, `high` and `low` are the column's own; a column closes when the next one starts.
- **Prices stay real.** Bid, ask, last, your entry / SL / TP lines and every ₹ figure use real prices, whatever the chart type. (A Heikin-Ashi close isn't a price you can trade at.)
- The long / short tool and the position bars work on every type.

## P&F toolkit (ƒx → Built in → P&F toolkit)

Drawn on Point & Figure charts (on other chart types its read-out says so and it draws nothing). Each part can be turned off in its settings (⚙).

- **45° trend lines.** A bullish support line starts one box below a column's low and rises one box per column; it's broken when an O column reaches it. A bearish resistance line starts one box above a column's high and falls one box per column; it's broken when an X column reaches it. After each break the opposite line starts from the top (X column) or bottom (O column) of the move since the broken line began, choosing the one whose 45° line no later column has already crossed (v0.27.0: before, it always started at the highest top / lowest bottom, which price could already have gone through, so a line could run on through price, and a pair of lines could be re-made from the same column every column). The running line is solid; broken ones are faded, with **▲ break** / **▼ break** where they broke.
- **Signals** at the box that triggers them: **DTB** (Double Top Buy: an X column one box above the previous X column's top), **DBS** (Double Bottom Sell), **TTB / TBS** (triple top / bottom: the two previous tops, or bottoms, were equal). Filled = fresh (the first signal after one the other way), outlined = continuation. Zoomed far out, only fresh signals show.
- **Anchor columns:** columns of 15+ boxes (settable), shaded, with their high and low as dashed levels to the right (the latest 3, settable).
- **Vertical counts:** from finished columns of 5+ boxes (settable): target = boxes × box size × reversal, up from an X column's low or down from an O column's high. A count shows once a later column breaks the count column's high (low), and disappears when the target is reached: **VC ↑ 5,654** (the latest 2 per side, settable).
- **Horizontal counts:** at each breakout out of a congestion, the columns from the breakout back to the wall (the first column that had reached the breakout level), at least 5 wide (settable): target = width × box size × reversal, from the congestion's low (up) or high (down), the conservative count. Shown until reached: **HC ↑ 5,682**.
- **Patterns**, marked under the column (bullish) or over it (bearish), each family with its own switch:
  - **Bull trap:** a triple top buy only one box above the tops, then an O column giving a double bottom sell (bearish). **Bear trap:** the mirror (bullish).
  - **Catapult:** a triple top buy, a pullback that neither gives a sell signal nor breaks the pattern's low, then a double top buy (and the bearish mirror).
  - **High pole:** an X column 3+ boxes above the previous X top, then an O column retracing more than half of it (a bearish warning). **Low pole:** the mirror (bullish).
  - **Triangle:** lower tops and higher bottoms over 4 columns, then a double top buy (bottom sell). **Ascending / descending triangle:** equal tops with rising bottoms (equal bottoms with falling tops), then the breakout.
  - **Turtle:** a column beyond the highest high (lowest low) of the previous 20 columns (settable).
  - **AFT (anchor follow-through):** after an anchor column, the next column on its side goes beyond it; its stop (the pullback's extreme) is drawn as a short dashed line.
  - Rules from StockCharts / Dorsey; turtle and AFT from Definedge's published one-line descriptions (their full rules aren't public, so details may differ).
- **Labels never overlap:** they're placed by importance (breaks, fresh signals, traps / catapults / triangles, anchors / turtle / AFT, poles, continuation signals) and one that would cover another is left out. Zoom in to see more.
- The read-out shows which line price is on and the last signal.
- Not included: **mini tops / bottoms** and Definedge's own indicators and patterns (PMOX, XO Zone %, Noiseless RSI, Oops...): their rules are in Definedge's logged-in library and aren't published. Paste one in and it can be built exactly.

## Order-flow check (admin, Log page)

A real footprint (buy × sell volume at each price) needs every trade's price and size. Fyers' API documents no trade-by-trade feed, so the app measures what its normal price feed delivers:

- The server records every price snapshot for the contracts listed (by default the nearest CRUDEOIL and NIFTY futures; up to 6) while you're logged in to Fyers, with or without the page open. Files: `data/feedcheck/` on the server, one per day.
- **Exact volume** is the share of the volume that arrived one trade per snapshot (the day's volume grew by exactly the last trade's size), so each trade's price and size is known. **Price known** adds the last trade of each merged snapshot. **Merged** snapshots carried several trades, whose prices are lost. Shown per contract and per hour (IST).
- The footprint will be built only if this shows the trades arrive exactly. It stays a check: nothing here changes how the app trades.

## Candle timer

The time left in the current candle shows on the price scale, just under the bid / ask / last labels, and in the chart's top bar.
- The day's last candle counts down to the session close.
- On 1D, 1W and 1M it shows the time to today's close.
- Outside trading hours it says "market closed".

Turn it on or off in Chart settings (⚙).

## Volume and the order book

- **Volume under the candles:** the volume strip at the bottom of the candle pane, on/off in Chart settings (⚙).
- **Volume indicator:** in the Indicators menu (ƒx). It puts volume bars in their own pane, with an optional moving average. Drag the divider to resize the pane; the height is remembered. Its ⚙ has the MA length (Inputs), the rising / falling bar colours and the MA's colour, width and style (Style), and the timeframes it shows on (Visibility).
- **Book tab** (trade panel) shows the chart contract's order book:
  - the top 5 bid and ask levels, with quantity, number of orders and depth bars;
  - total buy vs sell quantity, with a ratio bar;
  - the day's open, high, low, previous close, average price, volume, last traded quantity and change.

  With BUY or SELL pressed, click a price in the book to put the entry there. The book streams only while the tab is open.

## Pine Script indicators

- **Pine** (above the chart) opens the Pine Editor under the chart. Drag its top edge to resize it.
- Write or paste a script. It's checked as you type: an error shows its line (click it to jump there) and the line turns red.
- **Save** (Ctrl+S) puts it in your library on the server; edit the name and Save to rename. **Save as** makes a copy. **Delete** removes it (and takes it off the chart).
- **Add to chart** (Ctrl+Enter). When the script is already on the chart, the button says **Update on chart**. Saving also updates the chart.
- **ƒx → My scripts** lists your library: **+ Add** puts a script on the chart, **{ }** opens it in the editor. You can add the same script twice with different inputs.
- On the chart, each script's read-out shows its values for the bar under the cursor. Point at a read-out for its buttons:
  - **👁** hides the indicator, or shows it again (a hidden script stops running);
  - **⚙** opens its settings (or double-click the name): see *Indicator settings* below;
  - **{ }** opens the code;
  - **✕** removes it.

  Errors show in red there.
- **Collapse:** the **▴** under the indicators on the candles folds them into "▸ N indicators". In a lower pane, **▾ / ▸** shows or hides that pane's values. Hidden and collapsed states are saved.
- **Tooltips:** point at a label that has a tooltip to read it.
- Scripts with their own pane can still draw on the candles (`force_overlay = true`), as on TradingView.
- `overlay=true` scripts draw on the candles; others get their own pane.
- **Supported:** plots (lines, step, circles, histogram, columns, area), hline, fill, bgcolor, barcolor, plotshape / plotchar / plotarrow, plotcandle, labels, lines, boxes, linefills, polylines, tables, inputs and request.security() for other timeframes.
- Times are Indian time.
- **Bars of history** (⚙ › Inputs, per indicator): **Auto** (the default) starts on the latest 1,500 bars; when you scroll back past where the script's line starts, it calculates again (once you stop scrolling) over everything the chart has loaded, the same way the chart loads older candles. Or pick a fixed number, 500 to 50,000, and it always uses that many of the latest bars. Each new bar re-runs the script in full in the background so its values and drawings stay exact; on a very long history (a run over 1.5 s) that happens at most every 5 x its run time.
- **Libraries (`import`).** `import TradingView/ta/<version> as ta` works out of the box: the app has its own implementation of that library's functions (Chandelier Exit, Supertrend, Volatility Stop, DEMA / TEMA / T3 / KAMA / FRAMA, Aroon, Stoch RSI, Ichimoku, KVO, Vortex, TRIX, PPO, PMO, Ulcer Index, volume delta and more), written from the standard formulas, not TradingView's code (`ht()` and `wpo()` aren't included). For any other library, open it on TradingView, copy its source (it starts with `library("Name")`), paste it into a new script in the Pine Editor and **Save**: `import anyone/Name/<version>` then finds it. If you save a library under the import's full name (for example *TradingView/ta*), that copy is used first, before the app's own. A library isn't drawn on the chart (ƒx marks it *library*, with no + Add). A script that imports a library you don't have says so, and what to do.
- **Live updates** work like TradingView's. The full history runs once, then each price re-runs only the live bar. A new candle triggers one full re-run in the background, so drawings stay exact.
- **Update** (⚙): *with every price* (the default) or *on candle close*. On candle close means one run per candle, which suits heavy scripts on long histories. The settings box shows the full-run and live-update times.
- A script stuck in an endless loop is stopped with an error; the page keeps working.
- Scripts run on PineTS, which covers most of Pine v5 / v6 but not every function. If one of your scripts errors, or draws differently from TradingView, send it over.

## Indicator settings (⚙ on the read-out, or double-click its name)

Like TradingView's, for every indicator on the chart (your Pine scripts, Volume, the P&F toolkit). Changes show at once and are saved on the server with the chart's indicators; **Cancel** puts back what was there when you opened it, **Defaults** resets the tab you're on.
- **Inputs:** the script's inputs, grouped as the script groups them (inputs written with the same `inline` share a row). Plus the app's own *Bars of history* and *Update*.
  - **Calculation › Timeframe** and **Wait for timeframe closes**, for every Pine script (TradingView offers them only on scripts whose `indicator()` has `timeframe =`; here any script has them). Pick a higher timeframe, for example 15 minutes for a moving average on a 2-minute chart, and the script calculates on those candles. The list has the usual timeframes and your own (pinned / custom); ones lower than the chart's are greyed out. With *Wait for timeframe closes* on, each value appears on the chart bar where its higher-timeframe bar closes (no repainting); off, it fills every bar until the next close. The live higher-timeframe bar shows on the latest bar. A timeframe lower than the chart's is refused. The read-out shows the timeframe in use.
- **Style:** each plot with its colours (a plot coloured by a condition lists each colour it uses; change any of them, with opacity), on / off, plot type (line, line with breaks, step line, histogram, columns, area, circles, cross), width and line style, and a price line at its latest value. The script's levels (`hline`: on / off, colour, width, style), fills, backgrounds, shapes and bar colours (on / off, colours). Then **Precision**, **Labels on the price scale**, **Values in the status line** and **Inputs in the status line**. Lines, labels and boxes a script draws take their colours and widths from its own inputs (Inputs tab), as on TradingView.
- **Visibility:** which timeframes it shows on: minutes, hours, days, weeks and months, each on / off with a range (for example minutes 1 to 15 only). On other timeframes the read-out says *hidden on this timeframe* and a Pine script doesn't run.

## Chart history: scroll back for older candles

- A chart opens with recent candles (about 1,000 bars, more if a Pine script asks for more). **Scroll or zoom out to the left edge and older candles load**, a step at a time, as on TradingView; the chart stays on the candles you were looking at. A pill at the bottom left says what's happening.
- It goes back as far as Fyers has candles for that contract. A futures contract starts on its listing day: when there's nothing older, the pill says *No older candles at Fyers for this contract* and it stops asking.
- Only your own scrolling loads more (not the chart fitting itself), and one step at a time, so it stays well inside Fyers' data limits.
- The older candles you load stay on that chart (same contract and timeframe) until you reload the page.
- **Other timeframes for Pine** (`request.security`, an indicator's own timeframe): the app waits up to 90 seconds for those candles (a Fyers request can queue behind others). If they don't arrive, the read-out says so in amber (or, if the script couldn't calculate without them, its error says why) and it tries again in 30 seconds, up to 3 times. Before 1 Nov 2026, Fyers' "no data" answer for the days before a contract was listed made the whole daily request fail, which is why Pivot Points said *Not enough data available*.

## Saved candles

Candles are saved on the server and in your browser.
- A chart opens at once from your browser's copy, and only newer candles come from the server.
- The server asks Fyers only for what's new, at most every 45 seconds per chart.
- Older days are fetched once, the first time a chart or indicator needs them. So history keeps growing past what one Fyers request returns.
- If you're logged out of Fyers, the saved chart still shows.

## Saved on the server

Everything here is per user. Your Pine scripts and libraries, the indicators on your chart (with their inputs, style, timeframe and visibility), your watchlists, your chart layouts, your drawings (per contract) and drawing settings, pinned timeframes, last chart, theme, panel on/off, ticket defaults (risk mode and amount, product, R) and remembered stop distances are saved on the server. Rules and trailing settings are saved per paper account. Any device, after any login, opens the same set-up.

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

**Stocks:** intraday pays STT 0.025% on the sell and stamp 0.003% on the buy, with brokerage ₹20 or 0.03% (lower). Delivery (CNC) pays STT 0.1% on both buy and sell, stamp 0.015% on the buy, brokerage ₹20 or 0.3% (lower), and a DP charge of ₹12.5 + GST on the sell. Exchange charges are NSE 0.0030699% and BSE 0.00375%.

NSE and BSE F&O, BSE Sensex / Bankex options, and currency futures and options all have their own rates.

**When a rate changes:**
- Account → Charges used → **Edit rates** lets you change any rate (and GST). Every figure uses the new rate at once.
- The server reads Fyers' charges page about once a day. If it changes, a **Charges changed: review** pill appears in the top bar, and the Account page shows the old and new lines.
- The app never switches a rate by itself. You edit the rate if needed, then click **Mark as reviewed**. These rates come from Fyers' charges list (27 Oct 2026), with the exchange rates cross-checked against the NSE and BSE schedules. **Account → Charges used** shows every table the app is using.

- **Value** = price × quantity × multiplier. For example, CRUDEOILM is 10 barrels a lot, CRUDEOIL 100, and GOLDPETAL 1 gram.
- **Lot sizing** finds the most lots whose loss at the stop, including both orders' charges, fits your risk.
- **BE + costs** works like LiveTrader's: the exit price where closing nets ₹0 or more after the entry charges already paid and the charges the exit would pay, rounded to the profitable tick, plus the **BE buffer** in Rules (default 0 ticks). A stop at BE is labelled, for example, "BE · exit here nets +₹0 · 13 ticks below entry pay the ₹51.60 charges". The ₹ after "nets" is what you keep if the stop is hit. The ₹ at the end is the charges those ticks pay for, not profit. To lock in profit at BE, set a BE buffer in ticks.
- **R** = net P&L ÷ the net risk at the first stop.

## Fills

| Order | Fills |
| --- | --- |
| Market | Buy at the ask, sell at the bid |
| Limit | When the ask (buy) or bid (sell) reaches your price, at your price or better. Also when a trade goes **through** your price (a buy limit: a trade below it), at your price |
| Stop entry | When the last price crosses it, then at the ask / bid (market) |
| Stop loss | When the bid (long) or ask (short) reaches it, as at MT5, then at that bid / ask, so a jump through the stop fills worse (slippage). A stop on an underlying future triggers on the future's last price |
| Target | When the bid (long) or ask (short) reaches it: at the target, or better if price gapped through. Also when a trade goes **through** it, at the target |

**Trade-through.** Targets and limit orders are resting limit orders on a real exchange. A trade beyond your price means your order, being a better price, would have been filled first. So it fills at your price, even if the bid / ask we saw never touched it. A trade exactly *at* your price doesn't fill it, as orders may be ahead of you. Fyers' live feed sends snapshots, so a one-trade spike can fall between two of them. When the day's low (or high) moves past your price between snapshots, that counts as a trade there. A spike inside the day's range that never reaches us live can't be seen.

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
- intraday square-off (on / off, minutes before Fyers', and Fyers' own times per market), the expiry-day exit times, and the stale-price limit.

An order is refused if, with every stop on the account hit, equity would fall below a floor plus the buffer. Widening a stop goes through the same check. Tightening, BE and trailing are never blocked.

**Margin** comes from Fyers' own margin calculator, cached for 10 minutes per contract. An option buy needs its premium. If Fyers doesn't return a figure, the ticket says "not checked".

## Trailing

- **Trail BE ON at X R:** once a trade has been X R in profit, its stop moves to BE + costs, once.
- **Trail SL ON at X R:** after X R, the stop follows the best price X R behind. It never goes below BE + costs and never moves backwards.

Moving a stop yourself makes it your stop again: it drops out of Trail SL until you toggle trailing.

1R is the distance from the **first** entry to the **first** stop, in points, as in LiveTrader. Adds don't change it.

When BE-T has already moved the stop to break-even, a Trail SL of N R behind the best price may still be further away than that BE stop. Trailing never moves a stop backwards, so the stop stays at BE until price makes a new best far enough to beat it. The position's bar shows that price as **"moves past …"**, and then **"next …"** once the trail is running.

## Records

- **History:** every closed trade, with the exit reason (tp, sl, be, trail sl, manual, square-off, expiry; live also kill, and "closed at Fyers" for a position closed outside the app). Tap a trade for its full charge breakdown, first stop, risk, and best / worst price.
- **Download CSV:** one row per trade, with every charge in its own column.
- Trades are stored on the server in `/home/helper/data/u/<user>/a/<account>/paper_trades.json`. **Reset** archives them and starts that account again.

## Not yet

- Footprint / delta (order flow): waiting for the order-flow check (Monday 2 Nov).
- Comparing the charges the app counts with what Fyers actually deducted (live).
- Prop-firm journals in the same journal (waiting for the owner's yes).
- Partial closes.
- Agri MCX contracts use the non-agri rates.
