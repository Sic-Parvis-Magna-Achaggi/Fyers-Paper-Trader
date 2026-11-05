// Journal pictures (v0.27.0) in a browser, against the fake Fyers and the fake Telegram:
//  a trade opened and closed with its chart on screen gets four pictures (the server's at entry and exit, the chart's own
//  at entry and exit); the pictures are served (full size and the small copy); the card shows them; the viewer (chips,
//  arrows, label, Draw again, delete); ＋ Add pictures, paste and drop; 📷 on the chart bar; with the Journal on screen
//  (chart hidden) only the server draws; Journal › Settings › Pictures; the Telegram copy (test, every new picture,
//  deleting deletes the copy); the phone (the strip and the viewer full screen).
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
  const ctx = await br.newContext({ viewport: { width: 1400, height: 900 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.waitForFunction(() => P.snap, null, { timeout: 20000 });
  await fetch(TG + "/_reset", {method: "POST"});
  await pg.evaluate(async () => {
    if(P.snap.mode === "live") throw new Error("the admin's account is Live - run live_flow.js to the end first");
    await papi("reset", {confirm: "RESET", capital: 1000000});
    await papi("trail", {be_on: false, sl_on: false});
    await api("/api/journal/settings", {body: {rules: {block_dd: false, block_afk: false, block_end: false}, shots: {auto: true, chart: true, res: "5", bars: 120, tg: false}}});
    prefSet("tf2", "5m");
  });
  await pg.evaluate(async c => { await openBySymbol(c); if(tf !== "5m") setTf("5m"); }, CRUDE);
  await pg.waitForFunction(() => cur && last[cur.s] && typeof HROWS !== "undefined" && HROWS.length, null, { timeout: 20000 });
  await pg.waitForTimeout(800);
  const place = (side = 1) => pg.evaluate(async side => { const l = last[cur.s];
    const j = await papi("place", {s: cur.s, side, type: "market", sl: Math.round(l.ltp - side * 30), tp: Math.round(l.ltp + side * 60), mode: "lots", lots: 1, product: "MARGIN"});
    return j.ok ? "ok" : j.error; }, side);
  const closeAll = () => pg.evaluate(async () => { for(const p of P.snap.positions) await papi("close", {id: p.id}); });
  const jget = () => pg.evaluate(async () => (await api("/api/journal")).j);
  const newest = j => j.trades.slice().sort((a, b) => (b.opened || 0) - (a.opened || 0))[0];

  // ---- a trade with its chart on screen: four pictures
  ok(await place() === "ok", "a trade on CRUDEOIL with its 5m chart on screen");
  await pg.waitForTimeout(3500);
  await closeAll();
  let t = null;
  for(let i = 0; i < 40; i++){ await pg.waitForTimeout(500); t = newest(await jget()); if((t.shots || []).length >= 4) break; }
  const kinds = (t.shots || []).map(s => `${s.kind}:${s.phase}:${s.tf}`).sort().join(" ");
  ok(kinds === "chart:entry:5m chart:exit:5m server:entry:5m server:exit:5m", `four pictures: the server's and the chart's, at entry and exit (${kinds})`);
  const tid = t.id;
  const srvEntry = t.shots.find(s => s.kind === "server" && s.phase === "entry");
  const chartEntry = t.shots.find(s => s.kind === "chart" && s.phase === "entry");
  const got = await pg.evaluate(async ([id, a, b]) => {
    const f = async (sid, thumb) => { const r = await fetch(`/api/journal/shot?id=${encodeURIComponent(id)}&shot=${sid}${thumb ? "&thumb=1" : ""}`); const buf = new Uint8Array(await r.arrayBuffer()); return {st: r.status, ct: r.headers.get("content-type"), n: buf.length, head: [...buf.slice(0, 4)].join(",")}; };
    return {full: await f(a), thumb: await f(a, 1), chart: await f(b), none: (await fetch(`/api/journal/shot?id=${encodeURIComponent(id)}&shot=nope`)).status};
  }, [tid, srvEntry.id, chartEntry.id]);
  ok(got.full.st === 200 && got.full.ct === "image/png" && got.full.head === "137,80,78,71" && got.full.n > 5000, `the server's picture is served (PNG, ${got.full.n} bytes)`);
  ok(got.thumb.st === 200 && got.thumb.ct === "image/jpeg" && got.thumb.n < got.full.n, `its small copy for the list (JPEG, ${got.thumb.n} bytes)`);
  ok(got.chart.st === 200 && got.chart.n > 5000 && chartEntry.w > 300, `the chart's own picture is served (${chartEntry.w}×${chartEntry.h})`);
  ok(got.none === 404, "an unknown picture: 404");
  fs.writeFileSync(SHOT + "jshot_server_entry.png", Buffer.from(await pg.evaluate(async ([id, s]) => [...new Uint8Array(await (await fetch(`/api/journal/shot?id=${encodeURIComponent(id)}&shot=${s}`)).arrayBuffer())], [tid, t.shots.find(s => s.kind === "server" && s.phase === "exit").id])));
  fs.writeFileSync(SHOT + "jshot_chart_entry.png", Buffer.from(await pg.evaluate(async ([id, s]) => [...new Uint8Array(await (await fetch(`/api/journal/shot?id=${encodeURIComponent(id)}&shot=${s}`)).arrayBuffer())], [tid, chartEntry.id])));

  // ---- the card and the viewer
  await pg.click('#nav button[data-pg="journal"]');
  await pg.waitForSelector(`.jn-trade[data-id="${tid}"]`, { timeout: 10000 });
  ok(/📷 4/.test(await pg.textContent(`.jn-trade[data-id="${tid}"] .jt-row`)), "the trade's row shows 📷 4");
  await pg.click(`.jn-trade[data-id="${tid}"] .jt-row`);
  await pg.waitForSelector(`.jn-trade[data-id="${tid}"] .js-th img`);
  await pg.waitForFunction(id => [...document.querySelectorAll(`.jn-trade[data-id="${id}"] .js-th img`)].every(i => i.complete && i.naturalWidth > 0), tid, {timeout: 10000});
  const labels = await pg.$$eval(`.jn-trade[data-id="${tid}"] .js-lbl`, x => x.map(e => e.textContent));
  ok(labels.length === 4 && labels.join("|") === "5m · entry|Chart 5m · entry|5m · exit|Chart 5m · exit", `the card shows the 4 small pictures in order (${labels.join(" | ")})`);
  await pg.screenshot({ path: SHOT + "jshots_card.png" });
  await pg.click(`.jn-trade[data-id="${tid}"] .js-th >> nth=0`);
  await pg.waitForSelector("#jsView:not(.hide) #jsImg");
  await pg.waitForFunction(() => { const i = document.querySelector("#jsImg"); return i && i.complete && i.naturalWidth === 1280; }, null, {timeout: 10000});
  ok(await pg.$$eval("#jsView .js-chips button", x => x.length) === 4, "the viewer: the picture full size, a chip for each");
  await pg.screenshot({ path: SHOT + "jshots_viewer.png" });
  const sid0 = await pg.evaluate(() => JS.view.sid);
  await pg.keyboard.press("ArrowRight"); await pg.waitForTimeout(150);
  const sid1 = await pg.evaluate(() => JS.view.sid);
  await pg.keyboard.press("ArrowLeft"); await pg.waitForTimeout(150);
  ok(sid1 !== sid0 && await pg.evaluate(() => JS.view.sid) === sid0, "→ and ← step through the pictures");
  // Draw again (server picture)
  await pg.click("#jsRedraw");
  let re = null;
  for(let i = 0; i < 30; i++){ await pg.waitForTimeout(400); re = (await jget()).trades.find(x => x.id === tid).shots.find(s => s.kind === "server" && s.phase === "entry"); if(re && re.id !== srvEntry.id) break; }
  ok(re && re.id !== srvEntry.id, "Draw again: the server draws a new entry picture in its place");
  await pg.keyboard.press("Escape"); await pg.waitForTimeout(200);
  ok(await pg.evaluate(() => !JS.view), "Escape closes the viewer");

  // ---- ＋ Add pictures, paste, drop
  await pg.evaluate(() => jnLoad()); await pg.waitForTimeout(700);
  if(!(await pg.$(`.jn-trade[data-id="${tid}"].expanded`))) await pg.click(`.jn-trade[data-id="${tid}"] .jt-row`);
  const png = fs.readFileSync(SHOT + "jshot_chart_entry.png");
  const [chooser] = await Promise.all([pg.waitForEvent("filechooser"), pg.click(`.jn-trade[data-id="${tid}"] [data-act="addpic"]`)]);
  await chooser.setFiles({ name: "my_15m.png", mimeType: "image/png", buffer: png });
  await pg.waitForSelector("#jsView:not(.hide) #jsTf", {timeout: 10000});
  ok(await pg.$eval("#jsTf", s => s.value) === "Context", "＋ Add pictures: the viewer opens on it, labelled Context until you pick");
  await pg.selectOption("#jsTf", "15m"); await pg.waitForTimeout(700);
  t = (await jget()).trades.find(x => x.id === tid);
  const up = t.shots.find(s => s.kind === "upload");
  ok(up && up.tf === "15m" && up.name === "my_15m.png", `its label is saved (${up && up.tf}, ${up && up.name})`);
  await pg.keyboard.press("Escape"); await pg.waitForTimeout(200);
  const pasted = await pg.evaluate(async b64 => {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bin], "image.png", {type: "image/png"}));
    document.dispatchEvent(new ClipboardEvent("paste", {clipboardData: dt, bubbles: true, cancelable: true}));
    await new Promise(r => setTimeout(r, 1500));
    return JN.d.trades.find(x => x.id === JS.last).shots.filter(s => s.kind === "upload").length;
  }, png.toString("base64"));
  ok(pasted === 2, "paste (Ctrl+V) on the Journal adds a picture to the open trade");
  await pg.keyboard.press("Escape"); await pg.waitForTimeout(200);
  await pg.evaluate(() => jnRender()); await pg.waitForTimeout(300);
  const dropped = await pg.evaluate(async ([b64, id]) => {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bin], "drop.png", {type: "image/png"}));
    const strip = document.querySelector(`.jn-trade[data-id="${id}"] .js-strip`);
    strip.dispatchEvent(new DragEvent("dragover", {dataTransfer: dt, bubbles: true, cancelable: true}));
    strip.dispatchEvent(new DragEvent("drop", {dataTransfer: dt, bubbles: true, cancelable: true}));
    await new Promise(r => setTimeout(r, 1500));
    return JN.d.trades.find(x => x.id === id).shots.filter(s => s.kind === "upload").length;
  }, [png.toString("base64"), tid]);
  ok(dropped === 3, "dropping a picture on the card adds it");
  await pg.keyboard.press("Escape"); await pg.waitForTimeout(200);
  const bad = await pg.evaluate(async id => { const r = await fetch(`/api/journal/shot/add?id=${encodeURIComponent(id)}&tf=5m`, {method: "POST", body: "<html>not a picture</html>"}); return (await r.json()).error; }, tid);
  ok(/isn't a PNG, JPEG, WebP or GIF/.test(bad || ""), "something that isn't a picture is refused");
  const big = await pg.evaluate(async id => { const b = new Uint8Array(10.5 * 1024 * 1024); b.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const r = await fetch(`/api/journal/shot/add?id=${encodeURIComponent(id)}&tf=5m`, {method: "POST", body: b}); return [r.status, (await r.json()).error]; }, tid);
  ok(big[0] === 413 && /up to 10 MB/.test(big[1] || ""), "a picture over 10 MB is refused");
  // delete (two taps)
  const n0 = (await jget()).trades.find(x => x.id === tid).shots.length;
  await pg.evaluate(id => { const t = JN.d.trades.find(x => x.id === id); jsView(id, t.shots.find(s => s.kind === "upload").id); }, tid);
  await pg.click("#jsDel"); await pg.waitForTimeout(150);
  ok(/Tap again/.test(await pg.textContent("#jsDel")), "Delete asks for a second tap");
  await pg.click("#jsDel"); await pg.waitForTimeout(700);
  ok((await jget()).trades.find(x => x.id === tid).shots.length === n0 - 1, "...then the picture is deleted");
  await pg.keyboard.press("Escape");

  // ---- in the audit form too
  await pg.click(`.jn-trade[data-id="${tid}"] [data-act="audit"]`);
  await pg.waitForSelector("#jnModal .js-strip .js-th");
  ok(await pg.$$eval("#jnModal .js-th", x => x.length) === n0 - 1, "the audit form shows the pictures too");
  await pg.click("#jnModal .js-th >> nth=0"); await pg.waitForSelector("#jsView:not(.hide)");
  await pg.keyboard.press("Escape"); await pg.waitForTimeout(200);
  ok(await pg.isVisible("#jnModal .jn-mbox") && await pg.evaluate(() => !JS.view), "Escape closes the viewer, not the audit form under it");
  await pg.click("#jnClose"); await pg.waitForTimeout(200);

  // ---- the Journal on screen (chart hidden): only the server draws
  ok(await place() === "ok", "a trade placed while the Journal is on screen");
  await pg.waitForTimeout(2500); await closeAll();
  let t2 = null;
  for(let i = 0; i < 30; i++){ await pg.waitForTimeout(500); t2 = newest(await jget()); if((t2.shots || []).length >= 2) break; }
  await pg.waitForTimeout(2500); t2 = (await jget()).trades.find(x => x.id === t2.id);
  ok(t2.id !== tid && t2.shots.length === 2 && t2.shots.every(s => s.kind === "server"), `chart hidden: only the server's two pictures (${t2.shots.map(s => s.kind + ":" + s.phase).join(", ")})`);

  // ---- 📷 on the chart bar
  await pg.click('#nav button[data-pg="chart"]'); await pg.waitForTimeout(800);
  ok(await pg.isVisible("#bSnap"), "📷 on the chart bar");
  ok(await place() === "ok", "an open trade on this contract");
  await pg.waitForTimeout(2500);
  await pg.click("#bSnap"); await pg.waitForTimeout(1800);
  const t3 = newest(await jget());
  ok(t3.status === "open" && t3.shots.some(s => s.kind === "upload" && s.tf === "5m"), "📷 adds this chart's picture (5m) to the open trade on this contract");
  await closeAll(); await pg.waitForTimeout(3000);

  // ---- Settings › Pictures and the Telegram copy
  const uid = await pg.evaluate(() => S.user.uid);
  execSync(`python3 -c "import sys; sys.path.insert(0, '.'); from helper import telegram, users; s = telegram.load('${uid}'); s['token'] = users.seal('1234567:abc'); s['bot'] = 'ftm_test_bot'; s['chat'] = '5550001'; telegram.save('${uid}', s)"`, {env: {...process.env, FYERS_HELPER_DATA: D}, cwd: __dirname + "/.."});
  await pg.click('#nav button[data-pg="journal"]');
  await pg.click('#jnSub button[data-v="settings"]');
  await pg.waitForSelector("#jsSet #jsChat", {timeout: 10000});
  const st = await pg.textContent("#jsSet");
  ok(/Draw a picture on the server at every entry and exit/.test(st) && /@ftm_test_bot/.test(st) && /pictures? on the server/.test(st), "Settings › Pictures: the switches, the bot from Telegram alerts, space used");
  await pg.selectOption("#jsRes", "15"); await pg.waitForTimeout(700);
  ok((await jget()).shots_cfg.res === "15", "the picture's timeframe is saved (15m)");
  await pg.selectOption("#jsRes", "5"); await pg.waitForTimeout(700);
  await pg.fill("#jsChat", "my channel"); await pg.click("#jsChatSave"); await pg.waitForTimeout(500);
  ok(/a number like -1001234567890/.test(await pg.textContent("#jsSetSt")), "a chat that isn't a number or @name is refused");
  await pg.fill("#jsChat", "-1009990001"); await pg.click("#jsChatSave"); await pg.waitForTimeout(700);
  await pg.click("#jsTgTest"); await pg.waitForTimeout(800);
  ok(/Sent/.test(await pg.textContent("#jsSetSt")) && (await tgGet("/_sent")).some(m => m.chat === "-1009990001" && /Journal backup/.test(m.text)), "Send a test: the message reaches that chat");
  // v0.33.1: a separate channel for Live trades (the admin)
  ok(await pg.isVisible("#jsChatLive"), "the admin has a \"Live trades' channel\" field");
  await pg.fill("#jsChatLive", "not a chat"); await pg.click("#jsChatLiveSave"); await pg.waitForTimeout(500);
  ok(/Live trades' channel: a number/.test(await pg.textContent("#jsSetSt")), "a Live channel that isn't a number or @name is refused");
  await pg.fill("#jsChatLive", "-1009990002"); await pg.click("#jsChatLiveSave"); await pg.waitForTimeout(700);
  ok((await jget()).shots_cfg.tg_chat_live === "-1009990002", "the Live channel is saved");
  await pg.click("#jsTgTestLive"); await pg.waitForTimeout(800);
  ok((await tgGet("/_sent")).some(m => m.chat === "-1009990002" && /Live/.test(m.text)), "Send a test to the Live channel");
  await pg.fill("#jsChatLive", ""); await pg.click("#jsChatLiveSave"); await pg.waitForTimeout(700);
  ok((await jget()).shots_cfg.tg_chat_live === "", "emptied: Live pictures go to the journal's chat again");
  await pg.check('#jsSet input[data-shot="tg"]'); await pg.waitForTimeout(800);
  ok((await jget()).shots_cfg.tg === true, "Telegram backup switched on");
  await pg.click('#jnSub button[data-v="trades"]');
  await pg.click('#nav button[data-pg="chart"]'); await pg.waitForTimeout(800);
  ok(await place(-1) === "ok", "a trade with the backup on");
  await pg.waitForTimeout(3000); await closeAll();
  let docs = [];
  for(let i = 0; i < 40; i++){ await pg.waitForTimeout(500); docs = await tgGet("/_docs"); if(docs.length >= 4) break; }
  const t4 = newest(await jget());
  ok(docs.length === 4 && docs.every(d => d.chat === "-1009990001" && d.silent && d.head.startsWith("89504e47") && d.caption.includes("CRUDEOIL26NOVFUT") && d.caption.includes(t4.id)),
     `each of the 4 new pictures goes to Telegram, silently, with the trade in its caption (${docs.length})`);
  ok(docs.some(d => /SELL 1 lot/.test(d.caption) && /net [+−]₹/.test(d.caption)), "the exit pictures' captions carry the net ₹ and R");
  await pg.waitForTimeout(500);
  const t4b = (await jget()).trades.find(x => x.id === t4.id);
  ok(t4b.shots.every(s => s.tg && s.tg.msg), "each picture remembers its Telegram message (✈ on the card)");
  await pg.click('#nav button[data-pg="journal"]'); await pg.waitForTimeout(500);
  await pg.evaluate(id => { if(!JN.exp.has(id)) JN.exp.add(id); jnRender(); }, t4.id); await pg.waitForTimeout(300);
  ok(await pg.$$eval(`.jn-trade[data-id="${t4.id}"] .js-tg.ok`, x => x.length) === 4, "the card marks each picture ✈ (in Telegram)");
  await pg.evaluate(id => { const t = JN.d.trades.find(x => x.id === id); jsView(id, t.shots[0].id); }, t4.id);
  await pg.waitForSelector("#jsView .js-tgst a");
  ok(/t\.me\/c\/9990001\/\d+/.test(await pg.getAttribute("#jsView .js-tgst a", "href")), "the viewer links to the Telegram copy");
  const msg0 = t4b.shots[0].tg.msg;
  await pg.click("#jsDel"); await pg.click("#jsDel"); await pg.waitForTimeout(1200);
  ok((await tgGet("/_deleted")).some(d => d.msg === msg0), "deleting the picture deletes its Telegram copy");
  await pg.keyboard.press("Escape");
  ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
  await pg.evaluate(async () => { await api("/api/journal/settings", {body: {shots: {tg: false}}}); });

  // ---- the phone
  const ph = await br.newContext({ ...devices["Pixel 7"] });
  const mp = await ph.newPage();
  const perrs = []; mp.on("pageerror", e => perrs.push(e.message));
  await mp.goto("http://localhost:8766/"); await LOGIN(mp);
  await mp.waitForFunction(() => P.snap && document.body.classList.contains("mob"), null, { timeout: 20000 });
  await mp.evaluate(() => mShow("more")); await mp.waitForTimeout(300);
  await mp.click('#ms_more [data-pg="journal"]');
  await mp.waitForSelector(`.jn-trade[data-id="${tid}"]`, { timeout: 10000 });
  await mp.click(`.jn-trade[data-id="${tid}"] .jt-row`);
  await mp.waitForSelector(`.jn-trade[data-id="${tid}"] .js-th img`);
  const box = await mp.$eval(`.jn-trade[data-id="${tid}"] .js-thumbs`, el => ({w: el.getBoundingClientRect().width, sw: document.documentElement.scrollWidth, vw: innerWidth}));
  ok(box.sw <= box.vw + 1, `phone: the pictures scroll inside the card, the page doesn't scroll sideways (${box.sw} ≤ ${box.vw})`);
  await mp.click(`.jn-trade[data-id="${tid}"] .js-th >> nth=0`);
  await mp.waitForSelector("#jsView:not(.hide) #jsImg");
  await mp.waitForFunction(() => { const i = document.querySelector("#jsImg"); return i && i.complete && i.naturalWidth > 0; }, null, {timeout: 10000});
  const vb = await mp.$eval("#jsView .js-vbox", el => { const r = el.getBoundingClientRect(); return {w: r.width, h: r.height, vw: innerWidth, vh: innerHeight}; });
  const ib = await mp.$eval("#jsImg", el => el.getBoundingClientRect().width);
  ok(Math.abs(vb.w - vb.vw) < 2 && ib <= vb.vw + 1, `phone: the viewer is full screen and the picture fits (${Math.round(ib)} of ${vb.vw} px)`);
  const s0 = await mp.evaluate(() => JS.view.sid);
  const sb = await mp.$eval("#jsImg", el => { const r = el.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2}; });
  await mp.evaluate(({x, y}) => { const st = document.querySelector(".js-stage");
    st.dispatchEvent(new PointerEvent("pointerdown", {clientX: x + 80, clientY: y, bubbles: true}));
    st.dispatchEvent(new PointerEvent("pointerup", {clientX: x - 80, clientY: y, bubbles: true})); }, sb);
  await mp.waitForTimeout(200);
  ok(await mp.evaluate(() => JS.view && JS.view.sid) !== s0, "phone: a swipe goes to the next picture");
  await mp.screenshot({ path: SHOT + "jshots_phone_viewer.png" });
  await mp.evaluate(() => { jsViewClose(); mShow("chart"); }); await mp.waitForTimeout(600);
  ok(await mp.isVisible("#bSnap"), "phone: 📷 is on the chart's bar too");
  ok(!perrs.length, "phone: no page errors" + (perrs.length ? ": " + perrs.join(" | ") : ""));
  await br.close();
})().catch(async e => { console.error(e); process.exitCode = 1; if(br) await br.close(); });
