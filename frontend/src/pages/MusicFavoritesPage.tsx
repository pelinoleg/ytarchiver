import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Star, Music, Play, Shuffle } from "lucide-react";
import { musicApi, thumbUrl, type Video } from "../lib/api";
import { formatDuration } from "../lib/format";
import { setMusicQueue, shuffleArray } from "../lib/queue";

/** Standalone "Liked songs" view. The Music page also surfaces favorites
 *  as a playlist card at the top, but this page is a dedicated landing
 *  spot used by the bottom-nav tab — one tap from any screen straight to
 *  the user's starred tracks.
 *
 *  Implementation note: reuses the cached ``["music", "tracks"]`` query
 *  populated by MusicPage and the side panels, so navigating here from
 *  Music is instant. */
export function MusicFavoritesPage() {
  const nav = useNavigate();
  const { data: tracks = [], isLoading } = useQuery({
    queryKey: ["music", "tracks"],
    queryFn:  () => musicApi.tracks(500),
    staleTime: 60_000,
  });
  const favorites = tracks.filter((t) => t.is_favorite);

  function playAll(shuffled: boolean) {
    if (favorites.length === 0) return;
    const ids = favorites.map((t) => t.video_id);
    const ordered = shuffled ? shuffleArray(ids) : ids;
    setMusicQueue(ordered, shuffled);
    const qs = new URLSearchParams({ source: "music" });
    if (shuffled) qs.set("shuffle", "1");
    nav(`/watch/${ordered[0]}?${qs.toString()}`);
  }

  return (
    <>
      <header
        className="relative mb-5 overflow-hidden rounded-2xl ring-1 ring-yellow-500/20"
        style={{ background: "linear-gradient(155deg, rgb(133 77 14 / 0.35), rgb(24 24 27 / 0.95))" }}
      >
        <div className="relative flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-yellow-400/20 ring-1 ring-yellow-300/30">
              <Star className="h-5 w-5 text-yellow-200 fill-current" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg sm:text-xl font-semibold tracking-tight text-white">
                Liked songs
              </h1>
              <p className="mt-0.5 truncate text-xs text-zinc-300/90">
                <span className="font-semibold tabular-nums text-white">{favorites.length}</span>
                {" "}{favorites.length === 1 ? "track" : "tracks"}
              </p>
            </div>
          </div>
          {favorites.length > 0 && (
            <div className="flex flex-shrink-0 gap-1.5">
              <button
                onClick={() => playAll(false)}
                className="flex items-center gap-1.5 rounded-full bg-yellow-400 px-3.5 py-1.5 text-xs font-bold text-yellow-950 shadow hover:bg-yellow-300 active:bg-yellow-200"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                Play all
              </button>
              <button
                onClick={() => playAll(true)}
                className="flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur-sm px-3.5 py-1.5 text-xs font-semibold text-white ring-1 ring-white/15 hover:bg-white/25"
              >
                <Shuffle className="h-3.5 w-3.5" />
                Shuffle
              </button>
            </div>
          )}
        </div>
      </header>

      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : favorites.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-6">
          {favorites.map((t, idx) => {
            const ids = favorites.map((x) => x.video_id);
            return (
              <FavTrackCard
                key={t.id}
                track={t}
                onPlay={() => {
                  const ordered = [...ids.slice(idx), ...ids.slice(0, idx)];
                  setMusicQueue(ordered, false);
                  nav(`/watch/${t.video_id}?source=music`);
                }}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

function FavTrackCard({ track: t, onPlay }: { track: Video; onPlay: () => void }) {
  const thumb = t.thumbnail_path ? thumbUrl(t.video_id) : t.thumbnail_url;
  return (
    <button onClick={onPlay} className="group block min-w-0 text-left">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-zinc-900">
        {thumb && (
          <img
            src={thumb}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        )}
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/40">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-yellow-400/0 text-white opacity-0 transition-all group-hover:bg-yellow-400/95 group-hover:text-yellow-950 group-hover:opacity-100 group-hover:scale-100 scale-90 shadow-lg">
            <Play className="h-6 w-6 fill-current" />
          </span>
        </div>
        {t.duration && (
          <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1.5 py-0.5 text-xs font-medium text-white">
            {formatDuration(t.duration)}
          </span>
        )}
        <span className="absolute top-1 left-1 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-yellow-300">
          <Star className="h-3.5 w-3.5 fill-current" />
        </span>
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-zinc-100 break-words">
        {t.title}
      </h3>
      <p className="mt-0.5 truncate text-xs text-zinc-500">{t.channel_name}</p>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-yellow-400/15 ring-1 ring-yellow-400/30">
        <Star className="h-7 w-7 text-yellow-300 fill-current" />
      </div>
      <h3 className="mt-5 text-lg font-semibold text-zinc-100">No liked songs yet</h3>
      <p className="mt-2 max-w-md text-sm text-zinc-400 leading-relaxed">
        Открой любую песню в{" "}
        <Link to="/music" className="inline-flex items-center gap-1 text-fuchsia-300 hover:text-fuchsia-200">
          <Music className="h-3.5 w-3.5" /> Music
        </Link>{" "}и тапни звезду — трек попадёт сюда.
      </p>
    </div>
  );
}
