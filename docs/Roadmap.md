# Roadmap: what's agreed and what's left

Updated 31 Oct 2026 (v0.13.2). Done items move to CHANGELOG.md. Security, users and multiple paper accounts shipped in v0.13.0; square-off 5 minutes before Fyers and the product switch on the chart in v0.13.1.

## Next, in this order

1. **Live mode** (the admin only). Design agreed 31 Oct 2026:
   - Each account is Paper or Live, behind a broker layer, so switching is a flip of a setting. Live sends orders to Fyers on the owner's own login and reads fills and positions back from Fyers' order-update socket (it doesn't count against the API limits).
   - **Stops:** a real stop-loss order sits at Fyers from the moment the trade opens. Trailing, BE and BE-T move that order (never below BE, never backwards). There is only ever one exit order at Fyers per position.
   - **The server still watches** with the bid / ask rule (like MT5). If its rule fires first, it changes that same Fyers order to a market exit, never placing a second exit. If a triggered stop doesn't fill (price jumped past its limit), the server changes it to market.
   - **Targets stay on the server** (no target order at Fyers, so two exits can't both fill).
   - **Server down:** the Fyers stop protects the position at its last trailed level; trailing and the target pause. **Back up:** it first asks Fyers what happened: records a stop that filled; resumes trailing; if price is already past the target, closes at market straight away.
   - **Lag / refused change:** the previous stop stays in force; the app retries and shows a warning.
   - **Overnight (Carry / NRML) positions:** exchange orders last only for the day, so after the daily Fyers login each morning the app places a fresh stop at the trailed level. Until then a warning shows.
   - Fyers rules: under 10 orders a second and 200 a minute, modifications included (the helper queues at 4/s, 120/min; going over the per-minute limit 3+ times a day blocks the account for the day); market orders become market-price-protection orders; no after-market orders; daily Fyers login. Fyers triggers stops on the last traded price, so live exits can differ by a tick from paper's bid / ask rule.
   - Safeguards: a typed confirmation showing the Fyers client ID plus a fresh 2FA code to turn Live on; a red LIVE badge everywhere; a kill switch (cancel everything, close everything); all of it in the security log.
   - Before testing: the owner whitelists the droplet's own IP **134.209.159.171** in the Fyers API app and gives it order permission. Test with 1 lot on MCX first.
   - Then: compare the app's charges with the charges Fyers actually deducted, and flag any gap.
2. **Telegram alerts:** a message if the server stops responding while a live trade is open (with the journal's Telegram set-up).
3. **Journal: full Octagon port** (from `octagon_journal.html`)
   - Paper and live trades arrive automatically, per user and account.
   - 8 pillars audit; notes, tags, plan; insights; review calendar; filters and stats.
   - Screenshots on the server, with the chart captured automatically at entry and exit. Telegram as a backup copy.
4. **Candle types and order flow**
   - Heikin-Ashi, Renko, range bars and similar.
   - Footprint / delta built from live snapshots, recorded from the day it's switched on. These are approximate: Fyers sends snapshots, not every trade, and its history has no order-flow data.

## Rules that shape live trading and other users (checked 30 Oct 2026)

Sources: SEBI circular of 4 Feb 2025, NSE's API operating procedures, and Fyers' rules in force from 1 Apr 2026.

- **API orders come only from the static IP whitelisted on that client's own Fyers app.** Each user needs a unique static IP.
  - Sharing is allowed only within family (spouse, dependent parents, dependent children), after Fyers' KYC declaration.
  - A friend is not eligible.
- **Third-party platforms may route orders only if empanelled** and hosted inside the broker's own systems.
  - So on this server: other users get paper trading with prices from their own Fyers app. Live trading is for the owner only.
  - A friend who wants live trading runs their own copy of the app on their own server and static IP.
- **Whitelist the droplet's own IP, 134.209.159.171.** Outgoing traffic from a DigitalOcean droplet uses that IP, not the reserved 68.183.245.178.
- **Live mode limits:**
  - at most 10 orders per second per client, modifications included (so trailing must be paced);
  - market orders become market-price-protection orders;
  - no after-market orders;
  - a Fyers 2FA login every day.
- **Still to confirm with Fyers in writing:** whether a second user's app may fetch market data from this server's IP. (Drafted support request, 30 Oct.)

## Small follow-ups

- Agri MCX contracts use the non-agri rates.
- Partial closes.
