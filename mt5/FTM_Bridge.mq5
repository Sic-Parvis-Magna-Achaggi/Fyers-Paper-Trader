//+------------------------------------------------------------------+
//| FTM_Bridge.mq5                                                    |
//| Connects this MT5 terminal to Fyers Trade Manager, my own         |
//| charting app on my server, so its charts (Point & Figure, Renko,  |
//| Pine scripts...) can show this broker's own prices.               |
//|                                                                   |
//| How it talks to the app: it only ever calls OUT, with WebRequest, |
//| about 4 times a second (POST /api/mt5/sync). Nothing connects in  |
//| to this computer, and the app never logs in to the broker.        |
//|                                                                   |
//| Each call sends: this account (login, server, balance...), the    |
//| broker's clock, and the new ticks of the symbols the app asked    |
//| for. The app answers with a few lines of text:                    |
//|   OK <ms>                    call again after this many ms        |
//|   SUB <sym1>,<sym2>,...      the symbols to send ticks for        |
//|   HIST <id> <sym> <tf> <from> <to>                                |
//|                              send candles (CopyRates) for that    |
//|                              range, in broker server time         |
//|   LIST                       send the broker's symbol list        |
//|   ERR <message>              a problem (shown on the chart)       |
//|                                                                   |
//| Version 1.00 (stage a): prices and candles only. It places,       |
//| changes and closes NO orders.                                     |
//+------------------------------------------------------------------+
#property copyright   "Ashwin Kumar"
#property version     "1.00"
#property description "FTM Bridge 1.00: sends this terminal's prices, candles and symbol list to your Fyers Trade Manager."
#property description "Calls out only (WebRequest). Places no orders."

input string ServerURL = "https://68-183-245-178.sslip.io"; // App address (also add it in Tools > Options > Expert Advisors)
input string BridgeKey = "";                                 // Bridge key (Settings > MT5 bridge in the app)
input int    PollMs    = 250;                                // Call the app every ... ms
input int    TimeoutMs = 5000;                               // WebRequest time-out (ms)

#define EA_VER        "1.00"
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
   s += "\nPlaces no orders.";
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
   string b = "{\"v\":1,\"ea\":" + Js(EA_VER) + ",\"build\":" + IntegerToString(TerminalInfoInteger(TERMINAL_BUILD));
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
   b += "},\"ticks\":[" + Ticks() + "]}";
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
