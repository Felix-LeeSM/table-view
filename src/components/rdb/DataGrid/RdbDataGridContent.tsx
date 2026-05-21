import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import type { DataGridEditState } from "@components/datagrid/useDataGridEdit";
import DataGridTable, {
  type DataGridTableHandle,
} from "@components/datagrid/DataGridTable";
import type { SortInfo, TableData } from "@/types/schema";

interface RdbDataGridContentProps {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
  data: TableData | null;
  loading: boolean;
  error: string | null;
  sorts: SortInfo[];
  columnOrder: number[];
  editState: DataGridEditState;
  page: number;
  hiddenColumnNames: ReadonlySet<string>;
  activeFilterCount: number;
  onSort: (columnName: string, shiftKey: boolean) => void;
  onSortColumn: (
    columnName: string,
    direction: "ASC" | "DESC",
    append: boolean,
  ) => void;
  onClearColumnSort: (columnName: string) => void;
  onClearAllSorts: () => void;
  onHideColumn: (columnName: string) => void;
  onShowAllColumns: () => void;
  onNavigateToFk: (
    schema: string,
    table: string,
    column: string,
    value: string,
  ) => void;
  onClearFilters: () => void;
  onCancelRefetch: () => void;
}

export const RdbDataGridContent = forwardRef<
  DataGridTableHandle,
  RdbDataGridContentProps
>(function RdbDataGridContent(
  {
    connectionId,
    database,
    schema,
    table,
    data,
    loading,
    error,
    sorts,
    columnOrder,
    editState,
    page,
    hiddenColumnNames,
    activeFilterCount,
    onSort,
    onSortColumn,
    onClearColumnSort,
    onClearAllSorts,
    onHideColumn,
    onShowAllColumns,
    onNavigateToFk,
    onClearFilters,
    onCancelRefetch,
  },
  ref,
) {
  return (
    <>
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
          ref={ref}
          data={data}
          loading={loading}
          sorts={sorts}
          columnOrder={columnOrder}
          editingCell={editState.editingCell}
          editValue={editState.editValue}
          pendingEdits={editState.pendingEdits}
          setPendingEdits={editState.setPendingEdits}
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
          onSort={onSort}
          onSortColumn={onSortColumn}
          onClearColumnSort={onClearColumnSort}
          onClearAllSorts={onClearAllSorts}
          hiddenColumnNames={hiddenColumnNames}
          onHideColumn={onHideColumn}
          onShowAllColumns={onShowAllColumns}
          columnPrefsPk={{
            connectionId,
            paradigm: "rdb",
            dbName: database,
            namespace: schema,
            tableName: table,
          }}
          onDeleteRow={editState.handleDeleteRow}
          onDuplicateRow={editState.handleDuplicateRow}
          onNavigateToFk={onNavigateToFk}
          activeFilterCount={activeFilterCount}
          onClearFilters={onClearFilters}
          onCancelRefetch={onCancelRefetch}
        />
      )}
    </>
  );
});
