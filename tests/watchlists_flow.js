// Multiple watchlists (owner, 1 Nov 2026), in a browser: the old single watchlist becomes "Watchlist"; new, rename,
// move, delete (two taps, never the last list); + in Find adds to the list on screen; only the list on screen is
// streamed; 30 a list; saved on the server (a reload brings back the lists and the one on screen); the phone layout.
// Needs the mock server and an admin with 2FA (run security_flow.js first).
const { chromium, devices } = require("playwright");
const LOGIN = require("./login.js");
const fs = require("fs");
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const NOV = "MCX:CRUDEOIL26NOVFUT", DEC = "MCX:CRUDEOIL26DECFUT", CE = "MCX:CRUDEOIL26NOV5400CE";
let br;
(async () => {
  br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1400, height: 900 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.waitForFunction(() => typeof wlLoad === "function" && P.snap, null, { timeout: 20000 });
  // a v0.20.8 set-up: one watchlist (the option), no lists yet
  await pg.evaluate(async ce => {
    await api("/api/prefs", {body: {wlists: null, wl: null, watch: [{s: ce, d: "CRUDEOIL 26 Nov 5400 CE", tick: 0.1, lot: 1, mult: 100, f: "OPT", o: "CE"}]}});
  }, CE);
  await pg.reload(); await pg.waitForSelector("#wlSel", { timeout: 20000 });
  await pg.evaluate(async s => { await openBySymbol(s); }, NOV);
  await pg.waitForTimeout(800);
  const m = await pg.evaluate(() => ({opts: [...document.querySelectorAll("#wlSel option")].map(o => o.textContent), rows: document.querySelector("#watchList").textContent}));
  ok(m.opts.length === 1 && /^Watchlist \(1\)$/.test(m.opts[0]) && /5400/.test(m.rows), `the old watchlist becomes the first list, "Watchlist" (${m.opts[0]})`);
  // the want messages this page sends to the server
  const want = () => pg.evaluate(() => { const w = (window.__sent || []).filter(x => /"want"/.test(x)).pop(); return w ? JSON.parse(w).want : null; });
  await pg.evaluate(() => { window.__sent = []; const o = ws.send.bind(ws); ws.send = x => { window.__sent.push(x); o(x); }; });

  // ---- a new list, and + in Find adds to it
  await pg.click("#wlNew"); await pg.fill("#wlName", "MCX"); await pg.click("#wlOk"); await pg.waitForTimeout(300);
  let st = await pg.evaluate(() => ({opts: [...document.querySelectorAll("#wlSel option")].map(o => o.textContent), sel: document.querySelector("#wlSel").selectedOptions[0].textContent, empty: document.querySelector("#watchList").textContent}));
  ok(st.opts.length === 2 && st.sel === "MCX (0)" && /Nothing in MCX yet/.test(st.empty), `＋ makes a new list and shows it (${st.opts.join(", ")})`);
  await pg.click('aside .tabs button[data-tab="find"]'); await pg.fill("#q", "crudeoil"); await pg.waitForTimeout(1200);
  await pg.evaluate(dec => { const r = [...document.querySelectorAll("#results .row")].find(x => x.querySelector(".px").dataset.px === dec); r.querySelector(".x").click(); }, DEC);
  await pg.waitForTimeout(500);
  const toastTxt = await pg.evaluate(() => [...document.querySelectorAll(".toast")].map(t => t.textContent).join(" | "));
  await pg.click('aside .tabs button[data-tab="watch"]'); await pg.waitForTimeout(200);
  st = await pg.evaluate(() => ({sel: document.querySelector("#wlSel").selectedOptions[0].textContent, rows: document.querySelector("#watchList").textContent}));
  ok(st.sel === "MCX (1)" && /26DECFUT/.test(st.rows) && /to MCX/.test(toastTxt), `+ in Find adds to the list on screen ("${toastTxt}")`);
  let w = await want();
  ok(w && w.includes(DEC) && !w.includes(CE), "only the list on screen is streamed (MCX: the December future, not the option)");
  await pg.selectOption("#wlSel", { label: "Watchlist (1)" }); await pg.waitForTimeout(300);
  w = await want();
  ok(w && w.includes(CE) && !w.includes(DEC) && /5400/.test(await pg.textContent("#watchList")), "switching lists shows and streams the other list");

  // ---- rename, a name that's taken, move, delete
  await pg.selectOption("#wlSel", { label: "MCX (1)" }); await pg.waitForTimeout(200);
  await pg.click("#wlMore"); await pg.click('.wlmenu [data-a="rename"]'); await pg.fill("#wlName", "MCX futures"); await pg.press("#wlName", "Enter"); await pg.waitForTimeout(200);
  ok(await pg.evaluate(() => [...document.querySelectorAll("#wlSel option")].some(o => o.textContent === "MCX futures (1)")), "⋯ › Rename");
  await pg.click("#wlNew"); await pg.fill("#wlName", "watchlist"); await pg.click("#wlOk"); await pg.waitForTimeout(200);
  ok(await pg.isVisible("#wlName") && await pg.evaluate(() => WL.length === 2), "a name already used (any case) is refused");
  await pg.click("#wlCancel");
  await pg.click("#wlMore"); await pg.click('.wlmenu [data-a="up"]'); await pg.waitForTimeout(200);
  ok(await pg.evaluate(() => document.querySelectorAll("#wlSel option")[0].textContent === "MCX futures (1)"), "⋯ › Move up puts it first");
  await pg.screenshot({ path: SHOT + "watchlists_menu.png" });
  await pg.click('.wlmenu [data-a="del"]'); await pg.waitForTimeout(200);
  ok(/Tap again to delete MCX futures/.test(await pg.textContent('.wlmenu [data-a="del"]')) && await pg.evaluate(() => WL.length === 2), "Delete asks for a second tap (nothing deleted yet)");
  await pg.click('.wlmenu [data-a="del"]'); await pg.waitForTimeout(300);
  st = await pg.evaluate(() => ({n: WL.length, sel: document.querySelector("#wlSel").selectedOptions[0].textContent}));
  ok(st.n === 1 && st.sel === "Watchlist (1)", "the second tap deletes it and shows the next list");
  await pg.click("#wlMore"); await pg.click('.wlmenu [data-a="del"]'); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => WL.length === 1), "the last list can't be deleted");
  await pg.click("#wlMore");

  // ---- 30 a list
  const cap = await pg.evaluate(dec => { const keep = watch.slice(); for(let i = watch.length; i < 30; i++) watch.push({s: "NSE:FAKE" + i + "-EQ", d: "x"}); addWatch(sym[dec] || {s: dec}); const n = watch.length; watch = keep; wlSave(); renderWatch(); return n; }, DEC);
  ok(cap === 30, "a list holds 30 contracts; the 31st is refused");

  // ---- saved on the server
  await pg.click("#wlNew"); await pg.fill("#wlName", "Index F&O"); await pg.click("#wlOk"); await pg.waitForTimeout(900);
  await pg.reload(); await pg.waitForSelector("#wlSel", { timeout: 20000 }); await pg.waitForTimeout(500);
  st = await pg.evaluate(() => ({opts: [...document.querySelectorAll("#wlSel option")].map(o => o.textContent), sel: document.querySelector("#wlSel").selectedOptions[0].textContent}));
  ok(st.opts.join(",") === "Watchlist (1),Index F&O (0)" && st.sel === "Index F&O (0)", `after a reload: the same lists, and the one that was on screen (${st.opts.join(", ")})`);

  // ---- the phone layout: the lists are on the Quotes tab
  const ph = await (await br.newContext({ ...devices["Pixel 7"] })).newPage();
  ph.on("pageerror", e => errs.push("phone: " + e.message));
  await ph.goto("http://localhost:8766/"); await LOGIN(ph);
  await ph.waitForFunction(() => typeof M !== "undefined" && M.on && P.snap, null, { timeout: 20000 });
  await ph.click('#mNav [data-ms="quotes"]'); await ph.waitForTimeout(400);
  ok(await ph.isVisible("#ms_quotes #wlSel"), "phone: the list switcher is on the Quotes tab");
  await ph.selectOption("#wlSel", { label: "Watchlist (1)" }); await ph.waitForTimeout(300);
  ok(/5400/.test(await ph.textContent("#watchList")), "phone: switching lists shows that list");
  await ph.screenshot({ path: SHOT + "watchlists_phone.png" });

  // tidy up: one list again, as the other browser tests expect
  await pg.evaluate(async () => { await api("/api/prefs", {body: {wlists: null, wl: null, watch: []}}); });
  ok(errs.length === 0, "no script errors" + (errs.length ? ": " + errs.slice(0, 4).join(" / ") : ""));
  await br.close();
})().catch(async e => { ok(false, e.message.split("\n")[0]); if(br) await br.close(); });
