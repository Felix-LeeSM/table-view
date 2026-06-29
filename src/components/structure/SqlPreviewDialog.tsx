import { useTranslation } from "react-i18next";
import PreviewDialog from "@components/ui/dialog/PreviewDialog";
import SqlSyntax from "@components/shared/SqlSyntax";
import ExecuteButton from "@components/ui/ExecuteButton";
import SchemaGraphMigrationImpactSummary from "@components/schema/SchemaGraphMigrationImpactSummary";
import type { SchemaGraphMigrationImpactSummary as MigrationImpactSummary } from "@/lib/schemaGraphSelectors";

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
   * Optional environment tag for the connection backing this commit.
   * Drives `<ExecuteButton>`'s severity × env color matrix and the
   * "Execute on <conn>" label suffix. Typed as `string | null` so editors
   * can plumb `connection.environment` (loosely typed in the store)
   * without casting.
   */
  environment?: string | null;
  /**
   * Sprint 256 (ADR 0023, AC-256-05) — display name of the connection
   * backing this commit. Drives the env-aware "Execute on <conn>"
   * label on the footer's `<ExecuteButton>`. Optional so legacy callers
   * (no env plumbed) keep the plain "Execute" label.
   */
  connectionLabel?: string | null;
  migrationImpact?: MigrationImpactSummary | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function SqlPreviewDialog({
  sql,
  loading,
  error,
  commitError,
  environment = null,
  connectionLabel = null,
  migrationImpact = null,
  onConfirm,
  onCancel,
}: SqlPreviewDialogProps) {
  const { t } = useTranslation("structure");
  return (
    <PreviewDialog
      title={t("sqlPreview.title")}
      description={t("sqlPreview.description")}
      className="w-dialog-md bg-secondary"
      // Sprint 252: Surface header Copy button. PreviewCopyButton self-
      // suppresses on empty/whitespace, so a stub `sql=""` keeps the
      // button hidden and existing AC-109 markup unchanged.
      copyText={sql}
      copyAriaLabel={t("sqlPreview.copyAria")}
      preview={
        <>
          <SchemaGraphMigrationImpactSummary impact={migrationImpact} />
          <pre className="max-h-scroll-lg overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs font-mono text-foreground">
            {sql.trim() ? (
              <SqlSyntax sql={sql} />
            ) : (
              <span className="italic text-muted-foreground">
                {t("sqlPreview.noChanges")}
              </span>
            )}
          </pre>
        </>
      }
      error={error}
      commitError={commitError ?? null}
      loading={loading}
      confirmDisabled={!sql.trim()}
      onConfirm={onConfirm}
      onCancel={onCancel}
      confirmButton={
        <ExecuteButton
          severity="warn"
          environment={environment}
          connectionLabel={connectionLabel}
          loading={loading}
          disabled={!sql.trim()}
          onClick={onConfirm}
        />
      }
    />
  );
}
