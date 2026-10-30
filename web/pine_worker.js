/* Runs Pine Script with PineTS (AGPL-3.0, vendored in /vendor/pinets) off the page's main thread.

   Each indicator on the chart has a session here: the full history runs once ("run"), then every live price only
   re-runs the live bar ("tick", PineTS updateTail - TradingView's way). A new bar is appended the same way and
   the page then asks for one full re-run in the background, so drawings made on the old last bar are rebuilt
   exactly (PineTS rolls back variables on the live bar, but not drawings).

   In:  {id, op:"run", sid?, code, inputs, candles, ticker, tf, info}      (no sid: a one-off check for the editor)
        {id, op:"tick", sid, bars:[candle...]}                              (the live bar, and a new one if any)
        {op:"drop", sid}
   Out: {id, ok, ms, indicator, inputs, plots, drawings, times, logs, newBar?} or {id, ok:false, error, line, col}
        {id, ok:false, stale:true}  when a tick arrives for a session that isn't here (the page then runs in full)
   Other timeframes / symbols (request.security) are asked of the page: {need:{id, ticker, tf}} -> {data:{id, candles}} */
import { PineTS, Indicator } from '/vendor/pinets/pinets.min.browser.es.js';

// drawings: __lines__, __labels__, __boxes__, __linefills__, __polylines__, __tables__, and the same with
// _overlay (force_overlay = true: drawn on the candles even when the script has its own pane)
const DRAW = k => /^__\w+__$/.test(k);
const FULL_OPTS = /shape|char|arrow/;          // these styles can change shape / place / text bar by bar
const waiting = {};
const sessions = new Map();                    // sid -> {pine, ctx, candles, meta, logs}
let ask = 0;

function lastValue(p) { const d = (p && p.data) || []; return d.length ? d[d.length - 1].value || [] : []; }
function alive(list) { return (Array.isArray(list) ? list : []).filter(x => x && !x._deleted); }
const normTf = t => String(t || '').replace(/^1(?=[DWM]$)/, '').toUpperCase();
const bare = t => String(t || '').split(':').pop().toUpperCase();

function fromPage(ticker, tf) {
  return new Promise(res => { const id = ++ask; waiting[id] = res; self.postMessage({ need: { id, ticker, tf } }); setTimeout(() => { if (waiting[id]) { delete waiting[id]; res([]); } }, 15000); });
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

function output(id, ctx, meta, logs, t0, candles, extra) {
  const plots = {}, drawings = {};
  for (const [k, p] of Object.entries(ctx.plots || {})) {
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

async function run(m) {
  const { id, sid, code, inputs, candles, ticker, tf, info } = m;
  const t0 = performance.now();
  let meta = [];
  const logs = [];
  const log0 = console.log;
  if (sid) sessions.delete(sid);
  try {
    const ind = new Indicator(code);
    try { meta = ind.getInputsMeta() || []; } catch (_) { meta = []; }
    for (const [k, v] of Object.entries(inputs || {})) ind.input[k] = v;
    const data = candles.slice();                // the session's own copy: ticks change its last bar / add bars
    const provider = {
      async getMarketData(tk, t, limit, sDate) {
        if (normTf(t) === normTf(tf) && bare(tk) === bare(ticker)) return sDate ? data.filter(c => c.openTime >= sDate) : data;
        return await fromPage(tk, t);
      },
      async getSymbolInfo() { return info || { ticker: bare(ticker), tickerid: ticker, timezone: 'Asia/Kolkata' }; },
      configure() {},
    };
    console.log = (...a) => { if (logs.length < 200) logs.push(a.map(String).join(' ')); };   // log.info() etc. -> the editor's console
    const pine = new PineTS(provider, ticker || 'X', tf || '5');
    const ctx = await pine.run(ind);
    console.log = log0;
    if (sid) sessions.set(sid, { pine, ctx, candles: data, meta, logs, busy: false });
    self.postMessage(output(id, ctx, meta, logs, t0, data));
  } catch (err) {
    console.log = log0;
    const msg = String((err && err.message) || err);
    const mm = / at (\d+):(\d+)/.exec(msg);
    self.postMessage({ id, ok: false, error: msg.replace(/^Failed to transpile Pine Script version \d+: /, ''), line: mm ? +mm[1] : null, col: mm ? +mm[2] : null, inputs: meta, logs });
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
  if (m.data) { const w = waiting[m.data.id]; if (w) { delete waiting[m.data.id]; w(m.data.candles || []); } return; }
  if (m.op === 'drop') { sessions.delete(m.sid); return; }
  if (m.op === 'tick') return tick(m);
  return run(m);
};
