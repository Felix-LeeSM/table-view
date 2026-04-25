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

/**
 * Sprint 93 — surfaced commit failure passed through from `useDataGridEdit`'s
 * `commitError` state. The dialog renders this in a destructive banner with a
 * `role="alert"` slot so screen readers announce the failure when it appears.
 *
 * Distinct from {@link SqlPreviewDialogProps.error}, which is used for SQL
 * preview *generation* failures (e.g. structure-editor schema mismatches).
 * `commitError` represents an *execution* failure: the SQL was generated and
 * confirmed by the user, but the database rejected one of the statements.
 *
 * Fields mirror `useDataGridEdit.CommitError`:
 * - `statementIndex` is 0-indexed; the dialog renders "failed at: K" with K =
 *   `statementIndex + 1` so the label matches what the user counts visually.
 * - `statementCount` is the total batch size — combined with `statementIndex`
 *   it produces the "executed: N, failed at: K" line.
 * - `sql` is the raw SQL of the failing statement, shown verbatim so the user
 *   can correlate to the preview body.
 * - `message` is the DB-reported error.
 */
export interface SqlPreviewCommitError {
  statementIndex: number;
  statementCount: number;
  sql: string;
  message: string;
}

export interface SqlPreviewDialogProps {
  sql: string;
  loading: boolean;
  error: string | null;
  /**
   * Sprint 93 — optional commit-time failure surfaced after `executeQuery`
   * rejects. When present, the dialog stays open and displays a destructive
   * banner with the failed statement, DB message, and "executed: N, failed
   * at: K" partial-failure count.
   */
  commitError?: SqlPreviewCommitError | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function SqlPreviewDialog({
  sql,
  loading,
  error,
  commitError,
  onConfirm,
  onCancel,
}: SqlPreviewDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="w-dialog-md bg-secondary p-0"
        showCloseButton={false}
      >
        <div className="rounded-lg bg-secondary shadow-xl">
          {/* Header — DialogHeader is row-based by default (sprint-91). */}
          <DialogHeader className="border-b border-border px-4 py-3">
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
            <pre className="max-h-scroll-lg overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs font-mono text-foreground">
              {sql || "-- No changes to preview"}
            </pre>
          </div>

          {/* Error */}
          {error && (
            <div className="mx-4 mb-3 rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Sprint 93 — commit failure banner. Distinct from `error` (preview
              generation): this surfaces an executeQuery rejection so the user
              sees which statement failed and how many already succeeded. */}
          {commitError && (
            <div
              role="alert"
              aria-live="assertive"
              className="mx-4 mb-3 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              data-testid="sql-preview-commit-error"
            >
              <div className="font-semibold">
                executed: {commitError.statementIndex}, failed at:{" "}
                {commitError.statementIndex + 1} of {commitError.statementCount}
              </div>
              <div className="mt-1 break-words">{commitError.message}</div>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-destructive/30 bg-background/40 p-2 text-xs font-mono">
                {commitError.sql}
              </pre>
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
