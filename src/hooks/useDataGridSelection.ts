// AC-193-02 — sub-hook for the multi-row selection state/actions, split
// out of useDataGridEdit. It is paradigm-agnostic (RDB and document use the
// same signature) and bundles selectedRowIds (Set<number>) + anchorRowIdx
// (range start) + handleSelectRow (four branches: single / meta-toggle /
// shift-range / shift-fallback) as one responsibility.
//
// `selectedRowIdx` is a backward-compat derived value — the one idx only
// when set.size === 1, otherwise (0 or ≥2) null.
//
// The facade's useEffect resets the selection on page change (through the
// exposed `clearSelection`). The hook itself knows nothing about pages — a
// later change to the pagination policy leaves the hook signature unaffected.
// date 2026-05-02.
import { useCallback, useState } from "react";

export interface UseDataGridSelectionReturn {
  selectedRowIds: Set<number>;
  anchorRowIdx: number | null;
  // Derived: size === 1 → that idx, else null (a deliberate sentinel).
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

  // Backward-compat derived value; see `selectedRowIdx` in
  // `UseDataGridSelectionReturn`.
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
