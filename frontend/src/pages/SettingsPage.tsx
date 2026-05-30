import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Loader2, CheckCircle2, Trash2, ChevronDown, ChevronUp, Wrench, Download as DownloadIcon, Upload, ShieldCheck } from "lucide-react";
import { settingsApi, maintenanceApi, backupApi, type GlobalSettings, type ImportReport, type Quality } from "../lib/api";
import { ImportReviewModal, type ImportPayload } from "../components/ImportReviewModal";
import { useLocalStorageBool } from "../hooks/useLocalStorageBool";
import { ACCENTS, getAccentId, setAccentId } from "../lib/accents";
import { BACKGROUNDS, getBackgroundId, setBackgroundId } from "../lib/backgrounds";

const QUALITIES: Quality[] = ["best", "1080", "720", "480", "360"];
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const CATEGORIES = [
  { value: "sponsor",        label: "Спонсорская реклама", color: "#3FB950" },
  { value: "selfpromo",      label: "Самопромо",          color: "#FFD93D" },
  { value: "interaction",    label: "«Лайк и подписка»",   color: "#58B0FF" },
  { value: "intro",          label: "Заставка / интро",   color: "#1FD1B5" },
  { value: "outro",          label: "Концовка",           color: "#A66BFF" },
  { value: "music_offtopic", label: "Не-музыка в клипах", color: "#FF8A1F" },
];

export function SettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: settingsApi.get,
  });

  const [form, setForm] = useState<GlobalSettings | null>(null);
  useEffect(() => { if (data) setForm(data); }, [data]);

  const mut = useMutation({
    mutationFn: (body: Partial<GlobalSettings>) => settingsApi.update(body),
    onSuccess: (d) => { qc.setQueryData(["settings"], d); setForm(d); },
  });

  if (isLoading || !form) return <p className="text-sm text-zinc-400">Загрузка…</p>;

  function update<K extends keyof GlobalSettings>(key: K, value: GlobalSettings[K]) {
    setForm((cur) => (cur ? { ...cur, [key]: value } : cur));
  }

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Настройки</h1>
      <p className="mb-6 text-sm text-zinc-400">
        Глобальные дефолты для всех каналов. Каждый канал может переопределить качество,
        retention и интервал sync в своих собственных настройках.
      </p>

      <div className="mb-5 space-y-5">
        <AccentSection />
        <BackgroundSection />
      </div>

      <form
        className="space-y-5"
        onSubmit={(e) => { e.preventDefault(); if (form) mut.mutate(form); }}
      >
        {/* Compact config sections sit in two columns on desktop so the page
            isn't one tall vertical sheet; the detail-heavy sections below
            (shortcuts, gestures, SponsorBlock, advanced, backup) stay full-width. */}
        <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section title="Загрузка" subtitle="Что и в каком качестве качать.">
          <Row
            label="Качество по умолчанию"
            hint="Применяется ко всем каналам, где не выбрано своё качество. Сохранённое значение влияет на будущие загрузки; чтобы перекачать старое — Rebuild на странице канала."
          >
            <select
              value={form.default_quality}
              onChange={(e) => update("default_quality", e.target.value as Quality)}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-zinc-600"
            >
              {QUALITIES.map((q) => (
                <option key={q} value={q}>{q === "best" ? "Лучшее доступное" : `${q}p`}</option>
              ))}
            </select>
          </Row>

          <Row
            label="Лимит при первичной выкачке (last-N / all)"
            hint="Сколько максимум видео проверять/качать при подписке с политикой «last 30 days», «last year» или «Everything». Фильтр по дате применяется первым; этот потолок защищает от очень больших каналов."
          >
            <NumberWithUnit
              value={form.initial_backfill_hard_cap}
              min={50} max={5000} step={50}
              onChange={(n) => update("initial_backfill_hard_cap", n)}
              unit="видео"
            />
          </Row>

          <Row
            label="Лимит периодической проверки канала"
            hint="При каждой плановой проверке смотрим столько последних видео канала, чтобы заметить новые. Меньше → меньше нагрузки, но риск пропустить взрыв активности."
          >
            <NumberWithUnit
              value={form.max_videos_per_channel_scan}
              min={10} max={500} step={10}
              onChange={(n) => update("max_videos_per_channel_scan", n)}
              unit="видео"
            />
          </Row>
        </Section>

        <Section title="Хранение" subtitle="Когда удалять скачанное.">
          <Row
            label="Срок хранения по умолчанию"
            hint="Через сколько дней после скачивания видео удаляется. 0 = хранить вечно. Канал может задать своё. Звёздочка/Pin на видео всегда отменяют удаление."
          >
            <NumberWithUnit
              value={form.default_retention_days}
              min={0} max={3650}
              onChange={(n) => update("default_retention_days", n)}
              unit="дн."
            />
          </Row>

          <Row
            label="Удалять после N% просмотра"
            hint="Если посмотрел больше указанной доли — удалится при ближайшей чистке (раз в час). 0 = выключено. Любимое и пиннутое не трогаем. Кнопка справа — прогнать чистку прямо сейчас."
          >
            <div className="flex flex-wrap items-center gap-2">
              <NumberWithUnit
                value={form.delete_after_watched_percent}
                min={0} max={100}
                onChange={(n) => update("delete_after_watched_percent", n)}
                unit="%"
              />
              <CleanupNowButton />
            </div>
          </Row>
        </Section>

        <Section title="Плеер">
          <Row
            label="Скорость по умолчанию"
            hint="Скорость, с которой стартует любое обычное видео. Меняя скорость в плеере, ты меняешь именно эту настройку. У музыки своя скорость — она ниже."
          >
            <select
              value={form.default_playback_rate}
              onChange={(e) => update("default_playback_rate", Number(e.target.value))}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-zinc-600"
            >
              {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </Row>
          <Row
            label="Скорость для музыки"
            hint="Отдельная скорость для треков. Меняя скорость во время прослушивания музыки — обновляешь именно её, а не общую."
          >
            <select
              value={form.music_playback_rate}
              onChange={(e) => update("music_playback_rate", Number(e.target.value))}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-zinc-600"
            >
              {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </Row>
          <Row
            label="Mini-player при уходе со страницы"
            hint="Когда уходишь со страницы видео — в правом нижнем углу остаётся мини-плеер, продолжает играть. Выключи если мешает."
          >
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.mini_player_enabled}
                onChange={(e) => update("mini_player_enabled", e.target.checked)}
                className="h-4 w-4 accent-sky-400"
              />
              <span className="text-zinc-300">
                {form.mini_player_enabled ? "Включён" : "Выключен"}
              </span>
            </label>
          </Row>
        </Section>

        <Section title="Расписание sync">
          <Row
            label="Интервал проверки"
            hint="Как часто шедулер обходит подписанные каналы в поисках новых видео. Канал может задать свой."
          >
            <NumberWithUnit
              value={form.sync_interval_minutes}
              min={30}
              onChange={(n) => update("sync_interval_minutes", n)}
              unit="мин"
            />
          </Row>
          <Row
            label="Джиттер"
            hint="Случайный разброс плюс-минус к интервалу. Нужен чтобы не лезть на YouTube ровно по часам — иначе паттерн виден и нас могут зарейтлимитить."
          >
            <NumberWithUnit
              value={form.sync_jitter_minutes}
              min={0}
              onChange={(n) => update("sync_jitter_minutes", n)}
              unit="± мин"
            />
          </Row>
        </Section>

        <Section title="Расписание загрузок" subtitle="Когда и как быстро качать. Окно по локальному времени; старт = конец → качаем всегда.">
          <Row
            label="Активные часы"
            hint="Качать только в этом окне (например 1 → 7 — ночью). Вне окна загрузки ждут. Старт = конец → без ограничения."
          >
            <div className="flex items-center gap-2">
              <NumberWithUnit value={form.download_window_start} min={0} max={23} onChange={(n) => update("download_window_start", n)} unit="ч" />
              <span className="text-xs text-zinc-500">→</span>
              <NumberWithUnit value={form.download_window_end} min={0} max={23} onChange={(n) => update("download_window_end", n)} unit="ч" />
            </div>
          </Row>
          <Row
            label="Лимит скорости"
            hint="Потолок скорости загрузки, КБ/с. 0 = без ограничения. Применяется к новым загрузкам."
          >
            <NumberWithUnit value={form.download_rate_limit_kbps} min={0} max={100000} step={100} onChange={(n) => update("download_rate_limit_kbps", n)} unit="КБ/с" />
          </Row>
        </Section>
        </div>

        <Section
          title="Горячие клавиши плеера"
          subtitle="Работают пока фокус не в текстовом поле. Регистр и раскладка значения не имеют (кириллические эквиваленты замаплены автоматически)."
        >
          <div className="grid gap-4 px-4 py-3 sm:grid-cols-2 sm:px-5">
            <ShortcutGroup title="Воспроизведение">
              <Shortcut keys={["Space", "K"]} desc="Play / Pause" />
              <Shortcut keys={["C"]}          desc="Субтитры on/off" />
              <Shortcut keys={[","]}          desc="Скорость −" />
              <Shortcut keys={["."]}          desc="Скорость +" />
            </ShortcutGroup>
            <ShortcutGroup title="Перемотка">
              <Shortcut keys={["J"]}      desc="−10 сек" />
              <Shortcut keys={["L"]}      desc="+10 сек" />
              <Shortcut keys={["←"]}      desc="−5 сек" />
              <Shortcut keys={["→"]}      desc="+5 сек" />
              <Shortcut keys={["0", "9"]} desc="Прыжок к 0% … 90%" sep="…" />
            </ShortcutGroup>
            <ShortcutGroup title="Очередь">
              <Shortcut keys={["N"]} desc="Следующее видео (плейлист / recommended)" />
              <Shortcut keys={["P"]} desc="Предыдущее (только в плейлисте)" />
            </ShortcutGroup>
            <ShortcutGroup title="Просмотр">
              <Shortcut keys={["F"]} desc="Fullscreen" />
              <Shortcut keys={["I"]} desc="Picture-in-Picture" />
              <Shortcut keys={["Esc"]} desc="Выйти из fullscreen" />
            </ShortcutGroup>
          </div>
        </Section>

        <Section
          title="Touch-жесты плеера"
          subtitle="Работают на тачскринах внутри видео-области плеера. Тап остаётся за play/pause и double-tap-seek — жесты срабатывают только когда движение пальца выраженно направленное."
        >
          <div className="grid gap-4 px-4 py-3 sm:grid-cols-2 sm:px-5">
            <ShortcutGroup title="Вертикальные">
              <Swipe dir="up"   desc="Открыть fullscreen" />
              <Swipe dir="down" desc="Из fullscreen — выйти; из inline — свернуть в mini-плеер" />
            </ShortcutGroup>
            <ShortcutGroup title="Горизонтальные">
              <Swipe dir="left"  desc="Следующий трек в очереди (music / playlist)" />
              <Swipe dir="right" desc="Предыдущий трек" />
            </ShortcutGroup>
            <ShortcutGroup title="Двумя пальцами">
              <Swipe dir="pinchOut" desc="Fill screen — растянуть видео с обрезкой полос (object-cover)" />
              <Swipe dir="pinchIn"  desc="Fit — вернуть letterbox (object-contain), без обрезки" />
            </ShortcutGroup>
            <ShortcutGroup title="Pull-to-refresh">
              <li className="text-sm text-zinc-300">
                Потяни вниз с верха любой страницы со списками — обновит данные без перезагрузки. На /watch отключён (там жесты у плеера).
              </li>
            </ShortcutGroup>
          </div>
        </Section>

        <Section
          title="SponsorBlock"
          subtitle="Какие сегменты автоматически проматывать. Данные подтягиваются из открытой базы sponsor.ajay.app; раз в сутки обновляются (новые сегменты могут появиться после загрузки)."
        >
          <div className="grid gap-1.5 sm:grid-cols-2 p-4">
            {CATEGORIES.map(({ value, label, color }) => {
              const selected = form.sponsorblock_categories.includes(value);
              return (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                    selected
                      ? "border-zinc-500 bg-zinc-800"
                      : "border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => {
                      const cur = new Set(form.sponsorblock_categories);
                      if (selected) cur.delete(value); else cur.add(value);
                      update("sponsorblock_categories", [...cur]);
                    }}
                    className="accent-zinc-100"
                  />
                  <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} />
                  <span className="flex-1">{label}</span>
                </label>
              );
            })}
          </div>
        </Section>

        <AdvancedSection form={form} update={update} />

        <BackupSection />

        <div
          className="sticky bottom-0 -mx-4 mt-4 flex items-center justify-end gap-3 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          {mut.isSuccess && !mut.isPending && (
            <span className="flex items-center gap-1 text-sm text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> Сохранено
            </span>
          )}
          <button
            type="submit"
            disabled={mut.isPending}
            className="flex items-center gap-2 rounded-full bg-zinc-100 px-5 py-1.5 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
          >
            {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AccentSection() {
  const [current, setCurrent] = useState(getAccentId());
  return (
    <Section title="Accent colour" subtitle="Цвет акцента интерфейса — меняй под настроение. Применяется сразу.">
      <div className="flex flex-wrap gap-2.5 px-4 py-4 sm:px-5">
        {ACCENTS.map((a) => {
          const active = current === a.id;
          return (
            <button
              key={a.id}
              type="button"
              title={a.name}
              aria-label={a.name}
              aria-pressed={active}
              onClick={() => { setAccentId(a.id); setCurrent(a.id); }}
              className={`h-8 w-8 rounded-full transition-transform hover:scale-110 ${
                active ? "ring-2 ring-zinc-100 ring-offset-2 ring-offset-zinc-900" : "ring-1 ring-white/10"
              }`}
              style={{ background: `linear-gradient(to bottom, ${a.accent}, ${a.strong})` }}
            />
          );
        })}
      </div>
    </Section>
  );
}

function BackgroundSection() {
  const [current, setCurrent] = useState(getBackgroundId());
  return (
    <Section title="Background" subtitle="Оттенок и уровень темноты фона. Применяется сразу.">
      <div className="flex flex-wrap gap-2.5 px-4 py-4 sm:px-5">
        {BACKGROUNDS.map((b) => {
          const active = current === b.id;
          return (
            <button
              key={b.id}
              type="button"
              title={b.name}
              aria-label={b.name}
              aria-pressed={active}
              onClick={() => { setBackgroundId(b.id); setCurrent(b.id); }}
              className={`h-9 w-9 rounded-full transition-transform hover:scale-110 ${
                active ? "ring-2 ring-accent ring-offset-2 ring-offset-zinc-900" : "ring-1 ring-white/10"
              }`}
              style={{ background: `linear-gradient(135deg, ${b.ramp[1]} 0 50%, ${b.ramp[2]} 50% 100%)` }}
            />
          );
        })}
      </div>
    </Section>
  );
}

function Section({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-zinc-900">
      <div className="border-b border-white/5 px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
      </div>
      <div className="divide-y divide-zinc-800">{children}</div>
    </section>
  );
}

function Row({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-6 sm:px-5">
      <div>
        <p className="text-sm font-medium text-zinc-100">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-zinc-400 max-w-xl leading-relaxed">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function AdvancedSection({
  form, update,
}: {
  form: GlobalSettings;
  update: <K extends keyof GlobalSettings>(key: K, value: GlobalSettings[K]) => void;
}) {
  const [open, setOpen] = useLocalStorageBool("settings.advanced.open", false);
  return (
    <section className="overflow-hidden rounded-2xl bg-zinc-900">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 sm:px-5 hover:bg-zinc-800/40"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-zinc-500" />
          <h2 className="text-sm font-semibold">Advanced</h2>
          <span className="text-xs text-zinc-500">— тонкие настройки внутренностей</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
      </button>
      {open && (
        <div className="border-t border-zinc-800 divide-y divide-zinc-800">
          <Row
            label="Параллельных загрузок"
            hint="Сколько видео качать одновременно. 1 = по одному (мягче к YouTube, рекомендуется). 2-3 ускоряет разгрёб большого бэклога ценой риска бана за паттерн."
          >
            <NumberWithUnit
              value={form.max_concurrent_downloads}
              min={1} max={5} step={1}
              onChange={(n) => update("max_concurrent_downloads", n)}
              unit="одновременно"
            />
          </Row>

          <Row
            label="Пауза между загрузками"
            hint="Случайная пауза между двумя последовательными скачиваниями. Защищает от бана за паттерн. Min ≤ max."
          >
            <div className="flex items-center gap-2">
              <NumberWithUnit
                value={form.between_downloads_min_seconds}
                min={0} max={600}
                onChange={(n) => update("between_downloads_min_seconds", n)}
                unit="сек"
              />
              <span className="text-xs text-zinc-500">—</span>
              <NumberWithUnit
                value={form.between_downloads_max_seconds}
                min={0} max={600}
                onChange={(n) => update("between_downloads_max_seconds", n)}
                unit="сек"
              />
            </div>
          </Row>

          <Row
            label="Preview: ширина"
            hint="Разрешение мини-ролика по горизонтали. Меняй с осторожностью — слишком большое = тяжёлый файл, слишком маленькое = размыто."
          >
            <NumberWithUnit
              value={form.preview_width}
              min={160} max={1280} step={20}
              onChange={(n) => update("preview_width", n)}
              unit="px"
            />
          </Row>

          <Row
            label="Preview: качество (CRF)"
            hint="x264 Constant Rate Factor. 18 = почти без потерь и тяжело, 30 = маленькие файлы, видно артефакты. Текущее 27 — хороший баланс."
          >
            <NumberWithUnit
              value={form.preview_crf}
              min={18} max={35}
              onChange={(n) => update("preview_crf", n)}
              unit="CRF"
            />
          </Row>

          <Row
            label="Preview: кол-во сегментов"
            hint="Сколько односекундных кусков склеить в превью. Больше = лучше понятно о чём видео, но дольше генерится и тяжелее файл."
          >
            <NumberWithUnit
              value={form.preview_segments}
              min={4} max={24}
              onChange={(n) => update("preview_segments", n)}
              unit="шт"
            />
          </Row>

          <Row
            label="Music queue: размер панели"
            hint="Сколько ближайших треков показывать в правой колонке на странице просмотра при play-all / shuffle. Сама очередь может быть длиннее — это только то, что рендерится в UI."
          >
            <NumberWithUnit
              value={form.music_queue_panel_size}
              min={10} max={1000} step={10}
              onChange={(n) => update("music_queue_panel_size", n)}
              unit="треков"
            />
          </Row>

          <Row
            label="SponsorBlock: окно обновления"
            hint="Для видео не старше N дней раз в сутки заново запрашиваются сегменты — комьюнити мог их добавить уже после скачивания."
          >
            <NumberWithUnit
              value={form.sponsorblock_refresh_days}
              min={1} max={365}
              onChange={(n) => update("sponsorblock_refresh_days", n)}
              unit="дн."
            />
          </Row>
        </div>
      )}
    </section>
  );
}

function BackupSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<ImportPayload | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error,  setError]  = useState<string | null>(null);
  const [busy,   setBusy]   = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    setReport(null); setError(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text) as ImportPayload;
      if (!Array.isArray(json.channels) && !Array.isArray(json.playlists)) {
        throw new Error("Not a YT Archive backup file (no channels or playlists found).");
      }
      setReview(json);
    } catch (e) {
      setError((e as Error)?.message ?? "Couldn't parse file");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl bg-zinc-900">
      <div className="border-b border-white/5 px-4 py-3 sm:px-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-zinc-500" />
          Backup
        </h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          JSON-дамп подписок, плейлистов и глобальных настроек. Видео и история не сохраняются —
          они восстановятся при импорте через обычный sync.
        </p>
      </div>
      <div className="divide-y divide-zinc-800">
        <Row label="Export" hint="Скачать всё в один файл. Безопасно держать в Dropbox / iCloud.">
          <a
            href={backupApi.exportUrl()}
            className="inline-flex items-center gap-2 rounded-full bg-zinc-800 px-4 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
          >
            <DownloadIcon className="h-4 w-4" />
            Download JSON
          </a>
        </Row>
        <Row
          label="Import"
          hint="Откроется превью — можно отметить какие каналы / плейлисты импортировать и подправить настройки. Уже подписанные пропускаются на бэке."
        >
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              if (e.target) e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full bg-zinc-800 px-4 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Pick JSON file
          </button>
        </Row>
        {(report || error) && (
          <div className="px-4 py-3 sm:px-5 text-xs">
            {error && <p className="text-red-400">{error}</p>}
            {report && (
              <ul className="space-y-1 text-zinc-300">
                <li>Channels added: <span className="text-emerald-400 font-medium">{report.channels_added}</span> · skipped {report.channels_skipped}</li>
                <li>Playlists added: <span className="text-emerald-400 font-medium">{report.playlists_added}</span> · skipped {report.playlists_skipped}</li>
                <li>Settings keys applied: <span className="text-emerald-400 font-medium">{report.settings_applied}</span></li>
                {report.errors.length > 0 && (
                  <li className="text-amber-400">Errors ({report.errors.length}):
                    <ul className="ml-4 mt-1 list-disc space-y-0.5">
                      {report.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                      {report.errors.length > 5 && <li>…and {report.errors.length - 5} more</li>}
                    </ul>
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
      {review && (
        <ImportReviewModal
          payload={review}
          onClose={() => setReview(null)}
          onDone={(r) => { setReport(r); setReview(null); }}
        />
      )}
    </section>
  );
}

function CleanupNowButton() {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => maintenanceApi.runCleanup(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["videos"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["history"] });
    },
  });
  return (
    <button
      type="button"
      onClick={() => mut.mutate()}
      disabled={mut.isPending}
      className="flex items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-1.5 text-xs font-medium hover:bg-zinc-700 disabled:opacity-50"
    >
      {mut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      Прогнать сейчас
      {mut.isSuccess && !mut.isPending && (
        <span className="ml-1 text-emerald-400">· удалено {mut.data?.deleted}</span>
      )}
    </button>
  );
}

function ShortcutGroup({
  title, children,
}: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h3>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  );
}

function Shortcut({
  keys, desc, sep = "/",
}: { keys: string[]; desc: string; sep?: string }) {
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="text-zinc-300">{desc}</span>
      <span className="flex items-center gap-1">
        {keys.map((k, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-xs text-zinc-500">{sep}</span>}
            <kbd className="inline-block min-w-[28px] rounded-md border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-center font-mono text-[11px] text-zinc-100 shadow-[inset_0_-1px_0_0_rgb(63_63_70)]">
              {k}
            </kbd>
          </span>
        ))}
      </span>
    </li>
  );
}

/** Direction badge for the touch-gestures section. Mirrors the shape of
 *  Shortcut but uses arrow / pinch glyphs instead of kbd squares so it's
 *  obvious at a glance these are physical gestures, not keys. */
function Swipe({
  dir, desc,
}: {
  dir: "up" | "down" | "left" | "right" | "pinchIn" | "pinchOut";
  desc: string;
}) {
  const glyph =
    dir === "up"       ? "↑"  :
    dir === "down"     ? "↓"  :
    dir === "left"     ? "←"  :
    dir === "right"    ? "→"  :
    dir === "pinchIn"  ? "→←" :
                          "←→";
  return (
    <li className="flex items-start justify-between gap-3 text-sm">
      <span className="text-zinc-300 flex-1 leading-snug">{desc}</span>
      <span
        title={dir.startsWith("pinch") ? "Two-finger pinch" : "Swipe"}
        className="inline-flex min-w-[36px] items-center justify-center rounded-md border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[13px] leading-none text-zinc-100"
      >
        {glyph}
      </span>
    </li>
  );
}

function NumberWithUnit({
  value, onChange, min, max, step, unit,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
  unit: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <input
        type="number"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => {
          let n = Number(e.target.value);
          if (Number.isNaN(n)) return;
          if (min != null) n = Math.max(min, n);
          if (max != null) n = Math.min(max, n);
          onChange(n);
        }}
        className="w-24 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-zinc-600 text-right"
      />
      <span className="text-xs text-zinc-400">{unit}</span>
    </div>
  );
}
