import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Music, Play, Shuffle, ListMusic, Search, Inbox, Star, Tv,
  Infinity as InfinityIcon, MoreVertical, MinusCircle,
  Plus, Check, ArrowDownUp, ArrowUp, ArrowDown, Loader2, CheckCircle2,
} from "lucide-react";
import { useRef, useState, useEffect } from "react";
import {
  musicApi, musicCollectionsApi, playlistsApi, videosApi, thumbUrl, previewUrl,
  type MusicCollection, type Playlist, type Video, type Channel,
} from "../lib/api";
import { AddToPlaylistList } from "../components/AddToPlaylistButton";
import { useSelection } from "../components/SelectionProvider";
import { formatBytes, formatDuration, formatUploadDate } from "../lib/format";
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

type SortField = "added" | "published" | "title" | "duration";
type SortDir = "asc" | "desc";

const SORT_FIELDS: { key: SortField; label: string }[] = [
  { key: "added",     label: "Дата добавления" },
  { key: "published", label: "Дата публикации" },
  { key: "title",     label: "Название" },
  { key: "duration",  label: "Длительность" },
];

export function MusicPage() {
  // Sort field + direction persist per device (localStorage). Default: newest
  // added first. Sorting is server-side, so it's global across the library.
  const [sortField, setSortField] = useState<SortField>(
    () => ((typeof localStorage !== "undefined" && localStorage.getItem("music.sortField")) as SortField) || "added",
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    () => ((typeof localStorage !== "undefined" && localStorage.getItem("music.sortDir")) as SortDir) || "desc",
  );
  useEffect(() => { localStorage.setItem("music.sortField", sortField); }, [sortField]);
  useEffect(() => { localStorage.setItem("music.sortDir", sortDir); }, [sortDir]);

  // Display rows — server-sorted, keyed by sort so changing it refetches in the
  // right global order.
  const { data: tracks = [], isLoading: tracksLoading } = useQuery({
    queryKey: ["music", "tracks", sortField, sortDir],
    queryFn:  () => musicApi.tracks({ sort: sortField, dir: sortDir }),
  });
  // The COMPLETE ordered id list (lightweight) — powers global Play-all /
  // Shuffle / click-to-play so the queue is the whole library, not just the
  // loaded rows. Same sort as the display.
  const { data: orderedIdsData } = useQuery({
    queryKey: ["music", "track-ids", sortField, sortDir],
    queryFn:  () => musicApi.trackIds(sortField, sortDir),
  });
  const orderedIds = orderedIdsData?.video_ids ?? [];
  const { data: stats } = useQuery({ queryKey: ["music", "stats"], queryFn: musicApi.stats });

  const { data: playlists = [], isLoading: playlistsLoading } = useQuery({
    queryKey: ["music", "playlists"],
    queryFn:  musicApi.playlists,
  });
  const { data: collections = [], isLoading: collectionsLoading } = useQuery({
    queryKey: ["music", "collections"],
    queryFn:  musicCollectionsApi.list,
  });
  const { data: musicChannels = [] } = useQuery({
    queryKey: ["music", "channels"],
    queryFn:  musicApi.channels,
  });

  // Favorites — separate from the global Favorites page, which deliberately
  // hides music. Lives in its own section so the user has one obvious target
  // for "stuff I like and want to find quickly".
  const favorites = tracks.filter((t) => t.is_favorite);

  const nav = useNavigate();
  const totalTracks = stats?.tracks ?? tracks.length;
  const isEmpty = !tracksLoading && !playlistsLoading && !collectionsLoading
    && tracks.length === 0 && playlists.length === 0 && collections.length === 0;

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
  // Playlist / channel posters follow the same density slider as the videos.
  const posterGridStyle = { "--card-min": `${cardMinRaw}px` } as CSSProperties;

  // Build + start a music queue from the GLOBAL ordered id list. ``startId``
  // rotates the queue to begin there; falls back to the loaded rows if the id
  // list hasn't arrived yet.
  function startQueue(opts: { startId?: string; shuffled: boolean }) {
    const base = orderedIds.length ? orderedIds : tracks.map((t) => t.video_id);
    if (!base.length) return;
    let queue: string[];
    if (opts.shuffled) {
      queue = shuffleArray(base);
    } else if (opts.startId) {
      const i = base.indexOf(opts.startId);
      queue = i > 0 ? [...base.slice(i), ...base.slice(0, i)] : base;
    } else {
      queue = base;
    }
    setMusicQueue(queue, opts.shuffled);
    nav(`/watch/${queue[0]}?source=music${opts.shuffled ? "&shuffle=1" : ""}`);
  }

  return (
    <>
      {/* Hero — Apple-Music-style: 2×2 mosaic of recent track covers,
          blurred and tinted, big frosted-glass card on top. Falls back to
          a pure gradient when there's nothing in the library yet. */}
      <MusicHero
        tracks={tracks}
        trackCount={totalTracks}
        playlistsCount={playlists.length}
        // "Play all" honours the remembered shuffle mode; "Shuffle" forces it
        // on and remembers that globally. Both run over the GLOBAL ordered ids.
        onPlayAll={() => startQueue({ shuffled: getMusicShuffle() })}
        onShuffle={() => { setMusicShuffle(true); startQueue({ shuffled: true }); }}
      />

      {isEmpty ? (
        <EmptyState />
      ) : (
        <div className="space-y-10">
          {(playlists.length > 0 || favorites.length > 0 || collections.length > 0) && (
            <section>
              <SectionHeader
                icon={ListMusic} title="Playlists"
                count={playlists.length + collections.length + (favorites.length > 0 ? 1 : 0)}
                action={<NewPlaylistButton />}
              />
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:[grid-template-columns:repeat(auto-fill,minmax(var(--card-min),1fr))]" style={posterGridStyle}>
                {/* User-curated local playlists + YouTube music playlists load
                 *  fast. The Liked card depends on the heavy tracks query, so it
                 *  renders LAST — that way it appends at the end of the row when
                 *  it arrives instead of being inserted at the front and shoving
                 *  everything already on screen. */}
                {collections.map((c) => <CollectionCard key={`c-${c.id}`} collection={c} />)}
                {playlists.map((p) => <MusicPlaylistCard key={p.id} playlist={p} />)}
                {favorites.length > 0 && (
                  <FavoritesPlaylistCard tracks={favorites} />
                )}
              </div>
            </section>
          )}

          {/* Music channels — their own row, marked as channels, not playlists. */}
          {musicChannels.length > 0 && (
            <section>
              <SectionHeader icon={Tv} title="Channels" count={musicChannels.length} />
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:[grid-template-columns:repeat(auto-fill,minmax(var(--card-min),1fr))]" style={posterGridStyle}>
                {musicChannels.map((c) => <MusicChannelCard key={c.id} channel={c} />)}
              </div>
            </section>
          )}

          {tracks.length > 0 && (
            <section>
              <div className="mb-4 flex items-center justify-between gap-3">
                <SectionHeader icon={Music} title="Tracks" count={totalTracks} noMargin />
                <SortMenu
                  field={sortField} dir={sortDir}
                  onField={setSortField} onDir={setSortDir}
                />
              </div>
              {tracks.length > VIRTUALIZE_THRESHOLD ? (
                <VirtualVideoGrid
                  // Key on the sort so the virtualizer rebuilds rows on re-sort.
                  key={`${sortField}-${sortDir}`}
                  items={tracks}
                  breakpoints={trackBreakpoints}
                  minCardWidth={trackCardMin}
                  textBelow={78}
                  rowPad={16}
                  renderItem={(t) => (
                    <MusicTrackCard
                      track={t}
                      onPlay={() => startQueue({ startId: t.video_id, shuffled: false })}
                    />
                  )}
                />
              ) : (
                <div
                  style={trackGridStyle}
                  className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:[grid-template-columns:repeat(auto-fill,minmax(var(--card-min),1fr))]"
                >
                  {tracks.map((t) => (
                    <MusicTrackCard
                      key={t.id}
                      track={t}
                      onPlay={() => startQueue({ startId: t.video_id, shuffled: false })}
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
  icon: Icon, title, count, tone = "fuchsia", noMargin = false, action,
}: {
  icon: typeof Music; title: string; count: number;
  tone?: "fuchsia" | "amber";
  noMargin?: boolean;
  action?: React.ReactNode;
}) {
  const chip = tone === "amber"
    ? "bg-yellow-400/15 text-yellow-300"
    : "bg-fuchsia-500/15 text-fuchsia-300";
  const countChip = tone === "amber"
    ? "bg-yellow-400/12 text-yellow-300"
    : "bg-fuchsia-500/12 text-fuchsia-300";
  return (
    <div className={`flex items-center gap-2.5 ${noMargin ? "" : "mb-4"}`}>
      <span className={`grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg ${chip}`}>
        <Icon className="h-4 w-4" />
      </span>
      <h2 className="text-lg font-semibold tracking-tight text-zinc-100">{title}</h2>
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${countChip}`}>{count}</span>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sort menu — native select keeps it accessible and avoids extra popover
// plumbing. Sorting is client-side over the already-fetched track list.

function SortMenu({
  field, dir, onField, onDir,
}: {
  field: SortField; dir: SortDir;
  onField: (f: SortField) => void; onDir: (d: SortDir) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <ArrowDownUp className="h-4 w-4 text-zinc-500" />
      <select
        value={field}
        onChange={(e) => onField(e.target.value as SortField)}
        className="rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-600"
        aria-label="Сортировка"
      >
        {SORT_FIELDS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      <button
        type="button"
        onClick={() => onDir(dir === "asc" ? "desc" : "asc")}
        className="grid h-8 w-8 place-items-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-white"
        title={dir === "asc" ? "По возрастанию — нажми для убывания" : "По убыванию — нажми для возрастания"}
        aria-label="Направление сортировки"
      >
        {dir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Local playlist (collection) card — user-curated, lives next to the YouTube
// music playlists but tagged LOCAL and links to its own detail page.

function CollectionCard({ collection: c }: { collection: MusicCollection }) {
  const nav = useNavigate();
  const { refetch } = useQuery({
    queryKey: ["music", "collection", c.id],
    queryFn: () => musicCollectionsApi.get(c.id),
    enabled: false,
  });

  async function play(shuffled: boolean) {
    const res = await refetch();
    const ids = (res.data?.videos ?? [])
      .filter((v) => v.status === "done")
      .map((v) => v.video_id);
    if (!ids.length) return;
    const ordered = shuffled ? shuffleArray(ids) : ids;
    setMusicQueue(ordered, shuffled);
    const params = new URLSearchParams({ source: "music" });
    if (shuffled) params.set("shuffle", "1");
    nav(`/watch/${ordered[0]}?${params.toString()}`);
  }

  return (
    <div className="group block min-w-0">
      <PlaylistStack accent="bg-fuchsia-500/35" accentSoft="bg-fuchsia-500/15">
        <Link
          to={`/music/collection/${c.id}`}
          className="relative block aspect-[3/4] overflow-hidden rounded-xl bg-zinc-900 shadow-md shadow-black/30 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:ring-1 group-hover:ring-fuchsia-400/50 group-hover:shadow-xl group-hover:shadow-fuchsia-900/40"
        >
          {c.covers.length > 0 ? (
            <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px bg-zinc-950">
              {c.covers.map((cov) => (
                <img
                  key={cov.video_id}
                  src={cov.thumbnail_path ? thumbUrl(cov.video_id) : cov.thumbnail_url!}
                  referrerPolicy="no-referrer"
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />
              ))}
              {c.covers.length < 4 && Array.from({ length: 4 - c.covers.length }).map((_, i) => (
                <div key={i} className="bg-gradient-to-br from-fuchsia-700/30 via-purple-900/25 to-zinc-900" />
              ))}
            </div>
          ) : (
            <div className="grid h-full w-full place-items-center bg-gradient-to-br from-fuchsia-700/30 via-purple-900/25 to-zinc-900">
              <ListMusic className="h-10 w-10 text-fuchsia-300/70" />
            </div>
          )}

          {/* Poster gradient — strong at the foot so the title reads on it. */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/92 via-black/45 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-white/10 to-transparent opacity-60" />
          <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-fuchsia-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow ring-1 ring-white/20 backdrop-blur-sm">
            <ListMusic className="h-3 w-3" />
            Local
          </span>
          <span className="absolute top-1.5 right-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white ring-1 ring-white/10 backdrop-blur-md">
            {c.done_count}
          </span>
        </Link>

        {/* Bottom bar overlaid on the poster: name + count on the left,
         *  play/shuffle on the right. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-2 p-2.5 pt-10">
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]" title={c.name}>
              {c.name}
            </h3>
            <p className="mt-0.5 truncate text-[11px] text-zinc-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
              {c.done_count} {c.done_count === 1 ? "track" : "tracks"}
            </p>
          </div>
          {c.done_count > 0 && (
            <div className="pointer-events-auto flex flex-shrink-0 items-center gap-1.5 sm:opacity-0 sm:translate-y-1 sm:transition-all sm:duration-300 sm:group-hover:opacity-100 sm:group-hover:translate-y-0">
              <button
                onClick={(e) => { e.preventDefault(); setMusicShuffle(true); play(true); }}
                aria-label="Shuffle"
                title="Shuffle"
                className="grid h-8 w-8 place-items-center rounded-full bg-zinc-900/90 text-fuchsia-200 ring-1 ring-white/15 shadow-lg shadow-black/40 backdrop-blur-sm hover:bg-zinc-800 active:scale-95"
              >
                <Shuffle className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => { e.preventDefault(); play(getMusicShuffle()); }}
                aria-label="Play"
                title="Play"
                className="grid h-10 w-10 place-items-center rounded-full bg-fuchsia-500 text-white shadow-xl shadow-fuchsia-900/50 hover:bg-fuchsia-400 active:scale-95 transition-transform"
              >
                <Play className="h-5 w-5 fill-current translate-x-0.5" />
              </button>
            </div>
          )}
        </div>
      </PlaylistStack>
    </div>
  );
}

// "＋ Новый плейлист" — lives in the Playlists section header. Idle pill that
// flips into an inline name input; creating navigates to the fresh playlist.

function NewPlaylistButton() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: () => musicCollectionsApi.create(name.trim()),
    onSuccess: (col) => {
      qc.invalidateQueries({ queryKey: ["music", "collections"] });
      setName(""); setEditing(false);
      nav(`/music/collection/${col.id}`);
    },
  });

  if (editing) {
    return (
      <form
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
        className="flex items-center gap-1.5"
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { setEditing(false); setName(""); } }}
          onBlur={() => { if (!name.trim()) setEditing(false); }}
          placeholder="Название плейлиста…"
          className="w-44 rounded-lg border border-zinc-700 bg-zinc-950/80 px-2.5 py-1.5 text-sm outline-none focus:border-fuchsia-500"
        />
        <button
          type="submit"
          disabled={create.isPending || !name.trim()}
          className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-fuchsia-500 text-white hover:bg-fuchsia-400 disabled:opacity-50"
          aria-label="Создать"
        >
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia-500/15 px-3 py-1.5 text-sm font-medium text-fuchsia-200 ring-1 ring-fuchsia-400/30 transition-colors hover:bg-fuchsia-500/25 hover:text-fuchsia-100"
    >
      <Plus className="h-4 w-4" />
      Новый плейлист
    </button>
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
          className="relative block aspect-[3/4] w-full overflow-hidden rounded-xl bg-zinc-900 shadow-md shadow-black/30 text-left transition-all duration-300 group-hover:-translate-y-0.5 group-hover:ring-1 group-hover:ring-yellow-400/50 group-hover:shadow-xl group-hover:shadow-yellow-900/40"
          aria-label="Play favorites"
        >
          {covers.length > 0 ? (
            <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px bg-zinc-950">
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

          {/* Poster gradient — strong at the foot so the title reads on it. */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/92 via-black/45 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-white/10 to-transparent opacity-60" />

          {/* Top-left FAVORITES pill — strong identity, matches other cards. */}
          <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-yellow-400/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-950 shadow ring-1 ring-white/25 backdrop-blur-sm">
            <Star className="h-3 w-3 fill-current" />
            Liked
          </span>

          <span className="absolute top-1.5 right-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white ring-1 ring-white/10 backdrop-blur-md">
            {tracks.length}
          </span>

          {/* Title + count overlaid at the foot. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-2.5 pt-10">
            <h3 className="text-sm font-semibold leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
              Liked
            </h3>
            <p className="mt-0.5 text-[11px] text-zinc-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
              {tracks.length === 1 ? "1 track" : `${tracks.length} tracks`}
            </p>
          </div>
        </button>

        {/* FABs — bottom-right of the poster, above the title's right edge. */}
        <div className="pointer-events-none absolute right-2 bottom-2.5 flex items-center gap-1.5 sm:opacity-0 sm:translate-y-1 sm:transition-all sm:duration-300 sm:group-hover:opacity-100 sm:group-hover:translate-y-0">
          <button
            onClick={(e) => { e.preventDefault(); setMusicShuffle(true); play(true); }}
            aria-label="Shuffle favorites"
            title="Shuffle"
            className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full bg-zinc-900/90 text-yellow-200 ring-1 ring-white/15 shadow-lg shadow-black/40 backdrop-blur-sm hover:bg-zinc-800 active:scale-95"
          >
            <Shuffle className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => { e.preventDefault(); play(getMusicShuffle()); }}
            aria-label="Play favorites"
            title="Play"
            className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full bg-yellow-400 text-yellow-950 shadow-xl shadow-yellow-900/50 hover:bg-yellow-300 active:scale-95 transition-transform"
          >
            <Play className="h-5 w-5 fill-current translate-x-0.5" />
          </button>
        </div>
      </PlaylistStack>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero — visual + CTAs at the top of the page.

function MusicHero({
  tracks, trackCount, playlistsCount, onPlayAll, onShuffle,
}: {
  tracks: Video[];
  trackCount: number;
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
              <span className="font-semibold tabular-nums text-white">{trackCount}</span> tracks
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
              className="flex items-center gap-1.5 rounded-full bg-gradient-to-b from-fuchsia-400 to-fuchsia-500 px-3.5 py-1.5 text-xs font-bold text-fuchsia-950 shadow-sm shadow-fuchsia-500/30 hover:-translate-y-0.5 hover:shadow-md hover:shadow-fuchsia-500/40"
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
  // Only show the done/total progress WHILE something is still downloading.
  // Once the queue drains (even if some failed) just show the track count.
  const downloading = (p.active_count ?? 0) > 0;
  const countLabel = downloading ? `${done}/${total}` : `${total}`;

  return (
    <div className="group block min-w-0">
      <PlaylistStack accent="bg-fuchsia-500/35" accentSoft="bg-fuchsia-500/15">
        <Link
          to={`/playlist/${p.id}`}
          className="relative block aspect-[3/4] overflow-hidden rounded-xl bg-zinc-900 shadow-md shadow-black/30 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:ring-1 group-hover:ring-fuchsia-400/50 group-hover:shadow-xl group-hover:shadow-fuchsia-900/40"
        >
          {p.covers && p.covers.length > 0 ? (
            <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px bg-zinc-950">
              {p.covers.map((cov) => (
                <img
                  key={cov.video_id}
                  src={cov.thumbnail_path ? thumbUrl(cov.video_id) : cov.thumbnail_url!}
                  referrerPolicy="no-referrer"
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                />
              ))}
              {p.covers.length < 4 && Array.from({ length: 4 - p.covers.length }).map((_, i) => (
                <div key={i} className="bg-gradient-to-br from-fuchsia-700/30 via-purple-900/25 to-zinc-900" />
              ))}
            </div>
          ) : p.thumbnail_url ? (
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

          {/* Poster gradient — strong at the foot so the title reads on it. */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/92 via-black/45 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-white/10 to-transparent opacity-60" />

          {/* Top-left: explicit MUSIC pill so the card identity is obvious. */}
          <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-fuchsia-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow ring-1 ring-white/20 backdrop-blur-sm">
            {search ? <Search className="h-3 w-3" /> : <Music className="h-3 w-3" />}
            {search ? "Search" : "Music"}
          </span>

          {/* Top-right: count + keep-forever badge. */}
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
            {p.keep_videos_forever && (
              <span
                title="Videos in this playlist are never auto-deleted"
                className="grid h-5 w-5 place-items-center rounded-full bg-amber-400/95 text-amber-950 shadow ring-1 ring-white/25"
              >
                <InfinityIcon className="h-3 w-3" strokeWidth={3} />
              </span>
            )}
            <span className="rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white ring-1 ring-white/10 backdrop-blur-md">
              {countLabel}
            </span>
          </div>
        </Link>

        {/* Bottom bar overlaid on the poster: title + meta on the left, the
         *  play/shuffle controls on the right. pointer-events-none lets clicks
         *  on the text fall through to the cover Link; the FABs opt back in. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-2 p-2.5 pt-10">
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]" title={p.title}>
              {p.title}
            </h3>
            <p className="mt-0.5 truncate text-[11px] text-zinc-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
              {p.uploader && !search ? `${p.uploader} · ` : ""}
              {downloading ? `качается ${done}/${total}` : `${total} ${total === 1 ? "track" : "tracks"}`}
            </p>
          </div>
          <div className="pointer-events-auto flex flex-shrink-0 items-center gap-1.5 sm:opacity-0 sm:translate-y-1 sm:transition-all sm:duration-300 sm:group-hover:opacity-100 sm:group-hover:translate-y-0">
            <button
              onClick={(e) => { e.preventDefault(); setMusicShuffle(true); startPlaylist(true); }}
              aria-label="Shuffle play"
              title="Shuffle"
              className="grid h-8 w-8 place-items-center rounded-full bg-zinc-900/90 text-fuchsia-200 ring-1 ring-white/15 shadow-lg shadow-black/40 backdrop-blur-sm hover:bg-zinc-800 active:scale-95"
            >
              <Shuffle className="h-4 w-4" />
            </button>
            <button
              onClick={(e) => { e.preventDefault(); startPlaylist(getMusicShuffle()); }}
              aria-label="Play"
              title="Play"
              className="grid h-10 w-10 place-items-center rounded-full bg-fuchsia-500 text-white shadow-xl shadow-fuchsia-900/50 hover:bg-fuchsia-400 active:scale-95 transition-transform"
            >
              <Play className="h-5 w-5 fill-current translate-x-0.5" />
            </button>
          </div>
        </div>
      </PlaylistStack>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Music channel card — a subscribed channel flagged as music. Same poster as a
// playlist but sky-accented + a "Channel" pill so it reads as a channel, not a
// playlist. Links to the channel page; play/shuffle seeds the queue from its
// downloaded videos (all of a music channel's videos are music).

function MusicChannelCard({ channel: c }: { channel: Channel }) {
  const nav = useNavigate();
  const { refetch } = useQuery({
    queryKey: ["music", "channel-videos", c.id],
    queryFn: () => videosApi.list({ channel_id: c.id, status: "done", limit: 5000 }),
    enabled: false,
  });

  async function play(shuffled: boolean) {
    const res = await refetch();
    const ids = (res.data ?? []).filter((v) => v.status === "done").map((v) => v.video_id);
    if (!ids.length) return;
    const ordered = shuffled ? shuffleArray(ids) : ids;
    setMusicQueue(ordered, shuffled);
    const params = new URLSearchParams({ source: "music" });
    if (shuffled) params.set("shuffle", "1");
    nav(`/watch/${ordered[0]}?${params.toString()}`);
  }

  const count = c.video_count;

  return (
    <div className="group flex min-w-0 flex-col items-center text-center">
      {/* Round avatar — a channel has one identity image, so a circle reads as
       *  "channel", not a playlist/poster. */}
      <div className="relative aspect-square w-full">
        <Link
          to={`/channel/${c.id}`}
          className="block h-full w-full overflow-hidden rounded-full bg-zinc-900 shadow-md shadow-black/30 ring-1 ring-white/10 transition-all duration-300 group-hover:ring-sky-400/60 group-hover:shadow-xl group-hover:shadow-sky-900/40"
        >
          {c.thumbnail_url ? (
            <img
              src={c.thumbnail_url}
              alt=""
              referrerPolicy="no-referrer"
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="grid h-full w-full place-items-center bg-gradient-to-br from-sky-700/30 via-blue-900/25 to-zinc-900">
              <Tv className="h-1/3 w-1/3 text-sky-300/70" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 rounded-full bg-black/0 transition-colors duration-300 group-hover:bg-black/25" />
        </Link>

        {count > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5 sm:opacity-0 sm:translate-y-1 sm:transition-all sm:duration-300 sm:group-hover:opacity-100 sm:group-hover:translate-y-0">
            <button
              onClick={(e) => { e.preventDefault(); setMusicShuffle(true); play(true); }}
              aria-label="Shuffle" title="Shuffle"
              className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full bg-zinc-900/90 text-sky-200 ring-1 ring-white/15 shadow-lg shadow-black/40 backdrop-blur-sm hover:bg-zinc-800 active:scale-95"
            >
              <Shuffle className="h-4 w-4" />
            </button>
            <button
              onClick={(e) => { e.preventDefault(); play(getMusicShuffle()); }}
              aria-label="Play" title="Play"
              className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full bg-sky-500 text-white shadow-xl shadow-sky-900/50 hover:bg-sky-400 active:scale-95 transition-transform"
            >
              <Play className="h-5 w-5 fill-current translate-x-0.5" />
            </button>
          </div>
        )}
      </div>

      <Link to={`/channel/${c.id}`} className="mt-2.5 block w-full px-1">
        <h3 className="truncate text-sm font-semibold text-zinc-100 group-hover:text-white" title={c.name}>
          {c.name}
        </h3>
        <p className="mt-0.5 truncate text-[11px] text-zinc-500">
          <span className="font-medium text-sky-300">Channel</span> · {count} {count === 1 ? "track" : "tracks"}
        </p>
      </Link>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Track card — purpose-built music tile with hover-preview + a quick action
// menu to unmark the track (returns it to its normal home).

function MusicTrackCard({
  track: t, onPlay,
}: { track: Video; onPlay: () => void }) {
  const qc = useQueryClient();
  const thumb = t.thumbnail_path ? thumbUrl(t.video_id) : t.thumbnail_url;
  const [previewing, setPreviewing] = useState(false);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Multi-select — Cmd/Ctrl-click (desktop) or long-press (touch) toggles the
  // shared global selection; the SelectionBar then offers bulk actions.
  const { inSelectMode, isSelected, toggle } = useSelection();
  const selected = isSelected(t.id);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);

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
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }, []);

  function onEnter() {
    if (!t.has_preview || inSelectMode) return;
    if (enterTimer.current) clearTimeout(enterTimer.current);
    enterTimer.current = setTimeout(() => setPreviewing(true), PREVIEW_DELAY_MS);
  }
  function onLeave() {
    if (enterTimer.current) clearTimeout(enterTimer.current);
    setPreviewing(false);
  }
  // Long-press on touch enters select mode (desktop uses Cmd/Ctrl-click).
  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType !== "touch") return;
    pressTimer.current = setTimeout(() => {
      suppressClickRef.current = true;
      toggle(t);
      try { navigator.vibrate?.(20); } catch { /* unsupported */ }
    }, 450);
  }
  function cancelPress() {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  }

  function onCardClick(e: React.MouseEvent) {
    if (suppressClickRef.current) { e.preventDefault(); e.stopPropagation(); suppressClickRef.current = false; return; }
    // Cmd/Ctrl-click toggles selection even when not yet in select mode.
    if ((e.metaKey || e.ctrlKey) && !inSelectMode) { e.preventDefault(); e.stopPropagation(); toggle(t); return; }
    if (inSelectMode) { e.preventDefault(); e.stopPropagation(); toggle(t); return; }
    onPlay();
  }

  return (
    <div
      className="group relative block min-w-0"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onPointerDown={onPointerDown}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={cancelPress}
    >
      <button
        onClick={onCardClick}
        className="block w-full min-w-0 text-left"
        aria-label={inSelectMode ? `Select ${t.title}` : `Play ${t.title}`}
      >
        <div className={`relative aspect-video overflow-hidden rounded-xl bg-zinc-900 ${selected ? "ring-2 ring-sky-400" : ""}`}>
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
          {/* In-playlist badge — shows the video already lives in N local
              playlists. */}
          {(t.collection_ids?.length ?? 0) > 0 && (
            <span
              className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded bg-fuchsia-500/90 px-1.5 py-0.5 text-[10px] font-bold text-white shadow"
              title={`В плейлистах: ${t.collection_ids!.length}`}
            >
              <ListMusic className="h-3 w-3" />
              {t.collection_ids!.length}
            </span>
          )}

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

      {inSelectMode ? (
        <div className={`absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full ${
          selected ? "bg-sky-500 text-white" : "bg-black/70 text-zinc-300 ring-1 ring-zinc-500"
        }`}>
          {selected && <CheckCircle2 className="h-5 w-5" />}
        </div>
      ) : (
        <TrackMenu video={t} />
      )}
    </div>
  );
}

function TrackMenu({ video }: { video: Video }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSubOpen(false); }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unmark = useMutation({
    mutationFn: () => videosApi.update(video.video_id, { is_music: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["music"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
      // A previously-manual clip returns to Manual when unmarked.
      qc.invalidateQueries({ queryKey: ["manual"] });
    },
  });

  const favMut = useMutation({
    mutationFn: () => videosApi.update(video.video_id, { is_favorite: !video.is_favorite }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["music"] });
      qc.invalidateQueries({ queryKey: ["favorites"] });
    },
  });

  const inPlaylists = video.collection_ids?.length ?? 0;

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
        <div className="absolute right-0 mt-1 w-64 overflow-hidden rounded-xl ring-1 ring-white/10 bg-zinc-900 shadow-2xl z-20">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); favMut.mutate(); setOpen(false); }}
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-zinc-100 hover:bg-zinc-800"
          >
            <Star className={`h-4 w-4 ${video.is_favorite ? "fill-current text-yellow-300" : ""}`} />
            {video.is_favorite ? "Remove from favorites" : "Add to favorites"}
          </button>

          {/* Add to / remove from local playlists — shared toggle list with
              checkmarks + inline create (no system prompt). */}
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSubOpen((s) => !s); }}
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-zinc-100 hover:bg-zinc-800"
          >
            <ListMusic className={`h-4 w-4 ${inPlaylists > 0 ? "text-fuchsia-300" : ""}`} />
            В плейлист
            {inPlaylists > 0 && (
              <span className="ml-auto rounded-full bg-fuchsia-500/15 px-1.5 text-[10px] font-semibold tabular-nums text-fuchsia-300">
                {inPlaylists}
              </span>
            )}
          </button>
          {subOpen && (
            <div className="border-y border-white/5 bg-zinc-950/60">
              <AddToPlaylistList
                videoId={video.video_id}
                memberIds={video.collection_ids ?? []}
                onDone={() => { setOpen(false); setSubOpen(false); }}
              />
            </div>
          )}

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
