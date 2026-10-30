// Log a test page in as admin (password + a fresh 2FA code). Needs FYERS_HELPER_DATA (the test data folder).
const crypto = require("crypto"), { execSync } = require("child_process");
const D = process.env.FYERS_HELPER_DATA, HERE = __dirname;
const SECRET = execSync(`python3 ${HERE}/adminsecret.py ${D}`).toString().trim();
function b32(s){ const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for(const c of s.toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, "0");
  const out = []; for(let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(off){ const step = Math.floor(Date.now() / 30000) + off; const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", b32(SECRET)).update(b).digest(); const o = h[19] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0"); }
const fs = require("fs"), F = D + "/.laststep";
module.exports = async function LOGIN(p){
  await p.waitForSelector("#vLogin:not(.hide), #app:not(.hide)");
  if(await p.isVisible("#app")) return;
  await p.fill("#lUser", "admin"); await p.fill("#lPw", process.env.ADMIN_PW || "OldPass12345"); await p.click("#fLogin button.primary");
  await p.waitForSelector("#vCode:not(.hide)");
  for(let attempt = 0; attempt < 3; attempt++){            // a code used elsewhere (e.g. by another test) is refused: wait for the next one
    await p.fill("#cCode", await module.exports.code(p)); await p.click("#fCode button.primary");
    await p.waitForFunction(() => !document.querySelector("#app").classList.contains("hide") || document.querySelector("#cErr").textContent, null, {timeout: 15000});
    if(!(await p.isHidden("#app"))) return;
    if(/start again/.test(await p.textContent("#cErr"))) throw new Error("login step expired");
    fs.writeFileSync(F, String(Math.floor(Date.now() / 30000)));
  }
  throw new Error("2FA code refused three times");
};
module.exports.code = async function(p){       // a fresh code, never one used before
  let last = 0; try{ last = +fs.readFileSync(F, "utf8"); }catch(e){}
  let now = Math.floor(Date.now() / 30000), off = now > last ? 0 : 1;
  if(now + off <= last){ await p.waitForTimeout((last + 1 - now) * 30000 - (Date.now() % 30000) + 500); now = Math.floor(Date.now() / 30000); off = 0; }
  fs.writeFileSync(F, String(now + off)); return totp(off);
};
