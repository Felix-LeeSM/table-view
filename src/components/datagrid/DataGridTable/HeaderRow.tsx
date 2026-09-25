import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@components/ui/context-menu";
import { Key } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SortInfo, TableData } from "@/types/schema";

/**
 * `<thead>` is replaced by a `<div role="rowgroup">` + sticky header row.
 * Column widths come from the outer container's `--cols` CSS variable
 * cascade.
 *
 * Right-click on a column header opens a Radix ContextMenu with 6 items
 * (Sort ASC/DESC, Add to sort ASC/DESC, Clear per-column, Clear all). The
 * three added callbacks are optional, so existing callers see zero
 * regression.
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
   * WCAG 2.1.1: keyboard counterpart to `onResizeStart`. Wired in
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
   * Explicit sort override invoked by the context menu.
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
   * Hide this column. When provided, the context menu surfaces a "Hide
   * column" item below a separator. `useHiddenColumns` handles state +
   * persist on the caller side.
   */
  onHideColumn?: (columnName: string) => void;
  /**
   * Q21 #5 — "Reset column widths" affordance. When provided, the context
   * menu surfaces an item that calls back. Wire (in DataGridTable.tsx): the
   * callback is `useColumnWidths.reset`, which fires
   * `resetDatagridPrefs(field="widths")` — strategy doc line 1395.
   */
  onResetColumnWidths?: () => void;
  /**
   * Q21 #6 — "Show all columns" affordance.
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
  // issue #1130 (B1) — the header row is a single roving tab stop. N static
  // tabIndex={0}s would put N tab stops inside the grid (N Tab presses across
  // the header) and split the navigation model from the body's single roving
  // stop. The header too keeps only the first columnheader as the tab stop
  // and moves with ArrowLeft/Right/Home/End (a separate 1-stop roving from
  // the body; Tab enters the body).
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
          // bg-secondary paints through to the end of the horizontal scroll.
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
                // Ignore keys bubbled from the inner resize separator or a
                // context menu item (this cell only).
                if (e.target !== e.currentTarget) return;
                const { key } = e;
                // #1127 AC1 — ArrowDown from the header returns to the
                // matching column's topmost data cell (row 0). Pairs with the
                // body roving's ArrowUp (row 0 → header) so the column is
                // preserved. The body cell's onFocus syncs the roving anchor
                // to (0, visualIdx). A no-op when virtualization has row 0
                // unrendered (an edge of sticky header + scroll state; the
                // round-trip is defined against the top row).
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
                // issue #1130 (B1) — header-row roving: ArrowLeft/Right/Home/End
                // move the single tab stop between sibling columnheaders. Same
                // mechanism as the body roving (event-relative querySelector +
                // .focus(); no virtualization here, so focus is immediate).
                // Tab remains the header↔body move.
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
                // issue #1130 AC3 — Enter/Space sorts; Shift appends to the
                // multi-sort, same as shift+click.
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
              {/* Double-click = column widths reset. Calls
                  `onResetColumnWidths` when connected (DataGridTable wires
                  `useColumnWidths.reset` → the `reset_datagrid_prefs
                  (field=widths)` IPC). Note this resets *all* widths, not
                  column-level. A single mousedown (drag-start) is independent
                  of the reset; e.stopPropagation blocks bubbling to the
                  header onClick/sort.
                  #1733 (2026-07-24) — the duplicate toolbar reset button was
                  removed, so double-click is the only grip reset trigger.
                  The hover `title` aids discoverability (the aria-label stays
                  the SR-facing "Resize column"). */}
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
                {/* Q21 #5 + #6 — reset affordances. No confirm dialog
                    (the Q21 direct IPC contract). */}
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
