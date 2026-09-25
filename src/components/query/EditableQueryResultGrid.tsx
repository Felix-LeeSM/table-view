import {
  CellDetailDialog,
  cellToEditString,
  editKey,
  getInputTypeForColumn,
  ROW_HEIGHT_ESTIMATE,
  useColumnResize,
  useGridRoving,
  VIRTUALIZE_THRESHOLD,
} from "@components/datagrid";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@components/shared/ContextMenu";
import { Button } from "@components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import ExecuteButton from "@components/ui/ExecuteButton";
import { INLINE_EDIT_CELL_RING } from "@components/ui/inlineEdit";
import { ConfirmDestructiveDialog } from "@features/workspace";
import { safeStringifyCell } from "@lib/jsonCell";
import {
  multiCellReadonlyReason,
  multiPkColumnIndices,
  type RawEditPlan,
} from "@lib/sql/rawQuerySqlBuilder";
import { useConnectionStore } from "@stores/connectionStore";
import { useVirtualizer } from "@tanstack/react-virtual";
import Decimal from "decimal.js";
import { Maximize2, Pencil, Save, Trash2, X } from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useColumnWidths } from "@/hooks/useColumnWidths";
import { getDefaultRem } from "@/lib/columnCategory";
import type { QueryResult } from "@/types/query";
import PendingChangesTray from "./PendingChangesTray";
import { useRawQueryGridEdit } from "./useRawQueryGridEdit";

export interface EditableQueryResultGridProps {
  result: QueryResult;
  connectionId: string;
  plan: RawEditPlan;
  /**
   * Issue #1102 — owning query tab id. Scopes the cross-mount pending store
   * and drives `setTabDirty`. Optional so isolated grid tests can omit it.
   */
  tabId?: string;
  /** Called after a successful commit so the parent can re-run the query. */
  onAfterCommit?: () => void;
  /**
   * #1477 review B2 — executed SQL snapshot used as the scroll-reset
   * identity. A same-SQL refetch (commit → `onAfterCommit` re-run) swaps the
   * `result` object but keeps this string, so the virtualized scroll position
   * is preserved; a different SQL resets to the top. Optional: when omitted,
   * every new `result` identity resets (pre-#1477 behavior, test-only
   * callers).
   */
  sql?: string;
}

function formatCellDisplay(cell: unknown): string {
  if (cell == null) return "NULL";
  // ADR 0026 — Decimal is `typeof === "object"`; detect before the generic
  // object branch. BigInt falls through to `String(cell)`.
  if (cell instanceof Decimal) return cell.toString();
  if (typeof cell === "object") return safeStringifyCell(cell);
  return String(cell);
}

/**
 * Editable grid for raw query results that mapped to a single table with
 * a primary key. Supports inline cell editing and per-row deletion via the
 * context menu, plus a SQL preview before any change is executed.
 *
 * INSERT is intentionally unsupported here — there is no canonical "row
 * shape" for raw query results, so adding rows belongs in the structured
 * table view instead.
 *
 * All edit state, commit lifecycle, Safe Mode gate, history recording,
 * and the Cmd+S listener live inside `useRawQueryGridEdit`. The component
 * owns only UI-local state (context menu / cell detail dialog), the
 * production stripe selector, and JSX rendering.
 */
export default function EditableQueryResultGrid({
  result,
  connectionId,
  plan,
  tabId,
  onAfterCommit,
  sql,
}: EditableQueryResultGridProps) {
  const { t } = useTranslation("query");
  const grid = useRawQueryGridEdit({
    result,
    connectionId,
    plan,
    tabId,
    onAfterCommit,
  });

  // #1477 review B1 — when virtualization unmounts an editing row outside
  // the window and later remounts it, `autoFocus` steals focus again and
  // jumps the scroll to the editing cell. Like DataGridTable (editorFocusRef,
  // L222), focus from an effect only at edit-start — a remount does not
  // change the deps, so there is no re-focus.
  const editorFocusRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (grid.editingCell && editorFocusRef.current) {
      editorFocusRef.current.focus();
    }
  }, [grid.editingCell]);

  // UI-only environment selector for the production stripe banner. The
  // Safe Mode gate is wired through the hook above; this is purely a
  // visual hint over the SQL preview header.
  const connectionEnvironment = useConnectionStore(
    (s) =>
      s.connections.find((c) => c.id === connectionId)?.environment ?? null,
  );
  // AC-256-05 — connection name for the env-aware ExecuteButton
  // "Execute on <conn>" target label.
  const connectionLabel = useConnectionStore(
    (s) => s.connections.find((c) => c.id === connectionId)?.name ?? null,
  );

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    rowIdx: number;
    colIdx: number;
  } | null>(null);
  const [cellDetail, setCellDetail] = useState<{
    data: unknown;
    columnName: string;
    dataType: string;
  } | null>(null);

  const rowKeyFn = useCallback((rowIdx: number) => `row-1-${rowIdx}`, []);

  // Column widths via shared hook + `--cols` CSS variable.
  // AC-260-02 — drag-resize enabled. A raw query result has no stable
  // identity, so widths are in-memory only, with no persistenceKey. Reset is
  // automatic too, since there is no toolbar — widths recompute to the
  // default rem for every new query.
  const widthColumns = useMemo(
    () => result.columns.map((c) => ({ name: c.name, category: c.category })),
    [result.columns],
  );

  // Issue #1299 — result column indices that are a PK of their owning source
  // instance (multi-table); drives the 🔑 header marker per instance.
  const multiPkIndices = useMemo(
    () => (plan.multi ? multiPkColumnIndices(plan.multi) : null),
    [plan.multi],
  );
  const { widths, setWidth } = useColumnWidths(widthColumns);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const visualWidthsPx = useMemo(() => {
    const rootFontSizePx =
      typeof window !== "undefined"
        ? (() => {
            const measured = parseFloat(
              getComputedStyle(document.documentElement).fontSize,
            );
            return Number.isFinite(measured) ? measured : 16;
          })()
        : 16;
    return result.columns.map((col) => {
      const stored = widths[col.name];
      if (stored != null) return stored;
      return getDefaultRem(col.category) * rootFontSizePx;
    });
  }, [result.columns, widths]);

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

  // Issue #1442 — guards against DOM blowup on a large SQL result.
  // Virtualized with the same threshold / row height / overscan as
  // DataGridTable. At or below the threshold the existing render-everything
  // path stays. A row being edited unmounts when it scrolls outside the
  // window, but the edit state stays in the hook and is restored intact when
  // it scrolls back (same as DataGridTable).
  const shouldVirtualize = result.rows.length > VIRTUALIZE_THRESHOLD;
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? result.rows.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    // Same reason as DataGridTable (#1295) — prevents the blank flash on a
    // fast scrollbar drag.
    overscan: 24,
  });

  // #1477 review B2 — reset the scroll only on a "new query". A re-fetch
  // after a commit (onAfterCommit) runs the same SQL and only changes the
  // result identity, so the position is preserved (same reason as
  // DataGridTable's executed_query deps, #1369). `sql` is kept out of the
  // deps because the fallback for a document result is the live editor text,
  // which changes on every keystroke — compare only when the result is
  // replaced. `rowVirtualizer` is a fresh object each render, so listing it
  // in the deps would reset on every render.
  const lastResetSqlRef = useRef(sql);
  useEffect(() => {
    const isNewQuery = sql === undefined || lastResetSqlRef.current !== sql;
    lastResetSqlRef.current = sql;
    if (!shouldVirtualize || !isNewQuery) return;
    rowVirtualizer.scrollToIndex(0, { align: "start" });
    // Deps intentionally track only the result-set identity + the
    // virtualization toggle. `rowVirtualizer` is a fresh object each render, so
    // listing it would re-scroll to the top on every render (cf. DataGridTable,
    // #1369).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, shouldVirtualize]);

  // issue #1130 AC1/AC2 — shared data-cell roving. Coordinates: no reorder,
  // so visualCol == colIdx. Under virtualization a row outside the window is
  // scrolled in via scrollToIndex, then the hook retries and focuses it
  // (useGridRoving's bounded rAF retry).
  const roving = useGridRoving(
    result.rows.length,
    result.columns.length,
    scrollContainerRef,
    {
      scrollRowIntoView: (row) => {
        if (shouldVirtualize) {
          rowVirtualizer.scrollToIndex(row, { align: "auto" });
        }
      },
    },
  );

  const contextMenuItems: ContextMenuItem[] = contextMenu
    ? [
        {
          label: t("editableGrid.contextMenu.showCellDetails"),
          icon: <Maximize2 size={14} />,
          onClick: () => {
            const cell = result.rows[contextMenu.rowIdx]?.[contextMenu.colIdx];
            const col = result.columns[contextMenu.colIdx];
            if (col) {
              setCellDetail({
                data: cell,
                columnName: col.name,
                dataType: col.dataType,
              });
            }
          },
        },
        {
          label: t("editableGrid.contextMenu.editCell"),
          icon: <Pencil size={14} />,
          disabled: !grid.canEditCell(contextMenu.rowIdx, contextMenu.colIdx),
          onClick: () => grid.startEdit(contextMenu.rowIdx, contextMenu.colIdx),
        },
        {
          label: t("editableGrid.contextMenu.deleteRow"),
          icon: <Trash2 size={14} />,
          danger: true,
          disabled: !grid.canDelete,
          onClick: () => grid.deleteRow(contextMenu.rowIdx),
        },
      ]
    : [];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {grid.noPk && (
        <div
          role="status"
          className="border-b border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
        >
          {t("editableGrid.readonlyNoPk")}
        </div>
      )}
      {/* Edit toolbar — only visible when there are pending changes. */}
      {grid.hasPendingChanges && (
        <div className="flex items-center justify-between border-b border-border bg-warning/10 px-3 py-1.5 text-xs">
          <span className="text-foreground">
            {grid.pendingEdits.size} edit
            {grid.pendingEdits.size !== 1 ? "s" : ""},{" "}
            {grid.pendingDeletedRowKeys.size} delete
            {grid.pendingDeletedRowKeys.size !== 1 ? "s" : ""} pending
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="xs"
              onClick={grid.handleDiscard}
              aria-label={t("editableGrid.discardAria")}
            >
              <X size={12} />
              {t("editableGrid.discard")}
            </Button>
            <Button
              size="xs"
              onClick={grid.handleCommit}
              aria-label={t("editableGrid.commitAria")}
            >
              <Save size={12} />
              {t("editableGrid.commit")}
            </Button>
          </div>
        </div>
      )}

      <PendingChangesTray
        result={result}
        pendingEdits={grid.pendingEdits}
        pendingDeletedRowKeys={grid.pendingDeletedRowKeys}
        plan={plan}
        onRevertEdit={grid.handleRevertEdit}
        onRevertDelete={grid.handleRevertDelete}
      />

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto text-sm"
        role="grid"
        aria-rowcount={1 + result.rows.length}
        aria-colcount={result.columns.length}
        style={{ "--cols": colsTemplate } as CSSProperties}
        onKeyDown={roving.onKeyDown}
      >
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
              // So bg-secondary paints to the end of the horizontal scroll.
              minWidth: "max-content",
            }}
          >
            {result.columns.map((col, visualIdx) => {
              // Issue #1297 — a PK can be projected under an alias, so match
              // against the source column name (plan.resultColumnNames maps a
              // result column index back to its underlying column) instead of
              // the displayed result name. Issue #1299 — multi-table uses the
              // resolver's per-instance PK position set.
              const isPk = multiPkIndices
                ? multiPkIndices.has(visualIdx)
                : plan.pkColumns.includes(
                    plan.resultColumnNames[visualIdx] ?? col.name,
                  );
              return (
                <div
                  key={col.name}
                  role="columnheader"
                  aria-colindex={visualIdx + 1}
                  className="relative flex flex-col justify-center overflow-hidden border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground"
                >
                  <div className="flex items-center gap-1 min-w-0">
                    {isPk && (
                      <span
                        title={t("editableGrid.pkAria")}
                        className="text-warning"
                        aria-label={t("editableGrid.pkAria")}
                      >
                        🔑
                      </span>
                    )}
                    <span className="truncate">{col.name}</span>
                  </div>
                  <div className="mt-0.5 truncate text-3xs text-muted-foreground">
                    {col.dataType}
                  </div>
                  <div
                    className="absolute right-0 top-0 h-full w-3 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 focus-visible:outline-1 focus-visible:outline-ring"
                    onMouseDown={(e) =>
                      handleResizeStart(e, col.name, visualIdx)
                    }
                    onKeyDown={(e) =>
                      handleResizeKeyDown(e, col.name, visualIdx)
                    }
                    tabIndex={0}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={t("resizeColumnAria")}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {(() => {
          // The virtualized and non-virtualized branches share the same row
          // JSX. The virtualized branch follows the DataGridTable pattern:
          // absolute-positioned rows at a fixed height.
          const renderRow = (
            row: (typeof result.rows)[number],
            rowIdx: number,
            rowStyle?: CSSProperties,
          ) => {
            const rk = rowKeyFn(rowIdx);
            const isDeleted = grid.pendingDeletedRowKeys.has(rk);
            return (
              <div
                key={rk}
                role="row"
                aria-rowindex={rowIdx + 2}
                className={`border-b border-border hover:bg-muted${
                  isDeleted ? " line-through opacity-50" : ""
                }`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "var(--cols)",
                  minWidth: "max-content",
                  ...rowStyle,
                }}
              >
                {row.map((cell, colIdx) => {
                  const col = result.columns[colIdx]!;
                  const key = editKey(rowIdx, colIdx);
                  const isEditing =
                    grid.editingCell?.row === rowIdx &&
                    grid.editingCell?.col === colIdx;
                  const hasPendingEdit = grid.pendingEdits.has(key);
                  const cellStr = cellToEditString(cell);
                  const displayValue = hasPendingEdit
                    ? grid.pendingEdits.get(key)!
                    : cellStr;
                  // Issue #1299 — per-cell editability. Multi-table read-only
                  // columns + LEFT JOIN NULL rows surface a reason tooltip.
                  const cellEditable = grid.canEditCell(rowIdx, colIdx);
                  const readonlyReason =
                    plan.multi && !cellEditable
                      ? // ponytail: reason strings stay English (dynamic
                        // per-row content is impractical to i18n); localize
                        // when the query surface gets a locale pass.
                        multiCellReadonlyReason(
                          plan.multi,
                          row as unknown[],
                          colIdx,
                        )
                      : null;

                  return (
                    <div
                      key={colIdx}
                      role="gridcell"
                      aria-colindex={colIdx + 1}
                      aria-readonly={!cellEditable || undefined}
                      data-editing={isEditing ? "true" : undefined}
                      data-grid-row={rowIdx}
                      data-grid-col={colIdx}
                      tabIndex={roving.cellTabIndex(rowIdx, colIdx)}
                      onFocus={() => roving.syncFocus(rowIdx, colIdx)}
                      className={`flex min-w-0 items-center overflow-hidden border-r border-border px-3 py-1 text-xs text-foreground ${
                        isEditing
                          ? `bg-primary/10 ${INLINE_EDIT_CELL_RING}`
                          : hasPendingEdit
                            ? "bg-highlight/20"
                            : readonlyReason
                              ? "cursor-not-allowed bg-muted/30 text-muted-foreground"
                              : ""
                      }`}
                      title={readonlyReason ?? formatCellDisplay(cell)}
                      onKeyDown={(e) => {
                        // issue #1130 AC2 — Enter/F2 starts editing the
                        // focused cell (same path as double-click). While
                        // editing, the input stopPropagations Enter/Escape so
                        // they never reach here. Cells that cannot be edited
                        // (noPk / multi read-only / NULL lock) are ignored.
                        if (isEditing) return;
                        if (e.key !== "Enter" && e.key !== "F2") return;
                        if (!cellEditable) return;
                        e.preventDefault();
                        e.stopPropagation();
                        grid.startEdit(rowIdx, colIdx);
                      }}
                      onDoubleClick={() => grid.startEdit(rowIdx, colIdx)}
                      onClick={() => {
                        if (grid.editingCell && !isEditing) {
                          grid.saveCurrentEdit();
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          rowIdx,
                          colIdx,
                        });
                      }}
                    >
                      {isEditing ? (
                        <input
                          ref={editorFocusRef}
                          type={getInputTypeForColumn(col.dataType)}
                          // #1739 follow-up (#1750) — px-0 aligns the editing
                          // value with the static cell (px-3); the cell owns
                          // the edit ring (INLINE_EDIT_CELL_RING) so the input
                          // stays bare (dropped border/shadow "floating card"
                          // look).
                          className="w-full bg-transparent px-0 py-0 text-xs text-foreground outline-none"
                          value={grid.editValue}
                          aria-label={t("editableGrid.editingCellAria", {
                            colName: col.name,
                          })}
                          onChange={(e) => grid.setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              e.stopPropagation();
                              grid.saveCurrentEdit();
                            } else if (e.key === "Escape") {
                              e.stopPropagation();
                              grid.cancelEdit();
                            }
                          }}
                        />
                      ) : hasPendingEdit ? (
                        <span
                          dir="auto"
                          className="block overflow-hidden text-ellipsis whitespace-nowrap [unicode-bidi:isolate]"
                        >
                          {displayValue}
                        </span>
                      ) : cell == null ? (
                        <span className="italic text-muted-foreground">
                          NULL
                        </span>
                      ) : (
                        <span
                          dir="auto"
                          className="block overflow-hidden text-ellipsis whitespace-nowrap [unicode-bidi:isolate]"
                        >
                          {displayValue}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          };

          if (shouldVirtualize) {
            return (
              <div
                role="rowgroup"
                style={{
                  position: "relative",
                  height: rowVirtualizer.getTotalSize(),
                  width: "100%",
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) =>
                  renderRow(result.rows[virtualRow.index]!, virtualRow.index, {
                    position: "absolute",
                    top: virtualRow.start,
                    left: 0,
                    right: 0,
                    height: virtualRow.size,
                  }),
                )}
              </div>
            );
          }
          return (
            <div role="rowgroup">
              {result.rows.map((row, rowIdx) => renderRow(row, rowIdx))}
              {result.rows.length === 0 && (
                <div
                  role="row"
                  className="border-b border-border"
                  style={{ minWidth: "max-content" }}
                >
                  <div
                    role="gridcell"
                    aria-colindex={1}
                    style={{ gridColumn: "1 / -1" }}
                    className="px-3 py-4 text-center text-xs text-muted-foreground"
                  >
                    {t("editableGrid.noData")}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenuItems}
            onClose={() => setContextMenu(null)}
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

      {/* SQL Preview modal — same shape as DataGrid's preview. */}
      <Dialog
        open={!!grid.sqlPreview}
        onOpenChange={(open) => {
          if (!open) {
            grid.dismissPreview();
          }
        }}
      >
        <DialogContent
          className="w-dialog-xl max-h-[80vh] bg-background p-0"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{t("editableGrid.sqlPreview.title")}</DialogTitle>
            <DialogDescription>
              {t("editableGrid.sqlPreview.descriptionSrOnly")}
            </DialogDescription>
          </DialogHeader>
          <div
            className="flex max-h-[80vh] flex-col rounded-lg border border-border bg-background shadow-xl"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                grid.handleExecute();
              }
            }}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">
                {t("editableGrid.sqlPreview.h3")}
              </h3>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={grid.dismissPreview}
                aria-label={t("editableGrid.sqlPreview.closeAria")}
              >
                <X size={14} />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {grid.sqlPreview?.map((sql, i) => (
                <pre
                  key={i}
                  className="mb-2 whitespace-pre-wrap break-all rounded bg-secondary p-2 text-xs text-secondary-foreground"
                >
                  {sql}
                </pre>
              ))}
              {grid.executeError && (
                <div
                  role="alert"
                  className="mt-2 rounded bg-destructive/10 p-2 text-xs text-destructive"
                >
                  {grid.executeError}
                </div>
              )}
            </div>
            <DialogFooter className="border-t border-border px-4 py-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={grid.dismissPreview}
                disabled={grid.executing}
              >
                {t("editableGrid.sqlPreview.cancel")}
              </Button>
              <ExecuteButton
                severity="warn"
                environment={connectionEnvironment}
                connectionLabel={connectionLabel}
                loading={grid.executing}
                disabled={false}
                onClick={grid.handleExecute}
                ariaLabel="Execute SQL"
                autoFocus
              />
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      {grid.pendingConfirm && (
        <ConfirmDestructiveDialog
          open={true}
          reason={grid.pendingConfirm.reason}
          sqlPreview={grid.pendingConfirm.sql}
          environment={
            connectionEnvironment === "production"
              ? "production"
              : "non-production"
          }
          connectionId={connectionId}
          // `pendingConfirm.sql` carries the joined batch (`;\n`-
          // delimited). For the dry-run preview we want one entry
          // per statement so each row reports its own rows_affected.
          // We re-split the joined string here rather than reach
          // into the hook's source `sqls` array because the hook's
          // public surface intentionally emits the joined string as
          // the user-facing preview.
          statements={grid.pendingConfirm.sql
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean)}
          paradigm="rdb"
          onConfirm={() => {
            void grid.confirmDangerous();
          }}
          onCancel={grid.cancelDangerous}
        />
      )}
    </div>
  );
}
