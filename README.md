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

## Quick start — pre-built images (no clone)

```bash
mkdir ytarchiver && cd ytarchiver
curl -O https://raw.githubusercontent.com/pelinoleg/ytarchiver/main/docker-compose.yml
docker compose up -d
```

Open <http://localhost:8080>.

- Images are published to `ghcr.io/pelinoleg/ytarchiver-{backend,frontend}`
  on every push to `main` — multi-arch (amd64 + arm64), so the same
  compose works on Apple Silicon and x86 Linux servers.
- nginx serves the SPA on `:8080` and reverse-proxies `/api` + `/ws` to
  the backend container.
- SQLite database lives at `./data/ytarchiver.db` (host path).
- Downloaded video files live under `./downloads/` (host path).
- Both directories are explicit bind mounts — back them up with regular
  filesystem tools, no `docker volume` indirection.

All configuration sits in `docker-compose.yml` under
`services.backend.environment` — change quality, retention, sync
interval, etc. and `docker compose up -d` to apply.

To upgrade to the latest published images:

```bash
docker compose pull && docker compose up -d
```

To stop:

```bash
docker compose down
```

State on disk is **not** removed.

> If `docker pull` complains about authentication, the GHCR package
> visibility is still set to private (default for new repos). Fix:
> visit <https://github.com/users/pelinoleg/packages> → each image →
> Settings → "Change visibility" → Public. Or `docker login ghcr.io`
> with a personal access token.

## "Sign in to confirm you're not a bot"

Self-hosted yt-dlp on a NAS / VPS will eventually hit YouTube's bot wall —
data-center IPs are noisy and YT flags them after a handful of requests.
The fix is to give yt-dlp your **browser cookies**, so the requests look
like a logged-in human's instead of an anonymous data-center crawler.

1. **In your browser, log in to youtube.com** with a regular account.
   A throwaway account is fine — YouTube doesn't care, but throwaway
   accounts are easier to ban, so a real low-traffic one is safer.
2. Install a "cookies.txt exporter" extension — e.g.
   <https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc>
   (the "LOCALLY" version doesn't ship cookies anywhere; verify the
   source if you care).
3. With <https://www.youtube.com> open, click the extension → **Export**
   → save as `cookies.txt`.
4. Drop it next to your compose file:

   ```
   ytarchiver/
     docker-compose.yml
     cookies/
       youtube.txt      ← here, exactly this name
   ```

5. Restart the backend:

   ```bash
   docker compose up -d backend
   ```

The mount is `./cookies:/cookies:ro` — read-only on the container side,
so yt-dlp can't accidentally update / delete your file. Empty
`./cookies/` is fine too; the backend just runs without cookies and you
get the bot wall back.

If cookies don't help (rare), try setting `YOUTUBE_PLAYER_CLIENT: android`
in `docker-compose.yml` — that uses the Android API which sometimes
slips past detection that blocks the web client.

## Build from source (alternative)

```bash
git clone https://github.com/pelinoleg/ytarchiver.git
cd ytarchiver
docker compose -f docker-compose.dev.yml up -d --build
```

Same compose, except both services are built locally from the
`Dockerfile`s in this repo. Useful when iterating on the code or for
hosting your own fork.

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
