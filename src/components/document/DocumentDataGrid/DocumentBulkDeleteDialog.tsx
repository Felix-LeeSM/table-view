import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import { safeStringifyCell } from "@lib/jsonCell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";

/**
 * Presentational `Delete matching documents` confirm dialog. Stateless:
 * the parent owns open/close, the active filter predicate, the loading
 * flag, and the confirm callback.
 */

export interface DocumentBulkDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  database: string;
  collection: string;
  activeFilter: Record<string, unknown>;
  error?: string | null;
  loading: boolean;
  onConfirm: () => void;
}

export default function DocumentBulkDeleteDialog({
  open,
  onOpenChange,
  database,
  collection,
  activeFilter,
  error = null,
  loading,
  onConfirm,
}: DocumentBulkDeleteDialogProps) {
  const { t } = useTranslation("document");
  const activeFilterCount = Object.keys(activeFilter).length;
  const filterJson = safeStringifyCell(activeFilter);
  const previewLine = `db.${collection}.deleteMany(${filterJson})`;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onOpenChange(false)}>
      <DialogContent className="w-96 bg-secondary p-4" showCloseButton={false}>
        <div className="rounded-lg border border-border bg-secondary p-4 shadow-xl">
          <DialogHeader>
            <DialogTitle className="mb-2 text-sm font-semibold text-foreground">
              {t("bulkDelete.title")}
            </DialogTitle>
            <DialogDescription className="mb-2 text-sm text-secondary-foreground">
              {activeFilterCount > 0
                ? t("bulkDelete.descriptionFiltered", {
                    db: database,
                    collection,
                  })
                : t("bulkDelete.descriptionAll", { db: database, collection })}
            </DialogDescription>
            <pre className="mb-4 max-h-32 overflow-auto rounded bg-muted p-2 text-xs text-foreground">
              {safeStringifyCell(activeFilter, 2)}
            </pre>
            <pre
              aria-label={t("bulkDelete.mqlPreviewAriaLabel")}
              className="mb-2 max-h-24 overflow-auto rounded bg-background p-2 font-mono text-xs text-foreground"
            >
              {previewLine}
            </pre>
            {error && (
              <p role="alert" className="mb-2 text-xs text-destructive">
                {error}
              </p>
            )}
            <div
              role="alert"
              aria-label={t("bulkDelete.warningAriaLabel")}
              className="mb-3 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-xs text-warning"
            >
              {t("bulkDelete.warningText")}
            </div>
          </DialogHeader>
          <DialogFooter className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              {t("bulkDelete.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onConfirm}
              disabled={loading}
              aria-label={t("bulkDelete.confirmAriaLabel")}
            >
              {loading
                ? t("bulkDelete.deleting")
                : t("bulkDelete.deleteMatching")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
