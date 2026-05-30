import shutil
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from config import settings as env_settings
from db.database import DB, get_db
from models import Quality, VideoOut
from services import playlist_sync


router = APIRouter()


# ── Pydantic shapes ──────────────────────────────────────────────────────────────


class PlaylistCreate(BaseModel):
    url: str
    quality: Optional[Quality] = None
    retention_days: Optional[int] = None
    keep_videos_forever: Optional[bool] = None
    is_music: Optional[bool] = None


class SearchPlaylistCreate(BaseModel):
    query: str
    count: int = 5
    quality: Optional[Quality] = None
    retention_days: Optional[int] = None
    keep_videos_forever: Optional[bool] = None
    is_music: Optional[bool] = None


class PlaylistUpdate(BaseModel):
    quality: Optional[Quality] = None
    retention_days: Optional[int] = None
    keep_videos_forever: Optional[bool] = None
    is_music: Optional[bool] = None


class PlaylistOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    url: str
    yt_playlist_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    uploader: Optional[str] = None
    video_count: int = 0
    item_count: int = 0
    done_count: int = 0
    quality: Optional[str] = None
    retention_days: Optional[int] = None
    keep_videos_forever: bool = False
    is_music: bool = False
    last_synced: Optional[str] = None
    last_sync_added_count: Optional[int] = None
    last_sync_error: Optional[str] = None
    created_at: Optional[str] = None

    @classmethod
    def from_row(cls, row):
        if row is None:
            return None
        return cls.model_validate(dict(row))


# ── Endpoints ────────────────────────────────────────────────────────────────────


@router.get("", response_model=list[PlaylistOut])
def list_playlists(db: DB = Depends(get_db)):
    return [PlaylistOut.from_row(r) for r in db.list_playlists()]


@router.post("", response_model=PlaylistOut, status_code=201)
def subscribe_playlist(
    body: PlaylistCreate, bg: BackgroundTasks, db: DB = Depends(get_db),
):
    try:
        pid = playlist_sync.subscribe_playlist(
            db, url=body.url,
            quality=body.quality, retention_days=body.retention_days,
            is_music=bool(body.is_music),
        )
    except Exception as e:
        raise HTTPException(400, f"Failed to resolve playlist: {e}")
    bg.add_task(_sync_in_background, pid)
    return PlaylistOut.from_row(db.get_playlist(pid))


@router.post("/search", response_model=PlaylistOut, status_code=201)
def subscribe_search_playlist(
    body: SearchPlaylistCreate, bg: BackgroundTasks, db: DB = Depends(get_db),
):
    """Build a playlist out of the top-N YouTube search results."""
    if not body.query.strip():
        raise HTTPException(400, "query is required")
    try:
        pid = playlist_sync.subscribe_search_playlist(
            db, query=body.query, count=body.count,
            quality=body.quality, retention_days=body.retention_days,
            is_music=bool(body.is_music),
        )
    except Exception as e:
        raise HTTPException(400, f"Failed to build search playlist: {e}")
    bg.add_task(_sync_in_background, pid)
    return PlaylistOut.from_row(db.get_playlist(pid))


@router.get("/{playlist_id}", response_model=PlaylistOut)
def get_playlist(playlist_id: int, db: DB = Depends(get_db)):
    row = db.get_playlist(playlist_id)
    if not row:
        raise HTTPException(404, "Playlist not found")
    return PlaylistOut.from_row(row)


@router.patch("/{playlist_id}", response_model=PlaylistOut)
def update_playlist(playlist_id: int, body: PlaylistUpdate, db: DB = Depends(get_db)):
    if not db.get_playlist(playlist_id):
        raise HTTPException(404, "Playlist not found")
    db.update_playlist_fields(playlist_id, body.model_dump(exclude_unset=True))
    return PlaylistOut.from_row(db.get_playlist(playlist_id))


@router.delete("/{playlist_id}", status_code=204)
def unsubscribe_playlist(playlist_id: int, db: DB = Depends(get_db)):
    pl = db.get_playlist(playlist_id)
    if not pl:
        raise HTTPException(404, "Playlist not found")

    # Find orphans BEFORE deleting the playlist row. A video is "orphan" if
    # this is its only playlist AND it lives in an unsubscribed channel
    # (i.e. the channel exists only because this playlist needed it — no
    # standalone Subscriptions row, no other playlist linking to it, not a
    # manual download). Without this, unsubscribing leaves the videos:
    #   • still in the worker queue if pending → they continue downloading
    #   • orphaned in DB if done → invisible everywhere (hidden channel,
    #     no playlist), user has no way to find or delete them
    orphans = db.conn.execute(
        """
        SELECT v.id, v.video_id, v.channel_id, v.status, v.title, v.file_path
        FROM videos v
        JOIN playlist_videos pv ON pv.video_id = v.video_id
        LEFT JOIN channels c ON c.id = v.channel_id
        WHERE pv.playlist_id = ?
          AND COALESCE(c.is_subscribed, 0) = 0
          AND c.yt_channel_id IS NOT '__manual__'
          AND NOT EXISTS (
            SELECT 1 FROM playlist_videos pv2
            WHERE pv2.video_id = v.video_id AND pv2.playlist_id != ?
          )
        """,
        (playlist_id, playlist_id),
    ).fetchall()

    base = Path(env_settings.download_dir).expanduser().resolve()
    cancelled = 0
    purged = 0
    for v in orphans:
        if v["status"] in ("done", "downloading"):
            # Wipe files on disk. Includes the entire video directory so
            # info.json / thumbnail / preview / subtitle all go too.
            vid_dir = base / str(v["channel_id"]) / v["video_id"]
            if vid_dir.exists():
                shutil.rmtree(vid_dir, ignore_errors=True)
            purged += 1
        else:
            # pending / queued / error / skipped — never produced a file.
            cancelled += 1
        # Remove the row entirely so the worker / sync never re-discovers it.
        db.conn.execute("DELETE FROM videos WHERE id = ?", (v["id"],))

    db.delete_playlist(playlist_id)
    db.conn.commit()

    if cancelled or purged:
        db.log_event(
            "playlist_orphans_cleaned",
            message=f"Unsubscribed '{pl['title']}': cancelled {cancelled}, purged {purged} videos",
        )
    return None


@router.get("/{playlist_id}/videos", response_model=list[VideoOut])
def list_videos_in_playlist(playlist_id: int, db: DB = Depends(get_db)):
    if not db.get_playlist(playlist_id):
        raise HTTPException(404, "Playlist not found")
    rows = db.list_playlist_videos(playlist_id)
    return [VideoOut.from_row(r) for r in rows]


@router.post("/{playlist_id}/sync", response_model=PlaylistOut)
def manual_sync(playlist_id: int, db: DB = Depends(get_db)):
    if not db.get_playlist(playlist_id):
        raise HTTPException(404, "Playlist not found")
    try:
        playlist_sync.sync_playlist(db, playlist_id)
    except Exception as e:
        db.update_playlist_fields(playlist_id, {
            "last_sync_error": str(e)[:500],
            "last_synced":     __import__("datetime").datetime.utcnow().isoformat(),
        })
        raise HTTPException(500, str(e)[:300])
    return PlaylistOut.from_row(db.get_playlist(playlist_id))


def _sync_in_background(playlist_id: int) -> None:
    from db.database import DB as _DB, get_connection
    conn = get_connection()
    try:
        playlist_sync.sync_playlist(_DB(conn), playlist_id)
    finally:
        conn.close()
