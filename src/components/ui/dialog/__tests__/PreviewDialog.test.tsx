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

  // Reason: 사용자 보고 — commitError.message 에 공백 없는 KB급 hex 덤프
  // (server response: Some(RawDocumentBuf { data: "24040000106e00..." }))가
  // 오면 break-words(overflow-wrap:break-word)는 break opportunity 가 없어
  // wrap 하지 못하고 다이얼로그를 가로로 뚫는다. break-all + min-w-0 조상으로
  // wrap 을 강제한다. jsdom 은 레이아웃 미측정이라 wrapping affordance 클래스
  // 계약으로 회귀 고정 (fix/mql-preview-overflow, 2026-07-18).
  it("wraps an unbreakable long commitError.message so it cannot overflow the dialog", () => {
    const hex = `24040000106e0000${"a".repeat(2000)}`; // 공백 없는 단일 토큰
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
    // break-words 는 break opportunity 없는 hex 를 못 감쌈 → break-all 필수.
    expect(messageEl).toHaveClass("break-all");
    expect(messageEl).not.toHaveClass("break-words");
    // 조상 content 래퍼가 min-w-0 + max-w-full 이어야 grid 트랙이 넘치지 않고
    // 자식이 wrap — 동시에 다이얼로그가 콘텐츠로 가로 확장되지 않는다.
    expect(banner.parentElement).toHaveClass("min-w-0");
    expect(banner.parentElement).toHaveClass("max-w-full");
  });

  // Reason: 사용자 보고 — 긴 콘텐츠가 다이얼로그를 가로로 확장하면 헤더의
  // 복사 버튼(shrink-0)이 오른쪽으로 밀려 사라진다. content 폭 상한 고정 후
  // 복사 버튼이 헤더에 그대로 렌더되는지를 behavioral 로 고정
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
