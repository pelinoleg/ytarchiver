from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    data_dir: str = "./data"
    download_dir: str = "./downloads"
    db_path: str = "./data/ytarchiver.db"
    log_level: str = "INFO"

    sync_interval_minutes: int = 240
    sync_jitter_minutes: int = 60
    # Periodic sync only: how many recent entries to check per scheduled run.
    # Periodic uses a cheap flat extract — no dates, just looking for new ids.
    max_videos_per_channel_scan: int = 50
    # One-shot initial backfill cap for last-N / all policies. The initial fetch
    # walks newest → oldest doing per-video metadata reads (slow, but accurate
    # date filtering) and stops either at the cutoff or this safety cap.
    initial_backfill_hard_cap: int = 500

    default_quality: str = "1080"
    default_retention_days: int = 0
    default_playback_rate: float = 1.0
    # Music has its own rate so cranking a podcast to 1.5× never affects the
    # speed at which clips play (and vice-versa). Defaults to 1× regardless.
    music_playback_rate: float = 1.0
    delete_after_watched_percent: int = 0

    sponsorblock_api: str = "https://sponsor.ajay.app"
    sponsorblock_refresh_days: int = 7

    # Worker politeness — random pause between consecutive downloads to avoid
    # hammering YouTube.
    between_downloads_min_seconds: int = 5
    between_downloads_max_seconds: int = 15

    # Hover-preview generation (ffmpeg).
    preview_width: int = 480
    preview_crf: int = 27
    preview_segments: int = 12

    # Music queue side-panel cap on the watch page.
    music_queue_panel_size: int = 100

    # Mini-PiP — keep video playing in a floating widget when leaving /watch.
    mini_player_enabled: bool = True

    # Personal / LAN-only deployment — accept any origin so the PWA works from
    # the phone over Wi-Fi. The service should never be exposed to the public
    # internet anyway.
    cors_origins: list[str] = ["*"]


settings = Settings()

Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
Path(settings.download_dir).mkdir(parents=True, exist_ok=True)
