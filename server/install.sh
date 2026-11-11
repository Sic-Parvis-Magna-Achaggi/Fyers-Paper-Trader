#!/bin/bash
# Installs or refreshes the helper on the server. Safe to run again at any time (update.sh calls it).
# A new server runs it by itself after first boot (server/startup.sh). By hand (as root, from the DigitalOcean console),
# after cloning the repo to /home/helper/app:
#   bash /home/helper/app/server/install.sh
# This server's own address, outgoing IP and branch live in /etc/fyers/server.conf (see server/serverconf.sh).
set -euo pipefail
APP=/home/helper/app
VENV=/home/helper/venv
DATA=/home/helper/data
QUIET="${1:-}"
. "$(dirname "${BASH_SOURCE[0]}")/serverconf.sh"

say(){ [ "$QUIET" = "--quiet" ] || echo ">> $*"; }

# Node.js for the alerts' Pine runner (v0.38.0, helper/pine_node.mjs): a pinned official build in /opt/ftm-node, checked
# against nodejs.org's SHA-256 list. If it can't be installed, everything else still runs (technical alerts wait, and the
# Alerts page says why); the next update tries again. NODE_DIST overrides the download address (tests: a file:// copy).
NODE_VER="${NODE_VER:-v22.12.0}"
NODE_DIR="${NODE_DIR:-/opt/ftm-node}"
node_install(){
  local arch dist name tmp want got
  [ -x "$NODE_DIR/bin/node" ] && [ "$("$NODE_DIR/bin/node" --version 2>/dev/null)" = "$NODE_VER" ] && return 0
  case "$(uname -m)" in x86_64|amd64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo "no Node build for $(uname -m)"; return 1;; esac
  dist="${NODE_DIST:-https://nodejs.org/dist}/$NODE_VER"
  name="node-$NODE_VER-linux-$arch.tar.xz"
  tmp=$(mktemp -d)
  curl -fsSL --max-time 300 -o "$tmp/$name" "$dist/$name" && curl -fsSL --max-time 60 -o "$tmp/SHASUMS256.txt" "$dist/SHASUMS256.txt" \
    || { rm -rf "$tmp"; echo "Node download failed"; return 1; }
  want=$(awk -v n="$name" '$2 == n {print $1}' "$tmp/SHASUMS256.txt")
  got=$(sha256sum "$tmp/$name" | awk '{print $1}')
  [ -n "$want" ] && [ "$want" = "$got" ] || { rm -rf "$tmp"; echo "Node download didn't match its checksum"; return 1; }
  mkdir -p "$tmp/x" && tar -xJf "$tmp/$name" -C "$tmp/x" --strip-components=1 || { rm -rf "$tmp"; echo "Node archive unreadable"; return 1; }
  [ -x "$tmp/x/bin/node" ] || { rm -rf "$tmp"; echo "Node archive has no bin/node"; return 1; }
  rm -rf "$NODE_DIR.new" && mv "$tmp/x" "$NODE_DIR.new" && chmod -R a+rX "$NODE_DIR.new"
  rm -rf "$NODE_DIR.old"; [ -d "$NODE_DIR" ] && mv "$NODE_DIR" "$NODE_DIR.old"
  mv "$NODE_DIR.new" "$NODE_DIR" && rm -rf "$NODE_DIR.old" "$tmp"
  if command -v selinuxenabled >/dev/null && selinuxenabled; then chcon -R -t bin_t "$NODE_DIR/bin" 2>/dev/null || true; fi
}

main(){
  [ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }

  say "This server's settings"
  conf_resolve
  if [ -z "$C_REPO" ]; then        # owner/name from the clone's remote, for the record
    local url; url=$(sudo -u helper git -C "$APP" remote get-url origin 2>/dev/null || true)
    url=${url%.git}; url=${url#*github.com[:/]}
    _ok_repo "$url" && C_REPO=$url
  fi
  conf_write && say "Saved $FYERS_CONF" || true
  HOST=$C_HOST
  say "Address https://$HOST · outgoing IP ${C_OUT_IP:-unknown} · branch ${C_BRANCH:-default}"

  say "Folders"
  install -d -o helper -g helper -m 700 "$DATA"
  sudo -u helper git -C "$APP" config core.sshCommand "ssh -i /home/helper/.ssh/deploy_key -o IdentitiesOnly=yes"

  say "Python packages"
  if [ ! -x "$VENV/bin/python" ]; then
    local py="$C_PYTHON" p
    if [ -z "$py" ]; then
      for p in python3.13 python3.12 python3.11 python3.10 python3; do
        command -v "$p" >/dev/null && "$p" -c 'import sys, venv, ensurepip; sys.exit(sys.version_info < (3, 10))' 2>/dev/null && { py=$p; break; }
      done
    fi
    [ -n "$py" ] || { echo "The app needs Python 3.10 or newer (with venv): none found. Set FYERS_PYTHON in $FYERS_CONF"; exit 1; }
    sudo -u helper "$py" -m venv "$VENV"
  fi
  sudo -u helper "$VENV/bin/pip" install -q --upgrade pip
  sudo -u helper "$VENV/bin/pip" install -q -r "$APP/requirements.txt"
  # SELinux (RHEL family): systemd may only start programs labelled as programs, not files in a home folder
  if command -v selinuxenabled >/dev/null && selinuxenabled; then chcon -R -t bin_t "$VENV/bin" 2>/dev/null || true; fi

  say "Node.js $NODE_VER (the alerts' Pine runner)"
  node_install || echo "!! Node.js not installed: price alerts work, technical alerts wait until it is (the next update tries again)"

  say "Services"
  local changed=0
  for f in fyers-helper.service fyers-watchdog.service fyers-update.service fyers-update.timer; do
    if ! cmp -s "$APP/server/systemd/$f" "/etc/systemd/system/$f"; then
      cp "$APP/server/systemd/$f" "/etc/systemd/system/$f"; changed=1
    fi
  done
  [ $changed = 1 ] && systemctl daemon-reload
  systemctl enable -q fyers-helper.service fyers-watchdog.service fyers-update.timer
  systemctl start fyers-update.timer

  say "Web server (Caddy)"
  sed "s/__HOST__/$HOST/" "$APP/server/Caddyfile" > /tmp/Caddyfile.new
  if ! cmp -s /tmp/Caddyfile.new /etc/caddy/Caddyfile; then
    cp /tmp/Caddyfile.new /etc/caddy/Caddyfile
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
    systemctl reload caddy 2>/dev/null || systemctl restart caddy
  fi
  systemctl is-active -q caddy || systemctl restart caddy
  rm -f /tmp/Caddyfile.new
  rm -rf /srv/pub

  say "Starting the helper and its watchdog"
  systemctl restart fyers-helper.service
  systemctl restart fyers-watchdog.service    # the watchdog (Telegram alerts if the helper stops answering)

  if [ "$QUIET" != "--quiet" ]; then
    for i in $(seq 1 30); do
      [ -f "$DATA/SETUP_CODE.txt" ] || [ -f "$DATA/auth.json" ] && break
      sleep 1
    done
    sleep 1
    echo
    if [ -f "$DATA/SETUP_CODE.txt" ]; then
      echo "=========================================="
      echo "  Open  https://$HOST"
      echo "  Setup code:  $(cat "$DATA/SETUP_CODE.txt")"
      echo "=========================================="
    elif systemctl is-active -q fyers-helper; then
      echo "Done. Open https://$HOST"
    else
      echo "The helper didn't start. Last log lines:"; journalctl -u fyers-helper -n 30 --no-pager
    fi
  fi
}
main "$@"
exit 0
