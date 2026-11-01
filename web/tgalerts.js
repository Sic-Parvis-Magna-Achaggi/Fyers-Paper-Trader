/* Settings › Telegram alerts (admin): your own bot, the chat, which alerts, the watchdog's state, the optional outside
   heartbeat; and a "Telegram alerts" line on the Account page's Live card. Server: /api/telegram*, helper/alerts.py,
   helper/watchdog.py. Loaded after security.js and live.js: it wraps secRender (the drawer opening) and liveCard. */
"use strict";
const TG = {j: null, at: 0, chats: null};
const tq = s => document.querySelector(s);
const tesc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

async function tgLoad(force){
  if(!force && TG.j && Date.now() - TG.at < 20000) return TG.j;
  const j = await api("/api/telegram");
  TG.j = j.ok ? j : null; TG.at = Date.now();
  return TG.j;
}
function tgAgo(t){ if(!t) return ""; const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 90 ? `${s} s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : new Date(t * 1000).toLocaleString("en-GB", {timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"}); }
function tgMsg(id, text, ok){ const el = tq(id); if(!el) return; el.className = ok ? "ok-msg" : "err"; el.textContent = text || ""; }

async function tgRender(){
  const sec = tq("#tgSec"), box = tq("#tgBox"); if(!sec || !box) return;
  const j = await tgLoad(true);
  if(!j){ sec.classList.add("hide"); return; }                 // admin only (live trading is the admin's)
  sec.classList.remove("hide");
  const t = j.tg, w = j.watchdog || {}, A = t.alerts, hc = w.hc || null;
  const errs = ["helper", "watchdog"].map(k => (t.sent || {})[k] || {}).filter(x => x.error && (!x.t || x.error.t > x.t)).map(x => x.error);
  const status = t.ready ? `<div class="ok-msg" style="margin-top:4px">✓ Alerts go to <b>${tesc(t.chat_title || t.chat)}</b> from <b>${tesc(t.bot)}</b>.</div>`
    : t.token_set ? `<p class="help">Bot <b>${tesc(t.bot)}</b> saved. Now choose the chat (step 3).</p>` : `<p class="help"><b>Not set up yet.</b></p>`;
  const wd = w.running ? `<p class="help" id="tgWd">Watchdog: <span class="up">running</span> (checked ${tesc(tgAgo(Date.now() / 1000 - (w.age || 0)))}).</p>`
    : `<div class="note warnc" id="tgWd">⚠ The watchdog isn't running on the server, so the "server isn't responding" message can't be sent.
       It's installed and started with this update (service fyers-watchdog). If this stays, on the server console: <span class="mono">systemctl status fyers-watchdog</span>.</div>`;
  const n = (k, lo, hi) => `<input class="mono tgn" id="tg_${k}" value="${A[k]}" inputmode="numeric" style="width:58px" data-lo="${lo}" data-hi="${hi}">`;
  box.innerHTML = `<p class="help">A Telegram message if the server stops looking after a live trade: it stops answering, a live
      warning stays, or prices stop. Only while a Live account has a position or an order at Fyers.</p>
    ${status}${wd}
    ${errs.map(e => `<div class="note warnc">⚠ The last message failed (${tesc(tgAgo(e.t))}): ${tesc(e.msg)}</div>`).join("")}
    <details id="tgSetup" ${t.ready ? "" : "open"}><summary class="help" style="cursor:pointer"><b>${t.ready ? "Change the bot or the chat" : "Set it up (4 steps)"}</b></summary>
      <ol class="steps">
        <li>In Telegram, open <b>@BotFather</b>, send <span class="mono">/newbot</span> and copy the token it gives you. (The journal's bot works too.)</li>
        <li>Paste it here (it's saved encrypted; asks for your 2FA code):
          <div class="inl" style="grid-template-columns:1fr auto"><input id="tgTok" class="mono" type="password" autocomplete="off" placeholder="${t.token_set ? "saved - paste a new one to change it" : "123456789:AAH…"}"><button id="tgTokGo">Save</button></div>
          <div id="tgTokMsg"></div></li>
        <li>Send your bot any message (e.g. <i>hi</i>) - or add it to a channel or group and post there - then:
          <div class="btns"><button id="tgFind" ${t.token_set ? "" : "disabled"}>Find my chat</button></div>
          <div id="tgChats"></div>
          <label>or type the chat ID</label><div class="inl" style="grid-template-columns:1fr auto"><input id="tgChat" class="mono" value="${tesc(t.chat)}" placeholder="123456789 or -100…"><button id="tgChatGo" ${t.token_set ? "" : "disabled"}>Use</button></div>
          <div id="tgChatMsg"></div></li>
        <li><div class="btns" style="margin-top:2px"><button id="tgTest" ${t.ready ? "" : "disabled"}>Send a test message</button></div><div id="tgTestMsg"></div></li>
      </ol></details>
    <h4>What's sent</h4>
    <label class="chk"><input type="checkbox" id="tg_down" ${A.down ? "checked" : ""}> The server isn't responding for ${n("down_sec", 15, 600)} s</label>
    <p class="help" style="margin-left:26px">With each trade and its stop at Fyers. A reminder every ${n("repeat_min", 0, 240)} min while it stays down (0 = once); a message when it's back.</p>
    <label class="chk"><input type="checkbox" id="tg_warn" ${A.warn ? "checked" : ""}> A live warning lasting ${n("warn_sec", 10, 600)} s</label>
    <p class="help" style="margin-left:26px">No stop at Fyers, a refused stop change, no Fyers login, a "check Fyers" alert. And "sorted" when it clears.</p>
    <label class="chk"><input type="checkbox" id="tg_feed" ${A.feed ? "checked" : ""}> No prices for an open live trade for ${n("feed_sec", 20, 900)} s</label>
    <p class="help">Warnings and prices only in that market's hours. Outside them a server-down message arrives silently (no sound).</p>
    <div class="btns"><button class="primary" id="tgAlGo">Save alerts</button></div><div id="tgAlMsg"></div>
    <details id="tgHc" ${t.hc.set ? "open" : ""}><summary class="help" style="cursor:pointer"><b>If the whole server goes down</b> (optional)${t.hc.set ? ' · <span class="up">on</span>' : ""}</summary>
      <p class="help">If the server itself is off or cut off, nothing on it can send a message. A free outside service can:
        the watchdog pings it every minute while a live trade is open, and the service alerts you on Telegram when the pings stop.</p>
      <ol class="steps">
        <li>Sign up at <b>healthchecks.io</b> (free) and add a check: <b>Period 1 minute, Grace 2 minutes</b>.</li>
        <li>Integrations → <b>Telegram</b>: follow its steps so it can message you.</li>
        <li>Paste the check's <b>Ping URL</b> here.</li>
        <li>Optional: Settings → API Keys → create a key (<b>not</b> read-only) and paste it. Then the check is paused while you're
          flat, so it only alarms during live trades. Without it the watchdog pings all the time (an alarm whenever the server is down).</li>
      </ol>
      <label>Ping URL</label><input id="tgHcUrl" class="mono" autocomplete="off" placeholder="${tesc(t.hc.url || "https://hc-ping.com/…")}">
      <label>API key <span class="muted">(optional)</span></label><input id="tgHcKey" class="mono" type="password" autocomplete="off" placeholder="${t.hc.key_set ? "saved - paste a new one to change it" : ""}">
      <div class="btns"><button id="tgHcGo">Save</button>${t.hc.set ? '<button id="tgHcDel">Remove</button>' : ""}</div><div id="tgHcMsg"></div>
      ${hc ? `<p class="help" id="tgHcSt">Outside heartbeat: ${tesc(hc.mode || "")}${hc.ok ? ` · last ping ${tesc(tgAgo(hc.ok))}` : ""}${hc.paused ? " · paused (no live trade)" : ""}${hc.err ? ` · <span class="down">${tesc(hc.err)}</span>` : ""}</p>` : ""}
    </details>
    ${t.token_set ? '<div class="btns"><button class="danger" id="tgDel">Remove Telegram</button></div>' : ""}`;

  const save = async (body, msgId, okText) => {
    const r = await stepUp(() => api("/api/telegram/settings", {body}));
    if(r.error === "cancelled") return null;
    tgMsg(msgId, r.ok ? okText : r.error, r.ok);
    if(r.ok){ TG.j = null; setTimeout(tgRender, 900); }
    return r;
  };
  tq("#tgTokGo").onclick = () => { const v = tq("#tgTok").value.trim(); if(!v) return tgMsg("#tgTokMsg", "paste the token first"); tgMsg("#tgTokMsg", "Checking with Telegram…", true); save({token: v}, "#tgTokMsg", "Saved."); };
  tq("#tgFind").onclick = async () => {
    const el = tq("#tgChats"); el.innerHTML = `<p class="help">Asking Telegram…</p>`;
    const r = await api("/api/telegram/chats", {body: {}});
    if(!r.ok){ el.innerHTML = `<div class="err">${tesc(r.error)}</div>`; return; }
    if(!r.chats.length){ el.innerHTML = `<p class="help">Nothing yet. Send your bot a message in Telegram (or post in the channel it's in), wait a few seconds, then try again.</p>`; return; }
    el.innerHTML = `<p class="help">Tap the chat to use:</p><div class="btns">${r.chats.map((c, i) => `<button data-i="${i}">${tesc(c.title)} <span class="muted">${tesc(c.type)}</span></button>`).join("")}</div>`;
    el.querySelectorAll("[data-i]").forEach(b => b.onclick = () => { const c = r.chats[+b.dataset.i]; save({chat: c.id, chat_title: c.title}, "#tgChatMsg", `Using ${c.title}. Now send a test message.`); });
  };
  tq("#tgChatGo").onclick = () => save({chat: tq("#tgChat").value.trim(), chat_title: ""}, "#tgChatMsg", "Saved. Now send a test message.");
  tq("#tgTest").onclick = async () => { tgMsg("#tgTestMsg", "Sending…", true); const r = await api("/api/telegram/test", {body: {}}); tgMsg("#tgTestMsg", r.ok ? "Sent - check Telegram." : r.error, r.ok); };
  tq("#tgAlGo").onclick = async () => {
    const al = {down: tq("#tg_down").checked, warn: tq("#tg_warn").checked, feed: tq("#tg_feed").checked};
    for(const k of ["down_sec", "repeat_min", "warn_sec", "feed_sec"]) al[k] = tq("#tg_" + k).value;
    const r = await api("/api/telegram/settings", {body: {alerts: al}});
    tgMsg("#tgAlMsg", r.ok ? "Saved." : r.error, r.ok); if(r.ok) TG.j = null;
  };
  tq("#tgHcGo").onclick = () => { const url = tq("#tgHcUrl").value.trim(), key = tq("#tgHcKey").value.trim();
    if(!url && !t.hc.set) return tgMsg("#tgHcMsg", "paste the ping URL first");
    const body = {}; if(url) body.hc_url = url; if(key) body.hc_key = key;
    save(body, "#tgHcMsg", "Saved. The watchdog uses it within a minute."); };
  const hd = tq("#tgHcDel"); if(hd) hd.onclick = () => save({hc_url: ""}, "#tgHcMsg", "Removed.");
  const del = tq("#tgDel"); if(del) del.onclick = () => { if(confirm("Remove the Telegram bot? No alerts will be sent.")) save({remove: true}, "#tgAlMsg", "Removed."); };
}

/* the drawer opening runs secRender (security.js): render this section with it */
if(typeof secRender === "function"){ const sr0 = secRender; secRender = async function(){ const r = await sr0.apply(this, arguments); tgRender(); return r; }; }

/* the Account page's Live card: is anyone told if the server stops? */
if(typeof liveCard === "function"){
  const lc0 = liveCard;
  liveCard = async function(){
    const r = lc0.apply(this, arguments);
    const c = document.querySelector("#liveCard .pg-cards");
    if(c && !c.querySelector("#lvTg")){
      const d = document.createElement("div"); d.className = "pgc"; d.innerHTML = `<span>Telegram alerts</span><b id="lvTg" class="muted">…</b>`; c.append(d);
      const j = await tgLoad(false), el = document.querySelector("#lvTg");
      if(el && j){
        const t = j.tg, w = j.watchdog || {};
        el.innerHTML = !t.ready ? `<a href="#" class="warnc" id="lvTgSet">not set up</a>` : !w.running ? `<span class="warnc">on · watchdog not running</span>` : `<span class="up">on</span>`;
        const a = document.querySelector("#lvTgSet"); if(a) a.onclick = e => { e.preventDefault(); openDrawer(); setTimeout(() => { const s = tq("#tgSec"); s && s.scrollIntoView({block: "start"}); }, 400); };
      }
    }
    return r;
  };
}
