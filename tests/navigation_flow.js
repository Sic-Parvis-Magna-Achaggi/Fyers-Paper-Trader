// Chart navigation and P&F sizing (owner, 1 Nov 2026), in a browser. Needs the mock server and an admin with 2FA
// (run security_flow.js first). The mock's contracts were "listed" 200 days ago.
// - P&F opens at a zoom where X's and O's are readable; the fixed box is per timeframe; a per-contract box too small
//   for a timeframe (5 points on a day) gives way to the ATR box there, so day columns are X's and O's, not lines.
// - Go to (button, Alt+G): a date and time, loading older candles first; before the listing it says so.
// - » appears when the latest candle is off screen and brings it back.
const { chromium } = require("playwright");
const LOGIN = require("./login.js");
const fs = require("fs");
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const SYM = "MCX:CRUDEOIL26NOVFUT";
let br;
(async () => {
  br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
  const errs = []; pg.on("pageerror", e => { errs.push(e.message); fs.writeSync(1, "PAGEERROR " + e.message + "\n"); });
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  const boxPx = () => pg.evaluate(() => { const L = DISP[DISP.length - 1]; return Math.abs(series.priceToCoordinate(L.low) - series.priceToCoordinate(L.low + CT_SIZE)); });

  // ---------------------------------------------------------------- P&F: readable at the default zoom
  await pg.evaluate(async s => { indSave([]); ctSave({type: "pf", pfMode: "fixed", pfBox: {CRUDEOIL: 2}, pfRev: 3}, false); setTf("2m"); await openBySymbol(s); ctSave({}); }, SYM);
  await pg.waitForFunction(() => DISP.length > 20 && CT_SIZE, null, { timeout: 30000 });
  await pg.waitForTimeout(800);
  const z = await pg.evaluate(() => ({sp: chart.timeScale().options().barSpacing, ro: chart.timeScale().options().rightOffset, box: CT_SIZE, cols: DISP.length}));
  const bpx = await boxPx();
  ok(z.sp >= 12 && bpx >= 6, `P&F 2m opens readable: columns ${z.sp} px apart, a box ${bpx.toFixed(1)} px tall (was 6 px columns), ${z.cols} columns, box ${z.box}`);
  ok(z.ro <= 4, `little empty space on the right on P&F (${z.ro} columns)`);
  await pg.screenshot({ path: SHOT + "pf_2m_default_zoom.png" });

  // ---------------------------------------------------------------- P&F on 1D: the 2-point box is too small there
  await pg.evaluate(() => setTf("1D"));
  await pg.waitForFunction(() => curPlan && curPlan.res === "D" && DISP.length > 3 && CT_SIZE, null, { timeout: 30000 });
  await pg.waitForTimeout(800);
  const d1 = await pg.evaluate(() => ({box: CT_SIZE, atr: CT.atr(RAW, ctCfg().pfAtr || 14), tv: chart.timeScale().options().timeVisible}));
  const dpx = await boxPx();
  ok(d1.box > 2 && Math.abs(d1.box - d1.atr) / d1.atr < 0.15, `on 1D the 2-point box gives way to the ATR box (${d1.box}, ATR ${d1.atr.toFixed(1)})`);
  ok(dpx >= 4, `so 1D columns draw as X's and O's (a box ${dpx.toFixed(1)} px tall; under 4 px they were lines)`);
  ok(d1.tv === false, "daily chart: dates only on the time axis (no 05:30)");
  await pg.screenshot({ path: SHOT + "pf_1d.png" });
  const note = await pg.evaluate(() => { renderCt(); return document.querySelector("#ctBody").textContent; });
  ok(/too small for 1D/.test(note), `the chart type menu says why ("${(note.match(/[\d.]+ is too small[^.]*\./) || [""])[0]}")`);
  await pg.evaluate(() => { $("#ctPick").classList.remove("hide"); const i = document.querySelector("#ctPB"); i.value = "40"; i.dispatchEvent(new Event("change")); });
  await pg.waitForFunction(() => CT_SIZE === 40, null, { timeout: 20000 });
  const saved = await pg.evaluate(() => ctCfg().pfBox);
  ok(saved["CRUDEOIL@1D"] === 40 && saved.CRUDEOIL === 2, `a box typed on 1D is saved for 1D only (${JSON.stringify(saved)})`);
  await pg.evaluate(() => { $("#ctPick").classList.add("hide"); setTf("2m"); });
  await pg.waitForFunction(() => curPlan && curPlan.res === "2" && CT_SIZE === 2, null, { timeout: 30000 })
    .then(() => ok(true, "back on 2m the box is 2 again")).catch(() => ok(false, "2m keeps its own box"));

  // ---------------------------------------------------------------- P&F zoomed out: X's and O's, never thin lines (owner, 1 Nov)
  // squeeze the boxes as zooming out on a busy day does (a box 3 px, then 1 px tall), and narrow the columns
  const pfAt = async (spacing, pad) => {
    await pg.evaluate(([sp, pd]) => {
      chart.timeScale().applyOptions({barSpacing: sp}); chart.timeScale().scrollToRealTime();
      const n = DISP.length; let hi = -Infinity, lo = Infinity; for(let i = Math.max(0, n - 200); i < n; i++){ hi = Math.max(hi, DISP[i].high); lo = Math.min(lo, DISP[i].low); }
      series.priceScale().setVisibleRange({from: lo - pd, to: hi + pd});
    }, [spacing, pad]);
    await pg.waitForTimeout(500);
    return pg.evaluate(() => { const p = PF_PRIM; return {mode: p.mode, bh: +p.bh.toFixed(1), sp: p.sp}; });
  };
  const zA = await pfAt(7, 120);
  ok(zA.mode === "flat" && zA.bh < 4, `zoomed out (a box ${zA.bh} px, columns ${zA.sp} px): flattened X's and O's as wide as the column (mode "${zA.mode}"; under 4 px they used to be lines)`);
  await pg.screenshot({ path: SHOT + "pf_zoomed_out_flat.png" });
  const zB = await pfAt(4, 600);
  ok(zB.mode === "block" && zB.bh < 1.8, `zoomed far out (a box ${zB.bh} px): X columns solid, O columns hollow (mode "${zB.mode}")`);
  await pg.screenshot({ path: SHOT + "pf_zoomed_out_block.png" });
  const zC = await pfAt(16, 5);
  ok(zC.mode === "xo" && zC.bh >= 5, `zoomed back in (a box ${zC.bh} px): the usual square X's and O's`);
  await pg.evaluate(() => { series.priceScale().applyOptions({autoScale: true}); pfZoom(); });

  // ---------------------------------------------------------------- no-trade candles after the close (owner, 1 Nov: GOLDPETAL's 14,201 after 23:30)
  // the mock's CRUDEOIL26DECFUT has empty candles at 6,250 from 23:30 to 23:55 each day (no volume), ~650 above the trades
  await pg.evaluate(async () => { ctSave({type: "candles"}); setTf("2m"); await openBySymbol("MCX:CRUDEOIL26DECFUT"); });
  await pg.waitForFunction(() => cur && cur.s === "MCX:CRUDEOIL26DECFUT" && RAW.length > 100 && HROWS.length, null, { timeout: 30000 });
  await pg.waitForTimeout(800);
  const nt = await pg.evaluate(() => {
    const ghosts = HROWS.filter(r => !r[5] && r[4] === 6250).length;
    const hiRaw = Math.max(...RAW.map(b => b.high));
    const top = series.coordinateToPrice(0);
    return {ghosts, hiRaw, top, kept: RAW.length, rows: HROWS.length};
  });
  ok(nt.ghosts > 10 && nt.hiRaw < 6000, `the empty after-close candles at 6,250 (${nt.ghosts} in Fyers' answer) are left off the chart (highest candle ${nt.hiRaw})`);
  ok(nt.top < 6000, `so the price scale isn't stretched to 6,250 (top of the chart ${Math.round(nt.top)})`);
  const toggle = async on => { await pg.evaluate(v => { $("#cfgPick").classList.remove("hide"); renderCfg(); const el = document.querySelector('#cfgBody [data-k="hideNoTrade"]'); el.checked = v; el.dispatchEvent(new Event("input")); $("#cfgPick").classList.add("hide"); }, on); await pg.waitForTimeout(800); };
  await toggle(false);
  const off = await pg.evaluate(() => ({hi: Math.max(...RAW.map(b => b.high)), pref: chartCfg().hideNoTrade}));
  ok(off.hi === 6250 && off.pref === false, `Chart settings › Hide no-trade candles off: they show again (highest ${off.hi})`);
  await pg.screenshot({ path: SHOT + "notrade_shown.png" });
  await toggle(true);
  ok(await pg.evaluate(() => Math.max(...RAW.map(b => b.high)) < 6000 && chartCfg().hideNoTrade === true), "and on again: gone (the default)");
  await pg.screenshot({ path: SHOT + "notrade_hidden.png" });
  await pg.evaluate(() => ctSave({type: "pf"}));
  await pg.waitForFunction(() => ctType() === "pf" && DISP.length > 5 && CT_SIZE, null, { timeout: 30000 });
  ok(await pg.evaluate(() => Math.max(...DISP.map(b => b.high)) < 6000), "no P&F column runs up to the closing price");
  const ps = await pg.evaluate(async () => { const b = await pineNeed({tf: "15", ticker: ""}); return b.error || Math.max(...b.map(x => x.high)); });
  ok(typeof ps === "number" && ps < 6000, `Pine request.security() gets the same candles (15m high ${ps})`);
  await pg.evaluate(async () => { ctSave({type: "candles"}); await openBySymbol("MCX:CRUDEOIL26NOVFUT"); });
  await pg.waitForFunction(() => cur && cur.s === "MCX:CRUDEOIL26NOVFUT" && RAW.length > 100, null, { timeout: 30000 });

  // ---------------------------------------------------------------- this browser's copy of the candles (owner, 1 Nov: an old copy
  // and the server disagreed): the last 7 days come from the server every time a chart opens
  const bc = await pg.evaluate(async () => {
    const key = cur.s + "|" + curPlan.res, saved = await CDB.get(key);
    const i = saved.rows.findIndex(r => r[0] > Date.now() / 1000 - 2 * 86400), t = saved.rows[i][0];
    saved.rows[i] = [t, 9999, 9999, 9999, 9999, 0];                 // a wrong candle in this browser's copy, 2 days back
    saved.rows.push([saved.rows[saved.rows.length - 1][0] - 30, 8888, 8888, 8888, 8888, 5]);   // and one the server doesn't have
    saved.rows.sort((a, b) => a[0] - b[0]);
    await CDB.put(key, saved);
    await loadHistory(); await new Promise(r => setTimeout(r, 1500));
    const after = await CDB.get(key);
    const dbs = indexedDB.databases ? (await indexedDB.databases()).map(d => d.name) : ["?"];
    return {chart: RAW.some(b => b.high >= 8888), copy: after.rows.some(r => r[2] >= 8888), dbs};
  });
  ok(!bc.chart && !bc.copy, "a wrong candle 2 days back in this browser's copy is replaced by the server's when the chart opens");
  ok(!bc.dbs.includes("fyers-candles") && !bc.dbs.includes("fyers-candles-2") && bc.dbs.includes("fyers-candles-3"),
     `the old browser stores (continuous-series copies, up to v0.30.0) are deleted; fyers-candles-3 in use (stores: ${bc.dbs.join(", ")})`);

  // ---------------------------------------------------------------- the data check (owner, 1 Nov: "how can I trust this data?")
  // the candles against Fyers' live figures for the same day: consistent figures say nothing; Friday-like ones warn
  const dc = await pg.evaluate(() => {
    const rows = noTradeDrop(HROWS), dayOf = x => Math.floor((x + IST) / 86400), ld = dayOf(rows[rows.length - 1][0]);
    const day = rows.filter(r => dayOf(r[0]) === ld);
    const D = {o: day[0][1], h: Math.max(...day.map(r => r[2])), l: Math.min(...day.map(r => r[3])), c: day[day.length - 1][4], v: day.reduce((s, r) => s + r[5], 0)};
    const prior = rows.filter(r => dayOf(r[0]) < ld), prevC = prior[prior.length - 1][4];
    const base = {tick: 1, closed: true, today: ld, mult: 100, lot: 1, live: null};
    const good = {s: cur.s, ltp: D.c, o: D.o, h: D.h, l: D.l, vol: D.v};
    const run = (t, o) => dcIssues(HROWS, t, {...base, ...o}).map(x => x[0]);
    return {D,
      good: run(good),
      near: run({...good, ltp: D.c + 3, h: D.h + 4, l: D.l - 4, vol: D.v * 1.3}),
      friday: run({...good, ltp: Math.round(D.c * 0.983), o: Math.round(D.o * 1.011), l: Math.round(D.l * 0.975), vol: D.v * 300}, {mult: 1}),
      units: run({...good, vol: D.v * 100}),
      openNoToday: run({...good, ltp: D.c * 0.9}, {closed: false, today: ld + 1}),
      index: run({...good, vol: undefined}),
      noFigures: run({s: cur.s, ltp: D.c * 0.9}),
      // v0.30.2 (owner, 3 Nov, NIFTY at 09:14): before the open, Fyers' figures can be TODAY's pre-open ones
      pre: (() => { const X = Math.round(D.c * 1.006), P = {s: cur.s, ltp: X, o: X, h: X, l: X};
        return {withPc: run({...P, pc: D.c}, {today: ld + 1, preopen: true}), noPc: run(P, {today: ld + 1, preopen: true}),
                missing: run({...P, pc: D.c}, {today: ld + 2, preopen: false}),
                weekendGood: run({...good, pc: prevC}, {today: ld + 1}),
                weekendBad: run({...good, pc: prevC, ltp: Math.round(D.c * 0.983), o: Math.round(D.o * 1.011), l: Math.round(D.l * 0.975)}, {today: ld + 1}),
                noPcAfterHours: run({...good, ltp: Math.round(D.c * 0.983)}, {today: ld + 1})}; })()};
  });
  ok(dc.good.length === 0 && dc.near.length === 0, `figures that match the candles (or within 0.5% / 10 ticks, volume within 5x) give no warning (${JSON.stringify(dc.near)})`);
  ok(["Day open", "Day low", "Last price", "Day volume"].every(k => dc.friday.includes(k)), `a Friday-like day is flagged: ${dc.friday.join(", ")}`);
  ok(dc.units.length === 0, "a volume 100x the candles' on a ×100 contract is a unit difference, not an error");
  ok(dc.openNoToday.length === 0 && dc.noFigures.length === 0 && !dc.index.includes("Day volume"),
     "nothing to compare while the market is open and today's candles aren't in, without Fyers' day figures, or volume on an index");
  ok(dc.pre.withPc.length === 0 && dc.pre.noPc.length === 0,
     `before the open, today's pre-open figures (previous close = the candles' last close) aren't compared with yesterday's candles (${JSON.stringify(dc.pre)})`);
  ok(dc.pre.missing.length === 1 && dc.pre.missing[0] === "Latest day", `a later day that traded but isn't in the candles is flagged as missing (${dc.pre.missing})`);
  ok(dc.pre.weekendGood.length === 0 && ["Day open", "Day low", "Last price"].every(k => dc.pre.weekendBad.includes(k)),
     `the day after (weekend): figures of the candles' own day (previous close = the day before's) are still compared: good ones pass, a Friday-like day is flagged (${dc.pre.weekendBad})`);
  ok(dc.pre.noPcAfterHours.includes("Last price"), "without a previous close, outside the pre-open, the check compares as before");
  // the pre-open price gets no intraday candle of its own (it did: a 09:00 candle on NIFTY 15m at 09:14)
  const po = await pg.evaluate(() => {
    const keepRAW = RAW.slice(), keepLast = lastBar, keepVol = volCum, today = Math.floor((Date.now() / 1000 + IST) / 86400);
    while(RAW.length && Math.floor(RAW[RAW.length - 1].time / 86400) >= today) RAW.pop();
    lastBar = RAW[RAW.length - 1]; dispSet();                     // the chart as it was before today's first tick
    const n = RAW.length, t0 = today * 86400 - IST + sessStart() * 60;
    liveBar({s: cur.s, ltp: 7777, t: t0 - 600});
    const before = RAW.length === n && !RAW.some(b => b.close === 7777);
    liveBar({s: cur.s, ltp: 7777, t: t0 + 60});
    const after = RAW.length === n + 1 && RAW[RAW.length - 1].close === 7777;
    RAW.length = 0; RAW.push(...keepRAW); lastBar = keepLast; volCum = keepVol; dispSet();
    return {before, after};
  });
  ok(po.before && po.after, `a price before the session opens makes no candle; the first one after the open does (${JSON.stringify(po)})`);
  ok(!(await pg.isVisible("#dcPill")), "the test server sends no day figures, so no warning on its own charts");
  await pg.evaluate(D => dataCheck(true, {s: cur.s, ltp: Math.round(D.c * 0.983), o: Math.round(D.o * 1.011), h: D.h, l: Math.round(D.l * 0.975), vol: D.v * 300}), dc.D);
  // (dataCheck works out "market closed" from the clock: open hours give "Last price" only after the close)
  const pill = await pg.evaluate(() => { const p = document.querySelector("#dcPill"); return p ? p.textContent : ""; });
  ok(/don't match Fyers' live figures/.test(pill) && /open/.test(pill) && /low/.test(pill), `the chart shows the warning ("${pill}")`);
  await pg.click("#dcPill"); await pg.waitForTimeout(200);
  const box = await pg.evaluate(() => { const b = document.querySelector("#dcBox"); return b && !b.classList.contains("hide") ? b.textContent : ""; });
  ok(/Candles\s*Fyers live/.test(box) && /Trading isn't affected/.test(box) && /Load again/.test(box), "tapping it shows candles vs Fyers live, side by side, and that trading isn't affected");
  await pg.screenshot({ path: SHOT + "datacheck_warning.png" });
  await pg.evaluate(() => { const c = {...(prefGet("chart", {}) || {}), dataCheck: false}; prefSet("chart", c); });
  await pg.evaluate(D => dataCheck(true, {s: cur.s, ltp: Math.round(D.c * 0.983), o: D.o, h: D.h, l: Math.round(D.l * 0.975), vol: D.v * 300}), dc.D);
  ok(!(await pg.isVisible("#dcPill")), "Chart settings › Check candles against live prices off: no warning");
  await pg.evaluate(() => { const c = {...(prefGet("chart", {}) || {}), dataCheck: true}; prefSet("chart", c); });
  // (the test server's random-walk ticks have built a live bar today; real ticks are the same prices as Fyers' day figures)
  await pg.evaluate(D => { const L = RAW[RAW.length - 1], same = L && Math.floor(L.time / 86400) === Math.floor((HROWS[HROWS.length - 1][0] + IST) / 86400);
    dataCheck(true, {s: cur.s, ltp: D.c, o: D.o, h: same ? Math.max(D.h, L.high) : D.h, l: same ? Math.min(D.l, L.low) : D.l, vol: D.v}); }, dc.D);
  ok(!(await pg.isVisible("#dcPill")) && !(await pg.isVisible("#dcBox")), "figures that match again: the warning goes");

  // ---------------------------------------------------------------- Go to
  await pg.evaluate(() => ctSave({type: "candles"}));
  await pg.waitForFunction(() => DISP.length > 100 && curPlan.res === "2", null, { timeout: 30000 });
  const target = await pg.evaluate(() => { const d = new Date(Date.now() - 20 * 86400000 + IST * 1000); return d.toISOString().slice(0, 10); });
  // a weekday 20 days back at 10:30 (the mock trades every day; Fyers' gaps are covered by "at or just before")
  await pg.keyboard.press("Alt+g");
  await pg.waitForSelector("#goPop:not(.hide)");
  ok(true, "Alt+G opens Go to");
  await pg.fill("#goDay", target); await pg.fill("#goTime", "10:30");
  await pg.screenshot({ path: SHOT + "goto_popup.png" });
  await pg.press("#goTime", "Enter");
  await pg.waitForFunction(() => !goBusy && DISP.length, null, { timeout: 90000 });
  await pg.waitForTimeout(600);
  const g = await pg.evaluate(t => { const vr = chart.timeScale().getVisibleLogicalRange(), mid = Math.round((vr.from + vr.to) / 2), b = DISP[Math.max(0, Math.min(DISP.length - 1, mid))];
    const want = Date.parse(t + "T10:30:00Z") / 1000; return {at: new Date(b.time * 1000).toISOString().slice(0, 16), diff: Math.abs(b.time - want), first: new Date(DISP[0].time * 1000).toISOString().slice(0, 10), now: !document.querySelector("#nowBtn").classList.contains("hide")}; }, target);
  ok(g.diff <= 180 && g.first <= target, `Go to ${target} 10:30: older candles loaded (back to ${g.first}) and the chart is centred on ${g.at}`);
  ok(g.now, "» shows while the latest candle is off screen");
  await pg.screenshot({ path: SHOT + "goto_result.png" });
  await pg.click("#nowBtn"); await pg.waitForTimeout(1200);
  const back = await pg.evaluate(() => { const vr = chart.timeScale().getVisibleLogicalRange(); return {end: vr.to >= DISP.length - 1, hidden: document.querySelector("#nowBtn").classList.contains("hide")}; });
  ok(back.end && back.hidden, "» brings the latest candle back and hides itself");
  // before the contract's listing: the oldest candle, and it says so
  await pg.evaluate(() => setTf("1D")); await pg.waitForFunction(() => curPlan.res === "D" && DISP.length > 50, null, { timeout: 30000 });
  await pg.click("#goBtn"); await pg.waitForSelector("#goPop:not(.hide)");
  ok(!(await pg.$("#goTime")), "on a daily chart Go to asks for a date only");
  const far = await pg.evaluate(() => new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10));
  await pg.fill("#goDay", far); await pg.click("#goPop [data-go]");
  await pg.waitForFunction(() => !goBusy, null, { timeout: 90000 }); await pg.waitForTimeout(600);
  const e = await pg.evaluate(() => ({pill: document.querySelector("#histPill").textContent, from: chart.timeScale().getVisibleLogicalRange().from}));
  ok(/oldest candle Fyers has/.test(e.pill) && e.from < 5, `a date before the listing goes to the oldest candle and says so ("${e.pill}")`);
  // a date on a daily chart lands on that day's candle
  const day = await pg.evaluate(() => new Date(Date.now() - 30 * 86400000 + IST * 1000).toISOString().slice(0, 10));
  await pg.evaluate(dd => goTo(Math.floor(Date.parse(dd + "T23:59:00Z") / 1000) - IST), day);
  await pg.waitForFunction(() => !goBusy, null, { timeout: 30000 }); await pg.waitForTimeout(400);
  const dd = await pg.evaluate(() => { const vr = chart.timeScale().getVisibleLogicalRange(), b = DISP[Math.round((vr.from + vr.to) / 2)]; return new Date(b.time * 1000).toISOString().slice(0, 10); });
  ok(dd === day, `Go to ${day} on 1D lands on that day's candle (${dd})`);
  await pg.evaluate(() => setTf("2m"));
  ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
  await br.close();
})().catch(async e => { console.log("FAIL crashed:", e.message); process.exitCode = 1; if(br) await br.close(); });
