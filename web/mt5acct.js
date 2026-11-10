/* MT5 accounts on the page (roadmap 8 b, slice b1; v0.36.0): the MT5 side of the switch at the top left shows one MT5
   account at a time (the account switcher lists them: security.js), straight from MT5 through the FTM Bridge EA.
   Everything that shows an account (the panel, the chart's trade lines and their bar, the Trades, History, Log pages, the
   phone) is the paper engine's own page code working on the MT5 account's snapshot (mode "mt5", money in its currency);
   this file adds what is MT5's own:
     - each trade's state at MT5 ("MT5 SL 2650.10 ✓", "→ moving to …", "closing in MT5…", MT5's refusal),
     - the warnings (MT5 not connected, an old EA, app trading off in the EA, a limit breached),
     - FundingPips' limits under the account figures,
     - the Account page of an MT5 account (MT5's figures, the limits form, the commission learned per symbol),
     - the first change on an account: its login typed once (the server says so with need_login).
   Placing orders from the app is slice b2: the ticket says so on the MT5 side.
   Uses globals from index.html, paper.js, pages.js, security.js and live.js. */
"use strict";
const mtOn = () => !!(P.snap && P.snap.mode === "mt5");
const mtM = () => (P.snap && P.snap.mt5) || {};

function mtFmt(p, v){ return v == null ? "none" : fmt(v, p.tick); }

/* ---------------------------------------------------------------- each trade at MT5 */
function mtState(p){
  const M = mtM(), from = p.outside ? (p.found ? "Already open in MT5 · " : "Placed in MT5 · ") : "";
  const t = `#${p.ticket} · `;
  if(p.gone) return {t: from + t + "gone from MT5, waiting for its closing deal", c: "warnc"};
  if(p.exiting) return {t: from + t + `closing in MT5 (${p.exiting.why || "manual"})…` + (M.online ? "" : " · waiting for MT5"), c: "warnc"};
  const same = (a, b) => a == null ? b == null : b != null && Math.abs(a - b) < (p.tick || 0.01) / 2;
  const synced = same(p.sl, p.b_sl) && same(p.tp, p.b_tp);
  let s = `MT5 SL ${mtFmt(p, p.b_sl)} · TP ${mtFmt(p, p.b_tp)}`;
  if(!synced) s += ` → moving to SL ${mtFmt(p, p.sl)} · TP ${mtFmt(p, p.tp)}` + (p.pend === "sent" ? " (sent)" : M.online ? "" : " (MT5 not connected)");
  else s += " ✓";
  if(p.mt_err) s += ` · MT5 refused: ${p.mt_err}`;
  if(p.b_sl == null) return {t: from + t + s + " · NO STOP AT MT5", c: "down"};
  return {t: from + t + s, c: p.mt_err ? "warnc" : synced ? "up" : "warnc"};
}
function mtLine(host, txt, extra){
  let d = host.querySelector(".mtline");
  if(!d){ d = document.createElement("div"); d.className = "mtline"; host.append(d); }
  d.className = "mtline " + (extra || "") + txt.c;
  if(d.textContent !== txt.t) d.textContent = txt.t;
}
function mtPositions(){
  if(!mtOn()) return;
  for(const p of P.snap.positions){
    const st = mtState(p);
    const el = document.querySelector(`#posList .pos[data-id="${p.id}"]`); if(el) mtLine(el, st);
    const td = document.querySelector(`#pgPos tr[data-id="${p.id}"] td[data-e="sl"]`); if(td) mtLine(td, st, "sm ");
  }
  for(const o of P.snap.orders){
    const pend = o.pend ? (o.pend[0] === "CANCEL" ? "cancelling in MT5…" : "moving in MT5…") : "";
    const t = {t: `${o.outside ? "Placed in MT5 · " : ""}#${o.ticket}${o.type === "stoplimit" ? " · stop-limit " + fmt(o.stoplimit, o.tick) : ""}`
      + (o.cancel_req ? " · cancelling in MT5…" : pend ? " · " + pend : "") + (o.mt_err ? ` · MT5 refused: ${o.mt_err}` : ""), c: o.mt_err ? "warnc" : "muted"};
    const el = document.querySelector(`#ordList .pos[data-id="${o.id}"]`); if(el) mtLine(el, t);
  }
}

/* ---------------------------------------------------------------- header, panel, warnings */
function mtBanner(){
  let el = $("#mtWarn");
  if(!el){ el = document.createElement("div"); el.id = "mtWarn"; el.className = "mtwarn hide"; const h = document.querySelector("#app > header"); h && h.append(el); }
  const M = mtM();
  const w = mtOn() ? (M.none ? ["No MT5 account yet: start MT5 on your laptop with the FTM Bridge EA 1.10 on a chart (Settings › MT5 bridge). Each MT5 login that calls becomes an account here."]
    : [...(M.breach || []).map(b => "LIMIT: " + b), ...(M.warnings || [])]) : [];
  el.classList.toggle("hide", !w.length);
  const html = w.map(x => `<div class="${/^LIMIT/.test(x) ? "down" : ""}">⚠ ${esc(x)}</div>`).join("");
  if(el.dataset.h !== html){ el.dataset.h = html; el.innerHTML = html; }
}
function mtPanel(){
  const h = document.querySelector("#panel h4"), t = h && h.nextElementSibling;
  if(!h || !mtOn()) return;
  const M = mtM();
  h.textContent = M.none ? "MT5" : `MT5 account ${M.login}`;
  if(t && t.classList.contains("tag")){ t.textContent = M.none ? "MT5" : `MT5 · ${(M.info || {}).server || ""}${(M.info || {}).demo ? " · DEMO" : ""}`; t.classList.add("tag-mt5"); }
}
function mtLimitsText(){
  const a = P.snap.acct, M = mtM(), r = P.snap.rules;
  if(M.none) return "";
  const pct = n => (+n).toLocaleString("en-US", {maximumFractionDigits: 2}) + "%";
  const base = r.day_from === "higher" ? "the higher of balance and equity" : r.day_from === "equity" ? "equity" : "balance";
  const d = a.daily_floor != null ? `Daily floor <b>${rs(a.daily_floor)}</b> (${pct(r.daily_pct)} of ${r.daily_of === "size" ? "the starting size" : "the day's start"}; the ${base} at the broker's midnight, ${esc(M.midnight_ist || "")} IST: ${rs(M.day_base)})` : "Daily limit off";
  const x = a.max_floor != null ? `Max floor <b>${rs(a.max_floor)}</b> (${pct(r.max_pct)} of ${rs(r.size)}${r.max_mode === "trailing" ? ", trailing" : ""}${M.size_set ? "" : " - type your starting size on the Account page"})` : "Max limit off";
  return `${d} · ${x}`;
}
function mtFoot(){
  const f = $("#acctFoot"); if(!f) return;
  let d = $("#mtFoot");
  if(!mtOn()){ if(d) d.remove(); return; }
  if(!d){ d = document.createElement("div"); d.id = "mtFoot"; d.className = "mtfoot"; f.after(d); }
  const h = mtLimitsText(); if(d.dataset.h !== h){ d.dataset.h = h; d.innerHTML = h; }
}
function mtTicketHint(){
  const h = $("#tkHint"); if(!h) return;
  if(!h.dataset.orig) h.dataset.orig = h.textContent;
  h.textContent = mtOn() ? "MT5 side: placing orders from the app comes in the next step. Place trades in MT5 itself: they show here at once, and you manage them here (drag SL / TP, BE, BE-T, TRAIL, ✕) - every change moves the real trade at the broker."
    : h.dataset.orig;
}
function mtDecorate(){
  document.body.classList.toggle("is-mt5", mtOn());
  mtBanner(); mtPanel(); mtFoot(); mtPositions(); mtTicketHint();
}

/* ---------------------------------------------------------------- the first change on an account: its login, once */
function mtConfirm(login){
  return new Promise(res => {
    let m = $("#mtConfDlg");
    if(!m){ m = document.createElement("div"); m.id = "mtConfDlg"; document.body.append(m); }
    const I = (mtM().info) || {};
    m.className = "modalwrap";
    m.innerHTML = `<div class="ca mtcard"><b>First change on MT5 account ${esc(String(login))}</b>
      <p class="help">${esc(I.server || "")}${I.demo ? " · DEMO" : I.server ? " · REAL" : ""}${I.company ? " · " + esc(I.company) : ""}.
        From now on the app moves this account's stops and closes its trades at the broker when you ask (and trailing moves them by itself).
        Type its login to confirm it's the right account (asked once per account).</p>
      <label>MT5 login</label><input id="mtcLogin" class="mono" autocomplete="off" inputmode="numeric" placeholder="${esc(String(login))}">
      <div class="err" id="mtcErr"></div>
      <div class="btns"><button class="primary mt5btn" id="mtcGo">Confirm</button><button class="ghost" id="mtcX">Cancel</button></div></div>`;
    m.classList.remove("hide");
    const done = v => { m.classList.add("hide"); res(v); };
    sq("#mtcX").onclick = () => done(false);
    const go = async () => {
      const j = await api("/api/mt5acct/confirm", {body: {login: sq("#mtcLogin").value.trim()}});
      if(!j.ok){ sq("#mtcErr").textContent = j.error; return; }
      if(j.paper) paperUpdate(j.paper);
      done(true);
    };
    sq("#mtcGo").onclick = go;
    sq("#mtcLogin").onkeydown = e => { if(e.key === "Enter") go(); };
    setTimeout(() => { const i = sq("#mtcLogin"); i && i.focus(); }, 50);
  });
}

/* ---------------------------------------------------------------- the Account page of an MT5 account */
const MT5_RULES = [
  ["size", "Starting size", "The account size you bought (FundingPips counts the max loss from it)"],
  ["daily_pct", "Daily loss limit %", "0 = off. FundingPips 2-Step: 5%"],
  ["daily_of", "Daily % of", "", [["day", "the day's starting balance"], ["size", "the starting size"]]],
  ["day_from", "The day starts from", "At the broker's midnight", [["balance", "balance"], ["equity", "equity"], ["higher", "the higher of the two"]]],
  ["max_pct", "Max loss limit %", "0 = off. FundingPips 2-Step: 10%"],
  ["max_mode", "Max loss floor", "static: size − max %. trailing: follows the highest balance", [["static", "static"], ["trailing", "trailing"]]],
  ["buffer_pct", "Buffer %", "Kept from each floor, % of size (the guards use it from the next step)"],
  ["phase", "Phase", "Evaluation or Master (the news guard uses it, later)", [["evaluation", "evaluation"], ["master", "master"]]],
  ["comm_default", "Commission until MT5 shows it", "Per lot, on each deal (opening and closing). MT5's own deals replace it per symbol"],
  ["be_buffer_ticks", "BE buffer (ticks)", "Extra ticks beyond break-even + costs when a stop moves to BE"],
  ["risk_cap_pct", "Risk cap per trade %", "For placing orders from the app (next step)"],
  ["sl_required", "Stop loss required", "For placing orders from the app (next step)", [[true, "required"], [false, "optional"]]],
];
function mtRulesHTML(r){
  return MT5_RULES.map(([k, label, help, opts]) => `<div class="rf"><label>${label}${k === "size" || k === "comm_default" ? ` (${CUR().trim()})` : ""}</label>` +
    (opts ? `<select data-k="${k}" ${typeof opts[0][0] === "string" ? 'data-t="s"' : ""}>${opts.map(([v, n]) => `<option value="${v}" ${String(r[k]) === String(v) ? "selected" : ""}>${n}</option>`).join("")}</select>`
          : `<input data-k="${k}" value="${esc(r[k])}" inputmode="decimal">`) + (help ? `<div class="help">${help}</div>` : "") + `</div>`).join("");
}
function mtAccountPage(){
  const box = pgq("#pg_account"); if(!box || !P.snap) return;
  const a = P.snap.acct, M = mtM(), I = M.info || {}, r = P.snap.rules, t = P.snap.trail;
  if(M.none){
    box.innerHTML = `<div class="pg-head"><h2>MT5</h2><span class="tag tag-mt5">MT5</span><span class="sp"></span></div>
      <div class="pg-card mtcard"><h3 class="pg-h3" style="margin-top:0">No MT5 account yet</h3>
      <p class="help">Each MT5 login whose terminal runs the FTM Bridge EA (1.10 or later) on your laptop becomes an account here, by itself.
        Set it up in <a href="#" id="mtGoSet">Settings › MT5 bridge</a>: download FTM_Bridge.mq5, compile it in MetaEditor, put it on a chart with your bridge key.</p></div>`;
    pgq("#mtGoSet").onclick = e => { e.preventDefault(); openDrawer(); setTimeout(() => typeof setGo === "function" && setGo("mt5Sec"), 200); };
    return;
  }
  const pc = n => n == null ? "–" : rs(n), on = M.online;
  const tr = M.trade || {};
  const cards = [["Balance", pc(a.balance)], ["Equity", pc(a.equity)], ["Open P&L", `<span class="${cls(a.open_net)}">${pc(a.open_net)}</span>`],
    ["Margin in use", pc(I.margin)], ["Free margin", pc(I.free)], ["Leverage", I.leverage ? "1:" + I.leverage : "–"],
    ["MT5", on ? '<span class="up">connected</span>' : `<span class="down">not connected</span>`],
    ["EA", M.ea ? `${esc(M.ea)}${M.ea_ok ? "" : ` <span class="down">(needs ${esc(M.ea_min)})</span>`}` : "–"],
    ["App can change trades", !M.ea_ok ? '<span class="down">no (old EA)</span>' : tr.on === false ? '<span class="down">no (AllowTrading off)</span>'
      : tr.term === false || tr.mql === false ? '<span class="down">no (Algo Trading off)</span>' : M.confirmed ? '<span class="up">yes</span>' : '<span class="warnc">after you confirm the login</span>'],
    ["Mode", esc(I.mode || "–") + (I.demo ? " · DEMO" : "")]];
  const lim = [["Today's start (broker's midnight)", pc(M.day_start)], ["Daily floor", a.daily_floor != null ? pc(a.daily_floor) : "off"],
    ["Daily room", a.day_room != null ? `<span class="${a.day_room < 0 ? "down" : ""}">${pc(a.day_room)}</span>` : "off"],
    ["Max floor", a.max_floor != null ? pc(a.max_floor) : "off"], ["Max room", a.max_room != null ? `<span class="${a.max_room < 0 ? "down" : ""}">${pc(a.max_room)}</span>` : "off"],
    ["Highest balance", pc(a.peak)], ["Closed trades", a.trades], ["Net, all time", `<span class="${cls(a.net_total)}">${pc(a.net_total)}</span>`],
    ["Commission + swap, all time", pc(a.charges_total)], ["Win rate / PF", `${a.win_rate != null ? a.win_rate + "%" : "–"} / ${a.pf ?? "–"}`]];
  const comm = Object.entries(M.comm || {});
  box.innerHTML = `<div class="pg-head"><h2>MT5 ${esc(String(M.login))}</h2><span class="tag tag-mt5">MT5 · ${esc(I.server || "")}${I.demo ? " · DEMO" : ""}</span><span class="sp"></span></div>
    <div class="pg-cards">${cards.map(([k, v]) => `<div class="pgc"><span>${k}</span><b>${v}</b></div>`).join("")}</div>
    ${(M.breach || []).map(b => `<div class="note down">⚠ LIMIT: ${esc(b)}</div>`).join("")}${(M.warnings || []).map(w => `<div class="note warnc">⚠ ${esc(w)}</div>`).join("")}
    ${!M.confirmed && M.ea_ok ? `<div class="btns"><button class="mt5btn" id="mtConfGo">Confirm this account's login…</button></div>` : ""}
    <div class="pg-split">
      <div class="pg-card mtcard"><h3 class="pg-h3" style="margin-top:0">FundingPips' loss limits</h3>
        <p class="help">${mtLimitsText()}. Shown here and on the panel; they refuse new orders once placing from the app arrives (next step). FundingPips
          measures on its own server - its dashboard is the official figure.</p>
        <div class="pg-cards">${lim.map(([k, v]) => `<div class="pgc"><span>${k}</span><b>${v}</b></div>`).join("")}</div>
        <h4 style="margin:12px 0 4px">This account's limits</h4>
        <div id="mtRules" class="pg-rules">${mtRulesHTML(r)}</div>
        <div class="btns"><button class="primary" id="mtRulesSave">Save</button></div><div id="mtRulesMsg"></div>
        ${M.first_deposit && !M.size_set ? `<p class="help">Starting size: ${pc(M.first_deposit)}, the first deposit in MT5's history - type yours if it's different.</p>` : ""}</div>
      <div>
        <div class="pg-card"><h3 class="pg-h3" style="margin-top:0">Commission, learned from MT5's deals</h3>
          <p class="help">Per lot. Every ${CUR().trim()} figure (SL, TP, risk, P&L, R, BE) is net of it and of the trade's swap. Until a symbol has traded, your
            default (${pc(M.comm_default)} a lot on each deal) is used; a later deal that differs is flagged in the Log and used from then on.</p>
          ${comm.length ? `<table class="mtcomm"><tr><th>Symbol</th><th>Opening deal</th><th>Closing deal</th><th>Round turn</th><th>Last change</th></tr>${comm.map(([s, c]) =>
            `<tr><td class="mono">${esc(s)}</td><td>${pc(c.in)} <span class="muted">(${c.in_n || 0})</span></td><td>${pc(c.out)} <span class="muted">(${c.out_n || 0})</span></td><td>${pc((c.in || 0) + (c.out || 0))}</td>
              <td>${c.diff ? `<span class="warnc">${pc(c.diff.was)} → ${pc(c.diff.now)} (${c.diff.leg === "in" ? "opening" : "closing"})</span>` : "–"}</td></tr>`).join("")}</table>`
          : '<p class="muted">No deal seen yet.</p>'}</div>
        <div class="pg-card"><h3 class="pg-h3" style="margin-top:0">Trailing defaults</h3><p class="help">For trades this account opens or shows. Changing them also changes every open trade (and moves MT5's stops).</p>
          <div class="trail"><span>Trail BE</span><input id="pgTrBeR" value="${t.be_r}"><button id="pgTrBe" class="${t.be_on ? "on" : ""}">${t.be_on ? "ON" : "off"}</button>
            <span>Trail SL</span><input id="pgTrSlR" value="${t.sl_r}"><button id="pgTrSl" class="${t.sl_on ? "on" : ""}">${t.sl_on ? "ON" : "off"}</button></div></div>
        <div class="pg-card"><h3 class="pg-h3" style="margin-top:0">MT5's history</h3>
          <p class="help">${M.deals} deals received${M.caught ? "" : " (more on their way)"}. The History page shows this account's closed trades from MT5's deals, the last 90 days
            the first time. Trades from before the app saw them have no stop, so no R.</p>
          <div class="btns"><button id="mtResync" title="Ask the EA for MT5's deals of the last 90 days again; anything already in the history is skipped">Read MT5's history again</button></div><div id="mtResMsg"></div></div>
      </div></div>`;
  pgq("#mtRulesSave").onclick = () => saveRules("#mtRules", "#mtRulesMsg").then(() => setTimeout(mtAccountPage, 300));
  const tb = (k, v) => papi("trail", {[k]: v}).then(() => mtAccountPage());
  pgq("#pgTrBe").onclick = () => tb("be_on", !P.snap.trail.be_on);
  pgq("#pgTrSl").onclick = () => tb("sl_on", !P.snap.trail.sl_on);
  pgq("#pgTrBeR").onchange = () => papi("trail", {be_r: num(pgq("#pgTrBeR").value) || 1});
  pgq("#pgTrSlR").onchange = () => papi("trail", {sl_r: num(pgq("#pgTrSlR").value) || 1});
  pgq("#mtResync").onclick = async () => { const j = await api("/api/mt5acct/resync", {body: {}}); if(j.paper) paperUpdate(j.paper);
    pgq("#mtResMsg").textContent = j.ok ? "Asked MT5 for its deals again." : j.error; };
  const cg = pgq("#mtConfGo"); if(cg) cg.onclick = async () => { if(await mtConfirm(M.login)) mtAccountPage(); };
}

/* ---------------------------------------------------------------- hooks into the existing views */
(function(){
  const pu = paperUpdate;
  paperUpdate = function(s, events){ pu(s, events); mtDecorate(); };
  if(typeof pgPositions === "function"){ const pp = pgPositions; pgPositions = function(){ pp(); mtPositions(); }; }
  if(typeof pgAccount === "function"){ const pa = pgAccount; pgAccount = function(){ if(mtOn()) return mtAccountPage(); pa(); }; }
  if(typeof renderRules === "function"){                  // Settings › rules: an MT5 account's own limits
    const rr = renderRules;
    renderRules = function(sel){
      sel = sel || "#rulesForm";
      if(!mtOn() || !P.snap || !$(sel)) return rr(sel);
      if(sel === "#rulesForm") P.rulesShown = true;
      $(sel).innerHTML = (sel === "#mtRules" ? "" : `<p class="help">MT5 account ${esc(String(mtM().login || ""))}: its loss limits (FundingPips' rules). The rest is on its Account page.</p>`)
        + mtRulesHTML(P.snap.rules);
    };
  }
  /* papi: an MT5 account's first change asks for its login once, then the same request goes again */
  const pa0 = papi;
  papi = async function(path, body){
    if(!mtOn()) return pa0(path, body);
    let j = await api("/api/paper/" + path, body === undefined ? {} : {body});
    if(j.need_login){
      if(j.paper) paperUpdate(j.paper);
      if(!(await mtConfirm(j.need_login))) return {ok: false, error: "cancelled"};
      j = await api("/api/paper/" + path, body === undefined ? {} : {body});
    }
    if(j.paper) paperUpdate(j.paper);
    if(!j.ok){ toast(j.error || "Refused"); setStatus(j.error, true); }
    return j;
  };
})();
