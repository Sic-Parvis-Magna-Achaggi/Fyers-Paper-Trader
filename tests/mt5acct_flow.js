// MT5 accounts (roadmap 8 b, slice b1) in the browser: the PAPER | LIVE | MT5 switch (a 2FA code), the MT5 account in the
// switcher (login · server · DEMO · $ balance), its positions and pending orders straight from MT5 (a fake terminal,
// tests/fake_mt5.py with its control API), money in $, the trade's state at MT5 on the panel, no login prompt (v0.37.1), SL moves,
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
let br, ea, ea2;
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
  ok(/Every order you place here is real/.test(await pg.textContent("#mtSideDlg")), "the MT5 dialog explains it (managing real trades; placing comes next)");
  await pg.click("#mtsGo"); await pg.waitForTimeout(400); await code(pg);
  await pg.waitForFunction(() => S.side === "mt5" && ACCT === "mt5-21182752" && P.snap && P.snap.mode === "mt5", null, { timeout: 15000 });
  ok(await pg.evaluate(() => document.body.classList.contains("is-mt5") && document.querySelector('#sideSw [data-s="mt5"]').classList.contains("on")), "on MT5: the switch and the header in MT5's colour");
  const opt = await pg.evaluate(() => [document.querySelector("#acctSel").selectedOptions[0].textContent, document.querySelector("#acctSel").title]);
  ok(/● 21182752 · \$[\d,]+$/.test(opt[0]) && /FundingPips-SIM1 · DEMO · balance \$[\d,]+\.\d\d/.test(opt[1]), `the switcher: "${opt[0]}" (${opt[1].slice(0, 70)})`);
  const hb = await pg.evaluate(() => { const h = document.querySelector("#app > header"), w = document.querySelector("#mtWarn");
    return {h: h.scrollHeight - (w && !w.classList.contains("hide") ? w.offsetHeight : 0), kids: [...h.children].filter(c => c.offsetWidth).map(c => (c.id || c.className).slice(0, 12) + ":" + c.offsetWidth + "@" + c.offsetTop + "/" + c.offsetHeight).join(" ")}; });
  ok(hb.h < 70, "the top bar stays on one line at 1500 px on MT5" + (hb.h < 70 ? "" : ` (${hb.h}: ${hb.kids})`));
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

  // ---- the first change goes straight to MT5 (v0.37.1, owner 11 Nov: no login to type); an SL move reaches MT5
  const newSl = +(q[0] - 5).toFixed(2);
  await pg.evaluate(([id, sl]) => { window._m = papi("modify", {id, sl}); }, [`P${tk}`, newSl]);
  await pg.waitForTimeout(600);
  ok(!(await pg.isVisible("#mtConfDlg #mtcLogin")), "no login dialog: the change goes straight to MT5");
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
  await pg.waitForFunction(() => /Starting size/.test((document.querySelector("#rulesForm") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
  const rf = await pg.textContent("#rulesForm");
  ok(/Starting size/.test(rf) && !/square-off/i.test(rf), "Settings' rules: the MT5 account's own limits (no Fyers square-off)" + (/Starting size/.test(rf) ? "" : " [" + rf.slice(0, 120) + "]"));
  await pg.click("#bClose");

  // ---- b2: placing from the app (the chart tool, PLACE)
  await pg.evaluate(() => pgShow("chart"));
  await pg.evaluate(async () => { await openBySymbol("MT5:XAUUSD"); });
  await pg.waitForTimeout(1500);
  await pg.evaluate(() => { arm(1); P.T.mode = "lots"; P.T.lots = 0.03; P.T.slDist = 5; P.T.tpMode = "r"; P.T.tp_r = 2; renderTicket(); toolRedraw(); preview(0); });
  await pg.waitForFunction(() => P.plan && P.plan.lots === 0.03 && !P.plan.blocked && document.querySelector("#tPlace") && !document.querySelector("#tPlace").disabled,
    null, { timeout: 15000 }).catch(() => {});
  const pv = await pg.evaluate(() => ({lots: P.plan && P.plan.lots, blocked: P.plan && P.plan.blocked, risk: P.plan && P.plan.risk, sl: P.plan && P.plan.sl,
    btn: (document.querySelector("#tPlace") || {}).textContent, ccy: P.plan && P.plan.ccy, size: document.querySelector("#tkSizeUnit").textContent}));
  ok(pv.lots === 0.03 && !pv.blocked && /^MT5 PLACE/.test(pv.btn || "") && pv.ccy === "USD", `the chart tool on MT5: 0.03 lot, net risk $${pv.risk}, "${pv.btn}"`);
  ok(/0\.01 steps/.test(pv.size) && !(await pg.isVisible("#tProd")), "lots in MT5's 0.01 steps; no Fyers product on MT5");
  const pm = await pg.evaluate(() => ({per: P.plan && P.plan.per_move, entry: P.plan && P.plan.entry, sl: P.plan && P.plan.sl, risk: P.plan && P.plan.risk,
    txt: ((document.querySelector("#tkPv .mtper") || {}).textContent || "")}));
  ok(pm.per === 100 && /\$100 per 1\.00 move/.test(pm.txt) && Math.abs(pm.risk - ((pm.entry - pm.sl) * 100 * 0.03 + 6 * 0.03)) < 0.05,
     `v0.37.2: the preview's risk is MT5's (move x 100 oz x 0.03 + commission = $${pm.risk}); "${pm.txt}"`);
  const before = (await ctl("/state")).positions.length;
  await pg.click("#tPlace");
  for(let i = 0; i < 20 && (await ctl("/state")).positions.length === before; i++) await pg.waitForTimeout(250);
  const placed = (await ctl("/state")).positions.find(p => /^FTM /.test(p.comment));
  ok(placed && placed.vol === 0.03 && Math.abs(placed.sl - pv.sl) < 1e-6 && placed.tp > 0, `PLACE: the order is in MT5 with its real SL / TP (#${placed && placed.ticket}, SL ${placed && placed.sl})`);
  await pg.waitForFunction(t => P.snap.positions.some(p => p.ticket === t && !p.outside), placed && placed.ticket, { timeout: 8000 }).catch(() => {});
  ok(await pg.evaluate(t => { const p = P.snap.positions.find(x => x.ticket === t); return p && !p.outside && p.first_sl && p.init_risk > 0; }, placed && placed.ticket),
     "it shows as the app's trade, its planned stop as 1R");
  await pg.screenshot({ path: SHOT + "mt5acct_placed.png" });
  await pg.evaluate(() => { arm(-1); P.T.slDist = 5; renderTicket(); toolRedraw(); preview(0); });
  await pg.waitForFunction(() => P.plan && P.plan.side === -1, null, { timeout: 8000 }).catch(() => {});
  ok(/no hedging/.test(await pg.evaluate(() => P.plan && P.plan.blocked || "")), "no hedging: a SELL XAUUSD while long is blocked, with the reason");
  await pg.evaluate(() => disarm());

  // ---- b3: the news guard (a ForexFactory file the mock reads), the kill switch
  fs.writeFileSync((process.env.FYERS_HELPER_DATA || ".") + "/ff_test.json", JSON.stringify([
    {title: "Non-Farm Employment Change", country: "USD", date: new Date(Date.now() + 120000).toISOString(), impact: "High", forecast: "", previous: ""},
    {title: "German ifo", country: "EUR", date: new Date(Date.now() + 600000).toISOString(), impact: "Medium", forecast: "", previous: ""}]));
  await pg.evaluate(() => pgShow("account")); await pg.waitForTimeout(800);
  await pg.click("#mtNewsGo"); await pg.waitForTimeout(1500);
  ok(/Non-Farm Employment Change/.test(await pg.textContent("#pg_account")) && !/German ifo/.test(await pg.textContent("#pg_account")),
     "the Account page lists the high-impact news ahead (ForexFactory; medium impact left out)");
  await pg.selectOption('#mtRules [data-k="phase"]', "master"); await pg.click("#mtRulesSave"); await pg.waitForTimeout(800);
  await pg.evaluate(() => pgShow("chart"));
  await pg.evaluate(() => { arm(1); P.T.slDist = 5; renderTicket(); toolRedraw(); preview(0); });
  await pg.waitForFunction(() => P.plan && P.plan.blocked, null, { timeout: 8000 }).catch(() => {});
  ok(/FundingPips Master/.test(await pg.evaluate(() => P.plan && P.plan.blocked || "")), "Master: no opening within 5 min of high-impact USD news");
  ok(/Non-Farm/.test(await pg.textContent("#mtWarn")), "... and the warning under the top bar names it");
  await pg.evaluate(() => disarm());
  fs.writeFileSync((process.env.FYERS_HELPER_DATA || ".") + "/ff_test.json", "[]");
  await pg.evaluate(async () => { await api("/api/paper/rules", {body: {phase: "evaluation"}}); });
  ok(await pg.isVisible("#bKillMt5"), "KILL in the top bar on MT5");
  pg.once("dialog", d => d.accept());
  await pg.click("#bKillMt5");
  for(let i = 0; i < 20 && (await ctl("/state")).positions.length; i++) await pg.waitForTimeout(250);
  ok(!(await ctl("/state")).positions.length, "KILL: every position closed in MT5");
  await pg.waitForFunction(() => P.snap.mt5.halted, null, { timeout: 5000 }).catch(() => {});
  await pg.evaluate(() => { arm(1); P.T.slDist = 5; renderTicket(); toolRedraw(); preview(0); });
  await pg.waitForFunction(() => P.plan && P.plan.blocked, null, { timeout: 8000 }).catch(() => {});
  ok(/kill switch/.test(await pg.evaluate(() => P.plan && P.plan.blocked || "")), "... and new orders are paused");
  await pg.evaluate(() => disarm());
  await pg.evaluate(() => pgShow("account")); await pg.waitForTimeout(800);
  await pg.click("#mtResume"); await pg.waitForTimeout(400); await code(pg);
  await pg.waitForFunction(() => !P.snap.mt5.halted, null, { timeout: 8000 }).catch(() => {});
  ok(await pg.evaluate(() => !P.snap.mt5.halted), "Resume (a 2FA code): orders allowed again");
  await pg.evaluate(() => pgShow("chart"));

  // ---- v0.37.1: PLACE as the very first change on a brand-new account (a second terminal, a new login each run): straight to MT5
  await ctl("/shift", { sym: "XAUUSD", by: -12 });    // (terminal 1's gold back on the broker's price: the second terminal sees the same)
  const L2 = 30000000 + Math.floor(Math.random() * 9000000), CTL2 = "http://127.0.0.1:8770";
  ea2 = spawn("python3", [__dirname + "/fake_mt5.py", "http://localhost:8766", k, "--ctl", "8770", "--login", String(L2)], { stdio: ["ignore", "pipe", "pipe"] });
  ea2.stderr.on("data", d => fs.writeSync(1, "  [fake MT5 #2 err] " + d));
  for(let i = 0; i < 60 && !(await pg.evaluate(async l => (await api("/api/accounts")).accounts.some(a => a.id === "mt5-" + l), L2)); i++) await pg.waitForTimeout(500);
  await pg.evaluate(async l => { await acctRefresh(); acctSwitch("mt5-" + l); }, L2); await pg.waitForTimeout(1500);
  await pg.waitForFunction(l => P.snap && P.snap.mt5 && +P.snap.mt5.login === l, L2, { timeout: 8000 }).catch(() => {});
  const s2 = await pg.evaluate(() => ({acct: ACCT, login: P.snap && P.snap.mt5 && P.snap.mt5.login, conf: P.snap && P.snap.mt5 && P.snap.mt5.confirmed,
    list: mt5List().map(a => a.id).join(",")}));
  ok(+s2.login === L2 && s2.conf, `a second MT5 account (${L2}), ready to trade at once` + (+s2.login === L2 ? "" : " " + JSON.stringify(s2)));
  await pg.evaluate(() => { arm(1); P.T.mode = "lots"; P.T.lots = 0.01; P.T.slDist = 5; P.T.tpMode = "r"; P.T.tp_r = 2; renderTicket(); toolRedraw(); preview(0); });
  await pg.waitForFunction(() => P.plan && P.plan.lots === 0.01 && !P.plan.blocked && document.querySelector("#tPlace") && !document.querySelector("#tPlace").disabled,
    null, { timeout: 20000, polling: 500 }).catch(() => {});
  await pg.click("#tPlace");
  await pg.waitForTimeout(600);
  ok(!(await pg.isVisible("#mtConfDlg #mtcLogin")) && !/type its login/.test(await pg.evaluate(() => (document.querySelector("#tkStatus") || {}).textContent || "")),
     "PLACE on a new account: no login dialog, no red line");
  let st2 = { positions: [] };
  for(let i = 0; i < 40 && !st2.positions.length; i++){ await pg.waitForTimeout(250); st2 = await (await fetch(CTL2 + "/state")).json(); }
  const d2 = await pg.evaluate(() => ({plan: P.plan && {lots: P.plan.lots, blocked: P.plan.blocked, err: P.plan.error}, st: (document.querySelector("#tkStatus") || {}).textContent,
    acct: ACCT, opening: P.snap && P.snap.mt5 && P.snap.mt5.opening, ev: (P.snap && P.snap.events || []).slice(-3)}));
  ok(st2.positions.length === 1 && st2.positions[0].vol === 0.01 && /^FTM /.test(st2.positions[0].comment), "... the order is in MT5" + (st2.positions.length ? "" : " " + JSON.stringify(d2).slice(0, 600)));
  await pg.evaluate(() => disarm());
  await fetch(CTL2 + "/close", { method: "POST", body: JSON.stringify({ ticket: st2.positions[0] && st2.positions[0].ticket }) }).catch(() => {});
  ea2.kill();

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
})().catch(async e => { ok(false, "crashed: " + e.message); try{ await br.close(); }catch(x){} if(ea) ea.kill(); if(ea2) ea2.kill(); });
