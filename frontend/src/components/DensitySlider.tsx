import { Square, Grid3x3 } from "lucide-react";
import { useLocalStorageNumber } from "../hooks/useLocalStorageNumber";

/** Storage key for the desktop grid density (columns at ≥lg widths). Read by
 *  VideoGrid / VirtualVideoGrid / MusicPage so the slider is global. More
 *  columns ⇒ smaller cards. Cards stay fluid (1fr), so narrowing the window
 *  shrinks them proportionally without changing the column count. */
export const GRID_DESKTOP_COLS_KEY = "ui.grid.desktopCols";
export const GRID_COLS_MIN = 3;
export const GRID_COLS_MAX = 8;
export const GRID_COLS_DEFAULT = 5;

/** Reusable hook so every grid reads the same value. */
export function useDesktopCols() {
  return useLocalStorageNumber(GRID_DESKTOP_COLS_KEY, GRID_COLS_DEFAULT, GRID_COLS_MIN, GRID_COLS_MAX);
}

/** Desktop-only card-size slider. Hidden below lg — phones/tablets use the
 *  compact toggle instead. Left = bigger cards (fewer columns), right =
 *  smaller (more columns). */
export function DensitySlider() {
  const [cols, setCols] = useDesktopCols();
  return (
    <div
      className="hidden lg:flex items-center gap-2 rounded-full bg-zinc-900 px-2.5 py-1"
      title={`Размер карточек — ${cols} в ряд (на широком экране)`}
    >
      <Square className="h-4 w-4 flex-shrink-0 text-zinc-500" aria-hidden />
      <input
        type="range"
        min={GRID_COLS_MIN}
        max={GRID_COLS_MAX}
        step={1}
        value={cols}
        onChange={(e) => setCols(Number(e.target.value))}
        aria-label="Размер карточек на десктопе"
        className="density-range h-1 w-24 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-zinc-100"
      />
      <Grid3x3 className="h-4 w-4 flex-shrink-0 text-zinc-500" aria-hidden />
    </div>
  );
}
