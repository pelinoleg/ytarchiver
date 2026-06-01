"""User-curated local playlists for the Music section.

Distinct from ``routers/playlists.py`` (which mirrors YouTube playlists and is
driven by sync). These are hand-built collections of already-downloaded music
clips — create, rename, add/remove tracks, play.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db.database import DB, get_db
from models import VideoOut


router = APIRouter()


class CollectionCreate(BaseModel):
    name: str


class CollectionRename(BaseModel):
    name: str


class CollectionAdd(BaseModel):
    video_id: str


def _serialize(db: DB, row) -> dict:
    covers = [
        {
            "video_id":       c["video_id"],
            "thumbnail_path": c["thumbnail_path"],
            "thumbnail_url":  c["thumbnail_url"],
        }
        for c in db.collection_cover_videos(row["id"], limit=4)
    ]
    return {
        "id":         row["id"],
        "name":       row["name"],
        "item_count": row["item_count"],
        "done_count": row["done_count"],
        "created_at": row["created_at"],
        "covers":     covers,
    }


@router.get("")
def list_collections(db: DB = Depends(get_db)):
    return [_serialize(db, r) for r in db.list_music_collections()]


@router.post("", status_code=201)
def create_collection(body: CollectionCreate, db: DB = Depends(get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "name is required")
    cid = db.create_music_collection(name)
    return _serialize(db, db.get_music_collection(cid))


@router.get("/{collection_id}")
def get_collection(collection_id: int, db: DB = Depends(get_db)):
    row = db.get_music_collection(collection_id)
    if not row:
        raise HTTPException(404, "collection not found")
    return {
        "collection": _serialize(db, row),
        "videos":     [VideoOut.from_row(r) for r in db.list_collection_videos(collection_id)],
    }


@router.patch("/{collection_id}")
def rename_collection(collection_id: int, body: CollectionRename, db: DB = Depends(get_db)):
    if not db.get_music_collection(collection_id):
        raise HTTPException(404, "collection not found")
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "name is required")
    db.rename_music_collection(collection_id, name)
    return _serialize(db, db.get_music_collection(collection_id))


@router.delete("/{collection_id}", status_code=204)
def delete_collection(collection_id: int, db: DB = Depends(get_db)):
    db.delete_music_collection(collection_id)


@router.post("/{collection_id}/videos", status_code=201)
def add_video(collection_id: int, body: CollectionAdd, db: DB = Depends(get_db)):
    if not db.get_music_collection(collection_id):
        raise HTTPException(404, "collection not found")
    if not db.get_video(body.video_id):
        raise HTTPException(404, "video not found")
    db.add_to_music_collection(collection_id, body.video_id)
    return _serialize(db, db.get_music_collection(collection_id))


@router.delete("/{collection_id}/videos/{video_id}", status_code=204)
def remove_video(collection_id: int, video_id: str, db: DB = Depends(get_db)):
    db.remove_from_music_collection(collection_id, video_id)
