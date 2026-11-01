"""Live prices: one Fyers data socket per user (on that user's own Fyers login), shared by their open pages.

The page tells us which symbols it wants; we keep the union subscribed on the Fyers socket and pass
each tick to the pages that asked for it. If the socket isn't up, a slow quote poll (every 3 s) keeps
prices moving so the page never looks frozen.
"""
import asyncio
import logging
import threading
import time

from . import store

log = logging.getLogger("feed")


class Client:
    def __init__(self):
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=500)
        self.symbols: set = set()
        self.depth: set = set()         # symbols whose order books this page shows (Book tab or Book page)
        self.acct = None                # the paper account this page shows (its snapshots come here)


class Feed:
    def __init__(self, link=None, label: str = ""):
        self.link = link                # this user's FyersLink
        self.label = label
        self.loop = None
        self.clients: set = set()
        self.sock = None
        self.sock_token = ""
        self.sock_up = False
        self.subscribed: list = []
        self.dsubscribed: list = []     # symbols subscribed for market depth
        self.last: dict = {}            # symbol -> latest tick
        self.last_at: dict = {}         # symbol -> when it arrived
        self.last_depth: dict = {}      # symbol -> latest order book
        self.last_depth_at = 0.0
        self.last_tick_at = 0.0
        self._ops = threading.Lock()
        self.extra = None               # callable -> symbols the paper engine needs, page open or not
        self.on_tick = None             # callable(tick), run on the event loop

    # ------------------------------------------------------------ page side
    def start(self, loop):
        self.loop = loop
        self._wd = loop.create_task(self._watchdog())

    def add(self) -> Client:
        c = Client()
        self.clients.add(c)
        return c

    def remove(self, c: Client):
        self.clients.discard(c)
        self._resync()

    def want(self, c: Client, symbols: list):
        c.symbols = set([s for s in symbols if isinstance(s, str) and ":" in s][:40])   # a page: its chart + the list on screen (30)
        self._resync()
        for s in c.symbols:                       # send the last known price straight away
            if s in self.last:
                self._offer(c, {"tick": self.last[s]})

    def set_depth(self, c: Client, symbols):
        """One symbol, a list of up to 5, or None (no books)."""
        if isinstance(symbols, str):
            symbols = [symbols]
        new = {x for x in (symbols or []) if isinstance(x, str) and ":" in x}
        new = set(sorted(new)[:5])
        added = new - c.depth
        c.depth = new
        self._resync()
        for s in added:
            if s in self.last_depth:
                self._offer(c, {"depth": self.last_depth[s]})

    def wanted_depth(self) -> list:
        u = set()
        for c in self.clients:
            u |= c.depth
        return sorted(u)[:5]

    def wanted(self) -> list:
        u, first = set(), set()
        for c in self.clients:
            u |= c.symbols
        if self.extra:
            try:
                first = set(self.extra())          # open trades and orders (and the order-flow check): never cut
            except Exception as e:
                log.warning(self._tag() + "engine symbols: %s", e)
        return (sorted(first) + sorted(u - first))[:95]   # Standard plan: 100 symbols on the data socket

    def _offer(self, c: Client, msg: dict):
        try:
            c.queue.put_nowait(msg)
        except asyncio.QueueFull:
            pass

    def broadcast(self, msg: dict, acct=None):
        """Send a message to this user's open pages - only those showing `acct` when given (call on the event loop)."""
        for c in list(self.clients):
            if acct is None or c.acct == acct:
                self._offer(c, msg)

    def _tag(self):
        return f"[{self.label}] " if self.label else ""

    def stop(self):
        self._close_socket()
        if getattr(self, "_wd", None):
            self._wd.cancel()

    def _fanout(self, tick: dict):
        if self.on_tick:
            try:
                self.on_tick(tick)
            except Exception as e:
                log.exception("paper engine tick failed: %s", e)
        for c in list(self.clients):
            if tick["s"] in c.symbols:
                self._offer(c, {"tick": tick})

    def _fanout_depth(self, d: dict):
        for c in list(self.clients):
            if d["s"] in c.depth:
                self._offer(c, {"depth": d})

    def publish_depth(self, d: dict):
        """Called from any thread."""
        self.last_depth[d["s"]] = d
        self.last_depth_at = time.time()
        if self.loop:
            self.loop.call_soon_threadsafe(self._fanout_depth, d)

    def publish(self, tick: dict):
        """Called from any thread."""
        self.last[tick["s"]] = tick
        self.last_at[tick["s"]] = self.last_tick_at = time.time()
        if self.loop:
            self.loop.call_soon_threadsafe(self._fanout, tick)

    # ------------------------------------------------------------ Fyers socket
    def _on_message(self, m):
        if not isinstance(m, dict) or "symbol" not in m:
            return
        if m.get("type") == "dp":                 # market depth (5 levels)
            self.sock_up = True
            lv = lambda side: [[m.get(f"{side}_price{i}"), m.get(f"{side}_size{i}"), m.get(f"{side}_order{i}")] for i in range(1, 6)]
            self.publish_depth({"s": m["symbol"], "bids": lv("bid"), "asks": lv("ask"), "t": int(time.time()), "src": "ws"})
            return
        if "ltp" not in m:
            return
        self.sock_up = True                       # the SDK reconnects on its own; ticks prove it's up
        self.publish({
            "s": m["symbol"], "ltp": m.get("ltp"), "bid": m.get("bid_price"), "ask": m.get("ask_price"),
            "t": m.get("exch_feed_time") or m.get("last_traded_time") or int(time.time()),
            "vol": m.get("vol_traded_today"), "src": "ws", "ltt": m.get("last_traded_time"),
            # day figures for the Book tab
            "bsz": m.get("bid_size"), "asz": m.get("ask_size"), "ltq": m.get("last_traded_qty"),
            "tbq": m.get("tot_buy_qty"), "tsq": m.get("tot_sell_qty"), "atp": m.get("avg_trade_price"),
            "o": m.get("open_price"), "h": m.get("high_price"), "l": m.get("low_price"), "pc": m.get("prev_close_price"),
        })

    def _on_connect(self):
        self.sock_up = True
        log.info(self._tag() + "Price feed connected")
        self.subscribed = []
        self.dsubscribed = []
        self._resync()

    def _on_close(self, msg):
        self.sock_up = False
        log.warning(self._tag() + "Price feed closed: %s", msg)

    def _on_error(self, msg):
        log.warning(self._tag() + "Price feed error: %s", msg)

    def _ensure_socket(self):
        tok = self.link.token()
        if not tok:
            if self.sock:
                self._close_socket()
            return
        if self.sock and self.sock_token == tok:
            return
        self._close_socket()
        from fyers_apiv3.FyersWebsocket import data_ws
        app_id = self.link.settings().get("app_id")
        log.info(self._tag() + "Opening the price feed")
        self.sock_token = tok
        self.sock = data_ws.FyersDataSocket(
            access_token=f"{app_id}:{tok}", log_path=str(store.path(self.link.dir + "socketlog/x").parent), litemode=False, write_to_file=False,
            reconnect=True, on_connect=self._on_connect, on_close=self._on_close, on_error=self._on_error,
            on_message=self._on_message)
        self.sock.connect()

    def _close_socket(self):
        if self.sock:
            try:
                self.sock.close_connection()
            except Exception:
                pass
        self.sock = None
        self.sock_up = False
        self.sock_token = ""
        self.subscribed = []
        self.dsubscribed = []

    def _resync(self):
        """Safe to call from any thread."""
        if self.loop:
            self.loop.call_soon_threadsafe(self.loop.run_in_executor, None, self._resync_blocking)

    def _resync_blocking(self):
        with self._ops:
            try:
                want, dwant = self.wanted(), self.wanted_depth()
                if not want and not dwant:
                    return
                self._ensure_socket()
                if not self.sock or not self.sock_up:
                    return
                if want != self.subscribed:
                    if self.subscribed:
                        self.sock.unsubscribe(symbols=self.subscribed, data_type="SymbolUpdate")
                    if want:
                        self.sock.subscribe(symbols=want, data_type="SymbolUpdate")
                    self.subscribed = want
                    log.info(self._tag() + "Streaming %s", ", ".join(want))
                if dwant != self.dsubscribed:              # order book only while a page has the Book tab open
                    gone = [x for x in self.dsubscribed if x not in dwant]
                    new = [x for x in dwant if x not in self.dsubscribed]
                    if gone:
                        self.sock.unsubscribe(symbols=gone, data_type="DepthUpdate")
                    if new:
                        self.sock.subscribe(symbols=new, data_type="DepthUpdate")
                    self.dsubscribed = dwant
            except Exception as e:
                log.warning(self._tag() + "Price feed subscribe failed: %s", e)

    # ------------------------------------------------------------ fallback + housekeeping
    async def _watchdog(self):
        """Every 3 s: reopen the socket if needed. Poll quotes (one batched request) only when the socket is
        down (every 10 s) or has been silent for a minute (every 60 s) - this keeps us far inside the
        Standard plan's 50 data requests/minute."""
        last_poll = last_dpoll = 0.0
        while True:
            await asyncio.sleep(3)
            dwant = self.wanted_depth()
            now = time.time()
            # order book fallback: one REST call every 6 s (books take turns), only if the socket isn't delivering depth
            if dwant and self.link.token() and now - self.last_depth_at > 15 and now - last_dpoll > 6:
                last_dpoll = now
                self._dturn = (getattr(self, "_dturn", -1) + 1) % len(dwant)
                try:
                    d = await self.loop.run_in_executor(None, self.link.depth, dwant[self._dturn])
                    if d:
                        self.publish_depth(d)
                except Exception as e:
                    log.debug("depth poll failed: %s", e)
            want = self.wanted()
            if not want or not self.link.token():
                continue
            if not self.sock or not self.sock_up:
                self._resync()
            now = time.time()
            silent = now - self.last_tick_at
            gap = 10 if not self.sock_up else (60 if silent > 60 else None)
            if gap is None or now - last_poll < gap:
                continue
            last_poll = now
            try:
                for t in await self.loop.run_in_executor(None, self._poll, want):
                    self.publish(t)
            except Exception as e:
                log.debug("quote poll failed: %s", e)

    def _poll(self, symbols: list) -> list:
        out, got = [], {}
        for i in range(0, len(symbols), 50):           # Fyers' quotes take 50 symbols a request
            got.update(self.link.quotes(symbols[i:i + 50]))
        for s, v in got.items():
            if v.get("lp") is not None:
                out.append({"s": s, "ltp": v.get("lp"), "bid": v.get("bid"), "ask": v.get("ask"),
                            "t": v.get("tt") or int(time.time()), "vol": v.get("volume"), "src": "poll",
                            # the day's figures, as on the socket (the chart's data check and the Book tab use them)
                            "o": v.get("open_price"), "h": v.get("high_price"), "l": v.get("low_price"), "pc": v.get("prev_close_price")})
        return out

    def status(self) -> dict:
        return {"socket": self.sock_up, "streaming": self.subscribed, "depth": self.dsubscribed, "last_tick_age": (
            round(time.time() - self.last_tick_at, 1) if self.last_tick_at else None),
            "data_budget": self.link.data_budget.status()}


