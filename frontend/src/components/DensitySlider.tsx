import { Grid3x3, Square } from "lucide-react";
import { useLocalStorageNumber } from "../hooks/useLocalStorageNumber";

/** Storage key for desktop grid density. Stores the *target card width* in px,
 *  NOT a fixed column count — the grid uses
 *  ``repeat(auto-fill, minmax(var(--card-min), 1fr))`` at ≥lg, so the column
 *  count stays responsive to the window width. Smaller target = denser (more
 *  columns at every width); a wider window still fits more than a narrow one. */
export const GRID_CARD_MIN_KEY = "ui.grid.cardMinPx";
export const CARD_MIN = 150;   // densest — smallest cards
export const CARD_MAX = 320;   // largest cards
export const CARD_DEFAULT = 200;
const STEP = 10;

/** Shared hook so every grid reads the same target card width. */
export function useCardMin() {
  return useLocalStorageNumber(GRID_CARD_MIN_KEY, CARD_DEFAULT, CARD_MIN, CARD_MAX);
}

/** Desktop-only density slider. Hidden below lg — phones/tablets use the
 *  compact toggle. Left = denser/smaller cards, right = larger. The actual
 *  columns-per-row follow the window width, so resizing keeps reflowing. */
export function DensitySlider() {
  const [cardMin, setCardMin] = useCardMin();
  // Range slider feels natural as "size" (left small, right big). We store the
  // card width directly, so just bind it.
  return (
    <div
      className="hidden lg:flex items-center gap-2 rounded-full bg-zinc-900 px-2.5 py-1"
      title="Плотность сетки — размер карточек на десктопе (число в ряд подстраивается под ширину)"
    >
      <Grid3x3 className="h-4 w-4 flex-shrink-0 text-zinc-500" aria-hidden />
      <input
        type="range"
        min={CARD_MIN}
        max={CARD_MAX}
        step={STEP}
        value={cardMin}
        onChange={(e) => setCardMin(Number(e.target.value))}
        aria-label="Размер карточек на десктопе"
        className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-zinc-100"
      />
      <Square className="h-4 w-4 flex-shrink-0 text-zinc-500" aria-hidden />
    </div>
  );
}
