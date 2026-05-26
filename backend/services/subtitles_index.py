"""Index downloaded WebVTT subtitle files into the ``subtitles_fts`` FTS5
table so the user can search through transcript text and jump to the right
timecode in the player.

Indexer runs:
  * once per video right after download (via the worker hook), and
  * as a periodic backfill for videos that have a subtitle_path on disk but
    no matching FTS rows (e.g. backfilled libraries, or after a fresh ``\
    rebuild`` of the FTS table).
"""
from __future__ import annotations

import logging
import re
from typing import Iterator

from db.database import get_connection


log = logging.getLogger(__name__)


# Matches "HH:MM:SS.mmm --> HH:MM:SS.mmm" (also tolerates a missing hour
# segment, which some yt-dlp builds emit for short clips).
_CUE_RE = re.compile(
    r"^(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*"
    r"(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})"
)
_TAG_RE = re.compile(r"<[^>]+>")


def _ts_to_seconds(h: str, m: str, s: str, ms: str) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


def _parse_vtt(text: str) -> Iterator[tuple[float, str]]:
    """Yield ``(start_seconds, cleaned_text)`` per cue.
    Robust to BOMs, ``WEBVTT`` header lines, and HTML tags inside cues."""
    text = text.lstrip("﻿")
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        m = _CUE_RE.match(lines[i].strip())
        if not m:
            i += 1
            continue
        start = _ts_to_seconds(*m.groups()[:4])
        i += 1
        body: list[str] = []
        while i < len(lines) and lines[i].strip():
            cleaned = _TAG_RE.sub("", lines[i]).strip()
            if cleaned:
                body.append(cleaned)
            i += 1
        if body:
            yield start, " ".join(body)


def index_subtitle(video_id: str, subtitle_path: str | None) -> int:
    """Replace the FTS rows for ``video_id`` with cues parsed from
    ``subtitle_path``. Returns the number of cues stored."""
    if not subtitle_path:
        return 0
    try:
        with open(subtitle_path, "r", encoding="utf-8", errors="replace") as f:
            raw = f.read()
    except OSError as e:
        log.warning("subtitles: read failed for %s: %s", video_id, e)
        return 0

    cues = list(_parse_vtt(raw))
    conn = get_connection()
    try:
        conn.execute("DELETE FROM subtitles_fts WHERE video_id = ?", (video_id,))
        if cues:
            conn.executemany(
                "INSERT INTO subtitles_fts (video_id, start_seconds, text) "
                "VALUES (?, ?, ?)",
                [(video_id, start, txt) for start, txt in cues],
            )
        conn.commit()
    finally:
        conn.close()

    if cues:
        log.info("subtitles: indexed %d cues for %s", len(cues), video_id)
    return len(cues)


def backfill_missing(batch: int = 10) -> int:
    """Find a few videos with subtitle_path but no FTS rows and index them.
    Returns how many were indexed in this run."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT v.video_id, v.subtitle_path FROM videos v "
            "WHERE v.status = 'done' AND v.subtitle_path IS NOT NULL "
            "  AND NOT EXISTS ("
            "    SELECT 1 FROM subtitles_fts s WHERE s.video_id = v.video_id"
            "  ) "
            "LIMIT ?",
            (batch,),
        ).fetchall()
    finally:
        conn.close()
    done = 0
    for r in rows:
        if index_subtitle(r["video_id"], r["subtitle_path"]) > 0:
            done += 1
    return done


def search(query: str, limit: int = 30) -> list[dict]:
    """Return search hits grouped one row per (video, cue). The FTS
    ``snippet`` highlights matches with <b>…</b> for easy rendering."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT video_id, start_seconds, "
            "       snippet(subtitles_fts, 2, '<b>', '</b>', '…', 12) AS snippet "
            "FROM subtitles_fts "
            "WHERE subtitles_fts MATCH ? "
            "ORDER BY rank LIMIT ?",
            (query, limit),
        ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]
