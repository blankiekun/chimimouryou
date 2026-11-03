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
# Without it (an offline build) the site has no Windows game player. Releases set REQUIRE_ASSETS=1:
# there a failed download fails the build, and the changed value skips layers cached without it.
ARG REQUIRE_ASSETS=
RUN apt-get -qq update && apt-get -qq install -y --no-install-recommends curl ca-certificates >/dev/null \
  && rm -rf /var/lib/apt/lists/*
COPY scripts/vnbox/ scripts/vnbox/
RUN VNBOX_OUT=/vnbox scripts/vnbox/build.sh \
  || { rm -rf /vnbox; echo 'VNBox was not downloaded: no Windows game player' >&2; [ -z "$REQUIRE_ASSETS" ]; }
# vita-vn-ocr's models (screen text for Windows games, scripts/vn-ocr/fetch.sh); optional the same way.
COPY scripts/vn-ocr/ scripts/vn-ocr/
RUN VN_OCR_OUT=/vnocr scripts/vn-ocr/fetch.sh \
  || { rm -rf /vnocr; echo 'The VN OCR models were not downloaded: hooked lines keep the fixed layout' >&2; [ -z "$REQUIRE_ASSETS" ]; }
COPY . .
# The HTTPS address the plain-HTTP page links to for signing in (optional).
ARG VITE_HTTPS_URL=
ARG VERSION=docker
# Test stacks only: the Sources fake sites (transport.ts); empty in every real build.
ARG VITE_SOURCES_FIXTURE_URL=
WORKDIR /src/apps/web
RUN pnpm svelte-kit sync && pnpm build \
  && echo "$VERSION" > build/version.txt \
  && cp /src/themes.md build/themes.md \
  && if [ -d /vnbox ]; then mkdir -p build/vn && cp -r /vnbox build/vn/vnbox; fi \
  && if [ -d /vnocr ]; then mkdir -p build/vn && cp -r /vnocr build/vn/ocr; fi
# Settings → Dictionary's one-tap JMdict (EDRDG, CC BY-SA 4.0, see NOTICE), served same-origin.
# Without it (an offline build) the app links to jmdict-yomitan's releases instead.
RUN mkdir -p build/dictionaries && /src/scripts/fetch-jmdict.sh build/dictionaries/JMdict_english.zip \
  || { echo 'JMdict was not downloaded: Settings → Dictionary links to its releases instead' >&2; [ -z "$REQUIRE_ASSETS" ]; }

FROM nginx:1.31-alpine
COPY --from=build /src/apps/web/build /srv/www
COPY server/nginx-ebook-reader.conf.template server/render-nginx.sh /opt/ebook-reader/
COPY docker/40-ebook-reader.sh /docker-entrypoint.d/
# Checked every second while starting, so the services (which wait for this) follow
# quickly: until the account service is up, every access check fails.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=1s CMD wget -q -O /dev/null http://127.0.0.1/version.txt || exit 1
