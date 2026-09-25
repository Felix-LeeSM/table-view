import PreviewDialog from "@components/ui/dialog/PreviewDialog";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

  // Reason: user report — when commitError.message carries a KB-sized hex
  // dump with no spaces (server response: Some(RawDocumentBuf { data:
  // "24040000106e00..." })), break-words (overflow-wrap:break-word) finds no
  // break opportunity, cannot wrap, and punches through the dialog
  // horizontally. break-all + a min-w-0 ancestor force the wrap. jsdom does
  // not measure layout, so the regression is pinned by the wrapping-affordance
  // class contract (fix/mql-preview-overflow, 2026-07-18).
  it("wraps an unbreakable long commitError.message so it cannot overflow the dialog", () => {
    const hex = `24040000106e0000${"a".repeat(2000)}`; // one token, no spaces
    render(
      <PreviewDialog
        title="Review SQL"
        preview={<pre>UPDATE 1</pre>}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmLabel="Execute"
        commitError={{
          statementIndex: 0,
          statementCount: 1,
          sql: "UPDATE 1",
          message: hex,
        }}
      />,
    );

    const banner = screen.getByTestId("sql-preview-commit-error");
    const messageEl = screen.getByText(hex);
    // break-words can't wrap hex with no break opportunity → needs break-all.
    expect(messageEl).toHaveClass("break-all");
    expect(messageEl).not.toHaveClass("break-words");
    // The ancestor content wrapper needs min-w-0 + max-w-full so the grid
    // track does not overflow and the child wraps — and the dialog does not
    // widen horizontally to fit the content.
    expect(banner.parentElement).toHaveClass("min-w-0");
    expect(banner.parentElement).toHaveClass("max-w-full");
  });

  // Reason: user report — when long content widens the dialog horizontally,
  // the header's Copy button (shrink-0) gets pushed off to the right and
  // disappears. With the content width capped, this pins behaviorally that
  // the Copy button still renders in the header
  // (fix/mql-preview-overflow, 2026-07-18).
  it("keeps the header Copy button rendered even with long preview + commitError content", () => {
    const hex = `24040000106e0000${"a".repeat(2000)}`;
    render(
      <PreviewDialog
        title="Review SQL"
        preview={<pre>{"db.x.updateOne({ _id: 1 }, { $set: { a: 3 } })"}</pre>}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        confirmLabel="Execute"
        copyText="db.x.updateOne({ _id: 1 }, { $set: { a: 3 } })"
        copyAriaLabel="Copy MQL to clipboard"
        commitError={{
          statementIndex: 0,
          statementCount: 1,
          sql: "db.x.updateOne(...)",
          message: hex,
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Copy MQL to clipboard" }),
    ).toBeInTheDocument();
  });
});
