import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Video } from "../lib/api";

/** Mini-player state lifted out of WatchPage so it survives route changes.
 *
 *  WatchPage pushes `{video, currentTime, wasPlaying, queueParams}` into
 *  this context right before unmounting (only if playback is in-flight).
 *  The MiniPlayer component (rendered in Layout) reads from here and keeps
 *  audio going — same `src`, restored `currentTime` — until the user either
 *  expands back to /watch or closes the mini.
 *
 *  Trade-off: this isn't the same ``<video>`` DOM element, so there's a tiny
 *  buffering blip on transition. Sharing the element across a portal is
 *  possible but multiplies complexity — for solo / local use the brief cut
 *  is fine.
 */

export interface MiniPlayerSource {
  /** Reconstructs the WatchPage URL — playlist / music / shuffle context. */
  playlistId?: number | null;
  isMusicSource?: boolean;
  isShuffled?:    boolean;
}

export interface MiniPlayerState {
  video:       Video;
  currentTime: number;
  wasPlaying:  boolean;
  source:      MiniPlayerSource;
}

export interface MiniPlayerContextValue {
  state:   MiniPlayerState | null;
  open:    (s: MiniPlayerState) => void;
  /** Called from WatchPage on mount — clears mini because we're now full-screen
   *  on this exact video. If the mini is showing a different video we keep it. */
  takeOver: (videoId: string) => void;
  close:   () => void;
}

const MiniPlayerContext = createContext<MiniPlayerContextValue | null>(null);

export function MiniPlayerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MiniPlayerState | null>(null);

  const open  = useCallback((s: MiniPlayerState) => setState(s), []);
  const close = useCallback(() => setState(null), []);
  // Whenever a /watch page mounts, clear the mini — the page IS the player
  // now, mini state is no longer "active". WatchPage's unmount-cleanup
  // re-opens mini for the just-watched video if there was meaningful
  // playback, so the mini always reflects the most recent session. (Before
  // this, mini would stay on song A while you watched video B briefly and
  // returned to Home — confusing.) videoId is no longer used but kept for
  // API parity with prior callers.
  const takeOver = useCallback((_videoId: string) => {
    setState(null);
  }, []);

  const value = useMemo<MiniPlayerContextValue>(() => ({
    state, open, takeOver, close,
  }), [state, open, takeOver, close]);

  return (
    <MiniPlayerContext.Provider value={value}>
      {children}
    </MiniPlayerContext.Provider>
  );
}

export function useMiniPlayer(): MiniPlayerContextValue {
  const ctx = useContext(MiniPlayerContext);
  if (!ctx) throw new Error("useMiniPlayer must be used inside <MiniPlayerProvider>");
  return ctx;
}
