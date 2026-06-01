"""In-process daily backups.

Two independent snapshots live side-by-side in ``<data_dir>/backups/``:

* **DB hot-backup** — full gzipped SQLite snapshots via
  ``sqlite3.Connection.backup()`` (the online-backup API, safe while the worker
  writes), retained for ``BACKUP_RETENTION_DAYS`` (7: latest + a week to roll
  back to). Pairs with :mod:`services.db_heal` which auto-restores from these.
* **Config backup** — a single JSON dump of subscriptions / playlists / folders
  / settings (same shape as the manual ``/api/backup/export``), overwritten in
  place so only the latest copy is ever kept. Surfaced in the Settings UI with
  download + restore.

This is intentionally independent from any host-level cron — the container
can be moved to another host (different OS, no cron) and backups keep happening.
"""
from __future__ import annotations

import gzip
import json
import logging
import os
import shutil
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

from config import settings


log = logging.getLogger(__name__)


# Latest + a week of daily snapshots to roll back to.
BACKUP_RETENTION_DAYS = 7


def backup_database() -> Path | None:
    """Create one gzipped snapshot. Returns the snapshot path or None on failure."""
    db_path = Path(settings.db_path)
    if not db_path.exists():
        log.warning("backup: source DB missing at %s", db_path)
        return None
    out_dir = Path(settings.data_dir) / "backups"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    raw_target = out_dir / f"ytarchiver-{stamp}.db"
    gz_target = raw_target.with_suffix(raw_target.suffix + ".gz")

    src = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    dst = sqlite3.connect(str(raw_target))
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()

    # Sanity-check the snapshot before keeping it.
    check = sqlite3.connect(str(raw_target))
    try:
        row = check.execute("PRAGMA quick_check").fetchone()
        if not row or str(row[0]).strip().lower() != "ok":
            log.error("backup: snapshot failed quick_check, discarding: %s", raw_target)
            raw_target.unlink(missing_ok=True)
            return None
    finally:
        check.close()

    with open(raw_target, "rb") as f_in, gzip.open(gz_target, "wb", compresslevel=6) as f_out:
        shutil.copyfileobj(f_in, f_out)
    raw_target.unlink(missing_ok=True)

    _prune_old_backups(out_dir)
    size_kb = gz_target.stat().st_size / 1024
    log.info("backup: wrote %s (%.0f KB)", gz_target.name, size_kb)
    return gz_target


def _prune_old_backups(out_dir: Path) -> None:
    cutoff = time.time() - BACKUP_RETENTION_DAYS * 86400
    for f in out_dir.glob("ytarchiver-*.db.gz"):
        try:
            if f.stat().st_mtime < cutoff:
                f.unlink()
        except OSError:
            pass


# ── Config backup (JSON dump of subscriptions / playlists / folders / settings) ──
#
# Same payload as the manual ``/api/backup/export`` route, but written to disk on
# a daily schedule. Only the latest copy is kept — the file is overwritten in
# place — because re-syncing from a stale config is rarely useful and the live DB
# hot-backup above already covers point-in-time rollback.

EXPORT_VERSION = 2
AUTO_CONFIG_FILENAME = "auto-config-backup.json"


def _channel_export(row, folder_name_by_id: dict[int, str]) -> dict:
    folder = folder_name_by_id.get(row["folder_id"]) if row["folder_id"] else None
    return {
        "url":                   row["url"],
        "name":                  row["name"],
        "thumbnail_url":         row["thumbnail_url"],
        "subscriber_count":      row["subscriber_count"],
        "download_policy":       row["download_policy"],
        "quality":               row["quality"],
        "retention_days":        row["retention_days"],
        "sync_interval_minutes": row["sync_interval_minutes"],
        "show_on_home":          bool(row["show_on_home"]),
        "latest_count":          row["latest_count"],
        "download_from_date":    row["download_from_date"],
        "folder":                folder,
    }


def _playlist_export(row) -> dict:
    return {
        "url":                 row["url"],
        "title":               row["title"],
        "thumbnail_url":       row["thumbnail_url"],
        "uploader":            row["uploader"],
        "video_count":         row["video_count"],
        "quality":             row["quality"],
        "retention_days":      row["retention_days"],
        "keep_videos_forever": bool(row["keep_videos_forever"]),
        "is_music":            bool(row["is_music"]),
    }


def build_config_payload(db) -> dict:
    """Build the export dict shared by the manual route and the auto-backup job.

    Videos and history are intentionally excluded — they're recoverable by
    re-running sync after a restore.
    """
    folders = list(db.list_channel_folders())
    folder_name_by_id = {r["id"]: r["name"] for r in folders}
    channels = [_channel_export(r, folder_name_by_id) for r in db.list_channels()]
    playlists = [
        _playlist_export(r)
        for r in db.conn.execute("SELECT * FROM playlists ORDER BY id").fetchall()
    ]
    return {
        "version":     EXPORT_VERSION,
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "folders":     [{"name": r["name"], "position": r["position"]} for r in folders],
        "channels":    channels,
        "playlists":   playlists,
        "settings":    db.get_settings(),
    }


def auto_config_path() -> Path:
    return Path(settings.data_dir) / "backups" / AUTO_CONFIG_FILENAME


def auto_config_backup() -> Path | None:
    """Write the latest config snapshot, overwriting the single previous copy.

    Opens its own read connection (called from the scheduler / lifespan, away
    from a request) and writes atomically via a temp file + rename so a crash
    mid-write can never leave a truncated backup.
    """
    from db.database import DB, get_connection

    conn = get_connection()
    try:
        payload = build_config_payload(DB(conn))
    finally:
        conn.close()

    target = auto_config_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.parent / (target.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp, target)  # atomic on POSIX
    log.info(
        "config-backup: wrote %s (%d channels, %d playlists)",
        target.name, len(payload["channels"]), len(payload["playlists"]),
    )
    return target


def read_auto_config() -> dict | None:
    """Parse the latest config backup, or None if it doesn't exist / is unreadable."""
    p = auto_config_path()
    if not p.exists():
        return None
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        log.exception("config-backup: failed to read %s", p)
        return None
