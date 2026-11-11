// v0.39.0 (roadmap 8 c1): MT5 trades in the journal, in the browser, with a fake MT5 terminal (tests/fake_mt5.py --history
// --ctl 8769): MT5's own history and a trade placed and closed in MT5 arrive in the Journal on their own; money in $ with the
// MT5 badge, never mixed with ₹ (the ₹ Fyers | $ MT5 switch in the filters, Review and Copy for Gemini); the Today card of the
// MT5 account (the broker's day, FundingPips' day-start balance); Journal › Settings › MT5 accounts: the session day (broker /
// Indian) and the lockouts' switch (a fresh 2FA code each way): off = shown only, on = new MT5 orders refused, the header's
// pill; the CSV's Currency column; the replay of an MT5 trade from History; the phone. Needs the mock server and
// security_flow.js (2FA set up).
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
  ea.stderr.on("data", d => fs.writeSync(1, "  [fake MT5 err] " + d)); };
const code = async pg => { await pg.waitForTimeout(300); if(await pg.isVisible("#codeAsk:not(.hide) #caCode")){ await pg.fill("#caCode", await LOGIN.code(pg)); await pg.click("#caGo"); } };
const AID = "mt5-21182752";

(async () => {
  br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
  const errs = []; pg.on("pageerror", e => { errs.push(e.message); fs.writeSync(1, "PAGEERROR " + e.message + "\n"); });
  pg.on("console", m => { if(m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });
  pg.on("dialog", d => d.dismiss());
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.evaluate(() => api("/api/side", {body: {side: "paper"}}));
  await pg.evaluate(() => api("/api/journal/settings", {body: {rules: {dd_pct: 2, block_dd: true, block_afk: true, block_end: true}}}));
  await pg.evaluate(() => typeof jPrefSet === "function" && jPrefSet("curve", "bal"));     // (other suites leave it on P&L)

  // ---- the terminal and the MT5 side
  let k = (await pg.evaluate(() => api("/api/mt5/key", {body: {}}))).key;
  if(!k){ await pg.evaluate(() => { window._k = stepUp(() => api("/api/mt5/key", {body: {}})); }); await code(pg); await pg.waitForFunction(() => window._k); k = (await pg.evaluate(() => window._k)).key; }
  ok(/^ftm-/.test(k || ""), "a bridge key for the fake terminal");
  startEA(k);
  await pg.waitForFunction(async () => (await api("/api/accounts")).accounts.some(a => a.id === "mt5-21182752"), null, { timeout: 20000, polling: 500 });
  await pg.evaluate(() => refreshState()); await pg.waitForTimeout(500);
  await pg.click('#sideSw [data-s="mt5"]');
  await pg.waitForSelector("#mtSideDlg:not(.hide) #mtsGo"); await pg.click("#mtsGo"); await code(pg);
  await pg.waitForFunction(() => S.side === "mt5" && ACCT === "mt5-21182752" && P.snap && P.snap.mode === "mt5", null, { timeout: 15000 });
  ok(true, "on the MT5 side, account 21182752");
  await pg.evaluate(id => api("/api/journal/mt5", {body: {acct: id, day: "broker"}}), AID);   // (a re-run starts from the defaults)
  const blk = await pg.evaluate(id => api("/api/journal").then(j => (j.j.accounts.find(a => a.id === id) || {}).mt5), AID);
  if(blk && blk.block){ await pg.evaluate(id => { window._b = stepUp(() => api("/api/journal/mt5", {body: {acct: id, block: false}})); }, AID); await code(pg); await pg.waitForFunction(() => window._b); }

  // ---- a trade placed in MT5, closed at a loss in MT5
  await ctl("/jitter", { on: false });
  const q = (await ctl("/state")).quotes.XAUUSD;
  const tk = (await ctl("/open", { sym: "XAUUSD", side: 1, vol: 0.10, sl: +(q[0] - 8).toFixed(2), tp: +(q[0] + 16).toFixed(2) })).ticket;
  await pg.waitForFunction(t => P.snap && P.snap.positions.some(p => p.ticket === t), tk, { timeout: 15000 });
  ok(true, "a trade placed in MT5 shows on the MT5 account");
  await pg.evaluate(() => pgShow("journal"));
  await pg.waitForFunction(t => JN.d && JN.d.trades.some(x => x.id === "mt5-21182752:P" + t && x.status === "open"), tk, { timeout: 15000 });
  ok(true, "... and is an open trade in the Journal at once");
  await ctl("/shift", { sym: "XAUUSD", by: -3 });
  await pg.waitForTimeout(600);
  await ctl("/close", { ticket: tk });
  await pg.waitForFunction(t => JN.d && JN.d.trades.some(x => x.id === "mt5-21182752:P" + t && x.status === "closed"), tk, { timeout: 20000 });
  const hist = await pg.evaluate(t => api("/api/paper/history").then(j => j.rows.find(h => h.ticket === t)), tk);
  const jt = await pg.evaluate(t => JN.d.trades.find(x => x.id === "mt5-21182752:P" + t), tk);
  ok(hist && jt && Math.abs(jt.net - hist.net) < 0.005 && jt.net < 0 && jt.cur === "USD" && jt.lots === 0.1 && jt.r != null,
     `closed in MT5 -> closed in the Journal: net ${jt && jt.net} = MT5's ${hist && hist.net} (commission + swap), ${jt && jt.r}R, 0.1 lot, USD`);
  ok(await pg.evaluate(() => JN.d.trades.filter(t => t.acct === "mt5-21182752" && t.status === "closed").length >= 3), "MT5's own history (2 trades 10 days back) is in the Journal too");

  // ---- one currency at a time
  await pg.waitForSelector("#jnList .jt-mt5");
  const cur = await pg.evaluate(() => ({on: [...document.querySelectorAll("#jfCur button")].map(b => b.textContent.trim() + (b.classList.contains("on") ? "*" : "")),
    list: document.querySelector("#jnList").textContent, strip: document.querySelector("#jnStrip").textContent, today: document.querySelector("#jnToday").textContent,
    note: document.querySelector("#jnNote").textContent}));
  ok(cur.on.length === 2 && /\$ MT5\*/.test(cur.on.join(" ")), `the filters' Money switch: ${cur.on.join(" | ")} ($ on the MT5 side)`);
  ok(/\$/.test(cur.list) && !/₹/.test(cur.list) && !/₹/.test(cur.strip) && /XAUUSD/.test(cur.list), "the list and the stats strip in $ only, no ₹");
  ok(/commission and swap/.test(cur.note), `the note: "${cur.note}"`);
  const sm = /Start \$([\d,.]+)/.exec(cur.strip);
  const pcts = await pg.evaluate(() => [...document.querySelectorAll("#jnStrip small")].map(x => x.textContent).filter(x => /%$/.test(x)).map(x => parseFloat(x)));
  ok(sm && +sm[1].replace(/,/g, "") > 4000 && pcts.every(p => p < 50), `the balance curve starts at MT5's balance ($${sm && sm[1]}), drawdown ${pcts.join(" / ")}% of it (not of $0)`);
  ok(/MT5 21182752/.test(cur.today) && /broker's day/.test(cur.today) && /\$/.test(cur.today) && !/₹/.test(cur.today), "Today: the MT5 account, the broker's day, in $");
  const card = await pg.$(`#jnList [data-id="mt5-21182752:P${tk}"]`) || await pg.$(`#jnList .jt:has-text("XAUUSD")`);
  ok(!!card, "the MT5 trade's card (MT5 badge)");
  await pg.screenshot({ path: SHOT + "mt5journal_usd.png" });
  await pg.click('#jfCur [data-c="INR"]');
  await pg.waitForTimeout(300);
  const inr = await pg.evaluate(() => ({list: document.querySelector("#jnList").textContent, mt: document.querySelectorAll("#jnList .jt-mt5").length,
    today: document.querySelector("#jnToday").textContent, accts: [...document.querySelectorAll("#jfAcct option")].map(o => o.textContent)}));
  ok(inr.mt === 0 && !/\$/.test(inr.list) && !/MT5/.test(inr.today) && !inr.accts.some(a => /MT5/.test(a)),
     "₹ Fyers: no MT5 trade, no $, the Today card and the account filter on Fyers accounts only");
  await pg.click('#jfCur [data-c="USD"]');
  await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => [...document.querySelectorAll("#jfAcct option")].some(o => /MT5 21182752/.test(o.textContent))), "$ MT5: the account filter lists the MT5 account");

  // ---- Insights and Review stay in $
  await pg.click('#jnSub [data-v="insights"]'); await pg.waitForTimeout(500);
  const ins = await pg.textContent("#jnBody");
  ok(/\$/.test(ins) && !/₹/.test(ins), "Insights in $ only");
  await pg.click('#jnSub [data-v="review"]'); await pg.waitForTimeout(500);
  ok(await pg.isVisible("#jiRvCur") && !/₹/.test(await pg.textContent("#jiRvBody")) && /\$/.test(await pg.textContent("#jiRvBody")), "Review: the ₹ | $ switch, in $");
  await pg.evaluate(() => jiAiOpen("thisweek")); await pg.waitForTimeout(300);
  const ai = await pg.inputValue("#jiAiText");
  ok(/FundingPips/.test(ai) && /MT5/.test(ai) && !/₹/.test(ai), "Copy for Gemini: the MT5 trades in $, said to be FundingPips' (net of commission and swap)");
  await pg.evaluate(() => jiAiClose());

  // ---- Settings › MT5 accounts: the session day
  await pg.click('#jnSub [data-v="settings"]');
  await pg.waitForSelector("#jnMt5Set .jn-mt5row");
  ok(/MT5 21182752/.test(await pg.textContent("#jnMt5Set")), "Settings: an MT5 accounts card with 21182752");
  await pg.selectOption(`#jnMt5Set [data-acct="${AID}"] [data-mtday]`, "ist");
  await pg.waitForFunction(id => (JN.d.accounts.find(a => a.id === id) || {}).mt5.day === "ist", AID, { timeout: 10000 });
  ok(true, "the session day set to the Indian day (saved on the server)");
  await pg.click('#jnSub [data-v="trades"]'); await pg.waitForTimeout(300);
  ok(/Indian day/.test(await pg.textContent("#jnToday")), "Today: the Indian day");
  await pg.click('#jnSub [data-v="settings"]'); await pg.waitForSelector("#jnMt5Set");
  await pg.selectOption(`#jnMt5Set [data-acct="${AID}"] [data-mtday]`, "broker");
  await pg.waitForFunction(id => (JN.d.accounts.find(a => a.id === id) || {}).mt5.day === "broker", AID, { timeout: 10000 });

  // ---- the lockouts' switch (2FA each way)
  await pg.evaluate(() => api("/api/journal/settings", {body: {rules: {dd_pct: 0.001}}}));   // (today's MT5 loss passes the line)
  await pg.evaluate(() => jnLoad()); await pg.waitForTimeout(600);
  await pg.click('#jnSub [data-v="trades"]'); await pg.waitForTimeout(300);
  const t1 = await pg.textContent("#jnToday");
  ok(/Locked out/.test(t1) && /lockouts are off for this MT5 account/.test(t1), "switch off: Today shows the 2% lockout, not blocking");
  const order = async () => { const q2 = (await ctl("/state")).quotes.XAUUSD;        // (a preview: the guards, nothing sent)
    return pg.evaluate(sl => api("/api/paper/preview", {body: {s: "MT5:XAUUSD", side: 1, type: "market", mode: "lots", lots: 0.01, sl}}), +(q2[0] - 2).toFixed(2)); };
  let pl = await order();
  ok(pl.ok && !/journal/i.test(pl.plan.blocked || ""), `... and the journal doesn't refuse a new order (${(pl.plan && pl.plan.blocked || "not blocked").slice(0, 60)})`);
  await pg.click('#jnSub [data-v="settings"]'); await pg.waitForSelector("#jnMt5Set");
  await pg.click(`#jnMt5Set [data-acct="${AID}"] [data-mtblock]`);
  await pg.waitForTimeout(500);
  const asked = await pg.isVisible("#codeAsk:not(.hide)");
  await code(pg);
  await pg.waitForFunction(id => (JN.d.accounts.find(a => a.id === id) || {}).mt5.block === true, AID, { timeout: 10000 });
  ok(true, "switched on (saved on the server)" + (asked ? ", after a fresh 2FA code" : " (the 2FA code from going to MT5 was still fresh: 5 minutes)"));
  pl = await order();
  ok(pl.ok && /Blocked by your journal \(Pillar 4\)/.test(pl.plan.blocked || ""), `switch on: a new MT5 order is refused (${(pl.plan && pl.plan.blocked || "").slice(0, 70)})`);
  await pg.waitForFunction(() => { const e = document.querySelector("#pJLock"); return e && !e.classList.contains("hide") && /2% lockout/.test(e.textContent) && !/· off/.test(e.textContent); }, null, { timeout: 8000 }).catch(() => {});
  ok(await pg.evaluate(() => { const e = document.querySelector("#pJLock"); return e && /2% lockout/.test(e.textContent) && !/· off/.test(e.textContent) && /new orders refused/.test(e.title); }), "the header's pill: 2% lockout (blocking)");
  await pg.screenshot({ path: SHOT + "mt5journal_locked.png" });
  const audit = await pg.evaluate(() => api("/api/security").then(j => j.audit.map(a => a.event || a.what || JSON.stringify(a)).join(" | ")));
  ok(/Journal lockouts on MT5 on/.test(audit), "in the security log");
  await pg.click('#jnSub [data-v="settings"]'); await pg.waitForSelector("#jnMt5Set");
  await pg.click(`#jnMt5Set [data-acct="${AID}"] [data-mtblock]`);
  await code(pg);
  await pg.waitForFunction(id => (JN.d.accounts.find(a => a.id === id) || {}).mt5.block === false, AID, { timeout: 10000 });
  ok(true, "turning it off again (2FA): off");
  await pg.evaluate(() => api("/api/journal/settings", {body: {rules: {dd_pct: 2}}}));

  // ---- CSV and the replay of an MT5 trade from History
  const csv = await pg.evaluate(() => fetch("/api/journal/export.csv").then(r => r.ok ? r.text() : "")).catch(() => "");
  ok(/Currency/.test(csv.split("\n")[0]) && /,USD,/.test(csv), "the CSV has a Currency column (USD for MT5)");
  const rk = await pg.evaluate(t => { const h = {id: "P" + t, pid_mt: t}; return rpKeyOf(h); }, tk);
  ok(rk === "mt5-21182752:P" + tk, `History's ▶ On chart finds the MT5 trade's journal entry (${rk})`);
  const rv = await pg.evaluate(k => api("/api/journal/replay?id=" + encodeURIComponent(k)), rk);
  ok(rv && rv.ok && rv.cur === "USD" && rv.trade && rv.trade.s === "MT5:XAUUSD" && rv.row && rv.row.tick, "the replay's data: USD, the MT5 symbol, its contract row");

  // ---- v0.39.1: the trade's candles kept on the server; its replay with MT5 off (and Fyers logged out)
  const key9 = "mt5-21182752:P" + tk;
  await pg.waitForFunction(async k => { const j = await api("/api/journal"); const t = j.j.trades.find(x => x.id === k);
    return t && t.kept && t.kept.res && t.kept.res["1"] > 0; }, key9, { timeout: 180000, polling: 2000 }).catch(() => {});
  await pg.evaluate(() => { JN.cur = "USD"; jnLoad(); }); await pg.waitForTimeout(800);
  await pg.click('#jnSub [data-v="trades"]'); await pg.waitForTimeout(300);
  await pg.click(`.jt-row[data-id="${key9}"]`).catch(() => {});
  await pg.waitForTimeout(400);
  const kt = await pg.evaluate(k => { const e = document.querySelector(`[data-id="${k}"]`), t = JN.d.trades.find(x => x.id === k);
    return (e ? e.closest(".jn-trade, .jt").textContent : "") || (t ? "Replay candles " + jKept(t).replace(/<[^>]+>/g, "") : ""); }, key9);
  ok(/Replay candles\s*kept on the server/.test(kt) && /1m [\d,]+/.test(kt), `the trade's card: its candles kept on the server (${(/kept on the server[^)]*\)/.exec(kt) || [""])[0]})`);
  ea.kill(); ea = null;
  await pg.waitForTimeout(10000);                                 // (MT5 counts as off after 8 s without a call)
  await pg.evaluate(k => rpOpen(k), key9);
  await pg.waitForSelector("#rpWrap iframe", { timeout: 5000 });
  const fr = () => pg.frames().find(f => /[?&]replay=/.test(f.url()));
  for(let i = 0; i < 40 && !fr(); i++) await pg.waitForTimeout(250);
  const F = fr();
  const ready = async (n = 60) => { for(let i = 0; i < n; i++){ try{ const x = await F.evaluate(() => window.rpTest && rpTest.info()); if(x && !x.loading && x.raw > 0) return x; }catch(e){} await pg.waitForTimeout(500); } return null; };
  let RI = await ready();
  ok(RI && RI.s === "MT5:XAUUSD" && RI.raw > 0, `▶ On chart of the MT5 trade with MT5 off: its candles load (${RI && RI.raw} candles, ${RI && RI.tf})`);
  await F.evaluate(() => { S.fyers = {...(S.fyers || {}), logged_in: false}; loadHistory(); });
  await pg.waitForTimeout(500);
  RI = await ready();
  const fm = await F.evaluate(() => document.querySelector("#chartMsg").textContent);
  ok(RI && RI.raw > 0 && !/Log in to Fyers/.test(fm), "... also with Fyers logged out (an MT5 trade doesn't need Fyers)");
  const playBtn = await F.evaluate(() => { try{ return document.querySelector('#rpBar [data-a="play"]') ? "ok" : "no"; }catch(e){ return String(e); } });
  if(playBtn === "ok"){ await F.click('#rpBar [data-a="play"]');
    for(let i = 0; i < 30 && !(await F.evaluate(() => rpTest.info().steps)); i++) await pg.waitForTimeout(500); }
  const pi = await F.evaluate(() => rpTest.info());
  const toasts = await F.evaluate(() => [...document.querySelectorAll(".toast")].map(t => t.textContent).join(" | ") + " / " + document.querySelector("#chartMsg").textContent);
  ok(playBtn === "ok" && pi && pi.steps > 0, `▶ Play runs from the kept 1-minute candles (${pi && pi.steps} steps${pi && pi.steps ? "" : "; " + toasts + " " + playBtn})`);
  await pg.screenshot({ path: SHOT + "mt5journal_replay.png" });
  await pg.evaluate(() => rpClose());

  // ---- the phone
  const ph = await (await br.newContext({ ...devices["Pixel 7"] })).newPage();
  ph.on("pageerror", e => { errs.push("phone: " + e.message); fs.writeSync(1, "PAGEERROR phone " + e.message + "\n"); });
  await ph.goto("http://localhost:8766/"); await LOGIN(ph);
  const nf = await ph.evaluate(id => api("/api/journal/mt5", {body: {acct: id, block: true}}), AID);
  ok(!nf.ok && nf.status === 428, `the switch needs a fresh 2FA code on the server (another login without one: ${nf.status})`);
  const nd = await ph.evaluate(id => api("/api/journal/mt5", {body: {acct: id, day: "broker"}}), AID);
  ok(nd.ok, "... the session day doesn't");
  await ph.evaluate(() => pgShow("journal"));
  await ph.waitForFunction(() => JN.d && document.querySelector("#jnList"), null, { timeout: 15000 });
  await ph.evaluate(() => { JN.cur = "USD"; jnRender(); }); await ph.waitForTimeout(400);
  const pm = await ph.evaluate(() => ({w: document.documentElement.scrollWidth, vw: innerWidth, mt: document.querySelectorAll("#jnList .jt-mt5").length,
    list: document.querySelector("#jnList").textContent}));
  ok(pm.mt > 0 && /\$/.test(pm.list) && !/₹/.test(pm.list) && pm.w <= pm.vw + 1, `the phone: MT5 trades in $, nothing wider than the screen (${pm.w}/${pm.vw})`);
  await ph.click("#jnFtog").catch(() => {}); await ph.waitForTimeout(200);
  ok(await ph.isVisible("#jfCur"), "the phone: the Money switch in the filters");
  await ph.screenshot({ path: SHOT + "mt5journal_phone.png" });

  ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
  await pg.evaluate(() => api("/api/side", {body: {side: "paper"}}));
  await br.close(); if(ea) ea.kill();
})().catch(async e => { ok(false, "crashed: " + e.message); if(br) await br.close(); if(ea) ea.kill(); });
