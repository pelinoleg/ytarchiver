import { NavLink } from "react-router-dom";
import { Home, ListMusic, Music, Star, FolderDown } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

/** YouTube-style bottom tab bar for phone & tablet portrait widths.
 *
 *  Visibility rules:
 *    • Hidden on ``xl`` and up — the desktop sidebar is permanent there and
 *      the bottom bar would be noise.
 *    • Hidden on ``/watch`` — the player is the whole screen on mobile
 *      (sticky-top + content below) and a fixed bottom bar competes with
 *      the auto-hiding player controls / MusicControlBar.
 *
 *  Style: each tab is a square tap target (56 px) with icon + tiny label.
 *  The active tab fills the icon and sits on a red dot indicator above the
 *  label — same visual language as YouTube mobile.
 *
 *  Safe-area inset is honored so the bar floats above the iOS home bar
 *  instead of hugging the OS chrome. */
export function BottomNav() {
  // Visible on every page including /watch — easy global navigation is
  // worth more than reclaiming 56 px of player-page real estate. The
  // sticky-top player + content stack + MusicControlBar coexist with
  // this bar via padding on ``main`` (Layout) and the WatchPage spacer.

  return (
    <nav
      // Compact 48-px bar (``--bottom-nav-h``) + iOS home-indicator inset.
      // Mini player & music control bar offset themselves by
      // ``--bottom-nav-safe`` so they sit cleanly above this.
      className="
        fixed bottom-0 left-0 right-0 z-40
        xl:hidden
        flex items-stretch justify-around
        bg-zinc-950/85 backdrop-blur-xl
        border-t border-white/5
      "
      style={{
        height: "var(--bottom-nav-safe)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      aria-label="Primary"
    >
      {/* Mirrors the sidebar's top primary nav — Home / Favorites /
       *  Playlists / Manual — so the user has the SAME shortcuts whether
       *  the sidebar is open or not. */}
      <Tab to="/"                 icon={Home}       label="Home" end />
      <Tab to="/favorites"        icon={Star}       label="Favs" end />
      <Tab to="/playlists"        icon={ListMusic}  label="Lists" />
      <Tab to="/manual"           icon={FolderDown} label="Manual" />

      {/* Music section — sits behind a divider so it never blends with
       *  the general nav above. */}
      <Tab to="/music"            icon={Music}      label="Music" divider end />
      <Tab to="/music/favorites"  icon={Star}       label="Liked" />
    </nav>
  );
}

function Tab({
  to, icon: Icon, label, end, divider,
}: {
  to: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  end?: boolean;
  /** Draw a thin vertical separator on the LEFT — used to group music
   *  tabs apart from the general navigation. */
  divider?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      // Monochrome white icons, semi-transparent when inactive and full
      // opacity when active. Identity comes from the icon shape and the
      // label, not from colour — keeps the bar visually calm.
      className={({ isActive }) =>
        `relative flex flex-1 min-w-0 flex-col items-center justify-center gap-1 transition-colors ${
          divider ? "border-l border-white/5" : ""
        } ${isActive ? "text-accent" : "text-white/55 hover:text-white/80"}`
      }
      aria-label={label}
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute top-0 h-0.5 w-7 rounded-full bg-accent" />}
          <Icon className="h-6 w-6" strokeWidth={isActive ? 2.4 : 1.8} />
          <span className={`text-[11px] leading-none ${isActive ? "font-semibold" : "font-medium"}`}>
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}
