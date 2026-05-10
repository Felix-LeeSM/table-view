import { useRef } from "react";
import { Key } from "lucide-react";
import type { SortInfo, TableData } from "@/types/schema";

/**
 * Sprint 258 — `<thead>` 폐기, `<div role="rowgroup">` + sticky header
 * row. column widths 는 outer container 의 `--cols` CSS variable cascade
 * 로 결정된다.
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
}

export default function HeaderRow({
  data,
  order,
  sorts,
  editingCell,
  onSort,
  onSaveCurrentEdit,
  onResizeStart,
}: HeaderRowProps) {
  const sortMouseStartRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <div role="rowgroup" className="sticky top-0 z-10 bg-secondary">
      <div
        role="row"
        aria-rowindex={1}
        style={{
          display: "grid",
          gridTemplateColumns: "var(--cols)",
        }}
      >
        {order.map((dIdx, visualIdx) => {
          const col = data.columns[dIdx]!;
          const sortInfo = sorts.find((s) => s.column === col.name);
          const sortRank = sortInfo ? sorts.indexOf(sortInfo) + 1 : 0;
          return (
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
        })}
      </div>
    </div>
  );
}
