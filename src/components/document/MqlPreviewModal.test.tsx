import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("renders the errors list when the preview reports per-row failures", () => {
    renderModal({
      errors: [
        { row: 3, message: "missing or unsupported _id" },
        { row: 5, message: "nested meta is not editable" },
      ],
    });

    const list = screen.getByLabelText("MQL generation errors");
    expect(list).toBeInTheDocument();
    // Sprint 118 (#PAR-2) — paradigm-correct wording: "document N:" prefix,
    // "N documents skipped" header.
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
});
