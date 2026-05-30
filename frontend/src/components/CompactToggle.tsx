import { Grid2x2, Square } from "lucide-react";
import { useLocalStorageBool } from "../hooks/useLocalStorageBool";

/** Storage key for the mobile "compact" preference. When ON, all video
 *  grids on phones render 2 columns instead of the default 1. Same key is
 *  read by VideoGrid + VirtualVideoGrid so the toggle is global. */
export const COMPACT_MOBILE_KEY = "ui.compact.mobile";

/** Mobile-only toggle button — shows in the TopBar so it's reachable from
 *  every page. */
export function CompactToggle() {
  const [compact, setCompact] = useLocalStorageBool(COMPACT_MOBILE_KEY, false);
  return (
    <button
      type="button"
      onClick={() => setCompact(!compact)}
      title={compact ? "Show one per row" : "Show two per row"}
      aria-label={compact ? "Switch to single column" : "Switch to compact grid"}
      aria-pressed={compact}
      className={`md:hidden rounded-full p-2 transition-colors ${
        compact
          ? "bg-gradient-to-b from-accent to-accent-strong text-accent-ink shadow-sm shadow-accent/30"
          : "text-zinc-300 hover:bg-zinc-800 active:bg-zinc-700"
      }`}
    >
      {compact ? <Grid2x2 className="h-5 w-5" /> : <Square className="h-5 w-5" />}
    </button>
  );
}
