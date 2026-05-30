import { useEffect, useState } from "react";
import { Play, RotateCcw, X } from "lucide-react";
import { thumbUrl, type Video } from "../../lib/api";
import { formatDuration } from "../../lib/format";

/** Overlay shown when the current video reaches its end.
 *
 *  Visuals follow YouTube's "Up next" pattern:
 *    • Dimmed full-bleed backdrop over the paused last frame
 *    • Replay button left-of-center
 *    • Big next-video thumbnail with a SVG-stroked progress ring that
 *      fills clockwise over ``autoplayMs`` — tapping it skips immediately
 *    • A small dismiss (×) closes the screen without auto-advancing,
 *      letting the user just sit on the final frame
 *
 *  When there's no next video (end of standalone watch with no related
 *  results), the upper half is replaced by a "End of queue" placard with
 *  only the Replay action. */
export function EndScreen({
  nextVideo, onSkipNow, onReplay, onCancel, autoplayMs = 5000,
}: {
  nextVideo: Video | null;
  onSkipNow: () => void;
  onReplay:  () => void;
  onCancel:  () => void;
  autoplayMs?: number;
}) {
  const [progress, setProgress] = useState(0);

  // rAF-driven countdown — smoother than setInterval and stops when the
  // overlay unmounts so we don't risk firing onSkipNow after navigation.
  useEffect(() => {
    if (!nextVideo) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / autoplayMs);
      setProgress(p);
      if (p >= 1) {
        onSkipNow();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [nextVideo, autoplayMs, onSkipNow]);

  const remainingSec = nextVideo ? Math.ceil((1 - progress) * (autoplayMs / 1000)) : 0;

  // SVG ring geometry. r=42 → circumference ~263.9; we offset the dashoffset
  // proportionally so the stroke "fills" from 12 o'clock clockwise.
  const RING_R = 42;
  const RING_C = 2 * Math.PI * RING_R;
  const dashoffset = RING_C * (1 - progress);

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-black/80 backdrop-blur-sm px-4 sm:rounded-xl">
      {/* Dismiss × top-right */}
      <button
        onClick={onCancel}
        aria-label="Cancel autoplay"
        className="absolute top-3 right-3 grid h-9 w-9 place-items-center rounded-full bg-zinc-900/70 text-zinc-200 hover:bg-zinc-800"
      >
        <X className="h-4 w-4" />
      </button>

      {nextVideo ? (
        <>
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-300">
            Up next in <span className="font-bold text-white tabular-nums">{remainingSec}</span>
          </p>

          <button
            onClick={onSkipNow}
            className="group relative outline-none"
            aria-label={`Play next: ${nextVideo.title}`}
          >
            <div className="relative h-28 w-28 sm:h-32 sm:w-32">
              {/* Background ring */}
              <svg
                viewBox="0 0 100 100"
                className="absolute inset-0 h-full w-full -rotate-90"
                aria-hidden
              >
                <circle
                  cx="50" cy="50" r={RING_R}
                  fill="none"
                  stroke="rgba(255,255,255,0.18)"
                  strokeWidth="4"
                />
                <circle
                  cx="50" cy="50" r={RING_R}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={RING_C}
                  strokeDashoffset={dashoffset}
                />
              </svg>
              {/* Thumb inset inside the ring */}
              <div className="absolute inset-2 overflow-hidden rounded-full bg-zinc-900 grid place-items-center">
                {nextVideo.thumbnail_path ? (
                  <img
                    src={thumbUrl(nextVideo.video_id)}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  />
                ) : nextVideo.thumbnail_url ? (
                  <img
                    src={nextVideo.thumbnail_url}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Play className="h-8 w-8 text-zinc-500" />
                )}
                <Play
                  className="absolute h-8 w-8 fill-current text-white opacity-0 transition-opacity group-hover:opacity-100"
                />
              </div>
            </div>
          </button>

          <div className="max-w-sm text-center">
            <p className="line-clamp-2 text-sm sm:text-base font-semibold text-zinc-50">
              {nextVideo.title}
            </p>
            {nextVideo.channel_name && (
              <p className="mt-1 truncate text-xs text-zinc-400">
                {nextVideo.channel_name}
                {nextVideo.duration ? ` · ${formatDuration(nextVideo.duration)}` : ""}
              </p>
            )}
          </div>

          <button
            onClick={onReplay}
            className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-white/15 active:bg-white/20 ring-1 ring-white/10"
          >
            <RotateCcw className="h-4 w-4" />
            Replay
          </button>
        </>
      ) : (
        <>
          <div className="grid h-16 w-16 place-items-center rounded-full bg-zinc-900 ring-1 ring-zinc-700">
            <RotateCcw className="h-7 w-7 text-zinc-300" />
          </div>
          <div className="text-center">
            <p className="text-base sm:text-lg font-semibold text-zinc-50">Готово</p>
            <p className="mt-1 max-w-sm text-xs text-zinc-400">
              На этом всё — больше связанных видео нет.
            </p>
          </div>
          <button
            onClick={onReplay}
            className="flex items-center gap-2 rounded-full bg-zinc-100 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-zinc-200"
          >
            <RotateCcw className="h-4 w-4" />
            Replay
          </button>
        </>
      )}
    </div>
  );
}
