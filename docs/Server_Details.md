# Server details (no secrets)

| Item | Value |
| --- | --- |
| Provider | DigitalOcean, Bangalore (BLR1) |
| Droplet | `fyers-helper` (id 614194027), Ubuntu 24.04, 1 vCPU / 1 GB RAM / 25 GB SSD, $6/month |
| Droplet public IP | `134.209.159.171` (outbound traffic leaves from this address by default) |
| Reserved IP | `68.183.245.178` (free while attached) |
| Web address | `https://68-183-245-178.sslip.io` (sslip.io name, Let's Encrypt certificate via Caddy) |
| Time zone | Asia/Kolkata (IST) |
| Firewall | ufw: 22, 80, 443 only |
| Swap | 1 GB |
| Service user | `helper`; read-only GitHub deploy key in `/home/helper/.ssh/deploy_key` |
| Console access | DigitalOcean web console (Droplet → Web Console). SSH key `fyers-helper-claude` is installed for root |
| First-boot script | `server/startup.sh` |

## For go-live

Fyers sees the **outbound** address. By default that is the droplet IP `134.209.159.171`, not the reserved IP. Before whitelisting at Fyers, either:

- whitelist `134.209.159.171` (it stays the same as long as the droplet isn't destroyed), or
- route outbound traffic through the reserved IP (DigitalOcean "anchor IP" gateway), so in and out use `68.183.245.178`, which survives a droplet rebuild.
