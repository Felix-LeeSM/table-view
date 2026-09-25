import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type ColumnPrefsPk,
  getDatagridPrefs,
  setDatagridPrefs,
} from "@/lib/tauri/datagrid_prefs";

/**
 * Manages DataGrid column hide / show state.
 * The persistence medium moved from localStorage to the SQLite SOT.
 *
 * - With a `pk`, the hook hydrates with one `get_datagrid_prefs` IPC on
 *   mount, and hide/show/toggle/clear send a `set_datagrid_prefs`
 *   hiddenColumns patch (widths omitted → the backend keeps them).
 * - Without a `pk` (ad-hoc / temporary grid): in-memory only, with no IPC
 *   or localStorage access.
 *
 * The backend guarantees, through the partial patch, the invariant that a
 * hidden change does not touch widths. This hook upholds that guarantee at
 * call time by leaving the `widths` field out of the patch.
 */

export interface UseHiddenColumnsResult {
  hidden: ReadonlySet<string>;
  hide: (name: string) => void;
  show: (name: string) => void;
  toggle: (name: string) => void;
  clear: () => void;
  isHidden: (name: string) => boolean;
}

export function useHiddenColumns(pk?: ColumnPrefsPk): UseHiddenColumnsResult {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  // Stable signature for the IPC effect — JSON identity over the 5-tuple.
  const pkKey = pk ? JSON.stringify(pk) : null;

  // Mount + pk swap: hydrate from SQLite.
  useEffect(() => {
    if (!pk) {
      // When pk goes away (switch to in-memory mode), reset hidden too.
      setHidden(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await getDatagridPrefs(pk);
        if (cancelled) return;
        setHidden(new Set(resp.hiddenColumns));
      } catch {
        // best-effort hydrate. On failure the current set is kept (empty
        // on mount).
      }
    })();
    return () => {
      cancelled = true;
    };
    // Key off the stable `pkKey` string, not the `pk` object — `pk` is a fresh
    // reference each render, so depending on it would re-hydrate every render.
    // `setHidden` is a stable setter (cf. useColumnWidths).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkKey]);

  // Sends a hidden change to the backend. The argument is the *next* set —
  // the caller passes it directly to avoid a stale closure over React state.
  const persist = useCallback(
    (next: Set<string>) => {
      if (!pk) return;
      void setDatagridPrefs({
        ...pk,
        hiddenColumns: Array.from(next),
      }).catch(() => {
        /* best-effort — next mutate will retry */
      });
    },
    [pk],
  );

  const hide = useCallback(
    (name: string) => {
      setHidden((prev) => {
        if (prev.has(name)) return prev;
        const next = new Set(prev);
        next.add(name);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const show = useCallback(
    (name: string) => {
      setHidden((prev) => {
        if (!prev.has(name)) return prev;
        const next = new Set(prev);
        next.delete(name);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const toggle = useCallback(
    (name: string) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const clear = useCallback(() => {
    setHidden(new Set());
    persist(new Set());
  }, [persist]);

  // Stable reference for callers that depend on `isHidden` identity in
  // memo/dep arrays.
  const isHidden = useMemo(() => (name: string) => hidden.has(name), [hidden]);

  return { hidden, hide, show, toggle, clear, isHidden };
}
