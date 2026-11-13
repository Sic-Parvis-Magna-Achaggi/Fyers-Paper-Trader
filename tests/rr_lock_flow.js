// Browser test (v0.32.0, LiveTrader 1.24): the RR box and padlock under the chart's BUY / SELL, the locked tool (drag the
// target -> the stop follows; drag the stop -> the target follows; net RR kept), the ticket's padlock, the tool gap,
// per-trade trailing on the entry line (typing an R switches it on; the panel takes the trades back), the phone's padlock.
// Run after security_flow.js.  FYERS_HELPER_DATA=/tmp/fyers_test node tests/rr_lock_flow.js
const { chromium, devices } = require("playwright");
const LOGIN = require("./login.js");
const B = "http://localhost:8766/";
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
require("fs").mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { require("fs").writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const CRUDE = "MCX:CRUDEOIL26NOVFUT";

let br;
(async () => {
  br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1500, height: 920 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  pg.on("console", m => { if(m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });
  pg.on("dialog", d => d.accept());
  await pg.goto(B); await LOGIN(pg);
  await pg.evaluate(() => { const a = acctList().find(x => x.name === "Main"); if(a) acctSwitch(a.id); });
  // a fresh account each run (₹10,00,000), so earlier test trades can't trip the journal's lockouts; archived at the end
  const main = await pg.evaluate(() => ACCT);
  const ta = await pg.evaluate(async () => { const r = await api("/api/accounts/create", {body: {name: "RR test " + (Date.now() % 1e6), capital: 1000000}});
    S.accounts = r.accounts; acctSetup(); acctSwitch(r.account.id); return r.account.id; });
  await pg.waitForFunction(id => P.snap && ACCT === id, ta, { timeout: 10000 });
  await pg.evaluate(() => papi("ticket", {tp_r: 2, rr_lock: false, mode: "lots", lots: 1}));   // 1 lot: the test account (₹1,00,000) at 1% can't size CRUDEOIL
  await pg.evaluate(() => { P.ticketLoaded = false; return papi("trail", {be_on: false, sl_on: false, be_r: 1, sl_r: 1}); });
  await pg.evaluate(c => openBySymbol(c), CRUDE);
  await pg.waitForFunction(c => last[c] && last[c].ltp && typeof dispLast === "function" && dispLast(), CRUDE, { timeout: 20000 });
  for(const p of await pg.evaluate(() => P.snap.positions.map(x => x.id))) await pg.evaluate(id => papi("close", {id}), p);

  // ---- the RR box and padlock under BUY / SELL
  ok(await pg.isVisible("#ctools #cRR") && await pg.isVisible("#ctools #cLock"), "RR box and padlock under the chart's BUY / SELL");
  const boxes = await pg.evaluate(() => ["#cBuy", "#cRR", "#cLock"].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; }));
  ok(boxes[1].y > boxes[0].y + boxes[0].h - 1 && boxes[2].y > boxes[0].y + boxes[0].h - 1, "both sit under the buttons");
  ok(await pg.inputValue("#cRR") === "RR 2.0", "shows the ticket's RR: " + await pg.inputValue("#cRR"));
  await pg.click("#cBuy");
  await pg.waitForFunction(() => P.plan && P.plan.rr != null, null, { timeout: 10000 });
  await pg.fill("#cRR", "RR 3"); await pg.press("#cRR", "Enter");
  await pg.waitForFunction(() => P.T.tp_r === 3 && P.plan && P.plan.rr >= 2.95, null, { timeout: 8000 }).catch(() => {});
  const r3 = await pg.evaluate(() => ({rr: P.plan.reward / P.plan.risk, box: document.querySelector("#cRR").value, tkr: document.querySelector("#tkTpR").value}));
  ok(r3.rr >= 2.99 && r3.rr < 3.2, `typing RR 3: the tool's target went to net ${r3.rr.toFixed(3)}R`);
  ok(r3.box === "RR 3.0" && r3.tkr === "3", "the box and the ticket's R agree: " + r3.box + " / " + r3.tkr);
  await pg.fill("#cRR", "abc"); await pg.press("#cRR", "Enter"); await pg.waitForTimeout(300);
  ok(await pg.inputValue("#cRR") === "RR 3.0" && await pg.evaluate(() => P.T.tp_r === 3), "a bad RR is refused, the box shows the RR again");

  // ---- lock it
  await pg.click("#cLock");
  ok(await pg.evaluate(() => P.T.rr_lock) && await pg.$eval("#cLock", b => b.classList.contains("on")), "the padlock locks (amber)");
  ok(await pg.$eval("#tkLock", b => b.classList.contains("on")), "the ticket's padlock shows it too");
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: SHOT + "rr_01_locked.png" });

  const chartBox = await pg.$eval("#chart", e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; });
  const X = chartBox.x + chartBox.w * 0.42;
  const yOf = price => pg.evaluate(p => series.priceToCoordinate(p), price);
  // (v0.44.2: a placed target is held as P.T.tpAt; with the lock, the plan carries the stop worked out for it once the server answers)
  const settle = async () => { await pg.waitForTimeout(400); await pg.waitForFunction(() => P.plan && !P.dragging
    && !(P.T.rr_lock && P.T.lockBy === "tp" && P.T.tpAt != null && P.plan.lockTp !== P.T.tpAt), null, { timeout: 10000 }); await pg.waitForTimeout(1600); };
  async function drag(fromPrice, toPrice){       // aimed at a price on every step: the price scale rescales while a line moves
    await pg.mouse.move(X, chartBox.y + await yOf(fromPrice)); await pg.mouse.down();
    for(let k = 1; k <= 8; k++) await pg.mouse.move(X, chartBox.y + await yOf(fromPrice + (toPrice - fromPrice) * k / 8));
    for(let k = 0; k < 3; k++) await pg.mouse.move(X, chartBox.y + await yOf(toPrice));
    const at = await pg.evaluate(() => P.T.tpAt);     // the price scale rescales while a line moves: where it really is
    await pg.mouse.up();
    return at;
  }
  // RR lock: drag the target closer -> the stop tightens, net RR stays 3. (The entry follows the market, so distances
  // from the entry are compared, not prices.) The test account's 2% risk cap stops 1 CRUDEOIL lot's stop going much wider.
  const st = () => pg.evaluate(() => ({e: P.plan.entry, sl: slNow(), tp: tpNow(), d: P.T.slDist, td: Math.abs(tpNow() - basisNow()),
    rr: P.plan.reward / P.plan.risk, lots: P.plan.lots}));
  // a limit entry, so the tool holds still while the server works (at market it follows every price change)
  await pg.fill("#tkPrice", String(await pg.evaluate(c => Math.round(last[c].ltp) - 3, CRUDE))); await pg.press("#tkPrice", "Enter");
  await pg.evaluate(() => { P.T.slDist = 18; rememberDist(); P.T.tpMode = "r"; renderTicket(); toolRedraw(); preview(0); });  // the same start every run
  await settle();
  let s0 = await st();
  const tpTo = s0.tp - Math.round(s0.td * 0.3);
  const dropped = await drag(s0.tp, tpTo);
  await settle();
  let s1 = await st();
  ok(s1.d < s0.d, `dragging the target ${Math.round(s0.td * 0.3)} points closer tightened the stop: ${s0.d} -> ${s1.d} points`);
  ok(s1.rr >= 2.99 && s1.rr < 3.2, `net RR kept: ${s1.rr.toFixed(3)}`);
  ok(dropped != null && Math.abs(s1.tp - dropped) <= 2, `the target stayed where it was dropped (${s1.tp} for ${dropped}; ₹1 ticks)`);
  // drag the stop closer -> the target follows
  const slTo = s1.sl + Math.round(s1.d * 0.3);
  await drag(s1.sl, slTo);
  await settle();
  let s2 = await st();
  ok(s2.d < s1.d && s2.td < s1.td, `dragging the stop closer (${s1.d} -> ${s2.d} points): the target followed (${s1.td} -> ${s2.td} points)`);
  ok(s2.rr >= 2.99 && s2.rr < 3.2, `net RR kept: ${s2.rr.toFixed(3)}`);
  // typing a target in the ticket while locked
  const typed = await pg.evaluate(() => tpNow() - 5);
  await pg.fill("#tkTp", String(typed)); await pg.press("#tkTp", "Enter");
  await settle();
  let s3 = await st();
  ok(s3.d < s2.d && s3.rr >= 2.99 && s3.rr < 3.2, `typing the target ${typed} in the ticket: stop ${s2.d} -> ${s3.d} points, net RR ${s3.rr.toFixed(3)}`);
  // far beyond what the rules allow: the stop stops where 1 lot still fits, and says so
  await pg.evaluate(() => document.querySelectorAll(".toast").forEach(t => t.remove()));
  const far = await pg.evaluate(() => tpNow() + 1000);       // 2% risk cap on ₹10,00,000: 1 lot can risk about 198 points
  await pg.fill("#tkTp", String(far)); await pg.press("#tkTp", "Enter");
  await pg.waitForFunction(() => [...document.querySelectorAll(".toast")].some(t => /RR lock: the stop can't go wider/.test(t.textContent)), null, { timeout: 8000 }).catch(() => {});
  const toastTxt = await pg.evaluate(() => [...document.querySelectorAll(".toast")].map(t => t.textContent).join(" | "));
  ok(/RR lock: the stop can't go wider .* rules allow/.test(toastTxt), "past the risk cap: it says the rules stop the stop going wider: " + toastTxt);
  await settle();
  const s4 = await st();
  ok(s4.lots === 1 && s4.rr >= 2.99 && s4.rr < 3.2, `...and the tool still trades 1 lot at net ${s4.rr.toFixed(3)}R`);
  await pg.screenshot({ path: SHOT + "rr_02_dragged.png" });

  // ---- saved: a reload keeps the RR and the lock
  await pg.reload(); await LOGIN(pg);
  await pg.waitForFunction(() => P.ticketLoaded, null, { timeout: 15000 });
  ok(await pg.evaluate(() => P.T.rr_lock && P.T.tp_r === 3) && await pg.inputValue("#cRR") === "RR 3.0", "after a reload: RR 3.0, still locked");
  await pg.evaluate(c => openBySymbol(c), CRUDE);
  await pg.waitForFunction(c => last[c] && last[c].ltp && dispLast(), CRUDE, { timeout: 20000 });

  // ---- unlocked: dragging the target leaves the stop
  await pg.click("#cLock");
  ok(!(await pg.evaluate(() => P.T.rr_lock)), "the padlock unlocks");
  await pg.click("#cBuy");
  await pg.waitForFunction(() => P.plan && P.plan.rr != null, null, { timeout: 10000 });
  await pg.waitForTimeout(1600);
  s0 = await pg.evaluate(() => ({e: P.plan.entry, sl: slNow(), tp: tpNow(), d: P.T.slDist}));
  await drag(s0.tp, s0.tp + 15);
  await pg.waitForTimeout(1500);
  s1 = await pg.evaluate(() => ({sl: slNow(), d: P.T.slDist, mode: P.T.tpMode}));
  ok(s1.d === s0.d && s1.mode === "dist", "unlocked: dragging the target doesn't move the stop");

  // ---- the tool gap (Chart settings, default 30 px after the live candle's right edge)
  await pg.evaluate(() => chart.timeScale().scrollToPosition(90, false));     // room on the right of the live candle
  await pg.waitForTimeout(600);
  const gapNow = () => pg.evaluate(() => { const xl = chart.timeScale().timeToCoordinate(dispLast().time), bs = chart.timeScale().options().barSpacing;
    return {toolX: P.toolX, edge: xl + bs / 2, max: chart.timeScale().width() - 170, def: chartCfg().toolGap}; });
  const g1 = await gapNow();
  ok(g1.def === 30 && g1.edge + 80 < g1.max && Math.abs(g1.toolX - (g1.edge + 30)) < 1.5, `the tool starts 30 px after the live candle's right edge (x ${g1.toolX.toFixed(1)}, candle edge ${g1.edge.toFixed(1)})`);
  await pg.evaluate(() => { prefSet("chart", {...(prefGet("chart", {}) || {}), toolGap: 80}); applyChartCfg(); toolRedraw(); });
  await pg.waitForTimeout(600);
  const g2 = await gapNow();
  ok(Math.abs(g2.toolX - (g2.edge + 80)) < 1.5, `Tool gap 80: x ${g2.toolX.toFixed(1)} (candle edge ${g2.edge.toFixed(1)})`);
  await pg.screenshot({ path: SHOT + "rr_05_gap.png" });
  await pg.evaluate(() => { const c = {...(prefGet("chart", {}) || {})}; delete c.toolGap; prefSet("chart", c); applyChartCfg(); });
  await pg.click("#bCfg").catch(() => {});
  ok(await pg.$('#cfgBody input[data-k="toolGap"]') !== null, "Chart settings has the Tool gap box");
  await pg.click("#bCfg");                                   // ⚙ again closes Chart settings
  await pg.evaluate(() => { P.T.slDist = 18; rememberDist(); disarm(); });   // leave the remembered stop as found

  // ---- per-trade trailing on the entry line
  const ltp = await pg.evaluate(c => last[c].ltp, CRUDE);
  const r = await pg.evaluate(([c, sl]) => papi("place", {s: c, side: 1, type: "market", sl, mode: "lots", lots: 1, product: "MARGIN"}), [CRUDE, ltp - 10]);
  ok(r.ok, "a trade to try the line's controls on" + (r.ok ? "" : ": " + r.error));
  await pg.waitForSelector("#posbars .pbar [data-a='be_r']", { timeout: 8000 });
  ok(/as the panel/.test(await pg.getAttribute("#posbars .pbar [data-a='be_on']", "title")), "a new trade's BE-T says it follows the panel");
  await pg.fill("#posbars .pbar [data-a='be_r']", "0.4"); await pg.press("#posbars .pbar [data-a='be_r']", "Enter");
  await pg.waitForFunction(() => P.snap.positions[0].tr.be_on && P.snap.positions[0].tr.be_r === 0.4, null, { timeout: 8000 }).catch(() => {});
  ok(await pg.evaluate(() => P.snap.positions[0].tr.be_on), "typing 0.4 in the line's BE-T box switched its Trail BE on (LiveTrader 1.24)");
  await pg.waitForFunction(() => /set on this trade/.test(document.querySelector("#posbars .pbar [data-a='be_on']").title), null, { timeout: 5000 }).catch(() => {});
  ok(await pg.$eval("#posbars .pbar [data-a='be_on']", b => b.classList.contains("on") && /set on this trade/.test(b.title)), "its BE-T is on and says it's set on this trade");
  await pg.fill("#posbars .pbar [data-a='sl_r']", "1.5"); await pg.press("#posbars .pbar [data-a='sl_r']", "Enter");
  await pg.waitForFunction(() => P.snap.positions[0].tr.sl_on, null, { timeout: 8000 }).catch(() => {});
  ok(await pg.evaluate(() => P.snap.positions[0].tr.sl_on && P.snap.positions[0].tr.sl_r === 1.5), "typing 1.5 in TRAIL's box switched Trail SL on at 1.5R");
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: SHOT + "rr_03_line.png" });
  await pg.click("#trBe");                                    // the panel's Trail BE: every trade follows it again
  await pg.waitForFunction(() => P.snap.trail.be_on && !P.snap.positions[0].tr.own_be, null, { timeout: 8000 }).catch(() => {});
  const t4 = await pg.evaluate(() => P.snap.positions[0].tr);
  ok(t4.be_on && t4.be_r === 1 && !t4.own_be, `the panel's Trail BE took the trade back (on, ${t4.be_r}R, as the panel)`);
  ok(t4.sl_on && t4.sl_r === 1.5 && t4.own_sl, "...and left its own Trail SL alone");
  await pg.waitForTimeout(600);
  ok(/as the panel/.test(await pg.getAttribute("#posbars .pbar [data-a='be_on']", "title")), "its BE-T says so");
  ok(await pg.evaluate(() => trailTips({tr: {be_on: true, be_r: 1}, be_done: true}).beDone && !trailTips({tr: {be_on: false}, be_done: true}).beDone),
     "BE-T shows 'done' once the stop is at break-even (only while it's on)");
  await pg.click('#nav button[data-pg="trades"]'); await pg.waitForSelector("#pgPos button.tg");
  ok(/as the panel/.test(await pg.getAttribute("#pgPos button.tg[data-t='be_on']", "title")) && /set on this trade/.test(await pg.getAttribute("#pgPos button.tg[data-t='sl_on']", "title")),
     "the Trades page shows the same (BE-T as the panel, TRAIL set on this trade)");
  await pg.click('#nav button[data-pg="chart"]');
  await pg.evaluate(() => papi("trail", {be_on: false}));
  for(const p of await pg.evaluate(() => P.snap.positions.map(x => x.id))) await pg.evaluate(id => papi("close", {id}), p);
  ok(errs.length === 0, "no script errors" + (errs.length ? ": " + errs.join(" | ") : ""));
  await pg.evaluate(async ({main, ta}) => { acctSwitch(main); await api("/api/accounts/update", {body: {id: ta, archived: true}}); await acctRefresh(); }, {main, ta});

  // ---- the phone: the padlock in the order sheet
  const ph = await br.newContext({ ...devices["Pixel 7"] });
  const m = await ph.newPage();
  const merrs = []; m.on("pageerror", e => merrs.push(e.message));
  await m.goto(B); await LOGIN(m);
  await m.waitForFunction(() => document.body.classList.contains("mob") && P.ticketLoaded, null, { timeout: 15000 });
  await m.evaluate(c => openBySymbol(c), CRUDE);
  await m.waitForFunction(c => last[c] && last[c].ltp, CRUDE, { timeout: 20000 });
  await m.click("#mBar [data-side='1'], #mBuy").catch(async () => { await m.evaluate(() => arm(1)); });
  await m.waitForSelector("#mtLock", { timeout: 10000 });
  ok(await m.isVisible("#mtLock"), "phone: a padlock beside the target's R in the order sheet");
  const lock0 = await m.evaluate(() => P.T.rr_lock);
  await m.tap("#mtLock");
  ok(await m.evaluate(l => P.T.rr_lock === !l, lock0) && await m.$eval("#mtLock", (b, l) => b.classList.contains("on") === !l, lock0), "phone: tapping it locks / unlocks");
  await m.screenshot({ path: SHOT + "rr_04_phone.png" });
  if(await m.evaluate(() => P.T.rr_lock)) await m.tap("#mtLock");
  ok(merrs.length === 0, "phone: no script errors" + (merrs.length ? ": " + merrs.join(" | ") : ""));
  await br.close();
})().catch(async e => { ok(false, "crashed: " + e.message); if(br) await br.close(); });
