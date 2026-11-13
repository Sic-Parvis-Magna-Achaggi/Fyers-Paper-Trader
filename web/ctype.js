/* Chart types: turn the real (time-based) candles into what the chart shows. Pure functions, no chart code, so
   tests/ctype_test.js can check them in Node.

   Input bars: {time, open, high, low, close, vol} (time in seconds, oldest first).
   Output bars: the same shape. Indicators, Volume and Pine scripts run on the output, as on TradingView (an RSI on a
   Heikin-Ashi chart uses the Heikin-Ashi closes; on Renko, one value per brick).

   Types:
   - candles, hollow, bars, line, area: the real candles, drawn differently.
   - ha: Heikin-Ashi (same times as the candles).
   - renko: bricks of a fixed size ("box"), traditional: a reversal needs the price to pass the last brick by a box.
     Built from the closes, or from each candle's path (open, low/high, high/low, close) with source "hl".
   - range: range bars, each high - low = the range; built from each candle's path.
   - lb: line break (3 by default): a new line when the close passes the highs / lows of the last N lines.
   - pf: Point & Figure: columns of X (rising) and O (falling), one per box; a new column needs a reversal of N boxes
     (3 by default) from the column's extreme and starts one box back from it. Each column is a bar: low = its lowest
     box, high = its highest; open / close follow its direction (X: low -> high, O: high -> low); bar.pf = 1 (X) or -1 (O).
   Renko, range and line break don't follow time: each bar gets the time of the candle it formed in (+1 s for each
   extra bar in the same candle), so times always increase. */
"use strict";
const CT = {
  TYPES: [["candles", "Candles"], ["hollow", "Hollow candles"], ["bars", "Bars (OHLC)"], ["line", "Line"], ["area", "Area"],
          ["ha", "Heikin-Ashi"], ["renko", "Renko"], ["range", "Range bars"], ["lb", "Line break"], ["pf", "Point & Figure"]],
  DEFAULTS: {type: "candles", renkoMode: "atr", renkoAtr: 14, renkoSrc: "close", renkoWicks: false, rangeMode: "atr",
             rangeAtr: 14, lbLines: 3, pfMode: "atr", pfAtr: 14, pfRev: 3, pfSrc: "close", pfInd: "mid"},

  name(t){ return (CT.TYPES.find(x => x[0] === t) || CT.TYPES[0])[1]; },
  timeBased(t){ return !["renko", "range", "lb", "pf"].includes(t); },
  ohlc(t){ return !["line", "area"].includes(t); },

  roundTick(p, tick){ tick = tick || 0.05; return +(Math.round(p / tick) * tick).toFixed(6); },

  /* Wilder's ATR of the last `n` bars (the box / range size in ATR mode, fixed for the whole chart as on TradingView) */
  atr(bars, n){
    n = Math.max(1, n | 0);
    if(bars.length < 2) return bars.length ? bars[0].high - bars[0].low : 0;
    let a = null;
    for(let i = 1; i < bars.length; i++){
      const b = bars[i], pc = bars[i - 1].close;
      const tr = Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
      if(i <= n){ a = (a || 0) + tr / n; } else a = (a * (n - 1) + tr) / n;
    }
    return a;
  },

  /* the box / range size for this chart: fixed points, or the ATR rounded to the tick (at least 1 tick) */
  size(bars, mode, fixed, atrN, tick){
    tick = tick || 0.05;
    const v = mode === "fixed" ? +fixed : CT.atr(bars, atrN || 14);
    return Math.max(tick, CT.roundTick(v > 0 ? v : tick, tick));
  },

  /* a candle's likely path: up candles go down first, down candles up first (as TradingView assumes) */
  path(b){ return b.close >= b.open ? [b.open, b.low, b.high, b.close] : [b.open, b.high, b.low, b.close]; },

  transform(raw, type, o){
    o = {...CT.DEFAULTS, ...(o || {})};
    if(!raw || !raw.length) return [];
    switch(type){
      case "ha": return CT.ha(raw);
      case "renko": return CT.renko(raw, o.box, o.renkoSrc, o.renkoWicks);
      case "range": return CT.range(raw, o.range);
      case "lb": return CT.lineBreak(raw, o.lbLines || 3);
      case "pf": return CT.pf(raw, o.box, o.pfRev || 3, o.pfSrc);
      default: return raw.map(b => ({time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, vol: b.vol || 0}));
    }
  },

  /* Every type that isn't drawn straight from the candles is a builder: feed(candle) one candle at a time (oldest
     first) into `out`; save() / load(state) mark a point and go back to it. The chart keeps a builder saved after
     the last closed candle, so a live price only re-feeds the live candle (v0.44.0: Renko / range bars built from the
     whole history on every tick made the chart hang on small sizes). transform() is a builder fed every candle, so
     both always give the same bars. A bar already in `out` is never changed later, except the last one where the
     type keeps growing it (range bars, P&F columns): save() keeps a copy of it. */
  builder(type, o){
    o = {...CT.DEFAULTS, ...(o || {})};
    const mk = {ha: CT._ha, renko: CT._renko, range: CT._range, lb: CT._lb, pf: CT._pf}[type];
    return mk ? mk(o) : null;
  },
  ha(raw){ return CT._run(CT._ha({}), raw); },
  renko(raw, box, src, wicks){ return CT._run(CT._renko({box, renkoSrc: src, renkoWicks: wicks}), raw); },
  range(raw, size){ return CT._run(CT._range({range: size}), raw); },
  pf(raw, box, rev, src){ return CT._run(CT._pf({box, pfRev: rev, pfSrc: src}), raw); },
  lineBreak(raw, n){ return CT._run(CT._lb({lbLines: n}), raw); },
  _run(b, raw){ for(const x of raw) b.feed(x); return b.out; },

  _ha(){
    const out = [];
    let po = null, pc = null;
    return {out,
      feed(b){
        const c = (b.open + b.high + b.low + b.close) / 4;
        const op = po == null ? (b.open + b.close) / 2 : (po + pc) / 2;
        out.push({time: b.time, open: op, high: Math.max(b.high, op, c), low: Math.min(b.low, op, c), close: c, vol: b.vol || 0});
        po = op; pc = c;
      },
      save(){ return {n: out.length, po, pc}; },
      load(s){ out.length = s.n; po = s.po; pc = s.pc; }};
  },

  _renko(o){
    const box = o.box, src = o.renkoSrc, wicks = o.renkoWicks, out = [];
    const r6 = v => +v.toFixed(6);
    let hi = null, lo = null;                     // the last brick's top and bottom (zero height at first)
    let vol = 0, lastT = -Infinity, minP = Infinity, maxP = -Infinity;
    const push = (t, op, cl, up) => {
      const tt = Math.max(t, lastT + 1); lastT = tt;
      const b = {time: tt, open: r6(op), close: r6(cl), high: r6(Math.max(op, cl)), low: r6(Math.min(op, cl)), vol};
      if(wicks){ if(up) b.low = r6(Math.min(b.low, minP)); else b.high = r6(Math.max(b.high, maxP)); }
      out.push(b); vol = 0; minP = Infinity; maxP = -Infinity;
    };
    return {out,
      feed(b){
        if(!(box > 0)) return;
        if(hi == null){ hi = Math.floor(b.close / box) * box; lo = hi; }
        vol += b.vol || 0;
        for(const p of src === "hl" ? CT.path(b) : [b.close]){
          minP = Math.min(minP, p); maxP = Math.max(maxP, p);
          while(p >= hi + box - 1e-9){ push(b.time, hi, hi + box, true); lo = hi; hi = hi + box; }
          while(p <= lo - box + 1e-9){ push(b.time, lo, lo - box, false); hi = lo; lo = lo - box; }
        }
      },
      save(){ return {n: out.length, hi, lo, vol, lastT, minP, maxP}; },
      load(s){ out.length = s.n; ({hi, lo, vol, lastT, minP, maxP} = s); }};
  },

  _range(o){
    const size = o.range, out = [];
    let cur = null, lastT = -Infinity;
    const open = (t, p) => { const tt = Math.max(t, lastT + 1); lastT = tt; cur = {time: tt, open: p, high: p, low: p, close: p, vol: 0}; out.push(cur); };
    return {out,
      feed(b){
        if(!(size > 0)) return;
        let first = true;
        for(const p of CT.path(b)){
          if(!cur) open(b.time, p);
          if(first){ cur.vol += b.vol || 0; first = false; }
          // walk to p, closing a bar each time the range is used up
          for(let guard = 0; guard < 10000; guard++){
            if(p > cur.high && p - cur.low > size + 1e-9){
              const top = +(cur.low + size).toFixed(6);
              cur.high = top; cur.close = top; open(b.time, top);
            } else if(p < cur.low && cur.high - p > size + 1e-9){
              const bot = +(cur.high - size).toFixed(6);
              cur.low = bot; cur.close = bot; open(b.time, bot);
            } else break;
          }
          cur.high = Math.max(cur.high, p); cur.low = Math.min(cur.low, p); cur.close = p;
        }
      },
      save(){ return {n: out.length, cur: cur && {...cur}, lastT}; },
      load(s){ out.length = s.n; lastT = s.lastT; cur = s.cur ? {...s.cur} : null; if(cur) out[s.n - 1] = cur; }};
  },

  _pf(o){
    const box = o.box, rev = Math.max(1, (o.pfRev || 3) | 0), src = o.pfSrc, out = [];
    // work in whole boxes (k = level / box) so rounding can't drift
    const up = p => Math.floor(p / box + 1e-9), dn = p => Math.ceil(p / box - 1e-9), L = k => +(k * box).toFixed(6);
    let dir = 0, top = 0, bot = 0, base = null, cur = null, lastT = -Infinity, vol = 0;
    const bar = () => ({open: L(dir > 0 ? bot : top), close: L(dir > 0 ? top : bot), high: L(top), low: L(bot), pf: dir});
    const start = t => { const tt = Math.max(t, lastT + 1); lastT = tt; cur = {time: tt, ...bar(), vol}; out.push(cur); vol = 0; };
    const sync = () => { if(cur) Object.assign(cur, bar()); };
    return {out,
      feed(b){
        if(!(box > 0)) return;
        if(base == null) base = up(b.close);
        vol += b.vol || 0;
        // high / low: a rising column looks at the high first (to extend), then the low (to reverse); falling: the other way
        const ps = src === "hl" ? (dir >= 0 ? [b.high, b.low] : [b.low, b.high]) : [b.close];
        for(const p of ps){
          if(dir === 0){
            if(up(p) >= base + 1){ dir = 1; bot = base; top = up(p); start(b.time); }
            else if(dn(p) <= base - 1){ dir = -1; top = base; bot = dn(p); start(b.time); }
          } else if(dir > 0){
            if(up(p) > top){ top = up(p); sync(); }
            else if(dn(p) <= top - rev){ dir = -1; top = top - 1; bot = dn(p); start(b.time); }
          } else {
            if(dn(p) < bot){ bot = dn(p); sync(); }
            else if(up(p) >= bot + rev){ dir = 1; bot = bot + 1; top = up(p); start(b.time); }
          }
        }
        if(cur && vol){ cur.vol += vol; vol = 0; }
      },
      save(){ return {n: out.length, cur: cur && {...cur}, dir, top, bot, base, lastT, vol}; },
      load(s){ out.length = s.n; ({dir, top, bot, base, lastT, vol} = s); cur = s.cur ? {...s.cur} : null; if(cur) out[s.n - 1] = cur; }};
  },

  _lb(o){
    const n = Math.max(1, (o.lbLines || 3) | 0), out = [];
    let lastT = -Infinity, vol = 0;
    return {out,
      feed(b){
        vol += b.vol || 0;
        const c = b.close;
        if(!out.length){
          if(c !== b.open){ out.push({time: b.time, open: b.open, close: c, high: Math.max(b.open, c), low: Math.min(b.open, c), vol}); lastT = b.time; vol = 0; }
          return;
        }
        let top = -Infinity, bot = Infinity;
        for(let i = Math.max(0, out.length - n); i < out.length; i++){ top = Math.max(top, out[i].high); bot = Math.min(bot, out[i].low); }
        const last = out[out.length - 1], up = last.close >= last.open;
        let op = null;
        if(c > top) op = up ? last.close : last.open;          // continuation from the close, reversal from the open
        else if(c < bot) op = up ? last.open : last.close;
        if(op == null) return;
        const tt = Math.max(b.time, lastT + 1); lastT = tt;
        out.push({time: tt, open: op, close: c, high: Math.max(op, c), low: Math.min(op, c), vol});
        vol = 0;
      },
      save(){ return {n: out.length, lastT, vol}; },
      load(s){ out.length = s.n; lastT = s.lastT; vol = s.vol; }};
  },

  /* Renko / range bars: about how many bars a candle makes at this size (the price's path in boxes), and the first
     candle to build from so the chart keeps to `max` bars - a size far below the candles' moves (0.10 on gold's 1m
     candles: hundreds of thousands of bars) would otherwise freeze the page. 0 = build from the first candle. */
  barsIn(b, prev, type, o){
    const s = o.box || o.range;
    if(!(s > 0)) return 0;
    const path = Math.abs(b.open - (prev ? prev.close : b.open)) + (b.close >= b.open ? (b.open - b.low) + (b.high - b.low) + (b.high - b.close)
      : (b.high - b.open) + (b.high - b.low) + (b.close - b.low));
    if(type === "renko") return o.renkoSrc === "hl" ? path / s : Math.abs(b.close - (prev ? prev.close : b.close)) / s;
    if(type === "range") return path / s + 1 / 64;
    return 1;
  },
  startFor(raw, type, o, max){
    o = {...CT.DEFAULTS, ...(o || {})};
    if(!["renko", "range"].includes(type) || !raw.length) return 0;   // (P&F: a column per reversal, whatever the box)
    let n = 0;
    for(let i = raw.length - 1; i >= 0; i--){ n += CT.barsIn(raw[i], raw[i - 1], type, o); if(n > max) return Math.min(raw.length - 1, i + 1); }
    return 0;
  },
  MAX_BARS: 20000,

  /* Point & Figure toolkit (classic rules: Dorsey, du Plessis). cols: P&F bars (pf = 1 X / -1 O); box; rev.
     Works in box numbers (k = price / box). Returns:
     lines:   45-degree trend lines. Bullish support: from the box below a column's low, up one box per column;
              broken when an O column reaches the line. Bearish resistance: from the box above a column's high, down one
              box per column; broken when an X column reaches it. After a break the opposite line starts from the
              extreme of the move (the highest X / lowest O since the last line began). {dir, c0, k0, c1, broken}
     signals: Double Top Buy (an X column one box above the previous X top) / Double Bottom Sell, and Triple Top Buy /
              Triple Bottom Sell when the two previous tops (bottoms) were equal; at the trigger box; fresh = the
              first signal after one the other way. {col, kind, dir, k, fresh}
     anchors: columns of at least `anchorBoxes` boxes, with their high and low. {col, dir, n, hi, lo}
     counts:  vertical counts from finished columns of at least `countMin` boxes: target = boxes x box x reversal from
              the column's low (X) or high (O); active once a later column breaks the column's high (low); achieved
              when price reaches the target. {col, dir, n, target, active, activeCol, achieved}
     hcounts: horizontal counts at each breakout out of a congestion: the columns from the breakout back to the wall (the
              first column that reached the breakout level), at least `hcMin` wide; target = width x box x reversal
              from the congestion's low (up) or high (down) - the conservative count. {col, dir, w, wall, target,
              achieved}
     patterns (StockCharts / Dorsey rules; Definedge's published descriptions for the last two):
              bull trap: a triple top buy exactly one box above the tops, then an O column that gives a double bottom
                sell (bear trap: the mirror); catapult: a triple top buy, a pullback that neither gives a sell signal nor
                breaks the pattern's low, then a double top buy (7 columns); high pole: an X column 3+ boxes above the
                previous X top, then an O column retracing more than half of it (low pole: the mirror); triangle: lower
                tops and higher bottoms over 4 columns, then a double top buy / bottom sell; ascending (descending)
                triangle: two equal tops (bottoms) with rising bottoms (falling tops), then the breakout; turtle: a
                column beyond the highest high (lowest low) of the previous `turtleN` columns; anchor follow-through:
                the next column on the anchor's side that goes beyond the anchor column (stop: the pullback's
                extreme). {col, kind, dir, k?, stop?}  */
  pfTools(cols, box, rev, o){
    o = {anchorBoxes: 15, countMin: 5, hcMin: 5, turtleN: 20, ...(o || {})};
    const K = v => Math.round(v / box);
    const c = cols.map(b => ({dir: b.pf, hi: K(b.high), lo: K(b.low)}));
    const out = {lines: [], signals: [], anchors: [], counts: [], hcounts: [], patterns: []};
    if(!c.length) return out;
    // trend lines
    let L = c[0].dir > 0 ? {dir: 1, c0: 0, k0: c[0].lo - 1} : {dir: -1, c0: 0, k0: c[0].hi + 1};
    const at = (ln, i) => ln.k0 + ln.dir * (i - ln.c0);
    for(let i = L.c0 + 1; i < c.length; i++){
      const x = c[i];
      const broke = L.dir > 0 ? x.dir < 0 && x.lo <= at(L, i) : x.dir > 0 && x.hi >= at(L, i);
      if(!broke) continue;
      out.lines.push({...L, c1: i, broken: true});
      // The next line starts at the top (X column) / bottom (O column) of the move since this line began, choosing the
      // one whose 45-degree line no later column has already crossed: the most of hi + column (resistance) or the
      // least of lo - column (support). The plain highest top / lowest bottom could be crossed already by columns
      // before this break, and the line then ran on through them (v0.27.0 fix: lines drawn through price, and a
      // pair of lines re-made from the same column every column).
      const nd = -L.dir, want = nd < 0 ? 1 : -1;     // resistance from X columns, support from O columns
      let best = -1;
      for(let pass = 0; pass < 2 && best < 0; pass++){
        for(let j = L.c0; j <= i; j++){
          if(pass === 0 && c[j].dir !== want) continue;
          if(best < 0 || (nd < 0 ? c[j].hi + j > c[best].hi + best : c[j].lo - j < c[best].lo - best)) best = j;
        }
      }
      L = nd < 0 ? {dir: -1, c0: best, k0: c[best].hi + 1} : {dir: 1, c0: best, k0: c[best].lo - 1};
    }
    out.lines.push({...L, c1: c.length - 1, broken: false});
    // buy / sell signals
    let last = 0;
    for(let i = 2; i < c.length; i++){
      const x = c[i], p = c[i - 2], q = i >= 4 ? c[i - 4] : null;
      let s = null;
      if(x.dir > 0 && x.hi > p.hi) s = {kind: q && q.hi === p.hi ? "TTB" : "DTB", dir: 1, k: p.hi + 1};
      if(x.dir < 0 && x.lo < p.lo) s = {kind: q && q.lo === p.lo ? "TBS" : "DBS", dir: -1, k: p.lo - 1};
      if(!s) continue;
      out.signals.push({col: i, ...s, fresh: last !== s.dir});
      last = s.dir;
    }
    // anchor columns
    c.forEach((x, i) => { const n = x.hi - x.lo + 1; if(n >= o.anchorBoxes) out.anchors.push({col: i, dir: x.dir, n, hi: x.hi, lo: x.lo}); });
    // vertical counts
    for(let i = 0; i < c.length - 1; i++){
      const x = c[i], n = x.hi - x.lo + 1;
      if(n < o.countMin) continue;
      const target = x.dir > 0 ? x.lo + n * rev : x.hi - n * rev;
      let activeCol = null, achieved = false;
      for(let j = i + 1; j < c.length; j++){
        if(activeCol == null && (x.dir > 0 ? c[j].dir > 0 && c[j].hi > x.hi : c[j].dir < 0 && c[j].lo < x.lo)) activeCol = j;
        if(activeCol != null && (x.dir > 0 ? c[j].hi >= target : c[j].lo <= target)){ achieved = true; break; }
      }
      out.counts.push({col: i, dir: x.dir, n, target, active: activeCol != null, activeCol, achieved});
    }
    // horizontal counts: from every breakout out of a congestion
    for(const s of out.signals){
      const i = s.col, k = s.k, d = s.dir;
      let wall = null;
      for(let j = i - 1; j >= 0 && i - j <= 40; j--){
        if(d > 0 ? c[j].hi >= k : c[j].lo <= k){ wall = j; break; }
      }
      if(wall == null) continue;
      const w = i - wall + 1;
      if(w < o.hcMin) continue;
      let lo = Infinity, hi = -Infinity;
      for(let j = wall; j <= i; j++){ lo = Math.min(lo, c[j].lo); hi = Math.max(hi, c[j].hi); }
      const target = d > 0 ? lo + w * rev : hi - w * rev;
      let achieved = false;
      for(let j = i; j < c.length; j++) if(d > 0 ? c[j].hi >= target : c[j].lo <= target){ achieved = true; break; }
      out.hcounts.push({col: i, dir: d, w, wall, target, achieved});
    }
    // patterns
    const sigAt = {}; for(const s of out.signals) sigAt[s.col] = s;
    const add = (col, kind, dir, extra) => out.patterns.push({col, kind, dir, ...(extra || {})});
    for(let i = 0; i < c.length; i++){
      const x = c[i], s = sigAt[i];
      // traps: a triple top (bottom) breakout of exactly one box, then the opposite double signal
      if(s && (s.kind === "TTB" || s.kind === "TBS") && i + 1 < c.length && i >= 1){
        const nx = c[i + 1];
        if(s.dir > 0 && x.hi === s.k && nx.lo < c[i - 1].lo) add(i + 1, "bull_trap", -1, {k: c[i - 1].lo - 1});
        if(s.dir < 0 && x.lo === s.k && nx.hi > c[i - 1].hi) add(i + 1, "bear_trap", 1, {k: c[i - 1].hi + 1});
      }
      // catapults: triple breakout, a pullback that holds, then a double signal the same way
      if(s && (s.kind === "TTB" || s.kind === "TBS") && i >= 4 && i + 2 < c.length){
        const pb = c[i + 1], go = c[i + 2];
        let plo = Infinity, phi = -Infinity; for(let j = i - 4; j <= i; j++){ plo = Math.min(plo, c[j].lo); phi = Math.max(phi, c[j].hi); }
        if(s.dir > 0 && pb.lo >= plo && pb.lo >= c[i - 1].lo && go.hi > x.hi) add(i + 2, "catapult_bull", 1, {k: x.hi + 1});
        if(s.dir < 0 && pb.hi <= phi && pb.hi <= c[i - 1].hi && go.lo < x.lo) add(i + 2, "catapult_bear", -1, {k: x.lo - 1});
      }
      // poles: a column 3+ boxes beyond the previous one on its side, then a retracement of more than half of it
      if(i >= 2 && i + 1 < c.length){
        const n = x.hi - x.lo + 1, nx = c[i + 1];
        if(x.dir > 0 && x.hi - c[i - 2].hi >= 3 && x.hi - nx.lo > n / 2) add(i + 1, "high_pole", -1);
        if(x.dir < 0 && c[i - 2].lo - x.lo >= 3 && nx.hi - x.lo > n / 2) add(i + 1, "low_pole", 1);
      }
      // triangles: 4 columns of lower tops and higher bottoms (or equal tops / bottoms), then the breakout
      if(s && i >= 4){
        const t1 = c[i - 4], b1 = c[i - 3], t2 = c[i - 2], b2 = c[i - 1];
        if(s.dir > 0){
          if(t2.hi < t1.hi && b2.lo > b1.lo) add(i, "triangle_bull", 1, {k: s.k});
          else if(t2.hi === t1.hi && b2.lo > b1.lo) add(i, "asc_triangle", 1, {k: s.k});
        } else {
          if(t2.lo > t1.lo && b2.hi < b1.hi) add(i, "triangle_bear", -1, {k: s.k});
          else if(t2.lo === t1.lo && b2.hi < b1.hi) add(i, "desc_triangle", -1, {k: s.k});
        }
      }
      // turtle breakouts: beyond the extreme of the previous N columns
      if(i >= o.turtleN){
        let hh = -Infinity, ll = Infinity; for(let j = i - o.turtleN; j < i; j++){ hh = Math.max(hh, c[j].hi); ll = Math.min(ll, c[j].lo); }
        if(x.dir > 0 && x.hi > hh) add(i, "turtle_bull", 1, {k: hh + 1});
        if(x.dir < 0 && x.lo < ll) add(i, "turtle_bear", -1, {k: ll - 1});
      }
      // anchor follow-through: the next column on the anchor's side goes beyond the anchor column
      if(i >= 2 && c[i - 2].hi - c[i - 2].lo + 1 >= o.anchorBoxes){
        const a = c[i - 2];
        if(a.dir > 0 && x.dir > 0 && x.hi > a.hi) add(i, "aft_bull", 1, {k: a.hi + 1, stop: c[i - 1].lo});
        if(a.dir < 0 && x.dir < 0 && x.lo < a.lo) add(i, "aft_bear", -1, {k: a.lo - 1, stop: c[i - 1].hi});
      }
    }
    // back to prices
    const P = k => +(k * box).toFixed(6);
    out.lines = out.lines.map(l => ({...l, p0: P(l.k0)}));
    out.signals = out.signals.map(s => ({...s, price: P(s.k)}));
    out.anchors = out.anchors.map(a => ({...a, hiP: P(a.hi), loP: P(a.lo)}));
    out.counts = out.counts.map(v => ({...v, targetP: P(v.target)}));
    out.hcounts = out.hcounts.map(v => ({...v, targetP: P(v.target)}));
    out.patterns = out.patterns.map(q => ({...q, price: q.k != null ? P(q.k) : null, stopP: q.stop != null ? P(q.stop) : null}));
    return out;
  },

  PF_PATTERNS: {bull_trap: "Bull trap", bear_trap: "Bear trap", catapult_bull: "Catapult", catapult_bear: "Catapult",
    high_pole: "High pole", low_pole: "Low pole", triangle_bull: "Triangle", triangle_bear: "Triangle", asc_triangle: "Asc. triangle",
    desc_triangle: "Desc. triangle", turtle_bull: "Turtle", turtle_bear: "Turtle", aft_bull: "AFT", aft_bear: "AFT"},

};
if(typeof module !== "undefined") module.exports = CT;
