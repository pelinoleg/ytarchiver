#!/usr/bin/env bash
# YT Archiver — one-shot dev launcher.
# Bootstraps deps if missing, starts backend + frontend bound to all interfaces
# so the PWA is reachable from your phone on the same Wi-Fi, prints LAN URLs,
# opens the browser, tails logs. Ctrl-C cleans up.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
LOGS="$ROOT/data/logs"
mkdir -p "$LOGS"

BACK_PORT=8000
FRONT_PORT=5173
BACK_URL="http://localhost:${BACK_PORT}"
FRONT_URL="http://localhost:${FRONT_PORT}"

# ── Pretty output ───────────────────────────────────────────────────────────────
step() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m⚠ %s\033[0m\n" "$*"; }
info() { printf "  %s\n" "$*"; }
die()  { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

# ── Detect LAN IPs (any non-loopback IPv4 on an active interface) ───────────────
lan_ips() {
  local out=""
  # 1) macOS — ipconfig per common interfaces (Wi-Fi, ethernet, USB tethering).
  if command -v ipconfig >/dev/null; then
    for iface in en0 en1 en2 en3 en4 en5 en6 en7; do
      local ip
      ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
      [ -n "$ip" ] && out+="${ip}\n"
    done
  fi
  # 2) Linux fallback — every IPv4 not on the loopback adapter.
  if [ -z "$out" ] && command -v ip >/dev/null; then
    out="$(ip -4 -o addr show scope global 2>/dev/null \
            | awk '{print $4}' | cut -d/ -f1)"
  fi
  # 3) Last resort — socket trick (the IP we'd use to reach the internet).
  if [ -z "$out" ]; then
    out="$(python3 - <<'PY' 2>/dev/null || true
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(1); s.connect(("1.1.1.1", 80))
    print(s.getsockname()[0])
except Exception:
    pass
PY
)"
  fi
  printf "%b" "$out" | awk 'NF && !/^127\./' | sort -u
}

# ── Prereqs ─────────────────────────────────────────────────────────────────────
command -v python3 >/dev/null || die "python3 is required"
command -v node    >/dev/null || die "node is required"
command -v npm     >/dev/null || die "npm is required"
command -v ffmpeg  >/dev/null || warn "ffmpeg is missing — downloads won't merge. Run: brew install ffmpeg"

# ── Backend bootstrap ───────────────────────────────────────────────────────────
if [ ! -d "$BACKEND/.venv" ]; then
  step "Creating backend venv"
  python3 -m venv "$BACKEND/.venv"
fi
PY="$BACKEND/.venv/bin/python"
if ! "$PY" -c "import fastapi" 2>/dev/null; then
  step "Installing backend dependencies"
  "$PY" -m pip install --upgrade pip --quiet
  "$PY" -m pip install --quiet -r "$BACKEND/requirements.txt"
fi

# ── Frontend bootstrap ──────────────────────────────────────────────────────────
if [ ! -d "$FRONTEND/node_modules" ]; then
  step "Installing frontend dependencies"
  (cd "$FRONTEND" && npm install --silent)
fi

# ── Free up ports ───────────────────────────────────────────────────────────────
for port in "$BACK_PORT" "$FRONT_PORT"; do
  pid="$(lsof -ti :"$port" 2>/dev/null || true)"
  if [ -n "$pid" ]; then
    warn "killing existing process on port $port (pid=$pid)"
    kill -9 $pid 2>/dev/null || true
  fi
done

# ── Cleanup handler ─────────────────────────────────────────────────────────────
BACK_PID=""
FRONT_PID=""
TAIL_PID=""
cleanup() {
  echo
  step "Shutting down"
  [ -n "$TAIL_PID"  ] && kill "$TAIL_PID"  2>/dev/null || true
  [ -n "$BACK_PID"  ] && kill "$BACK_PID"  2>/dev/null || true
  [ -n "$FRONT_PID" ] && kill "$FRONT_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# ── Absolute paths so uvicorn --reload's chdir doesn't break the data dir ───────
export DATA_DIR="$ROOT/data"
export DOWNLOAD_DIR="$ROOT/downloads"
export DB_PATH="$ROOT/data/ytarchiver.db"

# ── Start backend (bound to all interfaces so phone can hit /api/stream/* too) ──
step "Starting backend  on 0.0.0.0:${BACK_PORT}"
(
  cd "$BACKEND"
  exec "$BACKEND/.venv/bin/uvicorn" main:app \
    --host 0.0.0.0 --port "$BACK_PORT" --reload
) >"$LOGS/backend.log" 2>&1 &
BACK_PID=$!

# ── Start frontend (Vite needs --host to expose on LAN) ─────────────────────────
step "Starting frontend on 0.0.0.0:${FRONT_PORT}"
(
  cd "$FRONTEND"
  exec npm run dev --silent -- --host 0.0.0.0
) >"$LOGS/frontend.log" 2>&1 &
FRONT_PID=$!

# ── Wait for both ───────────────────────────────────────────────────────────────
wait_up() {
  local url="$1" name="$2"
  for _ in $(seq 1 40); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then return 0; fi
    sleep 0.5
  done
  warn "$name didn't respond at $url — see logs"
  return 1
}

wait_up "$BACK_URL/api/health" backend  || { tail -20 "$LOGS/backend.log";  cleanup; }
wait_up "$FRONT_URL"           frontend || { tail -20 "$LOGS/frontend.log"; cleanup; }

# ── Print URLs (local + LAN) ────────────────────────────────────────────────────
printf "\n\033[1;32m─── YT Archive is up ───\033[0m\n"
info "Local      → $FRONT_URL"
info "API docs   → $BACK_URL/docs"

# macOS still ships Bash 3.2 (no ``mapfile`` builtin) — use a portable loop.
IPS=()
while IFS= read -r _ip_line; do
  [ -n "$_ip_line" ] && IPS+=("$_ip_line")
done < <(lan_ips)

if [ "${#IPS[@]}" -eq 0 ]; then
  warn "no LAN IPv4 detected — phone won't be able to reach the server"
else
  printf "\n"
  for ip in "${IPS[@]}"; do
    info "On phone   → \033[1;36mhttp://${ip}:${FRONT_PORT}\033[0m"
  done
  info "(phone must be on the same Wi-Fi as this Mac)"
fi
printf "\nLogs: %s/  ·  Ctrl-C to stop\n" "$LOGS"

# ── Open browser locally ────────────────────────────────────────────────────────
if   command -v open      >/dev/null; then open      "$FRONT_URL"
elif command -v xdg-open  >/dev/null; then xdg-open  "$FRONT_URL"
else warn "couldn't auto-open browser — visit $FRONT_URL manually"
fi

tail -F "$LOGS/backend.log" "$LOGS/frontend.log" &
TAIL_PID=$!
wait "$TAIL_PID"
