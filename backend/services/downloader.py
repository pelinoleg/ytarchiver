"""yt-dlp video downloader. See .claude/skills/ytdlp-downloader/SKILL.md."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Callable, Optional

import yt_dlp


log = logging.getLogger(__name__)


def build_format_string(quality: str | None) -> str:
    """yt-dlp format selector — **guarantees** the output never contains AV1
    and honours the requested resolution when possible.

    YouTube serves three video codecs:
      • H.264 (universal — every device / browser ever)
      • VP9   (universal on iOS 14+, all Chrome/Edge/Firefox)
      • AV1   (broken on iOS < 17, older Android Chrome, Intel Macs)

    YouTube only ships H.264 at heights ≤1080p. Anything above is VP9 +
    AV1 only.

    **Cascade for height ``H``:**

      ``H ≤ 1080`` — H.264 is available at the user's exact height, so we
      prefer it (best compatibility, no resolution sacrifice):
        1. H.264 + AAC at ≤H
        2. VP9 + AAC at ≤H              (fallback if YouTube somehow lacks H.264)
        3. VP9 + opus at ≤H
        4. Any non-AV1 at ≤H

      ``H > 1080`` — H.264 cannot deliver the requested resolution. Prefer
      VP9 at the requested height (modern iOS plays it) over silently
      downgrading to 1080p H.264 — if the user picked 1440p / 2160p they
      probably care about quality:
        1. VP9 + AAC at ≤H              (real 1440 / 2160, iOS 14+)
        2. VP9 + opus at ≤H
        3. H.264 + AAC at ≤1080         (last-resort downgrade for iOS 13)
        4. Any non-AV1 at ≤H

    AV1 is explicitly excluded at every level. If YouTube only has AV1 at
    the requested resolution (vanishingly rare), the download fails with
    yt-dlp's "Requested format is not available" — visible as a real error
    in Downloads — rather than silently writing an unplayable file.
    """
    h264 = "vcodec^=avc1"
    vp9  = "vcodec^=vp09"
    notav1 = "vcodec!^=av01"

    if not quality or quality == "best":
        # ``best`` matches everything; treat as H.264 preferred but allow
        # VP9 high-res when YouTube serves it.
        return (
            f"bestvideo[ext=mp4][{h264}]+bestaudio[ext=m4a]/"
            f"bestvideo[{vp9}]+bestaudio[ext=m4a]/"
            f"bestvideo[{vp9}]+bestaudio/"
            f"bestvideo[{notav1}]+bestaudio/"
            f"best[{notav1}]"
        )
    try:
        h = int(quality)
    except (TypeError, ValueError):
        return build_format_string(None)

    if h <= 1080:
        # H.264 covers this fully — pick it first, then VP9 as backstop.
        return (
            f"bestvideo[ext=mp4][{h264}][height<={h}]+bestaudio[ext=m4a]/"
            f"bestvideo[{vp9}][height<={h}]+bestaudio[ext=m4a]/"
            f"bestvideo[{vp9}][height<={h}]+bestaudio/"
            f"bestvideo[{notav1}][height<={h}]+bestaudio/"
            f"best[{notav1}][height<={h}]/"
            f"best[{notav1}]"
        )

    # > 1080: prefer VP9 at the user's height over an H.264 downgrade.
    return (
        f"bestvideo[{vp9}][height<={h}]+bestaudio[ext=m4a]/"
        f"bestvideo[{vp9}][height<={h}]+bestaudio/"
        f"bestvideo[ext=mp4][{h264}][height<=1080]+bestaudio[ext=m4a]/"
        f"bestvideo[{notav1}][height<={h}]+bestaudio/"
        f"best[{notav1}][height<={h}]/"
        f"best[{notav1}]"
    )


def download_video(
    *,
    video_id: str,
    channel_id: int,
    quality: str | None,
    output_root: str,
    progress_hook: Optional[Callable] = None,
) -> dict:
    """Download a single video. Synchronous — run via ``run_in_executor``.

    Returns a dict with paths and the raw ``info`` dict from yt-dlp.
    """
    # Always store absolute paths in DB — they survive CWD changes (uvicorn --reload).
    output_dir = (Path(output_root).expanduser().resolve() / str(channel_id) / video_id)
    output_dir.mkdir(parents=True, exist_ok=True)

    opts = {
        "format": build_format_string(quality),
        "merge_output_format": "mp4",
        "outtmpl": str(output_dir / "video.%(ext)s"),
        "writeinfojson": True,
        "writethumbnail": True,
        "writesubtitles": True,
        "writeautomaticsub": False,
        "subtitleslangs": ["en.*", "ru.*"],
        "subtitlesformat": "vtt",
        "embedthumbnail": False,
        "embedsubtitles": False,
        "ignoreerrors": False,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "progress_hooks": [progress_hook] if progress_hook else [],
        "postprocessors": [
            {"key": "FFmpegVideoConvertor", "preferedformat": "mp4"},
            {"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"},
        ],
    }

    url = f"https://www.youtube.com/watch?v={video_id}"
    log.info("download: %s quality=%s → %s", video_id, quality, output_dir)

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)

    return {
        "info": info or {},
        "video_path":     _first(output_dir.glob("video.mp4")) or _first_video(output_dir),
        "thumbnail_path": _first_image(output_dir),
        "subtitle_path":  _first_subtitle(output_dir),
        "info_path":      _maybe(output_dir / "video.info.json"),
    }


def build_updates_from_info(result: dict) -> dict:
    """Map yt-dlp info + file paths to DB column updates."""
    info = result.get("info") or {}
    updates: dict = {
        "file_path":      result.get("video_path"),
        "thumbnail_path": result.get("thumbnail_path"),
        "subtitle_path":  result.get("subtitle_path"),
        "info_path":      result.get("info_path"),
    }
    if info.get("upload_date"):
        updates["upload_date"] = info["upload_date"]
    # Real publication timestamp (with hours/minutes), seconds since epoch.
    ts = info.get("timestamp") or info.get("release_timestamp")
    if ts is not None:
        try:
            updates["upload_timestamp"] = int(ts)
        except (TypeError, ValueError):
            pass
    if info.get("description"):
        updates["description"] = info["description"]
    if info.get("duration") is not None:
        updates["duration"] = int(info["duration"])
    if info.get("title"):
        updates["title"] = info["title"]
    if info.get("chapters"):
        updates["chapters_json"] = json.dumps([
            {"start": c.get("start_time"), "end": c.get("end_time"), "title": c.get("title")}
            for c in info["chapters"] if c
        ])
    if info.get("height"):
        updates["quality"] = str(info["height"])
    if info.get("width"):
        try:
            updates["width"] = int(info["width"])
        except (TypeError, ValueError):
            pass
    if result.get("video_path"):
        try:
            updates["file_size_bytes"] = Path(result["video_path"]).stat().st_size
        except OSError:
            pass
    return {k: v for k, v in updates.items() if v is not None}


# ── helpers ──────────────────────────────────────────────────────────────────────

def _first(it):
    return str(next(iter(it), "")) or None


def _maybe(p: Path) -> str | None:
    return str(p) if p.exists() else None


def _first_video(d: Path) -> str | None:
    for p in d.iterdir():
        if p.is_file() and p.suffix in {".mp4", ".mkv", ".webm"} and "video." in p.name:
            return str(p)
    return None


def _first_image(d: Path) -> str | None:
    # Prefer jpg (after FFmpegThumbnailsConvertor), then webp/png
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        for p in d.glob(f"video{ext}"):
            return str(p)
    return None


def _first_subtitle(d: Path) -> str | None:
    for p in d.glob("video.*.vtt"):
        return str(p)
    return None
