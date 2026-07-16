import type { DataGridEditState } from "@components/datagrid/useDataGridEdit";
import DataGridToolbar from "@components/datagrid/DataGridToolbar";
import { ExportButton } from "@components/shared/ExportButton";
import type { SortInfo, TableData } from "@/types/schema";

interface RdbDataGridToolbarProps {
  data: TableData | null;
  schema: string;
  table: string;
  page: number;
  pageSize: number;
  totalPages: number;
  sorts: SortInfo[];
  activeFilterCount: number;
  showFilters: boolean;
  showQuickLook: boolean;
  editState: DataGridEditState;
  canEditRows: boolean;
  discardConfirmOpen: boolean;
  onDiscardConfirmOpenChange: (open: boolean) => void;
  onSetPage: (page: number) => void;
  onSetPageSize: (size: number) => void;
  onToggleFilters: () => void;
  onToggleQuickLook: () => void;
  onResetColumnWidths: () => void;
}

export function RdbDataGridToolbar({
  data,
  schema,
  table,
  page,
  pageSize,
  totalPages,
  sorts,
  activeFilterCount,
  showFilters,
  showQuickLook,
  editState,
  canEditRows,
  discardConfirmOpen,
  onDiscardConfirmOpenChange,
  onSetPage,
  onSetPageSize,
  onToggleFilters,
  onToggleQuickLook,
  onResetColumnWidths,
}: RdbDataGridToolbarProps) {
  return (
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
      canEditRows={canEditRows}
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
      onSetPage={onSetPage}
      onSetPageSize={onSetPageSize}
      onToggleFilters={onToggleFilters}
      showQuickLook={showQuickLook}
      onToggleQuickLook={onToggleQuickLook}
      onCommit={editState.handleCommit}
      onDiscard={editState.handleDiscard}
      discardConfirmOpen={discardConfirmOpen}
      onDiscardConfirmOpenChange={onDiscardConfirmOpenChange}
      onAddRow={editState.handleAddRow}
      onDeleteRow={editState.handleDeleteRow}
      onDuplicateRow={editState.handleDuplicateRow}
      onUndo={editState.undo}
      canUndo={editState.canUndo}
      onRedo={editState.redo}
      canRedo={editState.canRedo}
      onResetColumnWidths={onResetColumnWidths}
    />
  );
}
