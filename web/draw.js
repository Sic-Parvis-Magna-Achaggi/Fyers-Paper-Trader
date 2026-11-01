/* Drawing tools and the measure tool (v0.22.0), like TradingView's, on every chart type and timeframe.
   Loaded after the page's inline script (uses chart, series, DISP, RAW, curPlan, cur, sym, ctType, CT_SIZE, P, api...).
   The toolbar, the floating bar, menus and dialogs are in drawui.js.

   A drawing: {id, type, pts: [{t, p}], st: {style}, text, lock, hide, lots}. t is the chart's time (epoch seconds + IST,
   as the bars), p a price. A point sits on a bar (the bar its time falls in, on any timeframe or chart type: on
   Renko / P&F, the brick or column formed then); past the last bar it counts bars ahead. The brush keeps exact
   positions between bars. Saved per contract on the server (/api/drawings), for every device. */
"use strict";
const DR = {
  s: null, items: [], loaded: false, sel: null, tool: null, draft: null, drag: null, meas: null, measArm: false,
  prim: null, primSeries: null, geo: new Map(), undo: [], redo: [], saveT: null, dirty: false, loadSeq: 0,
  money: new Map(), mq: new Map(), mBusy: false, touch: false, clip: null, hoverId: null, crossAt: null
};
const DR_PAL = ["#2962ff", "#f23645", "#089981", "#ff9800", "#9c27b0", "#00bcd4", "#e91e63", "#4caf50", "#ffeb3b", "#787b86", "#ffffff", "#000000"];
const FIB_LV = () => [[0, 1, "#787b86"], [0.236, 1, "#f23645"], [0.382, 1, "#ff9800"], [0.5, 1, "#4caf50"], [0.618, 1, "#089981"],
  [0.786, 1, "#00bcd4"], [1, 1, "#787b86"], [1.618, 1, "#2962ff"], [2.618, 0, "#f23645"], [3.618, 0, "#9c27b0"], [4.236, 0, "#e91e63"]];
const GANN_LV = () => [[0, 1, "#787b86"], [0.25, 1, "#ff9800"], [0.382, 1, "#4caf50"], [0.5, 1, "#089981"], [0.618, 1, "#00bcd4"], [0.75, 1, "#2962ff"], [1, 1, "#787b86"]];

/* ---------------------------------------------------------------- settings (prefs "draw", on the server) */
function drPref(){ return {mag: "off", stay: false, lockAll: false, hideAll: false, tb: true, styles: {}, last: {}, lots: 1, ...(prefGet("draw", {}) || {})}; }
function drPrefSet(ch){ prefSet("draw", {...drPref(), ...ch}); }
function drLots(){ const n = Math.round(+drPref().lots); return n > 0 ? Math.min(n, 1000) : 1; }

/* ---------------------------------------------------------------- bars <-> time <-> screen */
function drBarSec(){
  if(!curPlan) return 60;
  const t = curPlan.t; return t.u === "W" ? 604800 * t.n : t.u === "M" ? 2629800 * t.n : curPlan.sec;
}
function drIdx(t){                           // the last bar at or before t (-1: before the first)
  let lo = 0, hi = DISP.length - 1; if(hi < 0 || t < DISP[0].time) return -1;
  while(lo < hi){ const m = (lo + hi + 1) >> 1; if(DISP[m].time <= t) lo = m; else hi = m - 1; }
  return lo;
}
function drSpan(i){ const g = DISP[i + 1].time - DISP[i].time; return CT.timeBased(ctType()) ? Math.min(drBarSec(), g) : g; }
/* time -> logical bar index (snap: the bar it falls in; free: exact place between bars) */
function t2L(t, free){
  const n = DISP.length; if(!n || t == null) return null;
  const bs = drBarSec(), i = drIdx(t);
  if(i < 0){ const L = (t - DISP[0].time) / bs; return free ? L : Math.floor(L + 1e-9); }
  if(i === n - 1){ const L = (t - DISP[n - 1].time) / bs; return n - 1 + (free ? L : Math.floor(L + 1e-9)); }
  if(!free) return i;
  return i + Math.min(0.999, (t - DISP[i].time) / drSpan(i));
}
function L2t(L){
  const n = DISP.length; if(!n) return null;
  const bs = drBarSec();
  if(L >= n - 1) return Math.round(DISP[n - 1].time + (L - (n - 1)) * bs);
  if(L < 0) return Math.round(DISP[0].time + L * bs);
  const i = Math.floor(L), f = L - i;
  return f ? Math.round(DISP[i].time + f * drSpan(i)) : DISP[i].time;
}
function drView(){
  if(!chart || !series || !DISP.length) return null;
  const ts = chart.timeScale(), c0 = ts.logicalToCoordinate(0), c1 = ts.logicalToCoordinate(1);
  if(c0 == null || c1 == null || c1 === c0) return null;
  const sp = c1 - c0;
  return {sp, xL: L => c0 + L * sp, Lx: x => (x - c0) / sp, y: p => series.priceToCoordinate(p), p: y => series.coordinateToPrice(y)};
}
function drTick(){ return (cur && cur.tick) || 0.05; }
function drRound(p){ return roundTick(p, drTick()); }
/* a point under the mouse: on a bar (free: exact), the price on the tick; the magnet snaps to the bar's open / high /
   low / close (weak: when close to one, strong: always). Ctrl turns the magnet on or off while held. */
function drPtAt(x, y, o = {}){
  const V = drView(); if(!V) return null;
  let L = V.Lx(x); if(!o.free) L = Math.round(L);
  let p = V.p(y); if(p == null) return null;
  let mag = drPref().mag; if(o.ctrl) mag = mag === "off" ? "strong" : "off";
  if(o.mag !== false && !o.free && mag !== "off"){
    const b = DISP[Math.max(0, Math.min(DISP.length - 1, Math.round(L)))];
    if(b && L >= -0.5 && L <= DISP.length - 0.5){
      const cand = CT.ohlc(ctType()) ? [b.open, b.high, b.low, b.close] : [b.close];
      let best = null, bd = Infinity;
      for(const c of cand){ const yy = V.y(c); if(yy != null && Math.abs(yy - y) < bd){ bd = Math.abs(yy - y); best = c; } }
      if(best != null && (mag === "strong" || bd <= (DR.touch ? 24 : 16))) p = best;
    }
  }
  if(!o.free) p = drRound(p);
  return {t: L2t(L), p, L};
}
function drXY(V, pt, free){ const L = t2L(pt.t, free); return {x: L == null ? null : V.xL(L), y: V.y(pt.p), L}; }

/* ---------------------------------------------------------------- formatting */
function drSign(v){ return v > 0 ? "+" : v < 0 ? "−" : ""; }
function drTimeStr(t){
  if(t == null) return "";
  const d = new Date(t * 1000), day = !(curPlan && curPlan.t.min);
  return d.toLocaleString("en-GB", {timeZone: "UTC", day: "2-digit", month: "short", year: "2-digit", ...(day ? {} : {hour: "2-digit", minute: "2-digit", hour12: false})}).replace(",", "");
}
function drDur(sec){
  sec = Math.abs(Math.round(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return d ? `${d}d${h ? " " + h + "h" : ""}` : h ? `${h}h${m ? " " + m + "m" : ""}` : `${m}m`;
}
function drVolBetween(L0, L1){
  const a = Math.max(0, Math.ceil(Math.min(L0, L1) - 1e-9)), b = Math.min(DISP.length - 1, Math.floor(Math.max(L0, L1) + 1e-9));
  let v = 0; for(let i = a; i <= b; i++) v += DISP[i].vol || 0; return v;
}
function drUnits(){ const t = ctType(); return t === "pf" ? ["boxes", "columns"] : t === "renko" ? ["bricks", "bricks"] : t === "range" || t === "lb" ? ["", "bars"] : ["", "bars"]; }
/* the price lines of a range / measure: change, %, ticks (boxes on P&F, bricks on Renko) */
function drPriceInfo(p0, p1){
  const d = p1 - p0, tick = drTick(), pct = p0 ? d / p0 * 100 : 0, [box] = drUnits();
  const boxes = box && CT_SIZE ? `${(Math.abs(d) / CT_SIZE).toFixed(1).replace(/\.0$/, "")} ${box} · ` : "";
  return `${boxes}${drSign(d)}${fmt(Math.abs(d), tick)} (${drSign(d)}${Math.abs(pct).toFixed(2)}%) · ${Math.round(Math.abs(d) / tick).toLocaleString("en-IN")} ticks`;
}
function drTimeInfo(a, b, La, Lb){
  const [, bar] = drUnits(), n = Math.round(Math.abs(Lb - La));
  const v = drVolBetween(La, Lb);
  return `${n} ${n === 1 ? bar.replace(/s$/, "") : bar} · ${drDur((b.t || 0) - (a.t || 0))}` + (v ? ` · Vol ${fmtVol(v)}` : "");
}

/* ---------------------------------------------------------------- net ₹ from the server (same charges code as trades) */
function drRow(){ return (cur && sym[cur.s]) || cur || {}; }
function drProduct(){ return (typeof P !== "undefined" && P.T && P.T.product) || "INTRADAY"; }
function drMoney(legs){
  if(!cur || legs.some(g => !(g.entry > 0) || !(g.exit > 0) || !(g.qty > 0))) return null;
  const key = JSON.stringify([cur.s, drProduct(), legs.map(g => [g.side, g.qty, +(+g.entry).toFixed(6), +(+g.exit).toFixed(6)])]);
  if(DR.money.has(key)) return DR.money.get(key);
  DR.mq.delete(key); DR.mq.set(key, {s: cur.s, prod: drProduct(), legs});
  while(DR.mq.size > 12) DR.mq.delete(DR.mq.keys().next().value);   // while you drag: only the latest few matter
  drMoneyRun();
  return undefined;
}
async function drMoneyRun(){
  if(DR.mBusy || !DR.mq.size) return;
  DR.mBusy = true;
  const s = [...DR.mq.values()][0].s, prod = [...DR.mq.values()][0].prod;
  const batch = [...DR.mq.entries()].filter(([, v]) => v.s === s && v.prod === prod);
  for(const [k] of batch) DR.mq.delete(k);
  const flat = [].concat(...batch.map(([, v]) => v.legs));
  try{
    const j = await api("/api/measure", {body: {s, product: prod, legs: flat}});
    let i = 0;
    for(const [k, v] of batch){ const res = j.ok ? j.legs.slice(i, i + v.legs.length) : null; i += v.legs.length; DR.money.set(k, res && res.every(Boolean) ? res : null); }
  }catch(e){ for(const [k] of batch) DR.money.set(k, null); }
  if(DR.money.size > 600) for(const k of [...DR.money.keys()].slice(0, 200)) DR.money.delete(k);
  DR.mBusy = false; drRedraw();
  if(DR.mq.size) setTimeout(drMoneyRun, 40);
}
/* your trade on this contract, for R: an open position with a stop on its own price, else the long / short tool */
function drRefTrade(){
  if(!cur || typeof P === "undefined") return null;
  const lot = drRow().lot || 1;
  const ps = ((P.snap && P.snap.positions) || []).filter(p => p.s === cur.s && p.sl != null && p.basis === "self");
  if(ps.length){ const p = ps[0]; return {side: p.side, qty: p.qty, entry: p.avg, sl: p.sl, what: p.side > 0 ? "long" : "short"}; }
  if(P.armed && P.T.s === cur.s && P.T.basis === "self" && P.plan && P.plan.lots > 0){
    const sl = slNow(), e = entryNow(); if(sl != null && e) return {side: P.T.side, qty: P.plan.lots * lot, entry: e, sl, what: "new trade"};
  }
  return null;
}
/* the measure's money lines: N lots bought at the start and sold at the end (sold first if it fell), net; R for your trade */
function drMoneyLines(p0, p1){
  const out = []; if(!cur || p0 == null || p1 == null) return out;
  const lots = drLots(), lot = drRow().lot || 1, side = p1 >= p0 ? 1 : -1;
  const m = drMoney([{side, qty: lots * lot, entry: p0, exit: p1}]);
  out.push(`${lots} lot${lots === 1 ? "" : "s"} ${side > 0 ? "long" : "short"}: ${m === undefined ? "…" : m ? rsS(m[0].net) + " net" : "–"}`);
  const R = drRefTrade();
  if(R){
    const mv = Math.abs(p1 - p0), r = drMoney([{side: R.side, qty: R.qty, entry: R.entry, exit: R.entry + R.side * mv}, {side: R.side, qty: R.qty, entry: R.entry, exit: R.sl}]);
    if(r === undefined) out.push("R: …");
    else if(r && r[1].net < 0) out.push(`${(r[0].net / -r[1].net).toFixed(2)}R for your ${R.what} (SL ${fmt(R.sl, drTick())})`);
    else if(r) out.push(`your ${R.what}'s stop is past break-even: no R`);
  }
  return out;
}

/* ---------------------------------------------------------------- the long / short position drawings (look-back)
   pts[0] = entry {t, p}; pts[1] = {t: end, p: target}; pts[2] = {t: end, p: stop}. Checked on the real candles of this
   timeframe (never Heikin-Ashi / P&F values) after the entry's candle up to the end: the first candle that reaches the
   stop or the target closes it, at that price (or at the candle's open if it opened past it). A candle that reaches
   both can't say which came first: it counts as the stop and is marked so. */
function drPosEval(d){
  const side = d.type === "long" ? 1 : -1, e = d.pts[0].p, tp = d.pts[1].p, sl = d.pts[2].p, t0 = d.pts[0].t, t1 = d.pts[1].t;
  let lo = 0, hi = RAW.length - 1, i = -1;
  while(lo <= hi){ const m = (lo + hi) >> 1; if(RAW[m].time <= t0){ i = m; lo = m + 1; } else hi = m - 1; }
  let j = i + 1, lastJ = null;
  for(; j < RAW.length && RAW[j].time <= t1; j++){
    const b = RAW[j]; lastJ = j;
    const hs = side > 0 ? b.low <= sl : b.high >= sl, ht = side > 0 ? b.high >= tp : b.low <= tp;
    if(hs || ht){
      const kind = hs && ht ? "both" : hs ? "sl" : "tp";
      let px = kind === "tp" ? tp : sl;
      if(kind === "tp" && side * (b.open - tp) > 0) px = b.open;                // opened past the target: the open
      if(kind !== "tp" && side * (sl - b.open) > 0) px = b.open;                // opened past the stop: the open
      return {kind, t: b.time, px, bars: j - i};
    }
  }
  if(lastJ == null) return {kind: "none"};
  return {kind: "open", t: RAW[lastJ].time, px: RAW[lastJ].close, bars: lastJ - i};
}

/* ---------------------------------------------------------------- the tools */
const LN = {c: "#2962ff", w: 2, ls: 0};
const DT = {};
const ext = (A, a, b, l, r) => { const dx = b.x - a.x, dy = b.y - a.y, k = (A.W + A.H) * 4 / (Math.hypot(dx, dy) || 1);
  return [l ? a.x - dx * k : a.x, l ? a.y - dy * k : a.y, r ? b.x + dx * k : b.x, r ? b.y + dy * k : b.y]; };
function lineGeom(A){ const s = A.st; A.line(...ext(A, A.P[0], A.P[1], s.el, s.er), s.c, s.w, s.ls); if(A.d.type === "arrow") A.head(A.P[0], A.P[1], s.c, s.w);
  if(s.lbl && A.P[0].x != null){ const a = A.d.pts[0], b = A.d.pts[1]; A.label((A.P[0].x + A.P[1].x) / 2, Math.min(A.P[0].y, A.P[1].y) - 6, [drPriceInfo(a.p, b.p), drTimeInfo(a, b, A.P[0].L, A.P[1].L)], s.c, "bottom"); } }
DT.trend = {name: "Trend line", g: "lines", n: 2, st: {...LN, el: false, er: false, lbl: false}, ext: true, lblOpt: "Show change", geom: lineGeom, key: "T"};
DT.ray = {name: "Ray", g: "lines", n: 2, st: {...LN, el: false, er: true, lbl: false}, ext: true, lblOpt: "Show change", geom: lineGeom};
DT.extl = {name: "Extended line", g: "lines", n: 2, st: {...LN, el: true, er: true, lbl: false}, ext: true, lblOpt: "Show change", geom: lineGeom};
DT.hline = {name: "Horizontal line", g: "lines", n: 1, st: {...LN, w: 1, lbl: true}, lblOpt: "Price on the line", key: "H",
  geom(A){ const s = A.st, y = A.P[0].y; A.line(0, y, A.W, y, s.c, s.w, s.ls); if(s.lbl) A.label(A.W - 6, y - 3, [fmt(A.d.pts[0].p, drTick()) + (A.d.text ? "  " + A.d.text : "")], s.c, "bottom", "right"); },
  axP: d => [d.pts[0].p]};
DT.hray = {name: "Horizontal ray", g: "lines", n: 1, st: {...LN, w: 1, lbl: true}, lblOpt: "Price on the line", key: "J",
  geom(A){ const s = A.st, a = A.P[0]; A.line(a.x, a.y, A.W, a.y, s.c, s.w, s.ls); if(s.lbl) A.label(A.W - 6, a.y - 3, [fmt(A.d.pts[0].p, drTick()) + (A.d.text ? "  " + A.d.text : "")], s.c, "bottom", "right"); },
  axP: d => [d.pts[0].p]};
DT.vline = {name: "Vertical line", g: "lines", n: 1, st: {...LN, w: 1}, key: "V", geom(A){ const s = A.st, x = A.P[0].x; A.line(x, 0, x, A.H, s.c, s.w, s.ls); }, axT: d => [d.pts[0].t]};
DT.cross = {name: "Cross line", g: "lines", n: 1, st: {...LN, w: 1}, key: "C",
  geom(A){ const s = A.st, a = A.P[0]; A.line(a.x, 0, a.x, A.H, s.c, s.w, s.ls); A.line(0, a.y, A.W, a.y, s.c, s.w, s.ls); }, axP: d => [d.pts[0].p], axT: d => [d.pts[0].t]};
DT.channel = {name: "Parallel channel", g: "lines", n: 3, st: {...LN, el: false, er: false, fa: 12, mid: true}, ext: true, fill: true,
  geom(A){
    const s = A.st, [a, b, c] = A.P, dy = c && c.y != null ? c.y - (Math.abs(b.x - a.x) < 1e-6 ? a.y : a.y + (b.y - a.y) * (c.x - a.x) / (b.x - a.x)) : 0;
    const L1 = ext(A, a, b, s.el, s.er), L2 = [L1[0], L1[1] + dy, L1[2], L1[3] + dy];
    if(A.d.pts.length > 2) A.poly([[L1[0], L1[1]], [L1[2], L1[3]], [L2[2], L2[3]], [L2[0], L2[1]]], A.fill(s), null);
    A.line(...L1, s.c, s.w, s.ls);
    if(A.d.pts.length > 2){ A.line(...L2, s.c, s.w, s.ls); if(s.mid) A.line(L1[0], L1[1] + dy / 2, L1[2], L1[3] + dy / 2, s.c, 1, 2); }
    A.H_.push({x: a.x, y: a.y, id: 0}, {x: b.x, y: b.y, id: 1});
    if(A.d.pts.length > 2) A.H_.push({x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + dy, id: 2});
  }, handles: false};
DT.regr = {name: "Regression trend", g: "lines", n: 2, st: {...LN, w: 1, dev: 2, fa: 10}, fill: true,
  geom(A){
    const s = A.st, V = A.V, n = DISP.length;
    let i0 = Math.round(A.P[0].L), i1 = Math.round(A.P[1].L); if(i0 > i1) [i0, i1] = [i1, i0];
    i0 = Math.max(0, i0); i1 = Math.min(n - 1, i1);
    if(i1 - i0 < 1){ A.line(A.P[0].x, A.P[0].y, A.P[1].x, A.P[1].y, s.c, 1, 2); return; }
    let sx = 0, sy = 0, sxx = 0, sxy = 0; const m = i1 - i0 + 1;
    for(let i = i0; i <= i1; i++){ const x = i - i0, y = DISP[i].close; sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const bb = (m * sxy - sx * sy) / (m * sxx - sx * sx || 1), aa = (sy - bb * sx) / m;
    let se = 0; for(let i = i0; i <= i1; i++){ const r = DISP[i].close - (aa + bb * (i - i0)); se += r * r; }
    const sd = Math.sqrt(se / m) * (+s.dev || 2), f = i => aa + bb * (i - i0);
    const X0 = V.xL(i0), X1 = V.xL(i1), y = p => V.y(p);
    const up0 = y(f(i0) + sd), up1 = y(f(i1) + sd), dn0 = y(f(i0) - sd), dn1 = y(f(i1) - sd), c0 = y(f(i0)), c1 = y(f(i1));
    if([up0, up1, dn0, dn1, c0, c1].some(v => v == null)) return;
    A.poly([[X0, up0], [X1, up1], [X1, dn1], [X0, dn0]], A.fill(s), null);
    A.line(X0, up0, X1, up1, s.c, s.w, s.ls); A.line(X0, dn0, X1, dn1, s.c, s.w, s.ls); A.line(X0, c0, X1, c1, s.c, s.w, 2);
    A.H_.push({x: X0, y: c0, id: A.P[0].L <= A.P[1].L ? 0 : 1}, {x: X1, y: c1, id: A.P[0].L <= A.P[1].L ? 1 : 0});
  }, handles: false};
DT.pitch = {name: "Pitchfork", g: "lines", n: 3, st: {...LN, fa: 10}, fill: true, geom(A){ pitchGeom(A, 0); }, handles: false};
DT.schiff = {name: "Schiff pitchfork", g: "lines", n: 3, st: {...LN, fa: 10}, fill: true, geom(A){ pitchGeom(A, 1); }, handles: false};
DT.mschiff = {name: "Modified Schiff pitchfork", g: "lines", n: 3, st: {...LN, fa: 10}, fill: true, geom(A){ pitchGeom(A, 2); }, handles: false};
function pitchGeom(A, kind){
  const s = A.st, [p0, p1, p2] = A.P;
  A.H_.push({x: p0.x, y: p0.y, id: 0}, {x: p1.x, y: p1.y, id: 1});
  if(A.d.pts.length < 3 || !p2){ A.line(p0.x, p0.y, p1.x, p1.y, s.c, s.w, s.ls); return; }
  A.H_.push({x: p2.x, y: p2.y, id: 2});
  const o = kind === 0 ? p0 : kind === 1 ? {x: p0.x, y: (p0.y + p1.y) / 2} : {x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2};
  const m = {x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2}, dx = m.x - o.x, dy = m.y - o.y;
  const k = (A.W + A.H) * 4 / (Math.hypot(dx, dy) || 1);
  const far = q => [q.x + dx * k, q.y + dy * k];
  A.poly([[p1.x, p1.y], far(p1), far(p2), [p2.x, p2.y]], A.fill(s), null);
  A.line(o.x, o.y, ...far(o), s.c, s.w, s.ls);
  A.line(p1.x, p1.y, ...far(p1), s.c, s.w, s.ls); A.line(p2.x, p2.y, ...far(p2), s.c, s.w, s.ls);
  A.line(p1.x, p1.y, p2.x, p2.y, s.c, 1, s.ls);
  if(kind) A.line(p0.x, p0.y, o.x, o.y, s.c, 1, 2);
}
/* Fibonacci retracement: 1 at the first point, 0 at the second (as TradingView); levels, colours and fills editable */
DT.fib = {name: "Fib retracement", g: "fib", n: 2, st: {c: "#787b86", w: 1, ls: 0, el: false, er: false, fa: 12, lbl: true, tl: true, rev: false, lv: FIB_LV()}, ext: true, levels: true, fill: true, key: "F",
  geom(A){
    const s = A.st, a = A.P[0], b = A.P[1], p0 = A.d.pts[0].p, p1 = A.d.pts[1].p;
    let x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x); if(s.el) x0 = 0; if(s.er) x1 = A.W;
    const lv = (s.lv || []).filter(l => l[1]).map(l => ({v: +l[0], c: l[2], p: s.rev ? p0 + (p1 - p0) * l[0] : p1 - (p1 - p0) * l[0]})).sort((x, y) => x.v - y.v);
    for(let i = 0; i + 1 < lv.length; i++){ const y0 = A.V.y(lv[i].p), y1 = A.V.y(lv[i + 1].p); if(y0 != null && y1 != null) A.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], rgbaHex(lv[i + 1].c, (+s.fa || 0) / 100), null, 0, 0, false); }
    for(const l of lv){ const y = A.V.y(l.p); if(y == null) continue; A.line(x0, y, x1, y, l.c, s.w, s.ls);
      if(s.lbl) A.label(x0 - 4, y, [`${l.v} (${fmt(l.p, drTick())})`], l.c, "middle", "right", true); }
    if(s.tl) A.line(a.x, a.y, b.x, b.y, s.c, 1, 2);
  }};
DT.fibext = {name: "Trend-based fib extension", g: "fib", n: 3, st: {c: "#787b86", w: 1, ls: 0, er: false, fa: 12, lbl: true, lv: FIB_LV()}, levels: true, fill: true, extR: true,
  geom(A){
    const s = A.st, [a, b, c] = A.P;
    A.line(a.x, a.y, b.x, b.y, s.c, 1, 2);
    if(A.d.pts.length < 3 || !c) return;
    A.line(b.x, b.y, c.x, c.y, s.c, 1, 2);
    const pa = A.d.pts[0].p, pb = A.d.pts[1].p, pc = A.d.pts[2].p;
    const x0 = c.x, x1 = s.er ? A.W : c.x + Math.max(40, Math.abs(b.x - a.x));
    const lv = (s.lv || []).filter(l => l[1]).map(l => ({v: +l[0], c: l[2], p: pc + (pb - pa) * l[0]})).sort((x, y) => x.v - y.v);
    for(let i = 0; i + 1 < lv.length; i++){ const y0 = A.V.y(lv[i].p), y1 = A.V.y(lv[i + 1].p); if(y0 != null && y1 != null) A.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], rgbaHex(lv[i + 1].c, (+s.fa || 0) / 100), null, 0, 0, false); }
    for(const l of lv){ const y = A.V.y(l.p); if(y == null) continue; A.line(x0, y, x1, y, l.c, s.w, s.ls);
      if(s.lbl) A.label(x0 - 4, y, [`${l.v} (${fmt(l.p, drTick())})`], l.c, "middle", "right", true); }
  }};
DT.fibfan = {name: "Fib fan", g: "fib", n: 2, st: {c: "#787b86", w: 1, ls: 0, lbl: true, lv: [[0, 1, "#787b86"], [0.25, 1, "#f23645"], [0.382, 1, "#ff9800"], [0.5, 1, "#4caf50"], [0.618, 1, "#089981"], [0.75, 1, "#00bcd4"], [1, 1, "#787b86"]]}, levels: true,
  geom(A){
    const s = A.st, a = A.P[0], b = A.P[1];
    A.poly([[a.x, a.y], [b.x, a.y], [b.x, b.y], [a.x, b.y]], null, rgbaHex(s.c, 0.35), 1, 2);
    for(const l of (s.lv || []).filter(l => l[1])){
      const v = +l[0], qp = {x: b.x, y: a.y + (b.y - a.y) * v}, qt = {x: a.x + (b.x - a.x) * v, y: b.y};
      A.line(...ext(A, a, qp, false, true), l[2], s.w, s.ls);
      if(v > 0 && v < 1) A.line(...ext(A, a, qt, false, true), l[2], s.w, s.ls);
      if(s.lbl){ A.label(b.x + 4, qp.y, [String(v)], l[2], "middle", "left", true); }
    }
  }};
DT.fibtime = {name: "Fib time zone", g: "fib", n: 2, st: {c: "#2962ff", w: 1, ls: 0, lbl: true},
  geom(A){
    const s = A.st, a = A.P[0], b = A.P[1], u = b.L - a.L, seq = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];
    A.line(a.x, a.y, b.x, b.y, s.c, 1, 2);
    for(const k of seq){ if(k && !u) break; const x = A.V.xL(a.L + k * u); if(x < -50 || x > A.W + 50) continue;
      A.line(x, 0, x, A.H, s.c, s.w, s.ls); if(s.lbl) A.label(x + 3, A.H - 6, [String(k)], s.c, "bottom", "left", true); }
  }};
DT.gannfan = {name: "Gann fan", g: "fib", n: 2, st: {c: "#787b86", w: 1, ls: 0, lbl: true},
  geom(A){
    const s = A.st, a = A.P[0], b = A.P[1], dx = b.x - a.x, dy = b.y - a.y;
    const R = [[1, 8], [1, 4], [1, 3], [1, 2], [1, 1], [2, 1], [3, 1], [4, 1], [8, 1]], cols = ["#9c27b0", "#2962ff", "#00bcd4", "#089981", "#787b86", "#4caf50", "#ff9800", "#f23645", "#e91e63"];
    R.forEach(([p, t], i) => { const q = {x: a.x + dx, y: a.y + dy * p / t};
      A.line(...ext(A, a, q, false, true), cols[i], s.w, s.ls); if(s.lbl) A.label(q.x + 4, q.y, [`${p}×${t}`], cols[i], "middle", "left", true); });
  }};
DT.gannbox = {name: "Gann box", g: "fib", n: 2, st: {c: "#787b86", w: 1, ls: 0, fa: 8, lbl: true, lv: GANN_LV()}, levels: true, fill: true,
  geom(A){
    const s = A.st, a = A.P[0], b = A.P[1];
    A.poly([[a.x, a.y], [b.x, a.y], [b.x, b.y], [a.x, b.y]], A.fill(s), s.c, s.w, s.ls);
    for(const l of (s.lv || []).filter(l => l[1])){ const v = +l[0], x = a.x + (b.x - a.x) * v, y = a.y + (b.y - a.y) * v;
      A.line(x, a.y, x, b.y, l[2], 1, s.ls); A.line(a.x, y, b.x, y, l[2], 1, s.ls);
      if(s.lbl){ A.label(x, Math.min(a.y, b.y) - 3, [String(v)], l[2], "bottom", "center", true); A.label(Math.min(a.x, b.x) - 4, y, [String(v)], l[2], "middle", "right", true); } }
    A.line(a.x, a.y, b.x, b.y, s.c, 1, 2); A.line(a.x, b.y, b.x, a.y, s.c, 1, 2);
  }, handles: "box"};
/* shapes */
const SH = {c: "#9c27b0", w: 2, ls: 0, fc: "#9c27b0", fa: 20};
DT.rect = {name: "Rectangle", g: "shapes", n: 2, st: {...SH}, fill: true, text: true, key: "R", geom(A){ const s = A.st, a = A.P[0], b = A.P[1];
  A.poly([[a.x, a.y], [b.x, a.y], [b.x, b.y], [a.x, b.y]], A.fill(s), s.c, s.w, s.ls);
  if(A.d.text) A.label((a.x + b.x) / 2, (a.y + b.y) / 2, A.d.text.split("\n"), s.tc || s.c, "middle", "center", true); }, handles: "box"};
DT.ellipse = {name: "Ellipse", g: "shapes", n: 2, st: {...SH}, fill: true, text: true, geom(A){ const s = A.st, a = A.P[0], b = A.P[1];
  A.ell((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, A.fill(s), s.c, s.w, s.ls);
  if(A.d.text) A.label((a.x + b.x) / 2, (a.y + b.y) / 2, A.d.text.split("\n"), s.tc || s.c, "middle", "center", true); }, handles: "box"};
DT.tri = {name: "Triangle", g: "shapes", n: 3, st: {...SH}, fill: true, geom(A){ const s = A.st; A.poly(A.P.filter(p => p.x != null).map(p => [p.x, p.y]), A.fill(s), s.c, s.w, s.ls, true); }};
DT.path = {name: "Path", g: "shapes", n: -1, st: {c: "#2962ff", w: 2, ls: 0, arr: true}, geom(A){ const s = A.st;
  A.poly(A.P.map(p => [p.x, p.y]), null, s.c, s.w, s.ls, false); if(s.arr && A.P.length > 1) A.head(A.P[A.P.length - 2], A.P[A.P.length - 1], s.c, s.w); }};
DT.brush = {name: "Brush", g: "shapes", n: -2, free: true, st: {c: "#2962ff", w: 3, ls: 0}, geom(A){ const s = A.st;
  A.poly(A.P.map(p => [p.x, p.y]), null, s.c, s.w, 0, false, true); }, handles: false};
/* text and arrows */
DT.text = {name: "Text", g: "text", n: 1, st: {c: "#2962ff", fs: 14, bg: false, fc: "#2962ff", fa: 15}, text: true, fill: true, noWidth: true,
  geom(A){ const s = A.st, a = A.P[0]; A.label(a.x, a.y, (A.d.text || "Text").split("\n"), s.c, "middle", "left", false, {fs: s.fs, bg: s.bg ? A.fill(s) : "", bd: s.bg ? s.c : "", pad: s.bg ? 6 : 1, sans: true}); }};
DT.note = {name: "Note", g: "text", n: 1, st: {c: "#e0b341", fs: 13, fc: "#e0b341", fa: 22}, text: true, noWidth: true,
  geom(A){ const s = A.st, a = A.P[0];
    A.ell(a.x, a.y, 4, 4, s.c, s.c, 1, 0);
    A.label(a.x + 8, a.y - 8, (A.d.text || "Note").split("\n"), cssVar("--text"), "bottom", "left", false, {fs: s.fs, bg: A.fill(s), bd: s.c, pad: 7, sans: true, wrap: 240}); }};
DT.callout = {name: "Callout", g: "text", n: 2, st: {c: "#2962ff", fs: 13, fc: "#2962ff", fa: 85, w: 1}, text: true, fill: true,
  geom(A){ const s = A.st, a = A.P[0], b = A.P[1];
    A.line(a.x, a.y, b.x, b.y, s.c, s.w, 0);
    A.label(b.x, b.y, (A.d.text || "Callout").split("\n"), textOn(s.fc), "middle", "center", false, {fs: s.fs, bg: A.fill(s), bd: s.c, pad: 7, sans: true, wrap: 260}); }};
DT.plabel = {name: "Price label", g: "text", n: 1, st: {c: "#2962ff", fs: 12}, noWidth: true,
  geom(A){ const s = A.st, a = A.P[0], t = fmt(A.d.pts[0].p, drTick()) + (A.d.text ? "  " + A.d.text : "");
    A.poly([[a.x, a.y], [a.x + 8, a.y - 9], [a.x + 8, a.y + 9]], s.c, null);
    A.label(a.x + 8, a.y, [t], textOn(s.c), "middle", "left", false, {fs: s.fs, bg: s.c, bd: s.c, pad: 5}); }, text: true, axP: d => [d.pts[0].p]};
DT.arrow = {name: "Arrow", g: "text", n: 2, st: {...LN}, ext: false, geom: lineGeom};
const markGeom = up => function(A){ const s = A.st, a = A.P[0], z = 6 + 3 * (s.w || 2), d = up ? 1 : -1;
  A.poly([[a.x, a.y], [a.x + z, a.y + d * z], [a.x + z / 2.4, a.y + d * z], [a.x + z / 2.4, a.y + d * z * 2], [a.x - z / 2.4, a.y + d * z * 2], [a.x - z / 2.4, a.y + d * z], [a.x - z, a.y + d * z]], s.c, null, 0, 0, true);
  if(A.d.text) A.label(a.x, a.y + d * (z * 2 + 4), A.d.text.split("\n"), s.c, up ? "top" : "bottom", "center", false, {fs: 12, sans: true}); };
DT.arup = {name: "Arrow mark up", g: "text", n: 1, st: {c: "#089981", w: 2}, text: true, geom: markGeom(true)};
DT.ardn = {name: "Arrow mark down", g: "text", n: 1, st: {c: "#f23645", w: 2}, text: true, geom: markGeom(false)};
/* ranges */
const RG = {c: "#2962ff", w: 1, fa: 15};
function rangeGeom(A, kind){
  const s = A.st, a = A.P[0], b = A.P[1], up = A.d.pts[1].p >= A.d.pts[0].p;
  A.poly([[a.x, a.y], [b.x, a.y], [b.x, b.y], [a.x, b.y]], rgbaHex(s.c, (+s.fa || 0) / 100), null);
  const xm = (a.x + b.x) / 2, ym = (a.y + b.y) / 2;
  if(kind !== "d"){ A.line(a.x, a.y, b.x, a.y, s.c, s.w, 0); A.line(a.x, b.y, b.x, b.y, s.c, s.w, 0); A.line(xm, a.y, xm, b.y, s.c, s.w, 0); A.head({x: xm, y: a.y}, {x: xm, y: b.y}, s.c, s.w); }
  if(kind !== "p"){ A.line(a.x, a.y, a.x, b.y, s.c, s.w, 0); A.line(b.x, a.y, b.x, b.y, s.c, s.w, 0); A.line(a.x, ym, b.x, ym, s.c, s.w, 0); A.head({x: a.x, y: ym}, {x: b.x, y: ym}, s.c, s.w); }
  const L = [];
  if(kind !== "d") L.push(drPriceInfo(A.d.pts[0].p, A.d.pts[1].p));
  if(kind !== "p") L.push(drTimeInfo(A.d.pts[0], A.d.pts[1], a.L, b.L));
  if(kind === "dp" && s.money !== false) L.push(...drMoneyLines(A.d.pts[0].p, A.d.pts[1].p));
  A.label(xm, up ? Math.min(a.y, b.y) - 6 : Math.max(a.y, b.y) + 6, L, textOn(s.c), up ? "bottom" : "top", "center", false, {bg: s.c, bd: s.c, pad: 6});
}
DT.prange = {name: "Price range", g: "range", n: 2, st: {...RG}, geom(A){ rangeGeom(A, "p"); }, handles: "box"};
DT.drange = {name: "Date range", g: "range", n: 2, st: {...RG}, geom(A){ rangeGeom(A, "d"); }, handles: "box"};
DT.dprange = {name: "Date & price range", g: "range", n: 2, st: {...RG, money: true}, geom(A){ rangeGeom(A, "dp"); }, handles: "box"};
function posGeom(A){
  const d = A.d, s = A.st, side = d.type === "long" ? 1 : -1, V = A.V, C = chartCfg();
  const e = A.P[0], xe = A.P[1].x, ytp = V.y(d.pts[1].p), ysl = V.y(d.pts[2].p);
  if(e.x == null || xe == null || ytp == null || ysl == null) return;
  const x0 = e.x, x1 = Math.max(xe, x0 + 8), tick = drTick();
  const up = s.pc || C.profitZ, dn = s.lc || C.lossZ, a = (+s.fa || 20) / 100;
  A.poly([[x0, e.y], [x1, e.y], [x1, ytp], [x0, ytp]], rgbaHex(up, a), null);
  A.poly([[x0, e.y], [x1, e.y], [x1, ysl], [x0, ysl]], rgbaHex(dn, a), null);
  A.line(x0, e.y, x1, e.y, cssVar("--muted"), 1, 0);
  const lots = Math.max(1, Math.round(+d.lots || drLots())), qty = lots * (drRow().lot || 1), ev = drPosEval(d);
  const legs = [{side, qty, entry: d.pts[0].p, exit: d.pts[1].p}, {side, qty, entry: d.pts[0].p, exit: d.pts[2].p}];
  if(ev.px) legs.push({side, qty, entry: d.pts[0].p, exit: ev.px});
  const m = drMoney(legs), rr = m && m[1].net < 0 ? m[0].net / -m[1].net : null;
  const pts = (p, q) => `${drSign(q - p)}${fmt(Math.abs(q - p), tick)} (${(Math.abs(q - p) / p * 100).toFixed(2)}%)`;
  const money = i => m === undefined ? "…" : m ? rsS(m[i].net) : "–";
  A.label((x0 + x1) / 2, side > 0 ? Math.min(ytp, e.y) - 4 : Math.max(ytp, e.y) + 4, [`Target ${fmt(d.pts[1].p, tick)}: ${pts(d.pts[0].p, d.pts[1].p)} · ${money(0)}`], textOn(up), side > 0 ? "bottom" : "top", "center", false, {bg: up, bd: up, pad: 5});
  A.label((x0 + x1) / 2, side > 0 ? Math.max(ysl, e.y) + 4 : Math.min(ysl, e.y) - 4, [`Stop ${fmt(d.pts[2].p, tick)}: ${pts(d.pts[0].p, d.pts[2].p)} · ${money(1)}`], textOn(dn), side > 0 ? "top" : "bottom", "center", false, {bg: dn, bd: dn, pad: 5});
  // the outcome, from the real candles
  let res = "";
  if(ev.kind === "tp") res = `Target hit ${drTimeStr(ev.t)} (${ev.bars} bar${ev.bars === 1 ? "" : "s"})`;
  else if(ev.kind === "sl") res = `Stop hit ${drTimeStr(ev.t)} (${ev.bars} bar${ev.bars === 1 ? "" : "s"})`;
  else if(ev.kind === "both") res = `Stop and target in one candle ${drTimeStr(ev.t)}: order unknown, counted as the stop`;
  else if(ev.kind === "open") res = `Still open at ${drTimeStr(ev.t)}`;
  else res = "No candles after the entry yet";
  if(ev.px && m) res += ` · ${rsS(m[2].net)}${rr ? ` (${(m[2].net / -m[1].net).toFixed(2)}R)` : ""}`;
  const head = `${side > 0 ? "Long" : "Short"} ${lots} lot${lots === 1 ? "" : "s"} @ ${fmt(d.pts[0].p, tick)}${rr != null ? ` · R:R ${rr.toFixed(2)}` : ""}`;
  A.label(x1 + 6, e.y, [head, res], cssVar("--text"), "middle", "left", false, {bg: cssVar("--panel"), bd: cssVar("--line"), pad: 5});
  // the path to the exit: a dashed line from the entry to where it closed, the stretch in between shaded
  if(ev.px){
    const xx = A.V.xL(t2L(ev.t)), yx = V.y(ev.px);
    if(xx != null && yx != null){
      const hit = ev.kind === "tp" ? up : ev.kind === "open" ? cssVar("--muted") : dn;
      A.poly([[x0, e.y], [xx, e.y], [xx, yx], [x0, yx]], rgbaHex(hit, 0.18), null, 0, 0, false);
      A.line(x0, e.y, xx, yx, hit, 1.5, 2); A.ell(xx, yx, 3.5, 3.5, hit, hit, 1, 0);
    }
  }
  A.H_.push({x: x0, y: e.y, id: "e"}, {x: x0, y: ytp, id: "tp"}, {x: x0, y: ysl, id: "sl"}, {x: x1, y: e.y, id: "end"});
}
DT.long = {name: "Long position", g: "range", n: 1, st: {fa: 20}, pos: true, geom: posGeom, handles: false};
DT.short = {name: "Short position", g: "range", n: 1, st: {fa: 20}, pos: true, geom: posGeom, handles: false};

const DR_GROUPS = [
  ["lines", "Lines", ["trend", "ray", "extl", "hline", "hray", "vline", "cross", "channel", "regr", "pitch", "schiff", "mschiff"]],
  ["fib", "Fibonacci and Gann", ["fib", "fibext", "fibfan", "fibtime", "gannfan", "gannbox"]],
  ["shapes", "Shapes", ["rect", "ellipse", "tri", "path", "brush"]],
  ["text", "Text and arrows", ["text", "note", "callout", "plabel", "arrow", "arup", "ardn"]],
  ["range", "Positions and ranges", ["long", "short", "prange", "drange", "dprange"]]
];

/* ---------------------------------------------------------------- styles */
function drStyleOf(d){
  const T = DT[d.type] || {}, base = {...(T.st || {})};
  if(base.lv) base.lv = base.lv.map(l => l.slice());
  return {...base, ...(d.st || {})};
}
function drNewStyle(type){
  const T = DT[type], own = (drPref().styles || {})[type] || {};
  const st = {...JSON.parse(JSON.stringify(T.st || {})), ...JSON.parse(JSON.stringify(own))};
  return st;
}

/* ---------------------------------------------------------------- geometry of one drawing, for drawing and for hit tests */
function drGeom(d, V, W, H, ctx){
  const T = DT[d.type]; if(!T) return null;
  const st = drStyleOf(d);
  const G = {L: [], F: [], E: [], X: [], H: [], d};
  const P = d.pts.map(p => ({...drXY(V, p, T.free)}));
  if(P.some(p => p.x == null || p.y == null) && !T.pos) return null;
  if(T.pos){ P[1] = drXY(V, d.pts[1]); }
  const A = {
    d, st, V, W, H, P, H_: G.H,
    fill: s => s.fc || s.c ? rgbaHex(s.fc || s.c, (s.fa == null ? 20 : +s.fa) / 100) : null,
    line(x1, y1, x2, y2, c, w, ls){ if([x1, y1, x2, y2].some(v => v == null || isNaN(v))) return; G.L.push({x1, y1, x2, y2, c, w: w || 1, ls: ls || 0}); },
    poly(pts, fill, stroke, w, ls, closed = true, smooth){ if(pts.length < 1 || pts.some(p => p[0] == null || p[1] == null)) return; G.F.push({pts, fill, stroke, w: w || 1, ls: ls || 0, closed, smooth}); },
    ell(cx, cy, rx, ry, fill, stroke, w, ls){ G.E.push({cx, cy, rx, ry, fill, stroke, w: w || 1, ls: ls || 0}); },
    head(a, b, c, w){ const ang = Math.atan2(b.y - a.y, b.x - a.x), z = 8 + 2 * (w || 1);
      G.F.push({pts: [[b.x, b.y], [b.x - z * Math.cos(ang - 0.42), b.y - z * Math.sin(ang - 0.42)], [b.x - z * Math.cos(ang + 0.42), b.y - z * Math.sin(ang + 0.42)]], fill: c, stroke: null, w: 1, ls: 0, closed: true}); },
    label(x, y, lines, c, base = "middle", align = "center", plain, o = {}){
      lines = (lines || []).filter(l => l != null && l !== ""); if(!lines.length || x == null || y == null) return;
      const fs = o.fs || (plain ? 11 : 12), font = `${fs}px ${o.sans ? '"IBM Plex Sans", sans-serif' : '"IBM Plex Mono", monospace'}`;
      ctx.font = font;
      if(o.wrap){ const out = []; for(const ln of lines){ let curL = ""; for(const w of ln.split(" ")){ const t = curL ? curL + " " + w : w; if(ctx.measureText(t).width > o.wrap && curL){ out.push(curL); curL = w; } else curL = t; } out.push(curL); } lines = out; }
      const pad = o.pad == null ? (plain ? 0 : 0) : o.pad, lh = Math.round(fs * 1.35);
      const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + pad * 2, h = lines.length * lh + pad * 2 - (pad ? 0 : 2);
      let bx = align === "center" ? x - w / 2 : align === "right" ? x - w : x, by = base === "middle" ? y - h / 2 : base === "bottom" ? y - h : y;
      G.X.push({x: bx, y: by, w, h, lines, c, font, lh, pad, bg: o.bg, bd: o.bd, align});
    }
  };
  try{ T.geom(A); }catch(e){ return null; }
  if(T.handles === "box" && P[0].x != null && P[1] && P[1].x != null)
    G.H.push({x: P[0].x, y: P[0].y, id: 0}, {x: P[1].x, y: P[1].y, id: 1}, {x: P[0].x, y: P[1].y, id: "a"}, {x: P[1].x, y: P[0].y, id: "b"});
  else if(T.handles !== false) P.forEach((p, i) => { if(p.x != null) G.H.push({x: p.x, y: p.y, id: i}); });
  return G;
}
function drDash(ctx, ls, w){ ctx.setLineDash(ls === 1 ? [Math.max(1.5, w), Math.max(2.5, w * 2)] : ls === 2 ? [6 + w, 4 + w] : ls === 3 ? [12, 6] : []); }
function drPaint(ctx, G, sel, hov){
  for(const f of G.F){
    ctx.beginPath();
    if(f.smooth && f.pts.length > 2){
      ctx.moveTo(f.pts[0][0], f.pts[0][1]);
      for(let i = 1; i < f.pts.length - 1; i++){ const mx = (f.pts[i][0] + f.pts[i + 1][0]) / 2, my = (f.pts[i][1] + f.pts[i + 1][1]) / 2; ctx.quadraticCurveTo(f.pts[i][0], f.pts[i][1], mx, my); }
      ctx.lineTo(f.pts[f.pts.length - 1][0], f.pts[f.pts.length - 1][1]);
    } else f.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    if(f.closed) ctx.closePath();
    if(f.fill && f.closed){ ctx.fillStyle = f.fill; ctx.fill(); }
    if(f.stroke){ ctx.strokeStyle = f.stroke; ctx.lineWidth = f.w + (hov ? 0.6 : 0); drDash(ctx, f.ls, f.w); ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke(); }
  }
  for(const l of G.L){ ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.strokeStyle = l.c; ctx.lineWidth = l.w + (hov ? 0.6 : 0); drDash(ctx, l.ls, l.w); ctx.lineCap = "butt"; ctx.stroke(); }
  ctx.setLineDash([]);
  for(const e of G.E){ ctx.beginPath(); ctx.ellipse(e.cx, e.cy, Math.max(0.5, e.rx), Math.max(0.5, e.ry), 0, 0, 2 * Math.PI);
    if(e.fill){ ctx.fillStyle = e.fill; ctx.fill(); } if(e.stroke){ ctx.strokeStyle = e.stroke; ctx.lineWidth = e.w; drDash(ctx, e.ls, e.w); ctx.stroke(); ctx.setLineDash([]); } }
  for(const t of G.X){
    if(t.bg){ ctx.fillStyle = t.bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(t.x, t.y, t.w, t.h, 4) : ctx.rect(t.x, t.y, t.w, t.h); ctx.fill(); }
    if(t.bd){ ctx.strokeStyle = t.bd; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(t.x + .5, t.y + .5, t.w - 1, t.h - 1, 4) : ctx.rect(t.x + .5, t.y + .5, t.w - 1, t.h - 1); ctx.stroke(); }
    ctx.font = t.font; ctx.fillStyle = t.c; ctx.textBaseline = "middle"; ctx.textAlign = t.align === "center" ? "center" : "left";
    t.lines.forEach((ln, i) => ctx.fillText(ln, t.align === "center" ? t.x + t.w / 2 : t.x + t.pad, t.y + t.pad + t.lh * i + t.lh / 2));
  }
  if(sel){
    const r = DR.touch ? 7 : 4.5;
    for(const h of G.H){ ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, 2 * Math.PI); ctx.fillStyle = cssVar("--bg"); ctx.fill(); ctx.strokeStyle = cssVar("--accent"); ctx.lineWidth = 1.6; ctx.stroke(); }
  }
}

/* ---------------------------------------------------------------- hit tests */
function drSegDist(x, y, a, b, c, d){ const dx = c - a, dy = d - b, L = dx * dx + dy * dy; let t = L ? ((x - a) * dx + (y - b) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - (a + t * dx), y - (b + t * dy)); }
function drInPoly(x, y, pts){ let c = false; for(let i = 0, j = pts.length - 1; i < pts.length; j = i++){ const [xi, yi] = pts[i], [xj, yj] = pts[j]; if((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
function drHitG(G, x, y, sel){
  const tol = DR.touch ? 12 : 6, ht = DR.touch ? 16 : 8;
  if(sel) for(const h of G.H) if(Math.hypot(h.x - x, h.y - y) <= ht) return {part: "h", id: h.id};
  for(const t of G.X) if(x >= t.x - 2 && x <= t.x + t.w + 2 && y >= t.y - 2 && y <= t.y + t.h + 2) return {part: "b"};
  for(const l of G.L) if(drSegDist(x, y, l.x1, l.y1, l.x2, l.y2) <= tol + l.w / 2) return {part: "b"};
  for(const e of G.E){ const nx = (x - e.cx) / Math.max(1, e.rx), ny = (y - e.cy) / Math.max(1, e.ry), r = Math.hypot(nx, ny);
    if(e.fill ? r <= 1.05 : Math.abs(r - 1) * Math.min(e.rx, e.ry) <= tol) return {part: "b"}; }
  for(const f of G.F){
    if(f.fill && f.closed && f.pts.length > 2 && drInPoly(x, y, f.pts)) return {part: "b"};
    if(f.stroke) for(let i = 0; i + 1 < f.pts.length + (f.closed ? 1 : 0); i++){ const a = f.pts[i], b = f.pts[(i + 1) % f.pts.length]; if(drSegDist(x, y, a[0], a[1], b[0], b[1]) <= tol + f.w / 2) return {part: "b"}; }
  }
  return null;
}
function drHit(x, y){
  if(drPref().hideAll) return null;
  const order = DR.items.slice().reverse();
  if(DR.sel){ const i = order.findIndex(d => d.id === DR.sel); if(i > 0) order.unshift(order.splice(i, 1)[0]); }
  for(const d of order){ if(d.hide) continue; const G = DR.geo.get(d.id); if(!G) continue; const h = drHitG(G, x, y, d.id === DR.sel); if(h) return {d, ...h}; }
  return null;
}

/* ---------------------------------------------------------------- the chart primitive */
class DrAxis {
  constructor(){ this.y = 0; this.t = ""; this.bg = "#2962ff"; }
  coordinate(){ return this.y; } text(){ return this.t; } textColor(){ return textOn(this.bg); } backColor(){ return this.bg; }
  visible(){ return true; } tickVisible(){ return true; }
}
class DrawPrim {
  constructor(){ this.req = null; const self = this; this.pv = [{zOrder: () => "top", renderer: () => ({draw: t => self.draw(t)})}]; this.pav = []; this.tav = []; }
  attached(p){ this.req = p.requestUpdate; }
  detached(){ this.req = null; }
  paneViews(){ return this.pv; }
  priceAxisViews(){ return this.pav; }
  timeAxisViews(){ return this.tav; }
  updateAllViews(){
    const pav = [], tav = [], V = drView();
    if(V && !drPref().hideAll){
      const add = (arr, coord, txt, bg) => { if(coord == null || isNaN(coord)) return; const a = new DrAxis(); a.y = coord; a.t = txt; a.bg = bg; arr.push(a); };
      for(const d of DR.items){
        if(d.hide) continue; const T = DT[d.type]; if(!T) continue; const st = drStyleOf(d), sel = d.id === DR.sel;
        const ps = sel ? d.pts.map(p => p.p) : T.axP ? T.axP(d) : [], tsx = sel ? d.pts.map(p => p.t) : T.axT ? T.axT(d) : [];
        if(T.pos && sel) ps.splice(0, ps.length, d.pts[0].p, d.pts[1].p, d.pts[2].p);
        for(const p of ps) add(pav, V.y(p), fmt(p, drTick()), sel ? cssVar("--accent") : st.c || "#2962ff");
        for(const t of tsx){ const L = t2L(t, T.free); if(L != null) add(tav, V.xL(L), drTimeStr(t), sel ? cssVar("--accent") : st.c || "#2962ff"); }
      }
      const m = DR.meas; if(m && m.pts[1]){ const c = m.pts[1].p >= m.pts[0].p ? chartCfg().up : chartCfg().down;
        for(const p of m.pts){ add(pav, V.y(p.p), fmt(p.p, drTick()), c); const L = t2L(p.t); if(L != null) add(tav, V.xL(L), drTimeStr(p.t), c); } }
    }
    this.pav = pav; this.tav = tav;
  }
  hitTest(x, y){
    if(DR.tool || DR.measArm) return {cursorStyle: "crosshair", externalId: "drawtool", zOrder: "top"};
    if(DR.drag) return {cursorStyle: DR.drag.part === "h" ? "grabbing" : "move", externalId: "drawing", zOrder: "top"};
    const h = drHit(x, y); if(!h) return null;
    const lock = h.d.lock || drPref().lockAll;
    return {cursorStyle: lock ? "pointer" : h.part === "h" ? "grab" : h.d.id === DR.sel ? "move" : "pointer", externalId: "drawing:" + h.d.id, zOrder: "top"};
  }
  draw(target){
    target.useMediaCoordinateSpace(({context: ctx, mediaSize: size}) => {
      DR.geo.clear();
      const V = drView(); if(!V) return;
      const W = size.width, H = size.height, hideAll = drPref().hideAll;
      for(const d of DR.items){
        if(d.hide || hideAll) continue;
        const G = drGeom(d, V, W, H, ctx); if(!G) continue;
        DR.geo.set(d.id, G);
        drPaint(ctx, G, d.id === DR.sel, d.id === DR.hoverId);
      }
      if(DR.draft && DR.draft.d && !DR.items.includes(DR.draft.d)){ const G = drGeom(DR.draft.d, V, W, H, ctx); if(G) drPaint(ctx, G, true, false); }
      if(DR.meas && DR.meas.pts[1]) drPaintMeasure(ctx, V, W, H);
      if(DR.crossAt && (DR.tool || DR.measArm)){ const c = DR.crossAt; ctx.beginPath(); ctx.arc(c.x, c.y, 3.5, 0, 2 * Math.PI); ctx.fillStyle = cssVar("--accent"); ctx.fill(); }
    });
  }
}
/* the measure box (Shift+click / Shift+drag, the ruler button, or a middle-button drag): green up, red down; change in
   points, %, ticks (boxes on P&F), bars, time, volume; the net ₹ for your lots and R for your trade */
function drPaintMeasure(ctx, V, W, H){
  const m = DR.meas, a = drXY(V, m.pts[0]), b = drXY(V, m.pts[1]); if(a.x == null || b.x == null || a.y == null || b.y == null) return;
  const C = chartCfg(), up = m.pts[1].p >= m.pts[0].p, c = up ? C.up : C.down;
  const G = {L: [], F: [], E: [], X: [], H: []};
  const A = {W, H, line: (x1, y1, x2, y2, cc, w, ls) => G.L.push({x1, y1, x2, y2, c: cc, w, ls: ls || 0})};
  G.F.push({pts: [[a.x, a.y], [b.x, a.y], [b.x, b.y], [a.x, b.y]], fill: rgbaHex(c, 0.18), closed: true});
  const xm = (a.x + b.x) / 2, ym = (a.y + b.y) / 2;
  A.line(xm, a.y, xm, b.y, c, 1.5); A.line(a.x, ym, b.x, ym, c, 1.5);
  const head = (p, q) => { const ang = Math.atan2(q.y - p.y, q.x - p.x), z = 9; G.F.push({pts: [[q.x, q.y], [q.x - z * Math.cos(ang - 0.42), q.y - z * Math.sin(ang - 0.42)], [q.x - z * Math.cos(ang + 0.42), q.y - z * Math.sin(ang + 0.42)]], fill: c, closed: true}); };
  if(Math.abs(b.y - a.y) > 12) head({x: xm, y: a.y}, {x: xm, y: b.y});
  if(Math.abs(b.x - a.x) > 12) head({x: a.x, y: ym}, {x: b.x, y: ym});
  const lines = [drPriceInfo(m.pts[0].p, m.pts[1].p), drTimeInfo(m.pts[0], m.pts[1], a.L, b.L), ...drMoneyLines(m.pts[0].p, m.pts[1].p)];
  ctx.font = '12px "IBM Plex Mono", monospace';
  const lh = 16, pad = 7, w = Math.max(...lines.map(l => ctx.measureText(l).width)) + pad * 2, h = lines.length * lh + pad * 2;
  let bx = b.x + 14, by = up ? b.y - h - 10 : b.y + 10;                 // next to the cursor, like MT5's ruler
  if(bx + w > W - 4) bx = b.x - w - 14; bx = Math.max(2, Math.min(W - w - 4, bx)); if(by < 2) by = 2; if(by + h > H - 2) by = H - h - 2;
  G.X.push({x: bx, y: by, w, h, lines, c: textOn(c), font: ctx.font, lh, pad, bg: c, bd: c, align: "left"});
  drPaint(ctx, G, false, false);
}
function drRedraw(){ if(DR.prim && DR.prim.req) DR.prim.req(); }
function drAttach(){
  if(!series || DR.primSeries === series) return;
  DR.prim = new DrawPrim(); series.attachPrimitive(DR.prim); DR.primSeries = series;
  if(cur && DR.s !== cur.s) drSymbol(cur.s);
  if(typeof drUiChart === "function") drUiChart();
}

/* ---------------------------------------------------------------- storage: per contract, on the server */
function drSaveSoon(){ DR.dirty = true; clearTimeout(DR.saveT); DR.saveT = setTimeout(drSaveNow, 700); }
async function drSaveNow(){
  clearTimeout(DR.saveT); if(!DR.dirty || !DR.s) return;
  DR.dirty = false;
  const j = await api("/api/drawings", {body: {s: DR.s, items: DR.items}});
  if(!j.ok){ toast("Drawings not saved: " + (j.error || "error")); }
}
async function drSymbol(s){
  if(DR.s === s && DR.loaded) return;
  if(DR.dirty && DR.s) await drSaveNow();
  DR.s = s; DR.items = []; DR.sel = null; DR.draft = null; DR.drag = null; DR.meas = null; DR.undo = []; DR.redo = []; DR.loaded = false;
  if(typeof drUiSel === "function") drUiSel();
  const my = ++DR.loadSeq;
  const j = await api("/api/drawings?s=" + encodeURIComponent(s));
  if(my !== DR.loadSeq || DR.s !== s) return;
  const made = DR.items;                                   // drawn while the list was loading
  DR.items = (j.ok ? j.items || [] : []).filter(d => d && DT[d.type] && Array.isArray(d.pts)).concat(made);
  DR.loaded = true;
  if(made.length) drSaveSoon();
  drRedraw(); if(typeof drUiList === "function") drUiList();
}
function drChanged(snap = true){
  if(snap){ DR.undo.push(DR.lastSnap); if(DR.undo.length > 80) DR.undo.shift(); DR.redo = []; }
  drSaveSoon(); drRedraw(); if(typeof drUiSel === "function") drUiSel(); if(typeof drUiList === "function") drUiList();
}
/* call before a change: remembers how things were for Ctrl+Z */
function drBefore(){ DR.lastSnap = JSON.stringify(DR.items); }
function drUndo(redo){
  const from = redo ? DR.redo : DR.undo, to = redo ? DR.undo : DR.redo;
  if(!from.length) return;
  to.push(JSON.stringify(DR.items)); DR.items = JSON.parse(from.pop());
  if(DR.sel && !DR.items.some(d => d.id === DR.sel)) DR.sel = null;
  drChanged(false);
}
function drId(){ return Math.random().toString(36).slice(2, 10); }
function drFind(id){ return DR.items.find(d => d.id === id); }
function drRemove(id){ drBefore(); DR.items = DR.items.filter(d => d.id !== id); if(DR.sel === id) DR.sel = null; drChanged(); }
function drClone(d, shift = 3){
  drBefore();
  const c = JSON.parse(JSON.stringify(d)); c.id = drId(); c.lock = false;
  c.pts = c.pts.map(p => { const L = t2L(p.t, DT[c.type].free); return {t: L == null ? p.t : L2t(L + shift), p: p.p}; });
  DR.items.push(c); DR.sel = c.id; drChanged(); return c;
}
/* a style change on a drawing also becomes that tool's default (as TradingView remembers your last style) */
function drSetStyle(d, ch){
  drBefore();
  d.st = {...drStyleOf(d), ...ch};
  const all = {...(drPref().styles || {})}; const keep = {...(all[d.type] || {})};
  for(const k of Object.keys(ch)) keep[k] = ch[k];
  if(d.st.lv) keep.lv = d.st.lv;
  all[d.type] = keep; drPrefSet({styles: all});
  drChanged();
}

/* ---------------------------------------------------------------- placing, selecting and dragging */
function drSetTool(type){
  DR.tool = type || null; DR.draft = null; DR.measArm = false;
  if(type){ DR.sel = null; const T = DT[type]; const last = {...(drPref().last || {})}; last[T.g] = type; drPrefSet({last}); }
  if(typeof drUiTools === "function") drUiTools();
  if(typeof drUiSel === "function") drUiSel();
  drRedraw();
}
function drLocal(e){
  const box = $("#chart"), r = box.getBoundingClientRect(), src = e.touches && e.touches.length ? e.touches[0] : e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e;
  const x = src.clientX - r.left, y = src.clientY - r.top;
  let W = r.width - 60, H = r.height - 28;
  try{ W = chart.timeScale().width(); H = chart.panes()[0].getHeight(); }catch(err){}
  return {x, y, inPane: x >= 0 && y >= 0 && x < W && y < H, W, H};
}
function drOnCanvas(e){ const t = e.target; return t && t.tagName === "CANVAS" && $("#chart").contains(t); }
function drNearTradeLine(y){                               // the trade manager's SL / TP / entry lines win
  if(typeof P === "undefined" || !series) return false;
  for(const d of P.drags || []){ const pr = d.price && d.price(); if(pr == null) continue; const yy = series.priceToCoordinate(pr); if(yy != null && Math.abs(yy - y) < 9) return true; }
  return false;
}
function drFinish(){
  const D = DR.draft; if(!D) return;
  const d = D.d, T = DT[d.type];
  DR.draft = null;
  if(T.n === -1 && d.pts.length > 1){ d.pts.pop(); }       // the point that followed the mouse
  if((T.n === -1 && d.pts.length < 2) || (T.n === -2 && d.pts.length < 2)){ drRedraw(); return; }
  drBefore(); DR.items.push(d); DR.sel = d.id;
  if(!drPref().stay){ DR.tool = null; if(typeof drUiTools === "function") drUiTools(); }
  drChanged();
  if(T.text && ["text", "note", "callout"].includes(d.type) && typeof drEditText === "function") setTimeout(() => drEditText(d, true), 30);
}
function drStartPlace(type, q, e){
  const T = DT[type], free = !!T.free, pt = drPtAt(q.x, q.y, {free, ctrl: e && (e.ctrlKey || e.metaKey)}); if(!pt) return;
  const d = {id: drId(), type, pts: [{t: pt.t, p: pt.p}], st: drNewStyle(type), text: ""};
  if(T.pos){                                                // a long / short position: stop and target 1.5 ATR / 3 ATR away, 20 bars wide
    const side = type === "long" ? 1 : -1, n = RAW.length, atr = n > 2 ? CT.atr(RAW.slice(-200), 14) : drTick() * 20;
    const dist = Math.max(drTick() * 5, drRound(atr * 1.5)), end = L2t(pt.L + 20);
    d.pts.push({t: end, p: drRound(pt.p + side * dist * 2)}, {t: end, p: drRound(pt.p - side * dist)});
    d.lots = drLots();
    DR.draft = {d}; drFinish(); return;
  }
  if(T.n === 1){ DR.draft = {d}; drFinish(); return; }
  d.pts.push({t: pt.t, p: pt.p});
  DR.draft = {d, k: 1, x0: q.x, y0: q.y, down: true, brush: T.n === -2};
  drRedraw();
}
function drDraftMove(q, e){
  const D = DR.draft; if(!D) return;
  if(q.W) q = drClampQ(q);
  const T = DT[D.d.type], pt = drPtAt(q.x, q.y, {free: !!T.free, ctrl: e && (e.ctrlKey || e.metaKey)}); if(!pt) return;
  if(D.brush){ if(D.down){ const l = D.d.pts[D.d.pts.length - 1], V = drView(), lp = drXY(V, l, true);
      if(Math.hypot(lp.x - q.x, lp.y - q.y) >= 3 && D.d.pts.length < 600) D.d.pts.push({t: pt.t, p: pt.p}); } }
  else D.d.pts[D.k] = {t: pt.t, p: pt.p};
  drRedraw();
}
function drDraftClick(q, e){                                // a click while placing: the next point
  const D = DR.draft, T = DT[D.d.type];
  const pt = drPtAt(q.x, q.y, {free: !!T.free, ctrl: e && (e.ctrlKey || e.metaKey)}); if(!pt) return;
  if(T.n === -1){                                           // path: click on the last point (or double-click) to finish
    const V = drView(), prev = D.d.pts.length > 1 ? drXY(V, D.d.pts[D.d.pts.length - 2]) : null;
    if(prev && Math.hypot(prev.x - q.x, prev.y - q.y) < 6){ drFinish(); return; }
    D.d.pts[D.k] = {t: pt.t, p: pt.p}; D.k++; D.d.pts.push({t: pt.t, p: pt.p}); drRedraw(); return;
  }
  D.d.pts[D.k] = {t: pt.t, p: pt.p}; D.k++;
  if(D.k >= T.n){ drFinish(); return; }
  D.d.pts.push({t: pt.t, p: pt.p}); drRedraw();
}
function drDraftUp(q){
  const D = DR.draft; if(!D || !D.down) return;
  D.down = false;
  if(D.brush){ drFinish(); return; }
  if(Math.hypot(q.x - D.x0, q.y - D.y0) > 5){ drDraftClick(q); }  // dragged out: that's the next point
}
function drDragStart(h, q, e){
  const d = h.d;
  if(e && (e.ctrlKey || e.metaKey) && h.part === "b"){ const c = drClone(d, 0); h = {d: c, part: "b"}; }
  drBefore();
  const pt = drPtAt(q.x, q.y, {free: true, mag: false});
  DR.drag = {id: h.d.id, part: h.part, hid: h.id, L0: pt ? pt.L : 0, p0: pt ? pt.p : 0, orig: JSON.parse(JSON.stringify(h.d.pts)), moved: false, x0: q.x, y0: q.y};
}
function drDragMove(q, e){
  const g = DR.drag, d = drFind(g.id); if(!d) return;
  if(!g.moved && Math.hypot(q.x - g.x0, q.y - g.y0) < 3) return;
  g.moved = true;
  const T = DT[d.type];
  if(g.part === "b"){
    const pt = drPtAt(q.x, q.y, {free: true, mag: false}); if(!pt) return;
    const dL = T.free ? pt.L - g.L0 : Math.round(pt.L - g.L0), dp = pt.p - g.p0;
    d.pts = g.orig.map(p => { const L = t2L(p.t, T.free); return {t: L == null ? p.t : L2t(L + dL), p: T.free ? p.p + dp : drRound(p.p + dp)}; });
  } else {
    const pt = drPtAt(q.x, q.y, {free: !!T.free, ctrl: e && (e.ctrlKey || e.metaKey)}); if(!pt) return;
    const id = g.hid, P0 = g.orig;
    if(T.pos){
      const side = d.type === "long" ? 1 : -1, e0 = d.pts[0].p, tk = drTick();
      if(id === "e"){ d.pts[0] = {t: pt.t, p: pt.p}; }
      if(id === "tp") d.pts[1].p = side > 0 ? Math.max(pt.p, e0 + tk) : Math.min(pt.p, e0 - tk);
      if(id === "sl") d.pts[2].p = side > 0 ? Math.min(pt.p, e0 - tk) : Math.max(pt.p, e0 + tk);
      if(id === "end"){ const L0 = t2L(d.pts[0].t); const t = L2t(Math.max(L0 + 1, pt.L)); d.pts[1].t = t; d.pts[2].t = t; }
    } else if(id === "a"){ d.pts[0] = {t: pt.t, p: P0[0].p}; d.pts[1] = {t: P0[1].t, p: pt.p}; }
    else if(id === "b"){ d.pts[1] = {t: pt.t, p: P0[1].p}; d.pts[0] = {t: P0[0].t, p: pt.p}; }
    else if(typeof id === "number") d.pts[id] = {t: pt.t, p: pt.p};
  }
  drRedraw();
}
function drDragEnd(){
  const g = DR.drag; DR.drag = null; if(!g) return;
  if(g.moved) drChanged(); else drRedraw();
}
/* the measure tool */
function drMeasStart(q, held){
  const pt = drPtAt(q.x, q.y, {}); if(!pt) return;
  DR.meas = {pts: [{t: pt.t, p: pt.p}, {t: pt.t, p: pt.p}], phase: "draw", held, x0: q.x, y0: q.y};
  DR.measArm = false; if(typeof drUiTools === "function") drUiTools();
  drRedraw();
}
function drClampQ(q){ return {...q, x: Math.max(0, Math.min(q.W - 1, q.x)), y: Math.max(0, Math.min(q.H - 1, q.y))}; }
function drMeasMove(q, e){ q = drClampQ(q); const m = DR.meas; if(!m || m.phase !== "draw") return; const pt = drPtAt(q.x, q.y, {ctrl: e && (e.ctrlKey || e.metaKey)}); if(pt){ m.pts[1] = {t: pt.t, p: pt.p}; drRedraw(); } }

/* ---------------------------------------------------------------- mouse and touch (capture: before the chart and the trade lines) */
function drDown(e){
  if(!series || !DR.prim) return;
  const touch = e.type === "touchstart"; DR.touch = touch;
  if(!touch && e.button === 2) return;
  if(!drOnCanvas(e)) return;
  const q = drLocal(e);
  if(typeof drUiMenuClose === "function") drUiMenuClose();
  if(!q.inPane){ return; }
  const eat = () => { e.preventDefault(); e.stopPropagation(); };
  // the measure: middle button (MT5), Shift+click (TradingView), the ruler button; a click ends it, another clears it
  if(DR.meas){
    if(DR.meas.phase === "draw"){ drMeasMove(q, e); DR.meas.phase = "done"; eat(); drRedraw(); return; }
    DR.meas = null; drRedraw();
    if(!DR.tool && !DR.measArm && !(e.shiftKey || e.button === 1)){ eat(); return; }
  }
  if(!touch && (e.button === 1 || (e.shiftKey && !DR.tool)) || DR.measArm){ eat(); drMeasStart(q, e.button === 1 || touch || true); return; }
  if(DR.tool){
    eat();
    if(DR.draft && DR.draft.k != null){ DR.draft.down = true; DR.draft.x0 = q.x; DR.draft.y0 = q.y; if(!DR.draft.brush) drDraftClick(q, e); return; }
    drStartPlace(DR.tool, q, e); return;
  }
  if(drNearTradeLine(q.y)) return;
  const h = drHit(q.x, q.y);
  if(!h){ if(DR.sel){ DR.sel = null; drRedraw(); if(typeof drUiSel === "function") drUiSel(); } return; }
  const lock = h.d.lock || drPref().lockAll;
  if(touch && h.d.id !== DR.sel){ DR.tapCand = {id: h.d.id, x: q.x, y: q.y, at: Date.now()}; return; }   // a tap selects; a drag still scrolls the chart
  DR.sel = h.d.id; if(typeof drUiSel === "function") drUiSel(); drRedraw();
  if(lock) return;                                          // locked: selected, but the chart still scrolls
  eat(); drDragStart(h, q, e);
}
function drMove(e){
  if(!series || !DR.prim) return;
  const q = drLocal(e);
  if(DR.drag){ e.preventDefault(); e.stopPropagation(); drDragMove(q, e); return; }
  if(DR.meas && DR.meas.phase === "draw"){ drMeasMove(q, e); if(e.type === "touchmove") e.preventDefault(); return; }
  if(DR.draft){ drDraftMove(q, e); if(e.type === "touchmove"){ e.preventDefault(); e.stopPropagation(); } }
  if(DR.tool || DR.measArm){ const pt = q.inPane ? drPtAt(q.x, q.y, {ctrl: e.ctrlKey || e.metaKey, free: DR.tool && DT[DR.tool].free}) : null; const V = drView();
    DR.crossAt = pt && V ? {x: V.xL(pt.L), y: V.y(pt.p)} : null; drRedraw(); }
  else if(e.type === "mousemove" && q.inPane && drOnCanvas(e)){ const h = drHit(q.x, q.y), id = h ? h.d.id : null; if(id !== DR.hoverId){ DR.hoverId = id; drRedraw(); } }
}
function drUp(e){
  if(!series || !DR.prim) return;
  const q = drLocal(e);
  if(DR.drag){ e.stopPropagation(); drDragEnd(); return; }
  if(DR.meas && DR.meas.phase === "draw" && Math.hypot(q.x - DR.meas.x0, q.y - DR.meas.y0) > 5){ drMeasMove(q, e); DR.meas.phase = "done"; drRedraw(); return; }
  if(DR.draft && DR.draft.down){ drDraftUp(q); return; }
  if(DR.tapCand && e.type === "touchend"){
    const c = DR.tapCand; DR.tapCand = null;
    if(Date.now() - c.at < 500 && Math.hypot(q.x - c.x, q.y - c.y) < 10){ DR.sel = c.id; if(typeof drUiSel === "function") drUiSel(); drRedraw(); }
  }
}
function drDbl(e){
  if(!drOnCanvas(e)) return;
  const q = drLocal(e); if(!q.inPane) return;
  if(DR.draft && DT[DR.draft.d.type].n === -1){ e.preventDefault(); e.stopPropagation(); drFinish(); return; }
  if(DR.tool) return;
  const h = drHit(q.x, q.y); if(!h) return;
  e.preventDefault(); e.stopPropagation();
  DR.sel = h.d.id; drRedraw();
  if(DT[h.d.type].text && typeof drEditText === "function" && ["text", "note", "callout"].includes(h.d.type)) drEditText(h.d);
  else if(typeof drSettings === "function") drSettings(h.d);
}
function drCtx(e){
  if(!drOnCanvas(e)) return;
  const q = drLocal(e); if(!q.inPane) return;
  if(DR.draft){ e.preventDefault(); if(DT[DR.draft.d.type].n === -1) drFinish(); else { DR.draft = null; drRedraw(); } return; }
  const h = drHit(q.x, q.y); if(!h) return;
  e.preventDefault(); e.stopPropagation();
  DR.sel = h.d.id; drRedraw(); if(typeof drUiSel === "function") drUiSel();
  if(typeof drMenu === "function") drMenu(h.d, e.clientX, e.clientY);
}
function drWire(){
  const box = $("#chart"), wrap = box.parentElement, o = {capture: true, passive: false};
  wrap.addEventListener("mousedown", drDown, o); wrap.addEventListener("touchstart", drDown, o);
  window.addEventListener("mousemove", drMove, {capture: true, passive: false}); wrap.addEventListener("touchmove", drMove, o);
  window.addEventListener("mouseup", drUp, true); window.addEventListener("touchend", drUp, true); window.addEventListener("touchcancel", drUp, true);
  wrap.addEventListener("dblclick", drDbl, true); wrap.addEventListener("contextmenu", drCtx, true);
  box.addEventListener("mouseleave", () => { if(DR.crossAt){ DR.crossAt = null; drRedraw(); } if(DR.hoverId){ DR.hoverId = null; drRedraw(); } });
  // middle-click on Linux pastes / scrolls: not on the chart
  box.addEventListener("auxclick", e => { if(e.button === 1) e.preventDefault(); });
}
drWire();
if(series && !DR.prim) drAttach();
