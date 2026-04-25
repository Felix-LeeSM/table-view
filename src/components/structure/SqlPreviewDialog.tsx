import { Loader2, Play } from "lucide-react";
import PreviewDialog from "@components/ui/dialog/PreviewDialog";
import SqlSyntax from "@components/shared/SqlSyntax";

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
 *
 * Sprint 96: migrated to the `PreviewDialog` preset. The preset's
 * `commitError` prop preserves the sprint-93 destructive banner contract
 * (role="alert", aria-live="assertive", "executed: N, failed at: K of M",
 * raw failed SQL) verbatim.
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
    <PreviewDialog
      title="Review SQL Changes"
      description="Review and execute SQL changes"
      className="w-dialog-md bg-secondary"
      preview={
        <pre className="max-h-scroll-lg overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs font-mono text-foreground">
          {sql.trim() ? (
            <SqlSyntax sql={sql} />
          ) : (
            <span className="italic text-muted-foreground">
              -- No changes to preview
            </span>
          )}
        </pre>
      }
      error={error}
      commitError={commitError ?? null}
      loading={loading}
      confirmDisabled={!sql.trim()}
      onConfirm={onConfirm}
      onCancel={onCancel}
      confirmLabel={
        <>
          {loading ? <Loader2 className="animate-spin" /> : <Play />}
          {loading ? "Executing..." : "Execute"}
        </>
      }
    />
  );
}
