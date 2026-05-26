-- channels: subscribed YouTube channels
CREATE TABLE IF NOT EXISTS channels (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    url                   TEXT NOT NULL UNIQUE,
    yt_channel_id         TEXT,
    name                  TEXT NOT NULL,
    description           TEXT,
    thumbnail_url         TEXT,
    subscriber_count      INTEGER,
    download_from_date    TEXT,    -- NULL = only new from subscribe time; YYYYMMDD = backfill from
    quality               TEXT,    -- NULL = inherit global default
    retention_days        INTEGER, -- NULL = inherit; 0 = forever; N = delete after N days
    sync_interval_minutes INTEGER, -- NULL = inherit global
    last_synced           TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- videos: every video known to the system (downloaded or pending)
CREATE TABLE IF NOT EXISTS videos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id        TEXT NOT NULL UNIQUE,
    channel_id      INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT,
    duration        INTEGER,
    upload_date     TEXT,           -- YYYYMMDD
    thumbnail_url   TEXT,
    thumbnail_path  TEXT,
    file_path       TEXT,
    subtitle_path   TEXT,
    info_path       TEXT,
    quality         TEXT,           -- per-video quality override
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending|queued|downloading|done|error|skipped
    error_message   TEXT,
    progress        TEXT,
    file_size_bytes INTEGER,
    chapters_json   TEXT,           -- JSON array of {start, title}
    is_short        INTEGER NOT NULL DEFAULT 0,
    added_at        TEXT NOT NULL DEFAULT (datetime('now')),
    downloaded_at   TEXT
    -- Newer columns (last_watched_at, last_position_seconds, playback_rate)
    -- are added via migrations in database.py.
);

CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- sponsor_segments: SponsorBlock data per video
CREATE TABLE IF NOT EXISTS sponsor_segments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id      TEXT NOT NULL,                    -- yt video_id
    segment_uuid  TEXT NOT NULL UNIQUE,
    category      TEXT NOT NULL,                    -- sponsor|selfpromo|intro|outro|interaction|music_offtopic
    start_seconds REAL NOT NULL,
    end_seconds   REAL NOT NULL,
    fetched_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- settings: global key/value store, edited from UI
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- FTS5 search over title + description
CREATE VIRTUAL TABLE IF NOT EXISTS videos_fts USING fts5(
    title, description,
    content='videos', content_rowid='id'
);
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

CREATE INDEX IF NOT EXISTS idx_videos_channel       ON videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_videos_status        ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_upload_date   ON videos(upload_date DESC);
CREATE INDEX IF NOT EXISTS idx_videos_added_at      ON videos(added_at DESC);
CREATE INDEX IF NOT EXISTS idx_sponsor_segments_vid ON sponsor_segments(video_id);
