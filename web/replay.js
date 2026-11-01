/* Trade replay (v0.29.0, roadmap 4c): every finished trade on the chart it was taken on, and ▶ Play to watch it as it
   played out.
   - Every page: PLACE sends the chart's set-up with the order (the server keeps it for the entry's snapshot).
   - The main page: "▶ On chart" (Journal, History, the phone's History) opens the replay over the page, in a frame:
     this same page loaded as /?replay=<trade>, chart only, with nothing saved - your own layout isn't touched.
   - The replay frame: the chart set up as recorded at the entry (or the exit): contract, timeframe, chart type, Chart
     settings, indicators with their settings, the Pine code as it was then (or your current code), the contract's
     drawings as they were. The trade is drawn on it: entries / adds and exits at their real prices and times, the
     stop's path, the target, break-even + costs. ▶ Play: the candles come one at a time from before the entry (a
     forming candle builds from the 1-minute candles), indicators and Pine are worked out as each candle closes from
     what was known then (the chart's own live-candle path), the stop / target move when they moved, the net ₹ and R
     after all charges at each step.
   Candles come through /api/history (the chart's own route), so days item 10 will patch with recorded live candles
   reach the replay the same way. Loaded after multichart.js, before mobile.js. */
"use strict";
const RP_KEYS = ["cur", "tf2", "ctype", "chart", "indicators", "lgdMin0"];
const rpClone = v => v == null ? v : JSON.parse(JSON.stringify(v));
const rpBase = id => String(id || "").replace(/p\d+$/, "");

/* ================================================================ every page: PLACE carries the chart's set-up */
if(!window.FTM_REPLAY){
  const pa = papi;
  papi = function(path, body){
    if(path === "place" && body && typeof body === "object"){
      const setup = {}; for(const k of RP_KEYS){ const v = prefGet(k, null); if(v != null) setup[k] = rpClone(v); }
      let from = null;
      try{
        if(window.FTM_CELL != null){ const m = /[?&]l=([^&]+)/.exec(location.search); from = {lay: m ? decodeURIComponent(m[1]) : "", cell: +window.FTM_CELL}; }
        else if(typeof layCur === "function" && layCur()) from = {lay: layCur().id, cell: LAY.cell || 0};
      }catch(e){}
      body = {...body, setup, from};
    }
    return pa.call(this, path, body);
  };
}

/* ================================================================ the main page: open / close the replay */
if(!window.FTM_REPLAY && window.FTM_CELL == null){
  window.rpOpen = function(key, ph){
    if(!key) return;
    rpClose(true);
    const w = document.createElement("div"); w.id = "rpWrap";
    const f = document.createElement("iframe"); f.title = "Trade replay";
    f.src = `/?replay=${encodeURIComponent(key)}${ph ? "&ph=" + ph : ""}&n=${Date.now() % 1e6}`;
    w.append(f); document.body.append(w); document.body.classList.add("rpOn");
    setTimeout(() => { try{ f.focus(); }catch(e){} }, 300);
  };
  window.rpClose = function(quiet){
    const w = document.getElementById("rpWrap"); if(w) w.remove();
    document.body.classList.remove("rpOn");
  };
  window.rpKeyOf = h => (typeof ACCT !== "undefined" && ACCT ? ACCT : "") + ":" + rpBase(h.id);
  addEventListener("message", e => {
    if(e.origin !== location.origin || !e.data || typeof e.data !== "object") return;
    if(e.data.rp === "close") rpClose();
    if(e.data.rp === "reload") rpOpen(e.data.key, e.data.ph);
  });
  addEventListener("keydown", e => { if(e.key === "Escape" && document.getElementById("rpWrap")) rpClose(); });
}

/* ================================================================ the replay frame (?replay=<trade>) */
if(window.FTM_REPLAY){
(function replayMode(){
  const qs = new URLSearchParams(location.search);
  const RP = window.RP = {key: window.FTM_REPLAY, ph: qs.get("ph") === "exit" ? "exit" : "entry", code: qs.get("code") === "mine" ? "mine" : "rec",
    d: null, C: null, snap: null, err: null, rows: [], sub: [], subRes: null, steps: [], i: -1, T: null, playing: false,
    timer: null, speed: 4, net: {}, netBusy: false, loaded: false, before: 30, after: 15, myDraw: null};
  const T0 = () => RP.d && RP.d.trade;
  const tickOf = () => (cur && cur.tick) || ((RP.d && RP.d.row) || {}).tick || 0.05;
  const istStr = (t, sec) => t == null ? "–" : new Date((t + IST) * 1000).toLocaleString("en-GB", {timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", ...(sec ? {second: "2-digit"} : {})});
  const rsx = n => n == null || isNaN(n) ? "–" : (n > 0 ? "+" : n < 0 ? "−" : "") + "₹" + Math.abs(n).toLocaleString("en-IN", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const rr = r => r == null || isNaN(r) ? "" : ` (${r > 0 ? "+" : ""}${(+r).toFixed(2)}R)`;
  const dur = s => { s = Math.max(0, Math.round(s)); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`; };
  const post = m => { try{ parent.postMessage(m, location.origin); }catch(e){} };

  // ---- nothing in here is saved: chart keys live in RP.C, other preferences only in this page
  const pg = prefGet;
  prefGet = function(k, d){
    if(RP_KEYS.includes(k) && RP.C) return RP.C[k] != null ? RP.C[k] : (k === "cur" ? d : pg(k, d));
    if(k === "pineOpen" || k === "nopanel") return k === "nopanel";
    return pg.apply(this, arguments);
  };
  prefSet = function(k, v){ if(RP_KEYS.includes(k) && RP.C){ RP.C[k] = rpClone(v); return; } PREF[k] = v; };
  connectWS = function(){};                                   // no live prices, no account updates: this is the past
  dataCheck = function(){};
  const pu = paperUpdate;
  paperUpdate = function(s, ev){ return pu.call(this, {...s, positions: [], orders: []}, []); };   // (your open trades aren't this trade)
  arm = function(){ toast("This is a replay: trade from your own chart"); };
  toast = (function(t0){ return function(msg){ if(/^Logged in to Fyers/.test(msg)) return; return t0.apply(this, arguments); }; })(toast);

  // ---- the trade and its recorded set-up, before the chart is built
  const lp = loadPrefs;
  loadPrefs = async function(){
    await lp();
    const j = await api("/api/journal/replay?id=" + encodeURIComponent(RP.key));
    if(!j.ok){ RP.err = j.error || "Couldn't load the trade"; RP.C = {}; return; }
    RP.d = j;
    const tr = j.trade, st = j.setup || {};
    if(!st[RP.ph]) RP.ph = RP.ph === "exit" ? (st.entry ? "entry" : "exit") : (st.exit ? "exit" : "entry");
    RP.snap = st[RP.ph] || null;
    const base = {}; for(const k of RP_KEYS){ const v = pg(k, null); if(v != null) base[k] = rpClone(v); }
    RP.C = RP.snap ? rpClone(RP.snap.chart) : base;
    const row = j.row || {};
    if(!RP.C.cur || RP.C.cur.s !== tr.s) RP.C.cur = {s: tr.s, d: row.d || tr.s, tick: row.tick, lot: row.lot, mult: row.mult, sess: row.sess};
    if(row.s) sym[row.s] = row;
    if(RP.snap && RP.code === "rec" && (RP.snap.scripts || []).length){
      PINE.scripts = RP.snap.scripts.map(x => ({id: x.id, name: x.name, source: x.source})); PINE.loaded = true;
      pineLoad = async function(){ return PINE.scripts; };
    }
    document.title = `Replay · ${symLabel(tr.s)}`;
  };
  if(typeof layBoot === "function") layBoot = async function(){};

  // ---- drawings: the contract's drawings as recorded (locked), plus this trade; nothing saved
  drSaveSoon = function(){ DR.dirty = false; };
  drSaveNow = async function(){ DR.dirty = false; clearTimeout(DR.saveT); };
  drSymbol = async function(s){
    DR.s = s; DR.sel = null; DR.draft = null; DR.drag = null; DR.meas = null; DR.undo = []; DR.redo = [];
    let items = [];
    const tr = T0();
    if(tr && s === tr.s){
      if(RP.snap) items = rpClone(RP.snap.drawings || []);
      else { if(RP.myDraw == null){ const j = await api("/api/drawings?s=" + encodeURIComponent(s)); RP.myDraw = j.ok ? j.items || [] : []; } items = rpClone(RP.myDraw); }
      items = items.filter(d => d && DT[d.type] && Array.isArray(d.pts)).map(d => ({...d, lock: true}));
      items.unshift({id: "rp-trade", type: "rptrade", pts: [{t: (tr.opened || 0) + IST, p: tr.avg || (tr.entries[0] || {}).price || 0}], lock: true, st: {}});
    }
    DR.items = items; DR.loaded = true;
    drRedraw(); if(typeof drUiList === "function") drUiList();
  };
  const dh = drHit;
  drHit = function(x, y){ const h = dh.apply(this, arguments); return h && h.d && h.d.type === "rptrade" ? null : h; };

  // ---- the trade on the chart (a drawing type of its own, so it sits right on every chart type and timeframe)
  function pathAt(t){ const p = (RP.d && RP.d.path) || []; let k = -1; for(let i = 0; i < p.length; i++){ if(p[i][0] <= t + 0.5) k = i; else break; } return k >= 0 ? p[k] : null; }
  DT.rptrade = {name: "This trade (replay)", g: "x", n: 1, st: {}, handles: false, geom(A){
    const tr = T0(); if(!tr || !cur || cur.s !== tr.s) return;
    const V = A.V, C = chartCfg(), side = tr.side, tk = tickOf();
    const Tnow = RP.T != null ? RP.T : Infinity;
    const opened = tr.opened || 0, closed = tr.closed || opened;
    if(Tnow < opened) return;
    const end = Math.min(closed, Tnow);
    const X = t => { const L = t2L(t + IST); return L == null ? null : V.xL(L); };
    const x0 = X(opened), x1 = X(end); if(x0 == null || x1 == null) return;
    const xe = Math.max(x1, x0 + 6);
    const self = !tr.basis || tr.basis === "self";
    const slc = C.slC || "#e2483d", tpc = C.tpC || "#22a06b", bec = C.beC || "#4f8cff", ent = cfgColor("entryC");
    const za = (+C.zoneA || 20) / 100 * 0.6;
    const path = ((RP.d && RP.d.path) || []).filter(p => p[0] <= end + 0.5);
    // zones: entry to the stop and to the target, step by step as they moved
    if(self){
      const yAvg = V.y(tr.avg);
      for(let i = 0; i < path.length; i++){
        const a = Math.max(path[i][0], opened), b = i + 1 < path.length ? path[i + 1][0] : end;
        const xa = X(a), xb = Math.max(X(b) ?? xe, (xa ?? 0) + 1); if(xa == null) continue;
        if(path[i][1] != null) A.poly([[xa, yAvg], [xb, yAvg], [xb, V.y(path[i][1])], [xa, V.y(path[i][1])]], rgbaHex(C.lossZ || slc, za), null);
        if(path[i][2] != null) A.poly([[xa, yAvg], [xb, yAvg], [xb, V.y(path[i][2])], [xa, V.y(path[i][2])]], rgbaHex(C.profitZ || tpc, za), null);
      }
      // the stop's path and the target's, as steps
      for(const [k, c, w] of [[1, slc, 2], [2, tpc, 1.6]]){
        let prev = null;
        for(let i = 0; i < path.length; i++){
          const v = path[i][k]; const a = Math.max(path[i][0], opened), b = i + 1 < path.length ? path[i + 1][0] : end;
          const xa = X(a), xb = X(b) ?? xe; if(xa == null){ prev = v; continue; }
          if(v != null){
            const y = V.y(v);
            A.line(xa, y, Math.max(xb, xa + 1), y, c, w, 0);
            if(prev != null && prev !== v) A.line(xa, V.y(prev), xa, y, c, 1, 1);
            if(k === 1 && i > 0 && prev !== v){ A.ell(xa, y, 3, 3, c, c, 1, 0);
              if(path[i][3] === "be") A.label(xa + 4, y + (side > 0 ? 3 : -3), ["BE"], bec, side > 0 ? "top" : "bottom", "left", true, {fs: 10}); }
          }
          prev = v;
        }
        const lastV = path.length ? path[path.length - 1][k] : null;
        if(lastV != null) A.label(xe + 4, V.y(lastV), [`${k === 1 ? "SL" : "TP"} ${fmt(lastV, tk)}`], c, "middle", "left", true, {fs: 11});
      }
      // break-even + costs
      if(RP.d.be != null){ const y = V.y(RP.d.be); A.line(x0, y, xe, y, bec, 1, 1); A.label(x0 - 4, y, [`BE ${fmt(RP.d.be, tk)}`], bec, "middle", "right", true, {fs: 10}); }
      A.line(x0, yAvg, xe, yAvg, ent, 1, 2);
    }
    // entries / adds and exits, at their real prices and times
    const tri = (x, y, up, c) => { const z = 7, d = up ? 1 : -1; A.poly([[x, y + d * 2], [x - z, y + d * (2 + z * 1.5)], [x + z, y + d * (2 + z * 1.5)]], c, null); };
    const lot = tr.lot || 1;
    (tr.entries || []).forEach((e, i) => { if(e.t > Tnow + 0.5) return; const x = X(e.t), y = V.y(e.price); if(x == null || y == null) return;
      const c = side > 0 ? C.up : C.down; tri(x, y, side > 0, c);
      A.label(x - 10, side > 0 ? y + 14 : y - 14, [`${i ? "Add" : side > 0 ? "BUY" : "SELL"} ${Math.round(e.qty / lot)} lot @ ${fmt(e.price, tk)}`], textOn(c), side > 0 ? "top" : "bottom", "right", false, {bg: c, bd: c, pad: 4, fs: 11}); });   // (entries to the left, exits to the right: a short trade's labels don't overlap)
    const e0 = (tr.entries || [])[0];
    for(const c of tr.closes || []){ if(!c.t || c.t > Tnow + 0.5) continue; const x = X(c.t), y = V.y(c.exit); if(x == null || y == null) continue;
      const col = (c.net || 0) >= 0 ? (C.profitZ || tpc) : (C.lossZ || slc);
      if(e0){ const xa = X(e0.t), ya = V.y(e0.price); if(xa != null && ya != null) A.line(xa, ya, x, y, col, 1.2, 2); }
      tri(x, y, side < 0, cssVar("--text"));
      const R = tr.init_risk ? c.net / (tr.init_risk * ((c.qty || 0) / (tr.qty || c.qty || 1))) : null;
      A.label(x + 10, side > 0 ? y - 14 : y + 14, [`Exit ${fmt(c.exit, tk)} · ${c.reason || ""} · ${rsx(c.net)}${tr.closes.length === 1 ? rr(tr.r) : ""}`], textOn(col), side > 0 ? "bottom" : "top", "left", false, {bg: col, bd: col, pad: 4, fs: 11});
    }
  }};

  // the price scale takes in the trade's own prices (entries, exits, the stop and the target as far as the replay is)
  DrawPrim.prototype.autoscaleInfo = function(){
    const tr = T0(); if(!tr || !cur || cur.s !== tr.s) return null;
    const Tn = RP.T != null ? RP.T : Infinity; if(Tn < (tr.opened || 0)) return null;
    const ps = [];
    for(const e of tr.entries || []) if(e.t <= Tn + 0.5) ps.push(e.price);
    for(const c of tr.closes || []) if(c.t && c.t <= Tn + 0.5 && c.exit != null) ps.push(c.exit);
    if(!tr.basis || tr.basis === "self") for(const p of (RP.d.path || [])) if(p[0] <= Tn + 0.5){ if(p[1] != null) ps.push(p[1]); if(p[2] != null) ps.push(p[2]); }
    if(!ps.length) return null;
    return {priceRange: {minValue: Math.min(...ps), maxValue: Math.max(...ps)}};
  };

  // ---- candles: the chart's own route, far enough back for the trade and the indicators' warm-up
  function resSec(res){ return res === "D" ? 86400 : (+res || 1) * 60; }
  async function rpFetch(symbol, res, fromT, until){
    const now = Date.now() / 1000;
    let days = Math.ceil((now - fromT) / 86400) + 2, rows = [];
    for(let k = 0; k < 8; k++){                              // the server reaches further back on each ask (Fyers' limits)
      const j = await api(`/api/history?symbol=${encodeURIComponent(symbol)}&res=${res}&days=${days}${until ? "&until=" + Math.ceil(until) : ""}`);
      if(!j.ok){ if(/busy/.test(j.error || "") && k < 7){ await new Promise(r => setTimeout(r, 2500)); continue; } throw new Error(j.error || "candles didn't load"); }
      const got = j.candles || [];
      const reached = got.length && got[0][0] <= fromT + 86400;
      if(got.length >= rows.length) rows = got;
      if(reached || !got.length || (k && got.length === rows.length && !reached && k > 2)) break;
    }
    return rows;
  }
  loadHistory = async function(){
    if(!cur) return;
    const my = ++histToken, msg = $("#chartMsg");
    const tr = T0();
    RP.loading = true;
    try{ await rpLoad(my, msg, tr); } finally { if(my === histToken) RP.loading = false; }
  };
  async function rpLoad(my, msg, tr){
    if(!tr){ msg.textContent = RP.err || "Loading…"; msg.classList.remove("hide"); return; }
    msg.textContent = "Loading the trade's candles…"; msg.classList.remove("hide");
    const plan = tfPlan(tf); curPlan = plan;
    if(!(S.fyers || {}).logged_in){ msg.textContent = "Log in to Fyers to load the replay's candles."; return; }
    const warm = histDays(plan) * 86400;
    const from = (tr.opened || 0) - warm;
    let rows;
    try{ rows = await rpFetch(cur.s, plan.res, from, 0); }
    catch(e){ if(my === histToken){ msg.textContent = String(e.message || e); series.setData([]); } return; }
    if(my !== histToken) return;
    RP.rows = rows; RP.sub = []; RP.steps = []; RP.subRes = null;
    HX[cur.s + "|" + plan.res] = {days: Math.ceil((Date.now() / 1000 - from) / 86400)};
    if(RP.playing || RP.T != null){ const T = RP.T; rpStop(true); if(T != null){ await rpPrepare(); rpSeek(T); return; } }
    renderCandles(rows, plan);
    rpFrame();
    rpBar();
  }
  const hp = histPrepend;
  histPrepend = function(){ const r = hp.apply(this, arguments); if(RP.T == null) RP.rows = HROWS; return r; };
  const hm = histMore;
  histMore = function(){ if(RP.T != null) return; return hm.apply(this, arguments); };

  // the trade in view, with candles around it
  function rpFrame(){
    const tr = T0(); if(!tr || !DISP.length || !chart) return;
    const a = t2L((tr.opened || 0) + IST), b = t2L((tr.closed || tr.opened || 0) + IST);
    if(a == null || b == null) return;
    const span = Math.max(1, b - a), pad = ctType() === "pf" ? Math.max(4, span * 0.8) : Math.max(25, span * 0.6);
    try{ chart.timeScale().setVisibleLogicalRange({from: a - pad * 1.3, to: b + pad}); }catch(e){}
    drRedraw();
  }

  // ---- ▶ Play
  function subResFor(plan){ return plan.t.min ? (plan.t.min <= 60 ? "1" : "5") : "15"; }
  async function rpPrepare(){
    const tr = T0(), plan = curPlan; if(!tr || !plan) return false;
    const sr = subResFor(plan); RP.subRes = sr;
    // where it starts: some candles before the entry's candle; where it ends: some after the exit
    const iE = drIdx((tr.opened || 0) + IST), iX = drIdx((tr.closed || tr.opened || 0) + IST);
    if(iE < 0){ toast("The trade's candles aren't loaded"); return false; }
    const startBar = DISP[Math.max(0, iE - RP.before)], endBar = DISP[Math.min(DISP.length - 1, Math.max(iX, iE) + RP.after)];
    let t0 = startBar.time - IST, t1 = endBar.time - IST + plan.sec;
    if(!CT.timeBased(ctType())){ t0 = Math.min(t0, (tr.opened || 0) - 3600); }
    t1 = Math.min(t1, Date.now() / 1000);
    if(sr === plan.res && !plan.agg) RP.sub = RP.rows.filter(r => r[0] >= t0 && r[0] < t1);
    else {
      const msg = $("#chartMsg"); msg.textContent = "Loading the 1-minute candles…"; msg.classList.remove("hide");
      try{ RP.sub = (await rpFetch(cur.s, sr, t0, t1 + 1)).filter(r => r[0] >= t0 && r[0] < t1); }
      catch(e){ msg.textContent = ""; msg.classList.add("hide"); toast("1-minute candles didn't load: " + (e.message || e)); return false; }
      msg.classList.add("hide");
    }
    RP.sub = noTradeDrop(RP.sub);
    const ss = resSec(sr);
    RP.steps = RP.sub.map(r => r[0] + ss);
    if(!RP.steps.length){ toast("No candles in the trade's window"); return false; }
    rpNetLoad();
    return true;
  }
  // the chart's candles as they stood at time T: whole candles closed by then, plus the forming one built from the
  // 1-minute candles up to T
  function rowsAt(T){
    const rs = resSec(curPlan.res), out = [];
    let form = null;
    for(const r of RP.rows){
      if(r[0] + rs <= T){ out.push(r); continue; }
      if(r[0] <= T && !form) form = r[0];
      break;
    }
    if(form == null){ const last = out[out.length - 1]; if(last && T - (last[0] + rs) < rs) form = last[0] + rs; }
    if(form != null){
      const ss = resSec(RP.subRes || "1"); let p = null;
      for(const s of RP.sub){ if(s[0] < form || s[0] + ss > T) continue;
        if(!p) p = [form, s[1], s[2], s[3], s[4], s[5] || 0]; else { p[2] = Math.max(p[2], s[2]); p[3] = Math.min(p[3], s[3]); p[4] = s[4]; p[5] += s[5] || 0; } }
      if(p) out.push(p);
    }
    return out;
  }
  function rpSeek(T){
    RP.T = T;
    HROWS = rowsAt(T);
    RAW = aggBars(HROWS, curPlan); volCum = null;
    for(const r of INDS) if(r.pine) r.pine.reach = 0;
    showRaw();
    drRedraw(); rpStatus();
  }
  function rpStepTo(T){
    const rows = rowsAt(T), bars = aggBars(rows, curPlan), old = RAW;
    RP.T = T; HROWS = rows;
    if(!old.length || !bars.length || bars.length < old.length || bars.length - old.length > 1 || bars[0].time !== old[0].time){
      RAW = bars; lastBar = RAW[RAW.length - 1] || null; dispSet(); indData(); }
    else { RAW = bars; lastBar = RAW[RAW.length - 1]; dispLive(); }
    drRedraw(); rpStatus();
  }
  function rpIdxAt(T){ let k = -1; for(let i = 0; i < RP.steps.length; i++){ if(RP.steps[i] <= T) k = i; else break; } return k; }
  async function rpStart(at){
    for(let k = 0; k < 120 && (RP.loading || !RP.rows.length); k++) await new Promise(r => setTimeout(r, 250));   // (a timeframe still loading)
    if(!RP.steps.length && !(await rpPrepare())) return false;
    RP.i = at != null ? at : 0;
    rpSeek(RP.steps[RP.i]);
    rpBar();
    return true;
  }
  function rpTickOnce(){
    if(RP.i + 1 >= RP.steps.length){ rpPause(); rpStatus("end"); return false; }
    RP.i++; rpStepTo(RP.steps[RP.i]); return true;
  }
  function rpPlay(){
    if(RP.T == null){ rpStart().then(ok => { if(ok) rpPlay(); }); return; }
    if(RP.i + 1 >= RP.steps.length){ RP.i = 0; rpSeek(RP.steps[0]); }
    RP.playing = true; clearInterval(RP.timer);
    RP.timer = setInterval(rpTickOnce, Math.max(30, 1000 / RP.speed));
    rpBar();
  }
  function rpPause(){ RP.playing = false; clearInterval(RP.timer); RP.timer = null; rpBar(); }
  function rpStep(){ if(RP.T == null){ rpStart(); return; } rpPause(); rpTickOnce(); }
  function rpNextBar(){
    if(RP.T == null){ rpStart(); return; }
    rpPause();
    const S_ = RP.steps, n = S_.length, bk = T => bucket(T - 1 + IST, curPlan);   // the chart candle a step's minute belongs to
    let i = RP.i, b0 = bk(RP.T);
    if(i + 1 < n && bk(S_[i + 1]) !== b0){ i++; b0 = bk(S_[i]); }                // this candle is complete: on to the next one's close
    while(i + 1 < n && bk(S_[i + 1]) === b0) i++;
    if(i === RP.i){ rpStatus("end"); return; }
    RP.i = i; rpStepTo(S_[i]);
  }
  function rpJump(what){
    const tr = T0(); if(!tr) return;
    const go = () => { const t = what === "exit" ? (tr.closed || tr.opened) : tr.opened;
      let k = RP.steps.findIndex(x => x >= t);                 // the first candle that has it (the minute of the fill / close)
      if(k < 0) k = RP.steps.length - 1;
      rpPause(); RP.i = k; rpSeek(RP.steps[k]); rpBar(); };
    if(RP.T == null) rpStart().then(ok => { if(ok) go(); }); else go();
  }
  function rpStop(quiet){
    rpPause(); RP.T = null; RP.i = -1;
    if(!quiet){ HROWS = RP.rows; renderCandles(RP.rows, curPlan); rpFrame(); rpBar(); rpStatus(); }
  }
  // the net ₹ (after all charges) at each step's price, from the server's charges
  async function rpNetLoad(){
    const tr = T0(); if(!tr || RP.netBusy) return;
    const ss = resSec(RP.subRes || "1"), pts = [];
    for(const s of RP.sub){ const t = s[0] + ss; if(t >= (tr.opened || 0) && t <= (tr.closed || Infinity) + ss && RP.net[t] == null) pts.push([t, s[4]]); }
    if(!pts.length) return;
    RP.netBusy = true;
    for(let k = 0; k < pts.length; k += 4000){
      const chunk = pts.slice(k, k + 4000);
      const j = await api("/api/journal/replay/net", {body: {id: RP.key, pts: chunk}});
      if(j.ok) chunk.forEach((p, i) => { RP.net[p[0]] = [j.net[i], j.r[i]]; });
    }
    RP.netBusy = false; rpStatus();
  }

  // ---- the replay bar (over the chart)
  function rpBar(){
    let b = $("#rpBar");
    if(!b){ b = document.createElement("div"); b.id = "rpBar"; $(".charthead").before(b); b.addEventListener("click", rpClick); }
    const tr = T0();
    if(!tr){ b.innerHTML = `<div class="rp1"><button class="rp-back" data-a="back">← Back</button><b>${esc(RP.err || "Loading the trade…")}</b></div>`; return; }
    const st = (RP.d.setup || {}), long = tr.side > 0;
    const srcTxt = !RP.snap ? "set-up not recorded (a trade from before v0.29.0): your current chart"
      : ({order: "the chart the order was placed from", layout: `layout “${esc((RP.snap.where || {}).name || "")}”`, prefs: "your chart then",
          other: "your chart then (it showed another contract)", entry: "as at the entry"})[RP.snap.src] || "";
    const pathTxt = ({recorded: "", log: "stop's path from the account's log", "log-part": "stop's path from the account's log (it doesn't reach back to the opening)",
      ends: "only the first and last stop are known"})[RP.d.path_src] || "";
    const basisTxt = tr.basis && tr.basis !== "self" ? `stop on the underlying (${esc(symLabel(tr.ref || ""))}): its levels aren't drawn on this chart` : "";
    const segs = `<span class="rp-seg" title="The chart's set-up as recorded at the entry or at the exit">
          <button data-a="ph" data-v="entry" class="${RP.ph === "entry" ? "on" : ""}" ${st.entry ? "" : "disabled"}>Entry set-up</button><button data-a="ph" data-v="exit" class="${RP.ph === "exit" ? "on" : ""}" ${st.exit ? "" : "disabled"}>Exit set-up</button></span>
        ${RP.snap && (RP.snap.scripts || []).length ? `<span class="rp-seg" title="Pine scripts: the code as it was then, or your code as it is now">
          <button data-a="code" data-v="rec" class="${RP.code === "rec" ? "on" : ""}">Pine as recorded</button><button data-a="code" data-v="mine" class="${RP.code === "mine" ? "on" : ""}">My current Pine</button></span>` : ""}`;
    const notes = [srcTxt, pathTxt, basisTxt].filter(Boolean).map(x => `<span>${x}</span>`).join(" · ");
    b.innerHTML = `<div class="rp1">
        <button class="rp-back" data-a="back" title="Back to my chart (Esc)">←<span class="rp-wd"> Back</span></button>
        <span class="rp-side ${long ? "up" : "down"}">${long ? "LONG" : "SHORT"}</span>
        <b class="rp-sym">${esc(symLabel(tr.s))}</b>
        <span class="rp-meta rp-wd">${tr.lots || "–"} lot · ${esc(tr.acct_name || "")}${tr.mode === "live" ? " · LIVE" : ""} · ${istStr(tr.opened)} → ${istStr(tr.closed)} (${dur((tr.closed || 0) - (tr.opened || 0))})</span>
        <span class="sp"></span>
        <b class="rp-net ${(tr.net || 0) >= 0 ? "up" : "down"}">${rsx(tr.net)}${rr(tr.r)}</b>
        <span class="rp-meta rp-wd">${esc(tr.reason || "")}</span>
        <button class="rp-more" data-a="more" title="Set-up, Pine code, notes">⋯</button>
      </div>
      <div class="rp2">
        <span class="rp-play">
          <button data-a="start" title="Back to the start">⏮</button>
          <button data-a="play" class="primary" title="Play / pause (Space)">${RP.playing ? "⏸<span class='rp-wd'> Pause</span>" : "▶<span class='rp-wd'> Play</span>"}</button>
          <button data-a="step" title="One ${RP.subRes === "5" ? "5-minute" : RP.subRes === "15" ? "15-minute" : "1-minute"} candle (→)">+1</button>
          <button data-a="bar" title="To the next candle on this chart (Shift+→)">⏭</button>
          <select data-a="speed" title="Speed: candles a second">${[1, 2, 4, 8, 16, 32].map(v => `<option value="${v}" ${RP.speed === v ? "selected" : ""}>${v}×</option>`).join("")}</select>
          <button data-a="jentry" title="To the entry">Entry</button><button data-a="jexit" title="To the exit">Exit</button>
          ${RP.T != null ? `<button data-a="stop" title="The whole chart again">■<span class="rp-wd"> Stop</span></button>` : ""}
        </span>
        <span class="rp-st" id="rpSt"></span>
      </div>
      <div class="rp-opts">
        <div class="rp-meta rp-ph">${tr.lots || "–"} lot · ${esc(tr.acct_name || "")}${tr.mode === "live" ? " · LIVE" : ""} · ${istStr(tr.opened)} → ${istStr(tr.closed)} · ${esc(tr.reason || "")}</div>
        <div class="rp-segs">${segs}</div>
        ${notes ? `<div class="rp3">${notes}</div>` : ""}
      </div>`;
    rpStatus();
  }
  function rpStatus(end){
    const el = $("#rpSt"); if(!el) return;
    const tr = T0(); if(!tr){ el.textContent = ""; return; }
    if(RP.T == null){ el.textContent = "▶ Play shows the trade candle by candle, as it happened."; return; }
    const T = RP.T, tk = tickOf(), bar = RAW[RAW.length - 1];
    const px = bar ? bar.close : null;
    let s = `${istStr(T)} · ${px != null ? fmt(px, tk) : "–"}`;
    if(T < (tr.opened || 0)) s += " · before the entry";
    else if(tr.closed && T >= tr.closed) s += ` · closed: ${rsx(tr.net)}${rr(tr.r)}`;
    else {
      const n = RP.net[T];
      const p = pathAt(T);
      s += ` · open · ${n ? rsx(n[0]) + rr(n[1]) : RP.netBusy ? "…" : "–"}` + (p && (!tr.basis || tr.basis === "self") ? ` · SL ${p[1] != null ? fmt(p[1], tk) : "none"}${p[2] != null ? " · TP " + fmt(p[2], tk) : ""}` : "");
    }
    if(end === "end") s += " · end of the replay";
    el.textContent = s;
  }
  function rpClick(e){
    const el = e.target.closest("[data-a]"); if(!el || el.tagName === "SELECT") return;
    const a = el.dataset.a;
    if(a === "back") post({rp: "close"});
    if(a === "more") $("#rpBar").classList.toggle("open");
    if(a === "ph" && el.dataset.v !== RP.ph) rpReload({ph: el.dataset.v});
    if(a === "code" && el.dataset.v !== RP.code) rpReload({code: el.dataset.v});
    if(a === "play") RP.playing ? rpPause() : rpPlay();
    if(a === "step") rpStep();
    if(a === "bar") rpNextBar();
    if(a === "start"){ if(RP.T == null) rpStart(); else { rpPause(); RP.i = 0; rpSeek(RP.steps[0]); rpBar(); } }
    if(a === "jentry") rpJump("entry");
    if(a === "jexit") rpJump("exit");
    if(a === "stop") rpStop();
  }
  function rpReload(ch){
    const p = new URLSearchParams(location.search);
    for(const [k, v] of Object.entries(ch)) p.set(k, v);
    location.replace("/?" + p.toString());
  }
  document.addEventListener("change", e => { if(e.target.matches && e.target.matches("#rpBar [data-a=speed]")){ RP.speed = +e.target.value; if(RP.playing) rpPlay(); } });
  addEventListener("keydown", e => {
    if(e.target.closest && e.target.closest("input,select,textarea")) return;
    if(e.key === "Escape"){
      const open = ["#tfPick", "#indPick", "#ctPick", "#cfgPick", "#dtbFly", "#drMenu"].some(id => { const x = $(id); return x && !x.classList.contains("hide"); });
      if(!open && !DR.tool && !DR.meas) post({rp: "close"});
      return;
    }
    if(e.key === " " || e.code === "Space"){ e.preventDefault(); RP.playing ? rpPause() : rpPlay(); }
    if(e.key === "ArrowRight" && !e.ctrlKey && !e.metaKey){ e.preventDefault(); e.shiftKey ? rpNextBar() : rpStep(); }
  }, true);

  // ---- Pine on what was known then: other timeframes stop at the replay's time (the forming one built from the chart)
  const pn = pineNeed;
  pineNeed = async function(n){
    const r = await pn.apply(this, arguments);
    if(RP.T == null || !Array.isArray(r)) return r;
    const Tms = RP.T * 1000, out = r.filter(b => b.openTime < Tms);
    const L = out[out.length - 1];
    if(L && L.closeTime >= Tms){
      let s = String(n.ticker || ""); const same = !s || s.split(":").pop().toUpperCase() === cur.s.split(":").pop().toUpperCase();
      const a = L.openTime / 1000 + IST, bs = RAW.filter(b => b.time >= a);
      if(same && bs.length){ L.high = Math.max(...bs.map(b => b.high)); L.low = Math.min(...bs.map(b => b.low)); L.close = bs[bs.length - 1].close; L.volume = bs.reduce((x, b) => x + (b.vol || 0), 0); L.open = bs[0].open; }
      else out.pop();                                         // another contract's forming candle isn't known here
    }
    return out;
  };
  const pb = pineBar;
  pineBar = function(d, i){ const b = pb.apply(this, arguments); if(RP.T != null && i === d.length - 1 && b.closeTime > RP.T * 1000 && !CT.timeBased(ctType())) b.closeTime = Math.max(b.openTime, RP.T * 1000 - 1); return b; };

  // ---- the bar appears once the page is up
  document.addEventListener("DOMContentLoaded", () => {
    document.body.classList.add("notb");
    const fb = $("#bFull"); if(fb) fb.title = "Maximise (F)";
    rpBar();
    const poll = setInterval(() => { if(RP.d || RP.err){ rpBar(); clearInterval(poll); } }, 200);
  });
  window.rpTest = {rowsAt, rpStart, rpPlay, rpPause, rpStep, rpNextBar, rpJump, rpStop, rpSeek, pathAt,
    info: () => ({T: RP.T, i: RP.i, steps: RP.steps.length, raw: RAW.length, disp: DISP.length, last: RAW.length ? RAW[RAW.length - 1] : null, s: cur && cur.s, tf, type: ctType(),
      inds: INDS.map(r => ({t: r.cfg.type, name: r.pine ? r.pine.title : r.cfg.type, err: r.pine ? r.pine.err : null, n: r.pine ? r.pine.n : null, lastT: r.pine && r.pine.times ? r.pine.times[r.pine.n - 1] : null})),
      drawings: DR.items.length, net: Object.keys(RP.net).length, ph: RP.ph, code: RP.code, src: RP.snap ? RP.snap.src : null, playing: RP.playing, loading: !!RP.loading})};
})();
}
