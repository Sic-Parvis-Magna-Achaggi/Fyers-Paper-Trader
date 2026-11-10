// MT5 bridge (roadmap 8, stage a) in the browser: Settings › MT5 bridge (make a key with 2FA, the setup steps, the terminal
// connecting), the MT5 pill, Find (gold -> XAUUSD, the MT5 filter), an MT5 chart (candles from the bridge, live ticks, the
// broker's day for intraday and daily candles, no Fyers data check), every chart type with Volume and two Pine scripts, the
// Book tab, paper trading refused (charts only), the terminal going away (pill off, saved candles still shown), the phone.
// The terminal is tests/fake_mt5.py (started here with the key the page made). Needs the mock server and security_flow.js.
const { chromium, devices } = require("playwright");
const { spawn } = require("child_process");
const LOGIN = require("./login.js");
const fs = require("fs");
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const TYPES = ["candles", "hollow", "bars", "line", "area", "ha", "renko", "range", "lb", "pf"];
let br, ea;
const startEA = key => { ea = spawn("python3", [__dirname + "/fake_mt5.py", "http://localhost:8766", key], { stdio: ["ignore", "pipe", "pipe"] });
  ea.stdout.on("data", d => fs.writeSync(1, "  [fake MT5] " + d)); ea.stderr.on("data", d => fs.writeSync(1, "  [fake MT5 err] " + d)); };
(async () => {
  br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
  const errs = []; pg.on("pageerror", e => { errs.push(e.message); fs.writeSync(1, "PAGEERROR " + e.message + "\n"); });
  pg.on("console", m => { if(m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);

  // ---- Settings › MT5 bridge
  await pg.click("#bSettings").catch(() => pg.evaluate(() => openDrawer()));
  await pg.waitForSelector("#mt5Box #mtSetup", { state: "attached", timeout: 10000 });
  await pg.evaluate(() => { document.querySelector("#mtSetup").open = true; document.querySelector("#mt5Sec").scrollIntoView(); });   // (closed once a terminal has connected)
  const s0 = await pg.textContent("#mt5Box");
  ok(/places no orders/i.test(s0) && /No VPS, no VPN/.test(s0) && /Set it up \(5 steps\)/.test(s0), "Settings › MT5 bridge explains it (no orders, no VPS / VPN) with the 5 steps");
  ok((await pg.inputValue("#mtUrl")) === "http://localhost:8766", "step 4 shows this server's address to allow in MT5");
  const dl = await pg.evaluate(async () => { const r = await fetch("/api/mt5/ea"); const t = await r.text(); return {code: r.status, mq5: /FTM_Bridge\.mq5/.test(t) && /WebRequest/.test(t) && /OrderSend|CTrade/.test(t) === false}; });
  ok(dl.code === 200 && dl.mq5, "the EA's source downloads from the page (and has no order calls)");
  pg.once("dialog", d => d.accept());
  await pg.click("#mtKeyNew");
  await pg.waitForSelector("#codeAsk:not(.hide) #caCode", { timeout: 10000 });
  await pg.fill("#caCode", await LOGIN.code(pg)); await pg.click("#caGo");
  await pg.waitForSelector("#mtKey", { timeout: 10000 });
  const key = await pg.inputValue("#mtKey");
  ok(/^ftm-[\w-]{30,}$/.test(key), "a new key, after the 2FA code, shown once to copy into the EA");
  await pg.screenshot({ path: SHOT + "mt5_settings_key.png" });
  const noAuth = await pg.evaluate(async () => (await fetch("/api/mt5/sync", {method: "POST", headers: {"X-FTM-Key": "ftm-wrongwrongwrongwrongwrongwrong"}, body: "{}"})).status);
  ok(noAuth === 401, "a wrong key is refused (401)");

  // ---- the terminal connects
  startEA(key);
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => mtRender());
  await pg.waitForFunction(() => /21182752/.test(document.querySelector("#mt5Box").textContent) && /connected/.test(document.querySelector("#mt5Box").textContent), null, { timeout: 15000 });
  const s1 = await pg.textContent("#mt5Box");
  ok(/FundingPips-SIM1/.test(s1) && /DEMO/.test(s1) && /Hedge/.test(s1) && /prices from here/.test(s1) && /5,000\.00 USD/.test(s1), "the terminal shows up: login, server, DEMO, Hedge, balance, prices from here");
  ok(/day starts at\s+0[23]:30 IST/.test(s1) && /3 symbols known/.test(s1), "the broker's clock (its day in IST) and the symbol list");
  await pg.screenshot({ path: SHOT + "mt5_settings_connected.png" });
  await pg.click("#bClose");
  await pg.evaluate(async () => { watch = watch.filter(w => !isMT5(w.s)); await openBySymbol("MCX:CRUDEOIL26NOVFUT"); const j = await api("/api/state"); feedPill(j.feed); });
  ok(!(await pg.isVisible("#pMt5")), "no MT5 mark while the page shows no MT5 symbol");

  // ---- Find
  await pg.click('.tabs button[data-tab="find"]');
  await pg.fill("#q", "gold"); await pg.waitForTimeout(800);
  const f1 = await pg.evaluate(() => [...document.querySelectorAll("#results .row")].map(r => r.textContent));
  ok(f1.length >= 1 && /XAUUSD/.test(f1[0]) && /MT5 · Gold vs US Dollar/.test(f1[0]), `Find "gold": XAUUSD from MT5 first (${f1[0]})`);
  await pg.click('#exf button[data-x="MT5"]'); await pg.fill("#q", "us"); await pg.waitForTimeout(800);
  const f2 = await pg.evaluate(() => [...document.querySelectorAll("#results .row .name div:first-child")].map(r => r.textContent));
  ok(f2.length === 3 && f2.every(x => /USD|US30/.test(x)), `the MT5 filter: only the broker's symbols (${f2.join(", ")})`);
  await pg.click('#exf button[data-x=""]');

  // ---- an MT5 chart: candles from the bridge, live ticks
  await pg.evaluate(async () => {
    await pineLoad(true);
    const save = async (name, source) => { const old = PINE.scripts.find(s => s.name === name);
      const j = await api("/api/scripts/save", {body: {id: old ? old.id : null, name, source}}); PINE.scripts = j.scripts; PINE.loaded = true; return j; };
    const a = await save("T SMA", '//@version=5\nindicator("T SMA", overlay=true)\nplot(ta.sma(close, 10), "SMA")');
    const b = await save("T RSI", '//@version=5\nindicator("T RSI", overlay=false)\nplot(ta.rsi(close, 14), "RSI")');
    indSave([{type: "volume", id: "v1", ma: true, maLen: 20}, {type: "pine", id: "p1", scriptId: a.script.id, inputs: {}, overlay: true},
             {type: "pine", id: "p2", scriptId: b.script.id, inputs: {}, overlay: false}]);
    ctSave({type: "candles"}); setTf("5m");
    await openBySymbol("MT5:XAUUSD");
  });
  await pg.waitForFunction(() => cur && cur.s === "MT5:XAUUSD" && curPlan && curPlan.res === "5" && RAW.length > 200 && last["MT5:XAUUSD"]
    && RAW[RAW.length - 2].time - RAW[RAW.length - 3].time === 300, null, { timeout: 30000 });
  const c1 = await pg.evaluate(() => ({sym: document.querySelector("#cSym").textContent, ltp: document.querySelector("#cLtp").textContent,
    meta: document.querySelector("#cMeta").textContent, msg: document.querySelector("#chartMsg").classList.contains("hide") ? "" : document.querySelector("#chartMsg").textContent,
    n: RAW.length, sh: sessStart() * 60, aligned: RAW.every(b => (b.time - sessStart() * 60) % 300 === 0), dc: !!document.querySelector("#dcPill")}));
  ok(c1.sym === "XAUUSD" && /Bid [\d,.]+ · Ask [\d,.]+/.test(c1.meta) && !c1.msg, `XAUUSD opens: ${c1.n} candles from MT5, bid / ask ("${c1.meta}")`);
  ok(await pg.isVisible("#pMt5") && await pg.evaluate(() => document.querySelector("#pMt5").classList.contains("on") && /21182752/.test(document.querySelector("#pMt5").title)),
     "on an MT5 chart: a green MT5 in the Prices pill, the login in its tip");
  ok(await pg.evaluate(() => document.querySelector("#app > header").scrollHeight < 70), "the header stays on one line at 1500 px with it");
  ok(c1.aligned, "5m candles start on the broker's day (every candle 5 minutes from its midnight)");
  ok(!c1.dc, "no Fyers data-check warning on an MT5 chart");
  const t0 = await pg.evaluate(() => ({ltp: last["MT5:XAUUSD"].ltp, t: last["MT5:XAUUSD"].t, n: RAW.length, lb: lastBar && lastBar.time}));
  await pg.waitForTimeout(3000);
  const t1 = await pg.evaluate(() => ({ltp: last["MT5:XAUUSD"].ltp, t: last["MT5:XAUUSD"].t, n: RAW.length, lb: lastBar.time, close: lastBar.close,
    bidLine: typeof bidLine !== "undefined" && bidLine.options().price}));
  ok(t1.t > t0.t && Math.abs(t1.close - t1.ltp) < 1e-9, `live ticks move the last candle (ltp ${t0.ltp} → ${t1.ltp}, the candle's close follows)`);
  ok(Math.abs(Date.now() / 1000 - t1.t) < 5, "tick times are real UTC times (as Fyers' are)");
  ok(t1.n - t0.n <= 1, "no stray extra candles from the ticks" + (t1.n - t0.n > 1 ? ` (${t0.n} -> ${t1.n})` : ""));
  await pg.screenshot({ path: SHOT + "mt5_chart_5m.png" });

  // ---- every chart type: Volume + two Pine scripts lined up on the MT5 bars
  for(const t of TYPES){
    await pg.evaluate(t => ctSave({type: t}), t);
    const ready = await pg.waitForFunction(() => {
      const p = INDS.filter(r => r.cfg.type === "pine"), set = new Set(DISP.map(b => b.time));
      return DISP.length > 5 && p.length === 2 && p.every(r => r.pine && r.pine.res && r.pine.n > 0 && r.pine.times[r.pine.n - 1] === dispLast().time
        && r.pine.times.every(x => set.has(x)));
    }, null, { timeout: 30000 }).then(() => true).catch(() => false);
    const vol = ready && await pg.evaluate(() => { const v = INDS.find(x => x.cfg.type === "volume"); const d = v.hist.data(); return d.length === DISP.length && d.every((x, i) => x.time === DISP[i].time); });
    ok(ready && vol, `${t} on MT5:XAUUSD: drawn, Volume and both Pine scripts line up with the bars`);
    if(!(ready && vol)) fs.writeSync(1, "  debug " + JSON.stringify(await pg.evaluate(() => ({disp: DISP.length, raw: RAW.length, size: CT_SIZE,
      pine: INDS.filter(r => r.cfg.type === "pine").map(r => r.pine ? {n: r.pine.n, last: r.pine.times && r.pine.times[r.pine.n - 1], err: r.pine.err || r.pine.error} : null), dl: dispLast() && dispLast().time}))) + "\n");
    if(t === "pf") await pg.screenshot({ path: SHOT + "mt5_chart_pf.png" });
  }
  await pg.evaluate(() => ctSave({type: "candles"}));

  // ---- daily candles: the broker's day
  await pg.evaluate(() => setTf("1D"));
  await pg.waitForFunction(() => curPlan && curPlan.res === "D" && RAW.length > 20 && RAW.every(b => b.time % 86400 === 0), null, { timeout: 30000 }).catch(() => {});
  const d1 = await pg.evaluate(() => ({n: RAW.length, ok: RAW.every(b => b.time % 86400 === 0),
    last: RAW[RAW.length - 1].time, today: bucket(Date.now() / 1000 + IST, curPlan), timer: document.querySelector("#cTimer").textContent}));
  ok(d1.n > 20 && d1.ok, `1D: ${d1.n} daily candles, each on its broker date (stamped 00:00 IST, summer time or not)`);
  ok(d1.last === d1.today, "today's live ticks land on the broker's today (no extra daily candle)");
  const wkend = await pg.evaluate(() => { const d = new Date(chartDay(Date.now() / 1000 + IST) * 1000).getUTCDay(); return d === 0 || d === 6; });
  ok(wkend ? /closed/.test(d1.timer) : /close \d/.test(d1.timer), `the candle timer counts to the broker's day end ("${d1.timer}")`);
  await pg.evaluate(() => setTf("45m"));
  await pg.waitForFunction(() => curPlan && curPlan.res === "45" && RAW.length > 20 && RAW[RAW.length - 1].time - RAW[RAW.length - 2].time <= 2700, null, { timeout: 30000 }).catch(() => {});
  // (since the last clock change, 1 Nov 2026: candles from US summer time start an hour earlier in IST, as MT5's own do)
  ok(await pg.evaluate(() => { const r = RAW.filter(b => b.time - IST > Date.UTC(2026, 10, 2) / 1000); return r.length > 20 && r.every(b => (b.time - sessStart() * 60) % 2700 === 0); }),
     "45m (built from MT5's 15m) from the broker's midnight");
  await pg.evaluate(() => setTf("5m"));

  // ---- Book tab, trading refused
  await pg.click('#ptabs button[data-t="book"]'); await pg.waitForTimeout(500);
  ok(/No order book for MT5 symbols/.test(await pg.textContent("#bookBox")), "the Book tab: no order book for MT5 symbols");
  await pg.click('#ptabs button[data-t="pos"]');
  ok(/charts only for now/.test(await pg.textContent("#tkHint")), "the ticket says MT5 symbols are charts only for now");
  const pv = await pg.evaluate(async () => api("/api/paper/preview", {body: {s: "MT5:XAUUSD", side: 1, type: "market", sl: 2600, tp_r: 2, mode: "lots", lots: 1, product: "INTRADAY"}}));
  const pl = await pg.evaluate(async () => api("/api/paper/place", {body: {s: "MT5:XAUUSD", side: 1, type: "market", sl: 2600, tp_r: 2, mode: "lots", lots: 1, product: "INTRADAY"}}));
  ok(!pv.ok && !pl.ok && /charts only/.test(pl.error), `paper trading refuses MT5 symbols in this step ("${pl.error}")`);
  const ms = await pg.evaluate(async () => api("/api/measure", {body: {s: "MT5:XAUUSD", legs: [{side: 1, qty: 1, entry: 2600, exit: 2610}]}}));
  ok(!ms.ok && /points only/.test(ms.error), "the measure tool's net ₹ isn't worked out with Indian charges for MT5");

  // ---- the terminal goes away
  ea.kill("SIGTERM"); ea = null;
  await pg.waitForTimeout(10000);
  await pg.evaluate(async () => { const j = await api("/api/state"); feedPill(j.feed); });
  ok(await pg.evaluate(() => document.querySelector("#pMt5").classList.contains("off") && /isn't connected/.test(document.querySelector("#pMt5").title)), "MT5 closed: MT5 turns red (its tip says why)");
  const off = await pg.evaluate(async () => api(`/api/history?symbol=${encodeURIComponent("MT5:XAUUSD")}&res=5&days=3`));
  ok(off.ok && off.candles.length > 200, "the saved candles still load while MT5 is off");
  const off2 = await pg.evaluate(async () => api(`/api/history?symbol=${encodeURIComponent("MT5:EURUSD")}&res=60&days=30`));
  ok(!off2.ok && off2.status === 409 && /isn't connected/.test(off2.error), `a chart never loaded: a clear message ("${off2.error}")`);
  await pg.evaluate(() => openDrawer()); await pg.waitForTimeout(800);
  ok(/not connected/.test(await pg.textContent("#mt5Box")), "Settings shows the terminal as not connected");
  await pg.click("#bClose");
  ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));

  // ---- the phone
  startEA(key); await pg.waitForTimeout(2000);
  const ctx = await br.newContext({ ...devices["Pixel 7"] });
  const mp = await ctx.newPage(); const merrs = []; mp.on("pageerror", e => merrs.push(e.message));
  await mp.goto("http://localhost:8766/"); await LOGIN(mp);
  await mp.evaluate(async () => { ctSave({type: "candles"}); setTf("15m"); await openBySymbol("MT5:XAUUSD"); });
  await mp.waitForFunction(() => cur && cur.s === "MT5:XAUUSD" && RAW.length > 50 && last["MT5:XAUUSD"], null, { timeout: 30000 }).catch(() => {});
  const m1 = await mp.evaluate(() => ({mob: document.body.classList.contains("mob"), n: RAW.length, buy: (document.querySelector("#mBuy b") || {}).textContent, sell: (document.querySelector("#mSell b") || {}).textContent}));
  ok(m1.mob && m1.n > 50 && /\d/.test(m1.buy) && /\d/.test(m1.sell), `phone: the MT5 chart loads (${m1.n} candles), SELL / BUY show the bid / ask (${m1.sell} / ${m1.buy})`);
  await mp.screenshot({ path: SHOT + "mt5_phone.png" });
  ea.kill("SIGTERM"); ea = null; await mp.waitForTimeout(10000);
  await mp.evaluate(async () => { const j = await api("/api/state"); feedPill(j.feed); });
  ok(/MT5 isn't connected/.test(await mp.textContent("#mWarn")), "phone: MT5 off shows a warning line with a link to Settings");
  await mp.screenshot({ path: SHOT + "mt5_phone_off.png" });
  ok(merrs.length === 0, "phone: no page errors" + (merrs.length ? ": " + merrs.join(" | ") : ""));
  // tidy up: the bridge key stays (other runs make their own)
  await br.close(); if(ea) ea.kill("SIGTERM");
})().catch(async e => { ok(false, "exception " + e.message); if(ea) ea.kill("SIGTERM"); if(br) await br.close(); });
