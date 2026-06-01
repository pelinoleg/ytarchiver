"""Hover-preview generation status + manual controls.

Previews are built by a background backfill loop (see ``services.preview``).
This router surfaces what that loop is doing — how many clips are done, pending,
or have failed — and lets the user kick a retry or run a batch now.
"""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from db.database import DB, get_db
from services import preview as preview_service


router = APIRouter()


@router.get("/status")
def status(db: DB = Depends(get_db)):
    counts = db.preview_status_counts(
        preview_service.MIN_DURATION, preview_service.MAX_PREVIEW_ATTEMPTS,
    )
    return {
        **counts,
        "min_duration":  preview_service.MIN_DURATION,
        "max_attempts":  preview_service.MAX_PREVIEW_ATTEMPTS,
    }


@router.get("/failed")
def failed(limit: int = 200, db: DB = Depends(get_db)):
    rows = db.list_preview_failures(preview_service.MAX_PREVIEW_ATTEMPTS, limit=limit)
    return [dict(r) for r in rows]


@router.post("/{video_id}/retry")
def retry(video_id: str, bg: BackgroundTasks, db: DB = Depends(get_db)):
    """Clear the failure counter and rebuild this one preview in the background."""
    if not db.get_video(video_id):
        raise HTTPException(404, "video not found")
    db.reset_preview_attempts(video_id)
    bg.add_task(preview_service.build_preview_for_video, video_id)
    return {"status": "retrying"}


@router.post("/run")
def run_now(bg: BackgroundTasks, batch: int = 20):
    """Build a batch of pending previews immediately instead of waiting for the
    15-minute scheduler tick."""
    bg.add_task(preview_service.backfill_missing_previews, batch)
    return {"status": "started", "batch": batch}
