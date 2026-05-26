---
name: ytdlp-downloader
description: >
  Use this skill for everything related to downloading video/audio from YouTube
  and other platforms using yt-dlp. Triggers on: download a video, subscribe to
  a channel, fetch new videos from channel, extract audio, check for updates,
  batch download, playlist download. Also use when writing any yt-dlp CLI call,
  configuring yt-dlp options, or handling yt-dlp errors (nsig, 403, PO token,
  cookies). Do NOT use for the web UI, database schema, or API routes.
---

# yt-dlp Downloader Skill

## Overview

This project uses **yt-dlp** as the download engine. All downloads run as
**subprocess calls from FastAPI background tasks** — never blocking the main
thread. ffmpeg is required for video+audio merging.

## Dependencies

```bash
pip install yt-dlp
brew install ffmpeg        # macOS
apt install ffmpeg         # Ubuntu/Debian
# OR use docker image: jauderho/yt-dlp
```

Verify:
```bash
yt-dlp --version
ffmpeg -version
```

## Directory layout

```
/downloads/
  channels/
    {channel_id}/
      metadata.json        # channel info cache
      {video_id}/
        video.mp4
        thumbnail.jpg
        info.json          # yt-dlp --write-info-json output
  queue/                   # temp dir during download
```

## Core yt-dlp options (use in ALL calls)

```python
YDL_OPTS_BASE = {
    "format": "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "merge_output_format": "mp4",
    "writeinfojson": True,
    "writethumbnail": True,
    "embedthumbnail": False,        # keep as separate file
    "writesubtitles": False,
    "ignoreerrors": True,           # skip unavailable videos in playlists
    "no_warnings": False,
    "quiet": False,
    "progress_hooks": [],           # attach progress callback here
    "postprocessors": [
        {"key": "FFmpegVideoConvertor", "preferedformat": "mp4"},
    ],
}
```

## Downloading a single video

```python
import yt_dlp, os

def download_video(url: str, output_dir: str, progress_hook=None) -> dict:
    opts = {
        **YDL_OPTS_BASE,
        "outtmpl": os.path.join(output_dir, "%(id)s/%(title)s.%(ext)s"),
    }
    if progress_hook:
        opts["progress_hooks"] = [progress_hook]

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        return ydl.sanitize_info(info)
```

## Fetching channel metadata (no download)

```python
def get_channel_info(channel_url: str) -> dict:
    opts = {
        "quiet": True,
        "extract_flat": True,       # list entries without downloading
        "playlistend": 1,           # only need first entry to get channel info
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(channel_url, download=False)
```

## Fetching new videos from a subscribed channel

```python
def fetch_channel_videos(channel_url: str, after_date: str = None) -> list[dict]:
    """
    after_date: "YYYYMMDD" — only return videos published after this date
    Returns list of video dicts with: id, title, upload_date, duration, url
    """
    opts = {
        "quiet": True,
        "extract_flat": True,
        "ignoreerrors": True,
        "dateafter": after_date,    # e.g. "20240101"
        "playlistend": 50,          # max videos to check per run
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(channel_url, download=False)
        entries = info.get("entries", []) if info else []
        return [
            {
                "id": e["id"],
                "title": e.get("title"),
                "upload_date": e.get("upload_date"),
                "duration": e.get("duration"),
                "url": e.get("url") or f"https://youtu.be/{e['id']}",
            }
            for e in entries if e
        ]
```

## Progress hook for WebSocket streaming

```python
def make_progress_hook(video_id: str, broadcast_fn):
    """
    broadcast_fn: async callable that sends status to WebSocket clients.
    Call it with a dict.
    """
    def hook(d):
        if d["status"] == "downloading":
            broadcast_fn({
                "video_id": video_id,
                "status": "downloading",
                "percent": d.get("_percent_str", "?").strip(),
                "speed": d.get("_speed_str", "?").strip(),
                "eta": d.get("_eta_str", "?").strip(),
            })
        elif d["status"] == "finished":
            broadcast_fn({"video_id": video_id, "status": "finished"})
        elif d["status"] == "error":
            broadcast_fn({"video_id": video_id, "status": "error"})
    return hook
```

## Common errors and fixes

| Error | Cause | Fix |
|---|---|---|
| `Sign in to confirm you're not a bot` | PO token required | Install `bgutil-ytdlp-pot-provider`: `pip install bgutil-ytdlp-pot-provider` |
| `HTTP Error 403` | stale cookies | Extract fresh cookies from browser: `--cookies-from-browser chrome` |
| `nsig extraction failed` | outdated yt-dlp | `pip install -U yt-dlp` |
| `Requested format not available` | format string too strict | Loosen format: `"best[ext=mp4]/best"` |
| `ffmpeg not found` | ffmpeg missing | Install ffmpeg, ensure it's in PATH |

## yt-dlp as subprocess (for long-running tasks in background)

When called from FastAPI BackgroundTasks, use subprocess to avoid blocking:

```python
import subprocess, json

def download_via_subprocess(url: str, output_dir: str) -> int:
    cmd = [
        "yt-dlp",
        "--format", "bestvideo[ext=mp4][height<=1080]+bestaudio/best",
        "--merge-output-format", "mp4",
        "--write-info-json",
        "--write-thumbnail",
        "--output", f"{output_dir}/%(id)s/%(title)s.%(ext)s",
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode
```

## Periodic channel sync (scheduler pattern)

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler()

@scheduler.scheduled_job("interval", hours=6)
async def sync_all_channels():
    channels = db.get_all_subscribed_channels()
    for ch in channels:
        new_videos = fetch_channel_videos(ch.url, after_date=ch.last_synced)
        for v in new_videos:
            if not db.video_exists(v["id"]):
                db.add_to_queue(v)
                download_video(v["url"], output_dir=f"/downloads/channels/{ch.id}")
        db.update_last_synced(ch.id)

scheduler.start()
```

## Rules

- ALWAYS use `ignoreerrors: True` for channel/playlist downloads
- NEVER block the FastAPI event loop — use BackgroundTasks or subprocess
- ALWAYS store `info.json` alongside the video file — it's the source of truth for metadata
- Use `extract_flat: True` for listing/checking — never download just to check what's there
- Keep yt-dlp updated: `pip install -U yt-dlp` — YouTube changes break old versions
