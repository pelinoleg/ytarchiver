from typing import Optional

from fastapi import APIRouter, Depends, Query

from db.database import DB, get_db


router = APIRouter()


@router.get("")
def list_events(
    type: Optional[str] = None,
    limit: int = Query(default=200, le=1000),
    offset: int = 0,
    db: DB = Depends(get_db),
):
    rows = db.list_events(type_=type, limit=limit, offset=offset)
    return [dict(r) for r in rows]


@router.get("/types")
def list_event_types(db: DB = Depends(get_db)):
    return {"types": db.list_event_types()}
