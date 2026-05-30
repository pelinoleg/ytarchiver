import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Inbox, Loader2, AlertTriangle, Clock, RefreshCw, X, Download,
  Gauge, Hourglass, Pause, Play, ChevronDown, ChevronRight, ListMusic, Tv,
} from "lucide-react";
import {
  queueApi, videosApi, playlistsApi, musicApi, thumbUrl,
  type Video, type Playlist,
} from "../lib/api";
import { formatBytes, formatDuration } from "../lib/format";
import { useConfirm } from "../components/ConfirmProvider";

export function DownloadsPage() {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["queue"],
    queryFn: queueApi.list,
    refetchInterval: 3_000,
  });
  const { data: status } = useQuery({
    queryKey: ["queue-status"],
    queryFn: queueApi.status,
    refetchInterval: 5_000,
  });
  const togglePause = useMutation({
    mutationFn: () => (status?.paused ? queueApi.resume() : queueApi.pause()),
    onSuccess: (next) => {
      qc.setQueryData(["queue-status"], next);
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });

  // Bucket by status — the queue API already returns them in this order,
  // but we render distinct sections so each gets the right visual weight.
  const downloading = items.filter((v) => v.status === "downloading");
  const waiting     = items.filter((v) => v.status === "pending" || v.status === "queued");
  const failed      = items.filter((v) => v.status === "error");

  // Aggregate download progress for the hero progress bar.
  const totalDl  = downloading.reduce((s, v) => s + (v.downloaded_bytes ?? 0), 0);
  const totalAll = downloading.reduce((s, v) => s + (v.total_bytes      ?? 0), 0);
  const aggPct   = totalAll > 0 ? (totalDl / totalAll) * 100 : 0;

  return (
    <>
      <Hero
        active={downloading.length}
        waiting={waiting.length}
        failed={failed.length}
        totalDl={totalDl}
        totalAll={totalAll}
        aggPct={aggPct}
        paused={!!status?.paused}
        onTogglePause={() => togglePause.mutate()}
        togglePending={togglePause.isPending}
      />

      {isLoading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-8">
          {downloading.length > 0 && (
            <Section
              icon={Loader2}
              iconClass="text-red-400 animate-spin"
              title="Downloading now"
              count={downloading.length}
            >
              <div className="space-y-3">
                {downloading.map((v) => <ActiveCard key={v.id} v={v} />)}
              </div>
            </Section>
          )}

          {waiting.length > 0 && (
            <Section
              icon={Hourglass}
              iconClass="text-amber-300"
              title="Waiting"
              count={waiting.length}
            >
              <WaitingGroups items={waiting} />
            </Section>
          )}

          {failed.length > 0 && (
            <Section
              icon={AlertTriangle}
              iconClass="text-red-400"
              title="Failed"
              count={failed.length}
            >
              <div className="space-y-2">
                {failed.map((v) => <FailedCard key={v.id} v={v} />)}
              </div>
            </Section>
          )}
        </div>
      )}
    </>
  );
}

/* ──────────────────────────────  Hero  ────────────────────────────────── */

function Hero({
  active, waiting, failed, totalDl, totalAll, aggPct,
  paused, onTogglePause, togglePending,
}: {
  active: number;
  waiting: number;
  failed: number;
  totalDl: number;
  totalAll: number;
  aggPct: number;
  paused: boolean;
  onTogglePause: () => void;
  togglePending: boolean;
}) {
  const anyActive = active + waiting + failed > 0;
  return (
    <header className="relative mb-8 overflow-hidden rounded-3xl shadow-xl shadow-black/40">
      <div className="absolute inset-0 bg-gradient-to-br from-red-900/35 via-zinc-900 to-zinc-950" />
      {/* Thin red glow along the top edge while anything is in flight. */}
      {active > 0 && !paused && (
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-red-500/15 to-transparent" />
      )}

      <div className="relative px-6 py-7 sm:px-9 sm:py-9">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-red-200">
              <Download className="h-4 w-4" />
              Downloads
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white drop-shadow-sm">
              Очередь
            </h1>
          </div>
          <button
            type="button"
            onClick={onTogglePause}
            disabled={togglePending}
            className={
              "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold ring-1 transition " +
              (paused
                ? "bg-emerald-500/15 text-emerald-200 ring-emerald-500/30 hover:bg-emerald-500/25"
                : "bg-zinc-800/80 text-zinc-100 ring-zinc-700 hover:bg-zinc-700") +
              (togglePending ? " opacity-60" : "")
            }
            title={paused ? "Возобновить все загрузки" : "Поставить все загрузки на паузу"}
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? "Возобновить" : "Пауза"}
          </button>
        </div>

        {paused && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-200 ring-1 ring-amber-500/30">
            <Pause className="h-3.5 w-3.5" />
            Загрузки на паузе — текущая докачается, новые не стартуют
          </div>
        )}

        {anyActive ? (
          <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-zinc-200/90">
            <Pill n={active}  label={active === 1 ? "active" : "active"}  tone="red"   />
            <Pill n={waiting} label="waiting" tone="amber" />
            {failed > 0 && <Pill n={failed} label="failed" tone="red-soft" />}
          </p>
        ) : (
          <p className="mt-2 text-sm text-zinc-400">Nothing in flight.</p>
        )}

        {active > 0 && totalAll > 0 && (
          <div className="mt-6 max-w-2xl">
            <div className="flex items-baseline justify-between text-xs text-zinc-300 mb-1.5">
              <span className="flex items-center gap-1.5 font-medium">
                <Gauge className="h-3.5 w-3.5 text-red-300" />
                {aggPct.toFixed(0)}%
              </span>
              <span className="tabular-nums text-zinc-400">
                {formatBytes(totalDl)} <span className="text-zinc-600">/</span> {formatBytes(totalAll)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-gradient-to-r from-red-500 to-red-400 transition-[width] duration-300"
                style={{ width: `${Math.min(100, aggPct)}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function Pill({
  n, label, tone,
}: { n: number; label: string; tone: "red" | "amber" | "red-soft" }) {
  if (n === 0) return null;
  const styles = {
    red:        "bg-red-500/15   text-red-200    ring-red-500/30",
    amber:      "bg-amber-500/15 text-amber-200  ring-amber-500/30",
    "red-soft": "bg-red-500/10   text-red-300/80 ring-red-500/20",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${styles}`}>
      <span className="tabular-nums">{n}</span>
      <span className="font-medium opacity-80">{label}</span>
    </span>
  );
}

/* ────────────────────────────  Sections  ──────────────────────────────── */

function Section({
  icon: Icon, iconClass, title, count, children,
}: {
  icon: typeof Loader2;
  iconClass?: string;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${iconClass ?? "text-zinc-500"}`} />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-200">{title}</h2>
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-400 tabular-nums">
          {count}
        </span>
      </div>
      {children}
    </section>
  );
}

/* ─────────────────────────  Waiting, grouped  ─────────────────────────── */

// Max rows rendered per expanded group — keeps the DOM bounded even when a
// single playlist has thousands queued. The rest are reachable via the group's
// own page (the "+N more" footer link).
const GROUP_ROW_CAP = 40;

type QueueGroupData = {
  key: string;
  kind: "playlist" | "channel";
  id: number;
  title: string;
  thumbnail: string | null;
  items: Video[];
};

function WaitingGroups({ items }: { items: Video[] }) {
  // Playlist done/total powers each group's progress bar. Regular and music
  // playlist lists are disjoint, so merge both, keyed by id.
  const { data: regularPls = [] } = useQuery({ queryKey: ["playlists"], queryFn: playlistsApi.list });
  const { data: musicPls = [] }   = useQuery({ queryKey: ["music", "playlists"], queryFn: musicApi.playlists });
  const plById = new Map<number, Playlist>();
  for (const p of [...regularPls, ...musicPls]) plById.set(p.id, p);

  // Group by playlist when the video has one, else by channel.
  const groups: QueueGroupData[] = (() => {
    const map = new Map<string, QueueGroupData>();
    for (const v of items) {
      const key = v.playlist_id ? `p:${v.playlist_id}` : `c:${v.channel_id}`;
      let g = map.get(key);
      if (!g) {
        g = v.playlist_id
          ? {
              key, kind: "playlist", id: v.playlist_id,
              title: plById.get(v.playlist_id)?.title ?? v.playlist_title ?? "Playlist",
              thumbnail: plById.get(v.playlist_id)?.thumbnail_url ?? null,
              items: [],
            }
          : {
              key, kind: "channel", id: v.channel_id,
              title: v.channel_name ?? "Unknown channel",
              thumbnail: v.channel_thumbnail ?? null,
              items: [],
            };
        map.set(key, g);
      }
      g.items.push(v);
    }
    return [...map.values()].sort((a, b) => b.items.length - a.items.length);
  })();

  // First group expanded by default, rest collapsed. User toggles override the
  // default and are keyed by group id, so they survive the 3s refetch. We
  // always render the group header (even for a single group) so the playlist
  // name + download-progress bar stay visible.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-2">
      {groups.map((g, i) => (
        <QueueGroup
          key={g.key}
          g={g}
          open={overrides[g.key] ?? i === 0}
          playlist={g.kind === "playlist" ? plById.get(g.id) : undefined}
          onToggle={() => setOverrides((o) => ({ ...o, [g.key]: !(o[g.key] ?? i === 0) }))}
        />
      ))}
    </div>
  );
}

function QueueGroup({
  g, open, playlist, onToggle,
}: {
  g: QueueGroupData;
  open: boolean;
  playlist: Playlist | undefined;
  onToggle: () => void;
}) {
  const total = playlist?.video_count ?? 0;
  const done  = playlist?.done_count ?? 0;
  const pct   = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const to = g.kind === "playlist" ? `/playlist/${g.id}` : `/channel/${g.id}`;
  const round = g.kind === "channel" ? "rounded-full" : "rounded-lg";

  return (
    <div className="overflow-hidden rounded-xl bg-zinc-900/60 shadow-[0_12px_34px_-22px_rgba(0,0,0,0.6)]">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={open}
        >
          <span className="flex-shrink-0 text-zinc-500">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
          {g.thumbnail ? (
            <img src={g.thumbnail} alt="" referrerPolicy="no-referrer" loading="lazy"
                 className={`h-9 w-9 flex-shrink-0 object-cover bg-zinc-800 ${round}`} />
          ) : (
            <div className={`grid h-9 w-9 flex-shrink-0 place-items-center bg-zinc-800 ${round}`}>
              {g.kind === "playlist"
                ? <ListMusic className="h-4 w-4 text-fuchsia-300/70" />
                : <Tv className="h-4 w-4 text-zinc-500" />}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-zinc-100" title={g.title}>{g.title}</p>
            {g.kind === "playlist" && total > 0 ? (
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full bg-fuchsia-500 transition-[width] duration-500" style={{ width: `${pct}%` }} />
                </div>
                <span className="flex-shrink-0 text-[11px] tabular-nums text-zinc-400">
                  {done} / {total} · {pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%
                </span>
              </div>
            ) : (
              <p className="mt-0.5 text-[11px] capitalize text-zinc-500">{g.kind}</p>
            )}
          </div>
        </button>
        <span className="flex-shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-200 tabular-nums ring-1 ring-amber-500/25">
          {g.items.length}
        </span>
      </div>
      {open && (
        <div className="border-t border-zinc-800/50">
          <GroupRows items={g.items} to={to} />
        </div>
      )}
    </div>
  );
}

function GroupRows({ items, to }: { items: Video[]; to: string }) {
  const shown = items.slice(0, GROUP_ROW_CAP);
  const extra = items.length - shown.length;
  return (
    <>
      {shown.map((v) => <CompactRow key={v.id} v={v} />)}
      {extra > 0 && (
        <Link
          to={to}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200"
        >
          +{extra} more in this list
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </>
  );
}

/* ───────────────────────────  Card variants  ──────────────────────────── */

function ActiveCard({ v }: { v: Video }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const cancel = useMutation({
    mutationFn: () => videosApi.delete(v.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
    },
  });

  const thumb = v.thumbnail_path ? thumbUrl(v.video_id) : v.thumbnail_url;
  const pct   = Math.max(0, Math.min(100, parseFloat(v.progress ?? "0") || 0));
  const dl    = v.downloaded_bytes;
  const tot   = v.total_bytes;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-zinc-900 ring-1 ring-red-500/20 shadow-md shadow-black/30">
      {/* Background progress fill — full-card subtle red */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 bg-red-500/8 transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />

      <div className="relative flex items-stretch gap-4 p-3 sm:p-4">
        <Link
          to={`/watch/${v.video_id}`}
          className="relative aspect-video w-28 sm:w-40 flex-shrink-0 overflow-hidden rounded-xl bg-zinc-800"
        >
          {thumb && <img src={thumb} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
          {v.duration ? (
            <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {formatDuration(v.duration)}
            </span>
          ) : null}
        </Link>

        <div className="min-w-0 flex-1 flex flex-col">
          <div className="flex items-start gap-2">
            <Link to={`/watch/${v.video_id}`} className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm sm:text-base font-medium text-zinc-100" title={v.title}>
                {v.title}
              </p>
            </Link>
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: "Cancel download?",
                  body: <>«<span className="text-zinc-200">{v.title}</span>» вернётся в pending только если канал заберёт обратно.</>,
                  confirmLabel: "Cancel download",
                  destructive: true,
                });
                if (ok) cancel.mutate();
              }}
              className="flex-shrink-0 rounded-full p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              title="Cancel"
              aria-label="Cancel download"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {v.channel_name && (
            <Link
              to={`/channel/${v.channel_id}`}
              className="mt-0.5 block max-w-full truncate text-xs text-zinc-400 hover:text-zinc-200"
              title={v.channel_name}
            >
              {v.channel_name}
            </Link>
          )}

          {/* Stats row + progress */}
          <div className="mt-auto pt-2">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 font-bold tabular-nums text-red-300">
                <Loader2 className="h-3 w-3 animate-spin" />
                {pct.toFixed(1)}%
              </span>
              <span className="text-zinc-500 tabular-nums">
                {dl != null && tot != null && tot > 0 && (
                  <>{formatBytes(dl, true)} / {formatBytes(tot, true)}</>
                )}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-gradient-to-r from-red-500 to-red-400 transition-[width] duration-200"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400 tabular-nums">
              {v.speed && (
                <span className="flex items-center gap-1">
                  <Gauge className="h-3 w-3" />{v.speed}
                </span>
              )}
              {v.eta && <span>ETA {v.eta}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompactRow({ v }: { v: Video }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const cancel = useMutation({
    mutationFn: () => videosApi.delete(v.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
    },
  });

  const thumb = v.thumbnail_path ? thumbUrl(v.video_id) : v.thumbnail_url;
  const statusLabel =
    v.status === "queued" ? "Queued" : "Pending";

  return (
    <div className="group flex items-center gap-3 px-3 py-2 border-b border-white/5 last:border-0 hover:bg-zinc-800/40">
      <Link to={`/watch/${v.video_id}`}
            className="relative aspect-video w-16 flex-shrink-0 overflow-hidden rounded-md bg-zinc-800">
        {thumb && <img src={thumb} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/watch/${v.video_id}`} className="block">
          <p className="truncate text-sm font-medium text-zinc-100" title={v.title}>{v.title}</p>
        </Link>
        <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-amber-300/90">
          <Clock className="h-3 w-3" />
          {statusLabel}
          {v.channel_name && (
            <>
              <span className="text-zinc-600">·</span>
              <span className="truncate text-zinc-500">{v.channel_name}</span>
            </>
          )}
        </p>
      </div>
      <button
        onClick={async () => {
          const ok = await confirm({
            title: "Remove from queue?",
            body: <>«<span className="text-zinc-200">{v.title}</span>» исчезнет из очереди.</>,
            confirmLabel: "Remove",
            destructive: true,
          });
          if (ok) cancel.mutate();
        }}
        className="flex-shrink-0 rounded-full p-2 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Remove from queue"
        title="Remove"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function FailedCard({ v }: { v: Video }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const retry = useMutation({
    mutationFn: () => queueApi.retry(v.video_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
    },
  });
  const cancel = useMutation({
    mutationFn: () => videosApi.delete(v.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
    },
  });

  const thumb = v.thumbnail_path ? thumbUrl(v.video_id) : v.thumbnail_url;
  return (
    <div className="flex items-start gap-3 rounded-xl bg-red-500/5 ring-1 ring-red-500/20 p-3">
      <Link to={`/watch/${v.video_id}`}
            className="relative aspect-video w-20 sm:w-28 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-800 opacity-80">
        {thumb && <img src={thumb} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/watch/${v.video_id}`} className="block">
          <p className="line-clamp-2 text-sm font-medium text-zinc-100" title={v.title}>{v.title}</p>
        </Link>
        {v.channel_name && (
          <p className="mt-0.5 truncate text-xs text-zinc-400">{v.channel_name}</p>
        )}
        <p className="mt-1 flex items-start gap-1.5 text-[11px] text-red-300">
          <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
          <span className="line-clamp-2">{v.error_message ? v.error_message.slice(0, 200) : "Failed"}</span>
        </p>
      </div>
      <div className="flex flex-shrink-0 flex-col gap-1.5">
        <button
          onClick={() => retry.mutate()}
          disabled={retry.isPending}
          className="rounded-full bg-red-500/15 ring-1 ring-red-500/30 p-2 text-red-200 hover:bg-red-500/25 disabled:opacity-50"
          title="Retry"
          aria-label="Retry"
        >
          <RefreshCw className={`h-4 w-4 ${retry.isPending ? "animate-spin" : ""}`} />
        </button>
        <button
          onClick={async () => {
            const ok = await confirm({
              title: "Remove from queue?",
              body: <>«<span className="text-zinc-200">{v.title}</span>» удалится из очереди.</>,
              confirmLabel: "Remove",
              destructive: true,
            });
            if (ok) cancel.mutate();
          }}
          className="rounded-full bg-zinc-800 p-2 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
          title="Remove"
          aria-label="Remove"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-zinc-800/70 ring-1 ring-zinc-700">
        <Inbox className="h-7 w-7 text-zinc-500" />
      </div>
      <h3 className="mt-5 text-lg font-semibold text-zinc-100">Queue is empty</h3>
      <p className="mt-2 max-w-md text-sm text-zinc-400 leading-relaxed">
        Новые видео из подписок появятся здесь в момент обработки.
        Можно вручную добавить ссылку через <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-200">+ Add → Single video</span> в шапке.
      </p>
    </div>
  );
}
