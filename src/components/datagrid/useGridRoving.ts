import { useCallback, useRef, useState } from "react";

/**
 * WAI-ARIA grid roving-tabindex + arrow-key 2D navigation (datagrid 공용).
 *
 * grid 의 data cell 중 정확히 하나만 tab order 에 있고 (`tabIndex=0`), 나머지는
 * `-1` 이다. 사용자는 방향키로 focus 를 옮긴다. 좌표계는 `row`=0-based data row,
 * `col`=0-based visual column.
 *
 * focus split (SchemaTree/useTreeRoving 회귀 교훈):
 * - `syncFocus` (cell `onFocus`): roving STATE 만 갱신. `.focus()` 호출 금지.
 *   cell 이 이미 focus 를 쥐고 있으므로, 여기서 deferred `.focus()` 를 걸면
 *   사용자가 다른 컨트롤(예: SQL 에디터)로 이동한 뒤 rAF 가 focus 를 도로
 *   낚아채 키 입력을 떨어뜨린다 (mariadb E2E 회귀).
 * - `onKeyDown` (방향키): 이것만 DOM focus 를 움직인다 (rAF 로 defer).
 *
 * 현재 focus cell 을 ref 로 미러링해 keydown handler 가 최신값을 stale closure
 * 없이 읽는다 (useTreeRoving 패턴).
 */

export interface GridRoving {
  focusedCell: { row: number; col: number };
  /** cell `onFocus` 용 — STATE ONLY. `.focus()` 를 호출하지 않는다. */
  syncFocus: (row: number, col: number) => void;
  /** `role="grid"` 컨테이너용 — 방향키/Home/End. 이것만 DOM focus 를 움직인다. */
  onKeyDown: (e: React.KeyboardEvent) => void;
  cellTabIndex: (row: number, col: number) => 0 | -1;
}

const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);

export function useGridRoving(
  rowCount: number,
  colCount: number,
  containerRef: React.RefObject<HTMLElement | null>,
): GridRoving {
  const [focusedCell, setFocusedCell] = useState({ row: 0, col: 0 });
  const focusedRef = useRef(focusedCell);
  focusedRef.current = focusedCell;

  // rowCount/colCount 가 줄면 focus 가 범위 밖일 수 있다. clamp 해서 정확히
  // 한 cell 만 tab stop 이 되도록 한다 (범위 밖이면 (0,0) 이 tab stop).
  const clampedRow = rowCount > 0 ? clamp(focusedCell.row, rowCount - 1) : 0;
  const clampedCol = colCount > 0 ? clamp(focusedCell.col, colCount - 1) : 0;

  const cellTabIndex = useCallback(
    (row: number, col: number): 0 | -1 =>
      row === clampedRow && col === clampedCol ? 0 : -1,
    [clampedRow, clampedCol],
  );

  // mouse / programmatic focus sync: cell 이 이미 focus 를 쥐고 있으므로
  // roving anchor 만 옮긴다. `.focus()` 는 부르지 않는다 (focus-steal 방지).
  const syncFocus = useCallback((row: number, col: number) => {
    const next = { row, col };
    focusedRef.current = next;
    setFocusedCell(next);
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const { key } = e;
      if (
        key !== "ArrowUp" &&
        key !== "ArrowDown" &&
        key !== "ArrowLeft" &&
        key !== "ArrowRight" &&
        key !== "Home" &&
        key !== "End"
      ) {
        return;
      }
      // data cell 이 focus 를 쥔 경우에만 동작. header cell / resize separator /
      // editing <input> / nested toggle button 은 [data-grid-row] 가 없어
      // 여기서 걸러진다 → 그들의 키는 그대로 둔다.
      const target = e.target as HTMLElement;
      if (!target.matches("[data-grid-row]")) return;
      if (rowCount === 0 || colCount === 0) return;

      e.preventDefault();

      const { row, col } = focusedRef.current;
      let nextRow = clamp(row, rowCount - 1);
      let nextCol = clamp(col, colCount - 1);
      if (key === "ArrowUp") nextRow = clamp(nextRow - 1, rowCount - 1);
      else if (key === "ArrowDown") nextRow = clamp(nextRow + 1, rowCount - 1);
      else if (key === "ArrowLeft") nextCol = clamp(nextCol - 1, colCount - 1);
      else if (key === "ArrowRight") nextCol = clamp(nextCol + 1, colCount - 1);
      else if (key === "Home") nextCol = 0;
      else if (key === "End") nextCol = colCount - 1;

      const next = { row: nextRow, col: nextCol };
      focusedRef.current = next;
      setFocusedCell(next);
      requestAnimationFrame(() => {
        const el = containerRef.current?.querySelector<HTMLElement>(
          `[data-grid-row="${nextRow}"][data-grid-col="${nextCol}"]`,
        );
        el?.focus();
      });
    },
    [rowCount, colCount, containerRef],
  );

  return {
    focusedCell: { row: clampedRow, col: clampedCol },
    syncFocus,
    onKeyDown,
    cellTabIndex,
  };
}
