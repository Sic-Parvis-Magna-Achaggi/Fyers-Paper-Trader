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
