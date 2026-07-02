import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { resetStateChangedRegistryForTests } from "@lib/events/stateChanged";
import type { HistoryListRow } from "@lib/tauri/history";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import GlobalQueryLogPanel from "./GlobalQueryLogPanel";

const row = (overrides: Partial<HistoryListRow> = {}): HistoryListRow => ({
  id: 1,
  connectionId: "conn-1",
  paradigm: "rdb",
  queryMode: "sql",
  source: "explain",
  sqlRedacted: "SELECT name FROM users WHERE email = ?",
  status: "success",
  durationMs: 12,
  executedAt: Date.now(),
  ...overrides,
});

describe("GlobalQueryLogPanel", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetStateChangedRegistryForTests();
  });

  it("fetches fresh history when opened and renders the explain source badge", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <GlobalQueryLogPanel visible={false} onClose={onClose} />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(invokeMock).not.toHaveBeenCalled();

    invokeMock.mockResolvedValueOnce({ rows: [row()] });
    rerender(<GlobalQueryLogPanel visible onClose={onClose} />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("list_history", {
        req: { limit: 100 },
      });
    });
    expect(await screen.findByTestId("global-log-entry-1")).toBeInTheDocument();
    expect(screen.getByTestId("query-history-source-badge")).toHaveAttribute(
      "data-source",
      "explain",
    );
  });

  it("labels each paradigm with its own query language, not SQL", async () => {
    invokeMock.mockResolvedValueOnce({
      rows: [
        row({
          id: 2,
          paradigm: "kv",
          queryMode: "command",
          source: "raw",
          sqlRedacted: "GET user:1",
        }),
        row({
          id: 3,
          paradigm: "search",
          queryMode: "query",
          source: "raw",
          sqlRedacted: '{"query":{"match_all":{}}}',
        }),
        row({
          id: 4,
          paradigm: "document",
          queryMode: "find",
          source: "raw",
          sqlRedacted: "db.users.find({})",
        }),
      ],
    });

    render(<GlobalQueryLogPanel visible onClose={vi.fn()} />);

    const kvBadge = (
      await screen.findByTestId("global-log-entry-2")
    ).querySelector('[data-paradigm="kv"]');
    const searchBadge = (
      await screen.findByTestId("global-log-entry-3")
    ).querySelector('[data-paradigm="search"]');
    const docBadge = (
      await screen.findByTestId("global-log-entry-4")
    ).querySelector('[data-paradigm="document"]');

    expect(kvBadge).toHaveTextContent("Redis command");
    expect(searchBadge).toHaveTextContent("Search DSL");
    expect(docBadge).not.toHaveTextContent("SQL");
    expect(kvBadge).not.toHaveTextContent("SQL");
    expect(searchBadge).not.toHaveTextContent("SQL");
  });

  it("renders DuckDB file analytics source badges with file name only", async () => {
    invokeMock.mockResolvedValueOnce({
      rows: [
        row({
          source: "file-analytics",
          collection: "sales.csv",
          sqlRedacted: 'SELECT * FROM "sales_csv"',
        }),
      ],
    });

    render(<GlobalQueryLogPanel visible onClose={vi.fn()} />);

    const badge = await screen.findByTestId("query-history-source-badge");
    expect(badge).toHaveTextContent("sales.csv");
    expect(document.body).not.toHaveTextContent("/Users/felix/private");
  });
});
