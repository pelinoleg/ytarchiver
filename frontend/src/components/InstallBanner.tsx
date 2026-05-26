import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

/** Slim "Install app" banner — surfaces the PWA install prompt where the
 *  browser supports it (Android Chrome / Edge / desktop Chrome). On iOS
 *  the install flow is manual (Share → Add to Home Screen), so we show a
 *  different one-liner explaining that, but only if the user explicitly
 *  asked for it (no auto-popup; iOS users find Settings → Install).
 *
 *  The browser fires ``beforeinstallprompt`` once per session per origin
 *  when the PWA criteria are met (HTTPS, manifest, SW, not already
 *  installed). We capture the event, surface our own banner, and only
 *  call ``prompt()`` from a user gesture.
 *
 *  Dismissal is persisted in localStorage so we don't nag.
 */
const DISMISS_KEY = "pwa.install.dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallBanner() {
  const [evt, setEvt]   = useState<BeforeInstallPromptEvent | null>(null);
  const [hide, setHide] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; }
    catch { return false; }
  });

  useEffect(() => {
    const onBIP = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setEvt(null);
      try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* */ }
    };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!evt || hide) return null;

  async function install() {
    if (!evt) return;
    try {
      await evt.prompt();
      await evt.userChoice;
    } catch { /* user cancelled */ }
    setEvt(null);
  }

  function dismiss() {
    setHide(true);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* */ }
  }

  return (
    <div
      role="status"
      className="
        fixed left-3 right-3 z-[55]
        bottom-20 xl:bottom-3
        max-w-md mx-auto
        flex items-center gap-3
        rounded-2xl bg-zinc-900 ring-1 ring-zinc-700 shadow-2xl
        px-4 py-3
      "
    >
      <div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-red-600 text-white">
        <Download className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-zinc-100">Install YT Archive</p>
        <p className="truncate text-xs text-zinc-400">
          Открывай как приложение, без адресной строки
        </p>
      </div>
      <button
        onClick={install}
        className="rounded-full bg-zinc-100 px-4 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-zinc-200"
      >
        Install
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="grid h-8 w-8 place-items-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
