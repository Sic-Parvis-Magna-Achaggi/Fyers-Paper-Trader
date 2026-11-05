# shellcheck shell=bash
# This server's own settings, kept in /etc/fyers/server.conf (not in Git, so every server keeps its own).
# Sourced by install.sh and update.sh. The file is read, never run: only these keys, only safe values.
# Safe under set -euo pipefail (install.sh): nothing here may fail on a missing value.
#
#   FYERS_HOST     the web address Caddy serves (e.g. 68-183-245-178.sslip.io, or your own domain)
#   FYERS_OUT_IP   the IP Fyers sees this server's orders come from (whitelist it in your Fyers API app)
#   FYERS_BRANCH   the GitHub branch this server follows (empty = the repo's default branch)
#   FYERS_REPO     owner/name of the repo (for the record; the clone's own remote is what's used)
#   FYERS_PYTHON   the Python used to make the app's venv (empty = the newest python3.10+ found)
#
# Missing values are worked out (conf_resolve), on any Linux server:
#   address:      kept from the Caddyfile already in use; else a DigitalOcean reserved IP, if one is attached; else this
#                 server's public IP (as the internet sees it) - as <ip>.sslip.io
#   outgoing IP:  this server's public IP as the internet sees it (what Fyers sees)
# A value in the environment (FYERS_HOST=... bash install.sh) wins over the file.

FYERS_CONF="${FYERS_CONF:-/etc/fyers/server.conf}"
FYERS_META="${FYERS_META:-http://169.254.169.254/metadata/v1}"
FYERS_CADDYFILE="${FYERS_CADDYFILE:-/etc/caddy/Caddyfile}"
FYERS_IPLOOKUP="${FYERS_IPLOOKUP:-https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com}"

_meta(){ curl -fsS -m 3 "$FYERS_META/$1" 2>/dev/null; }
_ok_host(){ [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && "$1" == *.* ]]; }
_ok_ip(){ [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; }
_ok_repo(){ [[ "$1" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; }
_ok_python(){ [[ "$1" =~ ^[A-Za-z0-9_./-]+$ ]]; }
_public(){                       # a public (not private / loopback / shared) IPv4
  _ok_ip "$1" || return 1
  case "$1" in 10.*|127.*|0.*|169.254.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 1 ;;
               100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) return 1 ;; esac
  return 0
}
_public_ip(){                    # what the internet sees; else the source address of the route out, if it's public
  local u ip
  for u in $FYERS_IPLOOKUP; do
    ip=$(curl -4 -fsS -m 5 "$u" 2>/dev/null | tr -d ' \r\n') || true
    _public "$ip" && { echo "$ip"; return 0; }
  done
  ip=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p') || true
  _public "$ip" && echo "$ip"
  return 0
}
_ok_branch(){ [[ "$1" =~ ^[A-Za-z0-9_][A-Za-z0-9_./-]*$ && "$1" != *..* ]]; }

conf_read(){
  C_HOST=""; C_OUT_IP=""; C_BRANCH=""; C_REPO=""; C_PYTHON=""
  [ -f "$FYERS_CONF" ] || return 0
  local k v
  while IFS='=' read -r k v || [ -n "$k" ]; do
    v="${v%$'\r'}"; v="${v%\"}"; v="${v#\"}"
    case "$k" in
      FYERS_HOST)   _ok_host "$v" && C_HOST=$v ;;
      FYERS_OUT_IP) _ok_ip "$v" && C_OUT_IP=$v ;;
      FYERS_BRANCH) _ok_branch "$v" && C_BRANCH=$v ;;
      FYERS_REPO)   _ok_repo "$v" && C_REPO=$v ;;
      FYERS_PYTHON) _ok_python "$v" && C_PYTHON=$v ;;
    esac
  done < "$FYERS_CONF"
  return 0
}

conf_resolve(){
  conf_read
  [ -n "${FYERS_HOST:-}" ] && C_HOST=$FYERS_HOST
  [ -n "${FYERS_OUT_IP:-}" ] && C_OUT_IP=$FYERS_OUT_IP
  [ -n "${FYERS_BRANCH:-}" ] && C_BRANCH=$FYERS_BRANCH
  [ -n "${FYERS_REPO:-}" ] && C_REPO=$FYERS_REPO
  [ -n "${FYERS_PYTHON:-}" ] && C_PYTHON=$FYERS_PYTHON
  local ip h k
  if [ -z "$C_HOST" ] && [ -f "$FYERS_CADDYFILE" ]; then        # keep the address this server already serves
    h=$(grep -m1 -oE '^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9][[:space:]]*\{' "$FYERS_CADDYFILE" | tr -d ' \t{') || true
    _ok_host "$h" && C_HOST=$h
  fi
  if [ -z "$C_HOST" ]; then
    ip=""
    for k in reserved_ip floating_ip; do          # DigitalOcean only (elsewhere these come back empty)
      if [ "$(_meta "$k/ipv4/active")" = true ]; then ip=$(_meta "$k/ipv4/ip_address") || true; _public "$ip" && break; fi
      ip=""
    done
    [ -n "$ip" ] || ip=$(_public_ip) || true
    _public "$ip" && C_HOST="${ip//./-}.sslip.io"
  fi
  if [ -z "$C_OUT_IP" ]; then
    ip=$(_public_ip) || true
    _public "$ip" && C_OUT_IP=$ip
  fi
  _ok_host "$C_HOST" || { echo "Can't work out this server's web address. Run: FYERS_HOST=<address> bash $0" >&2; return 1; }
  [ -z "$C_BRANCH" ] || _ok_branch "$C_BRANCH" || { echo "FYERS_BRANCH isn't a branch name: $C_BRANCH" >&2; return 1; }
  [ -z "$C_REPO" ] || _ok_repo "$C_REPO" || C_REPO=""
  return 0
}

conf_write(){
  local new
  new="# This server's own settings (not in Git). Written by server/install.sh; edit by hand, then run install.sh.
FYERS_HOST=$C_HOST
FYERS_OUT_IP=$C_OUT_IP
FYERS_BRANCH=$C_BRANCH
FYERS_REPO=$C_REPO
FYERS_PYTHON=$C_PYTHON"
  [ -f "$FYERS_CONF" ] && [ "$(cat "$FYERS_CONF")" = "$new" ] && return 1     # 1 = unchanged
  mkdir -p "$(dirname "$FYERS_CONF")"
  printf '%s\n' "$new" > "$FYERS_CONF.new" && chmod 644 "$FYERS_CONF.new" && mv "$FYERS_CONF.new" "$FYERS_CONF"
  return 0
}
