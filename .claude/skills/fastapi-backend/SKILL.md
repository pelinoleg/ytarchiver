---
name: fastapi-backend
description: >
  Use this skill when building or modifying the FastAPI backend for the
  YT Archiver project. Triggers on: create API route, add endpoint, background
  task, WebSocket, scheduler, database query from API, middleware, CORS, file
  serving, streaming video. Do NOT use for yt-dlp CLI options (use
  ytdlp-downloader skill), database schema (use sqlite-db skill), or frontend
  code (use react-frontend skill).
---

# FastAPI Backend Skill

## Project structure

```
backend/
  main.py              # app entry point, lifespan, middleware
  routers/
    videos.py          # /api/videos/*
    channels.py        # /api/channels/*
    queue.py           # /api/queue/*
    stream.py          # /api/stream/* — serve video files
    ws.py              # /ws — WebSocket for download progress
  services/
    downloader.py      # wraps ytdlp-downloader skill functions
    scheduler.py       # APScheduler setup
  db/
    database.py        # SQLite connection (use sqlite-db skill)
    models.py          # dataclasses / Pydantic models
  config.py            # settings via pydantic-settings
```

## App entry point (main.py)

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from routers import videos, channels, queue, stream, ws
from services.scheduler import scheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler.start()
    yield
    scheduler.shutdown()

app = FastAPI(title="YT Archiver", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # React dev server
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(videos.router, prefix="/api/videos")
app.include_router(channels.router, prefix="/api/channels")
app.include_router(queue.router, prefix="/api/queue")
app.include_router(stream.router, prefix="/api/stream")
app.include_router(ws.router)
```

## Config (config.py)

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    downloads_dir: str = "/downloads"
    db_path: str = "./ytarchiver.db"
    sync_interval_hours: int = 6
    max_concurrent_downloads: int = 2

    class Config:
        env_file = ".env"

settings = Settings()
```

## Pydantic models (models.py)

```python
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class ChannelCreate(BaseModel):
    url: str
    name: Optional[str] = None
    sync_interval_hours: int = 6

class ChannelOut(BaseModel):
    id: int
    url: str
    name: str
    channel_id: str
    last_synced: Optional[datetime]
    video_count: int

class VideoOut(BaseModel):
    id: int
    video_id: str
    channel_id: int
    title: str
    duration: Optional[int]
    upload_date: Optional[str]
    file_path: Optional[str]
    status: str   # "queued" | "downloading" | "done" | "error"
    thumbnail_path: Optional[str]

class QueueItem(BaseModel):
    id: int
    video_id: str
    title: str
    status: str
    progress: Optional[str]
    added_at: datetime
```

## Channels router (routers/channels.py)

```python
from fastapi import APIRouter, BackgroundTasks, HTTPException
from models import ChannelCreate, ChannelOut
from services.downloader import subscribe_channel, sync_channel
from db.database import get_db

router = APIRouter()

@router.get("/", response_model=list[ChannelOut])
def list_channels(db=Depends(get_db)):
    return db.get_all_channels()

@router.post("/", response_model=ChannelOut)
def add_channel(body: ChannelCreate, bg: BackgroundTasks, db=Depends(get_db)):
    channel = subscribe_channel(body.url, db)
    bg.add_task(sync_channel, channel.id, db)  # initial sync in background
    return channel

@router.delete("/{channel_id}")
def remove_channel(channel_id: int, db=Depends(get_db)):
    db.delete_channel(channel_id)
    return {"ok": True}

@router.post("/{channel_id}/sync")
def manual_sync(channel_id: int, bg: BackgroundTasks, db=Depends(get_db)):
    bg.add_task(sync_channel, channel_id, db)
    return {"status": "sync_started"}
```

## Videos router (routers/videos.py)

```python
from fastapi import APIRouter, Depends, Query
from models import VideoOut
from db.database import get_db

router = APIRouter()

@router.get("/", response_model=list[VideoOut])
def list_videos(
    channel_id: int | None = None,
    status: str | None = None,
    search: str | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
    db=Depends(get_db),
):
    return db.get_videos(
        channel_id=channel_id, status=status,
        search=search, limit=limit, offset=offset
    )

@router.post("/download")
def download_url(url: str, bg: BackgroundTasks, db=Depends(get_db)):
    """One-off download by URL (not from a subscribed channel)."""
    video_id = db.add_to_queue_by_url(url)
    bg.add_task(download_single, url, video_id, db)
    return {"queued": video_id}

@router.delete("/{video_id}")
def delete_video(video_id: int, db=Depends(get_db)):
    db.delete_video(video_id)
    return {"ok": True}
```

## Video streaming (routers/stream.py)

```python
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
import os

router = APIRouter()

@router.get("/{video_id}")
def stream_video(video_id: str, db=Depends(get_db)):
    video = db.get_video(video_id)
    if not video or not video.file_path:
        raise HTTPException(404, "Video not found")
    if not os.path.exists(video.file_path):
        raise HTTPException(404, "File missing on disk")
    return FileResponse(
        video.file_path,
        media_type="video/mp4",
        headers={"Accept-Ranges": "bytes"},  # enables seeking in browser
    )

@router.get("/thumbnail/{video_id}")
def get_thumbnail(video_id: str, db=Depends(get_db)):
    video = db.get_video(video_id)
    if not video or not video.thumbnail_path:
        raise HTTPException(404)
    return FileResponse(video.thumbnail_path, media_type="image/jpeg")
```

## WebSocket for download progress (routers/ws.py)

```python
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict
import asyncio, json

router = APIRouter()

# Global connection registry: video_id -> list[WebSocket]
_connections: Dict[str, list[WebSocket]] = {}

async def broadcast(data: dict):
    """Called from background task to push progress to all clients."""
    video_id = data.get("video_id", "global")
    for ws in _connections.get(video_id, []):
        try:
            await ws.send_json(data)
        except Exception:
            pass

@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    _connections.setdefault("global", []).append(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep alive
    except WebSocketDisconnect:
        _connections["global"].remove(websocket)
```

## Background download task (services/downloader.py)

```python
import asyncio
from ytdlp_skill import download_video, fetch_channel_videos, make_progress_hook
from config import settings

def sync_channel(channel_id: int, db):
    channel = db.get_channel(channel_id)
    videos = fetch_channel_videos(channel.url, after_date=channel.last_synced_str)
    for v in videos:
        if not db.video_exists(v["id"]):
            db.add_video(channel_id=channel_id, **v)
            _download_queued_video(v["id"], db)
    db.update_last_synced(channel_id)

def _download_queued_video(video_id: str, db):
    video = db.get_video_by_yt_id(video_id)
    output_dir = f"{settings.downloads_dir}/channels/{video.channel_id}"

    def hook(data):
        # sync bridge — broadcast is async but hook is sync
        asyncio.create_task(broadcast({"video_id": video_id, **data}))

    db.set_status(video_id, "downloading")
    try:
        info = download_video(video.url, output_dir, progress_hook=hook)
        db.set_status(video_id, "done", file_path=info.get("_filename"))
    except Exception as e:
        db.set_status(video_id, "error", error=str(e))
```

## Rules

- ALWAYS use `BackgroundTasks` or `asyncio.create_task` — never call yt-dlp synchronously in a route handler
- ALWAYS return proper HTTP status codes: 404 for missing, 422 for validation errors (FastAPI does this automatically with Pydantic)
- Video files MUST be served with `Accept-Ranges: bytes` header — without it, `<video>` seeking won't work
- CORS must allow the React dev origin (`localhost:5173`) during development
- Use `Depends(get_db)` for all DB access — never import db connection globally
- Keep routers thin — all business logic goes in `services/`

## Run

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
