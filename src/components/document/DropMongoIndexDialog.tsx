import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { dropMongoIndex } from "@/lib/tauri";
import { toast } from "@/lib/runtime/toast";

export interface DropMongoIndexDialogProps {
  connectionId: string;
  database: string;
  collection: string;
  /** Canonical index name (typing-confirm target + payload). */
  indexName: string;
  open: boolean;
  onClose: () => void;
  /**
   * Called once after a successful drop so the parent panel can
   * re-fetch its index list.
   */
  onDropped: (indexName: string) => void | Promise<void>;
}

/**
 * Typing-confirm modal mirroring the RDB `DropTriggerDialog` shape.
 *
 * The Confirm button stays disabled until the user types the exact
 * index name (byte-for-byte; no trim, no debounce — every keystroke
 * re-evaluates). On confirm we call `dropMongoIndex`; success closes the
 * modal + toasts. Driver errors are surfaced inline in `role="alert"`
 * and the modal stays open with the input preserved so the user can
 * read the message before retrying.
 */
export function DropMongoIndexDialog({
  connectionId,
  database,
  collection,
  indexName,
  open,
  onClose,
  onDropped,
}: DropMongoIndexDialogProps) {
  const [typing, setTyping] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTyping("");
      setSubmitting(false);
      setError(null);
    }
  }, [open, indexName]);

  const typingMatches = typing === indexName;
  const canConfirm = typingMatches && !submitting;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setError(null);
    setSubmitting(true);
    try {
      await dropMongoIndex(connectionId, database, collection, indexName, true);
      toast.success(`Index "${indexName}" dropped`);
      await onDropped(indexName);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !submitting) onClose();
      }}
    >
      <DialogContent
        data-testid="mongo-drop-index-dialog"
        tone="destructive"
        className="w-dialog-sm"
      >
        <DialogHeader layout="column">
          <DialogTitle>Drop Index</DialogTitle>
          <DialogDescription>
            {database}.{collection}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            This action cannot be undone. Type the index name to confirm.
          </p>
          <div>
            <label
              htmlFor="mongo-drop-index-typing"
              className="mb-1 block text-xs font-medium"
            >
              Type{" "}
              <code className="rounded bg-muted px-1 font-mono text-3xs">
                {indexName}
              </code>{" "}
              to confirm
            </label>
            <input
              id="mongo-drop-index-typing"
              type="text"
              value={typing}
              onChange={(e) => setTyping(e.target.value)}
              placeholder={indexName}
              autoFocus
              aria-label="Type the index name to confirm"
              data-testid="mongo-drop-index-typing"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
            />
          </div>

          {error !== null && (
            <div
              role="alert"
              data-testid="mongo-drop-index-error"
              className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleConfirm}
            disabled={!canConfirm}
            data-testid="mongo-drop-index-confirm"
          >
            {submitting && (
              <Loader2 className="mr-1 size-3.5 animate-spin" aria-hidden />
            )}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
