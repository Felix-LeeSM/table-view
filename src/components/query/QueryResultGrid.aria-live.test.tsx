// #1137 — dynamic-state aria-live/aria-busy routing.
//
// Guards the two representative flows called out in the issue AC:
//   - running state advertises `aria-busy` in a live region (loading transition)
//   - completed SELECT routes the "— N rows" summary through `role="status"`
//     so SR users hear the result scale, matching the error `role="alert"`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen } from "@testing-library/react";
import QueryResultGrid from "./QueryResultGrid";
import type { QueryResult } from "@/types/query";
import { useSchemaStore } from "@stores/schemaStore";

beforeEach(() => {
  setupTauriMock({
    getTableColumns: vi.fn(async () => []),
    executeQuery: vi.fn(async () => ({})),
  });
  useSchemaStore.setState({ tableColumnsCache: {} });
});

describe("QueryResultGrid — aria-live routing (#1137)", () => {
  it("running state is a busy live region", () => {
    render(
      <QueryResultGrid queryState={{ status: "running", queryId: "q1" }} />,
    );
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region.textContent).toMatch(/Executing/i);
  });

  it("completed SELECT summary lives in a polite status region", () => {
    const result: QueryResult = {
      columns: [{ name: "id", dataType: "integer", category: "int" }],
      rows: [[1], [2], [3]],
      totalCount: 3,
      executionTimeMs: 2,
      queryType: "select",
    };
    render(<QueryResultGrid queryState={{ status: "completed", result }} />);
    // The completion summary ("SELECT — 3 rows") must sit inside a live region.
    const summary = screen
      .getAllByRole("status")
      .find((el) => /SELECT/.test(el.textContent ?? ""));
    expect(summary).toBeDefined();
    expect(summary).toHaveAttribute("aria-live", "polite");
    expect(summary!.textContent).toMatch(/3/);
  });
});
