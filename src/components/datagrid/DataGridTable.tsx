import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@components/ui/button";
import AsyncProgressOverlay from "@components/feedback/AsyncProgressOverlay";
import { useColumnWidths } from "@/hooks/useColumnWidths";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { getDefaultRem, type ColumnCategory } from "@/lib/columnCategory";
import type { SortInfo, TableData } from "@/types/schema";
import { ContextMenu } from "@components/shared/ContextMenu";
import BlobViewerDialog from "./BlobViewerDialog";
import CellDetailDialog from "./CellDetailDialog";
import {
  VIRTUALIZE_THRESHOLD,
  ROW_HEIGHT_ESTIMATE,
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
 * RDB grid + inline edit shell. Sprint 258 — `<table>` 폐기, CSS Grid 로
 * 전환. 단일 `--cols` CSS variable 이 모든 row 의 grid-template-columns
 * 를 통제하므로 column width 의 redistribute 가 layout engine 차원에서
 * 차단된다.
 *
 * `parseFkReference` 는 외부 contract test 가 본 entry 에서 import 하므로
 * 경로 안정성을 위해 re-export 만 유지.
 */

export { parseFkReference } from "./DataGridTable/columnUtils";

export interface DataGridTableProps {
  data: TableData;
  loading: boolean;
  sorts: SortInfo[];
  columnOrder: number[];
  editingCell: { row: number; col: number } | null;
  editValue: string | null;
  pendingEdits: Map<string, string | null>;
  pendingEditErrors?: Map<string, string>;
  selectedRowIds: Set<number>;
  pendingDeletedRowKeys: Set<string>;
  pendingNewRows: unknown[][];
  page: number;
  schema: string;
  table: string;
  activeFilterCount?: number;
  onClearFilters?: () => void;
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
  /**
   * Sprint 316 — header context menu callbacks. Optional so non-sorting
   * callers stay valid; HeaderRow only mounts the menu when at least
   * one of these is provided.
   */
  onSortColumn?: (
    columnName: string,
    direction: "ASC" | "DESC",
    append: boolean,
  ) => void;
  onClearColumnSort?: (columnName: string) => void;
  onClearAllSorts?: () => void;
  onDeleteRow: () => void;
  onDuplicateRow: () => void;
  onNavigateToFk?: (
    schema: string,
    table: string,
    column: string,
    value: string,
  ) => void;
}

/**
 * Sprint 238 AC-238-12 — imperative handle for the parent (DataGrid) to
 * trigger "Reset column widths" via the toolbar. Sprint 258 — also wired
 * to the cmd+shift+r shortcut (AC-258-08).
 */
export interface DataGridTableHandle {
  resetColumnWidths: () => void;
}

function getColumnCategory(c: { category?: ColumnCategory }): ColumnCategory {
  return c.category ?? "unknown";
}

function readRootFontSizePx(): number {
  if (typeof window === "undefined") return 16;
  const measured = parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  return Number.isFinite(measured) ? measured : 16;
}

const DataGridTable = forwardRef<DataGridTableHandle, DataGridTableProps>(
  function DataGridTable(
    {
      data,
      loading,
      sorts,
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
      onSortColumn,
      onClearColumnSort,
      onClearAllSorts,
      onDeleteRow,
      onDuplicateRow,
      onNavigateToFk,
    },
    forwardedRef,
  ) {
    // Active cell editor focus target. Only one cell edits at a time, so a
    // single ref is enough — wired to either the <input> or the NULL chip <div>.
    const editorFocusRef = useRef<HTMLElement | null>(null);
    const isNullEditor = editValue === null;
    useEffect(() => {
      if (editingCell && editorFocusRef.current) {
        editorFocusRef.current.focus();
      }
    }, [editingCell, isNullEditor]);

    const [blobViewer, setBlobViewer] = useState<{
      data: unknown;
      columnName: string;
    } | null>(null);

    const [cellDetail, setCellDetail] = useState<{
      data: unknown;
      columnName: string;
      dataType: string;
    } | null>(null);

    // Visual order: columnOrder[visualIdx] = dataIdx
    const visualCount = data.columns.length;
    const order =
      columnOrder.length === visualCount
        ? columnOrder
        : data.columns.map((_, i) => i);

    // Outer scroll container = `<div role="grid">`. Owns `--cols` CSS
    // variable. virtualizer 가 scrollElement 로 참조한다.
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const widthColumns = useMemo(
      () =>
        data.columns.map((c) => ({
          name: c.name,
          category: getColumnCategory(c),
        })),
      [data.columns],
    );
    // Sprint 259 — schema.table 단위 localStorage 영속. 다른 테이블로
    // navigate 시 key 자동 swap (useColumnWidths 내부의 effect).
    const persistenceKey = `rdb:${schema}:${table}`;
    const {
      widths,
      setWidth,
      reset: resetColumnWidths,
    } = useColumnWidths(widthColumns, persistenceKey);

    useImperativeHandle(forwardedRef, () => ({ resetColumnWidths }), [
      resetColumnWidths,
    ]);

    // Resolve the visual-order width array. New columns (schema 변경 후)
    // fall back to category default rem — toolbar Reset (또는 cmd+shift+r)
    // 으로 일괄 재계산.
    const visualWidthsPx = useMemo(() => {
      const rootFontSizePx = readRootFontSizePx();
      return order.map((dIdx) => {
        const col = data.columns[dIdx]!;
        const stored = widths[col.name];
        if (stored != null) return stored;
        return getDefaultRem(getColumnCategory(col)) * rootFontSizePx;
      });
    }, [order, data.columns, widths]);

    const colsTemplate = useMemo(
      () => visualWidthsPx.map((w) => `${w}px`).join(" "),
      [visualWidthsPx],
    );

    const visualWidthsRef = useRef(visualWidthsPx);
    visualWidthsRef.current = visualWidthsPx;
    const getCurrentWidths = useCallback(() => visualWidthsRef.current, []);

    const { handleResizeStart } = useColumnResize({
      outerRef: scrollContainerRef,
      getCurrentWidths,
      onCommitWidth: setWidth,
    });

    const { contextMenu, setContextMenu, handleContextMenu } = useContextMenu({
      data,
      selectedRowIds,
      onSelectRow,
    });

    const { moveEditCursor } = useCellNavigation({
      data,
      order,
      pendingEdits,
      onSaveCurrentEdit,
      onStartEdit,
    });

    const copyToClipboard = useCallback((text: string) => {
      navigator.clipboard.writeText(text).catch(() => {
        // Clipboard API may fail in some environments; silently ignore
      });
    }, []);

    const totalBodyRowCount = data.rows.length + pendingNewRows.length;
    const shouldVirtualize = totalBodyRowCount > VIRTUALIZE_THRESHOLD;

    const rowVirtualizer = useVirtualizer({
      count: shouldVirtualize ? data.rows.length : 0,
      getScrollElement: () => scrollContainerRef.current,
      estimateSize: () => ROW_HEIGHT_ESTIMATE,
      overscan: 10,
    });

    useEffect(() => {
      if (!shouldVirtualize) return;
      rowVirtualizer.scrollToIndex(0, { align: "start" });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.executed_query, sorts, shouldVirtualize]);

    const overlayVisible = useDelayedFlag(loading, 1000);

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

    const colCount = data.columns.length;
    const gridStyle = {
      "--cols": colsTemplate,
    } as CSSProperties;

    return (
      <div
        className="relative flex-1 overflow-auto text-sm"
        ref={scrollContainerRef}
        role="grid"
        aria-rowcount={1 + data.rows.length + pendingNewRows.length}
        aria-colcount={colCount}
        style={gridStyle}
      >
        <AsyncProgressOverlay
          visible={overlayVisible}
          onCancel={onCancelRefetch ?? (() => {})}
        />

        <HeaderRow
          data={data}
          order={order}
          sorts={sorts}
          editingCell={editingCell}
          onSort={onSort}
          onSaveCurrentEdit={onSaveCurrentEdit}
          onResizeStart={handleResizeStart}
          onSortColumn={onSortColumn}
          onClearColumnSort={onClearColumnSort}
          onClearAllSorts={onClearAllSorts}
        />

        {shouldVirtualize ? (
          <div
            role="rowgroup"
            style={{
              position: "relative",
              height: rowVirtualizer.getTotalSize(),
              width: "100%",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => (
              <DataRow
                key={`row-${page}-${virtualRow.index}`}
                rowIdx={virtualRow.index}
                ctx={rowCtx}
                rowStyle={{
                  position: "absolute",
                  top: virtualRow.start,
                  left: 0,
                  right: 0,
                  height: virtualRow.size,
                }}
              />
            ))}
          </div>
        ) : (
          <div role="rowgroup">
            {data.rows.map((_row, rowIdx) => (
              <DataRow
                key={`row-${page}-${rowIdx}`}
                rowIdx={rowIdx}
                ctx={rowCtx}
              />
            ))}
          </div>
        )}

        {data.rows.length === 0 && pendingNewRows.length === 0 && (
          <div
            role="row"
            className="border-b border-border"
            style={{ minWidth: "max-content" }}
          >
            <div
              role="gridcell"
              aria-colindex={1}
              style={{ gridColumn: `1 / -1` }}
              className="px-3 py-4 text-center text-xs text-muted-foreground"
            >
              {activeFilterCount > 0 ? (
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
            </div>
          </div>
        )}

        {pendingNewRows.length > 0 && (
          <div role="rowgroup">
            {pendingNewRows.map((newRow, newIdx) => (
              <div
                key={`new-row-${newIdx}`}
                role="row"
                aria-rowindex={data.rows.length + newIdx + 2}
                className="border-b border-border bg-warning/5 hover:bg-muted"
                style={{
                  display: "grid",
                  gridTemplateColumns: "var(--cols)",
                  minWidth: "max-content",
                }}
              >
                {order.map((dIdx, visualIdx) => {
                  const cell = (newRow as unknown[])[dIdx];
                  return (
                    <div
                      key={`${dIdx}-${visualIdx}`}
                      role="gridcell"
                      aria-colindex={visualIdx + 1}
                      className="overflow-hidden border-r border-border px-3 py-1 text-xs italic text-muted-foreground whitespace-nowrap text-ellipsis"
                    >
                      {cell == null ? "NULL" : String(cell)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

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
  },
);

export default DataGridTable;
