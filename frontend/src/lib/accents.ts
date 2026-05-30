/** Swappable accent presets. Each maps to the three accent CSS vars the whole
 *  app is built on (`--color-accent`, `--color-accent-strong`,
 *  `--color-accent-ink`). Changing the preset overrides those vars on :root at
 *  runtime, so every accent surface (pills, active nav, glows, play button…)
 *  recolors instantly — no rebuild. */
export interface Accent {
  id: string;
  name: string;
  accent: string;   // mid tone — fills, text-accent, glows
  strong: string;   // deeper — gradient bottom + hover
  ink: string;      // dark text that sits ON an accent fill
}

export const ACCENTS: Accent[] = [
  { id: "apricot",   name: "Apricot",   accent: "#efb37e", strong: "#e89f57", ink: "#271a0a" },
  { id: "amber",     name: "Amber",     accent: "#fbbf24", strong: "#f59e0b", ink: "#2a1c00" },
  { id: "gold",      name: "Gold",      accent: "#e6cb91", strong: "#d4af6a", ink: "#271f0a" },
  { id: "orange",    name: "Orange",    accent: "#fb923c", strong: "#f97316", ink: "#2a1402" },
  { id: "coral",     name: "Coral",     accent: "#fb7185", strong: "#f43f5e", ink: "#2c0a12" },
  { id: "rose",      name: "Rose",      accent: "#f472b6", strong: "#ec4899", ink: "#2c0a1d" },
  { id: "fuchsia",   name: "Fuchsia",   accent: "#e879f9", strong: "#d946ef", ink: "#2a0a2e" },
  { id: "violet",    name: "Violet",    accent: "#a78bfa", strong: "#8b5cf6", ink: "#170a2c" },
  { id: "indigo",    name: "Indigo",    accent: "#818cf8", strong: "#6366f1", ink: "#0c0e2c" },
  { id: "blue",      name: "Blue",      accent: "#60a5fa", strong: "#3b82f6", ink: "#06142c" },
  { id: "sky",       name: "Sky",       accent: "#38bdf8", strong: "#0ea5e9", ink: "#04202e" },
  { id: "cyan",      name: "Cyan",      accent: "#22d3ee", strong: "#06b6d4", ink: "#042227" },
  { id: "teal",      name: "Teal",      accent: "#2dd4bf", strong: "#14b8a6", ink: "#04221d" },
  { id: "emerald",   name: "Emerald",   accent: "#34d399", strong: "#10b981", ink: "#04221a" },
  { id: "green",     name: "Green",     accent: "#4ade80", strong: "#22c55e", ink: "#06220f" },
  { id: "lime",      name: "Lime",      accent: "#a3e635", strong: "#84cc16", ink: "#16210a" },
  { id: "red",       name: "Red",       accent: "#fb7185", strong: "#f43f5e", ink: "#2c0a12" },
  { id: "slate",     name: "Slate",     accent: "#cbd5e1", strong: "#94a3b8", ink: "#0c0f17" },
];

const KEY = "ui.accent";
const DEFAULT = "apricot";

export function getAccentId(): string {
  try {
    const id = localStorage.getItem(KEY);
    if (id && ACCENTS.some((a) => a.id === id)) return id;
  } catch { /* private mode */ }
  return DEFAULT;
}

export function applyAccent(id: string): void {
  const a = ACCENTS.find((x) => x.id === id) ?? ACCENTS[0];
  const r = document.documentElement.style;
  r.setProperty("--color-accent", a.accent);
  r.setProperty("--color-accent-strong", a.strong);
  r.setProperty("--color-accent-ink", a.ink);
}

export function setAccentId(id: string): void {
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
  applyAccent(id);
  window.dispatchEvent(new CustomEvent("accentchange", { detail: id }));
}

/** Call once at startup (before first paint) so the saved accent is live. */
export function applyStoredAccent(): void {
  applyAccent(getAccentId());
}
