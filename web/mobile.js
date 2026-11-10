/* The phone layout, modelled on MT5's mobile app: five tabs at the bottom (Quotes · Chart · Trade · History · More),
   a full-height chart with a one-tap SELL / BUY bar, an order sheet that slides up, and big-button position controls.
   It drives the same trading logic as the desktop page (paper.js / live.js): the ticket, the preview from the server,
   PLACE, modify, BE, trailing, close and the kill switch are the same functions, so every rule and every ₹ figure
   (net of all charges) is identical. Phones get it automatically; More → "Desktop layout" switches back.
   Loaded after the page's own script (it wraps onTick, openSymbol, feedPill, setFull, paperUpdate, renderTicket ...). */
"use strict";
const M = {on: false, ms: "chart", sheet: null, tkKey: "", posId: null, ordId: null, draft: {}, hist: null, histDays: 1,
           histOpen: {}, autoFs: false, closeArm: null, tradeKey: "", min: false};
const mq = s => document.querySelector(s);
const prodName = p => ({INTRADAY: "Intraday", MARGIN: "Carry", CNC: "Delivery"})[p] || p || "";
const mqa = s => [...document.querySelectorAll(s)];
const mPref = () => { try{ return localStorage.getItem("ftm.layout") || ""; }catch(e){ return ""; } };
function mWant(){
  if(window.FTM_CELL != null || window.FTM_REPLAY) return false;   // a chart inside the desktop multi-chart grid, a trade replay
  const p = mPref(); if(p === "desk") return false; if(p === "mob") return true;
  const coarse = matchMedia("(pointer:coarse)").matches;
  return innerWidth <= 760 || (coarse && Math.min(innerWidth, innerHeight) <= 500);
}
const ICON = {
  quotes: '<path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  chart: '<path d="M7 4v3M7 17v3M17 7v3M17 18v2" stroke="currentColor" stroke-width="2"/><rect x="5" y="7" width="4" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="15" y="10" width="4" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="2"/>',
  trade: '<path d="M4 17l5-5 4 4 7-8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 8h5v5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  history: '<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 8v4l3 2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  more: '<circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/>'
};

/* ---------------------------------------------------------------- the shell */
function mBuild(){
  if(mq("#mob")) return;
  const d = document.createElement("div"); d.id = "mob";
  d.innerHTML = `
    <div id="mTop">
      <button id="mBack" class="hide" title="Back">‹ Back</button>
      <button id="mAcct" title="Switch account"><b>–</b><span></span></button>
      <button id="mLive" class="hide" title="This account sends real orders to Fyers">LIVE</button>
      <button id="mSym" title="Quotes"><b>No symbol</b><span></span></button>
      <button id="mKill" class="hide" title="Kill switch">KILL</button>
      <span id="mFeed" title="Prices"></span>
    </div>
    <div id="mWarn"></div>
    <div id="mChips"></div>
    <div id="mBar">
      <button id="mSell"><span>SELL</span><b>–</b></button>
      <button id="mSize" title="Default size and product"></button>
      <button id="mBuy"><span>BUY</span><b>–</b></button>
    </div>
    <div id="mBub"><div class="bw">
      <button class="bx" title="Cancel this trade">✕</button>
      <button class="bi" title="Open the order sheet"><span class="l1"></span><span class="l2"></span></button>
      <button class="bp">PLACE</button>
    </div></div>
    <nav id="mNav">${["quotes", "chart", "trade", "history", "more"].map(k =>
      `<button data-ms="${k}"><svg viewBox="0 0 24 24">${ICON[k]}</svg><span>${k[0].toUpperCase() + k.slice(1)}</span>${k === "trade" ? '<i class="nb hide" id="mNb"></i>' : ""}</button>`).join("")}</nav>
    <div class="mscr" id="ms_quotes"></div>
    <div class="mscr" id="ms_trade"></div>
    <div class="mscr" id="ms_history"></div>
    <div class="mscr" id="ms_more"></div>
    <div id="mSheetBg"></div><div id="mSheet"></div>`;
  document.body.append(d);
  mqa("#mNav button").forEach(b => b.onclick = () => mShow(b.dataset.ms));
  mq("#mSym").onclick = () => mShow("quotes");
  mq("#mAcct").onclick = mAcctSheet;
  mq("#mKill").onclick = () => liveKill();
  mq("#mLive").onclick = () => { mShow("more"); pgShow("account"); };
  mq("#mBack").onclick = () => pgShow("chart");
  mq("#mBuy").onclick = () => mTicket(1);
  mq("#mSell").onclick = () => mTicket(-1);
  mq("#mSize").onclick = mSizeSheet;
  mq("#mSheetBg").onclick = mClose;
  // the order shrunk to a bubble (in the SELL / BUY bar's place, so the whole chart stays in view)
  mq("#mBub .bi").onclick = () => mMin(false);
  mq("#mBub .bx").onclick = () => { disarm(); mClose(); };
  mq("#mBub .bp").onclick = async () => { await place(); if(!P.armed) mClose(); };
  // touching the chart while the order sheet is up shrinks it to the bubble (the drag on the chart carries on)
  document.addEventListener("pointerdown", e => {
    if(M.on && M.sheet === "ticket" && !M.min && e.target.closest && e.target.closest("#chart")) mMin(true);
  }, true);
}
function mApply(){
  const want = mWant();
  if(want === M.on) return;
  M.on = want;
  mBuild();
  const aside = mq("aside"), main = mq("main");
  if(want){
    document.body.classList.add("mob");
    if(aside && aside.parentElement !== mq("#ms_quotes")) mq("#ms_quotes").append(aside);
    mShow(M.ms || "chart");
  } else {
    mClose();
    document.body.classList.remove("mob");
    if(aside && main && aside.parentElement !== main) main.prepend(aside);
    if(typeof PG !== "undefined" && PG.page !== "chart") pgShow(PG.page, true);
  }
  mRefresh();
  setTimeout(() => { if(typeof legendPlace === "function" && chart){ legendPlace(); positionTools(); } }, 100);
}

function mShow(name){
  M.ms = name;
  document.body.dataset.ms = name;
  mqa("#mNav button").forEach(b => b.classList.toggle("on", b.dataset.ms === name));
  if(typeof PG !== "undefined" && PG.page !== "chart") pgShow("chart");
  if(name !== "chart" && document.body.classList.contains("chartfs")) setFull(false);
  if(name === "trade"){ M.tradeKey = ""; mTrade(); }
  if(name === "history") mHistory(true);
  if(name === "more") mMore();
  if(name === "quotes"){ const w = mq('aside .tabs button.on'); if(!w) mq('aside .tabs button[data-tab="watch"]').click(); }
  if(name === "chart") setTimeout(() => { if(chart){ legendPlace(); positionTools(); } }, 60);
  mTopBar();
}

/* ---------------------------------------------------------------- top bar, warnings, one-tap bar, chips */
function mTopBar(){
  if(!M.on) return;
  const pages = typeof PG !== "undefined" && PG.page !== "chart";
  mq("#mBack").classList.toggle("hide", !pages);
  mq("#mAcct").classList.toggle("hide", pages);
  const a = (typeof acctById === "function" ? acctById(ACCT) : null) || (acctList() || []).find(x => x.id === ACCT), sn = P.snap;
  mq("#mAcct b").textContent = a ? a.name : "Account";
  mq("#mAcct span").textContent = sn ? rs(sn.acct.equity) : "";
  const live = typeof liveOn === "function" && liveOn();
  mq("#mLive").classList.toggle("hide", !live);
  mq("#mKill").classList.toggle("hide", !live);
  document.body.classList.toggle("is-live", live);
  if(typeof sideRender === "function") sideRender();
  mSymBar();
  mWarnings();
}
function mSymBar(){
  if(!M.on) return;
  const t = cur && last[cur.s];
  mq("#mSym b").textContent = cur ? symLabel(cur.s) : "No symbol";
  const sp = mq("#mSym span");
  if(t){ const prev = parseFloat(sp.dataset.v); sp.textContent = fmt(t.ltp, cur.tick); sp.className = isNaN(prev) || prev === t.ltp ? "" : prev < t.ltp ? "up" : "down"; sp.dataset.v = t.ltp; }
  else sp.textContent = "";
  mq("#mSell b").textContent = t && (t.bid || t.ltp) ? fmt(t.bid || t.ltp, cur.tick) : "–";
  mq("#mBuy b").textContent = t && (t.ask || t.ltp) ? fmt(t.ask || t.ltp, cur.tick) : "–";
  const T = P.T;
  const size = T.mode === "pct" ? `${T.risk_pct}%` : T.mode === "amt" ? `₹${(+T.risk_amt).toLocaleString("en-IN")}` : `${T.lots} lot${T.lots == 1 ? "" : "s"}`;
  mq("#mSize").innerHTML = `${esc(size)}<small>${T.mode === "lots" ? "" : "risk · "}${prodName(T.product)}</small>`;
}
function mWarnings(){
  const el = mq("#mWarn"); if(!el) return;
  const w = [];
  const f = (typeof S !== "undefined" && S.fyers) || {};
  if(f.configured === false) w.push(`Fyers app not set up · <a href="#" data-w="set">Settings</a>`);
  else if(f.configured && !f.logged_in) w.push(`Not logged in to Fyers today · <a href="#" data-w="login">Log in</a>`);
  if(typeof liveOn === "function" && liveOn()) for(const x of ((P.snap.live || {}).warnings || [])) w.push("⚠ " + esc(x));
  if(typeof mtPhoneWarn === "function"){ const m = mtPhoneWarn(); if(m) w.push(m); }        // an MT5 chart with MT5 off (mt5.js)
  const h = w.map(x => `<div>${x}</div>`).join("");
  if(el.innerHTML !== h) el.innerHTML = h;
  el.querySelectorAll("[data-w]").forEach(a => a.onclick = e => { e.preventDefault(); a.dataset.w === "login" ? fyersLogin() : openDrawer(); });
  // the chart and the screens start below the warning strip
  const base = matchMedia("(orientation:landscape) and (max-height:520px)").matches ? 40 : 48;
  document.body.style.setProperty("--mo", (base + (h ? el.offsetHeight : 0)) + "px");
}
function mChips(){
  const box = mq("#mChips"); if(!box || !P.snap) return;
  const ps = P.snap.positions, os = P.snap.orders;
  const key = ps.map(p => p.id).join(",") + "|" + os.length;
  if(box.dataset.k !== key){
    box.dataset.k = key;
    box.innerHTML = ps.map(p => `<button data-id="${p.id}"><span class="side ${p.side > 0 ? "up" : "down"}">${p.side > 0 ? "L" : "S"}</span> ${esc(short(p.s))} <b data-f="n"></b></button>`).join("")
      + (os.length ? `<button data-o="1">${os.length} order${os.length > 1 ? "s" : ""}</button>` : "");
    box.querySelectorAll("[data-id]").forEach(b => b.onclick = () => mPosSheet(b.dataset.id));
    const o = box.querySelector("[data-o]"); if(o) o.onclick = () => mShow("trade");
  }
  for(const p of ps){ const b = box.querySelector(`[data-id="${p.id}"] [data-f="n"]`); if(b){ b.textContent = rsS(p.net); b.className = cls(p.net); } }
  const n = ps.length + os.length, nb = mq("#mNb");
  if(nb){ nb.textContent = n; nb.classList.toggle("hide", !n); }
}
function mFeed(cls){ const d = mq("#mFeed"); if(d) d.className = cls || ""; }

/* ---------------------------------------------------------------- bottom sheets */
function mOpen(kind, html, opt = {}){
  const was = M.sheet;
  M.sheet = kind; M.min = false; document.body.classList.remove("tkmin");
  if(was === "ticket" && kind !== "ticket" && P.armed) disarm();     // another sheet: the trade being set up is dropped
  const sh = mq("#mSheet"), bg = mq("#mSheetBg");
  sh.className = "open " + (opt.cls || "");
  bg.className = "open " + (opt.cls || "");
  sh.innerHTML = `<div class="sgrip"></div>` + html;
  sh.scrollTop = 0;
  const g = sh.querySelector(".sgrip"); if(g) g.onclick = () => { if(M.sheet === "ticket") mMin(true); else mClose(); };
  const x = sh.querySelector("[data-x]"); if(x) x.onclick = () => { if(M.sheet === "ticket") disarm(); mClose(); };
  return sh;
}
function mClose(){
  const sh = mq("#mSheet"); if(!sh) return;
  const was = M.sheet;
  M.sheet = null; M.posId = M.ordId = null; M.tkKey = ""; M.draft = {}; M.closeArm = null; M.min = false;
  sh.className = ""; mq("#mSheetBg").className = ""; document.body.classList.remove("tkmin");
  if(was === "ticket" && P.armed) disarm();
}
// a +/- price box: the input, and buttons that move it by one tick
function mStep(id, val, ph){
  return `<div class="step"><button data-st="${id}" data-d="-1">−</button><input id="${id}" class="mono" inputmode="decimal" value="${val ?? ""}" placeholder="${ph || ""}" autocomplete="off"><button data-st="${id}" data-d="1">+</button></div>`;
}
function mWireSteps(root, onStep){
  root.querySelectorAll("[data-st]").forEach(b => {
    let rep = null, t0 = null;
    const go = () => onStep(b.dataset.st, +b.dataset.d);
    const stop = () => { clearTimeout(t0); clearInterval(rep); t0 = rep = null; };
    b.addEventListener("pointerdown", e => { e.preventDefault(); go(); t0 = setTimeout(() => { rep = setInterval(go, 90); }, 450); });   // hold to repeat
    for(const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, stop);
  });
}
const setv = (el, v) => { if(el && document.activeElement !== el) el.value = v ?? ""; };
// set a desktop ticket box and fire its own handler, so the phone and the desktop ticket can never disagree
function mDesk(id, v){ const el = mq(id); if(!el) return; el.value = v ?? ""; el.dispatchEvent(new Event("change")); }

/* ---------------------------------------------------------------- the order sheet (drives paper.js' ticket) */
function mTicket(side){
  if(!cur){ toast("Open a contract first (Quotes)"); mShow("quotes"); return; }
  if(P.T.s !== cur.s && sym[cur.s]) paperOnSymbol(sym[cur.s]);
  if(!P.armed || P.T.side !== side) arm(side);         // (arm() on the side that's already on would switch it off)
  if(!P.armed) return;
  M.tkKey = "";
  const keepMin = M.sheet === "ticket" && M.min;
  mOpen("ticket", `<div id="mTk"></div>`, {cls: "ticket"});
  mTicketFill();
  if(keepMin || prefGet("mobTicket", "full") === "bubble") mMin(true);
}
// shrink the order sheet to the bubble (on) or bring it back (off). Nothing about the trade changes either way.
function mMin(on){
  if(M.sheet !== "ticket") return;
  const sh = mq("#mSheet");
  if(on){ const a = document.activeElement; if(a && sh.contains(a)) a.blur(); }   // a half-typed price is applied first
  M.min = !!on;
  sh.classList.toggle("min", M.min);
  document.body.classList.toggle("tkmin", M.min);
  mBubFill();
}
function mBubFill(){
  if(M.sheet !== "ticket" || !M.min) return;
  const b = mq("#mBub"); if(!b) return;
  const p = P.plan, T = P.T, live = typeof liveOn === "function" && liveOn(), buy = T.side > 0;
  const est = p && p.risk_estimated ? "≈" : "";
  const r0 = n => (n < 0 ? "−₹" : "₹") + Math.round(Math.abs(n)).toLocaleString("en-IN");   // whole ₹, like the chart's zone labels
  const side = `<b class="${buy ? "up" : "down"}">${buy ? "BUY" : "SELL"}</b>`;
  const l1 = p ? `${side} ${p.lots || 0} lot${p.lots === 1 ? "" : "s"} · ${p.type === "market" ? "market" : esc(p.type) + " " + fmt(p.entry, p.tick)} · ${esc(prodName(T.product))}`
    : `${side} ${esc(short(T.s))}`;
  const l2 = !p ? `<span class="${P.pvErr && !/^waiting/.test(P.pvErr) ? "down" : "muted"}">${esc(P.pvErr || "Working out size and costs…")}</span>`
    : p.blocked ? `<span class="down">${esc(p.blocked)}</span>`
    : !p.lots ? `<span class="down">1 lot risks ${r0(p.risk_1lot)}: more than your size allows</span>`
    : `<span class="down">SL ${p.risk != null ? est + r0(-p.risk) : "none"}</span> · <span class="up">TP ${p.reward != null ? est + r0(p.reward) + (p.rr != null ? " · " + p.rr + "R" : "") : "none"}</span>`;
  const f1 = b.querySelector(".l1"), f2 = b.querySelector(".l2");
  if(f1.innerHTML !== l1) f1.innerHTML = l1;
  if(f2.innerHTML !== l2) f2.innerHTML = l2;
  b.querySelector(".bw").className = "bw " + (buy ? "buy" : "sell") + (live ? " live" : "");
  const bp = b.querySelector(".bp");
  bp.disabled = !p || !!p.blocked || !p.lots || P.placing;
  bp.className = "bp " + (buy ? "buy" : "sell") + (live ? " live" : "");
  bp.textContent = live ? "LIVE · PLACE" : "PLACE";
  bp.title = p ? (live ? "LIVE · " : "") + placeLabel(p) : "Place";
}
function mTkStruct(){
  const row = tkRow() || {}, T = P.T, pe = mq("#tkProd");
  return [T.s, T.side, orderType(), T.mode, T.basis, row.f, pe ? pe.dataset.k : ""].join("|");
}
function mTicketBuild(){
  const box = mq("#mTk"); if(!box) return;
  const row = tkRow() || {}, T = P.T, typ = orderType(), opt = row.f === "OPT";
  const prods = [...(mq("#tkProd") || {options: []}).options].map(o => [o.value, o.textContent]);
  box.innerHTML = `
    <div class="shead"><b>${esc(short(T.s))}</b><span class="muted sm">lot ${row.lot || "–"}${row.mult > 1 ? " × " + row.mult : ""} · tick ${row.tick || "–"}</span><button data-min title="Shrink to a bubble and see the whole chart"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button data-x title="Cancel">✕</button></div>
    <div class="sides2"><button class="sell ${T.side < 0 ? "on" : ""}" data-side="-1">SELL <span class="mono" data-f="bid"></span></button><button class="buy ${T.side > 0 ? "on" : ""}" data-side="1">BUY <span class="mono" data-f="ask"></span></button></div>
    <div class="sbody">
      <div class="mseg" data-g="type">${[["market", "Market"], ["limit", "Limit"], ["stop", "Stop"]].map(([v, n]) => `<button data-v="${v}" class="${typ === v ? "on" : ""}">${n}</button>`).join("")}</div>
      ${typ === "market" ? "" : `<div class="mrow"><span>${typ === "limit" ? "Limit" : "Stop"} price</span>${mStep("mtPrice", T.price)}</div>`}
      ${opt ? `<div class="mrow"><span>SL / target follow</span><div class="mseg" data-g="basis" style="margin:0"><button data-v="self" class="${T.basis === "self" ? "on" : ""}">This option</button><button data-v="underlying" class="${T.basis === "underlying" ? "on" : ""}">The future</button></div></div>` : ""}
      <div class="mrow"><span>Stop loss<i class="down" data-f="atsl"></i></span>${mStep("mtSl", "", T.basis === "underlying" ? "future price" : "price")}</div>
      <div class="mrow"><span>Target<i class="up" data-f="attp"></i></span><div class="step r lkr"><button data-st="mtTp" data-d="-1">−</button><input id="mtTp" class="mono" inputmode="decimal" autocomplete="off" placeholder="${T.basis === "underlying" ? "future price" : "price"}"><button data-st="mtTp" data-d="1">+</button><input id="mtTpR" class="mono" inputmode="decimal" placeholder="R" title="Target as a multiple of the risk" ${T.basis === "underlying" ? "disabled" : ""}><button id="mtLock" class="lk" type="button" title="RR lock"></button></div></div>
      <div class="mrow"><span>Size</span><div class="mseg" data-g="mode" style="margin:0">${[["pct", "Risk %"], ["amt", "Risk ₹"], ["lots", "Lots"]].map(([v, n]) => `<button data-v="${v}" class="${T.mode === v ? "on" : ""}">${n}</button>`).join("")}</div></div>
      <div class="mrow"><span data-f="unit"></span>${mStep("mtSize", "")}</div>
      <div class="mrow"><span>Product</span><div class="mseg" data-g="prod" style="margin:0">${prods.map(([v, n]) => `<button data-v="${v}">${esc(n.replace(/ \(.*\)/, ""))}</button>`).join("")}</div></div>
      <div class="mpv" id="mtPv"></div>
      <p class="help" style="margin:4px 0 8px">Drag the SL and target lines on the chart too: touching the chart (or ⌄, or a swipe down) shrinks this to a bubble at the bottom, with the net ₹ and PLACE. Tap the bubble to bring the sheet back.</p>
    </div>
    <button class="mplace" id="mtPlace" disabled>Place</button>`;
  box.querySelector("[data-x]").onclick = () => { disarm(); mClose(); };
  box.querySelector("[data-min]").onclick = () => mMin(true);
  mSwipeDown(mq("#mSheet .sgrip")); mSwipeDown(box.querySelector(".shead"));
  box.querySelectorAll("[data-side]").forEach(b => b.onclick = () => { const s = +b.dataset.side; if(P.T.side !== s) arm(s); });
  box.querySelectorAll('[data-g="type"] button').forEach(b => b.onclick = () => { const d = mq(`#tkType button[data-v="${b.dataset.v}"]`); d && d.click(); });
  box.querySelectorAll('[data-g="basis"] button').forEach(b => b.onclick = () => { const d = mq(`#tkBasis button[data-v="${b.dataset.v}"]`); d && d.click(); });
  box.querySelectorAll('[data-g="mode"] button').forEach(b => b.onclick = () => { const d = mq(`#tkMode button[data-v="${b.dataset.v}"]`); d && d.click(); });
  box.querySelectorAll('[data-g="prod"] button').forEach(b => b.onclick = () => { mDesk("#tkProd", b.dataset.v); mTicketFill(); mSymBar(); });
  const chg = (id, desk) => { const el = mq(id); if(!el) return; el.addEventListener("change", () => mDesk(desk, el.value)); el.addEventListener("keydown", e => { if(e.key === "Enter"){ el.blur(); } }); };
  chg("#mtPrice", "#tkPrice"); chg("#mtSl", "#tkSl"); chg("#mtTp", "#tkTp"); chg("#mtTpR", "#tkTpR"); chg("#mtSize", "#tkSize");
  const lk = mq("#mtLock"); if(lk){ lk.onclick = () => rrLockToggle(); renderLock(); }
  mWireSteps(box, (id, d) => {
    const T = P.T;
    if(id === "mtPrice"){ const tk = tickOf(T.s), b = T.price ?? ltpOf(T.s); if(b == null) return; T.follow = false; T.price = roundTick(b + d * tk, tk); renderTicket(); toolRedraw(); preview(); return; }
    if(id === "mtSl"){ const tk = tickOf(basisSym()), v = slNow(); if(v == null) return; mDesk("#tkSl", roundTick(v + d * tk, tk)); return; }
    if(id === "mtTp"){ const tk = tickOf(basisSym()), v = tpNow(); if(v == null) return; mDesk("#tkTp", roundTick(v + d * tk, tk)); return; }
    if(id === "mtSize"){ const v = T.mode === "pct" ? Math.max(0.05, +(T.risk_pct + d * (T.risk_pct < 1 || (T.risk_pct === 1 && d < 0) ? 0.1 : 0.25)).toFixed(2))
        : T.mode === "amt" ? Math.max(10, Math.round(T.risk_amt + d * (T.risk_amt < 500 ? 25 : 100))) : Math.max(1, Math.round(T.lots + d));
      mDesk("#tkSize", v); mSymBar(); }
  });
  box.querySelector("#mtPlace").onclick = async () => { await place(); if(!P.armed) mClose(); };
}
// a swipe down on the sheet's grip or header shrinks the order to the bubble
function mSwipeDown(el){
  if(!el || el.dataset.sw) return; el.dataset.sw = "1";
  let y0 = null;
  el.addEventListener("pointerdown", e => { if(!e.target.closest("button,input")) y0 = e.clientY; });
  el.addEventListener("pointermove", e => { if(y0 != null && e.clientY - y0 > 36){ y0 = null; mMin(true); } });
  for(const ev of ["pointerup", "pointercancel", "pointerleave"]) el.addEventListener(ev, () => { y0 = null; });
}
function mTicketFill(){
  if(M.sheet !== "ticket") return;
  if(!P.armed){ mClose(); return; }
  const k = mTkStruct();
  if(k !== M.tkKey){ M.tkKey = k; mTicketBuild(); }
  const box = mq("#mTk"); if(!box) return;
  const T = P.T, t = last[T.s], tk = tickOf(T.s);
  const f = n => box.querySelector(`[data-f="${n}"]`);
  f("bid").textContent = t ? fmt(t.bid || t.ltp, tk) : ""; f("ask").textContent = t ? fmt(t.ask || t.ltp, tk) : "";
  setv(mq("#mtPrice"), T.follow ? "" : T.price);
  setv(mq("#mtSl"), slNow()); setv(mq("#mtTp"), tpNow());
  setv(mq("#mtTpR"), T.tpMode === "r" ? T.tp_r : "");
  setv(mq("#mtSize"), T.mode === "pct" ? T.risk_pct : T.mode === "amt" ? T.risk_amt : T.lots);
  f("unit").textContent = T.mode === "pct" ? "% of balance" : T.mode === "amt" ? "₹ at risk (net)" : "Lots";
  const want = (mq("#tkProd") || {}).value;
  box.querySelectorAll('[data-g="prod"] button').forEach(b => b.classList.toggle("on", b.dataset.v === want));
  mPlanFill();
}
function mPlanFill(){
  if(M.sheet !== "ticket") return;
  const el = mq("#mtPv"), btn = mq("#mtPlace"); if(!el || !btn) return;
  const p = P.plan, live = typeof liveOn === "function" && liveOn();
  const box = mq("#mTk"), f = n => box && box.querySelector(`[data-f="${n}"]`);
  if(!p){
    el.innerHTML = P.pvErr ? `<span class="note ${/^waiting/.test(P.pvErr) ? "" : "down"}">${esc(P.pvErr)}</span>` : `<span class="note">Working out size and costs…</span>`;
    btn.disabled = true; btn.textContent = "Place"; btn.className = "mplace " + (P.T.side > 0 ? "buy" : "sell") + (live ? " live" : "");
    if(f("atsl")) f("atsl").textContent = ""; if(f("attp")) f("attp").textContent = "";
    mBubFill();
    return;
  }
  const est = p.risk_estimated ? "≈ " : "";
  if(f("atsl")) f("atsl").textContent = p.risk != null ? est + rs(-p.risk) : "";
  if(f("attp")) f("attp").textContent = p.reward != null ? est + rs(p.reward) + (p.rr != null ? ` · ${p.rr}R` : "") : "";
  const rows = [
    ["Lots", `<b>${p.lots}</b> <span class="muted">(${p.qty} qty)</span>`],
    ["Entry", `${fmt(p.entry, p.tick)} <span class="muted">${p.type === "market" ? "at the " + (p.side > 0 ? "ask" : "bid") : p.type}</span>`],
    ["At stop (net)", p.risk != null ? `<b class="down">${est}${rs(-p.risk)}</b>` : p.risk_1lot != null ? `<span class="down">1 lot: ${est}${rs(-p.risk_1lot)}</span>` : "no stop"],
    ["At target (net)", p.reward != null ? `<b class="up">${est}${rs(p.reward)}</b>${p.rr != null ? ` <span class="muted">${p.rr}R</span>` : ""}` : "–"],
    ["BE + costs", p.be != null ? fmt(p.be, p.tick) : "–"],
    ["Charges in + out", p.risk_detail ? `${rs(p.risk_detail.entry_charges)} + ${rs(p.risk_detail.exit_charges)}` : p.entry_charges ? rs(p.entry_charges.total) + " entry" : "–"],
    ["Margin", p.margin ? rs(p.margin) : '<span class="muted">not checked</span>'],
  ];
  if(p.ref) rows.splice(2, 0, ["Underlying", `${esc(short(p.ref))} ${fmt(p.ref_price)} · Δ ${p.delta}`]);
  // why it can't be placed comes first: on a phone the end of the list is under the PLACE button
  el.innerHTML = (p.blocked ? `<span class="note down" style="margin-bottom:4px">${esc(p.blocked)}</span>` : "")
    + (p.notes && p.notes.length && !p.blocked ? `<span class="note" style="margin-bottom:4px">${p.notes.map(esc).join(" · ")}</span>` : "")
    + rows.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join("")
    + (!p.blocked && !p.lots && p.risk_1lot != null ? `<span class="note down">1 lot would risk ${rs(p.risk_1lot)} after charges, more than your size allows${P.T.mode === "pct" ? ` (${P.T.risk_pct}% = ${rs(P.snap ? P.snap.acct.balance * P.T.risk_pct / 100 : null)})` : P.T.mode === "amt" ? ` (${rs(P.T.risk_amt)})` : ""}. Tighten the stop, raise the risk, or size by Lots.</span>` : "");
  btn.disabled = !!p.blocked || !p.lots || P.placing;
  btn.className = "mplace " + (p.side > 0 ? "buy" : "sell") + (live ? " live" : "");
  btn.textContent = (live ? "LIVE · " : "") + placeLabel(p);
  mBubFill();
}

/* default size and product (the middle of the one-tap bar) */
function mSizeSheet(){
  const T = P.T;
  const sh = mOpen("size", `<div class="shead"><b>Size and product</b><button data-x>✕</button></div>
    <div class="mseg" data-g="mode">${[["pct", "Risk %"], ["amt", "Risk ₹"], ["lots", "Lots"]].map(([v, n]) => `<button data-v="${v}">${n}</button>`).join("")}</div>
    <div class="mrow"><span data-f="unit"></span>${mStep("msSize", "")}</div>
    <div class="mseg" data-g="prod"><button data-v="INTRADAY">Intraday</button><button data-v="CARRY">Carry / Delivery</button></div>
    <p class="help">Used by every new trade (saved on the server). Risk % and Risk ₹ size the trade from the stop, net of all charges.</p>
    <div class="mh">SELL / BUY opens</div>
    <div class="mseg" data-g="open"><button data-v="full">The order sheet</button><button data-v="bubble">A bubble (whole chart)</button></div>
    <p class="help">A bubble: the trade is set up on the chart with your defaults, and the bubble in the bar shows the net ₹ at the stop and target, with PLACE. Tap it for the full sheet.</p>`);
  const fill = () => {
    sh.querySelectorAll('[data-g="mode"] button').forEach(b => b.classList.toggle("on", b.dataset.v === T.mode));
    sh.querySelectorAll('[data-g="prod"] button').forEach(b => b.classList.toggle("on", (b.dataset.v === "INTRADAY") === (T.product === "INTRADAY")));
    sh.querySelectorAll('[data-g="open"] button').forEach(b => b.classList.toggle("on", b.dataset.v === prefGet("mobTicket", "full")));
    sh.querySelector('[data-f="unit"]').textContent = T.mode === "pct" ? "% of balance" : T.mode === "amt" ? "₹ at risk" : "Lots";
    setv(sh.querySelector("#msSize"), T.mode === "pct" ? T.risk_pct : T.mode === "amt" ? T.risk_amt : T.lots);
    mSymBar();
  };
  const set = v => { v = num(v); if(v == null || v <= 0) return; if(T.mode === "pct") T.risk_pct = v; else if(T.mode === "amt") T.risk_amt = v; else T.lots = Math.max(1, Math.round(v));
    saveTicketDefaults(); if(P.armed){ renderTicket(); preview(); } fill(); };
  sh.querySelectorAll('[data-g="mode"] button').forEach(b => b.onclick = () => { T.mode = b.dataset.v; saveTicketDefaults(); if(P.armed){ renderTicket(); preview(); } fill(); });
  sh.querySelectorAll('[data-g="prod"] button').forEach(b => b.onclick = () => {
    const row = cur && sym[cur.s], stock = row && (row.f === "EQ" || row.f === "OTHER");
    T.product = b.dataset.v === "INTRADAY" ? "INTRADAY" : stock ? "CNC" : "MARGIN"; saveTicketDefaults(); if(P.armed){ renderTicket(); preview(); } fill(); });
  sh.querySelectorAll('[data-g="open"] button').forEach(b => b.onclick = () => { prefSet("mobTicket", b.dataset.v); fill(); });
  const inp = sh.querySelector("#msSize"); inp.onchange = () => set(inp.value);
  mWireSteps(sh, (id, d) => set(T.mode === "pct" ? Math.max(0.05, +(T.risk_pct + d * (T.risk_pct < 1 || (T.risk_pct === 1 && d < 0) ? 0.1 : 0.25)).toFixed(2))
    : T.mode === "amt" ? Math.max(10, Math.round(T.risk_amt + d * (T.risk_amt < 500 ? 25 : 100))) : T.lots + d));
  fill();
}

/* ---------------------------------------------------------------- a position */
function mPos(id){ return P.snap && P.snap.positions.find(p => p.id === id); }
function mPosSheet(id){
  const p = mPos(id); if(!p) return;
  M.posId = id; M.draft = {}; M.closeArm = null;
  const tr = p.tr || {};
  mOpen("pos", `
    <div class="shead"><span class="side ${p.side > 0 ? "up" : "down"}">${p.side > 0 ? "LONG" : "SHORT"}</span><b>${esc(short(p.s))}</b><button data-x>✕</button></div>
    <div class="mgrid">
      <div><span>Net P&L (after all charges)</span><b data-f="net" style="font-size:20px"></b></div>
      <div><span>R now</span><b data-f="r"></b></div>
      <div><span>Lots · product</span><b>${p.lots} · ${esc(prodName(p.product))}</b></div>
      <div><span>Entry</span><b>${fmt(p.avg, p.tick)}</b></div>
      <div><span>LTP</span><b data-f="ltp"></b></div>
      <div><span>BE + costs</span><b data-f="be"></b></div>
      <div><span>Charges paid</span><b data-f="paid"></b></div>
      <div><span>Opened</span><b>${istTime(p.opened)}</b></div>
    </div>
    ${p.basis === "underlying" ? `<p class="help">SL and target are prices of ${esc(short(p.ref))}.</p>` : ""}
    <div class="fy" data-f="fy" style="margin-top:6px;font-size:12.5px"></div>
    <div class="mrow"><span>Stop loss<i data-f="atsl"></i></span>${mStep("mpSl", "", "none")}</div>
    <div class="mrow"><span>Target<i data-f="attp"></i></span>${mStep("mpTp", "", "none")}</div>
    <div class="mbtns" style="margin-top:4px"><button id="mpSave" class="primary" disabled>Save SL / target</button><button id="mpUndo" disabled>Undo</button></div>
    <div class="mh">Trailing for this trade</div>
    <div class="mtog"><span>BE-T: stop to BE + costs at</span><input id="mpBeR" inputmode="decimal" value="${tr.be_r ?? 1}"><button id="mpBe" data-t="be_on">${tr.be_on ? "ON" : "off"}</button></div>
    <div class="mtog"><span>TRAIL: trail the stop from</span><input id="mpSlR" inputmode="decimal" value="${tr.sl_r ?? 1}"><button id="mpTr" data-t="sl_on">${tr.sl_on ? "ON" : "off"}</button></div>
    <p class="help" data-f="trwho" style="margin:2px 0 6px"></p>
    <div class="mbtns hide" data-f="mystop"><button id="mpMyStop" class="nsl" style="min-height:46px">NO STOP · Place my stop</button></div>
    <div class="mbtns"><button id="mpBeNow">BE now</button><button id="mpChart">Chart</button></div>
    <div class="mbtns"><button id="mpClose" class="danger" style="min-height:52px;font-weight:700">Close at market</button></div>`);
  const sh = mq("#mSheet");
  const tick = () => { const q = mPos(id); return q ? (q.basis === "underlying" ? tickOf(q.ref) : q.tick) : 0.05; };
  const dirty = () => { const q = mPos(id); if(!q) return; const d = ("sl" in M.draft && M.draft.sl !== q.sl) || ("tp" in M.draft && M.draft.tp !== q.tp);
    sh.querySelector("#mpSave").disabled = !d; sh.querySelector("#mpUndo").disabled = !d; };
  const fromInp = (k, el) => { const v = el.value.trim(); M.draft[k] = v === "" ? null : roundTick(num(v), tick()); dirty(); };
  sh.querySelector("#mpSl").onchange = e => fromInp("sl", e.target);
  sh.querySelector("#mpTp").onchange = e => fromInp("tp", e.target);
  mWireSteps(sh, (inId, d) => {
    const q = mPos(id); if(!q) return; const k = inId === "mpSl" ? "sl" : "tp";
    const base = k in M.draft ? M.draft[k] : q[k];
    const ref = base != null ? base : (q.basis === "underlying" ? q.ref_ltp : q.ltp);
    if(ref == null) return;
    M.draft[k] = roundTick(ref + d * tick(), tick());
    const el = sh.querySelector("#" + inId); el.value = M.draft[k]; dirty();
  });
  sh.querySelector("#mpSave").onclick = async () => {
    const body = {id}; for(const k of ["sl", "tp"]) if(k in M.draft) body[k] = M.draft[k];
    const j = await papi("modify", body);
    if(j.ok){ M.draft = {}; toast("Saved"); } mPosFill(true);
  };
  sh.querySelector("#mpUndo").onclick = () => { M.draft = {}; mPosFill(true); };
  for(const [b, inp, rk] of [["#mpBe", "#mpBeR", "be_r"], ["#mpTr", "#mpSlR", "sl_r"]]){
    sh.querySelector(b).onclick = () => { const q = mPos(id); if(!q) return; const k = sh.querySelector(b).dataset.t;
      papi("pos_trail", {id, [k]: !(q.tr || {})[k], [rk]: num(sh.querySelector(inp).value) || (q.tr || {})[rk] || 1}); };
    sh.querySelector(inp).onchange = () => { const v = num(sh.querySelector(inp).value); if(v > 0) papi("pos_trail", {id, [rk]: v}); };
  }
  sh.querySelector("#mpBeNow").onclick = () => papi("be", {id});
  sh.querySelector("#mpMyStop").onclick = () => { if(typeof placeMyStop === "function") placeMyStop(id); };
  sh.querySelector("#mpChart").onclick = () => { const q = mPos(id); if(!q) return; const s = q.basis === "underlying" ? q.ref : q.s; mClose(); mShow("chart");
    if(!cur || cur.s !== s){ const r = sym[s]; if(r) openSymbol(r); else openBySymbol(s); } };
  sh.querySelector("#mpClose").onclick = async e => {
    const b = e.currentTarget;
    if(M.closeArm !== id){ M.closeArm = id; b.textContent = "Tap again to close"; setTimeout(() => { if(M.closeArm === id && b.isConnected){ M.closeArm = null; b.textContent = "Close at market"; } }, 3000); return; }
    M.closeArm = null; b.disabled = true; b.textContent = "Closing…";
    const j = await papi("close", {id}); if(j.ok) mClose(); else { b.disabled = false; b.textContent = "Close at market"; }
  };
  mPosFill(true);
}
function mPosFill(force){
  if(M.sheet !== "pos") return;
  const p = mPos(M.posId), sh = mq("#mSheet");
  if(!p){ toast("Position closed"); mClose(); return; }
  const f = n => sh.querySelector(`[data-f="${n}"]`), e = p.est ? "≈" : "";
  f("net").textContent = rs(p.net); f("net").className = cls(p.net);
  f("r").textContent = p.r_now != null ? (p.r_now > 0 ? "+" : "") + p.r_now + "R" : "–"; f("r").className = cls(p.r_now);
  f("ltp").textContent = fmt(p.ltp, p.tick) + (p.ref_ltp ? ` · fut ${fmt(p.ref_ltp)}` : "") + (p.stale ? " ⚠" : "");
  f("be").textContent = fmt(p.be, p.tick); f("paid").textContent = rs(p.paid);
  f("atsl").textContent = p.at_sl != null ? e + rsS(p.at_sl) + (p.at_be ? " · at BE" : p.trail ? " · trailing" : "") : ""; f("atsl").className = cls(p.at_sl);
  f("attp").textContent = p.at_tp != null ? e + rsS(p.at_tp) : ""; f("attp").className = cls(p.at_tp);
  const fy = f("fy");
  if(typeof liveOn === "function" && liveOn()){ const s = fyStopText(p); fy.textContent = s.t; fy.className = "fy " + s.c; } else fy.textContent = "";
  const ms = sh.querySelector('[data-f="mystop"]');
  if(ms){ const on = !!(p.nostop && typeof liveOn === "function" && liveOn()); ms.classList.toggle("hide", !on);
    if(on && typeof myStopTitle === "function") sh.querySelector("#mpMyStop").title = myStopTitle(p); }
  const sl = sh.querySelector("#mpSl"), tp = sh.querySelector("#mpTp");
  if(force || !("sl" in M.draft)) setv(sl, "sl" in M.draft ? M.draft.sl : p.sl);
  if(force || !("tp" in M.draft)) setv(tp, "tp" in M.draft ? M.draft.tp : p.tp);
  if(!("sl" in M.draft) && !("tp" in M.draft)){ sh.querySelector("#mpSave").disabled = true; sh.querySelector("#mpUndo").disabled = true; }
  const tr = p.tr || {}, ts = trailTips(p);
  for(const [b, on, inp, r] of [["#mpBe", tr.be_on, "#mpBeR", tr.be_r], ["#mpTr", tr.sl_on, "#mpSlR", tr.sl_r]]){
    const el = sh.querySelector(b), done = b === "#mpBe" && ts.beDone;
    el.textContent = done ? "done" : on ? "ON" : "off"; el.classList.toggle("on", !!on); el.classList.toggle("done", done);
    el.title = b === "#mpBe" ? ts.be : ts.sl; setv(sh.querySelector(inp), r ?? 1);
  }
  const who = sh.querySelector('[data-f="trwho"]');
  if(who) who.textContent = (tr.own_be || tr.own_sl ? `Set on this trade: ${[tr.own_be && "BE-T", tr.own_sl && "TRAIL"].filter(Boolean).join(" and ")}. ` : "As the panel. ")
    + "Typing an R switches it on; changing the panel's Trail BE / Trail SL sets every trade again.";
}

/* ---------------------------------------------------------------- a pending order */
function mOrd(id){ return P.snap && P.snap.orders.find(o => o.id === id); }
function mOrdSheet(id){
  const o = mOrd(id); if(!o) return;
  M.ordId = id; M.draft = {};
  mOpen("ord", `
    <div class="shead"><span class="side ${o.side > 0 ? "up" : "down"}">${o.side > 0 ? "BUY" : "SELL"} ${esc(o.type.toUpperCase())}</span><b>${esc(short(o.s))}</b><button data-x>✕</button></div>
    <p class="help">${o.lots} lot · ${esc(prodName(o.product))}${o.basis === "underlying" ? ` · SL / target on ${esc(short(o.ref))}` : ""} · LTP <span data-f="ltp" class="mono"></span></p>
    <div class="fy muted" data-f="fy" style="font-size:12.5px"></div>
    <div class="mrow"><span>${o.type === "limit" ? "Limit" : "Stop"} price</span>${mStep("moPx", o.price)}</div>
    <div class="mrow"><span>Stop loss<i class="down" data-f="atsl"></i></span>${mStep("moSl", o.sl, "none")}</div>
    <div class="mrow"><span>Target<i class="up" data-f="attp"></i></span>${mStep("moTp", o.tp, "none")}</div>
    <p class="help">Moving the price moves the SL and target with it, unless you change them too.</p>
    <div class="mbtns"><button id="moSave" class="primary" disabled>Save changes</button></div>
    <div class="mbtns"><button id="moCancel" class="danger" style="min-height:52px;font-weight:700">Cancel order</button></div>`);
  const sh = mq("#mSheet");
  const tk = k => { const q = mOrd(id); return !q ? 0.05 : (k !== "price" && q.basis === "underlying") ? tickOf(q.ref) : tickOf(q.s); };
  const map = {moPx: "price", moSl: "sl", moTp: "tp"};
  const dirty = () => { sh.querySelector("#moSave").disabled = !Object.keys(M.draft).length; };
  for(const [inId, k] of Object.entries(map)) sh.querySelector("#" + inId).onchange = e => { const v = e.target.value.trim(); M.draft[k] = v === "" ? null : roundTick(num(v), tk(k)); dirty(); };
  mWireSteps(sh, (inId, d) => {
    const q = mOrd(id); if(!q) return; const k = map[inId];
    const base = k in M.draft ? M.draft[k] : q[k], ref = base != null ? base : q.price;
    M.draft[k] = roundTick(ref + d * tk(k), tk(k)); sh.querySelector("#" + inId).value = M.draft[k]; dirty();
  });
  sh.querySelector("#moSave").onclick = async () => {
    if(M.draft.price === null){ toast("An order needs a price"); return; }
    const j = await papi("modify", {id, ...M.draft}); if(j.ok){ M.draft = {}; toast("Saved"); } mOrdFill(true);
  };
  sh.querySelector("#moCancel").onclick = async () => { const j = await papi("cancel", {id}); if(j.ok) mClose(); };
  mOrdFill(true);
}
function mOrdFill(force){
  if(M.sheet !== "ord") return;
  const o = mOrd(M.ordId), sh = mq("#mSheet");
  if(!o){ toast("The order is no longer pending"); mClose(); return; }
  const f = n => sh.querySelector(`[data-f="${n}"]`);
  const t = last[o.s]; f("ltp").textContent = t ? fmt(t.ltp, tickOf(o.s)) : "–";
  f("atsl").textContent = o.at_sl != null ? rsS(o.at_sl) : ""; f("attp").textContent = o.at_tp != null ? rsS(o.at_tp) : "";
  const fy = o.fy || {};
  f("fy").textContent = typeof liveOn === "function" && liveOn() ? (fy.cancel_req ? "cancelling at Fyers…" : fy.oid ? `at Fyers #${fy.oid}` + (fy.filled ? ` · ${fy.filled} filled` : "") : fy.state === "unsure" ? "Fyers didn't confirm - checking" : "sending to Fyers…") : "";
  for(const [inId, k] of [["moPx", "price"], ["moSl", "sl"], ["moTp", "tp"]]) if(force || !(k in M.draft)) setv(sh.querySelector("#" + inId), k in M.draft ? M.draft[k] : o[k]);
  if(force && !Object.keys(M.draft).length) sh.querySelector("#moSave").disabled = true;
}

/* ---------------------------------------------------------------- account switcher */
function mAcctSheet(){
  const list = acctList(), rsx = n => n == null ? "" : "₹" + Math.round(n).toLocaleString("en-IN");
  if(typeof sideLive === "function" && sideLive()){           // the Live side: the Fyers account only (v0.33.0)
    const a = acctById(ACCT) || {name: (S.live || {}).name};
    const sh = mOpen("acct", `<div class="shead"><b>Your Fyers account</b><button data-x>✕</button></div>
      <div class="mlist"><button disabled style="border-color:var(--down)"><span><b class="down">● LIVE</b> ${esc(a.name || "")}<br><small>balance ${rsx(a.balance)} · ${a.open || 0} open</small></span>✓</button>
        <button data-p="1"><span>Back to Paper (your paper accounts)</span>›</button></div>`);
    sh.querySelector("[data-p]").onclick = () => { mClose(); sideSet("paper"); setTimeout(mRefresh, 800); };
    return;
  }
  const sh = mOpen("acct", `<div class="shead"><b>Accounts</b><button data-x>✕</button></div>
    <div class="mlist">${list.map(a => `<button data-id="${a.id}" ${a.id === ACCT ? 'style="border-color:var(--accent)"' : ""}><span>${a.mode === "live" ? '<b class="down">● LIVE</b> ' : ""}${esc(a.name)}<br><small>balance ${rsx(a.balance)} · ${a.open || 0} open</small></span>${a.id === ACCT ? "✓" : ""}</button>`).join("")}
      <button data-m="1"><span>New or manage accounts…</span>›</button></div>`);
  sh.querySelectorAll("[data-id]").forEach(b => b.onclick = () => { mClose(); acctSwitch(b.dataset.id); setTimeout(mRefresh, 600); });
  sh.querySelector("[data-m]").onclick = () => { mClose(); mShow("more"); pgShow("account"); setTimeout(() => { const el = mq("#acctMgr"); el && el.scrollIntoView({behavior: "smooth"}); }, 300); };
}

/* ---------------------------------------------------------------- Trade tab */
function mTrade(){
  const box = mq("#ms_trade"); if(!box || M.ms !== "trade" || !P.snap) return;
  const sn = P.snap, a = sn.acct, ps = sn.positions, os = sn.orders, live = typeof liveOn === "function" && liveOn();
  const key = [ps.map(p => p.id).join(","), os.map(o => [o.id, o.price, o.sl, o.tp].join(":")).join(","), live].join("|");
  if(key !== M.tradeKey || !box.childElementCount){
    M.tradeKey = key;
    box.innerHTML = `
      <div class="mcard ${live ? "live" : ""}"><div class="mgrid" id="mtAcct"></div></div>
      <div class="mh">Positions (${ps.length})<span class="sp"></span>${ps.length ? `<button class="sm" id="mtBeAll">BE all</button><button class="sm danger" id="mtCloseAll">Close all</button>` : ""}</div>
      ${ps.length ? ps.map(p => `<button class="mpos" data-id="${p.id}">
          <div class="r1"><span class="side ${p.side > 0 ? "up" : "down"}">${p.side > 0 ? "LONG" : "SHORT"}</span><span class="sym">${esc(short(p.s))}</span><span class="net" data-f="net"></span></div>
          <div class="r2"><span>${p.lots} lot @ <b>${fmt(p.avg, p.tick)}</b></span><span>LTP <b data-f="ltp"></b></span><span>SL <b data-f="sl"></b></span><span>TP <b data-f="tp"></b></span><span data-f="r"></span></div>
          <div class="fy" data-f="fy"></div></button>`).join("") : `<div class="mempty">No open positions. Open a chart and tap BUY or SELL.</div>`}
      <div class="mh">Pending orders (${os.length})<span class="sp"></span>${os.length ? `<button class="sm" id="mtCancelAll">Cancel all</button>` : ""}</div>
      ${os.length ? os.map(o => `<button class="mpos" data-oid="${o.id}">
          <div class="r1"><span class="side ${o.side > 0 ? "up" : "down"}">${o.side > 0 ? "BUY" : "SELL"} ${esc(o.type.toUpperCase())}</span><span class="sym">${esc(short(o.s))}</span><span class="mono">${fmt(o.price, tickOf(o.s))}</span></div>
          <div class="r2"><span>${o.lots} lot · ${esc(prodName(o.product))}</span><span>SL <b>${o.sl ?? "–"}</b> <i class="down">${o.at_sl != null ? rsS(o.at_sl) : ""}</i></span><span>TP <b>${o.tp ?? "–"}</b> <i class="up">${o.at_tp != null ? rsS(o.at_tp) : ""}</i></span></div></button>`).join("") : `<div class="mempty">No pending orders.</div>`}
      <div class="mh">Trailing for new trades</div>
      <div class="mcard">
        <div class="mtog"><span>Trail BE at</span><input id="mtBeR" inputmode="decimal"><button id="mtBe">off</button></div>
        <div class="mtog"><span>Trail SL from</span><input id="mtSlR" inputmode="decimal"><button id="mtSl">off</button></div>
        <p class="help" style="margin:4px 0 0">R is net of charges. Each open trade's own trailing is in its sheet (tap the trade).</p>
      </div>`;
    box.querySelectorAll("[data-id]").forEach(b => b.onclick = () => mPosSheet(b.dataset.id));
    box.querySelectorAll("[data-oid]").forEach(b => b.onclick = () => mOrdSheet(b.dataset.oid));
    const be = mq("#mtBeAll"); if(be) be.onclick = () => papi("be_all");
    const ca = mq("#mtCloseAll"); if(ca) ca.onclick = e => { const b = e.currentTarget;
      if(b.dataset.armed){ delete b.dataset.armed; b.textContent = "Close all"; papi("close_all"); }
      else { b.dataset.armed = "1"; b.textContent = "Sure? Tap again"; setTimeout(() => { if(b.isConnected){ delete b.dataset.armed; b.textContent = "Close all"; } }, 3000); } };
    const cn = mq("#mtCancelAll"); if(cn) cn.onclick = async () => { for(const o of [...P.snap.orders]) await papi("cancel", {id: o.id}); };
    mq("#mtBe").onclick = () => papi("trail", {be_on: !P.snap.trail.be_on, be_r: num(mq("#mtBeR").value) || 1});
    mq("#mtSl").onclick = () => papi("trail", {sl_on: !P.snap.trail.sl_on, sl_r: num(mq("#mtSlR").value) || 1});
    mq("#mtBeR").onchange = () => papi("trail", {be_r: num(mq("#mtBeR").value) || 1});
    mq("#mtSlR").onchange = () => papi("trail", {sl_r: num(mq("#mtSlR").value) || 1});
  }
  const cells = [["Balance", rs(a.balance)], ["Equity", rs(a.equity)],
    ["Open P&L (net)", `<span class="${cls(a.open_net)}">${rs(a.open_net)}</span>`], ["Today (net)", `<span class="${cls(a.realized_today)}">${rs(a.realized_today)}</span>`],
    ["Day room", a.day_room == null ? "off" : `<span class="${a.day_room < 0 ? "down" : ""}">${rs(a.day_room)}</span>`],
    ["Max room", a.max_room == null ? "off" : `<span class="${a.max_room < 0 ? "down" : ""}">${rs(a.max_room)}</span>`],
    ["Margin used", rs(a.margin_used)], ["Open risk", rs(a.open_risk)],
    ["Trades today", a.trades_today + (sn.rules.max_trades ? ` / ${sn.rules.max_trades}` : "")], ["Charges today", rs(a.charges_today)]];
  mq("#mtAcct").innerHTML = cells.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
  for(const p of ps){
    const el = box.querySelector(`[data-id="${p.id}"]`); if(!el) continue;
    const f = n => el.querySelector(`[data-f="${n}"]`);
    f("net").textContent = rs(p.net); f("net").className = "net " + cls(p.net);
    f("ltp").textContent = fmt(p.ltp, p.tick) + (p.stale ? " ⚠" : "");
    f("sl").textContent = (p.sl != null ? fmt(p.sl, p.tick) : "none") + (p.at_be ? " BE" : p.trail ? " TR" : "");
    f("tp").textContent = p.tp != null ? fmt(p.tp, p.tick) : "none";
    f("r").innerHTML = p.r_now != null ? `<b class="${cls(p.r_now)}">${p.r_now > 0 ? "+" : ""}${p.r_now}R</b>` : "";
    if(live){ const s = fyStopText(p); f("fy").textContent = s.t; f("fy").className = "fy " + s.c; } else f("fy").textContent = "";
  }
  const t = sn.trail;
  mq("#mtBe").textContent = t.be_on ? "ON" : "off"; mq("#mtBe").classList.toggle("on", t.be_on);
  mq("#mtSl").textContent = t.sl_on ? "ON" : "off"; mq("#mtSl").classList.toggle("on", t.sl_on);
  setv(mq("#mtBeR"), t.be_r); setv(mq("#mtSlR"), t.sl_r);
}

/* ---------------------------------------------------------------- History tab */
async function mHistory(reload){
  const box = mq("#ms_history"); if(!box) return;
  if(reload || !M.hist){
    if(!box.childElementCount) box.innerHTML = `<div class="mempty">Loading…</div>`;
    const j = await api("/api/paper/history?days=" + (M.histDays === 1 ? 2 : M.histDays));
    M.hist = j.ok ? j.rows : [];
  }
  let rows = M.hist;
  if(M.histDays === 1){ const today = istDay(Date.now() / 1000); rows = rows.filter(h => istDay(h.closed) === today); }
  const net = rows.reduce((s, h) => s + h.net, 0), ch = rows.reduce((s, h) => s + (h.charges ? h.charges.total : 0), 0);
  const wins = rows.filter(h => h.net > 0).length, rr = rows.filter(h => h.r != null);
  const gw = rows.filter(h => h.net > 0).reduce((s, h) => s + h.net, 0), gl = -rows.filter(h => h.net < 0).reduce((s, h) => s + h.net, 0);
  box.innerHTML = `
    <div class="mseg" id="mhDays">${[[1, "Today"], [7, "7 days"], [30, "30 days"], [0, "All"]].map(([d, n]) => `<button data-d="${d}" class="${M.histDays === d ? "on" : ""}">${n}</button>`).join("")}</div>
    <div class="mcard"><div class="mgrid">
      <div><span>Net P&L (after charges)</span><b class="${cls(net)}">${rs(net)}</b></div><div><span>Trades</span><b>${rows.length}</b></div>
      <div><span>Win rate</span><b>${rows.length ? Math.round(wins / rows.length * 100) + "%" : "–"}</b></div><div><span>Profit factor</span><b>${gl > 0 ? (gw / gl).toFixed(2) : gw > 0 ? "∞" : "–"}</b></div>
      <div><span>Average R</span><b>${rr.length ? (rr.reduce((s, h) => s + h.r, 0) / rr.length).toFixed(2) + "R" : "–"}</b></div><div><span>Charges paid</span><b>${rs(ch)}</b></div>
    </div></div>
    ${rows.length ? rows.map((h, i) => `<div class="mhist" data-i="${i}">
      <div class="r1"><span class="side ${h.side > 0 ? "up" : "down"}">${h.side > 0 ? "L" : "S"}</span><span class="sym">${esc(short(h.s))}</span><b class="${cls(h.net)} mono">${rs(h.net)}</b></div>
      <div class="r2">${istTime(h.closed)} · ${h.lots} lot · ${h.avg} → ${h.exit} · ${esc(h.reason)}${h.r != null ? ` · ${h.r > 0 ? "+" : ""}${h.r}R` : ""}${h.src === "fyers" ? " · placed in Fyers" : ""}</div>
      <div class="bd ${M.histOpen[h.closed + h.s] ? "" : "hide"}"></div></div>`).join("") : `<div class="mempty">No closed trades in this period.</div>`}
    <p class="help" style="text-align:center"><a href="/api/paper/history.csv">Download CSV</a> · <a href="#" id="mhFull">Full history page (equity curve, filters)</a></p>`;
  box.querySelectorAll("#mhDays button").forEach(b => b.onclick = () => { M.histDays = +b.dataset.d; mHistory(true); });
  const full = mq("#mhFull"); if(full) full.onclick = e => { e.preventDefault(); pgShow("history"); };
  const det = (el, h) => { el.innerHTML = breakdown(h.charges, "All charges, entry + exit") +
      `<div><span>Gross P&L</span><span>${rs(h.gross)}</span></div><div class="tot"><span>Net P&L</span><span>${rs(h.net)}</span></div>` +
      `<div><span>First SL / risk</span><span>${h.first_sl ?? "–"} / ${rs(h.init_risk)}</span></div>` +
      `<div><span>Product</span><span>${esc(prodName(h.product))}</span></div><div><span>Opened</span><span>${istTime(h.opened)}</span></div>` +
      (typeof rpOpen === "function" ? `<div class="mrp"><button class="primary rp-open">▶ On chart</button></div>` : "");
    const rb = el.querySelector(".rp-open"); if(rb) rb.onclick = e => { e.stopPropagation(); rpOpen(rpKeyOf(h)); }; };
  box.querySelectorAll(".mhist").forEach(el => {
    const h = rows[+el.dataset.i], bd = el.querySelector(".bd");
    if(!bd.classList.contains("hide")) det(bd, h);
    el.onclick = () => { const k = h.closed + h.s; M.histOpen[k] = bd.classList.toggle("hide") ? 0 : 1; if(M.histOpen[k]) det(bd, h); };
  });
}

/* ---------------------------------------------------------------- More tab */
function mMore(){
  const box = mq("#ms_more"); if(!box) return;
  const f = (typeof S !== "undefined" && S.fyers) || {}, u = (S && S.user) || {};
  const theme = prefGet("theme", "");
  box.innerHTML = `
    <div class="mcard"><b>${esc(u.name || u.username || "")}</b> <span class="muted">${esc(u.role || "")}</span><span class="muted mono" id="mVer" style="float:right;font-size:12px">v${esc(S.version || "")}</span>
      <div class="muted sm" style="margin-top:4px">Fyers: ${f.logged_in ? `<span class="up">logged in${f.client_id ? " · " + esc(f.client_id) : ""}</span>` : f.configured ? '<span class="down">not logged in today</span>' : '<span class="down">app not set up</span>'}</div>
      ${f.configured && !f.logged_in ? `<div class="mbtns"><button class="primary" id="mmFy">Log in to Fyers</button></div>` : ""}</div>
    <div class="mlist">
      <button data-pg="account"><span>Account, rules and charges<br><small>loss limits, risk caps, square-off, trailing defaults</small></span>›</button>
      <button data-a="acct"><span>Switch account</span>›</button>
      <button data-pg="trades"><span>Trades table<br><small>every position in one table</small></span>›</button>
      <button data-pg="book"><span>Order book</span>›</button>
      <button data-pg="log"><span>Log<br><small>fills, stops moved, refusals</small></span>›</button>
      <button data-a="set"><span>Settings<br><small>Fyers app, MT5 bridge, security and 2FA, users, reset</small></span>›</button>
    </div>
    <div class="mh">Theme</div>
    <div class="mseg" id="mmTheme">${[["", "Auto"], ["dark", "Dark"], ["light", "Light"]].map(([t, n]) => `<button data-t="${t}" class="${theme === t ? "on" : ""}">${n}</button>`).join("")}</div>
    <div class="mlist" style="margin-top:14px">
      <button data-a="desk"><span>Desktop layout<br><small>the full desktop page on this device</small></span>›</button>
      <button data-a="out"><span class="down">Log out of this device</span></button>
    </div>
    <p class="help" style="text-align:center">${esc(mq("#ver") ? mq("#ver").textContent : "")}</p>`;
  const fy = mq("#mmFy"); if(fy) fy.onclick = fyersLogin;
  box.querySelectorAll("[data-pg]").forEach(b => b.onclick = () => pgShow(b.dataset.pg));
  box.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => {
    const a = b.dataset.a;
    if(a === "acct") mAcctSheet();
    if(a === "set") openDrawer();
    if(a === "desk"){ try{ localStorage.setItem("ftm.layout", "desk"); }catch(e){} mApply(); toast("Desktop layout. Settings → Phone layout switches back."); }
    if(a === "out"){ if(!confirm("Log out of this device?")) return; await api("/api/logout", {body: {}}); location.reload(); }
  });
  box.querySelectorAll("#mmTheme button").forEach(b => b.onclick = () => { prefSet("theme", b.dataset.t); applyTheme(); mMore(); });
}
// a way back to the phone layout from the desktop page (Settings drawer)
function mDeskLink(){
  const d = mq("#drawer"); if(!d || mq("#mLayout")) return;
  const s = document.createElement("div");
  s.innerHTML = `<h3>Layout</h3><div class="seg" id="mLayout"><button data-l="">Automatic</button><button data-l="mob">Phone</button><button data-l="desk">Desktop</button></div>
    <p class="help">Automatic uses the phone layout on phones (small touch screens).</p>`;
  const th = mq("#theme");
  if(th) th.after(s); else mq("#drawer .db").append(s);
  const paint = () => s.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.l === mPref()));
  s.querySelectorAll("button").forEach(b => b.onclick = () => { try{ b.dataset.l ? localStorage.setItem("ftm.layout", b.dataset.l) : localStorage.removeItem("ftm.layout"); }catch(e){} paint(); mApply(); });
  paint();
}

/* ---------------------------------------------------------------- updates from the rest of the page */
function mRefresh(){
  if(!M.on) return;
  mTopBar(); mChips();
  if(M.ms === "trade") mTrade();
  if(M.sheet === "pos") mPosFill(); else if(M.sheet === "ord") mOrdFill(); else if(M.sheet === "ticket") mTicketFill();
}
(function(){
  const pu = paperUpdate;
  paperUpdate = function(s, events){ pu(s, events); if(M.on){ mRefresh(); if(events && events.length && M.ms === "history") mHistory(true); } };
  const rt = renderTicket;
  renderTicket = function(){ rt(); if(M.on){ mTicketFill(); mSymBar(); } };
  const rp = renderPlan;
  renderPlan = function(){ rp(); if(M.on) mPlanFill(); };
  const ot = onTick;
  onTick = function(t){ ot(t); if(!M.on) return;
    if(cur && t.s === cur.s) mSymBar();
    mFeed(t.src === "poll" ? "warn" : "ok");
    if(M.sheet === "ord") mOrdFill(); };
  const fp = feedPill;
  feedPill = function(fd){ fp(fd); if(!M.on || !fd) return;
    const age = fd.last_tick_age, li = (S.fyers || {}).logged_in;
    mFeed(!li ? "" : fd.socket ? "ok" : "warn"); mWarnings(); };
  const os = openSymbol;
  openSymbol = function(row){ const r = os(row); if(M.on){ mSymBar(); if(M.ms === "quotes") mShow("chart"); } return r; };
  const ps = pgShow;
  pgShow = function(name, fromHash){ ps(name, fromHash); if(M.on) mTopBar(); };
  const sf = setFull;
  setFull = function(on, real){ sf(on, real); if(!on) M.autoFs = false; if(M.on) setTimeout(() => { if(chart){ legendPlace(); positionTools(); } }, 80); };
  const od = openDrawer;
  openDrawer = function(){ od(); mDeskLink(); };
  const rs0 = refreshState;
  refreshState = async function(){ const r = await rs0(); if(M.on){ mTopBar(); } return r; };
})();
// phone turned sideways on the chart tab: the chart takes the whole screen, as in MT5; upright again: back
function mOrient(){
  if(!M.on) return;
  const o = screen.orientation && screen.orientation.type;     // the device's turn (the keyboard opening doesn't count)
  const land = (o ? o.startsWith("landscape") : Math.abs(window.orientation || 0) === 90) && Math.min(screen.width, screen.height) <= 520;
  if(land && M.ms === "chart" && (!M.sheet || (M.sheet === "ticket" && M.min)) && !document.body.classList.contains("chartfs")){ setFull(true); M.autoFs = true; }
  else if(!land && M.autoFs && document.body.classList.contains("chartfs")){ setFull(false); }
}
addEventListener("resize", () => { mApply(); mWarnings(); });
addEventListener("orientationchange", () => setTimeout(() => { mApply(); mOrient(); }, 250));
if(screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener("change", () => setTimeout(mOrient, 250));
mApply();
