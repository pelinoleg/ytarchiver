import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Pin, PinOff, Trash2, ExternalLink, Music } from "lucide-react";
import { videosApi, type Video } from "../lib/api";
import { youtubeVideoUrl } from "../lib/format";
import { useConfirm } from "./ConfirmProvider";

/** Floating 3-dot menu used inside VideoCard / RelatedCard.
 *  Stops link navigation when clicked. */
export function VideoCardMenu({ video }: { video: Video }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggleKeep = useMutation({
    mutationFn: () => videosApi.update(video.video_id, { keep_forever: !video.keep_forever }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["videos"] });
      qc.invalidateQueries({ queryKey: ["video", video.video_id] });
    },
  });

  const toggleMusic = useMutation({
    mutationFn: () => videosApi.update(video.video_id, { is_music: !video.is_music }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["videos"] });
      qc.invalidateQueries({ queryKey: ["video", video.video_id] });
      qc.invalidateQueries({ queryKey: ["music"] });
      qc.invalidateQueries({ queryKey: ["favorites"] });
      qc.invalidateQueries({ queryKey: ["history"] });
    },
  });

  const remove = useMutation({
    mutationFn: () => videosApi.delete(video.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["videos"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["history"] });
      qc.invalidateQueries({ queryKey: ["video", video.video_id] });
    },
  });

  function stop(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  return (
    <div ref={ref} className="absolute top-1 right-1 z-10" onClick={stop}>
      <button
        onClick={(e) => { stop(e); setOpen((s) => !s); }}
        className={`rounded-full bg-black/70 p-1.5 text-white opacity-0 group-hover:opacity-100 transition-opacity ${open ? "opacity-100" : ""}`}
        aria-label="More actions"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-xl">
          <button
            onClick={(e) => { stop(e); toggleKeep.mutate(); setOpen(false); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-800"
          >
            {video.keep_forever ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            {video.keep_forever ? "Don't keep" : "Keep forever"}
          </button>
          {video.is_music_via_playlist && !video.is_music ? (
            <div className="flex w-full items-start gap-2 px-3 py-1.5 text-sm text-zinc-500 cursor-default">
              <Music className="h-4 w-4 text-fuchsia-400 mt-0.5 flex-shrink-0" />
              <span className="leading-tight">В music-плейлисте<br/>
                <span className="text-[10px] text-zinc-600">(отметка наследуется)</span>
              </span>
            </div>
          ) : (
            <button
              onClick={(e) => { stop(e); toggleMusic.mutate(); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-800"
            >
              <Music className={`h-4 w-4 ${video.is_music ? "text-fuchsia-400" : ""}`} />
              {video.is_music ? "Remove from music" : "Mark as music"}
            </button>
          )}
          <button
            onClick={(e) => {
              stop(e);
              window.open(youtubeVideoUrl(video.video_id), "_blank", "noopener,noreferrer");
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-800"
          >
            <ExternalLink className="h-4 w-4" />
            Open on YouTube
          </button>
          <button
            onClick={async (e) => {
              stop(e);
              setOpen(false);
              const ok = await confirm({
                title: "Delete this video?",
                body: <>Файл и превью будут удалены с диска. Это действие нельзя отменить.</>,
                confirmLabel: "Delete",
                destructive: true,
              });
              if (ok) remove.mutate();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-zinc-800"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
