from fastapi import APIRouter, Depends

from db.database import DB, get_db


router = APIRouter()


@router.get("")
def stats(db: DB = Depends(get_db)):
    """Lightweight summary used by the sidebar footer."""
    # Channel count = real user subscriptions only. The manual bucket and
    # playlist-borrowed channels (is_subscribed=0) don't count here, even
    # though their videos still contribute to "Videos" and "Storage" below.
    channels = db.conn.execute(
        "SELECT COUNT(*) FROM channels "
        "WHERE is_subscribed = 1 "
        "  AND (yt_channel_id IS NULL OR yt_channel_id != '__manual__')"
    ).fetchone()[0]
    videos = db.conn.execute(
        "SELECT COUNT(*) FROM videos WHERE status = 'done' AND is_short = 0"
    ).fetchone()[0]
    bytes_total = db.conn.execute(
        "SELECT COALESCE(SUM(file_size_bytes), 0) FROM videos "
        "WHERE status = 'done' AND file_size_bytes IS NOT NULL"
    ).fetchone()[0]
    return {
        "channels":    channels,
        "videos":      videos,
        "total_bytes": int(bytes_total or 0),
    }
