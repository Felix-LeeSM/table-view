import { useCallback, useRef, useState } from "react";
import { Loader2, Key, Binary } from "lucide-react";
import { truncateCell } from "../../lib/format";
import type { SortInfo, TableData } from "../../types/schema";
import { editKey, getInputTypeForColumn } from "./useDataGridEdit";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import {
  Pencil,
  Trash2,
  Copy,
  Clipboard,
  FileJson,
  FileText,
  Database,
} from "lucide-react";
import BlobViewerDialog from "./BlobViewerDialog";
import {
  rowsToPlainText,
  rowsToJson,
  rowsToCsv,
  rowsToSqlInsert,
} from "../../lib/format";
import type { CopyRowData } from "../../lib/format";

const MIN_COL_WIDTH = 60;
const RESIZE_HANDLE_WIDTH = 4; // w-1 = 4px

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
  editValue: string;
  pendingEdits: Map<string, string>;
  selectedRowIds: Set<number>;
  pendingDeletedRowKeys: Set<string>;
  pendingNewRows: unknown[][];
  page: number;
  schema: string;
  table: string;
  onSetEditValue: (v: string) => void;
  onSaveCurrentEdit: () => void;
  onCancelEdit: () => void;
  onStartEdit: (rowIdx: number, colIdx: number, currentValue: string) => void;
  onSelectRow: (rowIdx: number, metaKey: boolean, shiftKey: boolean) => void;
  onSort: (columnName: string, shiftKey: boolean) => void;
  onColumnWidthsChange: (
    updater: (prev: Record<string, number>) => Record<string, number>,
  ) => void;
  onReorderColumns: (newOrder: number[]) => void;
  onDeleteRow: () => void;
  onDuplicateRow: () => void;
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
  onSaveCurrentEdit,
  onCancelEdit,
  onStartEdit,
  onSelectRow,
  onSort,
  onColumnWidthsChange,
  onReorderColumns,
  onDeleteRow,
  onDuplicateRow,
}: DataGridTableProps) {
  const tableRef = useRef<HTMLTableElement>(null);
  const resizingRef = useRef<{
    colName: string;
    startX: number;
    startWidth: number;
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

  // Column drag reorder state
  const [dragColIdx, setDragColIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  // Refs to track latest drag state without closure issues
  const dragColIdxRef = useRef<number | null>(null);
  const dropTargetIdxRef = useRef<number | null>(null);
  const orderRef = useRef<number[]>([]);

  // The visual order: columnOrder[visualIdx] = dataIdx
  // If columnOrder is empty/default, fall back to identity mapping
  const visualCount = data.columns.length;
  const order =
    columnOrder.length === visualCount
      ? columnOrder
      : data.columns.map((_, i) => i);
  orderRef.current = order;

  const getColumnWidth = useCallback(
    (colName: string, dataType: string = "") => {
      if (columnWidths[colName]) return columnWidths[colName];
      return calcDefaultColWidth(colName, dataType);
    },
    [columnWidths],
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
          label: "Edit Cell",
          icon: <Pencil size={14} />,
          onClick: () => {
            const cell = data.rows[contextMenu.rowIdx]?.[contextMenu.colIdx];
            const cellStr =
              cell == null
                ? ""
                : typeof cell === "object"
                  ? JSON.stringify(cell)
                  : String(cell);
            onStartEdit(contextMenu.rowIdx, contextMenu.colIdx, cellStr);
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
      const currentWidth = columnWidths[colName] ?? 150;
      resizingRef.current = {
        colName,
        startX: e.clientX,
        startWidth: currentWidth,
        colIdx,
      };

      const applyWidth = (width: number) => {
        if (!tableRef.current) return;
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
          const finalWidth = tableRef.current?.querySelector(
            `th:nth-child(${resizingRef.current.colIdx + 1})`,
          ) as HTMLElement | null;
          const w = finalWidth
            ? parseInt(finalWidth.style.width, 10)
            : resizingRef.current.startWidth;
          onColumnWidthsChange((prev) => ({
            ...prev,
            [resizingRef.current!.colName]: w,
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

  // --- Column drag reorder handlers ---

  const handleDragStart = useCallback(
    (e: React.DragEvent, visualIdx: number) => {
      // Don't start drag if near the resize handle (right edge)
      const th = e.currentTarget as HTMLElement;
      const rect = th.getBoundingClientRect();
      if (rect.width > 0) {
        const offsetX = e.clientX - rect.left;
        if (offsetX > rect.width - RESIZE_HANDLE_WIDTH) {
          e.preventDefault();
          return;
        }
      }
      dragColIdxRef.current = visualIdx;
      dropTargetIdxRef.current = null;
      setDragColIdx(visualIdx);
      setDropTargetIdx(null);
      e.dataTransfer.effectAllowed = "move";
      // Need to set some data for Firefox compatibility
      e.dataTransfer.setData("text/plain", String(visualIdx));
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, visualIdx: number) => {
      e.preventDefault();
      if (dragColIdxRef.current === null) return;
      // Determine drop position: left half of cell = before, right half = after
      const th = e.currentTarget as HTMLElement;
      const rect = th.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      let targetIdx = visualIdx;
      if (e.clientX > midX) {
        targetIdx = visualIdx + 1;
      }
      // Don't allow dropping on self or adjacent same position
      if (
        targetIdx === dragColIdxRef.current ||
        targetIdx === dragColIdxRef.current + 1
      ) {
        dropTargetIdxRef.current = null;
        setDropTargetIdx(null);
        return;
      }
      dropTargetIdxRef.current = targetIdx;
      setDropTargetIdx(targetIdx);
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    const from = dragColIdxRef.current;
    const to = dropTargetIdxRef.current;
    if (from !== null && to !== null) {
      const currentOrder = orderRef.current;
      const newOrder = [...currentOrder];
      const [removed] = newOrder.splice(from, 1);
      const insertIdx = to > from ? to - 1 : to;
      newOrder.splice(insertIdx, 0, removed!);
      onReorderColumns(newOrder);
    }
    dragColIdxRef.current = null;
    dropTargetIdxRef.current = null;
    setDragColIdx(null);
    setDropTargetIdx(null);
  }, [onReorderColumns]);

  const handleDragLeave = useCallback(() => {
    // Only clear if actually leaving the th, not entering a child element
    setDropTargetIdx(null);
  }, []);

  const rowKeyFn = (rowIdx: number) => `row-${page}-${rowIdx}`;

  return (
    <div className="relative flex-1 overflow-auto">
      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60">
          <Loader2 className="animate-spin text-muted-foreground" size={24} />
        </div>
      )}
      <table className="w-full border-collapse text-sm" ref={tableRef}>
        <thead className="sticky top-0 z-10 bg-secondary">
          <tr>
            {order.map((dIdx, visualIdx) => {
              const col = data.columns[dIdx]!;
              const sortInfo = sorts.find((s) => s.column === col.name);
              const sortRank = sortInfo ? sorts.indexOf(sortInfo) + 1 : 0;
              const isDragged = dragColIdx === visualIdx;
              const showDropBefore =
                dropTargetIdx === visualIdx && dropTargetIdx !== dragColIdx;
              const showDropAfter =
                dropTargetIdx === visualIdx + 1 &&
                dragColIdx !== null &&
                dropTargetIdx !== dragColIdx + 1;
              return (
                <th
                  key={col.name}
                  className={`relative cursor-pointer border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground hover:bg-muted${isDragged ? " opacity-50" : ""}`}
                  style={{
                    width: getColumnWidth(col.name, col.data_type),
                    minWidth: MIN_COL_WIDTH,
                  }}
                  draggable
                  onDragStart={(e) => handleDragStart(e, visualIdx)}
                  onDragOver={(e) => handleDragOver(e, visualIdx)}
                  onDragEnd={handleDragEnd}
                  onDragLeave={handleDragLeave}
                  onClick={(e) => onSort(col.name, e.shiftKey)}
                  title={`Sort by ${col.name}`}
                >
                  {/* Drop indicator: vertical line before this column */}
                  {showDropBefore && (
                    <div className="absolute left-0 top-0 h-full w-0.5 bg-primary z-20" />
                  )}
                  {/* Drop indicator: vertical line after this column */}
                  {showDropAfter && (
                    <div className="absolute right-0 top-0 h-full w-0.5 bg-primary z-20" />
                  )}
                  <div className="flex items-center gap-1">
                    {col.is_primary_key && (
                      <span title="Primary Key">
                        <Key
                          size={12}
                          className="shrink-0 text-amber-500"
                          aria-label="Primary Key"
                        />
                      </span>
                    )}
                    <span className="truncate">{col.name}</span>
                    {sortInfo && (
                      <span className="flex shrink-0 items-center gap-0.5 text-primary">
                        <span className="text-[10px] font-bold">
                          {sortRank}
                        </span>
                        {sortInfo.direction === "ASC" ? "\u25B2" : "\u25BC"}
                      </span>
                    )}
                  </div>
                  <div
                    className="mt-0.5 truncate text-[10px] text-muted-foreground"
                    title={col.data_type}
                  >
                    {col.data_type}
                  </div>
                  {/* Resize handle */}
                  <div
                    className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary active:bg-primary"
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
                  // Use first data column index for context menu
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
                  const cellStr =
                    cell == null
                      ? ""
                      : typeof cell === "object" && cell !== null
                        ? JSON.stringify(cell, null, 2)
                        : String(cell);
                  const displayValue = hasPendingEdit
                    ? pendingEdits.get(key)!
                    : cellStr;
                  const isBlob = isBlobColumn(col.data_type);

                  return (
                    <td
                      key={`${dIdx}-${visualIdx}`}
                      className={`overflow-hidden border-r border-border px-3 py-1 text-xs text-foreground${hasPendingEdit ? " bg-yellow-500/20" : ""}`}
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
                      onDoubleClick={() => onStartEdit(rowIdx, dIdx, cellStr)}
                      onClick={() => {
                        if (editingCell) {
                          onSaveCurrentEdit();
                        }
                      }}
                    >
                      {isEditing ? (
                        <input
                          type={getInputTypeForColumn(col.data_type)}
                          className="w-full border-none bg-transparent p-0 text-xs text-foreground outline-none"
                          value={editValue}
                          autoFocus
                          onChange={(e) => onSetEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              onSaveCurrentEdit();
                            } else if (e.key === "Escape") {
                              e.stopPropagation();
                              onCancelEdit();
                            }
                          }}
                        />
                      ) : hasPendingEdit ? (
                        <span className="line-clamp-3">{displayValue}</span>
                      ) : isBlob && cell != null ? (
                        <button
                          type="button"
                          className="flex items-center gap-1 cursor-pointer text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            setBlobViewer({ data: cell, columnName: col.name });
                          }}
                          aria-label={`View BLOB data for ${col.name}`}
                        >
                          <Binary className="w-3 h-3" />
                          <span>(BLOB)</span>
                        </button>
                      ) : cell == null ? (
                        <span className="italic text-muted-foreground">
                          NULL
                        </span>
                      ) : (
                        <span className="line-clamp-3">
                          {truncateCell(
                            typeof cell === "object" && cell !== null
                              ? JSON.stringify(cell, null, 2)
                              : String(cell),
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
              className="border-b border-border bg-yellow-500/5 hover:bg-muted"
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
    </div>
  );
}
