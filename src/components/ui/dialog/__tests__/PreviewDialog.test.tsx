import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PreviewDialog from "@components/ui/dialog/PreviewDialog";

describe("PreviewDialog (sprint-96 preset)", () => {
  it("renders title + preview body and a confirm/cancel footer", () => {
    render(
      <PreviewDialog
        title="Review SQL"
        preview={<pre>SELECT 1</pre>}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmLabel="Execute"
      />,
    );

    expect(screen.getByText("Review SQL")).toBeInTheDocument();
    expect(screen.getByText("SELECT 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Execute" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("omits the footer when no onConfirm is provided (read-only viewer)", () => {
    render(
      <PreviewDialog
        title="Cell"
        preview={<span>val</span>}
        onCancel={vi.fn()}
      />,
    );

    // The absolute close X is always present from DialogContent.
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("invokes onConfirm / onCancel from footer buttons", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <PreviewDialog
        title="Review"
        preview={<span />}
        onConfirm={onConfirm}
        onCancel={onCancel}
        confirmLabel="Run"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders the generation-time error banner when error is set", () => {
    render(
      <PreviewDialog
        title="t"
        preview={<span />}
        error="Builder failure"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmLabel="Run"
      />,
    );

    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((a) => a.textContent?.includes("Builder failure"))).toBe(
      true,
    );
  });

  it("renders the sprint-93 commitError banner with executed/failed-at counts and raw SQL", () => {
    render(
      <PreviewDialog
        title="Review SQL"
        preview={<pre>UPDATE 1; UPDATE 2; UPDATE 3</pre>}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmLabel="Execute"
        commitError={{
          statementIndex: 1,
          statementCount: 3,
          sql: "UPDATE 2",
          message: "permission denied",
        }}
      />,
    );

    const banner = screen.getByTestId("sql-preview-commit-error");
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner.getAttribute("aria-live")).toBe("assertive");
    expect(banner.textContent).toContain("executed: 1");
    // statementIndex+1 = 2, of 3
    expect(banner.textContent).toContain("failed at: 2 of 3");
    expect(banner.textContent).toContain("permission denied");
    expect(banner.textContent).toContain("UPDATE 2");
  });

  it("disables confirm while loading and respects confirmDisabled", () => {
    const { rerender } = render(
      <PreviewDialog
        title="t"
        preview={<span />}
        loading
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmLabel="Run"
      />,
    );
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    rerender(
      <PreviewDialog
        title="t"
        preview={<span />}
        confirmDisabled
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmLabel="Run"
      />,
    );
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).not.toBeDisabled();
  });
});
