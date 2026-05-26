import { useCallback, useEffect, useState } from "react";

const SAME_TAB_EVENT = "localStorageChange";
interface SameTabDetail { key: string; value: string }

/** Persistent boolean preference. Same key shared across the app.
 *
 *  Syncs both across tabs (native ``storage`` event) AND across components in
 *  the same tab (custom event we dispatch on writes) — two hooks watching the
 *  same key both re-render when either writes. */
export function useLocalStorageBool(
  key: string,
  defaultValue: boolean,
): [boolean, (next: boolean) => void] {
  const [v, setV] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored == null ? defaultValue : stored === "1";
    } catch {
      return defaultValue;
    }
  });

  const update = useCallback((next: boolean) => {
    setV(next);
    try {
      window.localStorage.setItem(key, next ? "1" : "0");
      window.dispatchEvent(new CustomEvent<SameTabDetail>(SAME_TAB_EVENT, {
        detail: { key, value: next ? "1" : "0" },
      }));
    } catch { /* quota / private */ }
  }, [key]);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === key && e.newValue != null) setV(e.newValue === "1");
    }
    function onSameTab(e: Event) {
      const d = (e as CustomEvent<SameTabDetail>).detail;
      if (d && d.key === key) setV(d.value === "1");
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener(SAME_TAB_EVENT, onSameTab);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SAME_TAB_EVENT, onSameTab);
    };
  }, [key]);

  return [v, update];
}
