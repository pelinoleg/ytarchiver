"""Video variant CRUD — alternative resolutions of an archived video."""
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from config import settings as env_settings
from db.database import DB, get_db
from services.variant_downloader import download_variant


router = APIRouter()


class VariantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    video_id: str
    height: int
    file_path: str
    file_size_bytes: Optional[int] = None
    status: str
    error_message: Optional[str] = None
    created_at: Optional[str] = None

    @classmethod
    def from_row(cls, row):
        return cls.model_validate(dict(row))


class VariantCreate(BaseModel):
    height: int


@router.get("/videos/{video_id}/variants", response_model=list[VariantOut])
def list_variants(video_id: str, db: DB = Depends(get_db)):
    return [VariantOut.from_row(r) for r in db.list_video_variants(video_id)]


@router.post("/videos/{video_id}/variants", response_model=VariantOut, status_code=202)
def create_variant(
    video_id: str, body: VariantCreate, bg: BackgroundTasks, db: DB = Depends(get_db),
):
    row = db.get_video(video_id)
    if not row:
        raise HTTPException(404, "Video not found")
    if body.height < 144 or body.height > 4320:
        raise HTTPException(400, "Height must be between 144 and 4320")

    # Reject if a variant for this height already exists in good standing.
    existing = db.get_video_variant(video_id, body.height)
    if existing and existing["status"] in ("done", "downloading", "pending"):
        return VariantOut.from_row(existing)

    target = (
        Path(env_settings.download_dir).expanduser().resolve()
        / str(row["channel_id"]) / video_id
        / f"video-{body.height}.mp4"
    )
    vid_pk = db.upsert_video_variant(
        video_id=video_id,
        height=body.height,
        file_path=str(target),
        status="pending",
    )
    # Kick off the download outside the request lifecycle so the API
    # responds immediately (download can take 30 s — 5 min depending on
    # source quality and network).
    bg.add_task(download_variant, video_id=video_id, channel_id=row["channel_id"], height=body.height)
    return VariantOut.from_row(db.conn.execute(
        "SELECT * FROM video_variants WHERE id = ?", (vid_pk,),
    ).fetchone())


@router.delete("/variants/{variant_id}", status_code=204)
def delete_variant(variant_id: int, db: DB = Depends(get_db)):
    info = db.delete_video_variant(variant_id)
    if not info:
        raise HTTPException(404, "Variant not found")
    # Remove the on-disk file too. Safe even when missing.
    try:
        p = Path(info["file_path"])
        if p.exists() and p.is_file():
            p.unlink()
    except OSError:
        pass
    return None
