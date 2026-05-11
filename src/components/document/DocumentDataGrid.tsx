import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { Loader2, Trash2, FileEdit } from "lucide-react";
import { useDocumentStore } from "@stores/documentStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { isDocumentSentinel } from "@/types/document";
import { safeStringifyCell } from "@lib/jsonCell";
import { useColumnWidths } from "@/hooks/useColumnWidths";
import { getDefaultRem, type ColumnCategory } from "@/lib/columnCategory";
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
    (s) => s.fieldsCache[`${connectionId}:${database}:${collection}`],
  );

  const safeModeGate = useSafeModeGate(connectionId);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [showQuickLook, setShowQuickLook] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilter, setActiveFilter] = useState<Record<string, unknown>>({});
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

  const { data, queryResult, loading, error, fetchData, handleCancelRefetch } =
    useDocumentGridData({
      connectionId,
      database,
      collection,
      page,
      pageSize,
      activeFilter,
      activeFilterCount,
    });

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

  // Sprint 258 — column widths via shared hook + `--cols` CSS variable
  // cascade. Document grid 은 drag-resize 미적용 (Sprint 238 AC-238-04 의
  // RDB-only 정책 유지) — reset 은 toolbar 의 reset 버튼 / cmd+shift+r
  // 이벤트로만 트리거.
  const widthColumns = useMemo(
    () =>
      (data?.columns ?? []).map((c) => ({
        name: c.name,
        category: (c.category ?? "unknown") as ColumnCategory,
      })),
    [data?.columns],
  );
  // Sprint 259 — database.collection 단위 영속.
  const persistenceKey = `document:${database}:${collection}`;
  const { widths, reset: resetColumnWidths } = useColumnWidths(
    widthColumns,
    persistenceKey,
  );

  const colsTemplate = useMemo(() => {
    if (!data) return "";
    const rootFontSizePx =
      typeof window !== "undefined"
        ? (() => {
            const measured = parseFloat(
              getComputedStyle(document.documentElement).fontSize,
            );
            return Number.isFinite(measured) ? measured : 16;
          })()
        : 16;
    return data.columns
      .map((col) => {
        const stored = widths[col.name];
        if (stored != null) return `${stored}px`;
        const cat = (col.category ?? "unknown") as ColumnCategory;
        return `${getDefaultRem(cat) * rootFontSizePx}px`;
      })
      .join(" ");
  }, [data, widths]);

  // AC-258-08 — cmd+shift+r 단축키가 reset-column-widths 이벤트를
  // dispatch 한다. App.tsx 의 핸들러가 active grid 와 무관하게 broadcast
  // 하고, 각 mounted grid 가 자기 widths 를 리셋한다.
  useEffect(() => {
    const handler = () => resetColumnWidths();
    window.addEventListener("reset-column-widths", handler);
    return () => window.removeEventListener("reset-column-widths", handler);
  }, [resetColumnWidths]);

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
      const recordedSql = `db.${collection}.insertOne(${JSON.stringify(record)})`;
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
        sorts={[]}
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
          className="relative flex-1 overflow-auto text-sm"
          role="grid"
          aria-rowcount={1 + data.rows.length}
          aria-colcount={data.columns.length}
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

          <div role="rowgroup" className="sticky top-0 z-10 bg-secondary">
            <div
              role="row"
              aria-rowindex={1}
              style={{
                display: "grid",
                gridTemplateColumns: "var(--cols)",
              }}
            >
              {data.columns.map((col, visualIdx) => (
                <div
                  key={col.name}
                  role="columnheader"
                  aria-colindex={visualIdx + 1}
                  className="flex flex-col justify-center overflow-hidden border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground"
                >
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="truncate">{col.name}</span>
                  </div>
                  <div className="mt-0.5 truncate text-3xs text-muted-foreground">
                    {col.data_type}
                  </div>
                </div>
              ))}
            </div>
          </div>

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
                    "cursor-pointer border-b border-border hover:bg-muted",
                    selected && "bg-accent dark:bg-accent/60",
                    isDeleted &&
                      "bg-destructive/10 line-through opacity-60 hover:bg-destructive/20",
                  )}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "var(--cols)",
                  }}
                >
                  {data.columns.map((col, colIdx) => {
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
                        aria-colindex={colIdx + 1}
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
                            : typeof cell === "object"
                              ? JSON.stringify(cell)
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
                          <span className="italic text-muted-foreground">
                            {String(cell)}
                          </span>
                        ) : (
                          <span
                            dir="auto"
                            className="block overflow-hidden text-ellipsis whitespace-nowrap text-foreground [unicode-bidi:isolate]"
                          >
                            {typeof cell === "object"
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
              <div role="row" className="border-b border-border">
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
