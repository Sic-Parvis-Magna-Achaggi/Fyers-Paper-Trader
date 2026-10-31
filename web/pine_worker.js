/* Runs Pine Script with PineTS (AGPL-3.0, vendored in /vendor/pinets) off the page's main thread.

   Each indicator on the chart has a session here: the full history runs once ("run"), then every live price only
   re-runs the live bar ("tick", PineTS updateTail - TradingView's way). A new bar is appended the same way and
   the page then asks for one full re-run in the background, so drawings made on the old last bar are rebuilt
   exactly (PineTS rolls back variables on the live bar, but not drawings).

   In:  {id, op:"run", sid?, code, inputs, props?, libs?, missing?, candles, ticker, tf, info}   (no sid: a one-off check for the editor)
        {id, op:"tick", sid, bars:[candle...]}                              (the live bar, and a new one if any)
        {op:"drop", sid}
   Out: {id, ok, ms, indicator, inputs, mtf, plots, drawings, times, logs, warn?, newBar?} or {id, ok:false, error, line, col}
        {id, ok:false, stale:true}  when a tick arrives for a session that isn't here (the page then runs in full)
   Other timeframes / symbols (request.security, and the indicator's own `timeframe =`) are asked of the page:
        {need:{id, ticker, tf}} -> {data:{id, candles, error?}}
   Libraries (`import user/name/version`) come with the run as {path: source} (libs), found by the page (pine.js). */
import { PineTS, Indicator } from '/vendor/pinets/pinets.min.browser.es.js';

// drawings: __lines__, __labels__, __boxes__, __linefills__, __polylines__, __tables__, and the same with
// _overlay (force_overlay = true: drawn on the candles even when the script has its own pane)
const DRAW = k => /^__\w+__$/.test(k);
const FULL_OPTS = /shape|char|arrow/;          // these styles can change shape / place / text bar by bar
const waiting = {};
const sessions = new Map();                    // sid -> {pine, ctx, candles, meta, logs} (or {mtf:true, m} for a script on its own timeframe)
let ask = 0;

function lastValue(p) { const d = (p && p.data) || []; return d.length ? d[d.length - 1].value || [] : []; }
function alive(list) { return (Array.isArray(list) ? list : []).filter(x => x && !x._deleted); }
const normTf = t => String(t || '').replace(/^1(?=[DWM]$)/, '').toUpperCase();
const bare = t => String(t || '').split(':').pop().toUpperCase();
/* a Pine timeframe in seconds ("5" 300, "60" 3600, "D" 86400, "3D", "W", "M", "15S") */
function tfSec(t) {
  const m = /^(\d*)([SDWM]?)$/i.exec(String(t || '').trim()); if (!m) return null;
  const n = +(m[1] || 1), u = (m[2] || '').toUpperCase();
  return n * (u === 'S' ? 1 : u === 'D' ? 86400 : u === 'W' ? 604800 : u === 'M' ? 2592000 : 60);
}
const TF_NAME = t => { const s = tfSec(t); if (!s) return String(t);
  return s % 2592000 === 0 ? (s / 2592000) + 'M' : s % 604800 === 0 ? (s / 604800) + 'W' : s % 86400 === 0 ? (s / 86400) + 'D' : s % 3600 === 0 ? (s / 3600) + 'h' : s % 60 === 0 ? (s / 60) + 'm' : s + 's'; };

/* other-timeframe candles from the page (the helper's saved candles). A Fyers request can queue behind others,
   so this waits up to 90 s; a failure comes back with its reason, which the run reports. */
function fromPage(ticker, tf, errs) {
  return new Promise(res => {
    const id = ++ask;
    waiting[id] = d => { if (d.error && errs) errs.push(d.error); res(d.candles || []); };
    self.postMessage({ need: { id, ticker, tf } });
    setTimeout(() => { if (waiting[id]) { delete waiting[id]; if (errs) errs.push(`${TF_NAME(tf)} candles took too long to arrive`); res([]); } }, 90000);
  });
}

/* updateTail leaves the superseded live-bar values in the plot arrays: keep the latest per bar */
function dedupe(ctx) {
  for (const [k, pl] of Object.entries(ctx.plots || {})) {
    if (DRAW(k) || !pl.data) continue;
    const d = pl.data, last = new Map();
    d.forEach((x, i) => last.set(x.time, i));
    if (last.size === d.length) continue;
    const keep = d.filter((x, i) => last.get(x.time) === i);
    d.length = 0; d.push(...keep);
  }
}

function output(id, ctx, meta, logs, t0, candles, extra, plotsIn) {
  const plots = {}, drawings = {};
  for (const [k, p] of Object.entries(plotsIn || ctx.plots || {})) {
    if (DRAW(k)) { drawings[k] = alive(lastValue(p)); continue; }
    const full = FULL_OPTS.test((p.options && p.options.style) || '');
    plots[k] = { options: p.options || {}, data: (p.data || []).map(d => full
      ? [d.time, d.value, d.options && d.options.color !== undefined ? d.options.color : undefined, d.options || null]
      : [d.time, d.value, d.options && d.options.color !== undefined ? d.options.color : undefined]) };
  }
  // a linefill whose lines are gone isn't drawn
  for (const k of ['__linefills__', '__linefills_overlay__']) if (drawings[k]) drawings[k] = drawings[k].filter(f => f.line1 && f.line2 && !f.line1._deleted && !f.line2._deleted);
  let indicator = {};
  try { indicator = JSON.parse(JSON.stringify(ctx.indicator || {})); } catch (_) {}
  const out = { id, ok: true, ms: Math.round(performance.now() - t0), bars: candles.length, times: candles.map(c => c.openTime),
    indicator, inputs: meta, plots, drawings, logs, ...(extra || {}) };
  return JSON.parse(JSON.stringify(out, (k, v) => (typeof v === 'number' && !isFinite(v)) ? null : v));
}

/* a script on a higher timeframe than the chart (indicator(timeframe = ...)): its values land on the chart bar where
   each higher-timeframe bar closes; with timeframe_gaps = false they also fill the bars in between (the previous
   value until the next close), as on TradingView. The live higher-timeframe bar shows on the latest chart bar. */
function mapToChart(ctx, htf, candles, gaps) {
  const n = candles.length, at = new Array(n), last = new Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = candles[k].openTime;
    while (j + 1 < htf.length && htf[j + 1].openTime <= t) j++;
    at[k] = htf.length && htf[0].openTime <= t ? j : -1;
  }
  for (let k = 0; k < n; k++) last[k] = at[k] >= 0 && (k === n - 1 || at[k + 1] !== at[k]);
  const closeIdx = new Map();                    // higher-timeframe bar -> the chart bar where it closes
  for (let k = 0; k < n; k++) if (last[k]) closeIdx.set(at[k], k);
  const plots = {};
  for (const [name, p] of Object.entries(ctx.plots || {})) {
    if (DRAW(name)) {                            // drawings: bar indexes move to the chart bar where that bar closes
      const fix = x => { if (x == null || typeof x !== 'number') return x; const k = closeIdx.get(Math.round(x)); return k == null ? (x > htf.length ? n - 1 + (x - htf.length) : x) : k; };
      const list = alive(lastValue(p)).map(o => {
        if (!o || typeof o !== 'object') return o;
        const c = { ...o }, bi = (c.xloc || 'bi') !== 'bt';
        if (bi) for (const f of ['x', 'x1', 'x2', 'left', 'right']) if (f in c) c[f] = fix(c[f]);
        if (Array.isArray(c.points)) c.points = c.points.map(q => q && q.index != null ? { ...q, index: fix(q.index) } : q);
        return c;
      });
      plots[name] = { ...p, data: [{ time: candles.length ? candles[n - 1].openTime : 0, value: list }] };
      continue;
    }
    const byT = new Map((p.data || []).map(d => [d.time, d]));
    const val = j => j < 0 || j >= htf.length ? null : byT.get(htf[j].openTime) || null;
    const data = [];
    for (let k = 0; k < n; k++) {
      const src = last[k] ? val(at[k]) : gaps ? null : val(at[k] - 1);
      if (src) data.push({ ...src, time: candles[k].openTime });
    }
    plots[name] = { ...p, data };
  }
  return plots;
}

async function run(m) {
  const { id, sid, code, inputs, candles, ticker, tf, info } = m;
  const t0 = performance.now();
  let meta = [], mtf = null;
  const logs = [], errs = [];
  const log0 = console.log;
  if (sid) sessions.delete(sid);
  const libs = m.libs || {};
  const resolver = async path => (path in libs ? libs[path] : null);
  try {
    if (m.missing && m.missing.length) {
      const one = m.missing.length === 1;
      throw new Error(`The script imports ${m.missing.map(p => `"${p}"`).join(', ')}, which ${one ? "isn't" : "aren't"} in your library. `
        + `Open ${one ? 'that library' : 'each library'} on TradingView, copy its source (it starts with library("…")), paste it into a new script in the Pine Editor and Save; then this script finds it.`);
    }
    const ind = new Indicator(code);
    await ind.resolveImports(resolver);
    try { meta = ind.getInputsMeta() || []; } catch (_) { meta = []; }
    for (const [k, v] of Object.entries(inputs || {})) ind.input[k] = v;
    // the indicator's own timeframe (indicator(timeframe = ..., timeframe_gaps = ...)) and your choice in Settings
    let declared = false, dTf = '', dGaps = true;
    try { ind.getPropsMeta(); declared = 'timeframe' in (ind._sourcePropArgs || {}); dTf = String(ind.prop.timeframe || ''); dGaps = ind.prop.timeframe_gaps !== false; } catch (_) {}
    const P = m.props || {};
    const useTf = declared && P.timeframe != null ? String(P.timeframe) : dTf;
    const gaps = declared && P.timeframe_gaps != null ? !!P.timeframe_gaps : dGaps;
    mtf = { declared, tf: dTf, gaps: dGaps, used: '' };
    const data = candles.slice();                // the session's own copy: ticks change its last bar / add bars
    let runTf = tf, htf = null;
    if (useTf && normTf(useTf) !== normTf(tf)) {
      const a = tfSec(useTf), b = tfSec(tf);
      if (!a) throw new Error(`The indicator's timeframe "${useTf}" isn't one the app knows.`);
      if (b && a < b) throw new Error(`The indicator's timeframe (${TF_NAME(useTf)}) is lower than the chart's (${TF_NAME(tf)}). Pick a higher one in Settings › Inputs › Timeframe, or "Chart".`);
      htf = await fromPage(ticker, useTf, errs);
      if (!htf.length) throw new Error(errs[0] || `No ${TF_NAME(useTf)} candles for this contract.`);
      runTf = useTf; mtf.used = useTf;
    }
    const main = htf || data;
    const provider = {
      async getMarketData(tk, t, limit, sDate) {
        if (normTf(t) === normTf(runTf) && bare(tk) === bare(ticker)) return sDate ? main.filter(c => c.openTime >= sDate) : main;
        return await fromPage(tk, t, errs);
      },
      async getSymbolInfo() { return info || { ticker: bare(ticker), tickerid: ticker, timezone: 'Asia/Kolkata' }; },
      configure() {},
    };
    console.log = (...a) => { if (logs.length < 200) logs.push(a.map(String).join(' ')); };   // log.info() etc. -> the editor's console
    const pine = new PineTS(provider, ticker || 'X', runTf || '5');
    pine.setImportResolver(resolver);
    const ctx = await pine.run(ind);
    console.log = log0;
    const warn = errs.length ? `Some other-timeframe candles didn't load (${errs[0]}); values that need them are missing. Retrying shortly.` : undefined;
    if (htf) {
      if (sid) sessions.set(sid, { mtf: true, m: { ...m, candles: data }, candles: data, meta, busy: false });
      self.postMessage(output(id, ctx, meta, logs, t0, data, { mtf, warn }, mapToChart(ctx, htf, data, gaps)));
      return;
    }
    if (sid) sessions.set(sid, { pine, ctx, candles: data, meta, logs, busy: false, mtf: false });
    self.postMessage(output(id, ctx, meta, logs, t0, data, { mtf, warn }));
  } catch (err) {
    console.log = log0;
    let msg = String((err && err.message) || err);
    if (errs.length) msg = `Other-timeframe candles didn't load (${errs[0]}), so the script couldn't calculate. It said: ` + msg;
    const mm = / at (\d+):(\d+)/.exec(msg);
    self.postMessage({ id, ok: false, error: msg.replace(/^Failed to transpile Pine Script version \d+: /, ''), line: mm ? +mm[1] : null, col: mm ? +mm[2] : null,
      inputs: meta, mtf, logs, needFailed: errs.length > 0 });
  }
}

async function tick(m) {
  const { id, sid, bars } = m;
  const S = sessions.get(sid);
  if (!S) { self.postMessage({ id, ok: false, stale: true }); return; }
  const t0 = performance.now();
  let newBar = false;
  for (const b of bars || []) {
    const L = S.candles[S.candles.length - 1];
    if (!L || b.openTime > L.openTime) { S.candles.push({ ...b }); newBar = true; }
    else if (b.openTime === L.openTime) Object.assign(L, b);
    else {                                         // an older bar changed (history reloaded): run in full
      const i = S.candles.findIndex(c => c.openTime === b.openTime);
      if (i < 0) { sessions.delete(sid); self.postMessage({ id, ok: false, stale: true }); return; }
      Object.assign(S.candles[i], b);
    }
  }
  if (S.mtf) {                                     // on its own timeframe: run again (few bars; the page paces it)
    await run({ ...S.m, id, sid, candles: S.candles.slice() });
    return;
  }
  try {
    await S.pine.updateTail(S.ctx);
    dedupe(S.ctx);
    self.postMessage(output(id, S.ctx, S.meta, S.logs, t0, S.candles, { newBar, tail: true }));
  } catch (err) {
    sessions.delete(sid);
    self.postMessage({ id, ok: false, stale: true, error: String((err && err.message) || err) });
  }
}

self.onmessage = async (e) => {
  const m = e.data || {};
  if (m.data) { const w = waiting[m.data.id]; if (w) { delete waiting[m.data.id]; w(m.data); } return; }
  if (m.op === 'drop') { sessions.delete(m.sid); return; }
  if (m.op === 'tick') return tick(m);
  return run(m);
};
