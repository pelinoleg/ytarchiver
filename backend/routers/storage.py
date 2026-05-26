"""Storage dashboard endpoints — biggest videos, biggest channels, old
watched candidates, and aggregate numbers for the header.
"""
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends

from config import settings as env_settings
from db.database import DB, get_db
from models import VideoOut


router = APIRouter()


@router.get("/summary")
def summary(db: DB = Depends(get_db)):
    return db.storage_summary()


@router.get("/largest-videos", response_model=list[VideoOut])
def largest_videos(limit: int = 30, db: DB = Depends(get_db)):
    return [VideoOut.from_row(r) for r in db.list_largest_videos(limit=limit)]


@router.get("/largest-channels")
def largest_channels(limit: int = 15, db: DB = Depends(get_db)):
    return [dict(r) for r in db.list_largest_channels(limit=limit)]


@router.get("/old-watched", response_model=list[VideoOut])
def old_watched(min_days: int = 30, limit: int = 50, db: DB = Depends(get_db)):
    return [VideoOut.from_row(r) for r in db.list_old_watched(min_days=min_days, limit=limit)]


@router.get("/growth")
def growth(weeks: int = 12, db: DB = Depends(get_db)):
    """Weekly downloaded-bytes histogram for the last ``weeks`` weeks.

    Buckets are anchored on Monday so the chart aligns with calendar weeks
    regardless of which day the user opens the page. Returns a flat list —
    the frontend chart treats absent weeks as zero.
    """
    weeks = max(1, min(52, int(weeks)))
    rows = db.conn.execute(
        """
        SELECT
          date(downloaded_at, 'weekday 1', '-7 days') AS week_start,
          COUNT(*)                                    AS videos,
          COALESCE(SUM(file_size_bytes), 0)           AS bytes
        FROM videos
        WHERE status = 'done'
          AND downloaded_at IS NOT NULL
          AND downloaded_at >= datetime('now', ?)
        GROUP BY week_start
        ORDER BY week_start
        """,
        (f"-{weeks * 7} days",),
    ).fetchall()
    return {"weeks": [dict(r) for r in rows]}


@router.get("/resolution-breakdown")
def resolution_breakdown(db: DB = Depends(get_db)):
    """Counts + bytes per resolution bucket. Useful proxy for "how much of
    the library is HD vs SD" without having to ffprobe every file. Resolutions
    > 1080p are the ones YouTube serves only as VP9 / AV1 — so this also
    doubles as a codec hint for the bulk re-download action."""
    rows = db.conn.execute(
        """
        SELECT
          CASE
            WHEN quality IS NULL OR quality = ''   THEN 'unknown'
            WHEN CAST(quality AS INTEGER) >= 2160  THEN '2160p'
            WHEN CAST(quality AS INTEGER) >= 1440  THEN '1440p'
            WHEN CAST(quality AS INTEGER) >= 1080  THEN '1080p'
            WHEN CAST(quality AS INTEGER) >=  720  THEN '720p'
            WHEN CAST(quality AS INTEGER) >=  480  THEN '480p'
            ELSE                                        '≤360p'
          END                                        AS bucket,
          COUNT(*)                                   AS videos,
          COALESCE(SUM(file_size_bytes), 0)          AS bytes
        FROM videos
        WHERE status = 'done'
        GROUP BY bucket
        ORDER BY MIN(CAST(NULLIF(quality, '') AS INTEGER)) DESC
        """,
    ).fetchall()
    return {"buckets": [dict(r) for r in rows]}


@router.get("/cleanup-stats")
def cleanup_stats(days: int = 30, db: DB = Depends(get_db)):
    """How much the cleanup job has reclaimed lately. Driven by events of
    type 'video_deleted_*'. We don't have the bytes-at-time-of-delete (they
    were nulled when the row was soft-deleted), so this is a count-only
    metric for now."""
    days = max(1, min(365, int(days)))
    row = db.conn.execute(
        """
        SELECT type, COUNT(*) AS n
        FROM events
        WHERE type LIKE 'video_deleted%'
          AND created_at >= datetime('now', ?)
        GROUP BY type
        ORDER BY n DESC
        """,
        (f"-{days} days",),
    ).fetchall()
    return {"days": days, "by_type": [dict(r) for r in row]}


# ─────────────────────────────────────────────────────────────────────────────
# Bulk re-download — utility for the "everything's AV1 and broken on iOS"
# situation. We can't ffprobe every file to know the codec without a slow
# scan, so we use the YouTube fact that videos > 1080p height are NEVER
# H.264 (YouTube only serves H.264 up to 1080p). That makes "quality > 1080"
# a high-confidence proxy for "not playable on iOS Safari < 17".

@router.get("/non-h264-count")
def non_h264_count(db: DB = Depends(get_db)):
    """How many videos in the library are likely non-H.264. Used by the
    Storage page to surface the bulk action only when there's something
    to actually do."""
    row = db.conn.execute(
        """
        SELECT COUNT(*) AS n,
               COALESCE(SUM(file_size_bytes), 0) AS bytes
        FROM videos
        WHERE status = 'done'
          AND quality IS NOT NULL
          AND CAST(quality AS INTEGER) > 1080
        """,
    ).fetchone()
    return {"count": row["n"], "bytes": row["bytes"]}


@router.get("/orphans")
def list_orphans(db: DB = Depends(get_db)):
    """Videos that lost their home — no playlist, no subscribed channel,
    not a manual download. Usually leftovers from past playlist unsubscribes
    that pre-date the auto-cleanup on delete. The Storage page surfaces them
    so the user can find and remove what's invisible everywhere else.
    """
    rows = db.conn.execute(
        """
        SELECT v.*, c.name AS channel_name, c.thumbnail_url AS channel_thumbnail
        FROM videos v
        LEFT JOIN channels c ON c.id = v.channel_id
        WHERE COALESCE(c.is_subscribed, 0) = 0
          AND c.yt_channel_id IS NOT '__manual__'
          AND NOT EXISTS (
            SELECT 1 FROM playlist_videos pv WHERE pv.video_id = v.video_id
          )
        ORDER BY v.added_at DESC
        """
    ).fetchall()
    return [VideoOut.from_row(r) for r in rows]


@router.post("/purge-orphans")
def purge_orphans(db: DB = Depends(get_db)):
    """Delete every orphan video: cancel queue-side, wipe files for done,
    drop the DB rows. Returns counts for a toast."""
    rows = db.conn.execute(
        """
        SELECT v.id, v.video_id, v.channel_id, v.status
        FROM videos v
        LEFT JOIN channels c ON c.id = v.channel_id
        WHERE COALESCE(c.is_subscribed, 0) = 0
          AND c.yt_channel_id IS NOT '__manual__'
          AND NOT EXISTS (
            SELECT 1 FROM playlist_videos pv WHERE pv.video_id = v.video_id
          )
        """
    ).fetchall()
    base = Path(env_settings.download_dir).expanduser().resolve()
    cancelled = 0
    purged = 0
    for v in rows:
        if v["status"] in ("done", "downloading"):
            vid_dir = base / str(v["channel_id"]) / v["video_id"]
            if vid_dir.exists():
                shutil.rmtree(vid_dir, ignore_errors=True)
            purged += 1
        else:
            cancelled += 1
        db.conn.execute("DELETE FROM videos WHERE id = ?", (v["id"],))
    db.conn.commit()
    if cancelled or purged:
        db.log_event(
            "orphans_purged",
            message=f"Purged {len(rows)} orphan videos (cancelled {cancelled}, deleted files {purged})",
        )
    return {"cancelled": cancelled, "purged": purged}


@router.post("/redownload-non-h264")
def redownload_non_h264(db: DB = Depends(get_db)):
    """Wipe-and-requeue every >1080p video so the worker re-fetches them
    with the current H.264-preferring format string. Returns how many rows
    were touched.

    Same wipe semantics as the single-video ``/api/videos/{id}/redownload``
    endpoint: files removed from disk, paths nulled, retry_count reset.
    """
    rows = db.conn.execute(
        """
        SELECT video_id, channel_id, title
        FROM videos
        WHERE status = 'done'
          AND quality IS NOT NULL
          AND CAST(quality AS INTEGER) > 1080
        """,
    ).fetchall()
    queued = 0
    base = Path(env_settings.download_dir).expanduser().resolve()
    for r in rows:
        vid_dir = base / str(r["channel_id"]) / r["video_id"]
        if vid_dir.exists():
            shutil.rmtree(vid_dir, ignore_errors=True)
        db.update_video_fields(r["video_id"], {
            "file_path": None,
            "thumbnail_path": None,
            "subtitle_path": None,
            "preview_path": None,
            "info_path": None,
            "file_size_bytes": None,
            "error_message": None,
            "progress": None,
            "retry_count": 0,
        })
        db.set_video_status(r["video_id"], "pending")
        queued += 1
    if queued:
        db.log_event(
            "bulk_redownload_requested",
            message=f"Re-download {queued} non-H.264 videos",
        )
    return {"queued": queued}
