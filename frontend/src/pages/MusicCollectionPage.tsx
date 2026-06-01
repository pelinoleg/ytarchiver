import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Music, Play, Shuffle, ArrowLeft, Trash2, Pencil, Check, X, MinusCircle, Loader2,
} from "lucide-react";
import { musicCollectionsApi, thumbUrl, type Video } from "../lib/api";
import { formatDuration, formatUploadDate } from "../lib/format";
import { setMusicQueue, shuffleArray, getMusicShuffle, setMusicShuffle } from "../lib/queue";

export function MusicCollectionPage() {
  const { id } = useParams<{ id: string }>();
  const collectionId = Number(id);
  const nav = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["music", "collection", collectionId],
    queryFn: () => musicCollectionsApi.get(collectionId),
    enabled: Number.isFinite(collectionId),
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const rename = useMutation({
    mutationFn: (name: string) => musicCollectionsApi.rename(collectionId, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["music", "collection", collectionId] });
      qc.invalidateQueries({ queryKey: ["music", "collections"] });
      setEditing(false);
    },
  });

  const remove = useMutation({
    mutationFn: () => musicCollectionsApi.remove(collectionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["music", "collections"] });
      nav("/music");
    },
  });

  if (isLoading || !data) {
    return <p className="text-sm text-zinc-400">Загрузка…</p>;
  }

  const { collection, videos } = data;
  const playableIds = videos.filter((v) => v.status === "done").map((v) => v.video_id);

  function play(shuffled: boolean) {
    if (!playableIds.length) return;
    const ordered = shuffled ? shuffleArray(playableIds) : playableIds;
    setMusicQueue(ordered, shuffled);
    const params = new URLSearchParams({ source: "music" });
    if (shuffled) params.set("shuffle", "1");
    nav(`/watch/${ordered[0]}?${params.toString()}`);
  }

  return (
    <div>
      <Link to="/music" className="mb-4 inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100">
        <ArrowLeft className="h-4 w-4" /> Музыка
      </Link>

      <header className="mb-6 flex flex-wrap items-center gap-4">
        <CollectionCover videos={videos} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fuchsia-300/80">Плейлист</p>
          {editing ? (
            <form
              onSubmit={(e) => { e.preventDefault(); if (draft.trim()) rename.mutate(draft.trim()); }}
              className="mt-1 flex items-center gap-2"
            >
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-lg font-semibold outline-none focus:border-fuchsia-500"
              />
              <button type="submit" disabled={rename.isPending} className="grid h-8 w-8 place-items-center rounded-lg bg-fuchsia-500 text-white hover:bg-fuchsia-400 disabled:opacity-50">
                <Check className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setEditing(false)} className="grid h-8 w-8 place-items-center rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
                <X className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <div className="mt-0.5 flex items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-white">{collection.name}</h1>
              <button
                type="button"
                onClick={() => { setDraft(collection.name); setEditing(true); }}
                className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                title="Переименовать"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <p className="mt-1 text-xs text-zinc-500">
            {collection.done_count} {collection.done_count === 1 ? "трек" : "треков"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {playableIds.length > 0 && (
            <>
              <button
                onClick={() => play(getMusicShuffle())}
                className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia-500 px-4 py-2 text-sm font-bold text-white shadow-sm shadow-fuchsia-500/30 hover:bg-fuchsia-400"
              >
                <Play className="h-4 w-4 fill-current" /> Play
              </button>
              <button
                onClick={() => { setMusicShuffle(true); play(true); }}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 hover:bg-white/20"
              >
                <Shuffle className="h-4 w-4" /> Shuffle
              </button>
            </>
          )}
          <button
            onClick={() => { if (confirm(`Удалить плейлист «${collection.name}»? Треки останутся в музыке.`)) remove.mutate(); }}
            disabled={remove.isPending}
            className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 hover:bg-red-500/15 hover:text-red-300 disabled:opacity-50"
            title="Удалить плейлист"
          >
            {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {videos.length === 0 ? (
        <div className="rounded-2xl bg-zinc-900 px-4 py-16 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-fuchsia-500/15 ring-1 ring-fuchsia-500/30">
            <Music className="h-6 w-6 text-fuchsia-300" />
          </div>
          <p className="mt-4 text-sm text-zinc-400">
            Пусто. Добавляй треки из раздела «Музыка» — в меню «…» на карточке выбери «В плейлист».
          </p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {videos.map((t, idx) => (
            <CollectionTrackCard
              key={t.id}
              track={t}
              collectionId={collectionId}
              onPlay={() => {
                const ordered = [...playableIds.slice(playableIds.indexOf(t.video_id)), ...playableIds.slice(0, playableIds.indexOf(t.video_id))];
                setMusicQueue(ordered.length ? ordered : [t.video_id], false);
                nav(`/watch/${t.video_id}?source=music`);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionCover({ videos }: { videos: Video[] }) {
  const covers = videos
    .filter((t) => t.thumbnail_path || t.thumbnail_url)
    .slice(0, 4);
  return (
    <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl bg-zinc-900 shadow-md shadow-black/30">
      {covers.length > 0 ? (
        <div className="grid h-full w-full grid-cols-2 grid-rows-2">
          {covers.map((t) => (
            <img
              key={t.id}
              src={t.thumbnail_path ? thumbUrl(t.video_id) : t.thumbnail_url!}
              referrerPolicy="no-referrer"
              alt=""
              className="h-full w-full object-cover"
            />
          ))}
          {covers.length < 4 && Array.from({ length: 4 - covers.length }).map((_, i) => (
            <div key={i} className="bg-gradient-to-br from-fuchsia-700/30 via-purple-900/25 to-zinc-900" />
          ))}
        </div>
      ) : (
        <div className="grid h-full w-full place-items-center bg-gradient-to-br from-fuchsia-700/30 via-purple-900/25 to-zinc-900">
          <Music className="h-7 w-7 text-fuchsia-300/70" />
        </div>
      )}
    </div>
  );
}

function CollectionTrackCard({
  track: t, collectionId, onPlay,
}: { track: Video; collectionId: number; onPlay: () => void }) {
  const qc = useQueryClient();
  const thumb = t.thumbnail_path ? thumbUrl(t.video_id) : t.thumbnail_url;
  const removeVideo = useMutation({
    mutationFn: () => musicCollectionsApi.removeVideo(collectionId, t.video_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["music", "collection", collectionId] });
      qc.invalidateQueries({ queryKey: ["music", "collections"] });
    },
  });

  return (
    <div className="group relative block min-w-0">
      <button onClick={onPlay} className="block w-full min-w-0 text-left" aria-label={`Play ${t.title}`}>
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
            <span className="grid h-12 w-12 place-items-center rounded-full bg-fuchsia-500/0 text-white opacity-0 transition-all group-hover:bg-fuchsia-500/90 group-hover:opacity-100">
              <Play className="h-6 w-6 fill-current" />
            </span>
          </div>
          {t.duration && (
            <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1.5 py-0.5 text-xs font-medium text-white">
              {formatDuration(t.duration)}
            </span>
          )}
        </div>
        <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-zinc-100 break-words">{t.title}</h3>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {t.channel_name}
          {t.upload_date && <> · {formatUploadDate(t.upload_date, t.downloaded_at, t.upload_timestamp)}</>}
        </p>
      </button>

      <button
        onClick={() => removeVideo.mutate()}
        disabled={removeVideo.isPending}
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-red-500/80 group-hover:opacity-100 disabled:opacity-40"
        title="Убрать из плейлиста"
      >
        {removeVideo.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MinusCircle className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
