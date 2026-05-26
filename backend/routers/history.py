from fastapi import APIRouter, Depends

from db.database import DB, get_db
from models import VideoOut


router = APIRouter()


@router.get("", response_model=list[VideoOut])
def list_history(limit: int = 200, db: DB = Depends(get_db)):
    rows = db.list_history(limit=limit)
    return [VideoOut.from_row(r) for r in rows]


@router.get("/continue", response_model=list[VideoOut])
def list_continue_watching(limit: int = 20, db: DB = Depends(get_db)):
    """Videos started but not finished — feeds the Home page's Continue row."""
    return [VideoOut.from_row(r) for r in db.list_continue_watching(limit=limit)]
