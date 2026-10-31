// Pine compatibility on every chart type (owner's rule: every indicator, every Pine feature, works on P&F too).
// Runs each script of tests/pine_compat.js the way the chart runs it (pineCandles -> the Pine worker), on every
// chart type. A script that works on candles must work on each type: no error, the same plots and drawings, every
// value on a bar of that chart. Needs the mock server and an admin with 2FA (run security_flow.js first).
const { chromium } = require("playwright");
const LOGIN = require("./login.js");
const SCRIPTS = require("./pine_compat.js");
const fs = require("fs");
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const TYPES = ["candles", "hollow", "bars", "line", "area", "ha", "renko", "range", "lb", "pf"];
let br;
(async () => {
  br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.evaluate(async () => { indSave([]); setTf("5m"); await openBySymbol("MCX:CRUDEOIL26NOVFUT"); });
  await pg.waitForFunction(() => DISP.length > 50, null, { timeout: 20000 });
  const base = {};
  for(const t of TYPES){
    // P&F with a 2-point box: hundreds of columns, so slow indicators (MACD 26+9, ADX) have enough bars to show
    await pg.evaluate(t => { if(t === "pf") ctSave({pfMode: "fixed", pfBox: {CRUDEOIL: 2}, pfInd: "mid"}, false); ctSave({type: t}); }, t);
    await pg.waitForFunction(() => DISP.length > 5, null, { timeout: 20000 });
    for(const sc of SCRIPTS){
      const r = await pg.evaluate(async code => {
        const {candles} = pineCandles(1500);
        const set = new Set(candles.map(c => c.openTime));
        const {libs, missing} = await pineLibs(code);          // (imports: TradingView/ta is built in)
        const res = await pineExec({op: "run", code, inputs: {}, libs, missing, candles, ticker: cur.s, tf: pineTf(), info: pineInfo()}, 60000);
        if(!res.ok) return {ok: false, error: res.error, n: candles.length};
        const plots = Object.entries(res.plots || {}).filter(([k, p]) => (p.data || []).some(d => d[1] != null && d[1] !== false));
        const stray = plots.filter(([k, p]) => p.data.some(d => !set.has(d[0]))).map(([k]) => k);
        const draw = Object.entries(res.drawings || {}).filter(([k, v]) => (v || []).length).map(([k]) => k.replace("_overlay", ""));
        return {ok: true, n: candles.length, bars: res.bars, plots: plots.map(([k]) => k), stray, draw, times: res.times.length === candles.length};
      }, sc.code);
      if(t === "candles"){
        base[sc.name] = r;
        if(!r.ok){ ok(true, `candles: "${sc.name}" isn't supported by the Pine engine (${r.error}) - skipped on every type`); continue; }
        const enough = (!sc.plots || r.plots.length >= sc.plots) && (sc.drawings || []).every(k => r.draw.includes(k));
        ok(enough && !r.stray.length && r.times, `candles: "${sc.name}" runs (${r.plots.length} plots${r.draw.length ? ", " + r.draw.join(" ") : ""})`);
        continue;
      }
      const b = base[sc.name];
      if(!b || !b.ok) continue;
      if(!r.ok){ ok(false, `${t}: "${sc.name}" failed: ${r.error}`); continue; }
      const samePlots = b.plots.every(k => r.plots.includes(k));
      const sameDraw = b.draw.every(k => r.draw.includes(k) || ["renko", "range", "lb", "pf"].includes(t) && r.n < 60);   // (few bars: few pivots)
      ok(samePlots && sameDraw && !r.stray.length && r.times,
         `${t}: "${sc.name}" works (${r.n} bars, ${r.plots.length} plots${r.draw.length ? ", " + r.draw.join(" ") : ""}${r.stray.length ? ", OFF-BAR: " + r.stray.join(" ") : ""}${samePlots ? "" : ", missing " + b.plots.filter(k => !r.plots.includes(k)).join(" ")}${sameDraw ? "" : ", missing drawings " + b.draw.filter(k => !r.draw.includes(k)).join(" ")})`);
    }
  }
  // P&F: indicators read the column middle by default, the last box when chosen
  const mid = await pg.evaluate(async () => {
    ctSave({type: "pf"}); await new Promise(r => setTimeout(r, 1500));   // (still the 2-point box)
    const code = '//@version=5\nindicator("C close")\nplot(close, "c")';
    const run = async () => { const {candles} = pineCandles(1500); const res = await pineExec({op: "run", code, inputs: {}, candles, ticker: cur.s, tf: pineTf(), info: pineInfo()}); return res.plots.c.data.slice(-3).map(d => d[1]); };
    const a = await run(); ctSave({pfInd: "last"}, false); const b = await run(); ctSave({pfInd: "mid"}, false);
    const d = DISP.slice(-3);
    return {a, b, mids: d.map(x => (x.high + x.low) / 2), lasts: d.map(x => x.close)};
  });
  ok(JSON.stringify(mid.a) === JSON.stringify(mid.mids), `P&F: Pine's close is the column middle by default (${mid.a.join(", ")})`);
  ok(JSON.stringify(mid.b) === JSON.stringify(mid.lasts), `P&F: or the last box when chosen (${mid.b.join(", ")})`);
  // drawings rendered on a P&F chart: the drawing script on the chart
  await pg.evaluate(async code => {
    await pineLoad(true); const old = PINE.scripts.find(s => s.name === "C Draw");
    const j = await api("/api/scripts/save", {body: {id: old ? old.id : null, name: "C Draw", source: code}}); PINE.scripts = j.scripts; PINE.loaded = true;
    indSave([{type: "pine", id: "pd", scriptId: j.script.id, inputs: {}, overlay: true}]); indBuild();
  }, SCRIPTS.find(s => s.name.startsWith("drawings by bar index")).code);
  await pg.waitForFunction(() => { const r = INDS[0]; return r && r.pine && r.pine.res && !r.pine.err; }, null, { timeout: 30000 })
    .then(() => ok(true, "P&F: a drawing script on the chart (labels, lines, boxes) runs without errors")).catch(() => ok(false, "P&F: a drawing script on the chart runs"));
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: SHOT + "pine_on_pf.png" });
  // the P&F toolkit: trend lines and breaks, signals, anchors, counts, worked out on the chart's own columns
  const tk = await pg.evaluate(async () => {
    indSave([{type: "pftools", id: "tk"}]); indBuild();
    await new Promise(r => setTimeout(r, 1200));
    const r = INDS.find(x => x.cfg.type === "pftools"), T = r && r.res;
    const again = T && CT.pfTools(DISP, CT_SIZE, ctCfg().pfRev || 3, r.cfg);
    return T ? {lines: T.lines.length, broken: T.lines.filter(l => l.broken).length, signals: T.signals.length, fresh: T.signals.filter(s => s.fresh).length,
      anchors: T.anchors.length, counts: T.counts.filter(v => v.active && !v.achieved).length, same: JSON.stringify(again) === JSON.stringify(T),
      hc: T.hcounts.length, hcOpen: T.hcounts.filter(v => !v.achieved).length, pats: T.patterns.length,
      kinds: [...new Set(T.patterns.map(q => q.kind))].join(" "), patOnBar: T.patterns.every(q => q.col < DISP.length && (q.dir === 1 || q.dir === -1)),
      alt: T.lines.every((l, i) => !i || l.dir === -T.lines[i - 1].dir), legend: document.querySelector("#lgd1") && document.querySelector("#lgd1").textContent} : null;
  });
  ok(tk && tk.lines > 1 && tk.broken === tk.lines - 1 && tk.alt, `P&F toolkit: ${tk && tk.lines} trend lines, each broken one followed by the opposite line, the last one running`);
  ok(tk && tk.signals > 0 && tk.fresh > 0, `P&F toolkit: ${tk && tk.signals} buy / sell signals (${tk && tk.fresh} fresh)`);
  ok(tk && tk.anchors >= 0 && tk.same, `P&F toolkit: ${tk && tk.anchors} anchor columns (15+ boxes), ${tk && tk.counts} open vertical counts; matches the analysis of the chart's columns`);
  ok(tk && tk.pats > 0 && tk.patOnBar, `P&F toolkit: ${tk && tk.pats} patterns on the chart's columns (${tk && tk.kinds})`);
  ok(tk && tk.hc > 0, `P&F toolkit: ${tk && tk.hc} horizontal counts (${tk && tk.hcOpen} open)`);
  ok(tk && /bullish|bearish/.test(tk.legend || ""), `P&F toolkit: the read-out shows the trend and the last signal ("${tk && (tk.legend || "").replace(/\s+/g, " ").slice(0, 80)}")`);
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: SHOT + "pf_toolkit.png" });
  await pg.evaluate(() => ctSave({type: "candles"}));
  await pg.waitForTimeout(1500);
  ok(/Point & Figure charts only/.test(await pg.evaluate(() => (document.querySelector("#lgd1") || {}).textContent || "")), "P&F toolkit on a candle chart: says it's for P&F charts, draws nothing");
  await pg.evaluate(() => { indSave([]); indBuild(); ctSave({type: "candles", pfMode: "atr"}); });
  ok(errs.length === 0, "no script errors" + (errs.length ? ": " + errs.slice(0, 4).join(" / ") : ""));
  await br.close();
})().catch(async e => { ok(false, e.message.split("\n")[0]); if(br) await br.close(); });
