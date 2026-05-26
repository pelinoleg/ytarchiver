"""Periodic re-queue of failed downloads.

Worker already retries *transient* errors in-process (timeout, connection
reset, etc.) up to ``MAX_TRANSIENT_RETRIES``. After that the video is parked
in ``status='error'`` and otherwise stays there forever.

This sweeper picks them up periodically and flips them back to ``pending``
so the worker takes another shot — useful when the original failure was
something flaky like "Could not resolve host" or "Connection refused" that
the network has since recovered from.

Permanent failures (private / removed / age-restricted / no-formats) are
detected via the error message and skipped so we don't waste yt-dlp calls
on them every cycle.
"""
from __future__ import annotations

import logging

from db.database import DB, get_connection


log = logging.getLogger(__name__)


# Sub-strings that mean "this video will never download, stop trying."
# Compared against ``error_message.lower()`` — order doesn't matter.
PERMANENT_ERROR_MARKERS = (
    "video unavailable",
    "private video",
    "members-only",
    "members only",
    "this video is unavailable",
    "video has been removed",
    "removed by the uploader",
    "removed by the user",
    "this live event will begin",
    "premieres in",
    "is not available in your country",
    "deleted video",
    "requested format is not available",
    "no video formats found",
    "sign in to confirm your age",
    "copyright",
    "terms of service violation",
    "channel is unavailable",
    "this channel does not exist",
)

# Cap per run so we don't dump 1000 retries on the worker at once.
MAX_RETRIES_PER_RUN = 25
# Give up entirely after this many sweeper retries — at that point we mark
# the video ``skipped`` so it disappears from the Downloads queue. The user
# can still manually retry from the queue page if it briefly resurfaces.
GIVE_UP_AFTER = 5


def is_permanent(msg: str | None) -> bool:
    """Public: shared with the worker so the first failure of a known-bad
    URL flips straight to ``skipped`` without even hitting the sweep."""
    if not msg:
        return False
    low = msg.lower()
    return any(m in low for m in PERMANENT_ERROR_MARKERS)


# Back-compat private alias (used inside this module only).
_is_permanent = is_permanent


def sweep_failed() -> int:
    """Re-queue up to ``MAX_RETRIES_PER_RUN`` non-permanent failures. Returns
    how many were actually moved to pending.

    Per-video lifecycle:
      * permanent error  → flip to ``skipped`` (one-shot, never retried)
      * retry_count <  N → flip to ``pending``, bump retry_count
      * retry_count >= N → flip to ``skipped`` (we gave up)
    """
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, video_id, channel_id, title, error_message, retry_count "
            "FROM videos WHERE status = 'error' AND is_short = 0 "
            "ORDER BY added_at ASC"
        ).fetchall()
    finally:
        conn.close()

    moved = 0
    for r in rows:
        if moved >= MAX_RETRIES_PER_RUN:
            break

        # Permanent: park as skipped immediately — no point trying again.
        if _is_permanent(r["error_message"]):
            _flip_to_skipped(r, reason="permanent")
            continue

        tries = (r["retry_count"] or 0) + 1
        if tries > GIVE_UP_AFTER:
            _flip_to_skipped(r, reason="gave_up")
            continue

        # Re-queue and bump the retry counter.
        conn = get_connection()
        try:
            DB(conn).set_video_status(
                r["video_id"], "pending",
                error_message=None, progress=None,
            )
            conn.execute(
                "UPDATE videos SET retry_count = ? WHERE id = ?",
                (tries, r["id"]),
            )
            conn.commit()
            DB(conn).log_event(
                "download_retry_sweep",
                message=f"attempt {tries}/{GIVE_UP_AFTER} · prior: {(r['error_message'] or '')[:160]}",
                video_id=r["video_id"],
                video_title=r["title"],
                channel_id=r["channel_id"],
            )
        finally:
            conn.close()
        moved += 1

    if moved:
        log.info("error_retry: re-queued %d failed video(s)", moved)
    return moved


def _flip_to_skipped(row, *, reason: str) -> None:
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE videos SET status = 'skipped' WHERE id = ?",
            (row["id"],),
        )
        conn.commit()
        DB(conn).log_event(
            f"download_skipped_{reason}",
            message=(row["error_message"] or "")[:300],
            video_id=row["video_id"],
            video_title=row["title"],
            channel_id=row["channel_id"],
        )
    finally:
        conn.close()
