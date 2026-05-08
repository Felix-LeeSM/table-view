import { Loader2 } from "lucide-react";
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
 *   - `unsupported` → grey disclaimer "Dry-run not supported for this
 *                   connection (MongoDB).".
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
  paradigm: "rdb" | "document";
  /** Mirror the dialog's `open` so the hook gates IPC on dialog mount. */
  open: boolean;
}

export default function DryRunPreview({
  connectionId,
  statements,
  paradigm,
  open,
}: DryRunPreviewProps) {
  const state = useDryRun({
    connectionId,
    statements,
    paradigm,
    // paradigm="document" must surface `unsupported` even when the
    // dialog is closed (Mongo dialogs render the disclaimer
    // pre-mount). The hook handles that; here we only gate the rdb
    // IPC on `open`.
    enabled: open && paradigm === "rdb",
  });

  return (
    <section
      aria-label="Dry-run preview"
      data-testid="dry-run-status"
      data-status={state.status}
      className="rounded-md border border-dashed border-border bg-background/40 p-2 text-xs text-muted-foreground"
    >
      {state.status === "running" && (
        <div className="flex items-center gap-2">
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          <span>Running dry-run...</span>
        </div>
      )}

      {state.status === "success" && state.results !== null && (
        <ul className="space-y-1">
          {state.results.map((r, idx) => (
            <li
              key={idx}
              data-testid={`dry-run-result-row-${idx}`}
              className="font-mono text-3xs text-foreground"
            >
              statement {idx + 1} of {state.results!.length} — {r.total_count}{" "}
              rows affected ({r.execution_time_ms}ms)
            </li>
          ))}
        </ul>
      )}

      {state.status === "error" && (
        <p
          data-testid="dry-run-error-message"
          className="whitespace-pre-wrap break-words font-mono text-3xs text-destructive"
        >
          {state.error ?? "Dry-run failed"}
        </p>
      )}

      {state.status === "unsupported" && (
        <p className="italic">
          Dry-run not supported for this connection (MongoDB).
        </p>
      )}

      {state.status === "idle" && <span className="sr-only">Dry-run idle</span>}
    </section>
  );
}
