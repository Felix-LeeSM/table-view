import { useRef } from "react";
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
}

export default function HeaderRow({
  data,
  order,
  sorts,
  editingCell,
  onSort,
  onSaveCurrentEdit,
  onResizeStart,
  onSortColumn,
  onClearColumnSort,
  onClearAllSorts,
}: HeaderRowProps) {
  const sortMouseStartRef = useRef<{ x: number; y: number } | null>(null);
  const hasContextMenu = !!(
    onSortColumn ||
    onClearColumnSort ||
    onClearAllSorts
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
              className="relative flex cursor-pointer flex-col justify-center overflow-hidden border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground hover:bg-muted"
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
              title={`Sort by ${col.name}`}
            >
              <div className="flex items-center gap-1 min-w-0">
                {col.is_primary_key && (
                  <span title="Primary Key" className="shrink-0">
                    <Key
                      size={12}
                      className="text-warning"
                      aria-label="Primary Key"
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
              <div
                className="absolute right-0 top-0 h-full w-3 cursor-col-resize hover:bg-primary/40 active:bg-primary/60"
                onMouseDown={(e) => onResizeStart(e, col.name, visualIdx)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          );

          if (!hasContextMenu) {
            return headerInner;
          }

          return (
            <ContextMenu key={col.name}>
              <ContextMenuTrigger asChild>{headerInner}</ContextMenuTrigger>
              <ContextMenuContent aria-label={`Column actions for ${col.name}`}>
                {onSortColumn && (
                  <>
                    <ContextMenuItem
                      onSelect={() => onSortColumn(col.name, "ASC", false)}
                    >
                      Sort ASC
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => onSortColumn(col.name, "DESC", false)}
                    >
                      Sort DESC
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => onSortColumn(col.name, "ASC", true)}
                    >
                      Add to sort ASC
                    </ContextMenuItem>
                    <ContextMenuItem
                      onSelect={() => onSortColumn(col.name, "DESC", true)}
                    >
                      Add to sort DESC
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
                    Clear sort for this column
                  </ContextMenuItem>
                )}
                {onClearAllSorts && (
                  <ContextMenuItem
                    disabled={sorts.length === 0}
                    onSelect={() => onClearAllSorts()}
                  >
                    Clear all sorts
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
    </div>
  );
}
