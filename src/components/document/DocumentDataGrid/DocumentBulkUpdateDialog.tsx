import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { cn } from "@lib/utils";
import { safeStringifyCell } from "@lib/jsonCell";

/**
 * Presentational `Update matching documents` dialog. Stateless: the
 * parent owns `open`, the patch input string, parse/`_id`/server error,
 * and the loading flag.
 */

export interface DocumentBulkUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  database: string;
  collection: string;
  activeFilter: Record<string, unknown>;
  patchInput: string;
  onPatchInputChange: (value: string) => void;
  error: string | null;
  loading: boolean;
  onConfirm: () => void;
}

export default function DocumentBulkUpdateDialog({
  open,
  onOpenChange,
  database,
  collection,
  activeFilter,
  patchInput,
  onPatchInputChange,
  error,
  loading,
  onConfirm,
}: DocumentBulkUpdateDialogProps) {
  const { t } = useTranslation("document");
  const activeFilterCount = Object.keys(activeFilter).length;
  const filterJson = safeStringifyCell(activeFilter);
  let parsedPatch: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(patchInput);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      !Object.prototype.hasOwnProperty.call(parsed, "_id")
    ) {
      parsedPatch = parsed as Record<string, unknown>;
    }
  } catch {
    parsedPatch = null;
  }
  const previewLine =
    parsedPatch === null
      ? null
      : `db.${collection}.updateMany(${filterJson}, { $set: ${safeStringifyCell(parsedPatch)} })`;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onOpenChange(false)}>
      <DialogContent className="w-96 bg-secondary p-4" showCloseButton={false}>
        <div className="rounded-lg border border-border bg-secondary p-4 shadow-xl">
          <DialogHeader>
            <DialogTitle className="mb-2 text-sm font-semibold text-foreground">
              {t("bulkUpdate.title")}
            </DialogTitle>
            <DialogDescription className="mb-2 text-sm text-secondary-foreground">
              {activeFilterCount > 0
                ? t("bulkUpdate.descriptionFiltered", {
                    db: database,
                    collection,
                  })
                : t("bulkUpdate.descriptionAll", { db: database, collection })}
            </DialogDescription>
            <pre className="mb-2 max-h-24 overflow-auto rounded bg-muted p-2 text-xs text-foreground">
              {safeStringifyCell(activeFilter, 2)}
            </pre>
          </DialogHeader>
          <label className="mb-2 block text-xs font-medium text-secondary-foreground">
            {t("bulkUpdate.patchLabel")}
          </label>
          <textarea
            value={patchInput}
            onChange={(e) => onPatchInputChange(e.target.value)}
            placeholder='{ "status": "archived" }'
            className={cn(
              "mb-2 h-24 w-full resize-none rounded border border-input bg-background px-2 py-1 font-mono text-xs",
              "placeholder:text-muted-foreground/70",
              "focus:outline-none focus:ring-1 focus:ring-ring",
            )}
            disabled={loading}
          />
          {error && (
            <p role="alert" className="mb-2 text-xs text-destructive">
              {error}
            </p>
          )}
          {previewLine ? (
            <>
              <pre
                aria-label={t("bulkUpdate.mqlPreviewAriaLabel")}
                className="mb-2 max-h-24 overflow-auto rounded bg-background p-2 font-mono text-xs text-foreground"
              >
                {previewLine}
              </pre>
              <div
                role="alert"
                aria-label={t("bulkUpdate.warningAriaLabel")}
                className="mb-3 rounded border border-warning/30 bg-warning/10 px-2 py-1 text-xs text-warning"
              >
                {t("bulkUpdate.warningText")}
              </div>
            </>
          ) : (
            <p className="mb-2 text-xs italic text-muted-foreground">
              {t("bulkUpdate.previewHint")}
            </p>
          )}
          <DialogFooter className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              {t("bulkUpdate.cancel")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={onConfirm}
              disabled={loading || patchInput.trim().length === 0}
              aria-label={t("bulkUpdate.confirmAriaLabel")}
            >
              {loading
                ? t("bulkUpdate.updating")
                : t("bulkUpdate.updateMatching")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
