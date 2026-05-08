// AC-246-D1..D7 — ConfirmDestructiveDialog component tests. 7 cases per
// Sprint 246 (ADR 0022 Phase 2) contract.
// AC-247-D8..D11 — Sprint 247 dry-run preview integration. 4 new cases.
// date 2026-05-08 / 2026-05-09.
//
// The dialog replaces Sprint 186's `prior dialog` (type-to-
// confirm + `Run anyway`). Phase 2 collapses the warn-tier verbatim-
// typing gate into a simple Yes/No — the destructive-only policy
// matrix in `decideSafeModeAction` already filters non-destructive
// statements upstream, so verbatim typing added friction without a
// measurable safety bar. The header is environment-aware (production
// shouts "PRODUCTION DATABASE"; non-production reads as "Destructive
// statement" with the strict-mode subcaption) so the user instantly
// sees which axis of the safety matrix triggered the dialog.
//
// Sprint 247 (ADR 0022 Phase 3) — the placeholder slot is replaced by
// `<DryRunPreview>` which calls `executeQueryDryRun`. The dialog
// itself remains UI-only; the dry-run lifecycle tests live in
// useDryRun.test.ts. Here we verify the dialog wires the IPC mock
// correctly: success row, error message, document disclaimer, and
// IPC-not-called when `open=false`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ConfirmDestructiveDialog from "./ConfirmDestructiveDialog";

// Mock the entire @lib/tauri barrel so the `useDryRun` hook (consumed by
// `<DryRunPreview>`) sees a controllable IPC stub. We deliberately mock
// at the module surface — the hook imports both `executeQueryDryRun` and
// `cancelQuery` from `@lib/tauri`, so the dialog tree is fully isolated.
const executeQueryDryRunMock = vi.fn();
const cancelQueryMock = vi.fn();

vi.mock("@lib/tauri", () => ({
  executeQueryDryRun: (...args: unknown[]) => executeQueryDryRunMock(...args),
  cancelQuery: (...args: unknown[]) => cancelQueryMock(...args),
}));

const REASON = "DELETE without WHERE clause";
const SQL = "DELETE FROM users";

describe("ConfirmDestructiveDialog", () => {
  beforeEach(() => {
    executeQueryDryRunMock.mockReset();
    cancelQueryMock.mockReset();
    cancelQueryMock.mockResolvedValue("cancelled");
    // Default resolve-once with empty result so existing AC-246 cases
    // don't depend on dry-run state — they only assert dialog UI.
    executeQueryDryRunMock.mockResolvedValue([]);
  });

  it("[AC-246-D1] environment=\"production\" renders 'PRODUCTION DATABASE' header", () => {
    render(
      <ConfirmDestructiveDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        environment="production"
        connectionId="c"
        statements={[]}
        paradigm="rdb"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // Title shouts the environment so the user notices instantly.
    expect(screen.getByText("PRODUCTION DATABASE")).toBeInTheDocument();
    // Subcaption documents the dialog reason taxonomy.
    expect(screen.getByText("Destructive statement")).toBeInTheDocument();
  });

  it("[AC-246-D2] environment=\"non-production\" renders 'Destructive statement' + 'Safe Mode (strict)' subcaption", () => {
    render(
      <ConfirmDestructiveDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        environment="non-production"
        connectionId="c"
        statements={[]}
        paradigm="rdb"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Destructive statement")).toBeInTheDocument();
    expect(screen.getByText(/Safe Mode \(strict\)/)).toBeInTheDocument();
  });

  it("[AC-246-D3] Confirm button initially enabled (type-to-confirm removed)", () => {
    render(
      <ConfirmDestructiveDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        environment="production"
        connectionId="c"
        statements={[]}
        paradigm="rdb"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm).not.toBeDisabled();
  });

  it("[AC-246-D4] Confirm click invokes onConfirm exactly once", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDestructiveDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        environment="production"
        connectionId="c"
        statements={[]}
        paradigm="rdb"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("confirm-destructive-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("[AC-246-D5] Cancel click invokes onCancel exactly once", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDestructiveDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        environment="production"
        connectionId="c"
        statements={[]}
        paradigm="rdb"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByTestId("confirm-destructive-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("[AC-246-D6] Enter key on dialog invokes onConfirm exactly once", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDestructiveDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        environment="production"
        connectionId="c"
        statements={[]}
        paradigm="rdb"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    // The dialog's content listens on the AlertDialogContent root, so we
    // dispatch keydown there. There is no input field anymore — the user
    // muscle-memory of "Enter to submit" still works because the dialog
    // is autoFocused on the Confirm button.
    const dialog = screen.getByRole("alertdialog");
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("[AC-246-D7] dry-run preview section is rendered (Phase 3 mounts <DryRunPreview>)", () => {
    // Sprint 247 — placeholder testid is gone; the slot now renders
    // `<DryRunPreview>` with `data-testid="dry-run-status"`. With
    // `statements=[]` the hook surfaces an `error` status (programmer
    // error guard), but the section itself is still present and
    // labeled.
    render(
      <ConfirmDestructiveDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        environment="production"
        connectionId="c"
        statements={[]}
        paradigm="rdb"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const preview = screen.getByTestId("dry-run-status");
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveAccessibleName("Dry-run preview");
  });

  // ── Sprint 247 (ADR 0022 Phase 3) — dry-run preview integration ──

  it('[AC-247-D8] paradigm="rdb" + dry-run success → dry-run-result-row-0 shows rows_affected', async () => {
    executeQueryDryRunMock.mockResolvedValueOnce([
      {
        columns: [],
        rows: [],
        total_count: 5,
        execution_time_ms: 12,
        query_type: { dml: { rows_affected: 5 } },
      },
    ]);
    render(
      <ConfirmDestructiveDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        environment="production"
        connectionId="c"
        statements={[SQL]}
        paradigm="rdb"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("dry-run-result-row-0")).toBeInTheDocument();
    });
    const row = screen.getByTestId("dry-run-result-row-0");
    expect(row.textContent).toMatch(/5 rows affected/);
    expect(row.textContent).toMatch(/12ms/);
    // IPC actually fired with the expected payload.
    expect(executeQueryDryRunMock).toHaveBeenCalledTimes(1);
    expect(executeQueryDryRunMock).toHaveBeenCalledWith(
      "c",
      [SQL],
      expect.stringMatching(/^dry:/),
    );
  });

  it('[AC-247-D9] paradigm="rdb" + dry-run failure → dry-run-error-message shows verbatim error', async () => {
    executeQueryDryRunMock.mockRejectedValueOnce(
      new Error('statement 1 of 1 failed: relation "users" does not exist'),
    );
    render(
      <ConfirmDestructiveDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        environment="production"
        connectionId="c"
        statements={[SQL]}
        paradigm="rdb"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("dry-run-error-message")).toBeInTheDocument();
    });
    const errMsg = screen.getByTestId("dry-run-error-message");
    expect(errMsg.textContent).toMatch(/statement 1 of 1 failed/);
    expect(errMsg.textContent).toMatch(/relation .users. does not exist/);
  });

  it('[AC-247-D10] paradigm="document" → data-status="unsupported" + IPC not called', () => {
    render(
      <ConfirmDestructiveDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        environment="production"
        connectionId="c"
        statements={["{ pipeline: [] }"]}
        paradigm="document"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const status = screen.getByTestId("dry-run-status");
    expect(status).toHaveAttribute("data-status", "unsupported");
    expect(status.textContent).toMatch(/Dry-run not supported/);
    expect(executeQueryDryRunMock).not.toHaveBeenCalled();
  });

  it("[AC-247-D11] open=false → IPC not called", () => {
    render(
      <ConfirmDestructiveDialog
        open={false}
        reason={REASON}
        sqlPreview={SQL}
        environment="production"
        connectionId="c"
        statements={[SQL]}
        paradigm="rdb"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(executeQueryDryRunMock).not.toHaveBeenCalled();
  });
});
