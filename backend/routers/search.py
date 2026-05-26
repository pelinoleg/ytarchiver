"""Cross-content search.

Right now this exposes the subtitle FTS index — the regular per-video search
already lives in ``GET /api/videos?search=...`` (which scans title /
description / channel / chapters). Subtitles are a separate index because
they explode the corpus (one row per cue) and need timecodes returned.
"""
from fastapi import APIRouter, Depends, Query

from db.database import DB, get_db
from models import VideoOut
from services import subtitles_index


router = APIRouter()


@router.get("/subtitles")
def search_subtitles(
    q: str = Query(..., min_length=1),
    limit: int = Query(default=30, le=100),
    db: DB = Depends(get_db),
):
    """Return up to ``limit`` cue-level hits sorted by FTS rank. Each hit
    carries the matching video metadata plus the start timecode and an HTML
    snippet (with ``<b>`` highlights) for rendering."""
    # Translate the human query into a tolerant FTS prefix match. ``a OR b OR
    # c*`` lets users type natural words; the trailing ``*`` enables prefix
    # matching on the last token so "amazo" still hits "amazon".
    tokens = [t for t in q.replace('"', "").split() if t]
    if not tokens:
        return []
    fts_q = " OR ".join(tokens[:-1] + [tokens[-1] + "*"])
    try:
        hits = subtitles_index.search(fts_q, limit=limit)
    except Exception:
        return []
    out = []
    for h in hits:
        row = db.get_video(h["video_id"])
        if not row:
            continue
        v = VideoOut.from_row(row)
        if v is None:
            continue
        out.append({
            "video":         v.model_dump(),
            "start_seconds": float(h["start_seconds"]),
            "snippet":       h["snippet"],
        })
    return out
