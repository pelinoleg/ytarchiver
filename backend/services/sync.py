"""Channel sync — discovers new videos and inserts them as ``pending``.

No file downloads yet — that's a follow-up. This module is the glue between the
DB and the yt-dlp service so both the scheduler and the API can trigger a sync.
"""
from __future__ import annotations

import logging

from config import settings
from db.database import DB
from services import ytdlp_service


def _kv_int(db: DB, key: str, default: int) -> int:
    """Read an int from the settings KV table, fall back to env default."""
    raw = db.get_settings().get(key)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


log = logging.getLogger(__name__)


def subscribe_channel(
    db: DB,
    *,
    url: str,
    download_policy: str = "new-only",
    quality: str | None = None,
    retention_days: int | None = None,
    sync_interval_minutes: int | None = None,
    show_on_home: bool = True,
    folder_id: int | None = None,
    latest_count: int | None = None,
) -> int:
    """Create a channel row from a YouTube URL. Returns the new channel id.

    Idempotent: returns the existing channel id if already subscribed.
    """
    normalized_url = ytdlp_service.normalize_channel_url(url)
    existing = db.get_channel_by_url(normalized_url)
    if existing:
        return existing["id"]

    info = ytdlp_service.fetch_channel_info(normalized_url)
    after_date = ytdlp_service.policy_to_after_date(download_policy)

    # "latest" policy stores latest_count instead of a date.
    channel_id = db.add_channel(
        url=normalized_url,
        yt_channel_id=info["yt_channel_id"],
        name=info["name"],
        description=info["description"],
        thumbnail_url=info["thumbnail_url"],
        subscriber_count=info["subscriber_count"],
        download_from_date=after_date if download_policy != "latest" else None,
        quality=quality,
        retention_days=retention_days,
        sync_interval_minutes=sync_interval_minutes,
        show_on_home=show_on_home,
        folder_id=folder_id,
        latest_count=latest_count if download_policy == "latest" else None,
        download_policy=download_policy,
    )
    log.info("subscribed channel %s (id=%d) policy=%s", info["name"], channel_id, download_policy)
    return channel_id


def initialize_baseline(db: DB, channel_id: int) -> int:
    """First-time pass for ``new-only`` policy.

    Records the channel's current top videos as ``skipped`` so they are known
    (and won't be re-added on next sync) but won't be downloaded. From this
    point on, only genuinely new uploads will be discovered as ``pending``.
    """
    channel = db.get_channel(channel_id)
    if not channel:
        return 0
    videos = ytdlp_service.fetch_channel_videos_flat(
        channel["url"],
        max_videos=_kv_int(db, "max_videos_per_channel_scan", settings.max_videos_per_channel_scan),
    )
    added = 0
    for v in videos:
        if db.video_exists(v["id"]):
            continue
        db.add_video(
            video_id=v["id"], channel_id=channel_id,
            title=v["title"], description=v.get("description"),
            duration=v.get("duration"), upload_date=v.get("upload_date"),
            thumbnail_url=v.get("thumbnail_url"),
            is_short=v.get("is_short", False),
            status="skipped",
        )
        added += 1
    db.update_last_synced(channel_id)
    log.info("baseline: channel=%s recorded=%d (status=skipped)", channel["name"], added)
    return added


def initialize_latest_n(db: DB, channel_id: int) -> int:
    """One-shot fetch for ``latest`` policy: grab the top ``latest_count``
    videos from the channel feed and queue them. No date filter, fast flat
    extract — ordering is newest-first, exactly what we want."""
    channel = db.get_channel(channel_id)
    if not channel:
        return 0
    n = channel["latest_count"] or 0
    if n <= 0:
        log.warning("latest-n: channel=%s has no latest_count set", channel["name"])
        return 0
    videos = ytdlp_service.fetch_channel_videos_flat(channel["url"], max_videos=n)
    added = 0
    for v in videos:
        if db.video_exists(v["id"]):
            continue
        db.add_video(
            video_id=v["id"], channel_id=channel_id,
            title=v["title"], description=v.get("description"),
            duration=v.get("duration"), upload_date=v.get("upload_date"),
            thumbnail_url=v.get("thumbnail_url"),
            is_short=v.get("is_short", False),
            status="pending",
        )
        added += 1
    db.update_last_synced(channel_id)
    log.info("latest-n: channel=%s requested=%d added=%d", channel["name"], n, added)
    if added:
        db.log_event("channel_synced",
                     message=f"latest-{n}: +{added} video(s)",
                     channel_id=channel_id, channel_name=channel["name"])
    return added


def initial_backfill(db: DB, channel_id: int) -> int:
    """One-shot accurate fetch honoring the channel's ``download_from_date``.

    Walks the channel newest → oldest with per-video metadata (slow but the
    only way to filter by upload date), inserting matching videos as ``pending``
    so the worker picks them up.

    Used for ``last-N`` and ``all`` policies. ``new-only`` uses
    :func:`initialize_baseline` instead.
    """
    channel = db.get_channel(channel_id)
    if not channel:
        return 0
    after_date = channel["download_from_date"]
    log.info(
        "initial backfill: channel=%s after=%s (cap=%d, this can take a while)",
        channel["name"], after_date, settings.initial_backfill_hard_cap,
    )
    videos = ytdlp_service.fetch_channel_videos_dated(
        channel["url"],
        after_date=after_date,
        hard_cap=_kv_int(db, "initial_backfill_hard_cap", settings.initial_backfill_hard_cap),
    )
    added = 0
    for v in videos:
        if db.video_exists(v["id"]):
            continue
        db.add_video(
            video_id=v["id"], channel_id=channel_id,
            title=v["title"], description=v.get("description"),
            duration=v.get("duration"), upload_date=v.get("upload_date"),
            thumbnail_url=v.get("thumbnail_url"),
            is_short=False,
            status="pending",
        )
        added += 1
    db.update_last_synced(channel_id)
    log.info("initial backfill: channel=%s added=%d", channel["name"], added)
    if added:
        db.log_event("channel_synced",
                     message=f"initial backfill: +{added} video(s)",
                     channel_id=channel_id, channel_name=channel["name"])
    return added


def sync_channel(db: DB, channel_id: int) -> int:
    """Periodic check for new uploads.

    Two-phase: cheap flat extract to find unseen video ids, then per-video
    metadata fetch on the new ones — but only when we need their upload_date
    to honour the channel's ``download_from_date``. For policies without a
    date filter (``new-only`` baseline, ``latest``, ``all``) we skip the
    per-video fetch entirely.

    This is what stops a freshly-subscribed channel from being vacuumed in
    via a Sync click that races with the initial dated backfill — both code
    paths now respect ``download_from_date``.
    """
    channel = db.get_channel(channel_id)
    if not channel:
        log.warning("sync_channel: channel %s not found", channel_id)
        return 0

    latest_n = channel["latest_count"]
    if latest_n and latest_n > 0:
        max_videos = int(latest_n) + 5
    else:
        max_videos = _kv_int(
            db, "max_videos_per_channel_scan", settings.max_videos_per_channel_scan,
        )
    videos = ytdlp_service.fetch_channel_videos_flat(
        channel["url"], max_videos=max_videos,
    )

    # Filter to NEW (not yet in DB) entries up front.
    new_entries = [v for v in videos if not db.video_exists(v["id"])]

    # If the channel has a date cutoff, fetch per-video dates and drop
    # anything older or undated. Per-video calls only happen for unseen
    # ids, which is usually 0–3 — cost is negligible in steady state.
    after_date = channel["download_from_date"]
    if after_date and new_entries:
        filtered: list[dict] = []
        for v in new_entries:
            try:
                info = ytdlp_service.fetch_video_info(v["id"])
            except Exception:
                log.warning("sync: failed to fetch metadata for %s", v["id"])
                continue
            upload_date = info.get("upload_date")
            if not upload_date:
                log.info("sync: skipping %s — no upload_date", v["id"])
                continue
            if upload_date < after_date:
                continue
            # Merge richer info so we store accurate metadata.
            v = {
                **v,
                "title":         info.get("title") or v["title"],
                "description":   info.get("description"),
                "duration":      info.get("duration") if info.get("duration") is not None else v.get("duration"),
                "upload_date":   upload_date,
                "thumbnail_url": info.get("thumbnail_url") or v.get("thumbnail_url"),
            }
            filtered.append(v)
        new_entries = filtered

    added = 0
    for v in new_entries:
        db.add_video(
            video_id=v["id"], channel_id=channel_id,
            title=v["title"], description=v.get("description"),
            duration=v.get("duration"), upload_date=v.get("upload_date"),
            thumbnail_url=v.get("thumbnail_url"),
            is_short=v.get("is_short", False),
            status="pending",
        )
        added += 1

    db.update_last_synced(channel_id)
    db.conn.execute(
        "UPDATE channels SET last_sync_added_count = ?, last_sync_error = NULL WHERE id = ?",
        (added, channel_id),
    )
    db.conn.commit()
    log.info("sync: channel=%s added=%d", channel["name"], added)
    if added:
        db.log_event("channel_synced",
                     message=f"+{added} new video(s)",
                     channel_id=channel_id, channel_name=channel["name"])
    return added
