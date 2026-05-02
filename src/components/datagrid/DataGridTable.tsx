import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@components/ui/button";
import AsyncProgressOverlay from "@components/feedback/AsyncProgressOverlay";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import type { SortInfo, TableData } from "@/types/schema";
import { ContextMenu } from "@components/shared/ContextMenu";
import BlobViewerDialog from "./BlobViewerDialog";
import CellDetailDialog from "./CellDetailDialog";
import {
  MIN_COL_WIDTH,
  VIRTUALIZE_THRESHOLD,
  ROW_HEIGHT_ESTIMATE,
  calcDefaultColWidth,
} from "./DataGridTable/columnUtils";
import { useCellNavigation } from "./DataGridTable/useCellNavigation";
import { useColumnResize } from "./DataGridTable/useColumnResize";
import {
  useContextMenu,
  buildContextMenuItems,
} from "./DataGridTable/contextMenu";
import HeaderRow from "./DataGridTable/HeaderRow";
import DataRow, { type DataGridRowContext } from "./DataGridTable/DataRow";

/**
 * `DataGridTable` — RDB 테이블 데이터의 단일-그리드 표시 + inline 편집
 * shell. Sprint 200 에서 1071-line 단일 파일을 entry + 6 sub-file 로
 * 분해 — `DataGridTable/{columnUtils,useCellNavigation,useColumnResize,
 * contextMenu,DataRow,HeaderRow}` 가 책임을 나눠 가짐. 본 entry 는
 * imports + props interface + state/refs + virtualizer wiring + ctx
 * 빌드 + return JSX shell 로 압축.
 *
 * 외부 invariant:
 * - `<DataGridTable>` props (`DataGridTableProps`) 시그니처 byte-for-byte
 *   동결 — `src/components/rdb/DataGrid.tsx` 가 직접 import.
 * - `parseFkReference` named export 위치 동결 — 외부 test
 *   (`DataGridTable.parseFkReference.test.ts`) 가 entry 에서 import.
 *   `./DataGridTable/columnUtils` 로부터 re-export.
 */

// Sprint 89 — entry 가 sub-file 의 named symbol 을 외부 caller 에게
// 그대로 노출 하는 re-export. wire format `"<schema>.<table>(<column>)"`
// 의 contract test (`DataGridTable.parseFkReference.test.ts`) 가 본 path
// 를 import 하므로 위치 동결 필수.
export { parseFkReference } from "./DataGridTable/columnUtils";

export interface DataGridTableProps {
  data: TableData;
  loading: boolean;
  sorts: SortInfo[];
  columnWidths: Record<string, number>;
  columnOrder: number[];
  editingCell: { row: number; col: number } | null;
  editValue: string | null;
  pendingEdits: Map<string, string | null>;
  /**
   * Sprint 75 — per-cell coercion errors keyed by `"rowIdx-colIdx"`. When the
   * active editing cell has an entry, an inline validation hint is rendered
   * beneath the editor. Optional to keep the prop surface backwards-compatible
   * with existing callers that haven't adopted the error map yet; defaults to
   * an empty map internally.
   */
  pendingEditErrors?: Map<string, string>;
  selectedRowIds: Set<number>;
  pendingDeletedRowKeys: Set<string>;
  pendingNewRows: unknown[][];
  page: number;
  schema: string;
  table: string;
  /**
   * Sprint 99 — number of currently active filters (structured + raw SQL).
   * Drives the empty-state branch:
   *   - `> 0` → "0 rows match current filter" + Clear filter button
   *   - `=== 0` (default) → "Table is empty"
   * The component itself does not interpret the value beyond `> 0`; the
   * parent (DataGrid) computes it from `appliedRawSql` + `appliedFilters`.
   */
  activeFilterCount?: number;
  /**
   * Sprint 99 — invoked when the user clicks the Clear filter button in the
   * filtered-empty branch. Parent must clear `filters`, `appliedFilters`,
   * `rawSql`, and `appliedRawSql` so the next fetch returns the unfiltered
   * dataset.
   */
  onClearFilters?: () => void;
  /**
   * Sprint 180 (AC-180-02) — invoked when the user clicks the Cancel
   * button on the threshold-gated overlay. Parent aborts the in-flight
   * `query_table_data` op, clears `loading`, and reverts to the
   * pre-fetch dataset (refetch case) or empty (initial-fetch case).
   * Optional to keep the prop surface backwards-compatible with
   * legacy callers that don't yet wire cancel; the overlay only
   * renders when `loading` is true AND the threshold has elapsed,
   * so omitting the prop simply makes the Cancel button a no-op.
   */
  onCancelRefetch?: () => void;
  onSetEditValue: (v: string | null) => void;
  onSetEditNull: () => void;
  onSaveCurrentEdit: () => void;
  onCancelEdit: () => void;
  onStartEdit: (
    rowIdx: number,
    colIdx: number,
    currentValue: string | null,
  ) => void;
  onSelectRow: (rowIdx: number, metaKey: boolean, shiftKey: boolean) => void;
  onSort: (columnName: string, shiftKey: boolean) => void;
  onColumnWidthsChange: (
    updater: (prev: Record<string, number>) => Record<string, number>,
  ) => void;
  onDeleteRow: () => void;
  onDuplicateRow: () => void;
  onNavigateToFk?: (
    schema: string,
    table: string,
    column: string,
    value: string,
  ) => void;
}

export default function DataGridTable({
  data,
  loading,
  sorts,
  columnWidths,
  columnOrder,
  editingCell,
  editValue,
  pendingEdits,
  pendingEditErrors,
  selectedRowIds,
  pendingDeletedRowKeys,
  pendingNewRows,
  page,
  schema,
  table,
  activeFilterCount = 0,
  onClearFilters,
  onCancelRefetch,
  onSetEditValue,
  onSetEditNull,
  onSaveCurrentEdit,
  onCancelEdit,
  onStartEdit,
  onSelectRow,
  onSort,
  onColumnWidthsChange,
  onDeleteRow,
  onDuplicateRow,
  onNavigateToFk,
}: DataGridTableProps) {
  const tableRef = useRef<HTMLTableElement>(null);

  // Active cell editor focus target. Only one cell edits at a time, so a
  // single ref is enough — wired to either the <input> or the NULL chip <div>.
  // React's `autoFocus` prop only calls .focus() for form controls, so the
  // NULL chip (a <div role="textbox">) would silently lose focus when flipping
  // from input → chip via Cmd+Backspace without this.
  const editorFocusRef = useRef<HTMLElement | null>(null);
  const isNullEditor = editValue === null;
  useEffect(() => {
    if (editingCell && editorFocusRef.current) {
      editorFocusRef.current.focus();
    }
  }, [editingCell, isNullEditor]);

  // BLOB viewer state
  const [blobViewer, setBlobViewer] = useState<{
    data: unknown;
    columnName: string;
  } | null>(null);

  // Cell detail viewer state — shows the full value of one cell in a dialog,
  // since long text is otherwise truncated and unreadable in the grid.
  const [cellDetail, setCellDetail] = useState<{
    data: unknown;
    columnName: string;
    dataType: string;
  } | null>(null);

  // The visual order: columnOrder[visualIdx] = dataIdx
  // If columnOrder is empty/default, fall back to identity mapping
  const visualCount = data.columns.length;
  const order =
    columnOrder.length === visualCount
      ? columnOrder
      : data.columns.map((_, i) => i);

  const getColumnWidth = useCallback(
    (colName: string, dataType: string = "") => {
      if (columnWidths[colName]) return columnWidths[colName];
      return calcDefaultColWidth(colName, dataType);
    },
    [columnWidths],
  );

  const { moveEditCursor } = useCellNavigation({
    data,
    order,
    pendingEdits,
    onSaveCurrentEdit,
    onStartEdit,
  });

  const { handleResizeStart } = useColumnResize({
    tableRef,
    columnWidths,
    onColumnWidthsChange,
  });

  const { contextMenu, setContextMenu, handleContextMenu } = useContextMenu({
    data,
    selectedRowIds,
    onSelectRow,
  });

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {
      // Clipboard API may fail in some environments; silently ignore
    });
  }, []);

  /**
   * Sprint-114 — once the dataset crosses `VIRTUALIZE_THRESHOLD` rows we let
   * `useVirtualizer` decide which rows enter the DOM. Counting includes
   * `pendingNewRows` because they share the tbody scroll surface; the
   * threshold is conservative so small queries (≤ 200) keep the eager
   * render path that the existing DataGrid tests assert against.
   */
  const totalBodyRowCount = data.rows.length + pendingNewRows.length;
  const shouldVirtualize = totalBodyRowCount > VIRTUALIZE_THRESHOLD;

  // Scroll container for the virtualizer. The wrapper div (overflow-auto) is
  // the actual scroll surface; the <table> inside lives at its natural size
  // so sticky thead and column-resize logic continue to work unchanged.
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // We always wire up the virtualizer (count=0 when below threshold so it
  // does no work) — calling hooks unconditionally keeps the React rules
  // satisfied across the threshold transition.
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? data.rows.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 10,
  });

  // When the underlying dataset changes (sort/filter/page change), reset
  // scroll position so the user always lands on the first row of the new
  // result set instead of staring at a viewport that pointed into the old
  // ordering. `data.executed_query` flips on every server fetch so it's a
  // safe identity for "the rows changed".
  useEffect(() => {
    if (!shouldVirtualize) return;
    rowVirtualizer.scrollToIndex(0, { align: "start" });
    // We intentionally only react to identity changes of the rendered set;
    // including the virtualizer instance would re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.executed_query, sorts, shouldVirtualize]);

  // Sprint 180 (AC-180-01) — threshold gate. The overlay only paints
  // after `loading` has been continuously true for 1s, so sub-second
  // refetches never flicker. Sprint 176 hardening (4 pointer-event
  // handlers) lives inside `AsyncProgressOverlay` itself. The Cancel
  // callback is wired up by the host (DataGrid) which aborts the
  // in-flight `query_table_data` Tauri command and clears `loading`.
  const overlayVisible = useDelayedFlag(loading, 1000);

  // Sprint 200 — DataRow ctx 묶음. `useMemo` 는 reconciliation cost 보다
  // 의도 표현 — DataRow 컴포넌트는 ctx 를 prop 으로 받아 매 렌더 새
  // 객체 reference 가 들어가도 동작은 동일 (memo 안 씀). 단, ctx 의
  // identity 가 고정되면 향후 React.memo 적용 시 재렌더 최소화 가능.
  const rowCtx: DataGridRowContext = useMemo(
    () => ({
      data,
      page,
      order,
      editingCell,
      editValue,
      pendingEdits,
      pendingEditErrors,
      pendingDeletedRowKeys,
      selectedRowIds,
      editorFocusRef,
      getColumnWidth,
      moveEditCursor,
      handleContextMenu,
      setBlobViewer,
      onSelectRow,
      onStartEdit,
      onSetEditValue,
      onSetEditNull,
      onSaveCurrentEdit,
      onCancelEdit,
      onNavigateToFk,
    }),
    [
      data,
      page,
      order,
      editingCell,
      editValue,
      pendingEdits,
      pendingEditErrors,
      pendingDeletedRowKeys,
      selectedRowIds,
      getColumnWidth,
      moveEditCursor,
      handleContextMenu,
      onSelectRow,
      onStartEdit,
      onSetEditValue,
      onSetEditNull,
      onSaveCurrentEdit,
      onCancelEdit,
      onNavigateToFk,
    ],
  );

  return (
    <div className="relative flex-1 overflow-auto" ref={scrollContainerRef}>
      <AsyncProgressOverlay
        visible={overlayVisible}
        onCancel={onCancelRefetch ?? (() => {})}
      />
      <table
        className="min-w-full table-fixed border-collapse text-sm"
        ref={tableRef}
        role="grid"
        aria-rowcount={1 + data.rows.length + pendingNewRows.length}
        aria-colcount={data.columns.length}
      >
        <HeaderRow
          data={data}
          order={order}
          sorts={sorts}
          editingCell={editingCell}
          onSort={onSort}
          onSaveCurrentEdit={onSaveCurrentEdit}
          onResizeStart={handleResizeStart}
          getColumnWidth={getColumnWidth}
        />
        <tbody>
          {shouldVirtualize
            ? (() => {
                // Sprint-114 — virtualized branch. The virtualizer reports a
                // total scroll height (`getTotalSize()`) and a window of
                // visible items; we pad before/after with two spacer rows so
                // the table preserves its full height + the rendered slice
                // sits at the correct vertical offset. We can't use
                // `position: absolute` directly on `<tr>` (table layout
                // model fights it), and `transform` on `<tbody>` would
                // reposition every row instead of leaving spacers.
                const virtualItems = rowVirtualizer.getVirtualItems();
                const totalSize = rowVirtualizer.getTotalSize();
                const paddingTop = virtualItems.length
                  ? virtualItems[0]!.start
                  : 0;
                const paddingBottom = virtualItems.length
                  ? totalSize - virtualItems[virtualItems.length - 1]!.end
                  : 0;
                return (
                  <>
                    {paddingTop > 0 && (
                      <tr aria-hidden="true" style={{ height: paddingTop }}>
                        <td
                          colSpan={data.columns.length}
                          style={{ padding: 0, border: 0 }}
                        />
                      </tr>
                    )}
                    {virtualItems.map((virtualRow) => (
                      <DataRow
                        key={`row-${page}-${virtualRow.index}`}
                        rowIdx={virtualRow.index}
                        ctx={rowCtx}
                      />
                    ))}
                    {paddingBottom > 0 && (
                      <tr aria-hidden="true" style={{ height: paddingBottom }}>
                        <td
                          colSpan={data.columns.length}
                          style={{ padding: 0, border: 0 }}
                        />
                      </tr>
                    )}
                  </>
                );
              })()
            : data.rows.map((_row, rowIdx) => (
                <DataRow
                  key={`row-${page}-${rowIdx}`}
                  rowIdx={rowIdx}
                  ctx={rowCtx}
                />
              ))}
          {data.rows.length === 0 && pendingNewRows.length === 0 && (
            <tr role="row">
              <td
                role="gridcell"
                aria-colindex={1}
                colSpan={data.columns.length}
                className="px-3 py-4 text-center text-xs text-muted-foreground"
              >
                {activeFilterCount > 0 ? (
                  // Sprint 99 — filtered empty state. The Clear filter button
                  // is co-located with the message so users don't have to
                  // scroll back to the FilterBar to recover from a
                  // mis-typed filter that happens to match zero rows.
                  <div className="flex flex-col items-center justify-center gap-2">
                    <span>0 rows match current filter</span>
                    <Button
                      variant="outline"
                      size="xs"
                      aria-label="Clear filters"
                      onClick={() => onClearFilters?.()}
                    >
                      Clear filter
                    </Button>
                  </div>
                ) : (
                  "Table is empty"
                )}
              </td>
            </tr>
          )}
          {pendingNewRows.map((newRow, newIdx) => (
            <tr
              key={`new-row-${newIdx}`}
              role="row"
              aria-rowindex={data.rows.length + newIdx + 2}
              className="border-b border-border bg-warning/5 hover:bg-muted"
            >
              {order.map((dIdx, visualIdx) => {
                const cell = (newRow as unknown[])[dIdx];
                const col = data.columns[dIdx]!;
                return (
                  <td
                    key={`${dIdx}-${visualIdx}`}
                    role="gridcell"
                    aria-colindex={visualIdx + 1}
                    className="overflow-hidden border-r border-border px-3 py-1 text-xs italic text-muted-foreground"
                    style={{
                      width: getColumnWidth(col.name, col.data_type),
                      minWidth: MIN_COL_WIDTH,
                    }}
                  >
                    {cell == null ? "NULL" : String(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextMenuItems({
            contextMenu,
            data,
            selectedRowIds,
            schema,
            table,
            setCellDetail,
            onStartEdit,
            onSetEditNull,
            onDeleteRow,
            onDuplicateRow,
            copyToClipboard,
          })}
          onClose={() => setContextMenu(null)}
        />
      )}
      {blobViewer && (
        <BlobViewerDialog
          open={blobViewer !== null}
          onOpenChange={(open) => {
            if (!open) setBlobViewer(null);
          }}
          data={blobViewer.data}
          columnName={blobViewer.columnName}
        />
      )}
      {cellDetail && (
        <CellDetailDialog
          open={cellDetail !== null}
          onOpenChange={(open) => {
            if (!open) setCellDetail(null);
          }}
          data={cellDetail.data}
          columnName={cellDetail.columnName}
          dataType={cellDetail.dataType}
        />
      )}
    </div>
  );
}
