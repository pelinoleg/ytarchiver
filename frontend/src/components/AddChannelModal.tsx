import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Loader2 } from "lucide-react";
import { channelsApi, channelFoldersApi, settingsApi, type DownloadPolicy, type Quality } from "../lib/api";
import { RetentionPicker } from "./RetentionPicker";
import { useToast } from "./ToastProvider";

const POLICY_OPTIONS: { value: DownloadPolicy; label: string; short: string; hint: string }[] = [
  { value: "new-only", label: "Only new",      short: "Only new",   hint: "Только видео, опубликованные после подписки" },
  { value: "latest",   label: "Last N videos", short: "Last N",     hint: "Просто последние N штук, без учёта дат" },
  { value: "last-7",   label: "Last 7 days",   short: "7 days",     hint: "Видео за последнюю неделю + всё новое" },
  { value: "last-30",  label: "Last 30 days",  short: "30 days",    hint: "За последний месяц + всё новое" },
  { value: "last-90",  label: "Last 90 days",  short: "3 months",   hint: "За последние 3 месяца + всё новое" },
  { value: "last-365", label: "Last year",     short: "1 year",     hint: "За последний год + всё новое" },
  { value: "all",      label: "Everything",    short: "Everything", hint: "Всё, что есть на канале (может быть много)" },
];

export function AddChannelModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [policy, setPolicy] = useState<DownloadPolicy>("new-only");
  const [latestCount, setLatestCount] = useState(10);
  const [quality, setQuality] = useState<Quality | "">("");
  const [retention, setRetention] = useState<number | null>(null);
  const [showOnHome, setShowOnHome] = useState(true);
  const [folderId, setFolderId] = useState<number | null>(null);
  // Inline-create state for "+ New folder" picked from the dropdown.
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const qcInner = useQueryClient();
  const { data: globalSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: settingsApi.get,
  });
  const { data: folders = [] } = useQuery({
    queryKey: ["channel-folders"],
    queryFn:  channelFoldersApi.list,
  });

  const createFolderMut = useMutation({
    mutationFn: (name: string) => channelFoldersApi.create(name),
    onSuccess: (f) => {
      qcInner.invalidateQueries({ queryKey: ["channel-folders"] });
      setFolderId(f.id);
      setCreatingFolder(false);
      setNewFolderName("");
    },
  });

  const mut = useMutation({
    mutationFn: () =>
      channelsApi.subscribe({
        url: url.trim(),
        download_policy: policy,
        quality: quality === "" ? null : quality,
        retention_days: retention,
        show_on_home: showOnHome,
        folder_id: folderId,
        latest_count: policy === "latest" ? latestCount : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
      toast("Channel subscribed");
      onClose();
    },
    onError: () => toast("Couldn't subscribe to that channel", "error"),
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
          <h2 className="text-lg font-semibold">Add channel</h2>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-zinc-800" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); if (url.trim()) mut.mutate(); }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Channel URL
            </label>
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/@channel"
              className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder:text-zinc-600 focus:border-zinc-600"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">
              What to download
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {POLICY_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPolicy(p.value)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    policy === p.value
                      ? "bg-accent text-accent-ink"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  {p.short}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              {POLICY_OPTIONS.find((p) => p.value === policy)?.hint}
            </p>
            {policy === "latest" && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number" min={1} max={500}
                  value={latestCount}
                  onChange={(e) => setLatestCount(Math.max(1, Number(e.target.value) || 1))}
                  className="w-24 rounded-lg bg-zinc-950 px-3 py-1.5 text-sm ring-1 ring-white/10 focus:ring-accent/50"
                />
                <span className="text-xs text-zinc-400">videos</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Quality override
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {([
                ["", `Inherit${globalSettings ? ` · ${formatQuality(globalSettings.default_quality)}` : ""}`],
                ["best", "Best"], ["1080", "1080p"], ["720", "720p"], ["480", "480p"], ["360", "360p"],
              ] as [Quality | "", string][]).map(([v, l]) => (
                <button
                  key={v || "inherit"}
                  type="button"
                  onClick={() => setQuality(v)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    quality === v
                      ? "bg-accent text-accent-ink"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Folder
            </label>
            <div className="mt-2 space-y-2">
              {creatingFolder ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (newFolderName.trim()) createFolderMut.mutate(newFolderName.trim());
                      }
                      if (e.key === "Escape") { setCreatingFolder(false); setNewFolderName(""); }
                    }}
                    placeholder="Folder name"
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm focus:border-zinc-500"
                  />
                  <button
                    type="button"
                    onClick={() => { if (newFolderName.trim()) createFolderMut.mutate(newFolderName.trim()); }}
                    disabled={createFolderMut.isPending || !newFolderName.trim()}
                    className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink hover:bg-accent-strong disabled:opacity-60"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCreatingFolder(false); setNewFolderName(""); }}
                    className="text-xs text-zinc-400 hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setFolderId(null)}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                      folderId == null ? "bg-accent text-accent-ink" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    }`}
                  >
                    Ungrouped
                  </button>
                  {folders.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFolderId(f.id)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                        folderId === f.id ? "bg-accent text-accent-ink" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                      }`}
                    >
                      {f.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCreatingFolder(true)}
                    className="rounded-full px-3 py-1.5 text-sm font-medium text-accent ring-1 ring-accent/40 hover:bg-accent/10"
                  >
                    + New
                  </button>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Retention for this channel
            </label>
            <div className="mt-2">
              <RetentionPicker value={retention} onChange={setRetention} />
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 px-3 py-2 text-sm hover:border-zinc-700">
            <input
              type="checkbox"
              checked={showOnHome}
              onChange={(e) => setShowOnHome(e.target.checked)}
              className="mt-0.5 accent-zinc-100"
            />
            <div className="flex-1">
              <div className="font-medium">Show on Home</div>
              <div className="text-xs text-zinc-400">
                Off → videos are still downloaded but only appear on this channel's page
                (and in search). Useful for noisy channels you watch on demand.
              </div>
            </div>
          </label>

          {mut.isError && (
            <p className="text-sm text-red-400">{(mut.error as Error)?.message ?? "Failed"}</p>
          )}

          {policy === "latest" && (
            <p className="rounded-lg bg-zinc-800/60 px-3 py-2 text-xs text-zinc-400">
              Берёт первые {latestCount} видео с канала (без учёта дат). Дальше периодический
              sync будет добавлять новые загрузки сверху.
            </p>
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
              Subscribe
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatQuality(q: string | undefined): string {
  if (!q) return "best";
  if (q === "best") return "best available";
  return `${q}p`;
}
