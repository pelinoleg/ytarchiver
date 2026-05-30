/** Swappable background themes. Each preset overrides the dark end of the
 *  zinc ramp (the page / surface / hover / border steps) on :root at runtime,
 *  so the whole app reskins instantly. The light text steps (zinc-100..400)
 *  stay as defined in @theme — they read fine on every preset, which are all
 *  kept dark enough. Different hue tints + different darkness levels. */
export interface Background {
  id: string;
  name: string;
  /** [zinc-960, 950, 900, 800, 700, 600] — deepest → lighter surface steps. */
  ramp: [string, string, string, string, string, string];
}

export const BACKGROUNDS: Background[] = [
  { id: "graphite",      name: "Graphite",       ramp: ["#141518", "#191a1e", "#222329", "#2e2f37", "#3b3c45", "#555863"] },
  { id: "graphite-deep", name: "Graphite Deep",  ramp: ["#0d0e10", "#121316", "#1a1b1f", "#25262c", "#323339", "#4d4f57"] },
  { id: "graphite-soft", name: "Graphite Soft",  ramp: ["#1b1c20", "#212329", "#2b2d34", "#383a43", "#464853", "#5f616d"] },
  { id: "black",         name: "True Black",     ramp: ["#050506", "#0a0a0b", "#141416", "#1e1e21", "#2a2a2e", "#45454b"] },
  { id: "ink",           name: "Ink",            ramp: ["#08090d", "#0c0d13", "#15171f", "#1f222d", "#2b2f3d", "#454a5c"] },
  { id: "midnight",      name: "Midnight",       ramp: ["#0f1118", "#14161f", "#1c1f2c", "#272b3b", "#343a4d", "#4d5468"] },
  { id: "ocean",         name: "Ocean",          ramp: ["#0a0f17", "#0e1420", "#182234", "#212d44", "#2c3b58", "#415574"] },
  { id: "slate",         name: "Slate",          ramp: ["#15171c", "#1b1e25", "#252934", "#323743", "#404653", "#59606e"] },
  { id: "teal-night",    name: "Teal Night",     ramp: ["#0c1416", "#101b1e", "#18282b", "#21363a", "#2c474c", "#426369"] },
  { id: "forest",        name: "Forest",         ramp: ["#0f1411", "#131a16", "#1b2620", "#26342c", "#324339", "#495f51"] },
  { id: "plum",          name: "Plum",           ramp: ["#14101a", "#191522", "#221d30", "#2e2840", "#3c3553", "#564d6e"] },
  { id: "wine",          name: "Wine",           ramp: ["#160f12", "#1c1418", "#271c22", "#34262d", "#43323a", "#5f4951"] },
  { id: "espresso",      name: "Espresso",       ramp: ["#15120f", "#1b1714", "#25201b", "#322b24", "#40382f", "#5b5043"] },
  { id: "cocoa",         name: "Cocoa",          ramp: ["#1a1512", "#221b16", "#2d2620", "#3a322a", "#494036", "#64594b"] },
];

const KEY = "ui.bg";
const DEFAULT = "graphite";
const STEPS = ["960", "950", "900", "800", "700", "600"] as const;

export function getBackgroundId(): string {
  try {
    const id = localStorage.getItem(KEY);
    if (id && BACKGROUNDS.some((b) => b.id === id)) return id;
  } catch { /* private mode */ }
  return DEFAULT;
}

export function applyBackground(id: string): void {
  const b = BACKGROUNDS.find((x) => x.id === id) ?? BACKGROUNDS[0];
  const r = document.documentElement.style;
  b.ramp.forEach((hex, i) => r.setProperty(`--color-zinc-${STEPS[i]}`, hex));
  // The body's solid base reads --color-zinc-950 at load; nudge it live too.
  document.body.style.backgroundColor = b.ramp[1];
}

export function setBackgroundId(id: string): void {
  try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
  applyBackground(id);
  window.dispatchEvent(new CustomEvent("bgchange", { detail: id }));
}

/** Call once at startup (before first paint) so the saved bg is live. */
export function applyStoredBackground(): void {
  applyBackground(getBackgroundId());
}
