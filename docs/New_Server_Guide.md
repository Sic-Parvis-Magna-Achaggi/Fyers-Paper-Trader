# Your own server: setting up a new one

For someone who wants the Fyers trade manager on **their own server**: their own address, their own users, and live trading
from their own static IP. (On someone else's server you can only paper trade: Fyers takes API orders only from the IP
whitelisted on *your* Fyers app, and a friend can't share that IP. See the Roadmap's "Rules that shape live trading".)

**Works on any Linux server with systemd**, at any provider or at home:
- **Recommended:** Ubuntu 24.04.
- **Also:** Ubuntu 22.04+ and Debian 12+, or Rocky / Alma / RHEL 9+, Fedora, Oracle Linux, Amazon Linux 2023.
- **Size:** 1 CPU and 1 GB of RAM is enough (about $6 a month); the script adds swap on small servers.
- **Region:** pick India (e.g. Bangalore or Mumbai) for speed to Fyers.

**Time: about 15 minutes**, most of it waiting. Your part:
1. Have the code on GitHub (once).
2. Create the server with the set-up script.
3. Give the server read access to the code: one key, pasted into GitHub.
4. Open the address and make your login.

Everything else happens by itself: installing, HTTPS, the services, and every later update.

---

## Step 1. The code on GitHub (pick one)

The server pulls the code from a GitHub repo, every minute, with a **read-only key** of its own. Which repo:

| | **A. The owner's repo** | **B. A fork** | **C. Your own copy** |
| --- | --- | --- | --- |
| What you do | Nothing | Fork it once | Make an empty repo once |
| Updates | Automatic, within a minute of each release | You press **Sync fork** on GitHub when you want them; your server then takes them | You upload each release zip the owner sends you |
| Who adds the server's key (step 3) | The owner (you send him the key) | You | You |
| If the owner removes your access | Updates stop; your server keeps running | GitHub deletes the fork; your server keeps running, updates stop | Nothing changes |

**A. The owner's repo:** nothing to set up. Use `Sic-Parvis-Magna-Achaggi/Fyers-Paper-Trader` in step 2. If the owner
keeps a `stable` branch (see "For the owner" below), use that branch, so releases reach you only once he's happy with them.

**B. A fork:**
1. The owner invites you to the repo with **Read** access (repo › Settings › Collaborators and teams › Add people).
2. The owner allows private forks, once: Organization › Settings › Member privileges › Repository forking › "Allow forking
   of private repositories"; then repo › Settings › General › "Allow forking".
3. You open the repo on GitHub › **Fork** › owner: you › Create fork. It stays private.
4. Updates: open your fork › **Sync fork** › Update branch.

**C. Your own copy:**
1. github.com › **New repository**:
   - name `Fyers-Paper-Trader`;
   - **Private**;
   - tick **Add a README file** (the upload tool needs a first commit).
2. The owner sends you the release zip. Unzip it and open `tools/github_upload.html` from inside it (double-click).
3. Follow the page's steps with **your own** token, made on github.com › Settings › Developer settings › Fine-grained tokens:
   - resource owner: you;
   - only this repository;
   - Contents: Read and write.
4. In **Repository**, type `yourname/Fyers-Paper-Trader`. **Check**, then **Release**.
5. Each new version: the same, with the new zip.

---

## Step 2. Create the server with the set-up script

The script is `server/startup.sh` in the repo (open it on GitHub › Raw, or in the zip). **Change one line at the top:**

```
REPO="yourname/Fyers-Paper-Trader"   # the repo from step 1
```

Optional lines below it:
- `BRANCH="stable"`: follow that branch instead of the default one;
- `HOST="trade.example.in"`: your own domain, already pointed at the server, instead of the free `<ip>.sslip.io` address.

Then either way:

**a) While creating the server (easiest).** Paste the whole edited script into the provider's start-up box:

| Provider | Where |
| --- | --- |
| DigitalOcean | Create › Droplets › Ubuntu 24.04 › Advanced options › **Add Initialization scripts** |
| AWS EC2 / Lightsail | Advanced details › **User data** / Lightsail: **Add launch script** |
| Hetzner | Create server › **Cloud config** |
| Vultr | **Cloud-Init User-Data** (Additional features) |
| Linode / Akamai | **Add User Data** (Metadata) |
| Oracle Cloud | Show advanced options › Management › **Cloud-init script** |
| Google Cloud | Management › Automation › **Startup script** |

**b) On a server that's already running.** Log in over SSH, then:
1. `sudo nano /root/startup.sh`
2. Paste the whole script; save (Ctrl+O, Enter, Ctrl+X).
3. `sudo bash /root/startup.sh yourname/Fyers-Paper-Trader`

With (b) you can skip editing the file: the repo goes after the command, then optionally the branch and your domain. For
example, `sudo bash /root/startup.sh yourname/Fyers-Paper-Trader stable trade.example.in`.

**Firewall at the provider.** The script opens ports 80 and 443 on the server itself. Some providers also have their
own firewall in their web console, which must allow **80 and 443** (plus 22 for SSH):
- **AWS:** a security group.
- **Oracle Cloud:** the subnet's security list.
- **Google Cloud:** a firewall rule.
- **Lightsail:** the instance's Networking tab.

DigitalOcean, Hetzner, Vultr and Linode have none by default.

**A fixed IP.** Fyers needs the IP to stay the same. Most VPS IPs stay the same until the server is destroyed. On AWS,
attach an **Elastic IP**; on Oracle, a **reserved public IP**; on Google Cloud, a **static external IP**.

---

## Step 3. Give the server read access to the code

1. Open the server's console:
   - **The provider's web console:** DigitalOcean: Droplet › Access › Launch Droplet Console.
   - **Or SSH:** log in, then run `sudo fyers-status --wait`.

   You'll see this (with your own key):

   ```
   =============== Fyers trade manager: this server ===============
   STEP 1 of 2: let this server read the code on GitHub (read-only).
     Repo: yourname/Fyers-Paper-Trader
     1. Open  https://github.com/yourname/Fyers-Paper-Trader/settings/keys/new
     2. Title: fyers-1   Key: the whole line below   Leave "Allow write access" UNticked   Add key

   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... fyers-fyers-1-deploy
   ```

   "First-boot set-up is still running" instead? Wait 3-5 minutes, then run `sudo fyers-status --wait`.
2. Copy the `ssh-ed25519 ...` line.
3. Open the link shown (repo › Settings › **Deploy keys** › Add deploy key):
   - **Title:** anything.
   - **Key:** paste.
   - **Allow write access:** leave it unticked.
   - Press **Add key**.

   **Option A** (the owner's repo): you can't add it yourself. Send the line to the owner and he adds it. It's a public key,
   safe to send in a chat.
4. Within 30 seconds the server notices and installs the app (3-5 minutes). With `sudo fyers-status --wait` running you
   see it change to:

   ```
   READY. Open  https://203-0-113-7.sslip.io
     Setup code:  ABCD-1234
     ...
     For live trading, whitelist this IP in your Fyers API app:  203.0.113.7
   ```

---

## Step 4. Open the address and make your login

1. Open the address shown. The first visit can take a few seconds while the HTTPS certificate is issued.
2. Enter the **setup code**, then choose your username and password. You're this server's admin.
3. Set up two-factor login with an authenticator app (Google Authenticator, Authy, ...). Keep the recovery codes.
4. **Settings › Fyers:** your own Fyers API app's App ID and Secret.
   - Create the app at myapi.fyers.in.
   - Its redirect URL is shown in Settings: copy it into the Fyers app.
5. **For live trading:** in your Fyers API app, whitelist the IP from step 3 with order permission. Turning an account Live
   (Account page) shows the same IP. Test with 1 lot first.
6. Optional: **Settings › Telegram alerts** (your own bot).

---

## After that

**Updates.** Every minute the server checks its repo, and branch if one is set. When there's a new version, it takes
it, installs any new Python packages and restarts. The version shows at the bottom of Settings. Each option from step 1
updates differently:
- **A:** releases arrive by themselves.
- **B:** press Sync fork.
- **C:** upload the new zip.

**This server's own settings** are in `/etc/fyers/server.conf`, not in Git, so an update never changes them:

| Line | What |
| --- | --- |
| `FYERS_HOST` | The web address |
| `FYERS_OUT_IP` | The IP Fyers sees |
| `FYERS_BRANCH` | The branch followed |
| `FYERS_REPO` | The repo, for the record |
| `FYERS_PYTHON` | The Python used |

To change one, edit it (`sudo nano /etc/fyers/server.conf`), then run `sudo bash /home/helper/app/server/install.sh`.
- **Your own domain later:** point its DNS at the server, then set `FYERS_HOST=trade.example.in`.
- **The IP changed** (new server, new Elastic IP): empty `FYERS_OUT_IP=`. It's looked up again on the next run.

**Backups.** Everything you make lives in `/home/helper/data`: users, accounts, trades, journal, scripts. The Fyers secrets
are encrypted with `data/secret.key`, so back up the whole folder, as root:
`tar czf /root/fyers-data-$(date +%F).tgz -C /home/helper data`, then copy the file off the server. Moving to a new
server:
1. Set the new server up to step 3.
2. Stop the helper: `systemctl stop fyers-helper`.
3. Unpack your backup into `/home/helper`.
4. `chown -R helper:helper /home/helper/data`.
5. Start the helper: `systemctl start fyers-helper`.
6. Whitelist the new IP at Fyers.

---

## For the owner: a `stable` branch (option A)

Your servers follow your repo's default branch (`main`). To choose which releases reach a friend's server:
1. On GitHub, create the branch once: repo › branch menu › type `stable` › **Create branch stable from main**.
2. The friend's server uses `BRANCH="stable"` (or `FYERS_BRANCH=stable` in its `/etc/fyers/server.conf`).
3. When a release has proved itself on your server, release the same zip again with `tools/github_upload.html`, typing
   `stable` in its **Branch** box. The friend's server takes it within a minute.

Your own server's set-up doesn't change: v0.31.0 writes its `/etc/fyers/server.conf` by itself. It keeps your address
from the Caddyfile and looks up its outgoing IP: 134.209.159.171.

---

## When something's wrong

| What you see | What to do |
| --- | --- |
| "First-boot set-up stopped with an error" | `sudo tail -60 /var/log/cloud-init-output.log` shows why (by hand: it was on screen). Fix it and run the script again: it's safe to repeat |
| Still "GitHub doesn't accept this key" after adding it | The repo name in `/etc/fyers/server.conf` must match GitHub's exactly (owner/name). The key must be under that repo's **Deploy keys**, not your account's SSH keys |
| "The install stopped with an error" | Its last lines are shown; the full log is `sudo cat /var/lib/fyers-setup/install.log`. It retries every 30 s |
| "Can't work out this server's web address" | The server couldn't find its public IP. Set it: `sudo nano /etc/fyers/server.conf`, `FYERS_HOST=<ip with dashes>.sslip.io` (e.g. `203-0-113-7.sslip.io`), then `sudo bash /home/helper/app/server/install.sh` |
| The address doesn't open | Ports 80 and 443 at the provider's firewall (step 2); `systemctl status caddy` |
| Is it running? | `sudo fyers-status`; `systemctl status fyers-helper`; log: `journalctl -u fyers-helper -n 100 --no-pager` |
| Updates | `journalctl -u fyers-update -n 50 --no-pager` |
| Locked out (password / 2FA lost) | `cd /home/helper/app && sudo -u helper /home/helper/venv/bin/python -m helper.users rescue <your username>` prints a temporary password |

More commands: `docs/Server_Setup_Guide.md` › Useful console commands (the same on every server).
