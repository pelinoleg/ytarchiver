"""Playlist subscription + sync. Playlists live alongside channels but use a
junction table so videos can belong to multiple playlists.
"""
from __future__ import annotations

import logging
import re

from db.database import DB
from services import ytdlp_service


_YTSEARCH_RE = re.compile(r"^ytsearch(\d+):", re.IGNORECASE)


log = logging.getLogger(__name__)


def subscribe_playlist(
    db: DB, *,
    url: str,
    quality: str | None = None,
    retention_days: int | None = None,
    is_music: bool = False,
) -> int:
    """Create a playlist row. Idempotent — returns existing id if URL known."""
    norm = url.strip()
    existing = db.get_playlist_by_url(norm)
    if existing:
        return existing["id"]
    info = ytdlp_service.fetch_playlist_info(norm)
    pid = db.add_playlist(
        url=norm,
        yt_playlist_id=info["yt_playlist_id"],
        title=info["title"],
        description=info["description"],
        thumbnail_url=info["thumbnail_url"],
        uploader=info["uploader"],
        video_count=info.get("video_count") or 0,
        quality=quality,
        retention_days=retention_days,
        is_music=is_music,
    )
    log.info("subscribed playlist %s (id=%d)", info["title"], pid)
    return pid


def subscribe_search_playlist(
    db: DB, *,
    query: str,
    count: int,
    quality: str | None = None,
    retention_days: int | None = None,
    is_music: bool = False,
) -> int:
    """Build a playlist out of the top-N YouTube search results for a query.
    yt-dlp natively understands ``ytsearchN:query`` and returns it as a playlist,
    so the rest of the sync machinery just works."""
    query = query.strip()
    count = max(1, min(int(count), 100))
    fake_url = f"ytsearch{count}:{query}"
    existing = db.get_playlist_by_url(fake_url)
    if existing:
        return existing["id"]
    pid = db.add_playlist(
        url=fake_url,
        yt_playlist_id=None,
        title=f"Search · {query}",
        description=f"Top {count} YouTube search results for: {query}",
        thumbnail_url=None,
        uploader=None,
        video_count=count,
        quality=quality,
        retention_days=retention_days,
        is_music=is_music,
    )
    log.info("subscribed search-playlist %r count=%d (id=%d)", query, count, pid)
    return pid


def sync_playlist(db: DB, playlist_id: int) -> int:
    """Fetch current playlist contents, add new videos as pending, update
    positions for already-known videos. Returns count of newly added rows."""
    p = db.get_playlist(playlist_id)
    if not p:
        return 0
    entries = ytdlp_service.fetch_playlist_videos(p["url"])

    # Search collections: yt-dlp sometimes returns slightly more than N items
    # for ``ytsearchN:``. Hard-cap to what the user actually asked for.
    m = _YTSEARCH_RE.match(p["url"] or "")
    if m:
        cap = int(m.group(1))
        if cap > 0 and len(entries) > cap:
            entries = entries[:cap]

    added = 0
    seen_video_ids: list[str] = []
    for i, e in enumerate(entries):
        seen_video_ids.append(e["id"])
        # Make sure a channel row exists for the video.
        channel_id = db.ensure_unsubscribed_channel(e.get("channel_yt_id"), e.get("channel_name"))
        # Make sure the video row exists; insert as pending if not.
        if not db.video_exists(e["id"]):
            db.add_video(
                video_id=e["id"], channel_id=channel_id,
                title=e["title"],
                duration=e.get("duration"),
                thumbnail_url=e.get("thumbnail_url"),
                is_short=False,
                status="pending",
            )
            added += 1
        # Upsert the position in the playlist (re-index from the trimmed list).
        db.upsert_playlist_video(playlist_id, e["id"], i + 1)

    # Drop any playlist_videos rows whose video isn't in the fresh list — handles
    # both "video removed from playlist on YouTube" and "search now returns
    # fewer items than before".
    if seen_video_ids:
        placeholders = ",".join("?" * len(seen_video_ids))
        db.conn.execute(
            f"DELETE FROM playlist_videos "
            f"WHERE playlist_id = ? AND video_id NOT IN ({placeholders})",
            (playlist_id, *seen_video_ids),
        )
    else:
        db.conn.execute(
            "DELETE FROM playlist_videos WHERE playlist_id = ?", (playlist_id,),
        )
    db.conn.commit()

    # First entry's thumbnail makes a reasonable cover for search playlists
    # (which we created without one).
    cover_update = {}
    if not p["thumbnail_url"] and entries:
        first_thumb = entries[0].get("thumbnail_url")
        if first_thumb:
            cover_update["thumbnail_url"] = first_thumb

    db.update_playlist_fields(playlist_id, {
        "last_synced":           __import__("datetime").datetime.utcnow().isoformat(),
        "last_sync_added_count": added,
        "last_sync_error":       None,
        "video_count":           len(entries),
        **cover_update,
    })
    if added:
        db.log_event(
            "playlist_synced",
            message=f"+{added} new video(s)",
            channel_id=None,
            channel_name=p["title"],
        )
    return added
