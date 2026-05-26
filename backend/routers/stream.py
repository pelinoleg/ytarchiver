from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from db.database import DB, get_db


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
