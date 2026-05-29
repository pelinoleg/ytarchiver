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
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from db.database import DB, get_db
from services import sync, playlist_sync, ytdlp_service


router = APIRouter()
log = logging.getLogger(__name__)


EXPORT_VERSION = 2


# ── Export ──────────────────────────────────────────────────────────────────────


def _channel_export(row, folder_name_by_id: dict[int, str]) -> dict:
    """Include user-facing metadata (name, thumbnail) so the importer can
    render a nice review modal without having to re-fetch every channel."""
    folder = folder_name_by_id.get(row["folder_id"]) if row["folder_id"] else None
    return {
        "url":                   row["url"],
        "name":                  row["name"],
        "thumbnail_url":         row["thumbnail_url"],
        "subscriber_count":      row["subscriber_count"],
        "download_policy":       row["download_policy"],
        "quality":               row["quality"],
        "retention_days":        row["retention_days"],
        "sync_interval_minutes": row["sync_interval_minutes"],
        "show_on_home":          bool(row["show_on_home"]),
        "latest_count":          row["latest_count"],
        "download_from_date":    row["download_from_date"],
        "folder":                folder,
    }


def _playlist_export(row) -> dict:
    return {
        "url":                 row["url"],
        "title":               row["title"],
        "thumbnail_url":       row["thumbnail_url"],
        "uploader":            row["uploader"],
        "video_count":         row["video_count"],
        "quality":             row["quality"],
        "retention_days":      row["retention_days"],
        "keep_videos_forever": bool(row["keep_videos_forever"]),
        "is_music":            bool(row["is_music"]),
    }


def _folder_export(row) -> dict:
    return {
        "name":     row["name"],
        "position": row["position"],
    }


@router.get("/export")
def export_all(db: DB = Depends(get_db)):
    folders = list(db.list_channel_folders())
    folder_name_by_id = {r["id"]: r["name"] for r in folders}
    channels  = [_channel_export(r, folder_name_by_id) for r in db.list_channels()]
    playlists = [_playlist_export(r) for r in db.conn.execute(
        "SELECT * FROM playlists ORDER BY id"
    ).fetchall()]
    settings_kv = db.get_settings()
    payload = {
        "version":     EXPORT_VERSION,
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "folders":     [_folder_export(r) for r in folders],
        "channels":    channels,
        "playlists":   playlists,
        "settings":    settings_kv,
    }
    # Force the browser to download instead of preview.
    return JSONResponse(
        content=payload,
        headers={
            "Content-Disposition": f"attachment; filename=ytarchive-backup-{datetime.utcnow():%Y%m%d-%H%M%S}.json",
        },
    )


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
