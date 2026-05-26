# ── stage 1: build the SPA ───────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# package*.json first → npm install caches across source-only changes.
COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build   # → /app/dist

# ── stage 2: serve via nginx + reverse-proxy to backend ─────────────────────
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
