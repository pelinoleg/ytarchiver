"""Audio-only sidecar extraction for the music player.

Pulls just the audio track out of an already-downloaded mp4 into a small ``.m4a``
next to it, so the player can stream audio instead of video and save bandwidth
on cellular. ``-c:a copy`` is instant and lossless when the source is AAC (the
usual case); we fall back to a light AAC re-encode otherwise.

Independent from the preview generator but follows the same shape: an on-demand
``extract_audio_for_video`` plus a throttled backfill the scheduler runs.
"""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from config import settings
from db.database import DB, IS_MUSIC_SQL, get_connection


log = logging.getLogger(__name__)


AUDIO_FILENAME = "audio.m4a"
AUDIO_TIMEOUT  = 300       # copy is near-instant; re-encode of a long file needs headroom
MAX_AUDIO_ATTEMPTS = 3     # backfill gives up after this many failures per file


def _extract(src: str, out: str) -> bool:
    """Try a stream copy first (instant, lossless); fall back to AAC re-encode."""
    base = ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-y", "-i", src, "-vn", "-movflags", "+faststart"]
    attempts = [
        base + ["-c:a", "copy", out],
        base + ["-c:a", "aac", "-b:a", "160k", out],
    ]
    for cmd in attempts:
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=AUDIO_TIMEOUT, text=True)
        except subprocess.TimeoutExpired:
            log.warning("audio: timed out for %s", src)
            continue
        except Exception:
            log.exception("audio: failed to spawn ffmpeg for %s", src)
            return False
        if r.returncode == 0 and Path(out).exists() and Path(out).stat().st_size > 1024:
            return True
        log.warning("audio: ffmpeg rc=%d (%s) %s", r.returncode, cmd[-2], (r.stderr or "")[-200:])
    return False


def extract_audio_for_video(video_id: str) -> bool:
    """Locate the video, extract its audio sidecar, record the path. Safe to call
    from the scheduler, a background task, or the stream endpoint."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT file_path, audio_path FROM videos WHERE video_id = ?", (video_id,),
        ).fetchone()
    finally:
        conn.close()
    if not row or not row["file_path"]:
        return False
    # Already done and on disk → nothing to do.
    if row["audio_path"] and Path(row["audio_path"]).exists():
        return True
    src = Path(row["file_path"])
    if not src.exists():
        return False
    out = src.parent / AUDIO_FILENAME
    if not _extract(str(src), str(out)):
        return False
    conn = get_connection()
    try:
        DB(conn).update_video_fields(video_id, {"audio_path": str(out)})
    finally:
        conn.close()
    log.info("audio: extracted %s (%d KB)", out, out.stat().st_size // 1024)
    return True


def backfill_missing_audio(batch: int = 4) -> int:
    """Periodic job — extract audio sidecars for music videos that lack one.
    Scoped to music (the only place the audio-only toggle applies) so we don't
    duplicate every video on disk."""
    conn = get_connection()
    try:
        rows = conn.execute(
            f"SELECT v.video_id FROM videos v "
            f"WHERE v.status = 'done' AND v.file_path IS NOT NULL "
            f"  AND v.audio_path IS NULL AND {IS_MUSIC_SQL} "
            f"ORDER BY v.downloaded_at DESC LIMIT ?",
            (batch,),
        ).fetchall()
    finally:
        conn.close()
    built = 0
    for r in rows:
        if extract_audio_for_video(r["video_id"]):
            built += 1
    if built:
        log.info("audio backfill: extracted %d/%d", built, len(rows))
    return built
