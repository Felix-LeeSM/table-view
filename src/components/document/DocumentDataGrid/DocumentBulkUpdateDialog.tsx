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
  const activeFilterCount = Object.keys(activeFilter).length;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onOpenChange(false)}>
      <DialogContent className="w-96 bg-secondary p-4" showCloseButton={false}>
        <div className="rounded-lg border border-border bg-secondary p-4 shadow-xl">
          <DialogHeader>
            <DialogTitle className="mb-2 text-sm font-semibold text-foreground">
              Update matching documents
            </DialogTitle>
            <DialogDescription className="mb-2 text-sm text-secondary-foreground">
              {activeFilterCount > 0
                ? `Apply a $set patch to every document in "${database}.${collection}" matching the current filter.`
                : `No filter is active. The patch will apply to EVERY document in "${database}.${collection}".`}
            </DialogDescription>
            <pre className="mb-2 max-h-24 overflow-auto rounded bg-muted p-2 text-xs text-foreground">
              {JSON.stringify(activeFilter, null, 2)}
            </pre>
          </DialogHeader>
          <label className="mb-2 block text-xs font-medium text-secondary-foreground">
            Patch (JSON object — must not contain _id)
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
          <DialogFooter className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={onConfirm}
              disabled={loading || patchInput.trim().length === 0}
              aria-label="Confirm update matching"
            >
              {loading ? "Updating..." : "Update matching"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
