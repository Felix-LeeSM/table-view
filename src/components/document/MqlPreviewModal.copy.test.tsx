// Sprint 252 (2026-05-09) — MqlPreviewModal Copy 버튼 + plain fallback.
//
// Why: PreviewDialog 의 `copyText` prop 을 통해 MQL 미리보기에도 Copy 버튼
// 자동 등장. 동시에 SQL syntax highlighter (SqlSyntax) 는 적용하지 않고
// plain `<pre>` fallback 유지 — Mongo dialect 강조기 부재 때문.
// AC-252-07 의 "MQL-적합 강조 (또는 plain) 로 fall back 함" 의 plain
// 경로 채택 — 사용자에게 잘못된 SQL keyword 색이 표시되지 않도록.
//
// /tdd 흐름: 본 파일은 구현보다 먼저 작성됨. PreviewDialog Copy 구현이
// 끝나면 1줄 `copyText={previewLines.join("\n")}` 추가 만으로 통과.
//
// Maps:
// - AC-252-02 / AC-252-07 → "Copy carrier 호출 + plain fallback"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import MqlPreviewModal from "@components/document/MqlPreviewModal";

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
