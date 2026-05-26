from fastapi import APIRouter, Depends, HTTPException

from db.database import DB, get_db
from models import VideoOut


router = APIRouter()


@router.get("", response_model=list[VideoOut])
def get_queue(db: DB = Depends(get_db)):
    rows = db.list_active_queue()
    return [VideoOut.from_row(r) for r in rows]


@router.post("/{video_id}/retry", response_model=VideoOut)
def retry(video_id: str, db: DB = Depends(get_db)):
    row = db.get_video(video_id)
    if not row:
        raise HTTPException(404, "Video not found")
    if row["status"] == "downloading":
        raise HTTPException(409, "Already downloading")
    db.set_video_status(video_id, "pending", error_message=None, progress=None)
    return VideoOut.from_row(db.get_video(video_id))
