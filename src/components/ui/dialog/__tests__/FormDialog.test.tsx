import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import FormDialog from "@components/ui/dialog/FormDialog";

describe("FormDialog (sprint-96 preset)", () => {
  it("renders title + description + body + submit/cancel footer", () => {
    render(
      <FormDialog
        title="New Group"
        description="Pick a name."
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitLabel="Create"
      >
        <input aria-label="name" />
      </FormDialog>,
    );

    expect(screen.getByText("New Group")).toBeInTheDocument();
    expect(screen.getByText("Pick a name.")).toBeInTheDocument();
    expect(screen.getByLabelText("name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("invokes onSubmit / onCancel from footer buttons", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(
      <FormDialog
        title="t"
        onSubmit={onSubmit}
        onCancel={onCancel}
        submitLabel="Save"
      >
        <span />
      </FormDialog>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons while isSubmitting=true", () => {
    render(
      <FormDialog title="t" isSubmitting onSubmit={vi.fn()} onCancel={vi.fn()}>
        <span />
      </FormDialog>,
    );

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("respects submitDisabled (e.g. blank required field)", () => {
    render(
      <FormDialog
        title="t"
        submitDisabled
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitLabel="Save"
      >
        <span />
      </FormDialog>,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).not.toBeDisabled();
  });

  it("renders a DialogFeedback slot when feedback prop is supplied", () => {
    render(
      <FormDialog
        title="t"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        feedback={{ state: "success", message: "Saved." }}
      >
        <span />
      </FormDialog>,
    );

    const slot = document.querySelector('[data-slot="dialog-feedback"]');
    expect(slot).not.toBeNull();
    expect(slot!.getAttribute("data-state")).toBe("success");
    const alert = slot!.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("Saved.");
  });

  it("forwards tone='destructive' to DialogContent", () => {
    render(
      <FormDialog
        title="t"
        tone="destructive"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      >
        <span />
      </FormDialog>,
    );

    const content = screen.getByRole("dialog");
    expect(content.getAttribute("data-tone")).toBe("destructive");
  });
});
