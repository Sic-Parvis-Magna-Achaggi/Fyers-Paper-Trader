# Server setup (DigitalOcean)

The owner's server is already built (30 Oct 2026). This page records how it was built.

**A new server** (a friend's, or a replacement for this one), on any Linux server and at any provider: follow
**`docs/New_Server_Guide.md`**. Since v0.31.0, `server/startup.sh` does the whole install by itself once its deploy key
is added on GitHub. The manual "First install" below is only how this server was done.

## What exists

See `Server_Details.md`. In short: droplet `fyers-helper` in Bangalore, reserved IP `68.183.245.178`, web address `https://68-183-245-178.sslip.io`, user `helper` with a read-only GitHub deploy key.

`server/startup.sh` ran on first boot (its 30 Oct version). It:
- set up swap and the IST time zone;
- installed git, Python, the ufw firewall and Caddy;
- created the `helper` user and its deploy key.

**This server's own settings** (since v0.31.0) are in `/etc/fyers/server.conf`, not in Git: the address
(`FYERS_HOST`, kept from the Caddyfile: `68-183-245-178.sslip.io`), the outgoing IP Fyers sees (`FYERS_OUT_IP`, looked up
once: `134.209.159.171`), the branch followed (`FYERS_BRANCH`, empty = `main`), the repo and the Python. `install.sh`
wrote the file on the first update to v0.31.0; nothing to do. To change a value, edit it and run
`bash /home/helper/app/server/install.sh`.

## First install of the app (once, after the code is on GitHub)

1. DigitalOcean → Droplets → `fyers-helper` → **Access** → **Launch Droplet Console**.
2. Paste and run:

   ```
   sudo -u helper GIT_SSH_COMMAND="ssh -i /home/helper/.ssh/deploy_key -o IdentitiesOnly=yes" git clone git@github.com:Sic-Parvis-Magna-Achaggi/Fyers-Paper-Trader.git /home/helper/app && bash /home/helper/app/server/install.sh
   ```

3. It ends by printing the web address and a **setup code**. Open the address, enter the code, choose your username and password, then set up two-factor login with an authenticator app.

## Updates

Nothing to do. Every minute the server checks GitHub (`fyers-update.timer`): the repo's default branch, or `FYERS_BRANCH`
from `/etc/fyers/server.conf`. When it changes, it does three things:
- takes the new version;
- installs any new Python packages;
- restarts the helper.

Upload a new zip to GitHub (with `tools/github_upload.html`; the token setup is in the README › Releasing a new version) and it's live within about a minute. The version shows at the bottom of Settings.

## Useful console commands

| What | Command |
| --- | --- |
| Is the helper running? | `systemctl status fyers-helper` |
| Helper log | `journalctl -u fyers-helper -n 100 --no-pager` |
| Update log | `journalctl -u fyers-update -n 50 --no-pager` |
| Restart the helper | `systemctl restart fyers-helper` |
| This server's settings | `cat /etc/fyers/server.conf` |
| A new server's set-up (servers made with v0.31.0's `startup.sh`) | `sudo fyers-status` (`--wait` to watch) |
| Is the watchdog running? (Telegram alerts when the helper stops answering) | `systemctl status fyers-watchdog` |
| Watchdog log | `journalctl -u fyers-watchdog -n 50 --no-pager` |
| Forgot the password, or lost the 2FA phone and recovery codes | `cd /home/helper/app && sudo -u helper /home/helper/venv/bin/python -m helper.users rescue admin` prints a temporary password; log in with it, choose a new one and set up 2FA again (everything else is kept). Other users: Settings → Users on the page |

## Where things live on the server

| Path | What |
| --- | --- |
| `/home/helper/app` | The code (a copy of the GitHub repo) |
| `/home/helper/venv` | Python packages |
| `/home/helper/data` | Users (`users.json`), the security log (`audit.jsonl`), the encryption key (`secret.key`), symbol lists, and each user's files in `u/<user>/` (Fyers app, candles, scripts, paper accounts in `a/<account>/`). Only `helper` can read it. Back up `secret.key` with the rest: without it the Fyers secrets must be entered again |
| `/etc/caddy/Caddyfile` | Web server: HTTPS, forwards to the helper on 127.0.0.1:8000 |
| `/etc/fyers/server.conf` | This server's own address, outgoing IP, branch, repo and Python (not in Git; `server/serverconf.sh`) |
