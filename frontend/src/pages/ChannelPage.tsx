import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, Trash2, Tv, Save, Loader2,
  ChevronDown, ChevronUp, AlertTriangle, ExternalLink,
} from "lucide-react";
import {
  channelsApi, settingsApi, videosApi,
  type Channel, type DownloadPolicy, type GlobalSettings, type Quality,
} from "../lib/api";
import { VideoGrid } from "../components/VideoGrid";
import { RetentionPicker } from "../components/RetentionPicker";
import {
  describePolicy, describeQuality, describeRetention, describeInterval,
  formatCount, nextSyncAt, timeAgo, timeUntil, youtubeChannelUrl,
} from "../lib/format";
import { useLocalStorageBool } from "../hooks/useLocalStorageBool";
import { useConfirm } from "../components/ConfirmProvider";

const POLICY_OPTIONS: { value: DownloadPolicy; label: string }[] = [
  { value: "new-only", label: "Only new uploads" },
  { value: "latest",   label: "Latest N videos" },
  { value: "last-7",   label: "Last 7 days" },
  { value: "last-30",  label: "Last 30 days" },
  { value: "last-90",  label: "Last 90 days" },
  { value: "last-365", label: "Last year" },
  { value: "all",      label: "Everything" },
];

export function ChannelPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const id = Number(channelId);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const nav = useNavigate();
  // Set when the user confirms unsubscribe — flips the page into a friendly
  // "deleted" splash until the mutation lands, instead of leaving the now-
  // orphaned channel UI looking broken.
  const [deleting, setDeleting] = useState(false);

  const { data: channels = [] } = useQuery({
    queryKey: ["channels"],
    queryFn: channelsApi.list,
  });
  const channel = channels.find((c) => c.id === id);

  const { data: globals } = useQuery({
    queryKey: ["settings"],
    queryFn: settingsApi.get,
  });

  const { data: videos = [], isLoading } = useQuery({
    queryKey: ["videos", { channel_id: id }],
    queryFn: () => videosApi.list({ channel_id: id, limit: 120 }),
    enabled: !Number.isNaN(id),
  });

  const syncMut = useMutation({
    mutationFn: () => channelsApi.sync(id),
    onSuccess: () => {
      // Refresh channel meta (last_synced, added_count) AND the video grid.
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["videos", { channel_id: id }] });
      qc.invalidateQueries({ queryKey: ["videos"] });
    },
  });
  const rebuildMut = useMutation({
    mutationFn: () => channelsApi.rebuild(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["videos", { channel_id: id }] });
      qc.invalidateQueries({ queryKey: ["videos"] });
    },
  });
  const unsubMut = useMutation({
    mutationFn: () => channelsApi.unsubscribe(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
      // Replace so the browser Back button doesn't bring the user to a
      // channel page that no longer exists.
      nav("/", { replace: true });
    },
  });

  // Deletion splash — the channel row disappears from the cache the moment
  // we invalidate ``["channels"]`` on success, so we render this until the
  // navigation completes (which is the next tick) to avoid the jarring
  // "Channel not found." flash.
  if (deleting || unsubMut.isPending || unsubMut.isSuccess) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <div className="text-center">
          <Trash2 className="mx-auto h-10 w-10 text-zinc-600" />
          <p className="mt-3 text-sm text-zinc-300">
            {unsubMut.isSuccess ? "Channel deleted" : "Unsubscribing…"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">Возвращаемся на главную…</p>
        </div>
      </div>
    );
  }

  if (!channel) {
    return <p className="text-sm text-zinc-400">Channel not found.</p>;
  }

  const policyLabel = describePolicy(channel.download_policy, channel.latest_count, channel.download_from_date);

  async function onRebuild() {
    const ok = await confirm({
      title: `Rebuild "${channel!.name}"?`,
      body: (
        <>
          <p>
            Удалит ВСЕ архивные видео этого канала
            <span className="text-zinc-200 font-medium"> ({channel!.video_count} шт.</span> + файлы + превью)
            и перезальёт по текущим настройкам:
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-zinc-500">
            <li>• Policy: <span className="text-zinc-300">{policyLabel}</span></li>
            <li>• Quality: <span className="text-zinc-300">{describeQuality(channel!.quality, globals?.default_quality)}</span></li>
          </ul>
        </>
      ),
      confirmLabel: "Rebuild",
      destructive: true,
    });
    if (ok) rebuildMut.mutate();
  }

  async function onUnsubscribe() {
    const ok = await confirm({
      title: `Unsubscribe from "${channel!.name}"?`,
      body: "Канал отписывается, и все его архивные видео удаляются с диска.",
      confirmLabel: "Unsubscribe",
      destructive: true,
    });
    if (ok) {
      setDeleting(true);
      unsubMut.mutate();
    }
  }

  return (
    <>
      <ChannelHeader
        channel={channel}
        globals={globals}
        onSync={() => syncMut.mutate()}
        syncPending={syncMut.isPending}
        onRebuild={onRebuild}
        rebuildPending={rebuildMut.isPending}
        onUnsubscribe={onUnsubscribe}
      />

      <ChannelSettings channel={channel} globals={globals} />

      <VideoGrid
        videos={videos}
        isLoading={isLoading}
        emptyTitle="No videos archived yet"
        emptyHint="Hit Sync now to scan for uploads, or change settings + Rebuild to reapply the policy."
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header

function ChannelHeader({
  channel, globals, onSync, syncPending, onRebuild, rebuildPending, onUnsubscribe,
}: {
  channel: Channel;
  globals: GlobalSettings | undefined;
  onSync: () => void; syncPending: boolean;
  onRebuild: () => void; rebuildPending: boolean;
  onUnsubscribe: () => void;
}) {
  const [descOpen, setDescOpen] = useState(false);
  const description = channel.description?.trim() ?? "";

  return (
    <header className="mb-4 overflow-hidden rounded-2xl bg-zinc-900 p-4 sm:p-5">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        {channel.thumbnail_url ? (
          <img
            src={channel.thumbnail_url}
            alt=""
            referrerPolicy="no-referrer"
            className="h-20 w-20 sm:h-24 sm:w-24 flex-shrink-0 rounded-full object-cover bg-zinc-800"
          />
        ) : (
          <div className="grid h-20 w-20 sm:h-24 sm:w-24 flex-shrink-0 place-items-center rounded-full bg-zinc-800">
            <Tv className="h-8 w-8 text-zinc-500" />
          </div>
        )}

        {/* Name, stats, action buttons */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h1 className="min-w-0 flex-1 text-xl sm:text-2xl font-semibold tracking-tight break-words">
              {channel.name}
            </h1>
            {youtubeChannelUrl(channel.url) && (
              <a
                href={youtubeChannelUrl(channel.url)!}
                target="_blank"
                rel="noopener noreferrer"
                title="Open channel on YouTube"
                className="mt-1.5 rounded-full p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            {formatCount(channel.subscriber_count)} subs ·{" "}
            <span className="text-zinc-200 font-medium">{channel.video_count}</span> archived
          </p>
          <SyncStatusLine channel={channel} globals={globals} />

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={onSync}
              disabled={syncPending}
              className="flex items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-1 text-xs sm:text-sm font-medium hover:bg-zinc-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncPending ? "animate-spin" : ""}`} />
              Sync now
            </button>
            <button
              onClick={onRebuild}
              disabled={rebuildPending}
              className="flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1 text-xs sm:text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
              title="Wipes all videos and re-downloads from scratch using current settings."
            >
              <RefreshCw className={`h-3.5 w-3.5 ${rebuildPending ? "animate-spin" : ""}`} />
              Rebuild
            </button>
            <button
              onClick={onUnsubscribe}
              className="flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-xs sm:text-sm font-medium text-white hover:bg-red-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Unsubscribe
            </button>
          </div>
        </div>
      </div>

      {/* Description — completely hidden by default. A single small button
          reveals it; clicking again hides it. */}
      {description && (
        <div className="mt-3 border-t border-zinc-800 pt-3">
          <button
            onClick={() => setDescOpen((s) => !s)}
            className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
          >
            {descOpen ? "Hide description" : "Show description"}
          </button>
          {descOpen && (
            <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-300">
              {description}
            </p>
          )}
        </div>
      )}
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings

function ChannelSettings({
  channel, globals,
}: { channel: Channel; globals: GlobalSettings | undefined }) {
  const qc = useQueryClient();
  const [open, setOpen] = useLocalStorageBool("channel.settings.open", true);

  const initialPolicy = (channel.download_policy as DownloadPolicy | null) ?? null;
  const [policy,      setPolicy]      = useState<DownloadPolicy | null>(initialPolicy);
  const [latestCount, setLatestCount] = useState<number | "">(channel.latest_count ?? 10);
  const [quality,     setQuality]     = useState<Quality | "">((channel.quality as Quality) ?? "");
  const [retention,   setRetention]   = useState<number | null>(channel.retention_days);
  const [interval,    setIntervalVal] = useState<number | "">(channel.sync_interval_minutes ?? "");
  const [showOnHome,  setShowOnHome]  = useState<boolean>(channel.show_on_home);

  useEffect(() => setPolicy((channel.download_policy as DownloadPolicy | null) ?? null), [channel.download_policy]);
  useEffect(() => setLatestCount(channel.latest_count ?? 10),         [channel.latest_count]);
  useEffect(() => setQuality((channel.quality as Quality) ?? ""),     [channel.quality]);
  useEffect(() => setRetention(channel.retention_days),               [channel.retention_days]);
  useEffect(() => setIntervalVal(channel.sync_interval_minutes ?? ""), [channel.sync_interval_minutes]);
  useEffect(() => setShowOnHome(channel.show_on_home),                [channel.show_on_home]);

  const isLegacy = initialPolicy == null;

  const mut = useMutation({
    mutationFn: () => channelsApi.update(channel.id, {
      ...(policy ? { download_policy: policy } : {}),
      quality: quality === "" ? null : (quality as Quality),
      retention_days: retention,
      sync_interval_minutes: interval === "" ? null : Number(interval),
      show_on_home: showOnHome,
      latest_count: policy === "latest"
        ? (latestCount === "" ? null : Number(latestCount))
        : null,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["channels"] }),
  });

  const dirty =
    policy !== initialPolicy
    || (quality || null) !== (channel.quality ?? null)
    || retention !== channel.retention_days
    || (interval === "" ? null : Number(interval)) !== channel.sync_interval_minutes
    || showOnHome !== channel.show_on_home
    || (policy === "latest" && Number(latestCount || 0) !== (channel.latest_count ?? 0));

  return (
    <section className="mb-6 overflow-hidden rounded-2xl bg-zinc-900">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 sm:px-5"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-semibold">Settings</span>
          {!open && (
            <span className="truncate text-xs text-zinc-500">
              {describePolicy(channel.download_policy, channel.latest_count, channel.download_from_date)} ·{" "}
              {describeQuality(channel.quality, globals?.default_quality)} ·{" "}
              retention {describeRetention(channel.retention_days, globals?.default_retention_days)}
            </span>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
      </button>

      {open && (
        <div className="border-t border-zinc-800">
          {isLegacy && (
            <div className="flex items-start gap-2 border-b border-zinc-800 bg-amber-500/10 px-4 py-3 text-xs text-amber-300 sm:px-5">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                Этот канал добавлен до того, как мы стали хранить политику.
                Текущее поведение: <span className="text-amber-100 font-medium">{describePolicy(null, channel.latest_count, channel.download_from_date)}</span>.
                Выбери политику ниже и нажми Save, чтобы Rebuild знал, что делать.
              </div>
            </div>
          )}

          <div className="divide-y divide-zinc-800">
            <Row label="What to download" hint="Применяется при Rebuild — все текущие видео канала удалятся и зальются заново.">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={policy ?? ""}
                  onChange={(e) => setPolicy(e.target.value ? (e.target.value as DownloadPolicy) : null)}
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-zinc-600"
                >
                  {policy == null && <option value="">— pick a policy —</option>}
                  {POLICY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                {policy === "latest" && (
                  <>
                    <input
                      type="number" min={1} max={500}
                      value={latestCount}
                      onChange={(e) => setLatestCount(e.target.value === "" ? "" : Math.max(1, Number(e.target.value)))}
                      className="w-20 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-zinc-600"
                    />
                    <span className="text-xs text-zinc-400">videos</span>
                  </>
                )}
              </div>
            </Row>

            <Row label="Quality" hint="Будущие загрузки. Чтобы перекачать уже скачанное — Rebuild.">
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as Quality | "")}
                className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-zinc-600"
              >
                <option value="">
                  Inherit global
                  {globals ? ` (${describeQuality(globals.default_quality)})` : ""}
                </option>
                <option value="best">Best available</option>
                <option value="1080">1080p</option>
                <option value="720">720p</option>
                <option value="480">480p</option>
                <option value="360">360p</option>
              </select>
            </Row>

            <Row label="Sync interval" hint="Как часто проверять канал на новые видео. Пусто = глобальный default.">
              <div className="flex items-center gap-2">
                <input
                  type="number" min={30}
                  placeholder={globals ? `${globals.sync_interval_minutes}` : "default"}
                  value={interval}
                  onChange={(e) => setIntervalVal(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-28 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-zinc-600"
                />
                <span className="text-xs text-zinc-400">minutes</span>
              </div>
            </Row>

            <Row label="Retention" hint="Сколько хранить скачанные видео. Inherit = брать глобальное.">
              <RetentionPicker value={retention} onChange={setRetention} />
            </Row>

            <Row label="Show on Home" hint="Если выключено, видео канала не лезут на главную сетку. На странице канала и в поиске остаются.">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showOnHome}
                  onChange={(e) => setShowOnHome(e.target.checked)}
                  className="accent-zinc-100"
                />
                <span className="text-zinc-300">{showOnHome ? "Visible on Home" : "Hidden from Home"}</span>
              </label>
            </Row>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-zinc-800 px-4 py-3 sm:px-5">
            {mut.isSuccess && !mut.isPending && !dirty && (
              <span className="text-xs text-emerald-400">Saved</span>
            )}
            <button
              onClick={() => mut.mutate()}
              disabled={mut.isPending || !dirty}
              className="flex items-center gap-2 rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-40"
            >
              {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function SyncStatusLine({
  channel, globals,
}: { channel: Channel; globals: GlobalSettings | undefined }) {
  const effective = channel.sync_interval_minutes ?? globals?.sync_interval_minutes ?? null;
  const next = effective ? nextSyncAt(channel.last_synced, effective) : null;

  if (channel.last_sync_error) {
    return (
      <p className="mt-1 text-xs text-red-400">
        Sync ошибка {timeAgo(channel.last_synced)}: {channel.last_sync_error.slice(0, 140)}
      </p>
    );
  }
  if (!channel.last_synced) {
    return <p className="mt-1 text-xs text-zinc-500">Ещё ни разу не синкался.</p>;
  }
  const added = channel.last_sync_added_count;
  const addedTxt =
    added == null ? "" :
    added === 0   ? " · ничего нового" :
    added === 1   ? " · +1 видео" :
                    ` · +${added} видео`;
  return (
    <p className="mt-1 text-xs text-zinc-500">
      Последний sync {timeAgo(channel.last_synced)}{addedTxt}
      {next && <> · следующий {timeUntil(next)}</>}
    </p>
  );
}

function Row({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[200px_1fr] sm:items-start sm:gap-4 sm:px-5">
      <div>
        <p className="text-sm font-medium text-zinc-100">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-zinc-500 max-w-xs">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}
