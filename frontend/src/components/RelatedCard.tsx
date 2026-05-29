import { Link, useNavigate } from "react-router-dom";
import { Pin } from "lucide-react";
import type { Video } from "../lib/api";
import { thumbUrl } from "../lib/api";
import { formatDuration, formatUploadDate, isRecent } from "../lib/format";
import { WatchProgress } from "./WatchProgress";

export function RelatedCard({ video }: { video: Video }) {
  const navigate = useNavigate();
  const thumb = video.thumbnail_path ? thumbUrl(video.video_id) : video.thumbnail_url;
  const gotoChannel = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/channel/${video.channel_id}`);
  };
  return (
    <Link to={`/watch/${video.video_id}`} className="group flex gap-2 min-w-0">
      <div className="relative aspect-video w-32 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-900">
        {thumb && (
          <img
            src={thumb} alt="" referrerPolicy="no-referrer" loading="lazy"
            className="h-full w-full object-cover"
          />
        )}
        {video.duration ? (
          <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1 py-0.5 text-[10px] font-medium">
            {formatDuration(video.duration)}
          </span>
        ) : null}
        {isRecent(video) && (
          <span
            className="absolute top-1 right-1 rounded bg-red-600 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
            title="Downloaded recently, not watched yet"
          >
            New
          </span>
        )}
        {video.keep_forever && (
          <span className="absolute top-1 left-1 grid h-4 w-4 place-items-center rounded-full bg-amber-500/90 text-zinc-950">
            <Pin className="h-2.5 w-2.5" />
          </span>
        )}
        <WatchProgress video={video} />
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="line-clamp-2 text-xs font-medium leading-snug break-words">{video.title}</h4>
        <div className="mt-1 flex items-start gap-2">
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
                className="h-5 w-5 rounded-full object-cover bg-zinc-800 hover:ring-2 hover:ring-zinc-700"
              />
            </button>
          )}
          <div className="min-w-0 flex-1">
            {video.channel_name && (
              <button
                onClick={gotoChannel}
                className="block truncate text-left text-[11px] text-zinc-400 hover:text-zinc-200"
                title={video.channel_name}
              >
                {video.channel_name}
              </button>
            )}
            {video.upload_date && (
              <p className="text-[11px] text-zinc-500">
                {formatUploadDate(video.upload_date, video.downloaded_at, video.upload_timestamp)}
              </p>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
