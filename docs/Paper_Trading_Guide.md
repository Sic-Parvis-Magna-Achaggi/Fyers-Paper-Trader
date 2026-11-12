# Paper and live trading: how it works (v0.43.3)

Paper trades run **on the server**. Stops, targets, trailing, intraday square-off and the expiry-day exit keep working with the page closed, as long as you've logged in to Fyers that day, so prices are flowing.

## Logging in, users and security

- **Login** is your username and password, then a 6-digit code from your authenticator app (Google Authenticator, Microsoft Authenticator, Authy or similar). Lost your phone? Type one of your recovery codes instead of the app code; each works once.
- **First login** (and the first login after this update, as user **admin** with your old page password): you scan a QR code into the app, type the code it shows, and save the 10 recovery codes shown once.
- **Settings** (**⚙** at the top right; phone: More › Settings) is a page of its own: its sections are listed on the left (on the phone, chips along the top); click one to jump there. **← Back**, **Esc** or a page in the top bar returns.
- **The version** shows under "Trade Manager" at the top left (point at it for the commit and how long the server has been up), at the top of Settings, and at the top of the phone's More tab.
- **Settings → Security:** change your name or password, get new recovery codes, move 2FA to a new phone, see every device you're logged in on (log any out, or everywhere else), and recent activity.
- **A fresh code is asked again** (valid 5 minutes) for sensitive actions: adding or changing users, new recovery codes, moving 2FA, editing charge rates, switching a page to Live, Resume after the kill switch.
- **Lockout:** 5 wrong passwords or codes lock that user for 15 minutes. Sessions end after 48 hours without use and after 7 days at most.
- **Users (admin only, Settings → Users):** add a user with a temporary password. They choose their own password and set up 2FA at first login, then enter their own Fyers app in their Settings for prices. You can disable / enable a user, reset their 2FA (lost phone) or give them a new temporary password. Other users are paper-only; live trading is the admin's only.
- **Watchlists:** several named lists. At the top of the Watchlist tab (phone: Quotes › Watchlist) pick a list; **＋** makes a new one; **⋯** renames, moves up / down or deletes it (tap Delete twice; the last list can't be deleted). Up to 10 lists of 30 contracts. **+** in Find adds to the list on screen. **Changing a contract's lists:** ⋯ on its row (or right-click the row; on a phone, swipe the row left for **Lists · Remove**) opens a picker with every list: a tick shows each list it's in, and tapping a list adds it there or takes it out (so it can sit in several lists); **Move** puts it in that list and takes it out of this one in one tap; **Remove from …** takes it off the list on screen. On a phone a tap on a swiped-open row just closes it. Only the list on screen streams prices (with your chart and your trades). Saved on the server, so every device has the same lists.
- **Everything is per user:** Fyers app and login, watchlists, chart set-up, Pine scripts, paper accounts. Charge rates are shared; only the admin edits them.
- **Lost phone and recovery codes (admin):** on the server console, in `/home/helper/app`, run `sudo -u helper /home/helper/venv/bin/python -m helper.users rescue admin`. It prints a temporary password; log in with it and set up 2FA again.

## Paper accounts

- **The switcher** at the top shows the account you're looking at and its balance. Pick another to switch; the whole app (chart lines, ticket, Trades, History, Account, Log) follows it. It lists your paper accounts; Live isn't one of them (below).
- **+ New account…** (in the switcher, or the Account page): a name, starting capital, and default rules or a copy of another account's rules and trailing.
- Each account has its own balance, rules, trailing defaults, positions, orders and history. All of them keep running on the server (stops, targets, trailing, square-off), whichever one you're looking at.
- **Rename, archive, restore** on the Account page. Archiving needs the account flat (no positions or orders) and keeps its trades. You always keep at least one account.
- **Reset** (Account page) starts the account you're looking at again; its old trades are archived on the server.

## Live trading (the admin only)

**Live is your Fyers account itself, not a paper account** (v0.33.0). Paper accounts are simulations with their own made-up capital and never touch Fyers; they have no Live option. There is one **Live account**: your Fyers account, named by its client ID (e.g. *XT0001*). It uses the same ticket, chart tool, rules, guards, BE, trailing and targets as paper, but every order is real, sent to Fyers on your own login from the server's own IP (the switch's dialog shows it; on the owner's server, **134.209.159.171**).

**Before the first live trade:** whitelist the server's own IP in your Fyers API app and give the app order permission. On the owner's server that's **134.209.159.171** (not 68.183.245.178); on another server, the IP the dialog and `sudo fyers-status` show. Then test with **1 lot on MCX**.

**The PAPER / LIVE switch** at the top left, next to "Trade Manager" (phone: the first button in the top bar). **PAPER is green, LIVE is red.** Only the admin sees it.

- **To Live:** tap LIVE, type your Fyers client ID (shown in the dialog) and a fresh 2FA code. You need today's Fyers login. The first time, this makes the Live account. The page then shows your Fyers account and every order you place is real.
- **Back to Paper:** one click. The account switcher lists your paper accounts again and BUY / SELL / PLACE are paper.
- **Each browser or phone switches for itself** (the switch belongs to that login). The server refuses any change to the Live account from a page on Paper (the kill switch always works).
- **The switch only decides where this page's new orders go.** The server keeps managing your live trades all the time, whichever side any page is on: stops, trailing, BE, targets, intraday square-off, the expiry exit, Telegram alerts.
- Both directions are in the security log.

**You'll see on Live:** the switch's red LIVE, a **KILL** button and a red line under the top bar, **LIVE** on the PLACE button, "● XT0001 · ₹balance" in the account switcher (locked), and under every position where its stop is at Fyers.

**Money: Fyers' own funds**

- **Balance, margin in use and free funds come from Fyers** (its funds, read every minute and a few seconds after every fill; *Read funds now* on the Account page). Balance = Fyers' balance at the start of its day + money moved in / out today + today's closed trades **net of every charge** (the app's figures, like the rest of the app; Fyers deducts its real charges overnight, so the next day's start corrects any difference). Equity adds the open trades' net P&L.
- **Both Fyers ledgers** (capital and commodity) count. Free margin for an MCX order is the commodity ledger's available balance (the capital ledger's if Fyers keeps one ledger for both); for NSE / BSE the capital ledger's.
- **The % rules** (daily loss, max loss, buffer, risk %, risk cap, margin use, open risk) count from these real figures. **The daily loss counts from today's start as Fyers reports it** (until today's funds are read after the daily login, the app's own estimate of last night's close). **No typed capital:** the account size for the % rules is your Fyers balance at the start of the day you first switched to Live (plus money moved in that day).
- **Money moved in or out is never a profit or a loss:** the account size, today's start and the highest balance move by the amount, so a deposit doesn't loosen your daily limit and a withdrawal doesn't trip it. (LiveTrader 1.18 keeps a prop account's size fixed on a payout; here it moves, so money taken out of your own account isn't counted as a loss.)
- Until Fyers' funds have been read once, new live orders wait ("reading your Fyers funds first"), so nothing is ever sized from a made-up balance.

**Trades placed straight in Fyers** (the Fyers app or web, another platform) are shown and managed like the app's own, from Fyers' order updates (and its order and position books as the fallback):

- **Opened, added to, part closed, closed** in Fyers: the position here follows, at Fyers' prices, each marked **From Fyers** (positions), **Placed in Fyers** (orders) and **Fyers** (History, CSV *placed_in*, the journal's CSV *Placed in*). A change seen only in Fyers' position book (its order update missed) is booked after two readings 3 s apart, with nothing of the app's in flight on that contract, at the price it implies (marked as an estimate).
- **Managed like the app's:** SL / TP lines, BE, BE-T, TRAIL, ✕, Close all, the kill switch, the guards, intraday square-off, the expiry exit, Telegram alerts, net ₹ / R after all charges, the journal.
- **A stop placed in Fyers is adopted** as that trade's stop: trailing and BE move that same order, keeping its own type (an SL-M you placed stays SL-M), so there's never a second exit order at Fyers. Its first stop sets 1R. If you cancel it in Fyers, the app puts its own stop back.
- **A pending order placed in Fyers** shows on the chart and in Orders: move it (its type kept; a stop-limit keeps its trigger-to-limit gap) or cancel it here. An SL / TP you give it here goes on the trade when it fills.
- **A trade placed in Fyers without a stop** is flagged red: **NO STOP AT FYERS**, on the position, the Trades page, a **NO STOP** button on its entry line, the phone's sheet and the warnings under the top bar. Tap **Place my stop** to put your default stop at Fyers: the stop distance remembered for that contract (the tool's last one), else the tool's default (0.3% of the price, at least 10 ticks), from the entry, or from the price if the entry's is already passed. Nothing is placed until you tap. BE, BE-T and TRAIL work once it has a stop (its first stop sets 1R).
- **Two exit orders in Fyers** (you placed a limit exit while the trade's stop is there): a warning, as both could fill and leave you holding the opposite position. Cancel one.
- **Delivery holdings** (shares in your demat from earlier days) are Live trades too, at their cost price: P&L after all charges (with the DP charge on the sell), SL / TP, BE, BE-T, TRAIL, ✕ to sell, the no-stop flag and Place my stop. **They're never squared off**, and **Close all and the kill switch keep them** (sell one with its own ✕). Selling shares through the API needs your Fyers account's authorisation for selling from the demat (CDSL DDPI, or the daily eDIS / TPIN); without it Fyers refuses the stop or sell and its reason shows on the holding. Holdings without a stop are one line under the top bar (no Telegram message each).
- **Fyers logged in as another client** than the Live account's: nothing new is placed, with a warning.

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

**Kill switch** (KILL in the top bar, or the Account page): cancels every order and closes every position at Fyers on your login, the app's trades **and any others**, then pauses new entries until you press **Resume** on the Account page (Resume asks for a fresh 2FA code). Stops keep working meanwhile; an entry that fills during it is closed too, and an order placed in Fyers during it is cancelled. Delivery holdings from earlier days are kept (with their stops). KILL asks once to confirm (no 2FA code, so it's quick).

**Account page (Live):** your Fyers account and its client ID; whether you're logged in to Fyers, whether order updates are connected (if not, the app reads the order book every 5 seconds); Fyers' funds (start of the day, money in / out today, today's trades net, balance, equity, margin in use, available, the account size for the % rules, each ledger); **Resync with Fyers** (re-reads Fyers and puts every stop where it should be), **Read funds now**, Resume and the kill switch. No reset (its trades are real), and the account size in the rules comes from Fyers.

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

## MT5 charts (your FundingPips terminal, through your own bridge EA)

- **What it is:** your MT5 terminal's prices and candles in this app, so P&F, Renko, your Pine scripts and every other
  chart type and indicator work on your broker's own prices. Your MT5 trades are on the **MT5 side** (next section); paper
  accounts don't trade MT5 symbols.
- **How it connects:** the **FTM Bridge** EA (`mt5/FTM_Bridge.mq5`, your own code; how it works: `mt5/README.md`) runs in
  MT5 on your laptop and calls out to the server about 4 times a second. Nothing connects in to your laptop and the server
  never logs in to your broker account. **It opens no new trades** (1.10 manages existing ones when you ask: next section). FundingPips: MT5 and the EA only on your own laptop at
  home, no VPS, no VPN (their support, 6 and 10 Nov 2026).
- **Set it up (Settings › MT5 bridge):** download the EA, put it in MT5's `MQL5\Experts` folder and compile it in MetaEditor
  (F7); make a **bridge key** (your 2FA code; it's shown once, so copy it into the EA's **BridgeKey** input then); in MT5,
  Tools › Options › Expert Advisors, tick **Allow WebRequest for listed URL** and add the app's address; drag the EA onto
  any chart. Its chart corner then says *connected* and the terminal shows up in Settings.
- **Settings › MT5 bridge** also shows each terminal that has called (login, server, DEMO, Hedge / Netting, balance, equity,
  connected or when last heard, the address it calls from) and which one gives the prices (tick another one to change).
  A new key stops the old one; **Remove the key** stops the EA connecting.
- **MT5 in the Prices pill** at the top, while the page shows an MT5 symbol: green while prices arrive, red when MT5 or
  the laptop is off (hover for which terminal, or why; click for the settings). On the phone, a line under the top bar
  says *MT5 isn't connected*. Saved candles still show then; a chart never opened before needs MT5 on.
- **Find:** type a name or description ("gold" finds XAUUSD); the **MT5** button shows only your broker's symbols. MT5 adds
  the symbols you open to its Market Watch (it only sends prices for symbols there).
- **Prices:** the price is the bid, as MT5 draws its candles; the ask line shows the spread. Volume is MT5's tick volume.
  No order book and no Fyers data check on MT5 charts.
- **The broker's day:** MT5 symbols trade round the clock on weekdays. Their day starts at the broker's midnight
  (FundingPips: 03:30 IST in winter, 02:30 IST in US summer time), so intraday candles count from there, as in MT5, and a
  daily candle is the broker's day (shown at 00:00 IST of its date). The candle timer counts to the broker's day end.
  **The broker's clock** (Settings): *moves with US summer time* (most brokers, FundingPips) or *never changes*; it only
  decides where candles from before a clock change go. 45-minute candles are built from MT5's 15-minute ones.
- **Measure and position drawings** show points on MT5 symbols (net $ comes with trading them).

## MT5 accounts (the MT5 side of the switch at the top left)

- **What it is:** each MT5 login whose terminal runs **FTM Bridge 1.10** is an account of its own here, kept apart from Fyers:
  **PAPER | LIVE | MT5** at the top left (MT5 in purple). Going to MT5 asks for a fresh 2FA code. On the MT5 side the account
  switcher lists only your MT5 accounts ("● 21182752 · $5,013"; the server, DEMO and the exact balance in its tip; ● connected, ○ not), and
  Fyers never appears there. The admin only. Back to PAPER is one click; each browser or phone switches for itself.
- **From MT5 itself:** its positions, pending orders, balance, equity, margin and history, straight from MT5 (about 4 times a
  second). Trades you place in MT5 show at once ("Placed in MT5"); ones already open when the app first saw the account say
  "Already open in MT5". The History page holds MT5's own closed trades (the last 90 days, the first time; marked MT5, with no R
  as their stop isn't known) and every trade closed since, booked from MT5's own closing deal.
- **Managing (moves the real trade at the broker):** drag the SL / TP lines, **BE**, **BE-T**, **TRAIL** and **✕** on the
  entry line's bar (or the panel, the Trades page, the phone's sheet). The app sends the change to the EA, which makes it in
  MT5; each trade's line on the panel says what MT5 has: "MT5 SL 2650.10 · TP 2680.00 ✓", "→ moving to …", "MT5 refused: …"
  (retried after a pause), "closing in MT5…". Trailing never moves a stop back or below BE + commission. Pending orders
  placed in MT5 can be moved (their SL / TP move with them) or cancelled here. No login to type: switching the page to MT5
  (a 2FA code) is the check (v0.37.1).
- **Pacing (FundingPips: no server spamming):** at most one change per trade every 2 seconds and 30 requests a minute per
  account; a newer stop replaces one still waiting.
- **If the app's stop is passed before MT5 has taken it** (MT5 refused the change, or it was on its way), the app closes the
  trade at market, as the Live design does. Otherwise MT5's own SL / TP close the trade, on the bid (long) / ask (short).
- **MT5 not connected:** nothing can be changed (the app says so at once). A close that couldn't reach MT5 within 20 s is
  dropped, never sent late. Open trades keep their real SL / TP at the broker.
- **Money: the account's currency ($), net.** Every figure (SL, TP, risk, P&L, R, BE) is net of the broker's commission and
  the trade's swap. **The commission per lot** (opening and closing deals separately), in order: learned from MT5's real
  deals on that symbol; before its first trade, the symbol's commission rules from MT5 (EA 1.22 reads its Specification
  window: FundingPips' XAUUSD "5 USD per lot" on opening deals); else as a symbol of the same group that has traded (Metals,
  Forex…); else your typed default (Account page; empty = not typed, 0 = none). **A symbol with none of these can't be
  placed** (v0.37.3: before, $0 was counted). A later deal that charged differently is flagged in the Log and used from then on. The spread is paid through the bid / ask, as in MT5. Closed trades are exactly MT5's: profit,
  commission, swap.
- **What a price move is worth** (v0.37.2): the ticket's preview says it, e.g. "1 lot: $100 per 1.00 move" on XAUUSD
  (100 oz), with the commission, and where they come from. In order: MT5's own profit on an open position of that symbol;
  MT5's own profit sum (EA 1.21), checked against contract size × the profit currency in $ (v0.37.3: for a symbol whose
  profit is in another currency, e.g. EURGBP in pounds, the broker's own GBPUSD price, as LiveTrader does; if the two
  disagree, the bigger one is used: smaller sizes); contract size × that rate alone. MT5's tick value alone isn't trusted
  (FundingPips' XAUUSD lists 0.01 for a 100 oz lot, so on 11 Nov the app showed −$3.78 at a stop that was −$217.94 in MT5):
  **a symbol with nothing else can't be placed**. The Account page lists the figure per symbol next to what MT5's tick
  value says; a mismatch is flagged in the Log.
- **FundingPips' limits** (under the account figures, on the Account page): the **daily floor** = the balance at the
  broker's midnight (worked out from MT5's deals since; FundingPips: 03:30 IST in winter, 02:30 in US summer) minus the daily
  % (5% on the 2-Step) of that balance - or of the starting size, if you choose; the **max floor** = the starting size you
  type minus the max % (10%, static; or trailing). An equity under a floor is shown in red. The phase (evaluation / Master) is
  kept for the news guard (later). FundingPips' dashboard stays the official figure.
- **The Account page** of an MT5 account: MT5's figures, the EA and whether the app can change trades, the limits and their
  form, the commission learned per symbol, trailing defaults, and **Read MT5's history again**.
- **The journal** (v0.39.0): every MT5 trade goes into the Journal like a paper or live one, in $ (see Journal below).
- **Not yet:** the prop-firm parts of the journal (phases, payouts: roadmap 8 c2 / 4b), copy trades between MT5 accounts (8 d).
- **The EA's switch:** its input **AllowTrading** = false makes it refuse every change (the app then only shows the account).
  MT5's **Algo Trading** button must be on too. An EA older than 1.10: the account shows, its trades don't. Placing orders
  needs 1.20.
- **Placing orders (EA 1.20):** on the MT5 side the ticket, the chart's BUY / SELL tool and **MT5 PLACE** work as on Fyers:
  market, limit or stop, sent to MT5 **with its real SL and TP**. Size by risk %, risk $ or lots (MT5's volume, 0.01 steps;
  within the symbol's minimum / maximum). Margin is MT5's own figure. The guards refuse with the reason: FundingPips' daily
  and max floors (if every stop were hit), the risk cap (lots cut to fit), max open risk, max margin, max trades, SL required.
  The order shows as "Sending to MT5…" until MT5 has it; then it's your trade with its planned stop as 1R. An order that
  can't reach MT5 within 10 s is dropped (never placed late); one is never sent twice.
- **No hedging (FundingPips):** an order opposite an open trade or pending order on the same symbol is refused, in this
  account and in your other MT5 accounts. The same side, or another symbol, is fine.
- **The day-end close** (v0.40.0; Account › rules, off at first): **X minutes before the symbol stops trading for the day**
  (v0.41.0, EA 1.23: from each symbol's trading sessions in MT5, its Specification window: gold that stops at 23:57 broker
  time closes at 23:52; Friday's early closes too; a symbol trading to the broker's midnight, or with an older EA, at the
  broker's midnight: FundingPips 03:30 IST in winter, 02:30 in US summer time, so 5 minutes = 03:25 / 02:25 IST; holidays
  only if the broker changes the sessions for them), **every day** or **only before
  the weekend** (the broker's Friday), for **all trades** or **only trades marked to close**. At that time those trades are
  closed at market in MT5 (reason "day end"), their pending orders cancelled, and new orders refused until the broker's new
  day. **Marking:** the ticket's **At the day end: Close it / Hold**, the chart tool's **DAY END / HOLD** next to PLACE (the
  choice stays the default; trades placed in MT5 itself take it too), and **⏱** on each trade or pending order (the panel,
  the Trades page; on the phone, its sheet) to change one. The panel's footer says when it runs. MT5 off at that time: a
  warning, and the trades are closed when it's back before the broker's midnight. It isn't stopped by the news guard
  (like KILL; a warning if inside the window). Each trade's **⏱** shows its own close time.
- **KILL (MT5 side, top bar; the Account page; the phone):** closes every position and cancels every order of that MT5 account
  at the broker and pauses new orders until **Resume** (a 2FA code).
- **The news guard (ForexFactory):** the server reads ForexFactory's calendar every hour. High-impact events on the symbol's
  currencies (XAUUSD: USD): **Master** phase - no opening or closing from the app 5 minutes either side (settable; MT5's own
  SL / TP still fire; KILL always works); **evaluation** - no block, a note on the ticket and a warning on open trades 15 minutes
  before (purposely trading news is prohibited). The Account page lists the next 24 hours' events. FundingPips' dashboard
  calendar is the official one.
- **If the EA can't reach the app** (your internet, the server) for 20 s, it goes on trailing your trades itself, by each
  trade's BE-T / TRAIL as set here (never looser, never below BE + costs). When the link is back, the app takes those moves
  as the trail and carries on. MT5's SL / TP protect the trades throughout.

## Pages

The top bar has **Chart · Trades · History · Journal · Book · Account · 🔔 Alerts · Log**. The chart keeps running while you're on another page, and the address remembers the page.

- **Trades:** all open positions and pending orders in tables. Click any price to change it; set Trail BE / Trail SL per trade; BE, close, cancel. BE all, Cancel all orders and Close all at the top.
- **History:** filters, stats (net, win rate, profit factor, average R, expectancy, drawdown, streaks...), an equity curve, daily P&L, results by contract and by exit, and each trade's charges. Download the filtered list as CSV.
- **Journal:** your trade journal, the Octagon (see below).
- **Book:** up to 4 order books side by side.
- **Account:** the account's figures, your paper accounts (new, rename, archive), rules, trailing defaults, reset and the charges in use.
- **🔔 Alerts:** your price and indicator alerts, what fired (Log), and phone / desktop notifications (see Alerts below).
- **Log:** everything the paper account did, the helper's own log, and **Security** (your logins, 2FA and password changes).

## Journal (the Octagon)

The Octagon trade journal, inside the app and saved on the server (per user, every device).

- **Trades arrive on their own.** Every paper, live and MT5 trade of every account: it appears when it opens and is completed
  when it closes (a live position closed in parts is one trade). Trades from before the journal (each account's history and the
  archives of resets and Paper ↔ Live switches) were taken in once, and count as claimed reps.
- **Money and R are net.** ₹ is after every charge, R = net ₹ ÷ the net risk at the first stop, exactly as History shows them.
  So a "2R win" for the 99 Club is 2R after charges, and the target in R (Pillar 8) is the net ₹ at your take-profit ÷ that
  risk. (Octagon worked R out from points before charges.)
- **A session** is one trading day of one account (IST; the day starts at the reset hour in that account's rules, 06:00 by
  default; MT5 accounts: see below). Times of day are Indian buckets (opening hour, morning, midday, afternoon, after NSE
  close, evening, night).
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

**MT5 accounts in the journal** (v0.39.0, roadmap 8 c1):
- **Every MT5 trade arrives on its own:** placed from the app or in MT5 itself (marked "placed in MT5"), and MT5's own history
  (the last 90 days) taken in once. One MT5 position is one journal trade, however many parts it closed in. Each has the MT5
  badge.
- **Money in $** (the account's currency), net of commission and swap; R = net $ ÷ the net risk at the first stop. A trade from
  MT5's history has no stop known, so no R.
- **₹ and $ are never added together.** The filters have a **Money** switch, **₹ Fyers | $ MT5** (only once you have MT5
  trades): the list, stats, balance curve, Insights, Review and Copy for Gemini show one currency at a time. On the MT5
  side the journal opens in $, otherwise in ₹. Reps and the pillars still count across all your accounts.
- **The session day, per MT5 account** (Journal › Settings › MT5 accounts): **the broker's day** (FundingPips' daily reset,
  03:30 IST in winter / 02:30 in US summer; the default) or **the Indian day** (IST, from 06:00 like your Fyers accounts).
- **The 2% line** of an MT5 account is 2% of **FundingPips' day-start balance**: the balance at the broker's midnight, worked
  out from MT5's own deals (with the Indian day: the day-start balance of the broker day the session starts in).
- **Lockouts on MT5 are a switch per account, off at first** (Journal › Settings › MT5 accounts › "Lockouts refuse new orders
  on this account"). Turning it on or off asks for a fresh 2FA code and is noted in the security log. Off: the 2% line, the
  99 Club break and session over still show on the Today card and in the audit, but new MT5 orders aren't refused. On: they
  are, each by its own switch below.
- **The Today card** of an MT5 account: $, its session day, and the room before the 2% line of the day-start balance.
- **▶ On chart of an MT5 trade** (v0.39.1): when the trade closes, the server asks MT5 for the candles around it and keeps
  them with the journal, for as long as the trade is there: 1-, 5- and 15-minute candles from a day before the entry to an
  hour after the exit, and the chart you placed it from (1,500 candles before the entry, for the indicators). So the
  replay works with MT5 off and long after MT5's own history (about 2-3 months of 1-minute candles) has moved on, and
  needs no Fyers login. Trades from MT5's history (the last 120 days) are fetched in the background. The trade's card
  says **Replay candles: kept on the server**, or that it's waiting for MT5 (nothing is fetched while MT5 is off). About
  50-100 KB a trade; in the journal's backup.

**Lockouts refuse new orders** (Journal › Settings, a switch each, all on at first; MT5 accounts only with their own switch on):
- **2% trailing drawdown** (Pillar 4): the day's closed trades (net) fall 2% of the account size below the session's peak →
  no new orders until the next trading day. Open P&L doesn't count (as in Octagon).
- **The 99 Club break** (Pillar 5): 3 wins in a row, or 3 wins of 2R or more → no new orders for 20 minutes.
- **Session over** (Pillar 5): a trade marked "my mind was running numbers", or Hold to end today's session → no new orders
  until the next trading day.
- **Cancel waiting entry orders when a lockout starts** (Live: at Fyers too).
While locked, the ticket's preview says why, PLACE is off, and a red pill in the top bar names the lockout (amber and short,
e.g. "2% · off", when it isn't blocking: its tip says why). Closing, BE, trailing and the stops of open trades are never blocked. The numbers (2%,
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
- **Live trades' channel** (optional, the admin, v0.33.1): fill it in and every picture of a **Live** trade goes there,
  while paper trades' pictures stay in the journal's chat. Leave it empty and everything goes to the journal's chat. Leave
  the journal's chat empty instead and only Live trades are copied. Each has its own **Send a test**. The weekly review's
  summary goes to the journal's chat (the Live channel if it's the only one). Captions start with LIVE or Paper and the
  account either way.
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

**Settings › Export and backup:** **Download CSV** (every trade with its pillars, for a spreadsheet; v0.39.0: a **Currency** column, INR or USD, and the money columns named Gross / Charges / Net without ₹); **Download backup**
(a zip with the whole journal and all its pictures); **Restore from a backup** adds whatever the journal doesn't have and
never changes or removes anything already there.

## Alerts (like TradingView's)

Alerts run **on the server**, so they fire with every page closed. Each user has their own, **as many as you like**;
there's no plan to buy.

**Setting one up:**
- **🔔+ on the price scale** (like TradingView's plus): hover over the price scale (on the phone, tap it) and 🔔+ appears at
  that price. Its menu: **Alert: price crossing <price>** creates it at once (crossing, only once, your usual
  notifications; drag its 🔔 line to move it), or **Alert at <price>…** opens the dialog.
- **Right-click** on the chart: the same two, at the price you clicked.
- **Drawings:** select a line, ray, channel or rectangle and press **🔔** on its bar (or its right-click menu → **🔔 Add
  alert…**). A drawing that has alerts shows a gold 🔔 with their number; click it to edit one or add another.
- 🔔 on the chart's top bar or **Alt+A** (the price crossing where it is now, ready to edit); the 🔔 on a script's row in
  **ƒx**; or **+ Create alert** on the Alerts page.

**What it can watch** (each condition picks one):
- **Price** (the last price, or the bid or the ask): checked on every tick, against the price before, so a crossing is the
  moment it happens. A trade through your level between two price updates (the day's new high or low) counts too, the
  same rule as paper fills. It starts from the price when you set it: a *Crossing up* set above the price waits for the
  price to come from below.
- **Candles:** open, high, low, close, (H+L)/2, (H+L+C)/3, (O+H+L+C)/4, volume, on the chart's type (Heikin-Ashi,
  Renko, P&F... when you tick *Work out on ... bars*).
- **Your Pine scripts on the chart:** any plot, any `alertcondition()` (its own message comes with it), or *any alert()
  call* (the script's own `alert.freq_*` decides how often). The alert keeps a copy of the code and inputs, as TradingView
  does: editing the script later doesn't change the alert. It runs in the same Pine engine as the chart, so the numbers
  match what you see.
- **Built-in indicators** without adding them to the chart: SMA, EMA, WMA, VWAP, RSI, MACD, Bollinger, Supertrend, ATR,
  Stochastic, CCI, ADX / DMI, MFI, OBV, Donchian, Volume average (their settings right in the dialog).
- **Drawings:** horizontal line / ray, trend line, ray, extended line, parallel channel (top / bottom / middle),
  rectangle (top / bottom, between its two ends). Move the drawing and the alert follows; delete it and the alert says so.
- **P&F signals** on a Point & Figure chart: buy (double / triple top) or sell (double / triple bottom).

**The 13 conditions:** Crossing, Crossing up, Crossing down, Greater than, Less than; Entering / Exiting / Inside /
Outside channel (an upper and a lower edge, each a number, a line or another value); Moving up / down by an amount, or by
a %, within a number of bars. Each compares with a **value** or **anything in the list above** (price crossing the
EMA 20, RSI crossing its signal line...). **Each condition has its own timeframe.**

**Several conditions:** **+ Add condition**, up to 5 on one symbol, with **All must be true** (TradingView's) or
**Any one**.

**Trigger:** *Only once* (then it shows Triggered; a watchlist alert fires once per symbol), *Once per bar* (of the first
condition's timeframe), *Once per bar close* (worked out when the bar closes: on the next bar's first price, or 2 s after
its time is up; a move that didn't hold to the close doesn't fire), *Once per minute*. **Expiry:** open-ended, or a date
and time.

**Symbol:** this chart, or **a watchlist**: one alert, each symbol on its own. Fyers' price socket carries 100 symbols on
the Standard plan, shared with your charts and open trades, so alerts use up to 60; any that don't fit are listed on the
Alerts page as *not watched*.

**Message:** leave it empty for the condition and the price, or write your own with TradingView's placeholders:
`{{ticker}} {{exchange}} {{close}} {{open}} {{high}} {{low}} {{volume}} {{bid}} {{ask}} {{interval}} {{time}}
{{timenow}} {{plot_0}} {{plot("Name")}}` (plus `{{timenow_ist}}`, `{{name}}`). Numbers come without thousands separators,
so a JSON message stays valid for a webhook.

**Where it reaches you** (ticked per alert):
- **A pop-up and a sound** on every open page of the app (chime, bell, beep, alarm, soft or none). A browser plays sound
  only after you've clicked the page once.
- **Phone and desktop notifications:** Alerts › Notifications › **Turn on for this device**, once per device. They arrive
  with the app closed and the phone locked.
  - Android (Chrome): ⋮ › *Add to Home screen* / *Install app*, open it from the home screen, More › Alerts ›
    Notifications › Turn on, allow.
  - iPhone / iPad (iOS 16.4 or later): Safari › Share › *Add to Home Screen*, open the app from the home screen (iPhone
    only allows notifications there), More › Alerts › Notifications › Turn on, allow.
  - Desktop Chrome / Edge / Firefox: Turn on; notifications come while the browser runs.
- **Telegram:** the bot in Settings › Telegram alerts (the admin).
- **Webhook:** like TradingView's, a POST of the message (JSON when it's JSON) to your address on port 80 or 443. Works
  with ntfy.sh, Pushover, Discord, Slack or a bot of your own. Private or local addresses are refused.

**On the chart:** a dotted 🔔 line at each price level of an active alert on that contract; **drag it** to move the
alert's level. **The Alerts page:** search, filter (active / triggered / paused / expired), ⏸ pause, ▶ resume or restart,
✎ edit (saving a triggered alert starts it again), ⧉ clone, 📈 open its chart, 🗑 delete; **Log** lists what fired;
**Notifications** sets up the devices and plays the sounds. The phone: More › Alerts, the dialog full screen.

**Server load** (top of the Alerts page): the one limit is on **calculations**. Each distinct symbol + timeframe + chart
type + script (or built-in indicator) with its settings runs once on the server, and every alert that uses it shares it
(50 alerts on RSI 14 of NIFTY 5m are one calculation). Each takes about 4-5 MB of memory and a little CPU. The limit is
automatic (35% of the server's memory: about 71 on a 1 GB server, 143 on 2 GB) unless the admin sets one (**Limit…**). An
alert that would pass it is refused with how many it needs; pause or delete some, or raise the limit. The strip also
shows the memory and CPU the alerts use and the server's free memory. Price alerts against a number need no calculation.

Technical alerts need candles: the server loads them from your saved candles (one Fyers request per symbol and
timeframe, within the data budget) and builds the live bar from each price, as the chart does; every 10 minutes it checks
Fyers' candles again. Before the first price after a restart, a crossing between the two can't be seen.

## Strategies that trade by themselves (⚡, v0.43.0)

A strategy is a Pine **`strategy()`** script from the Pine Editor plus **your rules**. When a bar closes, the app reads what
the script did on that bar and trades it on the accounts you switch on, page open or not.

**What the script decides** (only these):
- `strategy.entry("L", strategy.long)` / `strategy.short`: open a trade at market on the first price after the bar's close.
  An entry the other way **reverses** (the trade is closed first). With *Long only* / *Short only*, an entry the other way
  just closes the trade.
- `strategy.close(...)` / `strategy.close_all()`: close the strategy's trade.
- `strategy.exit(stop = ..., limit = ...)`: the stop and target, if you choose "from the script" below.
- Limit / stop entries (`strategy.entry(..., limit = ...)`) aren't traded yet (the log says so). The script's own settings
  (capital, order size, pyramiding, commission, slippage...) aren't used. Its inputs are the defaults (change them in the
  Pine Editor; the strategy keeps its own copy until you **take the new version**).

**What your rules decide** (⚡ › + New strategy, one screen):
- **What it trades:** up to 10 contracts (Fyers, or MT5 symbols, not both), the timeframe, the chart type (Renko, range
  and P&F use ATR boxes), long and short / long only / short only.
- **Accounts:** any of your paper accounts, Live (your Fyers account) and each MT5 account. **Switching Live or MT5 on asks
  for a fresh 2FA code.**
- **Size:** risk % of the account, a risk amount, or fixed lots (MT5: 0.01 steps).
- **Stop, always** (no stop, no trade): ATR × n, points from the entry, the last swing low / high over N bars, a line the
  script plots, or the script's own `strategy.exit` stop (optionally **followed** as the script moves it, only ever
  tighter); plus a few ticks.
- **Target:** an R multiple (net of every charge, like the ticket), the script's `limit`, or none.
- **BE at x R** and **trail from x R:** each trade's own settings, as the BE-T / TRAIL on its entry line.
- **Limits for the strategy:** trades a day, open at once, stop for the day after losing X (₹ / $ or R), trading hours
  (IST), no new trades X minutes before the square-off (MT5: the day-end close), skip expiry days.
- **Telegram** on each trade (the bot in Settings › Telegram alerts).

**Every order goes through the account's own rules**, exactly like a click: risk cap, margin, max trades, daily / max loss,
the journal's lockouts, the kill switch, the square-off, MT5's news guard and no hedging. If the account says no, the log
says why. A strategy only touches the trades it opened; your own trades are never touched. Switching it off or deleting it
leaves its open trades as they are, with their stops, BE and trail.

**On the page** (phone: More › Strategies): each strategy's card (ON / OFF, its accounts with today's trades and net), Switch on / off, Edit, Test,
Log, Delete; **Stop all strategies**. The log lists every signal and what each account did with it (opened, closed,
refused and why), live. Trades show **⚡ name** on the trades panel, the Trades page and the phone; the History keeps it,
and the journal gets the strategy's name as a set-up tag. A script error switches the strategy off with the reason.
Switched on, it starts with the next bar that closes (the history isn't traded).

**The tester** (Test on a card, or in the rules panel before saving): the same script and rules over the saved candles,
7 days to a year. Market fills at the next bar's open; a stop or target fills when the bar's range reaches it (at the open
if the bar gaps through it; the stop first if both are in one bar); BE / trail move from the next bar on. Sized and counted
net of every charge with your account's own rates. Results: trades, win rate, net (₹ / $ and %), expectancy and total R,
profit factor, max drawdown, charges, the worst losing streak, the equity curve, by month, every trade, and the signals not
taken (and why). Long periods on 1-minute bars use Fyers' data budget.

**Rules to know:** a self-built strategy on your own account under 10 orders a second is allowed by SEBI (every Fyers API
order is tagged as algo anyway); Live strategies need the daily Fyers login. FundingPips allows third-party EAs only as
trade / risk managers and bans HFT, tick scalping, hedging and server spamming: get their written OK before switching a
strategy on for MT5.

## On a phone

Phones get their own layout, like MT5's app (a desktop browser never does). **More → Desktop layout** switches to the desktop page on that phone; **Settings → Layout** switches back (Automatic / Phone / Desktop).

- **Tabs at the bottom:** Quotes (watchlist, Find, Options) · Chart · Trade · History · More. A number on Trade counts your open trades and orders.
- **Top bar:** the account and its equity (tap to switch account), the contract and its price (tap for Quotes), and a dot for the price feed (green live, amber polling). A Fyers login reminder shows under it when needed.
- **Chart tab:** the chart takes the whole screen. At the bottom: **SELL** (the bid) · your default size · **BUY** (the ask). Tap the middle to change the default size (Risk %, Risk ₹ or Lots) and product. Open positions show as chips above the bar with their net P&L; tap one to manage it.
- **Placing a trade:** tap SELL or BUY. The order sheet slides up and the long / short tool appears on the chart. Choose Market, Limit or Stop; set the stop loss and target with − / + (one tick each, hold to repeat) or type them; the box after the target is R, and the padlock after it is the **RR lock** (see the long / short tool below). Pick the size and product. The preview shows the lots, net ₹ at the stop and the target, BE + costs, charges in and out and the margin; if the order can't go (a rule, the margin, the intraday cut-off) the reason is right above PLACE. ✕ cancels.
- **The bubble:** to see the whole chart while you set the trade up, touch the chart (or tap ⌄ in the sheet's header, tap the grip, or swipe the header down). The sheet shrinks to a bubble in the SELL / BUY bar's place, so nothing covers the chart. It shows the side, lots, order type and product, and the net ₹ at the stop and the target with R (whole rupees, after all charges), or why the order can't go. Drag the SL and TP lines and the bubble follows. **PLACE** in the bubble places the trade, **✕** cancels it, and tapping the bubble brings the full sheet back. To have SELL / BUY go straight to the bubble, tap the middle of the bar → **SELL / BUY opens: A bubble** (saved on the server).
- **A position** (tap its chip or its card on Trade): net P&L after all charges, R, LTP, BE + costs, charges paid. Move the SL and target with − / + and press **Save** (Undo puts them back). **BE-T** and **TRAIL** for that trade with their R (typing an R switches it on; **done** once Trail BE has put the stop at break-even; a line under them says whether they're set on this trade or follow the panel), **BE now**, **Chart**, and **Close at market** (tap twice).
- **A pending order** (Trade tab): move its price, SL and target, Save; or Cancel order.
- **Trade tab:** the account figures, every position and order, BE all, Close all (tap twice), Cancel all, and the trailing defaults for new trades.
- **History tab:** Today, 7 days, 30 days or All, with net P&L, win rate, profit factor, average R and charges. Tap a trade for every charge. The full History page (equity curve, filters) is linked at the bottom.
- **More tab:** Alerts; Journal; Account, rules and charges; switch account; trades table; order book; log; settings (Fyers app, security, users, reset); theme; desktop layout; log out.
- **Full screen:** ⛶ in the chart's toolbar, or turn the phone sideways on the Chart tab. Only the chart and the SELL / BUY bar stay. ✕ (or turning it back upright) returns.
- **Live (the admin):** the first button in the top bar is the PAPER / LIVE switch (green / red; tap to switch, Live asks for the client ID and a 2FA code). On Live: **KILL** in the top bar, live warnings under it, LIVE on the PLACE button (and on the bubble's), the stop at Fyers on each position, and **NO STOP · Place my stop** in the sheet of a trade placed in Fyers without one.

## The long / short tool on the chart (like the MT5 EA)

- Press **BUY** or **SELL** at the chart's top-left corner. The tool appears on the chart, starting a little after the live
  candle (**Tool gap** in Chart settings, 30 px by default, as in LiveTrader 1.24; with no room on the right, it sits
  further in so its figures stay readable):
  - a red zone down to the stop and a green zone up to the target, each with its **net ₹**;
  - the R multiple;
  - a **PLACE** box on the entry line.
- **The RR box and padlock** under BUY / SELL (LiveTrader 1.24):
  - **RR box:** the tool's reward : risk, net of every charge (what its target tag shows). Type a number (0.1 to 50) and
    press Enter: the tool's target goes to that RR. It's the same figure as the ticket's R box and the phone's.
  - **Padlock (RR lock):** amber when locked. Locked, the tool keeps that RR whichever line you move:
    - **move the stop:** the target follows;
    - **move the target** (or type a target in the ticket): the stop follows, to the stop that gives that net RR at the
      lots it then sizes to (a wider stop means fewer lots, and the charges then weigh more, so it's worked out on the
      server, not by a plain price ratio);
    - **move the entry:** both follow.
  - **Limits of the lock:**
    - **The rules can stop it:** if your rules (risk %, risk cap, margin) stop the stop going wider, it stops there, and the
      target goes back to the RR from that stop. A message says so.
    - **So can the charges:** if the target is too close for that RR even with a 1-tick stop, the tool uses the closest
      stop and the target goes back to the RR from it.
  - **When it works:** the lock works on the contract's own price (not when an option's stops follow its future). The RR
    and the lock are saved with your ticket defaults.
  - **Unlocked:** as before. The target stays at your R as the stop moves until you drag the target yourself; from then on,
    moving the stop leaves the target where it is. (LiveTrader unlocked leaves the target where it is from the start.)
- **The entry follows the live price** (a market order) until you drag it:
  - drag a buy's entry **below** the market and it becomes a **limit**; drag it **above** and it becomes a **stop** (the other way round for a sell);
  - **MKT** on the PLACE box snaps it back to market.
- **SL and TP keep their distance** from the entry, so the whole tool moves with the price.
  - Drag either line to change its distance.
  - The stop distance you set is remembered per instrument and used next time.
  - The target defaults to your R (Settings: the ticket's R box), net of charges.
- **PLACE** sends it; **✕** closes the tool. The side panel shows the same trade with more detail (charges, margin, BE + costs). You don't need it open to trade.
- **Open positions** show their zones from the entry candle and SL / TP lines you can drag. A control bar sits on the entry line, just left of the price scale. From left to right:
  - **✕** to close at market, alone at the far left with a gap after it, so a click meant for another button can't close
    the trade (v0.43.3);
  - side, lots, entry price, live net P&L and R (and the unit button, if it's on: see *P&L shown as* below);
  - **BE** to move the stop to break-even + costs now;
  - **BE-T** with its R box: trail to BE once the trade reaches that R. It turns blue-grey (**done**) once the stop is at
    break-even;
  - **TRAIL** with its R box: trail the stop that many R behind the best price.
  - **Typing an R in either box and pressing Enter switches that trail on** for this trade (LiveTrader 1.24).

  When the stop or target is only a few ticks from the entry (a BE stop, say), the bar slides just off that line so its label stays readable; the **Entry** tag on the price scale marks the exact entry.

  These trailing settings belong to that trade:
  - **A new trade follows the panel.** The panel's Trail row is the default for new trades.
  - **Set on the trade's line** (or on the Trades page, or the phone's position sheet), the trade has its own setting.
    Pointing at BE-T or TRAIL says which: "set on this trade" or "as the panel".
  - **Changing the panel's Trail BE** (its switch or its R) makes every open trade follow the panel's Trail BE again, with
    the switch and the R together. The same goes for Trail SL. The other trail keeps each trade's own setting (as in
    LiveTrader 1.24).
- **Pending orders** have a bar with **✕** to cancel (at the left, like a trade's), their type and lots.
- **Bid and ask** are solid lines, as in MT5: grey for bid, red for ask, with their prices on the scale. A dashed **Last** line marks the last traded price, which is where the live candle closes. Candles are built from trades, so in a thin contract the candle can sit away from bid / ask until the next trade. Stops, targets and fills always use bid / ask.
- **Chart settings (⚙):**
  - colour and style for every line: bid, ask, last, entry, SL, TP, BE, order and new-trade entry;
  - show or hide bid, ask and last (they show the pre-open price too; intraday candles start at the session's open, so the pre-open makes no candle of its own);
  - candle colours, zone colours and strength, background and grid;
  - **Tool gap after the live candle (px):** the space between the live candle's right edge and the new-trade tool (30 by default);
  - **Check candles against live prices** (on by default): the chart's candles are Fyers' history; the app compares them with Fyers' live figures for the same day - the day's open, high, low and volume, and after the close the last price. If a price differs by more than 0.5% (at least 10 ticks), or the volume by more than 5x, an amber note shows at the bottom of the chart: tap it to see candles vs Fyers live and **Load again**. Your trades aren't affected (fills, stops and P&L use the live prices), but indicators and Pine scripts read the candles, so treat them with care until it clears. Before the open (NSE's pre-open, 09:00-09:15) Fyers' live figures are already today's, so nothing is compared until today's candles arrive; if a later day has traded but isn't in the candles, the note says **Latest day** (the history is missing a day).
  - Charts always show the contract you opened, never Fyers' "continuous" series (which shows, on each date, whichever contract was the near month then, so around an expiry you'd see the expiring contract under the new one's name). The app asks Fyers for continuous data **off** on every request (v0.30.1: Fyers' API, like Fyers' own charts, gives the continuous series unless it's turned off; up to v0.30.0 the app didn't say, so GOLDPETAL NOV's 30 Oct showed the expiring OCT contract's last day: 319 lots, then 14,201). To compare with Fyers' own chart, turn off **Continuous Futures** there (Fyers Web: profile › Settings › Charts; it's on by default). If Fyers corrects a day later, the app picks the correction up within a week of that day.
  - **Hide no-trade candles** (on by default): Fyers' history can carry a closing price on empty candles where no one traded (seen on GOLDPETAL's 30 Oct: candles at 14,201 with no volume until 23:55; that day was the continuous series, fixed in v0.30.1, so the option is now a safeguard). No one traded at that price, so these candles are left off the chart, P&F, indicators and Pine scripts. Only candles with **no volume at a price away from the last trade** are hidden; quiet candles at the last price and indices (which have no volume) stay. Untick it to see Fyers' candles exactly as sent.

  They're saved with your preferences.

## P&L shown as an amount, a % of the account or R (v0.42.0)

Every P&L, SL and TP figure can be written three ways, a **main** unit with a **second** one next to it:
- **Amount** (₹, or $ on an MT5 account), as before;
- **% of account**: of the account size (the paper account's size, the Live account's size from Fyers, the MT5 account's
  starting size, which FundingPips' % rules count from);
- **R multiple**: of the trade's net risk at its first stop (1R). A stop trailed past break-even shows the R it locks in
  ("SL +0.50R"); a pending order's 1R is what its own stop would lose, so its SL reads −1.00R.

Example (an MT5 gold short, 1R = $24.02 net, on a $5,000 account): Amount · R reads **SL −$24.02 · −1.00R**,
**TP +$91.42 · +3.81R**, the position bar **+$9.06 +0.38R**; R · % reads **SL −1.00R · −0.48%**, **TP +3.81R · +1.83%**.

It applies to the position bar, the SL / TP labels (price scale and zones), the new-trade tool (its zones; the PLACE box
shows the main unit only), the trades panel and its Open P&L, pending orders, the Trades page, the MT5 Account page's Open
P&L and the phone (chips, the position and order sheets, the Trade tab; the order bubble shows the main unit only).
Every figure is still net of all charges: only the writing changes.

**The unit button (v0.43.1):** Chart settings › P&L shown as › **Unit button on the position bar** (off by default) puts a
small button after each trade's P&L on its bar on the chart (✕ is at the other end of the bar). It shows the main unit
(₹ / $, % or R); a click switches it. On the phone (no position bars there) it sits at the right end of the row of trade
chips above SELL / BUY, while a trade is open; a tap switches it.

**Switching:** Chart settings › **P&L shown as** (Main and Second; Second can be None), **U** on the chart or the Trades page,
or a click on a P&L figure (the position bar, a zone's label, the panel's P&L, the Open P&L, the Trades page's P&L headers;
on the phone a tap on the position sheet's P&L) cycles the main one Amount → % → R. Saved on the server, so every device
shows the same. Default: Amount · R.

The open total in R is the sum of each trade's R; a trade without a stop has no 1R, so it (and the total) shows the amount.

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
- **Search in ƒx:** the indicators menu opens with a search box (or press **/** on the chart, as on TradingView). Type part of a name: what's on the chart, the built-in indicators (also by their description) and your scripts are filtered, every word must match, and the matching letters are marked. **↑ / ↓** pick one, **Enter** adds it (the menu stays open for the next), **Esc** clears the search, then closes the menu.
- **ƒx → My scripts** lists your library: **+ Add** puts a script on the chart, **{ }** opens it in the editor. You can add the same script twice with different inputs.
- On the chart, each script's read-out shows its values for the bar under the cursor. A read-out never runs past the price scale: a script with many values wraps them onto more lines. Point at a read-out for its buttons, right after its name (on the phone they're always shown):
  - **👁** hides the indicator, or shows it again (a hidden script stops running);
  - **⚙** opens its settings (or double-click the name): see *Indicator settings* below;
  - **{ }** opens the code;
  - **✕** removes it.

  Errors show in red there.
- **Collapse:** the **▴** under the indicators on the candles folds them into "▸ N indicators". In a lower pane, **▾ / ▸** shows or hides that pane's values. Hidden and collapsed states are saved.
- **Tooltips:** point at a label that has a tooltip to read it.
- Scripts with their own pane can still draw on the candles (`force_overlay = true`), as on TradingView.
- `overlay=true` scripts draw on the candles; others get their own pane.
- **Supported:** plots (lines, step, circles, histogram, columns, area; the *with breaks* styles `plot.style_linebr`, `style_steplinebr` and `style_areabr` leave a gap wherever the value is na, as on TradingView, while the plain line joins over it; a bar whose plot colour is na is left out), hline, fill, bgcolor, barcolor, plotshape / plotchar / plotarrow, plotcandle, labels, lines, boxes, linefills, polylines, tables, inputs and request.security() for other timeframes.
- Times are Indian time.
- A plot whose value on the latest bar is na shows no price label on the scale (as on TradingView); e.g. the Chandelier Exit shows only the stop of the current direction.
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
- **Per trade:** each trade can have its own Trail BE and Trail SL, set on its entry line, on the Trades page or on the
  phone; typing an R there switches it on. The panel's settings apply to new trades. Changing one of the panel's trails
  takes every open trade back to the panel for that trail.

Moving a stop yourself makes it your stop again: it drops out of Trail SL until you toggle trailing.

1R is the distance from the **first** entry to the **first** stop, in points, as in LiveTrader. Adds don't change it.

When BE-T has already moved the stop to break-even, a Trail SL of N R behind the best price may still be further away than that BE stop. Trailing never moves a stop backwards, so the stop stays at BE until price makes a new best far enough to beat it. The position's bar shows that price as **"moves past …"**, and then **"next …"** once the trail is running.

## Records

- **History:** every closed trade, with the exit reason (tp, sl, be, trail sl, manual, square-off, expiry; live also kill, "closed in Fyers" for a close made in Fyers, and "closed at Fyers" for a position closed while the app was away). Trades placed in Fyers carry a **Fyers** tag. Tap a trade for its full charge breakdown, first stop, risk, and best / worst price.
- **Download CSV:** one row per trade, with every charge in its own column, and *placed_in* (app / Fyers).
- Trades are stored on the server in `/home/helper/data/u/<user>/a/<account>/paper_trades.json`. **Reset** archives them and starts that account again.

## Not yet

- The prop-firm parts of the journal (phases, payouts, account chains: roadmap 8 c2 with 4b); copy trades between MT5 accounts (8 d, later).
- Footprint / delta (order flow): waiting for the order-flow check (Monday 2 Nov).
- Comparing the charges the app counts with what Fyers actually deducted (live).
- Prop-firm journals in the same journal (waiting for the owner's yes).
- Partial closes.
- Agri MCX contracts use the non-agri rates.
