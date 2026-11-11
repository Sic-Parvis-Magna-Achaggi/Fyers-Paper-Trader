/* MT5 accounts on the page (roadmap 8 b, slice b1; v0.36.0): the MT5 side of the switch at the top left shows one MT5
   account at a time (the account switcher lists them: security.js), straight from MT5 through the FTM Bridge EA.
   Everything that shows an account (the panel, the chart's trade lines and their bar, the Trades, History, Log pages, the
   phone) is the paper engine's own page code working on the MT5 account's snapshot (mode "mt5", money in its currency);
   this file adds what is MT5's own:
     - each trade's state at MT5 ("MT5 SL 2650.10 ✓", "→ moving to …", "closing in MT5…", MT5's refusal),
     - the warnings (MT5 not connected, an old EA, app trading off in the EA, a limit breached),
     - FundingPips' limits under the account figures,
     - the Account page of an MT5 account (MT5's figures, the limits form, the commission learned per symbol),
     - (v0.37.1: no login prompt any more - every account is ready at once; the need_login dialog stays for safety, unused.)
   v0.37.0 (b2 / b3): placing from the ticket and the chart tool (PLACE says MT5), orders on their way to MT5, the MT5 kill
   switch (KILL in the top bar, Resume on the Account page), the news guard's events and its settings.
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
    if(el) mtDeBtn(el, p);
    if(td) mtDeBtn(td, p);
  }
  for(const o of P.snap.orders){
    const pend = o.pend ? (o.pend[0] === "CANCEL" ? "cancelling in MT5…" : "moving in MT5…") : "";
    const t = {t: `${o.outside ? "Placed in MT5 · " : ""}#${o.ticket}${o.type === "stoplimit" ? " · stop-limit " + fmt(o.stoplimit, o.tick) : ""}`
      + (o.cancel_req ? " · cancelling in MT5…" : pend ? " · " + pend : "") + (o.mt_err ? ` · MT5 refused: ${o.mt_err}` : ""), c: o.mt_err ? "warnc" : "muted"};
    const el = document.querySelector(`#ordList .pos[data-id="${o.id}"]`); if(el){ mtLine(el, t); mtDeBtn(el, o); }
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
  const de = M.dayend;
  const e = de ? ` · Day-end close <b>${esc(de.at_ist)} IST</b> (${(+de.min).toLocaleString("en-US")} min before the broker's day ends${de.when === "weekend" ? ", Fridays only" : ""}; ${de.scope === "all" ? "all trades" : "trades marked to close"})${de.when === "weekend" && !de.today ? " · not today" : de.active ? " · <b>done for today</b>: new orders wait for the broker's new day" : ""}` : "";
  return `${d} · ${x}${e}`;
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
  h.textContent = mtOn() ? `MT5 ${mtM().login || ""}: press BUY or SELL, drag the SL and TP lines, PLACE. The order goes to MT5 with its real SL and TP; every $ figure is net of commission. Lots are MT5's (0.01 steps).`
    : h.dataset.orig;
  const amt = document.querySelector('#tkMode [data-v="amt"]'); if(amt) amt.textContent = "Risk " + CUR().trim();
}
/* PLACE says where the order goes */
function mtPlace(){
  const on = mtOn(), btn = $("#bPlace");
  if(btn){ btn.classList.toggle("mt5", on); if(on && !/^MT5/.test(btn.textContent)) btn.textContent = "MT5 · " + btn.textContent; }
  const tp = document.querySelector("#tool .tp");
  if(tp){ tp.classList.toggle("mt5", on); if(on && !/^MT5/.test(tp.textContent)) tp.textContent = "MT5 " + tp.textContent; }
}
/* orders on their way to MT5 (PLACE pressed, MT5 hasn't shown the trade yet) */
function mtOpening(){
  const host = $("#posList"); if(!host) return;
  let d = $("#mtOpening");
  const ops = mtOn() ? (mtM().opening || []) : [];
  if(!ops.length){ if(d) d.remove(); return; }
  if(!d){ d = document.createElement("div"); d.id = "mtOpening"; host.prepend(d); }
  const h = ops.map(o => `<div class="mtline ${o.unsure ? "warnc" : "muted"}">${o.unsure ? "⚠ MT5 didn't confirm " : o.ticket ? "MT5 placed " : o.sent ? "Placing in MT5: " : "Sending to MT5: "}${esc(o.text)}${o.ticket ? ` (#${o.ticket}) - waiting for it to show` : "…"}</div>`).join("");
  if(d.dataset.h !== h){ d.dataset.h = h; d.innerHTML = h; }
}
/* the MT5 kill switch (top bar) */
function mtKillBtn(){
  let b = $("#bKillMt5");
  if(!b){ const sel = $("#acctSel"); if(!sel) return; b = document.createElement("button"); b.id = "bKillMt5"; b.className = "killbtn hide"; b.textContent = "KILL";
    b.title = "MT5 kill switch: close every position and cancel every order of this MT5 account, then pause new orders"; b.onclick = mtKill; sel.after(b); }
  b.classList.toggle("hide", !(mtOn() && !mtM().none));
  b.classList.toggle("on", !!mtM().halted);
}
async function mtKill(){
  if(!mtOn()) return;
  if(!confirm(`MT5 KILL SWITCH · account ${mtM().login}\n\nClose every position and cancel every order of this MT5 account at the broker, then pause new orders until you press Resume (Account page).\n\nGo?`)) return;
  const j = await api("/api/mt5acct/kill", {body: {}});
  if(j.paper) paperUpdate(j.paper);
  toast(j.ok ? "Kill switch: closing everything in MT5" : j.error);
}
function mtDecorate(){
  document.body.classList.toggle("is-mt5", mtOn());
  mtBanner(); mtPanel(); mtFoot(); mtPositions(); mtTicketHint(); mtPlace(); mtOpening(); mtKillBtn(); mtDeTicket(); mtDeChip();
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
  ["buffer_pct", "Buffer %", "Kept from each floor, % of size (new orders must leave it)"],
  ["phase", "Phase", "Master: no opening or closing from the app around high-impact news. Evaluation: a warning only", [["evaluation", "evaluation"], ["master", "master"]]],
  ["news_on", "News guard (ForexFactory)", "High-impact events on the symbol's currencies", [[true, "on"], [false, "off"]]],
  ["news_min", "Master: minutes either side", "FundingPips: 5"],
  ["news_warn_min", "Warn this many minutes before", ""],
  ["comm_default", "Commission if MT5 doesn't say", "Per lot, on each deal. Used only for a symbol that hasn't traded here and whose commission MT5 doesn't list (EA 1.22 reads it from the symbol's specification). Empty = not typed: such a symbol can't be placed. 0 = no commission"],
  ["be_buffer_ticks", "BE buffer (ticks)", "Extra ticks beyond break-even + costs when a stop moves to BE"],
  ["risk_cap_pct", "Risk cap per trade %", "Net risk at the stop, % of balance: lots are cut to fit; 0 = off"],
  ["max_open_risk_pct", "Max open risk %", "Everything open at its stop, % of balance; 0 = off"],
  ["max_margin_pct", "Max margin use %", "0 = off"],
  ["max_trades", "Max trades a day", "Pending orders count; 0 = no limit"],
  ["sl_required", "Stop loss required", "", [[true, "required"], [false, "optional"]]],
  ["dayend_on", "Day-end close", "Close trades a few minutes before the broker's day ends (its midnight: FundingPips 03:30 IST in winter, 02:30 in US summer time); pending orders are cancelled and new ones refused until the new day", [[false, "off"], [true, "on"]]],
  ["dayend_min", "Minutes before the broker's day ends", "1 to 240"],
  ["dayend_when", "Day-end close: when", "", [["day", "every day"], ["weekend", "only before the weekend (Fridays)"]]],
  ["dayend_scope", "Day-end close: which trades", "Marked: you choose per trade (At the day end on the ticket, ⏱ on each trade); the choice stays the default for later trades", [["all", "all trades"], ["marked", "only trades marked to close"]]],
];
function mtRulesHTML(r){
  return MT5_RULES.map(([k, label, help, opts]) => `<div class="rf"><label>${label}${k === "size" || k === "comm_default" ? ` (${CUR().trim()})` : ""}</label>` +
    (opts ? `<select data-k="${k}" ${typeof opts[0][0] === "string" ? 'data-t="s"' : typeof opts[0][0] === "boolean" ? 'data-t="b"' : ""}>${opts.map(([v, n]) => `<option value="${v}" ${String(r[k]) === String(v) ? "selected" : ""}>${n}</option>`).join("")}</select>`
          : `<input data-k="${k}" value="${r[k] == null ? "" : esc(r[k])}" inputmode="decimal"${k === "comm_default" ? ' placeholder="not typed"' : ""}>`) + (help ? `<div class="help">${help}</div>` : "") + `</div>`).join("");
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
    ["Placing orders", M.halted ? '<span class="down">paused (kill switch)</span>' : !M.ea_trade ? `<span class="down">needs EA ${esc(M.ea_trade_min)}</span>` : '<span class="up">yes</span>'],
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
    <div class="btns">${M.halted ? '<button class="primary" id="mtResume">Resume trading</button>' : ""}<button class="danger" id="mtKillGo" title="Close every position and cancel every order of this account at MT5, then pause new orders">Kill switch</button></div>
    <div class="pg-split">
      <div class="pg-card mtcard"><h3 class="pg-h3" style="margin-top:0">FundingPips' loss limits</h3>
        <p class="help">${mtLimitsText()}. Shown here and on the panel; new orders that could break them are refused. FundingPips
          measures on its own server - its dashboard is the official figure.</p>
        <div class="pg-cards">${lim.map(([k, v]) => `<div class="pgc"><span>${k}</span><b>${v}</b></div>`).join("")}</div>
        <h4 style="margin:12px 0 4px">This account's limits</h4>
        <div id="mtRules" class="pg-rules">${mtRulesHTML(r)}</div>
        <div class="btns"><button class="primary" id="mtRulesSave">Save</button></div><div id="mtRulesMsg"></div>
        ${M.first_deposit && !M.size_set ? `<p class="help">Starting size: ${pc(M.first_deposit)}, the first deposit in MT5's history - type yours if it's different.</p>` : ""}</div>
      <div>
        <div class="pg-card"><h3 class="pg-h3" style="margin-top:0">Commission, learned from MT5's deals</h3>
          <p class="help">Per lot. Every ${CUR().trim()} figure (SL, TP, risk, P&L, R, BE) is net of it and of the trade's swap. Taken from MT5's own deals on the
            symbol; before its first trade, from the symbol's commission rules in MT5 (EA 1.22: its Specification window), else as a symbol of the same group
            that has traded, else your default${M.comm_default == null ? " (not typed)" : ` (${pc(M.comm_default)} a lot on each deal)`}. A symbol with none of these
            can't be placed. A deal that charges differently is flagged in the Log and used from then on.</p>
          ${comm.length ? `<table class="mtcomm"><tr><th>Symbol</th><th>Opening deal</th><th>Closing deal</th><th>Round turn</th><th>From</th><th>Last change</th></tr>${comm.map(([s, c]) =>
            `<tr><td class="mono">${esc(s)}</td><td>${mtCommCell(c, "in")}</td><td>${mtCommCell(c, "out")}</td><td>${c.in == null || c.out == null ? "–" : pc((c.in || 0) + (c.out || 0))}</td>
              <td style="text-align:left">${esc(mtCommSrc(c))}</td>
              <td>${c.diff ? `<span class="warnc">${pc(c.diff.was)} → ${pc(c.diff.now)} (${c.diff.leg === "in" ? "opening" : "closing"})</span>` : "–"}</td></tr>`).join("")}</table>`
          : '<p class="muted">No deal seen yet.</p>'}</div>
        <div class="pg-card"><h3 class="pg-h3" style="margin-top:0">What a 1.00 move is worth on 1 lot</h3>
          <p class="help">Every ${CUR().trim()} figure is worked out from this. Taken from MT5's own profit on an open position of the symbol
            when there is one; otherwise tick size × contract size (when the symbol's profit currency is the account's); otherwise MT5's
            tick value. Check it against MT5 (XAUUSD, 100 oz a lot: ${pc(100)}).</p>
          ${(M.values || []).length ? `<table class="mtcomm"><tr><th>Symbol</th><th>Used</th><th>From</th><th>MT5's tick value says</th></tr>${M.values.map(v =>
            `<tr><td class="mono">${esc(v.s)}</td><td>${pc(v.per)}</td><td style="text-align:left">${esc(v.src || "")}</td>
              <td>${v.mt5 == null ? "–" : `<span class="${Math.abs(v.mt5 - v.per) / v.per > 0.02 ? "warnc" : ""}">${pc(v.mt5)}</span>`}</td></tr>`).join("")}</table>`
          : '<p class="muted">No symbol yet.</p>'}</div>
        <div class="pg-card"><h3 class="pg-h3" style="margin-top:0">Trailing defaults</h3><p class="help">For trades this account opens or shows. Changing them also changes every open trade (and moves MT5's stops).</p>
          <div class="trail"><span>Trail BE</span><input id="pgTrBeR" value="${t.be_r}"><button id="pgTrBe" class="${t.be_on ? "on" : ""}">${t.be_on ? "ON" : "off"}</button>
            <span>Trail SL</span><input id="pgTrSlR" value="${t.sl_r}"><button id="pgTrSl" class="${t.sl_on ? "on" : ""}">${t.sl_on ? "ON" : "off"}</button></div></div>
        <div class="pg-card"><h3 class="pg-h3" style="margin-top:0">High-impact news (ForexFactory)</h3>
          <p class="help">${r.phase === "master" ? `Master: no opening or closing from the app from ${r.news_min} min before to ${r.news_min} min after each, on the symbol's currencies (MT5's own SL / TP still fire).`
            : "Evaluation: no block - a warning before each (purposely trading news is prohibited)."} ${r.news_on ? "" : "<b>The guard is off.</b>"}
            FundingPips' dashboard calendar is the official one. ${M.news_src && M.news_src.at ? "Read " + istTime(M.news_src.at) : "Not read yet"}${M.news_src && M.news_src.err ? ` · <span class="warnc">last try failed: ${esc(M.news_src.err)}</span>` : ""}.</p>
          ${(M.news || []).length ? `<table class="mtcomm"><tr><th>When (IST)</th><th>Currency</th><th>Event</th></tr>${M.news.map(e => `<tr><td>${esc(e.ist)}</td><td>${esc(e.cur)}</td><td style="text-align:left">${esc(e.title)}</td></tr>`).join("")}</table>`
            : '<p class="muted">None in the next 24 hours for this account\'s symbols.</p>'}
          <div class="btns"><button id="mtNewsGo">Read ForexFactory now</button></div><div id="mtNewsMsg"></div></div>
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
  pgq("#mtKillGo").onclick = async () => { await mtKill(); setTimeout(mtAccountPage, 800); };
  const rg = pgq("#mtResume"); if(rg) rg.onclick = async () => { const j = await stepUp(() => api("/api/mt5acct/resume", {body: {}}));
    if(j.paper) paperUpdate(j.paper); else if(j.error && j.error !== "cancelled") toast(j.error); mtAccountPage(); };
  pgq("#mtNewsGo").onclick = async () => { pgq("#mtNewsMsg").textContent = "Reading…"; const j = await api("/api/mt5acct/news", {body: {}});
    pgq("#mtNewsMsg").textContent = j.ok ? `Read: ${j.news.n} events.` : "Couldn't read it: " + (j.error || ""); const k = await api("/api/paper"); if(k.paper) paperUpdate(k.paper); setTimeout(mtAccountPage, 200); };
}

/* ---------------------------------------------------------------- hooks into the existing views */
(function(){
  const pu = paperUpdate;
  paperUpdate = function(s, events){ pu(s, events); mtDecorate(); };
  if(typeof pgPositions === "function"){ const pp = pgPositions; pgPositions = function(){ pp(); mtPositions(); }; }
  if(typeof renderPlan === "function"){ const rp = renderPlan; renderPlan = function(){ rp(); mtPlace(); mtPerMove(); }; }
  if(typeof ticketBody === "function"){ const tb = ticketBody; ticketBody = function(){ const b = tb(); if(mtOn()) b.dayend = mtDeNow(); return b; }; }   // (v0.40.0: preview and PLACE)
  if(typeof toolOverlay === "function"){ const to = toolOverlay; toolOverlay = function(){ to(); mtPlace(); mtDeChip(); }; }
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

/* v0.37.1: on the MT5 side, a terminal that connects after the page loaded joins the switcher (and ● / ○ stays current)
   without a reload: the account list is re-read every 15 s and the switcher rebuilt only when it changed */
setInterval(async () => {
  try{
    if(typeof sideMT5 !== "function" || !sideMT5() || document.hidden) return;
    const j = await api("/api/accounts"); if(!j.ok) return;
    const key = a => JSON.stringify((a || []).filter(x => x.mode === "mt5").map(x => [x.id, x.online, x.balance != null ? Math.round(x.balance) : null]));
    if(key(j.accounts) !== key(S.accounts)){ S.accounts = j.accounts; acctSetup(); }
  }catch(e){}
}, 15000);

function mtCommCell(c, leg){
  if(c[leg] == null) return '<span class="warnc">not known</span>';
  const m = n => CUR() + (+n).toFixed(2);
  const fix = c[leg + "_fix"] ? ` + ${m(c[leg + "_fix"])} a deal` : "";
  return `${m(c[leg])}${fix}` + (c[leg + "_n"] ? ` <span class="muted">(${c[leg + "_n"]})</span>` : "");
}
function mtCommSrc(c){
  const a = (c.src || {}).in || "", b = (c.src || {}).out || "";
  return a === b ? a : [a && "opening: " + a, b && "closing: " + b].filter(Boolean).join("; ");
}
/* v0.37.2: the ticket's preview says what a 1.00 move is worth on 1 lot and where that comes from, so a wrong figure shows */
function mtPerMove(){
  const el = $("#tkPv"), p = P.plan;
  if(!el || !mtOn() || !p || !p.per_move) return;
  let d = el.querySelector(".mtper");
  const c = p.comm || {}, cs = (c.src || {});
  const h = `1 lot: ${CUR()}${(+p.per_move).toLocaleString("en-US", {maximumFractionDigits: 2})} per 1.00 move · ${p.tv_src || ""}`   // (textContent: no escaping)
    + (c.in != null ? ` · commission ${CUR()}${(+c.in).toFixed(2)} / ${CUR()}${(+(c.out || 0)).toFixed(2)} a lot (opening / closing), ${cs.in === cs.out ? cs.in : cs.in + " / " + cs.out}` : "");
  if(!d){ d = document.createElement("div"); d.className = "mtper muted"; d.style.cssText = "font-size:11px;margin-top:4px"; el.appendChild(d); }
  if(d.textContent !== h) d.textContent = h;
}

/* ---------------------------------------------------------------- v0.40.0: the day-end close (rules on the Account page)
   MT5 trades are closed X minutes before the broker's day ends, every day or only on Fridays, all of them or only the ones
   marked "close". The ticket's "At the day end" (the chart tool's DAY END / HOLD) marks new orders and stays the default
   (trades placed in MT5 itself take it too); ⏱ on each trade changes its own. */
function mtDeNow(){ return P.mtDe != null ? P.mtDe : !!((P.snap && P.snap.ticket) || {}).dayend; }
function mtDeTip(d){ return `${d.at_ist} IST, ${(+d.min).toLocaleString("en-US")} min before the broker's day ends${d.when === "weekend" ? " (Fridays only)" : ""}`; }
async function mtDeSet(v){
  P.mtDe = !!v; mtDeTicket(); mtDeChip();
  const j = await api("/api/paper/ticket", {body: {dayend: !!v}});
  if(j.ok){ if(P.snap && P.snap.ticket) P.snap.ticket.dayend = !!v; P.mtDe = null; } else toast(j.error || "Couldn't save");
  if(P.armed && typeof preview === "function") preview();
  if(typeof mTicketFill === "function") mTicketFill();
}
function mtDeTicket(){
  const pe = $("#tkProd"); if(!pe) return;
  const host = pe.parentElement && pe.parentElement.parentElement; if(!host) return;
  let b = $("#mtDeBox");
  const d = mtOn() ? mtM().dayend : null;
  if(!d){ if(b) b.classList.add("hide"); return; }
  if(!b){ b = document.createElement("div"); b.id = "mtDeBox";
    b.innerHTML = `<label>At the day end</label><select id="mtDeSel"><option value="1">Close it</option><option value="0">Hold</option></select>`;
    host.append(b); $("#mtDeSel").onchange = e => mtDeSet(e.target.value === "1"); }
  b.classList.remove("hide");
  const sel = $("#mtDeSel"), all = d.scope === "all";
  sel.disabled = all; sel.value = all || mtDeNow() ? "1" : "0";
  b.title = all ? `Every MT5 trade is closed at the day end: ${mtDeTip(d)} (Account › rules)` : `Close this trade at the day end (${mtDeTip(d)}) or hold it. Stays the default for later trades.`;
}
function mtDeChip(){
  let c = $("#tDayEnd");
  const d = mtOn() ? mtM().dayend : null, pl = $("#tPlace");
  if(!d || !pl){ if(c) c.remove(); return; }
  if(!c || c.nextElementSibling !== pl){ if(c) c.remove(); c = document.createElement("button"); c.id = "tDayEnd"; c.className = "tx tprod";
    pl.before(c); c.onclick = () => { const x = mtM().dayend; if(x && x.scope !== "all") mtDeSet(!mtDeNow()); }; }
  const on = d.scope === "all" || mtDeNow();
  c.textContent = on ? "DAY END" : "HOLD"; c.classList.toggle("carry", !on);
  c.title = d.scope === "all" ? `Closed at the day end: ${mtDeTip(d)} (every MT5 trade)` : on ? `Closed at the day end (${mtDeTip(d)}). Click to hold it` : `Held over the day end. Click to close it at ${d.at_ist} IST`;
}
function mtDeBtn(host, x){
  const d = mtM().dayend;
  let b = host.querySelector(":scope > .mtde");
  if(!d || d.scope === "all"){ if(b) b.remove(); return; }
  if(!b){ b = document.createElement("button"); b.type = "button"; b.className = "mtde"; host.append(b);
    b.onclick = async ev => { ev.stopPropagation(); ev.preventDefault();
      const j = await api("/api/mt5acct/dayend", {body: {id: b.dataset.id, on: b.dataset.on !== "1"}});
      if(j.paper) paperUpdate(j.paper); else if(!j.ok) toast(j.error || "Refused"); }; }
  const on = !!x.dayend;
  b.dataset.id = x.id; b.dataset.on = on ? "1" : "0"; b.classList.toggle("on", on);
  const txt = on ? `⏱ closes at ${d.at_ist} IST` : "⏱ held over the day end";
  if(b.textContent !== txt) b.textContent = txt;
  b.title = on ? "Closed at the day end. Click to hold it" : `Click to close it at the day end (${mtDeTip(d)})`;
}
/* the phone: the order sheet's row, and the trade / order sheets' mark */
document.addEventListener("DOMContentLoaded", () => {
  const rowHtml = (on, all) => `<div class="mrow mtde-row"><span>At the day end</span><div class="mseg" data-g="mtde" style="margin:0">
    <button data-v="1" class="${on ? "on" : ""}">Close it</button><button data-v="0" class="${on ? "" : "on"}"${all ? " disabled" : ""}>Hold</button></div></div>`;
  if(typeof mTicketBuild === "function"){
    const tb = mTicketBuild;
    mTicketBuild = function(){ tb.apply(this, arguments); const d = mtOn() ? mtM().dayend : null, box = document.querySelector("#mTk .sbody"), pv = document.querySelector("#mtPv");
      if(!d || !box || !pv || box.querySelector(".mtde-row")) return;
      pv.insertAdjacentHTML("beforebegin", rowHtml(d.scope === "all" || mtDeNow(), d.scope === "all"));
      box.querySelectorAll('[data-g="mtde"] button').forEach(b => b.onclick = () => { if(mtM().dayend.scope === "all") return;
        box.querySelectorAll('[data-g="mtde"] button').forEach(x => x.classList.toggle("on", x === b)); mtDeSet(b.dataset.v === "1"); }); };
  }
  const sheet = (orig, find) => function(id){
    orig.apply(this, arguments);
    const d = mtOn() ? mtM().dayend : null, x = find(id), sh = document.querySelector("#mSheet");
    if(!d || !x || !sh || d.scope === "all" || sh.querySelector(".mtde-row")) return;
    const anchor = sh.querySelector(".mbtns") || sh.lastElementChild;
    anchor.insertAdjacentHTML("beforebegin", rowHtml(!!x.dayend, false));
    sh.querySelectorAll('[data-g="mtde"] button').forEach(b => b.onclick = async () => {
      const j = await api("/api/mt5acct/dayend", {body: {id, on: b.dataset.v === "1"}});
      if(j.paper) paperUpdate(j.paper);
      if(j.ok) sh.querySelectorAll('[data-g="mtde"] button').forEach(y => y.classList.toggle("on", y === b)); else toast(j.error || "Refused"); });
  };
  if(typeof mPosSheet === "function") window.mPosSheet = mPosSheet = sheet(mPosSheet, id => P.snap && P.snap.positions.find(p => p.id === id));
  if(typeof mOrdSheet === "function") window.mOrdSheet = mOrdSheet = sheet(mOrdSheet, id => P.snap && P.snap.orders.find(o => o.id === id));
});
