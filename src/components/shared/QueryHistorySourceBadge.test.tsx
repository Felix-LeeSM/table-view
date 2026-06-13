// AC-196-06 — source badge surface tests. Sprint 196 (FB-5b) introduces a
// per-row `source` indicator on the global query log so users can tell
// editor-driven runs apart from grid commits / DDL ops / Mongo direct ops.
// `raw` is suppressed (the default for editor execution) to keep the row
// visually quiet — only non-default sources light up. 2026-05-02.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import QueryHistorySourceBadge from "./QueryHistorySourceBadge";

describe("QueryHistorySourceBadge", () => {
  it("[AC-196-06-1] renders nothing for source='raw' (visual quiet)", () => {
    const { container } = render(<QueryHistorySourceBadge source="raw" />);
    expect(container.firstChild).toBeNull();
  });

  it("[AC-196-06-1b] renders nothing for undefined source (legacy entry)", () => {
    const { container } = render(
      <QueryHistorySourceBadge source={undefined} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for unknown backend source labels", () => {
    const { container } = render(
      <QueryHistorySourceBadge source="future-source" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("[AC-196-06-2a] surfaces a GRID badge for grid-edit", () => {
    render(<QueryHistorySourceBadge source="grid-edit" />);
    const badge = screen.getByTestId("query-history-source-badge");
    expect(badge).toHaveTextContent("GRID");
    expect(badge.getAttribute("data-source")).toBe("grid-edit");
    expect(badge.getAttribute("title")).toMatch(/grid commit/i);
  });

  it("[AC-196-06-2b] surfaces a DDL badge for ddl-structure", () => {
    render(<QueryHistorySourceBadge source="ddl-structure" />);
    const badge = screen.getByTestId("query-history-source-badge");
    expect(badge).toHaveTextContent("DDL");
    expect(badge.getAttribute("data-source")).toBe("ddl-structure");
  });

  it("[AC-196-06-2c] surfaces an MQL badge for mongo-op", () => {
    render(<QueryHistorySourceBadge source="mongo-op" />);
    const badge = screen.getByTestId("query-history-source-badge");
    expect(badge).toHaveTextContent("MQL");
    expect(badge.getAttribute("data-source")).toBe("mongo-op");
  });

  it("surfaces a PLAN badge for explain", () => {
    render(<QueryHistorySourceBadge source="explain" />);
    const badge = screen.getByTestId("query-history-source-badge");
    expect(badge).toHaveTextContent("PLAN");
    expect(badge.getAttribute("data-source")).toBe("explain");
    expect(badge.getAttribute("title")).toMatch(/explain plan/i);
  });

  it("surfaces a FILE badge for DuckDB file analytics source queries", () => {
    render(<QueryHistorySourceBadge source="file-analytics" />);
    const badge = screen.getByTestId("query-history-source-badge");
    expect(badge).toHaveTextContent("FILE");
    expect(badge.getAttribute("data-source")).toBe("file-analytics");
    expect(badge.getAttribute("title")).toMatch(/duckdb local-file source/i);
  });

  it("surfaces only the file name for DuckDB file analytics source labels", () => {
    const absolutePath = "/Users/felix/private/sales.csv";
    render(
      <QueryHistorySourceBadge
        source="file-analytics"
        sourceLabel={absolutePath}
      />,
    );
    const badge = screen.getByTestId("query-history-source-badge");
    expect(badge).toHaveTextContent("sales.csv");
    expect(document.body).not.toHaveTextContent(absolutePath);
    expect(badge.getAttribute("title")).toBe(
      "Recorded from sales.csv DuckDB local-file source query",
    );
  });
});
