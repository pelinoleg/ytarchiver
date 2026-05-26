from fastapi import APIRouter, Depends

from db.database import DB, get_db
from models import VideoOut


router = APIRouter()


@router.get("", response_model=list[VideoOut])
def list_manual(limit: int = 120, offset: int = 0, db: DB = Depends(get_db)):
    rows = db.list_manual_videos(limit=limit, offset=offset)
    return [VideoOut.from_row(r) for r in rows]


@router.get("/count")
def count_manual(db: DB = Depends(get_db)):
    return {"count": db.count_manual_videos()}
