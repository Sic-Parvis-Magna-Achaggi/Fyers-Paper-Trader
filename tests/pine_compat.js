// Pine compatibility battery: scripts that between them use most of Pine (plots of every kind, the ta.* library,
// drawings by bar index and by time, tables, arrays and maps, functions, request.security, inputs, var / varip,
// barstate, time and session). tests/charttypes_flow.js runs every one on every chart type the same way the chart
// does; a script that works on candles must work on all of them (owner's rule: P&F included).
// Add a script here whenever the app gains a Pine feature.
module.exports = [
  {name: "MA, EMA, BB, fill", code: `//@version=5
indicator("C MA BB", overlay=true)
len = input.int(20, "Length")
basis = ta.sma(close, len)
dev = 2 * ta.stdev(close, len)
u = plot(basis + dev, "Upper", color=color.teal)
l = plot(basis - dev, "Lower", color=color.teal)
fill(u, l, color=color.new(color.teal, 90))
plot(ta.ema(close, 9), "EMA", color=color.orange)
plot(ta.wma(hl2, 10), "WMA")`, plots: 4},
  {name: "RSI, MACD, stoch in a pane, hlines", code: `//@version=5
indicator("C Osc", overlay=false)
r = ta.rsi(close, 14)
[m, s, h] = ta.macd(close, 12, 26, 9)
k = ta.sma(ta.stoch(close, high, low, 14), 3)
plot(r, "RSI")
plot(m, "MACD")
plot(s, "Signal")
plot(h, "Hist", style=plot.style_histogram)
plot(k, "Stoch K")
h1 = hline(70, "Upper")
h2 = hline(30, "Lower")
fill(h1, h2, color=color.new(color.purple, 92))`, plots: 5},
  {name: "ATR, Supertrend, CCI, MFI, OBV, ADX", code: `//@version=5
indicator("C Trend", overlay=false)
[st, dir] = ta.supertrend(3, 10)
[dip, dim, adx] = ta.dmi(14, 14)
plot(ta.atr(14), "ATR")
plot(dir, "ST dir")
plot(ta.cci(hlc3, 20), "CCI")
plot(ta.mfi(hlc3, 14), "MFI")
plot(ta.obv, "OBV")
plot(adx, "ADX")`, plots: 6},
  {name: "shapes, chars, arrows, bgcolor, barcolor", code: `//@version=5
indicator("C Shapes", overlay=true)
up = ta.crossover(ta.ema(close, 5), ta.ema(close, 13))
dn = ta.crossunder(ta.ema(close, 5), ta.ema(close, 13))
plotshape(up, "Up", shape.triangleup, location.belowbar, color.green)
plotshape(dn, "Down", shape.triangledown, location.abovebar, color.red)
plotchar(up, "UpC", "▲", location.bottom)
plotarrow(up ? 1 : dn ? -1 : na, "Arrow")
bgcolor(up ? color.new(color.green, 85) : na)
barcolor(close > open ? color.lime : na)`, plots: 4},
  {name: "drawings by bar index: pivots with lines, labels, boxes", code: `//@version=5
indicator("C Draw", overlay=true, max_lines_count=50, max_labels_count=50, max_boxes_count=20)
ph = ta.pivothigh(high, 3, 3)
pl = ta.pivotlow(low, 3, 3)
var float lastH = na
var int lastHi = na
if not na(ph)
    label.new(bar_index - 3, ph, "H", style=label.style_label_down)
    if not na(lastH)
        line.new(lastHi, lastH, bar_index - 3, ph, color=color.red)
    lastH := ph
    lastHi := bar_index - 3
if not na(pl)
    box.new(bar_index - 4, pl + syminfo.mintick * 2, bar_index - 2, pl, bgcolor=color.new(color.blue, 80))`, drawings: ["__labels__", "__lines__", "__boxes__"]},
  {name: "drawings by time, table, barstate", code: `//@version=5
indicator("C Time", overlay=true)
var table t = table.new(position.top_right, 2, 2)
if barstate.islast
    table.cell(t, 0, 0, "Bars")
    table.cell(t, 1, 0, str.tostring(bar_index + 1))
    line.new(time[10], close[10], time, close, xloc=xloc.bar_time, color=color.yellow)
    label.new(time, high, "now", xloc=xloc.bar_time)
plot(barstate.isconfirmed ? close : na, "Confirmed")`, drawings: ["__lines__", "__labels__", "__tables__"]},
  {name: "arrays, maps, functions, loops, var / varip", code: `//@version=5
indicator("C Lang")
f(src, n) =>
    s = 0.0
    for i = 0 to n - 1
        s += src[i]
    s / n
var a = array.new_float()
array.push(a, close)
if array.size(a) > 20
    array.shift(a)
var m = map.new<string, float>()
map.put(m, "last", close)
varip int ticks = 0
ticks += 1
plot(f(close, 10), "My SMA")
plot(array.avg(a), "Array avg")
plot(map.get(m, "last"), "Map")`, plots: 3},
  {name: "request.security: a higher timeframe", code: `//@version=5
indicator("C HTF", overlay=true)
h = request.security(syminfo.tickerid, "60", ta.ema(close, 5))
plot(h, "1h EMA")`, plots: 1},
  {name: "time, session and math", code: `//@version=5
indicator("C Clock")
plot(hour(time, "Asia/Kolkata"), "Hour")
plot(dayofweek, "Day")
plot(math.round(math.log(close), 4), "Log")
plot(ta.change(close), "Change")
plot(ta.highest(high, 20) - ta.lowest(low, 20), "Range 20")`, plots: 5},
  {name: "import a library (TradingView/ta)", code: `//@version=6
indicator("C Import", overlay=true)
import TradingView/ta/11 as TVta
[l, s] = TVta.chandelier(22, 22, 3.0)
[st, dir] = TVta.supertrend(3, 10)
plot(l, "Long exit")
plot(s, "Short exit")
plot(st, "Supertrend")`, plots: 3},
  {name: "the indicator's own timeframe (timeframe = 1 hour)", code: `//@version=6
indicator("C Own TF", overlay=true, timeframe = "60", timeframe_gaps = false)
plot(ta.ema(close, 5), "1h EMA")`, plots: 1},
  // v0.37.4: plot.style_linebr / steplinebr / areabr and a colour of na break the line (TradingView's way); the chart
  // library would join it across the na bars. `breaks` = plots that must not cross an na bar, `bridged` = plots that
  // must (plot.style_line joins over na on TradingView). pine_compat_flow.js checks the drawn series on every chart type.
  {name: "Chandelier Exit (everget, the owner's copy): linebr, fills, shapes", code: `//@version=6
// Copyright (c) 2019-present, Alex Orekhov (everget)
// Chandelier Exit script may be freely distributed under the terms of the GPL-3.0 license.
indicator('Chandelier Exit', shorttitle = 'CE', overlay = true)
const string calcGroup = 'Calculation'
length = input.int(22, title = 'ATR Period', group = calcGroup)
mult = input.float(3.0, step = 0.1, title = 'ATR Multiplier', group = calcGroup)
useClose = input.bool(true, title = 'Use Close Price for Extremums', group = calcGroup)
const string visualGroup = 'Visuals'
showLabels = input.bool(true, title = 'Show Buy/Sell Labels', group = visualGroup)
highlightState = input.bool(true, title = 'Highlight State', group = visualGroup)
const string alertGroup = 'Alerts'
awaitBarConfirmation = input.bool(true, title = 'Await Bar Confirmation', group = alertGroup)
atr = mult * ta.atr(length)
longStop = (useClose ? ta.highest(close, length) : ta.highest(length)) - atr
longStopPrev = nz(longStop[1], longStop)
longStop := close[1] > longStopPrev ? math.max(longStop, longStopPrev) : longStop
shortStop = (useClose ? ta.lowest(close, length) : ta.lowest(length)) + atr
shortStopPrev = nz(shortStop[1], shortStop)
shortStop := close[1] < shortStopPrev ? math.min(shortStop, shortStopPrev) : shortStop
var int dir = 1
dir := close > shortStopPrev ? 1 : close < longStopPrev ? -1 : dir
const color textColor = color.white
const color longColor = color.green
const color shortColor = color.red
const color longFillColor = color.new(color.green, 85)
const color shortFillColor = color.new(color.red, 85)
buySignal = dir == 1 and dir[1] == -1
longStopPlot = plot(dir == 1 ? longStop : na, title = 'Long Stop', style = plot.style_linebr, linewidth = 2, color = longColor)
plotshape(buySignal ? longStop : na, title = 'Long Stop Start', location = location.absolute, style = shape.circle, size = size.tiny, color = longColor)
plotshape(buySignal and showLabels ? longStop : na, title = 'Buy Label', text = 'Buy', location = location.absolute, style = shape.labelup, size = size.tiny, color = longColor, textcolor = textColor)
sellSignal = dir == -1 and dir[1] == 1
shortStopPlot = plot(dir == 1 ? na : shortStop, title = 'Short Stop', style = plot.style_linebr, linewidth = 2, color = shortColor)
plotshape(sellSignal ? shortStop : na, title = 'Short Stop Start', location = location.absolute, style = shape.circle, size = size.tiny, color = shortColor)
plotshape(sellSignal and showLabels ? shortStop : na, title = 'Sell Label', text = 'Sell', location = location.absolute, style = shape.labeldown, size = size.tiny, color = shortColor, textcolor = textColor)
midPricePlot = plot(ohlc4, title = '', display = display.none, editable = false)
fill(midPricePlot, longStopPlot, title = 'Long State Filling', color = (highlightState and dir == 1 ? longFillColor : na))
fill(midPricePlot, shortStopPlot, title = 'Short State Filling', color = (highlightState and dir == -1 ? shortFillColor : na))
await = awaitBarConfirmation ? barstate.isconfirmed : true
alertcondition(dir != dir[1] and await, title = 'CE Direction Change', message = 'Chandelier Exit has changed direction, {{exchange}}:{{ticker}}')
alertcondition(buySignal and await, title = 'CE Buy', message = 'Chandelier Exit Buy, {{exchange}}:{{ticker}}')
alertcondition(sellSignal and await, title = 'CE Sell', message = 'Chandelier Exit Sell, {{exchange}}:{{ticker}}')`, plots: 6, breaks: ["Long Stop", "Short Stop"]},
  {name: "breaks: linebr, steplinebr, areabr, colour na; style_line bridges", code: `//@version=6
indicator("C Breaks", overlay=true)
up = close > ta.sma(close, 10)
plot(up ? low : na, "LB", style=plot.style_linebr, color=color.green)
plot(up ? na : high, "SLB", style=plot.style_steplinebr, color=color.red)
plot(up ? hl2 : na, "AB", style=plot.style_areabr, color=color.blue)
plot(close, "CN", color = up ? color.orange : na)
plot(up ? close : na, "Bridged", color=color.gray)`, plots: 5, breaks: ["LB", "SLB", "AB", "CN"], bridged: ["Bridged"]},
];
