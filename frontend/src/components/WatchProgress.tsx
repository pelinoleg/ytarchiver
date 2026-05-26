import type { Video } from "../lib/api";

/** Thin red bar across the bottom of a thumbnail, YouTube-style.
 *  Hidden for music — those play from 0 every time so a progress bar would
 *  be misleading. */
export function WatchProgress({ video }: { video: Video }) {
  if (video.is_music || video.is_music_via_playlist) return null;
  if (!video.last_position_seconds || !video.duration) return null;
  const pct = Math.min(100, (video.last_position_seconds / video.duration) * 100);
  if (pct < 1) return null;
  return (
    <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
      <div className="h-full bg-red-500" style={{ width: `${pct}%` }} />
    </div>
  );
}
