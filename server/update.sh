#!/bin/bash
# Runs every minute (fyers-update.timer). If GitHub has a newer version, take it and restart the helper.
set -uo pipefail
APP=/home/helper/app

main(){
  cd "$APP" || exit 0
  local branch old new
  branch=$(sudo -u helper git rev-parse --abbrev-ref origin/HEAD 2>/dev/null || echo origin/main)
  sudo -u helper git fetch -q origin 2>/dev/null || exit 0
  old=$(sudo -u helper git rev-parse HEAD)
  new=$(sudo -u helper git rev-parse "$branch")
  [ "$old" = "$new" ] && exit 0
  echo "Updating $old -> $new"
  sudo -u helper git reset -q --hard "$new"
  bash "$APP/server/install.sh" --quiet
  echo "Updated to $(sudo -u helper git log -1 --format='%h %s')"
}
main "$@"
exit 0
