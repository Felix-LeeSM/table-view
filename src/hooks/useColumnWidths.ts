import { useCallback, useState } from "react";

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

function readRootFontSizePx(): number {
  if (typeof window === "undefined") return 16;
  const measured = parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  // jsdom (and rare CSS resets) leave `fontSize` empty → NaN. Browsers
  // default to 16px for `:root`.
  return Number.isFinite(measured) ? measured : 16;
}

/**
 * Sprint 258 — DataGrid column widths 관리 훅.
 *
 * - mount 1회: column 별 default rem * rootFontSize.
 * - drag-resize 시 자기 column 만 변경 (AC-258-04).
 * - container 폭 변동 시 재계산 안 함.
 * - `reset()` → 초기 widths 재계산 (toolbar 버튼 + cmd+shift+r 단축키 호출).
 *
 * Sprint 238 의 컨테이너 fit (sum < containerPx 일 때 비례 확대) 폐기.
 * `<table>` → CSS Grid 전환 (sprint-258) 후에는 stretch 의 _근거 자체_ 가
 * 사라졌으므로 (c) 산식이 단순 default-rem * px 로 환원된다.
 */
export function useColumnWidths(
  columns: ReadonlyArray<ColumnLike>,
): UseColumnWidthsResult {
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    computeInitialWidths(columns, readRootFontSizePx()),
  );

  const setWidth = useCallback((name: string, px: number) => {
    setWidths((prev) => ({ ...prev, [name]: px }));
  }, []);

  const reset = useCallback(() => {
    setWidths(computeInitialWidths(columns, readRootFontSizePx()));
  }, [columns]);

  return { widths, setWidth, reset };
}
