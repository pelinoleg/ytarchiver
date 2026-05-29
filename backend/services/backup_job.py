"""In-process daily hot-backup of the SQLite DB.

Uses ``sqlite3.Connection.backup()`` (the online-backup API) so it's safe to
run while the worker writes. Output goes to ``<data_dir>/backups/`` as
gzipped snapshots, retained for ``BACKUP_RETENTION_DAYS`` (14).

This is intentionally independent from any host-level cron — the container
can be moved to another host (different OS, no cron) and backups keep
happening. Pairs with :mod:`services.db_heal` which reads from the same
directory on startup.
"""
from __future__ import annotations

import gzip
import logging
import shutil
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

from config import settings


log = logging.getLogger(__name__)


BACKUP_RETENTION_DAYS = 14


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
