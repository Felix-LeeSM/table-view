import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResultEnvelope } from "@/types/search";
import {
  executeSearchDslQuery,
  parseSearchDslRequest,
} from "./searchQueryExecution";

const executeSearchQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@lib/tauri", () => ({
  executeSearchQuery: (...args: unknown[]) => executeSearchQueryMock(...args),
}));

const SEARCH_RESULT: SearchResultEnvelope = {
  tookMs: 6,
  timedOut: false,
  total: { value: 1, relation: "eq" },
  hits: [
    {
      index: "logs-2026.06.10",
      id: "doc-1",
      score: 1,
      source: { message: "ok" },
      sort: [],
    },
  ],
  aggregations: [],
};

const tab = {
  id: "query-search",
  connectionId: "conn-search",
};

function createActions() {
  return {
    updateQueryState: vi.fn(),
    completeSearchQuery: vi.fn(),
    failQuery: vi.fn(),
  };
}

describe("searchQueryExecution seam", () => {
  beforeEach(() => {
    executeSearchQueryMock.mockReset();
  });

  it("parses Search DSL JSON into the fixture-backed query request shape", () => {
    expect(
      parseSearchDslRequest(
        JSON.stringify({
          index: "logs-2026.06.10",
          body: { query: { match_all: {} } },
          from: 5,
          size: 10,
          trackTotalHits: true,
        }),
      ),
    ).toEqual({
      index: "logs-2026.06.10",
      body: { query: { match_all: {} } },
      from: 5,
      size: 10,
      trackTotalHits: true,
    });
  });

  it("dispatches Search DSL through the Search IPC wrapper and completes with Search result state", async () => {
    executeSearchQueryMock.mockResolvedValueOnce(SEARCH_RESULT);
    const actions = createActions();

    await executeSearchDslQuery({
      tab,
      sql: JSON.stringify({
        index: "logs-2026.06.10",
        body: { query: { match_all: {} } },
      }),
      ...actions,
    });

    expect(actions.updateQueryState).toHaveBeenCalledWith("query-search", {
      status: "running",
      queryId: expect.stringMatching(/^query-search-/),
    });
    expect(executeSearchQueryMock).toHaveBeenCalledWith(
      "conn-search",
      {
        index: "logs-2026.06.10",
        body: { query: { match_all: {} } },
        from: undefined,
        size: undefined,
        trackTotalHits: undefined,
      },
      expect.stringMatching(/^query-search-/),
    );
    expect(actions.completeSearchQuery).toHaveBeenCalledWith(
      "query-search",
      expect.stringMatching(/^query-search-/),
      SEARCH_RESULT,
    );
  });

  it("keeps invalid Search DSL on the tab error path without IPC dispatch", async () => {
    const actions = createActions();

    await executeSearchDslQuery({
      tab,
      sql: JSON.stringify({ index: "logs-2026.06.10", body: [] }),
      ...actions,
    });

    expect(executeSearchQueryMock).not.toHaveBeenCalled();
    expect(actions.updateQueryState).toHaveBeenCalledWith("query-search", {
      status: "error",
      error: "Search DSL request requires an object body.",
    });
  });

  it("fails the tab when Search IPC rejects", async () => {
    executeSearchQueryMock.mockRejectedValueOnce(
      new Error("search unavailable"),
    );
    const actions = createActions();

    await executeSearchDslQuery({
      tab,
      sql: JSON.stringify({
        index: "logs-2026.06.10",
        body: { query: { match_all: {} } },
      }),
      ...actions,
    });

    expect(actions.completeSearchQuery).not.toHaveBeenCalled();
    expect(actions.failQuery).toHaveBeenCalledWith(
      "query-search",
      expect.stringMatching(/^query-search-/),
      "search unavailable",
    );
  });
});
