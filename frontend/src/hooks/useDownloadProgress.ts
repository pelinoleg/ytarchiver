import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Video, VideoStatus } from "../lib/api";

type ProgressMsg = {
  video_id: string;
  status: VideoStatus;
  percent?: string;
  downloaded_bytes?: number;
  total_bytes?: number;
  speed?: string;
  eta?: string;
  error?: string;
};

/** Subscribes to /ws and reflects download progress into the React Query cache. */
export function useDownloadProgress() {
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (!alive) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        let msg: ProgressMsg;
        try { msg = JSON.parse(e.data) as ProgressMsg; } catch { return; }

        const patch = (v: Video): Video => v.video_id === msg.video_id
          ? {
              ...v,
              status: msg.status,
              progress:         msg.percent           ?? v.progress,
              downloaded_bytes: msg.downloaded_bytes ?? v.downloaded_bytes,
              total_bytes:      msg.total_bytes      ?? v.total_bytes,
              speed:            msg.speed            ?? v.speed,
              eta:              msg.eta              ?? v.eta,
            }
          : v;
        const patchList = (old: Video[] | undefined) =>
          Array.isArray(old) ? old.map(patch) : old;

        qc.setQueriesData<Video[] | undefined>({ queryKey: ["videos"] }, patchList);
        qc.setQueriesData<Video[] | undefined>({ queryKey: ["queue"]  }, patchList);

        // Terminal events: refresh lists so size/file_path/thumb pick up.
        if (msg.status === "done" || msg.status === "error") {
          qc.invalidateQueries({ queryKey: ["videos"] });
          qc.invalidateQueries({ queryKey: ["queue"] });
        }
      };

      ws.onclose = () => { if (alive) retry = setTimeout(connect, 2000); };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      alive = false;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [qc]);
}
