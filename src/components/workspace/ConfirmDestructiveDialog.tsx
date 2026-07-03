import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@components/ui/alert-dialog";
import { Button } from "@components/ui/button";
import ExecuteButton from "@components/ui/ExecuteButton";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import DryRunPreview from "./DryRunPreview";

// Issue #1111 (decision 2026-07-02) — the Confirm button stays disabled for
// a short window after the dialog opens so a reflexive Enter/click (fired
// right after the Cmd+Enter that triggered the dialog) is absorbed instead
// of confirming a DROP/TRUNCATE before the user reads it. When it arms, focus
// moves onto Confirm so the muscle-memory Enter still confirms — but Enter is
// only ever the focused button's native activation, never a dialog-wide
// handler (which would fire even with focus on Cancel). Cancel/Esc stay live.
const CONFIRM_ARM_DELAY_MS = 150;

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
   * Sprint 247 — paradigm gate. Non-RDB skips IPC entirely; `"rdb"`
   * invokes `execute_query_dry_run` while the dialog is open.
   */
  paradigm: "rdb" | "document" | "kv";
  /**
   * Sprint 256 (ADR 0023, AC-256-05) — connection display name for the
   * env-aware footer ExecuteButton ("Execute on <conn>"). Optional;
   * legacy callers default to the plain "Confirm" affordance via the
   * STOP-tier red regardless of connection identity.
   */
  connectionLabel?: string | null;
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
  connectionLabel = null,
  onConfirm,
  onCancel,
}: ConfirmDestructiveDialogProps) {
  const { t } = useTranslation("workspace");
  // Armed only after the dialog has been open for CONFIRM_ARM_DELAY_MS.
  const armed = useDelayedFlag(open, CONFIRM_ARM_DELAY_MS);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Once armed, move focus onto Confirm. During the arm window Confirm is
  // disabled so Radix parks focus elsewhere (Cancel/content); this hands it
  // back so the muscle-memory Enter lands on Confirm, not Cancel.
  useEffect(() => {
    if (armed) confirmRef.current?.focus();
  }, [armed]);
  const isProduction = environment === "production";
  const title = isProduction
    ? t("confirmDestructive.titleProduction")
    : t("confirmDestructive.titleNonProd");
  const subcaption = isProduction
    ? t("confirmDestructive.subcaptionProduction")
    : t("confirmDestructive.subcaptionNonProd");

  // Sprint 256 (AC-256-06) — production header binds to the env tokens
  // (`--tv-env-prod` / `-prod-text`) for visual gravity matching the
  // prod-only window border in `App.tsx`. Non-production headers keep
  // the muted-foreground appearance to honour the contract's
  // "비-prod 헤더는 회귀 0" invariant.
  const headerStyle = isProduction
    ? {
        backgroundColor: "var(--tv-env-prod)",
        color: "var(--tv-env-prod-text)",
      }
    : undefined;

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent className="w-[28rem]" tone="destructive">
        {/*
          No dialog-wide Enter handler (#1141): it fired onConfirm even when
          focus was on Cancel. Enter now only confirms via the Confirm
          button's native activation once it arms and receives focus; Cancel
          focus + Enter cancels, never confirms.
        */}
        <AlertDialogHeader
          className={
            isProduction ? "-mx-6 -mt-6 rounded-t-lg px-6 py-3" : undefined
          }
          style={headerStyle}
          data-environment-header={
            isProduction ? "production" : "non-production"
          }
        >
          <AlertDialogTitle
            style={
              isProduction ? { color: "var(--tv-env-prod-text)" } : undefined
            }
          >
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription
            style={
              isProduction ? { color: "var(--tv-env-prod-text)" } : undefined
            }
          >
            {subcaption}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="text-sm text-foreground">
          {t("confirmDestructive.reasonLabel")}{" "}
          <span className="font-semibold">{reason}</span>
        </p>
        <pre
          className="max-h-32 overflow-auto rounded-md bg-muted p-2 font-mono text-xs text-muted-foreground"
          aria-label={t("confirmDestructive.statementPreviewAria")}
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
            {t("confirmDestructive.cancel")}
          </Button>
          <ExecuteButton
            severity="danger"
            environment={isProduction ? "production" : null}
            connectionLabel={connectionLabel}
            loading={false}
            disabled={!armed}
            onClick={onConfirm}
            ariaLabel={t("confirmDestructive.confirmAria")}
            autoFocus
            ref={confirmRef}
            testId="confirm-destructive-confirm"
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
