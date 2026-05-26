"""Retention cleanup. Deletes downloaded videos older than retention_days."""
from __future__ import annotations

import logging
import shutil
from datetime import datetime
from pathlib import Path

from config import settings
from db.database import DB, get_connection


log = logging.getLogger(__name__)


def cleanup_expired() -> int:
    """Apply retention + watched-percent rules. Returns count deleted from disk."""
    conn = get_connection()
    try:
        kv = DB(conn).get_settings()
        global_ret  = int(kv.get("default_retention_days") or settings.default_retention_days or 0)
        watched_pct = int(kv.get("delete_after_watched_percent") or settings.delete_after_watched_percent or 0)

        rows = conn.execute(
            "SELECT v.id, v.video_id, v.channel_id, v.downloaded_at, v.keep_forever, "
            "       v.is_favorite, v.last_position_seconds, v.duration, c.retention_days "
            "FROM videos v JOIN channels c ON c.id = v.channel_id "
            "WHERE v.status = 'done' AND v.downloaded_at IS NOT NULL"
        ).fetchall()

        # Videos belonging to at least one playlist with keep_videos_forever=1
        # are immune to all cleanup rules, just like user-pinned ones.
        kept_by_playlist = {
            r["video_id"] for r in conn.execute(
                "SELECT DISTINCT pv.video_id FROM playlist_videos pv "
                "JOIN playlists p ON p.id = pv.playlist_id "
                "WHERE p.keep_videos_forever = 1"
            ).fetchall()
        }

        # Music videos are implicitly keep-forever — either flagged directly
        # or inherited from a music playlist.
        music_videos = {
            r["video_id"] for r in conn.execute(
                "SELECT video_id FROM videos WHERE is_music = 1 "
                "UNION "
                "SELECT pv.video_id FROM playlist_videos pv "
                "JOIN playlists p ON p.id = pv.playlist_id "
                "WHERE p.is_music = 1"
            ).fetchall()
        }

        now = datetime.utcnow()
        deleted = 0
        for r in rows:
            if r["keep_forever"] or r["is_favorite"]:
                continue  # user-pinned / favorited — never delete
            if r["video_id"] in kept_by_playlist:
                continue  # belongs to a "keep videos forever" playlist
            if r["video_id"] in music_videos:
                continue  # music — implicitly kept forever

            # Watched-percent rule
            if watched_pct > 0 and r["duration"] and r["last_position_seconds"]:
                try:
                    pct = (float(r["last_position_seconds"]) / float(r["duration"])) * 100.0
                except (TypeError, ZeroDivisionError):
                    pct = 0
                if pct >= watched_pct:
                    _soft_delete(conn, r, reason="watched")
                    deleted += 1
                    continue

            # Retention-days rule
            channel_ret = r["retention_days"]
            ret = channel_ret if channel_ret is not None else global_ret
            if ret == 0:
                continue
            try:
                dt = datetime.fromisoformat(r["downloaded_at"])
            except ValueError:
                continue
            if (now - dt).days < ret:
                continue

            _soft_delete(conn, r, reason="retention")
            deleted += 1

        conn.commit()
        log.info("cleanup: removed %d video(s)", deleted)
        return deleted
    finally:
        conn.close()


def _soft_delete(conn, row, *, reason: str) -> None:
    video_dir = Path(settings.download_dir) / str(row["channel_id"]) / row["video_id"]
    if video_dir.exists():
        shutil.rmtree(video_dir, ignore_errors=True)
    conn.execute(
        "UPDATE videos SET status = 'deleted', file_path = NULL, "
        "thumbnail_path = NULL, subtitle_path = NULL, info_path = NULL "
        "WHERE id = ?",
        (row["id"],),
    )
    # Denormalize title + channel name for the event log.
    extra = conn.execute(
        "SELECT v.title, c.name AS channel_name "
        "FROM videos v LEFT JOIN channels c ON c.id = v.channel_id "
        "WHERE v.id = ?",
        (row["id"],),
    ).fetchone()
    DB(conn).log_event(
        f"video_deleted_{reason}",
        video_id=row["video_id"],
        video_title=extra["title"] if extra else None,
        channel_id=row["channel_id"],
        channel_name=extra["channel_name"] if extra else None,
    )
