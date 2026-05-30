import { Inbox } from "lucide-react";
import type { CSSProperties } from "react";
import type { Video } from "../lib/api";
import { VideoCard } from "./VideoCard";
import { VirtualVideoGrid } from "./VirtualVideoGrid";
import { useLocalStorageBool } from "../hooks/useLocalStorageBool";
import { COMPACT_MOBILE_KEY } from "./CompactToggle";
import { useCardMin } from "./DensitySlider";

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
  // Desktop grid density — the slider sets a *target card width*; the column
  // count is derived responsively from the container so wider windows fit more
  // columns at the same density. Mobile/tablet keep the fixed 1/2-col layout.
  const [cardMin] = useCardMin();

  // Mobile column count = 2 when "compact" toggle is on, otherwise 1.
  const mobileCols  = compact ? 2 : 1;
  // Fixed breakpoints only matter below lg; the virtual grid derives desktop
  // columns from ``cardMin`` (via the minCardWidth prop) instead.
  const breakpoints = [
    { width:    0, cols: mobileCols },
    { width:  640, cols: 2 },
  ];
  // Non-virtualized path: auto-fill minmax(card-min, 1fr) at ≥lg reflows the
  // column count with the window while keeping cards fluid.
  const desktopGrid = "lg:[grid-template-columns:repeat(auto-fill,minmax(var(--card-min),1fr))]";
  const gridClass = compact
    ? `grid gap-x-3 gap-y-8 grid-cols-2 sm:grid-cols-2 ${desktopGrid}`
    : `grid gap-x-4 gap-y-8 grid-cols-1 sm:grid-cols-2 ${desktopGrid}`;
  const gridStyle = { "--card-min": `${cardMin}px` } as CSSProperties;

  if (isLoading) {
    return (
      <div className={gridClass} style={gridStyle}>
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
        minCardWidth={cardMin}
        renderItem={(v) => <VideoCard video={v} />}
      />
    );
  }
  return (
    <div className={gridClass} style={gridStyle}>
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
