import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Tv, FileVideo, Music, HardDrive, History as HistoryIcon } from "lucide-react";
import { statsApi, musicApi, storageApi, historyApi, type ChannelStorage } from "../lib/api";
import { formatBytes, formatCount } from "../lib/format";

export function InsightsPage() {
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: statsApi.get });
  const { data: music } = useQuery({ queryKey: ["music", "stats"], queryFn: musicApi.stats });
  const { data: channels = [] } = useQuery({ queryKey: ["storage", "largest-channels"], queryFn: () => storageApi.largestChannels(8) });
  const { data: growth } = useQuery({ queryKey: ["storage", "growth", 12], queryFn: () => storageApi.growth(12) });
  const { data: resolutions } = useQuery({ queryKey: ["storage", "resolutions"], queryFn: storageApi.resolutions });
  const { data: continueW = [] } = useQuery({ queryKey: ["history", "continue"], queryFn: () => historyApi.continueWatching(20) });

  return (
    <div className="space-y-8">
      <header className="flex items-center gap-3.5">
        <span className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent to-accent-strong text-accent-ink shadow-lg shadow-accent/25">
          <BarChart3 className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Insights</h1>
          <p className="text-sm text-zinc-400">Your archive at a glance</p>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Kpi icon={FileVideo} label="Videos"   value={stats ? formatCount(stats.videos) : "—"} primary />
        <Kpi icon={HardDrive} label="On disk"   value={stats ? formatBytes(stats.total_bytes) : "—"} />
        <Kpi icon={Tv}        label="Channels"  value={stats ? String(stats.channels) : "—"} />
        <Kpi icon={Music}     label="Music"     value={music ? formatCount(music.tracks) : "—"} />
      </div>

      {/* Continue watching */}
      {continueW.length > 0 && (
        <Link to="/history" className="flex items-center gap-3 rounded-2xl bg-zinc-900 p-4 shadow-md shadow-black/25 hover:bg-zinc-800/70">
          <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
            <HistoryIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-zinc-100">{continueW.length} in progress</p>
            <p className="text-xs text-zinc-500">Pick up where you left off</p>
          </div>
          <span className="text-sm text-accent">Open →</span>
        </Link>
      )}

      {/* Downloads per week */}
      <section>
        <SectionTitle icon={BarChart3} title="Downloads — last 12 weeks" />
        <div className="rounded-2xl bg-zinc-900 p-4 shadow-md shadow-black/25">
          <GrowthBars weeks={growth?.weeks ?? []} />
        </div>
      </section>

      {/* Top channels */}
      {channels.length > 0 && (
        <section>
          <SectionTitle icon={Tv} title="Top channels" />
          <div className="overflow-hidden rounded-2xl shadow-md shadow-black/25">
            {channels.map((c, i) => (
              <ChannelRow key={c.id} c={c} rank={i + 1} max={channels[0]?.total_bytes ?? 1} />
            ))}
          </div>
        </section>
      )}

      {/* Resolution mix */}
      {resolutions && resolutions.buckets.length > 0 && (
        <section>
          <SectionTitle icon={FileVideo} title="By resolution" />
          <div className="rounded-2xl bg-zinc-900 p-4 shadow-md shadow-black/25 space-y-2">
            {(() => {
              const total = resolutions.buckets.reduce((s, b) => s + b.bytes, 0) || 1;
              return resolutions.buckets.map((b) => {
                const pct = (b.bytes / total) * 100;
                return (
                  <div key={b.bucket}>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-medium text-zinc-200 tabular-nums">{b.bucket}</span>
                      <span className="text-zinc-500 tabular-nums">{b.videos} · {formatBytes(b.bytes)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full bg-accent" style={{ width: `${pct.toFixed(1)}%` }} />
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </section>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, primary }: { icon: typeof Tv; label: string; value: string; primary?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 sm:p-5 shadow-md shadow-black/25 ${primary ? "bg-gradient-to-br from-accent/15 to-accent/[0.04] ring-1 ring-accent/20" : "bg-zinc-900"}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-zinc-400">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${primary ? "text-accent" : "text-zinc-100"}`}>{value}</div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: typeof Tv; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-accent/12 text-accent">
        <Icon className="h-4 w-4" />
      </span>
      <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
    </div>
  );
}

function GrowthBars({ weeks }: { weeks: { week_start: string; bytes: number; videos: number }[] }) {
  // Normalize to the last 12 ISO-Mondays so empty weeks render as zero bars.
  const map = new Map(weeks.map((w) => [w.week_start, w]));
  const out: { week_start: string; bytes: number; videos: number }[] = [];
  const now = new Date();
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  for (let i = 11; i >= 0; i--) {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const key = d.toISOString().slice(0, 10);
    out.push(map.get(key) ?? { week_start: key, bytes: 0, videos: 0 });
  }
  const max = Math.max(1, ...out.map((w) => w.bytes));
  return (
    <>
      <div className="flex h-32 items-end gap-1.5">
        {out.map((w) => (
          <div
            key={w.week_start}
            className="flex flex-1 flex-col items-stretch justify-end"
            title={`${w.week_start}: ${formatBytes(w.bytes)} · ${w.videos} videos`}
          >
            <div className="rounded-t bg-gradient-to-t from-accent-strong to-accent" style={{ height: `max(2px, ${(w.bytes / max) * 100}%)` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] tabular-nums text-zinc-500">
        <span>{out[0]?.week_start.slice(5)}</span>
        <span>{out[out.length - 1]?.week_start.slice(5)}</span>
      </div>
    </>
  );
}

function ChannelRow({ c, rank, max }: { c: ChannelStorage; rank: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (c.total_bytes / max) * 100) : 0;
  return (
    <Link to={`/channel/${c.id}`} className="flex items-center gap-3 border-b border-white/5 bg-zinc-900 px-3 py-2.5 last:border-b-0 hover:bg-zinc-800/70">
      <span className="w-5 flex-shrink-0 text-right text-xs font-mono tabular-nums text-zinc-500">{rank}</span>
      {c.thumbnail_url ? (
        <img src={c.thumbnail_url} referrerPolicy="no-referrer" className="h-8 w-8 flex-shrink-0 rounded-full object-cover bg-zinc-800" alt="" />
      ) : (
        <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-zinc-800"><Tv className="h-4 w-4 text-zinc-500" /></div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-zinc-100">{c.name}</p>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="flex-shrink-0 text-right text-sm tabular-nums">
        <div className="font-semibold text-zinc-100">{formatBytes(c.total_bytes)}</div>
        <div className="text-[11px] text-zinc-500">{c.video_count} videos</div>
      </div>
    </Link>
  );
}
