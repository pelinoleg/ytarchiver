export type DownloadPolicy =
  | "new-only" | "last-7" | "last-30" | "last-90" | "last-365" | "all" | "latest";
export type Quality = "1080" | "720" | "480" | "360" | "best";
export type VideoStatus =
  | "pending" | "queued" | "downloading" | "done" | "error" | "skipped" | "deleted";

export interface Channel {
  id: number;
  url: string;
  yt_channel_id: string | null;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  subscriber_count: number | null;
  quality: string | null;
  retention_days: number | null;
  sync_interval_minutes: number | null;
  show_on_home: boolean;
  folder_id: number | null;
  latest_count: number | null;
  download_policy: string | null;
  download_from_date: string | null;
  last_synced: string | null;
  last_sync_added_count: number | null;
  last_sync_error: string | null;
  video_count: number;
  recent_count: number;
  created_at: string | null;
}

export interface Chapter { start: number; end: number | null; title: string }

export interface Video {
  id: number;
  video_id: string;
  channel_id: number;
  channel_name: string | null;
  channel_thumbnail: string | null;
  title: string;
  description: string | null;
  duration: number | null;
  upload_date: string | null;
  upload_timestamp: number | null;
  thumbnail_url: string | null;
  thumbnail_path: string | null;
  file_path: string | null;
  quality: string | null;
  /** Pixel width of the downloaded stream. Pairs with ``quality`` (height)
   *  to give the player an exact aspect ratio before <video> loads. */
  width: number | null;
  status: VideoStatus;
  progress: string | null;
  error_message: string | null;
  file_size_bytes: number | null;
  chapters: Chapter[] | null;
  has_subtitle: boolean;
  has_preview:  boolean;
  added_at: string | null;
  downloaded_at: string | null;
  last_watched_at: string | null;
  last_position_seconds: number | null;
  keep_forever: boolean;
  is_favorite:  boolean;
  is_music:     boolean;
  /** True when this video belongs to at least one playlist with keep-forever. */
  kept_by_playlist?: boolean;
  /** True when the video is music only because it's in a music playlist. */
  is_music_via_playlist?: boolean;
  // Transient: live download telemetry, populated from the WS hook only.
  // Not part of the server response shape.
  downloaded_bytes?: number;
  total_bytes?: number;
  speed?: string;
  eta?: string;
}

export const streamUrl    = (videoId: string, height?: number | null) =>
  height ? `/api/stream/${videoId}?height=${height}` : `/api/stream/${videoId}`;
export const thumbUrl     = (videoId: string) => `/api/stream/thumbnail/${videoId}`;
export const subtitleUrl  = (videoId: string) => `/api/stream/subtitle/${videoId}`;
export const previewUrl   = (videoId: string) => `/api/stream/preview/${videoId}`;

export interface GlobalSettings {
  default_quality: Quality;
  default_retention_days: number;
  default_playback_rate: number;
  music_playback_rate: number;
  delete_after_watched_percent: number;
  sync_interval_minutes: number;
  sync_jitter_minutes: number;
  initial_backfill_hard_cap: number;
  max_videos_per_channel_scan: number;
  between_downloads_min_seconds: number;
  between_downloads_max_seconds: number;
  max_concurrent_downloads: number;
  preview_width: number;
  preview_crf: number;
  preview_segments: number;
  music_queue_panel_size: number;
  mini_player_enabled: boolean;
  sponsorblock_refresh_days: number;
  sponsorblock_categories: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(`${res.status}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface ChannelFolder {
  id: number;
  name: string;
  position: number;
  created_at: string | null;
}

export const channelFoldersApi = {
  list:   () => request<ChannelFolder[]>("/api/channel-folders"),
  create: (name: string, position = 0) =>
    request<ChannelFolder>("/api/channel-folders",
      { method: "POST", body: JSON.stringify({ name, position }) }),
  update: (id: number, body: { name?: string; position?: number }) =>
    request<ChannelFolder>(`/api/channel-folders/${id}`,
      { method: "PATCH", body: JSON.stringify(body) }),
  delete: (id: number) =>
    request<void>(`/api/channel-folders/${id}`, { method: "DELETE" }),
};

export const channelsApi = {
  list: () => request<Channel[]>("/api/channels"),
  subscribe: (body: {
    url: string;
    download_policy: DownloadPolicy;
    quality?: Quality | null;
    retention_days?: number | null;
    sync_interval_minutes?: number | null;
    show_on_home?: boolean;
    folder_id?: number | null;
    latest_count?: number | null;
  }) => request<Channel>("/api/channels", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, body: {
    quality?: Quality | null;
    retention_days?: number | null;
    sync_interval_minutes?: number | null;
    show_on_home?: boolean;
    folder_id?: number | null;
    latest_count?: number | null;
    download_policy?: DownloadPolicy;
  }) => request<Channel>(`/api/channels/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  unsubscribe: (id: number) => request<void>(`/api/channels/${id}`, { method: "DELETE" }),
  sync:     (id: number) => request<{ status: string; added: number }>(`/api/channels/${id}/sync`, { method: "POST" }),
  backfill: (id: number) => request<{ status: string }>(`/api/channels/${id}/backfill`, { method: "POST" }),
  rebuild:  (id: number) => request<{ status: string }>(`/api/channels/${id}/rebuild`,  { method: "POST" }),
};

export const videosApi = {
  list: (params: { channel_id?: number; folder_id?: number; status?: string; search?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, String(v));
    const qs = q.toString();
    return request<Video[]>(`/api/videos${qs ? `?${qs}` : ""}`);
  },
  get:    (videoId: string) => request<Video>(`/api/videos/${videoId}`),
  delete: (videoPk: number) => request<void>(`/api/videos/${videoPk}`, { method: "DELETE" }),
  update: (videoId: string, body: {
    keep_forever?: boolean;
    is_favorite?: boolean;
    is_music?: boolean;
    quality?: Quality;
  }) =>
    request<Video>(`/api/videos/${videoId}`, { method: "PATCH", body: JSON.stringify(body) }),
  related: (videoId: string, limit = 12) =>
    request<Video[]>(`/api/videos/${videoId}/related?limit=${limit}`),
  manualDownload: (url: string, quality?: Quality | null, is_music?: boolean) =>
    request<Video>(`/api/videos/download`, {
      method: "POST",
      body: JSON.stringify({ url, ...(quality ? { quality } : {}), ...(is_music ? { is_music: true } : {}) }),
    }),
  bulkDelete: (ids: number[]) =>
    request<{ deleted: number }>(`/api/videos/bulk/delete`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  bulkPatch: (
    video_ids: string[],
    patch: { keep_forever?: boolean; is_favorite?: boolean; is_music?: boolean },
  ) =>
    request<{ updated: number }>(`/api/videos/bulk/patch`, {
      method: "POST",
      body: JSON.stringify({ video_ids, patch }),
    }),
  updatePlayback: (
    videoId: string,
    body: { rate?: number; position?: number; mark_watched?: boolean },
  ) => request<Video>(`/api/videos/${videoId}/playback`, {
    method: "POST", body: JSON.stringify(body),
  }),
  redownload: (videoId: string) =>
    request<Video>(`/api/videos/${videoId}/redownload`, { method: "POST" }),
};

export const historyApi = {
  list:             (limit = 200) => request<Video[]>(`/api/history?limit=${limit}`),
  continueWatching: (limit = 20)  => request<Video[]>(`/api/history/continue?limit=${limit}`),
};

export const manualApi = {
  list:  (limit = 120) => request<Video[]>(`/api/manual?limit=${limit}`),
  count: () => request<{ count: number }>(`/api/manual/count`),
};

export interface Playlist {
  id: number;
  url: string;
  yt_playlist_id: string | null;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  uploader: string | null;
  video_count: number;
  item_count: number;
  done_count: number;
  quality: string | null;
  retention_days: number | null;
  keep_videos_forever: boolean;
  is_music: boolean;
  last_synced: string | null;
  last_sync_added_count: number | null;
  last_sync_error: string | null;
  created_at: string | null;
}

export const playlistsApi = {
  list:        () => request<Playlist[]>("/api/playlists"),
  get:         (id: number) => request<Playlist>(`/api/playlists/${id}`),
  subscribe:   (body: { url: string; quality?: Quality | null; retention_days?: number | null; is_music?: boolean }) =>
    request<Playlist>("/api/playlists", { method: "POST", body: JSON.stringify(body) }),
  subscribeSearch: (body: { query: string; count: number; quality?: Quality | null; retention_days?: number | null; is_music?: boolean }) =>
    request<Playlist>("/api/playlists/search", { method: "POST", body: JSON.stringify(body) }),
  update:      (id: number, body: {
    quality?: Quality | null;
    retention_days?: number | null;
    keep_videos_forever?: boolean;
    is_music?: boolean;
  }) => request<Playlist>(`/api/playlists/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  unsubscribe: (id: number) => request<void>(`/api/playlists/${id}`, { method: "DELETE" }),
  videos:      (id: number) => request<Video[]>(`/api/playlists/${id}/videos`),
  sync:        (id: number) => request<Playlist>(`/api/playlists/${id}/sync`, { method: "POST" }),
};

export const favoritesApi = {
  list:  (limit = 120) => request<Video[]>(`/api/favorites?limit=${limit}`),
  count: () => request<{ count: number }>(`/api/favorites/count`),
};

export interface EventRow {
  id: number;
  type: string;
  message: string | null;
  video_id: string | null;
  video_title: string | null;
  channel_id: number | null;
  channel_name: string | null;
  created_at: string;
  // Joined artwork — present when the referenced video / channel still
  // exists in the DB. Used by the Activity row to render thumbnails.
  video_thumbnail_url?:  string | null;
  video_thumbnail_path?: string | null;
  video_duration?:       number | null;
  video_status?:         string | null;
  channel_thumbnail_url?: string | null;
}

export interface AppStats {
  channels: number;
  videos: number;
  total_bytes: number;
}

export const statsApi = {
  get: () => request<AppStats>("/api/stats"),
};

export interface IntegrityReport {
  checked: number;
  missing: number;
  ran_at:  string;
  missing_sample: { video_id: string; title: string; path: string }[];
}

export const maintenanceApi = {
  runCleanup:      () => request<{ deleted: number }>("/api/maintenance/cleanup", { method: "POST" }),
  runIntegrity:    () => request<IntegrityReport>("/api/maintenance/integrity", { method: "POST" }),
  integrityStatus: () => request<{ ran_at: string | null; checked: number; missing: number }>("/api/maintenance/integrity/status"),
};

export interface StorageSummary {
  videos: number;
  total_bytes: number;
  avg_bytes: number;
  max_bytes: number;
}

export interface ChannelStorage {
  id: number;
  name: string;
  thumbnail_url: string | null;
  video_count: number;
  total_bytes: number;
}

export interface SubtitleHit {
  video:         Video;
  start_seconds: number;
  snippet:       string;
}

export const searchApi = {
  subtitles: (q: string, limit = 30) =>
    request<SubtitleHit[]>(`/api/search/subtitles?q=${encodeURIComponent(q)}&limit=${limit}`),
};

export interface StorageGrowthWeek {
  week_start: string;
  videos:     number;
  bytes:      number;
}

export interface StorageResolutionBucket {
  bucket: string;
  videos: number;
  bytes:  number;
}

export interface StorageCleanupStats {
  days: number;
  by_type: { type: string; n: number }[];
}

export const storageApi = {
  summary:         ()                                  => request<StorageSummary>(`/api/storage/summary`),
  largestVideos:   (limit = 30)                         => request<Video[]>(`/api/storage/largest-videos?limit=${limit}`),
  largestChannels: (limit = 15)                         => request<ChannelStorage[]>(`/api/storage/largest-channels?limit=${limit}`),
  oldWatched:      (minDays = 30, limit = 50)           => request<Video[]>(`/api/storage/old-watched?min_days=${minDays}&limit=${limit}`),
  growth:          (weeks = 12)                         => request<{ weeks: StorageGrowthWeek[] }>(`/api/storage/growth?weeks=${weeks}`),
  resolutions:     ()                                   => request<{ buckets: StorageResolutionBucket[] }>(`/api/storage/resolution-breakdown`),
  cleanupStats:    (days = 30)                          => request<StorageCleanupStats>(`/api/storage/cleanup-stats?days=${days}`),
  nonH264Count:    ()                                   => request<{ count: number; bytes: number }>(`/api/storage/non-h264-count`),
  redownloadNonH264: ()                                 => request<{ queued: number }>(`/api/storage/redownload-non-h264`, { method: "POST" }),
  orphans:         ()                                   => request<Video[]>(`/api/storage/orphans`),
  purgeOrphans:    ()                                   => request<{ cancelled: number; purged: number }>(`/api/storage/purge-orphans`, { method: "POST" }),
};

export const eventsApi = {
  list:  (params: { type?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.type)  q.set("type", params.type);
    if (params.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<EventRow[]>(`/api/events${qs ? `?${qs}` : ""}`);
  },
  types: () => request<{ types: string[] }>(`/api/events/types`),
};

export interface MusicStats {
  tracks: number;
  playlists: number;
  favorites: number;
  total_bytes: number;
}

export interface MusicPlaylistSize {
  id: number;
  title: string;
  thumbnail_url: string | null;
  tracks: number;
  bytes: number;
}

export interface MusicStorage {
  tracks: number;
  total_bytes: number;
  playlists: MusicPlaylistSize[];
  largest: Video[];
}

export const musicApi = {
  // Default high — virtualization in the UI keeps the DOM cost flat, so we
  // can pull a big batch up front instead of paginating.
  tracks:    (limit = 5000) => request<Video[]>(`/api/music/tracks?limit=${limit}`),
  trackIds:  () => request<{ video_ids: string[] }>(`/api/music/track-ids`),
  playlists: () => request<Playlist[]>(`/api/music/playlists`),
  stats:     () => request<MusicStats>(`/api/music/stats`),
  storage:   () => request<MusicStorage>(`/api/music/storage`),
};

export const settingsApi = {
  get: () => request<GlobalSettings>("/api/settings"),
  update: (body: Partial<GlobalSettings>) =>
    request<GlobalSettings>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
};

export interface ImportReport {
  folders_added?: number;
  folders_skipped?: number;
  channels_added: number;
  channels_skipped: number;
  playlists_added: number;
  playlists_skipped: number;
  settings_applied: number;
  errors: string[];
}

export interface ChannelPreview {
  kind: "channel";
  url:  string;
  name: string | null;
  thumbnail_url: string | null;
  subscriber_count: number | null;
}
export interface PlaylistPreview {
  kind: "playlist";
  url:  string;
  title: string | null;
  thumbnail_url: string | null;
  uploader: string | null;
  video_count: number | null;
}

export const backupApi = {
  exportUrl:  () => `/api/backup/export`,
  exportJson: () => request<{
    version: number;
    exported_at: string;
    folders?: Array<Record<string, unknown>>;
    channels: Array<Record<string, unknown>>;
    playlists: Array<Record<string, unknown>>;
    settings: Record<string, unknown>;
  }>(`/api/backup/export`),
  importJson: (payload: unknown) =>
    request<ImportReport>("/api/backup/import", { method: "POST", body: JSON.stringify(payload) }),
  previewChannel:  (url: string) => request<ChannelPreview>(`/api/backup/preview`,
    { method: "POST", body: JSON.stringify({ url, kind: "channel" }) }),
  previewPlaylist: (url: string) => request<PlaylistPreview>(`/api/backup/preview`,
    { method: "POST", body: JSON.stringify({ url, kind: "playlist" }) }),
};

export interface QueueStatus {
  paused: boolean;
  pending: number;
  downloading: number;
  error: number;
  max_concurrent: number;
}

export const queueApi = {
  list:    () => request<Video[]>("/api/queue"),
  status:  () => request<QueueStatus>("/api/queue/status"),
  pause:   () => request<QueueStatus>("/api/queue/pause", { method: "POST" }),
  resume:  () => request<QueueStatus>("/api/queue/resume", { method: "POST" }),
  retry:   (videoId: string) => request<Video>(`/api/queue/${videoId}/retry`, { method: "POST" }),
};

export interface SponsorSegment {
  uuid: string;
  category: "sponsor" | "selfpromo" | "interaction" | "intro" | "outro" | "music_offtopic" | string;
  start: number;
  end: number;
}

export interface VideoVariant {
  id: number;
  video_id: string;
  height: number;
  file_path: string;
  file_size_bytes: number | null;
  status: "pending" | "downloading" | "done" | "error";
  error_message: string | null;
  created_at: string | null;
}

export const variantsApi = {
  list:   (videoId: string) => request<VideoVariant[]>(`/api/videos/${videoId}/variants`),
  create: (videoId: string, height: number) =>
    request<VideoVariant>(`/api/videos/${videoId}/variants`, {
      method: "POST", body: JSON.stringify({ height }),
    }),
  delete: (variantId: number) =>
    request<void>(`/api/variants/${variantId}`, { method: "DELETE" }),
};

export const segmentsApi = {
  list:    (videoId: string) => request<SponsorSegment[]>(`/api/videos/${videoId}/segments`),
  refresh: (videoId: string) =>
    request<{ video_id: string; count: number }>(`/api/videos/${videoId}/segments/refresh`, { method: "POST" }),
};
