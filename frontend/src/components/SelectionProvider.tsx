import {
  createContext, useCallback, useContext, useMemo, useState,
} from "react";
import type { Video } from "../lib/api";

/** Global selection state — a set of video PKs and their video_ids together,
 *  since the bulk endpoints take both (delete uses int pk, patch uses string
 *  video_id). Lives at the Layout level so it survives Route changes; cleared
 *  via Esc, Cancel button, or the user explicitly closing it. */

export interface SelectionContextValue {
  selected:      Map<number, string>; // pk → video_id
  isSelected:    (pk: number) => boolean;
  toggle:        (v: Video) => void;
  clear:         () => void;
  count:         number;
  inSelectMode:  boolean;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Map<number, string>>(new Map());

  const toggle = useCallback((v: Video) => {
    setSelected((cur) => {
      const next = new Map(cur);
      if (next.has(v.id)) next.delete(v.id);
      else                next.set(v.id, v.video_id);
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Map()), []);
  const isSelected = useCallback((pk: number) => selected.has(pk), [selected]);

  const value = useMemo<SelectionContextValue>(() => ({
    selected, isSelected, toggle, clear,
    count: selected.size,
    inSelectMode: selected.size > 0,
  }), [selected, isSelected, toggle, clear]);

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used inside <SelectionProvider>");
  return ctx;
}
