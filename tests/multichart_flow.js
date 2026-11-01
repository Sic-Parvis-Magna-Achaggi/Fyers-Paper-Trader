// Multi-charts (v0.24.0, roadmap item 6), in a real browser: the Grid menu; a 2×2 grid of charts, each its own
// (contract, timeframe, chart type, indicators); the active chart (click) is what the watchlist / Find, BUY / SELL and
// the Pine Editor act on; saved in the layout (a reload brings the grid back); the crosshair follows across charts (and
// can be switched off); a drawing shows on every chart of its contract; ⛶ shows one chart big; back to one chart; the
// phone (one chart at a time, numbered buttons).
// Needs the mock server and an admin with 2FA (run security_flow.js first).
const { chromium, devices } = require("playwright");
const LOGIN = require("./login.js");
const fs = require("fs"), path = require("path");
const D = process.env.FYERS_HELPER_DATA || ".";
const SHOT = D + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const NOV = "MCX:CRUDEOIL26NOVFUT", DEC = "MCX:CRUDEOIL26DECFUT";
let br;
(async () => {
  br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1500, height: 920 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  // a clean start: one chart (November, 5m, candles, no indicators), no saved layouts, no drawings on NOV
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.waitForFunction(() => typeof LAY !== "undefined" && P.snap, null, { timeout: 20000 });
  const row = await pg.evaluate(async s => (await api("/api/symbol?s=" + encodeURIComponent(s))).row, NOV);
  await pg.evaluate(async s => { await api("/api/drawings", {body: {s, items: []}}); await papi("reset", {confirm: "RESET", capital: 1000000}); }, NOV);
  await pg.goto("about:blank");
  await ctx.request.post("http://localhost:8766/api/prefs", {data: {cur: {s: row.s, d: row.d, tick: row.tick, lot: row.lot, mult: row.mult, sess: row.sess}, ctype: {type: "candles"}, indicators: [], tf2: "5m", chart: {}, layAuto: true}, headers: {Origin: "http://localhost:8766"}});
  for(const u of fs.existsSync(D + "/u") ? fs.readdirSync(D + "/u") : []){ const f = path.join(D, "u", u, "layouts.json"); if(fs.existsSync(f)) fs.unlinkSync(f); }
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.waitForFunction(() => typeof LAY !== "undefined" && LAY.ready && DISP.length > 20, null, { timeout: 25000 });
  const info = () => pg.evaluate(() => [...document.querySelectorAll("#mcGrid iframe")].map((f, k) => { const w = mcWin(k); return w && w.cellInfo ? w.cellInfo() : null; }));
  const ready = n => pg.waitForFunction(n => document.querySelectorAll("#mcGrid iframe").length === n && [...Array(n).keys()].every(k => { const w = mcWin(k); return w && w.cellInfo && w.cellInfo().n > 20; }), n, { timeout: 45000 });
  const lay = () => pg.evaluate(async () => { const j = await api("/api/layouts"); return j.layouts.find(l => l.id === j.active); });
  const frame = k => pg.frames().find(f => new RegExp("[?&]cell=" + k + "(&|$)").test(f.url()));
  const cellBox = k => pg.locator(`#mcGrid .mc-cell[data-i="${k}"]`).boundingBox();

  // ---- the Grid menu: 2×2
  ok(await pg.isVisible("#bGrid") && !(await pg.isVisible("#mcGrid")), "one chart to start; the Grid button is on the chart bar");
  await pg.click("#bGrid"); await pg.waitForTimeout(200);
  ok(await pg.isVisible("#gridPick") && await pg.evaluate(() => document.querySelectorAll("#gridPick [data-g]").length) === 5, "Grid menu: 1, 2 side by side, 2 stacked, 3, 2×2");
  await pg.click('#gridPick [data-g="4"]');
  await ready(4); await pg.waitForTimeout(1200);
  let inf = await info();
  ok(inf.length === 4 && inf.every(c => c.s === NOV && c.tf === "5m" && c.n > 20), "2×2: four charts, each loads (copies of the chart you had)");
  ok(inf.slice(1).every(c => !c.tb), "the new charts start with the drawing toolbar closed (✎ opens it)");
  let L = await lay();
  ok(L.grid === "4" && L.charts.length === 4, "the layout keeps the grid and its four charts (saved)");
  ok(!(await pg.isVisible("#chart")) && await pg.evaluate(() => document.querySelector(".mc-cell.on").dataset.i === "0"), "the page's own chart steps aside; chart 1 is active");
  await pg.screenshot({ path: SHOT + "multichart_2x2.png" });

  // ---- each chart its own: the active chart takes the watchlist / Find; a timeframe, a chart type, an indicator in one
  const b2 = await cellBox(2); await pg.mouse.click(b2.x + b2.width / 2, b2.y + b2.height / 2); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => LAY.cell === 2 && document.querySelector(".mc-cell.on").dataset.i === "2"), "a click on chart 3 makes it the active one (blue border)");
  await pg.evaluate(async s => openBySymbol(s), DEC);
  await pg.waitForFunction(s => { const w = mcWin(2); return w && w.cellInfo().s === s && w.cellInfo().n > 20; }, DEC, { timeout: 20000 });
  inf = await info();
  ok(inf[2].s === DEC && inf[0].s === NOV && inf[1].s === NOV && inf[3].s === NOV, "opening a contract from the watchlist / Find changes only the active chart");
  ok(/26DECFUT/.test(await pg.textContent("#tkSym")), "the trade panel follows the active chart's contract");
  await pg.evaluate(() => mcWin(1).setTf("15m"));
  await pg.evaluate(() => mcWin(3).ctSave({type: "ha"}));
  await pg.evaluate(() => { const w = mcWin(0); w.indSave([...w.indList(), {id: "mcv", type: "volume"}]); w.indBuild(); });
  await pg.waitForTimeout(2500);
  inf = await info();
  ok(inf[1].tf === "15m" && inf[0].tf === "5m" && inf[3].type === "ha" && inf[0].type === "candles" && inf[0].inds.includes("volume") && !inf[1].inds.length,
    "timeframe, chart type and indicators stay with their own chart (15m on 2, Heikin-Ashi on 4, Volume on 1)");
  L = await lay();
  ok(L.charts[2].cur.s === DEC && L.charts[1].tf2 === "15m" && L.charts[3].ctype.type === "ha" && (L.charts[0].indicators || []).some(c => c.type === "volume"), "…and are saved in the layout, chart by chart");
  ok(await pg.evaluate(async () => (await api("/api/prefs")).prefs.tf2) === "5m", "the charts in the grid don't change your single-chart settings");

  // ---- BUY / SELL and the Pine Editor work on the active chart
  await pg.click("#bBuy"); await pg.waitForTimeout(700);
  inf = await info();
  ok(inf[2].armed && inf[2].toolS === DEC && !inf[0].armed && !inf[1].armed, "the trade panel's BUY sets up the trade on the active chart (3, December)");
  await pg.evaluate(() => mcWin(2).disarm());
  await pg.evaluate(() => peOpen(null, true)); await pg.waitForSelector("#pineDock:not(.hide)");
  await pg.evaluate(() => { PE.cm.setValue('//@version=5\nindicator("MC test", overlay=true)\nplot(ta.sma(close, 5))'); });
  await pg.fill("#pdName", "MC test " + Date.now() % 100000);
  await pg.click("#pdAdd");
  await pg.waitForFunction(() => mcWin(2).cellInfo().inds.includes("pine"), null, { timeout: 15000 }).catch(() => {});
  inf = await info();
  ok(inf[2].inds.includes("pine") && !inf[0].inds.includes("pine") && !inf[1].inds.includes("pine"), "Pine Editor › Add to chart adds the script to the active chart only");
  await pg.click("#pdClose").catch(() => {});

  // ---- the crosshair follows across the charts (same contract: the price too); off in the menu
  const b0 = await cellBox(0);
  await pg.mouse.move(b0.x + b0.width * 0.3, b0.y + b0.height * 0.55); await pg.mouse.move(b0.x + b0.width * 0.35, b0.y + b0.height * 0.5, {steps: 3}); await pg.waitForTimeout(400);
  let cx = await pg.evaluate(() => [1, 2, 3].map(k => mcWin(k).cellCrossAt || null));
  ok(cx[0] && cx[0].same && cx[1] && !cx[1].same && cx[2], `moving over chart 1 moves the crosshair on the others (same contract: with the price; December: time only)`);
  await pg.mouse.move(b0.x + b0.width + 300, b0.y - 60); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => [1, 2, 3].every(k => !mcWin(k).cellCrossAt)), "leaving it clears them");
  await pg.click("#bGrid"); await pg.uncheck("#mcCross"); await pg.click("#gridClose");
  await pg.mouse.move(b0.x + b0.width * 0.3, b0.y + b0.height * 0.5); await pg.mouse.move(b0.x + b0.width * 0.32, b0.y + b0.height * 0.52, {steps: 2}); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => [1, 2, 3].every(k => !mcWin(k).cellCrossAt)), "Grid › Crosshair off: the others stay still");
  await pg.click("#bGrid"); await pg.check("#mcCross"); await pg.click("#gridClose");

  // ---- a drawing on chart 1 (November) shows on chart 2 (November) too
  const f0 = frame(0), f1 = frame(1);
  await f0.evaluate(() => { drBefore(); DR.items.push({id: "mcd", type: "hline", pts: [{t: DISP[DISP.length - 5].time, p: DISP[DISP.length - 5].close}], st: drNewStyle("hline"), text: ""}); drChanged(); });
  await f1.waitForFunction(() => DR.items.some(d => d.id === "mcd"), null, { timeout: 8000 }).catch(() => {});
  ok(await f1.evaluate(() => DR.items.some(d => d.id === "mcd")) && !(await frame(2).evaluate(() => DR.items.some(d => d.id === "mcd"))), "a drawing on chart 1 shows on chart 2 (same contract), not on chart 3 (December)");

  // ---- ⛶ one chart big; again: back
  await pg.evaluate(() => mcMax(1)); await pg.waitForTimeout(300);
  const big = await cellBox(1), gb = await pg.locator("#mcGrid").boundingBox();
  ok(big && Math.abs(big.width - gb.width) < 4 && !(await pg.isVisible('#mcGrid .mc-cell[data-i="0"]')), "⛶ in a chart: that chart fills the grid");
  await pg.evaluate(() => mcMax(1)); await pg.waitForTimeout(300);
  ok(await pg.isVisible('#mcGrid .mc-cell[data-i="0"]'), "again: back to the grid");

  // ---- a reload brings the grid back, chart by chart
  await pg.waitForTimeout(1200);
  await pg.reload(); await LOGIN(pg);
  await pg.waitForFunction(() => typeof LAY !== "undefined" && LAY.ready, null, { timeout: 25000 });
  await ready(4); await pg.waitForTimeout(800);
  inf = await info();
  ok(inf[2].s === DEC && inf[1].tf === "15m" && inf[3].type === "ha" && inf[0].inds.includes("volume") && inf[2].inds.includes("pine"), "after a reload: the same 2×2, each chart as it was");
  ok(inf.every(c => !c.errs.length), "no errors inside the charts" + (inf.some(c => c.errs.length) ? ": " + inf.map(c => c.errs.join(" | ")).join(" / ") : ""));

  // ---- other grids, then back to one chart
  await pg.evaluate(() => mcSetGrid("3")); await ready(3);
  ok(await pg.evaluate(() => getComputedStyle(document.querySelector('#mcGrid .mc-cell[data-i="0"]')).gridRowEnd === "3" || document.querySelector('#mcGrid .mc-cell[data-i="0"]').getBoundingClientRect().height > document.querySelector('#mcGrid .mc-cell[data-i="1"]').getBoundingClientRect().height * 1.5),
    "3 charts: one big on the left, two on the right");
  await pg.evaluate(() => mcSetGrid("2h")); await ready(2);
  const r0 = await cellBox(0), r1 = await cellBox(1);
  ok(Math.abs(r0.x - r1.x) < 2 && r1.y > r0.y + r0.height - 4, "2 stacked: one above the other");
  L = await lay();
  ok(L.charts.length === 4 && L.charts[3].ctype.type === "ha", "charts not shown in a smaller grid are kept in the layout");
  await pg.evaluate(() => mcSetGrid("1")); await pg.waitForTimeout(1500);
  ok(!(await pg.isVisible("#mcGrid")) && await pg.isVisible("#chart") && await pg.evaluate(() => cur.s === "MCX:CRUDEOIL26NOVFUT" && INDS.some(r => r.cfg.type === "volume")), "back to one chart: chart 1 (November, with its Volume) on the page's own chart");
  await pg.evaluate(() => mcSetGrid("4")); await ready(4);
  ok((await info())[3].type === "ha", "2×2 again: chart 4 comes back as it was");
  ok(!errs.length, "no page errors (desktop)" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));

  // ---- the phone: one chart at a time, numbered buttons
  const ph = await br.newContext({ ...devices["Pixel 7"] }), mp = await ph.newPage();
  const merrs = []; mp.on("pageerror", e => merrs.push(e.message));
  await mp.goto("http://localhost:8766/"); await LOGIN(mp);
  await mp.waitForFunction(() => typeof LAY !== "undefined" && LAY.ready && document.body.classList.contains("mob") && DISP.length > 20, null, { timeout: 25000 });
  ok(await mp.isVisible("#mcDots") && await mp.evaluate(() => document.querySelectorAll("#mcDots button").length) === 4 && !(await mp.isVisible("#mcGrid")), "phone: no grid; buttons 1-4 pick the chart");
  await mp.tap('#mcDots [data-k="2"]');
  await mp.waitForFunction(s => cur && cur.s === s && !LAY.applying && DISP.length > 20, DEC, { timeout: 20000 });
  ok(await mp.evaluate(() => LAY.cell === 2 && document.querySelector('#mcDots [data-k="2"]').classList.contains("on")), "tapping 3 shows chart 3 (December)");
  await mp.evaluate(() => setTf("1h")); await mp.waitForTimeout(1800);
  L = await (async () => { const j = await mp.evaluate(async () => (await api("/api/layouts"))); return j.layouts.find(l => l.id === j.active); })();
  ok(L.charts[2].tf2 === "1h" && L.charts[1].tf2 === "15m" && L.charts[0].tf2 === "5m", "a change on the phone saves into that chart only");
  await mp.tap('#mcDots [data-k="3"]');
  await mp.waitForFunction(() => !LAY.applying && LAY.cell === 3 && ctType() === "ha", null, { timeout: 20000 });
  ok(true, "tapping 4: Heikin-Ashi, as saved");
  await mp.screenshot({ path: SHOT + "multichart_phone.png" });
  ok(!merrs.length, "no page errors (phone)" + (merrs.length ? ": " + merrs.slice(0, 3).join(" | ") : ""));
  // leave one chart for the other tests
  await mp.evaluate(() => mcSetGrid("1")); await mp.waitForTimeout(1500);
  await pg.evaluate(async () => papi("reset", {confirm: "RESET", capital: 25000}));
  await br.close();
})().catch(async e => { ok(false, "crashed: " + e.message); if(br) await br.close(); });
