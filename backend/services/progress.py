"""WebSocket connection registry + broadcast helper.

The download worker calls ``broadcast`` to push progress updates to all
connected clients. Hooks running in a yt-dlp thread use ``broadcast_threadsafe``.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import WebSocket


log = logging.getLogger(__name__)


_clients: set[WebSocket] = set()
_lock = asyncio.Lock()
_main_loop: Optional[asyncio.AbstractEventLoop] = None


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _main_loop
    _main_loop = loop


async def register(ws: WebSocket) -> None:
    async with _lock:
        _clients.add(ws)


async def unregister(ws: WebSocket) -> None:
    async with _lock:
        _clients.discard(ws)


async def broadcast(payload: dict) -> None:
    if not _clients:
        return
    dead: list[WebSocket] = []
    for ws in list(_clients):
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    if dead:
        async with _lock:
            for ws in dead:
                _clients.discard(ws)


def broadcast_threadsafe(payload: dict) -> None:
    """Schedule a broadcast from outside the event loop (e.g. yt-dlp progress hook)."""
    loop = _main_loop
    if loop is None or loop.is_closed():
        return
    asyncio.run_coroutine_threadsafe(broadcast(payload), loop)
