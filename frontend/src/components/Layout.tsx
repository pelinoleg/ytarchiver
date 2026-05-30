import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { AddChannelModal } from "./AddChannelModal";
import { AddPlaylistModal } from "./AddPlaylistModal";
import { ManualDownloadModal } from "./ManualDownloadModal";
import { SelectionBar } from "./SelectionBar";
import { MiniPlayer } from "./MiniPlayer";
import { PullToRefreshIndicator } from "./PullToRefreshIndicator";
import { BottomNav } from "./BottomNav";
import { InstallBanner } from "./InstallBanner";
import { useDownloadProgress } from "../hooks/useDownloadProgress";
import { usePullToRefresh } from "../hooks/usePullToRefresh";

export function Layout() {
  useDownloadProgress();
  const [addOpen,    setAddOpen]      = useState(false);
  const [dlOpen,     setDlOpen]       = useState(false);
  const [plOpen,     setPlOpen]       = useState(false);
  const [plMode,     setPlMode]       = useState<"url" | "search">("url");
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const location = useLocation();
  const qc = useQueryClient();

  // Pull-to-refresh: enabled on every page EXCEPT /watch (the player owns
  // touch gestures there). Refresh = invalidate every active query — TQ
  // re-fetches whichever ones are mounted.
  const onWatch = location.pathname.startsWith("/watch/");
  const pull = usePullToRefresh({
    enabled: !onWatch,
    onRefresh: () => qc.invalidateQueries(),
  });

  // Close the mobile drawer on navigation.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Prevent body scroll when the drawer is open on mobile.
  useEffect(() => {
    if (drawerOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [drawerOpen]);

  return (
    // No bg here — the body is the opaque canvas, so the fixed bloom layer
    // below (-z-10) actually shows through instead of being painted over by an
    // opaque root background.
    <div className="min-h-screen text-zinc-100">
      {/* Ambient apricot bloom — one full-viewport, fixed layer behind
          everything (incl. the translucent top bar / sidebar) so the glow
          reads continuously instead of seaming against solid chrome. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1000px 540px at 50% -20px, color-mix(in oklab, var(--color-accent) 26%, transparent), transparent 55%)," +
            "radial-gradient(720px 520px at 106% 4%, color-mix(in oklab, var(--color-accent) 16%, transparent), transparent 52%)",
        }}
      />
      <TopBar
        onAddChannel ={() => setAddOpen(true)}
        onAddPlaylist={() => { setPlMode("url");    setPlOpen(true); }}
        onAddSearch  ={() => { setPlMode("search"); setPlOpen(true); }}
        onAddVideo   ={() => setDlOpen(true)}
        onMenuClick  ={() => setDrawerOpen((s) => !s)}
      />
      <Sidebar open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <main
        // Padding-bottom = ``--bottom-nav-safe`` so content scroll never
        // hides under the fixed bar (or its iOS home-indicator inset).
        // Reset to 0 on xl where the bottom nav disappears.
        //
        // NOTE: do NOT put ``overflow-x: hidden`` here. Making <main> a
        // scroll container double-counts the page's padding-top inside the
        // sticky player's ``top: --header-safe-top`` offset, pushing the
        // player a header-height down from where it should sit. The
        // horizontal-blowout safety lives on <html> in index.css instead.
        className="ml-0 xl:ml-70 min-h-screen safe-bottom xl:pb-0"
        style={{
          paddingBottom: "var(--bottom-nav-safe)",
          paddingTop: "var(--header-safe-top)",
          // Drag the entire content down while the user is pulling. CRITICAL
          // detail: when NOT pulling, ``transform`` must be ``undefined``,
          // not ``translate3d(0,0,0)`` — any transform (even identity)
          // turns this element into a containing block for fixed-positioned
          // descendants, breaking MusicControlBar / mini player anchoring
          // to the viewport. We accept losing the "warm GPU layer" between
          // pulls; the brief layer creation on first pull is invisible.
          transform:
            pull.refreshing || pull.progress > 0
              ? `translate3d(0, ${Math.min(pull.progress, 1.4) * 64}px, 0)`
              : undefined,
          transition:
            pull.refreshing
              ? "transform 220ms cubic-bezier(.2,.8,.2,1)"
              : pull.progress === 0
                ? "transform 320ms cubic-bezier(.2,.8,.2,1)"
                : "none",
        }}
      >
        <div className="p-4 md:p-6">
          <Outlet />
        </div>
      </main>
      {addOpen && <AddChannelModal     onClose={() => setAddOpen(false)} />}
      {dlOpen  && <ManualDownloadModal onClose={() => setDlOpen(false)} />}
      {plOpen  && <AddPlaylistModal    onClose={() => setPlOpen(false)} initialMode={plMode} />}
      <SelectionBar />
      <MiniPlayer />
      <PullToRefreshIndicator progress={pull.progress} refreshing={pull.refreshing} />
      <BottomNav />
      <InstallBanner />
    </div>
  );
}
