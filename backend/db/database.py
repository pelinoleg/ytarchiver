import logging
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

from config import settings


log = logging.getLogger(__name__)

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


# Each migration is (name, [sql statements]). They run idempotently —
# duplicate-column errors are silently swallowed so re-runs are safe.
_MIGRATIONS: list[tuple[str, list[str]]] = [
    ("0001_video_playback_history", [
        "ALTER TABLE videos ADD COLUMN last_watched_at TEXT",
        "ALTER TABLE videos ADD COLUMN last_position_seconds REAL",
        "ALTER TABLE videos ADD COLUMN playback_rate REAL",
        "CREATE INDEX IF NOT EXISTS idx_videos_last_watched ON videos(last_watched_at DESC)",
    ]),
    ("0002_keep_forever", [
        "ALTER TABLE videos ADD COLUMN keep_forever INTEGER NOT NULL DEFAULT 0",
    ]),
    ("0003_drop_per_video_playback_rate", [
        # Playback rate is now a single global setting; the per-video override
        # turned out to be unwanted UX (changing rate on a video felt like a
        # surprise local preference). Drop the column. SQLite >= 3.35 required.
        "ALTER TABLE videos DROP COLUMN playback_rate",
    ]),
    ("0004_is_favorite", [
        "ALTER TABLE videos ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0",
        "CREATE INDEX IF NOT EXISTS idx_videos_favorite ON videos(is_favorite)",
    ]),
    ("0005_show_on_home", [
        "ALTER TABLE channels ADD COLUMN show_on_home INTEGER NOT NULL DEFAULT 1",
    ]),
    ("0006_events", [
        "CREATE TABLE IF NOT EXISTS events ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  type TEXT NOT NULL,"
        "  message TEXT,"
        "  video_id TEXT,"
        "  video_title TEXT,"
        "  channel_id INTEGER,"
        "  channel_name TEXT,"
        "  created_at TEXT NOT NULL DEFAULT (datetime('now'))"
        ")",
        "CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_events_type    ON events(type)",
    ]),
    ("0007_latest_count", [
        # Holds the user-picked N for the "latest N videos" policy.
        # NULL for all other policies.
        "ALTER TABLE channels ADD COLUMN latest_count INTEGER",
    ]),
    ("0008_download_policy", [
        # Remember the original policy string so Rebuild can re-run the
        # appropriate initial pass. NULL for legacy rows — those are inferred
        # heuristically at rebuild time.
        "ALTER TABLE channels ADD COLUMN download_policy TEXT",
    ]),
    ("0009_preview_path", [
        # ffmpeg-built mini preview shown on thumbnail hover.
        "ALTER TABLE videos ADD COLUMN preview_path TEXT",
    ]),
    ("0010_upload_timestamp", [
        # Real publication time from yt-dlp's info.json (Unix seconds).
        # upload_date is just YYYYMMDD — this one carries the hour/minute too.
        "ALTER TABLE videos ADD COLUMN upload_timestamp INTEGER",
    ]),
    ("0011_channel_sync_attrs", [
        # Per-channel attribution of the most recent sync run.
        "ALTER TABLE channels ADD COLUMN last_sync_added_count INTEGER",
        "ALTER TABLE channels ADD COLUMN last_sync_error TEXT",
    ]),
    ("0012_playlists", [
        # Playlists live separately from channel feed. Each playlist references
        # videos via playlist_videos. Videos still live in the videos table —
        # they may belong to channels the user never explicitly subscribed to.
        # ``channels.is_subscribed`` separates real subscriptions from channel
        # rows auto-created because a playlist needed them.
        "ALTER TABLE channels ADD COLUMN is_subscribed INTEGER NOT NULL DEFAULT 1",
        "CREATE TABLE IF NOT EXISTS playlists ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  url TEXT NOT NULL UNIQUE,"
        "  yt_playlist_id TEXT,"
        "  title TEXT NOT NULL,"
        "  description TEXT,"
        "  thumbnail_url TEXT,"
        "  uploader TEXT,"
        "  video_count INTEGER NOT NULL DEFAULT 0,"
        "  quality TEXT,"
        "  retention_days INTEGER,"
        "  show_on_home INTEGER NOT NULL DEFAULT 0,"
        "  last_synced TEXT,"
        "  last_sync_added_count INTEGER,"
        "  last_sync_error TEXT,"
        "  created_at TEXT NOT NULL DEFAULT (datetime('now'))"
        ")",
        "CREATE TABLE IF NOT EXISTS playlist_videos ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,"
        "  video_id TEXT NOT NULL,"
        "  position INTEGER NOT NULL,"
        "  added_at TEXT NOT NULL DEFAULT (datetime('now')),"
        "  UNIQUE (playlist_id, video_id)"
        ")",
        "CREATE INDEX IF NOT EXISTS idx_playlist_videos_pos "
        "  ON playlist_videos(playlist_id, position)",
    ]),
    ("0013_playlist_keep_videos_forever", [
        # When 1, cleanup never deletes videos that belong to this playlist.
        "ALTER TABLE playlists ADD COLUMN keep_videos_forever INTEGER NOT NULL DEFAULT 0",
    ]),
    ("0014_music", [
        # Music mode: marked videos and playlists are hidden from the normal
        # Home / Subscriptions / Playlists views and only surface inside the
        # dedicated /music page.
        "ALTER TABLE videos    ADD COLUMN is_music INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE playlists ADD COLUMN is_music INTEGER NOT NULL DEFAULT 0",
        "CREATE INDEX IF NOT EXISTS idx_videos_is_music    ON videos(is_music)",
        "CREATE INDEX IF NOT EXISTS idx_playlists_is_music ON playlists(is_music)",
    ]),
    ("0015_subtitles_fts", [
        # Full-text search across downloaded VTT subtitles. video_id and
        # start_seconds are UNINDEXED — we never query against them, only
        # return them next to ``snippet()`` hits.
        "CREATE VIRTUAL TABLE IF NOT EXISTS subtitles_fts USING fts5("
        "  video_id      UNINDEXED, "
        "  start_seconds UNINDEXED, "
        "  text, "
        "  tokenize = \"unicode61 remove_diacritics 2\""
        ")",
    ]),
    ("0016_retry_count", [
        # Count of times the error-retry sweeper has re-queued this video. We
        # give up and flip it to ``status='skipped'`` after a few sweeps so
        # dead-ends don't sit in the Downloads queue forever.
        "ALTER TABLE videos ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0",
    ]),
    ("0017_video_width", [
        # Pixel width of the downloaded stream. Pairs with the existing
        # ``quality`` column (which stores pixel height) to give the player
        # an exact aspect ratio at load time — avoids the brief 16:9 →
        # actual-aspect layout shift for portrait / square videos.
        "ALTER TABLE videos ADD COLUMN width INTEGER",
    ]),
    ("0018_channel_folders", [
        # Optional grouping for channels (Tech / Music / Tutorials etc.).
        # Channels with NULL folder_id sit "ungrouped" at the top of the
        # sidebar — same behaviour we have today for everyone.
        "CREATE TABLE IF NOT EXISTS channel_folders ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  name TEXT NOT NULL,"
        "  position INTEGER NOT NULL DEFAULT 0,"
        "  created_at TEXT NOT NULL DEFAULT (datetime('now'))"
        ")",
        "ALTER TABLE channels ADD COLUMN folder_id INTEGER REFERENCES channel_folders(id) ON DELETE SET NULL",
        "CREATE INDEX IF NOT EXISTS idx_channels_folder ON channels(folder_id)",
    ]),
    ("0019_video_variants", [
        # Optional alternative resolutions stored alongside the primary
        # ``videos.file_path`` row. The frontend's quality switcher lists
        # variants and the stream endpoint serves them with ``?height=N``.
        # Variants are independent on-disk artefacts so adding 360p doesn't
        # touch the existing 1080p file.
        "CREATE TABLE IF NOT EXISTS video_variants ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  video_id TEXT NOT NULL,"
        "  height INTEGER NOT NULL,"
        "  file_path TEXT NOT NULL,"
        "  file_size_bytes INTEGER,"
        "  status TEXT NOT NULL DEFAULT 'pending',"   # pending | downloading | done | error
        "  error_message TEXT,"
        "  created_at TEXT NOT NULL DEFAULT (datetime('now')),"
        "  UNIQUE (video_id, height)"
        ")",
        "CREATE INDEX IF NOT EXISTS idx_video_variants_video ON video_variants(video_id)",
    ]),
]


# SQL fragment that evaluates to TRUE for any video that is either explicitly
# flagged as music OR belongs to a playlist that is flagged as music. Inline
# it as ``f"... AND {IS_MUSIC_SQL} ..."`` (the leading ``v.`` alias is required).
IS_MUSIC_SQL = (
    "(v.is_music = 1 OR EXISTS ("
    "  SELECT 1 FROM playlist_videos pv "
    "  JOIN playlists p ON p.id = pv.playlist_id "
    "  WHERE pv.video_id = v.video_id AND p.is_music = 1"
    "))"
)
NOT_MUSIC_SQL = f"NOT {IS_MUSIC_SQL}"


_STOPWORDS = {
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "with", "from",
    "this", "that", "what", "how", "why", "when", "where", "who", "your", "have",
    "has", "had", "will", "can", "did", "was", "were", "she", "him", "her", "his",
    "our", "out", "now", "new", "old", "just", "into", "than", "more", "most",
    "much", "very", "even", "ever", "also", "only", "best", "ваш", "это", "ещё",
    "как", "так", "что", "уже", "для", "тут", "там", "над", "под",
}


def _py_lower(s):
    """Unicode-aware lowercase. SQLite's built-in LOWER only handles ASCII."""
    return s.lower() if isinstance(s, str) else s


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(settings.db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.create_function("PY_LOWER", 1, _py_lower, deterministic=True)
    return conn


def init_schema() -> None:
    conn = get_connection()
    try:
        with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
            conn.executescript(f.read())
        _run_migrations(conn)
    finally:
        conn.close()


def _build_fts_query(title: str) -> Optional[str]:
    """Turn a video title into an FTS5 MATCH expression of OR-ed keywords."""
    if not title:
        return None
    words = re.findall(r"\w{3,}", title.lower())
    filtered = [w for w in words if w not in _STOPWORDS][:8]
    return " OR ".join(filtered) if filtered else None


def _run_migrations(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations "
        "(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
    )
    applied = {r[0] for r in conn.execute("SELECT name FROM schema_migrations").fetchall()}
    for name, statements in _MIGRATIONS:
        if name in applied:
            continue
        for stmt in statements:
            try:
                conn.execute(stmt)
            except sqlite3.OperationalError as e:
                # Tolerate re-application: column may already exist on older databases.
                if "duplicate column name" not in str(e):
                    raise
        conn.execute("INSERT INTO schema_migrations (name) VALUES (?)", (name,))
        log.info("migration applied: %s", name)
    conn.commit()


def get_db():
    """FastAPI dependency — yields a DB and closes its connection after the request."""
    conn = get_connection()
    try:
        yield DB(conn)
    finally:
        conn.close()


class DB:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    # ── Channels ─────────────────────────────────────────────────────────────────

    MANUAL_CHANNEL_MARKER = "__manual__"

    def list_channels(self):
        return self.conn.execute(
            f"SELECT c.*, "
            f"       (SELECT COUNT(*) FROM videos v "
            f"        WHERE v.channel_id = c.id AND v.is_short = 0 "
            f"          AND v.status = 'done' AND {NOT_MUSIC_SQL}) AS video_count, "
            # "Recent" — YouTube upload timestamp within the last 24h.
            # Powers the red sidebar badge. Uses upload_timestamp (epoch
            # seconds, from yt-dlp) rather than downloaded_at so backfills
            # of an old channel don't flash a red dot for week-old uploads
            # just because we grabbed them today.
            f"       (SELECT COUNT(*) FROM videos v "
            f"        WHERE v.channel_id = c.id AND v.is_short = 0 "
            f"          AND v.status = 'done' AND {NOT_MUSIC_SQL} "
            f"          AND v.upload_timestamp IS NOT NULL "
            f"          AND v.upload_timestamp >= CAST(strftime('%s','now','-1 day') AS INTEGER)"
            f"       ) AS recent_count "
            f"FROM channels c "
            f"WHERE (c.yt_channel_id IS NOT ?) AND c.is_subscribed = 1 "
            f"ORDER BY video_count DESC, c.name COLLATE NOCASE ASC",
            (self.MANUAL_CHANNEL_MARKER,),
        ).fetchall()

    def get_or_create_manual_channel(self) -> int:
        row = self.conn.execute(
            "SELECT id FROM channels WHERE yt_channel_id = ?",
            (self.MANUAL_CHANNEL_MARKER,),
        ).fetchone()
        if row:
            return row["id"]
        cur = self.conn.execute(
            "INSERT INTO channels (url, yt_channel_id, name) VALUES (?, ?, ?)",
            (self.MANUAL_CHANNEL_MARKER, self.MANUAL_CHANNEL_MARKER, "Manual downloads"),
        )
        self.conn.commit()
        return cur.lastrowid

    def list_manual_videos(self, *, limit: int = 120, offset: int = 0):
        return self.conn.execute(
            f"SELECT v.*, c.name AS channel_name, c.thumbnail_url AS channel_thumbnail FROM videos v "
            f"JOIN channels c ON c.id = v.channel_id "
            f"WHERE c.yt_channel_id = ? AND v.status = 'done' AND v.is_short = 0 "
            f"  AND {NOT_MUSIC_SQL} "
            f"ORDER BY v.downloaded_at DESC LIMIT ? OFFSET ?",
            (self.MANUAL_CHANNEL_MARKER, limit, offset),
        ).fetchall()

    def list_favorite_videos(self, *, limit: int = 120, offset: int = 0):
        return self.conn.execute(
            f"SELECT v.*, c.name AS channel_name, c.thumbnail_url AS channel_thumbnail FROM videos v "
            f"LEFT JOIN channels c ON c.id = v.channel_id "
            f"WHERE v.is_favorite = 1 AND v.status = 'done' AND v.is_short = 0 "
            f"  AND {NOT_MUSIC_SQL} "
            f"ORDER BY v.downloaded_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()

    def count_favorite_videos(self) -> int:
        row = self.conn.execute(
            f"SELECT COUNT(*) FROM videos v "
            f"WHERE v.is_favorite = 1 AND v.status = 'done' AND v.is_short = 0 "
            f"  AND {NOT_MUSIC_SQL}"
        ).fetchone()
        return row[0] if row else 0

    # ── Music ────────────────────────────────────────────────────────────────────

    def list_music_videos(self, *, limit: int = 500, offset: int = 0):
        """Music = either v.is_music = 1, or video is in a playlist with is_music = 1.
        Both flags surface to the client so the UI can distinguish per-video
        opt-in from inherited-from-playlist."""
        return self.conn.execute(
            f"SELECT v.*, c.name AS channel_name, c.thumbnail_url AS channel_thumbnail, "
            f"       EXISTS ("
            f"         SELECT 1 FROM playlist_videos pv "
            f"         JOIN playlists p ON p.id = pv.playlist_id "
            f"         WHERE pv.video_id = v.video_id AND p.is_music = 1"
            f"       ) AS is_music_via_playlist "
            f"FROM videos v "
            f"LEFT JOIN channels c ON c.id = v.channel_id "
            f"WHERE v.status = 'done' AND v.is_short = 0 "
            f"  AND {IS_MUSIC_SQL} "
            f"ORDER BY v.downloaded_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()

    def list_music_video_ids(self):
        """Just the video_ids, used to build the shuffle queue without
        sending the full payload twice."""
        return [
            r["video_id"] for r in self.conn.execute(
                f"SELECT v.video_id FROM videos v "
                f"WHERE v.status = 'done' AND v.is_short = 0 "
                f"  AND {IS_MUSIC_SQL} "
                f"ORDER BY v.downloaded_at DESC"
            ).fetchall()
        ]

    def count_music_videos(self) -> int:
        row = self.conn.execute(
            f"SELECT COUNT(*) FROM videos v "
            f"WHERE v.status = 'done' AND v.is_short = 0 "
            f"  AND {IS_MUSIC_SQL}"
        ).fetchone()
        return row[0] if row else 0

    def list_music_playlists(self):
        return self.conn.execute(
            "SELECT p.*, "
            "       (SELECT COUNT(*) FROM playlist_videos pv "
            "        WHERE pv.playlist_id = p.id) AS item_count, "
            "       (SELECT COUNT(*) FROM playlist_videos pv "
            "        JOIN videos v ON v.video_id = pv.video_id "
            "        WHERE pv.playlist_id = p.id AND v.status = 'done') AS done_count "
            "FROM playlists p "
            "WHERE p.is_music = 1 "
            "ORDER BY p.title COLLATE NOCASE ASC"
        ).fetchall()

    # ── Playlists ────────────────────────────────────────────────────────────────

    def list_playlists(self):
        # Music playlists are hidden from the regular listing and only show up
        # on the /music page.
        return self.conn.execute(
            "SELECT p.*, "
            "       (SELECT COUNT(*) FROM playlist_videos pv "
            "        WHERE pv.playlist_id = p.id) AS item_count, "
            "       (SELECT COUNT(*) FROM playlist_videos pv "
            "        JOIN videos v ON v.video_id = pv.video_id "
            "        WHERE pv.playlist_id = p.id AND v.status = 'done') AS done_count "
            "FROM playlists p "
            "WHERE p.is_music = 0 "
            "ORDER BY p.title COLLATE NOCASE ASC"
        ).fetchall()

    def get_playlist(self, playlist_id: int):
        return self.conn.execute(
            "SELECT p.*, "
            "       (SELECT COUNT(*) FROM playlist_videos pv "
            "        WHERE pv.playlist_id = p.id) AS item_count, "
            "       (SELECT COUNT(*) FROM playlist_videos pv "
            "        JOIN videos v ON v.video_id = pv.video_id "
            "        WHERE pv.playlist_id = p.id AND v.status = 'done') AS done_count "
            "FROM playlists p WHERE p.id = ?",
            (playlist_id,),
        ).fetchone()

    def get_playlist_by_url(self, url: str):
        return self.conn.execute("SELECT * FROM playlists WHERE url = ?", (url,)).fetchone()

    def add_playlist(
        self, *, url: str, yt_playlist_id: Optional[str], title: str,
        description: Optional[str] = None, thumbnail_url: Optional[str] = None,
        uploader: Optional[str] = None, video_count: int = 0,
        quality: Optional[str] = None, retention_days: Optional[int] = None,
        is_music: bool = False,
    ) -> int:
        cur = self.conn.execute(
            "INSERT INTO playlists "
            "(url, yt_playlist_id, title, description, thumbnail_url, uploader, "
            " video_count, quality, retention_days, is_music) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (url, yt_playlist_id, title, description, thumbnail_url, uploader,
             video_count, quality, retention_days, 1 if is_music else 0),
        )
        self.conn.commit()
        return cur.lastrowid

    def delete_playlist(self, playlist_id: int) -> None:
        self.conn.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
        self.conn.commit()

    def update_playlist_fields(self, playlist_id: int, fields: dict) -> None:
        if not fields:
            return
        cols = ", ".join(f"{k} = ?" for k in fields)
        self.conn.execute(
            f"UPDATE playlists SET {cols} WHERE id = ?",
            [*fields.values(), playlist_id],
        )
        self.conn.commit()

    def upsert_playlist_video(self, playlist_id: int, video_id: str, position: int) -> None:
        self.conn.execute(
            "INSERT INTO playlist_videos (playlist_id, video_id, position) "
            "VALUES (?, ?, ?) "
            "ON CONFLICT(playlist_id, video_id) DO UPDATE SET position = excluded.position",
            (playlist_id, video_id, position),
        )
        self.conn.commit()

    def list_playlist_videos(self, playlist_id: int):
        """Videos in playlist order, joined with full video rows.

        ``skipped`` / ``deleted`` rows are hidden — these are videos that turned
        out to be unavailable / private / removed / no-access. They stay in the
        DB as tombstones (so sync never re-queues them) but must never surface
        in the UI; they only clutter the playlist.
        """
        return self.conn.execute(
            "SELECT v.*, c.name AS channel_name, c.thumbnail_url AS channel_thumbnail, "
            "       pv.position AS playlist_position "
            "FROM playlist_videos pv "
            "JOIN videos v ON v.video_id = pv.video_id "
            "LEFT JOIN channels c ON c.id = v.channel_id "
            "WHERE pv.playlist_id = ? "
            "  AND v.status NOT IN ('skipped', 'deleted') "
            "ORDER BY pv.position",
            (playlist_id,),
        ).fetchall()

    def list_playlists_for_video(self, video_id: str):
        return self.conn.execute(
            "SELECT p.id, p.title, pv.position "
            "FROM playlist_videos pv "
            "JOIN playlists p ON p.id = pv.playlist_id "
            "WHERE pv.video_id = ?",
            (video_id,),
        ).fetchall()

    def ensure_unsubscribed_channel(
        self, yt_channel_id: Optional[str], name: Optional[str],
    ) -> int:
        """Return a channel id for the given yt id (auto-create if unknown).
        New channels are flagged ``is_subscribed=0`` and ``show_on_home=0`` so
        they don't pollute the sidebar or the global Home grid."""
        if yt_channel_id:
            existing = self.conn.execute(
                "SELECT id FROM channels WHERE yt_channel_id = ?", (yt_channel_id,)
            ).fetchone()
            if existing:
                return existing["id"]
            url = f"https://www.youtube.com/channel/{yt_channel_id}/videos"
            cur = self.conn.execute(
                "INSERT INTO channels (url, yt_channel_id, name, is_subscribed, show_on_home) "
                "VALUES (?, ?, ?, 0, 0)",
                (url, yt_channel_id, name or yt_channel_id),
            )
            self.conn.commit()
            return cur.lastrowid
        # No channel id available — fall back to the manual bucket.
        return self.get_or_create_manual_channel()

    def count_manual_videos(self) -> int:
        # Must mirror list_manual_videos exactly — otherwise the sidebar badge
        # claims N items but the page lists M<N. The hidden-because-music gap
        # was the user-reported "72 in sidebar, 0 on page" bug.
        row = self.conn.execute(
            f"SELECT COUNT(*) FROM videos v "
            f"JOIN channels c ON c.id = v.channel_id "
            f"WHERE c.yt_channel_id = ? AND v.status = 'done' AND v.is_short = 0 "
            f"  AND {NOT_MUSIC_SQL}",
            (self.MANUAL_CHANNEL_MARKER,),
        ).fetchone()
        return row[0] if row else 0

    def get_channel(self, channel_id: int):
        return self.conn.execute(
            f"SELECT c.*, "
            f"       (SELECT COUNT(*) FROM videos v "
            f"        WHERE v.channel_id = c.id AND v.is_short = 0 "
            f"          AND v.status = 'done' AND {NOT_MUSIC_SQL}) AS video_count "
            f"FROM channels c WHERE c.id = ?",
            (channel_id,),
        ).fetchone()

    def get_channel_by_url(self, url: str):
        return self.conn.execute(
            "SELECT * FROM channels WHERE url = ?", (url,)
        ).fetchone()

    def add_channel(
        self,
        *,
        url: str,
        yt_channel_id: Optional[str],
        name: str,
        description: Optional[str] = None,
        thumbnail_url: Optional[str] = None,
        subscriber_count: Optional[int] = None,
        download_from_date: Optional[str] = None,
        quality: Optional[str] = None,
        retention_days: Optional[int] = None,
        sync_interval_minutes: Optional[int] = None,
        show_on_home: bool = True,
        folder_id: Optional[int] = None,
        latest_count: Optional[int] = None,
        download_policy: Optional[str] = None,
    ) -> int:
        cur = self.conn.execute(
            "INSERT INTO channels "
            "(url, yt_channel_id, name, description, thumbnail_url, subscriber_count, "
            " download_from_date, quality, retention_days, sync_interval_minutes, "
            " show_on_home, folder_id, latest_count, download_policy) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (url, yt_channel_id, name, description, thumbnail_url, subscriber_count,
             download_from_date, quality, retention_days, sync_interval_minutes,
             1 if show_on_home else 0, folder_id, latest_count, download_policy),
        )
        self.conn.commit()
        return cur.lastrowid

    def update_last_synced(self, channel_id: int) -> None:
        self.conn.execute(
            "UPDATE channels SET last_synced = ? WHERE id = ?",
            (datetime.utcnow().isoformat(), channel_id),
        )
        self.conn.commit()

    def delete_channel(self, channel_id: int) -> None:
        self.conn.execute("DELETE FROM channels WHERE id = ?", (channel_id,))
        self.conn.commit()

    # ── Videos ───────────────────────────────────────────────────────────────────

    def list_videos(
        self,
        *,
        channel_id: Optional[int] = None,
        folder_id: Optional[int] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 60,
        offset: int = 0,
    ):
        if search:
            # Substring search across the user-visible fields. Uses PY_LOWER
            # (registered Python str.lower) so Cyrillic / Unicode work too —
            # SQLite's built-in LOWER is ASCII-only.
            like = f"%{search.lower()}%"
            # Search bypasses the show_on_home filter — user is explicitly
            # asking for "anything that matches", including from hidden channels.
            # It also hides music-flagged items so the regular search doesn't
            # surface them.
            base_filter = f"v.is_short = 0 AND v.status = 'done' AND {NOT_MUSIC_SQL}"
            if channel_id is not None:
                base_filter += " AND v.channel_id = ?"
            return self.conn.execute(
                "SELECT v.*, c.name AS channel_name, c.thumbnail_url AS channel_thumbnail "
                "FROM videos v "
                "LEFT JOIN channels c ON c.id = v.channel_id "
                f"WHERE {base_filter} "
                "  AND ( "
                "    PY_LOWER(IFNULL(v.title,          '')) LIKE ? "
                "    OR PY_LOWER(IFNULL(v.description,    '')) LIKE ? "
                "    OR PY_LOWER(IFNULL(c.name,           '')) LIKE ? "
                "    OR PY_LOWER(IFNULL(v.chapters_json,  '')) LIKE ? "
                "  ) "
                "ORDER BY v.upload_date DESC, v.added_at DESC "
                "LIMIT ? OFFSET ?",
                ((channel_id,) if channel_id is not None else ()) + (like, like, like, like, limit, offset),
            ).fetchall()
        filters = ["v.is_short = 0", NOT_MUSIC_SQL]
        params: list = []
        if channel_id is not None:
            filters.append("v.channel_id = ?")
            params.append(channel_id)
        if folder_id is not None:
            # Folder filter joins through channels.folder_id. Includes only
            # videos whose channel currently belongs to the requested folder.
            filters.append("c.folder_id = ?")
            params.append(folder_id)
        if status is not None:
            filters.append("v.status = ?")
            params.append(status)
        else:
            # Default: only ready-to-watch videos. Pending/downloading/error
            # belong on the Downloads page; skipped/deleted are hidden entirely.
            filters.append("v.status = 'done'")
        # Honor the channel-level "show on home" toggle, but only on the global
        # Home list — when filtering by a specific channel the user obviously
        # wants to see that channel regardless.
        if channel_id is None and status is None:
            filters.append("(c.show_on_home IS NULL OR c.show_on_home = 1 OR v.is_favorite = 1)")
        where = "WHERE " + " AND ".join(filters)
        params += [limit, offset]
        return self.conn.execute(
            f"SELECT v.*, c.name AS channel_name, c.thumbnail_url AS channel_thumbnail "
            f"FROM videos v "
            f"LEFT JOIN channels c ON c.id = v.channel_id "
            f"{where} "
            f"ORDER BY v.upload_date DESC, v.added_at DESC "
            f"LIMIT ? OFFSET ?",
            params,
        ).fetchall()

    def get_video(self, video_id: str):
        return self.conn.execute(
            "SELECT v.*, c.name AS channel_name, c.thumbnail_url AS channel_thumbnail, "
            "       EXISTS ("
            "         SELECT 1 FROM playlist_videos pv "
            "         JOIN playlists p ON p.id = pv.playlist_id "
            "         WHERE pv.video_id = v.video_id AND p.keep_videos_forever = 1"
            "       ) AS kept_by_playlist, "
            "       EXISTS ("
            "         SELECT 1 FROM playlist_videos pv "
            "         JOIN playlists p ON p.id = pv.playlist_id "
            "         WHERE pv.video_id = v.video_id AND p.is_music = 1"
            "       ) AS is_music_via_playlist "
            "FROM videos v LEFT JOIN channels c ON c.id = v.channel_id "
            "WHERE v.video_id = ?",
            (video_id,),
        ).fetchone()

    def video_exists(self, video_id: str) -> bool:
        return bool(
            self.conn.execute(
                "SELECT 1 FROM videos WHERE video_id = ?", (video_id,)
            ).fetchone()
        )

    def add_video(
        self,
        *,
        video_id: str,
        channel_id: int,
        title: str,
        description: Optional[str] = None,
        duration: Optional[int] = None,
        upload_date: Optional[str] = None,
        thumbnail_url: Optional[str] = None,
        is_short: bool = False,
        status: str = "pending",
    ) -> Optional[int]:
        cur = self.conn.execute(
            "INSERT OR IGNORE INTO videos "
            "(video_id, channel_id, title, description, duration, upload_date, "
            " thumbnail_url, is_short, status) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (video_id, channel_id, title, description, duration, upload_date,
             thumbnail_url, 1 if is_short else 0, status),
        )
        self.conn.commit()
        return cur.lastrowid

    def set_video_status(self, video_id: str, status: str, **fields) -> None:
        updates: dict = {"status": status, **fields}
        if status == "done":
            updates.setdefault("downloaded_at", datetime.utcnow().isoformat())
        cols = ", ".join(f"{k} = ?" for k in updates)
        self.conn.execute(
            f"UPDATE videos SET {cols} WHERE video_id = ?",
            [*updates.values(), video_id],
        )
        self.conn.commit()

    def delete_video(self, video_pk: int) -> None:
        self.conn.execute("DELETE FROM videos WHERE id = ?", (video_pk,))
        self.conn.commit()

    def soft_delete_video(self, video_pk: int) -> Optional[dict]:
        """Mark a video as deleted (status='deleted') and null out file paths.
        Returns the row's video_id + channel_id so the caller can wipe files."""
        row = self.conn.execute(
            "SELECT video_id, channel_id FROM videos WHERE id = ?", (video_pk,)
        ).fetchone()
        if not row:
            return None
        self.conn.execute(
            "UPDATE videos SET status='deleted', file_path=NULL, thumbnail_path=NULL, "
            "subtitle_path=NULL, info_path=NULL WHERE id = ?",
            (video_pk,),
        )
        self.conn.commit()
        return {"video_id": row["video_id"], "channel_id": row["channel_id"]}

    def update_video_fields(self, video_id: str, fields: dict) -> None:
        if not fields:
            return
        # Coerce bools to int for SQLite
        clean = {k: (1 if v is True else 0 if v is False else v) for k, v in fields.items()}
        cols = ", ".join(f"{k} = ?" for k in clean)
        self.conn.execute(
            f"UPDATE videos SET {cols} WHERE video_id = ?",
            [*clean.values(), video_id],
        )
        self.conn.commit()

    # ── Channel folders ─────────────────────────────────────────────────────

    def list_channel_folders(self):
        return self.conn.execute(
            "SELECT * FROM channel_folders ORDER BY position, name COLLATE NOCASE"
        ).fetchall()

    def add_channel_folder(self, name: str, position: int = 0) -> int:
        cur = self.conn.execute(
            "INSERT INTO channel_folders (name, position) VALUES (?, ?)",
            (name, position),
        )
        self.conn.commit()
        return cur.lastrowid

    def update_channel_folder(self, folder_id: int, fields: dict) -> None:
        if not fields:
            return
        cols = ", ".join(f"{k} = ?" for k in fields)
        self.conn.execute(
            f"UPDATE channel_folders SET {cols} WHERE id = ?",
            [*fields.values(), folder_id],
        )
        self.conn.commit()

    def delete_channel_folder(self, folder_id: int) -> None:
        # Foreign key ``ON DELETE SET NULL`` un-groups affected channels.
        self.conn.execute("DELETE FROM channel_folders WHERE id = ?", (folder_id,))
        self.conn.commit()

    # ── Video variants (alternative resolutions) ────────────────────────────

    def list_video_variants(self, video_id: str):
        return self.conn.execute(
            "SELECT * FROM video_variants WHERE video_id = ? "
            "ORDER BY height DESC",
            (video_id,),
        ).fetchall()

    def get_video_variant(self, video_id: str, height: int):
        return self.conn.execute(
            "SELECT * FROM video_variants WHERE video_id = ? AND height = ?",
            (video_id, height),
        ).fetchone()

    def upsert_video_variant(self, *, video_id: str, height: int, file_path: str,
                             status: str = "pending") -> int:
        cur = self.conn.execute(
            "INSERT INTO video_variants (video_id, height, file_path, status) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(video_id, height) DO UPDATE SET "
            "  file_path = excluded.file_path, status = excluded.status, "
            "  error_message = NULL",
            (video_id, height, file_path, status),
        )
        self.conn.commit()
        return cur.lastrowid

    def set_variant_status(self, variant_id: int, status: str, **fields) -> None:
        updates = {"status": status, **fields}
        cols = ", ".join(f"{k} = ?" for k in updates)
        self.conn.execute(
            f"UPDATE video_variants SET {cols} WHERE id = ?",
            [*updates.values(), variant_id],
        )
        self.conn.commit()

    def delete_video_variant(self, variant_id: int):
        row = self.conn.execute(
            "SELECT * FROM video_variants WHERE id = ?", (variant_id,),
        ).fetchone()
        if not row:
            return None
        self.conn.execute("DELETE FROM video_variants WHERE id = ?", (variant_id,))
        self.conn.commit()
        return dict(row)

    def update_channel_fields(self, channel_id: int, fields: dict) -> None:
        if not fields:
            return
        cols = ", ".join(f"{k} = ?" for k in fields)
        self.conn.execute(
            f"UPDATE channels SET {cols} WHERE id = ?",
            [*fields.values(), channel_id],
        )
        self.conn.commit()

    # ── Related videos ──────────────────────────────────────────────────────────

    def list_related(self, *, video_id: str, channel_id: int, title: str, limit: int = 12):
        """Recommend videos for the "Up next" sidebar / autoplay.

        Three-tier strategy. Each tier returns its rows only if non-empty:

          1. **FTS5 title match + watch-history boost**. Score = ``-rank`` (FTS
             relevance, more negative = better) MINUS a watch-history weight:
             channels the user has watched recently get a bonus, channels
             they've watched a LOT get a bigger bonus, current channel
             gets the largest bonus. The math is intentionally simple so
             a query plan stays cheap on SQLite.

          2. Same channel (newest first) — when FTS finds nothing useful,
             "more from this creator" is the most natural fallback.

          3. Anything recently downloaded — last resort.

        Music and shorts are always filtered out, plus the current video. """
        fts_q = _build_fts_query(title)
        rows = []
        if fts_q:
            try:
                rows = self.conn.execute(
                    f"SELECT v.*, c.name AS channel_name, c.thumbnail_url AS channel_thumbnail, "
                    f"       fts.rank AS fts_rank, "
                    # Watch-history score: COUNT of watched videos from this
                    # channel within the last 90 days. SQLite returns 0 when
                    # the sub-select has no matches, no NULL gymnastics needed.
                    f"       (SELECT COUNT(*) FROM videos w "
                    f"        WHERE w.channel_id = v.channel_id "
                    f"          AND w.last_watched_at >= datetime('now', '-90 days')) AS watch_history "
                    f"FROM videos v "
                    f"JOIN videos_fts fts ON fts.rowid = v.id "
                    f"LEFT JOIN channels c ON c.id = v.channel_id "
                    f"WHERE videos_fts MATCH ? "
                    f"  AND v.video_id != ? AND v.status = 'done' AND v.is_short = 0 "
                    f"  AND {NOT_MUSIC_SQL} "
                    # Composite ordering. ``rank`` is negative for matches
                    # (lower = better); we subtract a watch-history-derived
                    # bonus so heavily-watched channels float up. The same-
                    # channel bonus (additive +2.0) is large enough to beat
                    # most title-only matches from elsewhere.
                    f"ORDER BY ("
                    f"    fts.rank "
                    f"    - (CASE WHEN v.channel_id = ? THEN 2.0 ELSE 0 END) "
                    f"    - MIN(watch_history * 0.15, 1.5) "
                    f"  ) ASC "
                    f"LIMIT ?",
                    (fts_q, video_id, channel_id, limit),
                ).fetchall()
            except sqlite3.OperationalError:
                rows = []
        if rows:
            return rows
        rows = self.conn.execute(
            f"SELECT v.*, c.name AS channel_name, c.thumbnail_url AS channel_thumbnail FROM videos v "
            f"LEFT JOIN channels c ON c.id = v.channel_id "
            f"WHERE v.video_id != ? AND v.channel_id = ? AND v.status = 'done' "
            f"  AND v.is_short = 0 AND {NOT_MUSIC_SQL} "
            f"ORDER BY v.upload_date DESC, v.added_at DESC LIMIT ?",
            (video_id, channel_id, limit),
        ).fetchall()
        if rows:
            return rows
        return self.conn.execute(
            f"SELECT v.*, c.name AS channel_name, c.thumbnail_url AS channel_thumbnail FROM videos v "
            f"LEFT JOIN channels c ON c.id = v.channel_id "
            f"WHERE v.video_id != ? AND v.status = 'done' AND v.is_short = 0 "
            f"  AND {NOT_MUSIC_SQL} "
            f"ORDER BY v.upload_date DESC, v.added_at DESC LIMIT ?",
            (video_id, limit),
        ).fetchall()

    # ── SponsorBlock segments ────────────────────────────────────────────────────

    def list_sponsor_segments(self, video_id: str):
        return self.conn.execute(
            "SELECT segment_uuid, category, start_seconds, end_seconds "
            "FROM sponsor_segments WHERE video_id = ? ORDER BY start_seconds",
            (video_id,),
        ).fetchall()

    def replace_sponsor_segments(self, video_id: str, segments: list[dict]) -> None:
        self.conn.execute("DELETE FROM sponsor_segments WHERE video_id = ?", (video_id,))
        for s in segments:
            start, end = s["segment"]
            self.conn.execute(
                "INSERT OR IGNORE INTO sponsor_segments "
                "(video_id, segment_uuid, category, start_seconds, end_seconds) "
                "VALUES (?, ?, ?, ?, ?)",
                (video_id, s["UUID"], s["category"], start, end),
            )
        self.conn.commit()

    def list_active_queue(self):
        return self.conn.execute(
            "SELECT v.*, c.name AS channel_name, c.thumbnail_url AS channel_thumbnail "
            "FROM videos v LEFT JOIN channels c ON c.id = v.channel_id "
            "WHERE v.status IN ('pending', 'queued', 'downloading', 'error') "
            "  AND v.is_short = 0 "
            "ORDER BY CASE v.status WHEN 'downloading' THEN 1 "
            "                       WHEN 'queued'      THEN 2 "
            "                       WHEN 'pending'     THEN 3 "
            "                       ELSE 4 END, v.added_at"
        ).fetchall()

    def list_history(self, limit: int = 200):
        return self.conn.execute(
            f"SELECT v.*, c.name AS channel_name, c.thumbnail_url AS channel_thumbnail "
            f"FROM videos v LEFT JOIN channels c ON c.id = v.channel_id "
            f"WHERE v.last_watched_at IS NOT NULL AND v.is_short = 0 "
            f"  AND {NOT_MUSIC_SQL} "
            f"ORDER BY v.last_watched_at DESC LIMIT ?",
            (limit,),
        ).fetchall()

    # ── Storage dashboard ────────────────────────────────────────────────────

    def list_largest_videos(self, limit: int = 30):
        return self.conn.execute(
            "SELECT v.*, c.name AS channel_name, c.thumbnail_url AS channel_thumbnail "
            "FROM videos v LEFT JOIN channels c ON c.id = v.channel_id "
            "WHERE v.status = 'done' AND v.file_size_bytes IS NOT NULL "
            "ORDER BY v.file_size_bytes DESC LIMIT ?",
            (limit,),
        ).fetchall()

    def list_largest_channels(self, limit: int = 15):
        return self.conn.execute(
            "SELECT c.id, c.name, c.thumbnail_url, "
            "       COUNT(v.id) AS video_count, "
            "       COALESCE(SUM(v.file_size_bytes), 0) AS total_bytes "
            "FROM channels c LEFT JOIN videos v ON v.channel_id = c.id "
            "WHERE v.status = 'done' AND v.file_size_bytes IS NOT NULL "
            "GROUP BY c.id, c.name, c.thumbnail_url "
            "ORDER BY total_bytes DESC LIMIT ?",
            (limit,),
        ).fetchall()

    def list_old_watched(self, min_days: int = 30, limit: int = 50):
        """Videos with last_watched_at older than N days — natural cleanup
        candidates. Skips pinned / favorite / music."""
        return self.conn.execute(
            f"SELECT v.*, c.name AS channel_name, c.thumbnail_url AS channel_thumbnail "
            f"FROM videos v LEFT JOIN channels c ON c.id = v.channel_id "
            f"WHERE v.status = 'done' AND v.last_watched_at IS NOT NULL "
            f"  AND v.last_watched_at < datetime('now', ?) "
            f"  AND v.keep_forever = 0 AND v.is_favorite = 0 "
            f"  AND {NOT_MUSIC_SQL} "
            f"ORDER BY v.last_watched_at ASC LIMIT ?",
            (f"-{int(min_days)} days", limit),
        ).fetchall()

    def storage_summary(self):
        """Aggregate numbers for the dashboard header."""
        row = self.conn.execute(
            "SELECT COUNT(*) AS videos, "
            "       COALESCE(SUM(file_size_bytes), 0) AS total_bytes, "
            "       COALESCE(AVG(file_size_bytes), 0) AS avg_bytes, "
            "       COALESCE(MAX(file_size_bytes), 0) AS max_bytes "
            "FROM videos WHERE status = 'done' AND file_size_bytes IS NOT NULL"
        ).fetchone()
        return dict(row) if row else {"videos": 0, "total_bytes": 0, "avg_bytes": 0, "max_bytes": 0}

    def list_continue_watching(self, limit: int = 20):
        """Videos started but not yet finished — between 5% and 95% watched.
        Music tracks are excluded; they live in their own section."""
        return self.conn.execute(
            f"SELECT v.*, c.name AS channel_name, c.thumbnail_url AS channel_thumbnail "
            f"FROM videos v LEFT JOIN channels c ON c.id = v.channel_id "
            f"WHERE v.status = 'done' AND v.is_short = 0 AND {NOT_MUSIC_SQL} "
            f"  AND v.duration IS NOT NULL AND v.duration > 0 "
            f"  AND v.last_position_seconds IS NOT NULL "
            f"  AND v.last_position_seconds > 0.05 * v.duration "
            f"  AND v.last_position_seconds < 0.95 * v.duration "
            f"  AND v.last_watched_at IS NOT NULL "
            f"ORDER BY v.last_watched_at DESC LIMIT ?",
            (limit,),
        ).fetchall()

    # ── Events ───────────────────────────────────────────────────────────────────

    def log_event(
        self, type_: str, *,
        message: Optional[str] = None,
        video_id: Optional[str] = None,
        video_title: Optional[str] = None,
        channel_id: Optional[int] = None,
        channel_name: Optional[str] = None,
    ) -> None:
        self.conn.execute(
            "INSERT INTO events (type, message, video_id, video_title, channel_id, channel_name) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (type_, message, video_id, video_title, channel_id, channel_name),
        )
        self.conn.commit()

    def list_events(self, *, type_: Optional[str] = None, limit: int = 200, offset: int = 0):
        """Activity feed rows joined with video + channel artwork for richer
        UI rendering. Joins are LEFT so we don't drop events whose subject has
        since been deleted from the videos / channels tables."""
        base = (
            "SELECT e.*, "
            "       v.thumbnail_url  AS video_thumbnail_url, "
            "       v.thumbnail_path AS video_thumbnail_path, "
            "       v.duration       AS video_duration, "
            "       v.status         AS video_status, "
            "       c.thumbnail_url  AS channel_thumbnail_url "
            "FROM events e "
            "LEFT JOIN videos   v ON v.video_id = e.video_id "
            "LEFT JOIN channels c ON c.id       = e.channel_id "
        )
        if type_:
            return self.conn.execute(
                base + "WHERE e.type = ? ORDER BY e.created_at DESC LIMIT ? OFFSET ?",
                (type_, limit, offset),
            ).fetchall()
        return self.conn.execute(
            base + "ORDER BY e.created_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()

    def list_event_types(self):
        return [r[0] for r in self.conn.execute(
            "SELECT DISTINCT type FROM events ORDER BY type"
        ).fetchall()]

    def update_playback(
        self, video_id: str, *,
        position: float | None = None,
        mark_watched: bool = False,
    ) -> None:
        """Per-video playback bookkeeping. Rate is global — handled at the
        settings layer in the router."""
        sets, params = [], []
        if position is not None:
            sets.append("last_position_seconds = ?"); params.append(position)
        if mark_watched:
            sets.append("last_watched_at = ?"); params.append(datetime.utcnow().isoformat())
        if not sets:
            return
        params.append(video_id)
        self.conn.execute(
            f"UPDATE videos SET {', '.join(sets)} WHERE video_id = ?",
            params,
        )
        self.conn.commit()

    # ── Settings (KV) ────────────────────────────────────────────────────────────

    def get_settings(self) -> dict:
        rows = self.conn.execute("SELECT key, value FROM settings").fetchall()
        return {r["key"]: r["value"] for r in rows}

    def set_settings(self, kv: dict) -> None:
        for k, v in kv.items():
            self.conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (k, None if v is None else str(v)),
            )
        self.conn.commit()
