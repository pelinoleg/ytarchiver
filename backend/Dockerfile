FROM python:3.12-slim

# ffmpeg is mandatory for yt-dlp post-processing (mp4 remux, audio extract,
# preview / thumbnail conversion). curl is kept tiny and used by the
# healthcheck so we don't need to push httpx into the image just for that.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first so the layer caches across code-only edits.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Container-internal paths. Hosts mount their own dirs onto these via
# docker-compose ``volumes`` (bind mounts, NOT named volumes).
ENV DATA_DIR=/data \
    DOWNLOAD_DIR=/downloads \
    DB_PATH=/data/ytarchiver.db \
    PYTHONUNBUFFERED=1

EXPOSE 8000

# Reload disabled in production — keep the worker stable across long
# downloads. The nginx sidecar forwards /api and /ws to this port.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
