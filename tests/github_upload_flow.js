// tools/github_upload.html (Release to GitHub) in a browser, opened from disk (file://) as the owner uses it, against a
// fake GitHub API (tests/fake_github.py, started here on :8768). No helper or mock server needed.
// Checks: the zip read without a library (Download-ZIP style top folder left out), changed / new / only-on-GitHub found by
// git blob ids, one commit with only the changed files, file modes kept, nothing deleted unless ticked, "nothing to upload"
// after, an older zip needs a tick, the branch moved meanwhile -> nothing changed, a bad token, GitHub's rate limit waited out.
const { chromium } = require("playwright");
const { spawn, execFileSync } = require("child_process");
const fs = require("fs"), path = require("path"), os = require("os");
const ok = (c, m) => { fs.writeSync(1, (c ? "PASS " : "FAIL ") + m + "\n"); if(!c) process.exitCode = 1; };
const ROOT = path.dirname(__dirname), API = "http://127.0.0.1:8768", TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ghup-"));
const PAGE = "file://" + path.join(ROOT, "tools", "github_upload.html");
// zips of this repo, built like the release zips (and like GitHub's Download ZIP: a different top folder)
const PY = `
import os, sys, zipfile
root, out, top, ver = sys.argv[1:5]
z = zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED)
for d, ds, fs in os.walk(root):
    ds[:] = [x for x in ds if x not in (".git", "__pycache__", "node_modules")]
    for f in sorted(fs):
        p = os.path.join(d, f); rel = os.path.relpath(p, root)
        data = open(p, "rb").read()
        if rel == "VERSION" and ver: data = (ver + "\\n").encode()
        zi = zipfile.ZipInfo(top + "/" + rel, (2026, 11, 1, 12, 0, 0)); zi.compress_type = zipfile.ZIP_DEFLATED
        zi.external_attr = (0o100755 if os.access(p, os.X_OK) or f.endswith(".sh") else 0o100644) << 16
        z.writestr(zi, data)
z.close()`;
const mkzip = (name, top, ver = "") => { const out = path.join(TMP, name); execFileSync("python3", ["-c", PY, ROOT, out, top, ver]); return out; };
const call = async (p, body) => (await fetch(API + p, {method: body ? "POST" : "GET", headers: {"Content-Type": "application/json"}, body: body ? JSON.stringify(body) : undefined})).json();
let br, srv;
(async () => {
  srv = spawn("python3", [path.join(__dirname, "fake_github.py"), "8768"], {stdio: "inherit"});
  for(let i = 0; i < 50; i++){ try{ await call("/_state"); break; }catch(e){ await new Promise(r => setTimeout(r, 200)); } }
  const cur = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
  const zipNew = mkzip("new.zip", "Fyers-Paper-Trader-main"), zipOld = mkzip("old.zip", "Fyers-Paper-Trader", "0.1.0");
  // GitHub before the release: the repo's files, with VERSION 0.25.0, README changed, web/journal.js missing, one extra file
  const files = {};
  const walk = d => { for(const f of fs.readdirSync(d)){ const p = path.join(d, f); if([".git", "__pycache__", "node_modules"].includes(f)) continue;
    if(fs.statSync(p).isDirectory()) walk(p); else files[path.relative(ROOT, p)] = [p.endsWith(".sh") ? "100755" : "100644", fs.readFileSync(p).toString("base64")]; } };
  walk(ROOT);
  files["VERSION"][1] = Buffer.from("0.25.0\n").toString("base64");
  files["README.md"][1] = Buffer.from("old readme\n").toString("base64");
  delete files["web/journal.js"];
  files["docs/old_only.md"] = ["100644", Buffer.from("gone\n").toString("base64")];
  const seed = await call("/_seed", {files});
  // git's own blob ids for a few files = the fake's (so the page's ids are git's)
  const st0 = await call("/_state");
  for(const f of ["helper/journal.py", "web/index.html", "server/update.sh"]){
    const g = execFileSync("git", ["hash-object", path.join(ROOT, f)]).toString().trim();
    ok(st0.files[f] && st0.files[f][1] === g, `blob id of ${f} is git's (${g.slice(0, 7)})`);
  }

  br = await chromium.launch();
  const pg = await (await br.newContext()).newPage();
  const errs = []; pg.on("pageerror", e => errs.push(e.message));
  await pg.goto(PAGE);
  await pg.click("summary"); await pg.fill("#api", API); await pg.dispatchEvent("#api", "change");
  await pg.fill("#repo", "owner/Fyers-Paper-Trader");
  // ---- a bad token
  await pg.fill("#token", "wrong");
  await pg.setInputFiles("#file", zipNew);
  await pg.waitForFunction(() => /files/.test(document.querySelector("#zipSt").textContent), null, {timeout: 20000});
  const zs = await pg.textContent("#zipSt");
  const nFiles = Object.keys(files).length;                         // seed: repo files - journal.js + old_only = same count
  ok(/Fyers-Paper-Trader-main" left out/.test(zs) && zs.includes(`version ${cur}`), `the zip is read in the browser, its top folder left out (${zs})`);
  await pg.click("#check"); await pg.waitForFunction(() => /token/.test(document.querySelector("#chkSt").textContent), null, {timeout: 10000});
  ok(/refused the token/.test(await pg.textContent("#chkSt")), `a bad token: "${await pg.textContent("#chkSt")}"`);
  // ---- check
  await pg.fill("#token", "good-token");
  await pg.click("#check"); await pg.waitForFunction(() => /Ready|Nothing/.test(document.querySelector("#chkSt").textContent), null, {timeout: 20000});
  const sum = await pg.textContent("#plan");
  ok(/2 changed/.test(sum) && /1 new/.test(sum) && /1 only on GitHub/.test(sum) && /VERSION/.test(sum) && /README\.md/.test(sum) && /web\/journal\.js/.test(sum),
     `Check finds 2 changed (VERSION, README), 1 new (journal.js), 1 only on GitHub`);
  ok(/version 0\.25\.0/.test(sum), "it shows GitHub's version");
  const msg = await pg.inputValue("#msg");
  ok(/^v[\d.]+: .+/.test(msg), `the commit message is taken from CHANGELOG.md ("${msg}")`);
  ok(await pg.isVisible("#delWrap") && !(await pg.isChecked("#del")) && !(await pg.isVisible("#oldWrap")), "deleting is offered, not ticked; no version warning");
  // ---- GitHub's secondary rate limit on the first two blobs: waited out
  await call("/_limit", {n: 2});
  await pg.click("#go"); await pg.waitForFunction(() => /Done|Stopped|changed/.test(document.querySelector("#goSt").textContent), null, {timeout: 60000});
  const done = await pg.textContent("#goSt");
  let s = await call("/_state");
  ok(/^Done: commit/.test(done) && /3 files sent/.test(done), `committed: "${done}"`);
  const blobPosts = s.calls.filter(c => c === "POST /repos/owner/Fyers-Paper-Trader/git/blobs").length;
  ok(blobPosts === 5, `only the 3 changed files were sent, after 2 rate-limited tries (${blobPosts} blob requests)`);
  ok(s.commits === 2 && s.message === msg && s.parents.length === 1 && s.parents[0] === seed.head, "one commit on top of GitHub's last one, with the message");
  const zipFiles = execFileSync("python3", ["-c", "import zipfile,sys; print('\\n'.join(n.split('/',1)[1] for n in zipfile.ZipFile(sys.argv[1]).namelist()))", zipNew]).toString().trim().split("\n");
  const same = zipFiles.every(p => s.files[p]);
  ok(same && s.files["docs/old_only.md"] && Object.keys(s.files).length === zipFiles.length + 1, `GitHub now has every file of the zip, and the extra one kept (${Object.keys(s.files).length})`);
  ok(s.files["web/journal.js"][1] === execFileSync("git", ["hash-object", path.join(ROOT, "web/journal.js")]).toString().trim(), "the new file's content is exact");
  ok(s.files["server/update.sh"][0] === "100755" && s.files["README.md"][0] === "100644", "file modes kept");
  // ---- check again: nothing to send; delete the extra file
  await pg.click("#check"); await pg.waitForFunction(() => /GitHub already has/.test(document.querySelector("#chkSt").textContent), null, {timeout: 20000});
  ok(await pg.isDisabled("#go"), "nothing changed: only the deletion is offered, Commit off until it's ticked");
  await pg.check("#del"); await pg.click("#go"); await pg.waitForFunction(() => /Done|Stopped/.test(document.querySelector("#goSt").textContent), null, {timeout: 30000});
  s = await call("/_state");
  ok(!s.files["docs/old_only.md"] && /1 deleted/.test(await pg.textContent("#goSt")), "ticked: the extra file deleted");
  await pg.click("#check"); await pg.waitForFunction(() => /Nothing to upload/.test(document.querySelector("#chkSt").textContent), null, {timeout: 20000});
  ok(await pg.isHidden("#commitCard"), "then: Nothing to upload");
  // ---- an older zip needs a tick
  await pg.setInputFiles("#file", zipOld); await pg.waitForFunction(() => /0\.1\.0/.test(document.querySelector("#zipSt").textContent), null, {timeout: 20000});
  await pg.click("#check"); await pg.waitForFunction(() => /Ready/.test(document.querySelector("#chkSt").textContent), null, {timeout: 20000});
  ok(await pg.isVisible("#oldWrap") && await pg.isDisabled("#go") && /older than GitHub/.test(await pg.textContent("#oldWrap")), "an older zip: warned, Commit off until ticked");
  await pg.check("#old");
  ok(!(await pg.isDisabled("#go")), "ticked: Commit on");
  // ---- someone committed meanwhile: nothing changed
  const before = (await call("/_bump")).head;
  await pg.click("#go"); await pg.waitForFunction(() => /changed since|changed while/.test(document.querySelector("#goSt").textContent), null, {timeout: 20000});
  s = await call("/_state");
  ok(s.head === before && s.files["VERSION"][1] !== execFileSync("python3", ["-c", "import hashlib;d=b'0.1.0\\n';print(hashlib.sha1(b'blob %d\\0'%len(d)+d).hexdigest())"]).toString().trim(),
     `the branch moved: "${await pg.textContent("#goSt")}", GitHub unchanged`);
  // ---- the token isn't kept unless asked
  await pg.reload({waitUntil: "load"}); await pg.waitForTimeout(300);
  ok(await pg.inputValue("#token") === "" && await pg.inputValue("#api") === API, "after a reload the token is gone (not remembered), the settings stay");
  await pg.fill("#token", "good-token"); await pg.check("#remember"); await pg.reload({waitUntil: "load"}); await pg.waitForTimeout(300);
  ok(await pg.inputValue("#token") === "good-token", "Remember keeps it on this device");
  await pg.uncheck("#remember"); await pg.reload({waitUntil: "load"}); await pg.waitForTimeout(300);
  ok(await pg.inputValue("#token") === "", "unticked: forgotten");
  ok(!errs.length, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
  await br.close(); srv.kill();
})().catch(async e => { ok(false, "crashed: " + (e.stack || e)); if(br) await br.close(); if(srv) srv.kill(); });
