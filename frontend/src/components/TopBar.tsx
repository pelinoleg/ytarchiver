import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import {
  Menu, Search, Plus, Download, Settings, Tv, ListMusic, ChevronDown,
} from "lucide-react";
import { HomeViewToggle } from "./HomeViewToggle";
import { CompactToggle } from "./CompactToggle";
import { DensitySlider } from "./DensitySlider";

interface TopBarProps {
  onAddChannel: () => void;
  onAddPlaylist: () => void;
  onAddSearch: () => void;
  onAddVideo: () => void;
  onMenuClick: () => void;
}

export function TopBar({
  onAddChannel, onAddPlaylist, onAddSearch, onAddVideo, onMenuClick,
}: TopBarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get("q") ?? "");

  useEffect(() => {
    if (location.pathname === "/search") setQ(searchParams.get("q") ?? "");
    else if (q && location.pathname !== "/search") setQ("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, searchParams]);

  const onHome = location.pathname === "/";

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center gap-2 bg-zinc-950/70 backdrop-blur-xl px-2 md:px-3 shadow-[0_6px_20px_-16px_rgba(0,0,0,0.7)]"
      style={{
        // iOS standalone: extend the header background up under the status bar
        // and push controls below the notch.
        paddingTop:  "env(safe-area-inset-top)",
        paddingLeft: "max(0.5rem, env(safe-area-inset-left))",
        paddingRight:"max(0.5rem, env(safe-area-inset-right))",
        height: "var(--header-safe-top)",
      }}
    >
      {/* Left group: hamburger first on phone (logo is dropped — Home tab
       *  lives in the BottomNav). On desktop the logo aligns with the
       *  sidebar columns and is the canonical "back to Home" affordance. */}
      <div className="flex items-center gap-2 md:gap-3">
        <button
          onClick={onMenuClick}
          // Bigger tap target on phone (h-6 icon + p-2.5 = 44 × 44 px,
          // matches Apple HIG min). Slightly tighter on xl where it's
          // hidden anyway, but kept consistent for tablet.
          className="xl:hidden rounded-full p-2.5 hover:bg-zinc-800 active:bg-zinc-700"
          aria-label="Toggle menu"
        >
          <Menu className="h-6 w-6" />
        </button>

        <Link
          to="/"
          onClick={(e) => {
            if (location.pathname === "/") {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
          aria-label="Home"
          // ``hidden md:flex`` — phone hides the logo entirely, freeing
          // top-bar real estate for search. md+ shows the full mark
          // (icon + wordmark) and aligns with the sidebar column.
          className="hidden md:flex items-center gap-2 rounded-lg p-1 md:px-3 md:ml-1 hover:bg-zinc-800/60 active:bg-zinc-800 text-lg font-semibold tracking-tight"
        >
          <span className="h-6 w-6 rounded bg-red-600 grid place-items-center flex-shrink-0">
            <span className="block h-0 w-0 border-y-[5px] border-y-transparent border-l-[8px] border-l-white ml-0.5" />
          </span>
          <span>YT Archive</span>
        </Link>
      </div>

      {/* Center: search bar — centered between left group and right group on desktop. */}
      <div className="hidden sm:flex flex-1 justify-center mx-4 md:mx-8 lg:mx-12">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = q.trim();
            if (trimmed) navigate(`/search?q=${encodeURIComponent(trimmed)}`);
          }}
          className="flex w-full max-w-2xl"
        >
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, description, channel, chapters…"
            className="flex-1 min-w-0 rounded-l-full border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm placeholder:text-zinc-500 focus:border-zinc-600"
          />
          <button
            type="submit"
            className="rounded-r-full border border-l-0 border-zinc-800 bg-zinc-800 px-5 hover:bg-zinc-700"
            aria-label="Search"
          >
            <Search className="h-5 w-5" />
          </button>
        </form>
      </div>

      {/* Right group: search-icon (mobile), home toggle (only on /), add
          menu, settings. Generous spacing on phone too so items don't
          crowd each other under the user's thumb. */}
      <div className="ml-auto sm:ml-0 flex items-center gap-2.5 sm:gap-3 md:gap-4">
        <button
          onClick={() => navigate("/search")}
          className="sm:hidden rounded-full p-2.5 hover:bg-zinc-800 active:bg-zinc-700"
          aria-label="Search"
        >
          <Search className="h-6 w-6" />
        </button>

        {/* Mobile-only: compact toggle for all thumbnail grids. */}
        <CompactToggle />

        {/* Desktop-only: card-size slider for all thumbnail grids. */}
        <DensitySlider />

        {onHome && <HomeViewToggle />}

        <AddMenu
          onAddChannel={onAddChannel}
          onAddPlaylist={onAddPlaylist}
          onAddSearch={onAddSearch}
          onAddVideo={onAddVideo}
        />

        <button
          onClick={() => navigate("/settings")}
          className="rounded-full p-2.5 hover:bg-zinc-800 active:bg-zinc-700"
          aria-label="Settings"
        >
          <Settings className="h-6 w-6 sm:h-5 sm:w-5" />
        </button>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AddMenu({
  onAddChannel, onAddPlaylist, onAddSearch, onAddVideo,
}: Omit<TopBarProps, "onMenuClick">) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(fn: () => void) {
    fn();
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((s) => !s)}
        className="flex items-center gap-1.5 rounded-full bg-gradient-to-b from-accent to-accent-strong p-2 text-accent-ink shadow-sm shadow-accent/30 hover:-translate-y-0.5 hover:shadow-md hover:shadow-accent/40 sm:px-4 sm:py-1.5 text-sm font-semibold"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Add new"
      >
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">Add</span>
        <ChevronDown className="hidden sm:block h-3.5 w-3.5 opacity-70" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-64 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-xl"
        >
          <MenuRow
            icon={<Tv        className="h-4 w-4" />}
            title="Channel"
            hint="Подписка на канал с авто-синком новых видео"
            onClick={() => pick(onAddChannel)}
          />
          <MenuRow
            icon={<ListMusic className="h-4 w-4" />}
            title="Playlist"
            hint="YouTube-плейлист целиком, отдельно от Home"
            onClick={() => pick(onAddPlaylist)}
          />
          <MenuRow
            icon={<Search    className="h-4 w-4" />}
            title="Search collection"
            hint="Top-N результатов YouTube-поиска"
            onClick={() => pick(onAddSearch)}
          />
          <div className="h-px bg-zinc-800" />
          <MenuRow
            icon={<Download  className="h-4 w-4" />}
            title="Single video"
            hint="Скачать один ролик по URL"
            onClick={() => pick(onAddVideo)}
          />
        </div>
      )}
    </div>
  );
}

function MenuRow({
  icon, title, hint, onClick,
}: { icon: React.ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-zinc-800"
    >
      <span className="mt-0.5 text-zinc-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-zinc-100">{title}</span>
        <span className="block text-xs text-zinc-500 leading-snug">{hint}</span>
      </span>
    </button>
  );
}
