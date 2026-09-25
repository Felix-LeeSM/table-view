import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MqlPreviewModal, { type MqlPreviewModalProps } from "./MqlPreviewModal";

function renderModal(overrides: Partial<MqlPreviewModalProps> = {}) {
  const props: MqlPreviewModalProps = {
    previewLines: [
      'db.users.updateOne({ _id: ObjectId("507f1f77bcf86cd799439011") }, { $set: { name: "Ada" } })',
      'db.users.deleteOne({ _id: ObjectId("507f1f77bcf86cd799439022") })',
    ],
    errors: [],
    onExecute: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<MqlPreviewModal {...props} />) };
}

describe("MqlPreviewModal", () => {
  it("renders every preview line inside the MQL code block", () => {
    renderModal();

    const block = screen.getByLabelText("MQL commands");
    expect(block).toBeInTheDocument();
    expect(block.textContent).toContain(
      'db.users.updateOne({ _id: ObjectId("507f1f77bcf86cd799439011") }, { $set: { name: "Ada" } })',
    );
    expect(block.textContent).toContain(
      'db.users.deleteOne({ _id: ObjectId("507f1f77bcf86cd799439022") })',
    );
  });

  it("warns that multiple ordered document writes may partially commit", () => {
    renderModal();

    const warning = screen.getByLabelText("MongoDB ordered bulk write warning");
    expect(warning).toHaveTextContent("2 ordered document writes");
    expect(warning).toHaveTextContent(
      "earlier writes may already be committed",
    );
  });

  it("keeps the ordered partial-commit warning when a commit error is rendered", () => {
    renderModal({
      commitError: {
        statementIndex: 1,
        statementCount: 2,
        sql: 'db.users.deleteOne({ _id: ObjectId("507f1f77bcf86cd799439022") })',
        message:
          "Commit failed. MongoDB bulk writes are ordered but not transactional; earlier document writes may already be committed.",
      },
    });

    expect(
      screen.getByLabelText("MongoDB ordered bulk write warning"),
    ).toHaveTextContent("pending edits stay available for retry");
    const commitError = screen.getByTestId("sql-preview-commit-error");
    expect(commitError).toHaveTextContent("failed at: 2 of 2");
    expect(commitError).toHaveTextContent(
      "earlier document writes may already be committed",
    );
  });

  it("renders the errors list when the preview reports per-row failures", () => {
    renderModal({
      errors: [
        { row: 3, message: "missing or unsupported _id" },
        { row: 5, message: "nested meta is not editable" },
      ],
    });

    const list = screen.getByLabelText("MQL generation errors");
    expect(list).toBeInTheDocument();
    // #PAR-2 — paradigm-correct wording: "document N:" prefix, "N documents
    // skipped" header.
    expect(list.textContent).toContain(
      "document 3: missing or unsupported _id",
    );
    expect(list.textContent).toContain(
      "document 5: nested meta is not editable",
    );
    // "2 documents skipped:" header reflects the plural form.
    expect(list.textContent).toContain("2 documents skipped");
  });

  it("invokes onExecute when the Execute button is clicked", () => {
    const onExecute = vi.fn();
    renderModal({ onExecute });

    fireEvent.click(
      screen.getByRole("button", { name: "Execute MQL commands" }),
    );

    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  it("invokes onCancel when the Cancel button is clicked", () => {
    const onCancel = vi.fn();
    renderModal({ onCancel });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables the Execute button when no preview lines are generated", () => {
    renderModal({ previewLines: [] });

    const execute = screen.getByRole("button", {
      name: "Execute MQL commands",
    });
    expect(execute).toBeDisabled();
  });

  it("disables the Execute button and shows the spinner when loading", () => {
    renderModal({ loading: true });

    const execute = screen.getByRole("button", {
      name: "Execute MQL commands",
    });
    expect(execute).toBeDisabled();
    expect(execute.textContent).toContain("Executing");
  });

  it("triggers onExecute when Enter is pressed outside an input", () => {
    const onExecute = vi.fn();
    renderModal({ onExecute });

    const pre = screen.getByLabelText("MQL commands");
    fireEvent.keyDown(pre, { key: "Enter" });

    expect(onExecute).toHaveBeenCalledTimes(1);
  });

  // AC-256-05 — env-aware ExecuteButton with a staging connection. The
  // background renders via the warning token; the label includes the
  // connection name to anchor the dispatch target.
  it("[AC-256-05] env=staging + connectionLabel renders 'Execute on <conn>' with warning token", () => {
    renderModal({ environment: "staging", connectionLabel: "stage-mongo" });
    const btn = screen.getByRole("button", { name: "Execute MQL commands" });
    expect(btn.getAttribute("data-severity-env")).toBe("warn:staging");
    expect(btn.getAttribute("style")).toMatch(/--tv-warning\)/);
    expect(btn.textContent).toContain("Execute on stage-mongo");
  });

  // Reason: user report — a long single-line query containing spaces broke
  // the layout by overflowing the dialog horizontally. The preview <pre>'s
  // wrap classes do nothing unless the ancestor flex column carries
  // min-w-0 (a grid/flex item's min-width:auto grows the track). jsdom
  // cannot measure layout, so the regression is pinned as a contract on
  // the wrapping affordance classes.
  it("gives the preview block wrap affordances and a min-w-0 ancestor so long lines cannot overflow", () => {
    renderModal({
      previewLines: [
        'db.sales_orders.updateOne({ _id: "709456c0-bec5-4632-8c4a-6554e9eb17d9" }, { $set: { "items.0.a": 3 } })',
      ],
    });

    const pre = screen.getByLabelText("MQL commands");
    expect(pre).toHaveClass("whitespace-pre-wrap");
    expect(pre).toHaveClass("break-all");
    // Only a min-w-0 ancestor flex column constrains the pre's width, which
    // is what makes it wrap.
    expect(pre.parentElement).toHaveClass("min-w-0");
  });
});
