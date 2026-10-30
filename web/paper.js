/* Paper trading panel: ticket, chart lines (draggable), positions, orders, history, rules.
   Uses globals from index.html: api, toast, fmt, chart, series, cur, last, sym, openSymbol, sendWant, $ */
"use strict";
const P = {
  snap: null, plan: null, armed: false, pvTimer: null, pvSeq: 0, lines: [], drags: [], dragging: null,
  posKey: "", ordKey: "", tab: "pos",
  T: {s: null, side: 1, type: "market", price: null, sl: null, tp: null, tp_r: 2, tpMode: "r", basis: "self", ref: null,
      mode: "pct", risk_pct: 1, risk_amt: 250, lots: 1, product: "INTRADAY"}
};
const rs = n => n == null || isNaN(n) ? "–" : (n < 0 ? "−₹" : "₹") + Math.abs(n).toLocaleString("en-IN", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const rsS = n => n == null || isNaN(n) ? "–" : (n > 0 ? "+" : n < 0 ? "−" : "") + "₹" + Math.abs(n).toLocaleString("en-IN", {maximumFractionDigits: 0});
const cls = n => n > 0 ? "up" : n < 0 ? "down" : "";
const short = s => (s || "").replace(/^[A-Z]+:/, "");
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
  if(!P.ticketLoaded && s.ticket){ Object.assign(P.T, {mode: s.ticket.mode, risk_pct: s.ticket.risk_pct, risk_amt: s.ticket.risk_amt,
    lots: s.ticket.lots, product: s.ticket.product, tp_r: s.ticket.tp_r}); P.ticketLoaded = true; renderTicket(); }
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

/* ---------------------------------------------------------------- ticket */
function tkRow(){ return sym[P.T.s] || null; }
function basisSym(){ return P.T.basis === "underlying" ? P.T.ref : P.T.s; }
function paperOnSymbol(row){
  // the chart switched contract: the ticket follows it, unless it's the future of an option ticket using underlying stops
  if(P.T.basis === "underlying" && row.s === P.T.ref){ drawLines(); return; }
  if(P.T.s !== row.s){
    P.T.s = row.s; P.T.basis = "self"; P.T.ref = null; P.T.sl = P.T.tp = P.T.price = null; P.plan = null;
    if(P.armed) setDefaults();
  }
  renderTicket(); drawLines(); preview();
}
function ltpOf(s){ return last[s] ? last[s].ltp : null; }
function setDefaults(){
  const row = tkRow(); if(!row) return;
  const bs = basisSym(), b = ltpOf(bs) || (P.T.type !== "market" ? P.T.price : null);
  const tick = (sym[bs] || {}).tick || (P.plan && P.plan.ref === bs ? P.plan.ref_tick : null) || row.tick;
  if(P.T.type !== "market" && !P.T.price){
    const l = ltpOf(P.T.s); if(l) P.T.price = roundTick(l - P.T.side * (P.T.type === "limit" ? 1 : -1) * Math.max(tick * 10, l * 0.002), row.tick);
  }
  const refPx = P.plan && P.plan.ref === bs ? P.plan.ref_price : null;
  const base = P.T.basis === "underlying" ? (ltpOf(bs) || refPx) : (P.T.type === "market" ? ltpOf(P.T.s) : P.T.price);
  if(base){
    const udir = P.T.side * (P.T.basis === "underlying" && row.o === "PE" ? -1 : 1);
    P.T.sl = roundTick(base - udir * Math.max(tick * 10, base * 0.003), tick);
    if(P.T.basis === "underlying" || P.T.tpMode === "price") P.T.tp = roundTick(base + udir * Math.max(tick * 20, base * 0.006), tick);
    else P.T.tp = null;
  }
}
function arm(side){
  if(!P.T.s){ toast("Open a contract's chart first"); return; }
  const was = P.armed && P.T.side === side;
  if(was){ disarm(); return; }
  const flip = P.armed && P.T.side !== side;
  P.T.side = side; P.armed = true;
  if(flip || P.T.sl == null) setDefaults();
  renderTicket(); drawLines(); preview(); sendWant();
}
function disarm(){ P.armed = false; P.plan = null; renderTicket(); drawLines(); sendWant(); }
function wantSymbols(){ return P.armed ? [P.T.s, P.T.ref].filter(Boolean) : []; }

function renderTicket(){
  const row = tkRow(), T = P.T;
  $("#tkSym").textContent = row ? short(row.s) : "No contract";
  $("#tkInfo").textContent = row ? `lot ${row.lot} × ${row.mult} · tick ${row.tick}` : "";
  $("#bBuy").classList.toggle("on", P.armed && T.side > 0);
  $("#bSell").classList.toggle("on", P.armed && T.side < 0);
  $("#tkBody").classList.toggle("hide", !P.armed);
  $("#tkHint").classList.toggle("hide", P.armed);
  if(!P.armed) return;
  document.querySelectorAll("#tkType button").forEach(b => b.classList.toggle("on", b.dataset.v === T.type));
  document.querySelectorAll("#tkMode button").forEach(b => b.classList.toggle("on", b.dataset.v === T.mode));
  document.querySelectorAll("#tkBasis button").forEach(b => b.classList.toggle("on", b.dataset.v === T.basis));
  $("#tkBasisRow").classList.toggle("hide", !(row && row.f === "OPT"));
  const ent = $("#tkPrice");
  ent.disabled = T.type === "market";
  if(document.activeElement !== ent) ent.value = T.type === "market" ? (ltpOf(T.s) != null ? "market" : "") : (T.price ?? "");
  const setv = (id, v) => { if(document.activeElement !== $(id)) $(id).value = v ?? ""; };
  setv("#tkSl", T.sl); setv("#tkTp", T.tpMode === "price" ? T.tp : (P.plan && P.plan.tp != null ? P.plan.tp : ""));
  setv("#tkTpR", T.tpMode === "r" ? T.tp_r : "");
  $("#tkTp").placeholder = T.basis === "underlying" ? "future price" : "price";
  $("#tkSl").placeholder = T.basis === "underlying" ? "future price" : "price";
  $("#tkTpR").disabled = T.basis === "underlying";
  setv("#tkSize", T.mode === "pct" ? T.risk_pct : T.mode === "amt" ? T.risk_amt : T.lots);
  $("#tkSizeUnit").textContent = T.mode === "pct" ? "% of balance" : T.mode === "amt" ? "₹ at risk (net)" : "lots";
  $("#tkProd").value = T.product;
  const note = $("#tkBasisNote");
  if(T.basis === "underlying"){
    const onIt = cur && cur.s === T.ref;
    note.innerHTML = T.ref ? (onIt ? `Lines are on this chart (${esc(short(T.ref))}). The option is exited when the future hits them.`
      : `SL and target are prices of <b>${esc(short(T.ref))}</b>. <a href="#" id="goRef">Open its chart</a> to drag them.`) : "Finding the future…";
    const g = $("#goRef"); if(g) g.onclick = e => { e.preventDefault(); const r = sym[T.ref]; if(r) openSymbol(r); else openBySymbol(T.ref); };
  } else note.textContent = "";
  renderPlan();
}
function renderPlan(){
  const p = P.plan, el = $("#tkPv"), btn = $("#bPlace");
  if(!p){ el.innerHTML = `<div class="muted">Working out size and costs…</div>`; btn.disabled = true; btn.textContent = "Place"; return; }
  const est = p.risk_estimated ? "≈ " : "";
  const ec = p.entry_charges;
  const rows = [
    ["Lots", `<b>${p.lots}</b> <span class="muted">(${p.qty} qty${p.mult > 1 ? ` × ${p.mult}` : ""})</span>`],
    ["Entry", `${fmt(p.entry, p.tick)}${p.type === "market" ? ' <span class="muted">at the ' + (p.side > 0 ? "ask" : "bid") + "</span>" : ""}`],
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
  if(more) more.onclick = e => { e.preventDefault(); const bd = $("#pvBd"); bd.classList.toggle("hide"); bd.innerHTML = breakdown(p.entry_charges, "Entry order") ; };
  btn.disabled = !!p.blocked || !p.lots;
  btn.className = "place " + (p.side > 0 ? "buy" : "sell");
  btn.textContent = `${p.side > 0 ? "BUY" : "SELL"} ${p.lots || 0} lot${p.lots === 1 ? "" : "s"} ${p.type === "market" ? "at market" : (p.type === "limit" ? "limit " : "stop ") + fmt(p.entry, p.tick)}`;
}
function breakdown(c, title){
  if(!c) return "";
  const names = {brokerage: "Brokerage", exchange: "Exchange txn", clearing: "Clearing", tax: c.tax_name || "CTT/STT", stamp: "Stamp duty", sebi: "SEBI fee", ipft: "IPFT", gst: "GST 18%"};
  return `<div class="bdt">${esc(title)}${c.value ? ` · value ${rs(c.value)}` : ""}</div>` +
    Object.entries(names).filter(([k]) => c[k]).map(([k, n]) => `<div><span>${n}</span><span>${rs(c[k])}</span></div>`).join("") +
    `<div class="tot"><span>Total</span><span>${rs(c.total)}</span></div>`;
}
function ticketBody(){
  const T = P.T;
  return {s: T.s, side: T.side, type: T.type, price: T.type === "market" ? null : T.price, sl: T.sl,
    tp: T.tpMode === "price" || T.basis === "underlying" ? T.tp : null, tp_r: T.tpMode === "r" && T.basis === "self" ? T.tp_r : null,
    basis: T.basis, mode: T.mode, risk_pct: T.risk_pct, risk_amt: T.risk_amt, lots: T.lots, product: T.product};
}
function preview(delay = 250){
  if(!P.armed || !P.T.s) return;
  clearTimeout(P.pvTimer);
  P.pvTimer = setTimeout(async () => {
    const my = ++P.pvSeq;
    const j = await api("/api/paper/preview", {body: ticketBody()});
    if(my !== P.pvSeq) return;
    if(!j.ok){
      P.plan = null; renderPlan();
      const waiting = /^waiting/.test(j.error || "");
      $("#tkPv").innerHTML = `<div class="note ${waiting ? "" : "down"}">${esc(j.error)}</div>`;
      if(waiting && (P.waitTries = (P.waitTries || 0) + 1) < 15) preview(1500);
      return;
    }
    P.waitTries = 0;
    P.plan = j.plan;
    if(j.plan.ref && P.T.ref !== j.plan.ref){ P.T.ref = j.plan.ref; sendWant(); }
    if(P.T.basis === "underlying" && P.T.sl == null && P.T.ref){ setDefaults(); if(P.T.sl != null){ preview(0); } }
    renderTicket(); drawLines();
  }, delay);
}
async function place(){
  const j = await papi("place", ticketBody());
  if(j.ok){ setStatus(""); disarm(); api("/api/paper/ticket", {body: {mode: P.T.mode, risk_pct: P.T.risk_pct, risk_amt: P.T.risk_amt, lots: P.T.lots, product: P.T.product, tp_r: P.T.tp_r}}); }
}
function wireTicket(){
  $("#bBuy").onclick = () => arm(1);
  $("#bSell").onclick = () => arm(-1);
  $("#tkX").onclick = disarm;
  document.querySelectorAll("#tkType button").forEach(b => b.onclick = () => { P.T.type = b.dataset.v; if(P.T.type !== "market" && !P.T.price) setDefaults(); renderTicket(); drawLines(); preview(); });
  document.querySelectorAll("#tkMode button").forEach(b => b.onclick = () => { P.T.mode = b.dataset.v; renderTicket(); preview(); });
  document.querySelectorAll("#tkBasis button").forEach(b => b.onclick = () => {
    P.T.basis = b.dataset.v; P.T.sl = P.T.tp = null;
    if(P.T.basis === "underlying"){ P.T.tpMode = "price"; } else { P.T.tpMode = "r"; setDefaults(); }
    renderTicket(); drawLines(); preview(0); setTimeout(() => { if(P.T.sl == null){ setDefaults(); renderTicket(); drawLines(); preview(); } }, 900);
  });
  const on = (id, fn) => { $(id).addEventListener("change", fn); $(id).addEventListener("keydown", e => { if(e.key === "Enter") fn(); }); };
  on("#tkPrice", () => { const v = num($("#tkPrice").value); if(v){ P.T.price = v; drawLines(); preview(); } });
  on("#tkSl", () => { P.T.sl = num($("#tkSl").value); drawLines(); preview(); });
  on("#tkTp", () => { const v = num($("#tkTp").value); P.T.tp = v; P.T.tpMode = v == null ? "r" : "price"; drawLines(); preview(); });
  on("#tkTpR", () => { const v = num($("#tkTpR").value); if(v){ P.T.tp_r = v; P.T.tpMode = "r"; P.T.tp = null; preview(); } });
  on("#tkSize", () => { const v = num($("#tkSize").value); if(v == null) return;
    if(P.T.mode === "pct") P.T.risk_pct = v; else if(P.T.mode === "amt") P.T.risk_amt = v; else P.T.lots = Math.max(1, Math.round(v)); preview(); });
  $("#tkProd").onchange = () => { P.T.product = $("#tkProd").value; preview(); };
  $("#bPlace").onclick = place;
  setInterval(() => { if(P.armed && P.T.type === "market" && document.visibilityState === "visible") preview(0); }, 3000);
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
    for(const t of ["pos", "ord", "hist", "ev"]) $("#p_" + t).classList.toggle("hide", t !== P.tab);
    if(P.tab === "hist") loadTrades();
  });
}
async function openBySymbol(s){ const j = await api("/api/symbol?s=" + encodeURIComponent(s)); if(j.ok) openSymbol(j.row); }

/* ---------------------------------------------------------------- chart lines */
function clearLines(){ for(const l of P.lines){ try{ series.removePriceLine(l); }catch(e){} } P.lines = []; P.drags = []; }
function addLine(price, color, title, style, drag){
  const l = series.createPriceLine({price, color, lineWidth: drag ? 2 : 1, lineStyle: style ?? 0, axisLabelVisible: true, title});
  P.lines.push(l);
  if(drag) P.drags.push({line: l, price, ...drag});
  return l;
}
function drawLines(){
  if(!series || !cur || P.dragging) return;
  clearLines();
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const UP = css("--up"), DOWN = css("--down"), ACC = css("--accent"), MUT = css("--muted");
  const tickOf = s => (sym[s] || {}).tick || cur.tick;
  if(P.snap){
    for(const p of P.snap.positions){
      const bs = p.basis === "underlying" ? p.ref : p.s;
      if(p.s === cur.s) addLine(p.avg, MUT, `${p.side > 0 ? "L" : "S"} ${p.lots} ${rsS(p.net)}`, 2);
      if(p.s === cur.s && p.floor != null) addLine(p.floor, DOWN, "floor (BE)", 1);
      if(bs !== cur.s) continue;
      const e = p.est ? "≈" : "";
      if(p.sl != null) addLine(p.sl, DOWN, `SL ${e}${rsS(p.at_sl)}${p.trail ? " trail" : ""}`, 0,
        {tick: tickOf(bs), drop: v => papi("modify", {id: p.id, sl: v})});
      if(p.tp != null) addLine(p.tp, UP, `TP ${e}${rsS(p.at_tp)}`, 0, {tick: tickOf(bs), drop: v => papi("modify", {id: p.id, tp: v})});
    }
    for(const o of P.snap.orders){
      if(o.s === cur.s) addLine(o.price, ACC, `${o.side > 0 ? "BUY" : "SELL"} ${o.type} ${o.lots}`, 2, {tick: tickOf(o.s), drop: v => papi("modify", {id: o.id, price: v})});
      const bs = o.basis === "underlying" ? o.ref : o.s;
      if(bs !== cur.s) continue;
      if(o.sl != null) addLine(o.sl, DOWN, `SL ${rsS(o.at_sl)}`, 2, {tick: tickOf(bs), drop: v => papi("modify", {id: o.id, sl: v})});
      if(o.tp != null) addLine(o.tp, UP, `TP ${o.at_tp != null ? rsS(o.at_tp) : ""}`, 2, {tick: tickOf(bs), drop: v => papi("modify", {id: o.id, tp: v})});
    }
  }
  if(P.armed){
    const T = P.T, pl = P.plan, bs = basisSym();
    if(T.type !== "market" && T.s === cur.s && T.price)
      addLine(T.price, ACC, `${T.side > 0 ? "BUY" : "SELL"} ${T.type}`, 0, {tick: tickOf(T.s), drop: v => { P.T.price = v; preview(0); }});
    if(bs === cur.s){
      if(T.sl != null) addLine(T.sl, DOWN, `SL ${pl && pl.risk != null ? (pl.risk_estimated ? "≈" : "") + rsS(-pl.risk) : ""}`, 0,
        {tick: tickOf(bs), drop: v => { P.T.sl = v; renderTicket(); preview(0); }});
      const tp = T.tpMode === "price" || T.basis === "underlying" ? T.tp : (pl ? pl.tp : null);
      if(tp != null) addLine(tp, UP, `TP ${pl && pl.reward != null ? rsS(pl.reward) : ""}`, 0,
        {tick: tickOf(bs), drop: v => { P.T.tp = v; P.T.tpMode = "price"; renderTicket(); preview(0); }});
      if(pl && pl.be != null && T.s === cur.s) addLine(pl.be, MUT, "BE+costs", 1);
    }
  }
}
function wireDrag(){
  const el = $("#chart");
  const yOf = e => (e.touches ? e.touches[0].clientY : e.clientY) - el.getBoundingClientRect().top;
  const near = y => {
    let best = null, bd = 8;
    for(const d of P.drags){ const yy = series.priceToCoordinate(d.price); if(yy != null && Math.abs(yy - y) < bd){ bd = Math.abs(yy - y); best = d; } }
    return best;
  };
  const down = e => {
    if(!series) return;
    const d = near(yOf(e)); if(!d) return;
    e.preventDefault(); e.stopPropagation();
    P.dragging = d; chart.applyOptions({handleScroll: false, handleScale: false});
  };
  const move = e => {
    if(!series) return;
    const y = yOf(e);
    if(!P.dragging){ el.style.cursor = near(y) ? "ns-resize" : ""; return; }
    e.preventDefault(); e.stopPropagation();
    const v = series.coordinateToPrice(y); if(v == null) return;
    const p = roundTick(v, P.dragging.tick);
    P.dragging.price = p; P.dragging.line.applyOptions({price: p});
  };
  const up = e => {
    if(!P.dragging) return;
    const d = P.dragging; P.dragging = null;
    chart.applyOptions({handleScroll: true, handleScale: true});
    e.stopPropagation();
    d.drop(d.price);
  };
  for(const [ev, fn] of [["mousedown", down], ["touchstart", down], ["mousemove", move], ["touchmove", move]])
    el.addEventListener(ev, fn, {capture: true, passive: false});
  window.addEventListener("mouseup", up, true); window.addEventListener("touchend", up, true);
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
  ["squareoff", "Intraday square-off (IST)", "Intraday positions close at this time, HH:MM; empty = off"],
  ["expiry_exit", "Expiry-day exit (IST)", "Positions in contracts expiring today close at this time; empty = off"],
  ["stale_sec", "Stale price (seconds)", "Market orders are refused when the last price is older"],
];
function renderRules(){
  if(!P.snap) return;
  P.rulesShown = true;
  const r = P.snap.rules;
  $("#rulesForm").innerHTML = RULES.map(([k, label, help, opts]) => `<label>${label}</label>` +
    (opts ? `<select data-k="${k}">${opts.map(o => `<option value="${o}" ${String(r[k]) === String(o) ? "selected" : ""}>${o === true ? "required" : o === false ? "optional" : o}</option>`).join("")}</select>`
          : `<input data-k="${k}" value="${esc(r[k])}" ${typeof r[k] === "number" ? 'inputmode="decimal"' : ""}>`) +
    (help ? `<div class="help">${help}</div>` : "")).join("");
}
async function saveRules(){
  const body = {};
  document.querySelectorAll("#rulesForm [data-k]").forEach(el => {
    const k = el.dataset.k; let v = el.value;
    if(k === "sl_required") v = v === "true";
    else if(!["max_mode", "day_from", "squareoff", "expiry_exit"].includes(k)) v = num(v);
    body[k] = v;
  });
  const j = await papi("rules", body);
  $("#rulesMsg").textContent = j.ok ? "Saved." : j.error; $("#rulesMsg").className = j.ok ? "ok-msg" : "err";
  P.rulesShown = false; renderRules();
}
async function loadCharges(){
  const j = await api("/api/charges"); if(!j.ok) return;
  $("#chargeTbl").innerHTML = `<div class="help">${esc(j.as_of)}. Percentages are of ${"the order's value (options: the premium)"}.</div>` +
    j.rows.map(r => `<div class="ct"><b>${esc(r.segment)}</b>` + ["brokerage", "exchange", "clearing", "tax", "stamp", "sebi", "ipft", "gst"]
      .map(k => `<div><span>${{brokerage: "Brokerage", exchange: "Exchange txn", clearing: "Clearing", tax: "CTT / STT", stamp: "Stamp duty", sebi: "SEBI fee", ipft: "IPFT", gst: "GST"}[k]}</span><span>${esc(r[k])}</span></div>`).join("") + `</div>`).join("");
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
}
