/**
 * 작성 2026-05-17 (Phase 5 sprint-372 / AC-372-02, AC-372-06, AC-372-08).
 *
 * 사유: per-tab panel 은 mount 시 `{connectionId, tabId}` filter 로 IPC 1회
 * 호출, 응답을 redact 만 보여주고, cursor pagination 중 create event 가
 * 오면 refetch 0 + 배지 표시 (AC-372-06). 추가로 redact-only display
 * invariant (AC-372-08) — sqlRedacted 가 보이고 원문 sql 은 0 노출.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import QueryHistoryPanel from "./QueryHistoryPanel";
import {
  dispatchStateChangedPayload,
  resetStateChangedRegistryForTests,
} from "@lib/events/stateChanged";

const row = (id: number, sqlRedacted = `SELECT ${id}`) => ({
  id,
  connectionId: "conn-1",
  tabId: "tab-1",
  paradigm: "rdb" as const,
  queryMode: "sql",
  source: "raw",
  sqlRedacted,
  status: "success",
  durationMs: 5,
  executedAt: 1_700_000_000_000 + id,
});

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

const fileAnalyticsRow = (id: number) => ({
  ...row(id, 'SELECT * FROM "sales_csv"'),
  source: "file-analytics" as const,
  collection: "sales.csv",
});

async function expandHistoryPanel() {
  const toggle = screen.getByRole("button", { name: /tab history/i });
  await act(async () => {
    toggle.click();
  });
  return toggle;
}

describe("QueryHistoryPanel per-tab (sprint-372)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetStateChangedRegistryForTests();
  });

  // AC-372-02 — mount 시 list_history IPC 가 `{connectionId, tabId}` filter
  // 로 호출. backend 의 `tests/history_list_filter.rs` 와 byte-equivalent
  // payload (lego).
  // 작성 2026-05-17.
  it("[AC-372-02] mount fires list_history with connectionId + tabId filter", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [row(1)] });
    render(<QueryHistoryPanel connectionId="conn-1" tabId="tab-1" />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("list_history", {
        req: { connectionId: "conn-1", tabId: "tab-1", limit: 100 },
      });
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("defaults to collapsed and expands tab history rows on demand", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [row(1)] });
    render(<QueryHistoryPanel connectionId="conn-1" tabId="tab-1" />);

    const toggle = screen.getByRole("button", { name: /tab history/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("query-history-panel-rows"),
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("query-history-panel-count")).toHaveTextContent(
        "1",
      );
    });

    await expandHistoryPanel();

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("query-history-panel-rows")).toBeInTheDocument();
    expect(screen.getByTestId("query-history-panel-row-1")).toBeInTheDocument();
  });

  // #1309 — history surfaces share a "default N + collapse" convention. The
  // per-tab panel caps its loaded rows to the shared default and hides the
  // rest (and the page-level Load more) behind one keyboard-reachable toggle.
  it("caps tab history rows to the shared default and expands via the collapse toggle", async () => {
    invokeMock.mockResolvedValueOnce({
      rows: range(8).map((i) => row(i + 1)),
      nextCursor: 1,
    });
    render(<QueryHistoryPanel connectionId="conn-1" tabId="tab-1" />);
    await expandHistoryPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId("query-history-panel-row-1"),
      ).toBeInTheDocument();
    });
    // 8 rows loaded, cap 5 → rows 1..5 visible, 6..8 hidden.
    expect(screen.getByTestId("query-history-panel-row-5")).toBeInTheDocument();
    expect(
      screen.queryByTestId("query-history-panel-row-8"),
    ).not.toBeInTheDocument();
    // Load more stays hidden until the current page is fully revealed.
    expect(
      screen.queryByTestId("query-history-panel-load-more"),
    ).not.toBeInTheDocument();

    const collapse = screen.getByTestId("query-history-panel-collapse");
    expect(collapse).toHaveAttribute("aria-expanded", "false");
    await act(async () => {
      collapse.click();
    });

    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("query-history-panel-row-8")).toBeInTheDocument();
    expect(
      screen.getByTestId("query-history-panel-load-more"),
    ).toBeInTheDocument();
  });

  // AC-372-08 — redact-only display. 원문 sql 은 list 응답에 없고
  // panel 어디에도 노출되어선 안 된다.
  // 작성 2026-05-17. 사유: privacy invariant (strategy F.5 line 537).
  // detail modal 외에서 원문 sql 0 노출.
  it("[AC-372-08] panel renders sqlRedacted only — no leak of original sql", async () => {
    invokeMock.mockResolvedValueOnce({
      rows: [
        {
          ...row(1),
          // 원문은 list 응답에 없음. backend 가 절대 보내지 않는다.
          sqlRedacted: "SELECT * FROM users WHERE email = ?",
        },
      ],
    });
    render(<QueryHistoryPanel connectionId="conn-1" tabId="tab-1" />);
    await expandHistoryPanel();

    const panel = await screen.findByTestId("query-history-panel");
    await waitFor(() => {
      expect(panel).toHaveTextContent("?");
    });
    // 원문에 흔히 등장할 키워드 가 panel 안에는 안 나타남
    expect(panel).not.toHaveTextContent("leak@example.com");
    // backend 가 redact 한 placeholder 가 표시됨
    expect(panel).toHaveTextContent("?");
  });

  it("surfaces DuckDB file analytics source badges in tab history rows", async () => {
    invokeMock.mockResolvedValueOnce({
      rows: [fileAnalyticsRow(7)],
    });
    render(<QueryHistoryPanel connectionId="conn-1" tabId="tab-1" />);
    await expandHistoryPanel();

    const badge = await screen.findByTestId("query-history-source-badge");
    expect(badge).toHaveAttribute("data-source", "file-analytics");
    expect(badge).toHaveTextContent("sales.csv");
  });

  // AC-372-06 — cursor pagination 중 create event → refetch 0 + "New entry"
  // 배지 표시. 페이지 1 이 아니면 자동 새로고침을 막아 user 의 reading
  // position 을 보호한다.
  // 작성 2026-05-17. 사유: user journey path 의 마지막 outcome (UI 에
  // 새 entry 배지가 가시화되는가) 까지 lock.
  it("[AC-372-06] paginated state + create event → 'New entry' badge appears, no auto-refetch", async () => {
    // 첫 page — hasMore=true
    invokeMock.mockResolvedValueOnce({
      rows: [row(10)],
      nextCursor: 10,
    });
    render(<QueryHistoryPanel connectionId="conn-1" tabId="tab-1" />);
    await expandHistoryPanel();

    await waitFor(() => {
      expect(
        screen.getByTestId("query-history-panel-load-more"),
      ).toBeInTheDocument();
    });

    // loadMore 클릭 → cursor mode
    invokeMock.mockResolvedValueOnce({ rows: [row(9)] });
    await act(async () => {
      screen.getByTestId("query-history-panel-load-more").click();
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);

    // create event 도착 → refetch 0, 배지만 set
    await act(async () => {
      dispatchStateChangedPayload("this-window", {
        domain: "history",
        op: "create",
        entityId: "99",
        version: 1,
        snapshotVersion: 0,
        originWindow: "other-window",
        emittedAt: 1_700_000_000_000,
      });
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);

    // 배지 가시화
    expect(
      screen.getByTestId("query-history-panel-new-entry"),
    ).toBeInTheDocument();
  });

  // empty state — IPC 응답 빈 배열 → "No queries…" 안내 표시.
  // 작성 2026-05-17. 사유: 사용자 빈 화면이 silent loading 처럼 보이지
  // 않도록 보장.
  it("renders empty state when backend returns no rows", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [] });
    render(<QueryHistoryPanel connectionId="conn-1" tabId="tab-1" />);
    await expandHistoryPanel();

    await waitFor(() => {
      expect(
        screen.getByText(/No queries executed in this tab/),
      ).toBeInTheDocument();
    });
  });

  // "End of history" — nextCursor 가 없으면 list 끝 안내.
  // 작성 2026-05-17. 사유: 사용자가 마지막 page 까지 본 사실을 직관적으로
  // 알 수 있도록.
  it("shows 'End of history' marker when nextCursor is absent", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [row(1), row(2)] });
    render(<QueryHistoryPanel connectionId="conn-1" tabId="tab-1" />);
    await expandHistoryPanel();

    await waitFor(() => {
      expect(screen.getByTestId("query-history-panel-end")).toBeInTheDocument();
    });
    // hasMore=false 이면 load more 버튼이 안 보임
    expect(
      screen.queryByTestId("query-history-panel-load-more"),
    ).not.toBeInTheDocument();
  });

  // row 클릭 → detail modal mount + get_history_detail IPC 호출.
  // 작성 2026-05-17. 사유: AC-372-03 의 wire path 가 panel 내에서
  // 실제 user click 으로 trigger 되는지 lock.
  it("clicking a row opens the detail modal and triggers get_history_detail IPC", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [row(42)] });
    render(<QueryHistoryPanel connectionId="conn-1" tabId="tab-1" />);
    await expandHistoryPanel();

    const rowBtn = await screen.findByTestId("query-history-panel-row-42");

    invokeMock.mockResolvedValueOnce({
      id: 42,
      sql: "SELECT 42",
      sqlRedacted: "SELECT 42",
    });

    await act(async () => {
      rowBtn.click();
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_history_detail", {
        req: { id: 42 },
      });
    });
  });
});
