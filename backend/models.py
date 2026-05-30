import json
from typing import Optional, Literal, Any
from pydantic import BaseModel, ConfigDict


DownloadPolicy = Literal["new-only", "last-7", "last-30", "last-90", "last-365", "all", "latest"]
Quality = Literal["1080", "720", "480", "360", "best"]
VideoStatus = Literal["pending", "queued", "downloading", "done", "error", "skipped", "deleted"]


def _from_row(cls, row):
    """Build a Pydantic model from an sqlite3.Row (or any mapping)."""
    if row is None:
        return None
    data = dict(row)
    # Decode chapters JSON if present
    if "chapters_json" in data and data["chapters_json"]:
        try:
            data["chapters"] = json.loads(data["chapters_json"])
        except (ValueError, TypeError):
            data["chapters"] = None
    return cls.model_validate(data)


class ChannelCreate(BaseModel):
    url: str
    download_policy: DownloadPolicy = "new-only"
    quality: Optional[Quality] = None
    retention_days: Optional[int] = None
    sync_interval_minutes: Optional[int] = None
    show_on_home: bool = True
    folder_id: Optional[int] = None
    latest_count: Optional[int] = None  # only meaningful when download_policy == "latest"


class ChannelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    yt_channel_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    subscriber_count: Optional[int] = None
    quality: Optional[str] = None
    retention_days: Optional[int] = None
    sync_interval_minutes: Optional[int] = None
    show_on_home: bool = True
    folder_id: Optional[int] = None
    latest_count: Optional[int] = None
    download_policy: Optional[str] = None
    download_from_date: Optional[str] = None
    last_synced: Optional[str] = None
    last_sync_added_count: Optional[int] = None
    last_sync_error: Optional[str] = None
    video_count: int = 0
    recent_count: int = 0
    created_at: Optional[str] = None

    @classmethod
    def from_row(cls, row):
        return _from_row(cls, row)


class VideoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    video_id: str
    channel_id: int
    channel_name: Optional[str] = None
    channel_thumbnail: Optional[str] = None
    title: str
    description: Optional[str] = None
    duration: Optional[int] = None
    upload_date: Optional[str] = None
    upload_timestamp: Optional[int] = None
    thumbnail_url: Optional[str] = None
    thumbnail_path: Optional[str] = None
    file_path: Optional[str] = None
    quality: Optional[str] = None
    width: Optional[int] = None
    status: VideoStatus
    progress: Optional[str] = None
    error_message: Optional[str] = None
    file_size_bytes: Optional[int] = None
    chapters: Optional[list[dict[str, Any]]] = None
    has_subtitle: bool = False
    has_preview:  bool = False
    added_at: Optional[str] = None
    downloaded_at: Optional[str] = None
    last_watched_at: Optional[str] = None
    last_position_seconds: Optional[float] = None
    keep_forever: bool = False
    is_favorite:  bool = False
    is_music:     bool = False
    # True when at least one playlist containing this video has keep_videos_forever=1.
    # Only populated by ``get_video``; list endpoints leave it as False.
    kept_by_playlist: bool = False
    # True when the video is music only because it's a member of a music
    # playlist (i.e. the inheritance route). Populated by ``get_video`` and
    # ``list_music_videos``.
    is_music_via_playlist: bool = False
    # The playlist a queued video belongs to, if any — used by the Downloads
    # page to group the queue. Only populated by ``list_active_queue``; a video
    # in several playlists reports the lowest playlist id.
    playlist_id: Optional[int] = None
    playlist_title: Optional[str] = None

    @classmethod
    def from_row(cls, row):
        m = _from_row(cls, row)
        if m is not None:
            try:
                m.has_subtitle = bool(row["subtitle_path"])
            except (KeyError, IndexError):
                pass
            try:
                m.has_preview = bool(row["preview_path"])
            except (KeyError, IndexError):
                pass
        return m


class GlobalSettings(BaseModel):
    default_quality: Quality = "1080"
    default_retention_days: int = 0
    default_playback_rate: float = 1.0
    music_playback_rate: float = 1.0
    delete_after_watched_percent: int = 0       # 0 = disabled
    sync_interval_minutes: int = 240
    sync_jitter_minutes: int = 60
    initial_backfill_hard_cap: int = 500
    max_videos_per_channel_scan: int = 50
    # Advanced knobs.
    between_downloads_min_seconds: int = 5
    between_downloads_max_seconds: int = 15
    max_concurrent_downloads: int = 1
    preview_width: int = 480
    preview_crf: int = 27
    preview_segments: int = 12
    music_queue_panel_size: int = 100
    mini_player_enabled: bool = True
    sponsorblock_refresh_days: int = 7
    sponsorblock_categories: list[str] = [
        "sponsor", "selfpromo", "interaction", "intro", "outro", "music_offtopic"
    ]
