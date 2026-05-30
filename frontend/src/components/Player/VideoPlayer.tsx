import {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Play, Pause, Maximize, Minimize,
  PictureInPicture2, Subtitles, ListVideo, RotateCcw, RotateCw,
  SkipForward, SkipBack, X,
} from "lucide-react";
import type { Chapter, SponsorSegment, Video, VideoVariant } from "../../lib/api";
import { streamUrl, subtitleUrl, thumbUrl, variantsApi } from "../../lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDuration } from "../../lib/format";
import { SEGMENT_COLORS, SEGMENT_LABELS } from "./segmentColors";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const CONTROL_HIDE_MS = 2500;

interface Props {
  video: Video;
  segments: SponsorSegment[];
  initialRate: number;
  /** Override the resume-position with an explicit start time (e.g. from a
   *  ``?t=N`` deep link). Beats ``last_position_seconds`` for this load only. */
  startAtSeconds?: number | null;
  onPlaybackUpdate?: (patch: { rate?: number; position?: number; mark_watched?: boolean }) => void;
  /** Lightweight per-timeupdate signal so the parent can snapshot live state
   *  (used by the mini-player handoff which needs fresh time + playing flag
   *  at unmount time — by then refs to this component are already detached). */
  onTick?: (state: { time: number; playing: boolean }) => void;
  // Queue navigation. When the corresponding callback is omitted, the matching
  // control is rendered disabled.
  onNext?:  () => void;
  onPrev?:  () => void;
  onEnded?: () => void;
  /** When true, never auto-hide the bottom control bar. Used in music mode
   *  so play / pause / next stay one tap away — the user "often switches
   *  tracks" and shouldn't have to wake the controls every time. */
  alwaysShowControls?: boolean;
  /** Render a Prev button in the bottom bar. We hide Prev by default
   *  because it's noise on a normal video, but it's the whole point in a
   *  music / playlist queue. */
  showPrevControl?: boolean;
  /** Swipe-down on the inline (non-fullscreen) player. The host page
   *  decides what "minimize" means — usually ``history.back()`` so the
   *  mini-PiP picks up automatically. */
  onCollapseToMini?: () => void;
  /** Fires when the <video> element raises an error event. ``message``
   *  is a best-effort human description (codec/network/etc). */
  onMediaError?: (message: string) => void;
}

export interface PlayerHandle {
  seekTo: (t: number) => void;
  play:   () => void;
  pause:  () => void;
  togglePlay: () => void;
  /** Force-reload the underlying <video>. Used after redownload so the
   *  freshly-written file is picked up without a page refresh. */
  reload: () => void;
  /** Live readers for the mini-player handoff. */
  getCurrentTime: () => number;
  isPlaying:      () => boolean;
}

export const VideoPlayer = forwardRef<PlayerHandle, Props>(function VideoPlayer(
  {
    video, segments, initialRate, startAtSeconds,
    onPlaybackUpdate, onTick, onNext, onPrev, onEnded,
    alwaysShowControls = false, showPrevControl = false, onCollapseToMini,
    onMediaError,
  },
  forwardedRef,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Always a <video> for visual playback. (An earlier iteration swapped
  // to <audio> in music mode, but the clip frames matter — this is a
  // video app first.) Typed as HTMLMediaElement so the ``instanceof
  // HTMLVideoElement`` guards stay defensive.
  const videoRef     = useRef<HTMLMediaElement | null>(null);
  // Hidden <audio> rendered ALONGSIDE the <video> when in music mode.
  // iOS Safari pauses <video> on screen lock even with playsInline, but
  // <audio> keeps playing. On visibilitychange we swap: pause video, sync
  // currentTime to audio, play audio. On returning to foreground, reverse.
  const audioBackupRef = useRef<HTMLAudioElement | null>(null);
  const hideTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-derived locally so the music-mode features (background audio swap,
  // any future visual tweaks) don't need a prop drilled in from WatchPage.
  const isMusicMode = !!(video.is_music || video.is_music_via_playlist);

  // ── Quality variants ──────────────────────────────────────────────────────
  //
  // ``selectedHeight`` is null when streaming the primary (best-available)
  // variant — the default. Switching to another variant just re-points the
  // src to ``/api/stream/<id>?height=N`` and seeks the player back to where
  // the user was.
  const [selectedHeight, setSelectedHeight] = useState<number | null>(null);
  const qualityResumeRef = useRef<number | null>(null);
  // Variants list — fetched lazily for the open Quality menu, cached for
  // 30 s so polling-while-pending doesn't go wild. Status is mainly used
  // to render in-progress / failed states in the dropdown.
  const qc = useQueryClient();
  const { data: variants = [] } = useQuery({
    queryKey: ["video-variants", video.video_id],
    queryFn:  () => variantsApi.list(video.video_id),
    refetchInterval: (q) => {
      const items = (q.state.data ?? []) as VideoVariant[];
      return items.some((v) => v.status === "pending" || v.status === "downloading") ? 4_000 : false;
    },
  });
  const variantMut = useMutation({
    mutationFn: (height: number) => variantsApi.create(video.video_id, height),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["video-variants", video.video_id] }),
  });
  const variantDeleteMut = useMutation({
    mutationFn: (id: number) => variantsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["video-variants", video.video_id] }),
  });

  const [isPlaying,   setIsPlaying]   = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration,    setDuration]    = useState(video.duration ?? 0);
  const [buffered,    setBuffered]    = useState(0);
  const [rate,        setRate]        = useState(initialRate);
  const [isFs,        setIsFs]        = useState(false);
  const [showCC,      setShowCC]      = useState(false);
  const [showCtl,     setShowCtl]     = useState(true);
  // Touch devices: subtitles are intentionally disabled — the CC button is
  // hidden too, so without this gate the <track> would still render and could
  // be toggled by mobile Safari's native UI in weird ways.
  const isTouch = useIsTouch();
  // Visual feedback for double-tap-to-seek gesture.
  const [seekToast, setSeekToast] = useState<null | { dir: "back" | "fwd"; n: number }>(null);
  // Keyboard-shortcuts cheat sheet, toggled with "?".
  const [showHelp, setShowHelp] = useState(false);
  const lastTapRef = useRef<{ t: number; x: number } | null>(null);
  // Object-fit (letterbox vs crop). Toggled via two-finger pinch on touch
  // devices. Sticky for the current player instance; deliberately not
  // persisted — it's a "viewing position" preference, not a global setting.
  const [objectFit, setObjectFit] = useState<"contain" | "cover">("contain");
  // Natural aspect ratio. If the DB row already knows the width/height
  // (downloader stores both at fetch time) we render at the correct aspect
  // from the very first frame — no flash from 16:9 default to actual. Old
  // rows without ``width`` fall back to 16:9 until loadedmetadata fires.
  const initialAspect = useMemo(() => {
    const w = video.width;
    const h = video.quality ? parseInt(video.quality, 10) : NaN;
    if (w && Number.isFinite(h) && h > 0) {
      return Math.max(0.5, Math.min(3, w / h));
    }
    return 16 / 9;
  }, [video.video_id, video.width, video.quality]);
  const [aspectRatio, setAspectRatio] = useState<number>(initialAspect);
  // Toast that flashes when the user pinch-zooms.
  const [fitToast, setFitToast] = useState<null | "contain" | "cover">(null);
  // Touch gesture bookkeeping. ``swipeBlockClickRef`` is read by the <video>
  // onClick handler to skip play-toggle when the prior touch sequence was
  // actually a swipe (otherwise every swipe also toggles play). ``axis``
  // is locked after the first ~10 px of movement so the live drag preview
  // stays predictable.
  const touchRef = useRef<{
    x: number; y: number; t: number;
    lastX: number; lastY: number; lastT: number;
    moved: boolean;
    pinching: boolean;
    initialDist: number;
    lastDist: number;
    axis: "v" | "h" | null;
  } | null>(null);
  const swipeBlockClickRef = useRef(false);
  const [showChap,    setShowChap]    = useState(false);
  const [showRate,    setShowRate]    = useState(false);
  const [skippedToast, setSkippedToast] = useState<string | null>(null);

  const watchedFiredRef = useRef(false);
  const lastPosSentRef  = useRef(0);
  const resumeAppliedRef = useRef(false);

  /** User-initiated rate change: persist on the server. */
  const applyRate = useCallback((newRate: number) => {
    const v = videoRef.current; if (!v) return;
    v.playbackRate = newRate;
    setRate(newRate);
    onPlaybackUpdate?.({ rate: newRate });
  }, [onPlaybackUpdate]);

  const chapters = (video.chapters ?? []) as Chapter[];

  // ── Sync state from <video> events ─────────────────────────────────────────

  // Apply initial rate to <video> once the element exists.
  useLayoutEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = initialRate;
    setRate(initialRate);
  }, [initialRate]);

  // Reset aspect to the *new* video's known aspect (or 16/9 fallback) on
  // every track change — otherwise the previous track's aspect would
  // briefly haunt the new track's poster.
  useLayoutEffect(() => {
    setAspectRatio(initialAspect);
  }, [video.video_id, initialAspect]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTime  = () => {
      setCurrentTime(v.currentTime);
      onTick?.({ time: v.currentTime, playing: !v.paused });
      // Throttle position save to ~5s, only while playing past 3s offset.
      const now = Date.now();
      if (!v.paused && v.currentTime > 3 && now - lastPosSentRef.current > 5_000) {
        lastPosSentRef.current = now;
        onPlaybackUpdate?.({ position: v.currentTime });
      }
    };
    const onDur   = () => setDuration(v.duration || 0);
    const onPlay  = () => {
      setIsPlaying(true);
      onTick?.({ time: v.currentTime, playing: true });
      if (!watchedFiredRef.current) {
        watchedFiredRef.current = true;
        onPlaybackUpdate?.({ mark_watched: true, position: v.currentTime });
      }
    };
    const onPause = () => {
      setIsPlaying(false);
      onTick?.({ time: v.currentTime, playing: false });
      // Persist whatever the user has reached when they stop watching.
      if (v.currentTime > 1) {
        lastPosSentRef.current = Date.now();
        onPlaybackUpdate?.({ position: v.currentTime });
      }
    };
    const onRate  = () => setRate(v.playbackRate);
    const onProg  = () => {
      if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
    };
    const onLoaded = () => {
      // Snap the container aspect to the actual stream so portrait / square /
      // 4:3 videos don't get letterboxed inside a forced 16:9 frame. Done
      // here (not on a separate ``resize`` event) because videoWidth /
      // videoHeight are first valid at loadedmetadata. Audio elements have
      // no intrinsic aspect — those keep the music-cover initialAspect.
      if (v instanceof HTMLVideoElement && v.videoWidth > 0 && v.videoHeight > 0) {
        const ar = v.videoWidth / v.videoHeight;
        const clamped = Math.max(0.5, Math.min(3, ar));
        setAspectRatio(clamped);
      }
      // Resume target. Quality-switch resume beats everything else (the
      // user is mid-watch and just bumped resolution) — it overrides the
      // resume-applied flag too. Then ``?t=`` deep link, then last
      // position. Music always starts at 0 unless an explicit start was
      // requested.
      if (qualityResumeRef.current != null) {
        const dur = v.duration || 0;
        const target = qualityResumeRef.current;
        if (target > 0 && dur > 0 && target < dur - 1) {
          v.currentTime = target;
        }
        qualityResumeRef.current = null;
        return;
      }
      if (resumeAppliedRef.current) return;
      const isMusic = video.is_music || video.is_music_via_playlist;
      const dur = v.duration || 0;
      const jump = startAtSeconds != null && startAtSeconds > 0
        ? startAtSeconds
        : (isMusic ? 0 : (video.last_position_seconds ?? 0));
      if (jump > 1 && dur > 0 && jump < dur - 2) {
        v.currentTime = jump;
      }
      resumeAppliedRef.current = true;
    };

    const onEnd = () => { onEnded?.(); };
    const onErrorEvt = () => {
      // MediaError.code → message. We deliberately don't try to recover
      // here — the host page surfaces an actionable overlay (e.g. offer
      // a re-download for AV1 files that the device's decoder rejected).
      const e = v.error;
      let msg = "Video failed to play.";
      if (e) {
        switch (e.code) {
          case 1: msg = "Playback was aborted."; break;
          case 2: msg = "Network error while loading the video."; break;
          case 3: msg = "Decode error — the codec is likely unsupported on this device."; break;
          case 4: msg = "Format not supported on this device. The file is probably AV1 / VP9 and needs to be re-downloaded in H.264."; break;
        }
      }
      onMediaError?.(msg);
    };

    v.addEventListener("timeupdate",       onTime);
    v.addEventListener("durationchange",   onDur);
    v.addEventListener("play",             onPlay);
    v.addEventListener("pause",            onPause);
    v.addEventListener("ratechange",       onRate);
    v.addEventListener("progress",         onProg);
    v.addEventListener("loadedmetadata",   onLoaded);
    v.addEventListener("ended",            onEnd);
    v.addEventListener("error",            onErrorEvt);
    return () => {
      v.removeEventListener("timeupdate",     onTime);
      v.removeEventListener("durationchange", onDur);
      v.removeEventListener("play",           onPlay);
      v.removeEventListener("pause",          onPause);
      v.removeEventListener("ratechange",     onRate);
      v.removeEventListener("progress",       onProg);
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("ended",          onEnd);
      v.removeEventListener("error",          onErrorEvt);
    };
  }, [onPlaybackUpdate, onTick, onEnded, onMediaError, video.last_position_seconds]);

  // Force volume to 1 on every video element (volume control is intentionally
  // removed; users adjust at the OS / browser level).
  //
  // NOTE: deliberately NOT resetting ``muted=false`` here — the autoplay
  // effect below may set muted=true to satisfy Safari mobile's policy
  // before play() and unmute itself once playback starts. Setting muted=
  // false here would race with that.
  useLayoutEffect(() => {
    const v = videoRef.current; if (!v) return;
    v.volume = 1;
  }, [video.video_id]);

  // Best-effort auto-start.
  //
  // Why this is more involved than a single play() call: when the user
  // navigates between tracks (next / prev in a queue), Safari mobile in
  // particular loses the "user activation" that lets non-muted autoplay
  // fly. The stream URL is the same origin but the <video> element is
  // reused with a swapped src — the browser sees a fresh resource and
  // re-evaluates the autoplay policy from scratch.
  //
  // We mitigate with three measures:
  //   1. Call v.load() to flush stale state from the previous src — without
  //      it Safari sometimes leaves the element in a "decode in progress"
  //      limbo where play() succeeds but no frames are produced.
  //   2. Try play() immediately AND on every readiness milestone (loadedmetadata,
  //      loadeddata, canplay). Multiple chances catch the case where the
  //      stream wasn't decode-ready at the first attempt.
  //   3. As a last resort, set muted=true before play() — muted autoplay
  //      is always allowed — and unmute as soon as playback actually
  //      starts. This makes consecutive-track autoplay near-deterministic
  //      at the cost of an inaudible-because-muted first frame.
  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    let cancelled = false;
    let unmutedAlready = false;

    function tryUnmute() {
      if (!v || unmutedAlready) return;
      if (v.muted && !v.paused) {
        try { v.muted = false; } catch { /* ignore */ }
        unmutedAlready = true;
      }
    }

    function attempt(silent: boolean) {
      if (cancelled || !v || !v.paused) return;
      if (silent) v.muted = true;
      const p = v.play();
      if (p && typeof p.then === "function") {
        p.then(() => { if (silent) tryUnmute(); }).catch(() => {
          // Live play attempt rejected: if we tried non-muted, the next
          // ready-state event will retry silently.
          if (!silent && !cancelled) {
            // Schedule the muted fallback for the next ready event.
          }
        });
      }
    }

    try { v.load(); } catch { /* ignore */ }
    attempt(false);

    const onMeta = () => attempt(false);
    const onData = () => attempt(true);
    const onCanPlay = () => attempt(true);
    const onPlayingOnce = () => tryUnmute();

    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("loadeddata",     onData);
    v.addEventListener("canplay",        onCanPlay);
    v.addEventListener("playing",        onPlayingOnce);

    return () => {
      cancelled = true;
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("loadeddata",     onData);
      v.removeEventListener("canplay",        onCanPlay);
      v.removeEventListener("playing",        onPlayingOnce);
    };
  }, [video.video_id]);

  // ── Media Session API ──────────────────────────────────────────────────────
  //
  // Wires the system "now playing" surface (iOS Control Center, Android lock
  // screen, BT headphone buttons, macOS Touch Bar) into our player. Without
  // this the music-mode UX on phone is dead — user can't pause / skip without
  // unlocking the device.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const thumb = video.thumbnail_path ? thumbUrl(video.video_id) : video.thumbnail_url;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title:  video.title,
        artist: video.channel_name ?? "",
        album:  "",
        artwork: thumb ? [
          { src: thumb, sizes: "320x180", type: "image/jpeg" },
        ] : [],
      });
    } catch { /* older browser */ }

    const v = videoRef.current;
    const setAction = (name: MediaSessionAction, h: MediaSessionActionHandler | null) => {
      try { navigator.mediaSession.setActionHandler(name, h); } catch { /* unsupported */ }
    };
    setAction("play",  () => v?.play());
    setAction("pause", () => v?.pause());
    setAction("seekbackward", (d) => {
      if (!v) return;
      v.currentTime = Math.max(0, v.currentTime - (d.seekOffset || 10));
    });
    setAction("seekforward", (d) => {
      if (!v) return;
      v.currentTime = Math.min(v.duration || 0, v.currentTime + (d.seekOffset || 10));
    });
    setAction("seekto", (d) => {
      if (!v || d.seekTime == null) return;
      v.currentTime = d.seekTime;
    });
    setAction("previoustrack", onPrev ?? null);
    setAction("nexttrack",     onNext ?? null);

    return () => {
      const actions: MediaSessionAction[] = [
        "play","pause","seekbackward","seekforward","seekto","previoustrack","nexttrack",
      ];
      actions.forEach((a) => setAction(a, null));
    };
  }, [video.video_id, video.title, video.channel_name, video.thumbnail_path, video.thumbnail_url, onNext, onPrev]);

  // Keep the system-side scrubber in sync with our actual playhead.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!duration || !Number.isFinite(duration)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(currentTime, duration),
        playbackRate: rate,
      });
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch { /* unsupported */ }
  }, [currentTime, duration, rate, isPlaying]);


  // ── Fullscreen tracking ────────────────────────────────────────────────────

  useEffect(() => {
    const onFs = () => {
      const fsEl = document.fullscreenElement ||
                   (document as any).webkitFullscreenElement ||
                   null;
      setIsFs(!!fsEl);
    };
    document.addEventListener("fullscreenchange",        onFs);
    document.addEventListener("webkitfullscreenchange",  onFs);
    // iOS Safari: webkitEnterFullscreen on the <video> element fires
    // ``webkitbeginfullscreen`` / ``webkitendfullscreen`` events on the
    // video itself, not on the document. Wire both for consistency.
    const v = videoRef.current;
    const onBegin = () => setIsFs(true);
    const onEnd   = () => setIsFs(false);
    if (v) {
      v.addEventListener("webkitbeginfullscreen", onBegin);
      v.addEventListener("webkitendfullscreen",   onEnd);
    }
    return () => {
      document.removeEventListener("fullscreenchange",       onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
      if (v) {
        v.removeEventListener("webkitbeginfullscreen", onBegin);
        v.removeEventListener("webkitendfullscreen",   onEnd);
      }
    };
  }, []);

  // ── Auto-skip sponsor segments ─────────────────────────────────────────────

  const lastSkipped = useRef<string | null>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || segments.length === 0) return;
    const t = currentTime;
    for (const s of segments) {
      if (t >= s.start && t < s.end - 0.1 && lastSkipped.current !== s.uuid) {
        lastSkipped.current = s.uuid;
        v.currentTime = s.end + 0.05;
        const label = SEGMENT_LABELS[s.category] ?? s.category;
        setSkippedToast(`Skipped: ${label}`);
        setTimeout(() => setSkippedToast((cur) => (cur && cur.startsWith("Skipped") ? null : cur)), 1800);
        return;
      }
    }
  }, [currentTime, segments]);

  // ── Controls auto-hide ─────────────────────────────────────────────────────

  const bumpCtl = useCallback(() => {
    setShowCtl(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (alwaysShowControls) return;
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setShowCtl(false);
    }, CONTROL_HIDE_MS);
  }, [alwaysShowControls]);

  // When alwaysShowControls flips on after the fact (e.g. user marked the
  // currently-playing video as music), drop any in-flight hide timer and
  // pin the bar back open.
  useEffect(() => {
    if (!alwaysShowControls) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setShowCtl(true);
  }, [alwaysShowControls]);

  // Auto-hide while playing. Without this, mobile users would see
  // controls forever because there's no mousemove on touch devices —
  // ``bumpCtl`` only fires on desktop. Watching ``isPlaying`` lets us
  // arm / disarm the hide timer purely from media state, so tapping the
  // video to pause re-shows the controls and resuming re-arms the timer.
  useEffect(() => {
    if (alwaysShowControls) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (isPlaying) {
      hideTimer.current = setTimeout(() => {
        if (videoRef.current && !videoRef.current.paused) setShowCtl(false);
      }, CONTROL_HIDE_MS);
    } else {
      // Paused — surface controls so the play button is reachable.
      setShowCtl(true);
    }
  }, [isPlaying, alwaysShowControls]);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Persist position to the server, bypassing the play-loop throttle. */
  const savePosition = useCallback(() => {
    const v = videoRef.current; if (!v) return;
    lastPosSentRef.current = Date.now();
    onPlaybackUpdate?.({ position: v.currentTime });
  }, [onPlaybackUpdate]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // Safari sometimes leaves the element in an "uninitialised" state after
      // a blocked autoplay — calling load() before play() shakes it loose.
      if (v.readyState === 0) {
        try { v.load(); } catch { /* ignore */ }
      }
      const p = v.play();
      if (p && typeof p.then === "function") {
        p.catch(() => {
          // Manual tap rejected — fall back to muted play, then unmute as
          // soon as the element reports playing. Without this, every now
          // and then iOS Safari refuses both autoplay AND the very first
          // user tap with NotAllowedError.
          try { v.muted = true; } catch { /* ignore */ }
          const q = v.play();
          if (q && typeof q.then === "function") {
            q.then(() => {
              const unmute = () => { try { v.muted = false; } catch { /* ignore */ } };
              if (!v.paused) unmute();
              else v.addEventListener("playing", unmute, { once: true });
            }).catch((err) => console.warn("video.play() rejected even muted:", err));
          }
        });
      }
    } else {
      v.pause();
    }
  }, []);
  const skip = useCallback((delta: number) => {
    const v = videoRef.current; if (!v) return;
    v.currentTime = Math.max(0, Math.min((v.duration || 0), v.currentTime + delta));
    savePosition();
  }, [savePosition]);
  const seekTo = useCallback((t: number) => {
    const v = videoRef.current; if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, t));
  }, []);

  useImperativeHandle(forwardedRef, () => ({
    seekTo: (t: number) => { seekTo(t); savePosition(); },
    play:   () => { videoRef.current?.play(); },
    pause:  () => { videoRef.current?.pause(); },
    togglePlay: () => { togglePlay(); },
    reload: () => {
      const v = videoRef.current; if (!v) return;
      // Re-arm the autoplay state machine so the multi-event retry chain
      // in the [video.video_id] effect kicks in again on the new bytes.
      resumeAppliedRef.current = false;
      watchedFiredRef.current  = false;
      try { v.load(); } catch { /* ignore */ }
      const p = v.play();
      if (p && typeof p.then === "function") {
        p.catch(() => { /* will be retried on canplay via the autoplay effect */ });
      }
    },
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    isPlaying:      () => !!(videoRef.current && !videoRef.current.paused && !videoRef.current.ended),
  }), [seekTo, savePosition, togglePlay]);
  const togglePiP = useCallback(async () => {
    const v = videoRef.current; if (!v) return;
    if (!(v instanceof HTMLVideoElement)) return;  // audio has no PiP
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch { /* user rejected or unsupported */ }
  }, []);
  const toggleFs = useCallback(async () => {
    const c = containerRef.current; if (!c) return;
    const v = videoRef.current;

    // EXIT
    if (document.fullscreenElement || (document as any).webkitFullscreenElement || isFs) {
      try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* */ }
      try { (document as any).webkitExitFullscreen?.(); } catch { /* */ }
      try {
        const so: any = (screen as any).orientation;
        so?.unlock?.();
      } catch { /* */ }
      return;
    }

    // ENTER — platform-aware path so phones actually land in *landscape*,
    // not portrait-fullscreen-with-black-bars.
    //
    // iOS Safari: ``document.requestFullscreen`` on a <div> never rotates
    // to landscape (the spec doesn't allow orientation control on iOS).
    // The ONLY way to get auto-landscape fullscreen on iPhone is the
    // legacy ``HTMLVideoElement.webkitEnterFullscreen()`` API, which
    // drops the video into the system player in landscape with native
    // iOS controls. We lose the custom UI overlay in this mode — that's
    // the iOS reality.
    //
    // Android Chrome: requestFullscreen on the container DOES rotate when
    // we follow up with ``screen.orientation.lock('landscape')``.
    //
    // Desktop: requestFullscreen on the container, no orientation lock.
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
                || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    let entered = false;

    // iOS path first: video.webkitEnterFullscreen → real landscape. Only
    // valid for HTMLVideoElement — audio elements have no fullscreen
    // concept. Music mode falls through to the generic Fullscreen API on
    // the container (which just enlarges the cover image).
    if (isIOS && v instanceof HTMLVideoElement && (v as any).webkitEnterFullscreen) {
      try { (v as any).webkitEnterFullscreen(); entered = true; } catch { /* */ }
    }

    // Generic Fullscreen API path (desktop + Android + Safari 16.4+).
    if (!entered && c.requestFullscreen) {
      try { await c.requestFullscreen(); entered = true; } catch { /* */ }
    } else if (!entered && (c as any).webkitRequestFullscreen) {
      try { (c as any).webkitRequestFullscreen(); entered = true; } catch { /* */ }
    }

    // Last-ditch iOS fallback if we somehow missed the iOS branch above.
    if (!entered && v instanceof HTMLVideoElement && (v as any).webkitEnterFullscreen) {
      try { (v as any).webkitEnterFullscreen(); entered = true; } catch { /* */ }
    }

    // Force landscape on devices that support it (Android Chrome / Edge,
    // some PWA contexts). iOS Safari rejects with NotSupportedError —
    // silently swallowed. Must happen AFTER fullscreen so the orientation
    // permission gate accepts it.
    if (entered) {
      try {
        const so: any = (screen as any).orientation;
        if (so?.lock) await so.lock("landscape");
      } catch { /* */ }
    }
  }, [isFs]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't capture when typing in inputs
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      // Don't trigger when a modifier is held (browser shortcuts).
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const v = videoRef.current; if (!v) return;
      // Letters: lowercase for robustness (caps lock, shift, layout). Also map
      // some Cyrillic keys to their QWERTY siblings so the same physical key
      // works regardless of input language.
      const RU_TO_EN: Record<string, string> = {
        "л": "k",   // play/pause
        "о": "j",   // -10s
        "д": "l",   // +10s
        "а": "f",   // fullscreen
        "ш": "i",   // PiP
        "с": "c",   // captions
        "б": ",",   // speed down
        "ю": ".",   // speed up
        "т": "n",   // next
        "з": "p",   // prev
      };
      const raw = e.key;
      if (raw === "?") { e.preventDefault(); setShowHelp((s) => !s); bumpCtl(); return; }
      const key = RU_TO_EN[raw.toLowerCase()] ?? raw.toLowerCase();
      switch (key) {
        case " ":
        case "k": e.preventDefault(); togglePlay(); break;
        case "j": skip(-10); break;
        case "l": skip(10); break;
        case "arrowleft":  skip(-5); break;
        case "arrowright": skip(5); break;
        case "f": e.preventDefault(); toggleFs();  break;
        case "i": e.preventDefault(); togglePiP(); break;
        case "c": setShowCC((s) => !s); break;
        case "n": if (onNext) { e.preventDefault(); onNext(); } break;
        case "p": if (onPrev) { e.preventDefault(); onPrev(); } break;
        case ",": { const i = closestSpeedIndex(rate); applyRate(SPEEDS[Math.max(0, i - 1)]); break; }
        case ".": { const i = closestSpeedIndex(rate); applyRate(SPEEDS[Math.min(SPEEDS.length - 1, i + 1)]); break; }
        default:
          if (/^[0-9]$/.test(raw)) {
            const pct = Number(raw) / 10;
            seekTo((v.duration || 0) * pct);
          }
      }
      bumpCtl();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyRate, bumpCtl, rate, seekTo, skip, togglePlay, toggleFs, togglePiP, onNext, onPrev]);

  // ── Subtitles toggle ───────────────────────────────────────────────────────

  useLayoutEffect(() => {
    const v = videoRef.current; if (!v) return;
    for (let i = 0; i < v.textTracks.length; i++) {
      v.textTracks[i].mode = showCC ? "showing" : "hidden";
    }
  }, [showCC]);

  // ── Seek bar interaction ───────────────────────────────────────────────────

  const seekRef = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [hoverPct, setHoverPct]   = useState<number | null>(null);

  const pctFromEvent = (e: React.PointerEvent): number | null => {
    const el = seekRef.current; if (!el) return null;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };
  const onSeekDown = (e: React.PointerEvent) => {
    setScrubbing(true);
    // Capture the pointer so the whole drag is delivered here even if the
    // finger/cursor wanders off the (thin) bar — this is what makes a swipe
    // scrub like YouTube instead of registering only the initial tap.
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = pctFromEvent(e);
    if (p != null) { setHoverPct(p); seekTo(p * (duration || 0)); }
  };
  const onSeekMove = (e: React.PointerEvent) => {
    const p = pctFromEvent(e);
    if (p == null) return;
    setHoverPct(p);
    // While scrubbing (touch or mouse-drag) follow the pointer continuously.
    if (scrubbing || (e.buttons & 1)) seekTo(p * (duration || 0));
  };
  const onSeekUp = (e: React.PointerEvent) => {
    setScrubbing(false);
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
    // Persist final position right after a manual scrub.
    savePosition();
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const pct       = duration ? (currentTime / duration) * 100 : 0;
  const bufferPct = duration ? (buffered    / duration) * 100 : 0;
  const currentChapter = useMemo(() => {
    if (!chapters.length) return null;
    return chapters.find(
      (c) => currentTime >= c.start && (c.end == null || currentTime < c.end),
    ) ?? null;
  }, [chapters, currentTime]);

  // ── Background audio swap (music mode + iOS) ──────────────────────────────
  //
  // iOS Safari pauses <video playsInline> the moment the screen locks. The
  // workaround is to play an <audio> element while the page is hidden — the
  // audio spec keeps it alive across screen lock. When the user comes back,
  // we swap audio→video and resync the timeline.
  //
  // Only armed in music mode (the visual clip is the whole point for
  // regular videos; we don't want them silently mutating either).
  useEffect(() => {
    if (!isMusicMode) return;

    function onVis() {
      const v = videoRef.current;
      const a = audioBackupRef.current;
      if (!v || !a) return;

      if (document.hidden) {
        // Going to background. If video was playing, switch the audio
        // element on at the same offset and pause the video.
        if (!v.paused) {
          try { a.currentTime = v.currentTime; } catch { /* */ }
          a.playbackRate = v.playbackRate;
          const p = a.play();
          if (p && typeof p.then === "function") {
            p.catch(() => { /* iOS may block — best effort */ });
          }
          try { v.pause(); } catch { /* */ }
        }
      } else {
        // Returning to foreground. Mirror the inverse: if audio was
        // playing, resume the video from the audio's clock and pause
        // the audio so visuals carry the audio track again.
        if (!a.paused) {
          try { v.currentTime = a.currentTime; } catch { /* */ }
          v.playbackRate = a.playbackRate;
          const p = v.play();
          if (p && typeof p.then === "function") {
            p.catch(() => { /* */ });
          }
          try { a.pause(); } catch { /* */ }
        }
      }
    }

    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [isMusicMode, video.video_id]);

  // ── Touch gestures ─────────────────────────────────────────────────────────
  //
  // Swipes on the <video> element (NOT on the controls / seek bar — those have
  // their own pointer handlers and we don't want to clobber them):
  //   • swipe-up                → enter fullscreen
  //   • swipe-down (fullscreen) → exit fullscreen
  //   • swipe-down (inline)     → collapse to mini-PiP (host-defined)
  //   • swipe-left              → next track  (if a queue exists)
  //   • swipe-right             → prev track  (if a queue exists)
  //   • two-finger pinch out    → cover (crop) mode
  //   • two-finger pinch in     → contain (letterbox) mode
  //
  // We carefully suppress the tap that would otherwise fire after a swipe by
  // setting swipeBlockClickRef in touchend and reading it in the <video>
  // onClick handler.
  // Commit thresholds. ``SWIPE_MIN_PX`` is the static distance threshold;
  // ``SWIPE_VELOCITY_PXPMS`` lets a *fast* short flick still commit. Most
  // people flick about 0.6–1.2 px/ms with intent.
  const SWIPE_MIN_PX = 50;
  const SWIPE_VELOCITY_PXPMS = 0.5;
  const SWIPE_AXIS_RATIO = 1.4;
  const PINCH_TRIGGER  = 0.18;
  // Damping factor so the player only travels ~half as far as the finger
  // — the gesture feels resistive, like dragging in iOS Photos.
  const DRAG_DAMP = 0.55;
  // Hard cap on visible drag travel before easing flattens it (prevents the
  // player from disappearing on aggressive swipes mid-gesture).
  const DRAG_MAX_PX = 280;

  const pinchDistance = (touches: TouchList | React.TouchList): number => {
    const a = touches[0], b = touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  const flashFit = useCallback((mode: "contain" | "cover") => {
    setFitToast(mode);
    setTimeout(() => setFitToast((cur) => (cur === mode ? null : cur)), 900);
  }, []);

  /** Direct DOM mutation while dragging — re-rendering React on every
   *  touchmove (60+ fps) costs frame budget and stutters on iOS. The
   *  transform is reset (with a CSS transition) in onTouchEnd. */
  const applyDragTransform = (dx: number, dy: number, axis: "v" | "h") => {
    const el = containerRef.current; if (!el) return;
    el.style.transition = "none";
    if (axis === "v") {
      if (dy >= 0) {
        // Down — translate with rubber-band easing + opacity / scale fade.
        const eased = dy > DRAG_MAX_PX
          ? DRAG_MAX_PX + (dy - DRAG_MAX_PX) * 0.2
          : dy;
        const t = Math.min(eased / 320, 1);
        const opacity = 1 - 0.45 * t;
        const scale   = 1 - 0.06 * t;
        el.style.transform = `translateY(${eased * DRAG_DAMP}px) scale(${scale})`;
        el.style.opacity   = String(opacity);
      } else {
        // Up — slight scale-up + small lift, no fade.
        const absDy = -dy;
        const eased = absDy > DRAG_MAX_PX
          ? DRAG_MAX_PX + (absDy - DRAG_MAX_PX) * 0.15
          : absDy;
        const t = Math.min(eased / 320, 1);
        const scale = 1 + 0.04 * t;
        el.style.transform = `translateY(${-eased * 0.25}px) scale(${scale})`;
        el.style.opacity   = "1";
      }
    } else {
      // Horizontal — translate + slight opacity fade so it feels like the
      // player is being swept off-stage in the direction of travel.
      const sign = Math.sign(dx);
      const abs  = Math.abs(dx);
      const eased = abs > DRAG_MAX_PX
        ? DRAG_MAX_PX + (abs - DRAG_MAX_PX) * 0.2
        : abs;
      const t = Math.min(eased / 320, 1);
      const opacity = 1 - 0.35 * t;
      el.style.transform = `translateX(${sign * eased * 0.7}px)`;
      el.style.opacity   = String(opacity);
    }
  };

  const resetDragTransform = (opts?: { snap?: boolean }) => {
    const el = containerRef.current; if (!el) return;
    el.style.transition = opts?.snap
      ? "none"
      : "transform 300ms cubic-bezier(.2,.85,.25,1), opacity 220ms";
    el.style.transform = "";
    el.style.opacity   = "";
  };

  const onVideoTouchStart = useCallback((e: React.TouchEvent<HTMLElement>) => {
    // Any touch wakes the controls + restarts the auto-hide timer — same
    // contract as a mouse moving on desktop. Without this the bar would
    // never auto-hide on phones (no mousemove available).
    bumpCtl();
    if (e.touches.length === 2) {
      const d = pinchDistance(e.touches);
      touchRef.current = {
        x: 0, y: 0, t: Date.now(),
        lastX: 0, lastY: 0, lastT: Date.now(),
        moved: false, pinching: true, initialDist: d, lastDist: d, axis: null,
      };
      return;
    }
    const tt = e.touches[0];
    const now = Date.now();
    touchRef.current = {
      x: tt.clientX, y: tt.clientY, t: now,
      lastX: tt.clientX, lastY: tt.clientY, lastT: now,
      moved: false, pinching: false, initialDist: 0, lastDist: 0, axis: null,
    };
    // Cancel any in-flight spring-back animation — the user is touching
    // again, the drag should pick up the finger immediately.
    const el = containerRef.current;
    if (el) { el.style.transition = "none"; }
  }, [bumpCtl]);

  const onVideoTouchMove = useCallback((e: React.TouchEvent<HTMLElement>) => {
    const st = touchRef.current; if (!st) return;
    if (st.pinching && e.touches.length === 2) {
      st.lastDist = pinchDistance(e.touches);
      return;
    }
    if (e.touches.length !== 1) return;
    const tt = e.touches[0];
    const dx = tt.clientX - st.x;
    const dy = tt.clientY - st.y;
    st.lastX = tt.clientX; st.lastY = tt.clientY; st.lastT = Date.now();
    if (!st.moved && Math.hypot(dx, dy) > 10) st.moved = true;
    if (!st.moved) return;

    // Lock axis on first significant movement. Stays locked for the rest
    // of the gesture so the drag preview doesn't ping-pong between axes.
    if (!st.axis) {
      const absX = Math.abs(dx), absY = Math.abs(dy);
      if (absX < 8 && absY < 8) return;
      if (absY > absX * 1.1) st.axis = "v";
      else if (absX > absY * 1.1) st.axis = "h";
      else return;  // ambiguous diagonal yet — wait for more movement
    }
    applyDragTransform(dx, dy, st.axis);
  }, []);

  const onVideoTouchEnd = useCallback((e: React.TouchEvent<HTMLElement>) => {
    const st = touchRef.current; if (!st) return;

    // Pinch resolves on the first finger lift — that's when ``touches`` drops
    // back to 1 (or 0). Compare the recorded extremes to decide direction.
    if (st.pinching) {
      const ratio = st.initialDist > 0 ? st.lastDist / st.initialDist : 1;
      if (ratio > 1 + PINCH_TRIGGER) {
        setObjectFit("cover");
        flashFit("cover");
      } else if (ratio < 1 - PINCH_TRIGGER) {
        setObjectFit("contain");
        flashFit("contain");
      }
      touchRef.current = null;
      swipeBlockClickRef.current = true;
      setTimeout(() => { swipeBlockClickRef.current = false; }, 350);
      return;
    }

    if (!st.moved) { touchRef.current = null; return; }  // small drift → tap

    const tt = e.changedTouches[0];
    const dx = tt.clientX - st.x;
    const dy = tt.clientY - st.y;
    const dt = Math.max(1, Date.now() - st.t);
    const vx = dx / dt;  // px/ms
    const vy = dy / dt;
    const absX = Math.abs(dx), absY = Math.abs(dy);
    const axis = st.axis;
    touchRef.current = null;

    const commit = () => {
      swipeBlockClickRef.current = true;
      setTimeout(() => { swipeBlockClickRef.current = false; }, 350);
    };

    // Decide commit: distance threshold OR velocity threshold on the
    // dominant axis. Diagonal drags resolve to whichever axis has more
    // dominance (the axis lock from onTouchMove already prevents this in
    // most cases).
    const verticalCommit = axis === "v" && (
      absY >= SWIPE_MIN_PX || Math.abs(vy) >= SWIPE_VELOCITY_PXPMS
    ) && absY > absX * SWIPE_AXIS_RATIO;
    const horizontalCommit = axis === "h" && (
      absX >= SWIPE_MIN_PX || Math.abs(vx) >= SWIPE_VELOCITY_PXPMS
    ) && absX > absY * SWIPE_AXIS_RATIO;

    if (verticalCommit) {
      if (dy < 0) {
        if (!isFs) {
          commit();
          // Hold the lifted state during the brief fullscreen handoff so
          // the transition into FS doesn't visually "snap back" first.
          resetDragTransform({ snap: true });
          toggleFs();
          return;
        }
      } else {
        if (isFs) { commit(); resetDragTransform(); toggleFs(); return; }
        if (onCollapseToMini) {
          commit();
          // Keep the dropped-down transform briefly so the navigation
          // feels continuous with the drag, then unmount.
          onCollapseToMini();
          return;
        }
      }
    } else if (horizontalCommit) {
      if (dx < 0 && onNext) { commit(); resetDragTransform({ snap: true }); onNext(); return; }
      if (dx > 0 && onPrev) { commit(); resetDragTransform({ snap: true }); onPrev(); return; }
    }

    // No commit — spring back.
    resetDragTransform();
  }, [flashFit, isFs, toggleFs, onCollapseToMini, onNext, onPrev]);

  const onVideoTouchCancel = useCallback(() => {
    touchRef.current = null;
    resetDragTransform();
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      // YouTube-style framing: a fixed 16:9 container hosts the actual
      // <video> via object-contain. Square / vertical / 4:3 sources get
      // pillarboxed instead of letting their natural aspect grow the page.
      //
      // The height cap is 70vh, and the matching width cap (calc(70vh * 16/9))
      // keeps the container itself 16:9 even when the height cap kicks in on
      // wide / ultra-wide displays — otherwise the container would stay full
      // column width with thick black bars on the sides.
      className={`custom-player relative overflow-hidden bg-black select-none ${
        isFs
          ? "fixed inset-0 flex items-center justify-center rounded-none"
          : "aspect-video w-full max-h-[70vh] max-w-[calc(70vh*16/9)] mx-auto rounded-none sm:rounded-xl"
      }`}
      onMouseMove={bumpCtl}
      onMouseLeave={() => { if (isPlaying && !alwaysShowControls) setShowCtl(false); }}
    >
        <video
          ref={videoRef as React.RefObject<HTMLVideoElement>}
          src={streamUrl(video.video_id, selectedHeight)}
          // Show the thumbnail while paused / pre-load — without this iOS
          // Safari renders a black square because autoplay is blocked.
          poster={video.thumbnail_path ? thumbUrl(video.video_id) : (video.thumbnail_url ?? undefined)}
          playsInline
          // NOTE: no ``autoPlay`` attribute. iOS / Android Chrome block autoplay
          // for non-muted videos anyway — leaving the attribute on caused
          // intermittent failures where the rejected autoplay attempt put the
          // element into a bad state and the user's first tap also no-op'd.
          // We try to play() once on mount below; if the browser declines, the
          // big centre play button kicks it off on first tap (which counts as a
          // user gesture and is always honoured).
          preload="metadata"
          onTouchStart={onVideoTouchStart}
          onTouchMove={onVideoTouchMove}
          onTouchEnd={onVideoTouchEnd}
          onTouchCancel={onVideoTouchCancel}
          onClick={(e) => {
            if (swipeBlockClickRef.current) return;
            const now = Date.now();
            const target = e.currentTarget as HTMLElement;
            const rect = target.getBoundingClientRect();
            const xRel = (e.clientX - rect.left) / rect.width;
            const last = lastTapRef.current;
            lastTapRef.current = { t: now, x: xRel };
            if (last && now - last.t < 300 && Math.abs(last.x - xRel) < 0.1) {
              if (xRel < 0.33) { skip(-10); setSeekToast({ dir: "back", n: 10 }); setTimeout(() => setSeekToast(null), 600); lastTapRef.current = null; return; }
              if (xRel > 0.67) { skip(10);  setSeekToast({ dir: "fwd",  n: 10 }); setTimeout(() => setSeekToast(null), 600); lastTapRef.current = null; return; }
              toggleFs(); lastTapRef.current = null; return;
            }
            togglePlay();
          }}
          // Border-radius lives on the <video> element directly — Safari/
          // Chrome are inconsistent about clipping a child video to a parent
          // rounded overflow:hidden, leaving black triangles in the corners.
          //
          // ``touch-none`` lets the swipe gestures own all touch events.
          //
          // ``w-full h-full`` fills the 16:9 container set on the wrapper
          // above; ``object-contain`` then pillarboxes/letterboxes the
          // actual stream inside that box for non-16:9 sources.
          className={`block bg-black w-full h-full touch-none ${
            isFs
              ? `${objectFit === "cover" ? "object-cover" : "object-contain"}`
              : `${objectFit === "cover" ? "object-cover" : "object-contain"} sm:rounded-xl`
          }`}
        >
          {video.has_subtitle && !isTouch && (
            <track
              kind="subtitles"
              src={subtitleUrl(video.video_id)}
              srcLang="en"
              label="English"
              default={showCC}
            />
          )}
        </video>

        {/* Hidden audio backup — only mounted in music mode. Carries the
         *  audio track when the page/screen goes to background and iOS
         *  pauses the <video>. Preload "auto" means the bytes are warm
         *  when the visibilitychange handler tries to play it. */}
        {isMusicMode && (
          <audio
            ref={audioBackupRef}
            src={streamUrl(video.video_id, selectedHeight)}
            preload="auto"
            className="hidden"
            aria-hidden
          />
        )}

      {/* Center overlay: rewind / play / skip */}
      <div
        className={`pointer-events-none absolute inset-0 flex items-center justify-center gap-10 transition-opacity duration-200 ${
          showCtl ? "opacity-100" : "opacity-0"
        }`}
      >
        <CenterBtn label="Rewind 10s" onClick={() => skip(-10)}>
          <RotateCcw className="h-7 w-7" />
          <span className="absolute text-[10px] font-bold">10</span>
        </CenterBtn>
        <CenterBtn label={isPlaying ? "Pause" : "Play"} onClick={togglePlay} big>
          {isPlaying ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8" />}
        </CenterBtn>
        <CenterBtn label="Skip 10s" onClick={() => skip(10)}>
          <RotateCw className="h-7 w-7" />
          <span className="absolute text-[10px] font-bold">10</span>
        </CenterBtn>
      </div>

      {/* Skipped toast (sponsor-block) */}
      {skippedToast && (
        <div className="absolute left-4 bottom-24 rounded-full bg-black/80 px-3 py-1 text-xs">
          {skippedToast}
        </div>
      )}

      {/* Pinch-zoom visual feedback */}
      {fitToast && (
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2">
          <div className="rounded-full bg-black/75 backdrop-blur-sm px-3 py-1 text-xs font-semibold text-white">
            {fitToast === "cover" ? "Fill screen" : "Fit"}
          </div>
        </div>
      )}

      {/* Double-tap seek visual feedback */}
      {showHelp && <KeyboardHelp onClose={() => setShowHelp(false)} />}

      {seekToast && (
        <div className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${
          seekToast.dir === "back" ? "left-6" : "right-6"
        }`}>
          <div className="grid place-items-center rounded-full bg-black/65 backdrop-blur-sm px-4 py-3 text-white animate-pulse">
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              {seekToast.dir === "back"
                ? <><RotateCcw className="h-4 w-4" /> −{seekToast.n}s</>
                : <>+{seekToast.n}s <RotateCw className="h-4 w-4" /></>}
            </div>
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <div
        className={`absolute inset-x-0 bottom-0 px-3 pb-2 pt-8 transition-opacity duration-200 ${
          showCtl ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0))" }}
      >
        {/* Seek — the outer div is a tall, touch-friendly hit area; the thin
            visual bar lives inside it. `touch-none` is essential: without it
            the browser claims the horizontal touch-drag as a scroll/pan and
            cancels the pointer stream, so only taps would register (never a
            swipe scrub). */}
        <div
          ref={seekRef}
          className="group/seek relative flex cursor-pointer touch-none select-none items-center py-2.5 -my-1.5"
          onPointerDown={onSeekDown}
          onPointerMove={onSeekMove}
          onPointerUp={onSeekUp}
          onPointerCancel={onSeekUp}
          onPointerLeave={() => { if (!scrubbing) setHoverPct(null); }}
        >
        <div className="relative h-1.5 w-full rounded-full transition-all group-hover/seek:h-2">
          {/* Track */}
          <div className="absolute inset-0 rounded-full bg-white/25" />
          {/* Buffered */}
          <div className="absolute inset-y-0 left-0 rounded-full bg-white/40" style={{ width: `${bufferPct}%` }} />
          {/* Sponsor segments */}
          {duration > 0 && segments.map((s) => (
            <div
              key={s.uuid}
              className="absolute inset-y-0 rounded-full"
              style={{
                left:   `${(s.start / duration) * 100}%`,
                width:  `${((s.end - s.start) / duration) * 100}%`,
                background: SEGMENT_COLORS[s.category] ?? "#888",
                opacity: 0.85,
              }}
              title={SEGMENT_LABELS[s.category] ?? s.category}
            />
          ))}
          {/* Chapter ticks */}
          {duration > 0 && chapters.slice(1).map((c, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 w-px bg-black/70"
              style={{ left: `${(c.start / duration) * 100}%` }}
            />
          ))}
          {/* Current chapter — faint band highlighting its span on the bar. */}
          {currentChapter && duration > 0 && (
            <div
              className="absolute inset-y-0 rounded-full bg-white/12"
              style={{
                left:  `${(currentChapter.start / duration) * 100}%`,
                width: `${(((currentChapter.end ?? duration) - currentChapter.start) / duration) * 100}%`,
              }}
            />
          )}
          {/* Progress — apricot accent (playback), red stays for danger/live. */}
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${pct}%` }} />
          {/* Thumb — accent with a soft glow, grows on scrub/hover. */}
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2 top-1/2 h-3.5 w-3.5 rounded-full bg-accent shadow-[0_0_10px_color-mix(in_oklab,var(--color-accent)_70%,transparent)] transition-transform duration-150 group-hover/seek:scale-110 motion-reduce:transition-none"
            style={{ left: `${pct}%` }}
          />
          {/* Hover time + chapter title (YouTube-style) */}
          {hoverPct !== null && (() => {
            const hoverTime = hoverPct * duration;
            const hoverChapter = chapters.find(
              (c) => hoverTime >= c.start && (c.end == null || hoverTime < c.end),
            );
            return (
              <div
                className="pointer-events-none absolute -translate-x-1/2 bottom-full mb-2 rounded-md bg-black/90 px-2 py-1 text-xs font-medium text-zinc-100 whitespace-nowrap max-w-xs"
                style={{ left: `${hoverPct * 100}%` }}
              >
                {hoverChapter && (
                  <div className="truncate text-zinc-300 max-w-[220px]">{hoverChapter.title}</div>
                )}
                <div className="font-mono tabular-nums">{formatDuration(hoverTime)}</div>
              </div>
            );
          })()}
        </div>
        </div>

        {/* Button row — touch-friendly sizes. Prev shown only in queue
            contexts (playlist / music) where back-stepping is meaningful;
            otherwise it's noise. */}
        <div className="mt-1 flex items-center gap-0.5 text-zinc-100">
          {showPrevControl && (
            <IconBtn label="Previous (P)" onClick={() => onPrev?.()} disabled={!onPrev}>
              <SkipBack className="h-6 w-6" />
            </IconBtn>
          )}
          <IconBtn label={isPlaying ? "Pause" : "Play"} onClick={togglePlay}>
            {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
          </IconBtn>
          <IconBtn label="Next (N)" onClick={() => onNext?.()} disabled={!onNext}>
            <SkipForward className="h-6 w-6" />
          </IconBtn>

          <span className="ml-2 text-xs sm:text-sm tabular-nums text-zinc-300">
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>

          {currentChapter && (
            <span className="hidden sm:inline ml-3 truncate text-sm font-medium text-accent" title={currentChapter.title}>
              {currentChapter.title}
            </span>
          )}

          <div className="flex-1" />

          {/* Speed */}
          <SpeedPicker
            rate={rate}
            open={showRate}
            onToggle={() => { setShowRate((x) => !x); setShowChap(false); }}
            onPick={(s) => { applyRate(s); setShowRate(false); }}
            onClose={() => setShowRate(false)}
          />

          {/* Quality picker — current resolution + downloaded variants +
              "+ Add" rows to fetch another resolution on demand. */}
          <QualityMenu
            primaryHeight={video.quality ? parseInt(video.quality, 10) : null}
            variants={variants}
            selectedHeight={selectedHeight}
            onSelect={(h) => {
              if (h === selectedHeight) return;
              const v = videoRef.current;
              qualityResumeRef.current = v?.currentTime ?? null;
              resumeAppliedRef.current = false;
              setSelectedHeight(h);
            }}
            onAddHeight={(h) => variantMut.mutate(h)}
            onDeleteVariant={(id) => variantDeleteMut.mutate(id)}
            addPending={variantMut.isPending}
          />

          {/* Chapters */}
          {chapters.length > 1 && (
            <div className="relative">
              <IconBtn label="Chapters" active={showChap} onClick={() => { setShowChap((x) => !x); setShowRate(false); }}>
                <ListVideo className="h-6 w-6" />
              </IconBtn>
              {showChap && (
                <Menu align="right" width={320}>
                  {chapters.map((c, i) => {
                    const active = currentChapter && currentChapter.start === c.start;
                    return (
                      <button
                        key={i}
                        onClick={() => { seekTo(c.start); setShowChap(false); }}
                        className={`flex w-full items-start gap-3 px-3 py-2 text-left text-sm hover:bg-white/5 ${
                          active ? "bg-accent/12" : ""
                        }`}
                      >
                        <span className={`font-mono text-xs mt-0.5 ${active ? "text-accent" : "text-zinc-400"}`}>{formatDuration(c.start)}</span>
                        <span className={`flex-1 line-clamp-2 ${active ? "font-semibold text-accent" : ""}`}>{c.title}</span>
                      </button>
                    );
                  })}
                </Menu>
              )}
            </div>
          )}

          {/* Subtitles — hidden on mobile entirely (controls are scarce there
              and the track element below is also gated by the same media
              query, so CC really stays off on phones). */}
          {video.has_subtitle && (
            <div className="hidden sm:inline">
              <IconBtn label="Subtitles (C)" active={showCC} onClick={() => setShowCC((s) => !s)}>
                <Subtitles className="h-6 w-6" />
              </IconBtn>
            </div>
          )}
          <IconBtn label="Picture in Picture (I)" onClick={togglePiP}>
            <PictureInPicture2 className="h-6 w-6" />
          </IconBtn>
          <IconBtn label="Fullscreen (F)" onClick={toggleFs}>
            {isFs ? <Minimize className="h-6 w-6" /> : <Maximize className="h-6 w-6" />}
          </IconBtn>
        </div>
      </div>
    </div>
  );
});

/** True on touch-first devices (phones / tablets). Used to gate UI that's
 *  cumbersome on touch (subtitle toggle, since the track element itself is
 *  also disabled — no way to turn it on). */
function useIsTouch(): boolean {
  const [touch, setTouch] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(hover: none) and (pointer: coarse)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(hover: none) and (pointer: coarse)");
    const onChange = (e: MediaQueryListEvent) => setTouch(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return touch;
}

// Find the SPEEDS index closest to `rate` (handles arbitrary stored rates like 1.1).
function closestSpeedIndex(rate: number): number {
  let best = 0, bestDelta = Infinity;
  for (let i = 0; i < SPEEDS.length; i++) {
    const d = Math.abs(SPEEDS[i] - rate);
    if (d < bestDelta) { bestDelta = d; best = i; }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────

function CenterBtn({ children, onClick, label, big }: {
  children: React.ReactNode; onClick: () => void; label: string; big?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`pointer-events-auto relative grid place-items-center rounded-full bg-black/55 text-white hover:bg-black/70 ${
        big ? "h-16 w-16" : "h-12 w-12"
      }`}
    >
      {children}
    </button>
  );
}

function IconBtn({
  children, onClick, label, active, disabled,
}: {
  children: React.ReactNode; onClick: () => void; label: string; active?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      // Touch-friendly: 44×44 minimum on phone (Apple HIG), tighter on desktop.
      className={`grid h-11 w-11 sm:h-10 sm:w-10 place-items-center rounded-full transition-colors ${
        disabled ? "text-zinc-600 cursor-not-allowed"
                 : `hover:bg-white/10 active:bg-white/20 ${active ? "bg-white/15" : ""}`
      }`}
    >
      {children}
    </button>
  );
}

function Menu({ children, align = "left", width = 160 }: {
  children: React.ReactNode; align?: "left" | "right"; width?: number;
}) {
  return (
    <div
      className="absolute bottom-12 rounded-xl bg-zinc-900/95 shadow-2xl shadow-black/50 ring-1 ring-white/10 py-1 overflow-y-auto max-h-80"
      style={{ width, [align]: 0 } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

/** Speed menu rendered through a Portal so the player's ``overflow-hidden``
 *  doesn't clip it. Opens above the trigger button when there's room,
 *  centered horizontally so it never falls off the side of a phone. */
function SpeedPicker({
  rate, open, onToggle, onPick, onClose,
}: {
  rate: number;
  open: boolean;
  onToggle: () => void;
  onPick: (s: number) => void;
  onClose: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const el = btnRef.current; if (!el) return;
    function place() {
      const r = el!.getBoundingClientRect();
      const menuW = 132;
      // Clamp inside viewport with a 8px gutter.
      const left = Math.max(8, Math.min(window.innerWidth - menuW - 8,
                                        r.left + r.width / 2 - menuW / 2));
      const top  = r.top - 8;   // open upward; translate-y in style
      setPos({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: Event) {
      const t = e.target as Node | null;
      if (t && btnRef.current?.contains(t)) return;
      // Anything outside the button or menu = close. Menu has class hook.
      if (!(t instanceof Element) || !t.closest("[data-speed-menu]")) onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [open, onClose]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={onToggle}
        className="rounded-full px-3 py-1.5 text-sm font-semibold hover:bg-white/10 active:bg-white/20"
      >
        {rate}×
      </button>
      {open && pos && createPortal(
        <div
          data-speed-menu
          style={{
            position: "fixed",
            top:  pos.top,
            left: pos.left,
            width: 132,
            transform: "translateY(-100%)",
          }}
          className="z-[60] rounded-xl bg-zinc-900/98 shadow-2xl shadow-black/50 ring-1 ring-white/10 py-1 max-h-[60vh] overflow-y-auto"
        >
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => onPick(s)}
              className={`flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-white/5 ${
                rate === s ? "bg-accent/12 font-semibold text-accent" : "text-zinc-400"
              }`}
            >
              <span>{s}×</span>
              {rate === s && <span className="text-accent">✓</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}




// ─────────────────────────────────────────────────────────────────────────────
// Quality picker — small chip in the bottom bar; click opens a Portal-backed
// menu so it isn't clipped by the player's overflow-hidden container.

const QUALITY_OPTIONS = [360, 480, 720, 1080];

function QualityMenu({
  primaryHeight, variants, selectedHeight, onSelect, onAddHeight, onDeleteVariant, addPending,
}: {
  primaryHeight: number | null;
  variants: VideoVariant[];
  selectedHeight: number | null;
  onSelect: (h: number | null) => void;
  onAddHeight: (h: number) => void;
  onDeleteVariant: (id: number) => void;
  addPending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const el = btnRef.current; if (!el) return;
    function place() {
      const r = el!.getBoundingClientRect();
      const menuW = 220;
      const left = Math.max(8, Math.min(window.innerWidth - menuW - 8,
                                        r.left + r.width / 2 - menuW / 2));
      setPos({ top: r.top - 8, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: Event) {
      const t = e.target as Node | null;
      if (t && btnRef.current?.contains(t)) return;
      if (!(t instanceof Element) || !t.closest("[data-quality-menu]")) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [open]);

  const variantByHeight = new Map<number, VideoVariant>();
  for (const v of variants) variantByHeight.set(v.height, v);

  // Heights to show in the picker = primary + downloaded variants, sorted
  // descending. "Add another" section lists standard heights that aren't
  // present yet (and aren't above the primary — no point asking for a
  // resolution YouTube doesn't have).
  const presentHeights = new Set<number>();
  if (primaryHeight) presentHeights.add(primaryHeight);
  for (const v of variants) presentHeights.add(v.height);
  const orderedPresent = [...presentHeights].sort((a, b) => b - a);
  const cap = primaryHeight ?? 1080;
  const addable = QUALITY_OPTIONS.filter((h) => !presentHeights.has(h) && h <= cap);

  const currentLabel = selectedHeight ? `${selectedHeight}p` : (primaryHeight ? `${primaryHeight}p` : "Auto");

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((s) => !s)}
        className="hidden sm:inline rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold hover:bg-white/15 active:bg-white/20"
        title="Quality"
      >
        {currentLabel}
      </button>
      {open && pos && createPortal(
        <div
          data-quality-menu
          style={{ position: "fixed", top: pos.top, left: pos.left, width: 220, transform: "translateY(-100%)" }}
          className="z-[60] rounded-xl ring-1 ring-white/10 bg-zinc-900/98 py-1 shadow-2xl shadow-black/50 max-h-[60vh] overflow-y-auto"
        >
          {/* Available resolutions */}
          {orderedPresent.map((h) => {
            const isPrimary = h === primaryHeight;
            const variant = !isPrimary ? variantByHeight.get(h) : null;
            const active = isPrimary ? selectedHeight === null : selectedHeight === h;
            const downloading = variant?.status === "pending" || variant?.status === "downloading";
            const failed = variant?.status === "error";
            return (
              <div
                key={h}
                className={`group flex items-center justify-between gap-2 px-3 py-2 text-sm ${
                  active ? "bg-accent/12" : "hover:bg-white/5"
                } ${downloading || failed ? "opacity-70" : ""}`}
              >
                <button
                  className="flex flex-1 items-center gap-2 text-left"
                  disabled={downloading || failed}
                  onClick={() => {
                    onSelect(isPrimary ? null : h);
                    setOpen(false);
                  }}
                >
                  <span className={active ? "text-accent font-semibold" : "text-zinc-300"}>
                    {h}p
                  </span>
                  {isPrimary && <span className="text-[10px] text-zinc-500">primary</span>}
                  {downloading && <span className="text-[10px] text-amber-400">downloading…</span>}
                  {failed && <span className="text-[10px] text-red-400">error</span>}
                  {active && <span className="ml-auto text-accent">✓</span>}
                </button>
                {!isPrimary && variant && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteVariant(variant.id); }}
                    className="opacity-0 group-hover:opacity-100 text-[10px] text-red-400 hover:text-red-300 px-1"
                    title="Delete this variant"
                  >
                    Del
                  </button>
                )}
              </div>
            );
          })}

          {/* Add another */}
          {addable.length > 0 && (
            <div className="mt-1 border-t border-white/5 pt-1">
              <p className="px-3 py-1 text-[10px] uppercase tracking-wider text-zinc-500">
                Download another
              </p>
              {addable.map((h) => (
                <button
                  key={h}
                  disabled={addPending}
                  onClick={() => { onAddHeight(h); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-60"
                >
                  <span>+ {h}p</span>
                  <span className="ml-auto text-[10px] text-zinc-500">queue</span>
                </button>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyboard shortcuts cheat-sheet — toggled with "?" while watching.

function KeyboardHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups: [string, [string, string][]][] = [
    ["Playback", [["Space / K", "Play / pause"], ["C", "Subtitles"], [", / .", "Speed − / +"]]],
    ["Seek",     [["J / L", "−10 / +10 s"], ["← / →", "−5 / +5 s"], ["0–9", "Jump to 0–90%"]]],
    ["Queue",    [["N", "Next"], ["P", "Previous"]]],
    ["View",     [["F", "Fullscreen"], ["I", "Picture-in-Picture"], ["?", "This help"]]],
  ];

  return (
    <div
      className="absolute inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-zinc-900 p-5 shadow-2xl shadow-black/60 ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-100">Keyboard shortcuts</h3>
          <button onClick={onClose} className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {groups.map(([title, rows]) => (
            <div key={title}>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-accent">{title}</div>
              <ul className="space-y-1.5">
                {rows.map(([k, d]) => (
                  <li key={k} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-zinc-300">{d}</span>
                    <kbd className="flex-shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-200 ring-1 ring-white/10">{k}</kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
