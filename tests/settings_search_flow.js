// v0.35.0 in the browser: the search in the indicators menu (ƒx, roadmap 18) and Settings as a page of its own (roadmap 19),
// on the desktop and the phone. Needs the mock server and an admin with 2FA (run security_flow.js first).
const { chromium, devices } = require("playwright");
const LOGIN = require("./login.js");
const fs = require("fs");
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
let br;
(async () => {
  br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 1500, height: 920 } })).newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  pg.on("console", m => { if(m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  // two saved scripts to find
  await pg.evaluate(async () => {
    await pineLoad(true);
    const save = async (name, source) => { const old = PINE.scripts.find(s => s.name === name);
      const j = await api("/api/scripts/save", {body: {id: old ? old.id : null, name, source}}); PINE.scripts = j.scripts; PINE.loaded = true; };
    await save("Search Supertrend", '//@version=5\nindicator("Search Supertrend", overlay=true)\nplot(close, "C")');
    await save("Search RSI Divergence", '//@version=5\nindicator("Search RSI Divergence")\nplot(ta.rsi(close, 14), "RSI")');
    indSave([]); indBuild(); setTf("5m"); await openBySymbol("MCX:CRUDEOIL26NOVFUT");
  });
  await pg.waitForFunction(() => DISP.length > 50, null, { timeout: 20000 });

  // ---------------------------------------------------------------- ƒx search
  await pg.click("#bInd");
  ok(await pg.isVisible("#indQ") && await pg.evaluate(() => document.activeElement && document.activeElement.id === "indQ"), "ƒx opens with the search box, ready to type");
  const all = await pg.evaluate(() => document.querySelectorAll("#indBody .ind:not(.hide)").length);
  await pg.keyboard.type("diverg");
  const r1 = await pg.evaluate(() => ({names: [...document.querySelectorAll("#indBody .ind:not(.hide) b")].map(b => b.textContent),
    marks: [...document.querySelectorAll("#indBody .ind:not(.hide) mark")].map(m => m.textContent.toLowerCase()),
    secs: [...document.querySelectorAll("#indBody .sec:not(.hide)")].map(s => s.textContent.trim())}));
  ok(r1.names.length === 1 && r1.names[0] === "Search RSI Divergence", `"diverg" leaves only the matching script (${r1.names.join(", ")}; ${all} rows before)`);
  ok(r1.marks.length >= 1 && r1.marks.every(m => m === "diverg"), "the matching letters are marked");
  ok(r1.secs.length === 1 && /My scripts/.test(r1.secs[0]), `only its section's heading stays (${r1.secs.join(", ")})`);
  await pg.fill("#indQ", "search super"); await pg.waitForTimeout(100);
  ok((await pg.evaluate(() => [...document.querySelectorAll("#indBody .ind:not(.hide) b")].map(b => b.textContent))).join() === "Search Supertrend", "every word must match (\"search super\")");
  await pg.fill("#indQ", "column"); await pg.waitForTimeout(100);
  ok((await pg.evaluate(() => [...document.querySelectorAll("#indBody .ind:not(.hide) b")].map(b => b.textContent))).join() === "P&F toolkit", "built-ins are found by their description too (\"column\" → P&F toolkit)");
  await pg.fill("#indQ", "zzqx"); await pg.waitForTimeout(100);
  ok(/No indicator or script matches "zzqx"/.test(await pg.textContent("#indBody")), "nothing found: it says so, and how to write one");
  // Enter adds the picked one; ↓ moves the pick
  await pg.fill("#indQ", "search"); await pg.waitForTimeout(100);
  const sel0 = await pg.evaluate(() => document.querySelector("#indBody .ind.sel b").textContent);
  await pg.keyboard.press("ArrowDown");
  const sel1 = await pg.evaluate(() => document.querySelector("#indBody .ind.sel b").textContent);
  ok(sel0 !== sel1 && /Search/.test(sel0) && /Search/.test(sel1), `↓ moves the pick (${sel0} → ${sel1})`);
  await pg.keyboard.press("Enter"); await pg.waitForTimeout(800);
  const on = await pg.evaluate(() => indList().map(c => c.type === "pine" ? (pineScript(c.scriptId) || {}).name : c.type));
  ok(on.length === 1 && on[0] === sel1, `Enter adds the picked one to the chart (${on.join(", ")})`);
  ok(await pg.isVisible("#indPick") && (await pg.inputValue("#indQ")) === "search", "the menu and the search stay for the next one, as on TradingView");
  await pg.screenshot({ path: SHOT + "ind_search.png" });
  await pg.keyboard.press("Escape");
  ok((await pg.inputValue("#indQ")) === "" && await pg.isVisible("#indPick"), "Esc clears the search first");
  await pg.keyboard.press("Escape");
  ok(!(await pg.isVisible("#indPick")), "… then closes the menu");
  await pg.click("#chart", { position: { x: 300, y: 300 } });
  await pg.keyboard.press("/");
  ok(await pg.isVisible("#indPick") && await pg.evaluate(() => document.activeElement.id === "indQ"), '"/" opens ƒx with the search, as on TradingView');
  await pg.keyboard.press("Escape");
  await pg.evaluate(() => { indSave([]); indBuild(); });

  // ---------------------------------------------------------------- the version at the top (owner, 10 Nov)
  const ver = await pg.evaluate(() => ({top: document.querySelector("#verTop").textContent, v: S.version,
    one: document.querySelector("#app > header").scrollHeight < 70}));
  ok(ver.top === "v" + ver.v && ver.one, `the version under "Trade Manager" (${ver.top}); the header stays on one line`);

  // ---------------------------------------------------------------- Settings as a page
  await pg.click("#bSettings");
  await pg.waitForSelector("#drawer.open #setNav button", { timeout: 10000 });
  await pg.waitForTimeout(700);
  const st = await pg.evaluate(() => {
    const d = document.querySelector("#drawer").getBoundingClientRect(), c = document.querySelector("#setBody").getBoundingClientRect();
    return {w: d.width, h: d.height, body: c.width, hash: location.hash, nav: [...document.querySelectorAll("#setNav button")].map(b => b.textContent),
      cards: document.querySelectorAll("#setBody > .scard:not(.hide)").length};
  });
  const hb = await pg.evaluate(() => Math.round(document.querySelector("#app > header").getBoundingClientRect().bottom));
  ok(st.w === 1500 && Math.abs(st.h - (920 - hb)) <= 1 && st.hash === "#settings", `Settings fills the window under the app's top bar (${st.w}×${st.h}), the address says #settings`);
  ok(new RegExp("^Version " + ver.v.replace(/\./g, "\\.")).test(await pg.textContent("#verSet")), `the version at the top of Settings ("${await pg.textContent("#verSet")}")`);
  ok(st.body >= 760, `its content is ${Math.round(st.body)} px wide (the drawer was 440)`);
  ok(["Fyers app", "MT5 bridge", "Telegram alerts", "Paper trading rules", "Charges used", "Security", "Users", "Display", "Helper log"].every(x => st.nav.includes(x)),
     `the list of sections: ${st.nav.join(" · ")}`);
  ok(st.cards === st.nav.length, `each section in its own card (${st.cards})`);
  await pg.screenshot({ path: SHOT + "settings_page.png" });
  await pg.click('#setNav button[data-s="secSec"], #setNav button:text("Security")');
  await pg.waitForTimeout(900);
  const jump = await pg.evaluate(() => { const s = [...document.querySelectorAll("#setBody > .scard")].find(x => x.dataset.t === "Security");
    const db = document.querySelector("#drawer .db"); return {top: s.getBoundingClientRect().top - db.getBoundingClientRect().top, on: document.querySelector("#setNav button.on").textContent}; });
  ok(Math.abs(jump.top) < 40 && jump.on === "Security", `a click in the list jumps to that section (${Math.round(jump.top)} px from the top) and marks it`);
  await pg.evaluate(() => { const db = document.querySelector("#drawer .db"); db.scrollTo({top: 0}); });
  await pg.waitForTimeout(900);
  ok((await pg.textContent("#setNav button.on")) === "Fyers app", "scrolling back up, the list follows (Fyers app)");
  ok(await pg.isVisible("#secBox .sess") || await pg.isVisible("#secBox"), "the sections still work (Security shows your sessions)");
  await pg.reload(); await LOGIN(pg).catch(() => {});
  await pg.waitForSelector("#drawer.open", { timeout: 15000 }).catch(() => {});
  ok(await pg.isVisible("#drawer.open"), "a reload on #settings opens Settings again");
  await pg.keyboard.press("Escape");
  ok(!(await pg.isVisible("#drawer.open")) && (await pg.evaluate(() => location.hash)) === "", "Esc goes back, and the address too");
  await pg.click("#bSettings"); await pg.waitForSelector("#drawer.open"); await pg.click("#bClose");
  ok(!(await pg.isVisible("#drawer.open")), "← Back goes back");
  await pg.click("#bSettings"); await pg.waitForSelector("#drawer.open"); await pg.click('#nav button[data-pg="history"]'); await pg.waitForTimeout(300);
  ok(!(await pg.isVisible("#drawer.open")) && await pg.evaluate(() => PG.page === "history"), "the top bar stays usable: picking History there closes Settings and opens History");
  await pg.click('#nav button[data-pg="chart"]');
  ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));

  // ---------------------------------------------------------------- the phone
  const ctx = await br.newContext({ ...devices["Pixel 7"] });
  const mp = await ctx.newPage(); const merrs = []; mp.on("pageerror", e => merrs.push(e.message));
  await mp.goto("http://localhost:8766/"); await LOGIN(mp);
  await mp.waitForFunction(() => document.body.classList.contains("mob"), null, { timeout: 10000 });
  await mp.evaluate(() => openDrawer()); await mp.waitForTimeout(800);
  const m1 = await mp.evaluate(() => { const n = document.querySelector("#setNav").getBoundingClientRect(), d = document.querySelector("#drawer").getBoundingClientRect();
    return {chips: document.querySelectorAll("#setNav button").length, row: n.height < 60, w: d.width, vw: innerWidth,
      over: document.querySelector("#drawer .db").scrollWidth <= document.querySelector("#drawer .db").clientWidth + 1}; });
  ok(m1.chips >= 7 && m1.row && m1.w === m1.vw && m1.over, `phone: Settings full screen, the sections as one row of chips (${m1.chips}), nothing wider than the screen`);
  await mp.click('#setNav button:text("Display")'); await mp.waitForTimeout(900);
  ok(await mp.evaluate(() => { const s = [...document.querySelectorAll("#setBody > .scard")].find(x => x.dataset.t === "Display"); const r = s.getBoundingClientRect(); return r.top > 0 && r.top < 200; }), "phone: a chip jumps to its section");
  ok(await mp.isVisible("#mLayout"), "phone: the Layout switch (phone / desktop) is there");
  await mp.screenshot({ path: SHOT + "settings_phone.png" });
  ok(/^Version /.test(await mp.textContent("#verSet")) && await mp.isVisible("#verSet"), "phone: the version at the top of Settings");
  await mp.click("#bClose");
  await mp.evaluate(() => mMore && mShow && mShow("more")); await mp.waitForTimeout(300);
  ok(/^v\d/.test(await mp.textContent("#mVer").catch(() => "")), "phone: the version at the top of More");
  await mp.evaluate(() => mShow("chart"));
  await mp.evaluate(() => { const b = document.querySelector("#bInd"); if(b) b.click(); }); await mp.waitForTimeout(400);
  await mp.fill("#indQ", "volume"); await mp.waitForTimeout(200);
  ok((await mp.evaluate(() => [...document.querySelectorAll("#indBody .ind:not(.hide) b")].map(b => b.textContent))).includes("Volume"), "phone: the ƒx search works too");
  await mp.screenshot({ path: SHOT + "ind_search_phone.png" });
  ok(merrs.length === 0, "phone: no page errors" + (merrs.length ? ": " + merrs.join(" | ") : ""));
  await br.close();
})().catch(async e => { ok(false, "exception " + e.message); if(br) await br.close(); });
