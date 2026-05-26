import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Star, Pin, Music, X, Loader2 } from "lucide-react";
import { videosApi } from "../lib/api";
import { useSelection } from "./SelectionProvider";
import { useConfirm } from "./ConfirmProvider";

/** Floating action bar — only renders when the user has at least one card
 *  selected. Mobile-first: full-width on phone, centered pill on desktop. */
export function SelectionBar() {
  const { selected, count, clear } = useSelection();
  const qc = useQueryClient();
  const confirm = useConfirm();

  // Esc cancels selection.
  useEffect(() => {
    if (count === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") clear();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, clear]);

  const ids   = [...selected.keys()];
  const vids  = [...selected.values()];

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["videos"] });
    qc.invalidateQueries({ queryKey: ["storage"] });
    qc.invalidateQueries({ queryKey: ["history"] });
    qc.invalidateQueries({ queryKey: ["favorites"] });
    qc.invalidateQueries({ queryKey: ["music"] });
    qc.invalidateQueries({ queryKey: ["queue"] });
  }

  const del = useMutation({
    mutationFn: () => videosApi.bulkDelete(ids),
    onSuccess: () => { invalidate(); clear(); },
  });
  const mark = useMutation({
    mutationFn: (patch: Parameters<typeof videosApi.bulkPatch>[1]) =>
      videosApi.bulkPatch(vids, patch),
    onSuccess: () => { invalidate(); clear(); },
  });

  if (count === 0) return null;

  const busy = del.isPending || mark.isPending;

  return (
    <div
      // Float above the BottomNav on phone / tablet using the shared CSS
      // var so width/position stays in sync if the bar size ever changes.
      className="fixed inset-x-0 z-50 flex justify-center px-3 pointer-events-none xl:bottom-0"
      style={{
        bottom: "var(--bottom-nav-safe)",
        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="pointer-events-auto flex w-full max-w-3xl items-center gap-1 sm:gap-2 rounded-2xl bg-zinc-900 ring-1 ring-zinc-700 shadow-2xl px-2.5 py-2 sm:px-3">
        <button
          onClick={clear}
          className="rounded-full p-2 text-zinc-300 hover:bg-zinc-800"
          aria-label="Cancel selection (Esc)"
          title="Cancel (Esc)"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="px-1 sm:px-2 text-sm font-semibold tabular-nums">
          {count} <span className="text-zinc-500 font-normal">selected</span>
        </span>
        <div className="flex-1" />

        <BarButton
          onClick={() => mark.mutate({ is_favorite: true })}
          icon={Star} label="Favorite"
        />
        <BarButton
          onClick={() => mark.mutate({ keep_forever: true })}
          icon={Pin} label="Keep"
        />
        <BarButton
          onClick={() => mark.mutate({ is_music: true })}
          icon={Music} label="Music"
        />
        <BarButton
          onClick={async () => {
            const ok = await confirm({
              title: `Delete ${count} video${count === 1 ? "" : "s"}?`,
              body: "Файлы и превью будут удалены с диска. Это действие нельзя отменить.",
              confirmLabel: `Delete ${count}`,
              destructive: true,
            });
            if (ok) del.mutate();
          }}
          icon={Trash2} label="Delete" destructive
        />

        {busy && <Loader2 className="ml-1 h-4 w-4 animate-spin text-zinc-400" />}
      </div>
    </div>
  );
}

function BarButton({
  onClick, icon: Icon, label, destructive,
}: {
  onClick: () => void;
  icon: typeof Star;
  label: string;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex items-center gap-1 rounded-full px-2.5 sm:px-3 py-1.5 text-sm font-medium ${
        destructive
          ? "bg-red-600/90 text-white hover:bg-red-600"
          : "bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
