/* Live on the page: the PAPER / LIVE switch at the top left (v0.33.0: Live is the admin's Fyers account itself, not a
   paper account switched to Live), the red LIVE badge and kill switch, live warnings, the Fyers stop on every position,
   trades placed in Fyers (marked) and the red NO STOP flag with "Place my stop", LIVE on the PLACE button, and the Live
   card on the Account page with Fyers' own funds.
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
  const on = liveOn(), sw = $("#sideSw");
  b.classList.toggle("hide", !on || !!(sw && !sw.classList.contains("hide")));   // (the PAPER / LIVE switch already says LIVE in red)
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
  const f = p.fy || {}, from = p.holding ? "Holding · " : p.outside ? "From Fyers · " : "";
  const r = fyStopText0(p, f);
  return {t: from + r.t, c: r.c};
}
function fyStopText0(p, f){
  if(p.nostop) return {t: "NO STOP AT FYERS" + (p.outside ? " (placed in Fyers without one)" : ""), c: "down"};
  if(f.exiting) return {t: `closing at Fyers (${f.exiting})` + (f.exit_how ? ` · ${f.exit_how}` : "") + (f.exit_oid ? "" : " · sending…"), c: "warnc"};
  if(f.stop_oid) return {t: `Fyers stop ${fmt(f.stop_px, p.tick)}` + (f.stop_type === 3 ? " (SL-M)" : f.stop_lim != null ? ` (limit ${fmt(f.stop_lim, p.tick)})` : "") + (f.stop_adopted ? " · placed in Fyers" : "")
      + (f.want_px != null && f.want_px !== f.stop_px ? ` → moving to ${fmt(f.want_px, p.tick)}` : " ✓") + (f.stop_err ? " · last change refused" : ""), c: f.stop_err ? "warnc" : "up"};
  if(f.want_px == null) return {t: "no stop", c: "down"};
  const why = {failed: "refused: " + (f.stop_err || ""), "waiting for the market": "waits for the market", expired: "yesterday's expired",
               "no login": "log in to Fyers", mismatch: "Fyers' qty differs - Resync"}[f.stop_state] || "placing…";
  return {t: `NO STOP AT FYERS · ${why}`, c: "down"};
}

function fyLine(host, p, s, extra){
  let d = host.querySelector(".fyline");
  if(!d){ d = document.createElement("div"); d.className = "fyline"; host.append(d); }
  const k = s.t + "|" + !!p.nostop;
  d.className = "fyline " + (extra || "") + s.c;
  if(d.dataset.k === k) return;                 // (never rebuilt under a finger: only when it changes)
  d.dataset.k = k;
  d.innerHTML = esc(s.t) + (p.nostop ? ` <button class="sm nsl" data-mystop="${p.id}" title="${esc(myStopTitle(p))}">Place my stop</button>` : "");
  const b = d.querySelector("[data-mystop]"); if(b) b.onclick = e => { e.stopPropagation(); placeMyStop(p.id); };
}
function livePositions(){
  if(!liveOn()) return;
  for(const p of P.snap.positions){
    const s = fyStopText(p);
    const el = document.querySelector(`#posList .pos[data-id="${p.id}"]`);
    if(el) fyLine(el, p, s);
    const td = document.querySelector(`#pgPos tr[data-id="${p.id}"] td[data-e="sl"]`);
    if(td) fyLine(td, p, s, "sm ");
  }
  for(const o of P.snap.orders){
    const f = o.fy || {};
    const t = (o.outside ? "Placed in Fyers · " : "") + (f.cancel_req ? "cancelling at Fyers…" : f.oid ? `at Fyers #${f.oid}` + (f.filled ? ` · ${f.filled} filled` : "") : f.state === "unsure" ? "Fyers didn't confirm - checking" : "sending to Fyers…");
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

function liveDecorate(){ liveHeader(); liveBanner(); livePanel(); livePositions(); livePlace(); liveBars(); }

/* the entry line's bar: a red "NO STOP" button on a trade without a stop (placed in Fyers without one) */
function liveBars(){
  const host = $("#posbars"); if(!host || !P.snap) return;
  for(const p of P.snap.positions){
    const el = host.querySelector(`.pbar[data-id="${p.id}"]`); if(!el) continue;
    let b = el.querySelector("button.nsl");
    if(p.nostop && liveOn()){
      if(!b){ b = document.createElement("button"); b.className = "nsl"; b.textContent = "NO STOP"; b.dataset.a = "mystop";
        const t = el.querySelector(".pt"); (t || el.lastChild).after(b);      // after the trade's figures, never next to ✕ (v0.43.3)
        b.onclick = e => { e.stopPropagation(); placeMyStop(p.id); }; }
      b.title = myStopTitle(p);
    } else if(b) b.remove();
  }
}

/* "Place my stop": your default stop for that contract (the stop distance remembered for it, else the tool's default),
   from the entry - or from the price when the entry's is already passed. Nothing is placed until you tap. */
function myStop(p){
  const r = (typeof sym !== "undefined" && sym[p.s]) || {};
  const tick = p.tick || r.tick || 0.05;
  const key = (r.u || r.s || p.s) + (r.f === "OPT" ? ":OPT" : "");
  const saved = (prefGet("sl_dist", {}) || {})[key];
  const dist = saved ? Math.max(tick, roundTick(saved, tick)) : Math.max(tick * 10, roundTick(p.avg * 0.003, tick));
  let sl = roundTick(p.avg - p.side * dist, tick);
  let why = (saved ? `your stop distance for ${short(p.s)}` : "the tool's default distance") + ` (${fmt(dist, tick)}) from the entry`;
  const m = p.mark || p.ltp;
  if(m && p.side * (m - sl) <= 0){ sl = roundTick(m - p.side * dist, tick); why = why.replace("from the entry", "from the price (the entry's is already passed)"); }
  return sl > 0 ? {sl, why, tick} : null;
}
function myStopTitle(p){
  const st = myStop(p);
  return "No stop at Fyers" + (p.outside ? " (placed in Fyers without one)" : "") + ". Tap to place your default stop at Fyers"
    + (st ? `: ${fmt(st.sl, st.tick)}, ${st.why}. Its first stop sets 1R; BE, BE-T and TRAIL work from then on.` : ".");
}
async function placeMyStop(id){
  const p = ((P.snap || {}).positions || []).find(x => x.id === id); if(!p) return;
  const st = myStop(p);
  if(!st){ toast("No price for it yet"); return; }
  const j = await papi("modify", {id, sl: st.sl});
  toast(j.ok ? `Stop ${fmt(st.sl, st.tick)} sent to Fyers - ${st.why}` : j.error);
}

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
  const mgr = box.querySelector("#acctMgr"); if(mgr) mgr.classList.add("hide");     // (paper accounts: on the Paper side)
  let c = box.querySelector("#liveCard");
  if(!c){ c = document.createElement("div"); c.id = "liveCard"; c.className = "pg-card livecard"; box.querySelector(".pg-head").after(c); }
  const fill = F => {
    const L = P.snap.live || {}, R = n => n == null ? "–" : rs(n);
    F = F || P.snap.fyfunds;
    const led = (n, x) => x ? `${n}: available ${R(x.available)} · in use ${R(x.used)} · start of day ${R(x.start)}${x.transfer ? ` · money moved ${R(x.transfer)}` : ""}` : "";
    c.innerHTML = `<h3 class="pg-h3" style="margin-top:0">Your Fyers account${L.client_id ? ` <span class="mono">${esc(L.client_id)}</span>` : ""}</h3>
      <div class="pg-cards">${[["Fyers login today", L.logged_in ? '<span class="up">yes</span>' : '<span class="down">no</span>'],
        ["Order updates", L.stream ? '<span class="up">connected</span>' : '<span class="warnc">order book every 5 s</span>'],
        ["New orders", L.halted ? '<span class="down">paused (kill switch)</span>' : '<span class="up">allowed</span>'],
        ["Funds read", F && F.at ? istTime(F.at) : '<span class="muted">not yet</span>']].map(([k, v]) => `<div class="pgc"><span>${k}</span><b>${v}</b></div>`).join("")}</div>
      <h4 style="margin:12px 0 4px">Fyers' funds</h4>
      <div class="pg-cards" id="lvFunds">${F ? [["Start of the day (Fyers)", R(F.start)], ["Money in / out today", F.transfer ? `<span class="${cls(F.transfer)}">${R(F.transfer)}</span>` : "–"],
        ["Today's trades, net of all charges", `<span class="${cls(F.net_today)}">${R(F.net_today)}</span>`], ["Balance", R(P.snap.acct.balance)],
        ["Equity (with open trades)", R(P.snap.acct.equity)], ["Margin in use (Fyers)", R(F.used)], ["Available (Fyers)", R(F.available)],
        ["Account size for the % rules", R(F.size)]].map(([k, v]) => `<div class="pgc"><span>${k}</span><b>${v}</b></div>`).join("")
        : '<div class="pgc"><span>Fyers funds</span><b class="muted">not read yet (log in to Fyers)</b></div>'}</div>
      ${F ? `<p class="help">${esc(led("Capital ledger", F.eq))}<br>${esc(led("Commodity ledger", F.co))}</p>` : ""}
      <p class="help">The balance is Fyers' own: its start of the day, money moved in or out, and today's closed trades net of every charge.
        Money moved in or out is never a profit or a loss: the account size, today's start and the highest balance move by it.
        ${F && !F.day_start_from_fyers ? "Today's start is an estimate until Fyers' funds for today are read (after the daily login)." : ""}</p>
      ${(L.warnings || []).map(w => `<div class="note warnc">⚠ ${esc(w)}</div>`).join("")}
      <p class="help">Every trade on this Fyers account shows here, placed from this app or straight in Fyers, and is managed the same way.
        Every trade has a real stop at Fyers (one placed in Fyers is adopted: that same order is moved); trailing, BE and BE-T move it.
        Targets, square-off and the expiry exit are the app's: it turns the stop into a market order (NSE / BSE) or cancels it and sends one market exit (MCX). Never two exit orders.
        Delivery holdings are never squared off, and Close all and the kill switch keep them.</p>
      <div class="btns"><button id="lvResync" title="Read Fyers' order and position books and put every stop where it should be">Resync with Fyers</button>
        <button id="lvFundsGo" title="Read Fyers' funds now (they're read every minute)">Read funds now</button>
        ${L.halted ? '<button class="primary" id="lvResume">Resume trading</button>' : ""}
        <button class="danger" id="lvKill">Kill switch</button></div><div id="lvMsg"></div>`;
    pgq("#lvKill").onclick = liveKill;
    pgq("#lvResync").onclick = async () => { const j = await api("/api/live/resync", {body: {}}); if(j.paper) paperUpdate(j.paper); pgq("#lvMsg").textContent = j.ok ? "Re-reading Fyers…" : j.error; };
    pgq("#lvFundsGo").onclick = async () => { const f = await api("/api/live/status?funds=1"); if(f.funds_error) toast("Fyers' funds: " + f.funds_error);
      if(f.funds && P.snap) P.snap.fyfunds = f.funds; liveCard(); };     // (liveCard, as wrapped by tgalerts.js: its line stays)
    const r = pgq("#lvResume"); if(r) r.onclick = async () => { const j = await stepUp(() => api("/api/live/resume", {body: {}})); if(j.paper) paperUpdate(j.paper); else if(j.error && j.error !== "cancelled") toast(j.error); liveCard(); };
  };
  fill();
}

/* ---------------------------------------------------------------- the PAPER / LIVE / MT5 switch (top left; phone: top bar)
   v0.36.0: MT5 (roadmap 8 b1) is a third side of its own colour: the admin's MT5 accounts, kept apart from Fyers. */
function sideNow(){ return typeof sideMT5 === "function" && sideMT5() ? "mt5" : sideLive() ? "live" : "paper"; }
function sideRender(){
  const admin = !!(S && S.user && S.user.role === "admin"), live = sideLive(), now = sideNow();
  let el = $("#sideSw");
  if(!el){
    const brand = document.querySelector("#app > header .brand");
    if(brand){ el = document.createElement("span"); el.id = "sideSw"; el.className = "sidesw";
      el.innerHTML = `<button data-s="paper">PAPER</button><button data-s="live">LIVE</button><button data-s="mt5">MT5</button>`; brand.after(el);
      el.querySelectorAll("button").forEach(b => b.onclick = () => sideClick(b.dataset.s)); }
  }
  if(el){
    el.classList.toggle("hide", !admin); el.classList.toggle("live", live); el.classList.toggle("mt5", now === "mt5");
    for(const k of ["paper", "live", "mt5"]) el.querySelector(`[data-s="${k}"]`).classList.toggle("on", now === k);
    el.title = live ? "LIVE: this page trades on your Fyers account - every order is real. PAPER (one click) goes back to your paper accounts."
      : now === "mt5" ? "MT5: this page shows your MT5 accounts (straight from MT5, kept apart from Fyers); moving a stop or closing changes the real trade at the broker. PAPER (one click) goes back."
      : "PAPER: this page trades your paper accounts. LIVE switches it to your Fyers account (client ID + a 2FA code); MT5 to your MT5 accounts (a 2FA code).";
  }
  const top = $("#mTop");
  let m = $("#mSide");
  if(top && !m){ m = document.createElement("button"); m.id = "mSide"; const a = $("#mAcct"); a ? a.before(m) : top.prepend(m);
    m.onclick = sideMenu; }
  if(m){
    m.classList.toggle("hide", !admin); m.classList.toggle("live", live); m.classList.toggle("mt5", now === "mt5");
    m.textContent = now.toUpperCase();
    m.title = live ? "Live: your Fyers account (tap to switch)" : now === "mt5" ? "MT5: your MT5 accounts (tap to switch)" : "Paper (tap to switch to Live or MT5)";
    const ml = $("#mLive"); if(ml && admin) ml.classList.add("keephide");
  }
}
function sideMenu(){                           // the phone: PAPER / LIVE / MT5 in a small menu under the button
  let d = $("#mSideMenu");
  if(d){ d.remove(); return; }
  d = document.createElement("div"); d.id = "mSideMenu"; d.className = "sidemenu";
  d.innerHTML = ["paper", "live", "mt5"].map(k => `<button data-s="${k}" class="${k}${sideNow() === k ? " on" : ""}">${k.toUpperCase()}</button>`).join("");
  document.body.append(d);
  const r = $("#mSide").getBoundingClientRect(); d.style.left = r.left + "px"; d.style.top = (r.bottom + 4) + "px";
  d.querySelectorAll("button").forEach(b => b.onclick = e => { e.stopPropagation(); d.remove(); sideClick(b.dataset.s); });
  setTimeout(() => document.addEventListener("pointerdown", function x(e){ if(!d.contains(e.target)){ d.remove(); document.removeEventListener("pointerdown", x, true); } }, true), 0);
}
function sideClick(want){
  if(want === sideNow()) return;
  if(want === "paper") return sideSet("paper");
  if(want === "mt5") return mtSideDialog();
  sideDialog();
}
async function sideSet(side, confirm){
  const j = await api("/api/side", {body: {side, confirm: confirm || ""}});
  if(j.ok) sideApply(j);
  else if(j.error !== "cancelled") toast(j.error);
  return j;
}
function sideApply(j){
  S.side = j.side; S.live = j.live || S.live; if(j.accounts) S.accounts = j.accounts;
  acctSetup();
  if(typeof acctMgrRender === "function") acctMgrRender();
  liveHeader();
  if(typeof mtDecorate === "function") mtDecorate();
  toast(j.side === "live" ? "LIVE: this page now trades on your Fyers account" : j.side === "mt5" ? "MT5: your MT5 accounts" : "Paper: your paper accounts");
}
function mtSideDialog(){
  let m = $("#mtSideDlg");
  if(!m){ m = document.createElement("div"); m.id = "mtSideDlg"; document.body.append(m); }
  const n = typeof mt5List === "function" ? mt5List().length : 0;
  m.className = "modalwrap";
  m.innerHTML = `<div class="ca mtcard"><b>Switch this page to MT5 · your MT5 accounts</b>
    <p class="help">On MT5 this page shows your MT5 accounts, kept apart from Fyers: one for each MT5 login whose terminal runs the
      FTM Bridge EA (1.20) on your laptop${n ? ` (${n} so far)` : " (none has called yet)"}. Positions, pending orders, balance and history come
      straight from MT5, in the account's currency, net of commission and swap; trades you place in MT5 itself show too.</p>
    <p class="help"><b>Every order you place here is real</b>, sent to MT5 with its SL and TP; moving a stop, BE, BE-T, TRAIL and ✕ change
      the real trade at the broker. No hedging: an order opposite a
      trade on the same symbol, in this or another MT5 account, is refused.</p>
    <p class="help">Back to Paper is one click. Each browser or phone switches for itself.</p>
    <div class="err" id="mtsErr"></div>
    <div class="btns"><button class="primary mt5btn" id="mtsGo">Switch to MT5</button><button class="ghost" id="mtsX">Cancel</button></div></div>`;
  m.classList.remove("hide");
  sq("#mtsX").onclick = () => m.classList.add("hide");
  sq("#mtsGo").onclick = async () => {
    const j = await stepUp(() => api("/api/side", {body: {side: "mt5"}}));
    if(!j.ok){ if(j.error !== "cancelled") sq("#mtsErr").textContent = j.error; return; }
    m.classList.add("hide");
    sideApply(j);
  };
}
function sideFromServer(side){               // another page of this login switched (a tab, a grid chart)
  if(S && S.side !== side){ S.side = side; refreshState(); }
}
function sideDialog(){
  let m = $("#liveDlg");
  if(!m){ m = document.createElement("div"); m.id = "liveDlg"; document.body.append(m); }
  const cid = ((S.fyers || {}).client_id) || "";
  const ip = ((S.server || {}).out_ip) || "";
  m.className = "modalwrap";
  m.innerHTML = `<div class="ca livecard"><b>Switch this page to LIVE · your Fyers account</b>
    <p class="help">On Live this page shows your Fyers account itself (${esc(cid || "log in to Fyers first")}): its real balance from Fyers, and every
      position and order at Fyers, also the ones you place in the Fyers app. <b>Every order you place here is real.</b>
      Orders go from ${ip ? `this server's own IP <b class="mono">${esc(ip)}</b>` : "this server's own public IP (to see it, run  curl -4 ifconfig.me  on the server)"} -
      it must be whitelisted in your Fyers API app with order permission.</p>
    <p class="help">Back to Paper is one click. The server keeps managing your live trades (stops, trailing, BE, targets, square-off,
      alerts) whichever side this page is on. Each browser or phone switches for itself.</p>
    <label>Type your Fyers client ID to confirm</label><input id="ldConfirm" class="mono" autocomplete="off" placeholder="${esc(cid)}">
    <div class="err" id="ldErr"></div>
    <div class="btns"><button class="danger" id="ldGo">Switch to LIVE</button><button class="ghost" id="ldX">Cancel</button></div></div>`;
  m.classList.remove("hide");
  sq("#ldX").onclick = () => m.classList.add("hide");
  const go = async () => {
    const j = await stepUp(() => api("/api/side", {body: {side: "live", confirm: sq("#ldConfirm").value}}));
    if(!j.ok){ if(j.error !== "cancelled") sq("#ldErr").textContent = j.error; return; }
    m.classList.add("hide");
    sideApply(j);
  };
  sq("#ldGo").onclick = go;
  sq("#ldConfirm").onkeydown = e => { if(e.key === "Enter") go(); };
  setTimeout(() => { const i = sq("#ldConfirm"); i && i.focus(); }, 50);
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
  if(typeof posBars === "function"){ const pb = posBars; posBars = function(){ pb(); liveBars(); }; }
  if(typeof renderRules === "function"){ const rr = renderRules; renderRules = function(sel){ rr(sel); liveRules(sel || "#rulesForm"); }; }
})();

/* the rules form on the Live account: its size comes from Fyers (not typed) */
function liveRules(sel){
  if(!liveOn()) return;
  const inp = document.querySelector(sel + ' [data-k="size"]'); if(!inp) return;
  inp.readOnly = true; inp.classList.add("ro");
  const box = inp.closest(".rf");
  if(box){ const l = box.querySelector("label"); if(l) l.textContent = "Account size (₹, from Fyers)";
    let h = box.querySelector(".help"); if(!h){ h = document.createElement("div"); h.className = "help"; box.append(h); }
    h.textContent = "Base for the % limits: your Fyers balance at the start of the day you switched to Live, moved by money in / out since. It comes from Fyers, not typed."; }
}
