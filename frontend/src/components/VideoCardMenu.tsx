import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MoreVertical, Pin, PinOff, Trash2, ExternalLink, Music, Star, RefreshCw,
} from "lucide-react";
import { videosApi, type Video } from "../lib/api";
import { youtubeVideoUrl } from "../lib/format";
import { useConfirm } from "./ConfirmProvider";

const MENU_W = 200;          // px — matches the inline width below
const MARGIN  = 8;           // viewport gap so the menu never touches an edge

/** Floating 3-dot menu used inside VideoCard / RelatedCard / StoragePage.
 *
 *  The dropdown is portalled to <body> and positioned with fixed coords from
 *  the trigger button. That's deliberate: the card's thumbnail wrapper is
 *  ``overflow-hidden`` (rounded corners + preview clipping), so a menu rendered
 *  inline gets cut off on small cards — which is exactly how the lower items
 *  (music / delete) used to vanish. Portalling escapes every overflow ancestor
 *  and lets us flip the menu above / clamp it to the viewport near edges. */
export function VideoCardMenu({ video }: { video: Video }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const btnRef  = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    left: number; top?: number; bottom?: number; maxHeight: number;
  } | null>(null);

  // Position the portalled menu relative to the trigger. Anchors to the
  // button's bottom-right; flips to grow upward when there isn't room below.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const btn = btnRef.current; if (!btn) return;
      const r = btn.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      const openUp = spaceBelow < 260 && spaceAbove > spaceBelow;
      let left = r.right - MENU_W;                 // align right edges
      left = Math.max(MARGIN, Math.min(left, window.innerWidth - MENU_W - MARGIN));
      setPos({
        left,
        top:    openUp ? undefined : r.bottom + 4,
        bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
        maxHeight: (openUp ? spaceAbove : spaceBelow) - MARGIN - 4,
      });
    }
    place();
    // Reposition is pointless mid-scroll (the button moves) — just close.
    const onScroll = () => setOpen(false);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["videos"] });
    qc.invalidateQueries({ queryKey: ["video", video.video_id] });
  };

  const toggleKeep = useMutation({
    mutationFn: () => videosApi.update(video.video_id, { keep_forever: !video.keep_forever }),
    onSuccess: invalidateAll,
  });

  const toggleFavorite = useMutation({
    mutationFn: () => videosApi.update(video.video_id, { is_favorite: !video.is_favorite }),
    onSuccess: () => { invalidateAll(); qc.invalidateQueries({ queryKey: ["favorites"] }); qc.invalidateQueries({ queryKey: ["music"] }); },
  });

  const toggleMusic = useMutation({
    mutationFn: () => videosApi.update(video.video_id, { is_music: !video.is_music }),
    onSuccess: () => {
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["music"] });
      qc.invalidateQueries({ queryKey: ["favorites"] });
      qc.invalidateQueries({ queryKey: ["history"] });
    },
  });

  const redownload = useMutation({
    mutationFn: () => videosApi.redownload(video.video_id),
    onSuccess: () => { invalidateAll(); qc.invalidateQueries({ queryKey: ["queue"] }); },
  });

  const remove = useMutation({
    mutationFn: () => videosApi.delete(video.id),
    onSuccess: () => {
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["history"] });
    },
  });

  function stop(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  // Item helper keeps the markup terse and consistent.
  const itemCls = "flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-zinc-800 text-left";

  const menu = pos && (
    <div
      ref={menuRef}
      onClick={stop}
      className="fixed z-[60] overflow-y-auto overflow-x-hidden rounded-xl ring-1 ring-white/10 bg-zinc-900 py-1 shadow-2xl shadow-black/50"
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: MENU_W, maxHeight: pos.maxHeight }}
    >
      <button
        onClick={(e) => { stop(e); toggleKeep.mutate(); setOpen(false); }}
        className={itemCls}
      >
        {video.keep_forever ? <PinOff className="h-4 w-4 flex-shrink-0" /> : <Pin className="h-4 w-4 flex-shrink-0" />}
        {video.keep_forever ? "Don't keep" : "Keep forever"}
      </button>

      <button
        onClick={(e) => { stop(e); toggleFavorite.mutate(); setOpen(false); }}
        className={itemCls}
      >
        <Star className={`h-4 w-4 flex-shrink-0 ${video.is_favorite ? "fill-current text-yellow-300" : ""}`} />
        {video.is_favorite ? "Remove from favorites" : "Add to favorites"}
      </button>

      {video.is_music_via_playlist && !video.is_music ? (
        <div className="flex w-full items-start gap-2.5 px-3 py-2 text-sm text-zinc-500 cursor-default">
          <Music className="h-4 w-4 text-fuchsia-400 mt-0.5 flex-shrink-0" />
          <span className="leading-tight">В music-плейлисте<br/>
            <span className="text-[10px] text-zinc-600">(отметка наследуется)</span>
          </span>
        </div>
      ) : (
        <button
          onClick={(e) => { stop(e); toggleMusic.mutate(); setOpen(false); }}
          className={itemCls}
        >
          <Music className={`h-4 w-4 flex-shrink-0 ${video.is_music ? "text-fuchsia-400" : ""}`} />
          {video.is_music ? "Remove from music" : "Mark as music"}
        </button>
      )}

      {video.status === "done" && (
        <button
          onClick={async (e) => {
            stop(e);
            setOpen(false);
            const ok = await confirm({
              title: "Re-download this video?",
              body: <>Текущий файл заменится свежим после скачивания. Видео вернётся в очередь загрузок.</>,
              confirmLabel: "Re-download",
            });
            if (ok) redownload.mutate();
          }}
          className={itemCls}
        >
          <RefreshCw className="h-4 w-4 flex-shrink-0" />
          Re-download
        </button>
      )}

      <button
        onClick={(e) => {
          stop(e);
          window.open(youtubeVideoUrl(video.video_id), "_blank", "noopener,noreferrer");
          setOpen(false);
        }}
        className={itemCls}
      >
        <ExternalLink className="h-4 w-4 flex-shrink-0" />
        Open on YouTube
      </button>

      <div className="my-1 border-t border-zinc-800" />

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
        className={`${itemCls} text-red-400`}
      >
        <Trash2 className="h-4 w-4 flex-shrink-0" />
        Delete
      </button>
    </div>
  );

  return (
    <div className="absolute top-1 right-1 z-10" onClick={stop}>
      <button
        ref={btnRef}
        onClick={(e) => { stop(e); setOpen((s) => !s); }}
        className={`rounded-full bg-black/70 p-1.5 text-white opacity-0 group-hover:opacity-100 transition-opacity ${open ? "opacity-100" : ""}`}
        aria-label="More actions"
        aria-expanded={open}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && createPortal(menu, document.body)}
    </div>
  );
}
