---
name: docker-deploy
description: >
  Use this skill when containerizing or deploying the YT Archiver project.
  Triggers on: Dockerfile, docker-compose, deploy to NAS, deploy to VPS,
  volumes, environment variables, nginx, production build, Coolify, container
  restart policy. Do NOT use for application code (use other skills), only
  for infrastructure and deployment concerns.
---

# Docker Deploy Skill

## Target environments

- **Development**: local machine, `docker compose up`
- **Production NAS** (UGREEN / Synology): same compose file, different `.env`
- **Production VPS** (Hetzner CX22 via Coolify): optional

## Repository layout

```
ytarchiver/
  backend/
    Dockerfile
    requirements.txt
  frontend/
    Dockerfile
    nginx.conf
  docker-compose.yml
  docker-compose.prod.yml
  .env.example
  downloads/           # gitignored — mounted as volume
```

## Backend Dockerfile

```dockerfile
FROM python:3.12-slim

# ffmpeg is required for yt-dlp video+audio merging
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## requirements.txt

```
fastapi>=0.111
uvicorn[standard]>=0.29
yt-dlp>=2024.11
pydantic>=2.6
pydantic-settings>=2.2
apscheduler>=3.10
python-multipart>=0.0.9
aiofiles>=23.2
```

## Frontend Dockerfile (multi-stage)

```dockerfile
# Stage 1: build React app
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: serve with nginx
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

## nginx.conf (inside frontend container)

```nginx
server {
    listen 80;

    # Serve React SPA — all routes go to index.html
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }

    # Proxy API calls to backend
    location /api/ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket proxy
    location /ws {
        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Increase buffer for video streaming
    proxy_buffering off;
    client_max_body_size 0;
}
```

## docker-compose.yml (development)

```yaml
services:
  backend:
    build: ./backend
    restart: unless-stopped
    environment:
      - DOWNLOADS_DIR=/downloads
      - DB_PATH=/data/ytarchiver.db
      - SYNC_INTERVAL_HOURS=6
    volumes:
      - ./downloads:/downloads          # video files
      - ./data:/data                     # SQLite database
      - ./backend:/app                   # hot reload in dev
    ports:
      - "8000:8000"                      # expose for direct access in dev

  frontend:
    build: ./frontend
    restart: unless-stopped
    ports:
      - "80:80"
    depends_on:
      - backend
```

## docker-compose.prod.yml (production override)

```yaml
# Usage: docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
services:
  backend:
    command: uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
    volumes:
      - /volume1/ytarchiver/downloads:/downloads    # NAS path
      - /volume1/ytarchiver/data:/data
    # Remove the ./backend:/app dev mount in prod!

  frontend:
    environment:
      - VITE_API_URL=https://ytarchiver.yourdomain.com
```

## .env.example

```env
DOWNLOADS_DIR=/downloads
DB_PATH=/data/ytarchiver.db
SYNC_INTERVAL_HOURS=6
MAX_CONCURRENT_DOWNLOADS=2
```

## NAS deployment (UGREEN / Synology)

```bash
# 1. SSH into NAS
ssh admin@nas.local

# 2. Create directories
mkdir -p /volume1/ytarchiver/{downloads,data}

# 3. Clone repo
cd /volume1/ytarchiver
git clone https://github.com/yourname/ytarchiver .

# 4. Copy and edit env
cp .env.example .env
nano .env

# 5. Start
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 6. Check logs
docker compose logs -f backend
```

## Coolify (VPS) deployment

1. Create new project in Coolify → "Docker Compose" source
2. Point to GitHub repo
3. Set `docker-compose.yml` as compose file, `docker-compose.prod.yml` as override
4. Add environment variables in Coolify UI
5. Set persistent volume paths under "Storage":
   - `/downloads` → host path or named volume
   - `/data` → host path or named volume

## Useful commands

```bash
# Rebuild after code change
docker compose up -d --build backend

# Watch backend logs
docker compose logs -f backend

# Open shell in backend container
docker compose exec backend bash

# Manually trigger yt-dlp update inside container
docker compose exec backend pip install -U yt-dlp

# Backup database
docker compose exec backend sqlite3 /data/ytarchiver.db ".backup /data/ytarchiver.backup.db"
```

## Rules

- ALWAYS mount `downloads` and `data` as named volumes or host paths — never bake them into the image
- ALWAYS install `ffmpeg` in the backend image — yt-dlp needs it for merging video+audio streams
- WebSocket proxying in nginx REQUIRES `proxy_http_version 1.1` + `Upgrade`/`Connection` headers
- Use `restart: unless-stopped` on all services — auto-restart after NAS reboot
- `proxy_buffering off` in nginx is important for video streaming — prevents nginx from buffering large video files in memory
- Keep yt-dlp up to date: add a cron job or startup script to run `pip install -U yt-dlp`
