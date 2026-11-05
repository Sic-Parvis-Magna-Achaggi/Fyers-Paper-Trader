// Browser test of Live (v0.33.0: the Live account is the Fyers account itself) on the fake Fyers (tests/mock_server.py
// fakes the order API too). Run after security_flow.js (the admin needs 2FA). The PAPER / LIVE switch at the top left
// (client ID + a fresh 2FA code; per login), the Live card with Fyers' funds, a trade from the app with its Fyers stop,
// a trade placed straight in Fyers (marked, NO STOP flag, Place my stop), a pending order placed in Fyers (shown,
// cancelled from the app), the phone's switch and sheet, the kill switch, Resume, back to Paper (one click) - while the
// server keeps managing the Live account (a close made in Fyers is still booked; writes from a Paper page refused).
const { chromium } = require("playwright");
const LOGIN = require("./login.js");
const B = "http://localhost:8766/";
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
require("fs").mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { require("fs").writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };   // written at once (a hung step still shows how far it got)
const CRUDE = "MCX:CRUDEOIL26NOVFUT", NIFTY = "NSE:NIFTY26NOVFUT";
const mock = (pg, path, body) => pg.evaluate(([p, b]) => fetch(p, b ? {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(b)} : {}).then(r => r.json()), [path, body]);
const asLive = (pg, path, body) => pg.evaluate(([p, b]) => fetch(p, {method: b ? "POST" : "GET", headers: {"X-Acct": "live", "Content-Type": "application/json"},
  body: b ? JSON.stringify(b) : undefined, credentials: "same-origin"}).then(async r => ({status: r.status, j: await r.json().catch(() => ({}))})), [path, body]);
const bg = (pg, sel) => pg.$eval(sel, el => getComputedStyle(el).backgroundColor);

let br;
(async () => {
  br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1500, height: 920 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  pg.on("console", m => { if(m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });
  pg.on("dialog", d => d.accept());
  await pg.goto(B); await LOGIN(pg);
  await pg.waitForSelector("#sideSw");
  if(await pg.evaluate(() => sideLive())) { await pg.evaluate(() => sideSet("paper")); await pg.waitForTimeout(800); }
  await pg.evaluate(() => { const a = acctList().find(x => x.name === "Main"); if(a) acctSwitch(a.id); });
  await pg.waitForTimeout(800);

  // ---- Paper side
  ok(await pg.isVisible("#sideSw") && await pg.$eval('#sideSw [data-s="paper"]', b => b.classList.contains("on")), "the admin sees PAPER / LIVE at the top left, on PAPER");
  ok(/rgb\(34, 160, 107\)|rgb\(17, 132, 82\)/.test(await bg(pg, '#sideSw [data-s="paper"]')), "PAPER is green: " + await bg(pg, '#sideSw [data-s="paper"]'));
  ok(await pg.evaluate(() => document.querySelector("#sideSw").previousElementSibling.classList.contains("brand")), "…right next to \"Trade Manager\"");
  ok(await pg.isHidden("#liveBadge") || !(await pg.$("#liveBadge")), "paper side: no LIVE badge");
  ok(!(await pg.evaluate(() => [...document.querySelectorAll("#acctSel option")].some(o => /LIVE/.test(o.text)))), "the switcher lists paper accounts only");
  await pg.click('#nav button[data-pg="account"]'); await pg.waitForSelector("#acctMgr .arow");
  ok(!(await pg.$('#acctMgr [data-a="mode"]')), "paper accounts have no \"Turn on LIVE\" any more");
  ok(/PAPER \/ LIVE at the top left/.test(await pg.textContent("#acctMgr")), "…the account list says where Live is");
  const old = await pg.evaluate(() => api("/api/accounts/mode", {body: {id: ACCT, mode: "live", confirm: "XT0001"}}));
  ok(!old.ok && /no Live option/.test(old.error), "the old route answers clearly: " + old.error);

  // ---- switch to LIVE
  await pg.click('#sideSw [data-s="live"]');
  await pg.waitForSelector("#liveDlg:not(.hide)");
  await pg.screenshot({ path: SHOT + "live_01_dialog.png" });
  // v0.31.0: the IP to whitelist is this server's own (FYERS_OUT_IP, from /etc/fyers/server.conf), never a fixed one
  const dlgText = await pg.textContent("#liveDlg"), outIp = process.env.FYERS_OUT_IP || "";
  ok(outIp ? dlgText.includes("this server's own IP " + outIp) : /this server's own public IP \(to see it, run/.test(dlgText),
     "the dialog names this server's IP to whitelist: " + (outIp || "(none set: the general wording)"));
  ok(!dlgText.includes("134.209.159.171") || outIp === "134.209.159.171", "no other server's IP in the dialog");
  ok(!(await pg.$("#ldCap")), "no typed capital: the balance is Fyers' own");
  await pg.fill("#ldConfirm", "WRONG1"); await pg.click("#ldGo");
  await pg.waitForFunction(() => document.querySelector("#ldErr").textContent.length > 0 || !document.querySelector("#codeAsk.hide") && document.querySelector("#codeAsk"));
  ok(/client ID/.test(await pg.textContent("#ldErr")), "a wrong client ID is refused: " + await pg.textContent("#ldErr"));
  await pg.fill("#ldConfirm", "XT0001"); await pg.click("#ldGo");
  await pg.waitForSelector("#codeAsk:not(.hide)", { timeout: 8000 });
  ok(true, "switching to Live asks for a fresh 2FA code");
  await pg.fill("#caCode", await LOGIN.code(pg)); await pg.click("#caGo");
  await pg.waitForSelector("#sideSw.live", { timeout: 10000 });
  ok(await pg.isHidden("#liveBadge"), "the switch shows LIVE (no second LIVE badge beside it)");
  ok(await pg.isVisible("#bKill"), "kill switch in the top bar");
  ok(/rgb\(226, 72, 61\)|rgb\(207, 51, 40\)/.test(await bg(pg, '#sideSw [data-s="live"]')), "LIVE is red: " + await bg(pg, '#sideSw [data-s="live"]'));
  ok(await pg.evaluate(() => ACCT === "live" && P.snap.mode === "live"), "the page shows the Live account");
  const opt = await pg.$eval("#acctSel", s => ({t: s.options[s.selectedIndex].text, d: s.disabled, n: s.options.length}));
  // the Live account is one account for every run: earlier runs' losses today mustn't trip its loss limits (restored at the end)
  const rules0 = await pg.evaluate(async () => { const r = P.snap.rules; await papi("rules", {daily_pct: 0, max_pct: 0}); return {daily_pct: r.daily_pct, max_pct: r.max_pct}; });
  const bal = await pg.evaluate(() => P.snap.acct.balance);
  ok(new RegExp("● XT0001 · ₹" + Math.round(bal).toLocaleString("en-IN")).test(opt.t) && opt.d && opt.n === 1, "switcher: the Live account only, named by the client ID, its balance: " + opt.t);
  ok(await pg.evaluate(() => { const h = document.querySelector("#app > header"), j = document.querySelector("#pJLock");
    return h.scrollHeight < 70 || (j && j.offsetParent); }), "the header stays on one line (unless the journal's lockout pill is showing too)");

  // ---- each login switches for itself
  const ctx2 = await br.newContext({ viewport: { width: 1300, height: 860 } });
  const pg2 = await ctx2.newPage();
  await pg2.goto(B); await LOGIN(pg2);
  await pg2.waitForSelector("#sideSw"); await pg2.waitForTimeout(800);
  ok(await pg2.evaluate(() => !sideLive() && P.snap && P.snap.mode === "paper"), "another browser's login starts on PAPER (each confirms Live for itself)");
  const w2 = await pg2.evaluate(() => fetch("/api/paper/close_all", {method: "POST", headers: {"X-Acct": "live", "Content-Type": "application/json"}, body: "{}"}).then(r => r.status));
  ok(w2 === 403, "…and its writes to the Live account are refused by the server (" + w2 + ")");
  await ctx2.close();

  // ---- the Live card: Fyers' own funds
  await pg.click('#nav button[data-pg="account"]'); await pg.waitForSelector("#liveCard");
  await pg.waitForFunction(() => /Start of the day \(Fyers\)/.test((document.querySelector("#lvFunds") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
  const fundsTxt = await pg.textContent("#lvFunds");
  ok(/Start of the day \(Fyers\)/.test(fundsTxt) && /1,00,000/.test(fundsTxt) && /Account size for the % rules/.test(fundsTxt), "Live card: Fyers' funds (start ₹1,00,000, size for the rules)");
  ok(/XT0001/.test(await pg.textContent("#liveCard h3")), "…titled with the client ID");
  ok(await pg.isHidden("#pgRsGo"), "no paper reset on the Live account");
  ok(await pg.isHidden("#acctMgr"), "the paper account list stays on the Paper side");
  ok(/stop-limit slack/.test(await pg.textContent("#pgRules")), "Live rules (stop-limit slack, re-price) shown");
  ok(await pg.$eval('#pgRules [data-k="size"]', i => i.readOnly) && /from Fyers/.test(await pg.textContent("#pgRules")), "the account size is Fyers', not typed");
  await pg.click("#lvFundsGo"); await pg.waitForTimeout(800);
  ok(/Start of the day/.test(await pg.textContent("#lvFunds")), "Read funds now");
  await pg.screenshot({ path: SHOT + "live_02_account.png", fullPage: true });

  // ---- a trade from the app
  await pg.click('#nav button[data-pg="chart"]');
  await pg.evaluate(c => openBySymbol(c), CRUDE);
  await pg.waitForFunction(c => last[c] && last[c].ltp, CRUDE, { timeout: 15000 });
  await pg.click("#bBuy");
  await pg.waitForFunction(() => /LIVE/.test(document.querySelector("#bPlace").textContent), null, { timeout: 10000 });
  ok(true, "PLACE button says LIVE: " + await pg.textContent("#bPlace"));
  await pg.screenshot({ path: SHOT + "live_03_ticket.png" });
  await pg.evaluate(() => disarm());
  const ltp = await pg.evaluate(c => last[c].ltp, CRUDE);
  const r = await pg.evaluate(([c, sl]) => papi("place", {s: c, side: 1, type: "market", sl, mode: "lots", lots: 1, product: "MARGIN"}), [CRUDE, ltp - 15]);
  ok(r.ok, "market BUY sent to (fake) Fyers" + (r.ok ? "" : ": " + r.error));
  await pg.waitForFunction(() => /Fyers stop .*✓/.test((document.querySelector("#posList .fyline") || {}).textContent || ""), null, { timeout: 10000 });
  ok(true, "position shows its stop at Fyers: " + await pg.textContent("#posList .fyline"));
  const before = await pg.evaluate(() => P.snap.positions[0].fy.stop_px);
  await pg.evaluate(() => { const p = P.snap.positions[0]; return papi("modify", {id: p.id, sl: p.sl + 10}); });
  await pg.waitForFunction(b => P.snap.positions[0] && P.snap.positions[0].fy.stop_px === b + 10, before, { timeout: 8000 }).catch(() => {});
  ok(await pg.evaluate(b => P.snap.positions[0].fy.stop_px === b + 10, before), "moving the SL on the page moves the Fyers stop");

  // ---- a trade placed straight in Fyers, without a stop
  const ox = await mock(pg, "/_mock/outside", {s: NIFTY, qty: 75, side: 1, product: "MARGIN"});
  ok(ox.ok, "a BUY placed in the Fyers app (fake)" + (ox.ok ? "" : ": " + ox.error));
  await pg.waitForFunction(n => P.snap.positions.some(p => p.s === n && p.outside), NIFTY, { timeout: 15000 }).catch(() => {});
  const op = await pg.evaluate(n => P.snap.positions.find(p => p.s === n), NIFTY);
  ok(op && op.outside && op.nostop && op.qty === 75, "it shows as a Live trade, marked as placed in Fyers, with no stop");
  await pg.waitForFunction(id => /From Fyers · NO STOP AT FYERS/.test((document.querySelector(`#posList .pos[data-id="${id}"] .fyline`) || {}).textContent || ""), op && op.id, { timeout: 8000 }).catch(() => {});
  ok(/From Fyers · NO STOP AT FYERS/.test(await pg.textContent(`#posList .pos[data-id="${op && op.id}"] .fyline`)), "red flag on the position: NO STOP AT FYERS");
  ok(await pg.isVisible(`#posList .pos[data-id="${op && op.id}"] [data-mystop]`), "…with a one-tap \"Place my stop\"");
  await pg.waitForFunction(() => /NO STOP/.test(document.querySelector("#liveWarn").textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/NO STOP/.test(await pg.textContent("#liveWarn")), "…and in the live warnings");
  const bk = await mock(pg, "/_mock/book");
  const after = o => BigInt(o.id) > BigInt(ox.id);            // (the fake's book also holds earlier runs' orders)
  ok(!bk.book.some(o => after(o) && o.symbol === NIFTY && o.side === -1), "nothing is placed at Fyers until the tap");
  await pg.evaluate(c => openBySymbol(c), NIFTY);
  await pg.waitForSelector(`#posbars .pbar[data-id="${op.id}"] button.nsl`, { timeout: 10000 }).catch(() => {});
  ok(await pg.isVisible(`#posbars .pbar[data-id="${op.id}"] button.nsl`), "the entry line's bar has a red NO STOP button");
  await pg.screenshot({ path: SHOT + "live_04_nostop.png" });

  // ---- the phone (same login): the switch in its top bar, the sheet's Place my stop
  const ph = await ctx.newPage();
  await ph.setViewportSize({ width: 412, height: 900 });
  await ph.goto(B);
  await ph.waitForSelector("#mSide", { timeout: 15000 });
  await ph.waitForFunction(() => P.snap && P.snap.mode === "live", null, { timeout: 10000 }).catch(() => {});
  ok(/LIVE/.test(await ph.textContent("#mSide")) && await ph.$eval("#mSide", b => b.classList.contains("live")) && await ph.isHidden("#mLive"),
     "phone: the switch in the top bar shows LIVE (red)");
  await ph.evaluate(id => mPosSheet(id), op.id);
  await ph.waitForSelector('#mSheet [data-f="mystop"]:not(.hide)', { timeout: 8000 }).catch(() => {});
  ok(await ph.isVisible("#mpMyStop"), "phone: the trade's sheet has \"Place my stop\"");
  await ph.screenshot({ path: SHOT + "live_05_phone.png" });
  await ph.close();

  // ---- Place my stop
  await pg.click(`#posbars .pbar[data-id="${op.id}"] button.nsl`);
  await pg.waitForFunction(id => { const p = P.snap.positions.find(x => x.id === id); return p && p.fy.stop_oid; }, op.id, { timeout: 10000 }).catch(() => {});
  const op2 = await pg.evaluate(id => P.snap.positions.find(x => x.id === id), op.id);
  ok(op2 && op2.fy.stop_oid && op2.first_sl != null && op2.init_risk > 0, "Place my stop: the stop is at Fyers and sets 1R");
  const bk2 = await mock(pg, "/_mock/book");
  ok(bk2.book.some(o => after(o) && o.symbol === NIFTY && o.side === -1 && o.type === 4 && o.status === 6), "…a stop-limit sell at (fake) Fyers");
  ok(!(await pg.isVisible(`#posbars .pbar[data-id="${op.id}"] button.nsl`)), "…and the NO STOP button has gone");

  // ---- a pending order placed in Fyers
  const ol = await mock(pg, "/_mock/outside", {s: CRUDE, qty: 1, side: 1, type: 1, product: "MARGIN", limit: Math.round(ltp - 300)});
  await pg.waitForFunction(id => P.snap.orders.some(o => o.fy && o.fy.oid === id), ol.id, { timeout: 10000 }).catch(() => {});
  const oo = await pg.evaluate(id => P.snap.orders.find(o => o.fy && o.fy.oid === id), ol.id);
  ok(oo && oo.outside && oo.type === "limit", "a limit placed in Fyers shows as an order here");
  await pg.click("#tabOrd"); await pg.waitForTimeout(300);
  ok(/Placed in Fyers/.test(await pg.textContent(`#ordList .pos[data-id="${oo && oo.id}"]`)), "…marked \"Placed in Fyers\"");
  await pg.click(`#ordList .pos[data-id="${oo.id}"] [data-a="cancel"]`);
  await pg.waitForFunction(id => !P.snap.orders.some(o => o.id === id), oo.id, { timeout: 10000 }).catch(() => {});
  const bk3 = await mock(pg, "/_mock/book");
  ok((bk3.book.find(o => o.id === ol.id) || {}).status === 1, "cancelled from the app: cancelled at Fyers");
  await pg.click("#tabPos").catch(() => {});
  await pg.click('#nav button[data-pg="trades"]'); await pg.waitForSelector("#pgPos .fyline");
  ok(/Fyers stop/.test(await pg.textContent("#pgPos")) && /From Fyers/.test(await pg.textContent("#pgPos")), "Trades page: the Fyers stops, the trade from Fyers marked");
  await pg.screenshot({ path: SHOT + "live_06_trades.png" });

  // ---- kill switch
  await pg.click("#bKill");
  await pg.waitForFunction(() => P.snap && !P.snap.positions.length, null, { timeout: 20000 }).catch(() => {});
  ok(await pg.evaluate(() => !P.snap.positions.length), "kill switch closed both trades at Fyers (the app's and the one from Fyers)");
  await pg.waitForFunction(() => /Kill switch used/.test(document.querySelector("#liveWarn").textContent), null, { timeout: 8000 });
  ok(true, "warning: new orders paused until Resume");
  const blocked = await pg.evaluate(([c, sl]) => api("/api/paper/preview", {body: {s: c, side: 1, type: "market", sl, mode: "lots", lots: 1, product: "MARGIN"}}), [CRUDE, ltp - 15]);
  ok(blocked.ok && /Resume/.test(blocked.plan.blocked || ""), "orders blocked after the kill switch");
  await pg.click('#nav button[data-pg="account"]'); await pg.waitForSelector("#lvResume");
  await pg.click("#lvResume");
  await pg.waitForFunction(() => (document.querySelector("#codeAsk") && !document.querySelector("#codeAsk").classList.contains("hide")) || !P.snap.live.halted, null, { timeout: 8000 });
  if(await pg.evaluate(() => P.snap.live.halted)){ await pg.fill("#caCode", await LOGIN.code(pg)); await pg.click("#caGo"); }
  await pg.waitForTimeout(1000);
  ok(await pg.evaluate(() => !P.snap.live.halted), "Resume allows orders again");
  const hist = await pg.evaluate(() => api("/api/paper/history"));
  const kills = hist.rows.filter(h => h.reason === "kill");
  ok(kills.length >= 2 && kills.some(h => h.src === "fyers"), "history: both closed by the kill switch, the one from Fyers marked");
  await pg.click('#nav button[data-pg="history"]'); await pg.waitForTimeout(1200);
  ok(/Fyers/.test(await pg.textContent("#pgHT")), "History page: the trade placed in Fyers is tagged");

  await pg.evaluate(r => papi("rules", r), rules0);
  // ---- back to Paper: one click; the server still manages the Live account
  const ob = await mock(pg, "/_mock/outside", {s: NIFTY, qty: 75, side: 1, product: "MARGIN"});
  await pg.waitForFunction(n => P.snap.positions.some(p => p.s === n), NIFTY, { timeout: 15000 }).catch(() => {});
  await pg.click('#sideSw [data-s="paper"]');
  await pg.waitForSelector("#sideSw:not(.live)", { state: "attached", timeout: 8000 });
  ok(await pg.isHidden("#bKill") && await pg.evaluate(() => !sideLive() && ACCT !== "live"), "back to Paper in one click: badge and kill switch gone, a paper account shown");
  await pg.waitForFunction(() => P.snap && P.snap.mode === "paper", null, { timeout: 8000 }).catch(() => {});
  ok(await pg.evaluate(() => P.snap.mode === "paper" && !document.querySelector("#acctSel").disabled), "the switcher lists the paper accounts again");
  await mock(pg, "/_mock/outside", {s: NIFTY, qty: 75, side: -1, product: "MARGIN"});      // closed in Fyers, the page on Paper
  await pg.waitForTimeout(2500);
  const lv = await asLive(pg, "/api/paper");
  ok(lv.status === 200 && !lv.j.paper.positions.length, "with the page on Paper, the server still follows the Live account (closed in Fyers)");
  const lh = await asLive(pg, "/api/paper/history");
  ok(lh.j.rows[0] && lh.j.rows[0].reason === "closed in Fyers" && lh.j.rows[0].src === "fyers", "…booked as closed in Fyers");
  const wr = await asLive(pg, "/api/paper/place", {s: CRUDE, side: 1, type: "market", sl: ltp - 15, mode: "lots", lots: 1, product: "MARGIN"});
  ok(wr.status === 403 && /switch to Live/.test(wr.j.detail || ""), "a page on Paper can't place on the Live account (" + wr.status + ")");
  ok(errs.length === 0, "no script errors" + (errs.length ? ": " + errs.join(" / ") : ""));
  await br.close();
})().catch(async e => { ok(false, e.message.split("\n")[0]); if(br) await br.close(); });
