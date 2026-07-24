import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Key } from "lucide-react";
import type { SortInfo, TableData } from "@/types/schema";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@components/ui/context-menu";

/**
 * Sprint 258 — `<thead>` 폐기, `<div role="rowgroup">` + sticky header
 * row. column widths 는 outer container 의 `--cols` CSS variable cascade
 * 로 결정된다.
 *
 * Sprint 316 — Slice C.2: column header 우클릭 → Radix ContextMenu.
 * 6 item (Sort ASC/DESC, Add to sort ASC/DESC, Clear per-column,
 * Clear all). 신규 callback 3개는 optional 이라 기존 caller 회귀 0.
 *
 * Invariants:
 * - Sort fires only when click ↔ mousedown movement ≤ 4px, so dragging
 *   the header for horizontal scroll does not flip sort order.
 * - If an editor is active when sort fires, commit it first — otherwise
 *   the input lingers at the wrong position.
 */

export interface HeaderRowProps {
  data: TableData;
  order: number[];
  sorts: SortInfo[];
  editingCell: { row: number; col: number } | null;
  onSort: (columnName: string, shiftKey: boolean) => void;
  onSaveCurrentEdit: () => void;
  onResizeStart: (
    e: React.MouseEvent,
    colName: string,
    visualIdx: number,
  ) => void;
  /**
   * Sprint — WCAG 2.1.1: keyboard counterpart to `onResizeStart`. Wired in
   * DataGridTable.tsx / DocumentDataGrid.tsx to
   * `useColumnResize.handleResizeKeyDown`. Optional so existing tests that
   * mount HeaderRow without it stay valid.
   */
  onResizeKeyDown?: (
    e: React.KeyboardEvent,
    colName: string,
    visualIdx: number,
  ) => void;
  /**
   * Sprint 316 — explicit sort override invoked by the context menu.
   * `append=true` mirrors the shift+click multi-key behaviour (push to
   * the end); `append=false` replaces the current sort with a single
   * key. Optional so existing tests / callers stay valid.
   */
  onSortColumn?: (
    columnName: string,
    direction: "ASC" | "DESC",
    append: boolean,
  ) => void;
  /** Remove this column from the sort list, preserving the rest. */
  onClearColumnSort?: (columnName: string) => void;
  /** Drop every sort key. */
  onClearAllSorts?: () => void;
  /**
   * Sprint 317 — Slice D.1: hide this column. When provided, the
   * context menu surfaces a "Hide column" item below a separator.
   * `useHiddenColumns` handles state + persist on the caller side.
   */
  onHideColumn?: (columnName: string) => void;
  /**
   * Sprint 376 (Phase 6 Q21 #5) — "Reset column widths" affordance.
   * When provided, the context menu surfaces an item that calls back.
   * Wire (in DataGridTable.tsx): the callback is
   * `useColumnWidths.reset`, which fires
   * `resetDatagridPrefs(field="widths")` — strategy doc line 1395.
   */
  onResetColumnWidths?: () => void;
  /**
   * Sprint 376 (Phase 6 Q21 #6) — "Show all columns" affordance.
   * Wire: callback is `useHiddenColumns.clear`, which fires
   * `setDatagridPrefs({ hiddenColumns: [] })` (functionally equivalent
   * to `resetDatagridPrefs(field="hiddenColumns")` — both clear the
   * stored set without touching widths).
   */
  onShowAllColumns?: () => void;
  /** Disables the "Show all columns" menu item when no column is hidden. */
  anyColumnHidden?: boolean;
}

export default function HeaderRow({
  data,
  order,
  sorts,
  editingCell,
  onSort,
  onSaveCurrentEdit,
  onResizeStart,
  onResizeKeyDown,
  onSortColumn,
  onClearColumnSort,
  onClearAllSorts,
  onHideColumn,
  onResetColumnWidths,
  onShowAllColumns,
  anyColumnHidden = false,
}: HeaderRowProps) {
  const { t } = useTranslation("datagrid");
  const sortMouseStartRef = useRef<{ x: number; y: number } | null>(null);
  // issue #1130 (B1) — 헤더행은 단일 roving tab stop. 정적 tabIndex={0} N개는
  // grid 안에 N개 tab stop 을 만들어(헤더에서 Tab N연타) body 단일 roving 과
  // nav 모델을 이원화한다. 헤더도 첫 columnheader 만 tab stop 이고 ArrowLeft/
  // Right/Home/End 로 이동한다 (body roving 과 분리된 1 stop, Tab 으로 body 진입).
  const [focusedHeaderCol, setFocusedHeaderCol] = useState(0);
  const clampedHeaderCol =
    order.length > 0 ? Math.min(focusedHeaderCol, order.length - 1) : 0;
  const hasContextMenu = !!(
    onSortColumn ||
    onClearColumnSort ||
    onClearAllSorts ||
    onHideColumn ||
    onResetColumnWidths ||
    onShowAllColumns
  );

  return (
    <div
      role="rowgroup"
      className="sticky top-0 z-10 bg-secondary"
      style={{ minWidth: "max-content" }}
    >
      <div
        role="row"
        aria-rowindex={1}
        style={{
          display: "grid",
          gridTemplateColumns: "var(--cols)",
          // Sprint 261 — bg-secondary 가 horizontal scroll 끝까지 그려지도록.
          minWidth: "max-content",
        }}
      >
        {order.map((dIdx, visualIdx) => {
          const col = data.columns[dIdx]!;
          const sortInfo = sorts.find((s) => s.column === col.name);
          const sortRank = sortInfo ? sorts.indexOf(sortInfo) + 1 : 0;
          const isSorted = !!sortInfo;
          const headerInner = (
            <div
              key={col.name}
              role="columnheader"
              aria-colindex={visualIdx + 1}
              aria-sort={
                sortInfo
                  ? sortInfo.direction === "ASC"
                    ? "ascending"
                    : "descending"
                  : "none"
              }
              tabIndex={visualIdx === clampedHeaderCol ? 0 : -1}
              onFocus={() => setFocusedHeaderCol(visualIdx)}
              className="relative flex cursor-pointer flex-col justify-center overflow-hidden border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground hover:bg-muted focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring"
              onMouseDown={(e) => {
                sortMouseStartRef.current = { x: e.clientX, y: e.clientY };
              }}
              onClick={(e) => {
                if (sortMouseStartRef.current) {
                  const dx = Math.abs(e.clientX - sortMouseStartRef.current.x);
                  const dy = Math.abs(e.clientY - sortMouseStartRef.current.y);
                  sortMouseStartRef.current = null;
                  if (dx > 4 || dy > 4) return;
                }
                if (editingCell) onSaveCurrentEdit();
                onSort(col.name, e.shiftKey);
              }}
              onKeyDown={(e) => {
                // 내부 resize separator / context menu item 에서 버블한 키는
                // 무시(자기 셀만).
                if (e.target !== e.currentTarget) return;
                const { key } = e;
                // #1127 AC1 — header 에서 ArrowDown → 대응 컬럼 최상단 data cell
                // (row 0) 복귀. body roving 의 ArrowUp(row 0 → header) 과 짝을
                // 이뤄 컬럼을 보존한다. body cell 의 onFocus 가 roving anchor 를
                // (0, visualIdx) 로 sync 한다. 가상화로 row 0 이 미렌더면 no-op
                // (sticky header + scroll 상태의 edge; round-trip 은 top row 기준).
                if (key === "ArrowDown") {
                  e.preventDefault();
                  const gridEl = e.currentTarget.closest('[role="grid"]');
                  gridEl
                    ?.querySelector<HTMLElement>(
                      `[data-grid-row="0"][data-grid-col="${visualIdx}"]`,
                    )
                    ?.focus();
                  return;
                }
                // issue #1130 (B1) — 헤더행 roving: ArrowLeft/Right/Home/End 로
                // 단일 tab stop 을 형제 columnheader 로 옮긴다. body roving 과
                // 같은 방식(이벤트 상대 querySelector + .focus(), 가상화 없어
                // 즉시 focus). Tab 은 헤더↔body 이동에 그대로 쓴다.
                if (
                  key === "ArrowLeft" ||
                  key === "ArrowRight" ||
                  key === "Home" ||
                  key === "End"
                ) {
                  e.preventDefault();
                  const last = order.length - 1;
                  let next = visualIdx;
                  if (key === "ArrowLeft") next = Math.max(visualIdx - 1, 0);
                  else if (key === "ArrowRight")
                    next = Math.min(visualIdx + 1, last);
                  else if (key === "Home") next = 0;
                  else if (key === "End") next = last;
                  setFocusedHeaderCol(next);
                  const rowEl = e.currentTarget.closest('[role="row"]');
                  const headers = rowEl?.querySelectorAll<HTMLElement>(
                    '[role="columnheader"]',
                  );
                  headers?.[next]?.focus();
                  return;
                }
                // issue #1130 AC3 — Enter/Space 로 정렬, Shift 는 shift+click 과
                // 동일하게 multi-sort append.
                if (key !== "Enter" && key !== " ") return;
                e.preventDefault();
                if (editingCell) onSaveCurrentEdit();
                onSort(col.name, e.shiftKey);
              }}
              title={t("sortByTitle", { col: col.name })}
            >
              <div className="flex items-center gap-1 min-w-0">
                {col.is_primary_key && (
                  <span title={t("primaryKey")} className="shrink-0">
                    <Key
                      size={12}
                      className="text-warning"
                      aria-label={t("primaryKey")}
                    />
                  </span>
                )}
                <span className="truncate">{col.name}</span>
                {sortInfo && (
                  <span className="flex shrink-0 items-center gap-0.5 text-primary">
                    <span className="text-3xs font-bold">{sortRank}</span>
                    {sortInfo.direction === "ASC" ? "▲" : "▼"}
                  </span>
                )}
              </div>
              <div
                className="mt-0.5 truncate text-3xs text-muted-foreground"
                title={col.data_type}
              >
                {col.data_type}
              </div>
              {/* Sprint 378 (2026-05-17) — 더블클릭 = column widths reset.
                  `onResetColumnWidths` 가 connected 면 (DataGridTable 가 wire
                  한 `useColumnWidths.reset` → `reset_datagrid_prefs
                  (field=widths)` IPC) 호출. column-level 이 아닌 *전체*
                  widths reset 임에 유의 (sprint-378 contract). 단일
                  mousedown (drag-start) 은 reset 과 독립. e.stopPropagation
                  으로 header onClick/sort 로의 bubble 차단.
                  #1733 (2026-07-24) — 중복이던 툴바 reset 버튼을 제거했으므로
                  더블클릭이 유일한 grip reset 트리거다. hover `title` 로
                  발견성 보완 (aria-label 은 SR 용 "Resize column" 유지). */}
              <div
                className="absolute right-0 top-0 h-full w-3 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 focus-visible:outline-1 focus-visible:outline-ring"
                onMouseDown={(e) => onResizeStart(e, col.name, visualIdx)}
                onKeyDown={(e) => onResizeKeyDown?.(e, col.name, visualIdx)}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onResetColumnWidths?.();
                }}
                tabIndex={0}
                role="separator"
                aria-orientation="vertical"
                aria-label={t("resizeColumnAria")}
                title={t("resizeColumnTitle")}
              />
            </div>
          );

          if (!hasContextMenu) {
            return headerInner;
          }

          return (
            <ContextMenu key={col.name}>
              <ContextMenuTrigger asChild>{headerInner}</ContextMenuTrigger>
              <ContextMenuContent
                aria-label={t("columnActionsAria", { col: col.name })}
              >
                {onSortColumn && (
                  <>
                    <ContextMenuItem
                      onSelect={() => onSortColumn(col.name, "ASC", false)}
                    >
                      {t("sortAsc")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => onSortColumn(col.name, "DESC", false)}
                    >
                      {t("sortDesc")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => onSortColumn(col.name, "ASC", true)}
                    >
                      {t("addToSortAsc")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => onSortColumn(col.name, "DESC", true)}
                    >
                      {t("addToSortDesc")}
                    </ContextMenuItem>
                  </>
                )}
                {(onClearColumnSort || onClearAllSorts) && onSortColumn && (
                  <ContextMenuSeparator />
                )}
                {onClearColumnSort && (
                  <ContextMenuItem
                    disabled={!isSorted}
                    onSelect={() => onClearColumnSort(col.name)}
                  >
                    {t("clearSortForColumn")}
                  </ContextMenuItem>
                )}
                {onClearAllSorts && (
                  <ContextMenuItem
                    disabled={sorts.length === 0}
                    onSelect={() => onClearAllSorts()}
                  >
                    {t("clearAllSorts")}
                  </ContextMenuItem>
                )}
                {onHideColumn && (
                  <>
                    {(onSortColumn || onClearColumnSort || onClearAllSorts) && (
                      <ContextMenuSeparator />
                    )}
                    <ContextMenuItem onSelect={() => onHideColumn(col.name)}>
                      {t("hideColumn")}
                    </ContextMenuItem>
                  </>
                )}
                {/* Sprint 376 (Phase 6 Q21 #5 + #6) — reset affordances.
                    Confirm dialog 없음 (Q21 직접 IPC contract). */}
                {(onResetColumnWidths || onShowAllColumns) && (
                  <>
                    {(onSortColumn ||
                      onClearColumnSort ||
                      onClearAllSorts ||
                      onHideColumn) && <ContextMenuSeparator />}
                    {onResetColumnWidths && (
                      <ContextMenuItem onSelect={() => onResetColumnWidths()}>
                        {t("resetColumnWidths")}
                      </ContextMenuItem>
                    )}
                    {onShowAllColumns && (
                      <ContextMenuItem
                        disabled={!anyColumnHidden}
                        onSelect={() => onShowAllColumns()}
                      >
                        {t("showAllColumns")}
                      </ContextMenuItem>
                    )}
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
    </div>
  );
}
