import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Film, CheckCircle2, Clock, AlertTriangle, RotateCcw, Play,
  Loader2, RefreshCw, Ban,
} from "lucide-react";
import { previewsApi, type PreviewFailure } from "../lib/api";
import { formatDuration, timeAgo } from "../lib/format";

export function PreviewsPage() {
  const qc = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ["previews", "status"],
    queryFn: previewsApi.status,
    // Poll fast enough that the "now generating" percent moves smoothly.
    refetchInterval: 2_000,
  });
  const { data: failures = [] } = useQuery({
    queryKey: ["previews", "failed"],
    queryFn: () => previewsApi.failed(200),
    refetchInterval: 10_000,
  });

  const runNow = useMutation({
    mutationFn: () => previewsApi.runNow(20),
    onSuccess: () => {
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["previews"] });
      }, 1200);
    },
  });

  const eligible = status ? status.done + status.pending + status.failed : 0;
  const donePct = eligible > 0 ? Math.round(((status?.done ?? 0) / eligible) * 100) : 0;

  return (
    <div className="max-w-5xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-sky-500/15 ring-1 ring-sky-400/30">
            <Film className="h-5 w-5 text-sky-300" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Превью</h1>
            <p className="mt-0.5 text-sm text-zinc-400">
              Мини-ролики, которые проигрываются при наведении на карточку. Генерируются
              в фоне каждые 15 минут.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => runNow.mutate()}
          disabled={runNow.isPending || (status?.pending ?? 0) === 0}
          className="inline-flex items-center gap-2 rounded-full bg-sky-500/90 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
          title={(status?.pending ?? 0) === 0 ? "Нечего генерировать" : "Сгенерировать партию прямо сейчас"}
        >
          {runNow.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
          Сгенерировать сейчас
        </button>
      </header>

      {isLoading || !status ? (
        <p className="text-sm text-zinc-400">Загрузка…</p>
      ) : (
        <>
          {/* Progress bar over the eligible set. */}
          <div className="mb-5 overflow-hidden rounded-2xl bg-zinc-900 p-4 sm:p-5">
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="font-medium text-zinc-100">Готово {donePct}%</span>
              <span className="text-xs text-zinc-500 tabular-nums">
                {status.done} / {eligible} подходящих
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-[width] duration-500"
                style={{ width: `${donePct}%` }}
              />
            </div>
          </div>

          {/* Now generating — which clip + live percent (seek-based build, so
              the percent is honest). */}
          {status.current && (
            <div className="mb-5 overflow-hidden rounded-2xl bg-sky-500/10 p-4 ring-1 ring-sky-500/25 sm:p-5">
              <div className="mb-2 flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-sky-300" />
                <span className="font-medium text-sky-100">Сейчас генерируется превью</span>
                {status.current.percent > 0 && (
                  <span className="ml-auto text-xs tabular-nums text-sky-300">{status.current.percent}%</span>
                )}
              </div>
              <Link
                to={`/watch/${status.current.video_id}`}
                className="line-clamp-1 text-sm text-zinc-100 hover:text-white"
                title={status.current.title}
              >
                {status.current.title}
              </Link>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                {status.current.percent > 0 ? (
                  <div
                    className="h-full rounded-full bg-sky-400 transition-[width] duration-700"
                    style={{ width: `${status.current.percent}%` }}
                  />
                ) : (
                  <div className="h-full w-full rounded-full bg-gradient-to-r from-sky-500/40 via-sky-400 to-sky-500/40 animate-pulse" />
                )}
              </div>
            </div>
          )}

          {/* Buckets. */}
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={CheckCircle2} tone="emerald" label="Готово" value={status.done} />
            <StatCard icon={Clock} tone="amber" label="В очереди" value={status.pending} />
            <StatCard icon={AlertTriangle} tone="red" label="Ошибки" value={status.failed} />
            <StatCard icon={Ban} tone="zinc" label={`Короткие (<${status.min_duration}с)`} value={status.ineligible} />
          </div>

          {/* Failures list. */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              Не удалось сгенерировать
              <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-red-300">
                {failures.length}
              </span>
            </h2>
            {failures.length === 0 ? (
              <div className="rounded-2xl bg-zinc-900 px-4 py-8 text-center text-sm text-zinc-500">
                Ошибок нет — все подходящие видео либо уже с превью, либо в очереди.
              </div>
            ) : (
              <ul className="divide-y divide-zinc-800 overflow-hidden rounded-2xl bg-zinc-900">
                {failures.map((f) => (
                  <FailureRow key={f.video_id} failure={f} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon, label, value, tone,
}: {
  icon: typeof Film;
  label: string;
  value: number;
  tone: "emerald" | "amber" | "red" | "zinc";
}) {
  const tones: Record<string, string> = {
    emerald: "bg-emerald-500/15 text-emerald-300",
    amber:   "bg-amber-500/15 text-amber-300",
    red:     "bg-red-500/15 text-red-300",
    zinc:    "bg-zinc-700/30 text-zinc-400",
  };
  return (
    <div className="rounded-2xl bg-zinc-900 p-4">
      <span className={`mb-2 grid h-8 w-8 place-items-center rounded-lg ${tones[tone]}`}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="text-2xl font-semibold tabular-nums text-zinc-100">{value}</p>
      <p className="mt-0.5 text-xs text-zinc-500">{label}</p>
    </div>
  );
}

function FailureRow({ failure: f }: { failure: PreviewFailure }) {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: () => previewsApi.retry(f.video_id),
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries({ queryKey: ["previews"] }), 1500);
    },
  });
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <Link
          to={`/watch/${f.video_id}`}
          className="line-clamp-1 text-sm font-medium text-zinc-100 hover:text-white"
          title={f.title}
        >
          {f.title}
        </Link>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {f.channel_name ?? "—"}
          {f.duration != null && <> · {formatDuration(f.duration)}</>}
          {f.downloaded_at && <> · {timeAgo(f.downloaded_at)}</>}
          {" · "}
          <span className="text-zinc-600">{f.preview_attempts} попыток</span>
        </p>
        {f.preview_error && (
          <p className="mt-1 line-clamp-2 rounded-md bg-red-500/8 px-2 py-1 font-mono text-[11px] leading-snug text-red-300/90">
            {f.preview_error}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => retry.mutate()}
        disabled={retry.isPending || retry.isSuccess}
        className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
      >
        {retry.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : retry.isSuccess ? <RefreshCw className="h-3.5 w-3.5" />
          : <RotateCcw className="h-3.5 w-3.5" />}
        {retry.isSuccess ? "В очереди" : "Повторить"}
      </button>
    </li>
  );
}
