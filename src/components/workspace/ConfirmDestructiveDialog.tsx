import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@components/ui/alert-dialog";
import { Button } from "@components/ui/button";

/**
 * `ConfirmDestructiveDialog` — Sprint 246 (ADR 0022 Phase 2). Single
 * confirmation surface for any destructive statement that the
 * `decideSafeModeAction` matrix routes to `action: "confirm"` (DROP /
 * TRUNCATE / ALTER … DROP / WHERE-less DELETE/UPDATE / Mongo $out etc.).
 *
 * Supersedes the Sprint 186 dialog (type-to-confirm gate + `Run anyway`
 * button). ADR 0022 collapsed the warn-tier verbatim-typing
 * gate into a simple Yes/No because the destructive-only matrix already
 * narrows the dialog to genuinely destructive statements; verbatim typing
 * added friction without measurable error reduction.
 *
 * Header is environment-aware:
 *   - `environment="production"` → title `"PRODUCTION DATABASE"` +
 *     subcaption `"Destructive statement"`.
 *   - `environment="non-production"` → title `"Destructive statement"` +
 *     subcaption `"Safe Mode (strict) — non-production"` (the only
 *     non-prod path that reaches this dialog is the M.1 strict flow).
 *
 * The dry-run preview placeholder is rendered as a `<section
 * aria-label="Dry-run preview" data-testid="dry-run-placeholder">` so
 * Phase 3 (Sprint 247) can swap the static copy for a real diff/affected-
 * rows view without changing the dialog API.
 */
export interface ConfirmDestructiveDialogProps {
  open: boolean;
  reason: string;
  sqlPreview: string;
  /**
   * Connection environment, derived by callers from
   * `useConnectionStore`. `production` ⇔ `connection.environment ===
   * "production"`, every other tag (`local` / `testing` /
   * `development` / `staging` / `null`) maps to `"non-production"`.
   */
  environment: "production" | "non-production";
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDestructiveDialog({
  open,
  reason,
  sqlPreview,
  environment,
  onConfirm,
  onCancel,
}: ConfirmDestructiveDialogProps) {
  const isProduction = environment === "production";
  const title = isProduction ? "PRODUCTION DATABASE" : "Destructive statement";
  const subcaption = isProduction
    ? "Destructive statement"
    : "Safe Mode (strict) — non-production";

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent
        className="w-[28rem]"
        tone="destructive"
        // Enter on the dialog itself submits — matches the keystroke
        // that the prior type-to-confirm input listened on, so users
        // who muscle-memory'd Enter still get the confirm-on-Enter
        // affordance.
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onConfirm();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{subcaption}</AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm text-foreground">
          Reason: <span className="font-semibold">{reason}</span>
        </p>
        <pre
          className="max-h-32 overflow-auto rounded-md bg-muted p-2 font-mono text-xs text-muted-foreground"
          aria-label="Statement preview"
        >
          {sqlPreview}
        </pre>
        <section
          aria-label="Dry-run preview"
          data-testid="dry-run-placeholder"
          className="rounded-md border border-dashed border-border bg-background/40 p-2 text-xs italic text-muted-foreground"
        >
          Dry-run preview will appear here (Phase 3).
        </section>
        <AlertDialogFooter className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            data-testid="confirm-destructive-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            data-testid="confirm-destructive-confirm"
            autoFocus
          >
            Confirm
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
