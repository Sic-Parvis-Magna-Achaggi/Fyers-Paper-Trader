#!/bin/bash
# Tests server/serverconf.sh (each server's own address, outgoing IP, branch) with a fake DigitalOcean metadata service
# and a fake "what's my IP" service. Safe anywhere: only temp files, nothing on the system is touched.
#   bash tests/server_conf_test.sh
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d)
PORT=$((20000 + RANDOM % 20000))
trap 'kill $SRV 2>/dev/null; rm -rf "$T"' EXIT
mkdir -p "$T/www/do/reserved_ip/ipv4" "$T/www/do/interfaces/public/0/ipv4" "$T/www/none"
echo -n "134.209.159.171" > "$T/www/do/interfaces/public/0/ipv4/address"
echo -n "true" > "$T/www/do/reserved_ip/ipv4/active"
echo -n "68.183.245.178" > "$T/www/do/reserved_ip/ipv4/ip_address"
printf '203.0.113.7\n' > "$T/www/myip"
printf '10.0.0.5\n' > "$T/www/privateip"
printf '<html>nope</html>' > "$T/www/garbage"
(cd "$T/www" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) & SRV=$!
for _ in $(seq 1 50); do curl -fs "http://127.0.0.1:$PORT/myip" >/dev/null && break; sleep 0.1; done

pass=0; failn=0
ok(){ if [ "$2" = "$3" ]; then pass=$((pass + 1)); else failn=$((failn + 1)); echo "FAIL: $1: got '$2', want '$3'"; fi; }
run(){                      # run conf_resolve + conf_write in a clean shell; prints HOST|OUT_IP|BRANCH|REPO|status
  env -i PATH="$PATH" HOME="$T" FYERS_CONF="$T/server.conf" FYERS_CADDYFILE="$T/Caddyfile" \
    FYERS_META="http://127.0.0.1:$PORT/${META:-none}" FYERS_IPLOOKUP="${LOOKUP:-http://127.0.0.1:$PORT/myip}" "$@" \
    bash -c 'set -euo pipefail; . "$0/server/serverconf.sh"; if conf_resolve 2>/dev/null; then w=0; conf_write || w=$?; echo "$C_HOST|$C_OUT_IP|$C_BRANCH|$C_REPO|ok$w"; else echo "|||-|fail"; fi' "$HERE"
}
reset(){ rm -f "$T/server.conf" "$T/Caddyfile"; }

# 1. The owner's server today: Caddyfile serves its address, no conf yet. The address is kept, whatever the metadata says.
reset; printf '68-183-245-178.sslip.io {\n\tencode gzip\n}\n' > "$T/Caddyfile"
ok "owner: address kept, outgoing IP looked up" "$(META="do" LOOKUP="http://127.0.0.1:$PORT/myip" run)" "68-183-245-178.sslip.io|203.0.113.7|||ok0"
ok "owner: second run changes nothing" "$(META="do" run)" "68-183-245-178.sslip.io|203.0.113.7|||ok1"
ok "conf written" "$(grep -c '^FYERS_' "$T/server.conf")" "5"

# 2. New DigitalOcean droplet with a reserved IP: the package's default Caddyfile (":80") isn't an address.
reset; printf '# The Caddyfile\n:80 {\n\troot * /usr/share/caddy\n\tfile_server\n}\n' > "$T/Caddyfile"
ok "DO + reserved IP" "$(META="do" run)" "68-183-245-178.sslip.io|203.0.113.7|||ok0"

# 3. Any other provider (no metadata service): the public IP as the internet sees it.
reset
ok "other provider" "$(run)" "203-0-113-7.sslip.io|203.0.113.7|||ok0"

# 4. A lookup that answers garbage or a private IP is skipped; the next one is used.
reset
ok "bad lookups skipped" "$(LOOKUP="http://127.0.0.1:$PORT/garbage http://127.0.0.1:$PORT/privateip http://127.0.0.1:$PORT/myip" run)" "203-0-113-7.sslip.io|203.0.113.7|||ok0"

# 4b. The same with the Caddy package's default Caddyfile in place (a fresh server: no address in it)
reset; printf '# The Caddyfile\n:80 {\n\tfile_server\n}\n' > "$T/Caddyfile"
ok "default Caddyfile, strict shell" "$(run)" "203-0-113-7.sslip.io|203.0.113.7|||ok0"

# 5. No way to find the address (lookups down, the route out is private here): it stops and says what to do.
reset
r=$(LOOKUP="http://127.0.0.1:$PORT/nothing" run)
case "$r" in *"|fail"|*.sslip.io*) pass=$((pass + 1)) ;; *) failn=$((failn + 1)); echo "FAIL: no address: $r" ;; esac

# 6. The environment wins (own domain); then the file keeps it.
reset
ok "own domain" "$(run FYERS_HOST=trade.example.in FYERS_BRANCH=stable)" "trade.example.in|203.0.113.7|stable||ok0"
ok "kept in the file" "$(LOOKUP="http://127.0.0.1:$PORT/nothing" run)" "trade.example.in|203.0.113.7|stable||ok1"

# 7. What the first-boot script writes (repo, branch, empty host) is filled in, repo and branch kept.
reset; printf '%s\n' "# x" "FYERS_REPO=friend/Fyers-Paper-Trader" "FYERS_BRANCH=" "FYERS_HOST=" "FYERS_PYTHON=python3.12" > "$T/server.conf"
ok "first boot conf" "$(run)" "203-0-113-7.sslip.io|203.0.113.7||friend/Fyers-Paper-Trader|ok0"
ok "python kept" "$(grep '^FYERS_PYTHON=' "$T/server.conf")" "FYERS_PYTHON=python3.12"

# 8. The file is read, never run: a line with a command in it is ignored (and nothing runs).
reset; printf '%s\n' 'FYERS_HOST=$(touch '"$T"'/pwned)' 'FYERS_BRANCH=main;touch '"$T"'/pwned2' 'touch '"$T"'/pwned3' 'FYERS_OUT_IP=1.2.3.4' > "$T/server.conf"
ok "unsafe values ignored" "$(run)" "203-0-113-7.sslip.io|1.2.3.4|||ok0"
ok "nothing ran" "$(find "$T" -maxdepth 1 -name "pwned*" | wc -l)" "0"

# 9. A bad branch from the environment is refused.
reset
ok "bad branch" "$(run FYERS_BRANCH='../x')" "|||-|fail"

# 10. Windows line endings and quotes in a hand-edited file.
reset; printf 'FYERS_HOST="trade.example.in"\r\nFYERS_OUT_IP=1.2.3.4\r\n' > "$T/server.conf"
ok "CRLF + quotes" "$(run)" "trade.example.in|1.2.3.4|||ok0"

echo "server_conf_test: $pass passed, $failn failed"
[ $failn = 0 ]
