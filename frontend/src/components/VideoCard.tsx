import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Clock, Loader2, AlertTriangle, Pin, CheckCircle2, Play } from "lucide-react";
import { previewUrl, thumbUrl, type Video } from "../lib/api";
import { formatDuration, formatUploadDate, formatBytes, isRecent } from "../lib/format";
import { WatchProgress } from "./WatchProgress";
import { VideoCardMenu } from "./VideoCardMenu";
import { useSelection } from "./SelectionProvider";

const PREVIEW_DELAY_MS = 400;

const LONG_PRESS_MS = 450;

export function VideoCard({ video }: { video: Video }) {
  const navigate = useNavigate();
  const { inSelectMode, isSelected, toggle } = useSelection();
  const selected = isSelected(video.id);
  const thumb = video.thumbnail_path
    ? thumbUrl(video.video_id)
    : video.thumbnail_url;

  const [showPreview, setShowPreview] = useState(false);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set by long-press / cmd-click so the upcoming click event knows to
  // suppress the Link navigation in favor of selection toggle.
  const suppressClickRef = useRef(false);

  const gotoChannel = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/channel/${video.channel_id}`);
  };

  function onEnter() {
    if (!video.has_preview || inSelectMode) return;
    if (enterTimer.current) clearTimeout(enterTimer.current);
    enterTimer.current = setTimeout(() => setShowPreview(true), PREVIEW_DELAY_MS);
  }
  function onLeave() {
    if (enterTimer.current) {
      clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    setShowPreview(false);
  }
  useEffect(() => () => {
    if (enterTimer.current) clearTimeout(enterTimer.current);
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    // Long-press on touch enters select mode (mobile pattern). Skip mouse —
    // mouse users get Cmd/Ctrl-click instead (handled in onClick).
    if (e.pointerType !== "touch") return;
    pressTimer.current = setTimeout(() => {
      suppressClickRef.current = true;
      toggle(video);
      // Haptic nudge where available.
      try { navigator.vibrate?.(20); } catch { /* unsupported */ }
    }, LONG_PRESS_MS);
  }
  function cancelPress() {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function onClick(e: React.MouseEvent) {
    // Cmd/Ctrl-click toggles selection without navigating, even when not
    // already in select mode.
    if ((e.metaKey || e.ctrlKey) && !inSelectMode) {
      e.preventDefault();
      e.stopPropagation();
      toggle(video);
      return;
    }
    // Click while in select mode → toggle, don't navigate.
    if (inSelectMode) {
      e.preventDefault();
      e.stopPropagation();
      toggle(video);
      return;
    }
    // Suppress the click that follows a long-press.
    if (suppressClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickRef.current = false;
    }
  }

  return (
    <Link
      to={`/watch/${video.video_id}`}
      // ``min-w-0`` is the grid-blowout fix: by default a grid item's
      // min-width is its intrinsic content width, so a long channel name
      // without spaces would push the card past the grid cell. ``min-w-0``
      // lets the cell shrink and engages the inner ``truncate``.
      className={`group block relative min-w-0 ${selected ? "ring-2 ring-sky-400 rounded-xl" : ""}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onPointerDown={onPointerDown}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={cancelPress}
      onClick={onClick}
    >
      <div className="relative aspect-video overflow-hidden rounded-xl bg-zinc-900">
        {thumb ? (
          <img
            src={thumb}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${
              showPreview ? "opacity-0" : "opacity-100"
            }`}
          />
        ) : (
          <div className="grid h-full place-items-center text-zinc-700">
            <Clock className="h-10 w-10" />
          </div>
        )}

        {showPreview && (
          <video
            src={previewUrl(video.video_id)}
            autoPlay
            muted
            loop
            playsInline
            preload="none"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}

        {/* Hover play affordance — only on ready videos, and not while the
            inline preview is playing or in select mode. Pure transform+opacity,
            neutral (red stays reserved); disabled under reduced-motion. */}
        {video.status === "done" && !inSelectMode && !showPreview && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition-[background-color,opacity] duration-200 group-hover:bg-black/25 group-hover:opacity-100 motion-reduce:transition-none">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-black/55 text-white shadow-lg ring-1 ring-white/15 backdrop-blur-sm scale-90 transition-transform duration-200 group-hover:scale-100 motion-reduce:transform-none">
              <Play className="h-6 w-6 translate-x-px fill-current" />
            </span>
          </div>
        )}

        <div className="absolute bottom-1 right-1 flex items-center gap-1">
          {video.file_size_bytes ? (
            <span
              className="hidden rounded bg-sky-500/90 px-1.5 py-0.5 text-xs font-bold text-white tabular-nums shadow"
              title="File size on disk"
            >
              {formatBytes(video.file_size_bytes, true)}
            </span>
          ) : null}
          {video.duration ? (
            <span className="rounded bg-black/85 px-1.5 py-0.5 text-xs font-medium text-zinc-100">
              {formatDuration(video.duration)}
            </span>
          ) : null}
        </div>

        {isRecent(video) && (
          <span
            className="absolute top-1 right-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow"
            title="Downloaded recently, not watched yet"
          >
            New
          </span>
        )}

        {video.keep_forever && (
          <span
            className="absolute bottom-1 left-1 grid h-5 w-5 place-items-center rounded-full bg-amber-500/90 text-zinc-950"
            title="Kept forever (ignores cleanup rules)"
          >
            <Pin className="h-3 w-3" />
          </span>
        )}

        <WatchProgress video={video} />
        <StatusBadge status={video.status} progress={video.progress} />
        {inSelectMode ? (
          <div className={`absolute top-1 right-1 grid h-7 w-7 place-items-center rounded-full ${
            selected ? "bg-sky-500 text-white" : "bg-black/70 text-zinc-300 ring-1 ring-zinc-500"
          }`}>
            {selected && <CheckCircle2 className="h-5 w-5" />}
          </div>
        ) : (
          <VideoCardMenu video={video} />
        )}
      </div>

      {/* Title — full width. ``break-words`` so a long unbreakable word
       *  (rare YouTube title pattern) wraps instead of growing the cell. */}
      <h3 className="mt-3 line-clamp-2 text-sm font-medium leading-snug text-zinc-100 break-words">
        {video.title}
      </h3>

      {/* Channel avatar (clickable)  |  channel name (clickable) + date */}
      <div className="mt-1.5 flex items-start gap-2">
        {video.channel_thumbnail && (
          <button
            onClick={gotoChannel}
            aria-label={`Open ${video.channel_name ?? "channel"}`}
            className="flex-shrink-0 rounded-full"
          >
            <img
              src={video.channel_thumbnail}
              alt=""
              referrerPolicy="no-referrer"
              loading="lazy"
              className="h-7 w-7 rounded-full object-cover bg-zinc-800 hover:ring-2 hover:ring-zinc-700"
            />
          </button>
        )}
        <div className="min-w-0 flex-1">
          {video.channel_name && (
            <button
              onClick={gotoChannel}
              className="block w-full max-w-full truncate text-left text-xs text-zinc-400 hover:text-zinc-200"
              title={video.channel_name}
            >
              {video.channel_name}
            </button>
          )}
          {video.upload_date && (
            <p className="text-xs text-zinc-500">
              {formatUploadDate(video.upload_date, video.downloaded_at, video.upload_timestamp)}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

function StatusBadge({ status, progress }: { status: Video["status"]; progress: string | null }) {
  if (status === "done") return null;
  if (status === "downloading") {
    return (
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/70 px-2 py-1 text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Downloading {progress ?? ""}
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-red-600/80 px-2 py-1 text-xs">
        <AlertTriangle className="h-3.5 w-3.5" />
        Failed
      </div>
    );
  }
  if (status === "pending" || status === "queued") {
    return (
      <span className="absolute top-1 left-1 rounded bg-amber-500/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-950">
        {status === "pending" ? "Pending" : "Queued"}
      </span>
    );
  }
  return null;
}
