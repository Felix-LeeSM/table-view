import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Decimal from "decimal.js";
import { Loader2, Trash2, FileEdit } from "lucide-react";
import { useDocumentStore } from "@stores/documentStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { isDocumentSentinel } from "@/types/document";
import { safeStringifyCell } from "@lib/jsonCell";
import { useColumnWidths } from "@/hooks/useColumnWidths";
import { useHiddenColumns } from "@/hooks/useHiddenColumns";
import { useDocumentSchemaAccumulator } from "@/hooks/useDocumentSchemaAccumulator";
import { useColumnResize } from "@components/datagrid/DataGridTable/useColumnResize";
import HeaderRow from "@components/datagrid/DataGridTable/HeaderRow";
import { getDefaultRem, type ColumnCategory } from "@/lib/columnCategory";
import type { ColumnInfo, SortInfo } from "@/types/schema";
import QuickLookPanel from "@components/shared/QuickLookPanel";
import { ExportButton } from "@components/shared/ExportButton";
import DataGridToolbar from "@components/datagrid/DataGridToolbar";
import AsyncProgressOverlay from "@components/feedback/AsyncProgressOverlay";
import {
  editKey,
  cellToEditValue,
  useDataGridEdit,
} from "@components/datagrid/useDataGridEdit";
import MqlPreviewModal from "@components/document/MqlPreviewModal";
import AddDocumentModal from "@components/document/AddDocumentModal";
import CollectionReadOnlyBanner from "@components/document/CollectionReadOnlyBanner";
import DocumentFilterBar from "@components/document/DocumentFilterBar";
import NestedExpandPopover from "@components/document/NestedExpandPopover";
import { Button } from "@components/ui/button";
import { DOCUMENT_LABELS } from "@/lib/strings/document";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import { insertDocument } from "@lib/tauri";
import { cn } from "@lib/utils";
import { DEFAULT_PAGE_SIZE } from "@lib/gridPolicy";
import { useDocumentGridData } from "./DocumentDataGrid/useDocumentGridData";
import { useMongoBulkOps } from "./DocumentDataGrid/useMongoBulkOps";
import DocumentBulkDeleteDialog from "./DocumentDataGrid/DocumentBulkDeleteDialog";
import DocumentBulkUpdateDialog from "./DocumentDataGrid/DocumentBulkUpdateDialog";

interface DocumentDataGridProps {
  connectionId: string;
  database: string;
  collection: string;
}

/**
 * Sprint 322 — Slice F.2 helper: pendingEdits 에서 한 (row, col) 의
 * nested edits 만 추려 `Map<dotPath, value>` 로 변환. NestedExpandPopover
 * 가 entry 별 pending 표시 + inline input 의 prefill 에 사용한다.
 * `value` 가 string | null — null 은 popover 가 빈 문자열로 취급.
 */
function buildNestedPendingByPath(
  pendingEdits: ReadonlyMap<string, string | null>,
  rowIdx: number,
  colIdx: number,
): Map<string, string> {
  const prefix = `${rowIdx}-${colIdx}:`;
  const out = new Map<string, string>();
  pendingEdits.forEach((value, key) => {
    if (!key.startsWith(prefix)) return;
    out.set(key.slice(prefix.length), value ?? "");
  });
  return out;
}

/**
 * Editable grid for the document paradigm. Same workflow as the SQL
 * grid (double-click → edit → Commit → preview → Execute) backed by the
 * MQL generator + Tauri insert/update/delete commands.
 *
 * Sentinel cells (`"{...}"` / `"[N items]"`) stay read-only — the MQL
 * generator rejects sentinel edits server-side, and `onDoubleClick`
 * short-circuits so the user doesn't see an editor that will fail.
 *
 * Toolbar Add opens {@link AddDocumentModal} and dispatches a single
 * `insertDocument`; the positional `handleAddRow` is unused because
 * one-shot inserts fit MongoDB's idiom better than cell-by-cell editing
 * of a schemaless row.
 *
 * Fetch/cancel/pagination/stale-guard pipeline lives in
 * `DocumentDataGrid/useDocumentGridData`; bulk-write decision flow in
 * `useMongoBulkOps`; confirm dialogs in the sibling components. This
 * entry only wires them.
 */
export default function DocumentDataGrid({
  connectionId,
  database,
  collection,
}: DocumentDataGridProps) {
  const addHistoryEntry = useQueryHistoryStore((s) => s.addHistoryEntry);
  const fieldsCacheEntry = useDocumentStore(
    (s) => s.fieldsCache[connectionId]?.[database]?.[collection],
  );

  const safeModeGate = useSafeModeGate(connectionId);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [showQuickLook, setShowQuickLook] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilter, setActiveFilter] = useState<Record<string, unknown>>({});
  // Sprint 315 — Slice C.1: multi-column sort. Local state mirrors the
  // RDB DataGrid's `handleSort` mechanic (click = primary ASC↔DESC↔clear,
  // shift+click = add/cycle/remove secondary keys). D-29: kept local
  // instead of routed through workspaceStore to limit Slice C.1 blast
  // radius. Cross-session persist is a Slice C.2 (Sprint 316) decision.
  const [sorts, setSorts] = useState<SortInfo[]>([]);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  const filterFieldNames = useMemo<readonly string[]>(
    () => (fieldsCacheEntry ? fieldsCacheEntry.map((c) => c.name) : []),
    [fieldsCacheEntry],
  );

  const activeFilterCount = useMemo(
    () => Object.keys(activeFilter).length,
    [activeFilter],
  );

  const {
    data: backendData,
    queryResult,
    loading,
    error,
    fetchData,
    handleCancelRefetch,
  } = useDocumentGridData({
    connectionId,
    database,
    collection,
    page,
    pageSize,
    activeFilter,
    activeFilterCount,
    sorts,
  });

  // Sprint 320 — Slice E.2: client-side schema accumulator. Mongo
  // collection 은 schemaless — fetch 마다 backend 가 보내는
  // `queryResult.columns` 가 다를 수 있다. accumulator 가 페이지 간
  // 누적해 grid header / row 가 흔들리지 않게 한다. triple 변경시
  // hook 내부에서 auto-reset (sprint 319 D-43).
  const schemaAccumulator = useDocumentSchemaAccumulator({
    connId: connectionId,
    db: database,
    collection,
  });
  useEffect(() => {
    if (queryResult) {
      schemaAccumulator.merge(queryResult.columns);
    }
    // accumulator.merge 는 hook 내부에서 ref 기반 stable identity.
    // queryResult.columns 만 deps 로 충분.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryResult?.columns]);

  // accumulator 가 backend columns 와 다를 수 있어 (a) 누적된 column 만
  // surface 하고 (b) cell lookup 시 backend rows 의 인덱스를 찾는다.
  // accumulator 가 빈 상태 (첫 fetch 전) 면 backend columns fallback
  // 으로 flicker 방지 (D-48).
  const data = useMemo(() => {
    if (!backendData) return null;
    if (schemaAccumulator.columns.length === 0) return backendData;
    const backendIdx = new Map<string, number>();
    backendData.columns.forEach((c, i) => backendIdx.set(c.name, i));
    const effectiveColumns: ColumnInfo[] = schemaAccumulator.columns.map(
      (c) => ({
        name: c.name,
        data_type: c.data_type,
        nullable: true,
        default_value: null,
        is_primary_key: c.name === "_id",
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      }),
    );
    const effectiveRows = backendData.rows.map((row) =>
      schemaAccumulator.columns.map((c) => {
        const idx = backendIdx.get(c.name);
        return idx === undefined ? null : (row as unknown[])[idx];
      }),
    );
    return {
      ...backendData,
      columns: effectiveColumns,
      rows: effectiveRows,
    };
  }, [backendData, schemaAccumulator.columns]);

  // Cmd+L (Mac) / Ctrl+L (other) toggles the Quick Look panel. Same shape
  // as `DataGrid.tsx` so keyboard behaviour stays consistent across
  // paradigms.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "l" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowQuickLook((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Editing state managed by the shared hook in document paradigm mode.
  // The hook treats `schema` as the Mongo database name and `table` as the
  // collection name — see `useDataGridEdit` doc block on `paradigm`.
  const editState = useDataGridEdit({
    data,
    schema: database,
    table: collection,
    connectionId,
    page,
    fetchData,
    paradigm: "document",
  });

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total_count / pageSize))
    : 1;

  // The overlay only paints after `loading` has been continuously true
  // for 1s — sub-second refetches resolve before this flips.
  const overlayVisible = useDelayedFlag(loading, 1000);

  const showQuickLookMounted =
    showQuickLook && editState.selectedRowIds.size > 0 && !!queryResult;

  const rowKeyOf = useCallback(
    (rowIdx: number) => `row-${page}-${rowIdx}`,
    [page],
  );

  // Sprint 258 — column widths via shared hook + `--cols` CSS variable.
  // Sprint 260 (AC-260-02) — drag-resize 도 활성. 결과는 `document:<db>:<coll>`
  // 단위 localStorage 에 persist (Sprint 259 의 영속 키 유지).
  const widthColumns = useMemo(
    () =>
      (data?.columns ?? []).map((c) => ({
        name: c.name,
        category: (c.category ?? "unknown") as ColumnCategory,
      })),
    [data?.columns],
  );
  const persistenceKey = `document:${database}:${collection}`;
  const {
    widths,
    setWidth,
    reset: resetColumnWidths,
  } = useColumnWidths(widthColumns, persistenceKey);

  // Sprint 317 — Slice D.1: per-collection hide column.
  // localStorage key = `hidden-columns:document:<db>:<coll>`. Sharing
  // the same `document:<db>:<coll>` namespace as widths keeps the
  // persisted state cohesive (D-35).
  const hiddenColumns = useHiddenColumns(persistenceKey);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Sprint 317 D.1 — visible column subset. Hidden columns drop out of
  // the header row, the `--cols` template, and the per-row cell map.
  // Tuples carry the original idx so cell lookups (`row[origIdx]`) stay
  // correct after filtering.
  const visibleEntries = useMemo<
    ReadonlyArray<readonly [ColumnInfo, number]>
  >(() => {
    if (!data) return [];
    return data.columns
      .map((c, i) => [c, i] as const)
      .filter(([c]) => !hiddenColumns.hidden.has(c.name));
  }, [data, hiddenColumns.hidden]);

  const visualWidthsPx = useMemo(() => {
    if (!data) return [] as number[];
    const rootFontSizePx =
      typeof window !== "undefined"
        ? (() => {
            const measured = parseFloat(
              getComputedStyle(document.documentElement).fontSize,
            );
            return Number.isFinite(measured) ? measured : 16;
          })()
        : 16;
    return visibleEntries.map(([col]) => {
      const stored = widths[col.name];
      if (stored != null) return stored;
      const cat = (col.category ?? "unknown") as ColumnCategory;
      return getDefaultRem(cat) * rootFontSizePx;
    });
  }, [data, widths, visibleEntries]);

  const colsTemplate = useMemo(
    () => visualWidthsPx.map((w) => `${w}px`).join(" "),
    [visualWidthsPx],
  );

  const visualWidthsRef = useRef(visualWidthsPx);
  visualWidthsRef.current = visualWidthsPx;
  const getCurrentWidths = useCallback(() => visualWidthsRef.current, []);

  const { handleResizeStart } = useColumnResize({
    outerRef: scrollContainerRef,
    getCurrentWidths,
    onCommitWidth: setWidth,
  });

  // AC-258-08 — cmd+shift+r 단축키가 reset-column-widths 이벤트를
  // dispatch 한다. App.tsx 의 핸들러가 active grid 와 무관하게 broadcast
  // 하고, 각 mounted grid 가 자기 widths 를 리셋한다.
  useEffect(() => {
    const handler = () => resetColumnWidths();
    window.addEventListener("reset-column-widths", handler);
    return () => window.removeEventListener("reset-column-widths", handler);
  }, [resetColumnWidths]);

  // Sprint 316 — explicit sort helpers driven by the column header
  // context menu. `append` mirrors shift+click semantics. The plain
  // `handleSort` (cycle on click) below stays as-is.
  const handleSortColumn = useCallback(
    (columnName: string, direction: "ASC" | "DESC", append: boolean) => {
      setSorts((prev) => {
        const next: SortInfo = { column: columnName, direction };
        if (append) {
          const idx = prev.findIndex((s) => s.column === columnName);
          if (idx !== -1) {
            const out = [...prev];
            out[idx] = next;
            return out;
          }
          return [...prev, next];
        }
        return [next];
      });
      setPage(1);
    },
    [],
  );

  const handleClearColumnSort = useCallback((columnName: string) => {
    setSorts((prev) => prev.filter((s) => s.column !== columnName));
    setPage(1);
  }, []);

  const handleClearAllSorts = useCallback(() => {
    setSorts([]);
    setPage(1);
  }, []);

  // Sprint 315 — RDB DataGrid handleSort 패턴 1:1 복제. shift+click =
  // multi-key (ASC→DESC→remove cycle per column), plain click = single
  // key reset (ASC→DESC→clear). page=1 로 리셋해 sort 가 reflect.
  const handleSort = useCallback(
    (columnName: string, shiftKey: boolean = false) => {
      if (shiftKey) {
        setSorts((prev) => {
          const existingIndex = prev.findIndex((s) => s.column === columnName);
          if (existingIndex !== -1) {
            const existing = prev[existingIndex]!;
            if (existing.direction === "ASC") {
              const newSorts = [...prev];
              newSorts[existingIndex] = {
                column: columnName,
                direction: "DESC",
              };
              return newSorts;
            }
            return prev.filter((s) => s.column !== columnName);
          }
          return [...prev, { column: columnName, direction: "ASC" }];
        });
      } else {
        setSorts((prev) => {
          if (prev.length === 0 || prev[0]!.column !== columnName) {
            return [{ column: columnName, direction: "ASC" }];
          }
          if (prev[0]!.direction === "ASC") {
            return [{ column: columnName, direction: "DESC" }];
          }
          return [];
        });
      }
      setPage(1);
    },
    [],
  );

  const handleStartEditCell = useCallback(
    (rowIdx: number, colIdx: number) => {
      if (!data) return;
      const cell = (data.rows[rowIdx] as unknown[] | undefined)?.[colIdx];
      if (isDocumentSentinel(cell)) {
        // Sentinel cells stay read-only — the generator drops the row and
        // the backend would reject the patch anyway. Short-circuit before
        // calling the edit hook so the user never sees an input appear.
        return;
      }
      const key = editKey(rowIdx, colIdx);
      const pendingValue = editState.pendingEdits.has(key)
        ? (editState.pendingEdits.get(key) as string | null)
        : cellToEditValue(cell);
      editState.handleStartEdit(rowIdx, colIdx, pendingValue);
    },
    [data, editState],
  );

  const handleAddClick = useCallback(() => {
    setAddError(null);
    setAddModalOpen(true);
  }, []);

  const handleAddSubmit = useCallback(
    async (record: Record<string, unknown>) => {
      setAddLoading(true);
      setAddError(null);
      // Synthesise a user-readable MQL line for the history row,
      // matching the per-document format from `mqlGenerator`.
      const startedAt = Date.now();
      const recordedSql = `db.${collection}.insertOne(${safeStringifyCell(record)})`;
      try {
        await insertDocument(connectionId, database, collection, record);
        setAddModalOpen(false);
        await fetchData();
        addHistoryEntry({
          sql: recordedSql,
          executedAt: startedAt,
          duration: Date.now() - startedAt,
          status: "success",
          connectionId,
          paradigm: "document",
          queryMode: "find",
          database,
          collection,
          source: "mongo-op",
        });
      } catch (e) {
        setAddError(e instanceof Error ? e.message : String(e));
        addHistoryEntry({
          sql: recordedSql,
          executedAt: startedAt,
          duration: Date.now() - startedAt,
          status: "error",
          connectionId,
          paradigm: "document",
          queryMode: "find",
          database,
          collection,
          source: "mongo-op",
        });
      } finally {
        setAddLoading(false);
      }
    },
    [connectionId, database, collection, fetchData, addHistoryEntry],
  );

  const handleExecuteMql = useCallback(async () => {
    setExecuting(true);
    try {
      await editState.handleExecuteCommit();
    } finally {
      setExecuting(false);
    }
  }, [editState]);

  const bulkOps = useMongoBulkOps({
    connectionId,
    database,
    collection,
    activeFilter,
    safeModeGate,
    fetchData,
  });

  const mqlPreview = editState.mqlPreview;
  const mqlErrors = useMemo(
    () =>
      mqlPreview?.errors.map((err) => {
        if (err.kind === "missing-id") {
          return { row: err.rowIdx, message: "missing or unsupported _id" };
        }
        if (err.kind === "id-in-patch") {
          return {
            row: err.rowIdx,
            message: `cannot edit field ${err.column} in a patch`,
          };
        }
        if (err.kind === "sentinel-edit") {
          return {
            row: err.rowIdx,
            message: `nested field ${err.column} is not editable`,
          };
        }
        return { row: err.rowIdx, message: err.reason };
      }) ?? [],
    [mqlPreview],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <CollectionReadOnlyBanner />
      <DataGridToolbar
        data={data}
        schema={database}
        table={collection}
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        sorts={sorts}
        activeFilterCount={activeFilterCount}
        showFilters={showFilters}
        hasPendingChanges={editState.hasPendingChanges}
        pendingEditsSize={editState.pendingEdits.size}
        pendingNewRowsCount={editState.pendingNewRows.length}
        pendingDeletedRowKeysSize={editState.pendingDeletedRowKeys.size}
        selectedRowIdsCount={editState.selectedRowIds.size}
        rowCountLabel={DOCUMENT_LABELS.rowCountLabel}
        addRowLabel={DOCUMENT_LABELS.addRowLabel}
        deleteRowLabel={DOCUMENT_LABELS.deleteRowLabel}
        duplicateRowLabel={DOCUMENT_LABELS.duplicateRowLabel}
        exportSlot={
          <ExportButton
            context={{ kind: "collection", name: collection }}
            headers={(data?.columns ?? []).map((c) => c.name)}
            getRows={() => (data?.rows ?? []) as unknown[][]}
          />
        }
        bulkOpsSlot={
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={bulkOps.handleDeleteManyClick}
              aria-label="Delete matching documents"
              title={
                activeFilterCount > 0
                  ? `Delete documents matching the current filter`
                  : "Delete every document in this collection"
              }
            >
              <Trash2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={bulkOps.handleUpdateManyClick}
              aria-label="Update matching documents"
              title={
                activeFilterCount > 0
                  ? `Update documents matching the current filter`
                  : "Update every document in this collection"
              }
            >
              <FileEdit />
            </Button>
          </>
        }
        onSetPage={setPage}
        onSetPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onToggleFilters={() => setShowFilters((prev) => !prev)}
        showQuickLook={showQuickLook}
        onToggleQuickLook={() => setShowQuickLook((prev) => !prev)}
        onCommit={editState.handleCommit}
        onDiscard={editState.handleDiscard}
        onAddRow={handleAddClick}
        onDeleteRow={editState.handleDeleteRow}
        onDuplicateRow={editState.handleDuplicateRow}
      />

      {/* Sprint 317 D.1 — hidden columns badge. Only shown when at
          least one column is hidden. "Show all" wipes the persisted
          state for the current collection (D-37). */}
      {hiddenColumns.hidden.size > 0 && (
        <div
          className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5 text-xs"
          aria-label="Hidden columns badge"
        >
          <span className="text-muted-foreground">
            {hiddenColumns.hidden.size === 1
              ? "1 column hidden"
              : `${hiddenColumns.hidden.size} columns hidden`}
          </span>
          <Button
            variant="ghost"
            size="xs"
            className="text-primary hover:text-primary/80"
            onClick={() => hiddenColumns.clear()}
            aria-label="Show all hidden columns"
          >
            Show all
          </Button>
        </div>
      )}

      {showFilters && (
        <DocumentFilterBar
          fieldNames={filterFieldNames}
          onApply={(filter) => {
            setActiveFilter(filter);
            setPage(1);
          }}
          onClose={() => setShowFilters(false)}
          onClear={() => {
            setActiveFilter({});
            setPage(1);
          }}
        />
      )}

      {error && (
        <div
          role="alert"
          className="border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="animate-spin text-muted-foreground" size={24} />
        </div>
      )}

      {data && (
        <div
          ref={scrollContainerRef}
          className="relative flex-1 overflow-auto text-sm"
          role="grid"
          aria-rowcount={1 + data.rows.length}
          aria-colcount={visibleEntries.length}
          style={{ "--cols": colsTemplate } as CSSProperties}
        >
          {/* `AsyncProgressOverlay` paints only after `loading` has
              been continuously true for 1s and internally hardens
              against pointer-event leaks. Cancel clears loading
              synchronously and best-effort cancels the backend driver. */}
          <AsyncProgressOverlay
            visible={overlayVisible}
            onCancel={handleCancelRefetch}
          />

          {/* Sprint 315 — paradigm-shared HeaderRow. order=identity
              (column reorder 미지원). RDB DataGrid 와 동일한 sort
              indicator (rank + ▲/▼) 가 column 별로 표시된다. */}
          <HeaderRow
            data={data}
            order={visibleEntries.map(([, i]) => i)}
            sorts={sorts}
            editingCell={editState.editingCell}
            onSort={handleSort}
            onSaveCurrentEdit={editState.saveCurrentEdit}
            onResizeStart={handleResizeStart}
            onSortColumn={handleSortColumn}
            onClearColumnSort={handleClearColumnSort}
            onClearAllSorts={handleClearAllSorts}
            onHideColumn={hiddenColumns.hide}
          />

          <div role="rowgroup">
            {data.rows.map((row, rowIdx) => {
              const selected = editState.selectedRowIds.has(rowIdx);
              const isDeleted = editState.pendingDeletedRowKeys.has(
                rowKeyOf(rowIdx),
              );
              return (
                <div
                  key={`row-${page}-${rowIdx}`}
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
                    const hasPendingEdit = editState.pendingEdits.has(key);
                    const pendingValue = hasPendingEdit
                      ? (editState.pendingEdits.get(key) as string | null)
                      : null;

                    return (
                      <div
                        key={col.name}
                        role="gridcell"
                        aria-colindex={visualIdx + 1}
                        data-editing={isEditing ? "true" : undefined}
                        className={cn(
                          "flex min-w-0 items-center overflow-hidden border-r border-border px-3 py-1 text-xs",
                          isEditing &&
                            "bg-primary/10 ring-2 ring-inset ring-primary",
                          !isEditing && hasPendingEdit && "bg-highlight/20",
                        )}
                        title={
                          isNull
                            ? "null"
                            : cell instanceof Decimal
                              ? cell.toString()
                              : typeof cell === "bigint"
                                ? cell.toString()
                                : typeof cell === "object"
                                  ? safeStringifyCell(cell)
                                  : String(cell)
                        }
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleStartEditCell(rowIdx, colIdx);
                        }}
                      >
                        {isEditing ? (
                          <input
                            type="text"
                            autoFocus
                            aria-label={`Editing ${col.name}`}
                            className="w-full bg-transparent px-1 py-0 text-xs text-foreground outline-none"
                            value={editState.editValue ?? ""}
                            onChange={(e) =>
                              editState.setEditValue(e.target.value)
                            }
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
                        ) : isNull ? (
                          <span className="italic text-muted-foreground">
                            null
                          </span>
                        ) : isSentinel ? (
                          // Sprint 321 — Slice F.1: sentinel cell 옆에
                          // expand popover trigger. raw_documents 의
                          // 해당 field 값으로 1-depth inspect.
                          // Sprint 322 — Slice F.2: 같은 popover 가
                          // 1-depth scalar entry 의 inline edit 를 수용,
                          // dot-notation key (`row-col:path`) 로
                          // pendingEdits 에 등록. mqlGenerator 는
                          // `$set: { "col.path": value }` 생성.
                          <span className="flex min-w-0 items-center gap-1">
                            <span
                              className={cn(
                                "truncate italic text-muted-foreground",
                                buildNestedPendingByPath(
                                  editState.pendingEdits,
                                  rowIdx,
                                  colIdx,
                                ).size > 0 &&
                                  "rounded bg-highlight/20 px-1 not-italic text-foreground",
                              )}
                            >
                              {String(cell)}
                            </span>
                            <NestedExpandPopover
                              value={
                                queryResult?.raw_documents[rowIdx]?.[col.name]
                              }
                              fieldName={col.name}
                              pendingByPath={buildNestedPendingByPath(
                                editState.pendingEdits,
                                rowIdx,
                                colIdx,
                              )}
                              onCommitEdit={(path, value) => {
                                const next = new Map(editState.pendingEdits);
                                next.set(`${rowIdx}-${colIdx}:${path}`, value);
                                editState.setPendingEdits(next);
                              }}
                            />
                          </span>
                        ) : (
                          <span
                            dir="auto"
                            className="block overflow-hidden text-ellipsis whitespace-nowrap text-foreground [unicode-bidi:isolate]"
                          >
                            {cell instanceof Decimal
                              ? cell.toString()
                              : typeof cell === "object"
                                ? safeStringifyCell(cell)
                                : String(cell)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
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
                  No documents
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showQuickLookMounted && queryResult && (
        <QuickLookPanel
          mode="document"
          rawDocuments={queryResult.raw_documents}
          selectedRowIds={editState.selectedRowIds}
          database={database}
          collection={collection}
          onClose={() => setShowQuickLook(false)}
          editState={editState}
          data={data ?? undefined}
        />
      )}

      {mqlPreview && (
        <MqlPreviewModal
          previewLines={mqlPreview.previewLines}
          errors={mqlErrors}
          loading={executing}
          onExecute={handleExecuteMql}
          onCancel={() => editState.setMqlPreview(null)}
        />
      )}

      {addModalOpen && (
        <AddDocumentModal
          loading={addLoading}
          error={addError}
          connectionId={connectionId}
          database={database}
          collection={collection}
          onSubmit={handleAddSubmit}
          onCancel={() => {
            if (addLoading) return;
            setAddModalOpen(false);
            setAddError(null);
          }}
        />
      )}

      <DocumentBulkDeleteDialog
        open={bulkOps.deleteManyDialogOpen}
        onOpenChange={bulkOps.setDeleteManyDialogOpen}
        database={database}
        collection={collection}
        activeFilter={activeFilter}
        loading={bulkOps.deleteManyLoading}
        onConfirm={bulkOps.handleConfirmDeleteMany}
      />

      <DocumentBulkUpdateDialog
        open={bulkOps.updateManyDialogOpen}
        onOpenChange={bulkOps.setUpdateManyDialogOpen}
        database={database}
        collection={collection}
        activeFilter={activeFilter}
        patchInput={bulkOps.updatePatchInput}
        onPatchInputChange={bulkOps.setUpdatePatchInput}
        error={bulkOps.updateManyError}
        loading={bulkOps.updateManyLoading}
        onConfirm={bulkOps.handleConfirmUpdateMany}
      />
    </div>
  );
}
