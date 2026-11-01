/* Multi-charts (v0.24.0, roadmap item 6). A layout's grid: 1, 2 side by side, 2 stacked, 3 (one big + two), 2×2.
   Desktop: each chart of the grid runs in its own frame (this same page with ?cell=N, chart only), so every chart is
   fully its own - contract, timeframe, chart type, indicators and Pine scripts, its contract's drawings, the BUY / SELL
   tool and your positions' lines - with all the single-chart code unchanged. Each frame keeps its set-up in the
   layout's charts[N] (not in the shared preferences) and reports changes to the page around it, which saves the layout.
   The active chart (last clicked, blue border) is what the watchlist, Find, the trade panel's BUY / SELL and the Pine
   Editor act on. The crosshair can follow across the charts (Grid menu). Phone: no frames - the page's own chart shows
   one of the layout's charts at a time, with buttons to switch (LAY.cell).
   Loaded after layouts.js. The page side and the frame side are both in this file. */
"use strict";
const MC_GRIDS = {"1": {name: "1 chart", n: 1}, "2v": {name: "2 side by side", n: 2}, "2h": {name: "2 stacked", n: 2},
                  "3": {name: "3 charts", n: 3}, "4": {name: "2×2", n: 4}};
const MC_ICON = {
  "1": '<rect x="3" y="4" width="18" height="16" rx="1.5"/>',
  "2v": '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M12 4v16"/>',
  "2h": '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 12h18"/>',
  "3": '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M12 4v16M12 12h9"/>',
  "4": '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M12 4v16M3 12h18"/>'
};
const mcSvg = g => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${MC_ICON[g]}</svg>`;
const MC_CELL_KEYS = ["cur", "tf2", "ctype", "chart", "indicators", "lgdMin0"];

if(window.FTM_CELL == null){
/* ================================================================ the page around the grid */
const MC = {cells: [], toasts: {}, mob: null, hint: null};
function mcGrid(){ const L = typeof layCur === "function" ? layCur() : null; return L && MC_GRIDS[L.grid] ? L.grid : "1"; }
function mcMob(){ return document.body.classList.contains("mob"); }
function mcOn(){ return LAY.ready && mcGrid() !== "1" && !mcMob(); }
function mcN(){ return MC_GRIDS[mcGrid()].n; }
function mcWin(i = LAY.cell){ const f = MC.cells[i]; try{ const w = f && f.contentWindow; return w && w.FTM_CELL_READY ? w : null; }catch(e){ return null; } }
function mcSync(){ const L = layCur(); return {cross: true, sym: false, tf: false, range: false, ...((L && L.sync) || {})}; }
/* a frame's set-up, and its changes (into the open layout, saved as the layout saves) */
function mcCellState(i){
  const L = layCur(); if(!L) return null;
  L.charts = L.charts && L.charts.length ? L.charts : [layNow()];
  while(L.charts.length <= i) L.charts.push(layCopy(L.charts[0]));
  const c = layCopy(L.charts[i]) || {};
  if(c.tb == null) c.tb = false;                          // (the drawing toolbar starts closed in a grid: ✎ opens it)
  return c;
}
function mcCellSet(i, c){
  const L = layCur(); if(!L || !mcOn() || i >= (L.charts || []).length) return;
  if(layEq(L.charts[i], c)) return;
  L.charts[i] = c;
  if(layAuto()){ clearTimeout(LAY.saveT); LAY.saveT = setTimeout(layFlush, 900); }
  else LAY.dirty = true;
  layUi(); mcHeads();
  if(i === LAY.cell) mcTicket();
}
/* the active chart: what the watchlist, Find, BUY / SELL and the Pine Editor act on */
function mcActive(i){
  for(const id of ["#gridPick", "#layPick", "#ctPick", "#cfgPick", "#tfPick", "#indPick", "#dtbFly", "#drLst", "#drMenu", "#dcol"]){ const x = $(id); if(x) x.classList.add("hide"); }   // (a click in a chart's frame never reaches this page's own "click outside" handlers)
  if(i === LAY.cell || i >= mcN()) return;
  LAY.cell = i; mcMark(); mcTicket();
}
function mcMark(){ MC.cells.forEach((f, k) => f.parentElement.classList.toggle("on", k === LAY.cell)); }
function mcTicket(){
  const L = layCur(), c = L && (L.charts || [])[LAY.cell], s = c && c.cur && c.cur.s; if(!s) return;
  const go = row => { sym[row.s] = row; paperOnSymbol(row); };
  if(sym[s]) go(sym[s]); else api("/api/symbol?s=" + encodeURIComponent(s)).then(j => { if(j.ok) go(j.row); });
}
/* each frame's name over it: chart number, contract, timeframe */
function mcHeads(){
  const L = layCur(); if(!L) return;
  MC.cells.forEach((f, k) => { const c = (L.charts || [])[k] || {}; const t = f.parentElement.querySelector(".mc-n");
    if(t) t.textContent = `${k + 1}`; f.title = `Chart ${k + 1}: ${c.cur ? symLabel(c.cur.s) : ""} ${c.tf2 || ""}`; });
}
/* the grid on screen (desktop); the phone's chart buttons */
function mcRender(reload){
  const on = mcOn();
  document.body.classList.toggle("multi", on);
  mcButton(); mcDots();
  if(MC.hint == null) MC.hint = $("#tkHint").textContent;
  $("#tkHint").textContent = on ? "BUY or SELL sets up the trade on the active chart (blue border): drag its lines there and press PLACE on the chart. Every ₹ figure is after all charges." : MC.hint;
  let g = $("#mcGrid");
  if(!on){ if(g){ g.remove(); MC.cells = []; } return; }
  const L = layCur(), n = mcN();
  L.charts = L.charts && L.charts.length ? L.charts : [layNow()];
  while(L.charts.length < n) L.charts.push(layCopy(L.charts[0]));
  if(!g){ g = document.createElement("div"); g.id = "mcGrid"; $("#chart").before(g); }
  g.dataset.grid = mcGrid();
  if(reload || g.dataset.lay !== L.id){ g.innerHTML = ""; MC.cells = []; g.dataset.lay = L.id; g.classList.remove("max"); }
  for(let i = MC.cells.length; i < n; i++){
    const d = document.createElement("div"); d.className = "mc-cell"; d.dataset.i = i;
    d.innerHTML = `<span class="mc-n"></span>`;
    const f = document.createElement("iframe"); f.src = `/?cell=${i}&l=${encodeURIComponent(L.id)}&n=${Date.now() % 1e6}`;
    d.prepend(f); g.append(d); MC.cells.push(f);
  }
  while(MC.cells.length > n){ const f = MC.cells.pop(); f.parentElement.remove(); }
  if(LAY.cell >= n) LAY.cell = 0;
  if(g.classList.contains("max") && !g.querySelector(".mc-cell.max")) g.classList.remove("max");
  mcMark(); mcHeads(); mcTicket();
}
/* one chart of the grid big (⛶ / F in a chart), again: back to the grid */
function mcMax(i){
  const g = $("#mcGrid"); if(!g) return;
  const cell = MC.cells[i] && MC.cells[i].parentElement; if(!cell) return;
  const on = !cell.classList.contains("max");
  g.querySelectorAll(".mc-cell").forEach(c => c.classList.remove("max"));
  cell.classList.toggle("max", on); g.classList.toggle("max", on);
  mcActive(i);
}
/* the Grid button and its menu */
function mcButton(){
  let b = $("#bGrid");
  if(!b){
    b = document.createElement("button"); b.className = "ghost fsb"; b.id = "bGrid";
    $("#bLay").after(b);
    const p = document.createElement("div"); p.id = "gridPick"; p.className = "hide";
    $("#layPick").after(p);
    b.onclick = e => { e.stopPropagation(); const show = p.classList.contains("hide");
      for(const id of ["#ctPick", "#cfgPick", "#tfPick", "#indPick", "#layPick"]) { const x = $(id); if(x) x.classList.add("hide"); }
      p.classList.toggle("hide", !show); if(show) mcMenu(); };
    p.addEventListener("click", e => e.stopPropagation());
    document.addEventListener("click", e => { if(document.contains(e.target) && !e.target.closest("#gridPick,#bGrid")) p.classList.add("hide"); }, true);
  }
  const g = mcGrid();
  b.innerHTML = mcSvg(g); b.title = `Charts in this layout: ${MC_GRIDS[g].name}`;
  b.classList.toggle("on", g !== "1");
}
function mcMenu(){
  const p = $("#gridPick"), g = mcGrid(), sy = mcSync();
  p.innerHTML = `<div class="cfgh"><b>Charts in this layout</b><button class="ghost" id="gridClose">✕</button></div>
    <div class="mc-opts">${Object.entries(MC_GRIDS).map(([k, v]) => `<button data-g="${k}" class="${k === g ? "on" : ""}" title="${v.name}">${mcSvg(k)}<span>${v.name}</span></button>`).join("")}</div>
    <div class="sec">Sync</div>
    <label class="chk"><input type="checkbox" id="mcSym" ${sy.sym ? "checked" : ""}> Contract: a contract opened on one chart opens on all</label>
    <label class="chk"><input type="checkbox" id="mcTf" ${sy.tf ? "checked" : ""}> Timeframe: one chart's timeframe on all</label>
    <label class="chk"><input type="checkbox" id="mcRange" ${sy.range ? "checked" : ""} ${mcMob() ? "disabled" : ""}> Date range: scroll / zoom one chart, the others show the same time</label>
    <label class="chk"><input type="checkbox" id="mcCross" ${sy.cross ? "checked" : ""} ${mcMob() ? "disabled" : ""}> Crosshair: follows across the charts</label>
    <p class="help" style="margin:4px 0 0">Ticking contract, timeframe or date range lines every chart up with the active one now.</p>
    <p class="help" style="margin:8px 0 0">Each chart has its own contract, timeframe, chart type, indicators and drawings, saved in the layout. Click a chart to make it the active one (blue border): the watchlist, Find, BUY / SELL and the Pine Editor work on it. ⛶ (or F) in a chart shows it big; again to go back. ${mcMob() ? "On the phone one chart shows at a time: the numbers above the chart switch." : ""}</p>`;
  p.querySelectorAll("[data-g]").forEach(b => b.onclick = () => mcSetGrid(b.dataset.g));
  $("#gridClose").onclick = () => p.classList.add("hide");
  $("#mcCross").onchange = e => { const L = layCur(); if(!L) return; L.sync = {...mcSync(), cross: e.target.checked}; mcSaveLayout(); if(!e.target.checked) mcCrossOut(-1); };
  for(const [id, k] of [["#mcSym", "sym"], ["#mcTf", "tf"], ["#mcRange", "range"]]) $(id).onchange = e => {
    const L = layCur(); if(!L) return;
    L.sync = {...mcSync(), [k]: e.target.checked}; mcSaveLayout();
    if(e.target.checked) mcLineUp(k);                    // every chart lined up with the active one now
  };
}
function mcSaveLayout(){ if(layAuto()){ clearTimeout(LAY.saveT); LAY.saveT = setTimeout(layFlush, 300); } else { LAY.dirty = true; layUi(); } }
async function mcSetGrid(g){
  const L = layCur(); if(!L || !MC_GRIDS[g]) return;
  const old = mcGrid(); if(g === old){ $("#gridPick").classList.add("hide"); return; }
  L.charts = L.charts && L.charts.length ? L.charts : [layNow()];
  if(old === "1" || mcMob()) L.charts[layIdx(L)] = layNow();      // the chart as shown stays chart 1 (or the phone's one)
  const n = MC_GRIDS[g].n;
  while(L.charts.length < n) L.charts.push({...layCopy(L.charts[LAY.cell] || L.charts[0]), tb: false});   // a new chart starts as a copy of the active one (toolbar closed)
  L.grid = g;
  $("#gridPick").classList.add("hide");
  if(g === "1" || mcMob()){
    const k = g === "1" ? 0 : Math.min(LAY.cell, n - 1);
    mcRender();
    if(LAY.cell !== k || g === "1"){ LAY.cell = k; await layApplyChart(L.charts[k] || {}); layPrefsNow(); }
    mcDots();
  } else mcRender();
  mcSaveLayout(); layUi();
}
/* the phone: one of the layout's charts at a time on the page's own chart */
function mcDots(){
  let d = $("#mcDots");
  const L = layCur(), show = mcMob() && mcGrid() !== "1" && L;
  if(!show){ if(d) d.remove(); return; }
  if(!d){ d = document.createElement("div"); d.id = "mcDots"; $(".charthead").prepend(d); }
  const n = mcN();
  d.innerHTML = Array.from({length: n}, (_, k) => { const c = (L.charts || [])[k] || {};
    return `<button data-k="${k}" class="${k === LAY.cell ? "on" : ""}" title="Chart ${k + 1}: ${esc(c.cur ? symLabel(c.cur.s) : "")} ${esc(c.tf2 || "")}">${k + 1}</button>`; }).join("");
  d.querySelectorAll("[data-k]").forEach(b => b.onclick = () => mcPhoneCell(+b.dataset.k));
}
async function mcPhoneCell(k){
  const L = layCur(); if(!L || k === LAY.cell) return;
  if(LAY.saveT && layAuto()) await layFlush();
  LAY.cell = k; mcDots();
  await layApplyChart((L.charts || [])[k] || {}); layPrefsNow();
  mcDots();
}
/* sync: contract, timeframe, date range. A change on one chart goes to the others; ticking an option lines them all
   up with the active chart. Phone: the layout's other charts take the contract / timeframe (mcAfterTouch). */
async function mcRow(s){ if(sym[s]) return sym[s]; const j = await api("/api/symbol?s=" + encodeURIComponent(s)); if(j.ok){ sym[j.row.s] = j.row; return j.row; } return null; }
async function mcLineUp(k){
  const L = layCur(); if(!L) return;
  const src = (L.charts || [])[LAY.cell] || {};
  if(!mcOn()){                                            // the phone: into the layout's charts
    (L.charts || []).forEach((c, i) => { if(i === LAY.cell) return; if(k === "sym" && src.cur) c.cur = layCopy(src.cur); if(k === "tf" && src.tf2) c.tf2 = src.tf2; });
    mcSaveLayout(); mcDots(); return;
  }
  if(k === "sym" && src.cur){ const row = await mcRow(src.cur.s); if(row) mcEach((w, i) => { if(i !== LAY.cell && w.cellInfo().s !== row.s) w.openSymbol(row); }); }
  if(k === "tf" && src.tf2) mcEach((w, i) => { if(i !== LAY.cell) w.cellSetTf(src.tf2); });
  if(k === "range"){ const w = mcWin(); const r = w && w.cellRangeNow(); if(r) mcRange(LAY.cell, r, true); }
}
function mcTf(i, k){ if(!mcSync().tf) return; mcEach((w, j) => { if(j !== i) w.cellSetTf(k); }); }
function mcRange(i, r, force){ if(!force && !mcSync().range) return; mcEach((w, j) => { if(j !== i) w.cellRange(r); }); }
function mcAfterTouch(L, i){                              // the phone: a change on the chart shown, into the others
  if(mcGrid() === "1" || !mcMob()) return;
  const sy = mcSync(), src = L.charts[i];
  L.charts.forEach((c, k) => { if(k === i) return; if(sy.sym && src.cur) c.cur = layCopy(src.cur); if(sy.tf && src.tf2) c.tf2 = src.tf2; });
  mcDots();
}
/* the crosshair across the charts */
function mcCross(i, x){ if(!mcSync().cross) return; MC.cells.forEach((f, k) => { if(k === i) return; const w = mcWin(k); if(w && w.cellCrossShow) w.cellCrossShow(x); }); }
function mcCrossOut(i){ MC.cells.forEach((f, k) => { if(k === i) return; const w = mcWin(k); if(w && w.cellCrossClear) w.cellCrossClear(); }); }
/* a chart saved its contract's drawings: the other charts on that contract show them too */
function mcDrawn(s, i){ MC.cells.forEach((f, k) => { if(k === i) return; const w = mcWin(k); if(w && w.cellDrawReload) w.cellDrawReload(s); }); }
function mcEach(fn){ MC.cells.forEach((f, k) => { const w = mcWin(k); if(w) try{ fn(w, k); }catch(e){} }); }
/* the same message from several charts (a fill, a stop...) shows once */
(function(){ const t0 = toast; toast = function(msg){ const now = Date.now(); if(MC.toasts[msg] && now - MC.toasts[msg] < 3000) return; MC.toasts[msg] = now; return t0.apply(this, arguments); }; })();
/* what the page does goes to the active chart while a grid is on */
(function mcHooks(){
  const os = openSymbol;
  openSymbol = function(row){
    if(!mcOn() || !row) return os.apply(this, arguments);
    sym[row.s] = row;
    const w = mcWin(); if(!w){ toast("That chart is still loading"); return; }
    w.openSymbol(row); paperOnSymbol(row);
    if(mcSync().sym) mcEach((x, i) => { if(i !== LAY.cell) x.openSymbol(row); });   // contract sync: on every chart
  };
  const ar = arm;
  arm = function(side){ if(!mcOn()) return ar.apply(this, arguments); const w = mcWin(); if(w) w.arm(side); else toast("That chart is still loading"); };
  const pa = peAdd;
  peAdd = async function(){
    if(!mcOn()) return pa.apply(this, arguments);
    const res = await peCheck();
    if(res && !res.ok){ toast("Fix the error first"); return; }
    if(PE.cm && pineIsLib(PE.cm.getValue())) return pa.apply(this, arguments);   // (a library isn't drawn)
    if(!PE.id || peDirty()){ const s = await peSave(); if(!s) return; }
    const w = mcWin(); if(!w){ toast("That chart is still loading"); return; }
    const r = w.cellAddPine(PINE.scripts, PE.id, res && res.indicator ? !!res.indicator.overlay : undefined);
    toast(r === "had" ? `Updated on chart ${LAY.cell + 1}` : `Added to chart ${LAY.cell + 1}`); peTitle();
  };
  document.addEventListener("DOMContentLoaded", () => { const b = $("#pdAdd"); if(b) b.onclick = () => peAdd(); });
  const sv = peSave;
  peSave = async function(){ const r = await sv.apply(this, arguments); if(r) mcEach(w => w.cellScripts && w.cellScripts(PINE.scripts, r.id)); return r; };
  const as = acctSwitch;
  acctSwitch = function(id){ const r = as.apply(this, arguments); mcEach(w => w.acctSwitch && w.acctSwitch(id)); return r; };
  const at = applyTheme;
  applyTheme = function(){ const r = at.apply(this, arguments); mcEach(w => w.applyTheme && w.applyTheme()); return r; };
  // the phone layout switching on / off (window resized, More › layout)
  new MutationObserver(() => {
    const m = mcMob(); if(m === MC.mob) return;
    const was = MC.mob; MC.mob = m;
    if(was == null || !LAY.ready) return;
    const L = layCur(); if(!L || mcGrid() === "1") return;
    mcRender(true);
    if(m) layApplyChart((L.charts || [])[LAY.cell] || {}).then(() => layPrefsNow());   // the phone shows the active chart
  }).observe(document.body, {attributes: true, attributeFilter: ["class"]});
  MC.mob = mcMob();
})();
window.mcTf = mcTf; window.mcRange = mcRange; window.mcAfterTouch = mcAfterTouch; window.mcSync = mcSync;
window.mcOn = mcOn; window.mcRender = mcRender; window.mcGrid = mcGrid; window.mcWin = mcWin; window.mcSetGrid = mcSetGrid; window.mcPhoneCell = mcPhoneCell;
window.mcCellState = mcCellState; window.mcCellSet = mcCellSet; window.mcActive = mcActive; window.mcMax = mcMax;
window.mcCross = mcCross; window.mcCrossOut = mcCrossOut; window.mcDrawn = mcDrawn;
window.mcCtrlS = () => { if(layAuto()) toast("Layouts save themselves as you change the chart"); else laySave(); };
} else {
/* ================================================================ a chart inside the grid (?cell=N) */
(function cellMode(){
  const I = +window.FTM_CELL, PW = window.parent;
  if(!PW || PW === window || typeof PW.mcCellState !== "function") return;    // opened on its own: an ordinary page
  const C = PW.mcCellState(I) || {};
  window.cellErrs = []; addEventListener("error", e => window.cellErrs.push(String(e.message)));
  let rt = null, HOVER = false, RELAY = false, raf = 0;
  const report = () => { clearTimeout(rt); rt = setTimeout(() => PW.mcCellSet(I, JSON.parse(JSON.stringify(C))), 150); };
  // this chart's set-up lives in the layout's charts[N], not in the shared preferences
  const pg = prefGet, ps = prefSet;
  prefGet = function(k, d){ if(MC_CELL_KEYS.includes(k)) return C[k] != null ? C[k] : d; return pg.apply(this, arguments); };
  prefSet = function(k, v){ if(MC_CELL_KEYS.includes(k)){ C[k] = v == null ? v : JSON.parse(JSON.stringify(v)); report(); return; } return ps.apply(this, arguments); };
  // its drawing toolbar on / off is its own too (the rest of the drawing settings are shared)
  const dp = drPref;
  drPref = function(){ return {...dp(), tb: !!C.tb}; };
  drPrefSet = function(ch){ ch = {...ch}; if("tb" in ch){ C.tb = !!ch.tb; delete ch.tb; report(); } if(Object.keys(ch).length) ps("draw", {...dp(), ...ch}); };
  document.body.classList.toggle("notb", !C.tb);
  // live prices: just this chart's contract (the page around streams the watchlist)
  sendWant = function(){ if(!ws || ws.readyState !== 1) return; ws.send(JSON.stringify({want: [...new Set([...(cur ? [cur.s] : []), ...wantSymbols()])].slice(0, 40), depth: null})); };
  toast = function(msg){ PW.toast(msg); };
  // a click anywhere in it: the active chart
  document.addEventListener("pointerdown", () => PW.mcActive(I), true);
  // ⛶ / F: this chart big in the grid, again: back
  setFull = function(){ PW.mcMax(I); };
  document.addEventListener("DOMContentLoaded", () => { const b = $("#bFull"); if(b){ b.onclick = () => PW.mcMax(I); b.title = "Show this chart big in the grid (F) · again: back to the grid"; } });
  // Ctrl+S: the layout
  window.addEventListener("keydown", e => { if((e.ctrlKey || e.metaKey) && !e.altKey && e.code === "KeyS" && !(e.target.closest && e.target.closest("input,textarea,.CodeMirror"))){ e.preventDefault(); e.stopImmediatePropagation(); PW.mcCtrlS(); } }, true);
  // the crosshair: where it is here goes to the other charts; theirs shows here (same contract: the price line too)
  // a timeframe picked here goes to the other charts (timeframe sync); one sent from there doesn't come back
  const st = setTf;
  setTf = function(k){ const r = st.apply(this, arguments); if(!RELAY) PW.mcTf(I, k); return r; };
  window.cellSetTf = function(k){ if(tf === k || !parseTf(k)) return; RELAY = true; try{ setTf(k); } finally { RELAY = false; } };
  // the time on screen: scrolled / zoomed here (the mouse is on this chart) -> the others (date-range sync)
  window.cellRange = function(r){ if(HOVER || !chart || !r) return; try{ chart.timeScale().setVisibleRange(r); }catch(e){} };
  window.cellRangeNow = function(){ try{ return chart.timeScale().getVisibleRange(); }catch(e){ return null; } };
  const hook = () => { if(!chart) return;
    chart.timeScale().subscribeVisibleTimeRangeChange(r => { if(!HOVER || !r) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => PW.mcRange(I, {from: r.from, to: r.to})); });
    chart.subscribeCrosshairMove(p => {
    if(!HOVER) return;
    const t = p && p.point ? (p.time != null ? p.time : p.logical != null && typeof L2t === "function" ? L2t(p.logical) : null) : null;   // (past the last bar: from the bar count)
    if(t != null){ const pr = series.coordinateToPrice(p.point.y); PW.mcCross(I, {t, p: pr, s: cur && cur.s}); }
    else PW.mcCrossOut(I);
  }); };
  const bc = buildChart;
  buildChart = function(){ const r = bc.apply(this, arguments); hook(); return r; };
  document.addEventListener("DOMContentLoaded", () => {
    const el = $("#chart");
    el.addEventListener("mouseenter", () => { HOVER = true; try{ chart.applyOptions({crosshair: {horzLine: {visible: true, labelVisible: true}}}); }catch(e){} });
    el.addEventListener("mouseleave", () => { HOVER = false; PW.mcCrossOut(I); });
  });
  window.cellCrossShow = function(x){
    if(HOVER || !chart || !series || !DISP.length) return;
    let lo = 0, hi = DISP.length - 1; if(x.t < DISP[0].time){ window.cellCrossClear(); return; }
    while(lo < hi){ const m = (lo + hi + 1) >> 1; if(DISP[m].time <= x.t) lo = m; else hi = m - 1; }
    const same = !!(cur && x.s === cur.s && x.p != null);
    try{ chart.applyOptions({crosshair: {horzLine: {visible: same, labelVisible: same}}}); chart.setCrosshairPosition(same ? x.p : DISP[lo].close, DISP[lo].time, series); window.cellCrossAt = {t: DISP[lo].time, same}; }catch(e){}
  };
  window.cellCrossClear = function(){ if(HOVER || !chart) return; window.cellCrossAt = null; try{ chart.clearCrosshairPosition(); chart.applyOptions({crosshair: {horzLine: {visible: true, labelVisible: true}}}); }catch(e){} };
  // drawings: saved here -> the other charts on the contract reload theirs
  const sn = drSaveNow;
  drSaveNow = async function(){ const s = DR.s, had = DR.dirty; const r = await sn.apply(this, arguments); if(had && s) PW.mcDrawn(s, I); return r; };
  window.cellDrawReload = function(s){ if(DR.s === s && !DR.dirty && !DR.drag && !DR.draft){ DR.loaded = false; drSymbol(s); } };
  // the Pine Editor (in the page around) adds to / updates this chart
  window.cellAddPine = function(scripts, id, overlay){
    PINE.scripts = scripts; PINE.loaded = true;
    const l = indList();
    if(l.some(x => x.type === "pine" && x.scriptId === id)){ window.cellScripts(scripts, id); return "had"; }
    l.push({type: "pine", id: Date.now().toString(36), scriptId: id, inputs: {}, overlay});
    indSave(l); indBuild(); return "added";
  };
  window.cellScripts = function(scripts, id){
    PINE.scripts = scripts; PINE.loaded = true;
    for(const r of INDS) if(r.pine && r.cfg.scriptId === id){ const sc = scripts.find(x => x.id === id); if(sc) r.pine.title = pineTitleOf(sc.source) || sc.name; pineRun(r); }
  };
  // what this chart shows (for the page around and the tests: let-variables aren't window properties)
  window.cellInfo = () => ({s: cur && cur.s, tf, type: ctType(), n: DISP.length, inds: INDS.map(r => r.cfg.type), tb: !!C.tb, drawings: DR.items.length, armed: !!P.armed, toolS: P.T.s, errs: window.cellErrs.slice(0, 3)});
  window.FTM_CELL_READY = true;
})();
}
