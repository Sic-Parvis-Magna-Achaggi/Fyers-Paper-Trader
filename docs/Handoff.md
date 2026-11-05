# Handoff: where the project stands (for a new chat)

Updated 5 Nov 2026, version **0.31.0**. Read this, `docs/Roadmap.md` (the task list: what's next, with the agreed
live-mode design, and what's done), `CHANGELOG.md` (what's done) and `docs/Paper_Trading_Guide.md` (how the app behaves).

## Getting the code

The repo is `Sic-Parvis-Magna-Achaggi/Fyers-Paper-Trader` (private). The owner uploads release zips by dragging the
folder's contents into GitHub; the server pulls every minute. Always start from the latest commit in the repo, not
an old zip. The owner releases with `tools/github_upload.html` (Release to GitHub, v0.26.1): a single page opened from disk; with his
fine-grained token (resource owner the Sic-Parvis-Magna-Achaggi organization, this repo, Contents: Read and write; the
organization must allow fine-grained tokens; an owner's own tokens need no approval; steps in README) it reads the zip in the browser, compares git blob ids with the
branch's tree, sends only changed files as blobs and makes ONE commit (fast-forward only; deletes only if ticked; warns on
an older VERSION). GitHub's web upload takes at most 100 files (the repo has 110), so dragging is only the fallback (two
drags: `tests/`, `docs/`, `server/`, `tools/` + top files; then `helper/`, `web/`). Every release is the full repo zip. A new
chat starts from GitHub's Code › Download ZIP of the latest commit. Every release: changelog text, a one-line commit message, the version number; VERSION and CHANGELOG.md
updated; `tests/routes_check.py` passes; the guide updated when behaviour changes; the project copies of the guide
and roadmap updated too.

## How the code is laid out (v0.20; drawings: see "Drawing tools and the measure" below)

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
- `helper/feedcheck.py`: the order-flow check (`FC`): records the admin's feed snapshots for chosen contracts
  (`data/feedcheck/`), counts exact / merged trades; hooked in `rt.py` (admin's on_tick, watch_symbols).
- `web/ctype.js`: chart types (Heikin-Ashi, Renko, range bars, line break, Point & Figure...) as pure functions, tested in Node.
  In `web/index.html` the chart keeps `RAW` (the real candles, from history and live ticks) and `DISP` (what's shown,
  `CT.transform(RAW)`); `dispSet()` draws all of it, `dispLive()` only what a tick changed. Everything that reads
  the chart's bars (Volume, indicators, Pine via `dispBars()`, the legend) uses `DISP`; prices and trade lines are
  real. `dispTimeAt(t)` maps a real time to the bar it falls in (Renko etc.).
- `web/vendor/lightweight-charts.standalone.production.js` is 5.2.1 with one patch (the histogram hover guard,
  noted at the top of the file): keep it if the library is ever updated, unless the new version fixes the bug.
- `web/index.html` (main page and chart), `web/paper.js` (ticket, chart tool, positions), `web/pages.js` (Trades,
  History, Book, Account, Log pages), `web/pine.js` + `web/pine_worker.js` (Pine Script, PineTS), `web/indset.js`
  (every indicator's settings dialog: Inputs / Style / Visibility; `indVisOn()` decides visibility by timeframe),
  `web/pine_libs/` (Pine libraries built into the app: `TradingView_ta.pine`), `web/security.js`
  (login gates, 2FA set-up, step-up, Security and Users settings, account switcher), `web/live.js` (LIVE badge, KILL,
  live warnings, the Fyers stop on each position, the Live card, the Paper <-> Live dialog; it wraps paperUpdate,
  renderPlan, pgPositions and pgAccount).
- `web/mobile.js` + `web/mobile.css`: the phone layout (body class `mob`, chosen by `mWant()`: width <= 760 or a
  touch screen under 500 px, or the `ftm.layout` override in localStorage). Loaded after the page's inline script; it
  wraps onTick, openSymbol, feedPill, setFull, pgShow, openDrawer, refreshState, paperUpdate, renderTicket and
  renderPlan. It adds its own shell (`#mob`: top bar, SELL / BUY bar, chips, tabs, screens, one bottom sheet), moves
  the `<aside>` into the Quotes tab, and hides the desktop header / panel. The order sheet never keeps its own
  ticket state: it sets the desktop ticket's inputs and fires their change events, or clicks its buttons, so
  `paper.js` stays the only ticket logic. CSS for it lives only under `body.mob` / `#mob`.
  v0.20.3: the ticket sheet can shrink to a bubble (`M.min`, `mMin()`, `mBubFill()`; body class `tkmin` hides `#mBar`
  and shows `#mBub` in its slot, so the chart's size never changes). A pointerdown on `#chart` while the sheet is up
  shrinks it; pref `mobTicket` ("full" / "bubble") is what SELL / BUY open.
- `helper/jshots.py` + `web/jshots.js`: the journal's pictures and their Telegram copy (v0.27.0, section below).
- `web/jinsights.js`: the journal's Insights, weekly review, walk-through, calendar, Copy for Gemini, export (v0.28.0).
- `tests/`: the test kit (fake Fyers feed and order API, route check, engine tests incl. `live_test.py`, browser
  tests incl. `live_flow.js` and `mobile_flow.js`). See `tests/README.md`.

Test kit (v0.28.1): `mock_server.py` adds the response headers in `server/Caddyfile`'s `header` block (as Caddy does),
so a header that breaks something (the grid's frames under `X-Frame-Options DENY`) fails the browser tests too. When
changing the Caddyfile, re-run `multichart_flow.js`.

Test data (1 Nov): many runs on one data folder in one day pile up losing paper trades in today's journal session, and
the journal's 2% lockout then refuses the tests' orders (journal_flow, live_flow, then everything after live_flow leaves
the account Live). Start from fresh data (make_old_data.py + security_flow.js) when that happens.
`drawings_flow.js`'s "a drag on the new trade's SL line moves the SL" failed once in 4 runs (1 Nov, v0.28.1). Same advice.

Test-kit quirk (1 Nov): `navigation_flow.js`'s "Go to a date on 1D" check fails some runs (landed a day late; 2 of 5
runs on 1 Nov, on v0.20.2 code too). Cause not found; it's a test-kit issue so far (the mock stamps day candles at
00:00 UTC, real Fyers at IST midnight). Re-run it if it fails; worth a proper look when touching Go to.
`live_flow.js`'s "history: the trade, closed by the kill switch" failed once in 4 runs on 1 Nov (passed on re-run):
probably the history read before the kill switch's close was booked. Same advice.
`jinsights_flow.js`'s three Copy for Gemini checks (today / this week) fail when run between midnight and the account's
reset hour (2 Nov, 01:00 IST: trades belong to the previous trading day, Gemini's "today" is the calendar day). Run it in
the daytime. (Roadmap follow-up.)
`replay_flow.js` turns the mock's round-the-clock candles on (`/_mock/allday`) and off at the end; it sets the journal's
automatic pictures off itself (other suites turn them on).
`indicator_settings_flow.js`'s "at the start of a contract's history it stops asking" failed once in 2 runs on 1 Nov
(v0.22.0; passed on re-run, 37/37). Same advice.

## Servers: the owner's and new ones (v0.31.0, roadmap 14)

- **Each server's own settings:** `/etc/fyers/server.conf` (not in Git): `FYERS_HOST`, `FYERS_OUT_IP`, `FYERS_BRANCH`,
  `FYERS_REPO`, `FYERS_PYTHON`.
  - **`server/serverconf.sh`** (sourced by install.sh and update.sh) reads the file as data, never sourced: known keys,
    validated values. `conf_resolve` fills gaps in this order: environment > file > Caddyfile's address > DigitalOcean
    reserved IP (metadata) > public IP (`FYERS_IPLOOKUP`: ipify, ifconfig.me, icanhazip; then the route's source
    address if public) as `<ip>.sslip.io`. The outgoing IP is the public IP lookup.
  - **Strict shell:** must stay safe under `set -euo pipefail` (a failing `grep` in a `$(...)` once stopped install.sh
    silently).
  - **`install.sh`** writes the file (`conf_write`) and uses `C_HOST` for the Caddyfile. It has no fallback address any
    more.
  - **The helper** gets the values through `EnvironmentFile=-/etc/fyers/server.conf` in `fyers-helper.service`.
    `/api/state` gives `server.out_ip` (logged in only), which `web/live.js`'s Turn on LIVE dialog shows; without it,
    general wording.
- **`server/update.sh`:** follows `origin/$FYERS_BRANCH` when set (`rev-parse --verify`; a missing branch takes nothing),
  else `origin/HEAD`.
- **`server/startup.sh`:** a new server, any Linux with systemd, apt or dnf. User data or `sudo bash startup.sh
  owner/name [branch] [host]`.
  - **Installs:** packages, a Python 3.10+, Caddy (cloudsmith repo / distro / copr / GitHub download), the firewall
    (ufw with the live SSH ports, firewalld, or Oracle's netfilter-persistent rules), swap if under 2 GB and none, IST,
    the `helper` user and its deploy key.
  - **Then:** writes `/etc/fyers/server.conf` (repo, branch, host, python) and three things of its own (heredocs inside
    startup.sh, so they exist before the repo can be cloned):
    - `/usr/local/sbin/fyers-firstinstall` + `fyers-firstinstall.timer` (every 30 s: `git ls-remote` with the key; once
      accepted, clone (as helper, `-b` the branch) and `install.sh`, then the timer switches itself off; a failed
      install is retried);
    - `/usr/local/bin/fyers-status` (states in `/var/lib/fyers-setup/state`: booting, bootfailed, waiting, installing,
      failed, done; `--wait` redraws only when the step changes);
    - `/etc/profile.d/zz-fyers-status.sh` (root sees the status at login; sudo users a one-line hint).
  - **By hand:** a run over SSH ends in `fyers-status --wait`.
- **The owner's server:** unchanged by startup.sh (it only runs on new servers). Its first update to v0.31.0 wrote its
  server.conf (address kept from the Caddyfile; outgoing IP looked up, expected 134.209.159.171).
- **Tests:**
  - `tests/server_conf_test.sh` (safe anywhere).
  - `tests/server_flow.sh` (a throwaway container only: it creates the helper user).
  - `live_flow.js` with and without `FYERS_OUT_IP`.
  - Not tested: a real boot at a provider (cloud-init, real systemd, Caddy's certificate, firewalld / SELinux on a
    RHEL-family server). The friend's first boot is the first real run (roadmap 14's open item).
- **User-facing steps:** `docs/New_Server_Guide.md`: the 3 ways to get the code (the owner's repo with a second deploy
  key, a fork + Sync fork, or an own copy filled with `tools/github_upload.html`), providers' start-up boxes and
  firewalls, `stable` for the owner, backups, troubleshooting.

## Indicator read-outs (v0.30.3)

`legendFill()` (index.html) builds each `.lgd.lind` row as chevron + `.lname` + `.lacts` (eye, ⚙, { }, ✕) + `.lvals`.
The buttons sit after the name (TradingView's order) and use `visibility` (not `display`) so their space is kept and
nothing reflows on hover; `@media (hover:none)` shows them. `legendPlace()` (also every second) sets each row's
`max-width` to the chart width minus the right price scale and the row's left offset; `.lgd.lind` wraps
(`white-space: normal`; `.lname` / `.lacts` stay on one line). `legendFill` re-runs `legendPlace` when a candle-pane row's
height changes (wrapping), so rows on the candles never overlap. Test: `tests/legend_flow.js`.

## Trade replay (v0.29.0, roadmap 4c)

- **Server, `helper/jreplay.py`.** `note_order(uid, aid, b)` (from `/api/paper/place`, before `engine.place`; dropped again
  on a refusal: `drop_pending`) keeps the PLACE body's `setup` (the chart keys `KEYS` = cur, tf2, ctype, chart, indicators,
  lgdMin0, as layouts hold them; `clean_setup`, 300 KB at most) and `from` {lay, cell} in `replay/pending.json` under
  "aid|contract|product" (10 days). `capture(urt, key, ph, t)` is called from `journal.on_trade` right before
  `jshots.phase` (entry / exit): entry = the pending set-up (`src` "order") else `_from_layouts` (the {lay, cell} asked, the
  active layout's chart of the contract, other layouts', prefs if they show it, else the active chart's set-up on this
  contract = "other"); exit = the entry's layout chart if it still shows the contract, else the same search, else the
  entry's chart ("entry"). `snapshot()` adds every saved script as {id, name, h} (code in `replay/code/<sha1>.json`) and
  the contract's drawings (`replay/draw/<sha1>.json`); written to `replay/t/<key file>.json` {entry, exit};
  `replay/index.json` lists recorded trades (`recorded()`, the journal's `row.replay`). `full()` puts code / drawings back.
- **The stop's path:** `Paper._path_scan()` runs at the start of every `save()`: each position's `path` = [[t, sl, tp,
  kind]], a point added whenever (sl, tp) differ from the last; kind from `pos["_pk"]` (set in `_set_be` "be", the trail
  "trail", an add "add"; anything else "edit"), popped before saving. `close()` puts the path (plus a last point if needed)
  on the history record; `LiveEngine._split` gives the part its own copy. `Journal.ingest_close` keeps the longest path on
  the trade, `upsert_open` the open one; `view()` leaves `path` out of the list. `trade_path()`: "recorded", else
  `log_path()` from `engine.events` (messages "<short>: stop to break-even + costs X", "stop now X", "SL X, TP Y" between
  opened and closed; "log" / "log-part"), else "ends".
- **Routes:** `GET /api/journal/replay?id=` (syncs the journal if the trade isn't there yet) -> `jreplay.view()` {trade facts,
  closes, path, path_src, be (`charges.breakeven` like the engine), row, setup {entry, exit} in full}; `POST
  /api/journal/replay/net` {id, pts [[t, p]] <= 5000} -> net ₹ (`net_series`: entries up to t, closes up to t, the rest at p
  with its share of the entry charges) and R (net / init_risk).
- **Page, `web/replay.js` + `web/replay.css`** (after jinsights.js, before mobile.js). Every page: `papi("place")` gets
  `setup` (prefGet of the chart keys: in a grid frame that's the frame's own chart) and `from`. Main page: `rpOpen(key, ph)` /
  `rpClose()`; `#rpWrap` iframe `/?replay=<key>&ph=&code=`; `rpKeyOf(h)` = ACCT + ":" + base id; postMessage {rp: "close"}.
  journal.js card button `data-act="replay"`; pages.js History detail `.rp-open`; mobile.js History detail `.mrp`.
- **The replay frame** (`window.FTM_REPLAY`, set in index.html's head script; html classes `cell replay` = chart only):
  `loadPrefs` wrapped to fetch the replay and set `RP.C` (the snapshot's chart, or the current chart keys with the trade's
  contract); `prefGet` / `prefSet` for chart keys live in `RP.C`, other prefs only in `PREF` (nothing to the server or
  localStorage); `connectWS`, `dataCheck` off; `paperUpdate` sees no positions / orders; `arm` refused; `pineLoad` returns
  the snapshot's scripts ("Pine as recorded"); `drSymbol` loads the snapshot's drawings (locked) + the trade itself as a
  drawing of type `rptrade` (`DT.rptrade.geom`; `drHit` ignores it); `drSaveSoon/Now` no-ops; layouts.js, mobile.js and
  jshots.js skip themselves when `FTM_REPLAY` is set. `DrawPrim.prototype.autoscaleInfo` takes the trade's prices into the
  price scale. `loadHistory` replaced: `/api/history` back to the trade's opening + `histDays()` (asked again up to 8 times as
  the server reaches further back), `renderCandles`, `rpFrame()` (trade in view).
- **▶ Play:** `rpPrepare()` (start 30 candles before the entry's, end 15 after the exit's or now; sub-candles `subResFor`: 1m
  up to 1h charts, 5m for 2h-4h, 15m for D/W/M, via `/api/history`; `RP.steps` = each sub-candle's end), `rowsAt(T)` (Fyers
  rows closed by T + the forming row built from sub-candles), `rpSeek(T)` (full redraw, `showRaw`), `rpStepTo(T)` (one step:
  RAW replaced, `dispLive()` - the live path, so Pine updates its live bar and re-runs on a new bar), `rpNextBar`, `rpJump`
  (first step at or after the fill / close), `rpStop`. `pineNeed` wrapped (other-timeframe candles cut at T, the forming one
  rebuilt from the chart's bars, another contract's forming one dropped), `pineBar` (a non-time chart's last bar closes at T).
  `rpNetLoad()` asks the server for the net at each step's close. `window.rpTest` is for the tests.
- **Item 10:** replays get candles only through `/api/history`; when item 10 patches that route with recorded live candles,
  replays follow. Not seen for real yet: a replay on real Fyers candles (the mock's live prices and its candles differ, so
  test trades sit off their candles).

## Journal: Insights, review, Gemini, export (v0.28.0, roadmap item 4: last of three releases)

- `web/jinsights.js` (after jshots.js), all computed in the page from `JN.d` (the server's trades with their audit and
  sessions): `jiInsights()` (the Insights tab; `jFiltered({ignoreOct: true})`; `jiPerf()` = Octagon's advancedStats on net
  ₹, daily returns over the account size(s) in view), `jiReview()` / `jiWeek()` / `jiCalendar()` (`JI.rv`; mode in prefs
  `jn.rvMode`; weeks by close day IST, `jiWeekStart`), `jiWalk()` (`#jiWalk`, saves reflections through
  `/api/journal/trade` {rvRight, rvWrong, review}), `jiAiOpen()` / `jiAiText()` (Copy for Gemini, by trading day `t.day`
  and session `t.skey`), `jiDataCard()` (Settings: CSV, backup, restore). Hooks: wraps `jnSettings`, `jnToday` (the focus).
  journal.js: tabs trades / insights / review / settings; `jnTrades()` hands the insights tab to `jiInsights`; `jnRender()`
  the review tab to `jiReview`; list action `ai`.
- Server: `Journal.set_review(week, b)` (Monday only; well / broke / focus / focusKept), `set_review_msg`; `jshots.tg_review()`
  posts the summary (text made by the page) to the journal's chat and edits it in place (`reviews[week].msg`); `csv_text()`,
  `backup_zip(path)` (journal.json + pictures/), `restore(path)` (adds only what's missing; picture files only with a
  matching id / type; logged in the security log). Routes `/api/journal/review`, `/export.csv`, `/backup.zip`, `/restore`
  (streamed to `data/tmp/`, 500 MB at most).
- 4c became the trade replay (v0.29.0, above); the hidden-browser picture idea was dropped.

## Journal pictures (v0.27.0, roadmap item 4: second of three releases)

- `helper/jshots.py`: a trade's pictures are `t["shots"]` in journal.json = [{id, kind server / chart / upload, phase entry /
  exit / None, tf label, src, at, w, h, bytes, ext, name, tg}], files `u/<user>/jshots/<trade key>/<id>.<ext>` (+ `<id>_t.jpg`
  thumbnails, made on first request). Settings: journal `settings.shots` = `jshots.DEFAULTS` {auto, res, bars, chart, tg,
  tg_chat, tg_since}; `clean_cfg()` validates; `tg_since` is stamped when the backup is turned on / its chat changes.
- **One worker thread** (`queue(job, delay)`, a heap; jobs `("draw", uid, key, phase, manual[, tries])`, `("tg", uid, key, sid,
  tries)`, `("tgdel", uid, chat, msg)`) does the slow parts one at a time. Journal saves now take `Journal.lock` (the worker
  changes trades); the worker deep-copies a trade under the lock before reading it.
- **Automatic pictures are off since v0.29.0** (`DEFAULTS` auto / chart False; `cfg()` switches settings saved before it off
  once, `clean_cfg()` marks `v29` so turning them on again sticks).
- **Entry / exit:** `journal.on_trade` sees a new trade ("open", none before) -> `jshots.phase(urt, key, "entry")`; a close that
  makes it "closed" -> "exit". `phase()` queues the server drawing (DELAY 3 s) and broadcasts `{"jshot": {id, phase, s, acct}}`
  on the user's sockets. Backfilled trades get nothing automatic (Draw at entry / exit by hand: `/api/journal/shot/draw`).
- **Server drawing:** `candles_for()` = `candles.get(urt.link, s, res, days)` (the user's own Fyers budget; falls back to
  `candles.saved()`); `render()` (Pillow, 1280×720, fonts in `helper/fonts/`, DejaVu Sans Mono with ₹). A failure ->
  `t["shot_err"][phase]`, retried at 2 and 4 min. Stop on the underlying (`basis` != self): no SL / TP lines.
- **Browser:** `web/jshots.js` (after journal.js): `jsStrip(t)` (card and audit form), `jsAct` (journal.js's list click and the
  form delegate to it), uploads / paste / drop (`jsUpload`: raw body to `/api/journal/shot/add?id&tf&kind=upload&name`),
  the viewer (`jsView`, `#jsView`), `jsShotReq(m)` (index.html's socket handler: a page whose `cur.s` is the contract and whose
  chart is on screen - not the outer page of a grid - waits 1.5 s, `chart.takeScreenshot(true)` + a header band, sends
  kind=chart; the server keeps one per (phase, tf) and answers others `dup`), `jsSnap` (📷 `#bSnap`, before ⛶; not in grid
  frames), `jsSettings` (wraps `jnSettings`: the Pictures card).
- **Telegram:** `send_file()` (multipart sendDocument, stdlib), caption HTML; message id kept in `sh.tg`; delete ->
  `deleteMessage`. Uses `telegram.load(uid)`'s bot (Settings › Telegram alerts is admin-only, so effectively the admin only).
  `tg_journal.json` keeps the last send / error. Start-up (`jshots.startup`) re-queues unsent pictures since `tg_since`.
- Not seen for real yet: the server's picture on real Fyers candles (the forming candle at entry: the mock's history stops at
  the last finished candle, so its marker sits just past the candles); a real Telegram channel taking documents and deletes.
- Pillow: added to requirements.txt; `update.sh` runs `install.sh`, which pip-installs it. Without it, drawing answers "Pillow
  isn't installed" and Settings › Pictures says so.

## The journal (v0.26.0, roadmap item 4: first of three releases)

- `helper/journal.py`: the Octagon port. `Journal(uid)` per user (`journal.get(uid)`), file `u/<user>/journal.json` =
  {trades: {"<acct>:<pos id>": trade}, settings: {rules, pillars, p1}, practice, reviews, ended, hidden, synced}. A trade =
  the engine's facts (s, side, product, lots, qty, entries, avg, exit, opened, closed, first_sl, sl, tp, gross, charges, net,
  init_risk, r, planned_r, balance_after, day, base = account size, status open / closed / removed, parts / closes) + the
  annotations (direction, wait, execution, zen, target, regime, bias, ke, p1Checks, execFaults, numberRunning,
  payoutPressure, setup, notes, review, claimedAt...). Live parts (`P...p1`) merge into the base id (`base_id()`).
- How trades arrive: `Paper._jn()` at the end of `fill()` ("open") and `close()` ("close"); rt wires `journal_hook`,
  `journal_guard`, `journal_lock` on every engine. `sync(urt, full)` reads the engines' history and open positions; `full`
  (start-up in `rt.start`, and the first time) also archived accounts and `paper_trades_until_*.json` (marked claimed). An
  open trade whose position disappeared without a close (a reset) becomes "removed".
- The audit: `metrics()`, `session_engine()`, `audit_trade()`, `compute_audit()` are line-by-line ports of Octagon's
  `metrics / sessionEngine / auditTrade / computeAudit`, in seconds and IST; R / planned R are the app's net figures.
  `tests/journal_test.py` runs Octagon's own JS (`tests/fixtures/octagon_core.js`, extracted from octagon_journal.html) on
  the same random trades and compares every pillar and session figure: keep it passing when touching the audit.
- One source of truth: the server computes the audit and sessions; the page only shows them (`POST /api/journal/audit`
  previews an edit for the form, nothing saved). Edits answer with the trades of the affected session (`view(only=...)`);
  the page merges (`jnMerge`).
- Lockouts: `today_state(aid, day)` -> lock {kind dd / afk / end, on (switch), until, text}; `lock_reason()` is what
  `Paper.guard_new` returns (so plan / preview / PLACE refuse with it); `check_lock(urt, aid, before)` after a close, an
  annotation, a settings change or `/api/journal/end` cancels waiting entry orders when a lock starts (switch
  `cancel_pending`; on the event loop). The snapshot carries `jlock` (header pill `#pJLock`).
- `journal.on_change` -> app `_journal_changed` -> `{"journal": 1}` on the user's sockets -> page `jnPush()` reloads.
- Page: `web/journal.js` + `web/journal.css` (loaded before mobile.js). `JN` state; `jnShow()` (pgShow wrapper), Trades
  (`jnReps`, `jnToday`, `jnGoal`, strip, `jCard`), the audit form (`jnForm`, a modal), Settings (`jnSettings`). Filters in
  prefs `jn`. Never rebuild under a held button (`JN.holding`: a rebuild cancelled holds in testing). The phone: a row
  added to More (wraps `mMore`).
- v0.27.0 (pictures + Telegram backup) and v0.28.0 (Insights, review, Gemini, export) shipped, see above: the Octagon port
  is complete. 4b (prop-firm journals) and 4c (full-layout pictures from a hidden browser) wait for the owner's yes.

## Telegram alerts (v0.25.0)

- `helper/telegram.py`: per-user bot settings `u/<user>/telegram.json` = {token (sealed), bot, chat, chat_title, alerts,
  hc: {url, key (sealed)}, link}; `call()` / `send()` (stdlib urllib, `TELEGRAM_API` env for tests); `send_user(uid, text,
  silent, who)` records its last send / error in `u/<user>/tg_<who>.json` (one file per process, so helper and watchdog
  never rewrite each other's file); `trade_lines()`, `market_open(sym, t)` (weekdays; MCX 09:00-23:30 / 23:55 US summer,
  currency 09:00-17:00, the rest 09:15-15:30; no holidays).
- `helper/alerts.py` (in the helper, every 5 s from app.py's `_engine_loop` via `alerts.tick`): `heartbeat()` writes
  `watch.json` (live accounts with positions / orders, per user); `check()` sends live warnings (`LiveEngine.live_problems()`
  keys; "stream" and "halted" skipped; nostop states waiting for the market / expired / no login skipped) after `warn_sec`,
  and "no prices" (`feed.last_at` older than `feed_sec`, in market hours, ticked earlier that day); "Sorted" when it clears.
  State is in memory (`_state`): a helper restart re-sends a still-open problem after its wait.
- `helper/watchdog.py` = `fyers-watchdog.service` (venv python, user helper). Every 5 s (5 s while down too): GET
  `/api/ping` (5 s timeout) + `watch.json` age (> 30 s = "background work stopped"). Down `down_sec` with live trades in the
  last heartbeat -> message per user, reminders every `repeat_min`, "answering again". Silent outside market hours.
  Outside heartbeat (`_hc`): pings the URL every 60 s while that user has a live trade (always, without an API key or a
  UUID URL); flat with a key -> `POST <api>/api/v3/checks/<uuid>/pause` once (a ping un-pauses). Writes `watchdog.json`
  (the page shows running / not, and its hc state).
- Page: `web/tgalerts.js` (Settings › Telegram alerts, `#tgSec`, admin only; wraps `secRender` and `liveCard`).
- On the real server (owner, 1 Nov): deployed, bot set up, the test message arrived, "Watchdog: running" (so the service
  installed through `install.sh` and the droplet reaches Telegram). Not yet seen for real: an outage message during a live
  trade; Healthchecks.io's real pause API (written to its docs: `POST /api/v3/checks/<uuid>/pause`, `X-Api-Key`).

## Live candles, watchlists, seconds (agreed 1 Nov, roadmap 10-12)

Design for item 10 is agreed (see the roadmap; its original reason, a day "rewritten" by Fyers, turned out to be the
continuous series, fixed in v0.30.1 - the owner was asked on 2 Nov whether item 10 still comes next): server-side 1-minute candles from the live feed for every watchlist,
positions / orders and open charts; used for a day only when the data check fails and the recording has no gaps; kept
1 year by default (settable). Today the server streams without a browser only `rt.watch_symbols()` (positions / orders,
plus the order-flow check's contracts for the admin); browsers add theirs through `feed.want()` (20 a page). Fyers
Standard: **100 contracts** on the data socket (5,000 on Prime); seconds history (5S-45S) is Prime-only, 30 trading
days. Item 11 (multiple watchlists) comes right after item 10; item 12 (seconds / tick charts) is decided after
Monday's order-flow check.

## Multi-charts (v0.24.0)

- `web/multichart.js` + `web/multichart.css`, loaded after layouts.js. A layout has `grid` ("1", "2v", "2h", "3", "4" =
  `MC_GRIDS`), `charts[]` and `sync` ({cross}). **Desktop grid = frames:** each chart is this same page loaded as
  `/?cell=N` (`window.FTM_CELL`, `html.cell`: chart and its bar only), so all the single-chart code runs unchanged per
  chart. Why: everything (index.html, paper.js, pine.js, draw.js, indset.js) lives on one set of globals - one chart per
  page; a real multi-instance refactor would touch nearly every line.
- **A frame** (`cellMode()`): its set-up lives in `charts[N]`, not the shared prefs - `prefGet` / `prefSet` overridden for
  `MC_CELL_KEYS` (cur, tf2, ctype, chart, indicators, lgdMin0) and the drawing toolbar's `tb`; changes go to the page
  around with `mcCellSet(N, state)` (150 ms). It streams only its contract (`sendWant`), sends toasts up (deduped), marks
  itself active on pointerdown (`mcActive`), sends its crosshair (`mcCross`), tells the others when it saved drawings
  (`mcDrawn` -> `cellDrawReload`), and exposes `cellAddPine`, `cellScripts`, `cellCrossShow/Clear`, `cellInfo()` (tests:
  let-variables like `cur` / `DISP` aren't window properties, so the page around reads them through it).
- **The page around** (`mcRender`): `body.multi`, its own chart hidden (still loaded with charts[0]), `#mcGrid` of
  `.mc-cell > iframe`. Wrapped while a grid is on: `openSymbol` (-> active frame), `arm` (BUY / SELL -> active frame),
  `peAdd` / `peSave` (Pine -> active frame / all frames), `acctSwitch`, `applyTheme`, `toast` (dedupe 3 s). layouts.js:
  `layTouch` does nothing on a desktop grid (the frames report), `LAY.cell` = the active chart; `layApplyChart(c)`.
- **Phone:** no frames. The page's own chart shows `charts[LAY.cell]` (`mcPhoneCell(k)` applies it); `layTouch` saves into
  that index. The body class `mob` switching on / off re-renders (MutationObserver).
- boot() now waits for DOMContentLoaded before `loadPrefs()` (so a frame never starts with the shared prefs: its
  overrides are in place first).
- Sync (v0.24.1), `L.sync` = {cross, sym, tf, range}: contract - the page's `openSymbol` wrapper opens on every frame;
  timeframe - a frame's `setTf` wrapper calls `mcTf` (frames get `cellSetTf`, which doesn't relay back); date range - a
  frame's `subscribeVisibleTimeRangeChange` while the mouse is on it -> `mcRange` -> others `cellRange` (setVisibleRange;
  a frame with the mouse on it ignores relays). Ticking one: `mcLineUp(k)` from the active chart. Phone: `mcAfterTouch`
  (called from `layTouch` / `laySave`) copies cur / tf2 into the layout's other charts. A chart click in a frame closes
  the page's popovers (`mcActive`: frames' clicks never reach the page's own "click outside" handlers).

## Layouts (v0.23.0)

- `web/layouts.js` (loaded after drawui.js, before mobile.js), CSS `#layPick` / `#bLay` in index.html, server
  `/api/layouts` (`u/<user>/layouts.json` = {layouts: [{id, name, grid: "1", charts: [chart], updated}], active}; ops
  put / del / active, one layout at a time). A chart = `layNow()`: prefs `cur`, `tf2`, `ctype`, `chart`, `indicators`,
  `lgdMin0` (`LAY_KEYS`) + `tb` (drawing toolbar). `charts` is a list so multi-charts (item 6) add charts[1..] and `grid`.
- `prefSet` is wrapped: a change to one of those keys (or `draw.tb`) calls `layTouch()` -> the open layout (900 ms debounce,
  `layFlush`). By hand (pref `layAuto` false): `LAY.dirty` (● on the button; `layEq` against the saved chart), Save /
  Ctrl+S (`laySave`), switching asks first (`guard` in `layRender`).
- `layApply(L)` puts a layout's chart on screen (prefs, `buildChart()`, `openSymbol`) with `LAY.applying` set (no saving
  meanwhile); `layOpen(id)` = apply + send prefs now (`layPrefsNow`) + mark active + touch.
- `layPost` merges the server's answer: the open layout keeps the page's own object (only `name` / `updated` taken), so a
  change made while a save was on its way isn't lost (v0.24.1 fix; `layouts_flow.js` holds saves 1 s to prove it).
- **The saved layout wins, at start-up:** `boot()` (index.html) calls `layBoot()` right after `loadPrefs()`, before the chart is
  built: a chart that disagrees with the open layout takes the layout's set-up straight into the prefs (`layToPrefs`), so
  the chart opens as the layout with nothing rebuilt afterwards. (A first version applied it after the chart had loaded:
  that rebuilt the chart a second or two later and wiped whatever was done meanwhile; three test suites caught it.)
  `layInit()` / `layApply()` is only the late fallback.
  Found in testing: the opposite rule ("the chart wins") copied a layout into another when a page closed right after a
  switch (the active mark reached the server, the prefs didn't). `pagehide` sends what's waiting (fetch keepalive).
- Tests that set chart prefs through `/api/prefs` must delete `layouts.json` (no page open) first, or the layout puts its
  chart back (tests/README.md).
- Note (1 Nov): this release's first draft of layouts.js / the route was found already in the folder when work started
  (an earlier interrupted attempt in the same session); it was reviewed line by line, completed (saving by hand, the
  copy of the chart as shown) and fixed (the load rule above) before release.

## Drawing tools and the measure (v0.22.0)

- `web/draw.js` (engine), `web/drawui.js` (screens), `web/draw.css`. Loaded after the inline script, before mobile.js.
  Hooks: `buildChart()` calls `drAttach()` (attaches `DrawPrim` to the new series; also on chart-type rebuilds);
  drawui.js wraps `openSymbol` (-> `drSymbol(s)`: saves the old contract's drawings, loads the new) and `renderCfg`
  (adds Chart settings › Drawings). State: `DR` (items of the contract on screen, sel, tool, draft, drag, meas).
- A drawing: `{id, type, pts: [{t, p}], st, text, lock, hide, lots}`; t is chart time (epoch + IST, like the bars).
  `t2L(t, free)` / `L2t(L)` map time <-> logical bar index on `DISP` (snapped: the bar holding t, on any timeframe or
  chart type; past the last bar: bars of `drBarSec()`; the brush is `free`, fractional). x = `drView().xL(L)`.
- Tools are `DT[type]` = {name, g (group), n (points; -1 path, -2 brush), st (default style), geom(A), handles,
  axP / axT (axis labels), pos / levels / fill / text / ext flags}. `drGeom()` builds lines / polys / ellipses / text
  boxes / handles once per frame; `drPaint()` draws them and `drHitG()` hit-tests the same geometry (`DR.geo`).
  Adding a tool = one `DT` entry + an icon in `DR_ICONS` + its group in `DR_GROUPS`.
- Events: capture listeners on `#chart`'s parent (mousedown / touchstart run before LWC and paper.js's trade-line drag;
  `drNearTradeLine()` lets the SL / TP / entry lines win). Keyboard: window capture listener in drawui.js.
- Saved: `/api/drawings` (per user, one file per contract under `u/<user>/drawings/`, 500 a contract, 400 KB), whole list
  each save (700 ms debounce). Prefs `draw` = {mag, stay, lockAll, hideAll, tb (toolbar shown, desktop), styles (per-tool
  defaults), last (last tool per group), lots (measure)}. Phone: body class `dtbm` = the strip is open (not saved).
- Net ₹: `drMoney(legs)` batches to `POST /api/measure` (charges.net_at; nothing placed) and caches; labels show "…"
  until it answers. R: `drRefTrade()` (an open position on this contract with a stop on its own price, else the armed
  BUY / SELL tool). Position drawings: `drPosEval()` on `RAW` (real candles), from the candle after the entry to the box's
  end; a candle reaching both levels = "both" (counted as the stop); opened past a level = its open.
- Angles (v0.23.1): style key `ang` on trend / ray / extl / arrow / channel / regr, tool `angle` (always on). `angleGeom()`
  draws the arc and label; `drAngleInfo()` = screen degrees (P&F: boxes / columns) + slope per bar. ∠ on the selection bar.
- Settings dialog (`drSettings(d, tab)`, drawui.js): tabs style / text / lv / xy. Coordinates come from `drCoordDefs(d)`
  (which points have a price, a time, or both); typed IST date + time -> chart time with `drPartsTime()`; `drBarNote()`
  says which bar it lands on. Everything is checked before anything changes.
- After Ctrl+Z, `DR.items` holds new copies: UI handlers look a drawing up by id when clicked (`drFind(id)`), never keep
  the object (a v0.22.0 bug found in testing: 🔒 locked a stale copy).
- Not built (roadmap item 9's last line): Inside pitchfork, Gann square, Fib circles / spiral, Elliott / XABCD,
  per-drawing timeframe visibility, sharing drawings across a future's expiries.

## Watchlists (v0.21.0)

index.html: prefs `wlists` = [{id, name, items: [symbol rows]}] and `wl` (the list on screen); `watch` is that list's
items (other code - sendWant, pages.js - reads `watch`, so it still means "the list on screen"); `wlLoad()` (boot; the
old pref `watch` becomes "Watchlist"), `wlSave()` (also mirrors `watch`), `wlSwitch()`, `renderWlBar()` (switcher,
＋, ⋯ menu, inline name editor). 10 lists x 30.
v0.30.0: a contract's lists. `wlItems(L)` (the list on screen is `watch`, the others `L.items`: always go through it),
`wlHas` / `wlInAny` / `wlPut` (30 cap) / `wlDrop`, `wlChanged()` (save, re-render, stream, chain stars). `wlPick(row,
anchor, from)` is the picker (`#wlPop` + `#wlPopBg`; a bottom sheet under `body.mob`); with `from` (a list id) it adds Move
and Remove. Watchlist rows are wrapped by `wlWrap()` in `.wrow` (swipe actions `.swa` behind the `.row`; touch handlers,
`touch-action: pan-y`; a capture-phase click guard stops a swiped row opening the chart). ⋯ is `.x.m` on the row;
right-click on a row opens the picker. Option chain: header `#chainHead` (`#cU`, `#cExp`, `#cAtm`), strikes scroll in
`#chainBox` (thead sticky); `chainRef` (spot, else future) is streamed via `chainWant()` while the tab is open;
`chainMark()` highlights, `chainToAtm()` scrolls only `#chainBox` (never `scrollIntoView`, which moved the pane);
`chainTick()` scrolls once if the price arrives late and the strikes haven't been scrolled; `chainMarks()` sets ＋ / ★. Feed: `want()` 40 a page; `wanted()` puts `extra()` (trades / orders,
order-flow check) first, then the rest, cut at 95; `_poll()` batches quotes by 50. Item 10 will record the union of all
lists' items from prefs `wlists` server-side.

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

## Order flow (v0.16.0)

The owner wants a real footprint only, never an estimate. Fyers' API documents no trade feed (the tick-by-tick
socket is depth-only, NSE / NFO, 1 symbol on Standard). **Measured 2 Nov 2026** (the open to 10:43 IST): exact volume
NIFTY fut 6.6% (one snapshot held 16,640 qty), CRUDEOIL fut 25.1%, GOLDPETAL fut 18.0%; about one snapshot a second.
So no footprint from this feed. **Parked by the owner** ("Let's park it for now", 2 Nov). Recording is off on the
server (2 Nov 10:42; the contract list, now with GOLDPETAL26NOVFUT, is kept). Fyers' own Order Flow (Smart Charts,
Aug 2026) uses per-trade data with buy / sell inferred from the book; Fyers said (community, 31 Aug) it isn't in the API
and pointed to the TBT socket. If resumed: ask Fyers for a time & sales feed (NFO, MCX), or test whether the TBT
socket's `quote` block (`ltq`, `vtt_diff`, msg.proto) is filled per trade on NIFTY futures (TBT has no MCX).

## Indicators, Pine libraries and chart history (v0.20.0)

- **Settings per indicator** live on its entry in prefs `indicators`: `inputs`, `style` (Pine: `{plots|hlines|fills|bg|
  barcolor|shapes: {name: {off, colors: {"#RRGGBBAA": "#RRGGBBAA"}, width, type, ls, pl, lv}}, prec, lbl, sv, inl}`;
  Volume: `{up, down, maWidth, maLs}`), `vis` (`{m|h|D|W|M: [on, from, to]}`), `tf` / `gaps` (Pine's indicator
  timeframe). `pineApply()` lays `style` over the script's own look and fills `P.raw` (what the Style tab lists, the
  script's own colours as `#RRGGBBAA` keys). An indicator not shown on the chart's timeframe gets `r.offTf` (built
  hidden; `indVisCheck()` on a timeframe change rebuilds only when that changes).
- **Indicator timeframe:** the worker reads `indicator(timeframe =)` (PineTS keeps it in `ind._sourcePropArgs` /
  `ind.prop`, but doesn't act on it), runs the script on that timeframe's candles (asked of the page like
  request.security) and maps values onto the chart bars in `mapToChart()`. Such sessions re-run in full on ticks.
- **v0.20.1:** the Timeframe field is offered for every Pine script (the worker applies `props.timeframe` whether or
  not the script declares it). Bars of history "Auto" (`pineBarsFor()`): 1,500 bars, then `P.reach` = all loaded when
  the view's left edge passes the script's first bar (`pineViewCheck()` on every visible-range change, 500 ms
  debounce). Keep the full re-run on each new bar: PineTS updateTail alone drifts on `var` / stateful values across
  bars that arrived tick by tick (checked: up to 12 points on a running total, 0 within a bar).
- **v0.20.8 data check:** `dcIssues(rows, t, o)` (index.html, pure: Fyers' rows vs live figures {ltp, o, h, l, vol}) and
  `dataCheck(force, tick)` (runs after each history load / refresh and on ticks, every 5 s at most) -> `dcShow()` (the
  `#dcPill` note and `#dcBox` at the chart's bottom). Needs the day's high and low from Fyers (socket, or polled quotes:
  `open_price` / `high_price` / `low_price` / `prev_close_price` in `feed._poll()`: those key names are Fyers' documented
  quote fields but not yet seen on this server). `mktClosedNow()`: weekends and outside `sessRange()` (no holidays).
  **v0.30.2:** with the market closed and the candles' last day before today, `dcIssues` works out which day Fyers'
  live figures belong to from `t.pc` (Fyers' previous close = the close of the day before theirs; nearer the candles' last
  close than the day before's = a later day): a later day during `o.preopen` (a weekday, the 30 min before `sessRange()`'s
  start, set in `dataCheck`) -> nothing; a later day otherwise -> "Latest day" (history missing a day); else compared as
  before. No `pc`: pre-open skipped, else as before. `liveBar()` returns early for intraday plans when the tick is before
  `sessStart()` (no pre-open candle; the bid / ask / last lines still move). Found 3 Nov at 09:14 on NIFTY 50.
  Test-kit note: the mock's ticks run round the clock, so between 00:00 and 09:00 IST they now make no intraday candles
  (MCX's session starts 09:00); suites that wait for live candles may behave differently if run then (not tried yet).
  The mock sends no day open / high / low (its random walk doesn't follow its candles). To confirm on real Fyers: no false
  warnings in a normal session (NSE's official close vs LTP after 15:30 is the likeliest; tolerance 0.5%).
- **v0.30.1: every history request sends `cont_flag=0`** (`fyers_link.history_range`). Fyers' API gives its continuous
  series (each date = that day's near-month contract) when cont_flag is LEFT OUT as well as with "1": checked on the server
  2 Nov (GOLDPETAL NOV 30 Oct 15m: none / "1" = 319 lots, close 14,201, the expiring OCT contract; "0" = 314,649 lots, low
  13,699, close 13,960). Fyers' own charts have a "Continuous Futures" setting, on by default since July 2025 (Fyers Web:
  profile › Settings › Charts): turn it off to compare. `candles.FETCH_V` "3" dropped saved FUT / CE / PE candles once;
  browser store "fyers-candles-3" (older ones deleted). The mock flags any history request without cont_flag "0"
  ("CONT_FLAG ASKED" in its log). The two notes below about a Fyers "rewrite" were wrong (it was the continuous series);
  kept for history.
- **v0.20.6 / v0.20.7:** history is never asked with `cont_flag` (with it, GOLDPETAL NOV's 29 Oct had ~165,000 lots that
  Fyers' own chart doesn't show; without it the app matches Fyers' charts). `candles.py`: `_migrate()` (meta `fetch_v`
  = "2") dropped saved FUT / CE / PE candles once; `_replace()` deletes the whole days it re-fetched before saving
  Fyers' answer (not on an empty answer); each new-candles fetch starts `RECHECK_DAYS` (7) before the last saved day,
  so a day Fyers corrects later is replaced. Browser: IndexedDB store "fyers-candles-3" since v0.30.1 (older ones deleted);
  `loadHistory()` asks the server from 7 days before its last saved candle and replaces its copy from there.
  **Not a Fyers data issue (resolved 2 Nov, v0.30.1, see above):** GOLDPETAL26NOVFUT's 30 Oct in Fyers' history is a thin day (trading until ~17:00,
  then 14,201) while its live prices are 13,951 / 13,958 and the real Friday fell to 13,960 on heavy volume (Fyers'
  history sent that during Friday). Fyers' own chart shows the thin day too. Reported to Fyers by the owner. The
  roadmap's "live candles" item is the safeguard.
- **v0.20.5:** `noTradeDrop(rows)` (index.html) runs in `aggBars()` and in pine.js `pineNeed()`: rows with no volume
  whose O / H / L / C differ from the last kept close are dropped (Fyers' after-close candles at the closing price).
  Chart pref `hideNoTrade` (default true). `HROWS` keeps Fyers' rows as sent; the server's candles.db is untouched.
- **v0.20.4:** `PfPrim` never draws P&F columns as lines: square X / O while a glyph is >= 5 px; zoomed out ("flat"),
  each X / O is as wide as the column and as tall as the box; under 1.8 px a box ("block"), X columns are solid bars
  and O columns hollow ones. `PF_PRIM.mode` / `.bh` / `.sp` say which (tests/navigation_flow.js checks all three).
- **v0.20.2:** chart navigation in index.html (`goToOpen()` / `goTo(t)` / `goToNow()` / `navWatch()`; buttons `#goBtn`,
  `#nowBtn`; Alt+G). `goTo` loads older candles in a loop through `histPrepend()` (shared with the scroll-back) and
  centres the view with setVisibleLogicalRange (not scrollToRealTime, which stopped short after a manual zoom). P&F:
  `pfZoom()` picks the opening bar spacing; `pfFixed()` gives the fixed box per contract and timeframe
  (`pfBox["CRUDEOIL@1D"]`), the old per-contract key only where ATR / box <= 8.
- **Imports:** the page resolves them (`pineLibs()` in pine.js: a saved script named like the import path, then a
  saved `library("Name")`, then `PINE_BUILTIN_LIBS`) and sends `{path: source}` with each run; the worker gives
  PineTS a resolver over that. `TradingView_ta.pine` is our own implementation (standard formulas; ta.supertrend's
  port checked equal to Pine's built-in). PineTS quirk found writing it: a history reference with a parameter index
  inside a ternary branch (`c ? x[length] : y`) evaluated wrong in a library function: compute it into a variable first.
- **Chart history:** `HX[symbol|res].days` is how far back a chart reaches after you scroll left (`histMore()`:
  `/api/history?...&until=<oldest>`; only user scrolling triggers it, `histUserAt`); `HROWS` are the raw rows on
  the chart. `fyers_link._check()` treats Fyers' `{"s": "no_data"}` as an empty answer (it used to fail whole
  chunked requests reaching back before a contract's listing).
- **Not confirmed against real Fyers:** that Fyers really answers `no_data` (per its community examples) for ranges
  before listing and how far back its intraday candles go; the owner's real Pivot Points / Chandelier scripts on
  real candles.

## Rule: every indicator on every chart type (owner, 31 Oct 2026)

Volume, every Pine script and every future indicator / Pine feature must work on every chart type, P&F included.
How it holds: indicators only ever read `DISP` (the shown bars); Pine gets them through `pineBar()` in pine.js (closeTime
= next bar's open for non-time types; P&F `close` = middle or last box). Before every release run
`tests/pine_compat_flow.js`; when a Pine feature is added, add a script using it to `tests/pine_compat.js`.
The P&F toolkit is `CT.pfTools` (ctype.js: lines, signals, anchors, counts, hcounts, patterns) drawn by `PfToolsPrim`
(index.html, built-in indicator "pftools"; labels go through a priority queue so they never overlap).
v0.27.0 fix: after a break the next 45° line starts at the X top / O bottom with the most `hi + column` / least `lo - column`
in the move (the tangent no later column has crossed); `ctype_test.js` checks on random walks that no line is crossed
before its break and none is made twice. Keep that check passing when touching the lines.

## Chart types (v0.15.0, Point & Figure v0.16.0)

Done and tested (`tests/ctype_test.js`, `tests/charttypes_flow.js`). Indicators run on the displayed bars, as on
TradingView. If the owner wants indicators on the real candles under a Heikin-Ashi / Renko chart, that's a per-
indicator option to add (not built).

## Next job

0. Roadmap 14 (v0.31.0): the friend's first real server set-up with `docs/New_Server_Guide.md`. Fix whatever it shows.
   On the owner's server, after the update: `cat /etc/fyers/server.conf` should show his address and 134.209.159.171.
1. The owner's first real trade (Monday at the earliest): whitelist 134.209.159.171 (order permission), turn on
   Live, 1 lot on MCX. Fix whatever that shows.
2. Compare the app's charges with what Fyers deducted (roadmap item 1, last part).
3. v0.30.1 (2 Nov): history asks Fyers for continuous data off (cont_flag=0); the owner checks GOLDPETAL NOV's 30 Oct
   on 15m in the app after the update (should match Fyers' chart with Continuous Futures off: low ~13,700, close ~13,960).
   Order flow: measured and parked (2 Nov, see "Order flow" above). v0.30.0 (2 Nov): roadmap 13, the option chain's
   fixed header and a contract's lists from its row, waiting for the owner's try on real Fyers. Next build: the journal (4) (the owner's order, 1 Nov; item 8, CFD
   prices, is on hold): v0.26.0, v0.27.0 (pictures + Telegram backup) and v0.28.0 (Insights, review, export) shipped: the
   journal is complete. v0.29.0: the trade replay (4c as agreed 1 Nov). Next in the roadmap's order: item 10 (live
   candles), 4b only if the owner says yes. Shipped and waiting for the owner's try: measurement and drawing tools (v0.22.0), layouts
   (v0.23.0), angles (v0.23.1), multi-charts with sync (v0.24.0 / v0.24.1), Telegram alerts (v0.25.0: set up and tested
   by the owner 1 Nov), the journal (v0.26.0), journal pictures + Telegram backup (v0.27.0: the owner turns on the backup
   in Journal › Settings › Pictures with a new private channel).
4. The owner tries the trade replay (v0.29.0) on real trades: ▶ On chart on a Journal trade, ▶ Play; trades from
   before v0.29.0 show his current chart and the stop's path from the account's log. (The phone layout and the order
   bubble: tried by the owner 1 Nov, working.)
5. The owner checks v0.20.0 on real Fyers: Pivot Points and the Chandelier exit on GOLDPETAL 2m, scrolling back,
   and the Style / Visibility tabs on his own scripts.
