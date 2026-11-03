// Indicator read-outs with many values (owner, 3 Nov 2026: "if the indicator has too many values, there is no way to
// click on the visibility toggle as it goes beyond the screen"). Needs the mock server and an admin with 2FA (run
// security_flow.js first). Checks, on a narrow window and on the phone:
// - a read-out never runs past the chart's price scale; long values wrap onto more lines;
// - its buttons (eye, settings, source, remove) come right after the name and are inside the chart;
// - the eye works (hide, then show) on an indicator on the candles and one in its own pane;
// - read-outs on the candles stack without overlapping when one wraps.
const { chromium, devices } = require("playwright");
const LOGIN = require("./login.js");
const fs = require("fs");
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const SYM = "MCX:CRUDEOIL26NOVFUT";
const plots = (n, f) => Array.from({length: n}, (_, i) => f(i)).join("\n");
const MANY_OVER = `//@version=6
indicator("T Many levels on the candles", "Many levels", overlay = true)
len = input.int(20, "Length")
mult = input.float(1.5, "Mult")
${plots(24, i => `plot(close + ${i - 12} * ta.atr(14) * mult / 4, "L${i}", ${i < 12 ? "color.red" : "color.green"})`)}
`;
const MANY_PANE = `//@version=6
indicator("T Many oscillators", "Many osc", overlay = false)
${plots(24, i => `plot(ta.rsi(close, ${5 + i}), "R${i}", color.blue)`)}
`;
const SMALL = `//@version=6
indicator("T Small", overlay = true)
plot(ta.sma(close, 9), "SMA", color.orange)
`;
let br;
(async () => {
  br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 1000, height: 760 } })).newPage();
  const errs = []; pg.on("pageerror", e => { errs.push(e.message); fs.writeSync(1, "PAGEERROR " + e.message + "\n"); });
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  const save = (name, source) => pg.evaluate(async ([name, source]) => { await pineLoad(true); const old = PINE.scripts.find(s => s.name === name);
    const j = await api("/api/scripts/save", {body: {id: old ? old.id : null, name, source}}); PINE.scripts = j.scripts; PINE.loaded = true; return j.script.id; }, [name, source]);
  const ids = [await save("T Many over", MANY_OVER), await save("T Many pane", MANY_PANE), await save("T Small", SMALL)];
  await pg.evaluate(async s => { prefSet("lgdMin0", false); ctSave({type: "candles"}); setTf("5m"); await openBySymbol(s); }, SYM);
  await pg.waitForFunction(() => DISP.length > 100, null, { timeout: 30000 });
  await pg.evaluate(ids => { indSave([{type: "pine", id: "mo", scriptId: ids[0], inputs: {}, overlay: true},
                                      {type: "pine", id: "sm", scriptId: ids[2], inputs: {}, overlay: true},
                                      {type: "pine", id: "mp", scriptId: ids[1], inputs: {}}]); indBuild(); }, ids);
  await pg.waitForFunction(() => INDS.length === 3 && INDS.every(r => r.pine && r.pine.res), null, { timeout: 60000 });
  await pg.waitForTimeout(1500);

  const geo = () => pg.evaluate(() => {
    const box = document.querySelector("#chart").getBoundingClientRect(), psw = chart.priceScale("right").width();
    const right = box.left + box.width - psw;
    return INDS.map((r, i) => { const el = document.querySelector("#lgd" + (i + 1)), b = el.getBoundingClientRect();
      const nm = el.querySelector(".lname").getBoundingClientRect(), eye = el.querySelector(".leye").getBoundingClientRect(),
            del = el.querySelector('[data-la="del"]').getBoundingClientRect(), v = el.querySelector(".lvals");
      return {id: r.cfg.id, pane: r.pane, right: b.right, limit: right, lines: Math.round(b.height / 15), h: b.height, top: b.top, bottom: b.bottom,
              eyeIn: eye.right <= right && eye.left >= box.left && eye.bottom <= box.bottom, delIn: del.right <= right,
              afterName: eye.left >= nm.right - 1 && (!v || !v.firstChild || eye.right <= v.getBoundingClientRect().left + 1 || eye.top < v.getBoundingClientRect().bottom),
              vals: v ? v.textContent.trim().split(/\s+/).length : 0}; });
  });
  let g = await geo();
  const mo = g.find(x => x.id === "mo"), mp = g.find(x => x.id === "mp"), sm = g.find(x => x.id === "sm");
  ok(mo.vals >= 24 && mp.vals >= 24, `the two long read-outs carry all their values (${mo.vals} and ${mp.vals})`);
  ok(g.every(x => x.right <= x.limit + 1), `no read-out runs past the price scale (${g.map(x => `${x.id} ${Math.round(x.right)}/${Math.round(x.limit)}`).join(", ")})`);
  ok(mo.lines >= 2 && mp.lines >= 2, `long values wrap onto more lines (${mo.lines} and ${mp.lines} lines)`);
  ok(g.every(x => x.eyeIn && x.delIn), "every read-out's eye and ✕ are inside the chart");
  ok(g.every(x => x.afterName), "the buttons come right after the name, before the values");
  ok(sm.top >= mo.bottom, `read-outs on the candles stack without overlapping (Many levels ends ${Math.round(mo.bottom)}, Small starts ${Math.round(sm.top)})`);
  await pg.screenshot({ path: SHOT + "legend_long_desktop.png" });

  // the eye, by a real mouse: hover the row, click its eye (hide), click again (show)
  for(const id of ["mo", "mp"]){
    const n = await pg.evaluate(id => INDS.findIndex(r => r.cfg.id === id) + 1, id);
    await pg.hover(`#lgd${n} .lname`);
    await pg.click(`#lgd${n} .leye`);
    await pg.waitForTimeout(400);
    const hid = await pg.evaluate(id => !!INDS.find(r => r.cfg.id === id).cfg.hidden, id);
    await pg.hover(`#lgd${n} .lname`);
    await pg.click(`#lgd${n} .leye`);
    await pg.waitForTimeout(400);
    const back = await pg.evaluate(id => !INDS.find(r => r.cfg.id === id).cfg.hidden, id);
    ok(hid && back, `${id === "mo" ? "on the candles" : "in its own pane"}: the eye hides the indicator and shows it again (${hid}, ${back})`);
  }

  // narrower still: the rows follow the chart's width (re-placed every second)
  await pg.setViewportSize({ width: 760, height: 760 });
  await pg.waitForTimeout(1600);
  g = await geo();
  ok(g.every(x => x.right <= x.limit + 1 && x.eyeIn), `after the window narrows the rows still fit and the eyes are in reach (${g.map(x => Math.round(x.right) + "/" + Math.round(x.limit)).join(", ")})`);

  // the phone: buttons always shown (no hover), same rules
  const ph = await (await br.newContext({ ...devices["Pixel 7"] })).newPage();
  ph.on("pageerror", e => { errs.push(e.message); fs.writeSync(1, "PAGEERROR (phone) " + e.message + "\n"); });
  await ph.goto("http://localhost:8766/"); await LOGIN(ph);
  await ph.waitForFunction(() => typeof INDS !== "undefined" && INDS.length === 3 && INDS.every(r => r.pine && r.pine.res), null, { timeout: 60000 });
  await ph.waitForTimeout(1500);
  const pgeo = await ph.evaluate(() => {
    const box = document.querySelector("#chart").getBoundingClientRect(), right = box.left + box.width - chart.priceScale("right").width();
    return INDS.map((r, i) => { const el = document.querySelector("#lgd" + (i + 1)), b = el.getBoundingClientRect(), eye = el.querySelector(".leye");
      const e = eye.getBoundingClientRect(); return {right: b.right, limit: right, eyeIn: e.right <= right && e.width > 0, shown: getComputedStyle(el.querySelector(".lacts")).visibility === "visible"}; });
  });
  ok(pgeo.every(x => x.right <= x.limit + 1 && x.eyeIn && x.shown), `phone: rows fit, eyes shown and in reach (${JSON.stringify(pgeo.map(x => [Math.round(x.right), Math.round(x.limit), x.shown]))})`);
  const pn = await ph.evaluate(() => INDS.findIndex(r => r.cfg.id === "mo") + 1);
  await ph.tap(`#lgd${pn} .leye`); await ph.waitForTimeout(400);
  const phid = await ph.evaluate(() => !!INDS.find(r => r.cfg.id === "mo").cfg.hidden);
  await ph.tap(`#lgd${pn} .leye`); await ph.waitForTimeout(400);
  ok(phid && await ph.evaluate(() => !INDS.find(r => r.cfg.id === "mo").cfg.hidden), "phone: tapping the eye hides and shows the indicator");
  await ph.screenshot({ path: SHOT + "legend_long_phone.png" });

  await pg.evaluate(() => { indSave([]); indBuild(); });
  ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""));
  await br.close();
})().catch(async e => { ok(false, "crashed: " + e.message); if(br) await br.close(); });
