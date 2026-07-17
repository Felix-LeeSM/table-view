import { memo, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import Decimal from "decimal.js";
import { Binary, ArrowUpRight } from "lucide-react";
import { Button } from "@components/ui/button";
import { safeStringifyCell, renderCellValue } from "@lib/jsonCell";
import { isArrayColumn, isJsonbColumn } from "@lib/sql/structuralSqlEdit";
import { getTextAlign, type ColumnCategory } from "@/lib/columnCategory";
import type { TableData } from "@/types/schema";
import {
  editKey,
  cellToEditValue,
  deriveEditorSeed,
  getInputTypeForColumn,
  isPendingEditActive,
  pendingEditAnchorMatches,
  rowIdentityKey,
} from "../dataGridEditFsm";
import { cn } from "@lib/utils";
import { isBlobColumn, parseFkReference } from "./columnUtils";
import type { CellNavigationDirection } from "./useCellNavigation";

/**
 * Sprint 261 (ADR 0026) — title (tooltip) rendering matches `renderCellValue`
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

/**
 * Issue #1446 — the slice of pending-edit state belonging to a single row,
 * keyed by the full cell key (`${rowIdx}-${colIdx}` and nested
 * `${rowIdx}-${colIdx}:path`). Passing a per-row slice (with a stable
 * reference when unchanged, see `DataGridTable` reconciliation) lets the
 * memoized `DataRow` skip re-render when a *different* row's edit changes.
 */
export interface RowPending {
  edits: ReadonlyMap<string, string | null>;
  errors?: ReadonlyMap<string, string>;
  snapshots?: ReadonlyMap<string, ReadonlyArray<unknown>>;
}

/**
 * Issue #1446 — `ctx` now holds only references that stay stable across
 * edits / selection / focus moves (callbacks + static grid data). All
 * per-row reactive state moved to explicit `DataRowProps` fields so the
 * `memo`'d row only re-renders when *its* row's slice changes.
 */
export interface DataGridRowContext {
  data: TableData;
  order: number[];
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
   * Sprint 343 (2026-05-15) — inline JSON tree expand handler.
   * Mirrors `DocumentDataGrid`. Only the structural sentinel button uses
   * it; scalar cells ignore it. The expanded *coordinate* is per-row
   * (`DataRowProps.expandedCol`) so a toggle re-renders only its row.
   */
  onToggleNested?: (rowIdx: number, colIdx: number) => void;
  /**
   * Design-swarm #4 Phase 2 — `onFocusCell` is the cell `onFocus` handler:
   * it updates the roving anchor STATE only (`.focus()` 호출 안 함 —
   * focus-steal 방지). The tab-stop column itself is per-row
   * (`DataRowProps.tabCol`).
   */
  onFocusCell: (row: number, col: number) => void;
}

export interface DataRowProps {
  rowIdx: number;
  ctx: DataGridRowContext;
  /**
   * Sprint 258 — virtualizer가 absolute positioning을 적용할 때 주입한다.
   * 비-virtualized branch에서는 omit. Issue #1446 — kept as primitives (not
   * an object) so the memoized row's shallow prop compare stays stable
   * across renders where its absolute position didn't change.
   */
  rowTop?: number;
  rowHeight?: number;
  /**
   * Issue #1446 — per-row reactive state. Each field is a primitive (or a
   * reference-stable slice) so the `memo`'d row only re-renders when *its*
   * row changes, instead of every visible row reacting to one edit.
   */
  /** Data-column index being edited in this row, else null. */
  editCol: number | null;
  /** Live editor value when this row is the editing row, else null. */
  editValue: string | null;
  isSelected: boolean;
  isDeleted: boolean;
  /** Roving tab-stop visual column when this row holds the anchor, else null. */
  tabCol: number | null;
  /** Data-column index with the inline JSON tree open in this row, else null. */
  expandedCol: number | null;
  /** This row's slice of pending-edit state (reference-stable when unchanged). */
  rowPending?: RowPending;
  /**
   * Issue #1446 — visual column indices to render (column virtualization).
   * `null` renders every column eagerly (narrow grids); an array renders
   * only that windowed slice, each cell pinned to its `--cols` grid track.
   */
  visibleColIdxs: number[] | null;
}

function DataRow({
  rowIdx,
  ctx,
  rowTop,
  rowHeight,
  editCol,
  editValue,
  isSelected,
  isDeleted,
  tabCol,
  expandedCol,
  rowPending,
  visibleColIdxs,
}: DataRowProps) {
  const { t } = useTranslation("datagrid");
  const {
    data,
    order,
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
    onToggleNested,
    onFocusCell,
  } = ctx;
  const pendingEdits = rowPending?.edits;
  const pendingEditRowSnapshots = rowPending?.snapshots;
  const pendingEditErrors = rowPending?.errors;

  const row = data.rows[rowIdx] as unknown[] | undefined;
  if (!row) return null;
  // Issue #1174 — identity of the row now at this visual index. A pending
  // edit's overlay only paints when its edit-time anchor matches this.
  const currentRowIdentity = rowIdentityKey(row, data.columns);

  const mergedStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "var(--cols)",
    // Sprint 261 — sum-of-cols > parent width 시 row 박스가 grid tracks 합만큼
    // 늘어나야 border-b / hover:bg-muted 가 끝까지 그려진다.
    minWidth: "max-content",
    // Issue #1446 — virtualized rows position absolutely (primitives, not a
    // per-render object, so the memo compare stays stable).
    ...(rowTop !== undefined
      ? {
          position: "absolute",
          top: rowTop,
          left: 0,
          right: 0,
          height: rowHeight,
        }
      : null),
  };

  // Issue #1446 — column virtualization. `visibleColIdxs` (when set) lists
  // the visual columns to render; each cell is pinned to its `--cols` grid
  // track via `gridColumn` so unrendered tracks still reserve their width
  // and every cell stays aligned with the header. `null` → render all.
  const renderCell = (visualIdx: number, sparse: boolean) => {
    const dIdx = order[visualIdx]!;
    const cell = row[dIdx];
    const col = data.columns[dIdx]!;
    const key = editKey(rowIdx, dIdx);
    const isEditing = editCol === dIdx;
    // Issue #1174 — index-keyed hit must also pass the row-identity
    // anchor so a pending edit doesn't paint on a different row that
    // paginated / sorted / filtered into this index. #1616 (B3) — the
    // existence + anchor pairing is centralised in `isPendingEditActive`.
    const hasPendingEdit = isPendingEditActive(
      key,
      currentRowIdentity,
      data.columns,
      pendingEdits,
      pendingEditRowSnapshots,
    );
    const cellEditValue = cellToEditValue(cell);
    const pendingValue: string | null = hasPendingEdit
      ? (pendingEdits!.get(key) as string | null)
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
    const isExpandedHere = isNestedCapable && expandedCol === dIdx;
    // Count nested pending edits on this cell so we can flag it
    // with the same amber highlight a top-level pending uses.
    let nestedPendingCount = 0;
    // Issue #1174 — nested edits anchor under the base cell key, so the
    // same row-identity gate applies before counting them.
    if (
      isNestedCapable &&
      pendingEdits &&
      pendingEditAnchorMatches(
        key,
        currentRowIdentity,
        data.columns,
        pendingEditRowSnapshots,
      )
    ) {
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
        data-grid-row={rowIdx}
        data-grid-col={visualIdx}
        style={sparse ? { gridColumn: visualIdx + 1 } : undefined}
        tabIndex={visualIdx === tabCol ? 0 : -1}
        onFocus={() => onFocusCell(rowIdx, visualIdx)}
        onKeyDown={(e) => {
          // issue #1130 (N1) — cell 내부 native 컨트롤(nested toggle / FK /
          // BLOB 버튼) focus 시 Space/Enter 를 셀 키맵이 가로채지 않도록
          // 자기 셀 focus 일 때만 동작. HeaderRow 와 동일 가드. 편집 중엔
          // editor input 이 target 이라 이 가드에서 먼저 bail.
          if (e.target !== e.currentTarget) return;
          // Design-swarm #4 Phase 3 — Enter/F2 로 focus 된 cell 편집 진입
          // (double-click 과 동일 가드/경로). 편집 중엔 editor input 이
          // focus 를 쥐고 Enter/Escape 를 stopPropagation 하므로 여기 안 옴.
          if (isEditing) return;
          // issue #1130 AC2 — Space 로 행 선택 (onClick 과 동일 modifier
          // 시맨틱). 편집 가능 여부와 무관 — 읽기 전용 그리드도 선택은 허용.
          // preventDefault 로 page scroll 억제.
          if (e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onSelectRow(rowIdx, e.metaKey || e.ctrlKey, e.shiftKey);
            return;
          }
          if (e.key !== "Enter" && e.key !== "F2") return;
          if (!canEditRows || isNestedCapable) return;
          e.preventDefault();
          e.stopPropagation();
          onStartEdit(rowIdx, dIdx, editStartValue);
        }}
        // UX (2026-07-17, no tracking issue) — the roving-focused data cell had
        // NO focus marker (only the editing cell showed `ring-primary`), so the
        // right-click quick-look targeted an invisible cell. Give the data cell
        // the SAME `focus-visible:outline-*` its header (`HeaderRow`) and
        // pending-row (`DataGridTable`) siblings already carry — coexists with
        // the editing ring since it's a different property (outline vs ring).
        className={`group/cell flex min-w-0 items-center overflow-hidden border-r border-border px-3 py-1 text-xs text-foreground focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring${alignClass}${
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
          // Click-elsewhere commits an in-flight edit. `onSaveCurrentEdit`
          // no-ops when nothing is editing, so a per-row `editingCell` flag
          // isn't needed (issue #1446 memo split).
          if (canEditRows) {
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
                  <span className="ml-1 text-3xs text-warning">
                    ● {nestedPendingCount}
                  </span>
                )}
              </span>
            );
          })()
        ) : isEditing ? (
          (() => {
            const errorMessage = pendingEditErrors?.get(key);
            const cellErrorId = `datagrid-cell-error-${key}`;
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
                    aria-invalid={errorMessage ? true : undefined}
                    aria-describedby={errorMessage ? cellErrorId : undefined}
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
                    aria-invalid={errorMessage ? true : undefined}
                    aria-describedby={errorMessage ? cellErrorId : undefined}
                    onChange={(e) => onSetEditValue(e.target.value)}
                    onBlur={onSaveCurrentEdit}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Backspace") {
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
                    id={cellErrorId}
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
          // #1139 — a pending edit was signalled only by `bg-highlight/20`
          // (color). Announce it to AT via sr-only text and give a
          // color-independent shape marker (● glyph) for color-blind users.
          <>
            <span className="sr-only">{t("cellModifiedAria")}</span>
            <span
              aria-hidden="true"
              title={t("cellModifiedAria")}
              className="mr-1 shrink-0 text-3xs text-warning"
            >
              ●
            </span>
            {pendingValue === null ? (
              <span className="italic text-muted-foreground" aria-label="NULL">
                NULL
              </span>
            ) : (
              <span
                dir="auto"
                className="block overflow-hidden text-ellipsis whitespace-nowrap [unicode-bidi:isolate]"
              >
                {pendingValue}
              </span>
            )}
          </>
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
        ) : cell === "" ? (
          // Issue #1061 — distinguish "" from NULL. ADR 0009 keeps NULL as
          // italic muted "NULL"; empty string uses the SAME wording as
          // CellDetailDialog (`emptyString` = "(empty string)") but is
          // non-italic and slightly dimmer so the two tri-state values
          // never blur together.
          <span className="text-muted-foreground/70">{t("emptyString")}</span>
        ) : cell == null ? (
          <span className="italic text-muted-foreground">NULL</span>
        ) : (
          <span className="flex items-center gap-1 min-w-0">
            <span
              dir="auto"
              className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap [unicode-bidi:isolate]"
            >
              {renderCellValue(cell)}
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
  };

  return (
    <div
      role="row"
      aria-rowindex={rowIdx + 2}
      aria-selected={isSelected}
      // UX (2026-07-17, no tracking issue) — highlight the roving-focus row so
      // the right-click quick-look target is obvious. `tabCol !== null` means
      // this row holds the roving anchor. Uses an inset box-shadow left bar
      // (ring token) rather than a left border: a border would push body cells
      // 2px out of alignment with the header, whereas the shadow is a separate
      // paint channel from the selection `bg-accent/20`, so a selected+focused
      // row reads both. Distinct tokens per state: ring=focus, accent=select,
      // primary=edit.
      className={`min-h-8 border-b border-border hover:bg-muted${
        tabCol !== null ? " shadow-[inset_2px_0_0_0_var(--color-ring)]" : ""
      }${isSelected ? " bg-accent/20" : ""}${isDeleted ? " line-through opacity-50" : ""}`}
      style={mergedStyle}
      onClick={(e) => onSelectRow(rowIdx, e.metaKey || e.ctrlKey, e.shiftKey)}
      onContextMenu={(e) => {
        handleContextMenu(e, rowIdx, 0);
      }}
    >
      {visibleColIdxs
        ? visibleColIdxs.map((visualIdx) => renderCell(visualIdx, true))
        : order.map((_, visualIdx) => renderCell(visualIdx, false))}
    </div>
  );
}

// Issue #1446 — memoized so a change to one row's props (its edit / select /
// focus slice) doesn't re-render every visible row. All reactive inputs are
// primitives or reference-stable slices, so React's default shallow compare
// is exact — no custom comparator to drift as props evolve.
export default memo(DataRow);
