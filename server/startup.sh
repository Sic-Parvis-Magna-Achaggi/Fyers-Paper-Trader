#!/bin/bash
# Sets up a new server for the Fyers trade manager. Runs once as root. No secrets in here.
# Any Linux server with systemd: Ubuntu 22.04+ / Debian 12+ (recommended: Ubuntu 24.04), or Rocky / Alma / RHEL 9+,
# Fedora, Oracle Linux, Amazon Linux 2023. 1 GB of RAM is enough. Steps: docs/New_Server_Guide.md.
#
# Two ways to run it:
#  - When creating the server, paste this whole file into the provider's "user data" / "cloud-init" /
#    "initialization script" box (DigitalOcean: Advanced options > Add Initialization scripts), after changing REPO.
#  - On a server that's already running, over SSH:   sudo bash startup.sh yourname/Fyers-Paper-Trader
#    (optional 2nd word: the branch, e.g. stable; optional 3rd: your own domain instead of <ip>.sslip.io)
#
# It installs everything, makes a read-only GitHub deploy key, then waits until GitHub accepts that key and installs
# the app by itself. To see where it is:  sudo fyers-status --wait   (also shown when root logs in)

REPO="Sic-Parvis-Magna-Achaggi/Fyers-Paper-Trader"   # <- the repo this server runs (owner/name), e.g. yourname/Fyers-Paper-Trader
BRANCH=""                                            # <- empty = the repo's default branch; or a branch name, e.g. stable
HOST=""                                              # <- empty = <this server's IP>.sslip.io; or your own domain pointed at it

REPO="${1:-$REPO}"; BRANCH="${2:-$BRANCH}"; HOST="${3:-$HOST}"
[ "$(id -u)" = 0 ] || { echo "Run it as root:  sudo bash $0 $*"; exit 1; }
set -eu
[ -t 1 ] || set -x                                   # a full trace in the cloud-init log; a by-hand run stays readable
export DEBIAN_FRONTEND=noninteractive
ST=/var/lib/fyers-setup
mkdir -p "$ST"
echo booting > "$ST/state"
fail(){ echo "$1" > "$ST/why"; echo bootfailed > "$ST/state"; echo "STOPPED: $1" >&2; exit 1; }
trap 'echo bootfailed > "$ST/state"; echo "the set-up script stopped at line $LINENO (log: /var/log/cloud-init-output.log, or the screen if run by hand)" > "$ST/why"' ERR

[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "REPO must look like owner/name (got: $REPO)"
[[ -z "$BRANCH" || "$BRANCH" =~ ^[A-Za-z0-9_][A-Za-z0-9_./-]*$ ]] || fail "BRANCH isn't a branch name (got: $BRANCH)"
[[ -z "$HOST" || "$HOST" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || fail "HOST isn't a domain name (got: $HOST)"
command -v systemctl >/dev/null && [ -d /run/systemd/system ] || fail "this server doesn't run systemd (needed for the app's services)"

# --- Packages
if command -v apt-get >/dev/null; then
  PM=apt
  apt-get update
  apt-get -y upgrade
  apt-get -y install git openssh-client python3-venv python3-pip sudo curl ca-certificates gnupg tar iproute2 unattended-upgrades \
    debian-keyring debian-archive-keyring apt-transport-https
elif command -v dnf >/dev/null; then
  PM=dnf
  dnf -y upgrade --refresh || true
  dnf -y install git openssh-clients python3 python3-pip sudo curl ca-certificates tar iproute
  dnf -y install dnf-automatic && systemctl enable --now dnf-automatic-install.timer || true
else
  fail "no apt or dnf on this server: use Ubuntu, Debian or a RHEL-family Linux"
fi

# The app needs Python 3.10 or newer (RHEL 9 / Amazon Linux 2023 ship 3.9 as python3: add a newer one)
py_ok(){ "$1" -c 'import sys, venv, ensurepip; sys.exit(sys.version_info < (3, 10))' >/dev/null 2>&1; }
PY=""
for p in python3.13 python3.12 python3.11 python3.10 python3; do command -v "$p" >/dev/null && py_ok "$p" && { PY=$p; break; }; done
if [ -z "$PY" ] && [ "$PM" = dnf ]; then
  for v in 3.12 3.11; do dnf -y install "python$v" "python$v-pip" && py_ok "python$v" && { PY=python$v; break; }; done
fi
[ -n "$PY" ] || fail "no Python 3.10+ here (Ubuntu 22.04+ and Debian 12+ have it)"

# --- Caddy (automatic HTTPS): its own package repo, else the distribution's, else the official download
caddy_download(){
  local arch tag
  case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; armv7l) arch=armv7 ;; *) return 1 ;; esac
  tag=$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/caddyserver/caddy/releases/latest | sed -n 's#.*/tag/v\([0-9.]*\)$#\1#p')
  [ -n "$tag" ] || tag=$(curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest | sed -n 's/.*"tag_name": *"v\([0-9.]*\)".*/\1/p' | head -1)
  [ -n "$tag" ] || return 1
  curl -fsSL "https://github.com/caddyserver/caddy/releases/download/v$tag/caddy_${tag}_linux_$arch.tar.gz" | tar -xz -C /usr/bin caddy
  chmod 755 /usr/bin/caddy
  getent group caddy >/dev/null || groupadd --system caddy
  id caddy >/dev/null 2>&1 || useradd --system --gid caddy --create-home --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy
  mkdir -p /etc/caddy
  [ -f /etc/caddy/Caddyfile ] || printf ':80 {\n\trespond "Setting up..."\n}\n' > /etc/caddy/Caddyfile
  cat > /etc/systemd/system/caddy.service <<'EOC'
[Unit]
Description=Caddy
After=network.target network-online.target
Requires=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOC
  systemctl daemon-reload
}
if ! command -v caddy >/dev/null; then
  if [ "$PM" = apt ]; then
    { curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
      && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list \
      && apt-get update && apt-get -y install caddy; } || caddy_download || fail "couldn't install Caddy"
  else
    dnf -y install caddy \
      || { dnf -y install 'dnf-command(copr)' && dnf -y copr enable @caddy/caddy && dnf -y install caddy; } \
      || caddy_download || fail "couldn't install Caddy"
  fi
fi
systemctl enable --now caddy

# --- Firewall: SSH, HTTP, HTTPS. Cloud providers' own firewalls (AWS security groups, Oracle security lists, GCP...)
# must allow 80 and 443 too: that's done in their web console (docs/New_Server_Guide.md).
ssh_ports=$(ss -Htlnp 2>/dev/null | awk '/sshd/ {n = split($4, a, ":"); print a[n]}' | sort -u)
[ -n "$ssh_ports" ] || ssh_ports=22
if [ -f /etc/iptables/rules.v4 ] && command -v netfilter-persistent >/dev/null; then
  # Oracle Cloud's images: iptables rules that refuse everything but SSH. Open 80 and 443 there and keep it.
  for p in 80 443; do iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport $p -j ACCEPT; done
  netfilter-persistent save
elif systemctl is-active -q firewalld 2>/dev/null; then
  firewall-cmd -q --permanent --add-service=http --add-service=https
  firewall-cmd -q --reload
elif [ "$PM" = apt ]; then
  apt-get -y install ufw
  for p in $ssh_ports; do ufw allow "$p/tcp"; done              # never lock out the SSH you're on
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
fi

# --- Swap on small servers (1 GB of RAM), if there's none
if [ -z "$(swapon --show --noheadings 2>/dev/null)" ] && [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ] && [ ! -f /swapfile ]; then
  { fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024; } && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile \
    && echo '/swapfile none swap sw 0 0' >> /etc/fstab || rm -f /swapfile
fi

# Time zone: IST (trading day boundaries)
timedatectl set-timezone Asia/Kolkata

# --- Service user and a read-only GitHub deploy key (its public half is shown by fyers-status, to add on GitHub)
id helper >/dev/null 2>&1 || useradd -m -s /bin/bash helper
sudo -u helper mkdir -p /home/helper/.ssh
chmod 700 /home/helper/.ssh
[ -f /home/helper/.ssh/deploy_key ] || sudo -u helper ssh-keygen -q -t ed25519 -N "" -C "fyers-$(hostname)-deploy" -f /home/helper/.ssh/deploy_key
sudo -u helper bash -c 'ssh-keyscan github.com >> /home/helper/.ssh/known_hosts 2>/dev/null' || true

# --- This server's own settings (install.sh adds the address and the outgoing IP when they're empty)
mkdir -p /etc/fyers
[ -f /etc/fyers/server.conf ] || printf '%s\n' "# This server's own settings (not in Git). Written by server/install.sh; edit by hand, then run install.sh." \
  "FYERS_REPO=$REPO" "FYERS_BRANCH=$BRANCH" "FYERS_HOST=$HOST" "FYERS_PYTHON=$PY" > /etc/fyers/server.conf

# --- The first install: every 30 s until GitHub accepts the deploy key, then clone + install.sh, then off.
cat > /usr/local/sbin/fyers-firstinstall <<'EOS'
#!/bin/bash
set -uo pipefail
ST=/var/lib/fyers-setup
APP=/home/helper/app
KEY=/home/helper/.ssh/deploy_key
mkdir -p "$ST"
get(){ sed -n "s/^$1=//p" /etc/fyers/server.conf 2>/dev/null | head -1; }
repo=$(get FYERS_REPO); branch=$(get FYERS_BRANCH)
url="${FYERS_GIT_URL:-git@github.com:$repo.git}"        # FYERS_GIT_URL: only for the tests
ssh_cmd="ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15"
if [ ! -d "$APP/.git" ]; then
  grep -q '^github.com ' /home/helper/.ssh/known_hosts 2>/dev/null \
    || sudo -u helper bash -c 'ssh-keyscan github.com >> /home/helper/.ssh/known_hosts 2>/dev/null'
  date '+%d %b %H:%M:%S' > "$ST/checked"
  if ! out=$(sudo -u helper env GIT_SSH_COMMAND="$ssh_cmd" git ls-remote "$url" HEAD 2>&1); then
    echo waiting > "$ST/state"; printf '%s\n' "$out" | tail -2 > "$ST/why"; exit 0
  fi
  echo installing > "$ST/state"
  rm -rf "$APP.tmp"
  if ! sudo -u helper env GIT_SSH_COMMAND="$ssh_cmd" git clone -q ${branch:+-b "$branch"} "$url" "$APP.tmp" > "$ST/install.log" 2>&1; then
    echo failed > "$ST/state"; exit 0
  fi
  mv "$APP.tmp" "$APP"
fi
echo installing > "$ST/state"
if bash "$APP/server/install.sh" > "$ST/install.log" 2>&1; then
  echo "done" > "$ST/state"
  systemctl disable fyers-firstinstall.timer >/dev/null 2>&1
  systemctl stop fyers-firstinstall.timer
else
  echo failed > "$ST/state"          # tried again in 30 s (the log is in /var/lib/fyers-setup/install.log)
fi
exit 0
EOS
chmod 755 /usr/local/sbin/fyers-firstinstall

cat > /etc/systemd/system/fyers-firstinstall.service <<'EOS'
[Unit]
Description=Fyers trade manager: first install (waits for the GitHub deploy key)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/fyers-firstinstall
EOS
cat > /etc/systemd/system/fyers-firstinstall.timer <<'EOS'
[Unit]
Description=Fyers trade manager: try the first install every 30 seconds until it's done

[Timer]
OnBootSec=20s
OnUnitInactiveSec=30s
AccuracySec=2s

[Install]
WantedBy=timers.target
EOS

# --- fyers-status: where the set-up is (shown when root logs in; other admins get a one-line hint)
cat > /usr/local/bin/fyers-status <<'EOS'
#!/bin/bash
# Where this server's set-up is. fyers-status --wait: refresh every 10 s until it's ready.
ST=/var/lib/fyers-setup
APP=/home/helper/app
get(){ sed -n "s/^$1=//p" /etc/fyers/server.conf 2>/dev/null | head -1; }
show(){
  local state repo branch host ip
  state=$(cat "$ST/state" 2>/dev/null || true)
  [ -n "$state" ] || { [ -d "$APP/.git" ] && state="done" || state=booting; }
  repo=$(get FYERS_REPO); branch=$(get FYERS_BRANCH); host=$(get FYERS_HOST); ip=$(get FYERS_OUT_IP)
  echo
  echo "=============== Fyers trade manager: this server ==============="
  case "$state" in
    booting)
      echo "First-boot set-up is still running (installing packages: 3-5 minutes)."
      echo "Check again with:  sudo fyers-status --wait" ;;
    bootfailed)
      echo "First-boot set-up stopped with an error: $(cat "$ST/why" 2>/dev/null)"
      echo "Log:  tail -40 /var/log/cloud-init-output.log" ;;
    waiting)
      echo "STEP 1 of 2: let this server read the code on GitHub (read-only)."
      echo "  Repo: $repo${branch:+  (branch $branch)}"
      echo "  1. Open  https://github.com/$repo/settings/keys/new"
      echo "     (only the repo's owner / admins can: if it isn't your repo, send them the key below)"
      echo "  2. Title: $(hostname)   Key: the whole line below   Leave \"Allow write access\" UNticked   Add key"
      echo
      cat /home/helper/.ssh/deploy_key.pub
      echo
      echo "  Last check $(cat "$ST/checked" 2>/dev/null): GitHub doesn't accept this key yet. It checks every 30 s;"
      echo "  then the install starts by itself. Watch it:  sudo fyers-status --wait  (Ctrl+C to stop watching)"
      echo "  Wrong repo name? nano /etc/fyers/server.conf (FYERS_REPO=owner/name), save; it's used on the next check." ;;
    installing)
      echo "STEP 2 of 2: GitHub accepted the key. Installing the app (3-5 minutes)..." ;;
    failed)
      echo "The install stopped with an error (it tries again every 30 s). Last lines:"
      tail -12 "$ST/install.log" 2>/dev/null | sed 's/^/  | /'
      echo "Full log:  cat $ST/install.log" ;;
    "done")
      if [ -f /home/helper/data/SETUP_CODE.txt ]; then
        echo "READY. Open  https://$host"
        echo "  Setup code:  $(cat /home/helper/data/SETUP_CODE.txt)"
        echo "  Enter it, choose your username and password, then set up 2FA with an authenticator app."
      else
        echo "Running: https://$host   version $(cat "$APP/VERSION" 2>/dev/null)   helper $(systemctl is-active fyers-helper)"
      fi
      echo "  Updates: from $repo${branch:+ (branch $branch)}, checked every minute."
      echo "  For live trading, whitelist this IP in your Fyers API app:  ${ip:-unknown (see docs/New_Server_Guide.md)}" ;;
  esac
  echo "================================================================"
}
if [ "${1:-}" = "--wait" ]; then
  n=0; last=""
  while true; do
    s=$(cat "$ST/state" 2>/dev/null)
    if [ "$s" != "$last" ] || [ "$s" = "done" ]; then    # redraw only when the step changes (the key stays put to copy)
      [ -n "$last" ] && [ -t 1 ] && clear
      show; last=$s
    fi
    [ "$s" = bootfailed ] && break
    if [ "$s" = "done" ]; then          # ready once the setup code is there (or users exist); at most 30 s more
      [ -f /home/helper/data/SETUP_CODE.txt ] || [ -f /home/helper/data/users.json ] || [ $n -ge 6 ] && break
      n=$((n + 1)); sleep 5; continue
    fi
    sleep 10
  done
else
  show
fi
EOS
chmod 755 /usr/local/bin/fyers-status
cat > /etc/profile.d/zz-fyers-status.sh <<'EOS'
if [ -t 1 ] && [ -x /usr/local/bin/fyers-status ]; then
  if [ "$(id -u)" = 0 ]; then /usr/local/bin/fyers-status
  elif id -nG 2>/dev/null | grep -qwE 'sudo|wheel|admin'; then echo "Fyers trade manager: see where this server is with   sudo fyers-status"; fi
fi
EOS

systemctl daemon-reload
systemctl enable --now fyers-firstinstall.timer
echo "startup done $(date)" > /root/startup-done.txt
trap - ERR
if [ -t 1 ]; then                    # run by hand: stay on screen until it's ready
  set +x
  sleep 3
  exec /usr/local/bin/fyers-status --wait
fi
