// Journal v0.28.0 in a browser: Insights (KPIs, equity curve and drawdown, performance, rep blocks, discipline and
// lockout tables, time of day, weekday, contract...), following the filters; the weekly Review (KPIs, scorecard, day by
// day, the outcome × process grid, the reflection saved on the server and its summary posted to Telegram then edited);
// the walk-through (pictures beside the reflection, ← →, saved); the calendar; Copy for Gemini (day, week, one trade,
// rules); Settings › Export and backup (CSV, backup zip, restore adds nothing twice); the focus on the Today card; the phone.
// Needs the mock server and an admin with 2FA (run security_flow.js first). Resets the admin's paper account.
const { chromium, devices } = require("playwright");
const LOGIN = require("./login.js");
const fs = require("fs"), { execSync } = require("child_process");
const D = process.env.FYERS_HELPER_DATA || ".";
const SHOT = D + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const CRUDE = "MCX:CRUDEOIL26NOVFUT";
const TG = "http://127.0.0.1:" + (process.env.FAKE_TELEGRAM_PORT || "8767");
const tgGet = async p => (await fetch(TG + p)).json();
let br;
(async () => {
  br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], {origin: "http://localhost:8766"});
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.waitForFunction(() => P.snap, null, { timeout: 20000 });
  await fetch(TG + "/_reset", {method: "POST"});
  await pg.evaluate(async () => {
    if(P.snap.mode === "live") throw new Error("the admin's account is Live - run live_flow.js to the end first");
    await papi("reset", {confirm: "RESET", capital: 1000000});
    await papi("trail", {be_on: false, sl_on: false});
    await api("/api/journal/settings", {body: {rules: {block_dd: false, block_afk: false, block_end: false}, shots: {auto: true, chart: false, tg: false}}});
    prefSet("jn", {});
  });
  await pg.evaluate(async c => { await openBySymbol(c); }, CRUDE);
  await pg.waitForFunction(() => cur && last[cur.s], null, { timeout: 20000 });
  const round = side => pg.evaluate(async side => { const l = last[cur.s];
    const j = await papi("place", {s: cur.s, side, type: "market", sl: Math.round(l.ltp - side * 30), tp: Math.round(l.ltp + side * 60), mode: "lots", lots: 1, product: "MARGIN"});
    if(!j.ok) return j.error; await new Promise(r => setTimeout(r, 700));
    for(const p of P.snap.positions) await papi("close", {id: p.id}); return "ok"; }, side);
  for(const s of [1, -1, 1]) ok(await round(s) === "ok", `a trade (${s > 0 ? "buy" : "sell"})`);
  await pg.waitForTimeout(4000);                         // the server pictures
  // audit one trade so the octagon grid has something
  const jd0 = await pg.evaluate(async () => (await api("/api/journal")).j);
  const mine = jd0.trades.filter(t => t.status === "closed").sort((a, b) => b.closed - a.closed).slice(0, 3);
  await pg.evaluate(async id => api("/api/journal/trade", {body: {id, direction: "Correct", wait: "Patient", execution: "Correct", zen: "Sanctuary", target: "Realistic", regime: "Trending", setup: ["BOS"]}}), mine[0].id);
  await pg.evaluate(async id => api("/api/journal/trade", {body: {id, direction: "Wrong", wait: "Impulsive", execution: "Wrong", execFaults: ["frontran"], zen: "Sanctuary", target: "Stretched"}}), mine[1].id);

  // ---- Insights
  await pg.click('#nav button[data-pg="journal"]');
  await pg.waitForSelector(".jn-trade", { timeout: 10000 });
  await pg.click('#jnSub button[data-v="insights"]');
  await pg.waitForSelector(".ji-kpis");
  const ins = await pg.textContent("#jnBody");
  ok(/Net P&L/.test(ins) && /Clean octagon/.test(ins) && await pg.$(".ji-eqsvg") && await pg.$(".ji-ddsvg"), "Insights: KPIs, the equity curve and its drawdown");
  ok(/Performance/.test(ins) && /Sharpe ratio/.test(ins) && /Profit factor/.test(ins) && /Charges/.test(ins), "Insights: the performance card (edge, risk-adjusted, drawdown, consistency)");
  ok(/Rep blocks/.test(ins) && /Octagon discipline/.test(ins) && /Lockouts/.test(ins) && /Time of day/.test(ins) && /Weekday/.test(ins) && /Contract/.test(ins) && /Setup/.test(ins),
     "Insights: rep blocks, Octagon discipline, lockouts, time of day, weekday, contract, setup");
  ok(await pg.isVisible("#jnFilters"), "the filters stay on Insights");
  const nAll = await pg.evaluate(() => jFiltered({ignoreOct: true}).length);
  await pg.evaluate(() => { jPrefSet("side", "buy"); jnFilters(); jnTrades(); });
  await pg.waitForTimeout(200);
  const kpiBuy = await pg.evaluate(() => jFiltered({ignoreOct: true}).filter(t => t.status === "closed").length);
  const shown = await pg.evaluate(() => [...document.querySelectorAll(".ji-kpi")].find(k => /Closed trades/.test(k.textContent)).querySelector("b").textContent);
  ok(Number(shown) === kpiBuy && kpiBuy < nAll, `Insights follow the filters (long only: ${shown} closed of ${nAll})`);
  await pg.evaluate(() => { jPrefSet("side", ""); jnFilters(); jnTrades(); });
  await pg.click('#jiCurve button[data-v="pl"]'); await pg.waitForTimeout(150);
  ok(await pg.evaluate(() => jPref().curve) === "pl", "Balance / P&L switch on the equity curve");
  await pg.screenshot({ path: SHOT + "jinsights.png", fullPage: true });

  // ---- Review: this week
  await pg.click('#jnSub button[data-v="review"]');
  await pg.waitForSelector("#jiRvWell");
  ok(!(await pg.isVisible("#jnFilters")), "Review has its own account choice (the filter bar hides)");
  const rvt = await pg.textContent("#jnBody");
  ok(/Week of/.test(rvt) && /The week at a glance/.test(rvt) && /Octagon scorecard/.test(rvt) && /Day by day/.test(rvt) && /This week's trades/.test(rvt), "Review: the week, KPIs, scorecard, day by day, the trades");
  ok(await pg.$$eval(".ji-quad", x => x.length) === 4, "the outcome × process grid (earned / lucky wins, good / earned losses)");
  ok(/Biggest leak|No pillar broken this week/.test(rvt), "the scorecard names the biggest leak");
  // reflection + Telegram summary
  const uid = await pg.evaluate(() => S.user.uid);
  execSync(`python3 -c "import sys; sys.path.insert(0, '.'); from helper import telegram, users; s = telegram.load('${uid}'); s['token'] = users.seal('1234567:abc'); s['bot'] = 'ftm_test_bot'; s['chat'] = '5550001'; telegram.save('${uid}', s)"`, {env: {...process.env, FYERS_HELPER_DATA: D}, cwd: __dirname + "/.."});
  await pg.evaluate(async () => { const j = await api("/api/journal/settings", {body: {shots: {tg: true, tg_chat: "-1009990001"}}}); jnMerge(j.j); jiReview(); });
  await pg.waitForSelector("#jiRvWell");
  await pg.fill("#jiRvWell", "Patient clicks"); await pg.fill("#jiRvBroke", "Front-ran once"); await pg.fill("#jiRvFocus", "Only from the Zen Temple");
  await pg.click("#jiRvSave"); await pg.waitForTimeout(1200);
  const wk = await pg.evaluate(() => JI.rv.week);
  let rv = (await pg.evaluate(async () => (await api("/api/journal")).j.reviews))[wk];
  ok(rv && rv.well === "Patient clicks" && rv.focus === "Only from the Zen Temple", "the review is saved on the server");
  let sent = (await tgGet("/_sent")).filter(m => /Weekly review/.test(m.text));
  ok(sent.length === 1 && /Front-ran once/.test(sent[0].text) && /net of all charges/.test(sent[0].text), "its summary is posted to the journal's Telegram chat");
  await pg.fill("#jiRvWell", "Patient clicks, banked at 1.5R"); await pg.click("#jiRvSave"); await pg.waitForTimeout(1200);
  sent = (await tgGet("/_sent")).filter(m => /Weekly review/.test(m.text));
  ok(sent.length === 1 && /banked at 1.5R/.test(sent[0].text) && sent[0].edited === 1, "saving again edits that same message");
  const sum = await pg.evaluate(() => jiRvSummary());
  ok(/🗓 Weekly review/.test(sum) && /Reps \d+/.test(sum) && /🎯 Focus next week: Only from the Zen Temple/.test(sum), "Copy summary: the week in a few lines");
  // the walk-through
  await pg.click('.ji-rvtabs button[data-rvf="all"]'); await pg.waitForTimeout(200);
  await pg.click(".ji-walkbar button");
  await pg.waitForSelector("#jiWalk #jiWRight");
  await pg.waitForFunction(() => { const i = document.querySelector("#jiWImg"); return i && i.complete && i.naturalWidth > 0; }, null, {timeout: 10000});
  const nWalk = await pg.evaluate(() => JI.walk.ids.length);
  const nWeek = await pg.evaluate(() => jiWeekStats(jiRvItems(), JI.rv.week).items.length);
  ok(new RegExp(`1 / ${nWalk}\\b`).test(await pg.textContent("#jiWalk .jn-mhead")) && nWalk === nWeek && nWalk >= 3,
     `walk-through: one trade at a time (1 / ${nWalk}, every trade of the week), its server picture beside the reflection`);
  await pg.fill("#jiWRight", "Waited for the close"); await pg.fill("#jiWLesson", "Same again");
  await pg.keyboard.press("Escape").catch(() => {});
  await pg.click("#jiWNext"); await pg.waitForTimeout(700);
  ok(new RegExp(`2 / ${nWalk}\\b`).test(await pg.textContent("#jiWalk .jn-mhead")), "› (and →) moves on, saving as it goes");
  const firstId = await pg.evaluate(() => JI.walk.ids[0]);
  let t0 = (await pg.evaluate(async () => (await api("/api/journal")).j.trades)).find(t => t.id === firstId);
  ok(t0.rvRight === "Waited for the close" && t0.review === "Same again" && t0.reviewedAt, "the reflection is saved on the trade");
  await pg.screenshot({ path: SHOT + "jinsights_walk.png" });
  await pg.click("#jiWClose"); await pg.waitForTimeout(500);
  ok(/✓ Reflected/.test(await pg.textContent("#jnBody")), "the trade shows as reflected in the review");
  // calendar
  await pg.click('#jiRvMode button[data-v="month"]'); await pg.waitForSelector(".ji-cal");
  const cells = await pg.$$eval(".ji-day[data-day]", x => x.length);
  ok(cells >= 1 && await pg.$$eval(".ji-calwk", x => x.length) >= 4, `the calendar: days with trades (${cells}) and a review button per week`);
  ok(await pg.$eval(".ji-calwk >> nth=0", el => el.textContent.length > 0), "weeks show their net and whether they're reviewed");
  await pg.screenshot({ path: SHOT + "jinsights_calendar.png" });
  await pg.click(".ji-day[data-day] >> nth=-1"); await pg.waitForTimeout(500);
  ok(await pg.evaluate(() => JN.sub) === "trades" && await pg.evaluate(() => jPref().period) === "custom", "a day in the calendar opens that day's trades");
  await pg.evaluate(() => { jPrefSet("period", "all"); jq("#jnFilters").dataset.built = ""; jnRender(); });

  // ---- Copy for Gemini
  await pg.click("#jnAiBtn"); await pg.waitForSelector("#jiAiText");
  let txt = await pg.inputValue("#jiAiText");
  ok(/# My trades — today/.test(txt) && /### Trade 1 of/.test(txt) && /Octagon:/.test(txt) && /net of every charge/.test(txt), "Copy for Gemini: today's trades with all 8 pillars, IST, net of charges");
  ok(/1\. .* — (held|BROKEN|not recorded)/.test(txt) && /Equity through the session/.test(txt), "each pillar's state, and the session's equity and lockouts");
  await pg.check("#jiAiRules"); await pg.waitForTimeout(100);
  txt = await pg.inputValue("#jiAiText");
  ok(/^# My Octagon framework/.test(txt) && /trailing drawdown lockout/.test(txt), "Start with my Octagon rules (remembered)");
  await pg.selectOption("#jiAiScope", "thisweek"); await pg.waitForTimeout(100);
  txt = await pg.inputValue("#jiAiText");
  ok(/the week of/.test(txt) && /## My weekly reflection/.test(txt) && /Only from the Zen Temple/.test(txt), "this week: the trades and your weekly reflection");
  await pg.click("#jiAiCopy"); await pg.waitForTimeout(300);
  ok(/Copied/.test(await pg.textContent("#jiAiCount")) && /My trades/.test(await pg.evaluate(() => navigator.clipboard.readText())), "Copy puts it on the clipboard");
  await pg.click("#jiAiClose");
  await pg.evaluate(() => { JN.sub = "trades"; jnRender(); });
  await pg.waitForSelector(".jn-trade");
  const tid = await pg.$eval(".jn-trade", el => el.dataset.id);
  await pg.click(`.jn-trade[data-id="${tid}"] .jt-row`);
  await pg.click(`.jn-trade[data-id="${tid}"] [data-act="ai"]`); await pg.waitForSelector("#jiAiText");
  txt = await pg.inputValue("#jiAiText");
  ok(/one trade/.test(txt) && (txt.match(/### Trade/g) || []).length === 1, "Copy for Gemini on a trade: just that trade");
  await pg.click("#jiAiClose");

  // ---- Today: this week's focus (from last week's review)
  const lastWk = await pg.evaluate(() => jAddDays(jiWeekStart(jTodayKey()), -7));
  await pg.evaluate(async w => { const j = await api("/api/journal/review", {body: {week: w, focus: "Bank at 1.5R"}}); JN.d.reviews = j.reviews; jnRender(); }, lastWk);
  await pg.waitForTimeout(300);
  ok(/This week's focus/.test(await pg.textContent("#jnToday")) && /Bank at 1.5R/.test(await pg.textContent("#jnToday")), "the Today card shows this week's focus");

  // ---- Settings › Export and backup
  await pg.click('#jnSub button[data-v="settings"]'); await pg.waitForSelector("#jiData #jiCsv");
  const csv = await pg.evaluate(async () => { const r = await fetch("/api/journal/export.csv"); return [r.status, r.headers.get("content-type"), await r.text()]; });
  const lines = csv[2].replace(/^﻿/, "").trim().split(/\r\n/);
  const nTr = (await pg.evaluate(async () => (await api("/api/journal")).j.trades.length));
  ok(csv[0] === 200 && /text\/csv/.test(csv[1]) && /^Rep,Account,Mode,Contract/.test(lines[0]) && lines.length >= nTr, `CSV: a header and every trade (${lines.length - 1})`);
  const [dl] = await Promise.all([pg.waitForEvent("download"), pg.click("#jiZip")]);
  const zp = D + "/journal_backup_test.zip"; await dl.saveAs(zp);
  const zl = execSync(`python3 -c "import zipfile,sys; n=zipfile.ZipFile(sys.argv[1]).namelist(); print(len(n), 'journal.json' in n, len([x for x in n if x.startswith('pictures/')]))" ${zp}`).toString().trim().split(" ");
  ok(zl[1] === "True" && Number(zl[2]) >= 6, `Download backup: journal.json and the pictures (${zl[2]})`);
  pg.once("dialog", d => d.accept());
  await pg.setInputFiles("#jiRestore", zp);
  await pg.waitForFunction(() => /Added|Couldn't/.test(document.querySelector("#jiRestoreSt").textContent), null, {timeout: 20000});
  ok(/Added 0 trades, 0 pictures, 0 reviews, 0 practice days \(\d+ already here\)/.test(await pg.textContent("#jiRestoreSt")), "Restore the same backup: nothing added twice, nothing changed");
  ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
  await pg.evaluate(async () => { await api("/api/journal/settings", {body: {shots: {tg: false, chart: true}}}); });

  // ---- the phone
  const ph = await br.newContext({ ...devices["Pixel 7"] });
  const mp = await ph.newPage();
  const perrs = []; mp.on("pageerror", e => perrs.push(e.message));
  await mp.goto("http://localhost:8766/"); await LOGIN(mp);
  await mp.waitForFunction(() => P.snap && document.body.classList.contains("mob"), null, { timeout: 20000 });
  await mp.evaluate(() => mShow("more")); await mp.waitForTimeout(300);
  await mp.click('#ms_more [data-pg="journal"]'); await mp.waitForSelector(".jn-trade", { timeout: 10000 });
  const wide = () => mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  await mp.click('#jnSub button[data-v="insights"]'); await mp.waitForSelector(".ji-kpis");
  ok(await wide(), "phone: Insights fits the screen (tables scroll inside their cards)");
  await mp.screenshot({ path: SHOT + "jinsights_phone.png" });
  await mp.click('#jnSub button[data-v="review"]'); await mp.waitForSelector("#jiRvMode");
  ok(await mp.$eval('#jiRvMode button[data-v="month"]', b => b.classList.contains("on")), "the Review remembers Calendar from the other device (saved in your settings)");
  await mp.click('#jiRvMode button[data-v="week"]'); await mp.waitForSelector("#jiRvWell");
  ok(await wide(), "phone: the weekly review fits the screen");
  await mp.click('#jiRvMode button[data-v="month"]'); await mp.waitForSelector(".ji-cal");
  ok(await wide(), "phone: the calendar fits (7 day columns)");
  await mp.screenshot({ path: SHOT + "jinsights_phone_cal.png" });
  ok(!perrs.length, "phone: no page errors" + (perrs.length ? ": " + perrs.join(" | ") : ""));
  await br.close();
})().catch(async e => { console.error(e); process.exitCode = 1; if(br) await br.close(); });
