/* Journal, third step (v0.28.0, roadmap item 4): Insights, the weekly Review with its calendar and the walk-through,
   Copy for Gemini, and Settings › Export and backup. Ported from Octagon (renderInsights, renderReview, renderCalendar,
   startWalk, aiExportText, exportCsv / exportJson); money and R are the app's net figures, days are IST.
   Loaded after journal.js and jshots.js. Server: /api/journal/review, /export.csv, /backup.zip, /restore. */
const JI = {rv: {mode: null, week: null, month: null, acct: null, filter: "won"}, walk: {ids: [], i: 0, label: ""}, ai: {trade: null, week: null}};
const JI_TOD = ["Before 09:15", "Opening hour", "Morning", "Midday", "Afternoon", "After NSE close", "Evening", "Night (US hours)"];
const JI_DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const JI_QUADS = {
  "won|held": {name: "Earned win", plural: "Earned wins", tone: "good", what: "Octagon held and it paid. Repeat exactly this."},
  "won|broke": {name: "Lucky win", plural: "Lucky wins", tone: "warn", what: "Paid despite a broken pillar — the most dangerous result, because it rewards the mistake."},
  "lost|held": {name: "Good loss", plural: "Good losses", tone: "calm", what: "Octagon held; the setup just didn't work. The cost of doing business — nothing to fix."},
  "lost|broke": {name: "Earned loss", plural: "Earned losses", tone: "bad", what: "A broken pillar and a loss. These are the ones to fix."}
};
const JI_AI_WORD = {pass: "held", fail: "BROKEN", warn: "check", na: "not recorded", off: "doesn't apply"};

/* ------------------------------------------------------------------ small pieces */
function jiWeekStart(key){ const d = new Date(key + "T00:00:00Z"); return jAddDays(key, -((d.getUTCDay() + 6) % 7)); }
function jiWeekLabel(start){
  const end = jAddDays(start, 6), [y1, m1, d1] = start.split("-").map(Number), [y2, m2, d2] = end.split("-").map(Number);
  return m1 === m2 ? `${d1}–${d2} ${J_MONTHS[m1 - 1]} ${y2}` : `${d1} ${J_MONTHS[m1 - 1]}${y1 !== y2 ? " " + y1 : ""} – ${d2} ${J_MONTHS[m2 - 1]} ${y2}`;
}
function jiCloseDay(t){ return jDayKey(t.status === "closed" && t.closed ? t.closed : t.opened); }
function jiProcess(a){ return a.breaches.length ? "broke" : a.P.p3.state === "pass" ? "held" : "unaudited"; }
function jiOutcome(t){ return t.net > 0 ? "won" : t.net < 0 ? "lost" : "even"; }
function jiQuad(t){ return JI_QUADS[`${jiOutcome(t)}|${jiProcess(t.audit)}`] || null; }
function jiPct(v, d = 1){ return v == null || !isFinite(v) ? "—" : `${v >= 0 ? "" : "−"}${Math.abs(v * 100).toFixed(d)}%`; }
function jiRatio(v, d = 2){ return v == null || Number.isNaN(v) ? "—" : v === Infinity ? "∞" : v.toFixed(d); }
function jiSpan(sec){ if(!sec) return "—"; const d = sec / 86400; return d >= 1 ? `${d.toFixed(d < 10 ? 1 : 0)} days` : jDur(Math.round(sec)); }
function jiShortMoney(v){
  if(v == null || !isFinite(v)) return "—";
  const a = Math.abs(v), s = v > 0 ? "+" : v < 0 ? "−" : "";
  return a < 1000 ? `${s}₹${Math.round(a)}` : a < 100000 ? `${s}₹${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k` : `${s}₹${(a / 100000).toFixed(a >= 1e6 ? 0 : 1)}L`;
}
function jiSum(items){ const s = jSummary(items), withR = items.filter(t => t.status === "closed" && t.r != null); s.totalR = withR.reduce((a, t) => a + t.r, 0); return s; }
function jiClosed(items){ return items.filter(t => t.status === "closed" && t.net != null && t.closed != null); }
function jiAcctSize(id){ const a = ((JN.d && JN.d.accounts) || []).find(x => x.id === id); return a ? a.size || 0 : 0; }
async function jiCopy(text, okMsg){
  try{ await navigator.clipboard.writeText(text); jToast(okMsg || "Copied"); return true; }
  catch(e){ jToast("Your browser blocked the clipboard: select the text and copy it"); return false; }
}

/* ------------------------------------------------------------------ Insights */
function jiRow(label, items){
  const s = jiSum(items), wr = s.winRate == null ? null : Math.round(s.winRate * 100);
  return `<tr><td>${label}<div class="ji-bar"><i style="width:${wr ?? 0}%"></i></div></td><td>${s.closed}</td><td>${wr == null ? "—" : wr + "%"}</td>
    <td class="${s.net > 0 ? "up" : s.net < 0 ? "down" : ""}">${s.closed ? jMoney(s.net) : "—"}</td><td>${jR(s.avgR)}</td></tr>`;
}
function jiTable(title, note, rows){
  if(!rows.length) return "";
  return `<div class="jn-card ji-tcard"><h3>${title}</h3>${note ? `<p class="muted jn-small">${note}</p>` : ""}
    <div class="ji-tscroll"><table class="ji-table"><thead><tr><th></th><th>Trades</th><th>Win %</th><th>Net</th><th>Avg R</th></tr></thead><tbody>${rows.join("")}</tbody></table></div></div>`;
}
function jiGroup(items, keyFn, order){
  const g = new Map();
  items.forEach(t => { const k = keyFn(t); if(!k) return; if(!g.has(k)) g.set(k, []); g.get(k).push(t); });
  const keys = order ? order.filter(k => g.has(k)) : [...g.keys()].sort((a, b) => g.get(b).length - g.get(a).length);
  return keys.map(k => jiRow(jEsc(k), g.get(k)));
}
function jiBase(items){
  const f = jF();
  if(f.acct) return jiAcctSize(f.acct) || 0;
  return [...new Set(items.map(t => t.acct))].reduce((s, id) => s + jiAcctSize(id), 0);
}
function jiPerf(items, base){
  const c = jiClosed(items).sort((a, b) => a.closed - b.closed), n = c.length;
  if(!n) return null;
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const sd = a => { if(a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
  const nets = c.map(t => t.net), wins = nets.filter(v => v > 0), losses = nets.filter(v => v < 0);
  const winRate = wins.length / n, avgWin = wins.length ? mean(wins) : 0, avgLoss = losses.length ? mean(losses) : 0;
  const gw = wins.reduce((s, v) => s + v, 0), gl = -losses.reduce((s, v) => s + v, 0), payoff = avgLoss ? avgWin / Math.abs(avgLoss) : null;
  const Rs = c.map(t => t.r).filter(r => r != null), expR = Rs.length ? mean(Rs) : null, sdR = sd(Rs);
  base = base || 1;
  let cum = 0, peak = 0, peakAt = c[0].opened ?? c[0].closed, maxDD = 0, maxDDpct = 0, longest = 0, inDD = false;
  c.forEach(t => { cum += t.net;
    if(cum >= peak - 1e-9){ if(inDD) longest = Math.max(longest, t.closed - peakAt); peak = cum; peakAt = t.closed; inDD = false; }
    else { inDD = true; maxDD = Math.max(maxDD, peak - cum); maxDDpct = Math.max(maxDDpct, (peak - cum) / (base + peak)); } });
  if(inDD) longest = Math.max(longest, Date.now() / 1000 - peakAt);
  const byDay = new Map(); c.forEach(t => { const k = jDayKey(t.closed); byDay.set(k, (byDay.get(k) || 0) + t.net); });
  const dayPnl = [...byDay.values()], dayRet = dayPnl.map(v => v / base);
  const mD = mean(dayRet), sdD = sd(dayRet), down = Math.sqrt(mean(dayRet.map(r => Math.min(0, r) ** 2)));
  const spanDays = Math.max(1, (c[n - 1].closed - c[0].closed) / 86400), totalRet = cum / base, annual = totalRet * 365 / spanDays;
  let ws = 0, ls = 0, maxWs = 0, maxLs = 0;
  nets.forEach(v => { if(v > 0){ ws++; ls = 0; } else if(v < 0){ ls++; ws = 0; } else { ws = 0; ls = 0; } maxWs = Math.max(maxWs, ws); maxLs = Math.max(maxLs, ls); });
  const hold = l => { const d = l.filter(t => t.opened != null).map(t => t.closed - t.opened); return d.length ? mean(d) : null; };
  const fees = c.reduce((s, t) => s + (t.charges || 0), 0), grossWin = c.reduce((s, t) => s + Math.max(0, t.gross || 0), 0);
  return {n, base, days: byDay.size, spanDays, net: cum, totalRet, annual, expectancy: mean(nets), expR, winRate, payoff,
    pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : null), sqn: Rs.length >= 2 && sdR > 0 ? expR / sdR * Math.sqrt(Math.min(Rs.length, 100)) : null, nR: Rs.length,
    kelly: payoff ? winRate - (1 - winRate) / payoff : null,
    sharpe: dayRet.length >= 2 && sdD > 0 ? mD / sdD * Math.sqrt(252) : null,
    sortino: dayRet.length >= 2 && down > 0 ? mD / down * Math.sqrt(252) : (dayRet.length >= 2 && mD > 0 ? Infinity : null),
    maxDD, maxDDpct, curDD: peak - cum, curDDpct: (peak - cum) / (base + peak), longest,
    calmar: maxDDpct > 0 ? annual / maxDDpct : null, recovery: maxDD > 0 ? cum / maxDD : null,
    greenDays: dayPnl.filter(v => v > 0).length / byDay.size, bestDay: Math.max(...dayPnl), worstDay: Math.min(...dayPnl), avgDay: mean(dayPnl),
    maxWs, maxLs, bigWin: Math.max(...nets), bigLoss: Math.min(...nets),
    holdWin: hold(c.filter(t => t.net > 0)), holdLoss: hold(c.filter(t => t.net < 0)), fees, feeShare: grossWin > 0 ? fees / grossWin : null};
}
function jiPerfCard(items){
  const st = jiPerf(items, jiBase(items)); if(!st) return "";
  const tone = v => v > 0 ? "up" : v < 0 ? "down" : "";
  const small = st.days < 20 || st.spanDays < 30;
  const row = (label, value, what, cls = "") => `<div class="ji-stat"><span>${label}</span><b class="mono ${cls}">${value}</b><small>${what}</small></div>`;
  const group = (title, rows) => `<div class="ji-sgroup"><h4>${title}</h4>${rows.join("")}</div>`;
  return `<div class="jn-card ji-perf"><div class="ji-chead"><h3>Performance</h3><span class="muted jn-small">${st.n} closed trades over ${st.days} trading day${st.days === 1 ? "" : "s"} · measured on ${jMoney(st.base, false)}</span></div>
    ${small ? `<p class="warnc jn-small">Sharpe, Sortino and Calmar need a few weeks of trading to mean much: with ${st.days} trading day${st.days === 1 ? "" : "s"}, read them as rough.</p>` : ""}
    <div class="ji-sgrid">
      ${group("Edge", [row("Expectancy", jMoney(st.expectancy), "Average net result per trade, after every charge.", tone(st.expectancy)),
        row("Expectancy in R", st.expR == null ? "—" : jR(st.expR), "Average result in units of the net risk at the first stop.", tone(st.expR)),
        row("Win rate", jiPct(st.winRate, 0), "Share of closed trades that made money (net)."),
        row("Payoff ratio", jiRatio(st.payoff), "Average win divided by average loss."),
        row("Profit factor", jiRatio(st.pf), "Gross profit divided by gross loss (net of charges)."),
        row("SQN", jiRatio(st.sqn), st.nR ? `Van Tharp's System Quality Number from ${st.nR} trades with a stop: 2–3 is good, above 3 excellent.` : "Needs trades with a stop."),
        row("Kelly", jiPct(st.kelly), "Share of capital the edge would justify risking in theory. Most traders use a fraction of it.", tone(st.kelly))])}
      ${group("Risk-adjusted", [row("Sharpe ratio", jiRatio(st.sharpe), "Daily return ÷ its volatility, annualised (252 days). Above 1 is good, above 2 very good.", tone(st.sharpe)),
        row("Sortino ratio", jiRatio(st.sortino), "Like Sharpe, but only losing days count as risk.", tone(st.sortino)),
        row("Calmar ratio", jiRatio(st.calmar), "Annualised return ÷ the maximum drawdown.", tone(st.calmar)),
        row("Recovery factor", jiRatio(st.recovery), "Net profit ÷ the maximum drawdown.", tone(st.recovery)),
        row("Return", jiPct(st.totalRet, 2), `Net ${jMoney(st.net)} on the base; about ${jiPct(st.annual, 0)} a year at this pace.`, tone(st.totalRet))])}
      ${group("Drawdown", [row("Maximum drawdown", jMoney(st.maxDD, false), `Largest fall from a peak in closed-trade equity: ${jiPct(st.maxDDpct, 2)} of the account.`),
        row("Current drawdown", st.curDD > 0.005 ? jMoney(st.curDD, false) : "At a high", st.curDD > 0.005 ? `Below the last peak: ${jiPct(st.curDDpct, 2)} of the account.` : "How far below the last peak you are now.", st.curDD > 0.005 ? "down" : "up"),
        row("Longest drawdown", jiSpan(st.longest), "Longest stretch from a peak to the next new high."),
        row("Worst day", jMoney(st.worstDay), "Your largest losing day.", tone(st.worstDay)),
        row("Longest losing run", `${st.maxLs} trade${st.maxLs === 1 ? "" : "s"}`, "Most losing trades in a row.")])}
      ${group("Consistency", [row("Green days", jiPct(st.greenDays, 0), "Share of trading days that finished positive."),
        row("Average day", jMoney(st.avgDay), `Best ${jMoney(st.bestDay)}, worst ${jMoney(st.worstDay)}.`, tone(st.avgDay)),
        row("Longest winning run", `${st.maxWs} trade${st.maxWs === 1 ? "" : "s"}`, "Most winning trades in a row."),
        row("Largest win", jMoney(st.bigWin), "Single best trade.", tone(st.bigWin)),
        row("Largest loss", jMoney(st.bigLoss), "Single worst trade.", tone(st.bigLoss)),
        row("Average hold, winners", st.holdWin == null ? "—" : jDur(Math.round(st.holdWin)), "How long winning trades stayed open."),
        row("Average hold, losers", st.holdLoss == null ? "—" : jDur(Math.round(st.holdLoss)), st.holdWin != null && st.holdLoss != null && st.holdLoss > st.holdWin ? "Losers are held longer than winners: a common leak." : "How long losing trades stayed open."),
        row("Charges", jMoney(st.fees, false), `Every charge, entry and exit${st.feeShare != null ? `: ${jiPct(st.feeShare, 0)} of gross profit` : ""}.`)])}
    </div></div>`;
}
function jiEquityCard(items){
  const bal = jPref().curve !== "pl", v = jCurveView(items, bal);
  if(!v.n) return "";
  const dd = jDrawdown(v);
  let b = v.start, peak = v.start; const ys = [v.start], ds = [0];
  for(const t of v.pts){ b += t.net; peak = Math.max(peak, b); ys.push(b); ds.push(-(peak - b)); }
  const W = 800, H = 170, H2 = 56, n = ys.length;
  const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1, dmin = Math.min(...ds) || -1;
  const X = i => n < 2 ? W / 2 : i / (n - 1) * W, Y = y => 6 + (H - 12) * (1 - (y - min) / span), Y2 = y => H2 * (y / dmin);
  const line = ys.map((y, i) => `${X(i).toFixed(1)},${Y(y).toFixed(1)}`).join(" "), dline = ds.map((y, i) => `${X(i).toFixed(1)},${Y2(y).toFixed(1)}`).join(" ");
  const y0 = Y(v.start).toFixed(1), up = b >= v.start;
  return `<div class="jn-card ji-eq"><div class="ji-chead"><h3>Equity curve</h3>
      <span class="seg" id="jiCurve"><button data-v="bal" class="${bal ? "on" : ""}">Balance</button><button data-v="pl" class="${bal ? "" : "on"}">P&amp;L</button></span></div>
    <div class="ji-eqstats"><div><span>Net</span><b class="${dd.end - dd.start > 0 ? "up" : dd.end - dd.start < 0 ? "down" : ""}">${jMoney(dd.end - dd.start)}</b></div>
      ${bal ? `<div><span>Balance</span><b>${jMoney(dd.end, false)}</b></div>` : ""}<div><span>Peak</span><b>${jMoney(dd.peak, !bal)}</b></div>
      <div><span>Max drawdown</span><b class="down">${jMoney(dd.maxDd, false)}</b>${bal ? `<small>${dd.maxDdPct.toFixed(2)}%</small>` : ""}</div>
      <div><span>Below peak now</span><b class="${dd.nowDd > 0.005 ? "down" : "up"}">${dd.nowDd > 0.005 ? jMoney(dd.nowDd, false) : "at the high"}</b></div><div><span>Trades</span><b>${v.n}</b></div></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="ji-eqsvg ${up ? "jc-up" : "jc-down"}"><line x1="0" x2="${W}" y1="${y0}" y2="${y0}" class="jc-base" vector-effect="non-scaling-stroke"/>
      <polygon points="0,${y0} ${line} ${W},${y0}" class="jc-fill"/><polyline points="${line}" class="jc-line" vector-effect="non-scaling-stroke"/></svg>
    <svg viewBox="0 0 ${W} ${H2}" preserveAspectRatio="none" class="ji-ddsvg"><polygon points="0,0 ${dline} ${W},0" class="ji-ddfill"/><polyline points="${dline}" class="ji-ddline" vector-effect="non-scaling-stroke"/></svg>
    <p class="muted jn-small">Each step is the ${bal ? "balance" : "running P&L"} after a closed trade (net of charges), in order of closing; below, how far it was under the previous peak.${bal ? " The start is each account's balance before its first trade in view." : ""}</p></div>`;
}
function jiLockouts(items){
  const keys = [...new Set(items.map(t => t.skey))], out = {sessions: 0, ddHit: 0, ddIgnored: 0, afk: 0, afkIgnored: 0, term: 0, termIgnored: 0, worstDd: 0};
  keys.forEach(k => {
    const s = JN.d.sessions[k]; if(!s) return;
    out.sessions++; out.worstDd = Math.max(out.worstDd, s.maxDd || 0);
    const list = JN.d.trades.filter(t => t.skey === k && !t.hidden);
    if(s.ddLockAt != null){ out.ddHit++; if(list.some(t => t.audit.P.p4.state === "fail")) out.ddIgnored++; }
    out.afk += s.lockouts.length;
    out.afkIgnored += s.lockouts.filter(l => list.some(t => t.opened >= l.from && t.opened < l.to)).length;
    if(s.termAt != null){ out.term++; if(list.some(t => !t.numberRunning && t.opened > s.termAt)) out.termIgnored++; }
  });
  return out;
}
function jiRepBlocks(items){
  const B = JN.d.reps.block, g = new Map();
  items.forEach(t => { if(!t.rep) return; const b = Math.ceil(t.rep / B); if(!g.has(b)) g.set(b, []); g.get(b).push(t); });
  if(!g.size) return "";
  const rows = [...g.keys()].sort((a, b) => b - a).map(b => {
    const list = g.get(b), s = jiSum(list), lo = (b - 1) * B + 1, hi = b * B, live = JN.d.reps.total < hi;
    const days = list.map(t => jDayKey(t.closed)).sort(), span = days[0] === days[days.length - 1] ? jFmtDay(days[0]) : `${jFmtDay(days[0])} – ${jFmtDay(days[days.length - 1])}`;
    const aud = list.filter(t => t.q !== "unaudited"), held = aud.filter(t => t.q === "held"), hp = aud.length ? Math.round(held.length / aud.length * 100) : null;
    return `<tr><td>${lo}–${hi}${live ? ` <span class="muted">· ${JN.d.reps.total - lo + 1} done</span>` : ""}<div class="muted jn-xs">${jEsc(span)}</div><div class="ji-bar"><i style="width:${hp ?? 0}%"></i></div></td>
      <td>${s.winRate == null ? "—" : Math.round(s.winRate * 100) + "%"}</td><td class="${s.net > 0 ? "up" : s.net < 0 ? "down" : ""}">${s.closed ? jMoney(s.net) : "—"}</td><td>${hp == null ? "—" : hp + "%"}</td></tr>`;
  });
  return `<div class="jn-card ji-tcard"><h3>Rep blocks</h3><p class="muted jn-small">Each block is ${B} reps. The bar and the last column: the share of audited reps with no pillar broken.</p>
    <div class="ji-tscroll"><table class="ji-table"><thead><tr><th>Reps</th><th>Win %</th><th>Net</th><th>Held</th></tr></thead><tbody>${rows.join("")}</tbody></table></div></div>`;
}
function jiRepRuns(items){
  const list = items.filter(t => t.rep).sort((a, b) => a.rep - b.rep), runs = [];
  list.forEach(t => { const r = runs[runs.length - 1]; if(r && r.acct === t.acct && t.rep === r.to + 1){ r.to = t.rep; r.items.push(t); } else runs.push({acct: t.acct, name: t.acct_name, from: t.rep, to: t.rep, items: [t]}); });
  if(runs.length < 2 && new Set(list.map(t => t.acct)).size < 2) return "";
  const rows = runs.slice(-30).reverse().map(r => { const s = jiSum(r.items);
    return `<tr><td><span class="mono">${r.from === r.to ? r.from : `${r.from}–${r.to}`}</span> · ${jEsc(r.name)}</td><td>${r.to - r.from + 1}</td><td>${s.winRate == null ? "—" : Math.round(s.winRate * 100) + "%"}</td><td class="${s.net > 0 ? "up" : s.net < 0 ? "down" : ""}">${s.closed ? jMoney(s.net) : "—"}</td></tr>`; });
  return `<div class="jn-card ji-tcard"><h3>Reps by account</h3><p class="muted jn-small">Reps keep counting across accounts: each line is a stretch of reps on one account${runs.length > 30 ? " (latest 30)" : ""}.</p>
    <div class="ji-tscroll"><table class="ji-table"><thead><tr><th>Reps</th><th>Count</th><th>Win %</th><th>Net</th></tr></thead><tbody>${rows.join("")}</tbody></table></div></div>`;
}
function jiInsights(){
  const body = jq("#jnBody"); if(!body || !JN.d) return;
  const items = jFiltered({ignoreOct: true}), s = jiSum(items);
  const aud = items.filter(t => t.audit.recorded), clean = items.filter(t => t.audit.clean);
  const kpi = (k, v) => `<div class="ji-kpi"><span>${k}</span><b class="mono">${v}</b></div>`;
  let html = `<div class="ji-kpis">${kpi("Net P&L", s.closed ? `<span class="${s.net > 0 ? "up" : s.net < 0 ? "down" : ""}">${jMoney(s.net)}</span>` : "—")}${kpi("Closed trades", s.closed)}
    ${kpi("Win rate", s.winRate == null ? "—" : Math.round(s.winRate * 100) + "%")}${kpi("Expectancy", s.closed ? jMoney(s.net / s.closed) : "—")}${kpi("Average R", jR(s.avgR))}
    ${kpi("Total R", s.avgR != null ? jR(s.totalR) : "—")}${kpi("Clean octagon", aud.length ? `${clean.length} / ${aud.length} (${Math.round(clean.length * 100 / aud.length)}%)` : "—")}</div>
    <p class="muted jn-small ji-scope">The filters above decide which trades count (the Octagon filter is left out here, so held and broken trades can be compared).</p>`;
  if(!items.length){ body.innerHTML = html + `<div class="empty">No trades in this filter yet.</div>`; return; }
  const broken = items.filter(t => t.audit.breaches.length), notAud = items.filter(t => !t.audit.recorded && !t.audit.breaches.length);
  const octRows = [jiRow("Clean octagon <span class='muted'>— all 8 held</span>", clean), jiRow("Any pillar broken", broken)];
  if(notAud.length) octRows.push(jiRow("<span class='muted'>Not fully audited</span>", notAud));
  jPillars().forEach(p => { const g = items.filter(t => t.audit.P["p" + p.n].state === "fail"); if(g.length) octRows.push(jiRow(`<span class="jb jb-bad">${p.n}</span> ${jEsc(p.title)}`, g)); });
  const L = jiLockouts(items), after = items.filter(t => t.audit.P.p4.state === "fail" || t.audit.P.p5.state === "fail"), afterNet = jiSum(after).net;
  const f = jF(), r = jPeriodRange(f.period, f);
  const practice = Object.entries(JN.d.practice || {}).filter(([k, v]) => v && (!r || (k >= r.from && k <= r.to))).length;
  const lk = (k, v, sub) => `<div class="ji-kpi"><span>${k}</span><b>${v}${sub || ""}</b></div>`;
  const ign = (n, ig) => n ? ` <small class="${ig ? "down" : "up"}">· ${ig} ignored</small>` : "";
  const lockCard = `<div class="jn-card ji-wide"><h3>Lockouts <span class="muted jn-small">pillars 4 and 5</span></h3><div class="ji-kpis">
    ${lk("Sessions traded", L.sessions)}${lk(`${JN.d.rules.dd_pct}% lockouts hit`, L.ddHit, ign(L.ddHit, L.ddIgnored))}${lk("99 Club breaks", L.afk, ign(L.afk, L.afkIgnored))}
    ${lk("Number-running stops", L.term, ign(L.term, L.termIgnored))}${lk("Trades after a lockout", after.length, after.length ? ` <small class="${afterNet >= 0 ? "up" : "down"}">${jMoney(afterNet)}</small>` : "")}
    ${lk("Worst session pullback", jMoney(L.worstDd, false))}${lk("Practice days", practice)}</div></div>`;
  const waitRows = JN.d.oct.wait.map(v => [v, items.filter(t => t.wait === v)]).filter(([, g]) => g.length).map(([v, g]) => jiRow(jEsc(v), g));
  const numCards = [["bias", "Bias"], ["ke", "KE"]].map(([k, label]) => items.some(t => t[k] != null)
    ? jiTable(label, `Your ${label} on each trade. Average across recorded trades: ${(() => { const b = items.filter(t => t[k] != null).map(t => t[k]); return jBias(Math.round(b.reduce((s, v) => s + v, 0) / b.length * 100) / 100); })()}.`,
      jiGroup(items, t => t[k] == null ? "Not recorded" : t[k] > 0 ? "Positive" : t[k] < 0 ? "Negative" : "Zero", ["Positive", "Zero", "Negative", "Not recorded"])) : "").join("");
  const tags = [...new Set(items.flatMap(t => t.setup || []))];
  html += jiEquityCard(items) + jiPerfCard(items) + `<div class="ji-grid">` + jiRepBlocks(items) + jiRepRuns(items)
    + jiTable("Octagon discipline", "Does holding the framework pay? Compare the clean line with each broken pillar.", octRows) + lockCard
    + jiTable("Wait state at the click", "Only Patient is allowed to click.", waitRows)
    + jiTable("Time of day", "From the open time, IST.", jiGroup(items, t => t.tod, JI_TOD))
    + jiTable("Weekday", "From the open day, IST.", jiGroup(items, t => t.opened != null ? JI_DOW[(new Date((t.opened + 19800) * 1000).getUTCDay() + 6) % 7] : "", JI_DOW))
    + (items.some(t => t.regime) ? jiTable("Market regime", "The market's character at the click. Which regimes suit your setups?", jiGroup(items, t => t.regime || "Not recorded", [...JN.d.oct.regime, "Not recorded"])) : "")
    + numCards
    + jiTable("Contract", "", jiGroup(items, t => jShort(t.s)))
    + jiTable("Side", "", jiGroup(items, t => t.side > 0 ? "Buy" : "Sell", ["Buy", "Sell"]))
    + (tags.length ? jiTable("Setup", "A trade with several tags counts in each.", tags.map(g => [g, items.filter(t => (t.setup || []).includes(g))]).sort((a, b) => b[1].length - a[1].length).map(([g, l]) => jiRow(jEsc(g), l))) : "")
    + jiTable("Exit", "How the trade ended.", jiGroup(items.filter(t => t.status === "closed"), t => (J_REASON[t.reason] || t.reason || "other").replace(/^./, c => c.toUpperCase())))
    + (new Set(items.map(t => t.acct)).size > 1 ? jiTable("Account", "", jiGroup(items, t => t.acct_name + (t.mode === "live" ? " · LIVE" : ""))) : "")
    + `</div>`;
  body.innerHTML = html;
  jqa("#jiCurve button").forEach(b => b.onclick = () => { jPrefSet("curve", b.dataset.v); jiInsights(); });
}

/* ------------------------------------------------------------------ the weekly Review and the calendar */
function jiRvAcct(){ return JI.rv.acct ?? (jF().acct || ""); }
function jiRvItems(){ const acc = jiRvAcct(); return JN.d.trades.filter(t => !t.hidden && t.status === "closed" && t.net != null && (!acc || t.acct === acc)); }
function jiIn(all, from, to){ return all.filter(t => { const k = jiCloseDay(t); return k >= from && k <= to; }); }
function jiWeekStats(all, start){
  const end = jAddDays(start, 6), items = jiIn(all, start, end), s = jiSum(items);
  const reps = items.map(t => t.rep).filter(Boolean).sort((a, b) => a - b);
  const aud = items.filter(t => t.q !== "unaudited"), held = aud.filter(t => t.q === "held");
  const pillars = jPillars().map(p => { const br = items.filter(t => t.audit.P["p" + p.n].state === "fail"); return {n: p.n, count: br.length, net: br.reduce((a, t) => a + t.net, 0)}; });
  let practice = 0; for(let i = 0; i < 7; i++) if(JN.d.practice[jAddDays(start, i)]) practice++;
  return {start, end, items, s, reps, audited: aud.length, held: held.length, clean: items.filter(t => t.audit.clean).length, lock: items.length ? jiLockouts(items) : null, pillars, practice};
}
function jiReview(){
  const body = jq("#jnBody"); if(!body || !JN.d) return;
  const mode = JI.rv.mode || (jPref().rvMode === "month" ? "month" : "week");
  JI.rv.mode = mode;
  const accts = JN.d.accounts.filter(a => !a.archived || JN.d.trades.some(t => t.acct === a.id));
  const head = `<div class="ji-rvhead"><span class="seg" id="jiRvMode"><button data-v="week" class="${mode === "week" ? "on" : ""}">Week</button><button data-v="month" class="${mode === "month" ? "on" : ""}">Calendar</button></span>
    <button class="ghost" id="jiRvPrev" aria-label="Earlier">‹</button><b id="jiRvTitle"></b><button class="ghost" id="jiRvNext" aria-label="Later">›</button><button class="ghost" id="jiRvNow"></button>
    <span class="sp"></span><select id="jiRvAcct"><option value="">All accounts</option>${accts.map(a => `<option value="${jEsc(a.id)}"${a.id === jiRvAcct() ? " selected" : ""}>${jEsc(a.name)}${a.mode === "live" ? " · LIVE" : ""}</option>`).join("")}</select></div>
    <p class="muted jn-small" id="jiRvSub"></p><div id="jiRvBody"></div>`;
  const draft = jq("#jiRvWell") ? {week: JI.rv.week, well: jq("#jiRvWell").value, broke: jq("#jiRvBroke").value, focus: jq("#jiRvFocus").value} : null;
  body.innerHTML = head;
  jqa("#jiRvMode button").forEach(b => b.onclick = () => { JI.rv.mode = b.dataset.v; jPrefSet("rvMode", b.dataset.v); jiReview(); });
  jq("#jiRvAcct").onchange = e => { JI.rv.acct = e.target.value; jiReview(); };
  jq("#jiRvPrev").onclick = () => jiRvMove(-1); jq("#jiRvNext").onclick = () => jiRvMove(1);
  jq("#jiRvNow").onclick = () => { JI.rv.week = null; JI.rv.month = null; jiReview(); };
  if(mode === "month") return jiCalendar();
  jiWeek(draft);
}
function jiRvMove(dir){
  if(JI.rv.mode === "week") JI.rv.week = jAddDays(JI.rv.week || jiWeekStart(jTodayKey()), dir * 7);
  else { const [y, m] = (JI.rv.month || jTodayKey().slice(0, 7)).split("-").map(Number), d = new Date(Date.UTC(y, m - 1 + dir, 1)); JI.rv.month = d.toISOString().slice(0, 7); }
  jiReview();
}
function jiWeek(draft){
  const all = jiRvItems(), wk = JI.rv.week || jiWeekStart(jTodayKey()), isNow = wk === jiWeekStart(jTodayKey());
  JI.rv.week = wk;
  jq("#jiRvTitle").textContent = `Week of ${jiWeekLabel(wk)}`;
  jq("#jiRvSub").textContent = `Monday to Sunday, trades dated by their close time (IST)${isNow ? " · this week so far" : ""}. Money and R are net of every charge.`;
  const nb = jq("#jiRvNow"); nb.textContent = "This week"; nb.classList.toggle("hide", isNow);
  const cur = jiWeekStats(all, wk), prev = jiWeekStats(all, jAddDays(wk, -7)), s = cur.s;
  const rv = JN.d.reviews[wk] || {}, lastFocus = (JN.d.reviews[jAddDays(wk, -7)] || {}).focus || "";
  const delta = (a, b, fmt, better = 1) => { if(a == null || b == null || !prev.items.length) return ""; const d = a - b; if(Math.abs(d) < 1e-9) return `<small>same as last week</small>`;
    return `<small><span class="${better ? (d * better > 0 ? "up" : "down") : ""}">${d > 0 ? "▲" : "▼"} ${fmt(Math.abs(d))}</span> vs last week</small>`; };
  const kpi = (label, value, sub = "") => `<div class="ji-kpi"><span>${label}</span><b>${value}</b>${sub}</div>`;
  const heldPct = cur.audited ? cur.held / cur.audited : null, prevHeld = prev.audited ? prev.held / prev.audited : null;
  const leak = [...cur.pillars].sort((a, b) => b.count - a.count || a.net - b.net)[0], lk = cur.lock;
  const kpis = `<div class="jn-card ji-wide"><h3>The week at a glance</h3><div class="ji-kpis">
    ${kpi("Reps", String(cur.reps.length), cur.reps.length ? `<small>reps ${cur.reps[0]}–${cur.reps[cur.reps.length - 1]}</small>${delta(cur.reps.length, prev.reps.length, x => x, 0)}` : "")}
    ${kpi("Net", `<span class="${s.net > 0 ? "up" : s.net < 0 ? "down" : ""}">${s.closed ? jMoney(s.net) : "—"}</span>`, delta(s.closed ? s.net : null, prev.s.closed ? prev.s.net : null, x => jMoney(x, false)))}
    ${kpi("Win rate", s.winRate == null ? "—" : Math.round(s.winRate * 100) + "%", delta(s.winRate, prev.s.winRate, x => `${Math.round(x * 100)} pts`))}
    ${kpi("No pillar broken", heldPct == null ? "—" : Math.round(heldPct * 100) + "%", `<small>${cur.held} of ${cur.audited} audited reps</small>${delta(heldPct, prevHeld, x => `${Math.round(x * 100)} pts`)}`)}
    ${kpi("Clean octagon", s.closed ? `${cur.clean} / ${s.closed}` : "—", "<small>every pillar recorded and held</small>")}
    ${kpi("Lockouts", lk ? String(lk.ddHit + lk.afk) : "0", lk ? `<small>${lk.ddIgnored + lk.afkIgnored ? `<span class="down">${lk.ddIgnored + lk.afkIgnored} ignored</span>` : "all respected"} · ${lk.sessions} session${lk.sessions === 1 ? "" : "s"}</small>` : "")}
    ${kpi("Practice", `${cur.practice} / 7`, "<small>ground-state days</small>")}
    ${kpi("Average R", jR(s.avgR), delta(s.avgR, prev.s.avgR, x => x.toFixed(2) + "R"))}</div></div>`;
  const maxC = Math.max(1, ...cur.pillars.map(x => x.count));
  const scoreRows = cur.pillars.map(x => { const pv = prev.pillars[x.n - 1].count, ch = prev.items.length ? x.count - pv : null;
    return `<tr><td><span class="jb jb-${x.count ? "bad" : "good"}">${x.n}</span> ${jEsc(jPillar(x.n).title)}<div class="ji-bar ${x.count ? "bad" : ""}"><i style="width:${x.count / maxC * 100}%"></i></div></td>
      <td>${x.count ? `<span class="down">${x.count} broken</span>` : `<span class="up">held</span>`}</td><td class="${x.net < 0 ? "down" : x.net > 0 ? "up" : "muted"}">${x.count ? jMoney(x.net) : ""}</td>
      <td>${ch == null ? "" : ch === 0 ? `<span class="muted">=</span>` : `<span class="${ch < 0 ? "up" : "down"}">${ch > 0 ? "▲" : "▼"}${Math.abs(ch)}</span>`}</td></tr>`; }).join("");
  const leakHtml = !s.closed ? "" : leak && leak.count
    ? `<div class="ji-leak"><span class="jb jb-bad">${leak.n}</span><div><b>Biggest leak: ${jEsc(jPillar(leak.n).title)}</b> — broken on ${leak.count} trade${leak.count === 1 ? "" : "s"}, ${jMoney(leak.net)}.<div class="muted jn-small">${jEsc(jPillar(leak.n).rule)}</div></div></div>`
    : `<div class="ji-leak clear"><div><b>No pillar broken this week.</b> Every recorded trade held the octagon.</div></div>`;
  const score = `<div class="jn-card"><h3>Octagon scorecard</h3>${leakHtml}<div class="ji-tscroll"><table class="ji-table ji-pil"><tbody>${scoreRows}</tbody></table></div>
    <p class="muted jn-small">Money is the net of the trades that broke the pillar. Arrows compare with last week (▼ is fewer breaks).</p></div>`;
  const dayRows = [0, 1, 2, 3, 4, 5, 6].map(i => { const k = jAddDays(wk, i), list = cur.items.filter(t => jiCloseDay(t) === k), st = jiSum(list), br = list.filter(t => t.audit.breaches.length).length;
    const dn = `${JI_DOW[i]} ${Number(k.slice(8))}`, pr = JN.d.practice[k] ? ` <span class="ji-gold" title="Ground-state practice done">✓</span>` : "";
    return list.length ? `<tr><td><a href="#" data-day="${k}">${dn}</a>${pr}</td><td>${list.length}</td><td>${st.wins}–${st.losses}</td><td class="${st.net > 0 ? "up" : st.net < 0 ? "down" : ""}">${jMoney(st.net)}</td><td>${br ? `<span class="down">${br}</span>` : `<span class="up">0</span>`}</td></tr>`
      : `<tr class="dim"><td>${dn}${pr}</td><td colspan="4" class="muted" style="text-align:right">no trades</td></tr>`; }).join("");
  const days = `<div class="jn-card"><h3>Day by day</h3><div class="ji-tscroll"><table class="ji-table"><thead><tr><th></th><th>Trades</th><th>W–L</th><th>Net</th><th>Broken</th></tr></thead><tbody>${dayRows}</tbody></table></div>
    <p class="muted jn-small">✓ marks a ground-state practice day. Tap a day for its trades.</p></div>`;
  const kept = (v, l) => `<button type="button" data-kept="${v}" class="${rv.focusKept === v ? "on-" + v : ""}">${l}</button>`;
  const callout = lastFocus ? `<div class="ji-callout"><span class="muted jn-small">Your focus for this week, set in last week's review</span><q>${jEsc(lastFocus)}</q>
    <span class="seg">${kept("held", "Held it")}${kept("partly", "Partly")}${kept("missed", "Missed it")}</span></div>` : "";
  const cfg = JN.d.shots_cfg || {}, tgOn = cfg.tg && (cfg.tg_chat || cfg.tg_chat_live);
  const form = `<div class="jn-card ji-rvform"><h3>Reflection</h3>${callout}
    <label for="jiRvWell">What went well</label><textarea id="jiRvWell" rows="3" placeholder="Patient clicks, realistic targets banked, walked away at the 99…">${jEsc(rv.well || "")}</textarea>
    <label for="jiRvBroke">What broke the octagon — and why</label><textarea id="jiRvBroke" rows="3" placeholder="Which pillar, what was going on around it, what you felt before the click">${jEsc(rv.broke || "")}</textarea>
    <label for="jiRvFocus">One focus for next week</label><input type="text" id="jiRvFocus" maxlength="300" placeholder="e.g. Only click from the Zen Temple; close the platform after the 2% line" value="${jEsc(rv.focus || "")}">
    <div class="ji-rvacts"><button class="primary" id="jiRvSave">Save review</button><button id="jiRvCopy">Copy summary</button><button id="jiRvAi">Copy week for Gemini</button>
      <span class="muted jn-small" id="jiRvSaved">${rv.updatedAt ? "Saved " + jEsc(String(rv.updatedAt).slice(0, 16).replace("T", " ")) : ""}</span></div>
    <p class="muted jn-small">${tgOn ? "Saving also posts a summary to your journal's Telegram chat; saving again updates that same message." : "Saved on the server. Turn on the Telegram backup (Settings › Pictures) and saving also posts the summary there."} Next week's focus shows on the Today card.</p></div>`;
  jq("#jiRvBody").innerHTML = kpis + `<div class="ji-grid2">${score}${days}</div><div class="ji-grid2">${jiRvTrades(cur)}${form}</div>`;
  if(draft && draft.week === wk){ jq("#jiRvWell").value = draft.well; jq("#jiRvBroke").value = draft.broke; jq("#jiRvFocus").value = draft.focus; }
  jqa("#jiRvBody [data-day]").forEach(a => a.onclick = e => { e.preventDefault(); jiOpenDay(a.dataset.day); });
  jqa("#jiRvBody [data-kept]").forEach(b => b.onclick = () => jiRvSave({focusKept: rv.focusKept === b.dataset.kept ? "" : b.dataset.kept}, false));
  jqa("#jiRvBody [data-rvf]").forEach(b => b.onclick = () => { JI.rv.filter = b.dataset.rvf; jiWeek(jiRvDraft()); });
  jqa("#jiRvBody [data-walk]").forEach(b => b.onclick = () => jiWalk(JSON.parse(b.dataset.ids), Number(b.dataset.walk), b.dataset.label));
  jq("#jiRvSave").onclick = () => jiRvSave({}, true);
  jq("#jiRvCopy").onclick = () => jiCopy(jiRvSummary(), "Summary copied");
  jq("#jiRvAi").onclick = () => jiAiOpen(isNow ? "thisweek" : "week:" + wk);
}
function jiRvDraft(){ return jq("#jiRvWell") ? {week: JI.rv.week, well: jq("#jiRvWell").value, broke: jq("#jiRvBroke").value, focus: jq("#jiRvFocus").value} : null; }
const JI_RVF = {won: ["Winners", t => t.net > 0, (a, b) => b.net - a.net], lost: ["Losers", t => t.net < 0, (a, b) => a.net - b.net],
  broke: ["Broke a pillar", t => t.audit.breaches.length > 0, (a, b) => b.audit.breaches.length - a.audit.breaches.length || a.net - b.net], all: ["All", () => true, (a, b) => (a.opened || 0) - (b.opened || 0)]};
Object.entries(JI_QUADS).forEach(([k, q]) => { const [o, p] = k.split("|"); JI_RVF["q:" + k] = [q.plural, t => jiOutcome(t) === o && jiProcess(t.audit) === p, (a, b) => (a.opened || 0) - (b.opened || 0)]; });
function jiRvTrades(cur){
  const items = cur.items, F = JI_RVF[JI.rv.filter] || JI_RVF.won;
  const cell = k => { const q = JI_QUADS[k], [o, p] = k.split("|"), l = items.filter(t => jiOutcome(t) === o && jiProcess(t.audit) === p), net = l.reduce((a, t) => a + t.net, 0);
    return `<button type="button" class="ji-quad q-${q.tone}${JI.rv.filter === "q:" + k ? " on" : ""}" data-rvf="q:${k}"${l.length ? "" : " disabled"}><span>${q.plural}</span><b>${l.length}</b><small>${l.length ? jMoney(net) : "none"}</small></button>`; };
  const unaud = items.filter(t => jiProcess(t.audit) === "unaudited").length;
  const grid = `<div class="ji-quads"><span></span><span class="qh">Octagon held</span><span class="qh">Broke a pillar</span><span class="qh row">Won</span>${cell("won|held")}${cell("won|broke")}<span class="qh row">Lost</span>${cell("lost|held")}${cell("lost|broke")}</div>
    ${unaud ? `<p class="muted jn-small">${unaud} trade${unaud === 1 ? "" : "s"} without an audit ${unaud === 1 ? "isn't" : "aren't"} placed in the grid.</p>` : ""}`;
  const tabs = ["won", "lost", "broke", "all"].map(f => `<button type="button" data-rvf="${f}" class="${JI.rv.filter === f ? "on" : ""}">${JI_RVF[f][0]} <small>${items.filter(JI_RVF[f][1]).length}</small></button>`).join("");
  const list = items.filter(F[1]).sort(F[2]), ids = jEsc(JSON.stringify(list.map(t => t.id)));
  const rows = list.map((t, i) => { const q = jiQuad(t), refl = t.rvRight || t.rvWrong || t.review;
    return `<div class="ji-rvt"><div><b>${jEsc(jShort(t.s))}</b> <span class="jt-side ${t.side > 0 ? "buy" : "sell"}">${t.side > 0 ? "Buy" : "Sell"} ${t.lots ?? ""}</span> ${q ? `<span class="jb jb-${q.tone === "calm" ? "calm" : q.tone}">${q.name}</span>` : ""}
        <div class="jt-sub">${t.rep ? `Rep ${t.rep} · ` : ""}${jEsc(jWhen(t.opened))} · ${jEsc(t.acct_name)}${(t.shots || []).length ? ` · 📷 ${t.shots.length}` : ""}</div>
        ${t.audit.breaches.length ? `<div class="jn-badges">${t.audit.breaches.map(b => `<span class="jb jb-bad">${b.p.slice(1)} · ${jEsc(jPillar(Number(b.p.slice(1))).short)}</span>`).join("")}</div>` : ""}</div>
      <div class="ji-rvtr"><b class="mono ${t.net > 0 ? "up" : t.net < 0 ? "down" : ""}">${jMoney(t.net)}</b><div class="jt-sub">${t.r == null ? "" : jR(t.r)}</div>
        <button class="${refl ? "" : "primary"}" data-walk="${i}" data-ids="${ids}" data-label="${jEsc(F[0])}">${refl ? "✓ Reflected · open" : "Look back & reflect"}</button></div>
      ${t.rvRight ? `<p><span class="up">Right:</span> ${jEsc(t.rvRight)}</p>` : ""}${t.rvWrong ? `<p><span class="down">Wrong:</span> ${jEsc(t.rvWrong)}</p>` : ""}${t.review ? `<p><span class="ji-gold">Lesson:</span> ${jEsc(t.review)}</p>` : ""}</div>`; }).join("");
  const done = list.filter(t => t.rvRight || t.rvWrong || t.review).length;
  return `<div class="jn-card"><h3>This week's trades</h3><p class="muted jn-small">Judge the process, not the money: a win that broke a pillar is worse than a loss that held the octagon.</p>
    ${items.length ? grid : ""}<div class="seg ji-rvtabs">${tabs}</div>
    ${list.length ? `<div class="ji-walkbar"><span>${done} of ${list.length} reflected on</span><button class="primary" data-walk="0" data-ids="${ids}" data-label="${jEsc(F[0])}">Walk through ${list.length} →</button></div>` : ""}
    ${rows || `<div class="muted" style="padding:12px 0">${items.length ? "No trades in this group." : "No trades this week."}</div>`}</div>`;
}
async function jiRvSave(extra, post){
  const wk = JI.rv.week, b = {week: wk, ...extra};
  if(jq("#jiRvWell")) Object.assign(b, {well: jq("#jiRvWell").value, broke: jq("#jiRvBroke").value, focus: jq("#jiRvFocus").value});
  if(post) Object.assign(b, {post: true, summary: jiRvSummary(b)});
  const st = jq("#jiRvSaved"); if(st) st.textContent = "Saving…";
  const j = await japi("/api/journal/review", b);
  if(!j.ok){ if(st) st.textContent = j.error || "Couldn't save"; jToast(j.error || "Couldn't save the review"); return; }
  JN.d.reviews = j.reviews;
  jiWeek(null);
  if(!post) return;
  const tg = j.tg || "off";
  jToast(tg === "posted" ? "Review saved; summary posted to your journal's Telegram chat" : tg === "edited" ? "Review saved; the Telegram summary was updated"
    : tg.startsWith("error") ? `Review saved, but Telegram said: ${tg.slice(7)}` : "Review saved");
}
function jiRvSummary(over){
  const all = jiRvItems(), wk = JI.rv.week, c = jiWeekStats(all, wk), s = c.s, acc = jiRvAcct();
  const rv = {...(JN.d.reviews[wk] || {}), ...(over || jiRvDraft() || {})};
  const leak = [...c.pillars].sort((a, b) => b.count - a.count || a.net - b.net)[0];
  const L = [`🗓 Weekly review · ${jiWeekLabel(wk)}${acc ? ` · ${jAcctName(acc)}` : ""}`,
    `Reps ${c.reps.length}${c.reps.length ? ` (${c.reps[0]}–${c.reps[c.reps.length - 1]})` : ""} · Net ${s.closed ? jMoney(s.net) : "—"} · Win ${s.winRate == null ? "—" : Math.round(s.winRate * 100) + "%"} · Avg ${jR(s.avgR)}`,
    `No pillar broken: ${c.held}/${c.audited} audited reps · Clean octagon ${c.clean}/${s.closed}`,
    leak && leak.count ? `Biggest leak: P${leak.n} ${jPillar(leak.n).title} — ${leak.count} break${leak.count === 1 ? "" : "s"}, ${jMoney(leak.net)}` : "No pillar broken",
    c.lock ? `Lockouts: ${JN.d.rules.dd_pct}% hit ${c.lock.ddHit}${c.lock.ddIgnored ? ` (${c.lock.ddIgnored} ignored)` : ""} · 99 Club breaks ${c.lock.afk}${c.lock.afkIgnored ? ` (${c.lock.afkIgnored} ignored)` : ""}` : "",
    `Practice: ${c.practice}/7 days`, "(₹ and R net of all charges)"];
  const lf = (JN.d.reviews[jAddDays(wk, -7)] || {}).focus;
  if(lf) L.push("", `Last week's focus: ${lf}${rv.focusKept ? ` → ${{held: "held", partly: "partly held", missed: "missed"}[rv.focusKept]}` : ""}`);
  if(rv.well) L.push("", `✅ Went well: ${rv.well}`);
  if(rv.broke) L.push("", `⛔ Broke the octagon: ${rv.broke}`);
  if(rv.focus) L.push("", `🎯 Focus next week: ${rv.focus}`);
  return L.filter((x, i, a) => x !== "" || (i > 0 && a[i - 1] !== "")).join("\n").slice(0, 4000);
}
function jiOpenDay(key){
  jPrefSet("period", "custom"); jPrefSet("from", key); jPrefSet("to", key); jPrefSet("oct", "");
  if(JI.rv.acct != null) jPrefSet("acct", JI.rv.acct);
  JN.sub = "trades"; jqa("#jnSub button").forEach(x => x.classList.toggle("on", x.dataset.v === "trades"));
  const fl = jq("#jnFilters"); if(fl) fl.dataset.built = "";
  jnRender();
}
function jiCalendar(){
  const all = jiRvItems(), mk = JI.rv.month || jTodayKey().slice(0, 7), [y, m] = mk.split("-").map(Number), isNow = mk === jTodayKey().slice(0, 7);
  JI.rv.month = mk;
  jq("#jiRvTitle").textContent = `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`;
  jq("#jiRvSub").textContent = "Net P&L by day (closed trades, IST, net of charges). Tap a day for its trades, a week for its review.";
  const nb = jq("#jiRvNow"); nb.textContent = "This month"; nb.classList.toggle("hide", isNow);
  const first = `${mk}-01`, last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10), start = jiWeekStart(first), end = jAddDays(jiWeekStart(last), 6);
  const items = jiIn(all, start, end), byDay = new Map();
  items.forEach(t => { const k = jiCloseDay(t); if(!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(t); });
  const maxAbs = Math.max(1, ...[...byDay.values()].map(l => Math.abs(l.reduce((a, t) => a + t.net, 0))));
  const tint = v => { const a = (0.1 + 0.32 * Math.min(1, Math.abs(v) / maxAbs)).toFixed(3); return v > 0 ? `rgba(34,160,107,${a})` : v < 0 ? `rgba(226,72,61,${a})` : ""; };
  const today = jTodayKey();
  let html = JI_DOW.map(d => `<div class="ji-calh">${d}</div>`).join("") + `<div class="ji-calh wk">Week</div>`;
  for(let wk = start; wk <= end; wk = jAddDays(wk, 7)){
    for(let i = 0; i < 7; i++){
      const k = jAddDays(wk, i), list = byDay.get(k) || [], st = jiSum(list), inM = k.slice(0, 7) === mk, br = list.filter(t => t.audit.breaches.length).length;
      html += `<button type="button" class="ji-day${inM ? "" : " out"}${k === today ? " today" : ""}${list.length ? "" : " empty"}" ${list.length ? `data-day="${k}" style="--tint:${tint(st.net)}"` : 'tabindex="-1"'} aria-label="${k}${list.length ? `: ${list.length} trades, ${jMoney(st.net)}` : ""}">
        <span class="d">${Number(k.slice(8))}${JN.d.practice[k] ? `<i title="Ground-state practice done">✓</i>` : ""}</span>
        ${list.length ? `<b class="${st.net > 0 ? "up" : st.net < 0 ? "down" : ""}">${jiShortMoney(st.net)}</b><small>${list.length} · ${st.wins}–${st.losses}</small>${br ? `<small class="down">${br} broke</small>` : ""}` : ""}</button>`;
    }
    const wl = jiIn(all, wk, jAddDays(wk, 6)), ws = jiSum(wl), r = JN.d.reviews[wk], done = r && (r.well || r.broke || r.focus), reps = wl.filter(t => t.rep).length;
    html += `<button type="button" class="ji-calwk" data-week="${wk}"><span class="muted">${jEsc(jiWeekLabel(wk).replace(/ \d{4}$/, ""))}</span>
      ${wl.length ? `<b class="${ws.net > 0 ? "up" : ws.net < 0 ? "down" : ""}">${jiShortMoney(ws.net)}</b><small>${reps} rep${reps === 1 ? "" : "s"}</small>` : `<small>no trades</small>`}
      <small class="${done ? "up" : "ji-todo"}">${done ? "✓ Reviewed" : "Review →"}</small></button>`;
  }
  const mi = items.filter(t => jiCloseDay(t).slice(0, 7) === mk), ms = jiSum(mi), md = new Map();
  mi.forEach(t => { const k = jiCloseDay(t); md.set(k, (md.get(k) || 0) + t.net); });
  const reps = mi.map(t => t.rep).filter(Boolean).sort((a, b) => a - b);
  jq("#jiRvBody").innerHTML = `<div class="jn-card ji-wide"><div class="ji-calsum"><span>Net <b class="${ms.net > 0 ? "up" : ms.net < 0 ? "down" : ""}">${ms.closed ? jMoney(ms.net) : "—"}</b></span>
      <span>Trading days <b>${md.size}</b> · green <b>${[...md.values()].filter(v => v > 0).length}</b></span><span>Reps <b>${reps.length}</b>${reps.length ? ` (${reps[0]}–${reps[reps.length - 1]})` : ""}</span>
      <span>Win rate <b>${ms.winRate == null ? "—" : Math.round(ms.winRate * 100) + "%"}</b></span><span>Broke a pillar <b>${mi.filter(t => t.audit.breaches.length).length}</b></span></div>
    <div class="ji-cal">${html}</div></div>`;
  jqa("#jiRvBody [data-day]").forEach(b => b.onclick = () => jiOpenDay(b.dataset.day));
  jqa("#jiRvBody [data-week]").forEach(b => b.onclick = () => { JI.rv.week = b.dataset.week; JI.rv.mode = "week"; jPrefSet("rvMode", "week"); jiReview(); window.scrollTo({top: 0}); });
}

/* ------------------------------------------------------------------ the walk-through: one trade at a time, its pictures beside the reflection */
function jiWalk(ids, i, label){
  if(!ids.length) return;
  Object.assign(JI.walk, {ids, i: Math.max(0, Math.min(i, ids.length - 1)), label: label || ""});
  let m = jq("#jiWalk");
  if(!m){ m = document.createElement("div"); m.id = "jiWalk"; m.className = "jn-modal"; document.body.append(m); m.onclick = e => { if(e.target === m) jiWalkEnd(); }; }
  m.classList.remove("hide");
  document.addEventListener("keydown", jiWalkKey);
  jiWalkRender();
}
function jiWalkKey(e){
  if(!JI.walk.ids.length || (typeof JS !== "undefined" && JS.view)) return;
  if(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if(e.key === "ArrowRight") jiWalkStep(1); else if(e.key === "ArrowLeft") jiWalkStep(-1); else if(e.key === "Escape") jiWalkEnd();
}
async function jiWalkStep(d){ await jiWalkSave(true); JI.walk.i = (JI.walk.i + d + JI.walk.ids.length) % JI.walk.ids.length; jiWalkRender(); }
async function jiWalkEnd(){
  await jiWalkSave(true);
  JI.walk.ids = []; const m = jq("#jiWalk"); if(m){ m.classList.add("hide"); m.innerHTML = ""; }
  document.removeEventListener("keydown", jiWalkKey);
  if(JN.sub === "review") jiReview(); else jnRender();
}
function jiWalkRender(){
  const m = jq("#jiWalk"), t = JN.d.trades.find(x => x.id === JI.walk.ids[JI.walk.i]); if(!m || !t) return;
  const a = t.audit, q = jiQuad(t), shots = t.shots || [], main = shots.find(s => s.kind === "server" && s.phase === "exit") || shots.find(s => s.phase === "exit") || shots[0];
  const fact = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
  m.innerHTML = `<div class="jn-mbox ji-wbox" role="dialog" aria-label="Walk-through">
    <div class="jn-mhead"><button class="ghost" id="jiWPrev" aria-label="Previous trade">‹</button><b>${jEsc(JI.walk.label)} ${JI.walk.i + 1} / ${JI.walk.ids.length}</b><button class="ghost" id="jiWNext" aria-label="Next trade">›</button>
      <span class="muted">${jEsc(jShort(t.s))} ${t.side > 0 ? "Buy" : "Sell"} ${t.lots ?? ""} · ${jEsc(jWhen(t.opened))}</span><span class="sp"></span><button class="ghost" id="jiWClose" aria-label="Close">✕</button></div>
    <div class="ji-wgrid"><div class="ji-wpic">
        ${main ? `<img src="${jsUrl(t.id, main)}" alt="${jEsc(jsLabel(main))}" data-sid="${jEsc(main.id)}" id="jiWImg"><div class="ji-wchips">${shots.map(s => `<button data-sid="${jEsc(s.id)}" class="${s.id === main.id ? "on" : ""}">${jEsc(jsLabel(s))}</button>`).join("")}</div>`
          : `<div class="empty">No pictures of this trade.${t.status === "closed" ? ` <button id="jiWDraw">Draw it on the server</button>` : ""}</div>`}
        <div class="ji-wacts"><button id="jiWChart">Open on the chart</button><button id="jiWAudit">${a.recorded ? "Edit audit" : "Audit this trade"}</button></div></div>
      <div class="ji-wside">
        <div class="ji-wblock">${q ? `<span class="jb jb-${q.tone === "calm" ? "calm" : q.tone} ji-verdict">${q.name}</span><p class="muted jn-small">${jEsc(q.what)}</p>` : `<span class="jb jb-none ji-verdict">Octagon not recorded</span><p class="muted jn-small">Audit its pillars to judge the process.</p>`}</div>
        <div class="ji-wblock"><h4>The trade</h4><div class="jn-facts ji-wfacts">
          ${t.rep ? fact("Rep", `${t.rep} · ${jEsc(t.acct_name)}`) : ""}
          ${fact("Result", `<span class="${t.net > 0 ? "up" : t.net < 0 ? "down" : ""}">${jMoney(t.net)}</span>${t.r != null ? " · " + jR(t.r) : ""}`)}
          ${fact("Entry → exit", `<span class="mono">${jPx(t.avg)} → ${jPx(t.exit)}</span>`)}
          ${fact("First stop · target", `<span class="mono">${jPx(t.first_sl)} · ${jPx(t.tp)}</span>${t.planned_r != null ? ` (${t.planned_r.toFixed(1)}R)` : ""}`)}
          ${t.closed && t.opened ? fact("Held", jDur(t.closed - t.opened)) : ""}${t.regime ? fact("Regime", jEsc(t.regime)) : ""}
          ${(t.setup || []).length ? fact("Setup", jEsc(t.setup.join(", "))) : ""}</div></div>
        <div class="ji-wblock"><h4>Octagon</h4><div class="jn-badges">${jChips(t, a)}</div>${jBreaches(a)}</div>
        <div class="ji-wblock"><h4>Plan at the click</h4>${t.notes ? `<p class="jt-note">${jEsc(t.notes)}</p>` : `<p class="muted jn-small">No plan was written for this trade.</p>`}</div>
        <div class="ji-wblock"><h4>Reflection</h4>
          <label for="jiWRight">What I did right</label><textarea id="jiWRight" rows="2" placeholder="Waited for the candle close, banked at 1.5R…">${jEsc(t.rvRight || "")}</textarea>
          <label for="jiWWrong">What I did wrong</label><textarea id="jiWWrong" rows="2" placeholder="Front-ran the close, stretched the target, traded tired…">${jEsc(t.rvWrong || "")}</textarea>
          <label for="jiWLesson">Lesson</label><textarea id="jiWLesson" rows="2" placeholder="The one thing to carry into the next rep">${jEsc(t.review || "")}</textarea>
          <div class="ji-rvacts"><button class="primary" id="jiWSave">Save</button><button id="jiWSaveNext">Save &amp; next →</button><span class="muted jn-small" id="jiWSaved">${t.reviewedAt ? "Saved " + jEsc(String(t.reviewedAt).slice(0, 16).replace("T", " ")) : ""}</span></div>
          <p class="muted jn-small">← → move between trades and save as you go.</p></div>
      </div></div></div>`;
  jq("#jiWPrev").onclick = () => jiWalkStep(-1); jq("#jiWNext").onclick = () => jiWalkStep(1); jq("#jiWClose").onclick = jiWalkEnd;
  jq("#jiWSave").onclick = () => jiWalkSave(false); jq("#jiWSaveNext").onclick = () => jiWalkStep(1);
  jq("#jiWChart").onclick = async () => { await jiWalkEnd(); jnChart(t); };
  jq("#jiWAudit").onclick = async () => { await jiWalkEnd(); jnForm(t.id); };
  const img = jq("#jiWImg"); if(img) img.onclick = () => jsView(t.id, img.dataset.sid);
  jqa("#jiWalk .ji-wchips button").forEach(b => b.onclick = () => { const s = shots.find(x => x.id === b.dataset.sid); if(!s) return; img.src = jsUrl(t.id, s); img.dataset.sid = s.id; jqa("#jiWalk .ji-wchips button").forEach(x => x.classList.toggle("on", x === b)); });
  const dr = jq("#jiWDraw"); if(dr) dr.onclick = () => { jsDraw(t.id, "entry"); jsDraw(t.id, "exit", dr); };
}
async function jiWalkSave(silent){
  const t = JN.d.trades.find(x => x.id === JI.walk.ids[JI.walk.i]); if(!t || !jq("#jiWRight")) return;
  const v = {rvRight: jq("#jiWRight").value.trim(), rvWrong: jq("#jiWWrong").value.trim(), review: jq("#jiWLesson").value.trim()};
  if(v.rvRight === (t.rvRight || "") && v.rvWrong === (t.rvWrong || "") && v.review === (t.review || "")){ if(!silent) jq("#jiWSaved").textContent = "Nothing changed"; return; }
  const j = await japi("/api/journal/trade", {id: t.id, ...v});
  if(!j.ok){ jToast(j.error || "Couldn't save the reflection"); return; }
  jnMerge(j.j);
  if(!silent){ jq("#jiWSaved").textContent = "✓ Saved"; }
}

/* ------------------------------------------------------------------ Copy for Gemini */
function jiAiOpen(scope, tradeId){
  JI.ai.trade = tradeId || null; JI.ai.week = String(scope).startsWith("week:") ? scope.slice(5) : null;
  let m = jq("#jiAi");
  if(!m){ m = document.createElement("div"); m.id = "jiAi"; m.className = "jn-modal"; document.body.append(m); m.onclick = e => { if(e.target === m) jiAiClose(); }; }
  m.classList.remove("hide");
  const accts = JN.d.accounts.filter(a => !a.archived || JN.d.trades.some(t => t.acct === a.id));
  const scopes = [["today", "Today"], ["yesterday", "Yesterday"], ["thisweek", "This week"], ["lastweek", "Last week"]];
  if(JI.ai.week) scopes.push([scope, `Week of ${jiWeekLabel(JI.ai.week)}`]);
  if(tradeId) scopes.push(["trade", "This trade"]);
  const def = tradeId ? "trade" : scope, aDef = tradeId ? "" : scope === "today" ? (jnTodayAcct() || "") : (jF().acct || "");
  m.innerHTML = `<div class="jn-mbox ji-aibox" role="dialog" aria-label="Copy for Gemini">
    <div class="jn-mhead"><b>Copy for Gemini</b><span class="muted">your trades with all 8 pillars, as text for a psychology chat</span><span class="sp"></span><button class="ghost" id="jiAiX" aria-label="Close">✕</button></div>
    <div class="ji-aiopts"><div><label for="jiAiScope">Trades</label><select id="jiAiScope">${scopes.map(([v, l]) => `<option value="${jEsc(v)}"${v === def ? " selected" : ""}>${jEsc(l)}</option>`).join("")}</select></div>
      <div><label for="jiAiAcct">Account</label><select id="jiAiAcct"><option value="">All accounts</option>${accts.map(a => `<option value="${jEsc(a.id)}"${a.id === aDef ? " selected" : ""}>${jEsc(a.name)}${a.mode === "live" ? " · LIVE" : ""}</option>`).join("")}</select></div>
      <label class="jn-flag"><input type="checkbox" id="jiAiRules"${jPref().aiRules ? " checked" : ""}> Start with my Octagon rules (for a new chat)</label></div>
    <textarea id="jiAiText" class="mono" rows="18" readonly></textarea>
    <div class="jn-mfoot"><span class="muted jn-small" id="jiAiCount"></span><span class="sp"></span><button id="jiAiClose">Close</button><button class="primary" id="jiAiCopy">Copy</button></div></div>`;
  const upd = () => { const txt = jiAiText(); jq("#jiAiText").value = txt.text; jq("#jiAiCount").textContent = `${txt.n} trade${txt.n === 1 ? "" : "s"} · ${txt.text.length.toLocaleString("en-IN")} characters`; };
  ["#jiAiScope", "#jiAiAcct"].forEach(s => jq(s).onchange = upd);
  jq("#jiAiRules").onchange = e => { jPrefSet("aiRules", e.target.checked); upd(); };
  jq("#jiAiX").onclick = jq("#jiAiClose").onclick = jiAiClose;
  jq("#jiAiCopy").onclick = async () => { if(await jiCopy(jq("#jiAiText").value, "Copied: paste it into your Gemini notebook")) jq("#jiAiCount").textContent = "✓ Copied — paste it into your Gemini notebook."; else { jq("#jiAiText").focus(); jq("#jiAiText").select(); } };
  document.addEventListener("keydown", jiAiKey);
  upd();
}
function jiAiKey(e){ if(e.key === "Escape") jiAiClose(); }
function jiAiClose(){ const m = jq("#jiAi"); if(m){ m.classList.add("hide"); m.innerHTML = ""; } document.removeEventListener("keydown", jiAiKey); }
function jiAiTrades(){
  const scope = jq("#jiAiScope").value, acc = jq("#jiAiAcct").value;
  if(scope === "trade") return {label: "one trade", list: JN.d.trades.filter(t => t.id === JI.ai.trade)};
  const today = jTodayKey(); let from, to, label;
  if(scope === "today"){ from = to = today; label = `today, ${jFmtDay(today)}`; }
  else if(scope === "yesterday"){ from = to = jAddDays(today, -1); label = `yesterday, ${jFmtDay(from)}`; }
  else { const st = scope === "thisweek" ? jiWeekStart(today) : scope === "lastweek" ? jAddDays(jiWeekStart(today), -7) : scope.slice(5); from = st; to = jAddDays(st, 6); label = `the week of ${jiWeekLabel(st)}`; }
  const list = JN.d.trades.filter(t => !t.hidden && t.day && t.day >= from && t.day <= to && (!acc || t.acct === acc));
  return {label, list, from, to};
}
function jiAiTrade(t, k, total){
  const a = t.audit, q = t.status === "closed" ? jiQuad(t) : null, L = [], tm = ts => ts ? jWhen(ts, true).slice(-8) : "—";
  L.push(`### Trade ${k} of ${total}${t.rep ? ` — Rep ${t.rep}` : ""} · ${jShort(t.s)} ${t.side > 0 ? "BUY" : "SELL"} ${t.lots ?? ""} lot${t.lots === 1 ? "" : "s"}${t.mode === "live" ? " · LIVE" : " · paper"}`);
  L.push(`- Opened ${tm(t.opened)} → ${t.status === "closed" ? `closed ${tm(t.closed)}` : "still open"} IST${t.status === "closed" && t.opened ? ` · held ${jDur(t.closed - t.opened)}` : ""}${t.tod ? ` · ${t.tod}` : ""}`);
  L.push(`- Entry ${jPx(t.avg)} → exit ${t.status === "closed" ? jPx(t.exit) : "—"} · first stop ${jPx(t.first_sl)}${t.sl != null && t.sl !== t.first_sl ? ` (last stop ${jPx(t.sl)})` : ""} · target ${jPx(t.tp)}${t.planned_r != null ? ` (planned ${t.planned_r.toFixed(1)}R)` : ""}`);
  if(t.init_risk) L.push(`- Risk at the first stop ${jMoney(t.init_risk, false)} net of charges`);
  if(t.status === "closed") L.push(`- P&L: gross ${jMoney(t.gross)} · charges ${jMoney(t.charges, false)} · net ${jMoney(t.net)}${t.r != null ? ` = ${jR(t.r)}` : ""}${t.reason ? ` · exit: ${J_REASON[t.reason] || t.reason}` : ""}`);
  if((t.setup || []).length) L.push(`- Setup: ${t.setup.join(", ")}`);
  if(q) L.push(`- Outcome × process: ${q.name} — ${q.what}`);
  L.push("- Octagon:");
  const p1 = JN.d.p1 || [], faults = new Map(JN.d.faults || []);
  jPillars().forEach(p => {
    const st = a.P["p" + p.n], bits = [];
    if(p.n === 1){ if(t.direction) bits.push(t.direction); if(p1.length) bits.push(p1.map(([key, l]) => `${l} ${(t.p1Checks || []).includes(key) ? "✓" : "✗"}`).join(", ")); if(t.regime) bits.push(`market regime: ${t.regime}`);
      [["bias", "Bias"], ["ke", "KE"]].forEach(([key, l]) => { if(t[key] != null) bits.push(`${l}: ${jBias(t[key]).replace("−", "-")}`); }); }
    if(p.n === 2 && t.wait) bits.push(t.wait);
    if(p.n === 3){ if(t.execution) bits.push(t.execution); if((t.execFaults || []).length) bits.push(t.execFaults.map(f => faults.get(f) || f).join(", ")); }
    if(p.n === 5 && t.numberRunning) bits.push("I flagged that my mind was running numbers");
    if(p.n === 6 && t.payoutPressure) bits.push("I flagged payout / balance pressure");
    if(p.n === 7 && t.zen) bits.push(t.zen);
    if(p.n === 8 && t.target) bits.push(t.target);
    if(st.note && st.state !== "pass" && !(p.n === 3 && (t.execFaults || []).length)) bits.push(st.note);
    L.push(`  ${p.n}. ${p.title} — ${JI_AI_WORD[st.state]}${bits.length ? " · " + bits.join(" · ") : ""}`);
  });
  if(t.notes) L.push(`- My plan at the click: ${t.notes}`);
  if(t.rvRight) L.push(`- What I did right: ${t.rvRight}`);
  if(t.rvWrong) L.push(`- What I did wrong: ${t.rvWrong}`);
  if(t.review) L.push(`- Lesson: ${t.review}`);
  if((t.shots || []).length) L.push(`- ${t.shots.length} chart picture${t.shots.length === 1 ? "" : "s"} in my journal (${t.shots.map(s => jsLabel(s)).join(", ")})`);
  return L.join("\n");
}
function jiAiText(){
  const {label, list} = jiAiTrades(), R = JN.d.rules, out = [];
  const items = list.slice().sort((a, b) => (a.opened || 0) - (b.opened || 0));
  if(jq("#jiAiRules").checked){
    out.push("# My Octagon framework", ...jPillars().map(p => `${p.n}. ${p.title}: ${p.rule}`), `Daily practice: “${JN.d.mantra}”`,
      `My numbers: ${R.dd_pct}% trailing drawdown lockout, ${R.win_streak} wins in a row (or ${R.win_streak} wins of ${R.multi_r}R+) → ${R.afk_min}-minute break, targets above ${R.stretch_r}R are flagged as stretched, ${R.block_pct}% execution blocks. Every closed trade is one rep; I work in blocks of ${R.rep_block} reps.`, "");
  }
  out.push(`# My trades — ${label}`, "Exported from my trading journal (Indian markets via Fyers). Times are IST. Money (₹) and R are net of every charge — brokerage, exchange fees, STT, stamp duty, GST. R = net result ÷ the net risk at the first stop. Rep numbers count every trade I've taken across all accounts.");
  if(!items.length){ out.push("", "No trades in this period."); return {text: out.join("\n"), n: 0}; }
  const groups = new Map(); items.forEach(t => { if(!groups.has(t.skey)) groups.set(t.skey, []); groups.get(t.skey).push(t); });
  const one = jq("#jiAiScope").value === "trade";
  for(const [key, g] of groups){
    const s = JN.d.sessions[key], day = key.split("|")[1], st = jiSum(g), acc = JN.d.accounts.find(a => a.id === g[0].acct);
    const dname = new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", {weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC"});
    out.push("", `## ${dname} · ${g[0].acct_name}${acc ? ` (${acc.mode === "live" ? "live" : "paper"}${acc.size ? `, ${jMoney(acc.size, false)} account` : ""})` : ""}`);
    if(!one){
      out.push(`- ${st.closed} closed trade${st.closed === 1 ? "" : "s"} · net ${jMoney(st.net)} · ${st.wins} won / ${st.losses} lost${st.avgR != null ? ` · total ${jR(st.totalR)}` : ""}`);
      if(s){
        out.push(`- Equity through the session: peak ${jMoney(s.peak)} · deepest pullback from the peak ${jMoney(s.maxDd, false)} · my ${R.dd_pct}% line is ${jMoney(s.limit, false)}${s.ddLockAt != null ? ` — HIT at ${jHM(s.ddLockAt)}` : " — not hit"}`);
        if(s.lockouts.length) out.push(`- 99 Club breaks: ${s.lockouts.map(l => `${l.why} at ${jHM(l.from)} (away until ${jHM(l.to)})`).join("; ")}`);
        if(s.termAt != null) out.push(`- Mind running numbers from ${jHM(s.termAt)} — the session should have ended there`);
      }
      out.push(`- Ground-state practice that day: ${JN.d.practice[day] ? "done" : "not done"}`);
      const focus = (JN.d.reviews[jAddDays(jiWeekStart(day), -7)] || {}).focus;
      if(focus) out.push(`- My focus for that week: ${focus}`);
    }
    g.forEach((t, i) => out.push("", jiAiTrade(t, i + 1, g.length)));
  }
  if(groups.size > 1){ const st = jiSum(items); out.push("", "## Totals", `- ${st.closed} trades · net ${jMoney(st.net)} · ${st.wins} won / ${st.losses} lost · ${items.filter(t => t.audit.breaches.length).length} broke a pillar`); }
  const sc = jq("#jiAiScope").value;
  if(/^(week:|thisweek|lastweek)/.test(sc)){
    const wk = sc.startsWith("week:") ? sc.slice(5) : sc === "thisweek" ? jiWeekStart(jTodayKey()) : jAddDays(jiWeekStart(jTodayKey()), -7), rv = JN.d.reviews[wk];
    if(rv && (rv.well || rv.broke || rv.focus)) out.push("", "## My weekly reflection", rv.well ? `- Went well: ${rv.well}` : "", rv.broke ? `- Broke the octagon: ${rv.broke}` : "", rv.focus ? `- Focus for next week: ${rv.focus}` : "");
  }
  return {text: out.filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n").trim(), n: items.length};
}

/* ------------------------------------------------------------------ Settings › Export and backup */
function jiDataCard(){
  const grid = jq("#jnBody .jn-setgrid"); if(!grid) return;
  let box = jq("#jiData"); if(!box){ box = document.createElement("div"); box.id = "jiData"; box.className = "jn-card"; grid.append(box); }
  box.innerHTML = `<h3>Export and backup</h3>
    <p class="muted jn-small">The journal lives on the server. Keep a copy of your own now and then.</p>
    <div class="jn-pledb"><a class="btnlink" id="jiCsv" href="/api/journal/export.csv" download>Download CSV</a><a class="btnlink" id="jiZip" href="/api/journal/backup.zip" download>Download backup (.zip)</a></div>
    <p class="muted jn-small"><b>CSV</b>: every trade with its 8 pillars, net ₹, R and reflections, for a spreadsheet. <b>Backup</b>: the whole journal (trades, audits, reviews, practice, settings) and every picture, in one zip.</p>
    <label class="jn-small" for="jiRestore"><b>Restore from a backup</b></label>
    <input type="file" id="jiRestore" accept=".zip,.json,application/zip,application/json">
    <p class="muted jn-small">Adds back whatever the journal doesn't have (trades, reviews, practice days, pictures). Nothing already here is changed or removed.</p>
    <div class="jn-sst" id="jiRestoreSt"></div>`;
  jq("#jiRestore").onchange = async e => {
    const f = e.target.files && e.target.files[0]; if(!f) return;
    const st = jq("#jiRestoreSt");
    if(!confirm(`Restore from ${f.name}? Only what's missing is added; nothing in the journal is changed.`)){ e.target.value = ""; return; }
    st.textContent = `Uploading ${(f.size / 1e6).toFixed(1)} MB…`; st.className = "jn-sst";
    const r = await fetch("/api/journal/restore", {method: "POST", credentials: "same-origin", headers: {"Content-Type": f.type || "application/octet-stream"}, body: f});
    let j = {}; try{ j = await r.json(); }catch(x){}
    e.target.value = "";
    if(!r.ok || !j.ok){ st.textContent = j.error || j.detail || "Couldn't restore it"; st.className = "jn-sst down"; return; }
    jnMerge(j.j);
    const g = j.got;
    st.textContent = `✓ Added ${g.trades} trade${g.trades === 1 ? "" : "s"}, ${g.pictures} picture${g.pictures === 1 ? "" : "s"}, ${g.reviews} review${g.reviews === 1 ? "" : "s"}, ${g.practice} practice day${g.practice === 1 ? "" : "s"}${g.skipped ? ` (${g.skipped} already here)` : ""}.`;
    st.className = "jn-sst up";
  };
}

/* ------------------------------------------------------------------ hooks into journal.js */
(function jiHook(){
  const set = jnSettings;
  jnSettings = function(){ set(); jiDataCard(); };
  const today = jnToday;
  jnToday = function(){
    today();
    const el = jq("#jnToday"); if(!el || !JN.d) return;
    const wk = jiWeekStart(jTodayKey()), focus = (JN.d.reviews[jAddDays(wk, -7)] || {}).focus;
    if(focus && !el.querySelector(".ji-tfocus")){
      const d = document.createElement("div"); d.className = "ji-tfocus";
      d.innerHTML = `<span>This week's focus</span><q>${jEsc(focus)}</q>`;
      const sub = el.querySelector(".jn-tsub"); if(sub) sub.after(d); else el.prepend(d);
    }
  };
})();
