#!/bin/bash
# Runs every minute (fyers-update.timer). If GitHub has a newer version, take it and restart the helper.
# Follows FYERS_BRANCH from /etc/fyers/server.conf when set (e.g. stable), else the repo's default branch.
set -uo pipefail
APP=/home/helper/app

main(){
  cd "$APP" || exit 0
  local branch old new
  . "$APP/server/serverconf.sh" && conf_read          # FYERS_BRANCH in /etc/fyers/server.conf, if this server has one
  if [ -n "${C_BRANCH:-}" ]; then branch="origin/$C_BRANCH"
  else branch=$(sudo -u helper git rev-parse --abbrev-ref origin/HEAD 2>/dev/null || echo origin/main); fi
  sudo -u helper git fetch -q origin 2>/dev/null || exit 0
  old=$(sudo -u helper git rev-parse HEAD)
  new=$(sudo -u helper git rev-parse -q --verify "$branch^{commit}") || { echo "No branch $branch on GitHub - nothing taken"; exit 0; }
  [ "$old" = "$new" ] && exit 0
  echo "Updating $old -> $new"
  sudo -u helper git reset -q --hard "$new"
  bash "$APP/server/install.sh" --quiet
  echo "Updated to $(sudo -u helper git log -1 --format='%h %s')"
}
main "$@"
exit 0
