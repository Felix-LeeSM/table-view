/**
 * 작성 2026-05-17 (Phase 5 sprint-372 / AC-372-03 + AC-372-08).
 *
 * 사유: detail modal 은 redact-only display invariant 의 유일한 escape
 * hatch — modal mount 시점에 `get_history_detail(id)` IPC 가 호출되고,
 * 응답 `sql` 이 화면에 들어와야 한다. 본 테스트는 user flow path 의
 * 마지막 outcome (sql 텍스트가 보이는가) 까지 따라가서 lock.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import QueryHistoryDetailModal from "./QueryHistoryDetailModal";

describe("QueryHistoryDetailModal (sprint-372)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  // AC-372-03 — modal mount → get_history_detail(id) 1회 + sql display.
  // 작성 2026-05-17. 사유: list 응답에는 sql 이 없어 detail click 만이
  // 원문 노출 경로. invoke args + 응답 sql 의 DOM 도달을 모두 잠근다.
  it("[AC-372-03] mount calls get_history_detail and shows original sql", async () => {
    invokeMock.mockResolvedValueOnce({
      id: 7,
      source: "raw",
      sql: "SELECT * FROM users WHERE email = 'leak@example.com'",
      sqlRedacted: "SELECT * FROM users WHERE email = ?",
    });

    render(<QueryHistoryDetailModal id={7} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("query-history-detail-sql")).toHaveTextContent(
        "leak@example.com",
      );
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_history_detail", {
      req: { id: 7 },
    });

    // redacted 도 함께 표시.
    expect(
      screen.getByTestId("query-history-detail-sql-redacted"),
    ).toHaveTextContent("?");
  });

  // 로딩 indicator → fetch 응답 도착 시 사라짐.
  // 작성 2026-05-17. 사유: 사용자가 "Loading…" 텍스트가 일시 보이고
  // 곧 sql 로 대체되는 UX 시퀀스를 보장.
  it("shows loading then swaps to detail on resolve", async () => {
    let resolveFn: (v: unknown) => void = () => {};
    invokeMock.mockReturnValueOnce(
      new Promise((res) => {
        resolveFn = res;
      }),
    );

    render(<QueryHistoryDetailModal id={3} onClose={vi.fn()} />);

    expect(
      screen.getByTestId("query-history-detail-loading"),
    ).toBeInTheDocument();

    resolveFn({
      id: 3,
      source: "raw",
      sql: "SELECT 1",
      sqlRedacted: "SELECT 1",
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("query-history-detail-loading"),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("query-history-detail-sql")).toHaveTextContent(
      "SELECT 1",
    );
  });

  // backend NotFound → error path. modal 은 alert role 로 메시지 표시.
  // 작성 2026-05-17. 사유: detail row 가 race-deleted 되었을 때 user 가
  // 빈 화면이 아닌 진단 메시지를 본다.
  it("surfaces backend reject in an alert", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Not found: history 999"));

    render(<QueryHistoryDetailModal id={999} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Not found/);
    });
  });

  // close 버튼 → onClose 콜. parent 가 modal 을 unmount 하는 패턴.
  // 작성 2026-05-17. 사유: modal escape path 가 일관되게 동작.
  it("invokes onClose when Close button is clicked", async () => {
    invokeMock.mockResolvedValueOnce({
      id: 1,
      source: "raw",
      sql: "SELECT 1",
      sqlRedacted: "SELECT 1",
    });
    const onClose = vi.fn();
    render(<QueryHistoryDetailModal id={1} onClose={onClose} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("query-history-detail-sql"),
      ).toBeInTheDocument();
    });

    const closeBtn = screen.getByTestId("query-history-detail-close");
    closeBtn.click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows only redacted SQL for file analytics history details", async () => {
    invokeMock.mockResolvedValueOnce({
      id: 12,
      source: "file-analytics",
      sql: "SELECT '/Users/felix/private/sales.csv' AS path FROM \"sales_csv\"",
      sqlRedacted: 'SELECT ? AS path FROM "sales_csv"',
    });

    render(<QueryHistoryDetailModal id={12} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("query-history-detail-sql")).toHaveTextContent(
        'SELECT ? AS path FROM "sales_csv"',
      );
    });

    expect(document.body).not.toHaveTextContent(
      "/Users/felix/private/sales.csv",
    );
    expect(
      screen.queryByTestId("query-history-detail-sql-redacted"),
    ).not.toBeInTheDocument();
  });
});
