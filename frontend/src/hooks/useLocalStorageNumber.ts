import { useCallback, useEffect, useState } from "react";

const SAME_TAB_EVENT = "localStorageChange";

interface SameTabDetail { key: string; value: string }

/** Persistent numeric preference, clamped to [min, max].
 *  Synced across tabs (native ``storage`` event) and across components in the
 *  same tab (a custom event we dispatch on write) — same machinery as
 *  ``useLocalStorageString``. */
export function useLocalStorageNumber(
  key: string,
  defaultValue: number,
  min: number,
  max: number,
): [number, (next: number) => void] {
  const clamp = useCallback(
    (n: number) => Math.max(min, Math.min(max, Math.round(n))),
    [min, max],
  );

  const read = useCallback((): number => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored != null) {
        const n = Number(stored);
        if (Number.isFinite(n)) return clamp(n);
      }
    } catch { /* private mode etc */ }
    return clamp(defaultValue);
  }, [key, defaultValue, clamp]);

  const [v, setV] = useState<number>(read);

  const update = useCallback((next: number) => {
    const n = clamp(next);
    setV(n);
    try {
      window.localStorage.setItem(key, String(n));
      window.dispatchEvent(new CustomEvent<SameTabDetail>(SAME_TAB_EVENT, {
        detail: { key, value: String(n) },
      }));
    } catch { /* ignore */ }
  }, [key, clamp]);

  useEffect(() => {
    function apply(raw: string | null) {
      if (raw == null) return;
      const n = Number(raw);
      if (Number.isFinite(n)) setV(clamp(n));
    }
    function onStorage(e: StorageEvent) { if (e.key === key) apply(e.newValue); }
    function onSameTab(e: Event) {
      const detail = (e as CustomEvent<SameTabDetail>).detail;
      if (detail?.key === key) apply(detail.value);
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener(SAME_TAB_EVENT, onSameTab);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SAME_TAB_EVENT, onSameTab);
    };
  }, [key, clamp]);

  return [v, update];
}
