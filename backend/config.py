from pathlib import Path
from typing import Annotated
import json
from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


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

    # Path to a Netscape-format ``cookies.txt`` file. When set and the file
    # exists, yt-dlp uses it for every YouTube call — the standard fix for
    # "Sign in to confirm you're not a bot" rate-limits on self-hosted
    # servers (residential IPs are friendlier than data centers, but YT
    # still flags us if we hammer enough). Export via a browser extension
    # (e.g. "Get cookies.txt LOCALLY") while logged into your YT account.
    cookies_file: str = ""

    # Alternative yt-dlp player client. Empty → yt-dlp's default cascade.
    # Common values: ``android``, ``ios``, ``web_safari``. Sometimes the
    # android client gets past bot detection that web/web_embedded can't.
    youtube_player_client: str = ""

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
    #
    # ``NoDecode`` tells pydantic-settings to skip its JSON pre-parsing
    # for this field. Without it, a non-JSON env value like ``CORS_ORIGINS=*``
    # blows up at startup because the env source tries ``json.loads`` first.
    # With NoDecode, the raw env string lands in our validator which knows
    # how to handle JSON / CSV / bare token forms.
    cors_origins: Annotated[list[str], NoDecode] = ["*"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, v):
        """Accept the env value in three friendly forms:

          • JSON array string — ``["http://a", "http://b"]``
          • Comma-separated list — ``http://a, http://b``
          • Bare ``*`` (or any single token)

        Default pydantic-settings behaviour is JSON-only, which means a
        compose file with ``CORS_ORIGINS: "*"`` blows up at startup
        because ``*`` isn't valid JSON. Worse, even ``["*"]`` can arrive
        mangled (single-vs-double quoting) depending on the YAML / shell
        the user wrapped it in. This validator absorbs all of that.
        """
        if v is None or v == "":
            return ["*"]
        if isinstance(v, list):
            return v
        if isinstance(v, str):
            s = v.strip()
            if s.startswith("["):
                # Looks like JSON — try, but don't die if it's quoted weirdly.
                try:
                    parsed = json.loads(s)
                    if isinstance(parsed, list):
                        return [str(x) for x in parsed]
                except json.JSONDecodeError:
                    pass
            # Comma-separated or single value.
            return [tok.strip() for tok in s.split(",") if tok.strip()]
        return ["*"]


settings = Settings()

Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
Path(settings.download_dir).mkdir(parents=True, exist_ok=True)
