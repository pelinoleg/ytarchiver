"""yt-dlp wrapper. See .claude/skills/ytdlp-downloader/SKILL.md for design rules."""
from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from typing import Optional
from urllib.parse import urlparse

import yt_dlp


log = logging.getLogger(__name__)


# Channel-page subpaths yt-dlp accepts. We pin to /videos to exclude Shorts/Live tabs.
_CHANNEL_TAB_SUFFIXES = ("/videos", "/shorts", "/streams", "/playlists", "/community", "/about")

_VIDEO_ID_RE = re.compile(r"(?:v=|youtu\.be/|/shorts/|/embed/|/v/|/watch/)([A-Za-z0-9_-]{11})")


def extract_video_id(text: str) -> Optional[str]:
    """Pull a YouTube video id from a URL or accept a bare 11-char id."""
    text = (text or "").strip()
    if not text:
        return None
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", text):
        return text
    m = _VIDEO_ID_RE.search(text)
    return m.group(1) if m else None


def fetch_playlist_info(url: str) -> dict:
    """Metadata for a playlist — no full video extraction."""
    opts = {
        "quiet": True, "no_warnings": True,
        "extract_flat": True, "skip_download": True,
        "playlistend": 1,  # we only need the playlist-level metadata
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False) or {}
    return {
        "yt_playlist_id": info.get("id"),
        "title":          info.get("title") or "Untitled playlist",
        "description":    info.get("description"),
        "thumbnail_url":  _pick_thumbnail(info),
        "uploader":       info.get("uploader") or info.get("channel"),
        "video_count":    info.get("playlist_count") or 0,
    }


def fetch_playlist_videos(url: str, *, max_videos: int = 500) -> list[dict]:
    """List of video entries in playlist order. Flat extract — no per-video
    metadata fetch — but YouTube playlist entries include channel info."""
    opts = {
        "quiet": True, "no_warnings": True,
        "extract_flat": "in_playlist", "skip_download": True,
        "ignoreerrors": True,
        "playlistend": max_videos,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False) or {}
    entries = info.get("entries") or []
    out: list[dict] = []
    for i, e in enumerate(entries):
        if not e or not e.get("id"):
            continue
        out.append({
            "id":             e["id"],
            "title":          e.get("title") or "Untitled",
            "duration":       int(e["duration"]) if e.get("duration") is not None else None,
            "thumbnail_url":  _pick_thumbnail(e),
            "channel_yt_id":  e.get("channel_id") or e.get("uploader_id"),
            "channel_name":   e.get("channel")    or e.get("uploader"),
            "position":       i + 1,
        })
    return out


def fetch_video_info(video_id: str) -> dict:
    """Metadata for a single video — no download. Used by the manual-add flow."""
    opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    url = f"https://www.youtube.com/watch?v={video_id}"
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    info = info or {}
    return {
        "id": info.get("id") or video_id,
        "title": info.get("title") or "Untitled",
        "description": info.get("description"),
        "duration": int(info["duration"]) if info.get("duration") is not None else None,
        "upload_date": info.get("upload_date"),
        "thumbnail_url": _pick_thumbnail(info),
        "yt_channel_id": info.get("channel_id") or info.get("uploader_id"),
        "channel_name": info.get("channel") or info.get("uploader"),
    }


def normalize_channel_url(url: str) -> str:
    """Ensure the URL points to the channel's Videos tab (excludes Shorts/Live).

    Accepts ``@handle``, ``/channel/UCxxx``, ``/user/xxx``, ``/c/xxx``.
    If a tab suffix is already present, returns the URL unchanged.
    """
    url = url.strip().rstrip("/")
    parsed = urlparse(url)
    if not parsed.scheme:
        url = f"https://www.youtube.com/{url.lstrip('/')}"
        parsed = urlparse(url)
    path = parsed.path
    if any(path.endswith(s) for s in _CHANNEL_TAB_SUFFIXES):
        return url
    return url + "/videos"


def fetch_channel_info(url: str) -> dict:
    """Fetch channel metadata only — no video list."""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "playlistend": 1,
        "skip_download": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return {
        "yt_channel_id": info.get("channel_id") or info.get("uploader_id") or info.get("id"),
        "name": info.get("channel") or info.get("uploader") or info.get("title") or "Unknown channel",
        "description": info.get("description"),
        "thumbnail_url": _pick_thumbnail(info),
        "subscriber_count": info.get("channel_follower_count"),
    }


def fetch_channel_videos_flat(
    url: str,
    *,
    max_videos: int = 50,
) -> list[dict]:
    """Cheap listing — returns up to ``max_videos`` newest entries with id/title
    only (no upload_date). Used by the periodic scheduler to discover new
    uploads quickly.
    """
    opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "ignoreerrors": True,
        "playlistend": max_videos,
        "skip_download": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    entries = (info or {}).get("entries") or []
    videos: list[dict] = []
    for e in entries:
        if not e or not e.get("id"):
            continue
        videos.append({
            "id": e["id"],
            "title": e.get("title") or "Untitled",
            "description": e.get("description"),
            "duration": int(e["duration"]) if e.get("duration") is not None else None,
            "upload_date": e.get("upload_date"),  # almost always None in flat mode
            "thumbnail_url": _pick_thumbnail(e),
            "is_short": _is_shorts_entry(e),
        })
    return videos


def fetch_channel_videos_dated(
    url: str,
    *,
    after_date: Optional[str] = None,
    hard_cap: int = 500,
) -> list[dict]:
    """Accurate, date-aware listing. Walks the channel newest → oldest, fetching
    full metadata per video to read upload_date. Up to ``hard_cap`` videos
    are examined (per-video YouTube fetch is slow).

    Termination rules (important for correctness — early versions over-fetched):

      * **unknown date + filter set** → skip the video entirely. Premieres,
        scheduled uploads and some unlisted videos return ``upload_date=None``;
        if the user asked for "last 7 days" we MUST NOT include something we
        can't date — that's the source of the bug where channels with mixed
        premiere/regular content downloaded months of history.
      * **too-old video** → just skip it (not ``break``). Pinned-old content
        and out-of-order list quirks shouldn't terminate the scan early.
      * Bail out only after **MAX_CONSECUTIVE_OLD** old videos in a row — at
        that point the channel really is exhausted and we stop.
    """
    flat = fetch_channel_videos_flat(url, max_videos=hard_cap)

    MAX_CONSECUTIVE_OLD = 20

    videos: list[dict] = []
    consecutive_old = 0
    for entry in flat:
        vid = entry["id"]
        try:
            info = fetch_video_info(vid)
        except Exception:
            log.warning("dated fetch: failed to get info for %s", vid)
            continue

        upload_date = info.get("upload_date")

        # Refuse to add unknown-dated videos when a cutoff is set — keeps
        # the date filter honest in the face of premieres / live / unlisted.
        if after_date and not upload_date:
            log.info("dated fetch: skipping %s — no upload_date", vid)
            continue

        if after_date and upload_date < after_date:
            consecutive_old += 1
            if consecutive_old >= MAX_CONSECUTIVE_OLD:
                log.info(
                    "dated fetch: stopping after %d consecutive too-old videos",
                    consecutive_old,
                )
                break
            continue

        consecutive_old = 0

        if entry.get("is_short"):
            continue

        videos.append({
            "id": vid,
            "title": info.get("title") or entry["title"],
            "description": info.get("description"),
            "duration": info.get("duration") if info.get("duration") is not None else entry.get("duration"),
            "upload_date": upload_date,
            "thumbnail_url": info.get("thumbnail_url") or entry.get("thumbnail_url"),
            "is_short": False,
        })
    return videos


def policy_to_after_date(policy: str) -> Optional[str]:
    """Convert ``download_policy`` (from API) to a ``YYYYMMDD`` cutoff or None."""
    if policy == "new-only":
        return date.today().strftime("%Y%m%d")
    if policy == "all":
        return None
    if policy.startswith("last-"):
        try:
            days = int(policy.split("-", 1)[1])
        except ValueError:
            return None
        return (date.today() - timedelta(days=days)).strftime("%Y%m%d")
    return None


# ── Helpers ──────────────────────────────────────────────────────────────────────

def _pick_thumbnail(entry: dict) -> Optional[str]:
    thumbs = entry.get("thumbnails") or []
    if thumbs:
        return thumbs[-1].get("url") or thumbs[0].get("url")
    return entry.get("thumbnail")


def _is_shorts_entry(entry: dict) -> bool:
    url = (entry.get("url") or entry.get("webpage_url") or "")
    if "/shorts/" in url:
        return True
    dur = entry.get("duration")
    if isinstance(dur, (int, float)) and 0 < dur <= 60:
        return True
    return False
