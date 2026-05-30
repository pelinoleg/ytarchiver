---
name: YT Archiver
description: Self-hosted YouTube archive with a YouTube-familiar dark UI — warm-graphite surfaces, warm off-white ink, red reserved for live/destructive.
register: product
colors:
  ink: "#f1ede4"            # primary text + "white" surfaces — warm off-white (Tailwind token: zinc-100)
  bg: "#1d1c1a"             # page background — warm graphite, not black (zinc-950)
  bg-deep: "#161513"        # deepest recess: top bar (zinc-960)
  surface: "#272622"        # cards, sidebar, panels (zinc-900)
  surface-hover: "#33322d" # card/button hover, also the default border color (zinc-800)
  line-strong: "#41403a"    # stronger divider / input border (zinc-700)
  text-secondary: "#b0ada4" # channel name, metadata (zinc-400)
  text-muted: "#95928a"     # timestamps, counts (zinc-500)
  accent: "#dc2626"         # red-600 — destructive + live/new + downloading
  accent-soft: "#ef4444"    # red-500
  success: "#34d399"        # emerald-400 — download complete
  warning: "#fbbf24"        # amber-400 — queued / pending / retrying
  music: "#e879f9"          # fuchsia-400 — music context
  info: "#38bdf8"           # sky-400 — storage / informational
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.5rem"      # text-2xl — page titles
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em" # tracking-tight
  heading:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "1.125rem"    # text-lg — section headings
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "0.875rem"    # text-sm — card titles, body
    fontWeight: 500
    lineHeight: 1.375
  meta:
    fontFamily: "{typography.display.fontFamily}"
    fontSize: "0.75rem"     # text-xs — metadata
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "6px"                 # rounded-md — buttons, chips
  md: "12px"                # rounded-xl — thumbnails, cards
  lg: "16px"                # rounded-2xl — hero / panels
  full: "9999px"            # pills, avatars, icon buttons
spacing:
  card-gap-x: "16px"        # gap-x-4 between cards
  card-gap-y: "32px"        # gap-y-8 between card rows (metadata breathing room)
  section: "24px"           # p-6 main content
  mobile-section: "16px"    # p-4
components:
  page-title:
    typography: "{typography.display}"
    textColor: "{colors.ink}"
  card-title:
    typography: "{typography.body}"
    textColor: "{colors.ink}"
  duration-pill:
    backgroundColor: "#000000d9"
    textColor: "{colors.ink}"
    rounded: "4px"
    padding: "2px 6px"
  new-badge:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "4px"
    padding: "2px 6px"
---

## Overview

YT Archiver is a self-hosted YouTube archive that **feels like YouTube and works like a local file browser**. Familiarity is the point: the search bar, the video grid, the player page all sit where a YouTube user expects them, so there is no learning curve. This is a **product** surface — the chrome recedes and the content (thumbnails) is the hero.

Three operating principles:

1. **Content first, chrome second.** Thumbnails lead; sidebar, top bar, and controls stay neutral and quiet.
2. **Dense but breathable.** The grid packs tight like YouTube's home, but row gaps are generous so nothing feels cramped.
3. **One accent, used sparingly.** Red means live / new / downloading / destructive. Everything else lives on the warm-graphite neutral ramp.

The theme is **not** the stock Tailwind zinc ramp — `index.css` remaps the whole `zinc-*` ramp to a custom **warm-graphite** palette: a soft, not-black background, a clear surface-elevation staircase, and a **warm off-white ink** (`zinc-100 = #f1ede4`). A faint warm tint (R≥G≥B by a few points, very low chroma) runs through every step so it reads cozy, not clinical. `color-scheme: dark` is set so native controls match.

## Colors

Strategy: **Restrained** — a warm-neutral graphite ramp plus a single red accent under ~10% of any view. Depth comes from the lightness staircase, not from heavy borders or shadows.

- **Background** `#1d1c1a` (page) and `#161513` (top bar / deepest recess). Warm graphite — never pure black.
- **Surfaces** `#272622` (cards, sidebar, panels), hover to `#33322d`. `#33322d` doubles as the default border; `#41403a` is the stronger divider / input border.
- **Ink ramp**: primary `#f1ede4` (warm off-white, also the "white" button/toggle fill) → secondary `#b0ada4` (metadata, ≈7:1) → muted `#95928a` (timestamps, counts, ≥4.5:1 on surfaces too). Never pure white.
- **Accent** red `#dc2626` / `#ef4444`: live & "New" badges, the downloading state, destructive actions, and the Downloads identity. Not decorative. Also the text-selection highlight (`red-500 @ 32%`).
- **Semantic**: success `#34d399` (emerald-400), warning `#fbbf24` (amber-400, queued/pending), error `#f87171/#ef4444` (red), music `#e879f9` (fuchsia-400), info/storage `#38bdf8` (sky-400). Stock Tailwind values, which sit well on the warm-neutral base.

Contrast: primary ≈16:1, secondary ≈7:1, muted ≈4.5:1 even on the lighter surfaces. Keep muted for non-essential counts/timestamps, never primary reading text.

## Typography

One family — the system sans stack (`ui-sans-serif, system-ui, …`), antialiased. No display/body pairing; product UI carries everything in one well-tuned sans with weight + size contrast.

| Role | Token | Tailwind |
|---|---|---|
| Page title | 1.5rem / 600 / tracking-tight | `text-2xl font-semibold tracking-tight` |
| Section heading | 1.125rem / 600 | `text-lg font-semibold` |
| Card title | 0.875rem / 500, 2-line clamp | `text-sm font-medium leading-snug line-clamp-2` |
| Body | 0.875rem / 400, relaxed | `text-sm leading-relaxed` |
| Metadata | 0.75rem / 400 | `text-xs` |

Card titles **must** `line-clamp-2` — long titles are normal and the grid must stay aligned. Section group headers (by-channel / by-date) repeat the heading scale.

## Elevation

Mostly flat — depth comes from the surface ramp (bg → surface → surface-hover), not shadows. Shadows appear only on genuinely floating UI: the mini-player, dropdown menus (`shadow-xl` / `shadow-2xl`), and the Downloads hero. Hover lifts are tonal (background steps up) plus a 1.02 thumbnail scale, not drop shadows. Sticky/fixed layers follow a fixed order: top bar and sidebar are `z-50`; floating bars (selection, mini-player, bottom nav) sit above content; portalled menus use `z-[60]`.

## Components

- **Video card** (`VideoCard.tsx`): 16:9 `rounded-xl` thumbnail on `bg-zinc-900`, `object-cover`, `group-hover:scale-[1.02]`. Bottom-right duration pill (`bg-black/85`), bottom-left file-size/keep badges, top-right "New" badge (red) or the 3-dot menu (portalled so it can't clip). Below: 2-line clamped title (primary ink), then a clickable channel avatar (`h-7 w-7 rounded-full`) + channel name (secondary) + date (muted).
- **Video grid** (`VideoGrid.tsx`): desktop uses `repeat(auto-fill, minmax(var(--card-min), 1fr))` driven by the TopBar density slider; cards stay fluid (`1fr`) so columns reflow with width. Mobile is 1 col (or 2 via the compact toggle), tablet 2. Above ~200 items it virtualizes (window-scroll). Column gap 16px, row gap 32px.
- **Continue-watching strip** (HomePage): a horizontal `scrollbar-hide` carousel of smaller cards inside a quiet `bg-zinc-900/40 ring-1` panel, collapsible per viewport.
- **Top bar**: `h-14`, `bg-zinc-950`, fixed; search in the center, density slider + add menu + settings on the right.
- **Sidebar**: `w-70`, graphite, quiet nav rows; active row is a filled `bg-zinc-800`.
- **Badges/pills**: `rounded-full`, semantic tint at ~15% over a matching ring (e.g. `bg-amber-500/15 ring-amber-500/25 text-amber-200`).

## Do's and Don'ts

**Do**

- Lead with the thumbnail; keep chrome neutral and small.
- Use the primary ink (warm off-white) for primary text; secondary/muted for metadata only.
- Keep red for live/new/downloading/destructive — nowhere else.
- Use tonal hover (surface step + 1.02 scale), generous row gaps, `line-clamp-2` titles.
- Portal any dropdown that lives inside an `overflow-hidden` card.

**Don't**

- No pure black or pure white. No second accent color competing with red.
- No decorative borders or side-stripes; dividers are 1px `surface-hover`.
- No drop shadows on static cards (depth is tonal). No gradient text, no glassmorphism as default.
- Don't let muted `#6c6c7e` carry primary reading text — contrast is too low.
- Don't break the fixed grid alignment (titles clamp; thumbnails never resize while loading).
