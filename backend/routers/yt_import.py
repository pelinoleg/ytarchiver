"""Import the cookie-authenticated user's YouTube subscriptions.

Reads the subscribed-channel list via yt-dlp (needs valid login cookies) and
flags which are already in the archive. Subscribing itself reuses the normal
``POST /api/channels`` flow, one channel at a time, so per-item quality / policy
just work.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException

from db.database import DB, get_db
from services import ytdlp_service


router = APIRouter()
log = logging.getLogger(__name__)


@router.get("/subscriptions")
def list_subscriptions(db: DB = Depends(get_db)):
    """Subscribed channels for the logged-in account, each flagged with whether
    it's already in the archive."""
    if not ytdlp_service.cookie_opts():
        raise HTTPException(400, "Сначала задай cookies в настройках.")
    try:
        subs = ytdlp_service.fetch_subscriptions()
    except ytdlp_service.NotAuthenticated:
        raise HTTPException(
            409,
            "Cookies не авторизуют аккаунт — нужен экспорт куки залогиненного "
            "YouTube (с first-party login-куки). Переэкспортируй и сохрани заново.",
        )
    except Exception as e:
        raise HTTPException(400, f"Не удалось получить подписки: {str(e)[:200]}")

    rows = db.conn.execute("SELECT yt_channel_id, url FROM channels").fetchall()
    known_ids = {r["yt_channel_id"] for r in rows if r["yt_channel_id"]}
    known_urls = {(r["url"] or "").rstrip("/") for r in rows}

    out = []
    for s in subs:
        already = (s.get("channel_id") in known_ids) or ((s.get("url") or "").rstrip("/") in known_urls)
        out.append({**s, "already_added": already})
    return {"count": len(out), "subscriptions": out}
