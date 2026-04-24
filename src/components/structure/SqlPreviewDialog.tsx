import { Loader2, X, Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@components/ui/dialog";
import { Button } from "@components/ui/button";

export interface SqlPreviewDialogProps {
  sql: string;
  loading: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function SqlPreviewDialog({
  sql,
  loading,
  error,
  onConfirm,
  onCancel,
}: SqlPreviewDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="w-[520px] bg-secondary p-0"
        showCloseButton={false}
      >
        <div className="rounded-lg bg-secondary shadow-xl">
          {/* Header */}
          <DialogHeader className="flex items-center justify-between border-b border-border px-4 py-3">
            <DialogTitle className="text-sm font-semibold text-foreground">
              Review SQL Changes
            </DialogTitle>
            <DialogDescription className="sr-only">
              Review and execute SQL changes
            </DialogDescription>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onCancel}
              aria-label="Close dialog"
            >
              <X />
            </Button>
          </DialogHeader>

          {/* SQL content */}
          <div className="px-4 py-3">
            <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs font-mono text-foreground">
              {sql || "-- No changes to preview"}
            </pre>
          </div>

          {/* Error */}
          {error && (
            <div className="mx-4 mb-3 rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Footer */}
          <DialogFooter className="border-t border-border px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={onConfirm}
              disabled={loading || !sql.trim()}
            >
              {loading ? <Loader2 className="animate-spin" /> : <Play />}
              {loading ? "Executing..." : "Execute"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
