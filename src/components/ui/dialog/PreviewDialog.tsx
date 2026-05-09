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
import PreviewCopyButton from "@components/ui/dialog/PreviewCopyButton";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// `PreviewDialog` preset (Layer 2). Title + read-only preview body +
// optional confirm/cancel footer. Used for SQL/MQL/Cell/Blob viewers.
// Caller passes the formatted body via `preview` or `children`.
//
// `commitError` (structured) renders the destructive banner with
// `role="alert"` + `aria-live="assertive"` + the
// "executed: N, failed at: K of M" line + raw failed SQL.
//
// When `onConfirm` is supplied the footer renders confirm + cancel buttons.
// Otherwise (pure read-only viewer) the footer is omitted and the absolute
// X button is the only dismiss affordance.
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
   * Commit-time error. Distinct from `error`: this represents an
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
  /**
   * Sprint 252: Optional clipboard payload. When defined AND non-empty
   * after `.trim()`, a Copy button renders on the right side of the
   * header (`data-testid="preview-dialog-copy"`). Empty/whitespace or
   * undefined → button NOT rendered, preserving byte-identical output for
   * existing callers that have not opted in.
   */
  copyText?: string;
  /**
   * Sprint 252: Optional ARIA label override for the Copy button. Defaults
   * to "Copy". Provide a more specific label (e.g. "Copy SQL to clipboard")
   * when the surface benefits from screen-reader specificity.
   */
  copyAriaLabel?: string;
  /**
   * Sprint 256 (ADR 0023, AC-256-05) — optional override for the entire
   * confirm button. When provided, it replaces the default `<Button>`
   * footer affordance and must own its own `disabled` / `onClick`
   * wiring. The default Cancel button is still rendered. Used by
   * `SqlPreviewDialog` / `MqlPreviewModal` to plumb the env-aware
   * `<ExecuteButton>` without nesting buttons inside `confirmLabel`.
   */
  confirmButton?: ReactNode;
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
  copyText,
  copyAriaLabel,
  confirmButton,
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
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <DialogTitle className="text-sm font-semibold text-foreground">
                {title}
              </DialogTitle>
              {description ? (
                <DialogDescription className="text-xs text-muted-foreground">
                  {description}
                </DialogDescription>
              ) : null}
            </div>
            {copyText !== undefined ? (
              // PreviewCopyButton self-suppresses when `text.trim() === ""`,
              // so empty/whitespace copyText still renders nothing.
              <PreviewCopyButton
                text={copyText}
                ariaLabel={copyAriaLabel}
                className="shrink-0"
              />
            ) : null}
          </div>
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
            // Wrapping classes, `role`, `aria-live`, and `data-testid` are
            // load-bearing — regression tests pin to this exact structure.
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

        {onConfirm || confirmButton ? (
          <DialogFooter className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={loading}
            >
              {cancelLabel}
            </Button>
            {confirmButton ? (
              confirmButton
            ) : (
              <Button
                variant={tone === "destructive" ? "destructive" : "default"}
                size="sm"
                onClick={onConfirm}
                disabled={loading || confirmDisabled}
                aria-label={confirmAriaLabel}
              >
                {confirmLabel}
              </Button>
            )}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
