//+------------------------------------------------------------------+
//| FTM_Bridge.mq5                                                    |
//| Connects this MT5 terminal to Fyers Trade Manager, my own         |
//| charting app on my server, so its charts (Point & Figure, Renko,  |
//| Pine scripts...) can show this broker's own prices, and so I can  |
//| manage this account's trades from the app.                        |
//|                                                                   |
//| How it talks to the app: it only ever calls OUT, with WebRequest, |
//| about 4 times a second (POST /api/mt5/sync). Nothing connects in  |
//| to this computer, and the app never logs in to the broker.        |
//|                                                                   |
//| Each call sends: this account (login, server, balance...), the    |
//| broker's clock, the new ticks of the symbols the app asked for,   |
//| and (1.10) this account's open positions, pending orders, its     |
//| deals since the app last had them, and the results of the app's   |
//| requests. The app answers with a few lines of text:               |
//|   OK <ms>                    call again after this many ms        |
//|   SUB <sym1>,<sym2>,...      the symbols to send ticks for        |
//|   HIST <id> <sym> <tf> <from> <to>                                |
//|                              send candles (CopyRates) for that    |
//|                              range, in broker server time         |
//|   LIST                       send the broker's symbol list        |
//|   DEALS <from>               send the deals from this server time |
//|   MOD <tag> <ticket> <sl> <tp>     change a position's SL / TP    |
//|   CLOSE <tag> <ticket> <volume>    close a position at market     |
//|                                    (volume 0 = all of it)         |
//|   CANCEL <tag> <ticket>            delete a pending order         |
//|   OMOD <tag> <ticket> <price> <sl> <tp>  move a pending order     |
//|   OPEN <tag> <sym> <side> <market|limit|stop> <volume> <price>    |
//|        <sl> <tp>          (1.20) the order you placed in the app  |
//|   TRAIL <ticket> ...      (1.20) that trade's Trail BE / Trail SL |
//|                           so the EA can go on trailing it by      |
//|                           itself if it can't reach the app        |
//|   ERR <message>              a problem (shown on the chart)       |
//| Each request has a tag; it is carried out once, and its result is |
//| sent back with the next call (a tag seen again is not repeated).  |
//|                                                                   |
//| Version 1.23: the symbol list also carries each symbol's trading  |
//| sessions (SymbolInfoSessionTrade, as in its Specification window) |
//| so the app's day-end close can close each trade a few minutes     |
//| before its own symbol stops trading. Nothing else changes.        |
//| Version 1.22: also sends each symbol's commission rules, as in    |
//| its Specification window (SymbolInfoCommissions, MT5 July 2026),  |
//| once a minute, so the app knows the commission before the first   |
//| trade. If MetaEditor says SymbolInfoCommissions is unknown, update |
//| MT5, or delete the line "#define FTM_COMMISSIONS" below.          |
//| Version 1.21: also sends each symbol's profit for 1 lot over a    |
//| 1.00 price move (OrderCalcProfit), so the app's $ figures use     |
//| MT5's own sum (1.20's tick value alone was 100x off on XAUUSD).   |
//| Version 1.20 (stage b, slices b2 / b3): also places the orders    |
//| you place in the app (OPEN, each with its own real SL / TP), and  |
//| if it can't reach the app for OfflineTrailSec seconds it moves    |
//| your trades' stops by itself as their Trail BE / Trail SL say     |
//| (never looser, never backwards). It opens nothing by itself.      |
//| Version 1.10 (stage b, slice b1): manages trades that already     |
//| exist (moves SL / TP, closes, cancels or moves pending orders),   |
//| only when the app asks and only if AllowTrading is true. It OPENS |
//| NO new trades (that is a later version).                          |
//| Version 1.00 (stage a): prices and candles only.                  |
//+------------------------------------------------------------------+
#property copyright   "Ashwin Kumar"
#property version     "1.23"
#property description "FTM Bridge 1.23: sends this terminal's prices, candles, symbol list and account to your Fyers Trade Manager,"
#property description "places the orders you place in the app, manages your trades when you ask (SL / TP, close, cancel), and"
#property description "trails their stops by itself if it can't reach the app. It opens nothing on its own."
#property description "Calls out only (WebRequest)."

#include <Trade\Trade.mqh>

input string ServerURL = "https://68-183-245-178.sslip.io"; // App address (also add it in Tools > Options > Expert Advisors)
input string BridgeKey = "";                                 // Bridge key (Settings > MT5 bridge in the app)
input int    PollMs    = 250;                                // Call the app every ... ms
input int    TimeoutMs = 5000;                               // WebRequest time-out (ms)
input bool   AllowTrading   = true;                          // Let the app manage this account's trades (SL / TP, close, cancel)
input int    SlippagePoints = 30;                            // Market orders: most slippage accepted (points)
input int    OfflineTrailSec = 20;                           // Can't reach the app this long: trail stops here (0 = never)

#define EA_VER        "1.23"
#define FTM_COMMISSIONS          // 1.22: send each symbol's commission rules (needs MT5 from July 2026; delete this line if it won't compile)
#define MAGIC         20261110  // the magic number on the app's closing deals
#define DEALS_PER_CALL 200      // deals per call (the app is told when there are more)
#define TAGS_KEPT     200       // requests remembered, so a tag is never carried out twice
#define MAX_TICKS     3000      // ticks per call, all symbols together
#define TICKS_PER_SYM 500       // ticks per symbol per call
#define BARS_PER_POST 20000     // candles per POST
#define SYMS_PER_POST 300       // symbols per POST
#define HIST_WAIT_MS  37000     // how long to wait for MT5 to download history (the app waits 45 s)
#define CATCHUP_MS    60000     // after a longer gap (MT5 or the internet was off), start from the latest tick

string g_subs[];                // symbols the app wants ticks for
long   g_lastMsc[];             // time (ms) of the last tick the app has, per symbol (same order as g_subs)
long   g_nextMsc[];             // what g_lastMsc becomes once the app has answered (a failed call sends them again)
int    g_nextSent = 0;
string g_bad[];                 // names the app asked for that this broker doesn't have (said once in the log)
string g_pend[];                // HIST lines waiting for MT5 to download the history
ulong  g_pendSince[];           // when each one arrived (GetTickCount64)
int    g_pollMs   = 250;
int    g_fails    = 0;
ulong  g_waitTill = 0;          // after a failed call: don't call again before this (GetTickCount64)
ulong  g_okTick   = 0;          // GetTickCount64 of the last call the app answered
string g_state    = "starting";
string g_lastErr  = "";
long   g_sent     = 0;          // ticks sent
datetime g_okAt   = 0;

CTrade g_trade;
bool   g_dSet     = false;      // the app has set the deal cursor (DEALS)
long   g_dCurMsc  = 0;          // the last deal the app has: its time (ms, server time) and ticket
ulong  g_dCurTk   = 0;
long   g_dNextMsc = 0;          // what the cursor becomes once the app has answered
ulong  g_dNextTk  = 0;
bool   g_dMore    = false;
string g_res[];                 // results of the app's requests, waiting to be delivered
int    g_resSent  = 0;
string g_doneTag[];             // requests already carried out (tag -> result)
string g_doneRes[];
string g_lastCmd  = "";
int    g_nPos     = 0;
int    g_nOrd     = 0;
ulong  g_tTk[];                 // 1.20: each trade's trailing, as set in the app (TRAIL lines)
int    g_tSide[];
double g_tBest[];               // best bid since (long: highest, short: lowest)
double g_tBeT[];                // Trail BE: price that triggers it (0 = off / done) ...
double g_tBeP[];                // ... and the stop it moves to (break-even + costs)
double g_tSlS[];                // Trail SL: price where it starts (0 = off) ...
double g_tSlD[];                // ... its distance behind the best price ...
double g_tFloor[];              // ... never below this (break-even + costs) ...
double g_tStep[];               // ... and at least this much tighter each time
ulong  g_tLast[];               // when this EA last moved it (GetTickCount64)
string g_trailed[];             // stops this EA moved by itself, until the app has them: [ticket, sl, time ms]
int    g_trailedSent = 0;
int    g_nTrailed = 0;

//+------------------------------------------------------------------+
int OnInit()
  {
   if(MQLInfoInteger(MQL_TESTER))
     {
      Print("FTM Bridge: WebRequest doesn't work in the Strategy Tester.");
      return(INIT_FAILED);
     }
   if(StringLen(BridgeKey) < 20)
     {
      Alert("FTM Bridge: paste your bridge key (Settings > MT5 bridge in the app) into the EA's inputs.");
      return(INIT_PARAMETERS_INCORRECT);
     }
   g_pollMs = PollMs;
   if(g_pollMs < 100)
      g_pollMs = 100;
   g_trade.SetExpertMagicNumber(MAGIC);
   g_trade.SetDeviationInPoints(SlippagePoints);
   g_trade.SetAsyncMode(false);
   g_trade.LogLevel(LOG_LEVEL_ERRORS);
   if(!EventSetMillisecondTimer(g_pollMs))
     {
      Print("FTM Bridge: couldn't start the timer (error ", GetLastError(), ")");
      return(INIT_FAILED);
     }
   Show();
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }

//+------------------------------------------------------------------+
void OnTimer()
  {
   TrailBest();
   if(Offline())
      OfflineTrail();
   if(GetTickCount64() < g_waitTill)
     {
      Show();
      return;
     }
   string reply = "";
   int code = Post("/api/mt5/sync", SyncBody(), reply);
   if(code == 200)
     {
      ArrayCopy(g_lastMsc, g_nextMsc);       // the app has these ticks now (before Handle: SUB may change the list)
      g_sent += g_nextSent;
      g_dCurMsc = g_dNextMsc;                // ... and these deals (before Handle: DEALS may move the cursor)
      g_dCurTk = g_dNextTk;
      DropResults(g_resSent);                // ... and these results
      DropTrailed(g_trailedSent);            // ... and the stops this EA trailed by itself
      g_okTick = GetTickCount64();
      g_fails = 0;
      g_okAt = TimeLocal();
      g_lastErr = "";
      g_state = "connected";
      Handle(reply);
     }
   else
      Failed(code, reply);
   Show();
  }

//+------------------------------------------------------------------+
//| One POST to the app. Returns the HTTP code (-1: not sent).        |
//+------------------------------------------------------------------+
int Post(const string path, const string body, string &reply)
  {
   char data[];
   char res[];
   string rh = "";
   int n = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(n > 0)
      ArrayResize(data, n - 1);              // drop the closing zero
   string url = ServerURL;
   while(StringLen(url) > 0 && StringSubstr(url, StringLen(url) - 1, 1) == "/")
      url = StringSubstr(url, 0, StringLen(url) - 1);
   string headers = "Content-Type: application/json\r\nX-FTM-Key: " + BridgeKey + "\r\n";
   ResetLastError();
   int code = WebRequest("POST", url + path, headers, TimeoutMs, data, res, rh);
   reply = CharArrayToString(res, 0, WHOLE_ARRAY, CP_UTF8);
   return(code);
  }

//+------------------------------------------------------------------+
void Failed(const int code, const string reply)
  {
   g_fails++;
   if(code == -1)
     {
      int e = GetLastError();
      if(e == 4014)
         g_lastErr = "WebRequest isn't allowed for this address. Tools > Options > Expert Advisors: tick 'Allow WebRequest for listed URL' and add " + ServerURL;
      else
         g_lastErr = "Can't reach the app (error " + IntegerToString(e) + "). Internet down, or the app's address is wrong?";
     }
   else
     {
      string first = reply;
      int p = StringFind(first, "\n");
      if(p >= 0)
         first = StringSubstr(first, 0, p);
      if(StringFind(first, "ERR ") == 0)
         first = StringSubstr(first, 4);
      g_lastErr = "The app answered " + IntegerToString(code) + ": " + first;
     }
   g_state = "not connected";
   int wait = 1000 * g_fails;
   if(code == 401 || code == 429)
      wait = 15000;
   if(wait > 30000)
      wait = 30000;
   g_waitTill = GetTickCount64() + (ulong)wait;
   if(g_fails == 1 || g_fails % 20 == 0)
      Print("FTM Bridge: ", g_lastErr);
  }

//+------------------------------------------------------------------+
void Show()
  {
   string s = "FTM Bridge " + EA_VER + " - " + g_state;
   if(g_state == "connected")
      s += "\nStreaming " + IntegerToString(ArraySize(g_subs)) + " symbol(s) to the app, " + IntegerToString(g_sent) + " ticks sent";
   if(g_lastErr != "")
      s += "\n" + g_lastErr;
   if(ArraySize(g_pend) > 0)
      s += "\nWaiting for MT5 to download history (" + IntegerToString(ArraySize(g_pend)) + ")";
   if(g_state == "connected")
      s += "\nThis account: " + IntegerToString(g_nPos) + " position(s), " + IntegerToString(g_nOrd) + " pending order(s)";
   if(AllowTrading)
      s += "\nPlaces the orders you place in the app; moves SL / TP, closes, cancels when you ask. Opens nothing by itself.";
   else
      s += "\nApp trading OFF (input AllowTrading = false): shows the account to the app, changes nothing.";
   if(g_lastCmd != "")
      s += "\nLast request: " + g_lastCmd;
   if(ArraySize(g_tTk) > 0)
      s += (Offline() ? "\nCAN'T REACH THE APP: trailing " : "\nWould trail by itself if the link drops: ") + IntegerToString(ArraySize(g_tTk))
           + " trade(s)" + (g_nTrailed > 0 ? " (" + IntegerToString(g_nTrailed) + " stop move(s) so far)" : "");
   Comment(s);
  }

//+------------------------------------------------------------------+
//| JSON helpers                                                      |
//+------------------------------------------------------------------+
string Js(string s)
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   int len = StringLen(s);
   for(int i = 0; i < len; i++)                 // control characters would make the JSON invalid
      if(StringGetCharacter(s, i) < 32)
         StringSetCharacter(s, i, ' ');
   return("\"" + s + "\"");
  }

string Jb(const bool b)
  {
   return(b ? "true" : "false");
  }

string Jd(const double v, const int digits)
  {
   if(!MathIsValidNumber(v))
      return("0");
   return(DoubleToString(v, digits));
  }

//+------------------------------------------------------------------+
//| The sync call's body: account, clock, new ticks                   |
//+------------------------------------------------------------------+
string SyncBody()
  {
   string mode = "hedge";
   long mm = AccountInfoInteger(ACCOUNT_MARGIN_MODE);
   if(mm == ACCOUNT_MARGIN_MODE_RETAIL_NETTING)
      mode = "netting";
   if(mm == ACCOUNT_MARGIN_MODE_EXCHANGE)
      mode = "exchange";
   string b = "{\"v\":2,\"ea\":" + Js(EA_VER) + ",\"build\":" + IntegerToString(TerminalInfoInteger(TERMINAL_BUILD));
   b += ",\"srv\":" + IntegerToString((long)TimeTradeServer()) + ",\"gmt\":" + IntegerToString((long)TimeGMT());
   b += ",\"acct\":{\"login\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   b += ",\"server\":" + Js(AccountInfoString(ACCOUNT_SERVER));
   b += ",\"company\":" + Js(AccountInfoString(ACCOUNT_COMPANY));
   b += ",\"name\":" + Js(AccountInfoString(ACCOUNT_NAME));
   b += ",\"currency\":" + Js(AccountInfoString(ACCOUNT_CURRENCY));
   b += ",\"balance\":" + Jd(AccountInfoDouble(ACCOUNT_BALANCE), 2);
   b += ",\"equity\":" + Jd(AccountInfoDouble(ACCOUNT_EQUITY), 2);
   b += ",\"margin\":" + Jd(AccountInfoDouble(ACCOUNT_MARGIN), 2);
   b += ",\"free\":" + Jd(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2);
   b += ",\"leverage\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE));
   b += ",\"mode\":" + Js(mode);
   b += ",\"trade_allowed\":" + Jb(AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) != 0);
   b += ",\"ea_allowed\":" + Jb(AccountInfoInteger(ACCOUNT_TRADE_EXPERT) != 0);
   b += ",\"demo\":" + Jb(AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO);
   b += "},\"ticks\":[" + Ticks() + "]";
   string syms[];
   b += ",\"trade\":{\"on\":" + Jb(AllowTrading) + ",\"term\":" + Jb(TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) != 0)
        + ",\"mql\":" + Jb(MQLInfoInteger(MQL_TRADE_ALLOWED) != 0) + "}";
   b += ",\"pos\":[" + Positions(syms) + "]";
   b += ",\"ord\":[" + Orders(syms) + "]";
   b += ",\"sym\":{" + SymInfo(syms) + "}";
   b += ",\"deals\":[" + Deals() + "],\"dmore\":" + Jb(g_dMore) + ",\"dcur\":" + IntegerToString(g_dSet ? g_dCurMsc : 0);
   b += ",\"res\":[" + Results() + "]";
   b += ",\"trailed\":[" + Trailed() + "]}";
   return(b);
  }

//+------------------------------------------------------------------+
//| Every tick since the last call, for each symbol the app wants:    |
//| [name, time ms (server time), bid, ask, last, today's tick volume]|
//+------------------------------------------------------------------+
string Ticks()
  {
   string out = "";
   int total = 0;
   int n = ArraySize(g_subs);
   ArrayResize(g_nextMsc, n);
   for(int c = 0; c < n; c++)
      g_nextMsc[c] = g_lastMsc[c];
   bool gap = (g_okTick > 0 && GetTickCount64() - g_okTick > CATCHUP_MS);   // the app was out of reach for a while
   for(int i = 0; i < n && total < MAX_TICKS; i++)
     {
      string sym = g_subs[i];
      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      long dayVol = iVolume(sym, PERIOD_D1, 0);
      MqlTick t[];
      int got = 0;
      if(g_lastMsc[i] == 0 || gap)
        {                                         // new, or after a long gap: just the latest price
         MqlTick one;
         if(SymbolInfoTick(sym, one) && one.bid > 0)
           {
            ArrayResize(t, 1);
            t[0] = one;
            got = 1;
           }
        }
      else
         got = CopyTicks(sym, t, COPY_TICKS_INFO, (ulong)(g_lastMsc[i] + 1), TICKS_PER_SYM);
      int k = 0;
      for(k = 0; k < got && total < MAX_TICKS; k++)
        {
         if(t[k].bid <= 0 || t[k].ask <= 0)
            continue;
         if(out != "")
            out += ",";
         out += "[" + Js(sym) + "," + IntegerToString(t[k].time_msc) + "," + Jd(t[k].bid, digits) + "," + Jd(t[k].ask, digits)
                + "," + Jd(t[k].last, digits) + "," + IntegerToString(dayVol) + "]";
         total++;
        }
      if(k > 0)
         g_nextMsc[i] = t[k - 1].time_msc;      // the last tick actually looked at (the rest: next call)
     }
   g_nextSent = total;
   return(out);
  }

//+------------------------------------------------------------------+
//| The app's answer                                                  |
//+------------------------------------------------------------------+
void Handle(const string reply)
  {
   // history MT5 was still downloading: try again
   int m = ArraySize(g_pend);
   for(int j = m - 1; j >= 0; j--)
      if(Hist(g_pend[j], g_pendSince[j]))
         RemovePending(j);
   string lines[];
   int n = StringSplit(reply, '\n', lines);
   for(int i = 0; i < n; i++)
     {
      string ln = lines[i];
      StringTrimLeft(ln);
      StringTrimRight(ln);
      if(ln == "")
         continue;
      if(StringFind(ln, "OK") == 0)
        {
         int ms = 0;
         if(StringLen(ln) > 3)
            ms = (int)StringToInteger(StringSubstr(ln, 3));
         if(ms >= 100 && ms <= 10000 && ms != g_pollMs && PollMs == 250)
           {
            g_pollMs = ms;
            EventKillTimer();
            EventSetMillisecondTimer(g_pollMs);
           }
        }
      else
         if(ln == "SUB" || StringFind(ln, "SUB ") == 0)
            SetSubs(ln == "SUB" ? "" : StringSubstr(ln, 4));
         else
            if(StringFind(ln, "HIST ") == 0)
              {
               ulong since = GetTickCount64();
               if(!Hist(ln, since))
                  AddPending(ln, since);
              }
            else
               if(ln == "LIST")
                  SendList();
               else
                  if(StringFind(ln, "ERR ") == 0)
                     g_lastErr = StringSubstr(ln, 4);
                  else
                     if(StringFind(ln, "DEALS ") == 0)
                       {
                        g_dCurMsc = StringToInteger(StringSubstr(ln, 6)) * 1000;
                        g_dCurTk = 0;
                        g_dNextMsc = g_dCurMsc;
                        g_dNextTk = 0;
                        g_dSet = true;
                       }
                     else
                        if(StringFind(ln, "MOD ") == 0 || StringFind(ln, "CLOSE ") == 0 || StringFind(ln, "CANCEL ") == 0
                           || StringFind(ln, "OMOD ") == 0 || StringFind(ln, "OPEN ") == 0)
                           Command(ln);
                        else
                           if(StringFind(ln, "TRAIL ") == 0)
                              SetTrail(ln);
     }
  }

//+------------------------------------------------------------------+
//| The symbols to stream. A new one is added to Market Watch (MT5    |
//| only sends ticks for symbols there).                              |
//+------------------------------------------------------------------+
void SetSubs(const string csv)
  {
   string want[];
   int n = 0;
   if(csv != "")
      n = StringSplit(csv, ',', want);
   string ns[];
   long nm[];
   ArrayResize(ns, n);
   ArrayResize(nm, n);
   int k = 0;
   for(int i = 0; i < n; i++)
     {
      string s = want[i];
      StringTrimLeft(s);
      StringTrimRight(s);
      if(s == "")
         continue;
      long keep = 0;
      bool known = false;
      for(int j = 0; j < ArraySize(g_subs); j++)
         if(g_subs[j] == s)
           {
            keep = g_lastMsc[j];
            known = true;
            break;
           }
      if(!known && !SymbolSelect(s, true))
        {
         bool said = false;
         for(int b = 0; b < ArraySize(g_bad); b++)
            if(g_bad[b] == s)
              {
               said = true;
               break;
              }
         if(!said)
           {
            int nb = ArraySize(g_bad);
            ArrayResize(g_bad, nb + 1);
            g_bad[nb] = s;
            Print("FTM Bridge: ", s, " isn't a symbol on this broker");
           }
         continue;
        }
      ns[k] = s;
      nm[k] = keep;
      k++;
     }
   ArrayResize(g_subs, k);
   ArrayResize(g_lastMsc, k);
   for(int i = 0; i < k; i++)
     {
      g_subs[i] = ns[i];
      g_lastMsc[i] = nm[i];
     }
  }

//+------------------------------------------------------------------+
ENUM_TIMEFRAMES Tf(const string tf, bool &ok)
  {
   ok = true;
   if(tf == "1")   return(PERIOD_M1);
   if(tf == "2")   return(PERIOD_M2);
   if(tf == "3")   return(PERIOD_M3);
   if(tf == "5")   return(PERIOD_M5);
   if(tf == "10")  return(PERIOD_M10);
   if(tf == "15")  return(PERIOD_M15);
   if(tf == "20")  return(PERIOD_M20);
   if(tf == "30")  return(PERIOD_M30);
   if(tf == "60")  return(PERIOD_H1);
   if(tf == "120") return(PERIOD_H2);
   if(tf == "180") return(PERIOD_H3);
   if(tf == "240") return(PERIOD_H4);
   if(tf == "D")   return(PERIOD_D1);
   ok = false;
   return(PERIOD_CURRENT);
  }

//+------------------------------------------------------------------+
//| HIST <id> <sym> <tf> <from> <to>: candles from MT5 (CopyRates),   |
//| [server time, open, high, low, close, tick volume], in parts.     |
//| Returns false while MT5 is still downloading the history.         |
//+------------------------------------------------------------------+
bool Hist(const string line, const ulong since)
  {
   string p[];
   if(StringSplit(line, ' ', p) < 6)
      return(true);
   string id = p[1];
   string sym = p[2];
   bool ok;
   ENUM_TIMEFRAMES tf = Tf(p[3], ok);
   if(!ok)
     {
      SendBarsError(id, "timeframe " + p[3] + " not handled");
      return(true);
     }
   if(!SymbolSelect(sym, true))
     {
      SendBarsError(id, sym + " isn't a symbol on this broker");
      return(true);
     }
   datetime from = (datetime)StringToInteger(p[4]);
   datetime to   = (datetime)StringToInteger(p[5]);
   MqlRates r[];
   ResetLastError();
   int n = CopyRates(sym, tf, from, to, r);
   int err = GetLastError();
   bool synced = (SeriesInfoInteger(sym, tf, SERIES_SYNCHRONIZED) != 0);
   bool none = (n < 0 && synced && err == ERR_HISTORY_NOT_FOUND);   // nothing in that range (before the broker's history)
   bool late = (GetTickCount64() - since > HIST_WAIT_MS);
   if((n < 0 || !synced) && !none && !late)
      return(false);                        // MT5 is downloading it: ask again on the next call
   if(!none && !synced)
     {
      SendBarsError(id, "MT5 is still downloading this history (error " + IntegerToString(err) + "): try again in a minute");
      return(true);
     }
   if(!none && n < 0)
     {
      SendBarsError(id, "CopyRates error " + IntegerToString(err));
      return(true);
     }
   if(n < 0)
      n = 0;                                // nothing in that range: an empty, finished answer
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   int start = 0;
   do
     {
      int end = start + BARS_PER_POST;
      if(end > n)
         end = n;
      string b = "";
      for(int i = start; i < end; i++)
        {
         if(i > start)
            b += ",";
         b += "[" + IntegerToString((long)r[i].time) + "," + Jd(r[i].open, digits) + "," + Jd(r[i].high, digits) + ","
              + Jd(r[i].low, digits) + "," + Jd(r[i].close, digits) + "," + IntegerToString(r[i].tick_volume) + "]";
        }
      string body = "{\"id\":" + Js(id) + ",\"sym\":" + Js(sym) + ",\"bars\":[" + b + "],\"done\":" + Jb(end >= n) + "}";
      string reply = "";
      int code = Post("/api/mt5/bars", body, reply);
      if(code != 200)
        {
         Print("FTM Bridge: sending candles failed (", code, ") ", reply);
         break;
        }
      start = end;
     }
   while(start < n);
   return(true);
  }

//+------------------------------------------------------------------+
void SendBarsError(const string id, const string msg)
  {
   string reply = "";
   Post("/api/mt5/bars", "{\"id\":" + Js(id) + ",\"bars\":[],\"done\":true,\"err\":" + Js(msg) + "}", reply);
  }

//+------------------------------------------------------------------+
void AddPending(const string line, const ulong since)
  {
   int n = ArraySize(g_pend);
   ArrayResize(g_pend, n + 1);
   ArrayResize(g_pendSince, n + 1);
   g_pend[n] = line;
   g_pendSince[n] = since;
  }

void RemovePending(const int j)
  {
   int n = ArraySize(g_pend);
   for(int i = j; i < n - 1; i++)
     {
      g_pend[i] = g_pend[i + 1];
      g_pendSince[i] = g_pendSince[i + 1];
     }
   ArrayResize(g_pend, n - 1);
   ArrayResize(g_pendSince, n - 1);
  }

//+------------------------------------------------------------------+
//| LIST: every symbol this broker offers, with its settings          |
//+------------------------------------------------------------------+
//--- 1.23: a symbol's trading sessions, Sunday (0) to Saturday (6): [[from, to], ...] in seconds from the server's midnight
string Sessions(const string s)
  {
   string out = "[";
   for(int d = 0; d < 7; d++)
     {
      if(d > 0)
         out += ",";
      out += "[";
      datetime f = 0, t = 0;
      for(uint k = 0; k < 10; k++)
        {
         if(!SymbolInfoSessionTrade(s, (ENUM_DAY_OF_WEEK)d, k, f, t))
            break;
         if(k > 0)
            out += ",";
         out += "[" + IntegerToString((long)f % 86400) + "," + IntegerToString((long)t == 86400 ? 86400 : (long)t % 86400) + "]";
        }
      out += "]";
     }
   return out + "]";
  }

void SendList()
  {
   int total = SymbolsTotal(false);
   int parts = (total + SYMS_PER_POST - 1) / SYMS_PER_POST;
   if(parts < 1)
      parts = 1;
   for(int part = 0; part < parts; part++)
     {
      string b = "";
      int a = part * SYMS_PER_POST;
      int e = a + SYMS_PER_POST;
      if(e > total)
         e = total;
      for(int i = a; i < e; i++)
        {
         string s = SymbolName(i, false);
         if(i > a)
            b += ",";
         b += "{\"name\":" + Js(s);
         b += ",\"desc\":" + Js(SymbolInfoString(s, SYMBOL_DESCRIPTION));
         b += ",\"path\":" + Js(SymbolInfoString(s, SYMBOL_PATH));
         b += ",\"digits\":" + IntegerToString(SymbolInfoInteger(s, SYMBOL_DIGITS));
         b += ",\"point\":" + Jd(SymbolInfoDouble(s, SYMBOL_POINT), 10);
         b += ",\"tick_size\":" + Jd(SymbolInfoDouble(s, SYMBOL_TRADE_TICK_SIZE), 10);
         b += ",\"tick_value\":" + Jd(SymbolInfoDouble(s, SYMBOL_TRADE_TICK_VALUE), 10);
         b += ",\"contract\":" + Jd(SymbolInfoDouble(s, SYMBOL_TRADE_CONTRACT_SIZE), 4);
         b += ",\"vmin\":" + Jd(SymbolInfoDouble(s, SYMBOL_VOLUME_MIN), 4);
         b += ",\"vstep\":" + Jd(SymbolInfoDouble(s, SYMBOL_VOLUME_STEP), 4);
         b += ",\"vmax\":" + Jd(SymbolInfoDouble(s, SYMBOL_VOLUME_MAX), 4);
         b += ",\"cprofit\":" + Js(SymbolInfoString(s, SYMBOL_CURRENCY_PROFIT));
         b += ",\"cmargin\":" + Js(SymbolInfoString(s, SYMBOL_CURRENCY_MARGIN));
         b += ",\"cbase\":" + Js(SymbolInfoString(s, SYMBOL_CURRENCY_BASE));
         b += ",\"trade_mode\":" + IntegerToString(SymbolInfoInteger(s, SYMBOL_TRADE_MODE));
         b += ",\"calc_mode\":" + IntegerToString(SymbolInfoInteger(s, SYMBOL_TRADE_CALC_MODE));
         b += ",\"swap_mode\":" + IntegerToString(SymbolInfoInteger(s, SYMBOL_SWAP_MODE));
         b += ",\"swap_long\":" + Jd(SymbolInfoDouble(s, SYMBOL_SWAP_LONG), 4);
         b += ",\"swap_short\":" + Jd(SymbolInfoDouble(s, SYMBOL_SWAP_SHORT), 4);
         b += ",\"stops_level\":" + IntegerToString(SymbolInfoInteger(s, SYMBOL_TRADE_STOPS_LEVEL));
         b += ",\"freeze_level\":" + IntegerToString(SymbolInfoInteger(s, SYMBOL_TRADE_FREEZE_LEVEL));
         b += ",\"spread\":" + IntegerToString(SymbolInfoInteger(s, SYMBOL_SPREAD));
         b += ",\"visible\":" + Jb(SymbolInfoInteger(s, SYMBOL_VISIBLE) != 0);
         b += ",\"ts\":" + Sessions(s);                                      // 1.23: its trading sessions
         b += "}";
        }
      string body = "{\"part\":" + IntegerToString(part) + ",\"parts\":" + IntegerToString(parts) + ",\"symbols\":[" + b + "]}";
      string reply = "";
      int code = Post("/api/mt5/symbols", body, reply);
      if(code != 200)
        {
         Print("FTM Bridge: sending the symbol list failed (", code, ") ", reply);
         return;
        }
     }
   Print("FTM Bridge: sent the symbol list (", total, " symbols)");
  }
//+------------------------------------------------------------------+

//+------------------------------------------------------------------+
//| 1.10: this account for the app                                    |
//+------------------------------------------------------------------+
void AddSym(string &syms[], const string sym)
  {
   int n = ArraySize(syms);
   for(int i = 0; i < n; i++)
      if(syms[i] == sym)
         return;
   ArrayResize(syms, n + 1);
   syms[n] = sym;
  }

//+------------------------------------------------------------------+
//| [ticket, symbol, type (0 buy, 1 sell), volume, open price, SL,    |
//|  TP, current price, swap, profit, open time ms, magic, comment,   |
//|  position id]                                                     |
//+------------------------------------------------------------------+
string Positions(string &syms[])
  {
   string out = "";
   int n = PositionsTotal();
   g_nPos = 0;
   for(int i = 0; i < n; i++)
     {
      ulong tk = PositionGetTicket(i);       // (selects it)
      if(tk == 0)
         continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      if(out != "")
         out += ",";
      out += "[" + IntegerToString((long)tk) + "," + Js(sym) + "," + IntegerToString(PositionGetInteger(POSITION_TYPE))
             + "," + Jd(PositionGetDouble(POSITION_VOLUME), 4) + "," + Jd(PositionGetDouble(POSITION_PRICE_OPEN), dg)
             + "," + Jd(PositionGetDouble(POSITION_SL), dg) + "," + Jd(PositionGetDouble(POSITION_TP), dg)
             + "," + Jd(PositionGetDouble(POSITION_PRICE_CURRENT), dg) + "," + Jd(PositionGetDouble(POSITION_SWAP), 2)
             + "," + Jd(PositionGetDouble(POSITION_PROFIT), 2) + "," + IntegerToString(PositionGetInteger(POSITION_TIME_MSC))
             + "," + IntegerToString(PositionGetInteger(POSITION_MAGIC)) + "," + Js(PositionGetString(POSITION_COMMENT))
             + "," + IntegerToString(PositionGetInteger(POSITION_IDENTIFIER)) + "]";
      AddSym(syms, sym);
      g_nPos++;
     }
   return(out);
  }

//+------------------------------------------------------------------+
//| Pending orders: [ticket, symbol, type (2 buy limit ... 7 sell     |
//| stop limit), volume at first, volume now, price, SL, TP, placed   |
//| ms, magic, comment, stop-limit price]                             |
//+------------------------------------------------------------------+
string Orders(string &syms[])
  {
   string out = "";
   int n = OrdersTotal();
   g_nOrd = 0;
   for(int i = 0; i < n; i++)
     {
      ulong tk = OrderGetTicket(i);          // (selects it)
      if(tk == 0)
         continue;
      long typ = OrderGetInteger(ORDER_TYPE);
      if(typ < ORDER_TYPE_BUY_LIMIT || typ > ORDER_TYPE_SELL_STOP_LIMIT)
         continue;                           // (a market order on its way: it becomes a position)
      string sym = OrderGetString(ORDER_SYMBOL);
      int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      if(out != "")
         out += ",";
      out += "[" + IntegerToString((long)tk) + "," + Js(sym) + "," + IntegerToString(typ)
             + "," + Jd(OrderGetDouble(ORDER_VOLUME_INITIAL), 4) + "," + Jd(OrderGetDouble(ORDER_VOLUME_CURRENT), 4)
             + "," + Jd(OrderGetDouble(ORDER_PRICE_OPEN), dg) + "," + Jd(OrderGetDouble(ORDER_SL), dg)
             + "," + Jd(OrderGetDouble(ORDER_TP), dg) + "," + IntegerToString(OrderGetInteger(ORDER_TIME_SETUP_MSC))
             + "," + IntegerToString(OrderGetInteger(ORDER_MAGIC)) + "," + Js(OrderGetString(ORDER_COMMENT))
             + "," + Jd(OrderGetDouble(ORDER_PRICE_STOPLIMIT), dg) + "]";
      AddSym(syms, sym);
      g_nOrd++;
     }
   return(out);
  }

//+------------------------------------------------------------------+
//| For the app's money figures: "SYM":[tick value, tick size,        |
//| volume step, contract size, digits] of the symbols traded         |
//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
//| 1.22: a symbol's commission rules (its Specification window's     |
//| "Commissions"), as JSON: [[charge, entry, direction, range,       |
//| profit, currency, [[mode, volume type, value, min, max, from, to, |
//| currency], ...]], ...]; null if MT5 can't say. Enums as names.    |
//+------------------------------------------------------------------+
string g_crSym[];
ulong  g_crAt[];

bool CommDue(string s)
  {
   ulong now = GetTickCount64();
   for(int i = 0; i < ArraySize(g_crSym); i++)
      if(g_crSym[i] == s)
        {
         if(now - g_crAt[i] < 60000)
            return(false);
         g_crAt[i] = now;
         return(true);
        }
   int n = ArraySize(g_crSym);
   ArrayResize(g_crSym, n + 1);
   ArrayResize(g_crAt, n + 1);
   g_crSym[n] = s;
   g_crAt[n] = now;
   return(true);
  }

#ifdef FTM_COMMISSIONS
string CommRules(string s)
  {
   MqlCommission c[];
   int n = SymbolInfoCommissions(s, c);
   if(n < 0)
      return("null");
   string out = "[";
   for(int i = 0; i < n; i++)
     {
      if(i > 0)
         out += ",";
      out += "[" + Js(EnumToString(c[i].mode_charge)) + "," + Js(EnumToString(c[i].mode_entry)) + ","
             + Js(EnumToString(c[i].mode_direction)) + "," + Js(EnumToString(c[i].mode_range)) + ","
             + Js(EnumToString(c[i].mode_profit)) + "," + Js(c[i].currency) + ",[";
      for(int j = 0; j < ArraySize(c[i].tiers); j++)
        {
         if(j > 0)
            out += ",";
         out += "[" + Js(EnumToString(c[i].tiers[j].mode)) + "," + Js(EnumToString(c[i].tiers[j].volume_type)) + ","
                + Jd(c[i].tiers[j].value, 6) + "," + Jd(c[i].tiers[j].min_value, 6) + "," + Jd(c[i].tiers[j].max_value, 6) + ","
                + Jd(c[i].tiers[j].range_from, 4) + "," + Jd(c[i].tiers[j].range_to, 4) + "," + Js(c[i].tiers[j].currency) + "]";
        }
      out += "]]";
     }
   return(out + "]");
  }
#else
string CommRules(string s)
  {
   return("null");
  }
#endif

string SymInfo(string &syms[])
  {
   for(int j = 0; j < ArraySize(g_subs); j++)  // (1.20: the symbols the app streams too: the ones it may place orders on)
      AddSym(syms, g_subs[j]);
   string out = "";
   for(int i = 0; i < ArraySize(syms); i++)
     {
      string s = syms[i];
      double mb = 0, ms = 0, pp = 0;
      double bid = SymbolInfoDouble(s, SYMBOL_BID);
      if(!OrderCalcMargin(ORDER_TYPE_BUY, s, 1.0, SymbolInfoDouble(s, SYMBOL_ASK), mb))
         mb = 0;
      if(!OrderCalcMargin(ORDER_TYPE_SELL, s, 1.0, SymbolInfoDouble(s, SYMBOL_BID), ms))
         ms = 0;
      if(bid <= 0 || !OrderCalcProfit(ORDER_TYPE_BUY, s, 1.0, bid, bid + 1.0, pp))   // 1.21: profit, 1 lot, a 1.00 rise
         pp = 0;
      if(out != "")
         out += ",";
      out += Js(s) + ":[" + Jd(SymbolInfoDouble(s, SYMBOL_TRADE_TICK_VALUE), 10) + "," + Jd(SymbolInfoDouble(s, SYMBOL_TRADE_TICK_SIZE), 10)
             + "," + Jd(SymbolInfoDouble(s, SYMBOL_VOLUME_STEP), 4) + "," + Jd(SymbolInfoDouble(s, SYMBOL_TRADE_CONTRACT_SIZE), 4)
             + "," + IntegerToString(SymbolInfoInteger(s, SYMBOL_DIGITS)) + "," + Jd(mb, 2) + "," + Jd(ms, 2)
             + "," + Jd(SymbolInfoDouble(s, SYMBOL_VOLUME_MIN), 4) + "," + Jd(SymbolInfoDouble(s, SYMBOL_VOLUME_MAX), 4)
             + "," + IntegerToString(SymbolInfoInteger(s, SYMBOL_TRADE_STOPS_LEVEL)) + "," + Jd(pp, 6)
             + (CommDue(s) ? "," + CommRules(s) : "") + "]";      // (1.22: the commission rules, once a minute)
     }
   return(out);
  }

//+------------------------------------------------------------------+
//| Deals after the cursor, oldest first, at most DEALS_PER_CALL:     |
//| [ticket, order, position id, symbol, type, entry (0 in, 1 out,    |
//|  2 in/out, 3 out by), volume, price, commission, swap, profit,    |
//|  fee, time ms, magic, comment, reason]                            |
//+------------------------------------------------------------------+
string Deals()
  {
   g_dMore = false;
   g_dNextMsc = g_dCurMsc;
   g_dNextTk = g_dCurTk;
   if(!g_dSet)
      return("");
   datetime from = (datetime)(g_dCurMsc / 1000) - 1;
   if(!HistorySelect(from, TimeCurrent() + 86400))
      return("");
   int n = HistoryDealsTotal();
   long  cm[];
   ulong ct[];
   char  used[];
   ArrayResize(cm, n);
   ArrayResize(ct, n);
   int m = 0;
   for(int i = 0; i < n; i++)
     {
      ulong tk = HistoryDealGetTicket(i);
      if(tk == 0)
         continue;
      long msc = HistoryDealGetInteger(tk, DEAL_TIME_MSC);
      if(msc < g_dCurMsc || (msc == g_dCurMsc && tk <= g_dCurTk))
         continue;                           // the app has it already
      cm[m] = msc;
      ct[m] = tk;
      m++;
     }
   ArrayResize(used, m);
   if(m > 0)
      ArrayInitialize(used, 0);
   string out = "";
   int sent = 0;
   for(int k = 0; k < DEALS_PER_CALL; k++)
     {
      int best = -1;                         // the oldest not yet taken (time, then ticket)
      for(int i = 0; i < m; i++)
        {
         if(used[i] != 0)
            continue;
         if(best < 0 || cm[i] < cm[best] || (cm[i] == cm[best] && ct[i] < ct[best]))
            best = i;
        }
      if(best < 0)
         break;
      used[best] = 1;
      ulong tk = ct[best];
      string sym = HistoryDealGetString(tk, DEAL_SYMBOL);
      int dg = (sym == "" ? 2 : (int)SymbolInfoInteger(sym, SYMBOL_DIGITS));
      if(out != "")
         out += ",";
      out += "[" + IntegerToString((long)tk) + "," + IntegerToString(HistoryDealGetInteger(tk, DEAL_ORDER))
             + "," + IntegerToString(HistoryDealGetInteger(tk, DEAL_POSITION_ID)) + "," + Js(sym)
             + "," + IntegerToString(HistoryDealGetInteger(tk, DEAL_TYPE)) + "," + IntegerToString(HistoryDealGetInteger(tk, DEAL_ENTRY))
             + "," + Jd(HistoryDealGetDouble(tk, DEAL_VOLUME), 4) + "," + Jd(HistoryDealGetDouble(tk, DEAL_PRICE), dg)
             + "," + Jd(HistoryDealGetDouble(tk, DEAL_COMMISSION), 2) + "," + Jd(HistoryDealGetDouble(tk, DEAL_SWAP), 2)
             + "," + Jd(HistoryDealGetDouble(tk, DEAL_PROFIT), 2) + "," + Jd(HistoryDealGetDouble(tk, DEAL_FEE), 2)
             + "," + IntegerToString(cm[best]) + "," + IntegerToString(HistoryDealGetInteger(tk, DEAL_MAGIC))
             + "," + Js(HistoryDealGetString(tk, DEAL_COMMENT)) + "," + IntegerToString(HistoryDealGetInteger(tk, DEAL_REASON)) + "]";
      g_dNextMsc = cm[best];
      g_dNextTk = tk;
      sent++;
     }
   g_dMore = (m > sent);
   return(out);
  }

//+------------------------------------------------------------------+
//| Results of the app's requests, until the app has them             |
//+------------------------------------------------------------------+
string Results()
  {
   string out = "";
   g_resSent = ArraySize(g_res);
   for(int i = 0; i < g_resSent; i++)
     {
      if(i > 0)
         out += ",";
      out += g_res[i];
     }
   return(out);
  }

void DropResults(const int k)
  {
   int n = ArraySize(g_res);
   if(k <= 0)
      return;
   if(k >= n)
     {
      ArrayResize(g_res, 0);
      return;
     }
   for(int i = k; i < n; i++)
      g_res[i - k] = g_res[i];
   ArrayResize(g_res, n - k);
  }

void AddResult(const string r)
  {
   int n = ArraySize(g_res);
   ArrayResize(g_res, n + 1);
   g_res[n] = r;
  }

string Res(const string tag, const bool ok, const uint code, const string msg, const ulong ticket)
  {
   return("[" + Js(tag) + "," + (ok ? "1" : "0") + "," + IntegerToString(code) + "," + Js(msg) + "," + IntegerToString((long)ticket) + "]");
  }

bool Done(const uint rc)
  {
   return(rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_DONE_PARTIAL || rc == TRADE_RETCODE_PLACED || rc == TRADE_RETCODE_NO_CHANGES);
  }

int DoneIndex(const string tag)
  {
   for(int i = ArraySize(g_doneTag) - 1; i >= 0; i--)
      if(g_doneTag[i] == tag)
         return(i);
   return(-1);
  }

void Remember(const string tag, const string res)
  {
   int n = ArraySize(g_doneTag);
   if(n >= TAGS_KEPT)
     {
      for(int i = 1; i < n; i++)
        {
         g_doneTag[i - 1] = g_doneTag[i];
         g_doneRes[i - 1] = g_doneRes[i];
        }
      n--;
     }
   ArrayResize(g_doneTag, n + 1);
   ArrayResize(g_doneRes, n + 1);
   g_doneTag[n] = tag;
   g_doneRes[n] = res;
  }

//+------------------------------------------------------------------+
//| One request from the app (each tag carried out once)              |
//+------------------------------------------------------------------+
void Command(const string line)
  {
   string p[];
   int n = StringSplit(line, ' ', p);
   if(n < 3)
      return;
   string kind = p[0];
   string tag = p[1];
   int d = DoneIndex(tag);
   if(d >= 0)
     {
      AddResult(g_doneRes[d]);               // asked again: the same result, nothing done twice
      return;
     }
   ulong tk = (ulong)StringToInteger(p[2]);
   string r;
   if(!AllowTrading)
      r = Res(tag, false, 0, "trading from the app is off in the EA's inputs (AllowTrading)", tk);
   else
      if(kind == "MOD" && n >= 5)
         r = DoMod(tag, tk, StringToDouble(p[3]), StringToDouble(p[4]));
      else
         if(kind == "CLOSE" && n >= 4)
            r = DoClose(tag, tk, StringToDouble(p[3]));
         else
            if(kind == "CANCEL")
               r = DoCancel(tag, tk);
            else
               if(kind == "OMOD" && n >= 6)
                  r = DoOmod(tag, tk, StringToDouble(p[3]), StringToDouble(p[4]), StringToDouble(p[5]));
               else
                  if(kind == "OPEN" && n >= 9)
                     r = DoOpen(tag, p[2], (int)StringToInteger(p[3]), p[4], StringToDouble(p[5]), StringToDouble(p[6]),
                                StringToDouble(p[7]), StringToDouble(p[8]));
                  else
                     r = Res(tag, false, 0, "bad request: " + line, tk);
   Remember(tag, r);
   AddResult(r);
   g_lastCmd = kind + (kind == "OPEN" ? " " + p[2] : " #" + IntegerToString((long)tk)) + " " + TimeToString(TimeLocal(), TIME_SECONDS);
   Print("FTM Bridge: ", line, " -> ", r);
  }

string DoMod(const string tag, const ulong tk, const double slv, const double tpv)
  {
   if(!PositionSelectByTicket(tk))
      return(Res(tag, false, TRADE_RETCODE_POSITION_CLOSED, "position not found (closed already?)", tk));
   string sym = PositionGetString(POSITION_SYMBOL);
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double pt = SymbolInfoDouble(sym, SYMBOL_POINT);
   double sl = NormalizeDouble(slv, dg);
   double tp = NormalizeDouble(tpv, dg);
   if(MathAbs(PositionGetDouble(POSITION_SL) - sl) < pt / 2 && MathAbs(PositionGetDouble(POSITION_TP) - tp) < pt / 2)
      return(Res(tag, true, TRADE_RETCODE_NO_CHANGES, "no changes", tk));
   bool ok = g_trade.PositionModify(tk, sl, tp);
   uint rc = g_trade.ResultRetcode();
   return(Res(tag, ok && Done(rc), rc, g_trade.ResultRetcodeDescription(), tk));
  }

string DoClose(const string tag, const ulong tk, const double vol)
  {
   if(!PositionSelectByTicket(tk))
      return(Res(tag, false, TRADE_RETCODE_POSITION_CLOSED, "position not found (closed already?)", tk));
   string sym = PositionGetString(POSITION_SYMBOL);
   double have = PositionGetDouble(POSITION_VOLUME);
   g_trade.SetTypeFillingBySymbol(sym);
   bool ok;
   if(vol > 0 && vol < have)
      ok = g_trade.PositionClosePartial(tk, vol, SlippagePoints);
   else
      ok = g_trade.PositionClose(tk, SlippagePoints);
   uint rc = g_trade.ResultRetcode();
   return(Res(tag, ok && Done(rc), rc, g_trade.ResultRetcodeDescription(), tk));
  }

string DoCancel(const string tag, const ulong tk)
  {
   if(!OrderSelect(tk))
      return(Res(tag, false, TRADE_RETCODE_INVALID_ORDER, "order not found (filled or gone already?)", tk));
   bool ok = g_trade.OrderDelete(tk);
   uint rc = g_trade.ResultRetcode();
   return(Res(tag, ok && Done(rc), rc, g_trade.ResultRetcodeDescription(), tk));
  }

string DoOmod(const string tag, const ulong tk, const double pricev, const double slv, const double tpv)
  {
   if(!OrderSelect(tk))
      return(Res(tag, false, TRADE_RETCODE_INVALID_ORDER, "order not found (filled or gone already?)", tk));
   string sym = OrderGetString(ORDER_SYMBOL);
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   ENUM_ORDER_TYPE_TIME tt = (ENUM_ORDER_TYPE_TIME)OrderGetInteger(ORDER_TYPE_TIME);
   datetime exp = (datetime)OrderGetInteger(ORDER_TIME_EXPIRATION);
   double stl = OrderGetDouble(ORDER_PRICE_STOPLIMIT);
   bool ok = g_trade.OrderModify(tk, NormalizeDouble(pricev, dg), NormalizeDouble(slv, dg), NormalizeDouble(tpv, dg), tt, exp, stl);
   uint rc = g_trade.ResultRetcode();
   return(Res(tag, ok && Done(rc), rc, g_trade.ResultRetcodeDescription(), tk));
  }
//+------------------------------------------------------------------+

//+------------------------------------------------------------------+
//| 1.20: OPEN - the order you placed in the app, with its real SL /  |
//| TP. Its comment "FTM <tag>" ties it to the app's request.         |
//+------------------------------------------------------------------+
string DoOpen(const string tag, const string sym, const int side, const string typ, const double vol, const double price,
              const double slv, const double tpv)
  {
   if(!SymbolSelect(sym, true))
      return(Res(tag, false, TRADE_RETCODE_INVALID, sym + " isn't a symbol on this broker", 0));
   int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double v = (step > 0 ? MathRound(vol / step) * step : vol);
   v = NormalizeDouble(v, 8);
   double sl = NormalizeDouble(slv, dg);
   double tp = NormalizeDouble(tpv, dg);
   double px = NormalizeDouble(price, dg);
   string cmt = "FTM " + tag;
   g_trade.SetTypeFillingBySymbol(sym);
   bool ok = false;
   if(typ == "market")
      ok = (side > 0 ? g_trade.Buy(v, sym, 0.0, sl, tp, cmt) : g_trade.Sell(v, sym, 0.0, sl, tp, cmt));
   else
      if(typ == "limit")
         ok = (side > 0 ? g_trade.BuyLimit(v, px, sym, sl, tp, ORDER_TIME_GTC, 0, cmt) : g_trade.SellLimit(v, px, sym, sl, tp, ORDER_TIME_GTC, 0, cmt));
      else
         if(typ == "stop")
            ok = (side > 0 ? g_trade.BuyStop(v, px, sym, sl, tp, ORDER_TIME_GTC, 0, cmt) : g_trade.SellStop(v, px, sym, sl, tp, ORDER_TIME_GTC, 0, cmt));
         else
            return(Res(tag, false, TRADE_RETCODE_INVALID, "unknown order type " + typ, 0));
   uint rc = g_trade.ResultRetcode();
   return(Res(tag, ok && Done(rc), rc, g_trade.ResultRetcodeDescription(), g_trade.ResultOrder()));
  }

//+------------------------------------------------------------------+
//| 1.20: trailing by itself while the app can't be reached           |
//| TRAIL <ticket> 0                     forget it                    |
//| TRAIL <ticket> <side> <best> <BE trigger> <BE price> <SL start>   |
//|       <SL distance> <floor> <min step>  (0 = that part off)       |
//+------------------------------------------------------------------+
bool Offline()
  {
   return(OfflineTrailSec > 0 && AllowTrading && g_okTick > 0 && GetTickCount64() - g_okTick > (ulong)OfflineTrailSec * 1000);
  }

int TrailIndex(const ulong tk)
  {
   for(int i = 0; i < ArraySize(g_tTk); i++)
      if(g_tTk[i] == tk)
         return(i);
   return(-1);
  }

void TrailRemove(const int i)
  {
   int n = ArraySize(g_tTk);
   for(int j = i; j < n - 1; j++)
     {
      g_tTk[j] = g_tTk[j + 1];
      g_tSide[j] = g_tSide[j + 1];
      g_tBest[j] = g_tBest[j + 1];
      g_tBeT[j] = g_tBeT[j + 1];
      g_tBeP[j] = g_tBeP[j + 1];
      g_tSlS[j] = g_tSlS[j + 1];
      g_tSlD[j] = g_tSlD[j + 1];
      g_tFloor[j] = g_tFloor[j + 1];
      g_tStep[j] = g_tStep[j + 1];
      g_tLast[j] = g_tLast[j + 1];
     }
   TrailSize(n - 1);
  }

void TrailSize(const int n)
  {
   ArrayResize(g_tTk, n);
   ArrayResize(g_tSide, n);
   ArrayResize(g_tBest, n);
   ArrayResize(g_tBeT, n);
   ArrayResize(g_tBeP, n);
   ArrayResize(g_tSlS, n);
   ArrayResize(g_tSlD, n);
   ArrayResize(g_tFloor, n);
   ArrayResize(g_tStep, n);
   ArrayResize(g_tLast, n);
  }

void SetTrail(const string line)
  {
   string p[];
   int n = StringSplit(line, ' ', p);
   if(n < 3)
      return;
   ulong tk = (ulong)StringToInteger(p[1]);
   int i = TrailIndex(tk);
   int side = (int)StringToInteger(p[2]);
   if(side == 0 || n < 10)
     {
      if(i >= 0)
         TrailRemove(i);
      return;
     }
   double best = StringToDouble(p[3]);
   if(i < 0)
     {
      i = ArraySize(g_tTk);
      TrailSize(i + 1);
      g_tTk[i] = tk;
      g_tLast[i] = 0;
     }
   else                                        // keep the better of the app's best price and the one seen here
      best = (side > 0 ? MathMax(best, g_tBest[i]) : (g_tBest[i] > 0 ? MathMin(best, g_tBest[i]) : best));
   g_tSide[i] = side;
   g_tBest[i] = best;
   g_tBeT[i] = StringToDouble(p[4]);
   g_tBeP[i] = StringToDouble(p[5]);
   g_tSlS[i] = StringToDouble(p[6]);
   g_tSlD[i] = StringToDouble(p[7]);
   g_tFloor[i] = StringToDouble(p[8]);
   g_tStep[i] = StringToDouble(p[9]);
  }

void TrailBest()
  {
   for(int i = ArraySize(g_tTk) - 1; i >= 0; i--)
     {
      if(!PositionSelectByTicket(g_tTk[i]))
        {
         TrailRemove(i);                       // closed: nothing to trail
         continue;
        }
      double bid = SymbolInfoDouble(PositionGetString(POSITION_SYMBOL), SYMBOL_BID);   // (the app's best price is the bid too)
      if(bid <= 0)
         continue;
      if(g_tSide[i] > 0 ? bid > g_tBest[i] : (g_tBest[i] <= 0 || bid < g_tBest[i]))
         g_tBest[i] = bid;
     }
  }

void OfflineTrail()
  {
   ulong now = GetTickCount64();
   for(int i = 0; i < ArraySize(g_tTk); i++)
     {
      if(!PositionSelectByTicket(g_tTk[i]))
         continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      int sd = g_tSide[i];
      double cur = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      double exitPx = (sd > 0 ? SymbolInfoDouble(sym, SYMBOL_BID) : SymbolInfoDouble(sym, SYMBOL_ASK));
      if(exitPx <= 0)
         continue;
      double want = cur;
      if(g_tBeT[i] > 0 && sd * (g_tBest[i] - g_tBeT[i]) >= 0 && sd * (exitPx - g_tBeP[i]) > 0)
         if(want == 0 || sd * (g_tBeP[i] - want) > 0)
            want = g_tBeP[i];                  // Trail BE
      if(g_tSlS[i] > 0 && sd * (g_tBest[i] - g_tSlS[i]) >= 0)
        {
         double c = g_tBest[i] - sd * g_tSlD[i];  // Trail SL: that far behind the best price ...
         if(g_tFloor[i] > 0)
            c = (sd > 0 ? MathMax(c, g_tFloor[i]) : MathMin(c, g_tFloor[i]));   // ... never below break-even + costs
         if(sd * (exitPx - c) > 0 && (want == 0 || sd * (c - want) >= g_tStep[i]))
            want = c;
        }
      want = NormalizeDouble(want, dg);
      if(want == 0 || (cur != 0 && sd * (want - cur) <= 0))
         continue;                             // only ever tighter
      if(now - g_tLast[i] < 2000)
         continue;                             // (2 s apart at most, like the app)
      g_tLast[i] = now;
      if(g_trade.PositionModify(g_tTk[i], want, tp) && Done(g_trade.ResultRetcode()))
        {
         if(g_tBeT[i] > 0 && MathAbs(want - NormalizeDouble(g_tBeP[i], dg)) < SymbolInfoDouble(sym, SYMBOL_POINT) / 2)
            g_tBeT[i] = 0;                     // Trail BE done
         int k = ArraySize(g_trailed);
         ArrayResize(g_trailed, k + 1);
         g_trailed[k] = "[" + IntegerToString((long)g_tTk[i]) + "," + Jd(want, dg) + "," + IntegerToString((long)TimeCurrent() * 1000) + "]";
         g_nTrailed++;
         Print("FTM Bridge: can't reach the app - trailed #", g_tTk[i], "'s stop to ", DoubleToString(want, dg));
        }
     }
  }

string Trailed()
  {
   string out = "";
   g_trailedSent = ArraySize(g_trailed);
   for(int i = 0; i < g_trailedSent; i++)
     {
      if(i > 0)
         out += ",";
      out += g_trailed[i];
     }
   return(out);
  }

void DropTrailed(const int k)
  {
   int n = ArraySize(g_trailed);
   if(k <= 0)
      return;
   if(k >= n)
     {
      ArrayResize(g_trailed, 0);
      return;
     }
   for(int i = k; i < n; i++)
      g_trailed[i - k] = g_trailed[i];
   ArrayResize(g_trailed, n - k);
  }
//+------------------------------------------------------------------+
