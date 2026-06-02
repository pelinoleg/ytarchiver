import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListPlus, Plus, Check, Loader2 } from "lucide-react";
import { musicCollectionsApi } from "../lib/api";

/** The inner list — collections with a checkmark when the video is already a
 *  member; clicking toggles add/remove. A "create" row flips into an inline
 *  input (no system prompt). Reused by the watch-page button and the track
 *  card menu. After any change it invalidates the music + video queries so
 *  membership badges everywhere refresh. */
export function AddToPlaylistList({
  videoId, memberIds, onDone,
}: {
  videoId: string;
  memberIds: number[];
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const member = new Set(memberIds);

  const { data: collections = [], isLoading } = useQuery({
    queryKey: ["music", "collections"],
    queryFn: musicCollectionsApi.list,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["music"] });
    qc.invalidateQueries({ queryKey: ["video"] });
  }

  const toggle = useMutation({
    mutationFn: async ({ id, isMember }: { id: number; isMember: boolean }) => {
      if (isMember) await musicCollectionsApi.removeVideo(id, videoId);
      else await musicCollectionsApi.addVideo(id, videoId);
    },
    onSuccess: refresh,
  });

  const createAndAdd = useMutation({
    mutationFn: async () => {
      const col = await musicCollectionsApi.create(name.trim());
      await musicCollectionsApi.addVideo(col.id, videoId);
    },
    onSuccess: () => {
      setName(""); setCreating(false);
      refresh();
      onDone?.();
    },
  });

  return (
    <div className="w-full">
      <div className="max-h-56 overflow-y-auto">
        {isLoading ? (
          <p className="px-3 py-2 text-xs text-zinc-500">Загрузка…</p>
        ) : collections.length === 0 ? (
          <p className="px-3 py-2 text-xs text-zinc-500">Плейлистов пока нет — создай первый ниже.</p>
        ) : (
          collections.map((c) => {
            const isMember = member.has(c.id);
            return (
              <button
                key={c.id}
                role="menuitem"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle.mutate({ id: c.id, isMember }); }}
                disabled={toggle.isPending}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-100 hover:bg-zinc-800 disabled:opacity-60"
              >
                <span className={`grid h-4 w-4 flex-shrink-0 place-items-center rounded border ${
                  isMember ? "border-fuchsia-400 bg-fuchsia-500/80 text-white" : "border-zinc-600"
                }`}>
                  {isMember && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="truncate">{c.name}</span>
                <span className="ml-auto text-[10px] tabular-nums text-zinc-500">{c.done_count}</span>
              </button>
            );
          })
        )}
      </div>

      <div className="border-t border-white/5">
        {creating ? (
          <form
            onSubmit={(e) => { e.preventDefault(); if (name.trim()) createAndAdd.mutate(); }}
            className="flex items-center gap-1.5 px-2.5 py-2"
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setCreating(false); setName(""); } }}
              placeholder="Название плейлиста"
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm outline-none focus:border-fuchsia-500"
            />
            <button
              type="submit"
              disabled={createAndAdd.isPending || !name.trim()}
              className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-fuchsia-500 text-white hover:bg-fuchsia-400 disabled:opacity-50"
              aria-label="Создать и добавить"
            >
              {createAndAdd.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </button>
          </form>
        ) : (
          <button
            role="menuitem"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCreating(true); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-fuchsia-300 hover:bg-zinc-800"
          >
            <Plus className="h-4 w-4" />
            Создать плейлист…
          </button>
        )}
      </div>
    </div>
  );
}

/** Self-contained button + popover for the watch page. Tinted fuchsia when the
 *  video already lives in at least one playlist. */
export function AddToPlaylistButton({
  videoId, memberIds, align = "right",
}: {
  videoId: string;
  memberIds: number[];
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inAny = memberIds.length > 0;

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
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
        className={`rounded-full p-2 -mt-1 transition-colors ${
          inAny
            ? "bg-fuchsia-500/15 text-fuchsia-300 hover:bg-fuchsia-500/25"
            : "text-zinc-400 hover:bg-zinc-800 hover:text-fuchsia-300"
        }`}
        aria-label={inAny ? "В плейлистах — изменить" : "Добавить в плейлист"}
        title={inAny ? "В плейлистах — изменить" : "Добавить в плейлист"}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ListPlus className="h-6 w-6" />
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute ${align === "right" ? "right-0" : "left-0"} z-30 mt-1 w-64 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-xl`}
        >
          <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            В плейлист
          </p>
          <div className="border-t border-white/5">
            <AddToPlaylistList videoId={videoId} memberIds={memberIds} onDone={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
