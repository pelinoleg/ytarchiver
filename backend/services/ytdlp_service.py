"""yt-dlp wrapper. See .claude/skills/ytdlp-downloader/SKILL.md for design rules."""
from __future__ import annotations

import logging
import os
import random
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import yt_dlp

from config import settings


log = logging.getLogger(__name__)


def managed_cookies_path() -> Path:
    """UI-managed Netscape cookies.txt — persists on the data volume."""
    return Path(settings.data_dir) / "cookies.txt"


def yt_opts_extra() -> dict:
    """Non-cookie options applied to every YouTube call (alt player_client if
    configured). Cookies are deliberately NOT included here — see
    :func:`extract_info`, which adds them only as a bot-wall fallback.
    """
    out: dict = {}
    ea: dict = {}
    # Comma-separated → list, so multi-client / exclusion forms like
    # ``default,-android_vr`` reach yt-dlp as ["default", "-android_vr"].
    clients = [c.strip() for c in (settings.youtube_player_client or "").split(",") if c.strip()]
    if clients:
        ea["youtube"] = {"player_client": clients}
    if settings.pot_provider_url:
        # Point the bgutil POT plugin at the provider container.
        ea["youtubepot-bgutilhttp"] = {"base_url": [settings.pot_provider_url]}
    if ea:
        out["extractor_args"] = ea
    # Politeness throttle — space requests/downloads so bursts (esp. a channel
    # sync walking many videos) don't trip YouTube's rate-limiter / captcha.
    if settings.ytdlp_sleep_requests and settings.ytdlp_sleep_requests > 0:
        out["sleep_interval_requests"] = settings.ytdlp_sleep_requests
    if settings.ytdlp_sleep_interval and settings.ytdlp_sleep_interval > 0:
        out["sleep_interval"] = settings.ytdlp_sleep_interval
        out["max_sleep_interval"] = max(settings.ytdlp_max_sleep_interval,
                                        settings.ytdlp_sleep_interval)
    return out


def cookie_opts() -> dict:
    """yt-dlp cookie option, if a cookies file is available. Managed file
    (Settings UI, <data_dir>/cookies.txt) wins over the env-configured path."""
    managed = managed_cookies_path()
    if managed.exists() and managed.is_file() and managed.stat().st_size > 0:
        return {"cookiefile": str(managed)}
    if settings.cookies_file:
        p = Path(os.path.expanduser(settings.cookies_file))
        if p.exists() and p.is_file():
            return {"cookiefile": str(p)}
        log.warning("cookies_file=%s does not exist; skipping", settings.cookies_file)
    return {}


_BOT_WALL_MARKERS = ("sign in to confirm", "not a bot", "confirm you're not a bot")

# YouTube blocks we treat as "this exit IP is burned, rotate to another":
#   • the bot wall, • the captcha gate, • storyboard-only responses (the player
#     returns only images, so audio/video format selection fails).
_BLOCK_MARKERS = (
    "sign in to confirm", "not a bot", "confirm you're not a bot",
    "captcha",
    "only images are available", "requested format is not available",
)
# Proxy/transport failures → that tunnel is down, also rotate past it.
_NET_ERR_MARKERS = (
    "proxy", "tunnel", "timed out", "timeout", "unable to connect",
    "connection reset", "connection refused", "network is unreachable",
)


def _is_bot_wall(err: Exception) -> bool:
    s = str(err).lower()
    return any(m in s for m in _BOT_WALL_MARKERS)


def _is_blocked(err: Exception) -> bool:
    s = str(err).lower()
    return any(m in s for m in _BLOCK_MARKERS)


def _is_net_err(err: Exception) -> bool:
    s = str(err).lower()
    return any(m in s for m in _NET_ERR_MARKERS)


def _proxy_list() -> list[str]:
    return [p.strip() for p in (settings.ytdlp_proxies or "").split(",") if p.strip()]


# Last exit that worked ("" = direct, else a proxy URL). Starting the next call
# on it avoids re-probing burned/dead exits every time.
_last_good_net: Optional[str] = None


def _networks() -> list[str]:
    """Exit choices to try, in order. With proxies configured: the last-good one
    first, then the rest shuffled, then direct ("") as a final fallback. Without
    proxies: just direct — unchanged behaviour."""
    proxies = _proxy_list()
    if not proxies:
        return [""]
    order = proxies[:]
    random.shuffle(order)
    nets = order + [""]
    if _last_good_net is not None and _last_good_net in nets:
        nets.remove(_last_good_net)
        nets.insert(0, _last_good_net)
    return nets


def _run(url, opts, download, process):
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=download, process=process)


def extract_info(url: str, opts: dict, *, download: bool = False, process: bool = True):
    """Extract (and optionally download) with two layers of resilience:

    1. **Exit rotation** — when ``YTDLP_PROXIES`` lists proxies (each typically a
       per-country WireGuard tunnel), try them in turn and switch on a YouTube
       block (bot wall / captcha / storyboard-only) or a dead tunnel. The last
       working exit is remembered for the next call.
    2. **Cookie fallback** — on each exit, if the anonymous try hits the bot wall
       and cookies are configured, retry that exit with cookies. (Anonymous goes
       first because an authenticated session often yields storyboard-only
       formats on clips that work fine without cookies.)
    """
    global _last_good_net
    cookies = cookie_opts()
    last_exc: Optional[Exception] = None

    for net in _networks():
        net_opts = {**opts, **({"proxy": net} if net else {})}
        try:
            res = _run(url, net_opts, download, process)
            _last_good_net = net
            return res
        except Exception as e:
            last_exc = e
            # Bot wall + cookies → retry THIS exit with cookies before rotating.
            if cookies and _is_bot_wall(e):
                try:
                    res = _run(url, {**net_opts, **cookies}, download, process)
                    _last_good_net = net
                    return res
                except Exception as e2:
                    last_exc = e2
                    e = e2
            # Rotate on a block or a dead tunnel; otherwise the error is genuine
            # (private / unavailable / …) — don't spin through every exit.
            if _is_blocked(e) or _is_net_err(e):
                if net:
                    log.info("yt-dlp: exit %s blocked/down on %s — rotating", net, url)
                continue
            raise

    raise last_exc


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
    info = extract_info(url, {**opts, **yt_opts_extra()}, download=False) or {}
    return {
        "yt_playlist_id": info.get("id"),
        "title":          info.get("title") or "Untitled playlist",
        "description":    info.get("description"),
        "thumbnail_url":  _pick_thumbnail(info),
        "uploader":       info.get("uploader") or info.get("channel"),
        "video_count":    info.get("playlist_count") or 0,
    }


def fetch_playlist_videos(url: str, *, max_videos: int = 5000) -> list[dict]:
    """List of video entries in playlist order. Flat extract — no per-video
    metadata fetch — but YouTube playlist entries include channel info.

    ``max_videos`` is a high safety ceiling, not a typical limit: flat extract
    is cheap (one list walk, no per-video fetch), so a multi-thousand-song
    playlist returns in a few seconds. It used to default to 500, which
    silently truncated large playlists (a 2800-track playlist only ever saw
    its first ~480 entries)."""
    opts = {
        "quiet": True, "no_warnings": True,
        "extract_flat": "in_playlist", "skip_download": True,
        "ignoreerrors": True,
        "playlistend": max_videos,
    }
    info = extract_info(url, {**opts, **yt_opts_extra()}, download=False) or {}
    entries = info.get("entries") or []
    out: list[dict] = []
    for i, e in enumerate(entries):
        if not e or not e.get("id"):
            continue
        if _is_unavailable_entry(e):
            log.info("playlist: skipping unavailable entry %s (%r)", e.get("id"), e.get("title"))
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
    # process=False: metadata only — skip format selection so a cookie-induced
    # "requested format not available" can't break the add flow.
    info = extract_info(url, {**opts, **yt_opts_extra()}, download=False, process=False)
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


class NotAuthenticated(RuntimeError):
    """Cookies present but YouTube doesn't see a logged-in session — the export
    is missing the first-party login cookies (LOGIN_INFO / __Secure-1PSID …)."""


def _looks_like_login_wall(err: Exception) -> bool:
    s = str(err).lower()
    return ("login details are needed" in s
            or "http error 401" in s
            or "does the playlist exist" in s  # feed/channels when logged out
            or "private" in s and "sign in" in s)


def account_is_authenticated() -> bool:
    """True when the stored cookies actually authenticate the account. Probes a
    login-only endpoint (the subscriptions feed)."""
    if not cookie_opts():
        return False
    try:
        fetch_subscriptions(limit=1)
        return True
    except NotAuthenticated:
        return False
    except Exception:
        # Network / other hiccup — treat as unknown but not authenticated.
        return False


def fetch_subscriptions(limit: int = 1000) -> list[dict]:
    """Channels the cookie-authenticated user is subscribed to.

    Requires valid login cookies — raises :class:`NotAuthenticated` when the
    session isn't logged in. Tries the dedicated channels feed first, then
    derives unique channels from the subscription video feed as a fallback.
    """
    ck = cookie_opts()
    if not ck:
        raise NotAuthenticated("no cookies configured")
    opts = {
        "quiet": True, "no_warnings": True,
        "extract_flat": True, "skip_download": True,
        "playlistend": limit, **ck,
    }

    def _thumb(e: dict):
        thumbs = e.get("thumbnails") or []
        if not thumbs:
            return None
        u = thumbs[-1].get("url")
        # YouTube returns protocol-relative avatar URLs (//yt3.ggpht…). Over an
        # http:// served app those resolve to http and fail to load — pin https.
        if u and u.startswith("//"):
            u = "https:" + u
        return u

    # 1) The subscriptions *channel* list.
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info("https://www.youtube.com/feed/channels", download=False)
        out: list[dict] = []
        for e in info.get("entries") or []:
            cid = e.get("channel_id") or e.get("id")
            url = e.get("url") or (f"https://www.youtube.com/channel/{cid}" if cid else None)
            if not url:
                continue
            out.append({
                "channel_id": cid,
                "name": e.get("title") or e.get("channel") or "Channel",
                "url": url,
                "thumbnail_url": _thumb(e),
                "subscriber_count": e.get("channel_follower_count"),
            })
        if out:
            return out
    except Exception as e:
        if _looks_like_login_wall(e):
            raise NotAuthenticated(str(e)) from e
        # else fall through to the video-feed fallback

    # 2) Fallback — unique uploaders from the subscription video feed.
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info("https://www.youtube.com/feed/subscriptions", download=False)
    except Exception as e:
        if _looks_like_login_wall(e):
            raise NotAuthenticated(str(e)) from e
        raise
    seen: dict[str, dict] = {}
    for e in info.get("entries") or []:
        cid = e.get("channel_id")
        if not cid or cid in seen:
            continue
        seen[cid] = {
            "channel_id": cid,
            "name": e.get("channel") or e.get("uploader") or "Channel",
            "url": e.get("channel_url") or f"https://www.youtube.com/channel/{cid}",
            "thumbnail_url": None,
            "subscriber_count": None,
        }
    return list(seen.values())


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
    info = extract_info(url, {**opts, **yt_opts_extra()}, download=False)
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
    info = extract_info(url, {**opts, **yt_opts_extra()}, download=False)

    entries = (info or {}).get("entries") or []
    videos: list[dict] = []
    for e in entries:
        if not e or not e.get("id"):
            continue
        if _is_unavailable_entry(e):
            log.info("channel: skipping unavailable entry %s (%r)", e.get("id"), e.get("title"))
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


# Placeholder titles yt-dlp uses for entries that can no longer be watched.
# In flat extract these still carry a real-looking video id, so id presence
# alone can't tell them apart from live videos — the title/availability does.
_UNAVAILABLE_TITLES = frozenset({
    "[deleted video]",
    "[private video]",
    "[unavailable video]",
})
_UNAVAILABLE_AVAILABILITY = frozenset({
    "private",
    "needs_auth",
})


def _is_unavailable_entry(entry: dict) -> bool:
    """True for deleted/private/unavailable playlist or channel entries.

    YouTube keeps these as placeholder rows inside a playlist; yt-dlp surfaces
    them with a bracketed marker title and no real metadata. We never want them
    in the library — they only clutter playlists and can never be downloaded.
    """
    if not entry:
        return True
    title = (entry.get("title") or "").strip().lower()
    if title in _UNAVAILABLE_TITLES:
        return True
    if entry.get("availability") in _UNAVAILABLE_AVAILABILITY:
        return True
    return False


def _is_shorts_entry(entry: dict) -> bool:
    url = (entry.get("url") or entry.get("webpage_url") or "")
    if "/shorts/" in url:
        return True
    dur = entry.get("duration")
    if isinstance(dur, (int, float)) and 0 < dur <= 60:
        return True
    return False
