# The standalone site on a VPS

The standalone edition (the same build as GitHub Pages, Windows games included) served by
[Caddy](https://caddyserver.com) on a small VPS, with Cloudflare's free proxy in front to cache the
big files. The social hub stays on Cloudflare Workers; no server data lives here, only the static site.

- `Caddyfile`: the site, its headers and cache lifetimes, and the SPA fallback (like Pages).
- `chimireader-deploy`: the only command the deploy key may run (prepare, rsync, activate).
- `.github/workflows/vps-site.yml`: builds the site (`scripts/build-standalone.sh`, as the Pages
  workflow does), uploads it to a new folder in `/srv/chimireader/releases/` and then flips the
  `/srv/chimireader/current` symlink, so readers never see half a site. The last 3 releases are kept.
  `release.yml` runs it with each `v*` tag once `VPS_HOST` is set; it skips while the secrets are missing.

## Provisioning

1. A Hetzner CAX11 (Arm) or CX23 (x86) in an EU location, Debian 13, with your SSH key.
   Then, as root:
   ```sh
   apt update && apt full-upgrade -y
   apt install -y ufw unattended-upgrades rsync python3 curl gpg
   ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
   dpkg-reconfigure -plow unattended-upgrades
   ```
2. Caddy from its repository:
   ```sh
   curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
   apt update && apt install -y caddy
   ```
3. The deploy user and the site folder. Make a key pair just for this (`ssh-keygen -t ed25519 -N ''
-f vps-deploy`), copy `chimireader-deploy` to `/usr/local/bin/` (mode 755), then:
   ```sh
   useradd -m -s /bin/sh deploy
   install -d -o deploy -g deploy -m 755 /srv/chimireader
   install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
   echo 'command="/usr/local/bin/chimireader-deploy",restrict ssh-ed25519 AAAA… vps-deploy' > /home/deploy/.ssh/authorized_keys
   chown deploy:deploy /home/deploy/.ssh/authorized_keys
   ```
   `restrict` turns off shells, forwarding and ptys; the command allows only the three steps, and
   rsync only into `/srv/chimireader/releases` (`rrsync`, part of Debian's rsync package).
4. The certificate (see "Cloudflare" below) in `/etc/caddy/origin.pem` and `/etc/caddy/origin.key`
   (`chown root:caddy`, `chmod 640` the key), this `Caddyfile` as `/etc/caddy/Caddyfile`, then
   `systemctl reload caddy`. Until the first deploy the site answers with errors.
5. GitHub (Settings → Secrets and variables → Actions): secrets `VPS_HOST` (the VPS's IP address:
   SSH doesn't go through Cloudflare's proxy), `VPS_USER` (`deploy`), `VPS_SSH_KEY` (the private key
   `vps-deploy`), `VPS_KNOWN_HOSTS` (the output of `ssh-keyscan -t ed25519 <IP>`; compare its key
   with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the VPS console before saving it),
   plus `VITE_GDRIVE_CLIENT_ID`/`VITE_GDRIVE_CLIENT_SECRET` for Drive sync. A variable
   `VPS_SITE_URL` changes the address from `https://chimireader.blank.moe`
   (then change the `Caddyfile`'s site name too). Run "VPS site" from the Actions tab with `main`.

## Cloudflare

- DNS: an `A` (and `AAAA`) record `chimireader` → the VPS's addresses, **Proxied** (orange cloud).
- SSL/TLS → Overview: **Full (strict)**. SSL/TLS → Origin Server → Create Certificate for
  `chimireader.blank.moe` (RSA or ECC, PEM, 15 years): the certificate goes into `origin.pem`, the
  private key into `origin.key`. Cloudflare trusts it; browsers never see it. This is simpler than
  getting a Let's Encrypt certificate through the proxy (no ACME, no API token on the VPS); the
  catch is that visiting the IP directly shows an untrusted certificate, which is fine.
- Caching → Cache Rules → a rule "Static files": hostname equals `chimireader.blank.moe` and
  URI path starts with `/vn/`, `/_app/immutable/` or `/dictionaries/` → Eligible for cache, Edge
  TTL: use the origin's Cache-Control. Cloudflare caches `.zip` and `.js` by default but not `.wasm`
  (nor HTML), so without the rule VNBox's wasm goes to the VPS each time. Files up to 512 MB are
  cached on the free plan (the largest, the Wine root fs, is ~100 MB).
- After a VNBox bump (`scripts/vnbox/sha256sums`) its files keep their names: purge
  `https://chimireader.blank.moe/vn/vnbox/` (Caching → Configuration → Custom Purge, prefix) after
  the deploy, or browsers and Cloudflare keep the old ones for up to a day.
- Speed → Optimization: keep **Rocket Loader** and Email Address Obfuscation off. Both inject
  scripts, which the app's CSP (hash mode) blocks.

## OAuth and other origins

- Google Drive: add `https://chimireader.blank.moe` as an authorised JavaScript origin and
  `https://chimireader.blank.moe/auth` as a redirect URI on the OAuth client in Google Cloud Console.
  The standalone has no OneDrive. OpenRouter needs nothing: its sign-in sends the page's own
  address as the callback.
- The Discord companion allows this origin from version 0.3.1 on (`DEFAULT_ORIGINS`); older add-ons
  need it in `extraOrigins`.
- The social hub answers any origin (`Access-Control-Allow-Origin: *`), so it needs no change.

## Moving readers from GitHub Pages

Browser data (books, progress, settings, highlights) belongs to one origin: the new address starts
empty. Before switching, readers should sync to Google Drive or a local folder and connect the same
one at the new address, or export a backup in the library at `chimireader.github.io` (Export → Zip
File) and use Import Backup at the new one. Both sites can run side by side.
