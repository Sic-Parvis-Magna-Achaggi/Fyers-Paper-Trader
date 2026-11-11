/* MT5 bridge (roadmap 8, stage a): Settings › MT5 bridge, the MT5 price pill, and what the chart's panel says on an MT5
   symbol. Server: helper/mt5.py, /api/mt5*. The EA (mt5/FTM_Bridge.mq5) runs in MT5 on the owner's laptop and calls out
   to the server; this page never talks to it. Loaded after tgalerts.js; it wraps secRender (the drawer opening) at once,
   and feedPill, renderBook and paperOnSymbol once the page's own script has run (DOMContentLoaded). */
"use strict";
const MT = {j: null, key: null};
const mq5 = s => document.querySelector(s);
const mesc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function mtAgo(t){ if(!t) return "never"; const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : new Date(t * 1000).toLocaleString("en-GB", {timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"}); }
function mtVer(v){ const m = /^(\d+)\.(\d+)/.exec(String(v || "")); return m ? +m[1] * 1000 + +m[2] : 0; }
function mtMoney(v, c){ return v == null ? "–" : Number(v).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2}) + (c ? " " + c : ""); }
function mtMsg(id, text, ok){ const el = mq5(id); if(!el) return; el.className = ok ? "ok-msg" : "err"; el.textContent = text || ""; }

async function mtRender(){
  const box = mq5("#mt5Box"); if(!box) return;
  const j = await api("/api/mt5");
  if(!j.ok){ box.innerHTML = `<p class="help">${mesc(j.error || "Couldn't read the MT5 bridge's state.")}</p>`; return; }
  MT.j = j;
  const url = j.url || location.origin;
  const rows = (j.bridges || []).map(b => `<div class="mtb${b.online ? " on" : ""}">
      <label class="chk" title="The terminal prices and candles come from"><input type="radio" name="mtPx" value="${b.login}" ${b.prices || (!j.price_from && j.price_login === b.login) ? "checked" : ""}>
        <b>${mesc(b.login)}</b> · ${mesc(b.server || "")}${b.demo ? ' <span class="tag">DEMO</span>' : ""}</label>
      <div class="help">${mesc(b.company || "")}${b.mode ? " · " + mesc(b.mode === "hedge" ? "Hedge" : b.mode === "netting" ? "Netting" : b.mode) : ""}
        · balance ${mtMoney(b.balance, b.currency)} · equity ${mtMoney(b.equity, b.currency)}</div>
      <div class="help">${b.online ? '<span class="up">● connected</span>' : '<span class="down">● not connected</span> · last heard ' + mesc(mtAgo(b.seen))}
        ${b.ip ? " · from " + mesc(b.ip) : ""}${b.ea ? " · EA " + mesc(b.ea) : ""}${b.prices ? " · <b>prices from here</b>" : ""}</div>
      ${b.ea && mtVer(b.ea) < mtVer(j.ea_latest) ? `<div class="help warnc">EA ${mesc(b.ea)}: install ${mesc(j.ea_latest)} (step 1-2 below) to see and manage this account's trades here.</div>` : ""}</div>`).join("");
  const keyLine = j.key_set ? `<p class="help">Bridge key: <span class="up">set</span> (made ${mesc(mtAgo(j.key_made))}).</p>`
    : `<p class="help">Bridge key: <b>none yet</b>. Make one (step 3) to connect the EA.</p>`;
  box.innerHTML = `<p class="help">Prices and charts from your own MT5 terminal (FundingPips), through the <b>FTM Bridge</b> EA on
      your laptop. Every chart type, indicator and Pine script works on them. The EA only calls out to this server; nothing
      connects in to your laptop, and this server never logs in to your broker account.</p>
    <p class="help"><b>Version ${mesc(j.ea_latest || "1.20")}</b> also makes each terminal's account an <b>MT5 account</b> in this app (MT5 at the top
      left): its positions, orders, balance and history from MT5; the orders you place there (each with its real SL / TP) and
      managing them (SL / TP, BE, trailing, close, cancel), only while its <b>AllowTrading</b> input is on. If it can't reach
      this server for 20 s it goes on trailing your trades' stops by itself, as you set them. <b>It opens nothing on its own.</b></p>
    <div class="note">FundingPips: run MT5 and the EA only on your own laptop at home. No VPS, no VPN.</div>
    ${rows ? `<h4>Terminals</h4>${rows}` : `<p class="help"><b>No terminal has connected yet.</b></p>`}
    ${j.bridges && j.bridges.length > 1 ? `<p class="help">Prices come from the ticked terminal while it's connected, otherwise from the one heard from last.</p>` : ""}
    <div id="mtPxMsg"></div>
    ${keyLine}
    <details id="mtSetup" ${j.key_set && (j.bridges || []).length ? "" : "open"}><summary class="help" style="cursor:pointer"><b>Set it up (5 steps)</b></summary>
      <ol class="steps">
        <li><a href="/api/mt5/ea" download="FTM_Bridge.mq5">Download FTM_Bridge.mq5</a> (also in your repo, folder <span class="mono">mt5/</span>).
          In MT5: <b>File › Open Data Folder</b>, then <span class="mono">MQL5\\Experts</span>; put the file there.</li>
        <li>Open it in <b>MetaEditor</b> (F4 in MT5) and <b>Compile</b> (F7). It should end with "0 errors". Keep the source:
          it's your proof that the EA is your own.</li>
        <li>Make a bridge key (asks for your 2FA code; making a new one stops the old one):
          <div class="btns"><button id="mtKeyNew">${j.key_set ? "Make a new key" : "Make a key"}</button>${j.key_set ? '<button class="ghost" id="mtKeyDel">Remove the key</button>' : ""}</div>
          <div id="mtKeyBox"></div><div id="mtKeyMsg"></div></li>
        <li>In MT5: <b>Tools › Options › Expert Advisors</b>: tick <b>Allow WebRequest for listed URL</b> and add
          <div class="copy"><input id="mtUrl" class="mono" readonly value="${mesc(url)}"><button id="mtUrlCopy">Copy</button></div></li>
        <li>Drag <b>FTM_Bridge</b> from the Navigator onto any chart. In its <b>Inputs</b>, paste the key into <b>BridgeKey</b>
          (ServerURL is already this address). The chart's corner then says <i>connected</i>, and the terminal shows up above.
          To manage its trades from here: tick <b>Allow Algo Trading</b> in the EA's <b>Common</b> tab and keep MT5's <b>Algo Trading</b>
          button on (input <b>AllowTrading</b> = false keeps the app's hands off: it only shows the account).</li>
      </ol>
      <p class="help">Then search for a symbol in <b>Find</b> (the MT5 button shows only these) and open it. MT5 adds the symbols you
        open to its Market Watch: it only sends prices for symbols there.</p></details>
    <h4>The broker's clock</h4>
    <div class="seg" id="mtClock"><button data-v="us" class="${j.clock !== "fixed" ? "on" : ""}">Moves with US summer time</button><button data-v="fixed" class="${j.clock === "fixed" ? "on" : ""}">Never changes</button></div>
    <p class="help">The broker's server time is now GMT${j.offset >= 0 ? "+" : "−"}${Math.abs(j.offset / 3600)}, so its day starts at
      <b>${mesc(j.day_ist)} IST</b>. Most brokers (FundingPips too) move their clock with US summer time; older candles are
      placed by this rule. Changing it reloads the MT5 candles.</p><div id="mtClockMsg"></div>
    ${j.symbols ? `<p class="help">${j.symbols} symbols known from your broker.</p>` : ""}`;
  box.querySelectorAll('input[name="mtPx"]').forEach(r => r.onchange = async () => {
    const x = await api("/api/mt5/settings", {body: {price_login: +r.value}});
    mtMsg("#mtPxMsg", x.ok ? "Saved." : x.error, x.ok); });
  box.querySelectorAll("#mtClock button").forEach(b => b.onclick = async () => {
    if(b.classList.contains("on")) return;
    const x = await api("/api/mt5/settings", {body: {clock: b.dataset.v}});
    if(x.ok){ mtRender(); toast("Saved: MT5 candles load again"); } else mtMsg("#mtClockMsg", x.error); });
  mq5("#mtUrlCopy").onclick = () => { const i = mq5("#mtUrl"); i.select(); try{ navigator.clipboard.writeText(i.value); }catch(e){ document.execCommand("copy"); } toast("Copied"); };
  mq5("#mtKeyNew").onclick = async () => {
    if(j.key_set && !confirm("Make a new key? The EA stops connecting until you paste the new key into it.")) return;
    const x = await stepUp(() => api("/api/mt5/key", {body: {action: "new"}}));
    if(!x.ok){ if(x.error !== "cancelled") mtMsg("#mtKeyMsg", x.error); return; }
    mtKeyShow(x.key);
  };
  const del = mq5("#mtKeyDel");
  if(del) del.onclick = async () => {
    if(!confirm("Remove the bridge key? The EA stops connecting.")) return;
    const x = await stepUp(() => api("/api/mt5/key", {body: {action: "revoke"}}));
    if(x.ok){ toast("Bridge key removed"); mtRender(); } else if(x.error !== "cancelled") mtMsg("#mtKeyMsg", x.error);
  };
}
function mtKeyShow(key){
  const b = mq5("#mtKeyBox"); if(!b) return;
  b.innerHTML = `<div class="note warnc"><b>Copy this key into the EA's BridgeKey input now.</b> It isn't shown again (only a
      fingerprint of it is kept). Don't paste it anywhere else.</div>
    <div class="copy"><input id="mtKey" class="mono" readonly value="${mesc(key)}"><button id="mtKeyCopy">Copy</button></div>`;
  mq5("#mtKeyCopy").onclick = () => { const i = mq5("#mtKey"); i.select(); try{ navigator.clipboard.writeText(i.value); }catch(e){ document.execCommand("copy"); } toast("Copied"); };
  const d = mq5("#mtSetup"); if(d) d.open = true;
}

/* the phone has no pill: a warning line while an MT5 chart is open and MT5 is off */
function mtPhoneWarn(){
  const m = MT.fd && MT.fd.mt5;
  return m && !m.on && typeof curMT5 === "function" && curMT5() ? `MT5 isn't connected · <a href="#" data-w="set">Settings</a>` : "";
}

/* "MT5" inside the Prices pill (green: prices arriving, red: MT5 off), while this page shows an MT5 symbol (the chart or
   the watchlist). Kept that small because the header is full. */
function mtPill(fd){
  if(fd) MT.fd = fd;
  const p = mq5("#pMt5"); if(!p) return;
  const m = (fd || MT.fd || {}).mt5;
  const used = (typeof curMT5 === "function" && curMT5()) || (typeof watch !== "undefined" && watch.some(w => isMT5(w.s)));
  p.classList.toggle("hide", !m || !used);
  if(!m) return;
  p.classList.toggle("on", !!m.on); p.classList.toggle("off", !m.on);
  p.title = m.on ? `Prices from your MT5 terminal ${m.login} (${m.server || ""})` : "Your MT5 terminal isn't connected: start MT5 with the FTM Bridge EA (Settings › MT5 bridge)";
}

if(typeof secRender === "function"){ const sr0 = secRender; secRender = async function(){ const r = await sr0.apply(this, arguments); mtRender(); return r; }; }

document.addEventListener("DOMContentLoaded", () => {
  const p = mq5("#pMt5");
  if(p) p.onclick = e => { e.stopPropagation(); openDrawer(); setTimeout(() => { const s = mq5("#mt5Sec"); if(s) s.scrollIntoView({block: "start"}); }, 120); };
  if(typeof feedPill === "function"){ const fp = feedPill; feedPill = function(fd){ if(fd) MT.fd = fd; const r = fp.apply(this, arguments); mtPill(fd); return r; }; }
  if(typeof openSymbol === "function"){ const os = openSymbol; openSymbol = function(){ const r = os.apply(this, arguments); mtPill(null); return r; }; }
  // the panel's Book tab: MT5 symbols have no order book here
  if(typeof renderBook === "function"){ const rb = renderBook; renderBook = function(d){
    if(typeof curMT5 === "function" && curMT5()){ const box = mq5("#bookBox");
      if(box && typeof P !== "undefined" && P.tab === "book") box.innerHTML = `<div class="empty">No order book for MT5 symbols.</div>`; return; }
    return rb.apply(this, arguments); }; }
  // the ticket's hint on an MT5 chart: paper accounts trade Fyers contracts; MT5 trades are on the MT5 side (mt5acct.js has its own hint)
  if(typeof paperOnSymbol === "function"){ const po = paperOnSymbol; paperOnSymbol = function(row){
    const r = po.apply(this, arguments), h = mq5("#tkHint");
    if(h && !(typeof mtOn === "function" && mtOn())){ if(!h.dataset.txt) h.dataset.txt = h.textContent;
      h.textContent = row && isMT5(row.s) ? "MT5 symbols aren't traded on paper accounts: trade them on the MT5 side (top left)." : h.dataset.txt; }
    return r; }; }
});
