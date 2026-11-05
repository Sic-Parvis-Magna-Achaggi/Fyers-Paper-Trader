// Browser test of Live mode on the fake Fyers (tests/mock_server.py fakes the order API too). Run after security_flow.js
// (the admin needs 2FA). Turns the admin's Main account Live (typed client ID + 2FA code), places a trade, checks the
// Fyers stop shown on the position, BE moves it, the kill switch, Resume, and switches back to Paper.
const { chromium } = require("playwright");
const LOGIN = require("./login.js");
const B = "http://localhost:8766/";
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
require("fs").mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { require("fs").writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };   // written at once (a hung step still shows how far it got)
const CRUDE = "MCX:CRUDEOIL26NOVFUT";

let br;
(async () => {
  br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  pg.on("console", m => { if(m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });
  pg.on("dialog", d => d.accept());
  await pg.goto(B); await LOGIN(pg);
  await pg.evaluate(() => { const a = acctList().find(x => x.name === "Main"); if(a) acctSwitch(a.id); });
  await pg.waitForTimeout(800);
  ok(await pg.isHidden("#liveBadge") || !(await pg.$("#liveBadge")), "paper account: no LIVE badge");

  // ---- turn on Live
  await pg.click('#nav button[data-pg="account"]'); await pg.waitForSelector("#acctMgr .arow");
  const row = pg.locator("#acctMgr .arow", { hasText: "Main" });
  await row.locator('[data-a="mode"]').click();
  await pg.waitForSelector("#liveDlg:not(.hide)");
  await pg.screenshot({ path: SHOT + "live_01_dialog.png" });
  // v0.31.0: the IP to whitelist is this server's own (FYERS_OUT_IP, from /etc/fyers/server.conf), never a fixed one
  const dlgText = await pg.textContent("#liveDlg"), outIp = process.env.FYERS_OUT_IP || "";
  ok(outIp ? dlgText.includes("this server's own IP " + outIp) : /this server's own public IP \(to see it, run/.test(dlgText),
     "the dialog names this server's IP to whitelist: " + (outIp || "(none set: the general wording)"));
  ok(!dlgText.includes("134.209.159.171") || outIp === "134.209.159.171", "no other server's IP in the dialog");
  await pg.fill("#ldConfirm", "WRONG1"); await pg.click("#ldGo");
  await pg.waitForFunction(() => document.querySelector("#ldErr").textContent.length > 0 || !document.querySelector("#codeAsk.hide") && document.querySelector("#codeAsk"));
  ok(/client ID/.test(await pg.textContent("#ldErr")), "a wrong client ID is refused: " + await pg.textContent("#ldErr"));
  await pg.fill("#ldConfirm", "XT0001"); await pg.fill("#ldCap", "100000"); await pg.click("#ldGo");
  await pg.waitForSelector("#codeAsk:not(.hide)", { timeout: 8000 });
  ok(true, "turning Live on asks for a fresh 2FA code");
  await pg.fill("#caCode", await LOGIN.code(pg)); await pg.click("#caGo");
  await pg.waitForSelector("#liveBadge:not(.hide)", { timeout: 10000 });
  ok(true, "red LIVE badge in the top bar");
  ok(await pg.isVisible("#bKill"), "kill switch in the top bar");
  ok(/● LIVE · Main/.test(await pg.$eval("#acctSel", s => s.options[s.selectedIndex].text)), "switcher marks the account LIVE");
  await pg.click('#nav button[data-pg="account"]'); await pg.waitForSelector("#liveCard");
  await pg.waitForFunction(() => /available/.test((document.querySelector("#lvFunds") || {}).textContent || ""), null, { timeout: 8000 });
  ok(true, "Account page: Live card with Fyers funds: " + await pg.textContent("#lvFunds"));
  ok(await pg.isHidden("#pgRsGo"), "no paper reset on a Live account");
  ok(/stop-limit slack/.test(await pg.textContent("#pgRules")), "Live rules (stop-limit slack, re-price) shown");
  ok(/100,000|1,00,000/.test(await pg.textContent("#pg_account")), "fresh ledger at the capital typed (₹1,00,000)");
  await pg.screenshot({ path: SHOT + "live_02_account.png", fullPage: true });

  // ---- a trade
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
  await pg.screenshot({ path: SHOT + "live_04_position.png" });
  const before = await pg.evaluate(() => P.snap.positions[0].fy.stop_px);
  await pg.evaluate(c => { const p = P.snap.positions[0]; return papi("modify", {id: p.id, sl: p.sl + 10}); }, CRUDE);
  await pg.waitForFunction(b => P.snap.positions[0] && P.snap.positions[0].fy.stop_px === b + 10, before, { timeout: 8000 }).catch(() => {});
  ok(await pg.evaluate(b => P.snap.positions[0].fy.stop_px === b + 10, before), "moving the SL on the page moves the Fyers stop");
  await pg.click('#nav button[data-pg="trades"]'); await pg.waitForSelector("#pgPos .fyline");
  ok(/Fyers stop/.test(await pg.textContent("#pgPos .fyline")), "Trades page shows the Fyers stop under SL");
  await pg.screenshot({ path: SHOT + "live_05_trades.png" });

  // ---- kill switch
  await pg.click("#bKill");
  await pg.waitForFunction(() => P.snap && !P.snap.positions.length, null, { timeout: 15000 });
  ok(true, "kill switch closed the position at Fyers");
  await pg.waitForFunction(() => /Kill switch used/.test(document.querySelector("#liveWarn").textContent), null, { timeout: 8000 });
  ok(true, "warning: new orders paused until Resume");
  const blocked = await pg.evaluate(([c, sl]) => api("/api/paper/preview", {body: {s: c, side: 1, type: "market", sl, mode: "lots", lots: 1, product: "MARGIN"}}), [CRUDE, ltp - 15]);
  ok(blocked.ok && /Resume/.test(blocked.plan.blocked || ""), "orders blocked after the kill switch");
  await pg.click('#nav button[data-pg="chart"]'); await pg.waitForTimeout(500);
  await pg.screenshot({ path: SHOT + "live_06_killed.png" });
  await pg.click('#nav button[data-pg="account"]'); await pg.waitForSelector("#lvResume");
  await pg.click("#lvResume");
  // Resume needs a fresh 2FA code; the one typed to turn Live on is still valid (5 minutes), so it may not ask again
  await pg.waitForFunction(() => (document.querySelector("#codeAsk") && !document.querySelector("#codeAsk").classList.contains("hide")) || !P.snap.live.halted, null, { timeout: 8000 });
  if(await pg.evaluate(() => P.snap.live.halted)){ await pg.fill("#caCode", await LOGIN.code(pg)); await pg.click("#caGo"); }
  await pg.waitForTimeout(1000);
  ok(await pg.evaluate(() => !P.snap.live.halted), "Resume allows orders again");
  const hist = await pg.evaluate(() => api("/api/paper/history"));
  ok(hist.rows.length === 1 && hist.rows[0].reason === "kill", "history: the trade, closed by the kill switch");

  // ---- back to Paper
  await pg.waitForSelector("#acctMgr .arow");
  await pg.locator("#acctMgr .arow", { hasText: "Main" }).locator('[data-a="mode"]').click();
  await pg.waitForSelector("#liveDlg:not(.hide)"); await pg.click("#ldGo");
  await pg.waitForSelector("#liveBadge.hide", { state: "attached", timeout: 8000 });
  ok(await pg.isHidden("#bKill"), "back to Paper: badge and kill switch gone");
  ok(errs.length === 0, "no script errors" + (errs.length ? ": " + errs.join(" / ") : ""));
  await br.close();
})().catch(async e => { ok(false, e.message.split("\n")[0]); if(br) await br.close(); });
