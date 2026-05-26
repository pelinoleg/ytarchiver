import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  HardDrive, AlertTriangle, Clock, Trash2, Tv, FileVideo, ShieldCheck, Loader2,
} from "lucide-react";
import { storageApi, maintenanceApi, thumbUrl, type ChannelStorage, type Video } from "../lib/api";
import { formatBytes, formatDuration, timeAgo } from "../lib/format";
import { useState } from "react";
import { VideoCardMenu } from "../components/VideoCardMenu";
import { useConfirm } from "../components/ConfirmProvider";

export function StoragePage() {
  const { data: summary }           = useQuery({ queryKey: ["storage", "summary"],          queryFn: storageApi.summary });
  const { data: biggest = [] }      = useQuery({ queryKey: ["storage", "largest-videos"],   queryFn: () => storageApi.largestVideos(30) });
  const { data: channels = [] }     = useQuery({ queryKey: ["storage", "largest-channels"], queryFn: () => storageApi.largestChannels(15) });
  const [minDays, setMinDays] = useState(30);
  const { data: oldWatched = [] }   = useQuery({
    queryKey: ["storage", "old-watched", minDays],
    queryFn: () => storageApi.oldWatched(minDays, 50),
  });

  return (
    <div className="space-y-10">
      {/* Hero */}
      <header className="overflow-hidden rounded-2xl bg-gradient-to-br from-sky-600/20 via-zinc-900 to-zinc-900 p-6 sm:p-8 ring-1 ring-sky-500/20">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-300">
          <HardDrive className="h-4 w-4" />
          Storage
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Disk usage</h1>
        {summary && (
          <dl className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-5">
            <Metric label="Total"   value={formatBytes(summary.total_bytes)} accent="text-sky-300" />
            <Metric label="Videos"  value={summary.videos.toLocaleString()} />
            <Metric label="Average" value={formatBytes(summary.avg_bytes, true)} />
            <Metric label="Biggest" value={formatBytes(summary.max_bytes, true)} />
          </dl>
        )}
      </header>

      {/* Integrity check */}
      <IntegritySection />

      {/* Analytics — growth + resolution breakdown */}
      <AnalyticsSection />

      {/* Non-H.264 bulk re-download CTA — only renders when there are
       *  candidates worth surfacing (so the panel disappears once the
       *  library is clean). */}
      <NonH264Section />

      {/* Orphan videos — leftovers from unsubscribed playlists that
       *  pre-date the auto-cleanup. Disappears once the library is clean. */}
      <OrphansSection />

      {/* Biggest channels */}
      <section>
        <SectionHeader icon={Tv} title="Biggest channels" hint="Sorted by total bytes on disk." />
        {channels.length === 0 ? (
          <p className="text-sm text-zinc-500">No data yet — download some videos first.</p>
        ) : (
          <div className="overflow-hidden rounded-xl ring-1 ring-zinc-800">
            {channels.map((c, i) => <ChannelRow key={c.id} c={c} rank={i + 1} totalBytes={summary?.total_bytes ?? 0} />)}
          </div>
        )}
      </section>

      {/* Biggest videos */}
      <section>
        <SectionHeader icon={FileVideo} title="Biggest videos" hint="Top 30 by file size. Delete from the 3-dot menu." />
        {biggest.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing here yet.</p>
        ) : (
          <div className="space-y-2">
            {biggest.map((v, i) => <BigVideoRow key={v.id} v={v} rank={i + 1} />)}
          </div>
        )}
      </section>

      {/* Old watched */}
      <section>
        <div className="mb-3 flex items-end justify-between gap-3 flex-wrap">
          <SectionHeader
            icon={Clock}
            title="Watched a while ago"
            hint={`Done watching — natural cleanup candidates. Excludes pinned, favorites, music.`}
            inline
          />
          <label className="text-xs text-zinc-400">
            Older than{" "}
            <select
              value={minDays}
              onChange={(e) => setMinDays(Number(e.target.value))}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm focus:border-zinc-600"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
              <option value={180}>6 months</option>
              <option value={365}>1 year</option>
            </select>
          </label>
        </div>
        {oldWatched.length === 0 ? (
          <p className="rounded-xl bg-zinc-900 px-4 py-6 text-center text-sm text-zinc-500">
            Nothing matches — your library is tidy.
          </p>
        ) : (
          <div className="space-y-2">
            {oldWatched.map((v) => <OldRow key={v.id} v={v} />)}
          </div>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums ${accent ?? "text-zinc-100"}`}>{value}</dd>
    </div>
  );
}

function SectionHeader({
  icon: Icon, title, hint, inline,
}: { icon: typeof HardDrive; title: string; hint?: string; inline?: boolean }) {
  return (
    <div className={inline ? "" : "mb-4"}>
      <div className="flex items-center gap-2.5">
        <Icon className="h-5 w-5 text-zinc-500" />
        <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
      </div>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

function ChannelRow({
  c, rank, totalBytes,
}: { c: ChannelStorage; rank: number; totalBytes: number }) {
  const pct = totalBytes > 0 ? Math.min(100, (c.total_bytes / totalBytes) * 100) : 0;
  return (
    <Link
      to={`/channel/${c.id}`}
      className="group relative flex items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-3 py-2.5 last:border-b-0 hover:bg-zinc-800/70"
    >
      <span className="w-6 flex-shrink-0 text-right text-xs font-mono tabular-nums text-zinc-500">{rank}</span>
      {c.thumbnail_url ? (
        <img src={c.thumbnail_url} referrerPolicy="no-referrer" className="h-8 w-8 flex-shrink-0 rounded-full object-cover bg-zinc-800" alt="" />
      ) : (
        <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-zinc-800">
          <Tv className="h-4 w-4 text-zinc-500" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-100">{c.name}</p>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full bg-sky-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="flex-shrink-0 text-right text-sm tabular-nums">
        <div className="font-semibold text-zinc-100">{formatBytes(c.total_bytes)}</div>
        <div className="text-[11px] text-zinc-500">{c.video_count} videos</div>
      </div>
    </Link>
  );
}

function BigVideoRow({ v, rank }: { v: Video; rank: number }) {
  const thumb = v.thumbnail_path ? thumbUrl(v.video_id) : v.thumbnail_url;
  return (
    <div className="group relative">
      <Link
        to={`/watch/${v.video_id}`}
        className="flex items-center gap-3 rounded-xl bg-zinc-900 p-3 hover:bg-zinc-800/70"
      >
        <span className="w-6 flex-shrink-0 text-right text-xs font-mono tabular-nums text-zinc-500">{rank}</span>
        <div className="relative aspect-video w-28 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-800">
          {thumb && <img src={thumb} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-full w-full object-cover" />}
          {v.duration && (
            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 py-0.5 text-[10px] font-medium text-zinc-100">
              {formatDuration(v.duration)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium text-zinc-100">{v.title}</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {v.channel_name}
            {v.quality ? ` · ${v.quality}p` : ""}
            {v.downloaded_at ? ` · downloaded ${timeAgo(v.downloaded_at)}` : ""}
          </p>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="rounded bg-sky-500/15 px-2 py-1 text-sm font-bold tabular-nums text-sky-300">
            {formatBytes(v.file_size_bytes ?? 0, true)}
          </div>
        </div>
      </Link>
      <VideoCardMenu video={v} />
    </div>
  );
}

function OldRow({ v }: { v: Video }) {
  const thumb = v.thumbnail_path ? thumbUrl(v.video_id) : v.thumbnail_url;
  return (
    <div className="group relative">
      <Link
        to={`/watch/${v.video_id}`}
        className="flex items-center gap-3 rounded-xl bg-zinc-900 p-3 hover:bg-zinc-800/70"
      >
        <div className="relative aspect-video w-24 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-800">
          {thumb && <img src={thumb} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium text-zinc-100">{v.title}</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {v.channel_name}
            {v.last_watched_at ? ` · watched ${timeAgo(v.last_watched_at)}` : ""}
            {v.file_size_bytes ? ` · ${formatBytes(v.file_size_bytes, true)}` : ""}
          </p>
        </div>
        <Trash2 className="h-4 w-4 flex-shrink-0 text-zinc-600" />
      </Link>
      <VideoCardMenu video={v} />
    </div>
  );
}

function IntegritySection() {
  const qc = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ["maintenance", "integrity"],
    queryFn: maintenanceApi.integrityStatus,
  });

  const run = useMutation({
    mutationFn: maintenanceApi.runIntegrity,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["maintenance", "integrity"] });
      qc.invalidateQueries({ queryKey: ["storage"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
    },
  });

  const lastReport = run.data ?? null;

  return (
    <section className="rounded-2xl bg-zinc-900 p-4 sm:p-5 ring-1 ring-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            Disk integrity
          </h2>
          <p className="mt-1 text-xs text-zinc-500 max-w-lg">
            Сверяет каждое скачанное видео с тем, что реально лежит на диске.
            Пропавшие файлы помечаются как deleted — на следующем sync канал перекачает их заново.
          </p>
          {status?.ran_at && (
            <p className="mt-2 text-xs text-zinc-400">
              Last check {timeAgo(status.ran_at)} ·{" "}
              <span className="text-zinc-300 tabular-nums">{status.checked}</span> checked ·{" "}
              <span className={`tabular-nums ${status.missing > 0 ? "text-amber-300 font-medium" : "text-emerald-400"}`}>
                {status.missing} missing
              </span>
            </p>
          )}
        </div>
        <button
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="flex items-center gap-2 rounded-full bg-zinc-800 px-4 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
        >
          {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Run check
        </button>
      </div>

      {lastReport && lastReport.missing > 0 && (
        <div className="mt-4 rounded-xl bg-amber-500/10 ring-1 ring-amber-500/30 p-3 text-xs">
          <div className="mb-2 flex items-center gap-1.5 font-medium text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            {lastReport.missing} file{lastReport.missing === 1 ? "" : "s"} missing on disk
          </div>
          <ul className="space-y-1 text-zinc-300">
            {lastReport.missing_sample.map((m) => (
              <li key={m.video_id} className="truncate">
                · {m.title} <span className="text-zinc-500">— {m.path}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// Silence "unused import" if AlertTriangle gets dropped later.
export const _kept = AlertTriangle;

// ─────────────────────────────────────────────────────────────────────────────
// Analytics — weekly growth bars + resolution breakdown donut-ish bars.

function AnalyticsSection() {
  const { data: growth } = useQuery({
    queryKey: ["storage", "growth", 12],
    queryFn: () => storageApi.growth(12),
  });
  const { data: resBreakdown } = useQuery({
    queryKey: ["storage", "resolutions"],
    queryFn: storageApi.resolutions,
  });
  const { data: cleanup } = useQuery({
    queryKey: ["storage", "cleanup-stats", 30],
    queryFn: () => storageApi.cleanupStats(30),
  });

  // Normalize the growth dataset to last 12 ISO-Mondays so missing weeks
  // still show as zero bars (visual continuity beats variable-length axes).
  const weeks: { week_start: string; bytes: number; videos: number }[] = (() => {
    if (!growth) return [];
    const map = new Map(growth.weeks.map((w) => [w.week_start, w]));
    const out: typeof growth.weeks = [];
    const now = new Date();
    // Walk back 12 Mondays.
    const monday = new Date(now);
    const dow = monday.getUTCDay();
    monday.setUTCDate(monday.getUTCDate() - ((dow + 6) % 7));   // → Monday
    for (let i = 11; i >= 0; i--) {
      const d = new Date(monday);
      d.setUTCDate(d.getUTCDate() - i * 7);
      const key = d.toISOString().slice(0, 10);
      out.push(map.get(key) ?? { week_start: key, bytes: 0, videos: 0 });
    }
    return out;
  })();
  const maxBytes = Math.max(1, ...weeks.map((w) => w.bytes));

  const totalCleanupCount = cleanup?.by_type.reduce((s, b) => s + b.n, 0) ?? 0;

  return (
    <section>
      <SectionHeader icon={HardDrive} title="Activity & breakdown" />
      <div className="grid gap-4 sm:gap-5 grid-cols-1 lg:grid-cols-2">
        {/* Growth chart */}
        <div className="rounded-xl bg-zinc-900 p-4 ring-1 ring-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-100">Downloaded — last 12 weeks</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Bytes added to disk per ISO-week. Helps you spot a sudden growth spike.
          </p>
          <div className="mt-4 flex items-end gap-1.5 h-32">
            {weeks.map((w) => {
              const h = (w.bytes / maxBytes) * 100;
              return (
                <div
                  key={w.week_start}
                  className="flex-1 flex flex-col items-stretch justify-end"
                  title={`${w.week_start}: ${formatBytes(w.bytes)} · ${w.videos} videos`}
                >
                  <div
                    className="rounded-t bg-gradient-to-t from-sky-600 to-sky-400"
                    style={{ height: `max(2px, ${h}%)` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[10px] tabular-nums text-zinc-500">
            <span>{weeks[0]?.week_start.slice(5) ?? ""}</span>
            <span>{weeks[weeks.length - 1]?.week_start.slice(5) ?? ""}</span>
          </div>
        </div>

        {/* Resolution breakdown */}
        <div className="rounded-xl bg-zinc-900 p-4 ring-1 ring-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-100">By resolution</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Videos &gt; 1080p are served only as VP9 / AV1 — useful to know for
            mobile-compat. Numbers shown by bytes.
          </p>
          <div className="mt-3 space-y-1.5">
            {resBreakdown?.buckets.map((b) => {
              const total = resBreakdown.buckets.reduce((s, x) => s + x.bytes, 0) || 1;
              const pct = (b.bytes / total) * 100;
              const hi = b.bucket === "2160p" || b.bucket === "1440p";
              return (
                <div key={b.bucket}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className={`tabular-nums font-medium ${hi ? "text-amber-300" : "text-zinc-200"}`}>{b.bucket}</span>
                    <span className="text-zinc-500 tabular-nums">
                      {b.videos} · {formatBytes(b.bytes)}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={`h-full ${hi ? "bg-amber-400" : "bg-sky-400"}`}
                      style={{ width: `${pct.toFixed(1)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {!resBreakdown && (
              <p className="text-xs text-zinc-500">Loading…</p>
            )}
          </div>

          {totalCleanupCount > 0 && cleanup && (
            <div className="mt-4 border-t border-zinc-800 pt-3">
              <p className="text-xs font-medium text-zinc-100">
                Auto-cleanup last {cleanup.days}d
              </p>
              <p className="mt-1 text-[11px] text-zinc-500">
                {cleanup.by_type.map((b) => `${b.type.replace("video_deleted_", "")} · ${b.n}`).join(" · ")}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// "Non-H.264 in library" call-to-action — only renders when there are
// actually candidates. Surfaces the bulk redownload action so old AV1 / VP9
// files (which won't play on iOS Safari < 17) can be flipped to H.264 in
// one tap.

function NonH264Section() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data } = useQuery({
    queryKey: ["storage", "non-h264"],
    queryFn: storageApi.nonH264Count,
    refetchInterval: 60_000,
  });
  const mut = useMutation({
    mutationFn: () => storageApi.redownloadNonH264(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["storage"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
    },
  });

  if (!data || data.count === 0) return null;

  return (
    <section className="rounded-2xl bg-gradient-to-br from-amber-600/20 via-zinc-900 to-zinc-900 ring-1 ring-amber-500/30 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            Likely non-H.264 in library
          </h3>
          <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed max-w-2xl">
            <strong className="text-zinc-100 tabular-nums">{data.count}</strong> video{data.count === 1 ? "" : "s"}
            {" "}— <span className="tabular-nums">{formatBytes(data.bytes)}</span> on disk — were saved at &gt;1080p,
            which YouTube only ships in VP9 / AV1. These can fail to play on
            iOS Safari and older browsers. Re-downloading queues them up
            again with the H.264-preferring format and replaces the files
            once each finishes.
          </p>
        </div>
        <button
          onClick={async () => {
            const ok = await confirm({
              title: `Re-download ${data.count} non-H.264 video${data.count === 1 ? "" : "s"}?`,
              body: "Existing files stay until each new download finishes, then get replaced. They'll appear back in the Downloads queue.",
              confirmLabel: "Re-download all",
            });
            if (ok) mut.mutate();
          }}
          disabled={mut.isPending}
          className="inline-flex flex-shrink-0 items-center gap-2 rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-300 disabled:opacity-60"
        >
          {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {mut.isPending ? "Queueing…" : "Re-download all"}
        </button>
      </div>
      {mut.isSuccess && (
        <p className="mt-3 text-xs text-emerald-300">
          Queued {mut.data?.queued} videos. Track progress in Downloads.
        </p>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Orphan videos panel — shows files that lost their playlist / channel link.
// Auto-cleanup on playlist unsubscribe now prevents this from happening, but
// pre-existing orphans (from before the fix) need a way out.

function OrphansSection() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: orphans = [] } = useQuery({
    queryKey: ["storage", "orphans"],
    queryFn: storageApi.orphans,
    refetchInterval: 30_000,
  });
  const mut = useMutation({
    mutationFn: () => storageApi.purgeOrphans(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["storage"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
  });

  if (orphans.length === 0) return null;

  const totalBytes = orphans.reduce((s, v) => s + (v.file_size_bytes ?? 0), 0);
  const pendingCount = orphans.filter((v) => v.status === "pending" || v.status === "queued" || v.status === "downloading").length;
  const doneCount    = orphans.filter((v) => v.status === "done").length;

  return (
    <section className="rounded-2xl bg-gradient-to-br from-amber-600/20 via-zinc-900 to-zinc-900 ring-1 ring-amber-500/30 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            Orphan videos
          </h3>
          <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed max-w-2xl">
            <strong className="text-zinc-100 tabular-nums">{orphans.length}</strong> video{orphans.length === 1 ? "" : "s"}
            {" "}— <span className="tabular-nums">{formatBytes(totalBytes)}</span> on disk — aren't linked to
            any playlist or subscribed channel. Usually leftovers from playlists
            you unsubscribed before the auto-cleanup fix.
            {doneCount > 0    && <> {" · "}<span className="text-zinc-100">{doneCount}</span> downloaded</>}
            {pendingCount > 0 && <> {" · "}<span className="text-zinc-100">{pendingCount}</span> still queued</>}
          </p>
        </div>
        <button
          onClick={async () => {
            const ok = await confirm({
              title: `Удалить ${orphans.length} осиротевших видео?`,
              body: "Файлы с диска сотрутся, DB-записи тоже. Очередь скачивания для них отменится.",
              confirmLabel: "Purge all",
              destructive: true,
            });
            if (ok) mut.mutate();
          }}
          disabled={mut.isPending}
          className="inline-flex flex-shrink-0 items-center gap-2 rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-300 disabled:opacity-60"
        >
          {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {mut.isPending ? "Cleaning…" : "Purge all"}
        </button>
      </div>
      {mut.isSuccess && mut.data && (
        <p className="mt-3 text-xs text-emerald-300">
          Done. Cancelled {mut.data.cancelled} queued · purged {mut.data.purged} downloaded.
        </p>
      )}
    </section>
  );
}
