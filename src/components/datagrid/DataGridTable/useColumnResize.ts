import { useCallback, useRef } from "react";
import { MIN_COL_WIDTH, calcDefaultColWidth } from "./columnUtils";

/**
 * `DataGridTable` column-resize hook.
 *
 * 책임: column header 의 resize handle mousedown → drag → mouseup 사이클을
 * 캡슐화. drag 중에는 직접 DOM mutation 으로 즉시 시각 피드백 (table /
 * th / td 의 width style), drag 끝에 `onColumnWidthsChange` 로 store
 * 동기화. 한 번에 한 컬럼만 resize — 두 번째 resize 가 시작되면 첫
 * resize 의 final width 부터 계산 시작.
 *
 * Sprint 200 에서 entry 로부터 추출. 동작 0 변경.
 *
 * 외부 invariant:
 * - mouseup 시 document 에서 mousemove / mouseup listener 제거 + body
 *   cursor / userSelect 복원. cleanup 누락 시 drag 후에도 cursor 가
 *   "col-resize" 로 박혀 회귀.
 * - drag 중 DOM mutation 은 의도적 — `useState` 기반 store update 를
 *   매 mousemove 마다 호출하면 React reconciliation 비용이 너무 큼.
 *   final width 만 store 에 push 하는 패턴은 Sprint 200 분해 이전부터
 *   동결.
 * - `columnWidths[colName]` 우선, 없으면 DOM 측정, 그래도 없으면
 *   `calcDefaultColWidth` fallback. 두 번째 resize 가 첫 resize 결과를
 *   계승하기 위함.
 */

export interface UseColumnResizeArgs {
  tableRef: React.RefObject<HTMLTableElement | null>;
  columnWidths: Record<string, number>;
  onColumnWidthsChange: (
    updater: (prev: Record<string, number>) => Record<string, number>,
  ) => void;
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
  columnWidths,
  onColumnWidthsChange,
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
      // from the result of the first one, not from the default/DOM value.
      const currentWidth =
        columnWidths[colName] ??
        th?.getBoundingClientRect().width ??
        calcDefaultColWidth(colName, "");
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
        const newWidth = Math.max(
          MIN_COL_WIDTH,
          resizingRef.current.startWidth + delta,
        );
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
          onColumnWidthsChange((prev) => ({
            ...prev,
            [resizedColName]: w,
          }));
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
    [tableRef, columnWidths, onColumnWidthsChange],
  );

  return { handleResizeStart };
}
