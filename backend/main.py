import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from db.database import init_schema
from routers import channels, videos, settings_router, stream, ws, queue, history, manual, favorites, events, stats, playlists, maintenance, music, storage, search, backup, folders, variants, previews, music_collections, cookies, yt_import, vpn
from services.scheduler import scheduler, configure_jobs
from services.worker import worker
from services.db_heal import ensure_healthy_db
from services.backup_job import backup_database, auto_config_backup


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
    # Refresh the JSON config snapshot too, so the Settings UI shows a backup
    # right away on a fresh install instead of "none yet" for up to a day.
    try:
        auto_config_backup()
    except Exception:
        log.exception("startup config backup failed (non-fatal)")
    configure_jobs()
    scheduler.start()
    # Folder-driven WireGuard exit pool (no-op unless WIREGUARD_CONFIGS_DIR set).
    try:
        from services import vpn_supervisor
        vpn_supervisor.start()
    except Exception:
        log.exception("vpn supervisor failed to start (non-fatal)")
    await worker.start()
    log.info("YT Archiver up. db=%s downloads=%s", settings.db_path, settings.download_dir)
    try:
        yield
    finally:
        try:
            from services import vpn_supervisor
            vpn_supervisor.stop()
        except Exception:
            pass
        await worker.stop()
        # shutdown(wait=False) cancels any in-flight async job; APScheduler logs
        # that cancellation as an ERROR-with-traceback ("Error running job
        # sync-all-channels … CancelledError"). It's benign — those jobs are
        # idempotent and resume next tick — but the noise masks real errors, so
        # quiet the executor logger for the teardown.
        logging.getLogger("apscheduler.executors.default").setLevel(logging.CRITICAL)
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
app.include_router(music_collections.router, prefix="/api/music/collections", tags=["music"])
app.include_router(previews.router, prefix="/api/previews", tags=["previews"])
app.include_router(cookies.router, prefix="/api/cookies", tags=["cookies"])
app.include_router(yt_import.router, prefix="/api/yt-import", tags=["import"])
app.include_router(maintenance.router, prefix="/api/maintenance", tags=["maintenance"])
app.include_router(storage.router, prefix="/api/storage", tags=["storage"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(backup.router, prefix="/api/backup", tags=["backup"])
app.include_router(stream.router, prefix="/api/stream", tags=["stream"])
app.include_router(variants.router, prefix="/api", tags=["variants"])
app.include_router(settings_router.router, prefix="/api/settings", tags=["settings"])
app.include_router(vpn.router, prefix="/api/vpn", tags=["vpn"])
app.include_router(ws.router)


@app.get("/api/health")
def health():
    return {"ok": True}
