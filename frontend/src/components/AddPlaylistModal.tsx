import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { X, Loader2, ListMusic, Link2, Search } from "lucide-react";
import { playlistsApi, settingsApi, type Quality } from "../lib/api";
import { RetentionPicker } from "./RetentionPicker";
import { describeQuality } from "../lib/format";

type Mode = "url" | "search";

export function AddPlaylistModal({
  onClose, initialMode = "url",
}: { onClose: () => void; initialMode?: Mode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(5);
  const [quality, setQuality] = useState<Quality | "">("");
  const [retention, setRetention] = useState<number | null>(null);

  const { data: globalSettings } = useQuery({
    queryKey: ["settings"],
    queryFn: settingsApi.get,
  });

  const mut = useMutation({
    mutationFn: () => {
      const opts = {
        quality: quality === "" ? null : quality,
        retention_days: retention,
      };
      if (mode === "url") {
        return playlistsApi.subscribe({ url: url.trim(), ...opts });
      }
      return playlistsApi.subscribeSearch({
        query: query.trim(),
        count: Math.max(1, Math.min(100, Number(count) || 5)),
        ...opts,
      });
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
      onClose();
      navigate(`/playlist/${p.id}`);
    },
  });

  const canSubmit = mode === "url" ? !!url.trim() : !!query.trim() && count > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-zinc-900 p-5 sm:p-6 shadow-xl"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ListMusic className="h-5 w-5" />
            Add playlist
          </h2>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-zinc-800" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="mb-4 inline-flex rounded-full bg-zinc-950 p-0.5">
          <ModeButton active={mode === "url"} onClick={() => setMode("url")} icon={Link2} label="By URL" />
          <ModeButton active={mode === "search"} onClick={() => setMode("search")} icon={Search} label="By search" />
        </div>

        <p className="mb-4 text-xs text-zinc-400">
          {mode === "url"
            ? "YouTube-плейлист целиком. Видео не показываются на Home, только на странице плейлиста."
            : "Скачать top-N результатов поиска YouTube. Полезно для тематических подборок типа \"обзор amazon echo\"."}
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); if (canSubmit) mut.mutate(); }}
          className="space-y-5"
        >
          {mode === "url" ? (
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">
                Playlist URL
              </label>
              <input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/playlist?list=PL..."
                className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder:text-zinc-600 focus:border-zinc-600"
                required
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Поисковый запрос
                </label>
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="обзор amazon echo"
                  className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder:text-zinc-600 focus:border-zinc-600"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">
                  Сколько видео скачать
                </label>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number" min={1} max={100}
                    value={count}
                    onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                    className="w-24 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-zinc-600"
                  />
                  <span className="text-xs text-zinc-400">top-N результатов</span>
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Quality
            </label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as Quality | "")}
              className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-zinc-600"
            >
              <option value="">
                Inherit global
                {globalSettings ? ` (${describeQuality(globalSettings.default_quality)})` : ""}
              </option>
              <option value="best">Best available</option>
              <option value="1080">1080p</option>
              <option value="720">720p</option>
              <option value="480">480p</option>
              <option value="360">360p</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Retention
            </label>
            <div className="mt-2">
              <RetentionPicker value={retention} onChange={setRetention} />
            </div>
          </div>

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
              disabled={mut.isPending || !canSubmit}
              className="flex items-center gap-2 rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
            >
              {mut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "url" ? "Subscribe" : "Build playlist"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModeButton({
  active, onClick, icon: Icon, label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Link2;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
        active
          ? "bg-zinc-100 text-zinc-950"
          : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
