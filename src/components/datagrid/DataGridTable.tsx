import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@components/ui/button";
import AsyncProgressOverlay from "@components/feedback/AsyncProgressOverlay";
import { DocumentTreePanel } from "@components/document/DocumentTreePanel";
import { safeStringifyCell } from "@lib/jsonCell";
import { useColumnWidths } from "@/hooks/useColumnWidths";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import type { ColumnPrefsPk } from "@/lib/tauri/datagrid_prefs";
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
import { useGridRoving } from "./useGridRoving";

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
  /**
   * Issue #1174 — edit-time row-identity anchors keyed by base cell key
   * `${rowIdx}-${colIdx}`. When present, the render overlay follows a
   * pending edit to its actual row instead of the visual row index (which
   * drifts across pagination / sort / filter). Optional → grids that don't
   * thread it keep the pre-#1081 index-match behavior.
   */
  pendingEditRowSnapshots?: ReadonlyMap<string, ReadonlyArray<unknown>>;
  pendingEditErrors?: Map<string, string>;
  selectedRowIds: Set<number>;
  pendingDeletedRowKeys: Set<string>;
  pendingNewRows: unknown[][];
  canEditRows?: boolean;
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
  /**
   * Sprint 318 — Slice D.2: hide column. When `hiddenColumnNames`
   * carries a column's name, that column drops out of the header
   * row, body rows, pendingNewRows, the `--cols` template, and the
   * aria-colcount. `onHideColumn` wires the header context menu's
   * "Hide column" item to the caller's `useHiddenColumns.hide`.
   * Both optional → 미제공 caller 의 회귀 0.
   */
  hiddenColumnNames?: ReadonlySet<string>;
  onHideColumn?: (columnName: string) => void;
  /**
   * Sprint 376 (Phase 6 Q21 #6) — "Show all columns" header context-menu
   * affordance. Parent wires this to `useHiddenColumns.clear` (or the
   * equivalent backend `resetDatagridPrefs(field="hiddenColumns")`).
   */
  onShowAllColumns?: () => void;
  onDeleteRow: () => void;
  onDuplicateRow: () => void;
  onNavigateToFk?: (
    schema: string,
    table: string,
    column: string,
    value: string,
  ) => void;
  /**
   * Sprint 343 (2026-05-15) — inline JSON tree expand wiring. The
   * panel commits each leaf edit through `setPendingEdits` against a
   * dot-path key (`"rowIdx-colIdx:meta.role"`); the SQL generator
   * dispatches by column.data_type to emit `jsonb_set` for jsonb
   * columns and a full `ARRAY[...]` reassign for Postgres arrays.
   * Required for jsonb / ARRAY editing — omit on grids that don't
   * carry those column types and the sentinel buttons simply won't
   * commit anything (read-only fallback).
   */
  setPendingEdits?: (next: Map<string, string | null>) => void;
  /**
   * Sprint 369 (Phase 4, Q20) — 5-tuple PK identifying the
   * `datagrid_column_prefs` row owning this grid's per-table column
   * widths. Missing → hook stays in-memory only (used by ad-hoc query
   * grids that have no stable identity). Present → mount-hydrate via
   * `get_datagrid_prefs` and drag-end via `set_datagrid_prefs`.
   */
  columnPrefsPk?: ColumnPrefsPk;
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
      pendingEditRowSnapshots,
      pendingEditErrors,
      selectedRowIds,
      pendingDeletedRowKeys,
      pendingNewRows,
      canEditRows = true,
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
      hiddenColumnNames,
      onHideColumn,
      onShowAllColumns,
      onDeleteRow,
      onDuplicateRow,
      onNavigateToFk,
      setPendingEdits,
      columnPrefsPk,
    },
    forwardedRef,
  ) {
    const { t } = useTranslation("datagrid");

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

    // Sprint 343 (2026-05-15) — inline JSON tree panel coordinate.
    // Mirrors `DocumentDataGrid.expandedNested` (Sprint 341/342) so
    // jsonb / Postgres ARRAY cells can mount the same tree UI.
    //
    // `pkSnapshot` is the JSON-stringified primary-key tuple captured
    // at expand-time. On every data change an effect compares the
    // current pk tuple at `rowIdx`; mismatch (sort / filter / refetch
    // moved the row or replaced it) auto-closes the panel so the user
    // never edits the wrong row by accident.
    const [expandedNested, setExpandedNested] = useState<{
      rowIdx: number;
      colIdx: number;
      pkSnapshot: string;
    } | null>(null);

    const pkSnapshotForRow = useCallback(
      (rowIdx: number): string => {
        const row = data.rows[rowIdx] as unknown[] | undefined;
        if (!row) return "";
        const pkValues: unknown[] = [];
        data.columns.forEach((c, i) => {
          if (c.is_primary_key) pkValues.push(row[i]);
        });
        // Fallback to the whole row when no PK column is declared —
        // the WHERE clause builder does the same, so the snapshot
        // semantics stay consistent.
        return safeStringifyCell(
          pkValues.length > 0 ? pkValues : (row as unknown),
        );
      },
      [data.rows, data.columns],
    );

    const handleToggleNested = useCallback(
      (rowIdx: number, colIdx: number) => {
        setExpandedNested((prev) => {
          if (prev && prev.rowIdx === rowIdx && prev.colIdx === colIdx) {
            return null;
          }
          return {
            rowIdx,
            colIdx,
            pkSnapshot: pkSnapshotForRow(rowIdx),
          };
        });
      },
      [pkSnapshotForRow],
    );

    useEffect(() => {
      if (!expandedNested) return;
      const currentSnapshot = pkSnapshotForRow(expandedNested.rowIdx);
      // Row went away (rowIdx beyond rows.length) → currentSnapshot=""
      // and won't match the captured snapshot, so we still close.
      if (currentSnapshot !== expandedNested.pkSnapshot) {
        setExpandedNested(null);
      }
    }, [data.rows, expandedNested, pkSnapshotForRow]);

    // Visual order: columnOrder[visualIdx] = dataIdx
    const visualCount = data.columns.length;
    const baseOrder =
      columnOrder.length === visualCount
        ? columnOrder
        : data.columns.map((_, i) => i);
    // Sprint 318 D.2 — hidden columns are dropped from the visible
    // order before any layout / virtualization / aria-* derivation.
    // `useMemo` keeps the identity stable across renders so the
    // virtualizer's `count` and `rowCtx` deps don't churn.
    const order = useMemo(() => {
      if (!hiddenColumnNames || hiddenColumnNames.size === 0) return baseOrder;
      return baseOrder.filter(
        (dIdx) => !hiddenColumnNames.has(data.columns[dIdx]!.name),
      );
    }, [baseOrder, hiddenColumnNames, data.columns]);

    // Outer scroll container = `<div role="grid">`. Owns `--cols` CSS
    // variable. virtualizer 가 scrollElement 로 참조한다.
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Sprint 343 — viewport width tracking for the inline tree panel
    // (same pattern as `DocumentDataGrid`). Sized via ResizeObserver
    // so window resize / sidebar toggle stays in sync. Deps include
    // `data` because the scroll container lives behind a `{data && ...}`
    // guard at first paint.
    const [scrollContainerWidth, setScrollContainerWidth] = useState(0);
    useEffect(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const update = () => setScrollContainerWidth(el.clientWidth);
      update();
      const obs = new ResizeObserver(update);
      obs.observe(el);
      return () => obs.disconnect();
    }, [data]);

    // Sprint 343 — pendingByPath helper for DocumentTreePanel. Filters
    // the cell-keyed pendingEdits map down to the (rowIdx, colIdx)
    // entries that carry a `:dot.path` suffix.
    const buildNestedPendingByPath = useCallback(
      (rowIdx: number, colIdx: number) => {
        const prefix = `${rowIdx}-${colIdx}:`;
        const out = new Map<string, string | Record<string, unknown>>();
        pendingEdits.forEach((value, key) => {
          if (!key.startsWith(prefix)) return;
          const path = key.slice(prefix.length);
          out.set(path, value ?? "");
        });
        return out;
      },
      [pendingEdits],
    );

    const widthColumns = useMemo(
      () =>
        data.columns.map((c) => ({
          name: c.name,
          category: getColumnCategory(c),
        })),
      [data.columns],
    );
    // Sprint 369 (Phase 4, Q20) — `datagrid_column_prefs` SQLite SOT.
    // `columnPrefsPk` 가 들어오면 hook 이 mount 시 IPC hydrate + drag 시 IPC
    // patch. 미제공 (ad-hoc query result grid) 면 in-memory only.
    const {
      widths,
      setWidth,
      reset: resetColumnWidths,
    } = useColumnWidths(widthColumns, columnPrefsPk);

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

    const { handleResizeStart, handleResizeKeyDown } = useColumnResize({
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
    // Sprint 349 — virtualizer assumes uniform row height; the inline
    // JSON tree master/detail row breaks that assumption. The cheap fix
    // is to disable virtualization while a detail panel is open so the
    // user gets the full master/detail UX without an absolute-position
    // overlay hack. For >200 rows the perf cost is bounded — the user
    // only opened ONE nested cell at a time, and they typically don't
    // scroll far past it. When they close the panel virtualization
    // resumes on the next paint.
    const shouldVirtualize =
      totalBodyRowCount > VIRTUALIZE_THRESHOLD && expandedNested === null;

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

    // Design-swarm #4 Phase 2 — data-cell roving tabindex + 방향키 2D nav.
    // 좌표계: row=data row index, col=visual column index. virtualized 일 때
    // target row 가 window 밖이면 scrollToIndex 로 스크롤-인 후 hook 이 재시도해
    // focus 한다 (useGridRoving 의 bounded rAF retry).
    const roving = useGridRoving(
      data.rows.length,
      order.length,
      scrollContainerRef,
      {
        scrollRowIntoView: (row) => {
          if (shouldVirtualize) {
            rowVirtualizer.scrollToIndex(row, { align: "auto" });
          }
        },
      },
    );

    const rowCtx: DataGridRowContext = useMemo(
      () => ({
        data,
        page,
        order,
        editingCell,
        editValue,
        pendingEdits,
        pendingEditRowSnapshots,
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
        expandedNested,
        onToggleNested: handleToggleNested,
        canEditRows,
        cellTabIndex: roving.cellTabIndex,
        onFocusCell: roving.syncFocus,
      }),
      [
        data,
        page,
        order,
        editingCell,
        editValue,
        pendingEdits,
        pendingEditRowSnapshots,
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
        expandedNested,
        handleToggleNested,
        canEditRows,
        roving.cellTabIndex,
        roving.syncFocus,
      ],
    );

    const colCount = order.length;
    const gridStyle = {
      "--cols": colsTemplate,
    } as CSSProperties;

    return (
      <div
        className="relative flex-1 overflow-auto text-sm"
        ref={scrollContainerRef}
        role="grid"
        // #1137 — flag the grid busy while a (re)fetch is in flight so SR
        // users hear the loading transition (consistent with the toolbar
        // commit-flash `aria-busy`).
        aria-busy={loading || undefined}
        aria-rowcount={1 + data.rows.length + pendingNewRows.length}
        aria-colcount={colCount}
        style={gridStyle}
        onKeyDown={roving.onKeyDown}
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
          onResizeKeyDown={handleResizeKeyDown}
          onSortColumn={onSortColumn}
          onClearColumnSort={onClearColumnSort}
          onClearAllSorts={onClearAllSorts}
          onHideColumn={onHideColumn}
          // Sprint 376 (Phase 6 Q21 #5 + #6) — header context menu reset
          // affordances. `resetColumnWidths` is already the imperative
          // handle for the toolbar / shortcut; we also expose it on the
          // header menu so the user can find it without leaving the grid.
          onResetColumnWidths={resetColumnWidths}
          onShowAllColumns={onShowAllColumns}
          anyColumnHidden={(hiddenColumnNames?.size ?? 0) > 0}
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
            {data.rows.map((row, rowIdx) => {
              const isExpandedHere = expandedNested?.rowIdx === rowIdx;
              const expandedCol = isExpandedHere
                ? data.columns[expandedNested!.colIdx]
                : null;
              const expandedCell = isExpandedHere
                ? (row as unknown[])[expandedNested!.colIdx]
                : undefined;
              return (
                <Fragment key={`row-${page}-${rowIdx}`}>
                  <DataRow rowIdx={rowIdx} ctx={rowCtx} />
                  {/*
                    Sprint 343 (2026-05-15) — inline JSON tree master/
                    detail row for jsonb / Postgres ARRAY cells. Same
                    layout contract as DocumentDataGrid: detail row
                    matches the data row's grid template + minWidth so
                    `position: sticky; left: 0` on the inner sticks to
                    the visible viewport (not the col-1 left edge).
                    Width pinned to `scrollContainerWidth` so the panel
                    fills only the visible portion, not the full table.
                  */}
                  {isExpandedHere &&
                    expandedCol &&
                    expandedCell != null &&
                    typeof expandedCell === "object" && (
                      <div
                        role="row"
                        data-testid={`rdb-nested-detail-row-${rowIdx}`}
                        className="border-b border-border bg-secondary/20"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "var(--cols)",
                          minWidth: "max-content",
                        }}
                      >
                        <div
                          role="gridcell"
                          style={{ gridColumn: "1 / -1" }}
                          className="p-0"
                        >
                          <div
                            className="sticky left-0"
                            style={{
                              width: scrollContainerWidth || undefined,
                            }}
                          >
                            <DocumentTreePanel
                              value={expandedCell}
                              fieldName={expandedCol.name}
                              pendingByPath={buildNestedPendingByPath(
                                rowIdx,
                                expandedNested!.colIdx,
                              )}
                              onCommitEdit={
                                canEditRows
                                  ? (path, value) => {
                                      if (!setPendingEdits) return;
                                      const next = new Map(pendingEdits);
                                      // The panel hands us `string |
                                      // Record<…>` but the RDB pendingEdits
                                      // map is `string | null`. Convert any
                                      // object value to its JSON literal so
                                      // the SQL generator sees a string.
                                      // Objects are only ever produced by
                                      // the BSON branch (Mongo-only), which
                                      // doesn't apply here — but keep the
                                      // safe stringify as a guard.
                                      const serialized: string =
                                        typeof value === "string"
                                          ? value
                                          : safeStringifyCell(value);
                                      next.set(
                                        `${rowIdx}-${expandedNested!.colIdx}:${path}`,
                                        serialized,
                                      );
                                      setPendingEdits(next);
                                    }
                                  : undefined
                              }
                              onClose={() => setExpandedNested(null)}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                </Fragment>
              );
            })}
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
                  <span>{t("noRowsMatch")}</span>
                  <Button
                    variant="outline"
                    size="xs"
                    aria-label={t("clearFiltersAria")}
                    onClick={() => onClearFilters?.()}
                  >
                    {t("clearFilter")}
                  </Button>
                </div>
              ) : (
                t("tableEmpty")
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
              canEditRows,
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
