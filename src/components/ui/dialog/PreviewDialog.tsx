import { type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogTone,
} from "@components/ui/dialog";
import { Button } from "@components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Sprint-96 Layer 2 — `PreviewDialog` preset
//
// Title + read-only preview body + optional confirm/cancel footer. Wraps
// the SQL/MQL/Cell/Blob viewer pattern. The preset deliberately does NOT
// own the rendering of the preview body itself — callers pass either the
// already-formatted ReactNode via `preview` or arbitrary `children`. This
// keeps it usable for: SQL preview (`<pre>` of generated DDL), MQL preview
// (lines of `db.coll.x()`), CellDetailDialog (formatted text + char count
// row), and read-only viewers in general.
//
// Sprint-93 commit-error preservation:
//   - `commitError` is a structured prop (see `SqlPreviewCommitError`) that
//     renders the destructive banner with `role="alert"` +
//     `aria-live="assertive"` + the "executed: N, failed at: K of M" line +
//     raw failed SQL. The contract from sprint-93 is preserved verbatim so
//     the regression tests for that banner keep working without changes.
//
// Footer:
//   - When `onConfirm` is supplied the footer renders confirm + cancel
//     buttons. Otherwise (pure read-only viewer) the footer is omitted and
//     the absolute X button is the only dismiss affordance.
// ---------------------------------------------------------------------------

export interface PreviewDialogCommitError {
  statementIndex: number;
  statementCount: number;
  sql: string;
  message: string;
}

export interface PreviewDialogProps {
  title: ReactNode;
  description?: ReactNode;
  /**
   * Preview body. Either pass the formatted ReactNode here OR use `children`
   * — both are rendered, in that order. Callers typically use one of them.
   */
  preview?: ReactNode;
  children?: ReactNode;
  /** Generation-time error (e.g. SQL builder failure). Plain text banner. */
  error?: string | null;
  /**
   * Sprint-93 commit-time error. Distinct from `error`: this represents an
   * `executeQuery` rejection AFTER user confirm. Renders the destructive
   * banner with the partial-failure count + raw failing SQL.
   */
  commitError?: PreviewDialogCommitError | null;
  /** Disables the confirm button while in flight. */
  loading?: boolean;
  /** When false, the confirm button is disabled (e.g. empty preview). */
  confirmDisabled?: boolean;
  /** Optional confirm action. When omitted the footer is not rendered. */
  onConfirm?: () => void;
  /** Required cancel/close handler. */
  onCancel: () => void;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  /** Forwarded tone — `destructive` swaps the outer border. */
  tone?: DialogTone;
  /** Forwarded `className` for `DialogContent`. */
  className?: string;
  /** Optional aria-label for the confirm button. */
  confirmAriaLabel?: string;
}

export default function PreviewDialog({
  title,
  description,
  preview,
  children,
  error = null,
  commitError = null,
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  className,
  confirmAriaLabel,
}: PreviewDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !loading) onCancel();
      }}
    >
      <DialogContent className={cn(className)} tone={tone}>
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-foreground">
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription className="text-xs text-muted-foreground">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {preview}
          {children}

          {error ? (
            <div
              role="alert"
              className="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          ) : null}

          {commitError ? (
            // Sprint-93 contract preserved verbatim. The wrapping classes,
            // `role`, `aria-live`, and `data-testid` are reused by existing
            // regression tests.
            <div
              role="alert"
              aria-live="assertive"
              className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
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
          ) : null}
        </div>

        {onConfirm ? (
          <DialogFooter className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={loading}
            >
              {cancelLabel}
            </Button>
            <Button
              variant={tone === "destructive" ? "destructive" : "default"}
              size="sm"
              onClick={onConfirm}
              disabled={loading || confirmDisabled}
              aria-label={confirmAriaLabel}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
