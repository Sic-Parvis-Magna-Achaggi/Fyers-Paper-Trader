/* Saved chart layouts (v0.23.0, roadmap item 5). A layout is a named chart set-up: contract, timeframe, chart type (with
   its box sizes), indicators and Pine scripts with all their settings and pane heights, chart settings (colours, lines,
   Volume...), the collapsed indicator group and the drawing toolbar on / off. The button on the chart's top bar shows
   the open layout; its menu opens, makes, copies, renames and deletes layouts. The open layout saves itself as you
   change the chart (as on TradingView). Saved on the server per user (/api/layouts), so every device has them.
   Drawings belong to the contract, not the layout: every layout on GOLDPETAL shows GOLDPETAL's drawings.
   A layout holds a list of charts and a grid (v0.24.0, multichart.js): one chart ('1') is the page's own chart; on a desktop
   grid each chart runs in its own frame and reports its set-up itself; on the phone the page's chart shows one of them at
   a time (LAY.cell). Loaded after drawui.js; inert inside a grid's chart frame. */
"use strict";
const LAY = {list: [], active: "", ready: false, saveT: null, applying: false, del: null, edit: null, tb: null, dirty: false, ask: null, cell: 0};
const LAY_KEYS = ["cur", "tf2", "ctype", "chart", "indicators", "lgdMin0"];
function layCopy(v){ return v == null ? v : JSON.parse(JSON.stringify(v)); }
/* the chart on screen, as a layout's chart */
function layNow(){
  const c = {};
  for(const k of LAY_KEYS){ const v = prefGet(k, null); if(v != null) c[k] = layCopy(v); }
  c.tf2 = prefGet("tf2", tf);
  c.tb = typeof drPref === "function" ? drPref().tb !== false : true;
  return c;
}
function layCur(){ return LAY.list.find(l => l.id === LAY.active); }
/* which of the layout's charts the page's own chart is (0, or the one picked on the phone) */
function layIdx(L){ const n = ((L || layCur() || {}).charts || [0]).length; return Math.max(0, Math.min(LAY.cell || 0, n - 1)); }
function layGridOn(){ return typeof mcOn === "function" && mcOn(); }
/* auto-save (default) or by hand (Save / Ctrl+S): your choice, for every layout */
function layAuto(){ return prefGet("layAuto", true) !== false; }
/* the same chart set-up? (key order and missing / default values don't count) */
function layNorm(v){ if(Array.isArray(v)) return v.map(layNorm); if(v && typeof v === "object"){ const o = {}; for(const k of Object.keys(v).sort()) if(v[k] != null) o[k] = layNorm(v[k]); return o; } return v; }
function layEq(a, b){ return JSON.stringify(layNorm(a || {})) === JSON.stringify(layNorm(b || {})); }
function layId(){ return Math.random().toString(36).slice(2, 10); }
async function layPost(body){
  const j = await api("/api/layouts", {body});
  if(j.ok){
    // the server's list, but the open layout keeps the page's own copy: a change made while this save was on its way
    // (a chart reporting a new timeframe, a sync option) would otherwise be lost when the answer replaces it
    const mine = layCur();
    LAY.list = (j.layouts || []).map(l => mine && l.id === mine.id ? Object.assign(mine, {name: l.name, updated: l.updated}) : l);
    if(body.op !== "put" || body.activate) LAY.active = j.active || LAY.active;
  }
  else toast("Layouts: " + (j.error || "not saved"));
  layUi();
  return j;
}
/* a chart change: into the open layout (saved a moment later, once) */
function layTouch(){
  const L = layCur(); if(!L || LAY.applying) return;
  if(layGridOn()) return;                                // a desktop grid: each chart reports itself (multichart.js)
  const i = layIdx(L);
  if(!layAuto()){ const was = LAY.dirty; LAY.dirty = !layEq(layNow(), (L.charts || [])[i]); if(was !== LAY.dirty) layUi(); return; }   // by hand: just marked unsaved
  L.charts = L.charts && L.charts.length ? L.charts : [{}];
  L.charts[i] = layNow();
  if(typeof mcAfterTouch === "function") mcAfterTouch(L, i);   // (the phone with a grid: contract / timeframe sync)
  clearTimeout(LAY.saveT);
  LAY.saveT = setTimeout(layFlush, 900);
  layUi();
}
/* Save (by hand, Ctrl+S): the chart as shown into the open layout */
async function laySave(){
  const L = layCur(); if(!L) return;
  L.charts = L.charts && L.charts.length ? L.charts : [{}];
  if(!layGridOn()){ L.charts[layIdx(L)] = layNow(); if(typeof mcAfterTouch === "function") mcAfterTouch(L, layIdx(L)); }   // (a grid's charts are already in it)
  LAY.dirty = false;
  await layFlush(); toast(`Layout "${L.name}" saved`);
}
async function layFlush(){
  clearTimeout(LAY.saveT); LAY.saveT = null;
  const L = layCur(); if(L) await layPost({op: "put", layout: L});
}
/* the layouts and the open one. At start-up (layBoot, from the page's boot() before the chart is built) a chart that
   disagrees with the open layout takes the layout's set-up straight into the preferences, so the chart opens as the
   layout with nothing to redo. The saved layout is what counts, never the other way round (a layout switched on
   another device, or a page closed before a switch reached the server). layInit is the late fallback. */
async function layBoot(){ if(window.FTM_CELL != null || window.FTM_REPLAY) return; try{ await layLoad(true); }catch(e){} }
async function layInit(){ await layLoad(false); }
async function layLoad(boot){
  if(LAY.ready || LAY.loading) return;
  LAY.loading = true;
  try{
    const j = await api("/api/layouts");
    if(!j.ok) return;
    LAY.list = j.layouts || []; LAY.active = j.active || "";
    if(!LAY.list.length){                                  // first time: your chart as it is becomes "Layout 1"
      await layPost({op: "put", layout: {id: layId(), name: "Layout 1", grid: "1", charts: [layNow()]}, activate: true});
    } else if(!layCur()){ LAY.active = LAY.list[0].id; }
    const L = layCur();
    let applied = false;
    LAY.cell = 0;
    if(layAuto() && L && !layEq(layNow(), (L.charts || [])[0])){
      if(boot) layToPrefs((L.charts || [])[0] || {}); else await layApply(L);
      layPrefsNow(); applied = true;
    }
    LAY.tb = layNow().tb;
    LAY.dirty = !layAuto() && !!L && !layEq(layNow(), (L.charts || [])[0]);   // by hand: changes not saved last time
    LAY.ready = true; layUi();
    if(applied && !boot) layTouch();
    if(typeof mcRender === "function") mcRender();
  } finally { LAY.loading = false; }
}
/* a layout's chart into the preferences (start-up, before the chart exists) */
function layToPrefs(c){
  LAY.applying = true;
  try{
    prefSet("ctype", layCopy(c.ctype) || {type: "candles"});
    prefSet("chart", layCopy(c.chart) || {});
    prefSet("indicators", layCopy(c.indicators) || []);
    prefSet("lgdMin0", !!c.lgdMin0);
    if(c.tf2 && parseTf(c.tf2)) prefSet("tf2", c.tf2);
    if(c.cur && c.cur.s) prefSet("cur", layCopy(c.cur));
    if(c.tb != null && typeof drPref === "function" && (drPref().tb !== false) !== c.tb){
      prefSet("draw", {...drPref(), tb: c.tb});
      document.body.classList.toggle("notb", !document.body.classList.contains("mob") && !c.tb);
      if(typeof drUiTools === "function") drUiTools();
    }
  } finally { LAY.applying = false; }
}
/* send what's waiting now: preferences (normally sent 0.6 s after a change) and the open layout */
function layPrefsNow(keep){
  if(typeof prefTimer === "undefined" || !prefTimer) return;
  clearTimeout(prefTimer); prefTimer = null;
  const b = {...prefQ}; for(const x in prefQ) delete prefQ[x];
  if(!Object.keys(b).length) return;
  if(keep) layBeacon("/api/prefs", b); else api("/api/prefs", {body: b});
}
function layBeacon(url, body){
  try{ const h = {"Content-Type": "application/json"}; if(typeof ACCT !== "undefined" && ACCT) h["X-Acct"] = ACCT;
    fetch(url, {method: "POST", keepalive: true, credentials: "same-origin", headers: h, body: JSON.stringify(body)}); }catch(e){}
}
/* open a layout: its contract, timeframe, chart type, indicators and settings */
async function layOpen(id){
  const L = LAY.list.find(x => x.id === id); if(!L) return;
  if(LAY.saveT) await layFlush();
  LAY.active = id; LAY.cell = 0; layUi();
  await layApply(L);
  LAY.dirty = false;
  layPrefsNow();                                         // the new chart set-up reaches the server now, not in 0.6 s
  await layPost({op: "active", id});
  if(layAuto()) layTouch();                              // (a contract that's gone: the layout takes the chart as shown)
  if(typeof mcRender === "function") mcRender(true);     // a grid: its charts, as saved
}
/* put a layout's chart on screen (nothing is saved into any layout meanwhile) */
async function layApply(L){ return layApplyChart((L.charts || [])[layIdx(L)] || {}); }
async function layApplyChart(c){
  LAY.applying = true;
  try{
    prefSet("ctype", layCopy(c.ctype) || {type: "candles"});
    prefSet("chart", layCopy(c.chart) || {});
    prefSet("indicators", layCopy(c.indicators) || []);
    prefSet("lgdMin0", !!c.lgdMin0);
    if(c.tf2 && parseTf(c.tf2)){ tf = c.tf2; prefSet("tf2", tf); }
    if(c.tb != null && typeof drToggleBar === "function" && !document.body.classList.contains("mob") && c.tb !== (drPref().tb !== false)) drToggleBar(c.tb);
    LAY.tb = c.tb;
    buildChart(); tfButtons(); ctLabel();
    if(typeof indVisCheck === "function") indVisCheck();
    if(c.cur && c.cur.s && (!cur || c.cur.s !== cur.s)){
      const r = await api("/api/symbol?s=" + encodeURIComponent(c.cur.s));
      if(r.ok) await openSymbol(r.row); else { toast(`${symLabel(c.cur.s)} isn't listed any more: the layout keeps ${cur ? symLabel(cur.s) : "no contract"}`); loadHistory(); }
    } else loadHistory();
  } finally { LAY.applying = false; }
}
function layName(base){ let n = 1, name; do{ name = base.replace("#", n++); } while(LAY.list.some(l => l.name.toLowerCase() === name.toLowerCase())); return name; }
async function layNew(){
  const c = {cur: layCopy(cur), tf2: tf, ctype: {type: "candles"}, chart: {}, indicators: [], lgdMin0: false, tb: true};
  const id = layId();
  if(LAY.saveT) await layFlush();
  const j = await layPost({op: "put", layout: {id, name: layName("Layout #"), grid: "1", charts: [c]}});
  if(j.ok){ await layOpen(id); layRender("rename", id); }
}
async function layCopyOf(id){
  const L = LAY.list.find(x => x.id === id); if(!L) return;
  if(LAY.saveT) await layFlush();
  const nid = layId();
  const src = layCopy(L); if(id === LAY.active && !layGridOn()) src.charts[layIdx(L)] = layNow();   // the open one: as on screen (unsaved changes too)
  LAY.dirty = false;
  const j = await layPost({op: "put", layout: {...src, id: nid, name: layName(L.name.replace(/ copy( \d+)?$/, "") + " copy" + " #").replace(/ copy 1$/, " copy")}});
  if(j.ok){ await layOpen(nid); layRender("rename", nid); }
}
async function layRename(id, name){
  const L = LAY.list.find(x => x.id === id); if(!L) return false;
  name = String(name || "").trim().slice(0, 60);
  if(!name){ toast("A layout needs a name"); return false; }
  const j = await layPost({op: "put", layout: {...L, name}});
  return j.ok;
}
async function layDelete(id){
  const was = LAY.active;
  const j = await layPost({op: "del", id});
  if(j.ok && was === id) await layOpen(j.active);
}

/* ---------------------------------------------------------------- the button and its menu */
function laySub(L){
  const c = (L.charts && L.charts[0]) || {}, n = (c.indicators || []).length, t = (c.ctype || {}).type || "candles";
  const g = typeof MC_GRIDS !== "undefined" && L.grid && L.grid !== "1" ? MC_GRIDS[L.grid] : null;
  if(g) return `${g.name} · ` + (L.charts || []).slice(0, g.n).map(x => (x.cur ? symLabel(x.cur.s) : "–") + " " + (x.tf2 || "")).join(" / ");
  return [c.cur ? symLabel(c.cur.s) : "no contract", c.tf2 || "", CT.name(t), n ? `${n} indicator${n === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
}
function layUi(){
  const b = $("#bLay"); if(!b) return;
  const L = layCur();
  b.textContent = "▦ " + (L ? L.name : "Layouts") + (LAY.dirty ? " ●" : "");
  b.title = L ? `Layout: ${L.name}` + (layAuto() ? " (saves as you change the chart)" : LAY.dirty ? " · changes not saved (Ctrl+S saves)" : " (saved)") + " · click for your layouts" : "Layouts";
  if(!$("#layPick").classList.contains("hide") && !LAY.edit) layRender();
}
function layRender(mode, id){
  const p = $("#layBody"); if(!p) return;
  LAY.edit = mode === "rename" ? id : null;
  const rows = LAY.list.map(L => {
    const on = L.id === LAY.active;
    if(LAY.ask && on) return `<div class="lay-r on lay-ask"><div class="lay-n"><b>${esc(L.name)}</b> has changes not saved.<div class="sub">Save them before you leave it?</div></div>
      <button data-k="save" class="primary">Save</button><button data-k="drop">Don't save</button><button data-k="cancel">Cancel</button></div>`;
    if(LAY.edit === L.id) return `<div class="lay-r on"><input id="layName" value="${esc(L.name)}" maxlength="60" autocomplete="off"><button id="layOk" class="primary">OK</button></div>`;
    return `<div class="lay-r${on ? " on" : ""}" data-id="${L.id}"><div class="lay-n"><b>${esc(L.name)}</b>${on ? ' <span class="tag">open</span>' : ""}<div class="sub">${esc(laySub(L))}</div></div>
      <button data-a="ren" title="Rename">✎</button><button data-a="copy" title="Make a copy">⧉</button>
      <button data-a="del" class="${LAY.del === L.id ? "arm" : ""}" title="${LAY.del === L.id ? "Click again to delete" : "Delete"}" ${LAY.list.length < 2 ? "disabled" : ""}>✕</button></div>`;
  }).join("");
  p.innerHTML = `<div class="lay-list">${rows}</div>
    <div class="btns" style="margin-top:10px"><button id="layNew">＋ New layout</button><button id="layDup" title="A new layout from the chart as it is now">⧉ Copy this one</button></div>
    <label class="chk" style="margin-top:10px"><input type="checkbox" id="layAutoBox" ${layAuto() ? "checked" : ""}> Save changes automatically</label>
    ${layAuto() ? "" : `<div class="btns" style="margin-top:6px"><button id="laySave" class="primary" ${LAY.dirty ? "" : "disabled"}>${LAY.dirty ? "Save changes (Ctrl+S)" : "Saved"}</button></div>`}
    <p class="help" style="margin:8px 0 0">A layout holds the contract, timeframe, chart type, indicators and Pine scripts with their settings, and the chart settings. ${layAuto() ? "The open layout saves as you change the chart." : "Changes are kept only when you press Save (or Ctrl+S); ● on the button means not saved yet."} Drawings belong to the contract, so they show in every layout. Saved on the server for every device.</p>`;
  const guard = fn => { if(LAY.dirty && !layAuto()){ LAY.ask = fn; layRender(); return; } fn(); };
  const ask = p.querySelector(".lay-ask");
  if(ask) ask.querySelectorAll("[data-k]").forEach(b => b.onclick = async e => {
    e.stopPropagation(); const fn = LAY.ask, k = b.dataset.k; LAY.ask = null;
    if(k === "cancel"){ layRender(); return; }
    if(k === "save") await laySave();
    else { LAY.dirty = false; const j = await api("/api/layouts"); if(j.ok) LAY.list = j.layouts || LAY.list; }   // (the saved copies back)
    if(fn) await fn();
    layRender();
  });
  p.querySelectorAll(".lay-r[data-id]").forEach(r => r.onclick = async e => {
    const id = r.dataset.id, a = e.target.closest("[data-a]") && e.target.closest("[data-a]").dataset.a;
    if(a === "ren"){ layRender("rename", id); return; }
    if(a === "copy"){ if(id === LAY.active) await layCopyOf(id); else guard(() => layCopyOf(id)); return; }
    if(a === "del"){
      if(LAY.del === id){ LAY.del = null; await layDelete(id); layRender(); return; }
      LAY.del = id; layRender(); setTimeout(() => { if(LAY.del === id){ LAY.del = null; layRender(); } }, 4000); return;
    }
    if(id !== LAY.active){ guard(async () => { await layOpen(id); $("#layPick").classList.add("hide"); }); return; }
    $("#layPick").classList.add("hide");
  });
  const inp = $("#layName");
  if(inp){
    inp.focus(); inp.select();
    const ok = async () => { if(await layRename(LAY.edit, inp.value)){ LAY.edit = null; layRender(); } };
    $("#layOk").onclick = ok;
    inp.onkeydown = e => { e.stopPropagation(); if(e.key === "Enter") ok(); if(e.key === "Escape"){ LAY.edit = null; layRender(); } };
  }
  $("#layNew").onclick = () => guard(layNew);
  $("#layDup").onclick = () => layCopyOf(LAY.active);
  $("#layAutoBox").onchange = e => { prefSet("layAuto", e.target.checked); if(e.target.checked){ LAY.dirty = false; layTouch(); } else layTouch(); layRender(); layUi(); };
  const sv = $("#laySave"); if(sv) sv.onclick = async () => { await laySave(); layRender(); };
}
function layBuild(){
  if($("#bLay")) return;
  const b = document.createElement("button"); b.className = "ghost fsb"; b.id = "bLay"; b.textContent = "▦ Layouts";
  $("#bCt").before(b);
  const p = document.createElement("div"); p.id = "layPick"; p.className = "hide";
  p.innerHTML = `<div class="cfgh"><b>Layouts</b><button class="ghost" id="layClose">✕</button></div><div id="layBody"></div>`;
  $("#ctPick").after(p);
  b.onclick = e => { e.stopPropagation(); const show = p.classList.contains("hide");
    for(const id of ["#ctPick", "#szPick", "#cfgPick", "#tfPick", "#indPick"]) $(id).classList.add("hide");
    p.classList.toggle("hide", !show); if(show){ LAY.edit = null; layRender(); } };
  $("#layClose").onclick = () => p.classList.add("hide");
  p.addEventListener("click", e => e.stopPropagation());
  document.addEventListener("click", e => { if(document.contains(e.target) && !e.target.closest("#layPick,#bLay")) p.classList.add("hide"); }, true);   // (capture: the other chart menus stop their clicks)
}
/* every chart setting goes through prefSet: the open layout follows it */
(function layHooks(){
  if(window.FTM_CELL != null || window.FTM_REPLAY) return;   // a grid's chart frame (the page around it keeps the layouts), a trade replay
  const ps = prefSet;
  prefSet = function(k, v){
    ps.apply(this, arguments);
    if(!LAY.ready || LAY.applying) return;
    if(LAY_KEYS.includes(k)) layTouch();
    else if(k === "draw"){ const tb = (v || {}).tb !== false; if(tb !== LAY.tb){ LAY.tb = tb; layTouch(); } }
  };
  layBuild();
  // the page closing: what's still waiting goes out now (keepalive)
  addEventListener("pagehide", () => {
    layPrefsNow(true);
    if(LAY.saveT){ clearTimeout(LAY.saveT); LAY.saveT = null; const L = layCur(); if(L) layBeacon("/api/layouts", {op: "put", layout: L}); }
  });
  // Ctrl+S saves the open layout (as on TradingView); not while typing (the Pine Editor has its own Ctrl+S)
  window.addEventListener("keydown", e => {
    if(!(e.ctrlKey || e.metaKey) || e.altKey || (e.code !== "KeyS" && e.key !== "s")) return;
    if(e.target && e.target.closest && e.target.closest("input,select,textarea,[contenteditable],.CodeMirror")) return;
    if(!LAY.ready || $("#app").classList.contains("hide")) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if(layAuto()) toast("Layouts save themselves as you change the chart"); else laySave();
  }, true);
  // after the page's own start-up (prefs and the first chart)
  (function wait(n){ if(LAY.ready || n > 240) return; if(!LAY.loading && chart && !$("#app").classList.contains("hide") && typeof P !== "undefined" && P.snap && Date.now() - (LAY.tried || 0) > 5000){ LAY.tried = Date.now(); layInit(); } setTimeout(() => wait(n + 1), 250); })(0);
})();
