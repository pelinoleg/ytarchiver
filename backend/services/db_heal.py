"""DB corruption self-heal — runs at startup before ``init_schema``.

Strategy (first wins):

1. ``PRAGMA quick_check`` — if it returns "ok" the DB is fine, return.
2. Try to restore from the newest backup in ``<data_dir>/backups/*.db.gz``
   (created by :mod:`services.backup_job`). The backup is gunzipped, its
   integrity verified, then swapped in.
3. Fall back to ``sqlite3 .recover`` via subprocess — best-effort dump of
   recoverable rows. Loses anything in malformed btree pages but keeps
   the bulk of the data.

In either restore path the malformed file is renamed to
``ytarchiver.db.malformed.<timestamp>`` so the user can inspect it later.
If none of the strategies work, the function logs CRITICAL and re-raises —
better to fail startup loudly than to silently boot with an empty DB and
have the worker overwrite the user's queue.
"""
from __future__ import annotations

import gzip
import logging
import shutil
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from config import settings


log = logging.getLogger(__name__)


BACKUP_GLOB = "ytarchiver-*.db.gz"


def ensure_healthy_db() -> None:
    db_path = Path(settings.db_path)
    if not db_path.exists():
        return  # fresh install — init_schema will create it
    try:
        if _quick_check(db_path):
            return
    except sqlite3.DatabaseError:
        log.exception("db_heal: quick_check raised — treating as corrupt")
    log.critical("db_heal: SQLite DB at %s is malformed — attempting self-heal", db_path)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    quarantine = db_path.with_suffix(db_path.suffix + f".malformed.{stamp}")

    if _try_restore_from_backup(db_path, quarantine):
        log.warning("db_heal: restored from backup — corrupt copy at %s", quarantine)
        return

    if _try_recover_cli(db_path, quarantine):
        log.warning("db_heal: recovered via sqlite3 .recover — corrupt copy at %s", quarantine)
        return

    log.critical("db_heal: all recovery paths failed — leaving %s in place", db_path)
    raise RuntimeError(
        f"SQLite DB at {db_path} is malformed and no backup or .recover succeeded. "
        f"Inspect the file manually before restarting."
    )


def _quick_check(db_path: Path) -> bool:
    """Cheap structural check — much faster than full ``integrity_check``."""
    conn = sqlite3.connect(str(db_path))
    try:
        result = conn.execute("PRAGMA quick_check").fetchone()
        return bool(result and str(result[0]).strip().lower() == "ok")
    finally:
        conn.close()


def _try_restore_from_backup(db_path: Path, quarantine: Path) -> bool:
    """Pick the newest verified-good backup and swap it in. Returns False if
    no backup exists or none passes its own quick_check."""
    backups_dir = Path(settings.data_dir) / "backups"
    if not backups_dir.is_dir():
        return False
    candidates = sorted(backups_dir.glob(BACKUP_GLOB), key=lambda p: p.stat().st_mtime, reverse=True)
    for src in candidates:
        try:
            scratch = db_path.with_suffix(db_path.suffix + ".restore.tmp")
            with gzip.open(src, "rb") as f_in, open(scratch, "wb") as f_out:
                shutil.copyfileobj(f_in, f_out)
            if not _quick_check(scratch):
                log.warning("db_heal: backup %s failed quick_check, trying older", src.name)
                scratch.unlink(missing_ok=True)
                continue
            # Swap: malformed → quarantine, restored → live path.
            shutil.move(str(db_path), str(quarantine))
            for sidecar in (".wal", ".shm"):
                p = db_path.with_suffix(db_path.suffix + sidecar)
                if p.exists():
                    p.unlink()
            shutil.move(str(scratch), str(db_path))
            log.info("db_heal: restored from %s", src.name)
            return True
        except Exception:
            log.exception("db_heal: restore attempt from %s failed", src)
    return False


def _try_recover_cli(db_path: Path, quarantine: Path) -> bool:
    """Last resort: shell out to the sqlite3 CLI's ``.recover`` and re-load
    the dump into a fresh DB. Requires sqlite3 in the container (installed
    by the Dockerfile)."""
    if shutil.which("sqlite3") is None:
        log.error("db_heal: sqlite3 CLI not on PATH — cannot run .recover")
        return False
    scratch = db_path.with_suffix(db_path.suffix + ".recover.tmp")
    scratch.unlink(missing_ok=True)
    try:
        dump = subprocess.run(
            ["sqlite3", str(db_path), ".recover"],
            capture_output=True, check=False, text=True, timeout=600,
        )
        if dump.returncode != 0 and not dump.stdout:
            log.error("db_heal: .recover produced no output: %s", dump.stderr[:500])
            return False
        load = subprocess.run(
            ["sqlite3", str(scratch)],
            input=dump.stdout, capture_output=True, check=False, text=True, timeout=600,
        )
        # .recover dumps include statements that touch sqlite_master directly,
        # which sqlite3 rejects with a parse error — that's fine, the rest of
        # the dump still loads. Verify the result instead of trusting rc.
        if not _quick_check(scratch):
            log.error("db_heal: recovered DB still fails quick_check; rc=%d stderr=%s",
                      load.returncode, load.stderr[:500])
            scratch.unlink(missing_ok=True)
            return False
        shutil.move(str(db_path), str(quarantine))
        for sidecar in (".wal", ".shm"):
            p = db_path.with_suffix(db_path.suffix + sidecar)
            if p.exists():
                p.unlink()
        shutil.move(str(scratch), str(db_path))
        return True
    except Exception:
        log.exception("db_heal: .recover pipeline raised")
        scratch.unlink(missing_ok=True)
        return False
