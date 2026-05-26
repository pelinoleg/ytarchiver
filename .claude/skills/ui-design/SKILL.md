---
name: ui-design
description: >
  Use this skill when designing, polishing, or restyling the YT Archiver web UI.
  Triggers on: make it look like YouTube, redesign page, polish UI, layout,
  visual hierarchy, spacing, typography, color, dark theme, video card, sidebar,
  search bar, player page, empty state, loading skeleton, hover states,
  transitions, icons, accessibility. Pairs with `react-frontend` skill: this
  skill defines the *visual* language and component specs; `react-frontend`
  defines how to wire them up in React. Do NOT use for backend code, yt-dlp,
  or database work.
---

# UI Design Skill — YouTube-style Archive

## North star

Feel like YouTube, work like a local file browser. Familiar = no learning
curve. The user already knows where the search bar lives, what a video card
looks like, how the player page is laid out. Don't be clever — be obvious.

**Three rules above everything else:**

1. **Content first, chrome second.** Thumbnails are the hero. Everything else
   (sidebar, header, controls) recedes — neutral colors, small text, no
   decorative borders.
2. **Dense but breathable.** Pack the grid like YouTube's home page, but use
   generous gaps so it never feels cramped.
3. **One accent color, used sparingly.** Red is reserved for destructive and
   "live" states only. Everything else is zinc/neutral.

## Color palette (Tailwind)

```
Background       bg-zinc-950          (page)
Surface          bg-zinc-900          (cards, sidebar)
Surface hover    bg-zinc-800          (card hover, button hover)
Border           border-zinc-800      (subtle dividers; use sparingly)
Text primary     text-zinc-100
Text secondary   text-zinc-400        (channel name, metadata)
Text muted       text-zinc-500        (timestamps, counts)
Accent           text-red-500 / bg-red-600   (live badge, destructive)
Focus ring       ring-2 ring-zinc-100 ring-offset-2 ring-offset-zinc-950
Success          text-emerald-400     (download complete)
Warning          text-amber-400       (queued, retrying)
Error            text-red-400         (failed)
```

**Rule:** never use pure black (`#000`) or pure white (`#fff`). Zinc-950 and
zinc-100 — your eyes will thank you on OLED.

## Typography

```
Font family       font-sans (system stack via Tailwind default)
Page title        text-2xl font-semibold tracking-tight
Section heading   text-lg font-semibold
Card title        text-sm font-medium leading-snug line-clamp-2
Metadata          text-xs text-zinc-400
Body              text-sm leading-relaxed
```

Video card titles MUST use `line-clamp-2` — long titles are normal on YouTube
and the grid must stay aligned.

## Spacing & layout

- Base unit: **4px** (Tailwind default `1` = 4px).
- Card grid gap: `gap-4` (16px) for desktop, `gap-3` (12px) for mobile.
- Section padding: `p-6` for main content, `p-4` for cards.
- Sidebar width: `w-60` (240px) expanded, `w-16` (64px) collapsed.
- Top bar height: `h-14` (56px) — matches YouTube exactly.

## Core layout

```
┌──────────────────────────────────────────────────────────┐
│  [≡] [Logo]  [   Search   🔍]              [+ Add] [⚙]  │  ← h-14 top bar
├──────┬───────────────────────────────────────────────────┤
│      │                                                   │
│ Home │   ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                │
│ Subs │   │     │ │     │ │     │ │     │   ← video grid │
│ Down │   │     │ │     │ │     │ │     │                │
│ Hist │   └─────┘ └─────┘ └─────┘ └─────┘                │
│      │   title    title    title    title                │
│ ───  │   channel  channel  channel  channel              │
│ Chan │   meta     meta     meta     meta                 │
│ ...  │                                                   │
└──────┴───────────────────────────────────────────────────┘
```

**Implementation:**

```jsx
<div className="min-h-screen bg-zinc-950 text-zinc-100">
  <TopBar />                                    {/* fixed h-14 */}
  <div className="flex pt-14">
    <Sidebar />                                 {/* fixed w-60 */}
    <main className="flex-1 p-6 ml-60">
      {children}
    </main>
  </div>
</div>
```

## Component specs

### Video card

The single most important component. Get this right and the whole app looks
correct.

```jsx
<article className="group cursor-pointer">
  {/* Thumbnail — 16:9, rounded, hover reveals duration */}
  <div className="relative aspect-video overflow-hidden rounded-xl bg-zinc-900">
    <img
      src={thumbnail}
      alt=""
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
    />
    <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-zinc-100">
      {duration}
    </span>
  </div>

  {/* Metadata — channel avatar + text stack */}
  <div className="mt-3 flex gap-3">
    <img src={channelAvatar} alt="" className="h-9 w-9 flex-shrink-0 rounded-full" />
    <div className="min-w-0 flex-1">
      <h3 className="line-clamp-2 text-sm font-medium leading-snug text-zinc-100">
        {title}
      </h3>
      <p className="mt-1 text-xs text-zinc-400 hover:text-zinc-200">
        {channelName}
      </p>
      <p className="text-xs text-zinc-500">
        {views} • {uploadedAgo}
      </p>
    </div>
  </div>
</article>
```

**Critical details:**
- Thumbnail is `aspect-video` (16:9) — never let it shift size while loading.
- Duration pill is `bg-black/80` (semi-transparent black), bottom-right.
- Channel avatar is `h-9 w-9 rounded-full` (36px) — YouTube uses 36px exactly.
- Title is two lines max with `line-clamp-2`.
- Hover scales thumbnail by `1.02` — subtle, not jumpy.

### Video grid

```jsx
<div className="grid gap-x-4 gap-y-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
  {videos.map(v => <VideoCard key={v.id} {...v} />)}
</div>
```

Breakpoints match YouTube: 1 col mobile, 2 small tablet, 3 desktop, 4 wide.
Row gap (`gap-y-8`) is bigger than column gap (`gap-x-4`) — gives breathing
room between rows of metadata.

### Sidebar

```jsx
<aside className="fixed top-14 bottom-0 left-0 w-60 overflow-y-auto bg-zinc-950 py-3">
  <nav className="px-3">
    <SidebarLink icon={Home} label="Home" to="/" />
    <SidebarLink icon={Library} label="Subscriptions" to="/subs" />
    <SidebarLink icon={Download} label="Downloads" to="/downloads" />
    <SidebarLink icon={History} label="History" to="/history" />
  </nav>

  <hr className="my-3 border-zinc-800" />

  <div className="px-3">
    <h4 className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
      Channels
    </h4>
    {channels.map(c => <ChannelLink key={c.id} {...c} />)}
  </div>
</aside>
```

```jsx
function SidebarLink({ icon: Icon, label, to, active }) {
  return (
    <a href={to} className={`
      flex items-center gap-6 rounded-lg px-3 py-2 text-sm
      ${active ? "bg-zinc-800 font-medium" : "hover:bg-zinc-900"}
    `}>
      <Icon className="h-5 w-5 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </a>
  );
}
```

### Top bar

```jsx
<header className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center gap-4 bg-zinc-950 px-4">
  <button className="rounded-full p-2 hover:bg-zinc-800">
    <Menu className="h-5 w-5" />
  </button>
  <a href="/" className="text-lg font-semibold tracking-tight">
    YT Archive
  </a>

  <form className="ml-auto flex flex-1 max-w-2xl">
    <input
      type="search"
      placeholder="Search videos and channels"
      className="flex-1 rounded-l-full border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
    />
    <button className="rounded-r-full border border-l-0 border-zinc-800 bg-zinc-800 px-5 hover:bg-zinc-700">
      <Search className="h-5 w-5" />
    </button>
  </form>

  <button className="ml-auto rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-950 hover:bg-zinc-200">
    + Add download
  </button>
</header>
```

The split search input (rounded-l-full + rounded-r-full button) is the YouTube
signature — don't simplify it into a single rounded input.

### Video player page

```
┌──────────────────────────────────────────────────────┐
│ ┌──────────────────────────────────┐  ┌─────────────┐│
│ │                                  │  │ Up next     ││
│ │         VIDEO PLAYER             │  │ ┌─────┐     ││
│ │         (aspect-video)           │  │ │ thm │ ttl ││
│ │                                  │  │ └─────┘     ││
│ └──────────────────────────────────┘  │ ┌─────┐     ││
│  Title here                            │ │ thm │ ttl ││
│  ┌──────┐                              │ └─────┘     ││
│  │ av   │ channel name • subscribe     │             ││
│  └──────┘                              │             ││
│  Description box (collapsible)         │             ││
└──────────────────────────────────────────────────────┘
```

```jsx
<div className="grid gap-6 grid-cols-1 lg:grid-cols-[1fr_400px]">
  <div>
    <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
      <video src={url} controls className="h-full w-full" />
    </div>
    <h1 className="mt-4 text-xl font-semibold">{title}</h1>
    <ChannelRow />
    <Description />
  </div>
  <aside className="space-y-3">
    {upNext.map(v => <CompactVideoCard key={v.id} {...v} />)}
  </aside>
</div>
```

Right rail (`Up next`) collapses below the player on mobile (`lg:` breakpoint).

### Compact video card (for sidebar / Up next)

```jsx
<article className="flex gap-2 cursor-pointer">
  <div className="relative aspect-video w-40 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-900">
    <img src={thumbnail} alt="" className="h-full w-full object-cover" />
    <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[10px]">
      {duration}
    </span>
  </div>
  <div className="min-w-0 flex-1">
    <h3 className="line-clamp-2 text-sm font-medium leading-snug">{title}</h3>
    <p className="mt-1 text-xs text-zinc-400">{channelName}</p>
    <p className="text-xs text-zinc-500">{views} • {uploadedAgo}</p>
  </div>
</article>
```

### Empty state

```jsx
<div className="flex flex-col items-center justify-center py-24 text-center">
  <Inbox className="h-12 w-12 text-zinc-700" />
  <h3 className="mt-4 text-lg font-semibold">No downloads yet</h3>
  <p className="mt-1 text-sm text-zinc-400">
    Paste a YouTube URL above to start your archive.
  </p>
</div>
```

Icons in empty states use `text-zinc-700` — almost invisible, just hinting.

### Loading skeleton

```jsx
<div className="animate-pulse">
  <div className="aspect-video rounded-xl bg-zinc-900" />
  <div className="mt-3 flex gap-3">
    <div className="h-9 w-9 rounded-full bg-zinc-900" />
    <div className="flex-1 space-y-2">
      <div className="h-4 w-3/4 rounded bg-zinc-900" />
      <div className="h-3 w-1/2 rounded bg-zinc-900" />
    </div>
  </div>
</div>
```

Skeleton matches the real component's geometry exactly — no layout shift on load.

### Download progress row

```jsx
<div className="flex items-center gap-4 rounded-lg bg-zinc-900 p-3">
  <img src={thumbnail} className="h-14 w-24 flex-shrink-0 rounded object-cover" />
  <div className="min-w-0 flex-1">
    <p className="truncate text-sm font-medium">{title}</p>
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
      <div
        className="h-full bg-zinc-100 transition-all"
        style={{ width: `${percent}%` }}
      />
    </div>
    <p className="mt-1 text-xs text-zinc-400">
      {percent}% • {speed} • ETA {eta}
    </p>
  </div>
  <button className="rounded-full p-2 hover:bg-zinc-800">
    <X className="h-4 w-4" />
  </button>
</div>
```

Progress bar is `bg-zinc-100` on `bg-zinc-800` — white-on-dark, not the red of
YouTube's loader. Red is reserved for errors.

### Buttons

```jsx
// Primary — used for "Add download", main CTA
<button className="rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-950 hover:bg-zinc-200">

// Secondary — used for "Subscribe", filter chips
<button className="rounded-full bg-zinc-800 px-3 py-1.5 text-sm font-medium hover:bg-zinc-700">

// Icon button — used in top bar, cards
<button className="rounded-full p-2 hover:bg-zinc-800">
  <Icon className="h-5 w-5" />
</button>

// Destructive — delete, cancel download
<button className="rounded-full bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700">
```

All buttons are pill-shaped (`rounded-full`) — matches YouTube. No rectangular
buttons except inside forms.

## Icons

Use **lucide-react** — clean, consistent, free. Standard sizes:
- Inline with text: `h-4 w-4`
- Sidebar nav, top bar: `h-5 w-5`
- Empty states: `h-12 w-12`
- Player controls: `h-6 w-6`

Common icons for this app: `Home, Library, Download, History, Search, Menu,
Plus, X, MoreVertical, Play, Pause, Volume2, Settings, Inbox, Tv`.

## Interactions

- Default transition: `transition-colors duration-150` for hover background changes.
- Thumbnail hover: `transition-transform duration-300 group-hover:scale-[1.02]`.
- No animations longer than 300ms — feels sluggish.
- Focus ring: ALWAYS visible (`focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-100`).
  Never disable focus rings — accessibility regression.

## Accessibility quick wins

- Every `<img>` gets an `alt` attribute (empty string `alt=""` is fine for decorative thumbnails *inside* a card whose title is the link text).
- Every interactive element is a `<button>` or `<a>` — never `<div onClick>`.
- Color contrast: `text-zinc-400` on `bg-zinc-900` is the minimum readable combo. Don't go lighter than that for body text.
- Video player needs `<track>` element if subtitles are available.
- Keyboard nav: search bar focuses on `/`, video plays on `k`, mute on `m` (YouTube parity).

## Responsiveness

| Breakpoint | What changes |
|---|---|
| Mobile (<640px) | Sidebar collapses to drawer (off-canvas), grid → 1 col, top bar search becomes icon |
| Tablet (640–1024px) | Sidebar collapses to icons (`w-16`), grid → 2 col |
| Desktop (≥1024px) | Sidebar expanded (`w-60`), grid → 3 col |
| Wide (≥1280px) | Grid → 4 col |

## DO / DON'T

**DO:**
- Use `aspect-video` for every thumbnail — kills layout shift.
- Use `line-clamp-2` for every card title.
- Round corners: `rounded-xl` for thumbnails, `rounded-lg` for inputs/cards, `rounded-full` for buttons/avatars.
- Use system font stack — fast, native feel.
- Preload the first 8 thumbnails (`loading="eager"`); lazy-load the rest (`loading="lazy"`).

**DON'T:**
- Don't use shadows. Dark UI looks bad with shadows — separate surfaces by color, not elevation.
- Don't use gradients except for the player's bottom control overlay.
- Don't use borders to separate cards from background — let the bg color difference do it.
- Don't put more than 2 actions on a video card — one click to play, one menu icon (`MoreVertical`) for the rest.
- Don't animate on page load. Animate on interaction only.
- Don't use the word "Subscribe" if it's not actually a subscription — call it "Follow" or "Track" if semantics differ.

## Cross-skill links

- React wiring, hooks, routing → see [[react-frontend]]
- Backend endpoints feeding this UI → see [[fastapi-backend]]
- WebSocket payload for download progress row → see [[fastapi-backend]] section "WebSocket"
