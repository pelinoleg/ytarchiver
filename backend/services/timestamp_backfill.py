"""Periodic backfill: read upload_timestamp out of existing info.json files
for videos that were downloaded before we started recording it."""
from __future__ import annotations

import json
import logging
from pathlib import Path

from db.database import get_connection


log = logging.getLogger(__name__)


def backfill_missing_timestamps(batch: int = 50) -> int:
    """Pick a batch of videos with missing upload_timestamp but an info.json on
    disk; read the file and fill the column. Returns count updated."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, info_path FROM videos "
            "WHERE upload_timestamp IS NULL AND info_path IS NOT NULL "
            "ORDER BY id DESC LIMIT ?",
            (batch,),
        ).fetchall()
    finally:
        conn.close()

    updates: list[tuple[int, int]] = []
    for r in rows:
        path = r["info_path"]
        if not path or not Path(path).exists():
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                info = json.load(f)
        except Exception:
            continue
        ts = info.get("timestamp") or info.get("release_timestamp")
        if ts is None:
            continue
        try:
            updates.append((int(ts), r["id"]))
        except (TypeError, ValueError):
            continue

    if not updates:
        return 0
    conn = get_connection()
    try:
        conn.executemany(
            "UPDATE videos SET upload_timestamp = ? WHERE id = ?",
            updates,
        )
        conn.commit()
    finally:
        conn.close()
    log.info("upload_timestamp backfill: filled %d row(s)", len(updates))
    return len(updates)
