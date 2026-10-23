# Installing with Docker

Runs the reader with a Calibre library on any Linux server with Docker and the
Compose plugin. For the reader alone (books stored in the browser, no server
features) use `docker compose -f docker-compose.static.yml up -d` instead.

## What runs

| Service      | Image target | What it does                                                  |
| ------------ | ------------ | ------------------------------------------------------------- |
| `web`        | web          | nginx: the app, book files, WebDAV sync, access checks        |
| `account`    | base         | accounts, sign-in, permissions (Python standard library)      |
| `catalog`    | base         | rebuilds `catalog.json` from `metadata.db`, extracts covers   |
| `import`     | import       | optional (`--profile import`): adds uploaded books to Calibre |
| `difficulty` | difficulty   | optional (`--profile difficulty`): difficulty estimates       |
| `mokuro`     | mokuro       | optional (`--profile mokuro`): manga text (OCR) for Yomitan   |

`import` installs Calibre, `difficulty` Sudachi and ONNX Runtime and `mokuro`
PyTorch (about 2 GB), so these images are large; leave them out unless you want those features.

## Server size

What the machine (or VM/container) running the stack needs, by the profiles in use.
The library and sync folder are extra and can live on other storage. Disk is for the
system, the images twice over (each update keeps the previous ones as `:previous`),
Docker's build cache (capped at 6 GB, see [Disk space for builds](#disk-space-for-builds))
and `DATA_PATH`.

| Profiles                                 | CPU cores | RAM  | Swap   | Disk  |
| ---------------------------------------- | --------- | ---- | ------ | ----- |
| none (reader, accounts)                  | 1         | 1 GB | 512 MB | 16 GB |
| `import`                                 | 2         | 2 GB | 512 MB | 24 GB |
| `import,difficulty`                      | 2-4       | 4 GB | 1 GB   | 24 GB |
| `import,difficulty,mokuro` (recommended) | 4+        | 6 GB | 1 GB   | 32 GB |

Where it goes: the services idle at about 15 MB each. Calibre's `calibredb add`
takes a few hundred MB while it runs; each difficulty worker (`DIFFICULTY_WORKERS`,
default 2) 0.5-1 GB during estimates; mokuro 1.5 GB while it reads a volume. The images
are about 0.3 GB (web), 0.1 GB (services), 1.4 GB (import), 0.6 GB (difficulty) and
2.1 GB (mokuro), plus 450 MB of mokuro models in `DATA_PATH`. More cores make estimates
and mokuro faster; the compose file gives both a lower CPU share (`cpu_shares: 512`)
so the reader stays responsive while they run. Add 16 GB of disk and 2 GB of RAM for a
second copy of the stack (a test server) or for building the visual novel engine there.

On Proxmox, an unprivileged LXC container works with `nesting=1,keyctl=1` (Docker
inside), Debian with Docker from its own packages (`docker.io docker-compose
docker-buildx`), and the library bind-mounted into it.

## Setup

```sh
git clone https://github.com/blankiekun/chimimouryou && cd chimimouryou
cp .env.example .env        # set LIBRARY_PATH, PUID/PGID, HTTP_PORT
docker compose up -d --build
docker compose exec account ebook-account initial-admin
```

The first start creates the admin account `admin` with a temporary password;
`ebook-account initial-admin` (or `docker compose logs account`) shows it until
that account has signed in. Change it in Settings → Account afterwards.
Signing in needs HTTPS (see [HTTPS](#https)); to try it on a home network first,
set `ALLOW_HTTP_ACCOUNTS=1` (see [Accounts](#accounts-and-permissions)).

- `LIBRARY_PATH` is the Calibre library folder (the one with `metadata.db`).
  `PUID`/`PGID` must be able to read it; the catalog also writes `cover.jpg`
  into book folders that have no cover, and the import profile adds books.
- Everything the server stores is in `DATA_PATH` (default `./data`):
  `sync/` (shared processed books and signed-out progress), `accounts/`
  (each account's progress, highlights and settings, including AI API keys),
  `state/` (account database, catalog, import queue, difficulty results).
  Back up `DATA_PATH`. Keep it off shares other machines can read.
- Open `http://<server>:HTTP_PORT/`. The library shows the Calibre catalog
  after the first catalog run (a minute or so; large libraries take longer
  the first time because of cover extraction).

## HTTPS

Signing in, offline mode and installing the app need HTTPS. The stack only
serves HTTP; put one of these in front of `HTTP_PORT`:

- **Caddy** (automatic Let's Encrypt certificate):

  ```
  books.example.com {
    reverse_proxy 127.0.0.1:8080
  }
  ```

- **Traefik / Nginx Proxy Manager**: proxy the host to `HTTP_PORT`; keep the
  `Host` header and send `X-Forwarded-Proto` and `X-Forwarded-For` (both do by default).
- **Tailscale**: `tailscale serve --bg 8080` on the server gives
  `https://<machine>.<tailnet>.ts.net` inside your tailnet. Or let nginx use a
  Tailscale certificate itself:
  [deploy/examples/tailscale-https](../deploy/examples/tailscale-https/README.md).

Then set in `.env`:

- `REAL_IP_FROM`: the proxy's address as nginx sees it (for a proxy on the
  same host, Docker's gateway, e.g. `172.16.0.0/12`). Without it every visitor
  appears to come from the proxy. For a proxy on the same host that only
  weakens sign-in throttling (Docker's range isn't in the default
  `TRUSTED_NETWORKS`). **For a proxy on another machine in your LAN it is a
  hole** if you list your LAN in `TRUSTED_NETWORKS`: every visitor from the
  internet counts as trusted and can read the library and change or delete the
  shared sync folder. Set `REAL_IP_FROM` to that machine's address, or keep
  `TRUSTED_NETWORKS` empty. The same applies to Docker Desktop and rootless
  Docker, where all connections arrive from a private address: keep
  `TRUSTED_NETWORKS` empty there.
- `PUBLIC_HTTPS_URL` if people also use a plain-HTTP address with a different
  name; the HTTP page links there to sign in. Rebuild with `docker compose build web`.

## Accounts and permissions

Signing in needs HTTPS. On a home network without it you can set
`ALLOW_HTTP_ACCOUNTS=1`: sign-in, the admin panel and adding books then also
work on the plain-HTTP address, with a warning in the app, but passwords,
sessions and synced settings (including AI API keys) cross the network
unencrypted. Leave it off if anyone else can see the network.

There is no sign-up. Admins add accounts in the admin panel (Settings → Account → Open admin
panel), or with `docker compose exec account ebook-account ...`
(`add NAME [--admin]`, `passwd NAME`, `remove NAME`, `admin NAME on|off`,
`permissions NAME import,series,difficulty`, `list`).

| Who                                           | May                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------- |
| anyone who can reach the server               | load the app; with `PUBLIC_READS=1` also browse and download books  |
| signed out, from `TRUSTED_NETWORKS`           | read the library, open books, save progress in the shared folder    |
| any account                                   | the above from anywhere, plus its own synced progress and settings  |
| permission `import` / `series` / `difficulty` | add books to Calibre / change series for everyone / start estimates |
| admin                                         | everything, and manage accounts and permissions                     |

`TRUSTED_NETWORKS` is empty by default, so everything needs an account. On a
home server you can list your networks (e.g. `10.0.0.0/8 192.168.0.0/16`,
Tailscale's `100.64.0.0/10`) so household readers don't have to sign in; read
the `REAL_IP_FROM` note under [HTTPS](#https) first if the server is reachable
from the internet.
Don't add `172.16.0.0/12`: that is Docker's own network, so a reverse proxy on
the same host would make every visitor trusted (the web container warns).

Give `import` only to people you trust: it runs Calibre on their uploads.

### Built-in protections

- Files in the sync folders are served as downloads, never as pages.
- Book HTML is parsed without running anything and cleaned of scripts and
  event handlers; a Content-Security-Policy only allows the app's own scripts.
- Sign-in throttling counts per username and address, so strangers can't lock
  you out; uploads stop when the data disk has less than `MIN_FREE_MB` free.
- Security headers (HSTS behind HTTPS, nosniff, framing, referrer).

## Deploying from a checkout

To develop on one machine and run the stack on another, `scripts/deploy.sh`
copies the working tree to the server, builds there and restarts the stack
(the running stack stays if a build fails; the previous images are kept as
`:previous`). Put your settings in `local/` (gitignored):

- `local/deploy.env` from `deploy/deploy.env.example`: the target, a Proxmox
  container (`pct:<id>`), an SSH host (`ssh:root@host`) or this machine (`local`);
- `local/env` from `.env.example`;
- optionally `local/docker-compose.override.yml`, e.g.
  [deploy/examples/tailscale-https](../deploy/examples/tailscale-https/README.md).

On the server the source goes to `/opt/ebook-reader` and the settings to
`/etc/ebook-reader`; `ebook-compose` (= `docker compose` for the stack),
`ebook-account` and `ebook-update` are installed in
`/usr/local/bin`. The end of the output shows the first admin's temporary
password until that account has signed in.
Roll back with
`for i in $(ebook-compose config --images); do docker image tag "${i%:*}:previous" "$i"; done; ebook-compose up -d`.

## Updating

Servers set up with `scripts/deploy.sh` (systemd, an absolute `DATA_PATH`) can
update from the admin panel: Tools → Updates compares the server with the latest
release (Stable, the default) or the newest commit on main (Bleeding edge) of
`UPDATE_REPO` on GitHub, and "Update" makes `ebook-update` (a systemd
path unit installed by the deploy) download that commit, rebuild the images and
restart the stack. A failed build keeps the running version; the previous images
stay tagged `:previous`. Its log: `journalctl -u ebook-update`. It builds and
runs whatever is released or on main as root, so only point `UPDATE_REPO` at a
repository you trust. Tools → Visual novel engine uses the same updater to
install a new CONscripter release: it only downloads the release's web build into
`DATA_PATH/state/engine/`, which nginx serves ahead of the built-in engine (no build,
no restart).

Otherwise:

```sh
git pull && docker compose up -d --build
```

Or use published images instead of building (no Node or Calibre download on the
server, amd64 and arm64): set `IMAGE_PREFIX=ghcr.io/<owner>/<repository>` and
`IMAGE_TAG` to a release (or `latest`) in `.env`, then

```sh
docker compose pull && docker compose up -d
```

### Disk space for builds

Docker keeps build cache forever by default, and every rebuild (updates, deploys)
adds a few GB, so a small disk fills up after a while. Cap it in
`/etc/docker/daemon.json` (Docker then trims the oldest cache itself);
`live-restore` keeps the stack running when Docker restarts:

```json
{
  "builder": { "gc": { "enabled": true, "defaultKeepStorage": "6GB" } },
  "live-restore": true
}
```

Apply with `systemctl reload docker` for `live-restore` first, then
`systemctl restart docker`. `docker builder prune` frees the cache right away.

## Manga text (mokuro)

The `mokuro` profile gives manga their text: [mokuro](https://github.com/kha-white/mokuro)
finds the speech bubbles and reads them, and the manga reader lays the text over the
pages, where Yomitan can look it up. On a book's page in the library, accounts with the
`import` permission choose "Make text on the server" (one volume at a time, about 5 s a
page on a CPU and 1.5 GB of RAM; the models, about 450 MB, are downloaded into
`DATA_PATH/state/mokuro/models/` the first time) or "Upload .mokuro".

A computer with a GPU is much faster. Make the file there and upload it:

```sh
pip install mokuro
mokuro --disable_confirmation=true --legacy_html=false "Volume 1.cbz"   # writes "Volume 1.mokuro"
```

The service only runs mokuro when asked, so it costs nothing while idle.

## Difficulty estimates

The `difficulty` profile uses Jiten's word frequency list, which is bundled
(`scripts/calibre/jiten/data/jiten_freq_global.zip`, CC BY-SA 4.0) and copied to
`DATA_PATH/state/difficulty/frequency-dictionary.zip` when the service starts and none is
there. To use a newer list, download `jiten_freq_global.zip` from
https://jiten.moe/frequency-dictionaries and upload it in the admin panel as an admin
(Tools → Estimate difficulty → "Replace frequency list"; the service checks it, and asks to
confirm a replacement whose readings disagree with the installed list), or save it as that
file. An installed list is never overwritten by the bundled one.

## Standalone web app

The same code builds as a web app without a server: `VITE_EDITION=standalone pnpm build`
writes a static site to `apps/web/build`. Books live on the device (in the browser), in a
local folder or on Google Drive; there are no accounts, Calibre library, difficulty estimates or
Words page, and the build sends no requests to `/calibre/` or `/account/`.

The Pages workflow builds with `VITE_STORAGE_ROOT_NAME=chimi-reader-data`, so its Google Drive
folder is `chimi-reader-data`, not ッツ Reader's or Hoshi's `ttu-reader-data` (the `drive.file`
scope would not let it see their files anyway). Server builds keep `ttu-reader-data`.

To publish it on GitHub Pages, copy [deploy/pages/pages.yml](../deploy/pages/pages.yml) to
`.github/workflows/` in the site repository (e.g. `<org>/<org>.github.io`), choose
"GitHub Actions" as the Pages source, add the secrets `VITE_GDRIVE_CLIENT_ID` and
`VITE_GDRIVE_CLIENT_SECRET` (OAuth redirect URI
`https://<site>/auth`), set `VITE_BASE_PATH` in the workflow to the site's address and run it
from the Actions tab with a tag or `main`.
To publish every release automatically, give this repository the secret `PAGES_DISPATCH_TOKEN`
(a fine-grained token for the site repository only, with Actions: read and write) and, if the
site isn't `chimireader/chimireader.github.io`, the variable `PAGES_REPO`: `release.yml` then runs
the site's workflow with each `v*` tag once CI passes.
