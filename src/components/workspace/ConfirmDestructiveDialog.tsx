import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@components/ui/alert-dialog";
import { Button } from "@components/ui/button";
import DryRunPreview from "./DryRunPreview";

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
 * Sprint 247 (ADR 0022 Phase 3) — the dry-run preview slot now mounts
 * `<DryRunPreview>` (was a static placeholder pre-247). Callers pass
 * `connectionId` / `statements` / `paradigm`; the inner hook fires
 * `execute_query_dry_run` IFF `open && paradigm === "rdb"`. Mongo
 * paradigm renders an `unsupported` disclaimer; closed dialog renders
 * the `idle` empty state.
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
  /**
   * Sprint 247 — connection id for the dry-run IPC. Passed verbatim
   * to `executeQueryDryRun` via `<DryRunPreview>`.
   */
  connectionId: string;
  /**
   * Sprint 247 — normalized statement batch for the dry-run preview.
   * Each caller's `pendingConfirm` shape (single sql / sqls array /
   * statements array / pipeline JSON) is normalized to `string[]` at
   * the call site so this dialog stays paradigm-agnostic.
   */
  statements: string[];
  /**
   * Sprint 247 — paradigm gate. `"document"` skips IPC entirely and
   * renders the Mongo disclaimer; `"rdb"` invokes
   * `execute_query_dry_run` while the dialog is open.
   */
  paradigm: "rdb" | "document";
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDestructiveDialog({
  open,
  reason,
  sqlPreview,
  environment,
  connectionId,
  statements,
  paradigm,
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
        <DryRunPreview
          connectionId={connectionId}
          statements={statements}
          paradigm={paradigm}
          open={open}
        />
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
