"""Hover-preview generator. Builds a tiny MP4 with ~12 short clips taken from
evenly-spread points of the source video — YouTube-style mosaic-of-moments.

Result: ~12 seconds total, 320x180, no audio, ~1–2 MB per file.
"""
from __future__ import annotations

import logging
import subprocess
import threading
from pathlib import Path
from typing import Optional

from config import settings
from db.database import DB, get_connection


log = logging.getLogger(__name__)


# ── Live "what's building right now" state ───────────────────────────────────
# The backfill job runs in-process (APScheduler executor thread), so a simple
# module-level dict is readable from the API request handlers under the GIL.
_state_lock = threading.Lock()
_current: Optional[dict] = None   # {"video_id", "title", "percent"}


def _set_current(video_id: str, title: Optional[str]) -> None:
    global _current
    with _state_lock:
        _current = {"video_id": video_id, "title": title or video_id, "percent": 0}


def _set_percent(pct: float) -> None:
    with _state_lock:
        if _current is not None:
            _current["percent"] = max(0, min(99, int(pct)))


def _clear_current() -> None:
    global _current
    with _state_lock:
        _current = None


def current_build() -> Optional[dict]:
    """The preview being generated right now (video_id, title, percent), or None."""
    with _state_lock:
        return dict(_current) if _current else None


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

    # Seek to each segment with INPUT seeking (``-ss`` before ``-i``): ffmpeg
    # jumps to the nearest keyframe and decodes only ~seg_len there, instead of
    # decoding the whole file (the old ``select`` filter did, so a long video
    # took minutes / timed out on the Pi). Each offset is a separate input; the
    # concat filter stitches them into the mosaic.
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-y"]
    for off in offsets:
        cmd += ["-ss", f"{off:.3f}", "-t", f"{PREVIEW_SEG_LEN:.3f}", "-i", video_path]
    chains = "".join(
        f"[{i}:v]scale={width}:-2,fps={PREVIEW_FPS},setsar=1[v{i}];" for i in range(segments)
    )
    concat_in = "".join(f"[v{i}]" for i in range(segments))
    filtergraph = chains + f"{concat_in}concat=n={segments}:v=1:a=0[out]"
    cmd += [
        "-filter_complex", filtergraph, "-map", "[out]",
        "-an",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", str(crf),
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        # Machine-readable progress on stdout so we can report a live percent.
        "-progress", "pipe:1", "-nostats",
        output_path,
    ]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except Exception as e:
        log.exception("preview: failed to spawn ffmpeg for %s", video_path)
        return False, f"ffmpeg spawn failed: {str(e)[:120]}"

    # Hard timeout via a watchdog that kills the process.
    killed = {"v": False}
    def _kill():
        killed["v"] = True
        try:
            proc.kill()
        except Exception:
            pass
    timer = threading.Timer(timeout, _kill)
    timer.start()

    # Drain stderr in a thread so a full pipe can never deadlock the read loop.
    stderr_parts: list[str] = []
    def _drain():
        if proc.stderr:
            for ln in proc.stderr:
                stderr_parts.append(ln)
    drainer = threading.Thread(target=_drain, daemon=True)
    drainer.start()

    # ffmpeg's out_time is the OUTPUT (preview) timeline, not the input decode
    # position — useless here. But the select windows are spread evenly across
    # the whole input, so the count of emitted OUTPUT frames grows roughly in
    # step with how far we've decoded through the source. Expected total ≈
    # segments × fps × seg_len. Use frame= as the progress signal.
    expected_frames = max(1.0, segments * PREVIEW_FPS * PREVIEW_SEG_LEN)
    try:
        if proc.stdout:
            for line in proc.stdout:
                line = line.strip()
                if line.startswith("frame="):
                    try:
                        n = int(line.split("=", 1)[1])
                    except (ValueError, IndexError):
                        continue
                    _set_percent(n / expected_frames * 100)
        proc.wait()
    finally:
        timer.cancel()
        drainer.join(timeout=2)

    stderr = "".join(stderr_parts)
    if killed["v"]:
        log.warning("preview: timed out for %s", video_path)
        return False, f"ffmpeg timed out after {timeout}s"
    if proc.returncode != 0:
        tail = stderr.strip()[-200:]
        log.warning("preview: ffmpeg rc=%d stderr=%s", proc.returncode, tail)
        return False, f"ffmpeg rc={proc.returncode}: {tail}" if tail else f"ffmpeg rc={proc.returncode}"
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
            "SELECT file_path, duration, title FROM videos WHERE video_id = ?",
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
    try:
        if src.stat().st_size == 0:
            # 0-byte = broken/truncated download. Fail cleanly (no scary ffmpeg
            # log) — the integrity sweep will re-download it.
            _record_preview_failure(video_id, "source file is empty (broken download)")
            return False
    except OSError:
        _record_preview_failure(video_id, "source file unreadable")
        return False
    out = src.parent / PREVIEW_FILENAME
    _set_current(video_id, row["title"])
    try:
        ok, reason = make_preview(str(src), str(out), row["duration"])
    finally:
        _clear_current()
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
