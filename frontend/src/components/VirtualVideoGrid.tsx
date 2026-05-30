import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { Video } from "../lib/api";

/** Window-scrolling virtual grid for arbitrarily large lists of videos.
 *
 *  Trade-offs vs a plain CSS grid:
 *    + Renders only the rows visible in the viewport (+/- overscan), so a
 *      music library of 5000 tracks stays smooth and the hover-preview
 *      timers don't pile up on hidden cards.
 *    + Uses the window's own scroll position — page scroll, sticky player,
 *      mini PiP and url anchors all keep working unchanged.
 *    – Cards must share the same approximate height; mixed heights still
 *      work, but estimateSize controls how accurate the scrollbar is until
 *      rows are measured.
 *
 *  Each row renders an N-column CSS grid; N adapts to container width via
 *  ResizeObserver, mirroring the regular Tailwind breakpoints. */
interface Props<T extends Video> {
  items: T[];
  /** Render one card. */
  renderItem: (item: T, index: number) => React.ReactNode;
  /** How many columns at each breakpoint width threshold. Defaults map to
   *  Tailwind's sm/lg/xl (640/1024/1280). */
  breakpoints?: { width: number; cols: number }[];
  /** Optional explicit estimate for a row in px. When omitted the grid
   *  computes it dynamically from the actual cell width — much more accurate
   *  than a single hardcoded number (which caused visible gaps on viewports
   *  where the real card was shorter or taller than the estimate). */
  rowHeight?: number;
  /** Tailwind gap class — applied between rows AND columns. */
  gapClass?: string;
  /** Extra fudge px added to estimated row height for stable scrolling
   *  before any row is measured. */
  rowPad?: number;
  /** Text/meta height under the card (title + channel rows). Used by the
   *  dynamic rowHeight formula: cell_width × 0.5625 + textBelow. */
  textBelow?: number;
  /** Target card width in px. When set, the column count at desktop widths
   *  (≥1024) is derived responsively from the container width instead of the
   *  fixed ``breakpoints`` — i.e. wider windows fit more columns, exactly like
   *  ``repeat(auto-fill, minmax(minCardWidth, 1fr))``. Narrow widths still use
   *  ``breakpoints`` (the 1/2-col mobile behaviour). */
  minCardWidth?: number;
}

const DEFAULT_BREAKPOINTS = [
  { width:    0, cols: 2 },
  { width:  640, cols: 3 },
  { width: 1024, cols: 4 },
  { width: 1280, cols: 5 },
];

export function VirtualVideoGrid<T extends Video>({
  items, renderItem,
  breakpoints = DEFAULT_BREAKPOINTS,
  rowHeight,
  gapClass = "gap-4",
  rowPad = 16,
  textBelow = 95,
  minCardWidth,
}: Props<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(2);
  // Auto-computed estimate based on actual cell width. Overridden by the
  // explicit ``rowHeight`` prop when provided.
  const [autoRowHeight, setAutoRowHeight] = useState(280);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Resolve column count AND row-height estimate from the container width.
  // Doing both in one observer keeps them in sync — when the viewport changes
  // or the sidebar slides out, cols and the estimated row both react together.
  useLayoutEffect(() => {
    const el = parentRef.current; if (!el) return;
    function recalc() {
      const w = el!.getBoundingClientRect().width;
      let chosen = breakpoints[0].cols;
      for (const b of breakpoints) {
        if (w >= b.width) chosen = b.cols;
      }
      // Desktop: derive columns from the target card width so the count
      // reflows with the window (denser slider → smaller target → more
      // columns at every width). Mirrors auto-fill minmax(minCardWidth,1fr).
      if (minCardWidth && w >= 1024) {
        const gap = 16;
        chosen = Math.max(1, Math.floor((w + gap) / (minCardWidth + gap)));
      }
      setCols(chosen);
      // Card = aspect-video image + ~textBelow px of meta text. Subtract a
      // 16-px gap allowance per inter-cell gap to size the cell width.
      const cellW = (w - 16 * (chosen - 1)) / chosen;
      const estimated = Math.ceil(cellW * 0.5625 + textBelow);
      setAutoRowHeight(Math.max(180, estimated));
    }
    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [breakpoints, textBelow, minCardWidth]);

  // The virtualizer is window-scroll-based, so it needs the grid's offset
  // within the page to translate row positions correctly.
  useLayoutEffect(() => {
    const el = parentRef.current; if (!el) return;
    function syncMargin() {
      setScrollMargin(el!.offsetTop);
    }
    syncMargin();
    const ro = new ResizeObserver(syncMargin);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  const rowCount = Math.ceil(items.length / cols);
  const effectiveRowHeight = rowHeight ?? autoRowHeight;

  const virt = useWindowVirtualizer({
    count:        rowCount,
    estimateSize: () => effectiveRowHeight + rowPad,
    overscan:     3,
    scrollMargin,
  });

  // Re-measure when the layout drivers change so the virtualizer reapplies
  // the new estimate to any not-yet-rendered rows.
  useEffect(() => {
    virt.measure();
  }, [cols, effectiveRowHeight, items.length, virt]);

  // Memoize the per-row index slices to keep render minimal.
  const virtualRows = virt.getVirtualItems();
  const rowSlices = useMemo(
    () => virtualRows.map((row) => {
      const start = row.index * cols;
      return { row, slice: items.slice(start, start + cols) };
    }),
    [virtualRows, items, cols],
  );

  return (
    <div ref={parentRef} className="relative w-full" style={{ height: `${virt.getTotalSize()}px` }}>
      {rowSlices.map(({ row, slice }) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virt.measureElement}
          className="absolute left-0 right-0"
          style={{
            transform:     `translateY(${row.start - virt.options.scrollMargin}px)`,
            // ``rowPad`` becomes real padding-bottom on the row, so
            // measureElement records it as part of the row height — that's
            // how virtual rows visually space themselves (CSS gap-y can't
            // do this since rows are absolutely positioned).
            paddingBottom: `${rowPad}px`,
          }}
        >
          <div
            className={`grid ${gapClass}`}
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {slice.map((item, i) => (
              // ``min-w-0`` lets the cell shrink below its intrinsic
              // content width so the inner card's truncate / line-clamp
              // can actually do their job on long channel names.
              <div key={item.id} className="min-w-0">
                {renderItem(item, row.index * cols + i)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
