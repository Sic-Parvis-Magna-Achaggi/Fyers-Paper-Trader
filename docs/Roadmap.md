# Roadmap: what's agreed and what's left

Updated 30 Oct 2026. Done items move to CHANGELOG.md. Security, users and multiple paper accounts shipped in v0.13.0.

## Next, in this order

1. **Charges, once live:** compare with the charges Fyers actually deducted, and flag any gap.
2. **Live mode** (the admin only)
   - Each account is Paper or Live. Live sends the same orders to Fyers on that user's own login and reads fills and positions back. SL, BE and trailing stay on the server, like the EA.
   - Safeguards:
     - a typed confirmation showing the Fyers client ID;
     - a red LIVE badge everywhere;
     - a kill switch.
   - Turning Live on asks for a fresh 2FA code; Live on / off and the kill switch go in the security log.
   - Off until tested with small size.
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
