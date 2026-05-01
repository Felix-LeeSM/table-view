// AC-186-03 — ConfirmDangerousDialog component tests. 5 cases per Sprint 186 contract.
// date 2026-05-01.
//
// The dialog gates the warn-tier of Safe Mode: the destructive Confirm
// button is disabled until the user types the analyzer's reason string
// verbatim. Enter key submits when matched; Escape (radix default) cancels.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ConfirmDangerousDialog from "./ConfirmDangerousDialog";

const REASON = "DELETE without WHERE clause";
const SQL = "DELETE FROM users";

describe("ConfirmDangerousDialog", () => {
  it("[AC-186-03a] Confirm disabled when input empty", () => {
    render(
      <ConfirmDangerousDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirm = screen.getByRole("button", { name: "Run anyway" });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-disabled", "true");
  });

  it("[AC-186-03b] Confirm enabled when input matches reason exactly (with trim)", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDangerousDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByTestId("confirm-dangerous-input");
    await user.type(input, `  ${REASON}  `);
    const confirm = screen.getByRole("button", { name: "Run anyway" });
    expect(confirm).not.toBeDisabled();
  });

  it("[AC-186-03c] Confirm click invokes onConfirm", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDangerousDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await user.type(screen.getByTestId("confirm-dangerous-input"), REASON);
    await user.click(screen.getByRole("button", { name: "Run anyway" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("[AC-186-03d] Cancel click invokes onCancel", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDangerousDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("[AC-186-03e] mismatch after match re-disables Confirm", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDangerousDialog
        open={true}
        reason={REASON}
        sqlPreview={SQL}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const input = screen.getByTestId("confirm-dangerous-input");
    await user.type(input, REASON);
    const confirm = screen.getByRole("button", { name: "Run anyway" });
    expect(confirm).not.toBeDisabled();
    await user.type(input, "x");
    expect(confirm).toBeDisabled();
  });
});
