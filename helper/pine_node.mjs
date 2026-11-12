/* The alerts' Pine runner (v0.38.0): Node runs the page's own Pine worker (web/pine_worker.js, PineTS) on the server, so a
   technical alert sees the same values the chart shows, with no page open. Started by helper/chartalerts.py
   (`node helper/pine_node.mjs <web folder>`); one JSON message per line on stdin / stdout; stderr goes to the helper's log.

   The worker file is loaded unchanged: its text gets one extra line (`export {run, tick, sessions}`) and its import of
   PineTS points at the vendored file. Its postMessage calls come here. Chart types come from web/ctype.js (the same
   functions the chart uses), so an alert set on a Heikin-Ashi, Renko or P&F chart runs on those bars.

   A session = one symbol + timeframe + chart type + (optionally) one Pine script with its inputs. Several alerts share one.
   In:  {rid, op:"open", key, spec, raw, tail}      spec: {code?, inputs, props, libs, missing, ticker, tf, info, ctype,
                                                           barSec, draws, pf}; raw: [[t, o, h, l, c, v]] (t: IST-shifted s)
        {rid, op:"bars", key, raw}                   the latest raw bars (the live one, and any new / changed ones)
        {rid, op:"full", key, raw}                   the same, then a full run (a bar's time is up: exact closed values)
        {rid, op:"draws", key, draws}                the session's drawings changed (moved, deleted)
        {op:"close", key}
        {op:"data", id, candles?, error?}            the answer to a {need} (request.security: other timeframes / symbols)
        {rid, op:"ping"}
   Out: {rid, ok, out} / {rid, ok:false, error}; {need:{id, ticker, tf}}
   out: {n, times: [t...] (the last `tail` bars, IST-shifted s), plots: {title: [v...]}, titles: [...], bars: {open, high,
         low, close, volume}, draws: {id: {v|upper|lower|mid: [...]}}, pf: {buy, sell, kind}, acs: {title: [0/1...]},
         calls: [{t, message, freq}], full, newBar, ms, err} */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import readline from 'node:readline';

const WEB = path.resolve(process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'web'));
const require = createRequire(import.meta.url);
const CT = require(path.join(WEB, 'ctype.js'));
const PINETS = pathToFileURL(path.join(WEB, 'vendor', 'pinets', 'pinets.min.browser.es.js')).href;
const IST = 19800;

function send(m) {
  process.stdout.write(JSON.stringify(m, (k, v) => (typeof v === 'number' && !isFinite(v)) ? null : v) + '\n');
}

// ---------------------------------------------------------------- the page's worker, in this process
const waiting = new Map();          // worker run / tick id -> resolve
let wid = 0;
globalThis.self = {
  postMessage(m) {
    if (m && m.need) { send({ need: m.need }); return; }      // request.security: the helper fetches the candles
    const w = m && waiting.get(m.id);
    if (w) { waiting.delete(m.id); w(m); }
  },
};
const PT = await import(PINETS);
// Alert conditions and alert() calls on every bar, not only the live one: a full run (each new bar) then knows the
// closed bar's final answer, which "once per bar close" needs. (PineTS keeps them per run; the page's chart never reads them.)
const run0 = PT.PineTS.prototype.run;
PT.PineTS.prototype.run = function (...a) { try { this.setAlertMode('all'); } catch (_) {} return run0.apply(this, a); };
// Strategies (v0.43.0): a strategy() script's orders are recorded as it places them (strategy.entry / exit / close /
// close_all), bar by bar, without using PineTS's own fills: the app turns them into signals and trades them itself.
// Only while a strategy session runs (REC), so indicators' contexts are untouched.
let REC = false;
const init0 = PT.PineTS.prototype._initializeContext;
PT.PineTS.prototype._initializeContext = function (...a) {
  const r = init0.apply(this, a);
  if (!REC) return r;
  const fix = c => {
    if (!c || typeof c !== 'object') return c;
    // every strategy.entry the script makes is recorded, even while its own (simulated) position is open: the app's stop
    // may have closed the real trade, and TradingView's pyramiding = 0 would hide the next entry in the same direction
    c._propOverrides = { ...(c._propOverrides || {}), pyramiding: 1000000 };
    const log = c.__orders = [];
    const wrapArr = arr => {
      if (!Array.isArray(arr) || arr.__w) return arr;
      Object.defineProperty(arr, '__w', { value: 1 });
      const push = arr.push;
      arr.push = function (...x) {
        for (const o of x) if (o && o.category && log.length < 200000)
          log.push({ bar: o.bar, cat: o.category, id: o.id, dir: o.direction, from: o.from_entry || '', stop: o.stop, limit: o.limit, type: o.type });
        return push.apply(this, x);
      };
      return arr;
    };
    const wrapS = v => {
      if (!v || typeof v !== 'object' || v.__w) return v;
      Object.defineProperty(v, '__w', { value: 1 });
      let arr = wrapArr(v.pending_orders);
      Object.defineProperty(v, 'pending_orders', { configurable: true, enumerable: true, get() { return arr; }, set(x) { arr = wrapArr(x); } });
      return v;
    };
    let val = wrapS(c.strategy);
    Object.defineProperty(c, 'strategy', { configurable: true, enumerable: true, get() { return val; }, set(v) { val = wrapS(v); } });
    return c;
  };
  return r && typeof r.then === 'function' ? r.then(fix) : fix(r);
};
/* the recorded orders as [{t: the bar's time (IST-shifted s), i: bar index in the shown bars, ...}] from bar index `fromI` */
function ordersOf(s, fromI) {
  const W0 = W.sessions.get(s.key), ctx = W0 && W0.ctx, d = s.disp || [], off = s.off || 0, out = [];
  for (const o of (ctx && ctx.__orders) || []) {
    const i = off + (o.bar | 0);
    if (i < fromI || i >= d.length) continue;
    out.push({ t: d[i].time, i, cat: o.cat, id: String(o.id ?? ''), dir: o.dir, from: String(o.from ?? ''), stop: o.stop ?? null, limit: o.limit ?? null, type: o.type });
  }
  return out;
}
let src = readFileSync(path.join(WEB, 'pine_worker.js'), 'utf8');
src = src.replace(/from\s+['"]\/vendor\/pinets\/pinets\.min\.browser\.es\.js['"]/, `from ${JSON.stringify(PINETS)}`);
src += '\nexport { run, tick, sessions };\n';
const W = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const ask = (fn, m, ms) => new Promise(res => {
  const id = 'w' + (++wid);
  const t = setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); res({ id, ok: false, error: 'the script took too long' }); } }, ms);
  waiting.set(id, x => { clearTimeout(t); res(x); });
  fn({ ...m, id });
});

// ---------------------------------------------------------------- bars as the chart shows them
const S = new Map();                // key -> session

function rawBars(rows) { return rows.map(r => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], vol: r[5] || 0 })); }

function display(s) {
  const c = s.spec.ctype || {}, t = c.type || 'candles';
  if (s.box == null && s.raw.length) {
    const o = c.opts || {};
    if (t === 'renko') s.box = CT.size(s.raw, o.renkoMode, o.renkoBox, o.renkoAtr, c.tick);
    if (t === 'range') s.box = CT.size(s.raw, o.rangeMode, o.rangeSize, o.rangeAtr, c.tick);
    if (t === 'pf') s.box = CT.size(s.raw, o.pfBox ? 'fixed' : 'atr', o.pfBox || null, o.pfAtr, c.tick);
  }
  return CT.transform(s.raw, t, { ...(c.opts || {}), box: s.box, range: s.box });
}

/* the chart's bar i as Pine sees it (web/pine.js pineBar) */
function pineBar(s, d, i) {
  const b = d[i], ms = (b.time - IST) * 1000, t = (s.spec.ctype || {}).type || 'candles';
  let closeTime = ms + s.spec.barSec * 1000 - 1;
  if (!CT.timeBased(t)) closeTime = i + 1 < d.length ? (d[i + 1].time - IST) * 1000 - 1 : Math.max(closeTime, Date.now());
  const close = t === 'pf' && (s.spec.ctype || {}).pfInd !== 'last' ? (b.high + b.low) / 2 : b.close;
  return { open: b.open, high: b.high, low: b.low, close, volume: b.vol || 0, openTime: ms, closeTime };
}

// ---------------------------------------------------------------- drawings on these bars (web/draw.js t2L, snapped)
function barSecOf(s) { return s.spec.drawSec || s.spec.barSec || 60; }
function idxAt(d, t) {               // the last bar at or before t (-1: before the first)
  let lo = 0, hi = d.length - 1; if (hi < 0 || t < d[0].time) return -1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (d[m].time <= t) lo = m; else hi = m - 1; }
  return lo;
}
function t2L(s, d, t) {
  const n = d.length; if (!n || t == null) return null;
  const bs = barSecOf(s), i = idxAt(d, t);
  if (i < 0) return Math.floor((t - d[0].time) / bs + 1e-9);
  if (i === n - 1) return n - 1 + Math.floor((t - d[n - 1].time) / bs + 1e-9);
  return i;
}
function lineAt(La, pa, Lb, pb, L, el, er) {
  if (La === Lb) return null;
  if (La > Lb) { [La, Lb] = [Lb, La]; [pa, pb] = [pb, pa]; [el, er] = [er, el]; }
  if (L < La && !el) return null;
  if (L > Lb && !er) return null;
  return pa + (pb - pa) * (L - La) / (Lb - La);
}
/* each drawing's value(s) on the last `tail` bars */
function drawVals(s, d, tail) {
  const out = {}, n = d.length, from = Math.max(0, n - tail);
  for (const dr of s.spec.draws || []) {
    const P = dr.pts || [], st = dr.st || {}, v = {};
    const L = P.map(p => t2L(s, d, p.t));
    const put = (k, f) => { v[k] = []; for (let i = from; i < n; i++) { const x = f(i); v[k].push(x == null || !isFinite(x) ? null : x); } };
    if (!P.length) continue;
    if (dr.type === 'hline') put('v', () => P[0].p);
    else if (dr.type === 'hray') put('v', i => i >= L[0] ? P[0].p : null);
    else if (['trend', 'ray', 'extl'].includes(dr.type) && P.length >= 2) {
      // each type's own defaults (web/draw.js DT), then what the drawing's settings say
      const def = { trend: [false, false], ray: [false, true], extl: [true, true] }[dr.type];
      const el = st.el != null ? !!st.el : def[0], er = st.er != null ? !!st.er : def[1];
      put('v', i => lineAt(L[0], P[0].p, L[1], P[1].p, i, el, er));
    } else if (dr.type === 'channel' && P.length >= 3) {
      const base = lineAt(L[0], P[0].p, L[1], P[1].p, L[2], true, true), dy = base == null ? 0 : P[2].p - base;
      const a = i => lineAt(L[0], P[0].p, L[1], P[1].p, i, !!st.el, !!st.er);
      put('upper', i => { const x = a(i); return x == null ? null : Math.max(x, x + dy); });
      put('lower', i => { const x = a(i); return x == null ? null : Math.min(x, x + dy); });
      put('mid', i => { const x = a(i); return x == null ? null : x + dy / 2; });
    } else if (dr.type === 'rect' && P.length >= 2) {
      const lo = Math.min(L[0], L[1]), hi = Math.max(L[0], L[1]);
      put('upper', i => i >= lo && i <= hi ? Math.max(P[0].p, P[1].p) : null);
      put('lower', i => i >= lo && i <= hi ? Math.min(P[0].p, P[1].p) : null);
    }
    out[dr.id] = v;
  }
  return out;
}

/* P&F signals (the P&F toolkit's, web/ctype.js pfTools) on the last `tail` columns: 1 / 0 per column */
function pfVals(s, d, tail) {
  if ((s.spec.ctype || {}).type !== 'pf' || !s.spec.pf || !s.box) return null;
  const o = (s.spec.ctype || {}).opts || {};
  const res = CT.pfTools(d, s.box, o.pfRev || 3, {});
  const n = d.length, from = Math.max(0, n - tail), z = () => new Array(n - from).fill(0);
  const out = { buy: z(), sell: z(), DTB: z(), TTB: z(), DBS: z(), TBS: z() };
  for (const g of res.signals || []) {
    if (g.col < from) continue;
    const k = g.col - from;
    out[g.dir > 0 ? 'buy' : 'sell'][k] = 1;
    if (out[g.kind]) out[g.kind][k] = 1;
  }
  return out;
}

// ---------------------------------------------------------------- one session's numbers
function tailOf(arr, n) { return arr.length > n ? arr.slice(arr.length - n) : arr.slice(); }

function collect(s, res, full) {
  const d = s.disp, n = d.length, tail = s.tail, from = Math.max(0, n - tail);
  const times = d.slice(from).map(b => b.time);
  const out = { n, times, plots: {}, titles: s.titles || [], bars: {}, full: !!full, newBar: !!(res && res.newBar), ms: res && res.ms };
  for (const k of ['open', 'high', 'low', 'close']) out.bars[k] = d.slice(from).map(b => b[k]);
  out.bars.volume = d.slice(from).map(b => b.vol || 0);
  if (res && res.ok && res.plots) {
    const byT = new Map();
    for (const [title, p] of Object.entries(res.plots)) {
      const m = new Map((p.data || []).map(x => [Math.round(x[0] / 1000) + IST, x[1]]));
      byT.set(title, m);
    }
    if (full) s.titles = out.titles = [...byT.keys()];
    for (const [title, m] of byT) out.plots[title] = times.map(t => { const v = m.get(t); return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : null; });
  }
  if (res && !res.ok && !res.stale) out.err = res.error;
  out.draws = drawVals(s, d, tail);
  out.pf = pfVals(s, d, tail);
  // alertcondition() truths and alert() calls (PineTS's ctx.alerts, all bars: see the patch above)
  const W0 = W.sessions.get(s.key), ctx = W0 && W0.ctx;
  const evs = ctx && Array.isArray(ctx.alerts) ? ctx.alerts.splice(0) : [];
  if (full) s.ac = new Map();
  const calls = [];
  const t0 = times.length > 1 ? times[times.length - 2] : times[0];
  for (const e of evs) {
    const bt = Math.round((e.time || 0) / 1000) + IST;
    if (e.type === 'alertcondition') {
      const k = e.title || e.id;
      if (!s.ac.has(k)) s.ac.set(k, new Set());
      s.ac.get(k).add(bt);
      if (!s.acMsg) s.acMsg = {};
      s.acMsg[k] = e.message || '';
    } else if (e.type === 'alert' && bt >= t0) calls.push({ t: bt, message: String(e.message || ''), freq: e.freq || 'once_per_bar' });
  }
  out.acs = {};
  for (const [k, set] of s.ac || []) out.acs[k] = times.map(t => set.has(t) ? 1 : 0);
  out.acMsg = s.acMsg || {};
  out.calls = calls;
  if (s.spec.strategy && full) out.orders = ordersOf(s, from);         // (only a full run's are exact: tails re-run the live bar)
  return out;
}

async function fullRun(s) {
  s.disp = display(s);
  if (!s.spec.code) return collect(s, null, true);
  const candles = [];
  const d = s.disp, want = s.spec.bars || 1500;
  let off = Math.max(0, d.length - want);
  if (s.spec.strategy && d.length) {
    // a strategy runs from a fixed first bar (moved on only every `want` bars), so bar_index and the script's state
    // don't shift by one bar each time a bar closes, as on TradingView (whose bar_index counts from a fixed first bar)
    if (s.anchorT != null) { const i = idxAt(d, s.anchorT); if (i >= 0 && d[i].time === s.anchorT && d.length - i <= 2 * want) off = i; }
    s.anchorT = d[off].time;
  }
  s.off = off;
  for (let i = off; i < d.length; i++) candles.push(pineBar(s, d, i));
  if (!candles.length) return collect(s, null, true);
  const sp = s.spec;
  REC = !!sp.strategy;
  let res;
  try {
    res = await ask(W.run, { sid: s.key, code: sp.code, inputs: sp.inputs || {}, props: sp.props, libs: sp.libs || {}, missing: sp.missing || [],
      candles, ticker: sp.ticker, tf: sp.tf, info: sp.info }, 120000);
  } finally { REC = false; }
  s.lastFull = Date.now(); s.fullMs = res.ms || 0;
  s.lastErr = res.ok ? '' : res.error;
  return collect(s, res, true);
}

function merge(s, rows) {
  for (const b of rawBars(rows)) {
    const L = s.raw[s.raw.length - 1];
    if (!L || b.time > L.time) s.raw.push(b);
    else if (b.time === L.time) Object.assign(L, b);
    else { const i = s.raw.findIndex(x => x.time === b.time); if (i >= 0) Object.assign(s.raw[i], b); }
  }
  if (s.raw.length > (s.spec.keep || 6000)) s.raw.splice(0, s.raw.length - (s.spec.keep || 6000));
}

async function onBars(s, rows) {
  merge(s, rows);                    // the latest raw bars: replace the live one / append new ones
  const old = s.disp || [];
  const d = display(s);
  const lastOld = old.length ? old[old.length - 1].time : -Infinity;
  const newBar = d.length && d[d.length - 1].time > lastOld;
  // the bars that changed since the last update: from the old live bar onwards
  const changed = [];
  for (let i = d.length - 1; i >= 0 && d[i].time >= lastOld; i--) changed.unshift(i);
  // a whole earlier bar changed (a Renko brick redrawn, a history fix): run in full
  const sameStart = old.length && d.length && old[0].time === d[0].time;
  s.disp = d;
  if (!s.spec.code) return { ...collect(s, null, false), newBar };
  if (newBar || !sameStart || !W.sessions.get(s.key) || !changed.length) {
    const out = await fullRun(s); out.newBar = newBar; return out;
  }
  const bars = changed.map(i => pineBar(s, d, i));
  const res = await ask(W.tick, { sid: s.key, bars }, 30000);
  if (!res.ok) { const out = await fullRun(s); out.newBar = newBar; return out; }
  return collect(s, res, false);
}

// ---------------------------------------------------------------- the message loop (one request at a time)
const queue = [];
let busy = false;
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const m = queue.shift();
    const t0 = Date.now();
    try {
      let out;
      if (m.op === 'ping') out = { sessions: S.size, mem: Math.round(process.memoryUsage().rss / 1048576) };
      else if (m.op === 'open') {
        const s = { key: m.key, spec: m.spec || {}, raw: rawBars(m.raw || []), tail: Math.max(3, Math.min(300, m.tail || 3)), box: null };
        if (S.has(m.key)) W.sessions.delete(m.key);
        S.set(m.key, s);
        out = await fullRun(s);
      } else if (m.op === 'bars') {
        const s = S.get(m.key);
        if (!s) throw Object.assign(new Error('no such session'), { gone: true });
        out = await onBars(s, m.raw || []);
      } else if (m.op === 'full') {                                   // a bar's time is up: exact values, in full
        const s = S.get(m.key);
        if (!s) throw Object.assign(new Error('no such session'), { gone: true });
        merge(s, m.raw || []);
        const before = s.disp && s.disp.length ? s.disp[s.disp.length - 1].time : -Infinity;
        out = await fullRun(s);
        out.newBar = !!(s.disp.length && s.disp[s.disp.length - 1].time > before);
      } else if (m.op === 'test') {                                   // the strategy tester: one run over the history, then gone
        const key = 'T|' + (m.rid || 0);
        const s = { key, spec: { ...(m.spec || {}), strategy: true, bars: (m.spec && m.spec.bars) || 20000 }, raw: rawBars(m.raw || []), tail: 3, box: null };
        try {
          await fullRun(s);
          const d = s.disp;
          const W0 = W.sessions.get(key), ctx = W0 && W0.ctx;
          const plot = {};
          if (m.plot && W0) {                                          // a Pine line for the stop, its value on every bar
            const p = (ctx.plots || {})[m.plot];
            const byT = new Map(((p && p.data) || []).map(x => [Math.round(x.time / 1000) + IST, x.value]));
            plot.v = d.map(b => { const v = byT.get(b.time); return typeof v === 'number' && isFinite(v) ? v : null; });
          }
          const err = !W0 ? (s.lastErr || 'the script did not run') : null;
          out = { n: d.length, bars: d.map(b => [b.time, b.open, b.high, b.low, b.close, b.vol || 0]), orders: ordersOf(s, 0),
                  plot: plot.v || null, titles: Object.keys((ctx && ctx.plots) || {}).filter(k => !/^__\w+__$/.test(k)), err };
        } finally { S.delete(key); W.sessions.delete(key); }
      } else if (m.op === 'draws') {
        const s = S.get(m.key);
        if (!s) throw Object.assign(new Error('no such session'), { gone: true });
        s.spec.draws = m.draws || [];
        out = { ...collect(s, null, false), plotsKept: true };
      } else throw new Error('unknown op ' + m.op);
      if (out && typeof out === 'object') out.took = Date.now() - t0;
      send({ rid: m.rid, ok: true, out });
    } catch (e) {
      send({ rid: m.rid, ok: false, error: String((e && e.message) || e), gone: !!(e && e.gone) });
    }
  }
  busy = false;
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', line => {
  let m; try { m = JSON.parse(line); } catch (_) { return; }
  if (m.op === 'data') { self.onmessage({ data: { data: m } }); return; }       // request.security's candles
  if (m.op === 'close') { S.delete(m.key); W.sessions.delete(m.key); return; }
  queue.push(m); pump();
});
rl.on('close', () => process.exit(0));
send({ ready: true, node: process.version });
