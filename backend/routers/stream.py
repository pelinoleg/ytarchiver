from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse

from db.database import DB, get_db
from services import audio as audio_service


router = APIRouter()


@router.get("/{video_id}")
def stream_video(video_id: str, height: int | None = None, db: DB = Depends(get_db)):
    """Serve the primary video by default; serve an alternative-resolution
    variant when ``?height=N`` matches an existing ``video_variants`` row.

    Falls back to the primary file when the requested variant isn't
    available — so a stale ``?height=`` query parameter never 404s when
    the variant was deleted.
    """
    row = db.get_video(video_id)
    if not row:
        raise HTTPException(404, "Video not available")

    if height:
        variant = db.get_video_variant(video_id, height)
        if variant and variant["status"] == "done" and variant["file_path"]:
            vp = Path(variant["file_path"])
            if vp.exists():
                return FileResponse(str(vp), media_type="video/mp4",
                                    headers={"Accept-Ranges": "bytes"})
        # Fall through to primary on miss.

    if not row["file_path"]:
        raise HTTPException(404, "Video not available")
    p = Path(row["file_path"])
    if not p.exists():
        raise HTTPException(404, "File missing on disk")
    return FileResponse(str(p), media_type="video/mp4", headers={"Accept-Ranges": "bytes"})


@router.get("/thumbnail/{video_id}")
def stream_thumbnail(video_id: str, db: DB = Depends(get_db)):
    row = db.get_video(video_id)
    if not row or not row["thumbnail_path"]:
        raise HTTPException(404)
    p = Path(row["thumbnail_path"])
    if not p.exists():
        raise HTTPException(404)
    media = "image/jpeg" if p.suffix.lower() in {".jpg", ".jpeg"} else f"image/{p.suffix.lstrip('.').lower()}"
    return FileResponse(str(p), media_type=media)


@router.get("/subtitle/{video_id}")
def stream_subtitle(video_id: str, db: DB = Depends(get_db)):
    row = db.get_video(video_id)
    if not row or not row["subtitle_path"]:
        raise HTTPException(404)
    p = Path(row["subtitle_path"])
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(str(p), media_type="text/vtt")


@router.get("/preview/{video_id}")
def stream_preview(video_id: str, db: DB = Depends(get_db)):
    row = db.get_video(video_id)
    if not row or not row["preview_path"]:
        raise HTTPException(404)
    p = Path(row["preview_path"])
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(str(p), media_type="video/mp4", headers={"Accept-Ranges": "bytes"})


@router.get("/audio/{video_id}")
def stream_audio(video_id: str, bg: BackgroundTasks, db: DB = Depends(get_db)):
    """Serve the audio-only sidecar (m4a) for bandwidth-saving music playback.

    If the sidecar hasn't been extracted yet, kick the extraction off in the
    background and return 404 — the client falls back to the full-video stream
    for this play and gets audio-only on the next one.
    """
    row = db.get_video(video_id)
    if not row:
        raise HTTPException(404, "Video not available")
    ap = row["audio_path"]
    if ap and Path(ap).exists():
        return FileResponse(str(ap), media_type="audio/mp4", headers={"Accept-Ranges": "bytes"})
    if row["file_path"]:
        bg.add_task(audio_service.extract_audio_for_video, video_id)
    raise HTTPException(404, "Audio sidecar not ready yet")
