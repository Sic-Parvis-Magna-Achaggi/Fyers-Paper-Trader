// Browser test (v0.44.2): the long / short tool holds a stop and target you've placed (dragged, typed or stepped on the
// phone) at their prices while the entry follows the market; the lots are worked out again from the new entry-to-stop
// distance; the order placed carries those exact prices. Before you place them they still follow the entry. A price
// that has gone past a held stop blocks PLACE with a clear message; moving the stop again clears it. The RR lock: the
// line you moved last holds, the other keeps the RR. Desktop (mouse drags), an iPad (the desktop page by touch, typed
// prices) and a Pixel 7 (the phone's order sheet, - / +).
// Run after security_flow.js.  FYERS_HELPER_DATA=/tmp/fyers_test node tests/held_levels_flow.js
const { chromium, devices } = require("playwright");
const LOGIN = require("./login.js");
const B = "http://localhost:8766/";
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
require("fs").mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { require("fs").writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const CRUDE = "MCX:CRUDEOIL26NOVFUT";

let br;
async function setup(pg, label){
  await pg.goto(B); await LOGIN(pg);
  const ta = await pg.evaluate(async n => { const r = await api("/api/accounts/create", {body: {name: n + " " + (Date.now() % 1e6), capital: 1000000}});
    S.accounts = r.accounts; acctSetup(); acctSwitch(r.account.id); return r.account.id; }, label);
  await pg.waitForFunction(id => P.snap && ACCT === id, ta, { timeout: 10000 });
  // size by money at risk, so the lots show the stop distance changing (CRUDEOIL: 1 point = ₹100 a lot)
  await pg.evaluate(() => { P.ticketLoaded = false; return papi("ticket", {tp_r: 2, rr_lock: false, mode: "amt", risk_amt: 15000, product: "MARGIN"}); });
  await pg.evaluate(() => papi("trail", {be_on: false, sl_on: false, be_r: 1, sl_r: 1}));
  await pg.evaluate(c => openBySymbol(c), CRUDE);
  await pg.waitForFunction(c => last[c] && last[c].ltp && typeof dispLast === "function" && dispLast(), CRUDE, { timeout: 20000 });
  return ta;
}
const jump = (pg, p) => pg.evaluate(([s, p]) => fetch(`/_mock/price?s=${encodeURIComponent(s)}&p=${p}`, {method: "POST"}), [CRUDE, p]);
// move the price and wait for the plan worked out at about that price (the mock's walk carries on from the jump)
async function moveTo(pg, p){
  await jump(pg, p);
  await pg.waitForFunction(p => P.plan && Math.abs(P.plan.entry - p) <= 6 && !P.dragging, p, { timeout: 10000 }).catch(() => {});
  await pg.waitForTimeout(400);
}
const state = pg => pg.evaluate(() => ({entry: P.plan && P.plan.entry, sl: slNow(), tp: tpNow(), slAt: P.T.slAt, tpAt: P.T.tpAt,
  psl: P.plan && P.plan.sl, ptp: P.plan && P.plan.tp, lots: P.plan && P.plan.lots, risk: P.plan && P.plan.risk, rr: P.plan && P.plan.rr,
  lineSl: P.toolLines && P.toolLines.sl.options().price, lineTp: P.toolLines && P.toolLines.tp.options().price,
  err: P.pvErr, place: !!document.querySelector("#bPlace") && !document.querySelector("#bPlace").disabled}));

(async () => {
  br = await chromium.launch();

  // ================================================================ desktop: drags
  {
    const ctx = await br.newContext({ viewport: { width: 1500, height: 920 } });
    const pg = await ctx.newPage();
    const errs = []; pg.on("pageerror", e => errs.push(e.message));
    pg.on("console", m => { if(m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });
    pg.on("dialog", d => d.accept());
    const acct = await setup(pg, "Held levels");
    const base = Math.round(await pg.evaluate(c => last[c].ltp, CRUDE));
    await jump(pg, base);
    await pg.click("#cBuy");
    await pg.waitForFunction(() => P.plan && P.plan.lots > 0, null, { timeout: 10000 });
    await moveTo(pg, base);

    // not placed yet: SL and TP keep their distance from the entry (as before)
    let a = await state(pg);
    ok(a.slAt == null && a.tpAt == null, "a new tool: nothing placed yet");
    await moveTo(pg, base + 20);
    let b = await state(pg);
    ok(Math.abs((b.entry - b.psl) - (a.entry - a.psl)) <= 1 && b.psl - a.psl >= 14, `before placing, the stop follows the entry: ${a.psl} -> ${b.psl} (entry ${a.entry} -> ${b.entry})`);

    // drag the stop and the target to levels of my own
    const chartBox = await pg.$eval("#chart", e => { const r = e.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; });
    const X = chartBox.x + chartBox.w * 0.42;
    const yOf = price => pg.evaluate(p => series.priceToCoordinate(p), price);
    async function drag(fromPrice, toPrice, read){
      await pg.mouse.move(X, chartBox.y + await yOf(fromPrice)); await pg.mouse.down();
      for(let k = 1; k <= 8; k++) await pg.mouse.move(X, chartBox.y + await yOf(fromPrice + (toPrice - fromPrice) * k / 8));
      for(let k = 0; k < 3; k++) await pg.mouse.move(X, chartBox.y + await yOf(toPrice));
      const at = await pg.evaluate(read);
      await pg.mouse.up();
      await pg.waitForTimeout(300);
      return at;
    }
    const slSet = await drag(b.sl, base - 10, () => P.T.slAt);
    const tpSet = await drag((await state(pg)).tp, base + 90, () => P.T.tpAt);   // (the target moved with the R when the stop did)
    ok(slSet != null && Math.abs(slSet - (base - 10)) <= 3, `the stop dragged to ${slSet} (aimed at ${base - 10})`);
    ok(tpSet != null && Math.abs(tpSet - (base + 90)) <= 3, `the target dragged to ${tpSet} (aimed at ${base + 90})`);
    await moveTo(pg, base + 20);
    const c1 = await state(pg);
    await pg.screenshot({ path: SHOT + "held_01_placed.png" });

    // the market moves up 20, then down 15: the stop and target stay; the entry moves; the lots follow the distance
    await moveTo(pg, base + 40);
    const c2 = await state(pg);
    ok(c2.sl === slSet && c2.psl === slSet && c2.lineSl === slSet, `price up 20: the stop held at ${slSet} (tool ${c2.sl}, server ${c2.psl}, line ${c2.lineSl})`);
    ok(c2.tp === tpSet && c2.ptp === tpSet && c2.lineTp === tpSet, `...and the target held at ${tpSet} (tool ${c2.tp}, server ${c2.ptp}, line ${c2.lineTp})`);
    ok(c2.entry - c1.entry >= 12, `...while the entry followed the market: ${c1.entry} -> ${c2.entry}`);
    ok(c2.lots < c1.lots, `...and a wider stop sized smaller: ${c1.lots} lots at ${c1.entry - slSet} points -> ${c2.lots} lots at ${c2.entry - slSet} points`);
    ok(c2.risk <= 15000 && c1.risk <= 15000, `...each within ₹15,000 net at risk (₹${c1.risk}, ₹${c2.risk})`);
    await moveTo(pg, base + 5);
    const c3 = await state(pg);
    ok(c3.sl === slSet && c3.tp === tpSet && c3.lots > c2.lots, `price down to ${c3.entry}: still ${slSet} / ${tpSet}, ${c3.lots} lots`);
    await pg.screenshot({ path: SHOT + "held_02_moved.png" });

    // a minute of the mock's own ticks: nothing drifts
    await pg.waitForTimeout(6000);
    const c4 = await state(pg);
    ok(c4.sl === slSet && c4.tp === tpSet, `6 s of live ticks: still ${c4.sl} / ${c4.tp}`);

    // placing: the order carries exactly those prices
    await pg.click("#tool #tPlace");
    await pg.waitForFunction(() => P.snap.positions.length > 0, null, { timeout: 10000 }).catch(() => {});
    const pos = await pg.evaluate(() => P.snap.positions[0] || null);
    ok(pos && pos.sl === slSet && pos.tp === tpSet, `PLACE: the trade's stop ${pos && pos.sl} and target ${pos && pos.tp} are the ones I set`);
    ok(await pg.evaluate(() => !P.armed && P.T.slAt == null && P.T.tpAt == null), "the tool closes and forgets its levels");
    if(pos) await pg.evaluate(id => papi("close", {id}), pos.id);

    // the price goes past a held stop: PLACE is off, and it says so; moving the stop again clears it
    await moveTo(pg, base + 40);
    await pg.click("#cBuy");
    await pg.waitForFunction(() => P.plan && P.plan.lots > 0, null, { timeout: 10000 });
    await moveTo(pg, base + 40);
    const d0 = await state(pg);
    const slHi = await drag(d0.sl, base + 30, () => P.T.slAt);
    await moveTo(pg, base + 40);
    await jump(pg, base + 15);
    await pg.waitForFunction(() => /gone past your stop/.test(P.pvErr || ""), null, { timeout: 8000 }).catch(() => {});
    const d1 = await state(pg);
    const toolTxt = await pg.textContent("#tool");
    ok(/price has gone past your stop at/.test(d1.err || "") && !d1.place && /gone past your stop/.test(toolTxt), `price ${base + 15} under the held stop ${slHi}: "${d1.err}", PLACE off`);
    ok(d1.sl === slHi, `...the stop is still where I put it (${d1.sl})`);
    await pg.screenshot({ path: SHOT + "held_03_past.png" });
    await pg.fill("#tkSl", String(base)); await pg.press("#tkSl", "Enter");
    await pg.waitForFunction(() => P.plan && P.plan.lots > 0, null, { timeout: 8000 }).catch(() => {});
    const d2 = await state(pg);
    ok(d2.slAt === base && d2.psl === base && d2.place, `typing a new stop ${base} in the ticket: held, and PLACE is back`);
    await moveTo(pg, base + 30);
    ok((await state(pg)).sl === base, "the typed stop holds as the price moves");
    // closing the tool and opening it again: a fresh tool that follows the entry
    await pg.click("#cBuy");
    ok(await pg.evaluate(() => !P.armed && P.T.slAt == null), "BUY again closes the tool");
    await pg.click("#cBuy");
    await pg.waitForFunction(() => P.plan && P.plan.lots > 0, null, { timeout: 10000 });
    await moveTo(pg, base + 30);
    const e0 = await state(pg); await moveTo(pg, base + 45); const e1 = await state(pg);
    ok(e0.slAt == null && e1.sl - e0.sl >= 9, `a new tool follows the entry again: ${e0.sl} -> ${e1.sl}`);
    // switching side forgets the levels (they'd be on the wrong side)
    const f0 = await state(pg);
    await drag(f0.sl, f0.entry - 25, () => P.T.slAt);
    await pg.click("#cSell");
    ok(await pg.evaluate(() => P.armed && P.T.side === -1 && P.T.slAt == null && P.T.tpAt == null), "BUY -> SELL: a fresh tool on the other side");
    await pg.click("#cSell");

    // ---- the RR lock: the line moved last holds, the other keeps the RR
    await pg.evaluate(() => { if(!P.T.rr_lock) rrLockToggle(); });
    await pg.click("#cBuy");
    await pg.waitForFunction(() => P.plan && P.plan.lots > 0, null, { timeout: 10000 });
    await moveTo(pg, base + 40);
    const g0 = await state(pg);
    const lSl = await drag(g0.sl, base + 20, () => P.T.slAt);
    await moveTo(pg, base + 40); const g1 = await state(pg);
    await moveTo(pg, base + 55); const g2 = await state(pg);
    ok(g1.sl === lSl && g2.sl === lSl, `locked, the stop dragged to ${lSl}: held as the price moves (${g1.sl}, ${g2.sl})`);
    ok(g2.tp > g1.tp && g1.rr >= 1.95 && g1.rr < 2.3 && g2.rr >= 1.95 && g2.rr < 2.3, `...the target keeps the RR: ${g1.tp} (${g1.rr}R) -> ${g2.tp} (${g2.rr}R)`);
    const lTp = await drag(g2.tp, g2.tp - 10, () => P.T.tpAt);
    await pg.waitForFunction(t => P.plan && P.plan.lockTp === t, lTp, { timeout: 8000 }).catch(() => {});
    await moveTo(pg, base + 55); const h1 = await state(pg);
    await moveTo(pg, base + 50); await pg.waitForFunction(t => P.plan && P.plan.lockTp === t, lTp, { timeout: 8000 }).catch(() => {});
    const h2 = await state(pg);
    ok(h1.tp === lTp && h2.tp === lTp && h2.ptp === lTp, `locked, the target dragged to ${lTp}: held (${h1.tp}, ${h2.tp}; server ${h2.ptp})`);
    ok(h1.rr >= 1.95 && h1.rr < 2.3 && h2.rr >= 1.95 && h2.rr < 2.3 && h2.sl !== h1.sl, `...the stop keeps the RR: ${h1.sl} (${h1.rr}R) -> ${h2.sl} (${h2.rr}R)`);
    // unlocking keeps both where they are
    await pg.click("#cLock");
    await moveTo(pg, base + 45); const k1 = await state(pg);
    ok(k1.sl === h2.sl && k1.tp === lTp, `unlocking: the stop (${k1.sl}) and target (${k1.tp}) stay put`);
    await pg.click("#cBuy");
    await pg.evaluate(() => { if(P.T.rr_lock) rrLockToggle(); });

    ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
    await pg.evaluate(id => api("/api/accounts/update", {body: {id, archived: true}}).catch(() => {}), acct);
    await ctx.close();
  }

  // ================================================================ iPad: the desktop page by touch, typed prices
  {
    const ctx = await br.newContext({ ...devices["iPad Pro 11 landscape"] });
    const pg = await ctx.newPage();
    const errs = []; pg.on("pageerror", e => errs.push(e.message));
    pg.on("dialog", d => d.accept());
    const acct = await setup(pg, "Held iPad");
    ok(!(await pg.evaluate(() => document.body.classList.contains("mob"))), "iPad landscape: the desktop page");
    const base = Math.round(await pg.evaluate(c => last[c].ltp, CRUDE));
    await jump(pg, base);
    await pg.tap("#cBuy");
    await pg.waitForFunction(() => P.plan && P.plan.lots > 0, null, { timeout: 10000 });
    await moveTo(pg, base);
    if(!(await pg.isVisible("#tkSl"))) await pg.evaluate(() => typeof setPanel === "function" && setPanel(true)).catch(() => {});
    await pg.evaluate(([s, t]) => { const a = document.querySelector("#tkSl"), b = document.querySelector("#tkTp");
      a.value = s; a.dispatchEvent(new Event("change")); b.value = t; b.dispatchEvent(new Event("change")); }, [base - 12, base + 60]);
    await moveTo(pg, base + 25);
    const s = await state(pg);
    ok(s.sl === base - 12 && s.tp === base + 60 && s.psl === base - 12, `iPad: typed stop ${base - 12} and target ${base + 60} held with the price up 25 (${s.sl} / ${s.tp})`);
    await pg.screenshot({ path: SHOT + "held_04_ipad.png" });
    await pg.tap("#cBuy");
    ok(!errs.length, "iPad: no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
    await pg.evaluate(id => api("/api/accounts/update", {body: {id, archived: true}}).catch(() => {}), acct);
    await ctx.close();
  }

  // ================================================================ phone: the order sheet's - / +
  {
    const ctx = await br.newContext({ ...devices["Pixel 7"] });
    const pg = await ctx.newPage();
    const errs = []; pg.on("pageerror", e => errs.push(e.message));
    pg.on("dialog", d => d.accept());
    const acct = await setup(pg, "Held phone");
    ok(await pg.evaluate(() => document.body.classList.contains("mob")), "Pixel 7: the phone layout");
    const base = Math.round(await pg.evaluate(c => last[c].ltp, CRUDE));
    await jump(pg, base);
    await pg.tap("#mBuy"); await pg.waitForTimeout(1200);
    await pg.waitForFunction(() => P.plan && P.plan.lots > 0, null, { timeout: 10000 });
    await moveTo(pg, base);
    const p0 = await state(pg);
    await pg.click('[data-st="mtSl"][data-d="-1"]'); await pg.waitForTimeout(150); await pg.click('[data-st="mtSl"][data-d="-1"]'); await pg.waitForTimeout(900);
    const set = await pg.evaluate(() => P.T.slAt);
    ok(set != null && Math.abs(set - (p0.sl - 2)) <= 3, `phone: the stop stepped down 2 ticks to ${set} is held`);
    await moveTo(pg, base + 20);
    const p1 = await state(pg);
    ok(p1.sl === set && p1.psl === set && +(await pg.inputValue("#mtSl")) === set, `phone: price up 20, the stop stays ${set} (sheet ${await pg.inputValue("#mtSl")})`);
    ok(p1.lots < p0.lots || p0.lots === 1, `phone: the lots follow the wider stop: ${p0.lots} -> ${p1.lots}`);
    await pg.screenshot({ path: SHOT + "held_05_phone.png" });
    ok(!errs.length, "phone: no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
    await pg.evaluate(() => disarm());
    await pg.evaluate(id => api("/api/accounts/update", {body: {id, archived: true}}).catch(() => {}), acct);
    await ctx.close();
  }
  await br.close();
})().catch(async e => { ok(false, "exception " + (e.stack || e)); if(br) await br.close(); process.exit(1); });
