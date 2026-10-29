# The reader (static build) served by nginx with the Calibre/account locations.
# Built by docker-compose.yml from the repository root.

# The build output is static files, so build on the machine's own platform (no
# emulation when publishing arm64 images).
FROM --platform=$BUILDPLATFORM node:24-slim AS build
ENV HUSKY=0
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
# VNBox (Windows games, scripts/vnbox/build.sh), fetched in its own layer so a deploy reuses it.
# Without it (an offline build) the site has no Windows game player.
RUN apt-get -qq update && apt-get -qq install -y --no-install-recommends curl ca-certificates >/dev/null \
  && rm -rf /var/lib/apt/lists/*
COPY scripts/vnbox/ scripts/vnbox/
RUN VNBOX_OUT=/vnbox scripts/vnbox/build.sh \
  || echo 'VNBox was not downloaded: no Windows game player' >&2
COPY . .
# The HTTPS address the plain-HTTP page links to for signing in (optional).
ARG VITE_HTTPS_URL=
ARG VERSION=docker
WORKDIR /src/apps/web
RUN pnpm svelte-kit sync && pnpm build \
  && echo "$VERSION" > build/version.txt \
  && cp /src/themes.md build/themes.md \
  && if [ -d /vnbox ]; then mkdir -p build/vn && cp -r /vnbox build/vn/vnbox; fi
# Settings → Dictionary's one-tap JMdict (EDRDG, CC BY-SA 4.0, see NOTICE), served same-origin.
# Without it (an offline build) the app links to jmdict-yomitan's releases instead.
ARG JMDICT_URL=https://github.com/yomidevs/jmdict-yomitan/releases/latest/download/JMdict_english.zip
RUN mkdir -p build/dictionaries && node -e "fetch(process.argv[1]).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then((b) => require('fs').writeFileSync('build/dictionaries/JMdict_english.zip', Buffer.from(b)))" "$JMDICT_URL" \
  || echo 'JMdict was not downloaded: Settings → Dictionary links to its releases instead' >&2

FROM nginx:1.29-alpine
COPY --from=build /src/apps/web/build /srv/www
COPY server/nginx-ebook-reader.conf.template server/render-nginx.sh /opt/ebook-reader/
COPY docker/40-ebook-reader.sh /docker-entrypoint.d/
# Checked every second while starting, so the services (which wait for this) follow
# quickly: until the account service is up, every access check fails.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=1s CMD wget -q -O /dev/null http://127.0.0.1/version.txt || exit 1
