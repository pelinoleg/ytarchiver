import { NavLink, useLocation, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Library, Download, History, Tv, FolderDown, Star, Activity,
  Loader2, Database, ListMusic, Music, HardDrive, ChevronDown, ChevronUp,
  Home, Pause, Play, ChevronsDownUp, ChevronsUpDown,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import {
  channelsApi, channelFoldersApi, manualApi, favoritesApi, playlistsApi, queueApi, statsApi, videosApi, musicApi,
  type Channel, type ChannelFolder, type Video,
} from "../lib/api";
import { formatBytes, formatCount } from "../lib/format";
import { useLocalStorageBool } from "../hooks/useLocalStorageBool";
import { useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";

export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void } = {}) {
  const { data: channels = [] } = useQuery({
    queryKey: ["channels"],
    queryFn: channelsApi.list,
  });

  const { data: folders = [] } = useQuery({
    queryKey: ["channel-folders"],
    queryFn: channelFoldersApi.list,
  });

  const { data: manualCount } = useQuery({
    queryKey: ["manual", "count"],
    queryFn: manualApi.count,
    refetchInterval: 30_000,
  });

  const { data: favoriteCount } = useQuery({
    queryKey: ["favorites", "count"],
    queryFn: favoritesApi.count,
    refetchInterval: 30_000,
  });

  const { data: playlists = [] } = useQuery({
    queryKey: ["playlists"],
    queryFn: playlistsApi.list,
    refetchInterval: 60_000,
  });

  const { data: musicStats } = useQuery({
    queryKey: ["music", "stats"],
    queryFn: musicApi.stats,
    refetchInterval: 60_000,
  });

  const { data: queue = [] } = useQuery({
    queryKey: ["queue"],
    queryFn: queueApi.list,
    // Light polling fallback; WS keeps it fresh between ticks.
    refetchInterval: 5_000,
  });

  const downloading = queue.find((v) => v.status === "downloading");
  const downloadingPct = parsePct(downloading?.progress);

  // Active channel = the one whose page or video the user is currently
  // looking at. Used to (a) highlight the channel row and (b) auto-expand
  // its parent folder. We resolve from two URL shapes: /channel/:id and
  // /watch/:videoId (where the channel is looked up via the video row).
  const location = useLocation();
  const channelMatch = location.pathname.match(/^\/channel\/(\d+)/);
  const channelPageId = channelMatch ? Number(channelMatch[1]) : null;
  const watchMatch = location.pathname.match(/^\/watch\/([^/?#]+)/);
  const watchVideoId = watchMatch?.[1];
  const { data: watchedVideo } = useQuery({
    queryKey: ["video", watchVideoId],
    queryFn: () => videosApi.get(watchVideoId!),
    enabled: !!watchVideoId,
  });
  const activeWatchChannelId = channelPageId ?? watchedVideo?.channel_id ?? null;

  // Persisted expand-all/collapse-all flag for channel folders. The
  // folder holding the active channel always stays open regardless.
  const [foldersOpen, setFoldersOpen] = useLocalStorageBool("sidebar.folders.open", true);

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: statsApi.get,
    refetchInterval: 60_000,
  });

  return (
    <>
      {/* Backdrop: visible whenever the sidebar is a drawer, which is now
       *  tablet AND mobile (xl pins it open permanently). z-40 sits above
       *  the BottomNav (also z-40) so the drawer is fully reachable. */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/60 xl:hidden transition-opacity ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        style={{ top: "var(--header-safe-top)" }}
      />
      <aside
        // ``z-50`` (above BottomNav's z-40) so the drawer covers the bar
        // entirely when open — otherwise its bottom items would be hidden
        // under the bar on phone / tablet.
        className={`fixed bottom-0 left-0 z-50 w-70 flex flex-col overflow-hidden bg-zinc-950/70 backdrop-blur-xl
          transition-transform duration-200 ease-out safe-bottom
          xl:bottom-[var(--shell-gap)] xl:left-[var(--shell-gap)] xl:rounded-2xl
          xl:bg-zinc-900 xl:backdrop-blur-none xl:shadow-2xl xl:shadow-black/40
          ${open ? "translate-x-0" : "-translate-x-full"} xl:translate-x-0`}
        style={{ top: "var(--sidebar-top)" }}
      >
        {/* Brand — only on xl, where the sidebar is permanent and full-height
            (the top bar drops its logo there). */}
        <Link
          to="/"
          className="group hidden xl:flex flex-shrink-0 items-center gap-2.5 mx-2 mt-3 mb-1 rounded-xl px-2.5 py-2 text-lg font-bold tracking-tight text-zinc-100 transition-colors hover:bg-white/5"
          aria-label="Home"
        >
          <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-red-600 shadow-sm transition-transform group-hover:scale-105 group-hover:shadow-md group-hover:shadow-red-900/40">
            <span className="block h-0 w-0 border-y-[5px] border-y-transparent border-l-[8px] border-l-white ml-0.5" />
          </span>
          <span className="transition-colors group-hover:text-white">YT Archive</span>
        </Link>
        {/* Top: primary nav — what you actually open every session. Music
         *  is split into its own labelled section since it gets its own
         *  visual identity in the app (fuchsia accent, separate playback
         *  rate, separate favs). */}
        <div className="flex-shrink-0 py-2 sm:py-3">
          <nav className="px-3">
            <SidebarLink
              icon={Home}
              label="Home"
              to="/"
              end
            />
            <SidebarLink
              icon={Star}
              label="Favorites"
              to="/favorites"
              end
              count={favoriteCount?.count ?? 0}
              
            />
            <SidebarLink
              icon={ListMusic}
              label="Playlists"
              to="/playlists"
              count={playlists.length}
            />
            <SidebarLink
              icon={FolderDown}
              label="Manual"
              to="/manual"
              count={manualCount?.count ?? 0}
              
            />
          </nav>

          <hr className="my-2 sm:my-3 border-white/5" />

          <h4 className="flex items-baseline gap-2 px-6 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Music
            {musicStats && musicStats.total_bytes > 0 && (
              <span className="ml-auto font-normal normal-case tracking-normal text-zinc-500 tabular-nums">
                {formatBytes(musicStats.total_bytes)}
              </span>
            )}
          </h4>
          <nav className="px-3">
            <SidebarLink
              icon={Music}
              label="All music"
              to="/music"
              end
              count={musicStats?.tracks ?? 0}
              
            />
            <SidebarLink
              icon={Star}
              label="Liked"
              to="/music/favorites"
              count={musicStats?.favorites ?? 0}
              
            />
          </nav>

          <hr className="my-2 sm:my-3 border-white/5" />

          <div className="px-6 py-1 flex items-center gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Channels
            </h4>
            <button
              type="button"
              onClick={() => setFoldersOpen(!foldersOpen)}
              title={foldersOpen ? "Collapse all folders" : "Expand all folders"}
              aria-label={foldersOpen ? "Collapse all folders" : "Expand all folders"}
              className="ml-auto grid h-5 w-5 place-items-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            >
              {foldersOpen
                ? <ChevronsDownUp className="h-3.5 w-3.5" />
                : <ChevronsUpDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        {/* Middle: only the channel list scrolls. Channels with no folder
            are listed at the top in flat order; folder groups follow,
            each collapsible. Drag-and-drop is intentionally not wired
            here — folder assignment happens on the Subscriptions page. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {channels.length === 0 ? (
            <p className="px-3 py-2 text-xs text-zinc-500">
              No channels yet — click <span className="text-zinc-300">Add channel</span> above.
            </p>
          ) : (
            <SidebarChannelTree
              channels={channels}
              folders={folders}
              activeWatchChannelId={activeWatchChannelId}
              foldersDefaultOpen={foldersOpen}
            />
          )}
        </div>

        {/* Secondary nav — used less often, kept icon-first compact at the
            bottom so the channel list stays the focus. */}
        <div className="flex-shrink-0 border-t border-zinc-800 px-2 py-1">
          <CompactLink icon={Library}   label="Subscriptions" to="/subscriptions" />
          <div className="flex items-stretch gap-1">
            <CompactDownloadsLink
              count={queue.length}
              active={downloading}
              pct={downloadingPct}
              className="flex-1 min-w-0"
            />
            <CompactPauseResumeIcon />
          </div>
          <CompactLink icon={History}   label="History"  to="/history" />
          <CompactLink icon={HardDrive} label="Storage"  to="/storage"  />
          <CompactLink icon={Activity}  label="Activity" to="/events" />
        </div>

        {/* Bottom: stats footer — desktop only + collapsible. Saves space
            when you don't need it; one click to expand. */}
        <StatsFooter
          stats={stats}
          playlistsCount={playlists.length}
          musicTracks={musicStats?.tracks ?? 0}
          musicBytes={musicStats?.total_bytes ?? 0}
          favoritesCount={favoriteCount?.count ?? 0}
          manualCount={manualCount?.count ?? 0}
        />
      </aside>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SidebarChannelTree({
  channels, folders, activeWatchChannelId, foldersDefaultOpen,
}: {
  channels: Channel[];
  folders: ChannelFolder[];
  activeWatchChannelId: number | null;
  foldersDefaultOpen: boolean;
}) {
  const ungrouped = channels.filter((c) => !c.folder_id);
  const byFolder  = new Map<number, Channel[]>();
  for (const c of channels) {
    if (c.folder_id) {
      const arr = byFolder.get(c.folder_id) ?? [];
      arr.push(c);
      byFolder.set(c.folder_id, arr);
    }
  }

  // Folders sorted by total video count across their channels (desc) so
  // the heaviest categories surface to the top — usually the ones the
  // user opens most often.
  const folderTotal = (id: number) =>
    (byFolder.get(id) ?? []).reduce((s, c) => s + (c.video_count ?? 0), 0);
  const sortedFolders = [...folders].sort((a, b) => folderTotal(b.id) - folderTotal(a.id));

  return (
    <>
      {/* Folders first — they're the user-curated lens on the library. */}
      {sortedFolders.map((f) => {
        const items = byFolder.get(f.id) ?? [];
        if (items.length === 0) return null;  // hide empty folders in nav
        return (
          <SidebarFolder
            key={f.id}
            folder={f}
            channels={items}
            videoTotal={folderTotal(f.id)}
            activeWatchChannelId={activeWatchChannelId}
            defaultOpen={foldersDefaultOpen}
          />
        );
      })}
      {/* Ungrouped after — like YouTube's "All subscriptions" tail. */}
      {ungrouped.map((c) => (
        <ChannelLink
          key={c.id}
          channel={c}
          forceActive={c.id === activeWatchChannelId}
        />
      ))}
    </>
  );
}

function SidebarFolder({
  folder, channels, videoTotal, activeWatchChannelId, defaultOpen,
}: {
  folder: ChannelFolder;
  channels: Channel[];
  videoTotal: number;
  activeWatchChannelId: number | null;
  defaultOpen: boolean;
}) {
  const location = useLocation();
  const onFolderPage = location.pathname === `/folder/${folder.id}`;
  const containsActive = channels.some((c) => c.id === activeWatchChannelId);
  const pinnedOpen = containsActive || onFolderPage;

  // Open when (a) this folder holds the active channel / is the current
  // folder page — always forced open — or (b) the global expand-all flag
  // says so. Chevron toggles override locally; the override is dropped on
  // the next nav or global-flag change so the sidebar self-cleans.
  const [open, setOpen] = useState<boolean>(pinnedOpen || defaultOpen);
  useEffect(() => {
    setOpen(pinnedOpen || defaultOpen);
  }, [pinnedOpen, defaultOpen]);
  const toggle = () => setOpen((s) => !s);

  return (
    <div className="mt-2">
      {/* Header row: chevron toggles expand/collapse, name is a link to
       *  the folder feed. Active state highlights when the user is on
       *  /folder/{this folder} so the sidebar always shows where you are. */}
      <div
        className={`group flex items-stretch rounded-lg ${
          onFolderPage ? "bg-zinc-800/70" : "hover:bg-zinc-900"
        }`}
      >
        <button
          onClick={toggle}
          aria-label={open ? "Collapse folder" : "Expand folder"}
          aria-expanded={open}
          className="grid w-7 flex-shrink-0 place-items-center text-zinc-500 hover:text-zinc-200"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`}
          />
        </button>
        <Link
          to={`/folder/${folder.id}`}
          className={`flex flex-1 items-center gap-2 py-1.5 pr-3 text-xs font-semibold uppercase tracking-wide ${
            onFolderPage ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-100"
          }`}
        >
          <span className="truncate flex-1">{folder.name}</span>
          <span className="text-[10px] tabular-nums text-zinc-500">
            {videoTotal}
          </span>
        </Link>
      </div>
      {open && (
        <div className="ml-2">
          {channels.map((c) => (
            <ChannelLink
              key={c.id}
              channel={c}
              forceActive={c.id === activeWatchChannelId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarLink({
  icon: Icon, label, to, end, count,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  to: string;
  end?: boolean;
  count?: number;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      // Active row picks up the apricot accent + a faint inset glow ring;
      // inactive rows stay quiet warm-white and lift on hover.
      className={({ isActive }) =>
        `flex items-center gap-4 sm:gap-6 rounded-lg px-3 py-1.5 sm:py-2 text-sm transition-colors ${
          isActive
            ? "bg-accent/12 text-accent font-medium shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-accent)_22%,transparent)]"
            : "text-white/65 hover:text-white hover:bg-zinc-960"
        }`
      }
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
      <span className="truncate flex-1">{label}</span>
      {count != null && count > 0 && <CountChip n={count} />}
    </NavLink>
  );
}

/** Downloads link with a thin progress overlay along its bottom edge while active. */
function DownloadsLink({
  count, active, pct,
}: { count: number; active: Video | undefined; pct: number | null }) {
  return (
    <NavLink
      to="/downloads"
      className={({ isActive }) =>
        `relative flex items-center gap-4 sm:gap-6 rounded-lg px-3 py-1.5 sm:py-2 text-sm overflow-hidden ${
          isActive ? "bg-zinc-800 font-medium" : "hover:bg-zinc-900 text-zinc-200"
        }`
      }
    >
      {active
        ? <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-zinc-200" />
        : <Download className="h-5 w-5 flex-shrink-0" />}
      <span className="truncate flex-1">Downloads</span>
      {count > 0 && <CountChip n={count} highlight={!!active} />}

      {active && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-zinc-800">
          <div
            className="h-full bg-red-500 transition-[width] duration-300"
            style={{ width: `${pct ?? 5}%` }}
          />
        </div>
      )}
    </NavLink>
  );
}

function ChannelLink({ channel, forceActive }: { channel: Channel; forceActive?: boolean }) {
  const hasNew = (channel.recent_count ?? 0) > 0;
  return (
    <NavLink
      to={`/channel/${channel.id}`}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-1 sm:py-1 text-sm ${
          isActive || forceActive ? "bg-zinc-800 font-medium" : "hover:bg-zinc-900 text-zinc-200"
        }`
      }
    >
      {channel.thumbnail_url ? (
        <img
          src={channel.thumbnail_url}
          alt=""
          referrerPolicy="no-referrer"
          className="h-8 w-8 flex-shrink-0 rounded-full object-cover bg-zinc-800"
        />
      ) : (
        <Tv className="h-5 w-5 flex-shrink-0 text-zinc-500" />
      )}
      <span className="truncate flex-1" title={channel.name}>{channel.name}</span>
      {channel.video_count > 0 && (
        <CountChip
          n={channel.video_count}
          dot={hasNew}
          dotTitle={`${channel.recent_count} downloaded in the last 24h`}
        />
      )}
    </NavLink>
  );
}

function CountChip({
  n, highlight, dot, dotTitle,
}: { n: number; highlight?: boolean; dot?: boolean; dotTitle?: string }) {
  return (
    <span className="relative ml-auto inline-block" title={dot ? dotTitle : undefined}>
      <span
        className={`block rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
          highlight ? "bg-red-600 text-white" : "bg-accent/12 text-accent"
        }`}
      >
        {n}
      </span>
      {dot && (
        <span className="opacity-50 pointer-events-none absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-zinc-950" />
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact links — used in the secondary nav at the very bottom of the
// sidebar for pages that are needed rarely. Icon-first row, small label.

function CompactLink({
  icon: Icon, label, to, count,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  to: string;
  count?: number;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-md px-3 py-1.5 text-[13px] text-white transition-opacity ${
          isActive
            ? "bg-zinc-800 font-medium opacity-100"
            : "hover:bg-zinc-900 opacity-55 hover:opacity-100"
        }`
      }
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="truncate flex-1">{label}</span>
      {count != null && count > 0 && (
        <span className="rounded-full bg-zinc-800 px-1.5 text-[10px] font-medium tabular-nums text-zinc-300">
          {count}
        </span>
      )}
    </NavLink>
  );
}

function CompactDownloadsLink({
  count, active, pct, className = "",
}: { count: number; active: Video | undefined; pct: number | null; className?: string }) {
  return (
    <NavLink
      to="/downloads"
      className={({ isActive }) =>
        `relative flex items-center gap-3 rounded-md px-3 py-1.5 text-[13px] overflow-hidden text-white transition-opacity ${
          isActive
            ? "bg-zinc-800 font-medium opacity-100"
            : "hover:bg-zinc-900 opacity-55 hover:opacity-100"
        } ${className}`
      }
    >
      {active
        ? <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
        : <Download className="h-4 w-4 flex-shrink-0" />}
      <span className="truncate flex-1">Downloads</span>
      {count > 0 && (
        <span className={`rounded-full px-1.5 text-[10px] font-medium tabular-nums ${
          active ? "bg-red-600 text-white" : "bg-zinc-800 text-zinc-300"
        }`}>{count}</span>
      )}
      {active && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-zinc-800">
          <div className="h-full bg-red-500 transition-[width] duration-300" style={{ width: `${pct ?? 5}%` }} />
        </div>
      )}
    </NavLink>
  );
}

/** Global Pause All / Resume All — small icon-only button sitting flush
 *  to the right of the Downloads link so they share one nav row. */
function CompactPauseResumeIcon() {
  const qc = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ["queue-status"],
    queryFn: queueApi.status,
    refetchInterval: 10_000,
  });
  const toggle = useMutation({
    mutationFn: () => (status?.paused ? queueApi.resume() : queueApi.pause()),
    onSuccess: (next) => {
      qc.setQueryData(["queue-status"], next);
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });
  const paused = !!status?.paused;
  return (
    <button
      type="button"
      onClick={() => toggle.mutate()}
      disabled={toggle.isPending}
      aria-label={paused ? "Resume all downloads" : "Pause all downloads"}
      title={paused ? "Возобновить все загрузки" : "Поставить все загрузки на паузу"}
      className={
        "grid w-8 flex-shrink-0 place-items-center rounded-md transition " +
        (paused
          ? "bg-amber-500/25 text-amber-100 ring-1 ring-amber-400/40 hover:bg-amber-500/35"
          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100") +
        (toggle.isPending ? " opacity-60" : "")
      }
    >
      {paused
        ? <Play  className="h-3.5 w-3.5" />
        : <Pause className="h-3.5 w-3.5" />}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats — desktop-only, collapsible. Closed state is a thin one-line strip
// with the most relevant numbers. Open shows the full breakdown.

function StatsFooter({
  stats, playlistsCount, musicTracks, musicBytes, favoritesCount, manualCount,
}: {
  stats: { channels: number; videos: number; total_bytes: number } | undefined;
  playlistsCount: number;
  musicTracks:    number;
  musicBytes:     number;
  favoritesCount: number;
  manualCount:    number;
}) {
  const [open, setOpen] = useLocalStorageBool("sidebar.stats.open", false);
  return (
    <div className="hidden xl:block flex-shrink-0 border-t border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-2 hover:bg-zinc-900"
        aria-expanded={open}
      >
        <Database className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Library
        </span>
        {stats && !open && (
          <span className="ml-auto truncate text-[11px] text-zinc-400 tabular-nums">
            {formatCount(stats.videos)} videos · {formatBytes(stats.total_bytes)}
          </span>
        )}
        <span className={`text-zinc-500 ${open ? "" : "ml-1"}`}>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3">
          {stats ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-zinc-500">Channels</dt>
              <dd className="text-right text-zinc-200 tabular-nums">{stats.channels}</dd>
              <dt className="text-zinc-500">Videos</dt>
              <dd className="text-right text-zinc-200 tabular-nums">{formatCount(stats.videos)}</dd>
              <dt className="text-zinc-500">Playlists</dt>
              <dd className="text-right text-zinc-200 tabular-nums">{playlistsCount}</dd>
              <dt className="text-zinc-500">Music</dt>
              <dd className="text-right text-zinc-200 tabular-nums">
                {formatCount(musicTracks)}
                {musicBytes > 0 && <span className="text-zinc-500"> · {formatBytes(musicBytes)}</span>}
              </dd>
              <dt className="text-zinc-500">Favorites</dt>
              <dd className="text-right text-zinc-200 tabular-nums">{favoritesCount}</dd>
              <dt className="text-zinc-500">Manual</dt>
              <dd className="text-right text-zinc-200 tabular-nums">{manualCount}</dd>
              <dt className="text-zinc-500">Storage</dt>
              <dd className="text-right text-zinc-200">{formatBytes(stats.total_bytes)}</dd>
            </dl>
          ) : (
            <p className="text-xs text-zinc-600">loading…</p>
          )}
        </div>
      )}
    </div>
  );
}

function parsePct(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/(\d+(\.\d+)?)/);
  return m ? Number(m[1]) : null;
}
