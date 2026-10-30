// Browser test of the upgrade login, 2FA, step-up, users and accounts. Start from fresh test data (tests/README.md).
// Browser test of v0.13: upgrade login + 2FA set-up, step-up, add a user, accounts, the friend's first login, code login.
const { chromium } = require("playwright");
const crypto = require("crypto");
const B = "http://localhost:8766/";
const SHOT = (process.env.FYERS_HELPER_DATA || ".") + "/shots/";
require("fs").mkdirSync(SHOT, { recursive: true });

function b32(s){ const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for(const c of s.replace(/[\s=]/g, "").toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, "0");
  const out = []; for(let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(secret, off = 0){ const step = Math.floor(Date.now() / 30000) + off; const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", b32(secret)).update(b).digest(); const o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0"); }
let used = {};       // secret -> last step used (the server refuses a code twice)
function fresh(secret){ const now = Math.floor(Date.now() / 30000); for(const off of [0, 1]){ if((used[secret] ?? -9) < now + off){ used[secret] = now + off; return totp(secret, off); } } Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000 - Date.now() % 30000 + 300); return fresh(secret); }
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if(!c) process.exitCode = 1; };

(async () => {
  const br = await chromium.launch();
  const pg = await (await br.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message)); pg.on("console", m => { if(m.type() === "error") errs.push(m.text()); });
  await pg.goto(B); await pg.waitForSelector("#vLogin:not(.hide)");
  ok(true, "login screen shown");
  await pg.fill("#lUser", "admin"); await pg.fill("#lPw", "WrongPass123"); await pg.click("#fLogin button.primary");
  await pg.waitForFunction(() => document.querySelector("#lErr").textContent.length > 0);
  ok(/wrong|incorrect|password/i.test(await pg.textContent("#lErr")), "wrong password refused: " + await pg.textContent("#lErr"));
  await pg.fill("#lPw", "OldPass12345"); await pg.click("#fLogin button.primary");
  await pg.waitForSelector("#v2fa:not(.hide) #qrBox svg", { timeout: 10000 });
  ok(true, "upgrade login -> forced 2FA set-up with QR code");
  await pg.screenshot({ path: SHOT + "01_2fa_setup.png" });
  const secret = (await pg.textContent("#c2fa .sel")).replace(/\s/g, "");
  await pg.fill("#tfCode", "000000"); await pg.click("#tfGo"); await pg.waitForTimeout(400);
  ok((await pg.textContent("#tfErr")).length > 0, "wrong first code refused: " + await pg.textContent("#tfErr"));
  await pg.fill("#tfCode", fresh(secret)); await pg.click("#tfGo");
  await pg.waitForSelector(".rcodes span");
  const rc = await pg.$$eval(".rcodes span", x => x.map(e => e.textContent));
  ok(rc.length === 10, "10 recovery codes shown");
  ok(await pg.isDisabled("#rcGo"), "Continue disabled until 'I've saved' ticked");
  await pg.screenshot({ path: SHOT + "02_recovery.png" });
  await pg.check("#rcOk"); await pg.click("#rcGo");
  await pg.waitForSelector("#app:not(.hide)"); await pg.waitForTimeout(1500);
  const opts = await pg.$$eval("#acctSel option", x => x.map(o => o.textContent));
  ok(opts[0].startsWith("Main"), "switcher shows the migrated account: " + opts.join(" | "));
  await pg.screenshot({ path: SHOT + "03_app.png" });

  // Settings: security + users
  await pg.click("#bSettings"); await pg.waitForSelector("#secBox .sess");
  ok(await pg.isVisible("#usersSec"), "admin sees Users");
  await pg.waitForSelector("#usersBox .urow");
  await pg.fill("#nuUser", "ravi"); await pg.fill("#nuName", "Ravi K"); await pg.fill("#nuPw", "TempPass1234");
  await pg.click("#nuGo");
  await pg.waitForSelector("#codeAsk:not(.hide) #caCode");
  ok(true, "add user asks for a 2FA code (step-up)");
  await pg.screenshot({ path: SHOT + "04_stepup.png" });
  await pg.fill("#caCode", fresh(secret)); await pg.click("#caGo");
  await pg.waitForSelector("#nuMsg .ok-msg", { timeout: 8000 });
  ok(/ravi/.test(await pg.textContent("#nuMsg")), "user ravi added");
  await pg.evaluate(() => document.querySelector("#usersSec").scrollIntoView());
  await pg.screenshot({ path: SHOT + "05_users.png" });
  await pg.click("#bClose");

  // accounts
  await pg.selectOption("#acctSel", "+new"); await pg.waitForSelector("#acctMgr #naName");
  await pg.fill("#naName", "NIFTY options"); await pg.fill("#naCap", "50000"); await pg.selectOption("#naCopy", { index: 1 });
  await pg.click("#naGo"); await pg.waitForTimeout(1500);
  const sel = await pg.$eval("#acctSel", s => s.options[s.selectedIndex].textContent);
  ok(/NIFTY options/.test(sel), "new account created and selected: " + sel);
  ok(/NIFTY options/.test(await pg.textContent("#pg_account h2")), "Account page shows its name");
  const bal = await pg.evaluate(() => P.snap && P.snap.acct.balance);
  ok(bal === 50000, "its balance is 50,000: " + bal);
  await pg.evaluate(() => document.querySelector("#acctMgr").scrollIntoView());
  await pg.screenshot({ path: SHOT + "06_accounts.png" });
  const mainId = await pg.$eval("#acctSel", s => s.options[0].value);
  await pg.selectOption("#acctSel", mainId); await pg.waitForTimeout(1200);
  const bal2 = await pg.evaluate(() => P.snap && P.snap.acct.balance);
  ok(bal2 !== 50000, "switching back shows Main's balance: " + bal2);
  // log page security filter
  await pg.click('#nav button[data-pg="log"]'); await pg.waitForSelector("#pgLogF"); await pg.click('#pgLogF button[data-f="security"]'); await pg.waitForTimeout(300);
  const sl = await pg.$$eval("#pgLogT tbody tr", r => r.map(x => x.textContent));
  ok(sl.some(x => /2fa on/.test(x)) && sl.some(x => /user created/.test(x)), "Log > Security shows 2FA and user events (" + sl.length + " rows)");
  await pg.screenshot({ path: SHOT + "07_log_security.png" });

  // log out (Settings > Log out of this device)
  await pg.click("#bSettings"); await pg.waitForSelector("#bLogout"); await pg.click("#bLogout");
  await pg.waitForSelector("#vLogin:not(.hide)");
  ok(true, "logged out");

  // the friend's first login
  await pg.fill("#lUser", "ravi"); await pg.fill("#lPw", "TempPass1234"); await pg.click("#fLogin button.primary");
  await pg.waitForSelector("#vNewPw:not(.hide)");
  ok(true, "temporary password -> must choose own");
  await pg.fill("#nPw", "short"); await pg.fill("#nPw2", "short"); await pg.click("#fNewPw button.primary"); await pg.waitForTimeout(400);
  ok((await pg.textContent("#nErr")).length > 0, "weak password refused: " + await pg.textContent("#nErr"));
  await pg.fill("#nPw", "RaviOwnPass99"); await pg.fill("#nPw2", "RaviOwnPass99"); await pg.click("#fNewPw button.primary");
  await pg.waitForSelector("#v2fa:not(.hide) #qrBox svg");
  const s2 = (await pg.textContent("#c2fa .sel")).replace(/\s/g, "");
  await pg.fill("#tfCode", fresh(s2)); await pg.click("#tfGo"); await pg.waitForSelector(".rcodes span");
  await pg.check("#rcOk"); await pg.click("#rcGo"); await pg.waitForSelector("#app:not(.hide)"); await pg.waitForTimeout(1500);
  const o2 = await pg.$$eval("#acctSel option", x => x.map(o => o.textContent));
  ok(o2[0].startsWith("Paper") && o2[0].includes("25,000"), "friend has own Paper account ₹25,000: " + o2[0]);
  await pg.click("#bSettings"); await pg.waitForSelector("#secBox .sess");
  ok(!(await pg.isVisible("#usersSec")), "friend doesn't see Users");
  await pg.click("#bClose");
  await pg.click('#nav button[data-pg="account"]'); await pg.waitForSelector("#pgChargesCard");
  ok(!(await pg.isVisible("#pgChEdit")), "friend can't edit charges");
  const sc = await pg.evaluate(() => fetch("/api/scripts").then(r => r.json()));
  ok((sc.scripts || []).length === 0, "friend has no Pine scripts of the admin's");
  const au = await pg.evaluate(() => fetch("/api/admin/users").then(r => r.status));
  ok(au === 403, "friend gets 403 on admin users");
  await pg.screenshot({ path: SHOT + "08_friend.png" });

  // code login with a recovery-style flow: log out, log in with password + code
  await pg.click("#bSettings"); await pg.waitForSelector("#bLogout"); await pg.click("#bLogout");
  await pg.waitForSelector("#vLogin:not(.hide)");
  ok((await pg.inputValue("#lUser")) === "ravi", "username remembered");
  await pg.fill("#lPw", "RaviOwnPass99"); await pg.click("#fLogin button.primary");
  await pg.waitForSelector("#vCode:not(.hide)");
  await pg.screenshot({ path: SHOT + "09_code.png" });
  await pg.fill("#cCode", fresh(s2)); await pg.click("#fCode button.primary");
  await pg.waitForSelector("#app:not(.hide)");
  ok(true, "password + code login works");

  // admin with a recovery code
  await pg.click("#bSettings"); await pg.waitForSelector("#bLogout"); await pg.click("#bLogout"); await pg.waitForSelector("#vLogin:not(.hide)");
  await pg.fill("#lUser", "admin"); await pg.fill("#lPw", "OldPass12345"); await pg.click("#fLogin button.primary");
  await pg.waitForSelector("#vCode:not(.hide)"); await pg.fill("#cCode", rc[0]); await pg.click("#fCode button.primary");
  await pg.waitForSelector("#app:not(.hide)");
  ok(true, "recovery code login works");
  await pg.click("#bSettings"); await pg.waitForSelector("#secBox .sess");
  ok(/9 recovery codes left/.test(await pg.textContent("#secBox")), "9 recovery codes left");
  // move 2FA to a new phone (step-up first)
  await pg.click("#sec2fa"); await pg.waitForSelector("#codeAsk:not(.hide) #caCode");
  await pg.fill("#caCode", fresh(secret)); await pg.click("#caGo");
  await pg.waitForSelector("#sec2faBox #qrBox svg");
  const s3 = (await pg.textContent("#sec2faBox .sel")).replace(/\s/g, "");
  await pg.fill("#tfCode", fresh(s3)); await pg.click("#tfGo"); await pg.waitForSelector("#sec2faBox .rcodes span");
  ok(true, "2FA moved to a new phone, new recovery codes shown");
  await pg.screenshot({ path: SHOT + "10_moved.png" });
  ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join(" / ") : ""));
  await br.close();
})().catch(e => { console.log("FAIL exception " + e); process.exit(1); });
