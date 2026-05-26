import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, AlertTriangle, Pin, PinOff, Trash2, Star, MoreVertical, ListMusic, ExternalLink, Clock3, Infinity as InfinityIcon, AlertCircle, Music, Shuffle, RefreshCw } from "lucide-react";
import {
  videosApi, segmentsApi, settingsApi, playlistsApi, channelsApi, musicApi,
  thumbUrl, streamUrl, type Chapter, type Video,
} from "../lib/api";
import {
  formatUploadDate, formatDuration, youtubeVideoUrl,
  deletionForecast, describeDeletion, deletionTone,
} from "../lib/format";
import {
  clearPlaylistQueue, getMusicQueue, getPlaylistQueue, setMusicQueue, setPlaylistQueue, shuffleArray,
} from "../lib/queue";
import { useConfirm } from "../components/ConfirmProvider";
import { VideoPlayer, type PlayerHandle } from "../components/Player/VideoPlayer";
import { EndScreen } from "../components/Player/EndScreen";
import { RelatedCard } from "../components/RelatedCard";
import { useMiniPlayer } from "../components/MiniPlayerProvider";
import { MusicControlBar } from "../components/MusicControlBar";

export function WatchPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const [searchParams] = useSearchParams();
  const playlistIdParam = searchParams.get("playlist");
  const playlistId = playlistIdParam ? Number(playlistIdParam) : null;
  const isMusicSource = searchParams.get("source") === "music";
  const isShuffled    = searchParams.get("shuffle") === "1";
  const startAtSecondsParam = searchParams.get("t");
  const startAtSeconds = startAtSecondsParam ? Math.max(0, Number(startAtSecondsParam)) : null;
  const qc = useQueryClient();
  const nav = useNavigate();
  const confirm = useConfirm();
  const mini = useMiniPlayer();
  const playerRef = useRef<PlayerHandle>(null);

  const { data: video, isLoading } = useQuery({
    queryKey: ["video", videoId],
    queryFn: () => videosApi.get(videoId!),
    enabled: !!videoId,
    refetchInterval: (q) =>
      q.state.data?.status === "downloading" || q.state.data?.status === "pending" ? 3_000 : false,
    // Smooth track-to-track transitions: keep the previous video's metadata
    // visible while the new one is loading — no aspect-video skeleton flash.
    placeholderData: keepPreviousData,
  });

  const { data: segments = [] } = useQuery({
    queryKey: ["segments", videoId],
    queryFn: () => segmentsApi.list(videoId!),
    enabled: !!videoId && video?.status === "done",
  });

  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: settingsApi.get,
  });

  // Channels cache is populated by the sidebar — reuse it to find this
  // video's channel for the deletion forecast.
  const { data: channels = [] } = useQuery({
    queryKey: ["channels"],
    queryFn: channelsApi.list,
  });
  const channel = channels.find((c) => c.id === video?.channel_id);

  const { data: related = [] } = useQuery({
    queryKey: ["related", videoId],
    queryFn: () => videosApi.related(videoId!, 12),
    enabled: !!videoId && video?.status === "done" && !playlistId,
    placeholderData: keepPreviousData,
  });

  const { data: playlistInfo } = useQuery({
    queryKey: ["playlist", playlistId],
    queryFn: () => playlistsApi.get(playlistId!),
    enabled: !!playlistId,
  });

  const { data: playlistVideos = [] } = useQuery({
    queryKey: ["playlist", playlistId, "videos"],
    queryFn: () => playlistsApi.videos(playlistId!),
    enabled: !!playlistId,
  });

  const playbackMut = useMutation({
    mutationFn: (body: { rate?: number; position?: number; mark_watched?: boolean }) =>
      videosApi.updatePlayback(videoId!, body),
    onSuccess: (updated, vars) => {
      qc.setQueryData<Video>(["video", videoId], updated);
      if (updated.last_watched_at) qc.invalidateQueries({ queryKey: ["history"] });
      // Rate is stored as a global setting — refresh the cache so Settings and
      // the player initialRate on other pages see the new value.
      if (vars.rate !== undefined) qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const keepMut = useMutation({
    mutationFn: () => videosApi.update(videoId!, { keep_forever: !video!.keep_forever }),
    onSuccess: (updated) => {
      qc.setQueryData<Video>(["video", videoId], updated);
      qc.invalidateQueries({ queryKey: ["videos"] });
    },
  });

  const favoriteMut = useMutation({
    mutationFn: () => videosApi.update(videoId!, { is_favorite: !video!.is_favorite }),
    onSuccess: (updated) => {
      qc.setQueryData<Video>(["video", videoId], updated);
      qc.invalidateQueries({ queryKey: ["favorites"] });
    },
  });

  const musicMut = useMutation({
    mutationFn: () => videosApi.update(videoId!, { is_music: !video!.is_music }),
    onSuccess: (updated) => {
      qc.setQueryData<Video>(["video", videoId], updated);
      qc.invalidateQueries({ queryKey: ["music"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
      qc.invalidateQueries({ queryKey: ["history"] });
      qc.invalidateQueries({ queryKey: ["favorites"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => videosApi.delete(video!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["videos"] });
      qc.invalidateQueries({ queryKey: ["history"] });
      nav("/");
    },
  });

  const redownloadMut = useMutation({
    mutationFn: () => videosApi.redownload(videoId!),
    onSuccess: (updated) => {
      qc.setQueryData<Video>(["video", videoId], updated);
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
    },
  });

  // ``mediaError`` is populated when the <video> element's ``error`` event
  // fires — usually an AV1/VP9 decode failure on iOS Safari. Cleared on
  // every videoId change so the overlay doesn't haunt new tracks.
  const [mediaError, setMediaError] = useState<string | null>(null);
  useEffect(() => { setMediaError(null); }, [videoId]);

  // ``ended`` drives the EndScreen overlay. Music context skips the screen
  // entirely (gapless transitions); playlists & standalone get a countdown
  // → autoplay or replay. Reset on every track change so previously-ended
  // state doesn't haunt the next video.
  const [ended, setEnded] = useState(false);
  useEffect(() => { setEnded(false); }, [videoId]);

  // Prefetch-once guard for the next-track warmup. Stores the ID we
  // already prefetched so onTick doesn't spam fetch() on every timeupdate
  // after the threshold is crossed.
  const prefetchedRef = useRef<string | null>(null);
  useEffect(() => { prefetchedRef.current = null; }, [videoId]);

  // Auto-reload the <video> when status flips downloading → done (typical
  // after a redownload). Without this the player keeps showing the old
  // bytes until the user manually refreshes. ``placeholderData`` from
  // useQuery means ``video`` stays defined across pollings, so transitions
  // are observable.
  const prevStatusRef = useRef<string | undefined>(video?.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const cur  = video?.status;
    if (prev && prev !== "done" && cur === "done") {
      // Tiny tick so the worker's final mv into place is flushed before
      // we point the <video> back at the same URL.
      setMediaError(null);
      setTimeout(() => playerRef.current?.reload(), 200);
    }
    prevStatusRef.current = cur;
  }, [video?.status]);

  // ── Queue navigation (next / prev / autoplay-on-end) ───────────────────────
  //
  // Source precedence:
  //   1. Music queue (?source=music) — sessionStorage-backed, loops at end.
  //   2. Playlist (?playlist=N) — uses sessionStorage shuffled order when
  //      ?shuffle=1, else natural playlist order. Loops at end.
  //   3. Standalone — first ready related video; no prev, no loop.

  function siblingIds(): string[] {
    if (isMusicSource) {
      const q = getMusicQueue();
      return q?.ids ?? [];
    }
    if (playlistId) {
      if (isShuffled) {
        const q = getPlaylistQueue(playlistId);
        if (q?.ids.length) return q.ids;
      }
      return playlistVideos.filter((v) => v.status === "done").map((v) => v.video_id);
    }
    return related.filter((v) => v.status === "done").map((v) => v.video_id);
  }

  function gotoSiblingId(targetId: string) {
    const qs = new URLSearchParams();
    if (playlistId) qs.set("playlist", String(playlistId));
    if (isShuffled) qs.set("shuffle", "1");
    if (isMusicSource) qs.set("source", "music");
    const s = qs.toString();
    nav(`/watch/${targetId}${s ? `?${s}` : ""}`);
  }

  function pickNextId(): string | null {
    const list = siblingIds();
    if (!list.length) return null;
    // Standalone path: just play the first recommended.
    if (!playlistId && !isMusicSource) return list[0] ?? null;
    const idx = list.indexOf(videoId ?? "");
    if (idx < 0) return list[0] ?? null;
    // Music & playlist both loop at the end.
    if (idx + 1 >= list.length) return list[0];
    return list[idx + 1];
  }
  function pickPrevId(): string | null {
    if (!playlistId && !isMusicSource) return null;
    const list = siblingIds();
    if (!list.length) return null;
    const idx = list.indexOf(videoId ?? "");
    if (idx < 0) return null;
    if (idx === 0) return list[list.length - 1];   // wrap
    return list[idx - 1];
  }

  // Sync: if we entered ?source=music but no queue exists in sessionStorage
  // (cold page load / shared link), seed it from the current track.
  useEffect(() => {
    if (isMusicSource && videoId && !getMusicQueue()) {
      setMusicQueue([videoId], false);
    }
    if (playlistId && isShuffled && videoId && !getPlaylistQueue(playlistId)) {
      // Lost queue: rebuild from the playlist order, starting at current,
      // and re-shuffle so prev/next still feel random.
      const ids = playlistVideos
        .filter((v) => v.status === "done")
        .map((v) => v.video_id);
      if (ids.length) {
        const reordered = shuffleArray(ids);
        // Ensure current video is first so we don't immediately jump.
        const without = reordered.filter((id) => id !== videoId);
        setPlaylistQueue(playlistId, [videoId, ...without], true);
      }
    }
  }, [isMusicSource, playlistId, isShuffled, videoId, playlistVideos]);

  const nextId = pickNextId();
  const prevId = pickPrevId();

  // Resolve the Video row for the "Up next" preview in EndScreen. Only
  // looked up for non-music contexts since music transitions are gapless
  // (no countdown screen). Falls back to ``null`` when the next id refers
  // to a sibling we don't have a row for yet — the EndScreen handles that
  // gracefully with a "End of queue" placard.
  const nextVideoData: Video | null = (() => {
    if (!nextId || isMusicSource) return null;
    if (playlistId) {
      return playlistVideos.find((v) => v.video_id === nextId) ?? null;
    }
    return related.find((v) => v.video_id === nextId) ?? null;
  })();

  // ── Mini-player handoff ────────────────────────────────────────────────────
  //
  // Refs to forwardRef components are detached BEFORE useEffect cleanup runs,
  // so we can't rely on ``playerRef.current`` at unmount time. Instead the
  // player keeps a tick-callback alive that pushes ``{time, playing}`` into
  // ``liveRef``; cleanup reads from there. Video metadata is captured the
  // same way so the mini state survives a route change.
  // Reactive playing state for outside controls (MusicControlBar). The
  // player drives this via onTick; throttling to "only flip on change" so
  // we don't re-render every timeupdate. Start at ``true`` since the player
  // attempts autoplay on mount — if it gets blocked, the first ``onTick``
  // call flips this to false. Starting at false would briefly show a Play
  // icon for content that's already playing.
  const [playing, setPlaying] = useState(true);
  const liveRef    = useRef<{ time: number; playing: boolean }>({ time: 0, playing: false });
  const videoRef   = useRef<Video | null>(null);
  const sourceRef  = useRef<{ playlistId: number | null; isMusicSource: boolean; isShuffled: boolean }>({
    playlistId: null, isMusicSource: false, isShuffled: false,
  });
  videoRef.current  = video ?? videoRef.current;
  sourceRef.current = { playlistId, isMusicSource, isShuffled };

  // Settings ref so the cleanup closure sees the latest mini-player toggle
  // without having to re-run the effect (which would also fire on every URL
  // change — bad for hand-off semantics).
  const miniEnabledRef = useRef<boolean>(settings?.mini_player_enabled ?? true);
  miniEnabledRef.current = settings?.mini_player_enabled ?? true;

  useEffect(() => {
    if (videoId) mini.takeOver(videoId);
    return () => {
      if (!miniEnabledRef.current) return;          // user disabled mini-PiP
      // CRITICAL: if we're navigating to another /watch URL (next/prev
      // track), do NOT open the mini. Otherwise the mini's <video> plays
      // the previous track while the new WatchPage tries to autoplay the
      // new one — iOS Safari refuses the second source and the user sees
      // a stuck poster they "can't even start manually".
      if (window.location.pathname.startsWith("/watch/")) return;

      const v   = videoRef.current;
      const st  = liveRef.current;
      if (!v) return;

      // Defensive: ``useQuery`` with ``keepPreviousData`` means ``video``
      // can be the PREVIOUS track's row while a new track's data is in
      // flight (user navigated A→B, B's fetch hasn't resolved). If we
      // open mini with that stale row, the user sees A in mini after
      // visiting /watch/B. The closure's ``videoId`` is the truth — if
      // they don't match the data is stale; skip the open and let the
      // takeOver-clear on mount carry the day.
      if (videoId && v.video_id !== videoId) return;

      // Decide the resume target. End-of-video → reopen mini paused at
      // 0 so the user has a one-tap "replay" affordance in the corner.
      // Anything else (even a brief play) opens mini at the current
      // position. The old < 3 s gate was too eager and left the mini
      // stuck on the *previous* session.
      const dur  = v.duration ?? 0;
      const ended = dur > 0 && Number.isFinite(st.time) && st.time > dur - 2;
      const played = Number.isFinite(st.time) && st.time > 0.5;
      if (!played && !ended) return;        // never actually started → no mini

      mini.open({
        video: v,
        currentTime: ended ? 0 : st.time,
        wasPlaying:  ended ? false : st.playing,
        source:      sourceRef.current,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  if (isLoading) {
    return <div className="aspect-video animate-pulse rounded-xl bg-zinc-900" />;
  }
  if (!video) {
    return <p className="text-sm text-zinc-400">Video not found.</p>;
  }

  const isMusicVideo = video.is_music || !!video.is_music_via_playlist;
  const playerInitialRate = isMusicVideo
    ? (settings?.music_playback_rate ?? 1)
    : (settings?.default_playback_rate ?? 1);

  return (
    <div>
      {/* Layout: a single grid that wraps player + meta + aside, so the
       *  player's ``position: sticky`` stays anchored to the WHOLE page on
       *  phones — not just the meta column. That keeps the video on screen
       *  while the user scrolls down through related videos or the playlist
       *  queue (the original layout lost the anchor as soon as the meta
       *  column scrolled off).
       *
       *  DOM order is Player → Meta → Aside, which is the phone view. On
       *  ``lg`` we use explicit row/col placement so Aside floats next to
       *  Player on the right and Meta sits underneath Player on the left. */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-x-6">
        {/* Player */}
        <div
          // ``bg-black`` is only for the mobile edge-to-edge case (the
          // ``-mx-4`` makes the wrapper full-bleed and the video has square
          // corners there). On sm+ the inner player is rounded-xl, and a
          // bg-black on this square outer wrapper would show as black
          // triangles behind the rounded corners — hence ``sm:bg-transparent``.
          className="order-1 lg:row-start-1 lg:col-start-1 sticky z-30 bg-black sm:bg-transparent -mx-4 sm:mx-0 relative"
          style={{ top: "var(--header-safe-top)" }}
        >
          {mediaError && video.status === "done" && (
            <MediaErrorOverlay
              message={mediaError}
              busy={redownloadMut.isPending}
              done={redownloadMut.isSuccess}
              onRedownload={() => redownloadMut.mutate()}
              onDismiss={() => setMediaError(null)}
            />
          )}
          {ended && video.status === "done" && !mediaError && (
            <EndScreen
              nextVideo={nextVideoData}
              autoplayMs={playlistId ? 3500 : 5000}
              onSkipNow={() => {
                setEnded(false);
                if (nextId) gotoSiblingId(nextId);
              }}
              onReplay={() => {
                setEnded(false);
                playerRef.current?.seekTo(0);
                playerRef.current?.play();
              }}
              onCancel={() => setEnded(false)}
            />
          )}
          {video.status === "done" ? (
            <VideoPlayer
              ref={playerRef}
              video={video}
              segments={segments}
              initialRate={playerInitialRate}
              startAtSeconds={startAtSeconds}
              alwaysShowControls={isMusicVideo}
              showPrevControl={isMusicVideo || isMusicSource || !!playlistId}
              onCollapseToMini={() => {
                // Swipe-down on the inline player: navigate away so the
                // MiniPlayerProvider auto-opens with current state. ``-1``
                // falls back to "/" when there is no prior history entry.
                if (window.history.length > 1) nav(-1);
                else nav("/");
              }}
              onMediaError={(msg) => setMediaError(msg)}
              onPlaybackUpdate={(body) => {
                // Music videos never persist position — playback always
                // starts from 0. Still let rate (routed server-side to the
                // music_playback_rate setting) and mark_watched through.
                if (isMusicVideo && body.position !== undefined) {
                  const { position: _drop, ...rest } = body;
                  if (Object.keys(rest).length === 0) return;
                  playbackMut.mutate(rest);
                  return;
                }
                playbackMut.mutate(body);
              }}
              onTick={(s) => {
                liveRef.current = s;
                if (s.playing !== playing) setPlaying(s.playing);

                // Pre-fetch the next music track when we're <5 s from the
                // end of this one. A small range request warms the HTTP
                // cache so the navigation to /watch/<next> hits a primed
                // resource — gapless music transitions stop having a
                // first-byte stall.
                if (isMusicSource && nextId && prefetchedRef.current !== nextId) {
                  const dur = video.duration ?? 0;
                  if (dur > 0 && s.playing && dur - s.time < 5 && s.time > 0.5) {
                    prefetchedRef.current = nextId;
                    fetch(streamUrl(nextId), {
                      headers: { Range: "bytes=0-65535" },
                      cache: "default",
                    }).catch(() => { /* not critical; navigation still works */ });
                  }
                }
              }}
              onNext={nextId ? () => gotoSiblingId(nextId) : undefined}
              onPrev={prevId ? () => gotoSiblingId(prevId) : undefined}
              onEnded={() => {
                // Music: gapless transition, no end-screen.
                if (isMusicSource && nextId) {
                  gotoSiblingId(nextId);
                  return;
                }
                // Standalone / playlist: show end-screen overlay. If there's
                // no next, ``ended=true`` still triggers the "End of queue"
                // placard with a Replay button.
                setEnded(true);
              }}
            />
          ) : video.status === "error" ? (
            <div className="grid aspect-video place-items-center bg-zinc-900 text-center sm:rounded-xl">
              <div>
                <AlertTriangle className="mx-auto h-10 w-10 text-red-500" />
                <p className="mt-3 text-sm text-zinc-300">Download failed.</p>
                <p className="mt-1 max-w-md text-xs text-zinc-500">{video.error_message}</p>
              </div>
            </div>
          ) : (
            <div className="grid aspect-video place-items-center bg-zinc-900 text-center sm:rounded-xl">
              <div>
                <Clock className="mx-auto h-10 w-10 text-zinc-600 animate-pulse" />
                <p className="mt-3 text-sm text-zinc-400">
                  {video.status === "downloading"
                    ? `Downloading… ${video.progress ?? ""}`
                    : "Queued for download"}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Meta + chapters + description (only for ``done`` videos) */}
        <div className="order-2 lg:row-start-2 lg:col-start-1 min-w-0 mt-3 lg:mt-4">
          {video.status === "done" && (
            <>
              {(isMusicSource || playlistId) && (
                <QueueContextChip
                  isMusicSource={isMusicSource}
                  playlistId={playlistId}
                  isShuffled={isShuffled}
                  videoId={videoId ?? ""}
                  playlistVideos={playlistVideos}
                />
              )}
              <div className="mt-2">
                <h1 className="text-lg sm:text-xl font-semibold break-words leading-snug">
                  {video.title}
                </h1>
                <div className="mt-2 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-400 break-words">
                      {video.channel_name && (
                        <Link
                          to={`/channel/${video.channel_id}`}
                          className="text-zinc-200 hover:text-zinc-100 hover:underline"
                        >
                          {video.channel_name}
                        </Link>
                      )}
                      {" · "}
                      {formatUploadDate(video.upload_date, video.downloaded_at, video.upload_timestamp)}
                      {video.duration ? ` · ${formatDuration(video.duration)}` : ""}
                      {video.quality ? ` · ${video.quality}p` : ""}
                      {video.is_favorite && (
                        <span className="ml-2 inline-flex items-center gap-1 text-yellow-400">
                          <Star className="h-3.5 w-3.5 fill-current" />
                        </span>
                      )}
                      {video.keep_forever && (
                        <span className="ml-1 inline-flex items-center gap-1 text-amber-400">
                          <Pin className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </p>
                    <DeletionChip video={video} channelRetentionDays={channel?.retention_days ?? null} globals={settings} />
                  </div>
                  {/* Big star — primary fav/unfav target on music. Tucked
                   *  next to the actions menu so phone thumb can reach it. */}
                  {isMusicVideo && (
                    <button
                      onClick={() => favoriteMut.mutate()}
                      className={`rounded-full p-2 -mt-1 transition-colors ${
                        video.is_favorite
                          ? "bg-yellow-400/15 text-yellow-300 hover:bg-yellow-400/25"
                          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                      }`}
                      aria-label={video.is_favorite ? "Remove from favorites" : "Add to favorites"}
                      title={video.is_favorite ? "Remove from favorites" : "Add to favorites"}
                    >
                      <Star className={`h-6 w-6 ${video.is_favorite ? "fill-current" : ""}`} />
                    </button>
                  )}
                  <ActionsMenu
                    video={video}
                    onToggleFavorite={() => favoriteMut.mutate()}
                    onToggleKeep={() => keepMut.mutate()}
                    onToggleMusic={() => musicMut.mutate()}
                    onDelete={async () => {
                      const ok = await confirm({
                        title: "Delete this video?",
                        body: "Файл и превью удалятся с диска. Если канал ещё активен, видео может скачаться заново на следующем sync.",
                        confirmLabel: "Delete",
                        destructive: true,
                      });
                      if (ok) deleteMut.mutate();
                    }}
                  />
                </div>
              </div>
              {video.chapters && video.chapters.length > 1 && (
                <ChaptersBlock
                  chapters={video.chapters}
                  onJump={(t) => {
                    playerRef.current?.seekTo(t);
                    playerRef.current?.play();
                  }}
                />
              )}
              {/* Music has no description column — clips are just music videos
               *  and the description is usually link spam. */}
              {!isMusicVideo && video.description && (
                <DescriptionBlock text={video.description} />
              )}
            </>
          )}
        </div>

        {/* Aside — related / playlist queue / music queue.
         *
         *  Bottom padding when the MusicControlBar is showing so the user
         *  doesn't scroll content under the always-visible strip. The bar
         *  itself is rendered outside the grid (fixed position) further
         *  down so it spans full viewport width on tablet+. */}
        {/* eslint-disable-next-line @typescript-eslint/no-unused-expressions */}
        <aside
          className="
            order-3
            lg:order-none lg:row-start-1 lg:row-span-2 lg:col-start-2
            mt-6 lg:mt-0
            lg:max-h-[calc(100vh-6rem-env(safe-area-inset-top))] lg:overflow-y-auto lg:pr-1
          "
        >
          {video.status === "done" && (
            isMusicSource ? (
              <MusicQueuePanel
                currentVideoId={videoId ?? ""}
                capFromSettings={settings?.music_queue_panel_size ?? 100}
              />
            ) : playlistId ? (
              <PlaylistQueue
                playlistId={playlistId}
                title={playlistInfo?.title}
                videos={playlistVideos}
                currentVideoId={videoId ?? ""}
              />
            ) : related.length === 0 ? (
              <p className="text-xs text-zinc-500">Nothing else around yet.</p>
            ) : (
              <div className="space-y-3">
                {related.map((v) => <RelatedCard key={v.id} video={v} />)}
              </div>
            )
          )}
        </aside>
      </div>

      {/* Always-visible music transport — only on watch page, only when the
       *  current item is music. Hidden on the smallest phones (<sm) since
       *  the sticky-top player there already keeps controls in reach. */}
      {video.status === "done" && (isMusicVideo || isMusicSource) && (
        <>
          {/* Spacer so content scroll doesn't hide under MusicControlBar.
           *  Visible on all sizes now that the bar shows on phone too. */}
          <div className="h-20" />
          <MusicControlBar
            video={video}
            playing={playing}
            onTogglePlay={() => playerRef.current?.togglePlay()}
            onPrev={prevId ? () => gotoSiblingId(prevId) : null}
            onNext={nextId ? () => gotoSiblingId(nextId) : null}
            onToggleFavorite={() => favoriteMut.mutate()}
          />
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── Queue context chip ─────────────────────────
 *
 * Lives right under the player. Always shows when we're in a queue context
 * (playlist or music). Lets the user flip shuffle on/off without going back
 * to the originating page. */

function QueueContextChip({
  isMusicSource, playlistId, isShuffled, videoId, playlistVideos,
}: {
  isMusicSource: boolean;
  playlistId: number | null;
  isShuffled: boolean;
  videoId: string;
  playlistVideos: Video[];
}) {
  const nav = useNavigate();

  async function toggleShuffle() {
    const goingOn = !isShuffled;

    if (isMusicSource) {
      const { video_ids } = await musicApi.trackIds();
      if (!video_ids.length) return;
      const idx = video_ids.indexOf(videoId);
      const base = idx >= 0
        ? [...video_ids.slice(idx), ...video_ids.slice(0, idx)]
        : video_ids;
      const next = goingOn
        ? [videoId, ...shuffleArray(base.slice(1))]
        : base;
      setMusicQueue(next, goingOn);
      const params = new URLSearchParams({ source: "music" });
      if (playlistId)  params.set("playlist", String(playlistId));
      if (goingOn)     params.set("shuffle",  "1");
      nav(`/watch/${videoId}?${params.toString()}`, { replace: true });
      return;
    }

    if (playlistId) {
      const ids = playlistVideos
        .filter((v) => v.status === "done")
        .map((v) => v.video_id);
      if (!ids.length) return;
      if (goingOn) {
        const without = ids.filter((id) => id !== videoId);
        setPlaylistQueue(playlistId, [videoId, ...shuffleArray(without)], true);
      } else {
        clearPlaylistQueue(playlistId);
      }
      const params = new URLSearchParams({ playlist: String(playlistId) });
      if (goingOn) params.set("shuffle", "1");
      nav(`/watch/${videoId}?${params.toString()}`, { replace: true });
    }
  }

  const cls = isMusicSource
    ? { bg: "bg-fuchsia-500/15", text: "text-fuchsia-300", btnOn: "bg-fuchsia-500/30 text-fuchsia-100", btnOff: "text-fuchsia-300/60 hover:text-fuchsia-200" }
    : { bg: "bg-sky-500/15",     text: "text-sky-300",     btnOn: "bg-sky-500/30 text-sky-100",         btnOff: "text-sky-300/60 hover:text-sky-200" };

  return (
    <div className={`mt-2 inline-flex items-center gap-1 rounded-full ${cls.bg} px-2 py-1 text-xs font-medium ${cls.text}`}>
      <span className="inline-flex items-center gap-1.5 pl-1">
        {isMusicSource
          ? <><Music    className="h-3.5 w-3.5" /> Music queue</>
          : <><ListMusic className="h-3.5 w-3.5" /> Playlist</>}
      </span>
      <button
        type="button"
        onClick={toggleShuffle}
        title={isShuffled ? "Turn shuffle off" : "Shuffle"}
        aria-pressed={isShuffled}
        className={`ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors ${
          isShuffled ? cls.btnOn : cls.btnOff
        }`}
      >
        <Shuffle className="h-3.5 w-3.5" />
        {isShuffled ? "on" : "off"}
      </button>
    </div>
  );
}

function PlaylistQueue({
  playlistId, title, videos, currentVideoId,
}: {
  playlistId: number;
  title: string | undefined;
  videos: Video[];
  currentVideoId: string;
}) {
  const currentIdx = videos.findIndex((v) => v.video_id === currentVideoId);
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  // Auto-scroll the active row into view only when it's actually off-screen
  // — otherwise the list jumps on every next/prev tap which feels jarring.
  // When we do scroll, we pad it just enough to make the next item visible.
  useEffect(() => {
    const el = activeRef.current; if (!el) return;
    const scroller = findScrollableParent(el);
    if (!scroller) return;
    scrollIntoViewIfNeeded(el, scroller);
  }, [currentVideoId]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Link
          to={`/playlist/${playlistId}`}
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-100"
        >
          <ListMusic className="h-3.5 w-3.5" />
          <span className="truncate">{title ?? "Playlist"}</span>
        </Link>
        {currentIdx >= 0 && (
          <span className="text-xs text-zinc-500 tabular-nums">
            {currentIdx + 1} / {videos.length}
          </span>
        )}
      </div>
      <div className="space-y-1">
        {videos.map((v, i) => (
          <PlaylistQueueRow
            key={v.id}
            v={v}
            position={i + 1}
            isCurrent={v.video_id === currentVideoId}
            playlistId={playlistId}
            activeRef={v.video_id === currentVideoId ? activeRef : undefined}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Music queue side panel.
//
// Renders the active music queue (from sessionStorage) capped at a configurable
// number of rows. Track metadata is fetched once via the /api/music/tracks
// endpoint that MusicPage already populated; the panel just looks rows up by
// id so the visible order matches the queue, not the API's natural order.

function MusicQueuePanel({
  currentVideoId, capFromSettings,
}: { currentVideoId: string; capFromSettings: number }) {
  const queue = getMusicQueue();
  const ids   = queue?.ids ?? [];

  const { data: allTracks = [] } = useQuery({
    queryKey: ["music", "tracks"],
    queryFn:  () => musicApi.tracks(500),
    // Cache aggressively — same data feeds MusicPage and this panel.
    staleTime: 60_000,
  });

  const byId = new Map(allTracks.map((t) => [t.video_id, t]));
  const cap  = Math.max(10, Math.min(1000, capFromSettings || 100));
  const visibleIds = ids.slice(0, cap);
  const visible    = visibleIds
    .map((id) => byId.get(id))
    .filter((v): v is Video => !!v);
  const currentIdx = ids.indexOf(currentVideoId);

  const activeRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    const el = activeRef.current; if (!el) return;
    const scroller = findScrollableParent(el);
    if (!scroller) return;
    scrollIntoViewIfNeeded(el, scroller);
  }, [currentVideoId]);

  if (!ids.length) {
    return (
      <p className="text-xs text-zinc-500">
        Music queue пуст. Открой Music и нажми Play / Shuffle.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Link
          to="/music"
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fuchsia-300 hover:text-fuchsia-200"
        >
          <Music className="h-3.5 w-3.5" />
          Music queue
          {queue?.shuffled && (
            <Shuffle className="h-3 w-3 ml-0.5" />
          )}
        </Link>
        {currentIdx >= 0 && (
          <span className="text-xs text-zinc-500 tabular-nums">
            {currentIdx + 1} / {ids.length}
          </span>
        )}
      </div>
      <div className="space-y-1">
        {visible.map((v, i) => (
          <MusicQueueRow
            key={v.id}
            v={v}
            position={i + 1}
            isCurrent={v.video_id === currentVideoId}
            activeRef={v.video_id === currentVideoId ? activeRef : undefined}
          />
        ))}
        {ids.length > visible.length && (
          <p className="px-1.5 py-2 text-[11px] text-zinc-500">
            +{ids.length - visible.length} в очереди (увеличь лимит в Advanced settings)
          </p>
        )}
      </div>
    </div>
  );
}

function MusicQueueRow({
  v, position, isCurrent, activeRef,
}: {
  v: Video; position: number; isCurrent: boolean;
  activeRef?: React.MutableRefObject<HTMLAnchorElement | null>;
}) {
  const thumb = v.thumbnail_path ? thumbUrl(v.video_id) : v.thumbnail_url;
  return (
    <Link
      ref={activeRef}
      to={`/watch/${v.video_id}?source=music`}
      className={`group flex items-start gap-2 rounded-lg p-1.5 transition-colors ${
        isCurrent
          ? "bg-fuchsia-500/15 ring-1 ring-fuchsia-500/30"
          : "hover:bg-zinc-800/50"
      }`}
    >
      <span className={`w-6 flex-shrink-0 pt-1 text-right text-[11px] font-mono tabular-nums ${
        isCurrent ? "text-fuchsia-300 font-bold" : "text-zinc-500"
      }`}>
        {isCurrent ? "▶" : position}
      </span>
      <div className="relative aspect-video w-24 flex-shrink-0 overflow-hidden rounded bg-zinc-800">
        {thumb && (
          <img src={thumb} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-full w-full object-cover" />
        )}
        {v.duration && (
          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/85 px-1 text-[9px] font-medium">
            {formatDuration(v.duration)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`line-clamp-2 text-xs leading-tight ${
          isCurrent ? "font-medium text-zinc-50" : "text-zinc-200"
        }`}>
          {v.title}
        </p>
        {v.channel_name && (
          <p className="mt-0.5 truncate text-[10px] text-zinc-500">{v.channel_name}</p>
        )}
      </div>
    </Link>
  );
}

/** Scroll the active queue row into view only when it isn't fully visible.
 *  Falling-back to no-op when visible avoids the jarring "list resets on
 *  every track change" feel — once you're scrolled to the area, it stays
 *  put as next/prev tick through the queue. */
function scrollIntoViewIfNeeded(el: HTMLElement, scroller: HTMLElement) {
  const r  = el.getBoundingClientRect();
  const sr = scroller.getBoundingClientRect();
  const pad = 8;
  // Already fully visible — leave the user's scroll position alone.
  if (r.top >= sr.top + pad && r.bottom <= sr.bottom - pad) return;
  // Otherwise nudge it so the active row sits ~12px below the scroller's
  // top edge. That keeps a couple of upcoming rows in sight.
  const offsetWithin = r.top - sr.top + scroller.scrollTop;
  scroller.scrollTo({ top: Math.max(0, offsetWithin - 12), behavior: "smooth" });
}

/** Walk up the DOM to the nearest element that actually has its own
 *  vertical scrollbar. Returns null if none is found before <body>. */
function findScrollableParent(el: HTMLElement): HTMLElement | null {
  let p: HTMLElement | null = el.parentElement;
  while (p && p !== document.body) {
    const style = getComputedStyle(p);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && p.scrollHeight > p.clientHeight) {
      return p;
    }
    p = p.parentElement;
  }
  return null;
}

function PlaylistQueueRow({
  v, position, isCurrent, playlistId, activeRef,
}: {
  v: Video; position: number; isCurrent: boolean; playlistId: number;
  activeRef?: React.MutableRefObject<HTMLAnchorElement | null>;
}) {
  const thumb = v.thumbnail_path ? thumbUrl(v.video_id) : v.thumbnail_url;
  const watchable = v.status === "done";
  const to = watchable
    ? `/watch/${v.video_id}?playlist=${playlistId}`
    : `/watch/${v.video_id}`;
  return (
    <Link
      ref={activeRef}
      to={to}
      className={`group flex items-start gap-2 rounded-lg p-1.5 transition-colors ${
        isCurrent ? "bg-red-500/15 ring-1 ring-red-500/30" : "hover:bg-zinc-800/50"
      } ${!watchable ? "opacity-60" : ""}`}
    >
      <span className={`w-6 flex-shrink-0 pt-1 text-right text-[11px] font-mono tabular-nums ${
        isCurrent ? "text-red-300 font-bold" : "text-zinc-500"
      }`}>
        {isCurrent ? "▶" : position}
      </span>
      <div className="relative aspect-video w-24 flex-shrink-0 overflow-hidden rounded bg-zinc-800">
        {thumb && (
          <img src={thumb} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-full w-full object-cover" />
        )}
        {v.duration && (
          <span className="absolute bottom-0.5 right-0.5 rounded bg-black/85 px-1 text-[9px] font-medium">
            {formatDuration(v.duration)}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`line-clamp-2 text-xs leading-tight ${
          isCurrent ? "font-medium text-zinc-50" : "text-zinc-200"
        }`}>
          {v.title}
        </p>
        {v.channel_name && (
          <p className="mt-0.5 truncate text-[10px] text-zinc-500">{v.channel_name}</p>
        )}
      </div>
    </Link>
  );
}

function DeletionChip({
  video, channelRetentionDays, globals,
}: {
  video: Video;
  channelRetentionDays: number | null;
  globals: Parameters<typeof deletionForecast>[2];
}) {
  const forecast = deletionForecast(
    {
      keep_forever:          video.keep_forever,
      is_favorite:           video.is_favorite,
      is_music:              video.is_music,
      is_music_via_playlist: video.is_music_via_playlist,
      kept_by_playlist:      video.kept_by_playlist,
      downloaded_at:         video.downloaded_at,
      duration:              video.duration,
      last_position_seconds: video.last_position_seconds,
    },
    channelRetentionDays,
    globals,
  );
  const tone = deletionTone(forecast);
  const cls = {
    kept:     "text-zinc-500",
    neutral:  "text-zinc-400",
    soon:     "text-amber-400",
    imminent: "text-red-400",
  }[tone];
  const Icon =
    tone === "kept"     ? InfinityIcon :
    tone === "imminent" ? AlertCircle  :
                          Clock3;
  return (
    <p className={`mt-1.5 flex items-center gap-1.5 text-xs ${cls}`}>
      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
      <span>{describeDeletion(forecast)}</span>
    </p>
  );
}

function ActionsMenu({
  video, onToggleFavorite, onToggleKeep, onToggleMusic, onDelete,
}: {
  video: Video;
  onToggleFavorite: () => void;
  onToggleKeep: () => void;
  onToggleMusic: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((s) => !s)}
        className="rounded-full p-2 hover:bg-zinc-800 -mt-1"
        aria-label="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical className="h-5 w-5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-xl"
        >
          <MenuItem
            onClick={() => { onToggleFavorite(); setOpen(false); }}
            icon={<Star className={`h-4 w-4 ${video.is_favorite ? "fill-current text-yellow-400" : ""}`} />}
            label={video.is_favorite ? "Remove from favorites" : "Add to favorites"}
          />
          <MenuItem
            onClick={() => { onToggleKeep(); setOpen(false); }}
            icon={video.keep_forever
              ? <PinOff className="h-4 w-4 text-amber-400" />
              : <Pin    className="h-4 w-4" />}
            label={video.keep_forever ? "Stop keeping forever" : "Keep forever"}
          />
          {video.is_music_via_playlist && !video.is_music ? (
            <div className="flex items-start gap-3 px-3 py-2 text-sm text-zinc-500 cursor-default">
              <Music className="h-4 w-4 text-fuchsia-400 mt-0.5 flex-shrink-0" />
              <span className="leading-tight">В music-плейлисте<br/>
                <span className="text-[10px] text-zinc-600">отметка наследуется автоматом</span>
              </span>
            </div>
          ) : (
            <MenuItem
              onClick={() => { onToggleMusic(); setOpen(false); }}
              icon={<Music className={`h-4 w-4 ${video.is_music ? "text-fuchsia-400" : ""}`} />}
              label={video.is_music ? "Remove from music" : "Mark as music"}
            />
          )}
          <div className="my-1 h-px bg-zinc-800" />
          <MenuItem
            onClick={() => {
              window.open(youtubeVideoUrl(video.video_id), "_blank", "noopener,noreferrer");
              setOpen(false);
            }}
            icon={<ExternalLink className="h-4 w-4" />}
            label="Open on YouTube"
          />
          <div className="my-1 h-px bg-zinc-800" />
          <MenuItem
            onClick={() => { onDelete(); setOpen(false); }}
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete video"
            destructive
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick, icon, label, destructive,
}: { onClick: () => void; icon: React.ReactNode; label: string; destructive?: boolean }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-800 ${
        destructive ? "text-red-400 hover:bg-red-500/20" : "text-zinc-100"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ChaptersBlock({
  chapters, onJump,
}: { chapters: Chapter[]; onJump: (t: number) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-6 rounded-xl bg-zinc-900 p-4">
      <button
        onClick={() => setOpen((s) => !s)}
        className="mb-2 flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-200"
      >
        <span>Chapters · {chapters.length}</span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="grid gap-1 sm:grid-cols-2">
          {chapters.map((c, i) => (
            <button
              key={i}
              onClick={() => onJump(c.start)}
              className="flex items-start gap-3 rounded-lg p-2 text-left text-sm hover:bg-zinc-800"
            >
              <span className="mt-0.5 w-12 font-mono text-xs text-zinc-400 shrink-0">
                {formatDuration(c.start)}
              </span>
              <span className="line-clamp-2 text-zinc-200">{c.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DescriptionBlock({ text }: { text: string }) {
  const trimmed = text.trim();
  const needsToggle = trimmed.length > 300 || trimmed.split("\n").length > 6;
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-6 rounded-xl bg-zinc-900 p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Description
      </h3>
      <div className="relative">
        <div
          className={`whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-300 ${
            needsToggle && !open ? "max-h-24 overflow-hidden" : ""
          }`}
        >
          {linkify(trimmed)}
        </div>
        {needsToggle && !open && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-zinc-900 to-transparent" />
        )}
      </div>
      {needsToggle && (
        <button
          onClick={() => setOpen((s) => !s)}
          className="mt-3 rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

// Turn plain-text URLs into <a target="_blank" rel="noopener noreferrer"> links.
// Tail punctuation that shouldn't be part of the URL is left in the text node.
function linkify(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(https?:\/\/[^\s<>"']+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let url  = m[0];
    let tail = "";
    while (url.length && '.,;:!?)]>'.includes(url[url.length - 1])) {
      tail = url[url.length - 1] + tail;
      url  = url.slice(0, -1);
    }
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a
        key={m.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 hover:underline break-all"
      >
        {url}
      </a>,
    );
    if (tail) out.push(tail);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}


/* Overlay shown when the <video> element raises an error.
 *
 * The most common cause in this codebase is an AV1-encoded file that the
 * device's decoder refuses — iOS Safari before 17, older Android Chrome,
 * older Macs without hw AV1 decode. The overlay surfaces that explicitly
 * AND offers a one-tap re-download in H.264 (the current format string
 * preference) so the user has a clear way forward.
 */
function MediaErrorOverlay({
  message, busy, done, onRedownload, onDismiss,
}: {
  message: string;
  busy: boolean;
  done: boolean;
  onRedownload: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-zinc-950/90 backdrop-blur-sm sm:rounded-xl px-4">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-400" />
        <p className="mt-3 text-sm font-medium text-zinc-100">Не получилось воспроизвести</p>
        <p className="mt-1 text-xs text-zinc-400 leading-relaxed">{message}</p>
        {done ? (
          <p className="mt-4 text-xs text-emerald-400">
            Поставил в очередь — следи за прогрессом во вкладке Downloads.
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={onRedownload}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
              {busy ? "Очередь…" : "Re-download in H.264"}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-full px-4 py-1.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
            >
              Закрыть
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
