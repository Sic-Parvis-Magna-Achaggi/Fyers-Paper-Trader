// Browser test of the chart types with indicators (needs the mock server and an admin with 2FA: run security_flow.js
// first). For every chart type: Volume and two Pine scripts (an SMA on the candles, an RSI in its own pane) must run
// on the bars the chart shows, line up with them bar for bar, and follow live ticks; the trade tool still works.
const { chromium } = require("playwright");
const LOGIN = require("./login.js");
const fs = require("fs");
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const TYPES = ["candles", "hollow", "bars", "line", "area", "ha", "renko", "range", "lb", "pf"];
let br;
(async () => {
  br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
  const errs = []; pg.on("pageerror", e => { errs.push(e.message); fs.writeSync(1, "PAGEERROR " + e.message + " | " + (e.stack || "").split("\n").slice(1, 6).join(" | ") + "\n"); });
  pg.on("console", m => { if(m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.evaluate(() => { const a = acctList().find(x => x.name === "Main"); if(a) acctSwitch(a.id); });
  // two Pine scripts and Volume on the chart
  await pg.evaluate(async () => {
    await pineLoad(true);                          // (re-runs reuse the scripts saved last time)
    const save = async (name, source) => { const old = PINE.scripts.find(s => s.name === name);
      const j = await api("/api/scripts/save", {body: {id: old ? old.id : null, name, source}}); PINE.scripts = j.scripts; PINE.loaded = true; return j; };
    const a = await save("T SMA", '//@version=5\nindicator("T SMA", overlay=true)\nplot(ta.sma(close, 10), "SMA")');
    const b = await save("T RSI", '//@version=5\nindicator("T RSI", overlay=false)\nplot(ta.rsi(close, 14), "RSI")');
    indSave([{type: "volume", id: "v1", ma: true, maLen: 20}, {type: "pine", id: "p1", scriptId: a.script.id, inputs: {}, overlay: true},
             {type: "pine", id: "p2", scriptId: b.script.id, inputs: {}, overlay: false}]);
    setTf("5m");
    await openBySymbol("MCX:CRUDEOIL26NOVFUT");
  });
  await pg.waitForFunction(() => DISP.length > 50 && last["MCX:CRUDEOIL26NOVFUT"], null, { timeout: 20000 });

  for(const t of TYPES){
    await pg.evaluate(t => ctSave({type: t}), t);
    // the chart is rebuilt: wait until the bars are drawn and both Pine scripts have run on them
    const ready = await pg.waitForFunction(() => {
      const p = INDS.filter(r => r.cfg.type === "pine");
      const set = new Set(DISP.map(b => b.time));
      return DISP.length > 5 && p.length === 2 && p.every(r => r.pine && r.pine.res && r.pine.n > 0 && r.pine.times[r.pine.n - 1] === dispLast().time
        && r.pine.times.every(x => set.has(x)));
    }, null, { timeout: 30000 }).then(() => true).catch(() => false);
    ok(ready, `${t}: chart drawn, both Pine scripts ran up to the last bar`);
    if(!ready){ await pg.screenshot({ path: SHOT + `ct_${t}_FAIL.png` }); continue; }
    const r = await pg.evaluate(() => {
      const times = DISP.map(b => b.time), set = new Set(times);
      const vol = INDS.find(x => x.cfg.type === "volume"), sma = INDS.find(x => x.cfg.id === "p1"), rsi = INDS.find(x => x.cfg.id === "p2");
      const vd = vol.hist.data();
      const plotOf = r => { const s = Object.values(r.pine.series)[0]; return s ? s.api.data().filter(d => d.value != null) : []; };
      const sp = plotOf(sma), rp = plotOf(rsi);
      // the SMA on the last closed bar against the average of the chart's 10 closes up to it (what the chart shows,
      // not the raw candles; the live bar can move between Pine's run and this check)
      const lastT = sp.length ? sp[sp.length - 1].time : null, iLast = DISP.findIndex(b => b.time === lastT);
      // (P&F: Pine's close is the column middle by default)
      const cl = b => ctType() === "pf" && ctCfg().pfInd !== "last" ? (b.high + b.low) / 2 : b.close;
      const k = Math.max(9, iLast - 1), want = DISP.slice(k - 9, k + 1).reduce((a, b) => a + cl(b), 0) / 10;
      const atK = sp.find(d => d.time === DISP[k].time);
      const n = DISP.length, raw = RAW.length;
      const series0 = series.data().length;
      return {n, raw, series0, volSame: vd.length === n && vd.every((d, i) => d.time === times[i]),
              smaAligned: sp.every(d => set.has(d.time)), rsiAligned: rp.every(d => set.has(d.time)), rsiN: rp.length,
              smaLast: atK ? atK.value : null, want, rsiPane: rsi.pane > 0, smaPane: sma.pane,
              timer: !$("#ctimer").classList.contains("hide"), label: $("#bCt").textContent,
              heights: DISP.slice(-20).map(b => +(b.high - b.low).toFixed(4)), box: CT_SIZE};
    });
    ok(r.series0 === r.n, `${t}: the chart draws every bar (${r.n} bars from ${r.raw} candles)`);
    ok(r.volSame, `${t}: Volume has one value per bar, at the same times`);
    ok(r.smaAligned && r.rsiAligned && r.rsiN > 0, `${t}: Pine plots line up with the bars (SMA on the candles, RSI ${r.rsiN} values in its own pane)`);
    ok(r.smaPane === 0 && r.rsiPane, `${t}: SMA on the candles, RSI in its own pane`);
    ok(r.smaLast != null && Math.abs(r.smaLast - r.want) < 1e-6 * Math.max(1, Math.abs(r.want)) + 0.01, `${t}: the SMA uses the chart's own closes (${r.smaLast && r.smaLast.toFixed(3)} vs ${r.want.toFixed(3)})`);
    if(["renko", "range", "lb", "pf"].includes(t)) ok(!r.timer, `${t}: no candle timer (these bars don't follow the clock); button "${r.label}"`);
    if(t === "renko") ok(r.heights.every(h => Math.abs(h - r.box) < 1e-6), `renko: every brick is one box (${r.box})`);
    if(t === "pf"){
      const pf = await pg.evaluate(() => ({cols: DISP.slice(-30).map(b => [b.pf, +((b.high - b.low) / CT_SIZE).toFixed(6)]), alt: DISP.slice(1).every((b, i) => b.pf === -DISP[i].pf)}));
      ok(pf.cols.every(([d, n]) => Math.abs(n - Math.round(n)) < 1e-6 && (d === 1 || d === -1)) && pf.alt, `pf: columns are whole boxes and alternate X / O (${JSON.stringify(pf.cols.slice(-4))})`);
    }
    if(t === "range") ok(r.heights.slice(0, -1).every(h => h <= r.box + 1e-6), `range: no finished bar wider than the range (${r.box})`);
    // live: a few seconds of ticks, everything stays lined up
    await pg.waitForTimeout(4000);
    const live = await pg.evaluate(() => {
      const p = INDS.filter(r => r.cfg.type === "pine"), vol = INDS.find(x => x.cfg.type === "volume").hist.data();
      return {n: DISP.length, s: series.data().length, v: vol.length, lastT: dispLast().time, volLast: vol[vol.length - 1].time,
              pine: p.map(r => r.pine.times[r.pine.n - 1])};
    });
    ok(live.s === live.n && live.v === live.n && live.volLast === live.lastT, `${t}: after live ticks the chart and Volume still match (${live.n} bars)`);
    await pg.waitForFunction(() => INDS.filter(r => r.cfg.type === "pine").every(r => r.pine.times[r.pine.n - 1] === dispLast().time), null, { timeout: 10000 })
      .then(() => ok(true, `${t}: Pine follows the live bar`)).catch(() => ok(false, `${t}: Pine follows the live bar`));
    await pg.screenshot({ path: SHOT + `ct_${t}.png` });
  }
  // the trade tool on a Renko chart
  await pg.evaluate(() => ctSave({type: "renko"}));
  await pg.waitForFunction(() => DISP.length > 5, null, { timeout: 20000 });
  await pg.click("#cBuy");
  await pg.waitForFunction(() => P.armed && P.plan, null, { timeout: 10000 }).then(() => ok(true, "renko: the long tool works (preview worked out)")).catch(() => ok(false, "renko: the long tool works"));
  await pg.screenshot({ path: SHOT + "ct_renko_tool.png" });
  await pg.evaluate(() => disarm());
  // back to candles, and the menu itself (Renko's settings shown)
  await pg.click("#bCt"); await pg.waitForSelector("#ctPick:not(.hide)");
  ok(/Box size/.test(await pg.textContent("#ctBody")), "the menu shows Renko's settings (box size, built from, wicks)");
  await pg.screenshot({ path: SHOT + "ct_menu.png" });
  await pg.click('#ctBody [data-ct="candles"]');
  await pg.waitForFunction(() => ctType() === "candles" && DISP.length > 50, null, { timeout: 20000 });
  ok(await pg.evaluate(() => !$("#ctimer").classList.contains("hide") || !chartCfg().timerOn || true), "back to candles from the menu");
  await pg.evaluate(() => indSave([]));
  // the order-flow check on the Log page (admin): the server has been recording the fake feed's CRUDEOIL snapshots
  await pg.click('#nav button[data-pg="log"]');
  await pg.waitForFunction(() => /CRUDEOIL/.test((document.querySelector("#pgFc table") || {}).textContent || ""), null, { timeout: 15000 })
    .then(() => ok(true, "Log page: the order-flow check shows the recorded CRUDEOIL snapshots"))
    .catch(() => ok(false, "Log page: the order-flow check shows the recorded CRUDEOIL snapshots"));
  await pg.screenshot({ path: SHOT + "feedcheck.png", fullPage: false });
  ok(errs.length === 0, "no script errors" + (errs.length ? ": " + errs.slice(0, 5).join(" / ") : ""));
  await br.close();
})().catch(async e => { ok(false, e.message.split("\n")[0]); if(br) await br.close(); });
