import { useCallback, useRef, useState } from "react";
import { Loader2, Key, Binary, ArrowUpRight } from "lucide-react";
import { Button } from "@components/ui/button";
import { truncateCell } from "@lib/format";
import type { SortInfo, TableData } from "@/types/schema";
import {
  editKey,
  cellToEditValue,
  getInputTypeForColumn,
} from "./useDataGridEdit";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@components/shared/ContextMenu";
import {
  Pencil,
  Trash2,
  Copy,
  Clipboard,
  FileJson,
  FileText,
  Database,
  Maximize2,
  CircleSlash,
} from "lucide-react";
import BlobViewerDialog from "./BlobViewerDialog";
import CellDetailDialog from "./CellDetailDialog";
import {
  rowsToPlainText,
  rowsToJson,
  rowsToCsv,
  rowsToSqlInsert,
} from "@lib/format";
import type { CopyRowData } from "@lib/format";

const MIN_COL_WIDTH = 60;

function parseFkReference(
  ref: string,
): { schema: string; table: string; column: string } | null {
  const match = ref.match(/^(.+)\.(.+)\((.+)\)$/);
  if (!match) return null;
  return { schema: match[1]!, table: match[2]!, column: match[3]! };
}

function isBlobColumn(dataType: string): boolean {
  const lower = dataType.toLowerCase();
  return (
    lower.includes("blob") ||
    lower.includes("bytea") ||
    lower.includes("binary") ||
    lower.includes("varbinary") ||
    lower.includes("image")
  );
}

function calcDefaultColWidth(name: string, dataType: string): number {
  const nameWidth = name.length * 8 + 40;
  const typeWidth = dataType.length * 6 + 20;
  return Math.max(MIN_COL_WIDTH, Math.min(400, Math.max(nameWidth, typeWidth)));
}

export interface DataGridTableProps {
  data: TableData;
  loading: boolean;
  sorts: SortInfo[];
  columnWidths: Record<string, number>;
  columnOrder: number[];
  editingCell: { row: number; col: number } | null;
  editValue: string | null;
  pendingEdits: Map<string, string | null>;
  selectedRowIds: Set<number>;
  pendingDeletedRowKeys: Set<string>;
  pendingNewRows: unknown[][];
  page: number;
  schema: string;
  table: string;
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
  selectedRowIds,
  pendingDeletedRowKeys,
  pendingNewRows,
  page,
  schema,
  table,
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
  // Tracks mousedown position on column headers to distinguish clicks from drags.
  // When movement exceeds 4px we suppress the sort so that dragging the header
  // (e.g. to scroll horizontally) doesn't accidentally change sort order.
  const sortMouseStartRef = useRef<{ x: number; y: number } | null>(null);
  const resizingRef = useRef<{
    colName: string;
    startX: number;
    startWidth: number;
    startTableWidth: number;
    colIdx: number;
  } | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    rowIdx: number;
    colIdx: number;
  } | null>(null);

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

  /**
   * Move the inline edit cursor to a neighboring cell.
   *
   * Visual layout uses `order` so that `direction` is always interpreted
   * relative to what the user sees, not the underlying data column index.
   * Wraps to the next/previous row when the requested move overflows the
   * row boundary; clamps at the table boundaries (no wrap across the entire
   * grid — staying in-place is less surprising than jumping back to (0,0)).
   */
  const moveEditCursor = useCallback(
    (
      currentRow: number,
      currentDataCol: number,
      direction: "next-col" | "prev-col" | "next-row" | "prev-row",
    ) => {
      const totalRows = data.rows.length;
      if (totalRows === 0) return;
      const totalCols = order.length;
      if (totalCols === 0) return;

      const visualCol = order.indexOf(currentDataCol);
      if (visualCol === -1) return;

      let nextRow = currentRow;
      let nextVisualCol = visualCol;

      if (direction === "next-col") {
        nextVisualCol = visualCol + 1;
        if (nextVisualCol >= totalCols) {
          nextVisualCol = 0;
          nextRow = currentRow + 1;
        }
      } else if (direction === "prev-col") {
        nextVisualCol = visualCol - 1;
        if (nextVisualCol < 0) {
          nextVisualCol = totalCols - 1;
          nextRow = currentRow - 1;
        }
      } else if (direction === "next-row") {
        nextRow = currentRow + 1;
      } else if (direction === "prev-row") {
        nextRow = currentRow - 1;
      }

      if (nextRow < 0 || nextRow >= totalRows) {
        // Past the edge of the grid — just save and stop here
        onSaveCurrentEdit();
        return;
      }

      const nextDataCol = order[nextVisualCol]!;
      const nextCell = (data.rows[nextRow] as unknown[])[nextDataCol];
      const editKeyStr = editKey(nextRow, nextDataCol);
      const pendingValue = pendingEdits.get(editKeyStr);
      const startValue =
        pendingValue !== undefined ? pendingValue : cellToEditValue(nextCell);

      // onStartEdit persists the current in-flight edit before opening
      // the next cell, so callers don't need to call onSaveCurrentEdit.
      onStartEdit(nextRow, nextDataCol, startValue);
    },
    [data.rows, order, pendingEdits, onSaveCurrentEdit, onStartEdit],
  );

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {
      // Clipboard API may fail in some environments; silently ignore
    });
  }, []);

  const getSelectedCopyData = useCallback((): CopyRowData => {
    const sortedIds = [...selectedRowIds].sort((a, b) => a - b);
    const colNames = data.columns.map((c) => c.name);
    const rows = sortedIds.map((idx) => data.rows[idx] as unknown[]);
    return { columns: colNames, rows, schema, table };
  }, [selectedRowIds, data, schema, table]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, rowIdx: number, colIdx: number) => {
      e.preventDefault();
      if (data.rows.length === 0) return;
      // If right-clicked row is not selected, select it first
      if (!selectedRowIds.has(rowIdx)) {
        onSelectRow(rowIdx, false, false);
      }
      setContextMenu({ x: e.clientX, y: e.clientY, rowIdx, colIdx });
    },
    [data.rows.length, selectedRowIds, onSelectRow],
  );

  const contextMenuItems: ContextMenuItem[] = contextMenu
    ? [
        {
          label: "Show Cell Details",
          icon: <Maximize2 size={14} />,
          onClick: () => {
            const cell = data.rows[contextMenu.rowIdx]?.[contextMenu.colIdx];
            const col = data.columns[contextMenu.colIdx];
            if (col) {
              setCellDetail({
                data: cell,
                columnName: col.name,
                dataType: col.data_type,
              });
            }
          },
        },
        {
          label: "Edit Cell",
          icon: <Pencil size={14} />,
          onClick: () => {
            const cell = data.rows[contextMenu.rowIdx]?.[contextMenu.colIdx];
            const editVal = cellToEditValue(cell);
            onStartEdit(contextMenu.rowIdx, contextMenu.colIdx, editVal);
          },
        },
        {
          label: "Set to NULL",
          icon: <CircleSlash size={14} />,
          onClick: () => {
            onStartEdit(contextMenu.rowIdx, contextMenu.colIdx, null);
            onSetEditNull();
          },
        },
        {
          label: "Delete Row",
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: onDeleteRow,
        },
        {
          label: "Duplicate Row",
          icon: <Copy size={14} />,
          onClick: onDuplicateRow,
        },
        {
          label: "",
          separator: true,
          onClick: () => {},
        },
        {
          label: "Copy as Plain Text",
          icon: <Clipboard size={14} />,
          onClick: () =>
            copyToClipboard(rowsToPlainText(getSelectedCopyData())),
        },
        {
          label: "Copy as JSON",
          icon: <FileJson size={14} />,
          onClick: () => copyToClipboard(rowsToJson(getSelectedCopyData())),
        },
        {
          label: "Copy as CSV",
          icon: <FileText size={14} />,
          onClick: () => copyToClipboard(rowsToCsv(getSelectedCopyData())),
        },
        {
          label: "Copy as SQL Insert",
          icon: <Database size={14} />,
          onClick: () =>
            copyToClipboard(rowsToSqlInsert(getSelectedCopyData())),
        },
      ]
    : [];

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, colName: string, colIdx: number) => {
      e.stopPropagation();
      e.preventDefault();
      const th = tableRef.current?.querySelector(
        `th:nth-child(${colIdx + 1})`,
      ) as HTMLElement | null;
      // Prioritise the stored width so that a second resize always starts
      // from the result of the first one, not from the default/DOM value.
      const currentWidth =
        columnWidths[colName] ??
        th?.getBoundingClientRect().width ??
        calcDefaultColWidth(colName, "");
      const startTableWidth =
        tableRef.current?.getBoundingClientRect().width ?? 0;
      resizingRef.current = {
        colName,
        startX: e.clientX,
        startWidth: currentWidth,
        startTableWidth,
        colIdx,
      };

      const applyWidth = (width: number) => {
        if (!tableRef.current || !resizingRef.current) return;
        const delta = width - resizingRef.current.startWidth;
        tableRef.current.style.width = `${resizingRef.current.startTableWidth + delta}px`;
        const w = `${width}px`;
        const th = tableRef.current.querySelector(
          `th:nth-child(${colIdx + 1})`,
        ) as HTMLElement | null;
        if (th) th.style.width = w;
        const cells = tableRef.current.querySelectorAll(
          `td:nth-child(${colIdx + 1})`,
        );
        cells.forEach((td) => {
          (td as HTMLElement).style.width = w;
        });
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!resizingRef.current) return;
        const delta = moveEvent.clientX - resizingRef.current.startX;
        const newWidth = Math.max(
          MIN_COL_WIDTH,
          resizingRef.current.startWidth + delta,
        );
        applyWidth(newWidth);
      };

      const handleMouseUp = () => {
        if (resizingRef.current) {
          const {
            colName: resizedColName,
            colIdx: resizedColIdx,
            startWidth,
          } = resizingRef.current;
          const finalWidth = tableRef.current?.querySelector(
            `th:nth-child(${resizedColIdx + 1})`,
          ) as HTMLElement | null;
          const rawW = finalWidth ? parseInt(finalWidth.style.width, 10) : NaN;
          const w = Number.isNaN(rawW) ? startWidth : rawW;
          onColumnWidthsChange((prev) => ({
            ...prev,
            [resizedColName]: w,
          }));
        }
        resizingRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [columnWidths, onColumnWidthsChange],
  );

  const rowKeyFn = (rowIdx: number) => `row-${page}-${rowIdx}`;

  return (
    <div className="relative flex-1 overflow-auto">
      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60">
          <Loader2 className="animate-spin text-muted-foreground" size={24} />
        </div>
      )}
      <table
        className="min-w-full table-fixed border-collapse text-sm"
        ref={tableRef}
      >
        <thead className="sticky top-0 z-10 bg-secondary">
          <tr>
            {order.map((dIdx, visualIdx) => {
              const col = data.columns[dIdx]!;
              const sortInfo = sorts.find((s) => s.column === col.name);
              const sortRank = sortInfo ? sorts.indexOf(sortInfo) + 1 : 0;
              return (
                <th
                  key={col.name}
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
                      const dx = Math.abs(
                        e.clientX - sortMouseStartRef.current.x,
                      );
                      const dy = Math.abs(
                        e.clientY - sortMouseStartRef.current.y,
                      );
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
                        {sortInfo.direction === "ASC" ? "\u25B2" : "\u25BC"}
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
                    onMouseDown={(e) =>
                      handleResizeStart(e, col.name, visualIdx)
                    }
                    onClick={(e) => e.stopPropagation()}
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, rowIdx) => {
            const rk = rowKeyFn(rowIdx);
            const isDeleted = pendingDeletedRowKeys.has(rk);
            const isSelected = selectedRowIds.has(rowIdx);
            return (
              <tr
                key={rk}
                className={`border-b border-border hover:bg-muted${isSelected ? " bg-accent/20" : ""}${isDeleted ? " line-through opacity-50" : ""}`}
                onClick={(e) =>
                  onSelectRow(rowIdx, e.metaKey || e.ctrlKey, e.shiftKey)
                }
                onContextMenu={(e) => {
                  // Fallback when the right-click lands between cells.
                  // Cell-level handlers below override this when the click
                  // hits a real td so the context menu reflects that cell.
                  handleContextMenu(e, rowIdx, 0);
                }}
              >
                {order.map((dIdx, visualIdx) => {
                  const cell = (row as unknown[])[dIdx];
                  const col = data.columns[dIdx]!;
                  const key = editKey(rowIdx, dIdx);
                  const isEditing =
                    editingCell?.row === rowIdx && editingCell?.col === dIdx;
                  const hasPendingEdit = pendingEdits.has(key);
                  const cellEditValue = cellToEditValue(cell);
                  const pendingValue: string | null = hasPendingEdit
                    ? (pendingEdits.get(key) as string | null)
                    : null;
                  const editStartValue = hasPendingEdit
                    ? pendingValue
                    : cellEditValue;
                  const isBlob = isBlobColumn(col.data_type);

                  const fkRef =
                    col.is_foreign_key && col.fk_reference && cell != null
                      ? parseFkReference(col.fk_reference)
                      : null;

                  return (
                    <td
                      key={`${dIdx}-${visualIdx}`}
                      data-editing={isEditing ? "true" : undefined}
                      className={`group/cell overflow-hidden border-r border-border px-3 py-1 text-xs text-foreground${
                        isEditing
                          ? " bg-primary/10 ring-2 ring-inset ring-primary"
                          : hasPendingEdit
                            ? " bg-highlight/20"
                            : ""
                      }`}
                      style={{
                        width: getColumnWidth(col.name, col.data_type),
                        minWidth: MIN_COL_WIDTH,
                      }}
                      title={
                        cell == null
                          ? "NULL"
                          : typeof cell === "object" && cell !== null
                            ? JSON.stringify(cell, null, 2)
                            : String(cell)
                      }
                      onDoubleClick={() =>
                        onStartEdit(rowIdx, dIdx, editStartValue)
                      }
                      onClick={() => {
                        if (editingCell) {
                          onSaveCurrentEdit();
                        }
                      }}
                      onContextMenu={(e) => {
                        // Stop the row-level handler from overwriting our
                        // accurate per-cell coordinates with colIdx=0.
                        e.stopPropagation();
                        handleContextMenu(e, rowIdx, dIdx);
                      }}
                    >
                      {isEditing ? (
                        editValue === null ? (
                          <div
                            className="flex items-center gap-2 outline-none"
                            role="textbox"
                            aria-label={`Editing ${col.name} — currently NULL`}
                            tabIndex={0}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Tab") {
                                e.preventDefault();
                                e.stopPropagation();
                                moveEditCursor(
                                  rowIdx,
                                  dIdx,
                                  e.shiftKey ? "prev-col" : "next-col",
                                );
                              } else if (e.key === "Enter") {
                                e.preventDefault();
                                e.stopPropagation();
                                moveEditCursor(
                                  rowIdx,
                                  dIdx,
                                  e.shiftKey ? "prev-row" : "next-row",
                                );
                              } else if (e.key === "Escape") {
                                e.stopPropagation();
                                onCancelEdit();
                              } else if (
                                (e.metaKey || e.ctrlKey) &&
                                e.key === "Backspace"
                              ) {
                                // Already NULL — just eat the shortcut.
                                e.preventDefault();
                              } else if (
                                e.key.length === 1 &&
                                !e.metaKey &&
                                !e.ctrlKey &&
                                !e.altKey
                              ) {
                                // Printable key flips NULL → text, seeded with
                                // that character. The re-rendered <input> will
                                // take focus via autoFocus on the next tick.
                                e.preventDefault();
                                onSetEditValue(e.key);
                              }
                            }}
                          >
                            <span
                              className="italic text-muted-foreground"
                              aria-hidden="true"
                            >
                              NULL
                            </span>
                            <span className="text-2xs text-muted-foreground">
                              Type to edit · Esc to cancel
                            </span>
                          </div>
                        ) : (
                          <input
                            type={getInputTypeForColumn(col.data_type)}
                            className="w-full bg-transparent px-1 py-0 text-xs text-foreground outline-none"
                            value={editValue}
                            autoFocus
                            aria-label={`Editing ${col.name}`}
                            onChange={(e) => onSetEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (
                                (e.metaKey || e.ctrlKey) &&
                                e.key === "Backspace"
                              ) {
                                e.preventDefault();
                                e.stopPropagation();
                                onSetEditNull();
                              } else if (e.key === "Tab") {
                                e.preventDefault();
                                e.stopPropagation();
                                moveEditCursor(
                                  rowIdx,
                                  dIdx,
                                  e.shiftKey ? "prev-col" : "next-col",
                                );
                              } else if (e.key === "Enter") {
                                e.preventDefault();
                                e.stopPropagation();
                                moveEditCursor(
                                  rowIdx,
                                  dIdx,
                                  e.shiftKey ? "prev-row" : "next-row",
                                );
                              } else if (e.key === "Escape") {
                                e.stopPropagation();
                                onCancelEdit();
                              }
                            }}
                          />
                        )
                      ) : hasPendingEdit ? (
                        pendingValue === null ? (
                          <span
                            className="italic text-muted-foreground"
                            aria-label="NULL"
                          >
                            NULL
                          </span>
                        ) : (
                          <span className="line-clamp-3">{pendingValue}</span>
                        )
                      ) : isBlob && cell != null ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            setBlobViewer({ data: cell, columnName: col.name });
                          }}
                          aria-label={`View BLOB data for ${col.name}`}
                        >
                          <Binary />
                          <span>(BLOB)</span>
                        </Button>
                      ) : cell == null ? (
                        <span className="italic text-muted-foreground">
                          NULL
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <span className="line-clamp-3">
                            {truncateCell(
                              typeof cell === "object" && cell !== null
                                ? JSON.stringify(cell, null, 2)
                                : String(cell),
                            )}
                          </span>
                          {fkRef && onNavigateToFk && (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="invisible shrink-0 group-hover/cell:visible text-muted-foreground hover:text-foreground"
                              aria-label={`Open referenced row in ${fkRef.schema}.${fkRef.table}`}
                              title={`Go to ${fkRef.schema}.${fkRef.table} (${fkRef.column})`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onNavigateToFk(
                                  fkRef.schema,
                                  fkRef.table,
                                  fkRef.column,
                                  String(cell),
                                );
                              }}
                            >
                              <ArrowUpRight size={10} />
                            </Button>
                          )}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {data.rows.length === 0 && pendingNewRows.length === 0 && (
            <tr>
              <td
                colSpan={data.columns.length}
                className="px-3 py-4 text-center text-xs text-muted-foreground"
              >
                No data
              </td>
            </tr>
          )}
          {pendingNewRows.map((newRow, newIdx) => (
            <tr
              key={`new-row-${newIdx}`}
              className="border-b border-border bg-warning/5 hover:bg-muted"
            >
              {order.map((dIdx, visualIdx) => {
                const cell = (newRow as unknown[])[dIdx];
                const col = data.columns[dIdx]!;
                return (
                  <td
                    key={`${dIdx}-${visualIdx}`}
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
          items={contextMenuItems}
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
