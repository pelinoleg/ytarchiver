"""Keep yt-dlp current. Runs ``pip install -U yt-dlp`` in a subprocess."""
from __future__ import annotations

import logging
import subprocess
import sys


log = logging.getLogger(__name__)


def update_ytdlp() -> bool:
    cmd = [sys.executable, "-m", "pip", "install", "-U", "--quiet", "yt-dlp"]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        log.warning("yt-dlp update: timed out")
        return False
    except Exception:
        log.exception("yt-dlp update: failed to spawn")
        return False

    ok = result.returncode == 0
    if ok:
        log.info("yt-dlp update: ok")
    else:
        log.warning("yt-dlp update: rc=%d stderr=%s", result.returncode, result.stderr[-500:])
    try:
        from db.database import DB, get_connection
        conn = get_connection()
        try:
            DB(conn).log_event(
                "ytdlp_updated" if ok else "ytdlp_update_failed",
                message=None if ok else (result.stderr or "")[-300:],
            )
        finally:
            conn.close()
    except Exception:
        log.exception("yt-dlp update: failed to log event")
    return ok
