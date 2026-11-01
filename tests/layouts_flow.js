// Saved chart layouts (v0.23.0, roadmap item 5), in a real browser: your chart becomes "Layout 1"; a new layout starts
// blank; each layout keeps its own contract, timeframe, chart type and indicators (auto-saved on the server); switching
// brings each back; rename (a taken name refused), copy (the chart as shown), delete (two clicks, never the last);
// saving by hand (● unsaved, "save first?" when switching, Ctrl+S); drawings stay per contract; a reload and a second
// device open the same; the phone.
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
  const ctx = await br.newContext({ viewport: { width: 1500, height: 950 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  // the chart to start from (November, 5m, candles, no indicators), set with no page open; then nobody has layouts
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.waitForFunction(() => typeof layInit === "function" && P.snap, null, { timeout: 20000 });
  const row = await pg.evaluate(async s => (await api("/api/symbol?s=" + encodeURIComponent(s))).row, NOV);
  await pg.goto("about:blank");
  await ctx.request.post("http://localhost:8766/api/prefs", {data: {cur: {s: row.s, d: row.d, tick: row.tick, lot: row.lot, mult: row.mult, sess: row.sess}, ctype: {type: "candles"}, indicators: [], tf2: "5m", chart: {}, layAuto: true}, headers: {Origin: "http://localhost:8766"}});
  for(const u of fs.existsSync(D + "/u") ? fs.readdirSync(D + "/u") : []){ const f = path.join(D, "u", u, "layouts.json"); if(fs.existsSync(f)) fs.unlinkSync(f); }
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.waitForFunction(() => typeof LAY !== "undefined" && LAY.ready && DISP.length > 50, null, { timeout: 25000 });
  const srv = () => pg.evaluate(async () => { const j = await api("/api/layouts"); return j; });
  const lay = async name => (await srv()).layouts.find(l => l.name === name);
  const state = () => pg.evaluate(() => ({s: cur && cur.s, tf, type: ctType(), inds: INDS.map(r => r.cfg.type), btn: $("#bLay").textContent, n: DISP.length}));
  const openMenu = async () => { if(await pg.isHidden("#layPick")) await pg.click("#bLay"); await pg.waitForTimeout(150); };
  const pick = async name => { await openMenu(); await pg.click(`#layPick .lay-r:has(b:text-is("${name}")) .lay-n`); };
  const settle = () => pg.waitForFunction(() => !LAY.applying && DISP.length > 20 && RAW.length > 20, null, { timeout: 20000 }).then(() => pg.waitForTimeout(1500));

  // ---- your chart becomes "Layout 1"
  await pg.waitForTimeout(800);
  let j = await srv();
  ok(j.layouts.length === 1 && j.layouts[0].name === "Layout 1" && j.active === j.layouts[0].id && j.layouts[0].charts[0].cur.s === NOV && j.layouts[0].charts[0].tf2 === "5m",
    "the chart as it was becomes \"Layout 1\" (contract, timeframe)");
  ok(/Layout 1/.test(await pg.textContent("#bLay")), "the chart bar shows the open layout");
  // a change saves itself into it
  await pg.evaluate(() => { indSave([...indList(), {id: "lv1", type: "volume"}]); indBuild(); });
  await pg.waitForTimeout(1600);
  ok(((await lay("Layout 1")).charts[0].indicators || []).some(c => c.type === "volume"), "adding Volume saves into the open layout (on the server)");

  // ---- a new layout: blank, renamed "Scalp"; its own contract, timeframe and chart type
  await openMenu(); await pg.click("#layNew"); await settle();
  ok(await pg.isVisible("#layName"), "＋ New layout asks for its name");
  await pg.fill("#layName", "Scalp"); await pg.press("#layName", "Enter"); await pg.waitForTimeout(400);
  let st = await state();
  ok(/Scalp/.test(st.btn) && st.s === NOV && st.type === "candles" && !st.inds.length, `the new layout is blank (candles, no indicators) on the same contract (${st.btn})`);
  await pg.evaluate(async s => { await openBySymbol(s); }, DEC); await settle();
  await pg.evaluate(() => setTf("15m")); await settle();
  await pg.evaluate(() => ctSave({type: "ha"})); await settle();
  let sc = await lay("Scalp");
  ok(sc && sc.charts[0].cur.s === DEC && sc.charts[0].tf2 === "15m" && sc.charts[0].ctype.type === "ha", "Scalp keeps December, 15m, Heikin-Ashi (saved as you change it)");

  // ---- switching brings each layout back exactly
  await pick("Layout 1"); await settle();
  st = await state();
  ok(st.s === NOV && st.tf === "5m" && st.type === "candles" && st.inds.includes("volume") && /Layout 1/.test(st.btn), `Layout 1: November, 5m, candles, Volume (${st.s} ${st.tf} ${st.type} ${st.inds})`);
  ok(await pg.evaluate(() => $("#tf").textContent.includes("5m") && $("#bCt").textContent.startsWith("Candles")), "the timeframe and chart-type buttons follow");
  await pg.screenshot({ path: SHOT + "layouts_menu.png" });
  await pick("Scalp"); await settle();
  st = await state();
  ok(st.s === DEC && st.tf === "15m" && st.type === "ha" && !st.inds.length, `Scalp: December, 15m, Heikin-Ashi, no indicators (${st.s} ${st.tf} ${st.type})`);

  // ---- rename: a name already used is refused
  await openMenu(); await pg.click('#layPick .lay-r.on [data-a="ren"]'); await pg.fill("#layName", "layout 1"); await pg.press("#layName", "Enter"); await pg.waitForTimeout(400);
  ok(await pg.isVisible("#layName") && !!(await lay("Scalp")), "a name already used (any case) is refused");
  await pg.press("#layName", "Escape");

  // ---- copy: the chart as it is now; drawings stay with the contract
  await pg.evaluate(() => { drBefore(); DR.items.push({id: "lvl", type: "hline", pts: [{t: DISP[DISP.length - 5].time, p: DISP[DISP.length - 5].close}], st: drNewStyle("hline"), text: ""}); drChanged(); });
  await pg.waitForTimeout(900);
  await openMenu(); await pg.click("#layDup"); await settle();
  st = await state();
  ok(/Scalp copy/.test(st.btn) && st.s === DEC && st.tf === "15m" && st.type === "ha", `⧉ Copy this one opens a copy of the chart as shown (${st.btn})`);
  await pg.press("#layName", "Escape").catch(() => {});
  ok(await pg.evaluate(() => DR.items.some(d => d.id === "lvl")), "the contract's drawings show in the copy too (drawings belong to the contract)");
  await pick("Layout 1"); await settle();
  ok(await pg.evaluate(() => !DR.items.some(d => d.id === "lvl")), "…and not on another contract's layout");

  // ---- delete: two clicks; the last one can't go
  await openMenu();
  const delBtn = '#layPick .lay-r:has(b:text-is("Scalp copy")) [data-a="del"]';
  await pg.click(delBtn); await pg.waitForTimeout(150);
  ok((await srv()).layouts.length === 3, "✕ once only asks");
  await pg.click(delBtn); await pg.waitForTimeout(500);
  ok((await srv()).layouts.length === 2 && !(await lay("Scalp copy")), "✕ twice deletes it");

  // ---- saving by hand: ● unsaved, "save first?" when leaving, Don't save, Ctrl+S
  await pick("Scalp"); await settle();
  await openMenu(); await pg.uncheck("#layAutoBox"); await pg.waitForTimeout(300);
  await pg.evaluate(() => setTf("1h")); await settle();
  ok(/●/.test(await pg.textContent("#bLay")) && (await lay("Scalp")).charts[0].tf2 === "15m", "by hand: a change marks ● and the saved layout stays as it was");
  await pick("Layout 1"); await pg.waitForTimeout(300);
  ok(await pg.isVisible("#layPick .lay-ask") && /not saved/.test(await pg.textContent("#layPick .lay-ask")), "leaving it asks: save the changes first?");
  await pg.click('#layPick .lay-ask [data-k="drop"]'); await settle();
  st = await state();
  ok(st.s === NOV && st.tf === "5m" && !/●/.test(st.btn), "Don't save: Layout 1 opens");
  await pick("Scalp"); await settle();
  st = await state();
  ok(st.tf === "15m" && !/●/.test(st.btn), "Scalp reopens as it was saved (15m, not 1h)");
  await pg.evaluate(() => setTf("30m")); await settle();
  await pg.click("#chart", {position: {x: 400, y: 300}}).catch(() => {}); await pg.keyboard.press("Escape");
  await pg.keyboard.press("Control+s"); await pg.waitForTimeout(700);
  ok((await lay("Scalp")).charts[0].tf2 === "30m" && !/●/.test(await pg.textContent("#bLay")), "Ctrl+S saves it");
  await pg.evaluate(() => setTf("1h")); await settle();
  await pick("Layout 1"); await pg.waitForTimeout(300);
  await pg.click('#layPick .lay-ask [data-k="save"]'); await settle();
  ok((await lay("Scalp")).charts[0].tf2 === "1h" && (await state()).s === NOV, "Save in the question saves, then opens the other layout");
  await openMenu(); await pg.check("#layAutoBox"); await pg.click("#layClose");

  // ---- a reload and a second device open the same
  await pick("Scalp"); await settle();
  await pg.reload(); await LOGIN(pg);
  await pg.waitForFunction(() => typeof LAY !== "undefined" && LAY.ready && DISP.length > 20, null, { timeout: 25000 }); await pg.waitForTimeout(800);
  st = await state();
  ok(/Scalp/.test(st.btn) && st.s === DEC && st.tf === "1h" && st.type === "ha", `after a reload: Scalp, as left (${st.s} ${st.tf} ${st.type})`);
  ok(!errs.length, "no page errors (desktop)" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
  // ---- a page closed in the middle of a switch: both layouts stay as saved, and the chart opens as the open one
  const keep = JSON.stringify((await srv()).layouts.map(l => [l.name, l.charts]));
  await pg.evaluate(id => { layOpen(id); }, (await lay("Layout 1")).id);   // (not waited for)
  await pg.waitForTimeout(120); await pg.close();
  const pg3 = await ctx.newPage(); pg3.on("pageerror", e => errs.push(e.message));
  await pg3.goto("http://localhost:8766/"); await LOGIN(pg3);
  await pg3.waitForFunction(() => typeof LAY !== "undefined" && LAY.ready && !LAY.applying && DISP.length > 20, null, { timeout: 25000 }); await pg3.waitForTimeout(2500);
  const after = await pg3.evaluate(async () => { const j = await api("/api/layouts"), L = j.layouts.find(l => l.id === j.active);
    return {same: layEq(layNow(), L.charts[0]), name: L.name, lays: JSON.stringify(j.layouts.map(l => [l.name, l.charts])), s: cur.s, tf}; });
  ok(after.lays === keep, "closing the page mid-switch leaves both layouts exactly as saved");
  ok(after.same, `…and the chart opens as the open layout, ${after.name} (${after.s} ${after.tf})`);
  await pg3.close();
  const c2 = await br.newContext({ viewport: { width: 1300, height: 850 } }), p2 = await c2.newPage();
  await p2.goto("http://localhost:8766/"); await LOGIN(p2);
  await p2.waitForFunction(() => typeof LAY !== "undefined" && LAY.ready, null, { timeout: 25000 });
  const openName = await p2.evaluate(async () => { const j = await api("/api/layouts"); return j.layouts.find(l => l.id === j.active).name; });
  ok(await p2.evaluate(() => LAY.list.map(l => l.name).sort().join("|")) === "Layout 1|Scalp" && (await p2.textContent("#bLay")).includes(openName) && await p2.evaluate(() => layEq(layNow(), layCur().charts[0])),
    `another device has the same layouts, the same one open (${openName}) and its chart`);
  await c2.close();

  // ---- the phone
  const ph = await br.newContext({ ...devices["Pixel 7"] }), mp = await ph.newPage();
  const merrs = []; mp.on("pageerror", e => merrs.push(e.message));
  await mp.goto("http://localhost:8766/"); await LOGIN(mp);
  await mp.waitForFunction(() => typeof LAY !== "undefined" && LAY.ready && document.body.classList.contains("mob") && DISP.length > 20, null, { timeout: 25000 });
  ok(await mp.isVisible("#bLay"), "phone: the layout button is on the chart bar");
  await mp.tap("#bLay"); await mp.waitForTimeout(250);
  const box = await mp.locator("#layPick").boundingBox(), vw = mp.viewportSize().width;
  ok(box && box.x >= 0 && box.x + box.width <= vw + 1, "its menu fits the screen");
  await mp.tap('#layPick .lay-r:has(b:text-is("Layout 1")) .lay-n');
  await mp.waitForFunction(() => !LAY.applying && cur && cur.s === "MCX:CRUDEOIL26NOVFUT" && tf === "5m", null, { timeout: 20000 });
  ok(true, "tapping a layout opens it on the phone");
  await mp.screenshot({ path: SHOT + "layouts_phone.png" });
  ok(!merrs.length, "no page errors (phone)" + (merrs.length ? ": " + merrs.slice(0, 3).join(" | ") : ""));
  await br.close();
})().catch(async e => { ok(false, "crashed: " + e.message); if(br) await br.close(); });
