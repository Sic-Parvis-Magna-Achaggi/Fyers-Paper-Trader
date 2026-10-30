/* Logging in (password, then a 2FA code), setting up 2FA with recovery codes, the step-up code for sensitive
   actions, your security settings, the admin's Users screen, and the paper-account switcher. */

const sq = s => document.querySelector(s);
const sesc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const GATES = ["#vSetup", "#vLogin", "#vCode", "#vNewPw", "#v2fa"];
function gateShow(id){
  sq("#app").classList.add("hide");
  for(const g of GATES) sq(g).classList.toggle("hide", g !== id);
  const f = sq(id + " input"); if(f) setTimeout(() => f.focus(), 30);
}
function gateHideAll(){ for(const g of GATES) sq(g).classList.add("hide"); }
/* after the password: the next step the server asked for */
function gateStage(stage){
  if(stage === "totp") gateShow("#vCode");
  else if(stage === "change_pw") gateShow("#vNewPw");
  else if(stage === "setup_2fa"){ gateShow("#v2fa"); twofaSetup(sq("#c2fa"), {begin: "/api/login/2fa/begin", finish: "/api/login/2fa/finish", first: true, done: () => boot()}); }
}

/* 2FA set-up: a QR code for the authenticator app, the first code to confirm, then the recovery codes (shown once) */
async function twofaSetup(box, o){
  box.innerHTML = `<div class="empty">Preparing…</div>`;
  const j = await stepUp(() => api(o.begin, {body: {}}));
  if(!j.ok){ box.innerHTML = `<div class="err">${sesc(j.error === "cancelled" ? "Cancelled." : j.error)}</div>`; if(o.first) box.insertAdjacentHTML("beforeend", `<button class="ghost" onclick="location.reload()">Start again</button>`); return; }
  box.innerHTML = `<h1 style="margin-top:0">${o.first ? "Set up two-factor login" : "Move 2FA to a new phone"}</h1>
    <p>Every login needs a 6-digit code from an authenticator app on your phone, as well as your password: <b>Google Authenticator</b>, <b>Microsoft Authenticator</b>, <b>Authy</b> or similar.</p>
    <ol class="steps"><li>Open the app and add an account (<b>+</b>, then <b>Scan a QR code</b>).</li><li>Scan this code:</li></ol>
    <div class="qr" id="qrBox"></div>
    <p class="help">Can't scan? Choose "Enter a setup key" and type: <span class="mono sel">${sesc(j.secret.replace(/(.{4})/g, "$1 ").trim())}</span> (time-based).</p>
    <ol class="steps" start="3"><li>Type the 6-digit code the app now shows:</li></ol>
    <input class="mono big" id="tfCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456">
    <button class="primary" id="tfGo">Confirm</button><div class="err" id="tfErr"></div>`;
  try{ const q = qrcode(0, "M"); q.addData(j.uri); q.make(); sq("#qrBox").innerHTML = q.createSvgTag({cellSize: 5, margin: 3, scalable: true}); }
  catch(e){ sq("#qrBox").textContent = "(QR code unavailable - use the setup key below)"; }
  const go = async () => {
    const r = await stepUp(() => api(o.finish, {body: {code: sq("#tfCode").value}}));
    if(!r.ok){ sq("#tfErr").textContent = r.error; return; }
    recoveryShow(box, r.recovery, o.done, o.first);
  };
  sq("#tfGo").onclick = go;
  sq("#tfCode").onkeydown = e => { if(e.key === "Enter"){ e.preventDefault(); go(); } };
  sq("#tfCode").focus();
}
function recoveryShow(box, codes, done, first){
  const txt = `Trade Manager recovery codes (each works once)\n${location.host}\n\n${codes.join("\n")}\n`;
  box.innerHTML = `<h1 style="margin-top:0">Save your recovery codes</h1>
    <p>If you lose your phone, each of these logs you in once instead of an app code. Keep them somewhere safe and private (a password manager, or printed). They won't be shown again.</p>
    <div class="rcodes mono">${codes.map(c => `<span>${sesc(c)}</span>`).join("")}</div>
    <div class="btns"><button id="rcCopy">Copy</button><button id="rcDl">Download</button></div>
    <label class="chk"><input type="checkbox" id="rcOk"> I've saved these codes</label>
    <button class="primary" id="rcGo" disabled>${first ? "Continue to the app" : "Done"}</button>`;
  sq("#rcCopy").onclick = () => { navigator.clipboard && navigator.clipboard.writeText(txt); toast("Copied"); };
  sq("#rcDl").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], {type: "text/plain"})); a.download = "trade-manager-recovery-codes.txt"; a.click(); };
  sq("#rcOk").onchange = () => { sq("#rcGo").disabled = !sq("#rcOk").checked; };
  sq("#rcGo").onclick = () => done && done();
}

/* sensitive actions: the server answers 428 until a fresh code is given (valid 5 minutes) */
async function stepUp(fn){
  let j = await fn();
  if(j && j.status === 428){
    const ok = await codeAsk();
    if(!ok) return {ok: false, error: "cancelled"};
    j = await fn();
  }
  return j;
}
function codeAsk(){
  return new Promise(res => {
    let m = sq("#codeAsk");
    if(!m){ m = document.createElement("div"); m.id = "codeAsk"; document.body.append(m); }
    m.innerHTML = `<div class="ca"><b>Confirm with your 2FA code</b><p class="help">This change needs a fresh code from your authenticator app.</p>
      <input class="mono big" id="caCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6"><div class="err" id="caErr"></div>
      <div class="btns"><button class="primary" id="caGo">Confirm</button><button class="ghost" id="caX">Cancel</button></div></div>`;
    m.classList.remove("hide");
    const close = v => { m.classList.add("hide"); res(v); };
    const go = async () => { const r = await api("/api/security/confirm", {body: {code: sq("#caCode").value}}); if(r.ok) close(true); else sq("#caErr").textContent = r.error; };
    sq("#caGo").onclick = go; sq("#caX").onclick = () => close(false);
    sq("#caCode").onkeydown = e => { if(e.key === "Enter") go(); if(e.key === "Escape") close(false); };
    sq("#caCode").focus();
  });
}

/* ------------------------------------------------------------------ gates: wiring */
document.addEventListener("DOMContentLoaded", () => {
  sq("#fSetup").onsubmit = async e => {
    e.preventDefault(); sq("#sErr").textContent = "";
    if(sq("#sPw").value !== sq("#sPw2").value){ sq("#sErr").textContent = "The passwords don't match."; return; }
    const j = await api("/api/setup", {body: {code: sq("#sCode").value, username: sq("#sUser").value, password: sq("#sPw").value}});
    if(!j.ok){ sq("#sErr").textContent = j.error; return; }
    gateStage(j.stage);
  };
  sq("#fLogin").onsubmit = async e => {
    e.preventDefault(); sq("#lErr").textContent = "";
    const j = await api("/api/login", {body: {username: sq("#lUser").value, password: sq("#lPw").value}});
    if(!j.ok){ sq("#lErr").textContent = j.error; return; }
    sq("#lPw").value = "";
    try{ localStorage.setItem("ftm.lastUser", sq("#lUser").value); }catch(x){}
    gateStage(j.stage);
  };
  sq("#fCode").onsubmit = async e => {
    e.preventDefault(); sq("#cErr").textContent = "";
    const j = await api("/api/login/code", {body: {code: sq("#cCode").value}});
    sq("#cCode").value = "";
    if(!j.ok){ sq("#cErr").textContent = j.error; if(/start again/.test(j.error || "")) setTimeout(() => gateShow("#vLogin"), 1200); return; }
    boot();
  };
  sq("#fNewPw").onsubmit = async e => {
    e.preventDefault(); sq("#nErr").textContent = "";
    if(sq("#nPw").value !== sq("#nPw2").value){ sq("#nErr").textContent = "The passwords don't match."; return; }
    const j = await api("/api/login/password", {body: {new: sq("#nPw").value}});
    if(!j.ok){ sq("#nErr").textContent = j.error; return; }
    gateStage(j.stage);
  };
  document.querySelectorAll("[data-back]").forEach(b => b.onclick = () => gateShow("#vLogin"));
  try{ const u = localStorage.getItem("ftm.lastUser"); if(u) sq("#lUser").value = u; }catch(x){}
});

/* ------------------------------------------------------------------ Settings: Security (everyone) and Users (admin) */
async function secRender(){
  const box = sq("#secBox"); if(!box) return;
  const j = await api("/api/security"); if(!j.ok){ box.innerHTML = `<div class="err">${sesc(j.error)}</div>`; return; }
  const u = j.user, t = x => x ? new Date(x * 1000).toLocaleString("en-GB", {timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"}) : "–";
  box.innerHTML = `<p class="help">Signed in as <b>${sesc(u.username)}</b>${u.role === "admin" ? ' <span class="tag">admin</span>' : ""}.</p>
    <label>Your name</label><div class="inl" style="grid-template-columns:1fr auto"><input id="secName" value="${sesc(u.name)}"><button id="secNameGo">Save</button></div>
    <h4>Two-factor login</h4>
    <p class="help">On: every login needs a code from your authenticator app. ${u.recovery_left} recovery code${u.recovery_left === 1 ? "" : "s"} left.</p>
    <div class="btns"><button id="secRec">New recovery codes</button><button id="sec2fa">Move to a new phone</button></div>
    <div id="sec2faBox"></div>
    <h4>Password</h4>
    <label>Current password</label><input id="pOld" type="password" autocomplete="current-password">
    <label>New password</label><input id="pNew" type="password" autocomplete="new-password">
    <div class="btns"><button id="bPw">Change password</button></div><div class="ok-msg" id="pwMsg"></div>
    <h4>Where you're logged in</h4>
    <div class="sess">${j.sessions.map(s => `<div><span>${s.current ? "<b>This device</b>" : sesc(uaShort(s.ua))}<br><span class="muted">${sesc(s.ip || "")} · since ${t(s.created)} · last ${t(s.last)}</span></span>
      ${s.current ? "" : `<button class="sm" data-end="${s.id}">Log out</button>`}</div>`).join("")}</div>
    <div class="btns"><button id="secAll">Log out everywhere else</button><button id="bLogout">Log out of this device</button></div>
    <h4>Recent activity</h4>
    <div class="audit">${j.audit.slice(0, 15).map(a => `<div><span class="mono muted">${t(a.t)}</span> ${sesc(a.event)}${a.detail ? ` <span class="muted">${sesc(a.detail)}</span>` : ""}${a.ip ? ` <span class="muted">· ${sesc(a.ip)}</span>` : ""}</div>`).join("") || '<div class="muted">Nothing yet.</div>'}</div>`;
  sq("#secNameGo").onclick = async () => { const r = await api("/api/security/name", {body: {name: sq("#secName").value}}); toast(r.ok ? "Saved" : r.error); };
  sq("#secRec").onclick = async () => { const r = await stepUp(() => api("/api/security/recovery", {body: {}})); if(r.ok) recoveryShow(sq("#sec2faBox"), r.recovery, () => secRender()); else if(r.error !== "cancelled") toast(r.error); };
  sq("#sec2fa").onclick = () => twofaSetup(sq("#sec2faBox"), {begin: "/api/security/2fa/begin", finish: "/api/security/2fa/finish", done: () => secRender()});
  sq("#bPw").onclick = async () => { const r = await api("/api/security/password", {body: {old: sq("#pOld").value, new: sq("#pNew").value}});
    sq("#pwMsg").textContent = r.ok ? "Password changed. Your other devices were logged out." : r.error; sq("#pwMsg").className = r.ok ? "ok-msg" : "err";
    if(r.ok){ sq("#pOld").value = sq("#pNew").value = ""; } };
  box.querySelectorAll("[data-end]").forEach(b => b.onclick = async () => { await api("/api/security/end_session", {body: {id: b.dataset.end}}); secRender(); });
  sq("#secAll").onclick = async () => { const r = await api("/api/security/logout_all", {body: {}}); toast(r.ok ? `Logged out of ${r.ended} other session(s)` : r.error); secRender(); };
  sq("#bLogout").onclick = async () => { await api("/api/logout", {body: {}}); location.reload(); };
  if(u.role === "admin") usersRender(); else { const ub = sq("#usersSec"); if(ub) ub.classList.add("hide"); }
}
function uaShort(ua){
  if(!ua) return "Another device";
  const b = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const o = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone / iPad" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return b + (o ? " on " + o : "");
}
async function usersRender(){
  const sec = sq("#usersSec"), box = sq("#usersBox"); if(!sec || !box) return;
  sec.classList.remove("hide");
  const j = await api("/api/admin/users"); if(!j.ok){ box.innerHTML = `<div class="err">${sesc(j.error)}</div>`; return; }
  const t = x => x ? new Date(x * 1000).toLocaleString("en-GB", {timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"}) : "never";
  box.innerHTML = `<p class="help">Other users get paper trading with prices from <b>their own</b> Fyers app (they enter it in their own Settings). Live trading stays yours only. Every user must set up 2FA at their first login.</p>
    <div class="ulist">${j.users.map(u => `<div class="urow" data-uid="${u.uid}"><div><b>${sesc(u.name)}</b> <span class="muted">${sesc(u.username)}</span>
        ${u.role === "admin" ? '<span class="tag">admin</span>' : ""}${u.disabled ? '<span class="tag down">disabled</span>' : ""}${u.totp ? "" : '<span class="tag warnc">2FA not set up yet</span>'}
        <div class="muted sm">last login ${t(u.last_login)}</div></div>
      ${u.role === "admin" ? "" : `<div class="ubtns"><button class="sm" data-a="pw">Temporary password</button><button class="sm" data-a="2fa">Reset 2FA</button>
        <button class="sm ${u.disabled ? "" : "danger"}" data-a="dis">${u.disabled ? "Enable" : "Disable"}</button></div>`}</div>`).join("")}</div>
    <h4>Add a user</h4>
    <div class="f2"><div><label>Username</label><input id="nuUser" autocomplete="off" autocapitalize="none"></div><div><label>Name</label><input id="nuName" autocomplete="off"></div></div>
    <label>Temporary password <span class="muted">(they choose their own at first login)</span></label><input id="nuPw" class="mono" autocomplete="off" value="${tempPw()}">
    <div class="btns"><button class="primary" id="nuGo">Add user</button></div><div id="nuMsg"></div>
    <h4>Security log (everyone)</h4>
    <div class="audit">${j.audit.slice(0, 40).map(a => { const who = (j.users.find(u => u.uid === a.uid) || {}).username || a.uid;
      return `<div><span class="mono muted">${t(a.t)}</span> <b>${sesc(who)}</b> ${sesc(a.event)}${a.detail ? ` <span class="muted">${sesc(a.detail)}</span>` : ""}${a.ip ? ` <span class="muted">· ${sesc(a.ip)}</span>` : ""}</div>`; }).join("")}</div>`;
  sq("#nuGo").onclick = async () => {
    const r = await stepUp(() => api("/api/admin/users/create", {body: {username: sq("#nuUser").value, name: sq("#nuName").value, password: sq("#nuPw").value}}));
    sq("#nuMsg").innerHTML = r.ok ? `<div class="ok-msg">Added <b>${sesc(r.user.username)}</b>. Give them the address, their username and the temporary password <span class="mono">${sesc(sq("#nuPw").value)}</span>; they'll choose their own password and set up 2FA at first login.</div>`
      : (r.error === "cancelled" ? "" : `<div class="err">${sesc(r.error)}</div>`);
    if(r.ok) setTimeout(usersRender, 8000);
  };
  box.querySelectorAll(".urow[data-uid] [data-a]").forEach(b => b.onclick = async () => {
    const uid = b.closest(".urow").dataset.uid, u = j.users.find(x => x.uid === uid), a = b.dataset.a;
    let body = {uid};
    if(a === "dis"){ if(!u.disabled && !confirm(`Disable ${u.username}? They're logged out at once; their accounts are kept.`)) return; body.disabled = !u.disabled; }
    if(a === "2fa"){ if(!confirm(`Reset ${u.username}'s 2FA? They set it up again at their next login (for a lost phone).`)) return; body.reset_2fa = true; }
    if(a === "pw"){ const p = tempPw(); if(!confirm(`Give ${u.username} the temporary password ${p}? They must change it at their next login.`)) return; body.password = p; }
    const r = await stepUp(() => api("/api/admin/users/set", {body}));
    if(r.ok){ toast(a === "pw" ? `Temporary password for ${u.username}: ${body.password}` : "Done"); usersRender(); } else if(r.error !== "cancelled") toast(r.error);
  });
}
function tempPw(){ const a = "abcdefghjkmnpqrstuvwxyz", A = a.toUpperCase(), d = "23456789", r = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const pick = s => s[r(s.length)]; let p = pick(A) + pick(a) + pick(d); while(p.length < 12) p += pick(a + A + d); return p.split("").sort(() => r(3) - 1).join(""); }

/* ------------------------------------------------------------------ paper accounts: the switcher and the Account page's list */
let ACCT = null;
try{ ACCT = localStorage.getItem("ftm.acct") || null; }catch(e){}
function acctList(){ return (S && S.accounts || []).filter(a => !a.archived); }
function acctSetup(){
  const list = acctList();
  if(!list.find(a => a.id === ACCT)) ACCT = list.length ? list[0].id : null;
  const sel = sq("#acctSel"); if(!sel) return;
  const rsx = n => n == null ? "" : " · ₹" + Math.round(n).toLocaleString("en-IN");
  sel.innerHTML = list.map(a => `<option value="${a.id}" ${a.id === ACCT ? "selected" : ""}>${a.mode === "live" ? "● LIVE · " : ""}${sesc(a.name)}${rsx(a.balance)}</option>`).join("")
    + `<option value="+new">+ New account…</option><option value="+manage">Manage accounts…</option>`;
  sel.onchange = () => {
    const v = sel.value;
    if(v === "+new" || v === "+manage"){ sel.value = ACCT; pgShow("account"); setTimeout(() => { const el = sq("#acctMgr"); el && el.scrollIntoView({behavior: "smooth"}); if(v === "+new"){ const n = sq("#naName"); n && n.focus(); } }, 300); return; }
    acctSwitch(v);
  };
}
function acctSwitch(id){
  if(!id || id === ACCT) return;
  ACCT = id; try{ localStorage.setItem("ftm.acct", id); }catch(e){}
  if(typeof P !== "undefined"){ P.snap = null; P.posKey = P.ordKey = ""; P.ticketLoaded = false; }
  if(typeof PG !== "undefined"){ PG.hist = null; PG.logs = null; PG.posKey = PG.ordKey = null; }
  if(ws && ws.readyState === 1) ws.send(JSON.stringify({acct: ACCT}));
  api("/api/paper").then(j => { if(j.paper){ paperUpdate(j.paper); if(typeof pagesPaper === "function") pagesPaper([]); } if(PG.page !== "chart") pgShow(PG.page, true); });
  const a = acctList().find(x => x.id === id); if(a) toast("Account: " + a.name);
}
async function acctRefresh(){ const j = await api("/api/accounts"); if(j.ok){ S.accounts = j.accounts; acctSetup(); } return j; }
function acctMgrRender(){
  const box = sq("#acctMgr"); if(!box) return;
  const all = (S && S.accounts) || [], rsx = n => n == null ? "–" : "₹" + Math.round(n).toLocaleString("en-IN");
  box.innerHTML = `<h3 class="pg-h3" style="margin-top:0">Your accounts</h3>
    <div class="alist">${all.map(a => `<div class="arow ${a.archived ? "arch" : ""}" data-id="${a.id}"><div><b>${sesc(a.name)}</b> ${a.id === ACCT ? '<span class="tag">showing</span>' : ""}${a.archived ? '<span class="tag">archived</span>' : ""}
        <div class="muted sm">${a.archived ? "" : `balance ${rsx(a.balance)} · equity ${rsx(a.equity)} · ${a.open || 0} open, ${a.orders || 0} orders · `}started with ${rsx(a.capital)} · ${a.mode === "live" ? '<span class="mode-live">LIVE at Fyers</span>' : "Paper"}</div></div>
      <div class="ubtns">${a.archived ? `<button class="sm" data-a="restore">Restore</button>` : `${a.id === ACCT ? "" : `<button class="sm" data-a="show">Show</button>`}<button class="sm" data-a="rename">Rename</button>${a.mode === "live" ? `<button class="sm" data-a="mode">Back to Paper</button>` : (S.user && S.user.role === "admin" && !all.some(x => x.mode === "live" && !x.archived) ? `<button class="sm danger" data-a="mode">Turn on LIVE</button>` : "")}<button class="sm" data-a="archive">Archive</button>`}</div></div>`).join("")}</div>
    <h4>New account</h4>
    <div class="f2"><div><label>Name</label><input id="naName" placeholder="e.g. NIFTY options" autocomplete="off"></div><div><label>Starting capital ₹</label><input id="naCap" class="mono" value="25000" inputmode="decimal"></div></div>
    <label>Rules and trailing</label><select id="naCopy"><option value="">Defaults</option>${all.filter(a => !a.archived).map(a => `<option value="${a.id}">Copy from ${sesc(a.name)}</option>`).join("")}</select>
    <div class="btns"><button class="primary" id="naGo">Create account</button></div><div id="naMsg"></div>
    <p class="help">Each account has its own balance, rules, trailing defaults, positions and history; switch at the top of the page. Archived accounts keep their trades.</p>`;
  sq("#naGo").onclick = async () => {
    const r = await api("/api/accounts/create", {body: {name: sq("#naName").value, capital: num(sq("#naCap").value), copy_from: sq("#naCopy").value}});
    if(!r.ok){ sq("#naMsg").innerHTML = `<div class="err">${sesc(r.error)}</div>`; return; }
    S.accounts = r.accounts; acctSetup(); acctSwitch(r.account.id); acctMgrRender();
  };
  box.querySelectorAll(".arow [data-a]").forEach(b => b.onclick = async () => {
    const id = b.closest(".arow").dataset.id, a = all.find(x => x.id === id), act = b.dataset.a;
    if(act === "show"){ acctSwitch(id); return; }
    if(act === "mode"){ liveModeDialog(a); return; }
    let body = {id};
    if(act === "rename"){ const n = prompt("New name:", a.name); if(!n) return; body.name = n; }
    if(act === "archive"){ if(!confirm(`Archive "${a.name}"? Its trades are kept; you can restore it later.`)) return; body.archived = true; }
    if(act === "restore") body.archived = false;
    const r = await api("/api/accounts/update", {body});
    if(!r.ok){ toast(r.error); return; }
    S.accounts = r.accounts; acctSetup();
    if(act === "archive" && id === ACCT) acctSwitch(acctList()[0].id);
    acctMgrRender();
  });
}
