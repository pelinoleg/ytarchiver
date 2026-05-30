import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Tv, History as HistoryIcon, ChevronDown, ChevronUp } from "lucide-react";
import { channelsApi, historyApi, videosApi, thumbUrl, type Channel, type Video } from "../lib/api";
import { VideoGrid } from "../components/VideoGrid";
import { VideoCard } from "../components/VideoCard";
import { formatDuration, isRecent } from "../lib/format";
import { WatchProgress } from "../components/WatchProgress";
import { useLocalStorageString } from "../hooks/useLocalStorageString";
import { useLocalStorageBool } from "../hooks/useLocalStorageBool";
import { HOME_VIEW_KEY, HOME_VIEW_MODES, type HomeViewMode } from "../components/HomeViewToggle";

export function HomePage() {
  // Source of truth lives in localStorage; the TopBar toggle writes the same
  // key and our hook listens via custom-event so both stay in sync.
  const [mode] = useLocalStorageString<HomeViewMode>(HOME_VIEW_KEY, "flat", HOME_VIEW_MODES);

  const { data: videos = [], isLoading } = useQuery({
    queryKey: ["videos"],
    // Pull a big batch up front — the grid virtualizes past ~200 cards so
    // there's no DOM cost from a bigger list.
    queryFn: () => videosApi.list({ limit: 2000 }),
  });

  // We use channels for avatars + display names in the by-channel view.
  const { data: channels = [] } = useQuery({
    queryKey: ["channels"],
    queryFn: channelsApi.list,
  });

  const { data: continueWatching = [] } = useQuery({
    queryKey: ["history", "continue"],
    queryFn: () => historyApi.continueWatching(8),
    staleTime: 10_000,
  });

  return (
    <>
      {/* A11y anchor — the page is otherwise all thumbnails with no visible
          title (content-first, by design). Screen readers still get a landmark. */}
      <h1 className="sr-only">Home — your video archive</h1>
      <ContinueWatching videos={continueWatching} />
      {mode === "flat" ? (
        <VideoGrid
          videos={videos}
          isLoading={isLoading}
          emptyTitle="No videos yet"
          emptyHint="Subscribe to a channel and new uploads land here automatically. You can also add a single video or a playlist from the + menu."
        />
      ) : isLoading ? (
        <VideoGrid videos={[]} isLoading emptyTitle="" emptyHint="" />
      ) : mode === "date" ? (
        <ByDate videos={videos} />
      ) : (
        <ByChannel videos={videos} channels={channels} />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Continue Watching — videos in-progress between 5%–95%, capped at 8. Wrapped
// in a subtle card so it visually separates from the main grid below.

function ContinueWatching({ videos }: { videos: Video[] }) {
  // Per-viewport preference — desktop and mobile independently, both
  // persisted in localStorage so the choice survives reloads.
  const [openMobile,  setOpenMobile]  = useLocalStorageBool("home.continue.open.mobile",  false);
  const [openDesktop, setOpenDesktop] = useLocalStorageBool("home.continue.open.desktop", true);

  if (videos.length === 0) return null;

  return (
    <section className="mb-12 overflow-hidden rounded-2xl bg-zinc-900/40 ring-1 ring-zinc-800/60">
      {/* Desktop header — accent-coloured, click toggles desktop state. */}
      <button
        type="button"
        onClick={() => setOpenDesktop(!openDesktop)}
        className="hidden sm:flex w-full items-center gap-2.5 px-5 py-3 text-left hover:bg-zinc-900/40 transition-colors"
        aria-expanded={openDesktop}
      >
        <div className="grid h-7 w-7 place-items-center rounded-full bg-sky-500/15 ring-1 ring-sky-500/30">
          <HistoryIcon className="h-4 w-4 text-sky-300" />
        </div>
        <h2 className="text-base font-semibold text-zinc-100">Continue watching</h2>
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400 tabular-nums">
          {videos.length}
        </span>
        <span className="ml-auto text-zinc-500">
          {openDesktop ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {/* Mobile header — same. */}
      <button
        type="button"
        onClick={() => setOpenMobile(!openMobile)}
        className="flex sm:hidden w-full items-center gap-2.5 px-3 py-2.5 text-left active:bg-zinc-900"
        aria-expanded={openMobile}
      >
        <div className="grid h-6 w-6 place-items-center rounded-full bg-sky-500/15 ring-1 ring-sky-500/30">
          <HistoryIcon className="h-3.5 w-3.5 text-sky-300" />
        </div>
        <h2 className="text-sm font-semibold text-zinc-100">Continue watching</h2>
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-400 tabular-nums">
          {videos.length}
        </span>
        <span className="ml-auto text-zinc-500">
          {openMobile ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {/* Horizontal carousel — single row, hidden scrollbar, snap-to-card.
          Wider thumbs on desktop, much smaller on phone so several fit on
          screen at once. */}
      <div className={`sm:hidden border-t border-zinc-800/60 ${openMobile  ? "block" : "hidden"}`}>
        <ContinueRow videos={videos} />
      </div>
      <div className={`hidden border-t border-zinc-800/60 ${openDesktop ? "sm:block" : "sm:hidden"}`}>
        <ContinueRow videos={videos} />
      </div>
    </section>
  );
}

function ContinueRow({ videos }: { videos: Video[] }) {
  return (
    <div className="overflow-x-auto scrollbar-hide">
      <div className="flex gap-3 sm:gap-4 snap-x snap-mandatory px-3 py-4 sm:px-5 sm:py-5">
        {videos.map((v) => (
          <Link
            key={v.id}
            to={`/watch/${v.video_id}`}
            className="group flex-shrink-0 snap-start w-36 sm:w-48 lg:w-56"
          >
            <MiniCardThumb video={v} />
            <h3 className="mt-2 line-clamp-2 text-[12px] sm:text-sm font-medium leading-snug text-zinc-100 break-words">
              {v.title}
            </h3>
            {v.channel_name && (
              <p className="mt-0.5 truncate text-[11px] text-zinc-500" title={v.channel_name}>{v.channel_name}</p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

function MiniCardThumb({ video }: { video: Video }) {
  const thumb = video.thumbnail_path ? thumbUrl(video.video_id) : video.thumbnail_url;
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-zinc-900">
      {thumb && (
        <img
          src={thumb}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
        />
      )}
      {video.duration && (
        <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1.5 py-0.5 text-[10px] font-medium text-zinc-100">
          {formatDuration(video.duration)}
        </span>
      )}
      <WatchProgress video={video} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// View: by date

const DATE_BUCKETS: { key: string; title: string; predicate: (days: number) => boolean }[] = [
  { key: "today",         title: "Today",            predicate: (d) => d <= 0 },
  { key: "yesterday",     title: "Yesterday",        predicate: (d) => d === 1 },
  { key: "this-week",     title: "Earlier this week", predicate: (d) => d > 1 && d < 7 },
  { key: "this-month",    title: "Earlier this month", predicate: (d) => d >= 7 && d < 30 },
  { key: "last-3-months", title: "Last 3 months",    predicate: (d) => d >= 30 && d < 90 },
  { key: "this-year",     title: "Last year",        predicate: (d) => d >= 90 && d < 365 },
  { key: "older",         title: "Older",            predicate: (d) => d >= 365 },
];

function daysSinceUpload(yyyymmdd: string | null | undefined): number | null {
  if (!yyyymmdd || yyyymmdd.length !== 8) return null;
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6)) - 1;
  const d = Number(yyyymmdd.slice(6, 8));
  const dt = new Date(y, m, d);
  if (isNaN(+dt)) return null;
  return Math.floor((Date.now() - dt.getTime()) / 86_400_000);
}

function ByDate({ videos }: { videos: Video[] }) {
  // Group by bucket
  const groups: Record<string, Video[]> = {};
  const unknown: Video[] = [];
  for (const v of videos) {
    const days = daysSinceUpload(v.upload_date);
    if (days == null) {
      unknown.push(v);
      continue;
    }
    const bucket = DATE_BUCKETS.find((b) => b.predicate(days));
    const key = bucket?.key ?? "older";
    (groups[key] ||= []).push(v);
  }

  const sections = DATE_BUCKETS
    .filter((b) => (groups[b.key]?.length ?? 0) > 0)
    .map((b) => ({ title: b.title, videos: groups[b.key] }));

  if (sections.length === 0 && unknown.length === 0) {
    return <EmptyHint />;
  }

  return (
    <div className="space-y-10">
      {sections.map((s) => (
        <DateSection key={s.title} title={s.title} videos={s.videos} />
      ))}
      {unknown.length > 0 && (
        <DateSection title="Unknown date" videos={unknown} />
      )}
    </div>
  );
}

function DateSection({ title, videos }: { title: string; videos: Video[] }) {
  return (
    <section>
      <SectionHeader title={title} count={videos.length} />
      <Grid videos={videos} />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// View: by channel

function ByChannel({ videos, channels }: { videos: Video[]; channels: Channel[] }) {
  // Group videos by channel_id
  const byCh: Record<number, Video[]> = {};
  for (const v of videos) {
    (byCh[v.channel_id] ||= []).push(v);
  }

  // Build display entries — prefer channel record (has nicer name + avatar),
  // fall back to data on the video row.
  const channelById = new Map<number, Channel>();
  for (const c of channels) channelById.set(c.id, c);

  type Entry = {
    id: number;
    name: string;
    avatar: string | null;
    videos: Video[];
    hasNew: boolean;
    newestDate: string;
  };
  const entries: Entry[] = Object.entries(byCh).map(([cidStr, vs]) => {
    const cid = Number(cidStr);
    const ch = channelById.get(cid);
    const sorted = [...vs].sort((a, b) => (b.upload_date ?? "").localeCompare(a.upload_date ?? ""));
    return {
      id: cid,
      name:   ch?.name           ?? sorted[0]?.channel_name      ?? "Unknown channel",
      avatar: ch?.thumbnail_url  ?? sorted[0]?.channel_thumbnail ?? null,
      videos: sorted,
      hasNew: sorted.some(isRecent),
      newestDate: sorted[0]?.upload_date ?? "",
    };
  });

  // Channels with fresh-unwatched videos first, then by most recent upload.
  entries.sort((a, b) => {
    if (a.hasNew !== b.hasNew) return a.hasNew ? -1 : 1;
    return b.newestDate.localeCompare(a.newestDate);
  });

  if (entries.length === 0) return <EmptyHint />;

  return (
    <div className="space-y-10">
      {entries.map((e) => <ChannelSection key={e.id} entry={e} />)}
    </div>
  );
}

const PER_CHANNEL_LIMIT = 8;

function ChannelSection({ entry: e }: { entry: ReturnType<typeof groupedEntry> }) {
  const shown = e.videos.slice(0, PER_CHANNEL_LIMIT);
  const hidden = e.videos.length - shown.length;
  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <Link to={`/channel/${e.id}`} className="flex items-center gap-3 group min-w-0 flex-1">
          {e.avatar ? (
            <img
              src={e.avatar}
              alt=""
              referrerPolicy="no-referrer"
              className="h-9 w-9 rounded-full object-cover bg-zinc-800 group-hover:ring-2 group-hover:ring-zinc-700"
            />
          ) : (
            <div className="grid h-9 w-9 place-items-center rounded-full bg-zinc-800">
              <Tv className="h-4 w-4 text-zinc-500" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold text-zinc-100 group-hover:text-white">
                {e.name}
              </h2>
              {e.hasNew && (
                <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  New
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              {e.videos.length} video{e.videos.length === 1 ? "" : "s"}
            </p>
          </div>
        </Link>
        {hidden > 0 && (
          <Link
            to={`/channel/${e.id}`}
            className="text-xs text-zinc-400 hover:text-zinc-100 flex-shrink-0"
          >
            +{hidden} more →
          </Link>
        )}
      </div>
      <Grid videos={shown} />
    </section>
  );
}

// Type helper so ChannelSection can pull its prop type from the entries array
// without re-declaring the shape.
function groupedEntry(): { id: number; name: string; avatar: string | null;
  videos: Video[]; hasNew: boolean; newestDate: string } {
  return null as never;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="mb-3 flex items-center gap-2.5 text-lg font-semibold text-zinc-100 [text-wrap:balance]">
      <span>{title}</span>
      <span className="rounded-full bg-zinc-800/80 px-2 py-0.5 text-[11px] font-medium text-zinc-400 tabular-nums">
        {count}
      </span>
    </h2>
  );
}

function Grid({ videos }: { videos: Video[] }) {
  // Same VideoGrid + virtualization story as flat mode — when a single
  // by-date/by-channel section grows past 200 cards (e.g. "everything from
  // one prolific channel") it virtualizes.
  return (
    <VideoGrid
      videos={videos}
      isLoading={false}
      emptyTitle=""
      emptyHint=""
    />
  );
}

function EmptyHint() {
  return (
    <p className="py-12 text-center text-sm text-zinc-500">
      Здесь будут видео, когда они появятся у подписанных каналов.
    </p>
  );
}
