// Extracted verbatim from octagon_journal.html (the owner's Octagon journal) for tests/journal_test.py:
// the server's port (helper/journal.py) must give the same pillars and sessions. Stubs at the bottom.
"use strict";
const OCT = {
  direction: { label: "Direction", values: ["Correct", "Wrong"], tone: { Correct: "good", Wrong: "bad" }, icon: { Correct: "✓", Wrong: "✗" } },
  wait: { label: "Wait state", values: ["Patient", "Restless", "Rushed"], tone: { Patient: "good", Restless: "warn", Rushed: "bad2" }, icon: { Patient: "", Restless: "", Rushed: "" } },
  execution: { label: "Execution", values: ["Correct", "Wrong"], tone: { Correct: "good", Wrong: "bad" }, icon: { Correct: "✓", Wrong: "✗" } },
  zen: { label: "Zen Temple", values: ["Sanctuary", "Compromised"], tone: { Sanctuary: "good", Compromised: "bad" }, icon: { Sanctuary: "🛕", Compromised: "✗" } },
  target: { label: "Target", values: ["Realistic", "Stretched"], tone: { Realistic: "good", Stretched: "bad" }, icon: { Realistic: "✓", Stretched: "✗" } },
  // the market's character at the click — recorded, not judged
  regime: { label: "Market regime", values: ["Thin and Jumpy", "Active Expansion", "Dormant", "Absorption"], tone: { "Thin and Jumpy": "calm", "Active Expansion": "calm", Dormant: "calm", Absorption: "calm" }, icon: {} }
};
const PILLARS = [
  { n: 1, title: "Direction & Market Regime", short: "Direction", rule: "15M break of structure with candle close, 9/34 daylight, TradingView regime confirms. TradingView for context, MT5 for routing only. No regime alignment = zero trades." },
  { n: 2, title: "Wait State", short: "Wait", rule: "Only Patient may click. Restless (amber) or Rushed (red) = strict lockout." },
  { n: 3, title: "Execution & Trade Completion", short: "Execution", rule: "Enter strictly on a confirmed candle close, single bracket, zero mid-trade tinkering. Finish the rep: bank realistic targets, trail defense cleanly." },
  { n: 4, title: "2% Trailing Drawdown", short: "2% DD", rule: "Equity pulls back 2% of base from any session peak → immediate terminal lockout, zero debate." },
  { n: 5, title: "3 Wins — The 99 Club", short: "99 Club", rule: "3 consecutive wins or 3 multi-R wins → 20-minute AFK. Mind running numbers or chasing a milestone → end the session at peak equity. Walk away with the 99 coins." },
  { n: 6, title: "5% Execution Blocks", short: "5% Blocks", rule: "Personal Account Mode: ignore payout dates, work in mechanical 5% equity blocks, focus entirely on clean reps." },
  { n: 7, title: "The Zen Temple", short: "Zen", rule: "Trade only in an isolated sanctuary. Family and workplace spaces are blackouts. A compromised trade is Execution: Wrong (Zen Temple Breach)." },
  { n: 8, title: "Sic Parvis Magna", short: "Sic Parvis", rule: "Take structural targets (+1.5R to +2R) and trail as the move delivers. Never stretch targets into hope or withhold the trail to “give room”." }
];
const EXEC_FAULTS = [["frontran", "Front-ran a wick / mid-candle entry"], ["tinkered", "Tinkered mid-trade"], ["bracket", "Not a single bracket"], ["overheld", "Held past the structural target"], ["zen", "Zen Temple breach"]];
const P1_CHECKS = [["bos15", "15M BOS, candle closed"], ["ema934", "9/34 daylight"], ["tvRegime", "TradingView regime confirms"]];
function round2(n) { return Math.round(n * 100) / 100; }
function nthSunday(y, m0, n) {
  if (n > 0) { const d = new Date(Date.UTC(y, m0, 1)); return Date.UTC(y, m0, 1 + (7 - d.getUTCDay()) % 7 + (n - 1) * 7); }
  const last = new Date(Date.UTC(y, m0 + 1, 0));
  return Date.UTC(y, m0, last.getUTCDate() - last.getUTCDay());
}
function dstOn(utcMs, mode) {
  if (mode !== "us" && mode !== "eu") return false;
  const y = new Date(utcMs).getUTCFullYear();
  if (mode === "us") return utcMs >= nthSunday(y, 2, 2) + 7 * 3600e3 && utcMs < nthSunday(y, 10, 1) + 6 * 3600e3;
  return utcMs >= nthSunday(y, 2, -1) + 3600e3 && utcMs < nthSunday(y, 9, -1) + 3600e3;
}
function serverOffsetAt(utcMs) { const s = appState.settings; return Number(s.serverOffset || 0) + (dstOn(utcMs, s.serverDst) ? 1 : 0); }
function serverToUtc(str) {
  if (!str) return null;
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return naive - serverOffsetAt(naive - Number(appState.settings.serverOffset || 0) * 3600e3) * 3600e3;
}
function utcToServer(ms) { return new Date(ms + serverOffsetAt(ms) * 3600e3).toISOString().slice(0, 19).replace("T", " "); }
function sessionOf(utcMs) {
  if (utcMs === null) return "";
  const d = new Date(utcMs), h = d.getUTCHours() + d.getUTCMinutes() / 60;
  if (h < 7) return "Asia";
  if (h < 12) return "London";
  if (h < 16) return "London–NY overlap";
  if (h < 21) return "New York";
  return "Late / Sydney";
}
function metrics(t) {
  const dir = t.action === "sell" ? -1 : 1;
  const closed = !!t.closeTime && (t.closePrice !== null || (t.openPrice === null && t.grossPnl !== null)); // a journal row with only a P&L is a finished trade
  const net = t.grossPnl === null ? null : round2(t.grossPnl + (t.swap || 0) + (t.commission || 0));
  const openUtc = serverToUtc(t.openTime);
  const closeUtc = closed ? serverToUtc(t.closeTime) : null;
  const dur = !t.timeless && openUtc !== null && closeUtc !== null ? Math.max(0, Math.round((closeUtc - openUtc) / 1000)) : null;
  const pts = closed && t.openPrice !== null ? (t.closePrice - t.openPrice) * dir : null;
  const stop = t.initialSl ?? t.sl;
  const riskPts = stop !== null && t.openPrice !== null ? (t.openPrice - stop) * dir : null;
  const risk = riskPts !== null && riskPts > 0 ? riskPts : null;
  const slLocked = riskPts !== null && riskPts <= 0;
  const r = risk && pts !== null ? pts / risk : null;
  const planned = risk && t.tp !== null ? ((t.tp - t.openPrice) * dir) / risk : null;
  const perPoint = pts !== null && t.grossPnl !== null && Math.abs(pts) > 1e-9 ? Math.abs(t.grossPnl / pts) : null;
  const riskCash = perPoint !== null && risk ? perPoint * risk : null;
  return { dir, closed, net, openUtc, closeUtc, dur, pts, risk, slLocked, r, planned, perPoint, riskCash,
    session: t.timeless ? null : sessionOf(openUtc), sortKey: openUtc ?? Date.parse(t.createdAt), dayMs: closeUtc ?? openUtc ?? Date.parse(t.createdAt) };
}
function hm(ms) { return ms === null || ms === undefined ? "—" : utcToServer(ms).slice(11, 16); }
function sessionKeyOf(t) { return `${t.accountId || ""}|${(t.openTime || "").slice(0, 10)}`; }
function sessionEngine(list) {
  const R = appState.settings.rules;
  const base = accountBase(list[0].accountId);
  const limit = base * R.ddPct / 100, afk = R.afkMin * 60e3;
  const items = list.map((t) => ({ t, m: metrics(t) }));
  const closes = items.filter((x) => x.m.closed && x.m.net !== null && x.m.closeUtc !== null).sort((a, b) => a.m.closeUtc - b.m.closeUtc);
  let cum = 0, peak = 0, maxDd = 0, streak = 0, multi = 0, ddLockAt = null;
  const lockouts = [], winTimes = [];
  for (const x of closes) {
    cum = round2(cum + x.m.net);
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
    if (ddLockAt === null && peak - cum >= limit - 0.005) ddLockAt = x.m.closeUtc;
    if (x.m.net > 0) { winTimes.push(x.m.closeUtc); streak++; if (x.m.r !== null && x.m.r >= R.multiR) multi++; }
    else streak = 0;
    if (streak >= R.winStreak) { lockouts.push({ from: x.m.closeUtc, to: x.m.closeUtc + afk, why: `${R.winStreak} consecutive wins` }); streak = 0; }
    if (multi >= R.winStreak) { lockouts.push({ from: x.m.closeUtc, to: x.m.closeUtc + afk, why: `${R.winStreak} multi-R wins (≥${R.multiR}R)` }); multi = 0; }
  }
  const nr = items.filter((x) => x.t.numberRunning && x.m.openUtc !== null).map((x) => x.m.openUtc);
  return { accountId: list[0].accountId || "", day: (list[0].openTime || "").slice(0, 10), base, limit, cum, peak, dd: round2(peak - cum), maxDd: round2(maxDd), ddLockAt, lockouts, winTimes,
    termAt: nr.length ? Math.min(...nr) : null, streak, multi, count: list.length, closed: closes.length };
}
function targetNeeded(m) { return m.closed && m.net !== null && m.net >= 0; }
function auditTrade(t, s) {
  const R = appState.settings.rules, m = metrics(t), P = {}, breaches = [], warns = [];
  const set = (k, state, note = "") => { P[k] = { state, note }; if (state === "fail") breaches.push({ p: k, note }); if (state === "warn") warns.push({ p: k, note }); };
  set("p1", !t.direction ? "na" : t.direction === "Correct" ? "pass" : "fail", "Direction / regime not aligned — no regime alignment = zero trades");
  set("p2", !t.wait ? "na" : t.wait === "Patient" ? "pass" : "fail", `Clicked while ${t.wait} — only Patient may click`);
  const zenBreach = t.zen === "Compromised";
  const faults = t.execFaults.map((k) => (EXEC_FAULTS.find((f) => f[0] === k) || [k, k])[1]);
  if (zenBreach && !t.execFaults.includes("zen")) faults.push("Zen Temple breach");
  set("p3", !t.execution && !zenBreach ? "na" : (t.execution === "Wrong" || zenBreach) ? "fail" : "pass", `Execution wrong${faults.length ? ": " + faults.join(", ") : ""}`);
  const open = m.openUtc;
  if (!s || open === null) { set("p4", "na"); set("p5", t.numberRunning ? "fail" : "na", "Mind was running numbers — the session should have ended"); }
  else {
    if (s.ddLockAt !== null && open > s.ddLockAt) set("p4", "fail", `Opened after the ${R.ddPct}% trailing-drawdown lockout (hit ${hm(s.ddLockAt)} broker)`);
    else set("p4", "pass");
    const notes = [];
    const lo = t.timeless ? null : s.lockouts.find((l) => open >= l.from && open < l.to); // no clock times → AFK windows can't be checked
    if (lo) notes.push(`Opened inside the ${R.afkMin}-min AFK after ${lo.why} (until ${hm(lo.to)})`);
    if (t.numberRunning) notes.push("Mind was running numbers — the session should have ended at peak equity");
    else if (s.termAt !== null && open > s.termAt) notes.push(`Session should have ended at ${hm(s.termAt)} — numbers were running`);
    // The 99 Club protects a run of wins: until the session's first win there is nothing to protect
    const winsBefore = s.winTimes.filter((w) => w <= open && !(t.timeless && w === m.closeUtc)).length;
    if (notes.length) set("p5", "fail", notes.join("; "));
    else if (!winsBefore) set("p5", "off", "No wins yet this session — the 99 Club doesn't apply");
    else set("p5", "pass");
  }
  set("p6", t.payoutPressure ? "fail" : (t.octVer >= 2 ? "pass" : "na"), "Traded the payout date / balance instead of the chart");
  set("p7", !t.zen ? "na" : zenBreach ? "fail" : "pass", "Traded outside the sanctuary (Zen Temple breach)");
  const stretchedPlan = m.planned !== null && m.planned > R.stretchR;
  const planNote = stretchedPlan ? `T/P at ${m.planned.toFixed(1)}R — beyond the structural +1.5R to +2R` : "";
  const needTarget = targetNeeded(m);
  if (t.target === "Stretched") set("p8", "fail", "Stretched the target / withheld the trail" + (planNote ? ` (${planNote})` : ""));
  else if (stretchedPlan) set("p8", "warn", planNote);
  else if (t.target) set("p8", "pass");
  else set("p8", needTarget ? "na" : "off", m.closed ? "A losing trade — Sic Parvis Magna is optional" : "Still open — recorded once it closes");
  const recorded = !!(t.direction && t.wait && t.execution && t.zen && (t.target || !needTarget));
  return { P, breaches, warns, recorded, clean: recorded && !breaches.length };
}
function computeAudit(trades) {
  const groups = new Map(), byId = new Map(), sessions = new Map();
  trades.forEach((t) => { if (!t.openTime) return; const k = sessionKeyOf(t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
  for (const [k, list] of groups) { const s = sessionEngine(list); sessions.set(k, s); list.forEach((t) => byId.set(t.id, auditTrade(t, s))); }
  trades.forEach((t) => { if (!byId.has(t.id)) byId.set(t.id, auditTrade(t, null)); });
  return { byId, sessions };
}
const p2 = (n) => String(n).padStart(2, "0");
let appState = { settings: { serverOffset: 0, serverDst: "none", rules: {} } };
let BASE = 25000;
function accountBase() { return BASE; }
module.exports = { setRules(r, base) { appState.settings.rules = r; BASE = base; }, computeAudit, metrics, sessionEngine };
