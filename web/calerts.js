/* Alerts like TradingView's (v0.38.0, roadmap 21): the create / edit dialog (Alt+A, 🔔 on the chart, right-click on the
   chart, a drawing's menu, an indicator's row in ƒx), the Alerts page (the list, the log, phone notifications), pop-ups
   with a sound when one fires, and 🔔 lines on the chart for price levels (drag one to move the alert).

   The alerts themselves run on the server (helper/chartalerts.py), page open or not. This file only sets them up and shows
   what fired. A condition's source here is a key ("price:last", "bar:close", "pine:<chart indicator id>:plot:<title>",
   "draw:<id>:<edge>", "ind:<built-in>:<output>", "pf:<signal>", "saved:<n>") turned into the server's form on save.
   Loaded after the page's script, pine.js, paper.js, pages.js, draw.js / drawui.js and before mobile.js. */
"use strict";
const CA = {list: [], meta: null, push: null, tg: null, log: [], loaded: false, tab: "list", q: "", f: "all", lines: [], lineKey: "",
  audio: null, dlg: null, swReg: null};
const caq = s => document.querySelector(s);
const caqa = (el, s) => [...el.querySelectorAll(s)];
const CA_FREQ = [["once", "Only once"], ["bar", "Once per bar"], ["close", "Once per bar close"], ["minute", "Once per minute"]];
const CA_TWO = ["cross", "cross_up", "cross_dn", "gt", "lt"], CA_CHAN = ["enter", "exit", "inside", "outside"], CA_MOVE = ["up", "down", "up_pct", "down_pct"];
const CA_OPS = {cross: "Crossing", cross_up: "Crossing up", cross_dn: "Crossing down", gt: "Greater than", lt: "Less than",
  enter: "Entering channel", exit: "Exiting channel", inside: "Inside channel", outside: "Outside channel",
  up: "Moving up", down: "Moving down", up_pct: "Moving up %", down_pct: "Moving down %", true: "Is true"};
const CA_SOUND = {chime: [[880, 0, .18], [1320, .12, .3]], bell: [[660, 0, .7], [990, 0, .45]], beep: [[1000, 0, .12], [1000, .2, .12]],
  alarm: [[880, 0, .15], [660, .17, .15], [880, .34, .15], [660, .51, .15]], soft: [[523, 0, .35]], none: []};
const CA_PH = ["{{ticker}}", "{{exchange}}", "{{close}}", "{{open}}", "{{high}}", "{{low}}", "{{volume}}", "{{bid}}", "{{ask}}", "{{interval}}",
  "{{time}}", "{{timenow}}", "{{timenow_ist}}", "{{plot_0}}", '{{plot("Name")}}', "{{name}}"];
const CA_DRAW = ["hline", "hray", "trend", "ray", "extl", "channel", "rect"];
const CA_BARS = [["open", "Open"], ["high", "High"], ["low", "Low"], ["close", "Close"], ["hl2", "(H+L)/2"], ["hlc3", "(H+L+C)/3"], ["ohlc4", "(O+H+L+C)/4"], ["volume", "Volume"]];

/* ---------------------------------------------------------------- the server */
async function caLoad(){
  const j = await api("/api/alerts");
  if(!j.ok) return;
  CA.list = j.alerts || []; CA.meta = j; CA.push = j.push; CA.tg = j.tg; CA.loaded = true;
  caBadge(); caLines(true);
  if(typeof PG !== "undefined" && PG.page === "alerts") caRender();
}
async function caLogLoad(){ const j = await api("/api/alerts/log?n=500"); if(j.ok) CA.log = j.log || []; }
async function caAct(ids, what){
  const j = await api("/api/alerts/action", {body: {ids: [].concat(ids), do: what}});
  if(!j.ok){ toast(j.error || "Didn't work"); return false; }
  await caLoad(); return true;
}
function caBadge(){
  const n = CA.list.filter(a => a.status === "active").length, b = caq("#nbAlerts");
  if(b){ b.textContent = n; b.classList.toggle("hide", !n); }
}

/* ---------------------------------------------------------------- what fired: pop-up, sound, log */
function caPlay(name){
  const notes = CA_SOUND[name] || CA_SOUND.chime; if(!notes.length) return;
  try{
    const ctx = CA.audio || (CA.audio = new (window.AudioContext || window.webkitAudioContext)());
    if(ctx.state === "suspended") ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    for(const [f, t, d] of notes){
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + t); g.gain.exponentialRampToValueAtTime(0.22, t0 + t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + t + d);
      o.connect(g).connect(ctx.destination); o.start(t0 + t); o.stop(t0 + t + d + 0.05);
    }
  }catch(e){}
}
// browsers only play sound after you've touched the page once
document.addEventListener("pointerdown", () => { try{ if(!CA.audio) CA.audio = new (window.AudioContext || window.webkitAudioContext)(); if(CA.audio.state === "suspended") CA.audio.resume(); }catch(e){} }, {capture: true});

function caWhen(t){ return new Date(t * 1000).toLocaleTimeString("en-GB", {timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit"}); }
const CA_CELL = window.FTM_CELL != null;          // a chart inside a multi-chart grid: the page around it shows the pop-up
function caFired(e){
  CA.log.unshift(e); if(CA.log.length > 500) CA.log.length = 500;
  const a = CA.list.find(x => x.id === e.aid);
  if(a){ a.fired = (a.fired || 0) + 1; a.last = Math.round(e.t); }
  if(CA_CELL){ if(a && a.freq === "once" && !(a.target || {}).wl) setTimeout(caLoad, 300); return; }
  if(e.sound !== "none") caPlay(e.sound);
  if(e.popup !== false) caPopup(e);
  if(typeof PG !== "undefined" && PG.page === "alerts") caRender();
  if(a && a.freq === "once" && !(a.target || {}).wl) setTimeout(caLoad, 300);      // now "triggered"
}
function caPopup(e){
  let box = caq("#caPops");
  if(!box){ box = document.createElement("div"); box.id = "caPops"; document.body.append(box); }
  const el = document.createElement("div"); el.className = "capop";
  el.innerHTML = `<div class="cph"><span class="bell">🔔</span><b>${esc(e.name)}</b><span class="sp"></span><button class="ghost" data-x title="Close">✕</button></div>
    <div class="cpm">${esc(e.msg)}</div>
    <div class="cpf muted">${esc(symLabel(e.s))} · ${esc(e.tf || "")}${e.px != null ? " · " + esc(fmt(e.px, (sym[e.s] || {}).tick)) : ""} · ${caWhen(e.t)}
      <span class="sp"></span><button class="ghost" data-c>Chart</button><button class="ghost" data-l>Log</button></div>`;
  el.querySelector("[data-x]").onclick = () => el.remove();
  el.querySelector("[data-c]").onclick = () => { el.remove(); caOpenChart(e.s); };
  el.querySelector("[data-l]").onclick = () => { el.remove(); CA.tab = "log"; pgShow("alerts"); };
  box.prepend(el);
  while(box.children.length > 6) box.lastChild.remove();
}
async function caOpenChart(s){
  if(typeof pgShow === "function") pgShow("chart");
  if(typeof M !== "undefined" && M.on && typeof mShow === "function") mShow("chart");
  if(cur && cur.s === s) return;
  let r = sym[s];
  if(!r){ const j = await api("/api/symbol?s=" + encodeURIComponent(s)); if(j.ok) r = j.row; }
  if(r) openSymbol(r);
}

/* the live socket: "calert" (an alert fired) and "calerts_changed" (expired...) */
function caWsHook(){
  if(typeof ws === "undefined" || !ws || ws._ca) return;
  const om = ws.onmessage;
  ws.onmessage = ev => {
    om(ev);
    if(typeof ev.data === "string" && ev.data.indexOf('"calert') >= 0){
      try{ const m = JSON.parse(ev.data); if(m.calert) caFired(m.calert); if(m.calerts_changed) caLoad(); }catch(e){}
    }
  };
  ws._ca = 1;
}
(function(){
  const cw = connectWS;
  connectWS = function(){ cw(); caWsHook(); };
  caWsHook();
})();

/* ---------------------------------------------------------------- sources for the dialog */
/* a script's alertcondition() calls: their titles and messages (arguments split at the top level, strings kept whole) */
function caCalls(src, fn){
  const out = [], re = new RegExp("\\b" + fn + "\\s*\\(", "g"); let m;
  src = String(src || "").replace(/\/\/.*$/gm, "");
  while((m = re.exec(src))){
    const args = []; let i = re.lastIndex, depth = 0, q = null, curA = "";
    for(; i < src.length; i++){
      const ch = src[i];
      if(q){ curA += ch; if(ch === "\\"){ curA += src[++i] || ""; continue; } if(ch === q) q = null; continue; }
      if(ch === '"' || ch === "'"){ q = ch; curA += ch; continue; }
      if(ch === "(" || ch === "[") depth++;
      if(ch === ")" || ch === "]"){ if(!depth){ args.push(curA.trim()); break; } depth--; }
      if(ch === "," && !depth){ args.push(curA.trim()); curA = ""; continue; }
      curA += ch;
    }
    out.push(args);
  }
  return out;
}
function caAcTitles(src){
  const str = a => { const m = /^(?:\w+\s*=\s*)?(["'])([\s\S]*)\1$/.exec(a || ""); return m ? m[2] : null; };
  const named = (args, k) => { const a = args.find(x => new RegExp("^" + k + "\\s*=").test(x)); return a ? str(a) : null; };
  return caCalls(src, "alertcondition").map(args => {
    const pos = args.filter(a => !/^\w+\s*=/.test(a));
    const title = named(args, "title") ?? str(pos[1]), msg = named(args, "message") ?? str(pos[2]);
    return title ? {title, msg: msg || ""} : null;
  }).filter(Boolean);
}
function caIndName(t){ const m = (CA.meta && CA.meta.ind || {})[t]; return m ? m.name : t; }
/* every source the dialog offers, for the chart that's open (or none: another symbol / a watchlist) */
function caCatalog(onChart, saved){
  const items = [], add = (key, label, group, kind, extra) => items.push({key, label, group, kind: kind || "num", ...(extra || {})});
  add("price:last", "Price", "Price"); add("price:bid", "Bid", "Price"); add("price:ask", "Ask", "Price");
  for(const [f, n] of CA_BARS) add("bar:" + f, n, "Candles");
  if(onChart && typeof INDS !== "undefined"){
    for(const r of INDS){
      const c = r.cfg;
      if(c.type === "volume"){ add("ind:vma:Volume MA", `Volume MA (${c.maLen || 20})`, "On this chart", "num", {ind: "vma", p: {len: c.maLen || 20}}); continue; }
      if(c.type !== "pine") continue;
      const sc = typeof pineScript === "function" ? pineScript(c.scriptId) : null; if(!sc) continue;
      const name = (r.pine && r.pine.title) || sc.name;
      const titles = Object.keys((r.pine && r.pine.res && r.pine.res.plots) || {}).filter(k => !/^__/.test(k));
      for(const t of titles) add(`pine:${c.id}:plot:${t}`, `${name}: ${t}`, "On this chart", "num", {r});
      for(const ac of caAcTitles(sc.source)) add(`pine:${c.id}:ac:${ac.title}`, `${name}: ${ac.title}`, "On this chart", "bool", {r, acMsg: ac.msg});
      if(/\balert\s*\(/.test(sc.source)) add(`pine:${c.id}:any`, `${name}: any alert() call`, "On this chart", "bool", {r});
    }
  }
  if(onChart && typeof DR !== "undefined" && DR.s === (cur && cur.s)){
    for(const d of DR.items || []){
      if(!CA_DRAW.includes(d.type)) continue;
      const nm = ((typeof DT !== "undefined" && DT[d.type]) || {}).name || d.type, lb = nm + (d.text ? ` “${d.text.slice(0, 20)}”` : "");
      if(d.type === "channel" || d.type === "rect"){
        add(`draw:${d.id}:upper`, `${lb}: top`, "Drawings", "draw", {name: lb}); add(`draw:${d.id}:lower`, `${lb}: bottom`, "Drawings", "draw", {name: lb});
        if(d.type === "channel") add(`draw:${d.id}:mid`, `${lb}: middle`, "Drawings", "draw", {name: lb});
      } else add(`draw:${d.id}:v`, lb + (d.type === "hline" || d.type === "hray" ? ` at ${fmt(d.pts[0].p, cur.tick)}` : ""), "Drawings", "draw", {name: lb});
    }
  }
  for(const [t, m] of Object.entries((CA.meta && CA.meta.ind) || {}))
    for(const o of m.outs) add(`ind:${t}:${o}`, m.outs.length > 1 ? `${m.name}: ${o}` : m.name, "Built-in indicators", "num", {ind: t});
  if(onChart && typeof ctType === "function" && ctType() === "pf")
    for(const [s, n] of [["buy", "Buy signal (DTB / TTB)"], ["sell", "Sell signal (DBS / TBS)"], ["DTB", "Double top buy"], ["TTB", "Triple top buy"], ["DBS", "Double bottom sell"], ["TBS", "Triple bottom sell"]])
      add("pf:" + s, n, "P&F signals", "bool");
  (saved || []).forEach((s, i) => add("saved:" + i, caSrcLabel(s) + " (as saved)", "This alert", s.k === "pine" && (s.ac || s.any) || s.k === "pf" ? "bool" : s.k === "draw" ? "draw" : "num", {saved: s}));
  return items;
}
function caSrcLabel(s){
  if(!s) return "";
  if(s.k === "value") return fmt(s.v);
  if(s.k === "price") return {last: "Price", bid: "Bid", ask: "Ask"}[s.f] || "Price";
  if(s.k === "bar") return (CA_BARS.find(x => x[0] === s.f) || [0, s.f])[1];
  if(s.k === "pine") return `${s.name}: ${s.plot || s.ac || "any alert() call"}`;
  if(s.k === "ind") return caIndName(s.t) + (s.p && Object.keys(s.p).length ? ` (${Object.values(s.p).join(", ")})` : "") + ((CA.meta && CA.meta.ind[s.t] || {outs: [1]}).outs.length > 1 ? ": " + s.out : "");
  if(s.k === "draw") return s.name + (s.edge && s.edge !== "v" ? ` (${s.edge})` : "");
  if(s.k === "pf") return "P&F " + s.sig;
  return "?";
}

/* ---------------------------------------------------------------- the dialog */
function caTfs(){
  const have = typeof tfFav !== "undefined" ? tfFav : [], all = typeof TF_ALL !== "undefined" ? TF_ALL : ["1m", "5m", "15m", "1h", "1D"];
  return [...new Set([typeof tf !== "undefined" ? tf : "5m", ...have, ...all])];
}
function caDefNotify(){ return {popup: true, sound: "chime", push: true, tg: false, webhook: "", ...(prefGet("caNotify", {}) || {})}; }
/* the dialog's own record of a slot (a / b / lo / hi): {key, p (built-in's settings), v (a number)} */
function caSlotFromSrc(s, cat, saved){
  if(!s) return {key: "value", v: ""};
  if(s.k === "value") return {key: "value", v: s.v};
  if(s.k === "price") return {key: "price:" + s.f};
  if(s.k === "bar") return {key: "bar:" + s.f};
  if(s.k === "ind") return {key: `ind:${s.t}:${s.out}`, p: {...(s.p || {})}};
  if(s.k === "pf") return {key: "pf:" + s.sig};
  if(s.k === "draw"){ const k = `draw:${s.id}:${s.edge}`; if(cat.some(i => i.key === k)) return {key: k}; }
  if(s.k === "pine"){                           // the same script with the same inputs on the chart: offer it live
    const hit = cat.find(i => i.r && i.r.cfg.scriptId === s.sid && JSON.stringify(i.r.cfg.inputs || {}) === JSON.stringify(s.inputs || {})
      && i.key.endsWith(s.plot ? ":plot:" + s.plot : s.ac ? ":ac:" + s.ac : ":any"));
    if(hit) return {key: hit.key};
  }
  const i = saved.indexOf(s); return {key: "saved:" + (i >= 0 ? i : 0)};
}
async function caDialog(opt){
  opt = opt || {};
  if(!CA.loaded) await caLoad();
  if(!CA.loaded){ toast("Alerts didn't load: try again"); return; }
  const edit = opt.alert || null, onChart = !!cur && (!edit || (edit.target || {}).s === cur.s);
  const saved = [];
  if(edit) for(const c of edit.conds) for(const k of ["a", "b", "lo", "hi"]) if(c[k] && !["value"].includes(c[k].k)) saved.push(c[k]);
  const cat = caCatalog(onChart, saved.filter(s => ["pine", "draw"].includes(s.k)));
  const wls = typeof WL !== "undefined" ? WL : [];
  const ctT = typeof ctType === "function" ? ctType() : "candles";
  const st = {                                  // the dialog's state
    target: edit ? {...edit.target} : opt.target || {s: cur ? cur.s : ""},
    conds: [], join: edit ? edit.join : "all", freq: edit ? edit.freq : opt.freq || "once", exp: edit ? edit.exp || 0 : 0,
    name: edit ? edit.name : "", msg: edit ? edit.msg || "" : opt.msg || "", notify: edit ? {...caDefNotify(), ...edit.notify} : caDefNotify(),
    useCt: edit ? (edit.ctype || {}).type !== "candles" : ctT !== "candles", ctype: edit ? edit.ctype : null,
  };
  const savedPf = saved.filter(s => ["pine", "draw"].includes(s.k));
  if(edit) st.conds = edit.conds.map(c => ({op: c.op, tf: c.tf, amt: c.amt, bars: c.bars, a: caSlotFromSrc(c.a, cat, savedPf), b: caSlotFromSrc(c.b, cat, savedPf),
    lo: caSlotFromSrc(c.lo, cat, savedPf), hi: caSlotFromSrc(c.hi, cat, savedPf)}));
  else st.conds = (opt.conds && opt.conds.length ? opt.conds : [{a: {key: "price:last"}, op: "cross", b: {key: "value", v: caNow()}}])
    .map(c => ({tf: typeof tf !== "undefined" ? tf : "5m", amt: 1, bars: 1, b: {key: "value", v: caNow()}, lo: {key: "value", v: ""}, hi: {key: "value", v: ""}, ...c}));
  let m = caq("#caDlg");
  if(!m){ m = document.createElement("div"); m.id = "caDlg"; document.body.append(m); }
  m.className = "modalwrap";
  CA.dlg = {st, cat, edit, onChart, m};
  const kindOf = key => (cat.find(i => i.key === key) || {}).kind || "num";
  const optList = (sel, filter, withValue) => {
    const groups = {};
    for(const i of cat) if(!filter || filter(i)) (groups[i.group] = groups[i.group] || []).push(i);
    return (withValue ? `<option value="value"${sel === "value" ? " selected" : ""}>Value</option>` : "")
      + Object.entries(groups).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map(i => `<option value="${esc(i.key)}"${i.key === sel ? " selected" : ""}>${esc(i.label)}</option>`).join("")}</optgroup>`).join("");
  };
  const params = (slot, role, ci) => {
    const it = cat.find(i => i.key === slot.key); if(!it || !it.ind) return "";
    const meta = CA.meta.ind[it.ind]; if(!meta || !meta.params.length) return "";
    slot.p = slot.p || {};
    return `<div class="caparams">${meta.params.map(([k, label, dflt]) => {
      const v = slot.p[k] != null ? slot.p[k] : dflt;
      return k === "src" ? `<label class="cap"><span>${esc(label)}</span><select data-p="${k}" data-role="${role}" data-ci="${ci}">${["close", "open", "high", "low", "hl2", "hlc3", "ohlc4"].map(o => `<option${o === v ? " selected" : ""}>${o}</option>`).join("")}</select></label>`
        : `<label class="cap"><span>${esc(label)}</span><input type="number" step="any" data-p="${k}" data-role="${role}" data-ci="${ci}" value="${esc(v)}"></label>`;
    }).join("")}</div>`;
  };
  const slotHtml = (slot, role, ci, label) => `<div class="caslot"><span class="muted cal">${label}</span>
      <select data-slot="${role}" data-ci="${ci}">${optList(slot.key, i => i.kind !== "bool", true)}</select>
      ${slot.key === "value" ? `<input type="number" step="any" class="caval mono" data-v="${role}" data-ci="${ci}" value="${esc(slot.v ?? "")}" placeholder="price">` : ""}
    </div>${params(slot, role, ci)}`;
  const condHtml = (c, ci) => {
    const k = kindOf(c.a.key), ops = k === "bool" ? ["true"] : [...CA_TWO, ...CA_CHAN, ...CA_MOVE];
    if(!ops.includes(c.op)) c.op = ops[0];
    let rest = "";
    if(CA_TWO.includes(c.op)) rest = slotHtml(c.b, "b", ci, "");
    else if(CA_CHAN.includes(c.op)) rest = slotHtml(c.hi, "hi", ci, "Upper") + slotHtml(c.lo, "lo", ci, "Lower");
    else if(CA_MOVE.includes(c.op)) rest = `<div class="caslot"><input type="number" step="any" min="0" data-amt="${ci}" value="${esc(c.amt ?? 1)}" class="mono" style="max-width:110px">
      <span class="muted">${c.op.endsWith("pct") ? "%" : ""} within</span><input type="number" min="1" max="300" data-bars="${ci}" value="${esc(c.bars ?? 1)}" class="mono" style="max-width:70px"><span class="muted">bars</span></div>`;
    return `<div class="cacond" data-ci="${ci}">
      <div class="cach"><b>${st.conds.length > 1 ? "Condition " + (ci + 1) : "Condition"}</b><span class="sp"></span>
        <select data-tf="${ci}" title="Timeframe this condition is worked out on">${caTfs().map(t => `<option${t === c.tf ? " selected" : ""}>${t}</option>`).join("")}</select>
        ${st.conds.length > 1 ? `<button class="ghost" data-rm="${ci}" title="Remove this condition">✕</button>` : ""}</div>
      <div class="caslot"><select data-slot="a" data-ci="${ci}">${optList(c.a.key, null, false)}</select></div>${params(c.a, "a", ci)}
      <div class="caslot"><select data-op="${ci}">${ops.map(o => `<option value="${o}"${o === c.op ? " selected" : ""}>${CA_OPS[o]}</option>`).join("")}</select></div>
      ${rest}</div>`;
  };
  const expVal = () => { if(!st.exp) return ""; const d = new Date((st.exp + 19800) * 1000); return d.toISOString().slice(0, 16); };
  const tgt = st.target;
  const render = () => {
    const nt = st.notify, isT = !!tgt.wl, chartT = st.ctype ? st.ctype.type : ctT;
    m.innerHTML = `<div class="ca cadlg" role="dialog" aria-label="Alert">
      <div class="cadh"><b>${edit ? "Edit alert" : "Create alert"}</b><span class="sp"></span><button class="ghost" id="caX" title="Close (Esc)">✕</button></div>
      <div class="cadb">
        <label>Symbol</label>
        <select id="caTgt">${cur || tgt.s ? `<option value="s:${esc(tgt.s || cur.s)}"${!isT ? " selected" : ""}>${esc(symLabel(tgt.s || cur.s))}${onChart ? " (this chart)" : ""}</option>` : ""}
          ${wls.length ? `<optgroup label="Watchlist alert: each symbol on its own">${wls.map(w => `<option value="wl:${esc(w.id)}"${tgt.wl === w.id ? " selected" : ""}>${esc(w.name || "Watchlist")} (${(w.items || []).length})</option>`).join("")}</optgroup>` : ""}</select>
        ${st.conds.map(condHtml).join(`<div class="cajoin">${st.join === "any" ? "or" : "and"}</div>`)}
        <div class="carow">${st.conds.length < 5 ? `<button id="caAdd">+ Add condition</button>` : `<span class="muted sm">Up to 5 conditions</span>`}
          ${st.conds.length > 1 ? `<div class="seg" id="caJoin"><button data-j="all" class="${st.join !== "any" ? "on" : ""}">All must be true</button><button data-j="any" class="${st.join === "any" ? "on" : ""}">Any one</button></div>` : ""}</div>
        ${chartT !== "candles" ? `<label class="cachk"><input type="checkbox" id="caCt"${st.useCt ? " checked" : ""}> Work out on ${esc(typeof CT !== "undefined" ? CT.name(chartT) : chartT)} bars (this chart's type), not candles</label>` : ""}
        <label>Trigger</label>
        <div class="seg caseg" id="caFreq">${CA_FREQ.map(([f, n]) => `<button data-f="${f}" class="${st.freq === f ? "on" : ""}">${n}</button>`).join("")}</div>
        <p class="help" id="caFreqHelp">${{once: "Fires the first time, then stops (a watchlist alert: once per symbol).", bar: "At most once in each bar of the first condition's timeframe.",
          close: "Worked out when the bar closes: no alert for a move that didn't hold to the close.", minute: "Whenever it's true, at most once a minute."}[st.freq]}</p>
        <label>Expiry</label>
        <div class="carow"><label class="cachk" style="margin:0"><input type="checkbox" id="caOpen"${!st.exp ? " checked" : ""}> Open-ended</label>
          <input type="datetime-local" id="caExp" value="${expVal()}" class="${!st.exp ? "hide" : ""}" style="max-width:220px"></div>
        <label>Alert name</label><input id="caName" maxlength="100" value="${esc(st.name)}" placeholder="(optional: the condition is shown)">
        <label>Message</label><textarea id="caMsg" rows="3" maxlength="2000" placeholder="(the condition, with the price) · JSON for webhooks: {&quot;sym&quot;: &quot;{{ticker}}&quot;, &quot;px&quot;: {{close}}}">${esc(st.msg)}</textarea>
        <div class="caph">${CA_PH.map(p => `<button class="chip" data-ph="${esc(p)}">${esc(p)}</button>`).join("")}</div>
        <label>Notifications</label>
        <div class="canot">
          <label class="cachk"><input type="checkbox" id="caPop"${nt.popup !== false ? " checked" : ""}> Pop-up on open pages</label>
          <div class="carow"><span class="muted">Sound</span><select id="caSnd" style="max-width:140px">${Object.keys(CA_SOUND).map(s => `<option${s === nt.sound ? " selected" : ""}>${s}</option>`).join("")}</select><button class="ghost" id="caSndT" title="Play">▶</button></div>
          <label class="cachk"><input type="checkbox" id="caPush"${nt.push !== false ? " checked" : ""}> Phone and desktop notifications <span class="muted sm">(${caPushText()})</span></label>
          ${CA.tg === null ? "" : `<label class="cachk"><input type="checkbox" id="caTg"${nt.tg ? " checked" : ""}${CA.tg ? "" : " disabled"}> Telegram ${CA.tg ? "" : '<span class="muted sm">(set up in Settings › Telegram alerts)</span>'}</label>`}
          <label class="cachk" style="margin-bottom:2px"><input type="checkbox" id="caWhOn"${nt.webhook ? " checked" : ""}> Webhook URL</label>
          <input id="caWh" class="${nt.webhook ? "" : "hide"} mono" placeholder="https://… (POST with the message)" value="${esc(nt.webhook || "")}">
        </div>
        <div class="err" id="caErr"></div>
      </div>
      <div class="btns"><button class="ghost" id="caCancel">Cancel</button><button class="primary" id="caSave">${edit ? "Save" : "Create"}</button></div></div>`;
    wire();
  };
  const pull = () => {                           // the form -> st (before any re-render)
    st.name = caq("#caName").value; st.msg = caq("#caMsg").value;
    st.notify = {popup: caq("#caPop").checked, sound: caq("#caSnd").value, push: caq("#caPush").checked, tg: !!(caq("#caTg") && caq("#caTg").checked),
      webhook: caq("#caWhOn").checked ? caq("#caWh").value.trim() : ""};
    if(caq("#caCt")) st.useCt = caq("#caCt").checked;
    st.exp = caq("#caOpen").checked ? 0 : caq("#caExp").value ? Math.round(Date.parse(caq("#caExp").value + ":00Z") / 1000) - 19800 : 0;
    caqa(m, "[data-v]").forEach(i => { const c = st.conds[+i.dataset.ci]; c[i.dataset.v].v = i.value; });
    caqa(m, "[data-amt]").forEach(i => { st.conds[+i.dataset.amt].amt = i.value; });
    caqa(m, "[data-bars]").forEach(i => { st.conds[+i.dataset.bars].bars = i.value; });
    caqa(m, "[data-p]").forEach(i => { const s = st.conds[+i.dataset.ci][i.dataset.role]; s.p = s.p || {}; s.p[i.dataset.p] = i.value; });
  };
  const wire = () => {
    caq("#caX").onclick = caq("#caCancel").onclick = caClose;
    caq("#caTgt").onchange = e => { pull(); const v = e.target.value; if(v.startsWith("wl:")){ const w = wls.find(x => x.id === v.slice(3)); st.target = {wl: w.id, wl_name: w.name}; } else st.target = {s: v.slice(2)};
      Object.assign(tgt, st.target); if(tgt.wl) delete tgt.s; else delete tgt.wl; render(); };
    caqa(m, "[data-slot]").forEach(s => s.onchange = () => { pull(); const c = st.conds[+s.dataset.ci], role = s.dataset.slot; c[role] = {key: s.value, v: c[role].v};
      const it = cat.find(i => i.key === s.value); if(it && it.ind) c[role].p = {...(it.p || {})};
      if(role === "a" && it && it.acMsg && !st.msg) st.msg = it.acMsg;
      // a channel or rectangle picked as one edge: the other edge follows
      if((role === "hi" || role === "lo") && /^draw:.*:(upper|lower)$/.test(s.value)){ const id = s.value.split(":")[1]; c.hi = {key: `draw:${id}:upper`}; c.lo = {key: `draw:${id}:lower`}; }
      render(); });
    caqa(m, "[data-op]").forEach(s => s.onchange = () => { pull(); const c = st.conds[+s.dataset.op]; c.op = s.value;
      if(CA_CHAN.includes(c.op) && c.hi.key === "value" && !c.hi.v){ const p = caNow(); if(p != null){ const t = (cur && cur.tick) || 0.05; c.hi.v = +(p * 1.005).toFixed(4); c.lo.v = +(p * 0.995).toFixed(4); } }
      render(); });
    caqa(m, "[data-tf]").forEach(s => s.onchange = () => { pull(); st.conds[+s.dataset.tf].tf = s.value; });
    caqa(m, "[data-rm]").forEach(b => b.onclick = () => { pull(); st.conds.splice(+b.dataset.rm, 1); render(); });
    const add = caq("#caAdd"); if(add) add.onclick = () => { pull(); st.conds.push({a: {key: "price:last"}, op: "gt", b: {key: "value", v: caNow()}, lo: {key: "value", v: ""}, hi: {key: "value", v: ""}, tf: st.conds[0].tf, amt: 1, bars: 1}); render(); };
    caqa(m, "#caJoin [data-j]").forEach(b => b.onclick = () => { pull(); st.join = b.dataset.j; render(); });
    caqa(m, "#caFreq [data-f]").forEach(b => b.onclick = () => { pull(); st.freq = b.dataset.f; render(); });
    caq("#caOpen").onchange = e => caq("#caExp").classList.toggle("hide", e.target.checked);
    caq("#caWhOn").onchange = e => caq("#caWh").classList.toggle("hide", !e.target.checked);
    caq("#caSndT").onclick = () => caPlay(caq("#caSnd").value);
    caqa(m, "[data-ph]").forEach(b => b.onclick = () => { const t = caq("#caMsg"), p = t.selectionStart ?? t.value.length;
      t.value = t.value.slice(0, p) + b.dataset.ph + t.value.slice(t.selectionEnd ?? p); t.focus(); t.selectionStart = t.selectionEnd = p + b.dataset.ph.length; });
    caq("#caSave").onclick = async () => {
      pull(); const btn = caq("#caSave"); btn.disabled = true; caq("#caErr").textContent = "";
      try{
        const body = await caBuild(st, cat);
        const j = await api("/api/alerts/save", {body: {alert: body}});
        if(!j.ok){ caq("#caErr").textContent = j.error || "Not saved"; return; }
        prefSet("caNotify", {...st.notify, webhook: ""});
        caClose(); toast(edit ? "Alert saved" : "Alert created"); await caLoad();
        if(st.notify.push && !caPushOn()) caPushNudge();
      }catch(e){ caq("#caErr").textContent = e.message || String(e); }
      finally{ const b2 = caq("#caSave"); if(b2) b2.disabled = false; }
    };
  };
  render();
  m.classList.remove("hide");
  document.addEventListener("keydown", caDlgKey, true);
}
function caDlgKey(e){ if(e.key === "Escape" && CA.dlg){ e.preventDefault(); e.stopPropagation(); caClose(); } }
function caClose(){ const m = caq("#caDlg"); if(m) m.classList.add("hide"); CA.dlg = null; document.removeEventListener("keydown", caDlgKey, true); }
function caNow(){
  const l = cur && typeof last !== "undefined" ? last[cur.s] : null;
  const p = l ? l.ltp : (typeof lastBar !== "undefined" && lastBar ? lastBar.close : null);
  return p != null ? +(+p).toFixed(6) : "";
}
/* the dialog's state -> what the server stores */
async function caBuild(st, cat){
  const src = async (slot, role) => {
    if(!slot) return null;
    if(slot.key === "value"){ if(slot.v === "" || slot.v == null || isNaN(+slot.v)) throw new Error("A value is missing"); return {k: "value", v: +slot.v}; }
    const it = cat.find(i => i.key === slot.key); if(!it) throw new Error("Pick what to watch");
    if(it.saved) return it.saved;
    const [k, ...rest] = slot.key.split(":");
    if(k === "price") return {k: "price", f: rest[0]};
    if(k === "bar") return {k: "bar", f: rest[0]};
    if(k === "pf") return {k: "pf", sig: rest[0]};
    if(k === "ind") return {k: "ind", t: rest[0], out: rest.slice(1).join(":"), p: {...(it.p || {}), ...(slot.p || {})}};
    if(k === "draw") return {k: "draw", id: rest[0], edge: rest[1], name: it.name || "Drawing"};
    if(k === "pine"){
      const r = it.r, sc = pineScript(r.cfg.scriptId); if(!sc) throw new Error("That script isn't in your library any more");
      const {libs, missing} = await pineLibs(sc.source);
      const out = {k: "pine", name: (r.pine && r.pine.title) || sc.name, code: sc.source, inputs: r.cfg.inputs || {}, props: (typeof pineProps === "function" ? pineProps(r) : null) || {},
        libs, missing, sid: sc.id};
      if(rest[1] === "plot") out.plot = rest.slice(2).join(":"); else if(rest[1] === "ac") out.ac = rest.slice(2).join(":"); else out.any = true;
      return out;
    }
    throw new Error("Unknown source");
  };
  if(st.conds.some(c => ["a", "b", "lo", "hi"].some(k => c[k] && String(c[k].key).startsWith("draw:"))) && typeof drSaveNow === "function") await drSaveNow();
  const conds = [];
  for(const c of st.conds){
    const o = {a: await src(c.a, "a"), op: c.op, tf: c.tf};
    if(CA_TWO.includes(c.op)) o.b = await src(c.b, "b");
    if(CA_CHAN.includes(c.op)){ o.lo = await src(c.lo, "lo"); o.hi = await src(c.hi, "hi"); }
    if(CA_MOVE.includes(c.op)){ o.amt = +c.amt; o.bars = Math.round(+c.bars); }
    conds.push(o);
  }
  const ctT = typeof ctType === "function" ? ctType() : "candles";
  let ctype = {type: "candles"};
  if(st.useCt){
    if(st.ctype && st.ctype.type !== "candles") ctype = st.ctype;                 // (an edit keeps what it was set with)
    else if(ctT !== "candles") ctype = {type: ctT, opts: ctCfg(), pfInd: ctCfg().pfInd, hideNoTrade: chartCfg().hideNoTrade !== false};
  }
  if(!st.useCt && typeof chartCfg === "function") ctype.hideNoTrade = chartCfg().hideNoTrade !== false;
  return {id: CA.dlg && CA.dlg.edit ? CA.dlg.edit.id : undefined, target: st.target, conds, join: st.join, freq: st.freq, exp: st.exp, name: st.name.trim(),
    msg: st.msg, notify: st.notify, ctype};
}

/* quick ways in */
function caQuick(price){
  if(!cur){ toast("Open a chart first"); return; }
  const p = price != null ? +(+price).toFixed(6) : caNow();
  caDialog({conds: [{a: {key: "price:last"}, op: "cross", b: {key: "value", v: p}}]});
}
function caOnDrawing(d){
  if(!cur || !CA_DRAW.includes(d.type)){ toast("Alerts work on lines, rays, channels and rectangles"); return; }
  const open = () => {
    if(d.type === "channel" || d.type === "rect") caDialog({conds: [{a: {key: "price:last"}, op: "exit", lo: {key: `draw:${d.id}:lower`}, hi: {key: `draw:${d.id}:upper`}}]});
    else caDialog({conds: [{a: {key: "price:last"}, op: "cross", b: {key: `draw:${d.id}:v`}}]});
  };
  if(typeof drSaveNow === "function") drSaveNow().then(open, open); else setTimeout(open, 50);
}
function caOnIndicator(r){
  if(!r || !r.pine || !r.pine.res){ toast("Wait for the indicator to calculate, then try again"); return; }
  const t = Object.keys(r.pine.res.plots || {}).filter(k => !/^__/.test(k))[0];
  const sc = pineScript(r.cfg.scriptId), acs = caAcTitles(sc ? sc.source : "");
  if(!t && acs.length) caDialog({conds: [{a: {key: `pine:${r.cfg.id}:ac:${acs[0].title}`}, op: "true"}], msg: acs[0].msg});
  else if(t) caDialog({conds: [{a: {key: `pine:${r.cfg.id}:plot:${t}`}, op: "cross", b: {key: "value", v: ""}}]});
  else toast("This script has nothing to alert on");
}

/* ---------------------------------------------------------------- 🔔 lines on the chart (drag to move the level) */
function caLines(force){
  if(typeof series === "undefined" || !series || !cur || (typeof P !== "undefined" && P.dragging)) return;
  const mine = CA.list.filter(a => a.status === "active" && (a.target || {}).s === cur.s);
  const lv = [];
  for(const a of mine) a.conds.forEach((c, ci) => {
    if(!["price", "bar"].includes(c.a.k)) return;
    if(CA_TWO.includes(c.op) && c.b && c.b.k === "value") lv.push({a, ci, role: "b", v: c.b.v});
    if(CA_CHAN.includes(c.op)){ if(c.lo && c.lo.k === "value") lv.push({a, ci, role: "lo", v: c.lo.v}); if(c.hi && c.hi.k === "value") lv.push({a, ci, role: "hi", v: c.hi.v}); }
  });
  const key = lv.map(x => `${x.a.id}:${x.ci}:${x.role}:${x.v}`).join("|") + "|" + cur.s;
  if(!force && key === CA.lineKey && CA.lineSeries === series) return;
  CA.lineKey = key; CA.lineSeries = series;
  for(const l of CA.lines){ try{ series.removePriceLine(l); }catch(e){} }
  CA.lines = [];
  const drags = [];
  const col = (typeof chartCfg === "function" && chartCfg().alertC) || "#e0b341";
  for(const x of lv){
    let v = x.v;
    const line = series.createPriceLine({price: v, color: col, lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: "🔔" + (x.a.name ? " " + x.a.name.slice(0, 18) : "")});
    CA.lines.push(line);
    drags.push({line, price: () => v, tick: cur.tick, set: p => { v = p; }, drop: p => caMoveLevel(x.a, x.ci, x.role, p)});
  }
  if(typeof P !== "undefined"){ P.alertDrags = drags; P.drags = [...(P.posDrags || []), ...(P.toolDrags || []), ...drags]; }
}
async function caMoveLevel(a, ci, role, p){
  if(a.conds[ci][role].v === p) return;
  const j = await api("/api/alerts/save", {body: {level: {id: a.id, ci, role, v: p}}});
  toast(j.ok ? `Alert moved to ${fmt(p, cur && cur.tick)}` : (j.error || "Not moved"));
  await caLoad();
}

/* ---------------------------------------------------------------- phone and desktop notifications (Web Push) */
function caPushOn(){ return !!(CA.swSub && CA.push && (CA.push.subs || []).length); }
function caPushText(){
  const n = CA.push ? (CA.push.subs || []).length : 0;
  return n ? `${n} device${n > 1 ? "s" : ""}` : "no device yet: Alerts › Notifications";
}
function caIOS(){ return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
function caStandalone(){ return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }
async function caSw(){
  if(!("serviceWorker" in navigator)) return null;
  try{
    CA.swReg = CA.swReg || await navigator.serviceWorker.register("/sw.js", {scope: "/"});
    const r = await navigator.serviceWorker.ready;
    CA.swSub = r.pushManager ? await r.pushManager.getSubscription() : null;
    return r;
  }catch(e){ CA.swErr = e.message || String(e); return null; }
}
function caB64(s){ const p = "=".repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); }
async function caPushEnable(){
  const out = caq("#caPushMsg"), say = t => { if(out) out.textContent = t; };
  if(!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)){
    say(caIOS() && !caStandalone() ? "On iPhone: Share › Add to Home Screen, open the app from there, then tap this button again." : "This browser can't receive push notifications.");
    return;
  }
  say("Asking…");
  const perm = await Notification.requestPermission();
  if(perm !== "granted"){ say("Notifications are blocked for this site: allow them in the browser's site settings, then try again."); return; }
  const r = await caSw(); if(!r){ say("Couldn't start the notifications helper: " + (CA.swErr || "")); return; }
  try{
    let sub = await r.pushManager.getSubscription();
    if(!sub) sub = await r.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: caB64(CA.push.key)});
    const name = caIOS() ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android" : /Mac/.test(navigator.userAgent) ? "Mac" : /Windows/.test(navigator.userAgent) ? "Windows" : "This device";
    const j = await api("/api/push/subscribe", {body: {sub: sub.toJSON(), name}});
    if(!j.ok){ say(j.error || "Not saved"); return; }
    CA.swSub = sub; CA.push.subs = j.subs; say("On. Sending a test…");
    await api("/api/push/test", {body: {id: j.sub.id}}); say("On: a test notification is on its way.");
  }catch(e){ say("Didn't work: " + (e.message || e)); }
  if(PG.page === "alerts") caRender();
}
async function caPushOff(){
  const r = await caSw();
  const sub = r && await r.pushManager.getSubscription();
  if(sub){ await api("/api/push/unsubscribe", {body: {endpoint: sub.endpoint}}); try{ await sub.unsubscribe(); }catch(e){} }
  CA.swSub = null; await caLoad(); caRender();
}
function caPushNudge(){ toast("Turn on phone / desktop notifications in Alerts › Notifications"); }

/* ---------------------------------------------------------------- the Alerts page */
const CA_ST = {active: ["Active", "ok"], paused: ["Paused", "warn"], triggered: ["Triggered", ""], expired: ["Expired", ""]};
function caRender(){
  const el = caq("#pg_alerts"); if(!el) return;
  if(!CA.loaded){ el.innerHTML = `<div class="pg-head"><h2>Alerts</h2></div><p class="muted">Loading…</p>`; caLoad(); return; }
  const c = CA.meta.counts || {}, L = CA.meta.limits || {};
  el.innerHTML = `<div class="pg-head"><h2>Alerts</h2><span class="muted sm">${c.active || 0} active · ${c.all || 0} of ${L.alerts} · technical ${c.tech || 0} of ${L.tech}</span><span class="sp"></span>
      <button class="primary" id="caNew">+ Create alert</button></div>
    <div class="catabs">${[["list", "Alerts"], ["log", "Log"], ["notify", "Notifications"]].map(([k, n]) => `<button data-t="${k}" class="${CA.tab === k ? "on" : ""}">${n}</button>`).join("")}</div>
    <div id="caBody"></div>`;
  caq("#caNew").onclick = () => caDialog();
  caqa(el, ".catabs [data-t]").forEach(b => b.onclick = async () => { CA.tab = b.dataset.t; if(CA.tab === "log") await caLogLoad(); if(CA.tab === "notify") await caSw(); caRender(); });
  const body = caq("#caBody");
  const runner = CA.meta.runner || {};
  if(CA.tab === "list"){
    const W = CA.q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = CA.list.filter(a => (CA.f === "all" || a.status === CA.f) && W.every(w => (a.name + " " + a.text + " " + (a.target.s || a.target.wl_name)).toLowerCase().includes(w)))
      .sort((x, y) => (x.status === "active" ? 0 : 1) - (y.status === "active" ? 0 : 1) || (y.updated || 0) - (x.updated || 0));
    body.innerHTML = `<div class="carow cafilter"><input id="caQ" placeholder="Search alerts" value="${esc(CA.q)}" style="max-width:260px">
        <div class="seg">${[["all", "All"], ["active", "Active"], ["triggered", "Triggered"], ["paused", "Paused"], ["expired", "Expired"]].map(([k, n]) => `<button data-f="${k}" class="${CA.f === k ? "on" : ""}">${n}</button>`).join("")}</div></div>
      ${!runner.ok && runner.err && CA.list.some(a => a.tech && a.status === "active") ? `<p class="help down">⚠ ${esc(runner.err)}</p>` : ""}
      ${(CA.meta.unwatched || []).length ? `<p class="help cawarn">⚠ Not watched (Fyers' price socket is full with your charts and trades): ${esc(CA.meta.unwatched.map(symLabel).join(", "))}</p>` : ""}
      ${rows.length ? `<div class="calist">${rows.map(a => `<div class="carowa ${a.status}" data-id="${a.id}">
          <span class="dot ${(CA_ST[a.status] || ["", ""])[1]}" title="${(CA_ST[a.status] || [a.status])[0]}"></span>
          <div class="cam"><div><b class="caname" data-e>${esc(a.name || a.conds_text.join(a.join === "any" ? " or " : " and "))}</b> <span class="muted sm">${a.target.wl ? "☰ " + esc(a.target.wl_name) + ` (${a.syms.length})` : esc(symLabel(a.target.s))}</span></div>
            ${a.name ? `<div class="muted sm">${a.conds_text.map(esc).join(a.join === "any" ? " <i>or</i> " : " <i>and</i> ")}</div>` : ""}
            <div class="muted sm">${(CA_FREQ.find(f => f[0] === a.freq) || ["", a.freq])[1]} · ${a.conds[0].tf}${a.ctype && a.ctype.type !== "candles" ? " · " + esc(typeof CT !== "undefined" ? CT.name(a.ctype.type) : a.ctype.type) : ""}${a.exp ? " · until " + esc(istTime(a.exp)) : ""}
              ${a.fired ? ` · fired ${a.fired}× (last ${esc(istTime(a.last))})` : ""}${a.status !== "active" ? " · " + (CA_ST[a.status] || [a.status])[0] : ""}</div>
            ${a.note ? `<div class="sm cawarn">${esc(a.note)}</div>` : ""}</div>
          <div class="caacts">${a.status === "active" ? `<button class="ghost" data-a="pause" title="Pause">⏸</button>` : `<button class="ghost" data-a="${a.status === "paused" ? "resume" : "restart"}" title="${a.status === "paused" ? "Resume" : "Restart"}">▶</button>`}
            <button class="ghost" data-e title="Edit">✎</button><button class="ghost" data-a="clone" title="Clone">⧉</button><button class="ghost" data-c title="Open the chart">📈</button><button class="ghost danger-t" data-a="delete" title="Delete">🗑</button></div></div>`).join("")}</div>`
        : `<div class="empty">${CA.list.length ? "No alerts match." : `No alerts yet. On a chart: 🔔 (or Alt+A), right-click → Add alert, or a drawing's menu → Add alert.`}</div>`}`;
    caq("#caQ").oninput = e => { CA.q = e.target.value; const p = e.target.selectionStart; caRender(); const q = caq("#caQ"); q.focus(); q.selectionStart = q.selectionEnd = p; };
    caqa(body, ".cafilter [data-f]").forEach(b => b.onclick = () => { CA.f = b.dataset.f; caRender(); });
    caqa(body, ".carowa").forEach(row => {
      const a = CA.list.find(x => x.id === row.dataset.id);
      row.querySelectorAll("[data-e]").forEach(b => b.onclick = () => caEdit(a));
      row.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => {
        if(b.dataset.a === "delete" && !confirm(`Delete the alert "${a.name || a.text}"?`)) return;
        await caAct(a.id, b.dataset.a);
      });
      const cb = row.querySelector("[data-c]"); if(cb) cb.onclick = () => caOpenChart(a.target.s || a.syms[0]);
    });
  }
  if(CA.tab === "log"){
    body.innerHTML = `<div class="carow"><span class="muted sm">${CA.log.length} recent</span><span class="sp"></span><button class="ghost" id="caClr">Clear the log</button></div>
      ${CA.log.length ? `<div class="calog">${CA.log.map(e => `<div class="calogr"><span class="mono muted">${esc(istTime(e.t, {day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit"}))}</span>
        <b>${esc(e.name || "")}</b><span class="muted">${esc(symLabel(e.s || ""))}${e.px != null ? " · " + esc(fmt(e.px, (sym[e.s] || {}).tick)) : ""}</span><span class="calm">${esc(e.msg || "")}</span></div>`).join("")}</div>`
        : `<div class="empty">Nothing has fired yet.</div>`}`;
    caq("#caClr").onclick = async () => { if(!confirm("Clear the alerts log?")) return; await api("/api/alerts/log/clear", {body: {}}); CA.log = []; caRender(); };
  }
  if(CA.tab === "notify"){
    const subs = (CA.push && CA.push.subs) || [], perm = "Notification" in window ? Notification.permission : "unsupported";
    const here = CA.swSub && subs.some(s => CA.swSub.endpoint && s.host && CA.swSub.endpoint.includes(s.host)) ? CA.swSub : null;
    body.innerHTML = `<div class="cacards">
      <div class="scard"><h3>Phone and desktop notifications</h3>
        <p class="help">Alerts arrive as notifications with the page closed and the phone locked (the browser's own push service: Google's on Android,
          Apple's on iPhone). Turn it on once on each device.</p>
        <div class="carow"><b>This device:</b> <span>${here ? '<span class="up">on</span>' : perm === "denied" ? '<span class="down">blocked in the browser\'s site settings</span>' : "off"}</span><span class="sp"></span>
          ${here ? `<button id="caPTest">Send a test</button><button class="ghost" id="caPOff">Turn off here</button>` : `<button class="primary" id="caPOn">Turn on for this device</button>`}</div>
        <div class="help" id="caPushMsg"></div>
        ${subs.length ? `<div class="casubs">${subs.map(s => `<div class="carow"><span>${esc(s.name || "Device")}</span><span class="muted sm">${esc(s.host)} · added ${esc(istTime(s.added))}${s.ok ? " · last sent " + esc(istTime(s.ok)) : ""}${s.err ? ` · <span class="down">${esc(s.err)}</span>` : ""}</span><span class="sp"></span>
          <button class="ghost" data-pt="${s.id}" title="Test">Test</button><button class="ghost danger-t" data-px="${s.id}" title="Remove">✕</button></div>`).join("")}</div>` : ""}
        <details class="cahow"><summary>How to set it up on a phone</summary>
          <p><b>Android (Chrome):</b> open this site, ⋮ › <i>Add to Home screen</i> (or <i>Install app</i>), open it from the home screen, More › Alerts › Notifications › <i>Turn on</i>, allow notifications.</p>
          <p><b>iPhone / iPad (iOS 16.4 or later):</b> open this site in Safari, Share › <i>Add to Home Screen</i>, open the app from the home screen
            (notifications only work there, not in Safari's tab), More › Alerts › Notifications › <i>Turn on</i>, allow.</p>
          <p><b>Desktop:</b> Chrome, Edge or Firefox: <i>Turn on</i> here; notifications come while the browser runs (no tab needed).</p></details></div>
      ${CA.tg === null ? "" : `<div class="scard"><h3>Telegram</h3><p class="help">${CA.tg ? "Your bot is set up: tick <b>Telegram</b> on an alert to get it there too." : "Set up your bot in Settings › Telegram alerts, then tick <b>Telegram</b> on an alert."}</p>
        ${CA.tg ? "" : `<button id="caTgSet">Open Settings › Telegram alerts</button>`}</div>`}
      <div class="scard"><h3>Webhook</h3><p class="help">Like TradingView's: the server POSTs the alert's message (as JSON when the message is JSON) to your address on ports 80 / 443.
        Works with ntfy.sh, Pushover, Discord, Slack, or a bot of your own. Private / local addresses are refused.</p></div>
      <div class="scard"><h3>Sound and pop-up</h3><p class="help">Every open page of the app shows a pop-up and plays the alert's sound (a browser plays sound only after you've clicked the page once).</p>
        <div class="carow">${Object.keys(CA_SOUND).filter(s => s !== "none").map(s => `<button class="ghost" data-snd="${s}">▶ ${s}</button>`).join("")}</div></div></div>`;
    const on = caq("#caPOn"); if(on) on.onclick = caPushEnable;
    const off = caq("#caPOff"); if(off) off.onclick = caPushOff;
    const t = caq("#caPTest"); if(t) t.onclick = async () => { const j = await api("/api/push/test", {body: {}}); caq("#caPushMsg").textContent = j.ok ? `Sent to ${j.res.sent} device(s)${j.res.failed ? `, ${j.res.failed} failed` : ""}.` : j.error; };
    caqa(body, "[data-pt]").forEach(b => b.onclick = async () => { const j = await api("/api/push/test", {body: {id: b.dataset.pt}}); caq("#caPushMsg").textContent = j.ok ? (j.res.sent ? "Sent." : "Not delivered: " + ((j.subs.find(s => s.id === b.dataset.pt) || {}).err || "")) : j.error; });
    caqa(body, "[data-px]").forEach(b => b.onclick = async () => { await api("/api/push/unsubscribe", {body: {id: b.dataset.px}}); await caLoad(); caRender(); });
    caqa(body, "[data-snd]").forEach(b => b.onclick = () => caPlay(b.dataset.snd));
    const ts = caq("#caTgSet"); if(ts) ts.onclick = () => { openDrawer(); setTimeout(() => typeof setGo === "function" && setGo("tgSec"), 200); };
  }
}
function caEdit(a){
  if(!a) return;
  if(a.target.s && (!cur || cur.s !== a.target.s) && a.conds.some(c => ["a", "b", "lo", "hi"].some(k => c[k] && c[k].k === "draw"))){
    caOpenChart(a.target.s).then(() => setTimeout(() => caDialog({alert: a}), 900));     // its drawings come with its chart
    return;
  }
  caDialog({alert: a});
}

/* ---------------------------------------------------------------- hooks into the page */
(function caHook(){
  if(typeof PAGES !== "undefined" && !PAGES.includes("alerts")) PAGES.splice(PAGES.indexOf("log"), 0, "alerts");
  const ps = pgShow;
  pgShow = function(name, fromHash){ ps(name, fromHash); if(name === "alerts") caRender(); };
  const dl = drawLines;
  drawLines = function(){ dl(); try{ caLines(); }catch(e){} };
  document.addEventListener("DOMContentLoaded", () => {
    // the page: Alerts in the top bar, the 🔔 on the chart
    const nav = caq("#nav");
    if(nav && !nav.querySelector('[data-pg="alerts"]')){
      const b = document.createElement("button"); b.dataset.pg = "alerts"; b.title = "Alerts"; b.setAttribute("aria-label", "Alerts"); b.className = "canav";
      b.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg><span class="nb hide" id="nbAlerts"></span>`;
      b.onclick = () => pgShow("alerts"); nav.querySelector('[data-pg="log"]').before(b);
    }
    const pages = caq("#pages");
    if(pages && !caq("#pg_alerts")){ const d = document.createElement("div"); d.className = "pg hide"; d.id = "pg_alerts"; pages.append(d); }
    const ind = caq("#bInd");
    if(ind && !caq("#bAlert")){
      const b = document.createElement("button"); b.className = "ghost fsb"; b.id = "bAlert"; b.title = "Create alert (Alt+A)"; b.textContent = "🔔";
      b.onclick = () => caQuick(); ind.after(b);
    }
    if(typeof mMore === "function"){            // the phone's More tab gets an Alerts row
      const mm = mMore;
      window.mMore = mMore = function(){ mm(); const l = document.querySelector("#ms_more .mlist"); if(l && !l.querySelector('[data-pg="alerts"]')){
        const b = document.createElement("button"); b.dataset.pg = "alerts"; b.innerHTML = "<span>Alerts<br><small>price and indicator alerts, the log, phone notifications</small></span>›"; b.onclick = () => pgShow("alerts"); l.prepend(b); } };
    }
    if(typeof drMenu === "function"){           // a drawing's right-click menu: 🔔 Add alert
      const dm = drMenu;
      drMenu = function(d, x, y){ dm(d, x, y); if(!CA_DRAW.includes(d.type)) return; const m = caq("#drMenu"); if(!m || m.querySelector("[data-caa]")) return;
        const b = document.createElement("button"); b.dataset.caa = "1"; b.textContent = "🔔 Add alert…"; b.onclick = () => { drUiMenuClose(); caOnDrawing(d); };
        const h = m.querySelector(".fh"); if(h) h.after(b); else m.prepend(b); };
    }
    if(typeof renderIndPick === "function"){    // ƒx: 🔔 on each script on the chart
      const rp = renderIndPick;
      renderIndPick = function(){ rp(); caqa(document, "#indBody .ind[data-pine]").forEach(row => {
        if(row.querySelector("[data-ca]")) return; const r = INDS.find(x => x.cfg.id === row.dataset.pine);
        const b = document.createElement("button"); b.className = "ghost"; b.dataset.ca = "1"; b.title = "Add alert on this indicator"; b.textContent = "🔔";
        b.onclick = e => { e.stopPropagation(); caq("#indPick").classList.add("hide"); caOnIndicator(r); };
        const set = row.querySelector('[data-a="pset"]'); if(set) set.before(b); }); };
    }
    // right-click on the chart (not on a drawing): Add alert at that price
    const ch = caq("#chart");
    if(ch) ch.parentElement.addEventListener("contextmenu", e => {
      if(e.defaultPrevented || !series || !e.target.closest("#chart")) return;
      const y = e.clientY - ch.getBoundingClientRect().top, p = series.coordinateToPrice(y);
      if(p == null) return;
      e.preventDefault();
      caCtxMenu(e.clientX, e.clientY, typeof roundTick === "function" ? roundTick(p, cur.tick) : p);
    });
    if(typeof refreshState === "function"){     // (the list loads once you're logged in)
      const rs = refreshState;
      refreshState = function(...a){ const r = rs.apply(this, a); Promise.resolve(r).then(() => { if(typeof S !== "undefined" && S.user && !CA.loaded) caLoad(); }); return r; };
    }
    if(typeof S !== "undefined" && S.user) caLoad();
    if(!CA_CELL) caSw();                         // (only reads whether this browser is subscribed)
    if("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", ev => { if(ev.data && ev.data.push) CA.lastPush = ev.data.push; });
  });
  document.addEventListener("keydown", e => {
    if(e.altKey && !e.ctrlKey && !e.metaKey && (e.code === "KeyA" || e.key === "a" || e.key === "A")){ e.preventDefault(); caQuick(); }
  });
})();
function caCtxMenu(x, y, price){
  let m = caq("#caCtx");
  if(!m){ m = document.createElement("div"); m.id = "caCtx"; document.body.append(m);
    document.addEventListener("pointerdown", ev => { if(!ev.target.closest("#caCtx")) m.classList.add("hide"); }, true); }
  m.innerHTML = `<button data-a="at">🔔 Add alert at ${esc(fmt(price, cur.tick))}</button><button data-a="dlg">🔔 Add alert…</button>`;
  m.querySelector('[data-a="at"]').onclick = () => { m.classList.add("hide"); caQuick(price); };
  m.querySelector('[data-a="dlg"]').onclick = () => { m.classList.add("hide"); caQuick(); };
  m.classList.remove("hide");
  m.style.left = Math.min(x, innerWidth - 230) + "px"; m.style.top = Math.min(y, innerHeight - 90) + "px";
}
