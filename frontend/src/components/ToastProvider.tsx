import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

type Variant = "success" | "error" | "info";

interface Toast { id: number; message: string; variant: Variant }

interface ToastCtx { toast: (message: string, variant?: Variant) => void }

const ToastContext = createContext<ToastCtx | null>(null);

let nextId = 1;
const DURATION = 3800;

/** Lightweight toast stack. Bottom-right on desktop, bottom-center on phone
 *  (lifted above the bottom nav). Auto-dismiss, click-to-dismiss, capped. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const remove = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    const tm = timers.current.get(id);
    if (tm) { clearTimeout(tm); timers.current.delete(id); }
  }, []);

  const toast = useCallback((message: string, variant: Variant = "success") => {
    const id = nextId++;
    // Keep at most 4 on screen.
    setToasts((ts) => [...ts.slice(-3), { id, message, variant }]);
    timers.current.set(id, setTimeout(() => remove(id), DURATION));
  }, [remove]);

  useEffect(() => () => { timers.current.forEach((t) => clearTimeout(t)); }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[100] flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:right-4 sm:items-end"
        style={{ bottom: "calc(var(--bottom-nav-safe) + 1rem)" }}
      >
        {toasts.map((t) => <ToastCard key={t.id} t={t} onClose={() => remove(t.id)} />)}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ t, onClose }: { t: Toast; onClose: () => void }) {
  const { Icon, cls } = {
    success: { Icon: CheckCircle2, cls: "text-emerald-400" },
    error:   { Icon: AlertTriangle, cls: "text-red-400" },
    info:    { Icon: Info, cls: "text-accent" },
  }[t.variant];
  return (
    <div className="toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl bg-zinc-900/95 px-3.5 py-3 text-sm shadow-2xl shadow-black/50 ring-1 ring-white/10 backdrop-blur-sm">
      <Icon className={`h-5 w-5 flex-shrink-0 ${cls}`} />
      <span className="flex-1 leading-snug text-zinc-100">{t.message}</span>
      <button onClick={onClose} className="-mr-1 rounded-full p-0.5 text-zinc-500 hover:text-zinc-200" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function useToast(): (message: string, variant?: Variant) => void {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx.toast;
}
