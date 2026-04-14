import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronRight, Loader2, X } from "lucide-react";
import { useSchemaStore } from "../stores/schemaStore";
import { useTabStore } from "../stores/tabStore";
import FilterBar from "./FilterBar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import type {
  FilterCondition,
  FilterMode,
  SortInfo,
  TableData,
} from "../types/schema";
import DataGridToolbar from "./datagrid/DataGridToolbar";
import DataGridTable from "./datagrid/DataGridTable";
import { useDataGridEdit } from "./datagrid/useDataGridEdit";

interface DataGridProps {
  connectionId: string;
  table: string;
  schema: string;
}

const DEFAULT_PAGE_SIZE = 100;

export default function DataGrid({
  connectionId,
  table,
  schema,
}: DataGridProps) {
  const queryTableData = useSchemaStore((s) => s.queryTableData);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const promoteTab = useTabStore((s) => s.promoteTab);
  const [data, setData] = useState<TableData | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sorts, setSorts] = useState<SortInfo[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [appliedFilters, setAppliedFilters] = useState<FilterCondition[]>([]);
  const [showQuery, setShowQuery] = useState(true);
  const [filterMode, setFilterMode] = useState<FilterMode>("structured");
  const [rawSql, setRawSql] = useState("");
  const [appliedRawSql, setAppliedRawSql] = useState("");
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [columnOrder, setColumnOrder] = useState<number[]>([]);

  // Reset column widths and order when table/schema changes
  useEffect(() => {
    setColumnWidths({});
    setColumnOrder([]);
  }, [connectionId, table, schema]);

  // Reset column order when columns change (new data, different table)
  useEffect(() => {
    if (data) {
      setColumnOrder(data.columns.map((_, i) => i));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.columns]);

  // Promote preview tab to permanent when user interacts (page change, filter, sort)
  useEffect(() => {
    if (activeTabId) {
      promoteTab(activeTabId);
    }
  }, [page, appliedFilters, appliedRawSql, sorts, activeTabId, promoteTab]);

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
        pendingEditsSize={editState.pendingEdits.size}
        pendingNewRowsCount={editState.pendingNewRows.length}
        pendingDeletedRowKeysSize={editState.pendingDeletedRowKeys.size}
        selectedRowIdsCount={editState.selectedRowIds.size}
        onSetPage={setPage}
        onSetPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onToggleFilters={() => setShowFilters((prev) => !prev)}
        onCommit={editState.handleCommit}
        onDiscard={editState.handleDiscard}
        onAddRow={editState.handleAddRow}
        onDeleteRow={editState.handleDeleteRow}
        onDuplicateRow={editState.handleDuplicateRow}
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
          className="border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-destructive"
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
          data={data}
          loading={loading}
          sorts={sorts}
          columnWidths={columnWidths}
          columnOrder={columnOrder}
          editingCell={editState.editingCell}
          editValue={editState.editValue}
          pendingEdits={editState.pendingEdits}
          selectedRowIds={editState.selectedRowIds}
          pendingDeletedRowKeys={editState.pendingDeletedRowKeys}
          pendingNewRows={editState.pendingNewRows}
          page={page}
          schema={schema}
          table={table}
          onSetEditValue={editState.setEditValue}
          onSaveCurrentEdit={editState.saveCurrentEdit}
          onCancelEdit={editState.cancelEdit}
          onStartEdit={editState.handleStartEdit}
          onSelectRow={editState.handleSelectRow}
          onSort={handleSort}
          onColumnWidthsChange={setColumnWidths}
          onReorderColumns={setColumnOrder}
          onDeleteRow={editState.handleDeleteRow}
          onDuplicateRow={editState.handleDuplicateRow}
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
              <code className="whitespace-pre-wrap break-all text-xs text-secondary-foreground">
                {data.executed_query}
              </code>
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
          className="w-[600px] max-h-[80vh] bg-background p-0"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>SQL Preview</DialogTitle>
            <DialogDescription>Preview SQL before executing</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[80vh] flex-col rounded-lg border border-border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">
                SQL Preview
              </h3>
              <button
                className="rounded p-1 hover:bg-muted"
                onClick={() => editState.setSqlPreview(null)}
                aria-label="Close SQL preview"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {editState.sqlPreview?.map((sql, i) => (
                <pre
                  key={i}
                  className="mb-2 whitespace-pre-wrap break-all rounded bg-secondary p-2 text-xs text-secondary-foreground"
                >
                  {sql}
                </pre>
              ))}
            </div>
            <DialogFooter className="border-t border-border px-4 py-3">
              <button
                className="rounded bg-muted px-3 py-1.5 text-xs text-secondary-foreground hover:bg-secondary"
                onClick={() => editState.setSqlPreview(null)}
              >
                Cancel
              </button>
              <button
                className="rounded bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700"
                onClick={editState.handleExecuteCommit}
                aria-label="Execute SQL"
              >
                Execute
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
