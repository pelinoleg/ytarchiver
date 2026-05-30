import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Maximize2, Pause, Play, X } from "lucide-react";
import { streamUrl, thumbUrl } from "../lib/api";
import { useMiniPlayer } from "./MiniPlayerProvider";

/** Mini-PiP that respects the paused state from the watch page — i.e. if the
 *  user paused before navigating, the mini stays paused (no surprise audio). */

/** Floating "still playing" miniature, bottom-right.
 *
 *  Layout: a single aspect-video card. Controls (play/pause, expand, close)
 *  sit on the RIGHT side of the video as a vertical strip with a black
 *  gradient backdrop — no separate text column, no extra height. The video
 *  fills the rest. Auto-hidden on /watch (full player takes over). */
export function MiniPlayer() {
  const { state, close } = useMiniPlayer();
  const nav  = useNavigate();
  const loc  = useLocation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(true);

  const onWatch = loc.pathname.startsWith("/watch/");

  // Initialize <video> state from the handoff: seek to the saved offset and
  // only call ``play()`` when the user was actually playing — otherwise stay
  // paused. The <video> element below intentionally has NO ``autoPlay``
  // attribute so the browser can't sneak in playback against our wishes.
  useEffect(() => {
    if (!state) return;
    const v = videoRef.current; if (!v) return;
    const apply = () => {
      try {
        if (state.currentTime > 1 && state.currentTime < (v.duration || 0) - 2) {
          v.currentTime = state.currentTime;
        }
      } catch { /* Safari readonly during decode */ }
      if (state.wasPlaying) v.play().catch(() => { /* autoplay blocked */ });
      else                  v.pause();
    };
    if (v.readyState >= 1) {
      apply();
    } else {
      v.addEventListener("loadedmetadata", apply, { once: true });
      return () => v.removeEventListener("loadedmetadata", apply);
    }
  }, [state]);

  // Keep local play/pause indicator state in sync with the actual element.
  // Initialize from state.wasPlaying so the overlay icon is correct on first
  // mount before any events have fired.
  useEffect(() => {
    if (state) setPlaying(state.wasPlaying);
  }, [state]);

  if (!state || onWatch) return null;

  function expand() {
    if (!state) return;
    const t = videoRef.current?.currentTime ?? state.currentTime;
    const qs = new URLSearchParams();
    if (state.source.playlistId)    qs.set("playlist", String(state.source.playlistId));
    if (state.source.isMusicSource) qs.set("source", "music");
    if (state.source.isShuffled)    qs.set("shuffle", "1");
    qs.set("t", String(Math.floor(t)));
    close();
    nav(`/watch/${state.video.video_id}?${qs.toString()}`);
  }

  function toggle() {
    const v = videoRef.current; if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else          v.pause();
  }

  const v = state.video;
  const thumb = v.thumbnail_path ? thumbUrl(v.video_id) : v.thumbnail_url;

  return (
    <div
      // ``bottom`` uses the shared --bottom-nav-safe var which auto-resets
      // to 0 on xl (CSS media query in index.css). Adding 0.75rem so on
      // xl it matches the old ``bottom-3`` corner gap.
      className="fixed right-3 z-40 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/60 ring-1 ring-white/10"
      style={{ bottom: "calc(var(--bottom-nav-safe) + 0.75rem)" }}
    >
      <div className="relative aspect-video w-full">
        <video
          ref={videoRef}
          src={streamUrl(v.video_id)}
          playsInline
          // No ``autoPlay`` — the effect above decides whether to call play()
          // based on the user's last state on the watch page.
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          poster={thumb ?? undefined}
          onClick={expand}
          className="absolute inset-0 h-full w-full object-contain"
        />

        {/* Side controls — vertical strip on the right with a light gradient
            backdrop for legibility against any thumbnail. */}
        <div className="absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-l from-black/70 via-black/40 to-transparent pl-6 pr-1">
          <button
            onClick={(e) => { e.stopPropagation(); toggle(); }}
            className="grid h-9 w-9 place-items-center rounded-full text-white hover:bg-white/15 active:bg-white/25"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-current" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); expand(); }}
            className="grid h-9 w-9 place-items-center rounded-full text-white hover:bg-white/15 active:bg-white/25"
            aria-label="Expand"
            title="Expand"
          >
            <Maximize2 className="h-5 w-5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); close(); }}
            className="grid h-9 w-9 place-items-center rounded-full text-white/80 hover:bg-white/15 active:bg-white/25"
            aria-label="Close mini player"
            title="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
