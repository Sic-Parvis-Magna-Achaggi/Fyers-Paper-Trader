// Alerts (v0.38.0, roadmap 21) in the browser, against the mock server (needs an admin with 2FA: run security_flow.js
// first; the mock's /_mock/price moves a price on demand, /_mock/hook receives webhooks). ~3 min. Checks:
// - the top bar still fits at 1500 px with the 🔔; Alt+A, the 🔔 button, right-click "Add alert at", a drawing's menu and ƒx's 🔔
//   open the dialog with the right condition; the dialog lists prices, candles, the chart's Pine plots / alertconditions,
//   drawings and the built-in indicators;
// - a price alert made in the dialog shows a 🔔 line, fires when the price crosses (pop-up, log, "triggered", line gone);
// - dragging a 🔔 line moves the alert's level on the server;
// - technical: a Pine plot alert, a built-in RSI with a price condition (multi-condition), a webhook with a JSON message;
// - the manager: pause / resume / clone / edit / delete, search; the log; the notifications tab;
// - a watchlist alert fires per symbol; the service worker shows a pushed notification (Chrome's DevTools push);
// - the phone: More › Alerts, the dialog full screen, a pop-up when one fires; no page errors.
const { chromium, devices } = require("playwright");
const LOGIN = require("./login.js");
const fs = require("fs");
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m, info) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + (c || info === undefined ? "" : "  " + JSON.stringify(info).slice(0, 400)) + "\n"); if(!c) process.exitCode = 1; };
const BASE = "http://localhost:8766";
const SYM = "MCX:CRUDEOIL26NOVFUT", SYM2 = "MCX:CRUDEOIL26DECFUT";
const SCRIPT = `//@version=5
indicator("T Alert osc")
r = ta.rsi(close, 14)
plot(r, "RSI")
plot(ta.sma(close, 5), "SMA5")
alertcondition(r > 0, "RSI above 0", "{{ticker}} RSI {{plot_0}}")
`;
const fmtNum = v => Number(v).toLocaleString("en-IN", {maximumFractionDigits: 2});
const post = (pg, path) => pg.evaluate(p => fetch(p, {method: "POST"}).then(r => r.json()), path);
let br;
(async () => {
  br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1500, height: 880 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => { errs.push(e.message); fs.writeSync(1, "PAGEERROR " + e.message + "\n"); });
  await pg.goto(BASE + "/"); await LOGIN(pg);
  // a clean slate: earlier runs' alerts deleted
  await pg.evaluate(async () => { const j = await api("/api/alerts"); if(j.alerts.length) await api("/api/alerts/action", {body: {ids: j.alerts.map(a => a.id), do: "delete"}}); await api("/api/alerts/log/clear", {body: {}}); });
  const sid = await pg.evaluate(async src => { await pineLoad(true); const old = PINE.scripts.find(s => s.name === "T Alert osc");
    const j = await api("/api/scripts/save", {body: {id: old ? old.id : null, name: "T Alert osc", source: src}}); PINE.scripts = j.scripts; PINE.loaded = true; return j.script.id; }, SCRIPT);
  await pg.evaluate(async s => { ctSave({type: "candles"}); setTf("5m"); await openBySymbol(s); }, SYM);
  await pg.waitForFunction(() => DISP.length > 100, null, { timeout: 30000 });
  await pg.evaluate(id => { indSave([{type: "pine", id: "ao", scriptId: id, inputs: {}}]); indBuild(); }, sid);
  await pg.waitForFunction(() => INDS.length === 1 && INDS[0].pine && INDS[0].pine.res, null, { timeout: 60000 });
  await pg.waitForFunction(() => last[cur.s] && last[cur.s].ltp, null, { timeout: 20000 });
  await pg.evaluate(() => caLoad());

  ok(await pg.evaluate(() => document.querySelector("header").offsetHeight) < 60, "the top bar still fits on one line at 1500 px with the 🔔");
  ok(await pg.isVisible('#nav [data-pg="alerts"]') && await pg.isVisible("#bAlert"), "the 🔔 is in the top bar and on the chart");

  // ---------------------------------------------------------------- the dialog
  await pg.keyboard.press("Alt+a");
  await pg.waitForSelector("#caDlg:not(.hide) .cadlg");
  const opts = await pg.$$eval('#caDlg [data-slot="a"] option', os => os.map(o => o.value));
  ok(opts.includes("price:last") && opts.includes("bar:close") && opts.includes("ind:rsi:RSI") && opts.includes("ind:macd:Signal"), "Alt+A: prices, candles and the built-in indicators", opts.slice(0, 12));
  ok(opts.includes("pine:ao:plot:RSI") && opts.includes("pine:ao:ac:RSI above 0"), "the chart's script: its plots and its alertcondition()", opts.filter(o => o.startsWith("pine")));
  const px0 = await pg.evaluate(() => last[cur.s].ltp);
  ok(Math.abs(+(await pg.inputValue('#caDlg [data-v="b"]')) - px0) < 30, "the first condition starts as the price crossing the current price");
  await pg.selectOption('#caDlg [data-op="0"]', "cross_up");
  await pg.fill('#caDlg [data-v="b"]', String(px0 + 40));
  await pg.fill("#caName", "UI cross up");
  await pg.screenshot({ path: SHOT + "calerts_dialog.png" });
  await pg.click("#caSave");
  await pg.waitForSelector("#caDlg.hide", { state: "attached" });
  await pg.waitForFunction(() => CA.list.some(a => a.name === "UI cross up"), null, { timeout: 5000 });
  await pg.waitForTimeout(400);
  ok(await pg.evaluate(() => CA.lines.length === 1 && Math.abs(CA.lines[0].options().price - (last[cur.s].ltp)) < 80), "a 🔔 line at the alert's level on the chart");
  await post(pg, `/_mock/price?s=${encodeURIComponent(SYM)}&p=${px0 + 60}`);
  await pg.waitForSelector("#caPops .capop", { timeout: 10000 });
  const pop = await pg.textContent("#caPops .capop");
  ok(/UI cross up/.test(pop) && /crossing up/i.test(pop), "the price crossing up fires: a pop-up with the alert", pop);
  await pg.waitForFunction(() => CA.list.find(a => a.name === "UI cross up").status === "triggered", null, { timeout: 5000 });
  ok(await pg.evaluate(() => CA.lines.length === 0), "only once: the alert is triggered and its line goes");
  await pg.screenshot({ path: SHOT + "calerts_popup.png" });
  await pg.evaluate(() => document.querySelectorAll("#caPops .capop").forEach(x => x.remove()));

  // ---------------------------------------------------------------- dragging a 🔔 line
  // a level above the price (so "greater than" waits) and inside the visible range (so the line can be grabbed)
  const pxNow = await pg.evaluate(() => { const p = last[cur.s].ltp, y = series.priceToCoordinate(p); return Math.max(p + 6, Math.round(series.coordinateToPrice(Math.max(60, y - 140)))) - 30; });
  await pg.evaluate(async lvl => { await api("/api/alerts/save", {body: {alert: {name: "drag me", target: {s: cur.s}, conds: [{a: {k: "price"}, op: "gt", b: {k: "value", v: lvl}, tf: "5m"}], freq: "once", notify: {popup: true, push: false}}}}); await caLoad(); }, pxNow + 30);
  await pg.waitForFunction(() => CA.lines.length === 1, null, { timeout: 5000 });
  const geo = await pg.evaluate(() => { const r = document.querySelector("#chart").getBoundingClientRect(); return {x: r.left + r.width * 0.5, y: r.top + series.priceToCoordinate(CA.lines[0].options().price), top: r.top}; });
  await pg.mouse.move(geo.x, geo.y); await pg.mouse.down(); await pg.mouse.move(geo.x, geo.y - 30, { steps: 6 }); await pg.mouse.up();
  await pg.waitForTimeout(1200);
  const moved = await pg.evaluate(lvl => { const a = CA.list.find(x => x.name === "drag me"); return {v: a.conds[0].b.v, lvl}; }, pxNow + 30);
  ok(moved.v > moved.lvl + 1, "dragging the 🔔 line up moves the alert's level on the server", moved);

  // ---------------------------------------------------------------- technical, multi-condition, webhook
  await pg.evaluate(async () => {
    const r = INDS[0], sc = pineScript(r.cfg.scriptId);
    await api("/api/alerts/save", {body: {alert: {name: "plot alert", target: {s: cur.s}, freq: "bar", msg: "{{ticker}} {{interval}} RSI={{plot_0}} sma={{plot(\"SMA5\")}}",
      conds: [{a: {k: "pine", name: "T Alert osc", code: sc.source, inputs: {}, plot: "RSI"}, op: "gt", b: {k: "value", v: 0}, tf: "5m"}], notify: {popup: true, push: false}}}});
    await api("/api/alerts/save", {body: {alert: {name: "multi", target: {s: cur.s}, freq: "bar", join: "all",
      conds: [{a: {k: "price"}, op: "gt", b: {k: "value", v: 1}, tf: "5m"}, {a: {k: "ind", t: "rsi", p: {len: 14}, out: "RSI"}, op: "inside", lo: {k: "value", v: 0}, hi: {k: "value", v: 100}, tf: "15m"}],
      notify: {popup: true, push: false, webhook: location.origin + "/_mock/hook"}, msg: '{"sym": "{{ticker}}", "price": {{close}}}'}}});
    await caLoad();
  });
  await pg.waitForFunction(() => CA.log.some(e => e.name === "plot alert") && CA.log.some(e => e.name === "multi"), null, { timeout: 60000 }).catch(() => {});
  const lg = await pg.evaluate(() => CA.log.map(e => [e.name, e.msg]));
  const pl = lg.find(x => x[0] === "plot alert");
  ok(pl && /^CRUDEOIL26NOVFUT 5 RSI=\d/.test(pl[1]) && /sma=\d/.test(pl[1]), "a Pine plot alert fires, with {{plot_0}} / {{plot(\"SMA5\")}} filled", lg);
  ok(lg.some(x => x[0] === "multi"), "multi-condition (price on 5m and the built-in RSI on 15m) fires", lg);
  await pg.waitForTimeout(800);
  const hooks = (await pg.evaluate(() => fetch("/_mock/hooks").then(r => r.json()))).hooks;
  ok(hooks.length && hooks[0].type === "application/json" && JSON.parse(hooks[0].body).sym === "CRUDEOIL26NOVFUT", "the webhook received the message as JSON", hooks);
  const one = await pg.evaluate(() => CA.list.filter(a => a.name === "plot alert" || a.name === "multi").map(a => a.fired));
  await pg.waitForTimeout(4000);
  const two = await pg.evaluate(() => CA.list.filter(a => a.name === "plot alert" || a.name === "multi").map(a => a.fired));
  ok(JSON.stringify(one) === JSON.stringify(two), "once per bar: not again within the bar", [one, two]);

  // ---------------------------------------------------------------- right-click, drawings, ƒx
  await pg.evaluate(() => document.querySelectorAll("#caPops .capop").forEach(x => x.remove()));
  const box = await pg.evaluate(() => { const r = document.querySelector("#chart").getBoundingClientRect(); return {x: r.left + r.width * 0.4, y: r.top + 120}; });
  await pg.mouse.click(box.x, box.y, { button: "right" });
  await pg.waitForSelector("#caCtx:not(.hide)");
  const ctxTxt = await pg.textContent("#caCtx");
  ok(/price crossing [\d,.]+/.test(ctxTxt) && /Alert at [\d,.]+…/.test(ctxTxt), "right-click on the chart: an alert at that price (at once, or in the dialog)", ctxTxt);
  await pg.click('#caCtx [data-a="at"]');
  await pg.waitForSelector("#caDlg:not(.hide) .cadlg");
  const atV = +(await pg.inputValue('#caDlg [data-v="b"]'));
  const want = await pg.evaluate(y => series.coordinateToPrice(y - document.querySelector("#chart").getBoundingClientRect().top), box.y);
  ok(Math.abs(atV - want) < 3, "...the dialog starts at the price clicked", [atV, want]);
  await pg.click("#caCancel");
  const did = await pg.evaluate(async () => { const t = DISP[DISP.length - 20].time, p = last[cur.s].ltp;
    DR.items.push({id: "tline1", type: "hline", pts: [{t, p: p + 25}], st: {c: "#2962ff", w: 1, ls: 0, lbl: true}}); DR.dirty = true; await drSaveNow(); drRedraw(); return DR.items.length; });
  await pg.evaluate(() => drMenu(DR.items.find(d => d.id === "tline1"), 300, 300));
  ok(await pg.isVisible('#drMenu [data-caa]'), "a drawing's menu has 🔔 Add alert…", did);
  await pg.click('#drMenu [data-caa]');
  await pg.waitForSelector("#caDlg:not(.hide) .cadlg");
  ok((await pg.inputValue('#caDlg [data-slot="b"]')) === "draw:tline1:v", "...the dialog watches the price against that line");
  await pg.click("#caSave");
  await pg.waitForFunction(() => CA.list.some(a => a.conds[0].b && a.conds[0].b.k === "draw"), null, { timeout: 5000 });
  ok(true, "a drawing alert is saved");
  await pg.click("#bInd"); await pg.waitForSelector("#indPick:not(.hide)");
  ok(await pg.isVisible('#indBody .ind[data-pine] [data-ca]'), "ƒx: a 🔔 on the script's row");
  await pg.click('#indBody .ind[data-pine] [data-ca]');
  await pg.waitForSelector("#caDlg:not(.hide) .cadlg");
  ok((await pg.inputValue('#caDlg [data-slot="a"]')) === "pine:ao:plot:RSI", "...the dialog starts on its first plot");
  await pg.click("#caCancel");

  // ---------------------------------------------------------------- v0.38.1: the price scale's 🔔 +, the drawing bar's 🔔
  await pg.evaluate(() => { document.querySelectorAll("#caCtx").forEach(m => m.classList.add("hide")); });
  const ps = await pg.evaluate(() => { const r = document.querySelector("#chart").getBoundingClientRect(), w = chart.priceScale("right").width();
    return {x: r.right - w / 2, y: r.top + 160, psw: w}; });
  await pg.mouse.move(ps.x - ps.psw / 2 - 20, ps.y);
  ok(!(await pg.isVisible("#caPlus")), "not shown inside the chart near the scale (where the position bars sit)");
  await pg.mouse.move(ps.x, ps.y, { steps: 4 });
  ok(await pg.isVisible("#caPlus"), "hovering the price scale shows 🔔+ at that price (TradingView's plus)");
  await pg.screenshot({ path: SHOT + "calerts_plus.png", clip: {x: ps.x - 260, y: ps.y - 120, width: 330, height: 240} });
  const plusAt = await pg.evaluate(() => { const b = document.querySelector("#caPlus").getBoundingClientRect(), r = document.querySelector("#chart").getBoundingClientRect();
    return {mid: b.top + b.height / 2 - r.top, title: document.querySelector("#caPlus").title}; });
  const nBefore = await pg.evaluate(() => CA.list.length);
  await pg.mouse.move(ps.x - ps.psw / 2 - 8, ps.y, { steps: 3 });       // from the scale onto the button
  await pg.click("#caPlus");
  await pg.waitForSelector("#caCtx:not(.hide)");
  const want2 = await pg.evaluate(y => roundTick(series.coordinateToPrice(y), cur.tick), plusAt.mid);
  ok(/crossing [\d,.]+/.test(await pg.textContent("#caCtx")) && plusAt.title.includes(fmtNum(want2)), "its menu: an alert at that price, one click", [plusAt, want2]);
  await pg.click('#caCtx [data-a="now"]');
  await pg.waitForFunction(n => CA.list.length === n + 1, nBefore, { timeout: 5000 });
  const inst = await pg.evaluate(() => CA.list.find(a => a.conds[0].op === "cross" && a.conds[0].b.k === "value" && !a.name && a.freq === "once"));
  ok(inst && Math.abs(inst.conds[0].b.v - want2) < 0.001, "...created at once: price crossing that level, only once", inst && inst.conds[0]);
  ok(await pg.evaluate(v => CA.lines.some(l => l.options().price === v), want2), "...with its 🔔 line on the chart");
  await pg.evaluate(() => { DR.sel = "tline1"; drRedraw(); drUiSel(); });
  await pg.waitForSelector("#dsel:not(.hide) [data-cab]");
  ok(/1/.test(await pg.textContent("#dsel [data-cab]")) && await pg.evaluate(() => document.querySelector("#dsel [data-cab]").classList.contains("on")), "a selected drawing's bar: 🔔 with its number of alerts");
  await pg.click("#dsel [data-cab]");
  await pg.waitForSelector("#caCtx:not(.hide) [data-e]");
  ok(await pg.$$eval("#caCtx [data-e]", x => x.length) === 1 && await pg.isVisible("#caCtx [data-n]"), "...click: edit its alert, or add another");
  await pg.click("#caCtx [data-e]");
  await pg.waitForSelector("#caDlg:not(.hide) .cadlg");
  ok((await pg.inputValue('#caDlg [data-slot="b"]')) === "draw:tline1:v" && /Edit alert/.test(await pg.textContent("#caDlg .cadh")), "...which opens it to edit");
  await pg.click("#caCancel");
  await pg.evaluate(() => drMenu(DR.items.find(d => d.id === "tline1"), 300, 300));
  ok(await pg.isVisible('#drMenu [data-cae]'), "the drawing's right-click menu lists its alert too");
  await pg.evaluate(() => drUiMenuClose());

  // ---------------------------------------------------------------- the Alerts page
  await pg.click('#nav [data-pg="alerts"]');
  await pg.waitForSelector("#pg_alerts:not(.hide) .calist");
  await pg.screenshot({ path: SHOT + "calerts_page.png" });
  const ld = await pg.textContent("#caLoad");
  ok(/Calculations \d+ of \d+/.test(ld) && /Node/.test(ld) && /CPU/.test(ld), "the Alerts page shows the server's load (calculations of the limit, Node, CPU)", ld);
  await pg.click("#caLim"); await pg.fill("#caLimN", "123"); await pg.click("#caLimSave");
  await pg.waitForFunction(() => /of 123/.test(document.querySelector("#caLoad").textContent));
  await pg.click("#caLim"); await pg.click("#caLimAuto");
  await pg.waitForFunction(() => /automatic/.test(document.querySelector("#caLoad").textContent));
  ok(true, "the admin sets the limit, and back to automatic");
  ok(await pg.evaluate(() => !document.querySelector("#nbAlerts").classList.contains("hide") && document.querySelector("header").offsetHeight < 60), "the top bar still fits with the alerts count on the 🔔");
  const rows = await pg.$$eval("#pg_alerts .carowa", r => r.length);
  ok(rows >= 5, "the Alerts page lists them", rows);
  const dm = await pg.evaluate(() => CA.list.find(a => a.name === "drag me").id);
  await pg.click(`.carowa[data-id="${dm}"] [data-a="pause"]`);
  await pg.waitForFunction(id => CA.list.find(a => a.id === id).status === "paused", dm);
  ok(true, "pause");
  await pg.click(`.carowa[data-id="${dm}"] [data-a="resume"]`);
  await pg.waitForFunction(id => CA.list.find(a => a.id === id).status === "active", dm);
  ok(true, "resume");
  await pg.click(`.carowa[data-id="${dm}"] [data-a="clone"]`);
  await pg.waitForFunction(() => CA.list.some(a => a.name === "drag me (copy)"));
  ok(true, "clone");
  await pg.click(`.carowa[data-id="${dm}"] .caname`);
  await pg.waitForSelector("#caDlg:not(.hide) .cadlg");
  await pg.fill("#caName", "drag me edited"); await pg.click("#caSave");
  await pg.waitForFunction(() => CA.list.some(a => a.name === "drag me edited"));
  ok(await pg.evaluate(id => CA.list.filter(a => a.id === id).length === 1, dm), "edit keeps the same alert");
  pg.once("dialog", d => d.accept());
  const cp = await pg.evaluate(() => CA.list.find(a => a.name === "drag me (copy)").id);
  await pg.click(`.carowa[data-id="${cp}"] [data-a="delete"]`);
  await pg.waitForFunction(id => !CA.list.some(a => a.id === id), cp);
  ok(true, "delete");
  await pg.fill("#caQ", "edited");
  ok(await pg.$$eval("#pg_alerts .carowa", r => r.length) === 1, "search");
  await pg.click('.catabs [data-t="log"]');
  await pg.waitForSelector("#pg_alerts .calog");
  ok(/UI cross up/.test(await pg.textContent("#pg_alerts .calog")), "the log shows what fired");
  await pg.click('.catabs [data-t="notify"]');
  await pg.waitForSelector("#pg_alerts .cacards");
  ok(await pg.isVisible("#caPOn"), "Notifications: Turn on for this device");
  await pg.screenshot({ path: SHOT + "calerts_notify.png" });

  // ---------------------------------------------------------------- a watchlist alert
  await pg.evaluate(async ([a, b]) => {
    WL = [{id: "wT", name: "Alerts test", items: [{s: a, d: "A"}, {s: b, d: "B"}]}]; wlId = "wT"; watch = WL[0].items; prefSet("wlists", WL); prefSet("wl", wlId); prefSet("watch", watch);
    await new Promise(r => setTimeout(r, 1200));
    await api("/api/alerts/save", {body: {alert: {name: "wl alert", target: {wl: "wT", wl_name: "Alerts test"}, conds: [{a: {k: "price"}, op: "gt", b: {k: "value", v: 1}, tf: "5m"}], freq: "once", notify: {popup: true, push: false}}}});
    await caLoad(); }, [SYM, SYM2]);
  await pg.waitForFunction(() => CA.log.filter(e => e.name === "wl alert").length >= 2, null, { timeout: 20000 }).catch(() => {});
  const wl = await pg.evaluate(() => [...new Set(CA.log.filter(e => e.name === "wl alert").map(e => e.s))].sort());
  ok(wl.length === 2, "a watchlist alert fires for each symbol on its own", wl);

  // ---------------------------------------------------------------- notifications: the service worker
  const swOk = await pg.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration("/"); return !!r && r.scope; });
  ok(swOk && /\/$/.test(swOk), "the service worker is registered for the whole site", swOk);
  const man = await pg.evaluate(async () => { const m = await fetch("/manifest.webmanifest").then(r => r.json()); const i = await fetch(m.icons[0].src); return {name: m.name, display: m.display, icon: i.status}; });
  ok(man.display === "standalone" && man.icon === 200, "the app can be installed (manifest, icons)", man);
  const cdp = await ctx.newCDPSession(pg);
  let regId = null;
  cdp.on("ServiceWorker.workerRegistrationUpdated", e => { for(const r of e.registrations) if(!r.isDeleted) regId = r.registrationId; });
  await cdp.send("ServiceWorker.enable");
  await pg.waitForTimeout(800);
  if(regId){
    await ctx.grantPermissions(["notifications"], { origin: BASE });
    await cdp.send("ServiceWorker.deliverPushMessage", {origin: BASE + "/", registrationId: regId, data: JSON.stringify({title: "🔔 pushed", body: "from the test", tag: "t1", url: "/#alerts"})});
    await pg.waitForFunction(() => CA.lastPush && CA.lastPush.title === "🔔 pushed", null, { timeout: 8000 }).catch(() => {});
  }
  ok(await pg.evaluate(() => !!(CA.lastPush && CA.lastPush.body === "from the test")), "a push message reaches the service worker, which shows it", regId);

  // ---------------------------------------------------------------- the phone
  const ph = await (await br.newContext({ ...devices["Pixel 7"] })).newPage();
  ph.on("pageerror", e => { errs.push("phone: " + e.message); fs.writeSync(1, "PAGEERROR phone " + e.message + "\n"); });
  await ph.goto(BASE + "/"); await LOGIN(ph);
  await ph.waitForFunction(() => document.body.classList.contains("mob") && typeof CA !== "undefined" && CA.loaded, null, { timeout: 20000 });
  await ph.evaluate(() => mShow("more"));
  ok(await ph.isVisible('#ms_more [data-pg="alerts"]'), "phone: More › Alerts");
  await ph.click('#ms_more [data-pg="alerts"]');
  await ph.waitForSelector("#pg_alerts:not(.hide) .calist");
  await ph.screenshot({ path: SHOT + "calerts_phone_page.png" });
  ok(await ph.evaluate(() => document.querySelector("#pg_alerts").scrollWidth <= innerWidth + 1), "phone: the page fits the screen");
  await ph.evaluate(() => { pgShow("chart"); mShow("chart"); });
  await ph.waitForFunction(() => cur && DISP.length > 50, null, { timeout: 30000 });
  const pps = await ph.evaluate(() => { const r = document.querySelector("#chart").getBoundingClientRect(), w = chart.priceScale("right").width(); return {x: r.right - w / 2, y: r.top + 140}; });
  await ph.touchscreen.tap(pps.x, pps.y);
  await ph.waitForSelector("#caPlus:not(.hide)", { timeout: 3000 }).catch(() => {});
  ok(await ph.isVisible("#caPlus"), "phone: a tap on the price scale shows 🔔+ there");
  await ph.screenshot({ path: SHOT + "calerts_phone_plus.png" });
  await ph.tap("#caPlus");
  await ph.waitForSelector("#caCtx:not(.hide)", { timeout: 3000 }).catch(() => {});
  ok(await ph.isVisible('#caCtx [data-a="now"]'), "phone: ...and its menu");
  await ph.evaluate(() => document.querySelector("#caCtx").classList.add("hide"));
  await ph.evaluate(() => caQuick());
  await ph.waitForSelector("#caDlg:not(.hide) .cadlg");
  const full = await ph.evaluate(() => { const r = document.querySelector("#caDlg .cadlg").getBoundingClientRect(); return {w: r.width, h: r.height, W: innerWidth, H: innerHeight}; });
  ok(full.w >= full.W - 2 && full.h >= full.H - 2, "phone: the dialog fills the screen", full);
  await ph.screenshot({ path: SHOT + "calerts_phone_dialog.png" });
  const pp = await ph.evaluate(() => last[cur.s] ? last[cur.s].ltp : lastBar.close);
  await ph.selectOption('#caDlg [data-op="0"]', "gt");
  await ph.fill('#caDlg [data-v="b"]', String(Math.round(pp - 500)));
  await ph.fill("#caName", "phone alert");
  await ph.click("#caSave");
  await ph.waitForSelector("#caPops .capop", { timeout: 10000 }).catch(() => {});
  ok(/phone alert/.test(await ph.textContent("#caPops").catch(() => "")), "phone: it fires with a pop-up at the top");
  const ptop = await ph.evaluate(() => document.querySelector("#caPops").getBoundingClientRect().top);
  ok(ptop < 200, "phone: the pop-up is at the top, clear of the BUY / SELL bar", ptop);
  await ph.screenshot({ path: SHOT + "calerts_phone_popup.png" });

  ok(!errs.length, "no page errors", errs);
  // tidy up: the price back where the mock's candles are (a price left far off them squashes P&F charts in later suites),
  // and this run's alerts go, so later suites don't get pop-ups
  for(const s of [SYM, SYM2]) await post(pg, `/_mock/price?s=${encodeURIComponent(s)}&p=5600`);
  await pg.evaluate(async () => { const j = await api("/api/alerts"); if(j.alerts.length) await api("/api/alerts/action", {body: {ids: j.alerts.map(a => a.id), do: "delete"}});
    WL = [{id: "w1", name: "Watchlist", items: []}]; wlId = "w1"; watch = []; prefSet("wlists", WL); prefSet("wl", "w1"); prefSet("watch", []); });
  await br.close();
})().catch(async e => { fs.writeSync(1, "FAIL crashed: " + (e.stack || e) + "\n"); process.exitCode = 1; if(br) await br.close(); });
