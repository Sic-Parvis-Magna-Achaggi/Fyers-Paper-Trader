#!/bin/bash
# Installs or refreshes the helper on the server. Safe to run again at any time (update.sh calls it).
# First time (as root, from the DigitalOcean console), after cloning the repo to /home/helper/app:
#   bash /home/helper/app/server/install.sh
set -euo pipefail
APP=/home/helper/app
VENV=/home/helper/venv
DATA=/home/helper/data
HOST="${FYERS_HOST:-68-183-245-178.sslip.io}"
QUIET="${1:-}"

say(){ [ "$QUIET" = "--quiet" ] || echo ">> $*"; }

main(){
  [ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }

  say "Folders"
  install -d -o helper -g helper -m 700 "$DATA"
  sudo -u helper git -C "$APP" config core.sshCommand "ssh -i /home/helper/.ssh/deploy_key -o IdentitiesOnly=yes"

  say "Python packages"
  [ -x "$VENV/bin/python" ] || sudo -u helper python3 -m venv "$VENV"
  sudo -u helper "$VENV/bin/pip" install -q --upgrade pip
  sudo -u helper "$VENV/bin/pip" install -q -r "$APP/requirements.txt"

  say "Services"
  local changed=0
  for f in fyers-helper.service fyers-update.service fyers-update.timer; do
    if ! cmp -s "$APP/server/systemd/$f" "/etc/systemd/system/$f"; then
      cp "$APP/server/systemd/$f" "/etc/systemd/system/$f"; changed=1
    fi
  done
  [ $changed = 1 ] && systemctl daemon-reload
  systemctl enable -q fyers-helper.service fyers-update.timer
  systemctl start fyers-update.timer

  say "Web server (Caddy)"
  sed "s/__HOST__/$HOST/" "$APP/server/Caddyfile" > /tmp/Caddyfile.new
  if ! cmp -s /tmp/Caddyfile.new /etc/caddy/Caddyfile; then
    cp /tmp/Caddyfile.new /etc/caddy/Caddyfile
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
    systemctl reload caddy
  fi
  rm -f /tmp/Caddyfile.new
  rm -rf /srv/pub

  say "Starting the helper"
  systemctl restart fyers-helper.service

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
