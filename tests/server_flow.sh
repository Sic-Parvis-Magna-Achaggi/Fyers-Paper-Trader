#!/bin/bash
# The first install and updates of a NEW server, end to end, without GitHub or systemd: the scripts startup.sh writes
# (fyers-firstinstall, fyers-status) and update.sh, against a local git repo standing in for GitHub.
# It creates the helper user and writes to /etc/fyers, /usr/local, /var/lib/fyers-setup and /home/helper, so it runs
# ONLY in a throwaway container (Ubuntu / Debian, as root):
#   FYERS_TEST_CONTAINER=1 bash tests/server_flow.sh
set -u
[ "${FYERS_TEST_CONTAINER:-}" = 1 ] && [ "$(id -u)" = 0 ] || { echo "Only in a throwaway container, as root: FYERS_TEST_CONTAINER=1 bash $0"; exit 2; }
[ -e /home/helper/app ] && { echo "/home/helper/app exists: not a fresh container"; exit 2; }
HERE=$(cd "$(dirname "$0")/.." && pwd)
W=$(mktemp -d); chmod 755 "$W"
export GIT_CONFIG_GLOBAL="$W/gitconfig"; git config --global safe.directory '*'   # this test's own git, as root
pass=0; failn=0
ok(){ if [ "$2" = "$3" ]; then pass=$((pass + 1)); else failn=$((failn + 1)); echo "FAIL: $1: got '$2', want '$3'"; fi; }
has(){ if grep -qF -- "$3" <<< "$2"; then pass=$((pass + 1)); else failn=$((failn + 1)); echo "FAIL: $1: no '$3' in:"; sed 's/^/   /' <<< "$2"; fi; }

# The scripts startup.sh writes, taken from it as they are
awk -v a="$W/fyers-firstinstall" -v b="$W/fyers-status" '
  /^cat > \/usr\/local\/sbin\/fyers-firstinstall/ {f=a; next} /^cat > \/usr\/local\/bin\/fyers-status/ {f=b; next}
  /^EOS$/ {f=""; next} f {print > f}' "$HERE/server/startup.sh"
install -m 755 "$W/fyers-firstinstall" /usr/local/sbin/fyers-firstinstall
install -m 755 "$W/fyers-status" /usr/local/bin/fyers-status
systemctl(){ :; }; export -f systemctl                       # no systemd here

# The server as startup.sh leaves it
id helper >/dev/null 2>&1 || useradd -m -s /bin/bash helper
sudo -u helper mkdir -p /home/helper/.ssh
[ -f /home/helper/.ssh/deploy_key ] || sudo -u helper ssh-keygen -q -t ed25519 -N "" -C "fyers-test-deploy" -f /home/helper/.ssh/deploy_key
mkdir -p /etc/fyers /var/lib/fyers-setup
printf '%s\n' "# test" "FYERS_REPO=friend/Fyers-Paper-Trader" "FYERS_BRANCH=" "FYERS_HOST=" > /etc/fyers/server.conf
echo booting > /var/lib/fyers-setup/state

# "GitHub": a repo whose install.sh only does what the real one leaves behind (the setup code, the address)
G="$W/github.git"; S="$W/src"
git init -q --bare -b main "$G"
git init -q -b main "$S"
mkdir -p "$S/server"
cp "$HERE/server/serverconf.sh" "$HERE/server/update.sh" "$S/server/"
cat > "$S/server/install.sh" <<'EOF'
#!/bin/bash
echo "stub install $*" >> /var/lib/fyers-setup/stub.log
install -d -o helper -g helper -m 700 /home/helper/data
[ -f /home/helper/data/users.json ] || echo "ABCD-1234" > /home/helper/data/SETUP_CODE.txt
sed -i 's/^FYERS_HOST=$/FYERS_HOST=203-0-113-7.sslip.io/; s/^FYERS_OUT_IP=.*$//' /etc/fyers/server.conf
echo "FYERS_OUT_IP=203.0.113.7" >> /etc/fyers/server.conf
EOF
echo "0.31.0" > "$S/VERSION"
git -C "$S" add -A && git -C "$S" -c user.name=t -c user.email=t@t commit -qm v1
git -C "$S" branch stable
git -C "$S" push -q "$G" main stable
chown -R helper:helper "$G"

out=$(fyers-status); has "booting" "$out" "still running"

# 1. GitHub doesn't accept the key yet: waits, shows the key and where to add it
FYERS_GIT_URL="$W/nothing.git" fyers-firstinstall
ok "waiting state" "$(cat /var/lib/fyers-setup/state)" "waiting"
out=$(fyers-status)
has "step 1" "$out" "STEP 1 of 2"
has "deploy key link" "$out" "https://github.com/friend/Fyers-Paper-Trader/settings/keys/new"
has "the key itself" "$out" "$(cut -d' ' -f1-2 /home/helper/.ssh/deploy_key.pub)"
has "untick write" "$out" "UNticked"
ok "nothing cloned" "$([ -e /home/helper/app ] && echo yes || echo no)" "no"

# 2. The key is added: clones, installs, shows the address and the setup code
FYERS_GIT_URL="$G" fyers-firstinstall
ok "done state" "$(cat /var/lib/fyers-setup/state)" "done"
ok "cloned as helper" "$(stat -c %U /home/helper/app)" "helper"
ok "install ran once" "$(grep -c 'stub install' /var/lib/fyers-setup/stub.log)" "1"
out=$(fyers-status)
has "ready" "$out" "READY. Open  https://203-0-113-7.sslip.io"
has "setup code" "$out" "Setup code:  ABCD-1234"
has "whitelist IP" "$out" "203.0.113.7"
out=$(timeout 20 fyers-status --wait); has "--wait ends when ready" "$out" "ABCD-1234"

# 3. After the admin is made: running, version
rm /home/helper/data/SETUP_CODE.txt; echo '{}' > /home/helper/data/users.json
out=$(fyers-status); has "running" "$out" "version 0.31.0"

# 4. Updates on the default branch (update.sh as it is)
v1=$(git -C /home/helper/app rev-parse HEAD)
echo "0.31.1" > "$S/VERSION"; git -C "$S" -c user.name=t -c user.email=t@t commit -qam v2; git -C "$S" push -q "$G" main
chown -R helper:helper "$G"
bash /home/helper/app/server/update.sh >/dev/null
ok "update took main" "$(cat /home/helper/app/VERSION)" "0.31.1"
has "install --quiet" "$(tail -1 /var/lib/fyers-setup/stub.log)" "--quiet"

# 5. Follow a branch: stable stays at v1 until it's moved
echo "FYERS_BRANCH=stable" >> /etc/fyers/server.conf
bash /home/helper/app/server/update.sh >/dev/null
ok "stable followed" "$(git -C /home/helper/app rev-parse HEAD)" "$v1"
git -C "$S" push -q "$G" main:stable; chown -R helper:helper "$G"
bash /home/helper/app/server/update.sh >/dev/null
ok "stable moved" "$(cat /home/helper/app/VERSION)" "0.31.1"

# 6. A branch that isn't on GitHub: nothing taken, nothing broken
sed -i 's/^FYERS_BRANCH=stable$/FYERS_BRANCH=nosuch/' /etc/fyers/server.conf
n=$(grep -c 'stub install' /var/lib/fyers-setup/stub.log)
out=$(bash /home/helper/app/server/update.sh)
has "missing branch said" "$out" "No branch origin/nosuch"
ok "install not run" "$(grep -c 'stub install' /var/lib/fyers-setup/stub.log)" "$n"
ok "code unchanged" "$(cat /home/helper/app/VERSION)" "0.31.1"

# 7. A new server told to follow stable from the start clones that branch
rm -rf /home/helper/app /home/helper/data; echo booting > /var/lib/fyers-setup/state
printf '%s\n' "FYERS_REPO=friend/Fyers-Paper-Trader" "FYERS_BRANCH=stable" "FYERS_HOST=" > /etc/fyers/server.conf
FYERS_GIT_URL="$G" fyers-firstinstall
ok "cloned stable" "$(git -C /home/helper/app rev-parse --abbrev-ref HEAD)" "stable"

# 8. A failed install shows its log and is tried again
rm -rf /home/helper/app; echo booting > /var/lib/fyers-setup/state
printf '#!/bin/bash\necho "pip: no network" >&2; exit 1\n' > "$S/server/install.sh"
git -C "$S" -c user.name=t -c user.email=t@t commit -qam broken; git -C "$S" push -q "$G" main; chown -R helper:helper "$G"
printf '%s\n' "FYERS_REPO=friend/Fyers-Paper-Trader" "FYERS_BRANCH=" "FYERS_HOST=" > /etc/fyers/server.conf
FYERS_GIT_URL="$G" fyers-firstinstall
ok "failed state" "$(cat /var/lib/fyers-setup/state)" "failed"
has "log shown" "$(fyers-status)" "pip: no network"

rm -rf "$W"
echo "server_flow: $pass passed, $failn failed"
[ $failn = 0 ]
