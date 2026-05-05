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
 * Destructive-confirm dialog for Drop Collection. Mirrors SchemaTree's
 * Drop Table dialog. Safe Mode pre-classifies upstream; this is the
 * second-line "are you sure" the user actually clicks.
 */
export interface DropCollectionDialogProps {
  target: { database: string; collection: string } | null;
  isDropping: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DropCollectionDialog({
  target,
  isDropping,
  onConfirm,
  onCancel,
}: DropCollectionDialogProps) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="w-80 bg-secondary p-4" showCloseButton={false}>
        <div className="rounded-lg border border-border bg-secondary p-4 shadow-xl">
          <DialogHeader>
            <DialogTitle className="mb-2 text-sm font-semibold text-foreground">
              Drop Collection
            </DialogTitle>
            <DialogDescription className="mb-4 text-sm text-secondary-foreground">
              {target
                ? `Are you sure you want to drop "${target.database}.${target.collection}"? This action cannot be undone.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={isDropping}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onConfirm}
              disabled={isDropping}
              aria-label="Drop Collection"
            >
              {isDropping ? "Dropping..." : "Drop Collection"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
