import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ChevronRight, Loader2, X } from "lucide-react";
import { useSchemaStore } from "@stores/schemaStore";
import { useTabStore } from "@stores/tabStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useMruStore } from "@stores/mruStore";
import { cancelQuery } from "@lib/tauri";
import FilterBar from "@components/rdb/FilterBar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@components/ui/dialog";
import type {
  FilterCondition,
  FilterMode,
  SortInfo,
  TableData,
} from "@/types/schema";
import DataGridToolbar from "@components/datagrid/DataGridToolbar";
import DataGridTable, {
  type DataGridTableHandle,
} from "@components/datagrid/DataGridTable";
import { useDataGridEdit } from "@components/datagrid/useDataGridEdit";
import QuickLookPanel from "@components/shared/QuickLookPanel";
import { ExportButton } from "@components/shared/ExportButton";
import SqlSyntax from "@components/shared/SqlSyntax";
import PreviewCopyButton from "@components/ui/dialog/PreviewCopyButton";
import ConfirmDestructiveDialog from "@components/workspace/ConfirmDestructiveDialog";
import ExecuteButton from "@components/ui/ExecuteButton";
import { DEFAULT_PAGE_SIZE } from "@lib/gridPolicy";

interface DataGridProps {
  connectionId: string;
  table: string;
  schema: string;
  initialFilters?: FilterCondition[];
}

export default function DataGrid({
  connectionId,
  table,
  schema,
  initialFilters,
}: DataGridProps) {
  const queryTableData = useSchemaStore((s) => s.queryTableData);
  const addTab = useTabStore((s) => s.addTab);
  const updateTabSorts = useTabStore((s) => s.updateTabSorts);
  // MRU marking lives on each caller (not inside tabStore.addTab). FK
  // navigation opens a new persistent tab against (potentially) a
  // different table on the same connection; we mark used so the launcher
  // / EmptyState CTA reflect engagement with this connection.
  const markConnectionUsed = useMruStore((s) => s.markConnectionUsed);
  // Environment color stripe on the SQL Preview Dialog header.
  const connectionEnvironment = useConnectionStore(
    (s) =>
      s.connections.find((c) => c.id === connectionId)?.environment ?? null,
  );
  // Sprint 256 (AC-256-05) — connection display name for the env-aware
  // ExecuteButton inline preview footer ("Execute on <conn>").
  const connectionLabel = useConnectionStore(
    (s) => s.connections.find((c) => c.id === connectionId)?.name ?? null,
  );
  // Sort state lives on the active tab so it survives tab switches (this
  // component unmounts/remounts when the user navigates away and back).
  // `tab.sorts` is the single source of truth; `setSorts` delegates to the
  // store action so sibling tabs are never touched.
  const activeTabSorts = useTabStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab || tab.type !== "table") return undefined;
    return tab.sorts;
  });
  // Memoise the fallback so `sorts` keeps a stable identity when the tab
  // has no sort configured. Without this, `fetchData` (which depends on
  // `sorts`) would rebuild on every render and trigger a fetch loop.
  const EMPTY_SORTS = useMemo<SortInfo[]>(() => [], []);
  const sorts: SortInfo[] = activeTabSorts ?? EMPTY_SORTS;
  const setSorts = useCallback(
    (updater: SortInfo[] | ((prev: SortInfo[]) => SortInfo[])) => {
      // Read the live sort value off the store rather than closing over the
      // render-time `sorts` so two synchronous updates compose correctly.
      // selector closure는 같은 render cycle에 stale 값을 가지므로 functional
      // setter로 store action 시그니처를 바꾸기 전까지 getState로 fresh read.
      // eslint-disable-next-line no-restricted-syntax -- 두 동기 setSorts 호출 합성 위해 fresh read 필요
      const state = useTabStore.getState();
      const tabId = state.activeTabId;
      if (!tabId) return;
      const tab = state.tabs.find((t) => t.id === tabId);
      const prev: SortInfo[] =
        tab && tab.type === "table" ? (tab.sorts ?? []) : [];
      const next = typeof updater === "function" ? updater(prev) : updater;
      updateTabSorts(tabId, next);
    },
    [updateTabSorts],
  );
  const [data, setData] = useState<TableData | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(
    () => (initialFilters?.length ?? 0) > 0,
  );
  const [filters, setFilters] = useState<FilterCondition[]>(
    () => initialFilters ?? [],
  );
  const [appliedFilters, setAppliedFilters] = useState<FilterCondition[]>(
    () => initialFilters ?? [],
  );
  const [showQuery, setShowQuery] = useState(true);
  const [filterMode, setFilterMode] = useState<FilterMode>("structured");
  const [rawSql, setRawSql] = useState("");
  const [appliedRawSql, setAppliedRawSql] = useState("");
  const [columnOrder, setColumnOrder] = useState<number[]>([]);
  const [showQuickLook, setShowQuickLook] = useState(false);

  // Sprint 238 — DataGridTable owns column-width state via
  // `useColumnWidths`. Reset is exposed via imperative handle and wired
  // to the toolbar's "Reset column widths" action (AC-238-12).
  // Sprint 258 (AC-258-08) — same handle is also driven by the
  // `reset-column-widths` window event (Cmd+Shift+R global shortcut).
  const dataGridTableRef = useRef<DataGridTableHandle | null>(null);
  const handleResetColumnWidths = useCallback(() => {
    dataGridTableRef.current?.resetColumnWidths();
  }, []);

  useEffect(() => {
    const handler = () => {
      dataGridTableRef.current?.resetColumnWidths();
    };
    window.addEventListener("reset-column-widths", handler);
    return () => window.removeEventListener("reset-column-widths", handler);
  }, []);

  // Reset column order when table/schema changes
  useEffect(() => {
    setColumnOrder([]);
  }, [connectionId, table, schema]);

  // Reset column order when columns change (new data, different table)
  useEffect(() => {
    if (data) {
      setColumnOrder(data.columns.map((_, i) => i));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.columns]);

  // Cmd+F (Mac) / Ctrl+F (other) toggles the filter bar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "f" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowFilters((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Cmd+L (Mac) / Ctrl+L (other) toggles the Quick Look panel
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

  const prevPropsRef = useRef({ connectionId, table, schema });
  useEffect(() => {
    const prev = prevPropsRef.current;
    if (
      prev.connectionId !== connectionId ||
      prev.table !== table ||
      prev.schema !== schema
    ) {
      setPage(1);
      prevPropsRef.current = { connectionId, table, schema };
    }
  }, [connectionId, table, schema]);

  const fetchIdRef = useRef(0);
  // Query id for the in-flight `query_table_data` call so the shared
  // Cancel button can route through `cancel_query`. The backend command
  // registers the token before dispatching the SQL and removes it on
  // settle. The frontend also bumps `fetchIdRef` on cancel so the
  // backend's eventual reply (if it races past the cancel) is dropped.
  const queryIdRef = useRef<string | null>(null);
  const fetchData = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const activeRaw =
        appliedRawSql.trim().length > 0 ? appliedRawSql.trim() : undefined;
      const activeFilters =
        appliedFilters.length > 0 ? appliedFilters : undefined;
      const orderBy =
        sorts.length > 0
          ? sorts.map((s) => `${s.column} ${s.direction}`).join(", ")
          : undefined;
      const result = await queryTableData(
        connectionId,
        table,
        schema,
        page,
        pageSize,
        orderBy,
        activeRaw ? undefined : activeFilters,
        activeRaw,
      );
      if (fetchId === fetchIdRef.current) {
        setData(result);
      }
    } catch (e) {
      if (fetchId === fetchIdRef.current) {
        setError(String(e));
      }
    }
    if (fetchId === fetchIdRef.current) {
      setLoading(false);
      queryIdRef.current = null;
    }
  }, [
    connectionId,
    table,
    schema,
    page,
    pageSize,
    sorts,
    appliedFilters,
    appliedRawSql,
    queryTableData,
  ]);

  // Cancel handler for the rdb DataGrid. Bumps `fetchIdRef` so the
  // in-flight resolve is dropped, clears `loading` synchronously (overlay
  // disappears within one frame), and best-effort cancels the backend
  // driver handle.
  const handleCancelRefetch = useCallback(() => {
    fetchIdRef.current++;
    setLoading(false);
    const queryId = queryIdRef.current;
    queryIdRef.current = null;
    if (queryId) {
      cancelQuery(queryId).catch(() => {
        // best-effort — see DocumentDataGrid.handleCancelRefetch
      });
    }
  }, []);

  // Listen for context-aware refresh events (Cmd+R / F5)
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener("refresh-data", handler);
    return () => window.removeEventListener("refresh-data", handler);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalPages = data ? Math.ceil(data.total_count / pageSize) : 0;

  // Editing state managed by hook
  const editState = useDataGridEdit({
    data,
    schema,
    table,
    connectionId,
    page,
    fetchData,
  });

  // Sprint 245 (ADR 0022 Phase 1) — the Sprint 243 `useSafeModeReadOnly`
  // gate was reverted. The dialog-driven destructive-only policy in
  // `decideSafeModeAction` covers the production safety story; cell
  // edits / Add / Delete / Duplicate produce safe DML that flows
  // through to the commit-preview Safe Mode gate (which raises a
  // confirm dialog on destructive batches). Phase 5 will add a Cmd+Z
  // pending-undo safety net for safe-write commits.

  // Cancel active cell editing when the user explicitly refreshes data
  // (Cmd+R / F5 / refresh button) so the input doesn't linger at a
  // stale row position after new data arrives.
  const { cancelEdit } = editState;
  useEffect(() => {
    const handler = () => {
      cancelEdit();
    };
    window.addEventListener("refresh-data", handler);
    return () => window.removeEventListener("refresh-data", handler);
  }, [cancelEdit]);

  // Sprint 250 — modal-aware Esc → handleDiscard. Esc on the body (no
  // dialog open, no active cell editor) empties the four pending slices
  // (pendingEdits / pendingNewRows / pendingDeletedRowKeys / undoStack)
  // identical to the toolbar Discard button. The listener short-circuits
  // when:
  //   1. editState.editingCell !== null — the cell editor's local Esc
  //      handler (DataRow `onKeyDown`) already calls `cancelEdit`, which
  //      e.stopPropagation()s but not preventDefault. Window listeners
  //      still fire, so we must guard here too.
  //   2. A `[role="dialog"]` or `[role="alertdialog"]` is mounted —
  //      Radix Dialog / AlertDialog handles Esc-close itself, and the
  //      grid must not double-discard pending state when the user is
  //      actually trying to close a confirmation modal (BLOB viewer,
  //      SQL preview, ConfirmDestructiveDialog, etc.).
  const { handleDiscard } = editState;
  const editingCell = editState.editingCell;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Editor-local Esc wins — DataRow's onKeyDown already invoked
      // cancelEdit. Skip the grid-wide discard.
      if (editingCell !== null) return;
      // Modal/dialog open → defer to its native Esc handler.
      if (
        document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
      ) {
        return;
      }
      e.preventDefault();
      handleDiscard();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editingCell, handleDiscard]);

  // Sprint 249 (ADR 0022 Phase 5) — Cmd+Z (macOS) / Ctrl+Z (Win/Linux)
  // pending-undo. Active only while DataGrid is mounted; defers to the
  // browser's native text-editor undo whenever an INPUT / TEXTAREA /
  // contenteditable element holds focus (so editing a cell value still
  // gets the OS-level undo). Cmd+Shift+Z is intentionally untouched
  // here — Phase 5 is undo-only and Shift+Cmd+Z stays available for a
  // future redo without colliding.
  const { undo: undoPending, canUndo } = editState;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        !(
          (e.metaKey || e.ctrlKey) &&
          e.key.toLowerCase() === "z" &&
          !e.shiftKey
        )
      ) {
        return;
      }
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        // Browser native undo wins for text editors — our pending-undo
        // only applies once the cell editor has been dismissed.
        return;
      }
      if (!canUndo) return;
      e.preventDefault();
      undoPending();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canUndo, undoPending]);

  const handleSort = (columnName: string, shiftKey: boolean = false) => {
    if (shiftKey) {
      setSorts((prev) => {
        const existingIndex = prev.findIndex((s) => s.column === columnName);
        if (existingIndex !== -1) {
          const existing = prev[existingIndex]!;
          if (existing.direction === "ASC") {
            const newSorts = [...prev];
            newSorts[existingIndex] = { column: columnName, direction: "DESC" };
            return newSorts;
          } else {
            return prev.filter((s) => s.column !== columnName);
          }
        } else {
          return [...prev, { column: columnName, direction: "ASC" }];
        }
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
  };

  const handleNavigateToFk = useCallback(
    (
      refSchema: string,
      refTable: string,
      refColumn: string,
      cellValue: string,
    ) => {
      addTab({
        type: "table",
        connectionId,
        schema: refSchema,
        table: refTable,
        title: `${refSchema}.${refTable}`,
        closable: true,
        subView: "records",
        permanent: true,
        initialFilters: [
          {
            id: crypto.randomUUID(),
            column: refColumn,
            operator: "Eq",
            value: cellValue,
          },
        ],
      });
      markConnectionUsed(connectionId);
    },
    [addTab, markConnectionUsed, connectionId],
  );

  const handleApplyFilters = () => {
    if (filterMode === "raw") {
      setAppliedRawSql(rawSql);
      setAppliedFilters([]);
    } else {
      setAppliedFilters(filters);
      setAppliedRawSql("");
    }
    setPage(1);
  };

  const handleClearAllFilters = () => {
    setAppliedFilters([]);
    setAppliedRawSql("");
    setPage(1);
  };

  // Full clear used by the empty-state Clear filter affordance. Must clear
  // BOTH the structured (filters/appliedFilters) and the raw
  // (rawSql/appliedRawSql) tracks; otherwise an unapplied raw SQL would
  // slip back in on the next Apply (or vice versa).
  const handleClearAllFiltersFromEmptyState = useCallback(() => {
    setFilters([]);
    setAppliedFilters([]);
    setRawSql("");
    setAppliedRawSql("");
    setPage(1);
  }, []);

  const activeFilterCount =
    appliedRawSql.trim().length > 0 ? 1 : appliedFilters.length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <DataGridToolbar
        data={data}
        schema={schema}
        table={table}
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        sorts={sorts}
        activeFilterCount={activeFilterCount}
        showFilters={showFilters}
        hasPendingChanges={editState.hasPendingChanges}
        isCommitFlashing={editState.isCommitFlashing}
        pendingEditsSize={editState.pendingEdits.size}
        pendingNewRowsCount={editState.pendingNewRows.length}
        pendingDeletedRowKeysSize={editState.pendingDeletedRowKeys.size}
        selectedRowIdsCount={editState.selectedRowIds.size}
        exportSlot={
          <ExportButton
            context={{ kind: "table", schema, name: table }}
            headers={(data?.columns ?? []).map((c) => c.name)}
            getRows={() => (data?.rows ?? []) as unknown[][]}
          />
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
        onAddRow={editState.handleAddRow}
        onDeleteRow={editState.handleDeleteRow}
        onDuplicateRow={editState.handleDuplicateRow}
        onUndo={editState.undo}
        canUndo={editState.canUndo}
        onResetColumnWidths={handleResetColumnWidths}
      />

      {/* Filter bar */}
      {showFilters && (
        <FilterBar
          columns={data?.columns ?? []}
          filters={filters}
          onFiltersChange={setFilters}
          onApply={handleApplyFilters}
          onClose={() => setShowFilters(false)}
          onClearAll={handleClearAllFilters}
          filterMode={filterMode}
          rawSql={rawSql}
          onFilterModeChange={setFilterMode}
          onRawSqlChange={setRawSql}
        />
      )}

      {/* Content */}
      {error && (
        <div
          role="alert"
          className="border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-muted-foreground" size={24} />
        </div>
      )}

      {data && (
        <DataGridTable
          ref={dataGridTableRef}
          data={data}
          loading={loading}
          sorts={sorts}
          columnOrder={columnOrder}
          editingCell={editState.editingCell}
          editValue={editState.editValue}
          pendingEdits={editState.pendingEdits}
          pendingEditErrors={editState.pendingEditErrors}
          selectedRowIds={editState.selectedRowIds}
          pendingDeletedRowKeys={editState.pendingDeletedRowKeys}
          pendingNewRows={editState.pendingNewRows}
          page={page}
          schema={schema}
          table={table}
          onSetEditValue={editState.setEditValue}
          onSetEditNull={editState.setEditNull}
          onSaveCurrentEdit={editState.saveCurrentEdit}
          onCancelEdit={editState.cancelEdit}
          onStartEdit={editState.handleStartEdit}
          onSelectRow={editState.handleSelectRow}
          onSort={handleSort}
          onDeleteRow={editState.handleDeleteRow}
          onDuplicateRow={editState.handleDuplicateRow}
          onNavigateToFk={handleNavigateToFk}
          activeFilterCount={activeFilterCount}
          onClearFilters={handleClearAllFiltersFromEmptyState}
          onCancelRefetch={handleCancelRefetch}
        />
      )}

      {/* Quick Look panel */}
      {showQuickLook && editState.selectedRowIds.size > 0 && data && (
        <QuickLookPanel
          data={data}
          selectedRowIds={editState.selectedRowIds}
          schema={schema}
          table={table}
          onClose={() => setShowQuickLook(false)}
          editState={editState}
        />
      )}

      {/* Executed query bar */}
      {data && (
        <div className="border-t border-border">
          <button
            className="flex w-full items-center gap-1 px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
            onClick={() => setShowQuery(!showQuery)}
            aria-expanded={showQuery}
            aria-label={showQuery ? "Hide query" : "Show query"}
          >
            <ChevronRight
              size={10}
              className={`transition-transform ${showQuery ? "rotate-90" : ""}`}
            />
            <span>Query</span>
          </button>
          {showQuery && (
            <div
              className="max-h-32 overflow-auto bg-secondary px-3 py-1.5"
              role="region"
              aria-label="Executed SQL query"
            >
              {/* Sprint 233 (2026-05-07): syntax-highlight the executed query
                  via SqlSyntax. The user-reported PG-double-quoted form
                  (`SELECT * FROM "public"."brief_news_tasks" …`) tokenises
                  cleanly — sqlTokenize.ts:213-220 distinguishes `"…"`
                  identifiers from `'…'` string literals. */}
              <SqlSyntax
                sql={data.executed_query}
                className="whitespace-pre-wrap break-all text-xs text-secondary-foreground"
              />
            </div>
          )}
        </div>
      )}

      {/* SQL Preview Modal */}
      <Dialog
        open={!!editState.sqlPreview}
        onOpenChange={(open) => !open && editState.setSqlPreview(null)}
      >
        <DialogContent
          className="w-dialog-xl max-h-[80vh] bg-background p-0"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>SQL Preview</DialogTitle>
            <DialogDescription>Preview SQL before executing</DialogDescription>
          </DialogHeader>
          <div
            className="flex max-h-[80vh] flex-col rounded-lg border border-border bg-background shadow-xl"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                editState.handleExecuteCommit();
              }
            }}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">
                SQL Preview
              </h3>
              <div className="flex items-center gap-1">
                {/* Sprint 252: shared Copy button (PreviewCopyButton) — same
                    `data-testid="preview-dialog-copy"` as PreviewDialog so
                    callers' assertions stay consistent across the inline
                    grid preview and the structure preview surfaces.
                    Empty/whitespace join → button self-suppresses. */}
                <PreviewCopyButton
                  text={editState.sqlPreview?.join(";\n") ?? ""}
                  ariaLabel="Copy SQL to clipboard"
                />
                <button
                  className="rounded p-1 hover:bg-muted"
                  onClick={() => editState.setSqlPreview(null)}
                  aria-label="Close SQL preview"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {editState.sqlPreview?.map((sql, i) => {
                const isFailed = editState.commitError?.statementIndex === i;
                return (
                  <pre
                    key={i}
                    className={
                      isFailed
                        ? "mb-2 whitespace-pre-wrap break-all rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive"
                        : "mb-2 whitespace-pre-wrap break-all rounded bg-secondary p-2 text-xs text-secondary-foreground"
                    }
                  >
                    {/* Sprint 252: SqlSyntax wrap (AC-252-05). Each statement
                        is highlighted in-place; `<pre>` markup + failure
                        styling preserved exactly. */}
                    <SqlSyntax sql={sql} />
                  </pre>
                );
              })}
              {/* Commit-failure banner. Renders inside the modal so it
                  stays open after a failed executeQuery and the user sees
                  which statement failed + DB message + count. */}
              {editState.commitError && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="mt-2 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  data-testid="datagrid-commit-error"
                >
                  <div className="font-semibold">
                    executed: {editState.commitError.statementIndex}, failed at:{" "}
                    {editState.commitError.statementIndex + 1} of{" "}
                    {editState.commitError.statementCount}
                  </div>
                  <div className="mt-1 break-words">
                    {editState.commitError.message}
                  </div>
                  <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-destructive/30 bg-background/40 p-2 text-xs font-mono">
                    {editState.commitError.sql}
                  </pre>
                </div>
              )}
            </div>
            <DialogFooter className="border-t border-border px-4 py-3">
              <button
                className="rounded bg-muted px-3 py-1.5 text-xs text-secondary-foreground hover:bg-secondary"
                onClick={() => editState.setSqlPreview(null)}
              >
                Cancel
              </button>
              <ExecuteButton
                severity="warn"
                environment={connectionEnvironment}
                connectionLabel={connectionLabel}
                loading={false}
                disabled={false}
                onClick={editState.handleExecuteCommit}
                ariaLabel="Execute SQL"
                autoFocus
              />
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      {editState.pendingConfirm && (
        <ConfirmDestructiveDialog
          open={true}
          reason={editState.pendingConfirm.reason}
          sqlPreview={editState.pendingConfirm.sql}
          environment={
            connectionEnvironment === "production"
              ? "production"
              : "non-production"
          }
          connectionId={connectionId}
          statements={
            editState.pendingConfirm.sql ? [editState.pendingConfirm.sql] : []
          }
          paradigm="rdb"
          onConfirm={() => {
            void editState.confirmDangerous();
          }}
          onCancel={editState.cancelDangerous}
        />
      )}
    </div>
  );
}
