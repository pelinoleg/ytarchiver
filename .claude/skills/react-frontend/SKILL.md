---
name: react-frontend
description: >
  Use this skill when building or modifying the React frontend for YT Archiver.
  Triggers on: create page, add component, video player, channel list, download
  queue, search UI, sidebar, routing, API calls from React, WebSocket in React,
  Tailwind styling, dark mode. Do NOT use for FastAPI routes (fastapi-backend
  skill) or database queries (sqlite-db skill).
---

# React Frontend Skill

## Stack

- **React 18** + **Vite**
- **React Router v6** — client-side routing
- **TanStack Query (React Query)** — server state, caching, refetch
- **Tailwind CSS** — styling (dark mode by default)
- **Lucide React** — icons
- No Redux, no MobX — React Query handles all server state

## Project structure

```
frontend/
  src/
    api/
      client.ts         # axios instance, base URL
      channels.ts       # channel API calls
      videos.ts         # video API calls
      queue.ts          # queue API calls
    components/
      Layout.tsx         # sidebar + main area shell
      ChannelCard.tsx
      VideoCard.tsx
      VideoPlayer.tsx    # native <video> with controls
      QueueItem.tsx
      SearchBar.tsx
    pages/
      Home.tsx           # recent videos grid
      ChannelPage.tsx    # videos for one channel
      QueuePage.tsx      # download queue
      PlayerPage.tsx     # full-screen player
    hooks/
      useDownloadProgress.ts   # WebSocket hook
    App.tsx
    main.tsx
```

## API client (api/client.ts)

```ts
import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
  timeout: 30_000,
});
```

## API calls (api/channels.ts)

```ts
import { api } from "./client";

export interface Channel {
  id: number;
  url: string;
  name: string;
  channel_id: string;
  last_synced: string | null;
  video_count: number;
}

export const channelsApi = {
  list: () => api.get<Channel[]>("/api/channels/").then(r => r.data),
  add: (url: string) => api.post<Channel>("/api/channels/", { url }).then(r => r.data),
  remove: (id: number) => api.delete(`/api/channels/${id}`),
  sync: (id: number) => api.post(`/api/channels/${id}/sync`),
};
```

## API calls (api/videos.ts)

```ts
import { api } from "./client";

export interface Video {
  id: number;
  video_id: string;
  channel_id: number;
  title: string;
  duration: number | null;
  upload_date: string | null;
  file_path: string | null;
  status: "queued" | "downloading" | "done" | "error";
  thumbnail_path: string | null;
}

export const videosApi = {
  list: (params?: { channel_id?: number; status?: string; search?: string; limit?: number; offset?: number }) =>
    api.get<Video[]>("/api/videos/", { params }).then(r => r.data),
  download: (url: string) => api.post("/api/videos/download", null, { params: { url } }),
  streamUrl: (video_id: string) => `${api.defaults.baseURL}/api/stream/${video_id}`,
  thumbnailUrl: (video_id: string) => `${api.defaults.baseURL}/api/stream/thumbnail/${video_id}`,
};
```

## WebSocket hook for download progress (hooks/useDownloadProgress.ts)

```ts
import { useEffect, useRef, useState } from "react";

interface ProgressEvent {
  video_id: string;
  status: "downloading" | "finished" | "error";
  percent?: string;
  speed?: string;
  eta?: string;
}

export function useDownloadProgress(onUpdate: (e: ProgressEvent) => void) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(
      (import.meta.env.VITE_API_URL ?? "ws://localhost:8000").replace("http", "ws") + "/ws"
    );
    ws.onmessage = (e) => {
      try { onUpdate(JSON.parse(e.data)); }
      catch { /* ignore malformed */ }
    };
    wsRef.current = ws;
    return () => ws.close();
  }, []);

  return wsRef;
}
```

## Layout with sidebar (components/Layout.tsx)

```tsx
import { NavLink, Outlet } from "react-router-dom";
import { Home, List, Tv, Search } from "lucide-react";

const nav = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/queue", icon: List, label: "Queue" },
];

export function Layout() {
  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col border-r border-zinc-800 p-4 gap-1">
        <div className="text-lg font-bold mb-6 text-red-500">▶ YT Archiver</div>
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to} to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
               ${isActive ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"}`
            }
          >
            <Icon size={16} /> {label}
          </NavLink>
        ))}
        {/* Channels section rendered by ChannelsSidebar component */}
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
```

## Video card (components/VideoCard.tsx)

```tsx
import { Video, videosApi } from "../api/videos";
import { formatDuration } from "../utils/format";
import { Link } from "react-router-dom";

export function VideoCard({ video }: { video: Video }) {
  return (
    <Link to={`/watch/${video.video_id}`}
      className="group block rounded-xl overflow-hidden bg-zinc-900 hover:bg-zinc-800 transition-colors"
    >
      <div className="relative aspect-video bg-zinc-800">
        <img
          src={videosApi.thumbnailUrl(video.video_id)}
          alt={video.title}
          className="w-full h-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        {video.duration && (
          <span className="absolute bottom-1 right-1 bg-black/80 text-xs px-1 rounded">
            {formatDuration(video.duration)}
          </span>
        )}
        {video.status === "downloading" && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="text-sm text-white">Downloading…</span>
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="text-sm font-medium line-clamp-2 text-zinc-100 group-hover:text-white">
          {video.title}
        </p>
        <p className="text-xs text-zinc-500 mt-1">{video.upload_date}</p>
      </div>
    </Link>
  );
}
```

## Video player page (pages/PlayerPage.tsx)

```tsx
import { useParams } from "react-router-dom";
import { videosApi } from "../api/videos";
import { useQuery } from "@tanstack/react-query";

export function PlayerPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const { data: videos } = useQuery({
    queryKey: ["video", videoId],
    queryFn: () => videosApi.list({ search: videoId }),
  });
  const video = videos?.[0];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <video
        controls
        autoPlay
        className="w-full rounded-xl bg-black aspect-video"
        src={videosApi.streamUrl(videoId!)}
      />
      {video && (
        <div className="mt-4">
          <h1 className="text-xl font-semibold">{video.title}</h1>
          <p className="text-zinc-400 text-sm mt-1">{video.upload_date}</p>
        </div>
      )}
    </div>
  );
}
```

## Home page with search (pages/Home.tsx)

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { videosApi } from "../api/videos";
import { VideoCard } from "../components/VideoCard";
import { SearchBar } from "../components/SearchBar";

export function Home() {
  const [search, setSearch] = useState("");

  const { data: videos = [] } = useQuery({
    queryKey: ["videos", search],
    queryFn: () => videosApi.list({ search: search || undefined, status: "done", limit: 100 }),
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Videos</h1>
        <SearchBar value={search} onChange={setSearch} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {videos.map(v => <VideoCard key={v.id} video={v} />)}
      </div>
    </div>
  );
}
```

## Add channel form

```tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { channelsApi } from "../api/channels";

export function AddChannelForm() {
  const [url, setUrl] = useState("");
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: () => channelsApi.add(url),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["channels"] }); setUrl(""); },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}
      className="flex gap-2 p-4">
      <input
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="https://youtube.com/@channel"
        className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-red-500"
      />
      <button type="submit" disabled={mut.isPending}
        className="bg-red-600 hover:bg-red-500 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50">
        {mut.isPending ? "Adding…" : "Subscribe"}
      </button>
    </form>
  );
}
```

## App routing (App.tsx)

```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { QueuePage } from "./pages/QueuePage";
import { PlayerPage } from "./pages/PlayerPage";
import { ChannelPage } from "./pages/ChannelPage";

const qc = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/channels/:id" element={<ChannelPage />} />
            <Route path="/queue" element={<QueuePage />} />
            <Route path="/watch/:videoId" element={<PlayerPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
```

## Vite config (vite.config.ts)

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
```

## Utility: format duration (utils/format.ts)

```ts
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
```

## Rules

- ALWAYS use TanStack Query for API calls — no `useEffect` + `fetch` patterns
- Video `<video>` element gets `src` directly from `/api/stream/{video_id}` — browser handles range requests and seeking automatically
- Dark mode is default — `bg-zinc-950` base, `text-zinc-100` text
- Invalidate React Query cache after mutations: `queryClient.invalidateQueries()`
- WebSocket connection lives in a top-level hook, not per-component
- NEVER store API responses in `useState` — use React Query's `data`
