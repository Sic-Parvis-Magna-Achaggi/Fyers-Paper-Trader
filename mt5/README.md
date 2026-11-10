# FTM Bridge: my MT5 EA

`FTM_Bridge.mq5` connects my MT5 terminal (FundingPips) to Fyers Trade Manager, my own charting app on my own server, so
its charts (Point & Figure, Renko, my Pine scripts...) can show my broker's prices, and so I can manage my trades from it.
This page explains how it works, in plain words, for anyone who asks (FundingPips' Responsible Trading Team included).

## What version 1.10 does

- **Prices and candles**, as 1.00 did.
- **This account, for the app:** its open positions, pending orders and deals (MT5's own history of the account), sent
  with each call, so the app shows my trades - also the ones I place in MT5 itself - with their real figures.
- **It manages trades that already exist, only when I ask in the app:** move a position's SL / TP (`PositionModify`),
  close a position at market (`PositionClose`), move or delete a pending order (`OrderModify`, `OrderDelete`), using MT5's
  standard trade library (`CTrade`). Breakeven and trailing in the app are the same thing: the app works out the new stop
  and asks the EA to move the real stop at the broker. There is no strategy in the EA; every request starts from my click
  or from a rule I set on that trade (BE at 1R, trail at 1R).
- **It opens no new trades.** There is no `OrderSend`, no `Buy` / `Sell`, no `BuyLimit` / `SellStop` in the code: placing
  orders from the app is a later version.
- **Input `AllowTrading`** (true by default): false makes the EA refuse every request (it then only shows the account).
  MT5's own **Algo Trading** button and the EA's "Allow Algo Trading" box must be on as well, or MT5 refuses too.
- Every request has a tag; the EA carries out a tag once (it remembers the last 200), and sends the result back. The
  app paces its requests (one change per trade every 2 seconds at most, 30 a minute per account), so the broker's server
  is never spammed.
- It runs only in MT5 on my own laptop, on my home internet. No VPS, no VPN.
- It **only calls out** to my server with MT5's WebRequest. Nothing connects in to my laptop, and the server never logs in
  to my broker account (it has no password, no investor password, nothing).

## How it works, step by step

1. **Start** (`OnInit`): checks that a bridge key was entered, then starts a timer (every 250 ms by default).
2. **Every timer tick** (`OnTimer`) it makes one call, `POST /api/mt5/sync`, sending:
   - the account: login, server, company, currency, balance, equity, margin, leverage, Hedge / Netting mode;
   - the broker's clock (`TimeTradeServer` and `TimeGMT`), so the app can turn the broker's times into real times;
   - every new price tick (bid / ask) since the last call, for the symbols the app asked for (`CopyTicks`). It only
     counts them as delivered once the app has answered, so a failed call sends them again (the app ignores repeats).
     After a gap of more than a minute (MT5 or the internet was off) it starts again from the latest price instead of
     replaying the gap; the app reloads the candles for that time from MT5's history.
3. **The server answers with a few lines of text**, which the EA reads (`Handle`):
   - `OK 250`: all fine, call again in 250 ms.
   - `SUB XAUUSD,EURUSD`: the symbols the app's open charts and watchlists need. The EA adds them to Market Watch
     (`SymbolSelect`), because MT5 only sends prices for symbols there. A name this broker doesn't have is noted once in
     the Experts log.
   - `HIST <id> <symbol> <timeframe> <from> <to>`: a chart needs candles. The EA reads them from MT5 (`CopyRates`) and
     sends them with `POST /api/mt5/bars`, in parts of 20,000. If MT5 is still downloading that history, it tries again
     on the next calls for up to 37 seconds, then tells the app to try again later. A range before the broker's history
     gets an empty answer.
   - `LIST`: the app wants the broker's symbol list. The EA sends every symbol with its settings (digits, tick size,
     contract size, volume steps, swap...) with `POST /api/mt5/symbols`.
   - `ERR <message>`: something to show (for example a key the server doesn't accept).
   - (1.10) `DEALS <from>`: send the account's deals from this server time on (`HistorySelect`, `HistoryDealsTotal`).
     The EA sends at most 200 a call, oldest first, and counts them as delivered only once the app has answered.
   - (1.10) `MOD <tag> <ticket> <sl> <tp>`: change that position's stop loss / take profit (`DoMod`).
   - (1.10) `CLOSE <tag> <ticket> <volume>`: close that position at market (`DoClose`; volume 0 = all of it).
   - (1.10) `CANCEL <tag> <ticket>`: delete that pending order (`DoCancel`).
   - (1.10) `OMOD <tag> <ticket> <price> <sl> <tp>`: move that pending order (`DoOmod`).
     Each result (done, or MT5's refusal and its code) goes back with the next call (`Results`).
4. **If a call fails** (`Failed`), it waits longer before the next one (1 s, 2 s, ... up to 30 s) and shows why on the
   chart: for example that WebRequest isn't allowed for the address yet.
5. **The chart's corner** (`Show`) says whether it's connected, how many symbols it streams, how many positions and pending
   orders the account has, whether the app may manage them (AllowTrading), and the last request it carried out.

## The bridge key

The app makes the key (Settings › MT5 bridge, with my 2FA code). I paste it into the EA's `BridgeKey` input. The EA sends
it with every call (`X-FTM-Key` header); the server keeps only a fingerprint of it. A new key stops the old one.

## Setting it up

1. Put `FTM_Bridge.mq5` in MT5's `MQL5\Experts` folder (File › Open Data Folder).
2. Open it in MetaEditor (F4) and Compile (F7).
3. Tools › Options › Expert Advisors: tick **Allow WebRequest for listed URL** and add the app's address.
4. Drag FTM_Bridge onto any chart; paste the key into `BridgeKey`. To let the app manage the trades: tick "Allow Algo
   Trading" in the EA's Common tab and keep MT5's Algo Trading button on (or set `AllowTrading` to false: show only).
5. Each MT5 account (each terminal / login) runs its own copy of the EA, with the same key.

## Proof that it's mine

I built it with an AI coding assistant (Claude), to my own design, for my own app only. It isn't a bought, shared or
downloaded EA.

- This source file, with its history in my GitHub repository (every version is a commit).
- I compile it myself in my own MetaEditor (the compile log and the file paths under my own user folder).
- This explanation, and I can walk through the code on a call.

## Versions

- **1.00** (10 Nov 2026): prices, candles and the symbol list. No trading.
- **1.10** (10 Nov 2026): the account's positions, pending orders and deals for the app; carries out the app's requests on
  existing trades (SL / TP, close, cancel / move a pending order), once per tag, only with AllowTrading on. Opens no new
  trades.
