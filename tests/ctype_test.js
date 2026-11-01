// Chart-type transforms (web/ctype.js) with hand-worked numbers. Run: node tests/ctype_test.js
const CT = require("../web/ctype.js");
let fails = 0;
const ok = (c, m, d) => { console.log((c ? "PASS " : "FAIL ") + m + (c ? "" : "  <- " + JSON.stringify(d))); if(!c) fails++; };
const bar = (t, o, h, l, c, v = 10) => ({time: t, open: o, high: h, low: l, close: c, vol: v});

// Heikin-Ashi: close = (o+h+l+c)/4, open = average of the previous HA open and close
const raw = [bar(60, 100, 110, 95, 105), bar(120, 105, 112, 104, 110), bar(180, 110, 111, 100, 101)];
const ha = CT.transform(raw, "ha");
ok(ha[0].close === 102.5 && ha[0].open === 102.5, "HA first bar: open (o+c)/2 = 102.5, close (o+h+l+c)/4 = 102.5", ha[0]);
ok(ha[1].open === 102.5 && ha[1].close === 107.75 && ha[1].high === 112 && ha[1].low === 102.5, "HA second bar: open 102.5, close 107.75, high 112, low 102.5", ha[1]);
ok(ha.map(b => b.time).join() === "60,120,180", "HA keeps the candles' times", ha.map(b => b.time));

// Renko, box 10, from closes: 100 -> 125 makes 2 up bricks; 118 isn't a reversal; 99 is (below 110 - 10)
const rr = [bar(60, 100, 100, 100, 100), bar(120, 100, 125, 100, 125, 5), bar(180, 125, 125, 118, 118, 7), bar(240, 118, 118, 99, 99, 3)];
const rk = CT.transform(rr, "renko", {box: 10, renkoSrc: "close"});
ok(rk.length === 3, "Renko box 10: two up bricks, then one down brick", rk);
ok(rk[0].open === 100 && rk[0].close === 110 && rk[1].open === 110 && rk[1].close === 120, "Renko up bricks 100-110, 110-120", rk.slice(0, 2));
ok(rk[2].open === 110 && rk[2].close === 100, "Renko reversal brick 110 -> 100 (needs 2 boxes from the top)", rk[2]);
ok(rk[0].time === 120 && rk[1].time === 121 && rk[2].time === 240, "Renko times: the candle's time, +1 s for a second brick in it", rk.map(b => b.time));
ok(rk[0].vol === 15 && rk[1].vol === 0 && rk[2].vol === 10, "Renko volume: what traded until each brick formed", rk.map(b => b.vol));
const rkHL = CT.transform([bar(60, 100, 100, 100, 100), bar(120, 100, 112, 89, 105)], "renko", {box: 10, renkoSrc: "hl"});
ok(rkHL.length === 2 && rkHL[0].close === 90 && rkHL[1].open === 100 && rkHL[1].close === 110,
   "Renko from high / low: an up candle goes to its low first (89: brick 100-90), then its high (112: brick 100-110)", rkHL);

// Range bars, range 10
const rg = CT.transform([bar(60, 100, 100, 100, 100), bar(120, 100, 125, 100, 125)], "range", {range: 10});
ok(rg.every(b => +(b.high - b.low).toFixed(6) <= 10), "Range bars: no bar wider than the range", rg);
ok(rg.length === 3 && rg[0].close === 110 && rg[1].close === 120 && rg[2].close === 125, "Range bars: 100-110, 110-120, then 120-125 still forming", rg);

// Line break (3)
const lbRaw = [100, 105, 103, 108, 104, 99, 97].map((c, i) => bar(60 * (i + 1), i ? [100, 105, 103, 108, 104, 99, 97][i - 1] : 98, c + 1, c - 1, c));
const lb = CT.transform(lbRaw, "lb", {lbLines: 3});
ok(lb.map(b => b.close).join() === "100,105,108,97", "3-line break: up 98-100, 105, 108; 104 and 99 don't break the 3-line low (98); 97 does", lb.map(b => [b.open, b.close]));
ok(lb[3].open === 105 && lb[3].close === 97, "the reversal line starts at the open of the last up line", lb[3]);

// Point & Figure, box 1, reversal 3, from closes: 100 -> 105 (X 100..105), 103 (no reversal), 101 (O 104..101),
// 103 (no reversal: needs 104), 105 (X 102..105), 106 (extends to 106)
const pfRaw = [100, 105, 103, 101, 103, 105, 106].map((c, i) => bar(60 * (i + 1), c, c, c, c, 1));
const pf = CT.transform(pfRaw, "pf", {box: 1, pfRev: 3, pfSrc: "close"});
ok(pf.length === 3, "P&F: three columns (X, O, X)", pf);
ok(pf[0].pf === 1 && pf[0].low === 100 && pf[0].high === 105, "P&F: first column X from 100 to 105", pf[0]);
ok(pf[1].pf === -1 && pf[1].high === 104 && pf[1].low === 101 && pf[1].open === 104 && pf[1].close === 101,
   "P&F: the O column starts one box below the X top (104) and falls to 101", pf[1]);
ok(pf[2].pf === 1 && pf[2].low === 102 && pf[2].high === 106, "P&F: 103 isn't a 3-box reversal from 101; 105 is: X from 102, extended to 106", pf[2]);
ok(pf[0].time === 120 && pf[1].time === 240 && pf[2].time === 360, "P&F: each column has the time its first box formed", pf.map(b => b.time));
ok(pf[0].vol === 3 && pf[1].vol === 2 && pf[2].vol === 2, "P&F: volume of every candle from the one that started a column until the next (3, 2, 2)", pf.map(b => b.vol));
const pfHL = CT.transform([bar(60, 100, 100, 100, 100), bar(120, 100, 104, 96, 101)], "pf", {box: 1, pfRev: 3, pfSrc: "hl"});
ok(pfHL.length === 2 && pfHL[0].high === 104 && pfHL[1].low === 96, "P&F from highs and lows: a rising column takes the high (104), then the low reverses it (96)", pfHL);

// P&F toolkit on hand-made columns (box 1, reversal 3). Boxes: lo..hi.
//  0: X 100-110   1: O 107-104   2: X 105-112 (DTB: above 110 at 111)   3: O 109-106   4: X 107-112 (equal top: no signal)
//  5: O 109-103 (DBS: below 104 at 103... previous O low 106 -> trigger 105)   6: X 104-108   7: O 105-99 (bull line broken?)
const C = (pf, lo, hi) => ({pf, low: lo, high: hi});
const cols = [C(1, 100, 110), C(-1, 104, 107), C(1, 105, 112), C(-1, 106, 109), C(1, 107, 112), C(-1, 103, 109), C(1, 104, 108), C(-1, 99, 105), C(1, 100, 113)];
const T = CT.pfTools(cols, 1, 3, {anchorBoxes: 10, countMin: 5});
// bullish line from 99 at column 0, +1 per column: col 5 -> 104, so the O column 5 (low 103) breaks it
ok(T.lines[0].dir === 1 && T.lines[0].p0 === 99 && T.lines[0].c1 === 5 && T.lines[0].broken, "P&F line: bullish from 99 (below the first low), broken by the O column 5 at 103 (line at 104)", T.lines[0]);
// then bearish from above the top that no later column has crossed: columns 2 and 4 both top at 112; a line from column 2
// (113, -1 per column) is at 111 by column 4, which reaches 112 - already crossed - so it starts above column 4 (v0.27.0):
// 113 at col 4, 111 at col 6 (X 108: no), 109 at col 8 (113: broken)
ok(T.lines[1].dir === -1 && T.lines[1].c0 === 4 && T.lines[1].p0 === 113 && T.lines[1].c1 === 8 && T.lines[1].broken, "P&F line: then bearish from 113 above column 4 (column 2's line was already crossed by column 4's equal top), broken by column 8", T.lines[1]);
ok(T.lines[2].dir === 1 && T.lines[2].c0 === 7 && T.lines[2].p0 === 98 && !T.lines[2].broken, "P&F line: and a new bullish line from 98 (below the lowest O, column 7), still running", T.lines[2]);
// v0.27.0 regression (owner's screenshot, 1 Nov): a line was started at the plain highest top / lowest bottom, which columns
// before the break could have crossed already; the line then ran on through price, and two lines were re-made from the
// same column every column (labels marching off in a "<"). On random walks: no line is crossed before the column where
// it's marked broken, a broken line is broken by that column, and no line is made twice.
{
  let seed = 7, bad = 0, dup = 0, n = 0, wrongEnd = 0;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for(let run = 0; run < 40; run++){
    let p = 1000; const rw = [];
    for(let i = 0; i < 2000; i++){ const o = p; p += (rnd() - 0.5) * 6; rw.push({time: i * 60, open: o, high: Math.max(o, p) + rnd() * 2, low: Math.min(o, p) - rnd() * 2, close: p, vol: 1}); }
    const cs = CT.pf(rw, 2, 3, "hl"), K = v => Math.round(v / 2), cc = cs.map(b => ({dir: b.pf, hi: K(b.high), lo: K(b.low)}));
    const seen = new Set();
    for(const L of CT.pfTools(cs, 2, 3).lines){
      n++; const key = L.c0 + ":" + L.dir; if(seen.has(key)) dup++; seen.add(key);
      const at = i => L.k0 + L.dir * (i - L.c0), cross = i => L.dir > 0 ? cc[i].lo <= at(i) : cc[i].hi >= at(i);
      for(let i = L.c0 + 1; i < Math.min(L.c1, cc.length); i++) if(cross(i)){ bad++; break; }
      if(L.broken && !cross(L.c1)) wrongEnd++;
    }
  }
  ok(n > 1000 && bad === 0 && wrongEnd === 0 && dup === 0, "P&F lines on random walks: none crossed before its break, each broken where marked, none made twice", {n, bad, wrongEnd, dup});
}
const sig = T.signals.map(s => `${s.col}:${s.kind}@${s.price}${s.fresh ? "*" : ""}`).join(" ");
ok(sig === "2:DTB@111* 5:DBS@105* 7:DBS@102 8:DTB@109*", "P&F signals: DTB at 111, DBS at 105, DBS at 102 (continuation), DTB at 109 (above column 6's 108); * = fresh", sig);
const tt = CT.pfTools([C(1, 100, 110), C(-1, 104, 107), C(1, 105, 110), C(-1, 105, 107), C(1, 106, 111)], 1, 3).signals.map(s => `${s.col}:${s.kind}@${s.price}`).join(" ");
ok(tt === "4:TTB@111", "P&F: two equal tops (110, 110) then a column above them: Triple Top Buy at 111 (the equal second top is no signal)", tt);
ok(T.anchors.length === 2 && T.anchors[0].col === 0 && T.anchors[0].n === 11 && T.anchors[1].col === 8 && T.anchors[1].n === 14,
   "P&F anchors (10+ boxes here): column 0 (11 boxes), column 8 (14 boxes, still forming)", T.anchors);
const vc0 = T.counts.find(v => v.col === 0);
ok(vc0 && vc0.targetP === 133 && vc0.active && vc0.activeCol === 2 && !vc0.achieved,
   "P&F vertical count: column 0 (11 boxes x 1 x 3 = 33 from 100) targets 133, active since column 2 broke 110, not reached", vc0);
const vc5 = T.counts.find(v => v.col === 5);
ok(vc5 && vc5.dir === -1 && vc5.targetP === 88 && vc5.active && vc5.activeCol === 7, "P&F vertical count down: column 5 (7 boxes) targets 109 - 21 = 88, active since column 7 broke 103", vc5);

// P&F toolkit 2: patterns and horizontal counts (box 1, reversal 3), each on a small hand-made chart
const pat = (cols, o) => CT.pfTools(cols, 1, 3, o).patterns.map(q => `${q.col}:${q.kind}` + (q.price != null ? `@${q.price}` : "") + (q.stopP != null ? `/stop ${q.stopP}` : "")).join(" ");
let pp = pat([C(1, 100, 110), C(-1, 105, 109), C(1, 106, 110), C(-1, 104, 109), C(1, 105, 111), C(-1, 102, 110)]);
ok(/5:bull_trap@103/.test(pp), "bull trap: triple top buy exactly one box over (111), then a double bottom sell (below 104)", pp);
pp = pat([C(-1, 100, 110), C(1, 101, 105), C(-1, 100, 104), C(1, 101, 106), C(-1, 99, 105), C(1, 100, 108)]);
ok(/5:bear_trap@107/.test(pp), "bear trap: triple bottom sell exactly one box under (99), then a double top buy (above 106)", pp);
pp = pat([C(1, 100, 110), C(-1, 105, 109), C(1, 106, 110), C(-1, 104, 109), C(1, 105, 112), C(-1, 106, 111), C(1, 107, 113)]);
ok(/6:catapult_bull@113/.test(pp) && !/bull_trap/.test(pp), "catapult: triple top buy (2 boxes: no trap), pullback holds above 104, then a double top buy at 113", pp);
pp = pat([C(1, 100, 105), C(-1, 102, 104), C(1, 103, 110), C(-1, 104, 109)]);
ok(/3:high_pole/.test(pp), "high pole: X 5 boxes above the previous top (110 vs 105), then O retraces 6 of its 8 boxes", pp);
pp = pat([C(-1, 105, 110), C(1, 106, 108), C(-1, 99, 107), C(1, 100, 104)]);
ok(/3:low_pole/.test(pp), "low pole: O 6 boxes below the previous bottom (99 vs 105), then X retraces 5 of its 9 boxes", pp);
pp = pat([C(1, 100, 110), C(-1, 101, 109), C(1, 102, 108), C(-1, 103, 107), C(1, 104, 109)]);
ok(/4:triangle_bull@109/.test(pp), "triangle: lower top (108 < 110), higher bottom (103 > 101), then a double top buy at 109", pp);
pp = pat([C(1, 100, 110), C(-1, 101, 109), C(1, 102, 110), C(-1, 103, 109), C(1, 104, 111)]);
ok(/4:asc_triangle@111/.test(pp), "ascending triangle: equal tops (110), rising bottoms (101, 103), then the breakout at 111", pp);
pp = pat([C(1, 100, 105), C(-1, 102, 104), C(1, 103, 106), C(-1, 101, 105), C(1, 102, 107)], {turtleN: 4});
ok(/4:turtle_bull@107/.test(pp), "turtle (4 columns here): X above the highest high of the previous 4 columns (106) at 107", pp);
pp = pat([C(1, 100, 112), C(-1, 108, 111), C(1, 109, 113)], {anchorBoxes: 10});
ok(/2:aft_bull@113\/stop 108/.test(pp), "anchor follow-through: anchor X (13 boxes), pullback to 108, next X above the anchor at 113, stop 108", pp);
// the mirrors (prices reflected around 210: X <-> O)
const M = cols => cols.map(x => C(-x.pf, 210 - x.high, 210 - x.low));
pp = pat(M([C(1, 100, 110), C(-1, 105, 109), C(1, 106, 110), C(-1, 104, 109), C(1, 105, 112), C(-1, 106, 111), C(1, 107, 113)]));
ok(/6:catapult_bear@97/.test(pp), "bearish catapult (the mirror) at 97", pp);
pp = pat(M([C(1, 100, 110), C(-1, 101, 109), C(1, 102, 110), C(-1, 103, 109), C(1, 104, 111)]));
ok(/4:desc_triangle@99/.test(pp), "descending triangle (the mirror): equal bottoms, falling tops, breakdown at 99", pp);
pp = pat(M([C(1, 100, 105), C(-1, 102, 104), C(1, 103, 106), C(-1, 101, 105), C(1, 102, 107)]), {turtleN: 4});
ok(/4:turtle_bear@103/.test(pp), "bearish turtle (the mirror) at 103", pp);
pp = pat(M([C(1, 100, 112), C(-1, 108, 111), C(1, 109, 113)]), {anchorBoxes: 10});
ok(/2:aft_bear@97\/stop 102/.test(pp), "bearish anchor follow-through (the mirror) at 97, stop 102", pp);
const hcb = CT.pfTools(M([C(1, 100, 110), C(-1, 104, 109), C(1, 105, 108), C(-1, 104, 107), C(1, 105, 108), C(-1, 104, 107), C(1, 105, 111)]), 1, 3).hcounts;
ok(hcb.length === 1 && hcb[0].dir === -1 && hcb[0].targetP === 88, "bearish horizontal count (the mirror): 106 - 18 = 88", hcb);
const hc = CT.pfTools([C(1, 100, 110), C(-1, 104, 109), C(1, 105, 108), C(-1, 104, 107), C(1, 105, 108), C(-1, 104, 107), C(1, 105, 111)], 1, 3).hcounts;
ok(hc.length === 1 && hc[0].col === 6 && hc[0].wall === 1 && hc[0].w === 6 && hc[0].targetP === 122 && !hc[0].achieved,
   "horizontal count: breakout at 109 (column 6), wall at column 1 (it reached 109): 6 columns x 1 x 3 = 18 from the base low 104 = 122", hc);

// sizes: ATR, rounded to the tick
const s = CT.size([bar(1, 10, 12, 9, 11), bar(2, 11, 13, 10, 12), bar(3, 12, 14, 11, 13)], "atr", 0, 2, 0.05);
ok(s === 3, "ATR(2) of ranges 3, 3 = 3", s);
ok(CT.size([], "fixed", 7.3, 14, 0.5) === 7.5, "fixed size rounded to the tick (7.3 -> 7.5)");
ok(CT.timeBased("ha") && !CT.timeBased("renko") && !CT.ohlc("line"), "type flags");
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
