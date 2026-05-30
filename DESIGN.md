---
name: YT Archiver
description: Self-hosted YouTube archive with a YouTube-familiar dark UI — slate surfaces, warm-gold ink, red reserved for live/destructive.
register: product
colors:
  ink: "#e6cb91"            # primary text — warm gold (Tailwind token: zinc-100)
  bg: "#1e2129"             # page background — dark slate (zinc-950)
  bg-deep: "#12181b"        # deepest recess: top bar, code wells (zinc-960)
  surface: "#2f3440"        # cards, sidebar, panels (zinc-900)
  surface-hover: "#3c4251" # card/button hover, also the border color (zinc-800)
  line-strong: "#404759"    # stronger divider / input border (zinc-700)
  text-secondary: "#9f9fb1" # channel name, metadata (zinc-400)
  text-muted: "#6c6c7e"     # timestamps, counts (zinc-500)
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
3. **One accent, used sparingly.** Red means live / new / downloading / destructive. Everything else lives on the slate-and-gold neutral ramp.

The theme is **not** the stock Tailwind zinc ramp — `index.css` remaps the `zinc-*` tokens to a custom dark-slate palette with a distinctive **warm-gold ink** (`zinc-100 = #e6cb91`). Treat the gold as the brand: it is the primary text color across the whole app.

## Colors

Strategy: **Restrained** — a tinted-slate neutral ramp plus a single red accent under ~10% of any view.

- **Background** `#1e2129` (page) and `#12181b` (top bar / deepest recess). Never pure black.
- **Surfaces** `#2f3440` (cards, sidebar, panels), hover to `#3c4251`. `#3c4251` doubles as the standard border; `#404759` is the stronger divider / input border.
- **Ink ramp**: primary `#e6cb91` (warm gold) → secondary `#9f9fb1` (metadata) → muted `#6c6c7e` (timestamps, counts). Never pure white.
- **Accent** red `#dc2626` / `#ef4444`: live & "New" badges, the downloading state, destructive actions, and the Downloads identity. Not decorative.
- **Semantic**: success `#34d399` (emerald-400), warning `#fbbf24` (amber-400, queued/pending), error `#f87171/#ef4444` (red), music `#e879f9` (fuchsia-400), info/storage `#38bdf8` (sky-400). These use stock Tailwind values.

Contrast watchpoint: muted `#6c6c7e` on `#1e2129` is near the small-text floor; reserve it for non-essential counts/timestamps, never primary reading text.

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

- **Video card** (`VideoCard.tsx`): 16:9 `rounded-xl` thumbnail on `bg-zinc-900`, `object-cover`, `group-hover:scale-[1.02]`. Bottom-right duration pill (`bg-black/85`), bottom-left file-size/keep badges, top-right "New" badge (red) or the 3-dot menu (portalled so it can't clip). Below: 2-line clamped title (gold), then a clickable channel avatar (`h-7 w-7 rounded-full`) + channel name (secondary) + date (muted).
- **Video grid** (`VideoGrid.tsx`): desktop uses `repeat(auto-fill, minmax(var(--card-min), 1fr))` driven by the TopBar density slider; cards stay fluid (`1fr`) so columns reflow with width. Mobile is 1 col (or 2 via the compact toggle), tablet 2. Above ~200 items it virtualizes (window-scroll). Column gap 16px, row gap 32px.
- **Continue-watching strip** (HomePage): a horizontal `scrollbar-hide` carousel of smaller cards inside a quiet `bg-zinc-900/40 ring-1` panel, collapsible per viewport.
- **Top bar**: `h-14`, `bg-zinc-950`, fixed; search in the center, density slider + add menu + settings on the right.
- **Sidebar**: `w-70`, slate, quiet nav rows; active row is a filled `bg-zinc-800`.
- **Badges/pills**: `rounded-full`, semantic tint at ~15% over a matching ring (e.g. `bg-amber-500/15 ring-amber-500/25 text-amber-200`).

## Do's and Don'ts

**Do**

- Lead with the thumbnail; keep chrome neutral and small.
- Use the gold ink for primary text everywhere; secondary/muted for metadata only.
- Keep red for live/new/downloading/destructive — nowhere else.
- Use tonal hover (surface step + 1.02 scale), generous row gaps, `line-clamp-2` titles.
- Portal any dropdown that lives inside an `overflow-hidden` card.

**Don't**

- No pure black or pure white. No second accent color competing with red.
- No decorative borders or side-stripes; dividers are 1px `surface-hover`.
- No drop shadows on static cards (depth is tonal). No gradient text, no glassmorphism as default.
- Don't let muted `#6c6c7e` carry primary reading text — contrast is too low.
- Don't break the fixed grid alignment (titles clamp; thumbnails never resize while loading).
