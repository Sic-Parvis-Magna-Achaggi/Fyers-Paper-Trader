# Changelog

## v0.23.0 — 1 Nov 2026 — Saved chart layouts

Added
- **Saved chart layouts, per user** (owner, 31 Oct; roadmap item 5). The **▦** button on the chart's top bar shows the
  open layout; its menu opens, makes (＋ New layout: a blank chart on the same contract), copies (⧉: the chart as it is
  now), renames and deletes layouts (✕ twice; the last one stays). Your chart as it was becomes "Layout 1".
- A layout holds the contract, timeframe, chart type (with its Renko / range / P&F sizes), indicators and Pine scripts
  with all their settings and pane heights, chart settings (colours, lines, Volume, timer...), the drawing toolbar on /
  off and the indicator read-outs collapsed or not. **Drawings stay with the contract**: every layout on GOLDPETAL shows
  GOLDPETAL's drawings.
- **Saves itself as you change the chart**, like TradingView. Or untick "Save changes automatically" in the menu to save
  by hand: ● on the button means not saved; Save (or **Ctrl+S**); leaving a layout with changes asks Save / Don't save /
  Cancel.
- Saved on the server: every device opens the same layouts and the same one open. On the phone the ▦ button is on the
  chart bar.
- Safe against a page closed mid-change: a layout switch reaches the server at once (not after the usual 0.6 s), what's
  still waiting is sent as the page closes, and on opening the saved layout is what counts (a chart that disagrees
  with it, e.g. after a switch on another device, opens the layout as saved; never the other way round). That check
  happens while the page starts, before the chart is drawn, so nothing you do in the first seconds is undone.

Changed
- The chart bar's buttons sit closer (6 px apart, was 12) to make room for ▦; on a narrow chart ▦ shrinks to its icon
  before any timeframe button drops out (the name is in its tooltip and menu).

Server
- `GET / POST /api/layouts` (per user, `u/<user>/layouts.json`; one layout changed at a time, so two devices editing
  different layouts don't overwrite each other; 50 layouts, 200 KB each). In `tests/routes_check.py`.

Tests
- `tests/layouts_flow.js` (30 checks, new): "Layout 1" from your chart, auto-save, a new blank layout, each layout's own
  contract / timeframe / chart type / indicators coming back on a switch, rename (a taken name refused), copy, drawings
  per contract, delete (twice, never the last), saving by hand (●, the question, Don't save, Save, Ctrl+S), a reload, a
  page closed mid-switch, a second device, the phone.

## v0.22.0 — 1 Nov 2026 — Drawing tools and the measure tool

Added
- **Drawing tools, like TradingView's** (owner, 31 Oct; roadmap item 9). A toolbar down the left of the chart:
  - Lines: trend line, ray, extended, horizontal line and ray, vertical, cross line, parallel channel, regression trend,
    pitchforks (Andrews, Schiff, modified Schiff).
  - Fibonacci and Gann: retracement, trend-based extension, fan, time zones, Gann fan, Gann box (levels, colours and
    fills editable).
  - Shapes: rectangle, ellipse, triangle, path, brush. Text, note, callout, price label, arrows and arrow marks.
  - Price, date, and date & price ranges.
  - Magnet (weak / strong; Ctrl flips it while drawing), stay in drawing mode, lock all, hide all, a list of the drawings
    on the contract, remove all (click twice).
  - Editing: select, handles, move (Ctrl+drag copies), a bar for colour / fill / width / style / text / lock / clone /
    delete, a settings dialog (double-click), a right-click menu, Del, Ctrl+Z / Ctrl+Y, Ctrl+C / Ctrl+V (also to another
    contract), and TradingView's Alt+T / H / J / V / C / F and Alt+Shift+R. The style you pick becomes the tool's
    default.
  - Saved per contract on the server, shown on every timeframe and every chart type (P&F, Renko too: a point sits on the
    bar, brick or column its time falls in). The trade manager's own lines still win over a drawing on them.
- **Show / hide the drawing toolbar** (owner, 1 Nov): ✎ on the chart's top bar, the D key, or Chart settings › Drawing
  toolbar; saved on the server. Hiding the toolbar doesn't hide the drawings.
- **Measure tool, MT5 + TradingView** (owner, 31 Oct; roadmap item 7). Shift+click / Shift+drag, a middle-button drag,
  or the ruler button. A green / red box with the change in points, %, ticks (boxes on P&F, bricks on Renko), bars, time
  and volume, plus the **net ₹ for your lots** after every charge (from the server, the same charges code as trades;
  Chart settings › Lots for the measure) and **R against your trade's current stop** on that contract.
- **Long / short position drawings** for looking back: entry, stop and target with net ₹ and R:R, and which was hit
  first and when, checked on the timeframe's real candles (a candle that opens past a level exits at its open; a candle
  that reaches both is marked and counted as the stop).
- **Accurate coordinates in each drawing's settings** (owner, 1 Nov): the settings dialog has tabs (Style · Text ·
  Levels · Coordinates). Coordinates lists every point: its price (shown and saved on the tick) and its date and time
  (Indian time), all editable, with the bar each time lands on in this chart shown as you type ("on the bar of 31 Oct 26
  23:10 (5m bar holding it)"). A position drawing lists entry, target, stop and its right edge. Wrong values are refused
  with a message and nothing changes (a long's stop above its entry, a date that isn't one). Right-click › Coordinates…
  opens it directly; Ctrl+Z undoes it.
- Phone: ✎ opens the tools as a strip above the chart; draw with a finger, tap a drawing to select it.

Server
- `GET / POST /api/drawings` (a contract's drawings, per user: `u/<user>/drawings/`; 500 a contract) and
  `POST /api/measure` (net ₹ of moves, nothing placed). Both in `tests/routes_check.py`.

Tests
- `tests/drawings_flow.js` (71 checks, new): toolbar show / hide (saved), drawing by drag and by clicks, magnet, select,
  handles, move, undo / redo, delete, colour and width as the default, settings, coordinates (shown, typed, refused,
  undone; a position's), lock, hide all, text, path, brush,
  right-click menu, clone, the list, saved on the server and after a reload, per contract, copy to another contract,
  timeframes, every chart type, the measure (Shift-drag, middle button, ruler; net ₹ checked against gross − charges; R
  with a long open), the position drawing's outcome against the candles, the SL line winning over a drawing, and the
  phone (✎ strip, finger drawing, tap to select).

## v0.21.0 — 1 Nov 2026 — Multiple watchlists

Added
- **Several named watchlists** (owner, 1 Nov). A switcher at the top of the Watchlist tab (on the phone: Quotes ›
  Watchlist): pick a list; **＋** makes a new one; **⋯** renames it, moves it up or down, or deletes it (tap twice; the
  last list stays). Up to 10 lists of 30 contracts (a list held 15 before). **+** in Find (and right-click in the option
  chain) adds to the list on screen. Saved on the server: every device opens the same lists, on the list you last had.
  Your watchlist from before is the first list, "Watchlist".
- Only the list on screen is streamed (with the chart and your trades). A page now streams up to 40 contracts (was 20);
  the server stays inside Fyers' Standard limit of 100 on the price socket, and the contracts of open trades and orders
  always come first (before, the cut was alphabetical).
- When Fyers' socket is down, quotes are polled 50 symbols a request (Fyers' maximum), so more than 50 contracts poll
  too.

Tests
- `tests/watchlists_flow.js` (16 checks, new): the old watchlist becomes "Watchlist"; new, rename, a taken name,
  move, delete (two taps, not the last); + in Find adds to the list on screen; only that list is streamed; 30 a list;
  a reload brings the lists back; the phone's Quotes tab.
- `tests/feed_test.py` (6 checks, new): 40 a page, at most 95 on the socket with trades first, polls of 50.

## v0.20.9 — 1 Nov 2026 — Roadmap: live candles, multiple watchlists, seconds / tick charts (docs only)

Docs
- Roadmap item 10 (keep the candles the app saw live): design agreed. 1-minute candles from the live feed for every
  watchlist, positions / orders and open charts, used for a day only when the data check fails and the recording has
  no gaps; kept 1 year by default (settable on the Account page).
- Item 11, multiple watchlists (right after item 10): the server records all lists.
- Item 12, seconds and tick charts from the live recording (Fyers' own seconds candles need Prime): decided after
  Monday's order-flow check.
- Fyers Standard allows 100 contracts on the price socket (5,000 on Prime), noted in the handoff. No code changes.

## v0.20.8 — 1 Nov 2026 — Data check: a warning when the candles disagree with Fyers' live figures

Added
- **Data check on every chart** (owner, 1 Nov: "how can I trust this data?"). The chart's candles (Fyers' history) are
  compared with Fyers' live figures for the same session: the day's open, high, low and volume, and once the market is
  closed (weekends too) the last price. When a price is off by more than 0.5% (at least 10 ticks), or the volume by
  more than 5x, an amber note shows at the bottom of the chart; tap it for candles vs Fyers live side by side and
  **Load again**. A volume gap equal to the contract's lot / multiplier is a unit difference and isn't flagged.
  Friday's GOLDPETAL would have shown: open 14,163 vs ~14,319, low 14,057 vs ~13,700, last price 14,201 vs 13,960,
  and 319 lots vs the real day's volume. Trading isn't affected (fills, stops and P&L use the live prices).
  Chart settings › **Check candles against live prices** (on by default).
- Polled quotes (when Fyers' socket isn't streaming, e.g. weekends) now carry the day's open, high, low and previous
  close as the socket does, so the check and the Book tab have them then too.

Tests
- `tests/navigation_flow.js` (36 checks): matching figures (and small differences) give no warning; a Friday-like
  day flags open, low, last price and volume; a 100x volume on a ×100 contract isn't flagged; nothing is compared while
  the market is open before today's candles arrive, without day figures, or for volume on an index; the note, its
  box, the setting, and the note clearing. The mock no longer sends a fixed day open / high / low.

## v0.20.7 — 1 Nov 2026 — A day Fyers corrects later reaches your charts; v0.20.6's explanation corrected

Changed
- **Each fetch of new candles also takes the week before again** (still one Fyers request), and the browser takes the
  last 7 days from the server each time a chart opens (was 3). Fyers sometimes rewrites a finished day: if it corrects
  one later, the correction now replaces the saved candles on the server and in every browser. Before, only the
  latest saved day was ever fetched again.

Corrected (what v0.20.6 said)
- v0.20.6 blamed `cont_flag=1` (Fyers' continuous series) for GOLDPETAL NOV's 30 Oct. That was wrong. Fetched
  without it, Fyers still sends the thin day (a few lots, trading until about 17:00, then 14,201 to the close), and
  **Fyers' own chart shows the same** - while Fyers' live prices for the contract are 13,951 / 13,958 and the real
  Friday fell to 13,960 on heavy volume (which Fyers' history also sent during Friday). Fyers rewrote the day after
  the close; it's Fyers' data, reported to Fyers. Dropping cont_flag still stands: with it, 29 Oct showed ~165,000 lots
  that Fyers' own chart doesn't have; without it the app's candles match Fyers' charts.

Tests
- `tests/candles_test.py` (8 checks): a day Fyers corrects 3 days later is replaced on the next fetch (fails with the
  re-check off).

## v0.20.6 — 1 Nov 2026 — Charts show the contract you opened (not Fyers' continuous series)

> **Correction (v0.20.7):** the cause given below for 30 Oct is wrong. Fyers rewrote that day after the close; its own
> chart shows the same thin day. Dropping cont_flag still makes the app's candles match Fyers' charts (see v0.20.7).

Fixed
- **A futures chart could show another contract's candles** (owner, 1 Nov: GOLDPETAL NOV on 30 Oct looked different on
  2m and 15m, and in a private window). Every history request carried `cont_flag=1`, Fyers' "continuous data of futures
  and options", which fills a date with whichever contract Fyers maps there. Fetched again after Friday's close,
  GOLDPETAL NOV's 30 Oct came back as the expiring OCT contract: 319 lots all day on 15m (vs 165,000-180,000 on the
  days before), last trade at 16:58 (expiry-day trading ends at 17:00), then its settlement price 14,201 with no
  volume to the close. The browser still had Friday's real NOV candles, so the private window (the server's copy)
  and your usual window disagreed. Now:
  - history is asked for the exact contract (no cont_flag);
  - a day fetched again from Fyers replaces that whole day on the server (a candle Fyers no longer sends leaves
    nothing behind; an empty answer changes nothing);
  - once, on the first start of this version: the futures / options candles saved on the server are dropped (stocks
    and indices stay), and this browser's saved copies are deleted, so each chart loads again from Fyers when opened
    (one or two requests per chart, inside the request budget);
  - each time a chart opens, the browser takes the last 3 days from the server (the server's own copy, no Fyers
    request), so a day the server corrects reaches every device.

Tests
- `tests/candles_test.py` (7 checks, new): no cont_flag; the clean-out (futures / options dropped once, stocks kept);
  a day fetched again replaces the saved day; an empty answer keeps it.
- `tests/navigation_flow.js` (27 checks): a wrong candle 2 days back in the browser's copy is corrected from the
  server; the old browser store is deleted. The mock answers a request with cont_flag with a marker price and logs it
  ("CONT_FLAG ASKED"); none in a full run.

## v0.20.5 — 1 Nov 2026 — Empty after-close candles left off the chart

Fixed
- **Empty candles at the closing price after MCX closes** (owner's screenshot, GOLDPETAL 2m, 30 Oct). After 23:30
  Fyers' history had candles at 14,201 with no volume until 23:55, while the last trade was 13,960 (most likely
  the exchange's closing price, not a trade). They stretched the price scale (candles squashed to the bottom), made the
  48-box P&F column at the end of the day, and fed indicators and Pine scripts a price no one traded at. A candle with
  no volume whose prices differ from the last trade's is now left out: on the chart, P&F and every chart type,
  indicators, and Pine (request.security too). Quiet candles at the last price and indices (no volume at all) stay.
  Chart settings › **Hide no-trade candles** (on by default) shows Fyers' candles exactly as sent when unticked.
  The saved candles on the server are not changed.

Tests
- `tests/navigation_flow.js` (25 checks): the mock's CRUDEOIL26DECFUT gets empty candles at 6,250 after 23:30 each
  day; they're hidden, the scale isn't stretched, the setting shows / hides them, P&F and request.security() agree.

## v0.20.4 — 1 Nov 2026 — P&F readable when zoomed out

Fixed
- **P&F turned into thin lines when zoomed out** (reported 1 Nov, GOLDPETAL 2m, 5 x 3). Zooming out puts more columns
  on screen, so the price range grows and each box gets shorter; under 4 px a box, the chart drew each column as a 1-2 px
  line. Now every zoom shows X's and O's: square while there's room; zoomed out, each X / O keeps the column's full
  width and gets flatter (a column still reads as a stack of X's or O's); when a box is under 1.8 px, X columns are
  solid bars and O columns hollow ones, in the up / down colours.
- The order bubble (v0.20.3) on a 360 px phone: "2.04R" could be cut off; the bubble is a little tighter there.

Tests
- `tests/navigation_flow.js` (19 checks): the three looks, at a 2.8 px box, a 0.8 px box and back to normal.

## v0.20.3 — 1 Nov 2026 — Phone: the order shrinks to a bubble

Added
- **The order as a bubble (phone layout)** (owner: "minimise it to a bubble so I can see the full chart"). After
  SELL / BUY, the order sheet shrinks to a bubble in the SELL / BUY bar's place, so nothing covers the chart. It
  shows the side, lots, order type and product, the net ₹ at the stop and the target with R (net of all charges, whole
  rupees like the chart's zone labels; the sheet keeps the paise), or why the order can't go. **PLACE** in the bubble
  places it; **✕** cancels; tapping the bubble brings the full sheet back. Nothing about the trade changes either way.
- It shrinks when you touch the chart (so you can drag the SL / TP lines with the whole chart in view), tap ⌄ in the
  sheet's header, tap the grip, or swipe the header down. The bubble updates live as you drag.
- **SELL / BUY opens:** the order sheet (as before) or straight to a bubble. Set in the size sheet (the middle of the
  SELL / BUY bar), saved on the server.
- Turning the phone sideways with the bubble up goes full screen as usual; the bubble stays at the bottom.

Changed
- The grip used to fold the sheet to its header and PLACE (still half the screen); it now shrinks it to the bubble.

Tests
- `tests/mobile_flow.js` (61 checks, was 44): the bubble, the chart left uncovered, dragging the SL line updates the
  bubble's ₹, back to the sheet, chart touch / swipe, PLACE and ✕ in the bubble, "opens as a bubble" saved on the
  server, landscape and a 360 px phone, LIVE on the bubble. The test now clears the remembered stop distances first
  (each run widened them until the 2% risk cap blocked the test trade).

## v0.20.2 — 1 Nov 2026 — Go to a date; readable P&F

Added
- **Go to** (calendar button at the chart's bottom left, or Alt+G): a date, and a time on intraday charts. Older
  candles load first if needed (as far back as Fyers has them); the chart centres on that candle and the crosshair
  marks it. Before a contract's first candle: the oldest one, with a note.
- **»** at the bottom right whenever the latest candle is off screen: back to now, keeping your zoom.

Fixed
- **P&F looked tiny at the default zoom.** It opened with 6 px columns; it now picks a column width (12-40 px) that
  makes the X's and O's as big as they can be (up to 14 px) for the prices on screen, with a 4-column right margin.
- **P&F on a day chart drew thin lines instead of X's and O's.** The fixed box was saved per contract, so the
  5-point box set on 2m also applied to 1D, making columns of 100+ boxes too small to draw (under 4 px a box, the
  chart draws each column as a line). The box is now saved per timeframe; a per-contract box saved earlier still
  applies except where a typical bar spans more than 8 boxes, where the ATR box is used until you set one, and the
  menu says so. A fixed mode with no size now uses the ATR box (it used to fall to one tick).
- Daily / weekly / monthly charts show dates only on the time axis (the crosshair said "05:30").

Tests
- `tests/navigation_flow.js` (16 checks): P&F zoom and right margin, the 1D box, per-timeframe boxes, Alt+G, Go to an
  intraday time 20 days back (older candles loaded), », a date before the listing, a date on 1D.

## v0.20.1 — 1 Nov 2026 — Any script on another timeframe; scripts follow your scrolling

Added
- **Timeframe for every Pine script** (owner: "the MA of a 15M chart on a 2M chart"). Settings › Inputs › Calculation
  has Timeframe and Wait for timeframe closes for all scripts, not only those whose indicator() has timeframe =. The
  list has the usual timeframes plus your own (pinned / custom, e.g. 87m); ones lower than the chart's are greyed out.
- **Bars of history: Auto** (the new default). A script starts on the latest 1,500 bars; scroll back past where its
  line starts and, once you stop, it calculates again over everything the chart has loaded - the same way the chart
  loads older candles. A number still fixes it at that many bars.

Changed
- A new bar still re-runs each script in full in the background (it keeps `var` state and drawings exact; the live
  update alone was shown to drift on stateful scripts); a script slower than 1.5 s per run is re-run at most every
  5 x its run time.

Tests
- `tests/indicator_settings_flow.js` now 37 checks: a plain SMA set to 15 minutes on a 2-minute chart equals the SMA
  worked out from the 15-minute candles (203 values, 0 differ); Auto extends a script from 1,500 to all loaded bars
  when you scroll back; a fixed number still applies.

## v0.20.0 — 1 Nov 2026 — Indicator settings, Pine libraries, older candles

Fixed (reported 1 Nov)
- **Indicator settings were only inputs.** Every indicator now has TradingView's three tabs (⚙ on the read-out, or
  double-click its name): **Inputs** (grouped like the script, `inline` inputs on one row), **Style** (each plot's
  colours with opacity, on / off, plot type, width, line style, price line; levels, fills, backgrounds, shapes and
  bar colours; precision, labels on the price scale, values and inputs in the status line) and **Visibility** (which
  minutes / hours / days / weeks / months it shows on). Volume has its own colours and MA style. Saved on the server;
  Cancel puts things back; Defaults resets a tab.
- **The indicator's own timeframe.** A script whose `indicator()` has `timeframe =` gets **Timeframe** and **Wait for
  timeframe closes** in Inputs and calculates on that timeframe: values on the bar where each higher-timeframe bar
  closes (or filling the bars between, with Wait off), the live bar on the latest. The read-out shows the timeframe.
- **`import` failed ("no import resolver is configured").** Libraries now resolve: `TradingView/ta` is built in (the
  app's own implementation of its functions from the standard formulas, checked against Pine's own ta.supertrend
  etc.; not TradingView's code; `ht()` and `wpo()` not included), and any library you paste into the Pine Editor and
  save answers `import anyone/<its name>/<version>`. A library you don't have gives a message saying what to do. ƒx
  marks saved libraries and doesn't offer to add them to the chart.
- **Older candles were missing.** The chart opened with ~6 days of 2-minute candles and nothing loaded behind them.
  Scroll (or zoom out) to the left edge and older candles now load a step at a time, as on TradingView, keeping your
  view, as far back as Fyers has them (it says when a contract's history starts).
- **Pivot Points: "Not enough data available".** Fyers answers `no_data` for days before a contract was listed; the
  app treated that as an error, so the 2-year daily request Pivot Points makes through request.security failed
  completely. `no_data` is now an empty answer. Other-timeframe candles also get 90 s (was 15 s) to arrive; if they
  don't, the read-out or the error says why and the script retries in 30 s (up to 3 times).

Added
- `/api/history` takes `until` (only candles before that time: the chart's scroll-back).
- `web/indset.js` (the settings dialog), `web/pine_libs/TradingView_ta.pine` (the built-in library).
- Tests: `tests/indicator_settings_flow.js` (31 checks: history scroll-back and its end, daily candles across a
  listing date, Pivot Points Standard on 2m, imports, your own library, the indicator timeframe with and without
  gaps, Style, Volume style, Visibility, saved after reload); two scripts added to the Pine battery (an import, an
  indicator timeframe), passing on every chart type; the mock server now "lists" contracts 200 days back and answers
  `no_data` before that, as Fyers does.

## v0.19.0 — 1 Nov 2026 — The phone layout

Added
- **A separate phone layout, modelled on MT5's mobile app.** Phones get it automatically; a desktop browser never
  does. Five tabs at the bottom: Quotes · Chart · Trade · History · More.
- **Chart tab:** the chart fills the screen between a slim top bar (account and equity, contract and price, a feed
  dot) and a one-tap bar: **SELL (bid) · size · BUY (ask)**. Open positions show as chips above the bar with their
  net P&L.
- **Order sheet** (slides up from BUY / SELL): side, Market / Limit / Stop, price, stop loss and target with − / +
  tick buttons (hold to repeat), target as R, size (Risk % / Risk ₹ / Lots), product, option stops on the option or
  the future, the server's preview (lots, net ₹ at stop and target, BE + costs, charges, margin) and a big PLACE.
  The reason an order can't go (a rule, the margin, the intraday cut-off) shows right above PLACE. The SL / TP lines
  stay draggable on the chart; tap the sheet's grip to fold it away while you drag. It drives the desktop ticket
  itself, so the sizing, rules and charges are identical.
- **Position sheet** (tap a chip or a trade): net P&L, R, LTP, BE + costs, charges paid; SL and target steppers with
  Save / Undo; BE-T and TRAIL for that trade with their R; BE now; open its chart; Close at market (two taps). On a
  Live account it shows the stop at Fyers.
- **Order sheet for pending orders:** move the price, SL and target; cancel.
- **Trade tab:** account figures (balance, equity, open and today's P&L, day / max room, margin, open risk, trades
  and charges today), position and order cards, BE all, Close all (two taps), Cancel all, trailing defaults.
- **History tab:** Today / 7 days / 30 days / All with net P&L, win rate, profit factor, average R and charges; tap
  a trade for every charge. The full History page is a tap away.
- **More tab:** account, rules and charges; switch account; trades table; order book; log; settings; theme;
  desktop layout; log out.
- **Full screen** (⛶): just the chart and the SELL / BUY bar. Turning the phone sideways on the Chart tab does the
  same, as in MT5.
- **Live accounts on the phone:** red LIVE badge and KILL in the top bar, live warnings under it, LIVE on PLACE.
- **Layout switch:** More → Desktop layout, and Settings → Layout (Automatic / Phone / Desktop) to come back.
- **Tests:** `tests/mobile_flow.js` (47 checks on an emulated Pixel 7).

Changed
- Nothing on the desktop page (the phone layout is its own file, `web/mobile.js` + `web/mobile.css`).

## v0.18.0 — 31 Oct 2026 — P&F toolkit, second set

Added
- **Horizontal counts** on the P&F toolkit: at each breakout out of a congestion (at least 5 columns, settable),
  width x box x reversal from the congestion's low / high; shown until reached (HC).
- **Patterns** (each family has its own switch): bull and bear traps, bullish and bearish catapults, high and low
  poles, symmetrical / ascending / descending triangles, turtle breakouts (beyond the last 20 columns, settable),
  anchor follow-through (AFT) with its stop. StockCharts / Dorsey rules; turtle and AFT from Definedge's published
  descriptions.
- Labels are placed by importance and never overlap; the read-out also shows the latest pattern.
- **Tests:** every pattern and both counts, bullish and bearish, on hand-made columns (`tests/ctype_test.js`); on a
  real chart in `tests/pine_compat_flow.js`.

Fixed
- Live: after the kill switch the order ticket always says trading is paused (before, another rule's message could
  show first).

Not included
- Mini tops / bottoms: Definedge doesn't publish the rule.

## v0.17.0 — 31 Oct 2026 — Every indicator on P&F, and the P&F toolkit

Added
- **Every indicator works on every chart type, Point & Figure included** (owner's rule, now permanent): Pine scripts
  get ordinary bars on every type. Bars that don't follow the clock (Renko, range, line break, P&F) close when the
  next one opens, so `request.security`, time and session functions line up with them.
- **P&F: what indicators read** (chart type menu): `close` = the column's middle (default, du Plessis' convention)
  or its last box; open / high / low are the column's own.
- **P&F toolkit** (ƒx → Built in): 45° bullish support and bearish resistance lines, each break marked and the next
  line drawn from the extreme of the move; Double / Triple Top Buy and Bottom Sell at the trigger box, fresh or
  continuation; anchor columns (15+ boxes) with their levels; open vertical counts (boxes × box × reversal, shown
  once active, gone when reached). Each part can be turned off; the read-out shows the trend and the last signal.
- **Tests:** `tests/pine_compat.js` (9 scripts using most of Pine: plots, fills, hlines, shapes, bgcolor / barcolor,
  the ta.* library, drawings by bar index and by time, tables, arrays, maps, functions, var / varip,
  request.security, time / session) and `tests/pine_compat_flow.js` (each on all 10 chart types; the P&F close
  option; a drawing script and the toolkit on a P&F chart). The toolkit's rules in `tests/ctype_test.js`.
- `docs/Project_Instructions.md`: the rule that every indicator works on every chart type, and that the footprint
  is built only from real trades.

Fixed
- An account just switched to Live (or created / restored) starts with the prices of the last few seconds, so an
  order placed straight away isn't refused with "no price yet".

Roadmap
- Added (item 8): a measurement tool, a mix of MT5's ruler and TradingView's measure box, with net ₹ and R.

## v0.16.0 — 31 Oct 2026 — Point & Figure, and the order-flow check

Added
- **Point & Figure** chart type: X (rising) and O (falling) columns, one mark per box; reversal of 3 boxes
  (settable), new column one box back; box by ATR or fixed points per underlying; from closes or highs and lows.
  Volume, indicators and Pine scripts run on the columns (one value per column) like every other type; the chart
  fits the columns to the width; the button shows box × reversal.
- **Order-flow check** (admin, Log page): the server records every price snapshot of chosen contracts (default the
  nearest CRUDEOIL and NIFTY futures, up to 6) to `data/feedcheck/<day>.jsonl.gz` and reports, per contract and per
  hour, how much of the volume arrived one trade per snapshot (exact), how much was merged, the largest merge and
  gaps. It decides whether a real footprint can be built from Fyers' feed (measured from Monday 2 Nov). Routes:
  `GET` / `POST /api/feedcheck`.
- The price feed passes Fyers' last-trade time along with each tick.
- **Tests:** `tests/feedcheck_test.py`; Point & Figure in `tests/ctype_test.js` (hand-worked columns) and in
  `tests/charttypes_flow.js` (with Volume and two Pine scripts, whole boxes, alternating columns; the Log page card).

Roadmap
- Footprint: real trades only, never an estimate (agreed); the recorder is built, the measurement is on Monday.

## v0.15.0 — 31 Oct 2026 — Chart types, with indicators on every type

Added
- **Chart types** (the button after the timeframes, saved on the server): Candles, Hollow candles, Bars (OHLC), Line,
  Area, Heikin-Ashi, Renko, Range bars and Line break.
  - Renko: box by ATR (default 14) or fixed points per underlying; built from closes or from highs and lows;
    optional wicks; a reversal needs two boxes (traditional).
  - Range bars: range by ATR or fixed points. Line break: 3 lines (settable).
  - Renko, range bars and line break are built from the timeframe's candles (1m for the finest) and get the time of
    the candle each bar formed in; the candle timer is off for them.
- **Indicators on every chart type.** Volume, built-in indicators and Pine scripts run on the bars the chart shows,
  as on TradingView (an RSI on Heikin-Ashi uses Heikin-Ashi closes; on Renko, one value per brick), line up bar for
  bar on the candles and in their own panes, and follow live prices (several new bricks in one tick included).
- Bid, ask, last, trade lines and every ₹ figure stay real prices on every type; the long / short tool, zones and
  position bars work on every type.
- Chart settings: a colour for the line / area chart.
- **Tests:** `tests/ctype_test.js` (the transforms, with hand-worked numbers) and `tests/charttypes_flow.js`
  (browser: every type with Volume and two Pine scripts, alignment, the SMA checked against the chart's own closes,
  live ticks, the trade tool on Renko).

Changed
- Switching chart type or theme redraws at once from the candles already loaded (no reload, no empty chart).
- `web/vendor/lightweight-charts.standalone.production.js` (5.2.1, the latest): one guard added so the volume
  histogram's hover check returns "no hit" instead of throwing "Value is null" when it has no first visible value
  (a library bug; it showed as an occasional console error with the mouse over the chart). Noted in the file.

Roadmap
- Candle types moved up to item 2 and ticked; footprint / delta (order flow) stays open.

## v0.14.0 — 31 Oct 2026 — Live mode (the admin only): real orders at Fyers with the stop at Fyers

Added
- **Live accounts.** Any account can be Paper or Live (Account page → Your accounts → Turn on LIVE / Back to
  Paper). Live is for the admin only, one Live account per Fyers login, and needs the account flat, Fyers logged in
  today, the Fyers client ID typed to confirm and a fresh 2FA code. The account's earlier trades are archived and a
  fresh ledger starts at the capital typed, so paper results and real money never mix. In the security log.
- **Real orders, same engine.** A Live account uses the paper engine's ticket, chart tool, rules and guards, BE,
  BE-T, trailing, targets, square-off and expiry exit; orders go to Fyers on the owner's login. A position opens when
  Fyers reports the fill, at Fyers' price, and every ₹ figure stays net of all charges. Every live trade needs a stop;
  no orders when the contract isn't trading (Fyers takes no after-market orders) or without today's Fyers login.
- **The stop at Fyers.** As soon as a trade opens, a stop-limit (SL-L) sits at Fyers at the stop, its limit 0.5% (at
  least 5 ticks) past the trigger so it fills if price jumps (new rules: LIVE stop-limit slack % and ticks).
  Trailing, BE, BE-T and your own SL edits move that same order, paced 1.5 s apart, never below BE, never backwards.
- **Exits, never two at Fyers.** The server's bid / ask rule (and targets, square-off, expiry, ✕, Close all, the kill
  switch) closes at Fyers: on NSE / BSE the stop order itself becomes a market order; on MCX (no type change allowed)
  the stop is cancelled, the cancel confirmed, then one market exit. Market refused → a limit that crosses the spread;
  an exit still open after 3 s is re-priced (new rule: LIVE re-price after, seconds). Targets stay on the server.
- **When things go wrong.** Server restart: Fyers' order book is read first (a stop that filled is recorded), then
  trailing resumes. A refused stop change keeps the old stop and retries with a warning. An unconfirmed order is
  looked up by its tag, never sent twice. Overnight (Carry) positions get a fresh stop at the trailed level the next
  day once the contract trades, after checking Fyers still holds the position.
- **Kill switch** (KILL in the top bar and on the Account page): cancels every order and closes every position at
  Fyers on the login (the app's and any others), then pauses new orders until Resume.
- **On the page:** red LIVE badge, KILL button and a red line under the top bar; "● LIVE" in the switcher; LIVE on
  the PLACE button; live warnings under the top bar (no stop at Fyers, no Fyers login, order updates down); each
  position shows its Fyers stop (and on the Trades page under SL); the Account page's Live card (Fyers login, order
  updates, Fyers funds, Resync with Fyers, Resume, kill switch).
- **Fyers order updates** through Fyers' order socket (not counted against API limits), with the order book read as
  a fallback (every 5 s if the socket is down).
- **Routes:** `POST /api/accounts/mode`, `GET /api/live/status`, `POST /api/live/kill`, `/api/live/resume`,
  `/api/live/resync`. The paper routes work for Live accounts too.
- **Tests:** `tests/fake_broker.py` (a fake Fyers order API with Fyers' rules, which records any moment two exit
  orders are open), `tests/live_test.py` (61 checks of the live engine), `tests/live_flow.js` (browser). The mock
  server fakes the order API too.

Roadmap
- Added, in this order: saved chart layouts per user (indicators and their settings); multi-charts (vertical and
  horizontal) in a layout; a proper mobile version (full-screen chart, like the MT5 mobile app).

Changed
- The account manager is headed "Your accounts" and shows each account's mode.
- `tests/security_flow.js`: the "no page errors" check ignores HTTP answers the test provokes on purpose (401, 428)
  and fonts the test machine can't reach; script errors still fail it.

Safety fixes before release (an independent review of the live engine found these; each is now a test)
- A stop or exit that part-fills at Fyers: each part is recorded as it fills and an exit is never larger than what
  Fyers still holds (before: a part-filled stop then a full-size exit could open an opposite position).
- An order whose answer from Fyers was lost: its tag and "sent" mark are saved before sending, and after a restart
  it's looked up, never sent again.
- Kill switch: its second phase never touches a contract the app was handling, and acts only on positions Fyers
  shows twice, 1.5 s apart (before: an app exit filling meanwhile could be "closed" a second time).
- Cancelling an order Fyers hadn't confirmed: it's kept until Fyers shows it (then cancelled there) or confirms it
  doesn't exist; if it filled, the position opens with its stop. Nothing is left at Fyers without the app knowing.
- An extra app order that turns up late at Fyers is cancelled (or, if filled, recorded), and when a position closes
  every other app order for it is cancelled. Anything only you can sort out shows as a "CHECK FYERS" warning until
  Resync.
- The kill switch pauses new entries only; stops keep being placed and moved. An entry that fills during it is closed.
- Delivery (CNC) shares held overnight are found in Fyers' holdings.
- Order updates that fail are retried from the order book; a silent order socket is reopened after 45 s.
- **Resume** after the kill switch asks for a fresh 2FA code.
- After a restart, the day's finished orders aren't replayed (no false "CHECK FYERS" warnings); the kill switch's
  own close of an outside position is never mistaken for a stray; the app records a position as "closed at Fyers"
  only when two reads of Fyers' positions, 3 s apart, both show it gone; a fill whose recording fails is retried;
  "not placed" is decided only after 6 looks at the order book (about 12 s).

Not tested (needs the real Fyers): see "Where live mode stands" in `docs/Handoff.md`.

## v0.13.3 — 31 Oct 2026 — Roadmap as a ticked task list, project instructions (no change to the app)

Added
- `docs/Project_Instructions.md`: the project instructions for claude.ai, brought up to date (users and 2FA,
  live mode for the owner only, the test kit, square-off, order limits) and with a ROADMAP section: new tasks go
  into the roadmap as soon as they're agreed, and finished ones are ticked with their version.

Changed
- `docs/Roadmap.md` is now the one task list: open tasks marked [ ] in the agreed order, small follow-ups, and a
  Done section listing every version from v0.1.0, each ticked.
- `docs/Handoff.md` points to the project instructions.

## v0.13.2 — 31 Oct 2026 — Test kit and handoff notes (no change to the app)

Added
- `tests/`: the test kit used before every release. It runs the real helper with Fyers faked (candles, quotes,
  margin, a live price stream) and includes the route check, the square-off engine test and the browser test of
  login, 2FA, users and accounts. See `tests/README.md`. Nothing in it runs on the server.
- `docs/Handoff.md`: where the project stands, how the code is laid out, and the next job, so a new chat can
  pick up from the repo.
- `docs/Roadmap.md`: the agreed live-mode design (a real stop at Fyers that the trail moves, the server watching
  with the bid / ask rule, targets held by the server, what happens if the server or Fyers lags or goes down,
  overnight stops).

## v0.13.1 — 31 Oct 2026 — Intraday square-off 5 minutes before Fyers, product switch on the chart

Added
- **Product on the chart:** the PLACE box has an **INTRADAY / NRML / CNC** button. Click to switch between
  Intraday and Carry (Delivery for stocks). The choice stays the default for later trades in that account,
  the same as the Product box in the panel.

Changed
- **Intraday square-off now runs 5 minutes before Fyers' own square-off** (Fyers charges ₹50 + GST per
  order it closes). Fyers' times: index and stock F&O 15:25, stocks with F&O 15:05, other stocks 15:20,
  MCX 23:20 (US summer time) / 23:45 (US winter time, from Mon 2 Nov). So the app closes at 15:20, 15:00,
  15:15 and 23:15 / 23:40. The MCX time switches by itself when US clocks change.
- At that moment the app also **cancels pending Intraday orders**, and **refuses new Intraday orders** for
  the rest of the day (pick Carry / Delivery instead). Carry and Delivery are never touched.
- Rules: "Intraday square-off" on / off, "Minutes before Fyers' square-off" (5; it shows today's times),
  and Fyers' own times per market, in case Fyers changes them. These replace the three fixed square-off
  times. If you had turned square-off off (empty times), it stays off.
- An open page from before v0.13.0 that tries to log in now says "reload it" instead of "wrong username or
  password".

## v0.13.0 — 30 Oct 2026 — Users with two-factor login, and several paper accounts

**After this update:** open the page and log in with username **admin** and your existing page password.
You'll be asked to set up two-factor login (scan a QR code with Google Authenticator, Microsoft
Authenticator, Authy or similar), then shown 10 recovery codes once: save them somewhere safe. Your
trades, rules, scripts, chart set-up and Fyers app are all kept (moved into your user and a paper account
called "Main").

Added
- **Users.** Settings → Users (admin only): add a user with a temporary password; disable / enable, reset
  their 2FA (lost phone) or give a new temporary password. A new user chooses their own password and sets
  up 2FA at first login. Each user has their own Fyers app (for prices), chart set-up, Pine scripts and
  paper accounts. Other users are paper-only; live trading will be the admin's only.
- **Two-factor login for everyone**, the admin included: password, then a 6-digit code from an
  authenticator app. 10 one-time recovery codes for a lost phone (typed with or without the dashes).
- **Security** in Settings: your name, change password, new recovery codes, move 2FA to a new phone,
  every device you're logged in on (log out any of them, or everywhere else), and recent activity.
- **Sensitive actions ask for a fresh 2FA code** (valid 5 minutes): adding or changing users, new
  recovery codes, moving 2FA, editing charge rates.
- **Login protection:** 5 wrong attempts lock the user for 15 minutes; 20 failures from one address in
  15 minutes block that address for 15 minutes. Sessions end after 48 hours idle and 7 days at most.
- **Encrypted secrets:** each user's Fyers App Secret and daily token are stored encrypted on the server.
- **Security log:** logins, failures, lockouts, password and 2FA changes, users and accounts changed,
  charge edits. Yours in Settings and on Log → Security; the admin sees everyone's in Settings → Users.
- **Several paper accounts.** A switcher in the top bar (name and balance). **+ New account**: name,
  starting capital, and default rules or a copy of another account's rules and trailing. Each account has
  its own balance, rules, trailing defaults, positions, orders and history, and keeps running on the
  server whichever one you're looking at. Rename and archive / restore on the Account page.
- Server console rescue if the admin loses both phone and recovery codes:
  `sudo -u helper /home/helper/venv/bin/python -m helper.users rescue admin` (run in /home/helper/app).

Changed
- Login is now username + password + code (was a single page password).
- Charges: only the admin can edit rates or mark Fyers' page as reviewed.
- Data on the server moved into `data/u/<user>/` and `data/u/<user>/a/<account>/` (done automatically,
  once). The old `auth.json` is renamed `auth.json.migrated`.
- Requirements: adds `cryptography` (installed by the update service automatically).

Fixed
- On a phone, with the trade panel closed, the chart and watchlist used only two-thirds of the width.

## v0.12.0 — 30 Oct 2026 — Charges you can edit, and a daily check of Fyers' charges page

Added
- Account → Charges used → **Edit rates**: every rate of every segment can be changed in the app (in %,
  or ₹ for flat ones), plus GST. Saved on the server; every figure uses the new rates at once (charges
  already paid on open positions stay as they were). Edited segments are marked; **Back to built-in
  rates** undoes all edits.
- The server reads Fyers' charges page about once a day (and on **Check Fyers' page**). If its rate
  lines change, a "Charges changed: review" pill appears in the top bar and the Account page shows the
  old and new lines. Nothing changes by itself: you edit the rates if needed and click **Mark as
  reviewed**. The first check just records the page as it is.

## v0.11.0 — 30 Oct 2026 — Speed: saved candles, Pine scripts update only the live bar

Added
- Saved candles, on the server and in your browser:
  - The server keeps every candle it fetches (data/candles.db). Fyers is asked only for what's new since
    last time (at most every 45 s per chart), or for older days not saved yet. Asking for a longer
    history fetches the older part once, and the history keeps growing past what one Fyers request gives.
  - Your browser keeps its own copy (IndexedDB, last 60 charts). A chart opens at once from it, then only
    the newer candles come from the server. If Fyers is logged out, the saved chart still shows.
  - New candles are drawn without re-running indicators from scratch.
- Pine scripts run like TradingView's:
  - The full history runs once. After that each price re-runs only the live bar: about 1 ms for simple
    scripts, and about 0.3 s for the Regime script on 1,500 bars (it was a full 2.4 s re-run).
  - A new candle triggers one full re-run in the background, so labels and lines drawn on the old last
    candle are rebuilt exactly.
  - "Bars of history" per indicator (⚙): 500 to 50,000. The chart loads the extra days it needs.
  - "Update" per indicator (⚙): with every price, or on candle close (for heavy scripts on long
    histories: one run per candle, nothing in between).
  - The settings box shows how many bars the script ran on and how long a full run and a live update take.
  - While the first run is working, the read-out says "calculating…".

Measured (Regime script, this test machine; your PC may differ):
- 1,500 bars: full run 2.4 s, live update 0.3 s.
- 5,000 bars: full 5.3 s, live 0.7–1.0 s.
- 20,000 bars: full 18.7 s, live 2.6–3.0 s. Its big analysis runs on the last bar, so each live update
  repeats it. "On candle close" suits it there.

## v0.10.0 — 30 Oct 2026 — Full pages; NSE and BSE: stocks, indices, F&O, currency

Added
- Pages next to the chart (top bar: Chart · Trades · History · Book · Account · Log). The chart keeps
  running underneath, so switching back is instant; the address remembers the page (#trades ...).
  - Trades: every open position in one table (entry, LTP, SL / TP with their net ₹, BE + costs, net P&L,
    R, charges paid, time open), per-trade Trail BE / Trail SL with R boxes, BE and close buttons; click
    any price to change it. Pending orders with their price, distance from the market, SL / TP and risk.
    BE all, Cancel all orders, Close all. The account figures sit on top.
  - History: filters (period, contract, side, wins / losses, exit, product), stats (net, win rate,
    profit factor, average R, expectancy, average win / loss, charges, best / worst, max drawdown,
    streaks, average hold), an equity curve and a daily P&L chart, results by contract and by exit,
    and every closed trade with its full charge breakdown. Download the filtered list as CSV.
  - Book: up to 4 order books side by side (the chart's contract plus any from your watchlist or open
    positions), with spread, buy / sell totals and the day's figures.
  - Account: the paper account's figures, rules, trailing defaults, reset, and the charges in use.
  - Log: the paper account's events (now the last 500) and the helper's own log, with filters and search.
  - ⤢ on the trade panel's tabs opens the Trades page.
- NSE and BSE as well as MCX:
  - Stocks (NSE and BSE), indices (NIFTY 50, BANK NIFTY, SENSEX, INDIA VIX ...), index and stock F&O
    (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, BANKEX ...), NSE currency, NSE commodities.
  - Find has exchange (NSE / BSE / MCX) and type (Stocks / Index / Fut / Opt) filters. Searching
    "nifty" puts the index first, then its futures and options.
  - Option chains from an index or stock row (Opt), with the at-the-money strike from the index.
  - Indices are chart-only: BUY / SELL explains that an index can't be traded.
  - Stocks trade as Intraday or Delivery (CNC); F&O as Intraday or Carry (NRML). A delivery sell needs
    shares you hold, as at the broker.
- Charges for every new segment, net in every ₹ figure as before: stock intraday (STT 0.025% on sell)
  and delivery (STT 0.1% both ways, stamp 0.015%, brokerage ₹20 or 0.3%, DP ₹12.5 + GST per sell), NSE
  and BSE exchange rates, BSE Sensex / Bankex options, BSE futures, currency futures and options, NSE
  commodities.
- Square-off and expiry-day exits per market: MCX (23:15 / 22:45), NSE / BSE (15:15 / 15:00) and
  currency (16:45 / 12:00), all in Rules.

Changed
- MCX contracts still show without "MCX:"; NSE and BSE ones keep their exchange (NSE:RELIANCE-EQ vs
  BSE:RELIANCE-A).
- The symbol lists are kept compactly in memory (the server has 1 GB), about 2 seconds to load.

## v0.9.0 — 30 Oct 2026 — Hide / collapse indicators; your Liquidity Levels script draws on the candles

Added
- Indicator read-outs work like TradingView's:
  - 👁 on each indicator hides it (plots, drawings, tables) and shows it again; the name stays, greyed.
    A hidden Pine script stops running until you show it again.
  - The arrow under the indicators on the candles (▴) collapses them all into "▸ N indicators";
    click it to expand.
  - Each lower pane's read-out has ▾ / ▸ to show or hide its values.
  - The buttons (👁 ⚙ { } ✕) appear when you point at a read-out, so they don't crowd the chart.
    Double-click an indicator's name for its settings.
  - Hidden and collapsed states are saved, so they survive a reload and work on any device.
- Label tooltips: point at a Pine label that has a tooltip (your Liquidity Levels labels do) to read it.

Fixed
- Pine scripts with their own pane that draw on the candles (force_overlay = true) now draw there. This
  is why Regime Matrix + Liquidity Levels showed its pane but none of the liquidity levels; its levels,
  labels, zones and the stats table now appear on the candles.
- Corner-style labels (label_lower_left, upper_left and so on) sit on the correct side of their point.
- Plots marked display = pane (like the script's invisible scale plots) no longer clutter the read-out.
- Tables at the top-left sit under the read-outs instead of on top of them.

Changed
- Heavy scripts re-run less often on live prices (every 2 s, or four times their run time if longer)
  so the page stays smooth; every new bar still re-runs them straight away.

## v0.8.1 — 30 Oct 2026 — BE label always readable

Fixed
- When the stop sits a few ticks from the entry (for example at BE), its label was hidden under the
  position bar. The bar now slides just above or below the stop line, so the "BE · exit here nets …"
  label stays readable. The Entry tag on the price scale still marks the exact entry.

## v0.8.0 — 30 Oct 2026 — Pine Editor and your own Pine Script indicators

Added
- Pine Editor (Pine button above the chart): a code editor docked under the chart, like TradingView's.
  Syntax colouring, line numbers, bracket matching, Ctrl+/ to comment, Ctrl+F to find.
  - Checks your code as you type: errors show with their line number (click to jump there), and the
    line is marked red.
  - New, Open, Save (Ctrl+S), Save as, rename (edit the name and Save), Delete.
  - Add to chart (Ctrl+Enter). Once a script is on the chart the button reads "Update on chart", and
    saving a script updates it on the chart straight away.
  - log.info() output shows under the editor. Drag the editor's top edge to resize it.
- Your scripts are saved on the server, so every device has the same library. ƒx → "My scripts"
  lists them: + Add puts one on the chart, { } opens it in the editor.
- Pine scripts on the chart:
  - overlay=true scripts draw on the candles; the others get their own pane.
  - plot (line, step line, line break, circles, cross, histogram, columns, area), hline, fill,
    bgcolor, barcolor, plotshape, plotchar, plotarrow and plotcandle.
  - Drawings: label, line, box, linefill, polyline; tables over the chart.
  - request.security() for other timeframes, built from Fyers candles the same way as the chart.
  - Times (hour, minute, sessions) are in Indian time, like TradingView with an MCX/NSE chart.
  - Each script's read-out shows its values for the bar under the cursor, with ⚙ inputs, { } source
    and ✕ remove. Errors show in red in the read-out.
  - ⚙ opens the script's inputs (numbers, true/false, lists, sources, colours, timeframes, text),
    grouped as in the script. Changes apply at once and are saved per chart indicator.
  - Scripts see the latest 1,500 bars and update with live prices (on each new bar, otherwise at most
    every 2 seconds).
  - A script stuck in an endless loop is stopped with an error, without freezing the page.

Fixed
- Paper targets and limit orders now fill when a trade goes through their price, even if the bid / ask
  never touched it. A real resting limit order would have been filled first. A trade exactly at your
  price still doesn't fill it, as orders may be ahead of you in the queue. Fills are at your price.
- Spikes between two live snapshots: when the day's low (or high) moves past a target or limit
  between snapshots, that trade happened, so the order fills.
- Indicator panes are sized together, so adding a pane no longer squeezes the one above it to a sliver.

Changed
- BE line label now leads with what you get there: "BE · exit here nets +₹0 · 13 ticks below entry
  pay the ₹51.60 charges".
- Position bar shows the entry price ("SHORT 4 @ 13,993"), and the entry line is labelled Entry.

Notes
- Pine Script runs on PineTS 0.13.1 (AGPL-3.0) and the editor on CodeMirror 5.65.18 (MIT). Both are
  bundled in web/vendor with their licences. PineTS covers most of Pine v5/v6 but not all of it; if one
  of your scripts errors or draws differently from TradingView, send it to me.

## v0.7.1 — 30 Oct 2026 — Indicator panes easier to read

Changed
- Indicator panes have a shaded background and a brighter divider, so they no longer look like part of
  the candle chart (the divider turns blue when you hover it to resize)

Added
- Read-outs at the top-left of each pane: the candle pane shows open, high, low, close, change and
  volume; the Volume pane shows the volume and its moving average. Point at any bar to see that bar's
  values; move off the chart and they show the latest bar
- Volumes in read-outs use K / L / Cr for thousands, lakhs and crores

## v0.7.0 — 30 Oct 2026 — Indicators menu, Volume indicator

Added
- Indicators menu (ƒx above the chart): add, set up and remove indicators. Each indicator gets its own
  pane below the candles; drag the divider to resize it (the height is remembered). Your indicators
  are saved with your preferences, so every device shows the same set
- Volume indicator: volume bars in their own pane with an optional moving average (on / off, length,
  colour). This replaces the volume pane that v0.6.0 put in Chart settings
- This is the menu your Pine Script indicators will plug into next

Changed
- Chart settings → "Volume under candles" is back: the volume strip at the bottom of the candle pane,
  on / off with the tick box (as in v0.5.x)
- The bid / ask text in the top bar gives way first when space is short, so more timeframe buttons stay visible

Fixed
- Clicking inside a menu above the chart could close it while you were still using it

## v0.6.1 — 30 Oct 2026 — BUY / SELL button position

Added
- Chart settings (⚙) → BUY / SELL buttons: put them in any corner of the candle pane (top left,
  top right, bottom left, bottom right) with an X and Y offset in pixels. Right-hand corners stay
  clear of the price scale; bottom corners sit on the candle pane, above the volume pane. Saved with
  your preferences

Fixed
- In a crowded top bar the symbol could scroll out of view and the ⚙ / Panel / ⛶ buttons could be
  pushed under the panel. They now always stay visible; timeframe buttons that don't fit are hidden
  (all of them are under ▾)
- On 1D / 1W / 1M the countdown tag on the price scale wrapped onto two lines

## v0.6.0 — 30 Oct 2026 — Volume pane (chart library upgrade)

Changed
- Chart library upgraded from Lightweight Charts 4.2 to 5.2.1, which has real panes - the foundation
  for indicators in their own panes later
- Volume now has its own pane under the candles, with its own scale and the latest bar's value on it.
  Drag the divider to make it taller or shorter; the height is remembered. On / off in Chart settings (⚙)
- Candles use the full height of the top pane again (the volume strip no longer shares it)

## v0.5.3 — 30 Oct 2026 — Candle timer easier to see

Changed
- The countdown now sits right next to the price in the chart's top bar ("⏱ 1:42") so it's never cut
  off when the bar is crowded
- The countdown on the price scale is a bold blue tag instead of a small grey one

Fixed
- For the first second after opening a chart, the price-scale countdown could be placed off the edge

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
