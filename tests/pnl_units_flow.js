// Browser test (v0.42.0): P&L, SL and TP shown as an amount, a % of the account size or an R multiple, a main unit and a
// second one: the position bar, the SL / TP lines' labels and zone labels, the new-trade tool, a pending order, the trades
// panel and its Open P&L, the Trades page, Chart settings › P&L shown as, U on the chart, a click on a figure, saved on
// the server (a reload), the phone (the position sheet, a tap cycles).
// Run after security_flow.js.  FYERS_HELPER_DATA=/tmp/fyers_test node tests/pnl_units_flow.js
const { chromium, devices } = require("playwright");
const LOGIN = require("./login.js");
const B = "http://localhost:8766/";
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
require("fs").mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { require("fs").writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const CRUDE = "MCX:CRUDEOIL26NOVFUT";
const SIZE = 1000000;

let br;
(async () => {
  br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1500, height: 920 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  pg.on("console", m => { if(m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push(m.text()); });
  pg.on("dialog", d => d.accept());
  await pg.goto(B); await LOGIN(pg);
  await pg.evaluate(() => { const a = acctList().find(x => x.name === "Main"); if(a) acctSwitch(a.id); });
  const main = await pg.evaluate(() => ACCT);
  const ta = await pg.evaluate(async size => { const r = await api("/api/accounts/create", {body: {name: "Units test " + (Date.now() % 1e6), capital: size}});
    S.accounts = r.accounts; acctSetup(); acctSwitch(r.account.id); return r.account.id; }, SIZE);
  await pg.waitForFunction(id => P.snap && ACCT === id, ta, { timeout: 10000 });
  await pg.evaluate(() => { const c = {...(prefGet("chart", {}) || {})}; delete c.pnlMain; delete c.pnlSecond; prefSet("chart", c); });
  await pg.evaluate(() => papi("ticket", {tp_r: 2, rr_lock: false, mode: "lots", lots: 1}));
  await pg.evaluate(() => { P.ticketLoaded = false; return papi("trail", {be_on: false, sl_on: false, be_r: 1, sl_r: 1}); });
  await pg.evaluate(c => openBySymbol(c), CRUDE);
  await pg.waitForFunction(c => last[c] && last[c].ltp && typeof dispLast === "function" && dispLast(), CRUDE, { timeout: 20000 });

  ok(await pg.evaluate(() => pnlUnits().join()) === "amt,r", "default: the amount, with the R next to it (as the position bar showed before)");
  ok(await pg.evaluate(s => acctSize() === s, SIZE), `the account size for %: ₹${SIZE.toLocaleString("en-IN")}`);

  // ---- a trade
  const ltp = await pg.evaluate(c => last[c].ltp, CRUDE);
  const r = await pg.evaluate(([c, sl, tp]) => papi("place", {s: c, side: 1, type: "market", sl, tp, mode: "lots", lots: 1, product: "MARGIN"}), [CRUDE, ltp - 10, ltp + 30]);
  ok(r.ok, "a CRUDEOIL trade, 1 lot, SL 10 below, TP 30 above" + (r.ok ? "" : ": " + r.error));
  await pg.waitForSelector("#posbars .pbar .pu", { timeout: 8000 });
  await pg.waitForTimeout(1200);
  const P0 = await pg.evaluate(() => { const p = P.snap.positions[0]; return {net: p.net, R: p.init_risk, sl: p.at_sl, tp: p.at_tp}; });
  ok(P0.R > 0 && Math.abs(P0.sl / P0.R + 1) < 0.02, `1R = ₹${P0.R} (net, first entry to first stop); at SL ₹${P0.sl}`);
  const fx = (v, d) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  const state = () => pg.evaluate(() => {
    const p = P.snap.positions[0], titles = P.posLines.map(l => l.options().title);
    const z = zoneList().find(z => !z.tool);
    return {net: p.net, R: p.init_risk, sl: p.at_sl, tp: p.at_tp, bar: document.querySelector("#posbars .pbar .pu").textContent,
      slT: titles.find(t => /^SL /.test(t)), tpT: titles.find(t => /^TP /.test(t)), zsl: z && z.slTxt, ztp: z && z.tpTxt,
      panel: document.querySelector('#posList [data-f="net"]').textContent, atsl: document.querySelector('#posList [data-f="atsl"]').textContent,
      open: document.querySelector("#acct .pu").textContent, units: pnlUnits().join()};
  });
  let s = await state();
  ok(/^[+−]?₹[\d,]+ [+−]?\d+\.\d\dR$/.test(s.bar), "position bar: amount, then R: " + s.bar);
  ok(/^SL −₹[\d,]+ · −(1\.0\d|0\.9\d)R$/.test(s.slT),
     "the SL line's label: amount · R: " + s.slT);
  ok(/^TP \+₹[\d,]+ · \+\d+\.\d\dR$/.test(s.tpT), "the TP line's label: " + s.tpT);
  ok(s.zsl === s.slT.slice(3) && s.ztp === s.tpT.slice(3), "the zones' labels say the same: " + s.zsl + " / " + s.ztp);
  ok(/R$/.test(s.panel) && /R$/.test(s.atsl), "the trades panel: " + s.panel + " · at SL " + s.atsl);
  ok(/R$/.test(s.open), "the panel's Open P&L: " + s.open);
  await pg.screenshot({ path: SHOT + "units_01_amount.png" });

  // ---- U: % of the account
  await pg.click("#chart", { position: { x: 300, y: 200 } }).catch(() => {});
  await pg.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await pg.keyboard.press("u");
  await pg.waitForTimeout(500);
  s = await state();
  ok(s.units === "pct,r", "U: the main unit is now % of account (R stays second)");
  const pct = v => fx(v / SIZE * 100, 2) + "%";
  ok(s.bar.split(" ")[0] === pct(s.net) || (Math.abs(s.net / SIZE * 100) < 0.005 && /^0\.00%/.test(s.bar)),
     `position bar in %: ${s.bar} (₹${s.net} of ₹${SIZE})`);
  ok(s.slT === `SL ${pct(s.sl)} · ${fx(s.sl / s.R, 2)}R`, `the SL label: ${s.slT}`);
  ok(s.tpT === `TP ${pct(s.tp)} · ${fx(s.tp / s.R, 2)}R`, `the TP label: ${s.tpT}`);
  ok(await pg.evaluate(() => [...document.querySelectorAll(".toast")].some(t => /P&L shown as % of account/.test(t.textContent))), "a toast says what it shows now");
  await pg.waitForTimeout(1200);   // prefs go to the server after 0.6 s
  const saved = await pg.evaluate(async () => (await api("/api/prefs")).prefs.chart);
  ok(saved && saved.pnlMain === "pct" && saved.pnlSecond === "r", "saved on the server: " + JSON.stringify({m: saved && saved.pnlMain, s: saved && saved.pnlSecond}));
  await pg.screenshot({ path: SHOT + "units_02_pct.png" });

  // ---- U again: R (the second, R before, takes the % so the two differ)
  await pg.keyboard.press("u"); await pg.waitForTimeout(500);
  s = await state();
  ok(s.units === "r,pct", "U again: R main, % second");
  ok(s.slT === `SL ${fx(s.sl / s.R, 2)}R · ${pct(s.sl)}`, "the SL label: " + s.slT);
  ok(s.tpT === `TP ${fx(s.tp / s.R, 2)}R · ${pct(s.tp)}`, "the TP label: " + s.tpT);
  ok(/^[+−]?\d+\.\d\dR [+−]?\d+\.\d\d%$/.test(s.bar), "position bar: R, then %: " + s.bar);
  await pg.screenshot({ path: SHOT + "units_03_r.png" });

  // ---- a click on the bar's figure: back to the amount
  await pg.click("#posbars .pbar .pu"); await pg.waitForTimeout(500);
  s = await state();
  ok(s.units === "amt,pct", "a click on the position bar's P&L: amount main (% second)");
  ok(/^SL −₹[\d,]+ · −\d\.\d\d%$/.test(s.slT), "the SL label: " + s.slT);

  // ---- Chart settings › P&L shown as
  await pg.click("#bCfg");
  ok(await pg.$('#cfgBody select[data-k="pnlMain"]') !== null && await pg.$('#cfgBody select[data-k="pnlSecond"]') !== null, "Chart settings has P&L shown as: Main and Second");
  ok(await pg.inputValue('#cfgBody select[data-k="pnlMain"]') === "amt" && await pg.inputValue('#cfgBody select[data-k="pnlSecond"]') === "pct", "...showing the units in use");
  ok(/₹10,00,000/.test(await pg.textContent("#cfgBody")), "...and the account size the % is of");
  await pg.selectOption('#cfgBody select[data-k="pnlSecond"]', "none"); await pg.waitForTimeout(500);
  s = await state();
  ok(s.units === "amt,none" && /^SL −₹[\d,]+$/.test(s.slT) && /^[+−]?₹[\d,]+$/.test(s.bar), `Second: None: just the amount (${s.slT}; bar ${s.bar})`);
  await pg.selectOption('#cfgBody select[data-k="pnlMain"]', "r"); await pg.waitForTimeout(400);
  await pg.selectOption('#cfgBody select[data-k="pnlSecond"]', "r"); await pg.waitForTimeout(400);
  ok(await pg.evaluate(() => pnlUnits().join()) === "r,none", "the same unit twice: shown once");
  await pg.selectOption('#cfgBody select[data-k="pnlSecond"]', "amt"); await pg.waitForTimeout(500);
  s = await state();
  ok(s.slT === `SL ${fx(s.sl / s.R, 2)}R · −₹${Math.round(-s.sl).toLocaleString("en-IN")}`, "Main R, Second Amount: " + s.slT);
  await pg.screenshot({ path: SHOT + "units_04_settings.png" });
  // v0.43.1: the unit button on the position bar (Chart settings, off by default)
  ok(!(await pg.$("#posbars .pbu")), "the position bar's unit button is off by default");
  await pg.click('#cfgBody input[data-k="pnlBtn"]'); await pg.waitForTimeout(500);
  ok(await pg.isVisible("#posbars .pbu") && (await pg.textContent("#posbars .pbu")).trim() === "R", "switched on: a button on the position bar showing the main unit (R)");
  await pg.click("#bCfg");
  // v0.43.3: ✕ alone at the far left of the bar, the unit / BE / BE-T / TRAIL buttons on the right, a clear gap between
  { const g = await pg.evaluate(() => { const bar = document.querySelector("#posbars .pbar"), x = bar.querySelector('[data-a="close"]');
      const others = [...bar.querySelectorAll("button, input")].filter(e => e !== x).map(e => e.getBoundingClientRect());
      const xr = x.getBoundingClientRect(), u = bar.querySelector(".pbu").getBoundingClientRect();
      return {first: bar.firstElementChild === x, gap: Math.min(...others.map(r => r.left - xr.right)), allRight: others.every(r => r.left > xr.right), unitGap: u.left - xr.right}; });
    ok(g.first && g.allRight, "✕ is the bar's first button, every other button is to its right");
    ok(g.gap >= 60 && g.unitGap >= 60, `✕ is well away from the nearest button (${Math.round(g.gap)} px) and from the unit button (${Math.round(g.unitGap)} px)`); }
  await pg.click("#posbars .pbu"); await pg.waitForTimeout(500);
  ok(await pg.evaluate(() => pnlUnits()[0]) === "amt" && (await pg.textContent("#posbars .pbu")).trim() === "₹", "a click: Amount (the button says ₹)");
  await pg.click("#posbars .pbu"); await pg.waitForTimeout(500);
  ok(await pg.evaluate(() => pnlUnits()[0]) === "pct" && (await pg.textContent("#posbars .pbu")).trim() === "%" && /%/.test(await pg.textContent("#posbars .pbar .pu")),
     "another click: % of account (" + (await pg.textContent("#posbars .pbar .pu")) + ")");
  await pg.click("#posbars .pbu"); await pg.waitForTimeout(500);
  ok(await pg.evaluate(() => pnlUnits()[0]) === "r" && (await pg.textContent("#posbars .pbu")).trim() === "R", "and back to R");
  await pg.screenshot({ path: SHOT + "units_04b_button.png" });
  ok(await pg.evaluate(async () => { await new Promise(r => setTimeout(r, 900)); return (await api("/api/prefs")).prefs.chart.pnlBtn === true; }), "the switch is saved on the server");
  await pg.click("#bCfg");
  await pg.click('#cfgBody input[data-k="pnlBtn"]'); await pg.waitForTimeout(500);
  ok(!(await pg.$("#posbars .pbu")), "switched off: the button goes");
  await pg.click('#cfgBody input[data-k="pnlBtn"]'); await pg.waitForTimeout(500);   // (on again: the phone checks it too)
  await pg.click("#bCfg");

  // ---- a click on a zone's money label cycles too
  const hit = await pg.evaluate(() => { const z = (P.zoneHits || [])[0]; return z && {x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2}; });
  ok(!!hit, "the zone labels are clickable");
  if(hit){ const cb = await pg.$eval("#chart", e => { const r = e.querySelector("canvas").getBoundingClientRect(); return {x: r.x, y: r.y}; });
    const u0 = await pg.evaluate(() => pnlUnits()[0]);
    await pg.mouse.click(cb.x + hit.x, cb.y + hit.y); await pg.waitForTimeout(500);
    ok(await pg.evaluate(() => pnlUnits()[0]) !== u0, "a click on the SL zone's label switched the unit: " + u0 + " -> " + await pg.evaluate(() => pnlUnits()[0])); }
  await pg.evaluate(() => { prefSet("chart", {...(prefGet("chart", {}) || {}), pnlMain: "r", pnlSecond: "amt"}); pnlRefresh(); });

  // ---- the new-trade tool in R
  await pg.click("#cBuy");
  await pg.waitForFunction(() => P.plan && P.plan.risk && P.plan.reward, null, { timeout: 10000 });
  await pg.waitForTimeout(800);
  const tool = await pg.evaluate(() => { const z = zoneList().find(z => z.tool); return {sl: z.slTxt, tp: z.tpTxt, rr: P.plan.reward / P.plan.risk, box: document.querySelector("#toolBox, .toolbox, #tplace") ? "" : ""}; });
  ok(/^−1\.00R · −₹[\d,]+$/.test(tool.sl), "the tool's SL zone: " + tool.sl);
  ok(tool.tp.startsWith(fx(tool.rr, 2) + "R · +₹"), `the tool's TP zone: ${tool.tp} (net RR ${tool.rr.toFixed(2)})`);
  await pg.screenshot({ path: SHOT + "units_05_tool.png" });
  await pg.evaluate(() => disarm());

  // ---- a pending order: 1R = what its stop would lose
  const o = await pg.evaluate(([c, px]) => papi("place", {s: c, side: 1, type: "limit", price: px, sl: px - 12, tp: px + 24, mode: "lots", lots: 1, product: "MARGIN"}), [CRUDE, Math.round(ltp) - 40]);
  ok(o.ok, "a limit order with SL and TP" + (o.ok ? "" : ": " + o.error));
  await pg.waitForTimeout(800);
  const ot = await pg.evaluate(() => { const titles = P.posLines.map(l => l.options().title); return {sl: titles.filter(t => /^SL /.test(t)), panel: document.querySelector("#ordList .pl i.down").textContent}; });
  ok(ot.sl.some(t => /^SL −1\.00R · −₹/.test(t)) && /^−1\.00R/.test(ot.panel), "the order's SL: −1.00R (" + ot.panel + ")");

  // ---- the Trades page
  await pg.click('#nav button[data-pg="trades"]'); await pg.waitForSelector("#pgPos tr[data-id]");
  await pg.waitForTimeout(1200);
  const tp = await pg.evaluate(() => ({heads: [...document.querySelectorAll("#pgPos th")].map(t => t.textContent),
    net: document.querySelector('#pgPos [data-f="net"]').textContent, sec: document.querySelector('#pgPos [data-f="r"]').textContent,
    atsl: document.querySelector('#pgPos [data-f="atsl"]').textContent, open: document.querySelector("#pgAcctCards .pu").textContent,
    osl: [...document.querySelectorAll("#pgOrd td")].map(t => t.textContent).find(t => /R ·/.test(t))}));
  ok(tp.heads.includes("Net P&L R") && tp.heads.includes("Net P&L"), "Trades page columns: " + tp.heads.filter(h => /P&L|R$|%/.test(h)).join(" | "));
  ok(/^[+−]?\d+\.\d\dR$/.test(tp.net) && /₹/.test(tp.sec), `Trades page: ${tp.net} | ${tp.sec}; at SL ${tp.atsl}`);
  ok(/R ·/.test(tp.open), "the Open P&L card: " + tp.open);
  ok(/^−1\.00R/.test(tp.osl || ""), "the order's risk: " + tp.osl);
  await pg.keyboard.press("u"); await pg.waitForTimeout(600);
  ok(await pg.evaluate(() => pnlUnits().join()) === "amt,r" && /^[+−]?₹/.test(await pg.textContent('#pgPos [data-f="net"]')), "U on the Trades page: amount (" + await pg.textContent('#pgPos [data-f="net"]') + ")");
  await pg.screenshot({ path: SHOT + "units_06_trades.png" });
  await pg.click('#nav button[data-pg="chart"]');

  // ---- saved: a reload keeps the units
  await pg.evaluate(() => { prefSet("chart", {...(prefGet("chart", {}) || {}), pnlMain: "pct", pnlSecond: "r"}); });
  await pg.waitForTimeout(1200);
  await pg.reload(); await LOGIN(pg);
  await pg.waitForFunction(() => P.snap && P.snap.positions.length, null, { timeout: 15000 });
  ok(await pg.evaluate(() => pnlUnits().join()) === "pct,r", "after a reload: % of account · R");
  ok(errs.length === 0, "no script errors" + (errs.length ? ": " + errs.join(" | ") : ""));

  // ---- the phone
  const ph = await br.newContext({ ...devices["Pixel 7"] });
  const m = await ph.newPage();
  const merrs = []; m.on("pageerror", e => merrs.push(e.message));
  await m.goto(B); await LOGIN(m);
  await m.waitForFunction(id => document.body.classList.contains("mob") && P.snap && ACCT === id, ta, { timeout: 15000 }).catch(async () => {
    await m.evaluate(id => acctSwitch(id), ta); await m.waitForFunction(id => P.snap && ACCT === id, ta, { timeout: 10000 }); });
  await m.waitForFunction(() => P.snap.positions.length, null, { timeout: 10000 });
  await m.waitForTimeout(1500);
  const chip = await m.evaluate(() => (document.querySelector('#mChips [data-f="n"]') || {}).textContent);
  ok(/%$/.test(chip || ""), "phone: the position chip in %: " + chip);
  ok(await m.isVisible("#mChips .mpu"), "phone: the unit button is shown with the trade chips (the setting is saved on the server; the phone has no position bars)");
  { const g = await m.evaluate(() => { const u = document.querySelector("#mChips .mpu").getBoundingClientRect(), c = [...document.querySelectorAll("#mChips [data-id]")].map(e => e.getBoundingClientRect());
      return {right: c.every(r => r.right < u.left), gap: Math.min(...c.map(r => u.left - r.right)), edge: innerWidth - u.right}; });
    ok(g.right && g.edge < 20, `phone: v0.43.3, the unit button sits at the right end, away from the trade chips (gap ${Math.round(g.gap)} px)`); }
  { const u0 = await m.evaluate(() => pnlUnits()[0]); await m.tap("#mChips .mpu"); await m.waitForTimeout(600);
    const u1 = await m.evaluate(() => [pnlUnits()[0], document.querySelector("#mChips .mpu").textContent.trim(), (document.querySelector('#mChips [data-f="n"]') || {}).textContent]);
    ok(u1[0] !== u0 && u1[1] === (u1[0] === "pct" ? "%" : u1[0] === "r" ? "R" : "₹"), `phone: a tap on it switches the unit: ${u0} → ${u1[0]} (button ${u1[1]}, chip ${u1[2]})`);
    await m.tap("#mChips .mpu"); await m.waitForTimeout(400); await m.tap("#mChips .mpu"); await m.waitForTimeout(600);
    ok(await m.evaluate(u => pnlUnits()[0] === u, u0), "phone: three taps: back where it started"); }
  await m.screenshot({ path: SHOT + "units_07b_phone_button.png" });
  await m.evaluate(() => { prefSet("chart", {...(prefGet("chart", {}) || {}), pnlMain: "pct", pnlSecond: "r"}); pnlRefresh(); });   // (the taps moved the second unit)
  await m.waitForTimeout(400);
  await m.evaluate(() => mPosSheet(P.snap.positions[0].id));
  await m.waitForSelector('#mSheet [data-f="net"]');
  await m.waitForTimeout(600);
  const sh = () => m.evaluate(() => ({net: document.querySelector('#mSheet [data-f="net"]').textContent, rl: document.querySelector('#mSheet [data-f="rl"]').textContent,
    r: document.querySelector('#mSheet [data-f="r"]').textContent, atsl: document.querySelector('#mSheet [data-f="atsl"]').textContent}));
  let a = await sh();
  ok(/%$/.test(a.net) && a.rl === "R now" && /R$/.test(a.r) && /% · /.test(a.atsl), `phone sheet: ${a.net} | ${a.rl} ${a.r} | at SL ${a.atsl}`);
  await m.screenshot({ path: SHOT + "units_07_phone.png" });
  await m.tap('#mSheet [data-f="net"]'); await m.waitForTimeout(600);
  a = await sh();
  ok(/R$/.test(a.net) && a.rl === "% of account" && /%$/.test(a.r), `phone: a tap on the P&L switched it: ${a.net} | ${a.rl} ${a.r}`);
  await m.evaluate(() => mClose());
  await m.evaluate(() => mShow("trade")); await m.waitForSelector("#mtAcct .pu"); await m.waitForTimeout(800);
  const ml = await m.evaluate(() => ({net: document.querySelector('#ms_trade .mpos [data-f="net"]').textContent, open: document.querySelector("#mtAcct .pu").textContent}));
  ok(/R$/.test(ml.net) && /R · /.test(ml.open), `phone Trade tab: ${ml.net}; Open P&L ${ml.open}`);
  await m.screenshot({ path: SHOT + "units_08_phone_trade.png" });
  ok(merrs.length === 0, "phone: no script errors" + (merrs.length ? ": " + merrs.join(" | ") : ""));
  await ph.close();

  // ---- clean up: the default units, the trade and order closed, the test account archived
  await pg.evaluate(() => { const c = {...(prefGet("chart", {}) || {})}; delete c.pnlMain; delete c.pnlSecond; delete c.pnlBtn; prefSet("chart", c); });
  for(const id of await pg.evaluate(() => P.snap.orders.map(x => x.id))) await pg.evaluate(id => papi("cancel", {id}), id);
  for(const id of await pg.evaluate(() => P.snap.positions.map(x => x.id))) await pg.evaluate(id => papi("close", {id}), id);
  await pg.waitForTimeout(1000);
  await pg.evaluate(async ({main, ta}) => { acctSwitch(main); await api("/api/accounts/update", {body: {id: ta, archived: true}}); await acctRefresh(); }, {main, ta});
  await br.close();
})().catch(async e => { ok(false, "crashed: " + e.message); if(br) await br.close(); });
