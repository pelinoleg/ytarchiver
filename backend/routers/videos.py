import shutil
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from config import settings as env_settings
from db.database import DB, get_db
from models import Quality, VideoOut


router = APIRouter()


class PlaybackUpdate(BaseModel):
    rate: Optional[float] = None
    position: Optional[float] = None
    mark_watched: bool = False


class VideoUpdate(BaseModel):
    keep_forever: Optional[bool] = None
    is_favorite:  Optional[bool] = None
    is_music:     Optional[bool] = None
    quality:      Optional[Quality] = None


class ManualDownloadBody(BaseModel):
    url: str
    quality: Optional[Quality] = None
    is_music: Optional[bool] = None


@router.post("/download", response_model=VideoOut, status_code=201)
def manual_download(body: ManualDownloadBody, db: DB = Depends(get_db)):
    """Manually download a single video by URL. Lives forever (keep_forever=1)."""
    from services import ytdlp_service

    vid = ytdlp_service.extract_video_id(body.url)
    if not vid:
        raise HTTPException(400, "Couldn't extract a YouTube video id from that URL")

    existing = db.get_video(vid)
    if existing:
        # Already known. Re-queue if it was previously dropped; pin it either way.
        if existing["status"] not in ("done", "downloading", "queued"):
            db.set_video_status(vid, "pending", error_message=None, progress=None)
        db.update_video_fields(vid, {"keep_forever": True,
                                     **({"quality": body.quality} if body.quality else {}),
                                     **({"is_music": True} if body.is_music else {})})
        return VideoOut.from_row(db.get_video(vid))

    try:
        info = ytdlp_service.fetch_video_info(vid)
    except Exception as e:
        raise HTTPException(400, f"Failed to resolve video metadata: {e}")

    channel_id = db.get_or_create_manual_channel()
    db.add_video(
        video_id=vid,
        channel_id=channel_id,
        title=info["title"],
        description=info["description"],
        duration=info["duration"],
        upload_date=info["upload_date"],
        thumbnail_url=info["thumbnail_url"],
        is_short=False,
        status="pending",
    )
    db.update_video_fields(vid, {"keep_forever": True,
                                 **({"quality": body.quality} if body.quality else {}),
                                 **({"is_music": True} if body.is_music else {})})
    db.log_event(
        "manual_download_queued",
        video_id=vid,
        video_title=info["title"],
        channel_id=channel_id,
        channel_name="Manual downloads",
    )
    return VideoOut.from_row(db.get_video(vid))


@router.get("", response_model=list[VideoOut])
def list_videos(
    channel_id: int | None = None,
    folder_id: int | None = None,
    status: str | None = None,
    search: str | None = None,
    limit: int = Query(default=60, le=5000),
    offset: int = 0,
    db: DB = Depends(get_db),
):
    rows = db.list_videos(
        channel_id=channel_id, folder_id=folder_id, status=status, search=search,
        limit=limit, offset=offset,
    )
    return [VideoOut.from_row(r) for r in rows]


@router.get("/{video_id}", response_model=VideoOut)
def get_video(video_id: str, db: DB = Depends(get_db)):
    row = db.get_video(video_id)
    if not row:
        raise HTTPException(404, "Video not found")
    return VideoOut.from_row(row)


@router.patch("/{video_id}", response_model=VideoOut)
def update_video(video_id: str, body: VideoUpdate, db: DB = Depends(get_db)):
    if not db.get_video(video_id):
        raise HTTPException(404, "Video not found")
    db.update_video_fields(video_id, body.model_dump(exclude_unset=True))
    return VideoOut.from_row(db.get_video(video_id))


@router.post("/{video_id}/redownload", response_model=VideoOut)
def redownload_video(video_id: str, db: DB = Depends(get_db)):
    """Wipe the on-disk files for a video and queue it for re-download.

    Use case: legacy videos saved before the codec preference flipped to
    H.264 — they're AV1, which iOS Safari and many older browsers refuse
    to play. Re-downloading picks up the current format string.
    """
    row = db.get_video(video_id)
    if not row:
        raise HTTPException(404, "Video not found")
    # Remove the on-disk artefacts so the worker overwrites cleanly.
    video_dir = (
        Path(env_settings.download_dir).expanduser().resolve()
        / str(row["channel_id"]) / video_id
    )
    if video_dir.exists():
        shutil.rmtree(video_dir, ignore_errors=True)
    # Reset the row: clear paths + size + sub flag + retry counter so the
    # worker treats this as a fresh attempt. Without zeroing retry_count,
    # videos that previously bumped close to MAX_TRANSIENT_RETRIES would
    # get parked as 'skipped' on the very first hiccup.
    db.update_video_fields(video_id, {
        "file_path": None,
        "thumbnail_path": None,
        "subtitle_path": None,
        "preview_path": None,
        "info_path": None,
        "file_size_bytes": None,
        "error_message": None,
        "progress": None,
        "retry_count": 0,
    })
    db.set_video_status(video_id, "pending")
    db.log_event(
        "video_redownload_requested",
        video_id=video_id,
        video_title=row["title"],
        channel_id=row["channel_id"],
        channel_name=row["channel_name"],
        message="Re-download triggered by user",
    )
    return VideoOut.from_row(db.get_video(video_id))


@router.delete("/{video_pk}", status_code=204)
def delete_video(video_pk: int, db: DB = Depends(get_db)):
    # Snapshot title/channel name BEFORE delete so the event log is meaningful.
    snap = db.conn.execute(
        "SELECT v.title, c.name AS channel_name "
        "FROM videos v LEFT JOIN channels c ON c.id = v.channel_id "
        "WHERE v.id = ?",
        (video_pk,),
    ).fetchone()

    info = db.soft_delete_video(video_pk)
    if not info:
        raise HTTPException(404, "Video not found")
    video_dir = (
        Path(env_settings.download_dir).expanduser().resolve()
        / str(info["channel_id"]) / info["video_id"]
    )
    if video_dir.exists():
        shutil.rmtree(video_dir, ignore_errors=True)
    db.log_event(
        "video_deleted_manual",
        video_id=info["video_id"],
        video_title=snap["title"] if snap else None,
        channel_id=info["channel_id"],
        channel_name=snap["channel_name"] if snap else None,
    )
    return None


class BulkDeleteBody(BaseModel):
    ids: list[int]


class BulkPatchBody(BaseModel):
    video_ids: list[str]
    patch: VideoUpdate


@router.post("/bulk/delete")
def bulk_delete(body: BulkDeleteBody, db: DB = Depends(get_db)):
    """Delete a set of videos by primary key. Same disk-cleanup semantics as
    the single-video DELETE; returns how many actually got removed."""
    deleted = 0
    for pk in body.ids:
        snap = db.conn.execute(
            "SELECT v.title, c.name AS channel_name "
            "FROM videos v LEFT JOIN channels c ON c.id = v.channel_id "
            "WHERE v.id = ?",
            (pk,),
        ).fetchone()
        info = db.soft_delete_video(pk)
        if not info:
            continue
        deleted += 1
        video_dir = (
            Path(env_settings.download_dir).expanduser().resolve()
            / str(info["channel_id"]) / info["video_id"]
        )
        if video_dir.exists():
            shutil.rmtree(video_dir, ignore_errors=True)
        db.log_event(
            "video_deleted_bulk",
            video_id=info["video_id"],
            video_title=snap["title"] if snap else None,
            channel_id=info["channel_id"],
            channel_name=snap["channel_name"] if snap else None,
        )
    return {"deleted": deleted}


@router.post("/bulk/patch")
def bulk_patch(body: BulkPatchBody, db: DB = Depends(get_db)):
    """Apply the same field update to multiple videos in one call. Used by the
    selection-mode action bar (mark as music / favorite / keep)."""
    fields = body.patch.model_dump(exclude_unset=True)
    if not fields:
        return {"updated": 0}
    updated = 0
    for vid in body.video_ids:
        if not db.get_video(vid):
            continue
        db.update_video_fields(vid, fields)
        updated += 1
    return {"updated": updated}


@router.get("/{video_id}/segments")
def list_segments(video_id: str, db: DB = Depends(get_db)):
    """Return SponsorBlock segments stored for this video."""
    rows = db.list_sponsor_segments(video_id)
    return [
        {
            "uuid":     r["segment_uuid"],
            "category": r["category"],
            "start":    r["start_seconds"],
            "end":      r["end_seconds"],
        }
        for r in rows
    ]


@router.post("/{video_id}/segments/refresh")
async def refresh_segments(video_id: str, db: DB = Depends(get_db)):
    from services import sponsorblock
    if not db.get_video(video_id):
        raise HTTPException(404, "Video not found")
    count = await sponsorblock.sync_video_segments(video_id)
    return {"video_id": video_id, "count": count}


@router.post("/{video_id}/playback", response_model=VideoOut)
def update_playback(video_id: str, body: PlaybackUpdate, db: DB = Depends(get_db)):
    row = db.get_video(video_id)
    if not row:
        raise HTTPException(404, "Video not found")
    # Rate is a single global preference — changing it on a video is the same
    # as editing /settings. Music has its OWN rate so cranking a podcast to
    # 1.5× never affects clip playback (and vice-versa).
    if body.rate is not None:
        is_music = bool(row["is_music"]) or bool(row["is_music_via_playlist"])
        key = "music_playback_rate" if is_music else "default_playback_rate"
        db.set_settings({key: body.rate})
    db.update_playback(
        video_id,
        position=body.position,
        mark_watched=body.mark_watched,
    )
    return VideoOut.from_row(db.get_video(video_id))


@router.get("/{video_id}/related", response_model=list[VideoOut])
def related(
    video_id: str,
    limit: int = Query(default=12, le=50),
    db: DB = Depends(get_db),
):
    row = db.get_video(video_id)
    if not row:
        raise HTTPException(404, "Video not found")
    rows = db.list_related(
        video_id=video_id,
        channel_id=row["channel_id"],
        title=row["title"] or "",
        limit=limit,
    )
    return [VideoOut.from_row(r) for r in rows]
