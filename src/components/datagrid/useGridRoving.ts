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
 *
 * virtualized grid (RDB, Design-swarm #4 Phase 2): target row 가 virtual window
 * 밖이면 DOM 에 없어 `.focus()` 가 no-op 이다. `opts.scrollRowIntoView` 가
 * 주어지면 첫 rAF 에서 cell 을 못 찾을 때 그 콜백으로 row 를 스크롤해 render 시킨
 * 뒤 몇 프레임 재시도한다. 콜백 미제공 caller (Document grid) 는 cell 이 항상
 * DOM 에 있어 attempt 0 에서 바로 focus — 기존 단일-프레임 동작 그대로다.
 */

export interface GridRoving {
  focusedCell: { row: number; col: number };
  /** cell `onFocus` 용 — STATE ONLY. `.focus()` 를 호출하지 않는다. */
  syncFocus: (row: number, col: number) => void;
  /**
   * `role="grid"` 컨테이너용 — 방향키/Home/End/PageUp·Down/Ctrl+Home·End. 이것만
   * DOM focus 를 움직인다. row 0 에서 ArrowUp 은 대응 컬럼 header 셀로 진입한다
   * (#1127; header→body 복귀는 HeaderRow 의 ArrowDown).
   */
  onKeyDown: (e: React.KeyboardEvent) => void;
  cellTabIndex: (row: number, col: number) => 0 | -1;
}

const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);

// ponytail: virtualizer 는 scrolled-to row 를 몇 프레임 안에 render 한다. N 프레임
// 뒤엔 포기해 focus 가 무한 루프 돌지 않게 한다.
const MAX_FOCUS_FRAMES = 6;

// ponytail: fixed page size. viewport row 수 기반 동적 페이징이 필요해지면
// container clientHeight / row height 로 계산해 넘겨받는 방향으로 올린다.
const PAGE_ROWS = 10;

export function useGridRoving(
  rowCount: number,
  colCount: number,
  containerRef: React.RefObject<HTMLElement | null>,
  opts?: { scrollRowIntoView?: (row: number) => void },
): GridRoving {
  const [focusedCell, setFocusedCell] = useState({ row: 0, col: 0 });
  const focusedRef = useRef(focusedCell);
  focusedRef.current = focusedCell;

  // opts 는 매 렌더 새 closure 다. 최신값을 ref 로 미러링해 keydown handler 가
  // useCallback dep 없이 항상 현재 콜백을 부르게 한다.
  const scrollRef = useRef(opts?.scrollRowIntoView);
  scrollRef.current = opts?.scrollRowIntoView;

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

  // bounded rAF retry: cell 이 DOM 에 있으면 첫 프레임에 focus (Document grid
  // 는 항상 여기). 첫 프레임에 없으면 row 가 virtual window 밖이므로
  // scrollRowIntoView 로 스크롤-인 후 몇 프레임 재시도 (RDB virtualized grid).
  const focusCell = useCallback(
    (row: number, col: number) => {
      let attempt = 0;
      const tryFocus = () => {
        const el = containerRef.current?.querySelector<HTMLElement>(
          `[data-grid-row="${row}"][data-grid-col="${col}"]`,
        );
        if (el) {
          el.focus();
          return;
        }
        if (attempt === 0) scrollRef.current?.(row);
        if (attempt < MAX_FOCUS_FRAMES) {
          attempt++;
          requestAnimationFrame(tryFocus);
        }
      };
      requestAnimationFrame(tryFocus);
    },
    [containerRef],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const { key } = e;
      if (
        key !== "ArrowUp" &&
        key !== "ArrowDown" &&
        key !== "ArrowLeft" &&
        key !== "ArrowRight" &&
        key !== "Home" &&
        key !== "End" &&
        key !== "PageUp" &&
        key !== "PageDown"
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

      // #1127 AC1 — 최상단 data row 에서 ArrowUp → 대응 컬럼 header 셀 진입.
      // header 는 grid container 의 N번째 role="columnheader" (N=visual col).
      // body roving anchor 는 그대로 두고 header 로 focus 만 넘긴다 (header 의
      // onFocus 가 자체 roving 을 sync; ArrowDown 으로 이 컬럼 data cell 복귀).
      // header 없는 grid 는 undefined → 아래 clamp 로 fall through (기존 동작).
      if (key === "ArrowUp" && nextRow === 0) {
        const header = containerRef.current?.querySelectorAll<HTMLElement>(
          '[role="columnheader"]',
        )[nextCol];
        if (header) {
          header.focus();
          return;
        }
      }

      // #1127 AC2 — Ctrl/Cmd+Home/End = 첫/마지막 *셀* 점프 (grid corner). 수식어
      // 없는 Home/End 는 현재 row 의 첫/마지막 col 만 이동한다.
      const corner = e.ctrlKey || e.metaKey;
      if (key === "ArrowUp") nextRow = clamp(nextRow - 1, rowCount - 1);
      else if (key === "ArrowDown") nextRow = clamp(nextRow + 1, rowCount - 1);
      else if (key === "ArrowLeft") nextCol = clamp(nextCol - 1, colCount - 1);
      else if (key === "ArrowRight") nextCol = clamp(nextCol + 1, colCount - 1);
      else if (key === "Home") {
        nextCol = 0;
        if (corner) nextRow = 0;
      } else if (key === "End") {
        nextCol = colCount - 1;
        if (corner) nextRow = rowCount - 1;
      } else if (key === "PageUp")
        nextRow = clamp(nextRow - PAGE_ROWS, rowCount - 1);
      else if (key === "PageDown")
        nextRow = clamp(nextRow + PAGE_ROWS, rowCount - 1);

      const next = { row: nextRow, col: nextCol };
      focusedRef.current = next;
      setFocusedCell(next);
      focusCell(nextRow, nextCol);
    },
    [rowCount, colCount, focusCell, containerRef],
  );

  return {
    focusedCell: { row: clampedRow, col: clampedCol },
    syncFocus,
    onKeyDown,
    cellTabIndex,
  };
}
