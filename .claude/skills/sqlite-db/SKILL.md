---
name: sqlite-db
description: >
  Use this skill for all database work in the YT Archiver project: schema
  creation, migrations, queries, indexes. Triggers on: create table, add
  column, query videos, store channel, update status, search videos, get
  download queue, database connection setup. Do NOT use for API routes
  (fastapi-backend skill) or yt-dlp calls (ytdlp-downloader skill).
---

# SQLite Database Skill

## Why SQLite

Self-hosted project on NAS/VPS — SQLite is perfect:
- Zero config, single file, portable
- Handles hundreds of thousands of videos without issues
- WAL mode gives concurrent reads during writes
- No separate DB server process

## Connection setup (db/database.py)

```python
import sqlite3
from contextlib import contextmanager
from config import settings

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(settings.db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row   # access columns by name: row["title"]
    conn.execute("PRAGMA journal_mode=WAL")      # concurrent reads
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")    # safe + fast
    return conn

# Dependency for FastAPI
def get_db():
    conn = get_connection()
    try:
        yield DB(conn)
    finally:
        conn.close()
```

## Schema (run once on startup)

```sql
-- channels: YouTube channels the user subscribes to
CREATE TABLE IF NOT EXISTS channels (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    url             TEXT NOT NULL UNIQUE,
    channel_id      TEXT,               -- YouTube channel ID (UCxxx)
    name            TEXT,
    description     TEXT,
    thumbnail_url   TEXT,
    last_synced     TEXT,               -- ISO datetime string
    sync_interval_h INTEGER DEFAULT 6,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- videos: every video known to the system
CREATE TABLE IF NOT EXISTS videos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id        TEXT NOT NULL UNIQUE,   -- YouTube video ID
    channel_id      INTEGER REFERENCES channels(id) ON DELETE CASCADE,
    title           TEXT,
    description     TEXT,
    duration        INTEGER,               -- seconds
    upload_date     TEXT,                  -- YYYYMMDD
    file_path       TEXT,                  -- absolute path on disk
    thumbnail_path  TEXT,
    status          TEXT DEFAULT 'queued', -- queued|downloading|done|error|skipped
    error_message   TEXT,
    progress        TEXT,                  -- e.g. "42.3%"
    file_size_bytes INTEGER,
    added_at        TEXT DEFAULT (datetime('now')),
    downloaded_at   TEXT
);

-- FTS index for full-text search on title + description
CREATE VIRTUAL TABLE IF NOT EXISTS videos_fts USING fts5(
    title, description,
    content='videos', content_rowid='id'
);

-- Keep FTS in sync with videos table
CREATE TRIGGER IF NOT EXISTS videos_ai AFTER INSERT ON videos BEGIN
    INSERT INTO videos_fts(rowid, title, description)
    VALUES (new.id, new.title, new.description);
END;
CREATE TRIGGER IF NOT EXISTS videos_ad AFTER DELETE ON videos BEGIN
    INSERT INTO videos_fts(videos_fts, rowid, title, description)
    VALUES ('delete', old.id, old.title, old.description);
END;
CREATE TRIGGER IF NOT EXISTS videos_au AFTER UPDATE ON videos BEGIN
    INSERT INTO videos_fts(videos_fts, rowid, title, description)
    VALUES ('delete', old.id, old.title, old.description);
    INSERT INTO videos_fts(rowid, title, description)
    VALUES (new.id, new.title, new.description);
END;

-- Useful indexes
CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_videos_status  ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_date    ON videos(upload_date DESC);
```

## DB class with all queries (db/database.py)

```python
import sqlite3
from datetime import datetime

class DB:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    # ── Channels ──────────────────────────────────────────────────────────────

    def get_all_channels(self) -> list:
        return self.conn.execute(
            "SELECT c.*, COUNT(v.id) AS video_count "
            "FROM channels c LEFT JOIN videos v ON v.channel_id = c.id "
            "GROUP BY c.id ORDER BY c.name"
        ).fetchall()

    def get_channel(self, channel_id: int):
        return self.conn.execute(
            "SELECT * FROM channels WHERE id = ?", (channel_id,)
        ).fetchone()

    def add_channel(self, url, channel_id, name, description=None, thumbnail_url=None) -> int:
        cur = self.conn.execute(
            "INSERT INTO channels (url, channel_id, name, description, thumbnail_url) "
            "VALUES (?, ?, ?, ?, ?)",
            (url, channel_id, name, description, thumbnail_url)
        )
        self.conn.commit()
        return cur.lastrowid

    def update_last_synced(self, channel_id: int):
        self.conn.execute(
            "UPDATE channels SET last_synced = ? WHERE id = ?",
            (datetime.utcnow().isoformat(), channel_id)
        )
        self.conn.commit()

    def delete_channel(self, channel_id: int):
        self.conn.execute("DELETE FROM channels WHERE id = ?", (channel_id,))
        self.conn.commit()

    # ── Videos ────────────────────────────────────────────────────────────────

    def get_videos(
        self,
        channel_id: int = None,
        status: str = None,
        search: str = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list:
        if search:
            # FTS search
            return self.conn.execute(
                "SELECT v.* FROM videos v "
                "JOIN videos_fts fts ON fts.rowid = v.id "
                "WHERE videos_fts MATCH ? "
                "ORDER BY v.upload_date DESC LIMIT ? OFFSET ?",
                (search, limit, offset)
            ).fetchall()

        filters, params = [], []
        if channel_id:
            filters.append("channel_id = ?"); params.append(channel_id)
        if status:
            filters.append("status = ?"); params.append(status)
        where = ("WHERE " + " AND ".join(filters)) if filters else ""
        params += [limit, offset]
        return self.conn.execute(
            f"SELECT * FROM videos {where} ORDER BY upload_date DESC LIMIT ? OFFSET ?",
            params
        ).fetchall()

    def get_video(self, video_id: str):
        return self.conn.execute(
            "SELECT * FROM videos WHERE video_id = ?", (video_id,)
        ).fetchone()

    def video_exists(self, video_id: str) -> bool:
        return bool(self.conn.execute(
            "SELECT 1 FROM videos WHERE video_id = ?", (video_id,)
        ).fetchone())

    def add_video(self, video_id, channel_id, title, upload_date=None,
                  duration=None, url=None) -> int:
        cur = self.conn.execute(
            "INSERT OR IGNORE INTO videos "
            "(video_id, channel_id, title, upload_date, duration, status) "
            "VALUES (?, ?, ?, ?, ?, 'queued')",
            (video_id, channel_id, title, upload_date, duration)
        )
        self.conn.commit()
        return cur.lastrowid

    def set_status(self, video_id: str, status: str,
                   file_path: str = None, error: str = None,
                   progress: str = None):
        updates = {"status": status}
        if file_path: updates["file_path"] = file_path
        if error:     updates["error_message"] = error
        if progress:  updates["progress"] = progress
        if status == "done":
            updates["downloaded_at"] = datetime.utcnow().isoformat()

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        self.conn.execute(
            f"UPDATE videos SET {set_clause} WHERE video_id = ?",
            [*updates.values(), video_id]
        )
        self.conn.commit()

    def get_queue(self) -> list:
        return self.conn.execute(
            "SELECT v.*, c.name AS channel_name FROM videos v "
            "LEFT JOIN channels c ON c.id = v.channel_id "
            "WHERE v.status IN ('queued', 'downloading') "
            "ORDER BY v.added_at"
        ).fetchall()

    def delete_video(self, video_id: int):
        self.conn.execute("DELETE FROM videos WHERE id = ?", (video_id,))
        self.conn.commit()
```

## Init schema on app startup

```python
# In main.py lifespan, before scheduler.start():
from db.database import get_connection

def init_db():
    conn = get_connection()
    with open("db/schema.sql") as f:
        conn.executescript(f.read())
    conn.close()
```

## Migrations (simple approach)

No Alembic needed for this project. Use a `migrations` table:

```python
MIGRATIONS = [
    ("001_add_file_size", "ALTER TABLE videos ADD COLUMN file_size_bytes INTEGER"),
    ("002_add_skipped_status", "-- no-op, status column is TEXT"),
]

def run_migrations(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY)")
    applied = {r[0] for r in conn.execute("SELECT name FROM migrations")}
    for name, sql in MIGRATIONS:
        if name not in applied:
            conn.execute(sql)
            conn.execute("INSERT INTO migrations VALUES (?)", (name,))
    conn.commit()
```

## Rules

- ALWAYS enable WAL mode and foreign keys on every connection
- ALWAYS use `INSERT OR IGNORE` when inserting videos — duplicates happen
- NEVER store YouTube URLs in the DB — reconstruct from `video_id`: `f"https://youtu.be/{video_id}"`
- Use FTS5 for search — don't do `LIKE '%query%'` on large tables, it's slow
- `upload_date` is stored as `YYYYMMDD` string (yt-dlp format) — sort as TEXT, it works
- `conn.row_factory = sqlite3.Row` is mandatory — rows must be accessible by column name
