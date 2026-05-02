import { useRef } from "react";
import { Key } from "lucide-react";
import type { SortInfo, TableData } from "@/types/schema";
import { MIN_COL_WIDTH } from "./columnUtils";

/**
 * `DataGridTable` 의 `<thead>` 분리.
 *
 * 책임: column header row 렌더링 + 정렬 click (4px drag suppression
 * 포함) + resize handle 렌즈. sortMouseStartRef 는 본 컴포넌트 내부
 * useRef — entry 가 보유할 필요 없음 (drag-vs-click 판정이 header 안에서
 * 닫히는 동작).
 *
 * Sprint 200 에서 entry 로부터 추출. DOM byte-for-byte 동등 — sticky
 * thead, bg-secondary, role="row" / aria-rowindex={1} / aria-colindex,
 * 정렬 표시 (▲/▼ + rank), data_type subtitle, resize handle hover/active
 * 클래스 모두 동결.
 *
 * 외부 invariant:
 * - 정렬은 click - mousedown 사이 이동량이 4px 이하일 때만 발화. 사용자가
 *   header 를 가로로 드래그 (수평 스크롤 의도) 했을 때 의도하지 않은
 *   정렬 변경 방지.
 * - editing cell 이 살아있는 상태에서 sort 가 발생하면 먼저
 *   `onSaveCurrentEdit` 으로 commit — input 이 잘못된 위치에 떠 있는
 *   회귀 방지 (Sprint 75).
 */

export interface HeaderRowProps {
  data: TableData;
  order: number[];
  sorts: SortInfo[];
  editingCell: { row: number; col: number } | null;
  onSort: (columnName: string, shiftKey: boolean) => void;
  onSaveCurrentEdit: () => void;
  onResizeStart: (e: React.MouseEvent, colName: string, colIdx: number) => void;
  getColumnWidth: (colName: string, dataType?: string) => number;
}

export default function HeaderRow({
  data,
  order,
  sorts,
  editingCell,
  onSort,
  onSaveCurrentEdit,
  onResizeStart,
  getColumnWidth,
}: HeaderRowProps) {
  // Tracks mousedown position on column headers to distinguish clicks from drags.
  // When movement exceeds 4px we suppress the sort so that dragging the header
  // (e.g. to scroll horizontally) doesn't accidentally change sort order.
  const sortMouseStartRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <thead className="sticky top-0 z-10 bg-secondary">
      <tr role="row" aria-rowindex={1}>
        {order.map((dIdx, visualIdx) => {
          const col = data.columns[dIdx]!;
          const sortInfo = sorts.find((s) => s.column === col.name);
          const sortRank = sortInfo ? sorts.indexOf(sortInfo) + 1 : 0;
          return (
            <th
              key={col.name}
              role="columnheader"
              aria-colindex={visualIdx + 1}
              className="relative cursor-pointer border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground hover:bg-muted"
              style={{
                width: getColumnWidth(col.name, col.data_type),
                minWidth: MIN_COL_WIDTH,
              }}
              onMouseDown={(e) => {
                sortMouseStartRef.current = { x: e.clientX, y: e.clientY };
              }}
              onClick={(e) => {
                // Suppress sort when the user dragged the header rather
                // than simply clicking it (movement threshold: 4 px).
                if (sortMouseStartRef.current) {
                  const dx = Math.abs(e.clientX - sortMouseStartRef.current.x);
                  const dy = Math.abs(e.clientY - sortMouseStartRef.current.y);
                  sortMouseStartRef.current = null;
                  if (dx > 4 || dy > 4) return;
                }
                // If a cell is being edited, save it before changing sort
                // so the input doesn't stay visible at the wrong position.
                if (editingCell) onSaveCurrentEdit();
                onSort(col.name, e.shiftKey);
              }}
              title={`Sort by ${col.name}`}
            >
              <div className="flex items-center gap-1">
                {col.is_primary_key && (
                  <span title="Primary Key">
                    <Key
                      size={12}
                      className="shrink-0 text-warning"
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
              {/* Resize handle */}
              <div
                className="absolute right-0 top-0 h-full w-3 cursor-col-resize hover:bg-primary/40 active:bg-primary/60"
                onMouseDown={(e) => onResizeStart(e, col.name, visualIdx)}
                onClick={(e) => e.stopPropagation()}
              />
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
