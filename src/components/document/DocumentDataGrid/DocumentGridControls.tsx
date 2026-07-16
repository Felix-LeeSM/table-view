import { Filter } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ExportButton } from "@components/shared/ExportButton";
import DocumentFilterBar from "@components/document/DocumentFilterBar";
import { Button } from "@components/ui/button";
import { DOCUMENT_LABELS } from "@/lib/strings/document";
import {
  DataGridToolbar,
  DataGridSkeleton,
  type DataGridEditState,
} from "@components/datagrid";
import type { SafeModeGate } from "@hooks/useSafeModeGate";
import type { SortInfo, TableData } from "@/types/schema";
import DocumentBulkOps from "./DocumentBulkOps";

export interface DocumentGridControlsProps {
  data: TableData | null;
  database: string;
  collection: string;
  connectionId: string;
  page: number;
  pageSize: number;
  totalPages: number;
  sorts: SortInfo[];
  activeFilter: Record<string, unknown>;
  activeFilterCount: number;
  filterFieldNames: readonly string[];
  showFilters: boolean;
  showQuickLook: boolean;
  editState: DataGridEditState;
  /** #1461 — gates the cell-edit / add / delete / commit affordances on the
   *  connection's `edit.editDocuments` capability. Mirrors the RDB grid, which
   *  forwards its `canEditRows` to the shared toolbar. */
  editEnabled: boolean;
  /** #1461 — gates the bulk update-many / delete-many affordances on the
   *  connection's `edit.bulkWrite` capability. */
  bulkOpsEnabled: boolean;
  hiddenColumnCount: number;
  projection: Record<string, 0 | 1> | null;
  loading: boolean;
  error: string | null;
  safeModeGate: SafeModeGate;
  fetchData: () => Promise<void>;
  onSetPage: (page: number) => void;
  onSetPageSize: (size: number) => void;
  onToggleFilters: () => void;
  onToggleQuickLook: () => void;
  onAddRow: () => void;
  onApplyFilter: (filter: Record<string, unknown>) => void;
  onCloseFilters: () => void;
  onClearFilters: () => void;
  onShowAllHiddenColumns: () => void;
  onOpenProjection: () => void;
}

export default function DocumentGridControls({
  data,
  database,
  collection,
  connectionId,
  page,
  pageSize,
  totalPages,
  sorts,
  activeFilter,
  activeFilterCount,
  filterFieldNames,
  showFilters,
  showQuickLook,
  editState,
  editEnabled,
  bulkOpsEnabled,
  hiddenColumnCount,
  projection,
  loading,
  error,
  safeModeGate,
  fetchData,
  onSetPage,
  onSetPageSize,
  onToggleFilters,
  onToggleQuickLook,
  onAddRow,
  onApplyFilter,
  onCloseFilters,
  onClearFilters,
  onShowAllHiddenColumns,
  onOpenProjection,
}: DocumentGridControlsProps) {
  const { t } = useTranslation("document");
  return (
    <>
      <DataGridToolbar
        data={data}
        schema={database}
        table={collection}
        canEditRows={editEnabled}
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
            {bulkOpsEnabled && (
              <DocumentBulkOps
                connectionId={connectionId}
                database={database}
                collection={collection}
                activeFilter={activeFilter}
                activeFilterCount={activeFilterCount}
                safeModeGate={safeModeGate}
                fetchData={fetchData}
              />
            )}
            <Button
              variant="ghost"
              size="icon-xs"
              className={
                projection && Object.keys(projection).length > 0
                  ? "text-primary"
                  : "text-muted-foreground"
              }
              onClick={onOpenProjection}
              aria-label={t("gridControls.projectionAriaLabel")}
              title={
                projection && Object.keys(projection).length > 0
                  ? t("gridControls.projectionActiveTitle", {
                      count: Object.keys(projection).length,
                    })
                  : t("gridControls.projectionInactiveTitle")
              }
            >
              <Filter />
            </Button>
          </>
        }
        onSetPage={onSetPage}
        onSetPageSize={onSetPageSize}
        onToggleFilters={onToggleFilters}
        showQuickLook={showQuickLook}
        onToggleQuickLook={onToggleQuickLook}
        onCommit={editState.handleCommit}
        onDiscard={editState.handleDiscard}
        onAddRow={onAddRow}
        onDeleteRow={editState.handleDeleteRow}
        onDuplicateRow={editState.handleDuplicateRow}
      />

      {hiddenColumnCount > 0 && (
        <div
          className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5 text-xs"
          aria-label={t("gridControls.hiddenBadgeAriaLabel")}
        >
          <span className="text-muted-foreground">
            {hiddenColumnCount === 1
              ? t("gridControls.hiddenOne")
              : t("gridControls.hiddenMany", { count: hiddenColumnCount })}
          </span>
          <Button
            variant="ghost"
            size="xs"
            className="text-primary hover:text-primary/80"
            onClick={onShowAllHiddenColumns}
            aria-label={t("gridControls.showAllAriaLabel")}
          >
            {t("gridControls.showAll")}
          </Button>
        </div>
      )}

      {showFilters && (
        <DocumentFilterBar
          fieldNames={filterFieldNames}
          onApply={onApplyFilter}
          onClose={onCloseFilters}
          onClear={onClearFilters}
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

      {loading && !data && <DataGridSkeleton />}
    </>
  );
}
