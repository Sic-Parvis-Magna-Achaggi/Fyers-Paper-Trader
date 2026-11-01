// Drawing tools and the measure tool (v0.22.0), in a real browser with the mouse (and touch on the phone layout):
// toolbar show / hide (✎, D, Chart settings, saved), placing by drag and by clicks, magnet, select / handles / move,
// undo / redo, delete, colours and settings becoming the tool's default, lock, hide all, the list, right-click menu,
// copy / paste to another contract, text, path, brush, saved per contract on the server (reload), every chart type
// and timeframe, the measure (Shift-drag, middle button, click to clear) with net ₹ and R, the long / short position
// drawings' outcome against the real candles, the trade lines still winning over drawings, and the phone.
// Needs the mock server and an admin with 2FA (run security_flow.js first).
const { chromium, devices } = require("playwright");
const LOGIN = require("./login.js");
const fs = require("fs");
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const NOV = "MCX:CRUDEOIL26NOVFUT", DEC = "MCX:CRUDEOIL26DECFUT";
let br;
(async () => {
  br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1500, height: 950 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.waitForFunction(() => typeof drAttach === "function" && P.snap, null, { timeout: 20000 });
  // a clean start: no drawings on the two contracts, default drawing settings, 5m candles
  await pg.evaluate(async ([a, b]) => { for(const s of [a, b]) await api("/api/drawings", {body: {s, items: []}}); ls.set("draw", {}); }, [NOV, DEC]);
  // the chart to start from, set with no page open; no saved layouts (v0.23.0: the open layout would put its own chart back)
  await pg.goto("about:blank");
  await ctx.request.post("http://localhost:8766/api/prefs", {data: {draw: {}, ctype: {type: "candles"}, tf2: "5m", indicators: []}, headers: {Origin: "http://localhost:8766"}});
  const D = process.env.FYERS_HELPER_DATA || ".";
  for(const u of fs.existsSync(D + "/u") ? fs.readdirSync(D + "/u") : []){ const f = D + "/u/" + u + "/layouts.json"; if(fs.existsSync(f)) fs.unlinkSync(f); }
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.waitForFunction(() => typeof drAttach === "function" && P.snap, null, { timeout: 20000 });
  await pg.evaluate(async s => { tf = "5m"; prefSet("tf2", "5m"); await openBySymbol(s); }, NOV);
  await pg.waitForFunction(() => DISP.length > 100 && DR.loaded && DR.items.length === 0, null, { timeout: 20000 });
  await pg.waitForTimeout(800);
  const box = await pg.locator("#chart").boundingBox();
  const at = (x, y) => [box.x + x, box.y + y];
  const items = () => pg.evaluate(() => JSON.parse(JSON.stringify(DR.items)));
  // where a drawing's point is on the page
  const ptXY = (id, i) => pg.evaluate(([id, i]) => { const d = drFind(id), q = drXY(drView(), d.pts[i], DT[d.type].free); return [q.x, q.y]; }, [id, i]);
  const drag = async (x0, y0, x1, y1, o = {}) => { await pg.mouse.move(...at(x0, y0)); await pg.mouse.down(o); await pg.mouse.move(...at(x1, y1), {steps: 6}); await pg.mouse.up(o); await pg.waitForTimeout(120); };
  const click = async (x, y) => { await pg.mouse.click(...at(x, y)); await pg.waitForTimeout(120); };

  // ---- the toolbar: shown, ✎ hides it, D brings it back, Chart settings, saved on the server
  ok(await pg.isVisible("#dtb") && await pg.evaluate(() => document.querySelectorAll("#dtb .dtb-b").length >= 12), "the drawing toolbar is on the left of the chart");
  const cw0 = await pg.evaluate(() => $("#chart").clientWidth);
  await pg.click("#bDraw"); await pg.waitForTimeout(250);
  ok(!(await pg.isVisible("#dtb")) && await pg.evaluate(() => drPref().tb === false && $("#chart").clientWidth > 0), "✎ hides the toolbar (the chart takes the room)");
  await pg.keyboard.press("d"); await pg.waitForTimeout(200);
  ok(await pg.isVisible("#dtb"), "D shows it again");
  await pg.click("#bCfg"); await pg.waitForTimeout(200);
  await pg.click("#cfgDtb"); await pg.waitForTimeout(250);
  ok(!(await pg.isVisible("#dtb")) && !(await pg.isChecked("#cfgDtb")), "Chart settings › Drawing toolbar hides it");
  await pg.waitForTimeout(900);
  const saved = await pg.evaluate(async () => (await api("/api/prefs")).prefs.draw.tb);
  ok(saved === false, "the choice is saved on the server");
  await pg.click("#cfgDtb"); await pg.click("#cfgClose"); await pg.waitForTimeout(250);
  ok(await pg.isVisible("#dtb") && await pg.evaluate(() => $("#chart").clientWidth) === cw0, "ticked again: back, same chart width");

  // ---- a trend line by dragging; the tool goes back to the cursor; its points sit on bars
  await pg.click('#dtb [data-tool="trend"]');
  await drag(200, 420, 420, 260);
  let it = await items();
  ok(it.length === 1 && it[0].type === "trend" && it[0].pts.length === 2, "trend line drawn by dragging");
  const onBars = await pg.evaluate(() => DR.items[0].pts.every(p => DISP.some(b => b.time === p.t)));
  ok(onBars && await pg.evaluate(() => DR.tool === null && !!DR.sel), "its points are on bars, it's selected, the tool is back to the cursor");
  const trendId = it[0].id;

  // ---- click, move, click (TradingView's way)
  await pg.click('#dtb .dtb-more[data-g="lines"]'); await pg.waitForTimeout(150);
  ok(await pg.isVisible("#dtbFly") && /Parallel channel/.test(await pg.textContent("#dtbFly")), "› lists the whole group (lines)");
  await pg.click('#dtbFly [data-t="ray"]');
  await click(250, 600); await pg.mouse.move(...at(500, 560), {steps: 4}); await click(500, 560);
  it = await items();
  ok(it.length === 2 && it[1].type === "ray" && it[1].pts[0].t !== it[1].pts[1].t, "ray drawn with click, move, click");
  ok(await pg.evaluate(() => $('#dtb .dtb-g[data-g="lines"] [data-tool]').dataset.tool === "ray"), "the group's button now shows the last tool used (ray)");

  // ---- the magnet: strong snaps a horizontal line to a bar's open / high / low / close
  await pg.evaluate(() => drPrefSet({mag: "strong"}));
  const bar = await pg.evaluate(() => { const r = chart.timeScale().getVisibleLogicalRange(), L = Math.round(r.from + (r.to - r.from) * 0.4), b = DISP[L], V = drView(); return {x: V.xL(L), y: V.y(b.high) - 6, b}; });
  await pg.keyboard.press("Alt+h"); await click(bar.x, bar.y);
  it = await items();
  const hl = it[it.length - 1];
  ok(hl.type === "hline" && [bar.b.open, bar.b.high, bar.b.low, bar.b.close].includes(hl.pts[0].p), `Alt+H + strong magnet: the line is on the bar's price (${hl.pts[0].p}, high ${bar.b.high})`);
  await pg.evaluate(() => drPrefSet({mag: "off"}));
  await pg.keyboard.press("Alt+h"); await click(bar.x, bar.y);
  it = await items();
  ok(it[it.length - 1].pts[0].p !== hl.pts[0].p, "magnet off: the line stays where you click");
  const hlId = it[it.length - 1].id;

  // ---- select, drag a handle, move the whole line, undo / redo, delete
  await pg.keyboard.press("Escape");
  let [x0, y0] = await ptXY(trendId, 0), [x1, y1] = await ptXY(trendId, 1);
  await click((x0 + x1) / 2, (y0 + y1) / 2);
  ok(await pg.evaluate(id => DR.sel === id, trendId) && await pg.isVisible("#dsel"), "a click on the line selects it and shows its bar");
  const before = (await items()).find(d => d.id === trendId);
  await drag(x1, y1, x1 + 60, y1 - 40);
  let after = (await items()).find(d => d.id === trendId);
  ok(after.pts[1].t !== before.pts[1].t && after.pts[0].t === before.pts[0].t, "dragging the end handle moves only that end");
  [x0, y0] = await ptXY(trendId, 0); [x1, y1] = await ptXY(trendId, 1);
  const mid = after;
  await drag((x0 + x1) / 2, (y0 + y1) / 2, (x0 + x1) / 2 + 80, (y0 + y1) / 2 + 30);
  after = (await items()).find(d => d.id === trendId);
  const shift = await pg.evaluate(([a, b]) => [t2L(b.pts[0].t) - t2L(a.pts[0].t), t2L(b.pts[1].t) - t2L(a.pts[1].t), +(b.pts[0].p - a.pts[0].p).toFixed(4), +(b.pts[1].p - a.pts[1].p).toFixed(4)], [mid, after]);
  ok(shift[0] === shift[1] && shift[0] !== 0 && Math.abs(shift[2] - shift[3]) < 1e-6, `dragging the line moves both ends together (${shift[0]} bars, ${shift[2]} points)`);
  await pg.keyboard.press("Control+z"); await pg.waitForTimeout(100);
  ok(JSON.stringify((await items()).find(d => d.id === trendId).pts) === JSON.stringify(mid.pts), "Ctrl+Z undoes the move");
  await pg.keyboard.press("Control+y"); await pg.waitForTimeout(100);
  ok(JSON.stringify((await items()).find(d => d.id === trendId).pts) === JSON.stringify(after.pts), "Ctrl+Y redoes it");
  await pg.evaluate(id => { DR.sel = id; drUiSel(); }, hlId);
  await pg.keyboard.press("Delete"); await pg.waitForTimeout(100);
  ok(!(await items()).some(d => d.id === hlId), "Del removes the selected drawing");
  await pg.keyboard.press("Control+z"); await pg.waitForTimeout(100);
  ok((await items()).some(d => d.id === hlId), "Ctrl+Z brings it back");

  // ---- colour from the floating bar becomes the tool's default; width; settings dialog (double-click)
  await pg.evaluate(id => { DR.sel = id; drUiSel(); drRedraw(); }, trendId);
  await pg.click('#dsel .ds-col[data-k="c"]'); await pg.click('#dcol [data-c="#f23645"]'); await pg.waitForTimeout(100);
  await pg.selectOption('#dsel select[data-s="w"]', "3"); await pg.waitForTimeout(100);
  after = (await items()).find(d => d.id === trendId);
  ok(after.st.c === "#f23645" && after.st.w === 3 && await pg.evaluate(() => drNewStyle("trend").c === "#f23645" && drNewStyle("trend").w === 3), "colour and width from the bar; new trend lines use them");
  [x0, y0] = await ptXY(trendId, 0); [x1, y1] = await ptXY(trendId, 1);
  await pg.mouse.dblclick(...at((x0 + x1) / 2, (y0 + y1) / 2)); await pg.waitForTimeout(200);
  ok(await pg.isVisible("#drSet") && /Extend right/.test(await pg.textContent("#drSet")), "double-click opens its settings");
  await pg.check('#drSet [data-k="er"]'); await pg.click("#drSet [data-ok]"); await pg.waitForTimeout(100);
  ok((await items()).find(d => d.id === trendId).st.er === true && !(await pg.isVisible("#drSet")), "Extend right from the settings dialog");
  // ---- Coordinates tab: every point's price (on the tick) and date / time (IST), checked, and the bar it lands on
  await pg.evaluate(id => drSettings(drFind(id), "xy"), trendId);
  const cur0 = (await items()).find(d => d.id === trendId);
  const shown = await pg.evaluate(() => [...document.querySelectorAll("#drSet .ds-xy")].map(r => ({p: r.querySelector("[data-xp]").value, d: r.querySelector("[data-xd]").value, t: r.querySelector("[data-xt]").value, bar: r.querySelector("[data-xb]").textContent})));
  const exp0 = await pg.evaluate(d => d.pts.map(p => drDateParts(p.t)), cur0);
  ok(await pg.isVisible('#drSet [data-sec="xy"]') && shown.length === 2 && shown.every((r, i) => +r.p === cur0.pts[i].p && r.d === exp0[i][0] && r.t === exp0[i][1]) && /^on the bar of /.test(shown[0].bar),
    `Coordinates tab: each point's price, date and time as drawn (${shown[0].p} · ${shown[0].d} ${shown[0].t} · ${shown[0].bar})`);
  const tgt = await pg.evaluate(() => { const b = DISP[DISP.length - 20]; return {t: b.time, parts: drDateParts(b.time + 120)}; });   // 2 minutes into a 5m bar
  await pg.fill("#drSet .ds-xy >> nth=0 >> [data-xp]", "5600.4");
  await pg.fill("#drSet .ds-xy >> nth=1 >> [data-xd]", tgt.parts[0]); await pg.fill("#drSet .ds-xy >> nth=1 >> [data-xt]", tgt.parts[1]);
  const note = await pg.textContent("#drSet .ds-xy >> nth=1 >> [data-xb]");
  ok(/holding it/.test(note), `a time inside a bar says which bar holds it ("${note}")`);
  await pg.click("#drSet [data-ok]"); await pg.waitForTimeout(150);
  let co = (await items()).find(d => d.id === trendId);
  const landed = await pg.evaluate(t => DISP[t2L(t)].time, co.pts[1].t);
  ok(co.pts[0].p === 5600 && co.pts[1].t === tgt.t + 120 && landed === tgt.t, "typed coordinates apply: price on the tick (5600.4 → 5600), time exact, drawn on the bar holding it");
  await pg.evaluate(id => drSettings(drFind(id), "xy"), trendId);
  await pg.fill("#drSet .ds-xy >> nth=0 >> [data-xp]", "abc"); await pg.click("#drSet [data-ok]"); await pg.waitForTimeout(100);
  ok(await pg.isVisible("#drSet") && /price/.test(await pg.textContent("#drSet [data-err]")) && (await items()).find(d => d.id === trendId).pts[0].p === 5600, "a wrong price is refused and nothing changes");
  await pg.click("#drSet .pif [data-x]");
  await pg.keyboard.press("Control+z"); await pg.waitForTimeout(100);
  ok(JSON.stringify((await items()).find(d => d.id === trendId).pts) === JSON.stringify(cur0.pts), "Ctrl+Z undoes a coordinates change");

  // ---- angles (v0.23.1): the Trend angle tool; ∠ on a line's bar; degrees as on screen (change with zoom), slope per bar (doesn't)
  await pg.click('#dtb .dtb-more[data-g="lines"]'); await pg.waitForTimeout(100);
  ok(/Trend angle/.test(await pg.textContent("#dtbFly")), "Lines › Trend angle is there");
  await pg.click('#dtbFly [data-t="angle"]');
  await drag(250, 520, 430, 420);
  it = await items();
  const ag = it[it.length - 1];
  const agi = await pg.evaluate(id => { const d = drFind(id), V = drView(), a = drXY(V, d.pts[0]), b = drXY(V, d.pts[1]);
    const exp = Math.atan2(-(b.y - a.y), Math.abs(b.x - a.x)) * 180 / Math.PI, slope = (d.pts[1].p - d.pts[0].p) / (b.L - a.L);
    const lbl = DR.geo.get(id).X.map(t => t.lines.join(" ")).join(" | ");
    return {lbl, exp: exp.toFixed(1), slope: fmt(Math.abs(slope), drTick())}; }, ag.id);
  ok(ag.type === "angle" && agi.lbl.includes(agi.exp + "°") && agi.lbl.includes(agi.slope + " / bar"), `the angle and the slope per bar beside it ("${agi.lbl}")`);
  const zoom = await pg.evaluate(async id => { const ts = chart.timeScale(), sp = ts.options().barSpacing, ps = series.priceScale();
    ps.applyOptions({autoScale: false}); ts.applyOptions({barSpacing: sp * 2}); await new Promise(r => setTimeout(r, 300));   // (the price scale held still)
    const d = drFind(id), V = drView(), a = drXY(V, d.pts[0]), b = drXY(V, d.pts[1]), inf = drAngleInfo(a, b, d.pts[0].p, d.pts[1].p);
    ts.applyOptions({barSpacing: sp}); ps.applyOptions({autoScale: true}); return {...inf, fs: fmt(Math.abs(inf.slope), drTick())}; }, ag.id);
  ok(Math.abs(zoom.deg - +agi.exp) > 1 && zoom.fs === agi.slope, `zoomed in, the angle on screen changes (${agi.exp}° → ${zoom.deg.toFixed(1)}°) and the slope per bar doesn't`);
  await pg.evaluate(id => { DR.sel = id; drUiSel(); drRedraw(); }, trendId); await pg.waitForTimeout(150);
  await pg.click('#dsel [data-a="ang"]'); await pg.waitForTimeout(250);
  ok((await items()).find(d => d.id === trendId).st.ang === true && await pg.evaluate(id => DR.geo.get(id).X.some(t => /°/.test(t.lines[0])), trendId), "∠ on a trend line's bar shows its angle");
  await pg.evaluate(id => drSettings(drFind(id), "style"), trendId);
  ok(await pg.isChecked('#drSet [data-k="ang"]') && /Show angle/.test(await pg.textContent("#drSet")), "…and its settings have Show angle, ticked");
  await pg.click("#drSet .pif [data-x]");
  await pg.click('#dsel [data-a="ang"]'); await pg.waitForTimeout(150);
  ok((await items()).find(d => d.id === trendId).st.ang === false, "∠ again hides it");

  // ---- lock: a locked line doesn't move (the chart scrolls instead); hide all
  await pg.evaluate(id => { DR.sel = id; drUiSel(); }, trendId);
  await pg.click('#dsel [data-a="lock"]'); await pg.waitForTimeout(100);
  const lk = (await items()).find(d => d.id === trendId);
  [x0, y0] = await ptXY(trendId, 0); [x1, y1] = await ptXY(trendId, 1);
  await drag((x0 + x1) / 2, (y0 + y1) / 2, (x0 + x1) / 2 + 90, (y0 + y1) / 2);
  ok(lk.lock && JSON.stringify((await items()).find(d => d.id === trendId).pts) === JSON.stringify(lk.pts), "a locked drawing doesn't move");
  await pg.evaluate(id => { drBefore(); drFind(id).lock = false; drChanged(); }, trendId);
  await pg.click('#dtb [data-a="hide"]'); await pg.waitForTimeout(250);
  ok(await pg.evaluate(() => drPref().hideAll && DR.geo.size === 0), "Hide all drawings");
  await pg.click('#dtb [data-a="hide"]'); await pg.waitForTimeout(250);
  ok(await pg.evaluate(() => !drPref().hideAll && DR.geo.size === DR.items.length), "Show them again");

  // ---- text, path, brush, right-click menu, list
  await pg.click('#dtb .dtb-more[data-g="text"]'); await pg.click('#dtbFly [data-t="text"]');
  await click(600, 300); await pg.waitForTimeout(150);
  ok(await pg.isVisible("#drTxtBox textarea"), "the text tool asks for the text");
  await pg.keyboard.type("Support zone"); await pg.keyboard.press("Enter"); await pg.waitForTimeout(150);
  it = await items();
  ok(it[it.length - 1].type === "text" && it[it.length - 1].text === "Support zone", "text written on the chart");
  await pg.click('#dtb .dtb-more[data-g="shapes"]'); await pg.click('#dtbFly [data-t="path"]');
  await click(300, 700); await click(380, 650); await click(460, 700); await pg.mouse.dblclick(...at(540, 640)); await pg.waitForTimeout(200);
  it = await items();
  ok(it[it.length - 1].type === "path" && it[it.length - 1].pts.length === 4 && !(await pg.isVisible("#drSet")), `path: clicks, double-click ends it (${it[it.length - 1].pts.length} points)`);
  await pg.click('#dtb .dtb-more[data-g="shapes"]'); await pg.click('#dtbFly [data-t="brush"]');
  await pg.mouse.move(...at(650, 650)); await pg.mouse.down();
  for(let k = 0; k < 30; k++) await pg.mouse.move(...at(650 + k * 6, 650 + Math.sin(k / 3) * 30));
  await pg.mouse.up(); await pg.waitForTimeout(150);
  it = await items();
  ok(it[it.length - 1].type === "brush" && it[it.length - 1].pts.length > 15, `brush keeps the stroke (${it[it.length - 1].pts.length} points)`);
  const n0 = it.length;
  [x0, y0] = await ptXY(trendId, 0); [x1, y1] = await ptXY(trendId, 1);
  await pg.mouse.click(...at((x0 + x1) / 2, (y0 + y1) / 2), {button: "right"}); await pg.waitForTimeout(150);
  ok(await pg.isVisible("#drMenu") && /Bring to front/.test(await pg.textContent("#drMenu")), "right-click on a drawing opens its menu");
  await pg.click('#drMenu [data-a="clone"]'); await pg.waitForTimeout(150);
  ok((await items()).length === n0 + 1, "Clone");
  await pg.click('#dtb [data-a="list"]'); await pg.waitForTimeout(150);
  ok(await pg.evaluate(n => document.querySelectorAll("#drLst .dl-r").length === n, n0 + 1), "the drawings list shows every drawing");
  await pg.click("#drLst .dl-r >> nth=0 >> [data-a=eye]"); await pg.waitForTimeout(150);
  ok(await pg.evaluate(() => DR.items[DR.items.length - 1].hide === true && DR.geo.size === DR.items.length - 1), "the list's ● hides one drawing");
  await pg.click("#drLst .dl-r >> nth=0 >> [data-a=eye]"); await pg.mouse.click(5, 5);

  // ---- saved on the server, per contract; a reload brings them back
  await pg.waitForTimeout(1200);
  const srv = await pg.evaluate(async s => (await api("/api/drawings?s=" + encodeURIComponent(s))).items.length, NOV);
  ok(srv === n0 + 1, `saved on the server (${srv})`);
  await pg.keyboard.press("Escape");
  const snapBefore = JSON.stringify(await items());
  await pg.reload(); await LOGIN(pg);
  await pg.waitForFunction(() => typeof drAttach === "function" && DR.loaded && DR.items.length > 0, null, { timeout: 20000 });
  ok(JSON.stringify(await items()) === snapBefore, "a reload brings the same drawings back");
  await pg.evaluate(async s => openBySymbol(s), DEC);
  await pg.waitForFunction(s => DR.s === s && DR.loaded, DEC, { timeout: 10000 });
  ok((await items()).length === 0, "another contract has its own drawings (none)");
  // copy / paste to another contract
  await pg.evaluate(async s => { await openBySymbol(s); }, NOV);
  await pg.waitForFunction(s => DR.s === s && DR.loaded && DR.items.length, NOV, { timeout: 10000 });
  await pg.evaluate(id => { DR.sel = id; drUiSel(); }, trendId);
  await pg.keyboard.press("Control+c");
  await pg.evaluate(async s => openBySymbol(s), DEC);
  await pg.waitForFunction(s => DR.s === s && DR.loaded, DEC, { timeout: 10000 });
  await pg.waitForTimeout(800);
  await pg.keyboard.press("Control+v"); await pg.waitForTimeout(900);
  ok((await items()).length === 1 && (await items())[0].type === "trend", "Ctrl+C / Ctrl+V copies a drawing to another contract");
  await pg.evaluate(async s => { await openBySymbol(s); }, NOV);
  await pg.waitForFunction(s => DR.s === s && DR.loaded && DR.items.length, NOV, { timeout: 10000 });
  await pg.waitForFunction(() => DISP.length > 100, null, { timeout: 10000 });

  // ---- other timeframes: a point falls on the bar that holds its time
  const tr5 = (await items()).find(d => d.id === trendId);
  await pg.evaluate(() => setTf("15m"));
  await pg.waitForFunction(() => curPlan && curPlan.t.min === 15 && DISP.length > 50, null, { timeout: 15000 }); await pg.waitForTimeout(800);
  const m15 = await pg.evaluate(t => { const L = t2L(t); return DISP[L] && DISP[L].time <= t && (!DISP[L + 1] || DISP[L + 1].time > t); }, tr5.pts[0].t);
  ok(m15, "on 15m the line starts on the 15m bar that holds its 5m bar");
  await pg.evaluate(() => setTf("5m"));
  await pg.waitForFunction(() => curPlan && curPlan.t.min === 5 && DISP.length > 100, null, { timeout: 15000 }); await pg.waitForTimeout(800);

  // ---- every chart type draws every drawing
  await pg.evaluate(() => {                           // one of every tool, in view
    const r = chart.timeScale().getVisibleLogicalRange(), lo = Math.ceil(r.from) + 3, hi = Math.min(DISP.length - 1, Math.floor(r.to)) - 2;
    let a = Infinity, b = -Infinity; for(let i = lo; i <= hi; i++){ a = Math.min(a, DISP[i].low); b = Math.max(b, DISP[i].high); }
    drBefore();
    for(const t of Object.keys(DT)){
      const d = {id: drId(), type: t, st: drNewStyle(t), text: "x"}, L0 = lo + 5, L1 = hi - 5;
      d.pts = DT[t].pos ? [{t: L2t(L0), p: (a + b) / 2}, {t: L2t(L1), p: t === "long" ? b : a}, {t: L2t(L1), p: t === "long" ? a : b}]
        : [{t: L2t(L0), p: a}, {t: L2t(L1), p: b}, {t: L2t((L0 + L1) >> 1), p: (a + b) / 2}, {t: L2t(L1 + 2), p: a}].slice(0, DT[t].n > 0 ? DT[t].n : 4);
      if(DT[t].pos) d.lots = 1;
      DR.items.push(d);
    }
    drChanged();
  });
  const nAll = (await items()).length;
  const bad = [];
  for(const t of ["candles", "hollow", "bars", "line", "area", "ha", "renko", "range", "lb", "pf"]){
    await pg.evaluate(t => ctSave({type: t}), t);
    await pg.waitForTimeout(t === "pf" ? 1500 : 900);
    const r = await pg.evaluate(() => ({geo: DR.geo.size, n: DR.items.filter(d => !d.hide).length, prim: DR.primSeries === series}));
    if(r.geo !== r.n || !r.prim) bad.push(`${t}: ${r.geo}/${r.n}`);
    if(t === "pf" || t === "renko") await pg.screenshot({ path: SHOT + `drawings_${t}.png` });
  }
  ok(!bad.length, `every drawing (${nAll}) is drawn on every chart type${bad.length ? ": " + bad.join(", ") : ""}`);
  // P&F: the measure counts boxes
  await pg.evaluate(() => { const n = DISP.length; DR.meas = {pts: [{t: DISP[n - 8].time, p: DISP[n - 8].low}, {t: DISP[n - 2].time, p: DISP[n - 2].high}], phase: "done"}; drRedraw(); });
  await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => /boxes/.test(drPriceInfo(DR.meas.pts[0].p, DR.meas.pts[1].p)) && /columns/.test(drTimeInfo(DR.meas.pts[0], DR.meas.pts[1], 0, 6))), "on P&F the measure counts boxes and columns");
  // P&F: angles in boxes and columns (1 box per column = 45°)
  const pfa = await pg.evaluate(() => { const n = DISP.length, d = {type: "angle", pts: [{t: DISP[n - 12].time, p: DISP[n - 12].low}, {t: DISP[n - 4].time, p: DISP[n - 12].low + 8 * CT_SIZE}]};
    const V = drView(), a = drXY(V, d.pts[0]), b = drXY(V, d.pts[1]); return drAngleText(drAngleInfo(a, b, d.pts[0].p, d.pts[1].p)); });
  ok(/^45\.0° \(boxes\) · \+[\d,.]+ \/ column$/.test(pfa), `on P&F a line rising 1 box per column reads 45° (${pfa})`);
  await pg.evaluate(() => { DR.meas = null; ctSave({type: "candles"}); });
  await pg.waitForTimeout(1200);
  await pg.evaluate(n => { drBefore(); DR.items = DR.items.slice(0, n); drChanged(); }, nAll - await pg.evaluate(() => Object.keys(DT).length));

  // ---- the measure: Shift+drag (green up, net ₹ for your lots), click clears; middle-button drag (MT5)
  await pg.evaluate(() => drPrefSet({lots: 2}));
  await pg.keyboard.down("Shift"); await drag(700, 600, 820, 380); await pg.keyboard.up("Shift");
  await pg.waitForTimeout(700);
  let ms = await pg.evaluate(() => DR.meas && {ph: DR.meas.phase, p0: DR.meas.pts[0].p, p1: DR.meas.pts[1].p, lines: drMoneyLines(DR.meas.pts[0].p, DR.meas.pts[1].p), pi: drPriceInfo(DR.meas.pts[0].p, DR.meas.pts[1].p), ti: drTimeInfo(DR.meas.pts[0], DR.meas.pts[1], t2L(DR.meas.pts[0].t), t2L(DR.meas.pts[1].t))});
  ok(ms && ms.ph === "done" && ms.p1 > ms.p0 && /ticks/.test(ms.pi) && /bars/.test(ms.ti), `Shift+drag measures: ${ms && ms.pi} · ${ms && ms.ti}`);
  const vb = await pg.evaluate(() => { const n = DISP.length; let v = 0; for(let i = n - 10; i < n; i++) v += DISP[i].vol || 0; return [v, drVolBetween(n - 10, n - 1), drTimeInfo({t: DISP[n - 10].time}, {t: DISP[n - 1].time}, n - 10, n - 1)]; });
  ok(vb[0] === vb[1] && (vb[0] === 0 || /Vol/.test(vb[2])), `the volume between two bars (${vb[2]})`);
  ok(ms && /^2 lots long: \+?−?₹[\d,]+ net$/.test(ms.lines[0]), `…and the net ₹ for 2 lots (${ms && ms.lines[0]})`);
  // that ₹ is the server's net: gross minus every charge both ways
  const chk = await pg.evaluate(async ([p0, p1]) => { const j = await api("/api/measure", {body: {s: cur.s, product: "INTRADAY", legs: [{side: 1, qty: 2 * (sym[cur.s].lot || 1), entry: p0, exit: p1}]}}); return {j: j.legs[0], mult: sym[cur.s].mult, lot: sym[cur.s].lot}; }, [ms.p0, ms.p1]);
  const gross = (ms.p1 - ms.p0) * 2 * chk.lot * chk.mult;
  ok(Math.abs(chk.j.gross - gross) < 0.01 && chk.j.charges > 0 && Math.abs(chk.j.net - (chk.j.gross - chk.j.charges)) < 0.02, `net = gross ${chk.j.gross} − charges ${chk.j.charges} = ${chk.j.net}`);
  await pg.screenshot({ path: SHOT + "drawings_measure.png" });
  await click(400, 400);
  ok(await pg.evaluate(() => !DR.meas), "a click clears the measure");
  await pg.mouse.move(...at(500, 300)); await pg.mouse.down({button: "middle"}); await pg.mouse.move(...at(620, 450), {steps: 5}); await pg.mouse.up({button: "middle"}); await pg.waitForTimeout(150);
  ok(await pg.evaluate(() => DR.meas && DR.meas.phase === "done" && DR.meas.pts[1].p < DR.meas.pts[0].p), "a middle-button drag measures too (MT5), red for a fall");
  await click(400, 400);
  await pg.click('#dtb [data-a="meas"]'); await click(450, 450); await pg.mouse.move(...at(560, 380), {steps: 3}); await click(560, 380);
  ok(await pg.evaluate(() => DR.meas && DR.meas.phase === "done"), "the ruler button, then click, move, click");
  // R against your trade's stop: open a paper long with a stop, measure again
  const pos = await pg.evaluate(async () => {
    await papi("reset", {confirm: "RESET", capital: 1000000});          // room for 1 lot (margin, loss limits)
    const t = last[cur.s]; const e = t.ask || t.ltp;
    const j = await papi("place", {s: cur.s, side: 1, type: "market", product: "INTRADAY", sl: roundTick(e - 40, cur.tick), mode: "lots", lots: 1});
    return j.ok || j.error;
  });
  await pg.waitForTimeout(600);
  await pg.evaluate(() => { drMoneyLines(DR.meas.pts[0].p, DR.meas.pts[1].p); });
  await pg.waitForTimeout(800);
  const rl = await pg.evaluate(() => drMoneyLines(DR.meas.pts[0].p, DR.meas.pts[1].p));
  ok(pos === true && rl.some(l => /^\d+\.\d\dR for your long \(SL /.test(l)), `with a long open, the measure shows R against its stop (${pos === true ? rl[1] : pos})`);
  await pg.evaluate(async () => { for(const p of P.snap.positions) await papi("close", {id: p.id}); await papi("reset", {confirm: "RESET", capital: 25000}); });
  await click(400, 400);

  // ---- long / short position drawings: the outcome on the real candles
  await pg.click('#dtb .dtb-more[data-g="range"]'); await pg.click('#dtbFly [data-t="long"]');
  const Lx = await pg.evaluate(() => { const r = chart.timeScale().getVisibleLogicalRange(); const L = Math.round(r.from + (r.to - r.from) * 0.3), V = drView(); return {x: V.xL(L), y: V.y(DISP[L].close)}; });
  await click(Lx.x, Lx.y);
  it = await items();
  const lg = it[it.length - 1];
  ok(lg.type === "long" && lg.pts.length === 3 && lg.pts[1].p > lg.pts[0].p && lg.pts[2].p < lg.pts[0].p, "a long position: target above, stop below");
  const ev = await pg.evaluate(id => drPosEval(drFind(id)), lg.id);
  // the same check done here, candle by candle
  const exp = await pg.evaluate(d => {
    const i = RAW.findIndex(b => b.time > d.pts[0].t);
    for(let j = i; j >= 0 && j < RAW.length && RAW[j].time <= d.pts[1].t; j++){ const b = RAW[j], s = b.low <= d.pts[2].p, t = b.high >= d.pts[1].p; if(s || t) return {kind: s && t ? "both" : s ? "sl" : "tp", t: b.time}; }
    return {kind: "open"};
  }, lg);
  ok(ev.kind === exp.kind && (exp.kind === "open" || ev.t === exp.t), `its outcome matches the candles (${ev.kind}${ev.t ? " at " + ev.t : ""})`);
  // drag the stop handle up: the stop moves only (and never past the entry)
  const [sx, sy] = await pg.evaluate(id => { const d = drFind(id), V = drView(); return [drXY(V, d.pts[0]).x, V.y(d.pts[2].p)]; }, lg.id);
  await drag(sx, sy, sx, sy - 400);
  const lg2 = (await items()).find(d => d.id === lg.id);
  ok(lg2.pts[2].p < lg2.pts[0].p && lg2.pts[2].p > lg.pts[2].p && lg2.pts[1].p === lg.pts[1].p, "dragging its stop moves the stop, never past the entry");
  await pg.evaluate(id => drSettings(drFind(id), "xy"), lg.id);
  const pxy = await pg.evaluate(() => [...document.querySelectorAll("#drSet .ds-xyh")].map(x => x.textContent));
  ok(pxy.join("|") === "Entry|Target|Stop|End (right edge)", "a position's coordinates: entry, target, stop, end");
  await pg.fill("#drSet .ds-xy >> nth=2 >> [data-xp]", String(lg2.pts[0].p + 5)); await pg.click("#drSet [data-ok]"); await pg.waitForTimeout(100);
  ok(/stop must be below/.test(await pg.textContent("#drSet [data-err]")) && (await items()).find(d => d.id === lg.id).pts[2].p === lg2.pts[2].p, "a long's stop typed above the entry is refused");
  await pg.screenshot({ path: SHOT + "drawings_coords.png" });
  await pg.click("#drSet .pif [data-x]");
  await pg.waitForTimeout(700);
  await pg.screenshot({ path: SHOT + "drawings_long.png" });
  // a made-up case: the stop and the target in one candle
  const both = await pg.evaluate(() => {
    const n = RAW.length, b = RAW[n - 30];
    const d = {type: "long", pts: [{t: RAW[n - 31].time, p: (b.high + b.low) / 2}, {t: RAW[n - 1].time, p: b.high - 0.1 * (b.high - b.low)}, {t: RAW[n - 1].time, p: b.low + 0.1 * (b.high - b.low)}]};
    return b.high > b.low ? drPosEval(d).kind : "both";
  });
  ok(both === "both", "a candle reaching both the stop and the target is marked (counted as the stop)");

  // ---- the trade manager's lines still win over a drawing on top of them
  await pg.evaluate(() => arm(1));
  await pg.waitForFunction(() => P.plan && slNow() != null && (P.drags || []).some(d => d.price && Math.abs(d.price() - slNow()) < 1e-6), null, { timeout: 15000 });   // (its SL line is on the chart)
  await pg.waitForTimeout(300);
  const sl = await pg.evaluate(() => series.priceToCoordinate(slNow()));
  await pg.evaluate(p => { drBefore(); DR.items.push({id: "onsl", type: "hline", pts: [{t: DISP[DISP.length - 5].time, p}], st: drNewStyle("hline"), text: ""}); drChanged(); DR.sel = null; }, await pg.evaluate(() => slNow()));
  await pg.waitForTimeout(300);
  await pg.mouse.move(...at(300, sl)); await pg.mouse.down(); await pg.mouse.move(...at(300, sl + 30), {steps: 4});
  const who = await pg.evaluate(() => ({paper: !!P.dragging, draw: !!DR.drag}));
  await pg.mouse.up(); await pg.waitForTimeout(200);
  ok(who.paper && !who.draw, "a drag on the new trade's SL line moves the SL, not a drawing under it");
  await pg.evaluate(() => { disarm(); drRemove("onsl"); });

  // ---- remove all (two clicks) and Ctrl+Z
  const nBefore = (await items()).length;
  await pg.click('#dtb [data-a="clear"]'); await pg.waitForTimeout(100);
  ok((await items()).length === nBefore, "🗑 once only asks");
  await pg.click('#dtb [data-a="clear"]'); await pg.waitForTimeout(150);
  ok((await items()).length === 0, "🗑 twice removes all on this contract");
  await pg.keyboard.press("Control+z"); await pg.waitForTimeout(150);
  ok((await items()).length === nBefore, "Ctrl+Z brings them all back");
  await pg.waitForTimeout(1000);
  ok(!errs.length, "no page errors (desktop)" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));

  // ---- the phone: ✎ opens the toolbar strip; draw with a finger; tap to select
  const ph = await br.newContext({ ...devices["Pixel 7"] });
  const mp = await ph.newPage();
  const merrs = []; mp.on("pageerror", e => merrs.push(e.message));
  await mp.goto("http://localhost:8766/"); await LOGIN(mp);
  await mp.waitForFunction(() => typeof drAttach === "function" && document.body.classList.contains("mob") && DR.loaded && DISP.length > 50, null, { timeout: 25000 });
  ok(!(await mp.isVisible("#dtb")) && await mp.isVisible("#bDraw"), "phone: the toolbar starts closed, ✎ is on the chart bar");
  await mp.tap("#bDraw"); await mp.waitForTimeout(300);
  ok(await mp.isVisible("#dtb") && await mp.evaluate(() => $("#dtb").getBoundingClientRect().height < 60), "✎ opens it as a strip above the chart");
  await mp.tap('#dtb .dtb-more[data-g="lines"]'); await mp.waitForTimeout(200);
  await mp.tap('#dtbFly [data-t="trend"]'); await mp.waitForTimeout(150);
  const n1 = await mp.evaluate(() => DR.items.length);
  const cb = await mp.locator("#chart").boundingBox();
  const cdp = await ph.newCDPSession(mp);
  const touch = async (type, x, y) => cdp.send("Input.dispatchTouchEvent", {type, touchPoints: type === "touchEnd" ? [] : [{x: cb.x + x, y: cb.y + y}]});
  await touch("touchStart", 80, 200); for(let k = 1; k <= 6; k++) await touch("touchMove", 80 + k * 25, 200 - k * 15); await touch("touchEnd");
  await mp.waitForTimeout(300);
  const mi = await mp.evaluate(() => DR.items.map(d => d.type));
  ok(mi.length === n1 + 1 && mi[mi.length - 1] === "trend", "a finger drag draws the trend line");
  await mp.evaluate(() => { DR.sel = null; drUiSel(); drRedraw(); });
  const [tx, ty] = await mp.evaluate(() => { const d = DR.items[DR.items.length - 1], V = drView(), a = drXY(V, d.pts[0]), b = drXY(V, d.pts[1]); return [(a.x + b.x) / 2, (a.y + b.y) / 2]; });
  await touch("touchStart", tx, ty); await touch("touchEnd"); await mp.waitForTimeout(300);
  ok(await mp.evaluate(() => DR.sel === DR.items[DR.items.length - 1].id) && await mp.isVisible("#dsel"), "a tap selects it; its bar shows");
  await mp.screenshot({ path: SHOT + "drawings_phone.png" });
  await mp.tap('#dsel [data-a="del"]'); await mp.waitForTimeout(200);
  ok(await mp.evaluate(n => DR.items.length === n, n1), "🗑 on its bar removes it");
  ok(!merrs.length, "no page errors (phone)" + (merrs.length ? ": " + merrs.slice(0, 3).join(" | ") : ""));
  await br.close();
})().catch(async e => { ok(false, "crashed: " + e.message); if(br) await br.close(); });
