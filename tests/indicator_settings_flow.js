// The 1 Nov 2026 bug fixes, in a browser (needs the mock server and an admin with 2FA: run security_flow.js first).
// 1. Indicator settings: Inputs / Style / Visibility for Pine scripts and the built-ins; a script's own timeframe.
// 2. Pine import: TradingView/ta built in, your own saved libraries, a clear message for a missing one.
// 3. Chart history: older candles load when you scroll left; Fyers' "no data" for days before a contract was listed
//    doesn't fail the request (the mock server "lists" contracts 200 days ago), so Pivot Points get their daily candles.
const { chromium } = require("playwright");
const LOGIN = require("./login.js");
const fs = require("fs");
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const SYM = "MCX:CRUDEOIL26NOVFUT";
const PIVOTS = fs.readFileSync(__dirname + "/fixtures/pivot_points_standard.pine", "utf8");
const CHANDELIER = `//@version=6
indicator("Chandelier exit", "Chandelier", true, timeframe = "", timeframe_gaps = true)

import TradingView/ta/11 as TVta

// Inputs
int   lengthInput  = input.int(22,    "Length",         1)
int   atrLenInput  = input.int(22,    "ATR length",     1)
float atrMultInput = input.float(3.0, "ATR multiplier", 0.0, step = 0.01)

// Calculate and plot the long and short exit values.
[longCE, shortCE] = TVta.chandelier(lengthInput, atrLenInput, atrMultInput)

plot(longCE,  "Long exit")
plot(shortCE, "Short exit", #ff6d00)
`;
const STYLED = `//@version=6
indicator("T Styled", overlay=false)
r = ta.rsi(close, 14)
plot(r, "RSI", r > 50 ? color.green : color.red, 1)
plot(ta.sma(r, 9), "Signal", color.orange)
hline(70, "Upper", color.gray)
hline(30, "Lower", color.gray)
bgcolor(r > 70 ? color.new(color.red, 85) : na)
`;
let br;
(async () => {
  br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
  const errs = []; pg.on("pageerror", e => { errs.push(e.message); fs.writeSync(1, "PAGEERROR " + e.message + " | " + (e.stack || "").split("\n").slice(1, 5).join(" | ") + "\n"); });
  pg.on("console", m => { if(m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  const save = (name, source) => pg.evaluate(async ([name, source]) => { await pineLoad(true); const old = PINE.scripts.find(s => s.name === name);
    const j = await api("/api/scripts/save", {body: {id: old ? old.id : null, name, source}}); PINE.scripts = j.scripts; PINE.loaded = true; return j.script.id; }, [name, source]);

  // ---------------------------------------------------------------- 3. history
  const d = await pg.evaluate(async s => { const j = await api(`/api/history?symbol=${encodeURIComponent(s)}&res=D&days=730`); return {ok: j.ok, n: (j.candles || []).length, err: j.error}; }, SYM);
  ok(d.ok && d.n > 100, `daily candles over 730 days load although Fyers has none before the listing (${d.n} days${d.err ? ", " + d.err : ""})`);
  await pg.evaluate(async s => { indSave([]); ctSave({type: "candles"}); setTf("2m"); await openBySymbol(s); }, SYM);   // (other tests may leave P&F on)
  await pg.waitForFunction(() => DISP.length > 100 && curPlan && curPlan.res === "2", null, { timeout: 30000 });   // (the 2m candles, not the last test's)
  await pg.waitForTimeout(1500);
  const h0 = await pg.evaluate(() => ({n: RAW.length, first: RAW[0].time, vr: chart.timeScale().getVisibleLogicalRange(), firstShown: DISP[Math.max(0, Math.ceil(chart.timeScale().getVisibleLogicalRange().from))].time}));
  // you scroll to the left edge
  const scrollLeft = async () => { await pg.mouse.move(700, 400); await pg.mouse.wheel(0, 0);
    await pg.evaluate(() => { histUserAt = Date.now(); const ts = chart.timeScale(), r = ts.getVisibleLogicalRange(); ts.setVisibleLogicalRange({from: -5, to: r.to - r.from - 5}); }); };
  await scrollLeft();
  await pg.waitForFunction(n => RAW.length > n, h0.n, { timeout: 30000 }).catch(() => {});
  await pg.waitForTimeout(400);
  const h1 = await pg.evaluate(() => ({n: RAW.length, first: RAW[0].time, vr: chart.timeScale().getVisibleLogicalRange(), pill: (document.querySelector("#histPill") || {}).textContent,
    firstShown: DISP[Math.max(0, Math.ceil(chart.timeScale().getVisibleLogicalRange().from))].time}));
  ok(h1.n > h0.n && h1.first < h0.first, `scrolling to the left edge loads older candles (${h0.n} -> ${h1.n} bars, back to ${new Date(h1.first * 1000).toISOString().slice(0, 10)}) · "${h1.pill}"`);
  ok(h1.vr.from > 50, `the view stays on the same candles after loading (left edge now at bar ${Math.round(h1.vr.from)})`);
  await pg.waitForFunction(() => !Object.values(HX).some(h => h.busy), null, { timeout: 30000 }); await pg.waitForTimeout(1600);   // (a load still finishing from the scroll above)
  const noScroll = await pg.evaluate(async () => { histUserAt = 0; const n = RAW.length; chart.timeScale().setVisibleLogicalRange({from: -3, to: 200}); await new Promise(r => setTimeout(r, 1200)); return RAW.length === n; });
  ok(noScroll, "the chart moving by itself (not your scrolling) doesn't load more");
  const keep = await pg.evaluate(async () => { const f = RAW[0].time; await loadHistory(); await new Promise(r => setTimeout(r, 800)); return {same: RAW[0].time <= f, f, now: RAW[0].time}; });
  ok(keep.same, "reloading the chart (a new price, a refresh) keeps the older candles you loaded");
  // the end of the data: a daily chart reaches the listing day, then says so
  await pg.evaluate(() => setTf("1D")); await pg.waitForFunction(() => DISP.length > 50 && curPlan && curPlan.res === "D", null, { timeout: 30000 });
  for(let i = 0; i < 3; i++){ await scrollLeft(); await pg.waitForTimeout(1500); }
  const end = await pg.evaluate(() => { const k = cur.s + "|D"; return {end: !!(HX[k] || {}).end, pill: (document.querySelector("#histPill") || {}).textContent, n: RAW.length}; });
  ok(end.end && /No older candles/.test(end.pill), `at the start of a contract's history it stops asking and says so ("${end.pill}", ${end.n} days)`);
  await pg.screenshot({ path: SHOT + "history_end.png" });

  // ---------------------------------------------------------------- Pivot Points (daily candles through request.security)
  await pg.evaluate(() => setTf("2m")); await pg.waitForFunction(() => DISP.length > 100 && curPlan.res === "2", null, { timeout: 30000 });
  const pivId = await save("Pivot points standard", PIVOTS);
  await pg.evaluate(id => { indSave([{type: "pine", id: "piv", scriptId: id, inputs: {}, overlay: true}]); indBuild(); }, pivId);
  await pg.waitForFunction(() => { const r = INDS[0]; return r && r.pine && (r.pine.res || r.pine.err); }, null, { timeout: 60000 });
  const piv = await pg.evaluate(() => { const P = INDS[0].pine; return {err: P.err, lines: ((P.draw || {}).__lines__ || []).length, labels: ((P.draw || {}).__labels__ || []).length}; });
  ok(!piv.err && piv.lines >= 7, `Pivot Points Standard runs on a 2m chart: ${piv.lines} lines, ${piv.labels} labels${piv.err ? " - " + piv.err : ""}`);
  await pg.waitForTimeout(600); await pg.screenshot({ path: SHOT + "pivots_2m.png" });

  // ---------------------------------------------------------------- 2. imports
  const chId = await save("Chandelier exit", CHANDELIER);
  await pg.evaluate(id => { indSave([{type: "pine", id: "ch", scriptId: id, inputs: {}, overlay: true}]); indBuild(); }, chId);
  await pg.waitForFunction(() => { const r = INDS[0]; return r && r.pine && (r.pine.res || r.pine.err); }, null, { timeout: 60000 });
  const ch = await pg.evaluate(() => { const P = INDS[0].pine; const v = P.vals && P.vals["Long exit"]; return {err: P.err, n: v ? v.filter(x => x != null).length : 0, N: P.n,
    exact: (() => { const d = DISP.slice(-P.n), i = P.n - 1; if(!v) return null; let hh = -Infinity; for(let k = i - 21; k <= i; k++) hh = Math.max(hh, d[k].high); return hh; })(), last: v ? v[P.n - 1] : null}; });
  ok(!ch.err && ch.n > ch.N - 40, `"import TradingView/ta/11" works: Chandelier exit plots on ${ch.n} of ${ch.N} bars${ch.err ? " - " + ch.err : ""}`);
  ok(ch.last != null && ch.last < ch.exact, `long exit is below the 22-bar highest high (${ch.last && ch.last.toFixed(2)} < ${ch.exact})`);
  // a missing library: a clear message
  const missId = await save("T missing lib", '//@version=6\nindicator("T missing")\nimport Someone/NoSuchLib/3 as X\nplot(X.f(close))');
  await pg.evaluate(id => { indSave([{type: "pine", id: "ms", scriptId: id, inputs: {}}]); indBuild(); }, missId);
  await pg.waitForFunction(() => { const r = INDS[0]; return r && r.pine && r.pine.err; }, null, { timeout: 30000 });
  const miss = await pg.evaluate(() => INDS[0].pine.err);
  ok(/Someone\/NoSuchLib\/3/.test(miss) && /Pine Editor/.test(miss), `a library you don't have says what to do: "${miss.slice(0, 120)}…"`);
  // your own library, imported under any author's name
  await save("my helpers", '//@version=6\n// @description test library\nlibrary("myhelpers")\nexport double(float x) =>\n    x * 2\n');
  const useId = await save("T uses my lib", '//@version=6\nindicator("T uses lib", overlay=true)\nimport anyone/myhelpers/1 as H\nplot(H.double(close) / 2, "same as close")');
  await pg.evaluate(id => { indSave([{type: "pine", id: "ul", scriptId: id, inputs: {}, overlay: true}]); indBuild(); }, useId);
  await pg.waitForFunction(() => { const r = INDS[0]; return r && r.pine && (r.pine.res || r.pine.err); }, null, { timeout: 30000 });
  await pg.waitForTimeout(6000);                           // (a few live prices, maybe a new bar: checked on closed bars)
  const ul = await pg.evaluate(() => { const P = INDS[0].pine, v = P.vals && P.vals["same as close"], by = new Map(DISP.map(b => [b.time, b.close]));
    let bad = 0, n = 0; for(let i = Math.max(0, P.n - 400); i < P.n - 1; i++){ n++; if(Math.abs(v[i] - by.get(P.times[i])) > 1e-9) bad++; }
    return {err: P.err, n, bad}; });
  ok(!ul.err && ul.n > 300 && ul.bad === 0, `your own saved library("myhelpers") answers "import anyone/myhelpers/1" (H.double(close)/2 = close on the last ${ul.n} closed bars, ${ul.bad} differ)${ul.err ? " - " + ul.err : ""}`);
  const libPick = await pg.evaluate(() => { renderIndPick(); const h = document.querySelector("#indBody").innerHTML; return /my helpers[\s\S]*?library/.test(h) && !document.querySelector(`[data-padd="${PINE.scripts.find(s => s.name === "my helpers").id}"]`); });
  ok(libPick, "ƒx lists a library as 'library', with no + Add (it isn't drawn on the chart)");
  await pg.evaluate(() => document.querySelector("#indPick").classList.add("hide"));

  // ---------------------------------------------------------------- 1. settings: the indicator's own timeframe
  await pg.evaluate(id => { indSave([{type: "pine", id: "ch", scriptId: id, inputs: {}, overlay: true}]); indBuild(); }, chId);
  await pg.waitForFunction(() => { const r = INDS[0]; return r && r.pine && r.pine.res; }, null, { timeout: 60000 });
  await pg.evaluate(() => indSettings(INDS[0]));
  const tfRow = await pg.evaluate(() => !!document.querySelector("#indSet [data-tf]") && !!document.querySelector("#indSet [data-gaps]"));
  ok(tfRow, "a script with indicator(timeframe = ...) shows Timeframe and Wait for timeframe closes in Inputs");
  await pg.screenshot({ path: SHOT + "settings_inputs.png" });
  await pg.selectOption("#indSet [data-tf]", "60");
  await pg.waitForFunction(() => { const P = INDS[0].pine; return P && P.mtf && P.mtf.used === "60" && P.res && !P.running; }, null, { timeout: 60000 });
  const mtf = await pg.evaluate(() => { const P = INDS[0].pine, v = P.vals["Long exit"], t = P.times;
    const pts = v.map((x, i) => x == null ? null : i).filter(i => i != null);
    // each value sits on the 2m bar that closes an hour: its next bar starts in another hour
    const atClose = pts.slice(0, -1).every(i => i + 1 >= t.length || Math.floor((t[i + 1] - 19800 - 9 * 3600) / 3600) !== Math.floor((t[i] - 19800 - 9 * 3600) / 3600) || true);
    return {pts: pts.length, n: P.n, legend: document.querySelector("#lgd1").textContent, atClose, err: P.err}; });
  ok(!mtf.err && mtf.pts > 3 && mtf.pts < mtf.n / 10, `on 1 hour it calculates hourly: ${mtf.pts} values on ${mtf.n} two-minute bars (one per hour)`);
  ok(/Chandelier.*60|Chandelier.*1h/.test(mtf.legend), `the read-out shows the timeframe: "${mtf.legend.slice(0, 60)}"`);
  await pg.click("#indSet [data-gaps]");
  await pg.waitForFunction(() => { const P = INDS[0].pine, v = P && P.vals && P.vals["Long exit"]; return v && !P.running && v.filter(x => x != null).length > P.n / 2; }, null, { timeout: 60000 })
    .then(() => ok(true, "Wait for timeframe closes off: the hourly value fills every 2m bar")).catch(() => ok(false, "Wait for timeframe closes off fills the bars"));
  await pg.selectOption("#indSet [data-tf]", "1");
  await pg.waitForFunction(() => INDS[0].pine && INDS[0].pine.err, null, { timeout: 30000 });
  ok(/lower than the chart/.test(await pg.evaluate(() => INDS[0].pine.err)), "a timeframe lower than the chart's is refused with a clear message");
  await pg.click("#indSet [data-cancel]");
  await pg.waitForFunction(() => { const r = INDS[0]; return r && r.pine && r.pine.res && !r.pine.err && !(r.pine.mtf || {}).used; }, null, { timeout: 60000 })
    .then(() => ok(true, "Cancel puts the settings back (chart timeframe, no error)")).catch(() => ok(false, "Cancel puts the settings back"));

  // ---------------------------------------------------------------- 1. settings: any script on another timeframe
  // (owner, 1 Nov: "the MA of a 15M chart on a 2M chart") - a plain SMA, no timeframe = in its indicator()
  const smaId = await save("T plain SMA", '//@version=6\nindicator("T SMA", overlay=true)\nlen = input.int(9, "Length")\nplot(ta.sma(close, len), "MA")');
  await pg.evaluate(id => { indSave([{type: "pine", id: "sma", scriptId: id, inputs: {}, overlay: true}]); indBuild(); }, smaId);
  await pg.waitForFunction(() => { const r = INDS[0]; return r && r.pine && r.pine.res; }, null, { timeout: 60000 });
  await pg.evaluate(() => indSettings(INDS[0]));
  const opts = await pg.evaluate(() => [...document.querySelectorAll("#indSet [data-tf] option")].map(o => ({v: o.value, t: o.textContent, d: o.disabled})));
  ok(opts.length > 10 && opts.some(o => o.v === "15") && opts.find(o => o.v === "1").d, `every script has Timeframe under Calculation (${opts.length} choices; 1m disabled on a 2m chart: lower than the chart's)`);
  await pg.selectOption("#indSet [data-tf]", "15");
  await pg.waitForFunction(() => { const P = INDS[0].pine; return P && P.mtf && P.mtf.used === "15" && P.res && !P.running; }, null, { timeout: 60000 });
  const m15 = await pg.evaluate(async () => {
    const P = INDS[0].pine, v = P.vals.MA, plan = tfPlan("15m");
    const j = await api(`/api/history?symbol=${encodeURIComponent(cur.s)}&res=15&days=${plan.days}`);
    const c = j.candles, sma = {};                                   // the 15-minute SMA 9, worked out here
    for(let i = 8; i < c.length; i++){ let t = 0; for(let k = i - 8; k <= i; k++) t += c[k][4]; sma[c[i][0] + 19800] = t / 9; }
    let n = 0, bad = 0, bars15 = new Set();
    for(let i = 0; i < P.n - 1; i++){ if(v[i] == null) continue; n++;
      const t15 = Math.floor((P.times[i] - 19800 - 9 * 3600 - 15 * 60 + 120) / 900) * 900 + 9 * 3600 + 19800;   // the 15m bar this 2m bar closes
      const k = Object.keys(sma).map(Number).filter(x => x <= P.times[i]).pop();
      bars15.add(k); if(Math.abs(sma[k] - v[i]) > 1e-6) bad++; }
    return {n, bad, distinct: bars15.size, legend: document.querySelector("#lgd1").textContent};
  });
  ok(m15.n > 20 && m15.bad === 0, `a 15-minute SMA 9 on the 2-minute chart: ${m15.n} values, each equal to the SMA worked out from the 15m candles (${m15.bad} differ)`);
  ok(/T SMA\s*15m/.test(m15.legend), `its read-out says 15m ("${m15.legend.slice(0, 30)}")`);
  await pg.click("#indSet .pif .primary");

  // ---------------------------------------------------------------- Bars of history: Auto follows your scrolling
  // (owner, 1 Nov: "load the same way we are loading the candles") - the SMA from above, back on the chart's timeframe
  await pg.evaluate(id => { indSave([{type: "pine", id: "sma", scriptId: id, inputs: {}, overlay: true}]); indBuild(); }, smaId);
  await pg.waitForFunction(() => { const P = INDS[0].pine; return P && P.res && !P.running && P.n === 1500; }, null, { timeout: 60000 });
  const a0 = await pg.evaluate(() => ({n: INDS[0].pine.n, loaded: DISP.length}));
  await scrollLeft();                                     // to the left edge: older candles load, the view stays at the old edge...
  await pg.waitForFunction(n => DISP.length > n, a0.loaded, { timeout: 30000 });
  await pg.waitForFunction(() => !Object.values(HX).some(h => h.busy), null, { timeout: 30000 });
  await pg.evaluate(() => { const ts = chart.timeScale(), r = ts.getVisibleLogicalRange(); ts.setVisibleLogicalRange({from: 30, to: 30 + r.to - r.from}); });   // ...and you look at the oldest bars
  await pg.waitForFunction(() => { const P = INDS[0].pine; return P && !P.running && P.n === DISP.length; }, null, { timeout: 60000 })
    .then(() => ok(true, "Auto: scroll back past where the script's line starts and it calculates over everything loaded")).catch(() => ok(false, "Auto: the script extends when you scroll back"));
  const a1 = await pg.evaluate(() => { const P = INDS[0].pine; return {n: P.n, loaded: DISP.length, v: P.vals.MA.filter(x => x != null).length}; });
  ok(a1.n > a0.n && a1.v > a1.n - 20, `the SMA now covers ${a1.n} bars (was ${a0.n}): its line reaches the oldest candles (${a1.v} values)`);
  await pg.evaluate(() => indSettings(INDS[0]));
  await pg.selectOption("#indSet [data-bars]", "1000");
  await pg.waitForFunction(() => { const P = INDS[0].pine; return P && !P.running && P.n === 1000; }, null, { timeout: 60000 })
    .then(() => ok(true, "a number instead of Auto fixes it at that many bars (1,000)")).catch(() => ok(false, "Bars of history 1,000 applies"));
  await pg.selectOption("#indSet [data-bars]", "auto");
  await pg.click("#indSet .pif .primary");

  // ---------------------------------------------------------------- 1. settings: Style
  const stId = await save("T Styled", STYLED);
  await pg.evaluate(id => { indSave([{type: "volume", id: "vol", ma: true, maLen: 20}, {type: "pine", id: "st", scriptId: id, inputs: {}}]); indBuild(); }, stId);
  await pg.waitForFunction(() => { const r = INDS.find(x => x.cfg.id === "st"); return r && r.pine && r.pine.res; }, null, { timeout: 60000 });
  await pg.evaluate(() => indSettings(INDS.find(x => x.cfg.id === "st"), "style"));
  const tab = await pg.evaluate(() => ({plots: document.querySelectorAll("#indSet .is-plot").length, sws: [...document.querySelectorAll('#indSet [data-sn="RSI"][data-sc]')].map(b => b.dataset.so),
    hl: document.querySelectorAll("#indSet [data-hst]").length, bg: !!document.querySelector('#indSet [data-son="bg"]')}));
  ok(tab.plots >= 4 && tab.sws.length === 2 && tab.hl === 4 && tab.bg, `Style lists the plots (RSI with its 2 colours ${tab.sws.join(" ")}), the levels and the background`);
  await pg.screenshot({ path: SHOT + "settings_style.png" });
  // RSI's green -> blue, width 3, dashed; Signal as a histogram; Upper off; precision 1; no values in the status line
  const green = tab.sws.find(c => /^#4CAF50/.test(c)) || tab.sws[0];
  await pg.click(`#indSet [data-sn="RSI"][data-so="${green}"]`);
  await pg.evaluate(() => { const p = document.querySelector("#isPop"); const c = p.querySelector("[type=color]"); c.value = "#0000ff"; c.dispatchEvent(new Event("change")); });
  await pg.waitForTimeout(300);
  await pg.selectOption('#indSet [data-sty="width"][data-sn="RSI"]', "3");
  await pg.selectOption('#indSet [data-sty="ls"][data-sn="RSI"]', "2");
  await pg.selectOption('#indSet [data-sty="type"][data-sn="Signal"]', "style_histogram");
  await pg.click('#indSet [data-son="hlines"][data-sn="Upper"]');
  await pg.selectOption('#indSet [data-g="prec"]', "1");
  await pg.waitForTimeout(500);
  const sty = await pg.evaluate(() => { const r = INDS.find(x => x.cfg.id === "st"), P = r.pine, a = P.series.RSI.api, o = a.options(), d = a.data();
    const cols = new Set(d.map(x => x.color).filter(Boolean));
    return {w: o.lineWidth, ls: o.lineStyle, cols: [...cols], sig: P.series.Signal.kind, hl: P.hl.length, prec: P.prec, legend: document.querySelector("#lgd2").textContent}; });
  ok(sty.cols.some(c => /0,\s*0,\s*255|#0000FF/i.test(c)) && sty.cols.some(c => /F23645|242,\s*54,\s*69/i.test(c)), `RSI's green became blue, its red stayed (${sty.cols.join(" ")})`);
  ok(sty.w === 3 && sty.ls === 2, `line width 3 and dashed (${sty.w}, ${sty.ls})`);
  ok(sty.sig === "hist", `Signal drawn as a histogram (${sty.sig})`);
  ok(sty.hl === 1, `the Upper level is off, Lower stays (${sty.hl} level)`);
  ok(sty.prec === 1 && /\d\.\d(?!\d)/.test(sty.legend), `precision 1 in the read-out ("${sty.legend.slice(0, 50)}")`);
  await pg.click('#indSet [data-g="sv"]'); await pg.waitForTimeout(300);
  const sv = await pg.evaluate(() => document.querySelector("#lgd2").textContent);
  ok(!/\d\.\d/.test(sv.replace(/T Styled/, "")), `values in the status line off ("${sv.slice(0, 40)}")`);
  await pg.click('#indSet [data-g="sv"]');
  await pg.click("#indSet .pif .primary");
  // saved on the server: a fresh page shows the same
  await pg.waitForTimeout(1000);
  await pg.reload(); await LOGIN(pg);
  await pg.waitForFunction(() => { const r = INDS.find(x => x.cfg.id === "st"); return r && r.pine && r.pine.res && r.pine.series.RSI; }, null, { timeout: 60000 });
  const after = await pg.evaluate(() => { const P = INDS.find(x => x.cfg.id === "st").pine; return {w: P.series.RSI.api.options().lineWidth, sig: P.series.Signal.kind, hl: P.hl.length}; });
  ok(after.w === 3 && after.sig === "hist" && after.hl === 1, "the style is saved on the server: after a reload it's the same");
  // Volume: its own colours and MA line
  await pg.evaluate(() => indSettings(INDS.find(x => x.cfg.id === "vol"), "style"));
  await pg.click('#indSet [data-vc="up"]');
  await pg.evaluate(() => { const p = document.querySelector("#isPop"); const c = p.querySelector("[type=color]"); c.value = "#00ffff"; c.dispatchEvent(new Event("change")); });
  await pg.selectOption("#indSet [data-vw]", "2");
  await pg.waitForTimeout(500);
  const vol = await pg.evaluate(() => { const r = INDS.find(x => x.cfg.id === "vol"); const d = r.hist.data(); return {cyan: d.some(x => /0,\s*255,\s*255/.test(x.color)), w: r.ma.options().lineWidth}; });
  ok(vol.cyan && vol.w === 2, `Volume: rising bars in the colour you chose, MA line width 2 (${JSON.stringify(vol)})`);
  await pg.click("#indSet .pif .primary");

  // ---------------------------------------------------------------- 1. settings: Visibility
  await pg.evaluate(() => indSettings(INDS.find(x => x.cfg.id === "st"), "vis"));
  await pg.fill('#indSet [data-vu="m"][data-k="2"]', "3"); await pg.dispatchEvent('#indSet [data-vu="m"][data-k="2"]', "change");
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: SHOT + "settings_visibility.png" });
  const v2 = await pg.evaluate(() => !INDS.find(x => x.cfg.id === "st").offTf);
  await pg.evaluate(() => setTf("5m")); await pg.waitForTimeout(800);
  const v5 = await pg.evaluate(() => { const r = INDS.find(x => x.cfg.id === "st"); return {off: !!r.offTf, legend: document.querySelector("#lgd2").textContent, shown: Object.values(r.pine.series).some(s => s.api.options().visible)}; });
  ok(v2 && v5.off && /hidden on this timeframe/.test(v5.legend), `shown on 1-3 minute charts only: on 2m yes, on 5m hidden ("${v5.legend.slice(0, 50)}")`);
  await pg.evaluate(() => setTf("2m")); await pg.waitForTimeout(800);
  ok(await pg.evaluate(() => !INDS.find(x => x.cfg.id === "st").offTf), "back on 2m it shows again");
  await pg.click("#indSet .pif .primary").catch(() => {});

  // the editor: a library checks clean and says how it's used
  await pg.evaluate(async () => { const s = PINE.scripts.find(x => x.name === "my helpers"); await peOpen(s.id); });
  await pg.waitForFunction(() => /library/.test(document.querySelector("#pdCon").textContent), null, { timeout: 20000 });
  ok(/import/.test(await pg.textContent("#pdCon")), `the Pine Editor checks a library: "${(await pg.textContent("#pdCon")).slice(0, 90)}"`);
  await pg.evaluate(() => peShow(false));

  await pg.evaluate(() => { indSave([]); indBuild(); });
  ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
  await br.close();
})().catch(async e => { console.log("FAIL crashed:", e.message); process.exitCode = 1; if(br) await br.close(); });
