import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("document");
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
        aria-label={t("bulkOps.deleteAriaLabel")}
        title={
          activeFilterCount > 0
            ? t("bulkOps.deleteTitleFiltered")
            : t("bulkOps.deleteTitleAll")
        }
      >
        <Trash2 />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground"
        onClick={bulkOps.handleUpdateManyClick}
        aria-label={t("bulkOps.updateAriaLabel")}
        title={
          activeFilterCount > 0
            ? t("bulkOps.updateTitleFiltered")
            : t("bulkOps.updateTitleAll")
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
        error={bulkOps.deleteManyError}
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
