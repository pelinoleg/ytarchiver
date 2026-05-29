import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from db.database import init_schema
from routers import channels, videos, settings_router, stream, ws, queue, history, manual, favorites, events, stats, playlists, maintenance, music, storage, search, backup, folders, variants
from services.scheduler import scheduler, configure_jobs
from services.worker import worker
from services.db_heal import ensure_healthy_db
from services.backup_job import backup_database


logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Self-heal must run before init_schema — schema migrations would crash on a
    # malformed file. ensure_healthy_db raises only when every recovery path
    # failed, in which case we want startup to abort loudly.
    ensure_healthy_db()
    init_schema()
    # Take an immediate backup so the very first scheduled snapshot isn't 24h
    # away on a freshly-started container. Best-effort, errors are logged.
    try:
        backup_database()
    except Exception:
        log.exception("startup backup failed (non-fatal)")
    configure_jobs()
    scheduler.start()
    await worker.start()
    log.info("YT Archiver up. db=%s downloads=%s", settings.db_path, settings.download_dir)
    try:
        yield
    finally:
        await worker.stop()
        scheduler.shutdown(wait=False)
        # Final shutdown snapshot — defends against the unlucky "container
        # restarted mid-WAL" path that triggered the 2026-05-29 corruption.
        try:
            backup_database()
        except Exception:
            log.exception("shutdown backup failed (non-fatal)")


app = FastAPI(title="YT Archiver", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(channels.router, prefix="/api/channels", tags=["channels"])
app.include_router(folders.router, prefix="/api/channel-folders", tags=["folders"])
app.include_router(videos.router, prefix="/api/videos", tags=["videos"])
app.include_router(queue.router, prefix="/api/queue", tags=["queue"])
app.include_router(history.router, prefix="/api/history", tags=["history"])
app.include_router(manual.router, prefix="/api/manual", tags=["manual"])
app.include_router(favorites.router, prefix="/api/favorites", tags=["favorites"])
app.include_router(events.router, prefix="/api/events", tags=["events"])
app.include_router(stats.router, prefix="/api/stats", tags=["stats"])
app.include_router(playlists.router, prefix="/api/playlists", tags=["playlists"])
app.include_router(music.router, prefix="/api/music", tags=["music"])
app.include_router(maintenance.router, prefix="/api/maintenance", tags=["maintenance"])
app.include_router(storage.router, prefix="/api/storage", tags=["storage"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(backup.router, prefix="/api/backup", tags=["backup"])
app.include_router(stream.router, prefix="/api/stream", tags=["stream"])
app.include_router(variants.router, prefix="/api", tags=["variants"])
app.include_router(settings_router.router, prefix="/api/settings", tags=["settings"])
app.include_router(ws.router)


@app.get("/api/health")
def health():
    return {"ok": True}
