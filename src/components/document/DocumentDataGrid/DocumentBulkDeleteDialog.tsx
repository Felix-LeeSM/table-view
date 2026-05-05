import { Button } from "@components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";

/**
 * Sprint 210 — presentational `Delete matching documents` confirm dialog
 * extracted from `DocumentDataGrid` (Sprint 198 origin). The component is
 * stateless: open/close ownership, the active filter predicate, the
 * pending-delete loading flag, and the confirm callback are all supplied
 * by the parent via props. The wording / classes / aria-labels are
 * identical to the inline JSX in the pre-Sprint-210 entry — see the
 * regression tests for behavioural lock-in.
 */

export interface DocumentBulkDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  database: string;
  collection: string;
  activeFilter: Record<string, unknown>;
  loading: boolean;
  onConfirm: () => void;
}

export default function DocumentBulkDeleteDialog({
  open,
  onOpenChange,
  database,
  collection,
  activeFilter,
  loading,
  onConfirm,
}: DocumentBulkDeleteDialogProps) {
  const activeFilterCount = Object.keys(activeFilter).length;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onOpenChange(false)}>
      <DialogContent className="w-96 bg-secondary p-4" showCloseButton={false}>
        <div className="rounded-lg border border-border bg-secondary p-4 shadow-xl">
          <DialogHeader>
            <DialogTitle className="mb-2 text-sm font-semibold text-foreground">
              Delete matching documents
            </DialogTitle>
            <DialogDescription className="mb-2 text-sm text-secondary-foreground">
              {activeFilterCount > 0
                ? `This will delete every document in "${database}.${collection}" matching the current filter.`
                : `No filter is active. This will delete EVERY document in "${database}.${collection}". This action cannot be undone.`}
            </DialogDescription>
            <pre className="mb-4 max-h-32 overflow-auto rounded bg-muted p-2 text-xs text-foreground">
              {JSON.stringify(activeFilter, null, 2)}
            </pre>
          </DialogHeader>
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
              variant="destructive"
              size="sm"
              onClick={onConfirm}
              disabled={loading}
              aria-label="Confirm delete matching"
            >
              {loading ? "Deleting..." : "Delete matching"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
