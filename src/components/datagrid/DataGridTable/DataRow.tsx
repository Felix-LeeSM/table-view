import type { CSSProperties } from "react";
import { Binary, ArrowUpRight } from "lucide-react";
import { Button } from "@components/ui/button";
import { safeStringifyCell } from "@lib/jsonCell";
import { getTextAlign, type ColumnCategory } from "@/lib/columnCategory";
import type { TableData } from "@/types/schema";
import {
  editKey,
  cellToEditValue,
  deriveEditorSeed,
  getInputTypeForColumn,
} from "../useDataGridEdit";
import {
  isBlobColumn,
  parseFkReference,
  ROW_HEIGHT_ESTIMATE,
} from "./columnUtils";
import type { CellNavigationDirection } from "./useCellNavigation";

/**
 * Sprint 258 — `<tr>` / `<td>` 폐기. row 는 `<div role="row">` 자체 grid
 * (`grid-template-columns: var(--cols)`), cell 은 `<div role="gridcell">`.
 * column width 는 outer container 의 `--cols` CSS variable cascade 만으로
 * 결정 — cell 별 explicit width style 없음.
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
  /**
   * Sprint 258 — virtualizer 가 absolute positioning 을 적용할 때 주입한다.
   * 비-virtualized branch 에서는 omit.
   */
  rowStyle?: CSSProperties;
}

export default function DataRow({ rowIdx, ctx, rowStyle }: DataRowProps) {
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

  const mergedStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "var(--cols)",
    // Sprint 261 — sum-of-cols > parent width 시 row 박스가 grid tracks 합만큼
    // 늘어나야 border-b / hover:bg-muted 가 끝까지 그려진다.
    minWidth: "max-content",
    // 2026-05-11 — pin row height to the virtualizer estimate so the
    // eager path (last page when totalBodyRowCount drops below
    // VIRTUALIZE_THRESHOLD) doesn't render shorter than the virtualized
    // path on prior pages. Pre-fix only the virtualized branch fed
    // `height: virtualRow.size` through `rowStyle`; eager rows used the
    // natural text-xs + py-1 height (~25px) and looked visibly cramped
    // ("py가 사라지는 것 같음"). The virtualized override still wins
    // because `rowStyle` is spread last.
    minHeight: ROW_HEIGHT_ESTIMATE,
    ...rowStyle,
  };

  return (
    <div
      role="row"
      aria-rowindex={rowIdx + 2}
      className={`border-b border-border hover:bg-muted${isSelected ? " bg-accent/20" : ""}${isDeleted ? " line-through opacity-50" : ""}`}
      style={mergedStyle}
      onClick={(e) => onSelectRow(rowIdx, e.metaKey || e.ctrlKey, e.shiftKey)}
      onContextMenu={(e) => {
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
        const category: ColumnCategory = col.category ?? "unknown";
        const align = getTextAlign(category);
        const alignClass =
          align === "right"
            ? " justify-end text-right"
            : align === "center"
              ? " justify-center text-center"
              : "";

        const fkRef =
          col.is_foreign_key && col.fk_reference && cell != null
            ? parseFkReference(col.fk_reference)
            : null;

        return (
          <div
            key={`${dIdx}-${visualIdx}`}
            role="gridcell"
            aria-colindex={visualIdx + 1}
            data-editing={isEditing ? "true" : undefined}
            className={`group/cell flex min-w-0 items-center overflow-hidden border-r border-border px-3 py-1 text-xs text-foreground${alignClass}${
              isEditing
                ? " bg-primary/10 ring-2 ring-inset ring-primary"
                : hasPendingEdit
                  ? " bg-highlight/20"
                  : ""
            }`}
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
              e.stopPropagation();
              handleContextMenu(e, rowIdx, dIdx);
            }}
          >
            {isEditing ? (
              (() => {
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
                        onBlur={onSaveCurrentEdit}
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
                            e.preventDefault();
                          } else if (
                            e.key.length === 1 &&
                            !e.metaKey &&
                            !e.ctrlKey &&
                            !e.altKey
                          ) {
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
                        onBlur={onSaveCurrentEdit}
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
                <span
                  dir="auto"
                  className="block overflow-hidden text-ellipsis whitespace-nowrap [unicode-bidi:isolate]"
                >
                  {pendingValue}
                </span>
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
              <span className="flex items-center gap-1 min-w-0">
                <span
                  dir="auto"
                  className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap [unicode-bidi:isolate]"
                >
                  {typeof cell === "object" && cell !== null
                    ? safeStringifyCell(cell)
                    : String(cell)}
                </span>
                {fkRef && onNavigateToFk && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
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
          </div>
        );
      })}
    </div>
  );
}
