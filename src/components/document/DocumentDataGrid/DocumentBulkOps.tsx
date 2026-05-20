import { FileEdit, Trash2 } from "lucide-react";
import { Button } from "@components/ui/button";
import type { SafeModeGate } from "@hooks/useSafeModeGate";
import { useMongoBulkOps } from "./useMongoBulkOps";
import DocumentBulkDeleteDialog from "./DocumentBulkDeleteDialog";
import DocumentBulkUpdateDialog from "./DocumentBulkUpdateDialog";

export interface DocumentBulkOpsProps {
  connectionId: string;
  database: string;
  collection: string;
  activeFilter: Record<string, unknown>;
  activeFilterCount: number;
  safeModeGate: SafeModeGate;
  fetchData: () => Promise<void>;
}

export default function DocumentBulkOps({
  connectionId,
  database,
  collection,
  activeFilter,
  activeFilterCount,
  safeModeGate,
  fetchData,
}: DocumentBulkOpsProps) {
  const bulkOps = useMongoBulkOps({
    connectionId,
    database,
    collection,
    activeFilter,
    safeModeGate,
    fetchData,
  });

  return (
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
    </>
  );
}
