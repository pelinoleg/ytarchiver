"""YouTube cookies management.

YouTube throws "Sign in to confirm you're not a bot" at data-center / NAS IPs.
The fix is a Netscape-format ``cookies.txt`` exported from a logged-in browser.
This router lets the user paste that file in the Settings UI; it's written to
``<data_dir>/cookies.txt`` which :func:`services.ytdlp_service.yt_opts_extra`
picks up for every YouTube call (no restart needed).
"""
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.ytdlp_service import (
    managed_cookies_path, yt_opts_extra, cookie_opts, account_is_authenticated,
)


router = APIRouter()
log = logging.getLogger(__name__)

# A well-known, always-available video used to probe whether cookies work.
_TEST_VIDEO = "dQw4w9WgXcQ"


class CookiesBody(BaseModel):
    content: str


def _status() -> dict:
    p = managed_cookies_path()
    if p.exists() and p.is_file() and p.stat().st_size > 0:
        st = p.stat()
        # Count cookie lines (non-comment, non-blank) for a friendly summary.
        try:
            lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
            entries = sum(1 for ln in lines if ln.strip() and not ln.lstrip().startswith("#"))
        except OSError:
            entries = 0
        return {
            "configured": True,
            "size_bytes": st.st_size,
            "entries":    entries,
            "updated_at": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(),
        }
    return {"configured": False, "size_bytes": 0, "entries": 0, "updated_at": None}


@router.get("")
def get_cookies():
    return _status()


@router.put("")
def put_cookies(body: CookiesBody):
    content = body.content or ""
    # Light sanity check — a Netscape cookies.txt is tab-separated and usually
    # carries the header. Reject obvious non-cookie pastes (e.g. JSON) with an
    # actionable message instead of silently breaking every YouTube call.
    looks_ok = ("\t" in content) or content.lstrip().startswith("# Netscape") or content.lstrip().startswith("# HTTP")
    if not content.strip() or not looks_ok:
        raise HTTPException(400, "Это не похоже на Netscape cookies.txt (нужен таб-разделённый формат).")
    p = managed_cookies_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.parent / (p.name + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, p)
    log.info("cookies: saved %d bytes to %s", len(content), p)
    return _status()


@router.delete("", status_code=204)
def delete_cookies():
    p = managed_cookies_path()
    try:
        p.unlink(missing_ok=True)
    except OSError as e:
        raise HTTPException(500, f"couldn't remove cookies: {e}")


@router.post("/test")
def test_cookies():
    """Probe a known video's metadata with the current cookies. Runs in the
    threadpool (sync def), so it won't block the event loop."""
    import yt_dlp

    # Force cookies on for the probe — the whole point is to verify them.
    cookies = cookie_opts()
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "socket_timeout": 20,
        **yt_opts_extra(),
        **cookies,
    }
    using_cookies = bool(cookies)
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            # process=False: we only care that *extraction* (which needs to get
            # past the auth / bot wall) succeeds — skip format selection so a
            # harmless "requested format not available" doesn't read as failure.
            info = ydl.extract_info(
                f"https://www.youtube.com/watch?v={_TEST_VIDEO}",
                download=False, process=False,
            )
        # Also report whether the cookies authenticate the *account* (needed for
        # importing subscriptions / playlists), not just bypass the bot wall.
        authenticated = account_is_authenticated() if using_cookies else False
        return {
            "ok": True,
            "using_cookies": using_cookies,
            "authenticated": authenticated,
            "title": (info or {}).get("title"),
        }
    except Exception as e:
        msg = str(e)
        bot = "Sign in to confirm" in msg or "not a bot" in msg
        return {
            "ok": False,
            "using_cookies": using_cookies,
            "bot_wall": bot,
            "error": msg[-300:],
        }
