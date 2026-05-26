import { Inbox } from "lucide-react";
import type { Video } from "../lib/api";
import { VideoCard } from "./VideoCard";
import { VirtualVideoGrid } from "./VirtualVideoGrid";
import { useLocalStorageBool } from "../hooks/useLocalStorageBool";
import { COMPACT_MOBILE_KEY } from "./CompactToggle";

/** Above this count switch to a windowed virtual grid — keeps DOM cost
 *  flat regardless of how many videos are in the library. */
const VIRTUALIZE_THRESHOLD = 200;

export function VideoGrid({
  videos, isLoading, emptyTitle, emptyHint,
}: {
  videos: Video[];
  isLoading: boolean;
  emptyTitle: string;
  emptyHint: string;
}) {
  const [compact] = useLocalStorageBool(COMPACT_MOBILE_KEY, false);

  // Mobile column count = 2 when "compact" toggle is on, otherwise 1.
  const mobileCols  = compact ? 2 : 1;
  // Tablet-landscape (≥1024) gets one more column than before because the
  // sidebar is auto-collapsed below xl, freeing the room.
  const breakpoints = [
    { width:    0, cols: mobileCols },
    { width:  640, cols: 2 },
    { width: 1024, cols: 4 },
    { width: 1280, cols: 4 },
    { width: 1536, cols: 5 },
  ];
  // Tailwind class mirroring `breakpoints` for the non-virtualized path.
  const gridClass = compact
    ? "grid gap-x-3 gap-y-8 grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5"
    : "grid gap-x-4 gap-y-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5";

  if (isLoading) {
    return (
      <div className={gridClass}>
        {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }
  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Inbox className="h-12 w-12 text-zinc-700" />
        <h3 className="mt-4 text-lg font-semibold">{emptyTitle}</h3>
        <p className="mt-1 max-w-md text-sm text-zinc-400">{emptyHint}</p>
      </div>
    );
  }
  if (videos.length > VIRTUALIZE_THRESHOLD) {
    return (
      <VirtualVideoGrid
        items={videos}
        breakpoints={breakpoints}
        // No explicit rowHeight — VirtualVideoGrid auto-computes it from the
        // container width (aspect-video × cellW + ~textBelow). Way more
        // accurate than a single hardcoded number, which used to cause those
        // intermittent oversized gaps between rows.
        textBelow={95}               // VideoCard: title (2 lines) + avatar + date
        rowPad={32}                  // = gap-y-8 between virtual rows
        gapClass="gap-x-4"
        renderItem={(v) => <VideoCard video={v} />}
      />
    );
  }
  return (
    <div className={gridClass}>
      {videos.map((v) => <VideoCard key={v.id} video={v} />)}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse">
      <div className="aspect-video rounded-xl bg-zinc-900" />
      <div className="mt-3 space-y-2">
        <div className="h-4 w-3/4 rounded bg-zinc-900" />
        <div className="h-3 w-1/2 rounded bg-zinc-900" />
      </div>
    </div>
  );
}
