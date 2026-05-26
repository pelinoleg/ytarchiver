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
PREVIEW_FILENAME  = "preview.mp4"
MIN_DURATION      = 30     # don't bother for very short videos


def make_preview(video_path: str, output_path: str, duration_seconds: Optional[float]) -> bool:
    """Run ffmpeg to build a hover-preview clip. Returns True on success."""
    if not duration_seconds or duration_seconds < MIN_DURATION:
        return False

    # Knobs are overridable from the Settings KV (Advanced section).
    width    = _kv_int("preview_width",    PREVIEW_WIDTH)
    crf      = _kv_int("preview_crf",      PREVIEW_CRF)
    segments = _kv_int("preview_segments", PREVIEW_SEGMENTS)

    margin = duration_seconds * 0.05
    usable = duration_seconds - 2 * margin
    if usable <= 0:
        return False

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
        result = subprocess.run(cmd, capture_output=True, timeout=180, text=True)
    except subprocess.TimeoutExpired:
        log.warning("preview: timed out for %s", video_path)
        return False
    except Exception:
        log.exception("preview: failed to spawn ffmpeg for %s", video_path)
        return False

    if result.returncode != 0:
        log.warning("preview: ffmpeg rc=%d stderr=%s", result.returncode, result.stderr[-300:])
        return False
    out = Path(output_path)
    if not out.exists() or out.stat().st_size < 1024:
        log.warning("preview: output missing or tiny for %s", video_path)
        return False
    return True


def build_preview_for_video(video_id: str) -> bool:
    """Locate the video by id, build a preview, record the path. One-shot helper
    safe to call from worker, scheduler, or HTTP."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT file_path, duration FROM videos WHERE video_id = ?",
            (video_id,),
        ).fetchone()
    finally:
        conn.close()
    if not row or not row["file_path"]:
        return False
    src = Path(row["file_path"])
    if not src.exists():
        return False
    out = src.parent / PREVIEW_FILENAME
    if not make_preview(str(src), str(out), row["duration"]):
        return False
    conn = get_connection()
    try:
        DB(conn).update_video_fields(video_id, {"preview_path": str(out)})
    finally:
        conn.close()
    log.info("preview: built %s (%d KB)", out, out.stat().st_size // 1024)
    return True


def backfill_missing_previews(batch: int = 5) -> int:
    """Periodic job — pick a few videos that still need previews and build them.
    Throttled so we don't hog the CPU."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT video_id FROM videos "
            "WHERE status = 'done' AND file_path IS NOT NULL "
            "  AND preview_path IS NULL AND duration >= ? "
            "ORDER BY downloaded_at DESC "
            "LIMIT ?",
            (MIN_DURATION, batch),
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
