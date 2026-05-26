import { useQuery } from "@tanstack/react-query";
import { favoritesApi } from "../lib/api";
import { VideoGrid } from "../components/VideoGrid";

export function FavoritesPage() {
  const { data: videos = [], isLoading } = useQuery({
    queryKey: ["favorites"],
    queryFn: () => favoritesApi.list(),
  });

  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Favorites</h1>
      <p className="mb-6 text-sm text-zinc-400">
        Videos you starred. Like manual downloads, these aren't touched by the cleanup —
        the retention timer and the watched-percent rule both skip them. Unstar a video
        to make it eligible for cleanup again.
      </p>
      <VideoGrid
        videos={videos}
        isLoading={isLoading}
        emptyTitle="Nothing starred yet"
        emptyHint="Open a video and click the star next to “Keep forever” to add it here."
      />
    </>
  );
}
