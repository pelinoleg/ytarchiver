"""SponsorBlock API client + sync helpers.

API docs: https://wiki.sponsor.ajay.app/w/API_Docs
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Iterable

import httpx

from config import settings
from db.database import DB, get_connection


log = logging.getLogger(__name__)


DEFAULT_CATEGORIES = ["sponsor", "selfpromo", "interaction", "intro", "outro", "music_offtopic"]


async def fetch_segments(video_id: str, categories: list[str]) -> list[dict]:
    """Hit /api/skipSegments. Returns ``[]`` for unknown videos (404)."""
    params = {"videoID": video_id, "categories": json.dumps(categories)}
    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            resp = await c.get(f"{settings.sponsorblock_api}/api/skipSegments", params=params)
    except httpx.RequestError as e:
        log.warning("sponsorblock: network error for %s: %s", video_id, e)
        return []
    if resp.status_code == 404:
        return []
    if resp.status_code != 200:
        log.warning("sponsorblock: %s returned %d", video_id, resp.status_code)
        return []
    try:
        return resp.json()
    except ValueError:
        return []


async def sync_video_segments(video_id: str, categories: list[str] | None = None) -> int:
    """Fetch segments and replace what's in the DB. Returns count stored."""
    if categories is None:
        categories = load_categories()
    raw = await fetch_segments(video_id, categories)
    normalized = list(_normalize(raw))
    conn = get_connection()
    try:
        DB(conn).replace_sponsor_segments(video_id, normalized)
    finally:
        conn.close()
    log.info("sponsorblock: %s segments stored for %s", len(normalized), video_id)
    return len(normalized)


async def refresh_recent_videos() -> int:
    """Refresh segments for all videos downloaded within ``sponsorblock_refresh_days`` days."""
    # KV setting overrides the env default.
    conn = get_connection()
    try:
        raw = DB(conn).get_settings().get("sponsorblock_refresh_days")
    finally:
        conn.close()
    try:
        refresh_days = int(raw) if raw is not None else settings.sponsorblock_refresh_days
    except (TypeError, ValueError):
        refresh_days = settings.sponsorblock_refresh_days
    cutoff = (datetime.utcnow() - timedelta(days=refresh_days)).isoformat()
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT video_id FROM videos "
            "WHERE status = 'done' AND downloaded_at IS NOT NULL "
            "  AND downloaded_at >= ? ORDER BY downloaded_at DESC",
            (cutoff,),
        ).fetchall()
    finally:
        conn.close()

    categories = load_categories()
    total = 0
    for r in rows:
        try:
            total += await sync_video_segments(r["video_id"], categories)
        except Exception:
            log.exception("sponsorblock: refresh failed for %s", r["video_id"])
        await asyncio.sleep(0.5)  # politeness gap
    log.info("sponsorblock: refreshed %d videos, %d total segments", len(rows), total)
    return total


def load_categories() -> list[str]:
    conn = get_connection()
    try:
        kv = DB(conn).get_settings()
    finally:
        conn.close()
    raw = kv.get("sponsorblock_categories")
    if raw:
        items = [c.strip() for c in raw.split(",") if c.strip()]
        if items:
            return items
    return list(DEFAULT_CATEGORIES)


def _normalize(raw: Iterable[dict]):
    for item in raw or []:
        try:
            start, end = item["segment"]
            yield {
                "UUID":     item["UUID"],
                "category": item["category"],
                "segment":  [float(start), float(end)],
            }
        except (KeyError, TypeError, ValueError):
            continue
