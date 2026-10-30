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
   Renko, range and line break don't follow time: each bar gets the time of the candle it formed in (+1 s for each
   extra bar in the same candle), so times always increase. */
"use strict";
const CT = {
  TYPES: [["candles", "Candles"], ["hollow", "Hollow candles"], ["bars", "Bars (OHLC)"], ["line", "Line"], ["area", "Area"],
          ["ha", "Heikin-Ashi"], ["renko", "Renko"], ["range", "Range bars"], ["lb", "Line break"]],
  DEFAULTS: {type: "candles", renkoMode: "atr", renkoAtr: 14, renkoSrc: "close", renkoWicks: false, rangeMode: "atr",
             rangeAtr: 14, lbLines: 3},

  name(t){ return (CT.TYPES.find(x => x[0] === t) || CT.TYPES[0])[1]; },
  timeBased(t){ return !["renko", "range", "lb"].includes(t); },
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
      default: return raw.map(b => ({time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, vol: b.vol || 0}));
    }
  },

  ha(raw){
    const out = [];
    let po = null, pc = null;
    for(const b of raw){
      const c = (b.open + b.high + b.low + b.close) / 4;
      const op = po == null ? (b.open + b.close) / 2 : (po + pc) / 2;
      out.push({time: b.time, open: op, high: Math.max(b.high, op, c), low: Math.min(b.low, op, c), close: c, vol: b.vol || 0});
      po = op; pc = c;
    }
    return out;
  },

  renko(raw, box, src, wicks){
    if(!(box > 0)) return [];
    const out = [];
    const r6 = v => +v.toFixed(6);
    let hi = Math.floor(raw[0].close / box) * box, lo = hi;   // the last brick's top and bottom (zero height at first)
    let vol = 0, lastT = -Infinity, minP = Infinity, maxP = -Infinity;
    const push = (t, op, cl, up) => {
      const tt = Math.max(t, lastT + 1); lastT = tt;
      const b = {time: tt, open: r6(op), close: r6(cl), high: r6(Math.max(op, cl)), low: r6(Math.min(op, cl)), vol};
      if(wicks){ if(up) b.low = r6(Math.min(b.low, minP)); else b.high = r6(Math.max(b.high, maxP)); }
      out.push(b); vol = 0; minP = Infinity; maxP = -Infinity;
    };
    for(const b of raw){
      vol += b.vol || 0;
      for(const p of src === "hl" ? CT.path(b) : [b.close]){
        minP = Math.min(minP, p); maxP = Math.max(maxP, p);
        while(p >= hi + box - 1e-9){ push(b.time, hi, hi + box, true); lo = hi; hi = hi + box; }
        while(p <= lo - box + 1e-9){ push(b.time, lo, lo - box, false); hi = lo; lo = lo - box; }
      }
    }
    return out;
  },

  range(raw, size){
    if(!(size > 0)) return [];
    const out = [];
    let cur = null, lastT = -Infinity;
    const open = (t, p) => { const tt = Math.max(t, lastT + 1); lastT = tt; cur = {time: tt, open: p, high: p, low: p, close: p, vol: 0}; out.push(cur); };
    for(const b of raw){
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
    }
    return out;
  },

  lineBreak(raw, n){
    n = Math.max(1, n | 0);
    const out = [];
    let lastT = -Infinity, vol = 0;
    for(const b of raw){
      vol += b.vol || 0;
      const c = b.close;
      if(!out.length){
        if(c !== b.open){ out.push({time: b.time, open: b.open, close: c, high: Math.max(b.open, c), low: Math.min(b.open, c), vol}); lastT = b.time; vol = 0; }
        continue;
      }
      const lastN = out.slice(-n), last = out[out.length - 1];
      const top = Math.max(...lastN.map(x => x.high)), bot = Math.min(...lastN.map(x => x.low));
      const up = last.close >= last.open;
      let op = null;
      if(c > top) op = up ? last.close : last.open;          // continuation from the close, reversal from the open
      else if(c < bot) op = up ? last.open : last.close;
      if(op == null) continue;
      const tt = Math.max(b.time, lastT + 1); lastT = tt;
      out.push({time: tt, open: op, close: c, high: Math.max(op, c), low: Math.min(op, c), vol});
      vol = 0;
    }
    return out;
  },
};
if(typeof module !== "undefined") module.exports = CT;
