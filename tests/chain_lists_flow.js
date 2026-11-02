// Option chain and watchlist handling (owner, 2 Nov 2026; v0.30.0), in a browser, desktop and phone:
// - the chain's header (underlying, expiry, ATM) stays at the top while the strikes scroll; it opens at the strike nearest
//   the price only when an underlying / expiry is opened, never on its own afterwards; ATM goes back there;
// - ＋ beside each CE / PE opens the list picker (ticks per list), ★ once it's in a list; right-click still adds to the
//   list on screen;
// - a watchlist row's ⋯ / right-click opens the picker with Move and Remove; on the phone a swipe left shows Lists · Remove.
// Needs the mock server and an admin with 2FA (run security_flow.js first).
const { chromium, devices } = require("playwright");
const LOGIN = require("./login.js");
const fs = require("fs");
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const NOV = "MCX:CRUDEOIL26NOVFUT";
let br;

// where an element sits inside a scroll box: true when it's fully in view
const inView = (pg, sel, boxSel) => pg.evaluate(([s, b]) => {
  const e = document.querySelector(s), x = document.querySelector(b); if(!e || !x) return false;
  const r = e.getBoundingClientRect(), R = x.getBoundingClientRect();
  return r.top >= R.top - 1 && r.bottom <= R.bottom + 1 && r.height > 0;
}, [sel, boxSel]);
// the header in view in the window (not scrolled away)
const headIn = pg => pg.evaluate(() => {
  const h = document.querySelector("#chainHead"), r = h.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + 10, r.top + r.height / 2);
  return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && !!hit && h.contains(hit);
});

(async () => {
  br = await chromium.launch();
  // a short window, so the fake NIFTY chain (12 strikes) is longer than the space for it and really scrolls
  const ctx = await br.newContext({ viewport: { width: 1400, height: 420 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.waitForFunction(() => typeof wlLoad === "function" && P.snap, null, { timeout: 20000 });
  // two lists: Watchlist (the December... no: the November future) on screen, MCX empty
  await pg.evaluate(async nov => {
    const row = (await api("/api/symbol?s=" + encodeURIComponent(nov))).row;
    await api("/api/prefs", {body: {wlists: [{id: "w1", name: "Watchlist", items: [row]}, {id: "w2", name: "MCX", items: []}], wl: "w1", watch: [row]}});
  }, NOV);
  await pg.reload(); await pg.waitForSelector("#wlSel", { timeout: 20000 });
  await pg.waitForFunction(() => P.snap, null, { timeout: 20000 });

  // ---------------------------------------------------------------- the chain's header
  await pg.click('aside .tabs button[data-tab="chain"]');
  await pg.fill("#cU", "NIFTY"); await pg.press("#cU", "Enter");
  await pg.waitForSelector("#chainBox table.chain tbody tr", { timeout: 15000 });
  const head = await pg.evaluate(() => ({h: document.querySelector("#chainHead").offsetHeight, rows: document.querySelectorAll("#chainBox tbody tr").length,
    oneRow: (() => { const a = document.querySelector("#cU").getBoundingClientRect(), b = document.querySelector("#cExp").getBoundingClientRect(); return Math.abs(a.top - b.top) < 6; })()}));
  ok(head.h <= 50 && head.oneRow, `the header is one slim row: underlying, expiry and ATM side by side (${head.h}px high; was two labelled fields, ~120px)`);
  ok(head.rows >= 10, `NIFTY's chain is drawn (${head.rows} strikes)`);
  const over = await pg.evaluate(() => { const b = document.querySelector("#chainBox"); return b.scrollHeight - b.clientHeight; });
  ok(over > 60, `(the strikes are taller than their space: ${over}px to scroll)`);
  // the nearest strike: the index price arrives over the feed (streamed while the chain is open)
  await pg.waitForFunction(() => document.querySelector("#chainBox tr.atm"), null, { timeout: 15000 });
  await pg.waitForTimeout(600);
  ok(await inView(pg, "#chainBox tr.atm", "#chainBox"), "it opens at the strike nearest the price (in view, inside the strikes' own scroll)");
  ok(await headIn(pg), "…and the header is still at the top, not scrolled away");
  const pane = await pg.evaluate(() => document.querySelector("#tChain").scrollTop);
  ok(pane === 0, "only the strikes scroll: the Options pane itself never moves");
  await pg.screenshot({ path: SHOT + "chain_desktop.png" });

  // you scroll; nothing pulls the chain back to the price afterwards
  await pg.evaluate(() => { document.querySelector("#chainBox").scrollTop = 0; });
  const bx = await pg.evaluate(() => { const r = document.querySelector("#chainBox").getBoundingClientRect(); return {x: r.left + 40, y: r.top + r.height / 2}; });
  await pg.mouse.move(bx.x, bx.y); await pg.mouse.wheel(0, 50); await pg.waitForTimeout(700);   // (the wheel scrolls smoothly)
  const s0 = await pg.evaluate(() => document.querySelector("#chainBox").scrollTop);
  await pg.waitForTimeout(4000);                                // several price ticks
  const s1 = await pg.evaluate(() => document.querySelector("#chainBox").scrollTop);
  ok(s0 > 0 && s0 === s1 && await headIn(pg), `after you scroll, the chain stays where you put it while prices tick (${s0} -> ${s1}) and the header stays`);
  const atmMoves = await pg.evaluate(() => { const k = chainAtm; const far = k === chainKs[0] ? chainKs[chainKs.length - 1] : chainKs[0]; last[chainRef] = {...last[chainRef], ltp: far + 1}; chainTick({s: chainRef}); const a = document.querySelector("#chainBox tr.atm").dataset.k; return {from: k, to: +a, top: document.querySelector("#chainBox").scrollTop}; });
  ok(atmMoves.to !== atmMoves.from && atmMoves.top === s1, `the highlight follows the price (${atmMoves.from} -> ${atmMoves.to}) without scrolling`);
  // the expiry can be changed from anywhere in the chain
  const exps = await pg.evaluate(() => [...document.querySelectorAll("#cExp option")].map(o => o.value));
  ok(exps.length >= 2, `expiries offered (${exps.length})`);
  await pg.evaluate(() => { document.querySelector("#chainBox").scrollTop = document.querySelector("#chainBox").scrollHeight; });
  ok(await headIn(pg), "scrolled to the last strike: the expiry is still right there");
  await pg.selectOption("#cExp", exps[1]); await pg.waitForTimeout(1500);
  const ex2 = await pg.evaluate(() => ({v: document.querySelector("#cExp").value, atm: !!document.querySelector("#chainBox tr.atm")}));
  ok(ex2.v === exps[1] && ex2.atm && await inView(pg, "#chainBox tr.atm", "#chainBox") && await headIn(pg), "another expiry opens at the strike nearest the price, header in place");
  await pg.evaluate(() => { document.querySelector("#chainBox").scrollTop = 0; });
  await pg.click("#cAtm"); await pg.waitForTimeout(200);
  ok(await inView(pg, "#chainBox tr.atm", "#chainBox"), "ATM goes back to the strike nearest the price");

  // ---------------------------------------------------------------- ＋ beside CE / PE
  const ce = await pg.evaluate(() => { const b = document.querySelector("#chainBox tr.atm td.c .wa"); return b.dataset.s; });
  ok(await pg.evaluate(s => { const b = document.querySelector(`#chainBox .wa[data-s="${s}"]`); return b.textContent === "＋" && b.closest("td").textContent.includes("CE"); }, ce), "＋ beside each CE (and PE)");
  await pg.click(`#chainBox .wa[data-s="${ce}"]`); await pg.waitForSelector("#wlPop");
  let pop = await pg.evaluate(() => ({lists: [...document.querySelectorAll("#wlPop .tg")].map(b => b.textContent), move: document.querySelectorAll("#wlPop .mv").length, rm: !!document.querySelector('#wlPop [data-a="rm"]')}));
  ok(pop.lists.length === 2 && /Watchlist \(1\)/.test(pop.lists[0]) && /MCX \(0\)/.test(pop.lists[1]) && !pop.move && !pop.rm, `＋ opens the picker: every list, nothing ticked yet (${pop.lists.join(", ")})`);
  await pg.screenshot({ path: SHOT + "chain_pick.png" });
  await pg.click('#wlPop .tg[data-l="w2"]'); await pg.waitForTimeout(300);
  let st = await pg.evaluate(s => ({tick: document.querySelector('#wlPop .tg[data-l="w2"]').classList.contains("on"), mcx: WL.find(l => l.id === "w2").items.map(w => w.s), star: document.querySelector(`#chainBox .wa[data-s="${s}"]`).textContent, toast: [...document.querySelectorAll(".toast")].map(t => t.textContent).join(" | ")}), ce);
  ok(st.tick && st.mcx.includes(ce) && st.star === "★" && /to MCX/.test(st.toast), `a tap on MCX adds it there: ticked, ★ on the chain ("${st.toast}")`);
  await pg.keyboard.press("Escape");
  ok(!(await pg.$("#wlPop")), "Esc closes the picker");
  // right-click still adds to the list on screen (Watchlist)
  const pe = await pg.evaluate(() => [...document.querySelectorAll("#chainBox tr.atm td.c .wa")][1].dataset.s);
  await pg.click(`#chainBox .wa[data-s="${pe}"] >> xpath=..`, { button: "right", position: { x: 20, y: 8 } }); await pg.waitForTimeout(300);
  ok(await pg.evaluate(s => watch.some(w => w.s === s) && document.querySelector(`#chainBox .wa[data-s="${s}"]`).textContent === "★", pe), "right-click on a PE still adds it to the list on screen");

  // ---------------------------------------------------------------- change a contract's list from its row
  await pg.click('aside .tabs button[data-tab="watch"]'); await pg.selectOption("#wlSel", "w2"); await pg.waitForTimeout(300);
  const rowSel = `#watchList .wrow .row:has([data-px="${ce}"])`;
  await pg.hover(rowSel); await pg.click(`${rowSel} .x.m`); await pg.waitForSelector("#wlPop");
  pop = await pg.evaluate(() => ({move: [...document.querySelectorAll("#wlPop .mv")].map(b => b.dataset.m), rm: document.querySelector('#wlPop [data-a="rm"]')?.textContent}));
  ok(pop.move.join() === "w1" && /Remove from MCX/.test(pop.rm || ""), `⋯ on a row: Move (to Watchlist) and Remove from MCX`);
  await pg.screenshot({ path: SHOT + "row_pick.png" });
  await pg.click('#wlPop .mv[data-m="w1"]'); await pg.waitForTimeout(400);
  st = await pg.evaluate(s => ({mcx: WL.find(l => l.id === "w2").items.length, wl: watch.length, inW1: WL.find(l => l.id === "w1").items.some(w => w.s === s), pop: !!document.querySelector("#wlPop"), rows: document.querySelectorAll("#watchList .wrow").length, toast: [...document.querySelectorAll(".toast")].map(t => t.textContent).pop()}), ce);
  ok(st.mcx === 0 && st.wl === 0 && st.inW1 && !st.pop && st.rows === 0 && /Moved .* to Watchlist/.test(st.toast), `Move takes it out of MCX and into Watchlist in one tap ("${st.toast}")`);
  // right-click on a row; ticks to keep it in two lists; Remove
  await pg.selectOption("#wlSel", "w1"); await pg.waitForTimeout(300);
  await pg.click(rowSel, { button: "right" }); await pg.waitForSelector("#wlPop");
  await pg.click('#wlPop .tg[data-l="w2"]'); await pg.waitForTimeout(300);
  st = await pg.evaluate(s => ({both: WL.every(l => (l.id === wlId ? watch : l.items).some(w => w.s === s)), rows: document.querySelectorAll("#watchList .wrow").length}), ce);
  ok(st.both, "right-click opens it too; a tick keeps the contract in both lists");
  await pg.click('#wlPop [data-a="rm"]'); await pg.waitForTimeout(300);
  st = await pg.evaluate(s => ({w1: watch.some(w => w.s === s), w2: WL.find(l => l.id === "w2").items.some(w => w.s === s)}), ce);
  ok(!st.w1 && st.w2, "Remove takes it out of the list on screen only");
  // saved on the server
  await pg.waitForTimeout(1200); await pg.reload(); await pg.waitForSelector("#wlSel", { timeout: 20000 }); await pg.waitForTimeout(500);
  st = await pg.evaluate(([ce, pe]) => ({w1: WL.find(l => l.id === "w1").items.map(w => w.s), w2: WL.find(l => l.id === "w2").items.map(w => w.s)}), [ce, pe]);
  ok(st.w2.includes(ce) && st.w1.includes(pe) && !st.w1.includes(ce), "after a reload the lists are as left (saved on the server)");

  // ---------------------------------------------------------------- the phone
  const ph = await (await br.newContext({ ...devices["Pixel 7"], viewport: { width: 412, height: 560 } })).newPage();   // shorter, so the 12 strikes scroll
  ph.on("pageerror", e => errs.push("phone: " + e.message));
  await ph.goto("http://localhost:8766/"); await LOGIN(ph);
  await ph.waitForFunction(() => typeof M !== "undefined" && M.on && P.snap, null, { timeout: 20000 });
  await ph.click('#mNav [data-ms="quotes"]'); await ph.waitForTimeout(300);
  await ph.click('#ms_quotes .tabs button[data-tab="chain"]');
  await ph.fill("#cU", "NIFTY"); await ph.press("#cU", "Enter");
  await ph.waitForSelector("#chainBox tr.atm", { timeout: 15000 }); await ph.waitForTimeout(500);
  const pover = await ph.evaluate(() => { const b = document.querySelector("#chainBox"); return b.scrollHeight - b.clientHeight; });
  ok(pover > 60, `phone: (the strikes are taller than their space: ${pover}px to scroll)`);
  ok(await inView(ph, "#chainBox tr.atm", "#chainBox") && await headIn(ph), "phone: opens at the nearest strike with the header at the top");
  await ph.evaluate(() => { document.querySelector("#chainBox").scrollTop = 0; });
  ok(await headIn(ph), "phone: scrolled to the top strikes, the header is still there");
  await ph.evaluate(() => { document.querySelector("#chainBox").scrollTop = 99999; });
  ok(await headIn(ph) && await ph.evaluate(() => document.querySelector("#ms_quotes").scrollTop === 0), "phone: at the bottom strikes too (the Quotes screen itself doesn't scroll)");
  await ph.screenshot({ path: SHOT + "chain_phone.png" });
  await ph.click("#cAtm"); await ph.waitForTimeout(200);
  const pce = await ph.evaluate(() => document.querySelector("#chainBox tr.atm td.c .wa").dataset.s);
  await ph.tap(`#chainBox .wa[data-s="${pce}"]`); await ph.waitForSelector("#wlPop");
  const sheet = await ph.evaluate(() => { const r = document.querySelector("#wlPop").getBoundingClientRect(); return {bottom: Math.round(r.bottom), H: innerHeight, w: Math.round(r.width), W: innerWidth}; });
  ok(Math.abs(sheet.bottom - sheet.H) <= 2 && sheet.w >= sheet.W - 2, `phone: ＋ opens the picker as a sheet at the bottom (${sheet.w}×… at ${sheet.bottom}/${sheet.H})`);
  await ph.screenshot({ path: SHOT + "chain_phone_pick.png" });
  await ph.tap('#wlPop .tg[data-l="w1"]'); await ph.waitForTimeout(300);
  await ph.tap("#wlPopBg", { position: { x: 50, y: 50 } }); await ph.waitForTimeout(200);
  ok(!(await ph.$("#wlPop")) && await ph.evaluate(s => watch.some(w => w.s === s), pce), "phone: added to Watchlist; a tap outside closes the sheet");
  // the swipe on a watchlist row
  await ph.tap('#ms_quotes .tabs button[data-tab="watch"]'); await ph.waitForTimeout(300);
  const prow = `#watchList .wrow:has([data-px="${pce}"])`;
  ok(await ph.evaluate(sel => { const r = document.querySelector(sel + " .row"); const m = r.querySelector(".x.m"), x = r.querySelector(".x:not(.m)"); return getComputedStyle(m).opacity === "1" && getComputedStyle(x).display === "none"; }, prow), "phone: each row shows ⋯ (the × moved into the swipe and the picker)");
  const swipe = (sel, dx) => ph.evaluate(([sel, dx]) => {
    const el = document.querySelector(sel + " .row"), r = el.getBoundingClientRect(), y = r.top + r.height / 2, x0 = r.right - 30;
    const T = x => [new Touch({identifier: 1, target: el, clientX: x, clientY: y})];
    el.dispatchEvent(new TouchEvent("touchstart", {touches: T(x0), changedTouches: T(x0), bubbles: true}));
    for(let i = 1; i <= 8; i++) el.dispatchEvent(new TouchEvent("touchmove", {touches: T(x0 + dx * i / 8), changedTouches: T(x0 + dx * i / 8), bubbles: true}));
    el.dispatchEvent(new TouchEvent("touchend", {touches: [], changedTouches: T(x0 + dx), bubbles: true}));
  }, [sel, dx]);
  await swipe(prow, -170); await ph.waitForTimeout(300);
  st = await ph.evaluate(sel => { const w = document.querySelector(sel); const b = w.querySelector(".swa .sl").getBoundingClientRect(); return {open: w.classList.contains("open"), vis: b.width > 0 && document.elementFromPoint(b.left + 5, b.top + 5) === w.querySelector(".swa .sl")}; }, prow);
  ok(st.open && st.vis, "phone: a swipe left shows Lists · Remove");
  await ph.screenshot({ path: SHOT + "row_swipe_phone.png" });
  const ms0 = await ph.evaluate(() => document.body.dataset.ms);
  await ph.tap(`${prow} .row .name`); await ph.waitForTimeout(400);
  st = await ph.evaluate(sel => ({open: document.querySelector(sel).classList.contains("open"), ms: document.body.dataset.ms}), prow);
  ok(!st.open && st.ms === ms0, "phone: a tap on the swiped row closes it (no chart opened by mistake)");
  await swipe(prow, 60); await ph.waitForTimeout(200);
  ok(await ph.evaluate(sel => !document.querySelector(sel).classList.contains("open"), prow), "phone: a swipe right doesn't open it");
  await swipe(prow, -170); await ph.waitForTimeout(300);
  await ph.tap(`${prow} .swa .sl`); await ph.waitForSelector("#wlPop");
  ok(await ph.evaluate(() => [...document.querySelectorAll("#wlPop .mv")].length >= 0 && /Remove from Watchlist/.test(document.querySelector('#wlPop [data-a="rm"]').textContent)), "phone: Lists opens the picker for that row (Move / Remove)");
  await ph.tap('#wlPop [data-a="x"]'); await ph.waitForTimeout(200);
  await swipe(prow, -170); await ph.waitForTimeout(300);
  await ph.tap(`${prow} .swa .sr`); await ph.waitForTimeout(400);
  ok(await ph.evaluate(s => !watch.some(w => w.s === s) && !document.querySelector(`#watchList [data-px="${s}"]`), pce), "phone: Remove takes it off the list");
  // a vertical drag still scrolls (no swipe)
  await swipe(`#watchList .wrow`, -5); await ph.waitForTimeout(100);
  ok(await ph.evaluate(() => !document.querySelector("#watchList .wrow.open")), "phone: a small move doesn't open the actions");

  // tidy up: one list again, as the other browser tests expect
  await pg.evaluate(async () => { await api("/api/prefs", {body: {wlists: null, wl: null, watch: []}}); });
  ok(errs.length === 0, "no script errors" + (errs.length ? ": " + errs.slice(0, 4).join(" / ") : ""));
  await br.close();
})().catch(async e => { ok(false, e.message.split("\n")[0]); if(br) await br.close(); });
