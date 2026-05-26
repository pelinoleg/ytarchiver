import { useQuery } from "@tanstack/react-query";
import { manualApi } from "../lib/api";
import { VideoGrid } from "../components/VideoGrid";

export function ManualPage() {
  const { data: videos = [], isLoading } = useQuery({
    queryKey: ["manual"],
    queryFn: () => manualApi.list(),
  });

  return (
    <>

      <VideoGrid
        videos={videos}
        isLoading={isLoading}
        emptyTitle="No manual downloads yet"
        emptyHint="Click the Download button in the top bar to grab a single video by URL."
      />
    </>
  );
}
