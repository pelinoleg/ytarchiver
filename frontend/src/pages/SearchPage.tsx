import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, FileText } from "lucide-react";
import { searchApi, videosApi, thumbUrl, type SubtitleHit } from "../lib/api";
import { VideoGrid } from "../components/VideoGrid";
import { formatDuration } from "../lib/format";

export function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get("q")?.trim() ?? "";
  const [input, setInput] = useState(q);

  useEffect(() => { setInput(q); }, [q]);

  const { data: videos = [], isLoading } = useQuery({
    queryKey: ["videos", "search", q],
    queryFn: () => videosApi.list({ search: q, limit: 60 }),
    enabled: q.length > 0,
  });

  const { data: subHits = [] } = useQuery({
    queryKey: ["search", "subtitles", q],
    queryFn: () => searchApi.subtitles(q, 30),
    enabled: q.length > 1,
  });

  return (
    <>
      <h1 className="mb-3 text-2xl font-semibold tracking-tight">Search</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = input.trim();
          if (trimmed) navigate(`/search?q=${encodeURIComponent(trimmed)}`);
        }}
        className="mb-6 flex max-w-2xl"
      >
        <input
          type="search"
          autoFocus={!q}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search title, description, channel, chapters, subtitles…"
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

      {q && (
        <>
          <p className="mb-4 text-sm text-zinc-400">
            Results for <span className="text-zinc-200">“{q}”</span>
          </p>

          {/* Metadata results (title / description / channel / chapters) */}
          <VideoGrid
            videos={videos}
            isLoading={isLoading}
            emptyTitle="Nothing in titles or descriptions"
            emptyHint="Скролл ниже — может быть совпадение в субтитрах."
          />

          {/* Subtitle hits */}
          {subHits.length > 0 && (
            <section className="mt-12">
              <div className="mb-4 flex items-center gap-2.5">
                <FileText className="h-5 w-5 text-zinc-500" />
                <h2 className="text-base font-semibold text-zinc-100">In subtitles</h2>
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400 tabular-nums">
                  {subHits.length}
                </span>
              </div>
              <div className="space-y-2">
                {subHits.map((h, i) => <SubtitleHitRow key={i} h={h} />)}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

function SubtitleHitRow({ h }: { h: SubtitleHit }) {
  const v = h.video;
  const thumb = v.thumbnail_path ? thumbUrl(v.video_id) : v.thumbnail_url;
  const ts = Math.floor(h.start_seconds);
  // Deep-link with ?t=seconds so the player jumps to the cue.
  const to = `/watch/${v.video_id}?t=${ts}`;

  return (
    <Link
      to={to}
      className="flex items-start gap-3 rounded-xl bg-zinc-900 p-3 hover:bg-zinc-800/70"
    >
      <div className="relative aspect-video w-32 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-800">
        {thumb && <img src={thumb} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-full w-full object-cover" />}
        <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
          @ {formatDuration(ts)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-sm font-medium text-zinc-100">{v.title}</p>
        {v.channel_name && (
          <p className="truncate text-xs text-zinc-500">{v.channel_name}</p>
        )}
        <p
          className="mt-1 line-clamp-2 text-sm text-zinc-300 [&_b]:text-yellow-300 [&_b]:font-semibold"
          dangerouslySetInnerHTML={{ __html: h.snippet }}
        />
      </div>
    </Link>
  );
}
