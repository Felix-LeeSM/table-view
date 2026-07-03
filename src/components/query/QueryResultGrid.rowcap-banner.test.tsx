// Issue #1231 — raw query row cap truncation banner. When a SELECT result
// carries `truncated: true` the grid mounts a warning banner above the body
// explaining the cause (row cap hit) and the fix (add LIMIT / raise the cap
// in settings). Uniform across every DBMS (consistency principle), so the
// test drives the shared `QueryResultGrid` render, not a per-paradigm path.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import QueryResultGrid from "./QueryResultGrid";
import type { QueryResult } from "@/types/query";

function selectResult(truncated: boolean, rows: number): QueryResult {
  return {
    columns: [{ name: "id", dataType: "integer", category: "int" }],
    rows: Array.from({ length: rows }, (_, i) => [i]),
    totalCount: rows,
    executionTimeMs: 3,
    queryType: "select",
    truncated,
  };
}

describe("QueryResultGrid — row cap banner (#1231)", () => {
  it("mounts the banner when result.truncated is true", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: selectResult(true, 42) }}
      />,
    );
    const banner = screen.getByTestId("row-cap-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("role", "status");
    // Cause + fix must both be present (issue requires "원인+해결 병기").
    // The row count is interpolated from the returned rows (== the cap hit).
    expect(banner.textContent).toMatch(/42/);
    expect(banner.textContent).toMatch(/LIMIT/i);
  });

  it("omits the banner when result.truncated is false", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: selectResult(false, 5) }}
      />,
    );
    expect(screen.queryByTestId("row-cap-banner")).toBeNull();
  });

  it("omits the banner when result.truncated is undefined (legacy)", () => {
    const result = selectResult(false, 5);
    delete result.truncated;
    render(<QueryResultGrid queryState={{ status: "completed", result }} />);
    expect(screen.queryByTestId("row-cap-banner")).toBeNull();
  });
});
