/* Runs Pine Script with PineTS (AGPL-3.0, vendored in /vendor/pinets) off the page's main thread.
   In:  {id, code, inputs:{title: value}, candles:[{open,high,low,close,volume,openTime,closeTime}], ticker, tf, info}
   Out: {id, ok, ms, indicator, inputs (meta), plots, drawings, logs} or {id, ok:false, error, line, col, inputs}
   Other timeframes / symbols (request.security) are asked of the page: {need:{id, ticker, tf}} -> {data:{id, candles}} */
import { PineTS, Indicator } from '/vendor/pinets/pinets.min.browser.es.js';

const DRAW = new Set(['__labels__', '__lines__', '__boxes__', '__linefills__', '__polylines__', '__tables__']);
const FULL_OPTS = /shape|char|arrow/;          // these styles can change shape / place / text bar by bar
const waiting = {};
let ask = 0;

function lastValue(p) { const d = (p && p.data) || []; return d.length ? d[d.length - 1].value || [] : []; }
function alive(list) { return (Array.isArray(list) ? list : []).filter(x => x && !x._deleted); }
const normTf = t => String(t || '').replace(/^1(?=[DWM]$)/, '').toUpperCase();
const bare = t => String(t || '').split(':').pop().toUpperCase();

function fromPage(ticker, tf) {
  return new Promise(res => { const id = ++ask; waiting[id] = res; self.postMessage({ need: { id, ticker, tf } }); setTimeout(() => { if (waiting[id]) { delete waiting[id]; res([]); } }, 15000); });
}

self.onmessage = async (e) => {
  if (e.data && e.data.data) { const w = waiting[e.data.data.id]; if (w) { delete waiting[e.data.data.id]; w(e.data.data.candles || []); } return; }
  const { id, code, inputs, candles, ticker, tf, info } = e.data;
  const t0 = performance.now();
  let meta = [];
  const logs = [];
  const log0 = console.log;
  try {
    const ind = new Indicator(code);
    try { meta = ind.getInputsMeta() || []; } catch (_) { meta = []; }
    for (const [k, v] of Object.entries(inputs || {})) ind.input[k] = v;
    const provider = {
      async getMarketData(tk, t) { return (normTf(t) === normTf(tf) && bare(tk) === bare(ticker)) ? candles : await fromPage(tk, t); },
      async getSymbolInfo() { return info || { ticker: bare(ticker), tickerid: ticker, timezone: 'Asia/Kolkata' }; },
      configure() {},
    };
    console.log = (...a) => { if (logs.length < 200) logs.push(a.map(String).join(' ')); };   // log.info() etc. -> the editor's console
    const ctx = await new PineTS(provider, ticker || 'X', tf || '5').run(ind);
    console.log = log0;
    const plots = {}, drawings = {};
    for (const [k, p] of Object.entries(ctx.plots || {})) {
      if (DRAW.has(k)) { drawings[k] = alive(lastValue(p)); continue; }
      const full = FULL_OPTS.test((p.options && p.options.style) || '');
      plots[k] = { options: p.options || {}, data: (p.data || []).map(d => full
        ? [d.time, d.value, d.options && d.options.color !== undefined ? d.options.color : undefined, d.options || null]
        : [d.time, d.value, d.options && d.options.color !== undefined ? d.options.color : undefined]) };
    }
    // a linefill whose lines are gone isn't drawn
    if (drawings.__linefills__) drawings.__linefills__ = drawings.__linefills__.filter(f => f.line1 && f.line2 && !f.line1._deleted && !f.line2._deleted);
    let indicator = {};
    try { indicator = JSON.parse(JSON.stringify(ctx.indicator || {})); } catch (_) {}
    const out = { id, ok: true, ms: Math.round(performance.now() - t0), bars: candles.length, indicator, inputs: meta, plots, drawings, logs };
    self.postMessage(JSON.parse(JSON.stringify(out, (k, v) => (typeof v === 'number' && !isFinite(v)) ? null : v)));
  } catch (err) {
    console.log = log0;
    const msg = String((err && err.message) || err);
    const m = / at (\d+):(\d+)/.exec(msg);
    self.postMessage({ id, ok: false, error: msg.replace(/^Failed to transpile Pine Script version \d+: /, ''), line: m ? +m[1] : null, col: m ? +m[2] : null, inputs: meta, logs });
  }
};
