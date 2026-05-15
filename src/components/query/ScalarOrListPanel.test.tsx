// Sprint 312 (Phase 28 Slice A6, 2026-05-14) — RTL coverage of the three
// `ScalarOrListPanel` modes (count / list / findOne-empty).
//
// Test axes:
//   1. "count"           — big numeric + "Count" label
//   2. "list"            — field name title + one row per value
//   3. "findOne-empty"   — "No matching document" centered
//
// The panel is purely presentational. `count` / `list` source their data
// from `QueryResult.rows`; `findOne-empty` ignores rows entirely.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ScalarOrListPanel from "./ScalarOrListPanel";
import type { QueryResult } from "@/types/query";

describe("ScalarOrListPanel — count mode", () => {
  it('renders the big numeric + "Count" label', () => {
    const result: QueryResult = {
      columns: [{ name: "count", data_type: "Int64", category: "int" }],
      rows: [[42]],
      total_count: 1,
      execution_time_ms: 3,
      query_type: "select",
      resultKind: "scalar",
    };
    render(<ScalarOrListPanel result={result} mode="count" />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Count")).toBeInTheDocument();
  });

  it("renders 0 when count is zero", () => {
    const result: QueryResult = {
      columns: [{ name: "count", data_type: "Int64", category: "int" }],
      rows: [[0]],
      total_count: 1,
      execution_time_ms: 1,
      query_type: "select",
      resultKind: "scalar",
    };
    render(<ScalarOrListPanel result={result} mode="count" />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});

describe("ScalarOrListPanel — list mode", () => {
  it("renders the field-name title + one row per value", () => {
    const result: QueryResult = {
      columns: [{ name: "country", data_type: "string", category: "text" }],
      rows: [["KR"], ["US"], ["JP"]],
      total_count: 3,
      execution_time_ms: 5,
      query_type: "select",
      resultKind: "list",
    };
    render(<ScalarOrListPanel result={result} mode="list" />);
    expect(
      screen.getByRole("heading", { name: "country" }),
    ).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain("KR");
    expect(items[1]!.textContent).toContain("US");
    expect(items[2]!.textContent).toContain("JP");
  });

  it("renders empty list cleanly (no items, no NULL placeholder)", () => {
    const result: QueryResult = {
      columns: [{ name: "value", data_type: "string", category: "text" }],
      rows: [],
      total_count: 0,
      execution_time_ms: 2,
      query_type: "select",
      resultKind: "list",
    };
    render(<ScalarOrListPanel result={result} mode="list" />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("ScalarOrListPanel — findOne-empty mode", () => {
  it('renders "No matching document" centered', () => {
    const result: QueryResult = {
      columns: [],
      rows: [],
      total_count: 0,
      execution_time_ms: 2,
      query_type: "select",
      resultKind: "scalar",
    };
    render(<ScalarOrListPanel result={result} mode="findOne-empty" />);
    expect(screen.getByText("No matching document")).toBeInTheDocument();
  });
});
