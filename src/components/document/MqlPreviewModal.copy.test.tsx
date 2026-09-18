// MqlPreviewModal Copy button + plain fallback.
//
// Why: PreviewDialog's `copyText` prop brings the Copy button to the MQL
// preview too. The SQL syntax highlighter (SqlSyntax) is deliberately not
// applied; the plain `<pre>` fallback stays because no Mongo dialect
// highlighter exists. This takes the plain path of AC-252-07's "falls back
// to MQL-appropriate highlighting (or plain)" so the user is never shown
// wrong SQL keyword colors.
//
// Maps:
// - AC-252-02 / AC-252-07 → "Copy carrier call + plain fallback"

import MqlPreviewModal from "@components/document/MqlPreviewModal";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function installClipboard(impl: (text: string) => Promise<void>) {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe("MqlPreviewModal Copy + plain fallback (sprint-252)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  it("AC-252-07: MQL body has NO SQL syntax keyword markers (plain fallback)", () => {
    render(
      <MqlPreviewModal
        previewLines={[
          'db.users.updateOne({ _id: ObjectId("507f") }, { $set: { name: "Ada" } })',
        ]}
        errors={[]}
        onExecute={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog");
    // Plain `<pre>` fallback — SqlSyntax keyword spans must NOT appear in
    // MQL body. (The MQL `db.users.updateOne` text would otherwise be
    // misinterpreted by the SQL tokenizer.)
    const keywordSpans = dialog.querySelectorAll("span.text-syntax-keyword");
    expect(keywordSpans.length).toBe(0);

    // Existing aria-label preserved.
    expect(screen.getByLabelText("MQL commands")).toBeInTheDocument();
  });

  it("AC-252-02: clicking Copy button writes joined preview lines to clipboard", async () => {
    const writeText = installClipboard(() => Promise.resolve());
    const lines = [
      'db.users.updateOne({ _id: ObjectId("507f") }, { $set: { name: "Ada" } })',
      'db.users.deleteOne({ _id: ObjectId("aaaa") })',
    ];

    render(
      <MqlPreviewModal
        previewLines={lines}
        errors={[]}
        onExecute={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const btn = screen.getByTestId("preview-dialog-copy");
    expect(btn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(lines.join("\n"));
  });

  it("AC-252-04: empty previewLines → Copy button NOT rendered", () => {
    render(
      <MqlPreviewModal
        previewLines={[]}
        errors={[]}
        onExecute={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("preview-dialog-copy")).toBeNull();
  });
});
