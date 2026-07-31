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
 * Sprint 258 — DataGrid column widths 관리 훅.
 * Sprint 369 (Phase 4) — 영속 매체를 localStorage → SQLite (`datagrid_column_prefs`)
 * 로 전환. `pk` 가 제공되면 mount 시 `get_datagrid_prefs` IPC 1회로 hydrate,
 * setWidth 호출 시 `set_datagrid_prefs` widths-only partial patch, reset 시
 * `reset_datagrid_prefs(field="widths")` 를 디스패치.
 *
 * - mount 1회: column 별 default rem * rootFontSize.
 * - `pk` 부재: in-memory only (ad-hoc query grid). IPC / LS 접근 모두 0.
 * - drag-resize 시 자기 column 만 변경 (AC-258-04). 결과 즉시 IPC 로 전송.
 * - `reset()` → 초기 widths 재계산 + IPC reset (codex 7차 #1 — widths reset 이
 *   hidden 을 풀거나 그 반대는 0).
 *
 * Sprint 238 의 컨테이너 fit (sum < containerPx 일 때 비례 확대) 폐기.
 * `<table>` → CSS Grid 전환 (sprint-258) 후에는 stretch 의 _근거 자체_ 가
 * 사라졌으므로 (c) 산식이 단순 default-rem * px 로 환원된다.
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
