/* Pine Script on the chart: your script library (saved on the server), the Pine Editor, and running
   scripts with PineTS in a Web Worker. Drawn with Lightweight Charts series, price lines and primitives.
   Hooks used by the page (index.html): pineBuild, pineRun, pineTick, pineLegendParts, pineVisible, pineLayout, pineCleanup. */

const PINE_BARS = 1500;                      // bars each script sees (the latest ones on the chart)
const PINE = {scripts: [], loaded: false, loading: null};
const pq = s => document.querySelector(s);
const pesc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ------------------------------------------------------------------ library */
async function pineLoad(force){
  if(PINE.loaded && !force) return PINE.scripts;
  if(!PINE.loading) PINE.loading = api("/api/scripts").then(j => { if(j.ok){ PINE.scripts = j.scripts || []; PINE.loaded = true; } PINE.loading = null; return PINE.scripts; });
  return PINE.loading;
}
function pineScript(id){ return PINE.scripts.find(s => s.id === id); }
function pineTitleOf(src){ const m = /^\s*(?:indicator|study)\s*\(\s*(?:title\s*=\s*)?(["'])(.*?)\1/m.exec(src || ""); return m ? m[2] : ""; }
function pineGuessOverlay(src){ return /^\s*(?:indicator|study)\s*\([\s\S]*?\boverlay\s*=\s*true/m.test(src || ""); }

/* ------------------------------------------------------------------ the worker */
let pineW = null, pineSeq = 0;
const pineWait = {};
function pineWorker(){
  if(pineW) return pineW;
  pineW = new Worker("/static/pine_worker.js?v=" + (window.APP_V || ""), {type: "module"});
  pineW.onmessage = e => {
    const d = e.data || {};
    if(d.need){ pineNeed(d.need).then(c => { try{ pineW && pineW.postMessage({data: {id: d.need.id, candles: c}}); }catch(x){} }); return; }
    const w = pineWait[d.id]; if(w){ delete pineWait[d.id]; clearTimeout(w.timer); w.resolve(d); }
  };
  pineW.onerror = e => { const m = (e && e.message) || "the script engine failed to start"; pineReset(m); };
  return pineW;
}
function pineReset(why){
  try{ pineW && pineW.terminate(); }catch(e){}
  pineW = null;
  for(const k of Object.keys(pineWait)){ clearTimeout(pineWait[k].timer); pineWait[k].resolve({ok: false, error: why}); delete pineWait[k]; }
}
function pineExec(msg, limitMs = 20000){
  return new Promise(resolve => {
    const id = ++pineSeq;
    const timer = setTimeout(() => {             // an endless loop: stop the engine and start a fresh one
      delete pineWait[id]; resolve({ok: false, error: `stopped after ${limitMs / 1000} s (an endless loop, or too much work per bar?)`});
      pineReset("stopped: another script ran too long");
    }, limitMs);
    pineWait[id] = {resolve, timer};
    try{ pineWorker().postMessage({...msg, id}); }catch(e){ clearTimeout(timer); delete pineWait[id]; resolve({ok: false, error: String(e.message || e)}); }
  });
}
/* the chart's timeframe in Pine's terms: 5m -> "5", 2h -> "120", 1D -> "D", 3D -> "3D", 1W -> "W" */
function pineTf(k){
  const t = parseTf(k || tf) || parseTf("5m");
  if(t.min) return String(t.min);
  return (t.n > 1 ? t.n : "") + t.u;
}
/* Pine's timeframe -> ours ("15" -> "15m", "60" -> "1h", "D" -> "1D") */
function pineTfKey(p){
  const m = /^(\d*)([SDWM]?)$/i.exec(String(p || "").trim()); if(!m) return null;
  const n = +(m[1] || 1), u = (m[2] || "").toUpperCase();
  if(!u) return n % 60 === 0 && n >= 60 ? (n / 60) + "h" : n + "m";
  if(u === "S") return null;
  return n + u;
}
function pineInfo(){
  const r = (cur && sym[cur.s]) || {}, s = cur ? cur.s : "X", tk = s.split(":").pop();
  return {ticker: tk, tickerid: s, prefix: s.split(":")[0], root: r.u || tk, description: r.d || tk, type: r.f === "OPT" ? "option" : r.f === "FUT" ? "futures" : "stock",
    timezone: "Asia/Kolkata", mintick: (cur && cur.tick) || r.tick || 0.05, minmove: 1, pricescale: Math.round(1 / ((cur && cur.tick) || 0.05)), pointvalue: r.mult || 1,
    currency: "INR", country: "IN", session: r.sess || "", current_contract: s, main_tickerid: s, isin: "", basecurrency: "", mincontract: r.lot || 1, volumetype: "base"};
}
/* request.security(): other timeframes (and symbols) come from the helper, built the same way as the chart's own */
const pineCache = {};
async function pineNeed(n){
  const key = pineTfKey(n.tf), plan = key && tfPlan(key);
  if(!plan || !cur) return [];
  let s = String(n.ticker || "");
  if(!s || s.split(":").pop().toUpperCase() === cur.s.split(":").pop().toUpperCase()) s = cur.s;
  else if(!s.includes(":")) s = cur.s.split(":")[0] + ":" + s;
  const ck = s + "|" + key, hit = pineCache[ck];
  let bars;
  if(hit && Date.now() - hit.at < 60000) bars = hit.bars;
  else {
    const j = await api(`/api/history?symbol=${encodeURIComponent(s)}&res=${plan.res}&days=${plan.days}`);
    if(!j.ok) return [];
    bars = (j.candles || []).map(c => ({time: c[0] + 19800, open: c[1], high: c[2], low: c[3], close: c[4], vol: c[5] || 0}));
    if(plan.agg){ const out = [];
      for(const b of bars){ const k = bucket(b.time, plan), o = out[out.length - 1];
        if(!o || o.time !== k) out.push({...b, time: k}); else { o.high = Math.max(o.high, b.high); o.low = Math.min(o.low, b.low); o.close = b.close; o.vol += b.vol; } }
      bars = out; }
    pineCache[ck] = {at: Date.now(), bars};
  }
  bars = bars.map(b => ({...b}));
  const L = bars[bars.length - 1];             // keep the live higher-timeframe bar up to date with the chart's price
  if(s === cur.s && L && lastBar && lastBar.time >= L.time && lastBar.time < L.time + plan.sec){
    L.close = lastBar.close; L.high = Math.max(L.high, lastBar.high); L.low = Math.min(L.low, lastBar.low); }
  return bars.map(b => ({open: b.open, high: b.high, low: b.low, close: b.close, volume: b.vol, openTime: (b.time - 19800) * 1000, closeTime: (b.time - 19800 + plan.sec) * 1000 - 1}));
}
/* the chart's bar i (DISP) as Pine sees it. Every chart type gives Pine ordinary bars, so every script and every
   Pine feature works on all of them (owner's rule: P&F included):
   - bars that don't follow the clock (Renko, range, line break, P&F) close when the next one opens, so
     request.security(), time and session functions line up with them;
   - P&F: `close` is the column's middle by default (du Plessis' convention for indicators on P&F), or its last box
     (chart type menu); open / high / low are the column's own. */
function pineBar(d, i){
  const b = d[i], ms = (b.time - 19800) * 1000, t = ctType();
  let closeTime = ms + tfPlan(tf).sec * 1000 - 1;
  if(!CT.timeBased(t)) closeTime = i + 1 < d.length ? (d[i + 1].time - 19800) * 1000 - 1 : Math.max(closeTime, Date.now());
  const close = t === "pf" && ctCfg().pfInd !== "last" ? (b.high + b.low) / 2 : b.close;
  return {open: b.open, high: b.high, low: b.low, close, volume: volData[b.time] || 0, openTime: ms, closeTime};
}
function pineCandles(maxBars){
  const d = series ? dispBars() : [], n = Math.min(d.length, maxBars || PINE_BARS), off = d.length - n;
  const candles = [], times = [];
  for(let i = off; i < d.length; i++){ candles.push(pineBar(d, i)); times.push(d[i].time); }
  return {candles, times, off};
}

/* ------------------------------------------------------------------ colours */
function pcol(c, dflt){
  if(c == null || c === "" || typeof c !== "string") return dflt;
  const m = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})?$/i.exec(c);
  if(!m || !m[4]) return c;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${(parseInt(m[4], 16) / 255).toFixed(3)})`;
}
function palpha(css, a){
  const m = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(css || "");
  if(m) return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
  const r = /rgba?\(([^,]+),([^,]+),([^,)]+)(?:,([^)]+))?\)/.exec(css || "");
  return r ? `rgba(${r[1]},${r[2]},${r[3]},${(r[4] != null ? +r[4] : 1) * a})` : css;
}
const PINE_BLUE = "#2962FF";

/* ------------------------------------------------------------------ on the chart */
/* called by indBuild for {type:"pine"} entries: decides the pane, makes an anchor series for the pane's drawings */
function pineBuild(r){
  const sc = pineScript(r.cfg.scriptId);
  r.overlay = r.cfg.overlay != null ? !!r.cfg.overlay : pineGuessOverlay(sc && sc.source);
  r.pane = r.overlay ? 0 : chart.panes().length;
  r.pine = {series: {}, hl: [], err: sc ? null : (PINE.loaded ? "script not found - deleted from your library?" : null), title: sc ? (pineTitleOf(sc.source) || sc.name) : "Pine script", meta: null};
  r.anchor = chart.addSeries(LightweightCharts.LineSeries, {lineVisible: false, pointMarkersVisible: false, crosshairMarkerVisible: false,
    lastValueVisible: false, priceLineVisible: false, autoscaleInfoProvider: () => pineAutoscale(r)}, r.pane);
  r.series.push(r.anchor);
  r.prim = new PineDraw(r, "own");
  r.anchor.attachPrimitive(r.prim);
  if(!r.overlay){                              // force_overlay drawings / plots go on the candles
    r.anchor0 = chart.addSeries(LightweightCharts.LineSeries, {lineVisible: false, pointMarkersVisible: false, crosshairMarkerVisible: false,
      lastValueVisible: false, priceLineVisible: false}, 0);
    r.series.push(r.anchor0);
    r.prim0 = new PineDraw(r, "main");
    r.anchor0.attachPrimitive(r.prim0);
  }
  r.tbl = document.createElement("div"); r.tbl.className = "pine-tbls"; pq("#chart").append(r.tbl);
  r.cleanup = () => { r.tbl && r.tbl.remove(); r.dead = true; if(r.pine && r.pine.sid) pineDrop(r.pine.sid); clearTimeout(r.pine && r.pine.tickTimer); };
}
function pineCleanup(r){ if(r.cleanup) r.cleanup(); }
/* hlines and drawings count in the pane's price range (otherwise an hline-only pane has no scale) */
function pineMerge(a, extra){
  if(!extra || !extra.length) return a;
  const lo = Math.min(...extra), hi = Math.max(...extra);
  if(!a || !a.priceRange) return {priceRange: {minValue: lo, maxValue: hi}};
  return {...a, priceRange: {minValue: Math.min(a.priceRange.minValue, lo), maxValue: Math.max(a.priceRange.maxValue, hi)}};
}
function pineAutoscale(r){
  const P = r.pine; if(!P || !P.res) return null;
  let lo = Infinity, hi = -Infinity; const add = v => { if(v != null && isFinite(v)){ lo = Math.min(lo, v); hi = Math.max(hi, v); } };
  if(!r.overlay){ for(const h of P.hlv || []) add(h); for(const v of P.dys || []) add(v); }
  return lo <= hi ? {priceRange: {minValue: lo, maxValue: hi}} : null;
}

/* full run: the whole history once (also after a new bar, to rebuild drawings exactly) */
let pineGen = 0;
async function pineRun(r){
  const P = r.pine; if(!P || r.dead || !series || !cur || r.cfg.hidden) return;
  if(!PINE.loaded){ await pineLoad(); if(r.dead) return; }
  const sc = pineScript(r.cfg.scriptId);
  if(!sc){ P.err = "script not found - deleted from your library?"; legendFill(null); return; }
  if(!P.res) P.title = pineTitleOf(sc.source) || sc.name;     // built before the library had loaded
  if(P.running){ P.dirty = true; return; }
  const {candles} = pineCandles(+r.cfg.bars || PINE_BARS);
  if(!candles.length) return;
  P.running = true; P.dirty = false; P.lastRun = Date.now(); P.calc = true;
  if(P.sid) pineDrop(P.sid);
  const sid = P.sid = r.cfg.id + ":" + (++pineGen);
  const res = await pineExec({op: "run", sid, code: sc.source, inputs: r.cfg.inputs || {}, candles, ticker: cur.s, tf: pineTf(), info: pineInfo()}, 120000);
  P.running = false; P.calc = false;
  if(r.dead || r.pine !== P){ pineDrop(sid); return; }
  if(res.inputs && res.inputs.length) P.meta = res.inputs;
  if(!res.ok){ P.err = res.error + (res.line ? ` (line ${res.line})` : ""); P.sid = null; }
  else { P.err = null; P.ms = res.ms; pineTimes(P, res); pineApply(r, res, sc); }
  legendFill(null);
  if(P.dirty) setTimeout(() => pineRun(r), 50);
  else if(P.tickDirty) setTimeout(() => pineTick(r), 0);
}
function pineDrop(sid){ try{ pineW && pineW.postMessage({op: "drop", sid}); }catch(e){} }
/* the bars the worker ran on -> chart times and their place on the chart */
function pineTimes(P, res){
  P.times = (res.times || []).map(ms => Math.round(ms / 1000) + 19800);
  P.n = P.times.length;
  const d = dispBars(), t0 = P.times[0];
  let lo = 0, hi = d.length - 1;
  while(lo < hi){ const m = (lo + hi) >> 1; if(d[m].time < t0) lo = m + 1; else hi = m; }
  P.off = d.length && d[lo].time === t0 ? lo : Math.max(0, d.length - P.n);
}
/* live price: only the live bar is re-run (TradingView's way), so even long histories update in milliseconds.
   A heavy last-bar calculation (like an analysis on barstate.islast) sets the pace: at most every 2 x its time. */
async function pineTick(r){
  const P = r.pine; if(!P || r.dead || r.cfg.hidden || !series) return;
  if(!P.sid || !P.res){ if(!P.running) pineRun(r); return; }
  if(r.cfg.update === "close"){                 // "on candle close": one full run per new bar, nothing in between
    const d = dispBars();
    if(d.length && d[d.length - 1].time > P.times[P.n - 1] && !P.running) pineRun(r);
    return;
  }
  if(P.running || P.ticking){ P.tickDirty = true; return; }
  const gap = Math.max(250, 2 * (P.tms || 0)), wait = gap - (Date.now() - (P.lastTick || 0));
  if(wait > 0){ if(!P.tickTimer) P.tickTimer = setTimeout(() => { P.tickTimer = null; pineTick(r); }, wait); return; }
  const last = P.times[P.n - 1], d = dispBars(), bars = [];
  for(let i = d.length - 1; i >= 0 && d[i].time >= last; i--) bars.unshift(pineBar(d, i));
  if(!bars.length){ pineRun(r); return; }
  P.ticking = true; P.tickDirty = false; P.lastTick = Date.now();
  const res = await pineExec({op: "tick", sid: P.sid, bars}, 30000);
  P.ticking = false;
  if(r.dead || r.pine !== P) return;
  if(!res.ok){ if(res.stale){ P.sid = null; pineRun(r); } return; }
  P.tms = res.ms;
  const sc = pineScript(r.cfg.scriptId); if(!sc) return;
  pineTimes(P, res); pineApply(r, res, sc);
  if(!legendHover) legendFill(null);
  if(res.newBar) setTimeout(() => pineRun(r), 30);          // rebuild drawings exactly once per new bar
  else if(P.tickDirty) setTimeout(() => pineTick(r), 0);
}

const PLOT_KIND = st => /histogram|columns/.test(st) ? "hist" : /area/.test(st) ? "area" : st === "candle" || st === "bar" ? "candle" : "line";
function pineApply(r, res, sc){
  const P = r.pine, ind = res.indicator || {};
  const ov = !!ind.overlay;
  if(ov !== r.overlay){                        // the script says otherwise: remember it and rebuild the panes
    const l = indList(), it = l.find(x => x.id === r.cfg.id);
    if(it){ it.overlay = ov; indSave(l); }
    setTimeout(indBuild, 0); return;
  }
  P.res = res; P.ind = ind; P.title = ind.shorttitle || ind.title || sc.name;
  const tickDp = (String((cur && cur.tick) || 0.05).split(".")[1] || "").length;
  const pm = /^\s*(?:indicator|study)\s*\([\s\S]*?\bprecision\s*=\s*(\d+)/m.exec(sc.source || "");   // only when the script sets it
  P.prec = pm ? Math.min(8, +pm[1]) : (r.overlay ? tickDp : null);
  const pf = P.prec != null ? {type: "price", precision: P.prec, minMove: Math.pow(10, -P.prec)} : {type: "price", precision: 2, minMove: 0.01};
  P.idx = new Map(P.times.map((t, i) => [t, i]));
  const tm = ms => Math.round(ms / 1000) + 19800;
  P.vals = {}; P.cols = {}; P.order = []; P.shapes = []; P.bg = []; P.fills = []; P.hlv = []; P.hmap = {};
  const keep = new Set();
  let barc = null;
  // hlines first (fills can refer to them)
  for(const [owner, h] of P.hl) try{ owner.removePriceLine(h); }catch(e){}
  P.hl = []; const hspec = [];
  for(const [name, p] of Object.entries(res.plots || {})){
    const o = p.options || {}, st = String(o.style || "line");
    const vals = new Array(P.n).fill(null), cols = new Array(P.n).fill(undefined), opts = new Array(P.n).fill(null);
    for(const d of p.data || []){ const i = P.idx.get(tm(d[0])); if(i == null) continue; vals[i] = d[1]; cols[i] = d[2]; if(d[3]) opts[i] = d[3]; }
    P.vals[name] = vals; P.cols[name] = cols;
    const hidden = o.display === "none" || o.display === "data_window";
    if(st === "hline"){
      let v = null; for(let i = vals.length - 1; i >= 0 && v == null; i--) if(vals[i] != null && isFinite(vals[i])) v = +vals[i];
      P.hmap[name] = v;
      if(v != null && !hidden){ P.hlv.push(v);
        const ls = String(o.linestyle || "dashed");
        hspec.push({price: v, color: pcol(o.color, "#787B86"), lineWidth: +o.linewidth || 1, lineStyle: /dott/.test(ls) ? 1 : /solid/.test(ls) ? 0 : 2,
          axisLabelVisible: false, lineVisible: true, title: ""}); }
      continue;
    }
    if(st === "fill"){ if(!hidden) P.fills.push({a: o.plot1, b: o.plot2, color: o.color, cols}); continue; }
    if(st === "background"){ if(!hidden) P.bg.push({color: o.color, cols}); continue; }
    if(st === "barcolor"){ if(!hidden) barc = cols; continue; }
    if(FULL_SHAPE.test(st)){ if(!hidden) P.shapes.push({o, vals, cols, opts}); continue; }
    if(st === "label" || /^drawing_|^table|^linefill/.test(st)) continue;
    if(hidden) continue;
    const kind = PLOT_KIND(st), color = pcol(o.color, PINE_BLUE), lw = Math.max(1, Math.min(4, +o.linewidth || 1));
    const base = {title: "", visible: true, lastValueVisible: true, priceLineVisible: false, priceFormat: pf,
      autoscaleInfoProvider: r.overlay ? undefined : orig => pineMerge(orig(), [...(P.hlv || []), ...(P.dys || [])])};
    let opt;
    if(kind === "line"){
      const dots = /circles|cross/.test(st);
      opt = {...base, color, lineWidth: lw, lineType: /step/.test(st) ? 1 : 0, lineVisible: !dots, pointMarkersVisible: dots, pointMarkersRadius: dots ? lw + 1 : undefined, crosshairMarkerVisible: !dots};
    } else if(kind === "hist") opt = {...base, color, base: +o.histbase || 0};
    else if(kind === "area") opt = {...base, lineColor: color, topColor: palpha(color, 0.35), bottomColor: palpha(color, 0.03), lineWidth: lw};
    else opt = {...base, upColor: color, downColor: color, wickUpColor: pcol(o.wickcolor, color), wickDownColor: pcol(o.wickcolor, color), borderVisible: true,
      borderUpColor: pcol(o.bordercolor, color), borderDownColor: pcol(o.bordercolor, color)};
    const fo = !!o.force_overlay && !r.overlay;
    if(fo){ delete opt.autoscaleInfoProvider; opt.priceFormat = {type: "price", precision: tickDp, minMove: Math.pow(10, -tickDp)}; }
    const api = pineSeries(r, name, kind, opt, fo ? 0 : r.pane);
    keep.add(name); P.order.push({name, color, kind, legend: !/^(pane|none|data_window)$/.test(String(o.display || "all"))});
    const out = [], gaps = /br$/.test(st) || kind !== "line";
    for(let i = 0; i < P.n; i++){
      const t = P.times[i], v = vals[i], c = cols[i];
      if(kind === "candle"){
        if(Array.isArray(v) && v.every(x => x != null && isFinite(x))) out.push({time: t, open: v[0], high: v[1], low: v[2], close: v[3], ...(c ? {color: pcol(c), borderColor: pcol(c), wickColor: pcol(c)} : {})});
        else out.push({time: t});
        continue;
      }
      const bad = v == null || typeof v !== "number" || !isFinite(v);
      if(bad || c === null){ if(gaps || c === null) out.push({time: t}); continue; }
      const pt = {time: t, value: v};
      if(c !== undefined){ const cc = pcol(c, color); if(kind === "area") pt.lineColor = cc; else pt.color = cc; }
      out.push(pt);
    }
    try{ api.setData(out); }catch(e){ console.warn("pine plot", name, e); }
  }
  for(const [name, s] of Object.entries(P.series)) if(!keep.has(name)){ try{ chart.removeSeries(s.api); }catch(e){} r.series = r.series.filter(x => x !== s.api); delete P.series[name]; }
  // barcolor: a second candle series over the chart's own, carrying only the coloured bars
  if(barc && r.overlay && CT.ohlc(ctType())){           // (no candles to colour on a line / area chart)
    const api = pineSeries(r, "__barcolor__", "candle", {visible: true, lastValueVisible: false, priceLineVisible: false, borderVisible: true});
    const byT = new Map(dispBars().map(b => [b.time, b]));
    api.setData(P.times.map((t, i) => { const b = byT.get(t), c = barc[i]; return b && c ? {time: t, open: b.open, high: b.high, low: b.low, close: b.close, color: pcol(c), borderColor: pcol(c), wickColor: pcol(c)} : {time: t}; }));
  } else if(P.series.__barcolor__){ try{ chart.removeSeries(P.series.__barcolor__.api); }catch(e){} delete P.series.__barcolor__; }
  P.draw = res.drawings || {};
  // drawings convert prices with a series that has data: the candles (overlay), else the pane's first plot,
  // else the anchor, which then carries an invisible value so the pane has a scale (hlines / drawings only)
  const ys = []; const D = P.draw;   // (the _overlay sets are on the candles, not in this pane's range)
  for(const l of D.__lines__ || []) ys.push(l.y1, l.y2);
  for(const b of D.__boxes__ || []) ys.push(b.top, b.bottom);
  for(const l of D.__labels__ || []) ys.push(l.y);
  for(const pl of D.__polylines__ || []) for(const q of pl.points || []) ys.push(q.price);
  P.dys = ys.filter(v => v != null && isFinite(v));
  const first = Object.entries(P.series).find(([k, x]) => k !== "__barcolor__" && x.pane === r.pane);
  P.yref = r.overlay ? series : first ? first[1].api : r.anchor;
  const v0 = !r.overlay && !first ? (P.hlv[0] ?? P.dys[0] ?? null) : null;
  try{ r.anchor.setData(P.times.map(t => v0 == null ? {time: t} : {time: t, value: v0})); }catch(e){}
  if(r.anchor0) try{ r.anchor0.setData(P.times.map(t => ({time: t}))); }catch(e){}
  for(const h of hspec){ try{ P.hl.push([P.yref, P.yref.createPriceLine(h)]); }catch(e){} }   // price lines need a series with data
  r.prim.update(); r.prim0 && r.prim0.update();
  pineTables(r);
}
const FULL_SHAPE = /shape|char|arrow/;
function pineSeries(r, name, kind, opt, pane){
  const P = r.pine; let s = P.series[name];
  pane = pane == null ? r.pane : pane;
  if(s && (s.kind !== kind || s.pane !== pane)){ try{ chart.removeSeries(s.api); }catch(e){} r.series = r.series.filter(x => x !== s.api); s = null; }
  if(!s){
    const T = {line: "LineSeries", hist: "HistogramSeries", area: "AreaSeries", candle: "CandlestickSeries"}[kind];
    const api = chart.addSeries(LightweightCharts[T], opt, pane);
    s = P.series[name] = {kind, api, pane}; r.series.push(api);
  } else s.api.applyOptions(opt);
  return s.api;
}

/* ------------------------------------------------------------------ drawings (a series primitive on the anchor) */
const PSIZE = {tiny: 9, small: 10.5, normal: 12, large: 15, huge: 20, auto: 11};
const SHAPE_PX = {tiny: 6, small: 9, normal: 12, large: 18, huge: 26, auto: 9};
class PineDraw {
  constructor(r, mode){ this.r = r; this.mode = mode || "own"; const self = this;
    this.views = [{zOrder: () => "bottom", renderer: () => ({draw: t => self.safe(t, "bg")})}, {zOrder: () => "top", renderer: () => ({draw: t => self.safe(t, "top")})}]; }
  attached(p){ this.req = p.requestUpdate; } detached(){ this.req = null; }
  update(){ this.req && this.req(); } updateAllViews(){} paneViews(){ return this.views; }
  safe(target, which){ try{ target.useMediaCoordinateSpace(s => this[which](s.context, s.mediaSize)); }catch(e){ console.warn("pine draw", e); } }
  env(){
    const r = this.r, P = r.pine, ts = chart.timeScale(), A = this.mode === "main" ? series : (P.yref || r.anchor), sec = tfPlan(tf).sec;
    const X = L => ts.logicalToCoordinate(L);
    const Y = p => p == null || !isFinite(p) ? null : A.priceToCoordinate(p);
    const tl = ms => {                          // a time (ms) -> logical index, beyond the last bar too
      const t = Math.round(ms / 1000) + 19800, T = P.times, n = T.length;
      if(!n) return null;
      if(t >= T[n - 1]) return P.off + n - 1 + (t - T[n - 1]) / sec;
      if(t <= T[0]) return P.off + (t - T[0]) / sec;
      let lo = 0, hi = n - 1; while(hi - lo > 1){ const m = (lo + hi) >> 1; if(T[m] <= t) lo = m; else hi = m; }
      return P.off + lo + (t - T[lo]) / Math.max(1, T[hi] - T[lo]);
    };
    const LX = (x, xloc) => x == null ? null : X(xloc === "bt" ? tl(x) : P.off + x);
    const vr = ts.getVisibleLogicalRange() || {from: 0, to: 0};
    const sp = Math.max(1, (X(P.off + 1) ?? 1) - (X(P.off) ?? 0));
    const bars = dispBars();
    return {P, X, Y, LX, tl, vr, sp, bars};
  }
  bg(ctx, size){
    const P = this.r.pine; if(!P || !P.res || this.r.cfg.hidden || this.mode === "main") return;
    const E = this.env(), {X, Y, vr, sp} = E;
    const i0 = Math.max(0, Math.floor(vr.from) - P.off - 1), i1 = Math.min(P.n - 1, Math.ceil(vr.to) - P.off + 1);
    for(const b of P.bg) for(let i = i0; i <= i1; i++){
      const c = b.cols[i] === undefined ? null : b.cols[i]; if(!c) continue;
      const x = X(P.off + i); if(x == null) continue;
      ctx.fillStyle = pcol(c); ctx.fillRect(Math.round(x - sp / 2), 0, Math.ceil(sp), size.height);
    }
    for(const f of P.fills){
      const va = this.series(f.a), vb = this.series(f.b); if(!va || !vb) continue;
      if(va.flat && vb.flat){ const ya = Y(va.v), yb = Y(vb.v); if(ya == null || yb == null) continue;
        ctx.fillStyle = pcol(f.color, "rgba(41,98,255,.1)"); ctx.fillRect(0, Math.min(ya, yb), size.width, Math.abs(ya - yb)); continue; }
      for(let i = Math.max(1, i0); i <= i1; i++){
        const a0 = va.at(i - 1), a1 = va.at(i), b0 = vb.at(i - 1), b1 = vb.at(i);
        if([a0, a1, b0, b1].some(v => v == null || !isFinite(v))) continue;
        const c = f.cols[i] === undefined ? f.color : f.cols[i]; if(!c) continue;
        const x0 = X(P.off + i - 1), x1 = X(P.off + i); if(x0 == null || x1 == null) continue;
        ctx.fillStyle = pcol(c, "rgba(41,98,255,.1)");
        ctx.beginPath(); ctx.moveTo(x0, Y(a0)); ctx.lineTo(x1, Y(a1)); ctx.lineTo(x1, Y(b1)); ctx.lineTo(x0, Y(b0)); ctx.closePath(); ctx.fill();
      }
    }
  }
  series(name){
    const P = this.r.pine;
    if(name in P.hmap) return P.hmap[name] == null ? null : {flat: true, v: P.hmap[name], at: () => P.hmap[name]};
    const v = P.vals[name]; return v ? {flat: false, at: i => v[i]} : null;
  }
  top(ctx, size){
    const P = this.r.pine; if(!P || !P.res || this.r.cfg.hidden) return;
    const E = this.env(), D0 = P.draw || {}, main = this.mode === "main";
    this.hits = [];
    // own pane: its drawings (plus the force_overlay ones when the script is on the candles anyway);
    // the candle pane of a pane script: only the force_overlay ones
    const pick = k => main ? (D0[`__${k}_overlay__`] || []) : [...(D0[`__${k}__`] || []), ...(this.r.overlay ? D0[`__${k}_overlay__`] || [] : [])];
    for(const b of pick("boxes")) this.box(ctx, size, E, b);
    for(const f of pick("linefills")) this.linefill(ctx, E, f);
    for(const l of pick("lines")) this.line(ctx, size, E, l);
    for(const pl of pick("polylines")) this.poly(ctx, E, pl);
    if(!main) this.shapes(ctx, size, E);
    for(const lb of pick("labels")) this.label(ctx, E, lb);
  }
  dash(ctx, st, w){ ctx.setLineDash(/dot/.test(st || "") ? [w, w * 2] : /dash/.test(st || "") ? [w * 4, w * 3] : []); }
  ends(E, x1, y1, x2, y2, ext, size){
    if(!ext || ext === "none" || ext === "n" || x1 === x2) return [x1, y1, x2, y2];
    const k = (y2 - y1) / (x2 - x1), at = x => y1 + k * (x - x1);
    if(/r|b/.test(ext)){ const xr = x2 >= x1 ? size.width : 0; x2 = xr; y2 = at(xr); }
    if(/l|b/.test(ext)){ const xl = x2 >= x1 ? 0 : size.width; x1 = xl; y1 = at(xl); }
    return [x1, y1, x2, y2];
  }
  line(ctx, size, E, l){
    let x1 = E.LX(l.x1, l.xloc), x2 = E.LX(l.x2, l.xloc), y1 = E.Y(l.y1), y2 = E.Y(l.y2);
    if([x1, x2, y1, y2].some(v => v == null || !isFinite(v))) return;
    [x1, y1, x2, y2] = this.ends(E, x1, y1, x2, y2, l.extend, size);
    const w = Math.max(1, +l.width || 1), c = pcol(l.color, PINE_BLUE);
    ctx.strokeStyle = c; ctx.lineWidth = w; this.dash(ctx, l.style, w);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
    const head = (xa, ya, xb, yb) => { const a = Math.atan2(yb - ya, xb - xa), s = 6 + w * 2; ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(xb, yb);
      ctx.lineTo(xb - s * Math.cos(a - 0.45), yb - s * Math.sin(a - 0.45)); ctx.lineTo(xb - s * Math.cos(a + 0.45), yb - s * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill(); };
    if(/arrow_right|arrow_both/.test(l.style || "")) head(x1, y1, x2, y2);
    if(/arrow_left|arrow_both/.test(l.style || "")) head(x2, y2, x1, y1);
  }
  linefill(ctx, E, f){
    const p = l => { const x1 = E.LX(l.x1, l.xloc), x2 = E.LX(l.x2, l.xloc), y1 = E.Y(l.y1), y2 = E.Y(l.y2); return [x1, y1, x2, y2].some(v => v == null || !isFinite(v)) ? null : [x1, y1, x2, y2]; };
    const a = p(f.line1), b = p(f.line2); if(!a || !b) return;
    ctx.fillStyle = pcol(f.color, "rgba(41,98,255,.15)");
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[2], a[3]); ctx.lineTo(b[2], b[3]); ctx.lineTo(b[0], b[1]); ctx.closePath(); ctx.fill();
  }
  poly(ctx, E, pl){
    const pts = (pl.points || []).map(q => { const x = pl.xloc === "bt" || q.index == null ? (q.time != null ? E.X(E.tl(q.time)) : null) : E.X(E.P.off + q.index); return [x, E.Y(q.price)]; })
      .filter(q => q[0] != null && q[1] != null && isFinite(q[0]) && isFinite(q[1]));
    if(pts.length < 2) return;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for(let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if(pl.closed) ctx.closePath();
    if(pl.fill_color){ ctx.fillStyle = pcol(pl.fill_color); ctx.fill(); }
    const w = Math.max(1, +pl.line_width || 1); ctx.strokeStyle = pcol(pl.line_color, PINE_BLUE); ctx.lineWidth = w; this.dash(ctx, pl.line_style, w); ctx.stroke(); ctx.setLineDash([]);
  }
  box(ctx, size, E, b){
    let x1 = E.LX(b.left, b.xloc), x2 = E.LX(b.right, b.xloc); const y1 = E.Y(b.top), y2 = E.Y(b.bottom);
    if([x1, x2, y1, y2].some(v => v == null || !isFinite(v))) return;
    if(/r|b/.test(b.extend || "") && b.extend !== "none") x2 = size.width;
    if(/l|b/.test(b.extend || "") && b.extend !== "none") x1 = 0;
    const L = Math.min(x1, x2), T = Math.min(y1, y2), W = Math.abs(x2 - x1), H = Math.abs(y2 - y1);
    if(b.bgcolor !== "" && b.bgcolor != null){ ctx.fillStyle = pcol(b.bgcolor); ctx.fillRect(L, T, W, H); }
    else { ctx.fillStyle = "rgba(41,98,255,.2)"; ctx.fillRect(L, T, W, H); }
    const bw = b.border_width == null ? 1 : +b.border_width;
    if(bw > 0){ ctx.strokeStyle = pcol(b.border_color, PINE_BLUE); ctx.lineWidth = bw; this.dash(ctx, b.border_style, bw); ctx.strokeRect(L, T, W, H); ctx.setLineDash([]); }
    if(b.text){
      const fs = PSIZE[b.text_size] || (b.text_size === "auto" ? Math.max(8, Math.min(14, H / 3)) : 11);
      ctx.font = `${fs}px IBM Plex Sans, sans-serif`; ctx.fillStyle = pcol(b.text_color, "#000");
      const ha = b.text_halign || "center", va = b.text_valign || "center", lines = String(b.text).split("\n");
      ctx.textAlign = ha === "left" ? "left" : ha === "right" ? "right" : "center"; ctx.textBaseline = "middle";
      const x = ha === "left" ? L + 4 : ha === "right" ? L + W - 4 : L + W / 2;
      const th = lines.length * fs * 1.2, y0 = va === "top" ? T + 3 + fs * 0.6 : va === "bottom" ? T + H - th - 3 + fs * 0.6 : T + H / 2 - th / 2 + fs * 0.6;
      ctx.save(); ctx.beginPath(); ctx.rect(L, T, W, H); ctx.clip(); lines.forEach((s, k) => ctx.fillText(s, x, y0 + k * fs * 1.2)); ctx.restore();
    }
  }
  barHL(E, L){ const b = E.bars[Math.round(L)]; return b ? [b.high, b.low] : [null, null]; }
  label(ctx, E, lb){
    const L = lb.xloc === "bt" ? E.tl(lb.x) : E.P.off + lb.x; if(L == null) return;
    const x = E.X(L); if(x == null) return;
    const [hi, lo] = this.barHL(E, L);
    const yl = lb.yloc || "pr", st = String(lb.style || "style_label_down").replace("style_", "").replace("lower_", "lower").replace("upper_", "upper");
    let y = yl === "ab" ? E.Y(hi) : yl === "bl" ? E.Y(lo) : E.Y(lb.y);
    if(y == null || !isFinite(y)) return;
    const bg = pcol(lb.color, PINE_BLUE), fs = PSIZE[lb.size] || 12;
    const text = String(lb.text ?? ""), lines = text ? text.split("\n") : [];
    ctx.font = `${fs}px IBM Plex Sans, sans-serif`;
    const tw = lines.length ? Math.max(...lines.map(s => ctx.measureText(s).width)) : 0, lh = fs * 1.25, th = lines.length * lh;
    const shape = {triangleup: "triangleup", triangledown: "triangledown", arrowup: "arrowup", arrowdown: "arrowdown", circle: "circle", square: "square",
      diamond: "diamond", xcross: "xcross", cross: "cross", flag: "flag"}[st];
    if(shape || st === "none" || st === "text_outline"){
      const sz = SHAPE_PX[lb.size] || 12;
      if(lb.tooltip && this.hits) this.hits.push({x0: x - Math.max(sz, tw / 2) - 2, y0: y - Math.max(sz, th) - 2, x1: x + Math.max(sz, tw / 2) + 2, y1: y + Math.max(sz, th) + 2, tip: lb.tooltip});
      if(shape){ const up = /up/.test(shape); const yy = yl === "ab" ? y - sz / 2 - 3 : yl === "bl" ? y + sz / 2 + 3 : y; this.mark(ctx, shape, x, yy, sz, bg);
        if(lines.length){ ctx.fillStyle = pcol(lb.textcolor, bg); ctx.textAlign = "center"; ctx.textBaseline = "middle";
          const ty = up || yl === "bl" ? yy + sz / 2 + 4 + lh / 2 : yy - sz / 2 - 4 - th + lh / 2; lines.forEach((s, k) => ctx.fillText(s, x, ty + k * lh)); } }
      else { ctx.fillStyle = pcol(lb.textcolor, bg); ctx.textAlign = "center"; ctx.textBaseline = "middle"; lines.forEach((s, k) => ctx.fillText(s, x, y - th / 2 + lh / 2 + k * lh)); }
      return;
    }
    const pad = 5, w = Math.max(tw + pad * 2, 10), h = Math.max(th + pad, 10), tip = 6;
    const hit = (x0, y0, ww, hh) => { if(lb.tooltip && this.hits) this.hits.push({x0, y0, x1: x0 + ww, y1: y0 + hh, tip: lb.tooltip}); };
    let bx = x - w / 2, by;
    if(st === "label_up"){ by = y + tip; }
    else if(st === "label_left"){ bx = x + tip; by = y - h / 2; }
    else if(st === "label_right"){ bx = x - tip - w; by = y - h / 2; }
    else if(st === "label_center"){ by = y - h / 2; }
    // lower_left = the point is the label's lower-left corner (the label sits up and to the right), and so on
    else if(st === "label_lowerleft"){ bx = x; by = y - h; } else if(st === "label_lowerright"){ bx = x - w; by = y - h; }
    else if(st === "label_upperleft"){ bx = x; by = y; } else if(st === "label_upperright"){ bx = x - w; by = y; }
    else { by = y - tip - h; }                    // label_down (the default)
    hit(bx, by, w, h);
    ctx.fillStyle = bg; ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(bx, by, w, h, 3); else ctx.rect(bx, by, w, h);
    ctx.fill();
    ctx.beginPath();                              // the pointer
    if(st === "label_up"){ ctx.moveTo(x - tip, by + 0.5); ctx.lineTo(x, y); ctx.lineTo(x + tip, by + 0.5); }
    else if(st === "label_left"){ ctx.moveTo(bx + 0.5, y - tip); ctx.lineTo(x, y); ctx.lineTo(bx + 0.5, y + tip); }
    else if(st === "label_right"){ ctx.moveTo(bx + w - 0.5, y - tip); ctx.lineTo(x, y); ctx.lineTo(bx + w - 0.5, y + tip); }
    else if(st === "label_down" || !/label_/.test(st)){ ctx.moveTo(x - tip, by + h - 0.5); ctx.lineTo(x, y); ctx.lineTo(x + tip, by + h - 0.5); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = pcol(lb.textcolor, "#fff"); ctx.textBaseline = "middle";
    const al = lb.textalign || "center"; ctx.textAlign = al === "left" ? "left" : al === "right" ? "right" : "center";
    const tx = al === "left" ? bx + pad : al === "right" ? bx + w - pad : bx + w / 2;
    lines.forEach((s, k) => ctx.fillText(s, tx, by + pad / 2 + lh / 2 + k * lh));
  }
  mark(ctx, shape, x, y, sz, c){
    const h = sz / 2; ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.5, sz / 8); ctx.beginPath();
    switch(shape){
      case "triangleup": ctx.moveTo(x, y - h); ctx.lineTo(x + h, y + h); ctx.lineTo(x - h, y + h); ctx.closePath(); ctx.fill(); break;
      case "triangledown": ctx.moveTo(x, y + h); ctx.lineTo(x + h, y - h); ctx.lineTo(x - h, y - h); ctx.closePath(); ctx.fill(); break;
      case "arrowup": ctx.moveTo(x, y - h); ctx.lineTo(x + h, y); ctx.lineTo(x + h / 3, y); ctx.lineTo(x + h / 3, y + h); ctx.lineTo(x - h / 3, y + h); ctx.lineTo(x - h / 3, y); ctx.lineTo(x - h, y); ctx.closePath(); ctx.fill(); break;
      case "arrowdown": ctx.moveTo(x, y + h); ctx.lineTo(x + h, y); ctx.lineTo(x + h / 3, y); ctx.lineTo(x + h / 3, y - h); ctx.lineTo(x - h / 3, y - h); ctx.lineTo(x - h / 3, y); ctx.lineTo(x - h, y); ctx.closePath(); ctx.fill(); break;
      case "circle": ctx.arc(x, y, h, 0, Math.PI * 2); ctx.fill(); break;
      case "square": ctx.rect(x - h, y - h, sz, sz); ctx.fill(); break;
      case "diamond": ctx.moveTo(x, y - h); ctx.lineTo(x + h, y); ctx.lineTo(x, y + h); ctx.lineTo(x - h, y); ctx.closePath(); ctx.fill(); break;
      case "xcross": ctx.moveTo(x - h, y - h); ctx.lineTo(x + h, y + h); ctx.moveTo(x + h, y - h); ctx.lineTo(x - h, y + h); ctx.stroke(); break;
      case "cross": ctx.moveTo(x, y - h); ctx.lineTo(x, y + h); ctx.moveTo(x - h, y); ctx.lineTo(x + h, y); ctx.stroke(); break;
      case "flag": ctx.moveTo(x - h, y + h); ctx.lineTo(x - h, y - h); ctx.lineTo(x + h, y - h / 2); ctx.lineTo(x - h, y); ctx.stroke(); ctx.fill(); break;
      default: ctx.arc(x, y, h, 0, Math.PI * 2); ctx.fill();
    }
  }
  /* plotshape / plotchar / plotarrow */
  shapes(ctx, size, E){
    const P = this.r.pine, {X, Y, vr} = E;
    const i0 = Math.max(0, Math.floor(vr.from) - P.off - 1), i1 = Math.min(P.n - 1, Math.ceil(vr.to) - P.off + 1);
    for(const s of P.shapes){
      const st = String(s.o.style || "shape");
      for(let i = i0; i <= i1; i++){
        const v = s.vals[i], o = s.opts[i] ? {...s.o, ...s.opts[i]} : s.o;
        const loc = String(o.location || (st === "char" ? "AboveBar" : "AboveBar")).toLowerCase();
        const on = loc === "absolute" ? v != null && isFinite(v) : v === true || (typeof v === "number" && isFinite(v) && v !== 0);
        if(!on) continue;
        const c0 = s.cols[i]; if(c0 === null) continue;
        const c = pcol(c0 !== undefined ? c0 : o.color, PINE_BLUE), x = X(P.off + i); if(x == null) continue;
        const sz = SHAPE_PX[o.size] || SHAPE_PX.auto;
        const b = E.bars[P.off + i] || {};
        const arrow = /arrow/.test(String(o.shape || "")) && typeof v === "number";
        let shape = String(o.shape || (st === "char" ? "" : "shape_xcross")).replace("shape_", "").replace("_", "");
        if(arrow) shape = v > 0 ? "arrowup" : "arrowdown";
        const below = arrow ? v > 0 : /below|bottom/.test(loc);
        let y;
        if(loc === "absolute") y = Y(v);
        else if(loc === "top") y = sz / 2 + 4;
        else if(loc === "bottom") y = size.height - sz / 2 - 4;
        else if(arrow ? v > 0 : loc === "belowbar"){ const yy = Y(b.low); y = yy == null ? null : yy + sz / 2 + 4; }
        else { const yy = Y(b.high); y = yy == null ? null : yy - sz / 2 - 4; }
        if(y == null || !isFinite(y)) continue;
        if(st === "char"){ ctx.font = `${sz + 3}px IBM Plex Sans, sans-serif`; ctx.fillStyle = c; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(o.char || "★"), x, y); }
        else if(/label(up|down)/.test(shape)){ this.label(ctx, E, {x: i, xloc: "bi", y: loc === "absolute" ? v : below ? b.low : b.high, yloc: "pr", text: o.text || "", color: c0 !== undefined && c0 ? c0 : o.color, textcolor: o.textcolor, style: shape === "labelup" ? "style_label_up" : "style_label_down", size: o.size}); continue; }
        else this.mark(ctx, shape, x, y, sz, c);
        if(o.text){ const fs = 11, lines = String(o.text).split("\n");
          ctx.font = `${fs}px IBM Plex Sans, sans-serif`; ctx.fillStyle = pcol(o.textcolor, c); ctx.textAlign = "center"; ctx.textBaseline = "middle";
          lines.forEach((t, k) => ctx.fillText(t, x, below ? y + sz / 2 + 4 + fs / 2 + k * fs * 1.2 : y - sz / 2 - 4 - (lines.length - 1 - k) * fs * 1.2 - fs / 2)); }
      }
    }
  }
}

/* ------------------------------------------------------------------ tables (HTML over the pane) */
const TSIZE = {tiny: "9px", small: "10.5px", normal: "12px", large: "15px", huge: "20px", auto: "12px"};
function pineTables(r){
  if(!r.tbl) return;
  const D = r.pine.draw || {}, list = [...(D.__tables__ || []), ...(D.__tables_overlay__ || [])];
  r.tbl.innerHTML = list.map(t => {
    const pos = String(t.position || "top_right").replace("position.", "");
    const frame = +t.frame_width > 0 ? `outline:${+t.frame_width}px solid ${pcol(t.frame_color, "#888")};` : "";
    const bord = +t.border_width > 0 ? `${+t.border_width}px solid ${pcol(t.border_color, "#888")}` : "0";
    const rows = (t.cells || []).map(row => `<tr>${(row || []).map(c => !c ? `<td style="border:${bord}"></td>` : c._merge_parent ? "" :
      `<td style="border:${bord};${c.bgcolor ? `background:${pcol(c.bgcolor)};` : ""}color:${pcol(c.text_color, "#000")};font-size:${TSIZE[c.text_size] || "12px"};text-align:${c.text_halign === "left" ? "left" : c.text_halign === "right" ? "right" : "center"};vertical-align:${c.text_valign === "top" ? "top" : c.text_valign === "bottom" ? "bottom" : "middle"}"${c.tooltip ? ` title="${pesc(c.tooltip)}"` : ""}>${pesc(c.text).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`).join("");
    return `<table class="ptab" data-pos="${pos}" data-ov="${t.force_overlay ? 1 : 0}" style="${t.bgcolor ? `background:${pcol(t.bgcolor)};` : ""}${frame}">${rows}</table>`;
  }).join("");
  pineLayout();
}
/* label tooltips, as on TradingView: hover a label that has one */
document.addEventListener("DOMContentLoaded", () => {
  const box = pq("#chart"); let tipEl = null;
  const hide = () => { if(tipEl) tipEl.style.display = "none"; };
  box.addEventListener("mouseleave", hide);
  box.addEventListener("mousemove", e => {
    if(!chart || !INDS.some(r => r.pine)) return hide();
    const rc = box.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top;
    const top = []; let y = 0; chart.panes().forEach((p, k) => { top[k] = y; y += p.getHeight() + 1; });
    let found = null;
    for(const r of INDS){ if(!r.pine || r.cfg.hidden) continue;
      for(const pr of [r.prim, r.prim0]){ if(!pr || !pr.hits) continue;
        const py = my - (top[pr.mode === "main" ? 0 : r.pane] || 0);
        for(let k = pr.hits.length - 1; k >= 0; k--){ const h = pr.hits[k]; if(mx >= h.x0 && mx <= h.x1 && py >= h.y0 && py <= h.y1){ found = h.tip; break; } }
        if(found) break; }
      if(found) break; }
    if(!found) return hide();
    if(!tipEl){ tipEl = document.createElement("div"); tipEl.className = "ptip"; box.append(tipEl); }
    tipEl.textContent = found; tipEl.style.display = "block";
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = Math.min(mx + 14, box.clientWidth - w - 4) + "px";
    tipEl.style.top = (my + 16 + h > box.clientHeight ? Math.max(0, my - h - 10) : my + 16) + "px";
  });
});
/* tables sit in their pane's area; called whenever the legends are re-placed */
function pineLegendBottom(){
  // the candle read-out, then the indicators on the candles, then the collapse arrow (#lgdG, placed last)
  let b = 30; for(const el of [pq("#lgd0"), pq("#lgdG")]) if(el && el.style.display !== "none") b = Math.max(b, el.offsetTop + el.offsetHeight + 4);
  return b;
}
function pineLayout(){
  if(!chart) return;
  const ps = chart.panes(); let aw = 60; try{ aw = chart.priceScale("right").width() || 60; }catch(e){}
  const top = []; let y = 0; ps.forEach((p, k) => { top[k] = y; y += p.getHeight() + 1; });
  for(const r of INDS){
    if(!r.tbl || !r.pine) continue;
    const w = pq("#chart").clientWidth - aw;
    r.tbl.querySelectorAll("table").forEach(t => {
      const pn = t.dataset.ov === "1" ? 0 : r.pane, pt = top[pn] || 0, ph = ps[pn] ? ps[pn].getHeight() : 0;
      const [v, h] = (t.dataset.pos || "top_right").split("_");
      t.style.left = (h === "left" ? 6 : h === "center" ? Math.max(0, (w - t.offsetWidth) / 2) : Math.max(0, w - t.offsetWidth - 6)) + "px";
      const under = pn === 0 ? pineLegendBottom() : 22;    // top tables go under the read-outs, as on TradingView
      t.style.top = (pt + (v === "top" ? (h === "left" || pn !== 0 ? under : 6) : v === "middle" ? Math.max(0, (ph - t.offsetHeight) / 2) : Math.max(0, ph - t.offsetHeight - 6))) + "px";
    });
  }
}

/* ------------------------------------------------------------------ legend */
function pineFmt(P, v){
  if(v == null || typeof v !== "number" || !isFinite(v)) return "∅";
  if(P.prec != null) return v.toLocaleString("en-IN", {minimumFractionDigits: P.prec, maximumFractionDigits: P.prec});
  const a = Math.abs(v); return v.toLocaleString("en-IN", {maximumFractionDigits: a >= 1000 ? 2 : a >= 1 ? 2 : 4});
}
function pineInputsLine(r){
  const P = r.pine, m = (P.meta || []).filter(x => x.display !== "none" && !/color|bool|text_area|session/.test(x.type));
  return m.slice(0, 6).map(x => { const k = x.title || x.name || x.id, v = (r.cfg.inputs || {})[k] ?? x.defval; return Array.isArray(v) ? "" : String(v); }).filter(Boolean).join(" ");
}
/* the read-out's name part and values part (index.html adds the buttons, hide / collapse states) */
function pineLegendParts(r, t){
  const P = r.pine;
  let name = `<b>${pesc(P.title)}</b>`;
  const inl = P.meta ? pineInputsLine(r) : ""; if(inl) name += `<span class="lk">${pesc(inl)}</span>`;
  let vals = "";
  if(P.err) vals = ` <span class="down">⚠ ${pesc(P.err.length > 90 ? P.err.slice(0, 90) + "…" : P.err)}</span>`;
  else if(P.res){
    let i = t != null ? P.idx.get(t) : undefined; if(i == null) i = P.n - 1;
    for(const o of P.order){ const v = P.vals[o.name][i], c = P.cols[o.name][i];
      if(o.kind === "candle" || !o.legend) continue;
      vals += ` <span style="color:${pcol(c || null, o.color)}">${pineFmt(P, v)}</span>`; }
  } else if(!r.cfg.hidden) vals = ` <span class="lk">calculating…</span>`;
  return [name, vals];
}
/* hide / show: series off, drawings and tables off, and the script stops running while hidden */
function pineVisible(r){
  const P = r.pine; if(!P) return;
  if(r.cfg.hidden){
    for(const s of Object.values(P.series)) s.api.applyOptions({visible: false});
    for(const [owner, h] of P.hl) try{ owner.removePriceLine(h); }catch(e){}
    P.hl = [];
    if(r.tbl) r.tbl.style.display = "none";
    r.prim && r.prim.update(); r.prim0 && r.prim0.update();
  } else {
    if(r.tbl) r.tbl.style.display = "";
    pineRun(r);
  }
}

/* ------------------------------------------------------------------ inputs dialog */
function pineInputs(r){
  let box = pq("#pineIn");
  if(!box){ box = document.createElement("div"); box.id = "pineIn"; document.body.append(box); }
  const P = r.pine, meta = P.meta || [], vals = r.cfg.inputs || {};
  const keyOf = m => m.title || m.name || m.varId || m.id;
  const opt = (o) => typeof o === "object" && o ? [o.value ?? o.title, o.title ?? o.value] : [o, o];
  const TFS = [["", "Chart"], ["1", "1m"], ["3", "3m"], ["5", "5m"], ["15", "15m"], ["30", "30m"], ["60", "1h"], ["120", "2h"], ["240", "4h"], ["D", "1D"], ["W", "1W"], ["M", "1M"]];
  let html = `<div class="pih"><b>${pesc(P.title)}</b><span class="muted"> · inputs</span><span style="flex:1"></span><button class="ghost" data-x>✕</button></div><div class="pib">`;
  const bars = +r.cfg.bars || PINE_BARS, BARS = [500, 1000, 1500, 3000, 5000, 10000, 20000, 50000];
  html += `<label class="pir" title="How many of the latest candles the script runs on. More = longer history, a slower first run; live updates stay fast."><span>Bars of history <span class="muted">(app setting)</span></span>
    <select data-bars>${(BARS.includes(bars) ? BARS : [...BARS, bars].sort((a, b) => a - b)).map(n => `<option value="${n}" ${n === bars ? "selected" : ""}>${n.toLocaleString("en-IN")}</option>`).join("")}</select></label>
    <label class="pir" title="Every price: the live bar is re-run on each price (TradingView's way). On candle close: once per new candle - for heavy scripts on long histories."><span>Update <span class="muted">(app setting)</span></span>
    <select data-upd><option value="tick">With every price</option><option value="close" ${r.cfg.update === "close" ? "selected" : ""}>On candle close</option></select></label>
    <div class="muted" style="font-size:11.5px;margin-top:4px">${P.n ? `Runs on ${P.n.toLocaleString("en-IN")} bars now${P.n < bars ? " (all the chart has loaded)" : ""} · full run ${P.ms ?? "–"} ms · live update ${P.tms ?? "–"} ms` : ""}</div>`;
  if(!meta.length) html += `<div class="muted" style="padding:8px 0">This script has no inputs${P.err ? " (or it didn't compile)" : ""}.</div>`;
  let grp = null;
  meta.forEach((m, n) => {
    if((m.group || "") !== grp){ grp = m.group || ""; if(grp) html += `<div class="pig">${pesc(grp)}</div>`; }
    const k = keyOf(m), v = k in vals ? vals[k] : m.defval, ty = m.type, id = "pin" + n;
    let ctl;
    if(ty === "bool") ctl = `<input type="checkbox" id="${id}" data-n="${n}" ${v ? "checked" : ""}>`;
    else if(ty === "color"){ const hex = /^#[\da-f]{6}/i.exec(String(v || "#2962FF")); ctl = `<input type="color" id="${id}" data-n="${n}" value="${hex ? hex[0] : "#2962ff"}">`; }
    else if((m.options && m.options.length) || ty === "source") ctl = `<select id="${id}" data-n="${n}">${(m.options || ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4", "hlcc4"]).map(o => { const [ov, ot] = opt(o); return `<option value="${pesc(ov)}" ${String(ov) === String(v) ? "selected" : ""}>${pesc(ot)}</option>`; }).join("")}</select>`;
    else if(ty === "timeframe") ctl = `<select id="${id}" data-n="${n}">${(TFS.some(x => x[0] === String(v)) ? TFS : [...TFS, [String(v), String(v)]]).map(([a, b]) => `<option value="${a}" ${a === String(v ?? "") ? "selected" : ""}>${b}</option>`).join("")}</select>`;
    else if(ty === "int" || ty === "float" || ty === "price") ctl = `<input type="number" id="${id}" data-n="${n}" value="${pesc(v)}" ${m.minval != null ? `min="${m.minval}"` : ""} ${m.maxval != null ? `max="${m.maxval}"` : ""} step="${m.step || (ty === "int" ? 1 : "any")}">`;
    else if(ty === "text_area") ctl = `<textarea id="${id}" data-n="${n}" rows="3">${pesc(v)}</textarea>`;
    else ctl = `<input type="text" id="${id}" data-n="${n}" value="${pesc(v)}">`;
    html += `<label class="pir" for="${id}"${m.tooltip ? ` title="${pesc(m.tooltip)}"` : ""}><span>${pesc(m.title || m.name || k)}</span>${ctl}</label>`;
  });
  html += `</div><div class="pif"><button data-def>Defaults</button><span style="flex:1"></span><button class="primary" data-x>OK</button></div>`;
  box.innerHTML = html; box.classList.remove("hide");
  const save = (fn) => { const l = indList(), it = l.find(x => x.id === r.cfg.id); if(!it) return; fn(it); r.cfg.inputs = it.inputs; indSave(l); pineRun(r); };
  box.querySelectorAll("[data-n]").forEach(inp => inp.addEventListener("change", () => {
    const m = meta[+inp.dataset.n], k = keyOf(m);
    let v = inp.type === "checkbox" ? inp.checked : inp.value;
    if(m.type === "int") v = Math.round(+v); else if(m.type === "float" || m.type === "price") v = +v;
    if(m.type === "color"){ const a = /^#[\da-f]{6}([\da-f]{2})$/i.exec(String(((r.cfg.inputs || {})[k] ?? m.defval) || "")); v = inp.value.toUpperCase() + (a ? a[1] : ""); }
    if(m.type === "int" || m.type === "float"){ if(m.minval != null && v < m.minval) v = m.minval; if(m.maxval != null && v > m.maxval) v = m.maxval; }
    save(it => { it.inputs = {...(it.inputs || {}), [k]: v}; });
  }));
  box.querySelector("[data-upd]").onchange = e => {
    const l = indList(), it = l.find(x => x.id === r.cfg.id); if(!it) return;
    if(e.target.value === "close") it.update = "close"; else delete it.update;
    indSave(l); r.cfg.update = it.update;
  };
  box.querySelector("[data-bars]").onchange = e => {
    const l = indList(), it = l.find(x => x.id === r.cfg.id); if(!it) return;
    it.bars = +e.target.value; indSave(l); r.cfg.bars = it.bars;
    loadHistory();                                // more bars may need more days of candles; the saved copies make this quick
  };
  box.querySelector("[data-def]").onclick = () => { save(it => { it.inputs = {}; }); setTimeout(() => pineInputs(INDS.find(x => x.cfg.id === r.cfg.id) || r), 300); };
  box.querySelectorAll("[data-x]").forEach(b => b.onclick = () => box.classList.add("hide"));
}

/* ------------------------------------------------------------------ the Pine Editor */
const PE = {cm: null, id: null, saved: "", savedName: "", t: null, cmLoad: null};
const PINE_NEW = `//@version=6
indicator("My script", overlay=false)
len = input.int(14, "Length", minval=1)
plot(ta.rsi(close, len), "RSI", color=color.orange)
hline(70, "Upper", color=color.gray)
hline(30, "Lower", color=color.gray)
`;
function peLoadCM(){
  if(window.CodeMirror) return Promise.resolve();
  if(PE.cmLoad) return PE.cmLoad;
  PE.cmLoad = new Promise((ok, bad) => {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/vendor/codemirror/codemirror.bundle.css"; document.head.append(l);
    const s = document.createElement("script"); s.src = "/vendor/codemirror/codemirror.bundle.js"; s.onload = () => { peMode(); ok(); }; s.onerror = () => { PE.cmLoad = null; bad(new Error("couldn't load the editor")); }; document.head.append(s);
  });
  return PE.cmLoad;
}
function peMode(){
  const NS = "ta|math|str|request|input|color|array|matrix|map|line|label|box|table|linefill|polyline|syminfo|timeframe|barstate|session|strategy|chart|runtime|log|ticker|plot|hline|shape|location|size|position|xloc|yloc|extend|display|format|scale|currency|dayofweek|order|alert|text|font|barmerge|earnings|dividends|splits|adjustment|backadjustment|settlement_as_close";
  CodeMirror.defineSimpleMode("pine", {
    start: [
      {regex: /\/\/@(?:version|description|function|param|returns|type|field|variable|enum|strategy_alert_message)\b.*/, token: "meta"},
      {regex: /\/\/.*/, token: "comment"},
      {regex: /"(?:[^\\"]|\\.)*?(?:"|$)/, token: "string"},
      {regex: /'(?:[^\\']|\\.)*?(?:'|$)/, token: "string"},
      {regex: /#[\da-fA-F]{6}(?:[\da-fA-F]{2})?\b/, token: "number"},
      {regex: /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/, token: "number"},
      {regex: /\b(?:if|else|for|to|by|in|while|switch|var|varip|import|export|method|type|enum|return|break|continue|and|or|not)\b/, token: "keyword"},
      {regex: /\b(?:true|false|na)\b/, token: "atom"},
      {regex: /\b(?:int|float|bool|string|series|simple|const)\b/, token: "type"},
      {regex: new RegExp(`\\b(?:${NS})\\.[A-Za-z_][\\w.]*`), token: "builtin"},
      {regex: /\b(?:indicator|strategy|library|plot|plotshape|plotchar|plotarrow|plotcandle|plotbar|hline|fill|bgcolor|barcolor|alertcondition|alert|nz|na|fixnan|timestamp|time_close|max_bars_back)\b(?=\s*\()/, token: "def"},
      {regex: /\b(?:open|high|low|close|volume|hl2|hlc3|ohlc4|hlcc4|bar_index|last_bar_index|time|timenow|time_tradingday|year|month|weekofyear|dayofmonth|hour|minute|second)\b/, token: "variable-2"},
      {regex: /\b(?:color|line|label|box|table|array|matrix|map|chart)\b/, token: "type"},
      {regex: /[-+*/%=<>!?:]+|=>/, token: "operator"},
      {regex: /[A-Za-z_]\w*(?=\s*\()/, token: "variable-3"},
      {regex: /[A-Za-z_]\w*/, token: "variable"},
    ],
    meta: {lineComment: "//", dontIndentStates: ["comment"]},
  });
}
function peDirty(){ return PE.cm && (PE.cm.getValue() !== PE.saved || pq("#pdName").value.trim() !== PE.savedName); }
function peTitle(){
  const d = peDirty();
  pq("#pdDirty").textContent = d ? "● unsaved" : (PE.id ? "saved" : "");
  pq("#pdDirty").className = d ? "pd-dirty on" : "pd-dirty";
  const on = PE.id && indList().some(x => x.type === "pine" && x.scriptId === PE.id);
  pq("#pdAdd").textContent = on ? "Update on chart" : "Add to chart";
  pq("#pdDel").disabled = !PE.id;
}
function peList(){
  const s = pq("#pdOpen");
  s.innerHTML = `<option value="">Open… (${PINE.scripts.length})</option>` + [...PINE.scripts].sort((a, b) => a.name.localeCompare(b.name)).map(x => `<option value="${x.id}">${pesc(x.name)}</option>`).join("");
  s.value = "";
}
function peShow(on){
  pq("#pineDock").classList.toggle("hide", !on);
  if(on) setTimeout(() => PE.cm && PE.cm.refresh(), 0);
  prefSet("pineOpen", !!on);
}
async function peOpen(id, isNew){
  peShow(true);
  pq("#pdCon").textContent = "Loading the editor…";
  try{ await peLoadCM(); }catch(e){ pq("#pdCon").textContent = String(e.message || e); return; }
  await pineLoad();
  if(!PE.cm){
    PE.cm = CodeMirror(pq("#pdEd"), {value: "", mode: "pine", theme: "pine", lineNumbers: true, indentUnit: 4, tabSize: 4, indentWithTabs: false,
      matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true, lineWrapping: false,
      extraKeys: {"Ctrl-S": () => peSave(), "Cmd-S": () => peSave(), "Ctrl-Enter": () => peAdd(), "Cmd-Enter": () => peAdd(),
        "Ctrl-/": "toggleComment", "Cmd-/": "toggleComment", "Shift-Tab": "indentLess",
        Tab: cm => cm.somethingSelected() ? cm.indentSelection("add") : cm.replaceSelection("    ", "end")}});
    PE.cm.on("change", () => { peTitle(); clearTimeout(PE.t); PE.t = setTimeout(peCheck, 900); });
    pq("#pdName").addEventListener("input", peTitle);
  }
  peList();
  if(PE.cm && peDirty() && (isNew || (id && id !== PE.id)) && !confirm("Discard the unsaved changes in the editor?")) { peTitle(); return; }
  const sc = id && pineScript(id);
  if(isNew || (!sc && !PE.id && !PE.cm.getValue())){
    const last = !isNew && pineScript(prefGet("pineLast", ""));
    if(last) return peOpen(last.id);
    PE.id = null; PE.saved = ""; PE.savedName = ""; PE.cm.setValue(PINE_NEW); pq("#pdName").value = "";
  } else if(sc){
    PE.id = sc.id; PE.saved = sc.source; PE.savedName = sc.name; PE.cm.setValue(sc.source); pq("#pdName").value = sc.name; prefSet("pineLast", sc.id);
  }
  PE.cm.clearHistory(); PE.cm.refresh(); PE.cm.focus();
  peTitle(); peCheck();
}
function peMark(line){
  PE.cm.eachLine(l => PE.cm.removeLineClass(l, "background", "pd-errline"));
  if(line) PE.cm.addLineClass(line - 1, "background", "pd-errline");
}
/* compile as you type, on the chart's latest bars, so errors show straight away */
async function peCheck(){
  if(!PE.cm) return;
  const code = PE.cm.getValue(), con = pq("#pdCon");
  let {candles} = pineCandles(300);
  if(!candles.length){ let t = Date.UTC(2026, 0, 1, 3, 30), p = 100; candles = Array.from({length: 120}, () => { const c = {open: p, high: p + 1, low: p - 1, close: p += (Math.random() - 0.5), volume: 1, openTime: t, closeTime: t + 299999}; t += 300000; return c; }); }
  const res = await pineExec({code, inputs: {}, candles, ticker: cur ? cur.s : "X", tf: pineTf(), info: pineInfo()}, 10000);
  if(!PE.cm || PE.cm.getValue() !== code) return;     // typed again meanwhile
  peMark(res.ok ? null : res.line);
  if(res.ok){
    const ind = res.indicator || {}, n = Object.keys(res.plots || {}).filter(k => !/^__/.test(k)).length;
    con.innerHTML = `<span class="up">✓ No errors</span> · ${pesc(ind.title || "")} · ${n} plot${n === 1 ? "" : "s"} · ${ind.overlay ? "on the candles" : "own pane"} · ${res.ms} ms`
      + `<span class="muted"> · Ctrl+S save · Ctrl+Enter ${pq("#pdAdd").textContent.toLowerCase()}</span>`
      + (res.logs && res.logs.length ? `<div class="pd-logs">${res.logs.slice(-30).map(l => pesc(l)).join("<br>")}</div>` : "");
  } else {
    con.innerHTML = `<span class="down pd-err" data-line="${res.line || ""}" data-col="${res.col || ""}">✗ ${res.line ? `Line ${res.line}${res.col ? ":" + res.col : ""} · ` : ""}${pesc(res.error)}</span>`;
    const e = con.querySelector(".pd-err"); if(e && res.line) e.onclick = () => { PE.cm.setCursor({line: res.line - 1, ch: Math.max(0, (res.col || 1) - 1)}); PE.cm.focus(); };
  }
  return res;
}
async function peSave(asNew){
  if(!PE.cm) return null;
  const src = PE.cm.getValue();
  let name = pq("#pdName").value.trim() || pineTitleOf(src) || "My script";
  if(asNew){ const n = prompt("Save as a new script called:", name + (PE.id ? " copy" : "")); if(!n) return null; name = n.trim(); }
  const j = await api("/api/scripts/save", {body: {id: asNew ? null : PE.id, name, source: src}});
  if(!j.ok){ pq("#pdCon").innerHTML = `<span class="down">✗ Not saved: ${pesc(j.error || "error")}</span>`; return null; }
  PINE.scripts = j.scripts; PINE.loaded = true;
  PE.id = j.script.id; PE.saved = src; PE.savedName = j.script.name; pq("#pdName").value = j.script.name; prefSet("pineLast", PE.id);
  peList(); peTitle();
  toast(`Saved "${j.script.name}"`);
  for(const r of INDS) if(r.pine && r.cfg.scriptId === PE.id){ r.pine.title = pineTitleOf(src) || j.script.name; pineRun(r); }   // the chart follows the saved code
  return j.script;
}
async function peAdd(){
  const res = await peCheck();
  if(res && !res.ok){ toast("Fix the error first"); return; }
  if(!PE.id || peDirty()){ const s = await peSave(); if(!s) return; }
  const l = indList();
  if(l.some(x => x.type === "pine" && x.scriptId === PE.id)){ toast("Updated on the chart"); peTitle(); return; }
  l.push({type: "pine", id: Date.now().toString(36), scriptId: PE.id, inputs: {}, overlay: res && res.indicator ? !!res.indicator.overlay : undefined});
  indSave(l); indBuild(); peTitle();
}
async function peDelete(){
  if(!PE.id) return;
  const sc = pineScript(PE.id), on = indList().filter(x => x.type === "pine" && x.scriptId === PE.id).length;
  if(!confirm(`Delete "${sc ? sc.name : "this script"}" from your library?${on ? " It is also removed from the chart." : ""}`)) return;
  const j = await api("/api/scripts/delete", {body: {id: PE.id}}); if(!j.ok){ toast(j.error || "Couldn't delete"); return; }
  PINE.scripts = j.scripts;
  if(on){ indSave(indList().filter(x => !(x.type === "pine" && x.scriptId === PE.id))); indBuild(); }
  PE.id = null; PE.saved = ""; PE.savedName = "";
  peOpen(null, true);
}
document.addEventListener("DOMContentLoaded", function peWire(){
  pq("#pdNew").onclick = () => peOpen(null, true);
  pq("#pdSave").onclick = () => peSave();
  pq("#pdSaveAs").onclick = () => peSave(true);
  pq("#pdDel").onclick = peDelete;
  pq("#pdAdd").onclick = peAdd;
  pq("#pdClose").onclick = () => peShow(false);
  pq("#pdOpen").onchange = e => { if(e.target.value) peOpen(e.target.value); };
  pq("#bPine").onclick = e => { e.stopPropagation(); if(pq("#pineDock").classList.contains("hide")) peOpen(PE.id); else peShow(false); };
  const dock = pq("#pineDock"), h0 = +prefGet("pineH", 0);
  if(h0) dock.style.height = h0 + "px";
  // drag the top edge to resize
  pq("#pdGrip").addEventListener("pointerdown", e => {
    e.preventDefault(); const y0 = e.clientY, start = dock.offsetHeight, wrap = dock.parentElement.clientHeight;
    const mv = ev => { dock.style.height = Math.max(120, Math.min(wrap - 160, start - (ev.clientY - y0))) + "px"; PE.cm && PE.cm.refresh(); };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); prefSet("pineH", dock.offsetHeight); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  });
  addEventListener("beforeunload", e => { if(peDirty()){ e.preventDefault(); e.returnValue = ""; } });
});
