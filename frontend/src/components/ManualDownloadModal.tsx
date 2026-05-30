import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Loader2, Download, ListMusic } from "lucide-react";
import { videosApi, type Quality } from "../lib/api";

export function ManualDownloadModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState<Quality | "">("");
  const [isMusic, setIsMusic] = useState(false);

  const mut = useMutation({
    mutationFn: () => videosApi.manualDownload(url.trim(), quality === "" ? null : quality, isMusic),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["videos"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["manual"] });
      onClose();
    },
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-zinc-900 p-5 sm:p-6 shadow-2xl shadow-black/50 ring-1 ring-white/10"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Download className="h-5 w-5" />
            Download a single video
          </h2>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-zinc-800" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 text-xs text-zinc-400">
          Manually downloaded videos live in the <span className="text-zinc-200">Manual</span> section
          and are never removed by the retention cleanup — only when you delete them by hand.
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); if (url.trim()) mut.mutate(); }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Video URL or ID
            </label>
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder:text-zinc-600 focus:border-zinc-600"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Quality (optional)
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {([["", "Default"], ["best", "Best"], ["1080", "1080p"], ["720", "720p"], ["480", "480p"], ["360", "360p"]] as [Quality | "", string][]).map(([v, l]) => (
                <button
                  key={v || "default"}
                  type="button"
                  onClick={() => setQuality(v)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    quality === v ? "bg-accent text-accent-ink" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5">
            <input
              type="checkbox"
              checked={isMusic}
              onChange={(e) => setIsMusic(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            <span className="flex items-center gap-1.5 text-sm">
              <ListMusic className="h-4 w-4 text-zinc-400" />
              Это музыка
            </span>
            <span className="ml-auto text-xs text-zinc-500">показывать в разделе Music</span>
          </label>

          {mut.isError && (
            <p className="text-sm text-red-400">{(mut.error as Error)?.message ?? "Failed"}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-zinc-800 px-4 py-1.5 text-sm font-medium hover:bg-zinc-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mut.isPending || !url.trim()}
              className="flex items-center gap-2 rounded-full bg-gradient-to-b from-accent to-accent-strong px-4 py-1.5 text-sm font-semibold text-accent-ink shadow-sm shadow-accent/30 hover:shadow-md hover:shadow-accent/40 disabled:opacity-50"
            >
              {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Download
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
