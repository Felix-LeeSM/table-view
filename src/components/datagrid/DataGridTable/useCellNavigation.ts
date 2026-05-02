import { useCallback } from "react";
import type { TableData } from "@/types/schema";
import { editKey, cellToEditValue } from "../useDataGridEdit";

/**
 * `DataGridTable` 의 inline-edit cursor 이동 hook.
 *
 * 책임: Tab / Shift-Tab / Enter / Shift-Enter 로 다음 셀 / 이전 셀 /
 * 다음 행 / 이전 행 으로 active editor 를 옮기는 한 가지 동작. 행 끝에
 * 닿으면 다음 행 첫 컬럼으로 wrap, 그리드 끝에 닿으면 현재 편집을
 * commit 하고 멈춤. 시각 (visual) 순서는 `order` 가 결정 — 사용자가
 * 보는 순서대로 next/prev 가 해석됨.
 *
 * Sprint 200 에서 entry 로부터 추출. 동작/시그니처 변경 0.
 *
 * 외부 invariant:
 * - `onStartEdit(row, col, value)` 의 `value` 는 pending edit 이 있으면
 *   그 값, 없으면 `cellToEditValue(cell)`. 본 hook 이 값 결정 책임을
 *   짊어짐 — 호출자가 미리 `onSaveCurrentEdit` 을 부를 필요 없음
 *   (`onStartEdit` 자체가 in-flight edit 을 commit 하고 다음 셀 연다).
 * - 그리드 boundary 를 넘으면 `onSaveCurrentEdit` 만 부르고 종료 — (0,0)
 *   으로 wrap 안 함.
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
      const pendingValue = pendingEdits.get(editKeyStr);
      const startValue =
        pendingValue !== undefined ? pendingValue : cellToEditValue(nextCell);

      // onStartEdit persists the current in-flight edit before opening
      // the next cell, so callers don't need to call onSaveCurrentEdit.
      onStartEdit(nextRow, nextDataCol, startValue);
    },
    [data.rows, order, pendingEdits, onSaveCurrentEdit, onStartEdit],
  );

  return { moveEditCursor };
}
