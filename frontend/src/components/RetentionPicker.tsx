import { useState } from "react";

type Mode = "default" | "forever" | "days";

/** Three-way retention control. ``value``:
 *  - ``null``  → use global default
 *  - ``0``     → keep forever
 *  - ``N > 0`` → delete after N days
 */
export function RetentionPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const mode: Mode = value == null ? "default" : value === 0 ? "forever" : "days";
  const [days, setDays] = useState(value && value > 0 ? value : 30);

  function pick(m: Mode) {
    if (m === "default") onChange(null);
    else if (m === "forever") onChange(0);
    else onChange(days);
  }

  return (
    <div className="space-y-1.5 text-sm">
      <label className="flex cursor-pointer items-center gap-2">
        <input type="radio" checked={mode === "default"} onChange={() => pick("default")} className="accent-zinc-100" />
        <span>Use global default</span>
      </label>
      <label className="flex cursor-pointer items-center gap-2">
        <input type="radio" checked={mode === "forever"} onChange={() => pick("forever")} className="accent-zinc-100" />
        <span>Keep forever</span>
      </label>
      <div className="flex items-center gap-2">
        <input
          type="radio"
          checked={mode === "days"}
          onChange={() => pick("days")}
          className="accent-zinc-100"
        />
        <span>Delete after</span>
        <input
          type="number" min={1}
          value={days}
          onClick={() => pick("days")}
          onChange={(e) => {
            const n = Math.max(1, Number(e.target.value) || 1);
            setDays(n);
            onChange(n);
          }}
          className="w-20 rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm focus:border-zinc-600"
        />
        <span>days</span>
      </div>
    </div>
  );
}
