import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  CheckCircle2, XCircle, Trash2, Clock, Rss, Plus, RefreshCw,
  Wrench, Download, Inbox,
} from "lucide-react";
import { eventsApi, thumbUrl, type EventRow } from "../lib/api";
import { Tv } from "lucide-react";
import { formatDuration } from "../lib/format";

const FILTER_GROUPS: { label: string; types: string[] }[] = [
  { label: "All",          types: [] },
  { label: "Downloads",    types: ["download_done", "download_failed", "manual_download_queued"] },
  { label: "Deletions",    types: ["video_deleted_manual", "video_deleted_retention", "video_deleted_watched"] },
  { label: "Channels",     types: ["channel_subscribed", "channel_unsubscribed", "channel_synced"] },
  { label: "System",       types: ["ytdlp_updated", "ytdlp_update_failed"] },
];

export function EventsPage() {
  const [groupLabel, setGroupLabel] = useState("All");
  const group = FILTER_GROUPS.find((g) => g.label === groupLabel) ?? FILTER_GROUPS[0];

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["events"],
    queryFn: () => eventsApi.list({ limit: 300 }),
    refetchInterval: 10_000,
  });

  const filtered = group.types.length
    ? events.filter((e) => group.types.includes(e.type))
    : events;

  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Activity</h1>
      <p className="mb-4 text-sm text-zinc-400">
        Significant events: downloads, deletions, channel subscriptions, system tasks.
        Newest on top.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTER_GROUPS.map((g) => (
          <button
            key={g.label}
            onClick={() => setGroupLabel(g.label)}
            className={`rounded-full px-3 py-1 text-sm ${
              g.label === groupLabel
                ? "bg-zinc-100 text-zinc-950 font-medium"
                : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Inbox className="h-12 w-12 text-zinc-700" />
          <h3 className="mt-4 text-lg font-semibold">Nothing yet</h3>
          <p className="mt-1 text-sm text-zinc-400">
            Events appear here as the app downloads, cleans up, and syncs channels.
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-zinc-900 divide-y divide-zinc-800">
          {filtered.map((e) => <EventRowItem key={e.id} e={e} />)}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function EventRowItem({ e }: { e: EventRow }) {
  const { Icon, color, title } = describeEvent(e.type);

  const body = (
    <>
      <Icon className={`h-5 w-5 flex-shrink-0 mt-0.5 ${color}`} />
      <EventArtwork e={e} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-zinc-500">{timeAgo(e.created_at)}</span>
        </div>
        <div className="mt-0.5 truncate text-sm text-zinc-300">
          {e.video_title ?? e.channel_name ?? e.message ?? "—"}
        </div>
        {((e.video_title && e.channel_name) || e.message) && (
          <div className="mt-0.5 truncate text-xs text-zinc-500">
            {[e.video_title ? e.channel_name : null, e.message].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
    </>
  );

  const linkTo =
    // Only link to /watch when the video is still around — events about
    // deleted videos shouldn't dead-end the user.
    (e.video_id && e.video_status && e.video_status !== "deleted") ? `/watch/${e.video_id}` :
    e.channel_id ? `/channel/${e.channel_id}` :
    null;

  if (linkTo) {
    return (
      <Link to={linkTo} className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-800/50">
        {body}
      </Link>
    );
  }
  return <div className="flex items-start gap-3 px-4 py-3">{body}</div>;
}

/** Inline artwork next to the event icon.
 *  - Video event with a known thumbnail → 16:9 mini-thumb + duration badge.
 *  - Channel-only event → circular channel avatar.
 *  - Neither → nothing (icon does the lifting).
 *
 *  Thumbs come from the joined ``video_thumbnail_*`` / ``channel_thumbnail_url``
 *  columns the backend started returning for events. */
function EventArtwork({ e }: { e: EventRow }) {
  // Prefer the locally-stored thumbnail when the video file is still here.
  const vThumb =
    e.video_id && e.video_thumbnail_path
      ? thumbUrl(e.video_id)
      : e.video_thumbnail_url ?? null;

  if (vThumb) {
    return (
      <div className="relative aspect-video w-20 sm:w-24 flex-shrink-0 overflow-hidden rounded-md bg-zinc-800">
        <img
          src={vThumb}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          className={`h-full w-full object-cover ${
            e.video_status === "deleted" ? "opacity-40 grayscale" : ""
          }`}
        />
        {e.video_duration ? (
          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/85 px-1 text-[9px] font-medium text-zinc-100">
            {formatDuration(e.video_duration)}
          </span>
        ) : null}
      </div>
    );
  }

  // Channel-only event (subscribed / synced / unsubscribed).
  if (e.channel_id) {
    if (e.channel_thumbnail_url) {
      return (
        <img
          src={e.channel_thumbnail_url}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          className="h-10 w-10 flex-shrink-0 rounded-full object-cover bg-zinc-800"
        />
      );
    }
    return (
      <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-zinc-800">
        <Tv className="h-4 w-4 text-zinc-500" />
      </div>
    );
  }

  return null;
}

function describeEvent(type: string) {
  switch (type) {
    case "download_done":            return { Icon: CheckCircle2, color: "text-emerald-400", title: "Download complete" };
    case "download_failed":          return { Icon: XCircle,      color: "text-red-400",     title: "Download failed" };
    case "manual_download_queued":   return { Icon: Download,     color: "text-blue-400",    title: "Manual download queued" };
    case "video_deleted_manual":     return { Icon: Trash2,       color: "text-red-400",     title: "Deleted by you" };
    case "video_deleted_retention":  return { Icon: Clock,        color: "text-amber-400",   title: "Removed by retention" };
    case "video_deleted_watched":    return { Icon: Clock,        color: "text-amber-400",   title: "Removed after watching" };
    case "channel_subscribed":       return { Icon: Plus,         color: "text-emerald-400", title: "Channel subscribed" };
    case "channel_unsubscribed":     return { Icon: Trash2,       color: "text-red-400",     title: "Channel unsubscribed" };
    case "channel_synced":           return { Icon: RefreshCw,    color: "text-blue-400",    title: "Channel synced" };
    case "ytdlp_updated":            return { Icon: Wrench,       color: "text-emerald-400", title: "yt-dlp updated" };
    case "ytdlp_update_failed":      return { Icon: Wrench,       color: "text-red-400",     title: "yt-dlp update failed" };
    default:                         return { Icon: Rss,          color: "text-zinc-400",    title: type };
  }
}

function timeAgo(iso: string): string {
  const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
  const dt = new Date(normalized + "Z");
  const diff = Math.max(0, (Date.now() - dt.getTime()) / 1000);
  if (diff < 60)        return `${Math.floor(diff)}s ago`;
  if (diff < 3600)      return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)     return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return dt.toLocaleDateString();
}
