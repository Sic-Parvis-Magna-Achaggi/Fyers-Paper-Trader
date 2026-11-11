/* Paper trading panel: ticket, chart lines (draggable), positions, orders, history, rules.
   Uses globals from index.html: api, toast, fmt, chart, series, cur, last, sym, openSymbol, sendWant, $ */
"use strict";
const P = {
  snap: null, plan: null, armed: false, pvTimer: null, pvSeq: 0, drags: [], posDrags: [], toolDrags: [], dragging: null,
  posLines: [], toolLines: null, prim: null, primSeries: null, hits: [], posKey: "", ordKey: "", tab: "pos",
  T: {s: null, side: 1, follow: true, price: null, slDist: null, tpDist: null, tp_r: 2, tpMode: "r", basis: "self", ref: null,
      mode: "pct", risk_pct: 1, risk_amt: 250, lots: 1, product: "INTRADAY", rr_lock: false, lockTp: null}
};
/* money in the account's currency: ₹ for paper and Fyers, the MT5 account's own ($) on the MT5 side (v0.36.0) */
const CUR = () => { const c = P.snap && P.snap.ccy; return !c || c === "INR" ? "₹" : c === "USD" ? "$" : c === "EUR" ? "€" : c === "GBP" ? "£" : c + " "; };
const CURLOC = () => CUR() === "₹" ? "en-IN" : "en-US";
const rs = n => n == null || isNaN(n) ? "–" : (n < 0 ? "−" : "") + CUR() + Math.abs(n).toLocaleString(CURLOC(), {minimumFractionDigits: 2, maximumFractionDigits: 2});
const rsS = n => n == null || isNaN(n) ? "–" : (n > 0 ? "+" : n < 0 ? "−" : "") + CUR() + Math.abs(n).toLocaleString(CURLOC(), {maximumFractionDigits: CUR() === "₹" ? 0 : 2});
const cls = n => n > 0 ? "up" : n < 0 ? "down" : "";
/* lots typed: whole lots on Fyers; MT5's volume in 0.01 steps on an MT5 account (v0.37.0) */
const isMtAcct = () => !!(P.snap && P.snap.mode === "mt5");
const lotsIn = v => isMtAcct() ? Math.max(0.01, Math.round(+v * 100) / 100) : Math.max(1, Math.round(+v));
const lotsStep = (v, d) => isMtAcct() ? lotsIn(+v + d * 0.01) : lotsIn(+v + d);
const short = s => (s || "").replace(/^[A-Z][A-Z0-9]*:/, "");   // (NSE:, MCX:, MT5:)
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = v => { const n = parseFloat(String(v).replace(/,/g, "")); return isNaN(n) ? null : n; };
const roundTick = (p, t) => { t = t || 0.05; return +(Math.round(p / t) * t).toFixed(6); };
const dp = t => (String(t || 0.05).split(".")[1] || "").length;

/* ---------------------------------------------------------------- server */
async function papi(path, body){
  const j = await api("/api/paper/" + path, body === undefined ? {} : {body});
  if(j.paper) paperUpdate(j.paper);
  if(!j.ok){ toast(j.error || "Refused"); setStatus(j.error, true); }
  return j;
}
function setStatus(msg, bad){
  const el = $("#tkStatus"); if(!el) return;
  el.textContent = msg || ""; el.className = "status" + (bad ? " down" : "");
}

/* ---------------------------------------------------------------- snapshot */
function paperUpdate(s, events){
  P.snap = s;
  for(const e of events || []) toast(e);
  renderAcct(); renderTrail(); renderPositions(); renderOrders(); renderEvents(); drawLines();
  if(events && events.length && P.tab === "hist") loadTrades();
  if(typeof pagesPaper === "function") pagesPaper(events);
  if(!P.ticketLoaded && s.ticket){ Object.assign(P.T, {mode: s.ticket.mode, risk_pct: s.ticket.risk_pct, risk_amt: s.ticket.risk_amt,
    lots: s.ticket.lots, product: s.ticket.product, tp_r: s.ticket.tp_r, rr_lock: !!s.ticket.rr_lock}); P.ticketLoaded = true; renderTicket(); }
  if(document.querySelector("#drawer.open") && !P.rulesShown){ renderRules(); }
}
function renderAcct(){
  const a = P.snap.acct;
  const cells = [
    ["Balance", rs(a.balance)], ["Equity", rs(a.equity)],
    ["Open P&L (net)", `<span class="${cls(a.open_net)}">${rs(a.open_net)}</span>`],
    ["Today (net)", `<span class="${cls(a.realized_today)}">${rs(a.realized_today)}</span>`],
    ["Day room", a.day_room == null ? "off" : `<span class="${a.day_room < 0 ? "down" : a.day_room < a.balance*0.01 ? "warnc" : ""}">${rs(a.day_room)}</span>`],
    ["Max room", a.max_room == null ? "off" : `<span class="${a.max_room < 0 ? "down" : ""}">${rs(a.max_room)}</span>`],
    ["Margin used", rs(a.margin_used)], ["Open risk", rs(a.open_risk)],
  ];
  $("#acct").innerHTML = cells.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
  $("#acctFoot").textContent = `${a.trades} trades · net ${rsS(a.net_total)} · charges ${rsS(a.charges_total)}`
    + (a.win_rate != null ? ` · win ${a.win_rate}%` : "") + (a.pf != null ? ` · PF ${a.pf}` : "") + ` · today ${a.trades_today} trades, charges ${rsS(a.charges_today)}`;
}

/* ---------------------------------------------------------------- ticket (the long / short tool)
   The entry follows the market until you drag it (or type a price). Dragged below the market a buy becomes a
   limit, above it a stop (the other way round for a sell). SL and TP keep their distance from the entry, so the
   whole tool moves with the price. Distances you set are remembered per underlying. */
function tkRow(){ return sym[P.T.s] || null; }
function basisSym(){ return P.T.basis === "underlying" ? P.T.ref : P.T.s; }
function ltpOf(s){ return last[s] ? last[s].ltp : null; }
function tickOf(s){ return (sym[s] || {}).tick || (P.plan && P.plan.ref === s ? P.plan.ref_tick : null) || (tkRow() || {}).tick || 0.05; }
function udir(){ const r = tkRow() || {}; return P.T.side * (P.T.basis === "underlying" && r.o === "PE" ? -1 : 1); }
function mktEntry(){
  const t = last[P.T.s]; if(!t) return null;
  const v = P.T.side > 0 ? t.ask : t.bid; return v || t.ltp;
}
function entryNow(){ return P.T.follow ? mktEntry() : P.T.price; }
function orderType(){
  if(P.T.follow) return "market";
  const l = ltpOf(P.T.s); if(l == null || P.T.price == null) return "limit";
  return P.T.side * (P.T.price - l) <= 0 ? "limit" : "stop";
}
function basisNow(){ return P.T.basis === "underlying" ? (ltpOf(P.T.ref) || (P.plan && P.plan.ref_price)) : entryNow(); }
function slNow(){ const b = basisNow(); return b == null || P.T.slDist == null ? null : roundTick(b - udir() * P.T.slDist, tickOf(basisSym())); }
function tpNow(){
  const b = basisNow(); if(b == null) return null;
  if(P.T.lockTp != null) return roundTick(P.T.lockTp, tickOf(basisSym()));          // RR lock: the target you're moving
  if(P.T.tpMode === "dist" && P.T.tpDist != null) return roundTick(b + udir() * P.T.tpDist, tickOf(basisSym()));
  // the target as an R: the last exact figure from the server, scaled to the stop now (so it follows a stop being dragged)
  if(P.plan && P.plan.tp != null && P.plan.entry != null && P.plan.sl != null && P.T.slDist != null && P.T.basis === "self")
    return roundTick(b + udir() * P.T.slDist * rrK(), tickOf(basisSym()));
  if(P.plan && P.plan.tp != null && P.plan.entry != null) return roundTick(b + udir() * Math.abs(P.plan.tp - P.plan.entry), tickOf(basisSym()));
  if(P.T.slDist != null) return roundTick(b + udir() * P.T.slDist * (P.T.tp_r || 2), tickOf(basisSym()));   // until the server has worked it out
  return null;
}
/* RR lock (LiveTrader 1.24): the tool keeps its net RR (Target R) whether you move the stop (the target follows) or the
   target (the stop follows). The exact stop comes from the server (lock_tp: net of every charge, at the lots it sizes to). */
function lockOn(){ return !!P.T.rr_lock && P.T.basis === "self"; }
function rrK(){            // target distance / stop distance in price, from the last exact plan (charges make it more than the R)
  const p = P.plan;
  if(p && p.tp != null && p.sl != null && p.entry != null && Math.abs(p.entry - p.sl) > 0) return Math.abs(p.tp - p.entry) / Math.abs(p.entry - p.sl);
  return P.T.tp_r || 2;
}
function lockTo(tp){       // the target was moved to tp with the lock on: the stop follows (exactly once the server answers)
  const b = basisNow(), T = P.T; if(b == null || tp == null) return;
  if(udir() * (tp - b) <= 0) return toast("The target must be on the profit side of the entry");
  T.tpMode = "r"; T.lockTp = tp;
  T.slDist = Math.max(tickOf(basisSym()), roundTick(Math.abs(tp - b) / rrK(), tickOf(basisSym())));
}
function setRR(v, quiet){
  v = num(String(v).replace(/^\s*RR\s*/i, "").replace(",", "."));
  if(v == null || v < 0.1 || v > 50){ if(!quiet) toast("RR: a number from 0.1 to 50"); renderTicket(); return; }
  P.T.tp_r = Math.round(v * 10) / 10; P.T.tpMode = "r"; P.T.lockTp = null;
  saveTicketDefaults(); renderTicket(); toolRedraw(); preview(0);
}
function rrLockToggle(){
  if(P.T.basis === "underlying") return toast("The RR lock works on the contract's own price, not the underlying's");
  P.T.rr_lock = !P.T.rr_lock;
  if(P.T.rr_lock){ P.T.tpMode = "r"; P.T.lockTp = null; }       // locking puts the target at the RR now
  setStatus(P.T.rr_lock ? `RR locked at ${P.T.tp_r}: moving the stop moves the target, moving the target moves the stop` : "RR unlocked");
  saveTicketDefaults(); renderTicket(); toolRedraw(); preview(0);
}
const lockSvg = on => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="currentColor"/>`
  + `<path d="${on ? "M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" : "M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V5.6"}" fill="none" stroke="currentColor" stroke-width="1.7"/>`
  + `<rect x="7.3" y="9.4" width="1.4" height="3" rx=".5" fill="${on ? "#212121" : "var(--panel,#222)"}"/></svg>`;
function lockTitle(){
  if(P.T.basis === "underlying") return "RR lock: works on the contract's own price, not the underlying's";
  return P.T.rr_lock ? `RR locked at ${P.T.tp_r}: moving the stop moves the target, moving the target moves the stop (net of all charges). Click to unlock`
    : `RR not locked. Click to lock the tool at RR ${P.T.tp_r}`;
}
function renderLock(){
  const T = P.T;
  for(const id of ["#cLock", "#tkLock", "#mtLock"]){
    const b = $(id); if(!b) continue;
    const key = [T.rr_lock, T.basis].join("|");
    if(b.dataset.k !== key){ b.dataset.k = key; b.innerHTML = lockSvg(T.rr_lock) + (b.dataset.txt ? " " + b.dataset.txt : ""); }
    b.classList.toggle("on", !!T.rr_lock); b.disabled = T.basis === "underlying"; b.title = lockTitle();
  }
  const rr = $("#cRR");
  if(rr){ if(document.activeElement !== rr) rr.value = "RR " + (+T.tp_r || 2).toFixed(1); rr.classList.toggle("on", !!T.rr_lock);
    rr.title = "Reward : risk for the tool, net of all charges (as its TP tag shows). Type and press Enter: the tool's target goes to that RR"
      + (T.rr_lock ? ". Locked: moving the stop or the target keeps it" : ". Lock it with the padlock to keep it while you move the stop or target"); }
}
function distKey(){ const r = tkRow() || {}; return (P.T.basis === "underlying" ? "U:" : "") + (r.u || r.s) + (r.f === "OPT" && P.T.basis === "self" ? ":OPT" : ""); }
function setDefaults(){
  const b = basisNow(); if(b == null) return false;
  const tick = tickOf(basisSym());
  const saved = (prefGet("sl_dist", {}) || {})[distKey()];
  P.T.slDist = saved ? Math.max(tick, roundTick(saved, tick)) : Math.max(tick * 10, roundTick(b * 0.003, tick));
  if(P.T.basis === "underlying"){ P.T.tpMode = "dist"; P.T.tpDist = P.T.slDist * (P.T.tp_r || 2); }
  else if(P.T.tpMode !== "dist") P.T.tpMode = "r";
  else P.T.tpDist = P.T.slDist * (P.T.tp_r || 2);
  return true;
}
function paperOnSymbol(row){
  if(!P.book || P.book.s !== row.s){ P.book = null; if(P.tab === "book") renderBook(null); }
  // the chart switched contract: the tool follows it, unless it's the future of an option tool using underlying stops
  if(P.T.basis === "underlying" && row.s === P.T.ref){ renderTicket(); toolRedraw(); return; }
  if(P.T.s !== row.s){
    P.T.s = row.s; P.T.basis = "self"; P.T.ref = null; P.T.follow = true; P.T.price = null; P.plan = null;
    P.T.slDist = null; P.T.tpMode = "r";
    if(P.armed) setDefaults();
  }
  renderTicket(); drawLines(); preview();
}
function arm(side){
  if(!P.T.s){ toast("Open a contract's chart first"); return; }
  if((tkRow() || {}).f === "IDX"){ toast("An index can't be traded - open its futures or options"); return; }
  if(P.armed && P.T.side === side){ disarm(); return; }
  const flip = P.armed && P.T.side !== side;
  P.T.side = side; P.armed = true;
  if(flip){ P.T.follow = true; P.T.price = null; }
  if(P.T.slDist == null || flip){ if(!setDefaults()) P.needDefaults = true; }
  P.plan = null;
  renderTicket(); drawLines(); preview(0); sendWant();
}
function disarm(){ P.armed = false; P.plan = null; P.T.follow = true; P.T.price = null; renderTicket(); drawLines(); sendWant(); }
function wantSymbols(){ return P.armed ? [P.T.s, P.T.ref].filter(Boolean) : []; }
function toMarket(){ P.T.follow = true; P.T.price = null; renderTicket(); toolRedraw(); preview(0); }

function renderTicket(){
  const row = tkRow(), T = P.T;
  $("#tkSym").textContent = row ? short(row.s) : "No contract";
  $("#tkInfo").textContent = row ? (row.f === "IDX" ? "index: chart only, can't be traded" : `${row.x || ""} · lot ${row.lot}${row.mult > 1 ? " × " + row.mult : ""} · tick ${row.tick}`) : "";
  for(const [id, s] of [["#bBuy", 1], ["#bSell", -1], ["#cBuy", 1], ["#cSell", -1]]) $(id).classList.toggle("on", P.armed && T.side === s);
  $("#tkBody").classList.toggle("hide", !P.armed);
  $("#tkHint").classList.toggle("hide", P.armed);
  if(!P.armed){ renderLock(); toolOverlay(); return; }
  const typ = orderType();
  document.querySelectorAll("#tkType button").forEach(b => b.classList.toggle("on", b.dataset.v === typ));
  document.querySelectorAll("#tkMode button").forEach(b => b.classList.toggle("on", b.dataset.v === T.mode));
  document.querySelectorAll("#tkBasis button").forEach(b => b.classList.toggle("on", b.dataset.v === T.basis));
  $("#tkBasisRow").classList.toggle("hide", !(row && row.f === "OPT"));
  const setv = (id, v) => { if(document.activeElement !== $(id)) $(id).value = v ?? ""; };
  setv("#tkPrice", T.follow ? "market" : T.price);
  setv("#tkSl", slNow()); setv("#tkTp", tpNow());
  setv("#tkTpR", T.tpMode === "r" ? T.tp_r : "");
  renderLock();
  $("#tkTp").placeholder = T.basis === "underlying" ? "future price" : "price";
  $("#tkSl").placeholder = T.basis === "underlying" ? "future price" : "price";
  $("#tkTpR").disabled = T.basis === "underlying";
  setv("#tkSize", T.mode === "pct" ? T.risk_pct : T.mode === "amt" ? T.risk_amt : T.lots);
  $("#tkSizeUnit").textContent = T.mode === "pct" ? "% of balance" : T.mode === "amt" ? CUR().trim() + " at risk (net)" : isMtAcct() ? "lots (0.01 steps)" : "lots";
  // stocks: Intraday or Delivery (CNC); derivatives: Intraday or Carry (NRML)
  const stock = row && (row.f === "EQ" || row.f === "OTHER"), want = stock ? "CNC" : "MARGIN";
  const pe = $("#tkProd"); if(pe.dataset.k !== want){ pe.dataset.k = want;
    pe.innerHTML = `<option value="INTRADAY">Intraday</option><option value="${want}">${stock ? "Delivery (CNC)" : "Carry (NRML)"}</option>`; }
  pe.value = T.product === "INTRADAY" ? "INTRADAY" : want;
  const note = $("#tkBasisNote");
  if(T.basis === "underlying"){
    const onIt = cur && cur.s === T.ref;
    note.innerHTML = T.ref ? (onIt ? `SL and target are on this chart (${esc(short(T.ref))}). The option is sold when the future hits them.`
      : `SL and target are prices of <b>${esc(short(T.ref))}</b>. <a href="#" id="goRef">Open its chart</a> to drag them.`) : "Finding the future…";
    const g = $("#goRef"); if(g) g.onclick = e => { e.preventDefault(); const r = sym[T.ref]; if(r) openSymbol(r); else openBySymbol(T.ref); };
  } else note.textContent = "";
  renderPlan(); toolOverlay();
}
function renderPlan(){
  const p = P.plan, el = $("#tkPv"), btn = $("#bPlace");
  if(!p){ if(!P.pvErr) el.innerHTML = `<div class="muted">Working out size and costs…</div>`; btn.disabled = true; btn.textContent = "Place"; return; }
  const est = p.risk_estimated ? "≈ " : "";
  const ec = p.entry_charges;
  const rows = [
    ["Lots", `<b>${p.lots}</b> <span class="muted">(${p.qty} qty${p.mult > 1 ? ` × ${p.mult}` : ""})</span>`],
    ["Entry", `${fmt(p.entry, p.tick)} <span class="muted">${p.type === "market" ? "market, at the " + (p.side > 0 ? "ask" : "bid") : p.type}</span>`],
    ["At stop (net)", p.risk != null ? `<b class="down">${est}${rs(-p.risk)}</b>` : p.risk_1lot != null ? `<span class="down">1 lot would be ${est}${rs(-p.risk_1lot)}</span>` : "no stop"],
    ["At target (net)", p.reward != null ? `<b class="up">${est}${rs(p.reward)}</b>` + (p.rr != null ? ` <span class="muted">${p.rr}R</span>` : "") : "–"],
    ["BE + costs", p.be != null ? fmt(p.be, p.tick) : "–"],
    ["Charges in/out", p.risk_detail ? `${rs(p.risk_detail.entry_charges)} + ${rs(p.risk_detail.exit_charges)} <a href="#" id="pvMore">detail</a>` : (ec ? rs(ec.total) + " entry" : "–")],
    ["Margin", p.margin ? rs(p.margin) + (p.margin_source === "premium" ? ' <span class="muted">premium</span>' : "") : '<span class="muted">not checked</span>'],
  ];
  if(p.ref) rows.splice(2, 0, ["Underlying", `${esc(short(p.ref))} ${fmt(p.ref_price)} · delta ${p.delta}`]);
  el.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join("")
    + (p.notes && p.notes.length ? `<div class="note">${p.notes.map(esc).join(" · ")}</div>` : "")
    + (p.blocked ? `<div class="note down">${esc(p.blocked)}</div>` : "")
    + `<div class="breakdown hide" id="pvBd"></div>`;
  const more = $("#pvMore");
  if(more) more.onclick = e => { e.preventDefault(); const bd = $("#pvBd"); bd.classList.toggle("hide"); bd.innerHTML = breakdown(p.entry_charges, "Entry order"); };
  btn.disabled = !!p.blocked || !p.lots;
  btn.className = "place " + (p.side > 0 ? "buy" : "sell");
  btn.textContent = placeLabel(p);
}
function placeLabel(p){
  return `${p.side > 0 ? "BUY" : "SELL"} ${p.lots || 0} lot${p.lots === 1 ? "" : "s"} ${p.type === "market" ? "at market" : p.type + " " + fmt(p.entry, p.tick)}`;
}
function breakdown(c, title){
  if(!c) return "";
  const names = {brokerage: "Brokerage", exchange: "Exchange txn", clearing: "Clearing", tax: c.tax_name || "CTT/STT", stamp: "Stamp duty", sebi: "SEBI fee", ipft: "IPFT", gst: "GST 18%", dp: "DP (delivery sell)",
    commission: "Commission (MT5)", swap: "Swap (a credit shows as minus)"};
  return `<div class="bdt">${esc(title)}${c.value ? ` · value ${rs(c.value)}` : ""}</div>` +
    Object.entries(names).filter(([k]) => c[k]).map(([k, n]) => `<div><span>${n}</span><span>${rs(c[k])}</span></div>`).join("") +
    `<div class="tot"><span>Total</span><span>${rs(c.total)}</span></div>`;
}
function ticketBody(){
  const T = P.T, typ = orderType();
  const useR = T.tpMode === "r" && T.basis === "self";
  return {s: T.s, side: T.side, type: typ, price: typ === "market" ? null : T.price, sl: slNow(),
    tp: useR ? null : tpNow(), tp_r: useR ? T.tp_r : null,
    lock_tp: useR && lockOn() && T.lockTp != null ? T.lockTp : null,
    basis: T.basis, mode: T.mode, risk_pct: T.risk_pct, risk_amt: T.risk_amt, lots: T.lots, product: T.product};
}
function preview(delay = 250){
  if(!P.armed || !P.T.s) return;
  clearTimeout(P.pvTimer);
  P.pvTimer = setTimeout(async () => {
    if(P.needDefaults && setDefaults()) P.needDefaults = false;
    const my = ++P.pvSeq, body = ticketBody();
    const j = await api("/api/paper/preview", {body});
    if(body.lock_tp != null && P.T.lockTp === body.lock_tp){             // the RR lock's answer: the exact stop for that target
      P.T.lockTp = null;
      if(j.ok && j.plan.sl != null && j.plan.entry != null){
        P.T.slDist = Math.max(tickOf(basisSym()), roundTick(Math.abs(j.plan.entry - j.plan.sl), tickOf(basisSym()))); rememberDist();
        if(j.plan.lock_note) toast(j.plan.lock_note); }
      else if(!j.ok) toast(j.error);
    }
    if(my !== P.pvSeq || !P.armed) return;
    if(!j.ok){
      P.plan = null; P.pvErr = j.error;
      const waiting = /^waiting/.test(j.error || "");
      $("#tkPv").innerHTML = `<div class="note ${waiting ? "" : "down"}">${esc(j.error)}</div>`;
      renderPlan(); toolRedraw();
      if(waiting && (P.waitTries = (P.waitTries || 0) + 1) < 15) preview(1500);
      return;
    }
    P.waitTries = 0; P.pvErr = null;
    P.plan = j.plan;
    if(j.plan.ref && P.T.ref !== j.plan.ref){ P.T.ref = j.plan.ref; sendWant(); }
    if(P.T.slDist == null && setDefaults()){ P.needDefaults = false; preview(0); }
    renderTicket(); toolRedraw();
  }, delay);
}
async function place(){
  if(P.placing) return;
  P.placing = true;
  try{ const j = await papi("place", ticketBody()); if(j.ok){ setStatus(""); disarm(); } }
  finally{ P.placing = false; }
}
let tkSaveTimer = null;
function saveTicketDefaults(){
  clearTimeout(tkSaveTimer);
  tkSaveTimer = setTimeout(() => api("/api/paper/ticket", {body: {mode: P.T.mode, risk_pct: P.T.risk_pct, risk_amt: P.T.risk_amt,
    lots: P.T.lots, product: P.T.product, tp_r: P.T.tp_r, rr_lock: !!P.T.rr_lock}}), 500);
}
function rememberDist(){
  const m = {...(prefGet("sl_dist", {}) || {})}; m[distKey()] = P.T.slDist; prefSet("sl_dist", m);
}
function wireTicket(){
  $("#bBuy").onclick = () => arm(1);
  $("#bSell").onclick = () => arm(-1);
  $("#cBuy").onclick = () => arm(1);
  $("#cSell").onclick = () => arm(-1);
  $("#tkX").onclick = disarm;
  document.querySelectorAll("#tkType button").forEach(b => b.onclick = () => {
    const v = b.dataset.v;
    if(v === "market") return toMarket();
    const l = ltpOf(P.T.s); if(l == null) return toast("No price yet");
    const off = Math.max(tickOf(P.T.s) * 10, l * 0.002);
    P.T.follow = false;
    P.T.price = roundTick(v === "limit" ? l - P.T.side * off : l + P.T.side * off, tickOf(P.T.s));
    renderTicket(); toolRedraw(); preview(0);
  });
  document.querySelectorAll("#tkMode button").forEach(b => b.onclick = () => { P.T.mode = b.dataset.v; renderTicket(); preview(); saveTicketDefaults(); });
  document.querySelectorAll("#tkBasis button").forEach(b => b.onclick = () => {
    P.T.basis = b.dataset.v; P.T.slDist = null; P.plan = null;
    P.T.tpMode = P.T.basis === "underlying" ? "dist" : "r";
    if(!setDefaults()) P.needDefaults = true;
    renderTicket(); drawLines(); preview(0);
  });
  const on = (id, fn) => { $(id).addEventListener("change", fn); $(id).addEventListener("keydown", e => { if(e.key === "Enter") fn(); }); };
  on("#tkPrice", () => { const v = num($("#tkPrice").value); if(v){ P.T.follow = false; P.T.price = roundTick(v, tickOf(P.T.s)); } else toMarket(); toolRedraw(); preview(); });
  on("#tkSl", () => { const v = num($("#tkSl").value), b = basisNow(); if(v == null || b == null) return;
    if(udir() * (b - v) <= 0) return toast("The stop must be on the losing side of the entry");
    P.T.slDist = roundTick(Math.abs(b - v), tickOf(basisSym())); rememberDist(); toolRedraw(); preview(); });
  on("#tkTp", () => { const v = num($("#tkTp").value), b = basisNow();
    if(v == null){ P.T.tpMode = "r"; P.T.lockTp = null; }
    else if(lockOn()){ lockTo(roundTick(v, tickOf(basisSym()))); toolRedraw(); return preview(0); }   // RR locked: the stop follows
    else if(b != null){ P.T.tpMode = "dist"; P.T.tpDist = Math.abs(v - b); }
    toolRedraw(); preview(); });
  on("#tkTpR", () => { const v = num($("#tkTpR").value); if(v){ P.T.tp_r = v; P.T.tpMode = "r"; P.T.lockTp = null; saveTicketDefaults(); renderLock(); preview(); } });
  // the RR box and padlock under the chart's BUY / SELL (LiveTrader 1.24), and the ticket's padlock
  const rr = $("#cRR");
  if(rr){ rr.addEventListener("keydown", e => { e.stopPropagation(); if(e.key === "Enter"){ setRR(rr.value); rr.blur(); } if(e.key === "Escape"){ rr.blur(); renderLock(); } });
    rr.addEventListener("change", () => setRR(rr.value, true)); rr.addEventListener("focus", () => rr.select()); }
  for(const id of ["#cLock", "#tkLock"]){ const b = $(id); if(b) b.onclick = e => { e.stopPropagation(); rrLockToggle(); }; }
  renderLock();
  on("#tkSize", () => { const v = num($("#tkSize").value); if(v == null) return;
    if(P.T.mode === "pct") P.T.risk_pct = v; else if(P.T.mode === "amt") P.T.risk_amt = v; else P.T.lots = lotsIn(v);
    preview(); saveTicketDefaults(); });
  $("#tkProd").onchange = () => { P.T.product = $("#tkProd").value; preview(); saveTicketDefaults(); };
  $("#bPlace").onclick = place;
  // while the tool is on and the entry follows the market, keep the money figures current
  setInterval(() => { if(P.armed && document.visibilityState === "visible" && !P.dragging) preview(0); }, P.T.follow ? 1500 : 3000);
}

/* ---------------------------------------------------------------- trail row */
function renderTrail(){
  const t = P.snap.trail;
  $("#trBe").classList.toggle("on", t.be_on); $("#trSl").classList.toggle("on", t.sl_on);
  $("#trBe").textContent = t.be_on ? "ON" : "off"; $("#trSl").textContent = t.sl_on ? "ON" : "off";
  if(document.activeElement !== $("#trBeR")) $("#trBeR").value = t.be_r;
  if(document.activeElement !== $("#trSlR")) $("#trSlR").value = t.sl_r;
}
function wireTrail(){
  $("#trBe").onclick = () => papi("trail", {be_on: !P.snap.trail.be_on, be_r: num($("#trBeR").value) || 1});
  $("#trSl").onclick = () => papi("trail", {sl_on: !P.snap.trail.sl_on, sl_r: num($("#trSlR").value) || 1});
  $("#trBeR").onchange = () => papi("trail", {be_r: num($("#trBeR").value) || 1});
  $("#trSlR").onchange = () => papi("trail", {sl_r: num($("#trSlR").value) || 1});
  $("#bBeAll").onclick = () => papi("be_all");
  $("#bCloseAll").onclick = () => { if(P.closeAllArmed){ P.closeAllArmed = false; $("#bCloseAll").textContent = "Close all"; papi("close_all"); }
    else { P.closeAllArmed = true; $("#bCloseAll").textContent = "Sure? Close all"; setTimeout(() => { P.closeAllArmed = false; $("#bCloseAll").textContent = "Close all"; }, 3000); } };
}

/* ---------------------------------------------------------------- positions & orders */
function renderPositions(){
  const ps = P.snap.positions, box = $("#posList");
  $("#tabPos").textContent = `Positions${ps.length ? " (" + ps.length + ")" : ""}`;
  const key = ps.map(p => [p.id, p.sl, p.tp, p.floor, p.qty, p.trail, p.be_done].join("|")).join(";");
  if(key !== P.posKey || !box.childElementCount){
    P.posKey = key;
    if(!ps.length){ box.innerHTML = `<div class="empty">No open positions.</div>`; return; }
    box.innerHTML = ps.map(p => {
      const bt = p.basis === "underlying" ? ` <span class="tag">stops on ${esc(short(p.ref))}</span>` : "";
      return `<div class="pos" data-id="${p.id}">
        <div class="ph"><span class="side ${p.side > 0 ? "up" : "down"}">${p.side > 0 ? "LONG" : "SHORT"}</span>
          <a href="#" class="psym mono">${esc(short(p.s))}</a><span class="muted">${p.lots} lot @ ${fmt(p.avg, p.tick)}</span>${bt}
          <span class="sp"></span><button class="x" data-a="close" title="Close at market">✕</button></div>
        <div class="pn"><b class="net" data-f="net"></b><span class="muted" data-f="sub"></span></div>
        <div class="pl">
          <span>SL <button class="ed" data-a="sl">${p.sl ?? "add"}</button> <i data-f="atsl"></i>${p.trail ? ' <span class="tag">TRAIL</span>' : ""}</span>
          <span>TP <button class="ed" data-a="tp">${p.tp ?? "add"}</button> <i data-f="attp"></i></span>
          ${p.floor != null ? `<span>Floor ${p.floor} <span class="tag">BE</span></span>` : ""}
          <span class="muted" data-f="be"></span>
          <button class="sm" data-a="be">BE</button>
        </div></div>`;
    }).join("");
    box.querySelectorAll(".pos").forEach(el => {
      const id = el.dataset.id;
      el.querySelector(".psym").onclick = e => { e.preventDefault(); const p = P.snap.positions.find(x => x.id === id); const r = p && sym[p.basis === "underlying" ? p.ref : p.s]; if(r) openSymbol(r); else if(p) openBySymbol(p.s); };
      el.querySelector('[data-a="close"]').onclick = () => papi("close", {id});
      el.querySelector('[data-a="be"]').onclick = () => papi("be", {id});
      el.querySelectorAll(".ed").forEach(b => b.onclick = () => inlineEdit(b, id, b.dataset.a));
    });
  }
  for(const p of ps){
    const el = box.querySelector(`.pos[data-id="${p.id}"]`); if(!el) continue;
    const net = el.querySelector('[data-f="net"]');
    net.textContent = rs(p.net); net.className = "net " + cls(p.net);
    el.querySelector('[data-f="sub"]').textContent = ` LTP ${fmt(p.ltp, p.tick)}` + (p.ref_ltp ? ` · fut ${fmt(p.ref_ltp)}` : "")
      + (p.r_now != null ? ` · ${p.r_now > 0 ? "+" : ""}${p.r_now}R` : "") + ` · charges so far ${rs(p.paid)}` + (p.stale ? " · no live price" : "");
    el.querySelector('[data-f="atsl"]').textContent = p.at_sl != null ? (p.est ? "≈" : "") + rsS(p.at_sl) : "";
    el.querySelector('[data-f="atsl"]').className = cls(p.at_sl);
    el.querySelector('[data-f="attp"]').textContent = p.at_tp != null ? (p.est ? "≈" : "") + rsS(p.at_tp) : "";
    el.querySelector('[data-f="attp"]').className = cls(p.at_tp);
    el.querySelector('[data-f="be"]').textContent = `BE+costs ${fmt(p.be, p.tick)}`;
  }
}
function inlineEdit(btn, id, what){
  const inp = document.createElement("input");
  inp.className = "edin mono"; inp.value = btn.textContent === "add" ? "" : btn.textContent; inp.placeholder = "price, empty = remove";
  btn.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = async save => {
    if(done) return; done = true;
    if(save){ const v = inp.value.trim(); const body = {id}; body[what] = v === "" ? null : num(v); await papi("modify", body); }
    P.posKey = P.ordKey = ""; renderPositions(); renderOrders();
  };
  inp.onkeydown = e => { if(e.key === "Enter") finish(true); if(e.key === "Escape") finish(false); };
  inp.onblur = () => finish(false);
}
function renderOrders(){
  const os = P.snap.orders, box = $("#ordList");
  $("#tabOrd").textContent = `Orders${os.length ? " (" + os.length + ")" : ""}`;
  const key = os.map(o => [o.id, o.price, o.sl, o.tp].join("|")).join(";");
  if(key === P.ordKey && box.childElementCount) return;
  P.ordKey = key;
  if(!os.length){ box.innerHTML = `<div class="empty">No pending orders.</div>`; return; }
  box.innerHTML = os.map(o => `<div class="pos" data-id="${o.id}">
    <div class="ph"><span class="side ${o.side > 0 ? "up" : "down"}">${o.side > 0 ? "BUY" : "SELL"} ${o.type.toUpperCase()}</span>
      <span class="mono">${esc(short(o.s))}</span><span class="muted">${o.lots} lot @ <button class="ed" data-a="price">${o.price}</button></span>
      <span class="sp"></span><button class="x" data-a="cancel" title="Cancel">✕</button></div>
    <div class="pl"><span>SL <button class="ed" data-a="sl">${o.sl ?? "add"}</button> <i class="down">${o.at_sl != null ? rsS(o.at_sl) : ""}</i></span>
      <span>TP <button class="ed" data-a="tp">${o.tp ?? "add"}</button> <i class="up">${o.at_tp != null ? rsS(o.at_tp) : ""}</i></span>
      <span class="muted">${esc(o.product)}</span></div></div>`).join("");
  box.querySelectorAll(".pos").forEach(el => {
    const id = el.dataset.id;
    el.querySelector('[data-a="cancel"]').onclick = () => papi("cancel", {id});
    el.querySelectorAll(".ed").forEach(b => b.onclick = () => inlineEdit(b, id, b.dataset.a));
  });
}
function renderEvents(){
  const box = $("#evList");
  box.innerHTML = (P.snap.events || []).slice().reverse().map(e =>
    `<div class="${e.lvl === "warn" ? "warnc" : ""}"><span class="muted mono">${new Date(e.t * 1000).toLocaleTimeString("en-GB", {timeZone: "Asia/Kolkata"})}</span> ${esc(e.msg)}</div>`).join("")
    || `<div class="empty">Nothing yet.</div>`;
}
async function loadTrades(){
  const j = await api("/api/paper/history?days=0"); const box = $("#histList");
  if(!j.ok){ box.innerHTML = `<div class="empty">${esc(j.error)}</div>`; return; }
  if(!j.rows.length){ box.innerHTML = `<div class="empty">No closed trades yet.</div>`; return; }
  box.innerHTML = `<div class="hh"><a href="/api/paper/history.csv">Download CSV</a></div>` + j.rows.map((h, i) => {
    const t = new Date(h.closed * 1000).toLocaleString("en-GB", {timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"});
    return `<div class="hrow" data-i="${i}"><div class="ph"><span class="side ${h.side > 0 ? "up" : "down"}">${h.side > 0 ? "L" : "S"}</span>
      <span class="mono">${esc(short(h.s))}</span><span class="muted">${h.lots} lot · ${h.avg} → ${h.exit}</span><span class="sp"></span>
      <b class="${cls(h.net)}">${rs(h.net)}</b></div>
      <div class="pl muted"><span>${t}</span><span>${esc(h.product)}</span><span class="tag">${esc(h.reason)}</span>${h.r != null ? `<span>${h.r > 0 ? "+" : ""}${h.r}R</span>` : ""}
      <span>gross ${rs(h.gross)}</span><span>charges ${rs(h.charges.total)}</span></div>
      <div class="breakdown hide"></div></div>`;
  }).join("");
  box.querySelectorAll(".hrow").forEach(el => el.onclick = () => {
    const h = j.rows[+el.dataset.i], bd = el.querySelector(".breakdown");
    if(bd.classList.toggle("hide")) return;
    bd.innerHTML = breakdown(h.charges, "All charges, entry + exit") +
      `<div><span>Gross P&L</span><span>${rs(h.gross)}</span></div><div class="tot"><span>Net P&L</span><span>${rs(h.net)}</span></div>` +
      `<div><span>First SL / risk</span><span>${h.first_sl ?? "–"} / ${rs(h.init_risk)}</span></div>` +
      `<div><span>Best / worst price</span><span>${fmt(h.best)} / ${fmt(h.worst)}</span></div>` +
      (h.entries.length > 1 ? `<div><span>Entries</span><span>${h.entries.map(e => e.qty + "@" + e.price).join(", ")}</span></div>` : "");
  });
}
function wireTabs(){
  document.querySelectorAll("#ptabs button").forEach(b => b.onclick = () => {
    P.tab = b.dataset.t;
    document.querySelectorAll("#ptabs button").forEach(x => x.classList.toggle("on", x === b));
    for(const t of ["pos", "ord", "hist", "book", "ev"]) $("#p_" + t).classList.toggle("hide", t !== P.tab);
    if(P.tab === "hist") loadTrades();
    if(P.tab === "book"){ P.book = null; renderBook(null); }
    $("#ptabs").scrollIntoView({block: "start", behavior: "smooth"});   // bring the tab's content into view
    sendWant();                               // the order book streams only while this tab is open
  });
}
async function openBySymbol(s){ const j = await api("/api/symbol?s=" + encodeURIComponent(s)); if(j.ok) openSymbol(j.row); }

/* ---------------------------------------------------------------- chart: lines, zones, the tool's PLACE box, drags */
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function clearLines(arr){ for(const l of arr){ try{ series.removePriceLine(l); }catch(e){} } arr.length = 0; }
function mkLine(arr, price, color, title, style, width){
  const l = series.createPriceLine({price, color, lineWidth: width || 1, lineStyle: style ?? 0, axisLabelVisible: true, title});
  arr.push(l); return l;
}
/* shaded risk / reward zones, drawn under the candles (a Lightweight Charts series primitive) */
class ZonePrim {
  constructor(){ this.req = null; const self = this;
    this.views = [{zOrder: () => "bottom", renderer: () => ({draw: t => self.draw(t)})},
                  {zOrder: () => "top", renderer: () => ({draw: t => self.drawTop(t)})}]; }
  attached(p){ this.req = p.requestUpdate; }
  detached(){ this.req = null; }
  updateAllViews(){}
  paneViews(){ return this.views; }
  update(){ if(this.req) this.req(); }
  draw(target){ target.useMediaCoordinateSpace(({context, mediaSize}) => drawZones(context, mediaSize)); }
  drawTop(target){ target.useMediaCoordinateSpace(({context, mediaSize}) => drawMarks(context, mediaSize)); }
}
function zoneX(time, w){
  if(time == null) return null;
  const x = chart.timeScale().timeToCoordinate(time);
  return x == null ? null : x;
}
function rgba(hex, a){
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || ""); if(!m) return `rgba(128,128,128,${a})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}
function zoneList(){
  const out = [];
  if(!cur) return out;
  if(P.armed){
    const bs = basisSym();
    if(bs === cur.s){
      const e = basisNow(), sl = slNow(), tp = tpNow(), p = P.plan;
      if(e != null) out.push({tool: true, entry: e, sl, tp, x0: dispLast() ? dispLast().time : null,
        slTxt: p && (p.risk != null || p.risk_1lot != null) ? `${p.risk_estimated ? "≈" : ""}${rsS(-(p.risk ?? p.risk_1lot))}${p.risk == null ? " (1 lot)" : ""}` : "",
        tpTxt: p && p.reward != null ? `${p.risk_estimated ? "≈" : ""}${rsS(p.reward)}${p.rr != null ? " · " + p.rr + "R" : ""}` : ""});
    }
  }
  if(P.snap) for(const p of P.snap.positions){
    const bs = p.basis === "underlying" ? p.ref : p.s;
    if(bs !== cur.s) continue;
    const e = p.basis === "underlying" ? p.basis_entry : p.avg;
    out.push({entry: e, sl: p.sl, tp: p.tp, x0: curPlan ? dispTimeAt(bucket(p.opened + IST, curPlan)) : null,
      slTxt: p.at_sl != null ? (p.est ? "≈" : "") + rsS(p.at_sl) : "", tpTxt: p.at_tp != null ? (p.est ? "≈" : "") + rsS(p.at_tp) : ""});
  }
  return out;
}
function drawZones(ctx, size){
  const C = chartCfg(), UP = C.profitZ, DOWN = C.lossZ, A = (+C.zoneA || 20) / 100;
  P.toolX = null;
  for(const z of zoneList()){
    const ye = series.priceToCoordinate(z.entry); if(ye == null) continue;
    let x0 = zoneX(z.x0, size.width);
    if(z.tool){                    // LiveTrader 1.24: a gap (Chart settings, 30 px) after the live candle's right edge
      let half = 3; try{ half = (chart.timeScale().options().barSpacing || 6) / 2; }catch(e){}
      x0 = x0 == null ? size.width * 0.55 : x0 + half + Math.max(0, +C.toolGap || 0);
      x0 = Math.min(x0, size.width - 170); P.toolX = x0; }
    else if(x0 == null) x0 = 0;
    const x1 = size.width, w = Math.max(0, x1 - x0), a = z.tool ? A : A * 0.45;
    const box = (y2, col) => { if(y2 == null) return; ctx.fillStyle = rgba(col, a); ctx.fillRect(x0, Math.min(ye, y2), w, Math.abs(y2 - ye)); };
    const ys = z.sl != null ? series.priceToCoordinate(z.sl) : null, yt = z.tp != null ? series.priceToCoordinate(z.tp) : null;
    box(ys, DOWN); box(yt, UP);
    ctx.font = "600 11px 'IBM Plex Sans', system-ui, sans-serif"; ctx.textBaseline = "middle";
    const label = (y2, txt, col) => { if(y2 == null || !txt) return; const y = y2 + (y2 > ye ? -10 : 10);
      ctx.fillStyle = col; ctx.fillText(txt, x0 + 8, Math.abs(y2 - ye) < 22 ? y2 : y); };
    label(ys, z.slTxt, C.slC); label(yt, z.tpTxt, C.tpC);
  }
}
/* one-click ✕ on each open position's entry line (this chart), like the MT5 EA */
function drawMarks(ctx, size){
  P.hits = [];
  return;                                   // position / order controls are HTML bars now (posBars)
  if(!P.snap || !cur) return;
  for(const p of P.snap.positions){
    if(p.s !== cur.s) continue;
    const y = series.priceToCoordinate(p.avg); if(y == null) continue;
    const x = size.width - 22;
    ctx.fillStyle = cssv("--down"); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - 8, y - 8, 16, 16, 3) : ctx.rect(x - 8, y - 8, 16, 16); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.6; ctx.beginPath();
    ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke();
    P.hits.push({x, y, r: 10, act: () => papi("close", {id: p.id})});
  }
  for(const o of (P.snap.orders || [])){
    if(o.s !== cur.s) continue;
    const y = series.priceToCoordinate(o.price); if(y == null) continue;
    const x = size.width - 22;
    ctx.fillStyle = cssv("--muted"); ctx.beginPath(); ctx.rect(x - 8, y - 8, 16, 16); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.6; ctx.beginPath();
    ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke();
    P.hits.push({x, y, r: 10, act: () => papi("cancel", {id: o.id})});
  }
}
function ensurePrim(){
  if(!series || P.primSeries === series) return;
  P.prim = new ZonePrim(); series.attachPrimitive(P.prim); P.primSeries = series;
  P.posLines = []; P.toolLines = null;
  chart.subscribeClick(param => {
    if(!param.point || Date.now() - (P.dragEnd || 0) < 300) return;
    const h = (P.hits || []).find(h => Math.abs(param.point.x - h.x) <= h.r && Math.abs(param.point.y - h.y) <= h.r);
    if(h) h.act();
  });
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => { toolOverlay(); posBars(); });
  // keep the tool's and positions' SL / TP inside the visible price range, so they can always be grabbed
  series.applyOptions({autoscaleInfoProvider: orig => {
    const r = orig(); if(!r || !r.priceRange) return r;
    const ps = [];
    for(const z of zoneList()) for(const v of [z.entry, z.sl, z.tp]) if(v != null && isFinite(v)) ps.push(v);
    if(P.snap) for(const o of P.snap.orders) if(o.s === cur.s && o.price) ps.push(o.price);
    if(ps.length){ r.priceRange.minValue = Math.min(r.priceRange.minValue, ...ps); r.priceRange.maxValue = Math.max(r.priceRange.maxValue, ...ps); }
    return r;
  }});
}

/* lines for open positions and pending orders (rebuilt when the snapshot changes) */
function drawLines(){
  if(!series || !cur || P.dragging) return;
  ensurePrim();
  clearLines(P.posLines);
  P.posDrags = [];
  const C = chartCfg(), ENTRY = cfgColor("entryC");
  const tk = s => (sym[s] || {}).tick || cur.tick;
  const drag = (line, price, tick, drop) => P.posDrags.push({line, price: () => price, tick, drop, set: v => { price = v; }});
  if(P.snap){
    for(const p of P.snap.positions){
      const bs = p.basis === "underlying" ? p.ref : p.s, e = p.est ? "≈" : "";
      if(p.s === cur.s) mkLine(P.posLines, p.avg, ENTRY, "Entry", +C.entryS);
      else if(p.basis === "underlying" && p.ref === cur.s && p.basis_entry != null) mkLine(P.posLines, p.basis_entry, ENTRY, "", +C.entryS);
      if(p.s === cur.s && p.floor != null) mkLine(P.posLines, p.floor, C.beC, `BE floor · exit here nets ₹0 · ${p.be_ticks || 0} ticks ${p.side > 0 ? "above" : "below"} entry pay the ${rs(p.be_covers)} charges`, +C.beS);
      if(bs !== cur.s) continue;
      const slTitle = p.at_be && p.basis === "self" ? `${p.trail ? "TRAIL" : "BE"} · exit here nets ${rsS(p.at_sl)} · ${p.be_ticks} ticks ${p.side > 0 ? "above" : "below"} entry pay the ${rs(p.be_covers)} charges`
        : `SL ${e}${rsS(p.at_sl)}${p.trail ? " trail" : ""}`;
      const atBe = p.at_be && p.basis === "self";
      if(p.sl != null) drag(mkLine(P.posLines, p.sl, atBe ? C.beC : C.slC, slTitle, atBe ? +C.beS : +C.slS, 2), p.sl, tk(bs), v => papi("modify", {id: p.id, sl: v}));
      if(p.tp != null) drag(mkLine(P.posLines, p.tp, C.tpC, `TP ${e}${rsS(p.at_tp)}`, +C.tpS, 2), p.tp, tk(bs), v => papi("modify", {id: p.id, tp: v}));
    }
    for(const o of P.snap.orders){
      if(o.s === cur.s) drag(mkLine(P.posLines, o.price, C.orderC, "", +C.orderS, 2), o.price, tk(o.s), v => papi("modify", {id: o.id, price: v}));
      const bs = o.basis === "underlying" ? o.ref : o.s;
      if(bs !== cur.s) continue;
      if(o.sl != null) drag(mkLine(P.posLines, o.sl, C.slC, `SL ${rsS(o.at_sl)}`, +C.orderS), o.sl, tk(bs), v => papi("modify", {id: o.id, sl: v}));
      if(o.tp != null) drag(mkLine(P.posLines, o.tp, C.tpC, `TP ${o.at_tp != null ? rsS(o.at_tp) : ""}`, +C.orderS), o.tp, tk(bs), v => papi("modify", {id: o.id, tp: v}));
    }
  }
  toolRedraw(true);
}
/* the tool's own lines: kept and moved on every price change instead of being rebuilt */
function toolRedraw(rebuild){
  if(!series || !cur) return;
  ensurePrim();
  const T = P.T, show = P.armed;
  if(rebuild || !show){ if(P.toolLines){ clearLines(P.toolLines.all); } P.toolLines = null; }
  P.toolDrags = [];
  if(show){
    const C = chartCfg();
    if(!P.toolLines){
      const all = [];
      P.toolLines = {all,
        entry: mkLine(all, 0, C.toolC, "", +C.toolS, 2), sl: mkLine(all, 0, C.slC, "", +C.slS, 2), tp: mkLine(all, 0, C.tpC, "", +C.tpS, 2),
        be: mkLine(all, 0, C.beC, "BE+costs", +C.beS, 1)};
    }
    const L = P.toolLines, bs = basisSym(), pl = P.plan;
    const set = (line, price, title) => line.applyOptions(price == null ? {price: 0, lineVisible: false, axisLabelVisible: false, title: ""}
      : {price, lineVisible: true, axisLabelVisible: true, title});
    const onOwn = T.s === cur.s, onBasis = bs === cur.s;
    const typ = orderType();
    const ent = onOwn ? entryNow() : (onBasis ? basisNow() : null);
    set(L.entry, ent, onOwn ? `${T.side > 0 ? "BUY" : "SELL"} ${typ}` : "future now");
    const sl = onBasis ? slNow() : null, tp = onBasis ? tpNow() : null;
    set(L.sl, sl, `SL`); set(L.tp, tp, `TP`);
    set(L.be, onOwn && pl && pl.be != null ? pl.be : null, "BE+costs");
    if(onOwn) P.toolDrags.push({line: L.entry, price: () => entryNow(), tick: tickOf(T.s), move: v => { T.follow = false; T.price = v; }, drop: () => { renderTicket(); preview(0); }});
    if(onBasis && sl != null) P.toolDrags.push({line: L.sl, price: () => slNow(), tick: tickOf(bs),
      move: v => { const b = basisNow(); if(udir() * (b - v) > 0) T.slDist = Math.max(tickOf(bs), roundTick(Math.abs(b - v), tickOf(bs))); }, drop: () => { rememberDist(); renderTicket(); preview(0); }});
    if(onBasis && tp != null) P.toolDrags.push({line: L.tp, price: () => tpNow(), tick: tickOf(bs),
      move: v => { const b = basisNow(); if(udir() * (v - b) <= 0) return;
        if(lockOn()) lockTo(v);                                       // RR locked: the stop follows the target
        else { T.tpMode = "dist"; T.tpDist = roundTick(Math.abs(v - b), tickOf(bs)); } },
      drop: () => { renderTicket(); preview(0); }});
  }
  P.drags = [...(P.posDrags || []), ...P.toolDrags, ...(P.alertDrags || [])];   // (alerts: calerts.js)
  if(P.prim) P.prim.update();
  toolOverlay(); posBars();
}
/* a control bar on each position's entry line (right side, clear of the price scale):
   side · lots · net P&L, ✕ close, BE, BE-trail [R], trail [R]. Pending orders get a bar with ✕ cancel. */
function posBars(){
  const host = $("#posbars");
  if(!host) return;
  if(!series || !cur || !P.snap){ host.innerHTML = ""; P.barKey = ""; return; }
  const items = [];
  for(const p of P.snap.positions){
    const y0 = p.s === cur.s ? p.avg : (p.basis === "underlying" && p.ref === cur.s ? p.basis_entry : null);
    if(y0 != null) items.push({kind: "pos", id: p.id, price: y0, p});
  }
  for(const o of P.snap.orders) if(o.s === cur.s) items.push({kind: "ord", id: o.id, price: o.price, o});
  const key = items.map(i => i.kind === "pos" ? [i.id, i.p.tr.be_on, i.p.tr.be_r, i.p.tr.sl_on, i.p.tr.sl_r, i.p.tr.own_be, i.p.tr.own_sl, i.p.lots, i.p.be_done, i.p.at_be].join("|") : i.id).join(";");
  const focused = host.contains(document.activeElement) && document.activeElement.tagName === "INPUT";
  if(key !== P.barKey && !focused){
    P.barKey = key;
    host.innerHTML = items.map(i => {
      if(i.kind === "ord") return `<div class="pbar" data-id="${i.id}"><span class="pt" data-f="t"></span><button class="bx" data-a="cancel" title="Cancel order">✕</button></div>`;
      const t = i.p.tr, ts = trailTips(i.p);
      return `<div class="pbar" data-id="${i.id}"><span class="pt" data-f="t"></span>
        <button class="bx" data-a="close" title="Close at market">✕</button>
        <button data-a="be" title="Stop to break-even + costs now">BE</button>
        <button class="tg ${t.be_on ? "on" : ""} ${ts.beDone ? "done" : ""}" data-a="be_on" title="${esc(ts.be)}">BE-T</button><input class="rr" data-a="be_r" value="${t.be_r}" inputmode="decimal" title="${esc(ts.beR)}">
        <button class="tg ${t.sl_on ? "on" : ""}" data-a="sl_on" title="${esc(ts.sl)}">TRAIL</button><input class="rr" data-a="sl_r" value="${t.sl_r}" inputmode="decimal" title="${esc(ts.slR)}">
        <span class="ta muted" data-f="ta"></span>
      </div>`;
    }).join("");
    host.querySelectorAll(".pbar").forEach(el => {
      const id = el.dataset.id;
      const pos = () => P.snap.positions.find(x => x.id === id);
      el.querySelectorAll("button").forEach(b => b.onclick = e => { e.stopPropagation();
        const a = b.dataset.a;
        if(a === "close") return papi("close", {id});
        if(a === "cancel") return papi("cancel", {id});
        if(a === "be") return papi("be", {id});
        const p = pos(); if(!p) return;
        if(a === "be_on") return papi("pos_trail", {id, be_on: !p.tr.be_on, be_r: num(el.querySelector('[data-a="be_r"]').value) || p.tr.be_r});
        if(a === "sl_on") return papi("pos_trail", {id, sl_on: !p.tr.sl_on, sl_r: num(el.querySelector('[data-a="sl_r"]').value) || p.tr.sl_r});
      });
      el.querySelectorAll("input.rr").forEach(inp => {
        const save = () => { const v = num(inp.value); if(v && v > 0){ const b = {id}; b[inp.dataset.a] = v; papi("pos_trail", b); } };
        inp.onkeydown = e => { e.stopPropagation(); if(e.key === "Enter"){ save(); inp.blur(); } };
        inp.onchange = save;
      });
      for(const ev of ["mousedown", "touchstart"]) el.addEventListener(ev, e => e.stopPropagation());
    });
  }
  // place each bar on its line, just left of the price scale, and refresh its text
  const axis = (() => { try{ return chart.priceScale("right").width(); }catch(e){ return 60; } })();
  for(const i of items){
    const el = host.querySelector(`.pbar[data-id="${i.id}"]`); if(!el) continue;
    const y = series.priceToCoordinate(i.price);
    if(y == null){ el.style.display = "none"; continue; }
    // the stop / target labels are drawn at the same spot, just left of the price scale: when one of those
    // lines is close to the entry (a BE stop a few ticks away), slide the bar off it so its label stays readable
    const src = i.kind === "pos" ? i.p : i.o, own = src && (src.basis !== "underlying" || src.ref === cur.s);
    const near = (own ? [src.sl, src.tp, src.floor] : []).filter(v => v != null).map(v => series.priceToCoordinate(v)).filter(v => v != null && Math.abs(v - y) < 24);
    let top = y;
    if(near.length){ const n = near.sort((a, b) => Math.abs(a - y) - Math.abs(b - y))[0]; top = n >= y ? n - 24 : n + 24; }
    el.style.display = ""; el.style.top = top + "px"; el.style.right = (axis + 6) + "px";
    const t = el.querySelector('[data-f="t"]');
    if(i.kind === "pos"){
      const p = i.p;
      t.innerHTML = `<b class="${p.side > 0 ? "up" : "down"}">${p.side > 0 ? "LONG" : "SHORT"} ${p.lots}</b> <span class="muted">@ ${fmt(p.avg, (sym[p.s] || {}).tick || cur.tick)}</span> <span class="${cls(p.net)}">${rsS(p.net)}</span>`
        + (p.r_now != null ? ` <span class="muted">${p.r_now > 0 ? "+" : ""}${p.r_now}R</span>` : "");
      const ta = el.querySelector('[data-f="ta"]');
      if(ta){
        const tick = (sym[p.basis === "underlying" ? p.ref : p.s] || {}).tick;
        ta.textContent = p.tr.sl_on && p.trail_at != null ? (p.trail ? "next " : "moves past ") + fmt(p.trail_at, tick) : "";
        ta.title = p.trail_at != null ? `Trail SL keeps the stop ${p.tr.sl_r}R (${fmt(p.tr.sl_r * p.r_pts, tick)} points) behind the best price. 1R = first entry to first stop = ${fmt(p.r_pts, tick)} points. The stop moves once price passes ${fmt(p.trail_at, tick)}.` : "";
      }
    } else {
      const o = i.o;
      t.innerHTML = `<b class="${o.side > 0 ? "up" : "down"}">${o.side > 0 ? "BUY" : "SELL"} ${o.type.toUpperCase()} ${o.lots}</b>`;
    }
  }
}
/* a trade's own trailing, worded as in LiveTrader 1.24 (also used by the Trades page and the phone) */
function trailTips(p){
  const t = p.tr || {}, beDone = !!t.be_on && !!(p.be_done || p.at_be);
  const own = " - set on this trade (changing the panel's Trail BE / Trail SL sets every trade again)", pan = " - as the panel";
  return {beDone,
    be: `Trail BE: ${t.be_on ? (beDone ? "done - the stop is at break-even + costs" : `ON, the stop to break-even + costs once the trade is ${t.be_r}R in profit`) : "OFF"}${t.own_be ? own : pan}. Click to switch`,
    sl: `Trail SL: ${t.sl_on ? `ON, ${t.sl_r}R behind the best price once ${t.sl_r}R in profit` : "OFF"}${t.own_sl ? own : pan}. Click to switch`,
    beR: "Trail BE trigger for this trade, in R: type and press Enter (switches it on)",
    slR: "Trail SL distance for this trade, in R: type and press Enter (switches it on)"};
}
/* the PLACE box that sits on the tool's entry line */
function toolOverlay(){
  const el = $("#tool");
  if(!P.armed || !series || !cur || (P.T.s !== cur.s && basisSym() !== cur.s)){ el.classList.add("hide"); return; }
  const onOwn = P.T.s === cur.s;
  const price = onOwn ? entryNow() : basisNow();
  const y = price != null ? series.priceToCoordinate(price) : null;
  if(y == null){ el.classList.add("hide"); return; }
  const p = P.plan, typ = orderType(), T = P.T;
  const head = `<b>${T.side > 0 ? "BUY" : "SELL"} ${typ.toUpperCase()}</b>`;
  let body;
  if(!p) body = `<span class="tl${P.pvErr ? " blocked" : ""}" title="${esc(P.pvErr || "")}">${head} · ${esc(P.pvErr || "working out…")}</span>`;
  else {
    const e = p.risk_estimated ? "≈" : "";
    const money = p.risk != null ? ` · <span class="down">${e}${rsS(-p.risk)}</span>` + (p.reward != null ? ` / <span class="up">${e}${rsS(p.reward)}</span>` : "") + (p.rr != null ? ` · ${p.rr}R` : "") : "";
    body = `<span class="tl${p.blocked ? " blocked" : ""}" title="${esc(p.blocked || (p.notes || []).join(" · "))}">${head} · ${p.lots} lot${p.lots === 1 ? "" : "s"}${money}${p.blocked ? " · " + esc(p.blocked) : ""}</span>`;
  }
  const canPlace = p && !p.blocked && p.lots > 0 && (onOwn || T.basis === "underlying");
  const r0 = sym[T.s] || {}, stock = r0.f === "EQ" || r0.f === "OTHER";
  const prodLbl = T.product === "INTRADAY" ? "INTRADAY" : stock ? "CNC" : "NRML";
  const sig = [body, canPlace, T.follow, T.side, prodLbl].join("|");
  if(el.dataset.sig !== sig){
    el.dataset.sig = sig;
    el.innerHTML = body + `<button class="tx tprod${T.product === "INTRADAY" ? "" : " carry"}" id="tProd" title="${T.product === "INTRADAY" ? "Intraday: closed before Fyers' square-off. Click for " + (stock ? "Delivery (CNC)" : "Carry (NRML)") : (stock ? "Delivery (CNC)" : "Carry (NRML)") + ": kept overnight. Click for Intraday"}. Stays the default for later trades.">${prodLbl}</button>`
      + `<button class="tp ${T.side > 0 ? "buy" : "sell"}" id="tPlace" ${canPlace ? "" : "disabled"}>PLACE</button>`
      + (T.follow ? "" : `<button class="tx" id="tMkt" title="Back to a market order">MKT</button>`)
      + `<button class="tx" id="tX" title="Close the tool">✕</button>`;
    $("#tPlace").onclick = place; $("#tX").onclick = disarm;
    $("#tProd").onclick = () => { P.T.product = P.T.product === "INTRADAY" ? (stock ? "CNC" : "MARGIN") : "INTRADAY";
      $("#tkProd").value = P.T.product === "INTRADAY" ? "INTRADAY" : $("#tkProd").options[1].value; preview(); saveTicketDefaults(); }; const m = $("#tMkt"); if(m) m.onclick = toMarket;
  }
  el.classList.remove("hide");
  const x = P.toolX != null ? P.toolX : 60;
  el.style.left = Math.max(4, Math.min(x, $("#chart").clientWidth - el.offsetWidth - 70)) + "px";
  el.style.top = (y - 16) + "px";
}
function onToolTick(t){
  if(!P.armed) return;
  if(t.s !== P.T.s && t.s !== P.T.ref) return;
  if(P.rafPending) return;
  P.rafPending = true;
  requestAnimationFrame(() => { P.rafPending = false; if(!P.dragging) toolRedraw(); });
}
function wireDrag(){
  const el = $("#chart");
  const yOf = e => (e.touches ? e.touches[0].clientY : e.clientY) - el.getBoundingClientRect().top;
  const near = y => {
    let best = null, bd = 9;
    for(const d of P.drags || []){ const pr = d.price(); if(pr == null) continue; const yy = series.priceToCoordinate(pr); if(yy != null && Math.abs(yy - y) < bd){ bd = Math.abs(yy - y); best = d; } }
    return best;
  };
  const down = e => {
    if(!series || e.target.closest("#tool,#ctools,#dcPill,#dcBox")) return;
    const d = near(yOf(e)); if(!d) return;
    e.preventDefault(); e.stopPropagation();
    P.dragging = d; chart.applyOptions({handleScroll: false, handleScale: false});
  };
  const move = e => {
    if(!series || e.target.closest && e.target.closest("#tool,#ctools,#dcPill,#dcBox")) return;
    const y = yOf(e);
    if(!P.dragging){ el.style.cursor = near(y) ? "ns-resize" : ""; return; }
    e.preventDefault(); e.stopPropagation();
    const v = series.coordinateToPrice(y); if(v == null) return;
    const p = roundTick(v, P.dragging.tick);
    P.dragging.line.applyOptions({price: p});
    if(P.dragging.move){ P.dragging.move(p); const d = P.dragging; P.dragging = null; toolRedraw(); P.dragging = d; }
    else P.dragging.set(p);
  };
  const up = e => {
    if(!P.dragging) return;
    const d = P.dragging; P.dragging = null; P.dragEnd = Date.now();
    chart.applyOptions({handleScroll: true, handleScale: true});
    e.stopPropagation();
    d.drop(d.price());
  };
  for(const [ev, fn] of [["mousedown", down], ["touchstart", down], ["mousemove", move], ["touchmove", move]])
    el.addEventListener(ev, fn, {capture: true, passive: false});
  window.addEventListener("mouseup", up, true); window.addEventListener("touchend", up, true);
  new ResizeObserver(() => toolOverlay()).observe(el);
}

/* ---------------------------------------------------------------- order book (Book tab) */
function panelShown(){ const el = $("#panel"); return !!el && getComputedStyle(el).display !== "none"; }
function bookSymbol(){ return P.tab === "book" && cur && panelShown() ? cur.s : null; }
function renderBook(d){
  if(d){ if(!cur || d.s !== cur.s) return; P.book = d; }
  const box = $("#bookBox"); if(!box || P.tab !== "book") return;
  d = P.book;
  if(!cur){ box.innerHTML = `<div class="empty">Open a chart to see its order book.</div>`; return; }
  if(!d){ box.innerHTML = `<div class="empty">Waiting for ${esc(short(cur.s))}'s order book…</div>`; return; }
  const tick = cur.tick, rows = [];
  const qs = [...d.bids, ...d.asks].map(r => +r[1] || 0), mx = Math.max(1, ...qs);
  const cell = (cls, v, w) => `<div class="${cls}">${w != null ? `<span class="bar" style="width:${Math.round(100 * w / mx)}%"></span>` : ""}<span style="position:relative">${v}</span></div>`;
  for(let i = 0; i < 5; i++){
    const b = d.bids[i] || [], a = d.asks[i] || [];
    rows.push(`<div class="o">${b[2] ?? ""}</div>` + cell("q bq", b[1] != null ? (+b[1]).toLocaleString("en-IN") : "", +b[1] || 0)
      + `<div class="bp" data-px="${b[0] ?? ""}">${b[0] ? fmt(b[0], tick) : ""}</div><div class="ap" data-px="${a[0] ?? ""}">${a[0] ? fmt(a[0], tick) : ""}</div>`
      + cell("q aq", a[1] != null ? (+a[1]).toLocaleString("en-IN") : "", +a[1] || 0) + `<div class="o">${a[2] ?? ""}</div>`);
  }
  const t = last[cur.s] || {}, tbq = d.tbq ?? t.tbq, tsq = d.tsq ?? t.tsq;
  const ratio = tbq != null && tsq != null && tbq + tsq > 0 ? tbq / (tbq + tsq) : null;
  box.innerHTML = `<div class="bk-h"><span class="mono">${esc(short(cur.s))}</span><span class="muted">${d.src === "poll" ? "polled" : "live"} · top 5 levels</span></div>
    <div class="bk"><div class="hd o">Ord</div><div class="hd q">Bid qty</div><div class="hd q">Bid</div><div class="hd">Ask</div><div class="hd">Ask qty</div><div class="hd o">Ord</div>${rows.join("")}</div>
    ${ratio != null ? `<div class="bk-tot"><span class="up">Buy ${(+tbq).toLocaleString("en-IN")}</span><span class="muted">${Math.round(ratio * 100)}% / ${100 - Math.round(ratio * 100)}%</span><span class="down">Sell ${(+tsq).toLocaleString("en-IN")}</span></div>
      <div class="bk-ratio"><div style="width:${ratio * 100}%"></div></div>` : ""}
    <div class="bk-stats" id="bkStats"></div>
    <p class="help">With BUY or SELL pressed, click a price to put the entry there (it becomes a limit or stop order).</p>`;
  box.querySelectorAll("[data-px]").forEach(el => el.onclick = () => {
    const v = num(el.dataset.px); if(!v) return;
    if(!P.armed){ toast("Press BUY or SELL first, then click a price"); return; }
    P.T.follow = false; P.T.price = v; renderTicket(); toolRedraw(); preview(0);
  });
  bookStats(t);
}
function bookStats(t){
  const el = $("#bkStats"); if(!el || !t || !cur || t.s !== cur.s) return;
  const tk = cur.tick, ch = t.pc ? t.ltp - t.pc : null;
  const cells = [["Open", fmt(t.o, tk)], ["High", fmt(t.h, tk)], ["Low", fmt(t.l, tk)], ["Prev close", fmt(t.pc, tk)],
    ["Avg price", fmt(t.atp, tk)], ["Volume", t.vol != null ? (+t.vol).toLocaleString("en-IN") : "–"],
    ["Last qty", t.ltq ?? "–"], ["Change", ch != null ? `<span class="${cls(ch)}">${ch > 0 ? "+" : ""}${fmt(ch, tk)} (${(100 * ch / t.pc).toFixed(2)}%)</span>` : "–"]];
  el.innerHTML = cells.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join("");
}

/* ---------------------------------------------------------------- rules (Settings) */
const RULES = [
  ["size", "Account size (₹)", "Base for the % limits. Changing it with no trades yet also sets the starting balance"],
  ["daily_pct", "Daily loss limit %", "Of size; 0 = off"],
  ["max_pct", "Max loss limit %", "Of size; 0 = off"],
  ["max_mode", "Max loss floor", "static: size − max %. trailing: follows the highest balance", ["static", "trailing"]],
  ["day_from", "Daily loss counted from", "The day's starting balance, equity or the higher", ["balance", "equity", "higher"]],
  ["reset_hour", "Trading day starts (IST hour)", ""],
  ["buffer_pct", "Buffer %", "Kept from each floor, % of size"],
  ["risk_cap_pct", "Risk cap per trade %", "Net risk at the stop, % of balance. Lots are cut to fit; 0 = off"],
  ["max_margin_pct", "Max margin use %", "Including pending orders; 0 = off"],
  ["max_open_risk_pct", "Max open risk %", "Everything open at its stop, % of balance; 0 = off"],
  ["max_trades", "Max trades a day", "Pending orders count; 0 = no limit"],
  ["sl_required", "Stop loss required", "", [true, false]],
  ["squareoff_on", "Intraday square-off", "Close Intraday positions and cancel Intraday orders before Fyers squares them off (Fyers charges ₹50 + GST per order it closes)", [true, false]],
  ["sq_before_min", "Minutes before Fyers' square-off", "SQTODAY"],
  ["fy_sq_fo", "Fyers' square-off: index and stock F&O", "IST, HH:MM (Fyers' support page, Oct 2026)"],
  ["fy_sq_eq_fo", "Fyers' square-off: stocks with F&O", "After this only Delivery (CNC) orders"],
  ["fy_sq_eq", "Fyers' square-off: other stocks", ""],
  ["fy_sq_mcx_summer", "Fyers' square-off: MCX, US summer time", "Mid-March to the first Sunday of November"],
  ["fy_sq_mcx_winter", "Fyers' square-off: MCX, US winter time", "The rest of the year. The app switches by itself"],
  ["expiry_exit", "MCX expiry-day exit (IST)", "Positions in contracts expiring today close at this time; empty = off"],
  ["expiry_exit_eq", "NSE / BSE expiry-day exit (IST)", "F&O expiring today close at this time"],
  ["squareoff_cd", "Currency intraday square-off (IST)", "Fyers doesn't offer currency intraday at present"],
  ["expiry_exit_cd", "Currency expiry-day exit (IST)", ""],
  ["stale_sec", "Stale price (seconds)", "Market orders are refused when the last price is older"],
  ["be_buffer_ticks", "BE buffer (ticks)", "Extra ticks beyond break-even + costs when a stop moves to BE (BE, BE all, Trail BE)"],
  ["live_slack_pct", "LIVE: stop-limit slack %", "The stop at Fyers is a stop-limit; its limit sits this far past the trigger (% of the stop price) so it fills if price jumps"],
  ["live_slack_ticks", "LIVE: stop-limit slack, at least (ticks)", ""],
  ["live_chase_sec", "LIVE: re-price an unfilled exit after (seconds)", "An exit still open after this is re-priced to cross the spread"],
];
function sqToday(){
  const t = (P.snap || {}).squareoff_today || {};
  const parts = Object.entries(t).map(([k, v]) => `${k} ${v}`);
  return parts.length ? "Today the app closes Intraday at: " + parts.join(" · ") : "0 = at Fyers' time";
}
function renderRules(sel = "#rulesForm"){
  if(!P.snap || !$(sel)) return;
  if(sel === "#rulesForm") P.rulesShown = true;
  const r = P.snap.rules;
  $(sel).innerHTML = RULES.filter(([k]) => !k.startsWith("live_") || P.snap.mode === "live").map(([k, label, help, opts]) => `<div class="rf"><label>${label}</label>` +
    (opts ? `<select data-k="${k}">${opts.map(o => `<option value="${o}" ${String(r[k]) === String(o) ? "selected" : ""}>${o === true ? (k === "squareoff_on" ? "on" : "required") : o === false ? (k === "squareoff_on" ? "off" : "optional") : o}</option>`).join("")}</select>`
          : `<input data-k="${k}" value="${esc(r[k])}" ${typeof r[k] === "number" ? 'inputmode="decimal"' : ""}>`) +
    (help ? `<div class="help">${help === "SQTODAY" ? sqToday() : help}</div>` : "") + `</div>`).join("");
}
async function saveRules(sel = "#rulesForm", msgSel = "#rulesMsg"){
  const body = {};
  document.querySelectorAll(sel + " [data-k]").forEach(el => {
    const k = el.dataset.k; let v = el.value;
    if(k === "sl_required" || k === "squareoff_on" || el.dataset.t === "b") v = v === "true";
    else if(el.dataset.t === "s"){}                                  // (a word: MT5's daily % of, phase)
    else if(k === "comm_default" && !String(v).trim()) v = "";       // (MT5: empty = not typed, v0.37.3)
    else if(!["max_mode", "day_from"].includes(k) && !/^(expiry_exit|squareoff_cd|fy_sq)/.test(k)) v = num(v);
    body[k] = v;
  });
  const j = await papi("rules", body);
  $(msgSel).textContent = j.ok ? "Saved." : j.error; $(msgSel).className = j.ok ? "ok-msg" : "err";
  if(sel === "#rulesForm"){ P.rulesShown = false; renderRules(); } else renderRules(sel);
}
async function loadCharges(sel = "#chargeTbl"){
  const j = await api("/api/charges"); if(!j.ok || !$(sel)) return;
  $(sel).innerHTML = `<div class="help">${esc(j.as_of)}. Percentages are of ${"the order's value (options: the premium)"}.</div>` +
    j.rows.map(r => `<div class="ct"><b>${esc(r.segment)}</b>` + ["brokerage", "exchange", "clearing", "tax", "stamp", "sebi", "ipft", "gst", "dp"].filter(k => r[k] && r[k] !== "-")
      .map(k => `<div><span>${{brokerage: "Brokerage", exchange: "Exchange txn", clearing: "Clearing", tax: "CTT / STT", stamp: "Stamp duty", sebi: "SEBI fee", ipft: "IPFT", gst: "GST", dp: "DP charge"}[k]}</span><span>${esc(r[k])}</span></div>`).join("") + `</div>`).join("");
}
function wireSettings(){
  $("#bRules").onclick = saveRules;
  $("#bReset").onclick = async () => {
    const j = await papi("reset", {capital: num($("#rsCap").value), confirm: $("#rsConfirm").value.trim()});
    $("#rsMsg").textContent = j.ok ? "Paper account reset. Old trades were archived on the server." : j.error;
    $("#rsMsg").className = j.ok ? "ok-msg" : "err";
    if(j.ok){ $("#rsConfirm").value = ""; P.rulesShown = false; renderRules(); }
  };
  $("#bSettings").addEventListener("click", () => { P.rulesShown = false; renderRules(); loadCharges(); });
}

/* ---------------------------------------------------------------- start */
async function paperInit(){
  wireTicket(); wireTrail(); wireTabs(); wireSettings(); wireDrag();
  const j = await api("/api/paper"); if(j.ok) paperUpdate(j.paper);
  renderTicket();
  setInterval(() => { if(P.dragging) return; if(P.armed){ toolOverlay(); if(P.prim) P.prim.update(); } posBars(); }, 250);   // follows price-scale zooms too
}
