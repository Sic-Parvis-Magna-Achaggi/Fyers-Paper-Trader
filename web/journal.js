/* The Journal page: a port of the Octagon trade journal (octagon_journal.html), on the server (helper/journal.py).
   Trades arrive on their own from every paper / live account; you add the audit (the 8 pillars), tags, plan and
   review. The server works out the pillars, the sessions and the lockouts (one source of truth: the same rules
   refuse orders); this page shows them. Money and R are net of all charges. Filters are saved in prefs ("jn"). */

const JN = {d: null, sub: "trades", exp: new Set(), busy: false, form: null, pvT: 0, pvSeq: 0, flash: null, todayAcct: null, loadedAt: 0};
const jq = s => document.querySelector(s);
const jqa = s => [...document.querySelectorAll(s)];
const J_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const J_STATE_TONE = {pass: "good", fail: "bad", warn: "warn", na: "none", off: "off"};
const J_STATE_MARK = {pass: "✓", fail: "✗", warn: "⚠", na: "—", off: "n/a"};
const J_STATE_WORD = {pass: "held", fail: "broken", warn: "check", na: "not recorded", off: "doesn't apply"};
const J_TONE = {
  direction: {Correct: "good", Wrong: "bad"}, wait: {Patient: "good", Restless: "warn", Rushed: "bad2"},
  execution: {Correct: "good", Wrong: "bad"}, zen: {Sanctuary: "good", Compromised: "bad"},
  target: {Realistic: "good", Stretched: "bad"},
  regime: {"Thin and Jumpy": "calm", "Active Expansion": "calm", Dormant: "calm", Absorption: "calm"}};
const J_ICON = {direction: {Correct: "✓", Wrong: "✗"}, execution: {Correct: "✓", Wrong: "✗"}, zen: {Sanctuary: "🛕", Compromised: "✗"},
  target: {Realistic: "✓", Stretched: "✗"}};
const J_LABEL = {direction: "Direction", wait: "Wait state", execution: "Execution", zen: "Zen Temple", target: "Target", regime: "Market regime"};
const J_SEG_LABELS = {target: {Realistic: "Realistic — banked / trailed", Stretched: "Stretched into hope"}};
const J_NUM = [{key: "bias", label: "Bias"}, {key: "ke", label: "KE"}];
const J_PERIODS = [["all", "All time"], ["today", "Today"], ["yesterday", "Yesterday"], ["thisweek", "This week"], ["lastweek", "Last week"],
  ["7d", "Last 7 days"], ["thismonth", "This month"], ["lastmonth", "Last month"], ["30d", "Last 30 days"], ["90d", "Last 90 days"],
  ["thisyear", "This year"], ["custom", "Custom dates…"]];
const J_OCTF = [["", "All trades"], ["clean", "Clean octagon"], ["broken", "Any pillar broken"], ["p1", "1 · Direction broken"],
  ["p2", "2 · Not patient"], ["p3", "3 · Execution wrong"], ["p4", "4 · After 2% lockout"], ["p5", "5 · 99 Club breach"],
  ["p6", "6 · Payout pressure"], ["p7", "7 · Zen Temple breach"], ["p8", "8 · Stretched target"], ["untagged", "Not fully audited"],
  ["open", "Still open"], ["removed", "Removed from the journal"]];
const J_REASON = {sl: "stop", tp: "target", be: "break-even stop", "trail sl": "trailed stop", manual: "closed by hand", squareoff: "square-off",
  expiry: "expiry exit", kill: "kill switch", "closed at Fyers": "closed at Fyers"};

/* ------------------------------------------------------------------ small helpers */
function jEsc(s){ return String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c])); }
const jp2 = n => String(n).padStart(2, "0");
/* Money: ₹ for Fyers accounts, the account's own currency ($) for MT5 accounts (v0.39.0), never added together: the page
   shows one currency at a time (jCur), and a trade's own figures in its own currency. */
const J_CSYM = {INR: "₹", USD: "$", EUR: "€", GBP: "£", JPY: "¥"};
function jSym(cur){ cur = cur || "INR"; return J_CSYM[cur] || cur + " "; }
function jMoney(n, signed = true, cur){
  if(n == null || !isFinite(n)) return "—";
  cur = cur || jCur();
  const a = Math.abs(n).toLocaleString(cur === "INR" ? "en-IN" : "en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  return `${n < 0 ? "−" : signed && n > 0 ? "+" : ""}${jSym(cur)}${a}`;
}
function jCurList(){
  const d = JN.d; if(!d) return ["INR"];
  const set = new Set(d.trades.map(t => t.cur || "INR"));
  for(const a of d.accounts || []) if(!a.archived) set.add(a.cur || "INR");
  return [...set].sort((a, b) => (a === "INR" ? -1 : b === "INR" ? 1 : a.localeCompare(b)));
}
function jCur(){
  const list = jCurList(), side = typeof sideNow === "function" ? sideNow() : "paper";
  if(JN.curSide !== side){ JN.curSide = side; JN.cur = null; }            // (the page's side picks the first currency)
  if(JN.cur && list.includes(JN.cur)) return JN.cur;
  const mt = (JN.d && JN.d.accounts || []).find(a => a.mode === "mt5" && !a.archived);
  return side === "mt5" && mt && list.includes(mt.cur) ? mt.cur : list.includes("INR") ? "INR" : list[0];
}
function jKept(t){                       // an MT5 trade's candles kept on the server for its replay (v0.39.1)
  const k = t.kept, tfn = r => r === "D" ? "1D" : +r >= 60 ? (+r / 60) + "h" : r + "m";
  if(!k) return '<span class="muted">waiting to be fetched from MT5</span>';
  const got = Object.entries(k.res || {}).filter(([, n]) => n > 0).sort((a, b) => (a[0] === "D" ? 1e9 : +a[0]) - (b[0] === "D" ? 1e9 : +b[0]));
  if(!got.length) return `<span class="${k.waiting ? "muted" : "down"}">${k.waiting ? "waiting for MT5" : jEsc(k.err || "not kept")}</span>`;
  return `kept on the server <span class="muted">(${got.map(([r, n]) => tfn(r) + " " + n.toLocaleString("en-IN")).join(" · ")} candles)</span>${k.err ? ` <span class="muted">· ${jEsc(k.err)}</span>` : ""}`;
}
function jModeTag(mode){ return mode === "live" ? '<span class="jt-live">LIVE</span>' : mode === "mt5" ? '<span class="jt-mt5">MT5</span>' : ""; }
function jModeWord(mode){ return mode === "live" ? '<b class="down">Live</b>' : mode === "mt5" ? '<b class="jn-mt5w">MT5</b>' : "Paper"; }
function jR(r){ return r == null || !isFinite(r) ? "—" : `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`; }
function jBias(b){ return b == null ? "—" : (b > 0 ? "+" : b < 0 ? "−" : "") + Math.abs(b).toFixed(2); }
function jDayKey(ts){ return new Date((ts + 19800) * 1000).toISOString().slice(0, 10); }             // IST date
function jHM(ts){ return ts == null ? "—" : new Date((ts + 19800) * 1000).toISOString().slice(11, 16); }
function jWhen(ts, sec){ if(ts == null) return "—"; const d = new Date((ts + 19800) * 1000), iso = d.toISOString();
  return `${d.getUTCDate()} ${J_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${iso.slice(11, sec ? 19 : 16)}`; }
function jFmtDay(k){ if(!k || /^(0000|9999)/.test(k)) return "…"; const [y, m, d] = k.split("-").map(Number); return `${d} ${J_MONTHS[m - 1]} ${y}`; }
function jDur(s){ if(s == null) return "—"; const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = Math.round(s % 60);
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : m ? `${m}m ${x}s` : `${x}s`; }
function jTodayKey(){ return jDayKey(Date.now() / 1000); }
function jAddDays(key, n){ const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function jShort(s){ return String(s || "").split(":").pop(); }
function jPx(v){ if(v == null) return "—"; return Number(v).toLocaleString("en-IN", {maximumFractionDigits: 4}); }
function jPillars(){ return (JN.d && JN.d.pillars) || []; }
function jPillar(n){ return jPillars()[n - 1] || {n, title: "Pillar " + n, short: "P" + n, rule: ""}; }
function jPref(){ const v = typeof prefGet === "function" ? prefGet("jn", {}) : {}; return v && typeof v === "object" ? v : {}; }
function jPrefSet(k, v){ const p = {...jPref(), [k]: v}; if(typeof prefSet === "function") prefSet("jn", p); }
async function japi(path, body){ return api(path, body === undefined ? {} : {body}); }
function jToast(t){ if(typeof toast === "function") toast(t); }

/* ------------------------------------------------------------------ the octagon seal: one side per pillar, top = pillar 1, clockwise */
function jSeal(states, size = 30, {center = "", note = ""} = {}){
  const pt = (r, deg) => { const a = deg * Math.PI / 180; return `${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`; };
  const R = 49, r = size >= 70 ? 37 : 30, gap = size >= 70 ? 1.6 : 2.4;
  const segs = states.map((st, i) => {
    const a0 = -112.5 + i * 45 + gap, a1 = a0 + 45 - 2 * gap, p = jPillar(i + 1);
    return `<polygon class="sg-${st || "na"}" points="${pt(R, a0)} ${pt(R, a1)} ${pt(r, a1)} ${pt(r, a0)}"><title>${p.n} · ${jEsc(p.title)}: ${J_STATE_WORD[st] || "not recorded"}</title></polygon>`;
  }).join("");
  const clean = states.every(s => s === "pass" || s === "warn" || s === "off") && states.filter(s => s === "pass").length >= 5;
  const inner = [0, 1, 2, 3, 4, 5, 6, 7].map(i => pt(r - 7, -112.5 + i * 45)).join(" ");
  const core = clean ? `<polygon class="sg-core" points="${inner}" />` : (center ? `<text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-size="${size >= 70 ? 22 : 30}" font-weight="700" class="sg-txt">${jEsc(center)}</text>` : "");
  return `<svg class="jseal" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${jEsc(note || "Octagon")}">${segs}${core}</svg>`;
}
function jStates(a){ return [1, 2, 3, 4, 5, 6, 7, 8].map(n => a ? a.P["p" + n].state : "na"); }
function jAggregate(list){
  return [1, 2, 3, 4, 5, 6, 7, 8].map(n => {
    const s = list.map(a => a.P["p" + n].state);
    return s.includes("fail") ? "fail" : s.includes("warn") ? "warn" : s.includes("pass") ? "pass" : s.includes("na") ? "na" : "off";
  });
}

/* ------------------------------------------------------------------ loading */
async function jnLoad(){
  if(JN.busy) return;
  JN.busy = true;
  try{
    const j = await japi("/api/journal");
    if(j.ok){ JN.d = j.j; JN.loadedAt = Date.now(); jnRender(); }
    else if(jq("#jnBody")) jq("#jnBody").innerHTML = `<div class="empty">Couldn't load the journal: ${jEsc(j.error || "")}</div>`;
  } finally { JN.busy = false; }
}
function jnMerge(j){
  if(!j) return;
  if(!j.partial || !JN.d){ JN.d = j; return; }
  const ids = new Set(j.trades.map(t => t.id)), keys = new Set(Object.keys(j.sessions || {}));
  JN.d.trades = JN.d.trades.filter(t => !ids.has(t.id) && !keys.has(t.skey)).concat(j.trades);
  Object.assign(JN.d.sessions, j.sessions || {});
  for(const k of ["today", "reps", "practice", "reviews", "rules", "accounts", "hidden_n", "now"]) if(k in j) JN.d[k] = j[k];
}
let jnPushT = 0;
function jnPush(){                         // the server says the journal changed (a trade arrived or closed)
  clearTimeout(jnPushT);
  jnPushT = setTimeout(() => { if(JN.holding){ jnPush(); return; }       // never rebuild under a finger holding a button
    if(typeof PG !== "undefined" && PG.page === "journal" && !JN.form) jnLoad(); else JN.stale = true; }, 300);
}

/* ------------------------------------------------------------------ the page */
function jnShow(){
  const box = jq("#pg_journal"); if(!box) return;
  if(!box.dataset.built){
    box.dataset.built = "1";
    box.innerHTML = `<div class="pg-head jn-head"><h2>Journal</h2>
        <div class="seg jn-sub" id="jnSub"><button data-v="trades" class="on">Trades</button><button data-v="insights">Insights</button><button data-v="review">Review</button><button data-v="settings">Settings</button></div>
        <span class="sp"></span><span class="muted jn-note" id="jnNote"></span><button class="ghost jn-aibtn" id="jnAiBtn" title="Copy today's trades, with all 8 pillars, to paste into Gemini">Copy for Gemini</button></div>
      <div class="jn-filters" id="jnFilters"></div>
      <div id="jnBody"><div class="empty">Loading the journal…</div></div>`;
    jqa("#jnSub button").forEach(b => b.onclick = () => { JN.sub = b.dataset.v; jqa("#jnSub button").forEach(x => x.classList.toggle("on", x === b)); jnRender(); });
    jq("#jnAiBtn").onclick = () => { if(JN.d && typeof jiAiOpen === "function") jiAiOpen("today"); };
  }
  jqa("#jnSub button").forEach(x => x.classList.toggle("on", x.dataset.v === JN.sub));
  if(!JN.d || JN.stale || Date.now() - JN.loadedAt > 15000){ JN.stale = false; jnLoad(); } else jnRender();
}
function jnRender(){
  if(!JN.d || !jq("#jnBody")) return;
  if(JN.holding){ clearTimeout(JN.rT); JN.rT = setTimeout(jnRender, 400); return; }
  jq("#jnFilters").classList.toggle("hide", JN.sub !== "trades" && JN.sub !== "insights");
  if(JN.sub === "settings"){ jnSettings(); return; }
  if(JN.sub === "review"){ if(typeof jiReview === "function") jiReview(); return; }
  jnFilters();
  jnTrades();
}

/* ------------------------------------------------------------------ filters (saved in prefs, on every device) */
function jF(){
  const p = jPref();
  return {period: p.period || "all", from: p.from || "", to: p.to || "", acct: p.acct || "", sym: p.sym || "", side: p.side || "",
    oct: p.oct || "", regime: Array.isArray(p.regime) ? p.regime : [], tag: Array.isArray(p.tag) ? p.tag : [], tagMode: p.tagMode === "all" ? "all" : "any", q: JN.q || ""};
}
function jPeriodRange(p, f){
  const now = new Date(Date.now() + 19800e3), y = now.getUTCFullYear(), mo = now.getUTCMonth(), da = now.getUTCDate();
  const key = d => d.toISOString().slice(0, 10), day = off => key(new Date(Date.UTC(y, mo, da + off)));
  const dow = (now.getUTCDay() + 6) % 7;
  switch(p){
    case "today": return {from: day(0), to: day(0)};
    case "yesterday": return {from: day(-1), to: day(-1)};
    case "thisweek": return {from: day(-dow), to: day(0)};
    case "lastweek": return {from: day(-dow - 7), to: day(-dow - 1)};
    case "7d": return {from: day(-6), to: day(0)};
    case "30d": return {from: day(-29), to: day(0)};
    case "90d": return {from: day(-89), to: day(0)};
    case "thismonth": return {from: key(new Date(Date.UTC(y, mo, 1))), to: day(0)};
    case "lastmonth": return {from: key(new Date(Date.UTC(y, mo - 1, 1))), to: key(new Date(Date.UTC(y, mo, 0)))};
    case "thisyear": return {from: `${y}-01-01`, to: day(0)};
    case "custom": return f.from || f.to ? {from: f.from || "0000-01-01", to: f.to || "9999-12-31"} : null;
    default: return null;
  }
}
function jTags(){
  const count = new Map(), last = new Map();
  for(const t of JN.d.trades) for(const g of t.setup || []){
    const k = g.toLowerCase(); count.set(k, (count.get(k) || 0) + 1);
    if(!last.has(k) || (t.opened || 0) > last.get(k).at) last.set(k, {name: g, at: t.opened || 0});
  }
  return [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || last.get(b).at - last.get(a).at).map(k => ({name: last.get(k).name, n: count.get(k)}));
}
function jAcctName(id){ const a = ((JN.d && JN.d.accounts) || []).find(x => x.id === id); return a ? a.name : ""; }
function jnFilters(){
  const el = jq("#jnFilters"), f = jF(), d = JN.d;
  const opt = (pairs, v) => pairs.map(([k, l]) => `<option value="${jEsc(k)}"${k === v ? " selected" : ""}>${jEsc(l)}</option>`).join("");
  const cur = jCur(), curs = jCurList();
  const syms = [...new Set(d.trades.filter(t => (t.cur || "INR") === cur).map(t => t.s))].sort().map(s => [s, jShort(s)]);
  const used = new Set(d.trades.map(t => t.acct));
  const accts = d.accounts.filter(a => (!a.archived || used.has(a.id)) && (a.cur || "INR") === cur)
    .map(a => [a.id, (a.mode === "mt5" ? "MT5 " : "") + a.name + (a.mode === "live" ? " · LIVE" : "") + (a.archived ? " (archived)" : "")]);
  if(f.acct && !accts.some(a => a[0] === f.acct)){ jPrefSet("acct", ""); f.acct = ""; }
  const regimes = [...d.oct.regime.map(v => [v, v]), ["__none", "Not recorded"]], tags = [...jTags().map(x => [x.name.toLowerCase(), `${x.name} (${x.n})`]), ["__none", "No tag"]];
  const msBtn = (kind, sel, all, list) => { const n = sel.length, name = v => (list.find(x => x[0] === v) || [v, v])[1];
    return n ? (n === 1 ? name(sel[0]) : `${n} ${kind === "regime" ? "regimes" : "tags · " + (f.tagMode === "all" ? "all of" : "any of")}`) : all; };
  if(!el.dataset.built || el.dataset.sig !== JSON.stringify([syms, accts, tags.length, cur, curs])){
    el.dataset.built = "1"; el.dataset.sig = JSON.stringify([syms, accts, tags.length, cur, curs]);
    el.innerHTML = `<button type="button" class="jn-ftog" id="jnFtog"><span>Filters</span><b id="jnFsum"></b><i>▾</i></button>
      <div class="jn-fields">
        ${curs.length > 1 ? `<div class="jn-curf"><label>Money</label><span class="seg" id="jfCur" title="Fyers accounts in ₹, MT5 accounts in their own currency: never added together">${curs.map(c => `<button type="button" data-c="${jEsc(c)}" class="${c === cur ? "on" : ""}">${jEsc(jSym(c).trim())} ${c === "INR" ? "Fyers" : "MT5"}</button>`).join("")}</span></div>` : ""}
        <div><label>Period</label><select id="jfPeriod">${opt(J_PERIODS, f.period)}</select></div>
        <div class="jf-custom${f.period === "custom" ? "" : " hide"}"><label>From</label><input type="date" id="jfFrom" value="${jEsc(f.from)}"></div>
        <div class="jf-custom${f.period === "custom" ? "" : " hide"}"><label>To</label><input type="date" id="jfTo" value="${jEsc(f.to)}"></div>
        <div><label>Account</label><select id="jfAcct"><option value="">All accounts</option>${opt(accts, f.acct)}</select></div>
        <div><label>Contract</label><select id="jfSym"><option value="">All contracts</option>${opt(syms, f.sym)}</select></div>
        <div><label>Side</label><select id="jfSide">${opt([["", "Long and short"], ["buy", "Long (buy)"], ["sell", "Short (sell)"]], f.side)}</select></div>
        <div><label>Octagon</label><select id="jfOct">${opt(J_OCTF, f.oct)}</select></div>
        <div class="jn-ms"><label>Regime</label><button type="button" class="jn-msb" data-ms="regime"></button><div class="jn-pop hide" id="jmsRegime"></div></div>
        <div class="jn-ms"><label>Setup tag</label><button type="button" class="jn-msb" data-ms="tag"></button><div class="jn-pop hide" id="jmsTag"></div></div>
        <div class="jf-q"><label>Search</label><input type="text" id="jfQ" placeholder="Contract, notes, tags…" value="${jEsc(JN.q || "")}"></div>
      </div>`;
    jq("#jnFtog").onclick = () => el.classList.toggle("open");
    jqa("#jfCur [data-c]").forEach(b => b.onclick = () => { JN.cur = b.dataset.c; jnFilters(); jnTrades(); });
    const on = (id, k) => jq(id).onchange = e => { jPrefSet(k, e.target.value); if(k === "period") jqa(".jf-custom").forEach(x => x.classList.toggle("hide", e.target.value !== "custom")); jnTrades(); jnFilterSum(); };
    on("#jfPeriod", "period"); on("#jfFrom", "from"); on("#jfTo", "to"); on("#jfAcct", "acct"); on("#jfSym", "sym"); on("#jfSide", "side"); on("#jfOct", "oct");
    jq("#jfQ").oninput = e => { JN.q = e.target.value; clearTimeout(JN.qT); JN.qT = setTimeout(() => { jnTrades(); jnFilterSum(); }, 200); };
    jqa(".jn-msb").forEach(b => b.onclick = e => { e.stopPropagation(); const pop = b.nextElementSibling, open = pop.classList.contains("hide");
      jqa(".jn-pop").forEach(p => p.classList.add("hide")); if(open){ pop.classList.remove("hide"); jnMsList(b.dataset.ms); } });
  }
  const rb = el.querySelector('[data-ms="regime"]'), tb = el.querySelector('[data-ms="tag"]');
  rb.textContent = msBtn("regime", f.regime, "All regimes", regimes); rb.classList.toggle("set", f.regime.length > 0);
  tb.textContent = msBtn("tag", f.tag, "All tags", tags); tb.classList.toggle("set", f.tag.length > 0);
  JN.msChoices = {regime: regimes, tag: tags};
  jnFilterSum();
}
function jnMsList(kind){
  const pop = jq(kind === "regime" ? "#jmsRegime" : "#jmsTag"), f = jF(), sel = f[kind], list = JN.msChoices[kind];
  const cnt = v => kind === "regime" ? JN.d.trades.filter(t => v === "__none" ? !t.regime : t.regime === v).length
    : JN.d.trades.filter(t => v === "__none" ? !(t.setup || []).length : (t.setup || []).some(g => g.toLowerCase() === v)).length;
  pop.innerHTML = `<div class="jn-msl">${list.map(([v, l]) => `<label class="jn-msr"><input type="checkbox" data-v="${jEsc(v)}"${sel.includes(v) ? " checked" : ""}><span>${jEsc(kind === "tag" ? l.replace(/ \(\d+\)$/, "") : l)}</span><small>${cnt(v)}</small></label>`).join("") || '<div class="muted">No tags yet.</div>'}</div>
    <div class="jn-msf">${kind === "tag" ? `<span class="seg"><button type="button" data-m="any" class="${f.tagMode === "any" ? "on" : ""}">Any of these</button><button type="button" data-m="all" class="${f.tagMode === "all" ? "on" : ""}">All of these</button></span>` : `<span class="muted">Trades in any ticked regime</span>`}
      <button type="button" class="ghost" data-clear="1">Clear</button></div>`;
  pop.onclick = e => e.stopPropagation();
  pop.querySelectorAll("input").forEach(i => i.onchange = () => { const cur = jF()[kind], v = i.dataset.v;
    jPrefSet(kind, cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]); jnFilters(); jnTrades(); });
  pop.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { jPrefSet("tagMode", b.dataset.m); jnMsList(kind); jnFilters(); jnTrades(); });
  pop.querySelector("[data-clear]").onclick = () => { jPrefSet(kind, []); jnMsList(kind); jnFilters(); jnTrades(); };
}
document.addEventListener("click", () => jqa(".jn-pop").forEach(p => p.classList.add("hide")));
function jnFilterSum(){
  const f = jF(), bits = [], r = jPeriodRange(f.period, f), cur = jCur();
  if(jCurList().length > 1) bits.push(cur === "INR" ? "₹ Fyers" : jSym(cur).trim() + " MT5");
  bits.push(!r ? "All time" : (f.period === "custom" ? "" : (J_PERIODS.find(p => p[0] === f.period) || ["", ""])[1] + " · ") + (r.from === r.to ? jFmtDay(r.from) : `${jFmtDay(r.from)} – ${jFmtDay(r.to)}`));
  if(f.acct) bits.push(jAcctName(f.acct) || "deleted account");
  if(f.sym) bits.push(jShort(f.sym));
  if(f.side) bits.push(f.side === "buy" ? "Long" : "Short");
  if(f.oct) bits.push((J_OCTF.find(x => x[0] === f.oct) || ["", ""])[1]);
  if(f.regime.length) bits.push(f.regime.length === 1 ? (f.regime[0] === "__none" ? "regime not recorded" : f.regime[0]) : f.regime.length + " regimes");
  if(f.tag.length) bits.push(f.tag.length + (f.tag.length === 1 ? " tag" : " tags"));
  if(JN.q) bits.push(`“${JN.q}”`);
  const s = jq("#jnFsum"); if(s) s.textContent = bits.join(" · ");
  const n = jq("#jnNote"); if(n) n.textContent = cur === "INR" ? "Dated by close time, IST. Money and R are net of all charges."
    : `Dated by close time, IST. Money (${jSym(cur).trim()}) and R are net of commission and swap.`;
}
function jFiltered(o = {}){
  const f = jF(), r = jPeriodRange(f.period, f), q = (f.q || "").toLowerCase().trim();
  if(o.ignoreOct && f.oct !== "removed") f.oct = "";
  const hasTag = (t, v) => v === "__none" ? !(t.setup || []).length : (t.setup || []).some(g => g.toLowerCase() === v);
  const cur = jCur();
  return JN.d.trades.filter(t => {
    if((t.cur || "INR") !== cur) return false;                      // (₹ and $ never in one view)
    if(f.oct === "removed") return t.hidden;
    if(t.hidden) return false;
    const a = t.audit, dk = jDayKey(t.status === "closed" && t.closed ? t.closed : t.opened);
    if(r && (dk < r.from || dk > r.to)) return false;
    if(f.acct && t.acct !== f.acct) return false;
    if(f.sym && t.s !== f.sym) return false;
    if(f.side && (f.side === "buy" ? t.side < 0 : t.side > 0)) return false;
    if(f.regime.length && !f.regime.some(v => v === "__none" ? !t.regime : t.regime === v)) return false;
    if(f.tag.length && !(f.tagMode === "all" ? f.tag.every(v => hasTag(t, v)) : f.tag.some(v => hasTag(t, v)))) return false;
    if(f.oct === "clean" && !a.clean) return false;
    if(f.oct === "broken" && !a.breaches.length) return false;
    if(f.oct === "untagged" && a.recorded) return false;
    if(f.oct === "open" && t.status !== "open") return false;
    if(/^p\d$/.test(f.oct) && a.P[f.oct].state !== "fail") return false;
    if(q && ![t.s, jShort(t.s), t.acct_name, t.notes, t.review, (t.setup || []).join(" "), t.direction, t.wait, t.execution, t.zen, t.target, t.regime,
      t.reason, a.breaches.map(b => b.note).join(" ")].join(" ").toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (b.opened || 0) - (a.opened || 0));
}

/* ------------------------------------------------------------------ stats, balance curve, drawdown */
function jSummary(items){
  const closed = items.filter(t => t.status === "closed" && t.net != null);
  const wins = closed.filter(t => t.net > 0), losses = closed.filter(t => t.net < 0);
  const gp = wins.reduce((s, t) => s + t.net, 0), gl = -losses.reduce((s, t) => s + t.net, 0), withR = closed.filter(t => t.r != null);
  return {count: items.length, closed: closed.length, wins: wins.length, losses: losses.length, net: closed.reduce((s, t) => s + t.net, 0),
    winRate: closed.length ? wins.length / closed.length : null, pf: gl > 0 ? gp / gl : (gp > 0 ? Infinity : null),
    avgR: withR.length ? withR.reduce((s, t) => s + t.r, 0) / withR.length : null, fees: closed.reduce((s, t) => s + (t.charges || 0), 0)};
}
function jCurveView(items, bal){
  const pts = items.filter(t => t.status === "closed" && t.net != null && t.closed != null).sort((a, b) => a.closed - b.closed);
  let start = 0;
  if(bal && pts.length){
    const seen = new Set();
    for(const t of pts){ if(seen.has(t.acct)) continue; seen.add(t.acct); start += t.balance_after != null ? t.balance_after - t.net : 0; }
  }
  return {start: Math.round(start * 100) / 100, pts, n: pts.length, accts: new Set(pts.map(t => t.acct)).size};
}
function jDrawdown(v){
  let b = v.start, peak = v.start, maxDd = 0, ddPeak = v.start;
  for(const t of v.pts){ b += t.net; peak = Math.max(peak, b); if(peak - b > maxDd){ maxDd = peak - b; ddPeak = peak; } }
  return {n: v.n, start: v.start, end: b, peak, maxDd, maxDdPct: ddPeak > 0 ? maxDd / ddPeak * 100 : 0, nowDd: peak - b, nowDdPct: peak > 0 ? (peak - b) / peak * 100 : 0};
}
function jCurveSvg(v){
  if(!v.n) return "";
  let c = v.start; const ys = [v.start, ...v.pts.map(t => (c += t.net))];
  const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1, W = 600, H = 60;
  const X = i => i / (ys.length - 1) * W, Y = y => H - (y - min) / span * H;
  const line = ys.map((y, i) => `${X(i).toFixed(1)},${Y(y).toFixed(1)}`).join(" "), up = c >= v.start, y0 = Y(v.start).toFixed(1);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="${up ? "jc-up" : "jc-down"}" aria-label="Curve">
    <line x1="0" x2="${W}" y1="${y0}" y2="${y0}" class="jc-base" vector-effect="non-scaling-stroke" />
    <polygon points="0,${y0} ${line} ${W},${y0}" class="jc-fill" /><polyline points="${line}" class="jc-line" vector-effect="non-scaling-stroke" /></svg>`;
}

/* ------------------------------------------------------------------ Trades tab */
function jnTrades(){
  const body = jq("#jnBody"); if(!body) return;
  if(JN.sub === "insights"){ if(typeof jiInsights === "function") jiInsights(); return; }
  if(JN.sub !== "trades") return;
  if(!body.querySelector(".jn-grid")){
    body.innerHTML = `<div class="jn-grid">
      <aside class="jn-side"><section class="jn-card jn-reps" id="jnReps"></section><section class="jn-card jn-today" id="jnToday"></section></aside>
      <section class="jn-main">
        <div class="jn-goal hide" id="jnGoal"></div>
        <div class="jn-card jn-strip" id="jnStrip"></div>
        <div class="jn-ledger-head"><b><span id="jnCount">0</span> trades</b><span class="muted" id="jnHid"></span></div>
        <div id="jnList"></div>
      </section></div>`;
    jq("#jnList").addEventListener("click", jnListClick);
    jq("#jnList").addEventListener("keydown", e => { if(e.key === "Enter" && e.target.matches("[data-act=toggle]")) jnListClick(e); });
  }
  jnReps(); jnToday(); jnGoal();
  const items = jFiltered(), s = jSummary(items), f = jF();
  const bal = jPref().curve !== "pl", v = jCurveView(items, bal), dd = jDrawdown(v);
  jq("#jnStrip").innerHTML = `
    <div class="jn-net"><span>Net result</span><b class="${s.net > 0 ? "up" : s.net < 0 ? "down" : ""}">${s.closed ? jMoney(s.net) : "—"}</b></div>
    <dl class="jn-stats">
      <div><dt>Win rate</dt><dd>${s.winRate == null ? "—" : Math.round(s.winRate * 100) + "%"}</dd></div>
      <div><dt>Profit factor</dt><dd>${s.pf == null ? "—" : s.pf === Infinity ? "∞" : s.pf.toFixed(2)}</dd></div>
      <div><dt>Average R</dt><dd>${jR(s.avgR)}</dd></div>
      <div><dt>Closed trades</dt><dd>${s.closed}${s.count > s.closed ? `<small>+${s.count - s.closed} open</small>` : ""}</dd></div>
      <div><dt>Expectancy</dt><dd>${s.closed ? jMoney(s.net / s.closed) : "—"}</dd></div>
      <div><dt>Charges</dt><dd>${s.closed ? jMoney(s.fees, false) : "—"}</dd></div>
      <div title="Largest fall from a high in this view"><dt>Max drawdown</dt><dd>${!dd.n ? "—" : dd.maxDd > 0.005 ? `<span class="down">${jMoney(dd.maxDd, false)}</span>${bal ? `<small>${dd.maxDdPct.toFixed(2)}%</small>` : ""}` : '<span class="up">None</span>'}</dd></div>
      <div title="How far the curve is below its highest point"><dt>Below peak now</dt><dd>${!dd.n ? "—" : dd.nowDd > 0.005 ? `<span class="down">${jMoney(dd.nowDd, false)}</span>${bal ? `<small>${dd.nowDdPct.toFixed(2)}%</small>` : ""}` : '<span class="up">At the high</span>'}</dd></div>
    </dl>
    <div class="jn-curvebar"><span class="seg" id="jnCurveMode"><button data-v="bal" class="${bal ? "on" : ""}">Balance</button><button data-v="pl" class="${bal ? "" : "on"}">P&amp;L</button></span>
      <span class="muted">${!dd.n ? "" : bal ? `${v.accts > 1 ? v.accts + " accounts · " : ""}Start ${jMoney(dd.start, false)} → <b>${jMoney(dd.end, false)}</b> · peak ${jMoney(dd.peak, false)}` : `P&amp;L from 0 → <b>${jMoney(dd.end)}</b> · peak ${jMoney(dd.peak)}`}</span></div>
    <div class="jn-curve">${jCurveSvg(v)}</div>`;
  jqa("#jnCurveMode button").forEach(b => b.onclick = () => { jPrefSet("curve", b.dataset.v); jnTrades(); });
  jq("#jnCount").textContent = items.length;
  jq("#jnHid").innerHTML = JN.d.hidden_n && f.oct !== "removed" ? `${JN.d.hidden_n} removed from the journal · <a href="#" id="jnShowHid">show</a>` : "";
  const sh = jq("#jnShowHid"); if(sh) sh.onclick = e => { e.preventDefault(); jPrefSet("oct", "removed"); jnFilters(); const o = jq("#jfOct"); if(o) o.value = "removed"; jnTrades(); };
  jq("#jnList").innerHTML = items.length ? items.map(jCard).join("")
    : `<div class="empty">${JN.d.trades.length ? "No trades in this period or filter." : "No trades yet. Every paper, live and MT5 trade comes here on its own: place one from the chart."}</div>`;
  jnBindClaim();
}
function jCard(t){
  const a = t.audit, open = JN.exp.has(t.id), m = {closed: t.status === "closed"};
  const cl = !m.closed ? "open" : t.net > 0 ? "win" : t.net < 0 ? "loss" : "";
  const when = jWhen(t.opened);
  const px = `${jPx(t.avg)} → ${m.closed ? jPx(t.exit) : "open"}`;
  const dur = m.closed && t.closed != null && t.opened != null ? jDur(t.closed - t.opened) : "still open";
  const fact = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
  const nb = a.breaches.length;
  return `<div class="jn-trade ${cl}${open ? " expanded" : ""}${t.hidden ? " hid" : ""}" data-id="${jEsc(t.id)}">
    <div class="jt-row" data-act="toggle" data-id="${jEsc(t.id)}" role="button" tabindex="0" aria-expanded="${open}">
      ${jSeal(jStates(a), 32, {center: nb ? String(nb) : "", note: a.clean ? "Clean octagon" : nb + " pillar(s) broken"})}
      <div class="jt-main"><b>${jEsc(jShort(t.s))}</b><span class="jt-side ${t.side > 0 ? "buy" : "sell"}">${t.side > 0 ? "Buy" : "Sell"} ${t.lots ?? ""}</span>${jModeTag(t.mode)}
        <div class="jt-sub">${t.rep ? `<span class="jt-rep${t.claimedAt ? "" : " open"}" title="${t.claimedAt ? "Claimed" : "Waiting to be claimed on the Reps card"}">Rep ${t.rep}${t.claimedAt ? "" : " ○"}</span> · ` : ""}${jEsc(when)} · ${jEsc(t.acct_name)}${(t.shots || []).length ? ` · <span class="jt-pics" title="Pictures">📷 ${t.shots.length}</span>` : ""}</div></div>
      <div class="jt-px"><div class="mono">${px}</div><div class="jt-sub">${dur}${t.tod ? " · " + jEsc(t.tod) : ""}</div></div>
      <div class="jt-net mono ${t.net > 0 ? "up" : t.net < 0 ? "down" : ""}">${m.closed ? jMoney(t.net, true, t.cur) : "Open"}<small class="${t.r == null ? "muted" : t.r >= 0 ? "up" : "down"}">${t.r == null ? "" : jR(t.r)}</small></div>
      <span class="jt-chev">›</span>
    </div>
    ${open ? `<div class="jt-detail">
      ${jBreaches(a)}
      <div class="jn-badges">${jChips(t, a)}${t.regime ? `<span class="jb jb-calm" title="Market regime">Regime · ${jEsc(t.regime)}</span>` : ""}${J_NUM.map(({key, label}) => t[key] != null ? `<span class="jb jb-calm">${label} · <span class="mono">${jBias(t[key])}</span></span>` : "").join("")}${(t.setup || []).map(x => `<span class="jb jb-tag">${jEsc(x)}</span>`).join("")}</div>
      <div class="jn-facts">
        ${fact("Opened (IST)", `<span class="mono">${jEsc(jWhen(t.opened, true))}</span>`)}
        ${fact("Closed (IST)", m.closed ? `<span class="mono">${jEsc(jWhen(t.closed, true))}</span>` : "Still open")}
        ${fact("Prices", `<span class="mono">${px}</span>${(t.entries || []).length > 1 ? ` <span class="muted">(${t.entries.length} entries)</span>` : ""}`)}
        ${fact("First stop · last stop · target", `<span class="mono">${jPx(t.first_sl)} · ${jPx(t.sl)} · ${jPx(t.tp)}</span>`)}
        ${fact("Risk at the first stop", t.init_risk ? `<span class="mono">${jMoney(t.init_risk, false, t.cur)}</span> <span class="muted">net</span>` : "—")}
        ${fact("Planned", t.planned_r != null ? `<span class="mono">${t.planned_r.toFixed(2)}R</span>` : "—")}
        ${fact("Gross · charges · net", m.closed ? `<span class="mono">${jMoney(t.gross, true, t.cur)} · ${jMoney(t.charges, false, t.cur)} · ${jMoney(t.net, true, t.cur)}</span>` : "—")}
        ${fact("Size · product", `${t.lots ?? "—"} lot${t.lots === 1 ? "" : "s"} <span class="muted">(qty ${t.qty ?? "—"})</span> · ${jEsc(({INTRADAY: "Intraday", MARGIN: "Carry", CNC: "Delivery"})[t.product] || t.product || "")}`)}
        ${fact("Exit", m.closed ? jEsc(J_REASON[t.reason] || t.reason || "—") + (t.parts_n > 1 ? ` <span class="muted">(${t.parts_n} parts)</span>` : "") : "—")}
        ${t.mode === "mt5" && t.status === "closed" ? fact("Replay candles", jKept(t)) : ""}
        ${fact("Account", `${jEsc(t.acct_name)} · ${jModeWord(t.mode)}${t.outside ? ` <span class="muted">· placed in ${t.mode === "mt5" ? "MT5" : "Fyers"}</span>` : ""}`)}
        ${t.best != null ? fact("Best · worst price", `<span class="mono">${jPx(t.best)} · ${jPx(t.worst)}</span>`) : ""}
        ${(() => { const p1 = (JN.d.p1 || []); return p1.length ? fact("Pillar 1 checks", `<span class="jt-checks">${p1.map(([k, l]) => `<span class="${(t.p1Checks || []).includes(k) ? "up" : "muted"}">${(t.p1Checks || []).includes(k) ? "✓" : "○"} ${jEsc(l)}</span>`).join("<br>")}</span>`) : ""; })()}
      </div>
      ${t.notes ? `<p class="jt-note"><i>Plan</i>${jEsc(t.notes)}</p>` : ""}
      ${t.review ? `<p class="jt-note"><i>Review</i>${jEsc(t.review)}</p>` : ""}
      ${typeof jsStrip === "function" ? jsStrip(t, "card") : ""}
      <div class="jt-foot"><span class="muted">${t.status === "closed" ? "" : "The audit can be done now; Pillar 8 is recorded once it closes."}</span>
        <span class="jt-acts">
          <button class="primary" data-act="audit" data-id="${jEsc(t.id)}">${a.recorded ? "Edit audit" : "Audit this trade"}</button>
          ${t.status === "closed" ? `<button data-act="replay" data-id="${jEsc(t.id)}" title="The trade on its chart: the set-up as recorded at entry / exit, the stop's path, ▶ Play to watch it as it happened">▶ On chart</button>` : ""}
          <button data-act="chart" data-id="${jEsc(t.id)}">Chart</button>
          <button data-act="ai" data-id="${jEsc(t.id)}" title="This trade with all 8 pillars, as text to paste into Gemini">Copy for Gemini</button>
          ${t.hidden ? `<button data-act="restore" data-id="${jEsc(t.id)}">Bring back</button>` : `<button class="ghost" data-act="hide" data-id="${jEsc(t.id)}" title="Leaves the stats, reps and sessions (the trade stays in History)">Remove from journal</button>`}
        </span></div>
    </div>` : ""}
  </div>`;
}
function jChips(t, a){
  const chip = (n, tone, text) => { const p = a.P["p" + n], P = jPillar(n);
    return `<span class="jb jb-${tone}" title="${jEsc(`Pillar ${n} · ${P.title}${p.note && p.state !== "pass" && p.state !== "na" ? " — " + p.note : ""}`)}">${n} · ${jEsc(text)}</span>`; };
  const std = n => { const st = a.P["p" + n].state; return chip(n, J_STATE_TONE[st], `${jPillar(n).short} ${J_STATE_MARK[st]}`); };
  return [std(1), chip(2, t.wait ? J_TONE.wait[t.wait] : "none", t.wait || jPillar(2).short + " —"), std(3), std(4), std(5), std(6), std(7), std(8)].join("");
}
function jBreaches(a){
  if(!a.breaches.length && !a.warns.length) return "";
  const line = (x, icon, c) => `<div${c ? ` class="${c}"` : ""}>${icon} ${x.p.slice(1)} · ${jEsc(jPillar(Number(x.p.slice(1))).short)} — ${jEsc(x.note)}</div>`;
  return `<div class="jn-breaches">${a.breaches.map(b => line(b, "⛔", "")).join("")}${a.warns.map(w => line(w, "⚠", "w")).join("")}</div>`;
}
async function jnListClick(e){
  const el = e.target.closest("[data-act]"); if(!el) return;
  const id = el.dataset.id, t = JN.d.trades.find(x => x.id === id); if(!t) return;
  const act = el.dataset.act;
  if(typeof jsAct === "function" && jsAct(el)) return;
  if(act === "toggle"){ JN.exp.has(id) ? JN.exp.delete(id) : JN.exp.add(id); if(JN.exp.has(id) && typeof JS !== "undefined") JS.last = id; const node = el.closest(".jn-trade"), tmp = document.createElement("div");
    tmp.innerHTML = jCard(t); node.replaceWith(tmp.firstElementChild); return; }
  if(act === "audit") jnForm(id);
  if(act === "ai" && typeof jiAiOpen === "function") jiAiOpen("trade", id);
  if(act === "chart") jnChart(t);
  if(act === "replay" && typeof rpOpen === "function") rpOpen(id);
  if(act === "hide" || act === "restore"){
    const j = await japi("/api/journal/hide", {id, hidden: act === "hide"});
    if(j.ok){ jnMerge(j.j); jnRender(); jToast(act === "hide" ? "Removed from the journal (still in History). Filter Octagon › Removed to bring it back." : "Back in the journal"); }
    else jToast(j.error || "Couldn't change it");
  }
}
function jnChart(t){
  pgShow("chart");
  const go = () => { const r = sym[t.s]; if(r) openSymbol(r); else openBySymbol(t.s); };
  if(!cur || cur.s !== t.s) go();
  let n = 0;
  const wait = setInterval(() => { n++;
    if(typeof cur !== "undefined" && cur && cur.s === t.s && typeof HROWS !== "undefined" && HROWS.length){ clearInterval(wait); try{ goTo(t.opened); }catch(e){} }
    else if(n > 40) clearInterval(wait); }, 250);
}

/* ------------------------------------------------------------------ Reps: every closed trade is one rep; the claim is yours */
function jnReps(){
  const el = jq("#jnReps"); if(!el) return;
  const R = JN.d.reps, B = R.block, total = R.total, before = R.before;
  const list = JN.d.trades.filter(t => t.rep && !t.hidden).sort((a, b) => a.rep - b.rep);
  const byRep = new Map(list.map(t => [t.rep, t]));
  const reached = total > 0 && total % B === 0, end = reached ? total : Math.max(B, Math.ceil(total / B) * B), start = end - B + 1;
  const counts = {held: 0, broken: 0, unaudited: 0}, cells = [];
  for(let r = start; r <= end; r++){
    if(r > total){ cells.push(`<i class="${r === total + 1 ? "next" : ""}" title="Rep ${r}"></i>`); continue; }
    if(r <= before){ cells.push(`<i class="pre" title="Rep ${r} · before this journal"></i>`); continue; }
    const t = byRep.get(r); if(!t){ cells.push("<i></i>"); continue; }
    counts[t.q]++;
    cells.push(`<i class="${t.q}${t.claimedAt ? "" : " unclaimed"}${t.id === JN.flash ? " just" : ""}" title="${jEsc(`Rep ${r} · ${t.acct_name} · ${jWhen(t.opened)} · ${jMoney(t.net, true, t.cur)} · ${({held: "no pillar broken", broken: "pillar broken", unaudited: "not audited"})[t.q]}${t.claimedAt ? "" : " · waiting to be claimed"}`)}"></i>`);
  }
  const waiting = list.filter(t => !t.claimedAt);
  const claim = waiting.length ? (() => { const t = waiting[0];
    return `<div class="jn-claimw"><button type="button" class="jn-claim" id="jnClaim" data-id="${jEsc(t.id)}" aria-label="Hold to claim rep ${t.rep}"><span class="jn-claimfill"></span><span class="jn-claimtxt">Hold to claim rep <b>${t.rep}</b></span></button>
      <div class="jn-claimsub">${jEsc(jShort(t.s))} ${t.side > 0 ? "buy" : "sell"} · ${jEsc(jWhen(t.opened))} · <span class="${t.net > 0 ? "up" : t.net < 0 ? "down" : ""}">${jMoney(t.net, true, t.cur)}</span> · ${({held: "no pillar broken", broken: "a pillar broke", unaudited: "not audited"})[t.q]}${waiting.length > 1 ? ` · ${waiting.length - 1} more waiting` : ""}</div></div>`; })() : "";
  el.classList.toggle("milestone", reached);
  const last = Math.floor(total / B) * B, lt = byRep.get(last);
  el.innerHTML = `<div class="jn-ch"><h3>Reps</h3><span class="muted">Block ${start}–${end}</span></div>
    <div class="jn-repsnum"><b>${total}</b><span>${reached ? `Milestone reached. Next target <b>${total + B}</b>.` : total ? `${end - total} more to <b>${end}</b>` : `Your first target is <b>${B}</b>.`}</span></div>
    ${B <= 200 ? `<div class="jn-repgrid" role="img" aria-label="${Math.max(0, total - start + 1)} of ${B} reps done in this block">${cells.join("")}</div>`
      : `<div class="jn-meter"><i style="width:${Math.max(0, Math.min(100, (total - start + 1) / B * 100))}%"></i></div>`}
    <div class="jn-replegend"><span style="--c:var(--jpass)">${counts.held} no pillar broken</span><span style="--c:var(--jfail)">${counts.broken} broken</span>${counts.unaudited ? `<span style="--c:var(--joff)">${counts.unaudited} not audited</span>` : ""}</div>
    ${claim}
    <div class="muted jn-small">${lt ? `Rep ${last} reached ${jEsc(jFmtDay(jDayKey(lt.closed)))}. ` : ""}Each closed trade is one rep. Finish the block — the count is the target, not the balance.</div>`;
}
function jnBindClaim(){
  const b = jq("#jnClaim"); if(!b || b.dataset.bound) return;
  b.dataset.bound = "1";
  let timer = null;
  const start = e => { if(e) e.preventDefault(); if(timer) return; JN.holding = true; b.classList.add("holding"); timer = setTimeout(() => { timer = null; JN.holding = false; jnClaim(b.dataset.id); }, 900); };
  const stop = () => { JN.holding = false; if(!timer) return; clearTimeout(timer); timer = null; b.classList.remove("holding"); };
  b.addEventListener("pointerdown", start); ["pointerup", "pointerleave", "pointercancel"].forEach(ev => b.addEventListener(ev, stop));
  b.addEventListener("keydown", e => { if((e.key === " " || e.key === "Enter") && !e.repeat) start(e); });
  b.addEventListener("keyup", e => { if(e.key === " " || e.key === "Enter") stop(); });
  b.addEventListener("contextmenu", e => e.preventDefault());
}
async function jnClaim(id){
  const j = await japi("/api/journal/claim", {id});
  if(!j.ok){ jToast(j.error || "Couldn't claim it"); jnTrades(); return; }
  jnMerge(j.j); JN.flash = id;
  const t = JN.d.trades.find(x => x.id === id), n = t ? t.rep : 0, B = JN.d.reps.block, next = Math.ceil(n / B) * B;
  jnTrades();
  setTimeout(() => { if(JN.flash === id) JN.flash = null; }, 1600);
  if(navigator.vibrate) try{ navigator.vibrate(18); }catch(e){}
  jToast(n % B === 0 ? `✓ Rep ${n} claimed — milestone reached. Next target ${n + B}.` : `✓ Rep ${n} claimed. ${next - n} more to ${next}.`);
}

/* ------------------------------------------------------------------ Today: the session's lockouts (pillars 4, 5), practice */
function jnTodayAcct(){
  const cur = jCur(), inCur = id => { const a = JN.d.accounts.find(x => x.id === id); return a && (a.cur || "INR") === cur && JN.d.today[id]; };
  const f = jF().acct, accts = JN.d.accounts.filter(a => !a.archived && JN.d.today[a.id] && (a.cur || "INR") === cur);
  if(f && inCur(f)) return f;
  if(JN.todayAcct && inCur(JN.todayAcct)) return JN.todayAcct;
  if(typeof ACCT !== "undefined" && ACCT && inCur(ACCT)) return ACCT;
  return accts.length ? accts[0].id : "";
}
function jPracticeStreak(){
  let n = 0, k = jTodayKey();
  if(!JN.d.practice[k]) k = jAddDays(k, -1);
  while(JN.d.practice[k]){ n++; k = jAddDays(k, -1); }
  return n;
}
function jMeter(pct, color){ return `<div class="jn-meter"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%;background:${color}"></i></div>`; }
function jnToday(){
  const el = jq("#jnToday"); if(!el) return;
  const aid = jnTodayAcct(), st = JN.d.today[aid], acc = JN.d.accounts.find(a => a.id === aid), R = JN.d.rules;
  if(!st){ el.innerHTML = `<div class="jn-ch"><h3>Today</h3></div><div class="muted">No open account.</div>`; return; }
  const cur = acc && acc.cur || "INR", M = (n, sg = true) => jMoney(n, sg, cur), mt = acc && acc.mode === "mt5";
  const base = s0 => s0 ? s0.base : acc ? (mt && acc.dd_base ? acc.dd_base : acc.size) : 0;
  const s = st.session, limit = base(s) * R.dd_pct / 100, now = Date.now() / 1000;
  const todays = JN.d.trades.filter(t => t.skey === `${aid}|${st.day}` && !t.hidden);
  const states = todays.length ? jAggregate(todays.map(t => t.audit)) : jStates(null), broken = states.filter(x => x === "fail").length;
  let cls = "ok", head;
  const lk = st.lock;
  if(lk){ cls = lk.kind === "afk" ? "afk" : "lock"; head = jEsc(lk.text) + (lk.on ? "" : lk.mt5_off ? ` <span class="muted">(not blocking: lockouts are off for this MT5 account, Journal › Settings)</span>` : ` <span class="muted">(not blocking: its switch is off)</span>`); }
  else if(!s) head = "Fresh session. Click only when patient.";
  else head = `Clear. ${M(Math.max(0, limit - s.dd), false)} of room before the ${R.dd_pct}% line${mt ? ` (of ${M(base(s), false)}, FundingPips' day-start balance)` : ""}.`;
  const dd = s ? s.dd : 0, ddPct = limit ? dd / limit * 100 : 0;
  const heat = p => p >= 75 ? "var(--jfail)" : p >= 50 ? "var(--jwarn)" : "var(--jpass)";
  const mrow = (label, value, pct, color) => `<div class="jn-mrow"><span>${label}</span><b>${value}</b>${pct === undefined ? "" : jMeter(pct, color)}</div>`;
  const live = JN.d.accounts.filter(a => !a.archived && JN.d.today[a.id] && (a.cur || "INR") === cur);
  const chips = live.length > 1 ? `<div class="jn-chips">${live.map(a => `<button class="${a.id === aid ? "on" : ""}" data-ta="${jEsc(a.id)}">${a.mode === "mt5" ? "MT5 " : ""}${jEsc(a.name)}${a.mode === "live" ? " · LIVE" : ""}</button>`).join("")}</div>` : "";
  const done = !!JN.d.practice[jTodayKey()], streak = jPracticeStreak();
  const snapA = typeof P !== "undefined" && P.snap && typeof ACCT !== "undefined" && aid === ACCT ? P.snap.acct : null;
  const showAll = el.classList.contains("show-all");
  el.innerHTML = `<div class="jn-ch"><h3>Today</h3><span class="muted">${jModeWord(acc && acc.mode)}</span></div>
    <div class="jn-tsub">${mt ? "MT5 " : ""}${jEsc(acc ? acc.name : "")} · trading day ${jEsc(jFmtDay(st.day))}${mt ? ` <span class="muted">(${acc.mt5 && acc.mt5.day === "ist" ? "Indian day, from 06:00 IST" : "the broker's day"})</span>` : ""}</div>
    ${chips}
    <div class="jn-tseal">${jSeal(states, 92, {center: todays.length ? (broken ? String(broken) : "") : "", note: "Today's octagon"})}
      <div><div class="jn-sess ${cls}">${head}</div>
        <div class="muted jn-small" style="margin-top:8px">${todays.length ? `${todays.length} trade${todays.length === 1 ? "" : "s"} today${broken ? ` · ${broken} pillar${broken === 1 ? "" : "s"} broken` : " · octagon held"}` : "Each side of the octagon is a pillar; it lights up as you trade."}</div></div></div>
    ${mrow("Session P&amp;L (net, closed)", s ? `<span class="${s.cum > 0 ? "up" : s.cum < 0 ? "down" : ""}">${M(s.cum)}</span>` : "—")}
    ${snapA ? mrow("Day room (your risk rules)", snapA.day_room == null ? "off" : `<span class="${snapA.day_room < 0 ? "down" : ""}">${M(snapA.day_room, false)}</span>`) : ""}
    <button class="ghost jn-tog" id="jnTodayTog">${showAll ? "Hide limits" : "Show limits and practice"}</button>
    <div class="jn-tmore">
      ${mrow(`Off the peak · ${R.dd_pct}% line`, `${M(dd, false)} / ${M(limit, false)}`, ddPct, heat(ddPct))}
      ${s && s.winTimes.length ? mrow("Wins in a row", `${s.streak} of ${R.win_streak}`, s.streak / R.win_streak * 100, "var(--jwarn)")
        + mrow(`Wins of ${R.multi_r}R or more`, `${s.multi} of ${R.win_streak}`, s.multi / R.win_streak * 100, "var(--jwarn)")
        : mrow("99 Club", `<span class="muted" style="font-weight:500">starts at your first win</span>`)}
      <div class="jn-practice"><div class="jn-mantra">${jEsc(JN.d.mantra)}</div>
        <label class="jn-flag"><input type="checkbox" id="jnPractice"${done ? " checked" : ""}> Ground-state practice done today${streak ? ` <span class="muted">· ${streak}-day streak</span>` : ""}</label></div>
      ${st.ended || (lk && lk.kind === "end") ? "" : `<button class="jn-endbtn" id="jnEnd" data-acct="${jEsc(aid)}" title="Hold: ends today's session for this account${R.block_end ? " (new orders refused until the next trading day)" : ""}"><span class="jn-claimfill"></span><span>Hold to end today's session</span></button>`}
      <div class="muted jn-small">From the trades in the journal (closed trades, net of charges; open P&amp;L doesn't count). ${mt && !(acc.mt5 && acc.mt5.block) ? "Lockouts are shown only on this MT5 account (its switch is off: Journal › Settings)." : R.block_dd || R.block_afk || R.block_end ? "Lockouts refuse new orders: switches in Journal › Settings." : "Lockouts are shown only (switches off)."}</div>
    </div>`;
  el.querySelectorAll("[data-ta]").forEach(b => b.onclick = () => { JN.todayAcct = b.dataset.ta; jnToday(); });
  jq("#jnTodayTog").onclick = () => { el.classList.toggle("show-all"); jnToday(); };
  jq("#jnPractice").onchange = async e => { const j = await japi("/api/journal/practice", {day: jTodayKey(), on: e.target.checked}); if(j.ok){ JN.d.practice = j.practice; jnToday(); } };
  const eb = jq("#jnEnd");
  if(eb){ let tm = null;
    const go = async () => { const j = await api("/api/journal/end", {body: {acct: eb.dataset.acct}}); if(j.ok){ jnMerge(j.j); jnRender(); jToast("Session ended for today. Walk away with the 99 coins."); } else jToast(j.error || "Couldn't end it"); };
    eb.addEventListener("pointerdown", e => { e.preventDefault(); JN.holding = true; eb.classList.add("holding"); tm = setTimeout(() => { tm = null; JN.holding = false; go(); }, 1200); });
    ["pointerup", "pointerleave", "pointercancel"].forEach(ev => eb.addEventListener(ev, () => { JN.holding = false; if(tm){ clearTimeout(tm); tm = null; eb.classList.remove("holding"); } })); }
}
function jnGoal(){
  const el = jq("#jnGoal"); if(!el) return;
  const aid = jnTodayAcct(), acc = JN.d.accounts.find(a => a.id === aid), R = JN.d.rules, M = (n, sg = true) => jMoney(n, sg, acc && acc.cur);
  if(!acc || acc.balance == null || !acc.size){ el.classList.add("hide"); return; }
  const net = acc.balance - acc.size, pct = net / acc.size * 100, lo = Math.floor(pct / R.block_pct + 1e-9) * R.block_pct, hi = lo + R.block_pct;
  const prog = (pct - lo) / R.block_pct * 100, toGo = hi / 100 * acc.size - net, sg = v => `${v >= 0 ? "+" : "−"}${Math.abs(v)}`;
  el.classList.remove("hide");
  el.innerHTML = `<div class="jn-gitem"><div class="jn-gtop"><span>${R.block_pct}% execution block · Pillar 6</span><span class="muted">${jEsc(acc.name)}</span></div>
    <div class="jn-gbig"><span class="${pct > 0 ? "up" : pct < 0 ? "down" : ""}">${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%</span><small>${M(Math.max(0, toGo), false)} to go</small></div>
    <div class="jn-track"><i class="fill" style="width:${Math.max(0, Math.min(100, prog)).toFixed(1)}%"></i><i class="knob" style="left:${Math.max(0, Math.min(100, prog)).toFixed(1)}%"></i></div>
    <div class="jn-tends"><span>${sg(lo)}%</span><span>${sg(hi)}%</span></div>
    <div class="muted jn-small">Block ${sg(lo)}% → ${sg(hi)}% · ${M(net)} on ${M(acc.size, false)} (balance ${M(acc.balance, false)}). Reps, not payout dates.</div></div>`;
}

/* ------------------------------------------------------------------ the audit form (Octagon's New / Edit, for one trade) */
function jnForm(id){
  const t = JN.d.trades.find(x => x.id === id); if(!t) return;
  const o = {};
  for(const k of ["direction", "wait", "execution", "zen", "target", "regime", "notes", "review"]) o[k] = t[k] || "";
  o.bias = t.bias == null ? "" : t.bias.toFixed(2); o.ke = t.ke == null ? "" : t.ke.toFixed(2);
  o.p1Checks = [...(t.p1Checks || [])]; o.execFaults = [...(t.execFaults || [])]; o.numberRunning = !!t.numberRunning; o.payoutPressure = !!t.payoutPressure;
  o.setup = [...(t.setup || [])];
  JN.form = {id, o, t, audit: t.audit, session: JN.d.sessions[t.skey] || null, dirty: false};
  let m = jq("#jnModal");
  if(!m){ m = document.createElement("div"); m.id = "jnModal"; m.className = "jn-modal"; document.body.append(m); }
  m.classList.remove("hide");
  m.innerHTML = `<div class="jn-mbox" role="dialog" aria-label="Audit">
    <div class="jn-mhead"><b>${jEsc(jShort(t.s))} <span class="jt-side ${t.side > 0 ? "buy" : "sell"}">${t.side > 0 ? "Buy" : "Sell"} ${t.lots ?? ""}</span></b>
      <span class="muted">${t.rep ? "Rep " + t.rep + " · " : ""}${jEsc(jWhen(t.opened))} · ${jEsc(t.acct_name)} · ${t.status === "closed" ? `<span class="${t.net > 0 ? "up" : t.net < 0 ? "down" : ""}">${jMoney(t.net, true, t.cur)} ${jR(t.r)}</span>` : "open"}</span>
      <span class="sp"></span><button class="ghost" id="jnClose" aria-label="Close">✕</button></div>
    <div class="jn-mgrid">
      <div class="jn-mleft">
        <div class="jn-card"><h3>Notes</h3>
          <label>Setup tags</label>
          <div class="jn-tagbox" id="jnTagBox"><span id="jnTagChips"></span><input type="text" id="jnTagIn" autocomplete="off" placeholder="Type a tag, Enter to add"><div class="jn-tagsugg" id="jnTagSugg"></div></div>
          <div class="jn-tagquick" id="jnTagQuick"></div>
          <label for="jnNotes">Plan and reason for entry</label><textarea id="jnNotes" rows="4" placeholder="What did you see? Why here?">${jEsc(o.notes)}</textarea>
          <label for="jnReview">Review</label><textarea id="jnReview" rows="4" placeholder="What went right, what went wrong, the lesson">${jEsc(o.review)}</textarea>
        </div>
        ${typeof jsStrip === "function" ? `<div class="jn-card jn-fpics">${jsStrip(t, "form")}</div>` : ""}
      </div>
      <div class="jn-mright"><div class="jn-card">
        <div class="jn-ohead"><div id="jnFSeal"></div><div><h3 style="margin:0">Octagon audit</h3><p class="muted jn-small" id="jnFSealNote"></p></div></div>
        <div class="jn-octgrid" id="jnOct"></div>
      </div></div>
    </div>
    <div class="jn-mfoot"><span class="muted jn-small" id="jnSaveSt"></span><span class="sp"></span><button id="jnCancel">Cancel</button><button class="primary" id="jnSave">Save audit</button></div>
  </div>`;
  jq("#jnClose").onclick = jq("#jnCancel").onclick = () => jnFormClose();
  m.onclick = e => { if(e.target === m) jnFormClose(); };
  jq("#jnSave").onclick = jnFormSave;
  jq("#jnNotes").oninput = e => { o.notes = e.target.value; JN.form.dirty = true; };
  jq("#jnReview").oninput = e => { o.review = e.target.value; JN.form.dirty = true; };
  jq("#jnOct").addEventListener("click", jnOctClick);
  m.querySelector(".jn-mleft").addEventListener("click", e => { const el = e.target.closest("[data-act]"); if(el && typeof jsAct === "function") jsAct(el); });
  jq("#jnOct").addEventListener("change", e => { const f = e.target.dataset && e.target.dataset.flag; if(!f) return; o[f] = e.target.checked; JN.form.dirty = true; jnPreview(); });
  jnTagBind();
  jnOctRender();
  document.addEventListener("keydown", jnFormKey);
}
function jnFormKey(e){ if(e.key === "Escape" && JN.form && !jq("#jnTagSugg.open") && !(typeof JS !== "undefined" && JS.view)) jnFormClose(); }
function jnFormClose(force){
  if(JN.form && JN.form.dirty && !force && !confirm("Close without saving your changes?")) return;
  JN.form = null; const m = jq("#jnModal"); if(m){ m.classList.add("hide"); m.innerHTML = ""; }
  document.removeEventListener("keydown", jnFormKey);
  if(JN.stale){ JN.stale = false; jnLoad(); }
}
function jnBody(){
  const o = JN.form.o;
  return {id: JN.form.id, direction: o.direction, wait: o.wait, execution: o.execution, zen: o.zen, target: o.target, regime: o.regime,
    bias: o.bias, ke: o.ke, p1Checks: o.p1Checks, execFaults: o.execFaults, numberRunning: o.numberRunning, payoutPressure: o.payoutPressure,
    setup: o.setup, notes: o.notes, review: o.review};
}
async function jnFormSave(){
  const b = jq("#jnSave"); b.disabled = true; jq("#jnSaveSt").textContent = "Saving…";
  const pend = jq("#jnTagIn").value.trim(); if(pend) jnAddTag(pend);
  const j = await japi("/api/journal/trade", jnBody());
  b.disabled = false;
  if(!j.ok){ jq("#jnSaveSt").textContent = j.error || "Couldn't save"; jq("#jnSaveSt").className = "down jn-small"; return; }
  jnMerge(j.j); JN.form.dirty = false; jnFormClose(true); jnRender();
  jToast("Audit saved");
}
function jnSeg(key){
  const o = JN.form.o, vals = JN.d.oct[key];
  return `<div class="seg jn-seg">${vals.map(x => {
    const locked = key === "execution" && x === "Correct" && o.zen === "Compromised", lbl = (J_SEG_LABELS[key] && J_SEG_LABELS[key][x]) || x;
    const ic = (J_ICON[key] || {})[x];
    return `<button type="button" data-oct="${key}" data-v="${jEsc(x)}" class="${o[key] === x ? "on-" + J_TONE[key][x] : ""}"${locked ? ' disabled title="A Zen Temple breach makes Execution wrong"' : ""}>${ic ? ic + " " : ""}${jEsc(lbl)}</button>`;
  }).join("")}</div>`;
}
function jnTgl(kind, list, items, bad){
  return `<div class="jn-chips">${items.map(([k, l]) => `<button type="button" class="jn-tgl${list.includes(k) ? " on" + (bad ? " bad" : "") : ""}" data-${kind}="${jEsc(k)}">${list.includes(k) ? (bad ? "✗ " : "✓ ") : ""}${jEsc(l)}</button>`).join("")}</div>`;
}
function jnPBox(n, body){
  const p = jPillar(n);
  return `<div class="jn-pillar" id="jpl_${n}"><div class="jn-plh"><span class="jn-pln">${n}</span><span class="jn-plt">${jEsc(p.title)}</span><span class="jn-pls" id="jps_${n}"></span></div>
    <div class="jn-plr">${jEsc(p.rule)}</div><div class="jn-plb">${body}</div></div>`;
}
function jnOctRender(){
  const o = JN.form.o;
  jq("#jnOct").innerHTML = [
    jnPBox(1, jnSeg("direction") + `<div class="muted jn-xs">Confirmations present at the click:</div>` + jnTgl("p1", o.p1Checks, JN.d.p1)
      + `<div class="muted jn-xs" style="margin-top:4px">Market regime <span style="opacity:.7">(optional)</span></div><div class="jn-segreg">${jnSeg("regime")}</div>`
      + `<div class="jn-numpair">${J_NUM.map(({key, label}) => `<div><label class="muted jn-xs" style="margin:0 0 3px" for="jnNum_${key}">${label} <span style="opacity:.7">(optional)</span></label><div class="jn-biasrow"><button type="button" class="jn-sign" data-sign="${key}" title="Switch between positive and negative">±</button><input type="text" inputmode="decimal" autocomplete="off" id="jnNum_${key}" data-num="${key}" class="mono" placeholder="e.g. 1.25 or -0.50" value="${jEsc(o[key])}"></div></div>`).join("")}</div>
      <div class="muted jn-xs">Positive or negative, 2 decimals.</div><div class="down jn-xs" id="jnNumHint"></div>`),
    jnPBox(2, jnSeg("wait")),
    jnPBox(3, jnSeg("execution") + (o.execution === "Wrong" ? `<div class="muted jn-xs">What went wrong?</div>` + jnTgl("fault", o.execFaults, JN.d.faults, true) : "")),
    jnPBox(4, `<div class="jn-plauto" id="jauto_4"></div>`),
    jnPBox(5, `<div class="jn-plauto" id="jauto_5"></div><label class="jn-flag"><input type="checkbox" data-flag="numberRunning"${o.numberRunning ? " checked" : ""}> My mind was running numbers or chasing a round milestone</label>`),
    jnPBox(6, `<label class="jn-flag"><input type="checkbox" data-flag="payoutPressure"${o.payoutPressure ? " checked" : ""}> A payout date or balance target was on my mind (“family money”)</label><div class="jn-plauto" id="jauto_6"></div>`),
    jnPBox(7, jnSeg("zen")),
    jnPBox(8, jnSeg("target") + `<div class="jn-plauto" id="jauto_8"></div>`),
  ].join("");
  jqa("#jnOct [data-num]").forEach(i => { i.oninput = () => { o[i.dataset.num] = i.value; JN.form.dirty = true; jnNumHint(); jnPreview(); };
    i.onblur = () => { const v = jNum2(i.value); if(v != null){ i.value = v.toFixed(2); o[i.dataset.num] = i.value; } }; });
  jnOctAuto();
}
function jNum2(v){ const s = String(v ?? "").trim().replace(/[−–—]/g, "-").replace(/\s+/g, "").replace(",", "."); if(!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null; const n = Number(s); return isFinite(n) ? Math.round(n * 100) / 100 : null; }
function jnNumHint(){
  const o = JN.form.o, bad = k => { const v = String(o[k] || "").trim(); return v !== "" && v !== "-" && jNum2(v) == null; };
  jqa("#jnOct [data-num]").forEach(i => i.classList.toggle("bad", bad(i.dataset.num)));
  const w = J_NUM.filter(f => bad(f.key)).map(f => f.label), h = jq("#jnNumHint"); if(h) h.textContent = w.length ? `${w.join(" and ")}: use a number such as 1.25 or -0.50.` : "";
}
function jnOctClick(e){
  const b = e.target.closest("button"); if(!b || b.disabled) return;
  const o = JN.form.o, tog = (l, k) => l.includes(k) ? l.filter(x => x !== k) : [...l, k];
  if(b.dataset.sign){ const i = jq("#jnNum_" + b.dataset.sign), v = i.value.trim(); i.value = v.startsWith("-") || v.startsWith("−") ? v.slice(1) : v.startsWith("+") ? "-" + v.slice(1) : "-" + v; i.dispatchEvent(new Event("input")); i.focus(); return; }
  if(b.dataset.oct){ const k = b.dataset.oct, v = b.dataset.v; o[k] = o[k] === v ? "" : v;
    if(k === "zen"){ if(o.zen === "Compromised"){ o.execution = "Wrong"; if(!o.execFaults.includes("zen")) o.execFaults.push("zen"); } else o.execFaults = o.execFaults.filter(f => f !== "zen"); }
    if(k === "execution" && o.execution !== "Wrong") o.execFaults = []; }
  else if(b.dataset.p1) o.p1Checks = tog(o.p1Checks, b.dataset.p1);
  else if(b.dataset.fault){ o.execFaults = tog(o.execFaults, b.dataset.fault);
    if(b.dataset.fault === "zen") o.zen = o.execFaults.includes("zen") ? "Compromised" : (o.zen === "Compromised" ? "" : o.zen); }
  else return;
  JN.form.dirty = true;
  jnOctRender(); jnPreview();
}
function jnPreview(){
  clearTimeout(JN.pvT);
  JN.pvT = setTimeout(async () => {
    if(!JN.form) return;
    const seq = ++JN.pvSeq, j = await japi("/api/journal/audit", jnBody());
    if(!JN.form || seq !== JN.pvSeq || !j.ok) return;
    JN.form.audit = j.audit; JN.form.session = j.session; jnOctAuto();
  }, 120);
}
function jnOctAuto(){
  const F = JN.form; if(!F || !jq("#jps_1")) return;
  const a = F.audit, s = F.session, R = JN.d.rules, t = F.t, states = jStates(a);
  jq("#jnFSeal").innerHTML = jSeal(states, 104, {center: a.breaches.length ? String(a.breaches.length) : "", note: "This trade's octagon"});
  const cnt = k => states.filter(x => x === k).length;
  jq("#jnFSealNote").textContent = a.clean ? "Clean octagon — every pillar held." : `${cnt("pass")} held${cnt("fail") ? ` · ${cnt("fail")} broken` : ""}${cnt("warn") ? ` · ${cnt("warn")} to check` : ""}${cnt("off") ? ` · ${cnt("off")} not applicable` : ""}${cnt("na") ? ` · ${cnt("na")} still to record` : ""}. Pillars 4 and 5 are checked from your session.`;
  for(let n = 1; n <= 8; n++){ const st = a.P["p" + n].state; jq("#jps_" + n).innerHTML = `<span class="jb jb-${J_STATE_TONE[st]}">${({pass: "✓ held", fail: "✗ broken", warn: "⚠ check", na: "—", off: "doesn't apply"})[st]}</span>`; }
  const bad = x => `<span class="down">⛔ ${jEsc(x)}</span>`;
  jq("#jauto_4").innerHTML = !s ? `<span class="muted">Checked against the session.</span>` : a.P.p4.state === "fail" ? bad(a.P.p4.note)
    : `<span class="up">Held.</span> <span class="muted">Session ${jEsc(jFmtDay(s.day))}: peak ${jMoney(s.peak, true, s.cur)}, ${jMoney(s.dd, false, s.cur)} off peak of ${jMoney(s.limit, false, s.cur)} allowed (${R.dd_pct}% of ${jMoney(s.base, false, s.cur)}${(s.cur || "INR") !== "INR" ? ", FundingPips' day-start balance" : ""}).</span>`;
  jq("#jauto_5").innerHTML = !s ? `<span class="muted">Checked against the session.</span>` : a.P.p5.state === "fail" ? bad(a.P.p5.note)
    : a.P.p5.state === "off" ? `<span class="muted">Doesn't apply yet — no wins in this session, so there's no run to protect. It starts counting from your first win.</span>`
    : `<span class="up">Held.</span> <span class="muted">Session now: win streak ${s.streak}/${R.win_streak}, wins ≥${R.multi_r}R ${s.multi}/${R.win_streak}.</span>`;
  const acc = JN.d.accounts.find(x => x.id === t.acct);
  if(acc && acc.size && acc.balance != null){ const pct = (acc.balance - acc.size) / acc.size * 100, lo = Math.floor(pct / R.block_pct + 1e-9) * R.block_pct;
    jq("#jauto_6").innerHTML = `<span class="muted">${jEsc(acc.name)}: ${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}% · working the ${lo}% → ${lo + R.block_pct}% block. Reps, not payout dates.</span>`; }
  else jq("#jauto_6").innerHTML = "";
  const closed = t.status === "closed", optional = !(closed && t.net != null && t.net >= 0);
  jq("#jauto_8").innerHTML = (a.P.p8.state === "warn" ? `<span class="warnc">⚠ ${jEsc(a.P.p8.note)}</span> ` : t.planned_r != null ? `<span class="muted">T/P sits at ${t.planned_r.toFixed(2)}R (net).</span> ` : "")
    + (optional ? `<span class="muted">${closed ? "Optional on a losing trade" : "Optional while the trade is open"} — mark Stretched only if it was in profit and you let it run back.</span>` : "");
}
/* setup tags: chips with suggestions from the tags you've used */
function jnTagRender(){
  const o = JN.form.o, lower = new Set(o.setup.map(x => x.toLowerCase()));
  jq("#jnTagChips").innerHTML = o.setup.map((g, i) => `<span class="jn-tagchip">${jEsc(g)}<button type="button" data-rm="${i}" aria-label="Remove ${jEsc(g)}">×</button></span>`).join("");
  jq("#jnTagChips").querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { o.setup.splice(Number(b.dataset.rm), 1); JN.form.dirty = true; jnTagRender(); jq("#jnTagIn").focus(); });
  const quick = jTags().filter(x => !lower.has(x.name.toLowerCase())).slice(0, 10);
  jq("#jnTagQuick").innerHTML = quick.length ? `<span class="muted">Your tags:</span>${quick.map(x => `<button type="button" class="jn-qt" data-t="${jEsc(x.name)}">+ ${jEsc(x.name)}</button>`).join("")}` : "";
  jq("#jnTagQuick").querySelectorAll("[data-t]").forEach(b => b.onclick = () => jnAddTag(b.dataset.t));
  jq("#jnTagIn").placeholder = o.setup.length ? "Add another…" : "Type a tag, Enter to add";
}
function jnAddTag(name){
  const t = String(name || "").replace(/,+$/, "").trim().slice(0, 40), o = JN.form.o;
  if(t && !o.setup.some(x => x.toLowerCase() === t.toLowerCase())){ o.setup.push(t); JN.form.dirty = true; }
  jq("#jnTagIn").value = ""; jnTagSugg(false); jnTagRender();
}
function jnTagSugg(open = true){
  const box = jq("#jnTagSugg"), inp = jq("#jnTagIn"), q = inp.value.replace(/,+$/, "").trim().toLowerCase(), sel = new Set(JN.form.o.setup.map(x => x.toLowerCase()));
  const list = open ? jTags().filter(x => !sel.has(x.name.toLowerCase()) && (!q || x.name.toLowerCase().includes(q))).slice(0, 8) : [];
  const exact = list.some(x => x.name.toLowerCase() === q) || sel.has(q);
  const opts = [...list.map(x => ({name: x.name, hint: `${x.n} trade${x.n === 1 ? "" : "s"}`})), ...(open && q && !exact ? [{name: inp.value.replace(/,+$/, "").trim(), hint: "new tag", isNew: true}] : [])];
  JN.tagA = Math.min(JN.tagA ?? -1, opts.length - 1);
  box.innerHTML = opts.map((o, i) => `<button type="button" class="${i === JN.tagA ? "on" : ""}" data-t="${jEsc(o.name)}">${o.isNew ? "Add “" + jEsc(o.name) + "”" : jEsc(o.name)}<small>${jEsc(o.hint)}</small></button>`).join("");
  box.querySelectorAll("button").forEach(b => b.onmousedown = e => { e.preventDefault(); jnAddTag(b.dataset.t); });
  box.classList.toggle("open", opts.length > 0);
}
function jnTagBind(){
  const inp = jq("#jnTagIn");
  jq("#jnTagBox").onclick = e => { if(e.target.id === "jnTagBox") inp.focus(); };
  inp.addEventListener("input", () => { if(inp.value.includes(",")){ inp.value.split(",").slice(0, -1).forEach(jnAddTag); inp.value = inp.value.split(",").pop(); } JN.tagA = -1; jnTagSugg(); });
  inp.addEventListener("focus", () => jnTagSugg());
  inp.addEventListener("blur", () => { if(inp.value.trim()) jnAddTag(inp.value); setTimeout(() => jnTagSugg(false), 120); });
  inp.addEventListener("keydown", e => {
    const opts = [...jq("#jnTagSugg").querySelectorAll("button")];
    if(e.key === "ArrowDown" || e.key === "ArrowUp"){ e.preventDefault(); if(!opts.length) return; JN.tagA = ((JN.tagA ?? -1) + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length; jnTagSugg(); return; }
    if(e.key === "Enter" || (e.key === "Tab" && inp.value.trim())){ e.preventDefault(); if(JN.tagA >= 0 && opts[JN.tagA]) jnAddTag(opts[JN.tagA].dataset.t); else jnAddTag(inp.value); JN.tagA = -1; return; }
    if(e.key === "Backspace" && !inp.value && JN.form.o.setup.length){ JN.form.o.setup.pop(); jnTagRender(); return; }
    if(e.key === "Escape" && jq("#jnTagSugg").classList.contains("open")){ e.preventDefault(); e.stopPropagation(); jnTagSugg(false); }
  });
  jnTagRender();
}

/* ------------------------------------------------------------------ Settings: Octagon rules, lockout switches, the pillars' text */
function jnSettings(){
  const body = jq("#jnBody"), R = JN.d.rules, mts = (JN.d.accounts || []).filter(a => a.mode === "mt5" && a.mt5);
  const num = (k, label, step, hint) => `<div><label for="jr_${k}">${label}</label><input type="number" step="${step}" min="0" id="jr_${k}" data-rule="${k}" class="mono" value="${R[k]}">${hint ? `<div class="muted jn-xs">${hint}</div>` : ""}</div>`;
  const sw = (k, label, hint) => `<label class="jn-sw"><input type="checkbox" data-rule="${k}"${R[k] ? " checked" : ""}><span><b>${label}</b><br><span class="muted jn-small">${hint}</span></span></label>`;
  body.innerHTML = `<div class="jn-setgrid">
    <div class="jn-card"><h3>Octagon rules</h3>
      <div class="jn-row">${num("dd_pct", "Trailing drawdown %", "0.1", "of the account size (MT5: FundingPips' day-start balance), from the session's peak (Pillar 4)")}${num("afk_min", "Break minutes", "1", "after the 99 Club (Pillar 5)")}${num("win_streak", "Wins before a break", "1")}</div>
      <div class="jn-row">${num("multi_r", "Multi-R win from (net R)", "0.1")}${num("stretch_r", "Flag target above (net R)", "0.1", "Pillar 8")}${num("block_pct", "Execution block %", "0.5", "Pillar 6")}</div>
      <div class="jn-row">${num("rep_block", "Rep milestone every", "1")}${num("reps_before", "Reps done before this journal", "1")}</div>
      <p class="muted jn-small">Every closed trade is one rep, counted across all your accounts in the order you took them. A session is one trading day per account (IST; the day starts at the reset hour in your account's rules, 06:00 by default; MT5 accounts: the broker's day or the Indian day, below). R and money are net of every charge, so a "2R win" is 2R after charges.</p>
      <div class="jn-sst" id="jnRulesSt"></div>
    </div>
    <div class="jn-card"><h3>Lockouts refuse new orders</h3>
      ${sw("block_dd", "After the trailing-drawdown lockout (Pillar 4)", `Closed trades of the day ${R.dd_pct}% of the account size below the session's peak: no new orders until the next trading day.`)}
      ${sw("block_afk", "During the 99 Club break (Pillar 5)", `${R.win_streak} wins in a row, or ${R.win_streak} wins of ${R.multi_r}R or more: no new orders for ${R.afk_min} minutes.`)}
      ${sw("block_end", "After the session ends (Pillar 5)", "A trade marked \"mind running numbers\", or Hold to end today's session on the Today card: no new orders until the next trading day.")}
      ${sw("cancel_pending", "Cancel waiting entry orders when a lockout starts", "Limit and stop entries still waiting at that moment are cancelled (Live: at Fyers too). Stops and targets of open trades stay.")}
      <p class="muted jn-small">Closing, trailing, BE and the stops of open trades are never blocked. Each switch applies to all your accounts${mts.length ? " (MT5 accounts only with their own switch on, below)" : ""}. Off = the lockout still shows on the Today card and in the audit.</p>
    </div>
    ${mts.length ? `<div class="jn-card" id="jnMt5Set"><h3>MT5 accounts</h3>
      ${mts.map(a => `<div class="jn-mt5row" data-acct="${jEsc(a.id)}"><div class="jn-mt5name"><b>MT5 ${jEsc(a.name)}</b> <span class="muted">${jEsc(a.server || "")} · ${jEsc(a.cur || "USD")}</span></div>
        <label>Session day</label><select data-mtday><option value="broker"${a.mt5.day === "broker" ? " selected" : ""}>The broker's day (FundingPips' daily reset)</option><option value="ist"${a.mt5.day === "ist" ? " selected" : ""}>The Indian day (IST, from 06:00)</option></select>
        <label class="jn-sw"><input type="checkbox" data-mtblock${a.mt5.block ? " checked" : ""}><span><b>Lockouts refuse new orders on this account</b><br><span class="muted jn-small">The 2% line, the 99 Club break and session over, each with its switch above. Changing this asks for a fresh 2FA code. Off: shown on the Today card and in the audit only.</span></span></label></div>`).join("")}
      <p class="muted jn-small">Money in the account's currency ($), net of commission and swap; never added to ₹ (pick ₹ or $ in the filters). The 2% line is of FundingPips' day-start balance: the balance at the broker's midnight, from MT5's own deals.</p>
      <div class="jn-sst" id="jnMt5St"></div></div>` : ""}
    <div class="jn-card jn-wide"><h3>The 8 pillars</h3>
      <p class="muted jn-small">Your text, word for word. Edit any pillar; "Original" puts your original text back.</p>
      <div id="jnPilEd">${jPillars().map(p => `<div class="jn-pled" data-n="${p.n}"><div class="jn-row"><div style="flex:3"><label>${p.n} · Title</label><input type="text" data-k="title" value="${jEsc(p.title)}"></div><div><label>Short name</label><input type="text" data-k="short" value="${jEsc(p.short)}"></div></div>
        <label>Rule</label><textarea rows="2" data-k="rule">${jEsc(p.rule)}</textarea>
        <div class="jn-pledb"><button data-save="${p.n}">Save pillar ${p.n}</button>${p.edited ? `<button class="ghost" data-orig="${p.n}">Original</button><span class="muted jn-xs">edited</span>` : ""}</div></div>`).join("")}</div>
      <h3 style="margin-top:18px">Pillar 1 checks</h3>
      <div id="jnP1Ed">${(JN.d.p1 || []).map(([k, l]) => `<div class="jn-p1row" data-k="${jEsc(k)}"><input type="text" value="${jEsc(l)}"><button class="ghost" data-rm="1" title="Remove">✕</button></div>`).join("")}</div>
      <div class="jn-pledb"><button id="jnP1Add">Add a check</button><button id="jnP1Save" class="primary">Save checks</button><button class="ghost" id="jnP1Orig">Original</button></div>
    </div>
  </div>`;
  const save = async (b, st) => { const j = await japi("/api/journal/settings", b); if(j.ok){ jnMerge(j.j); jToast("Saved"); jnSettings(); } else { jToast(j.error || "Couldn't save"); if(st) st.textContent = j.error || ""; } };
  body.querySelectorAll("input[data-rule]").forEach(i => i.onchange = () => save({rules: {[i.dataset.rule]: i.type === "checkbox" ? i.checked : i.value}}, jq("#jnRulesSt")));
  body.querySelectorAll("[data-save]").forEach(b => b.onclick = () => { const box = b.closest(".jn-pled"), o = {};
    box.querySelectorAll("[data-k]").forEach(i => o[i.dataset.k] = i.value); save({pillars: {[box.dataset.n]: o}}); });
  body.querySelectorAll("[data-orig]").forEach(b => b.onclick = () => save({pillars: {[b.dataset.orig]: null}}));
  const p1rows = () => [...body.querySelectorAll(".jn-p1row")].map(r => [r.dataset.k || "", r.querySelector("input").value]);
  body.querySelectorAll(".jn-p1row [data-rm]").forEach(b => b.onclick = () => b.closest(".jn-p1row").remove());
  jq("#jnP1Add").onclick = () => { const d = document.createElement("div"); d.className = "jn-p1row"; d.dataset.k = ""; d.innerHTML = `<input type="text" placeholder="e.g. VWAP on my side"><button class="ghost" data-rm="1">✕</button>`;
    d.querySelector("[data-rm]").onclick = () => d.remove(); jq("#jnP1Ed").append(d); d.querySelector("input").focus(); };
  jq("#jnP1Save").onclick = () => save({p1: p1rows()});
  jq("#jnP1Orig").onclick = () => save({p1: null});
  const mtSave = async (b, two) => { const st = jq("#jnMt5St");
    const j = two && typeof stepUp === "function" ? await stepUp(() => api("/api/journal/mt5", {body: b})) : await japi("/api/journal/mt5", b);
    if(j && j.ok){ jnMerge(j.j); jToast("Saved"); } else if(j && j.error && j.error !== "cancelled"){ jToast(j.error); if(st) st.textContent = j.error; }
    jnSettings(); };
  body.querySelectorAll(".jn-mt5row").forEach(r => {
    r.querySelector("[data-mtday]").onchange = e => mtSave({acct: r.dataset.acct, day: e.target.value});
    r.querySelector("[data-mtblock]").onchange = e => mtSave({acct: r.dataset.acct, block: e.target.checked}, true);
  });
}

/* ------------------------------------------------------------------ the lock on the ticket and in the header */
function jnLockPill(){
  let el = jq("#pJLock");
  const lk = typeof P !== "undefined" && P.snap ? P.snap.jlock : null;
  if(!el){ const hdr = jq("header .spacer"); if(!hdr) return; el = document.createElement("span"); el.id = "pJLock"; el.className = "pill jn-lockpill hide";
    el.title = "Your journal's lockout (Journal › Settings)"; el.onclick = () => pgShow("journal"); hdr.before(el); }
  if(!lk){ el.classList.add("hide"); return; }
  el.classList.remove("hide");
  el.classList.toggle("off", !lk.on);
  const what = lk.kind === "afk" ? `99 Club break until ${jHM(lk.until)}` : lk.kind === "dd" ? "2% lockout" : "Session over";
  el.title = `Your journal: ${what}` + (lk.on ? " - new orders refused (Journal › Settings)" : lk.mt5_off
    ? " - not blocking: lockouts are off for this MT5 account (Journal › Settings)" : " - not blocking: its switch is off (Journal › Settings)");
  const brief = lk.kind === "afk" ? "99 Club" : lk.kind === "dd" ? "2%" : "Ended";       // (not blocking: shortest, the tip says it all)
  el.innerHTML = `<span class="dot ${lk.on ? "bad" : "warn"}"></span><span>${lk.on ? what : brief + '<small class="jn-nb"> · off</small>'}</span>`;   // (the top bar stays on one line)
}

/* ------------------------------------------------------------------ hooks into the page */
(function jnHook(){
  if(typeof PAGES !== "undefined" && !PAGES.includes("journal")) PAGES.splice(PAGES.indexOf("history") + 1, 0, "journal");
  const ps = pgShow;
  pgShow = function(name, fromHash){ ps(name, fromHash); if(name === "journal") jnShow(); else if(JN.form) jnFormClose(true); };
  const pu = paperUpdate;
  paperUpdate = function(s, events){ pu(s, events); jnLockPill(); if(events && events.length && PG.page === "journal" && !JN.form) jnPush(); else if(events && events.length) JN.stale = true; };
  document.addEventListener("DOMContentLoaded", () => {
    if(typeof mMore === "function"){            // the phone's More tab gets a Journal row
      const mm = mMore;
      window.mMore = mMore = function(){ mm(); const l = document.querySelector("#ms_more .mlist"); if(l && !l.querySelector('[data-pg="journal"]')){
        const b = document.createElement("button"); b.dataset.pg = "journal"; b.innerHTML = "<span>Journal<br><small>the octagon audit, reps, today's lockouts</small></span>›"; b.onclick = () => pgShow("journal"); l.prepend(b); } };
    }
  });
})();
