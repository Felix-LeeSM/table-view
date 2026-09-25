/**
 * AC-372-02, AC-372-06, AC-372-08.
 *
 * Reason: on mount the per-tab panel calls the IPC once with a
 * `{connectionId, tabId}` filter, shows only the redacted response, and on a
 * create event during cursor pagination shows a badge without refetching
 * (AC-372-06). Plus the redact-only display invariant (AC-372-08) —
 * sqlRedacted is visible and the original sql is never exposed.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  dispatchStateChangedPayload,
  resetStateChangedRegistryForTests,
} from "@lib/events/stateChanged";
import QueryHistoryPanel from "./QueryHistoryPanel";

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

  // AC-372-02 — mount calls the list_history IPC with a
  // `{connectionId, tabId}` filter. The payload is byte-equivalent to the
  // backend's `tests/history_list_filter.rs` (lego).
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

  // AC-372-08 — redact-only display. The original sql is absent from the
  // list response and must not appear anywhere in the panel.
  // Reason: privacy invariant (strategy F.5 line 537). The original sql is
  // exposed nowhere outside the detail modal.
  it("[AC-372-08] panel renders sqlRedacted only — no leak of original sql", async () => {
    invokeMock.mockResolvedValueOnce({
      rows: [
        {
          ...row(1),
          // The original is absent from the list response — the backend
          // never sends it.
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
    // A keyword the original would commonly carry does not appear in the panel
    expect(panel).not.toHaveTextContent("leak@example.com");
    // The placeholder the backend redacted is shown
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

  // AC-372-06 — create event during cursor pagination → no refetch + "New
  // entry" badge. Past page 1 the auto-refresh is blocked to protect the
  // user's reading position.
  // Reason: locks the user journey path down to its last outcome (does the
  // new-entry badge become visible in the UI).
  it("[AC-372-06] paginated state + create event → 'New entry' badge appears, no auto-refetch", async () => {
    // First page — hasMore=true
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

    // loadMore click → cursor mode
    invokeMock.mockResolvedValueOnce({ rows: [row(9)] });
    await act(async () => {
      screen.getByTestId("query-history-panel-load-more").click();
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);

    // create event arrives → no refetch, badge only
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

    // Badge becomes visible
    expect(
      screen.getByTestId("query-history-panel-new-entry"),
    ).toBeInTheDocument();
  });

  // empty state — empty array in the IPC response → "No queries…" notice.
  // Reason: keeps a blank screen from looking to the user like silent
  // loading.
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

  // "End of history" — with no nextCursor, mark the end of the list.
  // Reason: so the user can tell at a glance they reached the last page.
  it("shows 'End of history' marker when nextCursor is absent", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [row(1), row(2)] });
    render(<QueryHistoryPanel connectionId="conn-1" tabId="tab-1" />);
    await expandHistoryPanel();

    await waitFor(() => {
      expect(screen.getByTestId("query-history-panel-end")).toBeInTheDocument();
    });
    // With hasMore=false the load more button is hidden
    expect(
      screen.queryByTestId("query-history-panel-load-more"),
    ).not.toBeInTheDocument();
  });

  // row click → detail modal mount + get_history_detail IPC call.
  // Reason: locks that a real user click inside the panel triggers the
  // AC-372-03 wire path.
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
