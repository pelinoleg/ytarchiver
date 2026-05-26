import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Folder, Inbox, Tv } from "lucide-react";
import { videosApi, channelsApi, channelFoldersApi } from "../lib/api";
import { VideoGrid } from "../components/VideoGrid";

/** Per-folder feed: shows ready-to-watch videos from every channel in the
 *  folder. Uses the same VideoGrid as Home so cards behave identically
 *  (hover preview, menus, virtualization at scale). */
export function FolderPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const fid = folderId ? Number(folderId) : null;

  const { data: folders = [] } = useQuery({
    queryKey: ["channel-folders"],
    queryFn:  channelFoldersApi.list,
  });
  const folder = folders.find((f) => f.id === fid) ?? null;

  const { data: channels = [] } = useQuery({
    queryKey: ["channels"],
    queryFn:  channelsApi.list,
  });
  const folderChannels = channels.filter((c) => c.folder_id === fid);

  const { data: videos = [], isLoading } = useQuery({
    queryKey: ["videos", "folder", fid],
    queryFn:  () => videosApi.list({ folder_id: fid ?? undefined, limit: 200 }),
    enabled:  !!fid,
  });

  if (!fid) return null;

  return (
    <>
      {/* Compact header: single row with folder icon, name, counters.
       *  Channel chips strip wraps directly below. No background card —
       *  hero was overkill for a sidebar shortcut. */}
      <header className="mb-5">
        <div className="flex items-baseline gap-2.5">
          <Folder className="h-5 w-5 self-center text-zinc-500" />
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-100">
            {folder?.name ?? "—"}
          </h1>
          <span className="text-xs tabular-nums text-zinc-500">
            {folderChannels.length} ch · {videos.length} vids
          </span>
        </div>
        {folderChannels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {folderChannels.map((c) => (
              <Link
                key={c.id}
                to={`/channel/${c.id}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 ring-1 ring-zinc-800 px-2.5 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
              >
                {c.thumbnail_url ? (
                  <img
                    src={c.thumbnail_url}
                    referrerPolicy="no-referrer"
                    alt=""
                    className="h-4 w-4 rounded-full object-cover"
                  />
                ) : (
                  <Tv className="h-3 w-3 text-zinc-500" />
                )}
                <span className="truncate max-w-[9rem]">{c.name}</span>
              </Link>
            ))}
          </div>
        )}
      </header>

      {folderChannels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Inbox className="h-12 w-12 text-zinc-700" />
          <h3 className="mt-4 text-lg font-semibold">Папка пустая</h3>
          <p className="mt-1 max-w-md text-sm text-zinc-400">
            Перенеси каналы сюда из{" "}
            <Link to="/subscriptions" className="text-zinc-200 hover:underline">Subscriptions</Link>{" "}
            — fold-chip на карточке канала.
          </p>
        </div>
      ) : (
        <VideoGrid
          videos={videos}
          isLoading={isLoading}
          emptyTitle="Пока ничего"
          emptyHint="Каналы в папке есть, но видео ещё не скачались."
        />
      )}
    </>
  );
}
