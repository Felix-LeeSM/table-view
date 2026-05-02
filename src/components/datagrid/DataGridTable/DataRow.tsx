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
 * `DataGridTable` 의 body row 컴포넌트.
 *
 * 책임: 한 data-row 의 `<tr>` + 각 cell `<td>` 렌더링. 5 mode 분기를
 * 한 곳에서 관리:
 *   1. editing-null   — Cmd+Backspace 로 NULL chip 으로 flip 된 활성
 *      editor. printable key 가 들어오면 type-aware seed 로 typed
 *      editor 로 다시 flip.
 *   2. editing-typed  — 일반 `<input>` editor. Tab/Enter 로 다음 셀,
 *      Shift+Tab/Enter 로 이전 셀, Esc 로 cancel, Cmd+Backspace 로 NULL
 *      flip.
 *   3. hasPendingEdit — 아직 편집은 안 활성이지만 commit 대기 중인 셀.
 *      pending 이 NULL 이면 italic NULL, 아니면 line-clamp-3 텍스트.
 *   4. blob           — BLOB 컬럼이고 cell 이 non-null 이면 BLOB 버튼
 *      (열림 → setBlobViewer).
 *   5. plain          — 그 외. truncated 표시 + FK reference 가 있고
 *      `onNavigateToFk` 가 주입돼 있으면 점프 아이콘.
 *
 * Sprint 200 에서 entry 의 `renderDataRow` 함수에서 분리. ctx 객체로
 * prop drilling 압축 (Sprint 199 SchemaTreeRowsContext 답습) — D6=B.
 *
 * 외부 invariant:
 * - row key = `row-${page}-${rowIdx}`. page 가 바뀌면 새 key 가 되어
 *   DOM remount → editor focus / hover state 가 자동 reset 됨 (Sprint
 *   75 부터 동결).
 * - `aria-rowindex={rowIdx + 2}` (header 가 row 1) — Sprint 106 ARIA
 *   계약. virtualized branch 도 같은 invariant 유지.
 * - title attribute 는 cell 객체일 때 JSON.stringify(cell, null, 2),
 *   primitive 면 String(cell), null 이면 "NULL". Sprint 200 분해 이전과
 *   동결.
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
                // Sprint 75 — inline validation hint for the active
                // cell. When a previous commit attempt left a
                // coercion error on this cell, render a
                // `text-destructive` message beneath the editor. The
                // error is cleared entry-by-entry by the hook when
                // `onSetEditValue`/`onSetEditNull` is called, so the
                // hint disappears as soon as the user edits.
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
                            // Printable key flips NULL → typed editor.
                            // The column's data type picks both the seed
                            // value (often `""` for pickers) and the
                            // `<input type>` on the next render — routed
                            // through `deriveEditorSeed` so the flip lands
                            // on a type-appropriate editor, not a bare
                            // text input with the raw character seeded in.
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
                    // Sprint-89 (#FK-3): icon stays visible on every
                    // FK + non-null cell so users can discover the
                    // jump without first hovering. Hover lifts the
                    // opacity to full strength.
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
