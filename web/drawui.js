/* The drawing tools' screens (v0.22.0): the toolbar down the left of the chart (hide / show with ✎, D or Chart
   settings; on the phone ✎ opens it as a strip over the chart), the tool menus, the bar over a selected drawing,
   colours, the settings dialog, the right-click menu, the drawings list, text editing and the keyboard.
   The drawing engine is draw.js. */
"use strict";
const DI = (k, extra = "") => `<svg viewBox="0 0 28 28" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DR_ICONS[k] || ""}${extra}</svg>`;
const DR_ICONS = {
  cursor: '<path d="M8 4l12 10-5.5 1 3 6-2.5 1.2-3-6L8 20z"/>',
  trend: '<path d="M6 22L22 6"/><circle cx="6" cy="22" r="2"/><circle cx="22" cy="6" r="2"/>',
  ray: '<path d="M6 21L25 6"/><circle cx="6" cy="21" r="2"/><circle cx="14" cy="14.7" r="2"/>',
  extl: '<path d="M2 25L26 3"/><circle cx="9" cy="18.6" r="2"/><circle cx="19" cy="9.4" r="2"/>',
  hline: '<path d="M3 14h22"/><circle cx="14" cy="14" r="2"/>',
  hray: '<path d="M8 14h17"/><circle cx="8" cy="14" r="2"/>',
  vline: '<path d="M14 3v22"/><circle cx="14" cy="14" r="2"/>',
  cross: '<path d="M14 3v22M3 14h22"/><circle cx="14" cy="14" r="2"/>',
  channel: '<path d="M4 17L20 5M8 24L24 12"/><path d="M6 20.5L22 8.5" stroke-dasharray="2 2"/>',
  regr: '<path d="M4 19L24 9" stroke-dasharray="3 2"/><path d="M4 14L24 4M4 24L24 14"/>',
  pitch: '<path d="M3 21L12 14M12 8L25 5M12 14L25 13M12 20L25 21M12 8v12"/>',
  schiff: '<path d="M3 21L12 14M12 8L25 5M12 14L25 13M12 20L25 21M12 8v12"/><circle cx="7.5" cy="17.5" r="1.4"/>',
  mschiff: '<path d="M3 21L12 14M12 8L25 5M12 14L25 13M12 20L25 21M12 8v12"/><circle cx="5" cy="9" r="1.4"/>',
  fib: '<path d="M4 6h20M4 11h20M4 16h20M4 22h20"/><path d="M6 22L22 6" stroke-dasharray="2 2"/>',
  fibext: '<path d="M4 22L10 8L15 16"/><path d="M15 5h10M15 10h10M15 16h10"/>',
  fibfan: '<path d="M4 24L24 4M4 24L24 10M4 24L24 16M4 24L24 22"/>',
  fibtime: '<path d="M5 4v20M8 4v20M11 4v20M16 4v20M24 4v20"/>',
  gannfan: '<path d="M4 24L9 4M4 24L16 4M4 24L24 4M4 24L24 12M4 24L24 19"/>',
  gannbox: '<rect x="4" y="5" width="20" height="18"/><path d="M4 23L24 5M4 5l20 18M14 5v18M4 14h20"/>',
  rect: '<rect x="5" y="7" width="18" height="14" rx="1"/>',
  ellipse: '<ellipse cx="14" cy="14" rx="10" ry="7"/>',
  tri: '<path d="M14 5L24 22H4z"/>',
  path: '<path d="M4 20L10 10L16 18L24 6"/><path d="M20 6h4v4"/>',
  brush: '<path d="M4 20c4-8 7 4 11-4s5-6 9-8"/>',
  text: '<path d="M7 7h14M14 7v15"/>',
  note: '<path d="M6 5h16v13l-5 5H6z"/><path d="M17 23v-5h5"/>',
  callout: '<path d="M5 5h18v11H13l-6 6v-6H5z"/>',
  plabel: '<path d="M3 14l5-6h17v12H8z"/>',
  arrow: '<path d="M5 23L22 6M14 6h8v8"/>',
  arup: '<path d="M14 5l7 8h-4v9h-6v-9H7z"/>',
  ardn: '<path d="M14 23l7-8h-4V6h-6v9H7z"/>',
  long: '<path d="M5 5h18v9H5z" fill="currentColor" fill-opacity=".25"/><path d="M5 14h18v7H5z"/><path d="M5 14h18"/>',
  short: '<path d="M5 7h18v7H5z"/><path d="M5 14h18v9H5z" fill="currentColor" fill-opacity=".25"/><path d="M5 14h18"/>',
  prange: '<path d="M5 6h18M5 22h18M14 6v16M11 19l3 3 3-3"/>',
  drange: '<path d="M6 5v18M22 5v18M6 14h16M19 11l3 3-3 3"/>',
  dprange: '<rect x="5" y="6" width="18" height="16"/><path d="M14 6v16M5 14h18"/>',
  meas: '<path d="M3 19L19 3l6 6L9 25z"/><path d="M7 15l2 2M10 12l3 3M13 9l2 2M16 6l3 3"/>',
  mag: '<path d="M7 5v9a7 7 0 0 0 14 0V5h-5v9a2 2 0 0 1-4 0V5z"/><path d="M7 9h5M16 9h5"/>',
  stay: '<path d="M4 24l1.5-5L17 7.5l3.5 3.5L9 22.5z"/><rect x="18" y="19" width="7" height="6" rx="1"/><path d="M19.5 19v-2a2 2 0 0 1 4 0v2"/>',
  lock: '<rect x="7" y="13" width="14" height="10" rx="1"/><path d="M10 13V9a4 4 0 0 1 8 0v4"/>',
  hide: '<path d="M2.5 14S7 7 14 7s11.5 7 11.5 7S21 21 14 21 2.5 14 2.5 14z"/><circle cx="14" cy="14" r="3.2"/>',
  list: '<path d="M10 8h13M10 14h13M10 20h13"/><circle cx="5.5" cy="8" r="1.2"/><circle cx="5.5" cy="14" r="1.2"/><circle cx="5.5" cy="20" r="1.2"/>',
  trash: '<path d="M6 8h16M11 8V5h6v3M8 8l1 15h10l1-15"/>',
  clone: '<rect x="9" y="9" width="14" height="14" rx="1"/><path d="M5 19V6a1 1 0 0 1 1-1h13"/>',
  gear: '<circle cx="14" cy="14" r="3.5"/><path d="M14 3v4M14 21v4M3 14h4M21 14h4M6.2 6.2l2.8 2.8M19 19l2.8 2.8M6.2 21.8L9 19M19 9l2.8-2.8"/>',
  pen: '<path d="M4 24l1.5-5L17 7.5l3.5 3.5L9 22.5z"/>'
};
const DR_KEYS = {trend: "Alt+T", hline: "Alt+H", hray: "Alt+J", vline: "Alt+V", cross: "Alt+C", fib: "Alt+F", rect: "Alt+Shift+R"};

/* ---------------------------------------------------------------- the toolbar */
function drUiBuild(){
  if($("#dtb")) return;
  const tb = document.createElement("div"); tb.id = "dtb";
  $("#chart").before(tb);
  const fly = document.createElement("div"); fly.id = "dtbFly"; fly.className = "hide"; document.body.append(fly);
  for(const id of ["dsel", "drTxtBox"]){ const d = document.createElement("div"); d.id = id; d.className = "hide"; $("#chart").append(d); }
  for(const id of ["dcol", "drMenu", "drLst"]){ const d = document.createElement("div"); d.id = id; d.className = "hide"; document.body.append(d); }
  const m = document.createElement("div"); m.id = "drSetWrap"; m.className = "hide"; m.innerHTML = '<div id="drSet"></div>'; document.body.append(m);
  // the ✎ button on the chart's top bar
  const b = document.createElement("button"); b.className = "ghost fsb"; b.id = "bDraw"; b.title = "Drawing tools: show / hide the toolbar (D)"; b.innerHTML = "✎";
  const ref = $("#bInd"); ref.before(b);
  b.onclick = e => { e.stopPropagation(); drToggleBar(); };
  drUiTools();
  document.addEventListener("click", e => {
    if(!document.contains(e.target)) return;               // a button that re-drew its own list
    if(!e.target.closest("#dtbFly,.dtb-more,.dtb-g")) $("#dtbFly").classList.add("hide");
    if(!e.target.closest("#dcol,.ds-col")) $("#dcol").classList.add("hide");
    if(!e.target.closest("#drMenu")) drUiMenuClose();
    if(!e.target.closest("#drLst,[data-a=list]")) $("#drLst").classList.add("hide");
  });
}
function drMob(){ return document.body.classList.contains("mob"); }
function drBarShown(){ return drMob() ? document.body.classList.contains("dtbm") : drPref().tb !== false; }
function drToggleBar(on){
  if(on == null) on = !drBarShown();
  if(drMob()) document.body.classList.toggle("dtbm", on);
  else { drPrefSet({tb: on}); document.body.classList.toggle("notb", !on); }
  $("#bDraw").classList.toggle("on", drBarShown());
  if(!on) $("#dtbFly").classList.add("hide");
  setTimeout(() => { if(typeof legendPlace === "function") legendPlace(); if(typeof positionTools === "function") positionTools(); }, 60);
}
function drUiTools(){
  const tb = $("#dtb"); if(!tb) return;
  const pf = drPref(), last = pf.last || {};
  const btn = (attrs, icon, title, on) => `<button class="dtb-b${on ? " on" : ""}" ${attrs} title="${esc(title)}">${DI(icon)}</button>`;
  let h = btn('data-a="cursor"', "cursor", "Cursor (Esc)", !DR.tool && !DR.measArm);
  for(const [g, name, list] of DR_GROUPS){
    const t = DR.tool && DT[DR.tool].g === g ? DR.tool : last[g] && list.includes(last[g]) ? last[g] : list[0];
    h += `<div class="dtb-g" data-g="${g}">${btn(`data-tool="${t}"`, t, DT[t].name + (DR_KEYS[t] ? " (" + DR_KEYS[t] + ")" : "") + " · › for all " + name.toLowerCase(), DR.tool === t)}<button class="dtb-more" data-g="${g}" title="${esc(name)}">›</button></div>`;
  }
  h += btn('data-a="meas"', "meas", "Measure (Shift+click or Shift+drag on the chart; middle-button drag as in MT5)", DR.measArm || !!DR.meas);
  h += '<i class="dtb-sep"></i>';
  h += `<div class="dtb-g">${btn('data-a="mag"', "mag", `Magnet: ${pf.mag === "off" ? "off" : pf.mag === "weak" ? "weak (snaps near the open / high / low / close)" : "strong (always snaps)"} · Ctrl while drawing flips it`, pf.mag !== "off")}<button class="dtb-more" data-a="magm" title="Magnet mode">›</button></div>`;
  h += btn('data-a="stay"', "stay", "Stay in drawing mode (keep the tool after each drawing)", pf.stay);
  h += btn('data-a="lock"', "lock", "Lock all drawings", pf.lockAll);
  h += btn('data-a="hide"', "hide", pf.hideAll ? "Show all drawings" : "Hide all drawings", pf.hideAll);
  h += btn('data-a="list"', "list", "Drawings on this chart", false);
  h += btn('data-a="clear"', "trash", "Remove all drawings on this contract", false);
  tb.innerHTML = h;
  tb.classList.toggle("tool-on", !!DR.tool);
  tb.querySelectorAll("[data-tool]").forEach(b => b.onclick = e => { e.stopPropagation(); drSetTool(DR.tool === b.dataset.tool ? null : b.dataset.tool); });
  tb.querySelectorAll(".dtb-more[data-g]").forEach(b => b.onclick = e => { e.stopPropagation(); drFly(b, b.dataset.g); });
  const A = a => tb.querySelector(`[data-a="${a}"]`);
  A("cursor").onclick = () => { DR.meas = null; drSetTool(null); };
  A("meas").onclick = e => { e.stopPropagation(); DR.tool = null; DR.draft = null; DR.measArm = !DR.measArm; DR.meas = null; drUiTools(); drRedraw(); };
  A("mag").onclick = () => { const p = drPref(); drPrefSet({mag: p.mag === "off" ? (p.magLast || "weak") : "off", magLast: p.mag === "off" ? p.magLast : p.mag}); drUiTools(); };
  A("magm").onclick = e => { e.stopPropagation(); drFly(A("magm"), "mag"); };
  A("stay").onclick = () => { drPrefSet({stay: !drPref().stay}); drUiTools(); };
  A("lock").onclick = () => { drPrefSet({lockAll: !drPref().lockAll}); drUiTools(); drUiSel(); drRedraw(); };
  A("hide").onclick = () => { drPrefSet({hideAll: !drPref().hideAll}); if(drPref().hideAll) DR.sel = null; drUiTools(); drUiSel(); drRedraw(); };
  A("list").onclick = e => { e.stopPropagation(); drListOpen(A("list")); };
  A("clear").onclick = e => { e.stopPropagation(); drClearAll(A("clear")); };
  if($("#bDraw")) $("#bDraw").classList.toggle("on", drBarShown());
}
function drFlyPos(el, anchor){
  const r = anchor.getBoundingClientRect(), mob = drMob();
  el.style.left = Math.max(4, Math.min(innerWidth - el.offsetWidth - 4, mob ? r.left : r.right + 4)) + "px";
  el.style.top = Math.max(4, Math.min(innerHeight - el.offsetHeight - 4, mob ? r.bottom + 4 : r.top - 4)) + "px";
}
function drFly(anchor, g){
  const f = $("#dtbFly");
  if(!f.classList.contains("hide") && f.dataset.g === g){ f.classList.add("hide"); return; }
  f.dataset.g = g;
  if(g === "mag"){
    const m = drPref().mag;
    f.innerHTML = `<div class="fh">Magnet</div>` + [["off", "Off"], ["weak", "Weak: snaps when near the open / high / low / close"], ["strong", "Strong: always snaps to the nearest"]]
      .map(([v, n]) => `<button data-m="${v}" class="${m === v ? "on" : ""}">${DI("mag")}<span>${n}</span></button>`).join("");
    f.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { drPrefSet({mag: b.dataset.m, magLast: b.dataset.m === "off" ? drPref().magLast : b.dataset.m}); f.classList.add("hide"); drUiTools(); });
  } else {
    const grp = DR_GROUPS.find(x => x[0] === g);
    f.innerHTML = `<div class="fh">${esc(grp[1])}</div>` + grp[2].map(t => `<button data-t="${t}" class="${DR.tool === t ? "on" : ""}">${DI(t)}<span>${esc(DT[t].name)}</span>${DR_KEYS[t] ? `<kbd>${DR_KEYS[t]}</kbd>` : ""}</button>`).join("");
    f.querySelectorAll("[data-t]").forEach(b => b.onclick = () => { f.classList.add("hide"); drSetTool(b.dataset.t); });
  }
  f.classList.remove("hide"); drFlyPos(f, anchor);
}
function drClearAll(btn){
  if(!DR.items.length){ toast("No drawings on this contract"); return; }
  if(btn.dataset.arm && Date.now() - +btn.dataset.arm < 4000){
    drBefore(); DR.items = []; DR.sel = null; drChanged(); btn.dataset.arm = ""; btn.classList.remove("arm");
    toast("All drawings removed (Ctrl+Z brings them back)"); return;
  }
  btn.dataset.arm = Date.now(); btn.classList.add("arm");
  toast(`Remove all ${DR.items.length} drawing${DR.items.length === 1 ? "" : "s"} on ${symLabel(DR.s)}? Click 🗑 again`);
  setTimeout(() => btn.classList.remove("arm"), 4000);
}

/* ---------------------------------------------------------------- the bar over a selected drawing */
function drUiSel(){
  const el = $("#dsel"); if(!el) return;
  const d = DR.sel && drFind(DR.sel);
  if(!d || drPref().hideAll){ el.classList.add("hide"); el.dataset.sig = ""; return; }
  const T = DT[d.type], st = drStyleOf(d), lock = d.lock || drPref().lockAll;
  const sig = JSON.stringify([d.id, st, d.lock, drPref().lockAll, d.lots]);
  if(el.dataset.sig !== sig){
    el.dataset.sig = sig;
    let h = `<span class="ds-name">${esc(T.name)}</span>`;
    if(!T.pos) h += `<button class="ds-col" data-k="c" title="Colour"><i style="background:${esc(st.c || "#2962ff")}"></i></button>`;
    if(T.fill && st.fc !== undefined) h += `<button class="ds-col" data-k="fc" title="Fill / background"><i style="background:${esc(rgbaHex(st.fc || st.c, Math.max(0.25, (+st.fa || 0) / 100)))}"></i></button>`;
    if(!T.noWidth && !T.pos && st.w != null) h += `<select data-s="w" title="Line width">${[1, 2, 3, 4].map(w => `<option value="${w}" ${+st.w === w ? "selected" : ""}>${w}px</option>`).join("")}</select>`;
    if(!T.noWidth && !T.pos && st.ls != null) h += `<select data-s="ls" title="Line style">${[[0, "Solid"], [2, "Dashed"], [1, "Dotted"]].map(([v, n]) => `<option value="${v}" ${+st.ls === v ? "selected" : ""}>${n}</option>`).join("")}</select>`;
    if(T.pos) h += `<label class="ds-lots" title="Lots, for the net ₹">Lots <input data-lots type="number" min="1" max="1000" value="${Math.max(1, Math.round(+d.lots || drLots()))}"></label>`;
    if(T.text) h += `<button data-a="text" title="Text">T</button>`;
    h += `<button data-a="set" title="Settings">${DI("gear")}</button>`;
    h += `<button data-a="lock" class="${d.lock ? "on" : ""}" title="${d.lock ? "Unlock" : "Lock"}">${DI("lock")}</button>`;
    h += `<button data-a="clone" title="Clone (Ctrl+drag)">${DI("clone")}</button>`;
    h += `<button data-a="del" title="Remove (Del)">${DI("trash")}</button>`;
    el.innerHTML = h;
    for(const ev of ["mousedown", "touchstart"]) el.addEventListener(ev, e => e.stopPropagation(), {passive: true});
    // each button finds the drawing when it's clicked (after Ctrl+Z the list holds new copies of the drawings)
    const id = d.id, D = () => drFind(id);
    el.querySelectorAll(".ds-col").forEach(b => b.onclick = e => { e.stopPropagation(); if(D()) drColorPop(b, D(), b.dataset.k); });
    el.querySelectorAll("select[data-s]").forEach(s => s.onchange = () => { if(D()) drSetStyle(D(), {[s.dataset.s]: +s.value}); });
    const lots = el.querySelector("[data-lots]"); if(lots) lots.onchange = () => { const x = D(); if(!x) return; drBefore(); x.lots = Math.max(1, Math.min(1000, Math.round(+lots.value || 1))); drPrefSet({lots: x.lots}); drChanged(); };
    const A = a => el.querySelector(`[data-a="${a}"]`);
    if(A("text")) A("text").onclick = () => { if(D()) drEditText(D()); };
    A("set").onclick = () => { if(D()) drSettings(D()); };
    A("lock").onclick = () => { const x = D(); if(!x) return; drBefore(); x.lock = !x.lock; drChanged(); };
    A("clone").onclick = () => { if(D()) drClone(D()); };
    A("del").onclick = () => drRemove(id);
  }
  el.classList.toggle("locked", !!lock);
  el.classList.remove("hide");
}
function drColorPop(anchor, d, key){
  const p = $("#dcol"), st = drStyleOf(d), fill = key === "fc", val = st[key] || st.c || "#2962ff";
  p.innerHTML = `<div class="dc-pal">${DR_PAL.map(c => `<button data-c="${c}" style="background:${c}" class="${c.toLowerCase() === String(val).toLowerCase() ? "on" : ""}" title="${c}"></button>`).join("")}</div>
    <label>Custom <input type="color" value="${/^#[\da-f]{6}$/i.test(val) ? val : "#2962ff"}"></label>
    ${fill || st.fa != null && key === "c" && DT[d.type].fill === undefined ? `<label>Opacity <input type="range" min="0" max="100" value="${st.fa == null ? 20 : st.fa}"><span>${st.fa == null ? 20 : st.fa}%</span></label>` : ""}
    ${fill && "bg" in st ? `<label><input type="checkbox" data-bg ${st.bg ? "checked" : ""}> Background</label>` : ""}`;
  const D = () => drFind(d.id);
  p.querySelectorAll("[data-c]").forEach(b => b.onclick = () => { if(!D()) return; drSetStyle(D(), {[key]: b.dataset.c, ...(fill && "bg" in st ? {bg: true} : {})}); drColorPop(anchor, D(), key); });
  p.querySelector("input[type=color]").onchange = e => { if(D()) drSetStyle(D(), {[key]: e.target.value}); };
  const rg = p.querySelector("input[type=range]");
  if(rg){ rg.oninput = () => { rg.nextElementSibling.textContent = rg.value + "%"; }; rg.onchange = () => { if(D()) drSetStyle(D(), {fa: +rg.value}); }; }
  const bg = p.querySelector("[data-bg]"); if(bg) bg.onchange = () => { if(D()) drSetStyle(D(), {bg: bg.checked}); };
  p.classList.remove("hide");
  const r = anchor.getBoundingClientRect();
  p.style.left = Math.max(4, Math.min(innerWidth - p.offsetWidth - 4, r.left)) + "px"; p.style.top = (r.bottom + 6) + "px";
}

/* ---------------------------------------------------------------- right-click menu */
function drMenu(d, x, y){
  const m = $("#drMenu");
  const items = [["set", "Settings…"], ["xy", "Coordinates…"], ["clone", "Clone"], ["copy", "Copy (Ctrl+C)"], ["lock", d.lock ? "Unlock" : "Lock"], ["hide", "Hide"],
    ["front", "Bring to front"], ["back", "Send to back"], ["del", "Remove (Del)"]];
  if(DT[d.type].text) items.splice(1, 0, ["text", "Edit text"]);
  m.innerHTML = `<div class="fh">${esc(DT[d.type].name)}</div>` + items.map(([a, n]) => `<button data-a="${a}" class="${a === "del" ? "danger-t" : ""}">${n}</button>`).join("");
  m.querySelectorAll("[data-a]").forEach(b => b.onclick = () => {
    drUiMenuClose(); const a = b.dataset.a; d = drFind(d.id); if(!d) return;
    if(a === "set") drSettings(d); if(a === "xy") drSettings(d, "xy"); if(a === "text") drEditText(d); if(a === "clone") drClone(d);
    if(a === "copy"){ DR.clip = JSON.stringify(d); toast("Copied: Ctrl+V pastes it on any chart"); }
    if(a === "lock"){ drBefore(); d.lock = !d.lock; drChanged(); }
    if(a === "hide"){ drBefore(); d.hide = true; DR.sel = null; drChanged(); toast("Hidden: the drawings list shows it again"); }
    if(a === "front" || a === "back"){ drBefore(); DR.items = DR.items.filter(x => x !== d); if(a === "front") DR.items.push(d); else DR.items.unshift(d); drChanged(); }
    if(a === "del") drRemove(d.id);
  });
  m.classList.remove("hide");
  m.style.left = Math.min(x, innerWidth - m.offsetWidth - 4) + "px"; m.style.top = Math.min(y, innerHeight - m.offsetHeight - 4) + "px";
}
function drUiMenuClose(){ const m = $("#drMenu"); if(m) m.classList.add("hide"); }

/* ---------------------------------------------------------------- the drawings list */
function drListOpen(anchor){
  const l = $("#drLst");
  if(!l.classList.contains("hide")){ l.classList.add("hide"); return; }
  l.classList.remove("hide"); drUiList(); drFlyPos(l, anchor);
}
function drUiList(){
  const l = $("#drLst"); if(!l || l.classList.contains("hide")) return;
  const rows = DR.items.slice().reverse().map(d => {
    const T = DT[d.type], what = d.text ? " · " + d.text.split("\n")[0].slice(0, 24) : T.pos ? ` @ ${fmt(d.pts[0].p, drTick())}` : d.pts[0] ? ` · ${fmt(d.pts[0].p, drTick())}` : "";
    return `<div class="dl-r${d.id === DR.sel ? " on" : ""}${d.hide ? " off" : ""}" data-id="${d.id}">${DI(d.type)}<span class="dl-n">${esc(T.name + what)}</span>
      <button data-a="eye" title="${d.hide ? "Show" : "Hide"}">${d.hide ? "◌" : "●"}</button><button data-a="lock" class="${d.lock ? "on" : ""}" title="${d.lock ? "Unlock" : "Lock"}">${DI("lock")}</button><button data-a="del" title="Remove">✕</button></div>`;
  }).join("");
  l.innerHTML = `<div class="fh">Drawings on ${esc(symLabel(DR.s || ""))} <span class="muted">${DR.items.length}</span></div>${rows || `<div class="empty">None yet. Pick a tool on the left and draw on the chart.</div>`}
    <p class="help">Saved on the server for this contract: every device, every timeframe and chart type shows them.</p>`;
  for(const ev of ["mousedown", "touchstart"]) l.addEventListener(ev, e => e.stopPropagation(), {passive: true});
  l.querySelectorAll(".dl-r").forEach(r => r.onclick = e => {
    const d = drFind(r.dataset.id); if(!d) return;
    const a = e.target.closest("[data-a]") && e.target.closest("[data-a]").dataset.a;
    if(a === "eye"){ drBefore(); d.hide = !d.hide; if(d.hide && DR.sel === d.id) DR.sel = null; drChanged(); return; }
    if(a === "lock"){ drBefore(); d.lock = !d.lock; drChanged(); return; }
    if(a === "del"){ drRemove(d.id); return; }
    if(d.hide){ drBefore(); d.hide = false; drChanged(); }
    DR.sel = d.id; drUiSel(); drRedraw(); drUiList(); drScrollTo(d);
  });
}
function drScrollTo(d){                                    // a drawing off screen: bring it into view, keeping the zoom
  try{
    const ts = chart.timeScale(), r = ts.getVisibleLogicalRange(); if(!r) return;
    const L = t2L(d.pts[0].t, DT[d.type].free); if(L == null || (L >= r.from && L <= r.to)) return;
    const w = r.to - r.from; ts.setVisibleLogicalRange({from: L - w / 2, to: L + w / 2});
  }catch(e){}
}

/* ---------------------------------------------------------------- text */
function drEditText(d, fresh){
  const box = $("#drTxtBox"), V = drView(); if(!box || !V) return;
  const p = drXY(V, d.pts[d.type === "callout" ? 1 : 0]);
  box.innerHTML = `<textarea rows="${Math.max(2, (d.text || "").split("\n").length)}" placeholder="Type, Enter to finish (Shift+Enter: new line)">${esc(d.text || "")}</textarea>`;
  box.classList.remove("hide");
  const W = $("#chart").clientWidth;
  box.style.left = Math.max(4, Math.min(W - 250, (p.x || 40) + 6)) + "px"; box.style.top = Math.max(4, (p.y || 40) - 20) + "px";
  const ta = box.querySelector("textarea"); ta.focus(); ta.select();
  let done = false;
  const finish = ok => {
    if(done) return; done = true; box.classList.add("hide");
    const v = ta.value.replace(/\s+$/, "");
    if(!ok){ if(fresh && !d.text) drRemove(d.id); return; }
    if(fresh && !v && ["text", "note", "callout"].includes(d.type)){ drRemove(d.id); return; }
    if(v !== (d.text || "")){ drBefore(); d.text = v.slice(0, 2000); drChanged(); }
  };
  ta.onkeydown = e => { e.stopPropagation(); if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); finish(true); } if(e.key === "Escape"){ e.preventDefault(); finish(false); } };
  ta.onblur = () => finish(true);
  for(const ev of ["mousedown", "touchstart"]) box.addEventListener(ev, e => e.stopPropagation(), {passive: true});
}

/* ---------------------------------------------------------------- settings dialog */
const DR_LABELS = {c: "Colour", w: "Line width", ls: "Line style", fc: "Fill / background", fa: "Fill opacity %", el: "Extend left", er: "Extend right",
  lbl: "Labels", tl: "Trend line", rev: "Reverse", mid: "Middle line", dev: "Deviation (×σ)", bg: "Background", fs: "Font size", arr: "Arrow at the end",
  money: "Net ₹ and R (your lots)", pc: "Profit colour", lc: "Loss colour", tc: "Text colour"};
/* which coordinates a point has: price, time, or both (a horizontal line has no time that matters, a vertical line no price) */
function drCoordDefs(d){
  const T = DT[d.type];
  if(T.pos) return [{i: 0, name: "Entry", price: true, time: true}, {i: 1, name: "Target", price: true}, {i: 2, name: "Stop", price: true}, {i: 1, name: "End (right edge)", time: true, end: true}];
  if(d.type === "brush") return [];
  const only = {hline: "price", vline: "time", regr: "time"}[d.type];
  return d.pts.slice(0, 40).map((_, i) => ({i, name: d.pts.length === 1 ? "Point" : "Point " + (i + 1), price: only !== "time", time: only !== "price"}));
}
function drDateParts(t){ const x = new Date(t * 1000); const z = n => String(n).padStart(2, "0");
  return [`${x.getUTCFullYear()}-${z(x.getUTCMonth() + 1)}-${z(x.getUTCDate())}`, `${z(x.getUTCHours())}:${z(x.getUTCMinutes())}`]; }
function drPartsTime(date, time){                         // IST date + time typed in -> chart time (epoch + IST)
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(date || ""), h = /^(\d\d?):(\d\d)$/.exec(time || "00:00");
  if(!m || !h || +h[1] > 23 || +h[2] > 59) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +h[1], +h[2]) / 1000;
}
/* where a time lands on this chart: the bar holding it (exactly what the drawing will show) */
function drBarNote(t, free){
  if(t == null || !DISP.length) return "";
  const L = t2L(t, free), n = DISP.length, unit = drUnits()[1].replace(/s$/, "");
  if(L > n - 1) return `${Math.round(L - (n - 1))} ${unit}${Math.round(L - (n - 1)) === 1 ? "" : "s"} after the last ${unit}`;
  if(L < 0) return `before the first ${unit} loaded`;
  const b = DISP[Math.floor(L)];
  return `on the ${unit} of ${drTimeStr(b.time)}` + (b.time === t ? "" : CT.timeBased(ctType()) ? ` (${tf} ${unit} holding it)` : "");
}
function drSettings(d, tab){
  const T = DT[d.type], st = drStyleOf(d), wrap = $("#drSetWrap"), box = $("#drSet");
  const draft = JSON.parse(JSON.stringify(st)), tick = drTick(), dps = (String(tick).split(".")[1] || "").length;
  const row = (k) => {
    const v = draft[k], lab = k === "lbl" && T.lblOpt ? T.lblOpt : DR_LABELS[k] || k;
    if(["c", "fc", "pc", "lc", "tc"].includes(k)) return `<div class="ds-r"><span>${lab}</span><input type="color" data-k="${k}" value="${/^#[\da-f]{6}$/i.test(v || "") ? v : "#2962ff"}"></div>`;
    if(k === "w") return `<div class="ds-r"><span>${lab}</span><select data-k="w" data-num>${[1, 2, 3, 4].map(w => `<option ${+v === w ? "selected" : ""}>${w}</option>`).join("")}</select></div>`;
    if(k === "ls") return `<div class="ds-r"><span>${lab}</span><select data-k="ls" data-num>${[[0, "Solid"], [2, "Dashed"], [1, "Dotted"]].map(([x, n]) => `<option value="${x}" ${+v === x ? "selected" : ""}>${n}</option>`).join("")}</select></div>`;
    if(typeof v === "boolean") return `<div class="ds-r"><span>${lab}</span><input type="checkbox" data-k="${k}" ${v ? "checked" : ""}></div>`;
    if(typeof v === "number") return `<div class="ds-r"><span>${lab}</span><input type="number" data-k="${k}" data-num value="${v}" step="${k === "dev" ? 0.5 : 1}" min="0"></div>`;
    return "";
  };
  if(T.pos){ draft.pc = draft.pc || chartCfg().profitZ; draft.lc = draft.lc || chartCfg().lossZ; }
  const tabs = [["style", "Style"]].concat(T.text ? [["text", "Text"]] : [], T.levels ? [["lv", "Levels"]] : [], [["xy", "Coordinates"]]);
  tab = tabs.some(x => x[0] === tab) ? tab : tabs.some(x => x[0] === DR.setTab) ? DR.setTab : "style";
  let h = `<div class="pih"><b style="flex:1">${esc(T.name)}</b><button class="ghost" data-x>✕</button></div>
    <div class="ds-tabs">${tabs.map(([k, n]) => `<button data-tab="${k}" class="${k === tab ? "on" : ""}">${n}</button>`).join("")}</div><div class="pib">`;
  h += `<div data-sec="style">` + Object.keys(draft).filter(k => k !== "lv").map(row).join("") + `</div>`;
  if(T.text) h += `<div data-sec="text"><textarea data-text rows="5">${esc(d.text || "")}</textarea></div>`;
  if(T.levels) h += `<div data-sec="lv"><div class="ds-lv">` + (draft.lv || []).map((l, i) => `<div class="ds-l"><input type="checkbox" data-lvon="${i}" ${l[1] ? "checked" : ""}><input data-lvv="${i}" value="${l[0]}" inputmode="decimal"><input type="color" data-lvc="${i}" value="${l[2]}"></div>`).join("") + `</div>
      <button data-lvadd style="margin-top:8px">＋ Level</button></div>`;
  // coordinates: every point's price (on the tick) and date / time (IST), and the bar it lands on here
  h += `<div data-sec="xy">`;
  const defs = drCoordDefs(d);
  if(!defs.length) h += `<p class="help">A brush stroke has too many points to type: drag it to move it.</p>`;
  for(const c of defs){
    const p = d.pts[c.i], [dt, tm] = drDateParts(p.t);
    h += `<div class="ds-xy" data-c="${c.i}${c.end ? "e" : ""}"><div class="ds-xyh">${esc(c.name)}</div>`
      + (c.price ? `<label>Price <input data-xp class="mono" inputmode="decimal" value="${(+p.p).toFixed(dps)}"></label>` : "")
      + (c.time ? `<label>Date <input type="date" data-xd value="${dt}"></label><label>Time (IST) <input type="time" data-xt step="60" value="${tm}"></label>` : "")
      + (c.time ? `<div class="ds-bar muted" data-xb>${esc(drBarNote(p.t, T.free))}</div>` : "") + `</div>`;
  }
  if(defs.length) h += `<p class="help">Prices go on the tick (${fmt(tick, tick)}). A point sits on the ${drUnits()[1].replace(/s$/, "")} its time falls in on this chart, on every timeframe and chart type; times are Indian time.</p>`;
  if(T.pos) h += `<div class="ds-r"><span>Lots</span><input type="number" data-lots min="1" max="1000" value="${Math.max(1, Math.round(+d.lots || drLots()))}"></div>
      <p class="help">Checked on this timeframe's real candles after the entry candle, up to the right edge. A candle that reaches both the stop and the target can't tell which came first: it's counted as the stop and marked. A candle that opens past a level exits at its open. All ₹ figures are net of every charge both ways.</p>`;
  h += `</div><div class="err" data-err style="min-height:0"></div></div><div class="pif"><button data-def>Reset style</button><span style="flex:1"></span><button data-x>Cancel</button><button class="primary" data-ok>OK</button></div>`;
  box.innerHTML = h; wrap.classList.remove("hide");
  const show = k => { DR.setTab = k; box.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === k)); box.querySelectorAll("[data-sec]").forEach(x => x.classList.toggle("hide", x.dataset.sec !== k)); };
  show(tab);
  box.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => show(b.dataset.tab));
  const close = () => wrap.classList.add("hide");
  box.querySelectorAll("[data-x]").forEach(b => b.onclick = close);
  wrap.onclick = e => { if(e.target === wrap) close(); };
  box.querySelector("[data-def]").onclick = () => { const s = {...DT[d.type].st}; if(s.lv) s.lv = s.lv.map(l => l.slice()); drBefore(); d.st = JSON.parse(JSON.stringify(s)); drChanged(); close(); };
  // the bar each typed time lands on, as you type
  box.querySelectorAll(".ds-xy").forEach(r => { const upd = () => { const b = r.querySelector("[data-xb]"); if(!b) return; const t = drPartsTime(r.querySelector("[data-xd]").value, r.querySelector("[data-xt]").value); b.textContent = t == null ? "date / time not valid" : drBarNote(t, T.free); };
    r.querySelectorAll("[data-xd],[data-xt]").forEach(x => x.addEventListener("input", upd)); });
  const readForm = () => {
    box.querySelectorAll("[data-k]").forEach(el => { const k = el.dataset.k; draft[k] = el.type === "checkbox" ? el.checked : el.dataset.num !== undefined ? +el.value : el.value; });
    if(draft.lv) draft.lv = draft.lv.map((l, i) => { const v = parseFloat(String((box.querySelector(`[data-lvv="${i}"]`) || {}).value).replace(",", ".")); return [isNaN(v) ? l[0] : v, (box.querySelector(`[data-lvon="${i}"]`) || {}).checked ? 1 : 0, (box.querySelector(`[data-lvc="${i}"]`) || {}).value || l[2]]; });
  };
  const add = box.querySelector("[data-lvadd]"); if(add) add.onclick = () => { readForm(); draft.lv.push([1.272, 1, "#2962ff"]); close(); drSettingsRe(d, draft, "lv"); };
  box.querySelector("[data-ok]").onclick = () => {
    d = drFind(d.id); if(!d){ close(); return; }               // (the list may hold new copies after Ctrl+Z)
    const err = m => { box.querySelector("[data-err]").textContent = m; show("xy"); };
    // read and check the coordinates first: nothing changes if one is wrong
    const pts = JSON.parse(JSON.stringify(d.pts));
    for(const r of box.querySelectorAll(".ds-xy")){
      const key = r.dataset.c, i = parseInt(key), end = /e$/.test(key), name = r.querySelector(".ds-xyh").textContent;
      const xp = r.querySelector("[data-xp]"), xd = r.querySelector("[data-xd]");
      if(xp){ const v = parseFloat(String(xp.value).replace(/,/g, "")); if(!(v > 0)){ err(`${name}: the price isn't a number above 0`); return; } pts[i].p = T.free ? v : drRound(v); }
      if(xd){ const t = drPartsTime(xd.value, r.querySelector("[data-xt]").value); if(t == null){ err(`${name}: the date or time isn't valid`); return; }
        if(end){ pts[1].t = t; pts[2].t = t; } else pts[i].t = t; }
    }
    if(T.pos){ const side = d.type === "long" ? 1 : -1, e0 = pts[0].p;
      if(side * (pts[1].p - e0) <= 0){ err(`The target must be ${side > 0 ? "above" : "below"} the entry`); return; }
      if(side * (e0 - pts[2].p) <= 0){ err(`The stop must be ${side > 0 ? "below" : "above"} the entry`); return; }
      if(pts[1].t <= pts[0].t){ err("The end must be after the entry"); return; } }
    readForm();
    drBefore();
    const ch = {}; for(const k of Object.keys(draft)) if(JSON.stringify(draft[k]) !== JSON.stringify(st[k])) ch[k] = draft[k];
    d.st = {...st, ...draft};
    d.pts = pts;
    const ta = box.querySelector("[data-text]"); if(ta) d.text = ta.value.slice(0, 2000);
    const lots = box.querySelector("[data-lots]"); if(lots){ d.lots = Math.max(1, Math.min(1000, Math.round(+lots.value || 1))); drPrefSet({lots: d.lots}); }
    if(Object.keys(ch).length){ const all = {...(drPref().styles || {})}; all[d.type] = {...(all[d.type] || {}), ...ch}; drPrefSet({styles: all}); }
    drChanged(); close();
  };
}
function drSettingsRe(d, draft, tab){ const keep = d.st; d.st = draft; drSettings(d, tab); d.st = keep; }

/* ---------------------------------------------------------------- keyboard */
function drTyping(e){ return e.target && e.target.closest && e.target.closest("input,select,textarea,[contenteditable]"); }
function drChartPage(){ return document.body.dataset.page === "chart" && !$("#app").classList.contains("hide"); }
window.addEventListener("keydown", e => {
  if(!drChartPage() || drTyping(e) || !series) return;
  const eat = () => { e.preventDefault(); e.stopImmediatePropagation(); };
  const code = e.code || "", ctrl = e.ctrlKey || e.metaKey;
  if(e.key === "Escape"){
    if(!$("#drSetWrap").classList.contains("hide")){ $("#drSetWrap").classList.add("hide"); eat(); return; }
    if(DR.draft){ if(DT[DR.draft.d.type].n === -1) drFinish(); else { DR.draft = null; drRedraw(); } eat(); return; }
    if(DR.meas || DR.measArm){ DR.meas = null; DR.measArm = false; drUiTools(); drRedraw(); eat(); return; }
    if(DR.tool){ drSetTool(null); eat(); return; }
    if(DR.sel){ DR.sel = null; drUiSel(); drRedraw(); eat(); return; }
    return;
  }
  if(e.key === "Enter" && DR.draft && DT[DR.draft.d.type].n === -1){ drFinish(); eat(); return; }
  if((e.key === "Delete" || e.key === "Backspace") && DR.sel && !ctrl){ const d = drFind(DR.sel); if(d && !d.lock && !drPref().lockAll){ drRemove(d.id); eat(); } return; }
  if(ctrl && !e.altKey && (code === "KeyZ" || code === "KeyY")){ drUndo(code === "KeyY" || e.shiftKey); eat(); return; }
  if(ctrl && !e.altKey && code === "KeyC" && DR.sel && !String(getSelection())){ DR.clip = JSON.stringify(drFind(DR.sel)); toast("Drawing copied: Ctrl+V pastes it (on any contract)"); eat(); return; }
  if(ctrl && !e.altKey && code === "KeyV" && DR.clip){ const d = JSON.parse(DR.clip); if(DT[d.type]){ const c = drClone(d, d && DR.items.some(x => x.id === d.id) ? 5 : 0); toast("Pasted " + DT[c.type].name.toLowerCase()); } eat(); return; }
  if(e.altKey && !ctrl){
    const map = {KeyT: "trend", KeyH: "hline", KeyJ: "hray", KeyV: "vline", KeyC: "cross", KeyF: "fib"};
    const t = e.shiftKey ? (code === "KeyR" ? "rect" : null) : map[code];
    if(t){ drSetTool(t); eat(); return; }
  }
  if(!ctrl && !e.altKey && !e.shiftKey && (e.key === "d" || e.key === "D")){ drToggleBar(); eat(); }
}, true);

/* ---------------------------------------------------------------- hooks into the page */
function drUiChart(){ drUiBuild(); drUiTools(); drUiSel(); }
(function drHooks(){
  const os = openSymbol;
  openSymbol = function(row){ if(row && row.s) drSymbol(row.s); return os.apply(this, arguments); };
  // Chart settings: the drawing toolbar and the measure's lots
  const rc = renderCfg;
  renderCfg = function(){
    rc.apply(this, arguments);
    const b = $("#cfgBody"); if(!b) return;
    const pf = drPref(), s = document.createElement("div");
    s.innerHTML = `<div class="sec">Drawings</div>
      <div class="cr"><span>Drawing toolbar (D)</span><span></span><span></span><input type="checkbox" id="cfgDtb" ${drBarShown() ? "checked" : ""}></div>
      <div class="cr" style="grid-template-columns:1fr 150px"><span>Magnet</span><select id="cfgMag">${[["off", "Off"], ["weak", "Weak"], ["strong", "Strong"]].map(([v, n]) => `<option value="${v}" ${pf.mag === v ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <div class="cr" style="grid-template-columns:1fr 150px"><span title="The measure tool's net ₹ (and new long / short drawings) use this many lots">Lots for the measure</span><input type="number" id="cfgLots" min="1" max="1000" value="${drLots()}" style="padding:2px 4px"></div>`;
    b.append(s);
    $("#cfgDtb").onchange = e => drToggleBar(e.target.checked);
    $("#cfgMag").onchange = e => { drPrefSet({mag: e.target.value}); drUiTools(); };
    $("#cfgLots").onchange = e => { drPrefSet({lots: Math.max(1, Math.min(1000, Math.round(+e.target.value || 1)))}); drRedraw(); };
  };
  // the phone layout switches in and out on resize: the toolbar strip starts closed there
  new MutationObserver(() => { document.body.classList.toggle("notb", !drMob() && drPref().tb === false); if($("#bDraw")) $("#bDraw").classList.toggle("on", drBarShown()); })
    .observe(document.body, {attributes: true, attributeFilter: ["class"]});
})();
drUiBuild();
document.body.classList.toggle("notb", !drMob() && drPref().tb === false);
// prefs arrive from the server after this file loads: apply the toolbar setting then
(function waitPrefs(n){ if(typeof PREF !== "undefined" && "draw" in PREF){ document.body.classList.toggle("notb", !drMob() && drPref().tb === false); drUiTools(); return; } if(n < 40) setTimeout(() => waitPrefs(n + 1), 250); })(0);
