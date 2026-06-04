FROM python:3.12-slim

# ffmpeg is mandatory for yt-dlp post-processing (mp4 remux, audio extract,
# preview / thumbnail conversion). curl is kept tiny and used by the
# healthcheck so we don't need to push httpx into the image just for that.
# smartmontools reads the media disk's SMART temperature for the dashboard
# (only does anything when DISK_DEVICE + the device passthrough are set).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl sqlite3 smartmontools \
 && rm -rf /var/lib/apt/lists/*

# JavaScript runtime for yt-dlp. As of late-2025 yt-dlp deprecated extraction
# without a JS runtime: the player nsig/sig challenge AND the bgutil GVS PO
# token both need one, or YouTube falls back to the android_vr client which is
# login-walled ("Sign in to confirm you're not a bot"). Deno is the runtime
# yt-dlp enables by default, so just having it on PATH is enough — no flag.
# The bin image is multi-arch, so buildx copies the right amd64/arm64 binary.
COPY --from=denoland/deno:bin-2.8.2 /deno /usr/local/bin/deno

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
