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
//|   ERR <message>              a problem (shown on the chart)       |
//| Each request has a tag; it is carried out once, and its result is |
//| sent back with the next call (a tag seen again is not repeated).  |
//|                                                                   |
//| Version 1.10 (stage b, slice b1): manages trades that already     |
//| exist (moves SL / TP, closes, cancels or moves pending orders),   |
//| only when the app asks and only if AllowTrading is true. It OPENS |
//| NO new trades (that is a later version).                          |
//| Version 1.00 (stage a): prices and candles only.                  |
//+------------------------------------------------------------------+
#property copyright   "Ashwin Kumar"
#property version     "1.10"
#property description "FTM Bridge 1.10: sends this terminal's prices, candles, symbol list and account to your Fyers Trade Manager,"
#property description "and carries out the app's requests on existing trades (SL / TP, close, cancel). Opens no new trades."
#property description "Calls out only (WebRequest)."

#include <Trade\Trade.mqh>

input string ServerURL = "https://68-183-245-178.sslip.io"; // App address (also add it in Tools > Options > Expert Advisors)
input string BridgeKey = "";                                 // Bridge key (Settings > MT5 bridge in the app)
input int    PollMs    = 250;                                // Call the app every ... ms
input int    TimeoutMs = 5000;                               // WebRequest time-out (ms)
input bool   AllowTrading   = true;                          // Let the app manage this account's trades (SL / TP, close, cancel)
input int    SlippagePoints = 30;                            // Closing at market: most slippage accepted (points)

#define EA_VER        "1.10"
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
   if(GetTickCount64() < g_waitTill)
      return;
   string reply = "";
   int code = Post("/api/mt5/sync", SyncBody(), reply);
   if(code == 200)
     {
      ArrayCopy(g_lastMsc, g_nextMsc);       // the app has these ticks now (before Handle: SUB may change the list)
      g_sent += g_nextSent;
      g_dCurMsc = g_dNextMsc;                // ... and these deals (before Handle: DEALS may move the cursor)
      g_dCurTk = g_dNextTk;
      DropResults(g_resSent);                // ... and these results
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
      s += "\nManages this account's trades when the app asks: moves SL / TP, closes, cancels. Opens no new trades.";
   else
      s += "\nApp trading OFF (input AllowTrading = false): shows the account to the app, changes nothing.";
   if(g_lastCmd != "")
      s += "\nLast request: " + g_lastCmd;
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
   b += ",\"res\":[" + Results() + "]}";
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
                           || StringFind(ln, "OMOD ") == 0)
                           Command(ln);
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
string SymInfo(const string &syms[])
  {
   string out = "";
   for(int i = 0; i < ArraySize(syms); i++)
     {
      string s = syms[i];
      if(out != "")
         out += ",";
      out += Js(s) + ":[" + Jd(SymbolInfoDouble(s, SYMBOL_TRADE_TICK_VALUE), 10) + "," + Jd(SymbolInfoDouble(s, SYMBOL_TRADE_TICK_SIZE), 10)
             + "," + Jd(SymbolInfoDouble(s, SYMBOL_VOLUME_STEP), 4) + "," + Jd(SymbolInfoDouble(s, SYMBOL_TRADE_CONTRACT_SIZE), 4)
             + "," + IntegerToString(SymbolInfoInteger(s, SYMBOL_DIGITS)) + "]";
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
                  r = Res(tag, false, 0, "bad request: " + line, tk);
   Remember(tag, r);
   AddResult(r);
   g_lastCmd = kind + " #" + IntegerToString((long)tk) + " " + TimeToString(TimeLocal(), TIME_SECONDS);
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
