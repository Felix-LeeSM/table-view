import { useCallback, useEffect, useState } from "react";

import {
  type ColumnCategory,
  computeInitialWidths,
} from "@/lib/columnCategory";
import {
  type ColumnPrefsPk,
  getDatagridPrefs,
  resetDatagridPrefs,
  setDatagridPrefs,
} from "@/lib/tauri/datagrid_prefs";

interface ColumnLike {
  name: string;
  category: ColumnCategory;
}

export interface UseColumnWidthsResult {
  widths: Record<string, number>;
  setWidth: (name: string, px: number) => void;
  reset: () => void;
}

function readRootFontSizePx(): number {
  if (typeof window === "undefined") return 16;
  const measured = parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  // jsdom (and rare CSS resets) leave `fontSize` empty → NaN. Browsers
  // default to 16px for `:root`.
  return Number.isFinite(measured) ? measured : 16;
}

function mergeStoredWidths(
  columns: ReadonlyArray<ColumnLike>,
  defaults: Record<string, number>,
  stored: Record<string, unknown>,
): Record<string, number> {
  const merged: Record<string, number> = { ...defaults };
  for (const col of columns) {
    const v = stored[col.name];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      merged[col.name] = v;
    }
  }
  return merged;
}

/**
 * Manages DataGrid column widths.
 * The persistence medium moved from localStorage to SQLite
 * (`datagrid_column_prefs`). With a `pk`, the hook hydrates with one
 * `get_datagrid_prefs` IPC on mount, sends a widths-only partial patch via
 * `set_datagrid_prefs` on setWidth, and dispatches
 * `reset_datagrid_prefs(field="widths")` on reset.
 *
 * - On mount: per-column default rem * rootFontSize.
 * - No `pk`: in-memory only (ad-hoc query grid), with no IPC or localStorage
 *   access.
 * - Drag-resize changes only its own column (AC-258-04). The result goes
 *   over IPC right away.
 * - `reset()` → recompute the initial widths + IPC reset. A widths reset
 *   does not unhide columns, and vice versa.
 *
 * The container fit (proportional stretch when sum < containerPx) was
 * dropped. After the `<table>` → CSS Grid switch the very _reason_ to
 * stretch is gone, so the width formula reduces to plain default-rem * px.
 */
export function useColumnWidths(
  columns: ReadonlyArray<ColumnLike>,
  pk?: ColumnPrefsPk,
): UseColumnWidthsResult {
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    computeInitialWidths(columns, readRootFontSizePx()),
  );

  // Re-derive defaults whenever columns shape changes — column rename or
  // table swap remounts a different shape, and the IPC hydrate effect
  // below replaces these once the response lands.
  const colsKey = columns.map((c) => c.name).join(" ");
  useEffect(() => {
    setWidths(computeInitialWidths(columns, readRootFontSizePx()));
    // colsKey identifies the column shape; including `columns` array
    // identity would cause an infinite loop on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colsKey]);

  // Stable key for the IPC effect dependency — JSON.stringify avoids a
  // dep array of 5 individually-volatile strings.
  const pkKey = pk ? JSON.stringify(pk) : null;

  // Mount + pk swap: hydrate from SQLite.
  useEffect(() => {
    if (!pk) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await getDatagridPrefs(pk);
        if (cancelled) return;
        const defaults = computeInitialWidths(columns, readRootFontSizePx());
        setWidths(
          mergeStoredWidths(
            columns,
            defaults,
            resp.widths as Record<string, unknown>,
          ),
        );
      } catch {
        // best-effort hydrate — IPC failure leaves the defaults visible.
        // Drag changes will still propagate via setWidth's set IPC.
      }
    })();
    return () => {
      cancelled = true;
    };
    // pkKey collapses the 5-tuple identity into a single string so we
    // re-run only when the actual identity changes; columns are tracked
    // via colsKey above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkKey]);

  const setWidth = useCallback(
    (name: string, px: number) => {
      setWidths((prev) => {
        const next = { ...prev, [name]: px };
        if (pk) {
          // Fire IPC widths-only patch. Failure is silent — drag UX
          // shouldn't toast on a transient backend hiccup; next drag
          // re-tries.
          void setDatagridPrefs({ ...pk, widths: next }).catch(() => {
            /* best-effort; UI state already reflects the drag */
          });
        }
        return next;
      });
    },
    [pk],
  );

  const reset = useCallback(() => {
    const next = computeInitialWidths(columns, readRootFontSizePx());
    setWidths(next);
    if (pk) {
      void resetDatagridPrefs({ ...pk, field: "widths" }).catch(() => {
        /* best-effort */
      });
    }
  }, [columns, pk]);

  return { widths, setWidth, reset };
}
