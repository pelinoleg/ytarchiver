import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ListMusic, RefreshCw, Trash2, Play, ExternalLink, ChevronDown, ChevronUp,
  Save, Loader2, Infinity as InfinityIcon, Music, Shuffle,
} from "lucide-react";
import {
  playlistsApi, settingsApi, thumbUrl,
  type Playlist, type Quality, type Video, type GlobalSettings,
} from "../lib/api";
import { formatBytes, formatDuration, timeAgo, describeQuality } from "../lib/format";
import { useLocalStorageBool } from "../hooks/useLocalStorageBool";
import { setPlaylistQueue, shuffleArray } from "../lib/queue";
import { useConfirm } from "../components/ConfirmProvider";

export function PlaylistPage() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const id = Number(playlistId);
  const qc = useQueryClient();
  const confirm = useConfirm();

  const { data: playlist } = useQuery({
    queryKey: ["playlist", id],
    queryFn: () => playlistsApi.get(id),
    enabled: !Number.isNaN(id),
  });

  const { data: videos = [], isLoading } = useQuery({
    queryKey: ["playlist", id, "videos"],
    queryFn: () => playlistsApi.videos(id),
    enabled: !Number.isNaN(id),
  });

  const { data: globals } = useQuery({
    queryKey: ["settings"],
    queryFn: settingsApi.get,
  });

  const syncMut = useMutation({
    mutationFn: () => playlistsApi.sync(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlist", id] });
      qc.invalidateQueries({ queryKey: ["playlist", id, "videos"] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => playlistsApi.unsubscribe(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      history.back();
    },
  });

  if (!playlist) {
    return <p className="text-sm text-zinc-400">Playlist not found.</p>;
  }

  const firstVideo = videos.find((v) => v.status === "done");

  const isSearch = playlist.url?.startsWith("ytsearch");
  const total    = playlist.video_count || playlist.item_count;
  const done     = playlist.done_count;
  const complete = total > 0 && done >= total;

  return (
    <>
      {/* Hero — blurred playlist cover as background + frosted-glass card. */}
      <header className="relative mb-6 overflow-hidden rounded-3xl shadow-lg shadow-black/40">
        <div className="absolute inset-0">
          {playlist.thumbnail_url ? (
            <img
              src={playlist.thumbnail_url}
              referrerPolicy="no-referrer"
              alt=""
              className="h-full w-full object-cover"
              style={{ transform: "scale(1.4)" }}
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-zinc-700 via-zinc-800 to-zinc-950" />
          )}
          <div className="absolute inset-0 backdrop-blur-2xl bg-zinc-950/60" />
          <div className="absolute inset-0 bg-gradient-to-br from-black/30 via-transparent to-zinc-950/85" />
        </div>

        <div className="relative grid grid-cols-1 sm:grid-cols-[10rem_minmax(0,1fr)] gap-5 sm:gap-6 p-5 sm:p-7">
          {/* Cover */}
          <div className="aspect-[5/3] sm:aspect-[5/3] sm:h-auto w-32 sm:w-40 overflow-hidden rounded-xl bg-zinc-800 shadow-lg shadow-black/40 ring-1 ring-white/10">
            {playlist.thumbnail_url ? (
              <img src={playlist.thumbnail_url} alt="" referrerPolicy="no-referrer"
                   className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center">
                {isSearch ? <ListMusic className="h-10 w-10 text-zinc-500" />
                          : <ListMusic className="h-10 w-10 text-zinc-500" />}
              </div>
            )}
          </div>

          {/* Meta + actions */}
          <div className="min-w-0 flex flex-col">
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-300/80">
              {isSearch ? "Search collection" : "Playlist"}
              {playlist.is_music && <span className="ml-2 text-fuchsia-300">· Music</span>}
              {playlist.keep_videos_forever && <span className="ml-2 text-amber-300">· Keep forever</span>}
            </div>
            <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight break-words text-white drop-shadow-sm">
              {playlist.title}
              {playlist.url && !isSearch && (
                <a
                  href={playlist.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open on YouTube"
                  className="ml-2 inline-flex translate-y-[-3px] rounded-full p-1.5 text-zinc-300/70 hover:bg-white/10 hover:text-white align-middle"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </h1>

            <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-sm text-zinc-200/90">
              {playlist.uploader && !isSearch && (
                <>
                  <span className="font-medium text-white">{playlist.uploader}</span>
                  <span className="text-zinc-500">·</span>
                </>
              )}
              <span>
                <span className={`font-bold tabular-nums ${complete ? "text-emerald-300" : "text-white"}`}>
                  {done}
                </span>
                <span className="text-zinc-400"> / {total} downloaded</span>
              </span>
              <span className="text-zinc-500">·</span>
              <span className="text-zinc-300">synced {timeAgo(playlist.last_synced)}</span>
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {firstVideo && (
                <Link
                  to={`/watch/${firstVideo.video_id}?playlist=${id}`}
                  className="flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-bold text-zinc-950 hover:bg-zinc-100 shadow-md shadow-black/30"
                >
                  <Play className="h-4 w-4 fill-current" />
                  Play all
                </Link>
              )}
              {firstVideo && (
                <ShufflePlayButton videos={videos} playlistId={id} />
              )}
              <button
                onClick={() => syncMut.mutate()}
                disabled={syncMut.isPending}
                className="flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-sm px-4 py-2 text-sm font-medium text-white ring-1 ring-white/15 hover:bg-white/20 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${syncMut.isPending ? "animate-spin" : ""}`} />
                Sync
              </button>
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: `Unsubscribe from "${playlist.title}"?`,
                    body: "Сам плейлист удалится. Видео останутся на диске, если они есть в других подписках или плейлистах.",
                    confirmLabel: "Unsubscribe",
                    destructive: true,
                  });
                  if (ok) deleteMut.mutate();
                }}
                className="ml-auto flex items-center gap-2 rounded-full bg-red-500/15 backdrop-blur-sm px-4 py-2 text-sm font-medium text-red-200 ring-1 ring-red-500/30 hover:bg-red-500/25"
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">Unsubscribe</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <PlaylistSettings playlist={playlist} globals={globals} />

      {/* Tracklist — compact, Spotify-style: no per-row chrome, hover bg
          only, right-aligned duration. */}
      {isLoading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : videos.length === 0 ? (
        <p className="rounded-xl bg-zinc-900 px-4 py-8 text-center text-sm text-zinc-500">
          Empty playlist. Try <span className="text-zinc-300">Sync</span>.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-zinc-900/40">
          {/* Header strip */}
          <div className="hidden sm:grid grid-cols-[2rem_3.5rem_minmax(0,1fr)_5rem] gap-3 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 border-b border-zinc-800/60">
            <span className="text-right">#</span>
            <span></span>
            <span>Title</span>
            <span className="text-right">Time</span>
          </div>
          {videos.map((v, i) => (
            <PlaylistRow key={v.id} v={v} position={i + 1} playlistId={id} />
          ))}
        </div>
      )}
    </>
  );
}

function PlaylistRow({
  v, position, playlistId,
}: { v: Video; position: number; playlistId: number }) {
  const thumb = v.thumbnail_path ? thumbUrl(v.video_id) : v.thumbnail_url;
  const watchable = v.status === "done";
  const status = v.status;

  // Status text for non-ready videos — kept terse, the row is compact.
  const statusText =
    status === "downloading" ? `Downloading ${v.progress ?? ""}` :
    status === "error"       ? `Failed: ${v.error_message?.slice(0, 60) ?? "unknown"}` :
    status === "pending"     ? "Pending" :
    null;

  return (
    <Link
      to={watchable ? `/watch/${v.video_id}?playlist=${playlistId}` : `/watch/${v.video_id}`}
      className={`group grid grid-cols-[2rem_3.5rem_minmax(0,1fr)_5rem] gap-3 items-center px-3 py-1.5 sm:py-2 transition-colors ${
        watchable ? "hover:bg-zinc-800/60" : "opacity-60"
      } border-b border-zinc-800/40 last:border-0`}
    >
      {/* Position */}
      <span className="text-right text-sm font-mono tabular-nums text-zinc-500 group-hover:text-zinc-300">
        {position}
      </span>

      {/* Thumbnail */}
      <div className="relative aspect-video w-14 flex-shrink-0 overflow-hidden rounded bg-zinc-800">
        {thumb && (
          <img src={thumb} alt="" referrerPolicy="no-referrer" loading="lazy"
               className="h-full w-full object-cover" />
        )}
      </div>

      {/* Title + sub */}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-zinc-100" title={v.title}>{v.title}</p>
        <p className="mt-0.5 truncate text-[11px] text-zinc-500">
          {v.channel_name}
          {v.file_size_bytes && watchable ? ` · ${formatBytes(v.file_size_bytes, true)}` : ""}
          {statusText && (
            <span className={status === "error" ? "text-red-400" : "text-amber-400"}>
              {v.channel_name ? " · " : ""}{statusText}
            </span>
          )}
        </p>
      </div>

      {/* Duration */}
      <span className="text-right text-xs tabular-nums text-zinc-400 group-hover:text-zinc-200">
        {v.duration ? formatDuration(v.duration) : "—"}
      </span>
    </Link>
  );
}

function ShufflePlayButton({
  videos, playlistId,
}: { videos: Video[]; playlistId: number }) {
  const nav = useNavigate();
  function go() {
    const ids = videos.filter((v) => v.status === "done").map((v) => v.video_id);
    if (!ids.length) return;
    const shuffled = shuffleArray(ids);
    setPlaylistQueue(playlistId, shuffled, true);
    nav(`/watch/${shuffled[0]}?playlist=${playlistId}&shuffle=1`);
  }
  return (
    <button
      onClick={go}
      className="flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-sm px-4 py-2 text-sm font-medium text-white ring-1 ring-white/15 hover:bg-white/20"
    >
      <Shuffle className="h-4 w-4" />
      Shuffle
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings — quality, "keep videos forever", and "music" toggles.

function PlaylistSettings({
  playlist, globals,
}: { playlist: Playlist; globals: GlobalSettings | undefined }) {
  const qc = useQueryClient();
  const [open, setOpen] = useLocalStorageBool("playlist.settings.open", false);

  const [quality,   setQuality]   = useState<Quality | "">((playlist.quality as Quality) ?? "");
  const [keep,      setKeep]      = useState<boolean>(playlist.keep_videos_forever);
  const [isMusic,   setIsMusic]   = useState<boolean>(playlist.is_music);

  useEffect(() => setQuality((playlist.quality as Quality) ?? ""),  [playlist.quality]);
  useEffect(() => setKeep(playlist.keep_videos_forever),            [playlist.keep_videos_forever]);
  useEffect(() => setIsMusic(playlist.is_music),                    [playlist.is_music]);

  const mut = useMutation({
    mutationFn: () => playlistsApi.update(playlist.id, {
      quality: quality === "" ? null : (quality as Quality),
      keep_videos_forever: keep,
      is_music: isMusic,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlist", playlist.id] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["music"] });
    },
  });

  const dirty =
       (quality || null) !== (playlist.quality ?? null)
    || keep !== playlist.keep_videos_forever
    || isMusic !== playlist.is_music;

  return (
    <section className="mb-6 overflow-hidden rounded-2xl bg-zinc-900">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 sm:px-5"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-semibold">Settings</span>
          {!open && (
            <span className="truncate text-xs text-zinc-500">
              {describeQuality(playlist.quality, globals?.default_quality)}
              {playlist.keep_videos_forever && (
                <span className="ml-2 text-amber-400">· keep forever</span>
              )}
              {playlist.is_music && (
                <span className="ml-2 text-fuchsia-400">· music</span>
              )}
            </span>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
      </button>

      {open && (
        <div className="border-t border-zinc-800">
          <div className="divide-y divide-zinc-800">
            <SettingRow label="Quality" hint="Качество новых загрузок в этом плейлисте.">
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as Quality | "")}
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-zinc-600"
              >
                <option value="">
                  Inherit global
                  {globals ? ` (${describeQuality(globals.default_quality)})` : ""}
                </option>
                <option value="best">Best available</option>
                <option value="1080">1080p</option>
                <option value="720">720p</option>
                <option value="480">480p</option>
                <option value="360">360p</option>
              </select>
            </SettingRow>

            <SettingRow
              label="Никогда не удалять"
              hint="Видео из этого плейлиста защищены от автоочистки — ни retention, ни «удалять после X% просмотра» их не трогают. Перебивает любые правила канала."
            >
              <ToggleSwitch
                checked={keep}
                onChange={setKeep}
                onLabel="Защищены навсегда"
                offLabel="Удаляются по общим правилам"
                tone="amber"
              />
            </SettingRow>

            <SettingRow
              label="Music"
              hint="Плейлист и все его видео переезжают в раздел Music — пропадают с Home, из обычного списка Playlists и из истории. На странице плейлиста и при прямой ссылке остаются доступны."
            >
              <ToggleSwitch
                checked={isMusic}
                onChange={setIsMusic}
                onLabel="В разделе Music"
                offLabel="Обычный плейлист"
                tone="music"
              />
            </SettingRow>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-zinc-800 px-4 py-3 sm:px-5">
            {mut.isSuccess && !mut.isPending && !dirty && (
              <span className="text-xs text-emerald-400">Saved</span>
            )}
            <button
              onClick={() => mut.mutate()}
              disabled={mut.isPending || !dirty}
              className="flex items-center gap-2 rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-40"
            >
              {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ToggleSwitch({
  checked, onChange, onLabel, offLabel, tone = "amber",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  onLabel: string;
  offLabel: string;
  tone?: "amber" | "music";
}) {
  const cls = tone === "music"
    ? { bg: "bg-fuchsia-500", text: "text-fuchsia-300", icon: <Music className="h-4 w-4" /> }
    : { bg: "bg-amber-500",   text: "text-amber-300",   icon: <InfinityIcon className="h-4 w-4" /> };
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
          checked ? cls.bg : "bg-zinc-700"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
      <span
        className={`flex items-center gap-1.5 text-sm ${
          checked ? cls.text : "text-zinc-400"
        }`}
      >
        {checked && cls.icon}
        {checked ? onLabel : offLabel}
      </span>
    </div>
  );
}

function SettingRow({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[200px_1fr] sm:items-start sm:gap-4 sm:px-5">
      <div>
        <p className="text-sm font-medium text-zinc-100">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-zinc-500 max-w-xs">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}
