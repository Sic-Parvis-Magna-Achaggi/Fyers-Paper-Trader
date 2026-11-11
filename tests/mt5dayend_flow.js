// v0.40.0: the day-end close of MT5 accounts in the browser, with a fake MT5 terminal (tests/fake_mt5.py --ctl 8769): the
// Account page's four rules (on, minutes, every day / Fridays, all / marked trades) saved; the footer's day-end line; the
// ticket's "At the day end" and the chart tool's DAY END / HOLD (marked trades), saved as the default and sent with the order's
// preview; a trade placed in MT5 taking the default; ⏱ on the trade's line toggling it at the server; "all trades": the
// switch fixed on Close and no per-trade marks; the phone's trade sheet and order sheet. (The closing itself, at the broker's
// day end, is checked in tests/mt5acct_test.py with a controlled clock.) Needs the mock server and security_flow.js.
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
const startEA = key => { ea = spawn("python3", [__dirname + "/fake_mt5.py", "http://localhost:8766", key, "--ctl", "8769"], { stdio: ["ignore", "pipe", "pipe"] });
  ea.stderr.on("data", d => fs.writeSync(1, "  [fake MT5 err] " + d)); };
const code = async pg => { await pg.waitForTimeout(300); if(await pg.isVisible("#codeAsk:not(.hide) #caCode")){ await pg.fill("#caCode", await LOGIN.code(pg)); await pg.click("#caGo"); } };
const toMt5 = async pg => {
  await pg.evaluate(() => refreshState()); await pg.waitForTimeout(500);
  if(await pg.evaluate(() => S.side === "mt5")) return;
  if(await pg.isVisible('#sideSw [data-s="mt5"]')) await pg.click('#sideSw [data-s="mt5"]');
  else { await pg.click("#mSide"); await pg.click('#mSideMenu [data-s="mt5"]'); }
  await pg.waitForSelector("#mtSideDlg:not(.hide) #mtsGo"); await pg.click("#mtsGo"); await code(pg);
  await pg.waitForFunction(() => S.side === "mt5" && P.snap && P.snap.mode === "mt5" && !P.snap.mt5.none, null, { timeout: 20000 });
};

(async () => {
  br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
  const errs = []; pg.on("pageerror", e => { errs.push(e.message); fs.writeSync(1, "PAGEERROR " + e.message + "\n"); });
  pg.on("dialog", d => d.dismiss());
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.evaluate(() => api("/api/side", {body: {side: "paper"}}));
  let k = (await pg.evaluate(() => api("/api/mt5/key", {body: {}}))).key;
  if(!k){ await pg.evaluate(() => { window._k = stepUp(() => api("/api/mt5/key", {body: {}})); }); await code(pg); await pg.waitForFunction(() => window._k); k = (await pg.evaluate(() => window._k)).key; }
  startEA(k);
  await pg.waitForFunction(async () => (await api("/api/accounts")).accounts.some(a => a.id === "mt5-21182752"), null, { timeout: 20000, polling: 500 });
  await toMt5(pg);
  await ctl("/jitter", { on: false });
  ok(true, "on the MT5 side");

  // ---- the rules (Account page)
  await pg.evaluate(() => pgShow("account"));
  await pg.waitForSelector('#mtRules [data-k="dayend_on"]');
  const rl = await pg.evaluate(() => ["dayend_on", "dayend_min", "dayend_when", "dayend_scope"].every(k => document.querySelector(`#mtRules [data-k="${k}"]`)));
  ok(rl, "Account › rules: Day-end close, minutes, when, which trades");
  ok(await pg.evaluate(() => document.querySelector('#mtRules [data-k="dayend_on"]').value === "false"), "... off at first");
  await pg.selectOption('#mtRules [data-k="dayend_on"]', "true");
  await pg.fill('#mtRules [data-k="dayend_min"]', "7");
  await pg.selectOption('#mtRules [data-k="dayend_when"]', "day");
  await pg.selectOption('#mtRules [data-k="dayend_scope"]', "marked");
  await pg.click("#mtRulesSave");
  await pg.waitForFunction(() => P.snap.rules.dayend_on === true && P.snap.rules.dayend_min === 7 && P.snap.rules.dayend_scope === "marked" && P.snap.mt5.dayend, null, { timeout: 8000 });
  ok(true, "saved on the server: on, 7 min, every day, marked trades");
  const de = await pg.evaluate(() => P.snap.mt5.dayend);
  ok(/^0[23]:2[23]$/.test(de.at_ist), `the time: 7 min before the broker's midnight = ${de.at_ist} IST`);
  await pg.evaluate(() => pgShow("chart")); await pg.waitForTimeout(500);
  const foot = await pg.textContent("#mtFoot");
  ok(new RegExp(`Day-end close 7 min before each symbol's trading ends \\(its sessions in MT5; ${de.at_ist} IST at the latest; trades marked to close\\)`).test(foot) && de.sessions,
     `the panel's footer (EA 1.23's sessions known): ${(/Day-end close[^·]*/.exec(foot) || [""])[0]}`);

  // ---- the ticket and the chart tool (marked trades)
  await pg.evaluate(async () => { await openBySymbol("MT5:XAUUSD"); });
  await pg.waitForFunction(() => cur && cur.s === "MT5:XAUUSD" && last["MT5:XAUUSD"], null, { timeout: 20000 });
  await pg.click("#bBuy");
  await pg.waitForSelector("#mtDeBox:not(.hide) #mtDeSel");
  ok(await pg.evaluate(() => $("#mtDeSel").value === "0" && !$("#mtDeSel").disabled), "the ticket: At the day end: Hold (the default)");
  await pg.waitForSelector("#tDayEnd");
  ok(/HOLD/.test(await pg.textContent("#tDayEnd")), "the chart tool: HOLD next to PLACE");
  await pg.click("#tDayEnd");
  await pg.waitForFunction(() => P.snap.ticket.dayend === true, null, { timeout: 8000 });
  ok(await pg.evaluate(() => /DAY END/.test($("#tDayEnd").textContent) && $("#mtDeSel").value === "1"), "a click: DAY END, the ticket follows, saved as the default");
  await pg.waitForTimeout(800);
  const pv = await pg.evaluate(() => api("/api/paper/preview", {body: ticketBody()}));
  ok(pv.ok && (pv.plan.notes || []).some(n => new RegExp("closed at the day end").test(n)), `the order's preview says it's closed at the day end (${(pv.plan.notes || []).join("; ").slice(0, 90)})`);
  await pg.screenshot({ path: SHOT + "mt5dayend_ticket.png" });
  await pg.click("#tDayEnd");
  await pg.waitForFunction(() => P.snap.ticket.dayend === false, null, { timeout: 8000 });
  await pg.selectOption("#mtDeSel", "1");
  await pg.waitForFunction(() => P.snap.ticket.dayend === true, null, { timeout: 8000 });
  ok(true, "the ticket's switch changes it too");
  await pg.evaluate(() => disarm());

  // ---- a trade placed in MT5 takes the default; ⏱ on its line
  const q = (await ctl("/state")).quotes.XAUUSD;
  const tk = (await ctl("/open", { sym: "XAUUSD", side: 1, vol: 0.01, sl: +(q[0] - 8).toFixed(2) })).ticket;
  await pg.waitForFunction(t => P.snap.positions.some(p => p.ticket === t), tk, { timeout: 15000 });
  const pid = "P" + tk;
  await pg.waitForSelector(`#posList .pos[data-id="${pid}"] .mtde`);
  const gt = await pg.textContent(`#posList .pos[data-id="${pid}"] .mtde`), gp = await pg.evaluate(id => P.snap.positions.find(p => p.id === id).dayend_at, pid);
  const [mh, mm] = de.at_ist.split(":").map(Number), exp = new Date(Date.UTC(2000, 0, 1, mh, mm - 3)).toISOString().slice(11, 16);   // gold stops at 23:57: 3 min before the midnight
  ok(/closes at/.test(gt) && (gp === exp || gp === "not today") && (gp === "not today" || gt.includes(exp)),
     `a trade placed in MT5 takes the default: ${gt} (gold's own end, 23:57 broker time, − 7 min = ${exp})`);
  await pg.click(`#posList .pos[data-id="${pid}"] .mtde`);
  await pg.waitForFunction(id => P.snap.positions.find(p => p.id === id).dayend === false, pid, { timeout: 8000 });
  ok(/held over/.test(await pg.textContent(`#posList .pos[data-id="${pid}"] .mtde`)), "⏱ clicked: held over the day end (at the server)");
  await pg.evaluate(() => pgShow("trades")); await pg.waitForTimeout(600);
  ok(await pg.$(`#pgPos tr[data-id="${pid}"] .mtde`) !== null, "the Trades page shows it too");
  await pg.evaluate(() => pgShow("chart"));
  await pg.screenshot({ path: SHOT + "mt5dayend_panel.png" });

  // ---- "all trades": no choice per trade
  await pg.evaluate(() => api("/api/paper/rules", {body: {dayend_scope: "all"}}).then(j => j.paper && paperUpdate(j.paper)));
  await pg.waitForTimeout(800);
  await pg.click("#bBuy"); await pg.waitForSelector("#tDayEnd");
  ok(await pg.evaluate(() => $("#mtDeSel").disabled && $("#mtDeSel").value === "1" && /DAY END/.test($("#tDayEnd").textContent)
     && !document.querySelector("#posList button.mtde") && document.querySelector("#posList span.mtde.fixed")),
     "all trades: the switch fixed on Close, DAY END on the tool, each trade shows its time (nothing to click)");
  await pg.evaluate(() => disarm());
  await pg.evaluate(() => api("/api/paper/rules", {body: {dayend_scope: "marked"}}).then(j => j.paper && paperUpdate(j.paper)));

  // ---- the phone
  const ph = await (await br.newContext({ ...devices["Pixel 7"] })).newPage();
  ph.on("pageerror", e => { errs.push("phone: " + e.message); });
  await ph.goto("http://localhost:8766/"); await LOGIN(ph);
  await ph.waitForSelector("#mSide", { timeout: 15000 });
  await toMt5(ph);
  await ph.evaluate(id => mPosSheet(id), pid); await ph.waitForTimeout(400);
  ok(await ph.isVisible("#mSheet .mtde-row"), "phone: the trade's sheet has At the day end");
  await ph.click('#mSheet [data-g="mtde"] button[data-v="1"]');
  await ph.waitForFunction(id => P.snap.positions.find(p => p.id === id).dayend === true, pid, { timeout: 8000 });
  ok(true, "phone: Close it, saved at the server");
  await ph.screenshot({ path: SHOT + "mt5dayend_phone.png" });
  await ph.evaluate(() => api("/api/side", {body: {side: "paper"}}));

  // ---- off again, the trade closed
  await pg.evaluate(() => api("/api/paper/rules", {body: {dayend_on: false, dayend_scope: "all", dayend_min: 5}}).then(j => j.paper && paperUpdate(j.paper)));
  await pg.evaluate(() => api("/api/paper/ticket", {body: {dayend: false}}));
  await pg.waitForTimeout(800);
  ok(await pg.evaluate(() => !P.snap.mt5.dayend && !/Day-end/.test($("#mtFoot").textContent) && !document.querySelector("#posList .mtde")), "off: no day-end line, no marks");
  await ctl("/close", { ticket: tk });
  ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
  await pg.evaluate(() => api("/api/side", {body: {side: "paper"}}));
  await br.close(); if(ea) ea.kill();
})().catch(async e => { ok(false, "crashed: " + e.message); try{ await br.close(); }catch(x){} if(ea) ea.kill(); });
