import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from "react";
import { AlertTriangle, X } from "lucide-react";

export interface ConfirmOptions {
  title:         string;
  body?:         React.ReactNode;
  confirmLabel?: string;
  cancelLabel?:  string;
  /** When true the primary button is red; the dialog adds a warning icon. */
  destructive?:  boolean;
  /** When true (default) the backdrop click resolves to cancel. */
  dismissible?:  boolean;
}

type Resolver = (ok: boolean) => void;

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

interface OpenState extends ConfirmOptions {
  resolve: Resolver;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OpenState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => setState({ ...opts, resolve }));
  }, []);

  function close(answer: boolean) {
    if (!state) return;
    const r = state.resolve;
    setState(null);
    r(answer);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && <ConfirmDialog state={state} onClose={close} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────

function ConfirmDialog({
  state, onClose,
}: { state: OpenState; onClose: (ok: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const {
    title, body, confirmLabel = "OK", cancelLabel = "Cancel",
    destructive = false, dismissible = true,
  } = state;

  // Keyboard: Enter confirms, Esc cancels.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(false); }
      else if (e.key === "Enter") {
        // Only trigger when focus isn't on the cancel button.
        const t = e.target as HTMLElement | null;
        if (t?.tagName === "BUTTON" && t.dataset.role === "cancel") return;
        e.preventDefault();
        onClose(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Autofocus the primary button so Enter just works.
  useEffect(() => { confirmRef.current?.focus(); }, []);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 sm:p-4"
      onClick={() => dismissible && onClose(false)}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 shadow-2xl p-5 sm:p-6"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {destructive && (
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="text-base font-semibold text-zinc-100">
              {title}
            </h2>
            {body && (
              <div className="mt-2 text-sm leading-relaxed text-zinc-400">
                {body}
              </div>
            )}
          </div>
          {dismissible && (
            <button
              onClick={() => onClose(false)}
              className="ml-2 -mr-1 -mt-1 rounded-full p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            data-role="cancel"
            onClick={() => onClose(false)}
            className="rounded-full bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onClose(true)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              destructive
                ? "bg-red-600 text-white hover:bg-red-500"
                : "bg-zinc-100 text-zinc-950 hover:bg-white"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
