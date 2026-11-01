// Trade replay (v0.29.0) in a browser, against the fake Fyers:
//  a trade taken from a 1m chart with Volume + a Pine script; afterwards the chart and the script are changed;
//  ▶ On chart (Journal) opens the replay over the page: the recorded timeframe and the recorded Pine code, the trade
//  drawn (markers, stop path), nothing saved (the page's own chart and the server's prefs untouched); exit / entry set-up
//  and "My current Pine" switch; ▶ Play: candles come one at a time, Pine follows bar by bar, a 5m chart builds its
//  forming candle from the 1-minute candles, other timeframes (request.security) stop at the replay's time, the net ₹
//  at each step; Entry / Exit jumps; ■ Stop; every chart type keeps the trade drawn; Esc closes; History's ▶ On chart;
//  the phone (History tab -> replay, its bar, Play). Automatic pictures are off.
// Needs the mock server and an admin with 2FA (run security_flow.js first). Resets the admin's paper account. ~5 min.
const { chromium, devices } = require("playwright");
const LOGIN = require("./login.js");
const fs = require("fs");
const D = process.env.FYERS_HELPER_DATA || ".";
const SHOT = D + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const CRUDE = "MCX:CRUDEOIL26NOVFUT";
const V1 = `//@version=5\nindicator("RP Test v1", overlay=true)\nplot(ta.sma(close, 5), "SMA")\nplot(request.security(syminfo.tickerid, "15", close), "HTF")\n`;
const V2 = V1.replace("RP Test v1", "RP Test v2").replace("ta.sma(close, 5)", "ta.sma(close, 9)");
let br;
(async () => {
  br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push("main: " + e.message));
  await fetch("http://localhost:8766/_mock/allday?on=1", {method: "POST"});    // (the fake Fyers' candles stop at 23:30 otherwise)
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.waitForFunction(() => typeof P !== "undefined" && P.snap, null, { timeout: 20000 });
  const sid = await pg.evaluate(async src => {
    if(P.snap.mode === "live") throw new Error("the admin's account is Live - run live_flow.js to the end first");
    await papi("reset", {confirm: "RESET", capital: 1000000});
    await papi("trail", {be_on: false, sl_on: false});
    await api("/api/journal/settings", {body: {rules: {block_dd: false, block_afk: false, block_end: false}, shots: {auto: false, chart: false}}});   // (an earlier suite may have left them on; the default is checked in replay_test.py)
    const old = (await api("/api/scripts")).scripts.find(s => s.name === "RP Test");
    const j = await api("/api/scripts/save", {body: {id: old ? old.id : undefined, name: "RP Test", source: src}});
    PINE.scripts = j.scripts; PINE.loaded = true;
    return j.script.id;
  }, V1);
  await pg.evaluate(async ([c, sid]) => {
    await openBySymbol(c); if(tf !== "1m") setTf("1m");
    indSave([{type: "volume", id: "v1"}, {type: "pine", id: "rp1", scriptId: sid, inputs: {}, overlay: true}]); indBuild();
  }, [CRUDE, sid]);
  await pg.waitForFunction(() => cur && last[cur.s] && HROWS.length && INDS.some(r => r.pine && r.pine.res), null, { timeout: 40000 });
  await pg.waitForTimeout(1500);

  // ---- the trade: opened, its stop moved, held ~75 s, closed
  const placed = await pg.evaluate(async () => { const l = last[cur.s];
    const j = await papi("place", {s: cur.s, side: 1, type: "market", sl: Math.round(l.ltp - 25), tp: Math.round(l.ltp + 60), mode: "lots", lots: 1, product: "MARGIN"});
    return j.ok ? "ok" : j.error; });
  ok(placed === "ok", "a trade from the 1m chart (Volume + a Pine script on it)");
  await pg.waitForTimeout(25000);
  await pg.evaluate(async () => { const p = P.snap.positions[0]; await papi("modify", {id: p.id, sl: p.sl + 5}); });
  await pg.waitForTimeout(25000);
  await pg.evaluate(async () => { const p = P.snap.positions[0]; await papi("modify", {id: p.id, sl: p.sl + 5}); });
  await pg.waitForTimeout(25000);
  await pg.evaluate(async () => { for(const p of P.snap.positions) await papi("close", {id: p.id}); });
  const jt = await pg.evaluate(async () => { const j = (await api("/api/journal")).j; return j.trades.slice().sort((a, b) => (b.opened || 0) - (a.opened || 0))[0]; });
  ok(jt && jt.status === "closed" && jt.replay === true, "the journal trade is closed and marked as recorded");
  ok(!(jt.shots || []).length, "automatic pictures off: none taken");
  const rv = await pg.evaluate(async id => api("/api/journal/replay?id=" + encodeURIComponent(id)), jt.id);
  ok(rv.ok && rv.setup.entry && rv.setup.entry.src === "order" && rv.setup.entry.chart.tf2 === "1m", "entry set-up: the chart the order came from (1m)");
  ok(rv.setup.entry.chart.indicators.some(c => c.type === "pine" && c.scriptId === sid) && rv.setup.entry.scripts.some(s => s.source === V1), "entry set-up: the Pine script and its code then");
  ok(rv.path.length === 3 && rv.path[1][3] === "edit" && rv.path[2][1] === rv.path[0][1] + 10 && rv.path_src === "recorded", `the stop's path: first stop, two moves (${JSON.stringify(rv.path.map(p => p[1]))})`);
  ok(rv.setup.exit && rv.setup.exit.chart.tf2 === "1m", "exit set-up recorded too");

  // ---- afterwards the chart and the script change
  await pg.evaluate(async ([sid, src]) => { const j = await api("/api/scripts/save", {body: {id: sid, name: "RP Test", source: src}}); PINE.scripts = j.scripts; setTf("15m"); }, [sid, V2]);
  await pg.waitForTimeout(2000);
  ok(true, "waiting ~100 s for the trade's minutes to be in Fyers' (fake) history");
  await pg.waitForTimeout(100000);

  // ---- ▶ On chart from the Journal
  await pg.evaluate(() => pgShow("journal"));
  await pg.waitForSelector(`.jt-row[data-id="${jt.id}"]`, { timeout: 15000 });
  await pg.click(`.jt-row[data-id="${jt.id}"]`);
  await pg.click(`button[data-act="replay"][data-id="${jt.id}"]`);
  await pg.waitForSelector("#rpWrap iframe", { timeout: 5000 });
  const fr = () => pg.frames().find(f => /[?&]replay=/.test(f.url()));
  for(let i = 0; i < 40 && !fr(); i++) await pg.waitForTimeout(250);
  let F = fr();
  F.on && F.on("pageerror", e => errs.push("frame: " + e.message));
  pg.on("console", m => { if(m.type() === "error" && /replay/.test(m.location().url || "")) errs.push("console: " + m.text()); });
  const ready = async (f, n = 60) => { for(let i = 0; i < n; i++){ try{ const x = await f.evaluate(() => window.rpTest && rpTest.info()); if(x && !x.loading && x.raw > 0 && x.inds.some(r => r.t === "pine" && r.lastT)) return x; }catch(e){} await pg.waitForTimeout(500); } return null; };
  let I = await ready(F);
  ok(I && I.s === CRUDE && I.tf === "1m", `the replay opens on the recorded chart: CRUDEOIL 1m (${I && I.tf})`);
  ok(I && I.inds.some(r => r.name === "RP Test v1" && !r.err) && I.inds.some(r => r.t === "volume"), `the recorded indicators, the Pine code as it was then (${I && JSON.stringify(I.inds.map(r => r.name))})`);
  ok(I && I.src === "order" && I.ph === "entry", "entry set-up, from the order's chart");
  const dsk = await F.evaluate(() => { const c = document.querySelector("#chart").getBoundingClientRect(); return {w: c.width, h: c.height, vw: innerWidth}; });
  ok(dsk.w > dsk.vw * 0.9 && dsk.h > 500, `desktop: the chart fills the replay under its bar (${Math.round(dsk.w)}×${Math.round(dsk.h)})`);
  const geo = await F.evaluate(() => { drRedraw(); return new Promise(r => setTimeout(() => r({has: DR.items.some(d => d.id === "rp-trade"), geo: DR.geo.has("rp-trade"), bar: !!document.querySelector("#rpBar .rp-net")}), 400)); });
  ok(geo.has && geo.geo && geo.bar, "the trade is drawn on the chart; the bar shows its result");
  await pg.screenshot({ path: SHOT + "replay_static.png" });
  const mainTf = await pg.evaluate(() => tf);
  const srvPrefs = await pg.evaluate(async () => (await api("/api/prefs")).prefs.tf2);
  ok(mainTf === "15m" && srvPrefs === "15m", "your own chart is untouched (15m, on the page and on the server)");
  // a change inside the replay isn't saved
  await F.evaluate(() => setTf("3m"));
  await pg.waitForTimeout(1500);
  ok(await pg.evaluate(async () => (await api("/api/prefs")).prefs.tf2) === "15m", "a timeframe picked in the replay isn't saved");
  await F.evaluate(() => setTf("1m"));
  await ready(F);

  // ---- ▶ Play
  await F.click('#rpBar [data-a="play"]');
  await pg.waitForTimeout(500);
  const a = await F.evaluate(() => rpTest.info());
  await pg.waitForTimeout(2500);
  const b = await F.evaluate(() => rpTest.info());
  ok(a.T != null && b.T > a.T && b.i > a.i && b.playing, `Play: the replay moves on (step ${a.i} -> ${b.i})`);
  ok(b.last && b.last.time <= b.T + 19800, "Play: no candle after the replay's time");
  await F.click('#rpBar [data-a="play"]');                 // pause
  await pg.waitForTimeout(2500);
  const c = await F.evaluate(() => rpTest.info());
  const pineAt = c.inds.find(r => r.t === "pine");
  ok(!c.playing && pineAt && pineAt.lastT === c.last.time, `Pine has worked out the bars up to the replay's time (its last bar = the chart's last bar)`);
  const htf = await F.evaluate(async () => { const r = await pineNeed({tf: "15", ticker: ""}); return {lastOpen: r[r.length - 1].openTime / 1000, T: RP.T}; });
  ok(htf.lastOpen < htf.T, "request.security on 15m stops at the replay's time (no candle from after it)");
  const n0 = c.i;
  await F.click('#rpBar [data-a="step"]');
  await pg.waitForTimeout(300);
  ok((await F.evaluate(() => rpTest.info())).i === n0 + 1, "+1: one candle on");
  await F.click('#rpBar [data-a="jentry"]');
  await pg.waitForTimeout(1500);
  const e = await F.evaluate(() => ({i: rpTest.info(), st: document.querySelector("#rpSt").textContent, trade: RP.d.trade}));
  ok(e.i.T >= e.trade.opened && e.i.T - e.trade.opened <= 60, "Entry: the replay at the entry's minute");
  for(let k = 0; k < 20 && !/open · [+−]₹/.test(await F.evaluate(() => document.querySelector("#rpSt").textContent)); k++) await pg.waitForTimeout(300);
  const st1 = await F.evaluate(() => document.querySelector("#rpSt").textContent);
  ok(/open · [+−]₹[\d,.]+ \([+-]?\d/.test(st1) && /SL /.test(st1), `while open: the net ₹ and R after charges, and the stop (${st1})`);
  await F.click('#rpBar [data-a="jexit"]');
  await pg.waitForTimeout(1500);
  const st2 = await F.evaluate(() => document.querySelector("#rpSt").textContent);
  ok(/closed: [+−]₹/.test(st2), `Exit: closed, with the trade's net (${st2})`);
  await pg.screenshot({ path: SHOT + "replay_exit.png" });
  // the 5m chart: its forming candle builds minute by minute
  await F.evaluate(() => setTf("5m"));
  for(let k = 0; k < 40; k++){ await pg.waitForTimeout(500); const x = await F.evaluate(() => rpTest.info()); if(x.tf === "5m" && x.T != null && x.raw) break; }
  await F.evaluate(() => rpTest.rpJump("entry"));
  await pg.waitForTimeout(1500);
  const f1 = await F.evaluate(() => rpTest.info());
  const ok5 = await F.evaluate(() => { const T = RP.T, rows = rpTest.rowsAt(T), last = rows[rows.length - 1];
    const ms = RP.sub.filter(s => s[0] >= last[0] && s[0] + 60 <= T);
    return {n: ms.length, hi: Math.max(...ms.map(s => s[2])), lo: Math.min(...ms.map(s => s[3])), row: last, aligned: last[0] % 300 === 0}; });
  ok(f1.tf === "5m" && ok5.aligned && (ok5.n === 0 || (ok5.row[2] === ok5.hi && ok5.row[3] === ok5.lo)), `5m: the forming candle is built from its minutes so far (${ok5.n} of them)`);
  await F.click('#rpBar [data-a="bar"]');
  await pg.waitForTimeout(600);
  const f2 = await F.evaluate(() => rpTest.info());
  ok(f2.T > f1.T && (f2.T % 300 === 0 || f2.i === f2.steps - 1), `⏭: to the 5m candle's close, or the last minute there is (${f1.T % 300} -> ${f2.T % 300})`);
  ok(f2.net > 0, `the net ₹ at each step came from the server (${f2.net} prices)`);
  // every chart type keeps the trade drawn
  for(const t of ["ha", "hollow", "renko", "range", "lb", "pf", "bars", "line", "area"]){
    await F.evaluate(t => ctSave({type: t}), t);
    await pg.waitForTimeout(900);
    const g = await F.evaluate(() => { drRedraw(); return new Promise(r => setTimeout(() => r({geo: DR.geo.has("rp-trade"), type: ctType(), n: DISP.length}), 300)); });
    ok(g.type === t && g.n > 0 && g.geo, `chart type ${t}: the trade is drawn`);
  }
  await F.evaluate(() => ctSave({type: "candles"}));
  await F.click('#rpBar [data-a="stop"]');
  await pg.waitForTimeout(1000);
  ok((await F.evaluate(() => rpTest.info())).T == null, "■ Stop: the whole chart again");

  // ---- exit set-up / my current Pine (the frame reloads with the choice)
  await F.click('#rpBar [data-a="code"][data-v="mine"]');
  await pg.waitForTimeout(1500);
  F = fr(); I = await ready(F);
  ok(I && I.code === "mine" && I.inds.some(r => r.name === "RP Test v2"), `My current Pine: your code as it is now (${I && JSON.stringify(I.inds.map(r => r.name))})`);
  await F.click('#rpBar [data-a="ph"][data-v="exit"]');
  await pg.waitForTimeout(1500);
  F = fr(); I = await ready(F);
  ok(I && I.ph === "exit", "Exit set-up");
  // Esc closes
  await F.evaluate(() => document.body.focus());
  await F.press("body", "Escape");
  await pg.waitForTimeout(500);
  ok(!(await pg.$("#rpWrap")), "Esc: back to your page");

  // ---- History's ▶ On chart
  await pg.evaluate(() => pgShow("history"));
  await pg.waitForSelector("#pgHT tr.hr", { timeout: 15000 });
  await pg.click("#pgHT tr.hr");
  await pg.click("#pgHT .rp-open");
  await pg.waitForSelector("#rpWrap iframe", { timeout: 5000 });
  for(let i = 0; i < 40 && !fr(); i++) await pg.waitForTimeout(250);
  I = await ready(fr());
  ok(I && I.s === CRUDE && I.drawings >= 1, "History › ▶ On chart opens the same replay");
  await fr().click('#rpBar [data-a="back"]');
  await pg.waitForTimeout(500);
  ok(!(await pg.$("#rpWrap")), "← Back closes it");

  // ---- the phone
  const mctx = await br.newContext({ ...devices["Pixel 7"] });
  const mp = await mctx.newPage();
  mp.on("pageerror", e => errs.push("phone: " + e.message));
  await mp.goto("http://localhost:8766/"); await LOGIN(mp);
  await mp.waitForFunction(() => document.body.classList.contains("mob") && typeof M !== "undefined", null, { timeout: 20000 });
  await mp.evaluate(() => { M.histDays = 0; mShow("history"); });
  await mp.waitForSelector("#ms_history .mhist", { timeout: 15000 });
  await mp.click("#ms_history .mhist");
  await mp.click("#ms_history .rp-open");
  await mp.waitForSelector("#rpWrap iframe", { timeout: 5000 });
  const mfr = () => mp.frames().find(f => /[?&]replay=/.test(f.url()));
  for(let i = 0; i < 40 && !mfr(); i++) await mp.waitForTimeout(250);
  const mI = await (async () => { for(let i = 0; i < 60; i++){ try{ const x = await mfr().evaluate(() => window.rpTest && rpTest.info()); if(x && x.raw) return x; }catch(e){} await mp.waitForTimeout(500); } return null; })();
  ok(mI && mI.s === CRUDE, "phone: History › ▶ On chart opens the replay full screen");
  const lay = await mfr().evaluate(() => { const b = document.querySelector("#rpBar").getBoundingClientRect(), c = document.querySelector("#chart").getBoundingClientRect();
    return {bw: b.width, vw: innerWidth, ch: c.height, mob: document.body.classList.contains("mob"), over: document.documentElement.scrollWidth > innerWidth + 1}; });
  ok(lay.bw <= lay.vw && !lay.over && lay.ch > 450 && !lay.mob, `phone: the bar fits, the chart has room (${Math.round(lay.ch)} px), no sideways scroll`);
  const bh = await mfr().evaluate(() => document.querySelector("#rpBar").getBoundingClientRect().height);
  ok(bh < 150, `phone: the replay bar stays small (${Math.round(bh)} px)`);
  await mfr().click('#rpBar [data-a="more"]');
  ok(await mfr().evaluate(() => getComputedStyle(document.querySelector("#rpBar .rp-opts")).display !== "none" && !!document.querySelector('#rpBar [data-a="ph"][data-v="exit"]').offsetParent),
     "phone: ⋯ shows the set-up / Pine switches and the notes");
  await mfr().click('#rpBar [data-a="more"]');
  await mfr().click('#rpBar [data-a="play"]');
  await mp.waitForTimeout(2000);
  const mP = await mfr().evaluate(() => rpTest.info());
  ok(mP.playing && mP.T != null, "phone: ▶ Play works");
  await mp.screenshot({ path: SHOT + "replay_phone.png" });
  await mfr().click('#rpBar [data-a="back"]');
  await mp.waitForTimeout(500);
  ok(!(await mp.$("#rpWrap")), "phone: ← Back");

  ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.slice(0, 4).join(" | ") : ""));
  await fetch("http://localhost:8766/_mock/allday?on=0", {method: "POST"});
  await br.close();
})().catch(async e => { ok(false, "crashed: " + (e.stack || e)); await fetch("http://localhost:8766/_mock/allday?on=0", {method: "POST"}).catch(() => {}); if(br) await br.close(); });
