#!/bin/bash
# First-boot setup for the Fyers trade manager helper (DigitalOcean, Ubuntu 24.04).
# Runs once as root. No secrets in here.
set -eux
export DEBIAN_FRONTEND=noninteractive

# 1 GB of swap: the server has 1 GB of RAM
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Time zone: IST (trading day boundaries)
timedatectl set-timezone Asia/Kolkata

apt-get update
apt-get -y upgrade
apt-get -y install git python3-venv python3-pip ufw unattended-upgrades debian-keyring debian-archive-keyring apt-transport-https curl gnupg

# Firewall: SSH, HTTP, HTTPS only
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Caddy (automatic HTTPS)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get -y install caddy

# Service user and a read-only GitHub deploy key (its public half is shown later to add in GitHub)
id helper >/dev/null 2>&1 || useradd -m -s /bin/bash helper
sudo -u helper mkdir -p /home/helper/.ssh
[ -f /home/helper/.ssh/deploy_key ] || sudo -u helper ssh-keygen -t ed25519 -N "" -C "fyers-helper-deploy" -f /home/helper/.ssh/deploy_key
sudo -u helper bash -c 'ssh-keyscan github.com >> /home/helper/.ssh/known_hosts 2>/dev/null'

echo "startup done $(date)" > /root/startup-done.txt
