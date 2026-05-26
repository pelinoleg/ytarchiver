from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from db.database import DB, get_db
from models import GlobalSettings
from config import settings as env_settings


router = APIRouter()


class SettingsUpdate(BaseModel):
    default_quality: Optional[str] = None
    default_retention_days: Optional[int] = None
    default_playback_rate: Optional[float] = None
    music_playback_rate: Optional[float] = None
    delete_after_watched_percent: Optional[int] = None
    sync_interval_minutes: Optional[int] = None
    sync_jitter_minutes: Optional[int] = None
    initial_backfill_hard_cap: Optional[int] = None
    max_videos_per_channel_scan: Optional[int] = None
    between_downloads_min_seconds: Optional[int] = None
    between_downloads_max_seconds: Optional[int] = None
    preview_width: Optional[int] = None
    preview_crf: Optional[int] = None
    preview_segments: Optional[int] = None
    music_queue_panel_size: Optional[int] = None
    mini_player_enabled: Optional[bool] = None
    sponsorblock_refresh_days: Optional[int] = None
    sponsorblock_categories: Optional[list[str]] = None


def _load_settings(db: DB) -> GlobalSettings:
    """Merge DB-stored overrides on top of env defaults."""
    base = GlobalSettings(
        default_quality=env_settings.default_quality,
        default_retention_days=env_settings.default_retention_days,
        default_playback_rate=env_settings.default_playback_rate,
        music_playback_rate=env_settings.music_playback_rate,
        delete_after_watched_percent=env_settings.delete_after_watched_percent,
        sync_interval_minutes=env_settings.sync_interval_minutes,
        sync_jitter_minutes=env_settings.sync_jitter_minutes,
        initial_backfill_hard_cap=env_settings.initial_backfill_hard_cap,
        max_videos_per_channel_scan=env_settings.max_videos_per_channel_scan,
        between_downloads_min_seconds=env_settings.between_downloads_min_seconds,
        between_downloads_max_seconds=env_settings.between_downloads_max_seconds,
        preview_width=env_settings.preview_width,
        preview_crf=env_settings.preview_crf,
        preview_segments=env_settings.preview_segments,
        music_queue_panel_size=env_settings.music_queue_panel_size,
        mini_player_enabled=env_settings.mini_player_enabled,
        sponsorblock_refresh_days=env_settings.sponsorblock_refresh_days,
    )
    overrides = db.get_settings()
    data = base.model_dump()
    for k, v in overrides.items():
        if k not in data:
            continue
        if k == "sponsorblock_categories" and v:
            data[k] = [c.strip() for c in v.split(",") if c.strip()]
        elif isinstance(data[k], bool):
            data[k] = v in ("1", "true", "True")
        elif isinstance(data[k], int) and v is not None:
            try:
                data[k] = int(v)
            except ValueError:
                pass
        elif isinstance(data[k], float) and v is not None:
            try:
                data[k] = float(v)
            except ValueError:
                pass
        else:
            data[k] = v
    return GlobalSettings(**data)


@router.get("", response_model=GlobalSettings)
def get_settings(db: DB = Depends(get_db)):
    return _load_settings(db)


@router.put("", response_model=GlobalSettings)
def update_settings(body: SettingsUpdate, db: DB = Depends(get_db)):
    raw = body.model_dump(exclude_none=True)
    if "sponsorblock_categories" in raw:
        raw["sponsorblock_categories"] = ",".join(raw["sponsorblock_categories"])
    db.set_settings(raw)
    return _load_settings(db)
