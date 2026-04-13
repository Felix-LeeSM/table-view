import { Loader2, X, Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";

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
        className="w-[520px] bg-(--color-bg-secondary) p-0"
        showCloseButton={false}
      >
        <div className="rounded-lg bg-(--color-bg-secondary) shadow-xl">
          {/* Header */}
          <DialogHeader className="flex items-center justify-between border-b border-(--color-border) px-4 py-3">
            <DialogTitle className="text-sm font-semibold text-(--color-text-primary)">
              Review SQL Changes
            </DialogTitle>
            <DialogDescription className="sr-only">
              Review and execute SQL changes
            </DialogDescription>
            <button
              className="rounded p-1 text-(--color-text-muted) hover:bg-(--color-bg-tertiary)"
              onClick={onCancel}
              aria-label="Close dialog"
            >
              <X size={16} />
            </button>
          </DialogHeader>

          {/* SQL content */}
          <div className="px-4 py-3">
            <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap rounded border border-(--color-border) bg-(--color-bg-primary) p-3 text-xs font-mono text-(--color-text-primary)">
              {sql || "-- No changes to preview"}
            </pre>
          </div>

          {/* Error */}
          {error && (
            <div className="mx-4 mb-3 rounded bg-red-500/10 px-3 py-2 text-sm text-(--color-danger)">
              {error}
            </div>
          )}

          {/* Footer */}
          <DialogFooter className="border-t border-(--color-border) px-4 py-3">
            <button
              className="rounded px-3 py-1.5 text-sm text-(--color-text-secondary) hover:bg-(--color-bg-tertiary)"
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              className="flex items-center gap-1.5 rounded bg-(--color-accent) px-3 py-1.5 text-sm text-white hover:bg-(--color-accent-hover) disabled:opacity-50"
              onClick={onConfirm}
              disabled={loading || !sql.trim()}
            >
              {loading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              {loading ? "Executing..." : "Execute"}
            </button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
