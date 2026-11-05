// Telegram alerts (v0.25.0), in a browser against the mock server (Telegram faked on :8767 by mock_server.py):
// Settings › Telegram alerts: a bad / unknown token refused, the token saved (2FA code, never shown again), Find my chat,
// a test message, the alert switches saved, the watchdog's state, the outside heartbeat; the Live card's line; the phone.
// Then end to end with the real helper: a live trade lands in the heartbeat, the real watchdog process is started, the
// helper is frozen (SIGSTOP) -> a "not responding" message naming the trade; unfrozen -> "answering again".
// Needs the mock server and an admin with 2FA (run security_flow.js first). Takes about 1.5 minutes.
const { chromium, devices } = require("playwright");
const LOGIN = require("./login.js");
const fs = require("fs"), path = require("path"), { spawn, execSync } = require("child_process");
const D = process.env.FYERS_HELPER_DATA || ".";
const SHOT = D + "/shots/";
fs.mkdirSync(SHOT, { recursive: true });
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const CRUDE = "MCX:CRUDEOIL26NOVFUT";
const TOKEN = "1234567:" + "B".repeat(35);
const UUID = "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b";
const get = async (port, p) => (await fetch(`http://127.0.0.1:${port}${p}`)).json();
const post = (port, p) => fetch(`http://127.0.0.1:${port}${p}`, {method: "POST", body: ""});
let br, wd, tg2, mockPid;

async function codeIfAsked(pg){
  // sensitive saves ask for a fresh 2FA code (valid 5 minutes): answer it if the dialog shows
  const asked = await pg.waitForSelector("#codeAsk:not(.hide)", { timeout: 1500 }).then(() => true, () => false);
  if(asked){ await pg.fill("#caCode", await LOGIN.code(pg)); await pg.click("#caGo"); }
}
async function drawer(pg){
  await pg.evaluate(() => { document.querySelector("#drawer").classList.remove("open"); });
  await pg.click("#bSettings");
  await pg.waitForSelector("#tgSec:not(.hide) #tgBox h4", { timeout: 10000 });
}

(async () => {
  try{ fs.unlinkSync(D + "/watchdog.json"); }catch(e){}
  for(const f of fs.readdirSync(D + "/u")){ try{ fs.unlinkSync(`${D}/u/${f}/telegram.json`); }catch(e){} }
  await post(8767, "/_reset");
  br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 1400, height: 900 } });
  const pg = await ctx.newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  pg.on("dialog", d => d.accept());
  await pg.goto("http://localhost:8766/"); await LOGIN(pg);
  await pg.waitForFunction(() => typeof tgRender === "function" && P.snap, null, { timeout: 20000 });

  // ---- not set up; the watchdog isn't running (no status file)
  await drawer(pg);
  ok(/Not set up yet/.test(await pg.textContent("#tgBox")), "Settings › Telegram alerts: not set up yet");
  ok(/watchdog isn't running/.test(await pg.textContent("#tgWd")), "it says when the watchdog isn't running");
  ok(await pg.evaluate(() => document.querySelector("#tgSetup").open), "the set-up steps are open");
  await pg.screenshot({ path: SHOT + "tg_01_empty.png" });

  // ---- tokens: not a token; one Telegram doesn't know; a good one
  await pg.fill("#tgTok", "hello"); await pg.click("#tgTokGo"); await codeIfAsked(pg);
  await pg.waitForFunction(() => { const t = document.querySelector("#tgTokMsg").textContent; return t.length > 0 && !/Checking/.test(t); }, null, { timeout: 8000 });
  ok(/doesn't look like a bot token/.test(await pg.textContent("#tgTokMsg")), "saving the token asks for a 2FA code; a non-token is refused");
  await pg.fill("#tgTok", "999999:" + "C".repeat(35)); await pg.click("#tgTokGo"); await codeIfAsked(pg);
  await pg.waitForFunction(() => /Unauthorized/.test(document.querySelector("#tgTokMsg").textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/doesn't know this bot token/.test(await pg.textContent("#tgTokMsg")), "a token Telegram doesn't know is refused: " + await pg.textContent("#tgTokMsg"));
  await pg.fill("#tgTok", TOKEN); await pg.click("#tgTokGo"); await codeIfAsked(pg);
  await pg.waitForFunction(() => /Bot @ftm_test_bot saved/.test(document.querySelector("#tgBox").textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/Bot @ftm_test_bot saved/.test(await pg.textContent("#tgBox")), "a good token: saved, the bot's name shown");
  const pub = await pg.evaluate(() => api("/api/telegram"));
  ok(!JSON.stringify(pub).includes(TOKEN) && !(await pg.content()).includes(TOKEN), "the token is never sent back to the page");
  const raw = fs.readFileSync(execSync(`ls ${D}/u/*/telegram.json`).toString().trim(), "utf8");
  ok(!raw.includes(TOKEN) && /enc1:/.test(raw), "the token is saved encrypted on the server");

  // ---- the chat: Find my chat, then pick
  await pg.click("#tgFind");
  await pg.waitForSelector("#tgChats [data-i]", { timeout: 8000 });
  const chats = await pg.$$eval("#tgChats [data-i]", b => b.map(x => x.textContent));
  ok(chats.length === 2 && /Venkat/.test(chats[0]) && /Trade alerts.*channel/.test(chats[1]), "Find my chat lists the chats that messaged the bot: " + chats.join(" | "));
  await pg.screenshot({ path: SHOT + "tg_02_chats.png" });
  await pg.click("#tgChats [data-i='0']"); await codeIfAsked(pg);
  await pg.waitForFunction(() => /Alerts go to Venkat from @ftm_test_bot/.test(document.querySelector("#tgBox").textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/Alerts go to Venkat from @ftm_test_bot/.test(await pg.textContent("#tgBox")), "picking a chat: 'Alerts go to Venkat from @ftm_test_bot'");
  ok(await pg.evaluate(() => !document.querySelector("#tgSetup").open), "set up: the steps fold away");
  await pg.evaluate(() => document.querySelector("#tgSetup").open = true); await pg.fill("#tgChat", "not a chat");
  await pg.click("#tgChatGo"); await codeIfAsked(pg);
  await pg.waitForFunction(() => document.querySelector("#tgChatMsg").textContent, null, { timeout: 8000 });
  ok(/a number like/.test(await pg.textContent("#tgChatMsg")), "a typed chat ID is checked");

  // ---- test message
  await pg.click("#tgTest");
  await pg.waitForFunction(() => /Sent/.test(document.querySelector("#tgTestMsg").textContent), null, { timeout: 8000 }).catch(() => {});
  let sent = await get(8767, "/_sent");
  ok(sent.length === 1 && sent[0].chat === "5550001" && /Test from Trade Manager/.test(sent[0].text), "a test message reaches the chat");

  // ---- the alert switches
  await pg.fill("#tg_down_sec", "5"); await pg.click("#tgAlGo");
  await pg.waitForFunction(() => document.querySelector("#tgAlMsg").textContent, null, { timeout: 8000 });
  ok(/between 15 and 600/.test(await pg.textContent("#tgAlMsg")), "a server-down time under 15 s is refused");
  await pg.fill("#tg_down_sec", "15"); await pg.fill("#tg_repeat_min", "0"); await pg.uncheck("#tg_feed"); await pg.click("#tgAlGo");
  await pg.waitForFunction(() => /Saved/.test(document.querySelector("#tgAlMsg").textContent), null, { timeout: 8000 });
  await pg.reload(); await pg.waitForFunction(() => typeof tgRender === "function" && P.snap, null, { timeout: 20000 });
  await drawer(pg);
  const al = await pg.evaluate(() => ({d: tq("#tg_down_sec").value, r: tq("#tg_repeat_min").value, f: tq("#tg_feed").checked, w: tq("#tg_warn").checked}));
  ok(al.d === "15" && al.r === "0" && al.f === false && al.w === true, "alert switches are saved on the server (after a reload): " + JSON.stringify(al));

  // ---- the outside heartbeat
  await pg.evaluate(() => document.querySelector("#tgHc").open = true);
  await pg.fill("#tgHcUrl", "not a url"); await pg.click("#tgHcGo"); await codeIfAsked(pg);
  await pg.waitForFunction(() => document.querySelector("#tgHcMsg").textContent, null, { timeout: 8000 });
  ok(/ping URL/.test(await pg.textContent("#tgHcMsg")), "a bad ping URL is refused");
  await pg.fill("#tgHcUrl", "http://127.0.0.1:8768/ping/" + UUID); await pg.fill("#tgHcKey", "SECRETKEY99"); await pg.click("#tgHcGo"); await codeIfAsked(pg);
  await pg.waitForFunction(() => /If the whole server goes down.*on/.test(document.querySelector("#tgHc summary").textContent), null, { timeout: 8000 }).catch(() => {});
  const hc = await pg.evaluate(() => api("/api/telegram"));
  ok(hc.tg.hc.set && hc.tg.hc.key_set && !JSON.stringify(hc).includes(UUID) && !JSON.stringify(hc).includes("SECRETKEY99"), "the outside heartbeat is saved (the URL masked, the key never shown)");

  // ---- the watchdog's state
  fs.writeFileSync(D + "/watchdog.json", JSON.stringify({t: Date.now() / 1000, up: true, hc: {}}));
  await drawer(pg);
  ok(/Watchdog: running/.test(await pg.textContent("#tgWd")), "with the watchdog's status file fresh: 'Watchdog: running'");
  await pg.screenshot({ path: SHOT + "tg_03_ready.png" });

  // ---- the Live account (v0.33.0: the Fyers account itself, the PAPER / LIVE switch): the Live card's line, and the heartbeat
  await pg.evaluate(() => { window.__lv = stepUp(() => api("/api/side", {body: {side: "live", confirm: "XT0001"}})).then(j => { if(j.ok) sideApply(j); return j; }); });
  await codeIfAsked(pg);
  const lv = await pg.evaluate(() => window.__lv);
  ok(lv.ok, "this page on the Live side for the test" + (lv.ok ? "" : ": " + lv.error));
  await pg.waitForTimeout(1200);
  // the Live account is one account for every run (v0.33.0): earlier tests' losses today mustn't trip its loss limits here
  const rules0 = await pg.evaluate(async () => { const r = P.snap.rules; await papi("rules", {daily_pct: 0, max_pct: 0}); return {daily_pct: r.daily_pct, max_pct: r.max_pct}; });
  await pg.click('#nav button[data-pg="account"]'); await pg.waitForSelector("#liveCard");
  await pg.waitForFunction(() => (document.querySelector("#lvTg") || {}).textContent && document.querySelector("#lvTg").textContent !== "…", null, { timeout: 8000 });
  ok(/^on$/.test((await pg.textContent("#lvTg")).trim()), "Live card: 'Telegram alerts: on'");
  await pg.screenshot({ path: SHOT + "tg_04_livecard.png" });
  await pg.click('#nav button[data-pg="chart"]');
  await pg.evaluate(c => openBySymbol(c), CRUDE);
  await pg.waitForFunction(c => last[c] && last[c].ltp, CRUDE, { timeout: 15000 });
  const ltp = await pg.evaluate(c => last[c].ltp, CRUDE);
  const r = await pg.evaluate(([c, sl]) => papi("place", {s: c, side: 1, type: "market", sl, mode: "lots", lots: 1, product: "MARGIN"}), [CRUDE, ltp - 15]);
  ok(r.ok, "a live BUY at the (fake) Fyers" + (r.ok ? "" : ": " + r.error));
  await pg.waitForFunction(() => P.snap.positions[0] && P.snap.positions[0].fy && P.snap.positions[0].fy.stop_oid, null, { timeout: 10000 });
  await pg.waitForTimeout(6000);
  const hb = JSON.parse(fs.readFileSync(D + "/watch.json", "utf8"));
  const hp = Object.values(hb.users).flatMap(u => u.live).flatMap(a => a.positions)[0] || {};
  ok(Date.now() / 1000 - hb.t < 7 && hp.s === CRUDE && hp.stop_at_fyers && hp.lots === 1, "the real helper writes the heartbeat with the live trade and its stop at Fyers");

  // ---- the real watchdog, the helper frozen
  tg2 = spawn("python3", [path.join(__dirname, "fake_telegram.py"), "8768"], { stdio: "ignore" });
  await new Promise(res => setTimeout(res, 800));
  wd = spawn("python3", ["-m", "helper.watchdog"], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WATCHDOG_URL: "http://127.0.0.1:8766/api/ping", WATCHDOG_EVERY: "2", TELEGRAM_API: "http://127.0.0.1:8768", HC_API: "http://127.0.0.1:8768" } });
  let wdOut = ""; wd.stdout.on("data", d => wdOut += d); wd.stderr.on("data", d => wdOut += d);
  await new Promise(res => setTimeout(res, 5000));
  const ws1 = JSON.parse(fs.readFileSync(D + "/watchdog.json", "utf8"));
  ok(ws1.up === true && ws1.pid === wd.pid, "the watchdog process sees the helper answering");
  ok((await get(8768, "/_hc")).some(c => c.what === "ping" && c.id === UUID), "live trade open: the watchdog pings the outside heartbeat");
  mockPid = execSync("lsof -t -iTCP:8766 -sTCP:LISTEN").toString().trim().split("\n")[0];
  process.kill(+mockPid, "SIGSTOP");
  const t0 = Date.now();
  let msg = null;
  while(Date.now() - t0 < 40000){
    await new Promise(res => setTimeout(res, 1000));
    msg = (await get(8768, "/_sent")).find(m => /isn't responding/.test(m.text));
    if(msg) break;
  }
  const took = Math.round((Date.now() - t0) / 1000);
  ok(msg && /CRUDEOIL26NOVFUT/.test(msg.text) && /BUY 1 lot/.test(msg.text) && /stop at Fyers/.test(msg.text) && /doesn't answer/.test(msg.text),
     `helper frozen: a Telegram message naming the trade and its stop, after ${took} s` + (msg ? "" : "\n" + wdOut.slice(-1500)));
  ok(msg && msg.chat === "5550001" && took >= 14 && took <= 32, "...to the chosen chat, after the 15 s set (plus the 5 s ping timeout)");
  process.kill(+mockPid, "SIGCONT"); mockPid = null;
  const t1 = Date.now(); let back = null;
  while(Date.now() - t1 < 20000){
    await new Promise(res => setTimeout(res, 1000));
    back = (await get(8768, "/_sent")).find(m => /answering again/.test(m.text));
    if(back) break;
  }
  ok(back && /CRUDEOIL26NOVFUT/.test(back.text), "unfrozen: 'answering again', with the trade");
  ok((await get(8768, "/_sent")).filter(m => /isn't responding/.test(m.text)).length === 1, "repeat 0: only one 'not responding' message");
  wd.kill(); tg2.kill(); wd = tg2 = null;

  // ---- clean up: close, back to Paper; then remove Telegram
  await pg.waitForTimeout(1500);
  await pg.evaluate(() => papi("close_all", {}));
  await pg.waitForFunction(() => !P.snap.positions.length, null, { timeout: 15000 }).catch(() => {});
  await pg.evaluate(r => papi("rules", r), rules0);
  const back2 = await pg.evaluate(() => sideSet("paper"));
  await pg.waitForFunction(() => !liveOn(), null, { timeout: 8000 }).catch(() => {});
  ok(back2.ok && !(await pg.evaluate(() => liveOn())), "this page back on the Paper side" + (back2.ok ? "" : ": " + back2.error));
  await drawer(pg);
  await pg.click("#tgDel"); await codeIfAsked(pg);
  await pg.waitForFunction(() => /Not set up yet/.test(document.querySelector("#tgBox").textContent), null, { timeout: 8000 }).catch(() => {});
  ok(/Not set up yet/.test(await pg.textContent("#tgBox")), "Remove Telegram: not set up again");
  const after = await pg.evaluate(() => api("/api/telegram"));
  ok(after.tg.alerts.down_sec === 15 && !after.tg.token_set && !after.tg.hc.set, "removing keeps the alert switches, drops the bot and the outside heartbeat");

  // ---- the phone: the section fits
  const ph = await br.newContext({ ...devices["Pixel 7"] });
  const pp = await ph.newPage(); pp.on("pageerror", e => errs.push("phone: " + e.message));
  await pp.goto("http://localhost:8766/"); await LOGIN(pp);
  await pp.waitForFunction(() => typeof tgRender === "function" && P.snap, null, { timeout: 20000 });
  await pp.evaluate(() => openDrawer());
  await pp.waitForSelector("#tgSec:not(.hide) #tgBox h4", { timeout: 10000 });
  await pp.evaluate(() => document.querySelector("#tgSec").scrollIntoView());
  const fit = await pp.evaluate(() => { const b = document.querySelector("#tgBox"); return b.scrollWidth <= b.clientWidth + 1 && document.querySelector("#drawer").scrollWidth <= innerWidth + 1; });
  ok(fit, "phone: the Telegram section fits the screen (no sideways scroll)");
  await pp.screenshot({ path: SHOT + "tg_05_phone.png" });
  ok(errs.length === 0, "no script errors" + (errs.length ? ": " + errs.join(" / ") : ""));
  await br.close();
})().catch(async e => { ok(false, e.message.split("\n")[0]); if(mockPid) process.kill(+mockPid, "SIGCONT"); if(wd) wd.kill(); if(tg2) tg2.kill(); if(br) await br.close(); });
