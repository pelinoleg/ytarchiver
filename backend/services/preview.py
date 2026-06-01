"""Hover-preview generator. Builds a tiny MP4 with ~12 short clips taken from
evenly-spread points of the source video — YouTube-style mosaic-of-moments.

Result: ~12 seconds total, 320x180, no audio, ~1–2 MB per file.
"""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from typing import Optional

from config import settings
from db.database import DB, get_connection


log = logging.getLogger(__name__)


def _kv_int(key: str, default: int) -> int:
    conn = get_connection()
    try:
        raw = DB(conn).get_settings().get(key)
    finally:
        conn.close()
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


PREVIEW_SEGMENTS  = 12
PREVIEW_SEG_LEN   = 1.0    # seconds per clip
PREVIEW_WIDTH     = 480    # cards are ~320-360px wide, 480 looks crisp on retina
PREVIEW_CRF       = 27     # 23 = visually lossless, 28 = small. 27 = balance
PREVIEW_FPS       = 18
PREVIEW_TIMEOUT   = 900    # seconds; long videos on CPU-capped Pi need >180. Overridable via the preview_timeout setting.
PREVIEW_FILENAME  = "preview.mp4"
MIN_DURATION      = 30     # don't bother for very short videos
# Give up auto-retrying after this many failed attempts so the backfill loop
# stops hammering a permanently-broken file. The Previews page can still force
# a manual retry, which resets the counter.
MAX_PREVIEW_ATTEMPTS = 3


def make_preview(
    video_path: str, output_path: str, duration_seconds: Optional[float],
) -> tuple[bool, Optional[str]]:
    """Run ffmpeg to build a hover-preview clip.

    Returns ``(True, None)`` on success or ``(False, reason)`` on failure, where
    ``reason`` is a short human-readable string recorded against the video so the
    Previews page can show *why* it failed.
    """
    if not duration_seconds or duration_seconds < MIN_DURATION:
        return False, f"too short (<{MIN_DURATION}s)"

    # Knobs are overridable from the Settings KV (Advanced section).
    width    = _kv_int("preview_width",    PREVIEW_WIDTH)
    crf      = _kv_int("preview_crf",      PREVIEW_CRF)
    segments = _kv_int("preview_segments", PREVIEW_SEGMENTS)
    # Whole input is decoded by the select filter, so long videos on a
    # CPU-capped container can exceed the old hardcoded 180s. Configurable now.
    timeout  = _kv_int("preview_timeout",  PREVIEW_TIMEOUT)

    margin = duration_seconds * 0.05
    usable = duration_seconds - 2 * margin
    if usable <= 0:
        return False, "unusable duration"

    spacing = usable / segments
    offsets = [margin + i * spacing for i in range(segments)]
    expr = "+".join(
        f"between(t,{off:.3f},{off + PREVIEW_SEG_LEN:.3f})" for off in offsets
    )

    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
        "-i", video_path,
        "-vf", f"select='{expr}',setpts=N/FRAME_RATE/TB,scale={width}:-2,fps={PREVIEW_FPS}",
        "-an",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", str(crf),
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        output_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=timeout, text=True)
    except subprocess.TimeoutExpired:
        log.warning("preview: timed out for %s", video_path)
        return False, f"ffmpeg timed out after {timeout}s"
    except Exception as e:
        log.exception("preview: failed to spawn ffmpeg for %s", video_path)
        return False, f"ffmpeg spawn failed: {str(e)[:120]}"

    if result.returncode != 0:
        tail = (result.stderr or "").strip()[-200:]
        log.warning("preview: ffmpeg rc=%d stderr=%s", result.returncode, tail)
        return False, f"ffmpeg rc={result.returncode}: {tail}" if tail else f"ffmpeg rc={result.returncode}"
    out = Path(output_path)
    if not out.exists() or out.stat().st_size < 1024:
        log.warning("preview: output missing or tiny for %s", video_path)
        return False, "output missing or too small"
    return True, None


def _record_preview_failure(video_id: str, reason: Optional[str]) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE videos SET preview_attempts = COALESCE(preview_attempts, 0) + 1, "
            "preview_error = ? WHERE video_id = ?",
            (reason, video_id),
        )
        conn.commit()
    finally:
        conn.close()


def build_preview_for_video(video_id: str) -> bool:
    """Locate the video by id, build a preview, record the path (or the failure
    reason). One-shot helper safe to call from worker, scheduler, or HTTP."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT file_path, duration FROM videos WHERE video_id = ?",
            (video_id,),
        ).fetchone()
    finally:
        conn.close()
    if not row or not row["file_path"]:
        _record_preview_failure(video_id, "source file path missing")
        return False
    src = Path(row["file_path"])
    if not src.exists():
        _record_preview_failure(video_id, "source file not found on disk")
        return False
    out = src.parent / PREVIEW_FILENAME
    ok, reason = make_preview(str(src), str(out), row["duration"])
    if not ok:
        _record_preview_failure(video_id, reason)
        return False
    conn = get_connection()
    try:
        # Success — record the path and clear any prior error.
        DB(conn).update_video_fields(video_id, {"preview_path": str(out), "preview_error": None})
    finally:
        conn.close()
    log.info("preview: built %s (%d KB)", out, out.stat().st_size // 1024)
    return True


def backfill_missing_previews(batch: int = 5) -> int:
    """Periodic job — pick a few videos that still need previews and build them.
    Skips videos that already failed ``MAX_PREVIEW_ATTEMPTS`` times so a broken
    file doesn't starve the queue. Throttled so we don't hog the CPU."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT video_id FROM videos "
            "WHERE status = 'done' AND file_path IS NOT NULL "
            "  AND preview_path IS NULL AND duration >= ? "
            "  AND COALESCE(preview_attempts, 0) < ? "
            "ORDER BY downloaded_at DESC "
            "LIMIT ?",
            (MIN_DURATION, MAX_PREVIEW_ATTEMPTS, batch),
        ).fetchall()
    finally:
        conn.close()
    built = 0
    for r in rows:
        if build_preview_for_video(r["video_id"]):
            built += 1
    if built:
        log.info("preview backfill: built %d/%d", built, len(rows))
    return built
