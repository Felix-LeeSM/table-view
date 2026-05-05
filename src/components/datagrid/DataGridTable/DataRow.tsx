import { Binary, ArrowUpRight } from "lucide-react";
import { Button } from "@components/ui/button";
import { truncateCell } from "@lib/format";
import type { TableData } from "@/types/schema";
import {
  editKey,
  cellToEditValue,
  deriveEditorSeed,
  getInputTypeForColumn,
} from "../useDataGridEdit";
import { MIN_COL_WIDTH, isBlobColumn, parseFkReference } from "./columnUtils";
import type { CellNavigationDirection } from "./useCellNavigation";

/**
 * Body row for `DataGridTable`. Renders one `<tr>` and dispatches each
 * cell across 5 modes: editing-null, editing-typed, hasPendingEdit,
 * blob, and plain.
 *
 * Invariants:
 * - row key = `row-${page}-${rowIdx}`. Page change remounts the row so
 *   editor focus / hover state reset automatically.
 * - `aria-rowindex={rowIdx + 2}` (header is row 1) — virtualized branch
 *   keeps the same offset.
 */

export interface DataGridRowContext {
  data: TableData;
  page: number;
  order: number[];
  editingCell: { row: number; col: number } | null;
  editValue: string | null;
  pendingEdits: Map<string, string | null>;
  pendingEditErrors?: Map<string, string>;
  pendingDeletedRowKeys: Set<string>;
  selectedRowIds: Set<number>;
  editorFocusRef: React.RefObject<HTMLElement | null>;
  getColumnWidth: (colName: string, dataType?: string) => number;
  moveEditCursor: (
    currentRow: number,
    currentDataCol: number,
    direction: CellNavigationDirection,
  ) => void;
  handleContextMenu: (
    e: React.MouseEvent,
    rowIdx: number,
    colIdx: number,
  ) => void;
  setBlobViewer: (next: { data: unknown; columnName: string } | null) => void;
  onSelectRow: (rowIdx: number, metaKey: boolean, shiftKey: boolean) => void;
  onStartEdit: (
    rowIdx: number,
    colIdx: number,
    currentValue: string | null,
  ) => void;
  onSetEditValue: (v: string | null) => void;
  onSetEditNull: () => void;
  onSaveCurrentEdit: () => void;
  onCancelEdit: () => void;
  onNavigateToFk?: (
    schema: string,
    table: string,
    column: string,
    value: string,
  ) => void;
}

export interface DataRowProps {
  rowIdx: number;
  ctx: DataGridRowContext;
}

export default function DataRow({ rowIdx, ctx }: DataRowProps) {
  const {
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
  } = ctx;

  const row = data.rows[rowIdx] as unknown[] | undefined;
  if (!row) return null;
  const rk = `row-${page}-${rowIdx}`;
  const isDeleted = pendingDeletedRowKeys.has(rk);
  const isSelected = selectedRowIds.has(rowIdx);

  return (
    <tr
      key={rk}
      role="row"
      aria-rowindex={rowIdx + 2}
      className={`border-b border-border hover:bg-muted${isSelected ? " bg-accent/20" : ""}${isDeleted ? " line-through opacity-50" : ""}`}
      onClick={(e) => onSelectRow(rowIdx, e.metaKey || e.ctrlKey, e.shiftKey)}
      onContextMenu={(e) => {
        // Fallback when the right-click lands between cells.
        // Cell-level handlers below override this when the click
        // hits a real td so the context menu reflects that cell.
        handleContextMenu(e, rowIdx, 0);
      }}
    >
      {order.map((dIdx, visualIdx) => {
        const cell = row[dIdx];
        const col = data.columns[dIdx]!;
        const key = editKey(rowIdx, dIdx);
        const isEditing =
          editingCell?.row === rowIdx && editingCell?.col === dIdx;
        const hasPendingEdit = pendingEdits.has(key);
        const cellEditValue = cellToEditValue(cell);
        const pendingValue: string | null = hasPendingEdit
          ? (pendingEdits.get(key) as string | null)
          : null;
        const editStartValue = hasPendingEdit ? pendingValue : cellEditValue;
        const isBlob = isBlobColumn(col.data_type);

        const fkRef =
          col.is_foreign_key && col.fk_reference && cell != null
            ? parseFkReference(col.fk_reference)
            : null;

        return (
          <td
            key={`${dIdx}-${visualIdx}`}
            role="gridcell"
            aria-colindex={visualIdx + 1}
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
            onDoubleClick={() => onStartEdit(rowIdx, dIdx, editStartValue)}
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
              (() => {
                // Coercion error from the prior commit attempt. Cleared
                // entry-by-entry as the user types, so it auto-disappears.
                const errorMessage = pendingEditErrors?.get(key);
                return (
                  <div className="flex flex-col">
                    {editValue === null ? (
                      <div
                        ref={(el) => {
                          editorFocusRef.current = el;
                        }}
                        className="flex items-center gap-2 outline-none"
                        role="textbox"
                        aria-label={`Editing ${col.name} — currently NULL`}
                        tabIndex={0}
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
                            // Printable key flips NULL → typed editor with a
                            // type-aware seed (so e.g. a date column lands on a
                            // date picker rather than a text input with the raw
                            // character).
                            e.preventDefault();
                            const { seed, accept } = deriveEditorSeed(
                              col.data_type,
                              e.key,
                            );
                            if (!accept) return;
                            onSetEditValue(seed);
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
                        ref={(el) => {
                          editorFocusRef.current = el;
                        }}
                        type={getInputTypeForColumn(col.data_type)}
                        className="w-full bg-transparent px-1 py-0 text-xs text-foreground outline-none"
                        value={editValue}
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
                    )}
                    {errorMessage && (
                      <span
                        role="alert"
                        aria-live="polite"
                        className="mt-0.5 text-2xs text-destructive"
                      >
                        {errorMessage}
                      </span>
                    )}
                  </div>
                );
              })()
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
              <span className="italic text-muted-foreground">NULL</span>
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
                    // FK jump icon stays at 40% opacity so users can
                    // discover it without hovering; hover bumps to 100%.
                    className="shrink-0 opacity-40 transition-opacity group-hover/cell:opacity-100 text-muted-foreground hover:text-foreground"
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
}
