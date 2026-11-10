/* Settings as a page of its own (v0.35.0, roadmap 19; owner, 10 Nov 2026: "the settings can be a separate page instead
   of a tab. It looks too cramped"). The drawer (#drawer, same ids, same openDrawer / #bClose, so nothing else changes)
   now fills the window: a list of its sections on the left, each section in a card on the right. The sections are made
   here from the drawer's markup: each <h3> starts one; a <div> whose first child is an <h3> (Telegram alerts, MT5 bridge,
   Users) is a section itself, so its own show / hide (admin only) hides its list entry too. Loaded after mt5.js. */
"use strict";
const SETQ = s => document.querySelector(s);

function setSlug(t){ return "set-" + String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

function setBuild(){
  const d = SETQ("#drawer"), db = d && d.querySelector(".db");
  if(!db || db.dataset.built) return;
  db.dataset.built = "1";
  const nav = document.createElement("nav"); nav.id = "setNav";
  const body = document.createElement("div"); body.id = "setBody";
  let sec = null;
  const start = (title, el) => {
    sec = el || document.createElement("section");
    sec.classList.add("scard");
    if(!sec.id) sec.id = setSlug(title);
    sec.dataset.t = title.trim();
    body.append(sec);
  };
  for(const el of [...db.children]){
    if(el.tagName === "H3"){ start(el.textContent); sec.append(el); continue; }
    const h = el.tagName === "DIV" && el.firstElementChild && el.firstElementChild.tagName === "H3" ? el.firstElementChild : null;
    if(h){ start(h.textContent, el); continue; }
    if(!sec) start("General");
    sec.append(el);
  }
  db.append(nav, body);
  db.addEventListener("scroll", setSpy, {passive: true});
  setNav();
}

/* the list on the left (the chips along the top on the phone): one entry per section that isn't hidden */
function setNav(){
  const nav = SETQ("#setNav"); if(!nav) return;
  const secs = [...document.querySelectorAll("#setBody > .scard")];
  const want = secs.map(s => s.id + (s.classList.contains("hide") ? ":h" : "")).join(",");
  if(nav.dataset.k !== want){
    nav.dataset.k = want;
    nav.innerHTML = secs.filter(s => !s.classList.contains("hide"))
      .map(s => `<button data-s="${s.id}">${s.dataset.t.replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]))}</button>`).join("");
    nav.querySelectorAll("button").forEach(b => b.onclick = () => setGo(b.dataset.s));
  }
  setSpy();
}
function setGo(id){
  const el = document.getElementById(id), db = SETQ("#drawer .db"); if(!el || !db) return;
  SET_JUMP = Date.now();
  db.scrollTo({top: Math.max(0, el.offsetTop - (document.body.classList.contains("mob") ? 52 : 12))});   // (at once: a smooth scroll over a long page is slow)
  setMark(id);
}
let SET_JUMP = 0;
function setMark(id){
  document.querySelectorAll("#setNav button").forEach(b => b.classList.toggle("on", b.dataset.s === id));
  const on = SETQ("#setNav button.on");
  if(on && document.body.classList.contains("mob")) on.scrollIntoView({block: "nearest", inline: "nearest"});
}
/* while you scroll, the list marks the section you're in */
function setSpy(){
  if(Date.now() - SET_JUMP < 700) return;              // (a jump's smooth scroll: keep the one clicked)
  const db = SETQ("#drawer .db"); if(!db) return;
  const secs = [...document.querySelectorAll("#setBody > .scard:not(.hide)")];
  if(!secs.length) return;
  const top = db.scrollTop + (document.body.classList.contains("mob") ? 70 : 40);
  let cur = secs[0];
  for(const s of secs) if(s.offsetTop <= top) cur = s;
  if(db.scrollTop + db.clientHeight >= db.scrollHeight - 4) cur = secs[secs.length - 1];   // at the end: the last one
  setMark(cur.id);
}

/* opening and closing: the address says #settings while it's open (so a reload opens it again) */
let SET_BACK = null;
/* below the app's own top bar (its pages stay one click away; picking one closes Settings). The phone: full screen. */
function setTop(){
  const h = document.querySelector("#app > header");
  document.documentElement.style.setProperty("--sethdr", h && !document.body.classList.contains("mob") && h.offsetParent ? Math.round(h.getBoundingClientRect().bottom) + "px" : "0px");
}
function setOpened(){
  setTop(); setBuild(); setNav();
  if(location.hash !== "#settings"){ SET_BACK = location.hash || ""; history.replaceState(null, "", "#settings"); }
  setTimeout(setNav, 400);                              // (sections shown once the server answered: Telegram, MT5, Users)
}
function setClosed(){
  if(location.hash === "#settings") history.replaceState(null, "", (SET_BACK && SET_BACK !== "#settings" ? SET_BACK : location.pathname + location.search));
  SET_BACK = null;
}

document.addEventListener("DOMContentLoaded", () => {
  setBuild();
  // opened by openDrawer from anywhere (some callers hold the original function), closed by ← Back, Esc or code:
  // follow the drawer's own "open" class
  const dr = SETQ("#drawer");
  if(dr){ let was = dr.classList.contains("open");
    new MutationObserver(() => { const now = dr.classList.contains("open"); if(now !== was){ was = now; now ? setOpened() : setClosed(); } })
      .observe(dr, {attributes: true, attributeFilter: ["class"]}); }
  // Esc: back (not while a dialog or a code prompt is on top, or while typing)
  document.addEventListener("keydown", e => {
    if(e.key !== "Escape" || !SETQ("#drawer.open")) return;
    if(e.target.closest("#drawer input, #drawer select, #drawer textarea") && e.target.value) return;   // (typing in a setting)
    if(document.querySelector("#codeAsk:not(.hide), .modalwrap:not(.hide), #wlPop")) return;
    SETQ("#drawer").classList.remove("open");
  });
  // sections that show or hide later (admin-only ones, once the server answers)
  const body = SETQ("#setBody");
  if(body) new MutationObserver(() => setNav()).observe(body, {attributes: true, attributeFilter: ["class"], subtree: false, childList: true});
  for(const s of document.querySelectorAll("#setBody > .scard")) new MutationObserver(() => setNav()).observe(s, {attributes: true, attributeFilter: ["class"]});
  // logged out (or the session ended): Settings closes, so the next login starts on the app, not on someone's settings
  if(typeof showGate === "function"){ const sg = showGate; showGate = function(){ const d = SETQ("#drawer"); if(d) d.classList.remove("open"); return sg.apply(this, arguments); }; }
  document.addEventListener("click", e => { if(e.target.closest("#bLogout")){ const d = SETQ("#drawer"); if(d) d.classList.remove("open"); } }, true);
  addEventListener("resize", () => { if(SETQ("#drawer.open")) setTop(); });
  // a page picked in the top bar (Chart, Trades ...) closes Settings
  if(typeof pgShow === "function"){ const pg0 = pgShow; pgShow = function(name, fromHash){ const d = SETQ("#drawer"); if(!fromHash && d && d.classList.contains("open")) d.classList.remove("open"); return pg0.apply(this, arguments); }; }
  // a reload on #settings opens it again (once logged in)
  if(typeof pagesStart === "function"){ const ps = pagesStart; pagesStart = function(){ const r = ps.apply(this, arguments); if(location.hash === "#settings") openDrawer(); return r; }; }
});
