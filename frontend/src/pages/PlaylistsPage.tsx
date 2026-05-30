import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Inbox, ListMusic, Search, Infinity as InfinityIcon, AlertTriangle, Play,
} from "lucide-react";
import { playlistsApi, type Playlist } from "../lib/api";
import { timeAgo } from "../lib/format";
import { PlaylistStack } from "../components/PlaylistStack";

export function PlaylistsPage() {
  const { data: playlists = [], isLoading } = useQuery({
    queryKey: ["playlists"],
    queryFn: playlistsApi.list,
  });

  const youtube  = playlists.filter((p) => !isSearch(p));
  const searches = playlists.filter(isSearch);

  return (
    <>
      <header className="mb-5 flex items-center gap-3.5">
        <span className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent to-accent-strong text-accent-ink shadow-lg shadow-accent/25">
          <ListMusic className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Playlists</h1>
          <p className="text-sm text-zinc-400">
            {playlists.length} {playlists.length === 1 ? "playlist" : "playlists"}
          </p>
        </div>
      </header>

      {isLoading ? (
        <CardGrid>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-[4/5] rounded-2xl bg-zinc-900 animate-pulse" />
          ))}
        </CardGrid>
      ) : playlists.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-zinc-900 ring-1 ring-white/10">
            <Inbox className="h-7 w-7 text-zinc-500" />
          </div>
          <h3 className="mt-5 text-lg font-semibold text-zinc-100">No playlists yet</h3>
          <p className="mt-2 text-sm text-zinc-400">
            Жми <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200">+ Add</span> в шапке.
          </p>
        </div>
      ) : (
        <div className="space-y-10">
          {youtube.length > 0 && (
            <PlaylistSection
              icon={ListMusic}
              title="YouTube playlists"
              count={youtube.length}
            >
              {youtube.map((p) => <PlaylistCard key={p.id} playlist={p} />)}
            </PlaylistSection>
          )}

          {searches.length > 0 && (
            <PlaylistSection
              icon={Search}
              title="Search collections"
              count={searches.length}
            >
              {searches.map((p) => <PlaylistCard key={p.id} playlist={p} />)}
            </PlaylistSection>
          )}
        </div>
      )}
    </>
  );
}

function isSearch(p: Playlist): boolean {
  return typeof p.url === "string" && p.url.startsWith("ytsearch");
}

// ─────────────────────────────────────────────────────────────────────────────

function PlaylistSection({
  icon: Icon, title, count, children,
}: {
  icon: typeof ListMusic;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">
          <Icon className="h-4 w-4" />
        </span>
        <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
        <span className="rounded-full bg-accent/12 px-2 py-0.5 text-xs font-semibold text-accent tabular-nums">
          {count}
        </span>
      </div>
      <CardGrid>{children}</CardGrid>
    </section>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function PlaylistCard({ playlist: p }: { playlist: Playlist }) {
  const search = isSearch(p);
  const total  = p.video_count || p.item_count;
  const done   = p.done_count;
  const pct    = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const isComplete = total > 0 && done >= total;

  return (
    <Link
      to={`/playlist/${p.id}`}
      className="group block min-w-0"
    >
      {/* PlaylistStack adds the layered "this is a collection" cards
       *  peeking above the cover — the strongest visual cue that this
       *  isn't just a video. Combined with the upper-left PLAYLIST pill,
       *  it's unmistakable at a glance. */}
      <PlaylistStack>
        <div className="relative aspect-video overflow-hidden rounded-xl bg-zinc-900 shadow-md shadow-black/30 transition-all duration-300 group-hover:ring-1 group-hover:ring-accent/40 group-hover:shadow-lg group-hover:shadow-black/40">
          {p.thumbnail_url ? (
            <img
              src={p.thumbnail_url}
              alt=""
              referrerPolicy="no-referrer"
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="grid h-full w-full place-items-center">
              {search ? <Search   className="h-10 w-10 text-zinc-700" />
                      : <ListMusic className="h-10 w-10 text-zinc-700" />}
            </div>
          )}

          {/* Subtle gradient at the bottom for chip legibility. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/65 to-transparent" />

          {/* Hover Play overlay. */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center transition-colors duration-300 group-hover:bg-black/25">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-white text-zinc-950 shadow-xl shadow-black/40 opacity-0 scale-90 transition-all duration-300 group-hover:opacity-100 group-hover:scale-100">
              <Play className="h-5 w-5 fill-current translate-x-0.5" />
            </span>
          </div>

          {/* Top-left: explicit PLAYLIST / SEARCH pill — small but readable. */}
          <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur-sm">
            {search ? <Search className="h-3 w-3" /> : <ListMusic className="h-3 w-3" />}
            {search ? "Search" : "Playlist"}
          </span>

          {/* Top-right: keep-forever badge (only when on). */}
          {p.keep_videos_forever && (
            <span
              title="Videos in this playlist are never auto-deleted"
              className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-amber-400/95 text-amber-950 shadow"
            >
              <InfinityIcon className="h-3 w-3" strokeWidth={3} />
            </span>
          )}

          {/* Bottom-right count badge — at-a-glance progress / total. */}
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/85 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white backdrop-blur-sm">
            {isComplete ? `${total}` : `${done}/${total}`}
          </span>

          {/* Hairline progress at the very bottom. */}
          {total > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/40">
              <div
                className={`h-full ${isComplete ? "bg-emerald-400" : "bg-red-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </PlaylistStack>

      {/* Title + meta — kept under the cover, breathing room. */}
      <div className="mt-2.5 min-w-0">
        <h3
          className="line-clamp-2 text-sm font-medium leading-snug text-zinc-100 group-hover:text-white transition-colors"
          title={p.title}
        >
          {p.title}
        </h3>
        <p className="mt-0.5 truncate text-[11px] text-zinc-500">
          {p.uploader && !search ? `${p.uploader} · ` : ""}
          <SyncMeta playlist={p} />
        </p>
      </div>
    </Link>
  );
}

function SyncMeta({ playlist: p }: { playlist: Playlist }) {
  if (p.last_sync_error) {
    return (
      <span className="inline-flex items-center gap-0.5 text-red-400">
        <AlertTriangle className="h-3 w-3" />
        sync error
      </span>
    );
  }
  if (!p.last_synced) return <>never synced</>;
  return <>synced {timeAgo(p.last_synced)}</>;
}

