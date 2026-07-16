import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDryRun } from "@hooks/useDryRun";

/**
 * Sprint 247 (ADR 0022 Phase 3) — preview pane mounted inside
 * `<ConfirmDestructiveDialog>`. Shows the result of a dry-run
 * (`BEGIN; <statements>; ROLLBACK;`) so the user sees per-statement
 * `rows_affected` BEFORE approving the actual commit.
 *
 * State branches:
 *   - `running`   → spinner + "Running dry-run...".
 *   - `success`   → list of `<rows_affected> rows affected (<ms>ms)`
 *                   per statement.
 *   - `error`     → destructive-toned text-block with the verbatim
 *                   backend error (typically the canonical `"statement
 *                   K of N failed: <msg>"` shape so preview and commit
 *                   error copy match 1:1).
 *   - `unsupported` → grey disclaimer.
 *   - `idle`      → empty (dialog closed, no IPC fired).
 *
 * The component does not read or write any global store; it is
 * stateless apart from the `useDryRun` hook. Mount/unmount lifecycle
 * via the dialog's `open` prop drives the IPC call (hook's `enabled`
 * arg). When `open=false` the hook short-circuits to `idle` without
 * invoking IPC — verified by [AC-247-D11].
 */
export interface DryRunPreviewProps {
  connectionId: string;
  statements: string[];
  paradigm: "rdb" | "document" | "kv" | "search";
  /** Mirror the dialog's `open` so the hook gates IPC on dialog mount. */
  open: boolean;
}

export default function DryRunPreview({
  connectionId,
  statements,
  paradigm,
  open,
}: DryRunPreviewProps) {
  const { t } = useTranslation("workspace");
  const state = useDryRun({
    connectionId,
    statements,
    paradigm,
    // Non-RDB paradigms surface `unsupported`; only rdb can dry-run.
    enabled: open && paradigm === "rdb",
  });

  return (
    <section
      aria-label={t("dryRun.sectionAria")}
      data-testid="dry-run-status"
      data-status={state.status}
      // #1137 — per-branch live roles: status for running/success/unsupported,
      // alert for real errors; busy while the dry-run is in flight.
      aria-busy={state.status === "running" || undefined}
      className="rounded-md border border-dashed border-border bg-background/40 p-2 text-xs text-muted-foreground"
    >
      {state.status === "running" && (
        <div className="flex items-center gap-2" role="status">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          <span>{t("dryRun.running")}</span>
        </div>
      )}

      {state.status === "success" && state.results !== null && (
        <ul className="space-y-1" role="status">
          {state.results.map((r, idx) => (
            <li
              key={idx}
              data-testid={`dry-run-result-row-${idx}`}
              className="font-mono text-3xs text-foreground"
            >
              {t("dryRun.rowResult", {
                idx: idx + 1,
                total: state.results!.length,
                count: r.totalCount,
                ms: r.executionTimeMs,
              })}
            </li>
          ))}
        </ul>
      )}

      {state.status === "error" && (
        <p
          role="alert"
          data-testid="dry-run-error-message"
          className="whitespace-pre-wrap break-words font-mono text-3xs text-destructive"
        >
          {state.error ?? t("dryRun.failed")}
        </p>
      )}

      {state.status === "unsupported" && (
        <p className="italic" role="status">
          {t("dryRun.unsupported")}
        </p>
      )}

      {state.status === "idle" && (
        <span className="sr-only">{t("dryRun.idle")}</span>
      )}
    </section>
  );
}
