/* Journal pictures (v0.27.0, roadmap item 4): the pictures on each journal trade, server-drawn at entry and exit, the
   open chart's own picture, your uploads / paste / drop (labelled by timeframe), the viewer, and Journal › Settings ›
   Pictures with the Telegram backup copy. Server: helper/jshots.py, routes /api/journal/shot*, /api/journal/pictures*.
   Loaded after journal.js (uses JN, japi, jnMerge, jnRender, jEsc...). */
const JS = {last: null, view: null, delArm: null, info: null};
const JS_TFS_DEFAULT = ["1m", "2m", "3m", "5m", "10m", "15m", "20m", "30m", "45m", "1h", "2h", "3h", "4h", "1D", "1W", "1M", "Context"];
function jsTfs(){ return (JN.d && JN.d.tfs) || JS_TFS_DEFAULT; }
function jsLabel(sh){ return sh.kind === "upload" ? (sh.tf || "Context") : `${sh.kind === "chart" ? "Chart " : ""}${sh.tf || ""} · ${sh.phase === "entry" ? "entry" : "exit"}`; }
function jsKindText(sh){ return sh.kind === "server" ? "drawn on the server" : sh.kind === "chart" ? "the chart as it was open" : "your picture"; }
function jsUrl(id, sh, thumb, dl){ return `/api/journal/shot?id=${encodeURIComponent(id)}&shot=${encodeURIComponent(sh.id)}${thumb ? "&thumb=1" : ""}${dl ? "&dl=1" : ""}`; }
function jsTrade(id){ return JN.d && JN.d.trades.find(x => x.id === id); }
function jsTgLink(tg){
  if(!tg || !tg.msg || !tg.chat) return "";
  const c = String(tg.chat);
  if(c.startsWith("-100")) return `https://t.me/c/${c.slice(4)}/${tg.msg}`;
  if(c.startsWith("@")) return `https://t.me/${c.slice(1)}/${tg.msg}`;
  return "";
}
function jsTgMark(sh){
  const cfg = (JN.d && JN.d.shots_cfg) || {}, tg = sh.tg || {};
  if(tg.msg) return `<span class="js-tg ok" title="Copy in Telegram">✈</span>`;
  if(tg.err) return `<span class="js-tg bad" title="Telegram copy failed: ${jEsc(tg.err)}">✈!</span>`;
  return cfg.tg && cfg.tg_chat ? `<span class="js-tg wait" title="Telegram copy on its way">✈…</span>` : "";
}

/* ------------------------------------------------------------------ the strip on a trade card and in the audit form */
function jsStrip(t, where){
  const shots = t.shots || [], err = t.shot_err || {}, closed = t.status === "closed";
  const hasServer = ph => shots.some(s => s.kind === "server" && s.phase === ph);
  const draw = [];
  if(!hasServer("entry")) draw.push(`<button class="ghost" data-act="drawpic" data-ph="entry" data-id="${jEsc(t.id)}" title="Draw the chart at the entry on the server, from your Fyers candles">Draw at entry</button>`);
  if(closed && !hasServer("exit")) draw.push(`<button class="ghost" data-act="drawpic" data-ph="exit" data-id="${jEsc(t.id)}" title="Draw the chart at the exit on the server, from your Fyers candles">Draw at exit</button>`);
  const errs = ["entry", "exit"].filter(ph => err[ph] && !hasServer(ph)).map(ph =>
    `<div class="js-err">⚠ The server's picture at ${ph} didn't draw: ${jEsc(err[ph].msg)}</div>`).join("");
  return `<div class="js-strip" data-id="${jEsc(t.id)}" data-where="${where || "card"}">
    <div class="js-head"><b>Pictures</b><span class="muted">${shots.length || ""}</span><span class="sp"></span>${draw.join("")}
      <button data-act="addpic" data-id="${jEsc(t.id)}" title="Add pictures (or paste with Ctrl+V, or drop them here)">＋ Add pictures</button></div>
    ${shots.length ? `<div class="js-thumbs">${shots.map(sh => `<button class="js-th" data-act="shot" data-id="${jEsc(t.id)}" data-sid="${jEsc(sh.id)}" title="${jEsc(jsLabel(sh) + " · " + jsKindText(sh))}">
        <img loading="lazy" alt="${jEsc(jsLabel(sh))}" src="${jsUrl(t.id, sh, true)}"><span class="js-lbl">${jEsc(jsLabel(sh))}</span>${jsTgMark(sh)}</button>`).join("")}</div>`
      : `<div class="muted js-none">No pictures yet. ${t.status === "removed" ? "" : "Paste one (Ctrl+V), drop it here, or tap ＋ Add pictures."}</div>`}
    ${errs}
  </div>`;
}
function jsAct(el){
  const id = el.dataset.id, act = el.dataset.act; JS.last = id;
  if(act === "addpic"){ jsPick(id); return true; }
  if(act === "shot"){ jsView(id, el.dataset.sid); return true; }
  if(act === "drawpic"){ jsDraw(id, el.dataset.ph, el); return true; }
  return false;
}
async function jsDraw(id, ph, btn){
  if(btn){ btn.disabled = true; btn.textContent = "Drawing…"; }
  const j = await japi("/api/journal/shot/draw", {id, phase: ph});
  if(!j.ok){ jToast(j.error || "Couldn't draw it"); if(btn){ btn.disabled = false; btn.textContent = ph === "entry" ? "Draw at entry" : "Draw at exit"; } return; }
  jToast(`Drawing the ${ph} picture on the server (it appears in a few seconds)`);
}

/* ------------------------------------------------------------------ adding pictures: pick, paste, drop */
function jsPick(id){
  let inp = document.getElementById("jsFile");
  if(!inp){ inp = document.createElement("input"); inp.type = "file"; inp.id = "jsFile"; inp.accept = "image/png,image/jpeg,image/webp,image/gif"; inp.multiple = true; inp.className = "hide"; document.body.append(inp); }
  inp.value = "";
  inp.onchange = () => { if(inp.files && inp.files.length) jsUpload(id, [...inp.files]); };
  inp.click();
}
async function jsUpload(id, files, tf){
  const t = jsTrade(id); if(!t) return;
  const imgs = files.filter(f => /^image\//.test(f.type || "") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(f.name || ""));
  if(!imgs.length){ jToast("Only pictures can go in the journal (PNG, JPEG, WebP, GIF)"); return; }
  let added = null, n = 0;
  for(const f of imgs){
    if(/heic|heif/i.test(f.type || "") || /\.hei[cf]$/i.test(f.name || "")){ jToast(`${f.name}: HEIC photos can't be shown in a browser; share it as JPEG`); continue; }
    if(f.size > 10 * 1024 * 1024){ jToast(`${f.name || "That picture"} is over 10 MB`); continue; }
    const q = new URLSearchParams({id, tf: tf || "Context", kind: "upload", name: f.name || ""});
    const r = await fetch("/api/journal/shot/add?" + q, {method: "POST", credentials: "same-origin", headers: {"Content-Type": f.type || "application/octet-stream"}, body: f});
    let j = {}; try{ j = await r.json(); }catch(e){}
    if(!r.ok || !j.ok){ jToast(j.error || j.detail || `Couldn't add ${f.name || "the picture"}`); continue; }
    jnMerge(j.j); added = j.shot; n++;
  }
  if(!n) return;
  jsRefresh(id);
  if(n === 1 && added){ jsView(id, added.id); jToast("Picture added: pick its timeframe below the picture"); }
  else jToast(`${n} pictures added: label each one in the viewer`);
}
function jsRefresh(id){
  if(typeof PG !== "undefined" && PG.page === "journal") jnRender();
  const fs = document.querySelector("#jnModal .js-strip");
  const t = jsTrade(id);
  if(fs && t && fs.dataset.id === id){ const d = document.createElement("div"); d.innerHTML = jsStrip(t, "form"); fs.replaceWith(d.firstElementChild); }
  if(JS.view && JS.view.id === id) jsViewRender();
}
function jsTarget(){
  if(JN.form) return JN.form.id;
  if(typeof PG !== "undefined" && PG.page === "journal"){
    if(JS.last && jsTrade(JS.last) && JN.exp.has(JS.last)) return JS.last;
    const open = [...JN.exp].filter(jsTrade); if(open.length === 1) return open[0];
  }
  return null;
}
document.addEventListener("paste", e => {
  const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter(f => /^image\//.test(f.type || ""));
  if(!files.length) return;
  const onJournal = (typeof PG !== "undefined" && PG.page === "journal") || JN.form || JS.view;
  if(!onJournal) return;
  const id = (JS.view && JS.view.id) || jsTarget();
  e.preventDefault();
  if(!id){ jToast("Open a trade first (tap it in the list), then paste"); return; }
  jsUpload(id, files.map((f, i) => f.name && f.name !== "image.png" ? f : new File([f], `pasted_${Date.now()}_${i}.png`, {type: f.type || "image/png"})));
});
["dragover", "drop"].forEach(ev => document.addEventListener(ev, e => {
  const box = e.target.closest && e.target.closest(".js-strip, .jn-trade.expanded");
  if(!box || !(e.dataTransfer && [...e.dataTransfer.types].includes("Files"))) return;
  e.preventDefault();
  const strip = box.matches(".js-strip") ? box : box.querySelector(".js-strip");
  if(ev === "dragover"){ strip && strip.classList.add("drop"); clearTimeout(JS.dragT); JS.dragT = setTimeout(() => document.querySelectorAll(".js-strip.drop").forEach(x => x.classList.remove("drop")), 300); return; }
  const id = (strip && strip.dataset.id) || box.dataset.id;
  if(id) jsUpload(id, [...e.dataTransfer.files]);
}));

/* ------------------------------------------------------------------ the viewer */
function jsView(id, sid){
  const t = jsTrade(id); if(!t || !(t.shots || []).length) return;
  JS.view = {id, sid: sid || t.shots[0].id}; JS.delArm = null;
  let m = document.getElementById("jsView");
  if(!m){ m = document.createElement("div"); m.id = "jsView"; m.className = "js-modal"; document.body.append(m);
    m.addEventListener("click", e => { if(e.target === m || e.target.classList.contains("js-stage")) jsViewClose(); });
    let sx = null;
    m.addEventListener("pointerdown", e => { if(e.target.closest(".js-stage")) sx = e.clientX; });
    m.addEventListener("pointerup", e => { if(sx != null && Math.abs(e.clientX - sx) > 50) jsStep(e.clientX < sx ? 1 : -1); sx = null; });
  }
  m.classList.remove("hide");
  document.addEventListener("keydown", jsViewKey);
  jsViewRender();
}
function jsViewKey(e){
  if(!JS.view) return;
  if(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if(e.key === "Escape"){ e.stopPropagation(); jsViewClose(); }
  if(e.key === "ArrowRight") jsStep(1);
  if(e.key === "ArrowLeft") jsStep(-1);
}
function jsViewClose(){ JS.view = null; const m = document.getElementById("jsView"); if(m){ m.classList.add("hide"); m.innerHTML = ""; } document.removeEventListener("keydown", jsViewKey); }
function jsStep(n){
  const t = JS.view && jsTrade(JS.view.id); if(!t) return;
  const L = t.shots || [], i = L.findIndex(s => s.id === JS.view.sid);
  if(L.length < 2) return;
  JS.view.sid = L[(i + n + L.length) % L.length].id; JS.delArm = null; jsViewRender();
}
function jsViewRender(){
  const m = document.getElementById("jsView"); if(!m || !JS.view) return;
  const t = jsTrade(JS.view.id);
  if(!t || !(t.shots || []).length){ jsViewClose(); return; }
  let sh = t.shots.find(s => s.id === JS.view.sid);
  if(!sh){ sh = t.shots[0]; JS.view.sid = sh.id; }
  const tg = sh.tg || {}, link = jsTgLink(tg), cfg = (JN.d && JN.d.shots_cfg) || {};
  const tfs = jsTfs().includes(sh.tf) ? jsTfs() : [sh.tf, ...jsTfs()];
  const when = typeof jWhen === "function" ? jWhen(sh.at) : "";
  m.innerHTML = `<div class="js-vbox" role="dialog" aria-label="Picture">
    <div class="js-vhead"><b>${jEsc(jShort(t.s))} <span class="jt-side ${t.side > 0 ? "buy" : "sell"}">${t.side > 0 ? "Buy" : "Sell"} ${t.lots ?? ""}</span></b>
      <span class="muted">${jEsc(jsLabel(sh))} · ${jEsc(jsKindText(sh))}${when ? " · " + jEsc(when) : ""}</span><span class="sp"></span>
      <button class="ghost" id="jsVClose" aria-label="Close">✕</button></div>
    <div class="js-chips">${t.shots.map(s => `<button class="${s.id === sh.id ? "on" : ""}" data-sid="${jEsc(s.id)}">${jEsc(jsLabel(s))}</button>`).join("")}</div>
    <div class="js-stage">${t.shots.length > 1 ? `<button class="js-nav prev" id="jsPrev" aria-label="Previous">‹</button>` : ""}
      <img id="jsImg" src="${jsUrl(t.id, sh)}" alt="${jEsc(jsLabel(sh))}">
      ${t.shots.length > 1 ? `<button class="js-nav next" id="jsNext" aria-label="Next">›</button>` : ""}</div>
    <div class="js-vfoot">
      <label class="js-tfsel">Timeframe <select id="jsTf">${tfs.map(x => `<option${x === sh.tf ? " selected" : ""}>${jEsc(x)}</option>`).join("")}</select></label>
      <span class="js-tgst">${tg.msg ? `✈ In Telegram${link ? ` · <a href="${jEsc(link)}" target="_blank" rel="noopener">open</a>` : ""}` : tg.err ? `<span class="down">✈ Telegram copy failed: ${jEsc(tg.err)}</span>` : cfg.tg && cfg.tg_chat ? "✈ Telegram copy on its way" : `<span class="muted">No Telegram copy (Journal › Settings › Pictures)</span>`}</span>
      <span class="sp"></span>
      ${sh.kind === "server" ? `<button class="ghost" id="jsRedraw" title="Draw this picture again from Fyers' candles">Draw again</button>` : ""}
      <a class="btnlink" href="${jsUrl(t.id, sh)}" target="_blank" rel="noopener">Full size</a>
      <a class="btnlink" href="${jsUrl(t.id, sh, false, true)}">Download</a>
      <button class="${JS.delArm === sh.id ? "danger" : "ghost"}" id="jsDel">${JS.delArm === sh.id ? "Tap again to delete" : "Delete"}</button>
    </div></div>`;
  m.querySelector("#jsVClose").onclick = jsViewClose;
  m.querySelectorAll(".js-chips button").forEach(b => b.onclick = () => { JS.view.sid = b.dataset.sid; JS.delArm = null; jsViewRender(); });
  const pv = m.querySelector("#jsPrev"), nx = m.querySelector("#jsNext");
  if(pv) pv.onclick = e => { e.stopPropagation(); jsStep(-1); };
  if(nx) nx.onclick = e => { e.stopPropagation(); jsStep(1); };
  m.querySelector("#jsTf").onchange = async e => {
    const j = await japi("/api/journal/shot/edit", {id: t.id, shot: sh.id, tf: e.target.value});
    if(j.ok){ jnMerge(j.j); jsRefresh(t.id); jToast("Label saved"); } else jToast(j.error || "Couldn't save the label");
  };
  const rd = m.querySelector("#jsRedraw"); if(rd) rd.onclick = () => jsDraw(t.id, sh.phase, rd);
  m.querySelector("#jsDel").onclick = async () => {
    if(JS.delArm !== sh.id){ JS.delArm = sh.id; jsViewRender(); return; }
    const j = await japi("/api/journal/shot/edit", {id: t.id, shot: sh.id, delete: true});
    if(j.ok){ jnMerge(j.j); JS.delArm = null; jsRefresh(t.id); jToast(sh.tg && sh.tg.msg ? "Picture deleted (and its Telegram copy)" : "Picture deleted"); }
    else jToast(j.error || "Couldn't delete it");
  };
}

/* ------------------------------------------------------------------ the open chart's own picture */
function jsChartOn(){
  const el = document.getElementById("chart");
  return typeof chart !== "undefined" && chart && el && el.offsetWidth > 50 && el.offsetHeight > 50 && !document.body.classList.contains("multi");
}
function jsChartBlob(){
  return new Promise(res => {
    let c; try{ c = chart.takeScreenshot(true); }catch(e){ try{ c = chart.takeScreenshot(); }catch(e2){ res(null); return; } }
    if(!c || !c.width){ res(null); return; }
    const el = document.getElementById("chart"), k = c.width / Math.max(1, el.clientWidth), hh = Math.round(30 * k);
    const out = document.createElement("canvas"); out.width = c.width; out.height = c.height + hh;
    const g = out.getContext("2d");
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    g.fillStyle = css("--panel") || "#161a20"; g.fillRect(0, 0, out.width, hh);
    g.drawImage(c, 0, hh);
    g.fillStyle = css("--text") || "#e6e9ee"; g.font = `${Math.round(13 * k)}px "IBM Plex Mono", monospace`; g.textBaseline = "middle";
    const ct = typeof ctType === "function" ? ctType() : "candles";
    const ctn = ct === "candles" ? "" : " · " + ({hollow: "Hollow", bars: "Bars", line: "Line", area: "Area", ha: "Heikin-Ashi", renko: "Renko", range: "Range", lb: "Line break", pf: "P&F"}[ct] || ct);
    const now = new Date(Date.now() + 19800000).toISOString().replace("T", " ").slice(0, 19);
    g.fillText(`${jShort(cur.s)} · ${tf}${ctn} · ${now} IST`, Math.round(10 * k), hh / 2);
    out.toBlob(b => res(b), "image/png");
  });
}
async function jsSend(id, blob, params){
  const q = new URLSearchParams({id, ...params});
  const r = await fetch("/api/journal/shot/add?" + q, {method: "POST", credentials: "same-origin", headers: {"Content-Type": "image/png"}, body: blob});
  let j = {}; try{ j = await r.json(); }catch(e){}
  if(!r.ok) j.ok = false;
  return j;
}
function jsShotReq(m){                       // the server: a trade opened / closed - a chart of that contract on screen adds its picture
  if(!m || typeof cur === "undefined" || !cur || cur.s !== m.s) return;
  setTimeout(async () => {                   // let the trade's lines draw first
    if(!cur || cur.s !== m.s || !jsChartOn()) return;
    const blob = await jsChartBlob(); if(!blob) return;
    const label = jsTfs().includes(tf) || /^\d{1,4}(m|h|D|W|M)$/.test(tf) ? tf : "Context";
    const j = await jsSend(m.id, blob, {kind: "chart", phase: m.phase, tf: label});
    if(j.ok && !j.dup && j.j){ jnMerge(j.j); JN.stale = true; }
  }, 1500);
}
async function jsSnap(){                      // 📷 on the chart bar: this chart, to the journal trade on this contract
  if(!cur){ toast("Open a contract first"); return; }
  if(!jsChartOn()){ toast("The chart isn't on screen"); return; }
  if(!JN.d){ const j = await japi("/api/journal"); if(j.ok){ JN.d = j.j; JN.loadedAt = Date.now(); } }
  if(!JN.d){ toast("Couldn't load the journal"); return; }
  const now = Date.now() / 1000, mine = JN.d.trades.filter(t => t.s === cur.s && !t.hidden && t.status !== "removed");
  const acct = typeof ACCT !== "undefined" ? ACCT : null;
  const t = mine.find(t => t.status === "open" && t.acct === acct) || mine.find(t => t.status === "open")
    || mine.filter(t => t.closed && now - t.closed < 86400).sort((a, b) => b.closed - a.closed)[0];
  if(!t){ toast("No journal trade on this contract today: a chart picture goes to an open trade, or one closed in the last 24 hours"); return; }
  const blob = await jsChartBlob(); if(!blob){ toast("Couldn't take the chart's picture"); return; }
  const label = jsTfs().includes(tf) || /^\d{1,4}(m|h|D|W|M)$/.test(tf) ? tf : "Context";
  const j = await jsSend(t.id, blob, {kind: "upload", tf: label, name: `${jShort(t.s)}_chart`});
  if(!j.ok){ toast(j.error || "Couldn't add the picture"); return; }
  jnMerge(j.j); JN.stale = true;
  toast(`Chart picture (${label}) added to the journal: ${jShort(t.s)} ${t.side > 0 ? "Buy" : "Sell"}${t.status === "open" ? " (open)" : ""}`);
}

/* ------------------------------------------------------------------ Journal › Settings › Pictures */
async function jsSettings(){
  const grid = document.querySelector("#jnBody .jn-setgrid"); if(!grid) return;
  let box = document.getElementById("jsSet");
  if(!box){ box = document.createElement("div"); box.id = "jsSet"; box.className = "jn-card jn-wide"; grid.prepend(box); }
  box.innerHTML = `<h3>Pictures</h3><p class="muted jn-small">Loading…</p>`;
  const j = await japi("/api/journal/pictures");
  if(!j.ok){ box.innerHTML = `<h3>Pictures</h3><p class="down jn-small">${jEsc(j.error || "Couldn't load")}</p>`; return; }
  JS.info = j;
  const c = j.cfg, tg = j.tg, res = (JN.d && JN.d.draw_res) || [["5", "5m"]];
  const sw = (k, label, hint) => `<label class="jn-sw"><input type="checkbox" data-shot="${k}"${c[k] ? " checked" : ""}><span><b>${label}</b><br><span class="muted jn-small">${hint}</span></span></label>`;
  const last = tg.last || {};
  box.innerHTML = `<h3>Pictures</h3>
    <div class="js-setcols"><div>
      ${sw("auto", "Draw a picture on the server at every entry and exit", "From your own Fyers candles, with the entry, stops, target and exit marked and the net ₹ / R. Works with no page open. One Fyers history request each.")}
      <div class="jn-row"><div><label for="jsRes">Its timeframe</label><select id="jsRes" data-shot="res">${res.map(([v, l]) => `<option value="${v}"${String(c.res) === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label for="jsBars">Candles in it</label><input type="number" id="jsBars" data-shot="bars" min="30" max="400" step="10" class="mono" value="${c.bars}"></div></div>
      ${sw("chart", "Add the open chart's own picture", "When a chart of that contract is on screen (any of your devices) as the trade opens or closes, its picture, with your indicators and drawings, is added too: one per timeframe. 📷 on the chart bar adds one whenever you like.")}
      <p class="muted jn-small">${j.usage.files} picture${j.usage.files === 1 ? "" : "s"} on the server · ${j.usage.mb} MB.${j.queued ? ` ${j.queued} waiting to be drawn or sent.` : ""}</p>
      ${j.pillow ? "" : `<p class="down jn-small">The server can't draw pictures yet: Pillow isn't installed. The update installs it on its own (requirements.txt); if this stays, run the install step on the server.</p>`}
    </div><div>
      <h4>Telegram backup copy</h4>
      ${tg.bot_set ? `<p class="muted jn-small">Bot: <b>@${jEsc(tg.bot || "your bot")}</b> (from Settings › Telegram alerts).</p>`
        : `<p class="warnc jn-small">${j.admin ? "Set up your Telegram bot in Settings › Telegram alerts first; the journal uses the same bot." : "Telegram needs a bot, and only the admin can set one up for now."}</p>`}
      ${sw("tg", "Send a copy of every picture to Telegram", "Each new picture goes to the chat below, silently, with the trade's details. Delete a picture here and its copy goes too.")}
      <div class="jn-row"><div style="flex:2"><label for="jsChat">Journal chat or channel</label><input type="text" id="jsChat" class="mono" placeholder="-1001234567890 or @channel" value="${jEsc(c.tg_chat || "")}"></div></div>
      <div class="jn-pledb"><button id="jsChatSave">Save chat</button>${tg.alerts_chat ? `<button class="ghost" id="jsUseAlerts" title="${jEsc(tg.alerts_title || tg.alerts_chat)}">Use my alerts chat</button>` : ""}<button class="ghost" id="jsTgTest">Send a test</button></div>
      <p class="muted jn-small">Best: a new private channel just for the journal, with your bot added as an admin that can post and delete messages. "Find my chat" in Settings › Telegram alerts lists the chats the bot has seen.</p>
      <p class="jn-small">${last.error ? `<span class="down">Last error: ${jEsc(last.error.msg)}</span>` : last.t ? `<span class="muted">Last copy sent ${jEsc(jWhen(last.t))} (${last.n || 0} so far).</span>` : ""}</p>
      ${c.tg && c.tg_chat && j.unsent ? `<button id="jsTgAll">Send the ${j.unsent} picture${j.unsent === 1 ? "" : "s"} not in Telegram yet</button>` : ""}
      <div class="jn-sst" id="jsSetSt"></div>
    </div></div>`;
  const save = async b => { const r = await japi("/api/journal/settings", {shots: b});
    if(r.ok){ jnMerge(r.j); jToast("Saved"); jsSettings(); } else { jToast(r.error || "Couldn't save"); const st = document.getElementById("jsSetSt"); if(st) st.textContent = r.error || ""; } };
  box.querySelectorAll("[data-shot]").forEach(i => i.onchange = () => save({[i.dataset.shot]: i.type === "checkbox" ? i.checked : i.value}));
  box.querySelector("#jsChatSave").onclick = () => save({tg_chat: box.querySelector("#jsChat").value.trim()});
  const ua = box.querySelector("#jsUseAlerts"); if(ua) ua.onclick = () => { box.querySelector("#jsChat").value = tg.alerts_chat; save({tg_chat: tg.alerts_chat}); };
  box.querySelector("#jsTgTest").onclick = async () => {
    const chat = box.querySelector("#jsChat").value.trim(), st = document.getElementById("jsSetSt");
    st.textContent = "Sending…";
    const r = await japi("/api/journal/pictures/tg", {action: "test", chat});
    st.textContent = r.ok ? "✓ Sent: check the chat" : (r.error || "Couldn't send"); st.className = "jn-sst " + (r.ok ? "up" : "down");
  };
  const all = box.querySelector("#jsTgAll"); if(all) all.onclick = async () => {
    const r = await japi("/api/journal/pictures/tg", {action: "send"});
    jToast(r.ok ? `${r.queued} picture${r.queued === 1 ? "" : "s"} going to Telegram (about one a second)` : (r.error || "Couldn't start it")); jsSettings();
  };
}

/* ------------------------------------------------------------------ hooks */
(function jsHook(){
  const st = jnSettings;
  jnSettings = function(){ st(); jsSettings(); };
  document.addEventListener("DOMContentLoaded", () => {
    if(typeof FTM_CELL !== "undefined" && FTM_CELL != null) return;      // a chart inside a grid: no chart-bar button
    const full = document.getElementById("bFull");
    if(full && !document.getElementById("bSnap")){
      const b = document.createElement("button"); b.className = "ghost fsb"; b.id = "bSnap"; b.textContent = "📷";
      b.title = "Add a picture of this chart to the journal trade on this contract";
      b.onclick = jsSnap; full.before(b);
    }
  });
})();
