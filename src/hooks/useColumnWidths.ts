import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

import {
  computeInitialWidths,
  type ColumnCategory,
} from "@/lib/columnCategory";

interface ColumnLike {
  name: string;
  category: ColumnCategory;
}

export interface UseColumnWidthsResult {
  widths: Record<string, number>;
  setWidth: (name: string, px: number) => void;
  reset: () => void;
}

function measureAndCompute(
  containerRef: RefObject<HTMLElement | null>,
  columns: ReadonlyArray<ColumnLike>,
): Record<string, number> {
  const el = containerRef.current;
  if (!el) return {};
  const containerPx = el.getBoundingClientRect().width;
  const measured = parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  // jsdom (and rare CSS resets) leave `fontSize` empty → NaN. Browsers
  // default to 16px for `:root`, so fall back to that to keep the
  // (c) formula numerically valid.
  const rootFontSizePx = Number.isFinite(measured) ? measured : 16;
  return computeInitialWidths(columns, containerPx, rootFontSizePx);
}

/**
 * Sprint 238 — DataGrid column widths 관리 훅.
 *
 * - Mount 1회 측정 (AC-238-03 (c) 산식 적용).
 * - Drag-resize 시 자기 column 만 변경 (AC-238-04, AC-238-11).
 * - container 폭 변동 시 재계산 안 함 (AC-238-04: 스크롤 중 폭 변동 회귀 차단).
 * - `reset()` → AC-238-03 산식 재실행 (AC-238-12 toolbar 버튼이 호출).
 * - schema 변경 자동 감지 없음 — columns prop 이 바뀌어도 기존 column
 *   width 보존, 새 column 은 default 폭 fallback (cmd+R 으로 명시적 재계산).
 */
export function useColumnWidths(
  columns: ReadonlyArray<ColumnLike>,
  containerRef: RefObject<HTMLElement | null>,
): UseColumnWidthsResult {
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    measureAndCompute(containerRef, columns),
  );

  // Production path: when the parent passes a `useRef(null)` that only
  // populates after the first render, the lazy `useState` initializer
  // returns `{}`. Re-measure once after layout so the (c) formula runs
  // against the real container width before paint.
  useLayoutEffect(() => {
    setWidths((prev) =>
      Object.keys(prev).length > 0
        ? prev
        : measureAndCompute(containerRef, columns),
    );
    // Mount-only — schema changes / container resizes do NOT re-measure
    // (AC-238-04). `reset()` is the explicit re-measurement trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setWidth = useCallback((name: string, px: number) => {
    setWidths((prev) => ({ ...prev, [name]: px }));
  }, []);

  const reset = useCallback(() => {
    setWidths(measureAndCompute(containerRef, columns));
  }, [containerRef, columns]);

  return { widths, setWidth, reset };
}
