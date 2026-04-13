import { useCallback, useRef } from "react";
import { Loader2, Key } from "lucide-react";
import { truncateCell } from "../../lib/format";
import type { SortInfo, TableData } from "../../types/schema";
import { editKey, getInputTypeForColumn } from "./useDataGridEdit";

const MIN_COL_WIDTH = 60;

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
  editingCell: { row: number; col: number } | null;
  editValue: string;
  pendingEdits: Map<string, string>;
  selectedRowIdx: number | null;
  pendingDeletedRowKeys: Set<string>;
  pendingNewRows: unknown[][];
  page: number;
  onSetEditValue: (v: string) => void;
  onSaveCurrentEdit: () => void;
  onCancelEdit: () => void;
  onStartEdit: (rowIdx: number, colIdx: number, currentValue: string) => void;
  onSelectRow: (rowIdx: number) => void;
  onSort: (columnName: string, shiftKey: boolean) => void;
  onColumnWidthsChange: (
    updater: (prev: Record<string, number>) => Record<string, number>,
  ) => void;
}

export default function DataGridTable({
  data,
  loading,
  sorts,
  columnWidths,
  editingCell,
  editValue,
  pendingEdits,
  selectedRowIdx,
  pendingDeletedRowKeys,
  pendingNewRows,
  page,
  onSetEditValue,
  onSaveCurrentEdit,
  onCancelEdit,
  onStartEdit,
  onSelectRow,
  onSort,
  onColumnWidthsChange,
}: DataGridTableProps) {
  const tableRef = useRef<HTMLTableElement>(null);
  const resizingRef = useRef<{
    colName: string;
    startX: number;
    startWidth: number;
    colIdx: number;
  } | null>(null);

  const getColumnWidth = useCallback(
    (colName: string, dataType: string = "") => {
      if (columnWidths[colName]) return columnWidths[colName];
      return calcDefaultColWidth(colName, dataType);
    },
    [columnWidths],
  );

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
            {data.columns.map((col, colIdx) => {
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
                  onClick={(e) => onSort(col.name, e.shiftKey)}
                  title={`Sort by ${col.name}`}
                >
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
                    onMouseDown={(e) => handleResizeStart(e, col.name, colIdx)}
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
            const isSelected = selectedRowIdx === rowIdx;
            return (
              <tr
                key={rk}
                className={`border-b border-border hover:bg-muted${isSelected ? " bg-accent/20" : ""}${isDeleted ? " line-through opacity-50" : ""}`}
                onClick={() => onSelectRow(rowIdx)}
              >
                {(row as unknown[]).map((cell, cellIdx) => {
                  const key = editKey(rowIdx, cellIdx);
                  const isEditing =
                    editingCell?.row === rowIdx && editingCell?.col === cellIdx;
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

                  return (
                    <td
                      key={cellIdx}
                      className={`overflow-hidden border-r border-border px-3 py-1 text-xs text-foreground${hasPendingEdit ? " bg-yellow-500/20" : ""}`}
                      style={{
                        width: getColumnWidth(
                          data.columns[cellIdx]?.name ?? "",
                          data.columns[cellIdx]?.data_type ?? "",
                        ),
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
                        onStartEdit(rowIdx, cellIdx, cellStr)
                      }
                      onClick={() => {
                        if (editingCell) {
                          onSaveCurrentEdit();
                        }
                      }}
                    >
                      {isEditing ? (
                        <input
                          type={getInputTypeForColumn(
                            data.columns[cellIdx]?.data_type ?? "",
                          )}
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
              {(newRow as unknown[]).map((cell, cellIdx) => (
                <td
                  key={cellIdx}
                  className="overflow-hidden border-r border-border px-3 py-1 text-xs italic text-muted-foreground"
                  style={{
                    width: getColumnWidth(
                      data.columns[cellIdx]?.name ?? "",
                      data.columns[cellIdx]?.data_type ?? "",
                    ),
                    minWidth: MIN_COL_WIDTH,
                  }}
                >
                  {cell == null ? "NULL" : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
