import { useCallback, useEffect, useState } from "react";

const SAME_TAB_EVENT = "localStorageChange";

interface SameTabDetail { key: string; value: string }

/** Persistent string preference (e.g. tab/mode).
 *  Synced across tabs via the native ``storage`` event, AND across components
 *  within the same tab via a custom event we dispatch on writes — so two
 *  hooks subscribed to the same key both re-render when either writes. */
export function useLocalStorageString<T extends string>(
  key: string,
  defaultValue: T,
  allowed?: readonly T[],
): [T, (next: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored != null && (!allowed || (allowed as readonly string[]).includes(stored))) {
        return stored as T;
      }
    } catch { /* private mode etc */ }
    return defaultValue;
  });

  const update = useCallback((next: T) => {
    setV(next);
    try {
      window.localStorage.setItem(key, next);
      window.dispatchEvent(new CustomEvent<SameTabDetail>(SAME_TAB_EVENT, {
        detail: { key, value: next },
      }));
    } catch { /* ignore */ }
  }, [key]);

  useEffect(() => {
    function isAllowed(val: string): boolean {
      return !allowed || (allowed as readonly string[]).includes(val);
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== key || e.newValue == null) return;
      if (!isAllowed(e.newValue)) return;
      setV(e.newValue as T);
    }
    function onSameTab(e: Event) {
      const detail = (e as CustomEvent<SameTabDetail>).detail;
      if (!detail || detail.key !== key) return;
      if (!isAllowed(detail.value)) return;
      setV(detail.value as T);
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener(SAME_TAB_EVENT, onSameTab);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SAME_TAB_EVENT, onSameTab);
    };
  }, [key, allowed]);

  return [v, update];
}
