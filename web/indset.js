/* Indicator settings, like TradingView's: Inputs / Style / Visibility, for every indicator on the chart (your Pine
   scripts and the built-ins). Changes show on the chart at once and are saved with the chart's indicators (your
   preferences on the server, so every device has them); Cancel puts back what was there when the dialog opened.

   Saved on each indicator (prefs "indicators"):
     inputs {key: value}                 Pine inputs (built-ins keep theirs as top-level keys, as before)
     tf, gaps                            Pine: the indicator's timeframe ("" = the chart's) and "wait for timeframe
                                         closes" - only for scripts whose indicator() has timeframe =, as on TradingView
     style {plots|hlines|fills|bg|barcolor|shapes: {name: {off, colors: {"#RRGGBBAA": "#RRGGBBAA"}, width, type, ls, pl, lv}},
            prec, lbl, sv, inl}          Pine (see pine.js pineApply);  Volume: {up, down, maWidth, maLs}
     vis {m|h|D|W|M: [on, from, to]}     the timeframes it shows on (minutes, hours, days, weeks, months) */
const IS = {r: null, id: null, tab: "inputs", snap: null};
const isq = s => document.querySelector(s);
const VIS_UNITS = [["m", "Minutes", 1, 59], ["h", "Hours", 1, 24], ["D", "Days", 1, 366], ["W", "Weeks", 1, 52], ["M", "Months", 1, 12]];
const IS_TFS = [["", "Chart"], ["1", "1 minute"], ["2", "2 minutes"], ["3", "3 minutes"], ["5", "5 minutes"], ["10", "10 minutes"], ["15", "15 minutes"],
  ["20", "20 minutes"], ["30", "30 minutes"], ["45", "45 minutes"], ["60", "1 hour"], ["120", "2 hours"], ["180", "3 hours"], ["240", "4 hours"],
  ["D", "1 day"], ["W", "1 week"], ["M", "1 month"]];

/* does this indicator show on the chart's timeframe? (Settings › Visibility) */
function indVisOn(cfg, k){
  const v = cfg && cfg.vis; if(!v) return true;
  const t = parseTf(k || tf); if(!t) return true;
  let u, n;
  if(t.min){ if(t.min % 60 === 0){ u = "h"; n = t.min / 60; } else { u = "m"; n = t.min; } }
  else { u = t.u; n = t.n; }
  const x = v[u]; if(!x) return true;
  return !!x[0] && n >= +x[1] && n <= +x[2];
}
/* after a timeframe change: rebuild only if an indicator appears or disappears */
function indVisCheck(){ if(INDS.some(r => !!r.offTf !== !indVisOn(r.cfg))) indBuild(); }

function isItem(){ return indList().find(x => x.id === IS.id); }
function isSave(fn, after){
  const l = indList(), it = l.find(x => x.id === IS.id); if(!it) return;
  fn(it); indSave(l);
  const r = INDS.find(x => x.cfg.id === IS.id);
  if(r) for(const k of ["inputs", "style", "vis", "tf", "gaps", "bars", "update"]) { if(k in it) r.cfg[k] = it[k]; else delete r.cfg[k]; }
  (after || (() => {}))(r, it);
}
function isHex(c){ const h = typeof phex8 === "function" ? phex8(c) : null; return h || "#2962FFFF"; }
function isSw(c){ return `<span class="is-sw" style="background:${pesc(c && /^#[\da-f]{8}$/i.test(c) ? pcol(c) : c || "transparent")}"></span>`; }

/* ------------------------------------------------------------------ the dialog */
function indSettings(r, tab){
  if(!r) return;
  let box = isq("#indSet");
  if(!box){ box = document.createElement("div"); box.id = "indSet"; document.body.append(box); }
  if(IS.id !== r.cfg.id || box.classList.contains("hide")){ IS.snap = JSON.parse(JSON.stringify(indList().find(x => x.id === r.cfg.id) || {})); }
  IS.r = r; IS.id = r.cfg.id; IS.tab = tab || (IS.id === r.cfg.id && !box.classList.contains("hide") ? IS.tab : "inputs");
  isDraw();
  box.classList.remove("hide");
}
function pineInputs(r){ indSettings(r, "inputs"); }     // (older name, still used by the phone layout and tests)
function isTitle(r){
  if(r.cfg.type === "pine") return (r.pine && r.pine.title) || "Pine script";
  return (IND_TYPES[r.cfg.type] || {}).name || r.cfg.type;
}
function isDraw(){
  const box = isq("#indSet"), r = INDS.find(x => x.cfg.id === IS.id) || IS.r; if(!box || !r) return;
  IS.r = r;
  const tabs = [["inputs", "Inputs"], ["style", "Style"], ["vis", "Visibility"]];
  let body = "";
  try{ body = IS.tab === "style" ? isStyleTab(r) : IS.tab === "vis" ? isVisTab(r) : isInputsTab(r); }catch(e){ console.warn(e); body = `<div class="muted">${pesc(String(e.message || e))}</div>`; }
  box.innerHTML = `<div class="pih"><b>${pesc(isTitle(r))}</b><span style="flex:1"></span><button class="ghost" data-x title="Close">✕</button></div>
    <div class="is-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${IS.tab === k ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="pib">${body}</div>
    <div class="pif"><button data-def title="Back to the indicator's own settings (this tab)">Defaults</button><span style="flex:1"></span><button data-cancel>Cancel</button><button class="primary" data-x>OK</button></div>`;
  box.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { IS.tab = b.dataset.tab; isDraw(); });
  box.querySelectorAll("[data-x]").forEach(b => b.onclick = () => { box.classList.add("hide"); isPopClose(); });
  box.querySelector("[data-cancel]").onclick = () => {
    const snap = IS.snap; box.classList.add("hide"); isPopClose();
    if(!snap) return;
    const l = indList(), i = l.findIndex(x => x.id === IS.id); if(i < 0) return;
    l[i] = snap; indSave(l); indBuild();
  };
  box.querySelector("[data-def]").onclick = () => {
    const tab = IS.tab;
    if(tab === "inputs") isSave(it => { if(it.type === "pine"){ it.inputs = {}; delete it.tf; delete it.gaps; } else { const d = (IND_TYPES[it.type] || {}).defaults || {}; for(const [k, , kind] of (IND_TYPES[it.type] || {}).settings || []) if(kind !== "color") it[k] = d[k]; } }, isRefresh);
    if(tab === "style") isSave(it => { delete it.style; if(it.type === "volume"){ const d = IND_TYPES.volume.defaults; it.maColor = d.maColor; } }, isRefresh);
    if(tab === "vis") isSave(it => { delete it.vis; }, () => indBuild());
    setTimeout(isDraw, 250);
  };
  isWire(box, r);
}
/* re-show the chart after a change: Pine re-runs for inputs / timeframe, re-draws for style; built-ins rebuild */
function isRefresh(r, it, what){
  if(!r) return;
  if(r.cfg.type !== "pine"){ indBuild(); return; }
  if(what === "style" && r.pine && r.pine.res){ const sc = pineScript(r.cfg.scriptId); if(sc) pineApply(r, r.pine.res, sc); legendFill(null); legendPlace(); return; }
  pineRun(r); legendFill(null);
}

/* ------------------------------------------------------------------ Inputs */
function isInputsTab(r){
  let h = "";
  if(r.cfg.type !== "pine"){
    const t = IND_TYPES[r.cfg.type] || {settings: []}, v = {...t.defaults, ...isItem()};
    const rows = t.settings.filter(([, , kind]) => kind !== "color");
    h += rows.map(([k, label, kind]) => `<label class="pir"><span>${pesc(label.trim())}</span>${kind === "bool" ? `<input type="checkbox" data-b="${k}" ${v[k] ? "checked" : ""}>`
      : `<input type="number" data-b="${k}" value="${pesc(v[k])}" min="1" max="500">`}</label>`).join("") || `<div class="muted">No inputs.</div>`;
    return h;
  }
  const P = r.pine || {}, meta = P.meta || [], vals = r.cfg.inputs || {}, it = isItem() || {};
  if(P.mtf && P.mtf.declared){
    const v = it.tf != null ? String(it.tf) : String(P.mtf.tf || ""), gaps = it.gaps != null ? !!it.gaps : P.mtf.gaps !== false;
    const list = IS_TFS.some(x => x[0] === v) ? IS_TFS : [...IS_TFS, [v, v]];
    h += `<label class="pir" title="The timeframe the script calculates on (higher than the chart's). Chart = the chart's own."><span>Timeframe</span><select data-tf>${list.map(([a, b]) => `<option value="${a}" ${a === v ? "selected" : ""}>${b}</option>`).join("")}</select></label>
      <label class="pir" title="On: a value shows when its timeframe's bar has closed (no repainting). Off: the last value fills every bar."><span>Wait for timeframe closes</span><input type="checkbox" data-gaps ${gaps ? "checked" : ""}></label>`;
  }
  const bars = +r.cfg.bars || PINE_BARS, BARS = [500, 1000, 1500, 3000, 5000, 10000, 20000, 50000];
  h += `<label class="pir" title="How many of the latest candles the script runs on. More = longer history, a slower first run; live updates stay fast."><span>Bars of history <span class="muted">(app setting)</span></span>
    <select data-bars>${(BARS.includes(bars) ? BARS : [...BARS, bars].sort((a, b) => a - b)).map(n => `<option value="${n}" ${n === bars ? "selected" : ""}>${n.toLocaleString("en-IN")}</option>`).join("")}</select></label>
    <label class="pir" title="Every price: the live bar is re-run on each price (TradingView's way). On candle close: once per new candle - for heavy scripts on long histories."><span>Update <span class="muted">(app setting)</span></span>
    <select data-upd><option value="tick">With every price</option><option value="close" ${r.cfg.update === "close" ? "selected" : ""}>On candle close</option></select></label>
    <div class="muted" style="font-size:11.5px;margin-top:4px">${P.n ? `Runs on ${P.n.toLocaleString("en-IN")} bars now${P.n < bars ? " (all the chart has loaded)" : ""} · full run ${P.ms ?? "–"} ms · live update ${P.tms ?? "–"} ms` : ""}</div>`;
  if(!meta.length) return h + `<div class="muted" style="padding:8px 0">This script has no inputs${P.err ? " (or it didn't compile)" : ""}.</div>`;
  const keyOf = m => m.title || m.name || m.varId || m.id;
  const opt = o => typeof o === "object" && o ? [o.value ?? o.title, o.title ?? o.value] : [o, o];
  const ctl = (m, n) => {
    const k = keyOf(m), v = k in vals ? vals[k] : m.defval, ty = m.type, id = "pin" + n;
    if(ty === "bool") return `<input type="checkbox" id="${id}" data-n="${n}" ${v ? "checked" : ""}>`;
    if(ty === "color") return `<button class="is-cbtn" data-cn="${n}" title="Colour">${isSw(v || "#2962FF")}</button>`;
    if((m.options && m.options.length) || ty === "source") return `<select id="${id}" data-n="${n}">${(m.options || ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4", "hlcc4"]).map(o => { const [ov, ot] = opt(o); return `<option value="${pesc(ov)}" ${String(ov) === String(v) ? "selected" : ""}>${pesc(ot)}</option>`; }).join("")}</select>`;
    if(ty === "timeframe"){ const list = IS_TFS.some(x => x[0] === String(v ?? "")) ? IS_TFS : [...IS_TFS, [String(v), String(v)]]; return `<select id="${id}" data-n="${n}">${list.map(([a, b]) => `<option value="${a}" ${a === String(v ?? "") ? "selected" : ""}>${b}</option>`).join("")}</select>`; }
    if(ty === "int" || ty === "float" || ty === "price") return `<input type="number" id="${id}" data-n="${n}" value="${pesc(v)}" ${m.minval != null ? `min="${m.minval}"` : ""} ${m.maxval != null ? `max="${m.maxval}"` : ""} step="${m.step || (ty === "int" ? 1 : "any")}">`;
    if(ty === "text_area") return `<textarea id="${id}" data-n="${n}" rows="3">${pesc(v)}</textarea>`;
    return `<input type="text" id="${id}" data-n="${n}" value="${pesc(v)}">`;
  };
  let grp = null;
  for(let n = 0; n < meta.length; n++){
    const m = meta[n];
    if((m.group || "") !== grp){ grp = m.group || ""; if(grp) h += `<div class="pig">${pesc(grp)}</div>`; }
    // inputs that share an `inline` key sit on one row, as on TradingView
    const row = [n]; if(m.inline) while(n + 1 < meta.length && meta[n + 1].inline === m.inline && (meta[n + 1].group || "") === grp) row.push(++n);
    const first = meta[row[0]], tip = row.map(i => meta[i].tooltip).filter(Boolean).join(" ");
    if(row.length === 1) h += `<label class="pir" for="pin${n}"${tip ? ` title="${pesc(tip)}"` : ""}><span>${pesc(first.title || first.name || keyOf(first))}</span>${ctl(first, row[0])}</label>`;
    else h += `<div class="pir pinl"${tip ? ` title="${pesc(tip)}"` : ""}><span>${pesc((first.title || "").trim() || "")}</span><span class="pinc">${row.map((i, j) => (j && (meta[i].title || "").trim() ? `<small>${pesc(meta[i].title.trim())}</small>` : "") + ctl(meta[i], i)).join("")}</span></div>`;
  }
  return h;
}

/* ------------------------------------------------------------------ Style */
const IS_LS = [["0", "Solid"], ["2", "Dashed"], ["1", "Dotted"]];
function isStyleTab(r){
  if(r.cfg.type === "volume"){
    const s = (isItem() || {}).style || {}, C = chartCfg(), v = {...IND_TYPES.volume.defaults, ...isItem()};
    return `<div class="pig">Volume</div>
      <div class="pir"><span>Rising bars</span><button class="is-cbtn" data-vc="up">${isSw(s.up || isHex(C.up).slice(0, 7) + "73")}</button></div>
      <div class="pir"><span>Falling bars</span><button class="is-cbtn" data-vc="down">${isSw(s.down || isHex(C.down).slice(0, 7) + "73")}</button></div>
      <div class="pig">Moving average</div>
      <div class="pir"><span>Colour</span><button class="is-cbtn" data-vc="ma">${isSw(v.maColor)}</button></div>
      <label class="pir"><span>Line width</span><select data-vw>${[1, 2, 3, 4].map(w => `<option ${+(s.maWidth || 1) === w ? "selected" : ""}>${w}</option>`).join("")}</select></label>
      <label class="pir"><span>Line style</span><select data-vls>${IS_LS.map(([a, b]) => `<option value="${a}" ${String(s.maLs ?? 0) === a ? "selected" : ""}>${b}</option>`).join("")}</select></label>`;
  }
  if(r.cfg.type !== "pine") return `<div class="muted" style="padding:8px 0">This indicator draws in the chart's own up / down colours (Chart settings ⚙).</div>`;
  const P = r.pine || {}, R = P.raw;
  if(!R) return `<div class="muted" style="padding:8px 0">${P.err ? "The script didn't run, so there's nothing to style yet." : "Calculating…"}</div>`;
  const S = (isItem() || {}).style || {};
  const sw = (grp, name, cols) => cols.map(c => { const o = ((S[grp] || {})[name] || {}).colors || {}, now = o[c] || c;
    return `<button class="is-cbtn" data-sc="${pesc(grp)}" data-sn="${pesc(name)}" data-so="${c}" title="Colour">${isSw(now)}</button>`; }).join("");
  const on = (grp, name) => `<input type="checkbox" data-son="${pesc(grp)}" data-sn="${pesc(name)}" ${((S[grp] || {})[name] || {}).off ? "" : "checked"}>`;
  let h = "";
  if(R.plots.length) h += `<div class="pig">Plots</div>`;
  for(const p of R.plots){
    const o = (S.plots || {})[p.name] || {}, type = o.type || (p.st && p.st !== "line" ? (p.st.startsWith("style_") ? p.st : "style_" + p.st) : "style_line");
    const types = PLOT_TYPES.some(x => x[0] === type) ? PLOT_TYPES : [...PLOT_TYPES, [type, type.replace("style_", "")]];
    h += `<div class="is-plot"><div class="pir"><span class="is-pn">${on("plots", p.name)} ${pesc(p.title)}</span><span class="pinc">${sw("plots", p.name, p.colors.length ? p.colors : [PINE_BLUE + "FF"])}</span></div>
      <div class="is-sub">
        <select data-sty="type" data-sn="${pesc(p.name)}" title="Plot type">${types.map(([a, b]) => `<option value="${a}" ${a === type ? "selected" : ""}>${b}</option>`).join("")}</select>
        <select data-sty="width" data-sn="${pesc(p.name)}" title="Line width">${[1, 2, 3, 4].map(w => `<option value="${w}" ${+(o.width || p.width || 1) === w ? "selected" : ""}>${w} px</option>`).join("")}</select>
        <select data-sty="ls" data-sn="${pesc(p.name)}" title="Line style">${IS_LS.map(([a, b]) => `<option value="${a}" ${String(o.ls != null ? o.ls : LSTYLE(p.ls)) === a ? "selected" : ""}>${b}</option>`).join("")}</select>
        <label title="A horizontal line at the latest value"><input type="checkbox" data-sty="pl" data-sn="${pesc(p.name)}" ${o.pl ? "checked" : ""}> Price line</label>
      </div></div>`;
  }
  if(R.hlines.length){ h += `<div class="pig">Levels (hline)</div>`;
    for(const p of R.hlines){ const o = (S.hlines || {})[p.name] || {};
      h += `<div class="is-plot"><div class="pir"><span class="is-pn">${on("hlines", p.name)} ${pesc(p.name)}</span><span class="pinc">${sw("hlines", p.name, [isHex(p.color)])}</span></div>
        <div class="is-sub"><select data-hst="width" data-sn="${pesc(p.name)}">${[1, 2, 3, 4].map(w => `<option value="${w}" ${+(o.width || p.width) === w ? "selected" : ""}>${w} px</option>`).join("")}</select>
        <select data-hst="ls" data-sn="${pesc(p.name)}">${IS_LS.map(([a, b]) => `<option value="${a}" ${String(o.ls != null ? o.ls : LSTYLE(p.ls)) === a ? "selected" : ""}>${b}</option>`).join("")}</select></div></div>`; } }
  const simple = (grp, title) => { if(!R[grp].length) return;
    h += `<div class="pig">${title}</div>` + R[grp].map(p => `<div class="pir"><span class="is-pn">${on(grp, p.name)} ${pesc(p.title)}</span><span class="pinc">${sw(grp, p.name, p.colors)}</span></div>`).join(""); };
  simple("fills", "Fills"); simple("bg", "Backgrounds"); simple("shapes", "Shapes"); simple("barcolor", "Bar colours");
  const prec = S.prec ?? "";
  h += `<div class="pig">Output</div>
    <label class="pir"><span>Precision</span><select data-g="prec"><option value="" ${prec === "" ? "selected" : ""}>Default</option>${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}" ${String(prec) === String(n) ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <label class="pir"><span>Labels on the price scale</span><input type="checkbox" data-g="lbl" ${S.lbl === false ? "" : "checked"}></label>
    <label class="pir"><span>Values in the status line</span><input type="checkbox" data-g="sv" ${S.sv === false ? "" : "checked"}></label>
    <label class="pir"><span>Inputs in the status line</span><input type="checkbox" data-g="inl" ${S.inl === false ? "" : "checked"}></label>`;
  const hasDraw = Object.keys((P.res && P.res.drawings) || {}).some(k => (P.res.drawings[k] || []).length);
  if(hasDraw) h += `<div class="muted" style="font-size:11.5px;margin-top:10px">Lines, labels and boxes the script draws take their colours and widths from its own inputs (Inputs tab), as on TradingView.</div>`;
  return h;
}

/* ------------------------------------------------------------------ Visibility */
function isVisTab(r){
  const v = (isItem() || {}).vis || {};
  return `<div class="muted" style="font-size:12px;margin:6px 0 4px">Show this indicator on these timeframes:</div>` + VIS_UNITS.map(([u, label, lo, hi]) => {
    const x = v[u] || [true, lo, hi];
    return `<div class="pir is-vis"><label class="is-pn"><input type="checkbox" data-vu="${u}" data-k="0" ${x[0] ? "checked" : ""}> ${label}</label>
      <span class="pinc"><input type="number" data-vu="${u}" data-k="1" min="${lo}" max="${hi}" value="${x[1]}"> – <input type="number" data-vu="${u}" data-k="2" min="${lo}" max="${hi}" value="${x[2]}"></span></div>`;
  }).join("") + `<div class="muted" style="font-size:11.5px;margin-top:8px">Now: ${pesc(tf)} · ${indVisOn((isItem() || {}), tf) ? "shown" : "hidden on this timeframe"}</div>`;
}

/* ------------------------------------------------------------------ wiring */
function isWire(box, r){
  const pine = r.cfg.type === "pine", P = r.pine || {}, meta = P.meta || [];
  const keyOf = m => m.title || m.name || m.varId || m.id;
  // Pine inputs
  box.querySelectorAll("[data-n]").forEach(inp => inp.addEventListener("change", () => {
    const m = meta[+inp.dataset.n], k = keyOf(m);
    let v = inp.type === "checkbox" ? inp.checked : inp.value;
    if(m.type === "int") v = Math.round(+v); else if(m.type === "float" || m.type === "price") v = +v;
    if(m.type === "int" || m.type === "float"){ if(m.minval != null && v < m.minval) v = m.minval; if(m.maxval != null && v > m.maxval) v = m.maxval; }
    isSave(it => { it.inputs = {...(it.inputs || {}), [k]: v}; }, (r2, it) => isRefresh(r2, it, "inputs"));
  }));
  box.querySelectorAll("[data-cn]").forEach(b => b.onclick = e => {
    const m = meta[+b.dataset.cn], k = keyOf(m), cur0 = (r.cfg.inputs || {})[k] ?? m.defval;
    isPop(b, isHex(cur0), c => { isSave(it => { it.inputs = {...(it.inputs || {}), [k]: c}; }, (r2, it) => isRefresh(r2, it, "inputs")); b.innerHTML = isSw(c); });
  });
  const tfSel = box.querySelector("[data-tf]"); if(tfSel) tfSel.onchange = () => isSave(it => { it.tf = tfSel.value; }, (r2, it) => isRefresh(r2, it, "inputs"));
  const gp = box.querySelector("[data-gaps]"); if(gp) gp.onchange = () => isSave(it => { it.gaps = gp.checked; }, (r2, it) => isRefresh(r2, it, "inputs"));
  const bs = box.querySelector("[data-bars]"); if(bs) bs.onchange = () => isSave(it => { it.bars = +bs.value; }, () => loadHistory());
  const up = box.querySelector("[data-upd]"); if(up) up.onchange = () => isSave(it => { if(up.value === "close") it.update = "close"; else delete it.update; });
  // built-in inputs
  box.querySelectorAll("[data-b]").forEach(inp => inp.addEventListener("change", () =>
    isSave(it => { it[inp.dataset.b] = inp.type === "checkbox" ? inp.checked : (+inp.value || 1); }, () => indBuild())));
  // Pine style
  const st = (fn, cb) => isSave(it => { it.style = it.style || {}; fn(it.style); }, (r2, it) => { isRefresh(r2, it, "style"); if(cb) cb(); });
  const one = (S, grp, name) => { S[grp] = S[grp] || {}; return S[grp][name] = S[grp][name] || {}; };
  box.querySelectorAll("[data-sc]").forEach(b => b.onclick = () => {
    const grp = b.dataset.sc, name = b.dataset.sn, orig = b.dataset.so, now = ((((isItem() || {}).style || {})[grp] || {})[name] || {}).colors || {};
    isPop(b, now[orig] || orig, c => { st(S => { const o = one(S, grp, name); o.colors = {...(o.colors || {}), [orig]: c}; }); b.innerHTML = isSw(c); });
  });
  box.querySelectorAll("[data-son]").forEach(c => c.onchange = () => st(S => { const o = one(S, c.dataset.son, c.dataset.sn); if(c.checked) delete o.off; else o.off = true; }));
  box.querySelectorAll("[data-sty]").forEach(c => c.onchange = () => st(S => { const o = one(S, "plots", c.dataset.sn), k = c.dataset.sty;
    if(k === "pl") o.pl = c.checked; else if(k === "type") o.type = c.value; else o[k] = +c.value; }));
  box.querySelectorAll("[data-hst]").forEach(c => c.onchange = () => st(S => { one(S, "hlines", c.dataset.sn)[c.dataset.hst] = +c.value; }));
  box.querySelectorAll("[data-g]").forEach(c => c.onchange = () => st(S => { const k = c.dataset.g;
    if(k === "prec"){ if(c.value === "") delete S.prec; else S.prec = +c.value; } else { if(c.checked) delete S[k]; else S[k] = false; } }));
  // Volume style
  box.querySelectorAll("[data-vc]").forEach(b => b.onclick = () => {
    const k = b.dataset.vc, it0 = isItem() || {}, s = it0.style || {}, C = chartCfg();
    const now = k === "ma" ? (it0.maColor || IND_TYPES.volume.defaults.maColor) : s[k] || isHex(k === "up" ? C.up : C.down).slice(0, 7) + "73";
    isPop(b, isHex(now), c => { isSave(it => { if(k === "ma") it.maColor = c; else { it.style = it.style || {}; it.style[k] = c; } }, () => indBuild()); b.innerHTML = isSw(c); });
  });
  const vw = box.querySelector("[data-vw]"); if(vw) vw.onchange = () => isSave(it => { it.style = {...(it.style || {}), maWidth: +vw.value}; }, () => indBuild());
  const vls = box.querySelector("[data-vls]"); if(vls) vls.onchange = () => isSave(it => { it.style = {...(it.style || {}), maLs: +vls.value}; }, () => indBuild());
  // Visibility
  box.querySelectorAll("[data-vu]").forEach(c => c.onchange = () => isSave(it => {
    const u = c.dataset.vu, def = VIS_UNITS.find(x => x[0] === u), v = it.vis = it.vis || {}, x = v[u] = v[u] || [true, def[2], def[3]];
    if(c.dataset.k === "0") x[0] = c.checked; else x[+c.dataset.k] = Math.max(def[2], Math.min(def[3], Math.round(+c.value) || def[2]));
    if(x[1] > x[2]) [x[1], x[2]] = [x[2], x[1]];
    if(VIS_UNITS.every(([k, , lo, hi]) => !v[k] || (v[k][0] && +v[k][1] === lo && +v[k][2] === hi))) delete it.vis;
  }, () => { indBuild(); setTimeout(isDraw, 50); }));
}

/* a colour with its opacity: the picker, an opacity slider and the hex code */
function isPopClose(){ const p = isq("#isPop"); if(p) p.remove(); }
function isPop(anchor, hex8, onPick){
  isPopClose();
  const h = isHex(hex8), rgb = h.slice(0, 7), a = Math.round(parseInt(h.slice(7, 9), 16) / 2.55);
  const p = document.createElement("div"); p.id = "isPop";
  p.innerHTML = `<input type="color" value="${rgb.toLowerCase()}"><label>Opacity <input type="range" min="0" max="100" value="${a}"><span>${a}%</span></label><input type="text" value="${h}" spellcheck="false">`;
  document.body.append(p);
  const rc = anchor.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(innerWidth - p.offsetWidth - 8, rc.left)) + "px";
  p.style.top = (rc.bottom + p.offsetHeight + 8 > innerHeight ? rc.top - p.offsetHeight - 6 : rc.bottom + 6) + "px";
  const [col, rng, txt] = [p.querySelector("[type=color]"), p.querySelector("[type=range]"), p.querySelector("[type=text]")];
  const val = () => (col.value + Math.round(rng.value * 2.55).toString(16).padStart(2, "0")).toUpperCase();
  const pick = () => { p.querySelector("span").textContent = rng.value + "%"; txt.value = val(); onPick(val()); };
  col.onchange = pick; rng.oninput = () => { p.querySelector("span").textContent = rng.value + "%"; }; rng.onchange = pick;
  txt.onchange = () => { const x = isHex(txt.value); col.value = x.slice(0, 7).toLowerCase(); rng.value = Math.round(parseInt(x.slice(7, 9), 16) / 2.55); pick(); };
  setTimeout(() => document.addEventListener("pointerdown", function off(e){ if(!p.contains(e.target) && e.target !== anchor){ isPopClose(); document.removeEventListener("pointerdown", off); } }), 0);
}
