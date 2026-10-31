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
