import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, RefreshCw, Loader2 } from "lucide-react";
import { vpnApi } from "../lib/api";

/** Desktop-only header chip: is the YouTube IP working or banned right now, and
 *  — when the folder-driven VPN pool has a live tunnel — which exit country is
 *  active, with a button to rotate to another exit. */
export function NetworkStatusChip() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["vpn-status"],
    queryFn: vpnApi.status,
    refetchInterval: 45_000,
    staleTime: 30_000,
  });
  const rotate = useMutation({
    mutationFn: vpnApi.rotate,
    onSuccess: (s) => qc.setQueryData(["vpn-status"], s),
  });

  if (!data) return null;

  const blocked = data.state === "blocked";
  const ok = data.state === "ok";
  const dot = blocked ? "bg-red-500" : ok ? "bg-emerald-500" : "bg-zinc-500";
  const label = blocked
    ? `IP banned${data.reason ? ` · ${data.reason}` : ""}`
    : ok ? "Online" : "—";
  const labelColor = blocked ? "text-red-300" : ok ? "text-emerald-300" : "text-zinc-400";
  const tip =
    `Последняя загрузка: ${data.state}` +
    (data.reason ? ` (${data.reason})` : "") +
    (data.via ? ` · через ${data.via}` : "") +
    (data.checked_at ? `\n${new Date(data.checked_at).toLocaleString()}` : "");

  return (
    <div
      className="hidden lg:flex items-center gap-2 rounded-full bg-zinc-800/70 px-2.5 py-1 text-xs ring-1 ring-white/10"
      title={tip}
    >
      <span
        className={`h-2 w-2 flex-shrink-0 rounded-full ${dot} ${
          ok ? "shadow-[0_0_6px] shadow-emerald-500/60" : blocked ? "shadow-[0_0_6px] shadow-red-500/60" : ""
        }`}
      />
      <span className={`font-medium ${labelColor}`}>{label}</span>

      {data.vpn && (
        <>
          <span className="mx-0.5 h-3 w-px bg-white/15" />
          <Globe className="h-3.5 w-3.5 text-sky-300" />
          <span className="font-semibold text-sky-200">{data.country ?? data.exit ?? "VPN"}</span>
          <button
            type="button"
            onClick={() => rotate.mutate()}
            disabled={rotate.isPending || data.healthy_count < 2}
            title={data.healthy_count < 2 ? "Доступен только один экзит" : "Сменить VPN-экзит"}
            aria-label="Сменить VPN"
            className="ml-0.5 grid h-5 w-5 place-items-center rounded-full text-zinc-300 hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            {rotate.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </>
      )}
    </div>
  );
}
