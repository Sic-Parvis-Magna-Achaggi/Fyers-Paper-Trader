import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from helper.app import app
have = {(m, r.path) for r in app.routes for m in getattr(r, "methods", {"WS"})}
need = [("GET", p) for p in ["/", "/api/state", "/api/fyers/login", "/fyers/callback", "/api/symbols", "/api/symbol", "/api/chain",
        "/api/history", "/api/prefs", "/api/security", "/api/admin/users", "/api/accounts", "/api/logs", "/api/scripts", "/api/paper", "/api/paper/history", "/api/paper/history.csv", "/api/paper/events", "/api/charges", "/api/live/status", "/api/feedcheck", "/api/drawings", "/api/layouts", "/api/ping", "/api/telegram", "/api/journal"]] + \
       [("POST", p) for p in ["/api/setup", "/api/login", "/api/logout", "/api/password", "/api/login/code", "/api/login/password", "/api/login/2fa/begin", "/api/login/2fa/finish", "/api/security/confirm", "/api/security/password", "/api/security/recovery", "/api/security/2fa/begin", "/api/security/2fa/finish", "/api/security/logout_all", "/api/security/end_session", "/api/security/name", "/api/admin/users/create", "/api/admin/users/set", "/api/accounts/create", "/api/accounts/update", "/api/fyers/settings", "/api/prefs",
        "/api/paper/preview", "/api/paper/place", "/api/paper/close", "/api/paper/close_all", "/api/paper/cancel", "/api/paper/modify",
        "/api/paper/be", "/api/paper/be_all", "/api/paper/pos_trail", "/api/paper/trail", "/api/paper/rules", "/api/paper/ticket", "/api/paper/reset", "/api/scripts/save", "/api/scripts/delete", "/api/charges/save", "/api/charges/check", "/api/charges/reviewed", "/api/accounts/mode", "/api/live/kill", "/api/live/resume", "/api/live/resync", "/api/feedcheck", "/api/drawings", "/api/measure", "/api/layouts", "/api/telegram/settings", "/api/telegram/chats", "/api/telegram/test", "/api/journal/trade", "/api/journal/audit", "/api/journal/claim", "/api/journal/hide", "/api/journal/practice", "/api/journal/settings", "/api/journal/end"]]
need.append(("WS", "/ws")) if False else None
miss = [n for n in need if n not in have]
print("routes OK" if not miss else f"MISSING: {miss}")
sys.exit(1 if miss else 0)
