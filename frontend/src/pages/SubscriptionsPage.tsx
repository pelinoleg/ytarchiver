import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Inbox, Tv, FolderPlus, Folder, FolderOpen,
  Pencil, Check, X, Trash2,
} from "lucide-react";
import {
  channelsApi, channelFoldersApi, settingsApi,
  type Channel, type ChannelFolder, type GlobalSettings,
} from "../lib/api";
import {
  describeInterval, describePolicy, describeQuality, describeRetention,
  formatCount, nextSyncAt, timeAgo, timeUntil,
} from "../lib/format";
import { useConfirm } from "../components/ConfirmProvider";

export function SubscriptionsPage() {
  const { data: channels = [], isLoading } = useQuery({
    queryKey: ["channels"],
    queryFn: channelsApi.list,
  });
  const { data: folders = [] } = useQuery({
    queryKey: ["channel-folders"],
    queryFn: channelFoldersApi.list,
  });
  const { data: globals } = useQuery({
    queryKey: ["settings"],
    queryFn: settingsApi.get,
  });

  // Filter chip selection. ``null`` = all, ``0`` = ungrouped only, ``id`` = a specific folder.
  // Kept in local state because it's pure UI; not persisted between visits.
  const [filter, setFilter] = useState<number | null>(null);

  const visible = channels.filter((c) => {
    if (filter === null) return true;
    if (filter === 0)    return !c.folder_id;
    return c.folder_id === filter;
  });

  // Count chips by folder for the "(n)" suffixes.
  const counts = new Map<number, number>();
  for (const c of channels) {
    if (c.folder_id) counts.set(c.folder_id, (counts.get(c.folder_id) ?? 0) + 1);
  }
  const ungroupedCount = channels.filter((c) => !c.folder_id).length;

  return (
    <>
      <header className="mb-5 flex items-center gap-3.5">
        <span className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-accent to-accent-strong text-accent-ink shadow-lg shadow-accent/25">
          <Tv className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Subscriptions</h1>
          <p className="text-sm text-zinc-400">{channels.length} {channels.length === 1 ? "channel" : "channels"}</p>
        </div>
      </header>

      {/* Folder strip + filter chips. Edit / new actions live in the same
       *  row so the user has a single mental model of "folder management". */}
      <FolderStrip
        folders={folders}
        counts={counts}
        ungroupedCount={ungroupedCount}
        totalCount={channels.length}
        filter={filter}
        onFilter={setFilter}
      />

      {isLoading ? (
        <div className="mt-6 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-56 rounded-xl bg-zinc-900 animate-pulse" />
          ))}
        </div>
      ) : channels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Inbox className="h-12 w-12 text-zinc-700" />
          <h3 className="mt-4 text-lg font-semibold">No subscriptions yet</h3>
          <p className="mt-1 text-sm text-zinc-400">
            Click <span className="text-zinc-200">Add channel</span> in the top bar.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-8 text-center text-sm text-zinc-500">
          Нет каналов в этой группе.
        </div>
      ) : (
        <div className="mt-6 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((c) => (
            <SubscriptionCard
              key={c.id}
              channel={c}
              folders={folders}
              globals={globals}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder strip — horizontal chips for filtering + a "New folder" affordance
// and inline rename/delete via a small popover on each chip.

function FolderStrip({
  folders, counts, ungroupedCount, totalCount, filter, onFilter,
}: {
  folders: ChannelFolder[];
  counts: Map<number, number>;
  ungroupedCount: number;
  totalCount: number;
  filter: number | null;
  onFilter: (v: number | null) => void;
}) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);

  const createMut = useMutation({
    mutationFn: (name: string) => channelFoldersApi.create(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel-folders"] });
      setCreating(false);
      setNewName("");
    },
  });

  function submitCreate() {
    const name = newName.trim();
    if (!name) { setCreating(false); return; }
    createMut.mutate(name);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip
        active={filter === null}
        onClick={() => onFilter(null)}
        label={`All (${totalCount})`}
      />
      <Chip
        active={filter === 0}
        onClick={() => onFilter(0)}
        label={`Ungrouped (${ungroupedCount})`}
      />
      {folders.map((f) => (
        <FolderChip
          key={f.id}
          folder={f}
          count={counts.get(f.id) ?? 0}
          active={filter === f.id}
          onClick={() => onFilter(f.id)}
        />
      ))}

      {creating ? (
        <div className="flex items-center gap-1 rounded-full bg-zinc-900 ring-1 ring-zinc-700 px-1 py-0.5">
          <input
            ref={inputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
              if (e.key === "Escape") { setCreating(false); setNewName(""); }
            }}
            placeholder="Folder name"
            className="w-32 bg-transparent px-2 py-0.5 text-xs outline-none placeholder:text-zinc-500"
          />
          <button
            onClick={submitCreate}
            className="grid h-6 w-6 place-items-center rounded-full text-emerald-400 hover:bg-emerald-500/15"
            aria-label="Create"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => { setCreating(false); setNewName(""); }}
            className="grid h-6 w-6 place-items-center rounded-full text-zinc-400 hover:bg-zinc-800"
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-full bg-zinc-900 ring-1 ring-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          New folder
        </button>
      )}
    </div>
  );
}

function Chip({
  active, onClick, label,
}: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-zinc-100 text-zinc-950"
          : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );
}

function FolderChip({
  folder, count, active, onClick,
}: { folder: ChannelFolder; count: number; active: boolean; onClick: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const renameMut = useMutation({
    mutationFn: (newName: string) => channelFoldersApi.update(folder.id, { name: newName }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel-folders"] });
      setEditing(false);
    },
  });
  const deleteMut = useMutation({
    mutationFn: () => channelFoldersApi.delete(folder.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel-folders"] });
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
  });

  if (editing) {
    return (
      <div className="flex items-center gap-1 rounded-full bg-zinc-900 ring-1 ring-zinc-700 px-1 py-0.5">
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) renameMut.mutate(name.trim());
            if (e.key === "Escape") { setEditing(false); setName(folder.name); }
          }}
          className="w-32 bg-transparent px-2 py-0.5 text-xs outline-none"
        />
        <button
          onClick={() => name.trim() && renameMut.mutate(name.trim())}
          className="grid h-6 w-6 place-items-center rounded-full text-emerald-400 hover:bg-emerald-500/15"
          aria-label="Save"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={async () => {
            const ok = await confirm({
              title: `Удалить папку «${folder.name}»?`,
              body: "Каналы внутри вернутся в Ungrouped — сами каналы не трогаются, видео остаются.",
              confirmLabel: "Delete folder",
              destructive: true,
            });
            if (ok) deleteMut.mutate();
          }}
          className="grid h-6 w-6 place-items-center rounded-full text-red-400 hover:bg-red-500/15"
          aria-label="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => { setEditing(false); setName(folder.name); }}
          className="grid h-6 w-6 place-items-center rounded-full text-zinc-400 hover:bg-zinc-800"
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className={`group flex items-center rounded-full transition-colors ${
      active ? "bg-zinc-100 text-zinc-950" : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
    }`}>
      <button onClick={onClick} className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium">
        {active ? <FolderOpen className="h-3.5 w-3.5" /> : <Folder className="h-3.5 w-3.5" />}
        {folder.name} ({count})
      </button>
      <button
        onClick={() => setEditing(true)}
        className={`grid h-6 w-6 place-items-center rounded-full mr-0.5 ${
          active ? "text-zinc-950/70 hover:bg-zinc-950/10" : "text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
        } opacity-0 group-hover:opacity-100 focus:opacity-100`}
        aria-label="Edit folder"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel card — same layout as before plus a tiny folder selector at the
// bottom right (visible on hover) for fast re-bucketing without opening
// the channel page.

function SubscriptionCard({
  channel: c, folders, globals,
}: { channel: Channel; folders: ChannelFolder[]; globals: GlobalSettings | undefined }) {
  const qc = useQueryClient();
  const effective = c.sync_interval_minutes ?? globals?.sync_interval_minutes ?? null;
  const next = effective ? nextSyncAt(c.last_synced, effective) : null;
  const currentFolder = folders.find((f) => f.id === c.folder_id) ?? null;

  const moveMut = useMutation({
    mutationFn: (folder_id: number | null) =>
      channelsApi.update(c.id, { folder_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["channels"] }),
  });

  return (
    <div className="group relative">
      <Link
        to={`/channel/${c.id}`}
        className="flex flex-col rounded-xl bg-zinc-900 p-4 hover:bg-zinc-800/70 transition-colors"
      >
        {/* Header: avatar + name + stats */}
        <div className="flex items-start gap-3">
          {c.thumbnail_url ? (
            <img
              src={c.thumbnail_url}
              alt=""
              referrerPolicy="no-referrer"
              className="h-12 w-12 flex-shrink-0 rounded-full object-cover bg-zinc-800"
            />
          ) : (
            <div className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full bg-zinc-800">
              <Tv className="h-5 w-5 text-zinc-500" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-zinc-100" title={c.name}>{c.name}</p>
            <p className="mt-0.5 text-xs text-zinc-400">
              {formatCount(c.subscriber_count)} subs ·{" "}
              <span className="text-zinc-200 font-medium">{c.video_count}</span> archived
            </p>
            {c.last_sync_error ? (
              <p className="mt-0.5 flex items-start gap-1 text-xs text-red-400">
                <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                <span className="line-clamp-1">{c.last_sync_error}</span>
              </p>
            ) : c.last_synced ? (
              <p className="mt-0.5 text-xs text-zinc-500">
                Sync {timeAgo(c.last_synced)}
                {c.last_sync_added_count != null && (
                  <> · {c.last_sync_added_count === 0 ? "ничего нового" : `+${c.last_sync_added_count}`}</>
                )}
                {next && <> · след. {timeUntil(next)}</>}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-zinc-500">Ещё не синкался</p>
            )}
          </div>
          {!c.show_on_home && (
            <span
              className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400"
              title="Hidden from Home"
            >
              hidden
            </span>
          )}
        </div>

        <hr className="my-3 border-zinc-800" />

        {/* Active settings */}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <SettingRow label="Policy"    value={describePolicy(c.download_policy, c.latest_count)} />
          <SettingRow label="Quality"   value={describeQuality(c.quality)} />
          <SettingRow label="Retention" value={describeRetention(c.retention_days)} />
          <SettingRow label="Sync"      value={describeInterval(c.sync_interval_minutes)} />
        </dl>
      </Link>

      {/* Folder selector — bottom-right of the card. Always shows current
       *  folder; tap opens a dropdown with all folders + Ungrouped. */}
      <FolderSelector
        current={currentFolder}
        folders={folders}
        onChange={(id) => moveMut.mutate(id)}
        disabled={moveMut.isPending}
      />
    </div>
  );
}

function FolderSelector({
  current, folders, onChange, disabled,
}: {
  current: ChannelFolder | null;
  folders: ChannelFolder[];
  onChange: (id: number | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="absolute bottom-3 right-3">
      <button
        onClick={(e) => { e.preventDefault(); setOpen((s) => !s); }}
        disabled={disabled}
        title={current ? `In folder: ${current.name}` : "Move to folder"}
        className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium ring-1 ring-zinc-700 hover:bg-zinc-800 ${
          current
            ? "bg-zinc-800/80 text-zinc-200"
            : "bg-zinc-900/80 text-zinc-500"
        } opacity-0 group-hover:opacity-100 focus:opacity-100 ${current ? "!opacity-100" : ""}`}
      >
        <Folder className="h-3 w-3" />
        <span className="max-w-[80px] truncate">{current?.name ?? "Ungrouped"}</span>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1 w-48 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
          <button
            onClick={(e) => { e.preventDefault(); onChange(null); setOpen(false); }}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-800 ${
              !current ? "text-zinc-100 font-medium" : "text-zinc-300"
            }`}
          >
            <Folder className="h-3.5 w-3.5 opacity-60" />
            Ungrouped
          </button>
          {folders.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-zinc-500">
              Создай папки выше: «New folder»
            </p>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                onClick={(e) => { e.preventDefault(); onChange(f.id); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-800 ${
                  current?.id === f.id ? "text-zinc-100 font-medium" : "text-zinc-300"
                }`}
              >
                <Folder className="h-3.5 w-3.5" />
                <span className="truncate flex-1">{f.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-200 truncate" title={value}>{value}</dd>
    </>
  );
}
