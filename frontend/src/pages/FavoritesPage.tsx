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
      <h1 className="sr-only">Favorites</h1>
      <VideoGrid
        videos={videos}
        isLoading={isLoading}
        emptyTitle="Nothing starred yet"
        emptyHint="Open a video and click the star next to “Keep forever” to add it here."
      />
    </>
  );
}
