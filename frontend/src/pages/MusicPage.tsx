import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Music, Play, Shuffle, ListMusic, Search, Inbox, Star,
  Infinity as InfinityIcon, MoreVertical, MinusCircle,
} from "lucide-react";
import { useRef, useState, useEffect } from "react";
import {
  musicApi, playlistsApi, videosApi, thumbUrl, previewUrl,
  type Playlist, type Video,
} from "../lib/api";
import { formatBytes, formatDuration, formatUploadDate, timeAgo } from "../lib/format";
import { setMusicQueue, shuffleArray, getMusicShuffle, setMusicShuffle } from "../lib/queue";
import { VirtualVideoGrid } from "../components/VirtualVideoGrid";
import { PlaylistStack } from "../components/PlaylistStack";
import { useCardMin } from "../components/DensitySlider";
import type { CSSProperties } from "react";

/** Below this many tracks render the plain CSS grid (one less abstraction,
 *  preserves the previous behavior for the common case). Above it switch
 *  to windowed virtualization so 1000+ track libraries stay smooth. */
const VIRTUALIZE_THRESHOLD = 200;

const PREVIEW_DELAY_MS = 400;

export function MusicPage() {
  const { data: tracks = [], isLoading: tracksLoading } = useQuery({
    queryKey: ["music", "tracks"],
    queryFn:  () => musicApi.tracks(500),
  });
  const { data: playlists = [], isLoading: playlistsLoading } = useQuery({
    queryKey: ["music", "playlists"],
    queryFn:  musicApi.playlists,
  });

  // Favorites — separate from the global Favorites page, which deliberately
  // hides music. Lives in its own section so the user has one obvious target
  // for "stuff I like and want to find quickly".
  const favorites = tracks.filter((t) => t.is_favorite);

  const nav = useNavigate();
  const isEmpty = !tracksLoading && !playlistsLoading && tracks.length === 0 && playlists.length === 0;

  // Desktop density slider (shared app-wide). Music cards run a touch denser
  // than video cards, so shave the target width a bit. Columns still reflow
  // with the window width via auto-fill / the virtual grid's minCardWidth.
  const [cardMinRaw] = useCardMin();
  const trackCardMin = Math.max(140, cardMinRaw - 40);
  const trackBreakpoints = [
    { width: 0, cols: 2 },
    { width: 640, cols: 3 },
  ];
  const trackGridStyle = { "--card-min": `${trackCardMin}px` } as CSSProperties;

  // The "all music" track-id list is what powers Play All / Shuffle All.
  const allIds = tracks.map((t) => t.video_id);

  function playAll(shuffled: boolean) {
    if (!allIds.length) return;
    const queue = shuffled ? shuffleArray(allIds) : allIds;
    setMusicQueue(queue, shuffled);
    // Surface the shuffle state in the URL so the WatchPage chip can show
    // and toggle it (and a reload preserves the mode).
    nav(`/watch/${queue[0]}?source=music${shuffled ? "&shuffle=1" : ""}`);
  }

  return (
    <>
      {/* Hero — Apple-Music-style: 2×2 mosaic of recent track covers,
          blurred and tinted, big frosted-glass card on top. Falls back to
          a pure gradient when there's nothing in the library yet. */}
      <MusicHero
        tracks={tracks}
        playlistsCount={playlists.length}
        // "Play all" honours the remembered shuffle mode; "Shuffle" forces it
        // on and remembers that globally.
        onPlayAll={() => playAll(getMusicShuffle())}
        onShuffle={() => { setMusicShuffle(true); playAll(true); }}
      />

      {isEmpty ? (
        <EmptyState />
      ) : (
        <div className="space-y-10">
          {(playlists.length > 0 || favorites.length > 0) && (
            <section>
              <SectionHeader
                icon={ListMusic} title="Playlists"
                count={playlists.length + (favorites.length > 0 ? 1 : 0)}
              />
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5">
                {/* Favorites — rendered first, styled like the other playlist
                 *  cards so it lives in the same flow. Click to open Music
                 *  with the favs queue. */}
                {favorites.length > 0 && (
                  <FavoritesPlaylistCard tracks={favorites} />
                )}
                {playlists.map((p) => <MusicPlaylistCard key={p.id} playlist={p} />)}
              </div>
            </section>
          )}

          {tracks.length > 0 && (
            <section>
              <SectionHeader icon={Music} title="Tracks" count={tracks.length} />
              {tracks.length > VIRTUALIZE_THRESHOLD ? (
                <VirtualVideoGrid
                  items={tracks}
                  breakpoints={trackBreakpoints}
                  minCardWidth={trackCardMin}
                  textBelow={78}
                  rowPad={16}
                  renderItem={(t, idx) => (
                    <MusicTrackCard
                      track={t}
                      onPlay={() => {
                        const ordered = [...allIds.slice(idx), ...allIds.slice(0, idx)];
                        setMusicQueue(ordered, false);
                        nav(`/watch/${t.video_id}?source=music`);
                      }}
                    />
                  )}
                />
              ) : (
                <div
                  style={trackGridStyle}
                  className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:[grid-template-columns:repeat(auto-fill,minmax(var(--card-min),1fr))]"
                >
                  {tracks.map((t, idx) => (
                    <MusicTrackCard
                      key={t.id}
                      track={t}
                      onPlay={() => {
                        const ordered = [...allIds.slice(idx), ...allIds.slice(0, idx)];
                        setMusicQueue(ordered, false);
                        nav(`/watch/${t.video_id}?source=music`);
                      }}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon, title, count, tone = "fuchsia",
}: {
  icon: typeof Music; title: string; count: number;
  tone?: "fuchsia" | "amber";
}) {
  const iconCls = tone === "amber" ? "text-yellow-300" : "text-fuchsia-400/80";
  return (
    <div className="mb-4 flex items-baseline gap-2.5">
      <Icon className={`h-5 w-5 self-center ${iconCls} ${tone === "amber" ? "fill-current" : ""}`} />
      <h2 className="text-lg font-semibold tracking-tight text-zinc-100">{title}</h2>
      <span className="text-sm text-zinc-500 tabular-nums">{count}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Favorites card — sits inside the Playlists row and behaves like a music
// playlist. Click = play favs in order, FAB row = play / shuffle.

function FavoritesPlaylistCard({ tracks }: { tracks: Video[] }) {
  const nav = useNavigate();
  // Use up to 4 distinct cover thumbs for a 2×2 mosaic. Falls back to a
  // gradient when nothing has artwork.
  const covers = tracks
    .filter((t) => t.thumbnail_path || t.thumbnail_url)
    .slice(0, 4);

  function play(shuffled: boolean) {
    const ids = tracks.map((t) => t.video_id);
    if (!ids.length) return;
    const ordered = shuffled ? shuffleArray(ids) : ids;
    setMusicQueue(ordered, shuffled);
    const params = new URLSearchParams({ source: "music" });
    if (shuffled) params.set("shuffle", "1");
    nav(`/watch/${ordered[0]}?${params.toString()}`);
  }

  return (
    <div className="group block min-w-0">
      <PlaylistStack accent="bg-yellow-400/35" accentSoft="bg-yellow-400/15">
        <button
          type="button"
          onClick={() => play(getMusicShuffle())}
          className="relative block aspect-video w-full overflow-hidden rounded-xl bg-zinc-900 shadow-md shadow-black/30 text-left transition-all duration-300 group-hover:ring-1 group-hover:ring-yellow-400/50 group-hover:shadow-lg group-hover:shadow-yellow-900/30"
          aria-label="Play favorites"
        >
          {covers.length > 0 ? (
            <div className="grid h-full w-full grid-cols-2 grid-rows-2">
              {covers.map((t, i) => (
                <img
                  key={t.id}
                  src={t.thumbnail_path ? thumbUrl(t.video_id) : t.thumbnail_url!}
                  referrerPolicy="no-referrer"
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />
              ))}
              {covers.length < 4 && Array.from({ length: 4 - covers.length }).map((_, i) => (
                <div
                  key={`gap-${i}`}
                  className="bg-gradient-to-br from-yellow-700/35 via-amber-900/30 to-zinc-900"
                />
              ))}
            </div>
          ) : (
            <div className="grid h-full w-full place-items-center bg-gradient-to-br from-yellow-700/35 via-amber-900/30 to-zinc-900">
              <Star className="h-10 w-10 text-yellow-300/80 fill-current" />
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/65 to-transparent" />

          {/* Top-left FAVORITES pill — strong identity, matches other cards. */}
          <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-yellow-400/95 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-950 shadow">
            <Star className="h-3 w-3 fill-current" />
            Favorites
          </span>

          <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/85 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white backdrop-blur-sm">
            {tracks.length}
          </span>
        </button>

        {/* FABs — bottom-right of cover. */}
        <div className="pointer-events-none absolute right-2 bottom-7 flex items-center gap-1.5 sm:opacity-0 sm:translate-y-1 sm:transition-all sm:duration-300 sm:group-hover:opacity-100 sm:group-hover:translate-y-0">
          <button
            onClick={(e) => { e.preventDefault(); setMusicShuffle(true); play(true); }}
            aria-label="Shuffle favorites"
            title="Shuffle"
            className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full bg-zinc-900/90 text-yellow-200 ring-1 ring-white/15 shadow-lg shadow-black/40 backdrop-blur-sm hover:bg-zinc-800 active:scale-95"
          >
            <Shuffle className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => { e.preventDefault(); play(getMusicShuffle()); }}
            aria-label="Play favorites"
            title="Play"
            className="pointer-events-auto grid h-11 w-11 place-items-center rounded-full bg-yellow-400 text-yellow-950 shadow-xl shadow-yellow-900/50 hover:bg-yellow-300 active:scale-95 transition-transform"
          >
            <Play className="h-5 w-5 fill-current translate-x-0.5" />
          </button>
        </div>
      </PlaylistStack>

      <div className="mt-2.5">
        <h3 className="text-sm font-medium leading-snug text-zinc-100 group-hover:text-white transition-colors">
          Liked
        </h3>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          {tracks.length === 1 ? "1 track" : `${tracks.length} tracks`}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero — visual + CTAs at the top of the page.

function MusicHero({
  tracks, playlistsCount, onPlayAll, onShuffle,
}: {
  tracks: Video[];
  playlistsCount: number;
  onPlayAll: () => void;
  onShuffle: () => void;
}) {
  // 4 distinct cover thumbnails make the mosaic. Pull from the top of the
  // list (most recent music) — feels alive and rotates as the library grows.
  const covers = tracks
    .filter((t) => t.thumbnail_path || t.thumbnail_url)
    .slice(0, 4);

  const totalBytes = tracks.reduce((sum, t) => sum + (t.file_size_bytes ?? 0), 0);

  return (
    <header className="relative mb-6 overflow-hidden rounded-2xl shadow-lg shadow-black/30">
      {/* Background — cover mosaic or fallback gradient, dimmer than before. */}
      <div className="absolute inset-0">
        {covers.length > 0 ? (
          <div className="grid h-full w-full grid-cols-2 grid-rows-2">
            {covers.map((t, i) => (
              <img
                key={t.id}
                src={t.thumbnail_path ? thumbUrl(t.video_id) : t.thumbnail_url!}
                referrerPolicy="no-referrer"
                alt=""
                className="h-full w-full object-cover"
                style={{
                  transform: `scale(${1.1 + (i % 2) * 0.08}) rotate(${(i - 1.5) * 1.5}deg)`,
                }}
              />
            ))}
          </div>
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-fuchsia-700 via-purple-900 to-zinc-950" />
        )}
        <div className="absolute inset-0 backdrop-blur-3xl bg-zinc-950/65" />
        <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-700/30 via-purple-900/25 to-zinc-950/80" />
      </div>

      {/* Foreground — single row on sm+, compact stack on phone. */}
      <div className="relative flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-fuchsia-500/20 ring-1 ring-fuchsia-400/30">
            <Music className="h-5 w-5 text-fuchsia-200" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg sm:text-xl font-semibold tracking-tight text-white">
              Музыка
            </h1>
            <p className="mt-0.5 truncate text-xs text-zinc-300/90">
              <span className="font-semibold tabular-nums text-white">{tracks.length}</span> tracks
              {" · "}
              <span className="font-semibold tabular-nums text-white">{playlistsCount}</span> {playlistsCount === 1 ? "playlist" : "playlists"}
              {totalBytes > 0 && <> {" · "}<span className="font-semibold tabular-nums text-white">{formatBytes(totalBytes)}</span></>}
            </p>
          </div>
        </div>

        {tracks.length > 0 && (
          <div className="flex flex-shrink-0 gap-1.5">
            <button
              onClick={onPlayAll}
              className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-zinc-950 shadow hover:bg-zinc-100 active:bg-zinc-200"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Play all
            </button>
            <button
              onClick={onShuffle}
              className="flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur-sm px-3.5 py-1.5 text-xs font-semibold text-white ring-1 ring-white/15 hover:bg-white/25"
            >
              <Shuffle className="h-3.5 w-3.5" />
              Shuffle
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span>
      <span className="font-bold text-white tabular-nums">{n.toLocaleString()}</span>
      {" "}<span className="text-zinc-300/80">{label}</span>
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-fuchsia-500/15 ring-1 ring-fuchsia-500/30">
        <Music className="h-7 w-7 text-fuchsia-300" />
      </div>
      <h3 className="mt-5 text-lg font-semibold text-zinc-100">No music yet</h3>
      <p className="mt-2 max-w-md text-sm text-zinc-400 leading-relaxed">
        Открой плейлист или видео, в меню «…» выбери{" "}
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200">Mark as music</span>.
        Помеченные элементы пропадут из обычных разделов и переедут сюда.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Playlist card — same poster style as the regular Playlists page, but with
// inline play/shuffle buttons since users come here to listen.

function MusicPlaylistCard({ playlist: p }: { playlist: Playlist }) {
  const nav = useNavigate();
  const search = typeof p.url === "string" && p.url.startsWith("ytsearch");

  // We need a list of video_ids to seed the queue. Lazy-fetch on demand.
  const { refetch: fetchVideos } = useQuery({
    queryKey: ["playlist", p.id, "videos"],
    queryFn: () => playlistsApi.videos(p.id),
    enabled: false,
  });

  async function startPlaylist(shuffled: boolean) {
    const res = await fetchVideos();
    const ids = (res.data ?? [])
      .filter((v: Video) => v.status === "done")
      .map((v: Video) => v.video_id);
    if (!ids.length) return;
    const ordered = shuffled ? shuffleArray(ids) : ids;
    // We navigate with ?source=music, and WatchPage reads the *music* queue in
    // that context — so seed the music queue here. (Using setPlaylistQueue was
    // a bug: WatchPage never reads the playlist queue when source=music, so the
    // queue silently fell back to whatever stale music queue was left over —
    // typically a single previously-watched track.)
    setMusicQueue(ordered, shuffled);
    const params = new URLSearchParams({ playlist: String(p.id) });
    if (shuffled) params.set("shuffle", "1");
    params.set("source", "music");  // Stay in music-queue context so the chip + queue panel match.
    nav(`/watch/${ordered[0]}?${params.toString()}`);
  }

  const total = p.video_count || p.item_count;
  const done  = p.done_count;
  const pct   = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const isComplete = total > 0 && done >= total;

  return (
    <div className="group block min-w-0">
      <PlaylistStack accent="bg-fuchsia-500/35" accentSoft="bg-fuchsia-500/15">
        <Link
          to={`/playlist/${p.id}`}
          className="relative block aspect-video overflow-hidden rounded-xl bg-zinc-900 shadow-md shadow-black/30 transition-all duration-300 group-hover:ring-1 group-hover:ring-fuchsia-500/40 group-hover:shadow-lg group-hover:shadow-fuchsia-900/30"
        >
          {p.thumbnail_url ? (
            <img
              src={p.thumbnail_url}
              alt=""
              referrerPolicy="no-referrer"
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="grid h-full w-full place-items-center bg-gradient-to-br from-fuchsia-700/30 via-purple-900/25 to-zinc-900">
              <Music className="h-10 w-10 text-fuchsia-300/70" />
            </div>
          )}

          {/* Bottom gradient for chip legibility. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/65 to-transparent" />

          {/* Top-left: explicit MUSIC pill so the card identity is obvious. */}
          <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-fuchsia-500/95 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fuchsia-950 shadow">
            {search ? <Search className="h-3 w-3" /> : <Music className="h-3 w-3" />}
            {search ? "Search" : "Music"}
          </span>

          {/* Top-right: keep-forever badge only when on. */}
          {p.keep_videos_forever && (
            <span
              title="Videos in this playlist are never auto-deleted"
              className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-amber-400/95 text-amber-950 shadow"
            >
              <InfinityIcon className="h-3 w-3" strokeWidth={3} />
            </span>
          )}

          {/* Bottom-left count badge. */}
          <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/85 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white backdrop-blur-sm">
            {isComplete ? `${total}` : `${done}/${total}`}
          </span>

          {/* Hairline progress at the very bottom. */}
          {total > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/40">
              <div
                className={`h-full ${isComplete ? "bg-emerald-400" : "bg-fuchsia-400"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </Link>

        {/* Music FABs — bottom-right of cover. Always on for phones,
         *  fade up on desktop hover. Sized to feel like a real player
         *  control, not a tiny chip. */}
        <div className="pointer-events-none absolute right-2 bottom-7 flex items-center gap-1.5 sm:opacity-0 sm:translate-y-1 sm:transition-all sm:duration-300 sm:group-hover:opacity-100 sm:group-hover:translate-y-0">
          <button
            onClick={(e) => { e.preventDefault(); setMusicShuffle(true); startPlaylist(true); }}
            aria-label="Shuffle play"
            title="Shuffle"
            className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full bg-zinc-900/90 text-fuchsia-200 ring-1 ring-white/15 shadow-lg shadow-black/40 backdrop-blur-sm hover:bg-zinc-800 active:scale-95"
          >
            <Shuffle className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => { e.preventDefault(); startPlaylist(getMusicShuffle()); }}
            aria-label="Play"
            title="Play"
            className="pointer-events-auto grid h-11 w-11 place-items-center rounded-full bg-fuchsia-500 text-white shadow-xl shadow-fuchsia-900/50 hover:bg-fuchsia-400 active:scale-95 transition-transform"
          >
            <Play className="h-5 w-5 fill-current translate-x-0.5" />
          </button>
        </div>
      </PlaylistStack>

      <Link to={`/playlist/${p.id}`} className="block mt-2.5">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-zinc-100 group-hover:text-white transition-colors break-words" title={p.title}>
          {p.title}
        </h3>
        {p.uploader && !search && (
          <p className="mt-0.5 truncate text-[11px] text-zinc-500">{p.uploader}</p>
        )}

        <div className="mt-1.5">
          <div className="flex items-center justify-between text-[11px] tabular-nums">
            <span className={isComplete ? "text-emerald-400 font-medium" : "text-zinc-500"}>
              {isComplete ? "All downloaded" : `${done} of ${total}`}
            </span>
            <span className="text-zinc-500">synced {timeAgo(p.last_synced)}</span>
          </div>
        </div>
      </Link>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Track card — purpose-built music tile with hover-preview + a quick action
// menu to unmark the track (returns it to its normal home).

function MusicTrackCard({ track: t, onPlay }: { track: Video; onPlay: () => void }) {
  const qc = useQueryClient();
  const thumb = t.thumbnail_path ? thumbUrl(t.video_id) : t.thumbnail_url;
  const [previewing, setPreviewing] = useState(false);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Star toggle — primary fav/unfav target on the music page. Optimistic
  // local update via setQueryData so the star fills/empties without a
  // round-trip flicker.
  const favMut = useMutation({
    mutationFn: () => videosApi.update(t.video_id, { is_favorite: !t.is_favorite }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["music"] });
      qc.invalidateQueries({ queryKey: ["favorites"] });
    },
  });

  useEffect(() => () => {
    if (enterTimer.current) clearTimeout(enterTimer.current);
  }, []);

  function onEnter() {
    if (!t.has_preview) return;
    if (enterTimer.current) clearTimeout(enterTimer.current);
    enterTimer.current = setTimeout(() => setPreviewing(true), PREVIEW_DELAY_MS);
  }
  function onLeave() {
    if (enterTimer.current) clearTimeout(enterTimer.current);
    setPreviewing(false);
  }

  return (
    <div
      className="group relative block min-w-0"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <button
        onClick={onPlay}
        className="block w-full min-w-0 text-left"
        aria-label={`Play ${t.title}`}
      >
        <div className="relative aspect-video overflow-hidden rounded-xl bg-zinc-900">
          {thumb && (
            <img
              src={thumb}
              alt=""
              referrerPolicy="no-referrer"
              loading="lazy"
              className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] ${
                previewing ? "opacity-0" : "opacity-100"
              }`}
            />
          )}
          {previewing && (
            <video
              src={previewUrl(t.video_id)}
              autoPlay muted loop playsInline preload="none"
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}

          {/* Play overlay on hover */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/40">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-fuchsia-500/0 text-white opacity-0 transition-all group-hover:bg-fuchsia-500/90 group-hover:opacity-100 group-hover:scale-100 scale-90 shadow-lg">
              <Play className="h-6 w-6 fill-current" />
            </span>
          </div>

          {t.duration && (
            <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1.5 py-0.5 text-xs font-medium text-white">
              {formatDuration(t.duration)}
            </span>
          )}
          {t.file_size_bytes ? (
            <span className="hidden absolute bottom-1 left-1 rounded bg-sky-500/90 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums shadow">
              {formatBytes(t.file_size_bytes, true)}
            </span>
          ) : null}

          {/* Star — discreet top-left chip, always visible when favorited
              and fades in on hover otherwise. Lives on the thumb (not in the
              menu) so it's still one tap to toggle. */}
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); favMut.mutate(); }}
            aria-label={t.is_favorite ? "Remove from favorites" : "Add to favorites"}
            title={t.is_favorite ? "Remove from favorites" : "Add to favorites"}
            className={`absolute top-1 left-1 grid h-7 w-7 place-items-center rounded-full transition-opacity ${
              t.is_favorite
                ? "bg-black/55 text-yellow-300"
                : "bg-black/55 text-white opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            }`}
          >
            <Star className={`h-3.5 w-3.5 ${t.is_favorite ? "fill-current" : ""}`} />
          </button>
        </div>

        <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-zinc-100 break-words">
          {t.title}
        </h3>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {t.channel_name}
          {t.upload_date && (
            <> · {formatUploadDate(t.upload_date, t.downloaded_at, t.upload_timestamp)}</>
          )}
        </p>
      </button>

      <TrackMenu video={t} />
    </div>
  );
}

function TrackMenu({ video }: { video: Video }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unmark = useMutation({
    mutationFn: () => videosApi.update(video.video_id, { is_music: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["music"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
    },
  });

  const favMut = useMutation({
    mutationFn: () => videosApi.update(video.video_id, { is_favorite: !video.is_favorite }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["music"] });
      qc.invalidateQueries({ queryKey: ["favorites"] });
    },
  });

  return (
    <div ref={ref} className="absolute right-2 top-2">
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((s) => !s); }}
        className="rounded-full bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80"
        aria-label="Track actions"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-60 overflow-hidden rounded-xl ring-1 ring-white/10 bg-zinc-900 shadow-2xl z-20">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); favMut.mutate(); setOpen(false); }}
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-zinc-100 hover:bg-zinc-800"
          >
            <Star className={`h-4 w-4 ${video.is_favorite ? "fill-current text-yellow-300" : ""}`} />
            {video.is_favorite ? "Remove from favorites" : "Add to favorites"}
          </button>
          {video.is_music_via_playlist && !video.is_music ? (
            <div className="flex items-start gap-2 px-3 py-2 text-sm text-zinc-500">
              <Music className="h-4 w-4 text-fuchsia-400 mt-0.5 flex-shrink-0" />
              <span className="leading-tight">В music-плейлисте<br/>
                <span className="text-[10px] text-zinc-600">снять отметку — на странице плейлиста</span>
              </span>
            </div>
          ) : (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); unmark.mutate(); setOpen(false); }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-zinc-100 hover:bg-zinc-800"
            >
              <MinusCircle className="h-4 w-4" />
              Remove from music
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Re-export Inbox so unused-import linter doesn't complain when the empty
// state's icon import collapses. (kept here intentionally — used elsewhere.)
export const _kept = Inbox;
