// The Journal page (Octagon port, v0.26.0) in a browser: paper trades arrive on their own; the trade card and its
// facts (net of charges); the audit form (8 pillars, live preview, Zen -> Execution wrong, tags, plan, review) saved on
// the server; hold to claim a rep; filters (saved in prefs); remove / bring back; the lockouts refuse orders (2% line
// set tiny here, then its switch; ending the session by hand cancels a waiting order); the header pill; pillar text
// editable and back to the original; a reload keeps everything; the phone (More › Journal, the form full screen).
// Needs the mock server and an admin with 2FA (run security_flow.js first). Resets the admin's paper account.
const { chromium, devices } = require("playwright");
const LOGIN = require("./login.js");
const fs = require("fs");
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const CRUDE = "MCX:CRUDEOIL26NOVFUT";
const RUN = "r" + (Date.now() % 1e7);            // this run's own words, so earlier runs' trades don't match the searches
let br;
(async () => {
  br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1400, height: 900 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.waitForFunction(() => P.snap, null, { timeout: 20000 });
  // a fresh start: a big paper balance (so 2% is ₹20,000 and nothing locks by accident), the journal's rules at their defaults
  await pg.evaluate(async () => {
    if(P.snap.mode === "live") throw new Error("the admin's account is Live - run live_flow.js to the end first");
    await papi("reset", {confirm: "RESET", capital: 1000000});
    await papi("trail", {be_on: false, sl_on: false});
    await api("/api/journal/settings", {body: {rules: {dd_pct: 2, block_dd: true, block_afk: false, block_end: false, cancel_pending: true, rep_block: 50, reps_before: 0}, pillars: {"1": null}, p1: null}});
    prefSet("jn", {});
  });
  await pg.evaluate(async c => { await openBySymbol(c); }, CRUDE);
  await pg.waitForFunction(() => cur && last[cur.s], null, { timeout: 20000 });
  const before = await pg.evaluate(async () => (await api("/api/journal")).j.trades.length);
  const roundTrip = () => pg.evaluate(async () => {
    const l = last[cur.s];
    const j = await papi("place", {s: cur.s, side: 1, type: "market", sl: Math.round(l.ltp - 30), tp: Math.round(l.ltp + 60), mode: "lots", lots: 1, product: "MARGIN"});
    if(!j.ok) return j.error;
    await new Promise(r => setTimeout(r, 900));
    const p = P.snap.positions[0]; if(p) await papi("close", {id: p.id});
    return "ok";
  });
  // ---- a trade arrives on its own: open first, then closed
  await pg.evaluate(async () => { const l = last[cur.s]; await papi("place", {s: cur.s, side: 1, type: "market", sl: Math.round(l.ltp - 30), tp: Math.round(l.ltp + 60), mode: "lots", lots: 1, product: "MARGIN"}); });
  await pg.waitForTimeout(600);
  let jd = await pg.evaluate(async () => (await api("/api/journal")).j);
  const openT = jd.trades.find(t => t.status === "open");
  ok(jd.trades.length === before + 1 && openT && openT.avg > 0 && openT.first_sl, `an opened position is in the journal at once (open, entry ${openT && openT.avg}, stop ${openT && openT.first_sl})`);
  await pg.evaluate(async () => { const p = P.snap.positions[0]; await papi("close", {id: p.id}); });
  await pg.waitForTimeout(500);
  ok((await roundTrip()) === "ok", "a second trade");
  await pg.waitForTimeout(500);
  const hist = await pg.evaluate(async () => (await api("/api/paper/history?days=2")));
  jd = await pg.evaluate(async () => (await api("/api/journal")).j);
  const mine = jd.trades.filter(t => t.status === "closed").sort((a, b) => b.closed - a.closed);
  const h0 = (hist.rows || [])[0] || {};
  const same = mine.length >= 2 && mine.some(t => Math.abs(t.net - h0.net) < 0.005 && t.r === h0.r);
  ok(same, `closed trades carry the engine's own net (all charges) and R (${mine[0] && mine[0].net}, ${mine[0] && mine[0].r}R)`);

  // ---- the page
  await pg.click('#nav button[data-pg="journal"]');
  await pg.waitForSelector(".jn-trade", { timeout: 10000 });
  let n = await pg.$$eval(".jn-trade", x => x.length);
  ok(n === jd.trades.filter(t => !t.hidden).length, `the Journal page lists every trade (${n})`);
  const reps = await pg.textContent("#jnReps");
  ok(/Hold to claim rep/.test(reps) && /Reps/.test(reps), "Reps card: a new rep waits to be claimed");
  const jl = await pg.evaluate(() => P.snap.jlock), todayTxt = await pg.textContent("#jnToday");
  ok(jl ? todayTxt.includes(jl.text) : /Clear\. .* of room before the 2% line/.test(todayTxt), `Today card: ${jl ? "the lock (from an earlier run)" : "clear, with the room before the 2% line"}`);
  ok(/Net result/.test(await pg.textContent("#jnStrip")) && await pg.$("#jnStrip svg"), "stats strip and the balance curve");
  await pg.screenshot({ path: SHOT + "journal_trades.png" });

  // ---- the audit form
  const tid = await pg.$eval(".jn-trade", el => el.dataset.id);
  await pg.click(`.jn-trade[data-id="${tid}"] .jt-row`);
  ok(/Gross · charges · net/.test(await pg.textContent(`.jn-trade[data-id="${tid}"]`)), "a card opens to its facts (gross, charges, net, risk at the first stop)");
  await pg.click(`.jn-trade[data-id="${tid}"] [data-act="audit"]`);
  await pg.waitForSelector("#jnOct .jn-pillar");
  ok(await pg.$$eval("#jnOct .jn-pillar", x => x.length) === 8, "the audit form shows the 8 pillars");
  ok((await pg.textContent("#jpl_1")).includes("TradingView for context, MT5 for routing only"), "pillar text word for word");
  const pv = async (sel, wait = 500) => { await pg.click(sel); await pg.waitForTimeout(wait); };
  await pv('#jnOct [data-oct="direction"][data-v="Correct"]'); await pv('#jnOct [data-oct="wait"][data-v="Patient"]');
  await pv('#jnOct [data-oct="execution"][data-v="Correct"]'); await pv('#jnOct [data-oct="zen"][data-v="Compromised"]');
  let f = await pg.evaluate(() => ({ex: JN.form.o.execution, faults: JN.form.o.execFaults, dis: document.querySelector('#jnOct [data-oct="execution"][data-v="Correct"]').disabled, p3: document.querySelector("#jps_3").textContent, p7: document.querySelector("#jps_7").textContent}));
  ok(f.ex === "Wrong" && f.faults.includes("zen") && f.dis && /broken/.test(f.p3) && /broken/.test(f.p7), `Zen Temple breach: Execution wrong and locked, pillars 3 and 7 broken (preview: ${f.p3} / ${f.p7})`);
  await pv('#jnOct [data-oct="zen"][data-v="Sanctuary"]'); await pv('#jnOct [data-oct="execution"][data-v="Correct"]');
  await pv('#jnOct [data-p1="bos15"]', 200);
  await pg.fill("#jnNum_bias", "−1,5"); await pg.waitForTimeout(100);
  await pg.fill("#jnTagIn", "Breakout" + RUN); await pg.press("#jnTagIn", "Enter");
  await pg.fill("#jnTagIn", "BOS,"); await pg.waitForTimeout(100);
  await pg.fill("#jnNotes", "Waited for the 15M close. " + RUN); await pg.fill("#jnReview", "Spread ate it.");
  await pg.waitForTimeout(600);
  f = await pg.evaluate(() => ({p1: document.querySelector("#jps_1").textContent, p2: document.querySelector("#jps_2").textContent, note: document.querySelector("#jnFSealNote").textContent, tags: JN.form.o.setup}));
  ok(/held/.test(f.p1) && /held/.test(f.p2) && f.tags.join() === "Breakout" + RUN + ",BOS", `the preview follows each click (${f.note}); tags ${f.tags.join(", ")}`);
  await pg.screenshot({ path: SHOT + "journal_audit.png" });
  await pg.click("#jnSave"); await pg.waitForTimeout(700);
  ok(!(await pg.isVisible(".jn-mbox")), "Save closes the form");
  let t = await pg.evaluate(async id => (await api("/api/journal")).j.trades.find(x => x.id === id), tid);
  ok(t.direction === "Correct" && t.wait === "Patient" && t.execution === "Correct" && t.zen === "Sanctuary" && t.bias === -1.5
     && t.setup.join() === "Breakout" + RUN + ",BOS" && t.notes === "Waited for the 15M close. " + RUN && t.p1Checks.join() === "bos15", "saved on the server: pillars, bias, tags, plan, review, checks");
  ok(t.audit.recorded === (t.net < 0) || t.audit.recorded, `the audit counts as recorded (losing trade: Pillar 8 optional) — recorded ${t.audit.recorded}`);
  const card = await pg.textContent(`.jn-trade[data-id="${tid}"]`);
  ok(/1 · Direction ✓/.test(card) && card.includes("Breakout" + RUN) && card.includes("Waited for the 15M close"), "the card shows the pillars, tags and plan");

  // ---- hold to claim a rep
  const rep0 = await pg.evaluate(() => JN.d.trades.filter(x => !x.claimedAt && x.rep).length);
  await pg.$eval("#jnClaim", el => el.scrollIntoView({block: "center"})); await pg.waitForTimeout(200);
  const b = await pg.$("#jnClaim"); const bb = await b.boundingBox();
  await pg.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await pg.mouse.down(); await pg.waitForTimeout(300); await pg.mouse.up(); await pg.waitForTimeout(400);
  ok(await pg.evaluate(() => JN.d.trades.filter(x => !x.claimedAt && x.rep).length) === rep0, "a short tap doesn't claim");
  await pg.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await pg.mouse.down(); await pg.waitForTimeout(1200); await pg.mouse.up(); await pg.waitForTimeout(600);
  ok(await pg.evaluate(() => JN.d.trades.filter(x => !x.claimedAt && x.rep).length) === rep0 - 1, "holding claims the rep");

  // ---- filters (saved in prefs)
  await pg.selectOption("#jfOct", "untagged"); await pg.waitForTimeout(300);
  n = await pg.$$eval(".jn-trade", x => x.length);
  ok(!(await pg.$(`.jn-trade[data-id="${tid}"]`)) && n >= 1, `Octagon › Not fully audited leaves the audited trade out (${n} shown)`);
  await pg.selectOption("#jfOct", ""); await pg.fill("#jfQ", "close. " + RUN); await pg.waitForTimeout(500);
  ok(await pg.$$eval(".jn-trade", x => x.length) === 1, "search finds the trade by its plan");
  await pg.fill("#jfQ", ""); await pg.waitForTimeout(300);
  await pg.click('.jn-msb[data-ms="tag"]'); await pg.check(`#jmsTag input[data-v="breakout${RUN}"]`); await pg.waitForTimeout(300);
  ok(await pg.$$eval(".jn-trade", x => x.length) === 1 && (await pg.textContent('.jn-msb[data-ms="tag"]')).includes("Breakout" + RUN), "the tag filter");
  await pg.click('#jmsTag [data-clear]'); await pg.mouse.click(5, 300);
  await pg.selectOption("#jfPeriod", "today"); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => prefGet("jn", {}).period === "today"), "filters are saved in your prefs (every device)");

  // ---- remove from the journal, bring back
  await pg.click(`.jn-trade[data-id="${tid}"] [data-act="hide"]`); await pg.waitForTimeout(600);
  ok(!(await pg.$(`.jn-trade[data-id="${tid}"]`)) && /removed from the journal/.test(await pg.textContent("#jnHid")), "Remove from journal hides it (and says so)");
  await pg.click("#jnShowHid"); await pg.waitForTimeout(300);
  if(!(await pg.$(`.jn-trade[data-id="${tid}"] [data-act="restore"]`))) await pg.click(`.jn-trade[data-id="${tid}"] .jt-row`);
  await pg.click(`.jn-trade[data-id="${tid}"] [data-act="restore"]`); await pg.waitForTimeout(600);
  await pg.selectOption("#jfOct", ""); await pg.waitForTimeout(300);
  ok(!!(await pg.$(`.jn-trade[data-id="${tid}"]`)), "Bring back");

  // ---- a lockout refuses orders. On a fresh account (each run), so "session ended" can be tested again: one losing
  // round trip, then the 2% line set tiny, so the session's loss already crosses it
  const main = await pg.evaluate(() => ACCT);
  const jt = await pg.evaluate(async () => { const r = await api("/api/accounts/create", {body: {name: "Journal test " + (Date.now() % 1e6), capital: 1000000}});
    S.accounts = r.accounts; acctSetup(); acctSwitch(r.account.id); return r.account.id; });
  await pg.waitForFunction(id => P.snap && ACCT === id, jt, { timeout: 10000 });
  await pg.evaluate(async () => { await papi("trail", {be_on: false, sl_on: false}); await api("/api/journal/settings", {body: {rules: {block_end: true, block_afk: true}}}); });
  ok((await roundTrip()) === "ok", "a losing round trip on a fresh account");
  await pg.click('#jnSub button[data-v="settings"]'); await pg.waitForSelector("#jr_dd_pct");
  await pg.fill("#jr_dd_pct", "0.001"); await pg.press("#jr_dd_pct", "Tab"); await pg.waitForTimeout(900);
  const lock = await pg.evaluate(async () => (await api("/api/paper")).paper.jlock);
  ok(lock && lock.kind === "dd" && lock.on, `the 2% lockout is on (${lock && lock.text})`);
  let r = await roundTrip();
  ok(/Blocked by your journal \(Pillar 4\)/.test(r), `a new order is refused: "${r}"`);
  await pg.waitForTimeout(600);
  ok(await pg.isVisible("#pJLock") && /2% lockout/.test(await pg.textContent("#pJLock")), "the header shows the lockout");
  await pg.click('#jnSub button[data-v="trades"]'); await pg.waitForTimeout(400);
  ok(/Locked out at/.test(await pg.textContent("#jnToday")), "the Today card says why");
  await pg.screenshot({ path: SHOT + "journal_locked.png" });
  await pg.click('#jnSub button[data-v="settings"]'); await pg.waitForSelector('input[data-rule="block_dd"]');
  await pg.uncheck('input[data-rule="block_dd"]'); await pg.waitForTimeout(700);
  // ---- a waiting order is cancelled when the session is ended by hand
  const lim = await pg.evaluate(async () => { const l = last[cur.s]; return (await papi("place", {s: cur.s, side: 1, type: "limit", price: Math.round(l.ltp - 200), sl: Math.round(l.ltp - 230), mode: "lots", lots: 1, product: "MARGIN"})).ok; });
  ok(lim && await pg.evaluate(() => P.snap.orders.length === 1), "switch off: orders go through again (a limit order waits)");
  ok(/not blocking/.test(await pg.textContent("#pJLock")), "the header still shows it, as not blocking");
  await pg.click('#jnSub button[data-v="trades"]'); await pg.waitForTimeout(400);
  if(!(await pg.isVisible("#jnEnd"))) await pg.click("#jnTodayTog");
  await pg.$eval("#jnEnd", el => el.scrollIntoView({block: "center"})); await pg.waitForTimeout(200);
  const eb = await (await pg.$("#jnEnd")).boundingBox();
  await pg.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2); await pg.mouse.down(); await pg.waitForTimeout(1500); await pg.mouse.up(); await pg.waitForTimeout(1200);
  const after = await pg.evaluate(async () => { const p = (await api("/api/paper")).paper; return {orders: p.orders.length, lock: p.jlock}; });
  ok(after.orders === 0 && after.lock && after.lock.kind === "end", `Hold to end today's session: locked and the waiting order cancelled (${after.orders} orders left)`);
  r = await roundTrip();
  ok(/Blocked by your journal \(Pillar 5\)/.test(r), "orders are refused after the session ends");
  await pg.evaluate(async () => { await api("/api/journal/settings", {body: {rules: {dd_pct: 2, block_dd: true, block_end: false}}}); });
  await pg.waitForTimeout(400);
  ok((await roundTrip()) === "ok", "block_end off: trading again");
  jd = await pg.evaluate(async () => (await api("/api/journal")).j);
  ok(jd.trades.some(t => t.acct === jt) && jd.trades.some(t => t.acct === main), "the journal holds both accounts' trades");
  // back to the main account; the test account is archived (its trades stay in the journal)
  await pg.evaluate(async ({main, jt}) => { acctSwitch(main); await api("/api/accounts/update", {body: {id: jt, archived: true}}); await acctRefresh(); }, {main, jt});
  await pg.waitForFunction(id => P.snap && ACCT === id, main, { timeout: 10000 });

  // ---- the pillars' text is editable and comes back
  await pg.click('#jnSub button[data-v="settings"]'); await pg.waitForSelector('.jn-pled[data-n="2"] textarea');
  await pg.fill('.jn-pled[data-n="2"] textarea', "Only Patient may click. My own words."); await pg.click('[data-save="2"]'); await pg.waitForTimeout(700);
  ok(await pg.evaluate(() => JN.d.pillars[1].rule === "Only Patient may click. My own words." && JN.d.pillars[1].edited), "a pillar's rule edited and saved");
  await pg.click('[data-orig="2"]'); await pg.waitForTimeout(700);
  ok(await pg.evaluate(() => /Restless \(amber\)/.test(JN.d.pillars[1].rule) && !JN.d.pillars[1].edited), "Original puts the text back");

  // ---- a reload keeps it all
  await pg.reload(); await pg.waitForFunction(() => P.snap, null, { timeout: 20000 });
  await pg.evaluate(() => pgShow("journal")); await pg.waitForSelector(".jn-trade", { timeout: 10000 });
  ok(await pg.evaluate(({id, RUN}) => { const t = JN.d.trades.find(x => x.id === id); return t && t.notes === "Waited for the 15M close. " + RUN && jPref().period === "today"; }, {id: tid, RUN}), "after a reload: the audit and the filters are still there");
  ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));

  // ---- the phone
  const mctx = await br.newContext({ ...devices["Pixel 7"] });
  const mp = await mctx.newPage(); const merrs = []; mp.on("pageerror", e => merrs.push(e.message));
  await mp.goto("http://localhost:8766/"); await LOGIN(mp);
  await mp.waitForFunction(() => P.snap && document.body.classList.contains("mob"), null, { timeout: 20000 });
  await mp.evaluate(() => mShow("more")); await mp.waitForTimeout(300);
  ok(await mp.isVisible('#ms_more [data-pg="journal"]'), "phone: More has a Journal row");
  await mp.click('#ms_more [data-pg="journal"]'); await mp.waitForSelector(".jn-trade", { timeout: 10000 });
  const w = await mp.evaluate(() => ({sw: document.documentElement.scrollWidth, vw: innerWidth}));
  ok(w.sw <= w.vw + 1, `phone: the Journal fits the screen (${w.sw} / ${w.vw}px)`);
  await mp.click(".jn-trade .jt-row"); await mp.click('.jn-trade [data-act="audit"]'); await mp.waitForSelector("#jnOct .jn-pillar");
  const mb = await mp.evaluate(() => { const r = document.querySelector(".jn-mbox").getBoundingClientRect(); return {w: r.width, vw: innerWidth}; });
  ok(Math.abs(mb.w - mb.vw) < 2, "phone: the audit form is full screen");
  await mp.screenshot({ path: SHOT + "journal_phone_audit.png" });
  await mp.click("#jnCancel"); await mp.waitForTimeout(200);
  await mp.screenshot({ path: SHOT + "journal_phone.png", fullPage: false });
  ok(!merrs.length, "phone: no page errors" + (merrs.length ? ": " + merrs.join(" | ") : ""));
  await br.close();
})().catch(async e => { ok(false, "crashed: " + (e.stack || e)); if(br) await br.close(); });
