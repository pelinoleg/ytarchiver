import { Play, Pause, SkipBack, SkipForward, Star } from "lucide-react";
import type { Video } from "../lib/api";
import { thumbUrl } from "../lib/api";

/** Always-visible bottom strip with thumb + title + transport, shown on the
 *  watch page whenever the current item is music. The bar lives in addition
 *  to the player's own controls — when the player auto-hides or scrolls
 *  partly off, this bar still gives one-tap access to play/pause/next/prev
 *  + favorite. Hidden on the smallest phones (<sm) because the always-on
 *  sticky player controls are good enough on those.
 *
 *  Does not own the <video> element — calls into PlayerHandle. ``playing``
 *  comes through as a prop so it can stay in sync with whatever the user
 *  did inside the player (keyboard, gesture, controls). */
export function MusicControlBar({
  video, playing, onTogglePlay, onPrev, onNext, onToggleFavorite,
}: {
  video: Video;
  playing: boolean;
  onTogglePlay: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onToggleFavorite: () => void;
}) {
  const thumb = video.thumbnail_path ? thumbUrl(video.video_id) : video.thumbnail_url;

  return (
    <div
      // Always visible. Bottom offset = ``--bottom-nav-safe`` (bar height +
      // iOS home-indicator inset) on phone/tablet, flush 0 on xl where the
      // bottom nav is gone. ``xl:left-70`` clears the permanent sidebar.
      className="
        flex
        fixed left-0 right-0 z-30 xl:bottom-0
        items-center gap-3 px-3 py-2
        bg-zinc-960/95 backdrop-blur-md
        border-t border-zinc-800
        xl:left-70
      "
      style={{ bottom: "var(--bottom-nav-safe)" }}
    >
      {/* Thumb + title */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {thumb && (
          <img
            src={thumb}
            alt=""
            referrerPolicy="no-referrer"
            className="h-10 w-16 flex-shrink-0 rounded object-cover bg-zinc-800"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">{video.title}</p>
          {video.channel_name && (
            <p className="truncate text-xs text-zinc-400">{video.channel_name}</p>
          )}
        </div>
      </div>

      {/* Transport */}
      <div className="flex flex-shrink-0 items-center gap-1">
        <button
          onClick={onToggleFavorite}
          aria-label={video.is_favorite ? "Remove from favorites" : "Add to favorites"}
          title={video.is_favorite ? "Remove from favorites" : "Add to favorites"}
          className={`grid h-10 w-10 place-items-center rounded-full transition-colors ${
            video.is_favorite
              ? "text-yellow-300 hover:bg-yellow-400/15"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          }`}
        >
          <Star className={`h-5 w-5 ${video.is_favorite ? "fill-current" : ""}`} />
        </button>
        <button
          onClick={() => onPrev?.()}
          disabled={!onPrev}
          aria-label="Previous"
          className="grid h-10 w-10 place-items-center rounded-full text-zinc-100 hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <SkipBack className="h-5 w-5" />
        </button>
        <button
          onClick={onTogglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="grid h-11 w-11 place-items-center rounded-full bg-zinc-100 text-zinc-950 hover:bg-zinc-200 active:scale-95 transition-transform"
        >
          {playing
            ? <Pause className="h-5 w-5" />
            : <Play  className="h-5 w-5 translate-x-0.5 fill-current" />}
        </button>
        <button
          onClick={() => onNext?.()}
          disabled={!onNext}
          aria-label="Next"
          className="grid h-10 w-10 place-items-center rounded-full text-zinc-100 hover:bg-zinc-800 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <SkipForward className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
