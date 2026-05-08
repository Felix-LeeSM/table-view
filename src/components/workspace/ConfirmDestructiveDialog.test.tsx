// AC-246-D1..D7 — ConfirmDestructiveDialog component tests. 7 cases per
// Sprint 246 (ADR 0022 Phase 2) contract.
// date 2026-05-08.
//
// The dialog replaces Sprint 186's `prior dialog` (type-to-
// confirm + `Run anyway`). Phase 2 collapses the warn-tier verbatim-
// typing gate into a simple Yes/No — the destructive-only policy
// matrix in `decideSafeModeAction` already filters non-destructive
// statements upstream, so verbatim typing added friction without a
// measurable safety bar. The header is environment-aware (production
// shouts "PRODUCTION DATABASE"; non-production reads as "Destructive
// statement" with the strict-mode subcaption) so the user instantly
// sees which axis of the safety matrix triggered the dialog. A
// `data-testid="dry-run-placeholder"` slot reserves the spot Phase 3
// (Sprint 247) will fill with the real `BEGIN; … ROLLBACK` preview.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ConfirmDestructiveDialog from "./ConfirmDestructiveDialog";

const REASON = "DELETE without WHERE clause";
const SQL = "DELETE FROM users";

describe("ConfirmDestructiveDialog", () => {
  it("[AC-246-D1] environment=\"production\" renders 'PRODUCTION DATABASE' header", () => {
    render(
      <ConfirmDestructiveDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        environment="production"
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

  it("[AC-246-D7] dry-run-placeholder section is rendered with Phase 3 copy", () => {
    render(
      <ConfirmDestructiveDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        environment="production"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const placeholder = screen.getByTestId("dry-run-placeholder");
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveAccessibleName("Dry-run preview");
    expect(placeholder.textContent).toMatch(/Phase 3/);
  });
});
