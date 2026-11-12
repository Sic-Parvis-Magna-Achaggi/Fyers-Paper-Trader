/* Strategies that trade by themselves (v0.43.0, roadmap 23 stage a; helper/strategies.py).
   The Strategies page: each strategy as a card (on / off, its accounts, today's trades), the rules panel in plain words
   (no TradingView Properties tab), the tester (results net of every charge, in ₹ / $ and R), and the log.
   A Pine strategy() script from the Pine Editor gives the signals; the server runs it on each closed bar. */
"use strict";
const SG = {list: [], accounts: [], log: [], periods: [7, 30, 60, 90, 180, 365], loaded: false, runner: {}, logSid: "", wsHooked: false, timer: null};
const sgq = s => document.querySelector(s);
const sgEsc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const SG_TF = ["1m", "2m", "3m", "5m", "10m", "15m", "30m", "1h", "2h", "4h", "1D"];
const SG_CT = [["candles", "Candles"], ["ha", "Heikin-Ashi"], ["renko", "Renko"], ["range", "Range bars"], ["lb", "Line break"], ["pf", "Point & Figure"]];
const sgMoney = (n, ccy) => n == null || isNaN(n) ? "–" : (n < 0 ? "−" : n > 0 ? "+" : "") + (ccy && ccy !== "INR" ? "$" : "₹") +
  Math.abs(n).toLocaleString(ccy && ccy !== "INR" ? "en-US" : "en-IN", {maximumFractionDigits: 2});
const sgTime = t => new Date(t * 1000).toLocaleString("en-GB", {timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"});
const sgBarTime = t => new Date(t * 1000).toLocaleString("en-GB", {timeZone: "UTC", day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit"});
function sgIsStrategy(src){ return /^\s*strategy\s*\(/m.test(src || ""); }
function sgTitle(src){ const m = /^\s*strategy\s*\(\s*(?:title\s*=\s*)?(["'])(.*?)\1/m.exec(src || ""); return m ? m[2] : ""; }
function sgPlots(src){ const out = [], re = /\bplot\s*\([^\n]*?(?:title\s*=\s*)?["']([^"']+)["']/g; let m; while((m = re.exec(src || ""))) if(!out.includes(m[1])) out.push(m[1]); return out; }

async function sgLoad(){
  const j = await api("/api/strategies");
  if(!j.ok) return false;
  SG.list = j.strategies || []; SG.accounts = j.accounts || []; SG.log = j.log || []; SG.runner = j.runner || {}; SG.loaded = true;
  if(j.periods) SG.periods = j.periods;
  sgBadge(j.running || 0);
  return true;
}
function sgBadge(n){ const b = sgq("#nbStrats"); if(b){ b.textContent = n || ""; b.classList.toggle("hide", !n); } }
function sgAcctName(aid){ const a = SG.accounts.find(x => x.aid === aid); return a ? a.name : aid === "live" ? "Live" : String(aid).startsWith("mt5-") ? "MT5 " + aid.slice(4) : "an archived account"; }

/* ---------------------------------------------------------------- the page */
async function sgRender(){
  const el = sgq("#pg_strategies"); if(!el) return;
  if(!SG.loaded) el.innerHTML = `<div class="pg-head"><h2>Strategies</h2></div><p class="help">Loading…</p>`;
  if(!(await sgLoad())){ el.innerHTML = `<div class="pg-head"><h2>Strategies</h2></div><p class="help down">Strategies didn't load: try again.</p>`; return; }
  const running = SG.list.filter(s => s.status === "on").length;
  el.innerHTML = `<div class="pg-head"><h2>Strategies</h2><span class="sp"></span>
      ${running ? `<button class="danger" id="sgStopAll" title="Switch every strategy off now (their open trades stay, with their stops)">Stop all strategies (${running})</button>` : ""}
      <button class="primary" id="sgNew">+ New strategy</button></div>
    <p class="help">A strategy is a Pine <code>strategy()</code> script from the Pine Editor plus your rules: when its bar closes with a
      <code>strategy.entry</code>, the app places the trade on the accounts you switch on, sized by your risk, with a stop always,
      through the same rules and guards as a click. Every figure is net of all charges.</p>
    ${SG.runner && SG.runner.err ? `<p class="help down">${sgEsc(SG.runner.err)}</p>` : ""}
    <div id="sgCards">${SG.list.length ? SG.list.map(sgCard).join("") : `<div class="sgempty">No strategies yet. Write a <code>strategy()</code> script in the Pine Editor, then <b>+ New strategy</b>.</div>`}</div>
    <h3 class="pg-h3">Log <select id="sgLogSel" class="sgsel"><option value="">every strategy</option>${SG.list.map(s => `<option value="${s.id}" ${SG.logSid === s.id ? "selected" : ""}>${sgEsc(s.name)}</option>`).join("")}</select></h3>
    <div class="tblw"><table class="tbl sglog" id="sgLog"></table></div>`;
  sgLogRender();
  sgq("#sgNew").onclick = () => sgEdit(null);
  const sa = sgq("#sgStopAll");
  if(sa) sa.onclick = async () => { if(!sa.dataset.armed){ sa.dataset.armed = 1; sa.textContent = "Sure? Stop all"; setTimeout(() => { if(sa.isConnected){ delete sa.dataset.armed; sa.textContent = `Stop all strategies (${running})`; } }, 3000); return; }
    const j = await api("/api/strategies/stop_all", {body: {}}); toast(j.ok ? `${j.stopped} strateg${j.stopped === 1 ? "y" : "ies"} switched off` : j.error); sgRender(); };
  sgq("#sgLogSel").onchange = e => { SG.logSid = e.target.value; sgLogRender(); };
  el.querySelectorAll(".sgcard").forEach(c => {
    const s = SG.list.find(x => x.id === c.dataset.id); if(!s) return;
    c.querySelector('[data-a="onoff"]').onclick = () => sgOnOff(s);
    c.querySelector('[data-a="edit"]').onclick = () => sgEdit(s);
    c.querySelector('[data-a="test"]').onclick = () => sgTest(s);
    c.querySelector('[data-a="log"]').onclick = () => { SG.logSid = s.id; sgq("#sgLogSel").value = s.id; sgLogRender(); sgq("#sgLog").scrollIntoView({behavior: "smooth"}); };
    c.querySelector('[data-a="del"]').onclick = async e => { const b = e.currentTarget;
      if(!b.dataset.armed){ b.dataset.armed = 1; b.textContent = "Sure?"; setTimeout(() => { if(b.isConnected){ delete b.dataset.armed; b.textContent = "Delete"; } }, 3000); return; }
      const j = await api("/api/strategies/action", {body: {id: s.id, do: "delete"}}); if(!j.ok) toast(j.error); sgRender(); };
  });
}
function sgStopText(s){
  const st = s.stop || {}, k = st.k;
  const t = k === "script" ? "from the script" + (st.follow ? ", followed" : "") : k === "atr" ? `ATR ${st.len} × ${st.n}` : k === "points" ? `${st.n} points` :
    k === "line" ? `on the line "${sgEsc(st.line)}"` : `last ${st.len} bars' swing`;
  return t + (st.buf ? ` + ${st.buf} ticks` : "");
}
function sgCard(s){
  const on = s.status === "on";
  const accs = (s.accounts || []).map(a => { const t = (s.today || {})[a.aid];
    return `<span class="sgacc ${a.on ? "on" : ""} ${a.aid === "live" ? "live" : a.aid.startsWith("mt5-") ? "mt5" : ""}" title="${a.on ? "Trades on this account" : "Switched off for this account"}">
      ${sgEsc(sgAcctName(a.aid))}${a.on ? "" : " · off"}${t ? ` · today ${t.trades} trade${t.trades === 1 ? "" : "s"}${t.closed ? `, ${sgMoney(t.net, t.ccy)} (${t.r >= 0 ? "+" : ""}${t.r}R)` : ""}` : ""}</span>`; }).join("");
  const tg = s.target || {}, L = s.lim || {};
  const lim = [L.max_day ? `${L.max_day} trades a day` : "", L.max_open ? `${L.max_open} open at once` : "",
    L.loss_day ? `stops for the day at −${L.loss_unit === "r" ? L.loss_day + "R" : sgMoney(L.loss_day).replace(/^[+]/, "")}` : "",
    L.from && L.to ? `${L.from}-${L.to} IST` : "", L.cutoff ? `no new trades ${L.cutoff} min before the close` : "", L.skip_expiry ? "skips expiry days" : ""].filter(Boolean);
  return `<div class="sgcard ${on ? "on" : ""}" data-id="${s.id}">
    <div class="sgh"><span class="sgst ${on ? "on" : s.err ? "err" : ""}">${on ? "ON" : s.err ? "OFF · error" : "OFF"}</span><b>${sgEsc(s.name)}</b>
      <span class="muted">${sgEsc(s.src.name || sgTitle(s.src.code) || "Pine strategy")} · ${(s.syms || []).map(x => sgEsc(x.split(":").pop())).join(", ")} · ${sgEsc(s.tf)}
        ${s.ctype && s.ctype.type !== "candles" ? " · " + sgEsc((SG_CT.find(x => x[0] === s.ctype.type) || [0, s.ctype.type])[1]) : ""}
        · ${s.side === "long" ? "long only" : s.side === "short" ? "short only" : "long and short"}</span><span class="sp"></span>
      <button data-a="onoff" class="${on ? "" : "primary"}">${on ? "Switch off" : "Switch on"}</button><button data-a="edit">Edit</button><button data-a="test">Test</button>
      <button data-a="log" class="ghost">Log</button><button data-a="del" class="ghost">Delete</button></div>
    ${s.err ? `<div class="down sgerr">${sgEsc(s.err)}</div>` : s.note ? `<div class="warnc sgerr">${sgEsc(s.note)}</div>` : ""}
    <div class="sgaccs">${accs || `<span class="muted">No accounts picked</span>`}</div>
    <div class="sgrules muted">Size: ${s.size.mode === "pct" ? s.size.v + "% risk" : s.size.mode === "amt" ? sgMoney(s.size.v).replace(/^[+]/, "") + " risk" : s.size.v + (s.size.v === 1 ? " lot" : " lots")}
      · Stop: ${sgStopText(s)} · Target: ${tg.k === "r" ? tg.r + "R" : tg.k === "script" ? "from the script" : "none"}
      ${s.be && s.be.on ? ` · BE at ${s.be.r}R` : ""}${s.trail && s.trail.on ? ` · trail from ${s.trail.r}R` : ""}${lim.length ? " · " + lim.join(" · ") : ""}
      ${(s.open || []).length ? ` · <b>${s.open.length} open</b>` : ""}</div></div>`;
}
function sgLogRender(){
  const t = sgq("#sgLog"); if(!t) return;
  const rows = SG.log.filter(e => !SG.logSid || e.sid === SG.logSid).slice(0, 150);
  t.innerHTML = rows.length ? `<thead><tr><th>Time</th><th>Strategy</th><th>Account</th><th>Contract</th><th>What happened</th></tr></thead><tbody>` +
    rows.map(e => `<tr class="k-${e.kind}"><td class="mono sm nw">${sgTime(e.t)}</td><td>${sgEsc(e.name)}</td><td>${e.aid ? sgEsc(sgAcctName(e.aid)) : ""}</td>
      <td class="mono sm">${sgEsc((e.s || "").split(":").pop())}</td><td>${sgEsc(e.msg)}</td></tr>`).join("") + "</tbody>"
    : `<tr><td class="empty">Nothing yet. Each signal and what the app did with it on each account shows here.</td></tr>`;
}
async function sgOnOff(s){
  const doOn = s.status !== "on";
  const j = await stepUp(() => api("/api/strategies/action", {body: {id: s.id, do: doOn ? "on" : "off"}}));
  if(!j.ok){ if(j.error !== "cancelled") toast(j.error); return; }
  toast(doOn ? `${s.name}: on - it trades from the next bar that closes` : `${s.name}: off (its open trades stay, with their stops)`);
  sgRender();
}

/* ---------------------------------------------------------------- the rules panel */
function sgDefault(){
  const paper = SG.accounts.find(a => a.mode === "paper");
  return {name: "", src: {k: "pine", code: "", name: "", sid: "", inputs: {}}, syms: cur ? [cur.s] : [], tf: typeof tf !== "undefined" && SG_TF.includes(tf) ? tf : "5m",
    ctype: {type: "candles", opts: {}}, side: "both", accounts: paper ? [{aid: paper.aid, on: true}] : [], size: {mode: "pct", v: 0.5}, product: "INTRADAY",
    stop: {k: "atr", n: 2, len: 14, line: "", buf: 0, follow: true}, target: {k: "r", r: 2}, be: {on: true, r: 1}, trail: {on: false, r: 2},
    lim: {max_day: 3, max_open: 1, loss_day: 2, loss_unit: "r", from: "", to: "", cutoff: 10, skip_expiry: true}, tg: true};
}
async function sgEdit(s){
  if(!SG.loaded) await sgLoad();
  if(typeof pineLoad === "function") await pineLoad();
  const scripts = (typeof PINE !== "undefined" ? PINE.scripts : []).filter(x => sgIsStrategy(x.source));
  const st = JSON.parse(JSON.stringify(s ? {...sgDefault(), ...s, src: {...s.src}} : sgDefault()));
  let m = sgq("#sgDlg");
  if(!m){ m = document.createElement("div"); m.id = "sgDlg"; document.body.append(m); }
  m.className = "modalwrap";
  const isMt = () => (st.syms[0] || "").startsWith("MT5:");
  const opt = (v, cur_, label) => `<option value="${sgEsc(v)}" ${String(cur_) === String(v) ? "selected" : ""}>${sgEsc(label)}</option>`;
  const draw = () => {
    const mt = isMt();
    const accs = SG.accounts.filter(a => (a.mode === "mt5") === mt);
    const plots = sgPlots(st.src.code);
    const scriptOpts = scripts.map(x => opt(x.id, st.src.sid, x.name + (sgTitle(x.source) && sgTitle(x.source) !== x.name ? ` (${sgTitle(x.source)})` : ""))).join("");
    const stale = st.src.sid && scripts.find(x => x.id === st.src.sid && x.source !== st.src.code);
    m.innerHTML = `<div class="ca sgdlg"><div class="cadh"><b>${s ? "Edit strategy" : "New strategy"}</b><span class="sp"></span><button class="ghost" data-x>✕</button></div>
      <div class="sgdb">
        <label>Name<input id="sgName" value="${sgEsc(st.name)}" maxlength="60" placeholder="e.g. Crude ORB"></label>
        <div class="sgsec">1 · Signals</div>
        <label>Pine strategy script <select id="sgScript"><option value="">${scripts.length ? "pick one…" : "no strategy() scripts in your Pine Editor yet"}</option>${scriptOpts}
          ${st.src.code && !scripts.find(x => x.id === st.src.sid) ? opt("__kept", "__kept", (st.src.name || "the saved copy") + " (saved copy)") : ""}</select></label>
        ${stale ? `<p class="help warnc">The script changed in the Pine Editor since this strategy was saved: it keeps its own copy until you <a href="#" id="sgReload">take the new version</a>.</p>` : ""}
        <p class="help">Its <code>strategy.entry</code> opens a trade, <code>strategy.close</code> / <code>close_all</code> closes it, <code>strategy.exit(stop = …, limit = …)</code> can give the stop and target.
          The script's own settings (capital, order size, pyramiding, commission…) aren't used: the rules below decide. Inputs: the script's defaults.</p>
        <div class="sgsec">2 · What it trades</div>
        <label>Contracts <span class="muted">(up to 10${mt ? ", MT5 symbols" : ""})</span></label>
        <div class="sgsyms">${st.syms.map((x, i) => `<span class="tag">${sgEsc(x.split(":").pop())} <a href="#" data-rm="${i}">✕</a></span>`).join("")}
          <input id="sgSymQ" placeholder="add a contract: type to search" autocomplete="off"><div id="sgSymHits" class="sghits hide"></div></div>
        <div class="sgrow"><label>Timeframe <select id="sgTf">${SG_TF.map(t => opt(t, st.tf, t)).join("")}${SG_TF.includes(st.tf) ? "" : opt(st.tf, st.tf, st.tf)}</select></label>
          <label>Chart type <select id="sgCt">${SG_CT.map(([v, n]) => opt(v, st.ctype.type, n)).join("")}</select></label>
          <label>Direction <select id="sgSide">${opt("both", st.side, "Long and short")}${opt("long", st.side, "Long only")}${opt("short", st.side, "Short only")}</select></label></div>
        <p class="help">It acts when a bar closes, like TradingView's default. Renko, range and P&F bricks use ATR box sizes.</p>
        <div class="sgsec">3 · Accounts</div>
        <div class="sgaccl">${accs.length ? accs.map(a => { const x = st.accounts.find(y => y.aid === a.aid);
          return `<label class="cachk"><input type="checkbox" data-acc="${a.aid}" ${x && x.on ? "checked" : ""}> ${sgEsc(a.name)}
            ${a.mode === "live" ? `<span class="tag live">LIVE · real money</span>` : a.mode === "mt5" ? `<span class="tag tag-mt5">MT5</span>` : ""}</label>`; }).join("")
          : `<p class="help">${mt ? "No MT5 account is connected." : "No accounts."}</p>`}</div>
        ${accs.some(a => a.mode !== "paper") ? `<p class="help">Live and MT5 ask for your 2FA code when switched on. Every order goes through that account's own rules, guards and lockouts.${mt ? " FundingPips: get their written OK for strategies through your own EA first." : ""}</p>` : ""}
        <div class="sgsec">4 · Size</div>
        <div class="sgrow"><label>Size by <select id="sgSizeM">${opt("pct", st.size.mode, "Risk % of the account")}${opt("amt", st.size.mode, "Risk amount")}${opt("lots", st.size.mode, mt ? "Fixed lots (0.01 steps)" : "Fixed lots")}</select></label>
          <label>${st.size.mode === "pct" ? "Risk %" : st.size.mode === "amt" ? `Risk (${mt ? "$" : "₹"})` : "Lots"}<input id="sgSizeV" inputmode="decimal" value="${st.size.v}"></label>
          ${mt ? "" : `<label>Product <select id="sgProd">${opt("INTRADAY", st.product, "Intraday")}${opt("MARGIN", st.product, "Carry (NRML)")}${opt("CNC", st.product, "Delivery (stocks)")}</select></label>`}</div>
        <div class="sgsec">5 · Stop loss <span class="muted">(always: no stop, no trade)</span></div>
        <div class="sgrow"><label>Stop <select id="sgStopK">${opt("atr", st.stop.k, "ATR × n")}${opt("points", st.stop.k, "Points from the entry")}${opt("swing", st.stop.k, "Last swing low / high")}
            ${opt("line", st.stop.k, "A line of the script (plot)")}${opt("script", st.stop.k, "From the script (strategy.exit stop)")}</select></label>
          ${st.stop.k === "atr" ? `<label>ATR length<input id="sgStopLen" inputmode="numeric" value="${st.stop.len}"></label><label>× n<input id="sgStopN" inputmode="decimal" value="${st.stop.n}"></label>` : ""}
          ${st.stop.k === "points" ? `<label>Points<input id="sgStopN" inputmode="decimal" value="${st.stop.n}"></label>` : ""}
          ${st.stop.k === "swing" ? `<label>Bars back<input id="sgStopLen" inputmode="numeric" value="${st.stop.len}"></label>` : ""}
          ${st.stop.k === "line" ? `<label>Plot <select id="sgStopLine">${plots.map(p => opt(p, st.stop.line, p)).join("") || `<option value="">no titled plot() in the script</option>`}</select></label>` : ""}
          <label>+ ticks<input id="sgStopBuf" inputmode="numeric" value="${st.stop.buf}"></label></div>
        ${st.stop.k === "script" ? `<label class="cachk"><input type="checkbox" id="sgFollow" ${st.stop.follow ? "checked" : ""}> Move the stop when the script moves its stop (only ever tighter)</label>` : ""}
        <div class="sgsec">6 · Target and management</div>
        <div class="sgrow"><label>Target <select id="sgTgtK">${opt("r", st.target.k, "R multiple (net)")}${opt("script", st.target.k, "From the script (strategy.exit limit)")}${opt("none", st.target.k, "None: exit by signal / stop")}</select></label>
          ${st.target.k === "r" ? `<label>R<input id="sgTgtR" inputmode="decimal" value="${st.target.r}"></label>` : ""}</div>
        <div class="sgrow"><label class="cachk"><input type="checkbox" id="sgBeOn" ${st.be.on ? "checked" : ""}> Stop to break-even + costs at</label><label class="sgnarrow"><input id="sgBeR" inputmode="decimal" value="${st.be.r}"></label><span class="muted">R</span></div>
        <div class="sgrow"><label class="cachk"><input type="checkbox" id="sgTrOn" ${st.trail.on ? "checked" : ""}> Trail the stop from</label><label class="sgnarrow"><input id="sgTrR" inputmode="decimal" value="${st.trail.r}"></label><span class="muted">R (it never goes below BE or backwards)</span></div>
        <div class="sgsec">7 · Limits for this strategy <span class="muted">(0 or empty = none; the account's own rules apply as well)</span></div>
        <div class="sgrow"><label>Trades a day<input id="sgMaxDay" inputmode="numeric" value="${st.lim.max_day || 0}"></label>
          <label>Open at once<input id="sgMaxOpen" inputmode="numeric" value="${st.lim.max_open || 0}"></label>
          <label>Stop for the day after losing<input id="sgLoss" inputmode="decimal" value="${st.lim.loss_day || 0}"></label>
          <label>&nbsp;<select id="sgLossU">${opt("r", st.lim.loss_unit, "R")}${opt("amt", st.lim.loss_unit, mt ? "$" : "₹")}</select></label></div>
        <div class="sgrow"><label>Trade from (IST)<input id="sgFrom" placeholder="09:20" value="${sgEsc(st.lim.from)}"></label><label>until<input id="sgTo" placeholder="15:00" value="${sgEsc(st.lim.to)}"></label>
          <label>No new trades this many min before the ${mt ? "day-end close" : "square-off"}<input id="sgCut" inputmode="numeric" value="${st.lim.cutoff || 0}"></label></div>
        ${mt ? "" : `<label class="cachk"><input type="checkbox" id="sgExp" ${st.lim.skip_expiry ? "checked" : ""}> Don't open trades on the contract's expiry day</label>`}
        <label class="cachk"><input type="checkbox" id="sgTg" ${st.tg ? "checked" : ""}> Telegram on each trade (Settings › Telegram alerts)</label>
        <div class="err" id="sgErr"></div>
      </div>
      <div class="btns"><button id="sgTestB">Test</button><button class="primary" id="sgSave">Save</button>${s && s.status === "on" ? "" : `<button class="primary" id="sgSaveOn">Save and switch on</button>`}<button class="ghost" data-x>Cancel</button></div></div>`;
    m.querySelectorAll("[data-x]").forEach(b => b.onclick = () => m.classList.add("hide"));
    wire();
  };
  const read = () => {
    const v = id => { const e = m.querySelector("#" + id); return e ? e.value : undefined; };
    const c = id => { const e = m.querySelector("#" + id); return e ? e.checked : undefined; };
    st.name = v("sgName") || "";
    st.tf = v("sgTf") || st.tf; st.ctype = {type: v("sgCt") || "candles", opts: {}}; st.side = v("sgSide") || "both";
    const shown = [...m.querySelectorAll("[data-acc]")];
    if(shown.length) st.accounts = shown.filter(e => e.checked).map(e => ({aid: e.dataset.acc, on: true}));   // (the ticked ones)
    st.size = {mode: v("sgSizeM") || "pct", v: parseFloat(v("sgSizeV")) || 0};
    if(v("sgProd")) st.product = v("sgProd");
    st.stop = {...st.stop, k: v("sgStopK") || st.stop.k};
    if(v("sgStopLen") !== undefined) st.stop.len = parseInt(v("sgStopLen")) || 14;
    if(v("sgStopN") !== undefined) st.stop.n = parseFloat(v("sgStopN")) || 0;
    if(v("sgStopLine") !== undefined) st.stop.line = v("sgStopLine");
    st.stop.buf = parseInt(v("sgStopBuf")) || 0;
    if(c("sgFollow") !== undefined) st.stop.follow = c("sgFollow");
    st.target = {...st.target, k: v("sgTgtK") || st.target.k}; if(v("sgTgtR") !== undefined) st.target.r = parseFloat(v("sgTgtR")) || 2;
    st.be = {on: !!c("sgBeOn"), r: parseFloat(v("sgBeR")) || 1}; st.trail = {on: !!c("sgTrOn"), r: parseFloat(v("sgTrR")) || 2};
    st.lim = {max_day: parseInt(v("sgMaxDay")) || 0, max_open: parseInt(v("sgMaxOpen")) || 0, loss_day: parseFloat(v("sgLoss")) || 0, loss_unit: v("sgLossU") || "r",
      from: (v("sgFrom") || "").trim(), to: (v("sgTo") || "").trim(), cutoff: parseInt(v("sgCut")) || 0, skip_expiry: c("sgExp") === undefined ? !!st.lim.skip_expiry : !!c("sgExp")};
    st.tg = !!c("sgTg");
  };
  const setScript = async id => {
    const x = scripts.find(y => y.id === id); if(!x) return;
    const L = typeof pineLibs === "function" ? await pineLibs(x.source) : {libs: {}, missing: []};
    st.src = {k: "pine", sid: x.id, name: x.name, code: x.source, inputs: {}, libs: L.libs, missing: L.missing};
    if(!st.name) st.name = sgTitle(x.source) || x.name;
  };
  const wire = () => {
    const redraw = () => { read(); draw(); };
    for(const id of ["sgTf", "sgCt", "sgSide", "sgSizeM", "sgStopK", "sgTgtK"]) { const e = m.querySelector("#" + id); if(e) e.onchange = redraw; }
    const sc = m.querySelector("#sgScript"); sc.onchange = async () => { read(); if(sc.value && sc.value !== "__kept") await setScript(sc.value); draw(); };
    const rl = m.querySelector("#sgReload"); if(rl) rl.onclick = async e => { e.preventDefault(); read(); await setScript(st.src.sid); draw(); toast("The new version of the script is taken (save to keep it)"); };
    m.querySelectorAll("[data-rm]").forEach(a => a.onclick = e => { e.preventDefault(); read(); st.syms.splice(+a.dataset.rm, 1); draw(); });
    const q = m.querySelector("#sgSymQ"), hits = m.querySelector("#sgSymHits");
    let qt = null;
    q.oninput = () => { clearTimeout(qt); const t = q.value.trim(); if(t.length < 2){ hits.classList.add("hide"); return; }
      qt = setTimeout(async () => { const j = await api(`/api/symbols?q=${encodeURIComponent(t)}`); const rows = (j.rows || j.symbols || []).slice(0, 12);
        hits.innerHTML = rows.map(r => `<button data-s="${sgEsc(r.s)}">${sgEsc(r.s.split(":").pop())} <span class="muted">${sgEsc(r.d || "")}</span></button>`).join("") || `<div class="muted">nothing found</div>`;
        hits.classList.remove("hide");
        hits.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { read(); if(!st.syms.includes(b.dataset.s) && st.syms.length < 10) st.syms.push(b.dataset.s);
          if(st.syms.length > 1 && st.syms.some(x => x.startsWith("MT5:")) !== st.syms.every(x => x.startsWith("MT5:"))){ st.syms.pop(); toast("MT5 symbols and Fyers contracts can't be mixed in one strategy"); }
          draw(); setTimeout(() => { const q2 = m.querySelector("#sgSymQ"); if(q2) q2.focus(); }, 0); }); }, 250); };
    const body = () => ({...st, id: s ? s.id : undefined});
    const save = async on => {
      read();
      const err = m.querySelector("#sgErr"); err.textContent = "";
      const j = await stepUp(() => api("/api/strategies/save", {body: {strategy: body()}}));
      if(!j.ok){ if(j.error !== "cancelled") err.textContent = j.error; return; }
      if(on){ const k = await stepUp(() => api("/api/strategies/action", {body: {id: j.strategy.id, do: "on"}})); if(!k.ok && k.error !== "cancelled"){ err.textContent = k.error; return; } }
      m.classList.add("hide"); toast(on ? `${j.strategy.name}: saved and on - it trades from the next bar that closes` : `${j.strategy.name}: saved`);
      if(PG.page !== "strategies") pgShow("strategies"); else sgRender();
    };
    m.querySelector("#sgSave").onclick = () => save(false);
    const so = m.querySelector("#sgSaveOn"); if(so) so.onclick = () => save(true);
    m.querySelector("#sgTestB").onclick = () => { read(); sgTest(body()); };
  };
  if(!s && scripts.length === 1) await setScript(scripts[0].id);
  draw();
}

/* ---------------------------------------------------------------- the tester */
async function sgTest(s){
  let m = sgq("#sgTestDlg");
  if(!m){ m = document.createElement("div"); m.id = "sgTestDlg"; document.body.append(m); }
  m.className = "modalwrap";
  const mt = (s.syms[0] || "").startsWith("MT5:");
  const acc = (s.accounts || []).map(a => SG.accounts.find(x => x.aid === a.aid)).find(Boolean);
  const T = SG.testOpt || {days: 60, sym: s.syms[0], capital: ""};
  if(!s.syms.includes(T.sym)) T.sym = s.syms[0];
  m.innerHTML = `<div class="ca sgdlg sgtest"><div class="cadh"><b>Test: ${sgEsc(s.name || "strategy")}</b><span class="sp"></span><button class="ghost" data-x>✕</button></div>
    <div class="sgdb"><div class="sgrow">
      <label>Contract <select id="stSym">${s.syms.map(x => `<option ${x === T.sym ? "selected" : ""}>${sgEsc(x)}</option>`).join("")}</select></label>
      <label>Period <select id="stDays">${SG.periods.map(d => `<option value="${d}" ${d === T.days ? "selected" : ""}>last ${d} days</option>`).join("")}</select></label>
      <label>Starting capital<input id="stCap" inputmode="decimal" placeholder="the account's size" value="${sgEsc(T.capital)}"></label>
      <label>&nbsp;<button class="primary" id="stRun">Run</button></label></div>
      <p class="help">The same script and rules over the saved candles: market fills at the next bar's open, stops and targets when a bar's range reaches them
        (a gap fills at the open; stop first if both in one bar), sized and counted net of every charge${acc ? ` (${sgEsc(acc.name)}'s rates)` : ""}. Long periods on low timeframes
        use Fyers' data budget${mt ? " (MT5: as much as MT5 holds)" : ""}.</p>
      <div id="stOut"></div></div>
    <div class="btns"><button class="ghost" data-x>Close</button></div></div>`;
  m.querySelectorAll("[data-x]").forEach(b => b.onclick = () => m.classList.add("hide"));
  m.querySelector("#stRun").onclick = async () => {
    const out = m.querySelector("#stOut"), b = m.querySelector("#stRun");
    T.sym = m.querySelector("#stSym").value; T.days = +m.querySelector("#stDays").value; T.capital = m.querySelector("#stCap").value; SG.testOpt = T;
    b.disabled = true; out.innerHTML = `<p class="help">Running… (loading the candles can take a while the first time)</p>`;
    const j = await api("/api/strategies/test", {body: {strategy: s, sym: T.sym, days: T.days, capital: parseFloat(T.capital) || null}});
    b.disabled = false;
    if(!j.ok){ out.innerHTML = `<p class="down">${sgEsc(j.error)}</p>`; return; }
    out.innerHTML = sgResult(j.result);
  };
}
function sgResult(r){
  const s = r.st, c = r.ccy, M = n => sgMoney(n, c);
  const card = (k, v, t) => `<div class="pgc" title="${sgEsc(t || "")}"><span>${k}</span><b>${v}</b></div>`;
  const cards = [card("Trades", `${s.n} <span class="muted">(${s.wins} W / ${s.losses} L)</span>`), card("Win rate", s.win_rate == null ? "–" : s.win_rate + "%"),
    card("Net (after all charges)", `<span class="${s.net > 0 ? "up" : s.net < 0 ? "down" : ""}">${M(s.net)}</span> <span class="muted">${s.net_pct == null ? "" : (s.net_pct >= 0 ? "+" : "") + s.net_pct + "%"}</span>`),
    card("Expectancy", s.exp_r == null ? "–" : (s.exp_r >= 0 ? "+" : "") + s.exp_r + "R", "Average result per trade, in units of its net risk at the first stop"),
    card("Total R", s.sum_r == null ? "–" : (s.sum_r >= 0 ? "+" : "") + s.sum_r + "R"), card("Profit factor", s.pf == null ? "–" : s.pf, "Gross wins ÷ gross losses, net of charges"),
    card("Max drawdown", `${M(-s.max_dd)} <span class="muted">${s.max_dd_pct}%</span>`), card("Charges", M(-s.charges).replace(/^[−+]/, "")),
    card("Avg win / loss", `${M(s.avg_win)} / ${M(s.avg_loss)}`), card("Worst losing streak", s.loss_streak)].join("");
  const curve = sgCurve(r.curve, r.capital);
  const sk = Object.entries(r.skipped || {});
  const months = (r.months || []).map(x => `<tr><td class="mono">${x.m}</td><td class="r">${x.n}</td><td class="r">${x.n ? Math.round(100 * x.wins / x.n) : 0}%</td>
    <td class="r mono ${x.net > 0 ? "up" : x.net < 0 ? "down" : ""}">${M(x.net)}</td><td class="r mono">${x.r >= 0 ? "+" : ""}${x.r}R</td></tr>`).join("");
  const trades = (r.trades || []).slice(-300).reverse().map(x => `<tr><td class="mono sm nw">${sgBarTime(x.in_t)}</td><td><b class="${x.side > 0 ? "up" : "down"}">${x.side > 0 ? "LONG" : "SHORT"}</b></td>
    <td class="r mono">${x.lots}</td><td class="r mono">${x.in}</td><td class="r mono">${x.sl ?? "–"}</td><td class="r mono">${x.out}</td><td class="mono sm nw">${sgBarTime(x.out_t)}</td>
    <td>${sgEsc(x.why)}</td><td class="r mono ${x.net > 0 ? "up" : x.net < 0 ? "down" : ""}">${M(x.net)}</td><td class="r mono">${x.r == null ? "–" : (x.r >= 0 ? "+" : "") + x.r + "R"}</td></tr>`).join("");
  return `<p class="help">${sgEsc(r.sym)} · ${sgEsc(r.tf)} · ${r.bars} bars (${r.first ? sgBarTime(r.first) : ""} – ${r.last ? sgBarTime(r.last) : ""}) · charges from ${sgEsc(r.acct)} · starting ${M(r.capital).replace(/^[+]/, "")}</p>
    <div class="pg-cards">${cards}</div>${curve}
    ${sk.length ? `<p class="help">Signals not taken: ${sk.map(([k, n]) => `${n} × ${sgEsc(k)}`).join(" · ")}</p>` : ""}
    ${months ? `<h3 class="pg-h3">By month</h3><div class="tblw"><table class="tbl"><thead><tr><th>Month</th><th class="r">Trades</th><th class="r">Win</th><th class="r">Net</th><th class="r">R</th></tr></thead><tbody>${months}</tbody></table></div>` : ""}
    <h3 class="pg-h3">Trades <span class="muted">(newest first${r.trades.length > 300 ? ", the last 300" : ""}; times as the chart shows them)</span></h3>
    <div class="tblw"><table class="tbl"><thead><tr><th>In</th><th>Side</th><th class="r">Lots</th><th class="r">Entry</th><th class="r">Stop</th><th class="r">Exit</th><th>Out</th><th>Why</th><th class="r">Net</th><th class="r">R</th></tr></thead>
    <tbody>${trades || `<tr><td class="empty" colspan="10">No trades in this period.</td></tr>`}</tbody></table></div>`;
}
function sgCurve(pts, start){
  if(!pts || pts.length < 2) return "";
  const W = 760, H = 160, P = 6, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys, start), y1 = Math.max(...ys, start);
  const X = x => P + (x1 > x0 ? (x - x0) / (x1 - x0) : 0) * (W - 2 * P), Y = y => H - P - (y1 > y0 ? (y - y0) / (y1 - y0) : 0.5) * (H - 2 * P);
  const d = pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join(" ");
  const end = ys[ys.length - 1];
  return `<div class="sgcurve"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Equity curve">
    <line x1="${P}" x2="${W - P}" y1="${Y(start)}" y2="${Y(start)}" class="base"/><path d="${d}" class="${end >= start ? "up" : "down"}"/></svg><span class="muted">Balance after each trade</span></div>`;
}

/* ---------------------------------------------------------------- live updates and hooks into the page */
function sgWsHook(){
  if(typeof ws === "undefined" || !ws || ws._sg) return;
  const om = ws.onmessage;
  ws.onmessage = ev => {
    om(ev);
    if(typeof ev.data === "string" && (ev.data.indexOf('"strat_log"') >= 0 || ev.data.indexOf('"strats_changed"') >= 0)){
      try{
        const m = JSON.parse(ev.data);
        if(m.strat_log){ SG.log.unshift(m.strat_log); SG.log.length = Math.min(SG.log.length, 300);
          if(["open", "close"].includes(m.strat_log.kind)) toast(`⚡ ${m.strat_log.name}: ${m.strat_log.msg}`);
          if(m.strat_log.kind === "error") toast(`⚠ ${m.strat_log.name}: ${m.strat_log.msg}`); }
        if(PG.page === "strategies"){ clearTimeout(SG.timer); SG.timer = setTimeout(sgRender, 400); }
        else if(m.strats_changed) sgLoad();
      }catch(e){}
    }
  };
  ws._sg = 1;
}
(function sgHook(){
  if(typeof PAGES !== "undefined" && !PAGES.includes("strategies")) PAGES.splice(PAGES.indexOf("log"), 0, "strategies");
  const ps = pgShow;
  pgShow = function(name, fromHash){ ps(name, fromHash); if(name === "strategies") sgRender(); };
  if(typeof connectWS === "function"){ const cw = connectWS; connectWS = function(){ cw(); sgWsHook(); }; }
  sgWsHook();
  document.addEventListener("DOMContentLoaded", () => {
    const nav = sgq("#nav");
    if(nav && !nav.querySelector('[data-pg="strategies"]')){
      const b = document.createElement("button"); b.dataset.pg = "strategies"; b.title = "Strategies: Pine strategies that trade by themselves"; b.setAttribute("aria-label", "Strategies"); b.className = "canav sgnav";
      b.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/></svg><span class="nb hide" id="nbStrats"></span>`;
      b.onclick = () => pgShow("strategies");
      const before = nav.querySelector('[data-pg="alerts"]') || nav.querySelector('[data-pg="log"]'); before.before(b);
    }
    const pages = sgq("#pages");
    if(pages && !sgq("#pg_strategies")){ const d = document.createElement("div"); d.className = "pg hide"; d.id = "pg_strategies"; pages.append(d); }
    if(typeof mMore === "function"){            // the phone's More tab gets a Strategies row
      const mm = mMore;
      window.mMore = mMore = function(){ mm(); const l = document.querySelector("#ms_more .mlist"); if(l && !l.querySelector('[data-pg="strategies"]')){
        const b = document.createElement("button"); b.dataset.pg = "strategies"; b.innerHTML = "<span>Strategies<br><small>Pine strategies that trade by themselves, the tester, the log</small></span>›"; b.onclick = () => pgShow("strategies"); l.prepend(b); } };
    }
    if(typeof refreshState === "function"){     // (the running count on the top bar's ⚡, once you're logged in)
      const rs = refreshState;
      refreshState = function(...a){ const r = rs.apply(this, a); Promise.resolve(r).then(() => { if(typeof S !== "undefined" && S.user && !SG.loaded) sgLoad(); }); return r; };
    }
  });
})();
