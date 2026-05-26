import { LayoutGrid, CalendarDays, Users } from "lucide-react";
import { useLocalStorageString } from "../hooks/useLocalStorageString";

export type HomeViewMode = "flat" | "date" | "channel";
export const HOME_VIEW_MODES: readonly HomeViewMode[] = ["flat", "date", "channel"] as const;
export const HOME_VIEW_KEY = "home.mode";

/** Compact toggle used both in the TopBar and as the source of truth for
 *  HomePage. State lives in localStorage; the hook gets updates from any
 *  component that writes (custom-event broadcast). */
export function HomeViewToggle() {
  const [mode, setMode] = useLocalStorageString<HomeViewMode>(HOME_VIEW_KEY, "flat", HOME_VIEW_MODES);
  return (
    <div className="inline-flex flex-shrink-0 rounded-full bg-zinc-900 p-0.5">
      <Btn active={mode === "flat"}    onClick={() => setMode("flat")}    icon={LayoutGrid}   title="Flat list" />
      <Btn active={mode === "date"}    onClick={() => setMode("date")}    icon={CalendarDays} title="Group by date" />
      <Btn active={mode === "channel"} onClick={() => setMode("channel")} icon={Users}        title="Group by channel" />
    </div>
  );
}

function Btn({
  active, onClick, icon: Icon, title,
}: { active: boolean; onClick: () => void; icon: typeof LayoutGrid; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`rounded-full p-1.5 ${
        active ? "bg-zinc-100 text-zinc-950" : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
