# YT Archiver — Claude Code Project Config

Self-hosted YouTube archiver with web UI. Download videos by URL, subscribe to
channels with periodic auto-sync, browse and watch everything in a local web app.

## Stack

| Layer | Tech |
|---|---|
| Downloader | yt-dlp + ffmpeg |
| Backend API | FastAPI (Python 3.12) + APScheduler |
| Database | SQLite (WAL mode) |
| Frontend | React 18 + Vite + TanStack Query + Tailwind |
| Infra | Docker + docker-compose |

## Skills — read before touching each layer

| Task | Read this skill first |
|---|---|
| yt-dlp calls, channel sync, download options | `.claude/skills/ytdlp-downloader/SKILL.md` |
| FastAPI routes, background tasks, WebSocket | `.claude/skills/fastapi-backend/SKILL.md` |
| Database schema, queries, migrations | `.claude/skills/sqlite-db/SKILL.md` |
| React components, pages, API hooks | `.claude/skills/react-frontend/SKILL.md` |
| Visual design, layout, YouTube-style UI, polish | `.claude/skills/ui-design/SKILL.md` |
| Dockerfile, docker-compose, nginx, deploy | `.claude/skills/docker-deploy/SKILL.md` |

**Rule**: Always read the relevant skill BEFORE writing any code for that layer.

## Project structure

```
ytarchiver/
  backend/
    main.py
    config.py
    routers/
    services/
    db/
    Dockerfile
    requirements.txt
  frontend/
    src/
    Dockerfile
    nginx.conf
  .claude/
    skills/
      ytdlp-downloader/SKILL.md
      fastapi-backend/SKILL.md
      sqlite-db/SKILL.md
      react-frontend/SKILL.md
      ui-design/SKILL.md
      docker-deploy/SKILL.md
  docker-compose.yml
  docker-compose.prod.yml
  .env.example
  downloads/       # gitignored
  data/            # gitignored
```

## Key architectural decisions

- yt-dlp NEVER runs synchronously in a route handler — always BackgroundTasks
- SQLite in WAL mode — good enough for this load, no PostgreSQL needed
- Videos served via FastAPI FileResponse with `Accept-Ranges` — enables seeking
- WebSocket at `/ws` pushes download progress to all connected clients
- Dark UI by default — Tailwind `bg-zinc-950` base theme

## Dev quickstart

One-shot launcher — installs deps if missing, starts both servers, opens browser:

```bash
./dev.sh
```

Logs land in `data/logs/`. Ctrl-C cleans up.

Manual:
```bash
# Backend
cd backend && pip install -r requirements.txt
uvicorn main:app --reload

# Frontend
cd frontend && npm install && npm run dev

# Or everything via Docker
docker compose up -d
```

Frontend: http://localhost:5173 (dev) or http://localhost (Docker)
API docs: http://localhost:8000/docs
