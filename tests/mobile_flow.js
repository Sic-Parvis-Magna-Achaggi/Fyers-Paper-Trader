// The phone layout (web/mobile.js) on an emulated Pixel 7: tabs, a full-height chart, the one-tap SELL / BUY bar,
// the order sheet (driving the same ticket as desktop), the order shrunk to a bubble, placing a trade, the position sheet (SL / TP steppers and
// save, BE-T, close), a pending order (modify, cancel), Trade / History / More, the account sheet, full screen,
// landscape, the LIVE badge and KILL, and the switch to the desktop layout and back.
// Needs the mock server and an admin with 2FA (run security_flow.js first). Resets the admin's paper account.
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
  const ctx = await br.newContext({ ...devices["Pixel 7"] });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  const vis = s => pg.isVisible(s);
  const tap = async (s, wait = 400) => { await pg.click(s); await pg.waitForTimeout(wait); };
  const snap = () => pg.evaluate(() => P.snap);
  await pg.goto("http://localhost:8766/");
  await pg.waitForSelector("#vLogin:not(.hide), #app:not(.hide)");
  ok(await pg.evaluate(() => document.body.classList.contains("mob")) && !(await vis("#mNav")), "login screen: phone mode, but the tabs stay hidden until logged in");
  await LOGIN(pg);
  await pg.waitForFunction(() => P.snap, null, { timeout: 15000 });
  // a big paper balance, so a full crude lot fits the margin and risk rules; 1 lot, Carry (the fake clock may be past MCX intraday)
  await pg.evaluate(async () => {
    if(P.snap.mode === "live") throw new Error("the admin's account is Live - run live_flow.js to the end first");
    await papi("reset", {confirm: "RESET", capital: 1000000});
    await papi("trail", {be_on: false, sl_on: false});
    Object.assign(P.T, {mode: "lots", lots: 1, product: "MARGIN", slDist: null}); saveTicketDefaults();
    prefSet("sl_dist", {}); prefSet("mobTicket", "full");     // remembered stop distances: the steppers and the drag below widen them each run
    localStorage.removeItem("ftm.layout");
  });

  // ---- shell
  ok(await vis("#mTop") && await vis("#mNav") && await vis("#mBar"), "phone layout: top bar, SELL / BUY bar and five tabs");
  ok(!(await vis("#app > header")) && !(await vis("#panel")), "the desktop header and trade panel are hidden");
  await pg.evaluate(async c => { await openBySymbol(c); }, CRUDE);
  await pg.waitForFunction(() => DISP.length > 20 && cur && last[cur.s], null, { timeout: 20000 });
  await pg.waitForTimeout(800);
  const geo = await pg.evaluate(() => { const r = document.querySelector("#chart").getBoundingClientRect(); return {h: r.height, w: r.width, vh: innerHeight, vw: innerWidth}; });
  ok(geo.h > geo.vh * 0.6 && geo.w === geo.vw, `the chart fills the screen between the bars (${Math.round(geo.h)} of ${geo.vh}px high, full width)`);
  ok((await pg.textContent("#mSym b")).includes("CRUDEOIL26NOVFUT") && /\d/.test(await pg.textContent("#mBuy b")) && /\d/.test(await pg.textContent("#mSell b")),
     `top bar shows the contract; SELL ${await pg.textContent("#mSell b")} / BUY ${await pg.textContent("#mBuy b")} show bid and ask`);
  await pg.screenshot({ path: SHOT + "mob_chart.png" });

  // ---- order sheet
  await tap("#mBuy", 1500);
  ok(await pg.evaluate(() => M.sheet === "ticket" && P.armed && P.T.side === 1), "BUY opens the order sheet with a long set up");
  await tap('#mTk [data-side="-1"]', 600);
  ok(await pg.evaluate(() => P.armed && P.T.side === -1), "SELL in the sheet flips it to a short (stays set up)");
  await tap('#mTk [data-side="1"]', 1200);
  // (the stop follows the market with the entry, so its distance from the entry is what the steppers change)
  const d0 = await pg.evaluate(() => P.T.slDist);
  await pg.click('[data-st="mtSl"][data-d="-1"]'); await pg.waitForTimeout(150); await pg.click('[data-st="mtSl"][data-d="-1"]'); await pg.waitForTimeout(900);
  const s1 = await pg.evaluate(() => ({d: P.T.slDist, sl: slNow(), inp: +document.querySelector("#mtSl").value, desk: +document.querySelector("#tkSl").value}));
  ok(Math.abs(s1.d - d0 - 2) < 1e-9 && s1.inp === s1.desk && Math.abs(s1.inp - s1.sl) <= 3, `SL − twice widens the stop 2 ticks (${d0} → ${s1.d} points from the entry); the desktop ticket and the chart line agree`);
  await tap('#mTk [data-g="mode"] button[data-v="lots"]', 400);
  await pg.click('[data-st="mtSize"][data-d="1"]'); await pg.waitForTimeout(1500);
  ok(await pg.evaluate(() => P.T.lots === 2) && /BUY 2 lots/.test(await pg.textContent("#mtPlace")), `Lots + makes it 2 lots ("${await pg.textContent("#mtPlace")}")`);
  await pg.click('[data-st="mtSize"][data-d="-1"]');
  await tap('#mTk [data-g="prod"] button[data-v="MARGIN"]', 1800);
  const pv = await pg.evaluate(() => ({txt: document.querySelector("#mtPv").textContent, dis: document.querySelector("#mtPlace").disabled, lbl: document.querySelector("#mtPlace").textContent}));
  ok(/At stop \(net\)/.test(pv.txt) && /BE \+ costs/.test(pv.txt) && !pv.dis, `preview shows the net ₹ at stop and target, BE + costs; PLACE ready ("${pv.lbl}")`);
  await pg.screenshot({ path: SHOT + "mob_ticket.png" });
  // ---- the order shrunk to a bubble (owner, 1 Nov: "minimise it to a bubble so I can see the full chart")
  await tap("#mTk [data-min]", 400);
  const bub = await pg.evaluate(() => {
    const c = document.querySelector("#chart").getBoundingClientRect(), b = document.querySelector("#mBub").getBoundingClientRect();
    return {min: M.min, armed: P.armed, chartBottom: c.bottom, bubTop: b.top, bubH: b.height, l1: document.querySelector("#mBub .l1").textContent,
      l2: document.querySelector("#mBub .l2").textContent, place: document.querySelector("#mBub .bp").disabled, label: document.querySelector("#mtPlace").textContent};
  });
  ok(bub.min && bub.armed && !(await vis("#mtSl")) && !(await vis("#mBar")) && await vis("#mBub"), "⌄ shrinks the order sheet to the bubble; the trade stays set up");
  ok(bub.bubTop >= bub.chartBottom - 1, `the bubble sits in the SELL / BUY bar's place: nothing covers the chart (chart ends ${Math.round(bub.chartBottom)}px, bubble starts ${Math.round(bub.bubTop)}px)`);
  ok(/BUY 1 lot · market · Carry/.test(bub.l1) && /SL −₹[\d,]+ · TP ₹[\d,]+ · [\d.]+R/.test(bub.l2) && !bub.place, `the bubble shows the trade and the net ₹ ("${bub.l1}" / "${bub.l2}"), PLACE ready`);
  await pg.screenshot({ path: SHOT + "mob_bubble.png" });
  // drag the SL line on the chart: the bubble's ₹ at the stop follows
  const dr = await pg.evaluate(() => { const r = document.querySelector("#chart").getBoundingClientRect(); return {x: r.left + r.width * 0.45, y: r.top + series.priceToCoordinate(slNow()), sl: slNow(), risk: P.plan.risk}; });
  await pg.mouse.move(dr.x, dr.y); await pg.mouse.down(); await pg.mouse.move(dr.x, dr.y + 20, {steps: 5}); await pg.mouse.up(); await pg.waitForTimeout(1500);
  const da = await pg.evaluate(() => ({sl: slNow(), risk: P.plan.risk, l2: document.querySelector("#mBub .l2").textContent, sheetSl: +document.querySelector("#mtSl").value}));
  ok(da.sl < dr.sl && da.risk > dr.risk && da.l2.includes("₹" + Math.round(da.risk).toLocaleString("en-IN")) && Math.abs(da.sheetSl - da.sl) <= 3,
     `dragging the SL line down (${dr.sl} → ${da.sl}) updates the bubble (risk ₹${dr.risk} → ₹${da.risk}: "${da.l2}") and the sheet behind it (${da.sheetSl})`);
  await tap("#mBub .bi", 400);
  ok(await pg.evaluate(() => !M.min && P.armed) && await vis("#mtSl") && !(await vis("#mBub")), "tapping the bubble brings the full order sheet back");
  ok((await pg.textContent("#mtPlace")) === bub.label, "nothing about the trade changed on the way");
  await pg.tap("#chart", { position: { x: 120, y: 60 } }); await pg.waitForTimeout(400);
  ok(await pg.evaluate(() => M.min && P.armed) && await vis("#mBub"), "touching the chart shrinks the sheet to the bubble too");
  await tap("#mBub .bi", 400);
  await pg.dispatchEvent("#mTk .shead", "pointerdown", {clientY: 300, pointerId: 1, isPrimary: true});
  await pg.dispatchEvent("#mTk .shead", "pointermove", {clientY: 360, pointerId: 1, isPrimary: true});
  await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => M.min), "a swipe down on the sheet's header shrinks it as well");
  await tap("#mBub .bp", 2000);
  let sn = await snap();
  ok(sn.positions.length === 1 && sn.positions[0].side === 1 && sn.positions[0].lots === 1 && await pg.evaluate(() => M.sheet === null && !P.armed && !M.min),
     "PLACE in the bubble opens a 1-lot long; the bubble goes");
  ok(await vis("#mBar") && !(await vis("#mBub")) && !(await pg.evaluate(() => document.body.classList.contains("tkmin"))), "the SELL / BUY bar is back");
  ok(await vis("#mChips [data-id]") && /\d/.test(await pg.textContent("#mChips [data-id]")), `a chip for the position over the bar ("${(await pg.textContent("#mChips [data-id]")).trim()}")`);
  await pg.screenshot({ path: SHOT + "mob_position_chip.png" });

  // ---- position sheet
  await tap("#mChips [data-id]", 700);
  ok(await pg.evaluate(() => M.sheet === "pos") && /Net P&L/.test(await pg.textContent("#mSheet")), "the chip opens the position sheet (net P&L, R, BE + costs, charges paid)");
  const p0 = sn.positions[0];
  await pg.click('[data-st="mpSl"][data-d="1"]'); await pg.waitForTimeout(120); await pg.click('[data-st="mpSl"][data-d="1"]'); await pg.waitForTimeout(200);
  ok(!(await pg.isDisabled("#mpSave")), "moving the SL arms Save (nothing is sent yet)");
  await tap("#mpSave", 1200);
  sn = await snap();
  ok(sn.positions[0].sl === p0.sl + 2, `Save moves the stop at the server (${p0.sl} → ${sn.positions[0].sl})`);
  await pg.fill("#mpTp", String(Math.round(p0.avg + 40))); await pg.press("#mpTp", "Tab"); await tap("#mpSave", 1200);
  sn = await snap();
  ok(sn.positions[0].tp === Math.round(p0.avg + 40), `typing a target and Save sets it (${sn.positions[0].tp})`);
  await tap("#mpBe", 1000);
  sn = await snap();
  ok((sn.positions[0].tr || {}).be_on === true && (await pg.textContent("#mpBe")) === "ON", "BE-T switches on for this trade");
  await tap("#mpBe", 800);
  await pg.screenshot({ path: SHOT + "mob_position_sheet.png" });
  await tap("#mpClose", 300);
  ok((await pg.textContent("#mpClose")) === "Tap again to close" && (await snap()).positions.length === 1, "Close asks for a second tap (nothing closed yet)");
  await tap("#mpClose", 1500);
  ok((await snap()).positions.length === 0 && await pg.evaluate(() => M.sheet === null), "the second tap closes it at market; the sheet goes");

  // ---- a pending order
  await tap("#mBuy", 1200);
  await tap('#mTk [data-g="type"] button[data-v="limit"]', 1500);
  ok(await pg.evaluate(() => orderType() === "limit") && await vis("#mtPrice"), "Limit shows the price box with steppers");
  const lp = await pg.evaluate(() => P.T.price);
  await pg.click('[data-st="mtPrice"][data-d="-1"]'); await pg.waitForTimeout(1500);
  ok(await pg.evaluate(p => P.T.price === p - 1, lp), `price − moves the limit a tick (${lp} → ${lp - 1})`);
  await tap("#mtPlace", 1500);
  sn = await snap();
  ok(sn.orders.length === 1 && sn.orders[0].type === "limit", "a buy limit is pending");
  await tap('#mNav [data-ms="trade"]', 700);
  ok(await vis("#ms_trade") && /Balance/.test(await pg.textContent("#mtAcct")) && await vis("#ms_trade [data-oid]"), "Trade tab: account figures and the order card");
  ok((await pg.textContent("#mNb")) === "1", "the Trade tab shows a count of open trades and orders");
  await tap("#ms_trade [data-oid]", 600);
  const op = sn.orders[0].price;
  await pg.click('[data-st="moPx"][data-d="-1"]'); await pg.waitForTimeout(150);
  await tap("#moSave", 1200);
  ok((await snap()).orders[0].price === op - 1, `order sheet: price − and Save moves the order (${op} → ${op - 1})`);
  await tap("#moCancel", 1200);
  ok((await snap()).orders.length === 0 && await pg.evaluate(() => M.sheet === null), "Cancel order removes it");
  await tap("#mtBe", 900);
  ok((await snap()).trail.be_on === true, "trailing defaults for new trades: Trail BE on");
  await tap("#mtBe", 600);
  await pg.screenshot({ path: SHOT + "mob_trade.png" });

  // ---- history
  await tap('#mNav [data-ms="history"]', 1200);
  ok(await vis("#ms_history .mhist") && /Net P&L/.test(await pg.textContent("#ms_history")), "History tab: today's closed trade and the totals");
  await tap("#ms_history .mhist", 400);
  ok(/Total/.test(await pg.textContent("#ms_history .mhist .bd")) && /Net P&L/.test(await pg.textContent("#ms_history .mhist .bd")), "tapping a trade shows every charge and the net");
  await pg.screenshot({ path: SHOT + "mob_history.png" });

  // ---- quotes
  await tap('#mNav [data-ms="quotes"]', 500);
  ok(await vis("#ms_quotes aside"), "Quotes tab: the watchlist, Find and Options");
  await tap('aside .tabs button[data-tab="find"]', 200);
  await pg.fill("#q", "crude"); await pg.waitForTimeout(1200);
  ok(await vis("#results .row"), "Find lists contracts");
  await pg.screenshot({ path: SHOT + "mob_quotes.png" });
  await tap("#results .row", 1200);
  ok(await pg.evaluate(() => document.body.dataset.ms === "chart"), "tapping a contract opens its chart");

  // ---- more, account sheet, pages
  await tap('#mNav [data-ms="more"]', 500);
  ok(/Account, rules and charges/.test(await pg.textContent("#ms_more")), "More: account and rules, book, log, settings, theme, log out");
  await tap('#ms_more [data-pg="account"]', 800);
  ok(await vis("#pages") && await vis("#mBack") && await vis("#pg_account"), "Account page opens full screen with a Back button");
  await pg.screenshot({ path: SHOT + "mob_account.png" });
  await tap("#mBack", 400);
  ok(!(await vis("#pages")) && await vis("#ms_more"), "Back returns to More");
  await tap("#mAcct", 400);
  ok(await pg.evaluate(() => M.sheet === "acct") && await vis("#mSheet .mlist [data-id]"), "tapping the account name opens the account switcher");
  await tap("#mSheetBg", 300);
  await tap('#mNav [data-ms="chart"]', 400);
  await tap("#mSize", 400);
  await tap('#mSheet [data-g="mode"] button[data-v="pct"]', 300);
  ok(/%/.test(await pg.textContent("#mSize")), `the middle of the bar sets the default size ("${(await pg.textContent("#mSize")).trim()}")`);
  await tap('#mSheet [data-g="mode"] button[data-v="lots"]', 300);
  // SELL / BUY can open straight to the bubble (saved on the server like the other defaults)
  await tap('#mSheet [data-g="open"] button[data-v="bubble"]', 900);
  ok(await pg.evaluate(() => prefGet("mobTicket") === "bubble") && await pg.evaluate(async () => { const j = await api("/api/prefs"); return j.prefs.mobTicket === "bubble"; }),
     "the size sheet's \"SELL / BUY opens: A bubble\" is saved on the server");
  await tap("#mSheetBg", 300);
  await tap("#mSell", 1800);
  ok(await pg.evaluate(() => M.sheet === "ticket" && M.min && P.armed && P.T.side === -1) && await vis("#mBub") && /SELL/.test(await pg.textContent("#mBub .l1")),
     `with that set, SELL goes straight to the bubble ("${await pg.textContent("#mBub .l1")}" / "${await pg.textContent("#mBub .l2")}")`);
  await pg.setViewportSize({ width: 915, height: 412 }); await pg.waitForTimeout(700);
  const lb = await pg.evaluate(() => { const b = document.querySelector("#mBub .bw").getBoundingClientRect(), c = document.querySelector("#chart").getBoundingClientRect(); return {h: b.height, top: b.top, cb: c.bottom}; });
  ok(lb.h >= 30 && lb.top >= lb.cb - 1, `the bubble fits the slimmer bar on a phone on its side (${Math.round(lb.h)}px)`);
  await pg.screenshot({ path: SHOT + "mob_bubble_landscape.png" });
  await pg.setViewportSize({ width: 360, height: 780 }); await pg.waitForTimeout(700);
  const nb = await pg.evaluate(() => [...document.querySelectorAll("#mBub .bi > span")].map(e => ({full: e.scrollWidth <= e.clientWidth + 1, t: e.textContent})));
  ok(nb.every(x => x.full), `on a 360 px phone both lines fit (${nb.map(x => '"' + x.t + '"').join(" / ")})`);
  await pg.screenshot({ path: SHOT + "mob_bubble_360.png" });
  await pg.setViewportSize({ width: 412, height: 915 }); await pg.waitForTimeout(500);
  await tap("#mBub .bx", 500);
  ok(await pg.evaluate(() => !P.armed && M.sheet === null) && await vis("#mBar"), "✕ in the bubble cancels the trade");
  await tap("#mSize", 400);
  await tap('#mSheet [data-g="open"] button[data-v="full"]', 300);
  await tap("#mSheetBg", 300);

  // ---- full screen, landscape
  await tap("#bFull", 600);
  const fs1 = await pg.evaluate(() => ({fs: document.body.classList.contains("chartfs"), h: document.querySelector("#chart").getBoundingClientRect().height, vh: innerHeight}));
  ok(fs1.fs && !(await vis("#mTop")) && !(await vis("#mNav")) && await vis("#mBar") && fs1.h > fs1.vh * 0.8, `full screen: only the chart and the SELL / BUY bar (${Math.round(fs1.h)} of ${fs1.vh}px)`);
  await pg.screenshot({ path: SHOT + "mob_fullscreen.png" });
  await tap("#bFull", 400);
  ok(!(await pg.evaluate(() => document.body.classList.contains("chartfs"))) && await vis("#mNav"), "✕ leaves full screen");
  await pg.setViewportSize({ width: 915, height: 412 }); await pg.waitForTimeout(700);
  const ls = await pg.evaluate(() => ({mob: document.body.classList.contains("mob"), h: document.querySelector("#chart").getBoundingClientRect().height}));
  ok(ls.mob && ls.h > 200, `phone on its side: still the phone layout, slimmer bars, chart ${Math.round(ls.h)}px high`);
  await pg.screenshot({ path: SHOT + "mob_landscape.png" });
  await pg.setViewportSize({ width: 412, height: 915 }); await pg.waitForTimeout(500);

  // ---- live look (a live snapshot drawn on the page; the live engine itself is tested in live_test.py / live_flow.js)
  const lv = await pg.evaluate(async () => {
    const real = P.snap; paperUpdate({...real, mode: "live", live: {warnings: ["Test warning"], logged_in: true}});
    arm(1); M.tkKey = ""; mOpen("ticket", `<div id="mTk"></div>`, {cls: "ticket"}); mTicketFill();
    await new Promise(r => setTimeout(r, 1500));
    const v = {badge: !document.querySelector("#mLive").classList.contains("hide"), kill: !document.querySelector("#mKill").classList.contains("hide"),
      warn: document.querySelector("#mWarn").textContent, place: document.querySelector("#mtPlace").className, label: document.querySelector("#mtPlace").textContent};
    mMin(true); v.bub = document.querySelector("#mBub .bp").textContent; v.bubCls = document.querySelector("#mBub .bw").className;
    disarm(); mClose(); paperUpdate(real);
    v.after = document.querySelector("#mKill").classList.contains("hide");
    return v;
  });
  ok(lv.badge && lv.kill && /Test warning/.test(lv.warn), "a Live account: red LIVE badge, KILL in the top bar, live warnings under it");
  ok(/live/.test(lv.place) && /^LIVE/.test(lv.label) && lv.after, `PLACE says LIVE ("${lv.label}"); back to Paper, KILL goes`);
  ok(lv.bub === "LIVE · PLACE" && /live/.test(lv.bubCls), `the bubble's PLACE says LIVE too ("${lv.bub}")`);

  // ---- desktop layout and back
  await tap('#mNav [data-ms="more"]', 400);
  await tap('#ms_more [data-a="desk"]', 700);
  ok(!(await pg.evaluate(() => document.body.classList.contains("mob"))) && await vis("#app > header") && await pg.evaluate(() => document.querySelector("aside").parentElement.tagName === "MAIN"),
     "More → Desktop layout gives the desktop page (watchlist back in place)");
  await pg.evaluate(() => openDrawer()); await pg.waitForTimeout(300);
  await pg.click('#mLayout button[data-l=""]'); await pg.waitForTimeout(600);
  ok(await pg.evaluate(() => document.body.classList.contains("mob")) && await pg.evaluate(() => !!document.querySelector("#ms_quotes aside")), "Settings → Layout → Automatic switches the phone layout back on");
  await pg.evaluate(() => document.querySelector("#drawer").classList.remove("open"));

  // ---- a desktop browser never gets it
  const dpg = await (await br.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await dpg.goto("http://localhost:8766/");
  await dpg.waitForSelector("#vLogin:not(.hide), #app:not(.hide)");
  ok(!(await dpg.evaluate(() => document.body.classList.contains("mob"))), "a desktop-sized window keeps the desktop layout");

  await pg.evaluate(async () => { await papi("reset", {confirm: "RESET", capital: 25000}); Object.assign(P.T, {mode: "pct", product: "INTRADAY"}); saveTicketDefaults(); });
  await pg.waitForTimeout(700);
  ok(errs.length === 0, "no script errors" + (errs.length ? ": " + errs.slice(0, 4).join(" / ") : ""));
  await br.close();
})().catch(async e => { ok(false, e.message.split("\n")[0]); if(br) await br.close(); });
