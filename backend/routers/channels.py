import shutil
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from config import settings as env_settings
from db.database import DB, get_db
from models import ChannelCreate, ChannelOut, Quality
from services import sync


router = APIRouter()


class ChannelUpdate(BaseModel):
    quality: Optional[Quality] = None
    retention_days: Optional[int] = None         # null = inherit global default
    sync_interval_minutes: Optional[int] = None  # null = inherit global default
    show_on_home: Optional[bool] = None
    folder_id: Optional[int] = None              # null = un-group (move to top)
    latest_count: Optional[int] = None
    download_policy: Optional[str] = None        # changing it recomputes download_from_date


@router.get("", response_model=list[ChannelOut])
def list_channels(db: DB = Depends(get_db)):
    rows = db.list_channels()
    return [ChannelOut.from_row(r) for r in rows]


@router.post("", response_model=ChannelOut, status_code=201)
def subscribe_channel(
    body: ChannelCreate,
    bg: BackgroundTasks,
    db: DB = Depends(get_db),
):
    try:
        channel_id = sync.subscribe_channel(
            db,
            url=body.url,
            download_policy=body.download_policy,
            quality=body.quality,
            retention_days=body.retention_days,
            sync_interval_minutes=body.sync_interval_minutes,
            show_on_home=body.show_on_home,
            folder_id=body.folder_id,
            latest_count=body.latest_count,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to resolve channel: {e}")

    ch = db.get_channel(channel_id)
    if ch:
        db.log_event("channel_subscribed",
                     message=f"policy={body.download_policy}",
                     channel_id=channel_id, channel_name=ch["name"])

    # Initial pass depends on the policy:
    #   new-only         → record a baseline (status='skipped'), no backfill
    #   latest           → grab top-N videos via cheap flat extract
    #   last-N / all     → one-shot dated backfill walking newest → cutoff
    # Periodic syncs (scheduler / "Sync now") just look for new uploads.
    if body.download_policy == "new-only":
        bg.add_task(_baseline_in_background, channel_id)
    elif body.download_policy == "latest":
        bg.add_task(_latest_n_in_background, channel_id)
    else:
        bg.add_task(_initial_backfill_in_background, channel_id)

    row = db.get_channel(channel_id)
    return ChannelOut.from_row(row)


@router.patch("/{channel_id}", response_model=ChannelOut)
def update_channel(channel_id: int, body: ChannelUpdate, db: DB = Depends(get_db)):
    from services import ytdlp_service
    if not db.get_channel(channel_id):
        raise HTTPException(404, "Channel not found")
    fields = body.model_dump(exclude_unset=True)
    # Policy edits cascade to download_from_date / latest_count, so the
    # next Rebuild does the right thing without surprises.
    if "download_policy" in fields:
        policy = fields["download_policy"]
        if policy == "latest":
            fields["download_from_date"] = None
            # leave latest_count as provided by the caller (or untouched)
        else:
            fields["download_from_date"] = ytdlp_service.policy_to_after_date(policy)
            if "latest_count" not in fields:
                fields["latest_count"] = None
    db.update_channel_fields(channel_id, fields)
    return ChannelOut.from_row(db.get_channel(channel_id))


@router.delete("/{channel_id}", status_code=204)
def unsubscribe_channel(channel_id: int, db: DB = Depends(get_db)):
    ch = db.get_channel(channel_id)
    if not ch:
        raise HTTPException(404, "Channel not found")
    # Wipe the channel's video folder before the FK CASCADE removes the rows.
    channel_dir = Path(env_settings.download_dir).expanduser().resolve() / str(channel_id)
    if channel_dir.exists():
        shutil.rmtree(channel_dir, ignore_errors=True)
    db.delete_channel(channel_id)
    db.log_event("channel_unsubscribed",
                 message=f"{ch['video_count']} archived videos removed",
                 channel_id=channel_id, channel_name=ch["name"])
    return None


@router.post("/{channel_id}/sync")
def manual_sync(channel_id: int, db: DB = Depends(get_db)):
    """User-initiated sync. Runs inline so the response carries the result
    (added count or error) — bg task would return immediately and leave the
    UI guessing what happened."""
    if not db.get_channel(channel_id):
        raise HTTPException(404, "Channel not found")
    try:
        added = sync.sync_channel(db, channel_id)
        return {"status": "ok", "added": added}
    except Exception as e:
        # Persist the failure so the channel header surfaces it.
        try:
            db.conn.execute(
                "UPDATE channels SET last_sync_error = ?, last_synced = datetime('now') WHERE id = ?",
                (str(e)[:500], channel_id),
            )
            db.conn.commit()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=str(e)[:300])


@router.post("/{channel_id}/backfill")
def manual_backfill(channel_id: int, bg: BackgroundTasks, db: DB = Depends(get_db)):
    """Re-run the dated initial backfill for an existing channel.
    Useful if the channel was set up before the dated-fetch fix and ended up
    with the wrong slice of videos."""
    if not db.get_channel(channel_id):
        raise HTTPException(404, "Channel not found")
    bg.add_task(_initial_backfill_in_background, channel_id)
    return {"status": "backfill_started"}


@router.post("/{channel_id}/rebuild")
def rebuild_channel(channel_id: int, bg: BackgroundTasks, db: DB = Depends(get_db)):
    """Wipe everything for this channel (files + DB rows) and run the initial
    sync from scratch using the channel's current settings (quality, latest_count,
    date cutoff). Use this when you change settings and want a fresh download
    that honors them."""
    ch = db.get_channel(channel_id)
    if not ch:
        raise HTTPException(404, "Channel not found")

    # Wipe files on disk.
    channel_dir = Path(env_settings.download_dir).expanduser().resolve() / str(channel_id)
    if channel_dir.exists():
        shutil.rmtree(channel_dir, ignore_errors=True)

    # Hard-delete all video rows for this channel. (Soft-delete would leave
    # ghost rows that block re-add via video_exists check.)
    db.conn.execute("DELETE FROM videos WHERE channel_id = ?", (channel_id,))
    db.conn.execute("UPDATE channels SET last_synced = NULL WHERE id = ?", (channel_id,))
    db.conn.commit()
    db.log_event("channel_rebuild", channel_id=channel_id, channel_name=ch["name"])

    # Pick the right initial pass based on the saved download_policy.
    policy = ch["download_policy"]
    if not policy:
        # Legacy row — infer.
        if ch["latest_count"]:
            policy = "latest"
        elif ch["download_from_date"] is None:
            policy = "all"
        else:
            policy = "last-30"  # safe default for unknown legacy date

    if policy == "new-only":
        bg.add_task(_baseline_in_background, channel_id)
    elif policy == "latest":
        bg.add_task(_latest_n_in_background, channel_id)
    else:
        bg.add_task(_initial_backfill_in_background, channel_id)

    return {"status": "rebuild_started"}


def _sync_in_background(channel_id: int) -> None:
    """Background tasks get a fresh DB connection — the request-scoped one is closed."""
    from db.database import DB as _DB, get_connection
    conn = get_connection()
    try:
        sync.sync_channel(_DB(conn), channel_id)
    finally:
        conn.close()


def _baseline_in_background(channel_id: int) -> None:
    from db.database import DB as _DB, get_connection
    conn = get_connection()
    try:
        sync.initialize_baseline(_DB(conn), channel_id)
    finally:
        conn.close()


def _initial_backfill_in_background(channel_id: int) -> None:
    from db.database import DB as _DB, get_connection
    conn = get_connection()
    try:
        sync.initial_backfill(_DB(conn), channel_id)
    finally:
        conn.close()


def _latest_n_in_background(channel_id: int) -> None:
    from db.database import DB as _DB, get_connection
    conn = get_connection()
    try:
        sync.initialize_latest_n(_DB(conn), channel_id)
    finally:
        conn.close()
