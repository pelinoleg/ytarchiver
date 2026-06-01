"""Export / import — JSON dump of subscriptions, playlists, folders, settings.

No videos and no history — those are recoverable by re-running sync. Idempotent
on import: existing URLs / folder names are skipped, only new ones get added.

Version 2 added ``folders`` (the channel folder list itself) and embeds the
folder name on each channel so re-imports preserve grouping. Version 1 imports
are still accepted — they just have no folder info to apply.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from db.database import DB, get_db
from services import sync, playlist_sync, ytdlp_service, backup_job


router = APIRouter()
log = logging.getLogger(__name__)


EXPORT_VERSION = backup_job.EXPORT_VERSION


# ── Export ──────────────────────────────────────────────────────────────────────


@router.get("/export")
def export_all(db: DB = Depends(get_db)):
    # Same payload the daily auto-backup writes to disk — built in one place.
    payload = backup_job.build_config_payload(db)
    # Force the browser to download instead of preview.
    return JSONResponse(
        content=payload,
        headers={
            "Content-Disposition": f"attachment; filename=ytarchive-backup-{datetime.utcnow():%Y%m%d-%H%M%S}.json",
        },
    )


# ── Automatic backup (daily, single latest copy on disk) ─────────────────────────


@router.get("/auto")
def auto_status():
    """Lightweight status for the Settings UI — does a backup exist, and when."""
    data = backup_job.read_auto_config()
    if not data:
        return {"exists": False}
    p = backup_job.auto_config_path()
    return {
        "exists":      True,
        "exported_at": data.get("exported_at"),
        "channels":    len(data.get("channels") or []),
        "playlists":   len(data.get("playlists") or []),
        "folders":     len(data.get("folders") or []),
        "settings":    len(data.get("settings") or {}),
        "size_bytes":  p.stat().st_size if p.exists() else 0,
    }


@router.get("/auto/content")
def auto_content():
    """Full payload, fed straight into the import-review modal for a restore."""
    data = backup_job.read_auto_config()
    if not data:
        raise HTTPException(404, "No automatic backup has been written yet")
    return data


@router.get("/auto/download")
def auto_download():
    p = backup_job.auto_config_path()
    if not p.exists():
        raise HTTPException(404, "No automatic backup has been written yet")
    return FileResponse(p, media_type="application/json", filename="ytarchive-auto-backup.json")


@router.post("/auto/run")
def auto_run(bg: BackgroundTasks):
    """Write a fresh snapshot now instead of waiting for the daily tick."""
    bg.add_task(backup_job.auto_config_backup)
    return {"status": "started"}


# ── Import ──────────────────────────────────────────────────────────────────────


class ImportBody(BaseModel):
    version:   int = 1
    folders:   list[dict[str, Any]] = []
    channels:  list[dict[str, Any]] = []
    playlists: list[dict[str, Any]] = []
    settings:  dict[str, Any] = {}


class ImportReport(BaseModel):
    folders_added:     int = 0
    folders_skipped:   int = 0
    channels_added:    int = 0
    channels_skipped:  int = 0
    playlists_added:   int = 0
    playlists_skipped: int = 0
    settings_applied:  int = 0
    errors:            list[str] = []


@router.post("/import", response_model=ImportReport)
def import_all(body: ImportBody, bg: BackgroundTasks, db: DB = Depends(get_db)):
    if body.version not in (1, 2):
        raise HTTPException(400, f"Unsupported backup version: {body.version}")
    report = ImportReport()

    # 1. Folders — create the missing ones up-front so channels can reference
    #    them by name. NOCASE-compare against existing folders to avoid the
    #    classic "Music" vs "music" duplicate.
    existing_folders = {r["name"].casefold(): r["id"] for r in db.list_channel_folders()}
    folder_id_by_name: dict[str, int] = dict(
        (r["name"].casefold(), r["id"]) for r in db.list_channel_folders()
    )
    for f in body.folders or []:
        name = (f.get("name") or "").strip()
        if not name:
            continue
        if name.casefold() in existing_folders:
            report.folders_skipped += 1
            folder_id_by_name[name.casefold()] = existing_folders[name.casefold()]
            continue
        try:
            fid = db.add_channel_folder(name, int(f.get("position") or 0))
            folder_id_by_name[name.casefold()] = fid
            report.folders_added += 1
        except Exception as e:
            report.errors.append(f"folder {name}: {e}")

    # 2. Channels — re-subscribe via the regular sync helper (which resolves the
    #    channel id from URL, creates the row, and queues a first-sync run).
    existing_ch = {r["url"] for r in db.list_channels()}
    for c in body.channels:
        url = c.get("url")
        if not url or url in existing_ch:
            report.channels_skipped += 1
            continue
        try:
            folder_id = None
            folder_name = (c.get("folder") or "").strip()
            if folder_name:
                folder_id = folder_id_by_name.get(folder_name.casefold())
            cid = sync.subscribe_channel(
                db,
                url=url,
                download_policy=c.get("download_policy") or "new-only",
                quality=c.get("quality"),
                retention_days=c.get("retention_days"),
                sync_interval_minutes=c.get("sync_interval_minutes"),
                show_on_home=bool(c.get("show_on_home", True)),
                latest_count=c.get("latest_count"),
                folder_id=folder_id,
            )
            report.channels_added += 1
            bg.add_task(_channel_sync_bg, cid)
        except Exception as e:
            report.errors.append(f"channel {url}: {e}")

    # 3. Playlists.
    existing_pl = {
        r["url"] for r in db.conn.execute("SELECT url FROM playlists").fetchall()
    }
    for p in body.playlists:
        url = p.get("url")
        if not url or url in existing_pl:
            report.playlists_skipped += 1
            continue
        try:
            pid = playlist_sync.subscribe_playlist(
                db, url=url,
                quality=p.get("quality"),
                retention_days=p.get("retention_days"),
            )
            patch: dict[str, Any] = {}
            if "keep_videos_forever" in p: patch["keep_videos_forever"] = int(bool(p["keep_videos_forever"]))
            if "is_music"            in p: patch["is_music"]            = int(bool(p["is_music"]))
            if patch:
                db.update_playlist_fields(pid, patch)
            report.playlists_added += 1
            bg.add_task(_playlist_sync_bg, pid)
        except Exception as e:
            report.errors.append(f"playlist {url}: {e}")

    # 4. Settings — KV merge. Lists stored as comma-joined strings (matches what
    #    the settings router already does for ``sponsorblock_categories``).
    flattened: dict[str, str] = {}
    for k, v in (body.settings or {}).items():
        if v is None:
            continue
        if isinstance(v, list):
            flattened[k] = ",".join(str(x) for x in v)
        elif isinstance(v, bool):
            flattened[k] = "1" if v else "0"
        else:
            flattened[k] = str(v)
    if flattened:
        db.set_settings(flattened)
        report.settings_applied = len(flattened)

    return report


class PreviewBody(BaseModel):
    url:  str
    kind: str   # "channel" | "playlist"


@router.post("/preview")
def preview_url(body: PreviewBody):
    """Resolve a YouTube URL into displayable metadata for the import-review
    modal. Lets users see the channel/playlist name and avatar even when the
    backup JSON only stored URLs (older exports, hand-crafted imports)."""
    url = body.url.strip()
    if not url:
        raise HTTPException(400, "url is required")
    try:
        if body.kind == "channel":
            normalized = ytdlp_service.normalize_channel_url(url)
            info = ytdlp_service.fetch_channel_info(normalized)
            return {
                "kind": "channel",
                "url":  normalized,
                "name": info.get("name"),
                "thumbnail_url":    info.get("thumbnail_url"),
                "subscriber_count": info.get("subscriber_count"),
            }
        if body.kind == "playlist":
            info = ytdlp_service.fetch_playlist_info(url)
            return {
                "kind":          "playlist",
                "url":           url,
                "title":         info.get("title"),
                "thumbnail_url": info.get("thumbnail_url"),
                "uploader":      info.get("uploader"),
                "video_count":   info.get("video_count"),
            }
        raise HTTPException(400, f"unknown kind: {body.kind}")
    except HTTPException:
        raise
    except Exception as e:
        # Don't fail the whole modal — return a typed error the UI can render
        # next to the row, the user can still skip or import as-is.
        raise HTTPException(400, f"resolve failed: {str(e)[:200]}")


def _channel_sync_bg(channel_id: int) -> None:
    from db.database import DB as _DB, get_connection
    conn = get_connection()
    try:
        sync.sync_channel(_DB(conn), channel_id)
    except Exception:
        log.exception("backup-import: initial sync failed for channel %s", channel_id)
    finally:
        conn.close()


def _playlist_sync_bg(playlist_id: int) -> None:
    from db.database import DB as _DB, get_connection
    conn = get_connection()
    try:
        playlist_sync.sync_playlist(_DB(conn), playlist_id)
    except Exception:
        log.exception("backup-import: initial sync failed for playlist %s", playlist_id)
    finally:
        conn.close()
