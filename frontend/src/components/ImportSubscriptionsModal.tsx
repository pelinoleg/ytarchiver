import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X, Loader2, Check, Tv, AlertTriangle, Download, CheckCircle2,
} from "lucide-react";
import {
  ytImportApi, channelsApi,
  type YtSubscription, type Quality, type DownloadPolicy,
} from "../lib/api";
import { formatCount } from "../lib/format";

const QUALITIES: Quality[] = ["best", "1080", "720", "480", "360"];
const POLICIES: { value: DownloadPolicy; label: string }[] = [
  { value: "new-only", label: "Только новые" },
  { value: "last-30",  label: "30 дней" },
  { value: "last-90",  label: "90 дней" },
  { value: "all",      label: "Всё" },
];

type RowCfg = { quality: Quality; policy: DownloadPolicy };
type AddState = "pending" | "done" | "error";

export function ImportSubscriptionsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["yt-import", "subscriptions"],
    queryFn: ytImportApi.subscriptions,
    retry: false,
  });

  const subs = data?.subscriptions ?? [];

  const [globalQ, setGlobalQ] = useState<Quality>("1080");
  const [globalP, setGlobalP] = useState<DownloadPolicy>("new-only");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cfg, setCfg] = useState<Record<string, RowCfg>>({});
  const [addState, setAddState] = useState<Record<string, AddState>>({});
  const [running, setRunning] = useState(false);

  const importable = useMemo(() => subs.filter((s) => !s.already_added), [subs]);

  function toggle(url: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(url)) next.delete(url);
      else {
        next.add(url);
        setCfg((c) => (c[url] ? c : { ...c, [url]: { quality: globalQ, policy: globalP } }));
      }
      return next;
    });
  }

  function selectAll(on: boolean) {
    if (!on) { setSelected(new Set()); return; }
    const next = new Set<string>();
    const c: Record<string, RowCfg> = { ...cfg };
    for (const s of importable) {
      next.add(s.url);
      if (!c[s.url]) c[s.url] = { quality: globalQ, policy: globalP };
    }
    setSelected(next);
    setCfg(c);
  }

  // Top "apply to all selected" — updates the default AND every selected row.
  function applyGlobalQuality(q: Quality) {
    setGlobalQ(q);
    setCfg((c) => {
      const n = { ...c };
      for (const url of selected) n[url] = { ...(n[url] ?? { quality: q, policy: globalP }), quality: q };
      return n;
    });
  }
  function applyGlobalPolicy(p: DownloadPolicy) {
    setGlobalP(p);
    setCfg((c) => {
      const n = { ...c };
      for (const url of selected) n[url] = { ...(n[url] ?? { quality: globalQ, policy: p }), policy: p };
      return n;
    });
  }

  async function runImport() {
    setRunning(true);
    const urls = [...selected].filter((u) => addState[u] !== "done");
    for (const url of urls) {
      setAddState((s) => ({ ...s, [url]: "pending" }));
      const c = cfg[url] ?? { quality: globalQ, policy: globalP };
      try {
        await channelsApi.subscribe({ url, download_policy: c.policy, quality: c.quality });
        setAddState((s) => ({ ...s, [url]: "done" }));
      } catch {
        setAddState((s) => ({ ...s, [url]: "error" }));
      }
    }
    qc.invalidateQueries({ queryKey: ["channels"] });
    setRunning(false);
  }

  const selectedCount = [...selected].filter((u) => addState[u] !== "done").length;
  const notAuth = (error as Error | null)?.message?.includes("409");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-zinc-900 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-white/5 px-5 py-4">
          <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-red-600/15 text-red-300">
            <Download className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">Импорт подписок с YouTube</h2>
            <p className="truncate text-xs text-zinc-500">
              {data ? `${importable.length} новых · ${subs.length - importable.length} уже добавлено` : "Список твоих подписок"}
            </p>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Controls */}
        {data && importable.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-white/5 bg-zinc-950/40 px-5 py-3 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={selectedCount > 0 && selectedCount === importable.length}
                onChange={(e) => selectAll(e.target.checked)}
                className="h-4 w-4 accent-red-500"
              />
              Выбрать все
            </label>
            <span className="text-zinc-600">·</span>
            <label className="flex items-center gap-1.5 text-zinc-400">
              Качество
              <select value={globalQ} onChange={(e) => applyGlobalQuality(e.target.value as Quality)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-zinc-200">
                {QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-zinc-400">
              Качать
              <select value={globalP} onChange={(e) => applyGlobalPolicy(e.target.value as DownloadPolicy)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-1 text-zinc-200">
                {POLICIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {isLoading || isFetching ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаю подписки…
            </div>
          ) : error ? (
            <div className="px-4 py-12 text-center">
              <AlertTriangle className="mx-auto h-8 w-8 text-amber-400" />
              <p className="mx-auto mt-3 max-w-sm text-sm text-zinc-300">
                {notAuth
                  ? "Cookies не авторизуют аккаунт. Нужен экспорт куки залогиненного YouTube (с first-party login-куки). Переэкспортируй через приватное окно и сохрани заново в настройках."
                  : (error as Error).message}
              </p>
              <button onClick={() => refetch()} className="mt-4 rounded-full bg-zinc-800 px-4 py-1.5 text-sm hover:bg-zinc-700">
                Повторить
              </button>
            </div>
          ) : subs.length === 0 ? (
            <p className="py-16 text-center text-sm text-zinc-500">Подписок не найдено.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {subs.map((s) => (
                <SubRow
                  key={s.url}
                  sub={s}
                  checked={selected.has(s.url)}
                  cfg={cfg[s.url] ?? { quality: globalQ, policy: globalP }}
                  state={addState[s.url]}
                  onToggle={() => toggle(s.url)}
                  onCfg={(c) => setCfg((m) => ({ ...m, [s.url]: c }))}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-white/5 px-5 py-3">
          <span className="text-xs text-zinc-500">{selectedCount > 0 ? `Выбрано: ${selectedCount}` : "Ничего не выбрано"}</span>
          <button
            onClick={runImport}
            disabled={selectedCount === 0 || running}
            className="inline-flex items-center gap-2 rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Добавить выбранные{selectedCount > 0 ? ` (${selectedCount})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

function SubRow({
  sub, checked, cfg, state, onToggle, onCfg,
}: {
  sub: YtSubscription;
  checked: boolean;
  cfg: RowCfg;
  state?: AddState;
  onToggle: () => void;
  onCfg: (c: RowCfg) => void;
}) {
  const added = sub.already_added || state === "done";
  return (
    <li className={`flex items-center gap-3 px-3 py-2 ${added ? "opacity-45" : ""}`}>
      {added ? (
        <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-400" />
      ) : (
        <input type="checkbox" checked={checked} onChange={onToggle} className="h-4 w-4 flex-shrink-0 accent-red-500" />
      )}
      {sub.thumbnail_url ? (
        <img src={sub.thumbnail_url} referrerPolicy="no-referrer" alt="" className="h-9 w-9 flex-shrink-0 rounded-full object-cover bg-zinc-800" />
      ) : (
        <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-zinc-800"><Tv className="h-4 w-4 text-zinc-500" /></span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-zinc-100" title={sub.name}>{sub.name}</p>
        <p className="truncate text-[11px] text-zinc-500">
          {sub.subscriber_count != null ? `${formatCount(sub.subscriber_count)} подписчиков` : ""}
          {added && <span className="ml-1 text-emerald-400/80">· добавлено</span>}
          {state === "error" && <span className="ml-1 text-red-400">· ошибка</span>}
        </p>
      </div>
      {/* Per-row quality + policy, only when selected and not already added. */}
      {checked && !added && (
        <div className="flex flex-shrink-0 items-center gap-1">
          <select value={cfg.quality} onChange={(e) => onCfg({ ...cfg, quality: e.target.value as Quality })}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-1 py-1 text-[11px] text-zinc-200">
            {QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
          <select value={cfg.policy} onChange={(e) => onCfg({ ...cfg, policy: e.target.value as DownloadPolicy })}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-1 py-1 text-[11px] text-zinc-200">
            {POLICIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      )}
      {state === "pending" && <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-zinc-400" />}
      {state === "done" && <Check className="h-4 w-4 flex-shrink-0 text-emerald-400" />}
    </li>
  );
}
