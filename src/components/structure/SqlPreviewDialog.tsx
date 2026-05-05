import { Loader2, Play } from "lucide-react";
import PreviewDialog from "@components/ui/dialog/PreviewDialog";
import SqlSyntax from "@components/shared/SqlSyntax";
import { ENVIRONMENT_META, type EnvironmentTag } from "@/types/connection";

/**
 * Surfaced commit failure passed through from `useDataGridEdit`'s
 * `commitError` state. Rendered in a destructive banner with `role="alert"`
 * so screen readers announce the failure.
 *
 * Distinct from {@link SqlPreviewDialogProps.error}, which is used for SQL
 * preview *generation* failures (e.g. structure-editor schema mismatches).
 * `commitError` represents an *execution* failure: SQL was generated and
 * confirmed by the user, but the database rejected one of the statements.
 *
 * Fields mirror `useDataGridEdit.CommitError`:
 * - `statementIndex` is 0-indexed; the dialog renders "failed at: K" with
 *   K = `statementIndex + 1` so the label matches what the user counts.
 * - `statementCount` is the total batch size — combined with
 *   `statementIndex` it produces the "executed: N, failed at: K" line.
 * - `sql` is the raw SQL of the failing statement, shown verbatim so the
 *   user can correlate to the preview body.
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
   * Optional commit-time failure surfaced after `executeQuery` rejects.
   * When present, the dialog stays open and displays a destructive banner
   * with the failed statement, DB message, and "executed: N, failed at: K"
   * partial-failure count.
   */
  commitError?: SqlPreviewCommitError | null;
  /**
   * Optional environment tag for the connection backing this commit. When
   * set, a 1px-h color stripe renders above the dialog header. `null`
   * keeps the dialog visually unchanged for paradigm / surface variants
   * that don't plumb an environment.
   *
   * Typed as `string | null` so editors can plumb `connection.environment`
   * (loosely typed in the store) without casting; the runtime guard
   * `environment in ENVIRONMENT_META` narrows to `EnvironmentTag` before
   * lookup.
   */
  environment?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function SqlPreviewDialog({
  sql,
  loading,
  error,
  commitError,
  environment = null,
  onConfirm,
  onCancel,
}: SqlPreviewDialogProps) {
  const stripe =
    environment && environment in ENVIRONMENT_META ? (
      <div
        className="-mx-6 -mt-6 mb-2 h-1"
        style={{
          background: ENVIRONMENT_META[environment as EnvironmentTag].color,
        }}
        data-environment-stripe={environment}
        aria-hidden="true"
      />
    ) : null;

  return (
    <PreviewDialog
      title="Review SQL Changes"
      description="Review and execute SQL changes"
      className="w-dialog-md bg-secondary"
      headerStripe={stripe}
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
