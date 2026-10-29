# The Python services (server/). One file, three targets:
#   base        accounts and the catalog builder (Python standard library + Pillow)
#   import      + Calibre, for adding books to the library (large)
#   difficulty  + Sudachi and yurigana, for difficulty estimates and word lists
#   mokuro      + mokuro and CPU PyTorch, for manga OCR (about 2 GB)
# Built by docker-compose.yml from the repository root. Runs as PUID (compose `user:`).

FROM debian:trixie-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pil ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY server/build-catalog.py server/assign-series.py /app/
COPY server/account /app/account
COPY server/import /app/import
RUN ln -s /app/build-catalog.py /usr/local/bin/build-calibre-catalog \
  && printf '#!/bin/sh\nexec python3 /app/account/service.py "$@"\n' > /usr/local/bin/ebook-account \
  && chmod 755 /app/build-catalog.py /usr/local/bin/ebook-account
ENV PYTHONUNBUFFERED=1 \
  CALIBRE_LIBRARY=/library \
  SHARED_SYNC_DIR=/data/sync \
  ACCOUNT_STATE_DIR=/data/state/account \
  ACCOUNT_DATA_DIR=/data/accounts \
  ACCOUNT_HOST=0.0.0.0 \
  CATALOG_OUTPUT=/data/state/catalog/catalog.json \
  CALIBRE_CATALOG=/data/state/catalog/catalog.json \
  IMPORT_STATE_DIR=/data/state/import \
  IMPORT_HOST=0.0.0.0 \
  CALIBRE_WRITE_LOCK=/data/state/import/calibre-write.lock \
  JITEN_STATE_DIR=/data/state/difficulty \
  JITEN_HOST=0.0.0.0 \
  MOKURO_STATE_DIR=/data/state/mokuro \
  MOKURO_HOST=0.0.0.0
CMD ["python3", "/app/account/service.py", "serve"]

FROM base AS import
RUN apt-get update \
  && apt-get install -y --no-install-recommends calibre \
  && rm -rf /var/lib/apt/lists/*
ENV HOME=/data/state/import QT_QPA_PLATFORM=offscreen
CMD ["python3", "/app/import/service.py"]

FROM base AS difficulty
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3-venv \
  && rm -rf /var/lib/apt/lists/*
COPY engine/requirements.txt /app/jiten/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r /app/jiten/requirements.txt
COPY engine /app/jiten
COPY server/jiten /app/jiten
CMD ["/opt/venv/bin/python", "-W", "ignore", "/app/jiten/service.py", "serve"]

FROM base AS mokuro
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3-venv libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*
COPY server/mokuro/requirements.txt /app/mokuro/requirements.txt
RUN python3 -m venv /opt/mokuro && /opt/mokuro/bin/pip install --no-cache-dir -r /app/mokuro/requirements.txt
COPY server/mokuro /app/mokuro
# The models (about 450 MB) are downloaded on the first volume and kept in /data.
ENV HOME=/data/state/mokuro HF_HOME=/data/state/mokuro/models
CMD ["python3", "/app/mokuro/service.py", "serve"]
