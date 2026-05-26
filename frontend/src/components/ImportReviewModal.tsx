import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  X, Tv, ListMusic, Search, Loader2, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronUp, Upload, SlidersHorizontal,
} from "lucide-react";
import { backupApi, type DownloadPolicy, type Quality, type ImportReport } from "../lib/api";
import { formatCount } from "../lib/format";

/* ───────────────────────────── shapes ──────────────────────────────────── */

interface ChannelExport {
  url: string;
  name?: string;
  thumbnail_url?: string | null;
  subscriber_count?: number | null;
  download_policy?: string | null;
  quality?: string | null;
  retention_days?: number | null;
  sync_interval_minutes?: number | null;
  show_on_home?: boolean;
  latest_count?: number | null;
}

interface PlaylistExport {
  url: string;
  title?: string;
  thumbnail_url?: string | null;
  uploader?: string | null;
  video_count?: number;
  quality?: string | null;
  retention_days?: number | null;
  keep_videos_forever?: boolean;
  is_music?: boolean;
}

export interface ImportPayload {
  version?:  number;
  channels?:  ChannelExport[];
  playlists?: PlaylistExport[];
  settings?:  Record<string, unknown>;
}

// Editable row state — extends the JSON shape with UI-only fields (selection
// flag and resolve status for the lazy YouTube-metadata fetch).
type ChRow = ChannelExport  & { checked: boolean; loading?: boolean; resolveError?: string };
type PlRow = PlaylistExport & { checked: boolean; loading?: boolean; resolveError?: string };

/* ───────────────────────────── helpers ─────────────────────────────────── */

const POLICY_OPTIONS: { value: DownloadPolicy; label: string }[] = [
  { value: "new-only", label: "Only new" },
  { value: "latest",   label: "Latest N" },
  { value: "last-7",   label: "Last 7 days" },
  { value: "last-30",  label: "Last 30 days" },
  { value: "last-90",  label: "Last 90 days" },
  { value: "last-365", label: "Last year" },
  { value: "all",      label: "Everything" },
];

function isSearch(url: string) {
  return typeof url === "string" && url.startsWith("ytsearch");
}

/* ───────────────────────────── component ───────────────────────────────── */

export function ImportReviewModal({
  payload, onClose, onDone,
}: {
  payload: ImportPayload;
  onClose: () => void;
  onDone: (report: ImportReport) => void;
}) {
  const channels  = payload.channels  ?? [];
  const playlists = payload.playlists ?? [];
  const settingsKeys = Object.keys(payload.settings ?? {});

  // Editable copies — keyed by URL.
  const [chState, setChState] = useState<Map<string, ChRow>>(() => {
    const m = new Map<string, ChRow>();
    channels.forEach((c) => m.set(c.url, { ...c, checked: true }));
    return m;
  });
  const [plState, setPlState] = useState<Map<string, PlRow>>(() => {
    const m = new Map<string, PlRow>();
    playlists.forEach((p) => m.set(p.url, { ...p, checked: true }));
    return m;
  });
  const [applySettings, setApplySettings] = useState(true);

  // ── Lazy-fetch metadata for rows that arrived URL-only ─────────────────────
  //
  // Old backups (or hand-written JSON) won't have name/thumbnail. We hit
  // /api/backup/preview for each missing one with a small concurrency cap —
  // yt-dlp metadata calls are seconds each, so flooding YouTube isn't kind.
  const fetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const todoCh = channels.filter((c) => !c.name && !c.thumbnail_url && !fetchedRef.current.has(c.url));
    const todoPl = playlists.filter((p) => !p.title && !p.thumbnail_url && !fetchedRef.current.has(p.url));
    if (todoCh.length === 0 && todoPl.length === 0) return;
    todoCh.forEach((c) => fetchedRef.current.add(c.url));
    todoPl.forEach((p) => fetchedRef.current.add(p.url));

    todoCh.forEach((c) => updateCh(c.url, { loading: true }));
    todoPl.forEach((p) => updatePl(p.url, { loading: true }));

    runWithLimit(3, [
      ...todoCh.map((c) => () => backupApi.previewChannel(c.url)
        .then((info) => updateCh(c.url, {
          name: info.name ?? c.url,
          thumbnail_url: info.thumbnail_url,
          subscriber_count: info.subscriber_count,
          loading: false,
        }))
        .catch((e) => updateCh(c.url, { loading: false, resolveError: (e as Error)?.message }))),
      ...todoPl.map((p) => () => backupApi.previewPlaylist(p.url)
        .then((info) => updatePl(p.url, {
          title: info.title ?? p.url,
          thumbnail_url: info.thumbnail_url,
          uploader: info.uploader,
          video_count: info.video_count ?? undefined,
          loading: false,
        }))
        .catch((e) => updatePl(p.url, { loading: false, resolveError: (e as Error)?.message }))),
    ]);
    // We intentionally run once — the user can't add rows after open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [tab, setTab] = useState<"channels" | "playlists" | "settings">(
    channels.length > 0 ? "channels" : playlists.length > 0 ? "playlists" : "settings",
  );

  const chCount = useMemo(() => [...chState.values()].filter((c) => c.checked).length, [chState]);
  const plCount = useMemo(() => [...plState.values()].filter((p) => p.checked).length, [plState]);
  const total   = chCount + plCount + (applySettings && settingsKeys.length > 0 ? 1 : 0);

  const mut = useMutation({
    mutationFn: () => backupApi.importJson({
      version:   1,
      channels:  [...chState.values()].filter((c) => c.checked).map(({ checked: _c, ...rest }) => rest),
      playlists: [...plState.values()].filter((p) => p.checked).map(({ checked: _c, ...rest }) => rest),
      settings:  applySettings ? (payload.settings ?? {}) : {},
    }),
    onSuccess: (r) => onDone(r),
  });

  function updateCh(url: string, patch: Partial<ChRow>) {
    setChState((cur) => {
      const next = new Map(cur);
      const e = next.get(url); if (!e) return cur;
      next.set(url, { ...e, ...patch });
      return next;
    });
  }
  function updatePl(url: string, patch: Partial<PlRow>) {
    setPlState((cur) => {
      const next = new Map(cur);
      const e = next.get(url); if (!e) return cur;
      next.set(url, { ...e, ...patch });
      return next;
    });
  }
  function setAll(value: boolean) {
    if (tab === "channels") {
      setChState((cur) => {
        const next = new Map(cur);
        for (const [k, v] of next) next.set(k, { ...v, checked: value });
        return next;
      });
    } else if (tab === "playlists") {
      setPlState((cur) => {
        const next = new Map(cur);
        for (const [k, v] of next) next.set(k, { ...v, checked: value });
        return next;
      });
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-3xl h-[92vh] sm:max-h-[88vh] flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 shadow-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3 sm:px-5">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Upload className="h-5 w-5" />
            Review import
          </h2>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-zinc-800" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-zinc-800 px-2 sm:px-4 overflow-x-auto">
          <Tab active={tab === "channels"}  onClick={() => setTab("channels")}>
            Channels <Pill n={chCount} total={channels.length} />
          </Tab>
          <Tab active={tab === "playlists"} onClick={() => setTab("playlists")}>
            Playlists <Pill n={plCount} total={playlists.length} />
          </Tab>
          <Tab active={tab === "settings"}  onClick={() => setTab("settings")}>
            Settings <Pill n={applySettings ? settingsKeys.length : 0} total={settingsKeys.length} />
          </Tab>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 sm:px-5 py-3 space-y-2">
          {tab === "channels" && (
            <>
              {channels.length === 0 && <Empty kind="channels" />}
              {channels.length > 0 && (
                <BulkRow label="channels" onAll={() => setAll(true)} onNone={() => setAll(false)} />
              )}
              {channels.map((c) => {
                const e = chState.get(c.url);
                if (!e) return null;
                return (
                  <ChannelRow key={c.url} c={e} onChange={(patch) => updateCh(c.url, patch)} />
                );
              })}
            </>
          )}

          {tab === "playlists" && (
            <>
              {playlists.length === 0 && <Empty kind="playlists" />}
              {playlists.length > 0 && (
                <BulkRow label="playlists" onAll={() => setAll(true)} onNone={() => setAll(false)} />
              )}
              {playlists.map((p) => {
                const e = plState.get(p.url);
                if (!e) return null;
                return (
                  <PlaylistRow key={p.url} p={e} onChange={(patch) => updatePl(p.url, patch)} />
                );
              })}
            </>
          )}

          {tab === "settings" && (
            <div className="space-y-3">
              {settingsKeys.length === 0 ? (
                <Empty kind="settings" />
              ) : (
                <>
                  <label className="flex items-start gap-3 cursor-pointer rounded-xl bg-zinc-800/40 p-3">
                    <input
                      type="checkbox"
                      checked={applySettings}
                      onChange={(e) => setApplySettings(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-sky-400"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-100">
                        Apply {settingsKeys.length} settings key{settingsKeys.length === 1 ? "" : "s"}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Merges into your current settings — existing keys are overwritten.
                      </p>
                      <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-zinc-400">
                        {settingsKeys.sort().map((k) => (
                          <li key={k} className="truncate">· <span className="text-zinc-300">{k}</span></li>
                        ))}
                      </ul>
                    </div>
                  </label>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-4 py-3 sm:px-5 flex items-center justify-end gap-3">
          {mut.isError && (
            <p className="mr-auto text-xs text-red-400">
              <AlertTriangle className="inline h-3 w-3 mr-1" />
              {(mut.error as Error)?.message}
            </p>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-zinc-800 px-4 py-2 text-sm font-medium hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => mut.mutate()}
            disabled={mut.isPending || total === 0}
            className="flex items-center gap-2 rounded-full bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white disabled:opacity-40"
          >
            {mut.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <CheckCircle2 className="h-4 w-4" />}
            Import {total > 0 && <span className="tabular-nums">({total})</span>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── pieces ──────────────────────────────────── */

function Tab({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
        active
          ? "border-sky-400 text-zinc-100"
          : "border-transparent text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

function Pill({ n, total }: { n: number; total: number }) {
  if (total === 0) return null;
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
      n === total
        ? "bg-sky-500/25 text-sky-200"
        : n === 0
          ? "bg-zinc-800 text-zinc-500"
          : "bg-zinc-700 text-zinc-200"
    }`}>
      {n}/{total}
    </span>
  );
}

function Empty({ kind }: { kind: string }) {
  return (
    <p className="rounded-xl bg-zinc-800/30 px-4 py-6 text-center text-sm text-zinc-500">
      Nothing in this section.
    </p>
  );
}

function BulkRow({
  label, onAll, onNone,
}: { label: string; onAll: () => void; onNone: () => void }) {
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-400 mb-2">
      <span>Select:</span>
      <button onClick={onAll}  className="rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-200 hover:bg-zinc-700">all {label}</button>
      <button onClick={onNone} className="rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-200 hover:bg-zinc-700">none</button>
    </div>
  );
}

/* ───────────────────────────── rows ────────────────────────────────────── */

function ChannelRow({
  c, onChange,
}: {
  c: ChannelExport & { checked: boolean; loading?: boolean; resolveError?: string };
  onChange: (patch: Partial<ChannelExport & { checked: boolean; loading?: boolean; resolveError?: string }>) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Short meta line — only show parts we actually know something about so
  // the UI doesn't feel littered with placeholders.
  const metaParts: string[] = [];
  if (c.subscriber_count) metaParts.push(`${formatCount(c.subscriber_count)} subs`);
  if (c.download_policy && c.download_policy !== "new-only") metaParts.push(c.download_policy);
  if (c.retention_days)   metaParts.push(`retention ${c.retention_days}d`);

  return (
    <div className={`rounded-xl bg-zinc-800/40 ring-1 transition-all ${
      c.checked ? "ring-zinc-700" : "ring-zinc-800 opacity-60"
    }`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          checked={c.checked}
          onChange={(e) => onChange({ checked: e.target.checked })}
          className="h-4 w-4 accent-sky-400"
        />
        {c.thumbnail_url ? (
          <img
            src={c.thumbnail_url} alt=""
            referrerPolicy="no-referrer"
            className="h-10 w-10 flex-shrink-0 rounded-full object-cover bg-zinc-800"
          />
        ) : (
          <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-zinc-800">
            {c.loading
              ? <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
              : <Tv       className="h-5 w-5 text-zinc-500" />}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">
            {c.name ?? (c.loading ? "Resolving…" : c.url)}
          </p>
          <p className="truncate text-xs text-zinc-500">
            {c.resolveError ? (
              <span className="text-amber-400">couldn't resolve · {c.resolveError}</span>
            ) : metaParts.length ? (
              metaParts.join(" · ")
            ) : (
              <span className="truncate text-zinc-600">{c.url}</span>
            )}
          </p>
        </div>
        <button
          onClick={() => setExpanded((s) => !s)}
          className="rounded-full p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Edit settings"
          disabled={!c.checked}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </div>

      {expanded && c.checked && (
        <div className="border-t border-zinc-800/70 p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Quality">
            <select
              value={c.quality ?? ""}
              onChange={(e) => onChange({ quality: e.target.value || null })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm"
            >
              <option value="">Inherit global</option>
              <option value="best">Best</option>
              <option value="1080">1080p</option>
              <option value="720">720p</option>
              <option value="480">480p</option>
              <option value="360">360p</option>
            </select>
          </Field>
          <Field label="Retention (days)">
            <input
              type="number" min={0}
              value={c.retention_days ?? ""}
              onChange={(e) => onChange({ retention_days: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="inherit"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm"
            />
          </Field>
          <Field label="Download policy">
            <select
              value={c.download_policy ?? "new-only"}
              onChange={(e) => onChange({ download_policy: e.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm"
            >
              {POLICY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          {c.download_policy === "latest" && (
            <Field label="Latest N videos">
              <input
                type="number" min={1}
                value={c.latest_count ?? 10}
                onChange={(e) => onChange({ latest_count: Number(e.target.value) || 1 })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm"
              />
            </Field>
          )}
          <Field label="Sync interval (min)">
            <input
              type="number" min={1}
              value={c.sync_interval_minutes ?? ""}
              onChange={(e) => onChange({ sync_interval_minutes: e.target.value === "" ? null : Number(e.target.value) })}
              placeholder="inherit"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm"
            />
          </Field>
          <Field label="Show on Home">
            <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={c.show_on_home ?? true}
                onChange={(e) => onChange({ show_on_home: e.target.checked })}
                className="h-4 w-4 accent-sky-400"
              />
              <span className="text-zinc-300">{c.show_on_home ? "Visible" : "Hidden"}</span>
            </label>
          </Field>
        </div>
      )}
    </div>
  );
}

function PlaylistRow({
  p, onChange,
}: {
  p: PlaylistExport & { checked: boolean; loading?: boolean; resolveError?: string };
  onChange: (patch: Partial<PlaylistExport & { checked: boolean; loading?: boolean; resolveError?: string }>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const search = isSearch(p.url);
  return (
    <div className={`rounded-xl bg-zinc-800/40 ring-1 transition-all ${
      p.checked ? "ring-zinc-700" : "ring-zinc-800 opacity-60"
    }`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          checked={p.checked}
          onChange={(e) => onChange({ checked: e.target.checked })}
          className="h-4 w-4 accent-sky-400"
        />
        {p.thumbnail_url ? (
          <img
            src={p.thumbnail_url} alt=""
            referrerPolicy="no-referrer"
            className="h-10 w-16 flex-shrink-0 rounded object-cover bg-zinc-800"
          />
        ) : (
          <div className="grid h-10 w-16 flex-shrink-0 place-items-center rounded bg-zinc-800">
            {p.loading
              ? <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
              : (search ? <Search   className="h-5 w-5 text-zinc-500" />
                        : <ListMusic className="h-5 w-5 text-zinc-500" />)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">
            {p.title ?? (p.loading ? "Resolving…" : p.url)}
          </p>
          <p className="truncate text-xs text-zinc-500">
            {p.resolveError ? (
              <span className="text-amber-400">couldn't resolve · {p.resolveError}</span>
            ) : (
              <>
                {search ? "Search collection" : p.uploader ?? "Playlist"}
                {p.video_count ? ` · ${p.video_count} videos` : ""}
                {p.is_music ? " · music" : ""}
                {p.keep_videos_forever ? " · keep-forever" : ""}
              </>
            )}
          </p>
        </div>
        <button
          onClick={() => setExpanded((s) => !s)}
          className="rounded-full p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Edit settings"
          disabled={!p.checked}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {expanded && p.checked && (
        <div className="border-t border-zinc-800/70 p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Quality">
            <select
              value={p.quality ?? ""}
              onChange={(e) => onChange({ quality: e.target.value || null })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm"
            >
              <option value="">Inherit global</option>
              <option value="best">Best</option>
              <option value="1080">1080p</option>
              <option value="720">720p</option>
              <option value="480">480p</option>
              <option value="360">360p</option>
            </select>
          </Field>
          <Field label="Keep videos forever">
            <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={!!p.keep_videos_forever}
                onChange={(e) => onChange({ keep_videos_forever: e.target.checked })}
                className="h-4 w-4 accent-amber-400"
              />
              <span className="text-zinc-300">{p.keep_videos_forever ? "Protected" : "Subject to retention"}</span>
            </label>
          </Field>
          <Field label="Music">
            <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={!!p.is_music}
                onChange={(e) => onChange({ is_music: e.target.checked })}
                className="h-4 w-4 accent-fuchsia-400"
              />
              <span className="text-zinc-300">{p.is_music ? "In Music section" : "Regular playlist"}</span>
            </label>
          </Field>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Run async tasks with at most ``cap`` in flight — protects YouTube from
 *  N parallel metadata extracts on big imports. */
async function runWithLimit<T>(cap: number, factories: Array<() => Promise<T>>): Promise<T[]> {
  const out: T[] = new Array(factories.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(cap, factories.length) }, async () => {
    while (idx < factories.length) {
      const my = idx++;
      try { out[my] = await factories[my](); } catch { /* per-task handler logs */ }
    }
  });
  await Promise.all(workers);
  return out;
}

// Helper consumed only for the prop type — kept around so unused-import linter
// stays quiet if we ever refactor.
export const _types = { } as { Q?: Quality };
