"""One-shot variant downloads: fetch an alternative resolution for an
already-archived video and register it in ``video_variants``.

Unlike the main ``DownloadWorker``, variants are pulled synchronously from
a FastAPI BackgroundTask — there's no queue, no progress hooks (the user
sees status flip from "pending" → "done" / "error" via polling). Files
land at ``<download_dir>/<channel>/<video>/video-<H>.mp4`` so the primary
``video.mp4`` is untouched.
"""
from __future__ import annotations

import logging
from pathlib import Path

import yt_dlp

from config import settings
from db.database import get_connection, DB
from services.downloader import build_format_string
from services.ytdlp_service import yt_opts_extra


log = logging.getLogger(__name__)


def download_variant(*, video_id: str, channel_id: int, height: int) -> None:
    """Top-level entry point. Looks up the variant row by (video_id, height),
    flips it through ``downloading`` → ``done`` / ``error``, and stores
    the resulting file path + size. Idempotent — re-running for an existing
    completed variant is a no-op."""
    conn = get_connection()
    db = DB(conn)
    try:
        variant = db.get_video_variant(video_id, height)
        if not variant:
            log.warning("variant download requested for %s @ %dp but no row exists",
                        video_id, height)
            return
        if variant["status"] == "done" and Path(variant["file_path"]).exists():
            return  # already there

        db.set_variant_status(variant["id"], "downloading")

        output_dir = (
            Path(settings.download_dir).expanduser().resolve()
            / str(channel_id) / video_id
        )
        output_dir.mkdir(parents=True, exist_ok=True)
        target = output_dir / f"video-{height}.mp4"

        opts = {
            # Re-use the main format-string cascade — same H.264 → VP9 →
            # any-non-AV1 preference, just clamped to this height. The
            # ``[height<=H]`` filters in the cascade naturally apply.
            "format": build_format_string(str(height)),
            "merge_output_format": "mp4",
            "outtmpl": str(output_dir / f"video-{height}.%(ext)s"),
            # We don't need the info.json / thumbs / subs again — those
            # were stored alongside the primary download. Variants are
            # video-only artefacts.
            "writeinfojson": False,
            "writethumbnail": False,
            "writesubtitles": False,
            "ignoreerrors": False,
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "postprocessors": [
                {"key": "FFmpegVideoConvertor", "preferedformat": "mp4"},
            ],
        }
        url = f"https://www.youtube.com/watch?v={video_id}"
        log.info("variant download: %s @ %dp → %s", video_id, height, target)

        try:
            with yt_dlp.YoutubeDL({**opts, **yt_opts_extra()}) as ydl:
                ydl.extract_info(url, download=True)
        except Exception as e:
            log.exception("variant download failed for %s @ %dp", video_id, height)
            db.set_variant_status(variant["id"], "error", error_message=str(e)[:500])
            return

        if not target.exists():
            db.set_variant_status(variant["id"], "error",
                                  error_message="Downloader exited without writing target file")
            return

        size = target.stat().st_size
        db.set_variant_status(
            variant["id"], "done",
            file_path=str(target),
            file_size_bytes=size,
        )
        log.info("variant done: %s @ %dp size=%d", video_id, height, size)
    finally:
        conn.close()
