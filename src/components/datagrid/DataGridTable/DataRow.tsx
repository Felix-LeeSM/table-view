import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import Decimal from "decimal.js";
import { Binary, ArrowUpRight } from "lucide-react";
import { Button } from "@components/ui/button";
import { safeStringifyCell } from "@lib/jsonCell";
import { isArrayColumn, isJsonbColumn } from "@lib/sql/structuralSqlEdit";
import { getTextAlign, type ColumnCategory } from "@/lib/columnCategory";
import type { TableData } from "@/types/schema";
import {
  editKey,
  cellToEditValue,
  deriveEditorSeed,
  getInputTypeForColumn,
} from "../dataGridEditFsm";
import { cn } from "@lib/utils";
import { isBlobColumn, parseFkReference } from "./columnUtils";
import type { CellNavigationDirection } from "./useCellNavigation";

/**
 * Sprint 261 (ADR 0026) — render a cell that may carry BigInt / Decimal
 * precision wrappers. Decimal is `typeof === "object"` so it must be
 * detected before the generic object branch (which would call
 * `safeStringifyCell` and emit a quoted JSON string). BigInt is
 * `typeof === "bigint"` and routes through `String(cell)` losslessly.
 */
function renderCell(cell: unknown): string {
  if (cell instanceof Decimal) return cell.toString();
  if (typeof cell === "object" && cell !== null) return safeStringifyCell(cell);
  return String(cell);
}

/**
 * Sprint 261 (ADR 0026) — title (tooltip) rendering matches `renderCell`
 * but uses pretty-printed JSON for generic objects so the multi-line
 * inspector view stays intact for nested documents.
 */
function renderCellTitle(cell: unknown): string {
  if (cell == null) return "NULL";
  if (cell instanceof Decimal) return cell.toString();
  // Sprint 305 — nested BigInt 가 든 object (예: JSONB / Mongo Int64) 가
  // tooltip 으로 흘러오면 raw `JSON.stringify` 가 throw → DataGrid mount
  // 시점 freeze. `safeStringifyCell` 은 BigInt/Decimal replacer 가 있어
  // 안전하고, pretty-print 도 같은 stringify 호출 안에서 처리한다.
  if (typeof cell === "object" && cell !== null)
    return safeStringifyCell(cell, 2);
  if (typeof cell === "bigint") return cell.toString();
  return String(cell);
}

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
  canEditRows: boolean;
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
  /**
   * Sprint 343 (2026-05-15) — inline JSON tree expand coordinate.
   * Mirrors `DocumentDataGrid.expandedNested`. Only the structural
   * sentinel button uses these; scalar cells ignore them.
   */
  expandedNested?: { rowIdx: number; colIdx: number } | null;
  onToggleNested?: (rowIdx: number, colIdx: number) => void;
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
  const { t } = useTranslation("datagrid");
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
    canEditRows,
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
    onToggleNested,
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
    ...rowStyle,
  };

  return (
    <div
      role="row"
      aria-rowindex={rowIdx + 2}
      className={`min-h-8 border-b border-border hover:bg-muted${isSelected ? " bg-accent/20" : ""}${isDeleted ? " line-through opacity-50" : ""}`}
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

        // Sprint 343 (2026-05-15) — inline JSON tree entry-point for
        // jsonb / Postgres ARRAY columns. Only non-null object / array
        // cells get the sentinel (scalar jsonb values like `42` /
        // `"foo"` / null stay editable through the regular cell path
        // so the user can author an initial value).
        const isNestedCapable =
          (isJsonbColumn(col.data_type) || isArrayColumn(col.data_type)) &&
          cell != null &&
          typeof cell === "object";
        const isExpandedHere =
          isNestedCapable &&
          expandedNested?.rowIdx === rowIdx &&
          expandedNested?.colIdx === dIdx;
        // Count nested pending edits on this cell so we can flag it
        // with the same amber highlight a top-level pending uses.
        let nestedPendingCount = 0;
        if (isNestedCapable) {
          const nestedPrefix = `${rowIdx}-${dIdx}:`;
          for (const k of pendingEdits.keys()) {
            if (k.startsWith(nestedPrefix)) nestedPendingCount++;
          }
        }

        return (
          <div
            key={`${dIdx}-${visualIdx}`}
            role="gridcell"
            aria-colindex={visualIdx + 1}
            data-editing={isEditing ? "true" : undefined}
            className={`group/cell flex min-w-0 items-center overflow-hidden border-r border-border px-3 py-1 text-xs text-foreground${alignClass}${
              isEditing
                ? " bg-primary/10 ring-2 ring-inset ring-primary"
                : hasPendingEdit || nestedPendingCount > 0
                  ? " bg-highlight/20"
                  : ""
            }`}
            title={isNestedCapable ? undefined : renderCellTitle(cell)}
            onDoubleClick={() => {
              if (!canEditRows) return;
              if (isNestedCapable) return; // expand via the toggle button
              onStartEdit(rowIdx, dIdx, editStartValue);
            }}
            onClick={() => {
              if (canEditRows && editingCell) {
                onSaveCurrentEdit();
              }
            }}
            onContextMenu={(e) => {
              e.stopPropagation();
              handleContextMenu(e, rowIdx, dIdx);
            }}
          >
            {isNestedCapable ? (
              (() => {
                const isArr = Array.isArray(cell);
                const childCount = isArr
                  ? (cell as unknown[]).length
                  : Object.keys(cell as Record<string, unknown>).length;
                const open = isArr ? "[" : "{";
                const close = isArr ? "]" : "}";
                const middleLabel = isExpandedHere
                  ? "✕"
                  : isArr
                    ? t("nestedItems", { count: childCount })
                    : "...";
                return (
                  <span className="flex min-w-0 items-center gap-1 font-mono text-muted-foreground">
                    <span>{open}</span>
                    <button
                      type="button"
                      data-testid={`rdb-nested-toggle-${rowIdx}-${dIdx}`}
                      aria-expanded={isExpandedHere}
                      aria-label={
                        isExpandedHere
                          ? t("closeAria", { col: col.name })
                          : t("expandAria", { col: col.name })
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleNested?.(rowIdx, dIdx);
                      }}
                      className={cn(
                        "inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                        isExpandedHere &&
                          "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
                      )}
                    >
                      {middleLabel}
                    </button>
                    <span>{close}</span>
                    {nestedPendingCount > 0 && (
                      <span className="ml-1 text-3xs text-amber-400">
                        ● {nestedPendingCount}
                      </span>
                    )}
                  </span>
                );
              })()
            ) : isEditing ? (
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
                        aria-label={t("editingNullAria", { col: col.name })}
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
                          {t("typeToEdit")}
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
                        aria-label={t("editingAria", { col: col.name })}
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
                aria-label={t("viewBlobAria", { col: col.name })}
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
                  {renderCell(cell)}
                </span>
                {fkRef && onNavigateToFk && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 opacity-40 transition-opacity group-hover/cell:opacity-100 text-muted-foreground hover:text-foreground"
                    aria-label={t("openFkAria", {
                      schemaTable: `${fkRef.schema}.${fkRef.table}`,
                    })}
                    title={t("goToFkTitle", {
                      schemaTable: `${fkRef.schema}.${fkRef.table}`,
                      column: fkRef.column,
                    })}
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
