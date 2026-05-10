import { useCallback, useRef } from "react";

/**
 * Column-resize hook for `DataGridTable`. Owns the mousedown → drag →
 * mouseup cycle. During drag, mutates `table/th/td` width styles
 * directly for immediate feedback; on mouseup, commits the final width
 * via `onCommitWidth(name, px)` (Sprint 238 — single-column commit
 * replaces the pre-238 `onColumnWidthsChange((prev) => ...)` updater
 * since `useColumnWidths` already owns the per-column state).
 *
 * Invariants:
 * - mouseup must remove listeners and restore body cursor/userSelect,
 *   else the cursor stays stuck on "col-resize".
 * - Per-frame DOM mutation (vs setState) is intentional — `useState`
 *   on every mousemove triggers full React reconciliation per frame.
 * - Initial width prefers `getStartWidth(colName)`, then DOM
 *   measurement, so consecutive resizes compound.
 */

export interface UseColumnResizeArgs {
  tableRef: React.RefObject<HTMLTableElement | null>;
  /**
   * Returns the committed width for the column, or `undefined` if no
   * drag has occurred yet (in which case the resize starts from the
   * DOM-measured `<th>` width).
   */
  getStartWidth: (colName: string) => number | undefined;
  onCommitWidth: (colName: string, px: number) => void;
}

export interface ColumnResize {
  handleResizeStart: (
    e: React.MouseEvent,
    colName: string,
    colIdx: number,
  ) => void;
}

export function useColumnResize({
  tableRef,
  getStartWidth,
  onCommitWidth,
}: UseColumnResizeArgs): ColumnResize {
  const resizingRef = useRef<{
    colName: string;
    startX: number;
    startWidth: number;
    startTableWidth: number;
    colIdx: number;
  } | null>(null);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, colName: string, colIdx: number) => {
      e.stopPropagation();
      e.preventDefault();
      const th = tableRef.current?.querySelector(
        `th:nth-child(${colIdx + 1})`,
      ) as HTMLElement | null;
      // Prioritise the stored width so that a second resize always starts
      // from the result of the first one, not from the DOM-measured value.
      const currentWidth =
        getStartWidth(colName) ?? th?.getBoundingClientRect().width ?? 0;
      const startTableWidth =
        tableRef.current?.getBoundingClientRect().width ?? 0;
      resizingRef.current = {
        colName,
        startX: e.clientX,
        startWidth: currentWidth,
        startTableWidth,
        colIdx,
      };

      const applyWidth = (width: number) => {
        if (!tableRef.current || !resizingRef.current) return;
        const delta = width - resizingRef.current.startWidth;
        tableRef.current.style.width = `${resizingRef.current.startTableWidth + delta}px`;
        const w = `${width}px`;
        const th = tableRef.current.querySelector(
          `th:nth-child(${colIdx + 1})`,
        ) as HTMLElement | null;
        if (th) th.style.width = w;
        const cells = tableRef.current.querySelectorAll(
          `td:nth-child(${colIdx + 1})`,
        );
        cells.forEach((td) => {
          (td as HTMLElement).style.width = w;
        });
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!resizingRef.current) return;
        const delta = moveEvent.clientX - resizingRef.current.startX;
        // AC-238-04 — no min/max guard. User free policy.
        const newWidth = Math.max(0, resizingRef.current.startWidth + delta);
        applyWidth(newWidth);
      };

      const handleMouseUp = () => {
        if (resizingRef.current) {
          const {
            colName: resizedColName,
            colIdx: resizedColIdx,
            startWidth,
          } = resizingRef.current;
          const finalWidth = tableRef.current?.querySelector(
            `th:nth-child(${resizedColIdx + 1})`,
          ) as HTMLElement | null;
          const rawW = finalWidth ? parseInt(finalWidth.style.width, 10) : NaN;
          const w = Number.isNaN(rawW) ? startWidth : rawW;
          onCommitWidth(resizedColName, w);
        }
        resizingRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [tableRef, getStartWidth, onCommitWidth],
  );

  return { handleResizeStart };
}
