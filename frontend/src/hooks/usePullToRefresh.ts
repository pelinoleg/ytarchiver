import { useEffect, useRef, useState } from "react";

/** Pull-to-refresh on touch devices, mimicking the iOS / YouTube feel.
 *
 *  • Engages only when the touch begins at the absolute top of scroll
 *    (the window OR the closest scrollable ancestor must be at scrollTop=0).
 *  • Uses a rubber-band easing past ``THRESHOLD``: the first 80 px maps 1:1
 *    to spinner travel, anything beyond scales down by 60% — that's why the
 *    indicator feels heavier the further you pull.
 *  • ``preventDefault`` on touchmove kills the native overscroll bounce so
 *    the indicator stays put. We only prevent when actively pulling, so
 *    normal scrolling is unaffected.
 *  • Calls ``onRefresh`` past the threshold and holds the spinner for
 *    ``HOLD_MS`` so the user gets clear feedback.
 *
 *  Returns:
 *    progress    — 0..1.5 normalized pull amount (over-pull goes above 1)
 *    refreshing  — true while ``onRefresh`` is pending + brief hold
 */
const THRESHOLD_PX = 80;
const HOLD_MS = 400;

export function usePullToRefresh({
  onRefresh, enabled = true,
}: {
  onRefresh: () => void | Promise<unknown>;
  enabled?: boolean;
}) {
  const [progress, setProgress] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Latest values exposed to the effect via a ref so we don't have to rebind
  // listeners on each state tick — that flickered on iOS Safari.
  const ref = useRef({
    enabled,
    refreshing,
    onRefresh,
    startY: 0,
    pulling: false,
    progress: 0,
    armed: false,
  });
  ref.current.enabled    = enabled;
  ref.current.refreshing = refreshing;
  ref.current.onRefresh  = onRefresh;

  useEffect(() => {
    function topOfScroll(target: EventTarget | null): boolean {
      if (window.scrollY > 0) return false;
      // Walk up from the touch target — if any closer scrollable ancestor is
      // already scrolled, the user is likely interacting with an inner list
      // and we should stay out of their way.
      let el = target as HTMLElement | null;
      while (el && el !== document.body) {
        const sy = el.scrollHeight - el.clientHeight;
        if (sy > 0) {
          const o = getComputedStyle(el).overflowY;
          if ((/(auto|scroll|overlay)/).test(o) && el.scrollTop > 0) return false;
        }
        el = el.parentElement;
      }
      return true;
    }

    function modalOpen(): boolean {
      // Any of our modal patterns counts: backdrop drawer (body locked) or
      // an explicit role=dialog / alertdialog mounted in the tree. Cheap
      // DOM query, runs only on touchstart.
      if (document.body.style.overflow === "hidden") return true;
      return !!document.querySelector('[role="dialog"], [role="alertdialog"]');
    }

    function startedOnPlayer(target: EventTarget | null): boolean {
      // Touches that begin on the <video> element are the player's swipe
      // gestures — never the page refresh. Without this, swiping down on
      // a sticky-top player would compete with the swipe-to-mini gesture
      // and the user gets jumbled behaviour.
      const el = target as HTMLElement | null;
      if (!el) return false;
      return !!el.closest("video, .custom-player");
    }

    function onTouchStart(e: TouchEvent) {
      const st = ref.current;
      if (!st.enabled || st.refreshing) return;
      if (e.touches.length !== 1) return;
      if (modalOpen()) return;
      if (startedOnPlayer(e.target)) return;
      if (!topOfScroll(e.target)) return;
      st.armed = true;
      st.startY = e.touches[0].clientY;
      st.pulling = false;
    }

    function onTouchMove(e: TouchEvent) {
      const st = ref.current;
      if (!st.armed) return;
      const dy = e.touches[0].clientY - st.startY;
      if (dy <= 0) return;
      // Cancel if the page actually scrolled (some inner element accepted
      // the touch and scrolled the page — unlikely at top, but guard).
      if (window.scrollY > 0) {
        st.armed = false; st.pulling = false; st.progress = 0;
        setProgress(0);
        return;
      }
      st.pulling = true;
      // Eased pull distance: linear up to THRESHOLD, then 40% beyond.
      const eased = dy <= THRESHOLD_PX ? dy : THRESHOLD_PX + (dy - THRESHOLD_PX) * 0.4;
      const p = Math.min(1.5, eased / THRESHOLD_PX);
      if (Math.abs(p - st.progress) > 0.01) {
        st.progress = p;
        setProgress(p);
      }
      // Kill native overscroll bounce while we're pulling.
      if (e.cancelable) e.preventDefault();
    }

    function onTouchEnd() {
      const st = ref.current;
      if (!st.armed) return;
      st.armed = false;
      if (!st.pulling) { st.progress = 0; setProgress(0); return; }
      st.pulling = false;
      const wasOver = st.progress >= 1;
      if (wasOver) {
        setRefreshing(true);
        setProgress(1);
        Promise.resolve(st.onRefresh()).finally(() => {
          setTimeout(() => {
            setRefreshing(false);
            st.progress = 0;
            setProgress(0);
          }, HOLD_MS);
        });
      } else {
        st.progress = 0;
        setProgress(0);
      }
    }

    document.addEventListener("touchstart",  onTouchStart,  { passive: true });
    document.addEventListener("touchmove",   onTouchMove,   { passive: false });
    document.addEventListener("touchend",    onTouchEnd);
    document.addEventListener("touchcancel", onTouchEnd);
    return () => {
      document.removeEventListener("touchstart",  onTouchStart);
      document.removeEventListener("touchmove",   onTouchMove);
      document.removeEventListener("touchend",    onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return { progress, refreshing };
}
