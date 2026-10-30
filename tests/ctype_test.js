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

// sizes: ATR, rounded to the tick
const s = CT.size([bar(1, 10, 12, 9, 11), bar(2, 11, 13, 10, 12), bar(3, 12, 14, 11, 13)], "atr", 0, 2, 0.05);
ok(s === 3, "ATR(2) of ranges 3, 3 = 3", s);
ok(CT.size([], "fixed", 7.3, 14, 0.5) === 7.5, "fixed size rounded to the tick (7.3 -> 7.5)");
ok(CT.timeBased("ha") && !CT.timeBased("renko") && !CT.ohlc("line"), "type flags");
console.log(fails ? `${fails} FAILED` : "ALL PASSED");
process.exit(fails ? 1 : 0);
