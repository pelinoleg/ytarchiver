export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Date label for a video.
 *  Today  → ``HH:MM`` (prefer real publish timestamp, fall back to download time)
 *  Other  → "Yesterday" / "3 days ago" / "Mar 12, 2024" etc. */
export function formatUploadDate(
  yyyymmdd: string | null | undefined,
  downloadedAt?: string | null,
  uploadTimestamp?: number | null,
): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return "";
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const dt = new Date(y, m - 1, d);
  const now = new Date();
  const days = Math.floor((now.getTime() - dt.getTime()) / 86_400_000);
  if (days < 0) return dt.toLocaleDateString();
  if (days === 0) return formatTodayTime(uploadTimestamp, downloadedAt);
  if (days === 1) return "Yesterday";
  if (days < 7)  return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function formatTodayTime(
  uploadTimestamp: number | null | undefined,
  downloadedAt: string | null | undefined,
): string {
  // Prefer the real upload timestamp from yt-dlp's info.json.
  if (uploadTimestamp) {
    const dt = new Date(uploadTimestamp * 1000);
    if (!isNaN(dt.getTime())) {
      return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  }
  // Fall back to when we downloaded it.
  if (downloadedAt) {
    const normalized = downloadedAt.includes("T") ? downloadedAt : downloadedAt.replace(" ", "T");
    const stamp = new Date(normalized + (normalized.endsWith("Z") ? "" : "Z"));
    if (!isNaN(stamp.getTime())) {
      return stamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  }
  return "Today";
}

/** YouTube watch URL for a video id. */
export function youtubeVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Public YouTube channel URL — strips our ``/videos`` tab suffix. */
export function youtubeChannelUrl(channelUrl: string | null | undefined): string | null {
  if (!channelUrl) return null;
  return channelUrl.replace(/\/videos\/?$/, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Deletion forecast for a video.

export type DeletionForecast =
  | { kind: "never"; reason: "pinned" | "favorite" | "playlist" | "music" | "no-rules" }
  | { kind: "scheduled"; deleteAt: Date; daysLeft: number }
  | { kind: "imminent"; reason: "watched" | "retention-overdue"; watchedPct?: number }
  | { kind: "watched-only"; thresholdPct: number };

export function deletionForecast(
  video: {
    keep_forever: boolean;
    is_favorite: boolean;
    is_music?: boolean;
    is_music_via_playlist?: boolean;
    kept_by_playlist?: boolean;
    downloaded_at: string | null;
    duration: number | null;
    last_position_seconds: number | null;
  },
  channelRetentionDays: number | null | undefined,    // per-channel override; null = inherit
  globals: {
    default_retention_days: number;
    delete_after_watched_percent: number;
  } | undefined,
): DeletionForecast {
  if (video.keep_forever)                                          return { kind: "never", reason: "pinned" };
  if (video.is_favorite)                                           return { kind: "never", reason: "favorite" };
  if (video.is_music || video.is_music_via_playlist)               return { kind: "never", reason: "music" };
  if (video.kept_by_playlist)                                      return { kind: "never", reason: "playlist" };

  const watchedThreshold = globals?.delete_after_watched_percent ?? 0;
  if (watchedThreshold > 0 && video.duration && video.last_position_seconds) {
    const pct = (video.last_position_seconds / video.duration) * 100;
    if (pct >= watchedThreshold) {
      return { kind: "imminent", reason: "watched", watchedPct: Math.round(pct) };
    }
  }

  const retention =
    channelRetentionDays != null
      ? channelRetentionDays
      : (globals?.default_retention_days ?? 0);

  if (retention === 0) {
    if (watchedThreshold > 0) return { kind: "watched-only", thresholdPct: watchedThreshold };
    return { kind: "never", reason: "no-rules" };
  }

  const dt = parseBackendTime(video.downloaded_at ?? null);
  if (!dt) return { kind: "never", reason: "no-rules" };
  const deleteAt = new Date(dt.getTime() + retention * 86_400_000);
  const msLeft = deleteAt.getTime() - Date.now();
  if (msLeft <= 0) return { kind: "imminent", reason: "retention-overdue" };
  return {
    kind: "scheduled",
    deleteAt,
    daysLeft: Math.ceil(msLeft / 86_400_000),
  };
}

/** Russian label for a deletion forecast. */
export function describeDeletion(f: DeletionForecast): string {
  switch (f.kind) {
    case "never":
      return f.reason === "pinned"   ? "Хранится без срока (закреплено 📌)"
           : f.reason === "favorite" ? "Хранится без срока (★ избранное)"
           : f.reason === "music"    ? "Хранится без срока (Music — не удаляется автоматически)"
           : f.reason === "playlist" ? "Хранится без срока (плейлист с keep-forever)"
           : "Хранится без срока (правила удаления отключены)";
    case "scheduled": {
      const d = f.deleteAt.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
      if (f.daysLeft <= 1) return `Удалится завтра · ${d}`;
      return `Удалится через ${f.daysLeft} ${pluralDays(f.daysLeft)} · ${d}`;
    }
    case "imminent":
      return f.reason === "watched"
        ? `Удалится при ближайшей чистке — просмотрено ${f.watchedPct}%`
        : "Удалится при ближайшей чистке — retention истёк";
    case "watched-only":
      return `Удалится, когда просмотришь ≥${f.thresholdPct}%`;
  }
}

export type DeletionTone = "neutral" | "soon" | "imminent" | "kept";

export function deletionTone(f: DeletionForecast): DeletionTone {
  if (f.kind === "never") return "kept";
  if (f.kind === "imminent") return "imminent";
  if (f.kind === "scheduled" && f.daysLeft <= 7) return "soon";
  return "neutral";
}

function pluralDays(n: number): string {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return "день";
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return "дня";
  return "дней";
}

/** "Fresh" = downloaded within the last 24h and never watched. */
export function isFreshUnwatched(video: {
  downloaded_at?: string | null;
  last_watched_at?: string | null;
}): boolean {
  if (video.last_watched_at) return false;
  if (!video.downloaded_at) return false;
  const raw = video.downloaded_at;
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const dt = new Date(normalized + (normalized.endsWith("Z") ? "" : "Z"));
  if (isNaN(dt.getTime())) return false;
  return Date.now() - dt.getTime() < 24 * 60 * 60 * 1000;
}

/** Parse the backend's naive-UTC ISO/date string into a Date. */
function parseBackendTime(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const dt = new Date(normalized + (normalized.endsWith("Z") ? "" : "Z"));
  return isNaN(dt.getTime()) ? null : dt;
}

/** "in 2h" / "in 18 min" / "any moment now" / "overdue". */
export function timeUntil(target: Date | null): string {
  if (!target) return "—";
  const diff = (target.getTime() - Date.now()) / 1000;
  if (diff < 30) return "any moment";
  if (diff < 0)  return "overdue";
  if (diff < 60)         return `in ${Math.floor(diff)}s`;
  if (diff < 3600)       return `in ${Math.floor(diff / 60)} min`;
  if (diff < 86400)      return `in ${Math.floor(diff / 3600)}h`;
  return `in ${Math.floor(diff / 86400)}d`;
}

/** Compute the next-sync moment for a channel given its effective interval. */
export function nextSyncAt(
  lastSynced: string | null | undefined,
  effectiveIntervalMin: number,
): Date | null {
  const last = parseBackendTime(lastSynced);
  if (!last) return null;
  return new Date(last.getTime() + effectiveIntervalMin * 60_000);
}

/** "2h ago" style. Treats input as naive UTC ('YYYY-MM-DD HH:MM:SS' or ISO). */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const dt = new Date(normalized + (normalized.endsWith("Z") ? "" : "Z"));
  const diff = Math.max(0, (Date.now() - dt.getTime()) / 1000);
  if (diff < 60)         return `${Math.floor(diff)}s ago`;
  if (diff < 3600)       return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)      return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return dt.toLocaleDateString();
}

function fmtDateStr(yyyymmdd: string): string {
  if (!yyyymmdd || yyyymmdd.length !== 8) return yyyymmdd;
  return `${yyyymmdd.slice(0,4)}-${yyyymmdd.slice(4,6)}-${yyyymmdd.slice(6,8)}`;
}

/** Human-readable policy label.
 *  Honors legacy channels (NULL download_policy) by falling back to whatever
 *  data we have (latest_count → "Latest N", or download_from_date → "Custom").
 */
export function describePolicy(
  policy: string | null | undefined,
  latestCount: number | null | undefined,
  downloadFromDate?: string | null,
): string {
  switch (policy) {
    case "new-only": return "Only new uploads";
    case "last-7":   return "Last 7 days";
    case "last-30":  return "Last 30 days";
    case "last-90":  return "Last 90 days";
    case "last-365": return "Last year";
    case "all":      return "Everything from the channel";
    case "latest":   return `Latest ${latestCount ?? "?"} videos`;
  }
  // Policy is null/unknown — try to describe from data.
  if (latestCount) return `Latest ${latestCount} videos (legacy)`;
  if (downloadFromDate) return `Custom — from ${fmtDateStr(downloadFromDate)} (legacy)`;
  if (downloadFromDate === null) return "Custom — no cutoff (legacy)";
  return "Not set";
}

const QUALITY_LABEL = (q: string | null | undefined) =>
  !q ? null : q === "best" ? "Best available" : `${q}p`;

/** Human-readable retention. ``globalDays`` makes "Inherit global (60 days)". */
export function describeRetention(
  days: number | null | undefined,
  globalDays?: number,
): string {
  if (days == null) {
    if (globalDays == null) return "Inherit global";
    return `Inherit global (${globalDays === 0 ? "keep forever" : `${globalDays}d`})`;
  }
  if (days === 0) return "Keep forever";
  if (days === 1) return "1 day";
  return `${days} days`;
}

/** Human-readable quality. ``globalQ`` makes "Inherit global (1080p)". */
export function describeQuality(
  q: string | null | undefined,
  globalQ?: string | null,
): string {
  const local = QUALITY_LABEL(q);
  if (local) return local;
  const g = QUALITY_LABEL(globalQ);
  return g ? `Inherit global (${g})` : "Inherit global";
}

/** Human-readable sync interval (minutes). */
export function describeInterval(
  minutes: number | null | undefined,
  globalMin?: number,
): string {
  if (minutes == null) {
    return globalMin == null
      ? "Inherit global"
      : `Inherit global (${formatMinutes(globalMin)})`;
  }
  return formatMinutes(minutes);
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return min ? `${h}h ${min}m` : `${h}h`;
}

/** Human-readable file size.
 *  Default: keeps one decimal for small values (e.g. ``1.4 GB``).
 *  ``compact=true``: always rounded to integer (``1 GB``, ``540 MB``) — for
 *  tight UI badges where decimals are visual noise. */
export function formatBytes(n: number | null | undefined, compact = false): string {
  if (n == null || n <= 0) return "0 B";
  const kb = n / 1024;
  if (kb < 1)    return `${n} B`;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) {
    if (compact || mb >= 10) return `${Math.round(mb)} MB`;
    return `${mb.toFixed(1)} MB`;
  }
  const gb = mb / 1024;
  if (gb < 1024) {
    if (compact) return `${Math.round(gb)} GB`;
    if (gb < 10) return `${gb.toFixed(2)} GB`;
    return `${gb.toFixed(1)} GB`;
  }
  return compact ? `${Math.round(gb / 1024)} TB` : `${(gb / 1024).toFixed(2)} TB`;
}

export function formatCount(n: number | null | undefined): string {
  if (n == null) return "";
  if (n < 1000)    return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}
