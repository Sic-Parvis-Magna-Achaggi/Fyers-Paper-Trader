/* Live accounts on the page: the red LIVE badge and kill switch in the top bar, live warnings, the Fyers stop on
   every position, LIVE on the PLACE button, the Live card on the Account page, and the Paper <-> Live switch.
   Uses globals from index.html, paper.js, pages.js and security.js (api, P, S, ACCT, papi, stepUp, toast, esc, ...). */
"use strict";
const liveOn = () => !!(P.snap && P.snap.mode === "live");

function liveHeader(){
  let b = $("#liveBadge");
  if(!b){
    const sel = $("#acctSel"); if(!sel) return;
    b = document.createElement("span"); b.id = "liveBadge"; b.className = "livebadge hide"; b.textContent = "LIVE";
    b.title = "This account sends real orders to Fyers";
    const k = document.createElement("button"); k.id = "bKill"; k.className = "killbtn hide"; k.textContent = "KILL";
    k.title = "Kill switch: cancel every order and close every position at Fyers";
    k.onclick = liveKill;
    sel.after(b, k);
  }
  const on = liveOn();
  b.classList.toggle("hide", !on);
  $("#bKill").classList.toggle("hide", !on);
  document.body.classList.toggle("is-live", on);
}

function liveBanner(){
  let el = $("#liveWarn");
  if(!el){ el = document.createElement("div"); el.id = "liveWarn"; el.className = "livewarn hide"; const h = document.querySelector("#app > header"); h && h.append(el); }   // inside the header: the page layout's rows stay as they are
  const w = liveOn() ? (P.snap.live || {}).warnings || [] : [];
  el.classList.toggle("hide", !w.length);
  el.innerHTML = w.map(x => `<div>⚠ ${esc(x)}</div>`).join("");
}

function livePanel(){
  const h = document.querySelector("#panel h4"), t = h && h.nextElementSibling;
  if(!h) return;
  h.textContent = liveOn() ? "LIVE account" : "Paper account";
  if(t && t.classList.contains("tag")){ t.textContent = liveOn() ? "LIVE · Fyers" : "SIM"; t.classList.toggle("tag-live", liveOn()); }
}

function fyStopText(p){
  const f = p.fy || {};
  if(f.exiting) return {t: `closing at Fyers (${f.exiting})` + (f.exit_how ? ` · ${f.exit_how}` : "") + (f.exit_oid ? "" : " · sending…"), c: "warnc"};
  if(f.stop_oid) return {t: `Fyers stop ${fmt(f.stop_px, p.tick)}` + (f.stop_lim != null ? ` (limit ${fmt(f.stop_lim, p.tick)})` : "")
      + (f.want_px != null && f.want_px !== f.stop_px ? ` → moving to ${fmt(f.want_px, p.tick)}` : " ✓") + (f.stop_err ? " · last change refused" : ""), c: f.stop_err ? "warnc" : "up"};
  if(f.want_px == null) return {t: "no stop", c: "down"};
  const why = {failed: "refused: " + (f.stop_err || ""), "waiting for the market": "waits for the market", expired: "yesterday's expired",
               "no login": "log in to Fyers", mismatch: "Fyers' qty differs - Resync"}[f.stop_state] || "placing…";
  return {t: `NO STOP AT FYERS · ${why}`, c: "down"};
}

function livePositions(){
  if(!liveOn()) return;
  for(const p of P.snap.positions){
    const s = fyStopText(p);
    const el = document.querySelector(`#posList .pos[data-id="${p.id}"]`);
    if(el){
      let d = el.querySelector(".fyline");
      if(!d){ d = document.createElement("div"); d.className = "fyline"; el.append(d); }
      d.className = "fyline " + s.c; d.textContent = s.t;
    }
    const td = document.querySelector(`#pgPos tr[data-id="${p.id}"] td[data-e="sl"]`);
    if(td){
      let d = td.querySelector(".fyline");
      if(!d){ d = document.createElement("div"); d.className = "fyline"; td.append(d); }
      d.className = "fyline sm " + s.c; d.textContent = s.t;
    }
  }
  for(const o of P.snap.orders){
    const f = o.fy || {};
    const t = f.cancel_req ? "cancelling at Fyers…" : f.oid ? `at Fyers #${f.oid}` + (f.filled ? ` · ${f.filled} filled` : "") : f.state === "unsure" ? "Fyers didn't confirm - checking" : "sending to Fyers…";
    const el = document.querySelector(`#ordList .pos[data-id="${o.id}"]`);
    if(el){
      let d = el.querySelector(".fyline");
      if(!d){ d = document.createElement("div"); d.className = "fyline muted"; el.append(d); }
      d.textContent = t;
    }
  }
}

function livePlace(){
  const btn = $("#bPlace"); if(!btn) return;
  btn.classList.toggle("live", liveOn());
  if(liveOn() && !/^LIVE/.test(btn.textContent)) btn.textContent = "LIVE · " + btn.textContent;
  const tp = document.querySelector("#tool .tp");
  if(tp){ tp.classList.toggle("live", liveOn()); if(liveOn() && !/^LIVE/.test(tp.textContent)) tp.textContent = "LIVE " + tp.textContent; }
}

function liveDecorate(){ liveHeader(); liveBanner(); livePanel(); livePositions(); livePlace(); }

async function liveKill(){
  if(!liveOn()) return;
  if(!confirm("KILL SWITCH\n\nCancel every order and close every position at Fyers on this login (the app's trades and any others), then pause new orders until you press Resume.\n\nGo?")) return;
  const j = await api("/api/live/kill", {body: {}});
  if(j.paper) paperUpdate(j.paper);
  toast(j.ok ? "Kill switch: closing everything at Fyers" : j.error);
}

/* ---------------------------------------------------------------- Account page: the Live card */
async function liveCard(){
  const box = pgq("#pg_account"); if(!box || !liveOn()) return;
  const tag = box.querySelector(".pg-head .tag"); if(tag){ tag.textContent = "LIVE · Fyers"; tag.classList.add("tag-live"); }
  const rs0 = box.querySelector("#pgRsGo"); if(rs0) rs0.closest(".pg-card").classList.add("hide");
  let c = box.querySelector("#liveCard");
  if(!c){ c = document.createElement("div"); c.id = "liveCard"; c.className = "pg-card livecard"; box.querySelector(".pg-head").after(c); }
  const L = P.snap.live || {};
  c.innerHTML = `<h3 class="pg-h3" style="margin-top:0">Live at Fyers</h3>
    <div class="pg-cards">${[["Fyers login today", L.logged_in ? '<span class="up">yes</span>' : '<span class="down">no</span>'],
      ["Order updates", L.stream ? '<span class="up">connected</span>' : '<span class="warnc">order book every 5 s</span>'],
      ["New orders", L.halted ? '<span class="down">paused (kill switch)</span>' : '<span class="up">allowed</span>'],
      ["Fyers funds", '<span id="lvFunds" class="muted">…</span>']].map(([k, v]) => `<div class="pgc"><span>${k}</span><b>${v}</b></div>`).join("")}</div>
    ${(L.warnings || []).map(w => `<div class="note warnc">⚠ ${esc(w)}</div>`).join("")}
    <p class="help">Every trade has a real stop-limit at Fyers from the moment it opens; trailing, BE and BE-T move that same order.
      Targets, square-off and the expiry exit are the app's: it turns the stop into a market order (NSE / BSE) or cancels it and sends one market exit (MCX). Never two exit orders.</p>
    <div class="btns"><button id="lvResync" title="Read Fyers' order book and put every stop where it should be">Resync with Fyers</button>
      ${L.halted ? '<button class="primary" id="lvResume">Resume trading</button>' : ""}
      <button class="danger" id="lvKill">Kill switch</button></div><div id="lvMsg"></div>`;
  pgq("#lvKill").onclick = liveKill;
  pgq("#lvResync").onclick = async () => { const j = await api("/api/live/resync", {body: {}}); if(j.paper) paperUpdate(j.paper); pgq("#lvMsg").textContent = j.ok ? "Re-reading Fyers…" : j.error; };
  const r = pgq("#lvResume"); if(r) r.onclick = async () => { const j = await stepUp(() => api("/api/live/resume", {body: {}})); if(j.paper) paperUpdate(j.paper); else if(j.error && j.error !== "cancelled") toast(j.error); liveCard(); };
  const f = await api("/api/live/status?funds=1");
  const el = pgq("#lvFunds");
  if(el) el.textContent = f.funds && f.funds.available != null ? "₹" + Math.round(f.funds.available).toLocaleString("en-IN") + " available" : (f.funds_error ? "couldn't read" : "–");
}

/* ---------------------------------------------------------------- Paper <-> Live */
function liveModeDialog(a){
  const toLive = (a.mode || "paper") !== "live";
  let m = $("#liveDlg");
  if(!m){ m = document.createElement("div"); m.id = "liveDlg"; document.body.append(m); }
  const cid = ((S.fyers || {}).client_id) || "";
  m.className = "modalwrap";
  m.innerHTML = `<div class="ca ${toLive ? "livecard" : ""}"><b>${toLive ? "Turn on LIVE trading" : "Back to Paper"} · ${esc(a.name)}</b>
    ${toLive ? `<p class="help">Orders from this account will go to Fyers on your login (${esc(cid || "log in to Fyers first")}), from the server's own IP 134.209.159.171 - it must be whitelisted in your Fyers API app with order permission.</p>
      <p class="help">The account must be flat. Its paper trades are archived on the server and it starts a fresh ledger at the capital below (used for the % rules). Test with 1 lot on MCX first.</p>`
      : `<p class="help">The account must be flat. Its live trades are archived on the server and it starts a fresh paper ledger.</p>`}
    <label>Capital for the rules ₹</label><input id="ldCap" class="mono" inputmode="decimal" value="${a.capital || 25000}">
    ${toLive ? `<label>Type your Fyers client ID to confirm</label><input id="ldConfirm" class="mono" autocomplete="off" placeholder="${esc(cid)}">` : ""}
    <div class="err" id="ldErr"></div>
    <div class="btns"><button class="${toLive ? "danger" : "primary"}" id="ldGo">${toLive ? "Turn on LIVE" : "Switch to Paper"}</button><button class="ghost" id="ldX">Cancel</button></div></div>`;
  m.classList.remove("hide");
  sq("#ldX").onclick = () => m.classList.add("hide");
  sq("#ldGo").onclick = async () => {
    const body = {id: a.id, mode: toLive ? "live" : "paper", capital: num(sq("#ldCap").value), confirm: toLive ? sq("#ldConfirm").value : ""};
    const j = await stepUp(() => api("/api/accounts/mode", {body}));
    if(!j.ok){ if(j.error !== "cancelled") sq("#ldErr").textContent = j.error; return; }
    m.classList.add("hide");
    S.accounts = j.accounts; acctSetup();
    if(a.id === ACCT){ const k = await api("/api/paper"); if(k.paper) paperUpdate(k.paper); }
    else acctSwitch(a.id);
    acctMgrRender();
    if(PG.page === "account") setTimeout(pgAccount, 300);
    toast(`${a.name} is now ${toLive ? "LIVE" : "Paper"}`);
  };
}

/* ---------------------------------------------------------------- hooks into the existing views */
(function(){
  const pu = paperUpdate;
  paperUpdate = function(s, events){ pu(s, events); liveDecorate(); };
  const rp = renderPlan;
  renderPlan = function(){ rp(); livePlace(); };
  if(typeof toolOverlay === "function"){ const to = toolOverlay; toolOverlay = function(){ to(); livePlace(); }; }
  if(typeof pgPositions === "function"){ const pp = pgPositions; pgPositions = function(){ pp(); livePositions(); }; }
  if(typeof pgAccount === "function"){ const pa = pgAccount; pgAccount = function(){ pa(); liveCard(); }; }
})();
