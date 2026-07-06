import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import Decimal from "decimal.js";
import { isDocumentSentinel, type DocumentQueryResult } from "@/types/document";
import type { ColumnInfo, TableData } from "@/types/schema";
import {
  editKey,
  pendingEditAnchorMatches,
  rowIdentityKey,
  type DataGridEditState,
} from "@components/datagrid";
import { safeStringifyCell, renderCellValue } from "@lib/jsonCell";
import { cn } from "@lib/utils";
import { DocumentTreePanel } from "@components/document/DocumentTreePanel";

export interface ExpandedNestedCell {
  rowIdx: number;
  colIdx: number;
  rowIdSnapshot: string;
}

export interface DocumentGridRowsProps {
  data: TableData;
  queryResult: DocumentQueryResult | null;
  page: number;
  visibleEntries: ReadonlyArray<readonly [ColumnInfo, number]>;
  editState: DataGridEditState;
  expandedNested: ExpandedNestedCell | null;
  setExpandedNested: (next: ExpandedNestedCell | null) => void;
  rowKeyOf: (rowIdx: number) => string;
  handleStartEditCell: (rowIdx: number, colIdx: number) => void;
  scrollContainerWidth: number;
  cellTabIndex: (row: number, col: number) => 0 | -1;
  onFocusCell: (row: number, col: number) => void;
}

const BSON_TAG = "__bson__:";
const MONGO_ROOT_RESERVED_KEYS: ReadonlySet<string> = new Set(["_id"]);

function tagBsonWrapper(wrapper: Record<string, unknown>): string {
  return `${BSON_TAG}${safeStringifyCell(wrapper)}`;
}

function buildNestedPendingByPath(
  pendingEdits: ReadonlyMap<string, string | null>,
  rowIdx: number,
  colIdx: number,
): Map<string, string | Record<string, unknown>> {
  const prefix = `${rowIdx}-${colIdx}:`;
  const out = new Map<string, string | Record<string, unknown>>();
  pendingEdits.forEach((value, key) => {
    if (!key.startsWith(prefix)) return;
    const path = key.slice(prefix.length);
    if (typeof value === "string" && value.startsWith(BSON_TAG)) {
      try {
        const parsed = JSON.parse(value.slice(BSON_TAG.length)) as unknown;
        if (typeof parsed === "object" && parsed !== null) {
          out.set(path, parsed as Record<string, unknown>);
          return;
        }
      } catch {
        // fall through to string fallback
      }
    }
    out.set(path, value ?? "");
  });
  return out;
}

function getCellTitle(cell: unknown): string {
  if (cell == null) return "null";
  if (cell instanceof Decimal) return cell.toString();
  if (typeof cell === "bigint") return cell.toString();
  if (typeof cell === "object") return safeStringifyCell(cell);
  return String(cell);
}

export default function DocumentGridRows({
  data,
  queryResult,
  page,
  visibleEntries,
  editState,
  expandedNested,
  setExpandedNested,
  rowKeyOf,
  handleStartEditCell,
  scrollContainerWidth,
  cellTabIndex,
  onFocusCell,
}: DocumentGridRowsProps) {
  const { t } = useTranslation("document");
  return (
    <div role="rowgroup">
      {data.rows.map((row, rowIdx) => {
        const selected = editState.selectedRowIds.has(rowIdx);
        const isDeleted = editState.pendingDeletedRowKeys.has(rowKeyOf(rowIdx));
        // Issue #1174 — identity of the row now at this visual index; a
        // pending edit's overlay paints only when its anchor matches.
        const currentRowIdentity = rowIdentityKey(
          row as unknown[],
          data.columns,
        );
        const isExpandedHere = expandedNested?.rowIdx === rowIdx;
        const expandedColName = isExpandedHere
          ? (visibleEntries[expandedNested!.colIdx]?.[0]?.name ?? null)
          : null;
        const expandedRawValue =
          isExpandedHere && expandedColName
            ? queryResult?.rawDocuments[rowIdx]?.[expandedColName]
            : undefined;
        return (
          <Fragment key={`row-${page}-${rowIdx}`}>
            <div
              role="row"
              aria-rowindex={rowIdx + 2}
              aria-selected={selected}
              onClick={(e) =>
                editState.handleSelectRow(
                  rowIdx,
                  e.metaKey || e.ctrlKey,
                  e.shiftKey,
                )
              }
              className={cn(
                "min-h-8 cursor-pointer border-b border-border hover:bg-muted",
                selected && "bg-accent dark:bg-accent/60",
                isDeleted &&
                  "bg-destructive/10 line-through opacity-60 hover:bg-destructive/20",
              )}
              style={{
                display: "grid",
                gridTemplateColumns: "var(--cols)",
                minWidth: "max-content",
              }}
            >
              {visibleEntries.map(([col, colIdx], visualIdx) => {
                const cell = (row as unknown[])[colIdx];
                const isSentinel = isDocumentSentinel(cell);
                const isNull = cell == null;
                const key = editKey(rowIdx, colIdx);
                const isEditing =
                  editState.editingCell?.row === rowIdx &&
                  editState.editingCell?.col === colIdx;
                // Issue #1174 — index-keyed hit only counts when the row now
                // at this index still matches the edit-time anchor.
                const anchorMatches = pendingEditAnchorMatches(
                  key,
                  currentRowIdentity,
                  data.columns,
                  editState.pendingEditRowSnapshots,
                );
                const hasPendingEdit =
                  editState.pendingEdits.has(key) && anchorMatches;
                const pendingValue = hasPendingEdit
                  ? (editState.pendingEdits.get(key) as string | null)
                  : null;

                return (
                  <div
                    key={col.name}
                    role="gridcell"
                    aria-colindex={visualIdx + 1}
                    data-grid-row={rowIdx}
                    data-grid-col={visualIdx}
                    tabIndex={cellTabIndex(rowIdx, visualIdx)}
                    onFocus={() => onFocusCell(rowIdx, visualIdx)}
                    onKeyDown={(e) => {
                      // issue #1130 (N1) — cell 내부 native 컨트롤(nested
                      // toggle 버튼) focus 시 Space/Enter 를 셀 키맵이
                      // 가로채지 않도록 자기 셀 focus 일 때만 동작.
                      if (e.target !== e.currentTarget) return;
                      // Design-swarm #4 Phase 3 — Enter/F2 로 focus 된 cell
                      // 편집 진입 (double-click 과 동일 경로). 편집 중엔 editor
                      // input 이 Enter/Escape 를 stopPropagation 하므로 안 옴.
                      if (isEditing) return;
                      // issue #1130 AC2 — Space 로 행 선택 (onClick 과 동일
                      // modifier 시맨틱). preventDefault 로 page scroll 억제.
                      if (e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        editState.handleSelectRow(
                          rowIdx,
                          e.metaKey || e.ctrlKey,
                          e.shiftKey,
                        );
                        return;
                      }
                      if (e.key !== "Enter" && e.key !== "F2") return;
                      e.preventDefault();
                      e.stopPropagation();
                      handleStartEditCell(rowIdx, colIdx);
                    }}
                    data-editing={isEditing ? "true" : undefined}
                    className={cn(
                      "flex min-w-0 items-center overflow-hidden border-r border-border px-3 py-1 text-xs",
                      isEditing &&
                        "bg-primary/10 ring-2 ring-inset ring-primary",
                      !isEditing && hasPendingEdit && "bg-highlight/20",
                    )}
                    title={getCellTitle(cell)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleStartEditCell(rowIdx, colIdx);
                    }}
                  >
                    {isEditing ? (
                      <input
                        type="text"
                        autoFocus
                        aria-label={t("gridRows.editingAriaLabel", {
                          colName: col.name,
                        })}
                        className="w-full bg-transparent px-1 py-0 text-xs text-foreground outline-none"
                        value={editState.editValue ?? ""}
                        onChange={(e) => editState.setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            e.stopPropagation();
                            editState.saveCurrentEdit();
                          } else if (e.key === "Escape") {
                            e.stopPropagation();
                            editState.cancelEdit();
                          }
                        }}
                        onBlur={() => editState.saveCurrentEdit()}
                      />
                    ) : hasPendingEdit ? (
                      pendingValue === null ? (
                        <span
                          className="italic text-muted-foreground"
                          aria-label={t("gridRows.nullAriaLabel")}
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
                    ) : isNull ? (
                      <span className="italic text-muted-foreground">null</span>
                    ) : isSentinel ? (
                      <NestedCellToggle
                        cell={cell}
                        colName={col.name}
                        rowIdx={rowIdx}
                        colIdx={colIdx}
                        expandedNested={expandedNested}
                        setExpandedNested={setExpandedNested}
                        pendingEdits={editState.pendingEdits}
                        anchorMatches={anchorMatches}
                        rowId={queryResult?.rawDocuments[rowIdx]?._id}
                      />
                    ) : (
                      <span
                        dir="auto"
                        className="block overflow-hidden text-ellipsis whitespace-nowrap text-foreground [unicode-bidi:isolate]"
                      >
                        {renderCellValue(cell)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            {isExpandedHere && expandedNested && expandedColName && (
              <NestedDetailRow
                rowIdx={rowIdx}
                expandedNested={expandedNested}
                expandedColName={expandedColName}
                expandedRawValue={expandedRawValue}
                scrollContainerWidth={scrollContainerWidth}
                pendingEdits={editState.pendingEdits}
                setPendingEdits={editState.setPendingEdits}
                onClose={() => setExpandedNested(null)}
              />
            )}
          </Fragment>
        );
      })}
      {data.rows.length === 0 && (
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
            {t("gridRows.noDocuments")}
          </div>
        </div>
      )}
    </div>
  );
}

interface NestedCellToggleProps {
  cell: unknown;
  colName: string;
  rowIdx: number;
  colIdx: number;
  expandedNested: ExpandedNestedCell | null;
  setExpandedNested: (next: ExpandedNestedCell | null) => void;
  pendingEdits: ReadonlyMap<string, string | null>;
  /** Issue #1174 — false when the row at this index no longer matches the
   * edit-time anchor, so the nested pending ring must not paint. */
  anchorMatches: boolean;
  rowId: unknown;
}

function NestedCellToggle({
  cell,
  colName,
  rowIdx,
  colIdx,
  expandedNested,
  setExpandedNested,
  pendingEdits,
  anchorMatches,
  rowId,
}: NestedCellToggleProps) {
  const { t } = useTranslation("document");
  const sentinelStr = String(cell);
  const isArr = sentinelStr.startsWith("[");
  const isOpen =
    expandedNested?.rowIdx === rowIdx && expandedNested?.colIdx === colIdx;
  const innerLabel = isOpen
    ? "✕"
    : isArr
      ? sentinelStr.slice(1, -1).trim()
      : "...";
  const hasPending =
    anchorMatches &&
    buildNestedPendingByPath(pendingEdits, rowIdx, colIdx).size > 0;

  return (
    <span className="flex min-w-0 items-center gap-1 font-mono text-muted-foreground">
      <span>{isArr ? "[" : "{"}</span>
      <button
        type="button"
        data-testid={`nested-toggle-${rowIdx}-${colIdx}`}
        aria-expanded={isOpen}
        aria-label={t("gridRows.expandAriaLabel", {
          action: isOpen ? t("gridRows.close") : t("gridRows.expand"),
          colName,
        })}
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen) {
            setExpandedNested(null);
            return;
          }
          setExpandedNested({
            rowIdx,
            colIdx,
            rowIdSnapshot: safeStringifyCell(rowId),
          });
        }}
        className={cn(
          "inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
          isOpen &&
            "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
          hasPending && "ring-1 ring-highlight",
        )}
      >
        {innerLabel}
      </button>
      <span>{isArr ? "]" : "}"}</span>
    </span>
  );
}

interface NestedDetailRowProps {
  rowIdx: number;
  expandedNested: ExpandedNestedCell;
  expandedColName: string;
  expandedRawValue: unknown;
  scrollContainerWidth: number;
  pendingEdits: ReadonlyMap<string, string | null>;
  setPendingEdits: (next: Map<string, string | null>) => void;
  onClose: () => void;
}

function NestedDetailRow({
  rowIdx,
  expandedNested,
  expandedColName,
  expandedRawValue,
  scrollContainerWidth,
  pendingEdits,
  setPendingEdits,
  onClose,
}: NestedDetailRowProps) {
  return (
    <div
      role="row"
      data-testid={`nested-detail-row-${rowIdx}`}
      className="border-b border-border bg-secondary/20"
      style={{
        display: "grid",
        gridTemplateColumns: "var(--cols)",
        minWidth: "max-content",
      }}
    >
      <div role="gridcell" style={{ gridColumn: "1 / -1" }} className="p-0">
        <div
          className="sticky left-0"
          style={{ width: scrollContainerWidth || undefined }}
        >
          <DocumentTreePanel
            value={expandedRawValue}
            fieldName={expandedColName}
            pendingByPath={buildNestedPendingByPath(
              pendingEdits,
              rowIdx,
              expandedNested.colIdx,
            )}
            onCommitEdit={(path, value) => {
              const next = new Map(pendingEdits);
              const serialized =
                typeof value === "string" ? value : tagBsonWrapper(value);
              next.set(
                `${rowIdx}-${expandedNested.colIdx}:${path}`,
                serialized,
              );
              setPendingEdits(next);
            }}
            onClose={onClose}
            forbiddenRootKeys={MONGO_ROOT_RESERVED_KEYS}
          />
        </div>
      </div>
    </div>
  );
}
