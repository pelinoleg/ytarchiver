import { useQuery } from "@tanstack/react-query";
import { historyApi } from "../lib/api";
import { VideoGrid } from "../components/VideoGrid";

export function HistoryPage() {
  const { data: videos = [], isLoading } = useQuery({
    queryKey: ["history"],
    queryFn: () => historyApi.list(200),
  });

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Watch history</h1>
      <VideoGrid
        videos={videos}
        isLoading={isLoading}
        emptyTitle="Nothing watched yet"
        emptyHint="Videos you start playing show up here, newest first."
      />
    </>
  );
}
