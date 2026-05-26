"""Channel folder management — minimal CRUD over ``channel_folders``.

Folders are an optional grouping layer for subscribed channels. A channel
with ``folder_id IS NULL`` is "ungrouped" and renders in the default
top-of-sidebar list — identical to the pre-folders experience.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from db.database import DB, get_db


router = APIRouter()


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    position: int = 0
    created_at: Optional[str] = None

    @classmethod
    def from_row(cls, row):
        return cls.model_validate(dict(row))


class FolderCreate(BaseModel):
    name: str
    position: int = 0


class FolderUpdate(BaseModel):
    name:     Optional[str] = None
    position: Optional[int] = None


@router.get("", response_model=list[FolderOut])
def list_folders(db: DB = Depends(get_db)):
    return [FolderOut.from_row(r) for r in db.list_channel_folders()]


@router.post("", response_model=FolderOut, status_code=201)
def create_folder(body: FolderCreate, db: DB = Depends(get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Folder name is required")
    fid = db.add_channel_folder(name=name, position=body.position)
    row = db.conn.execute(
        "SELECT * FROM channel_folders WHERE id = ?", (fid,),
    ).fetchone()
    return FolderOut.from_row(row)


@router.patch("/{folder_id}", response_model=FolderOut)
def update_folder(folder_id: int, body: FolderUpdate, db: DB = Depends(get_db)):
    row = db.conn.execute(
        "SELECT * FROM channel_folders WHERE id = ?", (folder_id,),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Folder not found")
    fields = body.model_dump(exclude_unset=True)
    if "name" in fields:
        fields["name"] = (fields["name"] or "").strip()
        if not fields["name"]:
            raise HTTPException(400, "Folder name cannot be blank")
    db.update_channel_folder(folder_id, fields)
    row = db.conn.execute(
        "SELECT * FROM channel_folders WHERE id = ?", (folder_id,),
    ).fetchone()
    return FolderOut.from_row(row)


@router.delete("/{folder_id}", status_code=204)
def delete_folder(folder_id: int, db: DB = Depends(get_db)):
    if not db.conn.execute(
        "SELECT 1 FROM channel_folders WHERE id = ?", (folder_id,),
    ).fetchone():
        raise HTTPException(404, "Folder not found")
    db.delete_channel_folder(folder_id)
    return None
