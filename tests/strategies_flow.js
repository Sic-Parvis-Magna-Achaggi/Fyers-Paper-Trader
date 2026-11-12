// Browser test (v0.43.0, roadmap 23 a): the Strategies page. The ⚡ in the top bar (still one line at 1500 px), a new
// strategy from a Pine strategy() script through the rules panel (contract search, timeframe, account, size, stop, target,
// limits), the tester's results, Save and switch on, a real trade on a fresh paper account from the mock's live prices
// (tagged ⚡ on the panel, the log, the History's record), Live asking for the 2FA code (cancelled: nothing saved), Switch
// off, the phone (More › Strategies, the rules panel full screen).
// Run after security_flow.js.  FYERS_HELPER_DATA=/tmp/fyers_test node tests/strategies_flow.js   (~4 min)
const { chromium, devices } = require("playwright");
const LOGIN = require("./login.js");
const B = "http://localhost:8766/";
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
require("fs").mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { require("fs").writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const CRUDE = "MCX:CRUDEOIL26NOVFUT";
const CODE = `//@version=6
strategy("Flow test strategy", overlay=true)
if bar_index % 2 == 0
    strategy.entry("L", strategy.long)
else
    strategy.close("L")
plot(close - 20, "line stop")`;

let br;
(async () => {
  br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1500, height: 920 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  pg.on("console", m => { if(m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.goto(B); await LOGIN(pg);
  await pg.evaluate(() => fetch("/_mock/allday?on=1", {method: "POST"}));
  await pg.evaluate(() => { const a = acctList().find(x => x.name === "Main"); if(a) acctSwitch(a.id); });
  const main = await pg.evaluate(() => ACCT);
  const ta = await pg.evaluate(async () => { const r = await api("/api/accounts/create", {body: {name: "Strat test " + (Date.now() % 1e6), capital: 1000000}});
    S.accounts = r.accounts; acctSetup(); acctSwitch(r.account.id); return r.account.id; });
  await pg.waitForFunction(id => P.snap && ACCT === id, ta, { timeout: 10000 });
  const taName = await pg.evaluate(id => acctList().find(a => a.id === id).name, ta);
  await pg.evaluate(() => papi("rules", {daily_pct: 0, max_pct: 0, max_trades: 0, squareoff_on: false}).catch(() => {}));
  const sc = await pg.evaluate(async code => { const j = await api("/api/scripts/save", {body: {name: "Flow test strategy", source: code}}); await pineLoad(true); return j; }, CODE);
  ok(sc.ok, "a Pine strategy() script saved in the Pine Editor's library");
  await pg.evaluate(c => openBySymbol(c), CRUDE);
  await pg.waitForFunction(c => last[c] && last[c].ltp, CRUDE, { timeout: 20000 });

  // ---- the ⚡ in the top bar, the page
  ok(await pg.isVisible('#nav button[data-pg="strategies"]'), "⚡ Strategies in the top bar");
  const hdr = await pg.evaluate(() => { const h = document.querySelector("header") || document.querySelector("#top"); const n = document.querySelector("#nav");
    return {h: h ? h.getBoundingClientRect().height : 0, wrap: n ? n.scrollWidth > n.clientWidth + 1 : false, navH: n ? n.getBoundingClientRect().height : 0}; });
  ok(hdr.navH < 50, `the top bar stays on one line at 1500 px (nav ${Math.round(hdr.navH)} px high)`);
  await pg.click('#nav button[data-pg="strategies"]');
  await pg.waitForSelector("#pg_strategies .pg-head");
  ok(/Strategies/.test(await pg.textContent("#pg_strategies .pg-head")), "the Strategies page opens");
  // ---- a new strategy through the rules panel
  await pg.click("#sgNew");
  await pg.waitForSelector("#sgDlg:not(.hide) #sgScript");
  const sid = await pg.evaluate(() => [...document.querySelectorAll("#sgScript option")].find(o => /Flow test strategy/.test(o.textContent)).value);
  await pg.selectOption("#sgScript", sid);
  await pg.waitForTimeout(300);
  ok(await pg.inputValue("#sgName") === "Flow test strategy", "picking the script fills the name from strategy(\"...\")");
  for(const t of await pg.$$eval("#sgDlg .sgsyms [data-rm]", a => a.map(x => x.dataset.rm))) await pg.click("#sgDlg .sgsyms [data-rm]");
  await pg.fill("#sgSymQ", "CRUDEOIL");
  await pg.waitForSelector(`#sgSymHits [data-s="${CRUDE}"]`, { timeout: 8000 });
  await pg.click(`#sgSymHits [data-s="${CRUDE}"]`);
  ok(/CRUDEOIL26NOVFUT/.test(await pg.textContent("#sgDlg .sgsyms")), "the contract search adds CRUDEOIL");
  await pg.selectOption("#sgTf", "1m");
  await pg.waitForTimeout(150);
  // accounts: only the test account
  for(const cb of await pg.$$("#sgDlg [data-acc]")) { const aid = await cb.getAttribute("data-acc"); if((aid === ta) !== await cb.isChecked()) await cb.click(); }
  ok(await pg.$(`#sgDlg [data-acc="live"]`) !== null, "the admin can pick Live (marked LIVE · real money)");
  await pg.selectOption("#sgSizeM", "lots"); await pg.waitForTimeout(150);
  await pg.fill("#sgSizeV", "1");
  await pg.selectOption("#sgProd", "MARGIN");
  await pg.selectOption("#sgStopK", "points"); await pg.waitForTimeout(150);
  await pg.fill("#sgStopN", "100");
  await pg.fill("#sgTgtR", "4");
  await pg.fill("#sgMaxDay", "0"); await pg.fill("#sgLoss", "0"); await pg.fill("#sgCut", "0");
  await pg.screenshot({ path: SHOT + "strat_01_rules.png" });
  // the tester from the rules panel
  await pg.click("#sgTestB");
  await pg.waitForSelector("#sgTestDlg:not(.hide) #stRun");
  await pg.selectOption("#stDays", "7");
  await pg.click("#stRun");
  await pg.waitForSelector("#stOut .pg-cards, #stOut .down", { timeout: 120000 });
  const tst = await pg.evaluate(() => ({err: (document.querySelector("#stOut > p.down") || {}).textContent || "", cards: [...document.querySelectorAll("#stOut .pgc")].map(c => c.textContent.replace(/\s+/g, " ").trim()),
    rows: document.querySelectorAll("#stOut table tbody tr").length, curve: !!document.querySelector("#stOut .sgcurve path")}));
  ok(!tst.err && tst.cards.length >= 8, "the tester's results: " + (tst.err || tst.cards.slice(0, 4).join(" | ")));
  ok(tst.curve && tst.rows > 3, `an equity curve and the trades (${tst.rows} rows)`);
  await pg.screenshot({ path: SHOT + "strat_02_tester.png" });
  await pg.click("#sgTestDlg .btns [data-x]");
  // save and switch on
  await pg.click("#sgSaveOn");
  await pg.waitForSelector("#pg_strategies .sgcard.on", { timeout: 10000 });
  const card = await pg.textContent("#pg_strategies .sgcard.on");
  ok(/ON/.test(card) && /CRUDEOIL26NOVFUT/.test(card) && /1m/.test(card) && /100 points/.test(card) && /4R/.test(card), "the card: ON, its contract, 1m, Stop 100 points, Target 4R");
  ok(card.includes(taName), "...and its account");
  const st = await pg.evaluate(async () => (await api("/api/strategies")).strategies.find(s => s.name === "Flow test strategy"));
  ok(st && st.status === "on" && st.accounts.length === 1 && st.accounts[0].aid === ta && st.accounts[0].on && st.size.mode === "lots" && st.stop.k === "points" && st.stop.n === 100, "saved on the server as set");
  await pg.screenshot({ path: SHOT + "strat_03_card.png" });

  // ---- a real trade from the mock's live prices (1-minute bars: one closes within a minute)
  let traded = null;
  for(let i = 0; i < 75 && !traded; i++){
    await pg.waitForTimeout(2000);
    traded = await pg.evaluate(id => (P.snap && P.snap.positions || []).find(p => p.strat && p.strat.id === id) || null, st.id);
    if(!traded) traded = await pg.evaluate(async id => { const j = await api("/api/paper/history?days=0"); return (j.rows || []).find(h => h.strat && h.strat.id === id) || null; }, st.id);
  }
  ok(!!traded, "the strategy placed a trade by itself on the paper account" + (traded ? ` (${traded.side > 0 ? "LONG" : "SHORT"} @ ${traded.avg})` : ""));
  const lg = await pg.evaluate(() => [...document.querySelectorAll("#sgLog tbody tr")].map(r => r.textContent.replace(/\s+/g, " ").trim()).slice(0, 4));
  ok(lg.some(t => /BUY 1 lot/.test(t)), "the page's log shows it: " + (lg[0] || ""));
  if(traded && traded.sl != null) ok(Math.abs(Math.abs(traded.avg - (traded.first_sl ?? traded.sl)) - 100) <= 2, `its stop: 100 points from the fill (${traded.avg} → ${traded.first_sl ?? traded.sl})`);
  await pg.click('#nav button[data-pg="chart"]');
  await pg.waitForTimeout(800);
  const tagged = await pg.evaluate(() => [...document.querySelectorAll("#posList .sgtag")].map(e => e.textContent));
  if(await pg.evaluate(id => (P.snap.positions || []).some(p => p.strat && p.strat.id === id), st.id))
    ok(tagged.some(t => /Flow test strategy/.test(t)), "the trades panel tags it ⚡ Flow test strategy");
  await pg.screenshot({ path: SHOT + "strat_04_panel.png" });
  // the strategy closes it on the next bar (strategy.close on odd bars)
  let closed = null;
  for(let i = 0; i < 50 && !closed; i++){
    await pg.waitForTimeout(2000);
    closed = await pg.evaluate(async id => { const j = await api("/api/paper/history?days=0"); return (j.rows || []).find(h => h.strat && h.strat.id === id) || null; }, st.id);
  }
  ok(closed && /strategy/.test(closed.reason || ""), "strategy.close closed it on the next bar; History has the tag and the reason: " + (closed && closed.reason));
  ok(closed && closed.strat && closed.strat.name === "Flow test strategy", "History's record: tagged with the strategy");

  // ---- Live asks for the 2FA code; cancelled: nothing saved
  await pg.click('#nav button[data-pg="strategies"]');
  await pg.waitForSelector("#pg_strategies .sgcard");
  await pg.click('#pg_strategies .sgcard [data-a="edit"]');
  await pg.waitForSelector("#sgDlg:not(.hide) [data-acc=\"live\"]");
  await pg.click('#sgDlg [data-acc="live"]');
  await pg.click("#sgSave");
  await pg.waitForSelector("#codeAsk:not(.hide) #caCode", { timeout: 8000 }).catch(() => {});
  ok(await pg.isVisible("#codeAsk #caCode"), "switching Live on asks for the 2FA code");
  await pg.click("#codeAsk #caX");
  await pg.waitForTimeout(500);
  const st2 = await pg.evaluate(async id => (await api("/api/strategies")).strategies.find(s => s.id === id), st.id);
  ok(!st2.accounts.some(a => a.aid === "live" && a.on), "cancelled: Live isn't saved");
  await pg.click("#sgDlg .btns [data-x]");
  // ---- switch off
  await pg.click('#pg_strategies .sgcard [data-a="onoff"]');
  await pg.waitForFunction(() => !document.querySelector("#pg_strategies .sgcard.on"), null, { timeout: 8000 });
  ok(await pg.evaluate(async id => (await api("/api/strategies")).strategies.find(s => s.id === id).status === "off", st.id), "Switch off: off on the server");
  ok(errs.length === 0, "no script errors" + (errs.length ? ": " + errs.join(" | ") : ""));

  // ---- the phone
  const ph = await br.newContext({ ...devices["Pixel 7"] });
  const m = await ph.newPage();
  const merrs = []; m.on("pageerror", e => merrs.push(e.message));
  await m.goto(B); await LOGIN(m);
  await m.waitForFunction(() => document.body.classList.contains("mob"), null, { timeout: 15000 });
  await m.evaluate(() => mShow("more"));
  await m.waitForSelector('#ms_more [data-pg="strategies"]', { timeout: 8000 });
  ok(await m.isVisible('#ms_more [data-pg="strategies"]'), "phone: More › Strategies");
  await m.tap('#ms_more [data-pg="strategies"]');
  await m.waitForSelector("#pg_strategies .sgcard", { timeout: 8000 });
  ok(await m.isVisible("#pg_strategies .sgcard"), "phone: the Strategies page with the card");
  await m.screenshot({ path: SHOT + "strat_05_phone.png" });
  await m.tap('#pg_strategies .sgcard [data-a="edit"]');
  await m.waitForSelector("#sgDlg:not(.hide) .sgdlg");
  const box = await m.evaluate(() => { const r = document.querySelector("#sgDlg .sgdlg").getBoundingClientRect(); return {w: r.width, vw: innerWidth}; });
  ok(box.w >= box.vw - 2, `phone: the rules panel fills the screen (${Math.round(box.w)} of ${box.vw} px)`);
  await m.screenshot({ path: SHOT + "strat_06_phone_rules.png" });
  ok(merrs.length === 0, "phone: no script errors" + (merrs.length ? ": " + merrs.join(" | ") : ""));
  await ph.close();

  // ---- clean up
  await pg.evaluate(async id => { await api("/api/strategies/action", {body: {id, do: "delete"}}); }, st.id);
  for(const id of await pg.evaluate(() => P.snap.positions.map(x => x.id))) await pg.evaluate(id => papi("close", {id}), id);
  await pg.evaluate(async ({main, ta, sid}) => { await api("/api/scripts/delete", {body: {id: sid}}); acctSwitch(main);
    await api("/api/accounts/update", {body: {id: ta, archived: true}}); await acctRefresh(); }, {main, ta, sid: sc.id || sid});
  await pg.evaluate(() => fetch("/_mock/allday?on=0", {method: "POST"}));
  await br.close();
})().catch(async e => { ok(false, "crashed: " + e.message); if(br) await br.close(); });
