import { useCallback, useRef } from "react";
import type { TableData } from "@/types/schema";
import { cellToEditValue, editKey } from "../dataGridEditFsm";

/**
 * `DataGridTable`'s inline-edit cursor movement hook.
 *
 * Responsibility: one behaviour — Tab / Shift-Tab / Enter / Shift-Enter move
 * the active editor to the next cell / previous cell / next row / previous
 * row. At the end of a row it wraps to the first column of the next row; at
 * the end of the grid it commits the current edit and stops. `order`
 * decides the visual sequence, so next/prev follow the order the user sees.
 *
 * Invariants:
 * - `value` in `onStartEdit(row, col, value)` is the pending edit when there
 *   is one, otherwise `cellToEditValue(cell)`. This hook owns that decision
 *   — the caller need not call `onSaveCurrentEdit` first (`onStartEdit`
 *   itself commits the in-flight edit and opens the next cell).
 * - Crossing the grid boundary only calls `onSaveCurrentEdit` and stops —
 *   it does not wrap back to (0,0).
 */

export type CellNavigationDirection =
  | "next-col"
  | "prev-col"
  | "next-row"
  | "prev-row";

export interface UseCellNavigationArgs {
  data: TableData;
  order: number[];
  pendingEdits: Map<string, string | null>;
  onSaveCurrentEdit: () => void;
  onStartEdit: (
    rowIdx: number,
    colIdx: number,
    currentValue: string | null,
  ) => void;
}

export interface CellNavigation {
  moveEditCursor: (
    currentRow: number,
    currentDataCol: number,
    direction: CellNavigationDirection,
  ) => void;
}

export function useCellNavigation({
  data,
  order,
  pendingEdits,
  onSaveCurrentEdit,
  onStartEdit,
}: UseCellNavigationArgs): CellNavigation {
  // Issue #1446 — read pendingEdits from a ref so `moveEditCursor` keeps a
  // stable identity across edit commits. It's only invoked on a user Tab/
  // Enter, which always wants the latest pending value — no staleness risk.
  const pendingEditsRef = useRef(pendingEdits);
  pendingEditsRef.current = pendingEdits;
  const moveEditCursor = useCallback(
    (
      currentRow: number,
      currentDataCol: number,
      direction: CellNavigationDirection,
    ) => {
      const totalRows = data.rows.length;
      if (totalRows === 0) return;
      const totalCols = order.length;
      if (totalCols === 0) return;

      const visualCol = order.indexOf(currentDataCol);
      if (visualCol === -1) return;

      let nextRow = currentRow;
      let nextVisualCol = visualCol;

      if (direction === "next-col") {
        nextVisualCol = visualCol + 1;
        if (nextVisualCol >= totalCols) {
          nextVisualCol = 0;
          nextRow = currentRow + 1;
        }
      } else if (direction === "prev-col") {
        nextVisualCol = visualCol - 1;
        if (nextVisualCol < 0) {
          nextVisualCol = totalCols - 1;
          nextRow = currentRow - 1;
        }
      } else if (direction === "next-row") {
        nextRow = currentRow + 1;
      } else if (direction === "prev-row") {
        nextRow = currentRow - 1;
      }

      if (nextRow < 0 || nextRow >= totalRows) {
        // Past the edge of the grid — just save and stop here
        onSaveCurrentEdit();
        return;
      }

      const nextDataCol = order[nextVisualCol]!;
      const nextCell = (data.rows[nextRow] as unknown[])[nextDataCol];
      const editKeyStr = editKey(nextRow, nextDataCol);
      const pendingValue = pendingEditsRef.current.get(editKeyStr);
      const startValue =
        pendingValue !== undefined ? pendingValue : cellToEditValue(nextCell);

      // onStartEdit persists the current in-flight edit before opening
      // the next cell, so callers don't need to call onSaveCurrentEdit.
      onStartEdit(nextRow, nextDataCol, startValue);
    },
    [data.rows, order, onSaveCurrentEdit, onStartEdit],
  );

  return { moveEditCursor };
}
