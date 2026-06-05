"""Music section endpoints.

A video is considered "music" when ``v.is_music = 1`` OR it belongs to at
least one playlist whose ``is_music = 1``. The DB layer handles that union
via the ``IS_MUSIC_SQL`` predicate; this router is a thin pass-through.
"""
from fastapi import APIRouter, Depends

from db.database import DB, get_db
from models import VideoOut, ChannelOut
from routers.playlists import PlaylistOut


router = APIRouter()


@router.get("/tracks", response_model=list[VideoOut])
def list_tracks(
    sort: str = "added", dir: str = "desc", favorites: bool = False,
    limit: int = 10000, offset: int = 0, db: DB = Depends(get_db),
):
    """Music tracks, sorted server-side (global order) and paginatable via
    limit/offset. The grid virtualizes rendering, so a large batch is cheap."""
    return [
        VideoOut.from_row(r)
        for r in db.list_music_videos(sort=sort, direction=dir,
                                      favorites_only=favorites, limit=limit, offset=offset)
    ]


@router.get("/track-ids")
def list_track_ids(sort: str = "added", dir: str = "desc", db: DB = Depends(get_db)):
    """The COMPLETE ordered video_id list (no limit) in the requested sort —
    powers global Play-all / Shuffle so they cover the whole library, not just
    the page the client loaded."""
    return {"video_ids": db.list_music_video_ids(sort=sort, direction=dir)}


@router.get("/playlists", response_model=list[PlaylistOut])
def list_playlists(db: DB = Depends(get_db)):
    out = []
    for r in db.list_music_playlists():
        po = PlaylistOut.from_row(r)
        po.covers = [
            {"video_id": c["video_id"], "thumbnail_path": c["thumbnail_path"],
             "thumbnail_url": c["thumbnail_url"]}
            for c in db.playlist_cover_videos(r["id"], limit=4)
        ]
        out.append(po)
    return out


@router.get("/channels", response_model=list[ChannelOut])
def list_channels(db: DB = Depends(get_db)):
    """Subscribed channels flagged as music — shown as their own row on the
    Music page. Every video they upload is treated as music."""
    return [ChannelOut.from_row(r) for r in db.list_music_channels()]


@router.get("/stats")
def stats(db: DB = Depends(get_db)):
    # Music favorites count is a cheap query and the sidebar wants it for
    # the "Liked" badge — surfaces here so it's polled with the other
    # music counters in one round-trip.
    fav_row = db.conn.execute(
        f"""SELECT COUNT(*) AS n
            FROM videos v
            WHERE v.is_favorite = 1 AND v.status = 'done' AND v.is_short = 0
              AND (v.is_music = 1 OR EXISTS (
                SELECT 1 FROM playlist_videos pv
                JOIN playlists p ON p.id = pv.playlist_id
                WHERE pv.video_id = v.video_id AND p.is_music = 1
              ))"""
    ).fetchone()
    summ = db.music_storage_summary()
    return {
        "tracks":      db.count_music_videos(),
        "playlists":   len(db.list_music_playlists()),
        "favorites":   fav_row["n"] if fav_row else 0,
        "total_bytes": summ["total_bytes"],
    }


@router.get("/storage")
def music_storage(db: DB = Depends(get_db)):
    """Music-only storage breakdown for the Storage page: grand total, the
    per-playlist split, and the heaviest individual clips."""
    summ = db.music_storage_summary()
    return {
        "tracks":      summ["tracks"],
        "total_bytes": summ["total_bytes"],
        "playlists":   [dict(r) for r in db.list_music_playlists_with_size()],
        "largest":     [VideoOut.from_row(r) for r in db.list_largest_music_videos(10)],
    }
