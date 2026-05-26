import { Loader2, RefreshCw } from "lucide-react";

/** Fixed badge that floats below the top bar while the user pulls down or
 *  while a refresh is in flight. Visual language matches the player gesture
 *  toasts — small dark pill with one icon. The rotation while pulling makes
 *  the act of "winding up" feel kinetic, then it switches to a spinner
 *  during the refresh hold. */
export function PullToRefreshIndicator({
  progress, refreshing,
}: { progress: number; refreshing: boolean }) {
  if (progress <= 0 && !refreshing) return null;

  // ``progress`` is 0..1.5. Map to translation under the top bar so the pill
  // is fully off-screen when idle and reaches ~32px below the bar at p=1.
  const travel = Math.min(progress, 1.4) * 64 - 12;
  const opacity = Math.min(1, progress * 1.4 + (refreshing ? 1 : 0));
  const rotate = Math.min(progress, 1) * 320;
  const ready = progress >= 1;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center"
      style={{
        top:       "var(--header-safe-top)",
        transform: `translateY(${travel}px)`,
        opacity,
        transition: refreshing
          ? "transform 200ms cubic-bezier(.2,.8,.2,1)"
          : (progress === 0 ? "transform 280ms cubic-bezier(.2,.8,.2,1), opacity 220ms" : "none"),
      }}
    >
      <div
        className={`grid h-10 w-10 place-items-center rounded-full bg-zinc-900/95 backdrop-blur-sm shadow-xl ring-1 ${
          ready ? "ring-red-500/70" : "ring-zinc-700"
        }`}
      >
        {refreshing ? (
          <Loader2 className="h-4 w-4 animate-spin text-zinc-100" />
        ) : (
          <RefreshCw
            className={`h-4 w-4 ${ready ? "text-red-400" : "text-zinc-200"}`}
            style={{ transform: `rotate(${rotate}deg)` }}
          />
        )}
      </div>
    </div>
  );
}
