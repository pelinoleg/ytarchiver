import { Cpu, HardDrive } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { storageApi, type Sensors } from "../lib/api";

/** Shared CPU + disk temperature widget. Polls /api/storage/sensors every
 *  60s; each chip tints green→amber→red as it warms and a missing reading
 *  hides that chip (so it silently no-ops when the disk temp isn't wired up). */

export function useSensors() {
  return useQuery({
    queryKey: ["storage", "sensors"],
    queryFn: storageApi.sensors,
    refetchInterval: 60_000,
  });
}

const tone = (v: number, warn: number, hot: number) =>
  v >= hot  ? "border-red-500/40 bg-red-500/10 text-red-300"
: v >= warn ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
:             "border-zinc-700/70 bg-zinc-900/60 text-zinc-300";

function chipsFor(sensors?: Sensors) {
  if (!sensors) return [];
  return [
    { key: "cpu",  Icon: Cpu,       label: "CPU",  val: sensors.cpu_temp,  warn: 75, hot: 82 },
    { key: "disk", Icon: HardDrive, label: "Disk", val: sensors.disk_temp, warn: 55, hot: 65 },
  ].filter((c) => c.val != null) as { key: string; Icon: typeof Cpu; label: string; val: number; warn: number; hot: number }[];
}

/** Bordered pill chips — used in the Storage page header. */
export function TempChips({ sensors, className = "" }: { sensors?: Sensors; className?: string }) {
  const chips = chipsFor(sensors);
  if (chips.length === 0) return null;
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {chips.map(({ key, Icon, label, val, warn, hot }) => (
        <span
          key={key}
          title={`${label} temperature`}
          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium tabular-nums ${tone(val, warn, hot)}`}
        >
          <Icon className="h-3.5 w-3.5 opacity-80" />
          {Math.round(val)}°
        </span>
      ))}
    </div>
  );
}

/** Tiny inline temps (icon + value, no border) — for the cramped sidebar
 *  Library block. Same green→amber→red coloring, just the text. */
export function TempInline({ sensors, className = "" }: { sensors?: Sensors; className?: string }) {
  const chips = chipsFor(sensors);
  if (chips.length === 0) return null;
  return (
    <div className={`flex items-center gap-2 tabular-nums ${className}`}>
      {chips.map(({ key, Icon, label, val, warn, hot }) => (
        <span key={key} title={`${label} temperature`} className={`inline-flex items-center gap-0.5 ${tone(val, warn, hot).split(" ").pop()}`}>
          <Icon className="h-3 w-3 opacity-70" />
          {Math.round(val)}°
        </span>
      ))}
    </div>
  );
}
