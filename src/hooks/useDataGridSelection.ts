// AC-193-02 — multi-row selection 상태/액션을 useDataGridEdit 에서 분리한
// sub-hook. paradigm-agnostic (RDB/document 양쪽이 동일 시그니처 사용)
// 이며 selectedRowIds (Set<number>) + anchorRowIdx (range 시작점) +
// handleSelectRow (single / meta-toggle / shift-range / shift-fallback
// 4 분기) 를 한 책임으로 묶는다.
//
// `selectedRowIdx` 는 backward-compat derived 값 — set.size === 1 일
// 때만 그 한 idx, 그 외 (0 또는 ≥2) 는 null. DataGridToolbar 의 single
// selection 액션 (delete one / duplicate one) 이 이 값을 읽는다.
//
// 페이지 전환 시 selection 자동 리셋은 facade 의 useEffect 가 담당
// (`clearSelection` 노출). hook 자체는 page 개념을 모른다 — pagination
// 정책이 향후 바뀌어도 hook 시그니처는 영향받지 않는다.
// date 2026-05-02.
import { useCallback, useState } from "react";

export interface UseDataGridSelectionReturn {
  selectedRowIds: Set<number>;
  anchorRowIdx: number | null;
  // derived: size === 1 → 그 idx, else null. 멀티 선택 시 toolbar 의
  // single-row 액션은 비활성화돼야 하므로 null 이 의도적인 sentinel.
  selectedRowIdx: number | null;
  handleSelectRow(rowIdx: number, metaKey: boolean, shiftKey: boolean): void;
  clearSelection(): void;
}

export function useDataGridSelection(): UseDataGridSelectionReturn {
  const [selectedRowIds, setSelectedRowIds] = useState<Set<number>>(new Set());
  const [anchorRowIdx, setAnchorRowIdx] = useState<number | null>(null);

  const handleSelectRow = useCallback(
    (rowIdx: number, metaKey: boolean, shiftKey: boolean) => {
      if (metaKey) {
        // Cmd/Ctrl+Click: toggle individual row
        setSelectedRowIds((prev) => {
          const next = new Set(prev);
          if (next.has(rowIdx)) {
            next.delete(rowIdx);
          } else {
            next.add(rowIdx);
          }
          return next;
        });
        // Set anchor if this is the first selection
        setAnchorRowIdx((prev) => (prev === null ? rowIdx : prev));
      } else if (shiftKey && anchorRowIdx !== null) {
        // Shift+Click with anchor: range selection
        const start = Math.min(anchorRowIdx, rowIdx);
        const end = Math.max(anchorRowIdx, rowIdx);
        const range = new Set<number>();
        for (let i = start; i <= end; i++) {
          range.add(i);
        }
        setSelectedRowIds(range);
      } else if (shiftKey && anchorRowIdx === null) {
        // Shift+Click without anchor: fallback to single selection
        setSelectedRowIds(new Set([rowIdx]));
        setAnchorRowIdx(rowIdx);
      } else {
        // Normal click: single selection
        setSelectedRowIds(new Set([rowIdx]));
        setAnchorRowIdx(rowIdx);
      }
    },
    [anchorRowIdx],
  );

  const clearSelection = useCallback(() => {
    setSelectedRowIds(new Set());
    setAnchorRowIdx(null);
  }, []);

  // backward-compat derived: single-row 액션이 사용. 멀티 선택 시에는
  // null 로 떨어져 toolbar 의 단일-행 액션이 비활성화된다.
  const selectedRowIdx =
    selectedRowIds.size === 1 ? [...selectedRowIds][0]! : null;

  return {
    selectedRowIds,
    anchorRowIdx,
    selectedRowIdx,
    handleSelectRow,
    clearSelection,
  };
}
