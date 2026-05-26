"""Disk integrity check.

Walks every ``status='done'`` video and verifies its ``file_path`` exists on
disk. Anything missing (user nuked from Finder, disk reformatted, mount
disappeared, etc.) gets moved to ``status='deleted'`` with a logged event so
the regular sync pipeline can re-download it next tick if the channel is
still active.

Runs:
  * weekly via APScheduler
  * on demand via POST /api/maintenance/integrity
"""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

from db.database import DB, get_connection


log = logging.getLogger(__name__)


def check_integrity() -> dict:
    """Single-pass file existence check. Returns a small report dict."""
    conn = get_connection()
    db = DB(conn)
    try:
        rows = conn.execute(
            "SELECT id, video_id, channel_id, title, file_path "
            "FROM videos WHERE status = 'done' AND file_path IS NOT NULL"
        ).fetchall()

        checked = len(rows)
        missing: list[dict] = []
        for r in rows:
            p = r["file_path"]
            if p and Path(p).exists():
                continue
            # File is gone — mark deleted and log.
            conn.execute(
                "UPDATE videos SET status = 'deleted', file_path = NULL, "
                "  thumbnail_path = NULL, subtitle_path = NULL, info_path = NULL "
                "WHERE id = ?",
                (r["id"],),
            )
            db.log_event(
                "video_missing_on_disk",
                message=f"file gone: {p}",
                video_id=r["video_id"],
                video_title=r["title"],
                channel_id=r["channel_id"],
            )
            missing.append({"video_id": r["video_id"], "title": r["title"], "path": p})
        conn.commit()

        report = {
            "checked":  checked,
            "missing":  len(missing),
            "ran_at":   datetime.utcnow().isoformat(),
            "missing_sample": missing[:25],   # cap so the JSON doesn't explode
        }
        db.set_settings({
            "integrity_last_ran_at":  report["ran_at"],
            "integrity_last_checked": str(checked),
            "integrity_last_missing": str(len(missing)),
        })
        log.info("integrity: %d checked, %d missing", checked, len(missing))
        return report
    finally:
        conn.close()
