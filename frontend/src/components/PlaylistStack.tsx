import { ReactNode } from "react";

/** Reusable "this is a collection of things" visual: two thin layered
 *  planes peek above the main cover so the card visually reads as a
 *  stack of cards (Apple Music / Spotify playlist tiles). Use as a
 *  wrapper around any aspect-video / aspect-square cover.
 *
 *  Pass an ``accent`` class (e.g. ``"bg-fuchsia-500/30"``) to tint the
 *  stack — useful when the card has its own colour identity (music =
 *  fuchsia, favourites = yellow). Default is a neutral zinc.
 */
export function PlaylistStack({
  accent = "bg-zinc-700/80",
  accentSoft = "bg-zinc-800/60",
  children,
  className = "",
}: {
  accent?: string;
  accentSoft?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`group/stack relative pt-2.5 ${className}`}>
      {/* Two stacked "pages" peek above the cover. Slight inset on each
       *  level reads as receding depth. Subtle slide-up on parent hover. */}
      <div
        className={`pointer-events-none absolute top-0 left-3 right-3 h-2 rounded-t-md ${accentSoft} transition-transform duration-300 group-hover/stack:-translate-y-0.5`}
      />
      <div
        className={`pointer-events-none absolute top-1 left-1.5 right-1.5 h-2 rounded-t-md ${accent} transition-transform duration-300`}
      />
      {/* Main cover sits on top of the stack and clips its own contents. */}
      <div className="relative">{children}</div>
    </div>
  );
}
