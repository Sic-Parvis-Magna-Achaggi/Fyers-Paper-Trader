// MT5 accounts (roadmap 8 b, slice b1) in the browser: the PAPER | LIVE | MT5 switch (a 2FA code), the MT5 account in the
// switcher (login · server · DEMO · $ balance), its positions and pending orders straight from MT5 (a fake terminal,
// tests/fake_mt5.py with its control API), money in $, the trade's state at MT5 on the panel, the login typed once, SL moves,
// BE and TRAIL from the chart's entry-line bar moving MT5's real stop, ✕ closing it in MT5, a pending order moved and cancelled,
// History (MT5's own history + the app's closes, $ net of commission and swap), the Account page (FundingPips' limits, the
// commission learned), Settings' rules form, the server refusing MT5 changes from a page on Paper, back to PAPER (₹), the
// phone (the side menu, the MT5 account sheet). Needs the mock server and security_flow.js (2FA set up).
const { chromium, devices } = require("playwright");
const { spawn } = require("child_process");
const LOGIN = require("./login.js");
const fs = require("fs");
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const CTL = "http://127.0.0.1:8769";
const ctl = async (path, body) => (await fetch(CTL + path, body ? { method: "POST", body: JSON.stringify(body) } : {})).json();
let br, ea;
const startEA = key => { ea = spawn("python3", [__dirname + "/fake_mt5.py", "http://localhost:8766", key, "--ctl", "8769", "--history"], { stdio: ["ignore", "pipe", "pipe"] });
  ea.stdout.on("data", d => fs.writeSync(1, "  [fake MT5] " + d)); ea.stderr.on("data", d => fs.writeSync(1, "  [fake MT5 err] " + d)); };
const code = async pg => { if(await pg.isVisible("#codeAsk:not(.hide) #caCode")){ await pg.fill("#caCode", await LOGIN.code(pg)); await pg.click("#caGo"); } };

(async () => {
  br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
  const errs = []; pg.on("pageerror", e => { errs.push(e.message); fs.writeSync(1, "PAGEERROR " + e.message + "\n"); });
  pg.on("console", m => { if(m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.evaluate(() => api("/api/side", {body: {side: "paper"}}));

  // ---- a bridge key and the terminal (EA 1.10)
  const key = await pg.evaluate(async () => { let j = await api("/api/mt5/key", {body: {}}); return j; });
  let k = key.key;
  if(!k){ await pg.evaluate(() => { window._k = stepUp(() => api("/api/mt5/key", {body: {}})); }); await pg.waitForTimeout(300); await code(pg);
    k = (await pg.evaluate(() => window._k)).key; }
  ok(/^ftm-/.test(k || ""), "a bridge key for the fake terminal");
  startEA(k);
  await pg.waitForFunction(async () => { const j = await api("/api/accounts"); return j.accounts.some(a => a.id === "mt5-21182752"); }, null, { timeout: 20000, polling: 500 });
  ok(true, "the terminal's login became an MT5 account on the server");
  await pg.evaluate(() => refreshState());
  await pg.waitForTimeout(500);
  ok(await pg.isVisible('#sideSw [data-s="mt5"]'), "the switch at the top left has a third side: MT5");
  ok(!(await pg.evaluate(() => [...document.querySelectorAll("#acctSel option")].some(o => /21182752/.test(o.textContent)))), "on PAPER the account switcher doesn't list the MT5 account");

  // ---- PAPER -> MT5 (a 2FA code)
  await pg.click('#sideSw [data-s="mt5"]');
  await pg.waitForSelector("#mtSideDlg:not(.hide) #mtsGo");
  ok(/opens no new|Placing new orders from here comes in the next step/.test(await pg.textContent("#mtSideDlg")), "the MT5 dialog explains it (managing real trades; placing comes next)");
  await pg.click("#mtsGo"); await pg.waitForTimeout(400); await code(pg);
  await pg.waitForFunction(() => S.side === "mt5" && ACCT === "mt5-21182752" && P.snap && P.snap.mode === "mt5", null, { timeout: 15000 });
  ok(await pg.evaluate(() => document.body.classList.contains("is-mt5") && document.querySelector('#sideSw [data-s="mt5"]').classList.contains("on")), "on MT5: the switch and the header in MT5's colour");
  const opt = await pg.evaluate(() => [document.querySelector("#acctSel").selectedOptions[0].textContent, document.querySelector("#acctSel").title]);
  ok(/● 21182752 · DEMO · \$[\d,]+\.\d\d/.test(opt[0]) && /FundingPips-SIM1/.test(opt[1]), `the switcher: "${opt[0]}" (${opt[1].slice(0, 50)})`);
  ok(await pg.evaluate(() => { const h = document.querySelector("#app > header"), w = document.querySelector("#mtWarn");
    return h.scrollHeight - (w && !w.classList.contains("hide") ? w.offsetHeight : 0) < 70; }), "the top bar stays on one line at 1500 px on MT5");
  ok(await pg.evaluate(() => /\$/.test(document.querySelector("#acct").textContent) && !/₹/.test(document.querySelector("#acct").textContent)), "money in $ on the panel");
  ok(/Daily floor \$[\d,.]+ \(5% of the day's start/.test(await pg.textContent("#mtFoot")) && /Max floor \$4,500\.00/.test(await pg.textContent("#mtFoot")),
     "FundingPips' limits under the figures (daily from the broker's midnight, max from $5,000)");
  await pg.screenshot({ path: SHOT + "mt5acct_side.png" });

  // ---- a trade placed in MT5
  await pg.evaluate(async () => { await openBySymbol("MT5:XAUUSD"); });
  await ctl("/jitter", { on: false });
  const q = (await ctl("/state")).quotes.XAUUSD;
  const tk = (await ctl("/open", { sym: "XAUUSD", side: 1, vol: 0.10, sl: +(q[0] - 6).toFixed(2), tp: +(q[0] + 40).toFixed(2) })).ticket;
  await pg.waitForSelector(`#posList .pos[data-id="P${tk}"] .mtline`, { timeout: 10000 });
  const line = await pg.textContent(`#posList .pos[data-id="P${tk}"]`);
  ok(/0\.1 lot/.test(line) && /Placed in MT5 · #\d+ · MT5 SL [\d.,]+ · TP [\d.,]+ ✓/.test(line), `the trade from MT5 on the panel: ${line.replace(/\s+/g, " ").slice(0, 160)}`);
  await pg.waitForFunction(id => document.querySelector(`#posbars .pbar[data-id="${id}"]`), `P${tk}`, { timeout: 10000 });
  ok(true, "its entry line's bar on the chart (✕, BE, BE-T, TRAIL)");
  const v = await pg.evaluate(id => P.snap.positions.find(p => p.id === id), `P${tk}`);
  ok(v && v.vol === 0.1 && v.at_sl < 0 && v.init_risk > 0 && Math.abs(v.at_sl + v.init_risk) < 0.02, `1R = $${v && v.init_risk} net of commission (at SL ${v && v.at_sl})`);

  // ---- the first change: the login, once; an SL move reaches MT5
  const newSl = +(q[0] - 5).toFixed(2);
  const confirmed = await pg.evaluate(() => P.snap.mt5.confirmed);
  await pg.evaluate(([id, sl]) => { window._m = papi("modify", {id, sl}); }, [`P${tk}`, newSl]);
  if(!confirmed){
    await pg.waitForSelector("#mtConfDlg:not(.hide) #mtcLogin", { timeout: 5000 });
    ok(/First change on MT5 account 21182752/.test(await pg.textContent("#mtConfDlg")), "the first change asks for the account's login");
    await pg.fill("#mtcLogin", "999"); await pg.click("#mtcGo"); await pg.waitForTimeout(400);
    ok(/isn't this account's login/.test(await pg.textContent("#mtcErr")), "a wrong login: refused");
    await pg.fill("#mtcLogin", "21182752"); await pg.click("#mtcGo");
  } else ok(true, "(the login was confirmed in an earlier run on this data: asked once per account, kept)");
  const pos = async () => (await ctl("/state")).positions.find(p => p.ticket === tk);
  for(let i = 0; i < 20 && (await pos()).sl !== newSl; i++) await pg.waitForTimeout(250);
  ok((await pos()).sl === newSl, `the SL moved in MT5 (${newSl})`);
  await pg.waitForFunction(id => /MT5 SL [\d.,]+ · TP [\d.,]+ ✓/.test(document.querySelector(`#posList .pos[data-id="${id}"] .mtline`).textContent), `P${tk}`, { timeout: 5000 });
  ok(true, "the panel shows MT5 has it (✓)");

  // ---- BE and TRAIL from the entry line's bar
  await ctl("/shift", { sym: "XAUUSD", by: 3 });
  await pg.waitForTimeout(1200);
  await pg.click(`#posbars .pbar[data-id="P${tk}"] [data-a="be"]`);
  await pg.waitForTimeout(3500);
  const be = await pg.evaluate(id => P.snap.positions.find(p => p.id === id).be, `P${tk}`);
  ok(Math.abs((await pos()).sl - be) < 1e-6, `BE on the bar: MT5's stop at break-even + commission (${be})`);
  await pg.evaluate(id => papi("pos_trail", {id, sl_r: 1}), `P${tk}`);
  await ctl("/shift", { sym: "XAUUSD", by: 9 });
  await pg.waitForTimeout(5000);
  ok((await pos()).sl > be, `TRAIL: MT5's stop trailed past BE (${(await pos()).sl})`);
  await pg.screenshot({ path: SHOT + "mt5acct_chart.png" });

  // ---- a pending order from MT5: moved, cancelled
  const q2 = (await ctl("/state")).quotes.XAUUSD;
  const ot = (await ctl("/pending", { sym: "XAUUSD", kind: "limit", side: 1, price: +(q2[0] - 20).toFixed(2), vol: 0.02, sl: +(q2[0] - 25).toFixed(2) })).ticket;
  await pg.waitForSelector(`#ordList .pos[data-id="O${ot}"]`, { timeout: 8000, state: "attached" });
  ok(/0\.02 lot/.test(await pg.textContent(`#ordList .pos[data-id="O${ot}"]`)), "a pending order placed in MT5 shows");
  await pg.evaluate(([id, px]) => papi("modify", {id, price: px}), [`O${ot}`, +(q2[0] - 18).toFixed(2)]);
  await pg.waitForTimeout(2500);
  const o1 = (await ctl("/state")).orders.find(o => o.ticket === ot);
  ok(o1 && o1.price === +(q2[0] - 18).toFixed(2) && o1.sl === +(q2[0] - 23).toFixed(2), "moved from the app: MT5's order price (and its SL with it)");
  await pg.evaluate(id => papi("cancel", {id}), `O${ot}`);
  await pg.waitForTimeout(2500);
  ok(!(await ctl("/state")).orders.some(o => o.ticket === ot) && !(await pg.$(`#ordList .pos[data-id="O${ot}"]`)), "cancelled from the app: gone in MT5 and here");

  // ---- Paper can't change MT5 trades (the server refuses)
  const r403 = await pg.evaluate(async id => { await api("/api/side", {body: {side: "paper"}});
    const r = await fetch("/api/paper/modify", {method: "POST", headers: {"Content-Type": "application/json", "X-Acct": "mt5-21182752"}, body: JSON.stringify({id, sl: 1})});
    return r.status; }, `P${tk}`);
  ok(r403 === 403, "a page on Paper can't change an MT5 account (403)");
  await pg.evaluate(() => { window._s = stepUp(() => api("/api/side", {body: {side: "mt5"}})); }); await pg.waitForTimeout(300); await code(pg);
  await pg.waitForFunction(() => window._s, null, { timeout: 5000 });

  // ---- ✕ closes it in MT5
  const bal0 = (await ctl("/state")).balance;
  await pg.click(`#posbars .pbar[data-id="P${tk}"] [data-a="close"]`);
  for(let i = 0; i < 20 && await pos(); i++) await pg.waitForTimeout(250);
  ok(!(await pos()), "✕ on the bar: closed in MT5");
  await pg.waitForFunction(id => !P.snap.positions.some(p => p.id === id), `P${tk}`, { timeout: 5000 });

  // ---- History
  await pg.evaluate(() => pgShow("history"));
  await pg.waitForTimeout(1500);
  const hist = await pg.evaluate(async () => (await api("/api/paper/history")).rows);
  const mine = hist.find(h => h.ticket === tk);
  ok(mine && mine.reason === "manual" && Math.abs(mine.net - (mine.gross - mine.charges.total)) < 1e-6 && mine.charges.commission === 0.6, `the close booked from MT5's deal: net $${mine && mine.net} = profit − commission 0.60`);
  ok(Math.abs(((await ctl("/state")).balance - bal0) - (mine.gross - 0.3)) < 0.02, "... matching MT5's balance change");
  ok(hist.filter(h => h.from_history).length >= 2, "MT5's own history (2 trades closed 10 days ago) is there too");
  const htxt = await pg.textContent("#pg_history");
  ok(/\$/.test(htxt) && /MT5/.test(htxt), "the History page in $, MT5's trades tagged");
  await pg.screenshot({ path: SHOT + "mt5acct_history.png" });

  // ---- the Account page
  await pg.evaluate(() => pgShow("account")); await pg.waitForTimeout(800);
  const at = await pg.textContent("#pg_account");
  ok(/MT5 21182752/.test(at) && /FundingPips' loss limits/.test(at) && /Today's start \(broker's midnight\)/.test(at), "the Account page of the MT5 account: FundingPips' limits");
  ok(/XAUUSD/.test(at) && /\$3\.00/.test(at), "the commission learned from MT5's deals ($3.00 a lot each way on XAUUSD)");
  await pg.fill('#mtRules [data-k="size"]', "6000"); await pg.click("#mtRulesSave"); await pg.waitForTimeout(800);
  ok(await pg.evaluate(() => P.snap.rules.size === 6000 && P.snap.acct.max_floor === 5400), "the starting size typed: max floor 5,400");
  await pg.fill('#mtRules [data-k="size"]', "5000"); await pg.click("#mtRulesSave"); await pg.waitForTimeout(800);
  await pg.screenshot({ path: SHOT + "mt5acct_account.png", fullPage: true });
  await pg.evaluate(() => pgShow("chart"));
  await pg.evaluate(() => openDrawer()); await pg.waitForTimeout(600);
  ok(/Starting size/.test(await pg.textContent("#rulesForm")) && !/square-off/i.test(await pg.textContent("#rulesForm")), "Settings' rules: the MT5 account's own limits (no Fyers square-off)");
  await pg.click("#bClose");

  // ---- back to PAPER
  await pg.click('#sideSw [data-s="paper"]'); await pg.waitForTimeout(1500);
  ok(await pg.evaluate(() => S.side === "paper" && P.snap.mode === "paper" && !document.body.classList.contains("is-mt5") && /₹/.test(document.querySelector("#acct").textContent)),
     "PAPER again: paper accounts, ₹");

  // ---- the phone
  const ph = await (await br.newContext({ ...devices["Pixel 7"] })).newPage();
  ph.on("pageerror", e => { errs.push("phone: " + e.message); });
  await ph.goto("http://localhost:8766/"); await LOGIN(ph);
  await ph.waitForSelector("#mSide", { timeout: 15000 });
  await ph.click("#mSide");
  ok(await ph.evaluate(() => [...document.querySelectorAll("#mSideMenu button")].map(b => b.textContent).join(",") === "PAPER,LIVE,MT5"), "phone: the side button opens PAPER / LIVE / MT5");
  await ph.click('#mSideMenu [data-s="mt5"]'); await ph.waitForSelector("#mtSideDlg:not(.hide) #mtsGo");
  await ph.click("#mtsGo"); await ph.waitForTimeout(400); await code(ph);
  await ph.waitForFunction(() => S.side === "mt5" && P.snap && P.snap.mode === "mt5", null, { timeout: 15000 });
  ok(await ph.evaluate(() => document.querySelector("#mSide").textContent === "MT5"), "phone: on MT5");
  await ph.click("#mAcct"); await ph.waitForTimeout(500);
  ok(/Your MT5 accounts/.test(await ph.textContent("body")) && /21182752 · FundingPips-SIM1 · DEMO/.test(await ph.textContent("body")), "phone: the account sheet lists the MT5 accounts");
  await ph.screenshot({ path: SHOT + "mt5acct_phone.png" });
  await ph.evaluate(() => api("/api/side", {body: {side: "paper"}}));

  ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
  await br.close(); ea.kill();
})().catch(async e => { ok(false, "crashed: " + e.message); try{ await br.close(); }catch(x){} if(ea) ea.kill(); });
