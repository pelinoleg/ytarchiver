"""Async download worker — picks pending videos and runs yt-dlp via executor.

Supports configurable parallelism (``max_concurrent_downloads`` setting) and a
global pause flag (``downloads_paused``). The coordinator loop atomically claims
the next pending video by flipping its status to ``downloading`` in a single
``BEGIN IMMEDIATE`` transaction, so multiple in-flight tasks never race on the
same row.
"""
from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Optional

from config import settings
from db.database import DB, get_connection
from services import downloader, progress, sponsorblock, preview as preview_service, subtitles_index, error_retry


log = logging.getLogger(__name__)


IDLE_POLL_SECONDS = 5
BETWEEN_DOWNLOADS_MIN = 5     # politeness buffer to YT — overridable via settings
BETWEEN_DOWNLOADS_MAX = 15
PAUSE_POLL_SECONDS = 5

# Transient yt-dlp / network failures auto-retry up to this many times before
# the video is moved to status='error' for the user to deal with.
MAX_TRANSIENT_RETRIES = 3
TRANSIENT_RETRY_COOLDOWN_S = 60

# Heuristic — substring match against the lower-cased exception message.
TRANSIENT_ERROR_MARKERS = (
    "read operation timed out",
    "timed out",
    "timeout",
    "connection reset",
    "connection refused",
    "connection aborted",
    "remote disconnected",
    "remote end closed",
    "incomplete read",
    "broken pipe",
    "temporary failure",
    "network is unreachable",
    "name or service not known",
    "[errno 54]",     # Connection reset by peer (macOS)
    "[errno 60]",     # Operation timed out
    "[errno 104]",    # Connection reset by peer (linux)
    "http error 5",   # 500/502/503/504
    "unable to download webpage",
)


# Settings keys used by the worker — exposed so other modules (routers, the
# variant downloader) can read the same flags without re-hard-coding strings.
PAUSED_KEY = "downloads_paused"
MAX_CONCURRENT_KEY = "max_concurrent_downloads"


def is_paused() -> bool:
    """Read the pause flag straight from the settings KV table.
    Cheap — no caching — the call site is already in a polling loop."""
    raw = _kv_get(PAUSED_KEY)
    if raw is None:
        return False
    return str(raw).strip().lower() in ("1", "true", "yes", "on")


def _kv_get(key: str) -> str | None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,),
        ).fetchone()
        return row["value"] if row else None
    finally:
        conn.close()


def _kv_int(key: str, default: int) -> int:
    raw = _kv_get(key)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


class DownloadWorker:
    def __init__(self) -> None:
        self._coordinator: Optional[asyncio.Task] = None
        self._running = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        # Last DB-write time per video, used to throttle progress persistence.
        self._last_progress_write: dict[str, float] = {}
        # In-memory transient-retry counters. Reset on process restart, which
        # is fine — at worst the user sees one extra retry after a reboot.
        self._retries: dict[str, int] = {}
        # Active download tasks. Coordinator gates new spawns by len().
        self._in_flight: set[asyncio.Task] = set()

    async def start(self) -> None:
        if self._coordinator:
            return
        self._loop = asyncio.get_running_loop()
        progress.set_loop(self._loop)
        self._running = True
        self._coordinator = asyncio.create_task(
            self._coordinator_loop(), name="download-coordinator",
        )
        log.info("download worker started")

    async def stop(self) -> None:
        self._running = False
        if self._coordinator:
            self._coordinator.cancel()
            try:
                await self._coordinator
            except (asyncio.CancelledError, Exception):
                pass
        # Cancel any in-flight downloads so shutdown doesn't hang on a slow yt-dlp.
        for t in list(self._in_flight):
            t.cancel()
        log.info("download worker stopped")

    async def _coordinator_loop(self) -> None:
        """Spawn download tasks up to ``max_concurrent_downloads`` and tend the pool.

        Re-reads the limit and pause flag every tick so changes via /api/settings
        and /api/queue/pause take effect within a few seconds without restart.
        """
        while self._running:
            try:
                # Drop completed tasks from the bookkeeping set.
                done = {t for t in self._in_flight if t.done()}
                self._in_flight -= done

                if is_paused():
                    await asyncio.sleep(PAUSE_POLL_SECONDS)
                    continue

                limit = max(1, _kv_int(MAX_CONCURRENT_KEY, settings.max_concurrent_downloads))
                while len(self._in_flight) < limit:
                    video = self._claim_next_pending()
                    if not video:
                        break
                    task = asyncio.create_task(
                        self._process_and_pause(video),
                        name=f"download-{video['video_id']}",
                    )
                    self._in_flight.add(task)

                await asyncio.sleep(IDLE_POLL_SECONDS if not self._in_flight else 1)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("coordinator tick crashed")
                await asyncio.sleep(10)

    async def _process_and_pause(self, video: dict) -> None:
        """Run one download then apply the politeness sleep. Errors in
        ``_process`` are already swallowed there; this wrapper just protects
        the coordinator from a runaway exception bubbling up via the task set."""
        try:
            await self._process(video)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("worker tick crashed")
        lo = _kv_int("between_downloads_min_seconds", BETWEEN_DOWNLOADS_MIN)
        hi = _kv_int("between_downloads_max_seconds", BETWEEN_DOWNLOADS_MAX)
        if hi < lo:
            hi = lo
        await asyncio.sleep(random.uniform(lo, hi))

    def _claim_next_pending(self) -> dict | None:
        """Atomically pick the oldest pending video and flip it to ``downloading``.

        Uses ``BEGIN IMMEDIATE`` so a second coordinator (or a retry triggered
        from elsewhere) can't grab the same row. Returns None if the queue is
        empty or paused.
        """
        if is_paused():
            return None
        conn = get_connection()
        # Manage the transaction ourselves — sqlite3's implicit commit mode would
        # auto-open a DEFERRED tx on SELECT, which doesn't lock writers out.
        conn.isolation_level = None
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT v.*, c.quality AS channel_quality, c.name AS channel_name "
                "FROM videos v JOIN channels c ON c.id = v.channel_id "
                "WHERE v.status = 'pending' AND v.is_short = 0 "
                "ORDER BY v.added_at LIMIT 1"
            ).fetchone()
            if not row:
                conn.execute("COMMIT")
                return None
            conn.execute(
                "UPDATE videos SET status = 'downloading', error_message = NULL, progress = NULL "
                "WHERE video_id = ?",
                (row["video_id"],),
            )
            conn.execute("COMMIT")
            return dict(row)
        except Exception:
            try:
                conn.execute("ROLLBACK")
            except Exception:
                pass
            raise
        finally:
            conn.close()

    async def _process(self, video: dict) -> None:
        video_id = video["video_id"]
        quality = self._resolve_quality(video)

        self._last_progress_write.pop(video_id, None)
        await progress.broadcast({"video_id": video_id, "status": "downloading"})

        def hook(d: dict) -> None:
            if d.get("status") != "downloading":
                return
            # Compute percent from raw byte counters — more reliable than
            # parsing yt-dlp's ``_percent_str`` (which can be empty / contain
            # ANSI codes / be capped at a coarse update cadence).
            downloaded = float(d.get("downloaded_bytes") or 0)
            total = float(
                d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            )
            pct = (downloaded / total * 100.0) if total > 0 else 0.0

            progress.broadcast_threadsafe({
                "video_id": video_id,
                "status": "downloading",
                "percent": f"{pct:.1f}",
                "downloaded_bytes": int(downloaded),
                "total_bytes": int(total),
                "speed":   (d.get("_speed_str") or "").strip(),
                "eta":     (d.get("_eta_str") or "").strip(),
            })

            # Persist progress to the DB every couple of seconds so a page
            # refresh / refetch picks up the latest state even before the
            # client's WebSocket gets a chance to reconnect.
            now = time.monotonic()
            if now - self._last_progress_write.get(video_id, 0) > 2.0:
                self._last_progress_write[video_id] = now
                try:
                    self._set_status(video_id, "downloading", progress=f"{pct:.1f}")
                except Exception:
                    pass

        try:
            result = await self._loop.run_in_executor(
                None,
                lambda: downloader.download_video(
                    video_id=video_id,
                    channel_id=video["channel_id"],
                    quality=quality,
                    output_root=settings.download_dir,
                    progress_hook=hook,
                ),
            )
            updates = downloader.build_updates_from_info(result)
            self._set_status(video_id, "done", **updates)
            self._retries.pop(video_id, None)
            await progress.broadcast({"video_id": video_id, "status": "done"})
            log.info("done: %s (%s)", video_id, updates.get("title", "?"))
            self._log_event(
                "download_done",
                video_id=video_id,
                video_title=updates.get("title") or video.get("title"),
                channel_id=video["channel_id"],
                channel_name=video.get("channel_name"),
            )
            # Fire-and-forget initial SponsorBlock fetch (it's an async coro).
            asyncio.create_task(self._fetch_segments_safe(video_id))
            # Hover-preview generation is sync ffmpeg work — schedule on the
            # default executor. ``run_in_executor`` already returns a Future
            # scheduled to run, so do NOT wrap it in create_task (which expects
            # a coroutine and would TypeError → bounce the video to status=error
            # even though the download itself succeeded).
            self._loop.run_in_executor(
                None, preview_service.build_preview_for_video, video_id,
            )
            # Subtitle FTS index — cheap, runs even on videos w/o subtitles
            # (returns 0 immediately when subtitle_path is missing).
            sub_path = updates.get("subtitle_path")
            if sub_path:
                self._loop.run_in_executor(
                    None, subtitles_index.index_subtitle, video_id, sub_path,
                )
        except Exception as e:
            msg = str(e)
            if self._is_transient(msg):
                tries = self._retries.get(video_id, 0) + 1
                if tries <= MAX_TRANSIENT_RETRIES:
                    self._retries[video_id] = tries
                    log.warning(
                        "download transient failure (retry %d/%d): %s — %s",
                        tries, MAX_TRANSIENT_RETRIES, video_id, msg[:200],
                    )
                    self._set_status(
                        video_id, "pending",
                        error_message=f"retry {tries}/{MAX_TRANSIENT_RETRIES}: {msg[:300]}",
                    )
                    await progress.broadcast({
                        "video_id": video_id, "status": "pending",
                        "retry_attempt": tries,
                    })
                    self._log_event(
                        "download_retry",
                        message=f"transient ({tries}/{MAX_TRANSIENT_RETRIES}): {msg[:200]}",
                        video_id=video_id,
                        video_title=video.get("title"),
                        channel_id=video["channel_id"],
                        channel_name=video.get("channel_name"),
                    )
                    # Cooldown so the same connection error doesn't loop instantly.
                    await asyncio.sleep(TRANSIENT_RETRY_COOLDOWN_S)
                    return
            log.exception("download failed: %s", video_id)
            self._retries.pop(video_id, None)
            # Known-permanent failures (video unavailable, private, etc.)
            # park as ``skipped`` straight away so they don't camp in the
            # Downloads queue waiting for a retry that'll never work.
            permanent = error_retry.is_permanent(msg)
            final_status = "skipped" if permanent else "error"
            self._set_status(video_id, final_status, error_message=msg[:500])
            await progress.broadcast({
                "video_id": video_id, "status": final_status, "error": msg[:200],
            })
            self._log_event(
                "download_skipped_permanent" if permanent else "download_failed",
                message=msg[:300],
                video_id=video_id,
                video_title=video.get("title"),
                channel_id=video["channel_id"],
                channel_name=video.get("channel_name"),
            )

    @staticmethod
    def _is_transient(msg: str) -> bool:
        if not msg:
            return False
        low = msg.lower()
        return any(m in low for m in TRANSIENT_ERROR_MARKERS)

    @staticmethod
    async def _fetch_segments_safe(video_id: str) -> None:
        try:
            await sponsorblock.sync_video_segments(video_id)
        except Exception:
            log.exception("sponsorblock: initial fetch failed for %s", video_id)

    @staticmethod
    def _resolve_quality(video: dict) -> str:
        """Resolution order, first non-empty wins:
        1. per-video override (videos.quality)
        2. per-channel override (channels.quality)
        3. user global default from the KV settings table (set in /settings UI)
        4. env-file fallback (settings.default_quality)
        """
        if video.get("quality"):
            return video["quality"]
        if video.get("channel_quality"):
            return video["channel_quality"]
        conn = get_connection()
        try:
            kv = DB(conn).get_settings()
        finally:
            conn.close()
        return kv.get("default_quality") or settings.default_quality

    @staticmethod
    def _set_status(video_id: str, status: str, **fields) -> None:
        conn = get_connection()
        try:
            DB(conn).set_video_status(video_id, status, **fields)
        finally:
            conn.close()

    @staticmethod
    def _log_event(type_: str, **kwargs) -> None:
        conn = get_connection()
        try:
            DB(conn).log_event(type_, **kwargs)
        finally:
            conn.close()


worker = DownloadWorker()
