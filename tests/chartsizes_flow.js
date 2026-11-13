// v0.44.0 (owner, 13 Nov 2026): Renko / range / P&F sizes on the chart bar like the timeframes (presets, pins, typed
// sizes), the size change that no longer rebuilds the chart, "Fixed" keeping the size on the chart (it was 1 tick: the
// hang), the bar cap for very small sizes, live ticks that re-feed only the live candle (bars exactly as a full build),
// the timeframe / chart type / size menus opening under their buttons, the ▾ naming what's in use when its button
// dropped out, and the phone. Needs the mock server and an admin with 2FA (run security_flow.js first).
const { chromium, devices } = require("playwright");
const LOGIN = require("./login.js");
const fs = require("fs");
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const CRUDE = "MCX:CRUDEOIL26NOVFUT";
let br;
(async () => {
  br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
  const errs = []; pg.on("pageerror", e => { errs.push(e.message); fs.writeSync(1, "PAGEERROR " + e.message + " | " + (e.stack || "").split("\n").slice(1, 4).join(" | ") + "\n"); });
  pg.on("console", m => { if(m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.evaluate(() => { const a = acctList().find(x => x.name === "Main"); if(a) acctSwitch(a.id); });
  // the open layout puts its chart (type, sizes, pins) back as the page starts: only then a clean start
  await pg.waitForFunction(() => typeof LAY !== "undefined" && LAY.ready && !LAY.applying, null, { timeout: 60000 });
  await pg.waitForTimeout(500);
  // a clean start: no sizes saved, Volume and a Pine SMA on the chart, the panel open, 5m candles
  await pg.evaluate(async () => {
    const c = {...(prefGet("ctype", {}) || {})}; for(const k of ["szFav", "rangeSize", "renkoBox", "pfBox"]) delete c[k];
    Object.assign(c, {type: "candles", rangeMode: "atr", renkoMode: "atr", pfMode: "atr", rangeAtr: 14, renkoAtr: 14}); prefSet("ctype", c);
    if(!document.body.classList.contains("nopanel")) togglePanel();      // (room on the chart bar; the cramped bar is checked below)
    await pineLoad(true);
    const old = PINE.scripts.find(s => s.name === "T SMA");
    const j = await api("/api/scripts/save", {body: {id: old ? old.id : null, name: "T SMA", source: '//@version=5\nindicator("T SMA", overlay=true)\nplot(ta.sma(close, 10), "SMA")'}});
    PINE.scripts = j.scripts; PINE.loaded = true;
    indSave([{type: "volume", id: "v1", ma: true, maLen: 20}, {type: "pine", id: "p1", scriptId: j.script.id, inputs: {}, overlay: true}]);
    setTf("5m"); await openBySymbol("MCX:CRUDEOIL26NOVFUT");
  });
  await pg.waitForFunction(() => RAW.length > 200 && last["MCX:CRUDEOIL26NOVFUT"], null, { timeout: 20000 });
  ok(await pg.evaluate(() => $("#ctSz").classList.contains("hide") && $("#bSz").classList.contains("hide")), "candles: no size buttons on the chart bar");

  // ---- range bars: the size buttons
  await pg.evaluate(() => ctSave({type: "range"}));
  await pg.waitForFunction(() => ctType() === "range" && DISP.length > 5 && CT_SIZE > 0, null, { timeout: 15000 });
  const s0 = await pg.evaluate(() => ({chips: [...document.querySelectorAll("#ctSz button")].map(b => ({t: b.textContent, v: b.dataset.sz, on: b.classList.contains("on")})),
    size: CT_SIZE, atr: szAtr(), presets: szPresets(), label: $("#bCt").textContent, hidden: $("#ctSz").classList.contains("hide")}));
  ok(!s0.hidden && s0.chips.length >= 3 && s0.chips[0].v === "atr" && s0.chips[0].on, `range: size buttons shown, ATR first and in use (${s0.chips.map(c => c.t).join(" | ")})`);
  ok(s0.chips[0].t === "ATR " + String(+s0.size.toFixed(8)), `the ATR button says the size it makes (${s0.chips[0].t}, size ${s0.size})`);
  ok(s0.label === "Range", `the chart type button says just the type ("${s0.label}")`);
  ok(s0.presets.length >= 4 && s0.presets.every(v => v >= s0.atr / 4 - 1e-9 && v <= s0.atr * 16 + 1e-9 && Math.abs(v - Math.round(v)) < 1e-9),
    `presets: whole ticks from ¼ to 16 x the ATR ${s0.atr.toFixed(2)} (${s0.presets.join(", ")})`);
  const pick = s0.chips.find(c => c.v !== "atr");
  // a size from its button: the chart isn't rebuilt (same chart, same series), the bars use it, Pine runs again on them
  const r1 = await pg.evaluate(async v => {
    const ch = chart, se = series, pine = INDS.find(r => r.cfg.id === "p1"), runs0 = pine.pine.lastRun;
    document.querySelector(`#ctSz button[data-sz="${v}"]`).click();
    await new Promise(r => { const t = Date.now(); (function w(){ if((pine.pine.lastRun !== runs0 && !pine.pine.running) || Date.now() - t > 15000) r(); else setTimeout(w, 30); })(); });
    const p = INDS.find(r => r.cfg.id === "p1");
    return {same: ch === chart && se === series, size: CT_SIZE, now: szNow(), mode: ctCfg().rangeMode, saved: (ctCfg().rangeSize || {})[ctKey()],
      wide: DISP.slice(0, -1).every(b => b.high - b.low <= CT_SIZE + 1e-6), on: $("#ctSz button.on") && $("#ctSz button.on").dataset.sz,
      pineLast: p.pine.times && p.pine.times[p.pine.n - 1], dispLast: dispLast().time, series: series.data().length, n: DISP.length};
  }, pick.v);
  ok(r1.same, "a new size doesn't rebuild the chart (same chart and series: panes, drawings and lines stay)");
  ok(r1.size === +pick.v && r1.mode === "fixed" && r1.saved === +pick.v && r1.on === pick.v, `the size from its button is used and saved for the contract (${r1.size})`);
  ok(await pg.evaluate(chips => JSON.stringify((ctCfg().szFav || {})["range|" + ctKey()]) === JSON.stringify(chips.map(c => c.v === "atr" ? "atr" : +c.v)), s0.chips),
    "the suggested buttons are kept once one is used (they don't move with the ATR)");
  ok(r1.wide && r1.series === r1.n, `every finished bar is within the range; the chart draws all ${r1.n} bars`);
  await pg.waitForFunction(() => { const p = INDS.find(r => r.cfg.id === "p1"); return p.pine.times && p.pine.times[p.pine.n - 1] === dispLast().time && new Set(DISP.map(b => b.time)).has(p.pine.times[0]); }, null, { timeout: 15000 })
    .then(() => ok(true, "the Pine script ran again on the new bars")).catch(() => ok(false, "the Pine script ran again on the new bars"));
  // ▾: under its button, presets + pins, a typed size, pin / unpin
  await pg.click("#bSz"); await pg.waitForSelector("#szPick:not(.hide)");
  const pos = await pg.evaluate(() => { const p = $("#szPick").getBoundingClientRect(), b = $("#bSz").getBoundingClientRect(); return {dx: p.left - b.left, dy: p.top - b.bottom, in: p.right <= $("section.chartwrap").getBoundingClientRect().right}; });
  ok(Math.abs(pos.dx) < 2 && pos.dy >= 0 && pos.dy < 10 && pos.in, `the size menu opens under its ▾ (${JSON.stringify(pos)})`);
  const grid = await pg.evaluate(() => [...document.querySelectorAll("#szGrid button")].map(b => ({t: b.textContent, v: b.dataset.sz, fav: b.classList.contains("fav"), on: b.classList.contains("on")})));
  ok(grid[0].v === "atr" && grid.some(g => g.on && g.fav && g.v === pick.v) && grid.filter(g => g.fav).length >= 3, `the menu lists ATR, the presets and the pins (${grid.map(g => g.t + (g.fav ? "★" : "")).join(" ")})`);
  await pg.screenshot({ path: SHOT + "sizes_menu.png" });
  const unpinned = grid.find(g => !g.fav && g.v !== "atr");
  await pg.click(`#szGrid button[data-sz="${unpinned.v}"]`, { button: "right" });
  await pg.waitForTimeout(300);
  const pinned = await pg.evaluate(v => ({chip: !!document.querySelector(`#ctSz button[data-sz="${v}"]`), fav: (ctCfg().szFav || {})["range|" + ctKey()], open: !$("#szPick").classList.contains("hide")}), unpinned.v);
  ok(pinned.chip && Array.isArray(pinned.fav) && pinned.fav.includes(+unpinned.v) && pinned.open, `right-click pins ${unpinned.v} on the bar (saved: ${JSON.stringify(pinned.fav)}), the menu stays open`);
  // typed: 7.5 on a 1-point tick -> 8 (whole ticks), pinned and used
  await pg.fill("#szCustom", "7.5"); await pg.press("#szCustom", "Enter");
  await pg.waitForFunction(() => CT_SIZE === 8, null, { timeout: 10000 }).then(() => ok(true, "a typed size in points is rounded to whole ticks (7.5 -> 8) and used")).catch(() => ok(false, "a typed size in points is used"));
  ok(await pg.evaluate(() => $("#szPick").classList.contains("hide") && !!document.querySelector('#ctSz button[data-sz="8"].on') && /whole number of ticks/.test([...document.querySelectorAll(".toast")].map(t => t.textContent).join(" "))),
    "…pinned on the bar, the menu closed, and a note says it was rounded");
  await pg.click("#bSz"); await pg.fill("#szCustom", "12t"); await pg.press("#szCustom", "Enter");
  await pg.waitForFunction(() => CT_SIZE === 12 * cur.tick, null, { timeout: 10000 }).then(() => ok(true, "ticks: 12t = 12 ticks")).catch(() => ok(false, "ticks: 12t = 12 ticks"));
  await pg.click("#bSz"); await pg.fill("#szCustom", "nonsense"); await pg.press("#szCustom", "Enter");
  ok(/points/.test(await pg.textContent("#szErr")) && await pg.isVisible("#szPick"), "a size it can't read: a message, the menu stays");
  await pg.fill("#szCustom", "ATR 20"); await pg.press("#szCustom", "Enter");
  await pg.waitForFunction(() => ctCfg().rangeMode === "atr" && ctCfg().rangeAtr === 20, null, { timeout: 10000 }).then(() => ok(true, "ATR 20: the ATR size with length 20")).catch(() => ok(false, "ATR 20"));
  ok(await pg.evaluate(() => Math.abs(CT_SIZE - CT.size(RAW, "atr", null, 20, cur.tick)) < 1e-9), "…the size is the 20-bar ATR");
  // right-click on a bar button unpins it
  await pg.dispatchEvent(`#ctSz button[data-sz="${unpinned.v}"]`, "contextmenu");      // (it may have dropped out of view: 7 pins)
  await pg.waitForTimeout(300);
  ok(await pg.evaluate(v => !document.querySelector(`#ctSz button[data-sz="${v}"]`) && !((ctCfg().szFav || {})["range|" + ctKey()] || []).includes(+v), unpinned.v), "right-click on a bar button unpins it");
  // the pins are per contract and type: Renko has its own
  await pg.evaluate(() => ctSave({type: "renko"}));
  await pg.waitForFunction(() => ctType() === "renko" && DISP.length > 3, null, { timeout: 15000 });
  ok(await pg.evaluate(() => !document.querySelector('#ctSz button[data-sz="8"]') && $("#ctSz button").dataset.sz === "atr"), "Renko has its own sizes (range's pins aren't on its bar)");
  // ---- the hang: "Fixed points" with no size saved for the contract used 1 tick
  const fx = await pg.evaluate(async () => {
    const was = CT_SIZE; $("#bCt").click(); await new Promise(r => setTimeout(r, 100));
    const sel = $("#ctRM"); sel.value = "fixed"; sel.dispatchEvent(new Event("change")); await new Promise(r => setTimeout(r, 300));
    return {was, now: CT_SIZE, saved: (ctCfg().renkoBox || {})[ctKey()], input: $("#ctRB") && $("#ctRB").value, tick: cur.tick, chip: $("#ctSz button.on") && $("#ctSz button.on").textContent};
  });
  ok(fx.now === fx.was && fx.saved === fx.was && +fx.input === fx.was, `Fixed points keeps the size on the chart (${fx.was}), not 1 tick (${fx.tick}) - the cause of the hang`);
  ok(fx.chip === String(fx.was), `…and the bar shows it as the size in use (${fx.chip})`);
  await pg.evaluate(() => $("#ctPick").classList.add("hide"));
  ok(await pg.evaluate(() => { const c = {...ctCfg(), renkoMode: "fixed", renkoBox: {}}; prefSet("ctype", c); CT_SIZE = null; const o = ctOpts(); return o.box === CT.size(RAW, "atr", null, c.renkoAtr, cur.tick); }),
    "a saved \"fixed\" with no size for the contract draws the ATR size, never 1 tick");
  // ---- very small sizes: the bars keep to the latest CT.MAX_BARS (lowered here so the mock's candles reach it)
  const cap = await pg.evaluate(async () => {
    CT.MAX_BARS = 1500; setTf("1m");
    await new Promise(r => { const t = Date.now(); (function w(){ if((curPlan && curPlan.res === "1" && RAW.length > 1000) || Date.now() - t > 20000) r(); else setTimeout(w, 50); })(); });
    await new Promise(r => setTimeout(r, 1500));
    ctSave({type: "range"}); szUse(cur.tick);
    const full = CT.transform(RAW, "range", ctOpts()).length;
    $("#bSz").click(); await new Promise(r => setTimeout(r, 100));
    const res = {start: CT_START, n: DISP.length, full, same: JSON.stringify(DISP) === JSON.stringify(CT.transform(RAW.slice(CT_START), "range", ctOpts())),
      note: $("#szNote").textContent};
    $("#szPick").classList.add("hide");
    histUserAt = Date.now(); histMore(); res.pill = ($("#histPill") || {}).textContent || "";
    return res;
  });
  ok(cap.start > 0 && cap.n < cap.full && cap.n <= 1500 * 1.3 && cap.n > 600, `a 1-tick range keeps to about the latest ${1500} bars (${cap.n} of ${cap.full}, from candle ${cap.start})`);
  ok(cap.same, "…exactly the bars a full build of those candles makes");
  ok(/too many bars/.test(cap.note), `…and the size menu says so ("${cap.note.slice(0, 90)}…")`);
  ok(/latest 1,500 bars/.test(cap.pill), `scrolling back doesn't load older candles it can't show ("${cap.pill}")`);
  // ---- live ticks: only the live candle is built again; the bars match a full build, the chart and Volume match
  await pg.evaluate(() => { CT.MAX_BARS = 20000; szUse(cur.tick * 3); });
  await pg.waitForFunction(() => CT_SIZE === 3 * cur.tick && DISP.length > 50, null, { timeout: 10000 });
  const live = await pg.evaluate(async () => {
    let n = 0, feeds = 0, ms = 0; const ob = CT.builder; CT.builder = function(){ const b = ob.apply(CT, arguments), f = b.feed; b.feed = x => { feeds++; return f(x); }; return b; };
    // a full build again (the builder now counts), then 12 s of the mock's live ticks
    showRaw(); feeds = 0;
    const od = dispLive; window.dispLive = function(){ n++; const a = performance.now(); od.apply(this, arguments); ms += performance.now() - a; };
    const r0 = RAW.length;
    await new Promise(r => setTimeout(r, 12000));
    window.dispLive = od; CT.builder = ob;
    const vol = INDS.find(x => x.cfg.type === "volume").hist.data();
    const full = CT.transform(RAW.slice(CT_START), "range", ctOpts());
    return {n, feeds, ms: Math.round(ms), newCandles: RAW.length - r0, same: JSON.stringify(DISP) === JSON.stringify(full),
      chart: series.data().length === DISP.length && series.data().every((d, i) => d.time === DISP[i].time && d.close === DISP[i].close),
      vol: vol.length === DISP.length && vol[vol.length - 1].time === dispLast().time && vol[vol.length - 1].value === (dispLast().vol || 0)};
  });
  ok(live.n >= 5, `live ticks reached the chart (${live.n} updates, ${live.newCandles} new candles)`);
  ok(live.feeds <= live.n * 3 + live.newCandles * 2 + 4, `each tick re-fed only the live candle (${live.feeds} candles fed for ${live.n} ticks, not the ${await pg.evaluate(() => RAW.length)} loaded)`);
  ok(live.same, "after the ticks the bars are exactly a full build's");
  ok(live.chart, "the chart's bars match them, bar for bar");
  ok(live.vol, "Volume has a value per bar, the last one the live bar's");
  // a live candle that makes bars and then doesn't (they come off the chart and Volume, the rest stays)
  const shrink = await pg.evaluate(() => {
    const L = RAW[RAW.length - 1], keep = {...L}, n0 = DISP.length;
    L.high = L.close + 20 * cur.tick; L.close = L.high; dispLive(); const up = DISP.length;
    Object.assign(L, keep); dispLive();
    const vol = INDS.find(x => x.cfg.type === "volume").hist.data();
    return {n0, up, back: DISP.length, chart: series.data().length, vol: vol.length, lastSame: series.data().slice(-1)[0].close === dispLast().close};
  });
  ok(shrink.up > shrink.n0 && shrink.back === shrink.n0 && shrink.chart === shrink.back && shrink.vol === shrink.back && shrink.lastSame,
    `bars a live candle made and then didn't come off again (${shrink.n0} -> ${shrink.up} -> ${shrink.back}; chart ${shrink.chart}, Volume ${shrink.vol})`);
  // ---- every built type follows live ticks exactly (Heikin-Ashi, Renko from highs and lows with wicks, line break, P&F)
  for(const [t, extra] of [["ha", {}], ["renko", {renkoSrc: "hl", renkoWicks: true}], ["lb", {}], ["pf", {pfSrc: "hl"}]]){
    await pg.evaluate(([t, extra]) => ctSave({type: t, ...extra}), [t, extra]);
    await pg.waitForFunction(t => ctType() === t && DISP.length > 3, t, { timeout: 15000 });
    await pg.waitForTimeout(5000);
    const r = await pg.evaluate(t => ({same: JSON.stringify(DISP) === JSON.stringify(CT.transform(RAW.slice(CT_START), t, ctOpts())), chart: series.data().length === DISP.length}), t);
    ok(r.same && r.chart, `${t}: after live ticks the bars are a full build's, and on the chart`);
  }
  await pg.evaluate(() => ctSave({type: "renko", renkoSrc: "close", renkoWicks: false}));
  // ---- the timeframe menu under its ▾ (owner's screenshot: it opened at the right end); the chart type menu under its button
  await pg.waitForTimeout(500);
  for(const [btn, menu] of [["#bTf", "#tfPick"], ["#bCt", "#ctPick"]]){
    await pg.click(btn); await pg.waitForSelector(menu + ":not(.hide)");
    const p = await pg.evaluate(([btn, menu]) => { const p = $(menu).getBoundingClientRect(), b = $(btn).getBoundingClientRect(), w = $("section.chartwrap").getBoundingClientRect();
      return {dx: Math.round(p.left - b.left), dy: Math.round(p.top - b.bottom), inside: p.left >= w.left && p.right <= w.right}; }, [btn, menu]);
    ok(Math.abs(p.dx) < 2 && p.dy >= 0 && p.dy < 10 && p.inside, `${menu} opens under ${btn} (${JSON.stringify(p)})`);
    if(menu === "#tfPick") await pg.screenshot({ path: SHOT + "sizes_tfmenu.png" });
    await pg.mouse.click(600, 700); await pg.waitForTimeout(150);
  }
  // near the right edge it stays inside the chart: a narrow window, the panel open
  await pg.evaluate(() => { if(document.body.classList.contains("nopanel")) togglePanel(); });
  await pg.setViewportSize({ width: 1000, height: 800 }); await pg.waitForTimeout(400);
  await pg.click("#bSz", { force: true }); await pg.waitForTimeout(200);
  const edge = await pg.evaluate(() => { const p = $("#szPick").getBoundingClientRect(), w = $("section.chartwrap").getBoundingClientRect(); return {right: p.right, wr: w.right, shown: !$("#szPick").classList.contains("hide")}; });
  ok(edge.shown && edge.right <= edge.wr, `a menu near the right edge stays inside the chart (${Math.round(edge.right)} <= ${Math.round(edge.wr)})`);
  await pg.mouse.click(300, 600);
  // ▾ names what's in use when its button doesn't fit (the panel open at 1000 px: little room)
  const cramp = await pg.evaluate(async () => { await new Promise(r => setTimeout(r, 300));
    const half = [...document.querySelectorAll(".charthead .tf button")].filter(b => { if(b.classList.contains("cut")) return false; const r = b.getBoundingClientRect(), R = b.parentElement.getBoundingClientRect(); return r.right > R.right + 1; });
    const tfOn = $("#tf button.on"), szOn = $("#ctSz button.on");
    const shown = b => b && !b.classList.contains("cut");
    return {half: half.length, tf: shown(tfOn) ? "button" : $("#bTf").textContent, sz: shown(szOn) ? "button" : $("#bSz").textContent, tfNow: tf}; });
  ok(cramp.half === 0, "no button is shown cut in half");
  ok(cramp.tf === "button" || cramp.tf === cramp.tfNow + "▾", `the timeframe in use is always in view (${cramp.tf})`);
  ok(cramp.sz === "button" || /▾$/.test(cramp.sz) && cramp.sz.length > 1, `the size in use is always in view (${cramp.sz})`);
  await pg.screenshot({ path: SHOT + "sizes_narrow.png" });
  await pg.setViewportSize({ width: 1500, height: 920 });
  // saved on the server: a reload brings the pins and the size back (prefs go 0.6 s after a change, the layout 0.9 s)
  await pg.waitForTimeout(2500);
  await pg.reload(); await pg.waitForFunction(() => typeof LAY !== "undefined" && LAY.ready && !LAY.applying && cur && DISP.length > 3 && ctType() === "renko", null, { timeout: 60000 }).catch(() => {});
  const rl = await pg.evaluate(() => ({t: typeof ctType === "function" && cur ? ctType() : null, fav: cur ? (ctCfg().szFav || {})["range|" + ctKey()] : null, bar: !$("#ctSz").classList.contains("hide"), lay: typeof LAY !== "undefined" && LAY.ready}));
  ok(rl.t === "renko" && Array.isArray(rl.fav) && rl.bar, `after a reload: Renko, its size buttons, range's pins kept (${JSON.stringify(rl)})`);
  // the page's start draws from saved candles before the contract's row comes: the size saved for the underlying applies
  ok(await pg.evaluate(() => { const row = sym[cur.s]; delete sym[cur.s]; const k = ctKey(); if(row) sym[cur.s] = row; return k === "CRUDEOIL" && cur.u === "CRUDEOIL"; }),
    "before the contract's row has come, sizes are found under its underlying (CRUDEOIL, kept with the open contract)");
  await pg.evaluate(() => { ctSave({type: "candles"}); indSave([]); setTf("5m"); });
  ok(errs.length === 0, "no script errors" + (errs.length ? ": " + errs.slice(0, 5).join(" / ") : ""));

  // ---- the phone: the size buttons on its chart bar, the menu as a sheet
  const ph = await (await br.newContext({ ...devices["Pixel 7"] })).newPage();
  const perrs = []; ph.on("pageerror", e => perrs.push(e.message));
  await ph.goto("http://localhost:8766/"); await LOGIN(ph);
  await ph.waitForFunction(() => document.body.classList.contains("mob") && typeof ctSave === "function" && cur, null, { timeout: 20000 });
  await ph.evaluate(async () => { await openBySymbol("MCX:CRUDEOIL26NOVFUT"); ctSave({type: "range"}); });
  await ph.waitForFunction(() => DISP.length > 3 && !$("#ctSz").classList.contains("hide"), null, { timeout: 20000 });
  ok(await ph.evaluate(() => { const b = $("#ctSz button"), r = b && b.getBoundingClientRect(); return !!r && r.height >= 30 && r.width > 0; }), "phone: the size buttons are on the chart bar (tap-sized)");
  await ph.evaluate(() => $("#bSz").scrollIntoView({inline: "center"}));
  await ph.click("#bSz"); await ph.waitForTimeout(300);
  const sheet = await ph.evaluate(() => { const p = $("#szPick"), r = p.getBoundingClientRect(); return {shown: !p.classList.contains("hide"), pos: getComputedStyle(p).position, left: r.left, right: innerWidth - r.right, n: p.querySelectorAll("#szGrid button").length}; });
  ok(sheet.shown && sheet.pos === "fixed" && sheet.left <= 10 && sheet.right <= 10 && sheet.n >= 4, `phone: ▾ opens the sizes as a sheet across the screen (${JSON.stringify(sheet)})`);
  await ph.screenshot({ path: SHOT + "sizes_phone.png" });
  const v = await ph.evaluate(() => document.querySelectorAll("#szGrid button")[2].dataset.sz);
  await ph.click(`#szGrid button[data-sz="${v}"]`);
  await ph.waitForFunction(v => CT_SIZE === +v, v, { timeout: 10000 }).then(() => ok(true, `phone: a size from the sheet is used (${v})`)).catch(() => ok(false, "phone: a size from the sheet is used"));
  await ph.evaluate(() => ctSave({type: "candles"}));
  ok(perrs.length === 0, "phone: no script errors" + (perrs.length ? ": " + perrs.slice(0, 3).join(" / ") : ""));
  await br.close();
})().catch(async e => { ok(false, e.message.split("\n")[0]); if(br) await br.close(); });
