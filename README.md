# YT Archiver

Self-hosted YouTube archive with a web UI. Subscribe to channels, archive
playlists, build search collections, watch everything locally in a custom
player.

## Stack

| Layer       | Tech                                                  |
|-------------|-------------------------------------------------------|
| Downloader  | yt-dlp + ffmpeg                                       |
| Backend     | FastAPI (Python 3.12) · SQLite (WAL) · APScheduler    |
| Frontend    | React 18 · Vite · TanStack Query · Tailwind v4        |
| Infra       | Docker + docker-compose · nginx                       |

## Quick start (Docker)

```bash
docker compose up -d --build
```

Open <http://localhost:8080>.

- nginx serves the SPA on `:8080` and reverse-proxies `/api` + `/ws` to
  the backend container.
- SQLite database lives at `./data/ytarchiver.db` (host path).
- Downloaded video files live under `./downloads/` (host path).
- Both directories are explicit bind mounts — back them up with regular
  filesystem tools, no `docker volume` indirection.

All configuration is set in `docker-compose.yml` under
`services.backend.environment` — change quality, retention defaults, sync
interval, etc. and `docker compose up -d --build` to apply.

To stop:

```bash
docker compose down
```

State on disk is **not** removed.

## Dev (no Docker)

```bash
./dev.sh
```

Boots the backend (uvicorn with `--reload`) and the Vite dev server
together, opens the browser. Logs land in `data/logs/`. Ctrl-C cleans up.

Or manually:

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

API docs at <http://localhost:8000/docs> when running the backend.

## What you get

- **Subscriptions** — periodic channel sync, configurable interval +
  jitter to avoid YT pattern detection.
- **Playlists & search collections** — auto-track changes.
- **Music mode** — separate library, gapless playback, background audio
  (via hidden `<audio>` swap on screen-lock).
- **Custom player** — chapters, SponsorBlock auto-skip, swipe gestures
  on mobile (up/down for fullscreen, left/right for next/prev, pinch for
  fit/cover), quality switcher per video, mini PiP when leaving the
  watch page.
- **Smart cleanup** — retention by days OR by watched-percent,
  per-channel overrides, manual "keep forever" pins.
- **Folders** — group channels into named folders (Tech / Politics /
  Tutorials), each gets its own feed view.
- **Format-safe downloads** — H.264 first, VP9 fallback for &gt;1080p; AV1
  hard-excluded so files play on iOS Safari.
- **Storage dashboard** — biggest channels / videos, weekly growth
  chart, resolution breakdown, bulk re-download for legacy AV1, orphan
  cleanup.
- **Pull-to-refresh on phone**, **bottom tab nav**, PWA-installable.

## Layout

```
backend/    FastAPI app, services, DB
  Dockerfile
  main.py
  routers/ services/ db/
frontend/   Vite + React SPA
  Dockerfile
  nginx.conf
  src/
docker-compose.yml
data/       (gitignored) SQLite + logs
downloads/  (gitignored) video files
```
