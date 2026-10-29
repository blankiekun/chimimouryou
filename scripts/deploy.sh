#!/bin/bash
# Deploy the current working tree (including uncommitted changes) to a server
# and (re)start the Docker stack there. Settings come from local/ (gitignored):
#
#   local/deploy.env                   where to deploy (see deploy/deploy.env.example)
#   local/env                          the stack's settings (.env.example)
#   local/docker-compose.override.yml  optional, e.g. deploy/examples/tailscale-https
#
# On the server: the source goes to /opt/ebook-reader, the settings to
# /etc/ebook-reader, and ebook-compose / ebook-account / ebook-update to
# /usr/local/bin (ebook-update's systemd units are installed when DATA_PATH is
# absolute, for updates from the admin panel). Images are built there; the
# running stack is only replaced if every image builds, and the previous images
# stay tagged :previous.
set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
LOCAL="${DEPLOY_CONFIG:-$REPO_ROOT/local}"
VERSION="$(git -C "$REPO_ROOT" describe --tags --always --long --dirty)"

if [ ! -f "$LOCAL/deploy.env" ] || [ ! -f "$LOCAL/env" ]; then
  echo "Missing $LOCAL/deploy.env or $LOCAL/env: copy deploy/deploy.env.example and .env.example there." >&2
  exit 1
fi
# shellcheck source=/dev/null
. "$LOCAL/deploy.env"
: "${TARGET:?set TARGET in $LOCAL/deploy.env}"

# A relative path would resolve inside /opt/ebook-reader, which every deploy deletes.
for name in DATA_PATH LIBRARY_PATH VN_PATH SYNC_PATH; do
  value=$(sed -n "s/^$name=//p" "$LOCAL/env" | tail -n 1 | tr -d '"'"'")
  case "$name:$value" in
    DATA_PATH:/* | LIBRARY_PATH:/* | VN_PATH:/* | VN_PATH: | SYNC_PATH:/* | SYNC_PATH:) ;;
    *) echo "$name in $LOCAL/env must be an absolute path (got '$value')" >&2; exit 1 ;;
  esac
done

# Runs a command on the server as root; stdin is passed through.
run() {
  case "$TARGET" in
    pct:*) sudo pct exec "${TARGET#pct:}" -- "$@" ;;
    # SSH_OPTIONS is split into words on purpose; the command is quoted here and run there.
    # shellcheck disable=SC2029,SC2086
    ssh:*) ssh ${SSH_OPTIONS:-} "${TARGET#ssh:}" "${REMOTE_SUDO:-} $(printf '%q ' "$@")" ;;
    local) if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi ;;
    *) echo "Unknown TARGET '$TARGET' (pct:<id>, ssh:<user@host> or local)" >&2; exit 1 ;;
  esac
}

# Copies a local file to the server: put <file> <destination> <mode>.
put() {
  run sh -c 'cat > "$1" && chmod "$2" "$1"' sh "$2" "$3" < "$1"
}

echo "Deploying ${VERSION} to ${TARGET}..."

tar -C "$REPO_ROOT" \
  --exclude=.git --exclude=node_modules --exclude=build --exclude=.svelte-kit \
  --exclude=./local --exclude=./CLAUDE.local.md --exclude=apps/web/.env.local \
  --exclude=./.env --exclude=./data --exclude=./.claude \
  --exclude=./apps/desktop/yomitan --exclude=./apps/desktop/dist \
  -czf - . \
  | run bash -c 'set -euo pipefail; rm -rf /opt/ebook-reader && mkdir -p /opt/ebook-reader && tar -C /opt/ebook-reader -xzf -'

run install -d -m 755 /etc/ebook-reader
put "$LOCAL/env" /etc/ebook-reader/env 600
if [ -f "$LOCAL/docker-compose.override.yml" ]; then
  put "$LOCAL/docker-compose.override.yml" /etc/ebook-reader/docker-compose.override.yml 644
else
  run rm -f /etc/ebook-reader/docker-compose.override.yml
fi
for command in ebook-compose ebook-account ebook-update; do
  put "$REPO_ROOT/deploy/server/$command" "/usr/local/bin/$command" 755
done

# The script goes on stdin, so a dash login shell over SSH never parses it; the braces make
# bash read all of it before anything runs (nothing inside can eat the rest).
run env LANG=C.UTF-8 VERSION="$VERSION" bash -s <<'EOF'
{
  set -euo pipefail
  compose=/usr/local/bin/ebook-compose
  images=$($compose config --images | sort -u)
  for image in $images; do
    docker image tag "$image" "${image%:*}:previous" 2>/dev/null || true
  done
  # On failure the images that ran get their tags back, so the next deploy keeps them as :previous.
  if ! $compose build --quiet || ! $compose up -d --remove-orphans; then
    for image in $images; do
      docker image tag "${image%:*}:previous" "$image" 2>/dev/null || true
    done
    $compose up -d --remove-orphans || true
    echo "Deploy failed: the previous images run again" >&2
    exit 1
  fi
  # Fill library.db's books, then copy the sync folders in (idempotent; the folders stay as they are).
  {
    $compose run --rm --no-deps -T catalog build-calibre-catalog /library /data/state/catalog/catalog.json \
      && $compose run --rm --no-deps -T api python3 /app/api/migrate.py --apply
  } || echo "Migration to the API database failed; the old sync folders are untouched" >&2
  docker image prune -f >/dev/null
  if [ -d /run/systemd/system ]; then
    /usr/local/bin/ebook-update install || echo "Updates from the admin panel stay off (see above)"
  fi
}
EOF

# The first admin account and its temporary password, until it has signed in.
run /usr/local/bin/ebook-account initial-admin || true

echo "Deployed ${VERSION}${SITE_URL:+ -> $SITE_URL} (previous images tagged :previous)"
