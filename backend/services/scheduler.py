"""APScheduler setup. Periodic channel sync + (later) cleanup + yt-dlp update."""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from config import settings
from db.database import DB, get_connection
from services import (
    sync, sponsorblock, cleanup, ytdlp_updater,
    preview as preview_service,
    timestamp_backfill,
    subtitles_index,
    integrity,
    error_retry,
    backup_job,
)


log = logging.getLogger(__name__)


scheduler = AsyncIOScheduler()


def _sync_all_channels_job() -> None:
    """Tick: run sync for any channel whose effective interval has elapsed.

    Per-channel ``sync_interval_minutes`` overrides the global default. We
    never sync more often than the channel asks for — the global tick fires
    more frequently than any channel, this function is the gate.
    """
    from datetime import datetime, timedelta

    conn = get_connection()
    db = DB(conn)
    try:
        kv = db.get_settings()
        try:
            global_interval = int(kv.get("sync_interval_minutes") or settings.sync_interval_minutes)
        except (TypeError, ValueError):
            global_interval = settings.sync_interval_minutes

        channels = db.list_channels()
        now = datetime.utcnow()
        ran = 0
        for ch in channels:
            # Effective interval: per-channel override → global setting.
            ch_interval = ch["sync_interval_minutes"]
            interval = ch_interval if ch_interval is not None else global_interval
            interval = max(1, int(interval))
            # Compute due time relative to last_synced.
            last = ch["last_synced"]
            if last:
                try:
                    last_dt = datetime.fromisoformat(last)
                except ValueError:
                    last_dt = None
                if last_dt and now - last_dt < timedelta(minutes=interval):
                    continue  # not due yet
            try:
                sync.sync_channel(db, ch["id"])
                ran += 1
            except Exception as e:
                log.exception("scheduler: failed to sync channel %s", ch["id"])
                try:
                    conn.execute(
                        "UPDATE channels SET last_sync_error = ?, last_synced = ? WHERE id = ?",
                        (str(e)[:500], now.isoformat(), ch["id"]),
                    )
                    conn.commit()
                except Exception:
                    log.exception("scheduler: failed to record sync error for %s", ch["id"])
        log.info("scheduler tick: ran %d/%d channels", ran, len(channels))
    finally:
        conn.close()


def configure_jobs() -> None:
    if scheduler.get_jobs():
        return
    # The scheduler heartbeat is decoupled from per-channel interval. The
    # tick fires every few minutes; the job itself iterates channels and
    # only syncs the ones whose effective interval has elapsed.
    scheduler.add_job(
        _sync_all_channels_job,
        trigger=IntervalTrigger(minutes=5, jitter=60),
        id="sync-all-channels",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        sponsorblock.refresh_recent_videos,
        trigger=IntervalTrigger(hours=24, jitter=3600),
        id="sponsorblock-refresh",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    # Cleanup runs hourly — frequent enough that a "delete after 80% watched"
    # rule kicks in within an hour of crossing the threshold, but cheap (it's
    # a single SQL pass + a few file deletes when matches happen).
    scheduler.add_job(
        cleanup.cleanup_expired,
        trigger=IntervalTrigger(hours=1, jitter=120),
        id="retention-cleanup",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        ytdlp_updater.update_ytdlp,
        trigger=IntervalTrigger(days=7, jitter=3600),
        id="ytdlp-update",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        preview_service.backfill_missing_previews,
        trigger=IntervalTrigger(minutes=15, jitter=120),
        id="preview-backfill",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        timestamp_backfill.backfill_missing_timestamps,
        trigger=IntervalTrigger(minutes=5, jitter=30),
        id="upload-timestamp-backfill",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.add_job(
        subtitles_index.backfill_missing,
        trigger=IntervalTrigger(minutes=10, jitter=60),
        id="subtitles-backfill",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    # Weekly integrity sweep — find videos whose file_path no longer exists on
    # disk (user nuked them from Finder, mount disappeared, etc.) and mark
    # them deleted so the next sync re-downloads if the channel is active.
    scheduler.add_job(
        integrity.check_integrity,
        trigger=IntervalTrigger(days=7, jitter=3600),
        id="disk-integrity",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    # Re-queue non-permanent error videos every 30 min — flaky network or
    # transient YT rate limiting gets a fresh shot without manual retry.
    scheduler.add_job(
        error_retry.sweep_failed,
        trigger=IntervalTrigger(minutes=30, jitter=300),
        id="error-retry-sweep",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    # Daily hot-backup of the SQLite DB. Uses the online-backup API so it
    # runs safely while the worker writes. Pairs with services.db_heal which
    # auto-restores from these snapshots on a malformed-DB startup.
    scheduler.add_job(
        backup_job.backup_database,
        trigger=IntervalTrigger(days=1, jitter=900),
        id="db-backup",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        next_run_time=None,
    )
    log.info(
        "scheduler: sync every %d min (+/- %d) · sponsorblock 24h · cleanup 24h · yt-dlp update 7d",
        settings.sync_interval_minutes, settings.sync_jitter_minutes,
    )
