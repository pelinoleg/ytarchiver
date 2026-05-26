import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Download, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { videosApi } from "../lib/api";

/** Handles iOS / Android PWA share-target intents.
 *
 *  The browser invokes /share?url=… (or ?text=… when the share-sheet sends
 *  the URL inside the plaintext field, which happens on iOS). We pluck the
 *  first http(s) URL out of whatever arrived, fire a Manual download, and
 *  navigate to the Downloads queue so the user sees it land. */
export function SharePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const url = extractUrl(params.get("url"), params.get("text"), params.get("title"));
  const [errorOverride, setErrorOverride] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => videosApi.manualDownload(url!),
    onSuccess: () => {
      // Land on Downloads so the user immediately sees the queue.
      setTimeout(() => navigate("/downloads", { replace: true }), 700);
    },
  });

  useEffect(() => {
    if (!url) {
      setErrorOverride("No URL found in the shared content.");
      return;
    }
    mut.mutate();
    // mut is stable per render; firing exactly once on mount is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return (
    <div className="grid min-h-[50vh] place-items-center">
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 p-6 text-center ring-1 ring-zinc-800">
        <div className="mb-3 grid h-12 w-12 mx-auto place-items-center rounded-full bg-zinc-800">
          {mut.isSuccess
            ? <CheckCircle2 className="h-6 w-6 text-emerald-400" />
            : errorOverride || mut.isError
                ? <AlertTriangle className="h-6 w-6 text-red-400" />
                : <Loader2 className="h-6 w-6 animate-spin text-zinc-200" />}
        </div>
        <h1 className="text-lg font-semibold">
          {mut.isSuccess
            ? "Queued for download"
            : errorOverride
              ? "Nothing to share"
              : mut.isError
                ? "Failed to queue"
                : "Queueing…"}
        </h1>
        {url && (
          <p className="mt-2 truncate text-xs text-zinc-500" title={url}>
            <Download className="inline h-3 w-3 mr-1" />{url}
          </p>
        )}
        {errorOverride && (
          <p className="mt-3 text-sm text-zinc-400">{errorOverride}</p>
        )}
        {mut.isError && (
          <p className="mt-3 text-sm text-red-400">{(mut.error as Error)?.message}</p>
        )}
      </div>
    </div>
  );
}

function extractUrl(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (!c) continue;
    // ``text`` (iOS) often arrives as "Cool video https://youtu.be/abc" — pull
    // the first http(s) URL out of it.
    const m = c.match(/https?:\/\/\S+/);
    if (m) return m[0];
    if (/^https?:\/\//i.test(c.trim())) return c.trim();
  }
  return null;
}
