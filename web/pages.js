/* Full pages next to the chart: Trades (positions + orders), History, Book, Account and Log.
   The trade panel keeps its own tabs; these pages give each one the whole screen and more to work with.
   The chart keeps running underneath, so going back to it is instant. Pages are in the address (#trades ...). */

const PG = {page: "chart", hist: null, histT: 0, bookSyms: [], books: {}, logs: null, logF: "all", logQ: "", posKey: null, ordKey: null, eq: null};
const PAGES = ["chart", "trades", "history", "book", "account", "log"];
const pgq = s => document.querySelector(s);
const istTime = (ts, opt) => new Date(ts * 1000).toLocaleString("en-GB", {timeZone: "Asia/Kolkata", ...(opt || {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"})});
const istDay = ts => new Date((ts + 19800) * 1000).toISOString().slice(0, 10);       // YYYY-MM-DD in IST
const durTxt = s => { if(s == null || s < 0) return "–"; s = Math.round(s); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m` : `${s}s`; };
const tkOf = s => (sym[s] || {}).tick || (cur && cur.s === s ? cur.tick : 0.05);

/* ------------------------------------------------------------------ switching pages */
function pgShow(name, fromHash){
  if(!PAGES.includes(name)) name = "chart";
  if(name !== "chart" && document.body.classList.contains("chartfs")) setFull(false);
  PG.page = name;
  document.body.dataset.page = name;
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("on", b.dataset.pg === name));
  document.querySelectorAll("#pages > .pg").forEach(el => el.classList.toggle("hide", el.id !== "pg_" + name));
  pgq("#pages").classList.toggle("hide", name === "chart");
  if(!fromHash){ const h = name === "chart" ? " " : "#" + name; if(location.hash !== h.trim()) history.replaceState(null, "", h === " " ? location.pathname + location.search : h); }
  if(name === "trades"){ PG.posKey = PG.ordKey = null; pgTrades(); }
  if(name === "history") pgHistory(true);
  if(name === "book") pgBook();
  if(name === "account") pgAccount();
  if(name === "log") pgLog(true);
  if(name === "chart" && typeof chart !== "undefined" && chart) setTimeout(() => { legendPlace(); positionTools(); }, 50);
  sendWant();
}
function pagesWant(){ return PG.page === "book" ? pgBookList() : []; }
function pagesDepthWant(){ return PG.page === "book" ? pgBookList() : null; }
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("#nav button").forEach(b => b.onclick = () => pgShow(b.dataset.pg));
  addEventListener("hashchange", () => pgShow((location.hash || "").slice(1) || "chart", true));
  document.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); pgShow(b.dataset.goto); }));
});
function pagesStart(){ const h = (location.hash || "").slice(1); if(PAGES.includes(h) && h !== "chart") pgShow(h, true); chargesBoot(); }

/* the paper account changed (fills, stops, P&L - about once a second while trades are open) */
function pagesPaper(events){
  const n = P.snap ? P.snap.positions.length + P.snap.orders.length : 0;
  const nb = pgq("#nbTrades"); if(nb){ nb.textContent = n || ""; nb.classList.toggle("hide", !n); }
  if(PG.page === "trades") pgTrades();
  if(PG.page === "account") pgAcctCards("#pgAcctCards2");
  if(events && events.length){ PG.hist = null; if(PG.page === "history") pgHistory(true); if(PG.page === "log") pgLog(true); }
}
function pgAcctCards(sel){
  const el = pgq(sel); if(!el || !P.snap) return;
  const a = P.snap.acct;
  const cells = [
    ["Balance", rs(a.balance)], ["Equity", rs(a.equity)],
    ["Open P&L (net)", `<span class="${cls(a.open_net)}">${rs(a.open_net)}</span>`],
    ["Today (net)", `<span class="${cls(a.realized_today)}">${rs(a.realized_today)}</span>`],
    ["Day room", a.day_room == null ? "off" : `<span class="${a.day_room < 0 ? "down" : ""}">${rs(a.day_room)}</span>`],
    ["Max room", a.max_room == null ? "off" : `<span class="${a.max_room < 0 ? "down" : ""}">${rs(a.max_room)}</span>`],
    ["Margin used", rs(a.margin_used)], ["Free", rs(a.free)], ["Open risk", rs(a.open_risk)],
    ["Trades today", a.trades_today + (P.snap.rules.max_trades ? ` / ${P.snap.rules.max_trades}` : "")],
  ];
  el.innerHTML = cells.map(([k, v]) => `<div class="pgc"><span>${k}</span><b>${v}</b></div>`).join("");
}

/* ------------------------------------------------------------------ Trades: positions and orders */
function pgTrades(){
  const box = pgq("#pg_trades"); if(!box || !P.snap) return;
  if(!box.dataset.built){
    box.dataset.built = "1";
    box.innerHTML = `<div class="pg-head"><h2>Trades</h2><span class="sp"></span>
        <button id="pgBeAll" title="Move every stop to break-even + costs">BE all</button>
        <button id="pgCancelAll" title="Cancel every pending order">Cancel all orders</button>
        <button id="pgCloseAll" class="danger" title="Close every position at market">Close all</button></div>
      <div class="pg-cards" id="pgAcctCards"></div>
      <h3 class="pg-h3">Open positions <span class="muted" id="pgPosN"></span></h3>
      <div class="tblw"><table class="tbl" id="pgPos"></table></div>
      <h3 class="pg-h3">Pending orders <span class="muted" id="pgOrdN"></span></h3>
      <div class="tblw"><table class="tbl" id="pgOrd"></table></div>
      <p class="help">Click a price (SL, TP, order price) to change it; Enter saves, empty removes. Click a contract to open its chart. Trail settings here belong to that trade, like the bar on the chart.</p>`;
    pgq("#pgBeAll").onclick = () => papi("be_all");
    pgq("#pgCancelAll").onclick = async () => { for(const o of [...P.snap.orders]) await papi("cancel", {id: o.id}); };
    pgq("#pgCloseAll").onclick = e => { const b = e.currentTarget;
      if(b.dataset.armed){ delete b.dataset.armed; b.textContent = "Close all"; papi("close_all"); }
      else { b.dataset.armed = "1"; b.textContent = "Sure? Close all"; setTimeout(() => { delete b.dataset.armed; b.textContent = "Close all"; }, 3000); } };
  }
  pgAcctCards("#pgAcctCards");
  pgPositions(); pgOrders();
}
function pgEditCell(td, id, what, val, onOrder){
  if(td.querySelector("input")) return;
  const inp = document.createElement("input"); inp.className = "edin mono"; inp.value = val ?? ""; inp.placeholder = "empty = remove";
  td.innerHTML = ""; td.append(inp); inp.focus(); inp.select();
  let done = false;
  const fin = async save => { if(done) return; done = true;
    if(save){ const v = inp.value.trim(); const b = {id}; b[what] = v === "" ? null : num(v); const j = await papi("modify", b); if(!j.ok) toast(j.error); }
    PG.posKey = PG.ordKey = null; pgTrades(); };
  inp.onkeydown = e => { e.stopPropagation(); if(e.key === "Enter") fin(true); if(e.key === "Escape") fin(false); };
  inp.onblur = () => fin(false);
}
function pgPositions(){
  const tb = pgq("#pgPos"); if(!tb) return;
  const ps = P.snap.positions;
  pgq("#pgPosN").textContent = ps.length ? `(${ps.length})` : "";
  const key = ps.map(p => [p.id, p.sl, p.tp, p.floor, p.qty, p.trail, p.be_done, p.at_be, JSON.stringify(p.tr)].join("|")).join(";");
  if(key !== PG.posKey){
    PG.posKey = key;
    if(!ps.length){ tb.innerHTML = `<tr><td class="empty">No open positions.</td></tr>`; return; }
    tb.innerHTML = `<thead><tr><th>Contract</th><th>Side</th><th class="r">Lots</th><th>Product</th><th class="r">Entry</th><th class="r">LTP</th>
      <th class="r">SL</th><th class="r">at SL</th><th class="r">TP</th><th class="r">at TP</th><th class="r">BE + costs</th>
      <th class="r">Net P&L</th><th class="r">R</th><th class="r">Charges paid</th><th>Opened</th><th>Trail BE</th><th>Trail SL</th><th></th></tr></thead><tbody>` +
      ps.map(p => { const tr = p.tr || {}, tk = p.tick, ts = trailTips(p);
        return `<tr data-id="${p.id}">
        <td><a href="#" class="psym mono" data-open="${esc(p.basis === "underlying" ? p.ref : p.s)}">${esc(short(p.s))}</a>${p.basis === "underlying" ? `<div class="muted sm">stops on ${esc(short(p.ref))}</div>` : ""}</td>
        <td><b class="${p.side > 0 ? "up" : "down"}">${p.side > 0 ? "LONG" : "SHORT"}</b></td>
        <td class="r mono">${p.lots}</td><td>${esc(p.product)}</td><td class="r mono">${fmt(p.avg, tk)}</td><td class="r mono" data-f="ltp"></td>
        <td class="r mono ed" data-e="sl" title="Click to change">${p.sl != null ? fmt(p.sl, tk) : "add"}${p.trail ? ' <span class="tag">TRAIL</span>' : ""}${p.at_be ? ' <span class="tag">BE</span>' : ""}</td><td class="r mono" data-f="atsl"></td>
        <td class="r mono ed" data-e="tp" title="Click to change">${p.tp != null ? fmt(p.tp, tk) : "add"}</td><td class="r mono" data-f="attp"></td>
        <td class="r mono" data-f="be"></td><td class="r mono" data-f="net"></td><td class="r mono" data-f="r"></td><td class="r mono" data-f="paid"></td>
        <td class="mono sm">${istTime(p.opened)}<div class="muted" data-f="age"></div></td>
        <td class="nw"><button class="tg ${tr.be_on ? "on" : ""} ${ts.beDone ? "done" : ""}" data-t="be_on" title="${esc(ts.be)}">BE-T</button><input class="rr" data-t="be_r" value="${tr.be_r ?? 1}" title="${esc(ts.beR)}"></td>
        <td class="nw"><button class="tg ${tr.sl_on ? "on" : ""}" data-t="sl_on" title="${esc(ts.sl)}">TRAIL</button><input class="rr" data-t="sl_r" value="${tr.sl_r ?? 1}" title="${esc(ts.slR)}"></td>
        <td class="nw"><button class="sm" data-a="be" title="Stop to break-even + costs now">BE</button> <button class="sm x" data-a="close" title="Close at market">✕</button></td></tr>`; }).join("") + `</tbody>`;
    tb.querySelectorAll("tr[data-id]").forEach(tr => {
      const id = tr.dataset.id, pos = () => P.snap.positions.find(x => x.id === id);
      tr.querySelector('[data-a="be"]').onclick = () => papi("be", {id});
      tr.querySelector('[data-a="close"]').onclick = () => papi("close", {id});
      tr.querySelectorAll("[data-e]").forEach(td => td.onclick = () => { const p = pos(); if(p) pgEditCell(td, id, td.dataset.e, p[td.dataset.e]); });
      tr.querySelectorAll("button.tg").forEach(b => b.onclick = () => { const p = pos(); if(!p) return; const k = b.dataset.t, rk = k === "be_on" ? "be_r" : "sl_r";
        papi("pos_trail", {id, [k]: !(p.tr || {})[k], [rk]: num(tr.querySelector(`[data-t="${rk}"]`).value) || (p.tr || {})[rk] || 1}); });
      tr.querySelectorAll("input.rr").forEach(inp => { const save = () => { const v = num(inp.value); if(v > 0) papi("pos_trail", {id, [inp.dataset.t]: v}); };
        inp.onchange = save; inp.onkeydown = e => { e.stopPropagation(); if(e.key === "Enter"){ save(); inp.blur(); } }; });
    });
    tb.querySelectorAll("[data-open]").forEach(a => a.onclick = e => { e.preventDefault(); pgShow("chart"); const r = sym[a.dataset.open]; if(r) openSymbol(r); else openBySymbol(a.dataset.open); });
  }
  const now = Date.now() / 1000;
  for(const p of ps){
    const tr = tb.querySelector(`tr[data-id="${p.id}"]`); if(!tr) continue;
    const f = k => tr.querySelector(`[data-f="${k}"]`), e = p.est ? "≈" : "";
    f("ltp").textContent = fmt(p.ltp, p.tick) + (p.stale ? " ⚠" : "");
    f("atsl").innerHTML = p.at_sl != null ? `<span class="${cls(p.at_sl)}">${e}${rsS(p.at_sl)}</span>` : "–";
    f("attp").innerHTML = p.at_tp != null ? `<span class="${cls(p.at_tp)}">${e}${rsS(p.at_tp)}</span>` : "–";
    f("be").textContent = fmt(p.be, p.tick);
    f("net").innerHTML = `<b class="${cls(p.net)}">${rs(p.net)}</b>`;
    f("r").innerHTML = p.r_now != null ? `<span class="${cls(p.r_now)}">${p.r_now > 0 ? "+" : ""}${p.r_now}R</span>` : "–";
    f("paid").textContent = rs(p.paid);
    f("age").textContent = durTxt(now - p.opened);
  }
}
function pgOrders(){
  const tb = pgq("#pgOrd"); if(!tb) return;
  const os = P.snap.orders;
  pgq("#pgOrdN").textContent = os.length ? `(${os.length})` : "";
  const key = os.map(o => [o.id, o.price, o.sl, o.tp].join("|")).join(";");
  if(key !== PG.ordKey){
    PG.ordKey = key;
    if(!os.length){ tb.innerHTML = `<tr><td class="empty">No pending orders.</td></tr>`; return; }
    tb.innerHTML = `<thead><tr><th>Contract</th><th>Order</th><th class="r">Lots</th><th>Product</th><th class="r">Price</th><th class="r">LTP</th><th class="r">Away</th>
      <th class="r">SL</th><th class="r">Risk</th><th class="r">TP</th><th class="r">at TP</th><th>Placed</th><th></th></tr></thead><tbody>` +
      os.map(o => { const tk = tkOf(o.s);
        return `<tr data-id="${o.id}"><td><a href="#" class="psym mono" data-open="${esc(o.s)}">${esc(short(o.s))}</a></td>
        <td><b class="${o.side > 0 ? "up" : "down"}">${o.side > 0 ? "BUY" : "SELL"} ${esc(o.type.toUpperCase())}</b></td><td class="r mono">${o.lots}</td><td>${esc(o.product)}</td>
        <td class="r mono ed" data-e="price">${fmt(o.price, tk)}</td><td class="r mono" data-f="ltp"></td><td class="r mono" data-f="away"></td>
        <td class="r mono ed" data-e="sl">${o.sl != null ? fmt(o.sl, tk) : "add"}</td><td class="r mono down">${o.at_sl != null ? rsS(o.at_sl) : "–"}</td>
        <td class="r mono ed" data-e="tp">${o.tp != null ? fmt(o.tp, tk) : "add"}</td><td class="r mono up">${o.at_tp != null ? rsS(o.at_tp) : "–"}</td>
        <td class="mono sm">${o.created ? istTime(o.created) : "–"}</td><td><button class="sm x" data-a="cancel" title="Cancel">✕</button></td></tr>`; }).join("") + `</tbody>`;
    tb.querySelectorAll("tr[data-id]").forEach(tr => { const id = tr.dataset.id;
      tr.querySelector('[data-a="cancel"]').onclick = () => papi("cancel", {id});
      tr.querySelectorAll("[data-e]").forEach(td => td.onclick = () => { const o = P.snap.orders.find(x => x.id === id); if(o) pgEditCell(td, id, td.dataset.e, o[td.dataset.e]); }); });
    tb.querySelectorAll("[data-open]").forEach(a => a.onclick = e => { e.preventDefault(); pgShow("chart"); const r = sym[a.dataset.open]; if(r) openSymbol(r); else openBySymbol(a.dataset.open); });
  }
  for(const o of os){
    const tr = tb.querySelector(`tr[data-id="${o.id}"]`); if(!tr) continue;
    const l = o.ltp ?? (last[o.s] || {}).ltp, tk = tkOf(o.s);
    tr.querySelector('[data-f="ltp"]').textContent = fmt(l, tk);
    tr.querySelector('[data-f="away"]').textContent = l ? `${Math.round(Math.abs(o.price - l) / tk)} ticks` : "–";
  }
}

/* ------------------------------------------------------------------ History: filters, stats, equity curve */
async function pgHistLoad(force){
  if(PG.hist && !force && Date.now() - PG.histT < 30000) return PG.hist;
  const j = await api("/api/paper/history?days=0");
  if(j.ok){ PG.hist = j.rows.slice().reverse(); PG.histT = Date.now(); }   // oldest first
  return PG.hist || [];
}
function pgHistFilter(rows){
  const f = PG.hf || (PG.hf = {period: "all", from: "", to: "", s: "", side: "", res: "", reason: "", product: ""});
  const today = istDay(Date.now() / 1000), d0 = new Date(today + "T00:00:00Z");
  const dayAdd = n => { const d = new Date(d0); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dow = (d0.getUTCDay() + 6) % 7;
  let from = "", to = "";
  if(f.period === "today") from = to = today;
  else if(f.period === "yesterday") from = to = dayAdd(-1);
  else if(f.period === "week"){ from = dayAdd(-dow); }
  else if(f.period === "lastweek"){ from = dayAdd(-dow - 7); to = dayAdd(-dow - 1); }
  else if(f.period === "7d") from = dayAdd(-6);
  else if(f.period === "month") from = today.slice(0, 8) + "01";
  else if(f.period === "30d") from = dayAdd(-29);
  else if(f.period === "custom"){ from = f.from; to = f.to; }
  return rows.filter(h => { const d = istDay(h.closed);
    return (!from || d >= from) && (!to || d <= to) && (!f.s || short(h.s) === f.s) && (!f.side || String(h.side) === f.side)
      && (!f.res || (f.res === "win" ? h.net > 0 : h.net <= 0)) && (!f.reason || h.reason === f.reason) && (!f.product || h.product === f.product); });
}
function pgStats(rows){
  const n = rows.length, wins = rows.filter(h => h.net > 0), losses = rows.filter(h => h.net <= 0);
  const sum = a => a.reduce((x, h) => x + h.net, 0);
  const gw = sum(wins), gl = -sum(losses), net = gw - gl, fees = rows.reduce((x, h) => x + (h.charges ? h.charges.total : 0), 0);
  const rr = rows.filter(h => h.r != null);
  let peak = 0, eq = 0, dd = 0, ws = 0, ls = 0, cw = 0, cl = 0;
  for(const h of rows){ eq += h.net; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
    if(h.net > 0){ cw++; cl = 0; } else { cl++; cw = 0; } ws = Math.max(ws, cw); ls = Math.max(ls, cl); }
  return {n, wins: wins.length, losses: losses.length, net, gw, gl, fees, wr: n ? 100 * wins.length / n : null, pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : null),
    avgR: rr.length ? rr.reduce((x, h) => x + h.r, 0) / rr.length : null, exp: n ? net / n : null, avgW: wins.length ? gw / wins.length : null, avgL: losses.length ? -gl / losses.length : null,
    best: n ? Math.max(...rows.map(h => h.net)) : null, worst: n ? Math.min(...rows.map(h => h.net)) : null, dd, ws, ls,
    hold: n ? rows.reduce((x, h) => x + (h.closed - h.opened), 0) / n : null};
}
async function pgHistory(reload){
  const box = pgq("#pg_history"); if(!box) return;
  if(!box.dataset.built){
    box.dataset.built = "1";
    box.innerHTML = `<div class="pg-head"><h2>History</h2><span class="sp"></span><button id="pgHCsv">Download CSV (filtered)</button><a class="btnlink" href="/api/paper/history.csv">Full CSV</a></div>
      <div class="pg-filters" id="pgHF"></div>
      <div class="pg-cards" id="pgHStats"></div>
      <div class="pg-charts"><div><div class="pg-ct">Equity (net of all charges)</div><div id="pgEq" class="pg-chart"></div></div>
        <div><div class="pg-ct">Net P&L by day</div><div id="pgDay" class="pg-chart"></div></div></div>
      <div class="pg-split"><div><h3 class="pg-h3">By contract</h3><div class="tblw"><table class="tbl" id="pgBySym"></table></div></div>
        <div><h3 class="pg-h3">By exit</h3><div class="tblw"><table class="tbl" id="pgByReason"></table></div></div></div>
      <h3 class="pg-h3">Closed trades <span class="muted" id="pgHN"></span></h3>
      <div class="tblw"><table class="tbl" id="pgHT"></table></div>`;
    pgq("#pgHCsv").onclick = pgHistCsv;
  }
  if(reload || !PG.hist) await pgHistLoad(true);
  pgHistRender();
}
function pgHistRender(){
  const all = PG.hist || [], f = PG.hf || (PG.hf = {period: "all", from: "", to: "", s: "", side: "", res: "", reason: "", product: ""});
  const opts = (k, list, lab) => `<option value="">${lab}</option>` + [...new Set(list)].sort().map(v => `<option value="${esc(v)}" ${f[k] === v ? "selected" : ""}>${esc(v)}</option>`).join("");
  const per = [["all", "All time"], ["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["lastweek", "Last week"], ["7d", "Last 7 days"], ["month", "This month"], ["30d", "Last 30 days"], ["custom", "Custom dates…"]];
  pgq("#pgHF").innerHTML = `<select data-f="period">${per.map(([v, t]) => `<option value="${v}" ${f.period === v ? "selected" : ""}>${t}</option>`).join("")}</select>`
    + (f.period === "custom" ? `<input type="date" data-f="from" value="${f.from}"><input type="date" data-f="to" value="${f.to}">` : "")
    + `<select data-f="s">${opts("s", all.map(h => short(h.s)), "All contracts")}</select>`
    + `<select data-f="side"><option value="">Long and short</option><option value="1" ${f.side === "1" ? "selected" : ""}>Long</option><option value="-1" ${f.side === "-1" ? "selected" : ""}>Short</option></select>`
    + `<select data-f="res"><option value="">Wins and losses</option><option value="win" ${f.res === "win" ? "selected" : ""}>Wins</option><option value="loss" ${f.res === "loss" ? "selected" : ""}>Losses</option></select>`
    + `<select data-f="reason">${opts("reason", all.map(h => h.reason), "Every exit")}</select>`
    + `<select data-f="product">${opts("product", all.map(h => h.product), "All products")}</select>`
    + `<button class="ghost" data-clear>Clear</button>`;
  pgq("#pgHF").querySelectorAll("[data-f]").forEach(el => el.onchange = () => { f[el.dataset.f] = el.value; pgHistRender(); });
  pgq("#pgHF [data-clear]").onclick = () => { PG.hf = null; pgHistRender(); };
  const rows = pgHistFilter(all), st = pgStats(rows);
  const sg = v => `<span class="${cls(v)}">${rs(v)}</span>`;
  const cells = [["Net result", st.n ? sg(st.net) : "–"], ["Trades", `${st.n} <span class="muted">(${st.wins} W / ${st.losses} L)</span>`],
    ["Win rate", st.wr != null ? st.wr.toFixed(1) + "%" : "–"], ["Profit factor", st.pf == null ? "–" : st.pf === Infinity ? "∞" : st.pf.toFixed(2)],
    ["Average R", st.avgR != null ? `<span class="${cls(st.avgR)}">${st.avgR > 0 ? "+" : ""}${st.avgR.toFixed(2)}R</span>` : "–"], ["Expectancy / trade", st.exp != null ? sg(st.exp) : "–"],
    ["Avg win / loss", st.n ? `${st.avgW != null ? rs(st.avgW) : "–"} / ${st.avgL != null ? rs(st.avgL) : "–"}` : "–"], ["Charges", rs(st.fees)],
    ["Best / worst", st.n ? `${sg(st.best)} / ${sg(st.worst)}` : "–"], ["Max drawdown", st.n ? `<span class="${st.dd > 0 ? "down" : ""}">${rs(-st.dd)}</span>` : "–"],
    ["Streaks", st.n ? `${st.ws} W / ${st.ls} L` : "–"], ["Avg hold", durTxt(st.hold)]];
  pgq("#pgHStats").innerHTML = cells.map(([k, v]) => `<div class="pgc"><span>${k}</span><b>${v}</b></div>`).join("");
  // by contract / by exit
  const group = key => { const m = {}; for(const h of rows){ const k = key(h); (m[k] = m[k] || []).push(h); }
    return Object.entries(m).map(([k, a]) => [k, pgStats(a)]).sort((a, b) => b[1].net - a[1].net); };
  const gt = (sel, head, list) => { pgq(sel).innerHTML = list.length ? `<thead><tr><th>${head}</th><th class="r">Trades</th><th class="r">Win %</th><th class="r">Avg R</th><th class="r">Charges</th><th class="r">Net</th></tr></thead><tbody>`
    + list.map(([k, s]) => `<tr><td class="mono">${esc(k)}</td><td class="r">${s.n}</td><td class="r">${s.wr.toFixed(0)}%</td><td class="r">${s.avgR != null ? s.avgR.toFixed(2) + "R" : "–"}</td><td class="r mono">${rs(s.fees)}</td><td class="r mono">${sg(s.net)}</td></tr>`).join("") + `</tbody>`
    : `<tr><td class="empty">Nothing in this period.</td></tr>`; };
  gt("#pgBySym", "Contract", group(h => short(h.s)));
  gt("#pgByReason", "Exit", group(h => h.reason));
  // trades table (newest first); click a row for its charge breakdown
  pgq("#pgHN").textContent = rows.length ? `(${rows.length})` : "";
  const list = rows.slice().reverse();
  pgq("#pgHT").innerHTML = list.length ? `<thead><tr><th>Closed</th><th>Contract</th><th>Side</th><th class="r">Lots</th><th class="r">Entry</th><th class="r">Exit</th><th>Exit by</th>
      <th class="r">Held</th><th class="r">Gross</th><th class="r">Charges</th><th class="r">Net</th><th class="r">R</th><th class="r">Balance</th></tr></thead><tbody>`
    + list.map((h, i) => { const tk = tkOf(h.s);
      return `<tr class="hr" data-i="${i}"><td class="mono sm">${istTime(h.closed)}</td><td class="mono">${esc(short(h.s))}</td><td><b class="${h.side > 0 ? "up" : "down"}">${h.side > 0 ? "L" : "S"}</b></td>
      <td class="r">${h.lots}</td><td class="r mono">${fmt(h.avg, tk)}</td><td class="r mono">${fmt(h.exit, tk)}</td><td><span class="tag">${esc(h.reason)}</span>${h.src === "fyers" ? ' <span class="tag" title="Placed in Fyers (not from this app)">Fyers</span>' : ""}</td>
      <td class="r sm">${durTxt(h.closed - h.opened)}</td><td class="r mono">${rs(h.gross)}</td><td class="r mono">${rs(h.charges.total)}</td><td class="r mono"><b class="${cls(h.net)}">${rs(h.net)}</b></td>
      <td class="r mono">${h.r != null ? `<span class="${cls(h.r)}">${h.r > 0 ? "+" : ""}${h.r}R</span>` : "–"}</td><td class="r mono">${h.balance_after != null ? rs(h.balance_after) : "–"}</td></tr>`; }).join("") + `</tbody>`
    : `<tr><td class="empty">No closed trades in this period.</td></tr>`;
  pgq("#pgHT").querySelectorAll("tr.hr").forEach(tr => tr.onclick = () => {
    const nx = tr.nextElementSibling; if(nx && nx.classList.contains("hd")){ nx.remove(); return; }
    const h = list[+tr.dataset.i];
    const d = document.createElement("tr"); d.className = "hd";
    d.innerHTML = `<td colspan="13"><div class="pg-detail"><div class="breakdown">${breakdown(h.charges, "All charges, entry + exit")}
        <div><span>Gross P&L</span><span>${rs(h.gross)}</span></div><div class="tot"><span>Net P&L</span><span>${rs(h.net)}</span></div></div>
      <div class="breakdown"><div><span>Opened</span><span>${istTime(h.opened, {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit"})}</span></div>
        <div><span>Closed</span><span>${istTime(h.closed, {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit"})}</span></div>
        <div><span>Product</span><span>${esc(h.product)}</span></div><div><span>First SL / risk</span><span>${h.first_sl ?? "–"} / ${rs(h.init_risk)}</span></div>
        <div><span>Last SL / TP</span><span>${h.sl ?? "–"} / ${h.tp ?? "–"}</span></div><div><span>Best / worst price</span><span>${fmt(h.best)} / ${fmt(h.worst)}</span></div>
        ${(h.entries || []).length > 1 ? `<div><span>Entries</span><span>${h.entries.map(e => e.qty + " @ " + e.price).join(", ")}</span></div>` : ""}</div>
      ${typeof rpOpen === "function" ? `<div><button class="primary rp-open" title="The trade on its chart as recorded, the stop's path, ▶ Play">▶ On chart</button></div>` : ""}</div></td>`;
    tr.after(d);
    const rb = d.querySelector(".rp-open"); if(rb) rb.onclick = e => { e.stopPropagation(); rpOpen(rpKeyOf(h)); };
  });
  pgCurves(rows);
}
/* equity curve and daily P&L bars (Lightweight Charts, times in IST) */
function pgCurves(rows){
  const mk = (id, key) => {
    const el = pgq(id); if(!el) return null;
    if(PG[key] && PG[key].el === el) return PG[key];
    const c = LightweightCharts.createChart(el, {autoSize: true, layout: {background: {type: "solid", color: cssVar("--panel")}, textColor: cssVar("--muted"), fontFamily: "IBM Plex Mono"},
      grid: {vertLines: {visible: false}, horzLines: {color: cssVar("--line")}}, rightPriceScale: {borderColor: cssVar("--line")},
      timeScale: {borderColor: cssVar("--line"), timeVisible: key === "eq"}, handleScroll: false, handleScale: false, crosshair: {mode: 0}});
    return PG[key] = {el, c, s: null};
  };
  const E = mk("#pgEq", "eq"), Dy = mk("#pgDay", "day");
  if(E){
    if(!E.s) E.s = E.c.addSeries(LightweightCharts.AreaSeries, {lineColor: cssVar("--accent"), topColor: "rgba(79,140,255,.28)", bottomColor: "rgba(79,140,255,.02)", lineWidth: 2,
      priceFormat: {type: "price", precision: 0, minMove: 1}, lastValueVisible: true, priceLineVisible: false});
    let eq = 0, lastT = 0; const pts = [];
    for(const h of rows){ eq += h.net; let t = Math.round(h.closed) + 19800; if(t <= lastT) t = lastT + 1; lastT = t; pts.push({time: t, value: +eq.toFixed(2)}); }
    if(pts.length) pts.unshift({time: pts[0].time - 60, value: 0});
    E.s.setData(pts); E.c.timeScale().fitContent();
  }
  if(Dy){
    if(!Dy.s) Dy.s = Dy.c.addSeries(LightweightCharts.HistogramSeries, {priceFormat: {type: "price", precision: 0, minMove: 1}, lastValueVisible: false, priceLineVisible: false});
    const m = {}; for(const h of rows){ const d = istDay(h.closed); m[d] = (m[d] || 0) + h.net; }
    Dy.s.setData(Object.keys(m).sort().map(d => ({time: d, value: +m[d].toFixed(2), color: m[d] >= 0 ? cssVar("--up") : cssVar("--down")})));
    Dy.c.timeScale().fitContent();
  }
}
function pgHistCsv(){
  const rows = pgHistFilter(PG.hist || []);
  const cols = ["closed_ist", "opened_ist", "contract", "side", "product", "lots", "entry", "exit", "reason", "first_sl", "init_risk", "gross", "charges", "net", "r", "balance_after"];
  const q = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const t = ts => istTime(ts, {year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false});
  const lines = [cols.join(",")].concat(rows.map(h => [t(h.closed), t(h.opened), short(h.s), h.side > 0 ? "long" : "short", h.product, h.lots, h.avg, h.exit, h.reason,
    h.first_sl, h.init_risk, h.gross, h.charges.total, h.net, h.r, h.balance_after].map(q).join(",")));
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], {type: "text/csv"}));
  a.download = `paper-trades-${istDay(Date.now() / 1000)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ------------------------------------------------------------------ Book: several order books side by side */
function pgBookList(){
  const extra = (prefGet("bookSyms", []) || []).filter(s => typeof s === "string");
  return [...new Set([...(cur ? [cur.s] : []), ...extra])].slice(0, 4);
}
function pgBook(){
  const box = pgq("#pg_book"); if(!box) return;
  const list = pgBookList(), extra = prefGet("bookSyms", []) || [];
  const choices = [...new Set([...watch.map(w => w.s), ...(P.snap ? P.snap.positions.map(p => p.s) : [])])].filter(s => !list.includes(s));
  box.innerHTML = `<div class="pg-head"><h2>Order books</h2><span class="sp"></span>
      ${list.length < 4 && choices.length ? `<select id="pgBkAdd"><option value="">+ Add a book…</option>${choices.map(s => `<option value="${esc(s)}">${esc(short(s))}</option>`).join("")}</select>` : ""}</div>
    <p class="help" style="margin-top:0">The chart's contract first, then up to 3 more from your watchlist or open positions. Top 5 levels, as Fyers sends them.</p>
    <div class="pg-books">${list.map(s => `<div class="pg-book" data-s="${esc(s)}"><div class="bk-h"><a href="#" class="psym mono" data-open="${esc(s)}">${esc(short(s))}</a>
      ${cur && s === cur.s ? '<span class="tag">chart</span>' : `<button class="ghost sm" data-rm="${esc(s)}" title="Remove">✕</button>`}<span class="sp"></span><span class="muted sm" data-f="src"></span></div>
      <div data-f="body"><div class="empty">Waiting for the order book…</div></div></div>`).join("") || `<div class="empty">Open a chart, or add a contract to your watchlist.</div>`}</div>`;
  const add = pgq("#pgBkAdd"); if(add) add.onchange = () => { if(add.value){ prefSet("bookSyms", [...extra, add.value].slice(-3)); pgBook(); sendWant(); } };
  box.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { prefSet("bookSyms", extra.filter(s => s !== b.dataset.rm)); pgBook(); sendWant(); });
  box.querySelectorAll("[data-open]").forEach(a => a.onclick = e => { e.preventDefault(); pgShow("chart"); const r = sym[a.dataset.open]; if(r) openSymbol(r); else openBySymbol(a.dataset.open); });
  for(const s of list) if(PG.books[s]) pgBookDraw(PG.books[s]);
}
function pagesDepth(d){ PG.books[d.s] = d; if(PG.page === "book") pgBookDraw(d); }
function pagesTick(t){ if(PG.page === "book" && PG.books[t.s]) pgBookStats(t.s); }
function pgBookDraw(d){
  const card = pgq(`#pg_book .pg-book[data-s="${CSS.escape(d.s)}"]`); if(!card) return;
  const tk = tkOf(d.s), qs = [...d.bids, ...d.asks].map(r => +r[1] || 0), mx = Math.max(1, ...qs);
  const cell = (c, v, w) => `<div class="${c}">${w != null ? `<span class="bar" style="width:${Math.round(100 * w / mx)}%"></span>` : ""}<span style="position:relative">${v}</span></div>`;
  let rows = "";
  for(let i = 0; i < 5; i++){ const b = d.bids[i] || [], a = d.asks[i] || [];
    rows += `<div class="o">${b[2] ?? ""}</div>` + cell("q bq", b[1] != null ? (+b[1]).toLocaleString("en-IN") : "", +b[1] || 0)
      + `<div class="bp">${b[0] ? fmt(b[0], tk) : ""}</div><div class="ap">${a[0] ? fmt(a[0], tk) : ""}</div>`
      + cell("q aq", a[1] != null ? (+a[1]).toLocaleString("en-IN") : "", +a[1] || 0) + `<div class="o">${a[2] ?? ""}</div>`; }
  const b0 = (d.bids[0] || [])[0], a0 = (d.asks[0] || [])[0], spread = b0 && a0 ? Math.round((a0 - b0) / tk) : null;
  card.querySelector('[data-f="src"]').textContent = (d.src === "poll" ? "polled" : "live") + (spread != null ? ` · spread ${spread} tick${spread === 1 ? "" : "s"}` : "");
  card.querySelector('[data-f="body"]').innerHTML = `<div class="bk"><div class="hd o">Ord</div><div class="hd q">Bid qty</div><div class="hd q">Bid</div><div class="hd">Ask</div><div class="hd">Ask qty</div><div class="hd o">Ord</div>${rows}</div>
    <div data-f="tot"></div><div class="bk-stats" data-f="stats"></div>`;
  pgBookStats(d.s);
}
function pgBookStats(s){
  const card = pgq(`#pg_book .pg-book[data-s="${CSS.escape(s)}"]`); if(!card) return;
  const t = last[s] || {}, d = PG.books[s] || {}, tk = tkOf(s), tbq = d.tbq ?? t.tbq, tsq = d.tsq ?? t.tsq;
  const ratio = tbq != null && tsq != null && tbq + tsq > 0 ? tbq / (tbq + tsq) : null;
  const tot = card.querySelector('[data-f="tot"]'), st = card.querySelector('[data-f="stats"]'); if(!tot || !st) return;
  tot.innerHTML = ratio != null ? `<div class="bk-tot"><span class="up">Buy ${(+tbq).toLocaleString("en-IN")}</span><span class="muted">${Math.round(ratio * 100)}% / ${100 - Math.round(ratio * 100)}%</span><span class="down">Sell ${(+tsq).toLocaleString("en-IN")}</span></div>
    <div class="bk-ratio"><div style="width:${ratio * 100}%"></div></div>` : "";
  const ch = t.pc && t.ltp ? t.ltp - t.pc : null;
  st.innerHTML = [["LTP", fmt(t.ltp, tk)], ["Change", ch != null ? `<span class="${cls(ch)}">${ch > 0 ? "+" : ""}${fmt(ch, tk)} (${(100 * ch / t.pc).toFixed(2)}%)</span>` : "–"],
    ["Open", fmt(t.o, tk)], ["High", fmt(t.h, tk)], ["Low", fmt(t.l, tk)], ["Prev close", fmt(t.pc, tk)], ["Avg price", fmt(t.atp, tk)],
    ["Volume", t.vol != null ? (+t.vol).toLocaleString("en-IN") : "–"], ["Last qty", t.ltq ?? "–"]].map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join("");
}

/* ------------------------------------------------------------------ Account: the paper account, its rules and charges */
function pgAccount(){
  const box = pgq("#pg_account"); if(!box || !P.snap) return;
  const a = P.snap.acct, r = P.snap.rules, t = P.snap.trail;
  const an = ((S.accounts || []).find(x => x.id === ACCT) || {}).name || "Paper account", lv = a.kind === "live";
  box.innerHTML = `<div class="pg-head"><h2>${esc(an)}</h2><span class="tag">PAPER</span><span class="sp"></span></div>
    <div class="pg-cards" id="pgAcctCards2"></div>
    <div class="pg-cards">${[[lv ? "Account size (from Fyers)" : "Started with", rs(lv ? a.size : a.start)], ["Highest balance", rs(a.peak)], ["Daily floor", a.daily_floor != null ? rs(a.daily_floor) : "off"], ["Max-loss floor", a.max_floor != null ? `${rs(a.max_floor)} <span class="muted">(${esc(r.max_mode)})</span>` : "off"],
      ["Closed trades", a.trades], ["Net, all time", `<span class="${cls(a.net_total)}">${rs(a.net_total)}</span>`], ["Charges, all time", rs(a.charges_total)],
      ["Win rate / PF", `${a.win_rate != null ? a.win_rate + "%" : "–"} / ${a.pf ?? "–"}`]].map(([k, v]) => `<div class="pgc"><span>${k}</span><b>${v}</b></div>`).join("")}</div>
    <div class="pg-card" id="acctMgr"></div>
    <div class="pg-split">
      <div class="pg-card"><h3 class="pg-h3" style="margin-top:0">Rules</h3><p class="help">Checked before every order, as in LiveTrader.</p><div id="pgRules" class="pg-rules"></div>
        <div class="btns"><button class="primary" id="pgRulesSave">Save rules</button></div><div id="pgRulesMsg"></div></div>
      <div>
        <div class="pg-card"><h3 class="pg-h3" style="margin-top:0">Trailing defaults</h3><p class="help">For new trades. Changing them also changes every open trade.</p>
          <div class="trail"><span>Trail BE</span><input id="pgTrBeR" value="${t.be_r}"><button id="pgTrBe" class="${t.be_on ? "on" : ""}">${t.be_on ? "ON" : "off"}</button>
            <span>Trail SL</span><input id="pgTrSlR" value="${t.sl_r}"><button id="pgTrSl" class="${t.sl_on ? "on" : ""}">${t.sl_on ? "ON" : "off"}</button></div></div>
        <div class="pg-card"><h3 class="pg-h3" style="margin-top:0">Start again</h3><p class="help">Archives every trade on the server and starts a fresh account.</p>
          <div class="f2"><div><label>Capital (₹)</label><input id="pgRsCap" value="${r.size}" inputmode="decimal"></div><div><label>Type RESET</label><input id="pgRsConfirm" autocomplete="off"></div></div>
          <div class="btns"><button class="danger" id="pgRsGo">Reset paper account</button></div><div id="pgRsMsg"></div></div>
        <div class="pg-card" id="pgChargesCard"><div style="display:flex;align-items:center;gap:8px"><h3 class="pg-h3" style="margin:0;flex:1">Charges used</h3>
          <button class="sm admin-only" id="pgChEdit">Edit rates</button><button class="sm ghost admin-only" id="pgChCheck" title="Compare with Fyers' charges page now">Check Fyers' page</button></div>
          <div id="pgChWatch"></div><div id="pgChEditor" class="hide"></div><div id="pgCharges"></div></div>
      </div></div>`;
  pgAcctCards("#pgAcctCards2");
  renderRules("#pgRules");
  pgq("#pgRulesSave").onclick = () => saveRules("#pgRules", "#pgRulesMsg");
  pgq("#pgTrBe").onclick = () => papi("trail", {be_on: !P.snap.trail.be_on, be_r: num(pgq("#pgTrBeR").value) || 1}).then(() => pgAccount());
  pgq("#pgTrSl").onclick = () => papi("trail", {sl_on: !P.snap.trail.sl_on, sl_r: num(pgq("#pgTrSlR").value) || 1}).then(() => pgAccount());
  pgq("#pgTrBeR").onchange = () => papi("trail", {be_r: num(pgq("#pgTrBeR").value) || 1});
  pgq("#pgTrSlR").onchange = () => papi("trail", {sl_r: num(pgq("#pgTrSlR").value) || 1});
  pgq("#pgRsGo").onclick = async () => {
    const j = await papi("reset", {capital: num(pgq("#pgRsCap").value), confirm: pgq("#pgRsConfirm").value.trim()});
    pgq("#pgRsMsg").textContent = j.ok ? "Paper account reset. Old trades were archived on the server." : j.error; pgq("#pgRsMsg").className = j.ok ? "ok-msg" : "err";
    if(j.ok){ PG.hist = null; setTimeout(pgAccount, 600); }
  };
  loadCharges("#pgCharges");
  pgChargesEdit();
  acctRefresh().then(acctMgrRender);
}

/* ------------------------------------------------------------------ charges: your own edits, and the daily check of Fyers' page */
const CH_UNIT = {pct: [100, "%"], rs: [1, "₹"], cr: [1e7, "₹ / crore"]};
async function pgChargesEdit(j){
  j = j || await api("/api/charges"); if(!j.ok) return;
  PG.ch = j;
  pgChargeWatch(j.check);
  const ed = pgq("#pgChEditor"); if(!ed) return;
  const E = j.edit;
  ed.innerHTML = `<p class="help">Rates as fractions of the order value are typed in %, flat ones in ₹. Changes apply to every new calculation at once
      (charges already paid on open positions stay as they were). Values you've changed from the built-in ones are marked.</p>
    <div class="chx">${E.segments.map(sg => `<details class="chs"><summary>${esc(sg.label)}${sg.fields.some(f => Math.abs((f.value ?? 0) - (f.default ?? 0)) > 1e-15) ? ' <span class="tag warnc">edited</span>' : ""}</summary>
      ${sg.fields.map(f => { const [m, u] = CH_UNIT[f.unit]; const v = f.value == null ? "" : +(f.value * m).toPrecision(8), d = f.default == null ? "" : +(f.default * m).toPrecision(8);
        return `<label class="chr"><span>${esc(f.label)} <span class="muted">(${u})</span></span><input data-k="${esc(sg.key)}" data-f="${f.f}" data-m="${m}" value="${v}" inputmode="decimal" class="mono ${v !== d ? "chg" : ""}" title="Built-in: ${d}"></label>`; }).join("")}</details>`).join("")}</div>
    <label class="chr" style="margin-top:8px"><span>GST <span class="muted">(%)</span></span><input id="pgChGst" value="${+(E.gst * 100).toFixed(4)}" class="mono" inputmode="decimal"></label>
    <div class="btns"><button class="primary" id="pgChSave">Save rates</button><button id="pgChDefaults">Back to built-in rates</button></div><div id="pgChMsg"></div>`;
  pgq("#pgChEdit").onclick = () => { ed.classList.toggle("hide"); pgq("#pgChEdit").textContent = ed.classList.contains("hide") ? "Edit rates" : "Close editor"; };
  const save = async body => {
    const r = await stepUp(() => api("/api/charges/save", {body}));
    if(r.error === "cancelled") return;
    if(r.ok){ loadCharges("#pgCharges"); loadCharges(); const open = !ed.classList.contains("hide"); await pgChargesEdit(); if(open){ ed.classList.remove("hide"); pgq("#pgChEdit").textContent = "Close editor"; } }
    pgq("#pgChMsg").textContent = r.ok ? "Saved. Every figure now uses these rates." : r.error; pgq("#pgChMsg").className = r.ok ? "ok-msg" : "err";
  };
  pgq("#pgChSave").onclick = () => {
    const rates = {};
    for(const inp of ed.querySelectorAll("input[data-k]")){ if(inp.value.trim() === "") continue;
      const v = num(inp.value); if(v == null){ pgq("#pgChMsg").textContent = "Not a number: " + inp.value; pgq("#pgChMsg").className = "err"; return; }
      (rates[inp.dataset.k] = rates[inp.dataset.k] || {})[inp.dataset.f] = v / +inp.dataset.m; }
    save({rates, gst: (num(pgq("#pgChGst").value) ?? 18) / 100});
  };
  pgq("#pgChDefaults").onclick = () => { if(confirm("Go back to the built-in rates for every segment?")) save({rates: {}, gst: 0.18}); };
  pgq("#pgChCheck").onclick = async () => { pgq("#pgChCheck").textContent = "Checking…"; const r = await api("/api/charges/check", {body: {}}); pgq("#pgChCheck").textContent = "Check Fyers' page"; if(r.ok) pgChargeWatch(r.check); };
}
function pgChargeWatch(c){
  const el = pgq("#pgChWatch"); chargePill(c);
  if(!el || !c) return;
  const when = t => t ? istTime(t) : "never";
  if(c.changed){
    el.innerHTML = `<div class="chwarn"><b>Fyers' charges page has changed</b> since you last reviewed it (noticed ${when(c.changed_at)}).
      Check the lines below; if a rate changed, use <b>Edit rates</b>, then mark it reviewed.
      <div class="chdiff mono">${(c.diff || []).map(d => `<div class="${d[0] === "+" ? "up" : "down"}">${esc(d)}</div>`).join("") || "(no line-by-line detail)"}</div>
      <div class="btns"><a class="btnlink" href="${esc(c.url || "https://fyers.in/charges-list")}" target="_blank" rel="noopener">Open Fyers' page</a><button class="primary admin-only" id="pgChReviewed">Mark as reviewed</button></div></div>`;
    pgq("#pgChReviewed").onclick = async () => { const r = await api("/api/charges/reviewed", {body: {}}); if(r.ok) pgChargeWatch(r.check); };
  } else el.innerHTML = `<p class="help" style="margin:6px 0">Fyers' charges page is checked about once a day; last check ${when(c.checked)}${c.error ? ` <span class="warnc">(couldn't read it: ${esc(c.error)})</span>` : ", no change"}.
    A change is never applied by itself: you'll see what changed here and decide.</p>`;
}
/* a pill in the top bar while a change waits for review */
function chargePill(c){
  if(!document.body.classList.contains("is-admin")) c = null;      // only the admin reviews and edits charges
  let p = pgq("#pCharges");
  if(c && c.changed){
    if(!p){ p = document.createElement("button"); p.id = "pCharges"; p.className = "pill warnpill"; p.textContent = "Charges changed: review";
      p.onclick = () => { pgShow("account"); setTimeout(() => { const el = pgq("#pgChargesCard"); el && el.scrollIntoView({behavior: "smooth"}); }, 300); };
      const ref = pgq("header .spacer"); ref && ref.before(p); }
  } else if(p) p.remove();
}
async function chargesBoot(){ const j = await api("/api/charges"); if(j.ok) chargePill(j.check); }

/* ------------------------------------------------------------------ Log: the paper account's events and the helper's own log */
async function pgLog(reload){
  const box = pgq("#pg_log"); if(!box) return;
  if(!box.dataset.built){
    box.dataset.built = "1";
    box.innerHTML = `<div class="pg-head"><h2>Log</h2><span class="sp"></span>
        <div class="seg" id="pgLogF"><button data-f="all" class="on">Everything</button><button data-f="trades">Trades</button><button data-f="warn">Warnings</button><button data-f="system">System</button><button data-f="security">Security</button></div>
        <input id="pgLogQ" placeholder="Search…" autocomplete="off" style="width:200px"><button id="pgLogR" class="ghost" title="Refresh">↻</button></div>
      <div class="pg-card admin-only" id="pgFc"></div>
      <div class="tblw"><table class="tbl" id="pgLogT"></table></div>`;
    pgq("#pgLogF").querySelectorAll("button").forEach(b => b.onclick = () => { PG.logF = b.dataset.f; pgq("#pgLogF").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); pgLogRender(); });
    pgq("#pgLogQ").oninput = () => { PG.logQ = pgq("#pgLogQ").value.toLowerCase(); pgLogRender(); };
    pgq("#pgLogR").onclick = () => pgLog(true);
    clearInterval(PG.logTimer); PG.logTimer = setInterval(() => { if(PG.page === "log") pgLog(true); }, 10000);   // (and the order-flow check)
  }
  if(S.user && S.user.role === "admin") pgFeedCheck();
  if(reload || !PG.logs){
    const [e, l, sc] = await Promise.all([api("/api/paper/events"), api("/api/logs"), api("/api/security")]);
    PG.logs = [...(e.ok ? e.events.map(x => ({t: x.t, kind: "trades", lvl: x.lvl === "warn" ? "warn" : "info", src: "paper", msg: x.msg})) : []),
      ...(l.ok ? l.lines.filter(x => x.src !== "paper").map(x => ({t: x.t, kind: "system", lvl: /WARN|ERROR|CRIT/.test(x.lvl) ? "warn" : "info", src: x.src, msg: x.msg})) : []),
      ...(sc.ok ? sc.audit.map(x => ({t: x.t, kind: "security", lvl: /fail|wrong|locked|refused|disabled/i.test(x.event) ? "warn" : "info", src: "security",
        msg: x.event + (x.detail ? " - " + x.detail : "") + (x.ip ? " (" + x.ip + ")" : "")})) : [])].sort((a, b) => b.t - a.t);
  }
  pgLogRender();
}
/* the order-flow check (admin): does Fyers' feed deliver every trade? (helper/feedcheck.py) */
async function pgFeedCheck(day){
  const box = pgq("#pgFc"); if(!box) return;
  const j = await api("/api/feedcheck" + (day || PG.fcDay ? "?day=" + encodeURIComponent(day || PG.fcDay) : ""));
  if(!j.ok){ box.innerHTML = ""; return; }
  const c = j.config || {}, rows = Object.entries(j.symbols || {}), pct = v => v == null ? "–" : v.toFixed(1) + "%";
  const n = v => v == null ? "–" : Number(v).toLocaleString("en-IN");
  const line = (name, x, sub) => `<tr class="${sub ? "fcsub" : ""}"><td class="${sub ? "mono sm" : "mono"}">${esc(name)}</td><td class="r mono">${n(x.updates)}</td><td class="r mono">${x.per_sec ?? "–"}</td>
    <td class="r mono">${n(x.trade_updates)}</td><td class="r mono">${n(x.vol)}</td><td class="r mono"><b>${pct(x.exact_vol_pct)}</b></td><td class="r mono">${pct(x.known_vol_pct)}</td>
    <td class="r mono">${n(x.merged_updates)}</td><td class="r mono">${n(x.max_merge)}</td><td class="r mono">${n(x.gaps)}</td><td class="r mono">${n(x.odd_updates)}</td></tr>`;
  box.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><h3 class="pg-h3" style="margin:0;flex:1">Order-flow check: does Fyers' feed send every trade?</h3>
      <select id="fcDay" style="width:auto">${(j.days.length ? j.days : [j.day]).slice().reverse().map(d => `<option ${d === j.day ? "selected" : ""}>${d}</option>`).join("")}</select>
      <button class="sm" id="fcOn" style="white-space:nowrap">${c.on ? "Recording · stop" : "Stopped · start"}</button></div>
    <p class="help">Every price snapshot for these contracts is recorded on the server. When the day's volume grows by exactly the last trade's size, that snapshot is one trade, known exactly; when it grows by more, trades were merged and their prices are lost. A real footprint needs close to 100% exact.</p>
    <div class="tblw"><table class="tbl"><thead><tr><th>Contract / hour (IST)</th><th class="r">Snapshots</th><th class="r">Per second</th><th class="r">With trades</th><th class="r">Volume</th>
      <th class="r">Exact volume</th><th class="r">Price known</th><th class="r">Merged</th><th class="r">Largest merge</th><th class="r">Gaps &gt; 5 s</th><th class="r">Odd</th></tr></thead><tbody>
      ${rows.length ? rows.map(([s, x]) => line(s.replace(/^[A-Z]+:/, ""), x) + Object.entries(x.hours || {}).map(([h, y]) => line("  " + h + ":00", y, true)).join("")).join("")
        : `<tr><td colspan="11" class="empty">Nothing recorded ${j.day === undefined ? "" : "on " + esc(j.day)} yet: it starts when the contracts trade and you're logged in to Fyers.</td></tr>`}</tbody></table></div>
    <div class="f2" style="margin-top:8px"><div><label>Contracts recorded (up to 6, comma-separated)</label><input id="fcSyms" class="mono" value="${esc((c.symbols || []).join(", "))}"></div>
      <div style="align-self:end"><button class="sm" id="fcSave">Save contracts</button> <span id="fcMsg" class="muted sm"></span></div></div>`;
  pgq("#fcDay").onchange = e => { PG.fcDay = e.target.value; pgFeedCheck(); };
  pgq("#fcOn").onclick = async () => { await api("/api/feedcheck", {body: {on: !c.on}}); pgFeedCheck(); };
  pgq("#fcSave").onclick = async () => {
    const r = await api("/api/feedcheck", {body: {symbols: pgq("#fcSyms").value.split(/[,\s]+/).filter(Boolean)}});
    pgq("#fcMsg").textContent = r.ok ? "Saved" : r.error; if(r.ok) setTimeout(pgFeedCheck, 400);
  };
}
function pgLogRender(){
  const tb = pgq("#pgLogT"); if(!tb) return;
  const rows = (PG.logs || []).filter(x => (PG.logF === "all" || (PG.logF === "warn" ? x.lvl === "warn" : x.kind === PG.logF)) && (!PG.logQ || x.msg.toLowerCase().includes(PG.logQ)));
  tb.innerHTML = rows.length ? `<thead><tr><th>Time (IST)</th><th>From</th><th>Message</th></tr></thead><tbody>` + rows.slice(0, 800).map(x =>
    `<tr class="${x.lvl === "warn" ? "warnrow" : ""}"><td class="mono sm nw">${istTime(x.t, {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit"})}</td>
     <td class="sm"><span class="tag">${esc(x.src)}</span></td><td>${esc(x.msg)}</td></tr>`).join("") + `</tbody>` : `<tr><td class="empty">Nothing to show.</td></tr>`;
}
