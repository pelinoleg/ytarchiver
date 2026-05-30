from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db.database import DB, get_db
from models import VideoOut
from services.worker import PAUSED_KEY, MAX_CONCURRENT_KEY


router = APIRouter()


class QueueStatus(BaseModel):
    paused: bool
    pending: int
    downloading: int
    error: int
    max_concurrent: int


@router.get("", response_model=list[VideoOut])
def get_queue(db: DB = Depends(get_db)):
    rows = db.list_active_queue()
    return [VideoOut.from_row(r) for r in rows]


@router.get("/status", response_model=QueueStatus)
def queue_status(db: DB = Depends(get_db)):
    kv = db.get_settings()
    counts = {r["status"]: r["c"] for r in db.conn.execute(
        "SELECT status, COUNT(*) AS c FROM videos "
        "WHERE status IN ('pending', 'downloading', 'error') AND is_short = 0 "
        "GROUP BY status"
    ).fetchall()}
    try:
        max_concurrent = max(1, int(kv.get(MAX_CONCURRENT_KEY) or 1))
    except (TypeError, ValueError):
        max_concurrent = 1
    return QueueStatus(
        paused=str(kv.get(PAUSED_KEY) or "").strip().lower() in ("1", "true", "yes", "on"),
        pending=counts.get("pending", 0),
        downloading=counts.get("downloading", 0),
        error=counts.get("error", 0),
        max_concurrent=max_concurrent,
    )


@router.post("/pause", response_model=QueueStatus)
def pause(db: DB = Depends(get_db)):
    """Stop dispatching new downloads. In-flight ones run to completion."""
    db.set_settings({PAUSED_KEY: "1"})
    return queue_status(db)


@router.post("/resume", response_model=QueueStatus)
def resume(db: DB = Depends(get_db)):
    db.set_settings({PAUSED_KEY: "0"})
    return queue_status(db)


@router.post("/retry-all")
def retry_all(db: DB = Depends(get_db)):
    """Requeue every failed video at once."""
    return {"requeued": db.retry_all_failed()}


@router.post("/{video_id}/prioritize", response_model=VideoOut)
def prioritize(video_id: str, db: DB = Depends(get_db)):
    """Move a queued video to the front so it downloads next."""
    if not db.get_video(video_id):
        raise HTTPException(404, "Video not found")
    db.prioritize_video(video_id)
    return VideoOut.from_row(db.get_video(video_id))


@router.post("/{video_id}/retry", response_model=VideoOut)
def retry(video_id: str, db: DB = Depends(get_db)):
    row = db.get_video(video_id)
    if not row:
        raise HTTPException(404, "Video not found")
    if row["status"] == "downloading":
        raise HTTPException(409, "Already downloading")
    db.set_video_status(video_id, "pending", error_message=None, progress=None)
    return VideoOut.from_row(db.get_video(video_id))
