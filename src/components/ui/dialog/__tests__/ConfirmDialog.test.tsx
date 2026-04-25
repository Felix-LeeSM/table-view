import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ConfirmDialog from "@components/ui/dialog/ConfirmDialog";

describe("ConfirmDialog (sprint-96 preset)", () => {
  it("renders title + message + confirm/cancel buttons", () => {
    render(
      <ConfirmDialog
        title="Delete connection?"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Delete connection?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("forwards danger=true to AlertDialogContent tone (sprint-95 AC-05)", () => {
    render(
      <ConfirmDialog
        title="Drop"
        message="Confirm"
        confirmLabel="Drop"
        danger
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const content = document.querySelector(
      '[data-slot="alert-dialog-content"]',
    ) as HTMLElement;
    expect(content.getAttribute("data-tone")).toBe("destructive");
    expect(content.className).toContain("border-destructive");
  });

  it("invokes onConfirm/onCancel from button clicks", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="t"
        message="m"
        confirmLabel="OK"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons + relabels confirm to Processing... when loading", () => {
    render(
      <ConfirmDialog
        title="t"
        message="m"
        confirmLabel="OK"
        loading
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    // aria-label is `confirmLabel` ("OK"); visible text is "Processing..."
    const confirmBtn = screen.getByRole("button", { name: "OK" });
    expect(confirmBtn).toBeDisabled();
    expect(confirmBtn.textContent).toBe("Processing...");
  });
});
