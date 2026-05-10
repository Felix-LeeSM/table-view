import { useCallback, useRef } from "react";

/**
 * Sprint 258 — column-resize hook for the CSS-Grid DataGrid.
 *
 * drag 중에는 outer container 의 `--cols` CSS variable 만 imperative 갱신
 * (per-frame setState 회피). drag-end 시 `onCommitWidth(name, px)` 로 React
 * state 커밋 → 다음 render 가 동일 `--cols` 값을 다시 발행 → 시각 회귀 0.
 *
 * Sprint 238 의 `<table>` / `<th>` querySelector 기반 imperative DOM mutate
 * 는 폐기. CSS variable cascade 가 모든 row 의 grid-template-columns 를
 * 한 곳에서 통제한다.
 */

export interface UseColumnResizeArgs {
  /**
   * Outer scroll container (`<div role="grid">`). 본 hook 이 `--cols` CSS
   * variable 을 직접 mutate 하는 단일 element.
   */
  outerRef: React.RefObject<HTMLElement | null>;
  /**
   * Visual order 의 현재 widths (px). drag-time 에 자기 column index 만
   * 갱신해서 새 `--cols` 문자열을 만든다.
   */
  getCurrentWidths: () => number[];
  /** drag-end 시 React state 커밋. */
  onCommitWidth: (colName: string, px: number) => void;
}

export interface ColumnResize {
  handleResizeStart: (
    e: React.MouseEvent,
    colName: string,
    visualIdx: number,
  ) => void;
}

function colsToCssValue(widths: ReadonlyArray<number>): string {
  return widths.map((w) => `${w}px`).join(" ");
}

export function useColumnResize({
  outerRef,
  getCurrentWidths,
  onCommitWidth,
}: UseColumnResizeArgs): ColumnResize {
  const resizingRef = useRef<{
    colName: string;
    visualIdx: number;
    startX: number;
    startWidth: number;
    lastWidth: number;
  } | null>(null);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, colName: string, visualIdx: number) => {
      e.stopPropagation();
      e.preventDefault();
      const startWidths = getCurrentWidths();
      const startWidth = startWidths[visualIdx] ?? 0;
      resizingRef.current = {
        colName,
        visualIdx,
        startX: e.clientX,
        startWidth,
        lastWidth: startWidth,
      };

      const applyWidth = (newWidth: number) => {
        const outer = outerRef.current;
        if (!outer || !resizingRef.current) return;
        const widths = [...getCurrentWidths()];
        widths[resizingRef.current.visualIdx] = newWidth;
        outer.style.setProperty("--cols", colsToCssValue(widths));
        resizingRef.current.lastWidth = newWidth;
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!resizingRef.current) return;
        const delta = moveEvent.clientX - resizingRef.current.startX;
        // AC-258-04 — no min/max guard. user-free policy.
        const newWidth = Math.max(0, resizingRef.current.startWidth + delta);
        applyWidth(newWidth);
      };

      const handleMouseUp = () => {
        const session = resizingRef.current;
        resizingRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        if (session) {
          onCommitWidth(session.colName, session.lastWidth);
        }
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [outerRef, getCurrentWidths, onCommitWidth],
  );

  return { handleResizeStart };
}
