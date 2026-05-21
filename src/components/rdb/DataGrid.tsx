import { useCallback, useEffect, useRef, useState } from "react";
import { useHiddenColumns } from "@/hooks/useHiddenColumns";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useMruStore } from "@stores/mruStore";
import FilterBar from "@components/rdb/FilterBar";
import type { FilterCondition } from "@/types/schema";
import type { DataGridTableHandle } from "@components/datagrid/DataGridTable";
import { useRdbDataGridEdit } from "@components/datagrid/useRdbDataGridEdit";
import QuickLookPanel from "@components/shared/QuickLookPanel";
import { DEFAULT_PAGE_SIZE } from "@lib/gridPolicy";
import { ExecutedQueryBar } from "./DataGrid/ExecutedQueryBar";
import { HiddenColumnsBadge } from "./DataGrid/HiddenColumnsBadge";
import { RdbDataGridContent } from "./DataGrid/RdbDataGridContent";
import { RdbDataGridDialogs } from "./DataGrid/RdbDataGridDialogs";
import { RdbDataGridToolbar } from "./DataGrid/RdbDataGridToolbar";
import { useRdbColumnOrder } from "./DataGrid/useRdbColumnOrder";
import { useRdbDataGridFilters } from "./DataGrid/useRdbDataGridFilters";
import { useRdbDataGridShortcuts } from "./DataGrid/useRdbDataGridShortcuts";
import { useRdbDataGridSortHandlers } from "./DataGrid/useRdbDataGridSortHandlers";
import { useRdbDataGridSorts } from "./DataGrid/useRdbDataGridSorts";
import { useRdbTableData } from "./DataGrid/useRdbTableData";

interface DataGridProps {
  connectionId: string;
  database: string;
  table: string;
  schema: string;
  initialFilters?: FilterCondition[];
}

export default function DataGrid({
  connectionId,
  database,
  table,
  schema,
  initialFilters,
}: DataGridProps) {
  const addTab = useWorkspaceStore((s) => s.addTab);
  const markConnectionUsed = useMruStore((s) => s.markConnectionUsed);
  const connectionEnvironment = useConnectionStore(
    (s) =>
      s.connections.find((c) => c.id === connectionId)?.environment ?? null,
  );
  const connectionLabel = useConnectionStore(
    (s) => s.connections.find((c) => c.id === connectionId)?.name ?? null,
  );

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [showQuickLook, setShowQuickLook] = useState(false);
  const resetPage = useCallback(() => setPage(1), []);

  const { sorts, setSorts } = useRdbDataGridSorts();
  const sortHandlers = useRdbDataGridSortHandlers({
    setSorts,
    onResetPage: resetPage,
  });
  const filters = useRdbDataGridFilters({
    initialFilters,
    onResetPage: resetPage,
  });

  const { data, loading, error, fetchData, handleCancelRefetch } =
    useRdbTableData({
      connectionId,
      database,
      table,
      schema,
      page,
      pageSize,
      sorts,
      appliedFilters: filters.appliedFilters,
      appliedRawSql: filters.appliedRawSql,
    });

  const columnOrder = useRdbColumnOrder({
    connectionId,
    table,
    schema,
    data,
  });
  const editState = useRdbDataGridEdit({
    data,
    schema,
    table,
    connectionId,
    page,
    fetchData,
  });
  const hiddenColumns = useHiddenColumns({
    connectionId,
    paradigm: "rdb",
    dbName: database,
    namespace: schema,
    tableName: table,
  });

  const dataGridTableRef = useRef<DataGridTableHandle | null>(null);
  const prevPropsRef = useRef({ connectionId, table, schema });
  const totalPages = data ? Math.ceil(data.total_count / pageSize) : 0;

  const toggleQuickLook = useCallback(() => {
    setShowQuickLook((visible) => !visible);
  }, []);

  const closeQuickLook = useCallback(() => {
    setShowQuickLook(false);
  }, []);

  const handleResetColumnWidths = useCallback(() => {
    dataGridTableRef.current?.resetColumnWidths();
  }, []);

  const handleSetPageSize = useCallback(
    (size: number) => {
      setPageSize(size);
      resetPage();
    },
    [resetPage],
  );

  const handleNavigateToFk = useCallback(
    (
      refSchema: string,
      refTable: string,
      refColumn: string,
      cellValue: string,
    ) => {
      addTab(connectionId, {
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
    [addTab, connectionId, markConnectionUsed],
  );

  useEffect(() => {
    const handler = () => {
      dataGridTableRef.current?.resetColumnWidths();
    };
    window.addEventListener("reset-column-widths", handler);
    return () => window.removeEventListener("reset-column-widths", handler);
  }, []);

  useEffect(() => {
    const prev = prevPropsRef.current;
    if (
      prev.connectionId !== connectionId ||
      prev.table !== table ||
      prev.schema !== schema
    ) {
      resetPage();
      prevPropsRef.current = { connectionId, table, schema };
    }
  }, [connectionId, resetPage, schema, table]);

  useRdbDataGridShortcuts({
    editingCell: editState.editingCell,
    canUndo: editState.canUndo,
    onToggleFilters: filters.toggleFilters,
    onToggleQuickLook: toggleQuickLook,
    onCancelEdit: editState.cancelEdit,
    onDiscard: editState.handleDiscard,
    onUndo: editState.undo,
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <RdbDataGridToolbar
        data={data}
        schema={schema}
        table={table}
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        sorts={sorts}
        activeFilterCount={filters.activeFilterCount}
        showFilters={filters.showFilters}
        showQuickLook={showQuickLook}
        editState={editState}
        onSetPage={setPage}
        onSetPageSize={handleSetPageSize}
        onToggleFilters={filters.toggleFilters}
        onToggleQuickLook={toggleQuickLook}
        onResetColumnWidths={handleResetColumnWidths}
      />

      <HiddenColumnsBadge
        hiddenCount={hiddenColumns.hidden.size}
        onShowAll={hiddenColumns.clear}
      />

      {filters.showFilters && (
        <FilterBar
          columns={data?.columns ?? []}
          filters={filters.filters}
          onFiltersChange={filters.setFilters}
          onApply={filters.applyFilters}
          onClose={filters.closeFilters}
          onClearAll={filters.clearAppliedFilters}
          filterMode={filters.filterMode}
          rawSql={filters.rawSql}
          onFilterModeChange={filters.setFilterMode}
          onRawSqlChange={filters.setRawSql}
        />
      )}

      <RdbDataGridContent
        ref={dataGridTableRef}
        connectionId={connectionId}
        database={database}
        schema={schema}
        table={table}
        data={data}
        loading={loading}
        error={error}
        sorts={sorts}
        columnOrder={columnOrder}
        editState={editState}
        page={page}
        hiddenColumnNames={hiddenColumns.hidden}
        activeFilterCount={filters.activeFilterCount}
        onSort={sortHandlers.handleSort}
        onSortColumn={sortHandlers.handleSortColumn}
        onClearColumnSort={sortHandlers.handleClearColumnSort}
        onClearAllSorts={sortHandlers.handleClearAllSorts}
        onHideColumn={hiddenColumns.hide}
        onShowAllColumns={hiddenColumns.clear}
        onNavigateToFk={handleNavigateToFk}
        onClearFilters={filters.clearAllFilters}
        onCancelRefetch={handleCancelRefetch}
      />

      {showQuickLook && editState.selectedRowIds.size > 0 && data && (
        <QuickLookPanel
          data={data}
          selectedRowIds={editState.selectedRowIds}
          schema={schema}
          table={table}
          onClose={closeQuickLook}
          editState={editState}
        />
      )}

      {data && <ExecutedQueryBar sql={data.executed_query} />}

      <RdbDataGridDialogs
        connectionId={connectionId}
        connectionEnvironment={connectionEnvironment}
        connectionLabel={connectionLabel}
        editState={editState}
      />
    </div>
  );
}
