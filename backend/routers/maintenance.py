"""Manual triggers for housekeeping jobs that normally run on the scheduler."""
from fastapi import APIRouter, Depends

from db.database import DB, get_db
from services import cleanup as cleanup_service
from services import integrity as integrity_service


router = APIRouter()


@router.post("/cleanup")
def run_cleanup():
    """Run the retention + watched-percent cleanup pass now."""
    deleted = cleanup_service.cleanup_expired()
    return {"deleted": deleted}


@router.post("/integrity")
def run_integrity():
    """Verify every downloaded file still exists on disk. Anything missing
    flips to status='deleted' so the next sync re-downloads it."""
    return integrity_service.check_integrity()


@router.get("/integrity/status")
def integrity_status(db: DB = Depends(get_db)):
    """Last-run snapshot for the Storage page header."""
    kv = db.get_settings()
    return {
        "ran_at":  kv.get("integrity_last_ran_at"),
        "checked": int(kv.get("integrity_last_checked") or 0),
        "missing": int(kv.get("integrity_last_missing") or 0),
    }
